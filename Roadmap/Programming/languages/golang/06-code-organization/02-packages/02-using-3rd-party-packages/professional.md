# Using Third-Party Packages — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [What `go get` Actually Does (step-by-step)](#what-go-get-actually-does-step-by-step)
3. [Module Proxy Protocol Recap](#module-proxy-protocol-recap)
4. [Pseudo-Version Generation: The Algorithm](#pseudo-version-generation-the-algorithm)
5. [Major-Version Resolution Internals](#major-version-resolution-internals)
6. [The Module Cache and Concurrency](#the-module-cache-and-concurrency)
7. [Dependency Resolution at Scale](#dependency-resolution-at-scale)
8. [Running a Private Module Proxy](#running-a-private-module-proxy)
9. [Operating GOPRIVATE / GONOSUMCHECK / GOSUMDB](#operating-goprivate-gonosumcheck-gosumdb)
10. [SBOM Generation and Compliance](#sbom-generation-and-compliance)
11. [Vulnerability Scanning Integration](#vulnerability-scanning-integration)
12. [License Compliance](#license-compliance)
13. [CI/CD Strategy for Dependency Updates](#cicd-strategy-for-dependency-updates)
14. [Edge Cases the Toolchain Source Reveals](#edge-cases-the-toolchain-source-reveals)
15. [Operational Playbook](#operational-playbook)
16. [Summary](#summary)

---

## Introduction

The professional-level treatment of third-party packages is not about *using* them — it is about *operating* them. At infrastructure scale, every `go get` is a network event, a write to the module cache, a checksum-database lookup, a `go.mod` mutation, and an entry in your supply-chain provenance trail. Multiply that by every developer, every CI run, every release branch in a monorepo, and the picture is no longer "fetch a library" but "operate a software supply chain."

This file is for engineers who run private module proxies, design dependency-update pipelines, generate SBOMs for compliance, integrate vulnerability scanners into CI, and diagnose pathological dependency-resolution problems by reading toolchain source.

After reading this you will:
- Know each step the toolchain performs when `go get` is invoked
- Reason about the proxy protocol at the level of HTTP round-trips
- Generate pseudo-versions by hand and predict what the toolchain will produce
- Operate Athens, Artifactory, or another private proxy fleet
- Configure `GOPRIVATE`, `GONOSUMCHECK`, and `GOSUMDB` for hybrid public/private setups
- Produce CycloneDX SBOMs and feed them into vulnerability and license scanners
- Integrate `govulncheck` and Renovate/Dependabot into a coherent update workflow
- Diagnose retracted versions, vanity-path renames, and major-version-without-`/vN` traps

---

## What `go get` Actually Does (step-by-step)

`go get example.com/lib@v1.2.3` looks like a single command but executes a sequence implemented in `cmd/go/internal/modget` and supporting packages. The high-level flow:

1. **Parse arguments.** Each positional argument is a module spec — `path`, `path@version`, `path@latest`, `path@upgrade`, etc. The toolchain splits each into a path and a version query.
2. **Resolve the version query.** `@latest` triggers a `/@latest` proxy call. `@v1.2.3` is taken literally. `@upgrade` triggers MVS upgrade computation against the existing build list.
3. **Contact the proxy** for `<path>/@v/<version>.info`. The response is a JSON object with `Version`, `Time`, and (for pseudo-versions) `Origin`. This call confirms the version exists.
4. **Download `<path>/@v/<version>.mod`.** This is the dependency's own `go.mod`, needed for transitive resolution.
5. **Recursively walk requirements.** Each new module's `go.mod` may pull in further modules. The toolchain runs MVS to compute a fixed point.
6. **Download `<path>/@v/<version>.zip`** for every module that was not already cached. The zip is verified against its `.ziphash` and the checksum database.
7. **Verify against `sum.golang.org`** unless `GONOSUMDB` or `GOPRIVATE` excludes the path. The lookup is signed-tree-verified — clients check inclusion proofs against the latest signed root.
8. **Update `go.mod`.** Add or upgrade `require` lines. Re-sort the block. Preserve comments. Persist with `modfile.Format`.
9. **Update `go.sum`.** Append hash lines for every module/version/.mod pair that was newly verified. Sort lines.
10. **Optionally run `go mod tidy`** if the user passed `-u` or made structural changes. Tidy removes unused requires and fills missing transitive sums.

That is the whole pipeline. Steps 3–7 are where the network bandwidth lives. Steps 8–9 are the on-disk effect a colleague will see in your pull request.

---

## Module Proxy Protocol Recap

The module proxy protocol is documented at <https://go.dev/ref/mod#module-proxy>. For module path `example.com/lib`, the toolchain may issue:

| Endpoint | Returns | Used by |
|----------|---------|---------|
| `GET /example.com/lib/@v/list` | newline-separated list of versions | `go list -m -versions` |
| `GET /example.com/lib/@v/<v>.info` | JSON `{Version, Time, Origin}` | every fetch |
| `GET /example.com/lib/@v/<v>.mod` | the module's `go.mod` at that version | MVS |
| `GET /example.com/lib/@v/<v>.zip` | source archive, deterministic layout | extraction |
| `GET /example.com/lib/@latest` | `.info` for the latest version | `@latest` queries |

Paths are case-encoded: uppercase letters become `!` plus the lowercase letter (`gitHub` → `git!hub`). This avoids case-insensitive-filesystem collisions.

A proxy that supports the protocol is just an HTTP server returning these blobs. Athens, Artifactory, GoCenter (retired), and even a static S3 bucket with the right key layout all qualify.

---

## Pseudo-Version Generation: The Algorithm

Pseudo-versions identify a module at a specific commit when no semver tag exists. The format is:

```
v<base>-<UTC timestamp>-<commit prefix>
```

- `<base>` depends on the most recent semver tag reachable from the commit:
  - No tag → `0.0.0`
  - Tag like `v1.4.2` and the commit is *after* it on the same line → `1.4.3-0`
  - Tag like `v1.4.2` and the commit is on a branch *before* a later tag's parent → `1.4.2-pre.0` (varies; see `golang.org/x/mod/module.PseudoVersion`)
- `<UTC timestamp>` is `YYYYMMDDhhmmss` of the commit time, in UTC.
- `<commit prefix>` is the first 12 hex characters of the commit hash.

Examples:

```
v0.0.0-20231005120304-abcdef012345          # no prior tag
v1.4.3-0.20240115093000-deadbeefcafe        # successor to v1.4.2
v2.0.0-20240301081500-1122334455aa+incompatible  # v2 without /v2 path
```

The `+incompatible` suffix is how the toolchain represents a v2-or-higher module that lacks the `/vN` path suffix. It is a compatibility shim — see the next section.

The toolchain computes pseudo-versions in `golang.org/x/mod/module.PseudoVersion`. You can call it directly from tooling, or invoke `go list -m -json example.com/lib@<commit-sha>` and read the `Version` field.

---

## Major-Version Resolution Internals

Semantic import versioning makes `v2+` a distinct module path:

- `example.com/lib` is v0/v1.
- `example.com/lib/v2` is v2.
- `example.com/lib/v3` is v3.

The toolchain enforces this in two places:

1. **Module path validation.** When loading a module's `go.mod`, the toolchain checks that the `module` directive matches the requested path. A `module example.com/lib` with a request for `example.com/lib/v2` is rejected — the path's `/v2` suffix says v2, but the file says v0/v1.
2. **`+incompatible` fallback.** A module that publishes a `v2.0.0` tag without renaming to `/v2` is treated as `v2.0.0+incompatible`. The toolchain accepts it under protest. New code should never rely on `+incompatible` semantics — they exist to keep pre-modules code compilable.

Real-world consequence: a maintainer that bumps from v1 to v2 *without* moving to a `/v2` path breaks every consumer who uses module-aware mode. The fix is either to publish a proper `/v2` module, or to stay on v1.x.

The validation lives in `cmd/go/internal/modload/import.go` and `golang.org/x/mod/module`. Reading it once is the fastest way to understand why a `v2.0.0` import "doesn't work."

---

## The Module Cache and Concurrency

The cache is at `$GOPATH/pkg/mod` (default `$HOME/go/pkg/mod`).

Layout:

```
pkg/mod/
├── cache/
│   ├── download/                              # raw, content-addressed downloads
│   │   └── example.com/lib/@v/
│   │       ├── v1.2.3.info
│   │       ├── v1.2.3.mod
│   │       ├── v1.2.3.zip
│   │       ├── v1.2.3.ziphash
│   │       └── list
│   ├── lock                                   # filesystem mutex
│   └── sumdb/                                 # signed checksum-database tiles
└── example.com/lib@v1.2.3/                    # extracted, read-only source
```

**Read-only on disk.** Extracted source files are written with the read-only bit set. The toolchain assumes that nothing tampers with the cache after extraction. This is what makes `go.sum` checksums meaningful across machines and over time.

**Concurrency safety.** The `cache/lock` file is acquired with `flock`-style filesystem locking. Two `go build` processes touching the same module cache do not race; the second blocks until the first finishes its critical section. This is why concurrent CI jobs sharing a Docker volume of `pkg/mod` do not corrupt each other.

**Per-version directories are immutable.** Once `example.com/lib@v1.2.3/` exists, the toolchain never rewrites it. Re-fetches go through `cache/download/` and are short-circuited if the hash matches. This is what enables Bazel, Buck2, and BuildKit to cache `pkg/mod` aggressively.

**Cleanup.** `go clean -modcache` removes everything. In CI, this is occasionally useful to assert that a build has no hidden cache dependencies.

---

## Dependency Resolution at Scale

Build farms and monorepos amplify cache and proxy effects.

### Module-cache caching

Every CI agent that pulls `pkg/mod` from cold (network-bound) is wasting tens of seconds. Strategies:

- **Bazel** — `rules_go` integrates with Go modules through `gazelle` and `go_repository`. Bazel pins module versions in its own `WORKSPACE` or `MODULE.bazel`, fetches them at workspace setup, and caches them in `bazel-out`.
- **Buck2** — equivalent: a `buck2 build` target depends on a fetched module, and Buck's content-addressed cache holds it.
- **BuildKit / Docker** — use `RUN --mount=type=cache,target=/go/pkg/mod` so successive image builds reuse the cache layer.
- **Self-hosted runners** — mount a shared volume (read-write per agent, or read-only with a daily refresh job) at `/home/runner/go/pkg/mod`.

### Pre-warm / primer jobs

Run a daily job that does:

```
go mod download all
```

against every active branch. Successive PR builds hit the cache and skip network entirely. The cost is one network-bound run per day per branch instead of one per PR.

### Monorepo strategies

In a multi-module monorepo:

- **One `go.work`** at the root referencing every internal module.
- **Shared `go.sum`** semantics: each module has its own `go.sum`, but `go.work.sum` records hashes for entries used across the workspace.
- **CI matrix per module**: each `go.mod` is tested independently so that a transitive bump in module A does not silently degrade module B.
- **Fan-out builds**: changes touching `go.work` trigger rebuilds of every module; changes inside one module trigger only that module's pipeline.

---

## Running a Private Module Proxy

The reference implementation is **Athens** (<https://github.com/gomods/athens>). Alternatives: JFrog Artifactory, Sonatype Nexus, and the lightweight `goproxy.io` fork.

### Why run one

- **Resilience.** `proxy.golang.org` does go down. A private cache survives the outage.
- **Audit.** You see exactly which third-party modules your org imports.
- **Closed source.** Internal modules served via the same protocol developers already use.
- **Cost / latency.** Hot dependencies served from local disk are faster than transatlantic HTTPS.

### Athens topology

Athens is a single Go binary. It speaks the proxy protocol. Storage backends:

- Local disk (good for a single-node deploy).
- GCS / S3 (good for HA and multi-region).
- MongoDB / Postgres (legacy).

Typical config (`config.toml`):

```toml
GoBinary = "go"
StorageType = "s3"
[Storage.S3]
Region = "us-east-1"
Bucket = "corp-go-modules"
```

Run behind a reverse proxy with TLS termination. Optionally enable basic auth or mTLS for private modules.

### Wiring developers

```
GOPROXY=https://athens.corp.example.com,https://proxy.golang.org,direct
GOPRIVATE=corp.example.com/*
GOSUMDB=off       # for private paths only — see GONOSUMCHECK below for hybrid setups
```

The toolchain tries Athens first, falls back to the public proxy on miss, and finally to direct VCS. Athens populates its cache on first miss and serves from disk thereafter.

### Artifactory

Artifactory's "Go Registry" speaks the proxy protocol identically. The trade-off: a heavier deployment and a license cost, in exchange for unified artifact management across npm, Maven, Docker, and Go.

---

## Operating GOPRIVATE / GONOSUMCHECK / GOSUMDB

These three environment variables control how the toolchain handles modules that should not contact public services.

| Variable | Meaning |
|----------|---------|
| `GOPRIVATE=corp.example.com/*,github.com/acme-priv/*` | Modules matching these globs skip the public proxy *and* the sum DB. |
| `GONOPROXY=corp.example.com/*` | Modules matching skip the proxy but still consult the sum DB. (Rarely useful.) |
| `GONOSUMCHECK=corp.example.com/*` | Modules matching skip sum-DB lookup but still go through the proxy. (Rare.) |
| `GOSUMDB=off` | Disable the sum DB entirely. (Last resort; loses tamper detection.) |
| `GOSUMDB=sum.example.com+abcdef <key>` | Point at a private sum DB. |

For most organizations the rule is simple: set `GOPRIVATE` to the union of all private module-path prefixes and leave `GOSUMDB` at default. The toolchain will not leak private paths to the public proxy or sum DB, while public dependencies remain checksum-verified.

Hybrid pitfall: a developer who sets `GOSUMDB=off` globally to "make corp modules work" disables tamper detection for *all* modules, including public ones. Always prefer `GOPRIVATE` over disabling the sum DB.

---

## SBOM Generation and Compliance

A Software Bill of Materials (SBOM) lists every dependency that ships in your binary. For Go projects, two tools dominate:

### `cyclonedx-gomod`

```
go install github.com/CycloneDX/cyclonedx-gomod/cmd/cyclonedx-gomod@latest
cyclonedx-gomod app -licenses -json -output sbom.cdx.json ./cmd/server
```

Output is CycloneDX JSON (or XML), the de-facto SBOM standard for many enterprise procurement workflows.

### `syft`

```
syft dir:. -o cyclonedx-json > sbom.cdx.json
syft dir:. -o spdx-json > sbom.spdx.json
```

Syft supports both CycloneDX and SPDX. Useful when downstream tooling expects SPDX (e.g., some federal procurement pipelines).

### What goes into a Go SBOM

- Direct dependencies from `go.mod`.
- Transitive dependencies pinned in `go.sum`.
- Module versions, licenses (when extractable), and source URLs.
- Optionally, the Go toolchain version and stdlib version.

### Where SBOMs go

- Attached to release artifacts (GitHub Releases, GitLab packages).
- Pushed into supply-chain attestation systems (in-toto, SLSA provenance).
- Ingested by procurement scanners on the customer side.
- Used by your own vulnerability scanner as input.

---

## Vulnerability Scanning Integration

### `govulncheck`

The official tool. Distributed as `golang.org/x/vuln/cmd/govulncheck`.

```
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

Behavior:

- Loads all packages reachable from the analysis root.
- Cross-references each function with the Go vulnerability database (`vuln.go.dev`).
- Reports only vulnerabilities that are *call-graph reachable*. A vulnerable function in a transitive dependency is silent if your code never calls it.

This is more precise than scanners that flag every CVE that touches `go.sum`. The trade-off: false negatives are possible if reflection or build tags hide a call path.

You can also run against a built binary:

```
govulncheck -mode=binary ./bin/server
```

Same database, less precise call-graph (binary stripped, but symbol presence still useful).

### Snyk and Dependabot

- **Snyk** — commercial. Scans `go.mod`/`go.sum` directly. Broader CVE coverage than `govulncheck`'s curated list, but no call-graph reachability.
- **Dependabot** (GitHub-native) — scans `go.mod`, opens PRs for affected versions. Combined with `govulncheck` in CI for reachability filtering.

### CI integration

```yaml
- name: govulncheck
  run: |
    go install golang.org/x/vuln/cmd/govulncheck@latest
    govulncheck ./...
```

Fail the build on any reachable vulnerability above a chosen severity threshold. Use a `vuln-allowlist.txt` (managed in the repo) for accepted-and-tracked exceptions.

---

## License Compliance

### `go-licenses`

```
go install github.com/google/go-licenses@latest
go-licenses report ./... > licenses.csv
go-licenses check ./... --disallowed_types=forbidden,restricted
```

`go-licenses` walks the dependency graph, classifies each module's license (using SPDX identifiers), and emits either a report or a pass/fail check. The `forbidden` category covers GPL-incompatible licenses; `restricted` covers strong copyleft.

### OSS Review Toolkit (ORT)

ORT is the heavyweight option. It produces detailed compliance reports, supports multiple ecosystems (not just Go), and integrates with policy engines. Use ORT when procurement or legal demands an audit trail beyond a CSV.

### Common workflow

1. CI runs `go-licenses report` on every build.
2. The output is uploaded as a build artifact.
3. A nightly job consolidates per-repo reports into an org-wide dashboard.
4. Legal reviews changes — additions of new licenses are flagged for sign-off.
5. `go-licenses check --disallowed_types=...` blocks merges that introduce forbidden licenses.

---

## CI/CD Strategy for Dependency Updates

Stale dependencies accumulate vulnerabilities, license drift, and breaking-change debt. Stay current with a structured update cadence.

### The weekly tidy

```yaml
on:
  schedule:
    - cron: '0 6 * * 1'    # Monday 06:00 UTC
jobs:
  tidy:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version-file: go.mod }
      - run: |
          go get -u ./...
          go mod tidy
          go test ./...
      - uses: peter-evans/create-pull-request@v6
        with:
          branch: chore/weekly-deps
          title: 'chore: weekly dependency refresh'
```

If tests pass, a PR is opened and merged automatically (or after one human approval). If tests fail, the PR captures the breakage for triage.

### Renovate / Dependabot

Both open one PR per dependency upgrade. Recommended config:

- Group patch and minor updates into a single PR per week.
- Open major-version updates as separate PRs with a "breaking change" label.
- Auto-merge patch upgrades when CI is green.
- Require human review for minor and major upgrades.

### Security-driven updates

Dependabot security alerts open PRs immediately when a CVE is published. These should bypass the weekly cadence and be merged within hours, not weeks.

### Manual review for breaking-change candidates

Major-version upgrades (`v1` → `v2`) require touching imports across the codebase. Reserve a maintenance window. Run the full integration suite. Coordinate with downstream consumers if you are a library.

---

## Edge Cases the Toolchain Source Reveals

A close read of `cmd/go/internal/modload`, `modfetch`, and `golang.org/x/mod` surfaces edges most users never hit:

- **Renamed module.** A module's import path can change (vanity URL flips, transfers between maintainers). Old paths still resolve as long as the original VCS host serves the meta tag and the new module continues to publish under the new path. Consumers see the rename only when they next bump.
- **Retracted versions.** A `retract v1.4.3` directive in `go.mod` makes the toolchain skip that version silently in `go get @latest`. Existing pinned consumers continue to use it, but new fetches go to the next-lowest non-retracted version. There is no error, no warning — just absence. Diagnose with `go list -m -retracted -versions example.com/lib`.
- **Major version without `/vN`.** A module that publishes `v2.0.0` without renaming to `/v2` becomes `v2.0.0+incompatible`. Consumers who explicitly request `example.com/lib/v2` fail with "no matching versions." Consumers who request `example.com/lib@v2.0.0` get the `+incompatible` shim. Confusing on first encounter; documented at <https://go.dev/ref/mod#non-module-compat>.
- **Vanity import paths.** A path like `lib.example.com/foo` is not a real Git host. The toolchain fetches `https://lib.example.com/foo?go-get=1`, parses the `<meta name="go-import">` tag, and uses its content to find the real VCS. Misconfigure the tag and every fetch fails with an opaque "unrecognized import path."
- **Module path case.** `GitHub.com/Acme/Lib` and `github.com/acme/lib` resolve to the *same* repo on GitHub but to *different* modules in Go's view. The toolchain rejects mixed case at validation time. The `!`-encoding in cache paths preserves the canonical lower-case form.
- **Download-only fetches.** `go mod download` fetches without modifying `go.mod`. Useful for primer jobs and read-only CI checks.
- **Empty proxy responses.** A proxy that returns 404 on `.info` is treated as "version does not exist." A proxy that returns 410 Gone is a permanent absence. The toolchain falls through to the next entry in `GOPROXY`.

These are not memorization material — they are signposts to *read the source* when something unexpected happens. The toolchain is open source and the relevant files are short.

---

## Operational Playbook

A condensed reference for common operational scenarios.

| Scenario | Recipe |
|----------|--------|
| Add a new public dependency | `go get example.com/lib@latest && go mod tidy` |
| Add a private (corp) dependency | Set `GOPRIVATE`; configure proxy auth; `go get corp.example.com/lib@latest` |
| Pin a dependency to a specific commit | `go get example.com/lib@<commit-sha>` (toolchain converts to pseudo-version) |
| Upgrade to a new major version | Edit imports to `/v2`; `go get example.com/lib/v2@latest`; `go mod tidy` |
| Avoid `+incompatible` shim | Move to a `/vN` import path or stay on v1.x |
| Set up a private proxy | Deploy Athens or Artifactory; set `GOPROXY` and `GOPRIVATE` org-wide |
| Generate an SBOM | `cyclonedx-gomod app -json -output sbom.cdx.json ./...` |
| Scan for vulnerabilities | `govulncheck ./...` in CI; gate merges on findings |
| Check licenses | `go-licenses check ./... --disallowed_types=forbidden,restricted` |
| Weekly dependency refresh | Scheduled CI job: `go get -u ./... && go mod tidy && go test ./...`; auto-PR |
| Auto-merge security patches | Dependabot security alerts + branch protection requiring CI-green |
| Recover from a retracted version | `go list -m -retracted -versions ...`; pick a non-retracted version; `go get` |
| Diagnose vanity-path failure | `curl -s 'https://path?go-get=1'`; inspect `<meta name="go-import">` |
| Pre-warm CI cache | Daily job runs `go mod download all` against active branches |
| Monorepo per-module CI | Iterate `find . -name go.mod`; test each module independently |

---

## Summary

`go get` is one HTTP fetch on the surface and a supply-chain operation underneath. The professional engineer's understanding includes the proxy protocol, the pseudo-version algorithm, the module cache's filesystem semantics, the rules behind `+incompatible`, and the operational layer above all of that: private proxies, SBOMs, vulnerability scanners, license auditors, and the CI cadence that keeps dependencies fresh without breaking the build.

The toolchain's ergonomics are deliberately quiet — most teams never need to think past `go get`. The reason this file exists is that *some* engineers do, and at scale the difference between an org that operates its dependency pipeline and one that drifts through it is measured in CVEs, audit findings, and reproducibility incidents. The simplicity at the user surface is what allows the operational machinery underneath to be rich.
