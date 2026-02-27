'use strict';

const outbox = require('../../lib/outbox');
const { drain } = require('../../workers/outboxWorker');

module.exports = {
  name: 'outbox',
  describe: 'send what the desk owes, or look at what is stuck',
  options: {
    limit: { type: 'number', default: 25, describe: 'how many messages to send in one pass' },
    webhook: { type: 'string', describe: 'post messages here instead of writing them to the log' },
    list: { type: 'boolean', alias: 'l', describe: 'list what is queued rather than sending it' },
    status: { type: 'string', describe: 'only messages in this state' },
    requeue: { type: 'string', describe: 'put one abandoned message back' },
  },
  async run({ options, out, log }) {
    if (options.requeue) {
      const message = await outbox.requeue(options.requeue);
      out(message ? `${message.publicId} is queued again` : `no message ${options.requeue}`);
      return message ? 0 : 1;
    }

    if (options.list) {
      const page = await outbox.listMessages({ status: options.status, limit: options.limit });
      for (const message of page.items) {
        out(
          `${message.status.padEnd(10)} ${message.kind.padEnd(22)} ${message.to.padEnd(16)} ${
            message.lastError || ''
          }`,
        );
      }
      out(`${page.items.length} messages, ${await outbox.pendingCount()} due now`);
      return 0;
    }

    const results = await drain({ limit: options.limit, log, webhookUrl: options.webhook });
    out(`claimed ${results.claimed}, sent ${results.sent}, failed ${results.failed}`);
    return 0;
  },
};
