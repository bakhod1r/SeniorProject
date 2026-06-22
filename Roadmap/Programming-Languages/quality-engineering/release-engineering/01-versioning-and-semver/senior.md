# Versioning & SemVer — Senior Level

> **Roadmap:** [Release Engineering](../README.md) → Versioning & SemVer
> *Versioning under real constraints: diamond dependencies, the social-contract failure modes of SemVer, the API surface as the true unit of versioning, and deriving bumps from machine-checked diffs.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The API Surface Is the Unit of Versioning](#core-concept-1--the-api-surface-is-the-unit-of-versioning)
5. [Core Concept 2 — Diamond Dependencies and Conflict Resolution](#core-concept-2--diamond-dependencies-and-conflict-resolution)
6. [Core Concept 3 — Resolution Algorithms: SAT vs MVS](#core-concept-3--resolution-algorithms-sat-vs-mvs)
7. [Core Concept 4 — SemVer's Social-Contract Failure Modes](#core-concept-4--semvers-social-contract-failure-modes)
8. [Core Concept 5 — Automated SemVer Derivation from API Diffs](#core-concept-5--automated-semver-derivation-from-api-diffs)
9. [Core Concept 6 — Versioning the Wire: Schemas, Protos, Events](#core-concept-6--versioning-the-wire-schemas-protos-events)
10. [Core Concept 7 — Monorepo Versioning Strategies](#core-concept-7--monorepo-versioning-strategies)
11. [Core Concept 8 — Versioning and Deprecation Windows](#core-concept-8--versioning-and-deprecation-windows)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

## Introduction

> Focus: **the judgment calls and systemic effects of versioning at scale — where SemVer is a social contract that humans break, and what engineering you put in place so the number stays trustworthy.**

SemVer is trivial to state and brutal to operate. The spec is a page; the failures are subtle. A senior engineer's job is not to recite the rules but to (1) define what "the API" even *is* so bumps are decidable, (2) understand how resolvers turn version constraints into a build, and where they explode (diamond conflicts), (3) recognize that SemVer is enforced by humans who misjudge "breaking," and put automation in the path that catches it, and (4) extend versioning discipline beyond library code to schemas, protos, and events. This page is about reasoning, not syntax.

## Prerequisites

**Required**
- Middle tier of this topic (precedence, breaking-change taxonomy, ecosystem constraints, MVS).
- You have shipped breaking changes to real consumers and managed the fallout.
- Familiarity with at least one wire format (Protobuf, Avro, JSON Schema, OpenAPI).

**Helpful**
- Experience operating a monorepo or a large multi-repo dependency graph.
- Having debugged a dependency-resolution failure ("could not find a compatible set of versions").

## Glossary

| Term | Plain-English meaning |
| --- | --- |
| API surface | The complete set of observable behaviors consumers can depend on. |
| Diamond dependency | A→B and A→C where both B and C depend on different versions of D. |
| SAT solver | A constraint solver (used by npm, Cargo, pip) that searches for a satisfying version set. |
| MVS | Minimal Version Selection — Go's deterministic "max of minimums" algorithm. |
| Hyrum's Law | With enough users, every observable behavior of your system is depended on. |
| API diff | A machine-computed comparison of two API surfaces, classifying changes as breaking/feature/fix. |
| Wire compatibility | Whether old and new serialized data can be read by old and new code. |
| Deprecation window | The committed period between marking something deprecated and removing it. |
| Lockstep / fixed versioning | All packages in a repo share one version number. |
| Independent versioning | Each package in a repo versions on its own cadence. |

## Core Concept 1 — The API Surface Is the Unit of Versioning

You cannot decide a bump until you have defined *what you are versioning*. The naive answer — "the exported functions" — is wrong, because consumers depend on far more. The real API surface includes:

- Signatures, types, and exported constants.
- Default values and the *observable behavior* of every code path.
- Error types, error messages, and exit codes (when documented or relied upon).
- Serialization formats and field ordering where they leak.
- Side effects: files written, env vars read, ports opened, logs emitted with stable formats.
- Performance characteristics, once they become a documented guarantee.

**Hyrum's Law** is the governing reality: *with a sufficient number of users, it does not matter what you promise in the contract; all observable behaviors of your system will be depended on by somebody.* This means "breaking" is partly empirical, not purely definitional. A senior engineer narrows the surface deliberately:

```go
// Shrink the surface so versioning decisions stay decidable.
package widget

// Exported, documented → part of the contract. Changing this is breaking.
func New(opts Options) *Widget { ... }

// internal/ — the compiler forbids external import → NOT part of the contract.
// You may change this freely without a MAJOR bump.
```

The discipline: **make the surface as small and explicit as the language allows** (`internal/` in Go, `__all__`/underscore prefixes in Python, `pub(crate)` in Rust, module exports in JS, JPMS `exports` in Java). The smaller the surface, the cheaper SemVer compliance becomes.

## Core Concept 2 — Diamond Dependencies and Conflict Resolution

The diamond is the canonical hard case:

```
        app
       /    \
   lib-B    lib-C
       \    /
       lib-D
   B needs D ^1.2     C needs D ^2.0
```

`D 1.x` and `D 2.x` are by definition incompatible. How the build resolves this depends entirely on the ecosystem:

- **npm / Node:** *allows both.* `node_modules` nests, so B gets `D@1.x` and C gets `D@2.x`, each in its own subtree. This works for leaf libraries but breaks for singletons (a logger, a global registry, React context) — two copies of React in one tree is a notorious bug.
- **Go / MVS:** *does not allow both for the same major.* But because Go puts the major in the import path (`d/v2`), `D v1` and `D v2` are literally different modules and coexist cleanly. Within a single major, MVS picks one version for everyone.
- **Cargo:** allows multiple *major* versions to coexist (like Go), but unifies within a major.
- **Maven:** "nearest wins" by default — a fragile heuristic that silently picks one and can yield runtime `NoSuchMethodError`. Teams override with `<dependencyManagement>`.
- **pip:** historically allowed only *one* version of any package, period, producing hard conflicts; the modern resolver errors instead of silently breaking.

The senior takeaways:

1. **Singletons are the enemy of diamond tolerance.** Anything that must be a single instance (a global allocator, a context provider, a metrics registry) cannot rely on `node_modules`-style duplication. Mark such packages as peer dependencies.
2. **Putting the major in the type identity** (Go's `/v2`, Rust's per-major) is what makes coexistence safe — the type systems treat `v1.Thing` and `v2.Thing` as distinct.
3. **Conflicts are a constraint-tightening problem.** The fix is usually to relax a too-strict upper bound or to upgrade the lagging consumer, not to fight the resolver.

## Core Concept 3 — Resolution Algorithms: SAT vs MVS

Two philosophies, with opposite failure modes.

**SAT-style resolution (npm, Cargo, pip, Bundler).** Treat constraints as a boolean-satisfiability problem and search for *some* assignment of versions that satisfies all ranges, usually preferring the newest. This is flexible but:

- Resolution is **non-deterministic over time** — re-running tomorrow can pick newer versions, which is why lockfiles exist.
- It can be **NP-hard** in pathological graphs; resolvers ship timeouts and heuristics.
- It enables "automatically get the latest compatible," which is convenient and dangerous.

**Minimal Version Selection (Go).** For each module, take the **maximum of the minimum versions** anyone requested. No ranges, no search, no SAT.

```
A requires D v1.2.0
B requires D v1.4.0
C requires D v1.3.0
→ MVS selects D v1.4.0   (deterministic, no network "latest" lookup needed)
```

Properties: **reproducible by construction** (the build today equals the build next year given the same `go.mod`), **high-fidelity** (you get the lowest version that satisfies everyone, so upgrades are intentional), and **fast** (no solver). The cost is ergonomic: you bump minimums by hand, and you never "float" to the latest.

The senior judgment: **prefer determinism for anything you ship.** Whatever the ecosystem, commit a lockfile and treat un-pinned floating ranges as a CI/CD anti-pattern. MVS is what floating-range ecosystems approximate with lockfiles.

## Core Concept 4 — SemVer's Social-Contract Failure Modes

SemVer is not enforced by the compiler. It is a promise a human makes, and humans get it wrong in structured ways:

1. **The "patch" that breaks someone (under-classification).** The author believes a change is a bug fix; a consumer was depending on the buggy behavior (Hyrum's Law). The classic: tightening input validation, or "fixing" a sort to be stable. The author ships `1.4.3`; downstream `^1.4.0` auto-upgrades and breaks.
2. **The over-cautious MAJOR (over-classification).** Fear of breaking leads to MAJOR bumps for trivial internal changes, exhausting consumers' upgrade budget and training them to ignore MAJOR bumps — which then masks a *real* break.
3. **The bundled MAJOR.** Hoarding breaking changes into one giant `2.0.0` so the migration is enormous and nobody upgrades. Frequent small majors are kinder than rare huge ones.
4. **The dependency-leak break.** You bump a transitive dependency's major; even with no change to *your* code, a consumer's pinned constraint on that transitive dep now conflicts. The break is real but invisible in your diff.
5. **The behavioral break with no signature change.** Changing a default timeout, a retry count, or a rounding mode — signatures identical, behavior different. Static API diffs miss these entirely.

Mitigations a senior puts in place:

- **A documented breaking-change policy** so "is this breaking?" is decided by a rule, not a mood.
- **API-diff tooling in CI** (next section) to catch under-classification of *structural* breaks.
- **Contract tests / golden tests** to catch *behavioral* breaks that diffs miss.
- **A canary/soak step** so a mis-classified patch is caught in staging before it floats to everyone — see [Feature Flags & Progressive Delivery](../06-feature-flags-and-progressive-delivery/).

## Core Concept 5 — Automated SemVer Derivation from API Diffs

The reliable way to classify a structural change is to compute it from the code, not ask a human. Mature ecosystems have tools that diff the public API of two revisions and emit the *minimum required bump*.

```bash
# Go — apidiff / gorelease compares the module's exported API across two versions
gorelease -base v1.4.2
#   Inferred base version: v1.4.2
#   Suggested version: v1.5.0   (compatible changes found)

# Rust — cargo-semver-checks lints the public API against the published version
cargo semver-checks check-release
#   --- failure enum_variant_added: pub enum Color gained a variant ---
#   Required bump: minor

# Java — japicmp / revapi compare two JARs and classify each change
japicmp --old old.jar --new new.jar
#   *** MODIFIED METHOD ... → BINARY_INCOMPATIBLE  (requires MAJOR)

# JS/TS — api-extractor produces an API report; CI fails if it changed unexpectedly
```

The pattern to build into a release pipeline:

1. Compute the API diff between `HEAD` and the last released tag.
2. Derive the *minimum* bump the diff requires.
3. Compare it to the bump the author *declared* (via Conventional Commits, a label, or a changelog entry).
4. **Fail the build if the declared bump is smaller than the derived one.** (Declaring a larger bump is allowed — humans know about behavioral breaks the diff cannot see.)

This converts SemVer from an honor system into a checked invariant for the structural cases, while leaving room for human judgment on behavioral ones. It is the single highest-leverage investment in version trustworthiness.

## Core Concept 6 — Versioning the Wire: Schemas, Protos, Events

For services, the contract is rarely code — it is the **wire format**. The same SemVer thinking applies, but the breaking-change rules are format-specific and stricter, because old and new data coexist in flight.

**Protobuf.** Designed for backward/forward compatibility *without* version bumps if you follow the rules:

```protobuf
message User {
  string id = 1;
  string name = 2;
  // Safe (non-breaking): add a NEW field with a NEW number.
  string email = 3;
  // BREAKING: changing a field's number, type, or reusing a retired number.
  // Removing a field? Reserve its number/name so it's never reused:
  reserved 4;
  reserved "legacy_token";
}
```

Field numbers are the real contract; field *names* matter for JSON mappings. Never reuse a number. Reserve removed ones.

**Avro / schema registries.** Compatibility is enforced *by the registry* at publish time (`BACKWARD`, `FORWARD`, `FULL`). The registry rejects a schema that would break consumers — versioning becomes a gate, not a convention.

**Events.** An event schema is a contract with every current *and historical* consumer, because events may be replayed from a log. Treat additive-only as the default and use an explicit `schema_version` field or a new topic for breaking changes.

The senior principle: **version the contract, version it explicitly, and prefer additive evolution so you rarely need a breaking bump at all.** A breaking wire change usually means running both versions in parallel during migration (see [Rollback & Roll-Forward](../07-rollback-and-roll-forward/)). The `api-versioning` skill covers the request/response side of this in depth.

## Core Concept 7 — Monorepo Versioning Strategies

A monorepo forces a choice with large blast radius.

**Fixed / lockstep versioning.** Every package shares one version. Bump one, bump all.

- *Pros:* trivial mental model; one number describes "the state of the world"; cross-package compatibility is guaranteed (everything at `4.7.0` works together).
- *Cons:* a tiny fix to one package ships a MAJOR for fifty others if any of them broke; changelogs become noisy; consumers see churn unrelated to their package.
- *Used by:* Angular, Babel (historically), many internal platforms.

**Independent versioning.** Each package versions on its own cadence; tooling (Changesets, Nx, Lerna, Bazel + release rules) computes per-package bumps from what actually changed.

- *Pros:* honest version numbers; consumers only see relevant changes; matches the real shape of changes.
- *Cons:* you must track and publish the cross-package compatibility matrix; "which versions work together" is no longer obvious.

```bash
# Changesets (JS monorepo) — author records intent per change:
npx changeset
#   Which packages changed? @acme/ui (minor), @acme/utils (patch)
# CI later consumes accumulated changesets to compute versions + changelogs.
```

The decision hinges on **coupling**: tightly-coupled packages released together favor lockstep; loosely-coupled, independently-consumed packages favor independent. Most large orgs converge on independent versioning with strong tooling, because lockstep's MAJOR-amplification becomes intolerable past a few dozen packages.

## Core Concept 8 — Versioning and Deprecation Windows

Versioning and deprecation are two halves of one policy. A MAJOR bump is the *removal* event; deprecation is the *warning* that must precede it. The senior question is not "can I remove this?" but "have I given consumers a contracted runway?"

A coherent policy ties them together:

```
1. Mark deprecated in version N        (compiler/runtime warning, changelog, docs)
2. Keep it working for D releases/months (the deprecation window — a public commitment)
3. Remove only in the next MAJOR after the window expires
```

```go
// Deprecated: use NewClient instead. Removed in v3.0.0 (no earlier than 2025-06).
func Connect(addr string) *Client { return NewClient(Options{Addr: addr}) }
```

Key design rules:

- **Never remove and rename in the same release** without an overlap period where both work.
- **A MAJOR bump that removes things is the bill coming due** for deprecations announced earlier — it should contain no *surprises*, only previously-announced removals.
- **Tie the window length to your consumers' upgrade cadence**, not a round number. Enterprise consumers may need 12+ months; an internal service consumed by two teams may need two weeks.
- For platform APIs, publish the window in machine-readable form (`Deprecation` and `Sunset` HTTP headers) so consumers' tooling can alert them automatically.

## Real-World Examples

- **The "stable sort" patch heard round the world.** A library changed an unstable sort to a stable one in a patch release. Documented behavior was unchanged (still "sorted"), but downstream tests asserting exact tie-order broke. Textbook Hyrum's Law: the contract said "sorted," reality depended on the tie-breaking. The fix was a contract test downstream, plus a clearer policy upstream.
- **Go's `/v2` saving a migration.** A widely-used library shipped a breaking `v2`. Because the import path became `.../v2`, consumers migrated *file by file* — `v1` and `v2` coexisted in the same build during the transition. No flag day, no diamond conflict.
- **Schema registry as the real gate.** A streaming platform set Avro compatibility to `FULL`. A producer team tried to ship a schema that removed a field; the registry rejected the publish at CI time. The "version bump" decision was enforced by infrastructure, not left to a human's judgment in a PR.

## Mental Models

- **The version number is a checksum of compatibility, computed by a fallible human.** Your job is to make as much of that computation machine-checked as possible.
- **Shrink the surface to shrink the problem.** Every symbol you hide is a SemVer decision you never have to make.
- **Determinism over freshness for anything you ship.** Lockfiles and MVS both encode the same value: the build you tested is the build that ships.
- **A breaking change is a migration, not a number.** The bump is the easy part; the runway, tooling, and overlap window are the actual work.
- **The contract is wherever consumers can observe you** — code, wire, side effects, timing. Version all of it deliberately or be surprised by all of it eventually.

## Common Mistakes

- **Treating the version decision as the whole job.** The number is cheap; the deprecation window, migration guide, and parallel-run plan are the work.
- **Relying on human classification alone.** Add API-diff CI; humans systematically under-classify breaks.
- **A huge, hoarded `2.0.0`.** Ship breaking changes in small, frequent majors with overlap, not one cataclysm.
- **Reusing a protobuf field number** after removing a field — silent data corruption, not a clean error.
- **Lockstep versioning a loosely-coupled monorepo** — MAJOR amplification makes every number a lie.
- **Removing a deprecated API without an announced window** — technically a valid MAJOR, operationally a betrayal.
- **Ignoring transitive/diamond breaks** because they do not appear in your own diff.

## Test Yourself

1. Why does Go's `/v2` import path make diamond dependencies tractable in a way npm's caret does not?
2. A consumer's test breaks after you ship a patch that fixed a genuine bug. Were you "wrong" to call it a patch? What systemic fix prevents recurrence?
3. When is lockstep monorepo versioning the right call, and when does it become a liability?
4. Why can a static API diff classify a removed method correctly but miss a changed default timeout? What complements it?
5. Your registry enforces Avro `BACKWARD` compatibility. A team needs to make a breaking schema change anyway. What is the path?

<details>
<summary>Answers</summary>

1. Go encodes the major in the import path, so `v1` and `v2` are *distinct modules with distinct types* and can coexist in one build. npm's caret keeps both within the same package identity, so two majors can only coexist via nested `node_modules` — which fails for singletons. Go's approach makes major coexistence a type-system fact, not a tree-layout accident.
2. Not wrong by the contract — but Hyrum's Law means a real consumer depended on the bug. The systemic fixes: contract/golden tests downstream, a canary/soak stage so the floated patch is caught before wide rollout, and a clear policy on what "fixing" behavior implies.
3. Right when packages are tightly coupled and always released and consumed together — one number honestly describes the world. A liability once packages are numerous and independently consumed: a fix to one amplifies into spurious MAJORs across all, training consumers to ignore version signals.
4. A signature/removal is structural and appears in the symbol table; a default value is behavior the symbol table cannot see. Complement with contract tests, golden/snapshot tests, and explicit human declaration for behavioral changes.
5. Run both schemas in parallel: introduce a new topic or a `schema_version` field, migrate producers and consumers across an overlap window, then retire the old schema. The registry forces the breaking change to be an explicit migration rather than an in-place edit.

</details>

## Cheat Sheet

```
SURFACE FIRST:    define + minimize the API surface before deciding any bump
HYRUM'S LAW:      all observable behavior gets depended on → breaks are partly empirical

DIAMOND BEHAVIOR:
  npm    nests both (breaks singletons)
  go     /v2 path → majors coexist as distinct modules; MVS within a major
  cargo  majors coexist; unify within major
  maven  nearest-wins (fragile) → use dependencyManagement
  pip    one version → resolver errors on conflict

RESOLUTION:       SAT (npm/cargo/pip) = flexible, non-deterministic → lockfile
                  MVS (go) = max-of-minimums, deterministic, no ranges

TRUST AUTOMATION: API diff in CI → derive min bump → fail if declared < derived
  go: gorelease/apidiff   rust: cargo-semver-checks   java: japicmp/revapi   ts: api-extractor

WIRE:             protobuf reserve removed field numbers; registry-enforced compat (BACKWARD/FULL)
MONOREPO:         coupled→lockstep, decoupled→independent (Changesets/Nx)
DEPRECATION:      mark → window (committed) → remove only in next MAJOR; Deprecation/Sunset headers
```

## Summary

- Version the *API surface*, defined broadly and kept deliberately small; Hyrum's Law makes breaks partly empirical.
- Diamond conflicts resolve differently per ecosystem; major-in-the-type-identity (Go `/v2`, Cargo) is what makes coexistence safe.
- SAT resolvers trade determinism for flexibility; MVS trades flexibility for reproducibility — prefer determinism for shipped builds.
- SemVer is a human social contract with structured failure modes; put API-diff CI and contract tests in the path to make it checkable.
- Version wire formats explicitly and prefer additive evolution; let schema registries enforce it.
- Choose monorepo lockstep vs independent by coupling, and treat deprecation windows as the other half of every MAJOR bump.

## Further Reading

- Hyrum's Law (hyrumslaw.com) and the SRE/"Software Engineering at Google" chapters on dependency management.
- "Go Modules: MVS" design docs (Russ Cox, research.swtch.com/vgo).
- `cargo-semver-checks`, `gorelease`/`apidiff`, `japicmp`, `revapi` documentation.
- Confluent Schema Registry compatibility-types documentation.

## Related Topics

- [Changelogs & Release Notes](../02-changelogs-and-release-notes/) — Conventional Commits as the input to derived bumps.
- [Feature Flags & Progressive Delivery](../06-feature-flags-and-progressive-delivery/) — catching mis-classified bumps before full rollout.
- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/) — parallel-running two versions during a breaking migration.
- [Release Automation](../08-release-automation/) — wiring API-diff and bump derivation into the pipeline.
- [Testing](../../testing/) — contract and golden tests for behavioral breaks.
