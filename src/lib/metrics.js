'use strict';

/**
 * A very small metrics registry. Prometheus client libraries are fine and this
 * desk exports eleven series, so a dependency that brings its own aggregation
 * and a cluster protocol is not worth carrying.
 *
 * Counters only go up, gauges are read when asked, and histograms keep the
 * buckets the desk actually alerts on.
 */

const LABEL_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertName(name) {
  if (!LABEL_PATTERN.test(name)) throw new TypeError(`${name} is not a metric name`);
  return name;
}

function labelKey(labels) {
  const names = Object.keys(labels).sort();
  return names.map((name) => `${name}=${labels[name]}`).join(',');
}

function renderLabels(labels) {
  const names = Object.keys(labels).sort();
  if (names.length === 0) return '';
  const pairs = names.map((name) => `${name}="${String(labels[name]).replace(/"/g, '')}"`);
  return `{${pairs.join(',')}}`;
}

class Registry {
  constructor() {
    this.counters = new Map();
    this.histograms = new Map();
    this.gauges = new Map();
  }

  counter(name, help) {
    assertName(name);
    if (!this.counters.has(name)) {
      this.counters.set(name, { help, values: new Map(), labels: new Map() });
    }
    return this.counters.get(name);
  }

  increment(name, labels = {}, by = 1) {
    const counter = this.counter(name);
    const key = labelKey(labels);
    counter.values.set(key, (counter.values.get(key) || 0) + by);
    counter.labels.set(key, labels);
    return counter.values.get(key);
  }

  histogram(name, buckets, help) {
    assertName(name);
    if (!this.histograms.has(name)) {
      this.histograms.set(name, {
        help,
        buckets: [...buckets].sort((a, b) => a - b),
        series: new Map(),
      });
    }
    return this.histograms.get(name);
  }

  observe(name, value, labels = {}) {
    const histogram = this.histograms.get(name);
    if (!histogram) throw new TypeError(`${name} is not a histogram this desk keeps`);

    const key = labelKey(labels);
    if (!histogram.series.has(key)) {
      histogram.series.set(key, {
        labels,
        counts: new Array(histogram.buckets.length).fill(0),
        sum: 0,
        count: 0,
      });
    }
    const series = histogram.series.get(key);
    series.sum += value;
    series.count += 1;
    histogram.buckets.forEach((bucket, index) => {
      if (value <= bucket) series.counts[index] += 1;
    });
    return series;
  }

  /** A gauge is a function, so it is read at scrape time and never goes stale. */
  gauge(name, help, read) {
    assertName(name);
    this.gauges.set(name, { help, read });
  }

  async render() {
    const lines = [];

    for (const [name, counter] of this.counters) {
      if (counter.help) lines.push(`# HELP ${name} ${counter.help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const [key, value] of counter.values) {
        lines.push(`${name}${renderLabels(counter.labels.get(key))} ${value}`);
      }
    }

    for (const [name, histogram] of this.histograms) {
      if (histogram.help) lines.push(`# HELP ${name} ${histogram.help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const series of histogram.series.values()) {
        histogram.buckets.forEach((bucket, index) => {
          const labels = { ...series.labels, le: String(bucket) };
          lines.push(`${name}_bucket${renderLabels(labels)} ${series.counts[index]}`);
        });
        const infinity = { ...series.labels, le: '+Inf' };
        lines.push(`${name}_bucket${renderLabels(infinity)} ${series.count}`);
        lines.push(`${name}_sum${renderLabels(series.labels)} ${series.sum}`);
        lines.push(`${name}_count${renderLabels(series.labels)} ${series.count}`);
      }
    }

    for (const [name, gauge] of this.gauges) {
      if (gauge.help) lines.push(`# HELP ${name} ${gauge.help}`);
      lines.push(`# TYPE ${name} gauge`);
      // eslint-disable-next-line no-await-in-loop
      const value = await gauge.read();
      lines.push(`${name} ${value}`);
    }

    return `${lines.join('\n')}\n`;
  }

  reset() {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }
}

const registry = new Registry();

const REQUEST_BUCKETS = Object.freeze([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]);

function installDefaults(target = registry) {
  target.counter('printdesk_requests_total', 'requests answered, by method, route and status');
  target.histogram(
    'printdesk_request_duration_ms',
    REQUEST_BUCKETS,
    'how long the desk took to answer',
  );
  return target;
}

module.exports = { Registry, registry, installDefaults, renderLabels, labelKey, REQUEST_BUCKETS };
