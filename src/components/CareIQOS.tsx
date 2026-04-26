import { useState, useEffect, useRef } from "react";

const C = {
  bg: "#070d18",
  surface: "#0d1626",
  card: "#111e30",
  border: "#1a2d47",
  borderSoft: "#142038",
  accent: "#00d4a8",
  accentDim: "#00d4a818",
  accentGlow: "#00d4a840",
  blue: "#3b8ef5",
  blueDim: "#3b8ef518",
  amber: "#f0a500",
  amberDim: "#f0a50018",
  red: "#f04f4f",
  redDim: "#f04f4f18",
  purple: "#9b87f5",
  purpleDim: "#9b87f518",
  tp: "#eef2ff",
  ts: "#7a8faa",
  tm: "#374a63",
};

const PATIENTS = [
  { id: 1, name: "Maria Santos", age: 67, risk: "high", dx: "T2DM, HTN, CKD Stage 3", lastSeen: "Today", alerts: 3, wearable: true, hr: 88, spo2: 94, glucose: 187, bp: "148/92" },
  { id: 2, name: "James Whitehorse", age: 54, risk: "moderate", dx: "HTN, Obesity", lastSeen: "2 days ago", alerts: 1, wearable: true, hr: 74, spo2: 97, glucose: 112, bp: "132/84" },
  { id: 3, name: "Dorothy Chen", age: 71, risk: "high", dx: "CHF, A-Fib, T2DM", lastSeen: "Today", alerts: 5, wearable: true, hr: 96, spo2: 92, glucose: 204, bp: "158/98" },
  { id: 4, name: "Robert Tran", age: 43, risk: "low", dx: "Pre-HTN, Anxiety", lastSeen: "1 week ago", alerts: 0, wearable: false, hr: 68, spo2: 99, glucose: 95, bp: "122/78" },
  { id: 5, name: "Linda Begay", age: 59, risk: "moderate", dx: "T2DM, Depression", lastSeen: "3 days ago", alerts: 2, wearable: true, hr: 79, spo2: 96, glucose: 143, bp: "128/82" },
];

const WEARABLE_DEVICES = [
  { id: "W001", patient: "Maria Santos", device: "Dexcom G7 + Apple Watch Series 9", battery: 72, signal: "strong", lastSync: "12s ago", status: "active" },
  { id: "W002", patient: "James Whitehorse", device: "Omron HeartGuide + Fitbit Sense 2", battery: 45, signal: "moderate", lastSync: "1m ago", status: "active" },
  { id: "W003", patient: "Dorothy Chen", device: "AliveCor KardiaMobile + Galaxy Watch 6", battery: 18, signal: "strong", lastSync: "8s ago", status: "warning" },
  { id: "W004", patient: "Linda Begay", device: "Libre 3 + Garmin Venu 3", battery: 91, signal: "strong", lastSync: "22s ago", status: "active" },
];

function useWearableStream() {
  const [vitals, setVitals] = useState({
    heartRate: 72, spo2: 97, systolic: 118, diastolic: 76,
    glucose: 104, steps: 6240, hrv: 44, temp: 98.4,
    calories: 1840, sleep: 6.8, stress: 32,
  });
  const [history, setHistory] = useState({
    heartRate: [70, 72, 71, 74, 73, 72, 75, 72, 71, 73, 72],
    spo2: [97, 98, 97, 98, 98, 97, 97, 98, 97, 97, 98],
    glucose: [98, 101, 104, 107, 104, 102, 104, 106, 104, 103, 104],
  });

  useEffect(() => {
    const iv = setInterval(() => {
      setVitals(p => {
        const hr = Math.max(58, Math.min(92, p.heartRate + (Math.random() - 0.5) * 3));
        const sp = Math.max(95, Math.min(100, p.spo2 + (Math.random() - 0.5) * 0.6));
        const gl = Math.max(80, Math.min(130, p.glucose + (Math.random() - 0.5) * 2.5));
        setHistory(h => ({
          heartRate: [...h.heartRate.slice(-10), hr],
          spo2: [...h.spo2.slice(-10), sp],
          glucose: [...h.glucose.slice(-10), gl],
        }));
        return {
          ...p, heartRate: hr, spo2: sp, glucose: gl,
          systolic: Math.max(108, Math.min(138, p.systolic + (Math.random() - 0.5) * 2)),
          diastolic: Math.max(68, Math.min(88, p.diastolic + (Math.random() - 0.5) * 1.5)),
          hrv: Math.max(30, Math.min(60, p.hrv + (Math.random() - 0.5) * 2)),
          temp: Math.max(97.8, Math.min(99.2, p.temp + (Math.random() - 0.5) * 0.08)),
          steps: p.steps + Math.floor(Math.random() * 8),
          stress: Math.max(10, Math.min(80, p.stress + (Math.random() - 0.5) * 4)),
        };
      });
    }, 2400);
    return () => clearInterval(iv);
  }, []);

  return { vitals, history };
}

