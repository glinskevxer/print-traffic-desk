'use strict';

const { version } = require('../../package.json');
const { GAUGES, SOUND_FORMATS, BASE_STOCKS, ELEMENT_KINDS } = require('../domain/formats');
const { ALL_RESTRICTIONS } = require('../domain/handling');
const { ALL_CODES, SEVERITIES } = require('../domain/condition/damageCodes');
const { STATUSES } = require('../domain/elements/status');
const { REGION_CODES } = require('../domain/rights/territories');
const { EXHIBITION_TYPES, TERM_KINDS, WINDOW_STATUSES } = require('../models/rightsWindow');
const { BOOKING_STATUSES } = require('../models/booking');
const { SHIPMENT_STATUSES } = require('../models/shipment');
const { STATEMENT_STATUSES } = require('../models/royaltyStatement');
const { ROLES } = require('../models/operator');

/**
 * The description of the API, built from the same constants the code enforces.
 * A hand written spec drifts within a month; this one cannot say a gauge the
 * desk does not run, because it reads the list the validator reads.
 */

const ERROR_CODES = [
  'validation_failed',
  'not_found',
  'conflict',
  'unprocessable',
  'not_authenticated',
  'forbidden',
  'rate_limited',
  'upstream_failed',
  'internal_error',
];

function errorResponse(description) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
      },
    },
  };
}

function jsonResponse(description, schema) {
  return { description, content: { 'application/json': { schema } } };
}

const COMMON_ERRORS = {
  400: errorResponse('the request is not acceptable'),
  401: errorResponse('no operator token, or one this desk did not issue'),
  403: errorResponse('the operator may not do that'),
  404: errorResponse('no such record'),
  409: errorResponse('that would contradict something already recorded'),
  422: errorResponse('the desk rules refuse it'),
  429: errorResponse('too many requests'),
};

function pagedResponse(itemSchema) {
  return jsonResponse('a page of results', {
    type: 'object',
    required: ['items', 'page'],
    properties: {
      items: { type: 'array', items: itemSchema },
      page: {
        type: 'object',
        properties: {
          hasMore: { type: 'boolean' },
          nextCursor: { type: ['string', 'null'] },
        },
      },
    },
  });
}

const LIST_PARAMETERS = [
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  },
  { name: 'cursor', in: 'query', schema: { type: 'string' } },
  { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
];

function idParameter(name, prefix) {
  return {
    name,
    in: 'path',
    required: true,
    schema: { type: 'string', pattern: `^${prefix}_[0-9A-Z]{16}$` },
  };
}

function schemas() {
  return {
    Error: {
      type: 'object',
      required: ['error'],
      properties: {
        error: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string', enum: ERROR_CODES },
            message: { type: 'string' },
            details: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    Title: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        slug: { type: 'string' },
        title: { type: 'string' },
        year: { type: 'integer', minimum: 1888 },
        runtimeMinutes: { type: 'integer' },
        status: { type: 'string', enum: ['draft', 'bookable', 'withdrawn'] },
        directors: { type: 'array', items: { type: 'string' } },
      },
    },
    Venue: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        code: { type: 'string' },
        name: { type: 'string' },
        territory: { type: 'string' },
        timezone: { type: 'string' },
        seats: { type: 'integer' },
        booth: {
          type: 'object',
          properties: {
            gauges: { type: 'array', items: { type: 'string', enum: GAUGES } },
            soundFormats: { type: 'array', items: { type: 'string', enum: SOUND_FORMATS } },
            nitrateCertified: { type: 'boolean' },
            reelCapacity: { type: 'integer' },
          },
        },
      },
    },
    PrintElement: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        barcode: { type: 'string', pattern: '^PE-[0-9]{6}$' },
        kind: { type: 'string', enum: ELEMENT_KINDS },
        gauge: { type: 'string', enum: GAUGES },
        baseStock: { type: 'string', enum: BASE_STOCKS },
        soundFormat: { type: 'string', enum: SOUND_FORMATS },
        status: { type: 'string', enum: STATUSES },
        conditionGrade: { type: ['string', 'null'], enum: ['A', 'B', 'C', 'D', null] },
        handlingRestrictions: { type: 'array', items: { type: 'string', enum: ALL_RESTRICTIONS } },
      },
    },
    InspectionReport: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        inspector: { type: 'string' },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              reel: { type: 'integer' },
              code: { type: 'string', enum: ALL_CODES },
              severity: { type: 'string', enum: SEVERITIES },
            },
          },
        },
        assessment: {
          type: 'object',
          properties: {
            grade: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
            verdict: {
              type: 'string',
              enum: ['projectable', 'projectable-with-restrictions', 'quarantine'],
            },
            reasons: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    RightsWindow: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        territory: { type: 'string' },
        exhibitionTypes: { type: 'array', items: { type: 'string', enum: EXHIBITION_TYPES } },
        startsOn: { type: 'string', format: 'date' },
        endsOn: { type: 'string', format: 'date' },
        status: { type: 'string', enum: WINDOW_STATUSES },
        terms: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: TERM_KINDS },
            currency: { type: 'string' },
            flatFeeMinor: { type: ['integer', 'null'] },
            percentageBps: { type: ['integer', 'null'] },
          },
        },
      },
    },
    ClearanceDecision: {
      type: 'object',
      properties: {
        cleared: { type: 'boolean' },
        windowId: { type: ['string', 'null'] },
        refusalCodes: { type: 'array', items: { type: 'string' } },
        refusals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              window: { type: 'string' },
              code: { type: 'string' },
              detail: { type: 'string' },
            },
          },
        },
      },
    },
    Booking: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        reference: { type: 'string', pattern: '^BK-\\d{4}-\\d{3}-[0-9A-Z]{4}$' },
        localDate: { type: 'string', format: 'date' },
        localTime: { type: 'string' },
        status: { type: 'string', enum: BOOKING_STATUSES },
        royaltyMinor: { type: ['integer', 'null'] },
      },
    },
    Shipment: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        leg: { type: 'string', enum: ['outbound', 'return', 'transfer'] },
        status: { type: 'string', enum: SHIPMENT_STATUSES },
        plannedDispatchOn: { type: 'string', format: 'date' },
        plannedArrivalOn: { type: 'string', format: 'date' },
      },
    },
    RoyaltyStatement: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        periodStartsOn: { type: 'string', format: 'date' },
        periodEndsOn: { type: 'string', format: 'date' },
        currency: { type: 'string' },
        totalMinor: { type: 'integer' },
        status: { type: 'string', enum: STATEMENT_STATUSES },
      },
    },
    ExtractionJob: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        kind: { type: 'string', enum: ['licence-terms', 'inspection-notes'] },
        status: { type: 'string' },
        confidence: { type: ['number', 'null'] },
        needsHumanReview: { type: 'boolean' },
        costUsd: { type: 'string' },
      },
    },
    Operator: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        email: { type: 'string', format: 'email' },
        role: { type: 'string', enum: ROLES },
        active: { type: 'boolean' },
      },
    },
  };
}

