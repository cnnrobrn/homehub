/**
 * Google Mail (Gmail) provider adapter.
 *
 * Speaks Gmail v1 through Nango's proxy. Zero direct token handling —
 * Nango owns OAuth refresh (`specs/03-integrations/nango.md`).
 *
 * Design notes:
 *   - Scopes are locked to `gmail.readonly`, `gmail.labels`, and
 *     `gmail.modify`. We label but never delete or draft messages.
 *   - `listRecentMessages` is an async generator that yields one page
 *     at a time. When `afterHistoryId` is supplied, we use
 *     `users.history.list`; otherwise we use `users.messages.list` with
 *     the composed search query. Both paginate via `nextPageToken`.
 *   - A 404 on `history.list` → `HistoryIdExpiredError`. The caller
 *     drops the cursor and re-runs as a full sync.
 *   - 429 / 403 with `rateLimitExceeded` / `userRateLimitExceeded` →
 *     `RateLimitError` with the `Retry-After` seconds.
 *   - Message fetch uses `format=METADATA` for headers + `snippet`, NOT
 *     the full body. M4-B's extraction worker pulls format=FULL on
 *     demand.
 *   - Body preview caps at 2048 chars per `specs/03-integrations/
 *     google-workspace.md` retention rules.
 *   - `ensureLabel` creates the `HomeHub/Ingested` nested label if
 *     missing and caches the id per connection.
 */

import { type NangoClient, NangoError } from '@homehub/worker-runtime';

import { EmailSyncError, HistoryIdExpiredError, RateLimitError } from './errors.js';

import type {
  AddLabelArgs,
  CreateDraftArgs,
  CreateDraftResult,
  EmailAttachmentMeta,
  EmailMessage,
  EmailProvider,
  EnsureLabelArgs,
  EnsureLabelResult,
  FetchAttachmentArgs,
  FetchAttachmentResult,
  FetchFullBodyArgs,
  FetchFullBodyResult,
  FetchMessageArgs,
  ListRecentMessagesArgs,
  ListRecentMessagesPage,
  UnwatchArgs,
  WatchArgs,
  WatchResult,
} from './types.js';

/** Nango provider-config key for Google Mail. Fixed by convention. */
export const GOOGLE_MAIL_PROVIDER_KEY = 'google-mail';

/** Google sets `Retry-After` in seconds; if missing, default to 60s. */
const DEFAULT_RATE_LIMIT_RETRY_SECONDS = 60;

/** Page size — Gmail caps at 500 but 100 keeps each tick bounded. */
const PAGE_SIZE = 100;

/** Body-preview cap per data-retention spec (first ~2KB). */
export const BODY_PREVIEW_MAX_BYTES = 2048;

/** Default label applied to every ingested message. */
export const HOMEHUB_INGESTED_LABEL_NAME = 'HomeHub/Ingested';

interface RawHeader {
  name?: string;
  value?: string;
}

interface RawMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: RawHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: RawMessagePart[];
}

interface RawMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: RawMessagePart;
  [key: string]: unknown;
}

