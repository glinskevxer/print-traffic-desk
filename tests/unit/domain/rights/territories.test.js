'use strict';

const {
  REGION_CODES,
  EU,
  isRegion,
  isCountry,
  isTerritory,
  assertTerritory,
  expand,
  covers,
  overlap,
  breadth,
  narrowestFirst,
} = require('../../../../src/domain/rights/territories');
const { ValidationError } = require('../../../../src/lib/errors');

describe('licence territories', () => {
  it('tells a region from a country', () => {
    expect(isRegion('EU')).toBe(true);
    expect(isRegion('GB')).toBe(false);
    expect(isCountry('GB')).toBe(true);
    expect(isCountry('EU')).toBe(false);
    expect(isTerritory('NORDIC')).toBe(true);
    expect(isTerritory('Scandinavia')).toBe(false);
  });

  it('refuses a territory nobody writes licences for', () => {
    expect(() => assertTerritory('Britain')).toThrow(ValidationError);
    expect(() => assertTerritory('gb')).toThrow(/not a territory/);
    expect(assertTerritory('GB')).toBe('GB');
  });

  it('expands a region into the countries it reaches', () => {
    expect(expand('NORDIC')).toEqual(['DK', 'FI', 'IS', 'NO', 'SE']);
    expect(expand('GB')).toEqual(['GB']);
    expect(expand('WORLD')).toBeNull();
    expect(expand('EU')).toEqual(EU);
  });

  it('knows the United Kingdom left the union', () => {
    expect(EU).not.toContain('GB');
    expect(covers('EU', 'GB')).toBe(false);
    expect(covers('EEA', 'GB')).toBe(false);
    expect(covers('UK-IE', 'GB')).toBe(true);
  });

  it('answers whether a licence reaches a screening', () => {
    expect(covers('WORLD', 'JP')).toBe(true);
    expect(covers('EU', 'FR')).toBe(true);
    expect(covers('NORDIC', 'SE')).toBe(true);
    expect(covers('NORDIC', 'DE')).toBe(false);
    expect(covers('FR', 'FR')).toBe(true);
    expect(covers('FR', 'BE')).toBe(false);
  });

  it('will not answer coverage for a region as the screening country', () => {
    expect(() => covers('EU', 'EU')).toThrow(/not a country/);
  });

  it('spots two licences that could fight over the same country', () => {
    expect(overlap('EU', 'NORDIC')).toBe(true);
    expect(overlap('NORDIC', 'DACH')).toBe(false);
    expect(overlap('WORLD', 'JP')).toBe(true);
    expect(overlap('GB', 'GB')).toBe(true);
    expect(overlap('GB', 'IE')).toBe(false);
    expect(overlap('UK-IE', 'EU')).toBe(true);
  });

  it('measures how wide a territory is', () => {
    expect(breadth('GB')).toBe(1);
    expect(breadth('NORDIC')).toBe(5);
    expect(breadth('EU')).toBe(EU.length);
    expect(breadth('WORLD')).toBeGreaterThan(breadth('EU'));
  });

  it('puts the tightest licence first', () => {
    expect(narrowestFirst(['WORLD', 'EU', 'SE', 'NORDIC'])).toEqual(['SE', 'NORDIC', 'EU', 'WORLD']);
  });

  it('breaks a tie on breadth by name so the order is stable', () => {
    expect(narrowestFirst(['SE', 'DK'])).toEqual(['DK', 'SE']);
  });

  it('lists WORLD among the regions it knows', () => {
    expect(REGION_CODES).toContain('WORLD');
  });
});
