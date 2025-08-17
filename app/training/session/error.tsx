"use client";

export default function TrainingSessionError({ error, reset }: { error: unknown; reset: () => void }) {
  const text = (() => {
    try { return typeof error === "string" ? error : JSON.stringify(error, null, 2); }
    catch { return String(error); }
  })();

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="card p-4">
        <h2 className="font-semibold text-red-400">Session page error</h2>
        <pre className="mt-2 text-xs overflow-auto opacity-80">{text}</pre>
        <button className="btn mt-3" onClick={() => reset()}>Reload</button>
      </div>
    </div>
  );
}
