'use strict';

const {
  normaliseInspectionNotes,
  toInspectionInput,
  dropImpossibleReels,
  assertReadable,
} = require('../../../src/ai/normaliseInspectionNotes');
const { systemPrompt, codeTable } = require('../../../src/ai/prompts/inspectionNotes');

const NOTE = 'r2 sprockets chewed around 340ft, bad. r4 two tape splices. smells sharp, 0.8pc';

const element = {
  barcode: 'PE-000123',
  gauge: '35mm',
  kind: 'release-print',
  reelCount: 6,
  footage: 12150,
  baseStock: 'acetate',
};

function clientAnswering(data) {
  const calls = [];
  return {
    calls,
    completeJson: async (request) => {
      calls.push(request);
      return {
        data,
        model: 'gpt-4o-mini-2024-07-18',
        usage: { promptTokens: 600, completionTokens: 90 },
        elapsedMs: 700,
      };
    },
  };
}

const good = {
  findings: [
    { reel: 2, code: 'PERF-TEAR', severity: 'severe', footageMark: 340 },
    { reel: 4, code: 'SPLICE-TAPE', severity: 'minor' },
  ],
  measurements: { shrinkagePercent: 0.8 },
  confidence: 0.82,
};

describe('reading a bench note', () => {
  it('puts the whole code list in the prompt with its plain english', () => {
    const table = codeTable();

    expect(table).toContain('PERF-TEAR - torn perforation (perforation)');
    expect(table).toContain('VINEGAR - vinegar odour (chemical)');
    expect(systemPrompt()).toContain('never invent a finding');
  });

  it('turns shorthand into findings', async () => {
    const client = clientAnswering(good);

    const result = await normaliseInspectionNotes({ client, noteText: NOTE, element });

    expect(result.extracted.findings).toHaveLength(2);
    expect(result.extracted.findings[0].code).toBe('PERF-TEAR');
    expect(result.extracted.measurements.shrinkagePercent).toBe(0.8);
    expect(result.usage.completionTokens).toBe(90);
  });

  it('tells the model what the print is', async () => {
    const client = clientAnswering(good);

    await normaliseInspectionNotes({ client, noteText: NOTE, element });

    expect(client.calls[0].user).toContain('PE-000123');
    expect(client.calls[0].user).toContain('6 reels');
    expect(client.calls[0].user).toContain('acetate base');
  });

  it('refuses a code the inspectors do not use', async () => {
    const client = clientAnswering({
      ...good,
      findings: [{ reel: 1, code: 'LOOKS-ROUGH', severity: 'minor' }],
    });

    await expect(normaliseInspectionNotes({ client, noteText: NOTE, element })).rejects.toThrow(
      /findings this desk cannot use/,
    );
  });

  it('drops a finding on a reel the print does not have', async () => {
    const client = clientAnswering({
      ...good,
      findings: [
        { reel: 2, code: 'PERF-TEAR', severity: 'minor' },
        { reel: 12, code: 'SPLICE-TAPE', severity: 'minor' },
      ],
    });

    const result = await normaliseInspectionNotes({ client, noteText: NOTE, element });

    expect(result.extracted.findings).toHaveLength(1);
    expect(result.extracted.unclear[0].why).toMatch(/reel 12 of a 6 reel print/);
  });

  it('keeps what the model could not read', async () => {
    const client = clientAnswering({
      ...good,
      unclear: [{ field: 'findings', why: 'the note says curly in places' }],
    });

    const result = await normaliseInspectionNotes({ client, noteText: NOTE, element });

    expect(result.extracted.unclear[0].why).toMatch(/curly in places/);
  });

  it('will not send a scribble', async () => {
    const client = clientAnswering(good);

    await expect(normaliseInspectionNotes({ client, noteText: 'ok', element })).rejects.toThrow(
      /not enough of a note/,
    );
    expect(client.calls).toHaveLength(0);
  });

  it('will not send a whole ledger', () => {
    expect(() => assertReadable('x'.repeat(20001))).toThrow(/longer than a bench note/);
  });

  it('splits findings by whether the reel exists', () => {
    const { kept, dropped } = dropImpossibleReels([{ reel: 1 }, { reel: 6 }, { reel: 7 }], 6);

    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(1);
  });

  it('turns an extraction into something an inspector can file', () => {
    const input = toInspectionInput(
      {
        findings: [
          { reel: 2, code: 'PERF-TEAR', severity: 'severe', footageMark: 340, note: null },
          { reel: 4, code: 'SPLICE-TAPE', severity: 'minor', footageMark: null, note: 'both ends' },
        ],
        measurements: { shrinkagePercent: 0.8, adStripLevel: null, warpMillimetres: null },
        confidence: 0.9,
        unclear: [],
      },
      { inspector: 'R. Fitzgerald', kind: 'damage' },
    );

    expect(input.source).toBe('extracted');
    expect(input.kind).toBe('damage');
    expect(input.findings[0]).toEqual({
      reel: 2,
      code: 'PERF-TEAR',
      severity: 'severe',
      footageMark: 340,
    });
    expect(input.findings[1].note).toBe('both ends');
    expect(input.measurements).toEqual({ shrinkagePercent: 0.8 });
  });

  it('files as a routine inspection unless told otherwise', () => {
    const input = toInspectionInput(
      {
        findings: [],
        measurements: { shrinkagePercent: null, adStripLevel: null, warpMillimetres: null },
        confidence: 1,
        unclear: [],
      },
      { inspector: 'A. Novak' },
    );

    expect(input.kind).toBe('routine');
    expect(input.measurements).toEqual({});
  });
});
