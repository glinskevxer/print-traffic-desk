'use strict';

const { hashPassword, verifyPassword, SCRYPT } = require('../../../src/models/operator');

describe('operator passwords', () => {
  it('stores a scheme, a cost, a salt and the derived key', () => {
    const stored = hashPassword('a-long-enough-passphrase');
    const [scheme, cost, salt, derived] = stored.split('$');

    expect(scheme).toBe('scrypt');
    expect(Number(cost)).toBe(SCRYPT.cost);
    expect(salt).toHaveLength(32);
    expect(derived).toHaveLength(SCRYPT.keyLength * 2);
  });

  it('salts every password separately', () => {
    expect(hashPassword('same passphrase')).not.toBe(hashPassword('same passphrase'));
  });

  it('accepts the right password', () => {
    const stored = hashPassword('projectionist-2025');

    expect(verifyPassword('projectionist-2025', stored)).toBe(true);
  });

  it('refuses the wrong password', () => {
    const stored = hashPassword('projectionist-2025');

    expect(verifyPassword('projectionist-2024', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  it('refuses anything that is not a stored hash', () => {
    expect(verifyPassword('x', 'plaintext')).toBe(false);
    expect(verifyPassword('x', 'scrypt$16384$onlysalt')).toBe(false);
    expect(verifyPassword('x', undefined)).toBe(false);
  });

  it('verifies against the cost the hash was made with', () => {
    const stored = hashPassword('a passphrase', 'deadbeefdeadbeefdeadbeefdeadbeef');

    expect(verifyPassword('a passphrase', stored)).toBe(true);
  });

  it('never puts the password in the stored value', () => {
    const stored = hashPassword('the-secret-passphrase');

    expect(stored).not.toContain('the-secret-passphrase');
  });
});
