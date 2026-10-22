// Independent AC-17 / AC-14 API smoke. Usage: node qa-smoke.mjs <port>. Server must be freshly started.
const P = process.argv[2] || "3100";
const O = `http://localhost:${P}`;
const results = [];
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`); };
const call = async (path, { method = "GET", body, token, raw } = {}) => {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(O + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
};
const login = async (u) => (await call("/api/tv/sim/login", { method: "POST", body: { username: u } })).json?.token;

// 1. every demo route 401 without session
const anon = [
  ["GET", "/api/tv/rows"], ["GET", "/api/tv/courses"], ["GET", "/api/tv/leases"], ["GET", "/api/tv/audit"], ["GET", "/api/tv/probe"],
  ["POST", "/api/tv/audit/tamper-demo", {}], ["POST", "/api/tv/clock/advance", { minutes: 1 }],
  ["POST", "/api/tv/feedback", { courseCode: "DEMO1001", comment: "x" }], ["POST", "/api/tv/leases", { courseCode: "DEMO1001" }],
  ["POST", "/api/tv/leases/approve", { leaseId: "lease-1" }], ["POST", "/api/tv/leases/reject", { leaseId: "lease-1" }],
  ["POST", "/api/tv/summarise", { courseCode: "DEMO1001" }],
];
for (const [m, p, b] of anon) { const r = await call(p, { method: m, body: b }); check(`anon ${m} ${p} -> 401`, r.status === 401, `got ${r.status}`); }

// 2. student submits OK; lecturer 403
const student = await login("student-demo"), lecturer = await login("lecturer-demo");
const sub = await call("/api/tv/feedback", { method: "POST", body: { courseCode: "DEMO1001", comment: "QA feedback one" }, token: student });
check("student-demo submit feedback -> 200", sub.status === 200, `got ${sub.status} ${sub.text.slice(0, 120)}`);
const lsub = await call("/api/tv/feedback", { method: "POST", body: { courseCode: "DEMO1001", comment: "nope" }, token: lecturer });
check("lecturer-demo submit feedback -> 403", lsub.status === 403, `got ${lsub.status} ${lsub.text.slice(0, 120)}`);
const rows = await call("/api/tv/rows", { token: student });
check("rows show ciphertext, not plaintext", rows.status === 200 && !rows.text.includes("QA feedback one"), `status ${rows.status}, len ${rows.text.length}`);

// 3. lecturer lease request
const req = await call("/api/tv/leases", { method: "POST", body: { courseCode: "DEMO1001" }, token: lecturer });
check("lecturer requests lease DEMO1001 -> 200", req.status === 200, `got ${req.status} ${req.text.slice(0, 200)}`);
const leaseId = req.json?.leaseId ?? req.json?.id;
console.log("leaseId =", leaseId, "request body:", req.text.slice(0, 300));

// 4. spoofed approverId as student-rep
const rep = await login("student-rep"), dean = await login("dean");
const a1 = await call("/api/tv/leases/approve", { method: "POST", body: { leaseId, approverId: "qa-officer" }, token: rep });
console.log("approve#1:", a1.text.slice(0, 400));
check("student-rep approve (spoof approverId=qa-officer) -> 200", a1.status === 200, `got ${a1.status}`);
check("approval recorded as student-rep (not qa-officer)", a1.text.includes("student-rep") && !a1.text.includes("qa-officer"), "");
// 5. dean approves -> ACTIVE
const a2 = await call("/api/tv/leases/approve", { method: "POST", body: { leaseId }, token: dean });
console.log("approve#2:", a2.text.slice(0, 400));
check("dean approve -> 200 and ACTIVE", a2.status === 200 && a2.text.includes("ACTIVE"), `got ${a2.status}`);

// 6. summarise as it-admin 403, ai-summariser-01 ok
const admin = await login("it-admin"), ai = await login("ai-summariser-01");
const s1 = await call("/api/tv/summarise", { method: "POST", body: { courseCode: "DEMO1001" }, token: admin });
check("it-admin summarise -> 403", s1.status === 403, `got ${s1.status} ${s1.text.slice(0, 120)}`);
const s2 = await call("/api/tv/summarise", { method: "POST", body: { courseCode: "DEMO1001" }, token: ai });
console.log("summarise ai:", s2.text.slice(0, 400));
check("ai-summariser-01 summarise -> 200 ok with SUMMARY", s2.status === 200 && s2.text.includes("SUMMARY") && /ok/i.test(s2.text), `got ${s2.status}`);

// 7. clock +16 min -> BLOCKED
const adv = await call("/api/tv/clock/advance", { method: "POST", body: { minutes: 16 }, token: ai });
check("clock advance 16 min -> 200", adv.status === 200, `got ${adv.status} ${adv.text.slice(0, 120)}`);
const s3 = await call("/api/tv/summarise", { method: "POST", body: { courseCode: "DEMO1001" }, token: ai });
console.log("summarise after +16:", s3.text.slice(0, 400));
check("summarise after +16 min -> BLOCKED (ok:false, NO_ACTIVE_LEASE)", s3.json?.ok === false && s3.json?.reason === "NO_ACTIVE_LEASE", `got ${s3.status} ${s3.text.slice(0,80)}`);

// 8. edited payload -> 401
const parts = student.split(".");
const b64 = (s) => Buffer.from(s).toString("base64url");
let edited = null;
for (let i = 0; i < parts.length; i++) {
  try {
    const obj = JSON.parse(Buffer.from(parts[i], "base64url").toString());
    if (obj && typeof obj === "object" && obj.preferred_username) { obj.preferred_username = "dean"; obj.realm_access = { roles: ["approver"] }; const p = [...parts]; p[i] = b64(JSON.stringify(obj)); edited = p.join("."); }
  } catch {}
}
check("token structure editable for tamper test", !!edited, `parts=${parts.length}`);
const tam = await call("/api/tv/rows", { token: edited });
check("edited-payload token -> 401", tam.status === 401, `got ${tam.status}`);
const tam2 = await call("/api/tv/leases/approve", { method: "POST", body: { leaseId: "lease-1" }, token: edited });
check("edited-payload token on approve -> 401", tam2.status === 401, `got ${tam2.status}`);

// 9. tide routes + page
for (const [m, p] of [["GET", "/api/tv/tide/state"], ["POST", "/api/tv/tide/whoami"], ["GET", "/api/tv/tide/rows"], ["GET", "/api/tv/tide/policies"], ["POST", "/api/tv/tide/summary"], ["GET", "/api/tv/tide/leases"], ["GET", "/api/tv/tide/admin-policy"], ["POST", "/api/tv/tide/leases/approve"]]) {
  const r = await call(p, { method: m, body: m === "POST" ? {} : undefined }); check(`${m} ${p} -> 401`, r.status === 401, `got ${r.status}`);
}
const pg = await fetch(O + "/truthvoice"); check("GET /truthvoice -> 200", pg.status === 200, `got ${pg.status}`);

console.log(`\nTOTAL ${results.length} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
