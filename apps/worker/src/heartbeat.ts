import { setInterval } from "node:timers/promises";

/** Renew one claim while its handler runs, with at most one renewal in flight. */
export async function withLeaseRenewal(
  run: () => Promise<void>,
  renew: () => Promise<boolean>,
  intervalMs: number,
  onError: (error: unknown) => void,
): Promise<void> {
  const stop = new AbortController();
  const heartbeat = (async () => {
    try {
      for await (const _ of setInterval(intervalMs, undefined, { signal: stop.signal, ref: false })) {
        try {
          if (!(await renew())) return;
        } catch (error) {
          onError(error);
        }
      }
    } catch (error) {
      if (!stop.signal.aborted) throw error;
    }
  })();
  try {
    await run();
  } finally {
    stop.abort();
    await heartbeat;
  }
}
