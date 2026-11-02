"use client";
import { useState, useEffect, useRef, useCallback, useContext, createContext, Component, ReactNode } from "react";

const ZK_SALT = "CARE-IQ-ZK-SHIELD-2026";
const ZK_TERMS = ["fqhc","careiq","communityhealth","safetynet","medicaid","sliding-scale","communityclinic","federallyqualified","ryanwhite","title-x","section-330","hrsa","communitycare"];

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
      const token = `[ZK_${h.substring(0,6)}]`;
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
.ok{color:#00d4b8}.warn{color:#d4a843}.alert{color:#e8526e}
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
.chat-ai{align-self:flex-start;background:rgba(255,255,255,.06);color:#eef2f8}
.chat-meta{font-family:'DM Mono',monospace;font-size:8px;color:#7a9bbf;margin-top:3px}
.chat-input-row{display:flex;gap:7px;padding:9px 11px;border-top:1px solid rgba(0,212,184,.1)}
.chat-input{flex:1;padding:9px 11px;background:rgba(255,255,255,.06);border:1px solid rgba(0,212,184,.15);border-radius:9px;color:#eef2f8;font-size:13px;font-family:'Outfit',sans-serif;outline:none;min-height:40px}
.chat-input:focus{border-color:#00d4b8}
.chat-send{padding:9px 14px;background:linear-gradient(135deg,#00d4b8,#00b89e);color:#07101f;border:none;border-radius:9px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif;font-size:12px;flex-shrink:0;min-height:40px}
.chat-send:disabled{opacity:.5;cursor:not-allowed}
.err-card{padding:14px;background:rgba(232,82,110,.06);border:1px solid rgba(232,82,110,.25);border-radius:11px;margin:18px;color:#e8526e;font-size:11px;line-height:1.5}
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

/* ----- Demo data (Matthew Culwell), used as fallback when no real patient
        data is available, exposed via ClinicalDataContext below. -------- */

const DEMO_PATIENT = { name:"Matthew Culwell", id:"CIQ-2026-MATT", age:43, score:74 };
const DEMO_VITALS = [
  {icon:"BP",val:"118/76",unit:"mmHg",name:"Blood Pressure",s:"ok"},
  {icon:"A1C",val:"6.4",unit:"A1C %",name:"Glycemic",s:"warn"},
  {icon:"LDL",val:"212",unit:"mg/dL",name:"LDL Chol.",s:"alert"},
  {icon:"HR",val:"68",unit:"bpm",name:"Heart Rate",s:"ok"},
  {icon:"O2",val:"96",unit:"SpO2 %",name:"Oxygen Sat",s:"ok"},
  {icon:"WT",val:"174",unit:"lbs",name:"Body Weight",s:"warn"},
];
const DEMO_DOMAINS = [
  {name:"Metabolic",score:58},{name:"Cardiovascular",score:62},
  {name:"Cognitive",score:81},{name:"Oncology",score:88},
  {name:"Renal",score:79},{name:"Mental Health",score:72},
];
const DEMO_INSIGHTS = [
  {type:"crit",icon:"!",title:"Sample LDL note",body:"Sample chart only. The 212 mg/dL figure is not a measured result and not this patient's lab.",cta:"",conf:""},
  {type:"watch",icon:"^",title:"Prediabetes Progression Risk",body:"Sample chart only. A1C at 6.4% is in the prediabetes range on this example. It is not a measured CareIQ outcome.",cta:"Example",conf:""},
  {type:"pos",icon:"+",title:"Sample note",body:"Sample chart only. CareIQ does not score cerebrovascular flow.",cta:"",conf:""},
];
const DEMO_TIMELINE = [
  {dot:"#00d4b8",date:"Apr 10, 2026",title:"Sample event",text:"Example timeline entry. CareIQ does not perform imaging or liquid biopsy."},
  {dot:"#d4a843",date:"Mar 3, 2026",title:"Sample lab note",text:"Example numbers only. Not this patient's labs."},
  {dot:"#8060cc",date:"Jan 28, 2026",title:"Sample assessment",text:"Example note. Not a scored cognitive test from this app."},
  {dot:"#00d4b8",date:"Dec 15, 2025",title:"Sample enrollment",text:"Example enrollment event for the demo chart."},
];
const DEMO_MEALS = [
  {time:"Breakfast 7:00 AM",name:"Steel-Cut Oats with Berries",desc:"Steel-cut oatmeal topped with fresh blueberries, walnuts, and a drizzle of olive oil.",tags:["Heart-Healthy","High Fiber","Low Sodium"]},
  {time:"Lunch 12:00 PM",name:"Lentil and Vegetable Bowl",desc:"Stewed lentils with brown rice, leafy greens, tomatoes, and lemon. Lean plant protein with complete fiber.",tags:["Plant Protein","Low GI","Affordable"]},
  {time:"Dinner 6:30 PM",name:"Baked Salmon with Sweet Potato",desc:"Baked salmon, roasted sweet potato, and steamed collards. Omega-3s, potassium, and folate in one plate.",tags:["Cardioprotective","Low Sodium","High Potassium"]},
];
const DEMO_WEAR_HR_7DAY=[67,70,68,72,69,71,68];
const DEMO_WEAR_STEPS_7DAY=[6800,7200,8100,5400,7842,8500,6900];
const DEMO_WEAR_DAYS=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

/* ----- ClinicalData shape exposed via context. Server populates this from
        decrypted Supabase rows; falls back to demo when no data exists. -- */

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
  wearableSource: "demo" | "upload" | "none";
  primaryDeviceLabel?: string;
}

const DEMO_DATA: ClinicalData = {
  patient: DEMO_PATIENT,
  vitals: DEMO_VITALS,
  domains: DEMO_DOMAINS,
  insights: DEMO_INSIGHTS,
  timeline: DEMO_TIMELINE,
  meals: DEMO_MEALS,
  wearHr7Day: DEMO_WEAR_HR_7DAY,
  wearSteps7Day: DEMO_WEAR_STEPS_7DAY,
  wearDays: DEMO_WEAR_DAYS,
  wearableSource: "demo",
};

const ClinicalDataContext = createContext<ClinicalData>(DEMO_DATA);

interface ShieldGenState { loading: boolean; text: string; error: string; blocked: boolean; }

function inferConditions(domains: ClinicalDomain[], vitals: ClinicalVital[]): string[] {
  const out: string[] = [];
  const cardio = domains.find((d) => /cardio/i.test(d.name));
  if (cardio && cardio.score <= 65) out.push("hypertension");
  const metab = domains.find((d) => /metabolic/i.test(d.name));
  if (metab && metab.score <= 65) out.push("prediabetes");
  const ldl = vitals.find((v) => /LDL/i.test(v.name));
  if (ldl && ldl.s === "alert") out.push("dyslipidemia");
  return out;
}

function useShieldGenerate(mode: "workout" | "meal_plan" | "narrative"): ShieldGenState & { regen: () => void } {
  const { patient, vitals, domains } = useContext(ClinicalDataContext);
  const [state, setState] = useState<ShieldGenState>({ loading: true, text: "", error: "", blocked: false });
  const [tick, setTick] = useState(0);
  const conditions = inferConditions(domains, vitals);
  const key = `${mode}:${patient.id}:${new Date().toISOString().slice(0, 10)}:${tick}`;
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, text: "", error: "", blocked: false });
    (async () => {
      try {
        const res = await fetch("/api/shield", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            context: {
              patientAge: patient.age,
              communityAffiliation: "COMMUNITY_LOCATION",
              vitals: vitals.map((v) => ({ name: v.name, val: v.val, unit: v.unit, status: v.s })),
              domains: domains.map((d) => ({ name: d.name, score: d.score })),
              conditions,
            },
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        const blocked = Boolean(body?.meta?.blocked) || body?.riskLevel === "CRITICAL";
        if (blocked) {
          setState({ loading: false, text: "", error: "", blocked: true });
        } else if (typeof body?.insight === "string" && body.insight.length > 0) {
          setState({ loading: false, text: body.insight, error: "", blocked: false });
        } else {
          setState({ loading: false, text: "", error: "Prompt Shield returned no content.", blocked: false });
        }
      } catch {
        if (!cancelled) setState({ loading: false, text: "", error: "Shield offline. Try again.", blocked: false });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { ...state, regen: () => setTick((t) => t + 1) };
}

function GeneratedCard({
  title, badge, mode,
}: { title: string; badge: string; mode: "workout" | "meal_plan" | "narrative" }) {
  const { loading, text, error, blocked, regen } = useShieldGenerate(mode);
  return (
    <div className="card">
      <div className="card-hdr">
        <span className="card-title">{title}</span>
        <span className="badge b-violet">{badge}</span>
      </div>
      {loading ? (
        <div style={{ fontSize: 11, color: "#7a9bbf", fontStyle: "italic" }}>
          CareIQ AI is generating, this takes a few seconds...
        </div>
      ) : blocked ? (
        <div style={{ fontSize: 11, color: "#e8526e", lineHeight: 1.5 }}>
          Blocked: identifying information detected. The block is written to the audit log.
        </div>
      ) : error ? (
        <div style={{ fontSize: 11, color: "#e8526e", lineHeight: 1.5 }}>{error}</div>
      ) : (
        <div style={{ fontSize: 12, color: "#a3b5cc", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{text}</div>
      )}
      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, color: "#7a9bbf", letterSpacing: ".12em" }}>
          via Prompt Shield, identifiers reduced
        </span>
        <button
          type="button"
          className="insight-cta"
          onClick={regen}
          disabled={loading}
          style={{ opacity: loading ? 0.5 : 1 }}
        >
          {loading ? "..." : "Regenerate"}
        </button>
      </div>
    </div>
  );
}

function HealthNarrative() { return <GeneratedCard title="Today's Health Narrative" badge="AI" mode="narrative" />; }
function WorkoutPlan()    { return <GeneratedCard title="Today's Workout Plan"     badge="AI" mode="workout" />; }
function MealPlan()       { return <GeneratedCard title="Today's Meal Plan"        badge="AI" mode="meal_plan" />; }


function dc(s:number){return s>=80?"#00d4b8":s>=60?"#d4a843":"#e8526e"}
function rc(level:string){return level==="CRITICAL"?"#e8526e":level==="HIGH"?"#f97316":level==="MEDIUM"?"#d4a843":level==="UNKNOWN"?"#7a9bbf":"#00d4b8"}

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
          This tab could not load. Other tabs and the Prompt Shield are unaffected. Try switching tabs and returning.
        </div>
      );
    }
    return this.props.children;
  }
}

function Overview(){
  const { domains } = useContext(ClinicalDataContext);
  return(
    <div className="pad">
      <div className="sec">Today, In Plain Language</div>
      <HealthNarrative/>
      <div className="sec">Risk Domains</div>
      <div className="dom-grid">
        {domains.map((d,i)=>(
          <div className="dom-item" key={i}>
            <div className="dom-name">{d.name}</div>
            <div className="dom-bg"><div className="dom-fill" style={{width:`${d.score}%`,background:`linear-gradient(90deg,${dc(d.score)},${dc(d.score)}77)`}}/></div>
            <div className="dom-score" style={{color:dc(d.score)}}>{d.score}<span style={{fontSize:10,color:"#7a9bbf"}}>/100</span></div>
          </div>
        ))}
      </div>
      <div className="sec">What this screen is</div>
      <div className="card">
        <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>
          This view summarizes data on file for one patient. CareIQ does not compute population outcomes, UDS or CMS measures, RPM time, or a multi-patient panel.
        </div>
      </div>
      <div className="sec">Protocols</div>
      <div className="card">
        <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>
          CareIQ does not enroll care protocols or track protocol progress.
        </div>
      </div>
    </div>
  );
}

function Insights(){
  const { insights, timeline } = useContext(ClinicalDataContext);
  return(
    <div className="pad">
      <div className="sec">Today's Workout</div>
      <WorkoutPlan/>
      <div className="sec">AI Clinical Insights</div>
      {insights.map((ins,i)=>(
        <div key={i} className={`insight ${ins.type}`}>
          <div className="insight-hdr"><span style={{fontSize:14}}>{ins.icon}</span><span className="insight-title">{ins.title}</span></div>
          <div className="insight-body">{ins.body}</div>
        </div>
      ))}
      <div className="sec">Health Timeline</div>
      {timeline.map((t,i)=>(
        <div className="tl-item" key={i}>
          <div className="tl-col">
            <div className="tl-dot" style={{background:t.dot}}/>
            {i<timeline.length-1&&<div className="tl-line"/>}
          </div>
          <div className="tl-body">
            <div className="tl-date">{t.date}</div>
            <div className="tl-title">{t.title}</div>
            <div className="tl-text">{t.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Nutrition(){
  const { meals } = useContext(ClinicalDataContext);
  return(
    <div className="pad">
      <div className="sec">Today's Meal Plan, AI Generated</div>
      <MealPlan/>
      <div className="sec">Example meals, not your log</div>
      <div style={{fontSize:11,color:"#d4a843",lineHeight:1.5,margin:"-4px 0 8px"}}>
        Sample dishes only. CareIQ does not calculate calories or record what you ate.
      </div>
      {meals.map((m,i)=>(
        <div className="meal-card" key={i}>
          <div className="meal-time">{m.time}</div>
          <div className="meal-name">{m.name}</div>
          <div className="meal-desc">{m.desc}</div>
          <div className="meal-tags">{m.tags.map((t,j)=><span key={j} className="meal-tag">{t}</span>)}</div>
        </div>
      ))}
    </div>
  );
}

function BloodPanel(){
  return(
    <div className="pad">
      <div className="sec">Biomarker panel</div>
      <div className="card">
        <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>
          This tab does not read an EHR and it does not invent a panel grade. Lab values you type in appear on the health view. There is no UDS or CMS measure score here.
        </div>
      </div>
    </div>
  );
}

function Telehealth(){
  return(
    <div className="pad">
      <div className="sec">Appointments</div>
      <div className="card">
        <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>
          CareIQ does not book visits and does not connect to an EHR. There is no appointment list in this app.
        </div>
      </div>
      <div className="sec">Cost figures</div>
      <div className="card">
        <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>
          CareIQ does not calculate savings, ER diversion, or a per-member cost. No dollar figure on this screen is a measured result.
        </div>
      </div>
    </div>
  );
}

function Sovereignty(){
  return(
    <div className="pad">
      <div className="sec">How records are protected</div>
      <div className="card">
        <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>
          PHI fields and uploaded files are encrypted at rest with AES-256-GCM. The key lives in the application server environment. Encryption is not on the device, and the key is not held by the community. The operator of the server can decrypt.
        </div>
      </div>
      <div className="card">
        <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>
          AI insights are an Anthropic inference call. The app does not train a model on patient data. The typed question is not sent. Detected identifiers are replaced in the reduced summary. That is not a promise that every possible identifier is removed.
        </div>
      </div>
      <div className="card">
        <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>
          There is an audit log of shield events. This screen does not show live network uptime, latency, or a private network.
        </div>
      </div>
    </div>
  );
}

function Impact(){
  return(
    <div className="pad">
      <div className="sec">Impact figures</div>
      <div className="card">
        <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>
          CareIQ does not calculate cost per member, ER diversion, hospitalizations prevented, or annual savings. This tab does not show measured results.
        </div>
      </div>
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
            <span style={{fontSize:13,fontWeight:600}}>Prompt Shield</span>
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
      <div className="sec">Recent queries (hash only)</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#7a9bbf",margin:"-4px 0 8px",letterSpacing:".04em"}}>
        The typed question is not shown here, only a SHA-256 hash.
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
              <span>{log.queryChars} chars</span><span>Terms: {log.zkCount}</span><span>Flags: {log.flagCount}</span><span>{log.action}</span>
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
  const firstName = patient.name.split(" ")[0] || "friend";
  const [msgs,setMsgs]=useState([{role:"ai",text:`Hello, ${firstName}. Critical identifier queries are blocked. The typed question is not sent to the model.`,zkCount:0,flagCount:0}]);
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
                {m.zkCount>0&&<span style={{color:"#00d4b8",marginRight:7}}>Terms: {m.zkCount}</span>}
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
          placeholder="Ask CareIQ AI..."
          disabled={sending}
        />
        <button className="chat-send" onClick={send} disabled={sending||!input.trim()}>{sending?"...":"Send"}</button>
      </div>
    </div>
  );
}

function Profile(){
  const { patient } = useContext(ClinicalDataContext);
  return(
    <div className="pad">
      <div style={{textAlign:"center",padding:"16px 0 20px"}}>
        <div style={{width:68,height:68,borderRadius:"50%",background:"linear-gradient(135deg,#00d4b8,#8060cc)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 10px",color:"#07101f",fontWeight:700}}>P</div>
        <div style={{fontSize:20,fontWeight:700}}>{patient.name}</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#7a9bbf",marginTop:3}}>{patient.id}</div>
        <div style={{fontSize:11,color:"#d4a843",marginTop:5}}>Enrolled Patient . Age {patient.age}</div>
        <div style={{display:"inline-flex",alignItems:"center",gap:5,fontFamily:"'DM Mono',monospace",fontSize:8,color:"#4ade80",background:"rgba(74,222,128,.08)",border:"1px solid rgba(74,222,128,.2)",padding:"3px 10px",borderRadius:20,marginTop:10}}>
          <div style={{width:5,height:5,borderRadius:"50%",background:"#4ade80",animation:"pulse 2s infinite"}}/>
          Prompt Shield on
        </div>
      </div>
      <div className="sec">Profile</div>
      {([
        ["Storage","AES-256-GCM at rest on the server"],
        ["Key","Application server environment"],
        ["Shield","Prompt Shield blocks critical identifier queries"],
        ["AI","Anthropic inference. No training on patient data"],
        ["Wearables","Uploaded files. No live device or RPM time tracking"],
        ["Records","No FHIR or EHR connection"],
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
  const { wearHr7Day, wearSteps7Day, wearDays, wearableSource, primaryDeviceLabel } = useContext(ClinicalDataContext);
  const hasSeries = wearHr7Day.length > 0 || wearSteps7Day.length > 0;
  const hrMax = wearHr7Day.length ? Math.max(...wearHr7Day) : 0;
  const hrMin = wearHr7Day.length ? Math.min(...wearHr7Day) : 0;
  const stepsMax = wearSteps7Day.length ? Math.max(...wearSteps7Day) : 0;
  const note = wearableSource === "demo"
    ? "Sample chart only. CareIQ does not connect to Apple Watch, Fitbit, or Withings, and it does not track RPM time."
    : wearableSource === "upload"
      ? `From the last uploaded file${primaryDeviceLabel ? ` (${primaryDeviceLabel})` : ""}. This is not a live device connection.`
      : "No wearable file uploaded. CareIQ does not connect to a device account and does not track RPM time.";
  return(
    <div className="pad">
      <div className="sec">Wearable file</div>
      <div className="card">
        <div style={{fontSize:12,color:"#a3b5cc",lineHeight:1.6}}>{note}</div>
      </div>
      {hasSeries && (
        <>
          <div className="sec">Heart rate and steps on file</div>
          {wearHr7Day.length > 0 && (
            <div className="card">
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <span style={{fontSize:11,fontWeight:600}}>Heart rate (bpm)</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#7a9bbf"}}>{hrMin} to {hrMax}</span>
              </div>
              <div style={{display:"flex",alignItems:"flex-end",gap:6,height:74,marginBottom:6}}>
                {wearHr7Day.map((v,i)=>{
                  const range=Math.max(1,hrMax-hrMin+4);
                  const pct=Math.max(22,((v-hrMin+2)/range)*100);
                  return(
                    <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4,height:"100%",justifyContent:"flex-end"}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#00d4b8"}}>{v}</div>
                      <div style={{width:"100%",height:`${pct}%`,background:"linear-gradient(180deg,#00d4b8,#00b89e)",borderRadius:4,minHeight:8}}/>
                    </div>
                  );
                })}
              </div>
              <div style={{display:"flex",gap:6}}>
                {wearDays.map((d,i)=>(<div key={i} style={{flex:1,textAlign:"center",fontSize:9,color:"#7a9bbf",fontFamily:"'DM Mono',monospace"}}>{d}</div>))}
              </div>
            </div>
          )}
          {wearSteps7Day.length > 0 && stepsMax > 0 && (
            <div className="card">
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <span style={{fontSize:11,fontWeight:600}}>Steps</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#7a9bbf"}}>peak {stepsMax.toLocaleString()}</span>
              </div>
              <div style={{display:"flex",alignItems:"flex-end",gap:6,height:74,marginBottom:6}}>
                {wearSteps7Day.map((v,i)=>{
                  const pct=Math.max(8,(v/stepsMax)*100);
                  return(
                    <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4,height:"100%",justifyContent:"flex-end"}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#d4a843"}}>{(v/1000).toFixed(1)}k</div>
                      <div style={{width:"100%",height:`${pct}%`,background:"linear-gradient(180deg,#d4a843,#b8902f)",borderRadius:4,minHeight:8}}/>
                    </div>
                  );
                })}
              </div>
              <div style={{display:"flex",gap:6}}>
                {wearDays.map((d,i)=>(<div key={i} style={{flex:1,textAlign:"center",fontSize:9,color:"#7a9bbf",fontFamily:"'DM Mono',monospace"}}>{d}</div>))}
              </div>
            </div>
          )}
        </>
      )}
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
  const data = clinicalData ?? DEMO_DATA;
  // Banner shows whenever no real clinical data was passed, or whenever the
  // caller explicitly asks for demo mode.
  const showDemoBanner = !clinicalData || demoMode;
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
    const t=setTimeout(()=>setRingPct(patient.score),120);
    return()=>clearTimeout(t);
  },[patient.score]);

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

  const offset=RING_C*(1-ringPct/100);

  return(
    <ClinicalDataContext.Provider value={data}>
      <style>{CSS}</style>
      <div className={`hos${elder?" elder":""}`}>
        <div className="hdr">
          <div className="hdr-top">
            <div className="logo">
              <div className="logo-mark">+</div>
              <div><div className="logo-name">CareIQ</div><div className="logo-sub">Clinical Intelligence for the Safety Net</div></div>
            </div>
            <div className="hdr-right">
              <div className="hdr-patient">{patient.name}</div>
              <div className="hdr-id">{patient.id}</div>
              <div className="shield-on"><div className="pulse"/>SHIELD ON</div>
            </div>
          </div>
        </div>
        {showDemoBanner && (
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
                  <div className="ring-num">{patient.score}</div>
                  <div className="ring-lbl">Score</div>
                </div>
              </div>
              <div className="score-info">
                <div className="score-title">Health score</div>
                <div className="score-sub">A local summary of data on file. Not a diagnosis, and not a UDS or CMS measure.</div>
              </div>
            </div>
            <div className="vitals-row">
              {vitals.map((v,i)=>(
                <div className="vital" key={i}>
                  <div className="vital-icon">{v.icon}</div>
                  <div className={`vital-val ${v.s}`}>{v.val}</div>
                  <div className="vital-unit">{v.unit}</div>
                  <div className="vital-name">{v.name}</div>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="mode-bar">
          <button className={`mbtn ${mode==="patient"?"on":""}`} onClick={()=>setMode("patient")} aria-pressed={mode==="patient"}>Patient</button>
          <button className={`mbtn ${mode==="clinical"?"on":""}`} onClick={()=>setMode("clinical")} aria-pressed={mode==="clinical"}>Clinical</button>
          <button className={`mbtn son ${page==="shield"?"on":""}`} onClick={()=>{setMode("clinical");setPage("shield")}}>
            Shield{logs.length>0?` (${logs.length})`:""}
          </button>
          <button className={`mbtn ${elder?"elder-on":""}`} onClick={()=>setElder(e=>!e)} aria-pressed={elder} aria-label="Toggle Large Text mode">
            Large Text{elder?" ON":""}
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
    </ClinicalDataContext.Provider>
  );
}
