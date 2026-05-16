'use strict';

const { signBody, verifySignature, webhookDeliverer } = require('../../../src/workers/delivery');

const SECRET = 'a-webhook-secret-that-is-long-enough';

function fakeFetch(status = 202) {
  const calls = [];
  return {
    calls,
    impl: async (url, options) => {
      calls.push({ url, options });
      return { ok: status < 400, status };
    },
  };
}

describe('proving a despatch note came from the desk', () => {
  it('signs the timestamp with the body', () => {
    const header = signBody({ body: '{"a":1}', secret: SECRET, timestamp: 1750000000 });

    expect(header).toMatch(/^t=1750000000,v1=[0-9a-f]{64}$/);
  });

  it('accepts its own signature', () => {
    const body = '{"kind":"booking.confirmed"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signBody({ body, secret: SECRET, timestamp });

    expect(verifySignature({ body, secret: SECRET, header })).toBe(true);
  });

  it('refuses a body that was changed after it was signed', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signBody({ body: '{"cans":4}', secret: SECRET, timestamp });

    expect(verifySignature({ body: '{"cans":8}', secret: SECRET, header })).toBe(false);
  });

  it('refuses a signature made with another secret', () => {
    const body = '{"a":1}';
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signBody({ body, secret: 'a-different-secret-long-enough-x', timestamp });

    expect(verifySignature({ body, secret: SECRET, header })).toBe(false);
  });

  it('refuses a message replayed from last week', () => {
    const body = '{"a":1}';
    const week = Math.floor(Date.now() / 1000) - 7 * 86400;
    const header = signBody({ body, secret: SECRET, timestamp: week });

    expect(verifySignature({ body, secret: SECRET, header })).toBe(false);
  });

  it('takes a message signed a moment ago either side of now', () => {
    const body = '{"a":1}';
    const now = Date.now();
    const header = signBody({ body, secret: SECRET, timestamp: Math.floor(now / 1000) + 60 });

    expect(verifySignature({ body, secret: SECRET, header, now })).toBe(true);
  });

  it('refuses a header that is not one', () => {
    expect(verifySignature({ body: '{}', secret: SECRET, header: 'nonsense' })).toBe(false);
    expect(verifySignature({ body: '{}', secret: SECRET, header: '' })).toBe(false);
    expect(verifySignature({ body: '{}', secret: SECRET, header: undefined })).toBe(false);
    expect(verifySignature({ body: '{}', secret: SECRET, header: 't=1,v1=zz' })).toBe(false);
  });

  it('sends the signature with the message', async () => {
    const fetcher = fakeFetch();
    const deliver = webhookDeliverer({
      url: 'https://office.archive.test/hooks',
      secret: SECRET,
      fetchImpl: fetcher.impl,
    });

    await deliver({
      publicId: 'out_1',
      kind: 'booking.confirmed',
      to: 'GB-LON-PRINCE',
      subjectType: 'booking',
      subjectId: 'bkg_1',
      payload: { reference: 'BK-2025-171-0123' },
    });

    const { headers, body } = fetcher.calls[0].options;
    expect(headers['x-printdesk-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(
      verifySignature({ body, secret: SECRET, header: headers['x-printdesk-signature'] }),
    ).toBe(true);
  });

  it('sends nothing to sign when no secret is configured', async () => {
    const fetcher = fakeFetch();
    const deliver = webhookDeliverer({
      url: 'https://office.archive.test/hooks',
      fetchImpl: fetcher.impl,
    });

    await deliver({ publicId: 'out_1', kind: 'booking.confirmed', payload: {} });

    expect(fetcher.calls[0].options.headers['x-printdesk-signature']).toBeUndefined();
  });

  it('signs exactly the bytes it sends', async () => {
    const fetcher = fakeFetch();
    const deliver = webhookDeliverer({
      url: 'https://office.archive.test/hooks',
      secret: SECRET,
      fetchImpl: fetcher.impl,
    });

    await deliver({
      publicId: 'out_1',
      kind: 'element.quarantined',
      payload: { barcode: 'PE-000123', note: 'has a "quote" and a, comma' },
    });

    const { headers, body } = fetcher.calls[0].options;
    expect(JSON.parse(body).payload.note).toBe('has a "quote" and a, comma');
    expect(
      verifySignature({ body, secret: SECRET, header: headers['x-printdesk-signature'] }),
    ).toBe(true);
  });
});
