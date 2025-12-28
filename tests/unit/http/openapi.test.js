'use strict';

const { openapiDocument } = require('../../../src/http/openapi');
const { GAUGES } = require('../../../src/domain/formats');
const { ALL_CODES } = require('../../../src/domain/condition/damageCodes');
const { BOOKING_STATUSES } = require('../../../src/models/booking');
const { version } = require('../../../package.json');

const document = openapiDocument();

describe('the description of the api', () => {
  it('says which openapi it is and what version of the desk', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe(version);
    expect(document.info.title).toBe('printdesk');
  });

  it('describes what the desk actually does', () => {
    expect(document.info.description).toMatch(/licence covers the screening/);
    expect(document.info.summary).toMatch(/repertory cinemas/);
  });

  it('reads its vocabularies from the code rather than repeating them', () => {
    const booth = document.components.schemas.Venue.properties.booth;

    expect(booth.properties.gauges.items.enum).toEqual(GAUGES);
    expect(
      document.components.schemas.InspectionReport.properties.findings.items.properties.code.enum,
    ).toEqual(ALL_CODES);
    expect(document.components.schemas.Booking.properties.status.enum).toEqual(BOOKING_STATUSES);
  });

  it('needs an operator token by default and says which paths do not', () => {
    expect(document.security).toEqual([{ operatorToken: [] }]);
    expect(document.paths['/health/live'].get.security).toEqual([]);
    expect(document.paths['/auth/sign-in'].post.security).toEqual([]);
    expect(document.paths['/titles'].get.security).toBeUndefined();
  });

  it('gives every operation a tag that is declared', () => {
    const declared = new Set(document.tags.map((tag) => tag.name));

    for (const [path, operations] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        expect(operation.summary).toEqual(expect.any(String));
        for (const tag of operation.tags) {
          expect(declared.has(tag)).toBe(true);
        }
        expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
        void `${method} ${path}`;
      }
    }
  });

  it('describes the refusals every write can answer with', () => {
    const responses = document.paths['/bookings'].post.responses;

    expect(Object.keys(responses)).toEqual(
      expect.arrayContaining(['201', '400', '401', '403', '404', '409', '422', '429']),
    );
    expect(responses[422].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/Error',
    );
  });

  it('resolves every schema reference it makes', () => {
    const names = new Set(Object.keys(document.components.schemas));
    const refs = [...JSON.stringify(document.paths).matchAll(/#\/components\/schemas\/(\w+)/g)];

    expect(refs.length).toBeGreaterThan(10);
    for (const [, name] of refs) {
      expect(names.has(name)).toBe(true);
    }
  });

  it('says an idempotency key is what stops a retry booking twice', () => {
    const parameters = document.paths['/bookings'].post.parameters;

    expect(parameters[0].name).toBe('idempotency-key');
    expect(parameters[0].in).toBe('header');
  });

  it('takes the server it is served from', () => {
    const served = openapiDocument({ servers: [{ url: 'https://desk.archive.test' }] });

    expect(served.servers[0].url).toBe('https://desk.archive.test');
  });

  it('answers with csv where the answer is csv', () => {
    const csv = document.paths['/royalty-statements/{statementId}/export.csv'].get;

    expect(Object.keys(csv.responses['200'].content)).toEqual(['text/csv']);
  });
});

describe('the metric label for a route', () => {
  const { routeLabel } = require('../../../src/http/middleware/requestContext');

  it('folds a public id out of the path', () => {
    expect(routeLabel({ originalUrl: '/titles/ttl_0123456789ABCDEF' })).toBe('/titles/:id');
    expect(routeLabel({ originalUrl: '/elements/elem_0123456789ABCDEF/inspections' })).toBe(
      '/elements/:id/inspections',
    );
  });

  it('folds a booking reference and a barcode out too', () => {
    expect(routeLabel({ originalUrl: '/bookings/BK-2025-171-0123' })).toBe('/bookings/:reference');
    expect(routeLabel({ originalUrl: '/elements/PE-000123' })).toBe('/elements/:barcode');
  });

  it('drops the query string', () => {
    expect(routeLabel({ originalUrl: '/titles?limit=50&search=daisies' })).toBe('/titles');
  });

  it('leaves an ordinary path alone', () => {
    expect(routeLabel({ originalUrl: '/health/ready' })).toBe('/health/ready');
    expect(routeLabel({ originalUrl: '/' })).toBe('/');
  });

  it('does not fold something that only looks like an id', () => {
    expect(routeLabel({ originalUrl: '/titles/the-red-shoes' })).toBe('/titles/the-red-shoes');
  });
});
