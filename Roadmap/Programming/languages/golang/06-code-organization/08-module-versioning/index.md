---
layout: default
title: Module Versioning
parent: Code Organization
grand_parent: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/08-module-versioning/
---

# Module Versioning

[← Back](../)

We explore how Go assigns, records, compares, and resolves version numbers for modules: semantic versioning, the leading `v`, the `/v2` import-path rule, pseudo-versions, `+incompatible`, pre-release tags, and the Minimum Version Selection (MVS) algorithm. Versioning is the contract that lets you and your dependencies evolve without breaking each other.

## Sub-pages

- [junior.md](junior.md) — Semver basics, tagging a module, what `v1.2.3` means, `v0` to `v1` walk-through
- [middle.md](middle.md) — Pseudo-versions, pre-releases, upgrades, `replace`, module resolution
- [senior.md](senior.md) — Major-version strategy, `/v2` rule, `+incompatible`, semantic import versioning
- [professional.md](professional.md) — MVS algorithm, proxy and sumdb semantics, GOMODCACHE layout, pseudo-version anatomy
- [specification.md](specification.md) — Spec-level reference: semver, pseudo-version grammar, version comparison rules
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard) for tagging, bumping, and pinning
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken-versioning scenarios
- [optimize.md](optimize.md) — Optimization exercises for cleaner version graphs
