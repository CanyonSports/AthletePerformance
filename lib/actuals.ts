// lib/actuals.ts
import * as Supa from "@/lib/supabaseClient";

export async function upsertStrengthActual({
  setId, userId, performed_reps, performed_load_kg, performed_rpe, notes
}: {
  setId: string; userId: string;
  performed_reps?: number|null;
  performed_load_kg?: number|null;
  performed_rpe?: number|null;
  notes?: string|null;
}) {
  const anyS = Supa as any;
  const supabase = typeof anyS.getSupabase === "function" ? anyS.getSupabase() : anyS.supabase;
  return supabase.from("strength_set_actuals").upsert({
    set_id: setId,
    user_id: userId,
    performed_reps: performed_reps ?? null,
    performed_load_kg: performed_load_kg ?? null,
    performed_rpe: performed_rpe ?? null,
    notes: notes ?? null,
  }, { onConflict: "set_id,user_id" });
}

export async function upsertIntervalActual({
  intervalId, userId, rep_index, actual_duration_sec, actual_distance_m, avg_hr, rpe, notes
}: {
  intervalId: string; userId: string; rep_index: number;
  actual_duration_sec?: number|null; actual_distance_m?: number|null;
  avg_hr?: number|null; rpe?: number|null; notes?: string|null;
}) {
  const anyS = Supa as any;
  const supabase = typeof anyS.getSupabase === "function" ? anyS.getSupabase() : anyS.supabase;
  return supabase.from("interval_actuals").upsert({
    interval_id: intervalId, user_id: userId, rep_index,
    actual_duration_sec: actual_duration_sec ?? null,
    actual_distance_m: actual_distance_m ?? null,
    avg_hr: avg_hr ?? null,
    rpe: rpe ?? null,
    notes: notes ?? null,
  }, { onConflict: "interval_id,user_id,rep_index" });
}
