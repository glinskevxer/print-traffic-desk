'use strict';

const { RuleRefusedError } = require('../../lib/errors');

/**
 * A print moves through a small number of states and the desk refuses anything
 * else. The rule that matters is that quarantine is reachable from everywhere
 * and only an inspection gets an element out of it.
 */

const STATUSES = Object.freeze([
  'intake',
  'available',
  'committed',
  'in-transit',
  'on-loan',
  'quarantined',
  'retired',
]);

const TRANSITIONS = Object.freeze({
  intake: ['available', 'quarantined', 'retired'],
  available: ['committed', 'in-transit', 'quarantined', 'retired'],
  committed: ['in-transit', 'available', 'quarantined'],
  'in-transit': ['on-loan', 'available', 'quarantined'],
  'on-loan': ['in-transit', 'quarantined'],
  quarantined: ['available', 'retired'],
  retired: [],
});

const TERMINAL = Object.freeze(['retired']);

/** Why each move is allowed, printed back to whoever asked for a bad one. */
const TRANSITION_NOTES = Object.freeze({
  'quarantined->available': 'only an inspection with a projectable verdict releases a quarantine',
  'retired->': 'a retired element never comes back, catalogue a new one',
  'on-loan->available': 'a print on loan has to travel home before it is available',
});

function isStatus(value) {
  return STATUSES.includes(value);
}

function transitionsFrom(status) {
  return TRANSITIONS[status] || [];
}

function canTransition(from, to) {
  return transitionsFrom(from).includes(to);
}

function assertTransition(from, to, context = {}) {
  if (!isStatus(from)) throw new RuleRefusedError(`${from} is not an element status`, context);
  if (!isStatus(to)) throw new RuleRefusedError(`${to} is not an element status`, context);
  if (from === to) return;
  if (canTransition(from, to)) return;

  const note = TRANSITION_NOTES[`${from}->${to}`] || TRANSITION_NOTES[`${from}->`];
  throw new RuleRefusedError(
    note || `a print cannot go from ${from} to ${to}`,
    { ...context, from, to, allowed: transitionsFrom(from) },
  );
}

/** What an inspection verdict does to the element it was written against. */
function statusAfterVerdict(currentStatus, verdict) {
  if (verdict === 'quarantine') return 'quarantined';
  if (currentStatus === 'quarantined' || currentStatus === 'intake') return 'available';
  return currentStatus;
}

function isTerminal(status) {
  return TERMINAL.includes(status);
}

/** Statuses that hold an element against a date, so it cannot be booked twice. */
function isCommitted(status) {
  return ['committed', 'in-transit', 'on-loan'].includes(status);
}

module.exports = {
  STATUSES,
  TRANSITIONS,
  TERMINAL,
  isStatus,
  transitionsFrom,
  canTransition,
  assertTransition,
  statusAfterVerdict,
  isTerminal,
  isCommitted,
};
