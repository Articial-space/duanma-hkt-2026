import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AuditLog } from "../src/audit.js";

type Entry = ReturnType<AuditLog["append"]>;

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** Two admissible readings of "canonical JSON" in S4: sorted keys, or the field order the SPEC lists. */
function hashCandidates(e: {
  seq: number;
  at: number;
  actor: string;
  action: string;
  recordId?: string | null;
  detail?: string | null;
  prevHash: string;
}): string[] {
  const body = {
    seq: e.seq,
    at: e.at,
    actor: e.actor,
    action: e.action,
    recordId: e.recordId ?? null,
    detail: e.detail ?? null,
    prevHash: e.prevHash,
  };
  return [sha(JSON.stringify(canon(body))), sha(JSON.stringify(body))];
}

function build(): { log: AuditLog; entries: Entry[] } {
  const log = new AuditLog();
  log.append({ at: 1000, actor: "ai-summariser-01", action: "AGENT_BLOCKED", recordId: "fb-001" });
  log.append({ at: 2000, actor: "student-rep", action: "APPROVE", recordId: "fb-001", detail: "1 of 2" });
  log.append({ at: 3000, actor: "dean", action: "APPROVE", recordId: "fb-001", detail: "2 of 2" });
  log.append({ at: 4000, actor: "ai-summariser-01", action: "AGENT_READ", recordId: "fb-001", detail: "ok" });
  log.append({ at: 5000, actor: "system", action: "NOTE" });
  return { log, entries: log.entries() };
}

function clone(entries: Entry[]): Entry[] {
  return structuredClone(entries);
}

