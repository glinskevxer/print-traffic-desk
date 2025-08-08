'use strict';

/**
 * Statements go to distributors as CSV because that is what their accounts
 * systems read. A dependency was not worth it for one writer, but the quoting
 * rules are worth getting right: a title with a comma in it broke a remittance
 * once and nobody noticed for a month.
 */

const NEEDS_QUOTING = /[",\r\n]/;

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (!NEEDS_QUOTING.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * A leading =, +, - or @ is read as a formula by every spreadsheet, so a venue
 * called "-Cinema" becomes an error cell. Prefixing with a quote is the
 * conventional defence and it survives a round trip.
 */
function defuseFormula(text) {
  if (typeof text !== 'string') return text;
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function toRow(values) {
  return values.map((value) => escapeCell(defuseFormula(value))).join(',');
}

/**
 * columns is a list of { header, pick }. Passing the picker rather than a key
 * keeps formatting decisions, like minor units to decimals, next to the header
 * they belong to.
 */
function toCsv(rows, columns, { withHeader = true, newline = '\r\n' } = {}) {
  const lines = [];
  if (withHeader) lines.push(toRow(columns.map((column) => column.header)));
  for (const row of rows) {
    lines.push(toRow(columns.map((column) => column.pick(row))));
  }
  return lines.join(newline) + (lines.length > 0 ? newline : '');
}

/** Turns minor units into the decimal string an accounts package expects. */
function minorToDecimal(amountMinor, exponent = 2) {
  if (amountMinor === null || amountMinor === undefined) return '';
  if (exponent === 0) return String(amountMinor);
  const sign = amountMinor < 0 ? '-' : '';
  const digits = String(Math.abs(amountMinor)).padStart(exponent + 1, '0');
  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

module.exports = { toCsv, toRow, escapeCell, defuseFormula, minorToDecimal, NEEDS_QUOTING };
