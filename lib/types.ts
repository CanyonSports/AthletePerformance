
export type MeasurementRow = {
  id: string;
  user_id: string;
  sport: "climbing" | "ski" | "mtb" | "running";
  test_date: string; // ISO date
  data: Record<string, any>;
  created_at?: string;
};
