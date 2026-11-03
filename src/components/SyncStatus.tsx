'use client';

import { useEffect, useState } from 'react';
import {
  CHECK_INTERVAL_MS,
  SAFETY_DISCLAIMER,
  lastSyncedText,
  staleNote,
  syncFreshness,
  type SyncFreshness,
  type SyncSource,
} from '@/lib/sync-status';

const TONE: Record<SyncFreshness, string> = {
  recent: '#4ade80',
  stale: '#d4a843',
  old: '#e8526e',
  never: '#7a9bbf',
};

const BADGE: Record<SyncFreshness, string> = {
  recent: 'Recent',
  stale: 'Stale',
  old: 'Out of date',
  never: 'No data',
};

/** Re-renders on an interval so "3 hours ago" keeps counting up. */
export function useNow(intervalMs: number = CHECK_INTERVAL_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function SyncSourceList({
  sources,
  emptyText = 'No data source has synced yet.',
  theme = 'dark',
}: {
  sources: SyncSource[] | null | undefined;
  emptyText?: string;
  theme?: 'dark' | 'light';
}) {
  const light = theme === 'light';
  const now = useNow();
  const list = sources ?? [];
  if (list.length === 0) {
    return (
      <div style={{ fontSize: 11, color: '#7a9bbf', lineHeight: 1.5 }} data-testid="sync-empty">
        {emptyText}
      </div>
    );
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }} aria-label="Last synced per data source">
      {list.map((s) => {
        const f = syncFreshness(s.last_synced_at, now);
        const note = staleNote(f);
        const exact = s.last_synced_at ? new Date(s.last_synced_at).toLocaleString() : undefined;
        return (
          <li
            key={s.source}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 8,
              padding: '7px 10px',
              borderRadius: 9,
              background: light ? '#f8fafc' : 'rgba(0,0,0,0.18)',
              border: `1px solid ${f === 'recent' ? (light ? '#e2e8f0' : 'rgba(255,255,255,0.06)') : TONE[f] + '55'}`,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: light ? '#0f172a' : '#eef2f8' }}>{s.label}</div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: light && f === 'recent' ? '#15803d' : TONE[f], marginTop: 2 }} title={exact}>
                {lastSyncedText(s.last_synced_at, now)}
              </div>
              {note && <div style={{ fontSize: 10, color: light ? '#475569' : '#a3b5cc', marginTop: 2 }}>{note}</div>}
            </div>
            <span
              style={{
                flexShrink: 0,
                fontFamily: "'DM Mono',monospace",
                fontSize: 8,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '.12em',
                padding: '3px 8px',
                borderRadius: 10,
                color: TONE[f],
                border: `1px solid ${TONE[f]}66`,
              }}
            >
              {BADGE[f]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SafetyDisclaimer({ compact = false, theme = 'dark' }: { compact?: boolean; theme?: 'dark' | 'light' }) {
  return (
    <div
      role="note"
      style={{
        fontSize: compact ? 10 : 11,
        lineHeight: 1.5,
        color: theme === 'light' ? '#92400e' : '#d4a843',
        background: theme === 'light' ? '#fffbeb' : 'rgba(212,168,67,0.08)',
        border: '1px solid rgba(212,168,67,0.3)',
        borderRadius: 9,
        padding: compact ? '6px 9px' : '8px 11px',
        margin: '8px 0',
      }}
    >
      {SAFETY_DISCLAIMER}
    </div>
  );
}
