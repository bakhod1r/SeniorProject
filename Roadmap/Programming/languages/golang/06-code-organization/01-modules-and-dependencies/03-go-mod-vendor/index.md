---
layout: default
title: go mod vendor
parent: Modules & Dependencies
grand_parent: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/01-modules-and-dependencies/03-go-mod-vendor/
---

# go mod vendor

[← Back](../)

We explore `go mod vendor`, the command that copies all module dependencies into a top-level `vendor/` directory at the module root. Once a `vendor/` directory is present, the Go toolchain automatically uses it for builds, producing offline-deterministic, audit-friendly artifacts.

## Sub-pages

- [junior.md](junior.md) — Beginners' walk-through of vendoring and the resulting `vendor/` tree
- [middle.md](middle.md) — Internal mechanics, `modules.txt`, auto-detection, build tags, CI patterns
- [senior.md](senior.md) — Supply-chain reasoning, compliance, monorepo strategy, anti-patterns
- [professional.md](professional.md) — Toolchain internals, format spec, programmatic equivalents, hermetic builds
- [specification.md](specification.md) — Formal reference, flags, `modules.txt` grammar
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken-vendor scenarios
- [optimize.md](optimize.md) — Workflow optimizations around vendoring
