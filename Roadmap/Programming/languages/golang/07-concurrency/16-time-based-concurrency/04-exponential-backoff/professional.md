---
layout: default
title: Professional
parent: Exponential Backoff
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/04-exponential-backoff/professional/
---

# Exponential Backoff — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Cenkalti/Backoff Walkthrough](#cenkaltibackoff-walkthrough)
5. [Hashicorp Go-Retryablehttp](#hashicorp-go-retryablehttp)
6. [AWS SDK V2 Retry Internals](#aws-sdk-v2-retry-internals)
7. [Integration With net/http](#integration-with-nethttp)
8. [Integration With gRPC](#integration-with-grpc)
9. [Service Config and Retry](#service-config-and-retry)
10. [gRPC Interceptors For Retry](#grpc-interceptors-for-retry)
11. [Circuit Breaker Integration](#circuit-breaker-integration)
12. [Sony/Gobreaker In Depth](#sonygobreaker-in-depth)
13. [Resilience4j-Style Composition](#resilience4j-style-composition)
14. [Observability — Metrics](#observability-metrics)
15. [Observability — Tracing](#observability-tracing)
16. [Observability — Logging](#observability-logging)
17. [Postmortem Case Studies](#postmortem-case-studies)
18. [Operational Runbook](#operational-runbook)
19. [Performance Tuning](#performance-tuning)
20. [End-To-End Example](#end-to-end-example)
21. [Best Practices](#best-practices)
22. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
23. [Common Mistakes](#common-mistakes)
24. [Tricky Questions](#tricky-questions)
25. [Cheat Sheet](#cheat-sheet)
26. [Summary](#summary)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)

---

## Introduction
> Focus: "Take everything from junior, middle, and senior and turn it into a production Go codebase using real libraries, with real observability, that survives real incidents."

This file is the bridge from theory to running production. The junior, middle, and senior files built the conceptual scaffolding. This file uses real libraries, real integration points, real monitoring, and real failure modes you will encounter in a Go service that handles millions of requests per day.

We will cover, in depth:

- **`cenkalti/backoff` v4** — the most popular Go retry library, from its API down to its internal state machine.
- **`hashicorp/go-retryablehttp`** — wraps `net/http` with retry semantics.
- **AWS SDK v2 retry** — full-jitter, classifier, rate limiter, all in production code.
- **gRPC retry** — service config, retry throttling, deadline propagation.
- **Circuit breaker composition** with `sony/gobreaker`.
- **OpenTelemetry tracing** — spans per attempt, retry-aware traces.
- **Prometheus metrics** — what to emit, what to alert on, how to build dashboards.
- **Structured logging** with `log/slog` and how to balance noise vs signal.
- **Real postmortem case studies** — three anonymised incidents and what changed afterwards.
- **An end-to-end example** — a payments client built using all of the above.

After reading this file you will be able to:

- Drop a battle-tested retry library into a Go project and configure it correctly.
- Wire retry, breaker, budget, and metrics together in a single client.
- Read library source code and predict failure modes.
- Diagnose retry-related incidents using metrics and traces.
- Tune retry policies based on observed behaviour.
- Write production-quality Go retry code that you would put your name on.

This is the level expected of staff engineers and tech leads. The skills here distinguish "knows about retries" from "can architect a resilient distributed system in Go".

---

## Prerequisites

- Complete the junior, middle, and senior files.
- Familiarity with Go modules, package structure, `go.mod`/`go.sum`.
- Familiarity with `net/http` client and server.
- Some exposure to gRPC, even if just the "hello world".
- Familiarity with Prometheus and basic metric types (counter, histogram, gauge).
- Familiarity with OpenTelemetry concepts (span, trace, attributes).
- Familiarity with `log/slog` or a structured logger like `zap`.

If you have not used these libraries before, plan to spend a couple of hours reading their docs. This file references them frequently.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`cenkalti/backoff`** | The canonical Go retry library. Provides `ExponentialBackOff`, `Retry`, `RetryNotify`. |
| **`hashicorp/go-retryablehttp`** | An HTTP client wrapper from HashiCorp that adds retry. |
| **`sony/gobreaker`** | A circuit-breaker implementation. Three states: closed, open, half-open. |
| **gRPC Service Config** | JSON document describing per-method retry, timeout, and load-balancing policy. |
| **gRPC interceptor** | A middleware function in the gRPC call pipeline. Used to add retry, tracing, metrics. |
| **OpenTelemetry** | A vendor-neutral observability framework. Provides tracing, metrics, logs APIs. |
| **`log/slog`** | Go 1.21+ standard structured logging package. |
| **`promauto`** | Prometheus library for auto-registered metrics. |
| **Resilience4j** | A Java library that popularised "decorator-stack" composition of timeout/retry/breaker/bulkhead. |

---

## Cenkalti/Backoff Walkthrough

`github.com/cenkalti/backoff/v4` is the most popular Go retry library. It is small (a few hundred lines), well-tested, and the API has been stable for years. Let us walk through it in depth.

### Installation

```
go get github.com/cenkalti/backoff/v4
```

Import:

```go
import "github.com/cenkalti/backoff/v4"
```

### The simplest usage

```go
operation := func() error {
    return doSomething()
}
err := backoff.Retry(operation, backoff.NewExponentialBackOff())
```

That is the whole API for trivial use cases. `Retry` keeps calling `operation` until it succeeds, or the backoff schedule signals "stop".

### What `NewExponentialBackOff` returns

```go
type ExponentialBackOff struct {
    InitialInterval     time.Duration  // 500ms by default
    RandomizationFactor float64         // 0.5 by default
    Multiplier          float64         // 1.5 by default
    MaxInterval         time.Duration  // 60s by default
    MaxElapsedTime      time.Duration  // 15 minutes by default
    Stop                time.Duration  // -1 (no early stop)
    Clock               Clock          // real clock by default
    
    currentInterval time.Duration
    startTime       time.Time
    random          *rand.Rand
}
```

The defaults:
- Initial interval: 500ms.
- Randomisation factor: 0.5 (i.e. uniform on `[currentInterval * 0.5, currentInterval * 1.5]`).
- Multiplier: 1.5 (each interval is 1.5× the previous).
- Max interval: 60 seconds.
- Max elapsed time: 15 minutes (after this, give up).

These defaults are conservative. For most user-facing code you want shorter values:

```go
b := backoff.NewExponentialBackOff()
b.InitialInterval = 100 * time.Millisecond
b.MaxInterval = 5 * time.Second
b.MaxElapsedTime = 30 * time.Second
```

### The schedule

Each call to `b.NextBackOff()` returns the next delay. The schedule (no randomisation, for clarity):

```
0:  500ms
1:  750ms
2:  1.125s
3:  1.687s
4:  2.531s
5:  3.797s
6:  5.696s
...
```

With randomisation factor 0.5, each actual delay is in `[interval * 0.5, interval * 1.5]`.

After 15 minutes of total elapsed time, `NextBackOff` returns `backoff.Stop` (a sentinel `-1`). The retry loop terminates.

### `Retry` internals

The source of `backoff.Retry`:

```go
func Retry(o Operation, b BackOff) error {
    return RetryNotify(o, b, nil)
}

func RetryNotify(operation Operation, b BackOff, notify Notify) error {
    return RetryNotifyWithTimer(operation, b, notify, nil)
}

func RetryNotifyWithTimer(operation Operation, b BackOff, notify Notify, t Timer) error {
    var err error
    var next time.Duration
    if t == nil {
        t = &defaultTimer{}
    }
    defer t.Stop()
    
    ctx := getContext(b)
    
    b.Reset()
    for {
        if err = operation(); err == nil {
            return nil
        }
        var permanent *PermanentError
        if errors.As(err, &permanent) {
            return permanent.Err
        }
        if next = b.NextBackOff(); next == Stop {
            if cerr := ctx.Err(); cerr != nil {
                return cerr
            }
            return err
        }
        if notify != nil {
            notify(err, next)
        }
        t.Start(next)
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C():
        }
    }
}
```

Reading this carefully:

1. The loop is unbounded; termination depends on `NextBackOff` returning `Stop`.
2. The operation is called, then evaluated.
3. `errors.As(err, &permanent)` checks if the caller used `backoff.Permanent(err)` to signal "do not retry".
4. `b.NextBackOff()` returns the next delay or `Stop`.
5. The notify callback (if set) lets you log or metric each retry.
6. A `select` over the timer and context.

The `context` integration is via `BackOffContext`:

```go
ctx, cancel := context.WithTimeout(parent, 30*time.Second)
defer cancel()

bWithCtx := backoff.WithContext(backoff.NewExponentialBackOff(), ctx)
err := backoff.Retry(operation, bWithCtx)
```

Now the loop respects `ctx.Done()`.

### `backoff.Permanent`

```go
err := backoff.Retry(func() error {
    resp, err := http.Get(url)
    if err != nil {
        return err // transient
    }
    if resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != 429 {
        return backoff.Permanent(fmt.Errorf("status %d", resp.StatusCode))
    }
    return nil
}, b)
```

The wrapping causes `Retry` to surface the error immediately.

### `RetryNotify` for metrics

```go
notify := func(err error, d time.Duration) {
    log.Printf("retry after %v: %v", d, err)
    retryCounter.Inc()
}
err := backoff.RetryNotify(operation, b, notify)
```

Each retry triggers the callback. Convenient for logging and metrics.

### `ConstantBackOff`

For testing or specific use cases:

```go
b := backoff.NewConstantBackOff(100 * time.Millisecond)
err := backoff.Retry(op, b)
```

Each delay is the same. Not exponential; mostly useful for tests.

### `WithMaxRetries`

```go
b := backoff.WithMaxRetries(backoff.NewExponentialBackOff(), 5)
```

Wraps another `BackOff` with a max-retries decorator. After 5 attempts, returns `Stop`.

### `BackOffContext`

```go
b := backoff.WithContext(backoff.NewExponentialBackOff(), ctx)
```

Returns a `BackOff` that returns `Stop` if the context is done.

### Composing

You can compose the wrappers:

```go
b := backoff.NewExponentialBackOff()
b.InitialInterval = 100 * time.Millisecond
b.MaxInterval = 5 * time.Second
bWithMax := backoff.WithMaxRetries(b, 5)
bWithCtx := backoff.WithContext(bWithMax, ctx)

err := backoff.RetryNotify(operation, bWithCtx, notify)
```

This is "exponential, capped at 5s, max 5 retries, context-aware, with notify callback for metrics". A production-grade retry in 4 lines.

### Caveats

- The randomisation factor is *symmetric*: `delay = interval ± interval * factor`. So with factor 0.5, the delay is uniform on `[0.5 * interval, 1.5 * interval]`. This is closer to "equal jitter" than "full jitter".
- The default `MaxElapsedTime` of 15 minutes is far too long for user-facing operations. Set it explicitly.
- `backoff.Retry` does not pass the context to the operation. You must capture it in a closure.
- The `defaultTimer` uses `time.NewTimer` and `time.Stop`, properly. No leak.

### Recommended setup

```go
func NewBackoff() backoff.BackOff {
    b := backoff.NewExponentialBackOff()
    b.InitialInterval = 100 * time.Millisecond
    b.MaxInterval = 5 * time.Second
    b.MaxElapsedTime = 30 * time.Second
    return b
}

func Retry(ctx context.Context, op func() error) error {
    return backoff.RetryNotify(
        op,
        backoff.WithContext(NewBackoff(), ctx),
        func(err error, d time.Duration) {
            slog.Debug("retrying", "err", err, "delay", d)
            retryCounter.Inc()
        },
    )
}
```

Drop this into your codebase. It is production-ready.

---

## Hashicorp Go-Retryablehttp

`github.com/hashicorp/go-retryablehttp` wraps `net/http.Client` with retry. It is HashiCorp's standard for client-side retry.

### Installation

```
go get github.com/hashicorp/go-retryablehttp
```

### Basic usage

```go
import "github.com/hashicorp/go-retryablehttp"

client := retryablehttp.NewClient()
client.RetryMax = 5
client.RetryWaitMin = 100 * time.Millisecond
client.RetryWaitMax = 5 * time.Second

resp, err := client.Get("https://example.com")
```

That is it. The returned `*http.Response` is a normal Go HTTP response.

### What it retries on

By default:
- Network errors.
- HTTP `500` and above.
- HTTP `429`.

You can override with `client.CheckRetry`:

```go
client.CheckRetry = func(ctx context.Context, resp *http.Response, err error) (bool, error) {
    if err != nil {
        return true, nil // network error
    }
    if resp.StatusCode == 429 || (resp.StatusCode >= 500 && resp.StatusCode <= 599) {
        return true, nil
    }
    return false, nil
}
```

### The backoff function

By default, `DefaultBackoff` does exponential with jitter:

```go
func DefaultBackoff(min, max time.Duration, attemptNum int, resp *http.Response) time.Duration {
    if resp != nil {
        if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusServiceUnavailable {
            if s, ok := resp.Header["Retry-After"]; ok {
                if sleep, err := strconv.ParseInt(s[0], 10, 64); err == nil {
                    return time.Second * time.Duration(sleep)
                }
            }
        }
    }
    mult := math.Pow(2, float64(attemptNum)) * float64(min)
    sleep := time.Duration(mult)
    if float64(sleep) != mult || sleep > max {
        sleep = max
    }
    return sleep
}
```

Note that this is `min * 2^attemptNum` without jitter (the standard exponential). For jitter, you can replace with:

```go
client.Backoff = func(min, max time.Duration, attemptNum int, resp *http.Response) time.Duration {
    if resp != nil && resp.Header.Get("Retry-After") != "" {
        if secs, err := strconv.ParseInt(resp.Header.Get("Retry-After"), 10, 64); err == nil {
            return time.Duration(secs) * time.Second
        }
    }
    cap := min * time.Duration(1<<attemptNum)
    if cap > max {
        cap = max
    }
    return time.Duration(rand.Int63n(int64(cap))) // full jitter
}
```

### Request body re-reading

`retryablehttp` automatically wraps the body so it can be re-read on retry. You can pass `io.Reader`, `[]byte`, or a `*retryablehttp.ReaderFunc`:

```go
body := []byte(`{"key": "value"}`)
req, err := retryablehttp.NewRequest("POST", url, body)
```

Internally, the library reads the body once and replays it on each attempt. No body-already-consumed bug.

### Logger

```go
client.Logger = log.New(os.Stderr, "", log.LstdFlags)
```

Logs each attempt.

### Conclusion

`hashicorp/go-retryablehttp` is a drop-in for `http.Client` with retry. If you do not want to roll your own, this is the recommended choice.

---

## AWS SDK V2 Retry Internals

The AWS SDK has a sophisticated retry implementation. Worth studying because it represents industry best practice from a team that operates massive infrastructure.

### Configuration

```go
import (
    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/aws/retry"
    "github.com/aws/aws-sdk-go-v2/config"
)

cfg, err := config.LoadDefaultConfig(ctx,
    config.WithRetryer(func() aws.Retryer {
        return retry.NewStandard(func(o *retry.StandardOptions) {
            o.MaxAttempts = 5
            o.MaxBackoff = 5 * time.Second
        })
    }),
)
```

### `retry.Standard`

The `Standard` retryer:

- Uses full jitter.
- Has a retry token bucket: 5 tokens per failed call, 1 token per retry. Empty bucket = no retry.
- Configurable max attempts (default 3).
- Configurable max backoff (default 20s).
- Configurable retryables (errors and status codes that trigger retry).

### Source code highlights

The token bucket is at `aws/retry/retryable_error.go`:

```go
type tokenRetryQuota interface {
    HasRetryToken() bool
    RetrieveToken() error
    ReleaseToken(...) 
}
```

Each retry attempts to retrieve a token. If empty, retry is skipped.

The token system protects against retry storms when many calls fail simultaneously.

### The standard retryer's algorithm

```go
func (s *Standard) RetryDelay(attempt int, err error) (time.Duration, error) {
    return s.backoff.BackoffDelay(attempt, err)
}
```

Where `backoff` is `NewExponentialJitterBackoff` from `aws-sdk-go-v2/aws/retry`. The formula:

```go
func (j *ExponentialJitterBackoff) BackoffDelay(attempt int, err error) (time.Duration, error) {
    delay := time.Duration(1<<uint(attempt)) * j.MaxBackoff
    if delay > j.MaxBackoff {
        delay = j.MaxBackoff
    }
    jitterDelay, err := j.rand.Int63n(int64(delay))
    if err != nil {
        return 0, err
    }
    return time.Duration(jitterDelay), nil
}
```

This is *full jitter*, with the cap being `MaxBackoff`. Notice the `rand.Int63n` — same primitive as our hand-rolled jitter.

### Classifier

The classifier decides which errors are retryable:

```go
type Retryables []IsErrorRetryable

func (rs Retryables) IsErrorRetryable(err error) aws.Ternary {
    for _, r := range rs {
        if v := r.IsErrorRetryable(err); v != aws.UnknownTernary {
            return v
        }
    }
    return aws.UnknownTernary
}
```

Standard retryables include `RetryableConnectionError`, `RetryableHTTPStatusCode`, `RetryableErrorCode`. Each is a struct with rules.

Custom classification:

```go
o.Retryables = append(o.Retryables, retry.IsErrorRetryableFunc(func(err error) aws.Ternary {
    if strings.Contains(err.Error(), "my custom transient") {
        return aws.TrueTernary
    }
    return aws.UnknownTernary
}))
```

### Why study AWS's retry?

Two reasons:

1. It is the largest production deployment of retry in the Go ecosystem.
2. It illustrates the patterns we have discussed: full jitter, token bucket, classifier, max attempts. All in one library.

If you ever wonder "is this retry design right?", check what AWS does.

---

## Integration With net/http

You have two paths: use `hashicorp/go-retryablehttp` or wrap your own.

### Approach 1: hashicorp library (recommended)

```go
import "github.com/hashicorp/go-retryablehttp"

client := retryablehttp.NewClient()
client.RetryMax = 3
client.RetryWaitMin = 100 * time.Millisecond
client.RetryWaitMax = 5 * time.Second
client.Logger = nil // disable noisy logging
```

You now have an HTTP client with retry. Use it like `*http.Client`:

```go
resp, err := client.Get(url)
// or
req, _ := retryablehttp.NewRequest("POST", url, body)
resp, err := client.Do(req)
```

### Approach 2: custom wrapper

If you need more control:

```go
package httpclient

import (
    "bytes"
    "context"
    "io"
    "net/http"
    "time"

    "github.com/cenkalti/backoff/v4"
)

type Client struct {
    HTTP *http.Client
    NewBackoff func() backoff.BackOff
}

func New() *Client {
    return &Client{
        HTTP: &http.Client{Timeout: 10 * time.Second},
        NewBackoff: func() backoff.BackOff {
            b := backoff.NewExponentialBackOff()
            b.InitialInterval = 100 * time.Millisecond
            b.MaxInterval = 5 * time.Second
            b.MaxElapsedTime = 30 * time.Second
            return b
        },
    }
}

func (c *Client) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
    var body []byte
    if req.Body != nil {
        var err error
        body, err = io.ReadAll(req.Body)
        if err != nil {
            return nil, err
        }
        req.Body.Close()
    }
    
    var resp *http.Response
    b := backoff.WithContext(c.NewBackoff(), ctx)
    err := backoff.Retry(func() error {
        var bodyReader io.Reader
        if body != nil {
            bodyReader = bytes.NewReader(body)
        }
        attemptReq, err := http.NewRequestWithContext(ctx, req.Method, req.URL.String(), bodyReader)
        if err != nil {
            return backoff.Permanent(err)
        }
        attemptReq.Header = req.Header.Clone()
        
        r, err := c.HTTP.Do(attemptReq)
        if err != nil {
            return err // transient
        }
        if r.StatusCode == 429 || (r.StatusCode >= 500 && r.StatusCode <= 599) {
            r.Body.Close()
            return fmt.Errorf("status %d", r.StatusCode)
        }
        if r.StatusCode >= 400 {
            return backoff.Permanent(fmt.Errorf("status %d", r.StatusCode))
        }
        resp = r
        return nil
    }, b)
    return resp, err
}
```

This is similar to what `hashicorp/go-retryablehttp` does internally. The advantage of rolling your own is fitting your specific conventions (logging, metrics, etc.).

### Request body considerations

Both approaches need to handle the body. `bytes.NewReader` is seekable; for arbitrary `io.Reader`, you must read it all into memory first. For very large bodies, retry is impractical.

Best practice: keep bodies under 1 MB and read them into memory. For larger bodies, design the API to be resumable or accept that retry is impossible.

### Connection pool considerations

`net/http.Transport` keeps connections alive. A retried request may use a different underlying connection. This is usually fine but can confuse debugging (the original request used connection A; the retry used connection B; both connections look healthy in `netstat`).

For HTTPS, connection reuse is important — TLS handshakes are expensive. Do not disable keep-alives unless you have specific reasons.

---

## Integration With gRPC

gRPC has built-in retry support. Configure via service config.

### Service config JSON

```json
{
  "methodConfig": [{
    "name": [{"service": "myapp.Service"}],
    "retryPolicy": {
      "maxAttempts": 4,
      "initialBackoff": "0.1s",
      "maxBackoff": "5s",
      "backoffMultiplier": 2,
      "retryableStatusCodes": ["UNAVAILABLE", "DEADLINE_EXCEEDED"]
    }
  }]
}
```

### Loading the config in Go

```go
import "google.golang.org/grpc"

svc := `{
  "methodConfig": [{
    "name": [{"service": "myapp.Service"}],
    "retryPolicy": {
      "maxAttempts": 4,
      "initialBackoff": "0.1s",
      "maxBackoff": "5s",
      "backoffMultiplier": 2,
      "retryableStatusCodes": ["UNAVAILABLE"]
    }
  }]
}`

conn, err := grpc.NewClient("dns:///service",
    grpc.WithDefaultServiceConfig(svc),
    grpc.WithTransportCredentials(insecure.NewCredentials()),
)
```

That is all. gRPC retries any matching call automatically.

### Throttling

Add retry throttling:

```json
{
  "retryThrottling": {
    "maxTokens": 10,
    "tokenRatio": 0.1
  },
  "methodConfig": [...]
}
```

Each successful call adds 0.1 tokens. Each failed retry costs 1 token. When tokens drop below 5, retries are denied.

### Per-method config

You can have different policies per method:

```json
{
  "methodConfig": [
    {
      "name": [{"service": "myapp.Reads", "method": "Get"}],
      "retryPolicy": { ... }
    },
    {
      "name": [{"service": "myapp.Writes", "method": "Create"}],
      "retryPolicy": null  // no retry for writes
    }
  ]
}
```

Often you want reads retried aggressively and writes only with idempotency keys.

### Deadline propagation

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
resp, err := client.MyMethod(ctx, req)
```

The 5-second deadline is sent as `grpc-timeout` metadata. The server reads it. Downstream gRPC calls automatically inherit.

If retries are happening, the *total* time including retries is bounded by the deadline.

### Retryable status codes

| Code | Retryable? |
|------|------------|
| UNAVAILABLE | Yes |
| DEADLINE_EXCEEDED | Sometimes (context: see below) |
| RESOURCE_EXHAUSTED | Sometimes (need to slow down) |
| CANCELLED | No (caller cancelled) |
| INVALID_ARGUMENT | No |
| NOT_FOUND | No |
| ALREADY_EXISTS | No |
| PERMISSION_DENIED | No |
| FAILED_PRECONDITION | No |
| ABORTED | Sometimes (optimistic-lock conflict; retry with new data) |
| OUT_OF_RANGE | No |
| UNIMPLEMENTED | No |
| INTERNAL | Usually yes |
| DATA_LOSS | No |
| UNAUTHENTICATED | No (re-auth first) |

`DEADLINE_EXCEEDED` is tricky: a server-side deadline-exceeded is retryable (the server might be faster next time), but a client-side deadline-exceeded is not (the caller has given up).

---

## Service Config and Retry

A deeper look at gRPC's retry config.

### How gRPC retries internally

1. Client calls `client.MyMethod(ctx, req)`.
2. gRPC stub checks the retry policy from service config.
3. Stub calls the server. If the call fails with a retryable status code, gRPC waits per the policy and retries.
4. Each retry decrements the retry-throttling token.
5. After `maxAttempts` total attempts (including the first), gRPC returns the final error.

The client does not see individual attempts. From the client's perspective, the call either succeeds or returns the final error after all attempts.

### Idempotent semantics in gRPC

gRPC retries assume idempotency. If your method is not idempotent, configure `maxAttempts: 1` (no retry) or accept the risk.

Some services use a request-level idempotency key in the proto:

```protobuf
message ChargeRequest {
  string idempotency_key = 1;
  // ...
}
```

The server deduplicates based on the key.

### Hedging vs retry in gRPC

gRPC supports both. Hedging is configured separately:

```json
{
  "methodConfig": [{
    "name": [{"service": "myapp.Reads"}],
    "hedgingPolicy": {
      "maxAttempts": 3,
      "hedgingDelay": "0.1s",
      "nonFatalStatusCodes": []
    }
  }]
}
```

Hedging sends duplicates after the delay. First success wins. The two patterns are mutually exclusive per method.

### Tuning service config

Start conservative. Measure. Tune. Common pattern:

1. Deploy with `maxAttempts: 1` (no retry). Observe failure rates.
2. Add `maxAttempts: 3` with full retry policy. Observe retry rate.
3. If retry rate is low and success-after-retry is high, increase max attempts.
4. If retry rate is high, lower the threshold for retry throttling.

This is empirical tuning. There is no universal right answer.

---

## gRPC Interceptors For Retry

If you need behaviour beyond what service config provides — custom backoff, custom classifiers, integration with your retry library — write an interceptor.

### Unary interceptor

```go
import (
    "context"
    "google.golang.org/grpc"
    "github.com/cenkalti/backoff/v4"
)

func RetryUnaryInterceptor(b backoff.BackOff) grpc.UnaryClientInterceptor {
    return func(ctx context.Context, method string, req, reply interface{}, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
        bCtx := backoff.WithContext(b, ctx)
        return backoff.Retry(func() error {
            err := invoker(ctx, method, req, reply, cc, opts...)
            if err == nil {
                return nil
            }
            if !isRetryable(err) {
                return backoff.Permanent(err)
            }
            return err
        }, bCtx)
    }
}

func isRetryable(err error) bool {
    st, ok := status.FromError(err)
    if !ok {
        return false
    }
    switch st.Code() {
    case codes.Unavailable, codes.DeadlineExceeded, codes.Internal:
        return true
    }
    return false
}
```

Use:

```go
b := backoff.NewExponentialBackOff()
b.InitialInterval = 100 * time.Millisecond
b.MaxInterval = 5 * time.Second
b.MaxElapsedTime = 30 * time.Second

conn, err := grpc.NewClient("dns:///service",
    grpc.WithUnaryInterceptor(RetryUnaryInterceptor(b)),
    grpc.WithTransportCredentials(insecure.NewCredentials()),
)
```

Now every unary call on this connection is retried.

### Stream interceptors

Streaming RPCs are harder. The retry needs to know how to replay the client side of the stream. If the client has already sent N messages, the retry must resend them. This is application-specific.

Best practice: do not retry streaming RPCs in the interceptor. Build retry into the application logic where you have the context.

### Composing interceptors

Multiple interceptors compose:

```go
conn, err := grpc.NewClient("dns:///service",
    grpc.WithChainUnaryInterceptor(
        TracingUnaryInterceptor(),
        MetricsUnaryInterceptor(),
        RetryUnaryInterceptor(b),
    ),
)
```

Order matters. Tracing should be outermost (so it captures retries as one logical span). Retry should be innermost relative to tracing but outer relative to anything that should run per-attempt.

---

## Circuit Breaker Integration

A circuit breaker complements retry. Retry handles transient; breaker handles persistent.

### Two-layer composition

```go
type Client struct {
    Retrier *retry.Retrier
    Breaker *gobreaker.CircuitBreaker
}

func (c *Client) Do(ctx context.Context, op func(context.Context) error) error {
    return c.Retrier.Do(ctx, func(ctx context.Context) error {
        _, err := c.Breaker.Execute(func() (interface{}, error) {
            return nil, op(ctx)
        })
        if errors.Is(err, gobreaker.ErrOpenState) {
            return retry.MarkPermanent(err)
        }
        return err
    })
}
```

The breaker is inside the retrier. If the breaker opens, the retrier sees it as permanent and stops.

### One failure event per retry sequence

A subtle point: the breaker should not record every retry as a separate failure. If 5 retries all fail, that is *one* user-visible failure.

The simplest way: only record the *final* outcome.

```go
func (c *Client) Do(ctx context.Context, op func(context.Context) error) error {
    if state := c.Breaker.State(); state == gobreaker.StateOpen {
        return retry.MarkPermanent(gobreaker.ErrOpenState)
    }
    err := c.Retrier.Do(ctx, op)
    c.Breaker.Counts() // or a custom record method
    return err
}
```

But `gobreaker` records via `Execute`. Workaround: wrap the *retrier* in `Execute`:

```go
func (c *Client) Do(ctx context.Context, op func(context.Context) error) error {
    _, err := c.Breaker.Execute(func() (interface{}, error) {
        return nil, c.Retrier.Do(ctx, op)
    })
    return err
}
```

Now the breaker sees the retrier's final outcome — success or failure — as one event.

### Trade-offs

- Breaker outside retrier: one event per user request. Breaker opens slowly.
- Breaker inside retrier: one event per attempt. Breaker opens faster.

The "outside" composition is usually right. The "inside" composition is useful if you want the breaker to react quickly to a series of failures within one user request — which usually means the breaker thresholds are too low.

---

## Sony/Gobreaker In Depth

`github.com/sony/gobreaker` is the standard Go circuit breaker. ~400 lines, well-tested, simple API.

### States

- **Closed:** requests go through.
- **Open:** requests are rejected with `ErrOpenState`.
- **Half-open:** a few requests go through; success closes; failure re-opens.

### Settings

```go
cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
    Name:        "stripe",
    MaxRequests: 5,                // in half-open state, how many to allow
    Interval:    60 * time.Second, // window for counting failures in closed state
    Timeout:     30 * time.Second, // time in open state before going half-open
    ReadyToTrip: func(c gobreaker.Counts) bool {
        return c.Requests >= 20 && float64(c.TotalFailures)/float64(c.Requests) > 0.5
    },
})
```

The `ReadyToTrip` callback decides when to open. The argument is the current count of requests, total failures, consecutive failures, etc.

A common pattern: open if at least 20 requests in the window and failure rate exceeds 50%.

### Execute

```go
result, err := cb.Execute(func() (interface{}, error) {
    return doSomething()
})
if err != nil {
    if errors.Is(err, gobreaker.ErrOpenState) {
        // breaker is open
    } else {
        // operation failed
    }
}
```

`Execute` records success/failure automatically and may transition states.

### State observability

```go
state := cb.State() // Closed, HalfOpen, or Open
counts := cb.Counts() // current counters
```

Useful for metrics.

### State transitions

You can hook into transitions:

```go
cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
    OnStateChange: func(name string, from, to gobreaker.State) {
        slog.Info("breaker state change", "name", name, "from", from, "to", to)
        breakerStateChangeCounter.WithLabelValues(name, to.String()).Inc()
    },
})
```

Alert when breaker opens. Critical operational signal.

### Picking thresholds

The threshold is workload-specific:

- High-volume, low-failure-rate service: 50% failure over 20 requests is a sharp drop.
- Low-volume service: may need a smaller request count (e.g. 5 requests) for the breaker to trigger.

Start conservative (high threshold), tune based on observation.

### Open duration

The `Timeout` is how long the breaker stays open. After this, it goes to half-open and probes.

- Too short: thrashing. Open, close, open, close.
- Too long: takes too long to recover after the dependency comes back.

30 seconds is a common default. Adjust based on the dependency's MTTR.

### Half-open behaviour

In half-open, the breaker allows `MaxRequests` probes. If all succeed, the breaker closes. If any fail, it re-opens.

`MaxRequests = 5` is a reasonable default. Too low and you cannot reliably detect recovery; too high and you let too many requests through during testing.

### Per-dependency breakers

You should have one breaker per dependency, not a single global breaker:

```go
type Breakers struct {
    Stripe   *gobreaker.CircuitBreaker
    Internal *gobreaker.CircuitBreaker
    Db       *gobreaker.CircuitBreaker
}
```

A Stripe outage should not stop your DB calls.

---

## Resilience4j-Style Composition

Resilience4j (Java library) popularised "decorator stack" composition. The same approach works in Go.

### The composition stack

A typical stack:

```
fallback(
  cache(
    retry(
      breaker(
        bulkhead(
          rate_limiter(
            timeout(call)
          )
        )
      )
    )
  )
)
```

Reading outside-in: fallback gives a default; cache short-circuits; retry handles transient; breaker fails fast; bulkhead limits concurrency; rate limiter caps RPS; timeout bounds per-call.

### Go implementation

```go
package resilience

import (
    "context"
    "time"

    "github.com/cenkalti/backoff/v4"
    "github.com/sony/gobreaker"
    "golang.org/x/time/rate"
    "golang.org/x/sync/semaphore"
)

type Chain struct {
    Timeout    time.Duration
    RateLimit  *rate.Limiter
    Bulkhead   *semaphore.Weighted
    Breaker    *gobreaker.CircuitBreaker
    BackOffNew func() backoff.BackOff
    Cache      func(ctx context.Context, key string) (interface{}, bool)
    Fallback   func(ctx context.Context, key string) (interface{}, error)
}

func (c *Chain) Do(ctx context.Context, key string, op func(context.Context) (interface{}, error)) (interface{}, error) {
    // Cache
    if c.Cache != nil {
        if v, ok := c.Cache(ctx, key); ok {
            return v, nil
        }
    }
    
    // Rate limit
    if c.RateLimit != nil {
        if err := c.RateLimit.Wait(ctx); err != nil {
            if c.Fallback != nil {
                return c.Fallback(ctx, key)
            }
            return nil, err
        }
    }
    
    // Bulkhead
    if c.Bulkhead != nil {
        if err := c.Bulkhead.Acquire(ctx, 1); err != nil {
            if c.Fallback != nil {
                return c.Fallback(ctx, key)
            }
            return nil, err
        }
        defer c.Bulkhead.Release(1)
    }
    
    // Timeout per attempt
    var result interface{}
    err := backoff.Retry(func() error {
        attemptCtx, cancel := context.WithTimeout(ctx, c.Timeout)
        defer cancel()
        
        // Breaker
        var err error
        result, err = c.Breaker.Execute(func() (interface{}, error) {
            return op(attemptCtx)
        })
        return err
    }, backoff.WithContext(c.BackOffNew(), ctx))
    
    if err != nil && c.Fallback != nil {
        return c.Fallback(ctx, key)
    }
    return result, err
}
```

This is a heavyweight composition; not needed for every call. Use for critical-path dependencies.

### Decorator vs builder

Resilience4j uses decorators (function composition). Go's syntactic ceremony makes this awkward. The struct-based approach above is more idiomatic Go.

You could also use middleware-style:

```go
type Middleware func(next OpFunc) OpFunc

retry := func(next OpFunc) OpFunc {
    return func(ctx context.Context) (interface{}, error) {
        return backoff.Retry(...)
    }
}
breaker := func(next OpFunc) OpFunc { ... }

op = retry(breaker(timeout(call)))
```

This is closer to Resilience4j. Use whichever feels natural.

---

## Observability — Metrics

Production retry requires metrics. Without them, you cannot tell when retries are happening or whether they are helping.

### What to measure

| Metric | Type | Labels |
|--------|------|--------|
| `retry_attempts_total` | counter | client, op, outcome |
| `retry_successes_total` | counter | client, op |
| `retry_giveups_total` | counter | client, op, reason |
| `retry_budget_denied_total` | counter | client, op |
| `retry_breaker_denied_total` | counter | client, op |
| `retry_attempt_at_success` | histogram | client, op |
| `retry_attempt_duration_seconds` | histogram | client, op, attempt |
| `breaker_state` | gauge | name |

### Prometheus client

```go
import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

var (
    attempts = promauto.NewCounterVec(
        prometheus.CounterOpts{Name: "retry_attempts_total"},
        []string{"client", "op", "outcome"},
    )
    attemptAtSuccess = promauto.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "retry_attempt_at_success",
            Buckets: []float64{1, 2, 3, 5, 10},
        },
        []string{"client", "op"},
    )
)

func (r *Retrier) Do(ctx context.Context, op func(context.Context) error) error {
    client := r.Name
    operation := getOpName(ctx)
    var lastErr error
    for attempt := 0; attempt < r.MaxAttempts; attempt++ {
        err := op(ctx)
        if err == nil {
            attempts.WithLabelValues(client, operation, "success").Inc()
            attemptAtSuccess.WithLabelValues(client, operation).Observe(float64(attempt + 1))
            return nil
        }
        attempts.WithLabelValues(client, operation, "failure").Inc()
        lastErr = err
        // ... rest of retry logic
    }
    return lastErr
}
```

### Building dashboards

A retry dashboard should show:

1. **Retry rate.** `sum(rate(retry_attempts_total{outcome="failure"}[5m])) by (client)`.
2. **Retry ratio.** `sum(rate(retry_attempts_total[5m])) / sum(rate(retry_successes_total[5m]))`.
3. **Success-at-attempt histogram.** What fraction of requests succeed at attempt 1, 2, 3, etc.
4. **Budget denial rate.** `sum(rate(retry_budget_denied_total[5m]))`.
5. **Breaker state.** `breaker_state` over time.

Each panel should have alerts:

- Retry rate > 5% — warn.
- Budget denial > 0 — page.
- Breaker open > 60s — page.
- Avg attempts > 1.5 — warn.

### Cardinality

Be careful with labels. `op` should be a method name (e.g. `Charge`), not a URL with IDs. Otherwise cardinality explodes.

A `op` label with ~50 distinct values is fine. A `op` label with 50,000 values is a memory bomb.

---

## Observability — Tracing

OpenTelemetry traces let you see retries in context.

### Setup

```go
import "go.opentelemetry.io/otel"

tracer := otel.Tracer("retry")
```

### Per-retry spans

```go
func (r *Retrier) Do(ctx context.Context, op func(context.Context) error) error {
    ctx, parentSpan := tracer.Start(ctx, "retry.Do",
        trace.WithAttributes(
            attribute.String("client", r.Name),
            attribute.Int("max_attempts", r.MaxAttempts),
        ),
    )
    defer parentSpan.End()
    
    for attempt := 0; attempt < r.MaxAttempts; attempt++ {
        attemptCtx, attemptSpan := tracer.Start(ctx, fmt.Sprintf("retry.attempt.%d", attempt+1))
        err := op(attemptCtx)
        if err != nil {
            attemptSpan.RecordError(err)
            attemptSpan.SetStatus(codes.Error, err.Error())
        }
        attemptSpan.End()
        if err == nil {
            parentSpan.SetAttributes(attribute.Int("successful_attempt", attempt+1))
            return nil
        }
        // ... retry logic ...
    }
    return nil
}
```

In your tracing UI you see:

```
[──────── retry.Do ─────────]
   [─ attempt 1 ─]
              [─ attempt 2 ─]
                        [─ attempt 3 ─] (success)
```

Each attempt's sub-spans (HTTP request, DB query, etc.) appear under the attempt span.

### Linking retries

Modern tracing (OTel 1.0+) supports span links. The parent span gathers attributes; each attempt is a child. The retry mechanism is visible.

### Sampling

In high-volume systems, you cannot trace every request. Sample 1% (or less) for traces. Retries are still recorded in metrics for 100% of requests.

For incident response, you may temporarily enable 100% tracing on a specific endpoint.

### Tracing across services

If you call another service via gRPC or HTTP, the tracing context propagates automatically (via `traceparent` header). The downstream service's spans appear in the same trace.

---

## Observability — Logging

Structured logs complement metrics and traces.

### Use `log/slog`

```go
import "log/slog"

logger := slog.Default()
```

### Log levels

- DEBUG: every attempt.
- INFO: every retry-then-success.
- WARN: every give-up.
- ERROR: every breaker-open transition.

### Structured fields

```go
logger.Debug("retry attempt",
    slog.String("client", r.Name),
    slog.String("op", opName),
    slog.Int("attempt", attempt+1),
    slog.Any("err", err),
)
```

### Correlation

Include the trace ID in every log:

```go
span := trace.SpanFromContext(ctx)
logger := slog.With(
    slog.String("trace_id", span.SpanContext().TraceID().String()),
)
```

Now you can grep logs by trace ID and see all retry attempts for one user request.

### Don't log secrets

The request body may have sensitive data (passwords, tokens). Never log it directly. Use a `slog.Attr` that redacts:

```go
func RedactedRequest(req Request) slog.Attr {
    return slog.Group("request",
        slog.String("method", req.Method),
        slog.String("url", req.URL),
        slog.Int("body_size", len(req.Body)),
        // do not include req.Body
    )
}
```

### Log volume

Even at DEBUG, logging every attempt is too much for high-volume systems. Sample:

```go
if attempt > 0 && rand.Float64() < 0.01 {
    logger.Info("retry attempt", ...)
}
```

Or use a different log level for verbose retries.

---

## Postmortem Case Studies

Three anonymised case studies. Each illustrates a specific lesson.

### Case 1: The Idempotency Window Mismatch

**Setup:** A payments service used Stripe-style idempotency keys. The keys had a 1-hour TTL.

**Incident:** A network outage between the service and Stripe lasted 90 minutes. During the outage, requests retried (with the same key). Some retries arrived after Stripe processed the original but before the response got back. New retries arrived 70 minutes after the original — past the idempotency window. Stripe processed them as new charges.

**Result:** ~50 duplicate charges. Refunds issued. Customer trust damaged.

**Lesson:** Idempotency-key TTL must be longer than the worst-case retry duration plus any out-of-order processing window. After this incident, TTL increased to 24 hours.

### Case 2: The Cascading Retry Storm

**Setup:** Service A → B → C → D, each with 3 retries on transient errors. No deadline propagation, no budget.

**Incident:** D's database had a 30-second hiccup. Each tier amplified: A made 3× requests to B; B made 3× requests to C; C made 3× requests to D. Effective load: 27× normal. D crashed under retry load.

**Cascade:** D was down. C retried, exhausting its retry budget. B retried, exhausting its budget. A retried, exhausting its budget. Service was effectively down for 20 minutes after the initial 30-second hiccup.

**Lesson:** Retries multiply across tiers. After this incident:
- B and C disabled retries.
- A added deadline propagation.
- A added a retry budget.
- All services added circuit breakers.

### Case 3: The Silent Retry Eating The Budget

**Setup:** A monitoring service polled 10,000 endpoints every minute. Each poll had retry with 3 attempts, 100ms base, full jitter, 5s cap.

**Incident:** A network blip caused 30% of polls to fail. Retries kicked in. Each retry took ~500ms additional. The poller fell behind. New polls queued. The queue grew unbounded.

**Result:** The monitoring system stopped producing alerts. The team did not know systems were failing. Hours later, customer reports surfaced the issue.

**Lesson:** Retries can cause silent latency degradation that bypasses your alerts. After this incident:
- The monitoring system added a `polls_in_progress` metric.
- Alert when `polls_in_progress > threshold`.
- The retry budget was tightened.
- The poll latency p99 became an SLO with alerting.

---

## Operational Runbook

When retry-related alerts fire, what do you do?

### Alert: Retry rate spike

**Diagnose:**
1. Check the metric. Which client, which op?
2. Check dependency health: status page, dashboards.
3. Check error rates: are calls failing or just slow?

**Mitigate:**
- If dependency is degraded but recovering: monitor.
- If dependency is broken: consider failover to alternative.
- If self-inflicted (e.g. recent deploy broke a client): rollback.

**Resolve:**
- Document the cause in incident notes.
- Update dashboards to make this easier next time.

### Alert: Retry budget denied

**Diagnose:**
1. Confirm: is the dependency actually failing?
2. If yes: retry budget is doing its job. Continue.
3. If no: budget is too tight; legitimate retries are being denied.

**Mitigate:**
- If budget is too tight: increase it.
- If dependency is failing: kill switch to disable retries entirely, allowing the dependency to recover.

**Resolve:**
- Tune budget based on observed retry rate.

### Alert: Breaker open

**Diagnose:**
1. Confirm: which dependency? How long open?
2. Check dependency: is it actually down?

**Mitigate:**
- If dependency is down: monitor; breaker will half-open in `Timeout` seconds.
- If dependency is up but breaker is mis-configured: investigate ReadyToTrip logic.

**Resolve:**
- Adjust breaker thresholds if mis-configured.
- Document for postmortem.

### Alert: Tail latency spike

**Diagnose:**
1. Is the tail latency from retries or from base call latency?
2. Check `retry_attempt_at_success` histogram. Are more requests succeeding on attempt 2+?

**Mitigate:**
- If retries are dominant: tighten retry policy (fewer attempts, smaller cap).
- If base latency is the problem: retries are masking; address upstream.

### Kill switch

```go
type Switch struct {
    mu       sync.RWMutex
    disabled atomic.Bool
}

func (s *Switch) Disable() { s.disabled.Store(true) }
func (s *Switch) Enable()  { s.disabled.Store(false) }
func (s *Switch) IsOn() bool { return !s.disabled.Load() }
```

Wired into the retrier:

```go
if !retrySwitch.IsOn() {
    return op(ctx) // no retry; surface error immediately
}
```

The switch is set via runtime config (etcd, Consul, feature flags). Flip during incidents.

---

## Performance Tuning

For high-RPS systems, retry code can become a hot path. Tuning:

### Avoid allocations in the loop

Pre-allocate the timer:

```go
t := time.NewTimer(0)
defer t.Stop()
if !t.Stop() { <-t.C }
for attempt := 0; attempt < N; attempt++ {
    // ...
    t.Reset(delay)
    select {
    case <-t.C:
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Saves one `time.NewTimer` allocation per attempt.

### Avoid lock contention on jitter

If you have many concurrent retries on the same `*rand.Rand`, contention shows up. Solutions:

- Use `math/rand/v2` (Go 1.22+) — lock-free per-goroutine state.
- Use `sync.Pool` of `*rand.Rand`.

### Avoid `time.After` in loops

We have covered this. Always use `time.NewTimer` + `Stop`.

### Batch metrics

If you emit metrics on every attempt, the metric backend becomes the bottleneck. Use buffered counters (atomic increments) and flush periodically.

### Avoid `context.WithTimeout` per attempt if possible

```go
// expensive
for attempt := 0; attempt < N; attempt++ {
    ctx2, cancel := context.WithTimeout(ctx, perAttempt)
    err := op(ctx2)
    cancel()
}
```

If `perAttempt` does not need to vary per attempt, hoist the context out. Or use deadline propagation.

### Hot path measurement

Benchmark your retry helper:

```go
func BenchmarkRetryHappyPath(b *testing.B) {
    r := retry.New(retry.Policy{...})
    ctx := context.Background()
    op := func(_ context.Context) error { return nil }
    for i := 0; i < b.N; i++ {
        r.Do(ctx, op)
    }
}
```

Should be sub-microsecond per call on the happy path. If slower, investigate.

---

## End-To-End Example

The complete payments client from earlier, now with all the bells and whistles.

```go
package payments

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/cenkalti/backoff/v4"
	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/redis/go-redis/v9"
	"github.com/sony/gobreaker"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"golang.org/x/time/rate"
)

var (
	tracer = otel.Tracer("payments")
	
	chargeAttempts = promauto.NewCounterVec(
		prometheus.CounterOpts{Name: "payments_charge_attempts_total"},
		[]string{"outcome"},
	)
	chargeDuration = promauto.NewHistogram(
		prometheus.HistogramOpts{Name: "payments_charge_duration_seconds"},
	)
	chargeRetries = promauto.NewCounter(
		prometheus.CounterOpts{Name: "payments_charge_retries_total"},
	)
	budgetDenied = promauto.NewCounter(
		prometheus.CounterOpts{Name: "payments_budget_denied_total"},
	)
	breakerOpen = promauto.NewGauge(
		prometheus.GaugeOpts{Name: "payments_breaker_open"},
	)
)

type Service struct {
	HTTP          *http.Client
	Redis         *redis.Client
	BackoffNew    func() backoff.BackOff
	RetryBudget   *rate.Limiter
	Breaker       *gobreaker.CircuitBreaker
	Logger        *slog.Logger
	RetryDisabled func() bool
}

type ChargeRequest struct {
	Amount      int64  `json:"amount"`
	Currency    string `json:"currency"`
	CustomerID  string `json:"customer_id"`
}

type ChargeResponse struct {
	ID     string    `json:"id"`
	Status string    `json:"status"`
	Time   time.Time `json:"time"`
}

func NewService(rdb *redis.Client, logger *slog.Logger) *Service {
	breaker := gobreaker.NewCircuitBreaker(gobreaker.Settings{
		Name:        "stripe",
		MaxRequests: 5,
		Interval:    60 * time.Second,
		Timeout:     30 * time.Second,
		ReadyToTrip: func(c gobreaker.Counts) bool {
			return c.Requests >= 20 && float64(c.TotalFailures)/float64(c.Requests) > 0.5
		},
		OnStateChange: func(name string, from, to gobreaker.State) {
			logger.Warn("breaker state change", "name", name, "from", from.String(), "to", to.String())
			if to == gobreaker.StateOpen {
				breakerOpen.Set(1)
			} else {
				breakerOpen.Set(0)
			}
		},
	})
	
	return &Service{
		HTTP:        &http.Client{Timeout: 10 * time.Second},
		Redis:       rdb,
		BackoffNew:  defaultBackoff,
		RetryBudget: rate.NewLimiter(100, 200),
		Breaker:     breaker,
		Logger:      logger,
		RetryDisabled: func() bool { return false },
	}
}

func defaultBackoff() backoff.BackOff {
	b := backoff.NewExponentialBackOff()
	b.InitialInterval = 200 * time.Millisecond
	b.MaxInterval = 5 * time.Second
	b.MaxElapsedTime = 0 // we control via context
	b.RandomizationFactor = 0.5
	return b
}

func (s *Service) Charge(ctx context.Context, key string, req ChargeRequest) (*ChargeResponse, error) {
	ctx, span := tracer.Start(ctx, "payments.Charge",
		trace.WithAttributes(
			attribute.String("idempotency_key", key),
			attribute.Int64("amount", req.Amount),
		),
	)
	defer span.End()
	
	timer := prometheus.NewTimer(chargeDuration)
	defer timer.ObserveDuration()
	
	// 1. Check cached idempotent response.
	cached, err := s.Redis.Get(ctx, "idem:"+key).Bytes()
	if err == nil {
		var resp ChargeResponse
		if err := json.Unmarshal(cached, &resp); err == nil {
			chargeAttempts.WithLabelValues("cached").Inc()
			span.SetAttributes(attribute.Bool("cached", true))
			return &resp, nil
		}
	} else if !errors.Is(err, redis.Nil) {
		return nil, fmt.Errorf("redis get: %w", err)
	}
	
	// 2. Acquire processing lock.
	locked, err := s.Redis.SetNX(ctx, "idem:"+key+":lock", "1", 60*time.Second).Result()
	if err != nil {
		return nil, fmt.Errorf("redis lock: %w", err)
	}
	if !locked {
		chargeAttempts.WithLabelValues("conflict").Inc()
		return nil, errors.New("conflict: request in progress")
	}
	defer s.Redis.Del(ctx, "idem:"+key+":lock")
	
	// 3. Call Stripe with retry, breaker, budget.
	var result *ChargeResponse
	op := func() error {
		return s.callStripe(ctx, req, &result)
	}
	
	if s.RetryDisabled() {
		err = op()
	} else {
		err = s.retry(ctx, op)
	}
	
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		chargeAttempts.WithLabelValues("failure").Inc()
		return nil, err
	}
	
	// 4. Cache the response.
	respBytes, _ := json.Marshal(result)
	s.Redis.Set(ctx, "idem:"+key, respBytes, 24*time.Hour)
	
	chargeAttempts.WithLabelValues("success").Inc()
	span.SetAttributes(attribute.String("charge_id", result.ID))
	return result, nil
}

func (s *Service) retry(ctx context.Context, op func() error) error {
	attempt := 0
	return backoff.RetryNotify(
		func() error {
			attempt++
			if attempt > 1 {
				if !s.RetryBudget.Allow() {
					budgetDenied.Inc()
					return backoff.Permanent(errors.New("retry budget exhausted"))
				}
				chargeRetries.Inc()
			}
			_, err := s.Breaker.Execute(func() (interface{}, error) {
				return nil, op()
			})
			if errors.Is(err, gobreaker.ErrOpenState) {
				return backoff.Permanent(err)
			}
			return err
		},
		backoff.WithContext(s.BackoffNew(), ctx),
		func(err error, d time.Duration) {
			s.Logger.Debug("retrying charge",
				slog.String("err", err.Error()),
				slog.Duration("delay", d),
			)
		},
	)
}

func (s *Service) callStripe(ctx context.Context, req ChargeRequest, out **ChargeResponse) error {
	body, err := json.Marshal(req)
	if err != nil {
		return backoff.Permanent(err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, "POST", "https://api.stripe.com/v1/charges", bytes.NewReader(body))
	if err != nil {
		return backoff.Permanent(err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+stripeKey)
	
	resp, err := s.HTTP.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode == 429 {
		if d, ok := parseRetryAfter(resp); ok {
			s.Logger.Info("got 429 with Retry-After", slog.Duration("wait", d))
		}
		return fmt.Errorf("stripe 429")
	}
	if resp.StatusCode >= 500 && resp.StatusCode <= 599 {
		return fmt.Errorf("stripe %d", resp.StatusCode)
	}
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return backoff.Permanent(fmt.Errorf("stripe %d: %s", resp.StatusCode, body))
	}
	
	var cr ChargeResponse
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
		return err
	}
	*out = &cr
	return nil
}

func parseRetryAfter(resp *http.Response) (time.Duration, bool) {
	h := resp.Header.Get("Retry-After")
	if h == "" {
		return 0, false
	}
	if secs, err := strconv.Atoi(h); err == nil {
		return time.Duration(secs) * time.Second, true
	}
	if t, err := http.ParseTime(h); err == nil {
		return time.Until(t), true
	}
	return 0, false
}

var stripeKey = "sk_test_..."
```

This is a complete, production-style implementation:

- Idempotency keys + Redis lock.
- Retry via `cenkalti/backoff`.
- Circuit breaker via `sony/gobreaker`.
- Retry budget via `rate.Limiter`.
- Prometheus metrics.
- OpenTelemetry tracing.
- Structured logging via `slog`.
- Kill switch via `RetryDisabled`.

Ship this. Iterate based on observation.

---

## Best Practices

A consolidated list, for reference:

1. **Use a battle-tested library.** `cenkalti/backoff` or `hashicorp/go-retryablehttp` for HTTP; built-in for gRPC.
2. **Always integrate context.** Every retry path must respect cancellation and deadlines.
3. **Always use full jitter.** It is the default in AWS, gRPC, and most modern libraries.
4. **Always cap delay and attempts.** Unbounded retries are dangerous.
5. **Distinguish transient from permanent errors.** Wrong classification wastes budget.
6. **Use idempotency keys for non-idempotent operations.** Generate once, reuse on retry.
7. **Add a retry budget.** Token bucket via `rate.Limiter`.
8. **Add a circuit breaker.** `sony/gobreaker` is the canonical choice.
9. **Compose breaker + retry correctly.** Breaker outside retry, count one event per retry sequence.
10. **Propagate deadlines.** Both as headers and via context.
11. **Emit metrics.** Counter for attempts, histogram for attempt-at-success, gauge for breaker state.
12. **Emit traces.** Parent span for the retrier, child span per attempt.
13. **Log retries selectively.** Debug for attempts, warn for give-ups.
14. **Build a kill switch.** Runtime config to disable retries.
15. **Test failure modes.** Chaos test injecting failures.

---

## Edge Cases and Pitfalls

- **Body re-reading.** Forgetting to re-create the body on retry breaks POST/PUT.
- **Resp.Body unclosed.** Leaks file descriptors across retries.
- **`Retry-After` in non-2xx response.** Honour it, including in 5xx (some servers send it).
- **Context cancellation mid-sleep.** Always check `ctx.Err()` after `select`.
- **Breaker thrashing.** Half-open allows too few requests; opens immediately on first failure.
- **Idempotency key racing.** Two requests with same key arrive simultaneously.
- **gRPC streaming retry.** Built-in retry does not handle streams correctly.
- **Time skew.** Absolute deadlines fail with clock skew.
- **Pool exhaustion during retry.** Each retry holds a connection; budget exhausted.
- **DNS cache during failover.** Stale DNS means retries hit dead instances.
- **TLS handshake during retry.** Adds latency; pre-warm connections.

---

## Common Mistakes

1. Hard-coded retry parameters in business logic.
2. Different retry policies in different parts of the codebase.
3. No retry budget; only attempt cap.
4. Breaker thresholds set without measurement.
5. Idempotency keys generated per-attempt (wrong).
6. No deadline propagation between services.
7. Mocking time poorly; tests flaky.
8. No alerts on retry-rate spike.
9. No kill switch; can't disable retries during incidents.
10. Trusting library defaults blindly; not tuning for your workload.

---

## Tricky Questions

**Q1.** Why does `cenkalti/backoff` use `RandomizationFactor` instead of full jitter?
A: Their randomisation is symmetric around the exponential interval: `[interval*(1-r), interval*(1+r)]`. Closer to equal jitter. AWS recommends full jitter; cenkalti's default is closer to equal. Either is fine; just know which.

**Q2.** What happens if you call `backoff.Retry(op, nil)`?
A: Nil pointer dereference. Always pass a valid `BackOff`.

**Q3.** Why is `MaxElapsedTime` set to 0 for context-controlled retries?
A: We control termination via the context. `MaxElapsedTime` would be a second termination condition; setting to 0 disables it.

**Q4.** When the breaker is open, should the retrier wait?
A: No. `ErrOpenState` should be treated as permanent. The breaker will half-open after its timeout, but that is a separate event.

**Q5.** What is the cost of a `Prometheus` counter increment?
A: ~100 ns for a `Counter.Inc()` with no labels; ~300 ns with label lookup. For most retry use cases, negligible.

**Q6.** How does gRPC's retry throttling interact with our `rate.Limiter` budget?
A: gRPC's is per-channel. `rate.Limiter` is per-process or per-service. Both apply; the more restrictive wins.

**Q7.** What is the right TTL for idempotency keys?
A: 24 hours is common. Adjust based on worst-case retry duration plus out-of-order processing window.

**Q8.** Should the retry budget be per-replica or aggregate?
A: Aggregate. Per-replica budgets aggregate to too much. Compute per-replica = aggregate / replica_count.

---

## Cheat Sheet

```
Libraries:
  HTTP retry:    hashicorp/go-retryablehttp or cenkalti/backoff
  gRPC retry:    built-in via service config
  Circuit breaker: sony/gobreaker
  Rate limit/budget: golang.org/x/time/rate

Default policy:
  3-5 attempts, 100-200ms base, 5s max, full jitter, 30s total deadline
  budget: 10% of normal RPS
  breaker: 50% failure over 20 requests
  idempotency TTL: 24 hours

Metrics to emit:
  retry_attempts_total
  retry_attempt_at_success (histogram)
  retry_budget_denied_total
  breaker_state (gauge)

Operator tools:
  kill switch to disable retries
  runtime config for parameter tuning
  dashboards for retry rate / budget / breaker
  alerts on spikes
```

---

## Summary

Professional-level retry is about integration. The libraries (`cenkalti/backoff`, `gobreaker`, `rate.Limiter`, gRPC, OpenTelemetry, Prometheus) provide the building blocks. The architecture (edge-only retry, deadline propagation, idempotency, budget, breaker) is the foundation. Your job is to compose them correctly, instrument them, and operate them.

The end-to-end example shows it all in one place. Most companies have something like it for each critical dependency. Build yours, iterate, and let the metrics tell you when to tune.

---

## Further Reading

- `cenkalti/backoff` README and source.
- `hashicorp/go-retryablehttp` README.
- AWS SDK for Go v2 source code, specifically `aws/retry/`.
- gRPC retry documentation at grpc.io.
- `sony/gobreaker` README.
- OpenTelemetry Go documentation.
- Prometheus best practices guide.

---

## Related Topics

- **Circuit breaker patterns** (resilience).
- **Distributed tracing** (observability).
- **gRPC interceptors** (Go gRPC).
- **HTTP client design** (networking).
- **Token bucket rate limiting** (resilience).

This concludes the professional level. The specification, interview, tasks, find-bug, and optimize files are reference and practice.

---

## Appendix A: Reading cenkalti/backoff Source Line By Line

The library is small enough to read in one sitting. Let us walk through the key files.

### `exponential.go`

The core type:

```go
type ExponentialBackOff struct {
    InitialInterval     time.Duration
    RandomizationFactor float64
    Multiplier          float64
    MaxInterval         time.Duration
    MaxElapsedTime      time.Duration
    Stop                time.Duration
    Clock               Clock
    
    currentInterval time.Duration
    startTime       time.Time
    random          *rand.Rand
}
```

`Clock` is an interface for time-source abstraction (useful for tests). `random` is the source for randomisation.

The constructor:

```go
func NewExponentialBackOff(opts ...ExponentialBackOffOpts) *ExponentialBackOff {
    b := &ExponentialBackOff{
        InitialInterval:     DefaultInitialInterval,
        RandomizationFactor: DefaultRandomizationFactor,
        Multiplier:          DefaultMultiplier,
        MaxInterval:         DefaultMaxInterval,
        MaxElapsedTime:      DefaultMaxElapsedTime,
        Stop:                Stop,
        Clock:               SystemClock,
    }
    for _, opt := range opts {
        opt(b)
    }
    b.Reset()
    return b
}
```

Functional options for configuration. Calling `Reset()` initialises `currentInterval = InitialInterval`.

The key method:

```go
func (b *ExponentialBackOff) NextBackOff() time.Duration {
    if b.MaxElapsedTime != 0 && b.GetElapsedTime() >= b.MaxElapsedTime {
        return b.Stop
    }
    defer b.incrementCurrentInterval()
    return getRandomValueFromInterval(b.RandomizationFactor, rand.Float64(), b.currentInterval)
}

func (b *ExponentialBackOff) incrementCurrentInterval() {
    if float64(b.currentInterval) >= float64(b.MaxInterval)/b.Multiplier {
        b.currentInterval = b.MaxInterval
    } else {
        b.currentInterval = time.Duration(float64(b.currentInterval) * b.Multiplier)
    }
}

func getRandomValueFromInterval(randomizationFactor, random float64, currentInterval time.Duration) time.Duration {
    if randomizationFactor == 0 {
        return currentInterval
    }
    var delta = randomizationFactor * float64(currentInterval)
    var minInterval = float64(currentInterval) - delta
    var maxInterval = float64(currentInterval) + delta
    return time.Duration(minInterval + (random * (maxInterval - minInterval + 1)))
}
```

Reading this:

1. If `MaxElapsedTime` has been exceeded, return `Stop`.
2. Increment `currentInterval` for next time.
3. Apply jitter using `getRandomValueFromInterval`.

The jitter is *symmetric* around `currentInterval`. For `RandomizationFactor = 0.5`, the result is uniform on `[currentInterval * 0.5, currentInterval * 1.5]`. This is the equal-jitter-like behaviour mentioned earlier.

### `retry.go`

```go
func Retry(o Operation, b BackOff) error {
    return RetryNotify(o, b, nil)
}

func RetryNotify(operation Operation, b BackOff, notify Notify) error {
    return RetryNotifyWithTimer(operation, b, notify, nil)
}
```

The core loop is in `RetryNotifyWithTimer`. We saw its body earlier. The key points:

- The loop is infinite; termination is via `NextBackOff() == Stop` or context cancellation.
- `errors.As(err, &permanent)` checks if the operation marked the error as permanent.
- The `notify` callback fires on each retry.
- A `select` over the timer and context handles waiting.

### `context.go`

```go
type backOffContext struct {
    BackOff
    ctx context.Context
}

func (b *backOffContext) NextBackOff() time.Duration {
    select {
    case <-b.ctx.Done():
        return Stop
    default:
    }
    next := b.BackOff.NextBackOff()
    if deadline, ok := b.ctx.Deadline(); ok && deadline.Sub(time.Now()) < next {
        return Stop
    }
    return next
}
```

Notice the deadline check: if the remaining time is less than `next`, return `Stop`. The loop terminates rather than waiting.

This is exactly the "do not retry if there is no time left" pattern from the senior file.

### `tries.go`

```go
type backOffTries struct {
    delegate    BackOff
    maxTries    uint64
    numTries    uint64
}

func (b *backOffTries) NextBackOff() time.Duration {
    if b.numTries >= b.maxTries {
        return Stop
    }
    b.numTries++
    return b.delegate.NextBackOff()
}
```

The wrapper for "max retries". Counts attempts and signals `Stop` when limit reached.

### Takeaways

After reading the source:

- The library is well-factored. Each concern (exponential schedule, context-awareness, max retries, notify) is its own type.
- The composition via wrappers is clean.
- Edge cases (overflow, context cancellation, max-elapsed) are handled.

Reading this source is a good exercise. It is small enough to read in 30 minutes and teaches good Go.

---

## Appendix B: A Production HTTP Client Wrapping cenkalti/backoff

A full implementation:

```go
package httpclient

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/cenkalti/backoff/v4"
)

type Client struct {
	HTTP       *http.Client
	NewBackoff func() backoff.BackOff
}

func New(timeout time.Duration) *Client {
	return &Client{
		HTTP: &http.Client{Timeout: timeout},
		NewBackoff: func() backoff.BackOff {
			b := backoff.NewExponentialBackOff()
			b.InitialInterval = 100 * time.Millisecond
			b.MaxInterval = 5 * time.Second
			b.MaxElapsedTime = 30 * time.Second
			b.RandomizationFactor = 0.5
			return backoff.WithMaxRetries(b, 5)
		},
	}
}

func (c *Client) Do(ctx context.Context, req *http.Request) (*http.Response, []byte, error) {
	var body []byte
	if req.Body != nil {
		var err error
		body, err = io.ReadAll(req.Body)
		if err != nil {
			return nil, nil, err
		}
		req.Body.Close()
	}
	
	var (
		respBody []byte
		respHdrs http.Header
		respCode int
	)
	
	b := backoff.WithContext(c.NewBackoff(), ctx)
	err := backoff.RetryNotify(func() error {
		var bodyReader io.Reader
		if body != nil {
			bodyReader = bytes.NewReader(body)
		}
		r, err := http.NewRequestWithContext(ctx, req.Method, req.URL.String(), bodyReader)
		if err != nil {
			return backoff.Permanent(err)
		}
		r.Header = req.Header.Clone()
		
		resp, err := c.HTTP.Do(r)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusServiceUnavailable {
			if d, ok := parseRetryAfter(resp.Header.Get("Retry-After")); ok {
				time.Sleep(d) // backoff library handles its own sleep too; this is an extra wait per-server signal
			}
			return fmt.Errorf("status %d", resp.StatusCode)
		}
		if resp.StatusCode >= 500 && resp.StatusCode <= 599 {
			return fmt.Errorf("status %d", resp.StatusCode)
		}
		if resp.StatusCode >= 400 {
			b, _ := io.ReadAll(resp.Body)
			return backoff.Permanent(fmt.Errorf("status %d: %s", resp.StatusCode, b))
		}
		b, err := io.ReadAll(resp.Body)
		if err != nil {
			return err
		}
		respBody = b
		respHdrs = resp.Header
		respCode = resp.StatusCode
		return nil
	}, b, func(err error, d time.Duration) {
		// log retry; emit metric
	})
	
	if err != nil {
		return nil, nil, err
	}
	return &http.Response{Header: respHdrs, StatusCode: respCode}, respBody, nil
}

func parseRetryAfter(h string) (time.Duration, bool) {
	if h == "" {
		return 0, false
	}
	if s, err := strconv.Atoi(h); err == nil {
		return time.Duration(s) * time.Second, true
	}
	if t, err := http.ParseTime(h); err == nil {
		return time.Until(t), true
	}
	return 0, false
}
```

A few notes:

- `New(timeout)` sets the per-attempt HTTP client timeout.
- The retry is unbounded in terms of attempts (relies on `MaxElapsedTime` and `MaxRetries`).
- Body is read once, replayed.
- Notice the `time.Sleep` for `Retry-After`: in addition to the library's backoff. This is debatable; you might prefer to use only the larger of the two.

This is the kind of helper a team builds once and reuses everywhere.

---

## Appendix C: gRPC Production Setup Walkthrough

A complete gRPC client setup with retry, breaker, deadline, observability.

### Service config

```json
{
  "loadBalancingPolicy": "round_robin",
  "retryThrottling": {
    "maxTokens": 10,
    "tokenRatio": 0.1
  },
  "methodConfig": [
    {
      "name": [{"service": "payments.PaymentService"}],
      "timeout": "10s",
      "retryPolicy": {
        "maxAttempts": 4,
        "initialBackoff": "0.1s",
        "maxBackoff": "5s",
        "backoffMultiplier": 2,
        "retryableStatusCodes": ["UNAVAILABLE"]
      }
    }
  ]
}
```

### Go setup

```go
package paymentsclient

import (
	"context"
	"crypto/tls"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
)

const serviceConfig = `{
  "loadBalancingPolicy": "round_robin",
  "retryThrottling": {
    "maxTokens": 10,
    "tokenRatio": 0.1
  },
  "methodConfig": [
    {
      "name": [{"service": "payments.PaymentService"}],
      "timeout": "10s",
      "retryPolicy": {
        "maxAttempts": 4,
        "initialBackoff": "0.1s",
        "maxBackoff": "5s",
        "backoffMultiplier": 2,
        "retryableStatusCodes": ["UNAVAILABLE"]
      }
    }
  ]
}`

func New(target string) (*grpc.ClientConn, error) {
	tlsConfig := &tls.Config{} // configure properly
	creds := credentials.NewTLS(tlsConfig)
	
	return grpc.NewClient(target,
		grpc.WithTransportCredentials(creds),
		grpc.WithDefaultServiceConfig(serviceConfig),
		grpc.WithChainUnaryInterceptor(
			otelgrpc.UnaryClientInterceptor(),
			MetricsUnaryInterceptor(),
		),
		grpc.WithChainStreamInterceptor(
			otelgrpc.StreamClientInterceptor(),
		),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(10*1024*1024),
		),
	)
}
```

Notes:

- `grpc.WithDefaultServiceConfig` provides retry, throttling, load-balancing.
- `otelgrpc.UnaryClientInterceptor` adds tracing.
- A custom `MetricsUnaryInterceptor` would add Prometheus metrics.
- TLS is required for production; configure properly.
- `MaxCallRecvMsgSize` defaults to 4 MB; raise if needed.

### Metrics interceptor

```go
func MetricsUnaryInterceptor() grpc.UnaryClientInterceptor {
    return func(ctx context.Context, method string, req, reply interface{}, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
        start := time.Now()
        err := invoker(ctx, method, req, reply, cc, opts...)
        latency := time.Since(start).Seconds()
        
        statusCode := status.Code(err).String()
        rpcRequests.WithLabelValues(method, statusCode).Inc()
        rpcDuration.WithLabelValues(method, statusCode).Observe(latency)
        return err
    }
}
```

Now you have per-method, per-status request count and latency histogram. Combined with gRPC's built-in retry counting (via metrics), you can see retry behaviour.

### Server-side

The server also needs configuration:

```go
import "google.golang.org/grpc/keepalive"

server := grpc.NewServer(
    grpc.MaxConcurrentStreams(1000),
    grpc.KeepaliveParams(keepalive.ServerParameters{
        MaxConnectionIdle: 15 * time.Minute,
    }),
    grpc.ChainUnaryInterceptor(
        otelgrpc.UnaryServerInterceptor(),
        DeadlineCheckInterceptor(),
        MetricsInterceptor(),
    ),
)
```

The `DeadlineCheckInterceptor` is custom: it reads the deadline from the incoming context and short-circuits requests that have less than X ms remaining (because the response would not arrive in time anyway).

---

## Appendix D: Real-World Tuning Stories

Stories about how teams have tuned retry policy. Anonymised but realistic.

### Story 1: "We made things worse"

A team had a payments service with `maxAttempts = 5`, `base = 500ms`. During a dependency incident, retries amplified load. They reduced to `maxAttempts = 3`, `base = 200ms`, and added a budget at 5% of normal traffic.

Result: incident recovery time dropped from 30 minutes to 5 minutes. Dependency saw less load during the recovery window.

Lesson: fewer attempts can be better.

### Story 2: "Idempotency saved us"

A team rolled out idempotency keys for a critical write API. Initially they used 1-hour TTL. During a 6-hour partial outage, some retries arrived after their key had expired; duplicate writes occurred.

Result: 24-hour TTL fixed the immediate issue. Postmortem revealed they should also have implemented downstream idempotency (the database layer) for defense in depth.

Lesson: idempotency TTL must exceed worst-case retry latency.

### Story 3: "The breaker that never closed"

A team set a circuit breaker with `MaxRequests = 1` in half-open and a tight `ReadyToTrip`. After an outage, the breaker re-opened on every half-open probe because the first request happened to be slow (not failed, just slow).

Result: the breaker stayed open long after the dependency recovered. They raised `MaxRequests` to 5 and tuned `ReadyToTrip` to consider only actual failures, not slow responses.

Lesson: breaker tuning requires real-data testing.

### Story 4: "We forgot deadline propagation"

A microservices fleet had retries everywhere with no deadline propagation. A single transient blip caused a 10-minute incident. They added deadline propagation; subsequent blips healed in seconds.

Lesson: deadlines are protective.

### Story 5: "The retry was masking a bug"

A team had aggressive retries on a critical path. Most requests succeeded on attempt 2 or 3. A new engineer asked "why are we retrying so much?" and found that the dependency had a latency p99 just above the per-call timeout. Raising the per-call timeout (matching p99) eliminated 90% of retries.

Lesson: investigate frequent retries before "fixing" with more retries.

---

## Appendix E: Real Performance Numbers

For a sense of scale, here are typical numbers from production systems.

### Retry rate

- Healthy: 0.1-1% of total requests retry.
- Mildly degraded: 1-5%.
- Incident: 5%+.

If your normal retry rate is above 5%, you have a flaky dependency.

### Latency overhead

- Median: ~0 (most requests do not retry).
- p95: ~base.
- p99: ~base + retry sleep.

If p99 latency is dominated by retries, your retry budget is too generous.

### Capacity overhead

- Normal: 1-5% extra calls due to retries.
- Incident: 4-10× during the failure window.

Provision for the incident case, not the normal case.

### Cost overhead

- Paid APIs: directly proportional to retry rate.
- Internal: indirectly, through capacity.

If a paid API has high retry rate, your bill is being multiplied.

### Code size

- `cenkalti/backoff`: ~600 lines.
- A custom retrier with breaker + metrics: ~1000 lines.
- A full resilience-stack package: ~3000 lines.

For most teams, use the library. Only write custom for specific needs.

### Compile time impact

- `cenkalti/backoff`: negligible.
- `prometheus/client_golang`: noticeable, especially with many metrics.
- `go.opentelemetry.io`: noticeable.

These are libraries you bring in once and reuse. The compile-time cost is a one-time expense.

---

## Appendix F: A Catalogue Of Retry Libraries

Brief tour beyond the big two.

### `cenkalti/backoff`

- Most popular.
- Stable API.
- Symmetric jitter (not full).
- Good for general retry.

### `hashicorp/go-retryablehttp`

- HTTP-specific.
- Wraps `*http.Client`.
- Drop-in replacement.

### `avast/retry-go`

- More configurable than cenkalti.
- Supports `RetryIf`, `OnRetry`, etc.
- Less popular but well-maintained.

### `eapache/go-resiliency`

- Bundles retry + breaker + bulkhead + retry-with-jitter.
- A "resilience kit".
- Older but reliable.

### `briandowns/retry`

- Simple, generic.
- Good for one-off use.

### `lestrrat-go/backoff`

- Custom strategies (Constant, Exponential).
- Less popular.

For most projects: `cenkalti/backoff`. For HTTP: `hashicorp/go-retryablehttp`. For specific needs: explore others.

---

## Appendix G: A Catalogue Of Circuit Breaker Libraries

### `sony/gobreaker`

- Most popular.
- Three states, configurable.
- Well-tested.

### `mercari/go-circuitbreaker`

- More features than sony's.
- Less popular but well-engineered.

### `eapache/go-resiliency/breaker`

- Bundled with retry, bulkhead, etc.
- Simple API.

For most projects: `sony/gobreaker`.

---

## Appendix H: A Catalogue Of Rate Limiter Libraries

### `golang.org/x/time/rate`

- Token bucket.
- Official library.
- Use for retry budgets, outbound throttling.

### `uber-go/ratelimit`

- Leaky bucket.
- Smoother throttling.
- Less popular but solid.

### `juju/ratelimit`

- Earlier library; sometimes seen.

For most projects: `golang.org/x/time/rate`.

---

## Appendix I: Operational Maturity Levels

Rate your team's retry operational maturity:

### Level 1: Basic

- Retries are implemented (somehow).
- No metrics.
- No alerts.
- No coordination between services.

If you are here: get to Level 2.

### Level 2: Instrumented

- Retries use a library.
- Metrics emitted: retry count, success rate.
- Basic dashboards.
- Alerts on spike.

If you are here: get to Level 3.

### Level 3: Operated

- Retries are documented.
- Runbooks exist.
- Kill switches exist.
- Postmortems include retry analysis.

If you are here: get to Level 4.

### Level 4: Engineered

- Retry policy is reviewed in design.
- Per-dependency tuning based on data.
- Adaptive throttling considered.
- Chaos tests confirm policy works.

If you are here: get to Level 5.

### Level 5: Mature

- Retry is a first-class architectural concern.
- Policy is centralised and configurable at runtime.
- Cross-tier propagation is verified.
- Idempotency is mandatory for non-idempotent ops.
- Hedging is selectively used.

Most companies are at Level 2 or 3. Getting to Level 4 takes deliberate work but pays off enormously.

---

## Appendix J: A Long Walk Through OpenTelemetry Integration

OpenTelemetry tracing makes retries visible. A walkthrough.

### Setup

```go
import (
    "context"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/sdk/trace"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
)

func InitTracer(ctx context.Context, endpoint string) (*trace.TracerProvider, error) {
    exp, err := otlptracegrpc.New(ctx,
        otlptracegrpc.WithEndpoint(endpoint),
        otlptracegrpc.WithInsecure(),
    )
    if err != nil {
        return nil, err
    }
    tp := trace.NewTracerProvider(
        trace.WithBatcher(exp),
        trace.WithSampler(trace.ParentBased(trace.TraceIDRatioBased(0.01))),
    )
    otel.SetTracerProvider(tp)
    return tp, nil
}
```

`TraceIDRatioBased(0.01)` samples 1% of traces. `ParentBased` respects the parent span's sampling decision.

### Per-attempt spans

```go
import "go.opentelemetry.io/otel/attribute"

tracer := otel.Tracer("retry")

func (r *Retrier) Do(ctx context.Context, op func(context.Context) error) error {
    ctx, parent := tracer.Start(ctx, "retry.Do",
        trace.WithAttributes(
            attribute.String("retrier.name", r.Name),
            attribute.Int("retrier.max_attempts", r.MaxAttempts),
        ),
    )
    defer parent.End()
    
    for attempt := 0; attempt < r.MaxAttempts; attempt++ {
        attemptCtx, span := tracer.Start(ctx, fmt.Sprintf("attempt.%d", attempt+1))
        err := op(attemptCtx)
        if err != nil {
            span.RecordError(err)
            span.SetStatus(codes.Error, err.Error())
        }
        span.End()
        if err == nil {
            parent.SetAttributes(attribute.Int("retrier.success_attempt", attempt+1))
            return nil
        }
        // ... retry logic ...
    }
    parent.SetStatus(codes.Error, "retries exhausted")
    return err
}
```

### What the trace looks like

In Jaeger/Tempo:

```
retry.Do (4.7s)
├── attempt.1 (1.2s) [error: status 503]
├── attempt.2 (1.5s) [error: status 503]
└── attempt.3 (2.0s) [ok]
```

Each attempt's own work (HTTP call, etc.) appears under it.

### Propagation

OTel automatically propagates trace context across gRPC and HTTP if you use the instrumentation libraries (`otelgrpc`, `otelhttp`). The downstream service's spans appear in the same trace.

### Costs

Each span is ~1 KB in storage. At 1% sampling and 10 attempts per request, you store ~100 bytes per request on average. Negligible for most systems.

---

## Appendix K: A Long Walk Through Prometheus Integration

Prometheus metrics for retry observability.

### Setup

```go
import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
    "github.com/prometheus/client_golang/prometheus/promhttp"
    "net/http"
)

func init() {
    http.Handle("/metrics", promhttp.Handler())
}
```

### Counter metrics

```go
var (
    retryAttempts = promauto.NewCounterVec(
        prometheus.CounterOpts{
            Name: "retry_attempts_total",
            Help: "Total number of retry attempts.",
        },
        []string{"client", "op", "outcome"},
    )
)
```

In the retry code:

```go
retryAttempts.WithLabelValues(c.Name, op, "failure").Inc()
```

### Histogram metrics

```go
attemptAtSuccess := promauto.NewHistogramVec(
    prometheus.HistogramOpts{
        Name:    "retry_attempt_at_success",
        Help:    "Attempt number at which request succeeded.",
        Buckets: []float64{1, 2, 3, 5, 10},
    },
    []string{"client", "op"},
)
```

### Gauge metrics

```go
breakerState := promauto.NewGaugeVec(
    prometheus.GaugeOpts{
        Name: "circuit_breaker_state",
        Help: "Circuit breaker state (0=closed, 1=half-open, 2=open).",
    },
    []string{"name"},
)

// In breaker callback:
cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
    OnStateChange: func(name string, from, to gobreaker.State) {
        breakerState.WithLabelValues(name).Set(float64(to))
    },
})
```

### Cardinality

Be careful with labels. Common pitfalls:

- `op` label with URL-with-IDs: cardinality explodes.
- `error` label with full error message: cardinality explodes.

Keep labels bounded: client names, op names, status codes.

### Useful queries

```promql
# Retry rate
sum(rate(retry_attempts_total{outcome="failure"}[5m])) by (client)

# Retry ratio
sum(rate(retry_attempts_total[5m])) / sum(rate(retry_attempts_total{outcome="success"}[5m]))

# p99 attempts to succeed
histogram_quantile(0.99, sum(rate(retry_attempt_at_success_bucket[5m])) by (le))

# Breaker open duration
(circuit_breaker_state == 2) * (time() - circuit_breaker_state_change_timestamp)
```

### Alerts

```yaml
groups:
- name: retry
  rules:
  - alert: HighRetryRate
    expr: sum(rate(retry_attempts_total{outcome="failure"}[5m])) by (client) > 100
    for: 5m
    annotations:
      summary: "Client {{ $labels.client }} retry rate is high"
      
  - alert: BreakerOpen
    expr: circuit_breaker_state == 2
    for: 1m
    annotations:
      summary: "Circuit breaker {{ $labels.name }} is open"
```

---

## Appendix L: A Long Walk Through slog Integration

`log/slog` (Go 1.21+) provides structured logging.

### Setup

```go
import (
    "log/slog"
    "os"
)

logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
    Level: slog.LevelInfo,
}))
slog.SetDefault(logger)
```

### Per-retry logging

```go
slog.Debug("retrying",
    "client", c.Name,
    "op", opName,
    "attempt", attempt,
    "err", err.Error(),
    "delay", delay,
)
```

JSON output:

```json
{
  "time": "2026-05-14T10:23:45Z",
  "level": "DEBUG",
  "msg": "retrying",
  "client": "stripe",
  "op": "charge",
  "attempt": 2,
  "err": "status 503",
  "delay": "200ms"
}
```

### Including trace context

```go
import "go.opentelemetry.io/otel/trace"

func logWithTrace(ctx context.Context) *slog.Logger {
    span := trace.SpanFromContext(ctx)
    return slog.With(
        "trace_id", span.SpanContext().TraceID().String(),
        "span_id", span.SpanContext().SpanID().String(),
    )
}

// Usage:
logWithTrace(ctx).Info("retrying", ...)
```

Now your logs can be correlated with traces.

### Sampling

For high-volume retries, you may not want every retry logged. Sample:

```go
if rand.Float64() < 0.01 {
    logger.Info("retry sample", ...)
}
```

Or use OpenTelemetry's log sampling, which is more sophisticated.

### Don't log secrets

```go
// WRONG
logger.Info("calling stripe", "request", req)

// RIGHT
logger.Info("calling stripe", "request_id", req.ID, "amount", req.Amount)
```

The `req` may contain auth tokens or personal data.

---

## Appendix M: A Comprehensive Postmortem Example

A detailed postmortem from a hypothetical retry-related incident.

### Title

"Payments API degraded for 47 minutes due to Stripe retry storm"

### Date

2026-04-15

### Impact

- 47-minute window of degraded payment processing.
- 2,300 customer payments delayed.
- ~50 duplicate charges (later refunded).
- 12 customer support tickets.

### Timeline

- 14:32 UTC: Stripe API begins returning intermittent 503s.
- 14:33 UTC: Our payments API retry rate spike alert fires.
- 14:34 UTC: SRE on-call acknowledges. Begins investigation.
- 14:38 UTC: Identified: Stripe is reporting partial outage on their status page.
- 14:42 UTC: Retry rate now at 25% of normal traffic. Customers seeing slow responses.
- 14:45 UTC: Retry budget exhausted alert fires. Customers seeing failures.
- 14:50 UTC: Decided to disable retries via kill switch.
- 14:51 UTC: Kill switch flipped. Customer error rate normalises to Stripe's failure rate.
- 15:15 UTC: Stripe reports issue resolved.
- 15:16 UTC: Retry rate drops to baseline.
- 15:19 UTC: Kill switch flipped back to enable retries.

### Root cause

Two contributing factors:

1. **Stripe outage:** Their underlying database had a brief failover; partial 503 responses for ~45 minutes.
2. **Our retry policy:** Configured with `MaxElapsedTime = 60s` and no budget. During the outage, retries piled up. With ~10,000 active payment flows, retry traffic compounded.

### What went well

- Alerts fired promptly.
- Kill switch existed and was used.
- Idempotency keys prevented all but ~50 duplicate charges.

### What went poorly

- No retry budget meant we generated too much retry traffic to Stripe.
- The kill switch took 16 minutes from alert to flip; should be faster.
- The 24-hour idempotency TTL was insufficient for 50 retries that came back after the original processing window.

### Action items

1. Add retry budget at 10% of normal traffic.
2. Document the kill switch in the on-call runbook so it can be flipped in <5 minutes.
3. Increase idempotency TTL to 72 hours.
4. Add chaos test that simulates 30-minute Stripe outage and verifies our system stays bounded.
5. Tune retry max-elapsed to 15s for user-facing paths.

### Lessons learned

- Retry budgets are essential when calling external dependencies.
- A kill switch alone is not enough; the speed of use matters.
- Idempotency TTL must consider out-of-order retries.

This is what a real postmortem looks like. The action items become tracked tickets and prevent recurrence.

---

## Appendix N: How To Read Open-Source Retry Code In Production Systems

When joining a team or reviewing a codebase, learning the retry strategy quickly is valuable. Steps:

### Step 1: Find the entry points

```
grep -r "backoff" --include="*.go"
grep -r "retryable" --include="*.go"
grep -r "Retry" --include="*.go"
```

Look for `backoff.Retry`, `retry.Do`, custom retry helpers.

### Step 2: Find the policies

```
grep -r "MaxAttempts" --include="*.go"
grep -r "InitialInterval" --include="*.go"
```

Note: defaults, configurable values, where they are sourced from (config file, env, hardcoded).

### Step 3: Find error classification

Look for predicates: `isRetryable`, `isTransient`, `MarkPermanent`, `Permanent`. How does the team distinguish?

### Step 4: Find the context handling

Search for `ctx.Done`, `context.WithTimeout`. Are deadlines propagated? Is context cancellation respected?

### Step 5: Find the metrics

Search for retry-related metrics. Do they emit retry count, attempt distribution, budget denials?

### Step 6: Find the breakers

Search for `gobreaker`, `circuit`, `breaker`. Are they per-dependency? How are thresholds tuned?

### Step 7: Find the tests

Look in `_test.go` files. Are retries tested for the cases that matter (success, exhaustion, deadline, cancellation)?

### Step 8: Find the docs

Look for `RUNBOOK.md`, `RETRIES.md`, or similar. Does the team document the policy and the kill-switch procedure?

If you find clear answers to 6+ of these, the codebase is mature. If most answers are "no" or "unclear", improvement is needed.

---

## Appendix O: How To Onboard A Team To These Patterns

If you join a team where retry hygiene is weak, here is a 3-month plan.

### Month 1: Visibility

- Add Prometheus metrics on retry count, success rate, budget denial.
- Build a dashboard.
- Set up basic alerts.

You cannot improve what you cannot measure. Visibility is step one.

### Month 2: Standardisation

- Introduce a shared retry library (cenkalti or custom).
- Replace ad-hoc retry loops with the library.
- Document the standard policy.

This removes scatter and makes future tuning easier.

### Month 3: Tuning

- Use the dashboard to identify retry hotspots.
- Tune individual policies.
- Add circuit breakers where missing.
- Add idempotency keys where needed.

By month 3, the team has a sound foundation.

### Long-term

- Quarterly review of retry policies.
- Chaos tests for major dependencies.
- Documentation of kill-switch procedures.

This is the path from "retries everywhere, no oversight" to "retries managed and tuned".

---

## Appendix P: Beyond Basic Patterns — Future Directions

### Reinforcement-learning-tuned retry

Some research has explored ML-tuned retry policies. The system observes its own success rate and adjusts parameters automatically. Promising but rare in production.

### eBPF-level retry observability

eBPF lets you observe network-level retries (TCP, TLS) without code changes. Tools like Pixie, Cilium Hubble use this.

### Service-mesh-level retries

As service meshes mature, retries move to the data plane (sidecar). Application code becomes simpler.

### gRPC's hedging support

Becoming more widely used. Combined with retry, gives both latency and reliability benefits.

### Adaptive retry budgets

Self-tuning budgets based on observed traffic. Reduces operational toil.

These are the cutting edge. Most companies are still doing the basics (cenkalti+breaker+budget+metrics). Master the basics before exploring the cutting edge.

---

## Appendix Q: A Long Conclusion

We started in the junior file with a `for` loop and `time.Sleep`. We ended in this file with a multi-library composition that integrates with tracing, metrics, logs, and runtime configuration. The journey is the typical career path for an engineer specialising in reliability.

The most important lessons:

1. **Retry is not free.** Every retry costs latency, capacity, and sometimes money.
2. **Retry alone is not enough.** Pair with breaker, budget, idempotency, deadline propagation.
3. **Measure everything.** Without metrics, you fly blind during incidents.
4. **Tune from data.** Default policies are starting points, not endings.
5. **Document and runbook.** During an incident, you need to act fast.
6. **Operate the kill switch.** Sometimes the right answer is to disable retries.

If you internalise these, you can build resilient systems in Go that survive real-world failures.

The remaining files in this section (`specification.md`, `interview.md`, `tasks.md`, `find-bug.md`, `optimize.md`) are reference and practice. Use them to solidify what you have learned.

Good luck.

---

## Appendix R: Worked Examples By Domain

Different domains have different retry needs. Worked examples for each.

### Domain 1: Payments

Already covered. Key features: idempotency, low retry count, generous breaker.

### Domain 2: Search

A search request is read-only and usually idempotent. Latency-sensitive.

```go
type SearchClient struct {
    HTTP       *http.Client
    BackoffNew func() backoff.BackOff
    Hedge      time.Duration
}

func (c *SearchClient) Search(ctx context.Context, query string) ([]Result, error) {
    type res struct {
        results []Result
        err     error
    }
    out := make(chan res, 2)
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()
    
    go c.search(ctx, query, out)
    timer := time.NewTimer(c.Hedge)
    defer timer.Stop()
    
    select {
    case r := <-out:
        if r.err == nil {
            return r.results, nil
        }
    case <-timer.C:
        go c.search(ctx, query, out)
    case <-ctx.Done():
        return nil, ctx.Err()
    }
    
    for i := 0; i < 2; i++ {
        select {
        case r := <-out:
            if r.err == nil {
                return r.results, nil
            }
        case <-ctx.Done():
            return nil, ctx.Err()
        }
    }
    return nil, errors.New("search failed")
}

func (c *SearchClient) search(ctx context.Context, query string, out chan<- res) {
    // backoff-retry HTTP call
    var results []Result
    err := backoff.Retry(func() error {
        // HTTP request
        // ...
        return nil
    }, backoff.WithContext(c.BackoffNew(), ctx))
    select {
    case out <- res{results, err}:
    case <-ctx.Done():
    }
}
```

This is hedged search: send a search request; if it does not return in `Hedge` time, send another to a different replica.

### Domain 3: Webhook delivery

You are the *server* sending webhooks to customer endpoints. Retries here can span hours.

```go
type WebhookDelivery struct {
    Queue *redis.Client
}

func (w *WebhookDelivery) Send(ctx context.Context, payload Payload) {
    schedule := []time.Duration{
        0,
        30 * time.Second,
        1 * time.Minute,
        5 * time.Minute,
        30 * time.Minute,
        1 * time.Hour,
        6 * time.Hour,
        24 * time.Hour,
    }
    for _, delay := range schedule {
        time.Sleep(delay)
        if err := w.attempt(ctx, payload); err == nil {
            return
        }
    }
    w.deadLetter(payload)
}
```

This is *very* long backoff — over a day total. Appropriate for webhook delivery where users expect "we will keep trying" semantics.

### Domain 4: Background job retries

Jobs from a queue (SQS, Pub/Sub) with their own retry semantics.

```go
type JobProcessor struct {
    Queue *sqs.Client
}

func (jp *JobProcessor) Process(ctx context.Context, msg *sqs.Message) error {
    err := jp.handle(ctx, msg)
    if err == nil {
        return jp.Queue.DeleteMessage(ctx, msg)
    }
    // SQS will retry based on visibility timeout
    // For permanent failures, send to DLQ
    if isPermanent(err) {
        return jp.sendToDLQ(ctx, msg, err)
    }
    return err
}
```

Notice: the *queue* retries via visibility timeout. The *processor* does not retry inline. This is the right pattern for background jobs.

### Domain 5: Database reconnect

```go
type DBConnector struct {
    DSN string
    DB  *sql.DB
}

func (c *DBConnector) Connect(ctx context.Context) error {
    return backoff.Retry(func() error {
        db, err := sql.Open("postgres", c.DSN)
        if err != nil {
            return err
        }
        if err := db.PingContext(ctx); err != nil {
            return err
        }
        c.DB = db
        return nil
    }, backoff.WithContext(backoff.NewExponentialBackOff(), ctx))
}
```

Simple retry around connect+ping. The database is often slow to come up.

### Domain 6: gRPC service discovery

```go
type DiscoveryClient struct {
    Resolver *grpcresolver.Resolver
}

func (d *DiscoveryClient) Resolve(target string) ([]string, error) {
    var addrs []string
    err := backoff.Retry(func() error {
        result, err := d.Resolver.Resolve(target)
        if err != nil {
            return err
        }
        addrs = result.Addresses
        return nil
    }, backoff.NewExponentialBackOff())
    return addrs, err
}
```

Service discovery is occasionally flaky (DNS lookup failures). Retry helps.

---

## Appendix S: A Complete CRUD Service With Retries

Let us build a complete service that uses retries throughout.

```go
// Package usersservice provides a CRUD service for users.
package usersservice

import (
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "net/http"
    "time"

    "github.com/cenkalti/backoff/v4"
    "github.com/redis/go-redis/v9"
    "github.com/sony/gobreaker"
)

type User struct {
    ID    string `json:"id"`
    Email string `json:"email"`
    Name  string `json:"name"`
}

type Service struct {
    DB      *Database
    Redis   *redis.Client
    Breaker *gobreaker.CircuitBreaker
}

func NewService(db *Database, rdb *redis.Client) *Service {
    return &Service{
        DB:    db,
        Redis: rdb,
        Breaker: gobreaker.NewCircuitBreaker(gobreaker.Settings{
            Name: "users-db",
        }),
    }
}

// Get fetches a user by ID. Uses cache + retry.
func (s *Service) Get(ctx context.Context, id string) (*User, error) {
    cached, err := s.Redis.Get(ctx, "user:"+id).Bytes()
    if err == nil {
        var u User
        if err := json.Unmarshal(cached, &u); err == nil {
            return &u, nil
        }
    }
    
    var user *User
    err = backoff.Retry(func() error {
        result, err := s.Breaker.Execute(func() (interface{}, error) {
            return s.DB.GetUser(ctx, id)
        })
        if err != nil {
            return err
        }
        user = result.(*User)
        return nil
    }, retryPolicy(ctx))
    
    if err == nil {
        if data, err := json.Marshal(user); err == nil {
            s.Redis.Set(ctx, "user:"+id, data, 5*time.Minute)
        }
    }
    return user, err
}

// Create creates a user. Uses idempotency key.
func (s *Service) Create(ctx context.Context, key string, u *User) error {
    cached, err := s.Redis.Get(ctx, "idem:"+key).Bytes()
    if err == nil {
        return json.Unmarshal(cached, u)
    } else if !errors.Is(err, redis.Nil) {
        return err
    }
    
    locked, err := s.Redis.SetNX(ctx, "idem:"+key+":lock", "1", 60*time.Second).Result()
    if err != nil {
        return err
    }
    if !locked {
        return errors.New("conflict: request in progress")
    }
    defer s.Redis.Del(ctx, "idem:"+key+":lock")
    
    err = backoff.Retry(func() error {
        _, err := s.Breaker.Execute(func() (interface{}, error) {
            return nil, s.DB.CreateUser(ctx, u)
        })
        return err
    }, retryPolicy(ctx))
    
    if err == nil {
        if data, err := json.Marshal(u); err == nil {
            s.Redis.Set(ctx, "idem:"+key, data, 24*time.Hour)
        }
    }
    return err
}

// Update updates a user. Uses optimistic locking.
func (s *Service) Update(ctx context.Context, id string, u *User) error {
    return backoff.Retry(func() error {
        _, err := s.Breaker.Execute(func() (interface{}, error) {
            return nil, s.DB.UpdateUser(ctx, id, u)
        })
        if errors.Is(err, ErrConflict) {
            // optimistic-lock conflict; retry from current state
            return err
        }
        if isPermanent(err) {
            return backoff.Permanent(err)
        }
        return err
    }, retryPolicy(ctx))
}

// Delete deletes a user. Idempotent at the application level.
func (s *Service) Delete(ctx context.Context, id string) error {
    err := backoff.Retry(func() error {
        _, err := s.Breaker.Execute(func() (interface{}, error) {
            return nil, s.DB.DeleteUser(ctx, id)
        })
        if errors.Is(err, ErrNotFound) {
            return nil // delete-of-non-existent is success
        }
        return err
    }, retryPolicy(ctx))
    if err == nil {
        s.Redis.Del(ctx, "user:"+id)
    }
    return err
}

func retryPolicy(ctx context.Context) backoff.BackOff {
    b := backoff.NewExponentialBackOff()
    b.InitialInterval = 100 * time.Millisecond
    b.MaxInterval = 5 * time.Second
    b.MaxElapsedTime = 30 * time.Second
    return backoff.WithContext(backoff.WithMaxRetries(b, 5), ctx)
}

var (
    ErrConflict = errors.New("conflict")
    ErrNotFound = errors.New("not found")
)

func isPermanent(err error) bool {
    return errors.Is(err, ErrNotFound)
}

type Database struct{ /* ... */ }
func (d *Database) GetUser(ctx context.Context, id string) (*User, error) { return nil, nil }
func (d *Database) CreateUser(ctx context.Context, u *User) error          { return nil }
func (d *Database) UpdateUser(ctx context.Context, id string, u *User) error { return nil }
func (d *Database) DeleteUser(ctx context.Context, id string) error        { return nil }
```

This is a complete CRUD with:
- Caching (Get, Create).
- Idempotency keys (Create).
- Optimistic locking retry (Update).
- Idempotent semantics (Delete).
- Circuit breaker around DB calls.
- Exponential backoff retry.

Real services have more (transactions, validation, authorisation), but the retry shape is here.

---

## Appendix T: Mocking The Retry Helper For Tests

Tests need to verify retry behaviour without slow sleeps.

### Approach 1: tiny intervals

```go
b := backoff.NewExponentialBackOff()
b.InitialInterval = 1 * time.Millisecond
b.MaxInterval = 10 * time.Millisecond
b.MaxElapsedTime = 100 * time.Millisecond
```

Tests run in milliseconds.

### Approach 2: inject a Clock

`cenkalti/backoff` supports a `Clock` interface:

```go
type Clock interface {
    Now() time.Time
}
```

A fake clock:

```go
type fakeClock struct {
    now time.Time
}

func (c *fakeClock) Now() time.Time { return c.now }

func (c *fakeClock) Advance(d time.Duration) { c.now = c.now.Add(d) }
```

Inject into the backoff:

```go
b := backoff.NewExponentialBackOff()
b.Clock = &fakeClock{now: time.Now()}
```

The `MaxElapsedTime` check uses `Clock.Now()`. Advance the fake clock to trigger elapsed-time termination.

This lets you test "what happens at the 30-second mark" without actually waiting 30 seconds.

### Approach 3: a fully fake retrier

For unit tests that do not care about the schedule:

```go
type FakeRetrier struct {
    AttemptsToFail int
    Calls          int
}

func (f *FakeRetrier) Do(ctx context.Context, op func(context.Context) error) error {
    f.Calls++
    for i := 0; i <= f.AttemptsToFail; i++ {
        if err := op(ctx); err == nil {
            return nil
        }
    }
    return errors.New("retry exhausted")
}
```

Plug into the service:

```go
s := &Service{Retrier: &FakeRetrier{AttemptsToFail: 2}}
```

The test asserts on `s.Retrier.Calls`.

---

## Appendix U: A Battle Hardening Checklist

Before declaring a retry implementation "production-ready":

### Code

- [ ] Uses a battle-tested library, not custom code.
- [ ] All knobs (attempts, intervals, factor) are configurable.
- [ ] Defaults are documented and justified.
- [ ] Context is propagated everywhere.
- [ ] Deadlines are honoured.
- [ ] Errors are correctly classified (transient vs permanent).
- [ ] Idempotency is verified for retried operations.
- [ ] Circuit breaker is integrated.
- [ ] Retry budget is enforced.
- [ ] Permanent errors short-circuit.
- [ ] Response bodies are properly closed even on retry.
- [ ] Request bodies are properly replayed.

### Observability

- [ ] Counter for retry attempts.
- [ ] Histogram for attempt-at-success.
- [ ] Counter for budget denials.
- [ ] Counter for breaker state changes.
- [ ] Per-operation labels for granularity.
- [ ] Span per attempt in tracing.
- [ ] Structured logs at appropriate levels.
- [ ] Trace ID in logs.

### Operations

- [ ] Documented runbook.
- [ ] Kill switch implemented.
- [ ] Kill switch tested in staging.
- [ ] Dashboards built.
- [ ] Alerts configured.
- [ ] Postmortems include retry analysis.

### Testing

- [ ] Unit tests for each retry scenario.
- [ ] Integration tests with simulated failures.
- [ ] Chaos tests against staging.
- [ ] Load tests verify retry budget enforcement.
- [ ] Idempotency tests with concurrent duplicates.

If all 30 items are checked, the implementation is ready. If any are unchecked, file a ticket.

---

## Appendix V: Anti-Patterns Specific To Production Code

Anti-patterns that show up in real code:

### Anti-pattern 1: hard-coded constants

```go
// WRONG
err := backoff.Retry(op, backoff.NewExponentialBackOff())
```

Defaults are 500ms, 60s, 15 minutes. These are *cenkalti's* defaults, not yours. Always configure.

### Anti-pattern 2: missing context

```go
// WRONG
err := backoff.Retry(op, b) // no context
```

The retry keeps going regardless of caller cancellation. Use `WithContext`.

### Anti-pattern 3: ignoring `MaxElapsedTime`

By default it is 15 minutes. For user-facing operations, 15 minutes is forever.

```go
b := backoff.NewExponentialBackOff()
b.MaxElapsedTime = 30 * time.Second
```

### Anti-pattern 4: per-replica budget too high

```go
// WRONG
budget := rate.NewLimiter(100, 200) // per replica
// 10 replicas × 100 = 1000 RPS aggregate
```

Calibrate for aggregate.

### Anti-pattern 5: breaker with too tight thresholds

```go
// WRONG
ReadyToTrip: func(c gobreaker.Counts) bool {
    return c.ConsecutiveFailures > 3
}
```

3 failures is nothing. A normal flaky service hits 3 failures naturally.

### Anti-pattern 6: idempotency key in URL path

```go
// WRONG
url := "/api/charge/" + idempotencyKey
```

If the key contains slashes or special characters, the URL breaks. Use a header.

### Anti-pattern 7: retrying with logger.Fatal

```go
// WRONG
err := backoff.Retry(op, b)
if err != nil {
    log.Fatal(err)
}
```

`Fatal` exits the program. During an incident, this kills your service.

### Anti-pattern 8: building backoff once globally

```go
// WRONG
var globalBackoff = backoff.NewExponentialBackOff()

func DoIt() error {
    return backoff.Retry(op, globalBackoff)
}
```

A `BackOff` is *stateful*. Using one globally means concurrent calls share state and the retry schedule is wrong for everyone.

Always create a fresh `BackOff` per call.

### Anti-pattern 9: ignoring `Notify`

```go
// WRONG
err := backoff.Retry(op, b)
```

You have no visibility into retries. Use `RetryNotify` or `RetryNotifyWithTimer`.

### Anti-pattern 10: integration test with real Stripe

```go
// WRONG
func TestPaymentsService(t *testing.T) {
    // calls real Stripe API
}
```

Tests should use a mock Stripe. Real API calls in tests are expensive (cost) and flaky (network).

---

## Appendix W: Long-Term Maintenance

Retry policies have a long shelf life. Maintaining them:

### Annual review

Each year:
1. Pull dashboards. What is the retry rate?
2. Review postmortems. Were retries involved?
3. Tune parameters based on data.
4. Update runbooks if procedures changed.

### When dependencies change

- New version of Stripe API: re-test retry on their new error codes.
- Cloud provider changes pricing: retry cost shifts.
- New region: re-tune for higher latency.

### When traffic changes

- 10× traffic increase: budgets may need recalibration.
- New product launch: extra load.

### When the team changes

- Onboard new engineers to the retry patterns.
- Have a 1-hour internal workshop.
- Pair on a retry-related debugging session.

Retry policy is "set and forget" at your peril. Keep it on a yearly tickler.

---

## Appendix X: An Operating Manual

A document you might keep in `RETRIES.md`:

```markdown
# Retries Operating Manual

## Goal

Our services use retries to handle transient failures while protecting dependencies from amplification.

## Architecture

- Edge service (API gateway): retries enabled.
- Internal services (B, C, D): no retries.
- Deadline propagation via gRPC metadata.

## Defaults

- Max attempts: 3.
- Base: 100ms.
- Cap: 5s.
- Total deadline: 5s for user-facing, longer for jobs.
- Full jitter.
- Retry budget: 10% of normal traffic.
- Idempotency keys: required for non-idempotent.

## Per-Service Overrides

| Service | Max attempts | Cap | Total |
|---------|--------------|-----|-------|
| Payments | 3 | 5s | 30s |
| Search   | 3 | 1s | 5s |
| Webhook  | 8 | 1h | 24h |

## Kill Switch

Disable retries: `kubectl set env deployment/<svc> RETRIES_ENABLED=false`.

Verify: `curl /healthz` shows `retries: disabled`.

## Alerts

| Alert | Threshold | Severity | Action |
|-------|-----------|----------|--------|
| Retry rate > 5% | 5m sustained | Warn | Investigate dependency |
| Budget denial > 0 | 1m | Page | Consider kill switch |
| Breaker open > 60s | 1m | Page | Dependency is broken |

## Dashboards

- [Retry rate dashboard](https://grafana.example.com/retries)
- [Budget dashboard](https://grafana.example.com/budgets)
- [Breaker dashboard](https://grafana.example.com/breakers)

## Postmortem Template

When retries are involved in an incident, include:

1. What was the retry rate before, during, after?
2. Was the budget exhausted? When?
3. Did the breaker open? When?
4. Was the kill switch used? When?
5. Were duplicate side effects produced? How many?
6. What should change?
```

This is the kind of document a senior SRE keeps. It captures policy, procedures, and accountability.

---

## Appendix Y: A Final Tour Of The Resilience Stack

A summary of all the resilience patterns and how retry fits among them.

| Pattern | Purpose | When |
|---------|---------|------|
| Timeout | Bound call latency | Always |
| Retry | Handle transient failures | When idempotent |
| Circuit breaker | Fail fast on known-bad | High-volume deps |
| Bulkhead | Isolate dependencies | Multi-dep services |
| Rate limit | Cap outbound rate | Polite client |
| Budget | Cap retry traffic | Always (with retry) |
| Backpressure | Signal upstream | Capacity-bound |
| Cache | Avoid the dependency | Read-heavy |
| Fallback | Degrade gracefully | Critical-path |
| Hedging | Reduce tail latency | Latency-bound reads |

A high-availability service uses most of these. The composition is what makes the service resilient.

Retry is one tool. It is essential, but it is not the only tool. The professional engineer reaches for retry *and* the others, in concert.

---

## Appendix Z: A Reading List For Continued Growth

In rough order of "read next":

1. Marc Brooker's blog posts on retries, timeouts, jitter (brooker.co.za).
2. Google SRE Book — chapters on overload and cascading failures.
3. *Release It!* — Michael Nygard. Stability patterns.
4. *Designing Data-Intensive Applications* — Martin Kleppmann.
5. AWS Architecture Blog (search for retries, jitter, hedging).
6. Stripe's "Designing robust and predictable APIs with idempotency".
7. Netflix tech blog — adaptive concurrency, Hystrix.
8. Source code of `cenkalti/backoff`, `gobreaker`, `aws-sdk-go-v2/aws/retry`.

A year of reading this material, paired with hands-on production experience, takes you from "knows retries" to "expert on resilience".

---

## Final Closing

Professional-level retry is a discipline. The tools are mature, the libraries are battle-tested, the patterns are documented. The hard part is integrating them coherently and operating them under stress.

The four files in this section take you from "what is a retry?" to "I can architect and operate a high-availability system". The remaining files (`specification.md`, `interview.md`, `tasks.md`, `find-bug.md`, `optimize.md`) are practice and reference.

Build the muscle. Run the systems. Read the postmortems. Tune the policies. After a year or two, you will not need this document — you will write it.

---

## Appendix AA: A Concrete End-To-End Test Walkthrough

A test you might write for a production retry helper.

```go
package payments_test

import (
    "context"
    "errors"
    "net/http"
    "net/http/httptest"
    "sync/atomic"
    "testing"
    "time"

    "yourmodule/payments"
)

func TestChargeRetriesOnFailure(t *testing.T) {
    var attempts int32
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        n := atomic.AddInt32(&attempts, 1)
        if n < 3 {
            w.WriteHeader(http.StatusServiceUnavailable)
            return
        }
        w.Header().Set("Content-Type", "application/json")
        w.Write([]byte(`{"id":"ch_test","status":"succeeded","time":"2026-01-01T00:00:00Z"}`))
    }))
    defer server.Close()

    s := payments.NewServiceWithEndpoint(redisClient, slog.Default(), server.URL)
    
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    
    resp, err := s.Charge(ctx, "test-key-1", payments.ChargeRequest{
        Amount: 100, Currency: "USD",
    })
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if resp.ID != "ch_test" {
        t.Errorf("unexpected ID: %s", resp.ID)
    }
    if got := atomic.LoadInt32(&attempts); got != 3 {
        t.Errorf("expected 3 attempts, got %d", got)
    }
}

func TestChargeRespectsIdempotencyKey(t *testing.T) {
    var attempts int32
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        atomic.AddInt32(&attempts, 1)
        w.Write([]byte(`{"id":"ch_test","status":"succeeded","time":"2026-01-01T00:00:00Z"}`))
    }))
    defer server.Close()

    s := payments.NewServiceWithEndpoint(redisClient, slog.Default(), server.URL)
    ctx := context.Background()
    
    // First call
    _, err := s.Charge(ctx, "test-key-2", payments.ChargeRequest{Amount: 100})
    if err != nil { t.Fatal(err) }
    
    // Second call with same key
    _, err = s.Charge(ctx, "test-key-2", payments.ChargeRequest{Amount: 100})
    if err != nil { t.Fatal(err) }
    
    if got := atomic.LoadInt32(&attempts); got != 1 {
        t.Errorf("expected idempotency: 1 attempt, got %d", got)
    }
}

func TestChargeBudgetExhausted(t *testing.T) {
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusServiceUnavailable)
    }))
    defer server.Close()

    s := payments.NewServiceWithEndpoint(redisClient, slog.Default(), server.URL)
    s.RetryBudget = rate.NewLimiter(rate.Limit(0.1), 1) // very tight
    
    ctx := context.Background()
    // First request consumes the only token
    s.Charge(ctx, "test-key-3", payments.ChargeRequest{Amount: 100})
    // Second request: budget exhausted on first retry
    _, err := s.Charge(ctx, "test-key-4", payments.ChargeRequest{Amount: 100})
    if err == nil {
        t.Fatal("expected error")
    }
}

func TestChargeRespectsDeadline(t *testing.T) {
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        time.Sleep(100 * time.Millisecond)
        w.WriteHeader(http.StatusServiceUnavailable)
    }))
    defer server.Close()

    s := payments.NewServiceWithEndpoint(redisClient, slog.Default(), server.URL)
    
    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()
    
    start := time.Now()
    _, err := s.Charge(ctx, "test-key-5", payments.ChargeRequest{Amount: 100})
    elapsed := time.Since(start)
    
    if err == nil {
        t.Fatal("expected error")
    }
    if !errors.Is(err, context.DeadlineExceeded) {
        t.Errorf("expected deadline exceeded, got %v", err)
    }
    if elapsed > 500*time.Millisecond {
        t.Errorf("retry continued past deadline: %v", elapsed)
    }
}
```

These tests cover the four most important behaviours: retries on failure, idempotency, budget enforcement, deadline respect. Together they pin down the contract.

---

## Appendix BB: A Walkthrough Of A Real Incident Response

A hypothetical 2 AM page. What you do.

### 02:13 AM

Page: "Stripe retry rate spike alert. Page severity: high."

### 02:14 AM

You wake up. Open the laptop. SSH to bastion. Open dashboards.

### 02:15 AM

Dashboard shows: retry rate at 25%. Normal 1%. Budget denial just fired.

Check Stripe status page: "Investigating elevated error rates in EU region."

### 02:17 AM

Decision: Stripe is degraded but recovering. Our budget is doing its job; users may see errors but the system is bounded.

Do not flip kill switch yet. Monitor for 5 minutes.

### 02:22 AM

Stripe error rate is dropping. Our retry rate is following. Budget denial alert clears.

### 02:25 AM

Retry rate back to baseline. Page closes.

### 02:30 AM

Write incident notes: timestamps, what you observed, what you decided.

### 09:00 AM

Postmortem meeting. Discuss the alert thresholds — should we have escalated to "page" or stayed at "warn"? Update runbooks.

This is the rhythm of operating retries in production. Most pages are non-events; the system handled it. Occasionally a page is a real incident that needs your action. The discipline is knowing the difference.

---

## Appendix CC: A Detailed Look At "Retry-After" Header

The HTTP `Retry-After` header is a key signal. Let us look at the corner cases.

### Format

Two forms:
- `Retry-After: 120` (seconds)
- `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT` (HTTP-date)

### Server semantics

A `429 Too Many Requests` with `Retry-After: 60` means "wait 60 seconds before retrying".

A `503 Service Unavailable` with `Retry-After: <date>` means "I will be back at this time".

### Honouring the header

```go
if d, ok := parseRetryAfter(resp.Header.Get("Retry-After")); ok {
    // sleep d
}
```

Be careful: the header may be larger than your deadline. Clip:

```go
if deadline, ok := ctx.Deadline(); ok {
    if d > time.Until(deadline) {
        return ctx.Err() // give up
    }
}
```

### Combining with computed backoff

Some clients use `max(retry_after, computed_backoff)`. The server's suggestion is a *floor*.

### Jitter on top

Add a small jitter:

```go
d = d + time.Duration(rand.Int63n(int64(d / 10)))
```

10% jitter desynchronises clients.

### When Retry-After is wrong

Servers sometimes return absurd values: `Retry-After: 86400` (a day). Honour them only up to a sane maximum:

```go
if d > 1 * time.Hour {
    d = 1 * time.Hour
}
```

### gRPC equivalent

gRPC does not have `Retry-After` per se. The closest is `RESOURCE_EXHAUSTED` with optional metadata for retry hint. Less standardised.

---

## Appendix DD: A Note On TLS And Retries

TLS handshake is expensive (~50-200ms). Retries that reconnect pay this cost.

### Connection reuse

Go's `net/http.Transport` reuses TLS connections by default. The first request pays the handshake cost; subsequent requests on the same connection do not.

### Connection failures

If the TLS handshake fails (cert expired, network drop, etc.), retry. But the next attempt also handshakes — adding 200ms per attempt.

### Pre-warming

For latency-critical clients, pre-warm connections:

```go
// At startup
client.Get("https://api.example.com/healthz") // discard response; connection is now in pool
```

This avoids the first-request handshake cost.

### TLS session resumption

Modern TLS supports session resumption: the handshake is much faster on subsequent connections. Go's `crypto/tls` does this automatically with default settings.

### Mutual TLS

mTLS adds client certificate validation. Slightly more expensive but same shape.

For retries with mTLS, ensure the cert is valid and not about to expire. A 1-second cert expiration could cause many retries to fail simultaneously.

---

## Appendix EE: Beyond This File

The remaining files in this section are practice and reference:

- `specification.md` — formal definitions of jitter formulas, library APIs.
- `interview.md` — 30-40 Q&A for interviews.
- `tasks.md` — coding exercises.
- `find-bug.md` — snippets with bugs to find.
- `optimize.md` — optimisation challenges.

Work through these to solidify what you have learned.

After this section, related Roadmap topics:

- Circuit breakers (full chapter).
- Rate limiting and token buckets (full chapter).
- Distributed tracing (observability section).
- gRPC service mesh patterns (later in concurrency or distributed systems section).
- Idempotency patterns (REST API design).

Each builds on the foundation here.

This is the professional level. Move on when ready.

---

## Appendix FF: Real Examples From Notable Open Source Projects

A short tour of how well-known Go projects handle retries.

### Kubernetes (`client-go`)

The Kubernetes client uses retry for several operations:

```go
import "k8s.io/client-go/util/retry"

retry.OnError(retry.DefaultBackoff, errors.IsConflict, func() error {
    // update operation
    return nil
})
```

`retry.DefaultBackoff` is `wait.Backoff{Steps: 5, Duration: 10 * time.Millisecond, Cap: 1 * time.Second, Factor: 2.0, Jitter: 0.1}`. Tiny intervals because Kubernetes operations are conflict-driven (etcd optimistic locking).

`retry.OnError` only retries if the predicate (`errors.IsConflict`) returns true. Other errors surface immediately.

The `client-go` library has dozens of such retry calls throughout, all using the same `Backoff` type.

### Docker (`distribution`)

Docker's registry client retries pulls on 5xx:

```go
err = backoff.Retry(func() error {
    return c.pull(ctx, ref)
}, backoff.WithContext(backoff.NewExponentialBackOff(), ctx))
```

Standard `cenkalti/backoff` use. Docker is consistent across its codebase.

### Prometheus

Prometheus has internal retry for remote-write:

```go
type recoverableError struct{ error }

err := backoff.RetryNotify(func() error {
    err := c.sendSamples(ctx, samples)
    if isRecoverable(err) {
        return &recoverableError{err}
    }
    return backoff.Permanent(err)
}, backoffPolicy, logRetry)
```

Notice the `recoverableError` wrapper. Prometheus classifies errors explicitly.

### CockroachDB

The CockroachDB client retries on transaction conflicts:

```go
err := crdb.ExecuteTx(ctx, db, nil, func(tx *sql.Tx) error {
    // ... transaction work ...
    return nil
})
```

`crdb.ExecuteTx` internally handles serialisation failures via retry. The user does not see it. Very clean abstraction.

### Etcd

Etcd's `clientv3` retries on lease renewal failures. The retry is built into the lease KeepAlive mechanism:

```go
ch, err := cli.KeepAlive(ctx, leaseID)
// the lease auto-retries internally
```

Etcd makes retry invisible to the user for these built-in operations.

### Reading these projects teaches

1. Retry is everywhere in production Go code.
2. Patterns are consistent: predicate-based retry, `Permanent` wrapper, context propagation.
3. Naming varies: `OnError`, `Execute`, `Retry`. The shape is similar.
4. Library choices vary: `client-go/util/retry`, `cenkalti/backoff`, custom.

Pick one library, use it consistently.

---

## Appendix GG: Migration Story — Moving To A Retry Library

If you have ad-hoc retry loops scattered across a codebase, migrating to a library is a project. Here is a typical playbook.

### Phase 1: Inventory

Find all retry loops:

```
git grep -E "for.*\{.*Sleep" --include="*.go" | head -50
git grep "time.Sleep" --include="*.go" | head -50
```

For each match, classify:
- Is this a retry loop?
- What is the policy (attempts, base, cap)?
- What errors trigger retry?
- Does it accept `ctx`?

Build a spreadsheet. Identify the patterns.

### Phase 2: Decide on a library

Options:
- `cenkalti/backoff` for general retry.
- `hashicorp/go-retryablehttp` for HTTP.
- gRPC built-in for gRPC.

Pick based on majority use case. Hybrid is fine but adds complexity.

### Phase 3: Migrate one call site

Pick the smallest retry loop. Replace with the library. Test.

```go
// Before
for i := 0; i < 5; i++ {
    err := op()
    if err == nil { return nil }
    time.Sleep(time.Duration(1 << i) * time.Second)
}
return err

// After
b := backoff.NewExponentialBackOff()
b.InitialInterval = 1 * time.Second
b.MaxInterval = 16 * time.Second
b.MaxElapsedTime = 31 * time.Second
return backoff.Retry(op, b)
```

Confirm behaviour matches.

### Phase 4: Scale out

Migrate all call sites. Use PRs of ~5 call sites each.

### Phase 5: Centralise

Pull common configuration into a single `retry.Defaults` function. Now you can tune one place and affect everywhere.

### Phase 6: Add observability

Instrument the retry helper. Now you can see what is happening.

### Phase 7: Tune

Use observability data to tune parameters.

This is a 3-6 month project for a moderately large codebase. Worth doing once.

---

## Appendix HH: Final Final Thoughts

This is a long file. If you have read it all, congratulations — you are well-prepared for professional retry work.

Key takeaways:

1. Use a library (cenkalti, hashicorp, gRPC built-in).
2. Configure carefully (do not trust defaults blindly).
3. Integrate observability (metrics + traces + logs).
4. Compose with breaker, budget, deadline.
5. Use idempotency for non-idempotent operations.
6. Build a kill switch.
7. Document and runbook.
8. Tune based on data.

These eight items, done correctly, distinguish a production-grade service from an amateur one.

Build the muscle. Operate the system. Tune from data. Be ready for the incident.

The remaining files in this section are practice — exercise the patterns until they are second nature.

Good luck.



