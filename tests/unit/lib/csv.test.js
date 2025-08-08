'use strict';

const { toCsv, escapeCell, defuseFormula, minorToDecimal } = require('../../../src/lib/csv');

const columns = [
  { header: 'reference', pick: (row) => row.reference },
  { header: 'title', pick: (row) => row.title },
  { header: 'royalty', pick: (row) => minorToDecimal(row.royaltyMinor) },
];

describe('writing csv', () => {
  it('writes a header and a row per record', () => {
    const csv = toCsv([{ reference: 'BK-1', title: 'Daisies', royaltyMinor: 12345 }], columns);

    expect(csv).toBe('reference,title,royalty\r\nBK-1,Daisies,123.45\r\n');
  });

  it('leaves the header off when asked', () => {
    const csv = toCsv([{ reference: 'BK-1', title: 'x', royaltyMinor: 0 }], columns, {
      withHeader: false,
    });

    expect(csv).toBe('BK-1,x,0.00\r\n');
  });

  it('quotes a cell with a comma in it', () => {
    expect(escapeCell('Powell, Michael')).toBe('"Powell, Michael"');
  });

  it('doubles a quote inside a quoted cell', () => {
    expect(escapeCell('the "restored" print')).toBe('"the ""restored"" print"');
  });

  it('quotes a cell with a newline in it', () => {
    expect(escapeCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('leaves an ordinary cell alone', () => {
    expect(escapeCell('GB-LON-PRINCE')).toBe('GB-LON-PRINCE');
  });

  it('writes an empty cell for nothing', () => {
    expect(escapeCell(null)).toBe('');
    expect(escapeCell(undefined)).toBe('');
  });

  it('writes a date as an instant', () => {
    expect(escapeCell(new Date('2025-06-20T18:30:00Z'))).toBe('2025-06-20T18:30:00.000Z');
  });

  it('stops a spreadsheet reading a cell as a formula', () => {
    expect(defuseFormula('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(defuseFormula('-Cinema')).toBe("'-Cinema");
    expect(defuseFormula('+44 20 7000')).toBe("'+44 20 7000");
    expect(defuseFormula('Prince Charles')).toBe('Prince Charles');
  });

  it('does not defuse a number', () => {
    expect(defuseFormula(42)).toBe(42);
  });

  it('turns minor units into decimals at the right exponent', () => {
    expect(minorToDecimal(123456)).toBe('1234.56');
    expect(minorToDecimal(5)).toBe('0.05');
    expect(minorToDecimal(-5)).toBe('-0.05');
    expect(minorToDecimal(4200, 0)).toBe('4200');
    expect(minorToDecimal(null)).toBe('');
  });

  it('writes nothing at all for no rows and no header', () => {
    expect(toCsv([], columns, { withHeader: false })).toBe('');
  });

  it('writes just the header for no rows', () => {
    expect(toCsv([], columns)).toBe('reference,title,royalty\r\n');
  });

  it('escapes a formula and a comma together', () => {
    const csv = toCsv([{ reference: '=1+1', title: 'a, b', royaltyMinor: 1 }], columns, {
      withHeader: false,
    });

    expect(csv).toBe('\'=1+1,"a, b",0.01\r\n');
  });
});
