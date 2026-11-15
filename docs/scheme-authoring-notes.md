# Scheme authoring notes

Companion guidance for authors of KYA scheme descriptors. Nothing here is normative; the normative text is `ERCS/erc-kya.md`. These notes record how the rules in that text apply to recurring situations that came up while composing KYA with other proposals, so that a scheme author can cite one place rather than re-derive the reasoning.

## 1. Evidence authorises only the conclusion it establishes

A scheme turns evidence into a conclusion about a subject. The conclusion a scheme may draw is bounded by what its evidence actually proves, not by what the evidence is named after. Two consequences recur.

**An operational failure is not a negative conclusion.** If an evidence source (a validation network, an oracle, a verifier) did not complete, timed out, or returned below its own quorum, it has said nothing about the subject. A scheme or an issuing adapter must refuse to record anything in that case rather than record level 0: level 0 is "not verified / failed", a durable negative conclusion, and a resolver will treat it as one. The distinction is observable afterwards — a completed negative verdict exists as a level-0 assertion, an operational failure leaves no assertion — and the reference adapter for ERC-8294 networks (`assets/erc-kya/contracts/adapters/ValidationNetwork8294Adapter.sol`, case C3 in `test/composition-8294.test.js`) is built around exactly that line.

**Per-invocation evidence does not become a standing conclusion by itself.** An attestation about one invocation of an agent (for example an input-provenance attestation of the kind ERC-8299 describes) is evidence about that invocation. A scheme that wants a standing conclusion about the agent — the informative ladder's `provenance-verified`, say — has to state in its descriptor how many such attestations, over which window, under which issuers, make up that conclusion. The attestation is consumable evidence; the level is the scheme's claim.

## 2. Two provenance conclusions, declared separately

Input-provenance chains support two conclusions of different strength, and a scheme should say which one it draws rather than let readers infer the stronger from the weaker.

**Provenance-committed.** "The inputs to this pipeline were committed and are recomputable." An input-provenance attestation that commits `input_hash` and the recomputation method supports this on its own. It does not show that any particular run of the agent read those inputs.

**Consumption-bound.** "This exact input was consumed by this invocation." This requires, in addition, an artifact that binds `input_hash` to the specific invocation — an execution receipt, a signed invocation record, a verifier output that takes the input commitment as a public input. A scheme that draws this conclusion names that binding artifact in its descriptor as an evidence kind (the `evidenceKinds` member), so that an issuer, an adapter or a relying party can check that the binding was actually presented. The existence of a provenance chain is not that binding, and a scheme must not treat it as one.

A scheme may define both as separate levels of one ordered ladder (consumption-bound above provenance-committed) or as two schemes; either way each level's evidence requirements go in the descriptor, and an issuer records only the level whose evidence it has.

## 3. Mapping an external score onto a scheme's ladder

When an issuing adapter turns an external score (an ERC-8004 response in 0–100, a network aggregate, a vendor rating) into a KYA level, the mapping is part of the scheme's semantics, not the adapter's. Since revision 5 the registry commits each scheme's `resultKind` and `levelMask` on-chain and refuses undeclared levels, and since revision 6 a bridge's `responseMap` must start at 0 and be non-decreasing. The same discipline applies in the other direction:

- declare the ladder in the descriptor: for an ordered scheme consuming ERC-8004 responses, `levels[n].erc8004Response` is read as the minimum response that earns level *n*, so the ladder is strictly increasing;
- bind an adapter to one scheme and give it that scheme's ladder at construction; the adapter checks the ladder against `resultDomain(schemeId)` (ordered kind, exactly the declared levels, strictly increasing, within scale) and refuses to construct otherwise;
- do not let a caller choose the scheme at issue time. An adapter that accepts a `schemeId` per call will, sooner or later, record a level whose meaning under that scheme is not what the adapter's thresholds assumed.

The reference adapter follows this shape; case C9 of the composition suite pins it, and `tools/mutate-composition.js` checks that each guard is the one its case covers.

## 4. `claimDigest` for public evidence

Section 4 requires `claimDigest` to be a commitment with adequate entropy rather than a direct encoding of a small claim space, because every recorded `claimDigest` is public. When the committed claims are themselves already public on-chain — an ERC-8004 request hash, response hash and response, for instance — the commitment hides nothing that was not already visible, and committing over those public hashes satisfies the entropy requirement without a separate salt. When the claims are not public, salt them.
