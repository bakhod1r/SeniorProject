---
layout: default
title: Testing Basics
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/01-testing-basics/
---

# Testing Basics

[← Back](../)

The Go standard library ships with one of the simplest and most opinionated test frameworks of any modern language. There is no `assert`, no test discovery DSL, no XML config: a file named `foo_test.go` containing `func TestXxx(t *testing.T)` is a test. The `go test` tool compiles every `_test.go` file in a package into an ephemeral binary, links it against the package under test, and runs it. Everything else — table-driven tests, subtests, parallelism, cleanup, temporary directories, environment variables, fuzzing, benchmarks, examples — is built from this minimal core defined in `src/testing/testing.go` and driven by `cmd/go/internal/test`.

This subsection is the foundation for the rest of the testing material. Before you can profile a benchmark, write a fuzz target, build a golden file harness, or wire integration tests into CI, you need to be fluent in the `testing.T` API, the `_test.go` file rules, the `TestMain` lifecycle, the difference between internal (`mypkg`) and external (`mypkg_test`) test packages, and the small set of `go test` flags you will type ten thousand times in your career. By the end of these pages you should be able to read any test file in the Go standard library — `src/encoding/json`, `src/net/http`, `src/sync` — and explain every line.

## Sub-pages

- [junior.md](junior.md) — Your first `TestXxx`, how `go test` discovers tests, `t.Errorf` vs `t.Fatalf`, `t.Log`, table-driven tests, basic `Example` functions
- [middle.md](middle.md) — Internal vs external test packages, subtests with `t.Run`, parallel tests, `t.Cleanup` ordering, `t.TempDir`, `t.Setenv`, `t.Helper`, `t.Skip`
- [senior.md](senior.md) — Designing testable code, dependency injection, test suites with `TestMain`, fixture management, black-box vs white-box trade-offs, build tags for tests, integration boundaries
- [professional.md](professional.md) — Production test discipline, naming conventions, CI wiring, flake budgets, test-pyramid placement, tests as documentation via `Example`
- [specification.md](specification.md) — Normative excerpts from the `testing` package godoc, `go help test`, `go help testflag`, `_test.go` file naming rules, build constraints
- [interview.md](interview.md) — 25+ interview questions from junior to staff covering the `testing` API and tooling
- [tasks.md](tasks.md) — Hands-on exercises: first test, `Example` with `Output:`, `TestMain` setup/teardown, table-driven test, parallel subtests
- [find-bug.md](find-bug.md) — Common bugs: `Errorf` vs `Fatalf` mix-ups, missing `t.Helper`, shared state across subtests, loop-variable capture, missing `t.Parallel`
- [optimize.md](optimize.md) — `-short` flag, parallel test speedup, `t.Cleanup` vs `defer`, test caching, `-count=1`, `-failfast`
