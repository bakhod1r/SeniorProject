# Chain of Responsibility — Optimization Exercises

Working chains with measurable improvements. Numbers illustrative (`go1.22`); reproduce with `go test -bench`.

---

## Exercise 1: Build the chain once

**Before** — assembled per request:
```go
func ServeHTTP(w, r) { Chain(routes, mw...).ServeHTTP(w, r) }
```

**After** — assembled at startup:
```go
var handler = Chain(routes, mw...)
func ServeHTTP(w, r) { handler.ServeHTTP(w, r) }
```

| Metric | Before | After |
|--------|--------|-------|
| Allocations/request | 6 (one closure per middleware) | 0 |
| p99 latency overhead | ~1.5µs | ~0µs |

The chain is immutable after construction; there's no reason to rebuild it.

---

## Exercise 2: Short-circuit early to skip expensive links

**Before** — rate limiting and body parsing run before auth:
```go
Chain(handler, Parse, RateLimit, Auth) // Auth innermost → runs last
```
Unauthorized requests still parse the body and consume a rate token.

**After** — auth first:
```go
Chain(handler, Auth, RateLimit, Parse)
```

| Metric | Before | After |
|--------|--------|-------|
| Work done for an unauthorized request | parse + token + auth | auth only |
| CPU under an auth-failing flood | high | minimal |

Ordering is a performance lever, not just correctness: cheap rejections belong first.

---

## Exercise 3: Avoid per-link allocation in hot interceptors

**Before** — each interceptor wraps args in a new struct/closure per call on a high-QPS gRPC path.

**After** — pre-allocate reusable state at chain-build time; keep per-call work allocation-free (read from `ctx`, write to existing buffers).

| Metric | Before | After |
|--------|--------|-------|
| Allocations/RPC | 4 | 0 |
| Throughput | 120k RPC/s | 180k RPC/s |

---

## Exercise 4: Flatten a hot, fixed chain

**Before** — a 5-link chain invoked per-message in a million-msg/s pipeline; interface dispatch dominates.

**After** — since the order is fixed and never reconfigured, inline the five steps into one function.

| Metric | Before | After |
|--------|--------|-------|
| Per-message time | 95ns | 22ns |
| Indirect calls/message | 5 | 0 |

Lesson: CoR's flexibility costs indirection; for a fixed hot path, flatten it. Keep the chain only where reconfigurability earns its keep.

---

## Exercise 5: Cache the assembled per-route chains

**Before** — a router rebuilds each route's middleware stack on every match.

**After** — build each route's chain once at registration and store the assembled handler in the route table.

| Metric | Before | After |
|--------|--------|-------|
| Per-request chain assembly | yes | no (table lookup) |
| Allocations/request | N closures | 0 |

---

## Exercise 6: Move logging off the hot path

**Before** — a logging middleware formats and writes a line synchronously per request, blocking on I/O.

**After** — gate by level with an atomic check and hand the line to an async logger (buffered channel + background writer).

| Metric | Before | After |
|--------|--------|-------|
| Logging cost/request | ~8µs (sync write) | ~0.2µs (enqueue) |
| Tail latency under log pressure | spiky | flat |

---

## Measurement checklist
- [ ] Build chains once; assert 0 allocs/request in a benchmark.
- [ ] Order cheap rejections (auth, rate limit) first.
- [ ] Keep per-call interceptor work allocation-free on hot paths.
- [ ] Flatten fixed hot chains; keep CoR only where order varies.
- [ ] Cache per-route assembled chains.
- [ ] Make logging async/level-gated.
