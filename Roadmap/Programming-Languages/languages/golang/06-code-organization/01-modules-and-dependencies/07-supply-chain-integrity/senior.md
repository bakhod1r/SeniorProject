# Supply-Chain Integrity — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Threat Modeling the Go Supply Chain](#threat-modeling-the-go-supply-chain)
3. [Lessons from xz, SolarWinds, and event-stream](#lessons-from-xz-solarwinds-and-event-stream)
4. [Reproducible and Hermetic Builds](#reproducible-and-hermetic-builds)
5. [Build Provenance and `-trimpath`](#build-provenance-and-trimpath)
6. [SLSA Applied to Go](#slsa-applied-to-go)
7. [SBOMs for Go Modules](#sboms-for-go-modules)
8. [Capability Analysis with capslock](#capability-analysis-with-capslock)
9. [Dependency Governance at Scale](#dependency-governance-at-scale)
10. [Vulnerability Response as a Process](#vulnerability-response-as-a-process)
11. [Trust Boundaries and the Limits of Tooling](#trust-boundaries-and-the-limits-of-tooling)
12. [Designing the Pipeline: A Layered Strategy](#designing-the-pipeline-a-layered-strategy)
13. [Anti-Patterns](#anti-patterns)
14. [Senior-Level Checklist](#senior-level-checklist)
15. [Summary](#summary)

---

## Introduction

A senior engineer owns the *strategy*, not the commands. The question is not "how do I run `govulncheck`" but "what is our threat model, which risks are we accepting, where do we spend our limited verification budget, and what evidence can we produce when an auditor — or an incident — asks?" The mechanical content lives in [junior.md](junior.md) and [middle.md](middle.md). This file is about design and trade-offs.

After reading you will:
- Build a threat model for a Go service's supply chain and decide where to invest
- Reason about reproducible and hermetic builds as concrete, testable properties
- Apply the SLSA framework's levels to a Go pipeline and know what each level actually requires
- Generate, sign, and consume SBOMs as part of release engineering
- Use capability analysis to catch the attacks `govulncheck` cannot
- Run vulnerability response as a repeatable process, not a fire drill
- Articulate honestly what tooling can and cannot prevent

---

## Threat Modeling the Go Supply Chain

Effective supply-chain security starts by mapping the chain and asking, at each link, *who could inject code and how would we know.*

The links, from upstream to your running process:

```
maintainer → source host (VCS) → tag/release → module proxy →
checksum database → your go.sum → module cache → build toolchain →
build-time codegen → compiled binary → distribution → deployment
```

For each link, three questions:
1. **Who controls it?** (A third-party maintainer? GitHub? Google's proxy? Your CI?)
2. **What is the verification?** (`go.sum`, sumdb, signature, attestation, human review, nothing?)
3. **What is the blast radius if it is compromised?** (One package? Every build? Production?)

This produces a risk-ranked list. Two findings recur:

- **The highest-leverage attacks are not on individual packages but on shared infrastructure** — the proxy, the build system, the toolchain. Compromising one of these reaches every downstream build. (This is the SolarWinds insight.)
- **The most *likely* attack is a malicious update to a trusted dependency,** because it requires only compromising one maintainer account and exploits the automatic trust of version bumps.

Senior judgment is allocating effort proportionally: invest heavily in build-system integrity and update review (high likelihood × high blast radius), lightly in exotic scenarios. A threat model that treats every link as equally dangerous wastes the budget you actually have.

### Defining trust anchors

Every defense reduces to a *trust anchor* — something you decide to trust without further verification. For Go, the default anchors are: the Go team's checksum database, the public proxy, and the maintainers of your dependencies. Senior work is making those anchors *explicit* and deciding whether each is acceptable. An air-gapped or regulated environment may reject the public proxy as an anchor (replacing it with a vendored tree or a private mirror); a high-assurance shop may add human review of every dependency as an anchor of its own.

---

## Lessons from xz, SolarWinds, and event-stream

Three incidents define the modern threat model. None was a memory-safety bug; all were trust failures.

**xz/liblzma (2024).** A patient attacker spent ~two years becoming a trusted co-maintainer of a widely-used compression library, then shipped a backdoor hidden in build scripts and binary test fixtures, targeting sshd. The lessons for Go: *maintainer trust is earned slowly and abused suddenly*; *build-time artifacts (test data, generated files, build scripts) are an attack surface, not just runtime code*; and *obfuscation defeats casual review* — which is why automated capability analysis and reproducible builds matter more than "we read the diff."

**SolarWinds (2020).** Attackers compromised the *build system* and injected malicious code into signed releases of Orion. The code that shipped was correctly signed — because the signing happened *after* the injection. The lesson: *signing proves who built it, not that what they built is clean*; integrity must extend to the build environment itself (hermeticity, provenance, attestation), not just the final signature.

**event-stream (2018).** A maintainer handed off a popular npm package to a volunteer who then added a malicious dependency targeting a specific crypto wallet. The lesson: *ownership transfers are a risk event*; *a malicious transitive dependency is as dangerous as a direct one*; and *the payload can be narrowly targeted*, making it invisible to most users and most scanners.

The synthesis: modern supply-chain attacks exploit *social trust* (maintainer accounts, ownership) and *infrastructure trust* (build systems, proxies), and they hide in the *seams* (build scripts, transitive deps, signed-but-poisoned artifacts). Go's `go.sum` and `govulncheck` address the *integrity* and *known-vulnerability* dimensions; the seams require reproducible builds, provenance, and capability analysis.

---

## Reproducible and Hermetic Builds

Two related but distinct properties, both load-bearing for supply-chain assurance.

**Reproducible build:** the same source and toolchain produce a bit-for-bit identical binary, every time, on any machine. This is verifiable — independent rebuilds that match are evidence that the binary corresponds to the source and that no build-time tampering occurred. Go is unusually good at this: the compiler is deterministic, and with `-trimpath` (to remove absolute paths) and `-buildvcs` control, byte-identical output is achievable.

**Hermetic build:** the build depends only on declared, pinned inputs — no surprise network fetches, no ambient machine state, no unpinned tools. A hermetic build is a *precondition* for a trustworthy reproducible build, because a build that reaches the network mid-process can pull different bytes on different runs.

Achieving both in Go:

```bash
# Hermetic: no network, pinned everything
export GOFLAGS=-mod=vendor        # or a pre-populated, verified module cache
export GOPROXY=off
export GOSUMDB=off                # only because vendor/ already verified offline
export GOTOOLCHAIN=local          # do not fetch a different Go version mid-build
export CGO_ENABLED=0              # remove the C toolchain as an input (if feasible)

# Reproducible: deterministic output
go build -trimpath -buildvcs=false -ldflags='-s -w' -o app ./cmd/app
```

A reproducibility *gate* in CI proves the property holds:

```bash
go build -trimpath -o build1 ./cmd/app
go clean -cache
go build -trimpath -o build2 ./cmd/app
cmp build1 build2   # must be identical
```

If the binaries differ, something non-deterministic — embedded timestamps, VCS state, codegen, or a non-pinned input — is leaking. Finding and eliminating it is senior work, because each leak is a place tampering could hide undetected.

Pin the *toolchain* as deliberately as the dependencies: vendoring and `go.sum` freeze your dependency *source* but not the Go compiler, the standard library, or build-time tools. A truly hermetic build pins all of them (a fixed Go version via the `toolchain` directive and a fixed builder image).

---

## Build Provenance and `-trimpath`

Provenance is verifiable evidence of *how an artifact was produced*: which source commit, which builder, which toolchain, which flags.

`-trimpath` removes absolute filesystem paths from the binary (e.g. `/home/ci/work/...`). Two benefits: it stops leaking your build-machine layout (a minor information disclosure), and — more importantly — it removes a source of non-determinism, since absolute paths differ between machines and would otherwise break reproducibility.

Go also embeds VCS provenance automatically (`vcs.revision`, `vcs.time`, `vcs.modified`), readable via `go version -m`. This ties a binary back to a commit. In high-assurance pipelines you go further and emit a *signed provenance attestation* — a machine-readable statement, signed by your build system, asserting "this artifact (by hash) was built from this source (by commit) by this builder (by identity) with these parameters." This is the core of SLSA, below, and what would have detected SolarWinds: a provenance attestation generated by a hermetic builder cannot honestly claim an injected binary came from clean source.

The senior framing: `go version -m` gives you *self-reported* provenance (the binary describes itself). A signed attestation gives you *third-party-verifiable* provenance (the builder vouches for it, cryptographically). The gap between them is the gap between "trust me" and "verify me."

---

## SLSA Applied to Go

**SLSA** (Supply-chain Levels for Software Artifacts, pronounced "salsa", at [slsa.dev](https://slsa.dev)) is a framework of increasing build-integrity guarantees. The current model centers on **build levels**:

- **Build L1 — Provenance exists.** The build produces provenance describing how it was built. For Go: emit build metadata (commit, toolchain, flags). Cheap; mostly documentation.
- **Build L2 — Signed provenance from a hosted build service.** The provenance is generated by a managed build platform and signed, so it cannot be forged by a developer locally. For Go: build in GitHub Actions / a CI service that produces signed provenance (e.g. via the SLSA GitHub generator).
- **Build L3 — Hardened, isolated builds with non-falsifiable provenance.** The build runs in an isolated environment that the build's own steps cannot tamper with, and the provenance is generated by the platform in a way user steps cannot influence. This is the level that meaningfully resists a SolarWinds-style build-system compromise.

What each level *buys* you: L1 gives you an audit trail; L2 makes that trail forgery-resistant; L3 makes the *build itself* resistant to the attack that defeats signing. Most organizations target L2 as a pragmatic baseline and L3 for their most sensitive artifacts.

Concretely, for a Go project on GitHub:
- Use the official **SLSA GitHub Actions generator** to produce signed provenance for release binaries.
- Combine with reproducible builds (`-trimpath`, pinned toolchain) so the provenance's claims are independently verifiable.
- Publish the provenance alongside releases; consumers verify it before trusting your binary.

SLSA is a *framework*, not a tool — it tells you which guarantees to provide; you assemble Go's primitives (deterministic builds, embedded VCS info) plus a build platform (CI with provenance generation) plus signing (sigstore/cosign, covered in professional) to reach a given level.

---

## SBOMs for Go Modules

A **Software Bill of Materials** is a machine-readable inventory of everything in your artifact — every module, version, and (ideally) license and hash. It is the document that answers "are we affected by the new CVE in library X?" across an entire fleet in seconds, and it is increasingly a contractual and regulatory requirement.

Two standard formats:
- **CycloneDX** — security-focused, OWASP project, rich vulnerability and dependency-relationship modeling.
- **SPDX** — license- and compliance-focused, Linux Foundation, an ISO standard.

Generating an SBOM for a Go project:

```bash
# From source/module graph, CycloneDX:
cyclonedx-gomod mod -json -output sbom.cdx.json

# From a compiled binary (reads the embedded go version -m data):
cyclonedx-gomod bin -json -output sbom.cdx.json ./app

# syft handles both formats and many ecosystems:
syft ./app -o spdx-json > sbom.spdx.json
syft ./app -o cyclonedx-json > sbom.cdx.json
```

The binary-based path is powerful: because Go embeds module info, an SBOM generated from the *binary* reflects exactly what shipped, immune to any drift between `go.mod` and the actual build. That makes it the right source of truth for an artifact you are about to release or have already deployed.

Senior practice ties the SBOM into the lifecycle: generate it at build time, sign it (so consumers trust its provenance), attach it to the release, and scan it continuously against the vuln database so a newly-disclosed CVE against an already-shipped version raises an alert without rebuilding anything.

---

## Capability Analysis with capslock

`govulncheck` answers "do I call a *known-vulnerable* function?" It cannot answer "did this dependency just start doing something it has no business doing?" — which is exactly the signature of a malicious update.

**capslock** (from Google's Go team) fills that gap. It performs capability analysis: it determines which *capabilities* — network access, filesystem access, executing subprocesses, unsafe/reflection, reading environment — each dependency actually exercises, by static analysis of the call graph down into syscalls.

```bash
go install github.com/google/capslock/cmd/capslock@latest
capslock -packages ./...                      # human-readable capability report
capslock -packages ./... -output=json         # machine-readable, for diffing
```

The supply-chain use is *differential*: capture a baseline of each dependency's capabilities, then re-run after an update. A logging library that suddenly gains `CAPABILITY_NETWORK` or `CAPABILITY_EXEC` after a version bump is a glaring red flag — precisely the kind of change an `xz`-style backdoor introduces and precisely what version-number-based review misses. Wiring a capability diff into dependency-update PRs turns "we read the diff" into "the tooling flags any new privilege a dependency claims."

This is the layer that addresses the attacks `go.sum` and `govulncheck` structurally cannot: novel malice that is internally consistent (passes `go.sum`) and not yet catalogued (passes `govulncheck`) but behaviorally anomalous (caught by capability analysis).

---

## Dependency Governance at Scale

Beyond a single repo, supply-chain integrity is an organizational discipline.

**Centralize policy, distribute enforcement.** Define org-wide rules — allowed licenses, minimum SLSA level for vendored binaries, mandatory `govulncheck` gate, approved private proxy — once, and enforce them in shared CI templates or a policy engine, not per-repo by convention.

**Run a private proxy / mirror.** A corporate GOPROXY (Athens, Artifactory, a GoProxy instance) gives you: a stable trust anchor under your control, an audit log of exactly which versions were ever fetched, the ability to *block* a version org-wide the moment it is found malicious, and resilience against public-proxy outages. For many large orgs this replaces vendoring as the primary integrity mechanism.

**Maintain an allowlist or review gate for new dependencies.** Adding a *new* module to the org's trust boundary should be a reviewed event — a human asks "do we trust this maintainer, is the project healthy, is there a lighter alternative?" — not an unremarked side effect of a `go get`.

**Aggregate SBOMs and scan continuously.** Collect every service's SBOM into a central inventory. When a CVE drops, query the inventory: which services ship the affected module? This turns incident response from a manual audit into a database lookup.

The senior insight: at scale, the goal is to make the *secure* path the *path of least resistance* — shared CI templates that already include the scans, a private proxy that is simply the default GOPROXY, an SBOM that is generated automatically. Security that depends on every engineer remembering to do the right thing will fail at the first deadline.

---

## Vulnerability Response as a Process

When a CVE is disclosed against a dependency you use, ad-hoc scrambling is the failure mode. Senior engineers design the response as a repeatable process.

1. **Detect.** Continuous `govulncheck` (scheduled, not just on change) plus SBOM-based fleet scanning surface the exposure automatically.
2. **Triage.** Is it *actionable* (you call the vulnerable symbol) or *informational* (present but unreached)? `govulncheck`'s call-graph data drives the priority. Actionable findings in internet-facing, privileged services are P0; informational findings in internal tools are backlog.
3. **Remediate.** Upgrade to the fixed version (`go get module@fixed`), re-scan to confirm, and if no fix exists yet, mitigate: a `replace` directive to a patched fork (see [04-minimal-version-selection-mvs](../04-minimal-version-selection-mvs/senior.md) for how `replace` interacts with version selection), a configuration change that avoids the vulnerable path, or temporarily disabling the affected feature.
4. **Verify and ship.** Re-run `govulncheck`, regenerate the SBOM, build reproducibly, and deploy. The SBOM is now evidence that the fix shipped.
5. **Document.** Record what was affected, when it was detected, and when it was remediated. This is the audit trail regulators and customers ask for.

The forced choice when no upstream fix exists — wait, fork-and-patch, or mitigate — is a senior judgment call weighing exposure against the risk of carrying a fork. The point is that the *process* exists and is rehearsed, so the decision is made calmly under a known framework rather than invented at 2 a.m.

---

## Trust Boundaries and the Limits of Tooling

The most senior insight is knowing what the tools *cannot* do.

- **`go.sum` proves consistency, not correctness.** It verifies you got the same bytes as everyone else. If everyone got malicious bytes, everyone's `go.sum` agrees. It cannot vet intent.
- **The checksum database proves global agreement, not safety.** It is Certificate-Transparency-for-modules: it makes substitution *visible*, not impossible. A maliciously-published version is faithfully recorded.
- **`govulncheck` proves only the *catalogued* are absent.** A zero-day, an as-yet-unreported malicious package, or a vulnerability outside the database's coverage passes silently. "No findings" is "no *known* findings."
- **SLSA and provenance prove *how* it was built, not that the *source* is benign.** A hermetic, attested build of malicious source produces trustworthy provenance for a malicious binary.
- **Capability analysis flags *behavioral* anomalies, not all malice.** A backdoor that uses only capabilities the package legitimately already had will not stand out.

The unavoidable residual is *social*: someone, somewhere, decided to trust a maintainer, a project, a build platform. Tooling moves the trust boundary and makes violations *detectable*; it never eliminates trust. The senior responsibility is to make every trust decision *explicit and proportionate* — to know exactly what you are trusting, why, and what the blast radius is if that trust is misplaced — rather than to chase the impossible goal of a zero-trust supply chain.

---

## Designing the Pipeline: A Layered Strategy

Putting it together as a defense-in-depth design, each layer catching what the previous misses:

| Layer | Mechanism | Catches |
|-------|-----------|---------|
| Minimize | Few, reviewed dependencies | Reduces total attack surface |
| Integrity | `go.sum` + checksum DB (or private proxy) | Tampering, substitution |
| Vulnerability | `govulncheck` (CI + schedule) | Known, called CVEs |
| Behavior | capslock capability diff on updates | Malicious updates with new privileges |
| Provenance | Reproducible + hermetic build, SLSA L2/L3 | Build-system compromise |
| Inventory | Signed SBOM, continuous fleet scan | Newly-disclosed CVEs in shipped artifacts |
| Governance | Private proxy, dependency review, policy-as-code | Org-wide consistency, fast kill-switch |

No single row is sufficient. Typosquatting is caught by review and minimization; tampering by integrity; known CVEs by scanning; malicious updates by behavior analysis; build-system attacks by provenance; latent exposure by inventory. A pipeline that has only the integrity row (a common starting point) is blind to four of the five threat categories.

The senior job is to decide *which rows this organization needs* given its threat model and to invest accordingly — not to implement all of them everywhere regardless of risk.

---

## Anti-Patterns

- **Treating `go.sum` as a safety guarantee.** It is a consistency guarantee. Pairing it with "we are secure" is a category error.
- **Scanning only on change.** CVEs are disclosed against unchanged, already-shipped code. A `push`-only scan has a blind spot the size of your deployment lifetime.
- **Signing without hermeticity.** A signature on a binary built in a compromisable environment is SolarWinds. Sign the output of a hermetic, attested build, not just any build.
- **Auto-merging dependency updates without the full check suite.** The convenience optimizes for the exact vector (malicious update) you most need to catch.
- **Over-broadening `GOPRIVATE`/`GONOSUMDB`.** Disabling integrity for everything to accommodate one private namespace.
- **Generating an SBOM and filing it.** An SBOM that is not *continuously scanned* against the vuln database is a snapshot of a problem, not a control.
- **Vendoring as a security checkbox.** Vendored code is still vulnerable code; a stale vendor tree is worse than none because it freezes you on unpatched versions while looking diligent.
- **Trusting `govulncheck`'s silence as proof of safety.** It proves the absence of *known, reachable* issues, nothing more.
- **One pipeline for all artifacts.** A throwaway internal tool and an internet-facing privileged service do not need the same SLSA level. Uniform policy wastes budget or under-protects the crown jewels.
- **Leaving the toolchain unpinned.** Freezing dependencies but not the compiler leaves a build-time hole the size of the toolchain.

---

## Senior-Level Checklist

- [ ] Maintain a written threat model mapping each supply-chain link to control and blast radius
- [ ] Invest proportionally: heaviest on build integrity and update review (high likelihood × blast radius)
- [ ] Make trust anchors explicit (proxy, sumdb, maintainers, build platform) and validate each
- [ ] Achieve and *gate* reproducible builds (`-trimpath`, pinned toolchain, `cmp` in CI)
- [ ] Run hermetic builds (`GOPROXY=off`/vendor, `GOTOOLCHAIN=local`) for release artifacts
- [ ] Emit and sign build provenance; target SLSA L2 baseline, L3 for sensitive artifacts
- [ ] Generate signed SBOMs (CycloneDX/SPDX) from the *binary*, and scan them continuously
- [ ] Add capability-diff (capslock) to dependency-update review
- [ ] Run `govulncheck` on change *and* schedule; triage actionable vs informational
- [ ] Operate a private proxy as a controllable trust anchor and org-wide kill-switch
- [ ] Treat new-dependency adoption as a reviewed event, not a `go get` side effect
- [ ] Maintain a rehearsed vulnerability-response process with documented decisions
- [ ] Know and communicate what the tooling cannot prevent; keep trust decisions explicit

---

## Summary

Senior supply-chain integrity is strategy under a budget. It starts with a threat model that maps every link — maintainer to running process — to its controller, its verification, and its blast radius, and it allocates effort proportionally: heaviest where likelihood meets reach, which the xz, SolarWinds, and event-stream incidents locate squarely at *trusted updates* and *build-system integrity*. Go's primitives — `go.sum`, the checksum database, deterministic builds, embedded module info — supply the integrity and provenance dimensions; you assemble them with reproducible and hermetic build practices, SLSA-aligned signed provenance, SBOM generation and continuous fleet scanning, `govulncheck` for known vulnerabilities, and capability analysis for the novel-malice gap that scanning structurally cannot close. The layers compose into defense in depth where each catches what the others miss, and governance at scale makes the secure path the default path via private proxies, policy-as-code, and reviewed dependency adoption. The deepest senior insight is the honest one: tooling moves trust boundaries and makes violations detectable, but it never removes trust. The job is to make every trust decision explicit and proportionate — to know exactly what you trust, why, and what breaks if you are wrong.
