---
layout: default
title: E2E Tests — Specification
parent: E2E Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/14-e2e-tests/specification/
---

# E2E Tests — Specification

[← Back](../)

## Definition

End-to-end (E2E) testing exercises a deployed system through its public
interface, with all real external dependencies wired in, from the point of
view of a real client. The boundary of an E2E test is the same boundary a
production user sees: HTTP for a service, a CLI binary for a tool, a browser
for a web app. No internal hooks, no `httptest.NewServer`, no in-process
fakes. If a piece of the production wiring is not exercised by the test, the
test is not end-to-end for that piece.

## Required properties

A Go E2E test MUST satisfy the following invariants.

1. The system under test (SUT) is launched as one or more separate OS
   processes (or pods), not via in-process function calls.
2. All dependencies the SUT would talk to in production participate in the
   test, either as real instances (Postgres, Redis, S3, Kafka) or as
   high-fidelity substitutes (Localstack for AWS, Testcontainers Postgres,
   `kind` cluster for Kubernetes). Mocking the database is forbidden at the
   E2E layer.
3. The test interacts with the SUT through the same wire protocol the
   production client uses. HTTP services are called via `net/http`. Browser
   apps are driven via `github.com/chromedp/chromedp` or
   `github.com/playwright-community/playwright-go`. CLI binaries are spawned
   via `os/exec` (or `github.com/creack/pty` for interactive flows).
4. The test runs to completion without operator intervention. No prompts, no
   manual data setup steps.
5. Every assertion is observable from the client perspective. Reading the
   server's internal log files is allowed for diagnostics, but not for
   assertion.
6. The test reports its outcome solely through the `testing.T` contract:
   `t.Fatal`, `t.Error`, `t.Skip`. It does not exit the process directly.

## Out of scope

E2E tests MUST NOT:

- Use `httptest.NewServer`, `httptest.NewRecorder`, `iotest`, or any
  in-process HTTP harness. Those are integration tools.
- Stub or replace internal interfaces of the SUT. The SUT is a black box.
- Share state implicitly between tests. Two parallel E2E runs against the
  same env MUST be able to complete without one corrupting the other.
- Skip cleanup. Every resource a test creates (tenant, user, file, queue
  binding) MUST be deleted or scoped so it does not leak.
- Bypass authentication by reading internal secrets. The test obtains a
  token via the same flow a client would (admin-token endpoint, OAuth
  client credentials).

## Test scopes

| Scope         | Driver                              | Typical SUT                       |
|---------------|-------------------------------------|-----------------------------------|
| API           | `net/http`, gRPC client             | Backend microservice              |
| Browser       | `chromedp`, `playwright-go`         | Web frontend + backend            |
| CLI           | `os/exec`, `github.com/creack/pty`  | CLI binary                        |
| Mixed         | Any of above in one suite           | Tool that talks to a backend      |

A test that touches more than one scope (for example, an admin creates a
record via API and a user observes it in the browser) MUST treat each scope
through its own client. Sharing state via reused tokens is allowed; sharing
state via in-process structures is forbidden.

## Naming and layout

E2E tests live in `<repo>/test/e2e/...` or under a `e2e` build tag. Test
files end in `_e2e_test.go`. Functions start with `TestE2E_`. Smoke tests
that run after deploy use the prefix `TestE2E_Smoke_`.

```go
//go:build e2e

package e2e

import "testing"

func TestE2E_OrderCheckout(t *testing.T)        { /* ... */ }
func TestE2E_Smoke_ServiceUp(t *testing.T)      { /* ... */ }
```

The build tag keeps E2E tests out of the default `go test ./...` run so
developers iterating on unit tests do not pay the multi-minute startup cost.
A `go test -tags=e2e` invocation opts in.

## Environment contract

The E2E suite reads its target URL and credentials from environment
variables:

```
E2E_BASE_URL=https://staging.example.com
E2E_API_TOKEN=...
E2E_TENANT_PREFIX=e2e
E2E_ARTIFACTS_DIR=/tmp/e2e-artifacts
E2E_RUN_ID=<uuid>
```

If `E2E_BASE_URL` is unset, the suite MUST spin up an ephemeral environment
via `docker compose` (for simple stacks) or `kind` / `k3d` (for k8s-native
services). The bring-up MUST wait for a positive readiness signal before
running any test. The choice is documented in the README of each suite.

If `E2E_ARTIFACTS_DIR` is unset, the suite MUST write artefacts under
`./e2e-artifacts/<run-id>/<test-name>/`.

## Timing and flakiness

Every wait MUST have an explicit deadline. Polling MUST use a fixed or
exponential interval capped at a maximum. Tests MUST NOT use bare
`time.Sleep` to wait for system state — they MUST poll until the observed
state matches the expected state or the deadline expires. The deadline MUST
be passed via `context.WithTimeout` or an equivalent mechanism so the test
fails loudly instead of hanging.

