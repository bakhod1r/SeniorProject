# pprof and Profiling Tools — Find the Bug

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Bug 1: pprof Imported but Never Reachable](#bug-1-pprof-imported-but-never-reachable)
3. [Bug 2: Library That Imports pprof](#bug-2-library-that-imports-pprof)
4. [Bug 3: Public Pprof Endpoint](#bug-3-public-pprof-endpoint)
5. [Bug 4: Unbounded Label Cardinality](#bug-4-unbounded-label-cardinality)
6. [Bug 5: Labels Not Propagated](#bug-5-labels-not-propagated)
7. [Bug 6: Two CPU Profiles at Once](#bug-6-two-cpu-profiles-at-once)
8. [Bug 7: Mutex Profile Disabled by Default](#bug-7-mutex-profile-disabled-by-default)
9. [Bug 8: Heap Profile Without GC](#bug-8-heap-profile-without-gc)
10. [Bug 9: Stripped Binary with No Symbol Server](#bug-9-stripped-binary-with-no-symbol-server)
11. [Bug 10: Mass Goroutine Profile Storm](#bug-10-mass-goroutine-profile-storm)
12. [Bug 11: Custom Profile Without Remove](#bug-11-custom-profile-without-remove)
13. [Bug 12: Wrong Debug Level](#bug-12-wrong-debug-level)
14. [Bug 13: Trace as a Profile](#bug-13-trace-as-a-profile)
15. [Bug 14: Pprof Endpoint Behind a Slow Middleware](#bug-14-pprof-endpoint-behind-a-slow-middleware)
16. [Bug 15: Comparing Profiles of Different Lengths](#bug-15-comparing-profiles-of-different-lengths)
17. [How to Approach Pprof Bugs](#how-to-approach-pprof-bugs)

---

## How to Use This File

Each bug presents a short code or workflow with a defect. Try to spot it before reading the analysis. The bugs are real — every one of them has been seen in production.

---

## Bug 1: pprof Imported but Never Reachable

```go
package main

import (
    "fmt"
    _ "net/http/pprof"
)

func main() {
    fmt.Println("running")
    select {} // pretend long-running
}
```

`curl http://localhost:6060/debug/pprof/` returns connection refused.

### Analysis

The import alone does nothing useful. `net/http/pprof.init()` registers routes on `http.DefaultServeMux`, but there is no `http.ListenAndServe` running. The blank-identifier import is necessary but not sufficient.

### Fix

```go
import (
    "log"
    "net/http"
    _ "net/http/pprof"
)

func main() {
    go func() {
        log.Println(http.ListenAndServe("127.0.0.1:6060", nil))
    }()
    select {}
}
```

---

## Bug 2: Library That Imports pprof

A library you wrote:

```go
// mylib/init.go
package mylib

import _ "net/http/pprof"
```

After importing `mylib`, the host binary's HTTP API suddenly exposes `/debug/pprof/`.

### Analysis

Libraries should never import `net/http/pprof`. The import has a hidden side effect: it mutates `http.DefaultServeMux`. Now any consumer who runs an HTTP server with `nil` mux unknowingly exposes profile endpoints.

### Fix

Move the import to the main package of each consumer that wants pprof. Do not export the side effect via libraries.

---

## Bug 3: Public Pprof Endpoint

```go
http.ListenAndServe(":6060", nil)
```

The host is on the public internet. Logs show a steady stream of `/debug/pprof/profile?seconds=600` requests.

### Analysis

`":6060"` binds to all interfaces. An attacker discovered the endpoint and is forcing 10-minute CPU profiles repeatedly. Each one adds ~5% CPU overhead and exfiltrates code structure.

### Fix

Bind to localhost and clamp durations:

```go
go http.ListenAndServe("127.0.0.1:6060", adminMuxWithAuth())
```

Reach the endpoint via SSH tunnel.

---

## Bug 4: Unbounded Label Cardinality

```go
func handler(w http.ResponseWriter, r *http.Request) {
    rid := r.Header.Get("X-Request-Id")
    pprof.Do(r.Context(), pprof.Labels("request_id", rid), func(ctx context.Context) {
        process(ctx, r)
    })
}
```

The pprof endpoint slows from 50 ms to 30 s. Memory climbs. The Pyroscope dashboard becomes unusable.

### Analysis

Every request has a unique `request_id`. Every distinct label set is its own internal entry in the profile's tag table. Over millions of requests the profile grows to gigabytes.

### Fix

Use coarse labels only:

```go
pprof.Do(r.Context(), pprof.Labels(
    "endpoint", r.URL.Path,
    "method",   r.Method,
    "tenant",   tenantOf(r),
), ...)
```

For per-request granularity, use `runtime/trace` tasks, not labels.

---

## Bug 5: Labels Not Propagated

```go
pprof.Do(ctx, pprof.Labels("tenant", "acme"), func(ctx context.Context) {
    go backgroundWork() // forgot to apply labels
})
```

`tagfocus=tenant=acme` returns no background-work goroutines.

### Analysis

`go f()` starts a fresh goroutine with empty labels. The labels on the parent do not propagate automatically.

### Fix

```go
pprof.Do(ctx, pprof.Labels("tenant", "acme"), func(ctx context.Context) {
    go func() {
        pprof.SetGoroutineLabels(ctx)
        backgroundWork()
    }()
})
```

Or wrap your goroutine launcher to do this once and for all.

---

## Bug 6: Two CPU Profiles at Once

```go
http.HandleFunc("/profile", func(w http.ResponseWriter, r *http.Request) {
    f, _ := os.Create("/tmp/cpu.prof")
    defer f.Close()
    pprof.StartCPUProfile(f)
    defer pprof.StopCPUProfile()
    time.Sleep(30 * time.Second)
})
```

Two operators hit `/profile` simultaneously. The second returns "cpu profiling already in use."

### Analysis

The runtime allows only one CPU profile at a time. Without a guard, concurrent requests panic or error.

### Fix

Serialise with a mutex or semaphore. Better: do not put CPU profiling on a user-facing endpoint at all. Use `/debug/pprof/profile` (which has the same constraint but at least returns a clean 500).

```go
var cpuSem = make(chan struct{}, 1)

http.HandleFunc("/profile", func(w http.ResponseWriter, r *http.Request) {
    select {
    case cpuSem <- struct{}{}:
        defer func() { <-cpuSem }()
    default:
        http.Error(w, "busy", http.StatusTooManyRequests)
        return
    }
    pprof.StartCPUProfile(w)
    defer pprof.StopCPUProfile()
    time.Sleep(30 * time.Second)
})
```

---

## Bug 7: Mutex Profile Disabled by Default

A developer adds mutex profiling to debug contention:

```go
curl -o mu.prof http://host:6060/debug/pprof/mutex
go tool pprof mu.prof
(pprof) top
# No samples
```

### Analysis

The mutex profile is **off by default**. Without `runtime.SetMutexProfileFraction(n)` it records nothing.

### Fix

```go
func init() {
    runtime.SetMutexProfileFraction(100) // 1 in 100
}
```

Same applies to the block profile: `runtime.SetBlockProfileRate(int(time.Millisecond))`.

---

## Bug 8: Heap Profile Without GC

```bash
curl -o h.prof http://host:6060/debug/pprof/heap
go tool pprof h.prof
(pprof) top
# 500 MB allocated to a function that has not run in 10 minutes
```

### Analysis

Without `?gc=1`, the profile includes dead-but-not-yet-collected objects. What looks like a leak may just be retained garbage.

### Fix

```bash
curl -o h.prof "http://host:6060/debug/pprof/heap?gc=1"
```

Pay the cost of a GC; get clean data.

---

## Bug 9: Stripped Binary with No Symbol Server

Production binary built with `-ldflags="-s -w"`. A profile from prod shows:

```
0x1234abcd
0x5678efef
```

instead of function names.

### Analysis

`-w` drops DWARF. Symbols are normally still available via `gopclntab`, but if the binary was stripped further or the profile was captured by an eBPF tool that does not consult `gopclntab`, you get raw addresses.

### Fix

Either ship unstripped binaries (the size cost is usually acceptable), or set up remote symbolisation:

```bash
go tool pprof -symbolize=remote http://symbol-server/symbolicate prod.prof
```

---

## Bug 10: Mass Goroutine Profile Storm

A monitoring script:

```bash
while true; do
    curl -s http://host:6060/debug/pprof/goroutine > /dev/null
    sleep 1
done
```

The service starts dropping p99 latency.

### Analysis

Each goroutine profile call stops the world to walk `allgs`. On a service with 100k goroutines, each pause is a few milliseconds. Doing it every second pegs ~1% of wall time in stop-the-world.

### Fix

Sample once a minute or less. For raw count, use `runtime.NumGoroutine()` exposed via a `/metrics` endpoint — cheap.

---

## Bug 11: Custom Profile Without Remove

```go
var conns = pprof.NewProfile("open_conns")

func handle(c net.Conn) {
    conns.Add(c, 0)
    // ... never calls conns.Remove(c)
}
```

`/debug/pprof/open_conns` grows forever even though connections close cleanly.

### Analysis

`Add` and `Remove` must be paired. The custom profile is a separate accounting structure from the actual object lifecycle.

### Fix

```go
func handle(c net.Conn) {
    conns.Add(c, 0)
    defer conns.Remove(c)
    // ...
}
```

---

## Bug 12: Wrong Debug Level

```bash
curl http://host:6060/debug/pprof/goroutine?debug=2 | wc -l
# 4823521
```

The on-call engineer asked for a quick goroutine count.

### Analysis

`debug=2` prints every goroutine with its full stack. For 100k goroutines that is 5+ million lines. The engineer wanted `debug=1` (grouped, much smaller).

### Fix

```bash
curl http://host:6060/debug/pprof/goroutine?debug=1 | head -1
```

The first line is `goroutine profile: total <N>`.

---

## Bug 13: Trace as a Profile

```bash
go tool pprof http://host:6060/debug/pprof/trace?seconds=5
# fails with "unrecognized profile"
```

### Analysis

A trace is not a pprof profile. It uses a different binary format and is opened with `go tool trace`, not `go tool pprof`.

### Fix

```bash
curl -o trace.out http://host:6060/debug/pprof/trace?seconds=5
go tool trace trace.out
```

---

## Bug 14: Pprof Endpoint Behind a Slow Middleware

```go
mux.Use(loggingMiddleware)
mux.Use(authMiddleware)
mux.Use(tracingMiddleware)
mux.Use(rateLimitMiddleware)

mux.Handle("/debug/pprof/", pprof.Index)
```

Profiles take 30+ seconds to return. CPU profile is even worse — the middleware adds spans for every nanosecond of profile streaming.

### Analysis

Generic middleware was applied to admin routes. The tracing middleware in particular adds overhead per byte streamed, which destroys a CPU profile.

### Fix

Put admin routes on a **separate mux** with no middleware (or only auth):

```go
adminMux := http.NewServeMux()
adminMux.Handle("/debug/pprof/", pprof.Index)
// no logging, no tracing
```

---

## Bug 15: Comparing Profiles of Different Lengths

```bash
curl -o cpu1.prof http://host:6060/debug/pprof/profile?seconds=30
curl -o cpu2.prof http://host:6060/debug/pprof/profile?seconds=10

go tool pprof -base cpu1.prof cpu2.prof
```

The "after" profile looks 3x smaller. The team panics about CPU regression.

### Analysis

The two profiles cover different durations. Absolute sample counts are not comparable. The "regression" is just less collection time.

### Fix

Always use the same `seconds=` value:

```bash
curl -o cpu1.prof http://host:6060/debug/pprof/profile?seconds=30
curl -o cpu2.prof http://host:6060/debug/pprof/profile?seconds=30
go tool pprof -base cpu1.prof cpu2.prof
```

Or compare normalised rates: total CPU samples / duration.

---

## How to Approach Pprof Bugs

A short triage workflow:

1. **Is pprof reachable?** `curl /debug/pprof/`. If 404 or connection refused, the import or the listener is missing.
2. **Is it on the right interface?** `netstat -lntp | grep 6060`. Should be `127.0.0.1`, not `0.0.0.0`.
3. **Is it the right profile?** Goroutine for leaks, heap for memory, profile for CPU, trace for latency.
4. **Is the profile complete?** Stripped binary with bad symbolisation? Mutex/block profile not enabled? Wrong debug level?
5. **Is the comparison fair?** Same `seconds=`, same `?gc=1` or not, same labels enabled.
6. **Is the workload representative?** A profile during deploy or warmup tells you about deploy or warmup, not steady state.

Most pprof bugs are configuration bugs, not code bugs. The code is fine; the operator or developer asked the wrong question or used the wrong flag.
