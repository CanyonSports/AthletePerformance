// app/forms/readiness/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as Supa from "@/lib/supabaseClient";
import * as NavMod from "@/components/NavBar";

const NavBar: any = (NavMod as any).default ?? (NavMod as any).NavBar ?? (() => null);

export default function ReadinessFormPage(){
  const router = useRouter();
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try { if (typeof anyS.getSupabase === "function") return anyS.getSupabase(); } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  const [status, setStatus] = useState("");
  const [sleepHrs, setSleepHrs] = useState<number | "">("");
  const [energy, setEnergy] = useState<number | "">("");
  const [soreness, setSoreness] = useState<number | "">("");
  const [stress, setStress] = useState<number | "">("");
  const [notes, setNotes] = useState("");

  async function submit(){
    try {
      if (!supabase) throw new Error("Supabase not configured");
      setStatus("Saving…");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in");

      const { error } = await supabase.from("readiness_logs").insert({
        user_id: user.id,
        log_date: new Date().toISOString().slice(0,10),
        sleep_hours: sleepHrs === "" ? null : Number(sleepHrs),
        energy: energy === "" ? null : Number(energy),
        soreness: soreness === "" ? null : Number(soreness),
        stress: stress === "" ? null : Number(stress),
        notes: notes || null,
      });
      if (error) throw error;
      setStatus("Saved!");
      router.push("/training");
    } catch (e:any) {
      setStatus(e.message ?? String(e));
    }
  }

  return (
    <div className="max-w-md mx-auto pb-16">
      <NavBar />
      <div className="mt-6 card p-4">
        <h1 className="text-xl font-semibold">Readiness</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Quick check-in before training.
        </p>

        <div className="mt-4 grid gap-3">
          <label className="text-sm">
            Sleep (hours)
            <input className="field w-full mt-1" type="number" step={0.25} value={sleepHrs}
              onChange={e => setSleepHrs(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            Energy (1–5)
            <input className="field w-full mt-1" type="number" min={1} max={5} value={energy}
              onChange={e => setEnergy(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            Soreness (1–5)
            <input className="field w-full mt-1" type="number" min={1} max={5} value={soreness}
              onChange={e => setSoreness(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            Stress (1–5)
            <input className="field w-full mt-1" type="number" min={1} max={5} value={stress}
              onChange={e => setStress(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            Notes
            <textarea className="field w-full mt-1" rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button className="btn btn-dark" onClick={submit}>Submit</button>
          <span className="text-sm" style={{ color: "var(--muted)" }}>{status}</span>
        </div>
      </div>
    </div>
  );
}
