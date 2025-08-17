// app/coach-console/[athleteId]/session/[planItemId]/edit/page.tsx
"use client";

import { useParams } from "next/navigation";
import NavBar from "@/components/NavBar";
import ProgramBuilder from "@/components/ProgramBuilder";

export default function CoachSessionEditPage() {
  const { athleteId, planItemId } = useParams<{ athleteId: string; planItemId: string }>();

  return (
    <div className="max-w-7xl mx-auto">
      <NavBar />
      <ProgramBuilder
        athleteId={athleteId}
        planItemId={planItemId}   // can be an id, or the literal "new"
        initialDate={undefined}   // optional; builder uses today if omitted
      />
    </div>
  );
}
