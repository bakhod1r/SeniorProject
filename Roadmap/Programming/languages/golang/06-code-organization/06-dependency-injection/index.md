---
layout: default
title: Dependency Injection
parent: Code Organization
grand_parent: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/06-code-organization/06-dependency-injection/
---

# Dependency Injection

[← Back](../)

We explore Dependency Injection (DI) the Go way: passing collaborators in through constructors, using interfaces as seams, and wiring everything together in `main`. Go's standard answer is *manual* DI; frameworks like `google/wire` (compile-time codegen) and `uber-go/fx`/`dig` (runtime reflection) exist, but each carries trade-offs. The goal of this topic is to know when each tool is the right one — and when none is.

## Sub-pages

- [junior.md](junior.md) — DI from first principles, constructor injection, interfaces as seams, before/after refactor
- [middle.md](middle.md) — Real-world wiring in services, testing with fakes, avoiding service locator, brief intro to `wire`
- [senior.md](senior.md) — Architecture, ports/adapters, when to introduce `wire`/`fx`, scoping and large-graph wiring
- [professional.md](professional.md) — How `wire` codegens, how `fx`/`dig` reflect, performance trade-offs, cold start
- [specification.md](specification.md) — Reference notes on `wire`, `fx`, and Go interface semantics relevant to DI
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken DI scenarios
- [optimize.md](optimize.md) — Optimization exercises tightening DI graphs
