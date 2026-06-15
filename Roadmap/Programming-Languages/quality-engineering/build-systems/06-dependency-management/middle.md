# Dependency Management — Middle Level

> **Roadmap:** [Build Systems](../README.md) → Dependency Management
> *The junior page said "the tool picks versions." This page is about how it picks: constraint satisfaction, the diamond conflict, what a lock file really contains — and why Go deliberately chose the opposite strategy to npm and cargo.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Constraint Semantics — `^`, `~`, and the Exact Boundaries](#constraint-semantics----and-the-exact-boundaries)
4. [Resolution as Constraint Satisfaction](#resolution-as-constraint-satisfaction)
5. [The Diamond Problem and How Ecosystems Resolve It](#the-diamond-problem-and-how-ecosystems-resolve-it)
6. [What a Lock File Actually Contains](#what-a-lock-file-actually-contains)
7. [Newest-Compatible vs Minimum Version Selection](#newest-compatible-vs-minimum-version-selection)
8. [Reproducible Installs in Practice](#reproducible-installs-in-practice)
9. [Mental Models](#mental-models)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does a tool turn a pile of version ranges into one concrete set of versions — and why do different ecosystems disagree on the answer?**

At the junior level resolution was a black box: "the tool picks versions that satisfy your ranges." That's true, but it hides every hard question. *Which* versions, when several satisfy the constraints? What happens when two dependencies demand *incompatible* versions of a third? Why does npm sometimes install two copies of the same package, while Go installs exactly one? And why does Go, almost alone, pick the *oldest* acceptable version instead of the newest?

These aren't trivia. They determine whether your build is reproducible, how big your dependency tree is, what breaks when you upgrade, and how an "obvious" version bump can cascade into a resolution failure. This page makes resolution concrete: the precise meaning of `^` and `~`, resolution as a search problem, the diamond conflict, the real anatomy of a lock file, and the deep split between **newest-compatible** (npm, cargo, pip) and **Minimum Version Selection** (Go).

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) — semver, ranges, transitive deps, lock files.
- **Required:** You've run `npm install` / `go get` / `cargo build` and seen a lock file change.
- **Helpful:** You've hit a version conflict and resolved it manually at least once.
- **Helpful:** Comfort reading a `go.mod`, `package-lock.json`, or `Cargo.lock`.

---

## Constraint Semantics — `^`, `~`, and the Exact Boundaries

Ranges look simple until an edge case bites. The two workhorses are **caret** (`^`) and **tilde** (`~`), and their exact boundaries matter.

**Caret (`^`) — "compatible within the same left-most non-zero number."** The intent is "anything that semver promises won't break me." For normal versions that means *same MAJOR*:

```
^1.2.3   →  >=1.2.3  <2.0.0     (any 1.x from 1.2.3 up)
^1.2.3   allows 1.9.0, 1.2.99   forbids 2.0.0
```

But the `0.x` rule trips people. Under semver, `0.x` is unstable, so caret tightens automatically:

```
^0.2.3   →  >=0.2.3  <0.3.0     (locks the MINOR — because 0.x minor bumps can break)
^0.0.3   →  >=0.0.3  <0.0.4     (locks the PATCH — 0.0.x is maximally unstable)
```

So `^0.2.3` behaves like a tilde, not a "same major" caret — because under `0.x` the *minor* is the breaking axis. This is the single most surprising range fact for engineers who only memorized "caret = same major."

**Tilde (`~`) — "PATCH-level updates only" (when a minor is specified):**

```
~1.2.3   →  >=1.2.3  <1.3.0     (only patches within 1.2.x)
~1.2     →  >=1.2.0  <1.3.0     (same — patches within 1.2.x)
~1       →  >=1.0.0  <2.0.0     (minor+patch within 1.x — degrades to caret-like)
```

Other ecosystems express the same ideas differently:

```toml
# Cargo: a bare version is implicitly caret
serde = "1.0.0"       # means ^1.0.0  → >=1.0.0 <2.0.0
serde = "=1.0.0"      # exact pin
serde = ">=1.2, <1.5" # explicit range
```

```python
# pip / PEP 440
requests >= 2.0, < 3.0      # explicit
requests ~= 2.31.0          # "compatible release": >=2.31.0, <2.32.0  (tilde-equals)
requests == 2.31.*          # any 2.31 patch
```

> **Key insight:** `^` and `~` are *shorthands for semver risk tolerance*. Caret says "I trust the major-version compatibility promise." Tilde says "I only trust patches." Both are bets *on semver holding* — they encode how much you trust the publisher to honour the contract. The boundaries shift for `0.x` precisely because semver moves the "breaking" axis there. Memorize the *intent* (which axis is allowed to move), not just the symbol.

---

## Resolution as Constraint Satisfaction

Given a manifest of ranges *and* the ranges of every transitive dependency, the resolver must find **one concrete version per package such that every constraint is satisfied simultaneously.** This is a search problem — closer to solving a logic puzzle than to "download the newest."

Consider:

```
your-app requires:  A ^1.0.0,  B ^2.0.0
A@1.5.0  requires:  C ^3.0.0
B@2.1.0  requires:  C ^3.2.0
```

The resolver must choose a `C` satisfying *both* `^3.0.0` (from A) and `^3.2.0` (from B). The intersection is `>=3.2.0 <4.0.0`, so it might pick `C@3.4.1`. It also had to choose *which* A and B (the newest in-range), and each choice changes the downstream constraints. Choosing `A@1.6.0` instead might demand `C ^3.5.0`, shifting the answer.

When constraints interact, the resolver may need to **backtrack**: try a version, discover it forces an unsatisfiable downstream constraint, undo it, and try an earlier one. This is why resolution can be slow, and why in the worst case it's equivalent to **boolean satisfiability (SAT)** — formally NP-hard. (The senior page treats the SAT reduction directly.) Modern resolvers — npm 7+'s arborist, Cargo's resolver, pip's 2020+ backtracking resolver, Dart's `pub` (which literally uses a SAT-based algorithm called PubGrub) — all do some form of constrained search with backtracking and good error reporting.

```bash
# When resolution FAILS, a good resolver explains the conflict:
# pip example:
#   ERROR: Cannot install foo==1.0 and bar==2.0 because these package
#   versions have conflicting dependencies:
#     foo 1.0 depends on urllib3<1.26
#     bar 2.0 depends on urllib3>=1.26
#   The conflict is caused by ...
```

> **Key insight:** Resolution is not "pick the newest of each." It is *find an assignment satisfying all constraints at once*, which can require backtracking and can be genuinely unsolvable. When you see "could not find a version that satisfies the requirements," the resolver isn't being difficult — it's reporting that the *intersection of all constraints is empty*. The fix is to relax a constraint somewhere, not to retry the install.

---

## The Diamond Problem and How Ecosystems Resolve It

The defining hard case is the **diamond**: two of your dependencies need *different* versions of a shared third dependency.

```
        your-app
        /        \
   lib-A          lib-B
   needs          needs
   left-pad@1.0   left-pad@2.0
        \        /
         left-pad   ← which version?? (the diamond's bottom)
```

There is no single right answer; ecosystems made *different design choices*, and the choice has large consequences:

**Strategy 1 — Allow multiple versions (nested), e.g. npm.** npm can install `left-pad@1.0` *inside* `lib-A`'s subtree and `left-pad@2.0` *inside* `lib-B`'s subtree. Both get the version they asked for. No conflict.

```
node_modules/
├── lib-A/
│   └── node_modules/left-pad/   (1.0)   ← A's private copy
├── lib-B/
└── node_modules/left-pad/       (2.0)   ← hoisted, shared by B and app
```

- **Pro:** conflicts almost never block the install. Each dependency gets what it wants.
- **Con:** *bloat* (multiple copies of the same library), *larger bundles*, and — the nasty one — **type/identity hazards**: an object created by `left-pad@1.0` is a *different type* from `left-pad@2.0`'s, so `instanceof` checks and shared global state break in ways that are baffling to debug.

**Strategy 2 — One global version (flat), e.g. Go, Maven (with mediation), and effectively cargo for a given major.** There can be *one* `left-pad` in the build. The resolver must find a single version satisfying everyone, or fail.

- **Pro:** no duplication, one identity, smaller and simpler. There's exactly one `left-pad` and everyone shares it.
- **Con:** the diamond can be *unsolvable* — if A truly needs `<2.0` and B truly needs `>=2.0`, there's no single version, and the build fails until someone upgrades or patches.

A subtlety: cargo and npm both allow *multiple major versions* to coexist (because a major bump is a different "package" identity-wise) but unify within a major. Go's `vX` major-version-in-import-path rule (`example.com/foo/v2`) makes this explicit — `foo` and `foo/v2` are *different modules* that can coexist, while two `v1.x` of `foo` cannot.

> **Key insight:** "Multiple versions allowed" vs "one global version" is the deepest architectural fork in dependency management. npm trades correctness hazards and bloat for install-success; Go/Maven trade occasional unsolvable conflicts for a single coherent dependency set. Neither is wrong — but you must know *which world you're in*, because it determines whether a diamond is a non-event (npm: two copies) or a hard stop (Go: resolve it or don't build).

---

## What a Lock File Actually Contains

A lock file is not just "the versions." It's a complete, verifiable snapshot of the resolved graph. Three things matter in every lock format:

```jsonc
// package-lock.json (npm v3 lockfile, trimmed)
"node_modules/lodash": {
  "version": "4.17.21",                                  // 1. EXACT resolved version
  "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",  // 2. WHERE it came from
  "integrity": "sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg=="  // 3. content HASH
}
```

```
# go.sum  (Go's checksum file — note: go.mod holds versions, go.sum holds hashes)
golang.org/x/text v0.14.0 h1:ScX5w1eTa3QqT8oi6+ziP7dTV1S2+ALU0bI+0zXKWiQ=
golang.org/x/text v0.14.0/go.mod h1:18ZOQIKpY8NJVqYksKHtTdi31H5itFRjB5/qKTNYzSU=
```

The three roles:

1. **Exact version** — removes the range. The next install gets *this*, not "newest in range."
2. **Source / location** — where to fetch the bytes, so a registry move or mirror still resolves to the right artifact.
3. **Integrity hash** — a cryptographic fingerprint (`sha512`, Go's `h1:` SHA-256 base64) of the package's *contents*. On install, the tool re-hashes what it downloaded and **refuses to proceed if the hash differs**. This is the supply-chain safeguard: it catches a tampered, corrupted, or swapped artifact — even if the version number is identical.

Go splits this across two files deliberately: `go.mod` records the *selected versions* (and is human-edited), while `go.sum` records *hashes of every module ever used in resolution* (machine-managed, append-only-ish). `go.sum` contains hashes of the **whole transitive set**, including the `go.mod` files themselves — so even the *dependency declarations* of your dependencies are verified, not just their code.

> **Key insight:** The lock file makes the build both *reproducible* (exact versions) and *verifiable* (hashes). Reproducibility answers "do I get the same versions?"; integrity answers "do I get the same *bytes* for those versions?" A version number is a *label* an attacker can reuse; a content hash is a *fingerprint* they can't forge. This is why `go.sum` exists separately from `go.mod` and why npm's `integrity` field is not optional fluff. (More on the supply-chain story in [senior.md](senior.md) and [Release Engineering › Supply-Chain Security](../../release-engineering/09-supply-chain-security/).)

---

## Newest-Compatible vs Minimum Version Selection

Here is the genuinely surprising design split. When several versions satisfy a constraint, which does the resolver pick?

**Newest-compatible (npm, cargo, pip, most ecosystems).** Given `^1.2.0`, pick the *highest* `1.x` currently published. The reasoning: newest has the latest fixes, and you opted into the range, so take the most of it.

```
manifest: lodash ^4.17.0
registry has: 4.17.0 ... 4.17.21
resolves to:  4.17.21   ← the NEWEST satisfying version (at resolution time)
```

The catch: the result depends on *when you resolve*. Resolve today and tomorrow and you may get different versions — which is exactly why lock files are mandatory in these ecosystems. Without the lock, the build is time-dependent.

**Minimum Version Selection (MVS), Go's choice.** Given that your module needs `golang.org/x/text v0.14.0`, Go selects the *minimum* version that satisfies all requirements — specifically, **the maximum of the minimums** required across the whole graph:

```
your-app  requires  x/text v0.14.0
lib-A     requires  x/text v0.13.0
lib-B     requires  x/text v0.14.0
MVS picks:          v0.14.0   ← the HIGHEST of the explicitly-required MINIMUMS,
                              NOT the newest version that exists in the registry
```

If `x/text v0.20.0` exists, MVS **does not pick it** unless something in the graph actually *requires* `>= v0.20.0`. It chooses the oldest version that everyone's stated requirements are satisfied by.

Why would anyone want the *oldest*? Russ Cox's argument (Go's designer): MVS makes builds **high-fidelity and reproducible without needing a separate lock file for resolution logic.** The selected version is a deterministic function of the `require` directives in the graph — it does not depend on what got published since, or on when you run the command. Adding a new dependency can never *silently* upgrade an unrelated one, because nothing floats to "newest." Upgrades are *explicit*: you run `go get foo@latest` to deliberately raise a minimum. The whole system has no "the build changed because time passed" failure mode.

```bash
# Go: upgrades are an explicit verb, not a side effect of installing
go get golang.org/x/text@v0.20.0   # deliberately raise the minimum
go get -u ./...                    # opt in to upgrading minors/patches
go list -m all                     # show the exact selected versions (the MVS result)
```

| | Newest-compatible (npm/cargo/pip) | MVS (Go) |
|---|---|---|
| Picks | Highest satisfying version | Highest of the *required minimums* |
| Result depends on | *When* you resolve (registry state) | Only the `require` graph (deterministic) |
| Gets new releases | Automatically (within range) | Only when you explicitly `go get` |
| Lock file's role | *Essential* — pins the time-dependent pick | A *checksum* file (`go.sum`); versions already deterministic in `go.mod` |
| Failure mode | Silent drift to newer versions | Stale deps until you deliberately upgrade |

> **Key insight:** Newest-compatible optimizes for *getting fixes automatically* at the cost of *non-determinism* (cured by lock files). MVS optimizes for *determinism and explicit upgrades* at the cost of *staleness* (cured by remembering to upgrade). Go didn't "forget" to pick the newest — it deliberately rejected newest-compatible because Cox argues the convenience of automatic upgrades isn't worth the loss of reproducible-by-construction builds. Understanding this is the difference between "Go's dependency thing is weird" and "Go made a principled, opposite trade-off." The senior page goes deeper into the argument.

---

## Reproducible Installs in Practice

Putting it together, here's how each ecosystem gives you a *reproducible* install — the same versions and bytes every time:

```bash
# npm: install EXACTLY the lock, fail on any drift between package.json and lock
npm ci

# yarn: frozen lockfile
yarn install --frozen-lockfile      # (yarn 1)   or:  yarn install --immutable  (yarn 2+)

# cargo: --locked refuses to update Cargo.lock
cargo build --locked

# pip: install only from a fully-pinned, hashed requirements file
pip install --require-hashes -r requirements.lock.txt

# Go: verify downloaded modules against go.sum; -mod=readonly forbids changes
go mod verify
go build -mod=readonly ./...
```

The common pattern: a **"frozen" / "locked" / "ci" mode** that (a) installs the *exact* locked versions, (b) verifies integrity hashes, and (c) *fails the build* if the manifest and lock disagree, rather than silently re-resolving. Development uses the loose mode (`npm install`, `go get`) where the lock *may* update; CI and production use the frozen mode. Mixing them up — running loose installs in CI — reintroduces exactly the non-determinism the lock file was supposed to remove.

> **Why the failure-on-drift matters:** A lock file you don't *enforce* is decoration. `npm ci` failing because `package.json` was edited without re-running `npm install` is the system working: it caught a state where intent (manifest) and reality (lock) diverged, before that divergence shipped. See [09 — Reproducible Builds](../09-reproducible-builds/middle.md) for how this fits the broader reproducibility story.

---

## Mental Models

- **Resolution is solving simultaneous equations, not sorting a list.** Every constraint is an equation; the resolver needs one assignment satisfying all of them *at once*. "Pick the newest" is a heuristic for *which* solution among many — it is not the algorithm.

- **The diamond is a forced choice the ecosystem made for you.** npm answers "keep both copies"; Go answers "find one or fail." Knowing your ecosystem's answer tells you instantly whether a version conflict is a shrug or a stop-the-line.

- **A version is a label; a hash is a fingerprint.** Lock files pin *labels* (reproducibility) and verify *fingerprints* (integrity). An attacker can republish a label; they can't reproduce a fingerprint. That's why the integrity field carries the security weight.

- **MVS is "do nothing unless told"; newest-compatible is "do the newest unless told not to."** Two opposite defaults. MVS's world is stable and stale; newest-compatible's world is fresh and drifty. The lock file is newest-compatible's patch for the drift; explicit `go get` is MVS's patch for the staleness.

---

## Common Mistakes

1. **Assuming `^0.2.3` means "any 0.x".** It means `>=0.2.3 <0.3.0` — caret locks the *minor* under `0.x` because that's the breaking axis there. Treating pre-1.0 carets like post-1.0 carets pulls in breaking minor bumps.

2. **Reading a resolution failure as a tooling bug.** "No version satisfies the requirements" means the *intersection of constraints is empty* — a real, mathematical conflict. Relax a constraint; don't retry the install or clear the cache.

3. **Expecting Go to pick the newest version.** It picks the highest *required minimum* (MVS), not the newest published. If you want newer, `go get` it explicitly. Engineers from npm-land file "bugs" about this constantly.

4. **Trusting npm's nested versions to be harmless.** Two copies of one library are two *identities*. `instanceof`, shared singletons, and global registries break across them. A "this can't be the same class" bug is often a duplicated dependency.

5. **Editing the manifest but not regenerating the lock.** Now intent and reality disagree. `npm ci` / `cargo --locked` will (correctly) fail. Re-resolve (`npm install`) to bring the lock in sync, then commit both.

6. **Pinning everything to exact versions to "be safe."** Over-pinning direct deps blocks *all* patch fixes (including security) and creates unresolvable conflicts when transitive deps demand newer. Ranges + a committed lock is the balanced answer; pin only when you have a specific reason.

---

## Test Yourself

1. Write the exact `>= / <` bounds for `^1.4.2`, `^0.4.2`, and `~1.4.2`.
2. Two deps require `C ^3.0.0` and `C ^3.4.0`. What range must the chosen `C` fall in, and roughly what version gets picked under newest-compatible?
3. In a diamond where A needs `left-pad@1` and B needs `left-pad@2`, how does npm resolve it, and how would Go? What new class of bug does npm's answer introduce?
4. Name the three things a lock file records per package, and what each protects against.
5. Under Go's MVS, the registry has `x/text` up to `v0.20.0` but the highest *required minimum* in your graph is `v0.14.0`. Which version is selected, and why isn't it `v0.20.0`?
6. Why is a lock file *essential* in npm but only a *checksum* file in Go? Tie your answer to the resolution strategy.

<details>
<summary>Answers</summary>

1. `^1.4.2` → `>=1.4.2 <2.0.0`. `^0.4.2` → `>=0.4.2 <0.5.0` (caret locks minor under 0.x). `~1.4.2` → `>=1.4.2 <1.5.0` (patch only).
2. The intersection of `^3.0.0` and `^3.4.0` is `>=3.4.0 <4.0.0`. Newest-compatible picks the highest published 3.x at/above 3.4.0 — e.g. `3.7.1` if that's newest.
3. **npm** installs *both* — `left-pad@1` nested under A and `left-pad@2` (often hoisted) for B; no conflict. **Go** must select a single version, and since `v1` and `v2` are different module paths it can keep both too — but two `v1.x` would be unified to one. npm's multiple-copies answer introduces **identity hazards**: objects from the two copies are different types, breaking `instanceof` and shared state.
4. (1) **Exact version** — protects reproducibility (same versions everywhere). (2) **Source/location** — ensures the right artifact is fetched. (3) **Integrity hash** — protects against tampered/corrupted/swapped bytes even at the same version number.
5. `v0.14.0` is selected. MVS picks the **highest of the required minimums**, not the newest in the registry; nothing in the graph *requires* `>= v0.20.0`, so it's never chosen. You'd have to `go get x/text@v0.20.0` to raise the minimum.
6. npm uses **newest-compatible**, so the resolved version depends on registry state *at resolution time* — non-deterministic, hence the lock file is essential to freeze the pick. Go uses **MVS**, where the selected versions are a deterministic function of the `require` graph in `go.mod`; the versions are already reproducible, so `go.sum` only needs to add *integrity* (hashes), not *version pinning*.

</details>

---

## Cheat Sheet

```
RANGE BOUNDS
  ^1.4.2  >=1.4.2 <2.0.0     (same MAJOR)
  ^0.4.2  >=0.4.2 <0.5.0     (0.x: caret locks MINOR)
  ^0.0.4  >=0.0.4 <0.0.5     (0.0.x: locks PATCH)
  ~1.4.2  >=1.4.2 <1.5.0     (PATCH only)
  cargo "1.0" == ^1.0 ;  pip "~=2.31.0" == >=2.31.0 <2.32.0

RESOLUTION
  = find ONE version per package satisfying ALL constraints at once
  = constraint satisfaction → backtracking → worst case SAT (NP-hard)
  "no version satisfies" = intersection of constraints is EMPTY (relax one)

DIAMOND (A and B want different X)
  npm    → keep MULTIPLE copies (nested/hoisted)  → bloat + identity hazards
  Go/Maven → ONE global version  → resolve or FAIL
  major bumps coexist everywhere (foo vs foo/v2 are different identities)

LOCK FILE = per package: { exact version, source, integrity hash }
  go.mod = versions (human-edited) ; go.sum = hashes of whole transitive set

NEWEST-COMPATIBLE (npm/cargo/pip)   vs   MVS (Go)
  picks highest in range                  picks highest of required MINIMUMS
  depends on WHEN you resolve              deterministic from require graph
  lock file ESSENTIAL                      go.sum is just checksums
  go get foo@latest = explicit upgrade

REPRODUCIBLE INSTALL (frozen modes)
  npm ci | yarn --immutable | cargo --locked
  pip --require-hashes | go build -mod=readonly + go mod verify
```

---

## Summary

- `^` and `~` are shorthands for *semver risk tolerance*: caret trusts same-MAJOR compatibility (but locks MINOR under `0.x`); tilde trusts only PATCH. Learn the *intent* — which axis may move — not just the symbol.
- **Resolution is constraint satisfaction:** find one version per package satisfying all ranges simultaneously, with backtracking, equivalent to SAT in the worst case. A "no satisfying version" error is an *empty intersection*, not a bug.
- The **diamond problem** forces an ecosystem-level choice: npm keeps *multiple* versions (no conflict, but bloat and identity hazards); Go/Maven keep *one* (coherent, but a conflict can be a hard stop).
- A **lock file** records, per package, the exact version, the source, and an **integrity hash** — giving both *reproducibility* (same versions) and *verifiability* (same bytes). Go splits this into `go.mod` (versions) and `go.sum` (hashes of the whole transitive set).
- **Newest-compatible** (npm/cargo/pip) picks the highest in-range version, making results time-dependent (lock file mandatory). **MVS** (Go) picks the highest *required minimum*, making results deterministic from the graph (upgrades are explicit). Opposite trade-offs, both principled.
- Reproducible installs require a *frozen mode* (`npm ci`, `cargo --locked`, `go build -mod=readonly`) that installs exact locked versions, verifies hashes, and fails on drift.

The [senior.md](senior.md) page goes deeper: resolution as SAT and backtracking, the full MVS argument, supply-chain integrity (sigstore, TUF), vendoring at scale, and the single-version policy in monorepos.

---

## Further Reading

- [Russ Cox — "Minimal Version Selection"](https://research.swtch.com/vgo-mvs) — the original, readable argument for why Go picks the oldest. Essential.
- [PubGrub: Next-Generation Version Solving](https://nex3.medium.com/pubgrub-2fb6470504f) — Natalie Weizenbaum on the SAT-flavored resolver behind Dart/`uv`.
- [npm — package-lock.json docs](https://docs.npmjs.com/cli/configuring-npm/package-lock-json) — the real lock file format and its rules.
- [The Cargo Book — Dependency Resolution](https://doc.rust-lang.org/cargo/reference/resolver.html) — cargo's resolver, SemVer compatibility, and multiple-major coexistence.

---

## Related Topics

- [04 — Per-Language Tools](../04-per-language-tools/middle.md) — how each toolchain implements fetching, caching, and resolution.
- [09 — Reproducible Builds](../09-reproducible-builds/middle.md) — lock files as one ingredient of bit-identical builds.
- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/senior.md) — pinning dependencies *outside* the language tool, in Bazel/Nix.
- [Release Engineering › Versioning and Semver](../../release-engineering/01-versioning-and-semver/) — versioning from the publisher's side.
- [senior.md](senior.md) — resolution as SAT, the MVS deep dive, and supply-chain integrity.
