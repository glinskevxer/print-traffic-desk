'use strict';

const reports = require('../../services/reportService');
const { table, minor } = require('../table');
const { localDateOf, assertIsoDate } = require('../../lib/dates');

const KINDS = ['licences', 'lapsing', 'shelf', 'licensor'];

module.exports = {
  name: 'report',
  describe: `print a report on the terminal: ${KINDS.join(', ')}`,
  options: {
    kind: { type: 'string', required: true, describe: `one of ${KINDS.join(', ')}` },
    asOf: { type: 'string', describe: 'treat this date as today' },
    from: { type: 'string', describe: 'first day of the period' },
    to: { type: 'string', describe: 'last day of the period' },
    holder: { type: 'string', describe: 'narrow to one licensor' },
    withinDays: { type: 'number', default: 60, describe: 'how far ahead to look' },
  },
  async run({ options, out }) {
    const asOf = options.asOf
      ? assertIsoDate(options.asOf, 'asOf')
      : localDateOf(new Date(), 'Europe/London');

    if (options.kind === 'licences') {
      const report = await reports.licenceUtilisation({ asOf, rightsHolderId: options.holder });
      out(
        table(report.windows, [
          { header: 'title', pick: (row) => row.title },
          { header: 'holder', pick: (row) => row.holder },
          { header: 'territory', pick: (row) => row.territory },
          { header: 'ends', pick: (row) => row.endsOn },
          { header: 'days', pick: (row) => row.daysLeft, align: 'right' },
          { header: 'used', pick: (row) => row.used, align: 'right' },
          { header: 'cap', pick: (row) => row.cap ?? 'none', align: 'right' },
          { header: 'at risk', pick: (row) => (row.atRisk ? 'yes' : '') },
        ]),
      );
      out(
        `\n${report.windows.length} live licences, ${report.atRisk} at risk, ${report.unused} unused`,
      );
      return 0;
    }

    if (options.kind === 'lapsing') {
      const windows = await reports.lapsingSoon({ asOf, withinDays: options.withinDays });
      out(
        table(windows, [
          { header: 'licence', pick: (row) => row.window },
          { header: 'territory', pick: (row) => row.territory },
          { header: 'ends', pick: (row) => row.endsOn },
          { header: 'days', pick: (row) => row.daysLeft, align: 'right' },
          { header: 'used', pick: (row) => row.used, align: 'right' },
        ]),
      );
      out(`\n${windows.length} licences lapse within ${options.withinDays} days`);
      return 0;
    }

    if (options.kind === 'shelf') {
      const summary = await reports.shelfSummary();
      const rows = Object.entries(summary.byStatus).map(([status, count]) => ({ status, count }));
      out(
        table(rows, [
          { header: 'status', pick: (row) => row.status },
          { header: 'prints', pick: (row) => row.count, align: 'right' },
        ]),
      );
      out(`\ngrades: ${JSON.stringify(summary.byGrade)}`);
      out(`gauges: ${JSON.stringify(summary.byGauge)}`);
      out(`${summary.total} prints, ${summary.dueInspection} due a look`);
      return 0;
    }

    if (options.kind === 'licensor') {
      if (!options.holder || !options.from || !options.to) {
        out('a licensor report needs --holder, --from and --to');
        return 64;
      }
      const summary = await reports.licensorSummary({
        rightsHolderId: options.holder,
        from: options.from,
        to: options.to,
      });
      out(`${summary.holder}, ${summary.from} to ${summary.to}`);
      out(
        table(summary.titles, [
          { header: 'title', pick: (row) => row.title },
          { header: 'year', pick: (row) => row.year, align: 'right' },
          { header: 'screenings', pick: (row) => row.screenings, align: 'right' },
          { header: 'admissions', pick: (row) => row.admissions, align: 'right' },
          { header: 'gross', pick: (row) => minor(row.grossMinor), align: 'right' },
          { header: 'royalty', pick: (row) => minor(row.royaltyMinor), align: 'right' },
        ]),
      );
      out(
        `\n${summary.totals.screenings} screenings, ${summary.totals.admissions} admissions, ` +
          `${minor(summary.totals.royaltyMinor)} ${summary.currency} owed`,
      );
      return 0;
    }

    out(`printdesk report: ${options.kind} is not a report, try ${KINDS.join(', ')}`);
    return 64;
  },
};