interface RawMessagesList {
  messages?: Array<{ id?: string; threadId?: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface RawHistoryList {
  history?: Array<{
    id?: string;
    messagesAdded?: Array<{ message?: { id?: string; threadId?: string } }>;
    messages?: Array<{ id?: string; threadId?: string }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
}

interface RawLabel {
  id?: string;
  name?: string;
}

interface RawLabelList {
  labels?: RawLabel[];
}

interface RawWatchResponse {
  historyId?: string;
  expiration?: string;
}

interface RawAttachmentResponse {
  data?: string;
  size?: number;
}

/**
 * Extract seconds from a Retry-After header value. Accepts either a
 * relative delta in seconds or an HTTP-date.
 */
function parseRetryAfter(value: string | undefined): number {
  if (!value) return DEFAULT_RATE_LIMIT_RETRY_SECONDS;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
  const asDate = Date.parse(value);
  if (Number.isFinite(asDate)) {
    const diff = Math.ceil((asDate - Date.now()) / 1_000);
    if (diff > 0) return diff;
  }
  return DEFAULT_RATE_LIMIT_RETRY_SECONDS;
}

/**
 * Map a Nango-proxied Gmail error to our typed error hierarchy.
 *
 * `opts.historyContext` → when the caller is inside a history.list call,
 * a 404 means the historyId has been invalidated. Outside that context,
 * a 404 is a terminal bug (message/label went away mid-sync).
 */
function classifyNangoError(err: unknown, opts?: { historyContext?: boolean }): never {
  if (err instanceof NangoError) {
    const cause = err.cause as
      | {
          response?: {
            status?: number;
            statusText?: string;
            headers?: Record<string, string>;
            data?: {
              error?: {
                code?: number;
                status?: string;
                message?: string;
                errors?: Array<{ reason?: string }>;
              };
            };
          };
        }
      | undefined;
    const status = cause?.response?.status;
    const data = cause?.response?.data;
    const reasons = data?.error?.errors?.map((e) => e?.reason).filter(Boolean) ?? [];

    // 404 inside history.list: historyId expired.
    if (status === 404 && opts?.historyContext) {
      throw new HistoryIdExpiredError('gmail returned 404; historyId invalidated', {
        cause: err,
      });
    }

    // 429 or 403 with rateLimit reasons.
    const rateLimited = reasons.some(
      (r) => r === 'rateLimitExceeded' || r === 'userRateLimitExceeded' || r === 'quotaExceeded',
    );
    if (status === 429 || (status === 403 && rateLimited)) {
      const retryAfter = parseRetryAfter(cause?.response?.headers?.['retry-after']);
      throw new RateLimitError('gmail rate limit exceeded', retryAfter, { cause: err });
    }
  }
  throw new EmailSyncError('gmail proxy call failed', { cause: err });
}

/**
 * Decode base64url (Gmail snippet bodies). Falls back to the input on
 * decode failure so partial messages still produce *some* preview.
 */
function decodeBase64Url(data: string): string {
  try {
    const padded = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Parse an `Addr <foo@bar>` header into (name, email). Accepts bare
 * emails too. Never throws.
 */
export function parseFromAddress(raw: string | undefined): { email: string; name?: string } {
  if (!raw) return { email: '' };
  const trimmed = raw.trim();
  const match = trimmed.match(/^\s*(?:"?([^"<]+?)"?\s*)?<([^>]+)>\s*$/);
  if (match) {
    const name = match[1]?.trim();
    const email = (match[2] ?? '').trim().toLowerCase();
    return name ? { email, name } : { email };
  }
  // Bare email.
  return { email: trimmed.toLowerCase() };
}

/** Split a comma-separated recipients header into individual addresses. */
function parseRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => parseFromAddress(s).email)
    .filter(Boolean);
}

function headerValue(headers: RawHeader[] | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const h of headers) {
    if ((h.name ?? '').toLowerCase() === lower) return h.value ?? undefined;
  }
  return undefined;
}

/**
 * Walk a MIME tree and collect attachments (parts with a non-empty
 * filename and body.attachmentId). Ignores inline images without
 * filenames.
 */
function collectAttachments(part: RawMessagePart | undefined): EmailAttachmentMeta[] {
  const out: EmailAttachmentMeta[] = [];
  if (!part) return out;
  const walk = (p: RawMessagePart) => {
    if (p.filename && p.body?.attachmentId) {
      out.push({
        partId: p.partId ?? '',
        filename: p.filename,
        contentType: p.mimeType ?? 'application/octet-stream',
        sizeBytes: p.body.size ?? 0,
      });
    }
    for (const child of p.parts ?? []) walk(child);
  };
  walk(part);
  return out;
}

/**
 * Find the best body preview from the MIME tree:
 *   1. Walk for a `text/plain` part with body.data.
 *   2. Fall back to `text/html` (strip tags loosely).
 *   3. Fall back to the `snippet` (which comes from the top-level raw message).
 * Capped at `BODY_PREVIEW_MAX_BYTES`.
 */
function extractBodyPreview(raw: RawMessage): string {
  const searchOrder = ['text/plain', 'text/html'];
  for (const mime of searchOrder) {
    const body = findFirstTextPart(raw.payload, mime);
    if (body) {
      const decoded = decodeBase64Url(body);
      const cleaned = mime === 'text/html' ? stripHtml(decoded) : decoded;
      return truncateBytes(cleaned, BODY_PREVIEW_MAX_BYTES);
    }
  }
  return truncateBytes(raw.snippet ?? '', BODY_PREVIEW_MAX_BYTES);
}

function findFirstTextPart(part: RawMessagePart | undefined, mime: string): string | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data) return part.body.data;
  for (const child of part.parts ?? []) {
    const hit = findFirstTextPart(child, mime);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Full-body variant of `findFirstTextPart` that also surfaces the part's
 * Content-Type charset. Returns `undefined` when no matching part is
 * found.
 */
function findFirstTextPartWithCharset(
  part: RawMessagePart | undefined,
  mime: string,
): { data: string; charset?: string } | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data) {
    const contentType = headerValue(part.headers, 'Content-Type');
    const charsetMatch = contentType?.match(/charset\s*=\s*"?([^";\s]+)"?/i);
    return {
      data: part.body.data,
      ...(charsetMatch ? { charset: charsetMatch[1] } : {}),
    };
  }
  for (const child of part.parts ?? []) {
    const hit = findFirstTextPartWithCharset(child, mime);
    if (hit) return hit;
  }
  return undefined;
}

