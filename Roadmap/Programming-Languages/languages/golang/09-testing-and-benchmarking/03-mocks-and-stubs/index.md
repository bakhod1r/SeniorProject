---
layout: default
title: Mocks and Stubs
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/03-mocks-and-stubs/
---

# Mocks and Stubs

Test doubles in Go: stubs, mocks, fakes, spies, and dummies. This section covers Fowler's taxonomy applied to Go's idiomatic patterns, hand-rolled stubs via interfaces, generated mocks with `testify/mock`, `mockery`, and `gomock` (`go.uber.org/mock`), in-memory fakes for repositories, and HTTP mocking with `httpmock`.

Go prefers small interfaces defined at the consumer plus hand-rolled stubs over heavy mock frameworks. We explain why, and when codegen earns its keep at scale.

## Pages

- [Junior](junior/) — Taxonomy, first hand-rolled stub, plain-English examples.
- [Middle](middle/) — `testify/mock`, `mockery` codegen, `gomock`, comparison.
- [Senior](senior/) — Why hand-rolled wins, interface segregation, behavior vs implementation, in-memory fakes.
- [Professional](professional/) — Production scenarios: HTTP, gRPC, DB fakes vs `sqlmock` vs real DB.
- [Specification](specification/) — Package docs and version notes.
- [Interview](interview/) — 25+ questions.
- [Tasks](tasks/) — Hand-rolled, then `testify`, then `gomock` — same interface, three styles.
- [Find the Bug](find-bug/) — Over-mocking, leaked expectations, race on mock state, missing order checks.
- [Optimize](optimize/) — Framework overhead, codegen vs reflection cost.

[Back to Testing and Benchmarking](../)