describe("S4 AuditLog.append", () => {
  it("assigns 0-based seq and GENESIS prevHash to the first entry", () => {
    const log = new AuditLog();
    const e = log.append({ at: 10, actor: "a", action: "X" });
    expect(e.seq).toBe(0);
    expect(e.prevHash).toBe("GENESIS");
    expect(e.at).toBe(10);
    expect(e.actor).toBe("a");
    expect(e.action).toBe("X");
    expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("chains: seq increments and prevHash is the previous hash", () => {
    const { entries } = build();
    entries.forEach((e, i) => {
      expect(e.seq).toBe(i);
      expect(e.prevHash).toBe(i === 0 ? "GENESIS" : entries[i - 1].hash);
    });
    expect(new Set(entries.map((e) => e.hash)).size).toBe(entries.length);
  });

  it("hash is sha256 of the canonical JSON of the entry fields", () => {
    const { entries } = build();
    for (const e of entries) {
      expect(hashCandidates(e)).toContain(e.hash);
    }
  });

  it("absent optional fields hash as null", () => {
    const log = new AuditLog();
    const e = log.append({ at: 7, actor: "sys", action: "NOTE" });
    expect(hashCandidates({ ...e, recordId: null, detail: null })).toContain(e.hash);
    // an explicit empty string is NOT the same as absent
    const log2 = new AuditLog();
    const e2 = log2.append({ at: 7, actor: "sys", action: "NOTE", recordId: "", detail: "" });
    expect(e2.hash).not.toBe(e.hash);
  });

  it("different content gives a different hash", () => {
    const a = new AuditLog().append({ at: 1, actor: "a", action: "X", recordId: "r1" });
    const b = new AuditLog().append({ at: 1, actor: "a", action: "X", recordId: "r2" });
    expect(a.hash).not.toBe(b.hash);
  });

  it("returns the appended recordId and detail", () => {
    const e = new AuditLog().append({ at: 1, actor: "a", action: "X", recordId: "rec-9", detail: "why" });
    expect(e.recordId).toBe("rec-9");
    expect(e.detail).toBe("why");
  });
});

describe("S4 entries()", () => {
  it("returns a copy of the list", () => {
    const { log } = build();
    const list = log.entries();
    list.pop();
    list.push({} as Entry);
    expect(log.entries().length).toBe(5);
    expect(log.verify()).toEqual({ ok: true });
  });

  it("empty log has no entries and verifies", () => {
    const log = new AuditLog();
    expect(log.entries()).toEqual([]);
    expect(log.verify()).toEqual({ ok: true });
  });
});

describe("S4 verify", () => {
  it("accepts an untouched log", () => {
    const { log } = build();
    expect(log.verify()).toEqual({ ok: true });
  });

  it.each(["at", "actor", "action", "recordId", "detail"] as const)(
    "detects tampering with %s at the first broken seq",
    (field) => {
      const { log, entries } = build();
      const t = clone(entries);
      (t[2] as Record<string, unknown>)[field] = field === "at" ? 9999 : "tampered";
      expect(log.verify(t)).toEqual({ ok: false, brokenAt: 2 });
    },
  );

  it("detects a field added to an entry that had none (absent -> value)", () => {
    const { log, entries } = build();
    const t = clone(entries);
    (t[4] as Record<string, unknown>).recordId = "rec-777";
    expect(log.verify(t)).toEqual({ ok: false, brokenAt: 4 });
  });

  it("detects a field removed from an entry that had it", () => {
    const { log, entries } = build();
    const t = clone(entries);
    delete (t[3] as Record<string, unknown>).detail;
    expect(log.verify(t)).toEqual({ ok: false, brokenAt: 3 });
  });

  it("detects a tampered hash at that entry", () => {
    const { log, entries } = build();
    const t = clone(entries);
    t[1].hash = "0".repeat(64);
    expect(log.verify(t)).toEqual({ ok: false, brokenAt: 1 });
  });

  it("detects a tampered prevHash at that entry", () => {
    const { log, entries } = build();
    const t = clone(entries);
    t[3].prevHash = "f".repeat(64);
    expect(log.verify(t)).toEqual({ ok: false, brokenAt: 3 });
  });

  it("detects a first entry whose prevHash is not GENESIS", () => {
    const { log, entries } = build();
    const t = clone(entries);
    t[0].prevHash = "NOT-GENESIS";
    expect(log.verify(t)).toEqual({ ok: false, brokenAt: 0 });
  });

  it("detects tampering with the first entry content", () => {
    const { log, entries } = build();
    const t = clone(entries);
    t[0].actor = "someone-else";
    expect(log.verify(t)).toEqual({ ok: false, brokenAt: 0 });
  });

  it("detects tampering with the last entry", () => {
    const { log, entries } = build();
    const t = clone(entries);
    t[4].action = "TAMPERED";
    expect(log.verify(t)).toEqual({ ok: false, brokenAt: 4 });
  });

  it("reports the FIRST broken entry when several are tampered", () => {
    const { log, entries } = build();
    const t = clone(entries);
    t[3].actor = "x";
    t[1].actor = "y";
    expect(log.verify(t)).toEqual({ ok: false, brokenAt: 1 });
  });

  it("detects a rewritten entry whose own hash was recomputed (next prevHash breaks)", () => {
    const { log, entries } = build();
    const t = clone(entries);
    t[1].detail = "forged";
    const idx = hashCandidates(entries[1]).indexOf(entries[1].hash);
    expect(idx).toBeGreaterThanOrEqual(0);
    t[1].hash = hashCandidates(t[1])[idx];
    expect(log.verify(t)).toEqual({ ok: false, brokenAt: 2 });
  });

  it("detects reordered entries", () => {
    const { log, entries } = build();
    const t = clone(entries);
    [t[1], t[2]] = [t[2], t[1]];
    const r = log.verify(t);
    expect(r.ok).toBe(false);
    expect([1, 2]).toContain((r as { brokenAt: number }).brokenAt);
  });

  it("detects a deleted middle entry", () => {
    const { log, entries } = build();
    const t = clone(entries);
    t.splice(1, 1);
    const r = log.verify(t);
    expect(r.ok).toBe(false);
    expect([1, 2]).toContain((r as { brokenAt: number }).brokenAt);
  });

  it("detects a deleted first entry", () => {
    const { log, entries } = build();
    const t = clone(entries).slice(1);
    const r = log.verify(t);
    expect(r.ok).toBe(false);
    expect([0, 1]).toContain((r as { brokenAt: number }).brokenAt);
  });

  it("verifies the supplied array and leaves the log's own state alone", () => {
    const { log, entries } = build();
    const t = clone(entries);
    t[2].actor = "bad";
    expect(log.verify(t).ok).toBe(false);
    expect(log.verify()).toEqual({ ok: true });
    expect(log.verify(clone(entries))).toEqual({ ok: true });
  });
});

describe("S4 AuditLog.fromEntries", () => {
  it("reconstructs a log that verifies and has the same entries", () => {
    const { entries } = build();
    const restored = AuditLog.fromEntries(clone(entries));
    expect(restored.entries()).toEqual(entries);
    expect(restored.verify()).toEqual({ ok: true });
  });

  it("does not re-hash: tampered input stays detectable", () => {
    const { entries } = build();
    const t = clone(entries);
    t[2].actor = "evil";
    const restored = AuditLog.fromEntries(t);
    expect(restored.verify()).toEqual({ ok: false, brokenAt: 2 });
    expect(restored.entries()[2].actor).toBe("evil");
  });

  it("continues the chain on append", () => {
    const { entries } = build();
    const restored = AuditLog.fromEntries(clone(entries));
    const e = restored.append({ at: 6000, actor: "student-rep", action: "REVOKE" });
    expect(e.seq).toBe(entries.length);
    expect(e.prevHash).toBe(entries[entries.length - 1].hash);
    expect(restored.verify()).toEqual({ ok: true });
  });
});
