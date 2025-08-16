// lib/kpis.ts
import type { MeasurementRow } from "./types";

const toNum = (v: any): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const maxOrNull = (vals: (number | null)[]) => {
  const nums = vals.filter((x): x is number => x !== null);
  return nums.length ? Math.max(...nums) : null;
};

const minOrNull = (vals: (number | null)[]) => {
  const nums = vals.filter((x): x is number => x !== null);
  return nums.length ? Math.min(...nums) : null;
};

const lastOrNull = (vals: (number | null)[]) => {
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) return vals[i]!;
  return null;
};

export const KPI_BY_SPORT: Record<
  string,
  { key: string; label: string; compute: (rows: MeasurementRow[]) => number | string | null }[]
> = {
  climbing: [
    { key: "max_hang_s", label: "Best Hang (s)", compute: rows => maxOrNull(rows.map(r => toNum(r.data?.max_hang_s))) },
    { key: "pullups_max", label: "Max Pull-ups", compute: rows => maxOrNull(rows.map(r => toNum(r.data?.pullups_max))) },
    { key: "grip_left_kg", label: "Grip Left (kg)", compute: rows => lastOrNull(rows.map(r => toNum(r.data?.grip_left_kg))) },
    { key: "grip_right_kg", label: "Grip Right (kg)", compute: rows => lastOrNull(rows.map(r => toNum(r.data?.grip_right_kg))) },
  ],
  ski: [
    { key: "cmj_height_cm", label: "CMJ Height (cm)", compute: rows => maxOrNull(rows.map(r => toNum(r.data?.cmj_height_cm))) },
    { key: "quad_strength_nm", label: "Quad Strength (Nm)", compute: rows => maxOrNull(rows.map(r => toNum(r.data?.quad_strength_nm))) },
  ],
  mtb: [
    { key: "p30s_w", label: "30s Peak Power (W)", compute: rows => maxOrNull(rows.map(r => toNum(r.data?.p30s_w))) },
    { key: "power_kg", label: "Power/Weight (W/kg)", compute: rows => maxOrNull(rows.map(r => toNum(r.data?.power_kg))) },
  ],
  running: [
    { key: "fivek_time_s", label: "5k Time (s)", compute: rows => minOrNull(rows.map(r => toNum(r.data?.fivek_time_s))) },
    { key: "cadence_spm", label: "Cadence (spm)", compute: rows => maxOrNull(rows.map(r => toNum(r.data?.cadence_spm))) },
  ],
};
