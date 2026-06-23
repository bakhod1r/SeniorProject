---
layout: default
title: Method Values and Method Expressions
parent: Methods & Interfaces
grand_parent: Go
nav_order: 15
has_children: false
permalink: /roadmap/programming-languages/golang/03-methods-and-interfaces/15-method-values-and-expressions/
---

# Method Values and Method Expressions

[← Back](../)

This section dives into a Go-specific feature most introductory resources only mention in passing: a method can be **detached** from its `value.Method()` call form and turned into a first-class function value. Two distinct constructs are involved.

A **method value** — `t.M` — is a *bound* function value. The receiver `t` is captured in a closure; the resulting value has type `func(args)`. Calling it later still operates on the originally captured receiver.

A **method expression** — `T.M` (or `(*T).M` for pointer-receiver methods) — is an *unbound* function. The receiver becomes the explicit first parameter; the resulting value has type `func(T, args)`. The caller supplies the receiver at every call.

Both constructs appear quietly all over the standard library: `sort.Slice`, `http.Handler` registration, `sync.Once`, callback hooks, and dispatch tables. Yet the two have very different memory and dispatch costs — confusing them is one of the most common subtle Go bugs.

## Sub-pages

- [junior.md](junior.md) — `t.M` vs `T.M` with simple examples and first patterns
- [middle.md](middle.md) — Currying, callbacks, sort/http integration
- [senior.md](senior.md) — Closure mechanics, escape analysis, generics interaction
- [professional.md](professional.md) — API design with callback method values, lifecycle hooks
- [specification.md](specification.md) — Spec quotes for §Method values / §Method expressions, EBNF
- [interview.md](interview.md) — 30+ Q&A; binding moment, escape, common gotchas
- [tasks.md](tasks.md) — Exercises (dispatch tables, currying, plumbing)
- [find-bug.md](find-bug.md) — Stale receiver, goroutine + method value, mutable state
- [optimize.md](optimize.md) — Reduce method-value allocations, prefer expressions
