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

/**
 * Reading is harder than writing and the desk needs it for one thing: the
 * spreadsheet of houses an archive already keeps. A quoted field can contain
 * commas, newlines and doubled quotes, and every one of those turned up in the
 * first file somebody sent.
 */
function parseCsv(text, { header = true } = {}) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  // Whether this field was written quoted, which survives the closing quote:
  // a quoted field keeps its spaces and an unquoted one does not.
  let wasQuoted = false;

  const pushField = () => {
    row.push(wasQuoted ? field : field.trim());
    field = '';
    inQuotes = false;
    wasQuoted = false;
  };
  const pushRow = () => {
    pushField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];

    if (inQuotes) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.trim() === '') {
      inQuotes = true;
      wasQuoted = true;
      field = '';
    } else if (character === ',') {
      pushField();
    } else if (character === '\n') {
      pushRow();
    } else if (character !== '\r') {
      field += character;
    }
  }
  if (field !== '' || row.length > 0) pushRow();

  if (!header) return { headers: null, rows };

  const [headers, ...body] = rows;
  return {
    headers: headers ? headers.map((name) => name.trim()) : [],
    rows: body.map((values) =>
      Object.fromEntries((headers || []).map((name, index) => [name.trim(), values[index] ?? ''])),
    ),
  };
}

/** A cell that was left blank reads as nothing, not as an empty string. */
function blankToNull(value) {
  return value === undefined || String(value).trim() === '' ? null : String(value).trim();
}

module.exports = {
  toCsv,
  toRow,
  escapeCell,
  defuseFormula,
  minorToDecimal,
  parseCsv,
  blankToNull,
  NEEDS_QUOTING,
};
