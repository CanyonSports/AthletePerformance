
"use client";
import { useState } from "react";
import { getSupabase, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function LoginPage(){
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [health, setHealth] = useState<string | null>(null);
  const router = useRouter();

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
    setStatus("Signing in...");
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setStatus("Signed in!"); router.push("/dashboard");
    } catch (e:any) { setStatus(e.message ?? String(e)); }
  };
  const signUp = async () => {
    setStatus("Creating account...");
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { emailRedirectTo: `${location.origin}/login?confirmed=1` }
      });
      if (error) throw error;
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
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email" className="w-full p-3 rounded bg-white/5 border border-white/10" placeholder="you@example.com" />
        </div>
        <div>
          <label className="block mb-1">Password</label>
          <input value={password} onChange={e=>setPassword(e.target.value)} type="password" className="w-full p-3 rounded bg-white/5 border border-white/10" placeholder="••••••••" />
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
