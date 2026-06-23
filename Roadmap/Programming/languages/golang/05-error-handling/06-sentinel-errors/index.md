---
layout: default
title: Sentinel Errors
parent: Error Handling
grand_parent: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/05-error-handling/06-sentinel-errors/
---

# Sentinel Errors

[← Back](../)

We explore *sentinel errors* — package-level error variables that act as named, comparable markers. The standard library is full of them: `io.EOF`, `sql.ErrNoRows`, `os.ErrNotExist`, `context.Canceled`. They are the simplest tool in Go's error vocabulary and the source of some of its sharpest design trade-offs.

## Sub-pages

- [junior.md](junior.md) — What a sentinel is, declaring one, the `io.EOF` pattern
- [middle.md](middle.md) — `errors.Is` vs `==`, wrapping, when to choose sentinels
- [senior.md](senior.md) — API design, evolution, alternatives, cross-package coupling
- [professional.md](professional.md) — Memory layout, init cost, GC behavior, allocation profile
- [specification.md](specification.md) — Spec rules, stdlib conventions, version history
- [interview.md](interview.md) — Interview questions and answers
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken sentinel code
- [optimize.md](optimize.md) — Optimization exercises for sentinel-heavy paths