function PulseDot({ color = C.accent, size = 7 }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: size * 3, height: size * 3 }}>
      <span style={{ position: "absolute", width: size * 2.8, height: size * 2.8, borderRadius: "50%", background: color, opacity: 0, animation: "pr 2s ease-out infinite" }} />
      <span style={{ width: size, height: size, borderRadius: "50%", background: color, display: "block" }} />
    </span>
  );
}

function Sparkline({ data, color, w = 80, h = 26 }) {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - mn) / rng) * (h - 2) - 1}`).join(" ");
  const area = `${pts} ${w},${h} 0,${h}`;
  const uid = `sp${color.replace(/#/g, "")}${Math.round(Math.random()*1000)}`;
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${uid})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RadialArc({ value, min, max, color, size = 64, unit, label }) {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const arc = circ * 0.75;
  const fill = arc * pct;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(135deg)", position: "absolute" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={6}
            strokeDasharray={`${arc} ${circ - arc}`} strokeLinecap="round" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6}
            strokeDasharray={`${fill} ${circ - fill}`} strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${color})`, transition: "stroke-dasharray 0.7s ease" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 500, color: C.tp, lineHeight: 1 }}>
            {typeof value === "number" ? value.toFixed(value < 10 ? 1 : 0) : value}
          </span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: C.ts }}>{unit}</span>
        </div>
      </div>
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.tm, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 2 }}>{label}</span>
    </div>
  );
}

function StatBadge({ label, value, unit, color, spark, pulse }) {
  const statusColor = pulse === "critical" ? C.red : pulse === "warning" ? C.amber : pulse === "elevated" ? C.amber : C.accent;
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
      padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: 0, left: 16, right: 16, height: 1.5, background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.13em" }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <PulseDot color={statusColor} size={5} />
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: statusColor, textTransform: "uppercase" }}>{pulse || "normal"}</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 30, fontWeight: 400, color: C.tp, lineHeight: 1 }}>
            {typeof value === "number" ? value.toFixed(value < 10 ? 1 : 0) : value}
          </span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: C.ts, marginLeft: 4 }}>{unit}</span>
        </div>
        {spark && <Sparkline data={spark} color={color} w={72} h={26} />}
      </div>
    </div>
  );
}

function NavTab({ label, icon, active, onClick, badge }) {
  return (
    <button onClick={onClick} style={{
      background: active ? C.accentDim : "transparent",
      border: "none",
      borderBottom: active ? `2px solid ${C.accent}` : "2px solid transparent",
      cursor: "pointer",
      display: "flex", alignItems: "center", gap: 7, padding: "8px 14px",
      borderRadius: "10px 10px 0 0", transition: "all 0.2s", position: "relative",
    }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: active ? 700 : 500, color: active ? C.accent : C.ts, letterSpacing: "0.04em" }}>{label}</span>
      {badge > 0 && (
        <span style={{ position: "absolute", top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, background: C.red, fontFamily: "'DM Mono', monospace", fontSize: 9, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{badge}</span>
      )}
    </button>
  );
}

// HOME TAB
function HomeTab({ vitals, history }) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const tiles = [
    { label: "Heart Rate", value: vitals.heartRate, unit: "bpm", color: C.red, spark: history.heartRate, pulse: vitals.heartRate > 85 ? "elevated" : "normal" },
    { label: "SpO₂", value: vitals.spo2, unit: "%", color: C.blue, spark: history.spo2, pulse: vitals.spo2 < 96 ? "warning" : "normal" },
    { label: "Blood Glucose", value: vitals.glucose, unit: "mg/dL", color: C.amber, spark: history.glucose, pulse: vitals.glucose > 125 ? "elevated" : "normal" },
    { label: "Blood Pressure", value: `${Math.round(vitals.systolic)}/${Math.round(vitals.diastolic)}`, unit: "mmHg", color: C.purple, pulse: vitals.systolic > 130 ? "warning" : "normal" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{
        background: `linear-gradient(120deg, ${C.accentDim}, ${C.blueDim})`,
        border: `1px solid ${C.accentGlow}`,
        borderRadius: 14, padding: "14px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>⌚</span>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: C.accent }}>Live Wearable Feed</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.ts }}>4 devices streaming · last sync {timeStr}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PulseDot color={C.accent} size={6} />
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.accent, textTransform: "uppercase", letterSpacing: "0.1em" }}>All Systems Active</span>
        </div>
      </div>

      <div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 10 }}>Real-Time Wearable Vitals</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {tiles.map(t => <StatBadge key={t.label} {...t} />)}
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "18px 20px", display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 14 }}>Continuous Monitoring</div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <RadialArc value={vitals.hrv} min={20} max={80} color={C.purple} size={68} unit="ms" label="HRV" />
            <RadialArc value={vitals.temp} min={97} max={100.5} color={C.amber} size={68} unit="°F" label="Temp" />
            <RadialArc value={vitals.stress} min={0} max={100} color={C.red} size={68} unit="idx" label="Stress" />
            <RadialArc value={vitals.sleep} min={0} max={9} color={C.blue} size={68} unit="hrs" label="Sleep" />
          </div>
        </div>
        <div style={{ borderLeft: `1px solid ${C.border}`, paddingLeft: 28, display: "flex", flexDirection: "column", gap: 10, minWidth: 160 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.14em" }}>Activity</div>
          <div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 28, color: C.tp }}>{vitals.steps.toLocaleString()}</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.ts }}>steps today</div>
            <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: C.border, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, (vitals.steps / 10000) * 100)}%`, background: `linear-gradient(90deg, ${C.accent}, ${C.blue})`, borderRadius: 2, transition: "width 0.6s ease" }} />
            </div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.tm, marginTop: 3 }}>Goal: 10,000</div>
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: C.amber }}>{vitals.calories.toLocaleString()} kcal</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 18px" }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 12 }}>Active Alerts</div>
          {[
            { patient: "Dorothy Chen", msg: "SpO₂ 92% — critical low", color: C.red },
            { patient: "Maria Santos", msg: "Glucose 187 mg/dL — elevated", color: C.amber },
            { patient: "Linda Begay", msg: "Missed evening check-in", color: C.purple },
          ].map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
              <div style={{ width: 3, minHeight: 32, borderRadius: 2, background: a.color, marginTop: 2, flexShrink: 0 }} />
              <div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600, color: C.tp }}>{a.patient}</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.ts }}>{a.msg}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 18px" }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 12 }}>Risk Distribution</div>
          {[
            { label: "High Risk", count: 2, total: 5, color: C.red },
            { label: "Moderate", count: 2, total: 5, color: C.amber },
            { label: "Low Risk", count: 1, total: 5, color: C.accent },
          ].map(r => (
            <div key={r.label} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.ts }}>{r.label}</span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: r.color }}>{r.count}/{r.total}</span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: C.border }}>
                <div style={{ height: "100%", width: `${(r.count / r.total) * 100}%`, background: r.color, borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// PATIENTS TAB
function PatientsTab() {
  const [selected, setSelected] = useState(PATIENTS[0]);
  const riskColor = (r) => r === "high" ? C.red : r === "moderate" ? C.amber : C.accent;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, minHeight: 500 }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.13em", padding: "6px 8px" }}>Panel — {PATIENTS.length} Patients</div>
        {PATIENTS.map(p => {
          const rc = riskColor(p.risk);
          const isSel = selected?.id === p.id;
          return (
            <div key={p.id} onClick={() => setSelected(p)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
              borderRadius: 10, cursor: "pointer",
              background: isSel ? C.accentDim : "transparent",
              border: `1px solid ${isSel ? C.accentGlow : "transparent"}`,
              transition: "all 0.18s",
            }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: `${rc}22`, border: `1.5px solid ${rc}66`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 800, color: rc, flexShrink: 0 }}>
                {p.name.split(" ").map(n => n[0]).join("")}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 600, color: C.tp, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.ts }}>{p.age}y · {p.risk} risk</div>
              </div>
              {p.alerts > 0 && (
                <span style={{ minWidth: 18, height: 18, borderRadius: 9, background: C.red, fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{p.alerts}</span>
              )}
            </div>
          );
        })}
      </div>

      {selected && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800, color: C.tp }}>{selected.name}</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.ts }}>Age {selected.age} · MRN #{1000 + selected.id} · {selected.lastSeen}</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.tm, marginTop: 4 }}>{selected.dx}</div>
            </div>
            <span style={{ padding: "4px 12px", borderRadius: 20, background: `${riskColor(selected.risk)}22`, border: `1px solid ${riskColor(selected.risk)}55`, fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, color: riskColor(selected.risk), textTransform: "uppercase", letterSpacing: "0.1em" }}>{selected.risk} risk</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
            {[
              { label: "Heart Rate", value: selected.hr, unit: "bpm", color: C.red },
              { label: "SpO₂", value: selected.spo2, unit: "%", color: C.blue },
              { label: "Glucose", value: selected.glucose, unit: "mg/dL", color: C.amber },
              { label: "Blood Pressure", value: selected.bp, unit: "mmHg", color: C.purple },
            ].map(m => (
              <div key={m.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 9, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>{m.label}</div>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 20, color: C.tp }}>{m.value}</span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.ts, marginLeft: 3 }}>{m.unit}</span>
              </div>
            ))}
          </div>

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.13em", marginBottom: 8 }}>Wearable Status</div>
            {selected.wearable ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <PulseDot color={C.accent} size={6} />
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.accent }}>Device connected · streaming live data</span>
              </div>
            ) : (
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.tm }}>No wearable enrolled</div>
            )}
          </div>

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.13em", marginBottom: 8 }}>Care Notes</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.ts, lineHeight: 1.65 }}>
              Patient due for quarterly review. Last HbA1c: 8.2% (3 months ago). Medication adherence reported at 80%. Follow-up scheduled with care coordinator. Next appointment in 14 days.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// WEARABLE TAB
