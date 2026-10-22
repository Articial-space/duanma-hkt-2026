// Distinguishing probe for M4: gateway recognises only 1 approver (threshold 1), service has 3 (threshold 2).
// One approval -> service lease effectiveStatus PENDING. Original must BLOCK; M4 asks the gateway, which signs.
const base = process.argv[2];
const { createTruthVoiceService } = await import(new URL("file:///" + base + "/src/service.ts"));
const { MockTideGateway } = await import(new URL("file:///" + base + "/src/gateway.ts"));
const gateway = new MockTideGateway({ secret: "probe", approvers: ["student-rep"] });
const clock = { now: 1_000_000 };
const svc = await createTruthVoiceService({
  gateway, approvers: [{ id: "student-rep" }, { id: "dean" }, { id: "qa-officer" }],
  agentId: "ai-summariser-01", vendorId: "v", operatorId: "op", clock: () => clock.now,
});
await svc.submitFeedback({ courseCode: "DEMO1001", comment: "The assessment rubric was unclear" });
svc.requestSummary({ courseCode: "DEMO1001", requestedBy: "lecturer-demo" });
svc.approve({ leaseId: "lease-1", approverId: "student-rep" });
clock.now += 10;
console.log(JSON.stringify({ lease: svc.listLeases()[0].effectiveStatus, result: await svc.runSummariser({ courseCode: "DEMO1001" }) }));
