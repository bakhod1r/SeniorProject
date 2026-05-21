---
layout: default
title: Parallel Tests
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/09-parallel-tests/
---

# Parallel Tests

[← Back](../)

`t.Parallel()` is the smallest and most consequential method on `testing.T`. Calling it pauses the current test, lets the framework schedule it next to other parallel-marked tests, and (in the happy case) collapses a serial-minute suite into a parallel-seconds one. The unhappy case — race conditions across tests sharing package state, environment variables, working directories, or external resources — is where most Go test bugs hide.

This subsection covers the two-tier parallelism model (`GOMAXPROCS` at runtime, `-parallel N` at the test level), the pre-1.22 loop-variable capture trap, the rules around `t.Setenv` and `t.Chdir` that force serial execution, and the resource-budget concerns that distinguish a healthy parallel suite from a flaky one.

## Sub-pages

- [junior.md](junior.md) — `t.Parallel()` semantics, your first parallel test, subtests with `t.Run`, the loop-variable bug, `-parallel` flag basics
- [middle.md](middle.md) — Parallel groups, cleanup ordering, `t.Setenv` and `t.Chdir` serializing tests, `t.TempDir` for isolation, race detector usage
- [senior.md](senior.md) — Designing test suites for parallelism, shared fixtures, port assignment, DB connection budgets, goroutine leak detection with goleak
- [professional.md](professional.md) — CI policies, flake budgets, parallel-by-default convention, monitoring race-detector findings, gradual rollout
- [specification.md](specification.md) — Normative excerpts: `testing.T.Parallel` godoc, `-parallel` flag, `-race`, `-cpu`, interaction with `TestMain`
- [interview.md](interview.md) — Common interview questions on parallel testing, the loop-var bug, race detection, isolation primitives
- [tasks.md](tasks.md) — Hands-on exercises: convert a serial suite to parallel, fix the loop-var bug, write a resource-pool fixture
- [find-bug.md](find-bug.md) — Realistic buggy snippets to diagnose: shared maps, environment leakage, working-directory collisions, cleanup races
- [optimize.md](optimize.md) — Tuning `-parallel`, mixing `-race -parallel`, sharding, balancing CPU vs I/O bound tests

## What changes when you call `t.Parallel`

Calling `t.Parallel` is a contract: the test promises not to touch process-global state and to be safe under any goroutine schedule. The framework, in turn, promises to run it concurrently with siblings up to `-parallel`. The whole subsection is about the implications of that bargain.
