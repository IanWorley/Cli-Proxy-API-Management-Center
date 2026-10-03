import { describe, expect, test } from 'bun:test';
import { normalizeRoutingQuotaReport } from '../src/services/api/routingQuota';
import {
  buildAuthNameIndex,
  freshnessState,
  quotaDataState,
} from '../src/features/quota/routingInsights';
import type { RoutingQuotaAccount } from '../src/types/routingQuota';

const backendReport = {
  active: true,
  evaluated_at: '2026-10-02T12:00:00Z',
  stale_after_seconds: 3600,
  accounts: [
    {
      auth_index: 'aaaa1111bbbb2222',
      provider: 'claude',
      priority: 0,
      eligible: true,
      rank: 1,
      reason: 'soonest_reset',
      tier: 'ranked',
      ranking_window: '7d',
      ranking_reset_at: '2026-10-03T12:00:00Z',
      observed_at: '2026-10-02T11:59:00Z',
      stale: false,
      windows: [
        {
          name: '7d',
          kind: 'long',
          remaining_percent: 70,
          exhausted: false,
          reset_at: '2026-10-03T12:00:00Z',
        },
      ],
    },
    { provider: 'claude', reason: 'missing auth index is dropped' },
  ],
  decisions: [
    {
      at: '2026-10-02T11:58:00Z',
      kind: 'failover',
      provider: 'claude',
      selected_auth_index: 'aaaa1111bbbb2222',
      previous_auth_index: 'cccc3333dddd4444',
      repeat: 2,
      candidates: [
        { auth_index: 'aaaa1111bbbb2222', tier: 'ranked', reason: 'soonest_reset' },
        { auth_index: 'eeee5555ffff6666', tier: 'not-a-tier', reason: 'x' },
      ],
    },
  ],
};

const account = (overrides: Partial<RoutingQuotaAccount>): RoutingQuotaAccount => ({
  authIndex: 'idx',
  provider: 'claude',
  priority: 0,
  eligible: true,
  rank: 1,
  reason: 'soonest_reset',
  tier: 'ranked',
  rankingWindow: '7d',
  rankingResetAtMs: Date.parse('2026-10-03T12:00:00Z'),
  blockingWindow: '',
  blockedUntilMs: null,
  observedAtMs: Date.parse('2026-10-02T11:59:00Z'),
  stale: false,
  windows: [],
  ...overrides,
});

describe('routing quota report normalization', () => {
  test('keeps decisions within the response provider and canonical model scope', () => {
    const report = normalizeRoutingQuotaReport({
      provider: 'claude',
      model: 'sonnet',
      decisions: [
        {
          at: '2026-10-02T11:58:00Z',
          provider: 'claude',
          model: 'sonnet',
          selected_auth_index: 'matching',
        },
        {
          at: '2026-10-02T11:57:00Z',
          provider: 'codex',
          model: 'sonnet',
          selected_auth_index: 'other-provider',
        },
        {
          at: '2026-10-02T11:56:00Z',
          provider: 'claude',
          model: 'opus',
          selected_auth_index: 'other-model',
        },
      ],
    });

    expect(report.provider).toBe('claude');
    expect(report.model).toBe('sonnet');
    expect(report.decisions.map((decision) => decision.selectedAuthIndex)).toEqual(['matching']);
  });

  test('includes every model for a provider-only response', () => {
    const report = normalizeRoutingQuotaReport({
      provider: 'claude',
      decisions: [
        {
          at: '2026-10-02T11:58:00Z',
          provider: 'claude',
          model: 'sonnet',
          selected_auth_index: 'sonnet-account',
        },
        {
          at: '2026-10-02T11:57:00Z',
          provider: 'claude',
          model: 'opus',
          selected_auth_index: 'opus-account',
        },
        {
          at: '2026-10-02T11:56:00Z',
          provider: 'codex',
          model: 'sonnet',
          selected_auth_index: 'other-provider',
        },
      ],
    });

    expect(report.model).toBe('');
    expect(report.decisions.map((decision) => decision.selectedAuthIndex)).toEqual([
      'sonnet-account',
      'opus-account',
    ]);
  });

  test('maps backend fields and drops entries without a safe identifier or known tier', () => {
    const report = normalizeRoutingQuotaReport(backendReport);

    expect(report.active).toBe(true);
    expect(report.staleAfterSeconds).toBe(3600);
    expect(report.accounts).toHaveLength(1);
    expect(report.accounts[0]).toMatchObject({
      authIndex: 'aaaa1111bbbb2222',
      rank: 1,
      tier: 'ranked',
      rankingResetAtMs: Date.parse('2026-10-03T12:00:00Z'),
    });
    expect(report.accounts[0].windows[0]).toMatchObject({ remainingPercent: 70, kind: 'long' });
    expect(report.decisions[0]).toMatchObject({
      kind: 'failover',
      previousAuthIndex: 'cccc3333dddd4444',
      repeat: 2,
    });
    expect(report.decisions[0].candidates.map((candidate) => candidate.authIndex)).toEqual([
      'aaaa1111bbbb2222',
    ]);
  });

  test('keeps unreported usage as null instead of inventing a value', () => {
    const report = normalizeRoutingQuotaReport({
      accounts: [{ auth_index: 'x', windows: [{ name: '5h', kind: 'short', exhausted: false }] }],
    });
    expect(report.accounts[0].windows[0].remainingPercent).toBeNull();
    expect(report.accounts[0].windows[0].resetAtMs).toBeNull();
  });
});

describe('routing insights data states', () => {
  test('distinguishes unavailable quota data from exhausted quota', () => {
    expect(
      quotaDataState(account({ tier: 'fallback', reason: 'quota_data_missing', rank: 2 }))
    ).toBe('unavailable');
    expect(
      quotaDataState(
        account({
          eligible: false,
          tier: 'exhausted',
          reason: 'short_window_exhausted',
          windows: [
            {
              name: '5h',
              kind: 'short',
              modelScoped: false,
              remainingPercent: 0,
              exhausted: true,
              resetAtMs: null,
            },
          ],
        })
      )
    ).toBe('exhausted');
    expect(quotaDataState(account({}))).toBe('available');
  });

  test('reports freshness from the observation time', () => {
    expect(freshnessState(account({ observedAtMs: null }))).toBe('never');
    expect(freshnessState(account({ stale: true }))).toBe('stale');
    expect(freshnessState(account({}))).toBe('fresh');
  });

  test('resolves auth indexes to auth file names', () => {
    const names = buildAuthNameIndex([
      { name: 'claude-work.json', authIndex: 'aaaa1111bbbb2222' },
      { name: 'no-index.json' },
    ]);
    expect(names.get('aaaa1111bbbb2222')).toBe('claude-work.json');
    expect(names.size).toBe(1);
  });
});
