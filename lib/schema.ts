
export type MetricDef = { key: string; type: "number" | "text"; unit?: string; label: string };
export type Protocol = { id: string; sport: string; name: string; description?: string; metrics: MetricDef[] };
