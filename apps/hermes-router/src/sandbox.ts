/**
 * E2B sandbox client — spawns a fresh microVM per chat turn.
 *
 * Why E2B instead of Cloud Run Sandboxes?
 *   Cloud Run Sandboxes were announced at Next '26 but are still
 *   "coming soon." E2B ships today with the same shape (Firecracker
 *   microVMs, sub-second cold start, streaming stdout, per-sandbox
 *   filesystem). Migration to Cloud Run Sandboxes later is a swap of
 *   this file.
 *
 * Per-turn lifecycle:
 *   1. Sandbox.create("homehub-hermes", { envs }) — spawns a fresh VM
 *      from our custom template. ~150–500ms.
 *   2. Hydrate state: the sandbox's entrypoint curls a state.tar.gz
 *      out of Supabase Storage using the household-scoped JWT (RLS
 *      enforces the household's path prefix). 404 on first-ever turn
 *      is expected.
 *   3. Run `hermes chat -q ...` with onStdout streaming back to the
 *      caller — returned as a ReadableStream for the router to pipe
 *      into SSE.
 *   4. Persist state: run_turn.py tars ${HERMES_HOME} and PUTs it back
 *      to Supabase Storage.
 *   5. sandbox.kill(). VM is destroyed. No state inside E2B survives.
 *
 * The heavy lifting (hydrate/chat/persist) runs as a single shell
 * pipeline inside the sandbox to avoid three round-trips from the
 * router. The shell script is the same `/entrypoint.sh run-turn`
 * we already ship in the hermes-host image, now baked into the E2B
 * template.
 */

import { Sandbox } from 'e2b';

import type { RouterEnv } from './env.js';

export interface SandboxTurnInput {
  householdId: string;
  conversationId: string;
  turnId: string;
  memberId: string;
  memberRole: string;
  message: string;
  conversationHistoryJson?: string;
  /** Household-scoped Supabase JWT minted by the router for this turn.
   *  Replaces the service-role key inside the sandbox so cross-household
   *  reads from a buggy skill are blocked by RLS. */
  supabaseJwt: string;
}

export interface SandboxRunResult {
  stream: ReadableStream<Uint8Array>;
  /** Resolves with the sandbox exit code once the stream is fully
   *  drained. Rejects if the sandbox errored before producing output. */
  wait: () => Promise<number>;
}

export function buildSandboxTurnEnvs(
  env: RouterEnv,
  args: SandboxTurnInput,
): Record<string, string> {
  return {
    // E2B commands run as a non-root sandbox user even when the template
    // image was built from a root-based Dockerfile. Keep mutable Hermes
    // state under /tmp so the per-turn entrypoint can hydrate and persist it.
    HERMES_HOME: '/tmp/hermes',
    HERMES_SHARED_SECRET: env.HERMES_SHARED_SECRET,
    OPENROUTER_API_KEY: env.HOMEHUB_OPENROUTER_API_KEY,
    HERMES_DEFAULT_MODEL: env.HERMES_DEFAULT_MODEL,
    HERMES_TOOLSETS: env.HERMES_TOOLSETS,
    HOMEHUB_SUPABASE_URL: env.HOMEHUB_SUPABASE_URL,
    HOMEHUB_SUPABASE_ANON_KEY: env.HOMEHUB_SUPABASE_ANON_KEY,
    HOMEHUB_SUPABASE_JWT: args.supabaseJwt,
    HOUSEHOLD_ID: args.householdId,
    HOMEHUB_CONVERSATION_ID: args.conversationId,
    HOMEHUB_TURN_ID: args.turnId,
    HOMEHUB_MEMBER_ID: args.memberId,
    HOMEHUB_MEMBER_ROLE: args.memberRole,
    HOMEHUB_MEMBER_MESSAGE: args.message,
    ...(args.conversationHistoryJson
      ? { HOMEHUB_CONVERSATION_HISTORY: args.conversationHistoryJson }
      : {}),
    ...(env.HOMEHUB_TRIPADVISOR_API_KEY
      ? { TRIPADVISOR_API_KEY: env.HOMEHUB_TRIPADVISOR_API_KEY }
      : {}),
  };
}

export async function runSandboxedTurn(
  env: RouterEnv,
  args: {
    storagePath: string;
    storageBucket: string;
    turn: SandboxTurnInput;
  },
): Promise<SandboxRunResult> {
  // These env vars are passed into the sandbox at boot. The entrypoint
  // reads them to hydrate state from Supabase Storage, run the turn,
  // and persist a tarball back.
  const sandboxEnvs: Record<string, string> = {
    ...buildSandboxTurnEnvs(env, args.turn),
    HERMES_STORAGE_BUCKET: args.storageBucket,
    HERMES_STORAGE_PATH: args.storagePath,
  };

  const sandbox = await Sandbox.create(env.E2B_TEMPLATE, {
    apiKey: env.E2B_API_KEY,
    envs: sandboxEnvs,
    timeoutMs: env.HERMES_SANDBOX_TIMEOUT_SECONDS * 1000,
  });

  // Pipe stdout bytes through a ReadableStream so the router can stream
  // them to the browser as SSE without buffering the full response.
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
    async cancel() {
      await sandbox.kill().catch(() => {});
    },
  });

  const commandPromise = sandbox.commands.run('/entrypoint.sh run-turn', {
    // Pass the complete boot env again. E2B command env vars override
    // sandbox defaults, and keeping this explicit prevents a partial
    // per-command env from dropping history or Storage credentials.
    envs: sandboxEnvs,
    // E2B's per-command timeout defaults to 60s and is independent from
    // the sandbox lifetime. Mirror the sandbox timeout so a long turn
    // doesn't die at one minute while the VM is still alive.
    timeoutMs: env.HERMES_SANDBOX_TIMEOUT_SECONDS * 1000,
    onStdout: (data: string) => {
      streamController?.enqueue(new TextEncoder().encode(data));
    },
    onStderr: (data: string) => {
      // Don't leak stderr bytes back to the client — hermes chat
      // occasionally writes progress notes to stderr. Router logs
      // aggregate these separately in a follow-up.
      void data;
    },
  });
  // E2B resolves/rejects this promise when the command exits, while the
  // router is blocked reading the ReadableStream. Bridge that settlement
  // into the stream immediately; otherwise success deadlocks and failures
  // can become unhandled rejections before wait() is called.
  const settledCommandPromise = commandPromise.then(
    (result) => {
      streamController?.close();
      return result;
    },
    (err) => {
      streamController?.error(err);
      throw err;
    },
  );
  void settledCommandPromise.catch(() => {});

  const wait = async (): Promise<number> => {
    try {
      const result = await settledCommandPromise;
      await sandbox.kill().catch(() => {});
      return result.exitCode ?? 0;
    } catch (err) {
      await sandbox.kill().catch(() => {});
      throw err;
    }
  };

  return { stream, wait };
}
