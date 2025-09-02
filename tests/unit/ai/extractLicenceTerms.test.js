'use strict';

const {
  extractLicenceTerms,
  toWindowInput,
  fingerprint,
  assertReadable,
} = require('../../../src/ai/extractLicenceTerms');
const { systemPrompt } = require('../../../src/ai/prompts/licenceTerms');
const { ValidationError } = require('../../../src/lib/errors');

const LETTER = [
  'We confirm the licence of THE RED SHOES for repertory exhibition in the',
  'United Kingdom from 1 January 2025 to 31 December 2025 at 35% of the gross.',
].join('\n');

const title = { title: 'The Red Shoes', year: 1948, slug: 'the-red-shoes' };
const rightsHolder = { name: 'Park Circus', remittanceCurrency: 'GBP' };

function clientAnswering(data, overrides = {}) {
  const calls = [];
  return {
    calls,
    completeJson: async (request) => {
      calls.push(request);
      return {
        data,
        model: 'gpt-4o-mini-2024-07-18',
        usage: { promptTokens: 800, completionTokens: 120 },
        elapsedMs: 900,
        ...overrides,
      };
    },
  };
}

const good = {
  territory: 'GB',
  exhibitionTypes: ['repertory'],
  startsOn: '2025-01-01',
  endsOn: '2025-12-31',
  terms: { kind: 'percentage', currency: 'GBP', percentageBps: 3500 },
  confidence: 0.86,
};

describe('reading a licence letter', () => {
  it('tells the model the vocabulary it is allowed to use', () => {
    const prompt = systemPrompt();

    expect(prompt).toContain('NORDIC');
    expect(prompt).toContain('repertory');
    expect(prompt).toContain('split-after-nut');
    expect(prompt).toContain('35% is 3500');
  });

  it('hands the letter back as validated terms', async () => {
    const client = clientAnswering(good);

    const result = await extractLicenceTerms({ client, contractText: LETTER, title, rightsHolder });

    expect(result.extracted.territory).toBe('GB');
    expect(result.extracted.confidence).toBe(0.86);
    expect(result.usage.promptTokens).toBe(800);
    expect(result.promptVersion).toMatch(/^licence-terms\//);
  });

  it('puts what the desk already knows in the prompt', async () => {
    const client = clientAnswering(good);

    await extractLicenceTerms({ client, contractText: LETTER, title, rightsHolder });

    expect(client.calls[0].user).toContain('The Red Shoes (1948)');
    expect(client.calls[0].user).toContain('Park Circus, paid in GBP');
    expect(client.calls[0].user).toContain('BEGIN LETTER');
  });

  it('refuses an answer that names a territory the desk does not licence', async () => {
    const client = clientAnswering({ ...good, territory: 'Scandinavia' });

    await expect(
      extractLicenceTerms({ client, contractText: LETTER, title, rightsHolder }),
    ).rejects.toThrow(/terms this desk cannot use/);
  });

  it('lists every problem with an unusable answer', async () => {
    const client = clientAnswering({ ...good, territory: 'nope', exhibitionTypes: [] });

    let caught;
    try {
      await extractLicenceTerms({ client, contractText: LETTER, title, rightsHolder });
    } catch (err) {
      caught = err;
    }

    expect(caught.details.issues.length).toBeGreaterThan(1);
  });

  it('will not send a scrap of text as a letter', async () => {
    const client = clientAnswering(good);

    await expect(
      extractLicenceTerms({ client, contractText: 'yes ok', title, rightsHolder }),
    ).rejects.toThrow(/not enough of a letter/);
    expect(client.calls).toHaveLength(0);
  });

  it('will not send a whole contract bundle', () => {
    expect(() => assertReadable('x'.repeat(60001))).toThrow(/longer than the desk sends/);
  });

  it('fingerprints the same letter the same way', () => {
    const one = fingerprint({ contractText: LETTER, model: 'm', promptVersion: 'v1' });
    const same = fingerprint({ contractText: `  ${LETTER}  `, model: 'm', promptVersion: 'v1' });
    const other = fingerprint({ contractText: LETTER, model: 'm', promptVersion: 'v2' });

    expect(same).toBe(one);
    expect(other).not.toBe(one);
  });

  it('turns an extraction into what the rights service takes', () => {
    const input = toWindowInput(
      {
        ...good,
        holdbackUntil: null,
        maxScreenings: null,
        maxScreeningsPerVenue: 4,
        blackouts: [{ startsOn: '2025-05-13', endsOn: '2025-05-24', reason: 'Cannes' }],
        terms: {
          kind: 'percentage',
          currency: 'GBP',
          percentageBps: 3500,
          flatFeeMinor: null,
          minimumGuaranteeMinor: 15000,
          capMinor: null,
          houseNutDeductible: false,
        },
      },
      { titleId: 'ttl_A', rightsHolderId: 'rh_A' },
    );

    expect(input.terms).toEqual({
      kind: 'percentage',
      currency: 'GBP',
      percentageBps: 3500,
      minimumGuaranteeMinor: 15000,
      houseNutDeductible: false,
    });
    expect(input.maxScreenings).toBeUndefined();
    expect(input.maxScreeningsPerVenue).toBe(4);
    expect(input.blackouts[0].reason).toBe('Cannes');
  });

  it('drops a blackout reason the model did not find', () => {
    const input = toWindowInput(
      {
        ...good,
        holdbackUntil: null,
        maxScreenings: null,
        maxScreeningsPerVenue: null,
        blackouts: [{ startsOn: '2025-05-13', endsOn: '2025-05-24', reason: null }],
        terms: {
          ...good.terms,
          flatFeeMinor: null,
          minimumGuaranteeMinor: null,
          capMinor: null,
          houseNutDeductible: false,
        },
      },
      { titleId: 'ttl_A', rightsHolderId: 'rh_A' },
    );

    expect(input.blackouts[0]).toEqual({ startsOn: '2025-05-13', endsOn: '2025-05-24' });
  });

  it('raises a validation error, not an upstream one, for a bad answer', async () => {
    const client = clientAnswering({ nonsense: true });

    await expect(
      extractLicenceTerms({ client, contractText: LETTER, title, rightsHolder }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
