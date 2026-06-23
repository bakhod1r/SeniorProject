---
layout: default
title: Handle, Don't Just Check
parent: Error Handling
grand_parent: Go
nav_order: 13
has_children: false
permalink: /roadmap/programming-languages/golang/05-error-handling/13-handle-dont-just-check/
---

# Handle, Don't Just Check — The Philosophy of Go Error Handling

[← Back](../)

Dave Cheney coined the phrase that names this topic: *"Don't just check errors, handle them gracefully."* Go's verbosity around `if err != nil` is famous; Cheney's reply is that the verbosity is not the problem — the *reflex* is. Returning every error untouched is not handling. Handling means **deciding**: recover, retry, log, transform, surface, abort. This file teaches the discipline of making that decision deliberately at every error site.

## Sub-pages

- [junior.md](junior.md) — The reflex vs the decision; happy path; early return idiom
- [middle.md](middle.md) — Retry, transform, fallback; boundary translation; errWriter
- [senior.md](senior.md) — Architectural patterns; idempotency; degraded mode; circuit breakers
- [professional.md](professional.md) — Cost models, control-flow design, comparison with exceptions
- [specification.md](specification.md) — Stdlib conventions for `error` decisions; `io`, `os`, `net`, `database/sql`
- [interview.md](interview.md) — Interview questions and answers
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken handling
- [optimize.md](optimize.md) — Optimization exercises around handling cost
