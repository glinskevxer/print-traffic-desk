'use strict';

const { Registry, renderLabels, installDefaults } = require('../../../src/lib/metrics');

describe('the metrics registry', () => {
  let registry;

  beforeEach(() => {
    registry = new Registry();
  });

  it('refuses a name prometheus would not accept', () => {
    expect(() => registry.counter('not-a-name')).toThrow(TypeError);
    expect(() => registry.counter('printdesk_requests_total')).not.toThrow();
  });

  it('counts by label set', async () => {
    registry.counter('requests_total', 'answers');
    registry.increment('requests_total', { route: '/titles', status: 200 });
    registry.increment('requests_total', { route: '/titles', status: 200 });
    registry.increment('requests_total', { route: '/titles', status: 404 });

    const text = await registry.render();

    expect(text).toContain('requests_total{route="/titles",status="200"} 2');
    expect(text).toContain('requests_total{route="/titles",status="404"} 1');
    expect(text).toContain('# TYPE requests_total counter');
  });

  it('renders labels in a stable order whatever order they arrived in', () => {
    expect(renderLabels({ status: 200, route: '/a', method: 'GET' })).toBe(
      '{method="GET",route="/a",status="200"}',
    );
    expect(renderLabels({})).toBe('');
  });

  it('keeps a label value from breaking the line', () => {
    expect(renderLabels({ route: 'a"b' })).toBe('{route="ab"}');
  });

  it('buckets an observation into every bucket it fits', async () => {
    registry.histogram('duration_ms', [10, 100, 1000], 'how long');
    registry.observe('duration_ms', 5, { route: '/titles' });
    registry.observe('duration_ms', 50, { route: '/titles' });
    registry.observe('duration_ms', 5000, { route: '/titles' });

    const text = await registry.render();

    expect(text).toContain('duration_ms_bucket{le="10",route="/titles"} 1');
    expect(text).toContain('duration_ms_bucket{le="100",route="/titles"} 2');
    expect(text).toContain('duration_ms_bucket{le="1000",route="/titles"} 2');
    expect(text).toContain('duration_ms_bucket{le="+Inf",route="/titles"} 3');
    expect(text).toContain('duration_ms_sum{route="/titles"} 5055');
    expect(text).toContain('duration_ms_count{route="/titles"} 3');
  });

  it('will not observe against a histogram it does not keep', () => {
    expect(() => registry.observe('nothing', 1)).toThrow(/not a histogram/);
  });

  it('reads a gauge at scrape time, so it is never stale', async () => {
    let holds = 3;
    registry.gauge('bookings_held', 'holds', () => holds);

    expect(await registry.render()).toContain('bookings_held 3');
    holds = 7;
    expect(await registry.render()).toContain('bookings_held 7');
  });

  it('waits for a gauge that has to ask the database', async () => {
    registry.gauge('slow', 'a gauge that queries', async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return 42;
    });

    expect(await registry.render()).toContain('slow 42');
  });

  it('sorts the buckets whatever order they were declared in', async () => {
    registry.histogram('out_of_order', [1000, 10, 100]);
    registry.observe('out_of_order', 50);

    const lines = (await registry.render()).split('\n').filter((line) => line.includes('_bucket'));

    expect(lines[0]).toContain('le="10"');
    expect(lines[1]).toContain('le="100"');
  });

  it('installs the two series every request touches', async () => {
    installDefaults(registry);
    registry.increment('printdesk_requests_total', { route: '/titles' });
    registry.observe('printdesk_request_duration_ms', 12, { route: '/titles' });

    const text = await registry.render();

    expect(text).toContain('# HELP printdesk_requests_total');
    expect(text).toContain('# TYPE printdesk_request_duration_ms histogram');
  });

  it('renders nothing but a newline when it holds nothing', async () => {
    expect(await registry.render()).toBe('\n');
  });

  it('forgets everything when reset', async () => {
    registry.counter('a_total');
    registry.increment('a_total');
    registry.reset();

    expect(await registry.render()).toBe('\n');
  });
});
