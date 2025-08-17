export function errMsg(e: unknown): string {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error && e.message) return e.message;
  try {
    // Supabase errors are safe to stringify
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
