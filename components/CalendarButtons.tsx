// components/CalendarButtons.tsx
"use client";

import React from "react";
import Link from "next/link";
import { Calendar } from "lucide-react";

/**
 * Header button: drop this inside the header of your athlete dashboard (/training)
 * next to your week picker or action buttons.
 */
export function CalendarLinkButton() {
  return (
    <Link href="/training/calendar" className="btn" aria-label="Open calendar view">
      <Calendar className="w-4 h-4 mr-2" /> Calendar
    </Link>
  );
}

/**
 * Optional: Floating Action Button for mobile convenience
 * Place <CalendarFAB /> once near the end of your /training page JSX (inside the page wrapper)
 */
export function CalendarFAB() {
  return (
    <Link
      href="/training/calendar"
      aria-label="Open calendar view"
      className="fixed bottom-5 right-5 z-40 rounded-full shadow-lg px-4 py-3"
      style={{ background: "#111827", border: "1px solid #1f2937" }}
    >
      <span className="inline-flex items-center text-sm">
        <Calendar className="w-4 h-4 mr-2" /> Calendar
      </span>
    </Link>
  );
}
