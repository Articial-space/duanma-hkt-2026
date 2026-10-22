// S12 mode detection tests (SPEC v5): isTideConfigured(cfg) is true iff cfg.realm and cfg["auth-server-url"]
// are non-empty strings. The module lives in the web app, outside core: SPEC paths for the app are relative to
// the Next.js root `impl/app` (S11 `app/layout.tsx`, `app/lib/tv.ts`), so `app/lib/mode.ts` = `impl/app/app/lib/mode.ts`.
import { describe, expect, it } from "vitest";
import { isTideConfigured } from "../../app/app/lib/mode.js";

type Cfg = Parameters<typeof isTideConfigured>[0];
const cfg = (o: Record<string, unknown>): Cfg => o as unknown as Cfg;

/** Shape of a TideCloak adapter config (synthetic values only). */
const SAMPLE: Record<string, unknown> = {
  realm: "nextjs-test",
  "auth-server-url": "http://localhost:8080",
  "ssl-required": "external",
  resource: "myclient",
  "public-client": true,
  "confidential-port": 0,
  jwk: { keys: [{ kid: "synthetic-kid", kty: "OKP", alg: "EdDSA", use: "sig", crv: "Ed25519", x: "AAAA" }] },
  vendorId: "synthetic-vendor-id",
  homeOrkUrl: "http://localhost:1001",
};

describe("S12 isTideConfigured", () => {
  it("returns true for a realistic adapter config", () => {
    expect(isTideConfigured(cfg(SAMPLE))).toBe(true);
  });

  it("returns true for the minimal config with only realm and auth-server-url", () => {
    expect(isTideConfigured(cfg({ realm: "nextjs-test", "auth-server-url": "http://localhost:8080" }))).toBe(true);
  });

  it("returns false for the placeholder {}", () => {
    expect(isTideConfigured(cfg({}))).toBe(false);
  });

  it("returns false when realm is missing", () => {
    const { realm: _r, ...rest } = SAMPLE;
    expect(isTideConfigured(cfg(rest))).toBe(false);
  });

  it("returns false when auth-server-url is missing", () => {
    const { "auth-server-url": _u, ...rest } = SAMPLE;
    expect(isTideConfigured(cfg(rest))).toBe(false);
  });

  it("does not accept a camelCase authServerUrl in place of auth-server-url", () => {
    const { "auth-server-url": u, ...rest } = SAMPLE;
    expect(isTideConfigured(cfg({ ...rest, authServerUrl: u }))).toBe(false);
  });

  it("returns false when realm is an empty string", () => {
    expect(isTideConfigured(cfg({ ...SAMPLE, realm: "" }))).toBe(false);
  });

  it("returns false when auth-server-url is an empty string", () => {
    expect(isTideConfigured(cfg({ ...SAMPLE, "auth-server-url": "" }))).toBe(false);
  });

  it("returns false when both are empty strings", () => {
    expect(isTideConfigured(cfg({ realm: "", "auth-server-url": "" }))).toBe(false);
  });

  it.each([
    ["number", 1],
    ["boolean true", true],
    ["null", null],
    ["undefined", undefined],
    ["object", { name: "nextjs-test" }],
    ["array", ["nextjs-test"]],
  ])("returns false when realm is a non-string (%s)", (_label, v) => {
    expect(isTideConfigured(cfg({ ...SAMPLE, realm: v }))).toBe(false);
  });

  it.each([
    ["number", 8080],
    ["boolean true", true],
    ["null", null],
    ["undefined", undefined],
    ["object", { href: "http://localhost:8080" }],
    ["array", ["http://localhost:8080"]],
  ])("returns false when auth-server-url is a non-string (%s)", (_label, v) => {
    expect(isTideConfigured(cfg({ ...SAMPLE, "auth-server-url": v }))).toBe(false);
  });

  it("returns a boolean, not a truthy/falsy value", () => {
    expect(typeof isTideConfigured(cfg(SAMPLE))).toBe("boolean");
    expect(typeof isTideConfigured(cfg({}))).toBe("boolean");
    expect(typeof isTideConfigured(cfg({ realm: "", "auth-server-url": "" }))).toBe("boolean");
  });

  it("does not mutate its input", () => {
    const input = JSON.parse(JSON.stringify(SAMPLE)) as Record<string, unknown>;
    isTideConfigured(cfg(input));
    expect(input).toEqual(SAMPLE);
  });
});
