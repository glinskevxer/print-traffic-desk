'use strict';

const {
  STATUSES,
  isStatus,
  transitionsFrom,
  canTransition,
  assertTransition,
  statusAfterVerdict,
  isTerminal,
  isCommitted,
} = require('../../../../src/domain/elements/status');
const { RuleRefusedError } = require('../../../../src/lib/errors');

describe('element status machine', () => {
  it('knows its own statuses', () => {
    expect(isStatus('available')).toBe(true);
    expect(isStatus('lost-in-the-post')).toBe(false);
    expect(STATUSES).toContain('quarantined');
  });

  it('lets a print go out and come back', () => {
    expect(canTransition('available', 'committed')).toBe(true);
    expect(canTransition('committed', 'in-transit')).toBe(true);
    expect(canTransition('in-transit', 'on-loan')).toBe(true);
    expect(canTransition('on-loan', 'in-transit')).toBe(true);
    expect(canTransition('in-transit', 'available')).toBe(true);
  });

  it('can quarantine from anywhere a print is circulating', () => {
    for (const status of ['intake', 'available', 'committed', 'in-transit', 'on-loan']) {
      expect(canTransition(status, 'quarantined')).toBe(true);
    }
  });

  it('will not let a print on loan become available without travelling', () => {
    expect(canTransition('on-loan', 'available')).toBe(false);

    expect(() => assertTransition('on-loan', 'available')).toThrow(/travel home/);
  });

  it('never brings a retired element back', () => {
    expect(transitionsFrom('retired')).toEqual([]);
    expect(isTerminal('retired')).toBe(true);

    expect(() => assertTransition('retired', 'available')).toThrow(/never comes back/);
  });

  it('explains why a quarantine will not simply be cleared', () => {
    let caught;
    try {
      assertTransition('quarantined', 'committed', { element: 'elem_1' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RuleRefusedError);
    expect(caught.details.allowed).toEqual(['available', 'retired']);
    expect(caught.details.element).toBe('elem_1');
  });

  it('treats a move to the same status as nothing to do', () => {
    expect(() => assertTransition('available', 'available')).not.toThrow();
  });

  it('refuses a status nobody has heard of', () => {
    expect(() => assertTransition('available', 'on-fire')).toThrow(/not an element status/);
    expect(() => assertTransition('melted', 'available')).toThrow(/not an element status/);
  });

  it('sends a quarantine verdict straight to quarantine', () => {
    expect(statusAfterVerdict('available', 'quarantine')).toBe('quarantined');
    expect(statusAfterVerdict('on-loan', 'quarantine')).toBe('quarantined');
  });

  it('releases an element that was in quarantine or intake', () => {
    expect(statusAfterVerdict('quarantined', 'projectable')).toBe('available');
    expect(statusAfterVerdict('intake', 'projectable-with-restrictions')).toBe('available');
  });

  it('leaves a circulating element where it is', () => {
    expect(statusAfterVerdict('committed', 'projectable')).toBe('committed');
    expect(statusAfterVerdict('on-loan', 'projectable')).toBe('on-loan');
  });

  it('knows which statuses hold an element against a date', () => {
    expect(isCommitted('committed')).toBe(true);
    expect(isCommitted('in-transit')).toBe(true);
    expect(isCommitted('on-loan')).toBe(true);
    expect(isCommitted('available')).toBe(false);
    expect(isCommitted('quarantined')).toBe(false);
  });
});
