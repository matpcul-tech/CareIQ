"use client";

import { useState, useEffect, useContext, createContext, Component, ReactNode } from "react";
import InviteFamilyModal from "@/components/InviteFamilyModal";
import {
  LiveWearable,
  ZKShieldBanner,
  PatientCard,
  ActiveProtocols,
  RiskDomains,
  HealthIntelTab,
  chkIdFor,
  type SectionsShieldPayload,
} from "@/components/careiq/Sections";

/* ======================================================================
   CareIQ patient surface.

   Two view modes:
     Patient:  Health / Insights / Nutrition / Wearable / AI / Profile
     Clinical: Blood  / Telehealth / Sovereign / Impact / Shield

   These were the original tab sets before the Sovereign Edition redesign
   collapsed the patient nav down to four tabs. Restoring them on top of
   the current Sovereign-teal design: the existing PatientCard +
   ActiveProtocols + RiskDomains stack stays as the Health tab; the
   existing HealthIntelTab stays as the AI tab; the LiveWearable card
   anchors the Wearable tab; the remaining tabs render typed empty
   states until they are wired to real data.

   Above the fold every non-Wearable, non-Health tab shows the Live
   Wearable strip + ZK Shield banner so the live patient telemetry is
   visible no matter which tab is open.
   ====================================================================== */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Mono:wght@300;400;500&family=Outfit:wght@300;400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
