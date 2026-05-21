---
layout: default
title: Test Coverage
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/06-coverage/
---

# Test Coverage

[← Back](../)

Coverage is the simplest, most abused metric in software testing. The Go toolchain ships with a coverage profiler built into `go test`: pass `-cover` and you get a percentage; pass `-coverprofile=cover.out` and you get a file the `go tool cover` subcommand can render as HTML or as a per-function table. Internally the compiler rewrites your source — when invoked under `-cover` — to bump a counter at the start of every basic block, and writes those counters out at the end of the run. There is no separate instrumentation pass, no JaCoCo-style agent, no XML report. Just an integer per block and a profile file in a documented text format.

This subsection treats coverage as a tool, not a target. We cover what the toolchain does, where the numbers come from, what they do and do not mean (Go measures statement coverage, not branch coverage), how to read profiles programmatically, how Go 1.20 extended coverage to integration tests of compiled binaries via `GOCOVERDIR`, and how to integrate with services like Codecov or Coveralls without turning the metric into a Goodhart trap. The references throughout are `go help testflag`, `go tool cover -help`, and the Go 1.20 integration-coverage proposal #51430.

## Sub-pages

- [junior.md](junior.md) — Your first `go test -cover`, reading the percentage, `-coverprofile=cover.out`, the HTML report, basic interpretation
- [middle.md](middle.md) — `-covermode=set/count/atomic`, when atomic is required for parallel tests, per-package coverage in monorepos, `-coverpkg`
- [senior.md](senior.md) — Go 1.20 integration coverage with `-cover` binary builds and `GOCOVERDIR`, parsing profiles programmatically, CI pipelines
- [professional.md](professional.md) — Coverage strategy in large codebases, avoiding Goodhart's law, identifying low-value 100%-covered code, Codecov and Coveralls
- [specification.md](specification.md) — Normative excerpts from `go help testflag`, `go tool cover -help`, the "covered block" concept, statement vs branch coverage
- [interview.md](interview.md) — 25+ interview questions from junior to staff covering the coverage toolchain
- [tasks.md](tasks.md) — Hands-on exercises: generate `cover.out`, view in HTML, identify uncovered branches, write tests for them
- [find-bug.md](find-bug.md) — Coverage gaps that hide real bugs: 100% statement coverage masking branch logic, panic paths, init blocks
- [optimize.md](optimize.md) — Coverage overhead in test runtime, when to skip cover in CI for speed, atomic vs count mode cost
