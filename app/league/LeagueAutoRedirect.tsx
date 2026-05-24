"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// On /league, jump straight to your remembered league — unless the user came
// here deliberately to switch (?change=1).
export default function LeagueAutoRedirect({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (disabled) return;
    try {
      const id = localStorage.getItem("ffc-league");
      if (id && /^\d{15,20}$/.test(id)) router.replace(`/league/${id}`);
    } catch {
      // ignore
    }
  }, [disabled, router]);
  return null;
}
