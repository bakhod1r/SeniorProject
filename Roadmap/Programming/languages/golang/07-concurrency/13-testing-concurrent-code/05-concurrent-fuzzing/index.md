---
layout: default
title: Concurrent Fuzzing
parent: Testing Concurrent Code
grand_parent: Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/13-testing-concurrent-code/05-concurrent-fuzzing/
---

# Concurrent Fuzzing

[← Back](../)

Native fuzzing entered the Go toolchain in 1.18. The fuzzer generates random inputs, mutates them under coverage guidance, and re-runs the target on every interesting input it discovers. On its own it is a powerful tool for finding parser bugs, panics, and incorrect outputs. When you combine it with `-race`, every fuzzed input is also instrumented for data races, and rare interleavings that hand-written tests would never reach become reproducible. This subsection covers the `testing.F` API, the `f.Add` / `f.Fuzz` workflow, the persistent corpus under `testdata/fuzz/`, the `GOCACHE` / `-fuzzcachedir` interaction, fuzz targets for parsers and state machines, stress-testing fuzz-found inputs across many goroutines, third-party property-based libraries like `pgregory.net/rapid` and `gopter`, the historical `dvyukov/go-fuzz` predecessor, and the practice of writing **concurrent invariants** — properties that must hold under any interleaving the scheduler can produce.

## Sub-pages

- [junior.md](junior.md) — What fuzzing is, the `testing.F` API, writing your first fuzz target, running with `-race`
- [middle.md](middle.md) — Corpus management, seeded inputs, concurrent invariants, stress-testing fuzz-found inputs
- [senior.md](senior.md) — Property-based testing with `rapid` and `gopter`, fuzz target design for state machines, CI integration
- [professional.md](professional.md) — Coverage-guided mutation internals, persistent corpus on disk, fuzz worker isolation, `dvyukov/go-fuzz`
- [specification.md](specification.md) — Exact contract of `testing.F`, `-fuzz`, `-fuzztime`, `-fuzzminimizetime`, `-fuzzcachedir`
- [interview.md](interview.md) — Questions about fuzzing vs property testing, race + fuzz combination, corpus persistence
- [tasks.md](tasks.md) — Hands-on exercises: write fuzz targets for a parser, a queue, a state machine, all under `-race`
- [find-bug.md](find-bug.md) — Reading fuzz failure reports, minimising failing inputs, reproducing once and then in CI
- [optimize.md](optimize.md) — Tuning `-fuzztime`, parallel workers, seed selection, splitting corpora across CI shards
