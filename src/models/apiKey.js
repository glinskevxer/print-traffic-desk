'use strict';

const crypto = require('crypto');
const { Schema } = require('mongoose');
const { basePlugin } = require('./plugins/base');
const { ROLES } = require('./operator');

/**
 * A key for a machine. A venue's own booking screen calls the desk at three in
 * the morning and there is nobody to type a password, so it gets a key.
 *
 * The secret is shown once, at the moment it is minted, and stored as a hash.
 * A key that can be read back out of the database is a key that leaks with a
 * database dump.
 */

const PREFIX_LENGTH = 8;
const SECRET_BYTES = 32;

/** The visible half identifies the key; the secret half proves it. */
function mintSecret() {
  const prefix = crypto.randomBytes(PREFIX_LENGTH / 2).toString('hex');
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  return { prefix, secret, presented: `pdk_${prefix}_${secret}` };
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/** Splits what a caller presented, without deciding whether it is any good. */
function readPresented(presented) {
  const match = /^pdk_([0-9a-f]{8})_([A-Za-z0-9_-]{20,})$/.exec(String(presented || ''));
  return match ? { prefix: match[1], secret: match[2] } : null;
}

const apiKeySchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  prefix: { type: String, required: true, maxlength: 16 },
  secretHash: { type: String, required: true, maxlength: 64, select: false },
  role: { type: String, required: true, enum: ROLES, default: 'viewer' },
  venue: { type: Schema.Types.ObjectId, ref: 'Venue', default: null },
  createdBy: { type: String, required: true, maxlength: 160 },
  expiresOn: { type: String, default: null, match: [/^\d{4}-\d{2}-\d{2}$/, 'ISO date'] },
  lastUsedAt: { type: Date, default: null },
  usedCount: { type: Number, default: 0, min: 0 },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: null, maxlength: 400 },
});

apiKeySchema.plugin(basePlugin, { prefix: 'key', hidden: ['secretHash'] });
apiKeySchema.index({ prefix: 1 }, { unique: true });
apiKeySchema.index({ revokedAt: 1, role: 1 });

apiKeySchema.methods.isLive = function isLive(today) {
  if (this.revokedAt !== null) return false;
  if (this.expiresOn && this.expiresOn < today) return false;
  return true;
};

/** Constant time, so a wrong key cannot be found a character at a time. */
apiKeySchema.methods.secretMatches = function secretMatches(secret) {
  const given = Buffer.from(hashSecret(secret), 'hex');
  const mine = Buffer.from(this.secretHash, 'hex');
  return given.length === mine.length && crypto.timingSafeEqual(given, mine);
};

/** An api key answers the same questions as an operator, so it looks like one. */
apiKeySchema.methods.asOperator = function asOperator() {
  return {
    publicId: this.publicId,
    email: `key:${this.name}`,
    name: this.name,
    role: this.role,
    venue: this.venue,
    isHouseBound: () => this.venue !== null && this.role !== 'admin',
  };
};

module.exports = {
  name: 'ApiKey',
  schema: apiKeySchema,
  collection: 'api_keys',
  mintSecret,
  hashSecret,
  readPresented,
  PREFIX_LENGTH,
};
