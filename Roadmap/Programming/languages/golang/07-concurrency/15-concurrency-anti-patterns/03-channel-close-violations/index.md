---
layout: default
title: Channel Close Violations
parent: Concurrency Anti-Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/03-channel-close-violations/
---

# Channel Close Violations

[← Back](../)

Closing a Go channel is a one-way, one-time operation guarded by three hard runtime rules and two soft conventions. The hard rules fail loudly: close-on-nil panics, close-on-closed panics, send-on-closed panics. The conventions fail softly: when a receiver closes a channel, or when several producers share `defer close(ch)`, the program looks correct in unit tests and explodes in production under load. This subsection enumerates the five rules, catalogues the violations that show up in real bug reports, and gives the small set of patterns — single-sender close, coordinator close, `sync.Once` close, separate done channel — that cover every multi-sender close scenario you will meet.

## Sub-pages

- [junior.md](junior.md) — The five rules, the canonical panics, who closes a channel, simple safe patterns
- [middle.md](middle.md) — Multi-sender close, coordinator goroutine, `sync.Once`, done channel, defensive recover
- [senior.md](senior.md) — Library-grade close, pipeline cascade, errgroup integration, race-window analysis
- [professional.md](professional.md) — Runtime panic anatomy, hchan close bit, ABA on close, stack-trace forensics
- [specification.md](specification.md) — What the Go spec says about close, memory model, comparable behaviour to other languages
- [interview.md](interview.md) — Questions from "what panics here" to "design a multi-producer pipeline"
- [tasks.md](tasks.md) — Hands-on exercises: refactor unsafe close, build a safe-close library helper
- [find-bug.md](find-bug.md) — Twenty-plus broken programs across the close-violation family
- [optimize.md](optimize.md) — Reducing close overhead, avoiding `sync.Once` allocation, lock-free idempotent close
