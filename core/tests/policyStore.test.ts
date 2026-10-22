// S12b policyStore tests (SPEC v5). Deterministic: explicit `now` values only.
import { describe, expect, it } from "vitest";
import { createPolicyStore } from "../src/policyStore.js";

const T0 = 1_700_000_000_000;
const TTL_MS = 900_000;

type PutArg = Parameters<ReturnType<typeof createPolicyStore>["put"]>[0];

function entry(over: Partial<Record<keyof PutArg, unknown>> = {}): PutArg {
  return {
    subjectType: "User",
    subjectId: "tuk-ai-operator",
    recordId: "fb-demo1001",
    access: "read",
    policyB64: "UE9MSUNZLXJlYWQtMQ==",
    expiresAt: T0 + TTL_MS,
    grantedBy: "realm-admin",
    createdAt: T0,
    ...over,
  } as PutArg;
}

function query(e: PutArg, now: number) {
  return {
    subjectType: e.subjectType,
    subjectId: e.subjectId,
    recordId: e.recordId,
    access: e.access,
    now,
  } as Parameters<ReturnType<typeof createPolicyStore>["getFor"]>[0];
}

function keyOf(e: { subjectType: unknown; subjectId: unknown; recordId: unknown; access: unknown }): string {
  return [e.subjectType, e.subjectId, e.recordId, e.access].join("|");
}

describe("S12b createPolicyStore — getFor", () => {
  it("returns null on an empty store", () => {
    const s = createPolicyStore();
    expect(s.getFor(query(entry(), T0))).toBeNull();
  });

  it("returns the stored entry while now < expiresAt", () => {
    const s = createPolicyStore();
    const e = entry();
    s.put(e);
    expect(s.getFor(query(e, T0))).toMatchObject({ ...e });
    expect(s.getFor(query(e, T0 + TTL_MS - 1))).toMatchObject({ ...e });
  });

  it("returns null exactly at expiresAt (now === expiresAt)", () => {
    const s = createPolicyStore();
    const e = entry();
    s.put(e);
    expect(s.getFor(query(e, T0 + TTL_MS))).toBeNull();
  });

  it("returns null after expiresAt", () => {
    const s = createPolicyStore();
    const e = entry();
    s.put(e);
    expect(s.getFor(query(e, T0 + TTL_MS + 1))).toBeNull();
    expect(s.getFor(query(e, T0 + 10 * TTL_MS))).toBeNull();
  });

  it("an entry with expiresAt === null never expires", () => {
    const s = createPolicyStore();
    const e = entry({ subjectType: "Role", subjectId: "_tide_encryptor", access: "write", expiresAt: null });
    s.put(e);
    expect(s.getFor(query(e, T0))).toMatchObject({ ...e });
    expect(s.getFor(query(e, T0 + 1000 * TTL_MS))).toMatchObject({ ...e });
    expect(s.getFor(query(e, Number.MAX_SAFE_INTEGER))).toMatchObject({ ...e, expiresAt: null });
  });

  it("does not match a different subjectId", () => {
    const s = createPolicyStore();
    const e = entry();
    s.put(e);
    expect(s.getFor(query(entry({ subjectId: "tuk-someone-else" }), T0))).toBeNull();
  });

  it("does not match a different subjectType with the same subjectId", () => {
    const s = createPolicyStore();
    const e = entry();
    s.put(e);
    expect(s.getFor(query(entry({ subjectType: "Role" }), T0))).toBeNull();
  });

  it("does not match a different recordId", () => {
    const s = createPolicyStore();
    const e = entry();
    s.put(e);
    expect(s.getFor(query(entry({ recordId: "fb-demo2002" }), T0))).toBeNull();
  });

  it("does not match a different access", () => {
    const s = createPolicyStore();
    const e = entry();
    s.put(e);
    expect(s.getFor(query(entry({ access: "write" }), T0))).toBeNull();
  });
});

describe("S12b createPolicyStore — put replace semantics", () => {
  it("put with the same subjectType+subjectId+recordId+access replaces the entry", () => {
    const s = createPolicyStore();
    const first = entry();
    const second = entry({ policyB64: "UE9MSUNZLXJlYWQtMg==", expiresAt: T0 + 2 * TTL_MS, createdAt: T0 + 5000, grantedBy: "other-admin" });
    s.put(first);
    s.put(second);
    expect(s.list()).toHaveLength(1);
    expect(s.list()[0]).toMatchObject({ ...second });
    expect(s.getFor(query(second, T0 + TTL_MS + 1))).toMatchObject({ ...second });
  });

  it("replacing an expired lease with a fresh one makes it readable again", () => {
    const s = createPolicyStore();
    const old = entry();
    s.put(old);
    const later = T0 + 2 * TTL_MS;
    expect(s.getFor(query(old, later))).toBeNull();
    const renewed = entry({ policyB64: "UE9MSUNZLXJlbmV3ZWQ=", expiresAt: later + TTL_MS, createdAt: later });
    s.put(renewed);
    expect(s.getFor(query(renewed, later))).toMatchObject({ ...renewed });
  });

  it("replacing a non-expiring entry with an expiring one applies the new expiry", () => {
    const s = createPolicyStore();
    const forever = entry({ expiresAt: null });
    s.put(forever);
    const bounded = entry({ expiresAt: T0 + TTL_MS });
    s.put(bounded);
    expect(s.getFor(query(bounded, T0 + TTL_MS))).toBeNull();
  });

  it("different access for the same subject and record are separate entries", () => {
    const s = createPolicyStore();
    const read = entry({ access: "read", policyB64: "UkVBRA==" });
    const write = entry({ access: "write", policyB64: "V1JJVEU=", expiresAt: null });
    s.put(read);
    s.put(write);
    expect(s.list()).toHaveLength(2);
    expect(s.getFor(query(read, T0))).toMatchObject({ access: "read", policyB64: "UkVBRA==" });
    expect(s.getFor(query(write, T0))).toMatchObject({ access: "write", policyB64: "V1JJVEU=" });
  });

  it("different subjectId, subjectType or recordId are separate entries", () => {
    const s = createPolicyStore();
    const a = entry();
    const b = entry({ subjectId: "tuk-other" });
    const c = entry({ subjectType: "Role" });
    const d = entry({ recordId: "fb-demo2002" });
    for (const e of [a, b, c, d]) s.put(e);
    expect(s.list()).toHaveLength(4);
    for (const e of [a, b, c, d]) {
      expect(s.getFor(query(e, T0))).toMatchObject({ ...e });
    }
  });
});

