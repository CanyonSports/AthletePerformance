// components/NavBar.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabaseClient";

type Role = "athlete" | "coach" | "admin";

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => getSupabase(), []);

  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (!ignore) setRole(null); return; }
        const { data, error } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();
        if (error) throw error;
        if (!ignore) setRole((data?.role as Role) ?? "athlete");
      } catch {
        if (!ignore) setRole("athlete");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [supabase]);

  // Where "home" should land based on role
  const homeHref = (role === "coach" || role === "admin") ? "/coach" : "/dashboard";

  async function logout() {
    try { await supabase.auth.signOut(); } finally { router.push("/login"); }
  }

  return (
    <div className="flex items-center gap-3 py-3">
      <Link href={homeHref} className="font-semibold text-lg">CSP</Link>

      {/* Center nav */}
      <div className="ml-4 flex items-center gap-2">
        {/* Athlete nav (keep Training + Log a Test) */}
        {!loading && role === "athlete" && (
          <>
            <Link href="/dashboard" className={`btn ${pathname === "/dashboard" ? "btn-dark" : ""}`}>Dashboard</Link>
            <Link href="/training" className={`btn ${pathname?.startsWith("/training") ? "btn-dark" : ""}`}>Training</Link>
            <Link href="/log" className={`btn ${pathname === "/log" ? "btn-dark" : ""}`}>Log a Test</Link>
          </>
        )}

        {/* Coach/Admin nav (hide Training/Log, and no "Coach" button) */}
        {!loading && (role === "coach" || role === "admin") && (
          <>
            <Link href="/coach" className={`btn ${pathname === "/coach" ? "btn-dark" : ""}`}>Overview</Link>
            {/* Add more coach tools here later, e.g. /coach/messages */}
          </>
        )}
      </div>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-2">
        {loading ? (
          <div className="text-xs text-slate-400">Loading…</div>
        ) : (
          <>
            {role && (
              <span className="text-xs px-2 py-1 rounded bg-white/5 border border-white/10 capitalize">
                {role}
              </span>
            )}
            <button className="btn" onClick={logout}>Sign out</button>
          </>
        )}
      </div>
    </div>
  );
}
