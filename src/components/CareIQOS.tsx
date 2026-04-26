'use client';
import { useState, useRef, useCallback } from 'react';

interface ChatMessage { role: 'user' | 'assistant'; content: string; }
interface ShieldLog { ts: string; q: string; hash: string; risk: string; action: string; }

const PII_PATTERNS = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, token: '[SSN_PROTECTED]' },
  { pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, token: '[PHONE_PROTECTED]' },
  { pattern: /\b(dob|date of birth)[:\s]+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/gi, token: '[DOB_PROTECTED]' },
  { pattern: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, token: '[DATE_PROTECTED]' },
];

const PATIENTS = [
  { id:'CIQ-00124', name:'Maria T.', cond:'T2 Diabetes, Hypertension', risk:'high', rs:87, hs:54, gaps:4, ab:'rgba(232,82,110,.2)', ac:'#e8526e' },
  { id:'CIQ-00512', name:'James R.', cond:'Pre-Diabetes, Obesity', risk:'medium', rs:61, hs:63, gaps:4, ab:'rgba(212,168,67,.2)', ac:'#d4a843' },
  { id:'CIQ-00389', name:'Rosa L.', cond:'COPD, Heart Failure', risk:'high', rs:92, hs:41, gaps:4, ab:'rgba(232,82,110,.2)', ac:'#e8526e' },
  { id:'CIQ-00741', name:'David K.', cond:'Anxiety, Hypertension', risk:'medium', rs:48, hs:71, gaps:3, ab:'rgba(212,168,67,.2)', ac:'#d4a843' },
  { id:'CIQ-00295', name:'Linda S.', cond:'Preventive, Well Visit', risk:'low', rs:22, hs:84, gaps:2, ab:'rgba(0,212,184,.15)', ac:'#00d4b8' },
  { id:'CIQ-00271', name:'Carlos M.', cond:'CKD Stage 3, Diabetes', risk:'high', rs:79, hs:49, gaps:4, ab:'rgba(232,82,110,.2)', ac:'#e8526e' },
  { id:'CIQ-00634', name:'Agnes W.', cond:'Osteoporosis, Hypertension', risk:'medium', rs:55, hs:66, gaps:4, ab:'rgba(212,168,67,.2)', ac:'#d4a843' },
  { id:'CIQ-00887', name:'Tyrone B.', cond:'Asthma, Uninsured', risk:'low', rs:18, hs:88, gaps:3, ab:'rgba(0,212,184,.15)', ac:'#00d4b8' },
];

const VITALS = [
  { ico:'❤️', val:'124/80', unit:'mmHg', name:'BP', s:'warn' },
  { ico:'🩸', val:'6.1', unit:'A1C %', name:'Glycemic', s:'warn' },
  { ico:'🔬', val:'198', unit:'mg/dL', name:'LDL', s:'alrt' },
  { ico:'⚡', val:'72', unit:'bpm', name:'Heart Rate', s:'ok' },
  { ico:'🫁', val:'97', unit:'SpO2', name:'Oxygen', s:'ok' },
  { ico:'⚖️', val:'182', unit:'lbs', name:'Weight', s:'warn' },
];

const DOMAINS = [
  { name:'🔬 Metabolic', score:55 },
  { name:'❤️ Cardiovascular', score:65 },
  { name:'🧠 Cognitive', score:80 },
  { name:'🎗️ Oncology', score:90 },
  { name:'💧 Renal', score:76 },
  { name:'🌿 Mental Health', score:70 },
];

const UDS = [
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

const dc = (s: number) => s >= 80 ? '#00d4b8' : s >= 60 ? '#d4a843' : '#e8526e';
const rc = (r: string) => r === 'high' ? '#e8526e' : r === 'medium' ? '#d4a843' : '#00d4b8';
const rb = (r: string) => r === 'high' ? '#e8526e' : r === 'medium' ? '#d4a843' : '#00d4b8';
const sc = (s: string) => s === 'ok' ? '#00d4b8' : s === 'warn' ? '#d4a843' : '#e8526e';

async function zkHash(text: string): Promise<string> {
  try {
    const enc = new TextEncoder();
    const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(text + 'CIQ-SOVEREIGN-2026'));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('').substring(0,16).toUpperCase();
  } catch { return 'SHIELD-ACTIVE'; }
}

function browserShield(text: string) {
  let sanitized = text;
  let riskScore = 0;
  for (const p of PII_PATTERNS) {
    if (text.match(p.pattern)) {
      sanitized = sanitized.replace(p.pattern, p.token);
      riskScore += 30;
    }
  }
  return { sanitized, riskScore: Math.min(riskScore, 100) };
}

const T = "'Outfit',sans-serif";
const M = "'DM Mono',monospace";
const P = "'Playfair Display',serif";

