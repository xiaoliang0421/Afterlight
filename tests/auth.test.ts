import test from "node:test";
import assert from "node:assert/strict";
import { memoryAdapter } from "better-auth/adapters/memory";
import { getIP } from "@better-auth/core/utils/ip";
import { createAuth } from "../worker/auth";

test("hosted auth identifies each Cloudflare visitor independently of forwarded proxy chains", async () => {
  const auth = createAuth({
    DB: memoryAdapter({}),
    PUBLIC_ORIGIN: "https://app.tailrelay.com",
    BETTER_AUTH_SECRET: "synthetic-auth-test-secret-not-a-real-credential",
  } as unknown as Cloudflare.Env);
  await auth.$context;
  for (const visitor of ["203.0.113.10", "203.0.113.11"]) {
    const headers = new Headers({
      "CF-Connecting-IP": visitor,
      "X-Forwarded-For": "198.51.100.1, 198.51.100.2",
    });
    assert.equal(getIP(headers, auth.options), visitor);
    headers.set("X-Forwarded-For", "198.51.100.99");
    assert.equal(getIP(headers, auth.options), visitor);
  }
  assert.notEqual(
    getIP(new Headers({ "X-Forwarded-For": "198.51.100.99" }), auth.options),
    "198.51.100.99",
  );
});
