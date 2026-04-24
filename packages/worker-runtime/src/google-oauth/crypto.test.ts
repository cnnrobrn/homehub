import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createTokenCrypto, createTokenCryptoFromEnv, isTokenCryptoConfigured } from './crypto.js';

function keyB64(): string {
  return randomBytes(32).toString('base64');
}

describe('createTokenCrypto', () => {
  it('round-trips plaintext through encrypt+decrypt', () => {
    const key = Buffer.from(keyB64(), 'base64');
    const crypto = createTokenCrypto({
      activeKeyVersion: 1,
      keysByVersion: new Map([[1, key]]),
    });
    const blob = crypto.encrypt('refresh-token-value');
    expect(blob.keyVersion).toBe(1);
    expect(crypto.decrypt(blob)).toBe('refresh-token-value');
  });

  it('fails decrypt when auth tag is corrupted', () => {
    const key = Buffer.from(keyB64(), 'base64');
    const crypto = createTokenCrypto({
      activeKeyVersion: 1,
      keysByVersion: new Map([[1, key]]),
    });
    const blob = crypto.encrypt('x');
    blob.authTag[0] = blob.authTag[0] === 0 ? 1 : 0;
    expect(() => crypto.decrypt(blob)).toThrow();
  });

  it('routes decrypt by key_version when multiple keys are present', () => {
    const k1 = Buffer.from(keyB64(), 'base64');
    const k2 = Buffer.from(keyB64(), 'base64');
    const cryptoV1 = createTokenCrypto({
      activeKeyVersion: 1,
      keysByVersion: new Map([
        [1, k1],
        [2, k2],
      ]),
    });
    const cryptoV2 = createTokenCrypto({
      activeKeyVersion: 2,
      keysByVersion: new Map([
        [1, k1],
        [2, k2],
      ]),
    });
    const blob1 = cryptoV1.encrypt('hello');
    const blob2 = cryptoV2.encrypt('world');
    expect(blob1.keyVersion).toBe(1);
    expect(blob2.keyVersion).toBe(2);
    // Either helper can read either blob — both have both keys.
    expect(cryptoV1.decrypt(blob2)).toBe('world');
    expect(cryptoV2.decrypt(blob1)).toBe('hello');
  });

  it('throws when active version is missing from the key map', () => {
    const key = Buffer.from(keyB64(), 'base64');
    expect(() =>
      createTokenCrypto({ activeKeyVersion: 2, keysByVersion: new Map([[1, key]]) }),
    ).toThrow(/activeKeyVersion=2/);
  });

  it('throws when a key is not 32 bytes', () => {
    expect(() =>
      createTokenCrypto({
        activeKeyVersion: 1,
        keysByVersion: new Map([[1, Buffer.from('tooshort')]]),
      }),
    ).toThrow(/32/);
  });
});

describe('createTokenCryptoFromEnv', () => {
  it('picks the highest available version as active', () => {
    const env = {
      GOOGLE_TOKEN_ENCRYPTION_KEY_V1: keyB64(),
      GOOGLE_TOKEN_ENCRYPTION_KEY_V2: keyB64(),
      OTHER_VAR: 'ignored',
    };
    const crypto = createTokenCryptoFromEnv(env);
    expect(crypto.activeKeyVersion).toBe(2);
  });

  it('throws when no key is set', () => {
    expect(() => createTokenCryptoFromEnv({})).toThrow(/no GOOGLE_TOKEN_ENCRYPTION_KEY_V/);
  });

  it('rejects a malformed key', () => {
    expect(() =>
      createTokenCryptoFromEnv({
        GOOGLE_TOKEN_ENCRYPTION_KEY_V1: Buffer.from('short').toString('base64'),
      }),
    ).toThrow(/32 bytes/);
  });
});

describe('isTokenCryptoConfigured', () => {
  it('reports true when at least one key is set', () => {
    expect(isTokenCryptoConfigured({ GOOGLE_TOKEN_ENCRYPTION_KEY_V1: keyB64() })).toBe(true);
    expect(isTokenCryptoConfigured({})).toBe(false);
  });
});
