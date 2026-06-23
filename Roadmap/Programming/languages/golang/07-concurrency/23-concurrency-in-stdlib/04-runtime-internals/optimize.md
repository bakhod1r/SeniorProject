---
layout: default
title: Runtime Internals — Optimize
parent: Runtime Internals Used by Stdlib
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/04-runtime-internals/optimize/
---

# Runtime Internals Used by Stdlib — Optimize

[← Back](../)

> Scenarios where choosing the right runtime knob, primitive, or pattern yields measurable improvement. Each scenario includes before/after, expected gain, and verification approach.

---

## Scenario 1 — `LockOSThread` for batch cgo calls

**Before.** Many small cgo calls, each migrating the goroutine across Ms:
```go
func processMany(items []Item) {
	for _, it := range items {
		C.cFunc(C.int(it.value)) // each call may run on a different M
	}
}
```

Each cgo entry may swap the M, save/restore signal masks, and re-acquire OS-thread-local state.

**After.** Pin once for the batch:
```go
func processMany(items []Item) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	for _, it := range items {
		C.cFunc(C.int(it.value))
	}
}
```

**Expected gain.** 1.5-3x for batches of >100 cgo calls when the C side has per-thread state (e.g., OpenGL contexts, locale, OpenSSL error queue).

**Verification.** `go test -bench=. -benchtime=5s -cpuprofile=cpu.out` and compare time spent in `runtime.cgocall` vs `runtime.entersyscall`.

**Caveat.** If cgo calls are long-running and rare, pinning hurts because the M cannot serve other goroutines.

---

## Scenario 2 — When `LockOSThread` HURTS: lock-and-run on a worker pool

**Before.**
```go
worker := func() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	for job := range jobs {
		doWork(job) // pure Go, no cgo
	}
}
```

This worker monopolises an M; with 8 workers and `GOMAXPROCS=8`, no other goroutine can use those Ms.

**After.** Drop `LockOSThread` if no C state is involved:
```go
worker := func() {
	for job := range jobs {
		doWork(job)
	}
}
```

**Expected gain.** Better tail latency for unrelated goroutines (network I/O, timers) that would otherwise wait for an idle M.

**Verification.** Compare `runtime.NumCPU()` vs `runtime.NumGoroutine()` during load; look at `/debug/pprof/goroutine` for goroutines stuck in `Gwaiting` for the scheduler.

---

## Scenario 3 — Tuning `GOMEMLIMIT` to reduce GC frequency

**Before.** Default `GOGC=100`, large heap allocates and triggers many GC cycles:
```
GODEBUG=gctrace=1 ./service
gc 1 @0.1s 5%: ...
gc 2 @0.5s 8%: ...
gc 3 @0.9s 10%: ...
```

**After.** Set `GOMEMLIMIT=4GiB` if you have 8 GiB RAM available; GC runs less frequently:
```
GOMEMLIMIT=4GiB GODEBUG=gctrace=1 ./service
gc 1 @0.1s 2%: ...
gc 2 @3.0s 3%: ...
```

**Expected gain.** Throughput up 10-30% for allocation-heavy workloads, at the cost of higher steady-state memory. Tail latency improves because STW phases happen less often.

**Verification.** `runtime/metrics`: `/gc/heap/live:bytes`, `/gc/cycles/total:gc-cycles`, `/cpu/classes/gc/total:cpu-seconds`.

**Caveat.** With `GOMEMLIMIT`, the GC will run *more* aggressively as you approach the limit. Set it conservatively.

---

## Scenario 4 — Reducing `SetMutexProfileFraction` overhead in production

**Before.**
```go
runtime.SetMutexProfileFraction(1) // sample every contention event
```

Every contended mutex unlock records a stack trace. On a system with millions of mutex events/sec, the profiler itself becomes a bottleneck.

**After.**
```go
runtime.SetMutexProfileFraction(100) // sample 1 in 100 events
```

**Expected gain.** 5-20% CPU reclaimed under heavy mutex contention; still enough samples to identify hot mutexes.

