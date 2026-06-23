---
layout: default
title: Test Helpers
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/10-test-helpers/
---

# Test Helpers

[← Back](../)

This module covers test helper functions in Go: the `t.Helper`
mechanism, hand-rolled assertion shorthands, shared
`internal/testutil` packages, the relationship between hand-rolled
helpers and the `testify` library, integration with
`google/go-cmp` and `testing/quick`, fixture loaders, polling
helpers, and the discipline of keeping helpers small enough to stay
useful.

The aim is to make every helper readable, every failure trace
pointed at the test, and every shared helper a stable contract that
the rest of the project can depend on.

## Tiers

- [Junior](junior/) — basics: `t.Helper`, `assertEqual`,
  `mustParse`, `t.Cleanup`.
- [Middle](middle/) — `cmp.Diff`, fixtures, polling, time freezing,
  shared `internal/testutil`.
- [Senior](senior/) — internals, parallelism, property tests,
  helper testing, testify trade-offs.
- [Professional](professional/) — API design, anti-patterns,
  fixture management at scale.

## Reference

- [Specification](specification/) — normative requirements and
  helper categories.
- [Interview](interview/) — common questions and answers.
- [Tasks](tasks/) — exercises to practise the patterns.
- [Find Bug](find-bug/) — broken helper for review.
- [Optimize](optimize/) — performance work on a slow helper.

Total reading time across the four tier pages is roughly 90
minutes. The reference pages are designed to be skimmed and
referenced rather than read end-to-end.
