# Release Engineering Roadmap

> *"A build produces a binary; a release produces a promise."*

This roadmap is about **turning built artifacts into releasable, traceable, reversible deliveries**: how you version them, describe what changed, cut them on a branch or a train, sign them so consumers can trust their origin, push them to a registry, expose them progressively behind flags, take them back when they fail, automate the whole pipeline, and defend the chain that produced them. Release engineering is the discipline that lets you say with confidence *what* was shipped, *when*, *by whom*, and *how to undo it*.

> Looking for *building the artifact* (compile, link, package, cache)? See [Build Systems](../build-systems/).
>
> Looking for *deploying the artifact* (Docker, Kubernetes, rollout mechanics)? See the [DevOps](../../../DevOps/) section.
>
> For *CI/CD pipeline design* end-to-end, pair this roadmap with the `ci-cd-pipeline-design` skill.
>
> For *API versioning specifically* (HTTP/gRPC contracts, deprecation in transit), pair with the `api-versioning` skill.

---

## Why a Dedicated Roadmap

Release engineering lives between the build and the deploy, and it is the part teams most often skip until a bad ship forces the lesson. Versioning is policy, not syntax. A changelog is a contract with users. A rollback path is not a fallback — it is part of the release. A signature is the difference between "we built this" and "we can prove we built this." Understanding releases *as a category* — semver vs calver, RC promotion, signed provenance, feature flags, supply-chain attestation — keeps you fluent across `cargo publish`, `npm publish`, `mvn release`, `goreleaser`, and whatever the next registry demands.

| Roadmap | Question it answers |
|---|---|
| [Build Systems](../build-systems/) | Can I reproducibly turn my source into a runnable artifact? |
| [Testing](../testing/) | Does my code work? |
| **Release Engineering** (this) | Can I ship that artifact safely, traceably, and reversibly? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-versioning-and-semver/) | Versioning & SemVer | Semantic versioning, calver/datever, the breaking-change discipline, pre-release and build metadata |
| [02](02-changelogs-and-release-notes/) | Changelogs & Release Notes | Keep a Changelog, conventional commits, automated generation; changelog vs release notes vs migration guide |
| [03](03-release-branching-and-trains/) | Release Branching & Trains | Release branches vs trunk-based release tags, release candidates and promotion, release trains and cadence |
| [04](04-artifact-signing-and-provenance/) | Artifact Signing & Provenance | Sigstore / cosign, SLSA levels, in-toto attestations, reproducible builds as a trust primitive |
| [05](05-registries-and-distribution/) | Registries & Distribution | Container and package registries, immutability and retention, yank/deprecate semantics, mirrors and CDNs |
| [06](06-feature-flags-and-progressive-delivery/) | Feature Flags & Progressive Delivery | Flags as a release control, canary and ring deployments, percentage rollouts, flag lifecycle and debt |
| [07](07-rollback-and-roll-forward/) | Rollback & Roll-Forward | Binary rollback, flag kill-switches, roll-forward vs revert, hotfix policy, backward-compatible migrations |
| [08](08-release-automation/) | Release Automation | `semantic-release`, changesets, `goreleaser`, release-please; the fully automated tag-to-publish pipeline |
| [09](09-supply-chain-security/) | Supply-Chain Security | SBOMs, dependency provenance, pinning and lockfiles, signing verification at install, SLSA threat model |

---

## Tiers

Every topic is written across five tiers, each a standalone page:

| Tier | File | For the reader who… |
|---|---|---|
| **Junior** | `junior.md` | is meeting the concept for the first time and needs the *what* and *why* with concrete commands |
| **Middle** | `middle.md` | can run the tools and needs the working policy, the trade-offs, and the failure modes |
| **Senior** | `senior.md` | owns the policy and must reason about it under constraints, at scale, and across teams |
| **Professional** | `professional.md` | sets org-wide standards, designs the platform, and weighs governance, compliance, and cost |
| **Interview** | `interview.md` | is preparing to be questioned on it — a question bank with model answers and what each probes |

---

## Languages

The roadmap is policy-centric, but examples cover release tooling for **Go** (`go.mod` versioning, `ldflags` version embedding, `goreleaser`), **Java** (Maven Release Plugin, Gradle, Nexus staging), **Python** (PEP 440, `twine` to PyPI, `build` for wheels), **Rust** (`cargo publish`, crates.io yank semantics), and **JS/TS** (`npm publish`, `semantic-release`, changesets for monorepos).

---

## References

- *Software Engineering at Google* — Winters, Manshreck, Wright (release engineering chapter)
- *Continuous Delivery* — Jez Humble, David Farley (the canonical text on deployment pipelines and release readiness)
- *Keep a Changelog* — keepachangelog.com (the de facto changelog format)
- *Semantic Versioning* — semver.org (the spec, including pre-release and build metadata)
- *SLSA Framework* — slsa.dev (Supply-chain Levels for Software Artifacts; provenance and signing levels)
- *Sigstore* — sigstore.dev (keyless signing, transparency logs, cosign)

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
