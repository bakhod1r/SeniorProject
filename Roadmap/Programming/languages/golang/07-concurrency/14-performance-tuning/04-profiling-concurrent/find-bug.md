# Profiling Concurrent Go Code — Find the Bug

## Table of Contents
1. [How to Use This Page](#how-to-use-this-page)
2. [Bug 1 — The Mystery Slowdown](#bug-1--the-mystery-slowdown)
3. [Bug 2 — Empty Mutex Profile](#bug-2--empty-mutex-profile)
4. [Bug 3 — Throughput Wall](#bug-3--throughput-wall)
5. [Bug 4 — Tail Latency Spikes](#bug-4--tail-latency-spikes)
6. [Bug 5 — Reader Starvation](#bug-5--reader-starvation)
7. [Bug 6 — The Misleading CPU Profile](#bug-6--the-misleading-cpu-profile)
8. [Bug 7 — Goroutine Leak in the Pool](#bug-7--goroutine-leak-in-the-pool)
9. [Bug 8 — Trace Is Empty](#bug-8--trace-is-empty)
10. [Bug 9 — Lock Coarsening Gone Wrong](#bug-9--lock-coarsening-gone-wrong)
11. [Bug 10 — The Phantom Contention](#bug-10--the-phantom-contention)
12. [Bug 11 — Scheduler Latency](#bug-11--scheduler-latency)
13. [Bug 12 — The Cgo Detour](#bug-12--the-cgo-detour)
14. [Bug 13 — Profile Labels Don't Appear](#bug-13--profile-labels-dont-appear)
15. [Bug 14 — `time.Sleep` Dominates Block Profile](#bug-14--timesleep-dominates-block-profile)

---

## How to Use This Page

Each bug starts with a symptom and a snippet. Read the snippet, predict the cause, then check the **Diagnosis** and **Fix** sections. The pattern matters more than memorising the answer: most concurrent profiling bugs fall into a small set of shapes.

---

## Bug 1 — The Mystery Slowdown

**Symptom.** A service's p99 doubled from 50 ms to 100 ms after a deploy. CPU usage is unchanged. The new deploy added a `metrics.Record` call on every request.

```go
type Metrics struct {
    mu sync.Mutex
    h  map[string]*Histogram
}

func (m *Metrics) Record(name string, v float64) {
    m.mu.Lock()
    defer m.mu.Unlock()
    h, ok := m.h[name]
    if !ok {
        h = NewHistogram()
        m.h[name] = h
    }
    h.Observe(v)
}
```

**Diagnosis.** Capture mutex profile. Top: `(*Metrics).Record` at the Unlock site, 2 s contention per second of wall time. The map lookup and `Histogram.Observe` happen inside the lock; on a 1k-req/s service that serialises everything.

**Fix.** Move the slow part outside the lock. Use `sync.Map` for the lookup, or shard by name hash, or precompute a `*Histogram` per known name.

```go
func (m *Metrics) Record(name string, v float64) {
    h := m.lookup(name) // uses sync.Map, no lock
    h.Observe(v)        // Histogram has its own internal sync
}
```

---

## Bug 2 — Empty Mutex Profile

**Symptom.** You're chasing a contention bug. The mutex profile is empty. The block profile shows nothing either.

**Diagnosis.** Check that the profiles are enabled. Most likely culprit:

```go
// missing from main
runtime.SetMutexProfileFraction(100)
runtime.SetBlockProfileRate(int(time.Millisecond))
```

Both default to disabled. The endpoints exist; they return empty samples.

**Fix.** Enable them at startup. For a production service, also document this in the runbook so the next on-call doesn't waste 20 minutes thinking the tools are broken.

---

## Bug 3 — Throughput Wall

**Symptom.** A pipeline that should run at 50k items/s plateaus at 12k. Adding more producer goroutines doesn't help.

```go
ch := make(chan Item)
go producer1(ch)
go producer2(ch)
go producer3(ch)

go consumer(ch) // single
```

**Diagnosis.** Block profile dominated by `runtime.chansend1` at the producer's send line. Channel unbuffered, single consumer. Producers are serialised through the consumer's work rate.

**Fix.** Either:

- Buffer the channel: `make(chan Item, 1024)`.
- Parallelise the consumer: `for i := 0; i < N; i++ { go consumer(ch) }`.

The right answer depends on whether the consumer is the bottleneck (parallelise) or just bursty (buffer).

---

## Bug 4 — Tail Latency Spikes

**Symptom.** Median latency 4 ms, p99 800 ms. Block/mutex profiles look normal in aggregate.

**Diagnosis.** Capture a 5 s trace during peak. Open `go tool trace`. "Scheduler latency profile": 700 ms in one handler. "Goroutine analysis" → click the handler function: a few outlier goroutines spent 600+ ms in **scheduler wait** state.

The system has too many goroutines competing for too few Ps. Median request finishes fast; tail requests wait their turn.

**Fix.** Reduce concurrency. Options:

- Lower the worker pool size.
- Add a semaphore at request entry: `sem := make(chan struct{}, N); sem <- struct{}{}` per request, release on defer.
- Increase `GOMAXPROCS` if you're CPU-throttled by the container.

---

## Bug 5 — Reader Starvation

**Symptom.** A read-heavy service has occasional huge latency spikes. Reads should be parallel.

```go
type Cache struct {
    mu sync.RWMutex
    data map[string]V
}

func (c *Cache) Get(k string) V { c.mu.RLock(); defer c.mu.RUnlock(); return c.data[k] }
func (c *Cache) Set(k string, v V) { c.mu.Lock(); defer c.mu.Unlock(); c.data[k] = v }
```

**Diagnosis.** Mutex profile shows contention on both `RUnlock` and `Unlock`. A long-running writer (perhaps a bulk update inside `Set`) holds `Lock` for hundreds of ms, blocking all readers.

**Fix.** Two angles:

- Make writes shorter: prepare data outside the lock, swap under lock.

  ```go
  func (c *Cache) BulkSet(items []KV) {
      newMap := buildMap(items)
      c.mu.Lock()
      c.data = newMap
      c.mu.Unlock()
  }
  ```

- Or replace with copy-on-write: `atomic.Pointer[map[string]V]`. Readers do no synchronisation at all.

---

## Bug 6 — The Misleading CPU Profile

**Symptom.** CPU profile says `sync.(*Mutex).Lock` is 30% of CPU. Engineer concludes "the mutex is the bottleneck" and starts sharding.

**Diagnosis.** Capture the mutex profile. It's nearly empty.

The CPU profile sees `Lock` because the uncontended fast path runs millions of times. There's no contention; there's just a lot of locking.

**Fix.** Stop sharding. Reduce locking frequency: amortise, batch, or eliminate. For example, replace per-event lock+update with a sharded atomic counter that flushes to the shared map periodically.

The lesson: **mutex CPU time != mutex contention**. The mutex profile is the source of truth for contention.

---

## Bug 7 — Goroutine Leak in the Pool

**Symptom.** Goroutine count grows linearly over hours. No mutex/block contention.

```go
func (p *Pool) Submit(t Task) {
    go func() {
        result := t.Run()
        p.results <- result // unbuffered, sometimes no reader
    }()
}
```

**Diagnosis.** Capture goroutine profile at `?debug=2`. Many goroutines in `chan send` for many minutes. Stack: the `p.results <-` line.

A leaked reader means the writer blocks forever.

**Fix.**

- Use a select with timeout or done channel:

  ```go
  select {
  case p.results <- result:
  case <-p.done:
  }
  ```

- Or buffer `results` so producers can complete and exit even if there's a brief reader stall.

---

## Bug 8 — Trace Is Empty

**Symptom.** `trace.Start(f); ... ; trace.Stop()` runs, but `go tool trace trace.out` shows nothing.

**Common causes.**

1. `f` was closed before events were flushed. Always `defer f.Close()` **after** `defer trace.Stop()`.

   ```go
   f, _ := os.Create("trace.out")
   defer f.Close()           // closes second (correct order)
   trace.Start(f)
   defer trace.Stop()         // stops first
   ```

2. The traced work didn't happen — you wrapped the whole `main` but the work is in `init`.

3. Another trace was already running. `trace.Start` returns `error`. Check it.

**Fix.** Most often it's order of defers. The Go file system flushes on `Close`, but `trace.Stop` writes the final block — it must run first.

---

## Bug 9 — Lock Coarsening Gone Wrong

**Symptom.** Someone "optimised" by holding a lock across more work. p99 got worse, p50 stayed the same.

```go
// before
for _, x := range items {
    mu.Lock()
    process(x)
    mu.Unlock()
}

// after (the "optimization")
mu.Lock()
for _, x := range items {
    process(x)
}
mu.Unlock()
```

**Diagnosis.** Mutex profile after the change shows large contention values — the critical section is now `len(items) * process_time`. Other goroutines waiting for this lock are stalled.

**Fix.** Revert. If `process` is fast and `items` is small (sub-microsecond), holding the lock once *can* be cheaper because of cache effects. Measure with a benchmark; the mutex profile alone tells you which way wins.

---

## Bug 10 — The Phantom Contention

**Symptom.** Mutex profile shows contention on a lock you've never seen before, deep inside the standard library.

```
top:  100ms sync.(*Mutex).Unlock  fmt/print.go:xxx
```

**Diagnosis.** `fmt.Printf` from many goroutines all writing to `os.Stdout`, which is a `*os.File` with internal locking. The contention is real but mundane.

**Fix.**

- Use a buffered writer pre-serialised on its own goroutine.
- Use a structured logger that batches.
- Or accept the cost if your service isn't actually log-bound.

The lesson: not all contention is your code. The fix sometimes is "stop logging on the hot path."

---

## Bug 11 — Scheduler Latency

**Symptom.** Block profile is empty. Mutex profile is empty. CPU profile is healthy. p99 latency still bad.

**Diagnosis.** `runtime/trace` → "Scheduler latency profile" shows large values. Your goroutines are runnable but starved for P time.

Typical causes:

- `GOMAXPROCS` too low for the workload (especially in containers — see [01-gomaxprocs](../01-gomaxprocs/)).
- Massive goroutine count (millions). Each context switch has cost.
- A CPU-pinned goroutine starving others. (See [03-lockosthread](../03-lockosthread/).)

**Fix.** Tune `GOMAXPROCS`. Reduce the goroutine count. Audit any `runtime.LockOSThread` callers for long-running CPU work.

---

## Bug 12 — The Cgo Detour

**Symptom.** Profiler shows time disappearing into `runtime.cgocall`. Mutex/block profiles innocent. CPU profile partial.

**Diagnosis.** A goroutine in a cgo call runs on a thread that the Go profiler may not be sampling cleanly. The CPU profile sees `cgocall` but the C code inside is invisible.

The goroutine is also not visible to the Go scheduler during the cgo call — it can't be preempted; an M is parked.

**Fix.** Profile the C side separately (perf, valgrind). Reduce cgo call duration. Or reduce cgo concurrency: too many cgo calls in flight means too many Ms.

---

## Bug 13 — Profile Labels Don't Appear

**Symptom.** You added `pprof.Do(ctx, pprof.Labels("endpoint", path), fn)` but `(pprof) tags` shows nothing.

**Common causes.**

1. The function `fn` starts work but returns before the work is done — e.g., spawns a goroutine that outlives `fn`. The labels only persist on the spawned goroutine if it was started inside `pprof.Do`.

2. You used `pprof.WithLabels(ctx, ...)` only — that returns a context but doesn't set goroutine labels. You also need `SetGoroutineLabels(ctx)` or wrap in `pprof.Do`.

3. The profile was captured *before* you reached the labeled code.

**Fix.** Place the label set on the worker goroutine itself:

```go
go func(ctx context.Context) {
    pprof.SetGoroutineLabels(ctx)
    work(ctx)
}(ctx)
```

---

## Bug 14 — `time.Sleep` Dominates Block Profile

**Symptom.** Block profile top entry: `time.Sleep`, 90% of contention time.

**Diagnosis.** The block profile records `time.Sleep` as a blocking event. Useful when sleep itself is the bug ("retry backoff is too aggressive"), noisy otherwise.

**Fix.** Filter:

```bash
go tool pprof -ignore=time.Sleep block.prof
```

Or recognise that you have a retry loop with default behaviour and that's expected. The block profile is most useful with `time.Sleep` filtered out unless you specifically suspect a sleep is wrong.
