---
layout: default
title: Workspaces
parent: Code Organization
grand_parent: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/05-workspaces/
---

# Workspaces

[← Back](../)

Go workspaces (introduced in Go 1.18 via the `go.work` file) let you point one toolchain invocation at *several* modules at once, so changes in one module are immediately visible in the others without editing `replace` directives in any `go.mod`. They are the modern, version-control-friendly way to do parallel development across a library and its consumer, and the right replacement for the `replace ../sibling` patterns teams used to scatter through their repos.

## Sub-pages

- [junior.md](junior.md) — What `go.work` is, why it exists, and a beginner walkthrough from one module to a two-module workspace
- [middle.md](middle.md) — Realistic workflows: developing a library alongside its consumer, `go work sync`, when to commit `go.work`
- [senior.md](senior.md) — Workspaces vs `replace`, multi-team monorepos, CI strategy, release engineering
- [professional.md](professional.md) — How `cmd/go` resolves workspace mode, precedence, build cache, `GOWORK`, `GOFLAGS=-mod=`
- [specification.md](specification.md) — `go.work` file syntax, `go work` subcommands, environment variables
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Broken-workspace scenarios with bugs to find
- [optimize.md](optimize.md) — Optimization exercises for cleaner workspace setups
