'use strict';

/**
 * A client the extraction tests hand in instead of a key. It answers from a
 * queue, records what it was asked, and can be told to fail, so the retry and
 * the failure paths are exercised without a network.
 */
function fakeClient({
  model = 'gpt-4o-mini',
  resolvedModel = 'gpt-4o-mini-2024-07-18',
  answers = [],
} = {}) {
  const calls = [];
  const queue = [...answers];

  return {
    model,
    calls,
    queue,
    answerWith(data, usage = { promptTokens: 800, completionTokens: 120 }) {
      queue.push({ data, usage });
      return this;
    },
    failWith(error) {
      queue.push(error);
      return this;
    },
    async completeJson(request) {
      calls.push(request);
      const next = queue.shift();
      if (!next) throw new Error('the fake client ran out of answers');
      if (next instanceof Error) throw next;
      return {
        data: next.data,
        raw: JSON.stringify(next.data),
        // The API answers with a dated build, the way the real one does.
        model: resolvedModel,
        usage: next.usage,
        elapsedMs: 42,
      };
    },
  };
}

const LICENCE_ANSWER = Object.freeze({
  territory: 'GB',
  exhibitionTypes: ['repertory'],
  startsOn: '2025-01-01',
  endsOn: '2025-12-31',
  terms: { kind: 'percentage', currency: 'GBP', percentageBps: 3500 },
  confidence: 0.9,
});

const NOTE_ANSWER = Object.freeze({
  findings: [{ reel: 2, code: 'PERF-TEAR', severity: 'severe', footageMark: 340 }],
  measurements: { shrinkagePercent: 0.8 },
  confidence: 0.9,
});

module.exports = { fakeClient, LICENCE_ANSWER, NOTE_ANSWER };
