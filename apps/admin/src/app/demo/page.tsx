"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/**
 * Where a customer opens the demo an operator prepared for them: they enter the access code they
 * were given (shown in the operator console's Demos tab; later sent by email) and land on their
 * dashboard, signed in to their demo business.
 */
export default function DemoSignInPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    setBusy(true);
    setError(null);
    try {
      await api("/v1/auth/demo", { method: "POST", body: { code } });
      router.push("/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiError && (err.status === 401 || err.status === 400)
          ? t("demo.invalidCode")
          : err instanceof ApiError && err.status === 429
            ? t("auth.tooManyAttempts")
            : t("common.error"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-3 text-2xl font-semibold">
          <BrandMark size={40} />
          {t("app.name")}
        </h1>
        <LanguageSwitcher />
      </div>
      <form className="card flex flex-col gap-5 p-6 sm:p-8" onSubmit={onSubmit}>
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">{t("demo.title")}</h2>
          <p className="muted text-sm">{t("demo.intro")}</p>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          {t("demo.code")}
          <input
            className="input font-mono uppercase tracking-widest"
            name="code"
            required
            maxLength={40}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby="demo-code-hint"
          />
          <span id="demo-code-hint" className="muted text-xs">
            {t("demo.codeHint")}
          </span>
        </label>
        {error && (
          <p className="error text-sm" role="alert">
            {error}
          </p>
        )}
        <button className="btn mt-1 justify-center" type="submit" disabled={busy}>
          {busy ? t("common.loading") : t("demo.open")}
        </button>
      </form>
      <p className="muted text-center text-sm">
        {t("auth.haveAccount")}{" "}
        <Link className="font-medium text-[var(--accent)] underline-offset-4 hover:underline" href="/login">
          {t("auth.signIn")}
        </Link>
      </p>
    </main>
  );
}
