---
layout: default
title: Integration Tests
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 13
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/13-integration-tests/
---

# Integration Tests

[← Back](../)

Integration tests verify that multiple components cooperate correctly across
real process or network boundaries. In Go they sit between fast unit tests
(no I/O) and slow end-to-end tests (full deployment) on the test pyramid.

## Pages in this section

1. Specification — what counts as an integration test, scope rules.
2. Junior — first integration test with `httptest`, `//go:build integration`.
3. Middle — Postgres via `testcontainers-go`, `TestMain`, schema setup.
4. Senior — Kafka, Redis, parallel containers, transactional fixtures.
5. Professional — CI matrices, container reuse, flake budgets.
6. Interview — typical questions on integration testing.
7. Tasks — hands-on exercises.
8. Find the bug — broken integration suites to repair.
9. Optimize — make a slow integration suite fast.

## Key packages

- `github.com/testcontainers/testcontainers-go`
- `github.com/ory/dockertest/v3`
- `net/http/httptest`
- `database/sql` + `pgx`

Aim: deterministic, parallel-safe, fast-enough integration coverage.
