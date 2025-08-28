'use strict';

const { z } = require('zod');
const { REGION_CODES } = require('../domain/rights/territories');
const { EXHIBITION_TYPES, TERM_KINDS } = require('../models/rightsWindow');
const { ALL_CODES, SEVERITIES } = require('../domain/condition/damageCodes');

/**
 * What the model is allowed to have said. Every enum here is the desk's own
 * vocabulary, so an answer naming a territory or a damage code that does not
 * exist is rejected before anything reads it. The model is helpful at reading
 * a contract and hopeless at knowing which words this desk uses.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const confidence = z.number().min(0).max(1);

/** Anything the model could not read stays a question rather than a guess. */
const unclear = z
  .array(
    z.object({
      field: z.string().min(1).max(60),
      why: z.string().min(1).max(300),
    }),
  )
  .max(30)
  .default([]);

const licenceTermsSchema = z
  .object({
    territory: z.string().regex(new RegExp(`^([A-Z]{2}|${REGION_CODES.join('|')})$`)),
    exhibitionTypes: z.array(z.enum(EXHIBITION_TYPES)).min(1).max(5),
    startsOn: isoDate,
    endsOn: isoDate,
    holdbackUntil: isoDate.nullable().default(null),
    maxScreenings: z.number().int().min(1).max(10000).nullable().default(null),
    maxScreeningsPerVenue: z.number().int().min(1).max(1000).nullable().default(null),
    exclusivity: z
      .object({
        scope: z.enum(['none', 'city', 'territory']).default('none'),
        heldByVenueCode: z.string().max(40).nullable().default(null),
      })
      .default({ scope: 'none', heldByVenueCode: null }),
    blackouts: z
      .array(
        z.object({
          startsOn: isoDate,
          endsOn: isoDate,
          reason: z.string().max(200).nullable().default(null),
        }),
      )
      .max(40)
      .default([]),
    terms: z.object({
      kind: z.enum(TERM_KINDS),
      currency: z.string().regex(/^[A-Z]{3}$/),
      flatFeeMinor: z.number().int().min(0).nullable().default(null),
      percentageBps: z.number().int().min(0).max(10000).nullable().default(null),
      minimumGuaranteeMinor: z.number().int().min(0).nullable().default(null),
      houseNutDeductible: z.boolean().default(false),
      capMinor: z.number().int().min(0).nullable().default(null),
    }),
    confidence,
    unclear,
  })
  .refine((extracted) => extracted.startsOn <= extracted.endsOn, {
    message: 'the licence ends before it starts',
    path: ['endsOn'],
  })
  .refine(
    (extracted) =>
      extracted.exclusivity.scope === 'none' || Boolean(extracted.exclusivity.heldByVenueCode),
    { message: 'an exclusive licence has to name the house', path: ['exclusivity'] },
  );

const inspectionNotesSchema = z.object({
  findings: z
    .array(
      z.object({
        reel: z.number().int().min(1).max(30),
        footageMark: z.number().int().min(0).max(60000).nullable().default(null),
        code: z.enum(ALL_CODES),
        severity: z.enum(SEVERITIES),
        note: z.string().max(400).nullable().default(null),
      }),
    )
    .max(400)
    .default([]),
  measurements: z
    .object({
      shrinkagePercent: z.number().min(0).max(10).nullable().default(null),
      adStripLevel: z.number().int().min(0).max(3).nullable().default(null),
      warpMillimetres: z.number().min(0).max(50).nullable().default(null),
    })
    .default({}),
  confidence,
  unclear,
});

const SCHEMAS = Object.freeze({
  'licence-terms': licenceTermsSchema,
  'inspection-notes': inspectionNotesSchema,
});

const EXTRACTION_KINDS = Object.freeze(Object.keys(SCHEMAS));

function schemaFor(kind) {
  const schema = SCHEMAS[kind];
  if (!schema) throw new TypeError(`${kind} is not something this desk extracts`);
  return schema;
}

module.exports = {
  licenceTermsSchema,
  inspectionNotesSchema,
  SCHEMAS,
  EXTRACTION_KINDS,
  schemaFor,
  isoDate,
  unclear,
};