function paths() {
  const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

  return {
    '/health/live': {
      get: {
        tags: ['health'],
        summary: 'the process is up',
        security: [],
        responses: { 200: jsonResponse('alive', { type: 'object' }) },
      },
    },
    '/health/ready': {
      get: {
        tags: ['health'],
        summary: 'the desk can serve',
        security: [],
        responses: {
          200: jsonResponse('ready', { type: 'object' }),
          503: jsonResponse('not ready', { type: 'object' }),
        },
      },
    },
    '/auth/sign-in': {
      post: {
        tags: ['auth'],
        summary: 'exchange an email and password for a session token',
        security: [],
        responses: { 200: jsonResponse('a session', { type: 'object' }), ...COMMON_ERRORS },
      },
    },
    '/auth/me': {
      get: {
        tags: ['auth'],
        summary: 'who the token belongs to',
        responses: { 200: jsonResponse('the operator', ref('Operator')), ...COMMON_ERRORS },
      },
    },
    '/titles': {
      get: {
        tags: ['catalogue'],
        summary: 'the film works the desk books',
        parameters: [
          ...LIST_PARAMETERS,
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'year', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: pagedResponse(ref('Title')), ...COMMON_ERRORS },
      },
      post: {
        tags: ['catalogue'],
        summary: 'catalogue a film work',
        responses: { 201: jsonResponse('the title', ref('Title')), ...COMMON_ERRORS },
      },
    },
    '/titles/{titleId}': {
      get: {
        tags: ['catalogue'],
        summary: 'one film work',
        parameters: [idParameter('titleId', 'ttl')],
        responses: { 200: jsonResponse('the title', ref('Title')), ...COMMON_ERRORS },
      },
    },
    '/venues': {
      get: {
        tags: ['catalogue'],
        summary: 'the houses the desk ships to',
        parameters: [
          ...LIST_PARAMETERS,
          { name: 'gauge', in: 'query', schema: { type: 'string', enum: GAUGES } },
        ],
        responses: { 200: pagedResponse(ref('Venue')), ...COMMON_ERRORS },
      },
    },
    '/elements': {
      get: {
        tags: ['shelf'],
        summary: 'the physical prints',
        parameters: [
          ...LIST_PARAMETERS,
          { name: 'status', in: 'query', schema: { type: 'string', enum: STATUSES } },
          { name: 'needsInspection', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { 200: pagedResponse(ref('PrintElement')), ...COMMON_ERRORS },
      },
    },
    '/elements/{elementId}/inspections': {
      post: {
        tags: ['shelf'],
        summary: 'file a condition report and move the print with it',
        parameters: [idParameter('elementId', 'elem')],
        responses: {
          201: jsonResponse('the report', ref('InspectionReport')),
          ...COMMON_ERRORS,
        },
      },
    },
    '/rights-windows': {
      get: {
        tags: ['rights'],
        summary: 'the licences on file',
        parameters: [
          ...LIST_PARAMETERS,
          {
            name: 'territory',
            in: 'query',
            schema: { type: 'string', enum: [...REGION_CODES, 'GB', 'FR', 'DE'] },
          },
        ],
        responses: { 200: pagedResponse(ref('RightsWindow')), ...COMMON_ERRORS },
      },
      post: {
        tags: ['rights'],
        summary: 'write a licence as a draft',
        responses: { 201: jsonResponse('the licence', ref('RightsWindow')), ...COMMON_ERRORS },
      },
    },
    '/clearance': {
      get: {
        tags: ['rights'],
        summary: 'could this house show this title on this date',
        parameters: [
          { name: 'titleId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'venueId', in: 'query', required: true, schema: { type: 'string' } },
          {
            name: 'localDate',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date' },
          },
          {
            name: 'exhibitionType',
            in: 'query',
            schema: { type: 'string', enum: EXHIBITION_TYPES },
          },
        ],
        responses: {
          200: jsonResponse('the decision', ref('ClearanceDecision')),
          ...COMMON_ERRORS,
        },
      },
    },
    '/bookings': {
      get: {
        tags: ['bookings'],
        summary: 'the diary',
        parameters: [
          ...LIST_PARAMETERS,
          { name: 'status', in: 'query', schema: { type: 'string', enum: BOOKING_STATUSES } },
        ],
        responses: { 200: pagedResponse(ref('Booking')), ...COMMON_ERRORS },
      },
      post: {
        tags: ['bookings'],
        summary: 'hold a screening, if the licence, a print and the calendar agree',
        parameters: [
          {
            name: 'idempotency-key',
            in: 'header',
            schema: { type: 'string', minLength: 8, maxLength: 120 },
          },
        ],
        responses: { 201: jsonResponse('the hold', ref('Booking')), ...COMMON_ERRORS },
      },
    },
    '/shipments': {
      get: {
        tags: ['traffic'],
        summary: 'the legs, planned and past',
        parameters: [
          ...LIST_PARAMETERS,
          { name: 'status', in: 'query', schema: { type: 'string', enum: SHIPMENT_STATUSES } },
        ],
        responses: { 200: pagedResponse(ref('Shipment')), ...COMMON_ERRORS },
      },
      post: {
        tags: ['traffic'],
        summary: 'plan a leg, working the dates back from the screening',
        responses: { 201: jsonResponse('the leg', ref('Shipment')), ...COMMON_ERRORS },
      },
    },
    '/royalty-statements': {
      get: {
        tags: ['money'],
        summary: 'the statements raised',
        parameters: [
          ...LIST_PARAMETERS,
          { name: 'status', in: 'query', schema: { type: 'string', enum: STATEMENT_STATUSES } },
        ],
        responses: { 200: pagedResponse(ref('RoyaltyStatement')), ...COMMON_ERRORS },
      },
    },
    '/royalty-statements/{statementId}/export.csv': {
      get: {
        tags: ['money'],
        summary: 'the statement in the format an accounts package reads',
        parameters: [idParameter('statementId', 'stmt')],
        responses: {
          200: {
            description: 'the statement',
            content: { 'text/csv': { schema: { type: 'string' } } },
          },
          ...COMMON_ERRORS,
        },
      },
    },
    '/extractions/licence-letters': {
      post: {
        tags: ['extraction'],
        summary: 'read a licence letter into a draft licence for review',
        responses: {
          201: jsonResponse('a new reading', ref('ExtractionJob')),
          200: jsonResponse(
            'a reading of the same letter the desk already had',
            ref('ExtractionJob'),
          ),
          ...COMMON_ERRORS,
        },
      },
    },
    '/extractions/{jobId}/apply': {
      put: {
        tags: ['extraction'],
        summary: 'a human turns a reading into a record',
        parameters: [idParameter('jobId', 'exj')],
        responses: {
          200: jsonResponse('the applied reading', ref('ExtractionJob')),
          ...COMMON_ERRORS,
        },
      },
    },
  };
}

function openapiDocument({ servers = [{ url: '/' }] } = {}) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'printdesk',
      version,
      summary: 'Print traffic and rights clearance for repertory cinemas and film archives',
      description: [
        'The desk books a physical film print into a cinema on a date. Three things',
        'have to be true at once: a licence covers the screening, a print exists that',
        'the booth can run, and the calendar leaves time to get it there and back.',
        '',
        'Every refusal names the rule that refused it.',
      ].join('\n'),
    },
    servers,
    security: [{ operatorToken: [] }],
    tags: [
      { name: 'health', description: 'liveness and readiness' },
      { name: 'auth', description: 'operator sessions' },
      { name: 'catalogue', description: 'titles, licensors and houses' },
      { name: 'shelf', description: 'physical prints and their condition' },
      { name: 'rights', description: 'licences and clearance' },
      { name: 'bookings', description: 'screenings' },
      { name: 'traffic', description: 'print legs' },
      { name: 'money', description: 'royalties and statements' },
      { name: 'extraction', description: 'reading letters and bench notes' },
    ],
    paths: paths(),
    components: {
      securitySchemes: {
        operatorToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: schemas(),
    },
  };
}

module.exports = { openapiDocument, schemas, paths, ERROR_CODES };
