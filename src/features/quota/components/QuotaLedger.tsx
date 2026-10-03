/**
 * Ledger view: a per-provider summary strip above one row per credential.
 *
 * Every limit is rendered with equal weight — label, percent, meter and reset
 * line — in both the summary and the rows. No limit is collapsed or dimmed:
 * a weekly account cap matters as much as a per-model one when deciding which
 * credential to route to.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import { buildResetDisplay, resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { QUOTA_TAB_ORDER } from '../constants';
import {
  buildLedgerMetrics,
  ledgerPlanLabel,
  summarizeLedger,
  type LedgerLabel,
  type LedgerMetric,
  type LedgerSummaryMetric,
} from '../ledgerModel';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import { QUOTA_PROGRESS_HIGH_THRESHOLD, QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './QuotaMeter';
import styles from './QuotaLedger.module.scss';

const SKELETON_METRIC_COUNT = 2;

const resolveLabel = (t: TFunction, label: LedgerLabel): string =>
  'key' in label ? t(label.key, label.params ?? {}) : label.text;

const levelClass = (percent: number | null): string =>
  percent === null
    ? ''
    : percent >= QUOTA_PROGRESS_HIGH_THRESHOLD
      ? styles.levelHigh
      : percent >= QUOTA_PROGRESS_MEDIUM_THRESHOLD
        ? styles.levelMedium
        : styles.levelLow;

const formatPercent = (value: number | null) => (value === null ? '--' : `${Math.round(value)}%`);

/** Groups entries by provider in tab order, preserving the incoming order within a group. */
const groupByProvider = (entries: readonly QuotaFileEntry[]) =>
  QUOTA_TAB_ORDER.map((type) => ({
    type,
    entries: entries.filter((entry) => entry.type === type),
  })).filter((group) => group.entries.length > 0);