function WearableTab({ vitals, history }) {
  const [active, setActive] = useState(WEARABLE_DEVICES[0]);
  const battColor = (b) => b < 20 ? C.red : b < 40 ? C.amber : C.accent;
  const sigColor = (s) => s === "strong" ? C.accent : s === "moderate" ? C.amber : C.red;
  const sigBars = (s) => s === "strong" ? 3 : s === "moderate" ? 2 : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{
        background: `linear-gradient(135deg, #0a1f35, #0d1e30)`,
        border: `1px solid ${C.accentGlow}`,
        borderRadius: 16, padding: "20px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14,
      }}>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 800, color: C.tp }}>Device Management</div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.ts, marginTop: 3 }}>4 enrolled · 4 active · 0 offline</div>
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {[
            { label: "Streaming", value: "4", color: C.accent },
            { label: "Alerts Today", value: "11", color: C.red },
            { label: "Data Points", value: "24.8k", color: C.blue },
          ].map(s => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 22, color: s.color }}>{s.value}</div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 9, color: C.tm, textTransform: "uppercase", letterSpacing: "0.1em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.13em", marginBottom: 4 }}>Enrolled Devices</div>
          {WEARABLE_DEVICES.map(dev => {
            const bc = battColor(dev.battery);
            const sc = sigColor(dev.signal);
            const bars = sigBars(dev.signal);
            const isSel = active?.id === dev.id;
            return (
              <div key={dev.id} onClick={() => setActive(dev)} style={{
                background: isSel ? C.accentDim : C.card,
                border: `1px solid ${isSel ? C.accentGlow : C.border}`,
                borderRadius: 12, padding: "14px 16px", cursor: "pointer", transition: "all 0.2s",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 700, color: C.tp }}>{dev.patient}</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.ts, marginTop: 2 }}>{dev.device}</div>
                  </div>
                  {dev.status === "warning" && (
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.amber, background: C.amberDim, padding: "2px 7px", borderRadius: 6, border: `1px solid ${C.amber}44` }}>LOW BATT</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ width: 22, height: 11, border: `1.5px solid ${bc}`, borderRadius: 3, position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", right: -4, top: "50%", transform: "translateY(-50%)", width: 3, height: 6, background: bc, borderRadius: "0 2px 2px 0" }} />
                      <div style={{ height: "100%", width: `${dev.battery}%`, background: bc, borderRadius: 1 }} />
                    </div>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: bc }}>{dev.battery}%</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 2 }}>
                    {[1, 2, 3].map(b => (
                      <div key={b} style={{ width: 4, height: 4 + b * 3, borderRadius: 1, background: b <= bars ? sc : C.border }} />
                    ))}
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: sc, marginLeft: 4 }}>{dev.signal}</span>
                  </div>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.tm, marginLeft: "auto" }}>sync {dev.lastSync}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.13em" }}>Live Data Stream — {active?.patient}</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <StatBadge label="Heart Rate" value={vitals.heartRate} unit="bpm" color={C.red} spark={history.heartRate} pulse={vitals.heartRate > 85 ? "elevated" : "normal"} />
            <StatBadge label="SpO₂" value={vitals.spo2} unit="%" color={C.blue} spark={history.spo2} pulse={vitals.spo2 < 96 ? "warning" : "normal"} />
            <StatBadge label="Glucose" value={vitals.glucose} unit="mg/dL" color={C.amber} spark={history.glucose} pulse={vitals.glucose > 125 ? "elevated" : "normal"} />
            <StatBadge label="Blood Pressure" value={`${Math.round(vitals.systolic)}/${Math.round(vitals.diastolic)}`} unit="mmHg" color={C.purple} pulse={vitals.systolic > 130 ? "warning" : "normal"} />
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.13em", marginBottom: 16 }}>Biometric Sensors</div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "space-around" }}>
              <RadialArc value={vitals.hrv} min={20} max={80} color={C.purple} size={72} unit="ms" label="HRV" />
              <RadialArc value={vitals.temp} min={97} max={101} color={C.amber} size={72} unit="°F" label="Temp" />
              <RadialArc value={vitals.stress} min={0} max={100} color={C.red} size={72} unit="idx" label="Stress" />
              <RadialArc value={vitals.sleep} min={0} max={9} color={C.blue} size={72} unit="hrs" label="Sleep" />
              <RadialArc value={vitals.calories} min={0} max={3000} color={C.accent} size={72} unit="cal" label="Calories" />
            </div>
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.13em" }}>Daily Steps</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 26, color: C.tp, marginTop: 4 }}>{vitals.steps.toLocaleString()}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.ts }}>Goal: 10,000</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: C.accent, marginTop: 2 }}>{Math.round((vitals.steps / 10000) * 100)}% complete</div>
              </div>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: C.border, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, (vitals.steps / 10000) * 100)}%`, background: `linear-gradient(90deg, ${C.accent}, ${C.blue})`, borderRadius: 4, transition: "width 0.8s ease", boxShadow: `0 0 10px ${C.accent}44` }} />
            </div>
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 18px" }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.13em", marginBottom: 10 }}>Event Stream</div>
            {[
              { time: "Now", msg: `HR ${Math.round(vitals.heartRate)} bpm — within range`, color: C.accent },
              { time: "2m ago", msg: `SpO₂ reading: ${vitals.spo2.toFixed(0)}%`, color: C.blue },
              { time: "5m ago", msg: "CGM calibration completed", color: C.ts },
              { time: "12m ago", msg: "Step burst detected — 240 steps/2min", color: C.purple },
              { time: "18m ago", msg: "Resting HR baseline updated", color: C.ts },
            ].map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "baseline" }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.tm, minWidth: 44 }}>{e.time}</span>
                <span style={{ width: 4, height: 4, borderRadius: 2, background: e.color, flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.ts }}>{e.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ANALYTICS TAB
function AnalyticsTab() {
  const metrics = [
    { label: "Avg Panel A1c", value: "7.8%", delta: "-0.3", good: true, color: C.accent },
    { label: "BP Control Rate", value: "64%", delta: "+8", good: true, color: C.blue },
    { label: "HEDIS Completion", value: "71%", delta: "+5", good: true, color: C.purple },
    { label: "30-Day Readmit", value: "12%", delta: "-2", good: true, color: C.amber },
    { label: "Wearable Adherence", value: "80%", delta: "+12", good: true, color: C.accent },
    { label: "Avg Alert Response", value: "4.2m", delta: "-1.1", good: true, color: C.red },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
        {metrics.map(m => (
          <div key={m.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1.5, background: m.color, opacity: 0.6 }} />
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>{m.label}</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 28, color: C.tp, lineHeight: 1 }}>{m.value}</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: m.good ? C.accent : C.red, marginTop: 4 }}>{m.good ? "▲" : "▼"} {m.delta} vs last qtr</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "18px 20px" }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.13em", marginBottom: 14 }}>Glucose Trend — Panel (30d)</div>
          {[{ label: "Week 1", val: 162 }, { label: "Week 2", val: 154 }, { label: "Week 3", val: 148 }, { label: "Week 4", val: 139 }].map((w, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.ts }}>{w.label}</span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.amber }}>{w.val} mg/dL avg</span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: C.border }}>
                <div style={{ height: "100%", width: `${(w.val / 200) * 100}%`, background: `linear-gradient(90deg, ${C.amber}, ${C.red})`, borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "18px 20px" }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, color: C.tm, textTransform: "uppercase", letterSpacing: "0.13em", marginBottom: 14 }}>Alert Categories</div>
          {[
            { label: "Glucose Excursion", count: 38, pct: 42, color: C.amber },
            { label: "SpO₂ Low", count: 21, pct: 23, color: C.blue },
            { label: "BP Spike", count: 19, pct: 21, color: C.purple },
            { label: "Arrhythmia Flag", count: 13, pct: 14, color: C.red },
          ].map(a => (
            <div key={a.label} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.ts }}>{a.label}</span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: a.color }}>{a.count} events</span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: C.border }}>
                <div style={{ height: "100%", width: `${a.pct}%`, background: a.color, borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// AI INSIGHTS TAB
function InsightsTab() {
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [chatHistory, setChatHistory] = useState([
    { role: "assistant", text: "CareIQ AI ready. Ask me about your panel, wearable trends, risk stratification, or care gap opportunities." }
  ]);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, loading]);

  const send = async () => {
    if (!query.trim() || loading) return;
    const userMsg = query.trim();
    setQuery("");
    setChatHistory(h => [...h, { role: "user", text: userMsg }]);
    setLoading(true);
    try {
      const msgs = [...chatHistory, { role: "user", text: userMsg }]
        .filter((_, i, arr) => !(i === 0 && arr[0].role === "assistant"))
        .map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: "You are CareIQ, an AI health intelligence assistant embedded in an FQHC operating system. You help care teams interpret wearable data streams, identify care gaps, stratify patient risk, and improve HEDIS quality metrics. Be concise, clinical, and actionable. Reference realistic FQHC workflows and value-based care concepts when relevant. Never use em dashes.",
          messages: msgs,
        }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || "No response received.";
      setChatHistory(h => [...h, { role: "assistant", text }]);
    } catch {
      setChatHistory(h => [...h, { role: "assistant", text: "Connection error. Please try again." }]);
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: `linear-gradient(120deg, ${C.purpleDim}, ${C.accentDim})`, border: `1px solid ${C.accentGlow}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 20 }}>🧠</span>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: C.tp }}>CareIQ Clinical Intelligence</div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.ts }}>Powered by Sovereign Prompt Shield · HIPAA-aware reasoning</div>
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, minHeight: 340, maxHeight: 400 }}>
        {chatHistory.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "85%", padding: "10px 14px",
              borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
              background: m.role === "user" ? C.accentDim : C.surface,
              border: `1px solid ${m.role === "user" ? C.accentGlow : C.border}`,
              fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.tp, lineHeight: 1.65, whiteSpace: "pre-wrap",
            }}>{m.text}</div>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.tm, marginTop: 3 }}>{m.role === "user" ? "You" : "CareIQ AI"}</span>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: C.accent, animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
            ))}
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.ts }}>Analyzing...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
        {["Summarize high-risk alerts", "Top care gaps this week", "Dorothy Chen wearable trend", "HEDIS gap opportunities"].map(q => (
          <button key={q} onClick={() => setQuery(q)} style={{
            background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px",
            fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.ts, cursor: "pointer", textAlign: "left",
          }}>{q}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Ask about panel, wearable data, or care gaps..."
          style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "11px 14px", fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.tp, outline: "none" }}
        />
        <button onClick={send} disabled={loading} style={{
          background: loading ? C.tm : C.accent, border: "none", borderRadius: 10, padding: "0 20px",
          fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 700, color: C.bg,
          cursor: loading ? "not-allowed" : "pointer",
        }}>Send</button>
      </div>
    </div>
  );
}

