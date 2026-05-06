"use client";

import { useState, useEffect, useContext, createContext, Component, ReactNode } from "react";
import InviteFamilyModal from "@/components/InviteFamilyModal";
import {
  SovereignWearable,
  ZKShieldBanner,
  PatientCard,
  ActiveProtocols,
  RiskDomains,
  MedsTab,
  FamilyTab,
  HealthOSTab,
  type SectionsShieldPayload,
} from "@/components/careiq/Sections";

/* ======================================================================
   CareCircle Sovereign Edition shell.

   The patient surface is rebuilt around the orange/gold Sovereign Edition
   visual standard. Above the fold every screen carries the Sovereign
   Wearable strip and the ZK Sovereign Shield attestation banner. Bottom
   nav is four tabs: Home, Meds, Family, Health OS.

   Data plane stays the same: the Shield decrypt response (panel + risk
   score) flows through ShieldContext, the lightweight wearable polling
   happens inside SovereignWearable, and the medication / circle / message
   reads happen inside their respective tab components.
   ====================================================================== */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Mono:wght@300;400;500&family=Outfit:wght@300;400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
.sov{display:flex;flex-direction:column;height:100vh;height:100dvh;font-family:'Outfit',sans-serif;color:#eef2f8;background:#0b1220;position:relative;overflow:hidden;max-width:480px;margin:0 auto}
.sov::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse 80% 40% at 80% 0%,rgba(249,115,22,0.08) 0%,transparent 60%),radial-gradient(ellipse 60% 60% at 0% 100%,rgba(128,96,204,0.06) 0%,transparent 60%)}
.sov-hdr{position:relative;z-index:10;flex-shrink:0;padding:14px 18px 12px;background:rgba(11,18,32,0.92);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.06)}
.sov-hdr-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.sov-logo{display:flex;align-items:center;gap:10px;min-width:0}
.sov-logo-mark{width:38px;height:38px;border-radius:9px;background:linear-gradient(135deg,#f97316,#fb923c);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#1a1208;flex-shrink:0;letter-spacing:.05em}
.sov-logo-name{font-family:'Playfair Display',serif;font-size:17px;color:#eef2f8;line-height:1}
.sov-logo-sub{font-family:'DM Mono',monospace;font-size:8px;color:#f97316;letter-spacing:.22em;text-transform:uppercase;margin-top:3px}
.zk-pill{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:14px;background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.35);font-family:'DM Mono',monospace;font-size:9px;color:#4ade80;font-weight:700;letter-spacing:.14em;text-transform:uppercase;flex-shrink:0;white-space:nowrap}
.zk-pill .dot{width:6px;height:6px;border-radius:50%;background:#4ade80;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.sov-scroll{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;position:relative;z-index:1}
.sov-pad{padding:14px 18px calc(96px + env(safe-area-inset-bottom,0px))}
.sov-bnav{position:fixed;bottom:0;left:0;right:0;background:rgba(11,18,32,0.97);backdrop-filter:blur(20px);border-top:1px solid rgba(255,255,255,0.06);display:grid;grid-template-columns:repeat(4,1fr);padding:8px 4px calc(10px + env(safe-area-inset-bottom,0px));z-index:20;max-width:480px;margin:0 auto}
.sov-bnav-btn{background:transparent;border:none;color:#7a9bbf;font-family:'Outfit',sans-serif;font-size:10px;font-weight:600;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 4px;border-radius:9px;transition:color .2s;min-height:50px;justify-content:center;position:relative}
.sov-bnav-btn.on{color:#f97316}
.sov-bnav-btn.on::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:32px;height:2px;background:linear-gradient(90deg,#f97316,#fb923c);border-radius:0 0 2px 2px}
.sov-bnav-icon{font-size:16px;line-height:1}
.sov-bnav-lbl{font-size:9px;letter-spacing:.04em}
.sov-err{padding:14px;background:rgba(232,82,110,0.06);border:1px solid rgba(232,82,110,0.25);border-radius:11px;margin:14px 18px;color:#e8526e;font-size:11px;line-height:1.5}
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
// ClinicalData context (only used to source patient name + age + id)
// ----------------------------------------------------------------------

export interface ClinicalPatient {
  name: string;
  id: string;
  age: number;
  score: number;
}
export interface ClinicalData {
  patient: ClinicalPatient;
  vitals: unknown[];
  domains: unknown[];
  insights: unknown[];
  timeline: unknown[];
  meals: unknown[];
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
          This tab could not load. Other tabs and the Sovereign Shield are unaffected.
          Try switching tabs and returning.
        </div>
      );
    }
    return this.props.children;
  }
}

// ----------------------------------------------------------------------
// HomeTab (Patient card + Active Protocols + Risk Domains)
// ----------------------------------------------------------------------

function HomeTab() {
  const { payload: shield, loading } = useContext(ShieldContext);
  const { patient } = useContext(ClinicalDataContext);
  const sectionsShield = shield as unknown as SectionsShieldPayload | null;
  return (
    <>
      <SovereignWearable />
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

// ----------------------------------------------------------------------
// Top-level component
// ----------------------------------------------------------------------

type TabId = "home" | "meds" | "family" | "healthos";

const NAV: Array<{ id: TabId; icon: string; label: string }> = [
  { id: "home", icon: "⌂", label: "Home" },
  { id: "meds", icon: "☥", label: "Meds" },
  { id: "family", icon: "♤", label: "Family" },
  { id: "healthos", icon: "☸", label: "Health OS" },
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

  const [tab, setTab] = useState<TabId>("home");

  const renderTab = () => {
    switch (tab) {
      case "meds":
        return <MedsTab />;
      case "family":
        return <FamilyTab />;
      case "healthos":
        return <HealthOSTab />;
      case "home":
      default:
        return <HomeTab />;
    }
  };

  // Top of every tab: Sovereign Wearable + ZK banner.
  // Home tab ALSO includes them (we render the home composition once via
  // HomeTab so we don't duplicate them when on home; for non-home tabs we
  // surface them above the tab body so the live strip is always visible).
  const showWearableAtTop = tab !== "home";

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
                <div className="sov-logo-mark">CC</div>
                <div>
                  <div className="sov-logo-name">CareCircle</div>
                  <div className="sov-logo-sub">Sovereign Edition</div>
                </div>
              </div>
              <div className="zk-pill">
                <span className="dot" />
                ZK Shield On
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <InviteFamilyModal patientName={baseData.patient.name || ""} />
            </div>
          </div>

          {shieldErr && tab === "home" && (
            <div className="sov-err">Vitals not available: {shieldErr}</div>
          )}

          <div className="sov-scroll">
            <div className="sov-pad">
              {showWearableAtTop && (
                <>
                  <SovereignWearable />
                  <ZKShieldBanner />
                </>
              )}
              <TabErrorBoundary>{renderTab()}</TabErrorBoundary>
            </div>
          </div>

          <div className="sov-bnav">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setTab(n.id)}
                className={`sov-bnav-btn ${tab === n.id ? "on" : ""}`}
                aria-current={tab === n.id ? "page" : undefined}
              >
                <span className="sov-bnav-icon">{n.icon}</span>
                <span className="sov-bnav-lbl">{n.label}</span>
              </button>
            ))}
          </div>
        </div>
      </ShieldContext.Provider>
    </ClinicalDataContext.Provider>
  );
}
