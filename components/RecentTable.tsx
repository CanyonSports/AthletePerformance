
import type { MeasurementRow } from "@/lib/types";
export default function RecentTable({ rows }: { rows: MeasurementRow[] }){
  const baseCols = ["test_date", "sport"];
  const metricKeys = Array.from(new Set(rows.flatMap(r => Object.keys(r.data || {}))));
  return (
    <div className="card p-4 overflow-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold">Recent Tests</h3>
        <span className="badge">{rows.length} entries</span>
      </div>
      <table className="w-full text-sm">
        <thead className="text-slate-300">
          <tr>
            {baseCols.concat(metricKeys).map(c => <th key={c} className="text-left py-2 pr-4">{c}</th>)}
          </tr>
        </thead>
        <tbody className="text-slate-200">
          {rows.map((r,i) => (
            <tr key={r.id ?? i} className="border-t border-white/10">
              <td className="py-2 pr-4">{r.test_date}</td>
              <td className="py-2 pr-4">{r.sport}</td>
              {metricKeys.map(k => <td key={k} className="py-2 pr-4">{String(r.data?.[k] ?? "—")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
