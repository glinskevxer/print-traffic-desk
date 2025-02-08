'use strict';

const { newId } = require('../../lib/ids');

/**
 * Everything the desk stores carries a prefixed public id. Mongo's _id never
 * leaves the process: booking references and element ids get printed on
 * despatch notes and quoted back over the phone.
 */
function basePlugin(schema, { prefix }) {
  if (!prefix) throw new TypeError('basePlugin needs an id prefix');

  schema.add({
    publicId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: () => newId(prefix),
    },
  });

  schema.set('timestamps', true);
  schema.set('versionKey', 'revision');
  schema.set('optimisticConcurrency', true);

  // Mongoose's own `id` virtual is the hex _id, which must never be published.
  schema.set('id', false);
  schema.set('toJSON', {
    virtuals: true,
    transform(_doc, ret) {
      const { _id: mongoId, publicId, ...rest } = ret;
      void mongoId;
      return { id: publicId, ...rest };
    },
  });

  schema.statics.byPublicId = function byPublicId(publicId, options = {}) {
    return this.findOne({ publicId }, null, options);
  };

  return schema;
}

module.exports = { basePlugin };
