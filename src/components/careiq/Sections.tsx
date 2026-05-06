'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * CareIQ Patient dashboard sections.
 *
 * Each export is a self-contained slot used by CareIQHealthOS:
 *   LiveWearableStrip   live 8-metric strip, polls /api/wearable/latest every 5s
 *   PatientCard         name, CHK ID, age, score ring, risk label, alert count
 *   ActiveProtocols     4 fixed protocols, % computed from biomarker panel
 *   RiskDomains         6 named domains, scores from biomarker categories
 *   MedsTab             read-only mirror of /api/meds/list (active meds + today's logs)
 *   FamilyTab           care_circle members from /api/circle/list (avatars + names)
 *
 * No demo data is fabricated. When inputs are missing each component
 * shows a muted placeholder rather than a fake number.
 */

const T = "'DM Mono',monospace";
const OK = '#00d4b8';
const WARN = '#d4a843';
const ALERT = '#e8526e';
const MUTED = '#7a9bbf';
const INK = '#eef2f8';

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
}

// ----------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------

export function chkIdFor(patientId: string): string {
  if (!patientId) return 'CHK-NOTLINKED';
  const hex = patientId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `CHK-${hex}`;
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

// ----------------------------------------------------------------------
// LiveWearableStrip
// ----------------------------------------------------------------------

interface LiveMetrics {
  device: string;
  heart_rate: number | null;
  spo2: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  glucose: number | null;
  temperature: number | null;
  hrv: number | null;
  steps: number | null;
  sleep_hours: number | null;
  decrypted_at: string;
  metric_date: string | null;
}

const POLL_MS = 5000;

export function LiveWearableStrip() {
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

  const cells: Array<{ label: string; value: string; unit: string; tone: string }> = [
    {
      label: 'HR',
      value: m?.heart_rate != null ? String(Math.round(m.heart_rate)) : '–',
      unit: 'bpm',
      tone: hrTone(m?.heart_rate),
    },
    {
      label: 'SpO2',
      value: m?.spo2 != null ? String(m.spo2) : '–',
      unit: '%',
      tone: spo2Tone(m?.spo2),
    },
    {
      label: 'BP',
      value:
        m?.bp_systolic != null && m?.bp_diastolic != null
          ? `${m.bp_systolic}/${m.bp_diastolic}`
          : '–',
      unit: 'mmHg',
      tone: bpTone(m?.bp_systolic, m?.bp_diastolic),
    },
    {
      label: 'Glucose',
      value: m?.glucose != null ? String(Math.round(m.glucose)) : '–',
      unit: 'mg/dL',
      tone: glucoseTone(m?.glucose),
    },
    {
      label: 'Temp',
      value: m?.temperature != null ? m.temperature.toFixed(1) : '–',
      unit: '°F',
      tone: tempTone(m?.temperature),
    },
    {
      label: 'HRV',
      value: m?.hrv != null ? String(Math.round(m.hrv)) : '–',
      unit: 'ms',
      tone: m?.hrv != null ? OK : MUTED,
    },
    {
      label: 'Steps',
      value: m?.steps != null ? m.steps.toLocaleString() : '–',
      unit: 'today',
      tone: m?.steps != null ? OK : MUTED,
    },
    {
      label: 'Sleep',
      value: m?.sleep_hours != null ? `${m.sleep_hours.toFixed(1)}h` : '–',
      unit: 'last',
      tone: sleepTone(m?.sleep_hours),
    },
  ];

  return (
    <div style={{ flexShrink: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 18px 4px',
          gap: 10,
        }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <div
            key={tick}
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#4ade80',
              boxShadow: '0 0 8px rgba(74,222,128,.7)',
              animation: 'pulse 1.5s infinite',
            }}
          />
          <span
            style={{
              fontFamily: T,
              fontSize: 8,
              color: '#4ade80',
              textTransform: 'uppercase',
              letterSpacing: '.18em',
              fontWeight: 700,
            }}
          >
            LIVE
          </span>
        </div>
        <span
          style={{
            fontFamily: T,
            fontSize: 8,
            color: MUTED,
            textTransform: 'uppercase',
            letterSpacing: '.14em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {m?.device || 'Withings ScanWatch'}
        </span>
      </div>
      {err && (
        <div
          style={{
            margin: '0 18px 6px',
            padding: '6px 10px',
            fontFamily: T,
            fontSize: 9,
            color: ALERT,
            background: 'rgba(232,82,110,.06)',
            border: '1px solid rgba(232,82,110,.2)',
            borderRadius: 8,
          }}
        >
          Wearable: {err}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          gap: 7,
          padding: '0 18px 8px',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
        }}
      >
        {cells.map((c) => (
          <div
            key={c.label}
            style={{
              flexShrink: 0,
              minWidth: 70,
              padding: '8px 10px',
              background: 'rgba(255,255,255,.04)',
              borderRadius: 10,
              border: `1px solid ${c.tone}30`,
            }}
          >
            <div
              style={{
                fontFamily: T,
                fontSize: 8,
                color: MUTED,
                textTransform: 'uppercase',
                letterSpacing: '.12em',
                marginBottom: 3,
              }}
            >
              {c.label}
            </div>
            <div
              style={{
                fontFamily: T,
                fontSize: 14,
                fontWeight: 600,
                color: c.tone,
                lineHeight: 1,
              }}
            >
              {c.value}
            </div>
            <div style={{ fontSize: 8, color: MUTED, fontFamily: T, marginTop: 2 }}>
              {c.unit}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function hrTone(v: number | null | undefined): string {
  if (v == null) return MUTED;
  if (v < 50 || v > 100) return ALERT;
  if (v < 55 || v > 95) return WARN;
  return OK;
}
function spo2Tone(v: number | null | undefined): string {
  if (v == null) return MUTED;
  if (v < 90) return ALERT;
  if (v < 95) return WARN;
  return OK;
}
function bpTone(
  s: number | null | undefined,
  d: number | null | undefined,
): string {
  if (s == null && d == null) return MUTED;
  if ((s ?? 0) >= 140 || (d ?? 0) >= 90) return ALERT;
  if ((s ?? 0) >= 130 || (d ?? 0) >= 80) return WARN;
  return OK;
}
function glucoseTone(v: number | null | undefined): string {
  if (v == null) return MUTED;
  if (v >= 126) return ALERT;
  if (v >= 100) return WARN;
  return OK;
}
function tempTone(v: number | null | undefined): string {
  if (v == null) return MUTED;
  if (v >= 100.4 || v < 96) return ALERT;
  if (v >= 99.5) return WARN;
  return OK;
}
function sleepTone(v: number | null | undefined): string {
  if (v == null) return MUTED;
  if (v < 6) return WARN;
  return OK;
}

// ----------------------------------------------------------------------
// PatientCard
// ----------------------------------------------------------------------

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
  const ringColor = score >= 75 ? OK : score >= 55 ? WARN : ALERT;
  const riskLabel = shieldLoading
    ? 'Loading...'
    : shield?.risk_label || 'Not yet computed';
  const alerts = shield?.panel_flagged ?? 0;

  return (
    <div
      style={{
        background: 'rgba(255,255,255,.04)',
        border: '1px solid rgba(0,212,184,.14)',
        borderRadius: 14,
        padding: 14,
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <RiskRing score={score} color={ringColor} loading={shieldLoading} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: T,
              fontSize: 9,
              color: MUTED,
              textTransform: 'uppercase',
              letterSpacing: '.14em',
              marginBottom: 3,
            }}
          >
            Patient
          </div>
          <div
            style={{
              fontFamily: "'Playfair Display',serif",
              fontSize: 18,
              color: INK,
              marginBottom: 3,
            }}
          >
            {name || 'Not yet entered'}
          </div>
          <div
            style={{
              fontFamily: T,
              fontSize: 9,
              color: MUTED,
              letterSpacing: '.04em',
            }}
          >
            {chkIdFor(patientId)}
            {age > 0 ? ` · Age ${age}` : ''}
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              marginTop: 8,
              padding: '3px 8px',
              borderRadius: 12,
              background: `${ringColor}1f`,
              border: `1px solid ${ringColor}55`,
              fontFamily: T,
              fontSize: 9,
              color: ringColor,
              textTransform: 'uppercase',
              letterSpacing: '.12em',
            }}
          >
            {riskLabel}
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid rgba(255,255,255,.06)',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: T,
              fontSize: 9,
              color: MUTED,
              textTransform: 'uppercase',
              letterSpacing: '.12em',
              marginBottom: 4,
            }}
          >
            Alerts
          </div>
          <div
            style={{
              fontFamily: T,
              fontSize: 18,
              fontWeight: 600,
              color: alerts > 0 ? ALERT : OK,
            }}
          >
            {shieldLoading ? '...' : alerts}
          </div>
        </div>
        <div>
          <div
            style={{
              fontFamily: T,
              fontSize: 9,
              color: MUTED,
              textTransform: 'uppercase',
              letterSpacing: '.12em',
              marginBottom: 4,
            }}
          >
            Next Scan
          </div>
          <div style={{ fontSize: 11, color: MUTED }}>Not yet scheduled</div>
        </div>
      </div>
    </div>
  );
}

function RiskRing({
  score,
  color,
  loading,
}: {
  score: number;
  color: string;
  loading: boolean;
}) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - (score || 0) / 100);
  return (
    <div style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 72 72"
        style={{ transform: 'rotate(-90deg)' }}
      >
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke="rgba(255,255,255,.06)"
          strokeWidth="6"
        />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${c}`}
          strokeDashoffset={`${offset}`}
          style={{ transition: 'stroke-dashoffset 1.2s ease' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ fontFamily: T, fontSize: 22, fontWeight: 600, color }}>
          {loading ? '...' : score || 0}
        </div>
        <div
          style={{
            fontFamily: T,
            fontSize: 7,
            color: MUTED,
            textTransform: 'uppercase',
            letterSpacing: '.12em',
          }}
        >
          Score
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// ActiveProtocols
// ----------------------------------------------------------------------

const PROTOCOLS: Array<{ name: string; keys: string[] }> = [
  {
    name: 'Metabolic Reversal',
    keys: ['fasting_glucose', 'fasting_insulin', 'homa_ir', 'a1c', 'uric_acid'],
  },
  {
    name: 'Cardiovascular Defense',
    keys: [
      'ldl',
      'hdl',
      'total_cholesterol',
      'triglycerides',
      'apob',
      'lpa',
      'hs_crp',
      'homocysteine',
      'vldl',
    ],
  },
  {
    name: 'Longevity Optimization',
    keys: [
      'biological_age_estimate',
      'grip_strength',
      'vo2_max',
      'resting_hr',
      'hrv',
      'sleep_score',
    ],
  },
  {
    name: 'Cognitive Protection',
    keys: ['memory_score', 'processing_speed', 'executive_function'],
  },
];

export function ActiveProtocols({
  shield,
}: {
  shield: SectionsShieldPayload | null;
}) {
  return (
    <>
      <div
        style={{
          fontFamily: T,
          fontSize: 9,
          color: OK,
          textTransform: 'uppercase',
          letterSpacing: '.18em',
          margin: '18px 0 10px',
        }}
      >
        Active Protocols
      </div>
      {PROTOCOLS.map((p) => {
        const stats = computeProtocol(shield?.biomarkers, p.keys);
        return (
          <div
            key={p.name}
            style={{
              background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(0,212,184,.14)',
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
                marginBottom: 5,
                gap: 8,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: INK }}>
                {p.name}
              </span>
              <span
                style={{
                  fontFamily: T,
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#f97316',
                }}
              >
                {stats.total > 0 ? `${stats.pct}%` : '–'}
              </span>
            </div>
            <div
              style={{
                height: 5,
                background: 'rgba(255,255,255,.06)',
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${stats.pct}%`,
                  background: 'linear-gradient(90deg,#f97316,#fb923c)',
                  borderRadius: 3,
                  transition: 'width 1s ease',
                }}
              />
            </div>
            <div
              style={{
                fontFamily: T,
                fontSize: 9,
                color: MUTED,
                marginTop: 5,
                letterSpacing: '.04em',
              }}
            >
              {stats.total === 0
                ? 'No biomarkers entered yet for this protocol.'
                : `${stats.optimal} of ${stats.total} markers in optimal range`}
            </div>
          </div>
        );
      })}
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

