// Mutation harness for the ERC-8294 composition vectors (companion tooling; not part of the ERC assets).
//
// A passing case proves nothing on its own: it has to be the thing that fails when the
// behaviour it names is broken. This applies one single-site mutation at a time to the
// adapter, re-compiles, re-runs test/composition-8294.test.js, and records WHICH cases died.
//
// A mutant is KILLED if at least one case fails, and it is only *well-targeted* if the case
// that dies is the one that claims to cover it. A mutant that kills everything is as
// uninformative as one that kills nothing.
//
// Most mutants break an adapter guard. One (M13) breaks the KYA registry's level-declared guard,
// because the composition's correctness genuinely leans on it: C10 asserts the adapter's ladder
// refusal and that registry refusal are the same rule, so the registry guard is in scope for the
// composition's mutation check too. Each mutant therefore names the FILE it edits (default: the
// adapter).
//
// Run: node tools/mutate-composition.js
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTRACTS = path.join(ROOT, "assets/erc-kya/contracts");
const ADAPTER = path.join(CONTRACTS, "adapters/ValidationNetwork8294Adapter.sol");
const REGISTRY = path.join(CONTRACTS, "KYARegistry.sol");
const ORIGINAL = Object.fromEntries([ADAPTER, REGISTRY].map((f) => [f, fs.readFileSync(f, "utf8")]));

const MUTANTS = [
  {
    id: "M1",
    what: "subject-mismatch check deleted (a run about another agent is accepted)",
    expect: "C2",
    from: `        if (reportedAgentId != assertedAgentId) revert SubjectMismatch(reportedAgentId, assertedAgentId);`,
    to: `        // MUTANT M1: subject check deleted`,
  },
  {
    id: "M2",
    what: "network check deleted (a result from any validator address is accepted)",
    expect: "C5",
    from: `        if (reported != address(network)) revert NotExpectedNetwork(reported, address(network));`,
    to: `        // MUTANT M2: network check deleted`,
  },
  {
    id: "M3",
    what: "profile pin deleted (the network may change its semantics underneath)",
    expect: "R",
    from: `        if (profile != expectedProfile) revert ProfileChanged(expectedProfile, profile);`,
    to: `        // MUTANT M3: profile pin deleted`,
  },
  {
    id: "M4",
    what: "incomplete run returns 0 instead of reverting (operational failure becomes a verdict)",
    expect: "C3",
    from: `        if (state != STATE_RESPONDED || !aggregated) {
            revert ResultNotEstablished(requestHash, state, aggregated);
        }`,
    to: `        if (state != STATE_RESPONDED || !aggregated) { return 0; } // MUTANT M4`,
  },
  {
    id: "M5",
    what: "quorum floor dropped (a below-policy aggregate becomes a verdict)",
    expect: "C3",
    from: `        if (count < requiredValidators) revert QuorumNotMet(requestHash, count, requiredValidators);`,
    to: `        // MUTANT M5: quorum floor dropped`,
  },
  {
    id: "M6",
    what: "evidenceHash drops the network and request (provenance no longer re-derivable)",
    expect: "C4",
    from: `                "erc8004-validation",
                address(network),
                requestHash,
                responseHash,`,
    to: `                "erc8004-validation",
                responseHash,`,
  },
  {
    id: "M7",
    what: "subject chain/registry pin deleted (a result is re-pointable at another registry)",
    expect: "C6",
    from: `        if (chainId_ != subjectChainId || identity_ != identityRegistry) revert UnsupportedSubject();`,
    to: `        // MUTANT M7: chain/registry pin deleted`,
  },
  {
    id: "M8",
    what: "ladder comparison off by one (a response equal to a threshold no longer earns the level)",
    expect: "C7",
    from: `            if (response >= _thresholds[i]) level = uint8(i + 1);`,
    to: `            if (response > _thresholds[i]) level = uint8(i + 1); // MUTANT M8`,
  },
  {
    id: "M9",
    what: "quorum floor off by one (count == required is rejected)",
    expect: "C8",
    from: `        if (count < requiredValidators) revert QuorumNotMet(requestHash, count, requiredValidators);`,
    to: `        if (count <= requiredValidators) revert QuorumNotMet(requestHash, count, requiredValidators);`,
  },
  {
    id: "M10",
    what: "ladder/mask check deleted (an adapter can carry a ladder the scheme never declared)",
    expect: "C9",
    from: `        if (n == 0 || n > 255 || levelMask != (uint256(1) << (n + 1)) - 1) {
            revert LadderMismatch(schemeId_, levelMask, n);
        }`,
    to: `        // MUTANT M10: ladder/mask check deleted`,
  },
  {
    id: "M11",
    what: "ordered-kind check deleted (a categorical scheme can be mapped onto)",
    expect: "C9",
    from: `        if (kind != ORDERED_LEVEL) revert SchemeNotOrdered(schemeId_, kind);`,
    to: `        // MUTANT M11: ordered-kind check deleted`,
  },
  {
    id: "M12",
    what: "ladder monotonicity check deleted (a non-increasing ladder is accepted)",
    expect: "C9",
    from: `            if (thresholds_[i] > 100 || (i > 0 && thresholds_[i] <= thresholds_[i - 1])) {`,
    to: `            if (false) { // MUTANT M12`,
  },
  {
    id: "M13",
    file: REGISTRY,
    what: "registry level-declared guard deleted (an undeclared level is recorded, so the registry no longer agrees with the adapter's contiguity refusal)",
    expect: "C10",
    from: `        if ((levelMask >> level) & 1 == 0) revert KYA_LevelNotDeclared(schemeId, level);`,
    to: `        // MUTANT M13: level-declared guard deleted`,
  },
];