.sov{display:flex;flex-direction:column;height:100vh;height:100dvh;font-family:'Outfit',sans-serif;color:#eef2f8;background:#0a1628;position:relative;overflow:hidden;max-width:480px;margin:0 auto}
.sov::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse 80% 40% at 80% 0%,rgba(20,184,166,0.08) 0%,transparent 60%),radial-gradient(ellipse 60% 60% at 0% 100%,rgba(45,212,191,0.06) 0%,transparent 60%)}
.sov-hdr{position:relative;z-index:10;flex-shrink:0;padding:14px 18px 12px;background:rgba(10,22,40,0.92);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.06)}
.sov-hdr-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.sov-logo{display:flex;align-items:center;gap:10px;min-width:0}
.sov-logo-mark{width:38px;height:38px;border-radius:9px;background:linear-gradient(135deg,#14b8a6,#2dd4bf);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#042f2a;flex-shrink:0;letter-spacing:.05em}
.sov-logo-name{font-family:'Playfair Display',serif;font-size:17px;color:#eef2f8;line-height:1}
.sov-logo-sub{font-family:'DM Mono',monospace;font-size:8px;color:#14b8a6;letter-spacing:.22em;text-transform:uppercase;margin-top:3px}
.zk-pill{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:14px;background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.35);font-family:'DM Mono',monospace;font-size:9px;color:#4ade80;font-weight:700;letter-spacing:.14em;text-transform:uppercase;flex-shrink:0;white-space:nowrap}
.zk-pill .dot{width:6px;height:6px;border-radius:50%;background:#4ade80;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.sov-mode{display:inline-flex;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:3px;font-family:'DM Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.sov-mode-btn{background:transparent;border:none;color:#7a9bbf;padding:5px 10px;border-radius:7px;cursor:pointer;transition:all .15s}
.sov-mode-btn.on{background:linear-gradient(135deg,#14b8a6,#2dd4bf);color:#042f2a}
.sov-scroll{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;position:relative;z-index:1}
.sov-pad{padding:14px 18px calc(96px + env(safe-area-inset-bottom,0px))}
.sov-bnav{position:fixed;bottom:0;left:0;right:0;background:rgba(10,22,40,0.97);backdrop-filter:blur(20px);border-top:1px solid rgba(255,255,255,0.06);display:grid;padding:8px 4px calc(10px + env(safe-area-inset-bottom,0px));z-index:20;max-width:480px;margin:0 auto}
.sov-bnav-6{grid-template-columns:repeat(6,1fr)}
.sov-bnav-5{grid-template-columns:repeat(5,1fr)}
.sov-bnav-btn{background:transparent;border:none;color:#7a9bbf;font-family:'Outfit',sans-serif;font-size:10px;font-weight:600;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 2px;border-radius:9px;transition:color .2s;min-height:50px;justify-content:center;position:relative}
.sov-bnav-btn.on{color:#14b8a6}
.sov-bnav-btn.on::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:32px;height:2px;background:linear-gradient(90deg,#14b8a6,#2dd4bf);border-radius:0 0 2px 2px}
.sov-bnav-icon{font-size:16px;line-height:1}
.sov-bnav-lbl{font-size:9px;letter-spacing:.04em}
.sov-err{padding:14px;background:rgba(232,82,110,0.06);border:1px solid rgba(232,82,110,0.25);border-radius:11px;margin:14px 18px;color:#e8526e;font-size:11px;line-height:1.5}
.sov-stub{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:18px}
.sov-stub-title{font-family:'Playfair Display',serif;font-size:18px;color:#eef2f8;margin-bottom:6px}
.sov-stub-body{font-size:12px;color:#a3b5cc;line-height:1.55}
.sov-stub-tag{display:inline-block;margin-top:10px;padding:3px 9px;border-radius:10px;background:rgba(20,184,166,0.1);border:1px solid rgba(20,184,166,0.3);color:#14b8a6;font-family:'DM Mono',monospace;font-size:8px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
`;

// ----------------------------------------------------------------------
// Shield context (decrypt payload)
// ----------------------------------------------------------------------

export interface ShieldPayload {
  patient_id: string;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  a1c: number | null;
  hr: number | null;
  spo2: number | null;
  hrv: number | null;
  risk_score: number;
  risk_label: string;
  panel_grade: string;
  panel_flagged: number;
  panel_in_range: number;
  biomarkers: SectionsShieldPayload["biomarkers"];
}

interface ShieldState {
  payload: ShieldPayload | null;
  error: string | null;
  loading: boolean;
}
const ShieldContext = createContext<ShieldState>({ payload: null, error: null, loading: true });

// ----------------------------------------------------------------------
// ClinicalData context. Retained as exported types so legacy importers
// in src/app/clinical/page.tsx continue to type-check.
// ----------------------------------------------------------------------

export interface ClinicalPatient {
  name: string;
  id: string;
  age: number;
  score: number;
}
export interface ClinicalVital {
  icon: string;
  val: string;
  unit: string;
  name: string;
  s: string;
}
export interface ClinicalDomain {
  name: string;
  score: number;
}
export interface ClinicalInsight {
  type: string;
  icon: string;
  title: string;
  body: string;
  cta: string;
  conf: string;
}
export interface ClinicalTimelineItem {
  dot: string;
  date: string;
  title: string;
  text: string;
}
export interface ClinicalMeal {
  time: string;
  name: string;
  desc: string;
  tags: string[];
}
export interface ClinicalData {
  patient: ClinicalPatient;
  vitals: ClinicalVital[];
  domains: ClinicalDomain[];
  insights: ClinicalInsight[];
  timeline: ClinicalTimelineItem[];
  meals: ClinicalMeal[];
  wearHr7Day: number[];
  wearSteps7Day: number[];
  wearDays: string[];
  primaryDeviceLabel?: string;
}

const EMPTY_CLINICAL_DATA: ClinicalData = {
  patient: { name: "", id: "", age: 0, score: 0 },
  vitals: [],
  domains: [],
  insights: [],
  timeline: [],
  meals: [],
  wearHr7Day: [],
  wearSteps7Day: [],
  wearDays: [],
};

const ClinicalDataContext = createContext<ClinicalData>(EMPTY_CLINICAL_DATA);

// ----------------------------------------------------------------------
// Tab error boundary
// ----------------------------------------------------------------------

class TabErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(p: { children: ReactNode }) {
    super(p);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {}
  render() {
    if (this.state.hasError) {
      return (
        <div className="sov-err">
          This tab could not load. Other tabs and the ZK Shield are unaffected.
          Try switching tabs and returning.
        </div>
      );
    }
    return this.props.children;
  }
}

// ----------------------------------------------------------------------
// Stub used by tabs that are restored to the nav but not yet wired to
// a data source.
// ----------------------------------------------------------------------

function Stub({
  title,
  body,
  tag = "Pending data wiring",
}: {
  title: string;
  body: string;
  tag?: string;
}) {
  return (
    <div className="sov-stub">
      <div className="sov-stub-title">{title}</div>
      <div className="sov-stub-body">{body}</div>
      <span className="sov-stub-tag">{tag}</span>
    </div>
  );
}

// ----------------------------------------------------------------------
// Patient tabs
// ----------------------------------------------------------------------

function HealthTab() {
  const { payload: shield, loading } = useContext(ShieldContext);
  const { patient } = useContext(ClinicalDataContext);
  const sectionsShield = shield as unknown as SectionsShieldPayload | null;
  return (
    <>
      <LiveWearable />
      <ZKShieldBanner />
      <PatientCard
        patientId={shield?.patient_id || patient.id || ""}
        name={patient.name || ""}
        age={patient.age || 0}
        shield={sectionsShield}
        shieldLoading={loading}
      />
      <ActiveProtocols shield={sectionsShield} />
      <RiskDomains shield={sectionsShield} />
    </>
  );
}

function InsightsTab() {
  return (
    <Stub
      title="Insights"
      body="AI-generated clinical insights, workout plan, and a longitudinal health timeline. Reads from /api/shield once the insights generator is back online."
    />
  );
}

function NutritionTab() {
  return (
    <Stub
      title="Nutrition"
      body="Personalized meal plan, macro targets, and a daily meal log. Pulls from the Shield-anonymized AI plan once the nutrition generator is back online."
    />
  );
}

function WearableTab() {
  return (
    <>
      <LiveWearable />
      <Stub
        title="7-day trends"
        body="Heart rate, steps, sleep, and HRV trend charts pulled from /api/wearable/history. The strip above shows the latest live read; this view will surface the 7-day series."
      />
    </>
  );
}

function AITab() {
  return <HealthIntelTab />;
}

function ProfileTab() {
  const { payload: shield } = useContext(ShieldContext);
  const { patient } = useContext(ClinicalDataContext);
  const id = shield?.patient_id || patient.id || "";
  const name = patient.name || "Not yet entered";
  const age = patient.age > 0 ? `Age ${patient.age}` : "Age not entered";
  return (
    <div className="sov-stub">
      <div className="sov-stub-title">{name}</div>
      <div className="sov-stub-body" style={{ fontFamily: "'DM Mono',monospace", letterSpacing: ".04em" }}>
        {chkIdFor(id)} &middot; {age}
      </div>
      <div className="sov-stub-body" style={{ marginTop: 12 }}>
        Profile editor, community affiliation, enrollment date, primary
        physician, and next-scan scheduling will land here. For now, edit
        from the dashboard Profile card.
      </div>
      <span className="sov-stub-tag">Pending profile editor</span>
    </div>
  );
}

// ----------------------------------------------------------------------
// Clinical tabs
// ----------------------------------------------------------------------

function BloodTab() {
  return (
    <Stub
      title="Blood Panel"
      body="Full categorized longevity biomarker panel: metabolic, cardiovascular, organ, blood, hormonal, longevity, cognitive. Reads from /api/shield/decrypt with three-zone range bars per marker."
    />
  );
}

function TelehealthTab() {
  return (
    <Stub
      title="Telehealth"
      body="Upcoming appointments, primary physician, and cost-savings vs reactive treatment. Wired to the appointments table once the clinical telehealth panel is restored."
    />
  );
}

function SovereignTab() {
  return (
    <Stub
      title="Sovereign Shield"
      body="Vault activity timeline, Trace Fiber latency, key custody, and audit log access. Backed by the Sovereign Shield audit trail."
    />
  );
}

function ImpactTab() {
  return (
    <Stub
      title="Impact"
      body="Annual savings vs reactive care, early-detection wins, and protocol adherence outcomes. Backed by the impact ledger once clinical reporting is restored."
    />
  );
}

function ShieldTab() {
  return (
    <Stub
      title="Shield"
      body="Sovereign Prompt Shield status, HIPAA 18-identifier scanner stats, model invocation log, and key rotation history."
    />
  );
}

// ----------------------------------------------------------------------
// Top-level component
// ----------------------------------------------------------------------

type ViewMode = "patient" | "clinical";
type PatientTab = "health" | "insights" | "nutrition" | "wearable" | "ai" | "profile";
type ClinicalTab = "blood" | "telehealth" | "sovereign" | "impact" | "shield";

const PATIENT_NAV: Array<{ id: PatientTab; icon: string; label: string }> = [
  { id: "health", icon: "⌂", label: "Health" },
  { id: "insights", icon: "☼", label: "Insights" },
  { id: "nutrition", icon: "⚘", label: "Nutrition" },
  { id: "wearable", icon: "⌚", label: "Wearable" },
  { id: "ai", icon: "☸", label: "AI" },
  { id: "profile", icon: "⚇", label: "Profile" },
];

const CLINICAL_NAV: Array<{ id: ClinicalTab; icon: string; label: string }> = [
  { id: "blood", icon: "☥", label: "Blood" },
  { id: "telehealth", icon: "☎", label: "Telehealth" },
  { id: "sovereign", icon: "◈", label: "Sovereign" },
  { id: "impact", icon: "↗", label: "Impact" },
  { id: "shield", icon: "☠", label: "Shield" },
];

interface CareIQHealthOSProps {
  clinicalData?: ClinicalData;
  demoMode?: boolean;
}

export default function CareIQHealthOS({
  clinicalData,
  demoMode = false,
}: CareIQHealthOSProps = {}) {
  void demoMode;
  const baseData = clinicalData ?? EMPTY_CLINICAL_DATA;

  const [shield, setShield] = useState<ShieldPayload | null>(null);
  const [shieldErr, setShieldErr] = useState<string | null>(null);
  const [shieldLoading, setShieldLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/shield/decrypt", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (!cancelled) {
            setShieldErr(data?.error || `shield ${r.status}`);
            setShieldLoading(false);
          }
          return;
        }
        if (!cancelled) {
          setShield(data as ShieldPayload);
          setShieldLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setShieldErr((e as Error).message);
          setShieldLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const data: ClinicalData = {
    ...baseData,
    patient: {
      ...baseData.patient,
      score: shield ? Math.round(shield.risk_score) : 0,
    },
  };

  const [mode, setMode] = useState<ViewMode>("patient");
  const [patientTab, setPatientTab] = useState<PatientTab>("health");
  const [clinicalTab, setClinicalTab] = useState<ClinicalTab>("blood");

  const renderTab = () => {
    if (mode === "clinical") {
      switch (clinicalTab) {
        case "telehealth":
          return <TelehealthTab />;
        case "sovereign":
          return <SovereignTab />;
        case "impact":
          return <ImpactTab />;
        case "shield":
          return <ShieldTab />;
        case "blood":
        default:
          return <BloodTab />;
      }
    }
    switch (patientTab) {
      case "insights":
        return <InsightsTab />;
      case "nutrition":
        return <NutritionTab />;
      case "wearable":
        return <WearableTab />;
      case "ai":
        return <AITab />;
      case "profile":
        return <ProfileTab />;
      case "health":
      default:
        return <HealthTab />;
    }
  };

  // Health tab and Wearable tab include the Live Wearable + ZK banner
  // themselves. Every other tab gets them at the top of the scroll
  // region so the live patient telemetry is always visible.
  const tabRendersWearable =
    mode === "patient" && (patientTab === "health" || patientTab === "wearable");
  const showWearableAtTop = !tabRendersWearable;

  const navItems = mode === "patient" ? PATIENT_NAV : CLINICAL_NAV;
  const navClass = mode === "patient" ? "sov-bnav-6" : "sov-bnav-5";

  return (
    <ClinicalDataContext.Provider value={data}>
      <ShieldContext.Provider
        value={{ payload: shield, error: shieldErr, loading: shieldLoading }}
      >
        <style>{CSS}</style>
        <div className="sov">
          <div className="sov-hdr">
            <div className="sov-hdr-row">
              <div className="sov-logo">
                <div className="sov-logo-mark">IQ</div>
                <div>
                  <div className="sov-logo-name">CareIQ</div>
                  <div className="sov-logo-sub">Health Intelligence</div>
                </div>
              </div>
              <div className="zk-pill">
                <span className="dot" />
                ZK Shield On
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                marginTop: 10,
              }}
            >
              <div className="sov-mode" role="tablist" aria-label="View mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "patient"}
                  onClick={() => setMode("patient")}
                  className={`sov-mode-btn ${mode === "patient" ? "on" : ""}`}
                >
                  Patient
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "clinical"}
                  onClick={() => setMode("clinical")}
                  className={`sov-mode-btn ${mode === "clinical" ? "on" : ""}`}
                >
                  Clinical
                </button>
              </div>
              <InviteFamilyModal patientName={baseData.patient.name || ""} />
            </div>
          </div>

          {shieldErr && mode === "patient" && patientTab === "health" && (
            <div className="sov-err">Vitals not available: {shieldErr}</div>
          )}

          <div className="sov-scroll">
            <div className="sov-pad">
              {showWearableAtTop && (
                <>
                  <LiveWearable />
                  <ZKShieldBanner />
                </>
              )}
              <TabErrorBoundary>{renderTab()}</TabErrorBoundary>
            </div>
          </div>

          <div className={`sov-bnav ${navClass}`}>
            {navItems.map((n) => {
              const isOn =
                mode === "patient"
                  ? n.id === patientTab
                  : n.id === clinicalTab;
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    if (mode === "patient") setPatientTab(n.id as PatientTab);
                    else setClinicalTab(n.id as ClinicalTab);
                  }}
                  className={`sov-bnav-btn ${isOn ? "on" : ""}`}
                  aria-current={isOn ? "page" : undefined}
                >
                  <span className="sov-bnav-icon">{n.icon}</span>
                  <span className="sov-bnav-lbl">{n.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </ShieldContext.Provider>
    </ClinicalDataContext.Provider>
  );
}
