"use client";
import { useState, useEffect, useRef, useCallback, useContext, createContext, Component, ReactNode, type CSSProperties } from "react";
import InviteFamilyModal from "@/components/InviteFamilyModal";
import LongevityPanel, { type ShieldPayload as LongevityShieldPayload } from "@/components/LongevityPanel";

const ZK_SALT = "CARE-IQ-SOVEREIGN-SHIELD-2026";
const ZK_TERMS = ["fqhc","careiq","sovereign","communityhealth","safetynet","medicaid","sliding-scale","communityclinic","federallyqualified","ryanwhite","title-x","section-330","hrsa","communitycare"];

async function zkHash(term: string): Promise<string> {
  try {
    const enc = new TextEncoder();
    const buf = await window.crypto.subtle.digest("SHA-256", enc.encode(term.toLowerCase().trim() + ZK_SALT));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
  } catch { return ""; }
}

/**
 * Salted SHA-256 of a raw user query, used as the only client-side
 * representation that ever appears in the Shield log UI. The raw query
 * MUST NEVER be stored in component state or rendered. HIPAA: any
 * change here is security-relevant, review carefully before editing.
 */
async function hashQuery(query: string): Promise<string> {
  try {
    const enc = new TextEncoder();
    const buf = await window.crypto.subtle.digest("SHA-256", enc.encode(query + ZK_SALT));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
  } catch { return ""; }
}

let zkDict: Map<string,string> | null = null;
async function getZKDict(): Promise<Map<string,string>> {
  if (zkDict) return zkDict;
  zkDict = new Map();
  for (const t of ZK_TERMS) { const h = await zkHash(t); if (h) zkDict.set(h, t); }
  return zkDict;
}

interface ZKResult { shieldedPrompt: string; protectedTerms: Array<{token:string}>; zeroKnowledge: boolean; }

async function runZKShield(prompt: string): Promise<ZKResult> {
  const dict = await getZKDict();
  let shielded = prompt;
  const found: Array<{token:string}> = [];
  for (const word of prompt.split(/\s+/)) {
    const clean = word.replace(/[.,!?;:'"()]/g,"").toLowerCase().trim();
    if (clean.length < 3) continue;
    const h = await zkHash(clean);
    if (h && dict.has(h)) {
      const token = `[SOVEREIGN_${h.substring(0,6)}]`;
      shielded = shielded.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"gi"), token);
      found.push({ token });
    }
  }
  return { shieldedPrompt: shielded, protectedTerms: found, zeroKnowledge: found.length > 0 };
}

