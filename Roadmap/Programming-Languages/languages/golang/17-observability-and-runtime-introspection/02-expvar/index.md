---
layout: default
title: The expvar Package
parent: Observability & Runtime Introspection
grand_parent: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/17-observability-and-runtime-introspection/02-expvar/
---

# The expvar Package

[← Back](../)

We explore `expvar`, the standard library's smallest observability primitive: a way to publish public application variables as JSON over HTTP at `/debug/vars`. Importing the package registers a handler on `http.DefaultServeMux` and exposes two defaults (`cmdline`, `memstats`); your code can publish counters, gauges, maps, and computed values with a handful of concurrency-safe types.

## Sub-pages

- [junior.md](junior.md) — What `expvar` is, the `Var` interface, the built-in types, first counters
- [middle.md](middle.md) — Registry mechanics, `Map`, `Func`, custom mux mounting, concurrency model
- [senior.md](senior.md) — When `expvar` is enough vs Prometheus/OTel, security gating, design trade-offs
- [professional.md](professional.md) — Internals, atomic backing, JSON-quoting contract, integration patterns
- [specification.md](specification.md) — Formal reference: the `Var` interface, exported functions, handler contract
- [interview.md](interview.md) — Interview questions from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken-expvar scenarios
- [optimize.md](optimize.md) — Workflow and design optimizations around `expvar`
