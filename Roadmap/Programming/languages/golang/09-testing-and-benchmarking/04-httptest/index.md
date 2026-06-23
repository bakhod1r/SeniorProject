---
layout: default
title: net/http/httptest
parent: Testing and Benchmarking
grand_parent: Go
ancestor: Programming Languages
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/04-httptest/
---

# net/http/httptest

[← Back](../)

The `net/http/httptest` package is the standard-library toolkit for testing HTTP code in Go. It gives you two complementary tools: an in-process `ResponseRecorder` for unit-testing handlers without sockets, and an actual loopback `Server` bound to a random port for testing clients, middlewares, and end-to-end flows. Everything lives in the standard library; there is no third-party dependency to manage.

This section covers `httptest.NewRequest`, `httptest.NewRecorder`, `httptest.NewServer`, `httptest.NewUnstartedServer`, `httptest.NewTLSServer`, the `Server.Client()` helper, TLS testing with the self-signed cert pool, streaming responses, race-safety, cleanup discipline, and how `httptest` compares to spinning up a real local server on `:0`.

## Levels

- [Junior](junior/) — first handler test with `NewRecorder`; first server test with `NewServer`; reading the recorded response.
- [Middle](middle/) — TLS, middleware chains, testing `http.Client` code, cleanup idioms, the server's `Client()` method.
- [Senior](senior/) — streaming responses, chunked encoding, hijack limits, context and deadline propagation through middleware.
- [Professional](professional/) — production patterns: OAuth flows, webhooks, canned responses, multi-server fan-out, go-vcr/gock integration.

## References

- [Specification](specification/) — `net/http/httptest` godoc verbatim and struct fields.
- [Interview](interview/) — questions on `httptest` semantics.
- [Tasks](tasks/) — hands-on exercises.
- [Find the Bug](find-bug/) — common test-side bugs.
- [Optimize](optimize/) — `NewRecorder` vs `NewServer` cost.
