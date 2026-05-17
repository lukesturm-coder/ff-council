"use client";

import { useState, useTransition } from "react";
import { Check, ShieldCheck, ShieldOff, X } from "lucide-react";
import { setMemberStatus, toggleAdmin } from "./actions";

export type AdminMemberRow = {
  userId: string;
  email: string;
  displayName: string;
  bio: string | null;
  status: "pending" | "approved" | "inactive" | "rejected";
  isAdmin: boolean;
  joinedAt: string;
  submittedScoringSystems: string[];
};

const STATUS_STYLES: Record<AdminMemberRow["status"], string> = {
  pending: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  inactive: "bg-zinc-500/15 text-zinc-400 ring-zinc-500/30",
  rejected: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
};

export default function AdminTable({
  rows,
  currentUserId,
}: {
  rows: AdminMemberRow[];
  currentUserId: string;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function withBusy(
    userId: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    setBusyId(userId);
    setErrorMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) setErrorMsg(res.error);
      setBusyId(null);
    });
  }

  return (
    <div className="space-y-3">
      {errorMsg && (
        <p className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          {errorMsg}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/50 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="py-3 pl-4">Member</th>
              <th className="py-3 pl-2">Email</th>
              <th className="py-3 pl-2">Status</th>
              <th className="py-3 pl-2">Tryout</th>
              <th className="py-3 pl-2">Joined</th>
              <th className="py-3 pr-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelf = r.userId === currentUserId;
              const isBusy = busyId === r.userId;
              return (
                <tr
                  key={r.userId}
                  className="border-t border-zinc-800/60"
                >
                  <td className="py-3 pl-4">
                    <div className="font-medium text-zinc-100">
                      {r.displayName}
                      {r.isAdmin && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                          <ShieldCheck className="h-3 w-3" />
                          admin
                        </span>
                      )}
                      {isSelf && (
                        <span className="ml-2 text-xs text-zinc-500">
                          (you)
                        </span>
                      )}
                    </div>
                    {r.bio && (
                      <div className="text-xs text-zinc-500">{r.bio}</div>
                    )}
                  </td>
                  <td className="py-3 pl-2 font-mono text-xs text-zinc-400">
                    {r.email}
                  </td>
                  <td className="py-3 pl-2">
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLES[r.status]}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="py-3 pl-2 text-xs">
                    {r.submittedScoringSystems.length === 0 ? (
                      <span className="text-zinc-600">—</span>
                    ) : (
                      <span className="font-mono text-zinc-300">
                        {r.submittedScoringSystems.join(", ")}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pl-2 text-xs text-zinc-500">
                    {new Date(r.joinedAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center justify-end gap-1">
                      {r.status !== "approved" && (
                        <button
                          onClick={() =>
                            withBusy(r.userId, () =>
                              setMemberStatus(r.userId, "approved"),
                            )
                          }
                          disabled={isBusy}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-50"
                          title="Approve"
                        >
                          <Check className="h-3 w-3" /> Approve
                        </button>
                      )}
                      {r.status !== "rejected" && r.status !== "inactive" && (
                        <button
                          onClick={() =>
                            withBusy(r.userId, () =>
                              setMemberStatus(r.userId, "rejected"),
                            )
                          }
                          disabled={isBusy || isSelf}
                          className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"
                          title="Reject"
                        >
                          <X className="h-3 w-3" /> Reject
                        </button>
                      )}
                      {r.status === "approved" && (
                        <button
                          onClick={() =>
                            withBusy(r.userId, () =>
                              setMemberStatus(r.userId, "inactive"),
                            )
                          }
                          disabled={isBusy || isSelf}
                          className="rounded-md bg-zinc-700/30 px-2 py-1 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700/50 disabled:opacity-50"
                        >
                          Deactivate
                        </button>
                      )}
                      <button
                        onClick={() =>
                          withBusy(r.userId, () =>
                            toggleAdmin(r.userId, !r.isAdmin),
                          )
                        }
                        disabled={isBusy || (isSelf && r.isAdmin)}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs font-medium text-zinc-400 transition hover:bg-zinc-800 disabled:opacity-50"
                        title={r.isAdmin ? "Revoke admin" : "Make admin"}
                      >
                        {r.isAdmin ? (
                          <>
                            <ShieldOff className="h-3 w-3" /> Revoke
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="h-3 w-3" /> Make admin
                          </>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500">
        <span className="text-zinc-300">Tryout</span> column shows which
        scoring systems each member has submitted rankings for. Use it to
        gauge a pending member&apos;s effort before approving.
      </p>
    </div>
  );
}
