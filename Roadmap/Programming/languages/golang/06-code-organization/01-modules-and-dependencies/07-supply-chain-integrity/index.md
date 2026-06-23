---
layout: default
title: Supply-Chain Integrity
parent: Modules & Dependencies
grand_parent: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/01-modules-and-dependencies/07-supply-chain-integrity/
---

# Supply-Chain Integrity

[← Back](../)

We explore Go's software supply-chain security end-to-end: the threat model (typosquatting, dependency confusion, compromised maintainers, malicious updates, build-time attacks), Go's built-in defenses (`go.sum`, the checksum database, the module proxy, `GOPRIVATE`), symbol-level vulnerability scanning with `govulncheck`, vendoring and reproducible builds, SLSA, SBOMs, signing and provenance, and a practical hardened CI pipeline.

## Sub-pages

- [junior.md](junior.md) — What the supply chain is, the threats, and Go's first-line defenses
- [middle.md](middle.md) — `govulncheck`, the vuln DB, vendoring for integrity, dependency hygiene in CI
- [senior.md](senior.md) — Threat modeling, reproducible/hermetic builds, SLSA, SBOMs, provenance strategy
- [professional.md](professional.md) — End-to-end secured pipeline: signing, attestation, transparency logs, policy
- [specification.md](specification.md) — Formal reference: `go.sum`, GOSUMDB, GOFLAGS, OSV, SLSA levels, SBOM formats
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken supply-chain configurations
- [optimize.md](optimize.md) — Hardening and workflow optimizations for the supply chain