**Verification.** Before/after `pprof.Lookup("mutex").Count` per second; check overall throughput.

---

## Scenario 5 — Replacing periodic `runtime.Stack(buf, true)` with `runtime.NumGoroutine`

**Before.** A health-check endpoint that dumps all goroutines every 30 s for "observability":
```go
func goroutinesHandler(w http.ResponseWriter, r *http.Request) {
	buf := make([]byte, 1<<20)
	n := runtime.Stack(buf, true) // STW!
	w.Write(buf[:n])
}
```

If this is hit by Kubernetes liveness probes, you STW every 10 s.

**After.** Use the cheap counter for routine probes; expose `runtime.Stack` only on a debug-protected endpoint:
```go
func healthHandler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "goroutines: %d\n", runtime.NumGoroutine())
}
```

**Expected gain.** Eliminates STW pauses that show up in p99 latency.

**Verification.** Compare `gc_pause_ns` and STW counters in `runtime/metrics` (`/sched/pauses/stopping/gc:seconds`, `/sched/pauses/total/other:seconds`).

---

## Scenario 6 — `SetBlockProfileRate(0)` once you know the answer

**Before.**
```go
runtime.SetBlockProfileRate(1) // forever
```

Every blocking event (channel send/recv, mutex wait, select) is recorded. Useful during diagnosis; pure overhead in steady state.

**After.** Enable on demand:
```go
http.HandleFunc("/debug/block-start", func(w http.ResponseWriter, r *http.Request) {
	runtime.SetBlockProfileRate(1000) // 1 us
	time.AfterFunc(60*time.Second, func() {
		runtime.SetBlockProfileRate(0)
	})
})
```

**Expected gain.** 1-5% throughput reclaimed depending on contention. Profile only when you have a question.

---

## Scenario 7 — Avoiding `sync.Mutex` slow path with `procPin`-style sharding

**Before.** A high-rate global counter:
```go
var counter atomic.Int64

func inc() { counter.Add(1) }
```

Under heavy contention, the atomic suffers cache-line bouncing.

**After.** Per-P shards using `sync.Pool` (which uses `procPin` internally):
```go
type counter struct {
	shards []paddedInt64
}
type paddedInt64 struct { v atomic.Int64; _ [56]byte }

func (c *counter) Inc() {
	p := runtime_procPin()
	c.shards[p].v.Add(1)
	runtime_procUnpin()
}

func (c *counter) Total() int64 {
	var sum int64
	for i := range c.shards {
		sum += c.shards[i].v.Load()
	}
	return sum
}
```

**Expected gain.** 5-50x for high-contention counters, since each P writes to its own cache line.

**Verification.** Run with multiple goroutines on `GOMAXPROCS` Ps, benchmark; check `perf stat` for cache-coherence (`L1-dcache-load-misses`).

**Caveat.** `procPin` is internal API (`go:linkname`); use `sync.Pool`-based approaches or write your own with care for forward compatibility.

---

## Scenario 8 — Reducing finalizer pressure

**Before.** Every short-lived `*Foo` registers a finalizer:
```go
func newFoo() *Foo {
	f := &Foo{...}
	runtime.SetFinalizer(f, (*Foo).cleanup)
	return f
}
```

Every GC cycle, all unreachable finalizable objects are queued to the finalizer goroutine, which executes them sequentially. Millions of finalizers per cycle become a serialization point.

**After.** Use explicit `Close` + `defer`; only set finalizers as a *warning* layer:
```go
func newFoo() *Foo {
	f := &Foo{closed: false}
	runtime.SetFinalizer(f, func(p *Foo) {
		if !p.closed {
			log.Printf("WARNING: Foo not closed")
		}
	})
	return f
}

func (f *Foo) Close() {
	if !f.closed {
		f.cleanup()
		f.closed = true
		runtime.SetFinalizer(f, nil) // remove finalizer once Close is called
	}
}
```

**Expected gain.** Eliminates finalizer-queue contention; resources are released promptly.

