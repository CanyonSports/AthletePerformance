// components/NavBar.tsx
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabaseClient";

type Profile = {
  id: string;
  role: "athlete" | "coach" | "admin" | null;
};

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isCoach, setIsCoach] = useState(false);
  const [checkedRole, setCheckedRole] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isSupabaseConfigured) { setCheckedRole(true); return; }
        const supabase = getSupabase();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setCheckedRole(true); return; }
        const { data, error } = await supabase
          .from("profiles")
          .select("id, role")
          .eq("id", user.id)
          .single();
        if (error) throw error;
        if (!cancelled) {
          const role = (data as Profile | null)?.role ?? "athlete";
          setIsCoach(role === "coach" || role === "admin");
          setCheckedRole(true);
        }
      } catch {
        if (!cancelled) { setCheckedRole(true); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const active = (href: string) => (pathname === href ? "btn-pine" : "btn-dark");
  const signOut = async () => {
    try { if (isSupabaseConfigured) await getSupabase().auth.signOut(); } catch {}
    router.push("/login");
  };

  return (
    <div className="mt-4 flex items-center gap-3">
      <a href="/dashboard" className={`px-3 py-2 rounded-lg ${active("/dashboard")}`}>Dashboard</a>
      <a href="/training"  className={`px-3 py-2 rounded-lg ${active("/training")}`}>Training</a>
      <a href="/log"       className={`px-3 py-2 rounded-lg ${active("/log")}`}>Log a Test</a>

      {/* Only render Coach when role allows. We wait for role check to avoid flicker. */}
      {checkedRole && isCoach && (
        <a href="/coach-console" className={`px-3 py-2 rounded-lg ${active("/coach-console")}`}>Coach</a>
      )}

      <button onClick={signOut} className="ml-auto btn btn-dark">Sign Out</button>
    </div>
  );
}
