/**
 * Explains the backend's soonest-quota-reset routing: per-account eligibility,
 * remaining quota, reset times, data freshness, and recent selection decisions.
 * The backend makes every routing decision; this panel only displays its report.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Collapsible } from '@/components/ui/Collapsible';
import { Input } from '@/components/ui/Input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { useNow } from '@/hooks/useNow';
import { routingQuotaApi } from '@/services/api';
import type { AuthFileItem } from '@/types';
import type {
  RoutingDecision,
  RoutingQuotaAccount,
  RoutingQuotaReport,
  RoutingQuotaWindow,
} from '@/types/routingQuota';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota';
import {
  buildAuthNameIndex,
  freshnessState,
  quotaDataState,
  shortAuthIndex,
} from '../routingInsights';
import styles from './RoutingInsights.module.scss';

const SECONDS_PER_MINUTE = 60;
/** Skipped candidates listed per decision; the rest are summarized as a count. */
const MAX_SKIPPED_CANDIDATES_SHOWN = 3;
const I18N = 'quota_management.routing';

interface RoutingQuery {
  provider: string;
  model: string;
}

type ReportState =
  | { kind: 'loading'; query: RoutingQuery }
  | { kind: 'loaded'; query: RoutingQuery; report: RoutingQuotaReport }
  | { kind: 'failed'; query: RoutingQuery; message: string };

export interface RoutingInsightsProps {
  files: readonly AuthFileItem[];
  /** Quota tab id; `all` evaluates every provider. */
  provider: string;
  disabled: boolean;
}

export function RoutingInsights({ files, provider, disabled }: RoutingInsightsProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const [reportState, setReportState] = useState<ReportState | null>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [model, setModel] = useState('');
  // The report is fetched only while the panel is expanded.
  const [open, setOpen] = useState(false);
  const requestRef = useRef(0);

  const providerFilter = provider === 'all' ? '' : provider;
  const currentState =
    !disabled && reportState?.query.provider === providerFilter && reportState.query.model === model
      ? reportState
      : null;
  const report = currentState?.kind === 'loaded' ? currentState.report : null;
  const loading = open && !disabled && (currentState === null || currentState.kind === 'loading');
  const error = currentState?.kind === 'failed' ? currentState.message : '';

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (disabled) {
      setReportState(null);
      return;
    }
    const query = { provider: providerFilter, model };
    setReportState({ kind: 'loading', query });
    try {
      const next = await routingQuotaApi.getStatus(query);
      if (requestId !== requestRef.current) return;
      setReportState({ kind: 'loaded', query, report: next });
    } catch (err: unknown) {
      if (requestId !== requestRef.current) return;
      setReportState({
        kind: 'failed',
        query,
        message: err instanceof Error ? err.message : t(`${I18N}.load_failed`),
      });
    }
  }, [disabled, model, providerFilter, t]);

  useEffect(() => {
    if (!open) return;
    void load();
    return () => {
      // Responses for a previous provider/model/connection must not overwrite newer state.
      requestRef.current += 1;
    };
  }, [load, open]);

  const nameByIndex = useMemo(() => buildAuthNameIndex(files), [files]);
  const accountName = useCallback(
    (authIndex: string) =>
      nameByIndex.get(authIndex) ??
      t(`${I18N}.unknown_account`, { index: shortAuthIndex(authIndex) }),
    [nameByIndex, t]
  );

  const relative = useCallback(
    (ms: number) => formatRelativeInstant(ms, now, i18n.language),
    [i18n.language, now]
  );

  const handleModelSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setModel(modelDraft.trim());
  };

  return (
    <Collapsible
      className={styles.panel}
      label={t(`${I18N}.title`)}
      hint={t(`${I18N}.subtitle`)}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <div className={styles.body}>
        {report && !report.active && (
          <p className={styles.notice} role="note">
            {t(`${I18N}.inactive_notice`)}
          </p>
        )}

        <form className={styles.controls} onSubmit={handleModelSubmit}>
          <Input
            className={styles.modelInput}
            label={t(`${I18N}.model_label`)}
            placeholder={t(`${I18N}.model_placeholder`)}
            hint={t(`${I18N}.model_hint`)}
            value={modelDraft}
            onChange={(event) => setModelDraft(event.target.value)}
            disabled={disabled}
          />
          <Button type="submit" variant="secondary" size="sm" disabled={disabled || loading}>
            {t(`${I18N}.apply`)}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            disabled={disabled || loading}
          >
            {t(`${I18N}.refresh`)}
          </Button>
        </form>

        {loading && (
          <p className={styles.empty} role="status">
            {t(`${I18N}.loading`)}
          </p>
        )}

        {report && (
          <p className={styles.fallbackNote}>
            {t(`${I18N}.fallback_note`, {
              minutes: Math.round(report.staleAfterSeconds / SECONDS_PER_MINUTE),
            })}
          </p>
        )}

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        {report && report.accounts.length === 0 && !error && (
          <p className={styles.empty}>{t(`${I18N}.empty`)}</p>
        )}

        {report && report.accounts.length > 0 && (
          <Table aria-label={t(`${I18N}.accounts_label`)}>
            <TableHeader>
              <TableRow>
                <TableHead>{t(`${I18N}.col_order`)}</TableHead>
                <TableHead>{t(`${I18N}.col_account`)}</TableHead>
                <TableHead>{t(`${I18N}.col_eligibility`)}</TableHead>
                <TableHead>{t(`${I18N}.col_quota`)}</TableHead>
                <TableHead>{t(`${I18N}.col_ranking_reset`)}</TableHead>
                <TableHead>{t(`${I18N}.col_freshness`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.accounts.map((account) => (
                <AccountRow
                  key={account.authIndex}
                  account={account}
                  name={accountName(account.authIndex)}
                  relative={relative}
                />
              ))}
            </TableBody>
          </Table>
        )}

        {report && (
          <section className={styles.decisions} aria-labelledby="routing-decisions-title">
            <h3 id="routing-decisions-title" className={styles.decisionsTitle}>
              {t(`${I18N}.decisions_title`)}
            </h3>
            {report.decisions.length === 0 ? (
              <p className={styles.empty}>{t(`${I18N}.decisions_empty`)}</p>
            ) : (
              <ol className={styles.decisionList}>
                {report.decisions.map((decision, index) => (
                  <DecisionItem
                    key={`${index}:${decision.atMs}:${decision.selectedAuthIndex}`}
                    decision={decision}
                    accountName={accountName}
                    relative={relative}
                  />
                ))}
              </ol>
            )}
          </section>
        )}
      </div>
    </Collapsible>
  );
}

