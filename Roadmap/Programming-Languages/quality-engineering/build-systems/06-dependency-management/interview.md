# Dependency Management — Interview Preparation

> **Roadmap:** [Build Systems](../README.md) → Dependency Management
> *Dependency-management questions split candidates fast: people who can recite "commit the lock file" and people who can explain* why *resolution is a SAT problem, why two versions of one package is a correctness bug, and how a checksum stops a supply-chain attack. This bank gives you the model answers, what each question is really probing, and the design scenarios that separate "I ran `npm install`" from "I governed dependencies for a thousand repos."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [How to Use This Page](#how-to-use-this-page)
3. [Section 1 — Semantic Versioning](#section-1--semantic-versioning)
4. [Section 2 — Version Ranges and Constraints](#section-2--version-ranges-and-constraints)
5. [Section 3 — Manifests and Lock Files](#section-3--manifests-and-lock-files)
6. [Section 4 — Resolution Algorithms](#section-4--resolution-algorithms)
7. [Section 5 — MVS vs Newest-Compatible](#section-5--mvs-vs-newest-compatible)
8. [Section 6 — Diamonds and Version Conflicts](#section-6--diamonds-and-version-conflicts)
9. [Section 7 — One Version or Many](#section-7--one-version-or-many)
10. [Section 8 — Supply-Chain Integrity](#section-8--supply-chain-integrity)
11. [Section 9 — Vendoring](#section-9--vendoring)
12. [Section 10 — Org Governance and Automated Updates](#section-10--org-governance-and-automated-updates)
13. [Section 11 — Design and Debugging Scenarios](#section-11--design-and-debugging-scenarios)
14. [Rapid-Fire Round](#rapid-fire-round)
15. [What the Interviewer Is Really Testing](#what-the-interviewer-is-really-testing)
16. [Red Flags That Sink Candidates](#red-flags-that-sink-candidates)
17. [Cheat Sheet](#cheat-sheet)
18. [Related Topics](#related-topics)

---

## Introduction

Dependency management is a staple of platform, build, release-engineering, and senior backend interviews because almost every production incident has a dependency in its causal chain — a range that drifted, a transitive package that got compromised, a diamond that wouldn't resolve. A candidate's answers reveal whether they understand the *machinery* (semver, resolution, lock files, integrity) or have only ever pressed install and hoped.

The questions below are grouped by theme, each with a **model answer** (what a strong candidate says), a **"really testing"** note (the subtext the interviewer grades), and where useful **follow-ups** they drill into. Then a **scenarios** section, because senior interviews ask you to *resolve a conflict on a whiteboard* and *architect org-wide governance*, not recite range operators. Read the four tiers first — this page assumes their content and tests recall plus synthesis.

---

## How to Use This Page

- **Cover the model answer**, attempt the question aloud (interviews are verbal), then compare.
- Answer the **"really testing"** subtext, not just the literal question — the depth you reveal is the grade.
- For scenarios, **state assumptions, name trade-offs, and decide** — a defended decision beats a hedge.
- If you can explain *why* a resolution failure is a proof (not a flaky tool) and *why* two versions of one package is a type-identity bug, you are already ahead of most candidates.

---

## Section 1 — Semantic Versioning

**Q1.1 — What does each field of `2.31.4` promise, and who enforces the promise?**

*Model answer:* `MAJOR.MINOR.PATCH`. **PATCH** (`2.31.4 → 2.31.5`) = backward-compatible bug fixes only. **MINOR** (`2.31.4 → 2.32.0`) = backward-compatible new features; old code keeps working. **MAJOR** (`2.x → 3.0.0`) = breaking changes; you must read the changelog. The crucial nuance: semver is a *convention enforced by humans*, not a law enforced by the computer. A maintainer can tag a breaking change `2.4.1` and your `^`-range build will swallow it. So semver tells you the *intended* risk of an upgrade — enormously useful for planning — but you verify with tests and lock files, not faith.

*Really testing:* whether you treat semver as a guarantee (junior) or a forecast (senior). The "enforced by humans" line is the tell.

*Follow-up:* "What's special about `0.x.y`?" → Pre-1.0 means "unstable." During `0.x`, a *minor* bump (`0.3 → 0.4`) is allowed to break you, so treat every pre-1.0 bump like a major. npm's `^0.3.0` actually resolves to `>=0.3.0 <0.4.0` for exactly this reason.

---

**Q1.2 — A library you depend on releases `1.5.0`, which adds a function but also changes the default timeout from 30s to 5s, silently breaking you. Did they violate semver?**

*Model answer:* Yes. A behavioral change that breaks existing working code is a breaking change regardless of whether the *API surface* (signatures) changed. Semver's compatibility promise is about *observable behavior*, not just type signatures. This is the most common semver violation in practice — "we only changed a default" — and it's exactly why a `^1.0.0` range can break you on a "minor" bump. The defense isn't to distrust semver wholesale; it's lock files (so the bump is a reviewable diff, not a silent drift) plus a test suite that exercises the behavior you rely on.

*Really testing:* whether you understand semver covers *behavior*, not just API shape — and that this is why ranges are dangerous even when maintainers act in good faith.

---

## Section 2 — Version Ranges and Constraints

**Q2.1 — Explain `^1.2.3`, `~1.2.3`, `1.2.3`, and `>=1.2.3`. When would you choose each?**

*Model answer:*

```
^1.2.3   >=1.2.3 <2.0.0   "compatible — same MAJOR"   (most common app default)
~1.2.3   >=1.2.3 <1.3.0   "PATCH only"                (conservative)
1.2.3    exactly 1.2.3     "pinned"                    (when you must)
>=1.2.3  no upper bound    "anything newer"            (avoid — invites breakage)
```

- **`^`** is a direct bet on semver: "any minor/patch in this major is safe." Sensible default for *applications* that commit a lock file (the range is intent; the lock pins reality).
- **`~`** when you trust patches but not minors — tighter blast radius.
- **Exact pin** for a known-fragile dependency or a reproducibility requirement without a lock file.
- **`>=` / `*`** almost never: an open upper bound means "the next major that ships at 2 a.m. is now in my build." This is how the classic `requests>=2.0` prod break happens.

*Really testing:* whether you connect range choice to lock-file presence. The senior point: with a committed lock file, the *range* barely matters day-to-day — it only governs what `update` is *allowed* to pick. Without a lock file, the range *is* your reproducibility, and a wide range is a time bomb.

---

**Q2.2 — Library authors are often told "use wide ranges." Application authors are told "pin." Why the asymmetry?**

*Model answer:* A **library** is consumed *with other libraries*, and the resolver must find one version of each shared dependency that satisfies *everyone*. If a library pins `lodash@4.17.21` exactly, it conflicts with any sibling that pins a different exact version — the resolver has no room to maneuver. Wide ranges (`^4.17.0`) maximize the chance a single satisfying version exists. An **application** is the top of the tree; nobody resolves *against* it, so it should pin (via lock file) for reproducibility. The rule of thumb: **libraries declare the widest range they actually support; applications lock the exact resolved set.** A library that over-pins is a bad citizen of the dependency graph.

*Really testing:* the distinction between being a *node in someone's graph* (library) versus *owning the graph* (application) — a senior framing many candidates miss.

---

## Section 3 — Manifests and Lock Files

**Q3.1 — What's the difference between a manifest and a lock file, and why do you commit the lock file?**

*Model answer:* The **manifest** (`package.json`, `go.mod`, `Cargo.toml`) holds *intent* — the ranges you'll accept, what you edit by hand. The **lock file** (`package-lock.json`, `Cargo.lock`, `go.sum`) holds *resolved reality* — the exact version and an integrity hash for *every* package, direct and transitive, generated by the tool. You commit the lock file because it's what makes installs identical across machines: with `^4.18.0` in the manifest, two developers can resolve to different newest-4.x versions, but if the lock file is committed and they install *from* it, both get exactly `4.18.2`. Not committing it is the single most common cause of "works on my machine" in dependency-heavy projects.

*Really testing:* the intent-vs-reality model. The trap answer is "lock files are generated, so like other generated files they shouldn't be committed" — exactly wrong, and a senior calls it out.

*Follow-up:* "`npm install` vs `npm ci`?" → `install` may re-resolve ranges and *rewrite* the lock; `ci` installs *exactly* the locked versions and fails loudly if the lock is out of sync with the manifest. CI uses `ci` so the dependency set can't drift.

---

**Q3.2 — Go has `go.mod` and `go.sum`. Is `go.sum` a lock file?**

*Model answer:* Not in the npm sense. In Go, **`go.mod` already determines the selected versions** deterministically via MVS — version *selection* needs no lock file. `go.sum` is purely an **integrity** file: it records cryptographic hashes of the module content (and of each `go.mod`) so the toolchain can verify downloads match what was first seen. So `go.sum` answers "are these the right bytes?" not "which versions?" This is the deep contrast with npm/Cargo, where the lock file does *both* jobs — pin the selection *and* hold integrity hashes — because their resolution isn't deterministic from the manifest alone. Both `go.mod` and `go.sum` are committed.

*Really testing:* whether you understand that MVS makes selection deterministic, so Go *splits* the two responsibilities npm fuses into one file. This is a strong-candidate distinction.

---

**Q3.3 — What is an integrity hash in a lock file, and what attack does it stop?**

*Model answer:* It's a content fingerprint — npm's `integrity: "sha512-…"`, Go's `h1:` hashes, `Cargo.lock`'s `checksum` — computed over the package's bytes. On install the tool re-hashes the downloaded artifact and **refuses to proceed on mismatch**. It stops *post-publication tampering*: a compromised registry mirror, a corrupted cache, or a swapped tarball served at the same version number. What it does **not** prove is *who* produced the bytes — it's trust-on-first-use (TOFU): the first resolution has nothing to compare against. For authenticity you need a transparency log (Go's `sum.golang.org`, TUF) and signing/provenance (Sigstore, SLSA). The hash is rung one of an integrity ladder, not the whole ladder.

*Really testing:* whether you know a hash proves *integrity*, not *authenticity* — and can name the TOFU gap. Saying "the hash makes it secure" is a red flag.

---

## Section 4 — Resolution Algorithms

**Q4.1 — What is dependency resolution, computationally? Why can it be slow or even fail incorrectly?**

*Model answer:* Resolution reduces to **boolean satisfiability (SAT)**. Make a variable for "package P at version v is selected." Encode the rules as clauses: "if `A@1.5` is selected and needs `C ^3.0`, then at least one `C@3.x` is selected"; in single-version ecosystems, "at most one version of `C`"; and the root app's direct requirements as unit clauses. A satisfying assignment is a valid resolution; *no* satisfying assignment is the "no versions satisfy the constraints" error — a *proof*, not a guess. Because SAT is NP-complete, resolution is NP-hard in general. That's not academic: npm pre-v7 and old pip used greedy, incomplete strategies and had real cases of exponential blowup or *incorrect* resolutions (reporting failure when a solution existed, or picking an invalid set).

*Really testing:* whether you can name resolution as constraint satisfaction. The payoff line: a failure is a *theorem about your constraints*, so the fix is always to change a constraint, never to retry/clear-cache.

*Follow-up:* "What's PubGrub?" → A CDCL-flavored solver (Dart's `pub`, Rust's `uv`) whose signature feature is *explanatory failure*: instead of a stack trace it derives a minimal human-readable reason — "because A 1.0 needs B <2 and C 1.0 needs B >=2, and you need both, there's no solution." That explanation is the practical difference between a five-minute and a five-hour fix.

---

**Q4.2 — Your resolver reports "no compatible version found." A teammate says "clear the cache and retry." Are they right?**

*Model answer:* No — and this reveals a misunderstanding of what resolution *is*. An unsatisfiable result is a *proof*: given these constraints, no assignment of versions satisfies all of them. Retrying, clearing the cache, or reinstalling cannot change a logical impossibility. The only fix is to **change a constraint** — widen a range, upgrade or downgrade a direct dependency, or override a transitive pin. The right first move is to read the resolver's explanation (or run `npm ls <pkg>` / `go mod why <pkg>`) to find *which two constraints contradict*, then relax the cheaper one. Cache-clearing fixes *download* problems, never *satisfiability* problems.

*Really testing:* the SAT mental model applied under pressure. "Retry it" is a junior reflex; "it's a proof, find the contradiction" is senior.

---

## Section 5 — MVS vs Newest-Compatible

**Q5.1 — Contrast Go's Minimum Version Selection with npm/Cargo's newest-compatible resolution.**

*Model answer:* **Newest-compatible** (npm, Cargo, pip): within each range, pick the *highest* version available *at resolve time*. Because "highest available" depends on what the registry has *right now*, the result drifts over time — which is why these ecosystems *require* a lock file to recover determinism. **MVS** (Go): pick the *maximum of the required minimums* — the lowest version everyone in the graph agreed to. It's a pure function of the `require` graph, so it's deterministic *without* a lock file; `go.sum` adds integrity, not determinism.

The trade is sharp:
- Newest-compatible gives you *freshness* automatically but introduces *drift* (your build can change with no change to your code) — paid for with a mandatory lock file.
- MVS gives you *determinism by construction* and *high fidelity* (you build with the versions authors actually tested together) — paid for with *staleness* (it never freshens deps on its own).

*Really testing:* whether you can defend MVS as principled rather than "Go being lazy." The killer line: MVS removes the design flaw of "builds that change without a code change."

---

**Q5.2 — State Russ Cox's arguments for MVS and its one real cost.**

*Model answer:* (1) **High fidelity** — you build with the versions the author tested with (the agreed minimums), not whatever's newest at build time. (2) **Reproducible by construction** — selected versions are a deterministic function of the require graph; no "resolve against the live registry" step whose result depends on wall-clock time. (3) **No spooky action at a distance** — adding dependency X can never silently bump unrelated dependency Y, because nothing floats to "newest"; a bump only happens if something *requires* a higher minimum, and then it's forced, visible, and recorded in `go.mod`. (4) **Upgrades are an explicit verb** — `go get foo@latest` / `go get -u` are the *only* ways versions go up. The cost: **staleness** — MVS will happily build you with year-old deps that have since shipped fixes. Go's answer is tooling (`go list -m -u all`, `govulncheck`) plus the discipline of periodic explicit upgrades. Cox's bet: staleness is *visible and fixable on your schedule*, while drift is *invisible and strikes on the registry's schedule*.

```bash
go list -m all                  # exact MVS-selected versions
go list -m -u all               # ...annotated with available upgrades
go get -u ./... && go mod tidy  # opt into upgrading, deliberately
govulncheck ./...               # are any SELECTED versions known-vulnerable?
```

*Really testing:* depth of understanding of a deliberate design choice, and whether you can articulate the drift-vs-staleness trade as a values question.

---

## Section 6 — Diamonds and Version Conflicts

**Q6.1 — Explain the diamond dependency problem.**

*Model answer:* Your app depends on `A` and `B`; both depend on `C`, but at incompatible constraints — `A` needs `C ^1.0` (i.e. `<2.0`), `B` needs `C ^2.0` (i.e. `>=2.0`). The graph is a diamond (app → A → C, app → B → C), and there's *no single version of `C`* satisfying both `<2.0` and `>=2.0`.

```
        app
       /    \
      A      B
   C^1.0    C^2.0
       \    /
         C        ← no single version satisfies both → conflict
```

What happens next depends on the ecosystem's *one-version-or-many* policy. A single-version ecosystem (Go, Maven) reports a hard conflict — you must reconcile. A multi-version ecosystem (npm) sidesteps it by installing *both* `C@1` and `C@2` nested under `A` and `B` respectively — which "works" but introduces the type-identity hazards (next section).

*Really testing:* whether you can draw the diamond, name *why* it's unsolvable (contradictory constraints), and know that the *resolution strategy* is ecosystem policy, not physics.

---

**Q6.2 — How do you actually *resolve* a real diamond in a single-version ecosystem?**

*Model answer:* In priority order: (1) **Find a `C` that satisfies both** — often `A`'s `^1.0` is just stale and a newer `A` already moved to `C ^2.0`; upgrading `A` collapses the diamond. Run `go mod why C` / `npm ls C` to see who demands what. (2) **Upgrade or downgrade a direct dependency** so its constraint shifts — e.g. take a newer `A` whose constraint overlaps `B`'s. (3) **Override** as a last resort: Cargo's `[patch]`, Go's `replace` directive, npm's `overrides`/`resolutions` force a single `C` and accept the risk that the loser was relying on removed behavior — then test hard. (4) If genuinely irreconcilable and both are essential, you're choosing between *forking/patching* a dependency or *opting into multiple versions* (shading in Java, accepting nesting in npm) with eyes open to the identity hazards. The first move is always *diagnosis* — which two constraints contradict and is one of them obsolete.

*Really testing:* a methodical, escalating approach rather than "add an override" reflexively. Reaching for `resolutions` first, without diagnosis, is a red flag.

---

## Section 7 — One Version or Many

**Q7.1 — npm installs multiple versions of the same package; Go and Maven allow only one. Frame this as more than a convenience trade-off.**

*Model answer:* It's a **correctness decision about type identity**. In a single-version world, "the type `Config` from `foo`" is unambiguous — one `foo`, one `Config`. With multiple versions, `foo@1`'s `Config` and `foo@2`'s `Config` are **distinct runtime types that share a name**. Consequences:

```js
// libA built against left-pad@1 returns a v1 Token; your code uses v2:
const tok = libA.makeToken();
if (tok instanceof LeftPadV2.Token) { ... }  // FALSE — it's a V1 Token, branch silently skipped
```

- **Shared singletons break:** two versions = two global registries (logger, metrics, DI container); half the program registers with the wrong one.
- **`instanceof` / type assertions break** across the version boundary, silently, with no error.
- **Binary size and memory balloon** — every duplicate is duplicated code.

So npm's model *maximizes install success* at the cost of these hazards; Go/Maven's model accepts hard diamond conflicts to *preserve one-name-one-type*. Go even uses **semantic import versioning** — `example.com/foo` vs `example.com/foo/v2` are different *import paths* — so incompatible majors are *visibly different identities in source* rather than silently-different identities at runtime.

*Really testing:* the leap from "bloat vs conflict frequency" to "type identity." This is the single best discriminator in the whole topic.

*Follow-up:* "How does Java escape one-version?" → Classloader isolation (OSGi) or **shading/relocation** (rewriting a dependency's package names into your namespace at build time) — an explicit opt-in to multiple versions when you truly must, since Maven's default is one-version-via-nearest-wins.

---

## Section 8 — Supply-Chain Integrity

**Q8.1 — Walk the integrity ladder from a lock-file hash to full provenance.**

*Model answer:* Three rungs, each defending a different layer:

1. **Content hashing** (`go.sum` `h1:`, npm `integrity`, `Cargo.lock` checksum): "same bytes as I locked." Stops *post-publication tampering* — swapped tarball, compromised mirror. Limitation: TOFU; proves nothing about *who* made the bytes.
2. **Transparency log** (Go's `sum.golang.org`, TUF on PyPI): a Merkle-tree append-only log (like Certificate Transparency). The first time *anyone* resolves a version, its hash is recorded immutably and publicly, so a malicious server can't serve *you* different bytes than everyone else without public detection. Closes the TOFU gap at ecosystem scale: "same bytes as everyone gets."
3. **Signing + provenance** (Sigstore — cosign/Fulcio/Rekor — plus SLSA): signatures prove *origin*, provenance proves *how/where built*. "This package was built by *this* GitHub Actions workflow in *this* repo," not merely "matches what I downloaded before."

```bash
go env GOSUMDB                       # sum.golang.org by default
go mod verify                        # all modules match go.sum
cosign verify-blob --certificate ... artifact.tgz   # Sigstore signature
```

*Really testing:* that "integrity" isn't one thing. Hash = tampering; log = targeted substitution; signing/provenance = malicious-but-valid publication. Naming all three rungs signals real supply-chain depth.

---

**Q8.2 — Explain dependency confusion and typosquatting. How do you defend against each?**

*Model answer:* **Typosquatting** = publishing a malicious package with a name a hairsbreadth from a popular one — `reqeusts` for `requests`, `electorn` for `electron` — betting on a fat-fingered install. Defense: lock files (you install named, pinned packages, not free-typed ones), allowlists, and registry-side name-similarity detection. **Dependency confusion** = exploiting resolvers that check *both* a private registry and a public one: an attacker publishes a package to the *public* registry using your *internal* package name (`@acme/billing-core`) at a higher version, and a misconfigured resolver pulls the public (malicious) one because it's "newer" or because the public registry is searched. Defense: **scope/namespace your internal packages and bind them to the private registry** (npm scoped registries, Go's `GOPRIVATE`, Maven repository routing), so internal names *never* resolve against the public index — and pin a single source of truth per package. This was the 2021 attack that hit Apple, Microsoft, and others via researcher Alex Birsan.

*Really testing:* whether you know the *mechanism* of confusion (dual-registry resolution by version/precedence) and the *structural* fix (namespace binding), not just "scan for bad packages."

---

**Q8.3 — Someone disables Go's checksum DB (`GONOSUMCHECK` / `GOFLAGS=-insecure`) "to make a private module work." What's wrong, and what's the right fix?**

*Model answer:* Disabling the checksum database drops you to TOFU — you lose the transparency-log defense (rung 2) for *every* module, not just the private one, so a targeted-substitution attack on any public dependency goes undetected. The actual problem is that `sum.golang.org` can't see private modules, and the client tries to verify them against it and fails. The correct fix is **`GOPRIVATE=*.corp.example.com`** (or `GONOSUMDB`/`GONOSUMCHECK` scoped to *just* the private prefix), which exempts the private modules from the public checksum DB while keeping verification on for everything public. Turning it off globally to dodge a config issue is the kind of "fix" that silently widens the attack surface.

*Really testing:* whether you reach for a *scoped* exemption rather than a global off-switch — judgment that separates security-aware engineers from "make the error go away."

---

## Section 9 — Vendoring

**Q9.1 — What is vendoring, and when is it the right call?**

*Model answer:* Vendoring commits your dependencies' *source* into your own repo (Go's `vendor/`, checked-in `node_modules`, Bazel vendored externals). `go mod vendor` copies all deps in; `go build -mod=vendor` builds *only* from `vendor/`, ignoring the network and module cache. The case *for*: **hermeticity and availability** (no network, immune to a yanked package or a dead upstream — think left-pad), **auditability** (dependency changes show up as ordinary code diffs in review), and **tamper-evidence** (you build the bytes in your repo). The case *against at scale*: **repo bloat** (tens of thousands of files in every clone/CI checkout), **review noise** (a single upgrade can be a 40,000-line diff nobody actually reads — so the auditability benefit becomes theatre), and **merge churn** in `vendor/`. So vendoring is genuinely right for **air-gapped builds, regulated environments demanding in-repo provenance, and small dependency sets where the diff is actually reviewable**. At scale the modern replacement is **lock file + integrity hashes + a private verified mirror** (or a content-addressed store via Bazel/Nix), which buys availability and integrity without the source-in-repo cost.

*Really testing:* whether you can argue *both sides* and recognize that "auditability" only holds when diffs are small enough to read. "Always vendor for security" or "never vendor" both flunk.

---

## Section 10 — Org Governance and Automated Updates

**Q10.1 — What do Renovate and Dependabot do, and what problem do they solve?**

*Model answer:* They automate dependency updates: watch your manifests/lock files, detect when a newer in-range (or out-of-range, configurable) version exists, and open a PR that bumps it — running your CI as the gate. The problem they solve is **staleness rot**: without automation, deps drift years out of date, and then a forced security upgrade is a giant, risky, multi-major leap instead of a stream of small reviewed steps. They turn "upgrade" from a scary annual event into routine, test-gated, incremental PRs. Renovate is more configurable (grouping, scheduling, monorepo-aware, auto-merge policies); Dependabot is GitHub-native and simpler. The senior nuance: **automation without a policy is noise** — you need grouping (batch patch bumps), auto-merge rules (auto-merge dev-dependency patches that pass CI; require human review for majors), and scheduling, or the team drowns in PRs and starts rubber-stamping them, which is *worse* than manual because it launders unreviewed changes.

*Really testing:* whether you see that the tool is easy but the *policy* is the hard part — and that unconfigured automation creates rubber-stamp risk.

---

**Q10.2 — How do you decide an organization's update *policy* — what auto-merges, what needs review?**

*Model answer:* Tier by *risk and blast radius*. **Auto-merge on green CI:** patch and minor bumps of *dev/build* dependencies, and patch bumps of well-behaved runtime deps with strong test coverage. **Require human review:** every **major** bump (breaking by definition), any change to a security-sensitive dependency (auth, crypto, serialization), and anything that touches the lock file's *transitive* security posture. **Block / escalate:** dependencies flagged by a vulnerability scanner or that fail license policy. Layer in **grouping** (one PR for all patch bumps weekly) to fight PR fatigue, and **scheduling** (off-hours, not Friday) so a bad auto-merge doesn't page someone over the weekend. The governing principle: automate the boring, high-volume, low-risk majority so humans have attention left for the few changes that actually need judgment.

*Really testing:* risk-tiering and PR-fatigue awareness — that you'd design a policy, not just toggle "auto-merge on."

---

## Section 11 — Design and Debugging Scenarios

**S1 — Two transitive deps need incompatible versions of `X`. Walk me through resolving it.**

*Strong answer structure:*

1. **Diagnose first.** `npm ls X` / `go mod why X` / `cargo tree -i X` to see the *exact* paths and the *exact* constraints each demands. Name the contradiction out loud: "`A@1.2` requires `X <2`; `B@3.0` requires `X >=2`."
2. **Check for an obsolete constraint.** Most real diamonds dissolve here: is there a newer `A` that already moved to `X >=2`? `npm outdated A` / `go list -m -u A`. If so, **upgrade the lagging direct dependency** — the cleanest fix, no overrides.
3. **Try to find a satisfying `X`.** Sometimes the ranges *do* overlap and the resolver just needs the lock refreshed (`npm install`, `go get X@<version>`).
4. **Override deliberately** if no overlap exists and one side's constraint is merely over-cautious: `overrides`/`resolutions` (npm), `[patch]` (Cargo), `replace` (Go) to force one `X` — then **test the loser's code paths hard**, because you've overruled its stated requirement.
5. **Escalate honestly** if both genuinely need different majors and both code paths run: either *fork/patch* one dependency, or *opt into multiple versions* (npm nesting, Java shading) accepting the type-identity hazards (singletons, `instanceof`).

*Trade-off to name aloud:* every step trades effort for safety. Upgrading `A` is safest but may not exist; an override is fast but silently overrules a stated requirement and needs test coverage to be safe. I'd always exhaust diagnosis and upgrade before reaching for an override.

---

**S2 — Design dependency governance for a 2,000-repo organization.**

*Strong answer:*

1. **Single source of truth for packages.** A **private registry/proxy** (Artifactory, Nexus, GitHub Packages) that mirrors public registries and hosts internal packages. All builds resolve through it — never directly against public registries — which kills dependency confusion (namespace + bind internal scopes to the private registry) and gives availability (immune to upstream outages/yanks).
2. **Integrity enforced everywhere.** Lock files committed and `--frozen`/`ci`-style installs in CI; verify checksums; for Go keep `GOPRIVATE` scoped and the checksum DB on for public modules; sign internal artifacts (Sigstore) and emit SLSA provenance.
3. **Automated, policy-driven updates** via Renovate org-wide: grouped patch bumps auto-merged on green CI, majors and security-sensitive deps gated to human review, scheduled off-hours. This keeps 2,000 repos from rotting into giant forced upgrades.
4. **Continuous vulnerability + license scanning** (Dependabot alerts / Snyk / `govulncheck` / OSV) feeding a central dashboard, with SLAs for critical CVEs.
5. **An SBOM per artifact** so you can answer "which of our 2,000 services ship the package that just got a critical CVE?" in minutes, not days (the Log4Shell test).
6. **Curation for the highest-risk deps:** an allowlist/curated set for foundational libraries (the crypto, serialization, framework layer), reviewed by a platform team.

*Trade-off to name aloud:* centralization (private registry, curated set, single-version pressure) buys security and a fast CVE-response but adds friction and a platform team to run it. For 2,000 repos that friction is worth it — the alternative is invisible drift across thousands of independent dependency graphs, which is unbounded and explodes on the day a critical CVE lands. I'd accept the central machinery as the price of being able to *answer questions about the whole fleet*.

---

**S3 — A one-line code change makes CI fail on an unrelated test. Walk through diagnosis.**

*Strong answer:* My first hypothesis is **dependency drift, not my code**. Check: does the project commit a lock file, and does CI use `npm ci` / frozen install, or plain `npm install`? If CI re-resolves ranges, a newer transitive dependency with a behavior change got pulled between the last green run and now — same source, different deps. Confirm by diffing the resolved versions (`npm ls`, or compare lock files between the green build and this one; for Go, `go list -m all`). The *structural* fix is to commit the lock file and switch CI to frozen installs so the dependency set is pinned. The *immediate* fix is to identify the drifted package, pin it, and file the upstream issue. The tell that it's drift and not me: my change is one line and unrelated to the failing test, yet the test regressed.

*Really testing:* whether your *first instinct* on an inexplicable CI failure includes "the dependencies moved," and whether you know the fix is committing the lock + frozen installs.

---

**S4 — Your monorepo team proposes a single-version policy. Defend or critique it.**

*Strong answer:* It's the diamond problem applied to an organization. In a polyrepo world, team A pins `grpc@1.40`, team B pins `grpc@1.55`; invisible until a shared library must link both, then unsolvable. A **single-version policy** (one version of each third-party dep, repo-wide) makes that divergence *impossible by construction*. The trade, stated honestly: upgrades become **atomic and global** — bumping `grpc` updates *every* consumer in one commit, gated on the whole repo's tests. That's enormous work, but it's done *once, correctly, visibly* rather than N teams discovering breakage on their own schedule. So I'd *support* it — but only with the prerequisites: a build system that understands the whole graph (Bazel) and large-scale-change tooling (Google's `Rosie`-style sweeps). Without that machinery, mandating one version just moves the pain to whoever wants to upgrade, with no tooling to land the sweep. The principle is the same as MVS and one-global-version: prefer the conflict you can *see and schedule* over the one that *ambushes you*.

*Really testing:* whether you can articulate the invisible-distributed-drift vs visible-scheduled-cost trade, and name the tooling prerequisites rather than treating it as a pure policy decision.

---

## Rapid-Fire Round

- *In `2.31.4`, which number bumps for a bug fix?* → PATCH (`→ 2.31.5`).
- *What does `^1.2.3` forbid?* → `2.0.0` and up (the next major), and anything below `1.2.3`.
- *Which file do you commit — manifest, lock, or both?* → Both.
- *`npm install` or `npm ci` in CI?* → `ci` — exact from lock, fails on drift.
- *Is `go.sum` a version lock?* → No — it's integrity hashes; `go.mod` + MVS already fix the versions.
- *What does an integrity hash prove?* → Same bytes as locked (tampering). NOT who made them (TOFU).
- *Resolution is equivalent to which classic problem?* → Boolean satisfiability (SAT).
- *Right response to "no compatible version found"?* → Change a constraint — it's a proof, never retry.
- *What does MVS select?* → The maximum of the required minimums.
- *MVS's one cost?* → Staleness — it never freshens deps on its own.
- *Two versions of one package break which JS operator?* → `instanceof` (distinct runtime types).
- *Go's trick to make incompatible majors visibly distinct?* → Semantic import versioning (`foo` vs `foo/v2`).
- *Structural fix for dependency confusion?* → Namespace internal packages, bind them to the private registry.
- *`reqeusts` instead of `requests` is which attack?* → Typosquatting.
- *One reason to vendor?* → Air-gapped / network-independent builds (or small, reviewable dep sets).
- *Tool that opens automated dependency-bump PRs?* → Renovate / Dependabot.
- *What answers "which services ship this CVE'd package?" fast?* → An SBOM per artifact.

---

## What the Interviewer Is Really Testing

- **Intent vs reality.** Do you separate the *manifest* (ranges, intent) from the *lock file* (resolved reality)? Most dependency confusion — and most weak answers — collapse the two.
- **Resolution as logic, not magic.** Can you name resolution as SAT and treat a failure as a *proof* to act on, not a flaky tool to retry? This is the spine of senior dependency reasoning.
- **The type-identity insight.** Do you understand that "two versions of one package" is a *correctness* bug (singletons, `instanceof`), not just bloat? The single best discriminator in the topic.
- **Integrity is a ladder.** Hash (tampering) → transparency log (targeted substitution) → signing/provenance (malicious publication). Knowing which rung you're on signals real supply-chain experience.
- **Governance is policy, not tooling.** Can you design risk-tiered auto-merge and a fleet-wide CVE-answering capability (SBOMs, private registry), rather than just toggling Dependabot on?
- **Trade-offs spoken aloud.** Drift vs staleness, vendoring's bloat vs availability, single-version's coordination cost vs invisible drift — naming both sides and *deciding* is the leap from engineer to platform engineer.

---

## Red Flags That Sink Candidates

1. **"Lock files are generated, so don't commit them."** Exactly backward — and the #1 cause of "works on my machine."
2. **"Retry the resolution / clear the cache."** Reveals no model of resolution as satisfiability; an unsatisfiable result is a proof.
3. **Treating semver as a guarantee.** No awareness that it's a human convention, broken in practice — they'll trust a `^` range blindly into a prod break.
4. **"The integrity hash makes it secure."** Conflates integrity with authenticity; misses TOFU, transparency logs, and provenance entirely.
5. **Reaching for `overrides`/`resolutions` first.** Forcing a version without diagnosing the contradiction — papers over a conflict and risks the overruled dependency.
6. **"Two versions, npm handles it, no problem."** Ignores the type-identity hazards (silent `instanceof` failures, duplicated singletons).
7. **Disabling checksum verification globally to fix one private module.** Widens the attack surface to dodge a config issue; the fix is a *scoped* `GOPRIVATE`.
8. **Automated updates with no policy.** Auto-merging everything (rubber-stamp risk) or auto-merging nothing (staleness rot) — both miss that the policy is the hard part.

---

## Cheat Sheet

```
SEMVER  MAJOR.MINOR.PATCH (2.31.4)
  patch=fix(safe) minor=feature(compat) major=breaking(read changelog)
  0.x = unstable, any bump may break ; it's a HUMAN convention, not enforced
  breaking = behavior change too, not just signatures

RANGES (npm-style)
  ^1.2.3  >=1.2.3 <2.0.0  same MAJOR (app default w/ lock)
  ~1.2.3  >=1.2.3 <1.3.0  PATCH only
  1.2.3   exact pin ;  >=1.2.3 / *  = AVOID (open upper bound)
  libraries: WIDE ranges (be a good graph citizen) ; apps: LOCK the resolved set

MANIFEST vs LOCK
  manifest = INTENT (ranges, you edit) ; lock = REALITY (exact + integrity hash)
  COMMIT THE LOCK. npm ci (not install) in CI — exact, fail on drift.
  Go splits it: go.mod = versions (MVS, deterministic) ; go.sum = integrity ONLY

RESOLUTION = SAT
  unsatisfiable = PROOF of conflict → change a constraint, NEVER retry/clear-cache
  greedy resolvers (old npm/pip) could blow up or resolve WRONG
  PubGrub (uv/pub) = CDCL + minimal human-readable failure explanation

MVS (Go) vs NEWEST-COMPATIBLE (npm/cargo)
  MVS picks max(required minimums) — deterministic w/o lock, high fidelity
    + no spooky bumps, explicit upgrades (go get) ; − STALENESS
  newest-compat picks highest-in-range — fresh but DRIFTS → needs a lock file

ONE VERSION vs MANY = a TYPE-IDENTITY decision
  many (npm) → install always succeeds ; instanceof/singletons/size HAZARDS
  one (Go/Maven) → coherent identity ; diamond can HARD-FAIL
  Go semantic import versioning: foo vs foo/v2 = different import paths

DIAMOND: A→C^1, B→C^2, no single C → diagnose (npm ls / go mod why),
  upgrade lagging dep > find overlap > override (last) > fork/multi-version

INTEGRITY LADDER
  1 hash (go.sum/integrity)      "same bytes as I locked"  (TOFU)
  2 transparency log (sum.golang.org/TUF) "same bytes as EVERYONE"
  3 signing+provenance (Sigstore/SLSA)    "built by whom, from what"
  confusion → namespace + private-registry bind ; typosquat → lock + allowlist

GOVERNANCE (org)
  private registry/proxy (one source of truth) ; lock+frozen installs everywhere
  Renovate/Dependabot w/ POLICY: auto-merge patch on green, gate majors+security
  scan CVE+license ; SBOM per artifact (answer "who ships this CVE?")
  monorepo single-version: no diamonds, atomic global upgrades (needs Bazel+LSC tooling)
```

---

## Related Topics

- [junior.md](junior.md) — dependencies, semver, ranges, transitive trees, the lock file.
- [middle.md](middle.md) — resolution mechanics, the diamond, lock-file anatomy, MVS vs newest-compatible.
- [senior.md](senior.md) — resolution as SAT, type-identity, MVS defended, the integrity ladder, vendoring, single-version policy.
- [professional.md](professional.md) — org governance, automated update pipelines, confusion/typosquatting war stories, private registries.
- [04 — Per-Language Tools](../04-per-language-tools/middle.md) — how `go`, `npm`, and `cargo` implement resolution and integrity.
- [09 — Reproducible Builds › senior](../09-reproducible-builds/senior.md) — locked, hashed deps as a precondition for bit-identical builds.
- [Release Engineering › Supply-Chain Security](../../release-engineering/09-supply-chain-security/) — SBOMs, SLSA, signing, and provenance in depth.
- [Build Systems](../../README.md) — the wider quality-engineering context.
