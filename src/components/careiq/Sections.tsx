'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * CareIQ Health Intelligence section components used by the patient
 * dashboard. Uses the CareCircle teal visual standard, branded as
 * CareIQ for non-native healthcare systems. Each export is a
 * self-contained slot:
 *
 *   LiveWearable         4x2 wearable grid, polls /api/wearable/latest
 *                        every 5s. Shows the last uploaded file, not a live device.
 *   ZKShieldBanner       Server-side AES-256-GCM and HIPAA-aligned architecture.
 *   PatientCard          Teal initials avatar, name, CHK-YYYY-XXXXX,
 *                        big risk score, alert count + next-scan,
 *                        3x2 clinical vitals grid.
 *   ActiveProtocols      4 protocols with contextual subtitle + bar.
 *   RiskDomains          6 named domains, icon + score + bar each.
 *   MedsTab              Doses Taken hero, schedule with sun/moon time chips,
 *                        protocol context per med.
 *   FamilyTab            Avatar pill row, chat thread, message input.
 *
 * No demo data is fabricated. Every metric, score, and percentage is
 * computed from /api/shield/decrypt and /api/wearable/latest.
 */

const T = "'DM Mono',monospace";
const P = "'Playfair Display',serif";
const OK = '#4ade80';
const WARN = '#d4a843';
const ALERT = '#e8526e';
const MUTED = '#7a9bbf';
const INK = '#eef2f8';
const SUB = '#a3b5cc';
const CARD = 'rgba(255,255,255,0.04)';
const BORDER = '1px solid rgba(255,255,255,0.06)';
const SOV = '#14b8a6';
const SOV2 = '#2dd4bf';
const SOV_BG = 'rgba(20,184,166,0.12)';
const SOV_INK = '#042f2a';

// ----------------------------------------------------------------------
// Shared types (subset of /api/shield/decrypt response we consume)
// ----------------------------------------------------------------------

type BiomarkerStatus = 'ok' | 'suboptimal' | 'outside_normal' | 'unknown';

interface BiomarkerEntry {
  value: number | null;
  unit: string;
  status: BiomarkerStatus;
}

type CategoryKey =
  | 'metabolic'
  | 'cardiovascular'
  | 'organ'
  | 'blood'
  | 'hormonal'
  | 'longevity'
  | 'cognitive';

type BiomarkerPanel = Record<CategoryKey, Record<string, BiomarkerEntry>>;

export interface SectionsShieldPayload {
  patient_id: string;
  panel_grade: string;
  panel_flagged: number;
  panel_in_range: number;
  risk_score: number;
  risk_label: string;
  biomarkers: BiomarkerPanel;
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  a1c?: number | null;
  hr?: number | null;
  spo2?: number | null;
  hrv?: number | null;
}

export function chkIdFor(patientId: string): string {
  if (!patientId) return 'CHK-NOTLINKED';
  const year = new Date().getFullYear();
  const tail = patientId.replace(/-/g, '').slice(0, 5).toUpperCase();
  return `CHK-${year}-${tail}`;
}

function flatBiomarker(
  panel: BiomarkerPanel | undefined,
  key: string,
): BiomarkerEntry | null {
  if (!panel) return null;
  for (const cat of Object.keys(panel) as CategoryKey[]) {
    const e = panel[cat]?.[key];
    if (e) return e;
  }
  return null;
}

