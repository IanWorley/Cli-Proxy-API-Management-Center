import { apiClient } from './client';
import type {
  RoutingDecision,
  RoutingDecisionCandidate,
  RoutingQuotaAccount,
  RoutingQuotaReport,
  RoutingQuotaTier,
  RoutingQuotaWindow,
} from '@/types/routingQuota';

const ROUTING_QUOTA_STATUS_PATH = '/routing/quota-status';
const TIERS: readonly RoutingQuotaTier[] = ['ranked', 'fallback', 'exhausted'];

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asInstant = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
};

const asTier = (value: unknown): RoutingQuotaTier | null =>
  TIERS.find((tier) => tier === value) ?? null;

const asPercent = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;

const asPositiveInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

function normalizeWindow(value: unknown): RoutingQuotaWindow | null {
  const entry = asRecord(value);
  const name = asString(entry.name);
  if (!name) return null;
  return {
    name,
    kind: entry.kind === 'long' ? 'long' : 'short',
    modelScoped: entry.model_scoped === true,
    remainingPercent: asPercent(entry.remaining_percent),
    exhausted: entry.exhausted === true,
    resetAtMs: asInstant(entry.reset_at),
  };
}

function normalizeAccount(value: unknown): RoutingQuotaAccount | null {
  const entry = asRecord(value);
  const authIndex = asString(entry.auth_index);
  if (!authIndex) return null;
  const windows = Array.isArray(entry.windows) ? entry.windows : [];
  return {
    authIndex,
    provider: asString(entry.provider),
    priority:
      typeof entry.priority === 'number' && Number.isFinite(entry.priority) ? entry.priority : 0,
    eligible: entry.eligible === true,
    rank: asPositiveInteger(entry.rank),
    reason: asString(entry.reason) || 'unknown',
    tier: asTier(entry.tier),
    rankingWindow: asString(entry.ranking_window),
    rankingResetAtMs: asInstant(entry.ranking_reset_at),
    blockingWindow: asString(entry.blocking_window),
    blockedUntilMs: asInstant(entry.blocked_until),
    observedAtMs: asInstant(entry.observed_at),
    stale: entry.stale === true,
    windows: windows.map(normalizeWindow).filter((window) => window !== null),
  };
}

function normalizeCandidate(value: unknown): RoutingDecisionCandidate | null {
  const entry = asRecord(value);
  const authIndex = asString(entry.auth_index);
  const tier = asTier(entry.tier);
  if (!authIndex || !tier) return null;
  return {
    authIndex,
    tier,
    reason: asString(entry.reason) || 'unknown',
    rankingWindow: asString(entry.ranking_window),
    rankingResetAtMs: asInstant(entry.ranking_reset_at),
    blockingWindow: asString(entry.blocking_window),
    blockedUntilMs: asInstant(entry.blocked_until),
  };
}

function normalizeDecision(value: unknown): RoutingDecision | null {
  const entry = asRecord(value);
  const atMs = asInstant(entry.at);
  if (atMs === null) return null;
  const candidates = Array.isArray(entry.candidates) ? entry.candidates : [];
  return {
    atMs,
    kind: asString(entry.kind) || 'unknown',
    provider: asString(entry.provider),
    model: asString(entry.model),
    selectedAuthIndex: asString(entry.selected_auth_index),
    previousAuthIndex: asString(entry.previous_auth_index),
    repeat: asPositiveInteger(entry.repeat) ?? 1,
    candidates: candidates.map(normalizeCandidate).filter((candidate) => candidate !== null),
  };
}

export function normalizeRoutingQuotaReport(payload: unknown): RoutingQuotaReport {
  const root = asRecord(payload);
  const accounts = Array.isArray(root.accounts) ? root.accounts : [];
  const decisions = Array.isArray(root.decisions) ? root.decisions : [];
  const provider = asString(root.provider);
  const model = asString(root.model);
  return {
    active: root.active === true,
    evaluatedAtMs: asInstant(root.evaluated_at),
    provider,
    model,
    staleAfterSeconds: asPositiveInteger(root.stale_after_seconds) ?? 0,
    accounts: accounts.map(normalizeAccount).filter((account) => account !== null),
    decisions: decisions
      .map(normalizeDecision)
      .filter((decision) => decision !== null)
      .filter(
        (decision) =>
          (!provider || decision.provider === provider) && (!model || decision.model === model)
      ),
  };
}

export interface RoutingQuotaQuery {
  provider?: string;
  model?: string;
}

export const routingQuotaApi = {
  getStatus: async ({ provider, model }: RoutingQuotaQuery = {}): Promise<RoutingQuotaReport> => {
    const params: Record<string, string> = {};
    if (provider?.trim()) params.provider = provider.trim();
    if (model?.trim()) params.model = model.trim();
    const payload = await apiClient.getManagementV8<unknown>(ROUTING_QUOTA_STATUS_PATH, { params });
    return normalizeRoutingQuotaReport(payload);
  },
};
