/**
 * Soonest-quota-reset routing report returned by `/routing/quota-status`.
 * Accounts are identified only by auth index; the UI resolves display names
 * from the auth-file list it already loaded.
 */

export type RoutingQuotaTier = 'ranked' | 'fallback' | 'exhausted';

export interface RoutingQuotaWindow {
  name: string;
  kind: 'short' | 'long';
  modelScoped: boolean;
  /** Null when the provider did not report usage for this window. */
  remainingPercent: number | null;
  exhausted: boolean;
  resetAtMs: number | null;
}

export interface RoutingQuotaAccount {
  authIndex: string;
  provider: string;
  priority: number;
  eligible: boolean;
  /** 1-based order in which new sessions are assigned; null when not eligible. */
  rank: number | null;
  reason: string;
  tier: RoutingQuotaTier | null;
  rankingWindow: string;
  rankingResetAtMs: number | null;
  blockingWindow: string;
  blockedUntilMs: number | null;
  observedAtMs: number | null;
  stale: boolean;
  windows: RoutingQuotaWindow[];
}

export interface RoutingDecisionCandidate {
  authIndex: string;
  tier: RoutingQuotaTier;
  reason: string;
  rankingWindow: string;
  rankingResetAtMs: number | null;
  blockingWindow: string;
  blockedUntilMs: number | null;
}

export interface RoutingDecision {
  atMs: number;
  kind: string;
  provider: string;
  model: string;
  selectedAuthIndex: string;
  previousAuthIndex: string;
  repeat: number;
  candidates: RoutingDecisionCandidate[];
}

export interface RoutingQuotaReport {
  active: boolean;
  evaluatedAtMs: number | null;
  staleAfterSeconds: number;
  accounts: RoutingQuotaAccount[];
  decisions: RoutingDecision[];
}
