'use strict';

const {
  GAUGES,
  SOUND_FORMATS,
  isGauge,
  isSoundFormat,
  soundChain,
  playableSoundFormat,
  boothRunsGauge,
} = require('../../../src/domain/formats');

describe('physical formats', () => {
  it('keeps the vocabulary closed', () => {
    expect(isGauge('35mm')).toBe(true);
    expect(isGauge('32mm')).toBe(false);
    expect(isSoundFormat('dolby-sr')).toBe(true);
    expect(isSoundFormat('atmos')).toBe(false);
    expect(Object.isFrozen(GAUGES)).toBe(true);
    expect(Object.isFrozen(SOUND_FORMATS)).toBe(true);
  });

  it('walks a sound track down to the track printed beside it', () => {
    expect(soundChain('dolby-digital')).toEqual([
      'dolby-digital',
      'dolby-sr',
      'dolby-a',
      'optical-stereo',
      'optical-mono',
    ]);
    expect(soundChain('optical-mono')).toEqual(['optical-mono']);
    expect(soundChain('magnetic-6track')).toEqual(['magnetic-6track', 'magnetic-4track']);
  });

  it('picks the best track a booth can actually reproduce', () => {
    expect(playableSoundFormat('dts', ['optical-mono', 'dolby-a'])).toBe('dolby-a');
    expect(playableSoundFormat('dts', ['dts', 'dolby-sr'])).toBe('dts');
    expect(playableSoundFormat('dolby-sr', ['optical-mono'])).toBe('optical-mono');
  });

  it('says no when a booth can play none of the chain', () => {
    expect(playableSoundFormat('magnetic-6track', ['optical-mono', 'dolby-a'])).toBeNull();
  });

  it('runs a silent print in any booth', () => {
    expect(playableSoundFormat('silent', [])).toBe('silent');
  });

  it('lets a standard gate run its super variant', () => {
    expect(boothRunsGauge('super16', ['16mm'])).toBe(true);
    expect(boothRunsGauge('super8', ['8mm'])).toBe(true);
    expect(boothRunsGauge('16mm', ['super16'])).toBe(false);
    expect(boothRunsGauge('70mm', ['35mm'])).toBe(false);
    expect(boothRunsGauge('35mm', ['16mm', '35mm'])).toBe(true);
  });
});
