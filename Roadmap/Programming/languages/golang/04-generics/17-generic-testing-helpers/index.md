---
layout: default
title: Generic Testing Helpers
parent: Generics
grand_parent: Go
nav_order: 17
has_children: false
permalink: /roadmap/programming-languages/golang/04-generics/17-generic-testing-helpers/
---

# Generic Testing Helpers

[← Back](../)

We explore how **generics reshape Go test code** — from the classic `assertEqual` written once per type to a single type-safe `Equal[T comparable]` helper. This file is the entry point for the section. The focus is **always on testing** — comparison helpers, table-driven runners, fluent assertions — not on the broader testing tour, which lives in `09-testing-and-benchmarking`.

## Sub-pages

- [junior.md](junior.md) — A first generic `Equal[T comparable]`; why `t.Helper()` is essential; generic table-driven tests
- [middle.md](middle.md) — `AssertSliceEqual`, `AssertMapEqual`, `AssertNoError`, `AssertErrorIs`; separating fixtures from logic
- [senior.md](senior.md) — Custom equality with `EqualFunc`; generic `Diff` helpers; structuring an in-house testlib
- [professional.md](professional.md) — Real-world generic test packages; trade-offs vs `testify`, `gotest.tools`, and stdlib `testing`
- [specification.md](specification.md) — How `testing` interacts with generics; release-note evidence (1.18, 1.21)
- [interview.md](interview.md) — 30+ Q&A on test helpers, `t.Helper`, and order-insensitive equality
- [tasks.md](tasks.md) — 20+ exercises (`AssertEqual`, `AssertContains`, `AssertPanics[T any]`, generic table-driven runner)
- [find-bug.md](find-bug.md) — 15+ bugs (forgotten `t.Helper`, float deep-equality, hidden line numbers)
- [optimize.md](optimize.md) — Keeping helpers cheap, avoiding `reflect`, when generics outperform interfaces in tests
