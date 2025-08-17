"use client";
import { useState } from "react";
import { getSupabase, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type Role = "athlete" | "coach" | "admin";

export default function LoginPage(){
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [health, setHealth] = useState<string | null>(null);
  const router = useRouter();

  const routeForRole = (role: Role | null | undefined) =>
    role === "coach" || role === "admin" ? "/coach" : "/dashboard";

  const checkHealth = async () => {
    if (!isSupabaseConfigured) { setHealth("Env not set"); return; }
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, { cache: "no-store" });
      setHealth(res.ok ? "OK" : `HTTP ${res.status}`);
    } catch {
      setHealth("Cannot reach auth endpoint");
    }
  };

  const signIn = async () => {
    setStatus("Signing in…");
    try {
      const supabase = getSupabase();

      // 1) Auth
      const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
      if (authErr) throw authErr;

      // 2) Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Signed in, but no active session found.");

      // 3) Fetch role; create default profile if missing
      const { data: profile, error: profErr } = await supabase
        .from("profiles")
        .select("role,email")
        .eq("id", user.id)
        .maybeSingle();

      let role: Role = "athlete";
      if (!profile) {
        // Create a default profile if it doesn't exist
        await supabase.from("profiles").upsert({
          id: user.id,
          email: user.email ?? email,
          role: "athlete",
        });
      } else {
        role = (profile.role as Role) ?? "athlete";
      }

      setStatus("Redirecting…");
      router.replace(routeForRole(role));
    } catch (e: any) {
      setStatus(e.message ?? String(e));
    }
  };

  const signUp = async () => {
    setStatus("Creating account…");
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { emailRedirectTo: `${location.origin}/login?confirmed=1` }
      });
      if (error) throw error;

      // Optionally create a profiles row immediately if we got a user ID back.
      if (data.user?.id) {
        await supabase.from("profiles").upsert({
          id: data.user.id,
          email: data.user.email ?? email,
          role: "athlete",
        });
      }

      setStatus("Account created! Check your email to confirm.");
    } catch (e:any) { setStatus(e.message ?? String(e)); }
  };

  return (
    <div className="max-w-lg mx-auto mt-12 card p-6">
      <h2 className="text-2xl font-semibold mb-2">Welcome</h2>
      <p className="text-slate-300 mb-6">Sign in or create an account to access your dashboard.</p>

      <div className="space-y-4">
        <div>
          <label className="block mb-1">Email</label>
          <input
            value={email}
            onChange={e=>setEmail(e.target.value)}
            type="email"
            className="w-full p-3 rounded bg-white/5 border border-white/10"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="block mb-1">Password</label>
          <input
            value={password}
            onChange={e=>setPassword(e.target.value)}
            type="password"
            className="w-full p-3 rounded bg-white/5 border border-white/10"
            placeholder="••••••••"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 mt-6">
        <button className="btn-pine" onClick={signIn}>Sign In</button>
        <button className="btn-dark" onClick={signUp}>Sign Up</button>
      </div>

      <div className="flex items-center gap-2 mt-3 text-xs">
        <button className="btn-dark" onClick={checkHealth}>Test Supabase Connection</button>
        {health ? <span>Status: {health}</span> : null}
      </div>

      <p className="text-sm mt-3">{status}</p>
    </div>
  );
}
