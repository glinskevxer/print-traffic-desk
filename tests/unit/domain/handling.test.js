'use strict';

const {
  RESTRICTIONS,
  ALL_RESTRICTIONS,
  isRestriction,
  mergeRestrictions,
  withoutRestrictions,
  blocksPublicExhibition,
  describe: describeRestriction,
} = require('../../../src/domain/handling');

describe('handling restrictions', () => {
  it('keeps the list closed and frozen', () => {
    expect(isRestriction('no-platter')).toBe(true);
    expect(isRestriction('be-careful')).toBe(false);
    expect(Object.isFrozen(ALL_RESTRICTIONS)).toBe(true);
  });

  it('merges two inspections without repeating a restriction', () => {
    const merged = mergeRestrictions(
      [RESTRICTIONS.NO_PLATTER],
      [RESTRICTIONS.NO_PLATTER, RESTRICTIONS.CHANGEOVER_ONLY],
    );

    expect(merged).toEqual([RESTRICTIONS.NO_PLATTER, RESTRICTIONS.CHANGEOVER_ONLY]);
  });

  it('keeps the declared order whatever order they arrived in', () => {
    const merged = mergeRestrictions([RESTRICTIONS.HAND_CARRY_ONLY], [RESTRICTIONS.NO_PLATTER]);

    expect(merged.indexOf(RESTRICTIONS.NO_PLATTER)).toBeLessThan(
      merged.indexOf(RESTRICTIONS.HAND_CARRY_ONLY),
    );
  });

  it('clears only the restrictions named', () => {
    const remaining = withoutRestrictions(
      [RESTRICTIONS.NO_PLATTER, RESTRICTIONS.NITRATE_BOOTH],
      [RESTRICTIONS.NO_PLATTER],
    );

    expect(remaining).toEqual([RESTRICTIONS.NITRATE_BOOTH]);
  });

  it('merging with nothing is a no-op', () => {
    expect(mergeRestrictions([RESTRICTIONS.NO_PLATTER])).toEqual([RESTRICTIONS.NO_PLATTER]);
    expect(mergeRestrictions()).toEqual([]);
  });

  it('spots the one restriction no public screening can satisfy', () => {
    expect(blocksPublicExhibition([RESTRICTIONS.NO_PUBLIC_EXHIBITION])).toBe(true);
    expect(blocksPublicExhibition([RESTRICTIONS.NO_PLATTER])).toBe(false);
    expect(blocksPublicExhibition()).toBe(false);
  });

  it('explains what each restriction demands', () => {
    expect(describeRestriction(RESTRICTIONS.NITRATE_BOOTH)).toMatch(/nitrate certificate/);
    expect(describeRestriction('invented')).toBeNull();
  });
});
