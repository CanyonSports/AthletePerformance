
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const RAW_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const RAW_ANON = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
export const SUPABASE_URL = RAW_URL;
export const isSupabaseConfigured = !!RAW_URL && !!RAW_ANON && /^https:\/\//i.test(RAW_URL);

let cached: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL (https://...) and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart the dev server.");
  }
  if (!cached) cached = createClient(RAW_URL, RAW_ANON);
  return cached;
}
