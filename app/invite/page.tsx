// app/invite/[token]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabaseClient";

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    // Optional: if envs are missing, let user know
    if (!isSupabaseConfigured) setStatus("Supabase env not set. Add .env.local and restart.");
  }, []);

  async function acceptInvite() {
    setStatus("Accepting invite…");
    try {
      if (!isSupabaseConfigured) throw new Error("Supabase not configured");
      const supabase = getSupabase();

      // Require auth
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setStatus("Please sign in first.");
        router.push(`/login?next=/invite/${token}`);
        return;
      }

      // Call secure RPC to link coach↔athlete
      const { data, error } = await supabase.rpc("accept_coach_invite", { p_token: String(token) });
      if (error) throw error;

      setStatus(data === "accepted" ? "Invite accepted! You're linked to your coach." : String(data));
    } catch (e: any) {
      setStatus(e.message ?? String(e));
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <NavBar />
      <div className="card p-4 mt-6">
        <h1 className="text-2xl font-semibold">Accept Coach Invite</h1>
        <p className="text-sm" style={{ color: "var(--muted)", marginTop: 6 }}>
          Token: <code>{String(token)}</code>
        </p>

        <div className="flex gap-8 mt-4">
          <button className="btn btn-pine" onClick={acceptInvite}>Accept Invite</button>
          <button
            className="btn btn-dark"
            onClick={() => router.push("/login?next=" + encodeURIComponent(`/invite/${token}`))}
          >
            Sign in with another account
          </button>
        </div>

        {status ? <p className="text-sm mt-3" style={{ color: status.includes("!")
          ? "#34d399" : "var(--muted)" }}>{status}</p> : null}

        <div className="mt-6">
          <a className="btn btn-dark" href="/training">Go to Training</a>
        </div>
      </div>
    </div>
  );
}
