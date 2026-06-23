---
layout: default
title: E2E Tests
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 14
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/14-e2e-tests/
---

# E2E Tests

End-to-end tests for Go services from the client's perspective: API,
browser, and CLI. The pages cover ephemeral environments
(`docker-compose`, `kind`, `k3d`), the relationship to contract tests,
parallelism via per-tenant isolation, flakiness mitigation, failure
artefacts, and CI scheduling (smoke vs nightly). Browser tools cited:
`github.com/chromedp/chromedp`, `github.com/playwright-community/playwright-go`.

- [Junior](junior/) — first E2E test, env vars, polling, scopes
- [Middle](middle/) — suite shape, parallelism, ephemeral envs
- [Senior](senior/) — pyramid contract, SUT hooks, flake budget
- [Professional](professional/) — economics, ownership, scheduling
- [Specification](specification/) — formal definition of an E2E test
- [Interview](interview/) — discussion questions and model answers
- [Tasks](tasks/) — exercises to write E2E tests yourself
- [Find the Bug](find-bug/) — broken E2E snippets and fixes
- [Optimize](optimize/) — make the suite fast enough to keep

Prerequisites: comfort with Go's `testing` package, HTTP basics
(`net/http`), and at least one of the testing tiers below this one
(integration tests with `testcontainers-go` or `httptest`).
