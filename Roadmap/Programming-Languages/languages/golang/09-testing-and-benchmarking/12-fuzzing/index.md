---
layout: default
title: Native Fuzzing
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 12
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/
---

# Native Fuzzing

[← Back](../)

Native fuzzing landed in Go 1.18 alongside generics. It is exposed through `testing.F` and the `go test -fuzz` flag. Coverage-guided mutation makes the runtime synthesize new inputs that explore unseen code paths, and saved failing inputs become permanent regression cases in `testdata/fuzz/`.

## Sub-pages

- [junior.md](junior.md) — First Fuzz function, testing.F API, f.Add seed corpus, f.Fuzz body, running with `-fuzz=`
- [middle.md](middle.md) — Mutation strategies, coverage feedback, structured inputs, reproducing saved failures, corpus minimization
- [senior.md](senior.md) — Native fuzz vs dvyukov/go-fuzz, OSS-Fuzz integration, differential fuzzing, ClusterFuzzLite, fuzz CL history
- [professional.md](professional.md) — What to fuzz in production, crash triage, CI fuzz budgets, vuln disclosure workflow
- [specification.md](specification.md) — testing.F godoc, `-fuzz` flag semantics, corpus format, Go 1.18 release notes (golang/go#44551)
- [interview.md](interview.md) — 20+ interview questions on fuzz vs PBT, input types, reproducing failures
- [tasks.md](tasks.md) — Hands-on: fuzz a reverse function, fuzz JSON unmarshal, fuzz a parser, reproduce a saved failure
- [find-bug.md](find-bug.md) — Common traps: non-deterministic body, shared global state, missing corpus seed
- [optimize.md](optimize.md) — Fuzz time budgeting, parallel fuzzing, corpus reuse, coverage signal interpretation
