---
layout: default
title: Integration Tests — Specification
parent: Integration Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/13-integration-tests/specification/
---

# Integration Tests — Specification

[← Back](../)

This page is a normative reference. Everything later in the section
inherits the definitions, conventions and required properties laid out
here. Treat it as the contract integration tests must satisfy before they
land on `main`.

## 1. Definition

An integration test exercises two or more components together using their
real interfaces, with at most one external dependency replaced by an
in-process fake. The Go community typically draws the line at process or
network boundaries: if the system under test talks to a real Postgres, a
real Redis, a real Kafka broker or a real HTTP server it is an
integration test. If every dependency is a mock or stub it is a unit
test, even when it spans many packages.

| Tier        | Scope                | Doubles allowed  | Typical runtime |
|-------------|----------------------|------------------|-----------------|
| Unit        | one package          | all dependencies | < 50 ms         |
| Integration | several packages     | none for I/O     | 1 to 30 s       |
| End-to-end  | full deployment      | none             | > 30 s          |

The lines are not absolutes. A repository test using SQLite in memory is
sometimes classified as a unit test because it has no network, no
filesystem dependency outside the test process, and runs in tens of
milliseconds. The taxonomy is a tool; pick the categorization that helps
your team reason about the suite.

## 2. Conventions in Go

- Integration tests live in `*_test.go` files guarded by the build tag
  `//go:build integration` (Go 1.17+ syntax). A blank line must follow
  the tag.
- Run with `go test -tags=integration ./...`.
- Each test is independent — fresh schema, fresh transaction, or fresh
  topic per test.
- Containers and processes are terminated via `t.Cleanup` so that even
  `t.Fatal` from inside a helper leaves the host clean.
- Connection strings, broker addresses and similar coordinates come from
  the running container, never from a hard-coded constant.
- Build tags compose with `&&` and `||`. `//go:build integration && !race`
  is legal when a test does not survive `-race`, though preferring a
  race-clean test is always better.

## 3. Required properties

1. **Deterministic.** Repeating the same test on the same code yields the
   same result. Random sources are seeded from an environment variable
   logged at the start of every run, so failures reproduce.
2. **Hermetic.** Does not depend on developer machine state, locally
   installed services, environment variables outside of the harness, or
   files outside the module tree.
3. **Parallel-safe.** `t.Parallel()` is the default for read-only tests;
   writes go into isolated schemas, namespaces, topics or transactions.
4. **Self-cleaning.** Leaves no containers, ports, files or DNS entries
   behind. Confirm with `docker ps -a` after a full local run; the only
   surviving containers should be unrelated to the test session.
5. **Diagnosable.** When a test fails, the message names the failing
   condition, prints relevant state (DSN, topic, message offset), and
   ideally dumps container logs through `t.Logf`.

## 4. Non-goals

- Performance measurement — use benchmarks (`testing.B`).
- Browser automation — that is end-to-end territory, served by tools like
  Playwright or chromedp.
- Mocking the database — that is the domain of unit tests with fakes.
- Long-running soak tests — measure separately, do not mix with the merge
  gate.
- Manual setup steps — every dependency must be created and torn down by
  the test itself.

## 5. Failure modes that disqualify a test

The following patterns are grounds for review rejection:

- Hard-coded host ports (`localhost:8080`).
- `time.Sleep` instead of a wait loop or wait strategy.
- Skipping based on hostname (`if hostname != "buildbox-01"`).
- Reaching into another test's database.
- Catching errors with a bare `_` instead of asserting.
- Relying on a global mutable variable touched by other tests.

## 6. Versioning of test infrastructure

Pin every dependency by digest, not tag:

```go
const ImagePostgres = "postgres@sha256:1f3...c4"
```

Tags drift. Pinning by digest is the only way to guarantee that today's
green CI means anything in three months.

## 7. Out of scope

This specification does not prescribe a specific assertion library, a
specific migration tool or a specific orchestration platform. Teams
pick according to taste. What is fixed: build tag, cleanup discipline,
hermetic setup, deterministic runs. Everything else is implementation
detail.

## 8. Compatibility matrix

The conventions on this page assume:

| Component               | Version          |
|-------------------------|------------------|
| Go                      | 1.21+ (1.22+ preferred for `math/rand/v2`) |
| Build tag syntax        | `//go:build` (1.17+) |
| testcontainers-go       | 0.30+            |
| dockertest              | v3+              |
| Docker daemon API       | 1.41+ (Docker 20.10+) |
| Postgres image          | 14+              |
| Redis image             | 6+               |
| Kafka image             | confluentinc/cp-kafka 7.x |

Older versions may work but are not actively tested. Pin the digest of
whichever image you use; tag drift is the most common source of
"worked yesterday, broken today".

## 9. Vocabulary

The following terms appear throughout the section with precise
meanings:

- **Container.** A running instance of an image, addressable by a
  testcontainers handle.
- **Module.** A typed wrapper in `testcontainers-go/modules/<name>`
  that handles common dependencies (postgres, redis, kafka).
- **Wait strategy.** A condition the harness waits on before
  considering a container ready.
