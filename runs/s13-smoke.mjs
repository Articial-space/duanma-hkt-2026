// AC-17 API smoke for the simulated TideCloak routes. Usage: node s13-smoke.mjs <port>  (server already running)
const B = `http://localhost:${process.argv[2] || 3107}/api/tv/`;
const call = async (path, { method = "GET", body, cookie } = {}) => {
  const r = await fetch(B + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, text: t.slice(0, 110), setCookie: r.headers.get("set-cookie") };
};
const login = async (u) => {
  const r = await call("sim/login", { method: "POST", body: { username: u } });
  return r.setCookie ? r.setCookie.split(";")[0] : null;
};
console.log("anon rows (401)", await call("rows"));
console.log("bad login (401)", await call("sim/login", { method: "POST", body: { username: "mallory" } }));
const lec = await login("lecturer-demo");
console.log("lecturer rows (200)", (await call("rows", { cookie: lec })).status);
console.log("lecturer approve (403)", await call("leases/approve", { method: "POST", body: { leaseId: "x", approverId: "dean" }, cookie: lec }));
console.log("lecturer summarise (403)", (await call("summarise", { method: "POST", body: { courseCode: "x" }, cookie: lec })).status);
const courses = JSON.parse(await (await fetch(B + "courses", { headers: { cookie: lec } })).text());
const cc = courses[0].courseCode;
console.log("lecturer request lease (200)", await call("leases", { method: "POST", body: { courseCode: cc }, cookie: lec }));
const dean = await login("dean");
console.log("dean approve, spoofed approverId ignored (200, approvals [dean])", await call("leases/approve", { method: "POST", body: { leaseId: "lease-1", approverId: "qa-officer" }, cookie: dean }));
const rep = await login("student-rep");
console.log("rep approve (200 ACTIVE)", await call("leases/approve", { method: "POST", body: { leaseId: "lease-1", approverId: "dean" }, cookie: rep }));
const ai = await login("ai-summariser-01");
console.log("ai summarise (200 ok)", await call("summarise", { method: "POST", body: { courseCode: cc }, cookie: ai }));
const admin = await login("it-admin");
console.log("admin approve (403)", (await call("leases/approve", { method: "POST", body: { leaseId: "lease-1" }, cookie: admin })).status);
console.log("forged cookie (401)", await call("rows", { cookie: "tv_sim_session=sim.eyJhIjoxfQ.abc" }));
console.log("whoami dean", await call("sim/whoami", { cookie: dean }));
console.log("whoami anon", await call("sim/whoami"));
