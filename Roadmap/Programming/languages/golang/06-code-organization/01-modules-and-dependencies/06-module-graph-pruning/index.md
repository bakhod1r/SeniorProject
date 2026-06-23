---
layout: default
title: Module Graph Pruning
parent: Modules & Dependencies
grand_parent: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/01-modules-and-dependencies/06-module-graph-pruning/
---

# Module Graph Pruning

[← Back](../)

We explore **module graph pruning**, the Go 1.17 change that shrinks the module graph a build must load. For main modules at `go 1.17` or later, the toolchain loads the full transitive `go.mod` graph only of *directly relevant* dependencies and prunes the rest — making `go` commands faster, more predictable, and offline-friendlier, at the cost of recording more `// indirect` requirements in `go.mod`.

## Sub-pages

- [junior.md](junior.md) — What pruning is, why `go.mod` grew, the two `require` blocks, first commands
- [middle.md](middle.md) — Pruned vs full graph mechanics, `go mod graph`, `tidy -go`, `-compat`, lazy loading
- [senior.md](senior.md) — Migration strategy, deepening the graph, MVS interaction, monorepo and CI implications
- [professional.md](professional.md) — Toolchain internals, the pruning algorithm, `modules.txt`/`go.sum` interplay, edge cases
- [specification.md](specification.md) — Formal reference: pruning rules, the `go` directive's role, version-by-version behaviour
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with pruning, indirect-require, and `-compat` scenarios
- [optimize.md](optimize.md) — Workflow and performance optimizations around the pruned graph
