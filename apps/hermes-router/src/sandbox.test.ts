import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSandboxMock = vi.hoisted(() => vi.fn());
const commandRunMock = vi.hoisted(() => vi.fn());
const sandboxKillMock = vi.hoisted(() => vi.fn());

vi.mock('e2b', () => ({
  Sandbox: {
    create: createSandboxMock,
  },
}));

import { buildSandboxTurnEnvs, runSandboxedTurn, type SandboxTurnInput } from './sandbox.js';

import type { RouterEnv } from './env.js';

const env = {
  E2B_API_KEY: 'e2b-key',
  E2B_TEMPLATE: 'homehub-hermes',
  HERMES_SANDBOX_TIMEOUT_SECONDS: 60,
  HERMES_SHARED_SECRET: 'shared',
  HOMEHUB_OPENROUTER_API_KEY: 'openrouter-key',
  HERMES_DEFAULT_MODEL: 'deepseek/deepseek-v4-pro',
  HERMES_TOOLSETS: 'skills,terminal',
  HOMEHUB_SUPABASE_URL: 'https://supabase.test',
  HOMEHUB_SUPABASE_ANON_KEY: 'anon-key',
} as RouterEnv;

const turn: SandboxTurnInput = {
  householdId: 'household-1',
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  memberId: 'member-1',
  memberRole: 'adult',
  message: '10k, 8k',
  conversationHistoryJson: JSON.stringify([
    {
      role: 'member',
      body_md: 'build me a budget',
      created_at: '2026-04-23T10:00:00.000Z',
    },
    {
      role: 'assistant',
      body_md: 'What is your monthly take-home pay and monthly bills?',
      created_at: '2026-04-23T10:01:00.000Z',
    },
  ]),
  supabaseJwt: 'household-jwt',
};

describe('sandbox env assembly', () => {
  beforeEach(() => {
    createSandboxMock.mockReset();
    commandRunMock.mockReset();
    sandboxKillMock.mockReset();
    commandRunMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    sandboxKillMock.mockResolvedValue(undefined);
    createSandboxMock.mockResolvedValue({
      commands: {
        run: commandRunMock,
      },
      kill: sandboxKillMock,
    });
  });

  it('includes the current message and same-thread history in the turn env', () => {
    const envs = buildSandboxTurnEnvs(env, turn);

    expect(envs.HOMEHUB_MEMBER_MESSAGE).toBe('10k, 8k');
    expect(envs.HERMES_TOOLSETS).toBe('skills,terminal');
    expect(envs.HOMEHUB_CONVERSATION_HISTORY).toContain('build me a budget');
    expect(envs.HOMEHUB_CONVERSATION_HISTORY).toContain('monthly take-home pay');
  });

  it('forwards HOMEHUB_TRIPADVISOR_API_KEY as TRIPADVISOR_API_KEY when set', () => {
    const envs = buildSandboxTurnEnvs(
      { ...env, HOMEHUB_TRIPADVISOR_API_KEY: 'ta-key' } as RouterEnv,
      turn,
    );
    expect(envs.TRIPADVISOR_API_KEY).toBe('ta-key');
  });

  it('omits TRIPADVISOR_API_KEY when the router env is not configured', () => {
    const envs = buildSandboxTurnEnvs(env, turn);
    expect(envs.TRIPADVISOR_API_KEY).toBeUndefined();
  });

  it('passes the full per-turn env at sandbox boot and command execution', async () => {
    const result = await runSandboxedTurn(env, {
      storageBucket: 'hermes-state',
      storagePath: 'household-1/state.tar.gz',
      turn,
    });
    await result.wait();

    expect(createSandboxMock).toHaveBeenCalledWith(
      'homehub-hermes',
      expect.objectContaining({
        envs: expect.objectContaining({
          HOMEHUB_MEMBER_MESSAGE: '10k, 8k',
          HOMEHUB_CONVERSATION_HISTORY: expect.stringContaining('build me a budget'),
          HERMES_STORAGE_PATH: 'household-1/state.tar.gz',
          HERMES_TOOLSETS: 'skills,terminal',
        }),
      }),
    );
    expect(commandRunMock).toHaveBeenCalledWith(
      '/entrypoint.sh run-turn',
      expect.objectContaining({
        envs: expect.objectContaining({
          HOMEHUB_MEMBER_MESSAGE: '10k, 8k',
          HOMEHUB_CONVERSATION_HISTORY: expect.stringContaining('build me a budget'),
          HERMES_STORAGE_PATH: 'household-1/state.tar.gz',
          OPENROUTER_API_KEY: 'openrouter-key',
          HERMES_TOOLSETS: 'skills,terminal',
        }),
      }),
    );
  });
});
