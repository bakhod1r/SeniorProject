---
layout: default
title: errors.New
parent: Error Handling
grand_parent: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/05-error-handling/03-errors-new/
---

# errors.New

[← Back](../)

We zoom in on the smallest, most-used building block of Go's error system: the `errors.New` function. Despite being only three lines of code, it shapes how Go programs declare sentinel errors, how they allocate on hot paths, and how libraries grow from a single string message into a full typed-error API. This page explains the function, its memory profile, the patterns built around it, and the inevitable mistakes that come with it.

## Sub-pages

- [junior.md](junior.md) — What `errors.New` is, basic usage, when to reach for it
- [middle.md](middle.md) — Sentinel declarations, allocation per call vs package-level, comparison rules
- [senior.md](senior.md) — `errors.New` as part of a public API, evolution to typed errors
- [professional.md](professional.md) — Implementation in `errors.go`, escape analysis, memory layout
- [specification.md](specification.md) — What the spec and `errors` package guarantee, version history
- [interview.md](interview.md) — Interview questions and answers
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with `errors.New` misuse
- [optimize.md](optimize.md) — Optimization exercises around allocation and sentinel reuse
