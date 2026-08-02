'use strict';

const crypto = require('crypto');

/**
 * Crockford base32 without I, L, O and U so a handwritten booking reference
 * read off a fax cannot be mistyped into a different record.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_LENGTH = 16;

function encode(bytes) {
  let out = '';
  for (const byte of bytes) {
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

/** Opaque identifier for anything the desk stores outside of mongo's _id. */
function newId(prefix) {
  if (typeof prefix !== 'string' || !/^[a-z]{2,6}$/.test(prefix)) {
    throw new TypeError('id prefix must be two to six lower case letters');
  }
  return `${prefix}_${encode(crypto.randomBytes(ID_LENGTH))}`;
}

function isId(value, prefix) {
  if (typeof value !== 'string') return false;
  const pattern = new RegExp(`^${prefix}_[${ALPHABET}]{${ID_LENGTH}}$`);
  return pattern.test(value);
}

/**
 * Booking references are read aloud on the phone, so they stay short and carry
 * the screening year and day of year. The suffix is random, not sequential,
 * because two desks book at the same time and neither holds a counter.
 *
 * It takes the venue's local date, not the instant. A late screening in a zone
 * ahead of UTC falls on the next UTC day, and a 31 December show in Auckland
 * was getting next year's reference: the venue reads the date off their own
 * calendar and the reference has to match what they are looking at.
 */
function bookingReference(localDate, random = crypto.randomBytes(4)) {
  if (typeof localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new TypeError('a booking reference is made from the venue local date');
  }
  const [year, month, day] = localDate.split('-').map(Number);
  const startOfYear = Date.UTC(year, 0, 1);
  const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - startOfYear) / 86400000) + 1;

  return `BK-${year}-${String(dayOfYear).padStart(3, '0')}-${encode(random)}`;
}

const BOOKING_REFERENCE_PATTERN = new RegExp(`^BK-\\d{4}-\\d{3}-[${ALPHABET}]{4}$`);

function isBookingReference(value) {
  return typeof value === 'string' && BOOKING_REFERENCE_PATTERN.test(value);
}

/** Correlation id for one inbound request, propagated into every log line. */
function newRequestId() {
  return crypto.randomUUID();
}

module.exports = {
  ALPHABET,
  newId,
  isId,
  bookingReference,
  isBookingReference,
  BOOKING_REFERENCE_PATTERN,
  newRequestId,
};
