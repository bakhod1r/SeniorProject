---
layout: default
title: panic and recover
parent: Error Handling
grand_parent: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/05-error-handling/07-panic-and-recover/
---

# panic and recover

[← Back](../)

We explore Go's two built-in functions for catastrophic failure: `panic` initiates an immediate stack-unwinding sequence, and `recover` (when called inside a deferred function) stops it. Together with `defer`, they form Go's last-resort safety net for impossible states and runtime crashes — a mechanism deliberately separate from the everyday `error` value.

## Sub-pages

- [junior.md](junior.md) — What panic and recover do, the deferred-recover pattern, when to use which
- [middle.md](middle.md) — Builtin panics, recover scope rules, panic across goroutines
- [senior.md](senior.md) — Architecture: panic boundaries, supervisors, panic-to-error translation
- [professional.md](professional.md) — Runtime mechanics, gopanic, deferred call frames, cost
- [specification.md](specification.md) — Spec text on panic, recover, and defer
- [interview.md](interview.md) — Interview questions and answers
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken panic/recover code
- [optimize.md](optimize.md) — Performance pitfalls and proper use of panic
