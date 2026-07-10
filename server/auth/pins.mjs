import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const PIN_SCRYPT_KEYLEN = 32;
const PIN_SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const safeSecretEqual = (actual, expected) => {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
};

const hashLegacyPin = (pin) => createHash('sha256')
  .update(`${pin}becoartes_salt_2024`)
  .digest('hex');

export const hashPin = (pin, salt = randomBytes(16).toString('hex')) => {
  const hash = scryptSync(String(pin || ''), salt, PIN_SCRYPT_KEYLEN, PIN_SCRYPT_OPTIONS).toString('hex');
  return `scrypt:${salt}:${hash}`;
};

export const verifyPin = (pin, storedPin = '') => {
  const normalized = String(storedPin || '').trim();
  const scryptMatch = /^scrypt:([a-f0-9]{32}):([a-f0-9]{64})$/i.exec(normalized);
  if (scryptMatch) {
    try {
      const actual = scryptSync(String(pin || ''), scryptMatch[1], PIN_SCRYPT_KEYLEN, PIN_SCRYPT_OPTIONS);
      const expected = Buffer.from(scryptMatch[2], 'hex');
      return {
        ok: actual.length === expected.length && timingSafeEqual(actual, expected),
        needsRehash: false,
      };
    } catch {
      return { ok: false, needsRehash: false };
    }
  }
  if (/^\d{4,8}$/.test(normalized)) {
    const ok = safeSecretEqual(pin, normalized);
    return { ok, needsRehash: ok };
  }
  if (/^[a-f0-9]{64}$/i.test(normalized)) {
    const ok = safeSecretEqual(hashLegacyPin(pin), normalized.toLowerCase());
    return { ok, needsRehash: ok };
  }
  return { ok: false, needsRehash: false };
};

export const normalizeStoredPin = (storedPin) => {
  const normalized = String(storedPin || '').trim();
  if (/^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/i.test(normalized)) return normalized;
  if (/^[a-f0-9]{64}$/i.test(normalized)) return normalized.toLowerCase();
  if (/^\d{4,8}$/.test(normalized)) return hashPin(normalized);
  return '';
};

export const isReservedSellerPin = (pin) => String(pin || '').trim() === '1234';
