'use strict';

const { Schema } = require('mongoose');
const { basePlugin } = require('./plugins/base');

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const creditSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    role: {
      type: String,
      required: true,
      enum: ['director', 'writer', 'cinematographer', 'editor', 'composer', 'producer'],
    },
  },
  { _id: false },
);

/**
 * A film work, not a copy of it. Everything physical hangs off PrintElement,
 * so a restoration and a battered release print are two elements of one title.
 */
const titleSchema = new Schema({
  slug: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: [SLUG_PATTERN, 'slug must be lower case words joined by hyphens'],
    maxlength: 120,
  },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  originalTitle: { type: String, trim: true, maxlength: 200 },
  year: { type: Number, required: true, min: 1888, max: 2100 },
  credits: { type: [creditSchema], default: [] },
  countries: {
    type: [String],
    default: [],
    validate: {
      validator: (codes) => codes.every((code) => /^[A-Z]{2}$/.test(code)),
      message: 'countries must be ISO 3166-1 alpha-2 codes',
    },
  },
  originalLanguages: {
    type: [String],
    default: [],
    validate: {
      validator: (codes) => codes.every((code) => /^[a-z]{2,3}$/.test(code)),
      message: 'languages must be ISO 639 codes',
    },
  },
  runtimeMinutes: { type: Number, min: 1, max: 1500 },
  synopsis: { type: String, maxlength: 4000 },
  rightsHolder: { type: Schema.Types.ObjectId, ref: 'RightsHolder', required: true },
  status: {
    type: String,
    enum: ['draft', 'bookable', 'withdrawn'],
    default: 'draft',
    index: true,
  },
  withdrawnReason: { type: String, maxlength: 500 },
});

titleSchema.plugin(basePlugin, { prefix: 'ttl' });
titleSchema.index({ slug: 1 }, { unique: true });
titleSchema.index({ rightsHolder: 1, status: 1 });
titleSchema.index({ title: 'text', originalTitle: 'text' });

titleSchema.virtual('directors').get(function directors() {
  return this.credits.filter((credit) => credit.role === 'director').map((credit) => credit.name);
});

titleSchema.virtual('displayTitle').get(function displayTitle() {
  return `${this.title} (${this.year})`;
});

titleSchema.methods.isBookable = function isBookable() {
  return this.status === 'bookable';
};

module.exports = { name: 'Title', schema: titleSchema, collection: 'titles', SLUG_PATTERN };
