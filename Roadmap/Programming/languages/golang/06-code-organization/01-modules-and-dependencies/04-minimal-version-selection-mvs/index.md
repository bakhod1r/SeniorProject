---
layout: default
title: Minimal Version Selection
parent: Modules & Dependencies
grand_parent: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/01-modules-and-dependencies/04-minimal-version-selection-mvs/
---

# Minimal Version Selection (MVS)

[← Back](../)

We explore Minimal Version Selection — the algorithm Go uses to decide *which* version of each dependency a build uses. MVS picks the **minimum** version that satisfies every requirement in the module graph, not the maximum. This single design choice gives Go reproducible, low-fidelity-failure builds without a SAT solver, a lockfile, or background updates.

## Sub-pages

- [junior.md](junior.md) — Beginners' walk-through of "minimum, not maximum," the build list, and `require` directives
- [middle.md](middle.md) — The build-graph algorithm, the four MVS operations, `go get`, `go mod graph`, `go list -m all`
- [senior.md](senior.md) — MVS vs SAT solvers, design rationale, upgrade/downgrade propagation, supply-chain implications
- [professional.md](professional.md) — The algorithm formally, graph pruning, lazy loading, pseudo-versions, `+incompatible`
- [specification.md](specification.md) — Formal reference: the four operations, the `go` directive, module-graph rules
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with version-selection surprises
- [optimize.md](optimize.md) — Workflow and graph optimizations around MVS
