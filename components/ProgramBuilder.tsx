// components/ProgramBuilder.tsx
"use client";

import { useMemo, useState } from "react";
import * as Supa from "@/lib/supabaseClient";

export type Sport = "climbing" | "ski" | "mtb" | "running";

type DaySession = {
  title: string;
  details: string;
  duration_min: string; // keep as string for empty state; cast on save
  rpe: string;          // keep as string for empty state; cast on save
};

type ProgramBuilderProps = {
  sport: Sport;
  weekStart: string;       // yyyy-mm-dd (Monday)
  athleteId: string | null;
  onPushed?: (count: number) => void; // callback after pushing sessions
};

function addDaysISO(baseISO: string, days: number) {
  const d = new Date(baseISO);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function ProgramBuilder({
  sport,
  weekStart,
  athleteId,
  onPushed,
}: ProgramBuilderProps) {
  // Support either exported getSupabase() or supabase constant.
  const supabase = useMemo(() => {
    const anyS = Supa as any;
    try {
      if (typeof anyS.getSupabase === "function") return anyS.getSupabase();
    } catch {}
    if (anyS.supabase) return anyS.supabase;
    return null;
  }, []);

  // sessions state: dayIndex -> sessions[]
  const [sessions, setSessions] = useState<Record<number, DaySession[]>>({
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
  });
  const [clearExisting, setClearExisting] = useState(false);
  const [status, setStatus] = useState("");

  const addSession = (day: number) =>
    setSessions((prev) => ({
      ...prev,
      [day]: [
        ...(prev[day] || []),
        { title: "", details: "", duration_min: "", rpe: "" },
      ],
    }));

  const removeSession = (day: number, idx: number) =>
    setSessions((prev) => ({
      ...prev,
      [day]: (prev[day] || []).filter((_, i) => i !== idx),
    }));

  const setField = (day: number, idx: number, patch: Partial<DaySession>) =>
    setSessions((prev) => ({
      ...prev,
      [day]: (prev[day] || []).map((s, i) =>
        i === idx ? { ...s, ...patch } : s
      ),
    }));

  async function pushToAthlete() {
    setStatus("Pushing…");
    try {
      if (!supabase) throw new Error("Supabase not configured");
      if (!athleteId) throw new Error("Select an athlete first");

      // Optional: clear existing week for this sport
      if (clearExisting) {
        const end = addDaysISO(weekStart, 7);
        const { error: delErr } = await supabase
          .from("training_plan_items")
          .delete()
          .eq("user_id", athleteId)
          .eq("sport", sport)
          .gte("session_date", weekStart)
          .lt("session_date", end);
        if (delErr) throw delErr;
      }

      // Build inserts
      const rows: any[] = [];
      for (let day = 0; day < 7; day++) {
        const date = addDaysISO(weekStart, day);
        for (const s of sessions[day] || []) {
          if (!s.title.trim()) continue; // skip empty
          rows.push({
            user_id: athleteId,
            sport,
            session_date: date,
            title: s.title.trim(),
            details: s.details.trim() || null,
            duration_min: s.duration_min === "" ? null : Number(s.duration_min),
            rpe: s.rpe === "" ? null : Number(s.rpe),
            status: "planned",
          });
        }
      }

      if (rows.length === 0) {
        setStatus("Add at least one session before pushing.");
        return;
      }

      const { error: insErr } = await supabase
        .from("training_plan_items")
        .insert(rows);
      if (insErr) throw insErr;

      setStatus(
        `Pushed ${rows.length} session${rows.length > 1 ? "s" : ""}.`
      );
      onPushed?.(rows.length);
    } catch (e: any) {
      setStatus(e.message ?? String(e));
    }
  }

  return (
    <div className="card p-4 mt-6">
      <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
        <h3 className="text-lg font-semibold">Exercise Program Builder</h3>
        <span className="badge" style={{ textTransform: "uppercase" }}>
          {sport}
        </span>
        <span className="badge">Week: {weekStart}</span>
        <label className="flex items-center gap-2" style={{ marginLeft: "auto" }}>
          <input
            type="checkbox"
            checked={clearExisting}
            onChange={(e) => setClearExisting(e.target.checked)}
          />
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            Clear existing week first
          </span>
        </label>
        <button
          className="btn btn-pine"
          onClick={pushToAthlete}
          disabled={!athleteId}
          title={!athleteId ? "Select an athlete" : "Push sessions to athlete"}
        >
          Push to Athlete
        </button>
      </div>

      {status ? (
        <p className="text-sm mt-2" style={{ color: "var(--muted)" }}>
          {status}
        </p>
      ) : null}

      <div className="grid grid-2 mt-4">
        {DAY_LABELS.map((label, dayIdx) => (
          <div key={dayIdx} className="card p-3">
            <div className="flex items-center gap-2">
              <span className="badge">{label}</span>
              <span className="text-sm" style={{ color: "var(--muted)" }}>
                {addDaysISO(weekStart, dayIdx)}
              </span>
              <button
                className="btn btn-dark"
                style={{ marginLeft: "auto" }}
                onClick={() => addSession(dayIdx)}
              >
                + Add Session
              </button>
            </div>

            {(sessions[dayIdx] || []).length === 0 ? (
              <p className="text-sm mt-2" style={{ color: "var(--muted)" }}>
                No sessions.
              </p>
            ) : (
              <div className="mt-2" style={{ display: "grid", gap: 8 }}>
                {(sessions[dayIdx] || []).map((s, i) => (
                  <div key={i} className="card p-3">
                    <div className="flex items-center gap-2">
                      <input
                        className="field w-full"
                        placeholder="Session title (e.g., Endurance Intervals)"
                        value={s.title}
                        onChange={(e) =>
                          setField(dayIdx, i, { title: e.target.value })
                        }
                      />
                      <button
                        className="btn btn-dark"
                        onClick={() => removeSession(dayIdx, i)}
                      >
                        Remove
                      </button>
                    </div>

                    <textarea
                      className="field w-full mt-2"
                      rows={3}
                      placeholder="Details (e.g., 5x5 min Z3, 3 min easy between)"
                      value={s.details}
                      onChange={(e) =>
                        setField(dayIdx, i, { details: e.target.value })
                      }
                    />

                    <div className="flex items-center gap-3 mt-2">
                      <input
                        className="field w-32"
                        type="number"
                        placeholder="Duration (min)"
                        value={s.duration_min}
                        onChange={(e) =>
                          setField(dayIdx, i, { duration_min: e.target.value })
                        }
                      />
                      <input
                        className="field w-24"
                        type="number"
                        placeholder="RPE"
                        value={s.rpe}
                        onChange={(e) =>
                          setField(dayIdx, i, { rpe: e.target.value })
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
