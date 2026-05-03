"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface DailyMetric {
  date: string;
  heartRate?: number;
  steps?: number;
  sleepHours?: number;
  spo2?: number;
  calories?: number;
}

export default function HealthChart({
  metrics,
  deviceType,
}: {
  metrics: DailyMetric[];
  deviceType: string;
}) {
  if (!metrics || metrics.length === 0) {
    return <p className="text-sm text-ink-mute">No data.</p>;
  }

  const data = metrics.map((m) => ({
    date: m.date.slice(5),
    heartRate: m.heartRate ?? null,
    steps: m.steps ?? null,
    sleepHours: m.sleepHours ?? null,
  }));

  return (
    <div>
      <div className="mb-2 text-xs text-ink-mute">Source: {humanDevice(deviceType)}</div>
      <div className="grid gap-6">
        <ChartBlock title="Heart rate (avg bpm)" color="#ef4444" data={data} dataKey="heartRate" unit="bpm" />
        <ChartBlock title="Steps" color="#0ea5e9" data={data} dataKey="steps" unit="" />
        <ChartBlock title="Sleep (hours)" color="#7c3aed" data={data} dataKey="sleepHours" unit="h" />
      </div>
    </div>
  );
}

function ChartBlock({
  title,
  color,
  data,
  dataKey,
  unit,
}: {
  title: string;
  color: string;
  data: Array<{ date: string; [k: string]: number | string | null }>;
  dataKey: string;
  unit: string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-semibold text-ink">{title}</div>
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
            <YAxis stroke="#64748b" fontSize={12} />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
              formatter={(v: number) => (v == null ? "-" : `${v}${unit ? " " + unit : ""}`)}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
              name={title}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function humanDevice(d: string): string {
  switch (d) {
    case "fitbit":
      return "Fitbit";
    case "apple_watch":
      return "Apple Watch";
    case "garmin":
      return "Garmin";
    case "samsung":
      return "Samsung Health";
    case "google_fit":
      return "Google Fit";
    default:
      return "Wearable";
  }
}
