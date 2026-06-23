# `go mod vendor` — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Vendor-or-Not Decision: First Principles](#the-vendor-or-not-decision-first-principles)
3. [Vendor as a Supply-Chain Boundary](#vendor-as-a-supply-chain-boundary)
4. [Vendor as Audit Surface](#vendor-as-audit-surface)
5. [Vendor in Air-Gapped and Restricted Environments](#vendor-in-air-gapped-and-restricted-environments)
6. [Vendor and Reproducibility (vs `go.sum` alone)](#vendor-and-reproducibility-vs-gosum-alone)
7. [Vendor in Multi-Module Monorepos](#vendor-in-multi-module-monorepos)
8. [Vendor Drift in Long-Lived Branches](#vendor-drift-in-long-lived-branches)
9. [Repository Size and PR Diff Hygiene](#repository-size-and-pr-diff-hygiene)
10. [Vendor and `replace` in Production](#vendor-and-replace-in-production)
11. [Vendoring Patched Dependencies](#vendoring-patched-dependencies)
12. [CI Strategy with Vendored Builds](#ci-strategy-with-vendored-builds)
13. [Vendor and Toolchain / Go Version Pinning](#vendor-and-toolchain-go-version-pinning)
14. [Anti-Patterns](#anti-patterns)
15. [Senior-Level Checklist](#senior-level-checklist)
16. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with `go mod vendor` is not "do I run it" but "what does it cost the team, and what does it buy us that `go.sum` and a module proxy cannot." The command itself copies dependency source code into `vendor/` and writes `vendor/modules.txt`; once present, `go build` uses it instead of the module cache. Mechanically simple. Strategically loaded.

This file is about *the design and the trade-offs*. The mechanical content is in [junior.md](junior.md) and [middle.md](middle.md).

After reading this you will:
- Be able to decide whether to vendor based on supply-chain, compliance, and operational constraints
- Reason about vendor as an artefact of release engineering, not a personal preference
- Run vendored builds reliably in air-gapped, restricted, and audited environments
- Manage vendor drift, PR-diff noise, and patched dependencies without sacrificing reproducibility
- Avoid the anti-patterns that turn vendor from a guarantee into a liability

---

## The Vendor-or-Not Decision: First Principles

`go mod vendor` is a tool, not a value judgement. The decision is downstream of two real questions: *do you trust your proxy?* and *do you need code in your repo for non-build reasons?*

### What vendor actually buys you

Two things, neither of which `go.sum` alone provides:

1. **Hermetic offline builds.** With `vendor/` and `GOFLAGS=-mod=vendor` (or equivalently the auto-detection that triggers when `vendor/` exists and `go` ≥ 1.14), `go build` does not contact a proxy, a VCS host, or the checksum database. The build succeeds with no network. This matters in air-gapped CI, on a flight, in regulated environments where outbound traffic is restricted.
2. **Auditable code lives in your repo.** Every line of every dependency is a file on disk under your version control. License scanners, security tools, and human reviewers can read the dependency tree without ever talking to the public proxy. The audit trail is in `git log`.

### What vendor costs you

- **Repository size.** `vendor/` can be 50 MB to several GB depending on dependencies. Every clone, every fetch, every CI run pays this cost. CDN-backed Git hosts cope; old DVCS workflows do not.
- **PR diff noise.** A one-line change to a Go source file that pulls in a new dependency produces a 5,000-line diff in `vendor/`. Code review degrades. Review tools choke. Reviewers stop reading.
- **Hand-edit temptation.** Once dependency code is in your repo, somebody will be tempted to fix a bug "just here." That breaks reproducibility, breaks `go mod verify`, and is hard to spot in review.
- **Tooling friction.** Some tools (linters, language servers, IDE plugins) treat `vendor/` differently than the module cache, and edge cases occasionally surface.

### When the answer is yes

- You ship to environments without network access (regulated, on-prem, classified, or simply behind a strict egress policy).
- You are subject to audit regimes that require source code of all dependencies in the audited artefact (FedRAMP, certain finance/healthcare contracts, defence procurement).
- Your customers or compliance teams require a single tarball that builds without external dependencies.
- You operate a private proxy and want a belt-and-braces guarantee that even proxy outages do not block builds.

### When the answer is no

- You have a reliable module proxy (the public `proxy.golang.org`, or a corporate Athens/JFrog/GoProxy instance) and trust it.
- Your team is small enough that PR-diff hygiene matters more than offline guarantees.
- Your dependency footprint is large and changes frequently — vendor maintenance becomes a chore.
- You are happy to rely on `go.sum` plus the checksum database for integrity.

### When the answer is "yes, for the release branch only"

A common middle position: do not vendor on `main`; do vendor on long-lived release branches just before tagging. The release artefact is hermetic; the development branch is fast-moving and unburdened. This requires discipline (re-vendor on every release branch, regenerate `vendor/modules.txt` if upstream changes) but combines the benefits.

---

## Vendor as a Supply-Chain Boundary

The supply chain runs from upstream maintainer to your binary. `vendor/` defines a boundary on that chain.

### Without vendor

`go build` reads `go.mod` → resolves versions → fetches from `GOPROXY` → verifies against `go.sum` → compiles. The trust boundary is `GOPROXY` plus the checksum database. If either is compromised or unavailable at build time, your build is at risk.

### With vendor

`go build` reads `vendor/modules.txt` → compiles `vendor/`. The trust boundary moves to *git*. If your repository is intact and your reviewers approved every change to `vendor/`, the build is reproducible from your repository alone.

### The cryptographic argument

`go.sum` already gives you tamper detection: a malicious proxy cannot serve modified bytes without you noticing. So why move the boundary?

- **Availability.** Tamper detection does not help when the proxy is down. Vendor removes the proxy from the critical path.
- **Locality.** The audit trail lives in *your* git history, not on a third party's server. Some compliance regimes require this.
- **Mid-chain attacks.** A compromised proxy could *refuse to serve* a version, forcing a build to fail or to fall back to direct fetch. Vendor removes that pressure point.

`vendor/` does not protect you from a malicious dependency author — neither does `go.sum`. Both verify *what you got* matches *what you previously got*. Neither verifies *what you got is correct*. That is the social problem of supply-chain security; tooling cannot solve it.

### Vendor as an "approval gate"

Many security-conscious teams treat any change to `vendor/` as requiring a heightened review. The mental model: dependency code entering your binary should pass the same gates as your own code. CODEOWNERS rules can require security or platform team sign-off on `vendor/` changes. This is harder to enforce when dependencies live only in `go.sum`.

---

## Vendor as Audit Surface

Compliance and audit are where vendor pays its highest dividends.

### SBOM generation without network access

A Software Bill of Materials lists every dependency, its version, and its license. SBOM tools (`syft`, `cyclonedx-gomod`, `go-licenses`) can read `go.mod` + `go.sum` and ask the proxy for license metadata, *or* they can read `vendor/` directly. The latter is faster, deterministic, and works offline.

For projects under FIPS, FedRAMP, or strict customer audit, the auditor often wants:
1. The exact source code that produced the binary, archived in the repository.
2. License information derived from those source files, not from a third-party metadata service.
3. A reproducible build process that does not depend on external services.

`vendor/` satisfies all three. `go.sum` alone does not — the auditor has to trust the proxy's metadata.

### License review

License compliance is fundamentally a review of source files (LICENSE, COPYING, file headers). With `vendor/`:

- The legal team checks out the repo and runs their scanner. No tooling configuration, no proxy access.
- Re-review on a PR is a matter of `git diff vendor/`. Adding a GPL dependency to a permissively-licensed project shows up immediately.
- The audit artefact is signed by your VCS commit hash, not by a transient proxy response.

### Security review

Static analysis tools (`gosec`, `govulncheck`, custom scanners) can run on `vendor/` directly. This means:

- A new CVE disclosed against `golang.org/x/crypto` can be checked locally: does our vendored copy contain the vulnerable code path? No proxy round-trip, no version juggling.
- Forensic incident response on a deployed binary becomes deterministic: the source that built it is in the corresponding git tag, byte-for-byte.

### Reproducibility for incident response

Six months after a release, a customer reports a bug. With `vendor/`, you `git checkout <tag>` and `go build` produces the exact same binary, regardless of whether `proxy.golang.org` still serves the same versions, regardless of whether the original VCS hosts still exist, regardless of whether transitive dependencies have been republished. That is the reproducibility property that audit regimes ask for.

---

## Vendor in Air-Gapped and Restricted Environments

Some environments do not have outbound network access at build time. Defence networks, isolated CI runners, on-prem customer installations, regulated data centres. Vendor is the canonical solution.

### The canonical air-gapped workflow

```
GOFLAGS="-mod=vendor"
GOPROXY=off
GOSUMDB=off
```

`-mod=vendor` forces the build to use `vendor/`. `GOPROXY=off` ensures any accidental fetch attempt fails loudly rather than hanging. `GOSUMDB=off` disables the checksum database (which would also require network).

With these three settings, `go build` is hermetic. It will refuse to fetch anything; it will use only what is on disk.

### Alternatives to vendor in air-gapped builds

- **Pre-populated module cache.** Run `go mod download` on a connected machine, archive `$GOMODCACHE`, ship it to the air-gapped environment. Works, but requires path conventions and is fragile across machine boundaries.
- **Private proxy mirror.** Run an internal Athens/Artifactory proxy that the air-gapped network *can* reach. Works, but adds operational surface.
- **Vendor.** Code is in the repo. No external infrastructure required.

For one-shot, single-machine builds, vendor is simplest. For a fleet of air-gapped builders, a private proxy may scale better; vendor still works as a belt-and-braces fallback.

### Subtleties

- `GOSUMDB=off` *disables* checksum-database verification. It does not disable `go.sum` checking. With `vendor/`, `go.sum` is consulted only when populating the vendor directory; subsequent builds skip it.
- `-mod=vendor` is automatic when `vendor/` exists and `go` ≥ 1.14, but pinning the flag explicitly in `GOFLAGS` makes the intent visible in CI logs.
- `vendor/modules.txt` is the authoritative manifest the toolchain uses; if it is stale relative to `go.mod`, the build will fail. See [Anti-Patterns](#anti-patterns).

---

## Vendor and Reproducibility (vs `go.sum` alone)

Reproducibility means: same input → same output, forever. Both `go.sum` and `vendor/` provide it, with different threat models.

### `go.sum` reproducibility

- *Strength.* Cryptographic. Tamper detection is bit-perfect.
- *Weakness.* Requires the proxy (or a direct VCS fetch) to be reachable and to still serve the relevant versions. Some upstream repos disappear; some versions get retracted. The checksum verifies what you got — but if you cannot get anything, there is nothing to verify.

### `vendor/` reproducibility

- *Strength.* Self-contained. The bytes are in your repo. As long as git history is preserved, the source is preserved.
- *Weakness.* Trust shifts to the social layer: nobody must hand-edit `vendor/`, and `vendor/modules.txt` must remain consistent with `go.mod`. Tooling helps (`go mod verify`, `go mod vendor` in CI to detect drift), but the discipline is real.

### When both fail

Hand-edits to `vendor/` are the most common reproducibility break. `go mod verify` catches mismatches between `vendor/` content and the original module hashes — eventually — but only when somebody runs it. CI must run `go mod verify` and `go mod vendor` (in dry-run / diff mode) on every PR to keep the system honest.

### The senior framing

`go.sum` gives you *integrity if you can fetch*. `vendor/` gives you *availability and audit*. They are not substitutes; they are different guarantees. Vendor without `go.sum` is incomplete; `go.sum` without vendor is fine if you trust your proxy. Most teams that vendor still keep `go.sum` committed — the toolchain requires it.

---

## Vendor in Multi-Module Monorepos

A monorepo with multiple `go.mod` files multiplies the vendor decision per module.

### Per-module vendoring

Vendoring is a per-module operation. `go mod vendor` in module A produces `A/vendor/`; running it in module B produces `B/vendor/`. They do not share. If both modules depend on `golang.org/x/sync v0.10.0`, the source code lives in both `A/vendor/` and `B/vendor/`, byte-identical but duplicated.

For a monorepo with ten modules and a hundred shared dependencies, the duplication is significant — both in repo size and in coordination cost. Bumping a shared dependency means re-vendoring in every module that uses it, in a coordinated PR.

### Coordination patterns

- **All-or-nothing.** Either every module in the monorepo is vendored, or none are. Mixing makes tooling and review inconsistent.
- **Shared base module.** Push common dependencies into a shared internal module that other modules depend on. Reduces duplication at the cost of indirection.
- **Single-module monorepo.** Some teams faced with the multiplication cost simply consolidate to one `go.mod` for the whole repo. Loses some isolation but trivially solves vendor coordination.

### Workspaces (`go.work`) and vendor

`go.work` does not interact directly with `vendor/`. The workspace overlay tells the toolchain how to resolve cross-module imports during local development; it does not produce a unified vendor tree. For released artefacts, each module is still vendored independently. This is a common surprise.

### The senior take

For multi-module monorepos at scale, vendor is often abandoned in favour of a hardened private proxy. The duplication cost grows quadratically with module-count × shared-dep-count. If you must vendor, design the module boundaries to minimise dependency overlap.

---

## Vendor Drift in Long-Lived Branches

A long-lived release branch is the most dangerous place for `vendor/`.

### The drift scenario

You cut `release/v1.10` from `main` six months ago. `vendor/` was correct then. In the meantime:

- `golang.org/x/net` released a security patch.
- An upstream dependency was retracted for a critical bug.
- Several transitive dependencies issued CVE fixes.

Today, you tag `v1.10.5` from that branch. The build succeeds because `vendor/` is intact. But `vendor/` is six months old; it contains the unpatched CVE-vulnerable code.

`go.sum` alone has the same problem (versions in `go.mod` are pinned), but the *signal* is different: with `go.sum`, a CI scan against a CVE database flags the pinned version. With `vendor/`, scanners may scan the vendored source directly and still flag it — but the team mental model often skips this step ("we already vendored, we are fine").

### Mitigation

- **Re-vendor before every release tag.** Run `go mod tidy && go mod vendor` as part of the release-prep pipeline. This forces the question: *do we want the latest patches?* The answer is usually yes.
- **Run vulnerability scans on the release branch.** `govulncheck` works against vendored sources. Run it in CI; fail the release if known CVEs are present.
- **Document the vendor refresh policy.** "Every release tag re-runs `go mod vendor`. If we deliberately want to ship an old vendor, we document why."
- **Time-box release branches.** A release branch that is more than three months old should be treated as suspicious. Either close it out or refresh it.

### The forensics view

After an incident traceable to a known-fixed CVE, the question "why was the patched version not in our vendor tree?" is usually answered by "release branch was old and nobody re-vendored." A senior engineer designs the release process to prevent this.

---

## Repository Size and PR Diff Hygiene

The largest day-to-day cost of vendor is what it does to code review.

### The diff problem

A PR that adds one line to one Go file and pulls in a new dependency produces:

- 1 line changed in your code.
- 1 line in `go.mod`.
- A handful of lines in `go.sum`.
- 5,000 lines added in `vendor/` (the new dependency and its transitive closure).

GitHub renders the PR with the vendor diff dominating. Code review attention is finite; reviewers either glaze over the vendor diff (defeating the audit benefit) or stop reviewing the actual code change (defeating the change).

### Strategies

- **Commit vendor changes separately.** A two-commit PR: one for the source change, one for the vendor regeneration. Reviewers can read each independently. Tooling that hides whitespace-only commits will hide vendor commits from the default view.
- **`.gitattributes` linguist-vendored.** Mark `vendor/**` as `linguist-vendored=true` and `linguist-generated=true`. Most code-review tools (GitHub, GitLab) collapse the diff by default. Reviewers can expand it deliberately when they want to look.
- **Per-file diff filters.** Some CI tools post a comment with "code changes only" diff statistics, separating vendor from actual code. Keeps the signal-to-noise ratio readable.
- **Dependency-update bots in their own PRs.** Renovate, Dependabot, and similar tools make dependency upgrades into separate PRs. The vendor diff is the entire PR — there is no real code to obscure. Reviewers know what they are looking at.
- **Dedicated reviewers.** Some teams assign vendor PRs to platform/security reviewers who do not review feature code. The vendor diff goes to the people who actually understand it.

### The repo-size question

A vendored monorepo can be large. Strategies:

- Host on a Git server that handles large repos well (GitHub, GitLab, Bitbucket all do — Gerrit and old self-hosted Git can struggle).
- Avoid `git lfs` for `vendor/`; the contents are text and play badly with LFS semantics.
- Use shallow clones (`git clone --depth=1`) in CI when full history is not needed. Most modern CI systems do this by default.

### The cultural problem

The deepest cost is not technical, it is cultural: when reviewers learn to ignore vendor diffs, the audit benefit evaporates. The diff is in the repo, but nobody is reading it. Senior engineers either invest in tooling to make vendor diffs reviewable (license scans, CVE scans, structured comments on vendor PRs) or admit that the audit benefit is not real for their team.

---

## Vendor and `replace` in Production

`replace` directives interact with `go mod vendor` in ways that surprise teams.

### Replaced modules in vendor

When you `go mod vendor`, replaced modules are vendored from the *replacement target*, not the original. `vendor/modules.txt` records the replacement; the source under `vendor/` is the replacement source.

```
replace github.com/upstream/lib => github.com/yourcorp/lib v1.5.0-fork.1
```

After `go mod vendor`, `vendor/github.com/upstream/lib/` contains the source from `yourcorp/lib v1.5.0-fork.1`. The path under `vendor/` matches the *original* import path, but the bytes match the *replacement*.

### Local-path replacements

```
replace github.com/upstream/lib => ../local-fork
```

Local-path replacements vendor *from disk*. The bytes in `vendor/` come from the local directory at the moment `go mod vendor` ran. This means:

- The vendored source can drift from the local directory over time without anyone noticing.
- Re-running `go mod vendor` re-snapshots whatever is currently in the local directory, including uncommitted edits.
- `vendor/` is the source of truth at build time; the local directory becomes irrelevant after vendoring.

This is dangerous in production. Never commit a local-path `replace` to a vendored repo unless the local path is itself committed (e.g. another module in the same monorepo).

### Senior recommendation

- For permanent forks: replace to a tagged commit of a forked repository, vendor it, commit. Document the replacement and the upstream issue tracker reference.
- For local development: use `go.work` (which does not affect `vendor/`) instead of committed `replace`.
- For CI: fail the build if `replace` directives point to local paths, unless the path is whitelisted (e.g. a sibling module).

---

## Vendoring Patched Dependencies

The most legitimate use of vendor in security-conscious teams: shipping a patched version of an upstream dependency.

### The scenario

A CVE is disclosed in `github.com/affected/dep v1.2.0`. Upstream has not released a fix; the maintainer is unresponsive or backlogged. You need to ship a fix today.

### The right workflow

1. **Fork the upstream repository.** Branch from the affected version's tag. Apply the minimal fix. Tag a private version (`v1.2.0-cve-fix.1`).
2. **Add a `replace` directive** pointing the original import path to your fork at the new version.
3. **Run `go mod vendor`.** The vendored source is now from your fork.
4. **Commit `go.mod`, `go.sum`, and `vendor/`** in one PR. Reference the CVE, the upstream issue, and the fix in the commit message.
5. **Track upstream.** When upstream releases a real fix, remove the `replace`, upgrade to the upstream-fixed version, re-vendor, commit.

### The wrong workflow

1. Edit `vendor/github.com/affected/dep/foo.go` directly to apply the fix. Commit.

This is forbidden, even though it appears simpler. Reasons:

- `go mod verify` will fail on the next run because the bytes do not match the upstream module hash.
- The next person to run `go mod vendor` (perhaps in a year, when upgrading a different dependency) will overwrite your fix without warning.
- The audit trail is wrong: `vendor/modules.txt` claims the vendored bytes are version v1.2.0, but they are not.
- License and compliance scanners will see the official version metadata, not your edit. The auditor will see one thing; the reality is another.

### The hard rule

**Hand-editing `vendor/` is forbidden.** Socially, in code review, in CI policy. If you need to patch, fork-and-replace. There is no other acceptable answer in a production codebase.

---

## CI Strategy with Vendored Builds

Vendor changes the shape of CI workflows.

### The build path

```
go build -mod=vendor ./...
go test -mod=vendor ./...
```

With `vendor/` present and `go` ≥ 1.14, `-mod=vendor` is the default; explicit flags make the intent visible in logs.

### Verifying vendor consistency

CI must guard against vendor drift. Two checks:

1. `go mod verify` — confirms `go.sum` matches the actual module sources.
2. `go mod vendor && git diff --exit-code vendor/ go.mod go.sum` — confirms `vendor/` is up-to-date with `go.mod`. If a developer edits `go.mod` without re-vendoring, this catches it.

These two checks together are the contract: `vendor/` must always be regenerable from `go.mod`, with no surprises.

### Caching

Without vendor, CI typically caches `$GOMODCACHE` between runs. With vendor, that cache is irrelevant — `vendor/` is the source of truth and is checked out as part of the repo. The trade-off:

- *Without vendor:* small repo clone, large module cache to manage, network during cache miss.
- *With vendor:* large repo clone (one-time), no module cache, no network.

For ephemeral CI runners, vendor is often faster overall because the clone amortises across many cached layers, while module-cache restoration has a per-job cost.

### Network policies

In a vendored CI:

```
GOFLAGS="-mod=vendor"
GOPROXY=off
GOSUMDB=off
GOTOOLCHAIN=local
```

`GOTOOLCHAIN=local` (Go 1.21+) prevents the toolchain from downloading a newer Go version mid-build, preserving the air-gapped property end-to-end.

### Release artefact

The release pipeline produces a tarball of the vendored repo. That tarball is the canonical build input. It is signed, archived, and reproducibly buildable by any party with the same Go toolchain version. This is the FedRAMP / FIPS / customer-audit deliverable.

---

## Vendor and Toolchain / Go Version Pinning

`vendor/` pins source code. It does *not* pin the Go toolchain.

### What vendor pins

- The exact bytes of every dependency package.
- The dependency graph (via `vendor/modules.txt`).
- Indirectly, `go.mod` and `go.sum`, which are still the source of truth for the module graph.

### What vendor does not pin

- The Go compiler version.
- The standard library version.
- The `go` directive's runtime semantics.
- The `toolchain` directive's selection.

A binary built from a vendored repo with Go 1.21 and the same vendored repo with Go 1.23 will differ — possibly subtly, possibly significantly. The standard library is *not* vendored (and cannot be); changes to `net/http`, `encoding/json`, or runtime behaviour propagate through.

### The full pinning recipe

For a truly reproducible build:

1. Vendor dependencies (`go mod vendor`).
2. Pin the Go version (`go` directive in `go.mod`, plus `toolchain` directive for 1.21+).
3. Pin the build environment (Docker image with a fixed Go version).
4. Pin the build flags (`-trimpath`, `-buildvcs=false`, deterministic `-ldflags`).
5. Pin `GOFLAGS` and `GOTOOLCHAIN` in CI.

Vendor is one of five layers. Treating it as the whole story produces builds that *seem* reproducible until somebody upgrades the CI image.

### Toolchain directive interaction

The `toolchain` directive (`toolchain go1.23.4`) tells Go which toolchain version to fetch if the local one is older. With `GOTOOLCHAIN=local`, this is overridden — the build uses whatever Go is installed, regardless of what `toolchain` says. In air-gapped vendored builds, you almost always want `GOTOOLCHAIN=local` plus a separate enforcement mechanism (CI image pinning) to ensure the right Go version is present.

---

## Anti-Patterns

- **Hand-editing `vendor/` to fix a bug.** Forbidden. Fork-and-replace, always.
- **Vendoring without first running `go mod tidy`.** Stale or unused entries in `go.mod` produce a stale `vendor/`. Always tidy then vendor.
- **Partial vendoring.** Some dependencies vendored, others fetched. `vendor/modules.txt` becomes inconsistent, and `-mod=vendor` will fail. Vendor is all-or-nothing per module.
- **Committing `vendor/` while leaving local-path `replace` directives in `go.mod`.** Builds on other machines silently use vendored bytes, but the apparent intent is to use the local fork. Confuses everyone.
- **Skipping `go mod verify` in CI.** Without verification, hand-edits and corrupted vendoring go undetected for months.
- **Treating vendor as a substitute for dependency review.** The bytes are in your repo, but nobody reads them. The audit benefit is hypothetical. Either invest in scanning or stop pretending vendor solves audit.
- **Vendoring a private corporate dependency along with public ones.** Mixing public and private bytes in the same `vendor/` is fine technically; the risk is that the private code accidentally ends up in a public build artefact. Use `internal/` paths and CI checks to prevent leakage.
- **Re-vendoring as part of unrelated PRs.** A PR titled "fix login bug" should not contain a vendor refresh. Vendor changes belong in their own PR or their own commit.
- **Tagging a release without re-vendoring on the release branch.** Vendor drift turns the release into a six-month-old snapshot of the dependency tree.
- **Vendoring without a `.gitattributes` `linguist-vendored=true` mark.** Code-review tools render the full diff, drowning out actual code changes.
- **Using `vendor/` and a private proxy and a public proxy without a clear policy** about which is authoritative when. Pick one.

---

## Senior-Level Checklist

- [ ] Decide vendor-or-not based on supply-chain, audit, and operational reality, not preference
- [ ] If vendoring: commit `vendor/` plus `go.mod` and `go.sum`; never one without the others
- [ ] Mark `vendor/**` as `linguist-vendored=true` in `.gitattributes`
- [ ] Run `go mod verify` and `go mod vendor && git diff --exit-code` in CI
- [ ] Run `govulncheck` against vendored sources, not just the module graph
- [ ] Re-vendor on every release tag; document the policy
- [ ] Forbid hand-edits to `vendor/`; enforce via review and CI
- [ ] For patched dependencies, fork-and-replace; never edit vendored bytes
- [ ] In air-gapped builds, set `GOPROXY=off`, `GOSUMDB=off`, `GOTOOLCHAIN=local`
- [ ] Pin the Go toolchain separately; vendor does not pin it
- [ ] In multi-module monorepos, decide all-or-nothing on vendoring
- [ ] Treat vendor PRs as security-relevant: assign appropriate reviewers
- [ ] Keep `replace` directives explicit, documented, and audited

---

## Summary

`go mod vendor` is a one-line command that copies a dependency tree into your repository. The senior responsibility is to decide whether that copy is worth its costs. The benefits are real and narrow: hermetic offline builds, and an auditable code surface that lives under your version control. The costs are real and broad: PR-diff noise, repository size growth, the social risk of hand-edits, and the operational overhead of keeping `vendor/` consistent with `go.mod`.

For most teams with a reliable proxy and no special compliance regime, vendor is unnecessary — `go.sum` plus a healthy proxy handles reproducibility. For teams in regulated, air-gapped, or audit-driven environments, vendor is the canonical answer, and the discipline of maintaining it is part of the job.

The mechanical command is trivial. The policy around it — when to re-vendor, who reviews vendor diffs, how to ship patched dependencies, how to keep release branches fresh — is what separates a vendored repo that gives you reproducibility and audit trail from a vendored repo that gives you only a 200 MB checkout and false confidence.
