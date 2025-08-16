"use client";

import { useMemo, useState } from "react";
import type { Protocol, MetricDef } from "@/lib/schema";

type Props = {
  protocol: Protocol;
  onSubmit: (payload: Record<string, any>) => Promise<void> | void;
};

export default function ProtocolForm({ protocol, onSubmit }: Props) {
  const initial = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const m of protocol.metrics) obj[m.key] = "";
    return obj;
  }, [protocol.metrics]);

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setVal = (key: string, v: string) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const toPayloadValue = (m: MetricDef, raw: string) => {
    if (m.type === "number") {
      if (raw.trim() === "") return null; // omit empty numbers
      const num = Number(raw);
      return Number.isFinite(num) ? num : null;
    }
    return raw;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, any> = {};
      for (const m of protocol.metrics) {
        const v = toPayloadValue(m, values[m.key]);
        if (v !== null && v !== "") payload[m.key] = v;
      }
      await onSubmit(payload);
      setValues(initial);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{protocol.name}</h3>
          {protocol.description ? (
            <p className="text-xs text-slate-400 mt-1">{protocol.description}</p>
          ) : null}
        </div>
        <span className="badge uppercase">{protocol.sport}</span>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mt-4">
        {protocol.metrics.map((m) => (
          <div key={m.key} className="flex flex-col">
            <label className="text-sm text-slate-300 mb-1">
              {m.label} {m.unit ? <span className="text-slate-500">({m.unit})</span> : null}
            </label>
            <input
              className="w-full p-3 rounded bg-white/5 border border-white/10"
              type={m.type === "number" ? "number" : "text"}
              inputMode={m.type === "number" ? "decimal" : undefined}
              step={m.type === "number" ? "any" : undefined}
              placeholder={m.type === "number" ? "Enter a number…" : "Enter a value…"}
              value={values[m.key]}
              onChange={(e) => setVal(m.key, e.target.value)}
            />
          </div>
        ))}
      </div>

      {error ? <p className="text-sm text-red-400 mt-3">{error}</p> : null}

      <div className="flex items-center gap-3 mt-4">
        <button type="submit" className="btn-pine" disabled={submitting}>
          {submitting ? "Saving…" : "Save Test"}
        </button>
        <button
          type="button"
          className="btn-dark"
          onClick={() => setValues(initial)}
          disabled={submitting}
        >
          Reset
        </button>
      </div>
    </form>
  );
}
