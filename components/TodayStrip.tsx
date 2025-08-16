// components/TodayStrip.tsx
"use client";

import React, { useMemo } from "react";

/** Local YYYY-MM-DD (no UTC drift). */
function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
/** Construct from local Y-M-D safely. */
function fromYMD(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  // set to noon to avoid rare DST edge flips
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}
function addDaysISO(iso: string, days: number) {
  const d = fromYMD(iso);
  d.setDate(d.getDate() + days);
  return ymd(d);
}
function startOfWeekISO_local(d: Date) {
  // Monday = 0
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate()); // local midnight
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  return ymd(copy);
}
function isTodayISO(iso: string) {
  return iso === ymd(new Date());
}

export default function TodayStrip({
  value,                 // selected day (yyyy-mm-dd)
  onChange,              // (iso) => void
  countsByDate = {},     // optional: { "yyyy-mm-dd": number }
}: {
  value: string;
  onChange: (iso: string) => void;
  countsByDate?: Record<string, number>;
}) {
  const weekStart = useMemo(() => startOfWeekISO_local(fromYMD(value)), [value]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)), [weekStart]);

  const weekLabel = (() => {
    const first = fromYMD(weekStart);
    const last = fromYMD(addDaysISO(weekStart, 6));
    const sameMonth = first.getMonth() === last.getMonth();
    const mm1 = first.toLocaleDateString(undefined, { month: "short" });
    const mm2 = last.toLocaleDateString(undefined, { month: "short" });
    const d1 = first.getDate();
    const d2 = last.getDate();
    return sameMonth ? `${mm1} ${d1}–${d2}` : `${mm1} ${d1} – ${mm2} ${d2}`;
  })();

  return (
    <div className="card p-2">
      {/* Week nav */}
      <div className="flex items-center mb-2">
        <button
          className="btn btn-dark"
          onClick={() => onChange(addDaysISO(weekStart, -7))}
          title="Previous week"
        >
          ←
        </button>
        <div className="mx-auto text-sm opacity-80">{weekLabel}</div>
        <button
          className="btn btn-dark"
          onClick={() => onChange(addDaysISO(weekStart, 7))}
          title="Next week"
        >
          →
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {days.map((iso) => {
            const d = fromYMD(iso);
            const isSel = iso === value;
            const isToday = isTodayISO(iso);
            const count = countsByDate[iso] || 0;
            return (
              <button
                key={iso}
                onClick={() => onChange(iso)} // ← local ISO keeps Sunday correct
                className={`px-3 py-2 rounded text-sm transition ${
                  isSel ? "bg-white/15" : "bg-white/5 hover:bg-white/10"
                }`}
                title={d.toDateString()}
              >
                <div className="flex items-center gap-2">
                  <div className="text-left">
                    <div className="font-semibold">
                      {d.toLocaleDateString(undefined, { weekday: "short" })}
                      {isToday ? (
                        <span className="ml-2 text-xs px-1 py-0.5 rounded bg-white/20">Today</span>
                      ) : null}
                    </div>
                    <div className="opacity-70 text-xs">
                      {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </div>
                  </div>
                  {count > 0 ? (
                    <div className="ml-1 text-xs px-2 py-0.5 rounded bg-white/10">{count}</div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
