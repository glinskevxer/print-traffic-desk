'use strict';

const { table, widthsOf, pad, minor } = require('../../../src/cli/table');

const columns = [
  { header: 'title', pick: (row) => row.title },
  { header: 'screenings', pick: (row) => row.screenings, align: 'right' },
];

describe('printing a report on a terminal', () => {
  it('says so when there is nothing to print', () => {
    expect(table([], columns)).toBe('nothing to report');
    expect(table([], columns, { empty: 'no licences' })).toBe('no licences');
  });

  it('sizes a column to its widest cell', () => {
    expect(widthsOf(['title', 'n'], [['the-red-shoes', '4']])).toEqual([13, 1]);
    expect(widthsOf(['screenings'], [['4']])).toEqual([10]);
  });

  it('puts a rule under the headers', () => {
    const lines = table([{ title: 'daisies', screenings: 4 }], columns).split('\n');

    expect(lines[0]).toBe('title    screenings');
    expect(lines[1]).toBe('-------  ----------');
  });

  it('sends numbers right and everything else left', () => {
    const lines = table(
      [
        { title: 'daisies', screenings: 4 },
        { title: 'the-red-shoes', screenings: 12 },
      ],
      columns,
    ).split('\n');

    expect(lines[2]).toBe('daisies                 4');
    expect(lines[3]).toBe('the-red-shoes          12');
  });

  it('leaves a blank where there is nothing', () => {
    const lines = table([{ title: null, screenings: undefined }], columns).split('\n');

    expect(lines[2].trim()).toBe('');
  });

  it('pads to a width on the side it was told', () => {
    expect(pad('a', 4, false)).toBe('a   ');
    expect(pad('a', 4, true)).toBe('   a');
  });

  it('prints minor units so a column lines up', () => {
    expect(minor(123456)).toBe('1234.56');
    expect(minor(5)).toBe('0.05');
    expect(minor(-5)).toBe('-0.05');
    expect(minor(4200, 0)).toBe('4200');
    expect(minor(null)).toBe('');
  });
});
