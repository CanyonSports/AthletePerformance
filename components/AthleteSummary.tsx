// components/AthleteSummary.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import {
  Mail, Phone, MapPin, User, Calendar as CalendarIcon,
  TrendingUp, TrendingDown, Minus
} from "lucide-react";

type Profile = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone?: string | null;
  dob?: string | null;            // YYYY-MM-DD
  sex?: string | null;            // "male" | "female" | "nonbinary" | etc
  height_cm?: number | null;
  weight_kg?: number | null;
  primary_sport?: string | null;
  location_city?: string | null;
  location_state?: string | null;
  location_country?: string | null;
  // other custom fields welcome
};

type Measurement = {
  test_date: string;              // YYYY-MM-DD
  data: Record<string, any> | null;
};

type MetricKey =
  | "resting_hr"
  | "max_hr"
  | "ftp_w"
  | "vo2max_est"
  | "body_mass_kg"
  | "body_fat_pct";

type MetricConfig = {
  key: MetricKey;
  label: string;
  unit?: string;                  // for display
  betterIsLower?: boolean;        // used to color the change "good/bad"
  decimals?: number;
};

const METRICS: MetricConfig[] = [
  { key: "resting_hr",   label: "Resting HR",    unit: "bpm", betterIsLower: true },
  { key: "max_hr",       label: "Max HR",        unit: "bpm", betterIsLower: false },
  { key: "ftp_w",        label: "FTP",           unit: "W",   betterIsLower: false },
  { key: "vo2max_est",   label: "VO₂max (est.)", unit: "",    betterIsLower: false, decimals: 1 },
  { key: "body_mass_kg", label: "Body Mass",     unit: "kg",  betterIsLower: true,  decimals: 1 },
  { key: "body_fat_pct", label: "Body Fat",      unit: "%",   betterIsLower: true,  decimals: 1 },
];

function ageFromDOB(dob?: string | null) {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(n => parseInt(n, 10));
  if (!y || !m || !d) return null;
  const birth = new Date(y, m - 1, d);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age--;
  return age;
}

function bmi(height_cm?: number | null, weight_kg?: number | null) {
  if (!height_cm || !weight_kg) return null;
  const h = height_cm / 100;
  return weight_kg / (h * h);
}

function fmt(n: number | null | undefined, decimals = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(decimals);
}

