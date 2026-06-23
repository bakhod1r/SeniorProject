# pprof and Profiling Tools — Interview Questions

## Table of Contents
1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [System Design Questions](#system-design-questions)
6. [Live Coding Prompts](#live-coding-prompts)
7. [Red-Flag Answers](#red-flag-answers)

---

## Junior Questions

### 1. How do you expose pprof on an HTTP server?

**Expected answer:** `import _ "net/http/pprof"` plus a running `http.Server`. The blank-identifier import runs the package's `init()`, which registers handlers on `http.DefaultServeMux`. Then any `http.ListenAndServe(..., nil)` exposes them.

**Follow-up:** What if I use a custom mux? — Call `pprof.Handler("goroutine")` and friends, registering each path manually.

### 2. What are the three debug levels of the goroutine endpoint?

**Expected answer:**

- `debug=0`: pprof binary protobuf, meant for `go tool pprof`.
- `debug=1`: human-readable text, stacks grouped by uniqueness with a count of goroutines on each.
- `debug=2`: human-readable text, every goroutine printed individually with its state and full stack.

Bonus: state strings like `chan receive`, `IO wait`, `sync.Mutex.Lock`, durations appearing when a goroutine has been parked for a long time.

### 3. Which profile would you take first to investigate a memory leak?

**Expected answer:** `heap` with `?gc=1`, then compare two snapshots with `-base`.

### 4. Why does `import _ "net/http/pprof"` use a blank identifier?

**Expected answer:** Because we only want the package's `init()` to run for its side effects (registering HTTP routes). We do not need any symbols from the package.

### 5. What is the difference between a profile and a trace?

**Expected answer:** A profile is a sample — statistical for CPU/heap, snapshot for goroutine. A trace is a complete log of every scheduler event over a time window. Profiles are small and read with `go tool pprof`; traces are large and read with `go tool trace`.

### 6. Is `runtime.NumGoroutine() == 1000` a leak?

**Expected answer:** Not necessarily. It is a leak only if the number keeps growing under stable load. A service handling 1000 concurrent connections legitimately has 1000 goroutines.

### 7. What command gives you a CPU profile over 30 seconds via HTTP?

**Expected answer:** `go tool pprof http://host:port/debug/pprof/profile?seconds=30`, or `curl -o cpu.prof http://host:port/debug/pprof/profile?seconds=30`.

---

## Middle Questions

### 1. How do you enable the block profile in a Go program, and what does it measure?

**Expected answer:** `runtime.SetBlockProfileRate(n)` where `n` is the threshold in nanoseconds. The profile records goroutines that blocked on synchronisation (channel ops, mutex acquisition, select, etc.) for at least `n` nanoseconds. Off by default because of overhead.

### 2. What does `runtime.SetMutexProfileFraction(100)` do?

**Expected answer:** Enables the mutex profile and samples approximately 1 in 100 contention events. Lower numbers sample more aggressively (and cost more). `1` records every event; `0` disables.

### 3. How do you diff two heap profiles?

**Expected answer:** `go tool pprof -base before.prof after.prof`. Inside the REPL, `top` shows the largest positive differences. Negative numbers are call sites that lost memory.

### 4. What does `?gc=1` do on the heap endpoint?

**Expected answer:** Forces a `runtime.GC()` before sampling so that dead-but-not-yet-collected objects do not show up. Cleaner view of live memory at the cost of a brief pause.

### 5. Difference between `inuse_space` and `alloc_space`?

**Expected answer:** `inuse_space` is bytes still allocated when the sample was taken. `alloc_space` is total bytes allocated since program start. A function that allocates 10 GB and then frees it shows zero in `inuse_space` but 10 GB in `alloc_space`.

### 6. What is the default CPU profile sample rate?

**Expected answer:** 100 Hz (one sample every 10 ms). Adjustable with `runtime.SetCPUProfileRate`.

### 7. What does `go tool pprof -focus=regex` do?

**Expected answer:** Restricts the profile to samples whose stack contains a function matching the regex. Useful to drill into a subsystem.

### 8. How do you take a `runtime/trace`?

**Expected answer:** Either programmatically with `trace.Start(w)`/`trace.Stop()`, or via HTTP at `/debug/pprof/trace?seconds=N`. Inspect with `go tool trace trace.out`.

---

## Senior Questions

### 1. Explain `pprof.SetGoroutineLabels` vs `pprof.Do`.

**Expected answer:** `SetGoroutineLabels` attaches labels to the current goroutine permanently (until overwritten). `pprof.Do` is the scoped form: it stores labels for the duration of the inner function and restores the previous set on return. The latter is the safer, idiomatic pattern.

### 2. Do labels propagate to `go f()`?

**Expected answer:** Not automatically. The new goroutine has empty labels unless `SetGoroutineLabels(ctx)` is called inside it, or unless the program uses a launcher that does so.

### 3. How would you filter a goroutine profile by label?

**Expected answer:** `go tool pprof -tagfocus=tenant=acme goroutine.prof`. Inside the REPL: `tagfocus=tenant=acme`. The web UI has a "Refine" menu.

### 4. What is a custom profile and when would you use one?

**Expected answer:** A profile registered via `pprof.NewProfile(name)`. You call `.Add(obj, skip)` when a resource is acquired and `.Remove(obj)` when released. Useful for tracking open connections, in-flight requests, pool workers — anything that should be freed and sometimes is not.

### 5. How would you safely expose pprof in production?

**Expected answer:** Bind to `127.0.0.1` only, on a separate admin mux. If it must be reachable from outside, gate with auth, clamp `seconds=` parameters, and rate-limit concurrent profile collection. Never put pprof routes on the public mux.

### 6. Name three continuous profiling backends and one trade-off of each.

**Expected answer (examples):**

- Pyroscope — open-source, integrates with Grafana; needs self-hosting unless you use Grafana Cloud.
- Parca — open-source, eBPF-based, polyglot; requires a privileged daemon.
- Google Cloud Profiler — managed, low overhead; only on GCP and closed-source.
- Datadog Continuous Profiler — strong if already using Datadog; closed-source and pricey.

### 7. What does PGO do?

**Expected answer:** Profile-guided optimisation (Go 1.20+). Feed a CPU profile from production to the compiler with `go build -pgo=profile.pgo`. The compiler inlines, devirtualises, and reorders code based on real execution data. Typical gains 2–7% CPU.

### 8. How is the goroutine profile collected at runtime?

**Expected answer:** The runtime stops the world briefly, walks the `allgs` slice, captures each goroutine's stack, and resumes. The pause is brief for normal counts but scales with the number of goroutines.

---

## Professional Questions

### 1. How does the CPU profiler detect what is running?

**Expected answer:** A timer (`setitimer(ITIMER_PROF)` on Linux) fires `SIGPROF` periodically. The Go runtime's signal handler walks the stack of whichever goroutine is currently executing on the receiving thread. The walk produces a sample pushed onto a lock-free buffer for later encoding.

### 2. What broke about CPU profiling before async preemption?

**Expected answer:** Pre-Go-1.14, tight loops without runtime calls could not be preempted. `SIGPROF` was queued behind cooperative checkpoints. Functions that did not yield (no function calls, no channel ops) were undercounted in CPU profiles. Async preemption (Go 1.14) made `SIGPROF` reliable by allowing the runtime to interrupt arbitrary goroutines.

### 3. Describe the pprof profile format at a high level.

**Expected answer:** A protobuf message with `Sample`, `Location`, `Function`, `Mapping`, `string_table`. Each sample is a list of location IDs (a stack) plus N numeric values aligned with the declared `sample_type` slots. Labels are key-value pairs attached per sample.

### 4. How do stripped binaries affect pprof?

**Expected answer:** Stripping (`-ldflags="-s -w"`) drops DWARF debug info. PProf still works because Go's `gopclntab` provides function names and file/line independently. The cost is debugger usability, not pprof functionality. For full symbolisation of a stripped binary in the field, set up remote symbolisation against an unstripped copy.

### 5. When would eBPF profiling beat in-process pprof?

**Expected answer:** When you need to profile across languages (cgo, C extensions), when you cannot modify the target binary, or when you want host-wide insight including non-Go processes. eBPF cannot see goroutine labels, cannot produce goroutine snapshots, and cannot collect traces — so it complements rather than replaces in-process pprof for Go.

### 6. How are heap profile samples chosen?

**Expected answer:** The runtime tracks bytes allocated. Every `MemProfileRate` bytes (default 512 KB) it samples the *next* allocation, recording the stack and tagging the object so the GC tracks whether it lives or dies. Sub-512KB allocations have proportional sampling probability.

### 7. Why does the goroutine profile stop the world?

**Expected answer:** Goroutine PCs and SPs move while goroutines run. Walking them safely requires they be at rest. The runtime stops all goroutines, walks `allgs`, and resumes. For very large goroutine populations this pause is measurable; Go 1.25 introduced a limit to bound the worst case.

---

## System Design Questions

### 1. Design a continuous profiling pipeline for a Kubernetes fleet of 500 Go pods.

Expected discussion:

- Per-pod agent (Pyroscope or Parca daemonset).
- Centralised store with retention policy (7 days fine-grained, 90 days coarse).
- Labels: `service`, `env`, `version`, `pod`. Avoid `pod` for cardinality if retention is long.
- Profile types collected: CPU, heap (in-use), goroutine. Optional: mutex/block when enabled.
- Push frequency: every minute.
- Storage estimate: ~5 KB/pod/minute compressed = ~3.5 GB/day for the fleet.
- Querying via Grafana flame graphs over time.
- Alerting on goroutine count regression vs baseline.

### 2. Design a leak-detection alert.

Expected discussion:

- Metric: `runtime.NumGoroutine` exported via Prometheus.
- Rate-of-change alert: `deriv(go_goroutines[10m]) > X for 30m`.
- Augment with absolute-count alert at very high threshold.
- On firing, an automated curl of `/debug/pprof/goroutine?debug=1` and upload to S3 for forensics.
- Optional: trigger a heap snapshot too, since goroutine and heap leaks often correlate.

### 3. Design pprof exposure for a public-cloud SaaS.

Expected discussion:

- Pprof on `127.0.0.1` only.
- Per-pod port-forward via `kubectl port-forward` from operator laptops.
- For automation, a sidecar that reaches localhost pprof and uploads to a private S3.
- Audit logs of every profile fetch with the operator's identity.
- Clamp `seconds=` server-side. Rate-limit concurrent profile collection.
- Never put pprof on the public mux.

---

## Live Coding Prompts

### Prompt 1: Reproduce a goroutine leak

**Task:** Write a small program that leaks goroutines. Add pprof. Show me how you would identify which line is leaking.

**Expected workflow:**

```go
import _ "net/http/pprof"

func main() {
    go http.ListenAndServe("127.0.0.1:6060", nil)
    for i := 0; i < 1000; i++ {
        go func() {
            ch := make(chan int)
            <-ch
        }()
    }
    select {}
}
```

Run, then `curl http://127.0.0.1:6060/debug/pprof/goroutine?debug=1`. The output groups by stack and shows 1000 goroutines on the closure. `list` in `go tool pprof` shows the exact line.

### Prompt 2: Label HTTP handlers and filter

**Task:** Add labels to an HTTP handler so a profile can be filtered by endpoint. Show the curl + pprof command.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    pprof.Do(r.Context(), pprof.Labels("endpoint", r.URL.Path), func(ctx context.Context) {
        process(ctx, r)
    })
}
```

Filter: `go tool pprof -tagfocus=endpoint=/v1/orders goroutine.prof`.

### Prompt 3: Diff two heap profiles

**Task:** A service is leaking memory. Show me the two commands you would run to confirm.

```bash
curl -o h1.prof http://host:6060/debug/pprof/heap?gc=1
# wait under load
curl -o h2.prof http://host:6060/debug/pprof/heap?gc=1
go tool pprof -base h1.prof h2.prof
```

`(pprof) top -cum` shows the call sites that grew.

### Prompt 4: Custom profile

**Task:** I have a connection pool. I want to know exactly which call site created each open connection. Sketch the code.

```go
var openConns = pprof.NewProfile("open_conns")

func newConn() *Conn {
    c := &Conn{...}
    openConns.Add(c, 0)
    return c
}

func (c *Conn) Close() {
    openConns.Remove(c)
}
```

Then `/debug/pprof/open_conns?debug=1` shows live connections grouped by creation stack.

---

## Red-Flag Answers

Watch out for these:

- **"Just import pprof and it works."** Missing: the HTTP server. The import alone does nothing without a `ListenAndServe`.
- **"Bind pprof to the same port as the API."** Security failure. Pprof endpoints should not share the public mux.
- **"Mutex profile is on by default."** Wrong. Off by default; requires `SetMutexProfileFraction`.
- **"Run a 10-minute CPU profile."** Wasteful and DoS-adjacent. 30 seconds is the standard.
- **"Add a unique `request_id` label."** Cardinality explosion. Labels must be coarse.
- **"Strip the binary to keep pprof small."** Stripping does not shrink profile output. It hurts symbolisation.
- **"Use pprof to log every request's stack."** Wrong tool. Use a tracer or structured logging.
- **"`runtime.GC()` before every heap profile."** Reasonable once, but doing it repeatedly stalls GC pacing. Use `?gc=1` only when you actually need live-set clarity.
