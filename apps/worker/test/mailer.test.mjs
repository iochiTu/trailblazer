import assert from "node:assert/strict";
import { test } from "node:test";
import { createMailerFromEnv } from "../src/mailer.ts";

test("missing SMTP fails delivery and keeps customer details out of logs", async () => {
  const message = { to: ["private@example.com"], subject: "Urgent", text: "Customer details" };
  const logs = [];
  for (const env of [{}, { NODE_ENV: "production", MAIL_SIMULATE: "true" }, { NODE_ENV: "development" }]) {
    await assert.rejects(createMailerFromEnv(env, (...args) => logs.push(args)).send(message), /SMTP_URL/);
  }
  assert.deepEqual(logs, []);
  await createMailerFromEnv({ NODE_ENV: "development", MAIL_SIMULATE: "true" }, (...args) =>
    logs.push(args),
  ).send(message);
  assert.deepEqual(logs, [["email delivery simulated"]]);
});
