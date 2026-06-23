---
layout: default
title: Error Handling Basics
parent: Error Handling
grand_parent: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/05-error-handling/01-error-handling-basics/
---

# Error Handling Basics

[← Back](../)

We explore the foundation of error handling in Go: the `error` value, the `if err != nil` idiom, and Go's explicit "errors are values" philosophy. Unlike languages that throw exceptions, Go returns errors as ordinary values and forces the caller to deal with them.

## Sub-pages

- [junior.md](junior.md) — What an error is, the `if err != nil` pattern, basic returns
- [middle.md](middle.md) — Error propagation, multiple returns, early-exit style
- [senior.md](senior.md) — Error design, error vs panic, control-flow architecture
- [professional.md](professional.md) — Runtime cost, error allocation, escape analysis of errors
- [specification.md](specification.md) — Spec text, predeclared `error` interface, idiom rules
- [interview.md](interview.md) — Interview questions and answers
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken error code
- [optimize.md](optimize.md) — Optimization exercises for error-heavy paths