- **DSN.** The connection string a database driver uses to find a
  database.
- **Fixture.** Pre-set test data inserted before assertions.
- **Factory.** A typed helper that creates a fixture row and returns
  it.
- **Snapshot.** A captured database state restored before tests.
- **Flake.** A test that fails non-deterministically.
- **Quarantine.** A status applied to a flaky test that excludes it
  from the merge gate until fixed.

## 10. Acceptance criteria

For a PR introducing or modifying integration tests to land, the test
file must:

- Carry `//go:build integration` on the first line, followed by a
  blank line and the package clause.
- Reference one or more containers from approved modules
  (testcontainers-go modules or wrappers in `internal/testenv`).
- Use `t.Cleanup` for every allocated resource.
- Use `context.WithTimeout` (or test deadline) on every external
  call.
- Pass `go test -tags=integration -race -shuffle=on ./...` ten
  consecutive times locally.
- Add no leftover containers as detected by post-run `docker ps -a`.

If any acceptance criterion is unmet, the reviewer requests changes.
The criteria are intentionally strict; integration tests that fail
them are likely to become future flakes.

## 11. Living document

This specification evolves. Past decisions:

- 2024-08: dropped `// +build` syntax from accepted styles.
- 2025-03: required digest pinning for all images.
- 2025-09: required `-shuffle=on` in CI.
- 2026-01: required wait strategy on all containers, replacing
  permitted `time.Sleep` in legacy code.

Future decisions get documented in the same way. Engineers reading
this in five years should be able to trace why each rule exists.

## 12. Cross-references

Each rule in this specification connects to a longer discussion
elsewhere:

- Build tag: Junior, Section 3.
- Cleanup discipline: Junior, Section 7; Middle, Section 16.
- Wait strategies: Junior, Section 25.
- Determinism: Senior, Section 23.
- Flake quarantine: Professional, Section 5.

When in doubt, follow the link; the rationale lives there.

## 13. Reserved patterns

Certain patterns are reserved across the section and must not be
redefined locally:

- `//go:build integration` — the canonical build tag. Do not invent
  parallel tags like `it` or `inttest`; reviewers will reject them.
- `internal/testenv` — the harness package's canonical path. Tests
  import from this location.
- `TestMain` — name reserved by the `testing` package for one-time
  setup. Only one `TestMain` per package.
- `t.Cleanup` — the canonical teardown mechanism.

## 14. Numbering of pages

Section pages are numbered to suggest reading order, not strict
prerequisite:

1. Index (this page is page 2).
2. Specification.
3. Junior.
4. Middle.
5. Senior.
6. Professional.
7. Interview.
8. Tasks.
9. Find the bug.
10. Optimize.

Most readers go in order. Reference readers (preparing for an
interview, debugging a flaky test) jump directly to the relevant
page.

## 15. Discouraged alternatives

Some patterns appear in older Go codebases but are discouraged:

- `// +build integration` (replaced by `//go:build integration`).
- `defer container.Terminate(ctx)` instead of `t.Cleanup`.
- Hard-coded ports for `httptest`-equivalent servers.
- Global package state mutated by parallel tests.
- `os.Setenv` in tests (use `t.Setenv`).
- `time.Sleep` for synchronization.

When you see these patterns, modernize the code at the next reasonable
opportunity. They generate flakes in proportion to suite size.

## 16. Versioning and updates

This specification has a version: `2026.05`. Substantive changes
increment the year-month and add an entry to Section 11. Cosmetic
edits (typos, formatting) do not bump the version.

To reference a specific version in a PR description:

> Follows integration-tests specification 2026.05.

## 17. Closing

The specification is short on purpose. The longer pages elaborate;
this page constrains. Together they define what "good integration
test in Go" means in this section.

## 18. Common pitfalls explicitly out of compliance

To make the specification operational, here is a non-exhaustive list
of patterns that violate it and how to spot them on review:

- `import "github.com/some/random/integration-helper"` instead of the
  canonical `testcontainers-go` or `dockertest`. Justify in the PR.
- `time.Sleep(N * time.Second)` where N > 0. Reviewer should request
  a wait loop or wait strategy.
- A file with `_integration_test.go` suffix but no build tag.
  Compiles into every build; defeats the purpose.
- A test that reads from `os.Stdin`. Tests must not require manual
  interaction.
- Network calls to anything outside `localhost`. Tests must run
  offline.
- A test that hard-codes today's date. The test breaks on tomorrow.

## 19. Document conventions

Throughout the section:

- Code samples use `gofmt` style.
- Indentation is four spaces in markdown code fences (matches `gofmt`
  defaults).
- Examples are real Go; they would compile if surrounding context
  existed.
- Citations to packages use full import paths (`github.com/...`).
- Section numbering starts at 1; subsection numbering is implicit
  (no nested numbering).

These conventions make the section consistent enough to navigate
without rereading. Deviations are bugs; report them.

## 20. End of specification

What you have read constitutes the contract. The longer pages in the
section elaborate; the contract itself fits on a few screens.

When you write or review an integration test, return to this page if
you are unsure whether a pattern complies. The specification is the
shared baseline; everything else is enrichment.
