"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api, type Me } from "@/lib/api";

/** The signed-in user and their businesses; sends them to sign in when the session is gone. */
export function useMe(): { me: Me | null; error: boolean } {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api<Me>("/v1/auth/me")
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setError(true);
      });
  }, [router]);
  return { me, error };
}

const LAST_TENANT = "tb_last_tenant";

/** The business the owner app opened last (the inbox is per business). */
export function lastTenant(): string | null {
  try {
    return localStorage.getItem(LAST_TENANT);
  } catch {
    return null;
  }
}

export function rememberTenant(id: string) {
  try {
    localStorage.setItem(LAST_TENANT, id);
  } catch {
    // private mode
  }
}
