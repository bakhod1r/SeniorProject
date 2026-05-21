---
layout: default
title: Benchmarking Deep Dive
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 17
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/17-benchmark-deep/
---

# Benchmarking Deep Dive

[← Back](../)

This section is the deep dive that follows `09/05-benchmarks`. The intro
covered how to write a `BenchmarkX(b *testing.B)` and read `ns/op`. Here we
assume that and move on to statistical rigor, machine-level pitfalls, CI
integration, and the toolchain knobs that decide whether your measurement is
true or fiction.

Citations used throughout: `golang.org/x/perf/cmd/benchstat`, `pkg.go.dev/runtime/metrics`.
Recommended order: junior → middle → senior → professional →
specification → interview → tasks → find-bug → optimize.

- [Junior](junior/)
- [Middle](middle/)
- [Senior](senior/)
- [Professional](professional/)
- [Specification](specification/)
- [Interview](interview/)
- [Tasks](tasks/)
- [Find the Bug](find-bug/)
- [Optimize](optimize/)
