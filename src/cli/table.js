'use strict';

/**
 * Plain text tables for the reports the desk prints on a terminal.
 *
 * Columns are sized to the widest cell, numbers go right, everything else goes
 * left, and nothing wraps: a report that wraps is a report nobody reads in a
 * terminal, and the ones that are too wide are asked for as JSON instead.
 */

function widthsOf(headers, rows) {
  return headers.map((header, index) =>
    rows.reduce((widest, row) => Math.max(widest, String(row[index]).length), header.length),
  );
}

function pad(value, width, alignRight) {
  const text = String(value);
  return alignRight ? text.padStart(width) : text.padEnd(width);
}

/**
 * columns is a list of { header, pick, align }. The picker keeps formatting
 * next to the header it belongs to, the same way the CSV writer does.
 */
function table(rows, columns, { empty = 'nothing to report' } = {}) {
  if (rows.length === 0) return empty;

  const headers = columns.map((column) => column.header);
  const cells = rows.map((row) =>
    columns.map((column) => {
      const value = column.pick(row);
      return value === null || value === undefined ? '' : String(value);
    }),
  );
  const widths = widthsOf(headers, cells);

  const lines = [
    headers.map((header, i) => pad(header, widths[i], columns[i].align === 'right')).join('  '),
    widths.map((width) => '-'.repeat(width)).join('  '),
  ];
  for (const row of cells) {
    lines.push(row.map((cell, i) => pad(cell, widths[i], columns[i].align === 'right')).join('  '));
  }
  return lines.join('\n');
}

/** Minor units as a decimal, for a column that has to line up. */
function minor(amount, exponent = 2) {
  if (amount === null || amount === undefined) return '';
  if (exponent === 0) return String(amount);
  const sign = amount < 0 ? '-' : '';
  const digits = String(Math.abs(amount)).padStart(exponent + 1, '0');
  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

module.exports = { table, widthsOf, pad, minor };
