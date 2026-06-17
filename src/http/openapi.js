'use strict';

const { version } = require('../../package.json');
const { GAUGES, SOUND_FORMATS, BASE_STOCKS, ELEMENT_KINDS } = require('../domain/formats');
const { ALL_RESTRICTIONS } = require('../domain/handling');
const { ALL_CODES, SEVERITIES } = require('../domain/condition/damageCodes');
const { STATUSES } = require('../domain/elements/status');
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
    RightsHolder: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        kind: { type: 'string' },
        remittanceCurrency: { type: 'string' },
        settlementDays: { type: 'integer' },
        active: { type: 'boolean' },
      },
    },
    AuditEvent: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        at: { type: 'string', format: 'date-time' },
        action: { type: 'string' },
        subjectType: { type: 'string' },
        subjectId: { type: 'string' },
        actor: { type: ['string', 'null'] },
        source: { type: 'string', enum: ['http', 'cli', 'worker', 'system'] },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { field: { type: 'string' }, before: {}, after: {} },
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

const OPERATIONS = Object.freeze([
  {
    method: 'get',
    path: '/health/live',
    tag: 'health',
    summary: 'the process is up and answering',
    access: 'public',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/health/ready',
    tag: 'health',
    summary: 'the desk can serve',
    access: 'public',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/health/version',
    tag: 'health',
    summary: 'what is deployed',
    access: 'public',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/health/openapi.json',
    tag: 'health',
    summary: 'this description',
    access: 'public',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/metrics',
    tag: 'health',
    summary: 'the series worth alerting on',
    access: 'public',
    answers: 'text',
  },
  {
    method: 'post',
    path: '/auth/sign-in',
    tag: 'auth',
    summary: 'exchange an email and password for a session token',
    access: 'public',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/auth/me',
    tag: 'auth',
    summary: 'who the token belongs to',
    access: 'auth',
    answers: 'Operator',
  },
  {
    method: 'put',
    path: '/auth/password',
    tag: 'auth',
    summary: 'change your own password',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/auth/operators',
    tag: 'auth',
    summary: 'the people who work this desk',
    access: 'auth',
    answers: 'page:Operator',
  },
  {
    method: 'post',
    path: '/auth/operators',
    tag: 'auth',
    summary: 'add somebody to the desk',
    access: 'auth',
    answers: 'Operator',
  },
  {
    method: 'put',
    path: '/auth/operators/{operatorId}/role',
    tag: 'auth',
    summary: 'change what somebody may do',
    access: 'auth',
    answers: 'Operator',
  },
  {
    method: 'delete',
    path: '/auth/operators/{operatorId}',
    tag: 'auth',
    summary: 'take somebody off the desk',
    access: 'auth',
    answers: 'Operator',
  },
  {
    method: 'get',
    path: '/titles',
    tag: 'catalogue',
    summary: 'the film works the desk books',
    access: 'auth',
    answers: 'page:Title',
  },
  {
    method: 'post',
    path: '/titles',
    tag: 'catalogue',
    summary: 'catalogue a film work',
    access: 'auth',
    answers: 'Title',
  },
  {
    method: 'get',
    path: '/titles/{titleId}',
    tag: 'catalogue',
    summary: 'one film work in the catalogue',
    access: 'auth',
    answers: 'Title',
  },
  {
    method: 'patch',
    path: '/titles/{titleId}',
    tag: 'catalogue',
    summary: 'correct the description of a film work',
    access: 'auth',
    answers: 'Title',
  },
  {
    method: 'put',
    path: '/titles/{titleId}/status',
    tag: 'catalogue',
    summary: 'make a title bookable, or withdraw it',
    access: 'auth',
    answers: 'Title',
  },
  {
    method: 'post',
    path: '/titles/{titleId}/merge',
    tag: 'catalogue',
    summary: 'fold a duplicate catalogue entry into this one',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/titles/{titleId}/availability',
    tag: 'catalogue',
    summary: 'which houses could show it, and why the rest could not',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/venues',
    tag: 'catalogue',
    summary: 'the houses the desk ships to',
    access: 'auth',
    answers: 'page:Venue',
  },
  {
    method: 'post',
    path: '/venues',
    tag: 'catalogue',
    summary: 'put a house on file',
    access: 'auth',
    answers: 'Venue',
  },
  {
    method: 'post',
    path: '/venues/import',
    tag: 'catalogue',
    summary: 'take the spreadsheet of houses an archive already keeps',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/venues/{venueId}',
    tag: 'catalogue',
    summary: 'one house on file',
    access: 'auth',
    answers: 'Venue',
  },
  {
    method: 'patch',
    path: '/venues/{venueId}',
    tag: 'catalogue',
    summary: 'correct a house address or its lead days',
    access: 'auth',
    answers: 'Venue',
  },
  {
    method: 'put',
    path: '/venues/{venueId}/booth',
    tag: 'catalogue',
    summary: 'change what the booth can run',
    access: 'auth',
    answers: 'Venue',
  },
  {
    method: 'put',
    path: '/venues/{venueId}/active',
    tag: 'catalogue',
    summary: 'open or close a house to bookings',
    access: 'auth',
    answers: 'Venue',
  },
  {
    method: 'get',
    path: '/venues/{venueId}/diary',
    tag: 'catalogue',
    summary: 'what a house has on, with the print and its leg',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/rights-holders',
    tag: 'catalogue',
    summary: 'the parties who can licence a title',
    access: 'auth',
    answers: 'page:RightsHolder',
  },
  {
    method: 'post',
    path: '/rights-holders',
    tag: 'catalogue',
    summary: 'put a licensor on file',
    access: 'auth',
    answers: 'RightsHolder',
  },
  {
    method: 'get',
    path: '/rights-holders/{holderId}',
    tag: 'catalogue',
    summary: 'one licensor on file',
    access: 'auth',
    answers: 'RightsHolder',
  },
  {
    method: 'patch',
    path: '/rights-holders/{holderId}',
    tag: 'catalogue',
    summary: 'correct a licensor contact or terms',
    access: 'auth',
    answers: 'RightsHolder',
  },
  {
    method: 'put',
    path: '/rights-holders/{holderId}/remittance-currency',
    tag: 'catalogue',
    summary: 'change the currency a licensor is paid in',
    access: 'auth',
    answers: 'RightsHolder',
  },
  {
    method: 'delete',
    path: '/rights-holders/{holderId}',
    tag: 'catalogue',
    summary: 'stop trading with a licensor',
    access: 'auth',
    answers: 'RightsHolder',
  },
  {
    method: 'get',
    path: '/elements',
    tag: 'shelf',
    summary: 'the physical prints',
    access: 'auth',
    answers: 'page:PrintElement',
  },
  {
    method: 'post',
    path: '/elements',
    tag: 'shelf',
    summary: 'catalogue a physical print',
    access: 'auth',
    answers: 'PrintElement',
  },
  {
    method: 'get',
    path: '/elements/{elementId}',
    tag: 'shelf',
    summary: 'one print on the shelf',
    access: 'auth',
    answers: 'PrintElement',
  },
  {
    method: 'put',
    path: '/elements/{elementId}/location',
    tag: 'shelf',
    summary: 'correct where a print is',
    access: 'auth',
    answers: 'PrintElement',
  },
  {
    method: 'put',
    path: '/elements/{elementId}/custody',
    tag: 'shelf',
    summary: 'hand a print to a different keeper',
    access: 'auth',
    answers: 'PrintElement',
  },
  {
    method: 'put',
    path: '/elements/{elementId}/status',
    tag: 'shelf',
    summary: 'move a print through the status machine',
    access: 'auth',
    answers: 'PrintElement',
  },
  {
    method: 'get',
    path: '/elements/{elementId}/provenance',
    tag: 'shelf',
    summary: 'where a print has been and what happened to it',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'post',
    path: '/elements/{elementId}/retirement',
    tag: 'shelf',
    summary: 'retire a print and record where the film went',
    access: 'auth',
    answers: 'PrintElement',
  },
  {
    method: 'get',
    path: '/elements/{elementId}/compatibility/{venueId}',
    tag: 'shelf',
    summary: 'whether a booth can run a given print',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/elements/{elementId}/inspections',
    tag: 'shelf',
    summary: 'the condition history of one print',
    access: 'auth',
    answers: 'page:InspectionReport',
  },
  {
    method: 'post',
    path: '/elements/{elementId}/inspections',
    tag: 'shelf',
    summary: 'file a condition report and move the print with it',
    access: 'auth',
    answers: 'InspectionReport',
  },
  {
    method: 'post',
    path: '/elements/{elementId}/inspections/preview',
    tag: 'shelf',
    summary: 'what a report would grade, without filing it',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/inspections',
    tag: 'shelf',
    summary: 'condition reports across the collection',
    access: 'auth',
    answers: 'page:InspectionReport',
  },
  {
    method: 'get',
    path: '/inspections/{inspectionId}',
    tag: 'shelf',
    summary: 'one condition report',
    access: 'auth',
    answers: 'InspectionReport',
  },
  {
    method: 'get',
    path: '/inspections/due',
    tag: 'shelf',
    summary: 'the prints due a look, worst first',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/rights-windows',
    tag: 'rights',
    summary: 'the licences on file',
    access: 'auth',
    answers: 'page:RightsWindow',
  },
  {
    method: 'post',
    path: '/rights-windows',
    tag: 'rights',
    summary: 'write a licence as a draft',
    access: 'auth',
    answers: 'RightsWindow',
  },
  {
    method: 'get',
    path: '/rights-windows/{windowId}',
    tag: 'rights',
    summary: 'one licence window',
    access: 'auth',
    answers: 'RightsWindow',
  },
  {
    method: 'post',
    path: '/rights-windows/{windowId}/renew',
    tag: 'rights',
    summary: 'copy a licence forward into a new period as a draft',
    access: 'auth',
    answers: 'RightsWindow',
  },
  {
    method: 'put',
    path: '/rights-windows/{windowId}/activate',
    tag: 'rights',
    summary: 'make a licence live, once no exclusive contradicts it',
    access: 'auth',
    answers: 'RightsWindow',
  },
  {
    method: 'put',
    path: '/rights-windows/{windowId}/suspend',
    tag: 'rights',
    summary: 'stop a licence clearing anything, with a reason',
    access: 'auth',
    answers: 'RightsWindow',
  },
  {
    method: 'get',
    path: '/clearance',
    tag: 'rights',
    summary: 'could this house show this title on this date',
    access: 'auth',
    answers: 'ClearanceDecision',
  },
  {
    method: 'get',
    path: '/bookings',
    tag: 'bookings',
    summary: 'the booking diary',
    access: 'auth',
    answers: 'page:Booking',
  },
  {
    method: 'post',
    path: '/bookings',
    tag: 'bookings',
    summary: 'hold a screening, if the licence, a print and the calendar agree',
    access: 'idempotent',
    answers: 'Booking',
  },
  {
    method: 'post',
    path: '/bookings/runs',
    tag: 'bookings',
    summary: 'hold a run of nights on one print, or none of them',
    access: 'idempotent',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/bookings/{bookingId}',
    tag: 'bookings',
    summary: 'one booking in the diary',
    access: 'auth',
    answers: 'Booking',
  },
  {
    method: 'put',
    path: '/bookings/{bookingId}/confirm',
    tag: 'bookings',
    summary: 'turn a hold into two print legs',
    access: 'auth',
    answers: 'Booking',
  },
  {
    method: 'put',
    path: '/bookings/{bookingId}/element',
    tag: 'bookings',
    summary: 'swap the print, keeping the licence and the night',
    access: 'auth',
    answers: 'Booking',
  },
  {
    method: 'put',
    path: '/bookings/{bookingId}/box-office',
    tag: 'bookings',
    summary: 'report the takings and work the royalty out',
    access: 'auth',
    answers: 'Booking',
  },
  {
    method: 'put',
    path: '/bookings/{bookingId}/settle',
    tag: 'bookings',
    summary: 'close a booking once the money is accounted for',
    access: 'auth',
    answers: 'Booking',
  },
  {
    method: 'delete',
    path: '/bookings/{bookingId}',
    tag: 'bookings',
    summary: 'cancel a booking and stand down its legs',
    access: 'auth',
    answers: 'Booking',
  },
  {
    method: 'get',
    path: '/bookings/awaiting-box-office',
    tag: 'bookings',
    summary: 'screenings that have played with no takings reported',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/shipments',
    tag: 'traffic',
    summary: 'the legs, planned and past',
    access: 'auth',
    answers: 'page:Shipment',
  },
  {
    method: 'post',
    path: '/shipments',
    tag: 'traffic',
    summary: 'plan a leg, working the dates back from the screening',
    access: 'auth',
    answers: 'Shipment',
  },
  {
    method: 'get',
    path: '/shipments/{shipmentId}',
    tag: 'traffic',
    summary: 'one print leg',
    access: 'auth',
    answers: 'Shipment',
  },
  {
    method: 'put',
    path: '/shipments/{shipmentId}/dispatch',
    tag: 'traffic',
    summary: 'the cans have left the building',
    access: 'auth',
    answers: 'Shipment',
  },
  {
    method: 'put',
    path: '/shipments/{shipmentId}/arrival',
    tag: 'traffic',
    summary: 'the cans have landed, and what was in them',
    access: 'auth',
    answers: 'Shipment',
  },
  {
    method: 'put',
    path: '/shipments/{shipmentId}/delay',
    tag: 'traffic',
    summary: 'the leg is running late',
    access: 'auth',
    answers: 'Shipment',
  },
  {
    method: 'put',
    path: '/shipments/{shipmentId}/lost',
    tag: 'traffic',
    summary: 'the leg is lost and the print is retired',
    access: 'auth',
    answers: 'Shipment',
  },
  {
    method: 'get',
    path: '/shipments/overdue',
    tag: 'traffic',
    summary: 'legs that should have landed by now',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/royalty-statements',
    tag: 'money',
    summary: 'the statements raised',
    access: 'auth',
    answers: 'page:RoyaltyStatement',
  },
  {
    method: 'post',
    path: '/royalty-statements',
    tag: 'money',
    summary: 'build a period statement from the settled screenings',
    access: 'auth',
    answers: 'RoyaltyStatement',
  },
  {
    method: 'get',
    path: '/royalty-statements/{statementId}',
    tag: 'money',
    summary: 'one royalty statement',
    access: 'auth',
    answers: 'RoyaltyStatement',
  },
  {
    method: 'get',
    path: '/royalty-statements/{statementId}/export.csv',
    tag: 'money',
    summary: 'the statement in the format an accounts package reads',
    access: 'csv',
    answers: 'text',
  },
  {
    method: 'put',
    path: '/royalty-statements/{statementId}/issue',
    tag: 'money',
    summary: 'freeze the lines and start the payment clock',
    access: 'auth',
    answers: 'RoyaltyStatement',
  },
  {
    method: 'put',
    path: '/royalty-statements/{statementId}/payment',
    tag: 'money',
    summary: 'record what was paid against a statement',
    access: 'auth',
    answers: 'RoyaltyStatement',
  },
  {
    method: 'delete',
    path: '/royalty-statements/{statementId}',
    tag: 'money',
    summary: 'void a statement that was built wrong',
    access: 'auth',
    answers: 'RoyaltyStatement',
  },
  {
    method: 'post',
    path: '/extractions/licence-letters',
    tag: 'extraction',
    summary: 'read a licence letter into a draft licence for review',
    access: 'idempotent',
    answers: 'ExtractionJob',
  },
  {
    method: 'post',
    path: '/extractions/bench-notes',
    tag: 'extraction',
    summary: "read an inspector's shorthand into structured findings",
    access: 'idempotent',
    answers: 'ExtractionJob',
  },
  {
    method: 'get',
    path: '/extractions',
    tag: 'extraction',
    summary: 'the readings, and which are waiting for a human',
    access: 'auth',
    answers: 'page:ExtractionJob',
  },
  {
    method: 'get',
    path: '/extractions/{jobId}',
    tag: 'extraction',
    summary: 'one reading, with what it answered',
    access: 'auth',
    answers: 'ExtractionJob',
  },
  {
    method: 'put',
    path: '/extractions/{jobId}/apply',
    tag: 'extraction',
    summary: 'a human turns a reading into a record',
    access: 'auth',
    answers: 'ExtractionJob',
  },
  {
    method: 'put',
    path: '/extractions/{jobId}/reject',
    tag: 'extraction',
    summary: 'a human throws a reading away, with a reason',
    access: 'auth',
    answers: 'ExtractionJob',
  },
  {
    method: 'get',
    path: '/extractions/queue',
    tag: 'extraction',
    summary: 'what is waiting to be looked at, by kind',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'post',
    path: '/extractions/review',
    tag: 'extraction',
    summary: 'accept or reject several readings in one sitting',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/extractions/spend',
    tag: 'extraction',
    summary: 'what extraction has cost over a period',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/reports/licence-utilisation',
    tag: 'rights',
    summary: 'how much of each live licence has actually been used',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/reports/licensor-summary',
    tag: 'money',
    summary: 'what a licensor titles did over a period',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/reports/lapsing-licences',
    tag: 'rights',
    summary: 'licences that will lapse soon, so somebody can renew them',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/reports/shelf',
    tag: 'shelf',
    summary: 'the state of the shelf, counted by status, grade and gauge',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/reports/condition-trend',
    tag: 'shelf',
    summary: 'which prints are getting worse, and how fast',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/search',
    tag: 'catalogue',
    summary: 'the box at the top of the screen, whatever was typed into it',
    access: 'auth',
    answers: 'object',
  },
  {
    method: 'get',
    path: '/audit-events',
    tag: 'audit',
    summary: 'who changed what, across the desk',
    access: 'auth',
    answers: 'page:AuditEvent',
  },
  {
    method: 'get',
    path: '/audit-events/{subjectType}/{subjectId}',
    tag: 'audit',
    summary: 'the trail for one record',
    access: 'auth',
    answers: 'page:AuditEvent',
  },
  {
    method: 'get',
    path: '/audit-events/{subjectType}/{subjectId}/actors',
    tag: 'audit',
    summary: 'who has touched one record, and how often',
    access: 'auth',
    answers: 'object',
  },
]);

