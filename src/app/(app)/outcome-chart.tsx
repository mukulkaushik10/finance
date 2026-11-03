"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Categorical slots 1-5 in fixed order (validated palette). Each status keeps its colour whatever
// weeks are shown. Legend + table view carry identity, not colour alone.
const SERIES = [
  { key: "auto_approved", label: "Approved automatically", color: "#2a78d6" },
  { key: "approved", label: "Approved by a person", color: "#eb6834" },
  { key: "rejected", label: "Rejected", color: "#1baf7a" },
  { key: "blocked", label: "Blocked", color: "#eda100" },
  { key: "pending_review", label: "Waiting for review", color: "#e87ba4" },
  { key: "logged", label: "Recorded (shadow)", color: "#008300" },
] as const;

export function OutcomeChart({ weeks }: { weeks: Record<string, string | number | boolean>[] }) {
  const present = SERIES.filter((s) => weeks.some((w) => Number(w[s.key] ?? 0) > 0));
  const data = weeks.map((w) => ({ ...w, label: w.partial ? `${w.label} (so far)` : w.label }));
  return (
    <div className="h-72" role="img" aria-label="Invoices per week by outcome">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="#e8eaee" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#cdd2da" }} tick={{ fontSize: 12, fill: "#374151" }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#6b7280" }} />
          <Tooltip cursor={{ fill: "rgba(17,24,39,0.04)" }} contentStyle={{ borderRadius: 8, border: "1px solid #e2e5ea", fontSize: 12 }} itemStyle={{ color: "#374151" }} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: "#374151" }}>{v}</span>} />
          {present.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} maxBarSize={36} stroke="#ffffff" strokeWidth={2}
              radius={i === present.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