// ROOT
export default function CareIQ() {
  const [tab, setTab] = useState("home");
  const { vitals, history } = useWearableStream();
  const totalAlerts = PATIENTS.reduce((s, p) => s + p.alerts, 0);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${C.bg}; }
        @keyframes pr { 0% { transform: scale(0.6); opacity: 0.8; } 100% { transform: scale(2.6); opacity: 0; } }
        @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-6px); } }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
        input::placeholder { color: ${C.tm}; }
        button:hover { opacity: 0.9; }
      `}</style>
      <div style={{ background: C.bg, minHeight: "100vh", color: C.tp }}>
        {/* Header */}
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${C.accent}, ${C.blue})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⚕</div>
              <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 800, color: C.tp }}>CareIQ</span>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.tm, background: C.card, padding: "2px 7px", borderRadius: 5, border: `1px solid ${C.border}` }}>FQHC OS</span>
            </div>
            <div style={{ width: 1, height: 24, background: C.border }} />
            <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
              {[
                { id: "home", icon: "⬛", label: "Dashboard" },
                { id: "patients", icon: "👤", label: "Patients", badge: totalAlerts },
                { id: "wearable", icon: "⌚", label: "Wearable" },
                { id: "analytics", icon: "📊", label: "Analytics" },
                { id: "ai", icon: "🧠", label: "AI Insights" },
              ].map(t => (
                <NavTab key={t.id} label={t.label} icon={t.icon} active={tab === t.id} onClick={() => setTab(t.id)} badge={t.badge} />
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <PulseDot color={C.accent} size={5} />
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: C.accent }}>4 devices live</span>
            </div>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.accentDim, border: `1px solid ${C.accentGlow}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 800, color: C.accent }}>CP</div>
          </div>
        </div>

        {/* Page content */}
        <div style={{ padding: "24px", maxWidth: 1300, margin: "0 auto" }}>
          {tab === "home" && <HomeTab vitals={vitals} history={history} />}
          {tab === "patients" && <PatientsTab />}
          {tab === "wearable" && <WearableTab vitals={vitals} history={history} />}
          {tab === "analytics" && <AnalyticsTab />}
          {tab === "ai" && <InsightsTab />}
        </div>
      </div>
    </>
  );
}
