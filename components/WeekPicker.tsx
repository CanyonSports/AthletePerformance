// components/WeekPicker.tsx
"use client";

import React from "react";

function startOfWeekISO(d: Date): string {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type Props = {
  /** ISO date string for the Monday of the current week */
  value: string;
  /** Called with the ISO Monday for the newly selected week */
  onChange: (newWeekStart: string) => void;
  className?: string;
};

function WeekPicker({ value, onChange, className }: Props) {
  const rangeLabel = `${value} – ${addDaysISO(value, 6)}`;

  const prev = () => onChange(addDaysISO(value, -7));
  const next = () => onChange(addDaysISO(value, 7));

  const handleDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value ? new Date(e.target.value) : new Date();
    onChange(startOfWeekISO(v)); // normalize to Monday
  };

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <button
        type="button"
        className="btn btn-dark"
        onClick={prev}
        aria-label="Previous week"
        title="Previous week"
      >
        ←
      </button>

      <input
        type="date"
        className="field field--date"
        value={value}
        onChange={handleDate}
        aria-label="Pick any date in the week"
        title="Pick any date in the week"
      />

      <button
        type="button"
        className="btn btn-dark"
        onClick={next}
        aria-label="Next week"
        title="Next week"
      >
        →
      </button>

      <span className="text-sm" style={{ color: "var(--muted)" }}>
        {rangeLabel}
      </span>
    </div>
  );
}

export default WeekPicker;
export { WeekPicker };
