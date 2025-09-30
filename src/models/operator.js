'use strict';

const crypto = require('crypto');
const { Schema } = require('mongoose');
const { basePlugin } = require('./plugins/base');

/**
 * Whoever works the desk. Roles are coarse on purpose: a repertory circuit has
 * a dozen people, and a permission matrix nobody maintains is worse than four
 * roles everybody understands.
 */
const ROLES = Object.freeze(['viewer', 'programmer', 'traffic', 'archivist', 'admin']);

const SCRYPT = Object.freeze({ keyLength: 64, cost: 16384, blockSize: 8, parallelism: 1 });

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, SCRYPT.keyLength, {
    N: SCRYPT.cost,
    r: SCRYPT.blockSize,
    p: SCRYPT.parallelism,
  });
  return `scrypt$${SCRYPT.cost}$${salt}$${derived.toString('hex')}`;
}

/** Constant time, so a wrong password cannot be timed character by character. */
function verifyPassword(password, stored) {
  const [scheme, cost, salt, expected] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;

  const derived = crypto.scryptSync(password, salt, SCRYPT.keyLength, {
    N: Number(cost),
    r: SCRYPT.blockSize,
    p: SCRYPT.parallelism,
  });
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (expectedBuffer.length !== derived.length) return false;
  return crypto.timingSafeEqual(derived, expectedBuffer);
}

const operatorSchema = new Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: [/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'not an email address'],
  },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  role: { type: String, required: true, enum: ROLES, default: 'viewer' },
  passwordHash: { type: String, required: true, maxlength: 300, select: false },
  venue: { type: Schema.Types.ObjectId, ref: 'Venue', default: null },
  active: { type: Boolean, default: true },
  lastSeenAt: { type: Date, default: null },
  failedAttempts: { type: Number, default: 0, min: 0 },
  lockedUntil: { type: Date, default: null },
});

operatorSchema.plugin(basePlugin, { prefix: 'op' });
operatorSchema.index({ email: 1 }, { unique: true });
operatorSchema.index({ role: 1, active: 1 });

operatorSchema.methods.setPassword = function setPassword(password) {
  this.passwordHash = hashPassword(password);
  return this;
};

operatorSchema.methods.passwordMatches = function passwordMatches(password) {
  return verifyPassword(password, this.passwordHash);
};

operatorSchema.methods.isLocked = function isLocked(now = new Date()) {
  return this.lockedUntil !== null && this.lockedUntil > now;
};

/** A venue operator only ever sees their own house. */
operatorSchema.methods.isHouseBound = function isHouseBound() {
  return this.venue !== null && this.role !== 'admin';
};

module.exports = {
  name: 'Operator',
  schema: operatorSchema,
  collection: 'operators',
  ROLES,
  hashPassword,
  verifyPassword,
  SCRYPT,
};
