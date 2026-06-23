# Per-Language Tools — Middle Level

> **Roadmap:** [Build Systems](../README.md) → Per-Language Tools
> *The junior page said "the tool resolves versions." This page asks the hard question: resolves them* how*? Go's MVS picks the* minimum *that satisfies everyone; npm and cargo pick the* maximum *compatible. That one design choice ripples into lockfiles, transitive deps, and every "dependency hell" story you've ever heard.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Semver and Version Ranges — the Language of Intent](#semver-and-version-ranges--the-language-of-intent)
4. [Transitive Dependencies and the Resolution Problem](#transitive-dependencies-and-the-resolution-problem)
5. [Two Philosophies — Go's MVS vs Newest-Compatible (npm/cargo)](#two-philosophies--gos-mvs-vs-newest-compatible-npmcargo)
6. [Lockfile Semantics Across Tools](#lockfile-semantics-across-tools)
7. [Where the Caches Actually Live](#where-the-caches-actually-live)
8. [Workspaces and Monorepos, Per Tool](#workspaces-and-monorepos-per-tool)
9. [Build Scripts and Their Risks](#build-scripts-and-their-risks)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do these tools actually pick versions — and why do the answers differ so much?**

At the junior level the tool was a vending machine: you ask for a library, it fetches one. But what version, exactly? Your manifest says `^1.2.0` ("compatible with 1.2.0"). Your dependency *also* depends on the same library, but says `^1.4.0`. Some third library says `1.3.x`. Three constraints, one library — what gets installed?

That is the **dependency resolution problem**, and it is the deep difference between these tools. They look alike at the command line and diverge completely underneath. Go solved it with **Minimum Version Selection (MVS)** — deliberately boring, deterministic, no solver. npm and cargo use a **newest-compatible** strategy that resolves a constraint graph and prefers the highest version that satisfies everyone. These choices explain why Go upgrades feel sleepy and predictable while npm upgrades feel like rolling dice.

This page also opens three boxes the junior page left closed: what semver ranges *actually mean*, where each tool hides its cache, and the quietly dangerous feature every ecosystem has — **arbitrary code that runs during install** (`build.rs`, npm `postinstall`, gradle plugins).

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) — manifest vs lockfile, the four questions.
- **Required:** You've added a dependency in at least one ecosystem and seen its lockfile change.
- **Helpful:** You've hit a version conflict ("peer dependency" warning, "incompatible versions") and didn't fully understand it.
- **Helpful:** A rough sense of a graph (nodes and edges) — dependencies form one.

---

## Semver and Version Ranges — the Language of Intent

Most ecosystems use **semantic versioning**: `MAJOR.MINOR.PATCH`, e.g. `2.31.0`.

| Part | Bumped when… | Promise |
|---|---|---|
| **MAJOR** (2.x.x) | a breaking change | "this may break your code" |
| **MINOR** (x.31.x) | a backward-compatible feature | "new stuff, your code still works" |
| **PATCH** (x.x.0) | a backward-compatible bug fix | "safe, just fixes" |

Your manifest expresses *which range of versions you'll accept* using operators. The notation differs by tool but the intent is shared:

```toml
# Cargo / npm style "caret": compatible-within-major
serde = "1.2.3"        # cargo: means ^1.2.3 → >=1.2.3, <2.0.0
"react": "^18.2.0"     # npm:   >=18.2.0, <19.0.0
"lodash": "~4.17.21"   # npm tilde: >=4.17.21, <4.18.0 (patch-level only)
```

```
^1.2.3   → >=1.2.3 and <2.0.0     (allow minor+patch; the npm/cargo default)
~1.2.3   → >=1.2.3 and <1.3.0     (allow patch only)
1.2.3    → exactly 1.2.3          (pin)
>=1.2,<2 → an explicit range
*        → anything (do not do this)
```

**Go is the odd one out.** A `go.mod` requirement like `require github.com/foo/bar v1.4.0` is **not a range** — it's a *minimum*. Go's manifest says "I need at least 1.4.0," and the resolver, by design, won't jump to 1.5.0 on its own. This is the first hint of MVS.

> **Key insight:** semver is a *promise from the library author*, and version ranges are *how much of that promise you trust*. `^` says "I trust the author not to break me within a major version." When that trust is misplaced — a "patch" that breaks you — you get a surprise build failure with no code change on your side. Ranges are convenience bought with risk.

---

## Transitive Dependencies and the Resolution Problem

You depend on A. A depends on B and C. B depends on D. C *also* depends on D — but a different version. Your real dependency set is the **transitive closure**: A, B, C, D, and everything *they* pull in. A typical npm app has *thousands* of transitive packages from a handful of direct ones.

```
your app
 ├── A  ^1.0      → needs D ^2.1
 └── C  ^3.0      → needs D ^2.4
                    ↑ two demands on D — what version of D wins?
```

This is the resolution problem: given a graph of overlapping version constraints, choose a concrete version for every package such that **every constraint is satisfied** (or report that it's impossible — a *conflict*). How a tool answers shapes everything downstream.

Two structural answers exist:

- **One shared version per package** (a *flat* graph). Go and (mostly) cargo do this: there is exactly one `D` in the build, and it must satisfy everyone. Cleaner, smaller, but a hard conflict if no single version works.
- **Multiple versions can coexist** (a *nested* graph). npm/pnpm/yarn allow A to get `D@2.1` and C to get `D@2.4` *simultaneously*, nested in `node_modules`. Almost never a hard conflict — but you can ship three copies of the same library, and "two Reacts loaded" bugs become possible.

> **Key insight:** "can two versions of the same package coexist?" is a fork in the road. JavaScript says yes (so resolution rarely *fails*, but your bundle bloats and singletons break). Most other ecosystems say no (so resolution is leaner but can *fail* with an unsatisfiable conflict you must resolve by hand). Neither is free.

---

## Two Philosophies — Go's MVS vs Newest-Compatible (npm/cargo)

This is the heart of the page.

**Newest-compatible (npm, cargo, pip, maven-ish).** Given `^1.2.0`, pick the *highest* version that fits — if 1.9.4 exists and satisfies the range, use 1.9.4. The resolver explores the constraint graph (cargo and modern pip use a real backtracking SAT-style solver) to find a maximal assignment that satisfies everyone.

- **Pro:** you automatically get the latest features and fixes within your range.
- **Con:** the result is a moving target. The *same manifest* resolves differently next week because a new version was published. This is exactly why the **lockfile is mandatory** — without it, your build is non-deterministic. Resolution can also be slow, and it can *fail* (unsatisfiable) or, worse, succeed with a surprising upgrade.

**Minimum Version Selection — MVS (Go only, by Russ Cox).** Given that you require *at least* 1.2.0 and a dependency requires *at least* 1.4.0, MVS selects **1.4.0** — the *minimum version that satisfies all the "at least" constraints*. It takes the *maximum of the minimums*, never the latest available.

```
You require:        D >= 1.2.0
Dependency A wants: D >= 1.4.0
Dependency B wants: D >= 1.3.0
─────────────────────────────────
MVS picks:          D 1.4.0   (highest of the required minimums — NOT the latest 1.9.x)
```

- **No solver, no backtracking, no SAT.** It's a graph walk that takes the max of the required versions. Deterministic by construction.
- **Builds are reproducible *without even needing the lockfile to choose versions*** — `go.sum` records *hashes* for integrity, not version *choices*. Given the same `go.mod` files, MVS always picks the same versions, forever, on every machine.
- **Upgrades are explicit.** You don't drift onto 1.9.x by accident; you stay on the minimum until *someone deliberately* runs `go get foo@latest` and bumps the requirement. "High fidelity" builds: what you tested is what ships.
- **Trade-off:** you may sit on older versions longer; you don't get free upgrades. Most Go engineers consider this a feature.

> **Key insight:** npm/cargo optimize for *getting the newest compatible code automatically* (and lean on the lockfile to pin the moving target). Go optimizes for *never surprising you* (the lockfile only verifies integrity; version choice is already deterministic). When a Go build "feels boring and predictable" and an npm build "feels like it changed under me," this design difference is the cause.

---

## Lockfile Semantics Across Tools

All lockfiles freeze the resolved graph, but they differ in *what* they freeze and *how authoritative* they are.

| Tool | Lockfile | Records | Authoritative for installs? |
|---|---|---|---|
| **Go** | `go.sum` | hashes of module *content* (integrity), not version choice | versions come from MVS; `go.sum` verifies them |
| **Cargo** | `Cargo.lock` | exact versions + checksums of full graph | yes — `cargo build` respects it |
| **npm** | `package-lock.json` | exact versions + integrity + the *tree shape* | yes, but `npm install` may mutate it; `npm ci` won't |
| **pnpm** | `pnpm-lock.yaml` | exact versions + content hashes, flat | yes |
| **Python (poetry/uv)** | `poetry.lock` / `uv.lock` | exact versions + hashes | yes |
| **Python (pip)** | `requirements.txt` | whatever you froze (often *not* a true lock) | only if you pinned `==` everything |

Two practical distinctions that bite people:

1. **`install` vs `ci` (clean install).** `npm install` may *update* the lockfile if the manifest drifted — great locally, dangerous in CI. `npm ci` installs *exactly* the lockfile, fails if it disagrees with `package.json`, and deletes `node_modules` first. **Rule: use the clean-install variant in CI** (`npm ci`, `cargo build --locked`, `go build` is already deterministic, `poetry install`/`uv sync` against the lock).

2. **Go's lockfile is not a version lock.** `go.sum` is a *checksum database* — it can't change which version you get (MVS already decided that), it only proves the bytes weren't tampered with. This is why Go feels lockfile-light: the determinism lives in the *algorithm*, not the file.

```bash
cargo build --locked      # fail if Cargo.lock would need to change
npm ci                    # install exactly the lockfile; error on drift; for CI
poetry install --sync     # match the environment to poetry.lock exactly
uv sync --frozen          # install from uv.lock without re-resolving
go mod verify             # check downloaded modules match go.sum
```

---

## Where the Caches Actually Live

Knowing cache locations is what turns "CI is slow / disk is full / build is flaky" from a mystery into a one-line fix. (Strategy is [07 — Build Caching](../07-build-caching/senior.md); locations are here.)

| Tool | Download cache (fetched packages) | Compile/build cache (compiled output) |
|---|---|---|
| **Go** | `$GOMODCACHE` (default `$GOPATH/pkg/mod`) | `$GOCACHE` (default `~/.cache/go-build`) |
| **Cargo** | `~/.cargo/registry` (sources + index) | per-project `target/` (and optional `sccache`) |
| **npm** | `~/.npm` (tarball cache) | n/a (interpreted) — output is `node_modules/` |
| **pnpm** | `~/.local/share/pnpm/store` (content-addressed) | n/a — `node_modules` is *links* into the store |
| **Python pip** | `~/.cache/pip` (wheels) | n/a — installed into the env |
| **Gradle** | `~/.gradle/caches/modules-2` | `~/.gradle/caches/build-cache-1` + project `build/` |
| **Maven** | `~/.m2/repository` (the *local repo* — both cache and resolution source) | per-module `target/` |

A few notes worth internalizing:

- **Two different caches in Go and Cargo.** "Downloaded source" and "compiled artifact" are separate. Clearing one doesn't clear the other. `go clean -modcache` (downloads) is different from `go clean -cache` (compiled).
- **pnpm's content-addressed store is special.** It stores each package *version* once on disk, globally, and `node_modules` becomes hard-links/symlinks into that store. Ten projects using the same `lodash@4.17.21` share *one* copy on disk — versus npm/yarn copying it ten times. This is the single biggest reason teams switch to pnpm.
- **Maven's `~/.m2` is both cache and source of truth for resolution.** Corrupt it and resolution breaks; this is the origin of countless "delete `~/.m2` and try again" support tickets.

---

## Workspaces and Monorepos, Per Tool

Once you have more than one package in one repo, you want them to share dependencies and build together. Every tool has a **workspace** concept for this.

```toml
# Cargo workspace — Cargo.toml at the repo root
[workspace]
members = ["crates/api", "crates/core", "crates/cli"]
resolver = "2"
```

```bash
go work init ./api ./core ./cli     # Go workspaces → creates go.work
```

```json
// npm / pnpm workspace — package.json (npm) or pnpm-workspace.yaml (pnpm)
{ "workspaces": ["packages/*"] }
```

| Tool | Workspace mechanism | What it shares |
|---|---|---|
| **Cargo** | `[workspace]` in root `Cargo.toml` | one `Cargo.lock`, one `target/`, unified resolution |
| **Go** | `go.work` (`go work init`/`use`) | local module replacement for multi-module dev |
| **npm/yarn** | `"workspaces"` in `package.json` | hoisted `node_modules`, cross-package linking |
| **pnpm** | `pnpm-workspace.yaml` | shared store, strict per-package `node_modules` |
| **Gradle** | multi-project `settings.gradle` | shared config, inter-project task dependencies |
| **Maven** | parent POM + `<modules>` | inherited config, reactor build order |

The shared payoff: **one resolution, one lockfile, one set of dependency versions across all your packages**, and the tool figures out the build order between them. The catch is that workspace support is where these tools stop being trivial — and where, at large enough scale, teams abandon the language tool entirely for [05 — Polyglot / Hermetic builds](../05-polyglot-hermetic-builds/junior.md) (Bazel and friends). That ceiling is a senior-level topic.

---

## Build Scripts and Their Risks

Here is the feature nobody warns juniors about: **installing a dependency can run arbitrary code on your machine.**

- **Rust `build.rs`** — a build script compiled and *executed* before your crate, used to compile C code, generate bindings, probe the system. It runs with your user's permissions.
- **npm lifecycle scripts** — `preinstall`, `install`, `postinstall` in a package's `package.json` run automatically during `npm install`. A malicious package can run anything here.
- **Python `setup.py`** — historically executed arbitrary Python at install time (the reason `pip` is moving toward declarative `pyproject.toml` and prebuilt wheels).
- **Gradle build scripts** — `build.gradle` *is* executable Groovy/Kotlin; a malicious plugin runs in your build.

```rust
// build.rs — runs at build time, before your crate compiles
fn main() {
    cc::Build::new().file("src/native.c").compile("native");  // shells out to a C compiler
    println!("cargo:rerun-if-changed=src/native.c");          // cache invalidation hint
}
```

```json
// a package.json with a postinstall hook — runs on `npm install`
{ "scripts": { "postinstall": "node ./scripts/setup.js" } }
```

These features are *useful* — `build.rs` compiles native code, `postinstall` builds platform binaries. They are also a **supply-chain attack surface**: a compromised transitive dependency can execute on your laptop and in CI the instant you install. Defensive moves:

```bash
npm install --ignore-scripts        # install without running lifecycle scripts
npm ci --ignore-scripts             # CI variant
# pnpm: scripts of dependencies are NOT run by default unless allow-listed (a security default)
```

> **Key insight:** "adding a dependency" is not just "downloading code I'll call later." In most ecosystems it's "downloading code, *some of which executes immediately* during install/build." That is the seed of dependency-confusion and typosquatting attacks. The full supply-chain treatment is at the senior level; the awareness starts now.

---

## Mental Models

- **MVS = "max of the minimums"; newest-compatible = "max within the ranges."** Go takes the highest version *anyone requires as a floor* and stops. npm/cargo take the highest version *the ranges still allow*. One is anchored to what's declared; the other chases what's published.

- **The lockfile's job depends on the resolver.** Where resolution is non-deterministic (npm/cargo: depends on what's published *now*), the lockfile is *load-bearing* — it pins the moving target. Where resolution is deterministic (Go MVS), the lockfile is *just integrity* — version choice was never in doubt.

- **`node_modules` is a tree; everything else is a list.** npm allows the same package at many versions in many places (a tree of copies). Go/cargo/pnpm-store keep one version per package (a list). Tree → never conflicts but bloats; list → lean but can conflict.

- **Installing is executing.** Treat `npm install` / `cargo build` / `pip install` as "running untrusted code," because in the presence of lifecycle scripts and `build.rs`, that's literally what it is.

---

## Common Mistakes

1. **Assuming all tools resolve "the latest."** Go does *not* — MVS picks the minimum that satisfies the constraints. Expecting `go get` to behave like `npm update` leads to confusion when versions don't move.

2. **Using `npm install` in CI instead of `npm ci`.** `install` can silently mutate the lockfile; `ci` installs it exactly and fails on drift. Non-deterministic CI builds usually trace back to this.

3. **Treating a frozen `requirements.txt` as a real lockfile.** Unless you pinned `==` on *every transitive* package (not just direct ones), `pip install -r requirements.txt` can still drift. This is exactly why `poetry`/`uv` (with real lockfiles and hashes) exist.

4. **Forgetting that two versions of a package can coexist in npm.** "But I only installed one React!" — a transitive dependency pulled a second copy, and now your context-based singleton breaks. Check the resolved tree (`npm ls react`).

5. **Running install with scripts enabled on untrusted dependencies.** A `postinstall` or `build.rs` in a malicious package executes immediately. Audit new dependencies; consider `--ignore-scripts` and pnpm's deny-by-default.

6. **Editing the lockfile to "force a version."** Change the *manifest* and re-resolve. Hand-editing the lockfile produces a state the tool will "correct" on the next install, undoing your change.

---

## Test Yourself

1. Explain Go's MVS in one sentence. If you require `D>=1.2`, A requires `D>=1.4`, and B requires `D>=1.3`, which version does MVS pick?
2. How does npm/cargo's "newest-compatible" strategy differ, and why does it make the lockfile mandatory?
3. What does `^1.4.2` mean, and how is it different from `~1.4.2`?
4. Why is `go.sum` *not* the same kind of lockfile as `Cargo.lock`?
5. Why does `npm install` differ from `npm ci`, and which belongs in CI?
6. Name two ways "adding a dependency" can run code on your machine, and one way to prevent it.

<details>
<summary>Answers</summary>

1. MVS selects, for each module, the **maximum of the minimum versions** required across the whole dependency graph. With `D>=1.2`, `D>=1.4`, `D>=1.3`, it picks **1.4.0** (the highest required minimum) — *not* the latest published 1.x.
2. Newest-compatible picks the **highest version within each range** that satisfies all constraints. Because new versions get published over time, the same manifest resolves differently at different times — a moving target — so the lockfile is required to pin a specific, reproducible result.
3. `^1.4.2` allows `>=1.4.2, <2.0.0` (minor + patch upgrades). `~1.4.2` allows `>=1.4.2, <1.5.0` (patch only). Caret trusts minor releases; tilde trusts only patches.
4. `go.sum` records **content hashes for integrity**, not version *choices* — MVS already determines versions deterministically from the `go.mod` files. `Cargo.lock` records the **actual chosen versions** because cargo's resolution is non-deterministic without it.
5. `npm install` may **mutate** the lockfile to reconcile with `package.json`; `npm ci` installs the lockfile **exactly**, errors on any drift, and wipes `node_modules` first. Use **`npm ci`** in CI for deterministic builds.
6. (a) Rust `build.rs` runs at build time; (b) npm `postinstall`/lifecycle scripts run on install (also Python `setup.py`, Gradle scripts). Prevent with `--ignore-scripts` (npm) or a deny-by-default tool like pnpm, plus auditing new dependencies.

</details>

---

## Cheat Sheet

```
SEMVER RANGES
  ^1.2.3  >=1.2.3 <2.0.0   (minor+patch; npm/cargo default)
  ~1.2.3  >=1.2.3 <1.3.0   (patch only)
  1.2.3   exact pin
  Go:     "v1.2.3" means a MINIMUM, not a range

RESOLUTION PHILOSOPHIES
  Go      MVS: max of the required minimums   → deterministic, no solver, boring (good)
  cargo   newest-compatible + SAT-ish solver  → one version per pkg, lockfile pins it
  npm     newest-compatible, nested tree      → multiple versions coexist, lockfile pins
  pip     backtracking resolver (modern)      → needs real lockfile (poetry/uv) to pin

LOCKFILE = JOB DEPENDS ON RESOLVER
  non-deterministic resolver (npm/cargo/pip) → lockfile is LOAD-BEARING
  deterministic resolver (Go MVS)            → go.sum is INTEGRITY only

USE THE CLEAN/LOCKED VARIANT IN CI
  cargo build --locked   npm ci   poetry install --sync   uv sync --frozen   go mod verify

CACHE LOCATIONS
  Go     download: GOPATH/pkg/mod    compile: ~/.cache/go-build
  cargo  download: ~/.cargo/registry compile: ./target  (+ sccache)
  npm    ~/.npm        pnpm  ~/.local/share/pnpm/store (content-addressed, shared)
  pip    ~/.cache/pip  maven ~/.m2/repository  gradle ~/.gradle/caches

INSTALL RUNS CODE
  build.rs (Rust)  postinstall (npm)  setup.py (Python)  build.gradle (JVM)
  defend: npm ci --ignore-scripts ; pnpm denies dep scripts by default ; audit new deps
```

---

## Summary

- **Semver ranges express trust**: `^` accepts minor+patch, `~` accepts patch, an exact version pins. Go is the exception — its requirements are *minimums*, not ranges.
- A real dependency set is the **transitive closure** of overlapping constraints. The structural question "can two versions of one package coexist?" splits the ecosystems: npm says yes (nested tree, rarely fails, bloats); Go/cargo/pnpm say one shared version (lean, can conflict).
- **Go's MVS picks the max of the required minimums** — deterministic, solver-free, surprise-free; `go.sum` is integrity-only. **npm/cargo pick the newest compatible** — features for free, but a moving target, so the **lockfile is mandatory** to pin it.
- Use the **clean/locked install variant in CI** (`npm ci`, `cargo build --locked`, `uv sync --frozen`) so the build reproduces the lockfile exactly.
- Know **where each cache lives** — download vs compile caches are separate in Go/Cargo; pnpm's content-addressed store dedupes across all projects; Maven's `~/.m2` is both cache and resolution source.
- **Workspaces** unify resolution, lockfile, and build order across multiple packages in one repo — and mark the point where tools start getting complex.
- **Installing a dependency executes code** (`build.rs`, npm `postinstall`, `setup.py`, gradle scripts) — useful and a supply-chain risk. Awareness now; defenses (audit, `--ignore-scripts`, deny-by-default) deepen at the senior level.

The senior page puts all five tools in one comparison matrix and asks the questions that decide architecture: which builds are *reproducible* and *hermetic* by default, where the supply-chain surface really is, and at what scale a language tool breaks and you reach for Bazel.

---

## Further Reading

- [Minimal Version Selection](https://research.swtch.com/vgo-mvs) — Russ Cox's original essay. The clearest argument for *why* Go chose MVS over a solver. Essential.
- [The Cargo Book — Dependency Resolution](https://doc.rust-lang.org/cargo/reference/resolver.html) — how cargo's solver and `Cargo.lock` actually work.
- [npm — `package-lock.json` & `npm ci`](https://docs.npmjs.com/cli/v10/commands/npm-ci) — install vs ci semantics, spelled out.
- [pnpm — Motivation](https://pnpm.io/motivation) — why a content-addressed store beats copying `node_modules` everywhere.
- [Semantic Versioning 2.0.0](https://semver.org/) — the spec behind every range operator.

---

## Related Topics

- [junior.md](junior.md) — manifest vs lockfile, the four questions, the universal shape.
- [senior.md](senior.md) — the full comparison matrix, reproducibility/hermeticity per tool, and when to leave the language tool for Bazel.
- [06 — Dependency Management](../06-dependency-management/middle.md) — resolution, registries, and version selection as a topic in its own right.
- [07 — Build Caching](../07-build-caching/senior.md) — strategy on top of the cache locations listed here.
- [05 — Polyglot / Hermetic Builds](../05-polyglot-hermetic-builds/junior.md) — what you reach for when one-language workspaces stop scaling.