function stripHtml(input: string): string {
  // Intentionally loose — we only need a preview, not a rendering.
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateBytes(input: string, maxBytes: number): string {
  if (!input) return '';
  const buf = Buffer.from(input, 'utf8');
  if (buf.byteLength <= maxBytes) return input;
  // Slice on byte boundary but re-decode so we don't split a multibyte char.
  return buf.subarray(0, maxBytes).toString('utf8');
}

/**
 * Convert a Gmail message response into our canonical shape. Returns
 * null if the message lacks identifiers we need.
 */
export function normalizeMessage(raw: RawMessage): EmailMessage | null {
  if (!raw.id || !raw.threadId) return null;

  const headers = raw.payload?.headers;
  const subjectHeader = headerValue(headers, 'Subject') ?? '';
  const fromHeader = headerValue(headers, 'From');
  const toHeader = headerValue(headers, 'To');
  const dateHeader = headerValue(headers, 'Date');
  const messageIdHeader = headerValue(headers, 'Message-Id');
  const listUnsub = headerValue(headers, 'List-Unsubscribe');

  const { email: fromEmail, name: fromName } = parseFromAddress(fromHeader);

  // Prefer Gmail's internalDate (ms since epoch) — it's the recipient-
  // side timestamp Gmail normalizes against; Date headers can lie.
  const receivedAt = (() => {
    if (raw.internalDate) {
      const ms = Number(raw.internalDate);
      if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
    }
    if (dateHeader) {
      const parsed = Date.parse(dateHeader);
      if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }
    return new Date().toISOString();
  })();

  const headersSlim: Record<string, string> = {};
  if (subjectHeader) headersSlim.subject = subjectHeader;
  if (fromHeader) headersSlim.from = fromHeader;
  if (toHeader) headersSlim.to = toHeader;
  if (dateHeader) headersSlim.date = dateHeader;
  if (messageIdHeader) headersSlim['message-id'] = messageIdHeader;
  if (listUnsub) headersSlim['list-unsubscribe'] = listUnsub;

  const attachments = collectAttachments(raw.payload);
  const bodyPreview = extractBodyPreview(raw);

  return {
    sourceId: raw.id,
    threadId: raw.threadId,
    historyId: raw.historyId ?? '',
    subject: subjectHeader,
    fromEmail,
    ...(fromName ? { fromName } : {}),
    toEmails: parseRecipients(toHeader),
    receivedAt,
    labels: raw.labelIds ?? [],
    bodyPreview,
    headers: headersSlim,
    attachments,
  };
}

export interface CreateGoogleMailProviderArgs {
  nango: NangoClient;
  log?: {
    debug?: (msg: string, ctx?: Record<string, unknown>) => void;
  };
}

export function createGoogleMailProvider(args: CreateGoogleMailProviderArgs): EmailProvider {
  const { nango, log } = args;

  // Cache label-name → id per connection so `addLabel`/`ensureLabel`
  // doesn't re-list on every call. Labels are effectively permanent
  // once created.
  const labelCache = new Map<string, Map<string, string>>();

  function getLabelCache(connectionId: string): Map<string, string> {
    let cache = labelCache.get(connectionId);
    if (!cache) {
      cache = new Map();
      labelCache.set(connectionId, cache);
    }
    return cache;
  }

  async function fetchFullBody(opts: FetchFullBodyArgs): Promise<FetchFullBodyResult> {
    try {
      // format=FULL returns the complete MIME tree with base64url-
      // encoded body data per part. The extraction worker pulls this
      // on-demand; the sync worker continues to use METADATA and the
      // 2KB preview. Body is held in a local variable by the caller
      // and never persisted.
      const data = await nango.proxy<RawMessage>({
        providerConfigKey: GOOGLE_MAIL_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'GET',
        endpoint: `/gmail/v1/users/me/messages/${encodeURIComponent(opts.messageId)}`,
        params: {
          format: 'FULL',
        },
      });

      const plain = findFirstTextPartWithCharset(data.payload, 'text/plain');
      const html = findFirstTextPartWithCharset(data.payload, 'text/html');

      const plainText = plain ? decodeBase64Url(plain.data) : '';
      const htmlText = html ? decodeBase64Url(html.data) : '';

      const bodyText = plainText || (htmlText ? stripHtml(htmlText) : '');
      const charset = plain?.charset ?? html?.charset;

      return {
        bodyText,
        ...(htmlText ? { bodyHtml: htmlText } : {}),
        ...(charset ? { charset } : {}),
      };
    } catch (err) {
      if (err instanceof EmailSyncError) throw err;
      classifyNangoError(err);
    }
  }

  async function fetchMessage(opts: FetchMessageArgs): Promise<EmailMessage> {
    try {
      // format=METADATA gives us headers + snippet without the full body.
      // We explicitly whitelist headers to bound the response size.
      const data = await nango.proxy<RawMessage>({
        providerConfigKey: GOOGLE_MAIL_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'GET',
        endpoint: `/gmail/v1/users/me/messages/${encodeURIComponent(opts.messageId)}`,
        params: {
          format: 'METADATA',
          metadataHeaders: ['Subject', 'From', 'To', 'Date', 'Message-Id', 'List-Unsubscribe'],
        },
      });
      const normalized = normalizeMessage(data);
      if (!normalized) {
        throw new EmailSyncError(`gmail returned message without id/threadId: ${opts.messageId}`);
      }
      return normalized;
    } catch (err) {
      if (err instanceof EmailSyncError) throw err;
      classifyNangoError(err);
    }
  }

  async function* listViaSearch(
    opts: ListRecentMessagesArgs,
    lastKnownHistoryId: string | undefined,
  ): AsyncIterable<ListRecentMessagesPage> {
    let pageToken: string | undefined;
    let iterationGuard = 0;
    let latestHistoryId = lastKnownHistoryId;

    while (true) {
      iterationGuard += 1;
      if (iterationGuard > 200) {
        throw new EmailSyncError('gmail pagination exceeded 200 pages; aborting');
      }

      const params: Record<string, string | number> = {
        maxResults: opts.maxResults ?? PAGE_SIZE,
        q: opts.query,
      };
      if (pageToken) params.pageToken = pageToken;

      let response: RawMessagesList;
      try {
        response = await nango.proxy<RawMessagesList>({
          providerConfigKey: GOOGLE_MAIL_PROVIDER_KEY,
          connectionId: opts.connectionId,
          method: 'GET',
          endpoint: '/gmail/v1/users/me/messages',
          params,
        });
      } catch (err) {
        classifyNangoError(err);
      }

      const ids = (response.messages ?? [])
        .map((m) => m.id)
        .filter((id): id is string => Boolean(id));
      const messages: EmailMessage[] = [];
      for (const id of ids) {
        const m = await fetchMessage({ connectionId: opts.connectionId, messageId: id });
        messages.push(m);
        if (m.historyId && (!latestHistoryId || m.historyId > latestHistoryId)) {
          latestHistoryId = m.historyId;
        }
      }

      log?.debug?.('gmail search page fetched', {
        connection_id: opts.connectionId,
        item_count: messages.length,
        has_next_page: Boolean(response.nextPageToken),
      });

      if (response.nextPageToken) {
        yield { messages };
        pageToken = response.nextPageToken;
        continue;
      }

      // Terminal page. Emit with the highest historyId we observed so
      // the caller can durably persist the cursor.
      yield {
        messages,
        ...(latestHistoryId ? { nextHistoryId: latestHistoryId } : {}),
      };
      return;
    }
  }

  async function* listViaHistory(
    opts: ListRecentMessagesArgs,
  ): AsyncIterable<ListRecentMessagesPage> {
    let pageToken: string | undefined;
    let iterationGuard = 0;
    let latestHistoryId: string | undefined;

    while (true) {
      iterationGuard += 1;
      if (iterationGuard > 200) {
        throw new EmailSyncError('gmail history pagination exceeded 200 pages; aborting');
      }

      const params: Record<string, string | number> = {
        startHistoryId: opts.afterHistoryId!,
        historyTypes: 'messageAdded',
      };
      if (pageToken) params.pageToken = pageToken;

      let response: RawHistoryList;
      try {
        response = await nango.proxy<RawHistoryList>({
          providerConfigKey: GOOGLE_MAIL_PROVIDER_KEY,
          connectionId: opts.connectionId,
          method: 'GET',
          endpoint: '/gmail/v1/users/me/history',
          params,
        });
      } catch (err) {
        classifyNangoError(err, { historyContext: true });
      }

      if (response.historyId) latestHistoryId = response.historyId;

      const addedIds = new Set<string>();
      for (const entry of response.history ?? []) {
        for (const added of entry.messagesAdded ?? []) {
          if (added.message?.id) addedIds.add(added.message.id);
        }
      }

      const messages: EmailMessage[] = [];
      for (const id of addedIds) {
        // Filter post-hoc using the query's newer_than / label filters by
        // re-fetching metadata. history.list does not accept a query.
        const m = await fetchMessage({ connectionId: opts.connectionId, messageId: id });
        messages.push(m);
      }

      log?.debug?.('gmail history page fetched', {
        connection_id: opts.connectionId,
        item_count: messages.length,
        has_next_page: Boolean(response.nextPageToken),
      });

      if (response.nextPageToken) {
        yield { messages };
        pageToken = response.nextPageToken;
        continue;
      }
      yield {
        messages,
        ...(latestHistoryId ? { nextHistoryId: latestHistoryId } : {}),
      };
      return;
    }
  }

  async function* listRecentMessages(
    opts: ListRecentMessagesArgs,
  ): AsyncIterable<ListRecentMessagesPage> {
    if (opts.afterHistoryId) {
      yield* listViaHistory(opts);
    } else {
      yield* listViaSearch(opts, undefined);
    }
  }

  async function fetchAttachment(opts: FetchAttachmentArgs): Promise<FetchAttachmentResult> {
    try {
      const data = await nango.proxy<RawAttachmentResponse>({
        providerConfigKey: GOOGLE_MAIL_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'GET',
        endpoint: `/gmail/v1/users/me/messages/${encodeURIComponent(opts.messageId)}/attachments/${encodeURIComponent(opts.attachmentId)}`,
      });
      if (!data.data) {
        throw new EmailSyncError('gmail returned attachment without data');
      }
      // Convert from base64url to standard base64 for storage.
      const b64 = data.data.replace(/-/g, '+').replace(/_/g, '/');
      return {
        contentBase64: b64,
        contentType: 'application/octet-stream',
        sizeBytes: data.size ?? 0,
      };
    } catch (err) {
      if (err instanceof EmailSyncError) throw err;
      classifyNangoError(err);
    }
  }

  async function watch(opts: WatchArgs): Promise<WatchResult> {
    try {
      const data = await nango.proxy<RawWatchResponse>({
        providerConfigKey: GOOGLE_MAIL_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'POST',
        endpoint: '/gmail/v1/users/me/watch',
        data: {
          topicName: opts.topicName,
          labelFilterBehavior: 'INCLUDE',
          labelIds: opts.labelIds ?? ['INBOX'],
        },
      });
      if (!data.historyId || !data.expiration) {
        throw new EmailSyncError('gmail users.watch response missing historyId/expiration');
      }
      return {
        historyId: data.historyId,
        expiration: new Date(Number(data.expiration)).toISOString(),
      };
    } catch (err) {
      if (err instanceof EmailSyncError) throw err;
      classifyNangoError(err);
    }
  }

  async function unwatch(opts: UnwatchArgs): Promise<void> {
    try {
      await nango.proxy({
        providerConfigKey: GOOGLE_MAIL_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'POST',
        endpoint: '/gmail/v1/users/me/stop',
      });
    } catch (err) {
      // 404 is benign — the watch already expired.
      if (err instanceof NangoError) {
        const status = (err.cause as { response?: { status?: number } } | undefined)?.response
          ?.status;
        if (status === 404) return;
      }
      classifyNangoError(err);
    }
  }

  async function ensureLabel(opts: EnsureLabelArgs): Promise<EnsureLabelResult> {
    const cache = getLabelCache(opts.connectionId);
    const cached = cache.get(opts.name);
    if (cached) return { labelId: cached };

    // List then create if missing.
    try {
      const list = await nango.proxy<RawLabelList>({
        providerConfigKey: GOOGLE_MAIL_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'GET',
        endpoint: '/gmail/v1/users/me/labels',
      });
      for (const l of list.labels ?? []) {
        if (l.name && l.id) cache.set(l.name, l.id);
      }
      const hit = cache.get(opts.name);
      if (hit) return { labelId: hit };

      const created = await nango.proxy<RawLabel>({
        providerConfigKey: GOOGLE_MAIL_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'POST',
        endpoint: '/gmail/v1/users/me/labels',
        data: {
          name: opts.name,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        },
      });
      if (!created.id) {
        throw new EmailSyncError('gmail labels.create response missing id');
      }
      cache.set(opts.name, created.id);
      return { labelId: created.id };
    } catch (err) {
      if (err instanceof EmailSyncError) throw err;
      classifyNangoError(err);
    }
  }

  async function createDraft(opts: CreateDraftArgs): Promise<CreateDraftResult> {
    if (!opts.to || opts.to.length === 0) {
      throw new EmailSyncError('createDraft: at least one recipient is required');
    }
    const subject = opts.subject?.trim() ?? '';
    const bodyText = opts.bodyMarkdown ?? '';

    const raw = buildRfc2822Message({
      to: opts.to,
      ...(opts.cc ? { cc: opts.cc } : {}),
      ...(opts.bcc ? { bcc: opts.bcc } : {}),
      subject,
      bodyText,
    });
    const encoded = Buffer.from(raw, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const message: Record<string, unknown> = { raw: encoded };
    if (opts.threadId) message.threadId = opts.threadId;

    try {
      const data = await nango.proxy<{
        id?: string;
        message?: { id?: string; threadId?: string };
      }>({
        providerConfigKey: GOOGLE_MAIL_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'POST',
        endpoint: '/gmail/v1/users/me/drafts',
        data: { message },
      });
      if (!data.id) {
        throw new EmailSyncError('gmail drafts.create response missing draft id');
      }
      const msg = data.message ?? {};
      return {
        draftId: data.id,
        threadId: msg.threadId ?? '',
        messageId: msg.id ?? '',
      };
    } catch (err) {
      if (err instanceof EmailSyncError) throw err;
      classifyNangoError(err);
    }
  }

  async function addLabel(opts: AddLabelArgs): Promise<void> {
    try {
      await nango.proxy({
        providerConfigKey: GOOGLE_MAIL_PROVIDER_KEY,
        connectionId: opts.connectionId,
        method: 'POST',
        endpoint: `/gmail/v1/users/me/messages/${encodeURIComponent(opts.messageId)}/modify`,
        data: { addLabelIds: [opts.labelId] },
      });
    } catch (err) {
      classifyNangoError(err);
    }
  }

  return {
    listRecentMessages,
    fetchMessage,
    fetchFullBody,
    fetchAttachment,
    watch,
    unwatch,
    addLabel,
    ensureLabel,
    createDraft,
  };
}

/**
 * Build an RFC-2822 message. Deliberately minimal — no MIME parts, no
 * HTML. Gmail renders bare newlines as line breaks. The agent's
 * markdown is dropped in as plain text; members can edit the draft in
 * Gmail before sending.
 *
 * Subject and recipient strings are untouched — Gmail accepts UTF-8 in
 * both. Address validation is the caller's responsibility (Zod at the
 * executor boundary).
 *
 * Exported for tests via `__internal`.
 */
export function buildRfc2822Message(args: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
}): string {
  const headers: string[] = [];
  headers.push(`To: ${args.to.join(', ')}`);
  if (args.cc && args.cc.length > 0) headers.push(`Cc: ${args.cc.join(', ')}`);
  if (args.bcc && args.bcc.length > 0) headers.push(`Bcc: ${args.bcc.join(', ')}`);
  headers.push(`Subject: ${args.subject}`);
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('MIME-Version: 1.0');
  return `${headers.join('\r\n')}\r\n\r\n${args.bodyText}`;
}

/** Exposed for tests — see google.test.ts. */
export const __internal = {
  normalizeMessage,
  parseFromAddress,
  parseRetryAfter,
  decodeBase64Url,
  truncateBytes,
  extractBodyPreview,
  collectAttachments,
  buildRfc2822Message,
};
