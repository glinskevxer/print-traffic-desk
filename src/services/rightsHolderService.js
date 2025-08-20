'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { ConflictError, RuleRefusedError } = require('../lib/errors');
const { paginate } = require('../lib/pagination');
const { exponentFor } = require('../lib/money');

async function createRightsHolder(input) {
  const { RightsHolder } = models();
  exponentFor(input.remittanceCurrency);

  if (input.contacts.length === 0) {
    throw new RuleRefusedError('a rights holder needs at least one contact to book through', {
      name: input.name,
    });
  }

  try {
    return await RightsHolder.create(input);
  } catch (err) {
    if (err.code === 11000) {
      throw new ConflictError(`${input.name} is already on file`, { name: input.name });
    }
    throw err;
  }
}

async function getRightsHolder(publicId) {
  const { RightsHolder } = models();
  const holder = await required(RightsHolder, publicId);
  return holder;
}

async function listRightsHolders(query = {}) {
  const { RightsHolder } = models();
  const filter = {};
  if (query.kind) filter.kind = query.kind;
  if (query.active !== undefined) filter.active = query.active;
  if (query.territory) {
    filter.territoriesRepresented = { $in: [query.territory, 'EU', 'WORLD'] };
  }

  return paginate(RightsHolder, {
    filter,
    sortField: query.sortBy || 'name',
    order: query.order,
    limit: query.limit,
    cursor: query.cursor,
  });
}

const EDITABLE = ['legalName', 'territoriesRepresented', 'contacts', 'settlementDays', 'notes'];

async function updateRightsHolder(publicId, patch) {
  const holder = await getRightsHolder(publicId);

  if (patch.contacts && patch.contacts.length === 0) {
    throw new RuleRefusedError('a rights holder cannot be left with no contact', {
      rightsHolder: publicId,
    });
  }
  for (const field of EDITABLE) {
    if (patch[field] !== undefined) holder.set(field, patch[field]);
  }
  await holder.save();
  return holder;
}

/**
 * The remittance currency is the one every statement to this holder is drawn
 * in. Changing it after money has been booked would restate history, so it is
 * only allowed while nothing has settled against them.
 */
async function setRemittanceCurrency(publicId, currency) {
  const { Title } = models();
  const holder = await getRightsHolder(publicId);
  exponentFor(currency);

  if (holder.remittanceCurrency === currency) return holder;

  const titles = await Title.countDocuments({ rightsHolder: holder._id, status: 'bookable' });
  if (titles > 0) {
    throw new RuleRefusedError('this holder already has bookable titles in another currency', {
      rightsHolder: publicId,
      bookableTitles: titles,
      current: holder.remittanceCurrency,
    });
  }

  holder.remittanceCurrency = currency;
  await holder.save();
  return holder;
}

async function deactivate(publicId) {
  const { Title } = models();
  const holder = await getRightsHolder(publicId);

  const bookable = await Title.countDocuments({ rightsHolder: holder._id, status: 'bookable' });
  if (bookable > 0) {
    throw new RuleRefusedError('withdraw their bookable titles first', {
      rightsHolder: publicId,
      bookableTitles: bookable,
    });
  }

  holder.active = false;
  await holder.save();
  return holder;
}

module.exports = {
  createRightsHolder,
  getRightsHolder,
  listRightsHolders,
  updateRightsHolder,
  setRemittanceCurrency,
  deactivate,
  EDITABLE,
};
