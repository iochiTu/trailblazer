import type { FastifyInstance } from "fastify";

/** Signs a new user up and returns their session cookie. The email is added to `emails`, for clean-up. */
export async function newUser(app: FastifyInstance, emails: string[], name: string) {
  const email = `${name}-${crypto.randomUUID().slice(0, 8)}@test.local`;
  emails.push(email);
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email, password: "correct-horse-battery", name },
  });
  return `tb_session=${res.cookies.find((c) => c.name === "tb_session")!.value}`;
}

/** Creates a business for the signed-in user. Its id is added to `tenantIds`, for clean-up. */
export async function newTenant(
  app: FastifyInstance,
  tenantIds: string[],
  sessionCookie: string,
  name: string,
) {
  const id = (
    await app.inject({
      method: "POST",
      url: "/v1/tenants",
      headers: { cookie: sessionCookie },
      payload: { name },
    })
  ).json().tenant.id as string;
  tenantIds.push(id);
  return id;
}
