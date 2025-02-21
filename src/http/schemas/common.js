'use strict';

const { z } = require('zod');
const { ALPHABET } = require('../../lib/ids');
const { ISO_DATE } = require('../../lib/dates');

const publicId = (prefix) =>
  z.string().regex(new RegExp(`^${prefix}_[${ALPHABET}]{16}$`), `expected a ${prefix} id`);

const isoDate = z.string().regex(ISO_DATE, 'expected YYYY-MM-DD');

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:mm');

const territory = z.string().regex(/^[A-Z]{2}$/, 'expected an ISO 3166-1 alpha-2 territory');

const licenceTerritory = z
  .string()
  .regex(/^([A-Z]{2}|EU|WORLD)$/, 'expected a territory code, EU or WORLD');

const currency = z.string().regex(/^[A-Z]{3}$/, 'expected an ISO 4217 currency');

const minorAmount = z.number().int().nonnegative();

const basisPoints = z.number().int().min(0).max(10000);

const barcode = z.string().regex(/^PE-[0-9]{6}$/, 'expected a PE- barcode');

const venueCode = z.string().regex(/^[A-Z]{2}-[A-Z]{2,4}-[A-Z0-9]{3,10}$/, 'expected a venue code');

/** Everything list shaped takes the same paging and ordering controls. */
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(400).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
});

const dateRange = z
  .object({ startsOn: isoDate, endsOn: isoDate })
  .refine((range) => range.startsOn <= range.endsOn, {
    message: 'the window ends before it starts',
    path: ['endsOn'],
  });

module.exports = {
  publicId,
  isoDate,
  localTime,
  territory,
  licenceTerritory,
  currency,
  minorAmount,
  basisPoints,
  barcode,
  venueCode,
  listQuery,
  dateRange,
};
