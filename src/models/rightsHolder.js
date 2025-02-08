'use strict';

const { Schema } = require('mongoose');
const { basePlugin } = require('./plugins/base');

const contactSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: [/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'contact email is not an address'],
    },
    role: {
      type: String,
      enum: ['bookings', 'accounts', 'archive', 'legal'],
      default: 'bookings',
    },
    phone: { type: String, trim: true, maxlength: 40 },
  },
  { _id: false },
);

/**
 * Whoever can licence a title for exhibition: a distributor, an estate, a
 * national archive or the film maker. Territories represented is advisory only,
 * the binding statement is always a rights window.
 */
const rightsHolderSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  legalName: { type: String, trim: true, maxlength: 200 },
  kind: {
    type: String,
    required: true,
    enum: ['distributor', 'archive', 'estate', 'filmmaker', 'sales-agent'],
  },
  territoriesRepresented: {
    type: [String],
    default: [],
    validate: {
      validator: (codes) => codes.every((code) => /^([A-Z]{2}|WORLD|EU)$/.test(code)),
      message: 'territories must be ISO 3166-1 alpha-2, EU or WORLD',
    },
  },
  contacts: { type: [contactSchema], default: [] },
  remittanceCurrency: {
    type: String,
    required: true,
    match: [/^[A-Z]{3}$/, 'remittance currency must be an ISO 4217 code'],
  },
  settlementDays: { type: Number, default: 45, min: 0, max: 365 },
  notes: { type: String, maxlength: 2000 },
  active: { type: Boolean, default: true },
});

rightsHolderSchema.plugin(basePlugin, { prefix: 'rh' });
rightsHolderSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
rightsHolderSchema.index({ kind: 1, active: 1 });

rightsHolderSchema.methods.contactFor = function contactFor(role) {
  return this.contacts.find((contact) => contact.role === role) || this.contacts[0] || null;
};

module.exports = { name: 'RightsHolder', schema: rightsHolderSchema, collection: 'rights_holders' };