const SUCCESS_STATUS = Object.freeze({ post: 201, delete: 200, put: 200, patch: 200, get: 200 });

/**
 * The parameters a path declares are read off the path itself, so a route with
 * an id in it cannot be documented without one.
 */
function parametersFor(path) {
  const names = [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => name);

  return names.map((name) => {
    const prefix = PARAMETER_PREFIXES[name];
    return {
      name,
      in: 'path',
      required: true,
      schema: prefix
        ? { type: 'string', pattern: `^${prefix}_[0-9A-Z]{16}$` }
        : { type: 'string', minLength: 1, maxLength: 60 },
    };
  });
}

const PARAMETER_PREFIXES = Object.freeze({
  titleId: 'ttl',
  venueId: 'ven',
  holderId: 'rh',
  elementId: 'elem',
  inspectionId: 'insp',
  windowId: 'rw',
  bookingId: 'bkg',
  shipmentId: 'shp',
  statementId: 'stmt',
  jobId: 'exj',
  operatorId: 'op',
});

function responseFor(answers, status) {
  if (answers === 'text') {
    return {
      [status]: {
        description: 'a plain text answer',
        content: { 'text/plain': { schema: { type: 'string' } } },
      },
    };
  }
  if (answers.startsWith('page:')) {
    return { [status]: pagedResponse({ $ref: `#/components/schemas/${answers.slice(5)}` }) };
  }
  if (answers === 'object') {
    return { [status]: jsonResponse('the answer', { type: 'object', additionalProperties: true }) };
  }
  return { [status]: jsonResponse('the record', { $ref: `#/components/schemas/${answers}` }) };
}