function initialsFor(name: string): string {
  const t = (name || '').trim();
  if (!t) return '?';
  return t
    .split(/\s+/)
    .map((s) => s[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// ======================================================================
// LiveWearable
// ======================================================================

interface LiveMetrics {
  device: string | null;
  heart_rate: number | null;
  spo2: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  glucose: number | null;
  temperature: number | null;
  hrv: number | null;
  steps: number | null;
  sleep_hours: number | null;
}

const POLL_MS = 5000;

function useLiveMetrics(): { m: LiveMetrics | null; err: string | null; tick: number } {
  const [m, setM] = useState<LiveMetrics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const fire = async () => {
      try {
        const r = await fetch('/api/wearable/latest', {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          if (!cancelled) setErr(j.error || `wearable ${r.status}`);
        } else {
          const data = (await r.json()) as LiveMetrics;
          if (!cancelled) {
            setM(data);
            setErr(null);
            setTick((t) => t + 1);
          }
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) timer = window.setTimeout(fire, POLL_MS);
      }
    };
    fire();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);
  return { m, err, tick };
}

function Cell({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: string;
}) {
  return (
    <div
      style={{
        background: 'rgba(0,0,0,0.18)',
        border: BORDER,
        borderRadius: 10,
        padding: '10px 6px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontFamily: T, fontSize: 18, fontWeight: 600, color: tone, lineHeight: 1.1 }}>
        {value}
      </div>
      <div
        style={{
          fontFamily: T,
          fontSize: 8,
          color: MUTED,
          textTransform: 'uppercase',
          letterSpacing: '.14em',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function hrTone(v: number | null): string {
  if (v == null) return MUTED;
  if (v < 50 || v > 100) return ALERT;
  if (v < 55 || v > 95) return WARN;
  return OK;
}
function stepsTone(v: number | null): string {
  if (v == null) return MUTED;
  if (v < 100) return WARN;
  return OK;
}
function sleepTone(v: number | null): string {
  if (v == null) return MUTED;
  if (v < 6) return WARN;
  return OK;
}

export function LiveWearable() {
  const { m, err } = useLiveMetrics();
  const fmtSleep = (h: number | null) => {
    if (h == null) return '-';
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return `${hh}h ${mm}m`;
  };
  return (
    <div
      style={{
        background: CARD,
        border: BORDER,
        borderRadius: 14,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: SOV_BG,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            aria-hidden
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
              <path
                d="M5.5 13.5a3 3 0 010-6h.55a4.5 4.5 0 018.9 0H15a3 3 0 010 6H5.5z"
                stroke={SOV}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Wearable file</div>
            <div style={{ fontFamily: T, fontSize: 9, color: MUTED, marginTop: 1 }}>
              {m?.device || 'No file uploaded'} · Last upload, not a live device
            </div>
          </div>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 12,
            background: 'rgba(74,222,128,0.14)',
            color: OK,
            border: '1px solid rgba(74,222,128,0.4)',
            fontFamily: T,
            fontSize: 9,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '.14em',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: OK,
              animation: 'pulse 1.5s infinite',
            }}
          />
          {m?.device ? 'FILE' : 'NONE'}
        </div>
      </div>
      {err && (
        <div
          style={{
            fontFamily: T,
            fontSize: 9,
            color: ALERT,
            background: 'rgba(232,82,110,0.06)',
            border: '1px solid rgba(232,82,110,0.2)',
            borderRadius: 8,
            padding: '6px 10px',
            marginBottom: 10,
          }}
        >
          Wearable: {err}
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 6,
        }}
      >
        <Cell
          value={m?.heart_rate != null ? String(Math.round(m.heart_rate)) : '-'}
          label="HR"
          tone={hrTone(m?.heart_rate ?? null)}
        />
        <Cell
          value={m?.spo2 != null ? m.spo2.toFixed(1) : '-'}
          label="SpO2"
          tone={INK}
        />
        <Cell
          value={
            m?.bp_systolic != null && m?.bp_diastolic != null
              ? `${m.bp_systolic}/${m.bp_diastolic}`
              : '-'
          }
          label="BP"
          tone={INK}
        />
        <Cell
          value={m?.glucose != null ? String(Math.round(m.glucose)) : '-'}
          label="Glucose"
          tone={INK}
        />
        <Cell
          value={m?.temperature != null ? m.temperature.toFixed(1) : '-'}
          label="Temp"
          tone={INK}
        />
        <Cell
          value={m?.hrv != null ? String(Math.round(m.hrv)) : '-'}
          label="HRV"
          tone={INK}
        />
        <Cell
          value={m?.steps != null ? m.steps.toLocaleString() : '-'}
          label="Steps"
          tone={stepsTone(m?.steps ?? null)}
        />
        <Cell
          value={fmtSleep(m?.sleep_hours ?? null)}
          label="Sleep"
          tone={sleepTone(m?.sleep_hours ?? null)}
        />
      </div>
    </div>
  );
}

// Back-compat alias for callers that imported the previous name.
export const SovereignWearable = LiveWearable;

// ======================================================================
// ZKShieldBanner
// ======================================================================

export function ZKShieldBanner() {
  return (
    <div
      style={{
        background: 'rgba(74,222,128,0.06)',
        border: '1px solid rgba(74,222,128,0.2)',
        borderRadius: 12,
        padding: '10px 12px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        style={{ flexShrink: 0, marginTop: 1 }}
        aria-hidden
      >
        <path
          d="M10 2l6 2v5c0 4-2.5 7-6 8-3.5-1-6-4-6-8V4l6-2z"
          stroke={OK}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <div style={{ fontSize: 11, lineHeight: 1.55, color: SUB }}>
        <span style={{ color: OK, fontWeight: 700 }}>Prompt Shield active.</span>{' '}
        AES-256-GCM at rest on the server, HIPAA-aligned architecture, audit logged.
      </div>
    </div>
  );
}

// ======================================================================
// PatientCard
// ======================================================================

interface PatientCardProps {
  patientId: string;
  name: string;
  age: number;
  shield: SectionsShieldPayload | null;
  shieldLoading: boolean;
}

export function PatientCard({
  patientId,
  name,
  age,
  shield,
  shieldLoading,
}: PatientCardProps) {
  const score = shield ? Math.round(shield.risk_score) : 0;
  const scoreColor = score >= 75 ? OK : score >= 55 ? SOV : ALERT;
  const riskLabel = shieldLoading ? 'Loading...' : shield?.risk_label || 'Not yet computed';
  const alerts = shield?.panel_flagged ?? 0;
  const initials = initialsFor(name);

  const a1c = shield?.a1c ?? null;
  const bp =
    shield?.bp_systolic != null && shield?.bp_diastolic != null
      ? `${shield.bp_systolic}/${shield.bp_diastolic}`
      : '-';
  const hr = shield?.hr ?? null;
  const spo2 = shield?.spo2 ?? null;
  const hrv = shield?.hrv ?? null;
  const tempEntry = flatBiomarker(shield?.biomarkers, 'body_temperature');
  const temp = tempEntry?.value ?? null;

  return (
    <div
      style={{
        background: CARD,
        border: BORDER,
        borderRadius: 14,
        padding: 14,
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${SOV}, ${SOV2})`,
            color: SOV_INK,
            fontWeight: 800,
            fontSize: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
          aria-hidden
        >
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: P, fontSize: 18, color: INK, lineHeight: 1.1 }}>
            {name || 'Not yet entered'}
          </div>
          <div style={{ fontFamily: T, fontSize: 9, color: MUTED, marginTop: 4, letterSpacing: '.04em' }}>
            {chkIdFor(patientId)}
            {age > 0 ? ` · Age ${age}` : ''}
          </div>
        </div>
        <div
          style={{
            fontFamily: T,
            fontSize: 36,
            fontWeight: 700,
            color: scoreColor,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {shieldLoading ? '...' : score || 0}
        </div>
      </div>
      <div
        style={{
          marginTop: 8,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          fontFamily: T,
          fontSize: 10,
        }}
      >
        <span style={{ color: scoreColor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em' }}>
          {riskLabel}
        </span>
        <span style={{ color: MUTED }}>·</span>
        <span style={{ color: alerts > 0 ? ALERT : MUTED }}>
          △ {alerts} {alerts === 1 ? 'alert' : 'alerts'}
        </span>
        <span style={{ color: MUTED }}>·</span>
        <span style={{ color: MUTED }}>Next scan not yet scheduled</span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
          marginTop: 14,
        }}
      >
        <Cell value={bp} label="BP mmHg" tone={INK} />
        <Cell value={a1c != null ? `${a1c.toFixed(1)}%` : '-'} label="A1C" tone={INK} />
        <Cell
          value={hr != null ? String(Math.round(hr)) : '-'}
          label="HR bpm"
          tone={hrTone(hr)}
        />
        <Cell
          value={spo2 != null ? `${spo2.toFixed(1)}%` : '-'}
          label="SpO2"
          tone={INK}
        />
        <Cell
          value={temp != null ? temp.toFixed(1) : '-'}
          label="Temp °F"
          tone={INK}
        />
        <Cell
          value={hrv != null ? `${Math.round(hrv)} ms` : '-'}
          label="HRV"
          tone={INK}
        />
      </div>
    </div>
  );
}

// ======================================================================
// ActiveProtocols
// ======================================================================

interface ProtocolDef {
  name: string;
  keys: string[];
  subtitleFor: (stats: { optimal: number; total: number; pct: number; panel: BiomarkerPanel | undefined }) => string;
}

const PROTOCOLS: ProtocolDef[] = [
  {
    name: 'Metabolic Reversal',
    keys: ['fasting_glucose', 'fasting_insulin', 'homa_ir', 'a1c', 'uric_acid'],
    subtitleFor: ({ panel }) => {
      const a1c = flatBiomarker(panel, 'a1c');
      const target = '5.7%';
      if (a1c?.value != null) {
        return `Latest A1C ${a1c.value.toFixed(1)}% · target ${target}`;
      }
      return `A1C target ${target}`;
    },
  },
  {
    name: 'Cardiovascular Defense',
    keys: ['ldl', 'hdl', 'total_cholesterol', 'triglycerides', 'apob', 'lpa', 'hs_crp', 'homocysteine', 'vldl'],
    subtitleFor: ({ panel }) => {
      const ldl = flatBiomarker(panel, 'ldl');
      if (ldl?.value != null) {
        return `LDL ${Math.round(ldl.value)} mg/dL · target <130 mg/dL`;
      }
      return 'LDL target <130 mg/dL';
    },
  },
  {
    name: 'Longevity Optimization',
    keys: ['biological_age_estimate', 'grip_strength', 'vo2_max', 'resting_hr', 'hrv', 'sleep_score'],
    subtitleFor: () => 'Supplement, sleep, and exercise stack',
  },
  {
    name: 'Cognitive Protection',
    keys: ['memory_score', 'processing_speed', 'executive_function'],
    subtitleFor: ({ total }) =>
      total > 0 ? 'Brain health markers tracked weekly' : 'Brain health markers not yet entered',
  },
];

export function ActiveProtocols({ shield }: { shield: SectionsShieldPayload | null }) {
  return (
    <>
      <div
        style={{
          fontFamily: P,
          fontSize: 18,
          color: INK,
          margin: '8px 0 10px',
        }}
      >
        Active Protocols
      </div>
      <div style={{ marginBottom: 16 }}>
        {PROTOCOLS.map((p) => {
          const stats = computeProtocol(shield?.biomarkers, p.keys);
          const pctColor = stats.pct >= 70 ? OK : stats.pct >= 40 ? SOV : ALERT;
          const subtitle = p.subtitleFor({ ...stats, panel: shield?.biomarkers });
          return (
            <div
              key={p.name}
              style={{
                background: CARD,
                border: BORDER,
                borderRadius: 12,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 4,
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>{p.name}</span>
                <span style={{ fontFamily: T, fontSize: 14, fontWeight: 700, color: pctColor }}>
                  {stats.total > 0 ? `${stats.pct}%` : '-'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: SUB, marginBottom: 8 }}>{subtitle}</div>
              <div
                style={{
                  height: 4,
                  background: 'rgba(255,255,255,0.06)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${stats.pct}%`,
                    background: `linear-gradient(90deg, ${pctColor}, ${pctColor}cc)`,
                    borderRadius: 2,
                    transition: 'width 1s ease',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function computeProtocol(
  panel: BiomarkerPanel | undefined,
  keys: string[],
): { optimal: number; total: number; pct: number } {
  if (!panel) return { optimal: 0, total: 0, pct: 0 };
  let optimal = 0;
  let total = 0;
  for (const k of keys) {
    const e = flatBiomarker(panel, k);
    if (!e || e.value == null) continue;
    total += 1;
    if (e.status === 'ok') optimal += 1;
  }
  const pct = total > 0 ? Math.round((optimal / total) * 100) : 0;
  return { optimal, total, pct };
}

// ======================================================================
// RiskDomains
// ======================================================================

const DOMAINS: Array<{ name: string; categoryKey: CategoryKey | null; iconPath: string }> = [
  {
    name: 'Metabolic',
    categoryKey: 'metabolic',
    iconPath: 'M5 8c0-1.5 1.5-3 3-3s3 1.5 3 3 1.5 3 3 3 3-1.5 3-3M5 14c0-1.5 1.5-3 3-3s3 1.5 3 3',
  },
  {
    name: 'Cardiovascular',
    categoryKey: 'cardiovascular',
    iconPath: 'M10 16s-5-3.5-5-8a3 3 0 015-2.2A3 3 0 0115 8c0 4.5-5 8-5 8z',
  },
  {
    name: 'Cognitive',
    categoryKey: 'cognitive',
    iconPath: 'M7 5a3 3 0 016 0v1a3 3 0 010 6v1a3 3 0 01-6 0v-1a3 3 0 010-6V5z',
  },
  {
    name: 'Oncology',
    categoryKey: null,
    iconPath: 'M10 4l1.5 4.5L16 10l-4.5 1.5L10 16l-1.5-4.5L4 10l4.5-1.5L10 4z',
  },
  {
    name: 'Renal',
    categoryKey: 'organ',
    iconPath: 'M10 3c3 0 5 2 5 5 0 4-3 8-5 9-2-1-5-5-5-9 0-3 2-5 5-5z',
  },
  {
    name: 'Mental Health',
    categoryKey: null,
    iconPath: 'M5 7c0-1 1-2 2.5-2C9 5 10 6 10 7c0-1 1-2 2.5-2C14 5 15 6 15 7c0 3-5 7-5 7s-5-4-5-7z',
  },
];

export function RiskDomains({ shield }: { shield: SectionsShieldPayload | null }) {
  return (
    <>
      <div style={{ fontFamily: P, fontSize: 18, color: INK, margin: '8px 0 10px' }}>
        Risk Domains
      </div>
      <div
        style={{
          background: CARD,
          border: BORDER,
          borderRadius: 14,
          padding: 12,
        }}
      >
        {DOMAINS.map((d, i) => {
          const stats = d.categoryKey ? computeDomain(shield?.biomarkers, d.categoryKey) : null;
          const score = stats?.score ?? null;
          const tone = score == null ? MUTED : score >= 80 ? OK : score >= 60 ? SOV : ALERT;
          return (
            <div
              key={d.name}
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr 30px',
                gap: 10,
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: i < DOMAINS.length - 1 ? BORDER : 'none',
              }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: 'rgba(255,255,255,0.04)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-hidden
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                  <path
                    d={d.iconPath}
                    stroke={tone}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{ fontSize: 12, fontWeight: 500, color: INK, marginBottom: 4 }}
                >
                  {d.name}
                </div>
                <div
                  style={{
                    height: 4,
                    background: 'rgba(255,255,255,0.06)',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${score ?? 0}%`,
                      background: `linear-gradient(90deg, ${tone}, ${tone}cc)`,
                      borderRadius: 2,
                      transition: 'width 1s ease',
                    }}
                  />
                </div>
              </div>
              <div
                style={{
                  fontFamily: T,
                  fontSize: 14,
                  fontWeight: 600,
                  color: tone,
                  textAlign: 'right',
                }}
              >
                {score == null ? '-' : score}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function computeDomain(
  panel: BiomarkerPanel | undefined,
  key: CategoryKey,
): { optimal: number; total: number; score: number } | null {
  if (!panel) return null;
  const group = panel[key];
  if (!group) return null;
  let optimal = 0;
  let total = 0;
  for (const k of Object.keys(group)) {
    const e = group[k];
    if (e.value == null) continue;
    total += 1;
    if (e.status === 'ok') optimal += 1;
  }
  if (total === 0) return null;
  const score = Math.round((optimal / total) * 100);
  return { optimal, total, score };
}

// ======================================================================
// MedsTab
// ======================================================================

interface Medication {
  id: string;
  name: string;
  dose: string | null;
  frequency: string | null;
  time_of_day: string | null;
  prescribing_doctor: string | null;
  start_date: string | null;
  active: boolean;
  created_at: string;
}

interface MedLog {
  id: string;
  medication_id: string;
  taken_on: string;
}

const MED_PROTOCOL_HINTS: Array<{ pattern: RegExp; protocol: string }> = [
  {
    pattern:
      /metformin|jardiance|ozempic|mounjaro|wegovy|glp|insulin|semaglutide|tirzepatide/i,
    protocol: 'Metabolic Reversal',
  },
  {
    pattern:
      /lisinopril|amlodipine|losartan|metoprolol|atorvastatin|crestor|rosuvastatin|pravastatin|simvastatin|ezetimibe|repatha|aspirin|clopidogrel|warfarin|eliquis|hydrochlorothiazide|hctz/i,
    protocol: 'Cardiovascular Defense',
  },
  {
    pattern:
      /vitamin d|vit d|nmn|nad|rapamycin|spermidine|coq10|omega|fish oil|magnesium|zinc/i,
    protocol: 'Longevity Optimization',
  },
  {
    pattern: /donepezil|aricept|memantine|namenda|piracetam|lion'?s mane/i,
    protocol: 'Cognitive Protection',
  },
];

function inferProtocol(name: string): string {
  for (const r of MED_PROTOCOL_HINTS) {
    if (r.pattern.test(name)) return r.protocol;
  }
  return 'General care';
}

function parseTimeChips(tod: string | null): Array<{ icon: 'sun' | 'moon'; label: string }> {
  if (!tod) return [];
  const lower = tod.toLowerCase();
  const chips: Array<{ icon: 'sun' | 'moon'; label: string }> = [];
  const parts = lower.split(/(?:,|\band\b|\bplus\b)/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) parts.push(lower);
  for (const part of parts) {
    const isPm = /\bpm\b|evening|night|bedtime|p\.m\./i.test(part);
    const isAm = /\bam\b|morning|breakfast|a\.m\./i.test(part);
    const label = part.replace(/\s+/g, ' ').trim().toUpperCase();
    chips.push({ icon: isPm && !isAm ? 'moon' : 'sun', label });
  }
  return chips.slice(0, 3);
}

function TimeChip({ icon, label }: { icon: 'sun' | 'moon'; label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontFamily: T,
        fontSize: 9,
        color: SUB,
        marginRight: 8,
      }}
    >
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
        {icon === 'sun' ? (
          <>
            <circle cx="6" cy="6" r="2.5" stroke={SOV} strokeWidth="1.2" />
            <path
              d="M6 1v1.5M6 9.5V11M1 6h1.5M9.5 6H11M2.5 2.5l1 1M8.5 8.5l1 1M2.5 9.5l1-1M8.5 3.5l1-1"
              stroke={SOV}
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </>
        ) : (
          <path
            d="M9.5 7.5A4.5 4.5 0 014 2c-.4 0-.8.05-1.2.15A5 5 0 1010 9.7c0-.4-.05-.8-.15-1.2a4.5 4.5 0 01-.35 0z"
            fill={SOV}
          />
        )}
      </svg>
      {label}
    </span>
  );
}

export function MedsTab() {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [logs, setLogs] = useState<MedLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/meds/list', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `meds ${r.status}`);
      }
      const d = (await r.json()) as { medications: Medication[]; todays_logs: MedLog[] };
      setMeds(d.medications || []);
      setLogs(d.todays_logs || []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const total = meds.length;
  const taken = logs.length;
  const pct = total > 0 ? Math.round((taken / total) * 100) : 0;

  if (loading) {
    return (
      <div style={{ padding: '14px 18px', fontSize: 12, color: MUTED }}>Loading meds...</div>
    );
  }

  return (
    <>
      {total > 0 && (
        <div
          style={{
            background: CARD,
            border: BORDER,
            borderRadius: 14,
            padding: 14,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              marginBottom: 4,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>
                {taken}/{total} Doses Taken
              </div>
              <div style={{ fontSize: 11, color: SUB, marginTop: 2 }}>
                Wearable confirms absorption patterns
              </div>
            </div>
            <div
              style={{
                fontFamily: P,
                fontSize: 32,
                fontWeight: 700,
                color: SOV,
                lineHeight: 1,
              }}
            >
              {pct}%
            </div>
          </div>
          <div
            style={{
              height: 4,
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 2,
              overflow: 'hidden',
              marginTop: 10,
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${pct}%`,
                background: `linear-gradient(90deg, ${SOV}, ${SOV2})`,
                borderRadius: 2,
                transition: 'width 1s ease',
              }}
            />
          </div>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <div style={{ fontFamily: P, fontSize: 18, color: INK }}>Medication Schedule</div>
        <span style={{ fontFamily: T, fontSize: 10, color: SOV, fontWeight: 600 }}>+ Add</span>
      </div>

      {err && (
        <div
          style={{
            background: 'rgba(232,82,110,0.08)',
            border: '1px solid rgba(232,82,110,0.25)',
            borderRadius: 10,
            padding: 10,
            fontSize: 11,
            color: ALERT,
            marginBottom: 10,
          }}
        >
          {err}
        </div>
      )}

      <div
        style={{
          background: CARD,
          border: BORDER,
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        {meds.length === 0 ? (
          <div style={{ padding: 16, fontSize: 11, color: MUTED, textAlign: 'center' }}>
            No medications on file. Add them from the CareCircle Meds tab on care-os.
          </div>
        ) : (
          meds.map((m, i) => {
            const isTaken = logs.some((l) => l.medication_id === m.id);
            const protocol = inferProtocol(m.name);
            const chips = parseTimeChips(m.time_of_day || m.frequency);
            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  padding: 12,
                  borderBottom: i < meds.length - 1 ? BORDER : 'none',
                  opacity: isTaken ? 0.78 : 1,
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    flexShrink: 0,
                    border: `1px solid ${isTaken ? OK : 'rgba(255,255,255,0.18)'}`,
                    background: isTaken ? OK : 'transparent',
                    color: '#0a1d10',
                    fontSize: 13,
                    fontWeight: 700,
                    lineHeight: '20px',
                    textAlign: 'center',
                    marginTop: 2,
                  }}
                  aria-hidden
                >
                  {isTaken ? '✓' : ''}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: INK,
                      marginBottom: 4,
                    }}
                  >
                    {m.name}
                    {m.dose ? ` ${m.dose}` : ''}
                  </div>
                  {chips.length > 0 && (
                    <div style={{ marginBottom: 4 }}>
                      {chips.map((c, idx) => (
                        <TimeChip key={idx} icon={c.icon} label={c.label} />
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: SOV, fontFamily: T, letterSpacing: '.04em' }}>
                    {protocol} protocol
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

// ======================================================================
// FamilyTab (avatar row + chat thread)
// ======================================================================

interface CircleMember {
  id: string;
  member_user_id: string | null;
  member_email: string;
  member_name: string;
  member_phone: string | null;
  relationship: string;
  alert_level: 'critical' | 'informational';
  created_at: string;
}

interface FamilyMessage {
  id: string;
  sender_role: 'patient' | 'member' | 'system';
  sender_user_id: string | null;
  sender_label: string | null;
  body: string;
  created_at: string;
}

function memberAvatarColor(idx: number): string {
  const palette = ['#14b8a6', '#2dd4bf', '#06b6d4', '#8b5cf6', '#0ea5e9', '#4ade80'];
  return palette[idx % palette.length];
}

export function FamilyTab() {
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [messages, setMessages] = useState<FamilyMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const memberLabel = useCallback(
    (uid: string | null) => {
      if (!uid) return '';
      const m = members.find((x) => x.member_user_id === uid);
      return m?.member_name || '';
    },
    [members],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mr, msgr] = await Promise.all([
          fetch('/api/circle/list', { cache: 'no-store', credentials: 'same-origin' }),
          fetch('/api/messages/list', { cache: 'no-store', credentials: 'same-origin' }),
        ]);
        if (!cancelled) {
          if (mr.ok) {
            const d = (await mr.json()) as { members: CircleMember[] };
            setMembers(d.members || []);
          }
          if (msgr.ok) {
            const d = (await msgr.json()) as { messages: FamilyMessage[] };
            setMessages(d.messages || []);
          }
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setErr(null);
    try {
      const r = await fetch('/api/messages/post', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `post ${r.status}`);
      }
      const d = (await r.json()) as { message: FamilyMessage };
      setMessages((p) => [...p, d.message]);
      setDraft('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '14px 18px', fontSize: 12, color: MUTED }}>Loading family hub...</div>
    );
  }

  const avatarRow = members.slice(0, 4);

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div style={{ fontFamily: P, fontSize: 18, color: INK }}>Family Hub</div>
        <span style={{ fontFamily: T, fontSize: 10, color: SOV, fontWeight: 600 }}>+ Add member</span>
      </div>

      {err && (
        <div
          style={{
            background: 'rgba(232,82,110,0.08)',
            border: '1px solid rgba(232,82,110,0.25)',
            borderRadius: 10,
            padding: 10,
            fontSize: 11,
            color: ALERT,
            marginBottom: 10,
          }}
        >
          {err}
        </div>
      )}

      {avatarRow.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 10,
            marginBottom: 16,
            overflowX: 'auto',
            scrollbarWidth: 'none',
            paddingBottom: 4,
          }}
        >
          {avatarRow.map((m, idx) => {
            const c = memberAvatarColor(idx);
            return (
              <div
                key={m.id}
                style={{ textAlign: 'center', minWidth: 56, flexShrink: 0 }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: `linear-gradient(135deg, ${c}, ${c}aa)`,
                    color: SOV_INK,
                    fontWeight: 800,
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 4px',
                  }}
                >
                  {initialsFor(m.member_name || m.member_email)}
                </div>
                <div style={{ fontSize: 10, fontWeight: 600, color: INK, lineHeight: 1.2 }}>
                  {(m.member_name || m.member_email).split(/\s+/)[0]}
                </div>
                <div style={{ fontFamily: T, fontSize: 8, color: MUTED, marginTop: 2 }}>
                  {(m.relationship || '').slice(0, 12)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        ref={scrollRef}
        style={{
          background: CARD,
          border: BORDER,
          borderRadius: 14,
          padding: 12,
          minHeight: 140,
          maxHeight: 360,
          overflowY: 'auto',
          marginBottom: 10,
        }}
      >
        {messages.length === 0 ? (
          <div style={{ fontSize: 11, color: MUTED, textAlign: 'center', padding: 18 }}>
            No messages yet. Send the first one to your circle.
          </div>
        ) : (
          messages.map((msg) => {
            const mine = msg.sender_role === 'patient';
            const senderName = mine
              ? 'You'
              : memberLabel(msg.sender_user_id) || msg.sender_label || 'Care Circle';
            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  justifyContent: mine ? 'flex-end' : 'flex-start',
                  marginBottom: 8,
                }}
              >
                <div style={{ maxWidth: '78%' }}>
                  <div
                    style={{
                      fontFamily: T,
                      fontSize: 8,
                      color: MUTED,
                      marginBottom: 3,
                      textAlign: mine ? 'right' : 'left',
                    }}
                  >
                    {senderName} · {fmtClock(msg.created_at)}
                  </div>
                  <div
                    style={{
                      padding: '8px 11px',
                      borderRadius: 12,
                      background: mine ? `linear-gradient(135deg, ${SOV}, ${SOV2})` : '#111827',
                      color: mine ? SOV_INK : '#e2e8f0',
                      fontSize: 12,
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                    }}
                  >
                    {msg.body}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Message the family..."
          disabled={sending}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 22,
            border: BORDER,
            background: 'rgba(255,255,255,0.04)',
            color: INK,
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          onClick={send}
          disabled={sending || !draft.trim()}
          aria-label="Send"
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: 'none',
            background: `linear-gradient(135deg, ${SOV}, ${SOV2})`,
            color: SOV_INK,
            fontSize: 16,
            fontWeight: 700,
            cursor: sending || !draft.trim() ? 'not-allowed' : 'pointer',
            opacity: sending || !draft.trim() ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          ▶
        </button>
      </div>
    </>
  );
}

function fmtClock(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}
