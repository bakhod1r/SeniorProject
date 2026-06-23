---
layout: default
title: go mod tidy
parent: Modules & Dependencies
grand_parent: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/01-modules-and-dependencies/02-go-mod-tidy/
---

# go mod tidy

[← Back](../)

We explore `go mod tidy`, the command that synchronises `go.mod` and `go.sum` with the project's actual import graph — adding missing dependencies, removing unused ones, populating checksums, and marking transitive entries as `// indirect`. Run it after every change to imports to keep the module file honest and the build reproducible.

## Sub-pages

- [junior.md](junior.md) — Beginners' walk-through of the command and what changes in `go.mod` / `go.sum`
- [middle.md](middle.md) — Internal mechanics, build tags, `-compat`, indirect markers, CI drift detection
- [senior.md](senior.md) — Dependency hygiene at scale, multi-module monorepos, supply-chain integrity
- [professional.md](professional.md) — Toolchain internals, MVS inside tidy, programmatic equivalents, hermetic builds
- [specification.md](specification.md) — Formal reference text, flags, version differences
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken-tidy scenarios
- [optimize.md](optimize.md) — Optimizations of `go mod tidy` and the workflows around it
