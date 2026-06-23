---
layout: default
title: fmt.Errorf
parent: Error Handling
grand_parent: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/05-error-handling/04-fmt-errorf/
---

# fmt.Errorf

[← Back](../)

We dive into `fmt.Errorf`, the standard-library tool for building errors with formatted messages. It is the only stdlib function that combines `Sprintf`-style formatting with the Go 1.13+ wrapping protocol via the special `%w` verb. Knowing exactly when `%w` wraps and when `%v` merely embeds is the difference between an error chain `errors.Is` can walk and a flat string that throws away identity.

## Sub-pages

- [junior.md](junior.md) — Basic syntax, format verbs, the `%w` vs `%v` distinction
- [middle.md](middle.md) — Wrapping vs embedding, propagation patterns, multiple `%w`
- [senior.md](senior.md) — Wrapping strategy, error API design, layered translation
- [professional.md](professional.md) — Implementation, allocations, runtime cost, benchmarks
- [specification.md](specification.md) — Spec text, signature, verbs, version history
- [interview.md](interview.md) — Interview questions and answers
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken `fmt.Errorf` use
- [optimize.md](optimize.md) — Optimization exercises for error-formatting paths
