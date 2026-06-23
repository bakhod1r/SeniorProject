# Minimal Version Selection (MVS) — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Design Goal: High-Fidelity, Reproducible Builds](#the-design-goal-high-fidelity-reproducible-builds)
3. [MVS vs SAT-Solver Dependency Managers](#mvs-vs-sat-solver-dependency-managers)
4. [Why "Newest" Is the Wrong Default](#why-newest-is-the-wrong-default)
5. [No Lockfile: Why `go.mod` Is Enough](#no-lockfile-why-gomod-is-enough)
6. [The Cost of MVS: Lagging and the Patch Problem](#the-cost-of-mvs-lagging-and-the-patch-problem)
7. [Upgrade and Downgrade as Operational Events](#upgrade-and-downgrade-as-operational-events)
8. [MVS and Supply-Chain Security](#mvs-and-supply-chain-security)
9. [MVS in Large Dependency Graphs](#mvs-in-large-dependency-graphs)
10. [MVS in Multi-Module Repos and Workspaces](#mvs-in-multi-module-repos-and-workspaces)
11. [`replace`, `exclude`, and Retraction as Policy Tools](#replace-exclude-and-retraction-as-policy-tools)
12. [Diamond Dependencies and Major-Version Coexistence](#diamond-dependencies-and-major-version-coexistence)
13. [Anti-Patterns](#anti-patterns)
14. [Senior-Level Checklist](#senior-level-checklist)
15. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with MVS is not "how does it pick a version" but "why was this algorithm chosen over the SAT-solver model everyone else uses, what does that choice buy the team, and where does it cost us." MVS selects the highest of the minimums and stops. Mechanically simple. Philosophically opinionated.

This file is about *the design rationale and the trade-offs*. The mechanics — the four operations, the build-list computation — are in [middle.md](middle.md). Here we ask why Russ Cox deliberately rejected the dependency-resolution orthodoxy, what reproducibility and high fidelity actually mean as engineering properties, and how MVS shapes upgrade policy, security response, and large-graph operations in real organisations.

After reading this you will:
- Articulate the design goals (reproducibility, high fidelity, simplicity) and how MVS achieves each
- Compare MVS rigorously against SAT-based resolvers (npm, Cargo, Bundler, pip)
- Explain why "use the newest compatible version" is the wrong default for production software
- Reason about MVS's costs — dependency lag, the manual-patch burden — and mitigate them
- Treat upgrades, downgrades, `replace`, and `exclude` as deliberate policy levers
- Avoid the anti-patterns that turn MVS's guarantees into liabilities

---

## The Design Goal: High-Fidelity, Reproducible Builds

MVS exists to deliver two properties that Russ Cox argued matter more than "always newest."

### Reproducibility

A build is **reproducible** if the same source produces the same dependency versions, on any machine, at any time. With MVS, the selected versions are a pure function of the `require` floors committed in the module graph. No external state, no calendar, no "what was the latest tag when you ran install." The versions are *in the repo*.

This is a stronger guarantee than a lockfile provides, because there is no separate file that can drift from the manifest. The `go.mod` floors *are* the lock; there is nothing to fall out of sync.

### High fidelity

A build is **high-fidelity** if it uses the versions the dependency authors *actually developed and tested against*. When library `A` declares `require C v1.4.0`, that is the version `A`'s authors built with. MVS honours that floor and goes no higher than necessary. So you tend to build `A` against `C v1.4.0` — exactly what `A`'s tests ran against — rather than against some newer `C v1.9.0` that `A`'s authors never saw.

A "newest version" resolver does the opposite: it builds `A` against the latest `C`, a combination `A`'s authors may never have tested. When that combination breaks, it breaks for *you*, at build or runtime, not for them. MVS pushes you toward the tested combinations and away from the untested frontier.

### Simplicity

The third goal, often underrated: the algorithm is *trivial to reason about*. A graph walk taking the max per module. No backtracking, no heuristics, no "the solver picked something weird." An engineer can predict the result by hand. Simplicity is a feature — it is why MVS surprises are rare and debuggable.

These three goals — reproducible, high-fidelity, simple — are the lens through which every MVS trade-off should be evaluated.

---

## MVS vs SAT-Solver Dependency Managers

Most ecosystems model dependency resolution as a **constraint-satisfaction problem**. Each package declares version *ranges* (`^1.2.0`, `>=2.0,<3.0`, `~> 1.4`), and the resolver searches for an assignment satisfying all ranges — often NP-hard, solved with a SAT solver or backtracking search.

| Property | SAT-solver model (npm, Cargo, Bundler, pip) | MVS (Go) |
|----------|---------------------------------------------|----------|
| Constraint type | Ranges (`^`, `~`, `>=`, `<`) | Single floors (`>= v`) only |
| Selection target | Newest version satisfying all ranges | Minimum (highest floor), never newer |
| Algorithm | Backtracking / SAT — can be exponential | Graph walk, linear, no backtracking |
| Determinism | Requires a lockfile to pin the solution | Deterministic from `go.mod` alone |
| New upstream release | Can change the solution silently | Changes nothing until you `go get` |
| Resolution failures | "No satisfying assignment" / conflicts | Essentially never — max always exists |
| Reproducibility | Lockfile-dependent | Intrinsic |
| Fidelity | Builds against newest in range (untested) | Builds against declared minimums (tested) |

### Why MVS eliminates a whole failure class

A SAT resolver can fail outright: `A` needs `C <2.0`, `B` needs `C >=2.0`, no version satisfies both — a hard conflict, and the user is stuck. MVS has no upper bounds, so there is *no* unsatisfiable case: the max of the floors always exists. You may end up on a version a dependency did not anticipate, but you always get *a* build. The trade is "never fails to resolve, but you own compatibility" versus "can refuse to resolve, but guarantees range-compatibility."

### Why MVS does not need a lockfile

The SAT model needs a lockfile because the *same manifest with ranges* can resolve to different versions on different days (new releases appear inside the ranges). The lockfile freezes one solution. MVS's manifest has no ranges — a floor is a single version — so the manifest already determines the solution. There is nothing left for a lockfile to pin.

This is the deepest difference: SAT resolution is a *search* whose result must be cached (locked); MVS is a *computation* whose result is implied by the input.

---

## Why "Newest" Is the Wrong Default

It feels generous for a package manager to give you the newest compatible version — you get the latest fixes for free. Russ Cox's argument is that "free" is an illusion for production software.

- **Untested combinations.** Newest-in-range means your dependency runs against versions of *its* dependencies it never tested. Bugs surface in *your* build, not the author's.
- **Non-reproducibility.** Two installs days apart differ. CI is a moving target. "Works on my machine" becomes "worked at the moment I installed."
- **Silent, unaudited change.** A transitive dependency you have never heard of bumps overnight and changes behaviour. No PR, no review, no signal — until something breaks.
- **The lockfile patch.** Ecosystems mitigate with lockfiles, but that adds a second source of truth that can drift, merge-conflict, and be regenerated inconsistently.

MVS inverts the default: you get exactly what was declared, nothing newer, until you *choose* to move. Upgrades become explicit, reviewable, intentional events. For a library or a long-lived service, "I decide when my dependencies change" is worth more than "I always have the newest." The newest version is one `go get` away whenever you actually want it.

The philosophical core: **MVS treats dependency versions as part of your source code**, not as an externally-resolved environment. Changing them is a code change, reviewed like any other.

---

## No Lockfile: Why `go.mod` Is Enough

Teams arriving from other ecosystems often look for the lockfile and are unsettled to find none. The honest framing:

- `go.mod` is the manifest *and* the lock. The floors fully determine selection.
- `go.sum` is **not** a lockfile. It is an integrity database — cryptographic hashes of the module bytes used — so a malicious or buggy proxy cannot swap content. It records hashes for versions in (and reachable from) the build, but it does not *choose* versions. Deleting `go.sum` does not change which versions are selected; it only removes the integrity check.
- `vendor/` is an optional *materialisation* of the selected versions, useful for offline/audited builds. It is downstream of MVS, not a substitute for it.

So the senior mental model is: **selection (MVS, from `go.mod`) and verification (`go.sum`) are separate concerns.** Other ecosystems conflate them in one lockfile; Go splits them. This is why a Go repo with a clean `go.mod` and `go.sum` is fully reproducible with no third file — and why "do we need to commit a lockfile?" has the answer "you already did: it is `go.mod`."

---

## The Cost of MVS: Lagging and the Patch Problem

MVS's reproducibility has a price, and a senior engineer must own it rather than pretend it away.

### Dependency lag

Because MVS never upgrades on its own, a project drifts *backwards* relative to the ecosystem over time. The selected versions are whatever the floors say; if nobody runs `go get -u`, the build stays frozen while upstream ships fixes. A two-year-old service can be running dependencies two years stale. This is the flip side of "no surprise upgrades": no surprise *patches* either.

### The security-patch burden

A CVE fix in `v1.4.3` does not reach a build floored at `v1.4.0` until someone raises the floor. There is no "automatic security update." The mitigation is process, not algorithm:

- **`govulncheck` in CI**, on a schedule, failing the build on known-vulnerable selected versions. This converts "we lag silently" into "we lag visibly and are forced to act."
- **Scheduled `go get -u=patch ./...` PRs** (a bot, or a recurring task) to pull patch-level fixes with minimal behavioural risk.
- **A clear floor-raising playbook** for advisories: identify the patched version, `go get mod@patched`, tidy, retest, ship.

### The fidelity-vs-currency tension

MVS optimises fidelity (tested combinations) at the cost of currency (latest fixes). The senior job is to add a *deliberate currency process* on top of MVS's deliberate-by-default stance: regular, reviewed upgrades. MVS gives you a stable floor to upgrade *from*; it does not relieve you of upgrading.

---

## Upgrade and Downgrade as Operational Events

Because MVS makes version changes explicit, every upgrade and downgrade is a discrete, reviewable event — which is exactly how senior teams should treat them.

### Upgrades as reviewed changes

`go get -u foo` (or a Renovate/Dependabot PR) produces a `go.mod`/`go.sum` diff that says precisely which floors moved. That diff is a code change: it goes through review, CI, and `govulncheck`. The reviewer can reason about blast radius from the floor change alone. Compare to a SAT ecosystem where a lockfile regeneration can silently shift a dozen transitive versions with no manifest change.

### Downgrades as graph surgery

Downgrades are rarer and riskier because they *propagate* (see [middle.md](middle.md)): to lower module `C`, MVS must downgrade every module that floored `C` higher. `go get C@older` reports the cascade. A senior engineer reads that report carefully — a one-line intent ("pin C lower") can cascade into downgrading several other modules, possibly reintroducing bugs those newer versions fixed. Downgrades should be reserved for genuine "this version is broken" situations, and `exclude` is often the cleaner tool (skip the bad version without forcing everything down).

### The reviewability dividend

The senior framing: MVS turns dependency management into *version control of versions*. Every change to what you depend on is a committed, reviewable, bisectable diff. `git blame go.mod` tells you who raised a floor and when; `git bisect` can isolate a bad upgrade to a single floor change. This auditability is a direct consequence of "no lockfile, no auto-resolution" — and it is one of MVS's most underappreciated benefits.

---

## MVS and Supply-Chain Security

MVS's properties have concrete supply-chain consequences, good and bad.

### What MVS helps with

- **No silent transitive shifts.** An attacker who compromises a popular library *cannot* push malicious code into your build by releasing a new version. MVS will not select it until a floor names it. Your exposure window is "until you deliberately upgrade," not "the next time anyone runs install."
- **Auditable changes.** Every version that enters your build does so via a committed floor. There is a paper trail.
- **Deterministic forensics.** "What version of X did the binary we shipped in March contain?" is answerable from the March commit's `go.mod`, exactly, via MVS — no proxy round-trip, no guessing.

### What MVS does not help with

- **It does not vet code.** MVS selects versions; it has no opinion on whether a version is malicious or vulnerable. A pinned-but-vulnerable version sits there forever.
- **The lag *is* a risk.** Staying on old versions means staying on *known-vulnerable* versions. MVS's reproducibility can become "reproducibly insecure" without a currency process.
- **`replace` can subvert it.** A malicious or careless `replace` overrides selection entirely, pointing a trusted import path at arbitrary code. `replace` lines deserve the same scrutiny as the code they substitute.

The senior synthesis: MVS removes the *push* attack (silent upgrade to malicious code) but does nothing about the *stale* risk (sitting on vulnerable code). You must add scanning (`govulncheck`, SBOM + advisory feeds) and a regular upgrade cadence to cover the gap MVS deliberately leaves.

---

## MVS in Large Dependency Graphs

At scale — hundreds of modules, deep transitive trees — MVS's properties become operationally significant.

### Performance

MVS selection itself is linear and cheap. The historical cost was *loading* the full transitive module graph (fetching every `go.mod`). Module graph pruning (`go 1.17+`) addresses this: for modules declaring `go 1.17+`, the graph is pruned to the requirements actually needed to build the main module's imported packages, and the build list is pinned in the main `go.mod` as `// indirect` requires. Large repos should be on a current `go` directive specifically to get this — it is the difference between loading a few dozen and a few thousand `go.mod` files.

### Floor inflation

In a big graph, the selected version of a popular module (e.g. `golang.org/x/sys`) is the max floor across *every* dependency that requires it. One aggressive dependency that floors it high drags the whole repo up. This is usually benign (newer is compatible within a major version) but worth understanding when a version is "higher than I expected": some transitive dependency set the floor.

### Coordinated upgrades

Raising one popular floor (say, for a CVE) can be a large, reviewed change touching many indirect requires. Senior teams script these: identify the floor, `go get mod@patched ./...` across affected modules, tidy, and produce a focused PR. The reviewability of MVS makes the blast radius legible; the scale makes tooling worthwhile.

---

## MVS in Multi-Module Repos and Workspaces

### Per-module selection

MVS runs *per main module*. In a multi-module repo, each `go.mod` has its own build list, computed independently. Two modules in the same repo can select *different* versions of the same dependency, because each has its own floors. There is no repo-wide selection.

### Workspaces (`go.work`)

A workspace overlays several modules for local development so they resolve each other's source directly. Crucially, `go.work` does **not** change MVS's per-module selection of *external* dependencies — it affects how the listed modules see *each other*, not how versions of third-party modules are chosen. For each module, MVS still computes a build list from that module's `go.mod`. `go work sync` can push the selected versions across workspace modules to keep them consistent, but selection remains per-module.

The senior point: a workspace is a development convenience, not a new resolution model. MVS's rules are unchanged; the workspace just changes which *source* satisfies the in-workspace module paths. Released artefacts are still built with each module's own MVS result.

---

## `replace`, `exclude`, and Retraction as Policy Tools

Three directives let you override or shape MVS deliberately. Senior engineers treat them as policy levers, not hacks.

### `exclude` — veto a bad version

```
exclude golang.org/x/text v0.5.0
```

Removes a single version from MVS's candidate set for the main module. Use when a specific version is known-broken (a bad release, a yanked tag) and you want MVS to skip it and select the next-highest floor. Cleaner than a forced downgrade because it does not cascade — it just deletes one candidate.

### `replace` — substitute a module or version

```
replace example.com/foo => example.com/foo v1.4.1-patched
replace example.com/foo => ../local-fork
```

Overrides selection entirely for that path: the build uses the replacement, not whatever MVS would have chosen. The canonical legitimate uses are forks (ship a patched dependency before upstream releases) and local development. The risk is provenance: anyone reading the build thinks they see upstream code but get the replacement. Audit `replace` lines; document each.

### `retract` — disown your own bad release

```
retract v1.3.0   // critical bug, do not use
```

A directive *you* put in *your* module's `go.mod` to tell *consumers* that a version you published is bad. It does not affect your own selection; it informs *downstream* MVS computations and `go get` (which warns and avoids retracted versions). The policy lever for "we shipped a broken tag; steer users away without deleting it."

The unifying senior insight: MVS computes from the graph, but the graph is not immutable fate. `exclude` prunes a candidate, `replace` overrides a result, `retract` shapes what downstream graphs see. Reach for them when the graph cannot express a constraint MVS lacks (an upper bound, a substitution) — and treat each as a documented decision.

---

## Diamond Dependencies and Major-Version Coexistence

### The diamond

The classic hard case for any resolver: `A` and `B` both depend on `C`, at different versions. A SAT resolver may face a conflict if their *ranges* are incompatible. MVS has no conflict: it selects `max(C floors)` and builds `A` and `B` both against it. As long as `C` follows semver (no breaking change within a major), both `A` and `B` get a `C` at least as new as they required, and it works. The diamond is resolved by construction, with no search.

### Major-version coexistence

MVS treats `C` and `C/v2` as *entirely different modules* with different import paths. If `A` needs `C v1.x` and `B` needs `C/v2`, both are selected and coexist in the build — two modules, two versions, no conflict. This is Go's deliberate answer to the diamond-of-death: a breaking change is a *new module* (new path), so the old and new can live side by side. Code importing `C` gets v1; code importing `C/v2` gets v2.

The senior implication: encourage dependencies (and your own modules) to follow Go's major-version-as-path-suffix convention rigorously. It is what makes incompatible upgrades *coexist* instead of *conflict* — turning the worst case of SAT resolvers into a non-event for MVS.

---

## Anti-Patterns

- **Fighting MVS by hand-editing `go.mod` to force a version down.** A lower line below an existing floor is ignored. Use `go get`, `exclude`, or `replace` — and understand which.
- **Treating "no auto-upgrade" as "no need to upgrade."** Reproducibility without a currency process means reproducibly running stale, vulnerable code. Pair MVS with `govulncheck` and scheduled upgrades.
- **Using `replace` as a permanent dependency-management strategy.** `replace` is an escape hatch (forks, local dev), not a way to run the project. Long-lived `replace` lines rot, hide provenance, and confuse consumers (who ignore them anyway).
- **Downgrading carelessly and ignoring the cascade report.** A downgrade propagates; accepting it blindly can reintroduce fixed bugs in the modules MVS had to lower.
- **Assuming `go.sum` is a lockfile.** It is integrity, not selection. Reasoning about reproducibility through `go.sum` is a category error.
- **Letting one aggressive dependency dictate floors.** If a minor dependency drags a popular module's floor high, audit whether you want that — sometimes the fix is to drop or replace the aggressive dependency.
- **Publishing a library with `replace`/`exclude` and expecting consumers to honour them.** They apply only to the main module. A library author must encode constraints as `require` floors (and `retract` for bad releases), not main-module-only directives.
- **Mixing major versions accidentally.** Importing both `C` and `C/v2` unintentionally doubles a dependency in the binary. Coexistence is a feature when deliberate, a bloat bug when accidental — audit with `go mod why`.
- **Skipping `go mod tidy` after version changes.** Stale `// indirect` lines and an unpinned build list undermine pruning and reproducibility.

---

## Senior-Level Checklist

- [ ] Articulate MVS's three goals (reproducible, high-fidelity, simple) and how each is achieved
- [ ] Explain why MVS needs no lockfile and why `go.sum` is not one
- [ ] Compare MVS to SAT resolvers, including the eliminated failure class (no unsatisfiable case)
- [ ] Own the cost: dependency lag, and add a currency process (`govulncheck` + scheduled upgrades)
- [ ] Treat every upgrade/downgrade as a reviewed, bisectable `go.mod` diff
- [ ] Read and accept (or reject) downgrade cascade reports deliberately
- [ ] Use `exclude` to veto a bad version, `replace` for forks/local dev, `retract` to disown your bad releases
- [ ] Keep the `go` directive at 1.17+ for module graph pruning in large repos
- [ ] Understand per-module selection in multi-module repos and that `go.work` does not change it
- [ ] Rely on major-version-as-path-suffix to make incompatible upgrades coexist, not conflict
- [ ] Audit `replace` lines and major-version coexistence with `go mod why`

---

## Summary

MVS is a deliberate rejection of dependency-resolution orthodoxy. Where npm, Cargo, Bundler, and pip model resolution as a constraint-satisfaction search over version *ranges* — solved by a SAT/backtracking algorithm and pinned by a lockfile — Go models it as a trivial computation over single *floors*: select the maximum required version per module, never newer. The payoff is three properties Russ Cox argued matter more than "always newest": **reproducibility** (versions are a pure function of the committed `go.mod`, no lockfile, no drift), **high fidelity** (you build against the versions dependency authors actually tested), and **simplicity** (a graph walk anyone can predict by hand, with no unsatisfiable case to fail on).

The cost is real and must be owned: MVS never upgrades on its own, so projects lag, and security patches arrive only when someone deliberately raises a floor. The senior responsibility is to add a *currency process* — `govulncheck`, SBOM/advisory scanning, scheduled reviewed upgrades — on top of MVS's deliberate-by-default stance. The escape hatches (`exclude` to veto a version, `replace` to substitute, `retract` to disown a bad release) are policy levers for what the graph cannot express, and major-version-as-path-suffix turns the SAT world's diamond-of-death into harmless coexistence.

The mechanical algorithm is trivial. The senior insight is *why* trivial-and-explicit beats clever-and-implicit for production software: MVS makes your dependency versions part of your source code, every change to them a reviewed, auditable, bisectable diff — and that, not "newest," is what reproducible, defensible engineering requires.
