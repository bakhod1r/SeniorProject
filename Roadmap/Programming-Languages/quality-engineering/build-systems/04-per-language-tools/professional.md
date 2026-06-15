# Per-Language Tools — Professional Level

> **Roadmap:** [Build Systems](../README.md) → Per-Language Tools
> *Running one of these tools on your laptop is easy. Running five of them across a hundred repos, in CI, with a security team watching the dependency graph and a finance team watching the CI bill — that is a discipline. This page is the operational playbook, told partly through the incidents that taught it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Running These Tools in CI at Org Scale](#running-these-tools-in-ci-at-org-scale)
3. [Caching Strategy, Per Tool](#caching-strategy-per-tool)
4. [Lockfile Hygiene and Dependency Security](#lockfile-hygiene-and-dependency-security)
5. [Private Registries and Provenance](#private-registries-and-provenance)
6. [Polyglot Repos — Many Tools, One Repo](#polyglot-repos--many-tools-one-repo)
7. [Migration Pain](#migration-pain)
8. [War Stories](#war-stories)
9. [Mental Models](#mental-models)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Operating per-language tools across an organization — CI, caching, security, and the incidents that set the rules.**

The senior page told you what's *true* about these tools. This page is about what you *do* with them when the blast radius is a company, not a project. At org scale the same tool behaves differently: a non-deterministic `npm install` that's a minor annoyance solo becomes a flaky-CI epidemic across 200 pipelines; a `build.rs` you'd never think about becomes a security-review checklist item; a `~/.m2` you delete locally becomes a question of how your build farm shares a cache safely.

Three forces dominate professional operation: **determinism** (CI must be reproducible or it's noise), **cost** (cache hit rate is real money in CI minutes), and **security** (every dependency is attack surface and someone is now responsible for it). The rules on this page exist because each was learned the expensive way — and the war stories at the end name the bills.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — the comparison matrix, reproducibility/hermeticity, supply-chain surface.
- **Required:** You've configured CI for at least one of these tools.
- **Helpful:** You've debugged a flaky or slow CI build and traced it to dependency resolution or caching.
- **Helpful:** Familiarity with [Release Engineering](../../release-engineering/README.md) — how built artifacts become releases.

---

## Running These Tools in CI at Org Scale

The first rule is universal and non-negotiable: **CI must use the deterministic, lockfile-respecting variant — never the mutate-as-you-go variant.** Local dev can be lenient; CI cannot.

| Tool | Local (lenient) | CI (deterministic) | Fails build if lockfile drifts? |
|---|---|---|---|
| **Go** | `go build` | `go build` (already deterministic) + `go mod verify` | use `-mod=readonly` (default in modules mode) |
| **Cargo** | `cargo build` | `cargo build --locked` / `cargo test --locked` | yes (`--locked`) |
| **npm** | `npm install` | `npm ci` | yes |
| **pnpm** | `pnpm install` | `pnpm install --frozen-lockfile` | yes |
| **yarn** | `yarn` | `yarn install --immutable` | yes |
| **bun** | `bun install` | `bun install --frozen-lockfile` | yes |
| **poetry** | `poetry add` | `poetry install --sync` | yes (against `poetry.lock`) |
| **uv** | `uv add` | `uv sync --frozen` | yes |
| **pip** | `pip install` | `pip install --require-hashes -r requirements.txt` | only with hashes pinned |
| **Gradle** | `gradle build` | `gradle build --no-daemon` (CI) + dependency locking | with `dependencyLocking` enabled |
| **Maven** | `mvn install` | `mvn -B -Denforcer ...` | with versions-enforcer + pinned plugins |

A few org-scale CI specifics:

- **Gradle daemon: off in CI, on locally.** The daemon is a persistent JVM that speeds repeated local builds. In CI it's a liability — it accumulates memory across builds on a reused runner and OOMs (see war stories). Run `--no-daemon` in CI.
- **Concurrency limits.** `cargo build -j`, `make -j`, and Gradle's `--max-workers` must be capped to the runner's actual cores or you'll thrash and *slow down*. Don't inherit the laptop's `-j$(nproc)` onto a shared 96-core runner where you get one container's worth of CPU.
- **Network during build is a smell.** A build that fetches mid-compile is non-hermetic and flaky when the registry hiccups. Fetch dependencies in a distinct, cacheable step (`go mod download`, `cargo fetch`, `npm ci`, `uv sync`) *before* the build step, so a registry outage fails fast and predictably.

---

## Caching Strategy, Per Tool

Cache hit rate is the single biggest lever on CI speed and cost. The strategy is the same everywhere — **cache the download cache and the compile cache, keyed on the lockfile** — but the paths and gotchas differ.

| Tool | Cache these paths | Key the cache on | Gotcha |
|---|---|---|---|
| **Go** | `$GOMODCACHE`, `$GOCACHE` | `go.sum` | two caches; `GOFLAGS`/tags change the compile-cache key |
| **Cargo** | `~/.cargo/registry`, `~/.cargo/git`, `target/` | `Cargo.lock` | `target/` is huge; consider `sccache` for compiler-level sharing |
| **npm** | `~/.npm` (or use `node_modules` cache) | `package-lock.json` | cache `~/.npm` and run `npm ci`, *not* a stale `node_modules` |
| **pnpm** | the pnpm store dir | `pnpm-lock.yaml` | store is content-addressed → near-perfect reuse across projects |
| **pip/uv** | `~/.cache/pip` / uv cache | `requirements.txt` / `uv.lock` | wheels cache well; sdists that compile do not |
| **Gradle** | `~/.gradle/caches` + remote build cache | inputs hash | local + **remote** build cache shared across team is the big win |
| **Maven** | `~/.m2/repository` | `pom.xml` | one shared `~/.m2` per runner; beware concurrent writes |

The professional moves beyond "turn caching on":

- **Key the cache on the lockfile hash, restore-fallback to a prefix.** A miss on the exact `Cargo.lock` hash should still restore the *most recent* cache for that branch as a warm base, then incrementally update. Cold caches are where CI time goes to die.
- **Remote/shared caching is the org-scale unlock — but only for hermetic-enough builds.** Gradle's remote build cache and `sccache`'s shared backend let one team's compile help another's. From [senior.md](senior.md): this is *safe* only when the cache key captures all inputs. A under-declared Gradle input poisons the *shared* cache for everyone — far worse than a local false hit.
- **Separate "warm the cache" from "use the cache" jobs.** A dedicated job populates the dependency cache on the default branch; PR builds restore it read-only. This avoids every PR re-downloading the world and prevents PR builds from polluting the shared cache with branch-specific state.

```yaml
# illustrative CI cache (GitHub Actions-style) keyed on the lockfile
- uses: actions/cache@v4
  with:
    path: |
      ~/.cargo/registry
      ~/.cargo/git
      target
    key: cargo-${{ runner.os }}-${{ hashFiles('**/Cargo.lock') }}
    restore-keys: cargo-${{ runner.os }}-      # warm-base fallback on a miss
```

---

## Lockfile Hygiene and Dependency Security

At org scale the lockfile stops being a convenience and becomes a **security and audit boundary**. Three disciplines:

**1. Audit the dependency graph, continuously.** Every ecosystem ships an auditor that maps your *resolved* graph against a vulnerability database:

```bash
go vuln ./...            # govulncheck — flags vulns actually reachable in your code
cargo audit              # RUSTSEC advisories against Cargo.lock
npm audit                # advisories against package-lock.json
pnpm audit
pip-audit                # PyPI advisories against the installed env / lock
mvn dependency-check:check   # OWASP Dependency-Check for the JVM
```

`govulncheck` is notable: it checks *reachability*, not just presence — a vulnerable function you never call isn't flagged. This cuts the false-positive rate that makes `npm audit` noise. Wire the auditor into CI as a *gate* on new advisories, not a daily email everyone ignores.

**2. Pin and verify, don't float.** In production code:

- Commit the lockfile (covered everywhere); in CI, *enforce* it can't drift (`--locked`, `npm ci`, `--frozen`).
- Pin transitive integrity with hashes (`--require-hashes` for pip; SRI is automatic in npm/poetry/uv locks; `go.sum` for Go).
- Pin *build tooling* too — the compiler/JDK/Node version (`go` directive in `go.mod`, `rust-toolchain.toml`, `.nvmrc`, Gradle toolchains). An unpinned toolchain is an unpinned input.

**3. Control *how* the graph changes.** Automated dependency-update bots (Dependabot, Renovate) open PRs that bump the lockfile; CI's full test + audit gate decides whether the bump is safe. The discipline is "small, frequent, tested bumps" over "a terrifying annual upgrade of everything." Pair this with a policy on *new* dependencies — a human reviews the addition of a *direct* dependency, because that's where new transitive surface and new install-time code enter.

> **Key insight:** the lockfile is the most security-relevant file in the repo. It is the exact, hashed inventory of every line of third-party code that will run in your CI and production. Treat changes to it like changes to a privileged-access list — reviewed, gated, and audited — not like an incidental diff.

---

## Private Registries and Provenance

Once you publish internal packages, you run a **private registry** (Artifactory, Nexus, GitHub Packages, AWS CodeArtifact, a Go module proxy, a private crates registry). It serves your internal packages *and* proxies/caches the public one.

The non-obvious operational hazards:

- **Dependency confusion (the reason scoping is mandatory).** If your internal package is named `internal-auth` and the resolver also checks the *public* registry, an attacker who publishes `internal-auth` publicly — at a higher version — can get the resolver to fetch *theirs*. Defenses: **scope** internal packages (npm `@yourorg/`-scoped, Go module path under your domain, Maven groupId you control), and configure the resolver to fetch scoped names *only* from the private registry. Never let public and private namespaces overlap with public-wins resolution.

```
# .npmrc — scope @acme to the private registry, everything else to the proxy
@acme:registry=https://npm.acme.internal/
registry=https://registry.npmjs.org/
```

- **The proxy is also your kill switch and your cache.** Proxying the public registry through Artifactory means (a) builds survive a public-registry outage, (b) you can *block* a known-malicious package org-wide instantly, and (c) you stop fetching the same tarball ten thousand times.
- **Provenance / SLSA.** At higher maturity, you don't just trust the lockfile hash — you verify *where the artifact was built*. npm now supports build provenance attestations; Go has the checksum DB + transparency log; signing (Sigstore/cosign) ties an artifact to the pipeline that produced it. This is the bridge to [Release Engineering](../../release-engineering/README.md): a release isn't just "the bytes built" but "the bytes built *by our pipeline, from this commit, with this graph*," provable after the fact.

---

## Polyglot Repos — Many Tools, One Repo

Real orgs rarely live in one language. A single repo (or fleet of repos) ends up with `go.mod` + `package.json` + `pyproject.toml` + `Cargo.toml`, each with its own lockfile, cache, and CI step. Operating this well:

- **One CI step per tool, each independently cached and gated.** Don't entangle them; a Go vuln gate and an npm vuln gate are separate checks. Parallelize them.
- **The cross-language seams are where it hurts.** When the Go service and TS client share a Protobuf, *no language tool owns the rebuild-on-`.proto`-change relationship*. You bolt on a `make`/`task` layer ([03 — Make and Descendants](../03-make-and-descendants/middle.md)) to sequence "regenerate, then let each tool build." This is glue, and glue is where staleness bugs hide.
- **This is the on-ramp to Bazel.** The polyglot pain — N tools, N caches, no shared graph, glue scripts that go stale — is precisely the senior-level scaling-ceiling argument made operational. When the glue layer's bugs cost more than a build-platform team, you migrate to [05 — Polyglot / Hermetic Builds](../05-polyglot-hermetic-builds/junior.md). Until then, you manage N tools with discipline and a thin orchestration layer.

> **Key insight:** in a polyglot repo, the build is only as reliable as the *weakest tool's defaults and the glue between them*. Your CI inherits Python's hermeticity problems and npm's supply-chain surface simultaneously. Standardize the *operational* rules (lockfile enforced, audit gated, caches keyed) across all tools even though the *commands* differ.

---

## Migration Pain

Switching a tool is a project, not a flag. The common migrations and their landmines:

- **`requirements.txt` → `poetry`/`uv`.** The pain: the old `requirements.txt` was never a true lockfile (middle level), so "migrate" means *re-resolving* the graph — and the new resolver may pick different versions, surfacing latent conflicts that pip's looser behavior hid. Migrate with tests green and pin aggressively, then relax.
- **npm/yarn → pnpm.** pnpm's strict `node_modules` (no phantom dependencies — you can only import what you *declared*) exposes code that relied on hoisting accidents. The migration *finds bugs*: imports that worked only because a transitive happened to be hoisted now fail. That's pnpm doing its job, but it's a wall of errors on day one.
- **Maven → Gradle.** Re-expressing a `pom.xml`'s declarative model in Gradle's imperative scripts, replicating plugin behavior, and matching the dependency *configurations* (`implementation` vs `api` vs `compileOnly`) is subtle; getting the visibility scopes wrong leaks or hides transitive deps.
- **Any tool → Bazel.** The big one: every package re-described in `BUILD` files, every toolchain wrapped hermetically, CI rewired. Worth it only at the scale [senior.md](senior.md) describes.

The universal rule: **migrate with a green test suite and the lockfile committed at every step, one component at a time, never big-bang.** A migration that changes the resolved graph *and* the tool *and* the CI simultaneously is unbisectable when it breaks.

---

## War Stories

**1. The npm lockfile churn.** A team's `package-lock.json` produced a different diff on every developer's machine — hundreds of lines reshuffled — because they were on mixed npm versions (the lockfile *format* and resolution changed between npm 6/7/8). Every PR had a noisy, conflicting lock diff; merges constantly re-resolved. Fix: pin the npm version org-wide (via `engines` + `corepack`/Volta), and enforce `npm ci` in CI so the lock is authoritative, not re-derived. The lesson: an *unpinned build tool* makes even a committed lockfile non-deterministic.

**2. The Gradle daemon OOM.** CI builds passed for weeks, then started failing intermittently with `OutOfMemoryError` — never reproducible locally. Cause: CI reused long-lived runners, the Gradle daemon persisted across builds accumulating leaked memory and classloaders, and eventually a build inherited a near-dead daemon. Fix: `--no-daemon` in CI (and bound `-Xmx`). The lesson: a feature that optimizes *repeated local* builds (the persistent daemon) is an anti-feature on *ephemeral-but-reused* CI runners.

**3. The dependency-confusion attack.** A researcher (and later real attackers) noticed companies referenced internal package names that didn't exist on the *public* registry. They published those names publicly at version `99.0.0`. Build tools configured to check both registries and prefer the highest version fetched the *attacker's* code — which exfiltrated environment variables on `postinstall`. It hit major companies. Fix: scope internal packages and pin scoped names to the private registry only; never allow public-wins resolution of internal names. The lesson: *resolution configuration is a security control*, not a convenience.

**4. The Python wheel that built in CI and broke in prod.** `pip install` succeeded in CI (which had `gcc` and dev headers), compiling a native dependency from sdist against the CI image's C libraries. The slim production image lacked the matching shared library, so the imported extension failed at runtime with a missing-`.so` error (recall [01 · junior](../01-build-fundamentals/junior.md)). Fix: build/resolve **wheels** (prebuilt binaries) for the *production* platform, not sdists against the CI host; pin platform tags. The lesson: Python's install-time native compilation is non-hermetic — the build host and run host must agree, or pin to prebuilt wheels.

---

## Mental Models

- **CI is the deterministic twin of local dev.** Local commands are lenient and mutate freely; CI commands are strict and read-only against the lockfile. If they're the same command, one of them is wrong.

- **Cache hit rate is a P&L line.** Every cold cache is CI minutes billed. Keying on the lockfile with a warm-base fallback, and sharing caches safely across the org, is performance *and* cost engineering.

- **The lockfile is a privileged-access list.** It's the exact inventory of third-party code that will execute in your pipeline. Review and gate changes to it the way you'd review changes to who can `sudo`.

- **Resolution configuration is a security control.** Which registry serves which namespace, and who wins on conflict, decides whether dependency-confusion works against you. It's not plumbing; it's a control plane.

- **A polyglot build is as weak as its weakest tool plus its glue.** You inherit every tool's defaults at once, joined by scripts that rot. Standardize the *operational rules* across tools even when the commands differ.

---

## Common Mistakes

1. **Running the lenient install command in CI.** `npm install` instead of `npm ci`, `cargo build` instead of `--locked`. CI silently mutates the lockfile or re-resolves, and "works in CI" stops meaning "reproducible." Use the strict variant everywhere in CI.

2. **Leaving the Gradle daemon on in CI.** On reused runners it leaks memory and OOMs intermittently. `--no-daemon` in CI; let the daemon help only local dev.

3. **Letting public and private namespaces overlap with public-wins resolution.** This is dependency confusion waiting to happen. Scope internal packages and pin them to the private registry.

4. **Treating `pip install` success in CI as proof it'll run in prod.** Native-compiling from sdist binds to the *build host's* libraries. Resolve prebuilt wheels for the *production* platform, or you'll ship a binary that can't load.

5. **Sharing a remote build cache from a non-hermetic build.** A under-declared input poisons the cache for the *whole org*, not just one machine. Verify hermeticity before enabling shared remote caching.

6. **Big-bang tool migrations.** Changing the tool, the resolved graph, and the CI at once produces an unbisectable failure. Migrate one component at a time, tests green, lockfile committed at each step.

---

## Test Yourself

1. Why must CI use `npm ci` / `cargo build --locked` / `uv sync --frozen` rather than the plain install commands?
2. You're caching a Cargo project in CI. Which paths do you cache, what do you key the cache on, and why have a `restore-keys` fallback?
3. Explain a dependency-confusion attack end to end, and the two configuration changes that prevent it.
4. Why does the Gradle daemon cause intermittent OOMs in CI but not locally? What's the fix?
5. A Python service installs fine in CI but fails at startup in prod with a missing shared library. Diagnose and fix.
6. Why is sharing a *remote* build cache more dangerous than a local one when the build isn't hermetic?

<details>
<summary>Answers</summary>

1. The plain commands may *mutate or re-derive* the lockfile (or re-resolve floating ranges), making CI non-deterministic. The strict variants install the lockfile **exactly** and **fail** on drift, so CI reproduces the intended graph byte-for-byte.
2. Cache `~/.cargo/registry`, `~/.cargo/git`, and `target/`; key on `hashFiles('**/Cargo.lock')`. The `restore-keys` prefix restores the most recent prior cache as a *warm base* on an exact-key miss, so a lockfile change does incremental work instead of a cold rebuild.
3. An attacker publishes a package to the *public* registry using the same name as a company's *private* package, at a higher version. A resolver checking both registries and preferring the highest version fetches the attacker's package, whose `postinstall` runs malicious code. Prevent by (a) **scoping** internal packages and (b) configuring the resolver to fetch scoped names **only** from the private registry (no public-wins).
4. The daemon is a persistent JVM. CI reuses runners, so the daemon survives across builds, accumulating leaked memory/classloaders until a build inherits a near-dead daemon and OOMs — non-reproducible because it depends on prior builds. Locally the daemon is short-lived per session. Fix: `--no-daemon` in CI (and bound `-Xmx`).
5. `pip` native-compiled an extension from sdist against the CI host's C libraries; the slim prod image lacks the matching `.so`, so the import fails at load time. Fix: resolve/install **prebuilt wheels** for the production platform (pin platform tags), or ensure the prod image carries the required shared libraries.
6. A non-hermetic build's cache key omits some host input. A *local* false hit hurts one machine; a *remote/shared* false hit serves the stale/wrong output to **every** consumer of the cache org-wide. Shared caching is only safe when the key captures all inputs — i.e., when the build is hermetic.

</details>

---

## Cheat Sheet

```
CI = STRICT, LOCKFILE-RESPECTING VARIANT (never the lenient one)
  Go     go build (deterministic) + go mod verify
  cargo  cargo build --locked
  npm    npm ci            pnpm  pnpm install --frozen-lockfile
  yarn   yarn install --immutable    bun  bun install --frozen-lockfile
  poetry poetry install --sync       uv   uv sync --frozen
  pip    pip install --require-hashes -r requirements.txt
  gradle gradle build --no-daemon (+ dependency locking)

CACHE: paths + key + fallback
  cache download cache + compile cache ; key on the LOCKFILE hash ; restore-keys = warm base
  remote/shared cache: ONLY safe if build is hermetic (else poisons the whole org)

LOCKFILE = PRIVILEGED-ACCESS LIST
  enforce no drift in CI ; pin toolchain too (go directive / rust-toolchain.toml / .nvmrc)
  audit gates: govulncheck · cargo audit · npm/pnpm audit · pip-audit · OWASP dep-check
  bots (Dependabot/Renovate): small frequent tested bumps > annual big-bang

PRIVATE REGISTRY = control plane
  SCOPE internal pkgs (@org/, your domain, your groupId)
  pin scoped names to private registry ONLY (defeats dependency confusion)
  proxy public registry → outage resilience + org-wide block + dedupe
  provenance/SLSA + signing → tie artifact to the pipeline (→ release engineering)

WAR-STORY RULES
  pin the build tool version (npm lockfile churn)
  --no-daemon in CI (gradle daemon OOM)
  resolution config IS security (dependency confusion)
  ship wheels for the PROD platform, not sdists vs CI host (python prod breakage)
```

---

## Summary

- **CI must use the strict, lockfile-respecting variant** of every tool (`npm ci`, `cargo build --locked`, `uv sync --frozen`, Gradle with locking + `--no-daemon`). Lenient install commands belong to local dev only.
- **Caching strategy is performance and cost engineering:** cache both the download and compile caches, key on the lockfile hash, keep a warm-base `restore-keys` fallback, and enable *shared/remote* caching only for hermetic-enough builds — a poisoned shared cache hits the whole org.
- **The lockfile is the most security-relevant file in the repo** — a hashed inventory of all third-party code that runs in CI and prod. Audit it continuously (`govulncheck`, `cargo audit`, `pip-audit`, …), enforce no-drift, pin the toolchain, and gate dependency changes like privileged access.
- **Private registries plus scoping defeat dependency confusion**; the proxy also gives outage resilience and an org-wide kill switch; provenance/SLSA + signing connect the artifact to the pipeline that built it ([Release Engineering](../../release-engineering/README.md)).
- **Polyglot repos inherit every tool's defaults at once**, joined by glue scripts at the cross-language seams — the operational form of the Bazel scaling argument. Standardize the *rules* across tools even when the commands differ.
- **Migrations are projects, not flags** — one component at a time, tests green, lockfile committed each step. The war stories (npm lockfile churn, the Gradle daemon OOM, dependency confusion, the Python prod-wheel break) each encode a rule worth more than the incident that taught it.

The interview page distills all four tiers into a question bank — manifest vs lock, resolution algorithms including MVS, caching, reproducibility, supply chain, tool-specific gotchas, and polyglot — with model answers and "what the interviewer is really testing."

---

## Further Reading

- [Microsoft — "Dependency Confusion"](https://medium.com/@alex.birsan/dependency-confusion-4a5d60fec610) (Alex Birsan's original write-up) — the attack that rewrote everyone's registry config.
- [SLSA — Supply-chain Levels for Software Artifacts](https://slsa.dev/) — the provenance framework you map onto these tools.
- [npm — Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements) — build attestations in practice.
- [Gradle — The build cache](https://docs.gradle.org/current/userguide/build_cache.html) — local + remote caching and the input-declaration contract.
- [Renovate](https://docs.renovatebot.com/) / [Dependabot](https://docs.github.com/code-security/dependabot) — automated lockfile hygiene at scale.

---

## Related Topics

- [senior.md](senior.md) — the comparison matrix and reproducibility/hermeticity theory this page operationalizes.
- [03 — Make and Descendants](../03-make-and-descendants/middle.md) — the orchestration glue that sequences multiple language tools in a polyglot repo.
- [05 — Polyglot / Hermetic Builds](../05-polyglot-hermetic-builds/junior.md) — where polyglot pain leads: Bazel and friends.
- [07 — Build Caching](../07-build-caching/senior.md) — remote/shared caching and cache-key correctness in depth.
- [Release Engineering](../../release-engineering/README.md) — turning built, provenanced artifacts into releases.
