/**
 * Canonical email-message shape HomeHub stores in `app.email`.
 *
 * Provider-agnostic by design: Gmail today, Outlook / IMAP post-v1.
 * Fields below map directly to columns on `app.email` plus `metadata`
 * for provider-specific extras.
 *
 * Privacy rules (see `specs/03-integrations/google-workspace.md` and
 * `specs/09-security/data-retention.md`):
 *   - `bodyPreview` is capped at the provider's snippet (~2KB). We do
 *     NOT fetch the full body at sync time; the M4-B extraction worker
 *     pulls the full body on demand if it needs richer context.
 *   - Attachments are listed here (metadata only); the worker downloads
 *     and persists them into Supabase Storage with household RLS.
 *   - The ingestion worker only touches messages that match the
 *     member-opt-in category query. Everything else stays in Gmail
 *     untouched.
 */

export type EmailCategory = 'receipt' | 'reservation' | 'bill' | 'invite' | 'shipping';

export const ALL_EMAIL_CATEGORIES: readonly EmailCategory[] = [
  'receipt',
  'reservation',
  'bill',
  'invite',
  'shipping',
] as const;

export interface EmailAttachmentMeta {
  /** Gmail MIME part id; stable within the message. */
  partId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface EmailMessage {
  /** Gmail message id. Stable across history ids. */
  sourceId: string;
  /** Gmail thread id. */
  threadId: string;
  /** Snapshot of the Gmail mailbox historyId at fetch time. */
  historyId: string;
  subject: string;
  fromEmail: string;
  fromName?: string;
  /** All envelope recipients we can observe. */
  toEmails: string[];
  /** ISO-8601 with offset. Always populated; falls back to Date.now() if the Gmail header is malformed. */
  receivedAt: string;
  /** Provider labels applied to this message (Gmail label ids). */
  labels: string[];
  /** First ~2KB of the body (Gmail snippet + header scraps). Never the full body. */
  bodyPreview: string;
  /** Raw headers we care about (Subject, From, To, Date, Message-Id, List-Unsubscribe, …). */
  headers: Record<string, string>;
  attachments: EmailAttachmentMeta[];
}

export interface ListRecentMessagesArgs {
  connectionId: string;
  /**
   * When present: use Gmail's history.list for incremental delta. When
   * absent: use messages.list with `query`.
   */
  afterHistoryId?: string;
  /**
   * Gmail search syntax (e.g. `subject:(receipt OR order) newer_than:180d`).
   * Composed from the member's opt-in categories.
   */
  query: string;
  /** Cap per page; Gmail max is 500. Default 100. */
  maxResults?: number;
}

export interface ListRecentMessagesPage {
  messages: EmailMessage[];
  /** Present on the terminal page; store as the cursor for next delta. */
  nextHistoryId?: string;
}

export interface FetchMessageArgs {
  connectionId: string;
  messageId: string;
}

/**
 * Ephemeral full-body fetch for extraction. Distinct from
 * `fetchMessage`: the sync worker never calls this path, so the 2KB
 * body cap on `EmailMessage.bodyPreview` stays the source of truth for
 * what lands in `app.email`. Extractors call this on-demand, hold the
 * text in a local variable for the duration of the extraction, and let
 * it go out of scope — never persisted.
 *
 * Spec: `specs/03-integrations/google-workspace.md` § Storage of bodies.
 */
export interface FetchFullBodyArgs {
  connectionId: string;
  messageId: string;
}

export interface FetchFullBodyResult {
  /**
   * Plain-text body when the MIME tree contains a `text/plain` part;
   * otherwise an HTML-tag-stripped render of the `text/html` part.
   * Empty string when neither is present (e.g. calendar invite with
   * only an `.ics` attachment).
   */
  bodyText: string;
  /** Raw `text/html` body when present; omitted otherwise. */
  bodyHtml?: string;
  /** Charset label from the body part's Content-Type, when known. */
  charset?: string;
}

export interface FetchAttachmentArgs {
  connectionId: string;
  messageId: string;
  /** Gmail attachmentId from the message's part.body.attachmentId. */
  attachmentId: string;
}

export interface FetchAttachmentResult {
  /** base64url-decoded into standard base64. */
  contentBase64: string;
  contentType: string;
  sizeBytes: number;
}

export interface WatchArgs {
  connectionId: string;
  /**
   * Google Cloud Pub/Sub topic name Gmail pushes to.
   * Shape: `projects/<gcp-project>/topics/<topic>`.
   */
  topicName: string;
  /** Optional label ids; default: INBOX only (matches spec filter posture). */
  labelIds?: string[];
}

export interface WatchResult {
  historyId: string;
  /** ISO-8601. Gmail watch expires after ~7 days. */
  expiration: string;
}

export interface UnwatchArgs {
  connectionId: string;
}

export interface AddLabelArgs {
  connectionId: string;
  messageId: string;
  labelId: string;
}

export interface EnsureLabelArgs {
  connectionId: string;
  /** Human-readable name. Gmail auto-maps `HomeHub/Ingested` to a nested label. */
  name: string;
}

export interface EnsureLabelResult {
  labelId: string;
}

/**
 * Args for creating a draft message.
 *
 * Used by the M9-B `draft_message` / `propose_book_reservation` /
 * `cancel_subscription` / `reach_out` executors. The adapter composes
 * an RFC-2822 message, base64url-encodes it, and calls the provider's
 * drafts endpoint — the draft lands in the member's own Drafts folder
 * and is never auto-sent.
 *
 * `bodyMarkdown` is the body as the agent authored it. Gmail renders
 * plain text with bare newlines; we don't convert markdown here —
 * members can tidy the draft before sending.
 */
export interface CreateDraftArgs {
  connectionId: string;
  to: string[];
  subject: string;
  bodyMarkdown: string;
  /** Optional CC / BCC for reservation / settle-up style drafts. */
  cc?: string[];
  bcc?: string[];
  /**
   * When set, the draft is created within the supplied Gmail thread
   * (threading a reply). Absent for cold-start drafts.
   */
  threadId?: string;
}

export interface CreateDraftResult {
  /** Gmail draft id. */
  draftId: string;
  /** Gmail thread id (same as `message.threadId`). */
  threadId: string;
  /** Gmail message id of the draft's underlying message. */
  messageId: string;
}

/**
 * The narrow surface every mail-provider adapter must implement.
 * Workers depend on this interface, not on a concrete provider — so a
 * future Outlook adapter drops in without touching sync code.
 */
export interface EmailProvider {
  listRecentMessages(args: ListRecentMessagesArgs): AsyncIterable<ListRecentMessagesPage>;
  fetchMessage(args: FetchMessageArgs): Promise<EmailMessage>;
  /**
   * Ephemeral full-body fetch used by the M4-B extraction worker. Body
   * is never persisted by the sync layer; extractors hold it in a local
   * variable for the duration of extraction only.
   */
  fetchFullBody(args: FetchFullBodyArgs): Promise<FetchFullBodyResult>;
  fetchAttachment(args: FetchAttachmentArgs): Promise<FetchAttachmentResult>;
  watch(args: WatchArgs): Promise<WatchResult>;
  unwatch(args: UnwatchArgs): Promise<void>;
  addLabel(args: AddLabelArgs): Promise<void>;
  ensureLabel(args: EnsureLabelArgs): Promise<EnsureLabelResult>;
  /**
   * Create a draft message in the member's Drafts folder. Never sent —
   * the member reviews + sends from Gmail themselves. Used by the M9-B
   * `draft_message` executor family.
   */
  createDraft(args: CreateDraftArgs): Promise<CreateDraftResult>;
}
