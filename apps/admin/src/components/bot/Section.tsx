import type { ReactNode } from "react";

/** A titled group of settings on an assistant's tab, with an optional hint under the title. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        {hint && <p className="muted text-sm">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
