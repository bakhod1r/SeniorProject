---
layout: default
title: Goroutine Best Practices
parent: Goroutines
grand_parent: Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/01-goroutines/05-best-practices/
---

# Goroutine Best Practices

[Back](../)

Goroutines are easy to spawn and hard to retire. This subsection collects the rules that experienced Go teams converge on after enough postmortems: every goroutine has a documented exit story, `wg.Add` lives in the parent and `wg.Done` lives in a `defer`, loop variables get passed as parameters rather than captured, `context.Context` threads through anything long-running, panics get recovered at the goroutine boundary, and `time.Sleep` is never used for synchronisation. None of these rules are exotic. They look obvious when you read them. They are also broken in production code every day, which is why the failure modes deserve their own section.

## Sub-pages

- [junior.md](junior.md) — The full list of rules with rationale, good and bad example, and the failure mode each rule prevents
- [middle.md](middle.md) — Applying the rules in real services: errgroup over hand-rolled coordination, worker pools, structured concurrency
- [senior.md](senior.md) — Code review checklist, style guides (Uber, Google, Effective Go) compared, team conventions
- [professional.md](professional.md) — How the rules map to runtime invariants and the cost of breaking them at scale
- [specification.md](specification.md) — Sources for each rule (specs, official docs, style guides, talks)
- [interview.md](interview.md) — Interview questions about best practices and the bugs they prevent
- [tasks.md](tasks.md) — Exercises that force you to apply the rules
- [find-bug.md](find-bug.md) — Snippets that violate one rule each; spot the violation
- [optimize.md](optimize.md) — Refactor poorly-disciplined goroutine code into production-grade Go
