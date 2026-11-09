"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface UserRow {
  id: string;
  email: string;
  name: string;
  platformRole: "super_admin" | null;
  createdAt: string;
  businesses: { id: string; name: string; role: string }[];
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { dateStyle: "medium" });

/** Every account on the platform: business users with their businesses, and staff accounts. */
export function UsersTab({ onOpenBusiness }: { onOpenBusiness: (tenantId: string) => void }) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserRow[] | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      api<{ users: UserRow[] }>(`/v1/operator/users?q=${encodeURIComponent(query)}`)
        .then((res) => setUsers(res.users))
        .catch(() => setUsers([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Users</h2>
        <input
          className="input max-w-xs"
          type="search"
          placeholder="Search name, email or business"
          aria-label="Search users"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="muted text-sm">
        Staff accounts can't belong to businesses. To give someone staff access, run{" "}
        <code>pnpm --filter @traiblazer/api superadmin grant &lt;email&gt;</code> on a dedicated account.
      </p>
      {!users ? (
        <p className="muted">Loading…</p>
      ) : users.length === 0 ? (
        <p className="muted text-sm">No users match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="muted text-left">
              <tr>
                <th className="py-2 pr-4 font-normal">User</th>
                <th className="py-2 pr-4 font-normal">Businesses</th>
                <th className="py-2 font-normal">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-[var(--border)] align-top">
                  <td className="py-3 pr-4">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {u.name}
                      {u.platformRole && <span className="badge badge-accent font-normal">Super admin</span>}
                    </div>
                    <div className="muted text-xs">{u.email}</div>
                  </td>
                  <td className="py-3 pr-4">
                    {u.businesses.length === 0 ? (
                      <span className="muted">{u.platformRole ? "Staff" : "None yet"}</span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {u.businesses.map((b) => (
                          <li key={b.id}>
                            <button type="button" className="underline" onClick={() => onOpenBusiness(b.id)}>
                              {b.name}
                            </button>{" "}
                            <span className="muted text-xs">· {b.role}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="py-3 tabular-nums">{fmtDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