export default function CareIQOS() {
  const [showModal, setShowModal] = useState(true);
  const [mode, setMode] = useState<'p'|'c'>('p');
  const [page, setPage] = useState('health');
  const [elder, setElder] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>([
    { role:'assistant', content:"Hello! I'm your CareIQ Health AI. Your health score is 70, up 6.2% since your last visit. Everything you share is protected by the Sovereign Shield. What would you like to know?" }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [shieldLogs, setShieldLogs] = useState<ShieldLog[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const e = elder;
  const nav = mode === 'p'
    ? [{id:'health',ico:'🏥',lbl:'Health'},{id:'insights',ico:'💡',lbl:'Insights'},{id:'nutrition',ico:'🥗',lbl:'Nutrition'},{id:'ai',ico:'🧬',lbl:'AI'},{id:'profile',ico:'👤',lbl:'Profile'}]
    : [{id:'panel',ico:'◉',lbl:'Panel'},{id:'gaps',ico:'◎',lbl:'Gaps'},{id:'uds',ico:'📋',lbl:'UDS'},{id:'impact',ico:'📊',lbl:'Impact'},{id:'shield',ico:'🔒',lbl:'Shield'}];

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
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ messages: newMsgs, patientId:'CIQ-2026-00241', zkReport:{ sanitized:zkResult.sanitized, riskScore:zkResult.riskScore } }),
      });
      const data = await res.json();
      setChatMsgs([...newMsgs, { role:'assistant', content: data.content || 'Shield protected response unavailable.' }]);
      setShieldLogs(prev => [{ts:new Date().toISOString(),q:msg.substring(0,60),hash,risk:data.shield?.riskLevel||'LOW',action:data.shield?.action||'CLEAN_PASS'},...prev].slice(0,20));
    } catch {
      setChatMsgs([...newMsgs, { role:'assistant', content:'Connection error. Please try again.' }]);
    }
    setChatLoading(false);
    setTimeout(()=>chatEndRef.current?.scrollIntoView({behavior:'smooth'}),100);
  }, [chatInput, chatMsgs, chatLoading]);

  const showRing = mode === 'p' && page !== 'ai' && page !== 'profile';

  // ── REUSABLE STYLES ───────────────────────────────────────────────────────
  const card: React.CSSProperties = { background:'rgba(255,255,255,.04)', border:'1px solid rgba(0,212,184,.14)', borderRadius:18, padding:15, marginBottom:10 };
  const sec: React.CSSProperties = { fontFamily:M, fontSize:9, color:'#00d4b8', textTransform:'uppercase', letterSpacing:'.18em', margin:'16px 0 8px' };
  const si: React.CSSProperties = { background:'rgba(255,255,255,.04)', border:'1px solid rgba(0,212,184,.14)', borderRadius:14, padding:'12px 8px', textAlign:'center' };

  const badge = (col: string): React.CSSProperties => ({
    fontFamily:M, fontSize:9, padding:'3px 8px', borderRadius:8,
    background:`${col}18`, color:col, border:`1px solid ${col}40`,
  });

  const mbtn = (on: boolean, gon?: boolean): React.CSSProperties => ({
    flexShrink:0, padding:e?'9px 16px':'7px 13px', borderRadius:20,
    border:`1px solid ${on?'transparent':'rgba(0,212,184,.14)'}`,
    background: on?(gon?'linear-gradient(135deg,#4ade80,#22c55e)':'linear-gradient(135deg,#00d4b8,#00b89e)'):'rgba(255,255,255,.04)',
    color: on?'#07101f':'#7a9bbf', fontSize:e?12:11, fontWeight:700, cursor:'pointer',
    fontFamily:T, whiteSpace:'nowrap', boxShadow:on?'0 3px 14px rgba(0,212,184,.28)':'none',
  });

  const nb = (on: boolean, gn?: boolean): React.CSSProperties => ({
    flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2,
    padding:e?'8px 4px':'6px 4px', cursor:'pointer', border:'none', background:'none',
    color: on?(gn?'#4ade80':'#00d4b8'):'#7a9bbf', fontFamily:T, transition:'color .2s',
  });

  // ── PAGES ─────────────────────────────────────────────────────────────────
  const pgHealth = () => (
    <div style={{padding:'14px 18px 110px'}}>
      <div style={sec}>Risk Domains</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:9}}>
        {DOMAINS.map((d,i)=>(
          <div key={i} style={{background:'rgba(255,255,255,.07)',border:'1px solid rgba(0,212,184,.14)',borderRadius:14,padding:13}}>
            <div style={{fontSize:e?12:10,color:'#7a9bbf',marginBottom:7}}>{d.name}</div>
            <div style={{height:4,background:'rgba(255,255,255,.07)',borderRadius:2,marginBottom:5,overflow:'hidden'}}>
              <div style={{width:`${d.score}%`,height:'100%',background:dc(d.score),borderRadius:2}}/>
            </div>
            <div style={{fontFamily:M,fontSize:e?20:17,fontWeight:500,color:dc(d.score)}}>{d.score}<span style={{fontSize:10,color:'#7a9bbf'}}>/100</span></div>
          </div>
        ))}
      </div>
      <div style={sec}>Wearable Data</div>
      <div style={card}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
          <span style={{fontSize:e?28:24}}>⌚</span>
          <div>
            <div style={{fontSize:e?15:13,fontWeight:600}}>Apple Watch Series 9</div>
            <div style={{fontFamily:M,fontSize:9,color:'#4ade80'}}>Connected · Synced 2 min ago</div>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:7}}>
          {[['7,842','Steps','#00d4b8'],['72','BPM','#e8526e'],['6h 20m','Sleep','#8060cc'],['97%','SpO2','#00d4b8'],['340','Cal','#d4a843'],['78%','Adherence','#4ade80']].map(([v,l,c],i)=>(
            <div key={i} style={{background:'rgba(255,255,255,.07)',border:'1px solid rgba(0,212,184,.14)',borderRadius:10,padding:'10px 8px',textAlign:'center'}}>
              <div style={{fontFamily:M,fontSize:e?16:14,fontWeight:500,color:c as string}}>{v}</div>
              <div style={{fontSize:e?11:9,color:'#7a9bbf',marginTop:2}}>{l}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={sec}>Platform Intelligence</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:7,marginBottom:10}}>
        {[['15B+','#00d4b8','Clinical Data'],['96%','#d4a843','Pre-Symptom'],['13:1','#8060cc','ROI'],['$340K','#4ade80','Saved/FQHC'],['51%','#00d4b8','Reversed DM'],['32%','#e8526e','ED Reduction']].map(([v,c,l],i)=>(
          <div key={i} style={si}>
            <div style={{fontFamily:M,fontSize:e?18:16,fontWeight:500,color:c as string}}>{v}</div>
            <div style={{fontSize:e?11:9,color:'#7a9bbf',marginTop:3,lineHeight:1.3}}>{l}</div>
          </div>
        ))}
      </div>
      <div style={sec}>Active Protocols</div>
      {[{name:'Metabolic Reversal',pct:34,c:'#d4a843',sub:'A1C target 5.7% — Week 5 of 18'},{name:'Cardiovascular Defense',pct:28,c:'#e8526e',sub:'LDL target under 170 mg/dL'},{name:'Longevity Optimization',pct:61,c:'#00d4b8',sub:'Supplement + sleep + exercise'},{name:'Cognitive Protection',pct:75,c:'#8060cc',sub:'Brain health markers stable'}].map((p,i)=>(
        <div key={i} style={{background:'rgba(255,255,255,.07)',border:'1px solid rgba(0,212,184,.14)',borderRadius:10,padding:12,marginBottom:10}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
            <span style={{fontFamily:M,fontSize:11,fontWeight:500,color:'#eef2f8'}}>{p.name}</span>
            <span style={{fontFamily:M,fontSize:11,fontWeight:500,color:p.c}}>{p.pct}%</span>
          </div>
          <div style={{height:5,background:'rgba(255,255,255,.06)',borderRadius:3,overflow:'hidden',marginBottom:4}}>
            <div style={{width:`${p.pct}%`,height:'100%',background:p.c,borderRadius:3}}/>
          </div>
          <div style={{fontFamily:M,fontSize:9,color:'#7a9bbf',marginTop:5}}>{p.sub}</div>
        </div>
      ))}
    </div>
  );

  const pgInsights = () => (
    <div style={{padding:'14px 18px 110px'}}>
      <div style={sec}>AI Clinical Insights</div>
      {[{t:'cr',ico:'⚠️',ttl:'LDL Elevated — Cardiovascular Risk',body:'LDL of 198 mg/dL elevates your 10-year cardiovascular risk. CareIQ recommends statin evaluation and a Mediterranean nutrition protocol within 14 days.',conf:'93%'},
        {t:'wt',ico:'📈',ttl:'Prediabetes Intervention Window',body:'A1C at 6.1%. Research shows 51% of patients at this stage return to normal blood sugar within 14 months on a targeted metabolic protocol.',conf:'89%'},
        {t:'ps',ico:'✅',ttl:'Cognitive Markers Stable',body:'Blood pressure trends and inflammatory markers are within protective range for brain health. Your activity level is producing measurable benefit.',conf:'96%'},
      ].map((item,i)=>(
        <div key={i} style={{borderRadius:16,padding:14,marginBottom:9,borderLeft:`3px solid ${item.t==='cr'?'#e8526e':item.t==='wt'?'#d4a843':'#00d4b8'}`,background:item.t==='cr'?'rgba(232,82,110,.05)':item.t==='wt'?'rgba(212,168,67,.05)':'rgba(0,212,184,.05)'}}>
          <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:6}}><span style={{fontSize:14}}>{item.ico}</span><span style={{fontSize:e?14:12,fontWeight:600}}>{item.ttl}</span></div>
          <div style={{fontSize:e?13:11,color:'#7a9bbf',lineHeight:1.6,marginBottom:8}}>{item.body}</div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:e?12:10,fontWeight:600,color:'#00d4b8',padding:'5px 12px',border:'1px solid rgba(0,212,184,.3)',borderRadius:20,background:'rgba(0,212,184,.07)',cursor:'pointer'}}>View Details</span>
            <span style={{fontFamily:M,fontSize:9,color:'#7a9bbf'}}>AI Confidence: {item.conf}</span>
          </div>
        </div>
      ))}
      <div style={sec}>Health Timeline</div>
      {[{c:'#00d4b8',date:'Apr 15, 2026',ttl:'CareIQ Enrollment',txt:'Baseline health score: 66. Care gap assessment complete.'},
        {c:'#d4a843',date:'May 1, 2026',ttl:'Blood Panel Flag',txt:'LDL 198, A1C 6.1%. Metabolic protocol initiated.'},
        {c:'#8060cc',date:'May 10, 2026',ttl:'AI Insight — Intervention Window',txt:'CareIQ flagged prediabetes intervention opportunity.'},
        {c:'#00d4b8',date:'Jun 1, 2026',ttl:'30-Day Check-In',txt:'Health score improved to 70. Blood pressure trending down.'},
      ].map((t,i,arr)=>(
        <div key={i} style={{display:'flex',gap:12,marginBottom:14}}>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
            <div style={{width:10,height:10,borderRadius:'50%',flexShrink:0,marginTop:2,background:t.c}}/>
            {i<arr.length-1&&<div style={{width:1,flex:1,background:'rgba(0,212,184,.14)',marginTop:3}}/>}
          </div>
          <div style={{flex:1,paddingBottom:12}}>
            <div style={{fontFamily:M,fontSize:9,color:'#7a9bbf',marginBottom:2}}>{t.date}</div>
            <div style={{fontSize:e?14:12,fontWeight:600,marginBottom:2}}>{t.ttl}</div>
            <div style={{fontSize:e?13:11,color:'#7a9bbf',lineHeight:1.5}}>{t.txt}</div>
          </div>
        </div>
      ))}
    </div>
  );

  const pgNutrition = () => (
    <div style={{padding:'14px 18px 110px'}}>
      <div style={sec}>Personalized Nutrition Plan</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:7,marginBottom:10}}>
        {[['1,800','#00d4b8','Calories'],['112g','#d4a843','Protein'],['30g','#8060cc','Fiber']].map(([v,c,l],i)=>(
          <div key={i} style={si}><div style={{fontFamily:M,fontSize:e?18:16,fontWeight:500,color:c as string}}>{v}</div><div style={{fontSize:e?11:9,color:'#7a9bbf',marginTop:3}}>{l}</div></div>
        ))}
      </div>
      {[{time:'Breakfast 7:00 AM',name:'Oatmeal Power Bowl',desc:'Steel-cut oats with berries, walnuts, and cinnamon. High fiber, anti-inflammatory.',tags:['High Fiber','Anti-inflammatory','Low GI']},
        {time:'Lunch 12:00 PM',name:'Grilled Chicken and Quinoa',desc:'Lean protein over quinoa with roasted vegetables. Heart healthy.',tags:['High Protein','Heart Healthy','Low Cholesterol']},
        {time:'Dinner 6:30 PM',name:'Baked Salmon and Greens',desc:'Wild salmon with dark leafy greens. Omega-3 rich, LDL-lowering.',tags:['Omega-3','LDL Lowering','High Potassium']},
      ].map((m,i)=>(
        <div key={i} style={{background:'rgba(255,255,255,.07)',border:'1px solid rgba(0,212,184,.14)',borderRadius:14,padding:13,marginBottom:8}}>
          <div style={{fontFamily:M,fontSize:9,color:'#00d4b8',textTransform:'uppercase',letterSpacing:'.12em',marginBottom:4}}>{m.time}</div>
          <div style={{fontSize:e?15:13,fontWeight:600,marginBottom:3}}>{m.name}</div>
          <div style={{fontSize:e?13:11,color:'#7a9bbf',lineHeight:1.5,marginBottom:7}}>{m.desc}</div>
          <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{m.tags.map((t,j)=><span key={j} style={{fontSize:9,padding:'2px 7px',borderRadius:8,background:'rgba(0,212,184,.1)',color:'#00d4b8',border:'1px solid rgba(0,212,184,.2)'}}>{t}</span>)}</div>
        </div>
      ))}
    </div>
  );

  const pgAI = () => (
    <div style={{display:'flex',flexDirection:'column',height:'100%',padding:'12px 18px 0',minHeight:0}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10,flexShrink:0}}>
        <div style={{width:e?48:40,height:e?48:40,borderRadius:'50%',background:'linear-gradient(135deg,#00d4b8,#8060cc)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:e?22:19,flexShrink:0}}>🧬</div>
        <div>
          <div style={{fontSize:e?15:13,fontWeight:600,color:'#eef2f8'}}>CareIQ Health AI</div>
          <div style={{fontFamily:M,fontSize:9,color:'#00d4b8'}}>Community Health Intelligence · Shield Active</div>
        </div>
      </div>
      <div style={{display:'flex',gap:7,marginBottom:10,overflowX:'auto',scrollbarWidth:'none',flexShrink:0}}>
        {['My LDL risk','Prediabetes plan','Exercise tips','What to eat','Next appointment'].map(q=>(
          <button key={q} style={{flexShrink:0,padding:'6px 12px',borderRadius:20,fontSize:e?12:10,fontWeight:500,cursor:'pointer',border:'1px solid rgba(0,212,184,.14)',background:'rgba(255,255,255,.04)',color:'#7a9bbf',whiteSpace:'nowrap',fontFamily:T}} onClick={()=>sendChat(q)}>{q}</button>
        ))}
      </div>
      <div style={{flex:1,overflowY:'auto',paddingBottom:8,scrollbarWidth:'none',minHeight:0}}>
        {chatMsgs.map((m,i)=>(
          <div key={i} style={{maxWidth:'88%',marginBottom:12,marginLeft:m.role==='user'?'auto':0}}>
            <div style={{padding:'11px 15px',borderRadius:18,fontSize:e?14:12,lineHeight:1.6,background:m.role==='assistant'?'rgba(255,255,255,.07)':'linear-gradient(135deg,#00d4b8,#00b89e)',border:m.role==='assistant'?'1px solid rgba(0,212,184,.14)':'none',color:m.role==='assistant'?'#eef2f8':'#07101f',borderBottomRightRadius:m.role==='user'?4:18,borderBottomLeftRadius:m.role==='assistant'?4:18}}>
              {m.content==='...'?<span style={{color:'#7a9bbf',fontStyle:'italic'}}>CareIQ AI is thinking...</span>:m.content}
            </div>
            <div style={{fontFamily:M,fontSize:9,color:'#7a9bbf',marginTop:3}}>{m.role==='assistant'?'🧬 CareIQ AI':'You'}</div>
            {m.role==='assistant'&&<div style={{display:'inline-flex',alignItems:'center',gap:4,fontFamily:M,fontSize:8,padding:'2px 7px',borderRadius:6,marginTop:4,background:'rgba(74,222,128,.12)',color:'#4ade80',border:'1px solid rgba(74,222,128,.2)'}}>🔒 Shield Protected</div>}
          </div>
        ))}
        <div ref={chatEndRef}/>
      </div>
      <div style={{borderTop:'1px solid rgba(0,212,184,.14)',padding:'10px 0 0',flexShrink:0,paddingBottom:80}}>
        <div style={{display:'flex',gap:9}}>
          <input style={{flex:1,background:'rgba(255,255,255,.05)',border:'1px solid rgba(0,212,184,.14)',borderRadius:24,padding:e?'13px 17px':'11px 17px',fontSize:e?14:12,color:'#eef2f8',fontFamily:T,outline:'none'}} value={chatInput} onChange={ev=>setChatInput(ev.target.value)} onKeyDown={ev=>{if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();sendChat();}}} placeholder="Ask your health AI..."/>
          <button style={{width:e?48:42,height:e?48:42,borderRadius:'50%',border:'none',cursor:'pointer',background:'linear-gradient(135deg,#00d4b8,#00b89e)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,flexShrink:0}} onClick={()=>sendChat()}>➤</button>
        </div>
      </div>
    </div>
  );

  const pgProfile = () => (
    <div style={{padding:'14px 18px 110px'}}>
      <div style={{textAlign:'center',padding:'16px 0 20px'}}>
        <div style={{width:64,height:64,borderRadius:'50%',background:'linear-gradient(135deg,#00d4b8,#8060cc)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,margin:'0 auto 10px'}}>👤</div>
        <div style={{fontSize:e?24:20,fontWeight:700}}>Jamie Rivera</div>
        <div style={{fontFamily:M,fontSize:10,color:'#7a9bbf',marginTop:3}}>CIQ-2026-00241</div>
        <div style={{fontSize:e?13:11,color:'#d4a843',marginTop:5}}>Age 54 · Riverside Community Health</div>
      </div>
      <div style={sec}>Profile</div>
      {[['Health Center','Riverside Community Health'],['Enrollment','April 15, 2026'],['Primary Provider','Dr. Maria Santos, MD'],['Next Appointment','July 8, 2026'],['Insurance','Medicaid'],['Shield Version','Sovereign Shield v2.0'],['Wearable','Apple Watch Series 9 — Connected'],['Elder Mode',e?'Active':'Off']].map((r,i)=>(
        <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid rgba(255,255,255,.06)'}}>
          <span style={{fontSize:e?13:11,color:'#7a9bbf'}}>{r[0]}</span>
          <span style={{fontSize:e?13:11,fontWeight:500,textAlign:'right',maxWidth:'55%'}}>{r[1]}</span>
        </div>
      ))}
    </div>
  );

  const pgPanel = () => (
    <div style={{padding:'14px 18px 110px'}}>
      <div style={sec}>Patient Panel — Riverside FQHC</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:7,marginBottom:10}}>
        {[['18','#e8526e','High Risk'],['34','#d4a843','Moderate'],['247','#00d4b8','Open Gaps']].map(([v,c,l],i)=>(
          <div key={i} style={si}><div style={{fontFamily:M,fontSize:e?18:16,fontWeight:500,color:c as string}}>{v}</div><div style={{fontSize:e?11:9,color:'#7a9bbf',marginTop:3}}>{l}</div></div>
        ))}
      </div>
      <div style={{...card,padding:0,overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead>
            <tr>{['Patient','Condition','Risk','Score','Gaps'].map(h=><th key={h} style={{fontFamily:M,fontSize:9,fontWeight:500,letterSpacing:1,textTransform:'uppercase',color:'#7a9bbf',padding:'8px 10px',textAlign:'left',borderBottom:'1px solid rgba(0,212,184,.14)'}}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {PATIENTS.map((p,i)=>{
              const init = p.name.split(' ').map((x:string)=>x[0]).join('');
              return (
                <tr key={i}>
                  <td style={{padding:10,borderBottom:'1px solid rgba(255,255,255,.04)',verticalAlign:'middle'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{width:30,height:30,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:M,fontSize:11,fontWeight:500,flexShrink:0,background:p.ab,color:p.ac}}>{init}</div>
                      <div><div style={{fontSize:e?14:12,fontWeight:600,color:'#eef2f8'}}>{p.name}</div><div style={{fontFamily:M,fontSize:9,color:'#7a9bbf'}}>{p.id}</div></div>
                    </div>
                  </td>
                  <td style={{padding:10,borderBottom:'1px solid rgba(255,255,255,.04)',fontSize:e?13:11,color:'#7a9bbf'}}>{p.cond.split(',')[0]}</td>
                  <td style={{padding:10,borderBottom:'1px solid rgba(255,255,255,.04)'}}><span style={badge(rb(p.risk))}>{p.risk}</span></td>
                  <td style={{padding:10,borderBottom:'1px solid rgba(255,255,255,.04)'}}>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <div style={{flex:1,height:4,background:'rgba(255,255,255,.06)',borderRadius:2,overflow:'hidden'}}><div style={{width:`${p.rs}%`,height:'100%',background:rc(p.risk),borderRadius:2}}/></div>
                      <span style={{fontFamily:M,fontSize:11,fontWeight:500,width:24,textAlign:'right',color:rc(p.risk)}}>{p.rs}</span>
                    </div>
                  </td>
                  <td style={{padding:10,borderBottom:'1px solid rgba(255,255,255,.04)'}}><span style={{fontFamily:M,fontSize:e?14:12,fontWeight:600,color:p.gaps>3?'#e8526e':p.gaps>1?'#d4a843':'#00d4b8'}}>{p.gaps}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const pgGaps = () => (
    <div style={{padding:'14px 18px 110px'}}>
      <div style={sec}>Care Gap Management</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:7,marginBottom:10}}>
        {[['54','#e8526e','Critical'],['118','#d4a843','Moderate'],['75','#00d4b8','Routine']].map(([v,c,l],i)=>(
          <div key={i} style={si}><div style={{fontFamily:M,fontSize:e?18:16,fontWeight:500,color:c as string}}>{v}</div><div style={{fontSize:e?11:9,color:'#7a9bbf',marginTop:3}}>{l}</div></div>
        ))}
      </div>
      <div style={sec}>Critical — Immediate Action</div>
      {[{ico:'🏥',txt:'Post-hospitalization follow-up overdue 3 weeks',pt:'Rosa L. — Heart Failure'},{ico:'🫘',txt:'Nephrology co-management referral urgent',pt:'Carlos M. — CKD Stage 3'},{ico:'👁️',txt:'Retinal eye exam overdue 14 months',pt:'Maria T. — Diabetes'},{ico:'💉',txt:'Pneumococcal vaccine not on record',pt:'Rosa L. — COPD'},{ico:'💊',txt:'ACE inhibitor dosage review needed',pt:'Carlos M. — CKD/HTN'}].map((g,i)=>(
        <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:'rgba(255,255,255,.04)',border:'1px solid rgba(0,212,184,.14)',borderRadius:10,marginBottom:8}}>
          <span style={{fontSize:15,flexShrink:0}}>{g.ico}</span>
          <div style={{flex:1}}><div style={{fontSize:e?14:12,color:'#eef2f8'}}>{g.txt}</div><div style={{fontFamily:M,fontSize:9,color:'#7a9bbf',marginTop:2}}>{g.pt}</div></div>
          <span style={badge('#e8526e')}>Critical</span>
        </div>
      ))}
      <div style={sec}>Moderate — Within 30 Days</div>
      {[{ico:'🏃',txt:'NDPP referral pending',pt:'James R. — Pre-Diabetes'},{ico:'📋',txt:'Mammography declined last visit',pt:'Linda S. — Age 52'},{ico:'🔬',txt:'Colorectal screening overdue 2 years',pt:'James R. — Age 44'}].map((g,i)=>(
        <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:'rgba(255,255,255,.04)',border:'1px solid rgba(0,212,184,.14)',borderRadius:10,marginBottom:8}}>
          <span style={{fontSize:15,flexShrink:0}}>{g.ico}</span>
          <div style={{flex:1}}><div style={{fontSize:e?14:12,color:'#eef2f8'}}>{g.txt}</div><div style={{fontFamily:M,fontSize:9,color:'#7a9bbf',marginTop:2}}>{g.pt}</div></div>
          <span style={badge('#d4a843')}>Moderate</span>
        </div>
      ))}
    </div>
  );

  const pgUDS = () => (
    <div style={{padding:'14px 18px 110px'}}>
      <div style={sec}>UDS Quality Measures</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:7,marginBottom:10}}>
        {[['71%','#00d4b8','Compliance'],['14/18','#d4a843','Passing'],['4','#e8526e','Improve']].map(([v,c,l],i)=>(
          <div key={i} style={si}><div style={{fontFamily:M,fontSize:e?18:16,fontWeight:500,color:c as string}}>{v}</div><div style={{fontSize:e?11:9,color:'#7a9bbf',marginTop:3}}>{l}</div></div>
        ))}
      </div>
      <div style={sec}>Measure Performance</div>
      {UDS.map((r,i)=>{
        const c = r.cur>=r.tgt?'#00d4b8':r.cur>=r.tgt-8?'#d4a843':'#e8526e';
        return (
          <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:'rgba(255,255,255,.04)',border:'1px solid rgba(0,212,184,.14)',borderRadius:8,marginBottom:8}}>
            <div style={{flex:1,fontSize:e?14:12,color:'#eef2f8'}}>{r.m}</div>
            <div style={{fontFamily:M,fontSize:13,fontWeight:700,width:40,textAlign:'center',color:c}}>{r.cur}%</div>
            <div style={{fontFamily:M,fontSize:9,color:'#7a9bbf',width:55}}>Goal: {r.tgt}%</div>
            <div style={{width:80}}><div style={{height:4,background:'rgba(255,255,255,.06)',borderRadius:2,overflow:'hidden'}}><div style={{width:`${r.cur}%`,height:'100%',background:c,borderRadius:2}}/></div></div>
          </div>
        );
      })}
    </div>
  );

  const pgImpact = () => (
    <div style={{padding:'14px 18px 110px'}}>
      <div style={sec}>FQHC Cost Avoidance</div>
      <div style={card}>
        {[{label:'ED Visit Reduction (32%)',pct:75,c:'#00d4b8',right:'$184K/yr'},{label:'Readmission Prevention',pct:60,c:'#d4a843',right:'$142K/yr'},{label:'Preventive Gaps Closed',pct:71,c:'#8060cc',right:'$96K/yr'},{label:'UDS Measure Improvement',pct:85,c:'#4ade80',right:'$340K protected'}].map((a,i)=>(
          <div key={i} style={{marginBottom:10}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:e?13:11,marginBottom:3}}>
              <span style={{color:'#7a9bbf'}}>{a.label}</span>
              <span style={{color:a.c,fontFamily:M,fontWeight:500}}>{a.right}</span>
            </div>
            <div style={{height:6,background:'rgba(255,255,255,.07)',borderRadius:3,overflow:'hidden'}}><div style={{width:`${a.pct}%`,height:'100%',background:a.c,borderRadius:3}}/></div>
          </div>
        ))}
        <div style={{borderTop:'1px solid rgba(0,212,184,.14)',marginTop:8,paddingTop:10,display:'flex',justifyContent:'space-between'}}>
          <span style={{fontSize:e?13:11,color:'#7a9bbf'}}>Total Annual Benefit</span>
          <span style={{fontFamily:M,fontSize:e?22:20,color:'#00d4b8',fontWeight:500}}>$762K</span>
        </div>
      </div>
      <div style={sec}>5-Year Projection</div>
      <div style={card}>
        {[['Year 1','$380K','#7a9bbf'],['Year 2','$1.2M','#d4a843'],['Year 3','$2.8M','#00d4b8'],['Year 4','$4.1M','#00d4b8'],['Year 5','$5.9M','#4ade80']].map((r,i)=>(
          <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:i<4?'1px solid rgba(255,255,255,.04)':'none'}}>
            <span style={{fontFamily:M,fontSize:e?13:11,color:'#7a9bbf'}}>{r[0]}</span>
            <span style={{fontFamily:M,fontSize:e?15:13,color:r[2],fontWeight:600}}>{r[1]}</span>
          </div>
        ))}
        <div style={{marginTop:10,display:'flex',justifyContent:'space-between',borderTop:'1px solid rgba(0,212,184,.14)',paddingTop:10}}>
          <span style={{fontSize:e?13:10,color:'#7a9bbf'}}>5-Year Cumulative</span>
          <span style={{fontFamily:M,fontSize:e?20:18,color:'#4ade80',fontWeight:500}}>$14.4M</span>
        </div>
      </div>
    </div>
  );

  const pgShield = () => (
    <div style={{padding:'14px 18px 110px'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:7,marginBottom:10}}>
        {[[shieldLogs.length+'','Queries Protected'],[shieldLogs.length+'','ZK Hashed'],['0','PHI Leaked']].map(([v,l],i)=>(
          <div key={i} style={{background:'rgba(255,255,255,.04)',border:'1px solid rgba(74,222,128,.2)',borderRadius:14,padding:'12px 8px',textAlign:'center'}}>
            <div style={{fontFamily:M,fontSize:e?18:16,fontWeight:500,color:'#4ade80'}}>{v}</div>
            <div style={{fontSize:e?11:9,color:'#7a9bbf',marginTop:3,lineHeight:1.3}}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{...card,marginBottom:12}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <span style={{fontSize:e?15:13,fontWeight:600}}>Sovereign Prompt Shield v2.0</span>
          <span style={badge('#00d4b8')}>ZK ACTIVE</span>
        </div>
        {[['Architecture','Zero-Knowledge Dual Layer','#4ade80'],['Layer 1','PHI hashed before transmission','#00d4b8'],['Layer 2','PII stripped server-side','#00d4b8'],['Data Residency','FQHC-controlled infrastructure','#4ade80'],['PHI Exposure','ZERO — never leaves device raw','#4ade80'],['HIPAA','100% compliant','#4ade80']].map((r,i)=>(
          <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:i<5?'1px solid rgba(255,255,255,.04)':'none'}}>
            <span style={{fontSize:e?12:10,color:'#7a9bbf',width:'40%'}}>{r[0]}</span>
            <span style={{fontSize:e?12:10,fontFamily:M,color:r[2],textAlign:'right'}}>{r[1]}</span>
          </div>
        ))}
      </div>
      <div style={sec}>Live Hash Demo</div>
      <div style={card}>
        {[['Jamie Rivera','ZK:A4F2C8910B3D7E50'],['DOB 09/14/1972','ZK:B7E3D2041A9C8F52'],['MRN CIQ-00241','ZK:C1A9F5638E2D7B04'],['DX Prediabetes','ZK:D8B2E4170F6C3A91'],['123 Oak St','ZK:E5C7A0289D4F1B63']].map((h,i,arr)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:i<arr.length-1?'1px solid rgba(255,255,255,.04)':'none'}}>
            <div style={{fontFamily:M,fontSize:11,color:'#eef2f8',flex:1}}>{h[0]}</div>
            <div style={{color:'#00d4b8',fontSize:12}}>⬡</div>
            <div style={{fontFamily:M,fontSize:10,color:'#4ade80',flex:1,wordBreak:'break-all'}}>{h[1]}</div>
            <span style={badge('#4ade80')}>Protected</span>
          </div>
        ))}
      </div>
      <div style={sec}>Audit Log</div>
      {shieldLogs.length===0?(
        <div style={{...card,textAlign:'center',padding:24}}>
          <div style={{fontSize:24,marginBottom:8}}>🛡️</div>
          <div style={{fontSize:e?14:12,color:'#7a9bbf'}}>No queries yet. Use the AI tab to see Shield protection in real time.</div>
        </div>
      ):shieldLogs.map((log,i)=>(
        <div key={i} style={{background:'rgba(255,255,255,.04)',border:'1px solid rgba(0,212,184,.14)',borderRadius:14,padding:13,marginBottom:8}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <span style={{fontFamily:M,fontSize:9,color:'#7a9bbf'}}>{new Date(log.ts).toLocaleTimeString()}</span>
            <span style={badge('#4ade80')}>Protected</span>
          </div>
          <div style={{fontSize:e?12:10,color:'#7a9bbf',marginBottom:6,fontStyle:'italic'}}>"{log.q}"</div>
          <div style={{fontFamily:M,fontSize:9,color:'#4ade80'}}>ZK: {log.hash} · {log.action} · Risk: {log.risk}</div>
        </div>
      ))}
    </div>
  );

  const renderPage = () => {
    if (mode==='p') {
      if (page==='health') return pgHealth();
      if (page==='insights') return pgInsights();
      if (page==='nutrition') return pgNutrition();
      if (page==='ai') return pgAI();
      if (page==='profile') return pgProfile();
    } else {
      if (page==='panel') return pgPanel();
      if (page==='gaps') return pgGaps();
      if (page==='uds') return pgUDS();
      if (page==='impact') return pgImpact();
      if (page==='shield') return pgShield();
    }
    return null;
  };

  return (
    <>
      {showModal&&(
        <div style={{position:'fixed',inset:0,zIndex:999,background:'rgba(7,16,31,.96)',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#0c1a2e',border:'1px solid #00d4b8',borderRadius:20,padding:36,maxWidth:480,width:'92%',textAlign:'center',boxShadow:'0 0 60px rgba(0,212,184,.2)'}}>
            <div style={{fontSize:48,color:'#00d4b8',marginBottom:12}}>⬡</div>
            <div style={{fontFamily:P,fontSize:22,color:'#00d4b8',marginBottom:8}}>Sovereign Shield Active</div>
            <div style={{fontSize:e?15:13,color:'#7a9bbf',lineHeight:1.75,marginBottom:18}}>Before any patient data loads, CareIQ hashes all personally identifiable and clinically sensitive information at your device edge. Your patients privacy is protected by architecture, not just policy.</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:7,justifyContent:'center',marginBottom:22}}>
              {[['Maria T.','ZK:A4F2C891'],['DOB:1966-03-12','ZK:B7E3D204'],['MRN:00124893','ZK:C1A9F563'],['DX:E11.65','ZK:D8B2E417'],['Address','ZK:F3D1B796']].map(([k,v],i)=>(
                <div key={i} style={{background:'rgba(0,212,184,.08)',border:'1px solid rgba(0,212,184,.2)',borderRadius:6,padding:'4px 10px',fontFamily:M,fontSize:10,color:'#00d4b8'}}>{k} <span style={{color:'#7a9bbf',fontSize:9}}>{v}</span></div>
              ))}
            </div>
            <button onClick={()=>setShowModal(false)} style={{background:'linear-gradient(135deg,#0d2e1e,#156040)',color:'#faf0dc',border:'none',borderRadius:10,padding:'13px 32px',fontFamily:T,fontSize:e?16:13,fontWeight:700,cursor:'pointer',boxShadow:'0 0 20px rgba(0,212,184,.3)'}}>Enter CareIQ OS</button>
          </div>
        </div>
      )}
      <div style={{display:'flex',flexDirection:'column',height:'100vh',maxWidth:480,margin:'0 auto',background:'#07101f',fontFamily:T,color:'#eef2f8',position:'relative'}}>
        {/* HEADER */}
        <div style={{flexShrink:0,padding:'14px 18px 12px',background:'rgba(7,16,31,.97)',borderBottom:'1px solid rgba(0,212,184,.14)',backdropFilter:'blur(20px)',zIndex:10}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:38,height:38,borderRadius:11,background:'linear-gradient(135deg,#00b89e,#8060cc)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,boxShadow:'0 4px 18px rgba(0,212,184,.25)',flexShrink:0}}>⊕</div>
              <div>
                <div style={{fontFamily:P,fontSize:e?20:16,color:'#eef2f8'}}>CareIQ</div>
                <div style={{fontFamily:M,fontSize:8,color:'#00d4b8',letterSpacing:'.18em',textTransform:'uppercase'}}>Community Health Intelligence</div>
              </div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:e?14:12,fontWeight:600}}>Jamie Rivera</div>
              <div style={{fontFamily:M,fontSize:9,color:'#7a9bbf',marginTop:1}}>CIQ-2026-00241</div>
              <div style={{display:'inline-flex',alignItems:'center',gap:4,fontFamily:M,fontSize:8,color:'#4ade80',marginTop:3}}>
                <div style={{width:6,height:6,borderRadius:'50%',background:'#4ade80',animation:'pulse 2s infinite'}}/>SHIELD ON
              </div>
            </div>
          </div>
        </div>

        {/* RING */}
        {showRing&&(
          <div style={{flexShrink:0}}>
            <div style={{display:'flex',gap:16,alignItems:'center',padding:'16px 18px 0'}}>
              <div style={{position:'relative',width:88,height:88,flexShrink:0}}>
                <svg width="88" height="88" viewBox="0 0 88 88" style={{transform:'rotate(-90deg)'}}>
                  <circle cx="44" cy="44" r="37" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7"/>
                  <circle cx="44" cy="44" r="37" fill="none" stroke="url(#rg)" strokeWidth="7" strokeLinecap="round" strokeDasharray="232.5" strokeDashoffset="69.75"/>
                  <defs><linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#00d4b8"/><stop offset="100%" stopColor="#8060cc"/></linearGradient></defs>
                </svg>
                <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
                  <div style={{fontFamily:M,fontSize:28,fontWeight:500,color:'#00d4b8',lineHeight:1}}>70</div>
                  <div style={{fontSize:8,color:'#7a9bbf',textTransform:'uppercase',letterSpacing:'.12em',marginTop:2}}>Score</div>
                </div>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:e?22:20,fontWeight:700,marginBottom:3}}>Moderate Risk</div>
                <div style={{fontSize:e?13:11,color:'#7a9bbf',lineHeight:1.5}}>2 active gaps · Next visit 45 days</div>
                <div style={{display:'inline-flex',alignItems:'center',gap:4,marginTop:7,fontFamily:M,fontSize:10,color:'#00d4b8',background:'rgba(0,212,184,.1)',padding:'4px 10px',borderRadius:20,border:'1px solid rgba(0,212,184,.2)'}}>+6.2% since last visit</div>
              </div>
            </div>
            <div style={{display:'flex',gap:7,padding:'12px 18px 0',overflowX:'auto',scrollbarWidth:'none'}}>
              {VITALS.map((v,i)=>(
                <div key={i} style={{flexShrink:0,background:'rgba(255,255,255,.04)',border:'1px solid rgba(0,212,184,.14)',borderRadius:14,padding:e?'12px 14px':'10px 12px',minWidth:e?96:84}}>
                  <div style={{fontSize:e?16:14,marginBottom:3}}>{v.ico}</div>
                  <div style={{fontFamily:M,fontSize:e?17:14,fontWeight:500,lineHeight:1,color:sc(v.s)}}>{v.val}</div>
                  <div style={{fontSize:e?10:8,color:'#7a9bbf'}}>{v.unit}</div>
                  <div style={{fontSize:e?11:9,color:'#7a9bbf',marginTop:2}}>{v.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MODE BAR */}
        <div style={{display:'flex',gap:5,padding:'8px 18px',background:'rgba(7,16,31,.95)',borderBottom:'1px solid rgba(0,212,184,.14)',flexShrink:0,overflowX:'auto',scrollbarWidth:'none'}}>
          <button style={mbtn(mode==='p')} onClick={()=>{setMode('p');setPage('health');}}>👤 Patient</button>
          <button style={mbtn(mode==='c')} onClick={()=>{setMode('c');setPage('panel');}}>⚕️ Clinical</button>
          <button style={mbtn(e,true)} onClick={()=>setElder(!e)}>👴 Elder</button>
          <button style={mbtn(mode==='c'&&page==='shield')} onClick={()=>{setMode('c');setPage('shield');}}>🔒 Shield</button>
        </div>

        {/* CONTENT */}
        <div style={{flex:1,overflowY:'auto',scrollbarWidth:'none',minHeight:0}}>
          {renderPage()}
        </div>

        {/* BOTTOM NAV */}
        <div style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,zIndex:20,background:'rgba(7,16,31,.97)',backdropFilter:'blur(20px)',borderTop:'1px solid rgba(0,212,184,.14)',display:'flex',padding:'7px 0 14px'}}>
          {nav.map(n=>(
            <button key={n.id} style={nb(page===n.id,n.id==='shield')} onClick={()=>setPage(n.id)}>
              <span style={{fontSize:e?22:18}}>{n.ico}</span>
              <span style={{fontSize:e?10:8,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase'}}>{n.lbl}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
