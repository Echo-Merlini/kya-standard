// ERC-8294 → ERC-KYA composition vectors (companion; not part of the ERC assets).
//
// ERC-8294 ("Validation Network for ERC-8004", ethereum/ERCs#1808) extends ERC-8004's
// Validation Registry so a `validatorAddress` may be a NETWORK of independent validators,
// with operator-diversity as a selection-policy parameter and a standardised attestation
// envelope. ERC-8294 standardises WHO validated; ERC-KYA records WHAT was concluded.
//
// These vectors exercise the composition through the EXISTING `ATTESTED` path, per the
// discussion on the ERC-8419 thread: an adapter contract calls `attest()`, so the adapter is
// the recorded issuer. No new admission mode, and the KYA normative core stays
// network-agnostic.
//
// Cases:
//
//   C1  a completed network run maps to an assertion, and the assertion's issuer is the
//       ADAPTER — not a validator, and not the network
//   C2  rejected: the run is about a different agent than the asserted subject
//   C3  rejected: the run did not complete — AND the distinction this set exists for,
//       an operational failure is NOT a negative trust conclusion
//   C4  the mirrored result retains source provenance: evidenceHash re-derives from the
//       8294 run, and a completed-but-negative verdict is recorded as such, distinguishably
//       from C3
//   C5  rejected: the result was written by a validator address other than the pinned network
//   C6  rejected: a subject naming another registry, chain, or subject type
//   C7  the response→level mapping is exact at every boundary of the SCHEME's ladder
//   C8  the quorum floor is exact at count == required
//   C9  the ladder is the scheme's: an adapter cannot be constructed with a ladder that does
//       not match the scheme's committed result domain, nor for a non-ordered scheme, and
//       the scheme it issues under is fixed at construction
//   R   the adapter refuses once the network moves its verification profile
//
// Every case is mutation-checked by tools/mutate-composition.js: each guard is deleted in turn
// and the case that claims to cover it must be the one that fails.
//
// WHAT GRADE OF EVIDENCE THIS IS. MockValidationNetwork8294 CONSTRUCTS its own status: the test
// tells it to report `(RESPONDED, 7, true)` and the adapter believes it. No signatures are
// collected and no aggregate is recomputed here. So these vectors establish how the adapter
// HANDLES a reported validation result — they do NOT establish that the result is honest, and
// should not be read as doing so. The honesty of the report is what `requiredValidators`, the
// pinned verification profile, and recording the ADAPTER as issuer are for: the trust is placed
// in one named, pinned contract rather than in seven anonymous keys. Reproducing an actual
// aggregation would need a deterministic toy network that signs and that the test re-derives,
// which is a larger fixture than this composition needs and is called out rather than implied.
//
// Run: node tools/compile.js && node test/composition-8294.test.js
const assert = require("assert");
const { Harness, expectRevert, ethers } = require("./harness");

const coder = ethers.AbiCoder.defaultAbiCoder();
const ERC8004 = ethers.keccak256(ethers.toUtf8Bytes("erc8004"));

// ERC-8294 request states, from IValidationNetwork.status().
const PENDING = 1, RESPONDED = 2, FAILED = 3;

// The scheme's ladder, as its descriptor would declare it: levels 0..3, where
// `levels[n].erc8004Response` is the minimum response that earns level n.
const LADDER = [50, 70, 90];
const MASK_0_3 = 0b1111n;

function subject8004(chainId, identityRegistry, agentId) {
  return {
    subjectType: ERC8004,
    subjectData: coder.encode(["uint256", "address", "uint256"], [chainId, identityRegistry, agentId]),
  };
}

// SchemeInput as introduced in revision 5: the result domain is committed at registration.
function SI(uri, hash, mode, binding, verifier, predecessor, resultKind, levelMask) {
  return { schemeURI: uri, schemeHash: hash, mode, binding, resultKind, levelMask, verifier, predecessor };
}

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { console.log("  ✗", name, "\n     ", e.message); process.exitCode = 1; }
}

