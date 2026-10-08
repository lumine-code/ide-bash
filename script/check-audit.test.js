const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { checkAudit, acceptedUrl } = require("./check-audit");

function advisory(overrides = {}) {
  return {
    name: "braces",
    dependency: "braces",
    severity: "high",
    url: acceptedUrl,
    ...overrides,
  };
}

function entry(name, via, severity = "high") {
  return { name, via, severity };
}

function report(vulnerabilities = {}) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const value of Object.values(vulnerabilities)) {
    counts[value.severity]++;
    counts.total++;
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: counts } };
}

test("accepts a clean audit", () => {
  assert.deepEqual(checkAudit(report()), { accepted: false, affectedPackages: 0 });
});

test("accepts only the known braces leaf and its transitive affected packages", () => {
  const audit = report({
    "bash-language-server": entry("bash-language-server", ["fast-glob"]),
    "fast-glob": entry("fast-glob", ["micromatch"]),
    micromatch: entry("micromatch", ["braces"]),
    braces: entry("braces", [advisory()]),
  });
  assert.deepEqual(checkAudit(audit), { accepted: true, affectedPackages: 4 });
});

for (const severity of ["high", "critical"]) {
  test(`rejects a new ${severity} leaf alongside the accepted advisory`, () => {
    const audit = report({
      braces: entry("braces", [advisory(), advisory({ url: "https://example.com/new", severity })]),
    });
    assert.throws(() => checkAudit(audit), /Unaccepted high or critical/);
  });
}

test("rejects the accepted URL when it names another package or escalates to critical", () => {
  for (const overrides of [{ dependency: "other" }, { name: "other" }, { severity: "critical" }]) {
    assert.throws(
      () => checkAudit(report({ braces: entry("braces", [advisory(overrides)]) })),
      /Unaccepted high or critical/,
    );
  }
});

test("preserves the high threshold for unrelated moderate advisories", () => {
  const audit = report({
    other: entry(
      "other",
      [advisory({ url: "https://example.com/moderate", severity: "moderate" })],
      "moderate",
    ),
  });
  assert.equal(checkAudit(audit).accepted, false);
});

test("rejects dangling, cyclic, unexplained, or inconsistent affected-package reports", () => {
  for (const audit of [
    report({ parent: entry("parent", ["missing"]) }),
    report({ parent: entry("parent", ["child"]), child: entry("child", ["parent"]) }),
    report({ parent: entry("parent", []) }),
    report({ parent: entry("parent", [advisory({ severity: "moderate" })]) }),
    { ...report(), metadata: { vulnerabilities: { high: 1, total: 1 } } },
  ]) {
    assert.throws(() => checkAudit(audit));
  }
});

test("fails closed on network and malformed audit reports", () => {
  for (const audit of [
    { error: { code: "ECONNRESET", summary: "audit endpoint returned an error" } },
    { ...report(), error: { code: "ETIMEDOUT" } },
    {},
    { ...report(), vulnerabilities: [] },
    report({ braces: entry("braces", [{}]) }),
    report({
      braces: entry("braces", [advisory({ url: "invalid", severity: "moderate" })], "moderate"),
    }),
  ]) {
    assert.throws(() => checkAudit(audit));
  }
});

test("the command warns for the accepted risk and exits unsuccessfully for invalid JSON or network errors", () => {
  const script = path.join(__dirname, "check-audit.js");
  const run = (input) =>
    spawnSync(process.execPath, [script], { input, encoding: "utf8", windowsHide: true });
  const accepted = run(JSON.stringify(report({ braces: entry("braces", [advisory()]) })));
  assert.equal(accepted.status, 0);
  assert.match(accepted.stdout, /::warning::Unpatched upstream braces advisory/);
  for (const input of ["not JSON", JSON.stringify({ error: { code: "ENOTFOUND" } })]) {
    const failed = run(input);
    assert.equal(failed.status, 1);
    assert.notEqual(failed.stderr, "");
  }
});