interface AccountRowProps {
  account: RoutingQuotaAccount;
  name: string;
  relative: (ms: number) => string;
}

function AccountRow({ account, name, relative }: AccountRowProps) {
  const { t } = useTranslation();
  const dataState = quotaDataState(account);
  const freshness = freshnessState(account);

  return (
    <TableRow>
      <TableCell className={styles.rank}>{account.rank ? `#${account.rank}` : '—'}</TableCell>
      <TableCell>
        <div className={styles.account}>{name}</div>
        <div className={styles.muted}>
          {account.provider} · {t(`${I18N}.priority`, { priority: account.priority })}
        </div>
      </TableCell>
      <TableCell>
        <span className={account.eligible ? styles.badgeEligible : styles.badgeSkipped}>
          {account.eligible ? t(`${I18N}.eligible`) : t(`${I18N}.skipped`)}
        </span>
        <div className={styles.reason}>
          {t(`${I18N}.reason.${account.reason}`, { defaultValue: account.reason })}
          {account.blockedUntilMs !== null &&
            ` · ${t(`${I18N}.until`, { time: relative(account.blockedUntilMs) })}`}
        </div>
      </TableCell>
      <TableCell>
        {account.windows.length > 0 && (
          <ul className={styles.windows}>
            {account.windows.map((window) => (
              <WindowItem key={window.name} window={window} relative={relative} />
            ))}
          </ul>
        )}
        {/* Unavailable data is never shown as exhausted: it only means nothing usable was reported. */}
        {dataState === 'unavailable' && (
          <span className={styles.unavailable}>{t(`${I18N}.quota_unavailable`)}</span>
        )}
      </TableCell>
      <TableCell>
        {account.rankingResetAtMs !== null ? (
          <>
            <div>{relative(account.rankingResetAtMs)}</div>
            <div className={styles.muted}>
              {formatInstantShort(account.rankingResetAtMs)} · {account.rankingWindow}
            </div>
          </>
        ) : (
          <span className={styles.muted}>{t(`${I18N}.no_ranking_reset`)}</span>
        )}
      </TableCell>
      <TableCell>
        {account.observedAtMs === null ? (
          <span className={styles.unavailable}>{t(`${I18N}.freshness_never`)}</span>
        ) : (
          <span className={freshness === 'stale' ? styles.stale : undefined}>
            {t(`${I18N}.freshness_${freshness}`, {
              time: relative(account.observedAtMs),
            })}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

function WindowItem({
  window,
  relative,
}: {
  window: RoutingQuotaWindow;
  relative: (ms: number) => string;
}) {
  const { t } = useTranslation();
  const remaining = window.exhausted
    ? t(`${I18N}.window_exhausted`)
    : window.remainingPercent === null
      ? t(`${I18N}.window_usage_unknown`)
      : t(`${I18N}.window_remaining`, { percent: Math.round(window.remainingPercent) });
  return (
    <li className={window.exhausted ? styles.windowExhausted : styles.window}>
      <span className={styles.windowName}>
        {window.name}
        {window.modelScoped && ` (${t(`${I18N}.model_scoped`)})`}
      </span>{' '}
      {remaining}
      {window.resetAtMs !== null &&
        ` · ${t(`${I18N}.resets`, { time: relative(window.resetAtMs) })}`}
    </li>
  );
}

interface DecisionItemProps {
  decision: RoutingDecision;
  accountName: (authIndex: string) => string;
  relative: (ms: number) => string;
}

function DecisionItem({ decision, accountName, relative }: DecisionItemProps) {
  const { t } = useTranslation();
  const skipped = decision.candidates.filter(
    (candidate) => candidate.authIndex !== decision.selectedAuthIndex
  );
  const shown = skipped.slice(0, MAX_SKIPPED_CANDIDATES_SHOWN);
  const selected = decision.candidates.find(
    (candidate) => candidate.authIndex === decision.selectedAuthIndex
  );

  return (
    <li className={styles.decision}>
      <div className={styles.decisionHead}>
        <span className={styles.kind}>
          {t(`${I18N}.kind.${decision.kind}`, { defaultValue: decision.kind })}
        </span>
        <span className={styles.muted}>
          {relative(decision.atMs)}
          {decision.repeat > 1 && ` · ${t(`${I18N}.repeat`, { count: decision.repeat })}`}
        </span>
        <span className={styles.muted}>
          {decision.provider}
          {decision.model && ` · ${decision.model}`}
        </span>
      </div>
      <div>
        {decision.selectedAuthIndex ? (
          <>
            {t(`${I18N}.selected`, { account: accountName(decision.selectedAuthIndex) })}
            {selected &&
              ` — ${t(`${I18N}.reason.${selected.reason}`, { defaultValue: selected.reason })}`}
          </>
        ) : (
          <span className={styles.unavailable}>{t(`${I18N}.none_selected`)}</span>
        )}
        {decision.previousAuthIndex && (
          <span className={styles.muted}>
            {' '}
            {t(`${I18N}.failed_over_from`, { account: accountName(decision.previousAuthIndex) })}
          </span>
        )}
      </div>
      {shown.length > 0 && (
        <ul className={styles.skippedList}>
          {shown.map((candidate) => (
            <li key={candidate.authIndex} className={styles.muted}>
              {accountName(candidate.authIndex)} —{' '}
              {t(`${I18N}.reason.${candidate.reason}`, { defaultValue: candidate.reason })}
              {candidate.rankingResetAtMs !== null &&
                ` · ${t(`${I18N}.resets`, { time: relative(candidate.rankingResetAtMs) })}`}
              {candidate.blockedUntilMs !== null &&
                ` · ${t(`${I18N}.until`, { time: relative(candidate.blockedUntilMs) })}`}
            </li>
          ))}
          {skipped.length > shown.length && (
            <li className={styles.muted}>
              {t(`${I18N}.more_candidates`, { count: skipped.length - shown.length })}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