(async () => {
  const h = await Harness.create();
  const A = (n) => ethers.getAddress(h.accounts[n].toString());

  const CHAIN_ID = 1n;                       // the harness VM reports mainnet
  const PROFILE = ethers.id("mock-8294-profile-v1");
  const REQUIRED_VALIDATORS = 5;             // the selection policy's floor (N)

  const schemes = await h.deploy("KYASchemeRegistry");
  const kya = await h.deploy("KYARegistry", [schemes.addr]);
  const identity = await h.deploy("MockIdentityRegistry");
  const validation = await h.deploy("ValidationRegistry8004", [identity.addr]);
  const network = await h.deploy("MockValidationNetwork8294", [PROFILE]);

  // An ATTESTED, IDENTITY-bound, ORDERED_LEVEL scheme declaring levels 0..3, whose descriptor
  // declares `erc8004-validation` as an admissible evidence kind. IDENTITY binding keeps these
  // vectors about the composition rather than about controller transfer, which kya.test.js
  // already covers (R2).
  const schemeHash = ethers.id("scheme://agent-accountability-via-8294");
  const reg = await schemes.send("registerScheme", [
    SI("ipfs://scheme-8294", schemeHash, 0 /* ATTESTED */, 0 /* IDENTITY */, ethers.ZeroAddress, ethers.ZeroHash, 0 /* ORDERED_LEVEL */, MASK_0_3),
  ]);
  const schemeId = reg.logs.find((l) => l.name === "SchemeRegistered").args.schemeId;

  const adapterArgs = (sid, ladder) => [
    kya.addr, validation.addr, network.addr, CHAIN_ID, identity.addr, REQUIRED_VALIDATORS, PROFILE, sid, ladder,
  ];
  const adapter = await h.deploy("ValidationNetwork8294Adapter", adapterArgs(schemeId, LADDER));

  // Two agents, so the subject-mismatch case has somewhere to point. `register` mints to the
  // caller and returns the id, matching the ERC-8004 identity registry's own shape.
  const AGENT = (await identity.send("register", ["ipfs://agent-a.json"], "agentOwner")).result;
  const OTHER_AGENT = (await identity.send("register", ["ipfs://agent-b.json"], "stranger")).result;
  // C3 needs a subject with NO prior assertion, so that "nothing was recorded" is a claim about
  // a clean slate rather than about whatever an earlier case left behind.
  const FRESH_AGENT = (await identity.send("register", ["ipfs://agent-c.json"], "agentOwner")).result;

  const subj = subject8004(CHAIN_ID, identity.addr, AGENT);
  const expires = BigInt(Number(h.timestamp) + 30 * 24 * 3600);

  // Helper: file an 8004 request naming the network as validator, then have the network
  // write the aggregated response — the shape ERC-8294 produces.
  async function runCompleted(requestHash, agentId, response, validatorCount, filedBy = "agentOwner") {
    await validation.send("validationRequest", [network.addr, agentId, "ipfs://req", requestHash], filedBy);
    await network.send("setStatus", [RESPONDED, validatorCount, true]);
    // The network is the ERC-8004 validatorAddress, so the NETWORK writes the aggregate — an EOA
    // cannot, and that restriction is ERC-8004's, not ours.
    const responseHash = ethers.id(`aggregate:${requestHash}:${response}`);
    await network.send(
      "submitAggregate", [validation.addr, requestHash, response, "ipfs://resp", responseHash, "kya"]
    );
    return responseHash;
  }

  console.log("\nERC-8294 → ERC-KYA composition\n");

  // --- C1 ------------------------------------------------------------------
  await test("C1 a completed 8294 run becomes a KYA assertion whose ISSUER is the adapter, not a validator", async () => {
    const requestHash = ethers.id("req-c1");
    await runCompleted(requestHash, AGENT, 95, 7);

    const { logs } = await adapter.send(
      "issueFromValidation", [subj, requestHash, expires, "ipfs://evidence-c1"], "relayer"
    );
    const issued = logs.find((l) => l.name === "AssertionIssuedFromNetwork");
    assert.ok(issued, "expected AssertionIssuedFromNetwork");
    assert.equal(Number(issued.args.validatorCount), 7);
    assert.equal(Number(issued.args.level), 3, "response 95 should map to the top ordered level");

    const a = await kya.call("getAssertion", [issued.args.assertionId]);
    // The recorded issuer is the ADAPTER. This is the whole point: a relying party's
    // `issuers[]` names one accountable contract, not seven rotating validator keys.
    assert.equal(ethers.getAddress(a.issuer), adapter.addr);
    assert.notEqual(ethers.getAddress(a.issuer), A("relayer"), "the relayer must not become the issuer");
    assert.equal(Number(a.level), 3);
    assert.equal(a.schemeId, schemeId, "issued under the scheme the adapter is bound to");
  });

  // --- C2 ------------------------------------------------------------------
  await test("C2 rejected: the run is about a different agent than the asserted subject", async () => {
    const requestHash = ethers.id("req-c2");
    await runCompleted(requestHash, OTHER_AGENT, 95, 7, "stranger");   // run is about OTHER_AGENT…

    await expectRevert(
      // …but the caller asserts about AGENT.
      adapter.send("issueFromValidation", [subj, requestHash, expires, "ipfs://e"], "relayer"),
      "SubjectMismatch"
    );
  });

  // --- C3: the case this set exists for -----------------------------------
  await test("C3 an OPERATIONAL FAILURE is not a negative conclusion: pending and failed runs refuse to issue, they do not issue level 0", async () => {
    const requestHash = ethers.id("req-c3");
    const fresh = subject8004(CHAIN_ID, identity.addr, FRESH_AGENT);
    await validation.send("validationRequest", [network.addr, FRESH_AGENT, "ipfs://req", requestHash], "agentOwner");

    // (a) still pending — nothing has been established about this agent.
    await network.send("setStatus", [PENDING, 7, false]);
    const e1 = await expectRevert(
      adapter.send("issueFromValidation", [fresh, requestHash, expires, "ipfs://e"], "relayer"),
      "ResultNotEstablished"
    );
    assert.ok(String(e1.reason).includes(String(PENDING)), "the revert should name the request state");

    // (b) the run failed — a timeout, no usable aggregate. Still nothing established.
    await network.send("setStatus", [FAILED, 7, false]);
    await expectRevert(
      adapter.send("issueFromValidation", [fresh, requestHash, expires, "ipfs://e"], "relayer"),
      "ResultNotEstablished"
    );

    // (c) quorum missed: fewer validators than the selection policy's floor. The network
    //     reached *an* aggregate, but not one the policy admits — so again, no conclusion.
    await network.send("setStatus", [RESPONDED, REQUIRED_VALIDATORS - 1, true]);
    await expectRevert(
      adapter.send("issueFromValidation", [fresh, requestHash, expires, "ipfs://e"], "relayer"),
      "QuorumNotMet"
    );

    // The load-bearing assertion: after three operational failures, NO assertion exists.
    // Had the adapter mapped any of them to `level = 0`, `resolve` would now be returning a
    // durable negative conclusion that no validator ever reached.
    const resolved = await kya.call("resolve", [fresh, schemeId, [adapter.addr]]);
    assert.equal(Number(resolved[0]), 0, "no level");
    assert.equal(resolved[2], ethers.ZeroHash, "an operational failure must leave NO assertion behind");
  });

  // --- C4 ------------------------------------------------------------------
  await test("C4 source provenance is retained, and a completed-but-negative verdict is distinguishable from C3", async () => {
    const requestHash = ethers.id("req-c4");
    const responseHash = await runCompleted(requestHash, AGENT, 10, 6);   // completed; verdict is poor

    const { logs } = await adapter.send(
      "issueFromValidation", [subj, requestHash, expires, "ipfs://evidence-c4"], "relayer"
    );
    const issued = logs.find((l) => l.name === "AssertionIssuedFromNetwork");
    const a = await kya.call("getAssertion", [issued.args.assertionId]);

    // level 0 here is a REAL verdict from a completed run — the exact value C3 refuses to
    // fabricate. The two are told apart by whether an assertion exists at all.
    assert.equal(Number(a.level), 0);
    assert.ok(Number(a.issuedAt) > 0, "a completed negative verdict IS recorded");

    // evidenceHash re-derives from the 8294 run: which network, which request, which
    // aggregated response, under which verification profile, with how many validators.
    const expectedEvidence = ethers.keccak256(
      coder.encode(
        ["string", "address", "bytes32", "bytes32", "bytes32", "uint16", "uint8"],
        ["erc8004-validation", network.addr, requestHash, responseHash, PROFILE, 6, 10]
      )
    );
    assert.equal(a.evidenceHash, expectedEvidence, "evidenceHash must commit to the source result");
    // claimDigest commits to the (public) run values, as the adapter documents.
    assert.equal(a.claimDigest, ethers.keccak256(coder.encode(["bytes32", "bytes32", "uint8"], [requestHash, responseHash, 10])));
  });

  // --- R: the network cannot move its semantics under a pinned adapter -----
  await test("R the adapter refuses once the network changes its verification profile", async () => {
    const requestHash = ethers.id("req-r");
    await runCompleted(requestHash, AGENT, 95, 7);
    await network.send("setProfile", [ethers.id("mock-8294-profile-v2")]);
    try {
      await expectRevert(
        adapter.send("issueFromValidation", [subj, requestHash, expires, "ipfs://e"], "relayer"),
        "ProfileChanged"
      );
    } finally {
      // Restore UNCONDITIONALLY, so a failure here cannot leak the mutated profile into later cases.
      await network.send("setProfile", [PROFILE]);
    }
  });

  // --- C5 ------------------------------------------------------------------
  // The adapter must not accept a result produced by some other validator address, even when
  // its own network reports a healthy status. Without this, anyone who can get themselves named
  // as an 8004 validator could feed conclusions to a relying party trusting this adapter.
  await test("C5 rejected: the result was written by a validator address other than the pinned network", async () => {
    const requestHash = ethers.id("req-c5");
    const rogue = subject8004(CHAIN_ID, identity.addr, AGENT);
    // request names an EOA validator, not our network
    await validation.send("validationRequest", [A("issuerA"), AGENT, "ipfs://req", requestHash], "agentOwner");
    await network.send("setStatus", [RESPONDED, 7, true]);   // our network claims all is well
    await validation.send(
      "validationResponse",
      [requestHash, 95, "ipfs://resp", ethers.id("rogue-aggregate"), "kya"],
      "issuerA"
    );
    await expectRevert(
      adapter.send("issueFromValidation", [rogue, requestHash, expires, "ipfs://e"], "relayer"),
      "NotExpectedNetwork"
    );
  });

  // --- C6 ------------------------------------------------------------------
  // The adapter is pinned to one chain and one identity registry. A subject naming a different
  // registry must be refused, or an agentId from an unrelated registry could collide with one
  // the network actually validated.
  await test("C6 rejected: a subject naming another identity registry, chain, or subject type", async () => {
    const requestHash = ethers.id("req-c6");
    await runCompleted(requestHash, AGENT, 95, 7);

    const otherRegistry = subject8004(CHAIN_ID, A("stranger"), AGENT);
    await expectRevert(
      adapter.send("issueFromValidation", [otherRegistry, requestHash, expires, "ipfs://e"], "relayer"),
      "UnsupportedSubject"
    );

    const otherChain = subject8004(CHAIN_ID + 1n, identity.addr, AGENT);
    await expectRevert(
      adapter.send("issueFromValidation", [otherChain, requestHash, expires, "ipfs://e"], "relayer"),
      "UnsupportedSubject"
    );

    const wrongType = {
      subjectType: ethers.keccak256(ethers.toUtf8Bytes("account")),
      subjectData: coder.encode(["uint256", "address", "uint256"], [CHAIN_ID, identity.addr, AGENT]),
    };
    await expectRevert(
      adapter.send("issueFromValidation", [wrongType, requestHash, expires, "ipfs://e"], "relayer"),
      "UnsupportedSubject"
    );
  });

  // --- C7 ------------------------------------------------------------------
  // The response→level mapping is the one place a conclusion's STRENGTH is decided. It is the
  // scheme's ladder (LADDER above), so its boundaries are pinned rather than spot-checked.
  // Each call supersedes the last for the same (subject, scheme, issuer) triple; the emitted
  // level is what is being asserted.
  await test("C7 the response→level mapping is exact at every boundary of the scheme's ladder (89/90, 69/70, 49/50)", async () => {
    assert.deepEqual((await adapter.call("thresholds", [])).map(Number), LADDER, "the adapter carries the scheme's ladder");
    const boundary = subject8004(CHAIN_ID, identity.addr, AGENT);
    for (const [response, expected] of [[100, 3], [90, 3], [89, 2], [70, 2], [69, 1], [50, 1], [49, 0], [0, 0]]) {
      const requestHash = ethers.id(`req-c7-${response}`);
      await runCompleted(requestHash, AGENT, response, 7);
      const { logs } = await adapter.send(
        "issueFromValidation", [boundary, requestHash, expires, "ipfs://e"], "relayer"
      );
      // Read the REGISTRY, not the adapter's own event: a case that believes the report of the
      // thing under test is self-grading. The event is checked too, and the two must agree.
      const id = logs.find((l) => l.name === "AssertionIssuedFromNetwork").args.assertionId;
      const stored = Number((await kya.call("getAssertion", [id])).level);
      const reported = Number(logs.find((l) => l.name === "AssertionIssuedFromNetwork").args.level);
      assert.equal(stored, expected, `response ${response}: registry level should be ${expected}, got ${stored}`);
      assert.equal(reported, stored, "the emitted level must agree with what was recorded");
    }
  });

  // --- C8 ------------------------------------------------------------------
  // The floor is `count < required` → reject, so count == required must ADMIT. Off-by-one here
  // would silently raise or lower the policy a relying party thinks it is getting.
  //
  // This case also pins what the adapter does NOT establish: `status()` exposes only
  // `validatorCount`, so ERC-8294's `minOperators` (distinct operators, D) is not observable
  // and not enforced. The recorded assertion therefore carries NO operator-diversity claim.
  await test("C8 quorum floor is exact at count == required, and no operator-diversity claim is recorded", async () => {
    const at = subject8004(CHAIN_ID, identity.addr, OTHER_AGENT);
    const requestHash = ethers.id("req-c8");
    const responseHash = await runCompleted(requestHash, OTHER_AGENT, 95, REQUIRED_VALIDATORS, "stranger");

    const { logs } = await adapter.send(
      "issueFromValidation", [at, requestHash, expires, "ipfs://e"], "relayer"
    );
    const id = logs.find((l) => l.name === "AssertionIssuedFromNetwork").args.assertionId;
    const a = await kya.call("getAssertion", [id]);
    assert.ok(Number(a.issuedAt) > 0, "count == required must be admitted, not rejected");

    // The evidence preimage names the validator COUNT and nothing about operators.
    const expected = ethers.keccak256(
      coder.encode(
        ["string", "address", "bytes32", "bytes32", "bytes32", "uint16", "uint8"],
        ["erc8004-validation", network.addr, requestHash, responseHash, PROFILE, REQUIRED_VALIDATORS, 95]
      )
    );
    assert.equal(a.evidenceHash, expected, "evidence commits the count, and carries no operator claim");
  });

  // --- C9 ------------------------------------------------------------------
  // The ladder belongs to the scheme. The adapter checks the ladder it is given against the
  // scheme's committed result domain at construction, so a deployer cannot (a) hand a 3-step
  // ladder to a scheme that declares 5 levels, (b) hand a ladder that is not strictly
  // increasing or exceeds the 0–100 scale, or (c) bind the adapter to a categorical scheme at
  // all. And the scheme is fixed: `issueFromValidation` takes no schemeId, so a caller cannot
  // route a network result under a scheme whose levels mean something else.
  await test("C9 the ladder is the scheme's: ladder/mask mismatch, malformed ladders and non-ordered schemes are refused at construction; the scheme is pinned", async () => {
    const deployFails = async (args, err) => {
      try { await h.deploy("ValidationNetwork8294Adapter", args); }
      catch (e) { assert.ok(String(e.message).includes(err), `expected ${err}, got: ${e.message}`); return; }
      assert.fail(`construction should have reverted with ${err}`);
    };
    // (a) scheme declares levels 0..4 (mask 0b11111); a 3-step ladder covers only 0..3
    const { result: s04 } = await schemes.send("registerScheme", [
      SI("ipfs://s04", ethers.id("s04"), 0, 0, ethers.ZeroAddress, ethers.ZeroHash, 0, 0b11111n),
    ]);
    await deployFails(adapterArgs(s04, LADDER), "LadderMismatch");
    // ...and a 4-step ladder for it is accepted
    await h.deploy("ValidationNetwork8294Adapter", adapterArgs(s04, [25, 50, 75, 95]));
    // (b) malformed ladders for the 0..3 scheme
    await deployFails(adapterArgs(schemeId, [50, 50, 90]), "LadderMismatch");   // not strictly increasing
    await deployFails(adapterArgs(schemeId, [50, 70, 101]), "LadderMismatch");  // beyond the ERC-8004 scale
    await deployFails(adapterArgs(schemeId, []), "LadderMismatch");             // empty
    await deployFails(adapterArgs(schemeId, [50, 70]), "LadderMismatch");       // too short for 0..3
    // (c) a categorical scheme has no ladder to map onto
    const { result: cat } = await schemes.send("registerScheme", [
      SI("ipfs://cat", ethers.id("cat"), 0, 0, ethers.ZeroAddress, ethers.ZeroHash, 1 /* CATEGORICAL */, 0b1110n),
    ]);
    await deployFails(adapterArgs(cat, [50, 70, 90]), "SchemeNotOrdered");
    // the pinned scheme is observable, and is the one every assertion above was issued under
    assert.equal(await adapter.call("schemeId", []), schemeId);
  });

  console.log(`\n${passed} passed\n`);
})();
