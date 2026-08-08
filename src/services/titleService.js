'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { withTransaction } = require('../db/connection');
const audit = require('../lib/audit');
const { parseCsv, blankToNull } = require('../lib/csv');
const { listWith, guardDuplicates } = require('../db/listing');
const { ConflictError, RuleRefusedError } = require('../lib/errors');

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

  return guardDuplicates(() => Title.create({ ...input, slug, rightsHolder: holder._id }), {
    message: `a title is already slugged ${slug}`,
    details: { slug },
  });
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

  return listWith(Title, { filter, query, sortField: 'slug' });
}

const EDITABLE = [
  'title',
  'originalTitle',
  'year',
  'credits',
  'countries',
  'originalLanguages',
  'runtimeMinutes',
  'synopsis',
];

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

/**
 * Folds one catalogue entry into another.
 *
 * A circuit ends up with two records for one film about twice a year: somebody
 * types the original title, somebody else types the release title, and both
 * get prints hung off them. Deleting either loses the history, so the loser
 * keeps its id, is marked withdrawn, and points at the winner.
 */
async function mergeTitles({ keepId, foldId, reason }) {
  const { Title, PrintElement, RightsWindow, Booking } = models();

  if (!reason) {
    throw new RuleRefusedError('folding one catalogue entry into another needs a reason', {});
  }
  if (keepId === foldId) {
    throw new RuleRefusedError('those are the same catalogue entry', { title: keepId });
  }

  return withTransaction(async (session) => {
    const keep = await required(Title, keepId, { session });
    const fold = await required(Title, foldId, { session });

    if (fold.status === 'withdrawn' && fold.mergedInto) {
      throw new RuleRefusedError('that entry has already been folded into another', {
        title: foldId,
        mergedInto: fold.mergedInto,
      });
    }
    if (String(keep.rightsHolder) !== String(fold.rightsHolder)) {
      throw new RuleRefusedError('those entries are licensed by different parties', {
        keep: keepId,
        fold: foldId,
      });
    }

    const [elements, windows, live] = await Promise.all([
      PrintElement.updateMany({ title: fold._id }, { $set: { title: keep._id } }, { session }),
      RightsWindow.updateMany({ title: fold._id }, { $set: { title: keep._id } }, { session }),
      Booking.countDocuments(
        { title: fold._id, status: { $in: ['held', 'cleared', 'confirmed'] } },
        { session },
      ),
    ]);

    if (live > 0) {
      throw new RuleRefusedError('that entry still has live bookings, move them first', {
        title: foldId,
        bookings: live,
      });
    }

    fold.status = 'withdrawn';
    fold.withdrawnReason = `folded into ${keep.slug}: ${reason}`;
    fold.mergedInto = keep._id;
    await fold.save({ session });

    await audit.record(
      {
        action: 'title.merged',
        subjectType: 'title',
        subjectId: fold.publicId,
        changes: [{ field: 'mergedInto', before: null, after: keep.publicId }],
        metadata: {
          reason,
          keptSlug: keep.slug,
          elementsMoved: elements.modifiedCount,
          licencesMoved: windows.modifiedCount,
        },
      },
      { session },
    );

    return {
      keep,
      fold,
      elementsMoved: elements.modifiedCount,
      licencesMoved: windows.modifiedCount,
    };
  });
}

/**
 * Takes the catalogue an archive already keeps, usually exported out of
 * whatever they used before.
 *
 * Same rule as the venue import: nothing is written until every row reads, and
 * a title already on file by slug is left alone rather than overwritten. An
 * import that silently changed the year on forty records would be worse than
 * one that refused.
 */
const IMPORT_COLUMNS = Object.freeze([
  'title',
  'year',
  'slug',
  'originalTitle',
  'director',
  'countries',
  'languages',
  'runtimeMinutes',
]);

function rowToTitle(row, line, rightsHolder) {
  const problems = [];
  const name = blankToNull(row.title);
  const year = Number(blankToNull(row.year));

  if (!name) problems.push('title is missing');
  if (!Number.isInteger(year) || year < 1888 || year > 2100) {
    problems.push(`${row.year || 'nothing'} is not a year a film was made in`);
  }

  const directors = (blankToNull(row.director) || '')
    .split(/[;|]/)
    .map((value) => value.trim())
    .filter(Boolean);

  const runtime = blankToNull(row.runtimeMinutes);
  if (runtime !== null && !Number.isInteger(Number(runtime))) {
    problems.push('runtimeMinutes is not a number');
  }

  return {
    line,
    problems,
    title: {
      title: name,
      year,
      slug: blankToNull(row.slug) || undefined,
      originalTitle: blankToNull(row.originalTitle) || undefined,
      credits: directors.map((who) => ({ name: who, role: 'director' })),
      countries: splitCodes(row.countries, (code) => code.toUpperCase()),
      originalLanguages: splitCodes(row.languages, (code) => code.toLowerCase()),
      runtimeMinutes: runtime === null ? undefined : Number(runtime),
      rightsHolderId: rightsHolder,
    },
  };
}

function splitCodes(value, normalise) {
  return (blankToNull(value) || '')
    .split(/[;|,]/)
    .map((code) => normalise(code.trim()))
    .filter(Boolean);
}

async function importTitles(text, { rightsHolderId, dryRun = false }) {
  const { Title } = models();
  const { headers, rows } = parseCsv(text);

  const missingColumns = ['title', 'year'].filter((name) => !headers.includes(name));
  if (missingColumns.length > 0) {
    throw new RuleRefusedError('that file is missing columns the desk needs', {
      missing: missingColumns,
      expected: IMPORT_COLUMNS,
    });
  }

  const read = rows.map((row, index) => rowToTitle(row, index + 2, rightsHolderId));
  const broken = read.filter((entry) => entry.problems.length > 0);
  if (broken.length > 0) {
    throw new RuleRefusedError('that file has rows the desk cannot read', {
      rows: broken.map((entry) => ({ line: entry.line, problems: entry.problems })),
    });
  }

  const wanted = read.map((entry) => entry.title.slug).filter(Boolean);
  const onFile = wanted.length
    ? (await Title.find({ slug: { $in: wanted } }, 'slug')).map((each) => each.slug)
    : [];
  const toAdd = read.filter((entry) => !onFile.includes(entry.title.slug));

  if (dryRun) {
    return { read: read.length, added: 0, wouldAdd: toAdd.length, skipped: onFile, dryRun: true };
  }

  const added = [];
  for (const entry of toAdd) {
    // eslint-disable-next-line no-await-in-loop
    const created = await createTitle(entry.title);
    added.push(created.slug);
  }

  return {
    read: read.length,
    added: added.length,
    wouldAdd: 0,
    slugs: added,
    skipped: onFile,
    dryRun: false,
  };
}

module.exports = {
  importTitles,
  IMPORT_COLUMNS,
  mergeTitles,
  slugify,
  uniqueSlug,
  createTitle,
  getTitle,
  listTitles,
  updateTitle,
  setTitleStatus,
  EDITABLE,
};
