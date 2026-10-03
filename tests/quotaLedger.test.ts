/**
 * Ledger roll-up: the summary strip sums limits across credentials and only
 * headlines long-running limits, without dropping any of them in favour of one.
 */

import { describe, expect, test } from 'bun:test';
import { buildLedgerMetrics, summarizeLedger } from '@/features/quota/ledgerModel';

const NOW = Date.UTC(2026, 9, 2, 12);
const HOUR = 3_600_000;

const claudeQuota = (fableUsed: number, weeklyUsed: number, resetInHours: number) => ({
  status: 'success',
  windows: [
    {
      id: 'seven-day-fable',
      label: '7-day Fable 5',
      labelKey: 'claude_quota.seven_day_fable',
      usedPercent: fableUsed,
      resetLabel: '',
      resetAtMs: NOW + resetInHours * HOUR,
      periodHours: 168,
    },
    {
      id: 'five-hour',
      label: '5-hour limit',
      labelKey: 'claude_quota.five_hour',
      usedPercent: 0,
      resetLabel: '',
      resetAtMs: null,
      periodHours: 5,
    },
    {
      id: 'seven-day',
      label: '7-day limit',
      labelKey: 'claude_quota.seven_day',
      usedPercent: weeklyUsed,
      resetLabel: '',
      resetAtMs: NOW + resetInHours * HOUR,
      periodHours: 168,
    },
  ],
});

describe('summarizeLedger', () => {
  test('sums every weekly limit across credentials with equal standing', () => {
    const metrics = [claudeQuota(42, 21, 30), claudeQuota(0, 0, 90)].map((quota) =>
      buildLedgerMetrics('claude', quota)
    );

    const summary = summarizeLedger(metrics, NOW);

    expect(summary.map((metric) => metric.id)).toEqual(['seven-day-fable', 'seven-day']);
    expect(summary[0]).toMatchObject({
      remainingTotal: 158,
      capacity: 200,
      segments: [58, 100],
      nextResetMs: NOW + 30 * HOUR,
    });
    expect(summary[1]).toMatchObject({ remainingTotal: 179, capacity: 200 });
  });
});

describe('summarizeLedger segments', () => {
  test('keep one slot per credential, null where a credential lacks the limit', () => {
    const weekly = buildLedgerMetrics('claude', claudeQuota(10, 20, 30)).filter(
      (metric) => metric.id === 'seven-day'
    );

    const [summary] = summarizeLedger([[], weekly], NOW);

    expect(summary).toMatchObject({ segments: [null, 80], capacity: 100 });
  });
});
