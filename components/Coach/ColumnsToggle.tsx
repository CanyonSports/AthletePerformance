// components/Coach/ColumnsToggle.tsx
"use client";
import { useState } from "react";

type StrengthColumns = {
  showReps?: boolean;
  showPercentRM?: boolean;
  showRPE?: boolean;
  showLoad?: boolean;
  showRest?: boolean;
};

export default function ColumnsToggle({
  initial,
  onChange,
}: {
  initial: StrengthColumns;
  onChange: (next: StrengthColumns) => void;
}) {
  const [v, setV] = useState<StrengthColumns>({
    showReps: true,
    showPercentRM: false,
    showRPE: true,
    showLoad: true,
    showRest: true,
    ...initial,
  });

  function set<K extends keyof StrengthColumns>(k: K, val: boolean) {
    const next = { ...v, [k]: val };
    setV(next);
    onChange(next);
  }

  const Row = ({ k, label }: { k: keyof StrengthColumns; label: string }) => (
    <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={!!v[k]} onChange={e => set(k, e.target.checked)} />
      {label}
    </label>
  );

  return (
    <div className="rounded bg-white/5 p-2 flex items-center gap-3 flex-wrap">
      <span className="opacity-70 text-xs">Columns:</span>
      <Row k="showReps" label="Reps" />
      <Row k="showPercentRM" label="%RM" />
      <Row k="showRPE" label="RPE" />
      <Row k="showLoad" label="Load (kg)" />
      <Row k="showRest" label="Rest (s)" />
    </div>
  );
}
