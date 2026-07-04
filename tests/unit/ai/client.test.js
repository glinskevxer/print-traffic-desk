'use strict';

const { createClient, classify, parseJsonAnswer } = require('../../../src/ai/client');
const { UpstreamError, RateLimitedError, ValidationError } = require('../../../src/lib/errors');

function fakeSdk(answers) {
  const calls = [];
  return {
    calls,
    chat: {
      completions: {
        create: async (request) => {
          calls.push(request);
          const next = answers.shift();
          if (next instanceof Error) throw next;
          return next;
        },
      },
    },
  };
}

function answer(content, overrides = {}) {
  return {
    model: 'gpt-4o-mini-2024-07-18',
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 45 },
    ...overrides,
  };
}

function httpError(status, headers = {}) {
  const err = new Error(`http ${status}`);
  err.status = status;
  err.headers = headers;
  return err;
}

describe('the openai client', () => {
  it('will not be built without a key', () => {
    expect(() => createClient({ model: 'gpt-4o-mini' })).toThrow(ValidationError);
  });

  it('asks for json and hands back the parsed object', async () => {
    const sdk = fakeSdk([answer('{"territory":"GB"}')]);
    const client = createClient({ sdk, model: 'gpt-4o-mini' });

    const result = await client.completeJson({ system: 'be exact', user: 'the contract' });

    expect(result.data).toEqual({ territory: 'GB' });
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 45 });
    expect(sdk.calls[0].response_format).toEqual({ type: 'json_object' });
    expect(sdk.calls[0].temperature).toBe(0);
  });

  it('sends the system and the user message in that order', async () => {
    const sdk = fakeSdk([answer('{}')]);
    const client = createClient({ sdk, model: 'gpt-4o-mini' });

    await client.completeJson({ system: 'rules', user: 'text' });

    expect(sdk.calls[0].messages).toEqual([
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'text' },
    ]);
  });

  it('retries a 500 and then succeeds', async () => {
    const sdk = fakeSdk([httpError(503), answer('{"ok":true}')]);
    const client = createClient({ sdk, model: 'gpt-4o-mini', sleep: async () => {} });

    const result = await client.completeJson({ system: 's', user: 'u' });

    expect(result.data).toEqual({ ok: true });
    expect(sdk.calls).toHaveLength(2);
  });

  it('does not retry a refused prompt', async () => {
    const sdk = fakeSdk([httpError(400), answer('{}')]);
    const client = createClient({ sdk, model: 'gpt-4o-mini', sleep: async () => {} });

    await expect(client.completeJson({ system: 's', user: 'u' })).rejects.toThrow(UpstreamError);
    expect(sdk.calls).toHaveLength(1);
  });

  it('gives up after the attempts are used', async () => {
    const sdk = fakeSdk([httpError(502), httpError(502), httpError(502)]);
    const client = createClient({ sdk, model: 'gpt-4o-mini', sleep: async () => {}, attempts: 3 });

    await expect(client.completeJson({ system: 's', user: 'u' })).rejects.toThrow(/answered 502/);
    expect(sdk.calls).toHaveLength(3);
  });

  it('refuses an answer that is not json', async () => {
    const sdk = fakeSdk([answer('the contract says GB')]);
    const client = createClient({ sdk, model: 'gpt-4o-mini' });

    await expect(client.completeJson({ system: 's', user: 'u' })).rejects.toThrow(
      /did not answer with json/,
    );
  });

  it('refuses an answer that ran out of room', async () => {
    const sdk = fakeSdk([
      answer('{"partial":', {
        choices: [{ message: { content: '{"a":' }, finish_reason: 'length' }],
      }),
    ]);
    const client = createClient({ sdk, model: 'gpt-4o-mini' });

    await expect(client.completeJson({ system: 's', user: 'u' })).rejects.toThrow(/cut off/);
  });

  it('refuses an answer with no content at all', async () => {
    const sdk = fakeSdk([{ choices: [] }]);
    const client = createClient({ sdk, model: 'gpt-4o-mini' });

    await expect(client.completeJson({ system: 's', user: 'u' })).rejects.toThrow(/no content/);
  });

  it('reads the wait the upstream asked for off a rate limit', () => {
    const limited = classify(httpError(429, { 'retry-after': '12' }));

    expect(limited).toBeInstanceOf(RateLimitedError);
    expect(limited.retryAfterSeconds).toBe(12);
    expect(limited.retryable).toBe(true);
  });

  it('falls back to a short wait when the upstream did not say', () => {
    expect(classify(httpError(429)).retryAfterSeconds).toBe(5);
  });

  it('treats a socket failure as worth one more go', () => {
    const socket = classify(new Error('ETIMEDOUT'));

    expect(socket).toBeInstanceOf(UpstreamError);
    expect(socket.retryable).toBe(true);
  });

  it('parses json or says so plainly', () => {
    expect(parseJsonAnswer('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseJsonAnswer('nope')).toThrow(ValidationError);
  });
});

