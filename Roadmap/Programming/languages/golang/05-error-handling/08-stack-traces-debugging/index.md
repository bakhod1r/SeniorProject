---
layout: default
title: Stack Traces & Debugging
parent: Error Handling
grand_parent: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/05-error-handling/08-stack-traces-debugging/
---

# Stack Traces & Debugging

[← Back](../)

We explore how Go programs produce stack traces, how to capture them programmatically, and how to use them — together with the runtime, debuggers, and profilers — to diagnose failures in development and in production. Errors tell you *what* went wrong; stack traces tell you *where*.

## Sub-pages

- [junior.md](junior.md) — Reading panics, `runtime/debug.Stack`, basic `runtime.Caller`
- [middle.md](middle.md) — Capture at origin vs at display, error wrapping with stack info
- [senior.md](senior.md) — Production debugging, pprof, distributed tracing, structured logs
- [professional.md](professional.md) — Cost of stack capture, inlining, escape analysis impact
- [specification.md](specification.md) — `runtime` API surface, `GOTRACEBACK`, signal handling
- [interview.md](interview.md) — Interview questions and answers
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken stack/debug code
- [optimize.md](optimize.md) — Optimization exercises for stack capture and logging
