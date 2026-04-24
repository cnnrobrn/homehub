/**
 * AES-256-GCM helper for Google refresh/access tokens at rest.
 *
 * Keys live in `GOOGLE_TOKEN_ENCRYPTION_KEY_V{N}` env vars (base64 of 32
 * bytes). Rows carry `key_version`; at read time the helper resolves the
 * matching env var, decrypts, and returns the plaintext. Rotation =
 * provision V2, run a one-off re-encrypt job, retire V1. No schema
 * change needed.
 *
 * GCM provides both confidentiality and authenticity — the `authTag` is
 * verified at decrypt and any tampering (including ciphertext bit-flip
 * or wrong key) throws. We use a 12-byte random IV per encryption as
 * required for GCM safety (never reused under the same key).
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';

const IV_BYTES = 12;
const KEY_BYTES = 32;
const AUTH_TAG_BYTES = 16;

export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

export interface TokenCrypto {
  encrypt(plaintext: string): EncryptedBlob;
  decrypt(blob: Omit<EncryptedBlob, 'keyVersion'> & { keyVersion: number }): string;
  readonly activeKeyVersion: number;
}

export interface TokenCryptoConfig {
  /** Version to use when writing new rows. Must exist in `keysByVersion`. */
  activeKeyVersion: number;
  /** All known key versions (read side). Write uses `activeKeyVersion`. */
  keysByVersion: ReadonlyMap<number, Buffer>;
}

export function createTokenCrypto(config: TokenCryptoConfig): TokenCrypto {
  if (!config.keysByVersion.has(config.activeKeyVersion)) {
    throw new Error(
      `createTokenCrypto: activeKeyVersion=${config.activeKeyVersion} not present in keysByVersion`,
    );
  }
  for (const [version, key] of config.keysByVersion.entries()) {
    if (key.byteLength !== KEY_BYTES) {
      throw new Error(
        `createTokenCrypto: key version ${version} is ${key.byteLength} bytes; expected ${KEY_BYTES}`,
      );
    }
  }

  return {
    activeKeyVersion: config.activeKeyVersion,

    encrypt(plaintext) {
      const key = config.keysByVersion.get(config.activeKeyVersion);
      if (!key) {
        // Unreachable given the constructor invariant, but guard anyway.
        throw new Error(`encrypt: missing key for version ${config.activeKeyVersion}`);
      }
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv) as CipherGCM;
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return {
        ciphertext,
        iv,
        authTag: cipher.getAuthTag(),
        keyVersion: config.activeKeyVersion,
      };
    },

    decrypt(blob) {
      const key = config.keysByVersion.get(blob.keyVersion);
      if (!key) {
        throw new Error(
          `decrypt: no key configured for version ${blob.keyVersion}; is GOOGLE_TOKEN_ENCRYPTION_KEY_V${blob.keyVersion} set?`,
        );
      }
      if (blob.iv.byteLength !== IV_BYTES) {
        throw new Error(`decrypt: iv must be ${IV_BYTES} bytes; got ${blob.iv.byteLength}`);
      }
      if (blob.authTag.byteLength !== AUTH_TAG_BYTES) {
        throw new Error(
          `decrypt: authTag must be ${AUTH_TAG_BYTES} bytes; got ${blob.authTag.byteLength}`,
        );
      }
      const decipher = createDecipheriv('aes-256-gcm', key, blob.iv) as DecipherGCM;
      decipher.setAuthTag(blob.authTag);
      const plaintext = Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
      return plaintext.toString('utf8');
    },
  };
}

/**
 * Build a crypto helper from the runtime env. Scans for any
 * `GOOGLE_TOKEN_ENCRYPTION_KEY_V{N}` present and uses the highest
 * version number as the active one unless an explicit override is given.
 *
 * Throws if no key is configured at all — callers check
 * `isTokenCryptoConfigured` first if they want to degrade gracefully.
 */
export function createTokenCryptoFromEnv(
  env: Record<string, string | undefined>,
  opts?: { activeKeyVersion?: number },
): TokenCrypto {
  const keysByVersion = loadKeyMap(env);
  if (keysByVersion.size === 0) {
    throw new Error('createTokenCryptoFromEnv: no GOOGLE_TOKEN_ENCRYPTION_KEY_V{N} env var is set');
  }
  const activeKeyVersion = opts?.activeKeyVersion ?? Math.max(...keysByVersion.keys());
  return createTokenCrypto({ activeKeyVersion, keysByVersion });
}

export function isTokenCryptoConfigured(env: Record<string, string | undefined>): boolean {
  return loadKeyMap(env).size > 0;
}

function loadKeyMap(env: Record<string, string | undefined>): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const match = /^GOOGLE_TOKEN_ENCRYPTION_KEY_V(\d+)$/.exec(name);
    if (!match || !value) continue;
    const version = Number.parseInt(match[1] ?? '0', 10);
    if (!Number.isFinite(version) || version <= 0) continue;
    const decoded = Buffer.from(value, 'base64');
    if (decoded.byteLength !== KEY_BYTES) {
      throw new Error(
        `${name}: expected base64 of ${KEY_BYTES} bytes; decoded to ${decoded.byteLength} bytes`,
      );
    }
    keys.set(version, decoded);
  }
  return keys;
}
