import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { withLeaseRenewal } from "../src/heartbeat.ts";

test("a long handler renews repeatedly, recovers from a transient renewal error and stops on completion", async () => {
  const work = Promise.withResolvers();
  const timeout = setTimeout(() => work.reject(new Error("Expected three renewals")), 5000);
  const errors = [];
  let calls = 0;
  try {
    await withLeaseRenewal(
      () => work.promise,
      async () => {
        calls++;
        if (calls === 1) throw new Error("temporary database error");
        if (calls === 3) work.resolve();
        return true;
      },
      5,
      (error) => errors.push(error.message),
    );
    await delay(20);
    assert.equal(calls, 3);
    assert.deepEqual(errors, ["temporary database error"]);
  } finally {
    clearTimeout(timeout);
  }
});

test("a lost lease stops the heartbeat while the handler finishes", async () => {
  const lost = Promise.withResolvers();
  const timeout = setTimeout(() => lost.reject(new Error("Expected a renewal")), 5000);
  let calls = 0;
  try {
    await assert.rejects(
      withLeaseRenewal(
        async () => {
          await lost.promise;
          await delay(20);
          throw new Error("handler failed");
        },
        async () => {
          calls++;
          lost.resolve();
          return false;
        },
        5,
        assert.fail,
      ),
      /handler failed/,
    );
    assert.equal(calls, 1);
  } finally {
    clearTimeout(timeout);
  }
});
