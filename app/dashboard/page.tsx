"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NavBar from "@/components/NavBar";
import KpiCard from "@/components/KpiCard";
import RecentTable from "@/components/RecentTable";
import { KPI_BY_SPORT } from "@/lib/kpis";
import type { MeasurementRow } from "@/lib/types";
import { getSupabase } from "@/lib/supabaseClient";
import { Hand, Dumbbell, Timer, Activity } from "lucide-react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";



const AthleteProfileCard = dynamic(() => import("@/components/AthleteProfileCard"), { ssr: false });
const AthleteStreaks = dynamic(() => import("@/components/AthleteStreaks"), { ssr: false });


export default function Dashboard(){
  const [sport,] = useState("climbing");
  const [rows, setRows] = useState<MeasurementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string>("");
  const router = useRouter();

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setNote("");
    try {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      // If this user is a coach/admin, send them to the coach overview instead
      const { data: me, error: meErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (meErr) throw meErr;
      if (me?.role === "coach" || me?.role === "admin") {
        router.replace("/coach");
        return; // stop loading athlete data
      }

      const { data, error } = await supabase
        .from("measurements")
        .select("*")
        .eq("user_id", user.id)
        .eq("sport", sport)
        .order("test_date", { ascending: true });
      if (error) throw error;
      setRows((data || []) as MeasurementRow[]);
    } catch (e: any) {
      setNote(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [sport, router]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // Realtime: robust subscribe + cleanup (no 'channel.unsubscribe' errors)
  useEffect(() => {
    const supabase = getSupabase();
    let canceled = false;
    const chRef = { current: null as any }; // RealtimeChannel | null

    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const ch = supabase
          .channel("csp-measurements")
          .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "measurements",
            filter: `user_id=eq.${user.id}`
          }, () => { if (!canceled) fetchRows(); })
          .subscribe(); // returns the channel object

        chRef.current = ch;
      } catch {
        // swallow; UI still works without realtime
      }
    })();

    return () => {
      canceled = true;
      try {
        const ch: any = chRef.current;
        if (!ch) return;
        const client: any = supabase as any;

        if (typeof client.removeChannel === "function") {
          client.removeChannel(ch);
        } else if (typeof ch.unsubscribe === "function") {
          ch.unsubscribe();
        }
        chRef.current = null;
      } catch {
        // ignore cleanup errors
      }
    };
  }, [fetchRows]);

  const kpis = useMemo(() => KPI_BY_SPORT[sport] || [], [sport]);
  const labels = rows.map(r => r.test_date ?? "");
  const iconFor = (label: string) => {
    if (label.includes("Grip")) return <Hand className="text-emerald-300" />;
    if (label.includes("Pull")) return <Dumbbell className="text-emerald-300" />;
    if (label.includes("Hang")) return <Timer className="text-emerald-300" />;
    return <Activity className="text-emerald-300" />;
  };

  return (
    <div className="max-w-7xl mx-auto pb-10">
      <NavBar />
<AthleteProfileCard editable title="Your Profile & Health" />
  <AthleteStreaks />
     
 
      {/* KPIs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-6">
        {kpis.map(k => {
          const series = rows.map(r => {
            const v = r.data?.[k.key];
            return typeof v === "number" ? v : (v != null ? Number(v) : null);
          });
          return (
            <KpiCard
              key={k.key}
              title={k.label}
              value={(() => { try { return k.compute(rows); } catch { return null; } })()}
              sub={series.some(x => x!=null) ? "Last " + series.filter(x => x!=null).length + " tests" : undefined}
              series={series}
              labels={labels}
              icon={iconFor(k.label)}
            />
          );
        })}
      </div>

      {/* History */}
      <div className="mt-6">
        {loading ? <div className="card p-4">Loading…</div> : (
          rows.length ? <RecentTable rows={[...rows].slice(-12).reverse()} /> : <div className="card p-4">No tests yet. Head to <a className="underline" href="/log">Log a Test</a>.</div>
        )}
      </div>
    </div>
  );
}
