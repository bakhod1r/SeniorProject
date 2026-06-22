# Versioning & SemVer — Interview Level

> **Roadmap:** [Release Engineering](../README.md) → Versioning & SemVer
> *A question bank for interviews where versioning comes up — from "what does the middle number mean" to "design the version contract for 800 services."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Ecosystem Differences](#ecosystem-differences)
6. [Judgement & Scale](#judgement--scale)
7. [Scenarios](#scenarios)
8. [Rapid-Fire](#rapid-fire)
9. [Red Flags / Green Flags](#red-flags--green-flags)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

## Introduction

Versioning shows up in interviews for backend, platform, release-engineering, and SDK roles — sometimes as a warm-up, sometimes as a full system-design prompt ("design the dependency-management story for our monorepo"). It is a strong signal because it sits at the intersection of API design, distributed systems, and organizational discipline. A candidate who can explain *why* a "patch" can break someone, and what to do about it, is demonstrating taste, not trivia.

This page is structured as graded questions. For each: the **Q**, a short note on *what the interviewer is really testing*, then a model **A** at strong-candidate depth.

## Prerequisites

**Required**
- The Junior through Senior tiers of this topic; skim Professional for scale questions.
- Hands-on experience publishing or consuming versioned packages in at least one ecosystem.

**Helpful**
- A war story: a time a dependency upgrade broke you, and how you diagnosed it.
- Familiarity with at least one wire format (Protobuf/Avro/OpenAPI).

## Fundamentals

**Q1. Explain SemVer in one breath, then tell me the part most people get wrong.**
*Testing: do you actually understand it, or just the headline?*

**A.** `MAJOR.MINOR.PATCH`: bump MAJOR for breaking changes, MINOR for backward-compatible features, PATCH for backward-compatible bug fixes, resetting lower components to zero on each bump. The part most people get wrong is precedence around pre-releases and metadata: a pre-release sorts *before* the release (`1.0.0-rc.1 < 1.0.0`), and build metadata after `+` is ignored entirely for ordering (`1.0.0+a == 1.0.0+b`). And the components are integers, not decimals — `1.10.0 > 1.9.0`. The deeper "most people get it wrong" answer is that SemVer is a *social contract*, not a compiler-enforced one — the number is only as honest as the human who picked it.

**Q2. What does `0.x` mean, and why does it matter?**
*Testing: do you know the stability escape hatch?*

**A.** While MAJOR is 0, the spec says anything may change at any time — there is no stability promise. By convention (and in Cargo's caret behavior), the minor slot acts as the breaking slot under `0.x`: `^0.3.1` resolves to `>=0.3.1, <0.4.0`, not `<1.0.0`. Reaching `1.0.0` is therefore a *commitment*: "I won't break this without a MAJOR bump." Some projects stay on `0.x` deliberately (ZeroVer) to keep that license forever.

**Q3. Give me three changes people think are non-breaking but are.**
*Testing: your real definition of "the API surface."*

**A.** (1) Changing an error message or error type that callers match on. (2) Raising the minimum runtime version (`now requires Java 17`) — every consumer on an older runtime breaks. (3) Tightening input validation so previously-accepted input now errors. Others: changing a default value that alters behavior, changing serialization precision, making an optional config field required, adding an enum value that breaks exhaustive `switch` consumers. The thread is Hyrum's Law: with enough users, every observable behavior is depended on, so "breaking" is partly empirical, not just definitional.

## Technique

**Q4. How do you decide the bump for a given change without guessing?**
*Testing: do you reach for automation, or rely on vibes?*

**A.** For structural changes, compute it: run an API-diff tool — `gorelease`/`apidiff` (Go), `cargo-semver-checks` (Rust), `japicmp`/`revapi` (Java), `api-extractor` (TS), `buf breaking` (protobuf) — to derive the minimum required bump, and fail CI if the declared bump is smaller. Pair that with Conventional Commits so the declared intent (`feat:`, `fix:`, `feat!:`) is explicit and a release tool computes the version. The diff handles structural breaks; for *behavioral* breaks (changed defaults, timing, error semantics) that diffs can't see, you fall back to human declaration plus contract/golden tests. So: machine-derive what you can, declare what you can't, and gate on the floor.

**Q5. Where should the version live, and how do you prevent drift?**
*Testing: single source of truth discipline.*

**A.** Exactly one authoritative location per artifact, everything else derived. Two common patterns: manifest-as-source (`package.json`/`Cargo.toml`, with `npm version`/`cargo release` creating a matching tag) or tag-as-source (Go's `git describe` injected via `-ldflags "-X main.version=..."`). Whichever you pick, add a CI assertion that the manifest version equals the release tag, so they can never silently disagree. The failure mode you're preventing is a binary that reports a version different from its tag and manifest — which makes every downstream artifact untrustworthy.

**Q6. A library you maintain needs a breaking change. Walk me through shipping it responsibly.**
*Testing: do you treat a MAJOR as a migration, not a number?*

**A.** First minimize the break — can it be additive with a deprecation instead? If it must break: (1) bump MAJOR and, where the language supports it, make the major coexist (Go `/v2` import path, a new package namespace) so old and new run side by side. (2) Deprecate the old API first with a committed window and compiler-visible warnings. (3) Ship the migration *with* the break — a codemod (`jscodeshift`, `gofmt -r`, OpenRewrite) so consumers run a command instead of editing by hand. (4) Write a migration guide. (5) Parallel-run during the window, then remove only after it expires. The version bump is the cheap part; the runway and tooling are the work.

## Ecosystem Differences

**Q7. Contrast how npm, Go, and Cargo resolve dependency versions.**
*Testing: depth beyond "they all use SemVer."*

**A.** npm uses SAT-style resolution over caret/tilde ranges, prefers newest, and nests `node_modules` so multiple versions of one package can coexist — great for leaf libs, fatal for singletons (two Reacts). It's non-deterministic over time, hence lockfiles. Go has no ranges: you declare a single *minimum* per module and Minimal Version Selection picks the max of all requested minimums — deterministic and reproducible by construction, with the major encoded in the import path (`/v2`) so majors are distinct modules. Cargo defaults to caret, uses a resolver, and (like Go) lets different majors coexist while unifying within a major. The axis is determinism vs flexibility: Go maximizes reproducibility at the cost of manual bumps; npm maximizes convenience at the cost of needing a lockfile to be reproducible.

**Q8. What's a pseudo-version in Go and when do you see one?**
*Testing: practical Go modules knowledge.*

**A.** `v0.0.0-20240101120000-abcdef123456` — a synthetic version Go generates for a commit that has no SemVer tag. It encodes a base version it sorts just above, the commit's UTC timestamp, and a 12-char hash. You see it when you depend on a specific untagged commit (e.g. an upstream fix not yet released). It sorts correctly relative to real tags and stays reproducible because it pins an exact commit.

**Q9. Explain the difference between `^1.2.3`, `~1.2.3`, and `~=1.2.3`.**
*Testing: precision with constraint syntax.*

**A.** `^1.2.3` (npm/Cargo) = `>=1.2.3 <2.0.0` — minor and patch updates. `~1.2.3` (npm) = `>=1.2.3 <1.3.0` — patch only. `~=1.2.3` (pip/PEP 440) = `>=1.2.3 <1.3.0` — the "compatible release" operator, equivalent to npm's tilde at that precision (`~=1.2` would be `>=1.2 <2.0`). The subtle one is caret under `0.x`: `^0.2.3` is `>=0.2.3 <0.3.0` because the leftmost non-zero component is treated as the breaking slot.

## Judgement & Scale

**Q10. Why might a CalVer scheme be *better* than SemVer for some software?**
*Testing: scheme selection, not dogma.*

**A.** SemVer answers "is this safe to upgrade?" — the right question for a library with an import API. For software nobody imports (an end-user app, an OS, a deploy-only microservice), there's no compatibility contract to encode, so MAJOR/MINOR/PATCH carry no information. CalVer (`2024.06`) answers the only questions that matter there — "how new is this?" and "how stale am I?" — directly. The mistake is monoculture: forcing SemVer onto deploy-only services produces meaningless majors; forcing CalVer onto libraries strips the compatibility signal. Match the scheme to the consumer's question.

**Q11. Design the versioning contract for an org with 800 services and a shared proto repo.**
*Testing: can you turn versioning into governed infrastructure?*

**A.** I'd make versioning a governed, machine-readable standard, not per-team convention. Per artifact class: libraries → SemVer with API-diff CI gating bumps; deploy-only services → CalVer or `<date>-<sha>`; the proto repo → additive-only on main with `buf breaking` enforced in CI, and breaking changes forced into a new `vN` package namespace so existing consumers are untouched. Enforce it in the platform: Conventional Commits drive automated bump+changelog; OPA/Conftest checks tag==manifest, no floating tags in prod, and that breaking PRs carry a migration plan. For fleet health: an SBOM-indexed inventory so any CVE maps to affected versions in minutes, plus Renovate keeping the estate near the leading edge. For breaks: ship codemods to subsidize migrations, parallel-run old majors, and govern deprecations with a registry (announce date, sunset date, owner) and RFC 8594 `Sunset` headers. The thesis: at scale, correctness can't depend on engineers remembering rules — encode and enforce them.

**Q12. Tell me about a time SemVer "lied" and what you'd do about it systemically.**
*Testing: the social-contract failure modes.*

**A.** The classic is a patch release that fixed a genuine bug but broke consumers who depended on the buggy behavior — e.g. making an unstable sort stable, breaking tests that asserted exact tie-order, or tightening validation. By the contract it was a valid patch; by Hyrum's Law a real consumer depended on the old behavior. Systemic fixes, not blame: contract/golden tests downstream to catch behavioral changes; a canary/soak stage so a floated patch is caught in staging before it reaches everyone; and a clear written policy on what "fixing behavior" implies. You can't make humans perfect at classifying breaks, so you put checks in the path and limit blast radius with progressive rollout.

## Scenarios

**Q13. A diamond dependency: A→B needs `D ^1.2`, A→C needs `D ^2.0`. How does it resolve in npm vs Go, and what's the real risk?**

**A.** In npm both coexist via nested `node_modules` — usually fine, but if D is a singleton (a logger, a context provider, a global registry) you now have two instances and subtle bugs. In Go, `D v1` and `D v2` are different modules (`d` vs `d/v2`) by import path, so they coexist cleanly and MVS unifies each major. The real risk is singletons under duplication-tolerant resolvers; the mitigation is marking such packages as peer dependencies and putting the major in the type identity so the type system keeps the two apart.

**Q14. You published `1.4.1` with a leaked credential in it. People have already pinned it. What do you do?**

**A.** Yank, don't delete. Deleting breaks every lockfile that pins `1.4.1` and orphans its signatures/SBOM records. Yanking (npm `deprecate`/`unpublish` rules, crates.io `yank`) marks it unusable for *new* resolutions while existing pins keep working. Then: rotate the leaked credential immediately (the version is public forever regardless), publish a fixed `1.4.2`, and advise consumers to upgrade. Versions are immutable by design — you can't un-ship the bytes, so the response is rotate + yank + supersede, not edit-in-place.

**Q15. Your team wants to bump a transitive dependency's major. Your code doesn't change. Is that a breaking change for your consumers?**

**A.** It can be. If your public API exposes types from that dependency, or if a consumer pins a conflicting constraint on the same transitive dep, your major bump of it creates a conflict in *their* build even though your diff looks empty. This is the dependency-leak break: don't leak third-party types across your public API, and if you must bump an exposed dependency's major, treat it as a MAJOR of your own package.

## Rapid-Fire

**Q16. Is `1.0.0-rc.1` newer or older than `1.0.0`?** Older — pre-releases sort before the release.

**Q17. Does `+build.55` affect version ordering?** No — build metadata is ignored for precedence.

**Q18. `^0.4.2` — what's the upper bound?** `<0.5.0`; under `0.x` the minor is the breaking slot.

**Q19. What algorithm does Go use to pick versions?** Minimal Version Selection — max of all requested minimums.

**Q20. Why commit a lockfile?** To make SAT-resolved builds reproducible — the exact versions you tested are the ones that ship.

**Q21. Adding an optional parameter with a default — what bump?** MINOR (backward-compatible feature).

**Q22. How do you change a protobuf field safely?** Add a new field with a new number; never reuse a number; `reserve` removed numbers/names.

**Q23. What is EPOCH for?** Forcing version ordering after a botched scheme change — PEP 440's `1!2.0` sorts above older `2024.x` strings.

**Q24. One reason to prefer pinning by digest over by tag in production?** Tags can be re-pointed; a digest is immutable, so it's reproducible and signable.

## Red Flags / Green Flags

**Green flags**
- Distinguishes the *contract* (API surface) from the *implementation*, and names Hyrum's Law unprompted.
- Reaches for API-diff automation to derive bumps rather than relying on judgment alone.
- Treats a MAJOR as a migration with codemods and a window, not just a number change.
- Picks schemes per artifact class (SemVer for libs, CalVer for apps/services) instead of dogmatically.
- Knows determinism (lockfiles, MVS) is the real goal for shipped builds.

**Red flags**
- Thinks versions are decimals (`1.9 > 1.10`) or that build metadata affects ordering.
- Believes SemVer is compiler-enforced and never "lies."
- Calls every change a patch to avoid the work of a real bump, or hoards breaks into one giant major.
- Floats `latest` / un-pinned ranges into production and is surprised by non-reproducible builds.
- Proposes deleting a bad published version (breaking everyone) instead of yanking.
- Forces one scheme on all artifact classes and can't justify why.

## Cheat Sheet

```
MAJOR.MINOR.PATCH   break / feature / fix; integers not decimals
PRECEDENCE          pre-release < release; +metadata ignored
0.x                 anything may change; minor = breaking slot; 1.0 = commitment
BREAKING (sneaky)   error msgs, raised runtime min, tightened validation, default changes, enum adds
DERIVE BUMPS        gorelease / cargo-semver-checks / japicmp / buf breaking; gate declared vs required
RESOLUTION          npm/cargo/pip = SAT + lockfile; go = MVS (max of minimums), /v2 path
CONSTRAINTS         ^=minor+patch  ~=patch(npm)  ~==compatible(pip)  go=single minimum
SCHEMES             lib→SemVer  app/service→CalVer  proto→SemVer+vN  prod image→digest
MAJOR = MIGRATION   codemod + window + parallel-run; never break often AND manually
SUPPLY CHAIN        immutable versions; YANK not DELETE; pin by digest for security
```

## Summary

- Know the spec cold — bumps, precedence, pre-releases, build metadata — then go past it to *why SemVer is a social contract that lies*.
- Derive bumps from API diffs where you can; fall back to declaration plus contract tests for behavioral breaks.
- Be fluent in ecosystem differences: SAT + lockfiles vs Go's MVS, caret/tilde/`~=` semantics, pseudo-versions, `/v2` paths.
- Treat a MAJOR as a funded migration (codemods, windows, parallel runs), and choose schemes per artifact class.
- At scale, frame versioning as governed, machine-enforced infrastructure — and handle the supply-chain edges (yanking, immutability, digests) correctly.

## Further Reading

- semver.org and calver.org — the specs, end to end.
- "Go Modules Reference" and Russ Cox's MVS essays — determinism and pseudo-versions.
- Hyrum's Law (hyrumslaw.com) — why "breaking" is empirical.
- Buf, `cargo-semver-checks`, `japicmp` — API-diff tooling to cite in interviews.

## Related Topics

- [Changelogs & Release Notes](../02-changelogs-and-release-notes/) — Conventional Commits feeding automated bumps.
- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/) — limiting blast radius when a bump misclassifies.
- [Release Automation](../08-release-automation/) — wiring derivation and gates into CI.
- [Supply Chain Security](../09-supply-chain-security/) — immutability, SBOMs, and yanking.
- [Testing](../../testing/) — contract and golden tests for behavioral breaks.
