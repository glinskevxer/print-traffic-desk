'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { ConflictError, RuleRefusedError } = require('../lib/errors');
const { paginate } = require('../lib/pagination');

function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** A slug collides often: two prints of "Solaris" is the normal case. */
async function uniqueSlug(base) {
  const { Title } = models();
  let candidate = base;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await Title.exists({ slug: candidate })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
    if (suffix > 50) throw new ConflictError(`too many titles already slugged ${base}`);
  }
  return candidate;
}

async function createTitle(input) {
  const { Title, RightsHolder } = models();

  const holder = await required(RightsHolder, input.rightsHolderId);
  if (!holder.active) {
    throw new RuleRefusedError('that rights holder is no longer trading', {
      rightsHolder: holder.publicId,
    });
  }

  const slug = input.slug || (await uniqueSlug(slugify(`${input.title}-${input.year}`)));

  try {
    return await Title.create({ ...input, slug, rightsHolder: holder._id });
  } catch (err) {
    if (err.code === 11000) throw new ConflictError(`a title is already slugged ${slug}`, { slug });
    throw err;
  }
}

async function getTitle(publicId) {
  const { Title } = models();
  const title = await required(Title, publicId);
  return title;
}

async function listTitles(query = {}) {
  const { Title, RightsHolder } = models();
  const filter = {};

  if (query.status) filter.status = query.status;
  if (query.year) filter.year = query.year;
  if (query.rightsHolderId) {
    const holder = await required(RightsHolder, query.rightsHolderId);
    filter.rightsHolder = holder._id;
  }
  if (query.search) {
    filter.$or = [
      { title: { $regex: query.search, $options: 'i' } },
      { originalTitle: { $regex: query.search, $options: 'i' } },
    ];
  }

  return paginate(Title, {
    filter,
    sortField: query.sortBy || 'slug',
    order: query.order,
    limit: query.limit,
    cursor: query.cursor,
  });
}

const EDITABLE = ['title', 'originalTitle', 'year', 'credits', 'countries', 'originalLanguages',
  'runtimeMinutes', 'synopsis'];

async function updateTitle(publicId, patch) {
  const title = await getTitle(publicId);
  if (title.status === 'withdrawn') {
    throw new RuleRefusedError('a withdrawn title cannot be edited', { title: publicId });
  }

  for (const field of EDITABLE) {
    if (patch[field] !== undefined) title.set(field, patch[field]);
  }
  await title.save();
  return title;
}

/**
 * Making a title bookable is a decision, not an edit, because the rights desk
 * has to have said the paperwork is in place before a venue can ask for it.
 */
async function setTitleStatus(publicId, status, reason) {
  const title = await getTitle(publicId);

  if (title.status === status) return title;
  if (status === 'draft' && title.status === 'bookable') {
    throw new RuleRefusedError('a bookable title cannot go back to draft, withdraw it instead', {
      title: publicId,
    });
  }
  if (status === 'withdrawn' && !reason) {
    throw new RuleRefusedError('withdrawing a title needs a reason', { title: publicId });
  }

  title.status = status;
  title.withdrawnReason = status === 'withdrawn' ? reason : undefined;
  await title.save();
  return title;
}

module.exports = {
  slugify,
  uniqueSlug,
  createTitle,
  getTitle,
  listTitles,
  updateTitle,
  setTitleStatus,
  EDITABLE,
};
