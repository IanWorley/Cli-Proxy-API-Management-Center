/**
 * Ledger view model: every quota limit on a credential, flattened to one shape.
 *
 * The ledger lays credentials out as rows of equal-weight columns and rolls
 * them up into one summary card per provider, so unlike the timeline (which
 * picks a single window) it needs *every* limit, normalized to percent
 * remaining. Pure and React-free — labels come back as i18n keys or raw text
 * for the component to resolve.
 */

import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/types';
import type { QuotaProviderType } from './providers/types';

/** Full capacity of a single limit, in percent. */
export const FULL_PERCENT = 100;

/** Limits at least this long are the provider-level headline in the summary strip. */
export const SUMMARY_MIN_PERIOD_HOURS = 24;

/** Most limits a summary card shows, so a provider with many model buckets stays readable. */
export const SUMMARY_MAX_METRICS = 3;

export type LedgerLabel =
  { key: string; params?: Record<string, string | number> } | { text: string };

export interface LedgerMetric {
  /** Stable across credentials of one provider, so the summary can group by it. */
  id: string;
  label: LedgerLabel;
  /** Percent remaining, 0..100; null when the provider didn't report usage. */
  remaining: number | null;
  resetAtMs: number | null;
  /** Provider-formatted reset text, used when no instant is available. */
  resetLabel: string | null;
  periodHours: number | null;
}

export interface LedgerSummaryMetric {
  id: string;
  label: LedgerLabel;
  /** Sum of known remaining percentages, or null when none is known. */
  remainingTotal: number | null;
  /** FULL_PERCENT for every credential that reports this limit. */
  capacity: number;
  /** One entry per reporting credential, in credential order. */
  segments: (number | null)[];
  /** Soonest reset still in the future. */
  nextResetMs: number | null;
}

const clampPercent = (value: number) => Math.min(FULL_PERCENT, Math.max(0, value));

const remainingFromUsed = (used: number | null | undefined) =>
  typeof used === 'number' && Number.isFinite(used) ? clampPercent(FULL_PERCENT - used) : null;

const finiteOrNull = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const labelOf = (
  labelKey: string | undefined,
  text: string | undefined,
  params?: Record<string, string | number>
): LedgerLabel => (labelKey ? { key: labelKey, params } : { text: text ?? '' });

const HOURS_PER_WEEK = 24 * 7;
const MINUTES_PER_HOUR = 60;
const MS_PER_SECOND = 1000;

/** Every limit a loaded credential reports; empty until the quota has loaded. */
export function buildLedgerMetrics(provider: QuotaProviderType, quota: unknown): LedgerMetric[] {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return [];

  switch (provider) {
    case 'claude':
    case 'codex': {
      const windows = (quota as ClaudeQuotaState | CodexQuotaState).windows ?? [];
      return windows.map((window) => ({
        id: window.id,
        label: labelOf(
          window.labelKey,
          window.label,
          'labelParams' in window ? window.labelParams : undefined
        ),
        remaining: remainingFromUsed(window.usedPercent),
        resetAtMs: finiteOrNull(window.resetAtMs),
        resetLabel: window.resetLabel || null,
        periodHours: finiteOrNull(window.periodHours),
      }));
    }
    case 'devin':
      return ((quota as DevinQuotaState).windows ?? []).map((window) => ({
        id: window.id,
        label: { key: `devin_quota.${window.id}` },
        remaining: finiteOrNull(window.remainingPercent),
        resetAtMs: finiteOrNull(window.resetAtMs),
        resetLabel: null,
        periodHours: window.periodHours,
      }));
    case 'kimi':
      return ((quota as KimiQuotaState).rows ?? []).map((row) => ({
        id: row.id,
        label: labelOf(row.labelKey, row.label, row.labelParams),
        remaining:
          row.limit > 0
            ? clampPercent(Math.round(((row.limit - row.used) / row.limit) * FULL_PERCENT))
            : null,
        resetAtMs: finiteOrNull(row.resetAtMs),
        resetLabel: null,
        periodHours: finiteOrNull(row.periodHours),
      }));
    case 'xai': {
      const billing = (quota as XaiQuotaState).billing;
      if (!billing || billing.mode !== 'billing') return [];
      const weekly = billing.periodType === 'weekly';
      return [
        {
          id: weekly ? 'weekly' : 'monthly',
          label: { key: weekly ? 'xai_quota.weekly_limit' : 'xai_quota.monthly_credits' },
          remaining: remainingFromUsed(billing.usagePercent),
          resetAtMs: finiteOrNull(billing.resetAtMs),
          resetLabel: null,
          periodHours: finiteOrNull(billing.periodHours) ?? (weekly ? HOURS_PER_WEEK : null),
        },
      ];
    }
    case 'antigravity':
      return ((quota as AntigravityQuotaState).groups ?? [])
        .flatMap((group) => group.buckets ?? [])
        .map((bucket) => ({
          id: bucket.id,
          label: { text: bucket.label },
          remaining:
            typeof bucket.remainingFraction === 'number'
              ? clampPercent(Math.round(bucket.remainingFraction * FULL_PERCENT))
              : null,
          resetAtMs: finiteOrNull(bucket.resetAtMs),
          resetLabel: null,
          periodHours: finiteOrNull(bucket.periodHours),
        }));
    case 'meta':
      return ((quota as MetaQuotaState).data?.windows ?? []).map((window) => ({
        id: window.id,
        label: { key: `meta_quota.${window.id}` },
        remaining: remainingFromUsed(window.usedPercent),
        resetAtMs: typeof window.resetAt === 'number' ? window.resetAt * MS_PER_SECOND : null,
        resetLabel: null,
        periodHours:
          window.id === 'weekly'
            ? HOURS_PER_WEEK
            : typeof window.durationMinutes === 'number'
              ? window.durationMinutes / MINUTES_PER_HOUR
              : null,
      }));
  }
}