describe("S12b createPolicyStore — list", () => {
  it("is empty for a new store", () => {
    expect(createPolicyStore().list()).toEqual([]);
  });

  it("contains every distinct entry exactly once (order not asserted)", () => {
    const s = createPolicyStore();
    const es = [
      entry(),
      entry({ access: "write", subjectType: "Role", subjectId: "_tide_encryptor", expiresAt: null }),
      entry({ recordId: "fb-demo2002" }),
    ];
    for (const e of es) s.put(e);
    s.put(es[0]); // re-put of an existing key must not duplicate
    const got = s.list();
    expect(got).toHaveLength(3);
    expect(got.map(keyOf).sort()).toEqual(es.map(keyOf).sort());
    for (const e of es) {
      expect(got.find((g: Parameters<typeof keyOf>[0]) => keyOf(g) === keyOf(e))).toMatchObject({ ...e });
    }
  });

  // Assumption: list() takes no `now`, so it cannot filter by expiry; it returns expired entries too.
  it("includes expired entries (list has no clock)", () => {
    const s = createPolicyStore();
    const e = entry({ expiresAt: T0 - 1 });
    s.put(e);
    expect(s.getFor(query(e, T0))).toBeNull();
    expect(s.list()).toHaveLength(1);
    expect(s.list()[0]).toMatchObject({ ...e });
  });

  // Assumption: each createPolicyStore() call owns independent state (factory, no module-level store).
  it("separate stores do not share state", () => {
    const s1 = createPolicyStore();
    const s2 = createPolicyStore();
    s1.put(entry());
    expect(s2.list()).toEqual([]);
    expect(s2.getFor(query(entry(), T0))).toBeNull();
  });
});

// Assumption (SPEC says "pure, in memory"): callers cannot mutate store state through objects they pass in or
// receive back. Either copies or frozen objects satisfy these tests.
describe("S12b createPolicyStore — no aliasing (assumption)", () => {
  function tryMutate(fn: () => void) {
    try {
      fn();
    } catch {
      // frozen objects throw in strict mode; that is acceptable
    }
  }

  it("mutating the object passed to put does not change the store", () => {
    const s = createPolicyStore();
    const e = entry();
    const snapshot = { ...e };
    s.put(e);
    tryMutate(() => {
      (e as Record<string, unknown>).policyB64 = "TAMPERED";
      (e as Record<string, unknown>).expiresAt = null;
      (e as Record<string, unknown>).subjectId = "tuk-attacker";
    });
    expect(s.getFor(query(snapshot, T0))).toMatchObject(snapshot);
    expect(s.getFor(query(snapshot, T0 + TTL_MS))).toBeNull();
    expect(s.getFor(query(entry({ subjectId: "tuk-attacker" }), T0))).toBeNull();
  });

  it("mutating an entry returned by getFor does not change the store", () => {
    const s = createPolicyStore();
    const e = entry();
    s.put(e);
    const got = s.getFor(query(e, T0)) as Record<string, unknown>;
    tryMutate(() => {
      got.policyB64 = "TAMPERED";
      got.expiresAt = null;
    });
    expect(s.getFor(query(e, T0))).toMatchObject({ ...e });
    expect(s.getFor(query(e, T0 + TTL_MS))).toBeNull();
  });

  it("mutating list() results does not change the store", () => {
    const s = createPolicyStore();
    const e = entry();
    s.put(e);
    const arr = s.list() as unknown[];
    tryMutate(() => {
      (arr[0] as Record<string, unknown>).expiresAt = null;
      (arr[0] as Record<string, unknown>).policyB64 = "TAMPERED";
    });
    tryMutate(() => {
      arr.length = 0;
      arr.push({ ...e, subjectId: "tuk-attacker" });
    });
    expect(s.list()).toHaveLength(1);
    expect(s.list()[0]).toMatchObject({ ...e });
    expect(s.getFor(query(e, T0 + TTL_MS))).toBeNull();
    expect(s.getFor(query(entry({ subjectId: "tuk-attacker" }), T0))).toBeNull();
  });
});
