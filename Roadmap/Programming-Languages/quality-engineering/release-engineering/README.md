# Release Engineering Roadmap

> *"A build produces a binary; a release produces a promise."*

This roadmap is about **turning built artifacts into releasable, traceable, reversible deliveries**: versioning, changelogs, release branches, signing, registries, rollback, and the audit trail that lets you say with confidence *what* was shipped, *when*, and *by whom*.

> Looking for *building the artifact* (compile, link, package)? See [Build Systems](../build-systems/).
>
> Looking for *deploying the artifact* (Docker, Kubernetes, rollout strategy)? See the [DevOps](../../../DevOps/) section.
>
> For *CI/CD pipeline design* end-to-end, pair this roadmap with the `ci-cd-pipeline-design` skill.
>
> For *API versioning specifically* (HTTP/gRPC contracts, deprecation in transit), pair with the `api-versioning` skill.

---

## Why a Dedicated Roadmap

Release engineering lives between the build and the deploy, and it is the part teams most often skip until a bad ship forces the lesson. Versioning is policy, not syntax. A changelog is a contract with users. A rollback path is not a fallback — it is part of the release. Understanding releases *as a category* — semver vs calver, RC promotion, signed provenance, deprecation windows — keeps you fluent across `cargo publish`, `npm publish`, `mvn release`, `goreleaser`, and whatever the next registry demands.

| Roadmap | Question it answers |
|---|---|
| [Build Systems](../build-systems/) | Can I reproducibly turn my source into a runnable artifact? |
| [Testing](../testing/) | Does my code work? |
| **Release Engineering** (this) | Can I ship that artifact safely, traceably, and reversibly? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-what-release-engineering-covers/) | What Release Engineering Covers | The boundary between Build (artifact production) and Deploy (artifact delivery) |
| [02](02-versioning-schemes/) | Versioning Schemes | Semver, calver, datever; when each fits; the breaking-change discipline |
| [03](03-changelog-discipline/) | Changelog Discipline | Keep a Changelog format, conventional commits, automated generation |
| [04](04-release-branches-and-trains/) | Release Branches & Trains | Release branches vs trunk-based release tags; release trains (Chrome's 4-week cadence) |
| [05](05-release-candidates-and-promotion/) | Release Candidates & Promotion | RC builds, staging soak, promotion gates from RC to GA |
| [06](06-artifact-signing-and-sboms/) | Artifact Signing & SBOMs | Sigstore / cosign, SLSA levels, software bills of materials, supply-chain provenance |
| [07](07-artifact-registries/) | Artifact Registries | Container registries, language package registries; immutability and retention |
| [08](08-rollback-and-hotfix/) | Rollback & Hotfix | Feature flags as rollback, binary rollback, roll-forward vs revert; hotfix branch policy |
| [09](09-deprecation-policy/) | Deprecation Policy | N+1 / N+2 deprecation, migration windows, communicating breaking changes |
| [10](10-release-notes-vs-changelog-vs-migration-guide/) | Release Notes vs Changelog vs Migration Guide | Three artifacts, three audiences (users, integrators, operators) |
| [11](11-compliance-and-audit-trail/) | Compliance & Audit Trail | Who released what, when, with what approvals; SOX, SOC2 evidence |
| [12](12-anti-patterns/) | Anti-patterns | "We'll write the changelog later," version-bump-as-CI-only, no rollback path, surprise breaking changes in patch releases |

---

## Languages

The roadmap is policy-centric, but examples cover release tooling for **Go** (`go.mod` versioning, `ldflags` version embedding, `goreleaser`), **Java** (Maven Release Plugin, Gradle Release Plugin, Nexus staging), **Python** (PEP 440, `twine` to PyPI, `build` for wheels), **Rust** (`cargo publish`, crates.io yank semantics), and **JS/TS** (`npm publish`, `semantic-release`, changesets for monorepos).

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *Software Engineering at Google* — Winters, Manshreck, Wright (release engineering chapter)
- *Continuous Delivery* — Jez Humble, David Farley (the canonical text on deployment pipelines and release readiness)
- *Keep a Changelog* — keepachangelog.com (the de facto changelog format)
- *Semantic Versioning* — semver.org (the spec, including pre-release and build metadata)
- *SLSA Framework* — slsa.dev (Supply-chain Levels for Software Artifacts; provenance and signing levels)

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
