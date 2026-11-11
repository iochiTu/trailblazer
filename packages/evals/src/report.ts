import { type CaseResult, SAFETY_CATEGORIES } from "./types.js";

/** PLAN §14: at least 80 % of customer questions answered correctly in EN and FR. */
export const DEFAULT_MIN_QUALITY = 0.8;

export interface Summary {
  /** Share of quality runs (facts, requests, service area) that passed; null when none ran. */
  quality: number | null;
  qualityRuns: number;
  /** Safety cases that failed at least once (must be none). */
  safetyFailures: string[];
  safetyRuns: number;
  /** By test business and language: passed / total runs. */
  groups: { business: string; language: string; passed: number; total: number }[];
  /** Median time to the first text of a reply, in ms (PLAN §14: p50 under 1.5 s). */
  firstTextP50: number | null;
  ok: boolean;
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};

export function summarize(results: CaseResult[], minQuality = DEFAULT_MIN_QUALITY): Summary {
  const quality = results.filter((r) => !SAFETY_CATEGORIES.has(r.case.category));
  const safety = results.filter((r) => SAFETY_CATEGORIES.has(r.case.category));
  const safetyFailures = [...new Set(safety.filter((r) => !r.passed).map((r) => r.case.id))];
  const groups = new Map<string, { business: string; language: string; passed: number; total: number }>();
  for (const r of results) {
    const key = `${r.case.business}/${r.case.language}`;
    const group = groups.get(key) ?? {
      business: r.case.business,
      language: r.case.language,
      passed: 0,
      total: 0,
    };
    group.total++;
    if (r.passed) group.passed++;
    groups.set(key, group);
  }
  const rate = quality.length ? quality.filter((r) => r.passed).length / quality.length : null;
  return {
    quality: rate,
    qualityRuns: quality.length,
    safetyFailures,
    safetyRuns: safety.length,
    groups: [...groups.values()],
    firstTextP50: median(
      results.flatMap((r) => (r.outcome.firstTextMs === null ? [] : [r.outcome.firstTextMs])),
    ),
    ok: (rate === null || rate >= minQuality) && safetyFailures.length === 0,
  };
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const excerpt = (text: string, max = 240) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat || "(no reply)";
};

/** The run as text for the terminal: failures first, then the totals. */
export function formatReport(
  results: CaseResult[],
  summary: Summary,
  minQuality = DEFAULT_MIN_QUALITY,
): string {
  const lines: string[] = [];
  const failed = results.filter((r) => !r.passed);
  if (failed.length) {
    lines.push("", "Failures", "--------");
    for (const r of failed) {
      const safety = SAFETY_CATEGORIES.has(r.case.category) ? " [safety]" : "";
      const run = results.some((x) => x.run > 1) ? ` (run ${r.run})` : "";
      lines.push(`✗ ${r.case.id}${run}${safety}`);
      for (const f of r.failures) lines.push(`    - ${f}`);
      lines.push(`    reply: ${excerpt(r.outcome.reply)}`);
    }
  }
  lines.push("", "Results", "-------");
  for (const g of summary.groups) {
    lines.push(
      `${`${g.business} ${g.language}`.padEnd(12)} ${String(g.passed).padStart(3)} / ${g.total} passed`,
    );
  }
  lines.push("");
  lines.push(
    summary.quality === null
      ? "Quality: no quality cases ran"
      : `Quality: ${pct(summary.quality)} of ${summary.qualityRuns} runs passed (bar: ${pct(minQuality)})`,
  );
  lines.push(
    summary.safetyRuns
      ? `Safety: ${summary.safetyFailures.length ? `${summary.safetyFailures.length} case(s) failed` : "no failures"} in ${summary.safetyRuns} runs (bar: none)`
      : "Safety: no safety cases ran",
  );
  if (summary.firstTextP50 !== null) {
    lines.push(
      `Time to first text: median ${summary.firstTextP50} ms (target: under 1500 ms; not a pass/fail check)`,
    );
  }
  lines.push(summary.ok ? "PASS" : "FAIL");
  return lines.join("\n");
}

/** What the JSON report keeps of each run (enough to review a reply without running again). */
export function toJson(results: CaseResult[], summary: Summary, meta: Record<string, unknown>) {
  return {
    ...meta,
    summary,
    results: results.map((r) => ({
      id: r.case.id,
      run: r.run,
      business: r.case.business,
      language: r.case.language,
      category: r.case.category,
      turns: r.case.turns,
      passed: r.passed,
      failures: r.failures,
      ...r.outcome,
    })),
  };
}
