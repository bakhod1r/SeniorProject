---
layout: default
title: Mocking Libraries Deep Dive
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 15
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/15-mocking-libraries/
---

# Mocking Libraries Deep Dive

[← Back](../)

This subsection is the practical deep dive into the Go mocking ecosystem.
The conceptual introduction to test doubles (stubs, fakes, mocks, spies) lives in
`09/03-mocks-and-stubs`. Here we examine specific libraries, their generators,
their runtime semantics, and the trade-offs between them.

## Files

- `junior.md` — `go.uber.org/mock` (formerly `github.com/golang/mock`) end to end:
  `mockgen`, `gomock.NewController`, `EXPECT()`, `Return`, `Times`, `InOrder`, `Do`.
- `middle.md` — `github.com/stretchr/testify/mock`, `github.com/vektra/mockery`
  codegen, `.mockery.yaml`, naming policies.
- `senior.md` — `github.com/matryer/moq`, `github.com/maxbrunsfeld/counterfeiter`,
  HTTP mocks (`jarcoal/httpmock`), SQL mocks (`DATA-DOG/go-sqlmock`),
  redismock, gRPC mocks (`bufconn` vs interface mocking), comparison matrix.
- `professional.md` — Migration from `github.com/golang/mock` to
  `go.uber.org/mock`, mock placement strategies, mock-driven design pitfalls,
  fakes versus mocks.
- `specification.md` — Formal contract: matchers, controller lifecycle, ordering.
- `interview.md` — Common interview questions on mocking libraries.
- `tasks.md` — Hands-on tasks with `mockgen`, `mockery`, `moq`, `httpmock`.
- `find-bug.md` — Realistic bugs in mock-heavy test suites.
- `optimize.md` — Reducing mock noise, speeding up generation, slimming fixtures.

## Recommended reading order

1. Start with `junior.md` to learn one library (`go.uber.org/mock`) deeply.
2. Move to `middle.md` to see the alternative generator-based approach.
3. Read `senior.md` for the ecosystem map.
4. Finish with `professional.md` to learn when not to mock.
