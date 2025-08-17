// components/AthleteProfileCard.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import * as Supa from "@/lib/supabaseClient";
import Link from "next/link";
import { Mail, Phone, TrendingUp, TrendingDown, Minus } from "lucide-react";

type Details = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  dob: string | null;
  sex: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  resting_hr: number | null;
  max_hr: number | null;
  medical_notes: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  updated_at: string | null;
};

function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1, 12);
  dt.setDate(dt.getDate() + days);
  return ymd(dt);
}

export default function AthleteProfileCard({
  athleteId,
  editable = false,
  title = "Athlete Summary",
}: {
  athleteId?: string;
  editable?: boolean;
  title?: string;
}) {
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(athleteId || null);
  const [d, setD] = useState<Details | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);

  // Trends
  const [rhrTrend, setRhrTrend] = useState<"up" | "down" | "flat" | null>(null);
  const [mhrTrend, setMhrTrend] = useState<"up" | "down" | "flat" | null>(null);

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      try {
        if (!athleteId) {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) { setNote("Please sign in."); setLoading(false); return; }
          setId(user.id);
          setMeEmail(user.email ?? null);
        } else {
          // fetch email for coach view header
          const pr = await supabase.from("profiles").select("email").eq("id", athleteId).maybeSingle();
          setMeEmail(pr.data?.email ?? null);
        }
      } catch (e: any) {
        setNote(e.message ?? String(e));
      }
    })();
  }, [supabase, athleteId]);

  useEffect(() => {
    (async () => {
      if (!supabase || !id) return;
      setLoading(true); setNote("");
      try {
        const det = await supabase.from("athlete_details").select("*").eq("user_id", id).maybeSingle();
        if (det.error) throw det.error;
        setD(det.data as Details || null);

        // quick trend calc: last 30 days measurements → avg last 7 vs prior 7
        const end = ymd(new Date());
        const start = addDaysISO(end, -29);
        const meas = await supabase
          .from("measurements")
          .select("test_date,data")
          .eq("user_id", id)
          .gte("test_date", start)
          .lte("test_date", end)
          .order("test_date", { ascending: true });
        if (!meas.error && Array.isArray(meas.data)) {
          const rows = meas.data as { test_date: string; data: Record<string, any> | null }[];

          const sliceAvg = (keys: string[]) => {
            const last7 = rows.slice(-7);
            const prev7 = rows.slice(-14, -7);
            const avg = (arr: typeof rows) => {
              const vals = arr.map(r => {
                for (const k of keys) {
                  const v = r.data?.[k];
                  if (typeof v === "number") return v;
                  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
                }
                return null;
              }).filter(x => x != null) as number[];
              return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
            };
            return { last: avg(last7), prev: avg(prev7) };
          };

          // Resting HR
          const rhr = sliceAvg(["resting_hr", "rhr"]);
          if (rhr.last == null || rhr.prev == null) setRhrTrend(null);
          else if (rhr.last < rhr.prev - 0.5) setRhrTrend("down"); // lower is better
          else if (rhr.last > rhr.prev + 0.5) setRhrTrend("up");
          else setRhrTrend("flat");

          // Max HR (just change detection)
          const mhr = sliceAvg(["max_hr", "mhr"]);
          if (mhr.last == null || mhr.prev == null) setMhrTrend(null);
          else if (mhr.last > mhr.prev + 0.5) setMhrTrend("up");
          else if (mhr.last < mhr.prev - 0.5) setMhrTrend("down");
          else setMhrTrend("flat");
        }
      } catch (e: any) {
        setNote(e.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase, id]);

  const name = (d?.first_name || d?.last_name) ? `${d?.first_name ?? ""} ${d?.last_name ?? ""}`.trim() : "(No name yet)";
  const email = meEmail ?? "(no email)";
  const contact = d?.phone || "(no phone)";

  function TrendBadge({ trend }: { trend: "up" | "down" | "flat" | null }) {
    if (trend === "up")   return <span className="inline-flex items-center text-emerald-300 text-xs"><TrendingUp className="w-3 h-3 mr-1" />up</span>;
    if (trend === "down") return <span className="inline-flex items-center text-rose-300 text-xs"><TrendingDown className="w-3 h-3 mr-1" />down</span>;
    return <span className="inline-flex items-center text-slate-400 text-xs opacity-70"><Minus className="w-3 h-3 mr-1" />flat</span>;
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3" style={{flexWrap:"wrap"}}>
        <div>
          <div className="text-xs" style={{color:"var(--muted)"}}>{title}</div>
          <h3 className="text-lg font-semibold">{name}</h3>
          <div className="flex items-center gap-3 text-sm mt-1" style={{color:"var(--muted)"}}>
            <span className="inline-flex items-center"><Mail className="w-4 h-4 mr-1" /> {email}</span>
            <span className="inline-flex items-center"><Phone className="w-4 h-4 mr-1" /> {contact}</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {editable ? <Link className="btn" href="/settings/profile">Edit Profile</Link> : null}
        </div>
      </div>

      {note ? <div className="text-xs mt-2" style={{color:"#fca5a5"}}>{note}</div> : null}
      {loading ? <div className="text-sm mt-2" style={{color:"var(--muted)"}}>Loading…</div> : null}

      <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded bg-white/5 border border-white/10 p-3">
          <div className="text-xs" style={{color:"var(--muted)"}}>Resting HR</div>
          <div className="text-2xl font-semibold mt-1">{d?.resting_hr ?? "—"} <span className="text-sm font-normal opacity-70">bpm</span></div>
          <div className="mt-1"><TrendBadge trend={rhrTrend} /></div>
        </div>
        <div className="rounded bg-white/5 border border-white/10 p-3">
          <div className="text-xs" style={{color:"var(--muted)"}}>Max HR</div>
          <div className="text-2xl font-semibold mt-1">{d?.max_hr ?? "—"} <span className="text-sm font-normal opacity-70">bpm</span></div>
          <div className="mt-1"><TrendBadge trend={mhrTrend} /></div>
        </div>
        <div className="rounded bg-white/5 border border-white/10 p-3">
          <div className="text-xs" style={{color:"var(--muted)"}}>Height</div>
          <div className="text-2xl font-semibold mt-1">{d?.height_cm ?? "—"} <span className="text-sm font-normal opacity-70">cm</span></div>
        </div>
        <div className="rounded bg-white/5 border border-white/10 p-3">
          <div className="text-xs" style={{color:"var(--muted)"}}>Weight</div>
          <div className="text-2xl font-semibold mt-1">{d?.weight_kg ?? "—"} <span className="text-sm font-normal opacity-70">kg</span></div>
        </div>
      </div>

      {(d?.medical_notes || d?.emergency_name || d?.emergency_phone) ? (
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          <div className="rounded bg-white/5 border border-white/10 p-3">
            <div className="text-xs" style={{color:"var(--muted)"}}>Medical Notes</div>
            <div className="text-sm mt-1 whitespace-pre-wrap">{d?.medical_notes || "—"}</div>
          </div>
          <div className="rounded bg-white/5 border border-white/10 p-3">
            <div className="text-xs" style={{color:"var(--muted)"}}>Emergency Contact</div>
            <div className="text-sm mt-1">{d?.emergency_name || "—"}</div>
            <div className="text-sm opacity-80">{d?.emergency_phone || ""}</div>
          </div>
        </div>
      ) : null}

      {d?.updated_at ? (
        <div className="mt-2 text-xs" style={{color:"var(--muted)"}}>
          Last updated {new Date(d.updated_at).toLocaleDateString()}
        </div>
      ) : null}
    </div>
  );
}
