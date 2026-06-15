---
layout: default
title: Loop Variable Semantics
parent: Modern Language Features
grand_parent: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/18-modern-language-features/02-loopvar-semantics/
---

# Loop Variable Semantics

[← Back](../)

We explore the Go 1.22 per-iteration loop variable change — the single most impactful correctness fix in the language's history. Before 1.22, `for i, v := range xs` reused one variable across all iterations, so closures and goroutines that captured it all observed the final value. From 1.22, each iteration gets a fresh instance of the loop variable, gated by the module's `go` directive.

## Sub-pages

- [junior.md](junior.md) — The closure-capture foot-gun, the 1.22 fix, before/after with exact output
- [middle.md](middle.md) — Gating by `go` directive, 3-clause loops, escape-analysis cost model
- [senior.md](senior.md) — Go 1 compatibility reasoning, migration strategy, the `v := v` idiom's retirement
- [professional.md](professional.md) — Compiler desugaring, escape analysis interaction, vet/loopclosure changes
- [specification.md](specification.md) — What the spec and release notes say, version gating rules
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises across pre- and post-1.22 code
- [optimize.md](optimize.md) — Performance reasoning and migration-cost optimizations
