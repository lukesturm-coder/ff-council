"use client";

import { useEffect } from "react";

// Remembers the league you're viewing so /league can auto-open it next time.
export default function SaveLeague({ id }: { id: string }) {
  useEffect(() => {
    try {
      localStorage.setItem("ffc-league", id);
    } catch {
      // ignore private-mode / quota failures
    }
  }, [id]);
  return null;
}
