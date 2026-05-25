# The Go Execution Tracer — Find the Bug

Real "what the trace revealed" scenarios. For each: the symptom, the trace shape that exposed it, and the fix. Reading them in order builds the eye you need to diagnose runtime issues in the wild.

---

## Bug 1: The "parallel" pipeline that ran serially

```go
func process(items []Item) []Result {
    out := make([]Result, len(items))
    var wg sync.WaitGroup
    for i, it := range items {
        wg.Add(1)
        go func(i int, it Item) {
            defer wg.Done()
            mu.Lock()
            out[i] = transform(it)   // expensive, holds mu
            mu.Unlock()
        }(i, it)
    }
    wg.Wait()
    return out
}
```

**Symptom.** With `GOMAXPROCS=8`, throughput is the same as `GOMAXPROCS=1`.

**Trace shape.** All P lanes light up briefly, then one P stays bright while the others go pale (runnable, waiting). The "Synchronization blocking profile" is dominated by `(*sync.Mutex).Lock` from this function.

**Cause.** `mu` serializes the entire workload. Spawning N goroutines doesn't help when N-1 of them sit blocked on `mu.Lock`.

**Fix.** Move the work outside the lock; use the lock only for the single-pointer store.

```go
r := transform(it)
mu.Lock()
out[i] = r
mu.Unlock()
```

Or drop the lock entirely — indexed writes to distinct slots in a slice are safe without synchronization.

---

## Bug 2: The handler that "spent 200 ms" but burned 5 ms CPU

```go
func handle(w http.ResponseWriter, r *http.Request) {
    a, _ := userService.Get(ctx, r.URL.Query().Get("u"))
    b, _ := authzService.Check(ctx, a)
    c, _ := profileService.Get(ctx, b)
    fmt.Fprintf(w, "%v", c)
}
```

**Symptom.** P99 latency is 220 ms. CPU profile sums to 5 ms of work.

**Trace shape.** The handler goroutine has three sequential `GoBlockNet` gaps, each ~70 ms. Three child goroutines spawn from `http.Client`, each waits, returns; the handler resumes between them.

**Cause.** Three serial RPCs to independent services. The handler is mostly waiting on the network, sequentially.

**Fix.** Run them concurrently with `errgroup`. If `authzService` depends on `a` but `profileService` doesn't, split into two waves.

```go
g, ctx := errgroup.WithContext(ctx)
var a User; var c Profile
g.Go(func() error { var err error; a, err = userService.Get(ctx, u); return err })
g.Go(func() error { var err error; c, err = profileService.Get(ctx, u); return err })
if err := g.Wait(); err != nil { ... }
ok, _ := authzService.Check(ctx, a)
```

After the trace shows the two `GoBlockNet` gaps overlapping, total ≈ max instead of sum.

---

## Bug 3: The goroutine surge from a leaked `time.After`

```go
for {
    select {
    case msg := <-ch:
        handle(msg)
    case <-time.After(5 * time.Second):
        log.Println("heartbeat")
    }
}
```

**Symptom.** Long-running service shows `runtime.NumGoroutine()` climbing by ~thousands per minute. Memory follows.

**Trace shape.** Goroutine analysis shows huge counts in `time.goFunc` / `time.Timer.fire`. Most are blocked in waiting state, all with the same closure.

**Cause.** Each iteration starts a fresh timer. If `ch` fires first, the timer is *not* garbage-collected until it expires 5 seconds later. With `ch` firing 100×/s, that's 500 in-flight timers at any moment, and the closure each captures keeps everything alive.

**Fix.** Reuse one timer with `Reset`, or upgrade to Go 1.23+ where `time.After` no longer leaks after the select returns.

```go
t := time.NewTimer(5 * time.Second)
defer t.Stop()
for {
    if !t.Stop() { select { case <-t.C: default: } }
    t.Reset(5 * time.Second)
    select {
    case msg := <-ch:
        handle(msg)
    case <-t.C:
        log.Println("heartbeat")
    }
}
```

---

## Bug 4: The GC that runs every 200 ms in a "low memory" service

**Symptom.** RSS is 80 MiB; `GODEBUG=gctrace=1` prints a line every 200 ms.

**Trace shape.** GC events repeat at fixed intervals. `gcBgMarkWorker` slices cover ~10% of every interval. Heap chart sawtooth crosses `next_gc` constantly.

**Cause.** Allocation rate is high (the *rate*, not the live size). Default `GOGC=100` means GC at 2× live; on a small heap, 2× is tiny, so cycles fire constantly.

**Fix.** Two equally valid options:

1. Reduce allocation rate. Profile `-alloc_objects`, fix the top sites (often `fmt.Sprintf`, `[]byte(s)`, interface boxing).
2. Set a memory budget so the pacer has room.

```go
import "runtime/debug"
debug.SetMemoryLimit(512 << 20)   // 512 MiB cap
// or
debug.SetGCPercent(300)            // GC at 4× live
```