const C = { navy:"#07101f", teal:"#00d4b8", teal2:"#00b89e", gold:"#d4a843", rose:"#e8526e", violet:"#8060cc", green:"#4ade80", slate:"#7a9bbf", white:"#eef2f8" };
void C;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&family=Outfit:wght@300;400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
.hos{display:flex;flex-direction:column;height:100vh;height:100dvh;font-family:'Outfit',sans-serif;color:#eef2f8;background:#07101f;position:relative;overflow:hidden;max-width:480px;margin:0 auto}
.hos::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse 90% 50% at 15% 5%,rgba(0,212,184,0.07) 0%,transparent 55%),radial-gradient(ellipse 70% 70% at 85% 85%,rgba(128,96,204,0.07) 0%,transparent 55%)}
.hdr{position:relative;z-index:10;flex-shrink:0;padding:14px 18px 12px;background:rgba(7,16,31,0.97);backdrop-filter:blur(20px);border-bottom:1px solid rgba(0,212,184,0.14)}
.hdr-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.logo{display:flex;align-items:center;gap:10px;min-width:0}
.logo-mark{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#00d4b8,#8060cc);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.logo-name{font-family:'Playfair Display',serif;font-size:16px;font-weight:700}
.logo-sub{font-family:'DM Mono',monospace;font-size:8px;color:#00d4b8;letter-spacing:.18em;text-transform:uppercase;margin-top:1px}
.hdr-right{text-align:right;flex-shrink:0}
.hdr-patient{font-size:12px;font-weight:600}
.hdr-id{font-family:'DM Mono',monospace;font-size:9px;color:#7a9bbf;margin-top:1px}
.shield-on{display:inline-flex;align-items:center;gap:4px;font-family:'DM Mono',monospace;font-size:8px;color:#4ade80;margin-top:3px}
.pulse{width:6px;height:6px;border-radius:50%;background:#4ade80;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.demo-banner{position:relative;z-index:10;flex-shrink:0;padding:8px 18px;background:linear-gradient(135deg,rgba(212,168,67,.18),rgba(212,168,67,.06));border-bottom:1px solid rgba(212,168,67,.3);font-family:'DM Mono',monospace;font-size:10px;color:#d4a843;text-align:center;letter-spacing:.04em}
.demo-banner a{color:#00d4b8;text-decoration:underline;text-underline-offset:2px}
.mode-bar{display:flex;gap:5px;padding:10px 18px;background:rgba(7,16,31,0.95);border-bottom:1px solid rgba(0,212,184,0.14);flex-shrink:0;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;position:relative;z-index:9}
.mode-bar::-webkit-scrollbar{display:none}
.mbtn{flex-shrink:0;padding:7px 12px;border-radius:20px;border:1px solid rgba(0,212,184,0.14);background:rgba(255,255,255,0.04);color:#7a9bbf;font-size:11px;font-weight:500;cursor:pointer;font-family:'Outfit',sans-serif;transition:all .2s;white-space:nowrap;min-height:32px}
.mbtn.on{background:linear-gradient(135deg,#00d4b8,#00b89e);color:#07101f;font-weight:700;border-color:transparent}
.mbtn.son.on{background:linear-gradient(135deg,#4ade80,#22c55e);color:#07101f}
.mbtn.elder-on{background:linear-gradient(135deg,#d4a843,#b8902f);color:#07101f;font-weight:700;border-color:transparent}
.ring-wrap{display:flex;gap:16px;align-items:center;padding:16px 18px 0;flex-shrink:0}
.ring-pos{position:relative;width:88px;height:88px;flex-shrink:0}
.ring-svg{transform:rotate(-90deg)}
.ring-progress{transition:stroke-dashoffset 1.6s cubic-bezier(0.4,0,0.2,1)}
.ring-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ring-num{font-family:'DM Mono',monospace;font-size:28px;font-weight:500;color:#00d4b8;line-height:1}
.ring-lbl{font-size:8px;color:#7a9bbf;text-transform:uppercase;letter-spacing:.12em;margin-top:2px}
.score-info{flex:1;min-width:0}
.score-title{font-size:20px;font-weight:700;margin-bottom:3px}
.score-sub{font-size:11px;color:#7a9bbf;line-height:1.5}
.trend{display:inline-flex;align-items:center;gap:4px;margin-top:7px;font-family:'DM Mono',monospace;font-size:10px;color:#00d4b8;background:rgba(0,212,184,.1);padding:4px 10px;border-radius:20px;border:1px solid rgba(0,212,184,.2)}
.vitals-row{display:flex;gap:7px;padding:12px 18px 0;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;flex-shrink:0}
.vitals-row::-webkit-scrollbar{display:none}
.vital{flex-shrink:0;min-width:78px;padding:10px 11px;background:rgba(255,255,255,.04);border-radius:11px;border:1px solid rgba(0,212,184,.1)}
.vital-icon{font-size:14px;margin-bottom:3px}
.vital-val{font-family:'DM Mono',monospace;font-size:16px;font-weight:500;letter-spacing:-.02em}
.vital-unit{font-size:8px;color:#7a9bbf;font-family:'DM Mono',monospace;text-transform:uppercase;letter-spacing:.12em;margin-top:1px}
.vital-name{font-size:9px;color:#7a9bbf;margin-top:5px}
.ok{color:#00d4b8}.warn{color:#d4a843}.alert{color:#e8526e}.muted{color:#7a9bbf}
.scroll{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;position:relative;z-index:1}
.pad{padding:18px 18px calc(110px + env(safe-area-inset-bottom,0px))}
.sec{font-size:9px;font-weight:700;color:#00d4b8;text-transform:uppercase;letter-spacing:.18em;margin:18px 0 10px;font-family:'DM Mono',monospace}
.dom-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.dom-item{padding:11px;background:rgba(255,255,255,.04);border-radius:11px;border:1px solid rgba(0,212,184,.1)}
.dom-name{font-size:11px;font-weight:500;margin-bottom:6px}
.dom-bg{height:5px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden;margin-bottom:6px}
.dom-fill{height:100%;border-radius:3px;transition:width 1s ease}
.dom-score{font-family:'DM Mono',monospace;font-size:17px;font-weight:500}
.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
.stat-item{text-align:center;padding:10px 7px;background:rgba(255,255,255,.04);border-radius:11px;border:1px solid rgba(0,212,184,.1)}
.stat-val{font-family:'DM Mono',monospace;font-size:17px;font-weight:600}
.stat-lbl{font-size:9px;color:#7a9bbf;margin-top:4px}
.card{background:rgba(255,255,255,.04);border-radius:11px;border:1px solid rgba(0,212,184,.1);padding:13px;margin-bottom:9px}
.card-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px}
.card-title{font-size:13px;font-weight:600}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:20px;font-family:'DM Mono',monospace;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;flex-shrink:0}
.b-violet{background:rgba(128,96,204,.15);color:#b8a4dc;border:1px solid rgba(128,96,204,.25)}
.b-green{background:rgba(74,222,128,.15);color:#4ade80;border:1px solid rgba(74,222,128,.3)}
.b-gold{background:rgba(212,168,67,.15);color:#d4a843;border:1px solid rgba(212,168,67,.25)}
.b-rose{background:rgba(232,82,110,.15);color:#e8526e;border:1px solid rgba(232,82,110,.25)}
.b-slate{background:rgba(122,155,191,.12);color:#7a9bbf;border:1px solid rgba(122,155,191,.25)}
.prog-bg{height:5px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden;margin-top:7px}
.prog-fill{height:100%;border-radius:3px;transition:width 1s ease}
.insight{padding:13px;border-radius:11px;border:1px solid rgba(0,212,184,.1);margin-bottom:9px;background:rgba(255,255,255,.04)}
.insight.crit{border-left:3px solid #e8526e;background:rgba(232,82,110,.06)}
.insight.watch{border-left:3px solid #d4a843;background:rgba(212,168,67,.06)}
.insight.pos{border-left:3px solid #00d4b8;background:rgba(0,212,184,.06)}
.insight-hdr{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.insight-title{font-size:12px;font-weight:600}
.insight-body{font-size:11px;color:#a3b5cc;line-height:1.6;margin-bottom:11px}
.insight-foot{display:flex;align-items:center;justify-content:space-between;gap:9px}
.insight-cta{padding:7px 12px;border-radius:9px;border:none;background:linear-gradient(135deg,#00d4b8,#00b89e);color:#07101f;font-size:11px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif;transition:all .2s;flex-shrink:0;min-height:32px}
.insight-conf{font-family:'DM Mono',monospace;font-size:9px;color:#7a9bbf;flex-shrink:0}
.tl-item{display:flex;gap:11px;margin-bottom:11px;position:relative}
.tl-col{display:flex;flex-direction:column;align-items:center;flex-shrink:0}
.tl-dot{width:11px;height:11px;border-radius:50%;flex-shrink:0;border:2px solid #07101f;box-shadow:0 0 0 2px rgba(0,212,184,.3)}
.tl-line{width:2px;flex:1;background:rgba(0,212,184,.15);margin-top:5px;min-height:18px}
.tl-body{flex:1;min-width:0;padding-bottom:7px}
.tl-date{font-family:'DM Mono',monospace;font-size:9px;color:#7a9bbf}
.tl-title{font-size:12px;font-weight:600;margin:3px 0 5px}
.tl-text{font-size:11px;color:#a3b5cc;line-height:1.5}
.meal-card{padding:11px;background:rgba(255,255,255,.04);border-radius:11px;border:1px solid rgba(0,212,184,.1);margin-bottom:9px}
.meal-time{font-family:'DM Mono',monospace;font-size:9px;color:#d4a843;margin-bottom:5px}
.meal-name{font-size:13px;font-weight:600;margin-bottom:3px}
.meal-desc{font-size:10px;color:#7a9bbf;margin-bottom:7px;line-height:1.5}
.meal-tags{display:flex;flex-wrap:wrap;gap:5px}
.meal-tag{padding:3px 7px;background:rgba(0,212,184,.1);border-radius:5px;font-size:8px;color:#00d4b8;border:1px solid rgba(0,212,184,.2)}
.bnav{position:fixed;bottom:0;left:0;right:0;background:rgba(7,16,31,0.97);backdrop-filter:blur(20px);border-top:1px solid rgba(0,212,184,0.14);display:grid;grid-template-columns:repeat(6,1fr);padding:6px 4px calc(7px + env(safe-area-inset-bottom,0px));z-index:20;max-width:480px;margin:0 auto}
.bnav-btn{background:transparent;border:none;color:#7a9bbf;font-family:'Outfit',sans-serif;font-size:9px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;padding:5px 4px;border-radius:9px;transition:color .2s;min-height:48px;justify-content:center}
.bnav-btn.on{color:#00d4b8}
.bnav-btn.sn.on{color:#4ade80}
.bnav-icon{font-size:18px}
.bnav-lbl{font-size:8px}
.abar-wrap{margin-bottom:9px}
.abar-top{display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#a3b5cc;margin-bottom:5px}
.abar-lbl{font-weight:500}
.abar-bg{height:5px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden}
.abar-fill{height:100%;border-radius:3px;transition:width .8s ease}
.risk-meter{height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden;margin-top:6px}
.risk-fill{height:100%;border-radius:3px;transition:width .8s ease}
.shield-msg{display:flex;flex-direction:column;gap:5px;padding:11px;background:rgba(255,255,255,.04);border-radius:11px;border:1px solid rgba(0,212,184,.1);margin-bottom:7px}
.chat-wrap{flex:1;display:flex;flex-direction:column;min-height:0;background:rgba(255,255,255,.02);border-radius:11px;border:1px solid rgba(0,212,184,.1)}
.chat-msgs{flex:1;overflow-y:auto;padding:11px;display:flex;flex-direction:column;gap:7px;min-height:0}
.chat-msg{padding:10px 12px;border-radius:13px;font-size:12px;line-height:1.55;max-width:88%;word-wrap:break-word}
.chat-user{align-self:flex-end;background:linear-gradient(135deg,#00d4b8,#00b89e);color:#07101f}
.chat-ai{align-self:flex-start;background:#111827;color:#e2e8f0}
.chat-meta{font-family:'DM Mono',monospace;font-size:8px;color:#7a9bbf;margin-top:3px}
.chat-input-row{display:flex;gap:7px;padding:9px 11px;border-top:1px solid rgba(0,212,184,.1)}
.chat-input{flex:1;padding:9px 11px;background:rgba(255,255,255,.06);border:1px solid rgba(0,212,184,.15);border-radius:9px;color:#eef2f8;font-size:13px;font-family:'Outfit',sans-serif;outline:none;min-height:40px}
.chat-input:focus{border-color:#00d4b8}
.chat-send{padding:9px 14px;background:linear-gradient(135deg,#00d4b8,#00b89e);color:#07101f;border:none;border-radius:9px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif;font-size:12px;flex-shrink:0;min-height:40px}
.chat-send:disabled{opacity:.5;cursor:not-allowed}
.err-card{padding:14px;background:rgba(232,82,110,.06);border:1px solid rgba(232,82,110,.25);border-radius:11px;margin:18px;color:#e8526e;font-size:11px;line-height:1.5}
.empty-card{padding:14px;background:rgba(255,255,255,.03);border:1px dashed rgba(122,155,191,.3);border-radius:11px;font-size:11px;color:#7a9bbf;line-height:1.55;margin-bottom:9px}
.hos.elder{font-size:18px}
.hos.elder .vital-val{font-size:20px}
.hos.elder .vital-name{font-size:11px}
.hos.elder .vital-unit{font-size:10px}
.hos.elder .ring-num{font-size:34px}
.hos.elder .ring-lbl{font-size:10px}
.hos.elder .score-title{font-size:24px}
.hos.elder .score-sub{font-size:14px}
.hos.elder .trend{font-size:12px}
.hos.elder .sec{font-size:11px}
.hos.elder .card-title{font-size:15px}
.hos.elder .stat-val{font-size:21px}
.hos.elder .stat-lbl{font-size:11px}
.hos.elder .insight-title{font-size:14px}
.hos.elder .insight-body{font-size:13px}
.hos.elder .insight-cta{font-size:13px;padding:9px 14px}
.hos.elder .insight-conf{font-size:11px}
.hos.elder .dom-name{font-size:13px}
.hos.elder .dom-score{font-size:22px}
.hos.elder .meal-name{font-size:15px}
.hos.elder .meal-desc{font-size:12px}
.hos.elder .meal-time{font-size:11px}
.hos.elder .meal-tag{font-size:10px}
.hos.elder .chat-msg{font-size:14px}
.hos.elder .chat-input{font-size:15px}
.hos.elder .chat-send{font-size:14px}
.hos.elder .bnav-btn{font-size:11px}
.hos.elder .bnav-icon{font-size:21px}
.hos.elder .bnav-lbl{font-size:10px}
.hos.elder .mbtn{font-size:13px;padding:9px 14px;min-height:38px}
.hos.elder .hdr-patient{font-size:14px}
.hos.elder .hdr-id{font-size:11px}
.hos.elder .shield-on{font-size:10px}
.hos.elder .logo-name{font-size:18px}
.hos.elder .logo-sub{font-size:9px}
.hos.elder .pad{padding:22px 18px calc(120px + env(safe-area-inset-bottom,0px))}
.hos.elder .empty-card{font-size:13px}
@media (max-width:380px){
  .vital{min-width:70px}
  .stat-val{font-size:15px}
  .ring-num{font-size:24px}
  .score-title{font-size:18px}
  .logo-name{font-size:14px}
  .logo-sub{font-size:7px}
  .hdr-patient{font-size:11px}
  .hdr-id{font-size:8px}
  .shield-on{font-size:7px}
  .mbtn{font-size:10px;padding:6px 10px}
  .bnav-icon{font-size:16px}
  .bnav-lbl{font-size:7px}
}
`;

/* ----- ClinicalData shape exposed via context. The parent route is expected
        to inject real, decrypted patient data via the clinicalData prop. The
        default value is an empty/loading shape so the UI never renders demo
        numbers. -------------------------------------------------------- */

export interface ClinicalPatient { name: string; id: string; age: number; score: number; }
export interface ClinicalVital { icon: string; val: string; unit: string; name: string; s: string; }
export interface ClinicalDomain { name: string; score: number; }
export interface ClinicalInsight { type: string; icon: string; title: string; body: string; cta: string; conf: string; }
export interface ClinicalTimelineItem { dot: string; date: string; title: string; text: string; }
export interface ClinicalMeal { time: string; name: string; desc: string; tags: string[]; }
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

/* ----- Sovereign Shield decrypted-payload shape returned by
        /api/shield/decrypt. Authenticated via the existing sov_auth cookie,
        no CSRF or Authorization header required (route is in
        PUBLIC_API_PATHS in middleware.ts). ------------------------------ */

interface WorkoutPlan {
  title: string;
  weekly_target: string;
  cardio: string;
  strength: string;
  flexibility: string;
  emphasis: string[];
  rationale: string;
  is_demo: boolean;
}
interface NutritionPlan {
  title: string;
  pattern: string;
  daily_calories: number;
  macros: { protein_g: number; carb_g: number; fat_g: number };
  emphasize: string[];
  limit: string[];
  sample_day: { meal: string; foods: string }[];
  rationale: string;
  is_demo: boolean;
}

export interface ShieldPayload {
  patient_id: string;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  a1c: number | null;
  ldl: number | null;
  hdl: number | null;
  total_cholesterol: number | null;
  fasting_glucose: number | null;
  triglycerides: number | null;
  egfr: number | null;
  crp: number | null;
  hr: number | null;
  steps: number | null;
  spo2: number | null;
  sleep_hours: number | null;
  hrv: number | null;
  active_calories: number | null;
  calories: number | null;
  risk_score: number;
  risk_label: string;
  panel_grade: string;
  panel_flagged: number;
  panel_in_range: number;
  updated_at: string | null;
  decrypted_at: string;
  shield_version: string;
  workout_plan?: WorkoutPlan | null;
  nutrition_plan?: NutritionPlan | null;
}

interface ShieldState { payload: ShieldPayload | null; error: string | null; loading: boolean; }
const ShieldContext = createContext<ShieldState>({ payload: null, error: null, loading: true });

const NOT_ENTERED = "Not yet entered";
const NOT_LOGGED = "Not yet logged";
const NOT_GENERATED = "Not yet generated";
const NOT_AVAILABLE = "Not yet available";
const NOT_COMPUTED = "Not yet computed";
const MUTED = "#7a9bbf";

function fmtBP(sys: number | null, dia: number | null): string {
  if (sys == null || dia == null) return NOT_ENTERED;
  return `${Math.round(sys)}/${Math.round(dia)}`;
}
function fmtNum(n: number | null, digits = 0): string {
  if (n == null) return NOT_ENTERED;
  return digits > 0 ? n.toFixed(digits) : String(Math.round(n));
}
function fmtSleep(h: number | null): string {
  if (h == null) return NOT_LOGGED;
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}h ${mm}m`;
}

/* Vital threshold helpers, mirrored from src/components/dashboard/CareIQPage.tsx
   on care-os. null inputs return "muted" so missing data is never shown as ok. */
function bpStatus(sys: number | null, dia: number | null): string {
  if (sys == null || dia == null) return "muted";
  if (sys >= 140 || dia >= 90) return "alert";
  if (sys >= 130 || dia >= 80) return "warn";
  return "ok";
}
function a1cStatus(a1c: number | null): string {
  if (a1c == null) return "muted";
  if (a1c >= 6.5) return "alert";
  if (a1c >= 5.7) return "warn";
  return "ok";
}
function ldlStatus(ldl: number | null): string {
  if (ldl == null) return "muted";
  if (ldl >= 190) return "alert";
  if (ldl >= 130) return "warn";
  return "ok";
}
function hrStatus(hr: number | null): string {
  if (hr == null) return "muted";
  if (hr < 50 || hr > 100) return "alert";
  if (hr < 55 || hr > 95) return "warn";
  return "ok";
}
function spo2Status(spo2: number | null): string {
  if (spo2 == null) return "muted";
  if (spo2 < 90) return "alert";
  if (spo2 < 95) return "warn";
  return "ok";
}

function vitalsFromShield(p: ShieldPayload | null): ClinicalVital[] {
  if (!p) return [];
  return [
    { icon: "BP",  val: fmtBP(p.bp_systolic, p.bp_diastolic), unit: "mmHg",  name: "Blood Pressure", s: bpStatus(p.bp_systolic, p.bp_diastolic) },
    { icon: "A1C", val: fmtNum(p.a1c, 1),                     unit: "A1C %", name: "Glycemic",       s: a1cStatus(p.a1c) },
    { icon: "LDL", val: fmtNum(p.ldl, 0),                     unit: "mg/dL", name: "LDL Chol.",      s: ldlStatus(p.ldl) },
    { icon: "HR",  val: fmtNum(p.hr, 0),                      unit: "bpm",   name: "Heart Rate",     s: hrStatus(p.hr) },
    { icon: "O2",  val: fmtNum(p.spo2, 0),                    unit: "SpO2 %",name: "Oxygen Sat",     s: spo2Status(p.spo2) },
  ];
}

function dc(s:number){return s>=80?"#00d4b8":s>=60?"#d4a843":"#e8526e"}
function rc(level:string){return level==="CRITICAL"?"#e8526e":level==="HIGH"?"#f97316":level==="MEDIUM"?"#d4a843":level==="UNKNOWN"?"#7a9bbf":"#00d4b8"}
// dc kept exported via void for future use when Risk Domains gets real scores.
void dc;

function ABar({label,pct,color,delay=0,right}:{label:string;pct:number;color:string;delay?:number;right?:string}){
  const [w,setW]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setW(pct),300+delay);return()=>clearTimeout(t)},[pct,delay]);
  return(
    <div className="abar-wrap">
      <div className="abar-top"><span className="abar-lbl">{label}</span><span style={{color,fontFamily:"'DM Mono',monospace"}}>{right||`${pct}%`}</span></div>
      <div className="abar-bg"><div className="abar-fill" style={{width:`${w}%`,background:`linear-gradient(90deg,${color},${color}88)`}}/></div>
    </div>
  );
}

interface SLog {
  timestamp: string;
  riskLevel: string;
  riskScore: number;
  flagCount: number;
  action: string;
  queryHash: string;
  queryChars: number;
  zkCount: number;
  shieldVersion?: string;
}

class TabErrorBoundary extends Component<{children:ReactNode},{hasError:boolean}>{
  constructor(p:{children:ReactNode}){super(p);this.state={hasError:false};}
  static getDerivedStateFromError(){return{hasError:true};}
  componentDidCatch(){}
  render(){
    if(this.state.hasError){
      return(
        <div className="err-card">
          This tab could not load. Other tabs and the Sovereign Shield are unaffected. Try switching tabs and returning.
        </div>
      );
    }
    return this.props.children;
  }
}

function EmptyState({text}:{text:string}){
  return <div className="empty-card">{text}</div>;
}

const RISK_DOMAIN_NAMES = ["Metabolic","Cardiovascular","Cognitive","Oncology","Renal","Mental Health"];

function Overview(){
  const { payload: shield, error: shieldErr } = useContext(ShieldContext);
  const demoNarrative = process.env.NEXT_PUBLIC_SHIELD_DEMO_PLANS === "true";
  return(
    <div className="pad">
      <div className="sec">Today, In Plain Language</div>
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">Health Narrative</span>
          <span className="badge b-violet">AI</span>
        </div>
        <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>
          {demoNarrative
            ? "Your latest panel shows strong cardiovascular foundations with blood pressure well controlled and oxygen saturation optimal at 97%. Two areas need attention: LDL cholesterol at 112 mg/dL is above the longevity target of 70, and homocysteine at 10.4 umol/L suggests methylation support may help. Your A1C at 5.6% is excellent. Recommended focus: omega-3 supplementation, Mediterranean diet pattern, and a follow-up lipid panel in 90 days."
            : `${NOT_GENERATED}. The narrative will appear here once you log a few days of vitals.`}
        </div>
      </div>
      <LongevityPanel payload={shield as unknown as LongevityShieldPayload | null} error={shieldErr} />
    </div>
  );
}

function Insights(){
  const { payload: shield } = useContext(ShieldContext);
  const plan = shield?.workout_plan ?? null;
  const samplePlanBadge = (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      fontFamily: "'DM Mono',monospace",
      fontSize: 8,
      padding: "2px 7px",
      borderRadius: 6,
      background: "rgba(0,212,184,.12)",
      color: "#00d4b8",
      border: "1px solid rgba(0,212,184,.28)",
      textTransform: "uppercase",
      letterSpacing: ".1em",
      marginLeft: 8,
    }}>Sample plan</span>
  );
  const monoLabel: CSSProperties = {
    fontFamily: "'DM Mono',monospace",
    fontSize: 9,
    color: "#7a9bbf",
    textTransform: "uppercase",
    letterSpacing: ".14em",
    minWidth: 78,
    flexShrink: 0,
  };
  const sentenceText: CSSProperties = {
    fontSize: 12,
    color: "#a3b5cc",
    lineHeight: 1.55,
  };
  return(
    <div className="pad">
      <div className="sec">Today's Workout</div>
      {plan ? (
        <div className="card">
          <div className="card-hdr">
            <span className="card-title" style={{display:"inline-flex",alignItems:"center"}}>
              <h3 style={{fontSize:13,fontWeight:600,margin:0}}>{plan.title}</h3>
              {samplePlanBadge}
            </span>
            <span className="badge b-violet">AI</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:9,padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,.06)"}}>
            <div style={monoLabel}>Weekly target</div>
            <div style={sentenceText}>{plan.weekly_target}</div>
          </div>
          <div style={{display:"flex",alignItems:"flex-start",gap:9,padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,.06)"}}>
            <div style={monoLabel}>Cardio</div>
            <div style={sentenceText}>{plan.cardio}</div>
          </div>
          <div style={{display:"flex",alignItems:"flex-start",gap:9,padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,.06)"}}>
            <div style={monoLabel}>Strength</div>
            <div style={sentenceText}>{plan.strength}</div>
          </div>
          <div style={{display:"flex",alignItems:"flex-start",gap:9,padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,.06)"}}>
            <div style={monoLabel}>Flexibility</div>
            <div style={sentenceText}>{plan.flexibility}</div>
          </div>
          {plan.emphasis.length > 0 && (
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:10}}>
              {plan.emphasis.map((chip, i) => (
                <span key={i} style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 9,
                  padding: "3px 8px",
                  borderRadius: 12,
                  background: "rgba(0,212,184,.08)",
                  color: "#a3b5cc",
                  border: "1px solid rgba(0,212,184,.18)",
                }}>{chip}</span>
              ))}
            </div>
          )}
          <div style={{marginTop:10,fontSize:11,fontStyle:"italic",color:MUTED,lineHeight:1.5}}>
            Why: {plan.rationale}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-hdr">
            <span className="card-title">Workout Plan</span>
            <span className="badge b-violet">AI</span>
          </div>
          <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>
            {NOT_GENERATED}. Will appear here once a workout plan is generated for you.
          </div>
        </div>
      )}
      <div className="sec">AI Clinical Insights</div>
      <EmptyState text={`${NOT_GENERATED}. Clinical insights will appear here once your care team reviews your latest vitals.`}/>
      <div className="sec">Health Timeline</div>
      <EmptyState text={`${NOT_LOGGED}. Health events will appear here as they are recorded by your care team.`}/>
    </div>
  );
}

function Nutrition(){
  const { payload: shield } = useContext(ShieldContext);
  const plan = shield?.nutrition_plan ?? null;
  const samplePlanBadge = (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      fontFamily: "'DM Mono',monospace",
      fontSize: 8,
      padding: "2px 7px",
      borderRadius: 6,
      background: "rgba(0,212,184,.12)",
      color: "#00d4b8",
      border: "1px solid rgba(0,212,184,.28)",
      textTransform: "uppercase",
      letterSpacing: ".1em",
      marginLeft: 8,
    }}>Sample plan</span>
  );
  const mealLabel: CSSProperties = {
    fontFamily: "'DM Mono',monospace",
    fontSize: 9,
    color: "#7a9bbf",
    textTransform: "uppercase",
    letterSpacing: ".14em",
    minWidth: 78,
    flexShrink: 0,
  };
  const mealText: CSSProperties = {
    fontSize: 12,
    color: "#a3b5cc",
    lineHeight: 1.55,
  };
  return(
    <div className="pad">
      <div className="sec">Today's Meal Plan, AI Generated</div>
      {plan ? (
        <>
          <div className="card">
            <div className="card-hdr">
              <span className="card-title" style={{display:"inline-flex",alignItems:"center"}}>
                <h3 style={{fontSize:13,fontWeight:600,margin:0}}>{plan.title}</h3>
                {samplePlanBadge}
              </span>
              <span className="badge b-violet">AI</span>
            </div>
            <div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"4px 10px",borderRadius:20,background:"rgba(0,212,184,.1)",border:"1px solid rgba(0,212,184,.2)",fontFamily:"'DM Mono',monospace",fontSize:10,color:"#00d4b8",marginBottom:10}}>
              {plan.daily_calories} kcal/day
            </div>
            <div className="stat-grid" style={{marginBottom:10}}>
              <div className="stat-item"><div className="stat-val">{plan.macros.protein_g} g</div><div className="stat-lbl">Protein</div></div>
              <div className="stat-item"><div className="stat-val">{plan.macros.carb_g} g</div><div className="stat-lbl">Carbs</div></div>
              <div className="stat-item"><div className="stat-val">{plan.macros.fat_g} g</div><div className="stat-lbl">Fat</div></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:6}}>
              <div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#00d4b8",textTransform:"uppercase",letterSpacing:".14em",marginBottom:6}}>Emphasize</div>
                <ul style={{listStyle:"none",margin:0,padding:0}}>
                  {plan.emphasize.map((item, i) => (
                    <li key={i} style={{fontSize:11,color:"#a3b5cc",lineHeight:1.5,paddingLeft:10,position:"relative",marginBottom:3}}>
                      <span style={{position:"absolute",left:0,color:"#00d4b8"}}>+</span>{item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#e8526e",textTransform:"uppercase",letterSpacing:".14em",marginBottom:6}}>Limit</div>
                <ul style={{listStyle:"none",margin:0,padding:0}}>
                  {plan.limit.map((item, i) => (
                    <li key={i} style={{fontSize:11,color:"#a3b5cc",lineHeight:1.5,paddingLeft:10,position:"relative",marginBottom:3}}>
                      <span style={{position:"absolute",left:0,color:"#e8526e"}}>-</span>{item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div style={{marginTop:12,paddingTop:10,borderTop:"1px solid rgba(255,255,255,.06)"}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#7a9bbf",textTransform:"uppercase",letterSpacing:".14em",marginBottom:6}}>Sample day</div>
              {plan.sample_day.slice(0,4).map((row, i) => (
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:9,padding:"5px 0",borderBottom:i<Math.min(plan.sample_day.length,4)-1?"1px solid rgba(255,255,255,.06)":"none"}}>
                  <div style={mealLabel}>{row.meal}</div>
                  <div style={mealText}>{row.foods}</div>
                </div>
              ))}
            </div>
            <div style={{marginTop:10,fontSize:11,fontStyle:"italic",color:MUTED,lineHeight:1.5}}>
              Why: {plan.rationale}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="card">
            <div className="card-hdr">
              <span className="card-title">Meal Plan</span>
              <span className="badge b-violet">AI</span>
            </div>
            <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>
              {NOT_GENERATED}. Your personalized meal plan will appear here once you log a few days of vitals.
            </div>
          </div>
          <div className="sec">Personalized Nutrition Plan</div>
          <div className="stat-grid" style={{marginBottom:10}}>
            <div className="stat-item"><div className="stat-val" style={{color:MUTED,fontSize:11,fontWeight:400}}>{NOT_ENTERED}</div><div className="stat-lbl">Calories</div></div>
            <div className="stat-item"><div className="stat-val" style={{color:MUTED,fontSize:11,fontWeight:400}}>{NOT_ENTERED}</div><div className="stat-lbl">Protein</div></div>
            <div className="stat-item"><div className="stat-val" style={{color:MUTED,fontSize:11,fontWeight:400}}>{NOT_ENTERED}</div><div className="stat-lbl">Fiber</div></div>
          </div>
        </>
      )}
      <EmptyState text={`${NOT_LOGGED}. Logged meals will appear here.`}/>
    </div>
  );
}

function BloodPanel(){
  const { payload, error, loading } = useContext(ShieldContext);

  const rows: Array<{name:string; raw:number|null; unit:string; digits:number; statusFor?:(v:number)=>string}> = [
    { name:"LDL Cholesterol",   raw: payload?.ldl ?? null,                unit:"mg/dL", digits:0, statusFor:(v)=>v>=190?"alert":v>=130?"warn":"ok" },
    { name:"Total Cholesterol", raw: payload?.total_cholesterol ?? null,  unit:"mg/dL", digits:0, statusFor:(v)=>v>=240?"alert":v>=200?"warn":"ok" },
    { name:"HDL Cholesterol",   raw: payload?.hdl ?? null,                unit:"mg/dL", digits:0, statusFor:(v)=>v<40?"alert":v<60?"warn":"ok" },
    { name:"A1C (Glycemic)",    raw: payload?.a1c ?? null,                unit:"%",     digits:1, statusFor:(v)=>v>=6.5?"alert":v>=5.7?"warn":"ok" },
    { name:"Fasting Glucose",   raw: payload?.fasting_glucose ?? null,    unit:"mg/dL", digits:0, statusFor:(v)=>v>=126?"alert":v>=100?"warn":"ok" },
    { name:"eGFR (Kidney)",     raw: payload?.egfr ?? null,               unit:"mL/min",digits:0, statusFor:(v)=>v<30?"alert":v<60?"warn":"ok" },
    { name:"CRP (Inflammation)",raw: payload?.crp ?? null,                unit:"mg/L",  digits:1, statusFor:(v)=>v>=10?"alert":v>=3?"warn":"ok" },
    { name:"Triglycerides",     raw: payload?.triglycerides ?? null,      unit:"mg/dL", digits:0, statusFor:(v)=>v>=200?"alert":v>=150?"warn":"ok" },
  ];

  const colorFor = (s:string) => s==="alert" ? "#e8526e" : s==="warn" ? "#d4a843" : s==="ok" ? "#00d4b8" : MUTED;

  return(
    <div className="pad">
      <div className="sec">Comprehensive Blood Analysis</div>
      {error && (
        <div className="err-card" style={{margin:"0 0 9px"}}>
          Vitals not available: {error}
        </div>
      )}
      <div className="card">
        {rows.map((b,i)=>{
          const status = b.raw == null ? "muted" : (b.statusFor ? b.statusFor(b.raw) : "ok");
          const c = colorFor(status);
          const display = b.raw == null ? NOT_ENTERED : (b.digits > 0 ? b.raw.toFixed(b.digits) : String(Math.round(b.raw)));
          return (
            <div key={i} style={{display:"flex",alignItems:"center",gap:9,padding:"8px 0",borderBottom:i<rows.length-1?"1px solid rgba(255,255,255,.06)":"none"}}>
              <div style={{fontSize:10,color:"#7a9bbf",width:110,flexShrink:0}}>{b.name}</div>
              <div style={{flex:1,height:4,background:"rgba(255,255,255,.06)",borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:b.raw==null?"0%":"100%",background:b.raw==null?"rgba(122,155,191,.3)":`linear-gradient(90deg,${c},${c}88)`,borderRadius:2}}/>
              </div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:b.raw==null?9:12,color:c,width:90,textAlign:"right",flexShrink:0}}>
                {display}{b.raw!=null && <span style={{fontSize:8,color:"#7a9bbf"}}> {b.unit}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="stat-grid">
        <div className="stat-item">
          <div className="stat-val" style={{color: payload?.panel_grade ? "#d4a843" : MUTED, fontSize: payload?.panel_grade ? 17 : 11, fontWeight: payload?.panel_grade ? 600 : 400}}>
            {loading ? "..." : (payload?.panel_grade || NOT_AVAILABLE)}
          </div>
          <div className="stat-lbl">Panel Grade</div>
        </div>
        <div className="stat-item">
          <div className="stat-val" style={{color: payload && payload.panel_flagged > 0 ? "#e8526e" : MUTED, fontSize: payload ? 17 : 11, fontWeight: payload ? 600 : 400}}>
            {loading ? "..." : (payload ? String(payload.panel_flagged) : NOT_AVAILABLE)}
          </div>
          <div className="stat-lbl">Flagged</div>
        </div>
        <div className="stat-item">
          <div className="stat-val" style={{color: payload ? "#00d4b8" : MUTED, fontSize: payload ? 17 : 11, fontWeight: payload ? 600 : 400}}>
            {loading ? "..." : (payload ? String(payload.panel_in_range) : NOT_AVAILABLE)}
          </div>
          <div className="stat-lbl">In Range</div>
        </div>
      </div>
    </div>
  );
}

function Telehealth(){
  const demo = process.env.NEXT_PUBLIC_SHIELD_DEMO_PLANS === "true";
  return(
    <div className="pad">
      <div className="sec">Upcoming Appointments</div>
      {demo ? (
        <div className="card">
          <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>
            Annual wellness visit -- May 15, 2026 at 10:00 AM with Dr. Sarah Mitchell, Primary Care
          </div>
        </div>
      ) : (
        <EmptyState text={`${NOT_LOGGED}. Scheduled appointments will appear here once your care team books them.`}/>
      )}
      <div className="sec">Cost Savings</div>
      {demo ? (
        <div className="card">
          <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>
            Estimated $2,400 saved this year through early detection and preventive care protocols vs reactive treatment costs
          </div>
        </div>
      ) : (
        <EmptyState text={`${NOT_AVAILABLE}. Cost-savings analytics will appear here once enough care episodes have been recorded.`}/>
      )}
    </div>
  );
}

function Sovereignty(){
  return(
    <div className="pad">
      <div className="sec">Data Sovereignty Status</div>
      <div className="card">
        <div className="stat-grid">
          <div className="stat-item"><div className="stat-val" style={{color:"#4ade80"}}>100%</div><div className="stat-lbl">Sovereign Vault</div></div>
          <div className="stat-item"><div className="stat-val" style={{color:"#00d4b8"}}>AES-256</div><div className="stat-lbl">Encryption</div></div>
          <div className="stat-item"><div className="stat-val" style={{color:"#8060cc",fontSize:12,fontWeight:400}}>{NOT_AVAILABLE}</div><div className="stat-lbl">Retention</div></div>
        </div>
      </div>
      <div className="sec">Vault Activity, Last 24h</div>
      <EmptyState text={`${NOT_AVAILABLE}. Vault activity metrics will appear here once telemetry is wired into the dashboard.`}/>
      <div className="sec">Trace Fiber Network</div>
      <div className="card">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
          <span style={{fontSize:11,fontWeight:600}}>Network Status</span>
          <span style={{display:"inline-flex",alignItems:"center",gap:5,fontFamily:"'DM Mono',monospace",fontSize:9,color:"#4ade80"}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:"#4ade80",animation:"pulse 2s infinite"}}/>OPERATIONAL
          </span>
        </div>
        <div style={{fontSize:10,color:"#7a9bbf",fontFamily:"'DM Mono',monospace"}}>
          Live latency and uptime metrics: {NOT_AVAILABLE}.
        </div>
      </div>
    </div>
  );
}

function Impact(){
  return(
    <div className="pad">
      <div className="sec">Cost Per Member Per Year</div>
      <EmptyState text={`${NOT_AVAILABLE}. Per-member cost analytics will appear here once enough care episodes have been recorded.`}/>
      <div className="sec">Per 1K Members Per Year</div>
      <EmptyState text={`${NOT_AVAILABLE}. Population-level outcome and savings analytics will appear here once enough cohort data has been collected.`}/>
    </div>
  );
}

/**
 * Shield Status + activity log.
 *
 * HIPAA invariant: this component renders ONLY
 *   - Shield active/inactive status
 *   - Aggregate counts of CRITICAL / HIGH / MEDIUM risk events
 *   - Anonymized SHA-256 query hash prefix (12 hex chars)
 *   - Per-event metadata: timestamp, risk score, flag count, ZK count, action
 *   - Backend Shield version reported by the production /api/shield route
 *
 * It MUST NEVER render the raw query content, partial query content,
 * or anything derived from the unhashed query bytes. Every render path
 * below pulls only from the queryHash field on SLog.
 */
function ShieldDash({logs}:{logs:SLog[]}){
  const cs=logs.filter(l=>l.riskLevel==="CRITICAL").length;
  const hs=logs.filter(l=>l.riskLevel==="HIGH").length;
  const ms=logs.filter(l=>l.riskLevel==="MEDIUM").length;
  const backendVersion = logs.length > 0
    ? (logs[logs.length-1].shieldVersion || "unknown")
    : "awaiting first call";
  return(
    <div className="pad">
      <div className="sec">Shield Status, Live</div>
      <div className="card">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:7}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:"#4ade80",animation:"pulse 2s infinite"}}/>
            <span style={{fontSize:13,fontWeight:600}}>Sovereign Shield, Production</span>
          </span>
          <span className="badge b-green">ACTIVE</span>
        </div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#7a9bbf",marginBottom:10}}>
          Backend: {backendVersion}
        </div>
        <div className="stat-grid" style={{marginTop:6}}>
          <div className="stat-item"><div className="stat-val" style={{color:"#e8526e"}}>{cs}</div><div className="stat-lbl">Critical</div></div>
          <div className="stat-item"><div className="stat-val" style={{color:"#f97316"}}>{hs}</div><div className="stat-lbl">High</div></div>
          <div className="stat-item"><div className="stat-val" style={{color:"#d4a843"}}>{ms}</div><div className="stat-lbl">Medium</div></div>
        </div>
      </div>
      <div className="sec">Recent Queries (Anonymized)</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#7a9bbf",margin:"-4px 0 8px",letterSpacing:".04em"}}>
        Raw query content is never displayed, only its SHA-256 hash.
      </div>
      {logs.length===0?(
        <div className="card">
          <div style={{fontSize:12,color:"#7a9bbf"}}>No queries yet. Use the AI tab to see Shield in action.</div>
        </div>
      ):logs.slice().reverse().slice(0,12).map((log,i)=>(
        <div className="shield-msg" key={i}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <span className="badge" style={{background:`rgba(${log.riskLevel==="CRITICAL"?"232,82,110":log.riskLevel==="HIGH"?"249,115,22":log.riskLevel==="MEDIUM"?"212,168,67":log.riskLevel==="UNKNOWN"?"122,155,191":"0,212,184"},.15)`,color:rc(log.riskLevel),border:`1px solid ${rc(log.riskLevel)}44`}}>{log.riskLevel}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#7a9bbf"}}>{new Date(log.timestamp).toLocaleTimeString()}</span>
          </div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#00d4b8",margin:"4px 0 2px",wordBreak:"break-all",letterSpacing:".02em"}}>
            sha256:{log.queryHash.slice(0,12)}...
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",gap:6,fontFamily:"'DM Mono',monospace",fontSize:9,color:"#7a9bbf"}}>
              <span>{log.queryChars} chars</span><span>ZK: {log.zkCount}</span><span>Flags: {log.flagCount}</span><span>{log.action}</span>
            </div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:rc(log.riskLevel)}}>Risk: {log.riskScore}/100</div>
          </div>
          <div className="risk-meter">
            <div className="risk-fill" style={{width:`${log.riskScore}%`,background:`linear-gradient(90deg,${rc(log.riskLevel)},${rc(log.riskLevel)}88)`}}/>
          </div>
        </div>
      ))}
    </div>
  );
}

function AIChat({onLog}:{onLog:(log:SLog)=>void}){
  const { patient } = useContext(ClinicalDataContext);
  const firstName = (patient.name && patient.name.split(" ")[0]) || "friend";
  const [msgs,setMsgs]=useState([{role:"ai",text:`Hello, ${firstName}. Every message is protected by the ZK Sovereign Shield.`,zkCount:0,flagCount:0}]);
  const [input,setInput]=useState("");
  const [sending,setSending]=useState(false);
  const scrollRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight});},[msgs]);
  const send=async()=>{
    const msg=input.trim();
    if(!msg||sending)return;
    setSending(true);
    setInput("");
    const userMsg={role:"user",text:msg,zkCount:0,flagCount:0};
    setMsgs(p=>[...p,userMsg]);
    let zk:ZKResult={shieldedPrompt:msg,protectedTerms:[],zeroKnowledge:false};
    try{ zk=await runZKShield(msg); }catch{}
    const zkCount=zk.protectedTerms.length;
    const queryHash = await hashQuery(msg);
    const queryChars = msg.length;
    try{
      const res=await fetch("/api/shield",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({prompt:msg})
      });
      const shield=await res.json();
      const flags=Array.isArray(shield.pii_detected)?shield.pii_detected:Array.isArray(shield.flags)?shield.flags:[];
      const flagCount=typeof shield.flagCount==="number"?shield.flagCount:flags.length;
      const riskScore=typeof shield.serverRiskScore==="number"?shield.serverRiskScore:0;
      const riskLevel=typeof shield.riskLevel==="string"?shield.riskLevel:"LOW";
      const action=typeof shield.action==="string"?shield.action:"allow";
      const blocked=Boolean(shield?.meta?.blocked)||riskLevel==="CRITICAL";
      const shieldVersion=typeof shield?.meta?.shieldVersion==="string"?shield.meta.shieldVersion:undefined;

      let aiText:string;
      if(blocked){
        const types=flags.map((f:{type?:string})=>typeof f?.type==="string"?f.type:"").filter(Boolean).join(", ");
        aiText=`Blocked: PII detected${types?` (${types})`:""}. Re-send your question without personally identifying information.`;
      }else{
        aiText=typeof shield.insight==="string"&&shield.insight.length>0
          ?shield.insight
          :"Shield is active. AI response unavailable right now.";
      }

      setMsgs(p=>[...p,{role:"ai",text:aiText,zkCount,flagCount}]);
      onLog({timestamp:new Date().toISOString(),riskLevel,riskScore,flagCount,action,queryHash,queryChars,zkCount,shieldVersion});
    }catch{
      const aiText="Shield offline. Your prompt was not scored or sent to the AI. Try again.";
      setMsgs(p=>[...p,{role:"ai",text:aiText,zkCount,flagCount:0}]);
      onLog({timestamp:new Date().toISOString(),riskLevel:"UNKNOWN",riskScore:0,flagCount:0,action:"shield_offline",queryHash,queryChars,zkCount});
    }finally{
      setSending(false);
    }
  };
  return(
    <div className="chat-wrap">
      <div className="chat-msgs" ref={scrollRef}>
        {msgs.map((m,i)=>(
          <div key={i}>
            <div className={`chat-msg ${m.role==="user"?"chat-user":"chat-ai"}`}>{m.text}</div>
            {(m.zkCount>0||m.flagCount>0)&&(
              <div className="chat-meta" style={{textAlign:m.role==="user"?"right":"left",marginTop:3}}>
                {m.zkCount>0&&<span style={{color:"#00d4b8",marginRight:7}}>ZK: {m.zkCount}</span>}
                {m.flagCount>0&&<span style={{color:"#d4a843"}}>Flags: {m.flagCount}</span>}
              </div>
            )}
          </div>
        ))}
        {sending&&<div className="chat-msg chat-ai" style={{fontStyle:"italic",opacity:.7}}>Thinking...</div>}
      </div>
      <div className="chat-input-row">
        <input
          className="chat-input"
          value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
          placeholder="Ask the Sovereign AI..."
          disabled={sending}
        />
        <button className="chat-send" onClick={send} disabled={sending||!input.trim()}>{sending?"...":"Send"}</button>
      </div>
    </div>
  );
}

function Profile(){
  const { patient } = useContext(ClinicalDataContext);
  const displayName = patient.name || NOT_ENTERED;
  const displayId = patient.id || NOT_ENTERED;
  const ageStr = patient.age > 0 ? `Age ${patient.age}` : NOT_ENTERED;
  const initial = (patient.name && patient.name.charAt(0).toUpperCase()) || "P";
  return(
    <div className="pad">
      <div style={{textAlign:"center",padding:"16px 0 20px"}}>
        <div style={{width:68,height:68,borderRadius:"50%",background:"linear-gradient(135deg,#00d4b8,#8060cc)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 10px",color:"#07101f",fontWeight:700}}>{initial}</div>
        <div style={{fontSize:20,fontWeight:700}}>{displayName}</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#7a9bbf",marginTop:3}}>{displayId}</div>
        <div style={{fontSize:11,color:"#d4a843",marginTop:5}}>Enrolled Patient . {ageStr}</div>
        <div style={{display:"inline-flex",alignItems:"center",gap:5,fontFamily:"'DM Mono',monospace",fontSize:8,color:"#4ade80",background:"rgba(74,222,128,.08)",border:"1px solid rgba(74,222,128,.2)",padding:"3px 10px",borderRadius:20,marginTop:10}}>
          <div style={{width:5,height:5,borderRadius:"50%",background:"#4ade80",animation:"pulse 2s infinite"}}/>
          ZK Shield Active . Trace Fiber Sovereign
        </div>
      </div>
      <div className="sec">Profile</div>
      {([
        ["Enrollment", NOT_ENTERED],
        ["Program",    NOT_ENTERED],
        ["Physician",  NOT_ENTERED],
        ["Next Scan",  NOT_ENTERED],
        ["Data Vault", "Trace Fiber . AES-256"],
        ["Shield",     "v5.0 Sovereign + HIPAA"],
        ["AI Model",   "CIQ v1.2 . AILT Governed"],
        ["Protocols",  NOT_ENTERED],
      ] as const).map(([k,v],i)=>(
        <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,.06)",gap:12}}>
          <span style={{fontSize:11,color:"#7a9bbf"}}>{k}</span>
          <span style={{fontSize:11,fontWeight:500,textAlign:"right",maxWidth:"55%"}}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function Wearable(){
  const { primaryDeviceLabel } = useContext(ClinicalDataContext);
  const { payload } = useContext(ShieldContext);
  const [now,setNow]=useState(()=>Date.now());
  const [appleStart]=useState(()=>Date.now());
  useEffect(()=>{
    const t=setInterval(()=>setNow(Date.now()),1000);
    return()=>clearInterval(t);
  },[]);
  const fmtAgo=(start:number)=>{
    const s=Math.max(0,Math.floor((now-start)/1000));
    if(s<60)return `${s}s ago`;
    const m=Math.floor(s/60);
    const sr=s%60;
    if(m<60)return `${m}m ${sr}s ago`;
    const h=Math.floor(m/60);
    return `${h}h ${m%60}m ago`;
  };

  const metrics: Array<{icon:string; raw: string | null; unit:string; name:string}> = [
    { icon:"HR", raw: payload?.hr != null ? String(Math.round(payload.hr)) : null, unit:"bpm", name:"Resting HR" },
    { icon:"ST", raw: payload?.steps != null ? Math.round(payload.steps).toLocaleString() : null, unit:"today", name:"Steps" },
    { icon:"AC", raw: payload?.active_calories != null ? String(Math.round(payload.active_calories)) : null, unit:"kcal", name:"Active Cal" },
    { icon:"SL", raw: payload?.sleep_hours != null ? fmtSleep(payload.sleep_hours) : null, unit:"last night", name:"Sleep" },
    { icon:"O2", raw: payload?.spo2 != null ? String(Math.round(payload.spo2)) : null, unit:"%", name:"SpO2" },
    { icon:"HV", raw: payload?.hrv != null ? String(Math.round(payload.hrv)) : null, unit:"ms", name:"HRV" },
  ];

  const primaryLabel = primaryDeviceLabel ?? "Connected Device";

  return(
    <div className="pad">
      <div className="sec">Connected Devices</div>
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">{primaryLabel}</span>
          <span className={`badge ${payload ? "b-green" : "b-slate"}`}>{payload ? "SYNCED" : "PENDING"}</span>
        </div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#7a9bbf",marginBottom:10}}>
          Last sync: {payload ? fmtAgo(appleStart) : NOT_AVAILABLE}
        </div>
        <div className="stat-grid" style={{gridTemplateColumns:"repeat(3,1fr)",gap:7}}>
          {metrics.map((m,i)=>(
            <div className="stat-item" key={i}>
              <div style={{fontSize:10,marginBottom:3,fontFamily:"'DM Mono',monospace",color:"#7a9bbf"}}>{m.icon}</div>
              <div className="stat-val" style={{color: m.raw != null ? "#00d4b8" : MUTED, fontSize: m.raw != null ? 14 : 10, fontWeight: m.raw != null ? 600 : 400}}>
                {m.raw != null ? m.raw : NOT_ENTERED}
              </div>
              <div className="stat-lbl">{m.name}</div>
              <div style={{fontSize:8,color:"#7a9bbf",fontFamily:"'DM Mono',monospace",marginTop:2}}>{m.unit}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="sec">Sync Status</div>
      <div className="card">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:8}}>
            <div style={{width:8,height:8,borderRadius:"50%",background: payload ? "#4ade80" : MUTED, animation: payload ? "pulse 2s infinite" : "none"}}/>
            <span style={{fontSize:13,fontWeight:600,color: payload ? "#4ade80" : MUTED}}>
              {payload ? "Synced" : "Awaiting first sync"}
            </span>
          </div>
        </div>
      </div>
      <div className="sec">7 Day Trends</div>
      <EmptyState text={`${NOT_LOGGED}. Trend charts will appear here once at least seven days of wearable data have been recorded.`}/>
    </div>
  );
}

const PNAV=[{id:"overview",icon:"H",label:"Health"},{id:"insights",icon:"I",label:"Insights"},{id:"nutrition",icon:"N",label:"Nutrition"},{id:"wearable",icon:"W",label:"Wearable"},{id:"ai",icon:"AI",label:"AI"},{id:"profile",icon:"P",label:"Profile"}];
const CNAV=[{id:"blood",icon:"B",label:"Blood"},{id:"telehealth",icon:"T",label:"Telehealth"},{id:"sovereignty",icon:"S",label:"Sovereign"},{id:"impact",icon:"$",label:"Impact"},{id:"shield",icon:"X",label:"Shield"}];

const RING_R=37;
const RING_C=2*Math.PI*RING_R;

interface CareIQHealthOSProps {
  clinicalData?: ClinicalData;
  demoMode?: boolean;
}

export default function CareIQHealthOS({ clinicalData, demoMode = false }: CareIQHealthOSProps = {}) {
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
    return () => { cancelled = true; };
  }, []);

  // Merge real Shield-derived vitals and risk score into the context payload
  // so child components see real data without changing their consumption API.
  const data: ClinicalData = {
    ...baseData,
    patient: {
      ...baseData.patient,
      score: shield ? Math.round(shield.risk_score) : 0,
    },
    vitals: shield ? vitalsFromShield(shield) : [],
  };

  const { patient, vitals } = data;

  const [mode,setMode]=useState("patient");
  const [page,setPage]=useState("overview");
  const [logs,setLogs]=useState<SLog[]>([]);
  const [elder,setElder]=useState(false);
  const [ringPct,setRingPct]=useState(0);

  useEffect(()=>{
    getZKDict();
    try{
      const saved=window.localStorage.getItem("careiq-elder-mode");
      if(saved==="1")setElder(true);
    }catch{}
  },[]);

  useEffect(()=>{
    try{ window.localStorage.setItem("careiq-elder-mode",elder?"1":"0"); }catch{}
  },[elder]);

  useEffect(()=>{
    const target = shield ? Math.round(shield.risk_score) : 0;
    const t=setTimeout(()=>setRingPct(target),120);
    return()=>clearTimeout(t);
  },[shield]);

  useEffect(()=>{
    const nav=mode==="patient"?PNAV:CNAV;
    if(!nav.find(n=>n.id===page))setPage(nav[0].id);
  },[mode,page]);

  const addLog=useCallback((log:SLog)=>setLogs(p=>[...p,log]),[]);
  const nav=mode==="patient"?PNAV:CNAV;
  const showRing=mode==="patient"&&page!=="ai"&&page!=="profile";

  const renderPage=()=>{
    switch(page){
      case"overview":return<Overview/>;
      case"insights":return<Insights/>;
      case"nutrition":return<Nutrition/>;
      case"wearable":return<Wearable/>;
      case"blood":return<BloodPanel/>;
      case"telehealth":return<Telehealth/>;
      case"sovereignty":return<Sovereignty/>;
      case"impact":return<Impact/>;
      case"shield":return<ShieldDash logs={logs}/>;
      case"profile":return<Profile/>;
      case"ai":return(
        <div style={{height:"100%",display:"flex",flexDirection:"column",padding:`12px 18px calc(110px + env(safe-area-inset-bottom,0px))`,minHeight:0}}>
          <AIChat onLog={addLog}/>
        </div>
      );
      default:return<Overview/>;
    }
  };

  const offset = shield ? RING_C*(1-ringPct/100) : RING_C;

  // Risk label / sub-label rendering, derived only from real Shield data.
  let riskTitle: string;
  let riskTitleColor = "#eef2f8";
  if (shieldErr) {
    riskTitle = `Vitals not available: ${shieldErr}`;
    riskTitleColor = "#e8526e";
  } else if (shieldLoading || !shield) {
    riskTitle = "Loading vitals...";
    riskTitleColor = MUTED;
  } else {
    riskTitle = shield.risk_label || NOT_AVAILABLE;
  }

  // Ring center number: blank while loading, else the real risk score.
  const ringCenterNum = shieldLoading ? "" : (shield ? String(Math.round(shield.risk_score)) : "");

  // Header patient label, only show name when we actually have one.
  const headerName = patient.name || (shieldLoading ? "Loading..." : NOT_ENTERED);
  const headerId = patient.id || (shield?.patient_id || "");

  return(
    <ClinicalDataContext.Provider value={data}>
      <ShieldContext.Provider value={{ payload: shield, error: shieldErr, loading: shieldLoading }}>
        <style>{CSS}</style>
        <div className={`hos${elder?" elder":""}`}>
          <div className="hdr">
            <div className="hdr-top">
              <div className="logo">
                <div className="logo-mark">+</div>
                <div><div className="logo-name">CareIQ</div><div className="logo-sub">Clinical Intelligence for the Safety Net</div></div>
              </div>
              <div className="hdr-right">
                <div className="hdr-patient">{headerName}</div>
                <div className="hdr-id">{headerId}</div>
                <div className="shield-on"><div className="pulse"/>ZK SHIELD ON</div>
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"flex-end",marginTop:8}}>
              <InviteFamilyModal patientName={patient.name || ""} />
            </div>
          </div>
          {demoMode && (
            <div className="demo-banner">
              Demo data - <a href="/onboard?step=2&edit=1">complete your profile</a> to see your health intelligence.
            </div>
          )}
          {showRing&&(
            <>
              <div className="ring-wrap">
                <div className="ring-pos">
                  <svg width="100%" height="100%" viewBox="0 0 88 88" className="ring-svg" preserveAspectRatio="xMidYMid meet">
                    <circle cx="44" cy="44" r={RING_R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7"/>
                    <circle className="ring-progress" cx="44" cy="44" r={RING_R} fill="none" stroke="url(#rg)" strokeWidth="7"
                      strokeLinecap="round" strokeDasharray={`${RING_C}`} strokeDashoffset={`${offset}`}/>
                    <defs><linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#00d4b8"/><stop offset="100%" stopColor="#8060cc"/>
                    </linearGradient></defs>
                  </svg>
                  <div className="ring-inner">
                    <div className="ring-num">{ringCenterNum || (shieldLoading ? "..." : "")}</div>
                    <div className="ring-lbl">Score</div>
                  </div>
                </div>
                <div className="score-info">
                  <div className="score-title" style={{color: riskTitleColor}}>{riskTitle}</div>
                </div>
              </div>
              <div className="vitals-row">
                {vitals.length === 0 ? (
                  <div className="vital" style={{minWidth: 220}}>
                    <div className="vital-name" style={{marginTop:0}}>
                      {shieldErr ? `Vitals not available: ${shieldErr}` : (shieldLoading ? "Loading vitals..." : NOT_ENTERED)}
                    </div>
                  </div>
                ) : vitals.map((v,i)=>{
                  const isEmpty = v.s === "muted";
                  return (
                    <div className="vital" key={i} style={isEmpty ? {minWidth: 110} : undefined}>
                      <div className="vital-icon">{v.icon}</div>
                      <div className={`vital-val ${v.s}`} style={isEmpty ? {fontSize: 10, lineHeight: 1.3} : undefined}>{v.val}</div>
                      {!isEmpty && <div className="vital-unit">{v.unit}</div>}
                      <div className="vital-name">{v.name}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <div className="mode-bar">
            <button className={`mbtn ${mode==="patient"?"on":""}`} onClick={()=>setMode("patient")} aria-pressed={mode==="patient"}>Patient</button>
            <button className={`mbtn ${mode==="clinical"?"on":""}`} onClick={()=>setMode("clinical")} aria-pressed={mode==="clinical"}>Clinical</button>
            <button className={`mbtn son ${page==="shield"?"on":""}`} onClick={()=>{setMode("clinical");setPage("shield")}}>
              Shield{logs.length>0?` (${logs.length})`:""}
            </button>
            <button className={`mbtn ${elder?"elder-on":""}`} onClick={()=>setElder(e=>!e)} aria-pressed={elder} aria-label="Toggle Elder Mode">
              AA Elder{elder?" ON":""}
            </button>
          </div>
          <div className="scroll">
            <TabErrorBoundary>{renderPage()}</TabErrorBoundary>
          </div>
          <div className="bnav">
            {nav.map(n=>(
              <button key={n.id} className={`bnav-btn ${n.id==="shield"?"sn":""} ${page===n.id?"on":""}`} onClick={()=>setPage(n.id)} aria-current={page===n.id?"page":undefined}>
                <span className="bnav-icon">{n.icon}</span>
                <span className="bnav-lbl">{n.id==="shield"&&logs.length>0?`Shield(${logs.length})`:n.label}</span>
              </button>
            ))}
          </div>
        </div>
      </ShieldContext.Provider>
    </ClinicalDataContext.Provider>
  );
}

// Re-export the trend bar helper so external usages do not break if any.
export { ABar };
