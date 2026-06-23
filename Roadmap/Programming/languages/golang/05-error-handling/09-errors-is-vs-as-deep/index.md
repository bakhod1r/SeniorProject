---
layout: default
title: errors.Is vs errors.As — Deep Dive
parent: Error Handling
grand_parent: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/05-error-handling/09-errors-is-vs-as-deep/
---

# errors.Is vs errors.As — Deep Dive

[← Back](../)

`errors.Is` and `errors.As` are the two functions in the `errors` package that walk an error's wrap chain. They look almost interchangeable on a quick read — both take an error, both return a bool, both ignore `nil`. They are not. `Is` answers *"is this error the same as that one?"*; `As` answers *"is there an error of this type somewhere in the chain, and can I have a copy?"*. The first compares; the second extracts.

This module is a complete deep dive on those two functions: the algorithm they execute, the methods they look for, the multi-error tree introduced in Go 1.20, the way `fmt.Errorf("%w", err)` and `errors.Join` interact with both, the cost of each, and the most common bugs you can hit with each. By the end, you should be able to explain — without reading the source — exactly which method on which type a given `Is` or `As` call will visit, in which order, and why.

## Sub-pages

- [junior.md](junior.md) — What `Is` and `As` do, when to pick which, the basic algorithm
- [middle.md](middle.md) — Custom `Is` / `As` methods, multi-error trees, `errors.Join`, picking patterns
- [senior.md](senior.md) — Production patterns, error families, sentinel-vs-typed design, public API surface
- [professional.md](professional.md) — Internals: the unwrap walk, allocation cost, comparable trap, reflection in `As`
- [specification.md](specification.md) — Formal API contracts, panic conditions, behavior table across Go versions
- [interview.md](interview.md) — Interview Q&A across all levels
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken `Is` / `As` calls
- [optimize.md](optimize.md) — Optimization exercises for `Is` / `As` heavy code paths
