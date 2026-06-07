'use strict';

const {
  REASONS,
  ALL_REASONS,
  isReason,
  needsDisposal,
  problemsWith,
  assertRetirable,
  describeRetirement,
} = require('../../../../src/domain/elements/retirement');
const { RuleRefusedError } = require('../../../../src/lib/errors');

const element = (overrides = {}) => ({ status: 'available', ...overrides });

const retirement = (overrides = {}) => ({
  element: element(),
  reason: REASONS.SHRUNK,
  retiredOn: '2026-06-01',
  ...overrides,
});

describe('taking a print out of the collection', () => {
  it('keeps the reasons a closed list', () => {
    expect(isReason('shrunk-beyond-use')).toBe(true);
    expect(isReason('did not like it')).toBe(false);
    expect(ALL_REASONS).toContain('deaccessioned');
    expect(Object.isFrozen(ALL_REASONS)).toBe(true);
  });

  it('accepts a straightforward retirement', () => {
    expect(problemsWith(retirement())).toEqual([]);
    expect(assertRetirable(retirement())).toBeTruthy();
  });

  it('refuses a reason nobody wrote down', () => {
    expect(problemsWith(retirement({ reason: 'because' }))).toEqual([
      'because is not a reason this archive retires a print for',
    ]);
  });

  it('refuses a print that is already retired', () => {
    expect(problemsWith(retirement({ element: element({ status: 'retired' }) }))).toContain(
      'that print is already retired',
    );
  });

  it('refuses a print that is out on loan', () => {
    expect(problemsWith(retirement({ element: element({ status: 'on-loan' }) }))).toContain(
      'that print is out, bring it home before retiring it',
    );
  });

  it('insists on the date it happened', () => {
    expect(problemsWith(retirement({ retiredOn: null }))).toContain(
      'a retirement needs the date it happened',
    );
  });

  it('knows which reasons need somebody to say where the film went', () => {
    expect(needsDisposal(REASONS.RETURNED)).toBe(true);
    expect(needsDisposal(REASONS.DEACCESSIONED)).toBe(true);
    expect(needsDisposal(REASONS.DESTROYED)).toBe(true);
    expect(needsDisposal(REASONS.LOST)).toBe(false);
    expect(needsDisposal(REASONS.SHRUNK)).toBe(false);
  });

  it('refuses a deaccession with no disposal record', () => {
    expect(problemsWith(retirement({ reason: REASONS.DEACCESSIONED }))).toContain(
      'deaccessioned needs a disposal saying where the film went',
    );
  });

  it('takes a deaccession with one', () => {
    const problems = problemsWith(
      retirement({
        reason: REASONS.DEACCESSIONED,
        disposal: { method: 'transferred', to: 'BFI National Archive', witness: 'R. Fitzgerald' },
      }),
    );

    expect(problems).toEqual([]);
  });

  it('refuses a transfer that does not say who it went to', () => {
    const problems = problemsWith(
      retirement({
        reason: REASONS.DEACCESSIONED,
        disposal: { method: 'transferred', witness: 'R. Fitzgerald' },
      }),
    );

    expect(problems).toContain('a transfer needs to say who it went to');
  });

  it('insists somebody witnessed the disposal', () => {
    const problems = problemsWith(
      retirement({ reason: REASONS.DESTROYED, disposal: { method: 'incinerated' } }),
    );

    expect(problems).toContain('a disposal needs the person who witnessed it');
  });

  it('refuses a way of disposing nobody does', () => {
    const problems = problemsWith(
      retirement({
        reason: REASONS.DESTROYED,
        disposal: { method: 'thrown in the canal', witness: 'A. Novak' },
      }),
    );

    expect(problems).toContain('thrown in the canal is not a way this archive disposes of film');
  });

  it('refuses a disposal on a reason that cannot have one', () => {
    const problems = problemsWith(
      retirement({
        reason: REASONS.LOST,
        disposal: { method: 'scrapped', witness: 'A. Novak' },
      }),
    );

    expect(problems).toContain('lost-in-transit does not take a disposal record');
  });

  it('says everything wrong at once', () => {
    const problems = problemsWith({
      element: element({ status: 'on-loan' }),
      reason: REASONS.DEACCESSIONED,
      retiredOn: null,
    });

    expect(problems).toHaveLength(3);
  });

  it('throws with every problem listed', () => {
    let caught;
    try {
      assertRetirable(retirement({ reason: REASONS.DEACCESSIONED }));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RuleRefusedError);
    expect(caught.details.problems).toHaveLength(1);
  });

  it('writes one line for the provenance', () => {
    expect(describeRetirement(retirement())).toBe('retired on 2026-06-01: shrunk-beyond-use');
    expect(
      describeRetirement(
        retirement({
          reason: REASONS.DEACCESSIONED,
          disposal: { method: 'transferred', to: 'BFI', witness: 'R. Fitzgerald' },
        }),
      ),
    ).toBe('retired on 2026-06-01: deaccessioned, transferred to BFI, witnessed by R. Fitzgerald');
  });
});