/**
 * Roll one provider's credentials up into summary metrics.
 *
 * Limits are matched by id across credentials and keep first-seen order.
 * Only long-running limits headline the card — a 5-hour window summed across
 * a fleet says little about the week ahead — unless a provider has nothing
 * longer, in which case every limit is shown rather than an empty card.
 */
export function summarizeLedger(
  metricsPerCredential: readonly LedgerMetric[][],
  nowMs: number
): LedgerSummaryMetric[] {
  const byId = new Map<string, LedgerSummaryMetric & { periodHours: number | null }>();

  for (const metrics of metricsPerCredential) {
    for (const metric of metrics) {
      const summary = byId.get(metric.id) ?? {
        id: metric.id,
        label: metric.label,
        remainingTotal: null,
        capacity: 0,
        segments: [],
        nextResetMs: null,
        periodHours: metric.periodHours,
      };
      summary.capacity += FULL_PERCENT;
      summary.segments.push(metric.remaining);
      if (metric.remaining !== null) {
        summary.remainingTotal = (summary.remainingTotal ?? 0) + metric.remaining;
      }
      if (
        metric.resetAtMs !== null &&
        metric.resetAtMs > nowMs &&
        (summary.nextResetMs === null || metric.resetAtMs < summary.nextResetMs)
      ) {
        summary.nextResetMs = metric.resetAtMs;
      }
      byId.set(metric.id, summary);
    }
  }

  const all = [...byId.values()];
  const long = all.filter(
    (metric) => metric.periodHours === null || metric.periodHours >= SUMMARY_MIN_PERIOD_HOURS
  );
  return (long.length > 0 ? long : all)
    .slice(0, SUMMARY_MAX_METRICS)
    .map(({ periodHours: _periodHours, ...metric }) => metric);
}

/** The plan shown under a credential's name; null when the provider didn't say. */
export function ledgerPlanLabel(provider: QuotaProviderType, quota: unknown): LedgerLabel | null {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return null;

  const text = (value: string | null | undefined): LedgerLabel | null =>
    value ? { text: value } : null;

  switch (provider) {
    case 'claude': {
      const planType = (quota as ClaudeQuotaState).planType;
      return planType ? { key: `claude_quota.${planType}` } : null;
    }
    case 'codex':
      return text((quota as CodexQuotaState).planType);
    case 'devin':
      return text((quota as DevinQuotaState).plan);
    case 'meta':
      return text((quota as MetaQuotaState).data?.planName);
    case 'antigravity': {
      const subscription = (quota as AntigravityQuotaState).subscription;
      return text(subscription?.tierName ?? subscription?.plan);
    }
    case 'xai':
    case 'kimi':
      return null;
  }
}