function run() {
  try {
    execFileSync("node", [path.join(ROOT, "tools/compile.js")], { cwd: ROOT, stdio: "pipe" });
  } catch (e) {
    return { compiled: false, failed: [], out: String(e.stdout || e.message).slice(-300) };
  }
  let out = "";
  try {
    out = execFileSync("node", [path.join(ROOT, "test/composition-8294.test.js")], { cwd: ROOT, encoding: "utf8" });
  } catch (e) {
    out = String(e.stdout || "");
  }
  const failed = [...out.matchAll(/✗ (C\d+|R)\b/g)].map((m) => m[1]);
  return { compiled: true, failed, out };
}

(async () => {
  console.log("baseline (unmutated)");
  const base = run();
  if (!base.compiled || base.failed.length) {
    console.log("  BASELINE NOT CLEAN — fix before mutating\n", base.out.slice(-400));
    process.exit(1);
  }
  const total = (base.out.match(/(\d+) passed/) || [])[1];
  console.log(`  ✓ ${total} cases pass, none failing\n`);

  const rows = [];
  for (const m of MUTANTS) {
    const target = m.file || ADAPTER;
    const src = ORIGINAL[target];
    if (!src.includes(m.from)) {
      rows.push({ ...m, verdict: "ANCHOR NOT FOUND", died: [] });
      console.log(`  ${m.id}  ANCHOR NOT FOUND — mutant not applied`);
      continue;
    }
    fs.writeFileSync(target, src.replace(m.from, m.to));
    let r;
    try { r = run(); } finally { fs.writeFileSync(target, src); }

    let verdict;
    if (!r.compiled) verdict = "DID NOT COMPILE";
    else if (!r.failed.length) verdict = "SURVIVED";
    else if (r.failed.includes(m.expect)) verdict = r.failed.length === 1 ? "KILLED (targeted)" : `KILLED (+${r.failed.filter((f) => f !== m.expect).join(",")})`;
    else verdict = `KILLED BY THE WRONG CASE (${r.failed.join(",")})`;

    rows.push({ ...m, verdict, died: r.failed });
    console.log(`  ${m.id.padEnd(4)} expect ${m.expect.padEnd(3)} → died: ${(r.failed.join(",") || "none").padEnd(12)} ${verdict}`);
  }

  run(); // leave the tree compiled from the original
  const bad = rows.filter((r) => r.verdict === "SURVIVED" || r.verdict.startsWith("KILLED BY THE WRONG") || r.verdict === "ANCHOR NOT FOUND" || r.verdict === "DID NOT COMPILE");
  console.log(`\n${rows.length - bad.length}/${rows.length} mutants killed by their named case`);
  if (bad.length) {
    console.log("\nnot covered:");
    for (const b of bad) console.log(`  ${b.id} (${b.verdict}) — ${b.what}`);
    process.exitCode = 1;
  }
})();