function csvResponse() {
  return {
    200: {
      description: 'the statement as csv',
      content: { 'text/csv': { schema: { type: 'string' } } },
    },
  };
}

const IDEMPOTENCY_PARAMETER = Object.freeze({
  name: 'idempotency-key',
  in: 'header',
  description: 'a key that makes a retry replay the first answer rather than book twice',
  schema: { type: 'string', minLength: 8, maxLength: 120 },
});

/**
 * Builds the paths from the operation table. Nothing here is written twice:
 * a route that is not in the table fails the contract test, and an entry with
 * no route fails it too.
 */
function paths() {
  const document = {};

  for (const operation of OPERATIONS) {
    const status = SUCCESS_STATUS[operation.method];
    const parameters = parametersFor(operation.path);
    if (operation.access === 'idempotent') parameters.push(IDEMPOTENCY_PARAMETER);
    if (operation.method === 'get' && operation.answers.startsWith('page:')) {
      parameters.push(...LIST_PARAMETERS);
    }

    const built = {
      tags: [operation.tag],
      summary: operation.summary,
      responses:
        operation.access === 'csv'
          ? { ...csvResponse(), ...COMMON_ERRORS }
          : { ...responseFor(operation.answers, status), ...COMMON_ERRORS },
    };
    if (parameters.length > 0) built.parameters = parameters;
    if (operation.access === 'public') {
      built.security = [];
      built.responses = responseFor(operation.answers, status);
    }

    document[operation.path] = { ...(document[operation.path] || {}), [operation.method]: built };
  }

  return document;
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
      { name: 'audit', description: 'who changed what' },
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

module.exports = { openapiDocument, schemas, paths, OPERATIONS, ERROR_CODES };
