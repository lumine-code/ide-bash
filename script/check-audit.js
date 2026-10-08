const fs = require("node:fs");

const acceptedUrl = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const severities = ["info", "low", "moderate", "high", "critical"];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isHigh = (severity) => severity === "high" || severity === "critical";

function checkAudit(audit) {
  if (
    !isObject(audit) ||
    audit.error ||
    audit.auditReportVersion !== 2 ||
    !isObject(audit.vulnerabilities) ||
    !isObject(audit.metadata?.vulnerabilities)
  ) {
    throw new Error("npm audit did not return a complete dependency report.");
  }

  const counts = Object.fromEntries(severities.map((severity) => [severity, 0]));
  const advisories = [];
  for (const [name, entry] of Object.entries(audit.vulnerabilities)) {
    if (
      !isObject(entry) ||
      entry.name !== name ||
      !severities.includes(entry.severity) ||
      !Array.isArray(entry.via) ||
      entry.via.length === 0
    ) {
      throw new Error(`Malformed npm audit entry: ${name}.`);
    }
    counts[entry.severity]++;
    for (const via of entry.via) {
      if (typeof via === "string") continue;
      if (
        !isObject(via) ||
        typeof via.name !== "string" ||
        !via.name ||
        typeof via.dependency !== "string" ||
        !via.dependency ||
        typeof via.url !== "string" ||
        !URL.canParse(via.url) ||
        !severities.includes(via.severity)
      ) {
        throw new Error(`Malformed npm root advisory: ${name}.`);
      }
      advisories.push(via);
    }
  }
  const total = Object.keys(audit.vulnerabilities).length;
  for (const [severity, expected] of Object.entries({ ...counts, total })) {
    if (audit.metadata.vulnerabilities[severity] !== expected) {
      throw new Error("npm audit vulnerability totals disagree with the report.");
    }
  }

  function rootAdvisories(name, trail = new Set()) {
    if (trail.has(name) || !Object.hasOwn(audit.vulnerabilities, name)) {
      throw new Error(`Unresolved npm audit dependency chain: ${name}.`);
    }
    const next = new Set([...trail, name]);
    return audit.vulnerabilities[name].via.flatMap((via) =>
      typeof via === "string" ? rootAdvisories(via, next) : [via],
    );
  }
  for (const [name, entry] of Object.entries(audit.vulnerabilities)) {
    const roots = rootAdvisories(name);
    if (isHigh(entry.severity) && !roots.some((root) => isHigh(root.severity))) {
      throw new Error(`No high-severity root advisory explains ${name}.`);
    }
  }

  const accepted = (entry) =>
    entry.url === acceptedUrl &&
    entry.name === "braces" &&
    entry.dependency === "braces" &&
    entry.severity === "high";
  const unexpected = advisories.filter((entry) => isHigh(entry.severity) && !accepted(entry));
  if (unexpected.length) {
    throw new Error(
      `Unaccepted high or critical dependency advisories: ${[...new Set(unexpected.map(({ url }) => url))].join(", ")}`,
    );
  }
  return { accepted: advisories.some(accepted), affectedPackages: total };
}

if (require.main === module) {
  try {
    const result = checkAudit(JSON.parse(fs.readFileSync(0, "utf8")));
    console.log(
      result.accepted
        ? `::warning::Unpatched upstream braces advisory ${acceptedUrl} remains (${result.affectedPackages} affected packages). Only this specific advisory is temporarily accepted; it is not fixed.`
        : "No unaccepted high or critical dependency advisories.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkAudit, acceptedUrl };
