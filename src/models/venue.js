'use strict';

const { Schema } = require('mongoose');
const { basePlugin } = require('./plugins/base');
const { GAUGES, SOUND_FORMATS, PROJECTION_SPEEDS } = require('../domain/formats');
const { playableSoundFormat, boothRunsGauge } = require('../domain/formats');

const addressSchema = new Schema(
  {
    line1: { type: String, required: true, trim: true, maxlength: 160 },
    line2: { type: String, trim: true, maxlength: 160 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    postcode: { type: String, required: true, trim: true, maxlength: 20 },
    territory: { type: String, required: true, match: [/^[A-Z]{2}$/, 'territory must be alpha-2'] },
    attention: { type: String, trim: true, maxlength: 120 },
  },
  { _id: false },
);

const boothSchema = new Schema(
  {
    gauges: {
      type: [String],
      required: true,
      enum: GAUGES,
      validate: { validator: (v) => v.length > 0, message: 'a booth runs at least one gauge' },
    },
    soundFormats: { type: [String], default: ['optical-mono'], enum: SOUND_FORMATS },
    speeds: { type: [Number], default: [24], enum: PROJECTION_SPEEDS },
    platterEquipped: { type: Boolean, default: false },
    changeoverCapable: { type: Boolean, default: true },
    nitrateCertified: { type: Boolean, default: false },
    reelCapacity: { type: Number, default: 6, min: 1, max: 30 },
    projectionistOnStaff: { type: Boolean, default: true },
  },
  { _id: false },
);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A house shuts for a refit, a flood or a summer break, and the desk should
 * refuse the booking rather than send a print to a building with the doors
 * locked. Closures are dated ranges rather than a flag, because a programmer
 * books three months ahead and wants to know now.
 */
const closureSchema = new Schema(
  {
    startsOn: { type: String, required: true, match: [ISO_DATE, 'ISO date'] },
    endsOn: { type: String, required: true, match: [ISO_DATE, 'ISO date'] },
    reason: { type: String, required: true, trim: true, maxlength: 200 },
  },
  { _id: false },
);

const venueSchema = new Schema({
  code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    match: [/^[A-Z]{2}-[A-Z]{2,4}-[A-Z0-9]{3,10}$/, 'code is TERRITORY-CITY-HOUSE'],
  },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  territory: { type: String, required: true, match: [/^[A-Z]{2}$/, 'territory must be alpha-2'] },
  city: { type: String, required: true, trim: true, maxlength: 80 },
  timezone: { type: String, required: true, maxlength: 60 },
  address: { type: addressSchema, required: true },
  booth: { type: boothSchema, required: true },
  seats: { type: Number, required: true, min: 1, max: 6000 },
  boxOfficeCurrency: { type: String, required: true, match: [/^[A-Z]{3}$/, 'ISO 4217 code'] },
  houseNutMinor: { type: Number, default: 0, min: 0 },
  inboundLeadDays: { type: Number, default: 2, min: 0, max: 21 },
  outboundLeadDays: { type: Number, default: 1, min: 0, max: 21 },
  carrierAccount: { type: String, trim: true, maxlength: 60 },
  active: { type: Boolean, default: true },
  closures: { type: [closureSchema], default: [] },
});

venueSchema.plugin(basePlugin, { prefix: 'ven' });
venueSchema.index({ code: 1 }, { unique: true });
venueSchema.index({ territory: 1, city: 1 });
venueSchema.index({ active: 1, territory: 1 });

venueSchema.methods.runsGauge = function runsGauge(gauge) {
  return boothRunsGauge(gauge, this.booth.gauges);
};

venueSchema.methods.bestSoundFor = function bestSoundFor(printFormat) {
  return playableSoundFormat(printFormat, this.booth.soundFormats);
};

venueSchema.methods.runsSpeed = function runsSpeed(fps) {
  return this.booth.speeds.includes(fps);
};

/** The closure covering a date, or null when the house is open. */
venueSchema.methods.closedOn = function closedOn(localDate) {
  return (
    (this.closures || []).find(
      (closure) => closure.startsOn <= localDate && localDate <= closure.endsOn,
    ) || null
  );
};

venueSchema.pre('validate', function orderTheClosures(next) {
  for (const closure of this.closures || []) {
    if (closure.endsOn < closure.startsOn) {
      this.invalidate('closures', 'a closure cannot end before it starts');
    }
  }
  next();
});

module.exports = { name: 'Venue', schema: venueSchema, collection: 'venues' };
