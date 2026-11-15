# Know-Your-Agent (KYA) Framework — ERC draft

A scheme-agnostic registry and handshake standard for recording, resolving and presenting **trust assertions about AI agents**, with a **zero-knowledge (ZK-KYA) profile** and a normative **ERC-8004 binding**.

> Status: Draft · **ERC-8419** (number assigned 2026-09-20 in ethereum/ERCs PR #2012) · discussion thread: https://ethereum-magicians.org/t/erc-8419-know-your-agent-kya-framework/29735

## What it is — in one paragraph

ERC-8004 gives agents identity and raw trust *signals*. This ERC gives the agent economy a shared container for trust *conclusions*: a **Scheme Registry** that addresses and versions KYA principles (what is checked, what it binds to — identity / controller / instance — how the result is expressed, how assertions are admitted; semantics immutable per `schemeId`), a **KYA Registry** that records assertions (subject · scheme · issuer · result · validity · anchor · revocation) and resolves them under a relying party's chosen issuers, an **EIP-712 handshake** with normative acceptance rules, and a minimal **Policy Registry** (base + optional on-chain evaluator). The framework never defines a KYA algorithm or a credit rule — those live in scheme descriptors and pluggable `IKYAVerifier` contracts. **ZK-KYA is a mode of the same registry**, not a second standard: an assertion is admitted by a verifier contract checking a proof instead of by an issuer's signature; it hides the fact issuer and the facts, not the subject. Two usage patterns (combinable) fit the same interface — *credential* (a hidden issuer signed a verdict in advance; the reference circuit) and *predicate* (the scheme is the decision rule, the prover evaluates it over its own authenticated data, and only the verdict is presented — no pre-issued credit verdict, no raw data sent to the counterparty; the reference implementation does not yet include a predicate circuit) — see ERC §5.1. A **KYA Bridge** optionally mirrors a lossy snapshot into the ERC-8004 Validation Registry so ERC-8004-only clients see it under a `kya:` tag.

```
L4  Policy          "counterparty must satisfy (scheme, minLevel, issuers) …"
L3  Handshake       KYAChallenge / KYAPresentation (EIP-712) · /.well-known/kya.json
L2  KYA Registry    attest() | attestWithProof()  →  resolve() / check()
L1  Scheme Registry registerScheme(SchemeInput{uri, hash, mode, binding, resultKind, levelMask, verifier, predecessor})
L0  Subject         erc8004 (MUST) · account · erc721 · did
        ▲ ERC-8004 identity + signals as input      │ KYABridge8004 → Validation Registry (tag "kya:…")
```

## Repository layout

```
ERCS/erc-kya.md                     the ERC text (EIP-1 format, ERC-8419)
assets/erc-kya/
  contracts/
    interfaces/                     IKYATypes, IKYASchemeRegistry, IKYARegistry, IKYAPolicyRegistry, IKYAVerifier, IERC8004Validation
    KYASchemeRegistry.sol           permissionless scheme registry
    KYARegistry.sol                 assertions: attested + proved modes, supersession, revocation, resolve/check
    KYAPolicyRegistry.sol           policy ids + optional on-chain allOf evaluation
    KYABridge8004.sol               curated ERC-8004 validator mirroring KYA levels to 0–100 (lossy snapshot; reverts on unmapped levels)
    verifiers/Groth16KYAVerifierAdapter.sol   snarkjs-style Groth16 → IKYAVerifier (kya-public-v1, 15 signals incl. schemeId + admissionDomain, epoch window enforced on-chain)
    companions/ValidationRegistry8004.sol     spec-conforming ERC-8004 Validation Registry (canonical one not yet deployed)
    adapters/ValidationNetwork8294Adapter.sol ERC-8294 validation network → KYA assertion via the ATTESTED path (composition adapter; not shipped in the ERC assets)
    mocks/Mocks.sol                 test-only identity registry and verifiers
    mocks/MockValidationNetwork8294.sol       test-only ERC-8294 network surface
  schemas/                          kya-scheme / kya-policy / kya-discovery JSON Schemas
  vectors/                          vectors.json + example descriptors
tools/compile.js                    solc-js build → build/artifacts.json
tools/vectors.js                    regenerates vectors.json
tools/prepare-pr.sh                 lays the files out as an ethereum/ERCs PR
tools/mutate-composition.js         mutation harness for the ERC-8294 composition vectors (each guard deleted in turn; its named case must be the one that fails)
test/kya.test.js                    in-process EVM end-to-end suite (18 cases + 8 regression cases from the review thread (R1–R8), no RPC needed)
test/composition-8294.test.js       ERC-8294 → KYA composition vectors (10 cases, mutation-checked 12/12)
test/zk.test.js                     real Groth16 proof → Verifier.sol → adapter → KYARegistry, incl. adversarial + admission-domain cases (17 cases)
companions/zk-kya-groth16/          EXPERIMENTAL reference ZK-KYA circuit (circom) + prover tooling + built keys
scripts/deploy-sepolia.js           deploys the stack to Sepolia against the official ERC-8004 IdentityRegistry
scripts/examples-sepolia.js         six worked examples on Sepolia (agent, schemes, attested, ZK, policy, bridge)
docs/scheme-authoring-notes.md      guidance for scheme authors: evidence bounds the conclusion, provenance-committed vs consumption-bound, external-score ladders, claimDigest
```

## Build & test

```bash
npm install
node tools/compile.js        # solc 0.8.28, optimizer on, cancun
node test/kya.test.js        # 26 end-to-end tests on an in-process EVM
node test/composition-8294.test.js   # ERC-8294 → KYA composition vectors
node tools/mutate-composition.js     # mutation check of the composition vectors
node tools/vectors.js        # regenerate assets/erc-kya/vectors/vectors.json
npm run test:zk              # ZK companion end-to-end with a real Groth16 proof (uses the shipped test zkey)
```

## Sepolia

```bash
export RPC_URL=https://ethereum-sepolia-rpc.publicnode.com   # or your own
export PRIVATE_KEY=0x...                                      # funded with ~0.05 Sepolia ETH
npm run deploy:sepolia       # → deployments/sepolia.json
npm run examples:sepolia     # → deployments/sepolia-examples.json (every tx hash)
```

The deployment binds to the **official ERC-8004 IdentityRegistry on Sepolia** (`0x8004A818BFB912233c491871b3d84c89A494BD9e`); the demo agent is a real ERC-8004 agent. Because the canonical ERC-8004 Validation Registry is not yet deployed on any public network, the companion deploys a spec-conforming `ValidationRegistry8004` bound to that identity registry so the KYA Bridge can be exercised end to end. The ZK example uses the shipped **test-ceremony** keys and three demo attestors derived from public seeds — reproducible by anyone, secure for no one.

### Deployed addresses (revision 6, current)

Revision 6 (2026-10-22, fourth review round, "Response Map": `configureScheme` refuses a `responseMap` whose first entry is non-zero or that is not non-decreasing) redeploys **only the bridge**; the four registries are the revision-5 instances (2026-10-11) and the Groth16 verifier and adapter the revision-4 instances. Full records with every tx hash: [`deployments/sepolia.json`](deployments/sepolia.json) and [`deployments/sepolia-examples.json`](deployments/sepolia-examples.json). Earlier deployments are kept for the record (`sepolia-r1.json` … `sepolia-r5.json`, the withdrawn `sepolia-r4-draft.json`, and their `-examples` files) and **must not be relied on**; in particular earlier bridges' records in the Validation Registry are not part of the current query path.

> **Key note.** The private key of the revision 1–5 deployer `0x65ab82feC38c3A5F2A5b0bd96cB3255E7A45ae42` was lost with the sandbox that held it. The revision-5 bridge `0xdc39aaE1…B850`, the controller role of the two example schemes and demo agent 10387 can no longer be operated; the schemes themselves remain usable by any issuer (their semantics are immutable). The revision-6 bridge is owned by a new session-held key and its example uses a freshly registered demo agent.

| contract | address | block |
|---|---|---|
| KYASchemeRegistry (rev 5) | [`0x8Dd5ec713E21a726FB864f6541F9AAA59aEC0cc0`](https://sepolia.etherscan.io/address/0x8Dd5ec713E21a726FB864f6541F9AAA59aEC0cc0) | 11886801 |
| KYARegistry (rev 5; `admissionDomain()` = `0x779cd7d5…4fc6`) | [`0xE06FBA26561E7A385B32514f6657De68723d5cF1`](https://sepolia.etherscan.io/address/0xE06FBA26561E7A385B32514f6657De68723d5cF1) | 11886819 |
| KYAPolicyRegistry (rev 5) | [`0x7767966702bf12C31CDD600807B77443998f0F21`](https://sepolia.etherscan.io/address/0x7767966702bf12C31CDD600807B77443998f0F21) | 11886838 |
| ValidationRegistry8004 (rev 5) | [`0x91103a508b0525B0b16146Ad5C0a7c719148b14c`](https://sepolia.etherscan.io/address/0x91103a508b0525B0b16146Ad5C0a7c719148b14c) | 11886838 |
| **KYABridge8004 (rev 6)** | [`0x2E70783ec4A0aB5b0A109908151403Ce03FC11Ec`](https://sepolia.etherscan.io/address/0x2E70783ec4A0aB5b0A109908151403Ce03FC11Ec) | 11966154 |
| Groth16Verifier (circuit rev 3, 15 signals; rev 4) | [`0x64c18C506e8a202d98822F97911dF774e9b85f85`](https://sepolia.etherscan.io/address/0x64c18C506e8a202d98822F97911dF774e9b85f85) | 11744756 |
| Groth16KYAVerifierAdapter (epoch 30 d, grace 1, pinned root; rev 4) | [`0x7C424db1f07d5BCA5b58Dc4b573f31c32a70bCE7`](https://sepolia.etherscan.io/address/0x7C424db1f07d5BCA5b58Dc4b573f31c32a70bCE7) | 11744757 |

Schemes (rule identities, registered in revision 5): attested `0x928e5f455d77881a4e9bec600236a5d1124c8176fb174c90b2b89aa9b6375907` (binding `controller`, `ORDERED_LEVEL`, `levelMask 0xf`), proved (ZK) `0x50daf587aadc42f6f6d0e32376874054cddda59b41656c844e8a0d5e8f0d8a99` (`ORDERED_LEVEL`, `levelMask 0x11`). The revision-5 worked examples on agent **10387** (attest, attestWithProof with a real Groth16 proof, policy `evaluate`) are unchanged on chain and recorded in `deployments/sepolia-examples-r5.json`. The revision-6 bridge example runs on a new demo agent **11206**: [register](https://sepolia.etherscan.io/tx/0xf5c080c238b5ce271cba4ecb85866f7e408d48101c737d625c769a830b70616b) · [setMetadata "kya"](https://sepolia.etherscan.io/tx/0x0a6f91a9bffda6d22f22c80c93933e696ff4d0236dba4ce6bca02f2205abb0e1) · [attest level 2](https://sepolia.etherscan.io/tx/0xadd6767f9082a29e5ffea211385679ce1183dec7c23fd5a9c4e84b7a0220cb9f) · bridge [configure](https://sepolia.etherscan.io/tx/0xce6f0594a047e7c010e1c2246584d38f639b7ad3550af927e945b2d89c0ef008) (`[0, 25, 60, 100]`; `[25, 25, 60, 100]`, `[0, 60, 25, 100]` and `[0, 25, 60, 101]` all revert `BadResponseMap` on-chain) → [request (stable requestHash)](https://sepolia.etherscan.io/tx/0x9a522dc1388a606cc7e4bcbe03ad12378f24e200c668011ba138cbf681f8ab20) → [sync](https://sepolia.etherscan.io/tx/0xbdd349c422e43758ec1899806dcd28715d7e49f52ef5b6e19f0a4ab3225c920b) (60/100 under the full-schemeId tag, `responseHash = H(assertionId, 2, configHash)` verified against the mirrored record).

Ownership: the revision-6 bridge owner is a session-held throwaway key; the controller role of the two example schemes sits on the lost revision-5 key and cannot be transferred. A maintainer address for the bridge owner is still to be supplied; the transfer will be recorded in `deployments/ownership.json`.

## Key derivations

| value | formula |
|---|---|
| `subjectKey` | `keccak256(abi.encode(subjectType, subjectData))` |
| `erc8004` subject | `subjectType = keccak256("erc8004")`, `subjectData = abi.encode(chainId, identityRegistry, agentId)` |
| `schemeId` | `keccak256(abi.encode(chainId, schemeRegistry, controller, schemeHash, controllerNonce))` — a rule identity; reusable by several KYA Registries |
| `levelMask` / `resultKind` | immutable per scheme; bit `n` of `levelMask` set ⇔ level `n` is a valid result. `ORDERED_LEVEL`: bit 0 plus at least one higher bit · `CATEGORICAL`: any non-zero mask · `OPAQUE`: exactly bit 0. `attest`/`attestWithProof` revert on an undeclared level; `check`/`resolve`/policy/bridge accept ordered schemes only |
| `admissionDomain` | `keccak256(abi.encode(keccak256("erc-kya-registry-admission-v1"), chainId, schemeRegistry, kyaRegistry))` — computed by the admitting KYA Registry, passed to `IKYAVerifier.verify`; proofs and nullifiers are scoped to it |
| `assertionId` | `keccak256(abi.encode(subjectKey, schemeId, issuer, issuerNonce))` |
| `policyId` | `keccak256(abi.encode(owner, policyHash, rulesHash, ownerNonce))`, `rulesHash = keccak256(abi.encode(Rule[] allOf))` or `0x0` |
| binding witness | `controller`: `keccak256(abi.encode(ownerOf(agentId)))` at issuance · `instance`: `claimDigest` · `identity`: `0x0` |
| bridge `configHash` | `keccak256(abi.encode(schemeId, trustedIssuers, responseMap))` |
| bridge `requestHash` | `keccak256(abi.encode(keccak256("erc-kya-request-v1"), chainId, identityRegistry, bridge, agentId, schemeId))` — stable; configuration lives in `responseHash` |
| bridge `responseHash` | `keccak256(abi.encode(assertionId, level, configHash))` |
| bridge `tag` | `"kya:" + full schemeId as 64 lowercase hex chars` |
| ZK `publicInputs` (kya-public-v1) | `abi.encode(subjectKey, nullifier, level, claimDigest, expiresAt, issuerSetRoot, epoch)` — adapter appends `schemeId` and `admissionDomain` as signals (15 total) and enforces `current-epochGrace ≤ epoch ≤ current` |
| ZK nullifier (circuit rev 3) | `Poseidon(secret, schemeId.hi, .lo, admissionDomain.hi, .lo, epoch)` |
| ZK credential (unchanged since circuit rev 2) | attestor signs `Poseidon(subjectKey.hi, .lo, schemeId.hi, .lo, level, claimDigest.hi, .lo, expiresAt, Poseidon(secret))` |

## Relationship to other standards

- **ERC-8004 Trustless Agents** — primary subject type and mirror target. No changes to 8004 contracts required.
- **ERC-8143 Smart Credential Resolution** — a single-function credential fetch interface that mentions KYA and ZKPs; this ERC provides the scheme/level/admission/revocation semantics it lacks and can expose an 8143-style view (`getCredential("kya:"+schemeId)`).
- **EAS and similar attestation services** — can serve as a storage layer beneath a KYA Registry; this ERC defines the agent-KYA semantic layer, not another generic attestation primitive.
- **ERC-8294 Validation Network for ERC-8004** — composes through the ordinary ATTESTED path: an adapter reads a completed network run and calls `attest()`, so the adapter is the recorded issuer; an operational failure (pending, failed, below quorum) is refused rather than recorded as level 0; the response → level ladder is the scheme's, checked against `resultDomain`. Reference adapter under `contracts/adapters/`, vectors in `test/composition-8294.test.js`.
- **Token-bound skill / task standards (ERC-8338, ERC-8414)** — informative use cases: skill sellers and task fulfillers present KYA assertions; task descriptors reference a `policyId`.

## Filing as an ethereum/ERCs PR

`tools/prepare-pr.sh <path-to-ERCs-fork> <number>` copies `ERCS/erc-kya.md` to `ERCS/erc-<number>.md`, `assets/erc-kya/` to `assets/erc-<number>/`, (the sources already carry the assigned number 8419; the script is kept for renumbering if ever needed). Work on a fresh branch (`add-erc-kya`) cut from the latest `upstream/master`; never commit to `master`.

## Contributors

- ERC-8294 → KYA composition adapter, its test vectors and the mutation harness: TMerlini (GitHub `Echo-Merlini`), co-author of ERC-8294, via kya-standard pull request #1; reworked on merge to bind the adapter to one scheme and take the response ladder from the scheme's committed result domain.

## License

CC0-1.0
