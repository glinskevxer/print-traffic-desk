'use strict';

/**
 * The physical vocabulary the desk books against. It is deliberately closed:
 * a booth either has the equipment or it does not, and a free text field here
 * turns into a print shipped to a venue that cannot run it.
 */

const GAUGES = Object.freeze(['8mm', 'super8', '16mm', 'super16', '35mm', '70mm']);

const SOUND_FORMATS = Object.freeze([
  'silent',
  'optical-mono',
  'optical-stereo',
  'dolby-a',
  'dolby-sr',
  'dolby-digital',
  'dts',
  'sdds',
  'magnetic-4track',
  'magnetic-6track',
]);

const ASPECT_RATIOS = Object.freeze([
  '1.19:1',
  '1.33:1',
  '1.37:1',
  '1.66:1',
  '1.75:1',
  '1.85:1',
  '2.20:1',
  '2.35:1',
  '2.39:1',
  '2.55:1',
]);

const BASE_STOCKS = Object.freeze(['nitrate', 'acetate', 'polyester']);

const ELEMENT_KINDS = Object.freeze([
  'release-print',
  'archival-print',
  'restoration-print',
  'dupe-negative',
  'internegative',
  'interpositive',
  'reversal-original',
]);

/** Frames per second a projector has to be able to hold for the print to run. */
const PROJECTION_SPEEDS = Object.freeze([16, 18, 20, 24, 25]);

/**
 * A magnetic track needs penthouse heads a modern booth rarely keeps, and a
 * digital track falls back to the analogue one printed beside it. Anything a
 * booth cannot decode simply plays as its fallback rather than not at all.
 */
const SOUND_FALLBACKS = Object.freeze({
  'dolby-digital': 'dolby-sr',
  dts: 'dolby-sr',
  sdds: 'dolby-sr',
  'dolby-sr': 'dolby-a',
  'dolby-a': 'optical-stereo',
  'optical-stereo': 'optical-mono',
  'magnetic-6track': 'magnetic-4track',
});

function isGauge(value) {
  return GAUGES.includes(value);
}

function isSoundFormat(value) {
  return SOUND_FORMATS.includes(value);
}

/** The chain a print's track can degrade through, best first. */
function soundChain(format) {
  const chain = [];
  let cursor = format;
  while (cursor && !chain.includes(cursor)) {
    chain.push(cursor);
    cursor = SOUND_FALLBACKS[cursor];
  }
  return chain;
}

/** The best track a booth can actually reproduce, or null if it can play none. */
function playableSoundFormat(printFormat, boothFormats) {
  if (printFormat === 'silent') return 'silent';
  for (const candidate of soundChain(printFormat)) {
    if (boothFormats.includes(candidate)) return candidate;
  }
  return null;
}

/**
 * Super 16 and super 8 run through the standard gate of their gauge, so a booth
 * listing 16mm can run super16. Nothing else substitutes.
 */
const GAUGE_SUBSTITUTES = Object.freeze({
  super16: ['16mm'],
  super8: ['8mm'],
});

function boothRunsGauge(printGauge, boothGauges) {
  if (boothGauges.includes(printGauge)) return true;
  return (GAUGE_SUBSTITUTES[printGauge] || []).some((gauge) => boothGauges.includes(gauge));
}

module.exports = {
  GAUGES,
  SOUND_FORMATS,
  ASPECT_RATIOS,
  BASE_STOCKS,
  ELEMENT_KINDS,
  PROJECTION_SPEEDS,
  SOUND_FALLBACKS,
  GAUGE_SUBSTITUTES,
  isGauge,
  isSoundFormat,
  soundChain,
  playableSoundFormat,
  boothRunsGauge,
};
