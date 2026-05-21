---
layout: default
title: Table-Driven Tests
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/02-table-driven-tests/
---

# Table-Driven Tests

The **table-driven test** is the dominant idiom for writing tests in Go. Instead of duplicating a `func TestX_caseA`, `func TestX_caseB`, `func TestX_caseC` per scenario, you write **one** test function that iterates a slice (or map) of test cases — each row carries its inputs, expected outputs, and a human-readable name. The test body then runs the same assertion logic for every row, usually inside a `t.Run(tc.name, ...)` subtest.

This pattern is so dominant in Go that the standard library's own tests (`encoding/json`, `net/http`, `time`, `strconv`, `strings`) are nearly all table-driven. The Go authors deliberately chose this style instead of BDD-style `describe`/`it` frameworks (RSpec, Jest, Mocha) because table-driven tests:

- Stay in plain Go — no DSL to learn, no fluent-assertion library to import.
- Compose with `t.Run` for subtest filtering (`go test -run TestX/case_a`).
- Make every case visible in a single screen of code — easy to scan, easy to extend.
- Naturally support parallelism, golden files, fuzz seeds, and benchmarks.

This section breaks the pattern down from "how do I write my first one" (junior) to "how do I manage a 500-row table that loads from YAML and runs in parallel without flakes" (professional).

## Files

- [Junior](junior/) — the canonical pattern, subtest naming, the historical `tc := tc` capture, Go 1.22 loop scope change.
- [Middle](middle/) — `-run` regex filtering, parallel subtests, helpers, golden files in tables.
- [Senior](senior/) — designing readable tables for complex domains, nested tables, matrix tests, cross-products, when to split.
- [Professional](professional/) — 200+ row tables in production, generation from CSV/YAML/JSON, `t.Run` overhead, test discovery.
- [Specification](specification/) — `testing.T.Run` godoc, `-run` regex semantics, Go 1.22 issue 60078, stdlib idioms.
- [Interview](interview/) — 25+ questions on table-driven tests.
- [Tasks](tasks/) — practical exercises.
- [Find the Bug](find-bug/) — buggy table-driven snippets to diagnose.
- [Optimize](optimize/) — measuring and reducing table overhead.

[← Back to Testing and Benchmarking](../)