function ProviderIcon({
  type,
  resolvedTheme,
}: {
  type: QuotaProviderType;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  const iconSrc = getAuthFileIcon(type, resolvedTheme);
  return (
    <span
      className={styles.iconWrap}
      style={
        isThemeSurfaceIconProvider(type)
          ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
          : undefined
      }
    >
      {iconSrc ? (
        <img src={iconSrc} alt="" className={styles.icon} />
      ) : (
        <span className={styles.iconFallback}>{getTypeLabel(t, type).slice(0, 1)}</span>
      )}
    </span>
  );
}

function ResetLine({
  resetAtMs,
  resetLabel,
  now,
}: {
  resetAtMs: number | null;
  resetLabel: string | null;
  now: number;
}) {
  const { t, i18n } = useTranslation();
  const display = buildResetDisplay(resetLabel, resetAtMs, now, i18n.resolvedLanguage);
  if (!display) {
    return <span className={styles.reset}>{t('quota_management.ledger_no_reset')}</span>;
  }
  return (
    <span className={styles.reset}>
      {display.relative && <span className={styles.resetRelative}>{display.relative}</span>}
      {display.relative && <span aria-hidden="true"> · </span>}
      <span>{display.absolute}</span>
    </span>
  );
}

/* ------------------------------------------------------------ summary strip */

export interface QuotaSummaryStripProps {
  entries: readonly QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
}

function SummaryMetric({ metric, now }: { metric: LedgerSummaryMetric; now: number }) {
  const { t } = useTranslation();
  return (
    <div className={styles.summaryMetric}>
      <span className={styles.metricLabel}>{resolveLabel(t, metric.label)}</span>
      <div className={styles.summaryFigure}>
        <span className={styles.summaryValue}>{formatPercent(metric.remainingTotal)}</span>
        <span className={styles.summaryCapacity}>
          {t('quota_management.ledger_of_capacity', { capacity: metric.capacity })}
        </span>
      </div>
      <div className={styles.segments} aria-hidden="true">
        {metric.segments.map((segment, index) => (
          <span key={index} className={styles.segment}>
            <span
              className={`${styles.segmentFill} ${levelClass(segment)}`}
              style={{ width: `${segment ?? 0}%` }}
            />
          </span>
        ))}
      </div>
      <ResetLine resetAtMs={metric.nextResetMs} resetLabel={null} now={now} />
    </div>
  );
}

export function QuotaSummaryStrip({ entries, quotaFor, resolvedTheme }: QuotaSummaryStripProps) {
  const { t } = useTranslation();
  const now = useNow();
  const groups = useMemo(
    () =>
      groupByProvider(entries).map((group) => ({
        ...group,
        metrics: summarizeLedger(
          group.entries.map((entry) => buildLedgerMetrics(entry.type, quotaFor(entry))),
          now
        ),
      })),
    [entries, quotaFor, now]
  );

  if (groups.length === 0) return null;

  return (
    <section
      className={styles.summaryStrip}
      aria-label={t('quota_management.ledger_summary_label')}
    >
      {groups.map((group) => (
        <article key={group.type} className={styles.summaryCard}>
          <header className={styles.summaryHead}>
            <ProviderIcon type={group.type} resolvedTheme={resolvedTheme} />
            <span className={styles.summaryProvider}>{getTypeLabel(t, group.type)}</span>
            <span className={styles.summaryCount}>
              {t('quota_management.ledger_credentials', { count: group.entries.length })}
            </span>
          </header>
          {group.metrics.length === 0 ? (
            <span className={styles.reset}>{t('quota_management.ledger_not_loaded')}</span>
          ) : (
            group.metrics.map((metric) => (
              <SummaryMetric key={metric.id} metric={metric} now={now} />
            ))
          )}
        </article>
      ))}
    </section>
  );
}

/* ------------------------------------------------------------ rows */

export interface QuotaLedgerProps {
  entries: readonly QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  canRefresh: (entry: QuotaFileEntry) => boolean;
  resettingName: string | null;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
}

function LedgerMetricCell({ metric, now }: { metric: LedgerMetric; now: number }) {
  const { t } = useTranslation();
  return (
    <div className={styles.metric}>
      <div className={styles.metricHead}>
        <span className={styles.metricLabel}>{resolveLabel(t, metric.label)}</span>
        <span className={styles.metricValue}>{formatPercent(metric.remaining)}</span>
      </div>
      <span className={styles.track} aria-hidden="true">
        <span
          className={`${styles.trackFill} ${levelClass(metric.remaining)}`}
          style={{ width: `${metric.remaining ?? 0}%` }}
        />
      </span>
      <ResetLine resetAtMs={metric.resetAtMs} resetLabel={metric.resetLabel} now={now} />
    </div>
  );
}

function LedgerRow({
  entry,
  quota,
  canRefresh,
  resetting,
  onRefresh,
  onReset,
  now,
}: {
  entry: QuotaFileEntry;
  quota: QuotaCardState | undefined;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
  now: number;
}) {
  const { t } = useTranslation();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const displayName = getQuotaDisplayName(entry.file);
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const metrics = buildLedgerMetrics(entry.type, quota);
  const plan = ledgerPlanLabel(entry.type, quota);
  const showReset =
    status === 'success' &&
    quota !== undefined &&
    Boolean(adapter.resetQuota) &&
    Boolean(adapter.canResetQuota?.(quota));

  let body;
  if (status === 'idle') {
    body = (
      <button type="button" className={styles.idle} onClick={onRefresh} disabled={!canRefresh}>
        {t(`${adapter.i18nPrefix}.idle`)}
      </button>
    );
  } else if (loading) {
    body = (
      <div className={styles.metrics} aria-busy="true">
        <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
        {Array.from({ length: SKELETON_METRIC_COUNT }, (_, index) => (
          <div key={index} className={`${styles.metric} ${styles.skeleton}`} aria-hidden="true" />
        ))}
      </div>
    );
  } else if (status === 'error') {
    body = (
      <div className={styles.error} role="alert">
        {t(`${adapter.i18nPrefix}.load_failed`, {
          message: resolveQuotaErrorMessage(
            t,
            quota?.errorStatus,
            quota?.error || t('common.unknown_error')
          ),
        })}
      </div>
    );
  } else if (metrics.length === 0) {
    body = <div className={styles.reset}>{t('quota_management.ledger_empty')}</div>;
  } else {
    body = (
      <div className={styles.metrics}>
        {metrics.map((metric) => (
          <LedgerMetricCell key={metric.id} metric={metric} now={now} />
        ))}
      </div>
    );
  }

  return (
    <li className={styles.row}>
      <div className={styles.identity}>
        <span className={styles.fileName} title={displayName}>
          {displayName}
        </span>
        {plan && <span className={styles.plan}>{resolveLabel(t, plan)}</span>}
      </div>
      {body}
      <div className={styles.actions}>
        {showReset && (
          <button
            type="button"
            className={styles.action}
            onClick={onReset}
            disabled={!canRefresh || loading || resetting}
          >
            <IconRefreshCw size={13} className={resetting ? styles.spinning : undefined} />
            {t('codex_quota.reset_button')}
          </button>
        )}
        <button
          type="button"
          className={styles.action}
          onClick={onRefresh}
          disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting)}
          title={t('auth_files.quota_refresh_hint')}
        >
          <IconRefreshCw size={13} className={loading ? styles.spinning : undefined} />
          {t('auth_files.quota_refresh_single')}
        </button>
      </div>
    </li>
  );
}

export function QuotaLedger(props: QuotaLedgerProps) {
  const { entries, quotaFor, canRefresh, resettingName, onRefresh, onReset } = props;
  const { t } = useTranslation();
  const now = useNow();
  const groups = useMemo(() => groupByProvider(entries), [entries]);

  return (
    <div className={styles.ledger}>
      {groups.map((group) => (
        <section key={group.type} className={styles.group}>
          <h2 className={styles.groupTitle}>
            {getTypeLabel(t, group.type)}
            <span className={styles.groupCount}>{group.entries.length}</span>
          </h2>
          <ul className={styles.rows}>
            {group.entries.map((entry) => {
              const key = getQuotaCacheKey(entry.file);
              return (
                <LedgerRow
                  key={`${entry.type}:${key}`}
                  entry={entry}
                  quota={quotaFor(entry)}
                  canRefresh={canRefresh(entry)}
                  resetting={resettingName === key}
                  onRefresh={() => onRefresh(entry)}
                  onReset={() => onReset(entry)}
                  now={now}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
