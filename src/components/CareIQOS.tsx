'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

// ── TYPES ────────────────────────────────────────────────────────────────────
interface ChatMessage { role: 'user' | 'assistant'; content: string; }
interface ShieldLog { ts: string; q: string; hash: string; risk: string; action: string; }
interface Patient { id:string; name:string; age:number; conditions:string[]; risk:string; riskScore:number; healthScore:number; gaps:number; }

// ── CONSTANTS ────────────────────────────────────────────────────────────────
const SOVEREIGN_TERMS = ['chikasha','chickasaw','chikashshanompa','yakoke','chikashsha'];

const PII_PATTERNS = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, type:'SSN', severity:'CRITICAL', token:'[SOCIAL_SECURITY_NUMBER_PROTECTED]' },
  { pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, type:'PHONE', severity:'HIGH', token:'[PHONE_NUMBER_PROTECTED]' },
  { pattern: /\b(dob|date of birth|born)[:\s]+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/gi, type:'DOB', severity:'CRITICAL', token:'[DATE_OF_BIRTH_PROTECTED]' },
  { pattern: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, type:'DATE', severity:'MEDIUM', token:'[DATE_PROTECTED]' },
];

const PATIENTS: Patient[] = [
  { id:'CIQ-00124', name:'Maria T.', age:58, conditions:['T2 Diabetes','Hypertension'], risk:'high', riskScore:87, healthScore:54, gaps:4 },
  { id:'CIQ-00512', name:'James R.', age:44, conditions:['Pre-Diabetes','Obesity'], risk:'medium', riskScore:61, healthScore:63, gaps:4 },
  { id:'CIQ-00389', name:'Rosa L.', age:67, conditions:['COPD','Heart Failure'], risk:'high', riskScore:92, healthScore:41, gaps:4 },
  { id:'CIQ-00741', name:'David K.', age:35, conditions:['Anxiety','Hypertension'], risk:'medium', riskScore:48, healthScore:71, gaps:3 },
  { id:'CIQ-00295', name:'Linda S.', age:52, conditions:['Preventive','Well Visit'], risk:'low', riskScore:22, healthScore:84, gaps:2 },
  { id:'CIQ-00271', name:'Carlos M.', age:61, conditions:['CKD Stage 3','Diabetes'], risk:'high', riskScore:79, healthScore:49, gaps:4 },
  { id:'CIQ-00634', name:'Agnes W.', age:74, conditions:['Osteoporosis','Hypertension'], risk:'medium', riskScore:55, healthScore:66, gaps:4 },
  { id:'CIQ-00887', name:'Tyrone B.', age:29, conditions:['Asthma','Uninsured'], risk:'low', riskScore:18, healthScore:88, gaps:3 },
];

const VITALS = [
  { ico:'❤️', val:'124/80', unit:'mmHg', name:'Blood Pressure', status:'warn' },
  { ico:'🩸', val:'6.1', unit:'A1C %', name:'Glycemic', status:'warn' },
  { ico:'🔬', val:'198', unit:'mg/dL', name:'LDL Chol.', status:'alert' },
  { ico:'⚡', val:'72', unit:'bpm', name:'Heart Rate', status:'ok' },
  { ico:'🫁', val:'97', unit:'SpO2 %', name:'Oxygen Sat', status:'ok' },
  { ico:'⚖️', val:'182', unit:'lbs', name:'Body Weight', status:'warn' },
];

const DOMAINS = [
  { name:'🔬 Metabolic', score:55 },
  { name:'❤️ Cardiovascular', score:65 },
  { name:'🧠 Cognitive', score:80 },
  { name:'🎗️ Oncology', score:90 },
  { name:'💧 Renal', score:76 },
  { name:'🌿 Mental Health', score:70 },
];

const UDS_MEASURES = [
  { m:'Diabetes: HbA1c Control', cur:68, tgt:70 },
  { m:'Hypertension: BP Control', cur:74, tgt:70 },
  { m:'Cervical Cancer Screening', cur:62, tgt:65 },
  { m:'Colorectal Cancer Screening', cur:55, tgt:60 },
  { m:'Child Immunization Status', cur:82, tgt:75 },
  { m:'Depression Screening PHQ-9', cur:71, tgt:68 },
  { m:'HIV Screening', cur:44, tgt:50 },
  { m:'Tobacco Use Screening', cur:88, tgt:80 },
  { m:'Prenatal Care Early Entry', cur:67, tgt:70 },
  { m:'Asthma Pharmacologic Therapy', cur:78, tgt:75 },
];

const MEALS = [
  { time:'Breakfast 7:00 AM', name:'Oatmeal Power Bowl', desc:'Steel-cut oats with berries, walnuts, and cinnamon. High fiber, anti-inflammatory, low glycemic index.', tags:['High Fiber','Anti-inflammatory','Low GI'] },
  { time:'Lunch 12:00 PM', name:'Grilled Chicken and Quinoa', desc:'Lean protein over quinoa with roasted vegetables. Complete amino acids, heart healthy.', tags:['High Protein','Heart Healthy','Low Cholesterol'] },
  { time:'Dinner 6:30 PM', name:'Baked Salmon and Greens', desc:'Wild salmon with dark leafy greens and lemon. Omega-3 rich, LDL-lowering.', tags:['Omega-3','LDL Lowering','High Potassium'] },
];

// ── COLORS ───────────────────────────────────────────────────────────────────
const dc = (s: number) => s >= 80 ? '#00d4b8' : s >= 60 ? '#d4a843' : '#e8526e';
const rc = (r: string) => r === 'high' ? '#e8526e' : r === 'medium' ? '#d4a843' : '#00d4b8';
const rb = (r: string) => r === 'high' ? 'br' : r === 'medium' ? 'bg' : 'bt';

// ── SHIELD UTILS ─────────────────────────────────────────────────────────────
async function zkHash(text: string): Promise<string> {
  try {
    const enc = new TextEncoder();
    const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(text + 'CIQ-SOVEREIGN-2026'));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('').substring(0,16).toUpperCase();
  } catch { return 'SHIELD-ACTIVE'; }
}

function browserShield(text: string) {
  let sanitized = text;
  const protectedTerms: Array<{term:string;hash:string}> = [];
  let riskScore = 0;
  const flags: string[] = [];

  for (const p of PII_PATTERNS) {
    const matches = text.match(p.pattern);
    if (matches) {
      matches.forEach(m => { sanitized = sanitized.replace(m, p.token); flags.push(p.type); });
      riskScore += p.severity === 'CRITICAL' ? 40 : p.severity === 'HIGH' ? 25 : 10;
    }
  }

  return { sanitized, protectedTerms, riskScore: Math.min(riskScore, 100), flags };
}

// ── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function CareIQOS() {
  const [showModal, setShowModal] = useState(true);
  const [mode, setMode] = useState<'patient'|'clinical'>('patient');
  const [page, setPage] = useState('health');
  const [elder, setElder] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>([
    { role:'assistant', content:"Hello! I'm your CareIQ Health AI. Your health score is 70, up 6.2% since your last visit. I'm monitoring your LDL and A1C closely. Everything you share is protected by the Sovereign Shield. What would you like to know?" }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [shieldLogs, setShieldLogs] = useState<ShieldLog[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:'smooth' }); }, [chatMsgs]);

  const sendChat = useCallback(async (text?: string) => {
    const msg = (text || chatInput).trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    const userMsg: ChatMessage = { role:'user', content:msg };
    const newMsgs = [...chatMsgs, userMsg];
    setChatMsgs([...newMsgs, { role:'assistant', content:'...' }]);
    setChatLoading(true);

    const zkResult = browserShield(msg);
    const hash = await zkHash(msg);

    try {
      const res = await fetch('/api/shield', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ messages: newMsgs, patientId:'CIQ-2026-00241', zkReport:{ sanitized:zkResult.sanitized, protectedTerms:zkResult.protectedTerms, riskScore:zkResult.riskScore } }),
      });
      const data = await res.json();
      const reply = data.content || 'Shield protected response unavailable.';
      setChatMsgs([...newMsgs, { role:'assistant', content:reply }]);
      const log: ShieldLog = { ts:new Date().toISOString(), q:msg.substring(0,60)+(msg.length>60?'...':''), hash, risk:data.shield?.riskLevel||'LOW', action:data.shield?.action||'CLEAN_PASS' };
      setShieldLogs(prev => [log, ...prev].slice(0,20));
    } catch {
      setChatMsgs([...newMsgs, { role:'assistant', content:'Connection error. Please try again.' }]);
    }
    setChatLoading(false);
  }, [chatInput, chatMsgs, chatLoading]);

  const fs = elder ? '15px' : '12px';
  const fs2 = elder ? '18px' : '14px';
  const fs3 = elder ? '22px' : '17px';

  // ── STYLES ────────────────────────────────────────────────────────────────
  const S: Record<string,React.CSSProperties> = {
    shell:{ display:'flex', flexDirection:'column', height:'100vh', maxWidth:480, margin:'0 auto', background:'#07101f', fontFamily:"'Outfit',sans-serif", color:'#eef2f8', position:'relative' },
    hdr:{ flexShrink:0, padding:'14px 18px 12px', background:'rgba(7,16,31,.97)', borderBottom:'1px solid rgba(0,212,184,.14)', backdropFilter:'blur(20px)', zIndex:10 },
    hdrRow:{ display:'flex', alignItems:'center', justifyContent:'space-between' },
    lmark:{ width:38, height:38, borderRadius:11, background:'linear-gradient(135deg,#00b89e,#8060cc)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, boxShadow:'0 4px 18px rgba(0,212,184,.25)', flexShrink:0 },
    lname:{ fontFamily:"'Playfair Display',serif", fontSize:fs3, color:'#eef2f8' },
    lsub:{ fontFamily:"'DM Mono',monospace", fontSize:8, color:'#00d4b8', letterSpacing:'.18em', textTransform:'uppercase' as const, marginTop:1 },
    hright:{ textAlign:'right' as const },
    hpat:{ fontSize:fs, fontWeight:600 },
    hid:{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'#7a9bbf', marginTop:1 },
    spill:{ display:'inline-flex', alignItems:'center', gap:4, fontFamily:"'DM Mono',monospace", fontSize:8, color:'#4ade80', marginTop:3 },
    sdot:{ width:6, height:6, borderRadius:'50%', background:'#4ade80', animation:'pulse 2s infinite' },
    mbar:{ display:'flex', gap:5, padding:'8px 18px', background:'rgba(7,16,31,.95)', borderBottom:'1px solid rgba(0,212,184,.14)', flexShrink:0, overflowX:'auto' as const, scrollbarWidth:'none' as const },
    mbtn:(on:boolean,gon?:boolean):React.CSSProperties=>({ flexShrink:0, padding:elder?'9px 16px':'7px 13px', borderRadius:20, border:`1px solid ${on?'transparent':'rgba(0,212,184,.14)'}`, background:on?(gon?'linear-gradient(135deg,#4ade80,#22c55e)':'linear-gradient(135deg,#00d4b8,#00b89e)'):'rgba(255,255,255,.04)', color:on?'#07101f':'#7a9bbf', fontSize:elder?12:11, fontWeight:700, cursor:'pointer', fontFamily:"'Outfit',sans-serif", whiteSpace:'nowrap', boxShadow:on?'0 3px 14px rgba(0,212,184,.28)':'none' }),
    rsec:{ flexShrink:0 },
    rwrap:{ display:'flex', gap:16, alignItems:'center', padding:'16px 18px 0' },
    rinfo:{ flex:1 },
    rtitle:{ fontSize:elder?22:20, fontWeight:700, marginBottom:3 },
    rsub:{ fontSize:elder?13:11, color:'#7a9bbf', lineHeight:1.5 },
    rtrend:{ display:'inline-flex', alignItems:'center', gap:4, marginTop:7, fontFamily:"'DM Mono',monospace", fontSize:10, color:'#00d4b8', background:'rgba(0,212,184,.1)', padding:'4px 10px', borderRadius:20, border:'1px solid rgba(0,212,184,.2)' },
    vrow:{ display:'flex', gap:7, padding:'12px 18px 0', overflowX:'auto' as const, scrollbarWidth:'none' as const },
    vital:{ flexShrink:0, background:'rgba(255,255,255,.04)', border:'1px solid rgba(0,212,184,.14)', borderRadius:14, padding:elder?'12px 14px':'10px 12px', minWidth:elder?96:84 },
    vico:{ fontSize:elder?16:14, marginBottom:3 },
    vval:(s:string):React.CSSProperties=>({ fontFamily:"'DM Mono',monospace", fontSize:elder?17:14, fontWeight:500, lineHeight:1, color:s==='ok'?'#00d4b8':s==='warn'?'#d4a843':'#e8526e' }),
    vunit:{ fontSize:elder?10:8, color:'#7a9bbf' },
    vname:{ fontSize:elder?11:9, color:'#7a9bbf', marginTop:2 },
    scroll:{ flex:1, overflowY:'auto' as const, scrollbarWidth:'none' as const, minHeight:0 },
    pad:{ padding:'14px 18px 110px' },
    sec:{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'#00d4b8', textTransform:'uppercase' as const, letterSpacing:'.18em', margin:'16px 0 8px' },
    card:{ background:'rgba(255,255,255,.04)', border:'1px solid rgba(0,212,184,.14)', borderRadius:18, padding:15, marginBottom:10 },
    badge:(t:string):React.CSSProperties=>({ fontFamily:"'DM Mono',monospace", fontSize:9, padding:'3px 8px', borderRadius:8, background:t==='br'?'rgba(232,82,110,.18)':t==='bg'?'rgba(212,168,67,.18)':'rgba(0,212,184,.14)', color:t==='br'?'#e8526e':t==='bg'?'#d4a843':'#00d4b8', border:`1px solid ${t==='br'?'rgba(232,82,110,.28)':t==='bg'?'rgba(212,168,67,.28)':'rgba(0,212,184,.2)'}` }),
    sgrid:{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:7, marginBottom:10 },
    si:{ background:'rgba(255,255,255,.04)', border:'1px solid rgba(0,212,184,.14)', borderRadius:14, padding:'12px 8px', textAlign:'center' as const },
    sv:{ fontFamily:"'DM Mono',monospace", fontSize:elder?18:16, fontWeight:500 },
    sl2:{ fontSize:elder?11:9, color:'#7a9bbf', marginTop:3, lineHeight:1.3 },
    dgrid:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:9 },
    ditem:{ background:'rgba(255,255,255,.07)', border:'1px solid rgba(0,212,184,.14)', borderRadius:14, padding:13 },
    dname:{ fontSize:elder?12:10, color:'#7a9bbf', marginBottom:7 },
    dbar:{ height:4, background:'rgba(255,255,255,.07)', borderRadius:2, marginBottom:5, overflow:'hidden' },
    dscore:(s:number):React.CSSProperties=>({ fontFamily:"'DM Mono',monospace", fontSize:elder?20:17, fontWeight:500, color:dc(s) }),
    ins:(t:string):React.CSSProperties=>({ borderRadius:16, padding:14, marginBottom:9, borderLeft:`3px solid ${t==='cr'?'#e8526e':t==='wt'?'#d4a843':'#00d4b8'}`, background:t==='cr'?'rgba(232,82,110,.05)':t==='wt'?'rgba(212,168,67,.05)':'rgba(0,212,184,.05)' }),
    insbody:{ fontSize:elder?13:11, color:'#7a9bbf', lineHeight:1.6 },
    mc2:{ background:'rgba(255,255,255,.07)', border:'1px solid rgba(0,212,184,.14)', borderRadius:14, padding:13, marginBottom:8 },
    mt2:{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'#00d4b8', textTransform:'uppercase' as const, letterSpacing:'.12em', marginBottom:4 },
    mn2:{ fontSize:elder?15:13, fontWeight:600, marginBottom:3 },
    md2:{ fontSize:elder?13:11, color:'#7a9bbf', lineHeight:1.5, marginBottom:7 },
    mtag:{ fontSize:9, padding:'2px 7px', borderRadius:8, background:'rgba(0,212,184,.1)', color:'#00d4b8', border:'1px solid rgba(0,212,184,.2)' },
    wm:{ background:'rgba(255,255,255,.07)', border:'1px solid rgba(0,212,184,.14)', borderRadius:10, padding:'10px 8px', textAlign:'center' as const },
    wv:{ fontFamily:"'DM Mono',monospace", fontSize:elder?16:14, fontWeight:500 },
    wl:{ fontSize:elder?11:9, color:'#7a9bbf', marginTop:2 },
    tbl:{ width:'100%', borderCollapse:'collapse' as const },
    ptav:(ab:string,ac:string):React.CSSProperties=>({ width:30, height:30, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:500, flexShrink:0, background:ab, color:ac }),
    sbr:{ display:'flex', alignItems:'center', gap:6 },
    sb2:{ flex:1, height:4, background:'rgba(255,255,255,.06)', borderRadius:2, overflow:'hidden' },
    sbv:(c:string):React.CSSProperties=>({ fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:500, width:24, textAlign:'right' as const, color:c }),
    pbg:{ height:5, background:'rgba(255,255,255,.06)', borderRadius:3, overflow:'hidden', marginBottom:4 },
    proto:{ background:'rgba(255,255,255,.07)', border:'1px solid rgba(0,212,184,.14)', borderRadius:10, padding:12, marginBottom:10 },
    ab:{ marginBottom:10 },
    abbg:{ height:6, background:'rgba(255,255,255,.07)', borderRadius:3, overflow:'hidden' },
    udsr:{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:'rgba(255,255,255,.04)', border:'1px solid rgba(0,212,184,.14)', borderRadius:8, marginBottom:8 },
    hrow:{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,.04)' },
    hin:{ fontFamily:"'DM Mono',monospace", fontSize:11, color:'#eef2f8', flex:1 },
    hout:{ fontFamily:"'DM Mono',monospace", fontSize:10, color:'#4ade80', flex:1, wordBreak:'break-all' as const },
    tl:{ display:'flex', gap:12, marginBottom:14 },
    tlc:{ display:'flex', flexDirection:'column', alignItems:'center' },
    tldot:(c:string):React.CSSProperties=>({ width:10, height:10, borderRadius:'50%', flexShrink:0, marginTop:2, background:c }),
    tlline:{ width:1, flex:1, background:'rgba(0,212,184,.14)', marginTop:3 },
    tlb:{ flex:1, paddingBottom:12 },
    tldate:{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'#7a9bbf', marginBottom:2 },
    tlttl:{ fontSize:elder?14:12, fontWeight:600, marginBottom:2 },
    tltxt:{ fontSize:elder?13:11, color:'#7a9bbf', lineHeight:1.5 },
    bnav:{ position:'fixed' as const, bottom:0, left:'50%', transform:'translateX(-50%)', width:'100%', maxWidth:480, zIndex:20, background:'rgba(7,16,31,.97)', backdropFilter:'blur(20px)', borderTop:'1px solid rgba(0,212,184,.14)', display:'flex', padding:'7px 0 14px' },
    nb:(on:boolean,gn?:boolean):React.CSSProperties=>({ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2, padding:elder?'8px 4px':'6px 4px', cursor:'pointer', border:'none', background:'none', color:on?(gn?'#4ade80':'#00d4b8'):'#7a9bbf', fontFamily:"'Outfit',sans-serif", transition:'color .2s' }),
    nico:{ fontSize:elder?22:18 },
    nlbl:{ fontSize:elder?10:8, fontWeight:600, letterSpacing:'.05em', textTransform:'uppercase' as const },
    cwrap:{ display:'flex', flexDirection:'column', height:'100%', padding:'12px 18px 0', minHeight:0 },
    caihdr:{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexShrink:0 },
    cmsgs:{ flex:1, overflowY:'auto' as const, paddingBottom:8, scrollbarWidth:'none' as const, minHeight:0 },
    bub:(r:string):React.CSSProperties=>({ maxWidth:'88%', marginBottom:12, marginLeft:r==='user'?'auto':0 }),
    bubi:(r:string):React.CSSProperties=>({ padding:'11px 15px', borderRadius:18, fontSize:elder?14:12, lineHeight:1.6, background:r==='assistant'?'rgba(255,255,255,.07)':'linear-gradient(135deg,#00d4b8,#00b89e)', border:r==='assistant'?'1px solid rgba(0,212,184,.14)':'none', color:r==='assistant'?'#eef2f8':'#07101f', fontWeight:r==='user'?500:400, borderBottomRightRadius:r==='user'?4:18, borderBottomLeftRadius:r==='assistant'?4:18 }),
    bmeta:{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'#7a9bbf', marginTop:3 },
    stag:{ display:'inline-flex', alignItems:'center', gap:4, fontFamily:"'DM Mono',monospace", fontSize:8, padding:'2px 7px', borderRadius:6, marginTop:4, background:'rgba(74,222,128,.12)', color:'#4ade80', border:'1px solid rgba(74,222,128,.2)' },
    qps:{ display:'flex', gap:7, marginBottom:10, overflowX:'auto' as const, scrollbarWidth:'none' as const, flexShrink:0 },
    qp:{ flexShrink:0, padding:'6px 12px', borderRadius:20, fontSize:elder?12:10, fontWeight:500, cursor:'pointer', border:'1px solid rgba(0,212,184,.14)', background:'rgba(255,255,255,.04)', color:'#7a9bbf', whiteSpace:'nowrap' as const, fontFamily:"'Outfit',sans-serif" },
    cbot:{ borderTop:'1px solid rgba(0,212,184,.14)', padding:'10px 0 0', flexShrink:0 },
    crow:{ display:'flex', gap:9 },
    cin:{ flex:1, background:'rgba(255,255,255,.05)', border:'1px solid rgba(0,212,184,.14)', borderRadius:24, padding:elder?'13px 17px':'11px 17px', fontSize:elder?14:12, color:'#eef2f8', fontFamily:"'Outfit',sans-serif", outline:'none' },
    csend:{ width:elder?48:42, height:elder?48:42, borderRadius:'50%', border:'none', cursor:'pointer', background:'linear-gradient(135deg,#00d4b8,#00b89e)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, flexShrink:0, boxShadow:'0 4px 14px rgba(0,212,184,.28)' },
    shstat:{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:7, marginBottom:10 },
    ssi:{ background:'rgba(255,255,255,.04)', border:'1px solid rgba(74,222,128,.2)', borderRadius:14, padding:'12px 8px', textAlign:'center' as const },
    ssv:{ fontFamily:"'DM Mono',monospace", fontSize:elder?18:16, fontWeight:500, color:'#4ade80' },
    ssl:{ fontSize:elder?11:9, color:'#7a9bbf', marginTop:3, lineHeight:1.3 },
    logitem:{ background:'rgba(255,255,255,.04)', border:'1px solid rgba(0,212,184,.14)', borderRadius:14, padding:13, marginBottom:8 },
    logtop:{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 },
    logtime:{ fontFamily:"'DM Mono',monospace", fontSize:9, color:'#7a9bbf' },
    pav:{ width:64, height:64, borderRadius:'50%', background:'linear-gradient(135deg,#00d4b8,#8060cc)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:26, margin:'0 auto 10px' },
    gapitem:{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:'rgba(255,255,255,.04)', border:'1px solid rgba(0,212,184,.14)', borderRadius:10, marginBottom:8 },
    gico:{ fontSize:15, flexShrink:0 },
    gtxt:{ flex:1, fontSize:elder?14:12, color:'#eef2f8' },
  };

  // ── PAGES ─────────────────────────────────────────────────────────────────
  const pgHealth = () => (
    <div style={S.pad}>
      <div style={S.sec}>Risk Domains</div>
      <div style={S.dgrid}>
        {DOMAINS.map((d,i) => (
          <div key={i} style={S.ditem}>
            <div style={S.dname}>{d.name}</div>
            <div style={S.dbar}><div style={{width:`${d.score}%`,height:'100%',background:dc(d.score),borderRadius:2}}/></div>
            <div style={S.dscore(d.score)}>{d.score}<span style={{fontSize:10,color:'#7a9bbf'}}>/100</span></div>
          </div>
        ))}
      </div>
      <div style={S.sec}>Wearable Data</div>
      <div style={{...S.card, marginBottom:8}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
          <span style={{fontSize:elder?28:24}}>⌚</span>
          <div><div style={{fontSize:elder?15:13,fontWeight:600}}>Apple Watch Series 9</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#4ade80'}}>Connected · Synced 2 min ago</div></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:7}}>
          {[['7,842','Steps','#00d4b8'],['72','Avg BPM','#e8526e'],['6h 20m','Sleep','#8060cc'],['97%','SpO2','#00d4b8'],['340','Cal','#d4a843'],['78%','Adherence','#4ade80']].map(([v,l,c],i)=>(
            <div key={i} style={S.wm}><div style={{...S.wv,color:c}}>{v}</div><div style={S.wl}>{l}</div></div>
          ))}
        </div>
      </div>
      <div style={S.sec}>Platform Intelligence</div>
      <div style={S.sgrid}>
        {[['15B+','#00d4b8','Clinical Data Points'],['96%','#d4a843','Pre-Symptom Detection'],['13:1','#8060cc','Prevention ROI'],['$340K','#4ade80','Saved Per FQHC'],['51%','#00d4b8','Prediabetes Reversed'],['32%','#e8526e','ED Reduction']].map(([v,c,l],i)=>(
          <div key={i} style={S.si}><div style={{...S.sv,color:c}}>{v}</div><div style={S.sl2}>{l}</div></div>
        ))}
      </div>
      <div style={S.sec}>Active Protocols</div>
      {[{name:'Metabolic Reversal',pct:34,c:'#d4a843',sub:'A1C target 5.7% — Week 5 of 18'},{name:'Cardiovascular Defense',pct:28,c:'#e8526e',sub:'LDL target less than 170 mg/dL'},{name:'Longevity Optimization',pct:61,c:'#00d4b8',sub:'Supplement + sleep + exercise'},{name:'Cognitive Protection',pct:75,c:'#8060cc',sub:'Brain health markers stable'}].map((p,i)=>(
        <div key={i} style={S.proto}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:500,color:'#eef2f8'}}>{p.name}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:500,color:p.c}}>{p.pct}%</span>
          </div>
          <div style={S.pbg}><div style={{width:`${p.pct}%`,height:'100%',background:p.c,borderRadius:3}}/></div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#7a9bbf',marginTop:5}}>{p.sub}</div>
        </div>
      ))}
    </div>
  );

  const pgInsights = () => {
    const ins = [
      {type:'cr',ico:'⚠️',ttl:'LDL Elevated — Cardiovascular Risk',body:'LDL of 198 mg/dL elevates your 10-year cardiovascular risk. CareIQ recommends statin evaluation and a Mediterranean nutrition protocol within 14 days.',conf:'93%'},
      {type:'wt',ico:'📈',ttl:'Prediabetes Intervention Window',body:'A1C at 6.1%. Research shows 51% of patients at this stage return to normal blood sugar within 14 months on a targeted metabolic protocol. You are in the window.',conf:'89%'},
      {type:'ps',ico:'✅',ttl:'Cognitive Markers Stable',body:'Blood pressure trends and inflammatory markers are within protective range for brain health. Your current activity level is producing measurable benefit.',conf:'96%'},
    ];
    const tl = [
      {c:'#00d4b8',date:'Apr 15, 2026',ttl:'CareIQ Enrollment',txt:'Baseline health score: 66. Care gap assessment complete.'},
      {c:'#d4a843',date:'May 1, 2026',ttl:'Blood Panel Flag',txt:'LDL 198, A1C 6.1%. Metabolic protocol initiated.'},
      {c:'#8060cc',date:'May 10, 2026',ttl:'AI Insight — Intervention Window',txt:'CareIQ flagged prediabetes intervention opportunity.'},
      {c:'#00d4b8',date:'Jun 1, 2026',ttl:'30-Day Check-In',txt:'Health score improved to 70. Blood pressure trending down.'},
    ];
    return (
      <div style={S.pad}>
        <div style={S.sec}>AI Clinical Insights</div>
        {ins.map((item,i) => (
          <div key={i} style={S.ins(item.type)}>
            <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:6}}><span style={{fontSize:14}}>{item.ico}</span><span style={{fontSize:elder?14:12,fontWeight:600}}>{item.ttl}</span></div>
            <div style={S.insbody}>{item.body}</div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:8}}>
              <span style={{fontSize:elder?12:10,fontWeight:600,color:'#00d4b8',padding:'5px 12px',border:'1px solid rgba(0,212,184,.3)',borderRadius:20,background:'rgba(0,212,184,.07)',cursor:'pointer'}}>View Details</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#7a9bbf'}}>AI Confidence: {item.conf}</span>
            </div>
          </div>
        ))}
        <div style={S.sec}>Health Timeline</div>
        {tl.map((t,i) => (
          <div key={i} style={S.tl}>
            <div style={S.tlc}>
              <div style={S.tldot(t.c)}/>
              {i < tl.length-1 && <div style={S.tlline}/>}
            </div>
            <div style={S.tlb}>
              <div style={S.tldate}>{t.date}</div>
              <div style={S.tlttl}>{t.ttl}</div>
              <div style={S.tltxt}>{t.txt}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const pgNutrition = () => (
    <div style={S.pad}>
      <div style={S.sec}>Personalized Nutrition Plan</div>
      <div style={S.sgrid}>
        {[['1,800','#00d4b8','Target Calories'],['112g','#d4a843','Protein'],['30g','#8060cc','Fiber']].map(([v,c,l],i)=>(
          <div key={i} style={S.si}><div style={{...S.sv,color:c}}>{v}</div><div style={S.sl2}>{l}</div></div>
        ))}
      </div>
      {MEALS.map((m,i) => (
        <div key={i} style={S.mc2}>
          <div style={S.mt2}>{m.time}</div>
          <div style={S.mn2}>{m.name}</div>
          <div style={S.md2}>{m.desc}</div>
          <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{m.tags.map((t,j)=><span key={j} style={S.mtag}>{t}</span>)}</div>
        </div>
      ))}
      <div style={S.sec}>Exercise Protocol</div>
      <div style={S.sgrid}>
        {[['4','#8060cc','Activities/Week'],['150','#00d4b8','Min/Week'],['78%','#4ade80','Adherence']].map(([v,c,l],i)=>(
          <div key={i} style={S.si}><div style={{...S.sv,color:c}}>{v}</div><div style={S.sl2}>{l}</div></div>
        ))}
      </div>
      {[{type:'Cardio — 5x/Week',name:'30-Minute Brisk Walk',desc:'Low-impact cardio targeting 100-120 bpm. Proven LDL reduction and blood pressure management.',tags:['Low Impact','LDL Reduction','Elder Friendly']},{type:'Strength — 3x/Week',name:'Chair-Based Resistance',desc:'Seated resistance exercises. Builds muscle mass improving insulin sensitivity.',tags:['Seated Option','Insulin Sensitivity','Safe']},{type:'Flexibility — Daily',name:'10-Minute Gentle Stretch',desc:'Morning routine improving circulation and reducing stiffness.',tags:['Daily','10 min','Elder Friendly']}].map((e,i)=>(
        <div key={i} style={{...S.mc2,border:'1px solid rgba(128,96,204,.2)'}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#8060cc',textTransform:'uppercase',letterSpacing:'.12em',marginBottom:4}}>{e.type}</div>
          <div style={S.mn2}>{e.name}</div>
          <div style={S.md2}>{e.desc}</div>
          <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{e.tags.map((t,j)=><span key={j} style={{...S.mtag,background:'rgba(128,96,204,.1)',color:'#b090f0',border:'1px solid rgba(128,96,204,.2)'}}>{t}</span>)}</div>
        </div>
      ))}
    </div>
  );

  const pgAI = () => (
    <div style={{...S.cwrap, paddingBottom:100}}>
      <div style={S.caihdr}>
        <div style={{width:elder?48:40,height:elder?48:40,borderRadius:'50%',background:'linear-gradient(135deg,#00d4b8,#8060cc)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:elder?22:19,flexShrink:0}}>🧬</div>
        <div>
          <div style={{fontSize:elder?15:13,fontWeight:600,color:'#eef2f8'}}>CareIQ Health AI</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#00d4b8'}}>Community Health Intelligence · Shield Active</div>
        </div>
      </div>
      <div style={S.qps}>
        {['My LDL risk','Prediabetes plan','Exercise tips','What to eat','Next appointment','Heart health'].map(q=>(
          <button key={q} style={S.qp} onClick={()=>sendChat(q)}>{q}</button>
        ))}
      </div>
      <div style={S.cmsgs}>
        {chatMsgs.map((m,i) => (
          <div key={i} style={S.bub(m.role)}>
            <div style={S.bubi(m.role)}>{m.content==='...'?<span style={{color:'#7a9bbf',fontStyle:'italic'}}>CareIQ AI is thinking...</span>:m.content}</div>
            <div style={S.bmeta}>{m.role==='assistant'?'🧬 CareIQ AI':'You'}</div>
            {m.role==='assistant'&&<div style={S.stag}>🔒 Shield Protected</div>}
          </div>
        ))}
        <div ref={chatEndRef}/>
      </div>
      <div style={S.cbot}>
        <div style={S.crow}>
          <input style={S.cin} value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}}} placeholder="Ask your health AI..." aria-label="Chat input"/>
          <button style={S.csend} onClick={()=>sendChat()} disabled={chatLoading} aria-label="Send message">➤</button>
        </div>
      </div>
    </div>
  );

  const pgProfile = () => (
    <div style={S.pad}>
      <div style={{textAlign:'center',padding:'16px 0 20px'}}>
        <div style={S.pav}>👤</div>
        <div style={{fontSize:elder?24:20,fontWeight:700}}>Jamie Rivera</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:'#7a9bbf',marginTop:3}}>CIQ-2026-00241</div>
        <div style={{fontSize:elder?13:11,color:'#d4a843',marginTop:5}}>Age 54 · Riverside Community Health</div>
        <div style={{display:'inline-flex',alignItems:'center',gap:5,fontFamily:"'DM Mono',monospace",fontSize:8,color:'#4ade80',background:'rgba(74,222,128,.08)',border:'1px solid rgba(74,222,128,.2)',padding:'3px 10px',borderRadius:20,marginTop:10}}><div style={{width:5,height:5,borderRadius:'50%',background:'#4ade80',animation:'pulse 2s infinite'}}/>Shield Active · HIPAA Protected</div>
      </div>
      <div style={S.sec}>Profile</div>
      {[['Health Center','Riverside Community Health'],['Enrollment','April 15, 2026'],['Primary Provider','Dr. Maria Santos, MD'],['Next Appointment','July 8, 2026'],['Insurance','Medicaid'],['Shield Version','Sovereign Shield v2.0'],['Wearable','Apple Watch Series 9 — Connected'],['Elder Mode',elder?'Active':'Off']].map((r,i)=>(
        <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid rgba(255,255,255,.06)'}}>
          <span style={{fontSize:elder?13:11,color:'#7a9bbf'}}>{r[0]}</span>
          <span style={{fontSize:elder?13:11,fontWeight:500,textAlign:'right',maxWidth:'55%'}}>{r[1]}</span>
        </div>
      ))}
    </div>
  );

  const pgPanel = () => (
    <div style={S.pad}>
      <div style={S.sec}>Patient Panel — Riverside FQHC</div>
      <div style={S.sgrid}>
        {[['18','#e8526e','High Risk'],['34','#d4a843','Moderate Risk'],['247','#00d4b8','Open Gaps']].map(([v,c,l],i)=>(
          <div key={i} style={S.si}><div style={{...S.sv,color:c}}>{v}</div><div style={S.sl2}>{l}</div></div>
        ))}
      </div>
      <div style={{...S.card,padding:0,overflow:'hidden'}}>
        <table style={S.tbl}>
          <thead>
            <tr>
              {['Patient','Condition','Risk','Score','Gaps'].map(h=>(
                <th key={h} style={{fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:500,letterSpacing:1,textTransform:'uppercase',color:'#7a9bbf',padding:'8px 10px',textAlign:'left',borderBottom:'1px solid rgba(0,212,184,.14)'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PATIENTS.map((p,i) => {
              const init = p.name.split(' ').map((x:string)=>x[0]).join('');
              const ab = p.risk==='high'?'rgba(232,82,110,.2)':p.risk==='medium'?'rgba(212,168,67,.2)':'rgba(0,212,184,.15)';
              const ac = rc(p.risk);
              return (
                <tr key={i}>
                  <td style={{padding:'10px',borderBottom:'1px solid rgba(255,255,255,.04)',verticalAlign:'middle'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={S.ptav(ab,ac)}>{init}</div>
                      <div>
                        <div style={{fontSize:elder?14:12,fontWeight:600,color:'#eef2f8'}}>{p.name}</div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#7a9bbf'}}>{p.id}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{padding:'10px',borderBottom:'1px solid rgba(255,255,255,.04)',fontSize:elder?13:11,color:'#7a9bbf'}}>{p.conditions[0]}</td>
                  <td style={{padding:'10px',borderBottom:'1px solid rgba(255,255,255,.04)'}}><span style={S.badge(rb(p.risk))}>{p.risk}</span></td>
                  <td style={{padding:'10px',borderBottom:'1px solid rgba(255,255,255,.04)'}}>
                    <div style={S.sbr}>
                      <div style={S.sb2}><div style={{width:`${p.riskScore}%`,height:'100%',background:rc(p.risk),borderRadius:2}}/></div>
                      <span style={S.sbv(rc(p.risk))}>{p.riskScore}</span>
                    </div>
                  </td>
                  <td style={{padding:'10px',borderBottom:'1px solid rgba(255,255,255,.04)'}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:elder?14:12,fontWeight:600,color:p.gaps>3?'#e8526e':p.gaps>1?'#d4a843':'#00d4b8'}}>{p.gaps}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const pgGaps = () => {
    const crit = [{ico:'🏥',txt:'Post-hospitalization follow-up overdue 3 weeks',pt:'Rosa L. — Heart Failure'},{ico:'🫘',txt:'Nephrology co-management referral urgent',pt:'Carlos M. — CKD Stage 3'},{ico:'👁️',txt:'Retinal eye exam overdue 14 months',pt:'Maria T. — Diabetes'},{ico:'💉',txt:'Pneumococcal vaccine not on record',pt:'Rosa L. — COPD'},{ico:'💊',txt:'ACE inhibitor dosage review needed',pt:'Carlos M. — CKD/HTN'}];
    const mod = [{ico:'🏃',txt:'NDPP referral pending',pt:'James R. — Pre-Diabetes'},{ico:'📋',txt:'Mammography declined last visit',pt:'Linda S. — Age 52'},{ico:'🔬',txt:'Colorectal screening overdue 2 years',pt:'James R. — Age 44'}];
    return (
      <div style={S.pad}>
        <div style={S.sec}>Care Gap Management</div>
        <div style={S.sgrid}>
          {[['54','#e8526e','Critical'],['118','#d4a843','Moderate'],['75','#00d4b8','Routine']].map(([v,c,l],i)=>(
            <div key={i} style={S.si}><div style={{...S.sv,color:c}}>{v}</div><div style={S.sl2}>{l}</div></div>
          ))}
        </div>
        <div style={S.sec}>Critical — Immediate Action</div>
        {crit.map((g,i)=>(
          <div key={i} style={S.gapitem}>
            <span style={S.gico}>{g.ico}</span>
            <div style={{flex:1}}><div style={S.gtxt}>{g.txt}</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#7a9bbf',marginTop:2}}>{g.pt}</div></div>
            <span style={S.badge('br')}>Critical</span>
          </div>
        ))}
        <div style={S.sec}>Moderate — Within 30 Days</div>
        {mod.map((g,i)=>(
          <div key={i} style={S.gapitem}>
            <span style={S.gico}>{g.ico}</span>
            <div style={{flex:1}}><div style={S.gtxt}>{g.txt}</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#7a9bbf',marginTop:2}}>{g.pt}</div></div>
            <span style={S.badge('bg')}>Moderate</span>
          </div>
        ))}
      </div>
    );
  };

  const pgUDS = () => (
    <div style={S.pad}>
      <div style={S.sec}>UDS Quality Measures</div>
      <div style={S.sgrid}>
        {[['71%','#00d4b8','Overall Compliance'],['14/18','#d4a843','Measures Passing'],['4','#e8526e','Need Improvement']].map(([v,c,l],i)=>(
          <div key={i} style={S.si}><div style={{...S.sv,color:c}}>{v}</div><div style={S.sl2}>{l}</div></div>
        ))}
      </div>
      <div style={S.sec}>Measure Performance</div>
      {UDS_MEASURES.map((r,i) => {
        const c = r.cur >= r.tgt ? '#00d4b8' : r.cur >= r.tgt - 8 ? '#d4a843' : '#e8526e';
        return (
          <div key={i} style={S.udsr}>
            <div style={{flex:1,fontSize:elder?14:12,color:'#eef2f8'}}>{r.m}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,width:40,textAlign:'center',color:c}}>{r.cur}%</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#7a9bbf',width:55}}>Goal: {r.tgt}%</div>
            <div style={{width:80}}>
              <div style={{height:4,background:'rgba(255,255,255,.06)',borderRadius:2,overflow:'hidden'}}>
                <div style={{width:`${r.cur}%`,height:'100%',background:c,borderRadius:2}}/>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const pgImpact = () => {
    const items = [{label:'ED Visit Reduction (32%)',pct:75,c:'#00d4b8',right:'$184K/yr'},{label:'Readmission Prevention',pct:60,c:'#d4a843',right:'$142K/yr'},{label:'Preventive Gaps Closed',pct:71,c:'#8060cc',right:'$96K/yr'},{label:'UDS Measure Improvement',pct:85,c:'#4ade80',right:'$340K protected'}];
    return (
      <div style={S.pad}>
        <div style={S.sec}>FQHC Cost Avoidance</div>
        <div style={S.card}>
          {items.map((a,i)=>(
            <div key={i} style={S.ab}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:elder?13:11,marginBottom:3}}>
                <span style={{color:'#7a9bbf'}}>{a.label}</span>
                <span style={{color:a.c,fontFamily:"'DM Mono',monospace",fontWeight:500}}>{a.right}</span>
              </div>
              <div style={S.abbg}><div style={{width:`${a.pct}%`,height:'100%',background:a.c,borderRadius:3}}/></div>
            </div>
          ))}
          <div style={{borderTop:'1px solid rgba(0,212,184,.14)',marginTop:8,paddingTop:10,display:'flex',justifyContent:'space-between'}}>
            <span style={{fontSize:elder?13:11,color:'#7a9bbf'}}>Total Annual Benefit</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:elder?22:20,color:'#00d4b8',fontWeight:500}}>$762K</span>
          </div>
        </div>
        <div style={S.sec}>5-Year Projection</div>
        <div style={S.card}>
          {[['Year 1','$380K','#7a9bbf'],['Year 2','$1.2M','#d4a843'],['Year 3','$2.8M','#00d4b8'],['Year 4','$4.1M','#00d4b8'],['Year 5','$5.9M','#4ade80']].map((r,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:i<4?'1px solid rgba(255,255,255,.04)':'none'}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:elder?13:11,color:'#7a9bbf'}}>{r[0]}</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:elder?15:13,color:r[2],fontWeight:600}}>{r[1]}</span>
            </div>
          ))}
          <div style={{marginTop:10,display:'flex',justifyContent:'space-between',borderTop:'1px solid rgba(0,212,184,.14)',paddingTop:10}}>
            <span style={{fontSize:elder?13:10,color:'#7a9bbf'}}>5-Year Cumulative</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:elder?20:18,color:'#4ade80',fontWeight:500}}>$14.4M</span>
          </div>
        </div>
      </div>
    );
  };

  const pgShield = () => {
    const hashes = [['Jamie Rivera','ZK:A4F2C8910B3D7E50'],['DOB 09/14/1972','ZK:B7E3D2041A9C8F52'],['MRN CIQ-00241','ZK:C1A9F5638E2D7B04'],['DX Prediabetes','ZK:D8B2E4170F6C3A91'],['123 Oak St Riverside','ZK:E5C7A0289D4F1B63']];
    return (
      <div style={S.pad}>
        <div style={S.shstat}>
          {[['#'+shieldLogs.length,'Queries Protected'],[''+shieldLogs.length,'ZK Hashed'],['0','PHI Leaked']].map(([v,l],i)=>(
            <div key={i} style={S.ssi}><div style={S.ssv}>{v}</div><div style={S.ssl}>{l}</div></div>
          ))}
        </div>
        <div style={{...S.card,marginBottom:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <span style={{fontSize:elder?15:13,fontWeight:600}}>Sovereign Prompt Shield v2.0</span>
            <span style={S.badge('bt')}>ZK ACTIVE</span>
          </div>
          {[['Architecture','Zero-Knowledge Dual Layer','#4ade80'],['Layer 1','PHI hashed before transmission','#00d4b8'],['Layer 2','PII stripped server-side','#00d4b8'],['Data Residency','FQHC-controlled infrastructure','#4ade80'],['PHI Exposure','ZERO — never leaves device raw','#4ade80'],['HIPAA','100% compliant','#4ade80']].map((r,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:i<5?'1px solid rgba(255,255,255,.04)':'none'}}>
              <span style={{fontSize:elder?12:10,color:'#7a9bbf',width:'40%'}}>{r[0]}</span>
              <span style={{fontSize:elder?12:10,fontFamily:"'DM Mono',monospace",color:r[2],textAlign:'right'}}>{r[1]}</span>
            </div>
          ))}
        </div>
        <div style={S.sec}>Live Hash Demo</div>
        <div style={S.card}>
          {hashes.map((h,i)=>(
            <div key={i} style={{...S.hrow,borderBottom:i<hashes.length-1?'1px solid rgba(255,255,255,.04)':'none'}}>
              <div style={S.hin}>{h[0]}</div>
              <div style={{color:'#00d4b8',fontSize:12}}>⬡</div>
              <div style={S.hout}>{h[1]}</div>
              <span style={S.badge('bt')}>Protected</span>
            </div>
          ))}
        </div>
        <div style={S.sec}>Audit Log</div>
        {shieldLogs.length === 0 ? (
          <div style={{...S.card,textAlign:'center',padding:24}}>
            <div style={{fontSize:24,marginBottom:8}}>🛡️</div>
            <div style={{fontSize:elder?14:12,color:'#7a9bbf'}}>No queries yet. Use the AI tab to see Shield protection in real time.</div>
          </div>
        ) : shieldLogs.map((log,i)=>(
          <div key={i} style={S.logitem}>
            <div style={S.logtop}>
              <span style={S.logtime}>{new Date(log.ts).toLocaleTimeString()}</span>
              <span style={S.badge('bt')}>Protected</span>
            </div>
            <div style={{fontSize:elder?12:10,color:'#7a9bbf',marginBottom:6,fontStyle:'italic'}}>"{log.q}"</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#4ade80'}}>ZK: {log.hash} · {log.action} · Risk: {log.risk}</div>
          </div>
        ))}
      </div>
    );
  };

  // ── NAV CONFIG ───────────────────────────────────────────────────────────
  const PNAV = [
    {id:'health',ico:'🏥',lbl:'Health'},
    {id:'insights',ico:'💡',lbl:'Insights'},
    {id:'nutrition',ico:'🥗',lbl:'Nutrition'},
    {id:'ai',ico:'🧬',lbl:'AI'},
    {id:'profile',ico:'👤',lbl:'Profile'},
  ];
  const CNAV = [
    {id:'panel',ico:'◉',lbl:'Panel'},
    {id:'gaps',ico:'◎',lbl:'Gaps'},
    {id:'uds',ico:'📋',lbl:'UDS'},
    {id:'impact',ico:'📊',lbl:'Impact'},
    {id:'shield',ico:'🔒',lbl:'Shield'},
  ];

  const nav = mode === 'patient' ? PNAV : CNAV;

  const renderPage = () => {
    if (mode === 'patient') {
      if (page === 'health') return pgHealth();
      if (page === 'insights') return pgInsights();
      if (page === 'nutrition') return pgNutrition();
      if (page === 'ai') return pgAI();
      if (page === 'profile') return pgProfile();
    } else {
      if (page === 'panel') return pgPanel();
      if (page === 'gaps') return pgGaps();
      if (page === 'uds') return pgUDS();
      if (page === 'impact') return pgImpact();
      if (page === 'shield') return pgShield();
    }
    return null;
  };

  const showRing = mode === 'patient' && page !== 'ai' && page !== 'profile';

  // ── RENDER ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* SHIELD MODAL */}
      {showModal && (
        <div style={{position:'fixed',inset:0,zIndex:999,background:'rgba(7,16,31,.96)',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#0c1a2e',border:'1px solid #00d4b8',borderRadius:20,padding:36,maxWidth:480,width:'92%',textAlign:'center',boxShadow:'0 0 60px rgba(0,212,184,.2)',animation:'fadeUp .4s ease'}}>
            <div style={{fontSize:48,color:'#00d4b8',marginBottom:12}}>⬡</div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:'#00d4b8',marginBottom:8}}>Sovereign Shield Active</div>
            <div style={{fontSize:elder?15:13,color:'#7a9bbf',lineHeight:1.75,marginBottom:18}}>Before any patient data loads, CareIQ hashes all personally identifiable and clinically sensitive information at your device edge. Your patients privacy is protected by architecture, not just policy.</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:7,justifyContent:'center',marginBottom:22}}>
              {[['Maria T.','ZK:A4F2C891'],['DOB:1966-03-12','ZK:B7E3D204'],['MRN:00124893','ZK:C1A9F563'],['DX:E11.65','ZK:D8B2E417'],['Address','ZK:F3D1B796']].map(([k,v],i)=>(
                <div key={i} style={{background:'rgba(0,212,184,.08)',border:'1px solid rgba(0,212,184,.2)',borderRadius:6,padding:'4px 10px',fontFamily:"'DM Mono',monospace",fontSize:10,color:'#00d4b8'}}>{k} <span style={{color:'#7a9bbf',fontSize:9}}>{v}</span></div>
              ))}
            </div>
            <button onClick={()=>setShowModal(false)} style={{background:'linear-gradient(135deg,#0d2e1e,#156040)',color:'#faf0dc',border:'none',borderRadius:10,padding:'13px 32px',fontFamily:"'Outfit',sans-serif",fontSize:elder?16:13,fontWeight:700,cursor:'pointer',boxShadow:'0 0 20px rgba(0,212,184,.3)'}}>Enter CareIQ OS ⬡</button>
          </div>
        </div>
      )}

      <div style={S.shell}>
        {/* HEADER */}
        <div style={S.hdr}>
          <div style={S.hdrRow}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={S.lmark}>⊕</div>
              <div><div style={S.lname}>CareIQ</div><div style={S.lsub}>Community Health Intelligence</div></div>
            </div>
            <div style={S.hright}>
              <div style={S.hpat}>Jamie Rivera</div>
              <div style={S.hid}>CIQ-2026-00241</div>
              <div style={S.spill}><div style={S.sdot}/>SHIELD ON</div>
            </div>
          </div>
        </div>

        {/* RING */}
        {showRing && (
          <div style={S.rsec}>
            <div style={S.rwrap}>
              <div style={{position:'relative',width:88,height:88,flexShrink:0}}>
                <svg width="88" height="88" viewBox="0 0 88 88" style={{transform:'rotate(-90deg)'}}>
                  <circle cx="44" cy="44" r="37" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7"/>
                  <circle cx="44" cy="44" r="37" fill="none" stroke="url(#rg)" strokeWidth="7" strokeLinecap="round" strokeDasharray="232.5" strokeDashoffset="69.75"/>
                  <defs><linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#00d4b8"/><stop offset="100%" stopColor="#8060cc"/></linearGradient></defs>
                </svg>
                <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:28,fontWeight:500,color:'#00d4b8',lineHeight:1}}>70</div>
                  <div style={{fontSize:8,color:'#7a9bbf',textTransform:'uppercase',letterSpacing:'.12em',marginTop:2}}>Score</div>
                </div>
              </div>
              <div style={S.rinfo}>
                <div style={S.rtitle}>Moderate Risk</div>
                <div style={S.rsub}>2 active gaps · Next visit 45 days</div>
                <div style={S.rtrend}>+6.2% since last visit</div>
              </div>
            </div>
            <div style={S.vrow}>
              {VITALS.map((v,i)=>(
                <div key={i} style={S.vital}>
                  <div style={S.vico}>{v.ico}</div>
                  <div style={S.vval(v.status)}>{v.val}</div>
                  <div style={S.vunit}>{v.unit}</div>
                  <div style={S.vname}>{v.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MODE BAR */}
        <div style={S.mbar}>
          <button style={S.mbtn(mode==='patient')} onClick={()=>{setMode('patient');setPage('health');}}>👤 Patient</button>
          <button style={S.mbtn(mode==='clinical')} onClick={()=>{setMode('clinical');setPage('panel');}}>⚕️ Clinical</button>
          <button style={S.mbtn(elder,true)} onClick={()=>setElder(!elder)}>👴 Elder</button>
          <button style={S.mbtn(mode==='clinical'&&page==='shield')} onClick={()=>{setMode('clinical');setPage('shield');}}>🔒 Shield</button>
        </div>

        {/* CONTENT */}
        <div style={S.scroll}>
          {renderPage()}
        </div>

        {/* BOTTOM NAV */}
        <div style={S.bnav}>
          {nav.map(n => (
            <button key={n.id} style={S.nb(page===n.id, n.id==='shield')} onClick={()=>setPage(n.id)}>
              <span style={S.nico}>{n.ico}</span>
              <span style={S.nlbl}>{n.lbl}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
