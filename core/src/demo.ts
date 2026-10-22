// S8 - scripted console story (fallback video material). Simulated clock, no network.
// Every output line is prefixed with its step number [1]..[6].
import { SummaryAgent } from "./agent.js";
import { AuditLog } from "./audit.js";
import { AGENT_ID, APPROVERS, OPERATOR_ID, REQUESTER_ID, SYNTHETIC_FEEDBACK, VENDOR_ID } from "./fixtures.js";
import { MockTideGateway, NotAuthorizedError, type LeaseToken } from "./gateway.js";
import { approve, createLeaseRequest, effectiveStatus, remainingMs } from "./lease.js";
import { buildRelationshipPolicy } from "./policy.js";
import { formatProbe, probeAccess } from "./probe.js";
import { approvalThreshold } from "./threshold.js";

const T0 = 1_700_000_000_000; // simulated clock start (epoch ms)
const MIN = 60_000;
const TTL_SECONDS = 15 * 60;

function say(step: number, text: string): void {
  for (const line of text.split("\n")) console.log(`[${step}] ${line}`);
}

async function main(): Promise<void> {
  const approverIds = APPROVERS.map((a) => a.id);
  const gateway = new MockTideGateway({ secret: "demo-gateway-secret", approvers: approverIds });
  const audit = new AuditLog();
  const agent = new SummaryAgent({ id: AGENT_ID, gateway, audit });
  const [fb1, fb2] = SYNTHETIC_FEEDBACK;
  const needed = approvalThreshold(approverIds.length);

  // [1] feedback batches are encrypted; admin, database, server and lecturer only ever see ciphertext
  const cipher: Record<string, string> = {};
  for (const b of SYNTHETIC_FEEDBACK) {
    const policy = buildRelationshipPolicy({
      subjectType: "User",
      subjectId: AGENT_ID,
      recordId: b.recordId,
      roles: ["_tide_decryptor"],
      vendorId: VENDOR_ID,
      expirySeconds: TTL_SECONDS,
    });
    cipher[b.recordId] = await gateway.encryptRecord(b.recordId, b.text, policy);
    audit.append({ at: T0, actor: "system", action: "FEEDBACK_ENCRYPTED", recordId: b.recordId });
    say(1, `${b.recordId} (${b.courseCode}) feedback encrypted, stored as ${cipher[b.recordId].slice(0, 28)}...`);
  }
  say(1, `The university IT admin (${OPERATOR_ID}), the database, the app server and the lecturer only hold this ciphertext.`);
  say(1, `Approvers: ${approverIds.join(", ")} -> ${needed} of ${approverIds.length} must approve.`);

  const probe = async (now: number, token?: LeaseToken): Promise<string> =>
    formatProbe(
      await probeAccess({
        gateway,
        recordId: fb1.recordId,
        ciphertext: cipher[fb1.recordId],
        otherRecordCiphertext: cipher[fb2.recordId],
        now,
        token,
      }),
    );

  // [2] no lease yet
  let now = T0 + MIN;
  const blocked0 = await agent.summarizeRecord(fb1.recordId, cipher[fb1.recordId], now);
  say(2, `AI summariser ${AGENT_ID} asks for ${fb1.recordId}: BLOCKED (${blocked0.ok ? "unexpected" : blocked0.reason})`);
  say(2, "Who can read this feedback right now?");
  say(2, await probe(now));

  // [3] the lecturer requests a summary; one approval is not enough
  now = T0 + 2 * MIN;
  let req = createLeaseRequest({
    id: "lease-001",
    agentId: AGENT_ID,
    recordId: fb1.recordId,
    purpose: `AI theme summary for ${fb1.courseCode} after grades are published`,
    requestedBy: REQUESTER_ID,
    now,
    ttlSeconds: TTL_SECONDS,
    adminCount: approverIds.length,
  });
  audit.append({ at: now, actor: REQUESTER_ID, action: "LEASE_REQUESTED", recordId: req.recordId, detail: req.id });
  say(3, `${REQUESTER_ID} requests a summary of ${req.recordId} (${req.id}, ${TTL_SECONDS / 60}-minute lease): ${req.status}`);

  now = T0 + 3 * MIN;
  req = approve(req, APPROVERS[0], now);
  audit.append({
    at: now,
    actor: APPROVERS[0].id,
    action: "LEASE_APPROVED",
    recordId: req.recordId,
    detail: `${req.approvals.length} of ${needed}`,
  });
  say(3, `${APPROVERS[0].id} approves: ${req.status} (${req.approvals.length} of ${needed})`);
  try {
    await gateway.signLease(req, now);
    say(3, "gateway signed a lease with one approval (unexpected)");
  } catch (err) {
    if (!(err instanceof NotAuthorizedError)) throw err;
    say(3, `gateway refuses to sign a lease: ${err.message}`);
  }
  const blocked1 = await agent.summarizeRecord(fb1.recordId, cipher[fb1.recordId], now);
  say(3, `AI summariser asks again for ${fb1.recordId}: BLOCKED (${blocked1.ok ? "unexpected" : blocked1.reason})`);

  // [4] quorum reached: ACTIVE lease, the AI summarises fb-001 only
  now = T0 + 4 * MIN;
  req = approve(req, APPROVERS[1], now);
  audit.append({
    at: now,
    actor: APPROVERS[1].id,
    action: "LEASE_APPROVED",
    recordId: req.recordId,
    detail: `${req.approvals.length} of ${needed}`,
  });
  say(4, `${APPROVERS[1].id} approves: ${req.status} (${req.approvals.length} of ${needed}, approved by ${req.approvals.join(" + ")})`);
  const token: LeaseToken = await gateway.signLease(req, now);
  audit.append({ at: now, actor: "gateway", action: "LEASE_SIGNED", recordId: req.recordId, detail: req.id });
  say(4, `gateway signs the lease token; ${Math.round(remainingMs(req, now) / MIN)} minutes remaining`);

  now = T0 + 5 * MIN;
  const read1 = await agent.summarizeRecord(fb1.recordId, cipher[fb1.recordId], now, token);
  say(
    4,
    read1.ok
      ? `AI summariser reads ${fb1.recordId}; ${REQUESTER_ID} receives only: ${read1.summary}`
      : `AI summariser read of ${fb1.recordId} failed (unexpected)`,
  );
  const read2 = await agent.summarizeRecord(fb2.recordId, cipher[fb2.recordId], now, token);
  say(4, `AI summariser tries ${fb2.recordId} with the same lease: BLOCKED (${read2.ok ? "unexpected" : read2.reason})`);
  say(4, "Who can read this feedback right now?");
  say(4, await probe(now, token));

  // [5] clock +16 minutes: the lease has expired
  now = T0 + 4 * MIN + 16 * MIN;
  say(5, `clock moves +16 minutes: lease is ${effectiveStatus(req, now)} (${remainingMs(req, now)} ms remaining)`);
  const blocked2 = await agent.summarizeRecord(fb1.recordId, cipher[fb1.recordId], now, token);
  say(5, `AI summariser asks for ${fb1.recordId} with its old token: BLOCKED (${blocked2.ok ? "unexpected" : blocked2.reason})`);
  say(5, "Who can read this feedback right now?");
  say(5, await probe(now, token));

  // [6] audit log is tamper-evident
  const verified = audit.verify();
  say(6, `audit log: ${audit.entries().length} entries, verify: ${verified.ok ? "ok" : "FAILED"}`);
  const tampered = audit.entries();
  tampered[1] = { ...tampered[1], actor: "someone-else" };
  const result = audit.verify(tampered);
  say(
    6,
    result.ok
      ? "tampered copy still verifies (unexpected)"
      : `entry 1 rewritten in a copy of the log: verify reports broken at seq ${result.brokenAt}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
