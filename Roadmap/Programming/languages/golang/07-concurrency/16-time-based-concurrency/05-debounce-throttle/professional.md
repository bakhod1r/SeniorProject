---
layout: default
title: Professional
parent: Debounce and Throttle
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/05-debounce-throttle/professional/
---

# Debounce and Throttle — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [HTTP 429 and the Standard Rate-Limit Headers](#http-429-and-the-standard-rate-limit-headers)
3. [Retry-After Semantics and Client Behavior](#retry-after-semantics-and-client-behavior)
4. [Designing the Public API Contract](#designing-the-public-api-contract)
5. [Per-User, Per-IP, Per-Endpoint Limits](#per-user-per-ip-per-endpoint-limits)
6. [Burst-Friendly vs Strict Limits](#burst-friendly-vs-strict-limits)
7. [Server Throttling Under Load](#server-throttling-under-load)
8. [Client-Side Throttling with Jitter](#client-side-throttling-with-jitter)
9. [UI Event Debouncing — End to End](#ui-event-debouncing--end-to-end)
10. [Search-as-You-Type](#search-as-you-type)
11. [Autosave Debouncers](#autosave-debouncers)
12. [Resize, Scroll, Drag Throttling](#resize-scroll-drag-throttling)
13. [Log Throttling](#log-throttling)
14. [Metric Throttling and Aggregation](#metric-throttling-and-aggregation)
15. [Alert Throttling](#alert-throttling)
16. [Email and Push Notification Throttling](#email-and-push-notification-throttling)
17. [Backpressure as Throttling](#backpressure-as-throttling)
18. [Integrating with Circuit Breakers](#integrating-with-circuit-breakers)
19. [Integrating with Retry Policies](#integrating-with-retry-policies)
20. [Service Mesh Rate Limiters](#service-mesh-rate-limiters)
21. [Edge Rate Limiting (CDN/WAF)](#edge-rate-limiting-cdnwaf)
22. [Observability Dashboards](#observability-dashboards)
23. [Postmortem 1: The Cascading Login Storm](#postmortem-1-the-cascading-login-storm)
24. [Postmortem 2: The Debouncer That Never Fired](#postmortem-2-the-debouncer-that-never-fired)
25. [Postmortem 3: The Misconfigured 429](#postmortem-3-the-misconfigured-429)
26. [Postmortem 4: Log Storm Fills the Disk](#postmortem-4-log-storm-fills-the-disk)
27. [Postmortem 5: The Limiter That Lied](#postmortem-5-the-limiter-that-lied)
28. [Common Anti-Patterns](#common-anti-patterns)
29. [Operational Playbooks](#operational-playbooks)
30. [Self-Assessment](#self-assessment)
31. [Summary](#summary)

---

## Introduction

The previous documents covered what rate limiters are, how to use them, and how to build them from scratch. This document covers what happens when they meet reality: a public API, a UI fielded by millions of users, a log pipeline under sudden load, an integration with three downstream services each with its own quota, a postmortem at 3 AM after the rate limiter caused or failed to prevent an outage.

The skills here are operational. They are the difference between a service that survives a bad day and one that becomes the bad day. They include the precise wire format of HTTP rate-limit responses, the timing math behind UI debouncers in real browsers, the architecture of a log throttler that does not lose critical signal, the dashboards and alerts that tell you a limiter is misbehaving, and the post-incident discipline of asking "what would have prevented this?" honestly.

Throughout we will draw on patterns from real systems: AWS, GCP, GitHub, Stripe, Slack, Cloudflare, and the small services where most of us actually work. The pattern language is shared; the engineering judgement is what separates a working system from a working-on-a-good-day system.

---

## HTTP 429 and the Standard Rate-Limit Headers

The HTTP response code for rate limiting is `429 Too Many Requests`, defined in RFC 6585. The status code is the only universally honored signal; everything else is convention.

### The minimum compliant response

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json

{
  "error": "rate_limited",
  "message": "Too many requests; try again in 30 seconds."
}
```

This is enough for a client that knows the API to handle it. It is *not* enough for generic clients (web browsers retrying scripts, monitoring tools, third-party SDKs). For those we need headers.

### The `Retry-After` header

RFC 7231 defines `Retry-After`, which can be either:

- A number of seconds: `Retry-After: 30`
- An HTTP-date: `Retry-After: Wed, 21 Oct 2025 07:28:00 GMT`

Use the seconds form. It is universally supported, easy for clients to parse, and unambiguous.

```
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{"error":"rate_limited"}
```

Many HTTP client libraries automatically honor `Retry-After`. The Go `net/http` library does not, but most retry middleware (e.g., `hashicorp/go-retryablehttp`, `cenkalti/backoff`) does.

### The `X-RateLimit-*` family

There is no official standard, but a de-facto convention emerged from Twitter, GitHub, and Stripe:

- `X-RateLimit-Limit`: the maximum requests in the window.
- `X-RateLimit-Remaining`: the requests left in the window.
- `X-RateLimit-Reset`: the Unix timestamp (or seconds) when the window resets.

Example:

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 5000
X-RateLimit-Remaining: 4998
X-RateLimit-Reset: 1700000000
```

These headers should appear on every response, not just 429s. Clients use them to throttle themselves proactively rather than waiting for a 429.

### Variations across providers

- **GitHub**: `X-RateLimit-Limit`, `-Remaining`, `-Reset` (Unix epoch seconds), plus `-Resource` for the bucket name and `-Used`.
- **Twitter (X)**: same family plus `x-rate-limit-incident-id`.
- **Stripe**: returns 429 with `Retry-After` but does not expose remaining; uses different per-user limits server-side.
- **GCP**: returns 429 with `Retry-After` and a JSON body. Headers are minimal.
- **AWS**: returns 503 or 400 with a specific error type rather than 429 in many services (legacy API behavior). DynamoDB returns `ProvisionedThroughputExceededException`.

The lack of standardization is annoying but real. Document your API's specific behavior.

### The RateLimit RFC (IETF)

There is an in-progress IETF draft, `draft-ietf-httpapi-ratelimit-headers`, that proposes standardized headers:

- `RateLimit-Limit`: window size and limit, e.g., `100, 100;w=60`.
- `RateLimit-Remaining`: requests left.
- `RateLimit-Reset`: seconds until reset.

The `X-` prefix is officially deprecated by RFC 6648. New APIs should prefer the prefix-less form, but support both for backward compatibility.

### Implementation in Go

```go
package ratelimit

import (
    "fmt"
    "net/http"
    "time"
)

type Decision struct {
    Allowed   bool
    Limit     int
    Remaining int
    ResetAt   time.Time
}

func WriteHeaders(w http.ResponseWriter, d Decision) {
    w.Header().Set("RateLimit-Limit", fmt.Sprintf("%d", d.Limit))
    w.Header().Set("RateLimit-Remaining", fmt.Sprintf("%d", d.Remaining))
    w.Header().Set("RateLimit-Reset", fmt.Sprintf("%d", int(time.Until(d.ResetAt).Seconds())))
    w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", d.Limit))
    w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", d.Remaining))
    w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", d.ResetAt.Unix()))
}

func Deny(w http.ResponseWriter, d Decision) {
    WriteHeaders(w, d)
    retryAfter := int(time.Until(d.ResetAt).Seconds())
    if retryAfter < 1 {
        retryAfter = 1
    }
    w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusTooManyRequests)
    fmt.Fprintf(w, `{"error":"rate_limited","retry_after":%d}`, retryAfter)
}
```

The middleware:

```go
func Middleware(l Limiter) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            key := keyFromRequest(r)
            d := l.Check(r.Context(), key)
            if !d.Allowed {
                Deny(w, d)
                return
            }
            WriteHeaders(w, d)
            next.ServeHTTP(w, r)
        })
    }
}
```

The headers go on every response. The deny path adds `Retry-After` and sends 429.

### Edge cases

- **`Retry-After: 0` or negative**: invalid. Always send at least 1 second. Many clients interpret 0 as "retry immediately" — which will likely fail again, causing a tight retry loop.
- **`Retry-After` too long**: clients may give up. Cap at a reasonable maximum (often 60 seconds for public APIs).
- **Missing `Content-Length`**: some buggy clients require it on 429s. Always write the body.
- **CORS preflight 429**: `OPTIONS` preflight requests should usually not be rate-limited. If they are limited, the browser will not send the actual request and the developer sees a CORS error, not a rate-limit error. Confusing.

### A real-world response

GitHub's API on a rate-limit hit:

```
HTTP/2 403 Forbidden
date: Sun, 14 May 2026 12:00:00 GMT
content-type: application/json; charset=utf-8
x-ratelimit-limit: 60
x-ratelimit-remaining: 0
x-ratelimit-reset: 1716000000
x-ratelimit-used: 60
x-ratelimit-resource: core
retry-after: 60
{
  "message": "API rate limit exceeded for 203.0.113.10.",
  "documentation_url": "https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting"
}
```

GitHub uses 403 instead of 429 for historical reasons. Modern APIs should use 429.

---

## Retry-After Semantics and Client Behavior

The server tells the client when to retry. The client must honor it.

### What "retry" means

A retry is sending the *same* request again. The intent: the next attempt should succeed because the rate-limit window has reset.

This is only safe for idempotent operations. A non-idempotent operation (POST creating a resource) cannot blindly be retried — you might create the resource twice.

The Go HTTP client does not retry by default. You add retry logic explicitly.

```go
package retry

import (
    "context"
    "net/http"
    "strconv"
    "time"
)

type RetryClient struct {
    Client  *http.Client
    Max     int
    Backoff func(attempt int) time.Duration
}

func (c *RetryClient) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
    for attempt := 0; attempt < c.Max; attempt++ {
        if attempt > 0 {
            select {
            case <-ctx.Done():
                return nil, ctx.Err()
            case <-time.After(c.Backoff(attempt)):
            }
        }
        resp, err := c.Client.Do(req.Clone(ctx))
        if err != nil {
            continue // network error: retry
        }
        if resp.StatusCode != 429 && resp.StatusCode != 503 {
            return resp, nil
        }
        wait := parseRetryAfter(resp.Header.Get("Retry-After"))
        if wait == 0 {
            wait = c.Backoff(attempt)
        }
        resp.Body.Close()
        select {
        case <-ctx.Done():
            return nil, ctx.Err()
        case <-time.After(wait):
        }
    }
    return nil, fmt.Errorf("retry limit exceeded")
}

func parseRetryAfter(h string) time.Duration {
    if h == "" {
        return 0
    }
    if secs, err := strconv.Atoi(h); err == nil {
        return time.Duration(secs) * time.Second
    }
    if t, err := http.ParseTime(h); err == nil {
        return time.Until(t)
    }
    return 0
}
```

This is a basic retry client that honors `Retry-After`. Real production clients are more sophisticated:

- Exponential backoff with jitter for transient network errors.
- Distinguish between retryable and non-retryable status codes.
- Avoid retrying non-idempotent methods unless explicitly allowed.
- Track cumulative wait time and give up gracefully.

### The "thundering herd" problem in retries

Suppose a server returns `Retry-After: 30` to a thousand clients simultaneously. All thousand wait exactly 30 seconds. At second 30 they all retry at once — and the server, having just recovered, is hit by another wall of requests and immediately returns 429 again.

This is the thundering herd. The fix: add jitter to the retry wait.

```go
import "math/rand"

func jittered(base time.Duration) time.Duration {
    // Add 0-50% jitter.
    j := time.Duration(rand.Int63n(int64(base) / 2))
    return base + j
}
```

When honoring `Retry-After`, spread the retries over a window slightly larger than the suggested wait. The server sees a smooth ramp instead of a wall.

### Backoff strategies

- **Linear**: wait = base * attempt. Predictable, gentle.
- **Exponential**: wait = base * 2^attempt. Aggressive backoff, useful when the failure is likely persistent.
- **Decorrelated jitter**: wait = random(base, prev_wait * 3). AWS-recommended, scales well across many clients.
- **Exponential with full jitter**: wait = random(0, base * 2^attempt). Simplest jittered backoff that prevents synchronization.

For a typical retryable client:

```go
func decorrelatedJitter(attempt int, base, max time.Duration, prev time.Duration) time.Duration {
    upper := prev * 3
    if upper > max {
        upper = max
    }
    if upper < base {
        upper = base
    }
    return base + time.Duration(rand.Int63n(int64(upper-base)))
}
```

This is what `golang.org/x/time/rate` does not do — but every robust HTTP client must.

### Idempotency keys for safe retries

For non-idempotent operations, send an `Idempotency-Key` header. Stripe pioneered this:

```
POST /v1/charges
Idempotency-Key: 7e8a...4f2c
{ "amount": 1000, "currency": "usd" }
```

The server stores the key and the response. If the client retries with the same key, the server returns the stored response (not re-executing the operation).

This makes any operation safely retryable. It is the right pattern for any external-facing POST.

Implementing on the server:

```go
type IdempotencyStore interface {
    Get(ctx context.Context, key string) (resp []byte, ok bool, err error)
    Set(ctx context.Context, key string, resp []byte, ttl time.Duration) error
}

func IdempotencyMiddleware(store IdempotencyStore) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            key := r.Header.Get("Idempotency-Key")
            if key == "" {
                next.ServeHTTP(w, r)
                return
            }
            if resp, ok, _ := store.Get(r.Context(), key); ok {
                w.WriteHeader(http.StatusOK)
                w.Write(resp)
                return
            }
            rec := &recordingWriter{ResponseWriter: w}
            next.ServeHTTP(rec, r)
            if rec.status == http.StatusOK {
                store.Set(r.Context(), key, rec.body.Bytes(), 24*time.Hour)
            }
        })
    }
}
```

The store is typically Redis or a database table.

### Cumulative timeout

A retry policy without a maximum total time can hang the caller indefinitely. Set a top-level deadline.

```go
ctx, cancel := context.WithTimeout(parentCtx, 30*time.Second)
defer cancel()
resp, err := retryClient.Do(ctx, req)
```

The context is the ultimate retry budget. When it expires the client gives up, regardless of how many retries are left.

---

## Designing the Public API Contract

If you offer a public API, the rate limit is a contract. Document it, advertise it, and stick to it.

### Tiers

Most APIs offer tiers:

- **Free**: low limit, e.g., 60 requests/hour.
- **Authenticated**: medium, e.g., 5000/hour.
- **Premium**: high, e.g., 50000/hour.
- **Enterprise**: negotiable per-customer limits.

The tier is determined by the auth credentials. The limiter looks up the tier and applies the corresponding policy.

```go
type Tier struct {
    Name           string
    RequestsPerHour int
    BurstSize       int
}

var tiers = map[string]Tier{
    "free":       {Name: "free", RequestsPerHour: 60, BurstSize: 10},
    "authed":     {Name: "authed", RequestsPerHour: 5000, BurstSize: 100},
    "premium":    {Name: "premium", RequestsPerHour: 50000, BurstSize: 500},
    "enterprise": {Name: "enterprise", RequestsPerHour: 500000, BurstSize: 5000},
}

func tierFromAuth(authHeader string) Tier {
    // ... decode JWT, look up plan, return tier
    return tiers["free"]
}
```

### Documenting the limits

Your API docs must specify:

1. The numeric limit for each tier.
2. The window (per hour, per minute, per day).
3. The algorithm (token bucket with burst, sliding window).
4. The response code and headers when limited.
5. The Retry-After behavior.
6. The cost of different endpoints (some weigh more than others).

Example documentation snippet:

```markdown
## Rate limits

Each authenticated request is subject to a rate limit based on your account tier.

| Tier         | Requests/Hour | Burst |
|--------------|--------------:|------:|
| Free         |            60 |    10 |
| Authenticated |          5000 |   100 |
| Premium      |         50000 |   500 |
| Enterprise   |  custom (contact sales) | |

The limit is enforced with a token bucket. Bursts up to the listed value are
allowed; the rate fills over the remaining time of the hour. When you exceed
your limit you will receive a `429 Too Many Requests` response with a `Retry-After`
header indicating when to retry.

Endpoints cost 1 token unless noted otherwise:
- `/search/*`: 5 tokens per request
- `/graphql`: variable cost based on query depth (see GraphQL limits)
- `/uploads`: 10 tokens per request, plus 1 token per MB

Response headers on every successful request:
- `X-RateLimit-Limit`: your hourly limit
- `X-RateLimit-Remaining`: tokens left this hour
- `X-RateLimit-Reset`: Unix timestamp when the hour resets
```

The clarity of the documentation is the API's UX. Lazy documentation produces angry developers.

### Soft vs hard limits

A soft limit returns a warning header (e.g., `X-RateLimit-Warning: nearing limit`) but admits the request. A hard limit returns 429.

Many APIs use both: warn at 80% of the limit, deny at 100%. The warning gives clients time to slow down before hitting the wall.

```go
func WriteHeadersWithWarning(w http.ResponseWriter, d Decision) {
    WriteHeaders(w, d)
    used := d.Limit - d.Remaining
    if float64(used)/float64(d.Limit) > 0.8 {
        w.Header().Set("X-RateLimit-Warning", "nearing limit")
    }
}
```

### Cost-aware endpoints

A search query is more expensive than a single record fetch. Charge more tokens for expensive operations.

```go
var endpointCost = map[string]int{
    "/search":         5,
    "/graphql":        10, // baseline; variable based on query
    "/uploads":        10,
    "/admin/audit":    20,
}

func costOf(r *http.Request) int {
    if c, ok := endpointCost[r.URL.Path]; ok {
        return c
    }
    return 1
}

func Middleware(l Limiter) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            key := keyFromRequest(r)
            cost := costOf(r)
            d := l.CheckN(r.Context(), key, cost)
            if !d.Allowed {
                Deny(w, d)
                return
            }
            WriteHeaders(w, d)
            next.ServeHTTP(w, r)
        })
    }
}
```

Cost-aware limiting is essential for GraphQL APIs where a single request can do enormous work. Compute the cost from the query AST.

### Per-resource limits

In addition to a global per-user limit, you might enforce per-resource limits:

- 1000 messages per channel per minute.
- 100 commits per repository per hour.

The key includes the resource ID: `ratelimit:user:U123:channel:C456`.

This protects individual resources from being saturated by a single user.

### When to skip rate limiting

Not every endpoint needs limiting:

- Health checks (`/health`, `/ping`): no limit; we want monitoring to always succeed.
- Admin endpoints behind auth: trust the auth; the limit becomes paranoia.
- Cached read-only endpoints: the cache absorbs the load; limiting is redundant.

Conversely, always limit:

- Authentication endpoints (`/login`, `/signup`): protect against credential stuffing.
- Resource-creation endpoints: prevent abuse.
- Search and aggregate endpoints: expensive on the backend.

---

## Per-User, Per-IP, Per-Endpoint Limits

A real API has multiple keys layered together.

### The key hierarchy

A request lookup might produce:

- `user_id`: from the auth token.
- `api_key_id`: also from the auth.
- `ip`: from the request.
- `endpoint`: from the URL path.

Each may have its own limit:

- Per-user: 1000/hour (the user has only so much quota).
- Per-API-key: 5000/hour (the key has its own quota; useful when one user has many keys).
- Per-IP: 100/hour (anonymous limit, defense against unauthenticated abuse).
- Per-endpoint per-user: 100/minute on `/search` (some endpoints are more expensive).

A request is admitted only if all applicable limits admit. The most restrictive wins.

```go
func (m *MultiLimiter) Allow(r *http.Request) Decision {
    keys := m.deriveKeys(r)
    decisions := make([]Decision, 0, len(keys))
    for _, k := range keys {
        d := m.check(k)
        decisions = append(decisions, d)
        if !d.Allowed {
            // Reject; release the reservations already made.
            // (See hierarchical token bucket for proper handling.)
            return d
        }
    }
    // Commit all decisions.
    return decisions[len(decisions)-1] // or aggregate
}
```

### IP-based limits and proxies

The "IP" in a per-IP limit is the *client's* IP, not necessarily `r.RemoteAddr`. Behind a load balancer or CDN, `RemoteAddr` is the proxy. The real IP is in `X-Forwarded-For` or `X-Real-IP`.

```go
func clientIP(r *http.Request) string {
    if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
        // Take the first IP (the original client).
        if idx := strings.Index(xff, ","); idx >= 0 {
            return strings.TrimSpace(xff[:idx])
        }
        return strings.TrimSpace(xff)
    }
    if xr := r.Header.Get("X-Real-IP"); xr != "" {
        return xr
    }
    host, _, _ := net.SplitHostPort(r.RemoteAddr)
    return host
}
```

Caveats:

- `X-Forwarded-For` can be spoofed by clients. Trust it only when the request came through a known proxy.
- The first IP is the original client; subsequent IPs are intermediate proxies.
- IPv6 IPs may use shared address ranges. A `/64` prefix is often the right key, since one client can have many IPv6 addresses.

### NAT and shared IPs

Many users share a single NAT IP (corporate networks, mobile carriers). A per-IP limit penalizes all of them collectively.

Mitigations:

- Use authenticated keys when available; fall back to IP only for anonymous.
- Track per-IP in addition to per-user; a hard per-IP limit only kicks in for genuine abuse.
- Whitelist known shared NATs (corporate proxies, mobile carriers).

### Per-endpoint limits

Different endpoints have different sensitivities.

- `/auth/login`: 5/minute per IP. Protect against credential stuffing.
- `/auth/password-reset`: 1/minute per email. Protect against email abuse.
- `/api/search`: 100/minute per user. Search is expensive.
- `/api/messages`: 1000/minute per channel. Messages are cheap but volume matters.

The per-endpoint limit is encoded in the route definition.

```go
type RouteLimits struct {
    Path  string
    Limit int
    Per   time.Duration
    Key   func(*http.Request) string
}

var routes = []RouteLimits{
    {Path: "/auth/login", Limit: 5, Per: time.Minute, Key: ipKey},
    {Path: "/auth/password-reset", Limit: 1, Per: time.Minute, Key: emailKey},
    {Path: "/api/search", Limit: 100, Per: time.Minute, Key: userKey},
}
```

A router matches the path and applies the appropriate limit.

---

## Burst-Friendly vs Strict Limits

The decision between burst-friendly (token bucket with large burst) and strict (small burst or sliding window) shapes the API's UX.

### Burst-friendly

- Token bucket with `b = r * 60` (burst = 60 seconds of rate).
- Allows clients to do legitimate startup bursts.
- Friendly to batch processing workloads.

Example: a user logs in, the client fetches their profile, inbox, settings, and recent activity in parallel. Five requests in one second. With burst-friendly limits, all five succeed and the user sees a snappy app.

### Strict

- Sliding window with the limit equal to the long-term rate.
- No bursts allowed beyond the steady-state rate.
- Friendly to attack mitigation.

Example: a credential-stuffing attacker tries 100 username/password pairs in one second. With strict limits, only 1-2 succeed and the rest are denied immediately.

### Mixed

Most APIs use both: burst-friendly for authenticated user actions, strict for anonymous or sensitive actions.

```go
var limits = map[string]LimiterConfig{
    "user_actions":    {Algorithm: "token_bucket", Rate: 100/3600.0, Burst: 100}, // 100/hr, burst 100
    "login":           {Algorithm: "sliding_window", Rate: 5/60.0, Window: time.Minute},
    "password_reset":  {Algorithm: "sliding_window", Rate: 1/60.0, Window: time.Minute},
    "anonymous":       {Algorithm: "sliding_window", Rate: 10/60.0, Window: time.Minute},
}
```

### Communicating burst to clients

`X-RateLimit-*` headers typically reflect the long-term limit. The burst is implicit.

If burst matters to client behavior (e.g., a client wants to know if it can send 20 requests right now), expose it:

```
X-RateLimit-Burst: 100
```

Few APIs do this, but it can be useful for SDK developers.

---

## Server Throttling Under Load

A rate limiter prevents individual abusers from saturating the server. But what about the aggregate load — when all users are within their limits but the sum overwhelms the server?

### Aggregate throttling

A global limiter caps total throughput regardless of per-user limits.

```go
type AggregateLimiter struct {
    perUser *PerKeyLimiter
    global  *rate.Limiter
}

func (l *AggregateLimiter) Allow(r *http.Request) bool {
    if !l.perUser.Allow(userKey(r)) {
        return false
    }
    if !l.global.Allow() {
        return false
    }
    return true
}
```

The global limit is typically set just below the server's capacity (e.g., the max throughput the database can sustain). When the global limiter fires, every user sees occasional 429s — a sign that capacity is reached.

### Load shedding

Beyond rate limiting, when the server is genuinely overloaded, drop *some* traffic to keep the rest fast. This is "load shedding."

Common approaches:

- **Random drop**: drop X% of requests when CPU/memory is high.
- **Priority drop**: drop low-priority requests first.
- **Queue-length drop**: drop requests when the queue exceeds a threshold.

Go example:

```go
type Shedder struct {
    threshold float64 // CPU or queue-depth threshold
    sample    func() float64 // current load
}

func (s *Shedder) Allow() bool {
    load := s.sample()
    if load < s.threshold {
        return true
    }
    // Linearly drop more as load exceeds threshold.
    p := (load - s.threshold) / (1.0 - s.threshold)
    if p > 1.0 {
        p = 1.0
    }
    return rand.Float64() > p
}
```

When load is at 100% (saturation), drop 100% of new requests. When load is at threshold, drop 0%. Linear in between.

### Adaptive shedding

A more sophisticated approach: shed by latency. Netflix's "adaptive concurrency limit" library is widely cited.

The idea: measure rolling p99 latency. If it exceeds a threshold, reduce the concurrency limit. If it stays below for a while, increase.

```go
type AdaptiveConcurrencyLimiter struct {
    mu              sync.Mutex
    inFlight        atomic.Int64
    limit           int
    latencyP99      time.Duration
    targetLatency   time.Duration
    samples         []time.Duration
    lastAdjust      time.Time
}

func (l *AdaptiveConcurrencyLimiter) Allow() bool {
    cur := l.inFlight.Add(1)
    if int(cur) > l.limit {
        l.inFlight.Add(-1)
        return false
    }
    return true
}

func (l *AdaptiveConcurrencyLimiter) Done(latency time.Duration) {
    l.inFlight.Add(-1)
    l.mu.Lock()
    defer l.mu.Unlock()
    l.samples = append(l.samples, latency)
    if time.Since(l.lastAdjust) >= time.Second {
        l.adjust()
    }
}

func (l *AdaptiveConcurrencyLimiter) adjust() {
    sort.Slice(l.samples, func(i, j int) bool { return l.samples[i] < l.samples[j] })
    if len(l.samples) > 0 {
        l.latencyP99 = l.samples[len(l.samples)*99/100]
    }
    if l.latencyP99 > l.targetLatency {
        l.limit = int(float64(l.limit) * 0.9)
    } else {
        l.limit += 1
    }
    if l.limit < 1 {
        l.limit = 1
    }
    l.samples = l.samples[:0]
    l.lastAdjust = time.Now()
}
```

The limit shrinks under latency pressure and grows when the system is healthy. The result is automatic capacity sensing.

### Priorities

Not all requests are equal. A logged-in paying user matters more than an anonymous one. A health check matters more than a regular request.

Tag each request with a priority and drop low-priority first:

```go
const (
    PriorityCritical = iota // health checks, alerts
    PriorityHigh             // paid customers
    PriorityNormal           // regular users
    PriorityLow              // anonymous, batch jobs
)

func (s *PrioritizedShedder) Allow(p int) bool {
    threshold := s.thresholds[p] // higher priority -> higher threshold
    return s.currentLoad() < threshold
}
```

This is the architecture behind Google's "doorman" and many large APIs.

---

## Client-Side Throttling with Jitter

When a client knows it has a rate limit, it should throttle itself rather than wait for the server to deny.

### Client-side rate limiter

```go
type Client struct {
    limiter *rate.Limiter
    http    *http.Client
}

func New(rps float64, burst int) *Client {
    return &Client{
        limiter: rate.NewLimiter(rate.Limit(rps), burst),
        http:    &http.Client{Timeout: 30 * time.Second},
    }
}

func (c *Client) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
    if err := c.limiter.Wait(ctx); err != nil {
        return nil, err
    }
    return c.http.Do(req.WithContext(ctx))
}
```

This pre-throttles client requests. The server may also throttle, but the client tries to stay within its quota.

### Learning the server's limit

If the server returns `X-RateLimit-Limit` headers, the client can dynamically tune its rate.

```go
type LearningClient struct {
    Client
    mu sync.Mutex
}

func (c *LearningClient) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
    if err := c.limiter.Wait(ctx); err != nil {
        return nil, err
    }
    resp, err := c.http.Do(req.WithContext(ctx))
    if err != nil {
        return nil, err
    }
    c.updateLimit(resp.Header)
    return resp, nil
}

func (c *LearningClient) updateLimit(h http.Header) {
    limit := h.Get("X-RateLimit-Limit")
    reset := h.Get("X-RateLimit-Reset")
    if limit == "" || reset == "" {
        return
    }
    l, _ := strconv.Atoi(limit)
    r, _ := strconv.ParseInt(reset, 10, 64)
    until := time.Until(time.Unix(r, 0)).Seconds()
    if until > 0 {
        rps := float64(l) / 3600 // assume hourly; could parse window
        c.mu.Lock()
        c.limiter.SetLimit(rate.Limit(rps))
        c.mu.Unlock()
    }
}
```

The client adapts as the server's policy changes.

### Jittered scheduling

If many clients run the same scheduled job (e.g., "every hour fetch the latest data"), they synchronize and all hit the server at the top of the hour. Add jitter.

```go
func scheduledFetch() {
    base := time.Hour
    jitter := time.Duration(rand.Int63n(int64(time.Minute)))
    for {
        time.Sleep(base + jitter)
        doFetch()
    }
}
```

A few seconds of jitter is usually enough to spread the load.

### Adaptive client-side concurrency

The client maintains a semaphore for in-flight requests. The semaphore size adapts based on observed errors.

```go
type AdaptiveClient struct {
    sema    chan struct{}
    maxSize atomic.Int64
}

func (c *AdaptiveClient) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
    select {
    case c.sema <- struct{}{}:
    case <-ctx.Done():
        return nil, ctx.Err()
    }
    defer func() { <-c.sema }()
    resp, err := c.http.Do(req)
    if err != nil || resp.StatusCode == 429 {
        c.shrink()
    } else {
        c.grow()
    }
    return resp, err
}
```

The actual semaphore size adjustment via the channel buffer requires a non-trivial pattern (you can't resize a channel buffer directly in Go). One approach: use a counting semaphore (a `golang.org/x/sync/semaphore.Weighted`) which supports adjustable capacity.

---

## UI Event Debouncing — End to End

Browsers fire events at very high rates. A keystroke handler runs on every key press; a scroll handler runs on every scroll position update; a resize handler runs continuously while the user drags a window edge. These cannot be processed inline at full rate.

### The frontend pattern

In JavaScript, debouncing is universally implemented:

```javascript
function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

const search = debounce((query) => {
  fetch(`/search?q=${query}`).then(handleResults);
}, 300);

document.getElementById('search').addEventListener('input', e => search(e.target.value));
```

300 ms is a typical debounce delay for search-as-you-type. The trade-off: longer feels laggy; shorter sends more requests.

### Server-side complement

The frontend debounces. The backend should also rate-limit, because:

- A buggy client may bypass debouncing.
- A malicious client may deliberately spam.
- A widely-deployed client may not be updated even when the server's policy changes.

Defense in depth: trust the client to be polite, but enforce on the server.

### Coordinated debouncing

For a multi-step UI (typing in one box, then clicking a button), the debouncer for typing should be flushed when the button is clicked. Otherwise the request from typing fires *after* the button click, possibly overwriting the user's intent.

```javascript
const search = debounce(doSearch, 300);
const button = document.getElementById('submit');
button.addEventListener('click', () => {
  search.flush(); // fire pending debounced search now
  doSubmit();
});
```

A debouncer library with `.flush()` is essential. lodash's debounce supports this.

In Go on the server, our `Debouncer` from the previous document supports `Flush()`.

### Aborting in-flight requests

When the user types fast, you may have an in-flight request from a previous keystroke. The result of that request is now stale — but it may arrive after the response to the new keystroke and clobber the UI.

Solution: abort the previous request when starting a new one.

```javascript
let abortCtrl;
const search = debounce((query) => {
  if (abortCtrl) abortCtrl.abort();
  abortCtrl = new AbortController();
  fetch(`/search?q=${query}`, { signal: abortCtrl.signal })
    .then(handleResults)
    .catch(err => { if (err.name !== 'AbortError') throw err; });
}, 300);
```

`AbortController` is the standard API. The aborted request's promise rejects with an `AbortError`, which we ignore.

On the server, the request's context is canceled when the client closes the connection (Go's `http.Server` propagates this automatically). The handler should respect cancellation:

```go
func searchHandler(w http.ResponseWriter, r *http.Request) {
    rows, err := db.QueryContext(r.Context(), "SELECT ... WHERE ...")
    if err != nil {
        if errors.Is(err, context.Canceled) {
            return // client gave up; we should too
        }
        http.Error(w, err.Error(), 500)
        return
    }
    // ...
}
```

### Last-result-wins

Even with abort, race conditions can leak through. A defensive pattern: tag each request with a sequence number; only render the result if the sequence number is the latest.

```javascript
let lastSeq = 0;
async function search(query) {
  const seq = ++lastSeq;
  const result = await fetch(`/search?q=${query}`).then(r => r.json());
  if (seq === lastSeq) {
    render(result);
  }
}
```

The `seq` check ensures that if request 3 finishes before request 2, we still render only request 3.

This is more robust than abort because it does not rely on the abort actually working (some intermediaries don't cancel requests). It does cost the response data of the older requests — they are fetched but discarded.

---

## Search-as-You-Type

The canonical UI debouncing use case. Let's design it end to end.

### Goals

- The user types `the quick brown fox`. We want one search query (or maybe two — one when they pause after `the quick`, another when they finish).
- The result must appear within 100 ms of the user stopping typing.
- The server must not be overwhelmed by per-keystroke queries.

### Frontend

```javascript
const input = document.getElementById('search');
const results = document.getElementById('results');

let lastSeq = 0;
let abortCtrl;

const search = debounce(async (query) => {
  if (query.length < 2) {
    results.innerHTML = '';
    return;
  }
  if (abortCtrl) abortCtrl.abort();
  abortCtrl = new AbortController();
  const seq = ++lastSeq;
  try {
    const r = await fetch(`/search?q=${encodeURIComponent(query)}`, {
      signal: abortCtrl.signal
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (seq === lastSeq) {
      render(data);
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(err);
    }
  }
}, 200);

input.addEventListener('input', e => search(e.target.value));
```

Key decisions:

- 200 ms debounce. Short enough to feel responsive, long enough to skip intermediate states.
- Minimum query length (2 chars) avoids the "every key on an empty box" pathology.
- Abort the previous request.
- Sequence-number guard against out-of-order responses.

### Backend Go handler

```go
func searchHandler(w http.ResponseWriter, r *http.Request) {
    q := strings.TrimSpace(r.URL.Query().Get("q"))
    if q == "" || len(q) < 2 {
        json.NewEncoder(w).Encode([]struct{}{})
        return
    }
    ctx, cancel := context.WithTimeout(r.Context(), 100*time.Millisecond)
    defer cancel()
    results, err := searchIndex.Query(ctx, q, 20)
    if err != nil {
        if errors.Is(err, context.DeadlineExceeded) {
            // Return partial or empty results rather than 500.
            json.NewEncoder(w).Encode([]struct{}{})
            return
        }
        http.Error(w, "search failed", 500)
        return
    }
    json.NewEncoder(w).Encode(results)
}
```

The handler enforces its own timeout. If the search index is slow, we return empty rather than a 500. This is a degradation choice — the user sees no results, but the system stays responsive.

### Per-user rate limit

A user spamming keystrokes (deliberately or because of stuck keys) should not overwhelm the server.

```go
var userLimiters sync.Map // user_id -> *rate.Limiter

func searchMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        userID := userIDFromCtx(r.Context())
        val, _ := userLimiters.LoadOrStore(userID, rate.NewLimiter(20, 5))
        l := val.(*rate.Limiter)
        if !l.Allow() {
            w.WriteHeader(http.StatusTooManyRequests)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

20 search QPS per user with burst 5. Very forgiving — accommodates fast typing without rate-limiting honest users.

### Index-level throttling

The search backend (Elasticsearch, Algolia, custom index) has its own capacity. If the aggregate query rate exceeds it, the index degrades and all users see slowness.

```go
var indexLimiter = rate.NewLimiter(5000, 1000) // 5000 QPS to the index

func (s *SearchService) Query(ctx context.Context, q string, limit int) ([]Result, error) {
    if !indexLimiter.Allow() {
        return nil, ErrIndexBusy
    }
    return s.realIndex.Query(ctx, q, limit)
}
```

When the index limiter denies, the caller can choose to return empty or to retry briefly. For search-as-you-type returning empty is usually fine — the user will type more and we'll try again.

### Cache layer

A search cache absorbs repeat queries:

```go
type CachedSearch struct {
    cache *lru.Cache[string, []Result]
    real  *SearchService
}

func (c *CachedSearch) Query(ctx context.Context, q string, limit int) ([]Result, error) {
    key := fmt.Sprintf("%s:%d", q, limit)
    if results, ok := c.cache.Get(key); ok {
        return results, nil
    }
    results, err := c.real.Query(ctx, q, limit)
    if err == nil {
        c.cache.Add(key, results)
    }
    return results, err
}
```

For search-as-you-type, the same query (`"the quick "`, ` "the quick b"`, `"the quick br"`) appears in succession. The cache reduces index load dramatically.

### Putting it together

The full stack:

1. Browser: 200 ms debounce, abort previous, sequence guard.
2. Network: cached at CDN/edge (if anonymous), per-user authentication.
3. Server middleware: per-user rate limit, sliding window.
4. Search service: in-process cache (LRU), index rate limit.
5. Index backend: own internal rate limit.

Defense in depth. Any one layer alone is insufficient; together they form a robust system.

---

## Autosave Debouncers

A document editor (Google Docs, Notion, a code editor) autosaves the user's work without explicit save buttons. The naive implementation saves on every keystroke. The right implementation debounces.

### Requirements

- The user types continuously. Don't save on every keystroke — too many writes to the database.
- When the user pauses, save the latest state within 1-2 seconds.
- If the user closes the tab, save immediately before unload.
- Failures must not lose data; retry with backoff.

### A simple implementation

```javascript
const saveButton = document.getElementById('save');
const editor = document.getElementById('editor');

let dirty = false;
let saveTimer;

editor.addEventListener('input', () => {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 1500);
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    save();
    e.preventDefault();
    e.returnValue = '';
  }
});

async function save() {
  if (!dirty) return;
  const content = editor.value;
  try {
    await fetch('/api/save', { method: 'POST', body: content });
    dirty = false;
  } catch (err) {
    console.error('save failed', err);
    saveTimer = setTimeout(save, 5000); // retry
  }
}
```

Key points:

- `dirty` flag tracks whether the document has unsaved changes.
- 1500 ms debounce is comfortable.
- `beforeunload` flushes pending changes.
- Failure schedules a retry.

### Backend autosave handler

```go
func saveHandler(w http.ResponseWriter, r *http.Request) {
    userID := userIDFromCtx(r.Context())
    docID := r.PathValue("doc")
    body, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, "read failed", 400)
        return
    }
    if len(body) > maxDocSize {
        http.Error(w, "too large", 413)
        return
    }
    if err := docStore.Save(r.Context(), userID, docID, body); err != nil {
        http.Error(w, "save failed", 500)
        return
    }
    w.WriteHeader(http.StatusNoContent)
}
```

The handler is straightforward. The interesting part is the per-document rate limit:

```go
type DocLimiter struct {
    perDoc *PerKeyLimiter
}

func (l *DocLimiter) Allow(docID string) bool {
    return l.perDoc.Allow(docID)
}
```

We limit saves per document to (say) 10 per minute. A user editing one document doesn't need more than that; the autosave delay absorbs faster edits.

### Optimistic concurrency

What if two users edit the same document? Last-write-wins loses data.

Solution: optimistic concurrency control. Each save includes a version number; the server rejects if the version is stale.

```go
type SaveRequest struct {
    Content string
    Version int64
}

func (s *DocStore) Save(ctx context.Context, docID string, req SaveRequest) error {
    res, err := s.db.ExecContext(ctx, `
        UPDATE docs SET content = $1, version = version + 1, updated_at = NOW()
        WHERE id = $2 AND version = $3
    `, req.Content, docID, req.Version)
    if err != nil {
        return err
    }
    n, _ := res.RowsAffected()
    if n == 0 {
        return ErrVersionConflict
    }
    return nil
}
```

The client receives 409 Conflict on a version mismatch and must reconcile (typically by reloading and asking the user to redo their changes, or by merging if the editor is collaborative).

### Operational transform / CRDT for real collab

For real-time collaboration (multiple users editing simultaneously), debounced saves are not enough. You need OT or CRDT. That's a separate topic. For this document we'll focus on single-user autosave.

### Resumable saves

Large documents might fail mid-save. Resumable uploads (multipart with offsets) help.

For autosave the simpler approach is: keep a local cache of the document, save on a debounce, and on failure retry with the cached version. The local cache is the source of truth until saved.

---

## Resize, Scroll, Drag Throttling

UI events that fire very rapidly need throttling, not debouncing.

### Resize

The `resize` event fires continuously while the user drags a window edge. Without throttling, every layout calculation runs hundreds of times per second.

```javascript
function throttle(fn, ms) {
  let last = 0;
  let pending;
  return function(...args) {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn.apply(this, args);
    } else if (!pending) {
      pending = setTimeout(() => {
        last = Date.now();
        pending = null;
        fn.apply(this, args);
      }, ms - (now - last));
    }
  };
}

const onResize = throttle(() => {
  recalculateLayout();
}, 100);

window.addEventListener('resize', onResize);
```

Throttle to 10 fires per second (every 100 ms). Layout recalculation is now cheap.

### requestAnimationFrame

For visual updates, `requestAnimationFrame` is the right primitive. It fires at the browser's repaint rate (usually 60 Hz). Use it instead of a fixed throttle.

```javascript
let rafPending = false;
window.addEventListener('scroll', () => {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    updateScrollIndicator();
  });
});
```

Scroll updates that paint are tied to the screen refresh. Any more often is wasted; any less often is visibly choppy.

### Drag

Drag events fire on every pointer move — up to thousands per second on a fast mouse with a high-polling-rate sensor. Throttle or use `requestAnimationFrame`.

```javascript
const dragHandler = throttle((e) => {
  updatePosition(e.clientX, e.clientY);
}, 16); // ~60 fps

element.addEventListener('pointermove', dragHandler);
```

For server-bound drag events (collaborative cursors in a doc editor), throttle to a lower rate (5-10 Hz) to reduce bandwidth.

```javascript
const sendCursor = throttle((x, y) => {
  ws.send(JSON.stringify({ type: 'cursor', x, y }));
}, 100);
```

100 ms is a good balance: visible smoothness for other viewers, manageable bandwidth.

### Server-side burst handling

The server receives bursts of cursor updates. Even with client throttling, multiple clients sum up. Aggregate:

```go
type CursorRouter struct {
    mu      sync.Mutex
    updates map[string]CursorUpdate
    timer   *time.Timer
}

func (r *CursorRouter) Receive(u CursorUpdate) {
    r.mu.Lock()
    r.updates[u.UserID] = u // last-write-wins per user
    if r.timer == nil {
        r.timer = time.AfterFunc(50*time.Millisecond, r.flush)
    }
    r.mu.Unlock()
}

func (r *CursorRouter) flush() {
    r.mu.Lock()
    batch := r.updates
    r.updates = make(map[string]CursorUpdate)
    r.timer = nil
    r.mu.Unlock()
    r.broadcast(batch)
}
```

The router debounces updates from all users into one batch every 50 ms. This is a coalescing debouncer — discussed at length in the senior document.

---

## Log Throttling

When something goes wrong, code often logs the error in a loop. A single error in a hot path can produce thousands of log lines per second. The result: the log shipper falls behind, disk fills, alerts fire for the wrong reason.

### The problem

```go
func process(item Item) {
    if err := externalCall(); err != nil {
        log.Printf("external call failed: %v", err)
        return
    }
    // ...
}
```

If `externalCall` is failing 100% of the time on 1000 items per second, you produce 1000 log lines per second. Each line is ~200 bytes. That's 200 KB/s, or 17 GB/day. Disk fills in hours.

### Solution 1: throttle the logger

```go
type ThrottledLogger struct {
    inner   *log.Logger
    limiter *rate.Limiter
    drops   atomic.Int64
}

func New(inner *log.Logger, rps int) *ThrottledLogger {
    return &ThrottledLogger{
        inner:   inner,
        limiter: rate.NewLimiter(rate.Limit(rps), rps*2),
    }
}

func (l *ThrottledLogger) Printf(format string, args ...interface{}) {
    if l.limiter.Allow() {
        l.inner.Printf(format, args...)
    } else {
        l.drops.Add(1)
    }
}

func (l *ThrottledLogger) Drops() int64 {
    return l.drops.Swap(0)
}
```

Once per second, print a summary of dropped lines:

```go
go func() {
    for range time.Tick(time.Second) {
        if d := logger.Drops(); d > 0 {
            log.Printf("[log throttle] dropped %d lines in last second", d)
        }
    }
}()
```

This keeps the volume bounded while preserving the signal "many errors are happening."

### Solution 2: sample by error type

A more sophisticated approach: log every Nth occurrence of each unique error.

```go
type SampledLogger struct {
    counts sync.Map // error key -> *uint64
    every  uint64
}

func (l *SampledLogger) Errorf(key string, format string, args ...interface{}) {
    v, _ := l.counts.LoadOrStore(key, new(uint64))
    p := v.(*uint64)
    n := atomic.AddUint64(p, 1)
    if n == 1 || n%l.every == 0 {
        log.Printf("[occ %d] "+format, append([]interface{}{n}, args...)...)
    }
}

func process(item Item) {
    if err := externalCall(); err != nil {
        sampledLog.Errorf("external_call_failed", "external call failed: %v", err)
        return
    }
}
```

The first occurrence of each error is logged. Every 100th occurrence after that is logged. The log captures the signal without the noise.

### Solution 3: structured logging with built-in throttling

Modern structured loggers (zerolog, slog, zap) often have built-in sampling.

`zap` example:

```go
import "go.uber.org/zap"
import "go.uber.org/zap/zapcore"

cfg := zap.NewProductionConfig()
cfg.Sampling = &zap.SamplingConfig{
    Initial:    100, // first 100 of any message per second
    Thereafter: 100, // then every 100th
}
logger, _ := cfg.Build()
```

This is configurable and zero-allocation. Use it for production services.

### Solution 4: throttle at the log shipping layer

The application logs everything. The shipper (Fluentd, Logstash, Vector) drops based on volume or pattern.

```yaml
# Vector config
[transforms.throttle_errors]
  type = "throttle"
  inputs = ["app_logs"]
  threshold = 100 # per minute
  key_field = "error_type"
```

The shipper's throttling is downstream; the app pays the cost of producing all the logs. Pro: the app's logging code stays simple. Con: the app's CPU is wasted producing logs that will be dropped.

A hybrid: throttle in the app (cheap, bounds CPU); throttle again in the shipper (defense in depth).

### Critical errors should never be throttled

Some errors must always be logged: data corruption, security violations, panic recovery. Mark them and bypass the throttler.

```go
type Logger struct {
    base    Logger
    throttled Logger
}

func (l *Logger) Error(msg string) {
    l.throttled.Print(msg)
}

func (l *Logger) Critical(msg string) {
    l.base.Print(msg) // always log
}
```

A balance between safety and resource usage.

### Sentry/Bugsnag/error trackers

External error trackers have their own rate limits. If you send too many events, they drop or throttle on their end.

Pre-throttle on your side: dedupe identical errors, send a summary instead of every occurrence.

```go
type ErrorTracker struct {
    inner    *sentry.Client
    seen     *lru.Cache[string, int]
    flush    time.Duration
}

func (t *ErrorTracker) Capture(err error) {
    key := fingerprint(err)
    count, _ := t.seen.Get(key)
    t.seen.Add(key, count+1)
    if count == 0 || count%100 == 0 {
        t.inner.CaptureException(err)
    }
}
```

100 distinct errors fire 100 times in the tracker; the 10001th of any one fires once more.

---

## Metric Throttling and Aggregation

Metrics, like logs, can flood. Prometheus, StatsD, Datadog all have limits on cardinality, ingestion rate, and storage.

### Counter aggregation

A Prometheus counter is increment-only. Many increments per second don't need to flush individually:

```go
var requestsCounter = prometheus.NewCounterVec(
    prometheus.CounterOpts{Name: "requests_total"},
    []string{"endpoint", "status"},
)

func handler(w http.ResponseWriter, r *http.Request) {
    defer requestsCounter.With(prometheus.Labels{
        "endpoint": r.URL.Path,
        "status":   "200",
    }).Inc()
}
```

Prometheus scrapes counters periodically. The "rate" is computed on read. There's no per-increment cost beyond a counter increment.

But: high-cardinality labels (endpoint = `/users/U123/posts/P456`) blow up cardinality. A few thousand combinations is OK; a few million is not.

### Cardinality control

- Don't use dynamic IDs in labels.
- Bucket continuous values (latency, size) into ranges.
- Use templated paths (`/users/:id/posts/:id`) not raw paths.

```go
func endpoint(r *http.Request) string {
    return router.PathTemplate(r) // "/users/:id/posts/:id"
}
```

### Histograms and summaries

Histograms bucket observations. Cardinality is `labels * buckets`. Be conservative:

```go
var latencyHist = prometheus.NewHistogramVec(
    prometheus.HistogramOpts{
        Name: "request_duration_seconds",
        Buckets: []float64{0.001, 0.01, 0.1, 1.0, 10.0},
    },
    []string{"endpoint"},
)
```

5 buckets, 50 endpoints = 250 series. Manageable.

### Custom aggregation

For very high-rate metrics (per-message events in a streaming pipeline), aggregate before exposing.

```go
type AggregatedMetric struct {
    striped *Counter
    gauge   prometheus.Gauge
}

func (m *AggregatedMetric) Inc() {
    m.striped.Add(1)
}

func (m *AggregatedMetric) Flush() {
    val := m.striped.Reset()
    m.gauge.Set(float64(val))
}
```

The striped counter (from the senior document) absorbs the writes; the flush exposes a periodic gauge.

### Sampling for traces

Distributed tracing produces a span for every request. At 10k RPS, that's 10k spans per second. Most trace backends rate-limit ingestion.

Sample: keep a fraction of traces (e.g., 1%).

```go
import "go.opentelemetry.io/otel/sdk/trace"

tp := trace.NewTracerProvider(
    trace.WithSampler(trace.TraceIDRatioBased(0.01)),
    // ...
)
```

Adaptive sampling keeps all error traces but samples successes:

```go
type ErrorAwareSampler struct {
    success trace.Sampler
}

func (s *ErrorAwareSampler) ShouldSample(p trace.SamplingParameters) trace.SamplingResult {
    if hasError(p.Attributes) {
        return trace.SamplingResult{Decision: trace.RecordAndSample}
    }
    return s.success.ShouldSample(p)
}
```

This is "tail-based sampling" if applied after the trace completes. The pattern keeps signal (errors) and drops noise (successful identical traces).

---

## Alert Throttling

An alert that fires every minute when a problem persists is noise. The on-call engineer mutes it, then misses the next real one.

### De-duplication

Alertmanager (the Prometheus companion) groups alerts by labels and de-duplicates.

```yaml
group_by: ['alertname', 'service', 'severity']
group_wait: 30s
group_interval: 5m
repeat_interval: 4h
```

- `group_wait`: wait 30s after the first alert to gather related ones.
- `group_interval`: send updates every 5m as new alerts join the group.
- `repeat_interval`: resend a still-firing alert every 4h.

### Inhibition

If service X is down and that's the root cause for service Y also being unhealthy, inhibit Y's alert until X is resolved.

```yaml
inhibit_rules:
- source_match:
    severity: 'critical'
    alertname: 'ServiceDown'
  target_match:
    alertname: 'HighErrorRate'
  equal: ['service']
```

This expresses "if the same service has a critical down alert, suppress its error-rate alert."

### Maintenance windows

Scheduled maintenance produces expected outages. Silence alerts in advance.

Alertmanager supports silences via API or UI. Integrate with your maintenance scheduler.

### On-call rate limits

Even after deduplication, an on-call engineer can be overwhelmed. PagerDuty-style services support escalation policies, automatic delegation, and a hard limit on simultaneous active incidents.

The principle: design alerts so that the rate of high-severity alerts per shift is bounded (e.g., < 5 per night for a typical shift). If it exceeds, the alerting policy is broken — too many false positives, too many cascading symptoms, not enough deduplication.

### Alert fatigue

The biggest cost of unthrottled alerts is fatigue. After enough false positives, engineers stop reading alerts. Real outages get missed.

Audit alerts quarterly. For each alert, ask:
- Is it actionable? (does the engineer know what to do?)
- Is it specific? (does it indicate one problem?)
- Is it rare? (does it fire only when something is actually wrong?)

If any answer is no, change the alert.

---

## Email and Push Notification Throttling

Notifications to users (email, push, SMS) are the most user-visible form of throttling. Get it wrong and users hate your service.

### Per-user notification rate

A user should not get 100 emails in an hour from your service. Cap per-user notifications.

```go
type NotificationLimiter struct {
    perUser *PerKeyLimiter
}

func (l *NotificationLimiter) Allow(userID, channel string) bool {
    key := userID + ":" + channel
    return l.perUser.Allow(key)
}
```

Limits:

- Email: 10/hour, 50/day.
- Push: 20/hour, 100/day.
- SMS: 5/hour, 20/day (SMS is expensive and intrusive).

### Aggregation

Instead of one email per event, send a digest.

```go
type Digest struct {
    Pending []Event
    Timer   *time.Timer
    Send    func([]Event)
}

func (d *Digest) Add(e Event) {
    d.Pending = append(d.Pending, e)
    if d.Timer == nil {
        d.Timer = time.AfterFunc(15*time.Minute, d.flush)
    }
}

func (d *Digest) flush() {
    events := d.Pending
    d.Pending = nil
    d.Timer = nil
    d.Send(events)
}
```

15 minutes is a reasonable digest window. Long enough to coalesce, short enough that important events arrive promptly.

### User preferences

Users want different cadences. Some want immediate, some want daily, some want weekly. Respect preferences:

```go
type UserPrefs struct {
    EmailCadence string // "immediate", "hourly", "daily", "weekly", "never"
}

func notify(user User, event Event) {
    prefs := user.Prefs
    switch prefs.EmailCadence {
    case "immediate":
        sendNow(user, event)
    case "hourly", "daily", "weekly":
        digest.Add(user.ID, event, prefs.EmailCadence)
    case "never":
        // skip
    }
}
```

### Quiet hours

Don't push at 3 AM (the user's local time, not your server's).

```go
func canSendPush(user User) bool {
    local := time.Now().In(user.Timezone)
    hour := local.Hour()
    return hour >= 8 && hour < 22
}
```

For critical alerts (security, fraud) override quiet hours. For marketing, never.

### Unsubscribe semantics

Every notification must include an unsubscribe path. After unsubscribe, never send again (unless the user re-enrolls).

```go
func ensureNotUnsubscribed(userID string, channel string) error {
    if unsubscribed.Contains(userID, channel) {
        return ErrUnsubscribed
    }
    return nil
}
```

CAN-SPAM, GDPR, and other regulations make unsubscribe legally required. Implement it carefully.

### Bounce handling

Email providers blacklist senders who send to many invalid addresses. Process bounces and remove invalid addresses.

```go
func handleBounce(addr string, kind BounceKind) {
    switch kind {
    case BouncePermanent:
        unsubscribed.Add(addr, "email")
    case BounceTransient:
        retryLater(addr)
    }
}
```

---

## Backpressure as Throttling

Backpressure is the throttling that happens implicitly when downstream slows down upstream.

### TCP backpressure

A slow consumer that doesn't read its socket eventually fills the kernel's receive buffer. The TCP window advertised back to the sender shrinks. The sender stops sending. Backpressure is achieved at the kernel level.

This works for socket-bound applications but doesn't help when the slowness is in the application layer.

### Channel backpressure in Go

A bounded channel blocks the sender when full.

```go
work := make(chan Job, 100)

// Producer
for _, j := range jobs {
    work <- j // blocks when 100 jobs are buffered
}

// Consumer
for j := range work {
    process(j)
}
```

The buffer size is the throttle. The producer is naturally rate-limited to the consumer's pace.

### Select with timeout for non-blocking backpressure

Sometimes you want to know when the channel is full rather than block.

```go
select {
case work <- j:
    // submitted
case <-time.After(time.Second):
    // queue full, drop
    metrics.Drop.Inc()
}
```

Or use a default branch for non-blocking:

```go
select {
case work <- j:
case default:
    // queue full, drop immediately
}
```

### Backpressure across services

Between services, backpressure is more complex. HTTP is request/response; the request side can't "block" the sender.

Approaches:

- **Bounded connection pool**: caller has limited concurrent connections; further calls block.
- **Bounded retry queue**: caller buffers retries; queue full means drop.
- **Server returns 503/429**: caller backs off based on the response.

```go
type BackpressuredClient struct {
    sem  chan struct{} // semaphore for concurrency
    http *http.Client
}

func New(maxConcurrent int) *BackpressuredClient {
    return &BackpressuredClient{
        sem:  make(chan struct{}, maxConcurrent),
        http: &http.Client{},
    }
}

func (c *BackpressuredClient) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
    select {
    case c.sem <- struct{}{}:
    case <-ctx.Done():
        return nil, ctx.Err()
    }
    defer func() { <-c.sem }()
    return c.http.Do(req)
}
```

When the semaphore is full, callers wait. The client is implicitly rate-limited to `maxConcurrent` in-flight requests times the average response time.

### Queue depth as a signal

Monitor queue depth. A growing queue is a sign of insufficient consumer throughput.

```go
type MonitoredQueue struct {
    inner  chan Job
    depth  prometheus.Gauge
}

func (q *MonitoredQueue) Submit(j Job) {
    q.depth.Set(float64(len(q.inner)))
    q.inner <- j
}
```

Alert if depth stays above a threshold. The alert fires before the queue fills entirely.

---

## Integrating with Circuit Breakers

A circuit breaker complements a rate limiter. The limiter caps the rate; the breaker stops requests when the downstream is unhealthy.

### Layering

```
[caller] -> [circuit breaker] -> [rate limiter] -> [downstream]
```

The breaker is the cheaper check; put it first. If the breaker is open, no rate limit is consumed.

### A combined limiter

```go
type Protected struct {
    breaker *Breaker
    limiter *rate.Limiter
}

func (p *Protected) Call(ctx context.Context, fn func() error) error {
    if !p.breaker.Allow() {
        return ErrCircuitOpen
    }
    if err := p.limiter.Wait(ctx); err != nil {
        return err
    }
    err := fn()
    if err != nil {
        p.breaker.RecordFailure()
    } else {
        p.breaker.RecordSuccess()
    }
    return err
}
```

When the breaker opens, the limiter is not consumed. When the limiter denies, the breaker doesn't see a failure (because no call was made).

### Subtle interaction: limit vs breaker for retries

A retry after a circuit-open should not count against the rate limit. A retry after a server 5xx should.

This is hard to get right. The pragmatic approach: have separate limiters for retries vs initial requests. A retry budget per minute is independent of the regular rate limit.

### Half-open probing

A breaker in half-open state lets one request through to probe the downstream. That probe must succeed before the breaker closes.

If the probe is denied by the rate limiter, the breaker stays half-open indefinitely. Bad.

Fix: in half-open state, bypass the rate limiter for the probe.

```go
func (p *Protected) Call(ctx context.Context, fn func() error) error {
    state := p.breaker.State()
    if state == StateOpen {
        return ErrCircuitOpen
    }
    if state == StateClosed {
        if err := p.limiter.Wait(ctx); err != nil {
            return err
        }
    }
    // Half-open: skip the limiter, send the probe.
    err := fn()
    if err != nil {
        p.breaker.RecordFailure()
    } else {
        p.breaker.RecordSuccess()
    }
    return err
}
```

### Coordinated configuration

The circuit breaker and rate limiter should share configuration so they don't contradict.

```yaml
downstream:
  rate: 1000 # RPS
  burst: 2000
  circuit_breaker:
    failure_threshold: 0.5
    open_duration: 30s
    half_open_probes: 1
```

A breaker that opens easily while the limiter admits a flood of requests means we fail rapidly. A breaker that's too conservative when the limiter is generous means we never use the available rate.

---

## Integrating with Retry Policies

Retries amplify load. A request that fails and is retried 3 times adds 3x the load. A rate limiter must account for retries.

### Retry budgets

Cap the total retry rate as a fraction of original requests.

```go
type BudgetedRetryClient struct {
    inner   *http.Client
    initial *rate.Limiter
    retries *rate.Limiter
}

func New(rps, retryRPS float64) *BudgetedRetryClient {
    return &BudgetedRetryClient{
        inner:   &http.Client{},
        initial: rate.NewLimiter(rate.Limit(rps), int(rps)),
        retries: rate.NewLimiter(rate.Limit(retryRPS), int(retryRPS)),
    }
}

func (c *BudgetedRetryClient) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
    if err := c.initial.Wait(ctx); err != nil {
        return nil, err
    }
    resp, err := c.inner.Do(req)
    if err == nil && resp.StatusCode < 500 {
        return resp, nil
    }
    // Retry: needs budget.
    if !c.retries.Allow() {
        return resp, err // give up
    }
    return c.inner.Do(req.Clone(ctx))
}
```

If `retryRPS = rps * 0.1`, retries can be at most 10% of the request rate. A storm of failures can't multiply requests by 10x.

This is the pattern in Envoy, Istio, and Linkerd's retry budget feature.

### Exponential backoff with cap

```go
func backoff(attempt int, base, max time.Duration) time.Duration {
    d := base * time.Duration(1<<attempt)
    if d > max {
        d = max
    }
    // Full jitter.
    return time.Duration(rand.Int63n(int64(d)))
}
```

The cap prevents unbounded waits. The jitter prevents synchronization.

### Don't retry non-idempotent

POST requests that create resources should not be retried automatically. The retry might create a duplicate.

Use `Idempotency-Key` headers (discussed earlier) to make POSTs safely retryable. Without one, retry only on network errors before the request was sent, not on response errors.

```go
func isRetryable(method string, err error, resp *http.Response) bool {
    if err != nil {
        return method == "GET" || method == "HEAD" || method == "OPTIONS"
    }
    if resp.StatusCode == 429 || resp.StatusCode == 503 {
        return true
    }
    if resp.StatusCode >= 500 && method != "POST" && method != "PATCH" && method != "DELETE" {
        return true
    }
    return false
}
```

### Retry storm prevention

If a downstream is down, all clients retry. The downstream gets hit by retries from every client. When it recovers, it's immediately overwhelmed.

Mitigation:

- Retry budget (cap total retries per minute).
- Circuit breaker (stop retrying when most are failing).
- Exponential backoff with jitter.
- Server-side rate limit on retries (count retry-tagged requests separately).

The combination prevents the retry storm. Each piece alone is insufficient.

---

## Service Mesh Rate Limiters

In Kubernetes, a service mesh (Istio, Linkerd) provides rate limiting at the sidecar.

### Envoy rate limit

Envoy supports two kinds of rate limiting:

1. **Local**: in-sidecar, fast, per-instance.
2. **Global**: external service (RLS), shared across all instances.

Local config:

```yaml
filters:
- name: envoy.filters.http.local_ratelimit
  config:
    stat_prefix: http_local_rate_limiter
    token_bucket:
      max_tokens: 10000
      tokens_per_fill: 1000
      fill_interval: 1s
```

This is a per-pod rate limiter. 10k burst, 1k RPS. Fast, no external dependencies.

### Global rate limit

For cluster-wide enforcement, route to a rate-limit service:

```yaml
filters:
- name: envoy.filters.http.ratelimit
  config:
    domain: api
    rate_limit_service:
      grpc_service:
        envoy_grpc:
          cluster_name: ratelimit_service
```

The RLS receives the request descriptor (e.g., `[user_id: U123]`), looks up the limit, and returns OK or DENY.

Domain `api` matches a config file:

```yaml
domain: api
descriptors:
  - key: user_id
    rate_limit:
      unit: hour
      requests_per_unit: 1000
```

### Combining local and global

A common pattern: local for raw DDoS protection, global for per-user limits.

```yaml
filters:
- name: envoy.filters.http.local_ratelimit
  # ... 100k RPS per pod (DDoS protection)
- name: envoy.filters.http.ratelimit
  # ... per-user via RLS
```

The local layer absorbs huge bursts cheaply. The global layer enforces precise per-user limits.

### Istio EnvoyFilter

In Istio, you configure these via `EnvoyFilter`:

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: filter-local-ratelimit-svc
  namespace: istio-system
spec:
  configPatches:
    - applyTo: HTTP_FILTER
      match:
        context: SIDECAR_INBOUND
      patch:
        operation: INSERT_BEFORE
        value:
          name: envoy.filters.http.local_ratelimit
          typed_config:
            "@type": type.googleapis.com/udpa.type.v1.TypedStruct
            value:
              stat_prefix: http_local_rate_limiter
              token_bucket:
                max_tokens: 10000
                tokens_per_fill: 1000
                fill_interval: 1s
```

The configuration is verbose. Istio's higher-level abstractions help.

### Service mesh rate limit caveats

- Latency: every request adds a small overhead. Local RL is <1 ms; global RL is 1-5 ms.
- Availability: if the RLS is down, requests are admitted (fail-open) or denied (fail-closed) depending on configuration.
- Observability: built-in metrics for admitted/denied counts.
- Cardinality: lots of unique descriptors blow up RLS state. Be conservative.

---

## Edge Rate Limiting (CDN/WAF)

The first line of defense is at the edge: Cloudflare, AWS CloudFront, Fastly, Akamai. These can rate-limit before the request even reaches your infrastructure.

### Cloudflare rate limiting

```
(http.request.uri.path matches "/api/.*") and (rate(1m) > 100)
```

The Cloudflare rule expression matches paths and triggers when the rate exceeds the threshold. The action: block, challenge (CAPTCHA), or log.

### AWS WAF rate-based rules

```json
{
  "Name": "RateLimitRule",
  "Priority": 1,
  "Action": {"Block": {}},
  "Statement": {
    "RateBasedStatement": {
      "Limit": 5000,
      "AggregateKeyType": "IP"
    }
  }
}
```

WAF rules are evaluated at the AWS edge before reaching your VPC. The cost: $0.60 per million WAF requests, plus rule evaluation.

### Why edge first

Edge rate limiting:

- Blocks DDoS before it consumes your bandwidth.
- Has nearly unlimited capacity (the CDN's infrastructure).
- Is geographically distributed (per-edge enforcement).
- Doesn't consume your application capacity.

The cost:

- Less context (can't easily key by authenticated user).
- Less precise (per-IP, not per-user).
- Less observable (CDN logs lag).
- May charge per request.

The right architecture combines: edge for crude DDoS protection, app for per-user precision.

### Bot management

WAFs and CDNs offer bot management: detecting scrapers, bots, scripts. They serve CAPTCHAs or block based on fingerprints.

This is a different layer of throttling but related. A bot management product is essentially a rate-limit-plus-classification system.

### Geo-based limiting

Block or rate-limit traffic from specific regions:

```
(ip.geoip.country in {"CN" "RU"}) and (rate(1m) > 10)
```

Useful when traffic from a region is overwhelmingly malicious. Controversial — also blocks legitimate users.

---

## Observability Dashboards

A rate limiter's behavior must be visible. Build dashboards.

### Essential panels

1. **Admitted vs denied** (count over time, stacked area chart).
2. **Top denied keys** (table, top 10 by deny count).
3. **Wait time distribution** (heatmap or percentile lines).
4. **Bucket levels** (gauge for global limiter; histogram for per-key).
5. **Error rate** (limiter errors, e.g., Redis timeouts).
6. **Capacity utilization** (admitted / limit).

### Example Grafana queries

```promql
# Admit rate
sum(rate(ratelimiter_allowed_total[5m])) by (limiter)

# Deny rate
sum(rate(ratelimiter_denied_total[5m])) by (limiter, reason)

# p99 wait time
histogram_quantile(0.99, sum(rate(ratelimiter_wait_seconds_bucket[5m])) by (le, limiter))

# Top denied keys (if cardinality is bounded)
topk(10, sum(rate(ratelimiter_denied_total[5m])) by (limiter, key))
```

### Alerts

- Sustained deny rate > 10% for 5 minutes: probable misconfiguration or attack.
- Wait time p99 > 1 second: limiter is heavily congested.
- Limiter errors > 0: Redis or backing store has issues.
- Admit rate suddenly drops by 50%: upstream is broken.

```yaml
groups:
- name: ratelimiter
  rules:
  - alert: HighDenialRate
    expr: |
      sum(rate(ratelimiter_denied_total[5m])) by (limiter)
      /
      sum(rate(ratelimiter_allowed_total[5m]) + rate(ratelimiter_denied_total[5m])) by (limiter)
      > 0.1
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "Rate limiter {{ $labels.limiter }} denying > 10%"
```

### Dashboards for capacity planning

Track over weeks/months:

- Admitted rate p99 (the actual peak load).
- Denied rate (latent demand).
- Ratio: are you sized for the load?

A persistently high denied rate suggests the limit is too tight. A consistently low utilization suggests the limit is unnecessarily generous (or unused).

### Trace correlations

When a request is rate-limited, the trace should show it. Add a span event with the limiter name and decision.

```go
span := trace.SpanFromContext(ctx)
span.AddEvent("rate_limit", trace.WithAttributes(
    attribute.String("limiter", "search_per_user"),
    attribute.Bool("allowed", false),
    attribute.String("key", userID),
))
```

In the trace viewer, you can filter for rate-limited requests and see the full request context.

---

## Postmortem 1: The Cascading Login Storm

### Setting

A SaaS product with 10 million users. Authentication is handled by a single auth service backed by PostgreSQL.

### Timeline

- 09:00: PostgreSQL primary fails over to replica. Brief 10-second downtime.
- 09:00:10: All in-flight login requests fail with 503.
- 09:00:11: Mobile clients begin aggressive retries (no exponential backoff in the SDK).
- 09:00:30: PostgreSQL recovers. Auth service receives ~50,000 RPS of retries from 5 million simultaneous mobile sessions.
- 09:00:35: Auth service's connection pool exhausted. New logins fail.
- 09:01:00: Auth service crashes from OOM (too many concurrent goroutines).
- 09:01:30: Auth service restarted; immediately overwhelmed again.
- 09:30: After ~30 minutes of full outage, on-call manually rate-limits at the LB.
- 09:45: Stable. Users gradually log in.

### Root causes

1. Mobile SDK retried with no backoff.
2. Auth service had no rate limit.
3. The 50k RPS was 10x normal peak; no headroom.
4. Auth service was a single point of failure (no per-region partitioning).

### Lessons

1. **All clients must have exponential backoff with jitter**. The mobile SDK was patched. Long-term: an industry-standard library.
2. **All endpoints must have rate limits**. A per-IP limit on auth endpoints, plus a global cap, was added. Set to 2x normal peak.
3. **The thundering herd problem is real**. Even small outages cause storms. Plan for them.
4. **Retry budgets**. The auth service began rejecting requests with `Retry-After: 60` when overloaded, signaling clients to back off.

### Action items

```
[x] Add per-IP rate limit on /auth/* (100 RPS per IP).
[x] Add global rate limit on /auth/login (50k RPS, 30s burst).
[x] Mobile SDK: exponential backoff with 100ms initial, 30s max, full jitter.
[x] Auth service: graceful degradation — return 429 with Retry-After when overloaded.
[x] Auth service: connection pool sized for 2x normal peak.
[x] Postmortem-driven runbook for "auth storm" scenarios.
```

### Aftermath

A similar PG failover three months later was a non-event. Auth service stayed healthy throughout. The mitigations worked.

---

## Postmortem 2: The Debouncer That Never Fired

### Setting

A search service with a Lucene-based search index. Every document change triggers a reindex. Changes are debounced to coalesce burst updates from bulk imports.

### Timeline

- 14:00: User imports a 100k-row spreadsheet. The import generates 100k change events over 5 minutes.
- 14:05: Import complete. The debouncer was supposed to fire 1 second after the last event.
- 14:10: Engineer notices search results are stale. The reindex never ran.
- 14:30: Investigation begins.
- 15:00: Discovered: the debouncer's timer is `time.AfterFunc`, but on every event we called `timer.Reset` without checking the return value. In Go 1.18 there's a race where Reset on a fired timer can produce undefined behavior.
- 15:30: Restart the search service. The next change triggers a normal reindex.

### Root cause

A subtle bug:

```go
func (d *Debouncer) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.timer == nil {
        d.timer = time.AfterFunc(d.delay, d.fire)
    } else {
        d.timer.Reset(d.delay)
    }
}
```

The `Reset` on a fired but un-drained timer leaves the timer in a state where the next fire might not happen. Under high event rates, the timer ends up "stuck."

### Fix

```go
func (d *Debouncer) Trigger() {
    d.mu.Lock()
    defer d.mu.Unlock()
    if d.timer != nil {
        d.timer.Stop()
    }
    d.timer = time.AfterFunc(d.delay, d.fire)
}
```

Always Stop before AfterFunc. Or, in Go 1.23+, rely on the simpler semantics.

### Lessons

1. **Read the documentation for `time.Timer`**. The race is documented.
2. **Test the debouncer at high event rates**. The bug doesn't reproduce at 1 event per second.
3. **Add a "max wait" to the debouncer**. Even if the timer is stuck, the max-wait timer would fire.
4. **Monitor debouncer fires**. A debouncer that hasn't fired in a long time despite trigger events is a red flag.

### Action items

```
[x] Audit all uses of time.Timer.Reset in the codebase.
[x] Migrate to a Debouncer library with max-wait support.
[x] Add a Prometheus counter for debouncer fires.
[x] Alert if no fires in 10 minutes despite triggers.
[x] Upgrade to Go 1.23 (when stable) for safer timer semantics.
```

---

## Postmortem 3: The Misconfigured 429

### Setting

A B2B API serving 5000 enterprise customers. The rate limit per customer is 100 RPS. Customers integrate via various SDKs and libraries.

### Timeline

- Monday 08:00: A customer's batch job starts. It sends 100 RPS sustained, which is exactly the limit.
- Monday 08:05: Customer's job starts seeing 429s. Their retry logic kicks in.
- Monday 08:10: The retries push them over the limit. More 429s. More retries.
- Monday 08:30: Customer's job is in a tight retry loop, sending 10x the original rate. Most are 429.
- Monday 09:00: Customer support ticket. Customer reports "your API is broken."
- Monday 09:15: Engineering looks at logs. The customer was sending 1000 RPS due to retries.

### Root cause

The API returned 429 with `Retry-After: 1`. The customer's SDK interpreted this as "retry in 1 second" and retried *immediately* a second later — which was also denied. The retry hit the same window.

The intended behavior was for clients to retry a few seconds later, but with 1-second `Retry-After` and no jitter on the client, retries clustered immediately and all got denied.

Compounding: the customer's retry budget was unlimited. The SDK retried indefinitely.

### Fix

Server-side:

- Increase `Retry-After` to a more meaningful value. For a 100 RPS limit with a 1-minute sliding window, suggest `Retry-After: 30` or so.
- Include `X-RateLimit-Reset` so the client knows when the window actually resets.

Client SDK side:

- Add jitter to retry-after waits.
- Cap total retry attempts.
- Track and surface "you're being rate-limited" to the user.

### Lessons

1. **`Retry-After: 1` is rarely the right answer**. Suggest a wait that gives the bucket time to refill enough for the request.
2. **Test client behavior under rate-limit**. Many SDKs don't handle 429 correctly.
3. **Document the precise expected client behavior**.

### Action items

```
[x] Server: return Retry-After in seconds equal to time until 50% of the limit is available.
[x] Server: include X-RateLimit-Reset on all 429s.
[x] Update API documentation with explicit "how to handle 429" guidance.
[x] Customer's SDK: add jitter to retry-after.
[x] Internal SDK: cap retry attempts at 5.
```

---

## Postmortem 4: Log Storm Fills the Disk

### Setting

A microservice fleet with shared NAS for logs. Each instance writes to its own file; logs are tailed by a shipper to a central system.

### Timeline

- 03:00: A downstream API (a third-party payments provider) becomes unreachable.
- 03:01: Payment retry logic in our service starts logging `[ERROR] payment failed: connection refused` at 50 RPS per instance.
- 03:15: 15 instances × 50 logs/sec × 200 bytes = 150 KB/s. Times 15 minutes = ~135 MB so far.
- 04:00: 1 GB of logs.
- 05:00: 2 GB. Log shipper falls behind.
- 06:00: NAS fill alert at 80%. Engineer paged.
- 06:30: NAS at 95%. Service writes start failing. Cascading outage.

### Root cause

The error path logged every failure. The payment provider was down for 4 hours. We produced 4 hours × 15 instances × 50 RPS = 10.8 million log lines, mostly identical.

The log shipper couldn't keep up. Logs accumulated on local disk (the NAS), filling it.

### Fix

Add log throttling:

```go
var logLimiter = rate.NewLimiter(1, 10) // 1 log/sec, burst 10

func processPayment(...) {
    if err := callPayment(); err != nil {
        if logLimiter.Allow() {
            log.Printf("payment failed: %v", err)
        }
        return err
    }
}
```

Now we log at most 1 per second per instance, with a burst of 10. The signal "many payments are failing" is preserved (we can see it from the throttled rate); the noise is gone.

### Better fix: structured logging with sampling

Use a structured logger (zap) with built-in sampling:

```go
cfg := zap.NewProductionConfig()
cfg.Sampling = &zap.SamplingConfig{
    Initial:    100,
    Thereafter: 100,
}
```

First 100 of any message per second, then every 100th. The first incident-second is fully captured; long-running incidents are sampled.

### Lessons

1. **Logs are not free**. Every log line costs CPU, disk, and shipping bandwidth.
2. **Errors in tight loops produce log storms**. Always rate-limit error logging.
3. **Disk-fill alerts must include log volume diagnostics**. The shipper status, the largest files, the slowest consumers.
4. **Critical errors should bypass sampling**. Mark them explicitly.

### Action items

```
[x] All error log lines throttled by default (1/sec with burst of 10).
[x] Migrate from log package to zap with sampling config.
[x] Disk-fill alert at 70% (was 80%, too late).
[x] Log shipper backpressure: if shipper falls behind, signal apps to throttle harder.
[x] Postmortem-driven runbook for "log storm" scenarios.
```

---

## Postmortem 5: The Limiter That Lied

### Setting

A distributed service with 50 instances. Each instance had a local `rate.Limiter(100, 100)` on the assumption that traffic would be evenly distributed.

### Timeline

- A new feature rolled out increased traffic to one specific endpoint.
- Traffic to that endpoint was sticky to a few sessions (long-lived WebSocket connections handled at the gateway).
- 80% of the traffic landed on 5 of the 50 instances.
- Those 5 instances saw 16x normal traffic. Their local limiter denied many requests.
- Customers reported intermittent failures.
- Engineers checked the per-instance limiter: "100 RPS, looks fine."
- Engineers checked the LB: "traffic per instance looks balanced from the LB's view (each instance gets the same RPS from the LB)."
- But the LB was balancing connections, not requests. A single sticky WebSocket on instance A handled 10,000 RPS; a WebSocket on instance B handled 100.
- The local limiter said "all good" on a 10,000-RPS instance because each individual rate.Limiter call admitted (the limit was per-instance, but the traffic mix was wrong).

Wait, actually rereading: the limiter denied because the traffic was 16x. Let me restate:

- The local limiter on the hot instances was sized for 100 RPS but seeing 1600 RPS. It denied 90% of requests on those instances.
- Customer traffic stuck to those instances saw 90% failure rate.
- Customer traffic stuck to cold instances saw 0% failure rate.

### Root cause

The local limiter was sized for the per-instance share of a globally even distribution. The distribution was not even because of WebSocket stickiness.

### Fix

Two options:

1. **Distributed rate limiter**: use Redis to enforce a global limit. Every instance shares the budget.
2. **Per-customer limiter**: don't rely on per-instance fairness; limit per customer regardless of which instance handles them.

The team chose option 2. Per-customer limit with Redis:

```go
type PerCustomerLimiter struct {
    redis *redis.Client
}

func (l *PerCustomerLimiter) Allow(ctx context.Context, customerID string) bool {
    // Lua script for token bucket
    // ...
}
```

Each customer had a fair budget regardless of stickiness.

### Lessons

1. **Local limiters assume even distribution**. Check that assumption.
2. **Traffic to instances is not always balanced**. Stickiness, region affinity, hot keys.
3. **Per-key (per-customer, per-tenant) limits are usually safer than per-instance**.
4. **Observability must include per-instance load distribution**, not just per-instance metrics.

### Action items

```
[x] Migrate to per-customer rate limiter (Redis-backed).
[x] Dashboard: per-instance load (RPS, p99 latency) with anomaly detection.
[x] Audit all per-instance limits: are they assumption-compatible with actual traffic?
[x] Document the gateway's stickiness behavior so engineers know.
```

---

## Common Anti-Patterns

A compilation of mistakes seen across many systems.

### Anti-pattern 1: limiter created per-request

```go
func handler(w http.ResponseWriter, r *http.Request) {
    limiter := rate.NewLimiter(100, 100) // new every request!
    if limiter.Allow() {
        // ...
    }
}
```

A new limiter starts full. It never denies the first 100 requests. Effectively no limit.

Fix: create the limiter once, reuse.

### Anti-pattern 2: log without throttling in error paths

```go
for {
    if err := tryConnect(); err != nil {
        log.Printf("connection failed: %v", err)
        continue
    }
}
```

If connection always fails, the loop spins, the log floods.

Fix: rate-limit the log or back off the loop.

### Anti-pattern 3: ignoring `Reserve`'s return

```go
r := limiter.Reserve()
time.Sleep(r.Delay()) // ignored if r.OK() == false
```

`Reserve` can return not-OK if the request is impossible (e.g., n > burst). Always check.

### Anti-pattern 4: `Retry-After: 0`

Tells the client to retry immediately. Probably also denied. Infinite loop.

Fix: always at least 1 second; ideally several seconds with jitter.

### Anti-pattern 5: rate-limit the OPTIONS preflight

Browsers send OPTIONS for CORS preflight. If they're rate-limited, the real request is never sent. The user sees a CORS error that's actually a rate-limit.

Fix: skip OPTIONS from rate-limiting, or have a much more generous limit on it.

### Anti-pattern 6: per-IP limit behind a NAT

A corporate NAT means many users share one IP. A per-IP limit collectively penalizes them.

Fix: prefer per-user (authenticated) limits. Per-IP only as a fallback for anonymous traffic.

### Anti-pattern 7: limiter without metrics

You can't tune what you can't see. Always export allowed/denied counters.

### Anti-pattern 8: limiter with metrics but no alerts

Metrics without alerts are passive. Set thresholds for "limiter is denying > 10% sustained."

### Anti-pattern 9: limiter blocks indefinitely

`Wait` without a context is unbounded. The caller hangs forever.

Fix: always pass `ctx.WithTimeout`.

### Anti-pattern 10: limiter denies but the response is 200

The server's response is 200 with a body that says "rate limited." Clients (browsers, libraries) don't know to back off. Status codes are the signal.

Fix: return 429.

### Anti-pattern 11: per-user limit lookup is slow

`l.limiters.Get(userID)` does a database call. The limiter is now bottlenecked on the database.

Fix: in-memory cache (sync.Map, LRU). Refresh asynchronously.

### Anti-pattern 12: limiter outlives its target

You create a `rate.Limiter` per session and keep it in a map. Sessions end but limiters live. Map grows.

Fix: TTL-based map or LRU.

### Anti-pattern 13: limit applied only on one path

Login is rate-limited at the API gateway. Login is also accessible via an internal admin endpoint that bypasses the gateway. The admin endpoint is not limited.

Fix: defense in depth. Apply limits at multiple layers.

### Anti-pattern 14: limiter denies but doesn't release semaphore

A request acquires a semaphore (in-flight token), then is rate-limited and denied. If the denial doesn't release the semaphore, it leaks.

Fix: defer release immediately after acquiring.

### Anti-pattern 15: synchronous limit checks in async code

A goroutine pool fans out 100 calls to a rate-limited endpoint. Each call waits on the limiter. With limit=10 and 100 goroutines, 90 are blocked at all times.

Fix: pre-check the limiter and reduce parallelism, or accept the queueing (it's correct, but observability matters).

---

## Operational Playbooks

What to do when things go wrong.

### Playbook: "we're rate-limited by a downstream"

Symptoms: 429s from downstream, our retries spinning.

1. Confirm the downstream's limit (check their docs or status page).
2. Check our actual call rate (metrics or logs).
3. If we're over the limit, throttle ourselves (`rate.Limiter` on outgoing calls).
4. If we're under the limit, contact the downstream — there may be an incident.
5. Reduce parallelism if necessary.
6. Audit retries: are we causing the storm by retrying too aggressively?

### Playbook: "our limiter is denying too much"

Symptoms: high deny rate on our metrics, customers complaining.

1. Check the configured limit vs actual peak load. Is the limit too tight?
2. Check the limiter's key distribution. Is one key dominating?
3. Check for traffic anomalies. Is this an attack or legitimate growth?
4. If legitimate, raise the limit.
5. If attack, tighten the limit on that key.

### Playbook: "limiter is too generous"

Symptoms: downstream is overloaded, our limiter is not denying.

1. Check the downstream's apparent capacity.
2. Lower the limit.
3. Add an adaptive component (AIMD based on downstream errors).
4. Communicate to clients before lowering (if it's a public API).

### Playbook: "limiter backing store is unhealthy"

Symptoms: errors from Redis/etcd, limiter latency spiking.

1. Check the backing store's health.
2. Verify the limiter's failure mode (fail-open or fail-closed).
3. If failing open, we may be admitting too much. Watch for cascading failure.
4. If failing closed, customers are denied. Restore the backing store ASAP.
5. Consider local fallback (per-instance limit if global is down).

### Playbook: "debouncer never fires"

Symptoms: events keep arriving but the debounced action never runs.

1. Check the debouncer's metrics (last fire time, pending events).
2. Inspect the timer state if accessible.
3. Look for recent code changes that might have introduced a bug.
4. Restart the service. If the debouncer recovers, the bug is in the implementation.
5. Add a "max wait" cap so the debouncer cannot wait indefinitely.

### Playbook: "log storm"

Symptoms: disk filling, log shipper falling behind.

1. Identify the source: which log message is flooding?
2. Add or tighten throttling.
3. Free disk: delete old logs (keep enough for forensics).
4. Verify the shipper recovers.
5. Postmortem: why was logging unthrottled?

### Playbook: "alert flood"

Symptoms: pager going off, many alerts at once.

1. Acknowledge all and silence non-critical for 30 minutes.
2. Triage: which alerts are real?
3. Look for the root cause (often one issue manifests as many alerts).
4. Fix the root cause.
5. Re-evaluate alert thresholds and grouping. Why didn't grouping deduplicate?

---

## Self-Assessment

Read each question. If you cannot answer without consulting the document, return to that section.

1. Describe the standard HTTP rate-limit response (status code, headers, body).
2. What is `Retry-After`, and what is the right value to return?
3. Why is `Retry-After: 0` an anti-pattern?
4. Describe the `X-RateLimit-*` headers and their RFC-style successors.
5. How would you structure per-user, per-IP, per-endpoint limits, and what happens when they conflict?
6. Why is per-IP limiting problematic behind a NAT, and what is the mitigation?
7. Describe the architecture of a search-as-you-type system end to end, including debouncing, abort, and server limits.
8. Why do autosave debouncers need a `beforeunload` flush, and how would you implement it?
9. How would you throttle a log line that is firing in a tight error loop?
10. Explain how circuit breakers and rate limiters compose in a defense-in-depth architecture.
11. What is a retry budget, and why does it matter?
12. Describe a service-mesh rate limiter (Envoy local + global).
13. Where in the stack should rate limiting happen for DDoS protection vs per-user fairness?
14. What metrics would you put on a rate-limiter dashboard, and what alerts?
15. From the postmortems, what was the most surprising root cause?
16. How would you design rate limiting for a public API with 1M customers, 10k QPS aggregate?
17. What is the difference between a "burst-friendly" limit and a "strict" limit, and when do you choose each?
18. Describe three anti-patterns from real systems and their fixes.

---

## Summary

Rate limiting and debouncing are not implementation details. They are user-facing contracts (for APIs), UX decisions (for UI), and operational disciplines (for logs and alerts).

The HTTP layer has crystalized conventions: 429 status, `Retry-After`, `X-RateLimit-*` headers. Honoring these well — both as server and client — separates polite APIs from hostile ones. Documentation of the contract is part of the API; vague rate-limit policies frustrate developers.

Client-side throttling complements server-side limits. Clients that know the limit can stay under it; clients with adaptive logic can respond to dynamic limits; clients with jitter avoid thundering herds. Every retry policy must include exponential backoff and a cap on total wait, or it amplifies failures.

UI debouncing is end-to-end: from the browser's `input` event listener, through the network, to the server's idempotency handling and per-user rate limit. Each layer matters; missing one allows the others to be bypassed. A search-as-you-type implementation has at least seven distinct layers of throttling and caching, each pulling its weight.

Autosave is a special form of debouncing with strict requirements: don't lose data on tab close, retry on failure, respect optimistic concurrency. The pattern is small but mistakes can ruin user trust.

Log and metric throttling prevent the diagnostic infrastructure from amplifying the outage. A misconfigured error logger can be more harmful than the original error. Modern loggers (zap, slog) have built-in sampling; use it.

Alerts must be thrown sparingly. Alert fatigue is a real engineering problem; deduplication, inhibition, and quarterly audits keep it manageable.

Email and push notifications throttle for the user's experience, not just the server's. Digests, quiet hours, and respecting unsubscribe are non-negotiable.

Backpressure is throttling by another name, achieved through bounded channels, semaphores, and queue depth signals. It is often more graceful than explicit denials.

Circuit breakers and rate limiters compose. The breaker stops calls when the downstream is unhealthy; the limiter paces calls when the downstream is healthy. Together they form a robust call protection layer.

Retry budgets are essential for preventing retry storms. A retry rate that is a small fraction of original requests caps the amplification.

Service meshes (Envoy, Istio, Linkerd) offer local and global rate limiting at the sidecar layer. The global layer requires an external service; the local layer is fast and lightweight.

Edge rate limiting (Cloudflare, AWS WAF) is the first line of defense. It blocks crude DDoS before it reaches application capacity. Combined with application-level fine-grained limits, the architecture is defense in depth.

Observability turns rate limiting from a black box into an audit trail. Dashboards for admitted/denied counts, wait times, per-key breakdowns, and capacity utilization are essential. Alerts on sustained high denial rates catch misconfigurations.

The postmortems show recurring patterns:

- Cascading retry storms after brief outages.
- Debouncers with subtle timer bugs that "look right" but fail under load.
- Misconfigured `Retry-After` causing client retry loops.
- Log storms during dependent-service outages.
- Local limiters that lie about uneven traffic distribution.

Each one teaches the same meta-lesson: rate limiters are infrastructure. They must be tested, observed, alerted on, and reviewed regularly. A limiter you never look at is a limiter that will surprise you.

The professional level is exactly this: ownership of rate limiters as live, operational systems. You configure them, monitor them, tune them, and retire them. They are not a "set it and forget it" thing — they live with your service and evolve with it.

The skills in this document, combined with the algorithmic foundations of the senior document, equip you to build rate-limit infrastructure that keeps services healthy under load, treats clients fairly, and recovers gracefully from failure. That is the standard for production systems at any scale.

---

## Appendix A: A Complete API Rate Limit Middleware

The middleware composes everything we've discussed. Use this as a starting point and adapt to your stack.

```go
package middleware

import (
    "context"
    "encoding/json"
    "fmt"
    "net"
    "net/http"
    "strconv"
    "strings"
    "sync"
    "time"

    "github.com/redis/go-redis/v9"
    "golang.org/x/time/rate"
)

// Config describes the rate-limit policy.
type Config struct {
    // Local per-IP limit for DDoS protection.
    PerIPLocal LimitConfig

    // Distributed per-user limit (authoritative).
    PerUserGlobal LimitConfig

    // Per-endpoint global cap (e.g., /search uses heavy resources).
    PerEndpoint map[string]LimitConfig

    // Redis client for global limits.
    Redis *redis.Client

    // Logger and metrics hooks.
    OnDeny func(ctx context.Context, reason string, key string)
    OnAllow func(ctx context.Context, key string)
}

type LimitConfig struct {
    Rate  float64
    Burst int
    Window time.Duration
}

type RateLimiter struct {
    cfg          Config
    perIPMap     sync.Map  // ip -> *rate.Limiter
    perEndpoint  map[string]*rate.Limiter
}

func New(cfg Config) *RateLimiter {
    rl := &RateLimiter{
        cfg:         cfg,
        perEndpoint: make(map[string]*rate.Limiter),
    }
    for path, lc := range cfg.PerEndpoint {
        rl.perEndpoint[path] = rate.NewLimiter(rate.Limit(lc.Rate), lc.Burst)
    }
    return rl
}

// Middleware returns an HTTP middleware.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()
        ip := clientIP(r)
        userID := userIDFromCtx(ctx)
        endpoint := routeTemplate(r)

        // Per-IP local check (cheap, DDoS protection).
        if !rl.allowPerIP(ip) {
            rl.deny(ctx, w, "per_ip_local", ip)
            return
        }

        // Per-endpoint global cap.
        if l, ok := rl.perEndpoint[endpoint]; ok {
            if !l.Allow() {
                rl.deny(ctx, w, "per_endpoint", endpoint)
                return
            }
        }

        // Per-user distributed check (authoritative).
        if userID != "" {
            allowed, info, err := rl.allowPerUser(ctx, userID)
            if err != nil {
                // Backing store unhealthy: fail open with a warning header.
                w.Header().Set("X-RateLimit-Warning", "limiter-degraded")
            } else {
                rl.writeHeaders(w, info)
                if !allowed {
                    rl.deny(ctx, w, "per_user", userID)
                    return
                }
            }
        }

        rl.allow(ctx, userID)
        next.ServeHTTP(w, r)
    })
}

func (rl *RateLimiter) allowPerIP(ip string) bool {
    val, _ := rl.perIPMap.LoadOrStore(ip, rate.NewLimiter(
        rate.Limit(rl.cfg.PerIPLocal.Rate),
        rl.cfg.PerIPLocal.Burst,
    ))
    return val.(*rate.Limiter).Allow()
}

type rateInfo struct {
    Limit     int
    Remaining int
    ResetAt   time.Time
}

var perUserScript = redis.NewScript(`
local key = KEYS[1]
local now = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])

local state = redis.call("HMGET", key, "tokens", "last")
local tokens = tonumber(state[1]) or capacity
local last = tonumber(state[2]) or now

local elapsed = (now - last) / 1e9
tokens = math.min(capacity, tokens + elapsed * rate)

local allowed = 0
if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
end

redis.call("HSET", key, "tokens", tokens, "last", now)
local ttl = math.ceil(capacity / rate)
if ttl < 1 then ttl = 1 end
redis.call("EXPIRE", key, ttl)

return {allowed, tokens, capacity}
`)

func (rl *RateLimiter) allowPerUser(ctx context.Context, userID string) (bool, rateInfo, error) {
    if rl.cfg.Redis == nil {
        return true, rateInfo{}, nil
    }
    now := time.Now().UnixNano()
    key := fmt.Sprintf("rl:user:%s", userID)
    res, err := perUserScript.Run(ctx, rl.cfg.Redis, []string{key},
        now, rl.cfg.PerUserGlobal.Rate, rl.cfg.PerUserGlobal.Burst).Result()
    if err != nil {
        return false, rateInfo{}, err
    }
    arr := res.([]interface{})
    allowed := arr[0].(int64) == 1
    tokens := arr[1].(int64) // truncated to int by Lua
    capacity := arr[2].(int64)
    refill := time.Duration(float64(capacity-tokens) / rl.cfg.PerUserGlobal.Rate * float64(time.Second))
    info := rateInfo{
        Limit:     int(capacity),
        Remaining: int(tokens),
        ResetAt:   time.Now().Add(refill),
    }
    return allowed, info, nil
}

func (rl *RateLimiter) writeHeaders(w http.ResponseWriter, info rateInfo) {
    w.Header().Set("RateLimit-Limit", strconv.Itoa(info.Limit))
    w.Header().Set("RateLimit-Remaining", strconv.Itoa(info.Remaining))
    secs := int(time.Until(info.ResetAt).Seconds())
    if secs < 0 {
        secs = 0
    }
    w.Header().Set("RateLimit-Reset", strconv.Itoa(secs))
    w.Header().Set("X-RateLimit-Limit", strconv.Itoa(info.Limit))
    w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(info.Remaining))
    w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(info.ResetAt.Unix(), 10))
}

func (rl *RateLimiter) deny(ctx context.Context, w http.ResponseWriter, reason, key string) {
    if rl.cfg.OnDeny != nil {
        rl.cfg.OnDeny(ctx, reason, key)
    }
    retryAfter := 30 // generic fallback
    w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusTooManyRequests)
    json.NewEncoder(w).Encode(map[string]interface{}{
        "error":      "rate_limited",
        "reason":     reason,
        "retry_after": retryAfter,
    })
}

func (rl *RateLimiter) allow(ctx context.Context, key string) {
    if rl.cfg.OnAllow != nil {
        rl.cfg.OnAllow(ctx, key)
    }
}

func clientIP(r *http.Request) string {
    if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
        if idx := strings.Index(xff, ","); idx >= 0 {
            return strings.TrimSpace(xff[:idx])
        }
        return strings.TrimSpace(xff)
    }
    if xr := r.Header.Get("X-Real-IP"); xr != "" {
        return xr
    }
    host, _, _ := net.SplitHostPort(r.RemoteAddr)
    return host
}

func userIDFromCtx(ctx context.Context) string {
    if v := ctx.Value(userIDKey{}); v != nil {
        return v.(string)
    }
    return ""
}

type userIDKey struct{}

func routeTemplate(r *http.Request) string {
    // Simple: use path. Real implementation would use router's pattern.
    return r.URL.Path
}
```

Use it:

```go
rl := middleware.New(middleware.Config{
    PerIPLocal:    middleware.LimitConfig{Rate: 100, Burst: 100},
    PerUserGlobal: middleware.LimitConfig{Rate: 10, Burst: 100, Window: time.Hour},
    PerEndpoint: map[string]middleware.LimitConfig{
        "/api/search": {Rate: 1000, Burst: 100},
    },
    Redis: redisClient,
    OnDeny: func(ctx context.Context, reason, key string) {
        metrics.Denied.WithLabelValues(reason).Inc()
        log.Printf("rate-limit denied: reason=%s key=%s", reason, key)
    },
    OnAllow: func(ctx context.Context, key string) {
        metrics.Allowed.Inc()
    },
})

http.Handle("/api/", rl.Middleware(apiHandler))
```

---

## Appendix B: A Complete Client-Side Retry Library

Reciprocally, a client that handles 429 correctly:

```go
package retry

import (
    "context"
    "errors"
    "fmt"
    "io"
    "math/rand"
    "net/http"
    "strconv"
    "strings"
    "time"
)

type Policy struct {
    MaxAttempts     int
    InitialBackoff  time.Duration
    MaxBackoff      time.Duration
    Multiplier      float64
    Jitter          float64 // 0..1
    RetryableStatus []int   // e.g., 429, 502, 503
    RetryableMethods map[string]bool
}

var DefaultPolicy = Policy{
    MaxAttempts:     5,
    InitialBackoff:  100 * time.Millisecond,
    MaxBackoff:      30 * time.Second,
    Multiplier:      2,
    Jitter:          0.3,
    RetryableStatus: []int{408, 429, 500, 502, 503, 504},
    RetryableMethods: map[string]bool{
        "GET": true, "HEAD": true, "OPTIONS": true, "PUT": true, "DELETE": true,
        // POST is retryable only with Idempotency-Key.
    },
}

type Client struct {
    HTTP   *http.Client
    Policy Policy
}

func (c *Client) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
    // Buffer the body so we can replay.
    var body []byte
    if req.Body != nil {
        var err error
        body, err = io.ReadAll(req.Body)
        if err != nil {
            return nil, err
        }
        req.Body.Close()
    }

    retryableMethod := c.Policy.RetryableMethods[req.Method]
    if req.Method == "POST" && req.Header.Get("Idempotency-Key") != "" {
        retryableMethod = true
    }

    var lastResp *http.Response
    var lastErr error
    for attempt := 0; attempt < c.Policy.MaxAttempts; attempt++ {
        if attempt > 0 {
            wait := c.backoff(attempt, lastResp)
            select {
            case <-ctx.Done():
                if lastResp != nil {
                    return lastResp, ctx.Err()
                }
                return nil, ctx.Err()
            case <-time.After(wait):
            }
        }

        if lastResp != nil {
            lastResp.Body.Close()
        }

        attempt_req := req.Clone(ctx)
        if body != nil {
            attempt_req.Body = io.NopCloser(strings.NewReader(string(body)))
        }

        resp, err := c.HTTP.Do(attempt_req)
        if err != nil {
            lastErr = err
            if !retryableMethod {
                return nil, err
            }
            continue
        }
        lastResp = resp

        if !c.shouldRetry(resp.StatusCode, retryableMethod) {
            return resp, nil
        }
    }
    if lastResp != nil {
        return lastResp, lastErr
    }
    return nil, fmt.Errorf("retry exhausted: %w", lastErr)
}

func (c *Client) shouldRetry(status int, retryableMethod bool) bool {
    if !retryableMethod {
        return false
    }
    for _, s := range c.Policy.RetryableStatus {
        if s == status {
            return true
        }
    }
    return false
}

func (c *Client) backoff(attempt int, lastResp *http.Response) time.Duration {
    // Honor Retry-After if present.
    if lastResp != nil {
        if ra := parseRetryAfter(lastResp.Header.Get("Retry-After")); ra > 0 {
            return jitter(ra, c.Policy.Jitter)
        }
    }
    base := time.Duration(float64(c.Policy.InitialBackoff) *
        pow(c.Policy.Multiplier, attempt-1))
    if base > c.Policy.MaxBackoff {
        base = c.Policy.MaxBackoff
    }
    return jitter(base, c.Policy.Jitter)
}

func pow(base float64, exp int) float64 {
    r := 1.0
    for i := 0; i < exp; i++ {
        r *= base
    }
    return r
}

func jitter(d time.Duration, factor float64) time.Duration {
    if factor <= 0 {
        return d
    }
    delta := float64(d) * factor
    return d + time.Duration(rand.Float64()*delta-delta/2)
}

func parseRetryAfter(h string) time.Duration {
    if h == "" {
        return 0
    }
    if secs, err := strconv.Atoi(strings.TrimSpace(h)); err == nil {
        return time.Duration(secs) * time.Second
    }
    if t, err := http.ParseTime(h); err == nil {
        return time.Until(t)
    }
    return 0
}

var ErrNonRetryable = errors.New("non-retryable response")
```

Usage:

```go
client := &retry.Client{
    HTTP:   http.DefaultClient,
    Policy: retry.DefaultPolicy,
}

req, _ := http.NewRequest("GET", "https://api.example.com/data", nil)
ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
defer cancel()
resp, err := client.Do(ctx, req)
```

Features:
- Honors `Retry-After` (numeric or HTTP-date).
- Exponential backoff with cap.
- Configurable jitter.
- Respects context deadline.
- Method-aware (POST not retried without Idempotency-Key).
- Buffers body for replay.

---

## Appendix C: Frontend Debounce Library

A small but complete JavaScript debounce/throttle library:

```javascript
// debounce.js
export function debounce(fn, delay, options = {}) {
  const { leading = false, trailing = true, maxWait } = options;
  let timer = null;
  let maxTimer = null;
  let lastArgs = null;
  let lastThis = null;
  let lastResult;
  let firstCallTime = null;

  function invoke() {
    const args = lastArgs;
    const ctx = lastThis;
    lastArgs = lastThis = null;
    firstCallTime = null;
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
    lastResult = fn.apply(ctx, args);
    return lastResult;
  }

  function leadingEdge() {
    return invoke();
  }

  function trailingEdge() {
    timer = null;
    if (trailing && lastArgs) {
      return invoke();
    }
    lastArgs = lastThis = null;
  }

  function maxWaitFire() {
    maxTimer = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (lastArgs) {
      return invoke();
    }
  }

  function debounced(...args) {
    lastArgs = args;
    lastThis = this;
    const now = Date.now();
    if (firstCallTime === null) firstCallTime = now;

    if (timer === null && leading) {
      const result = leadingEdge();
      timer = setTimeout(trailingEdge, delay);
      if (maxWait) {
        maxTimer = setTimeout(maxWaitFire, maxWait);
      }
      return result;
    }

    if (timer) clearTimeout(timer);
    timer = setTimeout(trailingEdge, delay);

    if (maxWait && !maxTimer) {
      maxTimer = setTimeout(maxWaitFire, maxWait);
    }

    return lastResult;
  }

  debounced.cancel = function() {
    if (timer) clearTimeout(timer);
    if (maxTimer) clearTimeout(maxTimer);
    timer = maxTimer = null;
    lastArgs = lastThis = null;
    firstCallTime = null;
  };

  debounced.flush = function() {
    if (timer) {
      return trailingEdge();
    }
  };

  return debounced;
}

export function throttle(fn, delay, options = {}) {
  const { leading = true, trailing = true } = options;
  return debounce(fn, delay, { leading, trailing, maxWait: delay });
}
```

Use it:

```javascript
import { debounce, throttle } from './debounce.js';

// Search-as-you-type
const search = debounce(query => {
  fetch(`/search?q=${encodeURIComponent(query)}`)
    .then(r => r.json())
    .then(renderResults);
}, 300);

document.getElementById('search').addEventListener('input', e => {
  search(e.target.value);
});

// Scroll throttle
const onScroll = throttle(() => {
  updateScrollPosition();
}, 100, { leading: true, trailing: true });
window.addEventListener('scroll', onScroll);

// Autosave debouncer with max wait
const autosave = debounce(saveDocument, 1500, { maxWait: 10000 });
editor.addEventListener('input', autosave);

// Flush on unload
window.addEventListener('beforeunload', () => autosave.flush());
```

This is essentially a re-implementation of lodash's debounce/throttle. Use lodash in production unless you have a strong reason not to.

---

## Appendix D: Per-Tier Rate Limit Plans

A worked design for tiered limits at a SaaS API.

### Tiers

```yaml
plans:
  free:
    name: "Free"
    price_usd_per_month: 0
    requests_per_hour: 1000
    requests_per_day: 10000
    burst: 100
    concurrent: 5
    endpoints:
      /api/search:
        cost: 5
      /api/uploads:
        cost: 10
        max_size_mb: 10

  starter:
    name: "Starter"
    price_usd_per_month: 29
    requests_per_hour: 10000
    requests_per_day: 100000
    burst: 500
    concurrent: 20

  growth:
    name: "Growth"
    price_usd_per_month: 199
    requests_per_hour: 100000
    requests_per_day: 1000000
    burst: 2000
    concurrent: 100

  enterprise:
    name: "Enterprise"
    price_usd_per_month: custom
    requests_per_hour: custom
    requests_per_day: custom
    burst: custom
    concurrent: custom
    sla:
      uptime: 99.9%
      response_p99_ms: 500
```

The plan loader:

```go
type Plan struct {
    Name              string
    RequestsPerHour   int
    RequestsPerDay    int
    Burst             int
    Concurrent        int
    EndpointCosts     map[string]int
    EndpointMaxSizeMB map[string]int
}

type PlanRegistry struct {
    mu    sync.RWMutex
    plans map[string]*Plan
}

func (r *PlanRegistry) Get(name string) *Plan {
    r.mu.RLock()
    defer r.mu.RUnlock()
    return r.plans[name]
}

func (r *PlanRegistry) Reload(path string) error {
    // Read YAML, parse, atomic swap.
    return nil
}
```

The limiter consults the registry:

```go
func (m *Middleware) checkPlan(ctx context.Context, userID string, r *http.Request) bool {
    plan := planFor(userID)
    cost := plan.EndpointCosts[r.URL.Path]
    if cost == 0 {
        cost = 1
    }
    return m.hourly.AllowN(ctx, userID, cost) && m.daily.AllowN(ctx, userID, cost)
}
```

Two limiters in series: hourly and daily. Both must admit. The cost is endpoint-specific.

### Surfacing plan limits

Return the plan info in headers:

```
X-Plan: starter
X-RateLimit-Limit: 10000
X-RateLimit-Remaining: 9456
X-RateLimit-Reset: 1716000000
X-Daily-Limit: 100000
X-Daily-Remaining: 67234
X-Daily-Reset: 1716086400
```

Clients can present this to users: "You've used 32% of your hourly quota."

### Upgrade prompts

When a user is rate-limited and they're on a free plan, suggest upgrade:

```json
{
  "error": "rate_limited",
  "message": "You've exceeded your hourly quota.",
  "retry_after": 1800,
  "upgrade_url": "https://example.com/upgrade?plan=starter"
}
```

The product team will love the conversion data.

### Custom enterprise limits

Enterprise customers negotiate. The implementation:

```yaml
overrides:
  customer_id_C123:
    plan: enterprise
    requests_per_hour: 500000
    requests_per_day: custom
    concurrent: 500
    endpoint_costs:
      /api/search: 1  # discount for large-volume search
```

The plan registry checks overrides first, then falls back to the named plan.

### Quota tracking for billing

Some APIs charge per-request beyond the included quota. Track exactly:

```go
type UsageTracker struct {
    store UsageStore // database or time-series store
}

func (t *UsageTracker) Record(ctx context.Context, userID string, cost int) {
    t.store.Increment(ctx, userID, time.Now(), cost)
}

func (t *UsageTracker) BillFor(ctx context.Context, userID string, period TimePeriod) (int64, error) {
    return t.store.Sum(ctx, userID, period)
}
```

The usage is reported daily for billing. The rate limiter is the enforcement; the tracker is the accounting.

---

## Appendix E: Throttling in Streaming Pipelines

A streaming pipeline (Kafka, Pulsar, Kinesis) ingests events at variable rates. Downstream consumers may not keep up. Throttling applies at multiple points.

### Producer-side throttling

A producer that knows the consumer's capacity can pace itself.

```go
type ProducerWithRateLimit struct {
    producer *kafka.Producer
    limiter  *rate.Limiter
}

func (p *ProducerWithRateLimit) Produce(ctx context.Context, msg Message) error {
    if err := p.limiter.Wait(ctx); err != nil {
        return err
    }
    return p.producer.Produce(msg)
}
```

If the producer is producing for a single consumer, the rate matches the consumer's known capacity. For shared topics with multiple consumers, the producer's rate must consider all consumers.

### Broker-side throttling (Kafka)

Kafka brokers support quotas per client, per user, per topic:

```properties
quota.consumer.default=10485760  # 10 MB/s per consumer
quota.producer.default=10485760  # 10 MB/s per producer
```

Per-user quotas in `kafka-acls.sh`:

```bash
bin/kafka-configs.sh --bootstrap-server localhost:9092 \
  --alter --add-config 'producer_byte_rate=1048576,consumer_byte_rate=2097152' \
  --entity-type users --entity-name alice
```

This is rate limiting at the protocol layer. Effective at protecting brokers from misbehaving clients.

### Consumer-side throttling

A consumer that processes slower than the producer produces will fall behind. The Kafka client buffers messages locally; if the buffer fills, the consumer applies backpressure.

```go
for msg := range consumer.Messages() {
    if err := process(msg); err != nil {
        // What now?
    }
    consumer.Commit(msg)
}
```

If `process` is slow, the loop runs slowly, and `consumer.Messages()` produces fewer messages per second.

For producer-controlled rate matching, the consumer can publish its rate to the producer (via a status topic or out-of-band metric). The producer adjusts.

### Backpressure-aware pipeline

```go
type Pipeline struct {
    stages []Stage
    queues []chan Event
}

func (p *Pipeline) Submit(e Event) error {
    select {
    case p.queues[0] <- e:
        return nil
    default:
        return ErrFull
    }
}
```

Each stage reads from its input queue, processes, writes to its output queue. If a downstream stage is slow, its input queue fills, and the upstream stage's write blocks. The pipeline naturally throttles.

For complex pipelines, libraries like Apache Beam or Akka Streams provide structured backpressure. In Go, channels are the primitive; libraries like `tobgu/qframe` or `reactivex/rxgo` provide higher-level abstractions.

### Watermarks for ordered streams

A streaming pipeline with windowed aggregations needs to know "when can I finalize this window?" The watermark answers: an event with timestamp T must arrive before watermark T is emitted.

Throttling interacts: if a stage's queue is full, watermarks may be delayed. Late events may be lost or processed in a late-arrival path.

This is event-time semantics; full coverage is outside our scope, but the throttling principles still apply.

---

## Appendix F: Throttling in Distributed Databases

Modern databases (Cassandra, ScyllaDB, FoundationDB, DynamoDB) include rate-limiting features that are essential at scale.

### DynamoDB read/write capacity units

DynamoDB tables have provisioned capacity: X RCUs (read capacity units) and Y WCUs (write capacity units) per second. Exceed them and you get `ProvisionedThroughputExceededException`.

The client SDK retries on this exception with exponential backoff. But if the workload is sustained over the provisioned capacity, retries don't help — you must increase capacity or reduce load.

DynamoDB's on-demand mode scales automatically, but at higher cost.

### Cassandra rate limiting

Cassandra's per-table coordinator throttling:

```sql
ALTER TABLE my_table WITH read_request_timeout_in_ms = 5000;
```

The native protocol has no rate limit per se, but the request timeout and the coordinator's queue depth provide implicit backpressure.

For explicit rate limiting, deploy a proxy (e.g., Cassandra Sidecar) or rate-limit at the application.

### Read replicas

When the primary is saturated, route reads to replicas. This isn't rate limiting, but it provides additional capacity without changing the primary's rate.

```go
type ReplicaAwareDB struct {
    primary  *sql.DB
    replicas []*sql.DB
    nextReplica atomic.Int64
}

func (db *ReplicaAwareDB) Read(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
    idx := int(db.nextReplica.Add(1)) % len(db.replicas)
    return db.replicas[idx].QueryContext(ctx, query, args...)
}

func (db *ReplicaAwareDB) Write(ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
    return db.primary.ExecContext(ctx, query, args...)
}
```

Reads scale horizontally with replica count. Writes still bottleneck on the primary.

### Sharding

Splitting data across multiple primaries (vertical or horizontal). Each shard has its own rate limit. The total capacity is shards × per-shard limit.

```go
func (db *ShardedDB) shardFor(key string) *sql.DB {
    h := fnv.New32a()
    h.Write([]byte(key))
    return db.shards[h.Sum32()%uint32(len(db.shards))]
}
```

Sharding is the heaviest rate-limit lever: it's expensive operationally but scales nearly linearly.

### Connection pool sizing

Each app instance has a connection pool. Total connections = instances × pool size. If too high, the database is overwhelmed by connections (each consumes memory and CPU).

```go
db.SetMaxOpenConns(20) // tune based on instance count and DB capacity
db.SetMaxIdleConns(10)
db.SetConnMaxLifetime(time.Hour)
```

A rough rule: `instances * max_conns_per_instance < database_max_connections / 2`. The /2 leaves headroom for migrations, monitoring, etc.

Connection pool exhaustion is a common symptom under load. The fix is usually shorter timeouts and proper context propagation, not larger pools.

### Query timeouts

```go
ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
defer cancel()
rows, err := db.QueryContext(ctx, "SELECT ...")
```

A query that exceeds the timeout is cancelled. The connection is freed. This is the application-level analog of rate limiting: cap the resource any single query can consume.

Database-side query timeouts (e.g., `statement_timeout` in PostgreSQL) provide a second layer.

---

## Appendix G: Client SDK Design Notes

If you publish an SDK for your API, the SDK's behavior under rate-limit shapes customer perception.

### Built-in retry

The SDK should retry 429 with exponential backoff and `Retry-After` honoring. Without this, naive customers will hit limits and complain.

```go
func New(config Config) *Client {
    c := &Client{
        http: &retry.Client{
            HTTP:   &http.Client{},
            Policy: retry.DefaultPolicy,
        },
    }
    if config.RetryPolicy != nil {
        c.http.Policy = *config.RetryPolicy
    }
    return c
}
```

Make it customizable but provide sensible defaults.

### Surface limits to the caller

When the SDK is rate-limited, return a structured error:

```go
type RateLimitError struct {
    Limit       int
    Remaining   int
    ResetAt     time.Time
    RetryAfter  time.Duration
}

func (e *RateLimitError) Error() string {
    return fmt.Sprintf("rate limited; retry in %s", e.RetryAfter)
}
```

Callers can check `errors.Is(err, &RateLimitError{})` and handle specifically.

### Expose remaining quota

Customers want to know their quota usage. Expose it:

```go
type Client struct {
    // ...
    limits atomic.Pointer[QuotaInfo]
}

type QuotaInfo struct {
    Limit     int
    Remaining int
    ResetAt   time.Time
}

func (c *Client) Quota() QuotaInfo {
    return *c.limits.Load()
}
```

After each request, parse the headers and update.

### Avoid per-call overhead

The SDK should not introduce excessive overhead. Pool HTTP clients, reuse connections, batch where possible.

For high-volume SDKs, consider:

- Batch endpoint: one HTTP call carries multiple operations.
- Async API: submit operations and receive results via callback or futures.
- Bulk operations: send up to N items per request.

The reduction in request count proportionally reduces rate limit pressure.

### Telemetry opt-in

Some SDKs auto-instrument calls (OpenTelemetry, custom). This is helpful for customers debugging issues, but should be opt-in for privacy.

```go
client := api.New(api.Config{
    Telemetry: api.TelemetryConfig{
        Enabled: true,
        Endpoint: "https://collector.example.com",
    },
})
```

### Document the limits prominently

The SDK's README must include the rate limit policy, retry behavior, and how to upgrade.

---

## Appendix H: Postmortem 6 — The Cache That Failed Open

### Setting

A high-traffic e-commerce site uses Memcached for session storage and a rate limiter that checks Memcached on every request.

### Timeline

- Friday 16:00: Memcached cluster has a brief network blip.
- 16:00:05: Rate limiter's `Allow` calls return errors (timeout on Memcached read).
- 16:00:06: Engineers had configured "fail open": on Memcached error, the rate limiter admits the request.
- 16:00:10: A bot, taking advantage of the failure, sends 100,000 RPS to /search.
- 16:00:15: /search is unrate-limited (Memcached still erroring). Application servers run out of database connections.
- 16:00:30: Application servers crash.
- 17:30: After investigation, engineers manually rate-limit at the LB. The system recovers.

### Root cause

Fail-open was the wrong choice for security-sensitive limits. The bot exploited the failure to amplify the attack.

### Fix

For limits that protect against abuse, fail closed (deny). For limits that protect against accidental overuse, fail open (admit).

```go
type Limiter struct {
    redis   *redis.Client
    fallback string // "open" or "closed"
}

func (l *Limiter) Allow(ctx context.Context, key string) bool {
    allowed, err := l.checkRedis(ctx, key)
    if err != nil {
        if l.fallback == "closed" {
            metrics.LimiterFailedClosed.Inc()
            return false
        }
        metrics.LimiterFailedOpen.Inc()
        return true
    }
    return allowed
}
```

For the search rate limit (security-relevant), fail closed. For per-user limits (UX-relevant), fail open with a degraded message.

### Lessons

1. **Fail-open is a security risk for protective limits**. Choose deliberately.
2. **Backing store dependency is the limiter's availability ceiling**. Plan for it.
3. **Local fallback**. When the global limiter fails, fall back to a stricter local one.

### Action items

```
[x] Audit all limiters: which should be fail-open vs fail-closed?
[x] Add local fallback for distributed limiters (when Redis is down, use a tighter local limiter).
[x] Monitor "limiter failed" events and alert.
[x] Memcached cluster redundancy (multi-AZ, automatic failover).
[x] Postmortem-driven runbook for "limiter backing store unhealthy."
```

---

## Appendix I: Postmortem 7 — The Friendly Fire

### Setting

A microservices architecture with service-mesh rate limiting (Envoy + Lyft Ratelimit). The mesh enforces 1000 RPS per (source service, destination service) pair.

### Timeline

- Tuesday 11:00: Service A deploys a new feature that increases its calls to service B from 800 RPS to 1500 RPS.
- 11:00:30: Service A starts getting 429s from the mesh.
- 11:01: Service A's retry logic kicks in. Total call rate doubles. More 429s.
- 11:05: Service A starts timing out. The new feature is broken.
- 11:30: On-call investigates. Discovers the mesh rate limit.
- 12:00: Mesh limit raised to 2000 RPS. Service A recovers.

### Root cause

The new feature was capacity-planned for service B (which can handle 5000 RPS) but the mesh rate limit was set at 1000 RPS for historical reasons. The mesh limit was the bottleneck, not service B's capacity.

The engineers who deployed the feature didn't know about the mesh limit because it was configured by the platform team in a separate repo.

### Fix

1. Audit all mesh limits. Document them in a central place.
2. Add capacity-planning checklist: review mesh limits before deploying load-changing features.
3. Add observability: dashboard of mesh limits per service pair, current utilization.
4. Make limits dynamically configurable (already true, but the process was poorly documented).

### Lessons

1. **Multiple layers of rate limits**. Each is invisible from the application's perspective. They must all be considered.
2. **Capacity planning includes infrastructure limits**, not just app/DB capacity.
3. **Observability of "where is the bottleneck"**. The dashboard should show all rate limits in the path.

### Action items

```
[x] Document all mesh rate limits in a central table.
[x] Add pre-deployment checklist: review mesh limits.
[x] Dashboard: per-pair mesh utilization.
[x] Self-service mesh limit changes (PR template, automated review).
[x] Postmortem-driven runbook for "mesh rate limit causing latency."
```

---

## Appendix J: Postmortem 8 — The Quiet Failure

### Setting

A backend service that publishes events to a webhook URL configured by each customer. The service rate-limits webhook delivery to avoid overwhelming customer endpoints.

### Timeline

- Sunday 12:00: A customer's webhook endpoint becomes unreachable.
- 12:01: Webhook delivery starts failing.
- 12:05: The rate limiter starts denying further deliveries because the retry queue is full.
- 12:30: Customer notices their webhook has not received events.
- 13:00: Customer support ticket: "Why am I not getting webhooks?"
- 13:30: Engineering investigates. Discovers the retry queue is full of failed deliveries.
- 14:00: Engineer manually flushes the queue. Events are lost.

### Root cause

The rate limiter denied new deliveries when the retry queue was saturated. The events were dropped. There was no signal to the customer or to engineering that this had happened.

### Fix

1. Persistent retry queue. Don't lose events.
2. Surface delivery status to customers via API.
3. Alert when retry queue grows.

```go
type WebhookDelivery struct {
    queue    *Queue // persistent (e.g., Postgres)
    limiter  *rate.Limiter
    maxRetries int
}

func (d *WebhookDelivery) Deliver(event Event) error {
    return d.queue.Add(event)
}

func (d *WebhookDelivery) Loop() {
    for event := range d.queue.Iter() {
        if err := d.limiter.Wait(context.Background()); err != nil {
            continue
        }
        if err := d.attempt(event); err != nil {
            d.queue.Retry(event)
            continue
        }
        d.queue.Ack(event)
    }
}
```

The persistent queue ensures no events are lost. The customer can query "what's my delivery status" and see pending deliveries.

### Lessons

1. **Don't drop events silently**. If you can't deliver, queue, retry, or expose the failure.
2. **Per-customer queue depth metrics**. Alert when growing.
3. **Customer-facing delivery status API**. Empowers customers to debug.
4. **Idempotency in webhook delivery**. Customers may receive duplicates; their handlers must dedupe.

### Action items

```
[x] Migrate webhook queue to persistent storage (Postgres with FOR UPDATE SKIP LOCKED).
[x] Add customer-facing "delivery status" endpoint.
[x] Alert: webhook queue depth > 10k for any customer.
[x] Documentation: customers must handle duplicate webhooks.
```

---

## Appendix K: Tuning a Rate Limiter

How do you know the right rate? Two approaches: capacity-based and empirical.

### Capacity-based tuning

Measure the downstream's capacity:

- Database: max QPS before p99 latency degrades.
- External API: documented rate limit.
- Internal service: load-test result.

Set the limiter at 80% of this capacity to leave headroom.

```
external_api_capacity = 1000 RPS (documented)
my_limiter = 800 RPS (80%)
```

### Empirical tuning

Run with a high limiter and observe. Measure:

- Actual peak rate.
- Latency under peak.
- Error rate.

If latency is healthy at peak, the rate is OK. If latency degrades, tighten.

The empirical approach finds the actual capacity, which is often different from the documented one.

### Tuning the burst

Bursts handle short spikes. The burst should be:

- Large enough to handle expected legitimate bursts (e.g., user opens app, fetches profile + inbox + settings).
- Small enough that it doesn't completely empty the downstream's reserve.

A heuristic: `burst = rate * 5` for user-facing limits, `burst = rate` for downstream protection.

### Tuning the algorithm

- **Token bucket**: friendly to bursts; default choice.
- **Sliding window**: stricter; use for fraud-resistant limits.
- **Leaky bucket queue**: smoothing; use for downstream that prefers steady rate.

### Tuning over time

Workloads change. Tune quarterly:

- Review actual peak vs limit.
- Adjust if peak is consistently below or above expected.
- Account for growth: if traffic is growing 10%/month, the limit must grow.

### Automated tuning

Some teams automate: a job that adjusts the limit based on observed traffic.

```python
# Pseudo-code
def auto_tune(limiter_name):
    last_week_p99 = get_metric(f"{limiter_name}_request_rate_p99", "1w")
    capacity = get_capacity(limiter_name)
    target = min(capacity * 0.8, last_week_p99 * 1.2)
    set_limit(limiter_name, target)
```

Run weekly. Be cautious: automation can lower limits unintentionally.

---

## Appendix L: Migration Patterns

Changing a rate limit in production is risky. Strategies:

### Shadow mode

Run the new limit alongside the old, but only the old enforces. The new is "shadow": it records denials in metrics but doesn't deny.

```go
func (l *ShadowLimiter) Allow(key string) bool {
    actual := l.old.Allow(key)
    shadow := l.new.Allow(key)
    if actual != shadow {
        metrics.ShadowDifference.Inc()
    }
    return actual
}
```

After a week of data, decide whether to switch.

### Gradual rollout

Apply the new limit to X% of users. Monitor. Increase X over time.

```go
func (l *GradualLimiter) Allow(userID string) bool {
    if hash(userID)%100 < l.newPercent {
        return l.new.Allow(userID)
    }
    return l.old.Allow(userID)
}
```

If the new limit causes issues for the X%, you can roll back without affecting everyone.

### Communication

When tightening a public-facing limit, communicate:

- Announce in advance (weeks).
- Provide upgrade paths (paid tiers).
- Offer migration help for high-volume users.
- Soft-launch with logging only.

Tightening without notice causes customer churn.

### Loosening

Loosening a limit is generally safer. Watch for:

- Downstream capacity (don't exceed).
- Cost (more requests = more compute).
- Abuse vectors (a loose limit may invite bots).

---

## Appendix M: Recap of Key Numbers

A handful of numbers worth remembering.

### Performance

- `time.Now`: 15-25 ns on x86 Linux.
- `sync.Mutex` uncontended lock: 15-25 ns.
- `atomic.CompareAndSwap`: 5-10 ns uncontended.
- `rate.Limiter.Allow`: 100-200 ns hot path.
- Redis `EVAL` round trip: 100-500 µs.
- HTTP middleware overhead: 1-10 µs (excluding network).

### Capacity

- Single-instance `rate.Limiter`: 1-10 M ops/sec.
- Sharded local limiter: 10-100 M ops/sec.
- Redis-backed limiter: 10k-100k ops/sec per Redis instance.
- Envoy RLS: 50-200 k ops/sec.

### Sizing heuristics

- Per-user limit: rate based on plan, burst = 5 * rate.
- Per-IP limit (anonymous): 10-100 RPS.
- Global limit: 80% of downstream capacity.
- Mesh limit (Envoy): 2x normal peak between service pairs.

### Defaults to start with

- Retry-After: 30 seconds (with jitter).
- Backoff base: 100 ms.
- Backoff max: 30 seconds.
- Backoff multiplier: 2.
- Jitter factor: 0.3.
- Max retries: 5.
- Cumulative retry timeout: 60 seconds.

### When to alert

- Sustained denial rate > 10% for 5+ minutes.
- p99 wait time > 1 second.
- Limiter backing store error rate > 1%.
- Specific key denial rate > 50% (possible attack).

---

## Appendix N: When NOT to Rate Limit

A surprising category: places where rate limiting is wrong.

### Health checks

`/health`, `/ping`, `/ready`: must always succeed (or fail explicitly when the service is unhealthy). Rate-limiting these makes monitoring unreliable.

### Internal-only endpoints behind auth

If the endpoint is only accessible to your own services, trust the auth and skip the limit. The limit becomes noise.

Exception: if the internal endpoint is expensive (large queries, expensive computation), limit to prevent internal abuse.

### Cached read-only

If the response is cached at the CDN with a long TTL, the origin gets at most one request per cache TTL. Limiting is redundant.

Exception: cache misses spike the origin. Limit cache-miss requests, not all requests.

### Idempotent retries

A retry of an idempotent operation that previously succeeded should be cheap. Don't rate-limit it.

```go
if isIdempotentRetry(r) {
    return next(w, r) // skip rate limit
}
```

The check: was the same Idempotency-Key seen recently and processed successfully?

### Webhook receipt acknowledgment

If you're receiving webhooks (you're the destination), don't rate-limit them. Doing so means the sender retries, multiplying the load.

Apply backpressure instead: process slowly, the sender's queue grows, the sender decides to throttle.

### Streaming endpoints

A long-lived streaming connection (SSE, WebSocket) shouldn't be subject to per-message rate limits at the connection level. Limit at connection establishment if needed.

```go
func (h *StreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // No per-message limit.
    // Connection establishment is rate-limited at middleware.
}
```

### Internal CI/CD

Build and test traffic is bursty by nature. CI may spawn 100 parallel jobs that each call your service. Don't rate-limit your CI; it'll fail builds spuriously.

Whitelist CI traffic (by source IP or auth token).

### Search engine crawlers

Googlebot and other crawlers respect `robots.txt`. They generally limit themselves. Rate-limiting them too aggressively hurts SEO.

```
User-agent: Googlebot
Crawl-delay: 1
```

`robots.txt` `Crawl-delay` is honored by most crawlers. If they're misbehaving, you can rate-limit, but check that the user-agent is legitimate first.

---

## Appendix O: The Holistic View

Rate limiting is one of many techniques for managing capacity. The full picture:

1. **Provisioning**: have enough capacity for expected load.
2. **Scaling**: add capacity dynamically as load grows (horizontal auto-scaling, vertical replicas).
3. **Caching**: reduce load by serving from cache.
4. **Coalescing**: batch many requests into one.
5. **Debouncing**: defer requests until quiet.
6. **Throttling**: pace requests to fit capacity.
7. **Rate limiting**: deny excess to protect.
8. **Backpressure**: signal upstream to slow down.
9. **Load shedding**: drop overload gracefully.
10. **Circuit breaking**: stop calling failing downstream.

Each technique has its place. A robust system uses them together:

- Cache to avoid load.
- Coalesce to reduce request count.
- Debounce to reduce ping rates from UIs.
- Throttle outgoing calls to downstream.
- Rate limit incoming calls from users.
- Backpressure when queues fill.
- Shed load when capacity is exceeded.
- Circuit-break when downstream is unhealthy.
- Scale to grow capacity.
- Provision conservatively.

The pyramid:

```
                    [Provision]
                   /          \
              [Scale]      [Cache]
              /   \           |
        [Coalesce] [Debounce] [Throttle]
              \   /             |
            [Rate limit]   [Backpressure]
                 \              /
              [Load shed] [Circuit break]
```

Lower techniques are cheaper; higher techniques are more reliable. The system that survives under load is the one that uses all of them appropriately.

---

## Appendix P: A Personal Note on Operational Discipline

The senior level taught you the algorithms. The professional level taught you the systems. The final lesson is the operational discipline.

A rate limiter is not "implemented and forgotten." It is a piece of live operational infrastructure that must be:

- **Monitored**: dashboards, alerts, metrics.
- **Tuned**: quarterly review of limits vs actual traffic.
- **Audited**: do the limits still make sense for the current traffic patterns?
- **Documented**: customers and team members must understand what limits exist and why.
- **Tested**: load tests must include rate-limit verification.
- **Rehearsed**: incident playbooks for "rate limit denying too much" and "rate limit denying too little."

The teams that do this well treat rate limiting as a first-class concern. They have on-call documentation for limiter incidents. They review postmortems for "did the limiter help or hurt?" They have a clear escalation path for changing limits in an emergency.

The teams that do this badly set limits once, forget about them, and are surprised when the limiter is the cause of an outage. They don't have alerts. They don't have playbooks. They learn from incidents the hard way.

The transition from senior to professional is precisely this: taking ownership of the limiter as a production system. Not just writing the code, but living with it. Tuning it. Watching it. Sometimes regretting the values you picked. Always learning.

The end goal: rate limiters are boring. They work. They protect. They surface signals. They don't surprise. They are infrastructure in the truest sense — invisible when working, devastating when not.

If your rate limiters are boring, you have arrived at the professional level.

---

End of professional-level material on debounce and throttle.

The full Roadmap subsection covers:

- `index.md`: overview and how to read.
- `junior.md`: the basics — `time.AfterFunc`, `time.Ticker`, simplest implementations.
- `middle.md`: leading/trailing/both, cancellable debouncers, `rate.Limiter` in real handlers.
- `senior.md` (previous): token bucket math, leaky bucket, sliding window, GCRA, atomic counters, distributed limiters, debouncer deep dives.
- `professional.md` (this document): HTTP semantics, UI patterns, log/metric/alert throttling, service mesh, postmortems, operational discipline.

Together they form a complete reference for one of the most important pattern families in distributed systems. The skills are transferable: every backend, every UI, every pipeline, every CI/CD system has rate limiting somewhere — and the engineer who has internalized these patterns can recognize and apply them across the stack.

---

## Appendix Q: Rate Limiting GraphQL APIs

GraphQL presents unique rate-limiting challenges. A single HTTP request can perform arbitrary work depending on the query. Per-request limits are insufficient; you need to charge based on query cost.

### Query complexity

A query that selects 10 fields from 1 record is cheap. A query that traverses 5 levels deep across many records is expensive. Compute a cost from the query AST.

```go
func queryCost(doc *ast.Document, vars map[string]interface{}) int {
    cost := 0
    for _, def := range doc.Definitions {
        if op, ok := def.(*ast.OperationDefinition); ok {
            cost += selectionCost(op.SelectionSet, vars, 1)
        }
    }
    return cost
}

func selectionCost(sel *ast.SelectionSet, vars map[string]interface{}, multiplier int) int {
    cost := 0
    for _, field := range sel.Selections {
        f, ok := field.(*ast.Field)
        if !ok {
            continue
        }
        cost += multiplier
        if first, ok := getArg(f.Arguments, "first").(int); ok {
            cost += selectionCost(f.SelectionSet, vars, multiplier*first)
        } else if f.SelectionSet != nil {
            cost += selectionCost(f.SelectionSet, vars, multiplier*10) // default fan-out
        }
    }
    return cost
}
```

The cost is roughly the count of fields times the fan-out. A query asking for `users(first: 100) { posts(first: 10) { comments(first: 5) } }` costs `100 * 10 * 5 = 5000` units.

### Limit by cost, not by request

```go
type GraphQLLimiter struct {
    limiter *rate.Limiter
    maxCost int
}

func (l *GraphQLLimiter) AllowQuery(query string, vars map[string]interface{}) (bool, error) {
    doc, err := parser.Parse(parser.ParseParams{Source: query})
    if err != nil {
        return false, err
    }
    cost := queryCost(doc, vars)
    if cost > l.maxCost {
        return false, fmt.Errorf("query too complex: cost %d > max %d", cost, l.maxCost)
    }
    return l.limiter.AllowN(time.Now(), cost), nil
}
```

The limiter charges `cost` tokens per request. A complex query consumes many tokens; a simple one consumes few.

### Persisted queries

If clients are trusted (your own app), use persisted queries: the query text is registered at deploy time, and runtime requests reference it by hash. The server knows the cost ahead of time.

This eliminates the AST parsing on every request.

```graphql
# Registered as hash "abc123"
query GetUser($id: ID!) {
  user(id: $id) {
    name
    email
  }
}
```

Runtime request:

```json
{
  "extensions": {
    "persistedQuery": {
      "sha256Hash": "abc123",
      "version": 1
    }
  },
  "variables": {"id": "U123"}
}
```

The server looks up the hash, retrieves the cost, charges accordingly.

### Per-field auth and cost

Some fields are expensive (e.g., a field that runs an aggregation). Annotate the schema:

```graphql
type Query {
  users(first: Int): [User] @cost(value: 1, multiplier: "first")
  search(query: String!): [Result] @cost(value: 10)
}
```

The directive informs the cost calculator. The schema definition is the single source of truth for cost.

### Result-size limits

In addition to query cost, limit the response size:

```go
func limitResponseSize(handler http.Handler, max int) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        cw := &capturingWriter{ResponseWriter: w, max: max}
        handler.ServeHTTP(cw, r)
        if cw.overflow {
            // Too late, headers already sent. Best-effort: drop the rest of the body.
        }
    })
}
```

In practice, GraphQL servers limit response size by capping the `first` argument or by paginating mandatorily.

### Subscription rate limits

GraphQL subscriptions are long-lived WebSocket connections. Per-message limits apply:

```go
type SubscriptionLimiter struct {
    perConn *rate.Limiter
}

func (l *SubscriptionLimiter) BeforeSend(conn *Conn, msg Message) bool {
    return l.perConn.Allow()
}
```

Throttle the rate at which the server pushes updates to a subscriber. Otherwise a slow client falls behind and the server buffers indefinitely.

---

## Appendix R: Rate Limiting gRPC Services

gRPC presents different patterns than REST.

### Unary vs streaming

Unary calls are like HTTP requests; rate limiting is straightforward.

```go
import "google.golang.org/grpc"

func RateLimitInterceptor(l *rate.Limiter) grpc.UnaryServerInterceptor {
    return func(
        ctx context.Context,
        req interface{},
        info *grpc.UnaryServerInfo,
        handler grpc.UnaryHandler,
    ) (interface{}, error) {
        if !l.Allow() {
            return nil, status.Error(codes.ResourceExhausted, "rate limited")
        }
        return handler(ctx, req)
    }
}
```

`codes.ResourceExhausted` is the gRPC analog of HTTP 429.

### Streaming calls

Streaming RPCs have multiple messages per call. The rate limit can apply at:

- Stream open: limit how often clients can open streams.
- Per-message: limit the rate of messages within a stream.
- Per-byte: limit bandwidth.

```go
func StreamRateLimit(l *rate.Limiter) grpc.StreamServerInterceptor {
    return func(
        srv interface{},
        ss grpc.ServerStream,
        info *grpc.StreamServerInfo,
        handler grpc.StreamHandler,
    ) error {
        if !l.Allow() {
            return status.Error(codes.ResourceExhausted, "rate limited")
        }
        // Wrap ss to rate-limit per-message.
        wrapped := &rateLimitedStream{ServerStream: ss, l: rate.NewLimiter(100, 10)}
        return handler(srv, wrapped)
    }
}

type rateLimitedStream struct {
    grpc.ServerStream
    l *rate.Limiter
}

func (s *rateLimitedStream) SendMsg(m interface{}) error {
    if err := s.l.Wait(s.Context()); err != nil {
        return err
    }
    return s.ServerStream.SendMsg(m)
}
```

The stream's send rate is throttled. The client must keep up; if not, the stream blocks (or the limiter denies).

### gRPC error responses

When rate-limited, return `codes.ResourceExhausted` with details:

```go
import "google.golang.org/genproto/googleapis/rpc/errdetails"
import "google.golang.org/grpc/status"

func denyGrpc(retryAfter time.Duration) error {
    st := status.New(codes.ResourceExhausted, "rate limited")
    detail := &errdetails.RetryInfo{
        RetryDelay: durationpb.New(retryAfter),
    }
    st, _ = st.WithDetails(detail)
    return st.Err()
}
```

`RetryInfo` is the gRPC analog of `Retry-After`. Well-behaved gRPC clients honor it.

### gRPC metadata

For per-call rate limit feedback, set metadata:

```go
md := metadata.Pairs(
    "ratelimit-limit", "1000",
    "ratelimit-remaining", "950",
    "ratelimit-reset", strconv.FormatInt(resetAt.Unix(), 10),
)
grpc.SetHeader(ctx, md)
```

The client reads metadata and can throttle preemptively.

### gRPC and connection multiplexing

gRPC multiplexes many calls over one HTTP/2 connection. Rate limit per-call, not per-connection. Per-connection limits cause head-of-line blocking.

---

## Appendix S: Rate Limiting Long-Polling and SSE

Server-sent events (SSE) are unidirectional streaming over HTTP. Long-polling is request/response that holds the connection until an event.

### SSE rate limit per connection

```go
func sseHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    flusher := w.(http.Flusher)

    limiter := rate.NewLimiter(10, 5) // 10 events/sec, burst 5

    for event := range events {
        if err := limiter.Wait(r.Context()); err != nil {
            return
        }
        fmt.Fprintf(w, "data: %s\n\n", event)
        flusher.Flush()
    }
}
```

The limiter caps the event rate per connection. If the source produces faster, events queue (in the channel) until they can be sent.

### Long-polling rate limit per IP

Long-polling holds connections. Limit how often a client can open new long-polls:

```go
var pollLimiter = NewIPLimiter(1, 1) // 1 new poll per second per IP

func longPollHandler(w http.ResponseWriter, r *http.Request) {
    ip := clientIP(r)
    if !pollLimiter.Allow(ip) {
        w.WriteHeader(429)
        return
    }
    select {
    case event := <-events:
        json.NewEncoder(w).Encode(event)
    case <-time.After(30*time.Second):
        w.WriteHeader(204) // no content
    case <-r.Context().Done():
        return
    }
}
```

A misbehaving client that opens and closes polls rapidly is throttled.

### Connection-count limits

Limit total concurrent SSE connections per user:

```go
type ConnLimiter struct {
    mu    sync.Mutex
    conns map[string]int
    max   int
}

func (l *ConnLimiter) Acquire(userID string) bool {
    l.mu.Lock()
    defer l.mu.Unlock()
    if l.conns[userID] >= l.max {
        return false
    }
    l.conns[userID]++
    return true
}

func (l *ConnLimiter) Release(userID string) {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.conns[userID]--
}
```

Cap at, say, 5 concurrent SSE connections per user. Prevents a single user from holding too many slots.

---

## Appendix T: WebSocket Rate Limiting

WebSockets are bidirectional and long-lived. Rate limit per-message and per-connection.

### Per-message rate limit

```go
type WSHandler struct {
    perMsg *rate.Limiter
}

func (h *WSHandler) HandleConn(conn *websocket.Conn) {
    for {
        _, msg, err := conn.ReadMessage()
        if err != nil {
            return
        }
        if !h.perMsg.Allow() {
            conn.WriteJSON(map[string]string{"error": "rate_limited"})
            continue
        }
        h.process(msg)
    }
}
```

Each message is rate-limited. The connection stays open; the message is rejected.

### Per-connection rate limit

Track which connections are open and limit new opens:

```go
var newConnLimiter = NewIPLimiter(5, 5) // 5 new connections per second per IP

func wsHandler(w http.ResponseWriter, r *http.Request) {
    if !newConnLimiter.Allow(clientIP(r)) {
        http.Error(w, "rate limited", 429)
        return
    }
    upgrader.Upgrade(w, r, nil) // ... proceed
}
```

### Connection lifecycle

When a WebSocket connection closes, clean up:

```go
type ConnTracker struct {
    mu sync.Mutex
    perUser map[string]int
}

func (t *ConnTracker) Open(userID string) bool {
    t.mu.Lock()
    defer t.mu.Unlock()
    if t.perUser[userID] >= maxPerUser {
        return false
    }
    t.perUser[userID]++
    return true
}

func (t *ConnTracker) Close(userID string) {
    t.mu.Lock()
    defer t.mu.Unlock()
    t.perUser[userID]--
}
```

Pair `Open` and `Close` reliably (use defer).

### Backpressure to slow clients

If a client doesn't read fast enough, the server's send buffer fills. Eventually the server's network buffer fills and writes block.

Detect slow clients and close them:

```go
func (h *WSHandler) Send(conn *websocket.Conn, msg interface{}) error {
    conn.SetWriteDeadline(time.Now().Add(5*time.Second))
    return conn.WriteJSON(msg)
}
```

A client that can't read within 5 seconds gets disconnected. Aggressive but necessary for stability.

---

## Appendix U: Mobile Client Throttling

Mobile clients have unique constraints: variable network, battery concerns, app foreground/background lifecycle.

### Network-aware throttling

Detect network type and adjust:

```kotlin
// Android
val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
val activeNetwork = connectivity.activeNetworkInfo
val isWifi = activeNetwork?.type == ConnectivityManager.TYPE_WIFI

if (isWifi) {
    // Higher quality, more requests
} else {
    // Throttle aggressively, lower quality
}
```

On cellular, send fewer requests, batch more aggressively, accept lower resolutions.

### Battery-aware

If battery is low, reduce background activity:

```swift
// iOS
if ProcessInfo.processInfo.isLowPowerModeEnabled {
    // Reduce sync frequency
}
```

Don't poll every 10 seconds when the user has 10% battery left.

### Foreground/background

Apps in background should reduce rate. Apps in foreground can do more.

```swift
@objc func appDidEnterBackground() {
    syncManager.setBackgroundMode(true)
}

@objc func appWillEnterForeground() {
    syncManager.setBackgroundMode(false)
    syncManager.syncNow()
}
```

In background: poll every 15 minutes. In foreground: poll every 30 seconds.

### Push instead of poll

If the platform supports push (APNs, FCM), use it. Push is server-initiated; no client polling. Mobile networks and battery are both happy.

The server-side rate limit applies to push notification rate (covered earlier).

### Retry behavior

Mobile clients retry on network errors. They should:

- Use exponential backoff.
- Stop retrying on permanent errors (401, 403, 404).
- Persist retries across app restarts (queue on disk).
- Cap total retry duration (e.g., 24 hours, then give up).

A poorly-tuned mobile retry can be catastrophic for the server (see Postmortem 1).

---

## Appendix V: Browser Throttling and the Tab Lifecycle

Modern browsers throttle background tabs to save resources. Be aware.

### setTimeout in background tabs

In Chrome, `setTimeout` in a background tab is throttled to 1 fire per minute after 5 minutes of background. This means a 1-second debouncer in a background tab will not fire reliably.

If your debouncer must fire in background, use a Web Worker:

```javascript
const worker = new Worker('worker.js');
worker.postMessage({type: 'debounce', delay: 1000, data: 'foo'});
worker.onmessage = (e) => doFlush(e.data);
```

Workers run in their own context and are throttled less aggressively.

### Page Visibility API

Detect when a tab becomes hidden:

```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseUpdates();
  } else {
    resumeUpdates();
  }
});
```

Pause expensive operations (polling, animations) when hidden.

### beforeunload

Best-effort save before the page unloads:

```javascript
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) {
    navigator.sendBeacon('/save', JSON.stringify(state));
    e.preventDefault();
    e.returnValue = '';
  }
});
```

`sendBeacon` is fire-and-forget; it sends a small POST without blocking page navigation. Use it for analytics, autosave, last-second telemetry.

The server endpoint must be designed for high incoming-rate from beacon: stateless, idempotent.

### requestIdleCallback

For non-urgent work, defer to idle time:

```javascript
requestIdleCallback(() => {
  doExpensiveWork();
}, { timeout: 5000 });
```

Browser runs the callback when idle. Throttles automatically without explicit rate-limiting.

---

## Appendix W: Throttling in Real-Time Audio/Video

For real-time media (voice, video conferencing), the rate is dictated by the codec, not by an arbitrary limiter. But there are still throttling considerations.

### Adaptive bitrate

When network bandwidth drops, reduce video quality. This is the codec layer's responsibility, but the application controls it.

```javascript
// Example: WebRTC
sender.setParameters({
  encodings: [{ maxBitrate: 500000 }] // 500 kbps
});
```

Reduce bitrate during congestion; restore when network recovers. This is throttling by codec, not by limiter.

### Frame rate

Reduce frame rate (30 fps -> 15 fps) when CPU or network can't keep up. Visually visible but better than freezing.

### Audio jitter buffer

The receiver buffers a small amount of audio (50-200 ms) to smooth network jitter. This is throttling by buffering: the receiver throttles its playback to a steady rate.

### Server-side capacity

A conferencing server handles many concurrent calls. Capacity = bandwidth × CPU × disk I/O. Limit new call setup when capacity is approached:

```go
type ConfServer struct {
    activeCallsByRegion map[string]int
    maxPerRegion        map[string]int
}

func (s *ConfServer) AcceptCall(region string) bool {
    if s.activeCallsByRegion[region] >= s.maxPerRegion[region] {
        return false
    }
    s.activeCallsByRegion[region]++
    return true
}
```

Reject new calls that exceed regional capacity. Display a "service unavailable" to the user.

---

## Appendix X: Throttling in IoT Devices

IoT devices have constraints: low memory, low CPU, intermittent connectivity. Rate limiting is essential.

### Reporting rate

A sensor reports temperature. Should it report every second? Every minute? It depends on:

- The application: a freezer alarm needs second-level data; a weather station can tolerate 15-minute intervals.
- Bandwidth: cellular data costs money.
- Battery: each transmission consumes power.

Design the reporting cadence based on these constraints.

### Compression and batching

Batch reports into one request:

```c
// Pseudo-code for an embedded device
buffer[N];
int idx = 0;
every second:
    buffer[idx++] = read_sensor();
    if idx == N:
        send(buffer);
        idx = 0;
```

Send 60 readings in one HTTP request every minute. Much more efficient than 60 separate requests.

### Server-side accept rate

The IoT platform receives reports from millions of devices. It limits per-device:

```go
func (p *Platform) AcceptReport(deviceID string, report Report) error {
    if !p.limiter.Allow(deviceID) {
        return ErrRateLimited
    }
    return p.store.Save(report)
}
```

A misbehaving device that reports 1000 times per second is throttled to prevent it from saturating the ingest pipeline.

### Adaptive cadence

The server tells the device what cadence to use:

```json
{
  "ack": true,
  "next_report_in": 60
}
```

The device sleeps `next_report_in` seconds before reporting again. The server adjusts based on load.

### MQTT throttling

MQTT brokers (Mosquitto, EMQX) have built-in rate limits per client:

```
max_publish_rate 100
max_inflight_messages 20
```

Tune based on expected device behavior. Misbehaving devices are disconnected.

---

## Appendix Y: Throttling and Compliance

Some rate limits are mandated by law or regulation.

### GDPR right to be forgotten

A user can request deletion of their data. The system must comply within 30 days. Mass deletion requests must be rate-limited to avoid overwhelming the database:

```go
type DeletionQueue struct {
    limiter *rate.Limiter
}

func (q *DeletionQueue) Process(userID string) error {
    q.limiter.Wait(context.Background())
    return q.deleteAll(userID)
}
```

Rate-limit deletions to (say) 100/sec, so a wave of deletion requests doesn't take down the production database.

### PCI-DSS

Payment processing requires strict access control and audit. Rate-limit access to PCI-scoped systems:

- Cap per-user query rate on customer payment data.
- Alert on unusual access patterns.
- Block external access entirely if unauthorized.

The limits here are for security, not capacity.

### Telemarketing laws (TCPA)

In the US, TCPA limits how often you can call/text consumers. Rate-limit outbound SMS:

```go
type SMSCompliance struct {
    perRecipientPerHour int
    perRecipientPerDay  int
}

func (c *SMSCompliance) Allow(recipient string) bool {
    return c.hourLimiter.Allow(recipient) && c.dayLimiter.Allow(recipient)
}
```

Violation can result in $500-$1500 per call. Don't violate.

### Email regulations (CAN-SPAM, CASL)

Mass emailing requires opt-in. Per-recipient throttling and unsubscribe handling are mandatory. The rate limit is one signal among several.

### Healthcare (HIPAA)

Patient data access must be logged and rate-limited. A clinician accessing 1000 records per minute is suspicious; flag and review.

```go
func (l *PatientAccessLimiter) Allow(clinicianID, patientID string) bool {
    if !l.perClinician.Allow(clinicianID) {
        l.alertSuspicious(clinicianID)
        return false
    }
    return true
}
```

---

## Appendix Z: A Final Checklist

Before deploying a rate limiter to production, verify:

- [ ] Algorithm chosen and documented (token bucket / sliding window / GCRA).
- [ ] Rate and burst values chosen based on downstream capacity, not guessed.
- [ ] Burst size large enough for legitimate user behavior.
- [ ] Per-user vs per-IP vs per-endpoint scoping is clear.
- [ ] HTTP 429 response with `Retry-After` and `X-RateLimit-*` headers.
- [ ] `Retry-After` value is non-zero and includes jitter on the client.
- [ ] Distributed limiter has fail-open/fail-closed decision documented.
- [ ] Backing store (Redis) failure modes have a fallback.
- [ ] Local fallback for when distributed backing store is unhealthy.
- [ ] Metrics exported: allowed, denied (by reason), wait time, current tokens.
- [ ] Dashboards built and reviewed.
- [ ] Alerts configured for sustained denial rate > 10%.
- [ ] Alerts configured for backing store error rate > 1%.
- [ ] Limit values reviewable without redeployment (config file, feature flag).
- [ ] Customers documented: what limit, what headers, how to handle 429.
- [ ] Idempotency-Key support for safe retries on POST.
- [ ] Retry budget on the client to prevent retry storms.
- [ ] Circuit breaker integration so retries don't pile up.
- [ ] Load test verifies the limiter works under realistic load.
- [ ] Chaos test verifies the limiter fails gracefully.
- [ ] Runbook for "limiter denying too much" scenarios.
- [ ] Runbook for "limiter denying too little" scenarios.
- [ ] Postmortem template includes "was the rate limiter the cause/cure?".

This is a long list. Each item represents a lesson learned, sometimes the hard way. A team that hits all of them has rate limiting figured out.

---

## Appendix AA: The 30-Day Rate Limit Audit

A periodic audit keeps limits aligned with reality. Run quarterly:

### Day 1: Inventory

List every rate limiter in the system:

- Server-side: middleware, application, downstream calls, log throttling.
- Client-side: SDKs, retries, polling.
- Infrastructure: CDN, WAF, service mesh, database.

For each, record:

- Where it lives (file, config).
- Its configured rate.
- Its scope (per-user, per-IP, global).
- Its observability (metrics, alerts).
- Its last-tuned date.

### Day 2-5: Measure

For each limiter, gather metrics:

- Average rate over the past 30 days.
- Peak rate.
- p99 rate.
- Denial rate.
- Wait time p99 (for waiting limiters).

### Day 6-10: Analyze

For each limiter, ask:

- Is the average rate close to the configured rate? If much lower, the limit is generous; if much higher, the limit is too tight.
- Is the peak rate at or above the limit? If so, the limiter is working as intended; if below, the limit may be unnecessary.
- Is the denial rate acceptable? > 5% sustained suggests misconfiguration.
- Is the wait time tolerable? > 1 second suggests over-load or under-provisioning.

### Day 11-15: Plan changes

For limiters that are misaligned:

- Tighten if too generous and the downstream is showing strain.
- Loosen if too tight and legitimate users are denied.
- Migrate algorithm if the workload has changed (e.g., from burst-heavy to steady).

### Day 16-25: Implement

Roll out changes with the migration patterns covered earlier:

- Shadow mode first.
- Gradual rollout (10%, 50%, 100%).
- Monitor metrics and roll back if issues.

### Day 26-29: Document

Update documentation:

- Customer-facing API docs (if limits changed).
- Internal runbooks.
- Architecture diagrams.

### Day 30: Review

Schedule the next audit. Reflect on what changed and why.

This discipline keeps the system healthy. Without it, limits drift, customers feel friction, the system surprises operators.

---

## Appendix BB: Selected Reading

### Papers and articles

- "An Empirical Study on Rate-Limiting Strategies for Apache Cassandra" — academic study on algorithm choice.
- "Rate-Limiting Strategies and Techniques" by Cloudflare engineering blog — practical patterns.
- "Stripe's Rate Limiters" by Brandur Leach — GCRA implementation, retry semantics.
- "Adaptive Concurrency Limits" by Netflix Tech Blog — adaptive concurrency limiting.
- "Doorman: Global Distributed Client Side Rate Limiting" by Google — coordinator-based distributed limits.
- "Hierarchical Token Buckets in Linux Networking" — original HTB algorithm.

### Books

- "Site Reliability Engineering" by Google — chapter on rate limiting in distributed systems.
- "Release It!" by Michael Nygard — circuit breakers, bulkheads, related patterns.
- "Designing Data-Intensive Applications" by Martin Kleppmann — covers throttling in streaming systems.

### Source code

- `golang.org/x/time/rate` — the canonical Go limiter.
- `github.com/uber-go/ratelimit` — a leaky-bucket alternative.
- `github.com/throttled/throttled` — GCRA-based limiter.
- `github.com/lyft/ratelimit` — Lyft's RLS for Envoy.
- Linux kernel `net/sched/sch_htb.c` — HTB qdisc.

### Standards

- RFC 6585 — HTTP 429 status code.
- RFC 7231 — Retry-After header.
- IETF draft-ietf-httpapi-ratelimit-headers — standardized RateLimit headers (in progress).

---

## Appendix CC: Closing Thoughts

We have covered debounce and throttle across five documents — from the basics in `junior.md` through the senior-level math and patterns to this professional-level operational guide. The journey reflects how an engineer grows:

- A junior knows the tools.
- A middle uses them in real code.
- A senior designs them and debugs them.
- A professional owns them as production infrastructure.

The pattern is the same for many topics in distributed systems. Each topic has these layers, and mastery means traveling all of them.

Throttling and debouncing seem like minor details. They are not. They are the regulators of a complex system, the throttle bodies and brake pedals of a vehicle that runs at high speed. A miscalibrated regulator can cause an outage, frustrate users, or amplify a small problem into a catastrophe. A well-calibrated one is invisible — which is exactly the goal.

The next time you write `time.AfterFunc` or `rate.NewLimiter`, pause for a moment. Ask: what is this protecting? Against what? With what failure mode? Observable how? Tunable by whom? Documented where? The answers form a small architecture in your head. The code that follows is the implementation.

That is the professional level. That is engineering.

End of document.


