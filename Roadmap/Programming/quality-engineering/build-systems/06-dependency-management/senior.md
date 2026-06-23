# Dependency Management — Senior Level

> **Roadmap:** [Build Systems](../README.md) → Dependency Management
> *Resolution is a SAT solver in disguise, "one version or many" is a correctness decision not a convenience one, and the lock file's hash is the last thin line between your build and a supply-chain compromise. This page treats all three as the engineering problems they are.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Resolution Is SAT — and What That Buys the Solver](#resolution-is-sat--and-what-that-buys-the-solver)
4. [One Version or Many: a Correctness Decision](#one-version-or-many-a-correctness-decision)
5. [MVS, Defended Properly](#mvs-defended-properly)
6. [Integrity and the Supply Chain](#integrity-and-the-supply-chain)
7. [Vendoring at Scale](#vendoring-at-scale)
8. [The Monorepo Single-Version Policy](#the-monorepo-single-version-policy)
9. [Mental Models](#mental-models)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The algorithmic, architectural, and security depths under "the tool resolves your dependencies."**

By now resolution-as-constraint-satisfaction and the newest-compatible/MVS split are familiar. This page goes under each. We'll show that version resolution is *literally* reducible to boolean satisfiability — and why that's why some resolvers were historically incomplete and slow. We'll reframe "multiple versions vs one" not as a packaging convenience but as a decision about **type identity and program correctness**. We'll defend MVS the way its designer does, not as a quirk. We'll trace the integrity story from a lockfile hash up through Sigstore and TUF — the machinery that decides whether you can trust the bytes you downloaded. And we'll weigh vendoring and the monorepo single-version policy as the two main strategies organizations use to take control back from the resolver.

The throughline: at scale, dependency management stops being a per-project convenience and becomes a *correctness, reproducibility, and security* problem with real architectural choices behind it.

---

## Prerequisites

- **Required:** [middle.md](middle.md) — constraint satisfaction, the diamond, lock-file anatomy, MVS vs newest-compatible.
- **Required:** A working grasp of NP-completeness / SAT at the "I know what it means" level.
- **Helpful:** You've operated a build at organizational scale (monorepo, shared registry, or vendored deps).
- **Helpful:** Familiarity with hashing and signatures from [Release Engineering › Supply-Chain Security](../../release-engineering/09-supply-chain-security/).

---

## Resolution Is SAT — and What That Buys the Solver

Version resolution reduces to **boolean satisfiability**. Make a boolean variable for "package P at version v is selected." Encode the rules:

- **Dependency:** if `A@1.5` is selected and it requires `C ^3.0`, then *at least one* of `C@3.0, C@3.1, …, C@3.x` must be selected. → a clause `(¬A1.5 ∨ C3.0 ∨ C3.1 ∨ …)`.
- **Uniqueness (single-version ecosystems):** at most one version of `C` may be selected. → pairwise clauses `(¬C3.0 ∨ ¬C3.1)` etc.
- **Root:** the app's direct requirements must be satisfied (unit clauses).

A satisfying assignment is a valid resolution; *no* satisfying assignment is the "no version satisfies the constraints" error — proven, not guessed. Because SAT is NP-complete, version resolution is NP-hard in general. This is not academic: npm's pre-v7 resolver and old pip both had real cases of exponential blowup or *incorrect* resolutions because they used greedy, incomplete strategies rather than a proper solver.

Modern resolvers handle this with backtracking SAT-style search plus domain-specific heuristics. The standout is **PubGrub** (Dart's `pub`, and Rust's `uv`/`pubgrub` crate): it's a conflict-driven clause-learning (CDCL-flavored) algorithm specialized for version solving. Its key property is *explanatory failure* — when no solution exists, it derives a *minimal, human-readable* reason ("because A 1.0 requires B <2 and C 1.0 requires B >=2, and you require both A and C, there is no solution") instead of dumping a stack trace. That explanation is the practical payoff of treating resolution as proper logical inference rather than greedy search.

```
# A PubGrub-style failure explanation (the gold standard):
Because every version of foo depends on bar ^1.0.0
  and baz 2.0.0 depends on bar ^2.0.0,
  foo is incompatible with baz 2.0.0.
And because your project depends on both foo and baz ^2.0.0,
  version solving failed.
```

> **Key insight:** Once you see resolution as SAT, three things follow. (1) A resolution *failure* is a *proof* of unsatisfiability, not a tooling shortfall — the fix is always to change a constraint, never to retry. (2) Resolution *quality* (does it find a solution that exists?) depends on whether the resolver is *complete*; greedy resolvers can falsely report failure. (3) The best resolvers invest in *explaining* the SAT result, because the human's next action is editing constraints, and a good explanation is the difference between a five-minute and a five-hour fix.

---

## One Version or Many: a Correctness Decision

The middle page framed nested-versions (npm) vs single-version (Go/Maven) as a trade between bloat and conflict-frequency. The deeper truth: it's a decision about **type identity**, and it changes what programs *mean*.

In a single-global-version world, "the type `Config` from library `foo`" is unambiguous — there is exactly one `foo`, one `Config`. In a multiple-version world, `foo@1`'s `Config` and `foo@2`'s `Config` are **distinct types at runtime**, even though they share a name. The consequences are subtle and brutal:

```js
// lib-A is built against left-pad@1 and returns a left-pad@1 Token
// your code uses left-pad@2 and checks instanceof
const tok = libA.makeToken();
if (tok instanceof LeftPadV2.Token) { ... }   // FALSE — it's a V1 Token
// No error. The branch silently doesn't run. Hours of debugging.
```

- **Shared singletons break.** A library that keeps a global registry (a logging singleton, a metrics collector, a DI container) gets *two* registries if two versions load — and half the program registers with the wrong one.
- **`instanceof` / type assertions break** across the version boundary, as above.
- **Memory and binary size balloon** — every duplicated version is duplicated code.

This is why **Go forbids two `v1.x` of the same module path** in one build, and uses *semantic import versioning* — `example.com/foo` and `example.com/foo/v2` are *different import paths* — to make incompatible majors *visibly different identities* in the source, rather than silently-different identities at runtime. Java's classloader hierarchy is the escape hatch in the JVM world (OSGi, shaded jars) precisely because Maven's default is one-version-via-"nearest-wins" mediation, and shading/relocation is how you *opt into* multiple versions when you truly must.

> **Key insight:** "Can two versions coexist?" is really "can two *types with the same name* coexist?" — and the answer reshapes how you reason about identity, singletons, and `instanceof`. npm's model maximizes install success at the cost of these correctness hazards; Go's model accepts hard conflicts to preserve one-name-one-type. When you choose or evaluate an ecosystem, you are choosing which of these failure modes you'd rather debug. Neither is free.

---

## MVS, Defended Properly

MVS is routinely mistaken for "Go is too lazy to pick the newest version." Cox's actual argument is that newest-compatible has a *design flaw* — **builds that change without any change to your code** — and MVS removes it.

The core claims:

1. **High fidelity.** The version you build with should be the version the author *tested with*, not whatever happens to be newest at build time. MVS selects the maximum of the *required minimums*, which is the lowest version everyone agreed to — closest to "what was actually tested together."

2. **Reproducible by construction.** The selected versions are a deterministic, pure function of the `require` graph. There is no "resolve at this instant against the live registry" step whose result depends on wall-clock time. This is why Go needs no lock file *for version selection* — `go.sum` adds integrity, not determinism. Newest-compatible *requires* a lock file to recover the determinism it gave away.

3. **No spooky action at a distance.** Adding dependency X can never silently bump dependency Y to a newer version, because nothing floats to "newest." In npm/cargo, `npm install some-new-thing` can re-resolve and change unrelated transitive versions; in Go, your existing minimums are untouched unless the new dependency *requires* a higher minimum (and then the bump is forced, visible, and recorded in `go.mod`).

4. **Upgrades are an explicit, auditable verb.** `go get foo@latest` and `go get -u` are the *only* ways versions go up. Upgrading is a decision with a diff, not a side effect of installing.

The cost is real and honestly stated: **staleness.** MVS will happily build you with year-old dependencies that have since shipped important fixes, because nothing required a newer minimum. Go's answer is tooling — `go list -m -u all` shows available upgrades; `govulncheck` flags vulnerable selected versions — plus the discipline to run periodic explicit upgrades. The trade is "stale-but-deterministic" over "fresh-but-drifty," and Cox argues determinism is the more valuable property for a build system because *staleness is visible and fixable on your schedule, while drift is invisible and strikes on the registry's schedule.*

```bash
go list -m all                 # the exact MVS-selected versions in this build
go list -m -u all              # ...annotated with available upgrades
go get -u ./... && go mod tidy # opt into upgrading, deliberately
govulncheck ./...              # are any SELECTED versions known-vulnerable?
```

> **Key insight:** MVS trades automatic freshness for build determinism and makes upgrading an explicit act. It is not laziness — it's the position that *a build should not change unless you change it*. Whether you agree depends on whether you fear *drift* (invisible, registry-timed) more than *staleness* (visible, self-timed). Most ecosystems bet the other way and pay for it with mandatory lock files and "why did CI's deps change overnight" incidents.

---

## Integrity and the Supply Chain

A version number is an attacker's playground; a content hash is not. The integrity story climbs three rungs.

**Rung 1 — Content hashing (the lock file).** `go.sum`'s `h1:` hashes, npm's `integrity` `sha512`, `Cargo.lock`'s checksums: on install, re-hash the downloaded artifact and *refuse to proceed on mismatch*. This defeats *post-publication tampering* — a compromised mirror, a corrupted cache, a swapped tarball at the same version. It does **not** prove *who* produced the bytes; it only proves they match what you locked the first time. **Trust on first use (TOFU)** is the gap: the very first resolution has nothing to compare against.

**Rung 2 — A transparent, append-only log.** Go closes the TOFU gap at *ecosystem* scale with the **checksum database** (`sum.golang.org`), a Merkle-tree transparency log (à la Certificate Transparency). The first time *anyone* resolves a module version, its hash is recorded immutably and publicly. Your client verifies your download against this global log, so a malicious server can't serve *you* different bytes than it served everyone else without the discrepancy being publicly detectable. This is the same idea as **TUF (The Update Framework)**, which PyPI and others adopt: role-separated signing keys, freshness/anti-rollback metadata, and resistance to a compromised repository.

**Rung 3 — Provenance and signing.** Hashes prove *integrity*; signatures prove *origin*. **Sigstore** (cosign, Fulcio, Rekor) lets publishers sign artifacts with short-lived, OIDC-identity-bound certificates and log the signature in a public transparency log (Rekor) — so you can verify "this package was built by *this* GitHub Actions workflow in *this* repo," not merely "this matches what I downloaded before." Paired with **SLSA provenance** (a signed statement of *how and where* an artifact was built), this raises the question from "are these the bytes I locked?" to "were these bytes built from the source I think, by a builder I trust?"

```bash
go env GONOSUMCHECK GOSUMDB        # GOSUMDB=sum.golang.org by default
GOFLAGS=-mod=readonly go mod verify # all modules match go.sum
cosign verify-blob --certificate ... artifact.tgz   # Sigstore signature verification
```

The attacks this defends against — covered as war stories in [professional.md](professional.md) — are **dependency confusion** (publishing a public package that shadows a private name), **typosquatting** (`reqeusts` vs `requests`), and **account/registry compromise** (pushing a malicious version of a real package). Each rung addresses a different layer: hashing stops tampering of *known-good* bytes; transparency logs stop *targeted* substitution; signing+provenance stop *malicious-but-validly-published* artifacts by tying them to an identity and a build process.

> **Key insight:** "Integrity" is not one thing. *Content hashing* answers "same bytes as last time?" (tampering). *Transparency logs* answer "same bytes as everyone else gets?" (targeted substitution, TOFU). *Signing + provenance* answer "built by whom, from what, how?" (malicious publication). A lock file gives you rung 1 for free; rungs 2 and 3 are the difference between a hobby project and a hardened software supply chain. See [Release Engineering › Supply-Chain Security](../../release-engineering/09-supply-chain-security/) for the full treatment.

---

## Vendoring at Scale

**Vendoring** means committing your dependencies' *source* into your own repository (Go's `vendor/`, `npm`'s checked-in `node_modules`, Bazel's vendored externals).

```bash
go mod vendor          # copy all deps into ./vendor
go build -mod=vendor   # build ONLY from vendor/, ignore the network and module cache
```

The case *for* vendoring:

- **Hermeticity and availability.** The build needs no network and no upstream registry. If npm, GitHub, or a maintainer's repo vanishes (or a version is *yanked* — see left-pad), your build is unaffected. The deps are *yours* now.
- **Auditability.** Dependency changes appear as ordinary diffs in code review. A senior reviewer can *see* the exact source change a dependency bump introduces — not just a version number ticking in a lock file.
- **Tamper-evidence at build time.** You build the bytes in your repo; there's no install step that could fetch something else.

The case *against*, which dominates at scale:

- **Repository bloat.** Vendoring a large transitive tree adds tens of thousands of files and megabytes-to-gigabytes to every clone, every checkout, every CI job. It strains git (especially without partial clone / sparse checkout).
- **Review noise.** A single dependency upgrade can be a 40,000-line diff no human will actually read — so the *auditability* benefit becomes theatre. Reviewers rubber-stamp it.
- **Merge conflicts and churn** in `vendor/` across branches.

This is why the modern stance is often "**lock file + verified cache + private mirror**" instead of vendoring: you get availability (mirror) and integrity (hashes + checksum DB) *without* committing the source. Bazel and Nix push further — they pin dependencies by hash in *their* config and fetch into a content-addressed store, achieving vendoring's hermeticity without vendoring's repo bloat ([05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/senior.md)). Vendoring remains genuinely justified for: tightly air-gapped builds, regulated environments demanding in-repo provenance, and small dependency sets where the diff *is* reviewable.

> **Key insight:** Vendoring trades repo weight and review noise for network-independence and tamper-evidence. The "auditability" argument is only real when the dependency set is small enough that diffs are *actually read* — otherwise it degrades to a rubber stamp on an unreadable diff. At scale, a private mirror plus verified hashes usually delivers the availability and integrity benefits without the costs, so reserve vendoring for air-gapped or regulated cases.

---

## The Monorepo Single-Version Policy

Large monorepos (Google, and many that copy the model) enforce a **single-version policy**: across the *entire* repository, there is exactly **one** version of each third-party dependency. No two services may depend on different versions of `protobuf`.

The rationale is the diamond problem applied to an organization. In a polyrepo world, team A pins `grpc@1.40` and team B pins `grpc@1.55`; they never interact, so the divergence is invisible — until a shared library must link against both, and now it's unsolvable. The single-version policy makes the divergence *impossible by construction*: there is one `grpc`, and everyone is on it.

Consequences, traded honestly:

- **Upgrades become atomic and global.** Bumping `grpc` updates *every* consumer in one commit. This is enormous work, but it's *done once, correctly,* with the whole repo's tests as the gate — rather than N teams each discovering the breakage on their own schedule. Tools like Google's `Rosie`/large-scale-change tooling exist specifically to land these sweeps.
- **No diamond conflicts, ever.** The hardest dependency failure mode is structurally eliminated.
- **The cost is real and concentrated:** upgrading a foundational dependency can require fixing hundreds of call sites and is gated on the *entire* repo passing. A team that wants a new `grpc` feature can't just bump it locally; they may have to drive (or sponsor) the global migration.

This only works *with* a build system that understands the whole graph (Bazel) and a culture/tooling for large-scale changes. It's the organizational analogue of Go's single-global-version decision: pay a coordinated, visible upgrade cost to eliminate an invisible, unbounded conflict cost.

> **Key insight:** The single-version policy converts a *distributed, invisible, eventually-explosive* problem (every team drifting to different versions) into a *centralized, visible, scheduled* one (one global upgrade with the whole repo as the test gate). It's the same trade as MVS and as one-global-version, scaled to an organization: prefer the conflict you can see and schedule over the one that ambushes you. It demands monorepo tooling and large-scale-change machinery to be viable.

---

## Mental Models

- **The resolver is a theorem prover.** It either produces a model (a valid version assignment) or a proof of unsatisfiability (the conflict). Treat its "no solution" as a *theorem about your constraints*, and treat a good resolver's *explanation* as the proof you act on.

- **Two versions = two types.** The whole nested-vs-single debate collapses to this. If a name can refer to two runtime types, `instanceof`, singletons, and shared state are landmines. Single-version ecosystems forbid the landmine; multi-version ones let you keep installing at the price of stepping on it.

- **Integrity is a ladder, not a checkbox.** Hash (same bytes as before) → transparency log (same bytes as everyone) → signature + provenance (built by whom, from what). Know which rung your build stands on; assume nothing above it.

- **Vendoring is "freeze the source"; MVS/lockfiles are "freeze the selection."** Both fight non-determinism, at different layers. Vendoring also buys network-independence; lock files + mirror buy it more cheaply. Pick the layer that matches your threat model and repo size.

---

## Common Mistakes

1. **Retrying a resolution failure.** A SAT-unsatisfiable result won't change on retry, cache-clear, or reinstall. It's a proof. Read the conflict explanation and relax a constraint.

2. **Ignoring duplicate-version identity bugs.** When a singleton "isn't a singleton" or `instanceof` mysteriously fails, suspect two copies of the same package before suspecting your logic. `npm ls <pkg>` / `npm dedupe` is the diagnosis.

3. **Treating the lock-file hash as proof of authenticity.** It proves *the same bytes as you first locked* — TOFU. It does **not** prove who made them. For authenticity you need the checksum DB / transparency log (rung 2) and signing/provenance (rung 3).

4. **Disabling the checksum database "to make it work."** `GONOSUMDB`/`GONOSUMCHECK`/`GOFLAGS=-insecure` turns off the transparency-log defense. People do this to dodge a private-module config issue and silently drop to TOFU. Configure `GOPRIVATE` instead.

5. **Vendoring a huge tree for "auditability."** If the upgrade diff is 40k lines no one reads, you have repo bloat and a rubber stamp, not auditability. Use a verified mirror unless the set is small or you're genuinely air-gapped.

6. **Expecting MVS to ever pick a newer version on its own.** It won't. Staleness is the *designed* behavior. Schedule explicit `go get -u` + `govulncheck`; don't wait for the resolver to freshen deps, because it never will.

---

## Test Yourself

1. Sketch how a version-resolution instance maps to a SAT instance. What does an *unsatisfiable* instance correspond to, and what's the only valid response to it?
2. Why is "can two versions of a package coexist?" really a question about *type identity*? Give a concrete bug that arises when they do.
3. State three of Cox's arguments for MVS, and the one real cost MVS pays.
4. Distinguish what a lock-file hash proves, what a transparency log (`sum.golang.org`) adds, and what signing/provenance (Sigstore/SLSA) adds on top.
5. Give two genuine reasons to vendor and two reasons the industry largely moved away from it at scale. What's the usual replacement?
6. What invisible, distributed problem does a monorepo single-version policy eliminate, and what visible, concentrated cost does it accept in exchange?

<details>
<summary>Answers</summary>

1. Boolean variable per (package, version); clauses encode "selected ⇒ a satisfying version of each dependency is also selected," at-most-one-version (single-version ecosystems), and the root requirements. A satisfying assignment is a valid resolution; an **unsatisfiable** instance is a *proof* there's no valid set of versions. The only valid response is to **relax/change a constraint** — retrying cannot help.
2. Two coexisting versions are two *distinct runtime types* with the same name. Concrete bug: a `Token` created by `foo@1` fails an `instanceof foo@2.Token` check (silently takes the wrong branch); or a library's singleton registry exists twice, so half the program registers with the wrong instance.
3. Any three of: **high fidelity** (build with versions the authors tested together — the agreed minimums); **reproducible by construction** (selected versions are a pure function of the require graph, no lock file needed for determinism); **no spooky action** (adding a dep can't silently bump an unrelated one); **explicit upgrades** (`go get` is the only way up). The cost: **staleness** — it never freshens deps on its own.
4. Lock-file hash: "the bytes match what I locked the first time" — tampering defense, but TOFU (no authenticity). Transparency log: "the bytes match what *everyone* got" — defeats targeted substitution and closes TOFU at ecosystem scale. Signing/provenance: "built by *this identity* from *this source* via *this builder*" — authenticity and build-origin, defending against maliciously-but-validly-published artifacts.
5. For: network-independent/hermetic builds resilient to yanks/outages; in-repo auditability and tamper-evidence (when the set is small). Against at scale: repo bloat (huge clones/CI) and review noise (unreadable mega-diffs that become rubber stamps). Usual replacement: lock file + integrity hashes + a private verified mirror (or a content-addressed store via Bazel/Nix).
6. Eliminates **silent version drift across teams** — every team independently pinning different versions of a shared dep, invisible until a shared boundary makes the diamond unsolvable. The accepted cost: **global, atomic upgrades** — bumping a foundational dep means fixing every consumer in one change, gated on the whole repo's tests.

</details>

---

## Cheat Sheet

```
RESOLUTION = SAT
  vars: (package, version) selected?  clauses: dep-implies, at-most-one, root-reqs
  unsatisfiable = PROOF of conflict → relax a constraint (never retry)
  PubGrub / uv / pub = CDCL-style + minimal human-readable failure explanations

ONE VERSION vs MANY  = a TYPE-IDENTITY decision
  many (npm)   → install always succeeds; instanceof/singletons/size HAZARDS
  one  (Go/Maven) → coherent identity; diamond can be a HARD FAIL
  Go: foo vs foo/v2 = different import paths (semantic import versioning)

MVS (Cox)  picks max(required minimums)
  + high fidelity (tested-together versions)
  + reproducible by construction (no lockfile needed for determinism)
  + no spooky upgrades ; upgrades are explicit (go get)
  − STALENESS (never freshens) → schedule go get -u + govulncheck

INTEGRITY LADDER
  1 content hash  (go.sum / integrity)   "same bytes as I locked"  (TOFU)
  2 transparency log (sum.golang.org/TUF) "same bytes as everyone"
  3 signing+provenance (Sigstore/SLSA)    "built by whom, from what, how"

VENDORING  = freeze the SOURCE in-repo
  + hermetic, yank-proof, tamper-evident, diff-reviewable
  − repo bloat, unreadable mega-diffs, merge churn
  scale replacement: lockfile + hashes + private mirror, or Bazel/Nix CAS

MONOREPO SINGLE-VERSION POLICY
  one version of each dep, repo-wide → no diamonds, atomic global upgrades
  trades invisible distributed drift for visible scheduled upgrade cost
```

---

## Summary

- Version resolution **reduces to SAT**: a failure is a *proof* of unsatisfiability (relax a constraint, never retry), and resolver quality is about completeness and the quality of the *explanation* (PubGrub's gold standard).
- "Multiple versions vs one" is a **correctness decision about type identity**, not just bloat: coexisting versions are distinct runtime types, breaking `instanceof`, singletons, and shared state. Go forbids two `v1.x` and uses semantic import versioning to keep one-name-one-type.
- **MVS** is principled, not lazy: high fidelity, reproducible-by-construction, no spooky upgrades, explicit upgrade verb — paid for with *staleness*, which is visible and fixable on your schedule (unlike drift).
- **Integrity is a ladder:** content hashes (tampering, TOFU) → transparency logs (targeted substitution) → signing + provenance (authenticity and build origin). A lock file gives rung 1; hardened supply chains need 2 and 3.
- **Vendoring** freezes source in-repo for hermeticity and tamper-evidence, but at scale its costs (bloat, unreadable diffs) usually outweigh it; a verified private mirror or content-addressed store is the common replacement.
- The **monorepo single-version policy** structurally eliminates diamond conflicts by enforcing one version repo-wide, converting invisible distributed drift into a visible, scheduled, atomic upgrade cost — viable only with whole-graph build tooling.

The [professional.md](professional.md) page takes these to the org level: automated update pipelines, SBOMs and provenance at scale, dependency-confusion and typosquatting defenses, private registries, license compliance, and the war stories that taught the industry these lessons the hard way.

---

## Further Reading

- [Russ Cox — "The Principles of Versioning in Go"](https://research.swtch.com/vgo-principles) and the [MVS](https://research.swtch.com/vgo-mvs) essay — the full design argument.
- [PubGrub: Next-Generation Version Solving](https://nex3.medium.com/pubgrub-2fb6470504f) — resolution as conflict-driven search with explanations.
- [The Update Framework (TUF) spec](https://theupdateframework.io/) and [Sigstore docs](https://docs.sigstore.dev/) — the integrity and provenance machinery.
- [Go Module Authentication — the checksum database](https://go.dev/blog/module-mirror-launch) — the transparency log in practice.
- *Software Engineering at Google* (Winters et al.), ch. on Dependency Management and the one-version rule.

---

## Related Topics

- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/senior.md) — pinning by hash in Bazel/Nix; content-addressed stores as vendoring done right.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — locked, hashed dependencies as a precondition for bit-identical builds.
- [04 — Per-Language Tools](../04-per-language-tools/middle.md) — how each toolchain implements resolution and integrity.
- [Release Engineering › Supply-Chain Security](../../release-engineering/09-supply-chain-security/) — SBOMs, SLSA, signing, and provenance in depth.
- [professional.md](professional.md) — governance, automated updates, confusion/typosquatting defenses, and war stories.