describe('when the model is having an hour rather than a minute', () => {
  function httpFailure(status) {
    const err = new Error(`http ${status}`);
    err.status = status;
    return err;
  }

  function alwaysDown() {
    const calls = [];
    return {
      calls,
      chat: {
        completions: {
          create: async (request) => {
            calls.push(request);
            throw httpFailure(503);
          },
        },
      },
    };
  }

  it('stops asking once the model has failed enough times in a row', async () => {
    const sdk = alwaysDown();
    const client = createClient({
      sdk,
      model: 'gpt-4o-mini',
      attempts: 1,
      breakerFailures: 2,
      sleep: async () => {},
    });

    await expect(client.completeJson({ system: 's', user: 'u' })).rejects.toThrow(/answered 503/);
    await expect(client.completeJson({ system: 's', user: 'u' })).rejects.toThrow(/answered 503/);
    expect(sdk.calls).toHaveLength(2);

    await expect(client.completeJson({ system: 's', user: 'u' })).rejects.toThrow(
      /not answering, so the desk is not asking/,
    );
    expect(sdk.calls).toHaveLength(2);
  });

  it('answers a caller behind an open breaker with something retryable', async () => {
    const client = createClient({
      sdk: alwaysDown(),
      model: 'gpt-4o-mini',
      attempts: 1,
      breakerFailures: 1,
      sleep: async () => {},
    });
    await client.completeJson({ system: 's', user: 'u' }).catch(() => {});

    let caught;
    try {
      await client.completeJson({ system: 's', user: 'u' });
    } catch (err) {
      caught = err;
    }

    expect(caught.status).toBe(503);
    expect(caught.retryable).toBe(true);
    expect(caught.details.service).toBe('openai');
  });

  it('does not open on an answer the desk could not use', async () => {
    const sdk = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: 'not json at all' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        },
      },
    };
    const client = createClient({ sdk, model: 'gpt-4o-mini', breakerFailures: 2 });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(client.completeJson({ system: 's', user: 'u' })).rejects.toThrow(
        /did not answer with json/,
      );
    }

    expect(client.breaker.state).toBe('closed');
  });

  it('closes again once the model answers', async () => {
    let down = true;
    const sdk = {
      chat: {
        completions: {
          create: async () => {
            if (down) throw httpFailure(503);
            return {
              choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            };
          },
        },
      },
    };
    const client = createClient({
      sdk,
      model: 'gpt-4o-mini',
      attempts: 1,
      breakerFailures: 1,
      breakerOpenMs: 0,
      sleep: async () => {},
    });

    await client.completeJson({ system: 's', user: 'u' }).catch(() => {});
    down = false;

    const answer = await client.completeJson({ system: 's', user: 'u' });
    expect(answer.data).toEqual({ ok: true });
    expect(client.breaker.state).toBe('closed');
  });
});
