"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { BrandMark } from "./BrandMark";
import { LanguageSwitcher } from "./LanguageSwitcher";

const MIN_PASSWORD = 10;

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const { t, language } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === "signup"
          ? {
              name: form.get("name"),
              email: form.get("email"),
              password: form.get("password"),
              uiLanguage: language,
            }
          : { email: form.get("email"), password: form.get("password") };
      await api(`/v1/auth/${mode}`, { method: "POST", body });
      router.push("/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401 ? t("auth.invalidCredentials") : t("common.error"),
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
        <h2 className="text-xl font-semibold">{mode === "login" ? t("auth.signIn") : t("auth.signUp")}</h2>
        {mode === "signup" && (
          <label className="flex flex-col gap-1 text-sm">
            {t("auth.name")}
            <input className="input" name="name" required autoComplete="name" />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          {t("auth.email")}
          <input className="input" name="email" type="email" required autoComplete="email" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("auth.password")}
          <input
            className="input"
            name="password"
            type="password"
            required
            minLength={mode === "signup" ? MIN_PASSWORD : undefined}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
          {mode === "signup" && (
            <span className="muted text-xs">{t("auth.passwordHint", { min: MIN_PASSWORD })}</span>
          )}
        </label>
        {error && (
          <p className="error text-sm" role="alert">
            {error}
          </p>
        )}
        <button className="btn mt-1 justify-center" type="submit" disabled={busy}>
          {busy ? t("common.loading") : mode === "login" ? t("auth.signIn") : t("auth.signUp")}
        </button>
      </form>
      <p className="muted text-center text-sm">
        {mode === "login" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
        <Link
          className="font-medium text-[var(--accent)] underline-offset-4 hover:underline"
          href={mode === "login" ? "/signup" : "/login"}
        >
          {mode === "login" ? t("auth.signUp") : t("auth.signIn")}
        </Link>
      </p>
    </main>
  );
}