// ----------------------------------------------------------------------
// RiskDomains
// ----------------------------------------------------------------------

const DOMAINS: Array<{ name: string; categoryKey: CategoryKey | null }> = [
  { name: 'Metabolic', categoryKey: 'metabolic' },
  { name: 'Cardiovascular', categoryKey: 'cardiovascular' },
  { name: 'Cognitive', categoryKey: 'cognitive' },
  { name: 'Oncology', categoryKey: null },
  { name: 'Renal', categoryKey: 'organ' },
  { name: 'Mental Health', categoryKey: null },
];

export function RiskDomains({
  shield,
}: {
  shield: SectionsShieldPayload | null;
}) {
  return (
    <>
      <div
        style={{
          fontFamily: T,
          fontSize: 9,
          color: OK,
          textTransform: 'uppercase',
          letterSpacing: '.18em',
          margin: '20px 0 10px',
        }}
      >
        Risk Domains
      </div>
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}
      >
        {DOMAINS.map((d) => {
          const stats = d.categoryKey
            ? computeDomain(shield?.biomarkers, d.categoryKey)
            : null;
          const score = stats?.score ?? null;
          const tone =
            score == null
              ? MUTED
              : score >= 80
                ? OK
                : score >= 60
                  ? WARN
                  : ALERT;
          return (
            <div
              key={d.name}
              style={{
                background: 'rgba(255,255,255,.04)',
                border: `1px solid ${tone}30`,
                borderRadius: 11,
                padding: 11,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: INK,
                  marginBottom: 6,
                }}
              >
                {d.name}
              </div>
              <div
                style={{
                  height: 5,
                  background: 'rgba(255,255,255,.06)',
                  borderRadius: 3,
                  overflow: 'hidden',
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${score ?? 0}%`,
                    background: `linear-gradient(90deg,${tone},${tone}88)`,
                    borderRadius: 3,
                    transition: 'width 1s ease',
                  }}
                />
              </div>
              <div style={{ fontFamily: T, fontSize: 15, fontWeight: 600, color: tone }}>
                {score == null ? '–' : `${score}`}
              </div>
              <div
                style={{
                  fontFamily: T,
                  fontSize: 8,
                  color: MUTED,
                  marginTop: 2,
                  letterSpacing: '.06em',
                }}
              >
                {stats == null
                  ? 'Not yet computed'
                  : `${stats.optimal}/${stats.total} optimal`}
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

// ----------------------------------------------------------------------
// MedsTab
// ----------------------------------------------------------------------

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
      const d = (await r.json()) as {
        medications: Medication[];
        todays_logs: MedLog[];
      };
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

  const totalToday = meds.length;
  const takenToday = logs.length;

  if (loading) {
    return (
      <div style={{ padding: '14px 18px', fontSize: 12, color: MUTED }}>
        Loading meds...
      </div>
    );
  }

  return (
    <div style={{ padding: '14px 18px 110px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontFamily: T,
            fontSize: 9,
            color: OK,
            textTransform: 'uppercase',
            letterSpacing: '.18em',
          }}
        >
          Medication Schedule
        </div>
        <div style={{ fontFamily: T, fontSize: 9, color: MUTED }}>
          {totalToday > 0 ? `${takenToday} of ${totalToday} taken today` : ''}
        </div>
      </div>

      {err && (
        <div
          style={{
            background: 'rgba(232,82,110,.08)',
            border: '1px solid rgba(232,82,110,.25)',
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

      {meds.length === 0 ? (
        <div
          style={{
            background: 'rgba(255,255,255,.04)',
            border: '1px solid rgba(0,212,184,.14)',
            borderRadius: 12,
            padding: 16,
            fontSize: 11,
            color: MUTED,
            textAlign: 'center',
          }}
        >
          No medications on file. Add them from the CareCircle Meds tab on care-os.
        </div>
      ) : (
        meds.map((m) => {
          const taken = logs.some((l) => l.medication_id === m.id);
          const protocol = inferProtocol(m.name);
          return (
            <div
              key={m.id}
              style={{
                background: 'rgba(255,255,255,.04)',
                border: '1px solid rgba(0,212,184,.14)',
                borderRadius: 12,
                padding: 12,
                marginBottom: 8,
                opacity: taken ? 0.78 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    flexShrink: 0,
                    border: `1px solid ${taken ? OK : 'rgba(0,212,184,.3)'}`,
                    background: taken ? OK : 'transparent',
                    color: '#07101f',
                    fontSize: 13,
                    lineHeight: '20px',
                    textAlign: 'center',
                    marginTop: 2,
                  }}
                >
                  {taken ? '✓' : ''}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: INK,
                      marginBottom: 2,
                    }}
                  >
                    {m.name}
                  </div>
                  {(m.dose || m.frequency) && (
                    <div style={{ fontSize: 11, color: '#a3b5cc' }}>
                      {m.dose || ''}
                      {m.dose && m.frequency ? ' · ' : ''}
                      {m.frequency || ''}
                    </div>
                  )}
                  {m.time_of_day && (
                    <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
                      Time: {m.time_of_day}
                    </div>
                  )}
                  {m.prescribing_doctor && (
                    <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>
                      Rx: {m.prescribing_doctor}
                    </div>
                  )}
                  <div
                    style={{
                      display: 'inline-block',
                      marginTop: 6,
                      fontFamily: T,
                      fontSize: 8,
                      padding: '2px 7px',
                      borderRadius: 5,
                      background: 'rgba(249,115,22,.12)',
                      color: '#f97316',
                      border: '1px solid rgba(249,115,22,.3)',
                      letterSpacing: '.1em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {protocol}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
      <div
        style={{
          fontFamily: T,
          fontSize: 9,
          color: MUTED,
          textAlign: 'center',
          marginTop: 14,
          lineHeight: 1.6,
        }}
      >
        Read-only view. Edit medications on the CareCircle Meds tab.
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// FamilyTab
// ----------------------------------------------------------------------

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

function avatarFor(
  name: string,
  idx: number,
): { initials: string; color: string } {
  const palette = ['#00d4b8', '#8060cc', '#d4a843', '#e8526e', '#4ade80', '#f97316'];
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((s) => s[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';
  return { initials, color: palette[idx % palette.length] };
}

export function FamilyTab() {
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/circle/list', {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `circle ${r.status}`);
        }
        const d = (await r.json()) as { members: CircleMember[] };
        if (!cancelled) setMembers(d.members || []);
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

  if (loading) {
    return (
      <div style={{ padding: '14px 18px', fontSize: 12, color: MUTED }}>
        Loading family hub...
      </div>
    );
  }

  return (
    <div style={{ padding: '14px 18px 110px' }}>
      <div
        style={{
          fontFamily: T,
          fontSize: 9,
          color: OK,
          textTransform: 'uppercase',
          letterSpacing: '.18em',
          marginBottom: 10,
        }}
      >
        Family Hub
      </div>

      {err && (
        <div
          style={{
            background: 'rgba(232,82,110,.08)',
            border: '1px solid rgba(232,82,110,.25)',
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

      {members.length === 0 ? (
        <div
          style={{
            background: 'rgba(255,255,255,.04)',
            border: '1px solid rgba(0,212,184,.14)',
            borderRadius: 12,
            padding: 16,
            fontSize: 11,
            color: MUTED,
            textAlign: 'center',
          }}
        >
          No care circle members yet. Invite a family member from the dashboard header.
        </div>
      ) : (
        members.map((m, idx) => {
          const av = avatarFor(m.member_name || m.member_email, idx);
          const linked = !!m.member_user_id;
          return (
            <div
              key={m.id}
              style={{
                background: 'rgba(255,255,255,.04)',
                border: '1px solid rgba(0,212,184,.14)',
                borderRadius: 12,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: `linear-gradient(135deg,${av.color},${av.color}88)`,
                    color: '#07101f',
                    fontWeight: 700,
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {av.initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: INK,
                      marginBottom: 2,
                    }}
                  >
                    {m.member_name || m.member_email}
                  </div>
                  <div style={{ fontSize: 10, color: MUTED }}>
                    {m.relationship}
                  </div>
                  <div
                    style={{
                      fontFamily: T,
                      fontSize: 9,
                      color: MUTED,
                      marginTop: 3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.member_email}
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    alignItems: 'flex-end',
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontFamily: T,
                      fontSize: 8,
                      padding: '2px 7px',
                      borderRadius: 5,
                      background:
                        m.alert_level === 'critical'
                          ? 'rgba(232,82,110,.12)'
                          : 'rgba(0,212,184,.1)',
                      color: m.alert_level === 'critical' ? ALERT : OK,
                      border: `1px solid ${m.alert_level === 'critical' ? 'rgba(232,82,110,.3)' : 'rgba(0,212,184,.2)'}`,
                      textTransform: 'uppercase',
                      letterSpacing: '.1em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.alert_level === 'critical' ? 'Critical' : 'All alerts'}
                  </span>
                  <span
                    style={{
                      fontFamily: T,
                      fontSize: 8,
                      color: linked ? '#4ade80' : MUTED,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {linked ? 'Active' : 'Pending'}
                  </span>
                </div>
              </div>
            </div>
          );
        })
      )}

      <div
        style={{
          marginTop: 14,
          background: 'rgba(255,255,255,.03)',
          border: '1px dashed rgba(122,155,191,.3)',
          borderRadius: 12,
          padding: 14,
          fontSize: 11,
          color: MUTED,
          textAlign: 'center',
          lineHeight: 1.55,
        }}
      >
        Family message thread coming soon. For now, your circle members can view your
        vitals and alerts from the CareCircle dashboard.
      </div>
    </div>
  );
}
