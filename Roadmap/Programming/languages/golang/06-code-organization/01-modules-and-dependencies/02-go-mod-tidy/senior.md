# `go mod tidy` — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Tidy as a Hygiene Boundary](#tidy-as-a-hygiene-boundary)
3. [Dependency Hygiene at Scale: Indirect Bloat and Pruning](#dependency-hygiene-at-scale-indirect-bloat-and-pruning)
4. [Tidy in Multi-Module Monorepos](#tidy-in-multi-module-monorepos)
5. [The Interaction with MVS and Why Tidy Output Is Stable](#the-interaction-with-mvs-and-why-tidy-output-is-stable)
6. [Reproducibility, `go.sum`, and Supply-Chain Integrity](#reproducibility-gosum-and-supply-chain-integrity)
7. [Tidy and `replace` Directives in Production](#tidy-and-replace-directives-in-production)
8. [Tidy and Major Version Bumps](#tidy-and-major-version-bumps)
9. [Tidy and Retraction Awareness](#tidy-and-retraction-awareness)
10. [CI Strategy: Tidy as a Build-Breaking Gate](#ci-strategy-tidy-as-a-build-breaking-gate)
11. [Policy Enforcement: Allow-listing New Direct Dependencies via Tidy Diffs](#policy-enforcement-allow-listing-new-direct-dependencies-via-tidy-diffs)
12. [Tidy and SBOM / License Audits](#tidy-and-sbom-license-audits)
13. [Tidy in Air-Gapped Environments](#tidy-in-air-gapped-environments)
14. [Anti-Patterns](#anti-patterns)
15. [Senior-Level Checklist](#senior-level-checklist)
16. [Summary](#summary)

---

## Introduction

For a senior engineer, `go mod tidy` is not a maintenance command — it is the **load-bearing reconciliation step** in the lifecycle of a Go module. Every other piece of Go module tooling assumes that `go.mod` and `go.sum` faithfully reflect the import graph of the source tree. Tidy is the command that *makes* that assumption true. If tidy has not run since the last code change, every downstream guarantee — reproducibility, supply-chain integrity, vendoring, vulnerability scanning, SBOM accuracy — is provisional.

The mechanics of tidy belong in [junior.md](junior.md) and [middle.md](middle.md). This file is about *governance*: how tidy fits into release engineering, how to wield it as a CI gate, how it interacts with MVS, retractions, replace directives, monorepos, air-gapped builds, and audit pipelines.

After reading this you will:
- Treat `go mod tidy` as the single source of truth that the rest of your supply chain depends on.
- Reason about indirect-dependency bloat in the context of Go 1.17+ lazy loading.
- Design CI gates that prevent silent drift between source and `go.mod`.
- Coordinate tidy across multi-module monorepos without one module's drift breaking another.
- Use tidy diffs as the substrate for dependency policy, allow-listing, and SBOM accuracy.
- Survive air-gapped, vendored, and proxy-restricted environments.

---

## Tidy as a Hygiene Boundary

A module has two parallel descriptions of its dependencies. The first is the *source of truth*: the union of every `import` statement in every `.go` file that participates in any build. The second is the *recorded* description: `go.mod` (versions and `// indirect` annotations) and `go.sum` (cryptographic hashes). These two descriptions can diverge.

`go mod tidy` is the operation that *forces them to converge.* After a successful tidy run, the following invariant holds:

> Every package required by the module's build graph appears in `go.mod` at the minimum version that satisfies the graph; every entry in `go.sum` corresponds to a module version that contributes to the build, plus the supporting metadata for transitive resolution.

That invariant is the **hygiene boundary**. To one side: code edits, new imports, deleted files. To the other side: deterministic builds, reproducible CI, accurate SBOMs, working `go mod download` in air-gapped contexts.

Anything that looks at `go.mod`/`go.sum` — vulnerability scanners, license auditors, SBOM generators, vendor-import tooling, IDE integrations, supply-chain attestation systems — assumes the invariant holds. If tidy has not run, those tools are reading stale information, and they will report stale results. *They will not warn you.*

Treat tidy as the only tool that has the right to change `go.mod` and `go.sum` based on your source code. Everything else (the build, `go test`, `go vet`) must be a read-only consumer in steady state.

---

## Dependency Hygiene at Scale: Indirect Bloat and Pruning

Every direct dependency drags a transitive subgraph with it. A small project with three direct deps can easily resolve to two hundred modules in `go.sum`.

### Where the bloat comes from

- **Lowest common denominator MVS.** If your code requires `lib v1.2`, but a transitive dep needs `lib v1.5`, MVS picks `v1.5` and pulls in everything `v1.5` introduces.
- **Dev-time imports.** Test files (`_test.go`) and packages used only for testing appear in `go.mod` because tidy includes the test build graph by default.
- **Build-tag specific imports.** `//go:build linux` files contribute imports, even though a Mac build never compiles them. Tidy resolves the *union* across platforms with `-compat` semantics so the module is portable.

### Lazy loading (Go 1.17+) and what changed

Before Go 1.17, `go.mod` listed only direct dependencies; the rest were resolved by walking transitive `go.mod` files at build time. This was elegant but slow on big graphs and made offline builds fragile.

Go 1.17 introduced **lazy module loading**. Now `go.mod` records *all* modules that contribute to the build, including transitives, marked `// indirect`. The build no longer needs to walk transitive `go.mod` files; the local one is self-sufficient. The cost: `go.mod` becomes much larger.

Senior implication: a Go 1.17+ module's `go.mod` can grow to hundreds of `// indirect` lines. This is *expected*, not a code smell. Do not "clean up" indirect lines manually — tidy will put them back, and the build will be slower without them.

### When `go.mod` truly is too large

Indirect bloat is fine until it is not. Symptoms of a real problem:

- A single direct dep contributes hundreds of transitives that never appear in your binary (because Go's linker is dead-code eliminating them).
- A direct dep is a "kitchen sink" library — you use 5% of it and pay the dependency cost of 100%.
- A direct dep pulls in a heavy framework you do not need (e.g. an HTTP client that depends on a full web framework).

Mitigations:

- Replace the heavy dep with a lighter alternative or a hand-written equivalent.
- Switch to a sub-package of the dep that has a narrower transitive surface.
- File an issue upstream proposing the heavy dep be moved behind a build tag or a separate module.
- Vendor and prune: use `go mod vendor` and accept that you no longer share dependency versions with the ecosystem. Last resort.

### `go mod why`

When triaging "why is this module in my graph," use `go mod why <module>`. It prints the import chain that reaches that module. Combine with `go mod graph | rg <module>` for the full edge list. Tidy's correctness depends on these being accurate; if `go mod why` claims a module is unused after tidy, there is a tooling bug worth reporting.

---

## Tidy in Multi-Module Monorepos

A monorepo with N modules has N `go.mod` files. Tidy operates on *one* module at a time. There is no "tidy all" command in the standard toolchain.

### The naive approach and why it fails

A first attempt at a monorepo CI tidy gate:

```
find . -name go.mod -execdir go mod tidy \;
git diff --exit-code
```

Problems:

- A failing module fails the loop early, hiding drift in later modules.
- Modules can have interdependencies via `replace` to local paths; the order matters.
- Some modules may be vendored; tidy without `-mod=mod` is a no-op that prints nothing.
- Test-only modules and example modules need different tidy flags.

### The correct pattern

1. Enumerate every `go.mod` under the repo root.
2. For each, run tidy in its own directory, capturing exit status and diff *separately*.
3. Aggregate failures. Fail CI only after all modules have been checked.
4. Report which modules drifted, with their diffs, in the CI summary.

A simple implementation in shell looks like:

```bash
fail=0
while read -r mod; do
    dir=$(dirname "$mod")
    ( cd "$dir" && go mod tidy ) || fail=1
    if ! git diff --exit-code -- "$mod" "$dir/go.sum"; then
        echo "::error::drift in $mod" >&2
        fail=1
    fi
done < <(find . -name go.mod -not -path './vendor/*')
exit $fail
```

For larger monorepos, Bazel rules or `nx`-style tooling can run per-module tidy in parallel and only on modules whose source files (or transitive depended-on modules) changed in the PR.

### Workspaces and tidy

`go.work` does *not* change tidy's per-module behaviour. Workspaces overlay module resolution at *build* time so that local replacements are transparent; tidy still operates on one `go.mod` at a time and ignores `go.work`. This is intentional — a workspace is a developer convenience, not part of release artefacts.

### Keeping modules from drifting against each other

If module `A` depends on module `B`, and they live in the same monorepo, you have a choice:

- **Pin via tag.** A and B reference each other through tagged versions. Tidy is independent in each. Releases are coordinated.
- **Replace via `go.work`.** Developers see live source. CI must still tidy each module against its tag.
- **Replace in `go.mod` with a relative path.** Tidy still works, but consumers outside the monorepo cannot resolve the replace. Suitable only for never-published internal modules.

---

## The Interaction with MVS and Why Tidy Output Is Stable

Go's module resolution uses **Minimum Version Selection (MVS)**: for each module in the build graph, pick the *highest* version among the minimums declared by any participant. This sounds paradoxical until you see it in practice. The selection is *minimum* in the sense that no participant requested *less* than what is chosen, and *highest* in the sense that the graph's most-recent requirement wins.

### Why tidy output is reproducible

MVS is deterministic. Given the same source tree, the same set of imported packages, and the same upstream module graph, MVS picks the same versions every time. Tidy is therefore deterministic up to:

1. The state of the source tree at the moment tidy runs.
2. The state of the upstream module graph at the moment tidy queries it.

Item (2) is the wrinkle. If a new patch version is released between two tidy runs, tidy may pick it up — but only if the new version is *required* (e.g., the previous version is retracted or the floor moved). For a stable repo with a stable upstream, two consecutive tidy runs produce byte-identical `go.mod` and `go.sum`. This is the property your CI gate exploits.

### What tidy does *not* do

Tidy is **not** an upgrader. It will not pick up a newer minor or patch version unless something in the build graph forces it. To upgrade, you run `go get module@version` (or `go get -u`), then `go mod tidy`.

This separation matters for reviews. A PR that changes `go.mod`/`go.sum` falls into one of three categories:
- **Code-driven drift.** The author added or removed an import; tidy reflects it.
- **Explicit upgrade.** The author ran `go get`; tidy reflects it.
- **Stale tidy.** The author should have run tidy and did not. CI catches this.

A senior reviewer can tell which category a diff belongs to without asking, because the patterns are visually distinct.

---

## Reproducibility, `go.sum`, and Supply-Chain Integrity

`go.sum` is a record of cryptographic hashes for the module versions tidy decided on. Together with `go.mod`, it is the supply-chain manifest of your project.

### What `go.sum` covers and what it does not

- **Covers:** the contents (`h1:` line) and the `go.mod` (`/go.mod h1:` line) of every module version in the build graph.
- **Does not cover:** the toolchain itself (the Go compiler, linker, runtime). The new `toolchain` directive in `go.mod` is orthogonal; it can request a toolchain version, but pinning the *exact* toolchain to a hash is a separate operational concern (e.g., distributing a specific Go binary in CI).

So tidy does *not* give you reproducible builds end-to-end. It gives you reproducible *source resolution*. Toolchain reproducibility is the build infrastructure's responsibility (pinned Docker image, hash-locked Go binary, etc.).

### `GOSUMDB` and verification

When tidy adds a new module, it consults the public checksum database (`sum.golang.org`) and verifies the hash before writing it. This is an integrity check against a transparent log; it does not protect against a compromised upstream, but it does protect against MITM tampering and silent re-tagging.

`GOSUMDB=off` disables this. Necessary for private modules (those listed in `GOPRIVATE`); never appropriate for public modules.

### Tidy vs `go mod download` vs `go mod verify`

- `go mod tidy` is *normative* — it can change `go.mod` and `go.sum`.
- `go mod download` is *populating* — it fills the module cache with the modules listed in `go.mod`/`go.sum` without changing them.
- `go mod verify` is *checking* — it confirms cached module contents match the hashes in `go.sum`.

In CI: tidy first, then download (warm the cache), then build. In production runtime images: only download and verify; never tidy.

---

## Tidy and `replace` Directives in Production

Tidy honours `replace` directives but never *creates* them. A replace must be added by hand. Once present, tidy resolves through the replace as if the substituted module were the original.

### Subtle behaviour

- Tidy does not warn if a `replace` is unused. A stale replace can sit in `go.mod` for years, doing nothing, while every reviewer assumes it is load-bearing. Periodically audit your replace block.
- A `replace` that points to a *local path* causes tidy to read the local source. Tidy will hash the local module's `go.mod` and write that hash into `go.sum`. If the local source changes, tidy must re-run; otherwise `go.sum` is stale. This is one of the most common sources of "works on my machine, fails in CI" with replace.
- A `replace` that pins a security-patched fork must be removed once upstream releases the official fix. Tidy will not flag this. Only humans will. Build a calendar reminder for every emergency replace you commit.

### Production policy

Adopt a written rule: every `replace` in committed `go.mod` files must be accompanied by:

1. A comment naming the upstream issue, CVE, or PR number.
2. A target removal date.
3. A pointer in CODEOWNERS or a similar registry to whoever is responsible for retiring it.

Without policy, `replace` blocks accumulate like commented-out code. With policy, they are tractable.

---

## Tidy and Major Version Bumps

Bumping a module from `v1` to `v2` requires renaming the import path to `.../v2`. The transition has a tidy-specific failure mode that bites senior engineers more than juniors.

### The required sequence

1. Edit every `import "github.com/x/lib"` to `import "github.com/x/lib/v2"`.
2. Edit `go.mod` to `module github.com/x/lib/v2`.
3. Run `go mod tidy`.
4. Tag `v2.0.0`.

If you tag *before* tidy, `go.sum` may still contain entries for the old import path that participated in the build during the rename. Tidy after the tag tries to clean them up — and now `go.sum` no longer matches the tagged commit. Consumers who pin to that exact tag will see a hash mismatch when their tidy run produces different content.

### Cross-module impact

When *consumers* upgrade from `v1` to `v2` of your library, *they* must edit their imports and run tidy. Tidy will then *remove* the old major's entries from their `go.sum`. If they accidentally have transitive deps still pulling `v1`, both majors will live in their build, and tidy will list both. This is normal — not a sign of incomplete migration.

Document the major bump in release notes with a checklist consumers can follow:
- "Run `go get github.com/x/lib/v2@latest`."
- "Update imports."
- "Run `go mod tidy`."
- "Verify only `/v2` appears in your `go.mod` for this library."

---

## Tidy and Retraction Awareness

A `retract` directive in your *latest* module version tells the toolchain "skip these older versions when resolving."

### How tidy reacts

When tidy queries upstream for the latest version of a dependency, it learns about retractions in that dependency's most recent `go.mod`. If the version currently pinned in your `go.sum` is retracted, tidy will *quietly* upgrade to the next non-retracted version.

This is silent. There is no warning, no log, no flag. Your build composition has changed, and tidy is the agent of change. The next CI run sees an unexpected `go.mod`/`go.sum` diff and (if your gate is configured correctly) fails.

### Senior implications

- A scheduled tidy job (nightly) will discover retractions that were issued upstream that day. Make sure such jobs exist; otherwise you discover retractions only when a developer runs tidy weeks later.
- For mission-critical pinned versions, do not rely on tidy's silent upgrade. Pin explicitly to a version you have audited, document the pin, and re-evaluate the pin on a schedule.
- When *you* retract a version of *your* module, expect downstream consumers' tidy runs to upgrade. Tag clearly and provide migration notes.

---

## CI Strategy: Tidy as a Build-Breaking Gate

The single most important Go CI gate is:

```
go mod tidy
git diff --exit-code go.mod go.sum
```

If the diff is non-empty, fail the build. This one rule, applied universally, prevents an enormous class of supply-chain and reproducibility bugs.

### Why this gate matters

- It guarantees that what is committed is what tidy would produce. No drift.
- It forces every PR that touches dependencies to also touch the manifest, so reviewers see the change.
- It defends against sloppy editors, IDE imports, and "I forgot to run tidy."
- It makes downstream tooling (SBOMs, vuln scanners) trustworthy.

### Failure modes to anticipate

- **Network flakiness.** Tidy needs to reach the proxy. Use a mirror (`GOPROXY=https://proxy.golang.org,direct` or a corporate proxy) and cache the module cache between CI runs.
- **Time-dependent drift.** Upstream retractions, new minor versions promoted to default. Schedule a periodic run that explicitly *expects* drift and opens a PR rather than failing.
- **Vendored repos.** If you commit `vendor/`, the gate also needs `go mod vendor && git diff --exit-code vendor/`.
- **Multi-module repos.** Iterate; aggregate failures. See the monorepo section above.

### A more complete gate

```bash
set -euo pipefail

go mod tidy
go mod verify

# Drift in the manifest
git diff --exit-code go.mod go.sum

# Drift in vendor (if used)
if [[ -d vendor ]]; then
    go mod vendor
    git diff --exit-code vendor/
fi
```

Run on every PR. Pin the Go version exactly so that future toolchain changes (which can change tidy's output) appear as deliberate version bumps, not phantom drift.

---

## Policy Enforcement: Allow-listing New Direct Dependencies via Tidy Diffs

A senior-grade dependency policy treats a *new direct dependency* as a meaningful event, not a routine code change.

### The diff-based approach

Direct dependencies appear in `go.mod` *without* the `// indirect` marker. A new direct dep is therefore a line added to `go.mod` whose `require` entry has no `// indirect` suffix.

Build a CI step that:
1. Runs `go mod tidy` in a clean workspace.
2. Diffs the resulting `go.mod` against the base branch.
3. Extracts every line that adds a `require` entry without `// indirect`.
4. Compares the new direct deps against an allow-list (e.g., `.github/dependency-allowlist.txt`).
5. Fails the build with a clear message when an unlisted dep is introduced.

### What goes on the allow-list

- Modules vetted by your security team for license, provenance, maintenance, and reputation.
- Modules already in production use elsewhere in the company.
- Modules from a curated mirror you control.

### What does *not* go on the list

- "Trending" modules a developer found yesterday.
- Modules from a single-maintainer GitHub account with no release process.
- Modules whose licence is incompatible with your distribution model.

### The override

A new dep that is *not* on the list is not a hard veto — it is a request for review. The CI message should tell the developer how to propose adding the dep (e.g., "open a PR against `dependency-allowlist.txt` with rationale"). Process matters; opaque vetoes drive developers to copy-paste source instead.

---

## Tidy and SBOM / License Audits

A Software Bill of Materials (SBOM) for a Go project is generated from `go.mod` and `go.sum`. The SBOM lists every module the build depends on, transitively.

### The integrity chain

1. Source code defines imports.
2. Tidy reconciles them into `go.mod`/`go.sum`.
3. SBOM tooling reads `go.mod`/`go.sum` and emits CycloneDX or SPDX.
4. Vulnerability scanners and licence auditors consume the SBOM.

If step 2 has drifted, every downstream artefact lies. The vuln scanner reports nothing because it does not see the module that was added; the licence audit passes because it does not see the GPL-licensed module that was added.

### Senior obligations

- Wire SBOM generation into the same CI job that runs tidy. Reject builds where tidy would change the manifest.
- Pin SBOM tooling to a known version; tooling upgrades can change SBOM output and look like dependency changes.
- Archive SBOMs as build artefacts. They are part of the release record.
- For regulated industries, have the tidy-then-SBOM pipeline run inside a reproducible build environment (pinned Go toolchain, pinned SBOM tool, no network mid-build except the proxy).

### Licence drift

Tidy can introduce a new transitive dep whose licence differs from anything previously in the project. The dep's licence does not appear in tidy's output — only the module path and version do. Couple tidy with a licence scan (e.g., `go-licenses`) and gate on the union of declared licences against an approved list.

---

## Tidy in Air-Gapped Environments

In an air-gapped environment, `go mod tidy` cannot reach the public proxy. There are three viable strategies.

### Strategy 1 — Internal proxy mirror

Run an Athens, JFrog, or Sonatype proxy inside the air-gap. Configure `GOPROXY=https://internal-proxy.example.corp` and tidy works normally — it queries the internal mirror, which has been pre-populated with allowed modules.

The mirror is the choke point of supply-chain control. Adding a module to the mirror is the company's "approve this dep" workflow.

### Strategy 2 — Vendored dependencies

`go mod vendor` writes every dependency into `vendor/`. With `GOFLAGS=-mod=vendor`, builds ignore the proxy entirely and read from the vendor directory.

Tidy in a vendored repo is fragile: it must run with `-mod=mod` and proxy access (or with all needed modules already in the local module cache). The pragmatic pattern:

- Vendor in the secure environment.
- Commit `vendor/` along with `go.mod`/`go.sum`.
- In the air-gapped environment, never run tidy. Run only `go build` and `go test` with `-mod=vendor`.
- Periodically (every release, every quarter), run tidy outside the air-gap, re-vendor, and bring the result inside.

### Strategy 3 — `GOPROXY=off`

Set `GOPROXY=off` to forbid any network access. Tidy will fail unless every needed module is already in the local module cache.

Useful for "this build must not touch the network" assertions, but it pushes the burden of cache management onto operators. Combine with vendoring for the cleanest model.

### Trade-offs

| Strategy | Pros | Cons |
|----------|------|------|
| Internal proxy | Tidy works normally; central control | Operate a proxy; manage approvals |
| Vendoring | No proxy needed; simple builds | Larger repo; periodic out-of-band tidy |
| `GOPROXY=off` | Strong guarantee no network | Manual cache management; brittle |

Most regulated environments combine internal proxy + commit-time tidy gate + offline vendor for runtime images.

---

## Anti-Patterns

- **Letting `go.mod`/`go.sum` drift between tidy runs.** Every drift is a potential audit failure, vuln scanner blind spot, and merge conflict.
- **Treating tidy as a "cleanup" step before commit.** It is part of the build, not a manual chore.
- **Skipping the CI tidy gate "because it is annoying."** Without the gate, drift accumulates silently.
- **Running tidy in production runtime images.** Production should be downloads-and-verify only.
- **Manually deleting `// indirect` lines.** Tidy will put them back; you have wasted everyone's time.
- **Editing `go.sum` by hand.** Always tidy; never hand-edit.
- **Allowing a `replace` block to grow forever.** Audit and prune on a schedule.
- **Letting tidy upgrade through retractions silently.** Run scheduled tidy jobs that surface drift, not hide it.
- **Running tidy without verifying the proxy.** A misconfigured `GOPROXY` can silently downgrade your supply-chain protection.
- **Generating an SBOM from a non-tidy state.** The SBOM is then a fiction.
- **One CI pipeline that runs tidy on the *root* of a multi-module repo only.** Sub-modules drift unnoticed.
- **Coupling tidy to formatting jobs that only fire on changed files.** Tidy must run on every PR; dependency changes can come from any file or none.
- **Disabling `GOSUMDB` for public modules.** You lose transparency-log protection for no benefit.

---

## Senior-Level Checklist

- [ ] Tidy is enforced as a build-breaking gate on every PR
- [ ] The gate covers `go.mod`, `go.sum`, and (if vendored) `vendor/`
- [ ] Every module in a multi-module repo has its own tidy gate
- [ ] Scheduled (nightly or weekly) tidy job opens drift PRs automatically
- [ ] `GOPROXY` and `GOSUMDB` are configured per environment, documented, and audited
- [ ] `GOPRIVATE` covers every internal module path
- [ ] `replace` directives have comments, owners, and removal dates
- [ ] New direct dependencies pass an allow-list check derived from the tidy diff
- [ ] SBOM generation runs immediately after tidy, in the same CI job
- [ ] Licence audits gate on the post-tidy module list, not a stale snapshot
- [ ] Air-gapped environments have a documented strategy (internal proxy or vendor)
- [ ] Production runtime images never run tidy; they only `download` and `verify`
- [ ] Major version bumps run tidy *before* tagging, not after
- [ ] Retraction-aware: scheduled tidy surfaces silent upgrades caused by upstream `retract`
- [ ] The Go toolchain version is pinned in CI so tidy output is bit-stable
- [ ] Reviewers can distinguish code-driven drift, explicit upgrades, and stale tidy at a glance

---

## Summary

`go mod tidy` is the operation that keeps the recorded module graph in lockstep with the actual import graph. Senior engineering practice elevates this from a developer chore to the **load-bearing reconciliation step** of the entire Go supply chain.

Make tidy a CI gate. Make every multi-module monorepo gate per module. Make tidy diffs the substrate for dependency policy and allow-listing. Generate SBOMs only after tidy. Treat `replace` blocks like commented-out code: track them, prune them. Watch for silent upgrades caused by upstream retractions. In air-gapped settings, choose explicitly between internal proxies, vendoring, and `GOPROXY=off` — and document the choice.

The command itself is one line. The discipline of running it consistently, gating on its result, and treating its output as the single source of truth is what separates a hobby project from a production-grade Go module. Tidy is small; the contract it enforces is enormous. Hold the contract, and the rest of the supply-chain stack becomes tractable. Skip it, and every other guarantee — reproducibility, vulnerability scanning, licence compliance, attestation — quietly becomes fiction.
