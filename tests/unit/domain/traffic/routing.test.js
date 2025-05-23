'use strict';

const {
  planOutbound,
  planReturn,
  planRoundTrip,
  commitmentWindow,
} = require('../../../../src/domain/traffic/routing');

const base = {
  fromTerritory: 'GB',
  toTerritory: 'GB',
  outboundLeadDays: 1,
  inboundLeadDays: 2,
  inspectionDays: 0,
  screeningLocalDate: '2025-06-20',
  today: '2025-05-01',
};

describe('planning a print leg', () => {
  it('works the dispatch date backwards from the screening', () => {
    const plan = planOutbound(base);

    expect(plan.feasible).toBe(true);
    expect(plan.dates.screeningLocalDate).toBe('2025-06-20');
    expect(plan.dates.arriveBy).toBe('2025-06-18');
    expect(plan.dates.dispatchOn).toBe('2025-06-17');
    expect(plan.dates.readyBy).toBe('2025-06-16');
  });

  it('steps over a weekend when counting back', () => {
    const plan = planOutbound({ ...base, screeningLocalDate: '2025-06-24', inboundLeadDays: 2 });

    expect(plan.dates.arriveBy).toBe('2025-06-20');
  });

  it('steps over a public holiday at the destination', () => {
    const plan = planOutbound({ ...base, screeningLocalDate: '2025-08-27', inboundLeadDays: 2 });

    expect(plan.dates.arriveBy).toBe('2025-08-22');
  });

  it('picks the quickest permitted service, and sending a person is the last resort', () => {
    const plan = planOutbound(base);

    expect(plan.service).toBe('courier');
  });

  it('takes the service the desk asked for when one is named', () => {
    const plan = planOutbound({ ...base, service: 'road-freight' });

    expect(plan.service).toBe('road-freight');
    expect(plan.quote.totalDays).toBe(3);
  });

  it('adds the customs hold on a leg that leaves the country', () => {
    const domestic = planOutbound({ ...base, service: 'road-freight' });
    const abroad = planOutbound({ ...base, toTerritory: 'FR', service: 'road-freight' });

    expect(abroad.quote.totalDays).toBeGreaterThan(domestic.quote.totalDays);
    expect(abroad.quote.customsDays).toBe(2);
  });

  it('needs both calendars open on a cross border leg', () => {
    const plan = planOutbound({
      ...base,
      toTerritory: 'FR',
      service: 'road-freight',
      screeningLocalDate: '2025-05-12',
    });

    expect(plan.dates.dispatchOn).toBe('2025-04-25');
  });

  it('leaves bench time before despatch when the print is due a look', () => {
    const withInspection = planOutbound({ ...base, inspectionDays: 3 });
    const without = planOutbound(base);

    expect(withInspection.dates.dispatchOn).toBe(without.dates.dispatchOn);
    expect(withInspection.dates.inspectionStartsOn).toBe('2025-06-11');
  });

  it('refuses a date the work could no longer start for', () => {
    const plan = planOutbound({ ...base, screeningLocalDate: '2025-05-02', inspectionDays: 5 });

    expect(plan.feasible).toBe(false);
    expect(plan.reason).toBe('too-late');
    expect(plan.shortfallDays).toBeGreaterThan(0);
    expect(plan.detail).toMatch(/already past/);
  });

  it('reports the slack a plan has left', () => {
    const plan = planOutbound(base);

    expect(plan.slackDays).toBe(46);
  });

  it('keeps a hand carry only nitrate print off freight and off a plane', () => {
    const plan = planOutbound({
      ...base,
      restrictions: ['hand-carry-only'],
      service: null,
      baseStock: 'nitrate',
    });

    expect(plan.feasible).toBe(true);
    expect(['courier', 'hand-carry']).toContain(plan.service);
  });

  it('plans the leg home from the day the house lets go of it', () => {
    const plan = planReturn({
      fromTerritory: 'GB',
      toTerritory: 'GB',
      screeningLocalDate: '2025-06-20',
      holdDaysAfterScreening: 2,
      outboundLeadDays: 1,
      service: 'road-freight',
    });

    expect(plan.dates.dispatchOn).toBe('2025-06-25');
    expect(plan.dates.backOn).toBe('2025-06-30');
  });

  it('answers out and back as one plan', () => {
    const plan = planRoundTrip({ ...base, holdDaysAfterScreening: 1, service: 'road-freight' });

    expect(plan.feasible).toBe(true);
    expect(plan.committedFrom).toBe(plan.outbound.dates.inspectionStartsOn);
    expect(plan.committedUntil).toBe(plan.inbound.dates.backOn);
  });

  it('does not plan a leg home for a trip that cannot go out', () => {
    const plan = planRoundTrip({ ...base, screeningLocalDate: '2025-05-01', inspectionDays: 10 });

    expect(plan.feasible).toBe(false);
    expect(plan.inbound).toBeNull();
  });

  it('hands the booking side the span the print is spoken for', () => {
    const plan = planRoundTrip({ ...base, holdDaysAfterScreening: 1, service: 'road-freight' });

    expect(commitmentWindow(plan)).toEqual({
      startsOn: plan.outbound.dates.inspectionStartsOn,
      endsOn: plan.inbound.dates.backOn,
    });
    expect(commitmentWindow({ feasible: false })).toBeNull();
  });
});