---

## Scenario 9 — Reduced `runtime.Gosched` in modern Go

**Before.** Spin loop sprinkled with `Gosched`:
```go
for !done.Load() {
	runtime.Gosched()
}
```

On Go 1.14+, async preemption handles tight loops; manual `Gosched` adds scheduler overhead without benefit.

**After.** Use a real wait:
```go
<-doneCh
```

or
```go
for !done.Load() {
	time.Sleep(time.Millisecond)
}
```

**Expected gain.** Removes per-iteration scheduler dispatch; if the loop is short, eliminates the busy-wait entirely.

**Verification.** `pprof.Lookup("goroutine")` to confirm waiters are `chan receive`, not `runnable`.

---

## Scenario 10 — Using `GOGC=off` plus manual `runtime.GC` in batch jobs

**Before.** A batch job that allocates GB and frees it all at the end runs many GC cycles during processing.

**After.**
```go
debug.SetGCPercent(-1) // disable automatic GC
processBatch()
runtime.GC() // collect once at the end
```

**Expected gain.** 10-30% throughput in allocation-heavy batch workloads, since GC is delayed to a single big sweep.

**Caveat.** Only safe if you have enough RAM for the entire working set. With `GOMEMLIMIT`, GC will still trigger near the limit.

---

## Scenario 11 — Pre-allocating to avoid finalizer-driven cleanup churn

**Before.**
```go
func handler(w http.ResponseWriter, r *http.Request) {
	conn := db.Open() // *Conn with finalizer
	defer conn.Close()
	// ...
}
```

**After.** Pool the connections:
```go
var pool = sync.Pool{
	New: func() any { return db.Open() },
}

func handler(w http.ResponseWriter, r *http.Request) {
	conn := pool.Get().(*db.Conn)
	defer pool.Put(conn)
	// ...
}
```

**Expected gain.** Fewer allocations, fewer finalizer registrations, fewer GC cycles. Tail latency improves.

**Caveat.** `sync.Pool` evicts on GC; for connections that are expensive to create, use a custom pool with explicit `Close`.

---

## Scenario 12 — Tuning `GODEBUG=schedtrace=1000` for diagnostics

**Before.** Hard to see scheduling behaviour:
```
./service
```

**After.**
```
GODEBUG=schedtrace=1000,scheddetail=1 ./service > sched.log
```

You get per-second snapshots of every P's queue length and goroutine state.

**Use.** Diagnose:
- Persistent run-queue imbalance (indicates affinity issues).
- Long `_Gwaiting` populations (indicates blocking primitive contention).
- Many `_Gsyscall` (indicates blocking syscalls — consider non-blocking I/O).

---

## Scenario 13 — `runtime/trace` instead of CPU profile for I/O-bound services

**Before.** CPU profile shows mostly `runtime.netpoll`, no useful signal.

**After.** Capture an execution trace:
```go
trace.Start(f)
defer trace.Stop()
```

Open with `go tool trace trace.out`; see goroutine lifelines, syscall durations, GC events. Identifies long blocks invisible to CPU profiling.

**Expected gain.** Diagnostic insight, not throughput.

---

## Optimisation checklist

- Use `LockOSThread` only when C requires it; otherwise let the runtime schedule.
- Set `GOMEMLIMIT` for predictable memory; reserve `GOGC` for backward compat.
- Profile-on-demand: leave `SetMutexProfileFraction` and `SetBlockProfileRate` at 0 by default.
- Never put `runtime.Stack(buf, true)` in a hot path or health check.
- Replace finalizers with explicit `Close` + `defer`.
- Prefer channels and `sync.Cond` over `runtime.Gosched` busy loops.
- Shard hot atomics per-P when contention is the bottleneck.
- Use `runtime/trace` for I/O-bound services where CPU profiles are uninformative.
- Toggle `GOGC=off` only inside well-bounded batch jobs.
- Use `GODEBUG=schedtrace=1000` for scheduling diagnostics, not production.
