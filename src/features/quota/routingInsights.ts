/**
 * Pure helpers for the routing insights panel. The backend makes every routing
 * decision; these helpers only shape its report for display.
 */

import type { AuthFileItem } from '@/types';
import type { RoutingQuotaAccount } from '@/types/routingQuota';

/** Characters of an auth index shown when no auth file matches it. */
const SHORT_AUTH_INDEX_LENGTH = 8;

/** Reasons that mean the provider never reported quota, as opposed to reporting none left. */
const UNAVAILABLE_QUOTA_REASONS = new Set([
  'quota_data_unsupported',
  'quota_data_missing',
  'quota_data_stale',
  'no_weekly_reset',
]);

/**
 * How the panel describes an account's quota data. `unavailable` (no usable data)
 * and `exhausted` (the provider reported no allowance left) must never be conflated.
 */
export type QuotaDataState = 'available' | 'exhausted' | 'unavailable';

export function quotaDataState(account: RoutingQuotaAccount): QuotaDataState {
  if (account.tier === 'exhausted' || account.windows.some((window) => window.exhausted)) {
    return 'exhausted';
  }
  if (account.tier === 'ranked') return 'available';
  if (account.tier === null || UNAVAILABLE_QUOTA_REASONS.has(account.reason)) return 'unavailable';
  return account.windows.length > 0 ? 'available' : 'unavailable';
}

export type FreshnessState = 'fresh' | 'stale' | 'never';

export function freshnessState(account: RoutingQuotaAccount): FreshnessState {
  if (account.observedAtMs === null) return 'never';
  return account.stale ? 'stale' : 'fresh';
}

/** Maps auth index to the auth file name the user already sees elsewhere. */
export function buildAuthNameIndex(files: readonly AuthFileItem[]): Map<string, string> {
  const names = new Map<string, string>();
  files.forEach((file) => {
    const index =
      file.authIndex === null || file.authIndex === undefined ? '' : String(file.authIndex);
    if (index.trim() && file.name) names.set(index.trim(), file.name);
  });
  return names;
}

export function shortAuthIndex(authIndex: string): string {
  return authIndex.slice(0, SHORT_AUTH_INDEX_LENGTH);
}
