# Profiling Concurrent Go Code — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Concurrency Profiling Workflow](#the-concurrency-profiling-workflow)
3. [Mutex Profile in Depth](#mutex-profile-in-depth)
4. [Block Profile in Depth](#block-profile-in-depth)
5. [Goroutine Profile Mastery](#goroutine-profile-mastery)
6. [CPU Profile in a Concurrent Program](#cpu-profile-in-a-concurrent-program)
7. [`runtime/trace` — the trace.out UI](#runtimetrace--the-traceout-ui)
8. [Diff-Profiling Concurrent Code](#diff-profiling-concurrent-code)
9. [`pprof -lines` vs `-functions`](#pprof--lines-vs--functions)
10. [Continuous Profiling Backends](#continuous-profiling-backends)
11. [Real-World Walk-Throughs](#real-world-walk-throughs)
12. [Common Anti-Patterns](#common-anti-patterns)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

At junior level you learned what the three concurrency profiles record and how to enable them. At middle level you debug live systems with them. You know which one to reach for first based on the symptom. You read mutex and block output without guessing at units. You navigate the `go tool trace` UI without getting lost in the timeline. You diff before/after profiles to verify a fix actually changed lock contention. And you have an answer for "should we ship continuous profiling?" — yes, and you know which tool you would pick.

After this file you will:

- Pick the right profile for a given symptom in seconds.
- Read mutex and block output and explain "wait time" correctly to a teammate.
- Use `go tool trace` to find scheduler latency, goroutine analysis, and synchronisation blocking.
- Diff two block profiles to prove a fix reduced contention.
- Know the three production-grade continuous profilers and pick one for your stack.
- Recognise the common anti-patterns specific to concurrent profiling.

For label-driven analysis (`pprof.Do`, custom trace tasks/regions) and fleet-scale profiling architecture see `senior.md`. For sampler internals see `professional.md`.

---

## The Concurrency Profiling Workflow

A bug report arrives: "the API got slow." Your starting move is not "open a profiler." It is "classify the symptom." The five symptoms have five different first profiles.

| Symptom | First profile | Then |
|---------|---------------|------|
| CPU pegged | `profile?seconds=30` | `top -cum`, `list` hot fns |
| Latency high, CPU low | `block?` (must be enabled) | trace if block is empty |
| Memory growing | `heap?gc=1` | diff vs baseline |
| Goroutines growing | `goroutine?debug=1` | diff |
| Tail latency spikes | `trace?seconds=5` | scheduler latency view |

The middle three rows of that table are concurrent-specific. CPU and memory you mostly know already.

The rule of thumb: **CPU low + latency high = something is blocking**. Reach for block, mutex, or trace.

### The triage script

```bash
#!/usr/bin/env bash
host=${1:-127.0.0.1:6060}
ts=$(date +%Y%m%dT%H%M%S)
mkdir -p "snapshots/$ts"
cd "snapshots/$ts"

curl -so cpu.prof    "http://$host/debug/pprof/profile?seconds=15" &
curl -so heap.prof   "http://$host/debug/pprof/heap?gc=1" &
curl -so g.prof      "http://$host/debug/pprof/goroutine" &
curl -so g2.txt      "http://$host/debug/pprof/goroutine?debug=2" &
curl -so mutex.prof  "http://$host/debug/pprof/mutex" &
curl -so block.prof  "http://$host/debug/pprof/block" &
curl -so trace.out   "http://$host/debug/pprof/trace?seconds=5" &
wait
echo "snapshot at $(pwd)"
```

Drop this in `/usr/local/bin/go-snap` and learn it as muscle memory. The 15 s CPU profile and the 5 s trace overlap — that's fine, they measure different things.

---

## Mutex Profile in Depth

### What it actually samples

When a goroutine calls `Mutex.Lock` and the lock is held by someone else, the runtime can record a sample. What gets recorded:

- **Stack of the goroutine that released the lock** (the one whose hold caused the wait).
- **Wait time of the goroutine that had to wait.**

The fraction parameter says "sample roughly 1 in N contended events."

```go
runtime.SetMutexProfileFraction(100) // ~1% sampling
```

Set to `0` to disable. Set to `1` only for short forensic windows.

### `RWMutex` semantics

`sync.RWMutex` is two profile sites in one. A blocked `RLock` (a reader waiting because a writer holds the lock) is recorded. A blocked `Lock` on the writer side (waiting for readers to release) is recorded. Both attribute to whichever `Unlock` or `RUnlock` released the lock.

This is the easiest way to discover that your "read-heavy" workload is actually being held up by a slow writer.

### Reading the output

```
$ go tool pprof mutex.prof
(pprof) top
Showing nodes accounting for 12.3s, 100% of 12.3s total
      flat  flat%   sum%        cum   cum%
    8.20s 66.67% 66.67%     8.20s 66.67%  sync.(*Mutex).Unlock /shared/cache.go:114
    2.40s 19.51% 86.18%     2.40s 19.51%  sync.(*RWMutex).RUnlock /shared/index.go:42
    1.70s 13.82%   100%     1.70s 13.82%  sync.(*Mutex).Unlock /worker/queue.go:88
```

Three things to notice:

1. The "samples" are **nanoseconds of contention** — `8.20s` means goroutines collectively waited 8.2 seconds on the lock used at `cache.go:114` during the profile window.
2. The attribution is at the `Unlock` site. Run `(pprof) list cache.go` to see the surrounding code — the *real* answer to "what was the hot critical section" is the work done between `Lock` and that `Unlock`.
3. Always use `top -cum` then `list` rather than `top` alone. The contention point and the slow code are usually in the same file but not the same function.

### Using `list` to find the culprit

```
(pprof) list cache.go
ROUTINE ======================== main.(*Cache).Get
        0          0   |  func (c *Cache) Get(k string) (V, bool) {
        0          0   |      c.mu.Lock()
        0          0   |      defer c.mu.Unlock()
        0          0   |      v, ok := c.deepLookup(k) // slow
        8.2s     8.2s   |      return v, ok
        0          0   |  }
```

The slow line is the one above the `Unlock` — `deepLookup`. That is the work that needs to be moved outside the lock.

### When the mutex profile is empty

- Forgot to call `SetMutexProfileFraction`.
- Fraction is `0`.
- The contention is on something that isn't a `sync.Mutex` — channels, `sync.Once`, runtime internal locks. Try the block profile.
- The window is too short or the load too low. Run for longer.

---

## Block Profile in Depth

The block profile is broader: every blocking sync operation. Includes:

- `chan` send and receive (buffered or unbuffered).
- `select`.
- `sync.Mutex.Lock`, `sync.RWMutex.RLock`, `sync.RWMutex.Lock` — yes, mutex shows up here too.
- `sync.WaitGroup.Wait`.
- `sync.Cond.Wait`.
- `time.Sleep`.
- `runtime.GC` waiting.

### Enabling

```go
runtime.SetBlockProfileRate(int(time.Millisecond))
```

The argument is nanoseconds. Events shorter than the rate are still sampled probabilistically; events longer are always recorded. `0` disables. `1` records everything.

For production, `int(time.Millisecond)` (= 1_000_000) is the standard starting point.

### Reading the output

```
$ go tool pprof block.prof
(pprof) top
Showing nodes accounting for 18.6s, 100% of 18.6s total
      flat  flat%   sum%        cum   cum%
   10.5s 56.45% 56.45%    10.5s 56.45%  runtime.chanrecv /worker/dispatch.go:51
    5.6s 30.11% 86.56%     5.6s 30.11%  sync.(*Mutex).Lock /cache.go:42
    2.5s 13.44%   100%     2.5s 13.44%  time.Sleep /retry.go:18
```

The interpretation differs by type:

- `runtime.chanrecv` / `runtime.chansend` — a channel was empty / full and the goroutine slept.
- `sync.(*Mutex).Lock` — same lock contention you'd see in the mutex profile, attributed differently.
- `time.Sleep` — usually noise. Filter with `-ignore=time.Sleep`.

### Block vs mutex on the same lock

```
mutex profile:  8.20s @ cache.go:114 (Unlock)
block profile:  8.50s @ cache.go:42  (Lock)
```

Both are the same lock. The mutex profile points to the release site (where the slow code that held the lock lives). The block profile points to the acquisition site (where the waiter is). Use the mutex profile for "what was the critical section doing" and the block profile for "who is waiting on this."

### Block profile units, in plain English

The "samples" axis is **summed wait time across all goroutines**. If five goroutines waited one second each on the same channel send, the value is 5 s, not 1 s. This is what you want when ranking by impact, but it can confuse newcomers. Compare against wall-clock duration of the profile window: if the block profile reports more time than the window had, that just means many goroutines were blocked concurrently — normal in a healthy server.

---

## Goroutine Profile Mastery

The goroutine profile is a snapshot. Three formats:

```
?debug=0  binary, for go tool pprof
?debug=1  grouped text, one line per unique stack with count
?debug=2  every goroutine printed individually, with wait reason
```

### `debug=1` for triage

```
goroutine profile: total 1245
1200 @ 0x123 0x456 0x789
#       0x123   main.worker+0x42        /src/worker.go:33
#       0x456   main.dispatch+0x21      /src/dispatch.go:12
#       0x789   main.main+0xf3          /src/main.go:55
```

A single stack representing 1200 goroutines: probable leak or expected pool. To decide, look at the call site. If it's a worker pool with a fixed size and you have 1200, you have a leak. If it's a request handler and you have 200 concurrent requests, fine.

### `debug=2` for state

```
goroutine 4321 [chan receive, 12 minutes]:
main.worker(0xc0001234)
        /src/worker.go:33 +0x42
```

The `[chan receive, 12 minutes]` is the wait reason and duration. Wait reasons you will see often:

- `chan receive` / `chan send` — channel operation.
- `select` — multi-way wait.
- `semacquire` — mutex or WaitGroup.
- `sleep` — `time.Sleep`.
- `GC scavenge wait` — runtime internal.
- `IO wait` — netpoller (HTTP server, network connection).
- `sync.Cond.Wait` — condition variable.

If a goroutine has been in `chan receive` for "12 minutes" and your worker shouldn't live that long, you have a leak.

### Pre-computing aggregates

`debug=2` is verbose. For 50,000 goroutines you need scripting:

```bash
curl -s 'http://host:6060/debug/pprof/goroutine?debug=2' \
  | awk '/^goroutine/{print $3}' \
  | sort | uniq -c | sort -rn | head
```

That gives you wait-reason histogram. `1240 [chan receive]` says 1240 goroutines are in `chan receive`. Where? Look at one with `[chan receive, ...]` in the same dump and read the stack.

---

## CPU Profile in a Concurrent Program

A CPU profile in a concurrent program has subtleties.

### Multi-P sampling

`pprof` samples 100 times per second **per OS thread**, not per process. With `GOMAXPROCS=4`, you get roughly 400 samples per second total. Always check `(pprof) top` against `total samples` — a 30 second profile on a 4-core machine should yield ~12,000 samples maximum.

### `runtime.gopark` and `runtime.semacquire1`

If the top of the profile is dominated by these symbols, your CPU time is spent **going to sleep**. That's a strong signal to switch to block/mutex profiles. The CPU profile is telling you "I have no idea what you're doing because you're not doing it."

### Sync churn in a CPU profile

A high `flat` time in `sync.(*Mutex).Lock` does **not** necessarily mean contention. It can also mean uncontended fast-path overhead — the lock is acquired and released so often that even the fast path adds up. The mutex profile will be empty in that case (no contention recorded). Refactoring to lock less is the fix; don't reach for sharding yet.

### Garbage collection in the profile

GC workers run on user goroutines (assist) and on dedicated worker goroutines. You'll see `runtime.gcAssistAlloc` or `runtime.gcBgMarkWorker` in profiles. If GC dominates a concurrent program, that's a different problem — the allocs profile is your next stop, not the mutex profile.

---

## `runtime/trace` — the trace.out UI

The single most powerful tool for "explain this slow request." Let's walk the UI.

### Capture

```bash
curl -o trace.out 'http://127.0.0.1:6060/debug/pprof/trace?seconds=5'
go tool trace trace.out
```

The browser opens at `127.0.0.1:<random_port>`. Top-level views:

1. **View trace** — the timeline.
2. **Goroutine analysis** — per-function summary.
3. **Network blocking profile** — time blocked in netpoller.
4. **Synchronization blocking profile** — time blocked on sync primitives.
5. **Syscall blocking profile** — time in blocking syscalls (cgo, file I/O).
6. **Scheduler latency profile** — time goroutines were runnable but not running.
7. **User-defined tasks / regions** — only present if you instrumented.

### View trace — the timeline

The most intimidating view. The horizontal axis is wall-clock time over the trace duration. The vertical axis has tracks:

- **PROCS** — one row per P. Each colored block is a goroutine running on that P.
- **STATS** — counters: heap size, goroutine count, threads.
- **(per-task / per-region tracks)** if you instrumented.

Click on a block to see the goroutine ID and the stack at that moment.

Look for:

- **Long single-color stretches** on one P with others idle: serial section.
- **Gaps** in all Ps: nothing scheduled, often blocked I/O or GC.
- **A pink GC band**: stop-the-world; should be brief.

Keyboard: `w` zoom in, `s` zoom out, `a` left, `d` right. The UI inherits Chrome trace conventions.

### Goroutine analysis

Click "Goroutine analysis." A list appears, each line a function that started one or more goroutines. Click one to see the per-goroutine breakdown:

| Column | Meaning |
|--------|---------|
| Execution time | on-CPU |
| Network wait | blocked in netpoller |
| Sync block | blocked on mutex/chan/etc. |
| Block syscall | blocked in syscall |
| Scheduler wait | runnable but not running |
| GC sweeping | helping the sweeper |
| GC pause | stopped for STW |

This is the single most useful view for "where did this goroutine spend its time."

### Synchronization blocking profile

A pprof-style flame graph of sync blocking time, sourced from the trace. More precise than the regular block profile because it's exhaustive over the window, not sampled.

### Scheduler latency profile

The hidden gem. Shows time spent **runnable but not yet on CPU**. If this is large, you are under-scaled — too many goroutines, not enough Ps. The fix is `GOMAXPROCS` tuning ([01-gomaxprocs](../01-gomaxprocs/)) or reducing concurrency.

### Tasks and regions

If your code uses `trace.NewTask` and `trace.WithRegion`, the "User-defined tasks" view groups events by task. Indispensable for "what did this request do." Senior topic — see `senior.md`.

---

## Diff-Profiling Concurrent Code

The `-base` flag is the most under-used pprof feature. Use it for every fix to a concurrency bug.

### Workflow

```bash
# Before the fix: capture
curl -o before-mutex.prof 'http://host:6060/debug/pprof/mutex'
curl -o before-block.prof 'http://host:6060/debug/pprof/block'

# Deploy the fix. Wait for load to normalise.

curl -o after-mutex.prof 'http://host:6060/debug/pprof/mutex'
curl -o after-block.prof 'http://host:6060/debug/pprof/block'

# Compare
go tool pprof -base before-mutex.prof after-mutex.prof
(pprof) top
```

Positive numbers in the diff = contention got *worse*. Negative = better.

### Diffing trace? Not directly.

`go tool trace` doesn't do diffs. Use the synchronization blocking profile inside each trace, dump as pprof, and diff those.

Or, more practically: pick a representative metric out of "Goroutine analysis" (sync block time for the request handler, say), record it before and after, and compare.

---

## `pprof -lines` vs `-functions`

`go tool pprof` aggregates samples by default at the **function** level — all samples in `main.worker` sum into one entry regardless of line.

For tightly contended code this can hide the answer. Two `Lock` calls in the same function on different mutexes both show up as `sync.(*Mutex).Lock` — same function, different lines.

Switch granularity:

```
(pprof) granularity=lines
(pprof) top
```

Or from the command line:

```bash
go tool pprof -lines mutex.prof
(pprof) top
```

The output now distinguishes `sync/mutex.go:81` (Lock) from `sync/mutex.go:108` (Unlock) and so on. Sometimes the answer is hiding in a single line that aggregated-by-function obscured.

Granularity levels:

- `functions` (default) — one entry per function.
- `filefunctions` — one per file + function.
- `lines` — one per source line.
- `addresses` — one per machine instruction. Rarely useful in Go.

For mutex/block profiles specifically, **always switch to `lines`** — the function-level aggregation hides which lock is hot.

---

## Continuous Profiling Backends

Capturing profiles by hand during incidents has a problem: by the time you SSH in, the bad behaviour may be over. Continuous profiling stores profiles every N seconds in a backend you can query historically.

Three production-grade tools, all support Go:

### Pyroscope (now Grafana Pyroscope)

- Single binary, Grafana dashboard.
- Pulls profiles from your service every 10–15 s by default.
- Supports labels, flame graphs in Grafana, comparison views.
- Best fit: teams already on Grafana.

### Parca

- Independent project, kubernetes-native.
- Stores pprof natively; query as Parquet via `parca-debuginfo`.
- Best fit: kubernetes-heavy environments, eBPF-style continuous profiling.

### Polar Signals Cloud

- Hosted Parca, plus extras (PGO, allocation tracking, debug info management).
- Best fit: small teams who want zero-ops profiling.

All three pull the same profiles you would curl manually — `goroutine`, `heap`, `allocs`, `mutex`, `block`, `profile`. Enable mutex and block on the service first; otherwise the continuous profiler shows empty data.

A typical setup: enable continuous profiling for `goroutine`, `heap`, and `profile` always; turn on `mutex` and `block` at fraction 100 / rate 1 ms; query the backend during incidents.

---

## Real-World Walk-Throughs

### Diagnosing a mutex contention bug

A service running fine in dev becomes slow under production load.

1. CPU profile: low CPU (~15%). Top of profile: `runtime.gopark`.
2. Latency p99 is bad. Off-CPU is the culprit.
3. Mutex profile: 30 s of contention in a 60 s window, attributed to `metrics.go:88`.
4. `(pprof) list metrics.go:88`:

   ```go
   func (m *Metrics) Record(name string, v float64) {
       m.mu.Lock()
       defer m.mu.Unlock()
       m.histograms[name].Observe(v)   // <- slow
   }
   ```

5. The fix: per-tenant `*Metrics` instances, or a `sync.Map` keyed by name, or precompute the histogram pointer per request.
6. After fix: mutex profile diff shows -25 s. Latency p99 back to baseline.

### Finding the slow channel

A pipeline that should run at 10k qps runs at 2k.

1. CPU profile is empty for the worker function. It runs ~5% of expected.
2. Block profile: `runtime.chansend` at `pipeline.go:42` dominates.
3. `list pipeline.go:42`: the producer is sending to a buffered channel of capacity 4 used by a single consumer.
4. Fix: bump capacity (cheap), parallelise the consumer (better).
5. After: block profile diff shows -90% at that site. Throughput hits 10k qps.

### Tail latency, no obvious culprit

p99 latency is 800 ms; median is 4 ms.

1. Block/mutex profiles show nothing dramatic on average.
2. Capture a 5 s trace during peak.
3. Goroutine analysis → look at the request handler function. Click it.
4. Per-goroutine breakdown shows a handful with 700 ms "scheduler wait."
5. Scheduler latency profile confirms: the system is over-scheduled.
6. Fix: reduce concurrency. Either lower a worker pool size or set a semaphore on inbound requests.

---

## Common Anti-Patterns

### Anti-pattern: looking only at the CPU profile for concurrency bugs

A 5% CPU profile with `runtime.gopark` at the top is not "your goroutines are idle." It's "your goroutines are blocked." Switch profiles.

### Anti-pattern: leaving mutex profile fraction at 1 forever

```go
runtime.SetMutexProfileFraction(1) // DO NOT ship this
```

Fine for a 1-minute forensic window. In steady-state production it adds measurable CPU and memory cost — exactly the opposite of what you want when chasing a perf issue.

### Anti-pattern: capturing trace at production scale "just to see"

A 60-second trace on a busy server can be 2+ GB. You will not be able to open it. Cap at 5 s or use targeted traces around the suspect operation.

### Anti-pattern: `top` without `granularity=lines` on a mutex profile

Two locks in the same function will be aggregated. You'll think there's one hot lock when there are two.

### Anti-pattern: storing profiles indefinitely without rotation

Profile files are small but accumulate. Rotate to S3 with a TTL of weeks, not years.

### Anti-pattern: comparing `flat` of `Mutex.Lock` to total CPU

Mutex profile time is wait time, not CPU time. You cannot say "Lock is 30% of CPU" from the mutex profile.

### Anti-pattern: trusting `runtime.NumGoroutine()` as the live count

It's a fast read but a single moment. Snapshot the goroutine profile if you need detail. For graphs over time, prefer `runtime/metrics` (`/sched/goroutines:goroutines`).

---

## Self-Assessment

- [ ] I can pick the right profile for each row of the symptom table without looking it up.
- [ ] I can read a mutex profile and explain "wait time" correctly.
- [ ] I can read a block profile and distinguish channel waits from mutex waits.
- [ ] I can navigate `go tool trace` to find scheduler latency and sync blocking.
- [ ] I diff every concurrency fix to prove the improvement.
- [ ] I switch to `granularity=lines` automatically on mutex/block profiles.
- [ ] I know the three continuous profilers and can argue for one.
- [ ] I've debugged at least one real contention issue using these tools.

---

## Summary

Middle-level concurrent profiling is about workflow, not new APIs. The profiles you already enabled at junior level are the inputs. The decisions — which to look at first, how to read the units, when to escalate to `runtime/trace`, what to compare against — are the skill. The most important habit is **diff** every fix. The second most important is **`granularity=lines`** on mutex and block profiles, where function-level aggregation hides the real culprit. The third is **continuous profiling**: pay the small upfront setup cost so that history is on hand the next time an incident strikes. At senior level we'll add labels (`pprof.Do`), custom trace tasks, and fleet-scale profiling architecture.
