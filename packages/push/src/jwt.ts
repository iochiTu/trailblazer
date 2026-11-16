import { createPrivateKey, sign } from "node:crypto";

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/**
 * A signed JSON Web Token: RS256 for Google service accounts, ES256 for Apple's .p8 keys (the
 * signature in the raw r||s form JWTs use, not DER).
 */
export function signJwt(
  alg: "RS256" | "ES256",
  header: Record<string, string>,
  claims: Record<string, unknown>,
  privateKeyPem: string,
): string {
  const input = `${b64url(JSON.stringify({ alg, typ: "JWT", ...header }))}.${b64url(JSON.stringify(claims))}`;
  const key = createPrivateKey(privateKeyPem);
  const signature =
    alg === "ES256"
      ? sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" })
      : sign("sha256", Buffer.from(input), key);
  return `${input}.${b64url(signature)}`;
}

/** PEM keys pasted into an environment variable often carry literal "\n". */
export const pemFromEnv = (value: string) => value.replace(/\\n/g, "\n").trim();