After: GC cycles drop to one every few seconds; CPU freed for real work.

---

## Bug 5: The cgo call that froze a P for 50 ms

```go
result := C.expensive_image_decode(buf)
```

**Symptom.** Latency p99 spikes; one P "disappears" from the timeline for 50 ms periodically.

**Trace shape.** Bottom-of-view thread (M) lane shows an M running but not on any P during the spike. No Go events on that P during the window. After 50 ms, the M returns and a `GoSysExit` fires.

**Cause.** cgo calls hand the M to C. While in C, no Go events fire. The runtime may or may not detach the P depending on how long the call runs; if it doesn't detach quickly enough, that P is unavailable.

**Fix.**

- Move the cgo work off the hot path (worker pool, background job).
- If the call is unavoidable, increase `GOMAXPROCS` so one stuck P matters less.
- If you control the C code, break it into smaller calls so the runtime can detach the P.

---

## Bug 6: The goroutines stuck on a closed-but-not-drained channel

```go
in := make(chan Job)
out := make(chan Result, 100)
for i := 0; i < 10; i++ {
    go func() {
        for j := range in {
            out <- work(j)
        }
    }()
}
// caller forgets to drain out, never closes in
```

**Symptom.** Goroutine count grows monotonically; trace shows worker goroutines blocked.

**Trace shape.** "Goroutine analysis" lists 10 workers each blocked on `chan send` (out). "Synchronization blocking profile" attributes it all to `worker.func1`. Heap chart climbs because each blocked goroutine pins its stack and any captured state.

**Cause.** `out` is full. All workers wait to send. The producer is gone or blocked elsewhere. Classic goroutine leak.

**Fix.** Always pair workers with a context, and always make the destination cancel-aware:

```go
for j := range in {
    select {
    case out <- work(j):
    case <-ctx.Done():
        return
    }
}
```

---

## Bug 7: The hot loop that never yields

```go
func search(haystack []byte, needle byte) int {
    for i := 0; i < len(haystack); i++ {
        if haystack[i] == needle {
            return i
        }
    }
    return -1
}

// called with len(haystack) ~= 10^9
```

**Symptom.** One CPU pegged at 100% for many seconds. Other goroutines on the same P get poor latency.

**Trace shape.** One goroutine running continuously for 10 seconds without a `GoSched` or `GoPreempt`. Pre-Go 1.14 this would starve everything; post-1.14 you see periodic `GoPreempt` events every ~10 ms.

**Cause.** The function holds a P with no natural yield point. Async preemption catches it eventually, but other runnable goroutines accumulate `Sched wait` for those 10 ms windows.

**Fix.**

- Use `bytes.IndexByte` (SIMD optimized).
- Break the work into chunks and yield: `if i%1<<20 == 0 { runtime.Gosched() }`.
- Bound the search size; reject early.

---

## Bug 8: The cache miss that allocates 10 MiB per request

```go
func render(req *Request) []byte {
    re := regexp.MustCompile(`\b(?P<user>\w+)@(?P<host>[\w.]+)\b`)
    return re.ReplaceAll(req.Body, []byte("[$user]"))
}
```

**Symptom.** Latency unchanged, but RSS bursts and GC fires every few requests.

**Trace shape.** Heap chart sawtooth correlated with request rate. `gcAssistAlloc` slices appear on the handler goroutine.

**Cause.** `regexp.MustCompile` allocates the compiled regex (NFA tables, byte arrays) per call. At high QPS, that's the dominant allocation.

**Fix.** Compile once at package init.

```go
var userHostRe = regexp.MustCompile(`\b(?P<user>\w+)@(?P<host>[\w.]+)\b`)

func render(req *Request) []byte {
    return userHostRe.ReplaceAll(req.Body, []byte("[$user]"))
}
```

After: heap chart flattens, GC cycles drop in frequency.

---

## Bug 9: The DB pool that defeated the worker pool

```go
db.SetMaxOpenConns(4)

for _, id := range ids {
    go func(id int) {
        row := db.QueryRow("SELECT ... WHERE id = ?", id)
        process(row)
    }(id)
}
```

**Symptom.** Scaling `GOMAXPROCS` from 4 to 16 doesn't help throughput.

**Trace shape.** Despite many goroutines, only 4 are ever in the `running` state simultaneously. All others are blocked on `database/sql.(*DB).conn`. The mutex profile points to `database/sql` internals.

**Cause.** The Go-level connection pool is the bottleneck, not the scheduler. 4 connections = 4 concurrent queries.

**Fix.** Raise `SetMaxOpenConns` to match real concurrency, ensure your DB allows it. Watch DB-side connection count too — there's an upstream limit.

```go
db.SetMaxOpenConns(50)
db.SetMaxIdleConns(50)
db.SetConnMaxLifetime(5 * time.Minute)
```

---

## Bug 10: The DNS lookup that ate 300 ms per cold connection