function sparkPath(values: number[], w = 160, h = 40, pad = 4) {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1; // avoid divide by zero
  const xStep = (w - pad * 2) / Math.max(1, values.length - 1);
  const toX = (i: number) => pad + i * xStep;
  const toY = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  return values.map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toY(v)}`).join(" ");
}

function changeArrow(delta: number) {
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return <Minus className="w-4 h-4 text-slate-400" />;
  return delta > 0
    ? <TrendingUp className="w-4 h-4 text-emerald-300" />
    : <TrendingDown className="w-4 h-4 text-rose-300" />;
}

export default function AthleteSummary({ athleteId }: { athleteId: string }) {
  const supabase = useMemo(() => getSupabase(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string>("");

  const channelRef = useRef<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNote("");
    try {
      const { data: p, error: pe } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", athleteId)
        .single();
      if (pe) throw pe;
      setProfile(p as Profile);

      const { data: m, error: me } = await supabase
        .from("measurements")
        .select("test_date, data")
        .eq("user_id", athleteId)
        .order("test_date", { ascending: true });
      if (me) throw me;

      setRows((m || []) as any);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, athleteId]);

  useEffect(() => { load(); }, [load]);

  // Robust realtime subscribe (no unsubscribe errors)
  useEffect(() => {
    let canceled = false;

    (async () => {
      try {
        // clean previous (strict mode/hot reload)
        try {
          const old = channelRef.current;
          if (old) {
            if (typeof (supabase as any).removeChannel === "function") {
              (supabase as any).removeChannel(old);
            } else if (typeof old.unsubscribe === "function") {
              old.unsubscribe();
            }
            channelRef.current = null;
          }
        } catch {}

        const ch = supabase
          .channel(`athlete-summary:${athleteId}`)
          .on("postgres_changes", {
            event: "*", schema: "public", table: "measurements", filter: `user_id=eq.${athleteId}`
          }, () => { if (!canceled) load(); })
          .on("postgres_changes", {
            event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${athleteId}`
          }, () => { if (!canceled) load(); })
          .subscribe();

        channelRef.current = ch;
      } catch {}
    })();

    return () => {
      canceled = true;
      try {
        const ch: any = channelRef.current;
        if (!ch) return;
        if (typeof (supabase as any).removeChannel === "function") {
          (supabase as any).removeChannel(ch);
        } else if (typeof ch.unsubscribe === "function") {
          ch.unsubscribe();
        }
        channelRef.current = null;
      } catch {}
    };
  }, [supabase, athleteId, load]);

  // Build series for each metric
  const timeLabels = rows.map(r => r.test_date);
  const seriesByKey: Record<MetricKey, number[]> = useMemo(() => {
    const out: Record<string, number[]> = {};
    METRICS.forEach(m => out[m.key] = []);
    rows.forEach(r => {
      METRICS.forEach(m => {
        const v = r.data?.[m.key];
        out[m.key].push(typeof v === "number" ? v : (v != null ? Number(v) : NaN));
      });
    });
    // Replace NaNs with filtered arrays (drop missing points)
    (Object.keys(out) as MetricKey[]).forEach(k => {
      const vals = out[k].filter(v => Number.isFinite(v)) as number[];
      out[k] = vals;
    });
    return out as Record<MetricKey, number[]>;
  }, [rows]);

  function last(values: number[]) { return values.length ? values[values.length - 1] : null; }
  function prev(values: number[]) { return values.length > 1 ? values[values.length - 2] : null; }

  function trendDelta(values: number[]) {
    const a = prev(values);
    const b = last(values);
    if (a == null || b == null) return null;
    return b - a; // simple last-step change
  }
  function trendPct(values: number[]) {
    const a = prev(values);
    const b = last(values);
    if (a == null || b == null || a === 0) return null;
    return (b - a) / Math.abs(a);
  }

  const avatar = (profile?.display_name || profile?.email || "?").slice(0, 1).toUpperCase();
  const age = ageFromDOB(profile?.dob || null);
  const bmiValue = bmi(profile?.height_cm ?? null, profile?.weight_kg ?? null);

  return (
    <div className="card p-4 mb-4">
      {/* Header */}
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-200 font-semibold">
          {avatar}
        </div>

        {/* Identity + Contact */}
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold">{profile?.display_name || "Athlete"}</h2>
            {profile?.primary_sport && (
              <span className="text-xs px-2 py-1 rounded bg-white/5 border border-white/10 uppercase tracking-wide">
                {profile.primary_sport}
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-slate-300 flex flex-wrap gap-4">
            <span className="inline-flex items-center gap-1">
              <Mail className="w-4 h-4 text-emerald-300" />
              <a className="underline" href={profile?.email ? `mailto:${profile.email}` : "#"}>{profile?.email || "—"}</a>
            </span>
            <span className="inline-flex items-center gap-1">
              <Phone className="w-4 h-4 text-emerald-300" />
              <a className="underline" href={profile?.phone ? `tel:${profile.phone}` : "#"}>{profile?.phone || "—"}</a>
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-4 h-4 text-emerald-300" />
              {profile?.location_city || profile?.location_state || profile?.location_country
                ? [profile?.location_city, profile?.location_state, profile?.location_country].filter(Boolean).join(", ")
                : "—"}
            </span>
          </div>
        </div>

        {/* Demographics mini card */}
        <div className="grid grid-cols-2 gap-3 text-sm min-w-[240px]">
          <div className="rounded bg-white/5 border border-white/10 p-3">
            <div className="text-xs text-slate-400 flex items-center gap-1"><User className="w-3 h-3" /> Demographics</div>
            <div className="mt-1">
              <div><span className="text-slate-400">Age:</span> {age ?? "—"}</div>
              <div><span className="text-slate-400">Sex:</span> {profile?.sex || "—"}</div>
            </div>
          </div>
          <div className="rounded bg-white/5 border border-white/10 p-3">
            <div className="text-xs text-slate-400 flex items-center gap-1"><CalendarIcon className="w-3 h-3" /> Body</div>
            <div className="mt-1">
              <div><span className="text-slate-400">Ht:</span> {profile?.height_cm ? `${profile.height_cm} cm` : "—"}</div>
              <div><span className="text-slate-400">Wt:</span> {profile?.weight_kg ? `${fmt(profile.weight_kg, 1)} kg` : "—"}</div>
              <div><span className="text-slate-400">BMI:</span> {bmiValue ? fmt(bmiValue, 1) : "—"}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {METRICS.map(cfg => {
          const values = seriesByKey[cfg.key];
          if (!values || values.length === 0) return null;

          const latest = last(values);
          const delta = trendDelta(values);
          const pct = trendPct(values);

          // color intent: green if improving in desired direction, red if worsening
          let intent = "neutral";
          if (delta != null) {
            const improving = cfg.betterIsLower ? (delta < 0) : (delta > 0);
            if (Math.abs(delta) < 1e-9) intent = "neutral";
            else intent = improving ? "up" : "down";
          }

          return (
            <div key={cfg.key} className="rounded border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm text-slate-300">{cfg.label}</div>
                <div className="flex items-center gap-1">
                  {changeArrow(delta ?? 0)}
                  <span className={`text-xs ${intent === "up" ? "text-emerald-300" : intent === "down" ? "text-rose-300" : "text-slate-400"}`}>
                    {pct == null ? "—" : `${(pct * 100 > 0 ? "+" : "")}${Math.round((pct || 0) * 100)}%`}
                  </span>
                </div>
              </div>

              <div className="mt-1 flex items-end justify-between gap-2">
                <div className="text-2xl font-semibold">
                  {fmt(latest, cfg.decimals)} {cfg.unit}
                </div>
                {/* Sparkline */}
                <svg viewBox="0 0 160 40" width="160" height="40" className="opacity-80">
                  <defs>
                    <linearGradient id={`grad-${cfg.key}`} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="currentColor" stopOpacity="0.9" />
                      <stop offset="100%" stopColor="currentColor" stopOpacity="0.2" />
                    </linearGradient>
                  </defs>
                  <path
                    d={sparkPath(values)}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={intent === "up" ? "text-emerald-300" : intent === "down" ? "text-rose-300" : "text-slate-300"}
                  />
                </svg>
              </div>

              <div className="mt-1 text-xs text-slate-400">
                {values.length} data point{values.length === 1 ? "" : "s"}
              </div>
            </div>
          );
        })}
      </div>

      {note ? <div className="mt-3 text-xs text-rose-300">{note}</div> : null}
      {loading ? <div className="mt-2 text-sm text-slate-400">Loading summary…</div> : null}
    </div>
  );
}