Retries on transient HTTP failures (502, 503, 504, network reset) are
permitted up to a small bounded attempts count. Retries on 4xx (other than
408 and 429) are forbidden — they mask test bugs.

## Artefacts on failure

On failure the test MUST capture, when applicable:

- Browser screenshot (PNG) and DOM dump (HTML) for browser tests.
- Stdout/stderr of the CLI binary or service container for CLI tests.
- HTTP request/response transcripts for the failing API call.
- The last 200 lines of each container's logs.
- The `E2E_RUN_ID` so artefacts can be correlated with the CI run.

Artefacts go to `$E2E_ARTIFACTS_DIR/<test-name>/`. The suite MUST NOT
silently swallow artefact-capture errors.

## Parallelism

Tests that satisfy the isolation rule (per-tenant data, no shared mutable
state) MUST call `t.Parallel()`. The suite MUST run with `-parallel` set to
at least 4 in CI. The default value is acceptable for local invocation.

## Conformance

A test that violates any MUST in this document is not an E2E test.
Reclassify it as integration and move it to `test/integration/`. A
conforming suite passes a conformance audit: a reviewer walks the test list
and answers "does this hit the real wire?" for each one.

## Versioning of this specification

This specification is versioned alongside the suite it governs. A change
that loosens any MUST requires explicit sign-off; a change that tightens
one is welcome but MUST come with a migration plan for non-conforming tests.

## Cleanup ordering requirements

`t.Cleanup` calls run in last-in-first-out order. Tests that create
parent-child resources (a tenant and an order within it) MUST
register cleanup at creation time so the order is correct: order
created last is deleted first, before the tenant it belongs to.

Tests MUST NOT rely on `defer` for cleanup. `defer` runs only on the
test function's exit; it does not run when `t.FailNow` is called from
a helper goroutine, and it does not interleave with the `Cleanup` of
nested subtests.

## Build-tag and packaging requirements

All E2E test files MUST start with `//go:build e2e` as the first line.
The build constraint MUST be `e2e` (no qualifiers like `e2e,!short`). A
test that opts into the suite by any other mechanism is non-conforming.

The package name for E2E tests SHOULD be `e2e` (or a sub-package
descended from it). Mixing E2E test files into a package that contains
production code is forbidden — the build tag prevents accidental
inclusion, but the package boundary makes the separation explicit.

## Logging and output requirements

Tests MUST NOT log sensitive values: tokens, passwords, full credit card
numbers, full PII. If a value must appear in a diagnostic message, it
MUST be redacted (first 6 chars + ellipsis) or hashed.

Tests SHOULD log a per-test request ID at the start of execution so a
human reading the SUT's logs can correlate the failure with the
incoming request:

```go
reqID := uuid.NewString()
t.Logf("E2E request id: %s", reqID)
```

The request ID MUST be sent as `X-Request-ID` (or the team's chosen
header) on every HTTP call.

## Concurrent-execution requirements

A test that calls `t.Parallel()` MUST satisfy the isolation properties
listed earlier — per-tenant data, no shared mutable state, no global
fixture mutation. A test that cannot satisfy these MUST NOT call
`t.Parallel()`; the test runner serialises non-parallel tests.

`-parallel` MUST default to `GOMAXPROCS` in CI environments. Lower
values are permissible during initial debugging but MUST be returned to
default before merge.

## HTTP client requirements

Tests SHOULD share an `*http.Client` with a configured timeout and a
reasonable connection pool. The shared client MUST NOT be
`http.DefaultClient`; modifying the default client affects unrelated
code paths.

```go
var httpClient = &http.Client{
    Timeout: 30 * time.Second,
    Transport: &http.Transport{
        MaxIdleConns:        100,
        MaxIdleConnsPerHost: 10,
    },
}
```

Tests MUST close response bodies via `defer resp.Body.Close()`. Tests
that read only the status code MUST also drain the body
(`io.Copy(io.Discard, resp.Body)`) to allow connection reuse.

Tests MUST set a per-request context via `http.NewRequestWithContext`
using `t.Context()` (Go 1.24+) so the request is cancelled when the
test completes. Tests MUST NOT use `context.Background()` for HTTP
calls.

## Error message requirements

`t.Fatalf` and `t.Errorf` messages MUST include enough information to
diagnose the failure without re-running the test. The required
fields, when applicable:

- The expected value and the actual value.
- The HTTP status code and a snippet of the response body.
- The deadline used and the time elapsed.
- The request ID associated with the failing call.

A bare `assert.Equal(t, want, got)` without context is non-conforming
when it leaves the reader guessing about which request or which value
mismatched.

## Configuration loading

The suite MUST read its configuration from environment variables
exclusively. Configuration files, command-line flags beyond standard
`go test` flags, and config-discovery from disk are forbidden. The
rationale: a single mechanism (env vars) maps cleanly across local,
docker-compose, and CI environments.
