'use strict';

const OpenAI = require('openai');
const { UpstreamError, RateLimitedError, ValidationError } = require('../lib/errors');
const { withRetry, delayFromError } = require('../lib/retry');

/**
 * The only place the desk talks to OpenAI. Everything above this reads a
 * structured result or an error it can classify, which is what lets the
 * extraction tests run without a network or a key.
 */

const SERVICE = 'openai';

/** 429 and 5xx are worth trying again; a rejected prompt never will be. */
function classify(err) {
  const status = err && (err.status || err.statusCode);

  if (status === 429) {
    const retryAfter = Number(err.headers && err.headers['retry-after']);
    return new RateLimitedError(Number.isFinite(retryAfter) ? retryAfter : 5);
  }
  if (status && status >= 500) {
    return new UpstreamError(`openai answered ${status}`, { service: SERVICE, status, cause: err });
  }
  if (status && status >= 400) {
    return new UpstreamError(err.message || `openai refused with ${status}`, {
      service: SERVICE,
      status,
      retryable: false,
      cause: err,
    });
  }
  // No status at all is a socket problem, and those are worth one more go.
  return new UpstreamError(err.message || 'openai did not answer', {
    service: SERVICE,
    cause: err,
  });
}

function parseJsonAnswer(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ValidationError('the model did not answer with json', [
      { key: 'content', problem: 'unparseable json' },
    ]);
  }
}

/**
 * Wraps the SDK with the desk's own retry policy rather than the SDK's,
 * because the desk wants the retries counted and logged against a job.
 */
function createClient({
  apiKey,
  model,
  baseURL = undefined,
  timeoutMs = 30000,
  attempts = 3,
  sdk = null,
  sleep = undefined,
} = {}) {
  if (!apiKey && !sdk) {
    throw new ValidationError('an openai key is needed to run extraction', [
      { key: 'OPENAI_API_KEY', problem: 'missing' },
    ]);
  }

  const openai = sdk || new OpenAI({ apiKey, baseURL, timeout: timeoutMs, maxRetries: 0 });

  /**
   * One structured call. The model is told to answer as json and the answer is
   * parsed here, so callers only ever see an object or a desk error.
   */
  async function completeJson({
    system,
    user,
    temperature = 0,
    maxTokens = 1500,
    onRetry = null,
  }) {
    const started = Date.now();

    const response = await withRetry(
      async () => {
        try {
          return await openai.chat.completions.create({
            model,
            temperature,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          });
        } catch (err) {
          throw classify(err);
        }
      },
      {
        attempts,
        sleep,
        onRetry,
        baseDelayMs: 800,
        shouldRetry: (err) => Boolean(err && err.retryable),
      },
    );

    const choice = response.choices && response.choices[0];
    if (!choice || !choice.message || typeof choice.message.content !== 'string') {
      throw new UpstreamError('openai answered with no content', {
        service: SERVICE,
        retryable: false,
      });
    }
    if (choice.finish_reason === 'length') {
      throw new UpstreamError('the answer was cut off before it was valid json', {
        service: SERVICE,
        retryable: false,
      });
    }

    return {
      data: parseJsonAnswer(choice.message.content),
      raw: choice.message.content,
      model: response.model || model,
      usage: {
        promptTokens: response.usage ? response.usage.prompt_tokens : 0,
        completionTokens: response.usage ? response.usage.completion_tokens : 0,
      },
      elapsedMs: Date.now() - started,
    };
  }

  return { completeJson, model };
}

module.exports = { createClient, classify, parseJsonAnswer, delayFromError, SERVICE };
