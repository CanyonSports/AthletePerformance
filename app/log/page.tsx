
"use client";
import { useEffect, useState } from "react";
import NavBar from "@/components/NavBar";
import ProtocolForm from "@/components/ProtocolForm";
import type { Protocol } from "@/lib/schema";
import protocols from "@/public/protocols.json";
import { getSupabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function LogPage(){
  const [sport, setSport] = useState("climbing");
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [status, setStatus] = useState("");
  const router = useRouter();

  const sportProtocols = (protocols as Protocol[]).filter(p => p.sport === sport);

  useEffect(() => { setProtocol(sportProtocols[0] ?? null); }, [sport]);

  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) router.push("/login");
      } catch {}
    })();
  }, [router]);

  async function submit(payload: Record<string, any>){
    setStatus("Saving…");
    try {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in first.");
      const { error } = await supabase.from("measurements").insert({
        user_id: user.id,
        sport,
        test_date: new Date().toISOString().slice(0,10),
        data: payload
      });
      if (error) throw error;
      setStatus("Saved!");
    } catch (e:any) {
      setStatus(e.message ?? String(e));
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <NavBar />
      <div className="mt-6 card p-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-300">Sport:</span>
        <select value={sport} onChange={e=>setSport(e.target.value)} className="px-3 py-2 rounded bg-white/5 border border-white/10">
          <option value="climbing">Climbing</option>
          <option value="ski">Ski</option>
          <option value="mtb">MTB</option>
          <option value="running">Running</option>
        </select>

        <span className="text-sm text-slate-300 ml-4">Protocol:</span>
        <select value={protocol?.id ?? ""} onChange={e=>setProtocol(sportProtocols.find(p => p.id === e.target.value) || null)}
          className="px-3 py-2 rounded bg-white/5 border border-white/10">
          {sportProtocols.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
      </div>

      <div className="mt-6">
        {protocol ? <ProtocolForm protocol={protocol} onSubmit={submit} /> : <p>No protocol available.</p>}
        <p className="text-sm mt-3">{status}</p>
      </div>
    </div>
  );
}
