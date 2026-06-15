# Per-Language Tools — Interview Preparation

> **Roadmap:** [Build Systems](../README.md) → Per-Language Tools
> *Build-tool questions separate people who* use *the tools from people who* understand *them. "What's a lockfile" is a warm-up. "Why is `go.sum` not the same kind of lockfile as `Cargo.lock`" is the real question — and it's testing whether you understand MVS, determinism, and integrity as distinct ideas.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [How to Use This Page](#how-to-use-this-page)
3. [Group A — Manifest vs Lockfile](#group-a--manifest-vs-lockfile)
4. [Group B — Resolution Algorithms (incl. MVS)](#group-b--resolution-algorithms-incl-mvs)
5. [Group C — Caching](#group-c--caching)
6. [Group D — Reproducibility & Hermeticity](#group-d--reproducibility--hermeticity)
7. [Group E — Supply Chain & Security](#group-e--supply-chain--security)
8. [Group F — Tool-Specific Gotchas](#group-f--tool-specific-gotchas)
9. [Group G — Polyglot & Scaling](#group-g--polyglot--scaling)
10. [Scenario Questions](#scenario-questions)
11. [Rapid-Fire Round](#rapid-fire-round)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Related Topics](#related-topics)

---

## Introduction

> Focus: **A question bank with model answers, grouped by theme, plus what each question is really probing.**

Build-tool questions show up in backend, platform, DevOps, and senior generalist interviews because the tool is where "I wrote code" meets "it runs reliably for everyone." Interviewers use these questions to find the boundary between surface familiarity (you've typed `npm install`) and structural understanding (you know *why* `npm install` differs from `npm ci` and why that matters in CI).

The questions below are grouped by the axes you've studied across the four tiers. Each has a model answer at the depth a senior should hit, plus a **"really testing"** note naming the underlying competency — because answering the literal question while missing the point still loses the room.

---

## How to Use This Page

- **Answer out loud first, then read.** Recognition is not recall.
- **Lead with the principle, then the example.** "MVS picks the max of the required minimums — so `>=1.2`, `>=1.4`, `>=1.3` resolves to 1.4" beats reciting commands.
- **Name the trade-off.** Every tool decision is a trade-off; senior answers always state both sides.
- **When you don't know a tool, reason from the universal shape.** "I haven't used bun, but every tool has a manifest, lockfile, cache, and build command — so I'd expect…" shows the right mental model.

---

## Group A — Manifest vs Lockfile

**A1. What is the difference between a manifest and a lockfile?**

> The **manifest** is what you *want* — your declared dependencies, often as loose ranges; you author it (`go.mod`, `Cargo.toml`, `package.json`). The **lockfile** is what you *got* — the exact resolved versions of the entire transitive graph plus integrity hashes; the tool generates it (`Cargo.lock`, `package-lock.json`, `go.sum`). The manifest expresses intent; the lockfile freezes the outcome so it reproduces.

*Really testing:* whether you understand intent vs realized state, and that one is authored while the other is generated.

**A2. Why do you commit the lockfile, and what breaks if you don't?**

> Committing it makes the build reproducible: everyone resolves to identical versions. Without it, the manifest's loose ranges (`^1.2.0`) let two people installing at two times get different versions — a new release came out in between — producing "works on my machine" bugs that only appear on the machine that resolved differently.

*Really testing:* the link between lockfiles and reproducibility — the core value proposition.

**A3. Should a *library* commit its lockfile? What about an application?**

> An **application** always commits and enforces its lockfile — it controls its own deployment, so it wants exact pinning. A **library** is more nuanced: its lockfile only describes *its own* dev/test build, not what *consumers* get, because consumers re-resolve against their *other* dependencies. Many ecosystems ignore a dependency's lockfile entirely. So libraries often commit a lockfile for reproducible CI but understand it doesn't constrain downstream users; the *manifest's ranges* are the real contract a library offers.

*Really testing:* whether you understand the difference between "my build" and "my consumers' builds" — a senior distinction many miss.

**A4. Can you hand-edit a lockfile to change a version? Should you?**

> Mechanically you can, but you shouldn't. The lockfile is *generated* output. To change a version, change the **manifest** (intent) and let the tool **re-resolve** — that re-derives a consistent lockfile including any transitive changes the new version implies. A hand-edited lockfile is inconsistent with the manifest and gets "corrected" on the next install, silently undoing your edit (or worse, leaving a graph that can't actually resolve).

*Really testing:* that generated artifacts are derived from sources, not edited directly.

---

## Group B — Resolution Algorithms (incl. MVS)

**B1. Explain Go's Minimum Version Selection. How does it differ from npm/cargo's strategy?**

> MVS selects, for each module, the **maximum of the minimum versions** required anywhere in the dependency graph. If you require `D>=1.2`, dependency A requires `D>=1.4`, and B requires `D>=1.3`, MVS picks **1.4.0** — the highest *required minimum*, not the latest published. It needs no solver and no backtracking — it's a graph walk taking maxes — and it's deterministic by construction. npm/cargo use **newest-compatible**: pick the *highest* version within each range that satisfies all constraints, which is a moving target as new versions publish, hence their reliance on the lockfile.

*Really testing:* the single most important conceptual contrast in the topic — and whether you can state an algorithm precisely.

**B2. Why does Go's design mean `go.sum` is "lighter" than `Cargo.lock`?**

> Because MVS already makes version selection deterministic from the `go.mod` files alone, `go.sum` doesn't need to *record which versions* — it only records **content hashes for integrity**. `Cargo.lock`, by contrast, must record the *actual chosen versions* because cargo's newest-compatible resolution is non-deterministic without it (it depends on what's published *now*). Same word "lockfile," two different jobs: integrity-only vs version-pinning.

*Really testing:* whether you grasp that the lockfile's *job* depends on whether resolution is already deterministic.

**B3. What's the trade-off of MVS vs newest-compatible?**

> MVS gives surprise-free, deterministic, high-fidelity builds — what you tested is what ships, and you never drift onto a new version by accident — at the cost of *not* getting upgrades automatically (you sit on older versions until someone explicitly bumps). Newest-compatible gives you the latest features and fixes within your range for free, at the cost of a moving target that demands a lockfile and can occasionally surprise you with a breaking "patch."

*Really testing:* that you can argue *both* directions, not just praise the one you prefer.

**B4. In npm, can two versions of the same package coexist? In cargo? Why does it matter?**

> In **npm/pnpm/yarn, yes** — the nested `node_modules` tree lets A get `D@2.1` and C get `D@2.4` simultaneously. So resolution rarely *fails*, but you can ship duplicate copies (bundle bloat) and break singletons ("two Reacts loaded" bugs). In **cargo (and Go), no** — one version per package, which is leaner but can produce a hard, unsatisfiable conflict you must resolve manually. It matters because it determines whether your failure mode is "resolution error" or "silent duplication."

*Really testing:* the structural flat-vs-nested distinction and its concrete consequences.

**B5. What is a transitive dependency, and why do npm graphs get so large?**

> A transitive dependency is a dependency *of* your dependency — you ask for A, A needs B, B needs C; the real dependency set is the transitive closure. npm graphs balloon because the JS ecosystem favors tiny single-purpose packages and allows multiple versions to coexist, so a handful of direct dependencies can pull in thousands of transitives, sometimes the same package at several versions.

*Really testing:* understanding of transitive closure and the cultural/structural reasons for npm's size.

---

## Group C — Caching

**C1. Why is the first build slow and the second build fast with no code change?**

> The first build populates the **build cache** — compiled crates/packages keyed by their inputs. The second build hashes the same inputs, finds matching cache entries, and reuses them instead of recompiling. Only changed inputs (and their dependents) are rebuilt.

*Really testing:* basic understanding that the cache keys on inputs.

**C2. What should a cache key contain, and what happens if it's incomplete?**

> It must contain **every input that affects the output**: source content, toolchain/compiler version, build flags, and the hashes of all dependencies. If it omits an input, you get a **false hit** — the cache returns a stale result that doesn't match the actual inputs, so the build "succeeds" with *wrong* output. That's the worst failure because nothing errors. Go and cargo compute keys from content automatically (hard to fool); Gradle makes you *declare* inputs, so under-declaration causes false hits — the origin of "clean build fixes it."

*Really testing:* the deepest caching insight — false hits, and why declared-input systems are fragile.

**C3. Why is sharing a remote build cache risky for a non-hermetic build?**

> A non-hermetic build's cache key omits some host-dependent input. A *local* false hit hurts one machine; a *shared/remote* false hit serves the wrong output to **everyone** pulling from the cache. So shared caching is only *safe* — not just fast — when the build is hermetic and the key captures all inputs.

*Really testing:* the connection between hermeticity and safe cache sharing — a senior/platform-level point.

**C4. Go has two caches — what are they and why separate?**

> The **module download cache** (`$GOMODCACHE`, default `$GOPATH/pkg/mod`) holds fetched source; the **build cache** (`$GOCACHE`, default `~/.cache/go-build`) holds compiled output keyed by content. Separate because they invalidate independently: a toolchain upgrade invalidates compiled output but not downloads; a dependency change invalidates both. `go clean -modcache` and `go clean -cache` target them separately.

*Really testing:* precise mental model of what gets cached where, not just "Go has a cache."

---

## Group D — Reproducibility & Hermeticity

**D1. Define reproducible and hermetic, and the relationship between them.**

> **Reproducible** = same inputs produce identical output bytes across time and machines (about version selection and ordering). **Hermetic** = the build depends *only* on declared inputs, sealed from the host — no reading `/usr/lib`, no ambient `$PATH`, no mid-build network. Reproducing *everywhere* requires hermeticity, because any undeclared host dependency can differ between machines and change the output. You can be reproducible-here-by-luck without being hermetic; you cannot be reproducible-everywhere without it.

*Really testing:* that you keep two commonly-conflated terms distinct and know the implication direction.

**D2. Why are Go builds reproducible by default while npm builds historically weren't?**

> Go: MVS makes version selection a deterministic pure function, `go.sum` enforces integrity, the build cache keys on content, and `-trimpath` strips paths so even the binary is bit-identical. npm historically: no lockfile before v5, floating ranges (a moving target), install-order-dependent `node_modules` tree shape, and host-dependent lifecycle scripts. The fixes — `package-lock.json`, `npm ci`, SRI hashes, pnpm's content store — closed most of the gap, but the *defaults* still differ: a fresh `go build` reproduces; a fresh `npm install` reproduces only with a committed lock *and* `npm ci`.

*Really testing:* the flagship case study, and whether you frame it as "defaults" not "achievable."

**D3. Why is "reproducibility is a property of defaults" the better framing?**

> Because teams get the *default* behavior at scale, not the best achievable behavior. npm *can* be made reproducible, but if a junior runs the obvious `npm install`, they don't get it. What the naive command produces is the real-world property you operate. Evaluating a tool means asking "what happens when someone does the naive thing?"

*Really testing:* operational maturity — judging tools by real-world defaults, not best-case potential.

**D4. Where does Go's reproducibility leak?**

> **cgo.** Pure-Go is nearly hermetic — Go ships its own toolchain and selects versions algorithmically. The moment you enable cgo, the build depends on the host C toolchain and headers, and the "reproducible/hermetic" guarantee weakens. Also `-ldflags` can inject timestamps/paths unless you strip them (`-buildid=`, `-trimpath`).

*Really testing:* depth — knowing the *exception* shows you understand the rule rather than reciting "Go is reproducible."

---

## Group E — Supply Chain & Security

**E1. How can "adding a dependency" run code on your machine?**

> Through install/build-time execution: Rust `build.rs` (runs before your crate), npm lifecycle scripts (`preinstall`/`install`/`postinstall` on `npm install`), Python `setup.py` / build backends, and Gradle build scripts/plugins. So `npm install` and `cargo build` literally execute third-party code. Defenses: `npm ci --ignore-scripts`, pnpm denying dependency scripts by default, and auditing new dependencies.

*Really testing:* awareness that install ≠ passive download — the seed of the whole supply-chain topic.

**E2. Express supply-chain risk as a formula and compare Go and npm.**

> Risk ≈ (namespace structure) × (transitive count) × (does install run code). **Go**: URL-based import paths (you can't typosquat a domain you don't own), lean graphs, no install-time code → low on all three. **npm**: flat global namespace (typosquat-friendly), thousands of transitives, auto-run lifecycle scripts → high on all three. The product predicts incident rate, which is why the famous incidents (`event-stream`, left-pad, `colors`/`faker`) are npm incidents.

*Really testing:* whether you can reason about risk structurally rather than as vibes.

**E3. Explain a dependency-confusion attack and how to prevent it.**

> An attacker publishes a package to the *public* registry using the same name as a company's *private* package, at a higher version. A resolver that checks both registries and prefers the highest version fetches the *attacker's* package, whose `postinstall` runs malicious code (e.g., exfiltrating env vars). Prevent it by (a) **scoping** internal packages (`@org/`-scoped npm, your-domain Go paths, your groupId), and (b) configuring the resolver so scoped names resolve from the **private registry only** — never public-wins. Resolution configuration is a security control.

*Really testing:* a real, famous attack class and the exact config that defeats it.

**E4. How do you keep a dependency graph secure over time at org scale?**

> Audit continuously against vulnerability databases (`govulncheck` — note it checks *reachability*, not just presence — `cargo audit`, `npm audit`, `pip-audit`, OWASP Dependency-Check) and gate CI on *new* advisories. Enforce the lockfile in CI (no drift), pin the *toolchain* too (an unpinned compiler is an unpinned input). Use update bots (Dependabot/Renovate) for small, frequent, tested bumps over big-bang upgrades, and require human review for *new direct* dependencies — that's where new transitive surface and install-time code enter. At higher maturity, add provenance (SLSA) and signing.

*Really testing:* an operational security program, not a single command.

---

## Group F — Tool-Specific Gotchas

**F1. `npm install` vs `npm ci` — when and why?**

> `npm install` may *mutate* the lockfile to reconcile with `package.json` and is fine for local dev. `npm ci` installs the lockfile **exactly**, errors if it disagrees with `package.json`, and wipes `node_modules` first — deterministic, for CI. Using `install` in CI is the classic cause of non-reproducible pipelines.

*Really testing:* a daily-driver distinction with real CI consequences.

**F2. Why turn off the Gradle daemon in CI?**

> The daemon is a persistent JVM that speeds *repeated local* builds. CI often reuses runners, so the daemon survives across builds, accumulating leaked memory and classloaders until a build inherits a near-dead daemon and OOMs — intermittently and unreproducibly. `--no-daemon` (with bounded `-Xmx`) in CI. A local optimization becomes a CI liability.

*Really testing:* whether you understand environment-dependent behavior, a hallmark of real ops experience.

**F3. Why is Python packaging considered "hard"?**

> Several reasons compound: historically no real lockfile (`requirements.txt` is half-manifest/half-lock and only pins what you froze, often just direct deps); two artifact formats (**sdist** = source you must compile vs **wheel** = prebuilt binary), so installs can *native-compile against the host's C libraries* — non-hermetic, and the reason "built in CI, broke in prod" happens; the global flat PyPI namespace (dependency-confusion/typosquat surface); and a fragmented tool landscape (`pip`, `poetry`, `uv`, conda) reflecting the unsolved-ness. `poetry` and `uv` add real lockfiles + hashes; `uv` also adds speed.

*Really testing:* synthesis — can you explain *why* an ecosystem is painful, not just complain that it is.

**F4. Why do teams switch from npm/yarn to pnpm?**

> Two reasons. **Disk/perf:** pnpm's content-addressed store keeps each package version *once* globally and links it into `node_modules`, versus npm/yarn copying it per project — huge savings across many repos. **Correctness:** pnpm's strict `node_modules` forbids *phantom dependencies* (importing a package you didn't declare but that happened to be hoisted), which surfaces latent bugs. The migration cost is that pnpm *finds* those phantom imports as errors on day one.

*Really testing:* understanding the content-addressed store and the phantom-dependency problem.

**F5. What does `build.rs` do and why is it both useful and dangerous?**

> `build.rs` is a Rust build script compiled and *executed* before the crate — used to compile bundled C code, generate bindings (e.g. from a `.proto` or C header), or probe the system, emitting cache hints like `cargo:rerun-if-changed=...`. Useful for native interop; dangerous because it runs arbitrary code with your permissions during `cargo build`, so a compromised dependency's `build.rs` is code execution on your machine and in CI.

*Really testing:* concrete knowledge of a specific mechanism and its dual nature.

---

## Group G — Polyglot & Scaling

**G1. When does a language tool stop scaling, and what do you reach for?**

> When the build graph **crosses language boundaries** (a `.proto` shared by Go, TS, and Python — no language tool can model "rebuild the TS client when the schema changes"), when you can't get correct incremental/shared caching across the whole repo (each tool owns only its own graph), and when non-hermeticity makes a shared remote cache unsafe. You reach for a **polyglot, hermetic build system** — Bazel, Buck2, Pants, or Nix — which gives one cross-language dependency graph, sandboxed hermetic execution, and content-addressed caching safe to share org-wide.

*Really testing:* the senior-level scaling-ceiling argument — and that the reason is *cross-language correctness + safe caching*, not raw speed.

**G2. You inherit a repo with `go.mod`, `package.json`, and `pyproject.toml`. How do you run CI?**

> One independently-cached, independently-gated step per tool, parallelized: `go build`/`go mod verify` + `govulncheck`; `npm ci` + `npm audit`; `uv sync --frozen` + `pip-audit`. Each cache keyed on its own lockfile. The risk concentrates at the **cross-language seams** — shared schemas/generated code that no single tool owns — so I'd add a thin orchestration layer (Make/Task) to sequence "regenerate, then build," and watch it for staleness bugs. If that glue's cost grows, that's the signal to evaluate Bazel.

*Really testing:* practical polyglot operation and recognizing the seams as the risk.

**G3. Why is "adopt Bazel to make builds faster" often the wrong reason?**

> Bazel's real payoff is *cross-language correctness* and *safe org-wide caching at scale*. In a single-language repo with a good native tool (`cargo`, `go`), you pay Bazel's full ergonomic cost — re-describing the build in `BUILD` files, wrapping the toolchain, abandoning `cargo build` — for little benefit, since the native tool already caches and resolves well. Migrate for the scaling/correctness reason, not for speed alone.

*Really testing:* judgment — resisting cargo-culting a powerful tool into the wrong context.

---

## Scenario Questions

**S1. A new hire clones the repo, runs the install, and gets a different dependency version than everyone else. Walk me through diagnosis and fix.**

> First check: is the **lockfile committed**? If not, that's the bug — the manifest's ranges resolved to a newer version published since others installed; commit the lockfile. If it *is* committed, check whether they ran the **lenient install** (`npm install`) which can re-resolve, instead of the **clean install** (`npm ci`) — enforce the clean variant. Also check the **build-tool version** is pinned (mixed npm versions re-derive lockfiles differently). Fix: commit lockfile + enforce `npm ci` in CI + pin the tool version via `engines`/Volta/corepack.

**S2. CI passes intermittently — same commit, sometimes green, sometimes OOM. No one can reproduce locally. Where do you look?**

> Intermittent + commit-independent + not-local-reproducible points at **shared mutable state on reused runners**. Prime suspect: the **Gradle daemon** persisting across builds and leaking memory until a build inherits a dying daemon. Fix: `--no-daemon` in CI, bound `-Xmx`. More generally, audit anything stateful across builds on reused runners (leftover caches, leftover processes).

**S3. A Python service installs cleanly in CI but crashes on startup in production with a missing shared library. Diagnose.**

> `pip` installed from an **sdist** and native-compiled an extension against the *CI host's* C libraries (which had the dev headers). The slim prod image lacks the matching `.so`, so the import fails at load time — a non-hermetic build where build host ≠ run host. Fix: install **prebuilt wheels** for the *production* platform (pin platform tags) so no host compilation happens, or ensure the prod image carries the required shared libraries. This is Python's hermeticity weakness in action.

**S4. Security flags that an internal package name also exists on the public registry at a higher version. What's the risk and the fix?**

> Classic **dependency confusion** setup: if the resolver checks both registries and prefers the highest version, builds may fetch the attacker's public package, whose `postinstall` runs malicious code. Fix immediately: scope the internal package and configure the resolver to fetch that scope from the **private registry only** (no public fallback for internal names); claim/reserve the public name defensively; and route public dependencies through a proxy you can block packages on.

**S5. Your monorepo's CI takes 40 minutes, almost all spent rebuilding things that didn't change. What's the path forward?**

> First, exploit each tool's own caching: cache download + compile caches, key on the lockfile, warm-base fallback, and consider remote/shared caching (`sccache`, Gradle remote cache) — but only if the builds are hermetic enough that shared cache hits are *safe*. If the waste is *cross-language* redundant rebuilds that no single tool can prune (because none owns the unified graph), that's the scaling ceiling — evaluate a hermetic polyglot system (Bazel/Buck2) with content-addressed remote caching and remote execution. Diagnose whether the bottleneck is within-tool (tune caching) or cross-tool (consider Bazel) before spending the migration cost.

---

## Rapid-Fire Round

> One-line answers; the interviewer is checking breadth and reflexes.

- **`go.mod` vs `go.sum`?** Manifest (required minimum versions) vs integrity checksums.
- **Caret `^1.2.3`?** `>=1.2.3 <2.0.0` (minor+patch).
- **Tilde `~1.2.3`?** `>=1.2.3 <1.3.0` (patch only).
- **`npm ci` in one line?** Install the lockfile exactly, fail on drift, wipe `node_modules` first — for CI.
- **MVS in five words?** Max of the required minimums.
- **Why commit the lockfile?** Reproducible builds across people and machines.
- **`cargo build --locked`?** Fail if `Cargo.lock` would need to change.
- **Where's cargo's compile output?** `target/`.
- **pnpm's superpower?** Content-addressed store: one copy per version, shared across projects.
- **What runs code at install time?** `build.rs`, npm lifecycle scripts, `setup.py`, gradle scripts.
- **sdist vs wheel?** Source-you-compile vs prebuilt binary.
- **Reproducible vs hermetic?** Same-bytes-out vs depends-only-on-declared-inputs.
- **`--no-daemon` in CI because?** The persistent JVM leaks memory on reused runners → OOM.
- **Dependency confusion fix?** Scope internal packages, resolve them from the private registry only.
- **When leave the language tool for Bazel?** Cross-language deps + safe org-wide caching at scale.
- **`govulncheck` vs `npm audit`?** Reachability-based (low false positives) vs presence-based.

---

## Cheat Sheet

```
MANIFEST vs LOCK     intent (you edit) vs realized graph + hashes (tool generates); commit both
MVS                  max of required minimums; deterministic, no solver; go.sum = integrity only
NEWEST-COMPATIBLE    highest in range; moving target → lockfile mandatory (cargo/npm/pip)
FLAT vs NESTED       npm: many versions coexist (no fail, bloat) ; go/cargo: one version (can conflict)
CACHE KEY            must hash ALL inputs; miss → false hit (stale wrong output); Gradle declares inputs
HERMETIC enables     safe SHARED caching (non-hermetic shared cache poisons the whole org)
REPRO = DEFAULTS     Go reproduces on naive command; npm needs committed lock + npm ci
SUPPLY-CHAIN RISK    namespace × transitives × install-runs-code ; Go low, npm high
DEP CONFUSION FIX    scope internal pkgs + private-registry-only resolution (no public-wins)
CI = STRICT VARIANT  npm ci / cargo --locked / uv sync --frozen / gradle --no-daemon
PYTHON HARD          weak lock + sdist-compiles-on-host (non-hermetic) + flat PyPI + fragmented tools
SCALING CEILING      cross-language graph + safe org-wide cache → Bazel/Buck2/Pants/Nix
```

---

## Summary

- **Manifest vs lockfile** (intent vs realized graph, authored vs generated) is the warm-up; the depth is in *why* you commit it, the library-vs-application nuance, and never hand-editing the generated file.
- **Resolution** is the centerpiece: state **MVS** precisely (max of required minimums, deterministic, no solver) against **newest-compatible** (highest in range, moving target, lockfile-mandatory), and explain why `go.sum` is integrity-only while `Cargo.lock` pins versions.
- **Caching** answers hinge on the **cache key**: it must hash every input, false hits are the worst failure, and hermeticity is what makes a *shared* cache safe — not just fast.
- **Reproducibility vs hermeticity** are distinct (same-bytes vs sealed-from-host); reproducing everywhere requires hermeticity; and reproducibility is a property of *defaults*, which is why Go reproduces naively and npm historically didn't.
- **Supply chain** = namespace × transitives × install-runs-code; know dependency confusion end-to-end and its scoping/private-registry fix, and that install literally executes third-party code.
- **Tool-specific gotchas** (`npm ci`, `--no-daemon`, why Python is hard, pnpm's store, `build.rs`) and the **polyglot scaling ceiling** (cross-language graph + safe org-wide caching → Bazel) round out the senior signal. Lead with the principle, name the trade-off, and reason from the universal shape when you hit a tool you don't know.

---

## Related Topics

- [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md) — the four tiers these questions draw from.
- [06 — Dependency Management](../06-dependency-management/middle.md) — resolution and registries as a dedicated topic.
- [07 — Build Caching](../07-build-caching/senior.md) — cache-key correctness in depth.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — the reproducibility discipline behind Group D.
- [05 — Polyglot / Hermetic Builds](../05-polyglot-hermetic-builds/junior.md) — the Bazel destination behind Group G.