```go
client := &http.Client{Timeout: 5 * time.Second}
resp, _ := client.Get("https://api.example.com/...")
```

**Symptom.** First-call latency in a fresh container is 300 ms higher than subsequent calls.

**Trace shape.** First request goroutine shows a long `GoBlockSyscall` gap during the resolver step. Stacks in the syscall blocking profile point to `net._C_getaddrinfo`.

**Cause.** `net.Resolver` defaults to cgo `getaddrinfo`, which is a blocking syscall. Cold DNS takes time.

**Fix.**

- Pre-warm: call `net.DefaultResolver.LookupHost(ctx, host)` at startup.
- Use Go's pure resolver: `GODEBUG=netdns=go`.
- Cache resolutions with `singleflight`.
- For known endpoints, hard-code the IP if the deployment allows.

---

## Bug 11: The "leak" that wasn't — just RSS not releasing

```go
func ingest() {
    data := loadEverything()    // 2 GiB
    process(data)
    data = nil
}
```

**Symptom.** Operator says memory leak. `runtime.MemStats.HeapAlloc` is 100 MiB after `ingest`, but RSS still says 2 GiB.

**Trace shape.** Heap chart drops correctly. RSS chart (from Prometheus) stays elevated. GC events fire, sweep completes, no goroutine leak.

**Cause.** Linux `MADV_FREE` lets the kernel reclaim pages lazily; until pressure, RSS stays high. The Go runtime *did* release the memory; the kernel just hasn't taken it back.

**Fix.** Confirm with `runtime/metrics` `/memory/classes/heap/released:bytes` — should be high. If you must release:

```go
debug.FreeOSMemory()
```

Or set `GODEBUG=madvdontneed=1`. In container environments with `GOMEMLIMIT`, neither is usually needed — the runtime accounts pressure.

Trace artifact: the symptom isn't visible in the execution trace itself; the trace is fine. This is a metrics-interpretation bug.

---

## Bug 12: The latency spike from one slow request

A high-traffic service shows occasional p99 spikes. Logs don't correlate. CPU profile of the spike window looks like the rest.

**Trace shape.** A single goroutine slice runs for 80 ms on one P. Adjacent slices on the same P show normal handler durations. The slow goroutine's stack: `json.Unmarshal` into `map[string]interface{}` of a 2 MiB request body.

**Cause.** A specific malformed but valid client sends a huge JSON payload. Decoding allocates thousands of small `interface{}` values; the GC pacer kicks in during decode; `gcAssistAlloc` slices appear inline.

**Fix.**

- Bound request body size: `r.Body = http.MaxBytesReader(w, r.Body, 64<<10)`.
- Decode into a typed struct, not `map[string]interface{}`.
- For large but legitimate bodies, stream-decode with `json.NewDecoder`.

Without the trace, this would have been "intermittent slowness, no pattern." The trace pointed at the single slow goroutine and its stack within minutes.

---

## Bug 13: The deadlock the trace caught before it caused an outage

Two services on the same node exchange data:

```go
// service A
go func() {
    for req := range serviceA.inbound {
        resp := serviceB.Call(req)  // RPC
        serviceA.outbound <- resp
    }
}()

// service B's handler eventually calls back into service A
```

**Symptom.** Under load, both services freeze. Latency goes to infinity. Restart fixes it.

**Trace shape.** Goroutine analysis from a flight-recorder dump: all of service A's worker goroutines blocked on `GoBlockNet` (waiting for B); all of B's handler goroutines blocked on `GoBlockNet` (waiting for A). The "Synchronization blocking profile" is empty. The "Network blocking profile" is huge.

**Cause.** Circular RPC. A holds all its threads waiting on B; B fills its handler pool waiting on A; the next request fails to find a free handler in either service. Standard distributed deadlock manifesting as network blocking.

**Fix.**

- Add per-call timeouts so the deadlock dissolves quickly.
- Add a circuit breaker between services.
- Restructure: break the cycle (B should fetch what it needs proactively, not call back).

The flight recorder caught this *before* the on-call had to triage during the incident; the dump was inspected during a postmortem and the pattern was obvious.

---

## 14. Summary

Execution-trace bugs fall into a small number of archetypes: hidden serialization (under-parallelism, single-lock fan-outs), runtime drag (GC pressure, syscall blocking, cgo P-holding), goroutine leaks (timer churn, blocked sends, missing context plumbing), and external-system stalls visible only as network blocking. Each has a recognizable shape in the trace; learning the shapes is most of trace-driven debugging. When the CPU profile and the metrics don't agree on what's slow, the trace is the third source that settles it.

---

## Further reading
- Felix Geisendorfer, "Reading a Go trace": https://blog.felixge.de/reading-go-execution-traces/
- `runtime/trace` package: https://pkg.go.dev/runtime/trace
- Go diagnostics guide: https://go.dev/doc/diagnostics
- "Common Go mistakes": https://100go.co
