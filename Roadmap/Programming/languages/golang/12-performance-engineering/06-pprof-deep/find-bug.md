# pprof Deep Dive — Find the Bug

Realistic stories of profiles that didn't tell the truth, or didn't tell the *whole* truth, until somebody adjusted the tool correctly. For each: the symptom, the misleading view, the correct view, and the lesson.

---

## Bug 1: "The profile is empty"

```
$ go tool pprof http://localhost:6060/debug/pprof/profile?seconds=10
$
(pprof) top
Showing nodes accounting for 0, 0% of 0 total
```

**Symptom.** Profile returned nothing. The CPU graph in monitoring shows the service at 80% CPU.

**Cause.** The service spent those 10 seconds in `syscall.Read` on a network socket — *off-CPU* time. A CPU profile only samples on-CPU work; a goroutine parked in netpoll doesn't tick.

**Right view.**

```
go tool pprof http://localhost:6060/debug/pprof/goroutine?debug=2
```

The text dump shows every goroutine parked on `netpollblock`. The service is I/O bound; the bottleneck is the downstream it's calling, not local code.

**Lesson.** CPU profile shows on-CPU work only. When it's empty, the workload is off-CPU — use goroutine, block, or `go tool trace`.

---

## Bug 2: "The hot function is `runtime.mallocgc`"

```
(pprof) top
     flat  flat%   sum%        cum   cum%
   2.10s 42.51% 42.51%      2.10s 42.51%  runtime.mallocgc
   0.40s  8.10% 50.61%      0.40s  8.10%  runtime.memmove
```

**Symptom.** "Allocator is slow." First thought: file an issue with the Go team.

**Cause.** `runtime.mallocgc` *is* doing work on your behalf. The fix is to allocate less. The profile is correct; it just answered a different question than you asked.

**Right view.**

```
go tool pprof -alloc_objects http://localhost:6060/debug/pprof/heap
(pprof) top
```

This shows *what code* is allocating. The fix lives in those functions: `sync.Pool`, pre-sized slices, fewer interface conversions.

**Lesson.** When the CPU profile blames the runtime, switch to the heap profile to find the cause.

---

## Bug 3: "My function isn't in the profile"

```go
func criticalPath(s string) int {
    return strings.Count(s, ",")
}
```

`criticalPath` is called millions of times. CPU profile shows nothing about it.

**Cause.** `strings.Count` is small and `criticalPath` is even smaller — the compiler inlined both. In a profile, inlined functions are folded into their caller's frame. `criticalPath` doesn't exist as a frame.

**Right view.**

```
go build -gcflags="-l" ...   # disable inlining (for the profile only)
```

Or read the caller's frame in `list`:

```
(pprof) list callerOfCriticalPath
```

The cost shows up there.

**Lesson.** Inlined functions don't appear as frames. To see them as frames, disable inlining temporarily.

---

## Bug 4: "The heap profile is huge but RSS is small"

```
(pprof) top
Showing nodes accounting for 4.2GB, 100% of 4.2GB total
```

But `runtime.MemStats.HeapAlloc` says 200 MiB.

**Cause.** The profile is `alloc_space` (cumulative bytes ever allocated), not `inuse_space` (current live bytes). The 4.2 GiB is what the process has allocated *over its lifetime*, almost all of it already freed.

**Right view.**

```
(pprof) sample_index=inuse_space
(pprof) top
```

Now the numbers reconcile.

**Lesson.** The default sample index for `/debug/pprof/allocs` is `alloc_space`. The default for `/debug/pprof/heap` is `inuse_space`. Same profile, different default.

---

## Bug 5: "Profile says 250 MiB; runtime says 50 MiB"

`go tool pprof` (heap, inuse_space) and `runtime.MemStats.HeapAlloc` disagree by 5×.

**Cause.** The heap profile is *sampled*: roughly one sample per `runtime.MemProfileRate` (default 512 KiB) of allocation. The profile statistically scales values to estimate the total. For small or rare allocations the variance is large; sums can disagree with reality.

**Right view.**

For absolute accounting use `runtime.MemStats` or `runtime/metrics`. For *attribution* (which call paths) use pprof. Don't conflate them.

In tests where you need exact heap numbers:

```go
runtime.MemProfileRate = 1
```

This records every allocation, with proportional overhead. Don't ship it.

**Lesson.** pprof is for shape, runtime metrics are for absolute numbers.

---

## Bug 6: "The block profile is empty"

```
go tool pprof http://localhost:6060/debug/pprof/block
(pprof) top
Showing nodes accounting for 0, 0% of 0 total
```

The service has obvious channel contention; everyone sees latency spikes.

**Cause.** Block profiling is disabled by default. `runtime.SetBlockProfileRate(0)` is the implicit setup.

**Right view.**

```go
runtime.SetBlockProfileRate(10000)   // sample 1 in ~10000 ns of blocking
```

Add this at process start (or expose an admin endpoint to toggle on demand). Now the block profile populates.

**Lesson.** Block and mutex profiles must be enabled. Add `SetBlockProfileRate` and `SetMutexProfileFraction` in service init.

---

## Bug 7: "The diff shows everything as new"

```
go tool pprof -base=before.pb.gz after.pb.gz
(pprof) top
   3.50s 100% ... main.handler
   1.20s ...    runtime.mallocgc
```

Every function appears with its full cost as if the baseline never existed.

**Cause.** The two profiles have different `sample_type` columns, or one was produced by a different binary with renamed functions. `-base` matches stacks by exact frame names; any difference means "this stack is new".

**Right view.**

Confirm the profile types match: `go tool pprof -raw before.pb.gz | head` and same for `after.pb.gz`. The `sample_type` lines must be identical. Re-build with the same binary if function names changed.

**Lesson.** `-base` matches stacks by string. Same binary, same profile type, same labels — or expect garbage.

---

## Bug 8: "The goroutine count is climbing but no leak shows in the profile"

`runtime.NumGoroutine()` reports 12000 and growing. `go tool pprof /goroutine` shows only ~50 distinct stacks, total count looks normal.

**Cause.** The default binary profile *aggregates* — many goroutines at the same stack become one sample with a count. 12000 goroutines parked in `chan receive` of `worker.run` appear as one row with `count=12000`. You misread "50 stacks" as "50 goroutines".

**Right view.**

```
go tool pprof http://localhost:6060/debug/pprof/goroutine
(pprof) top
Showing nodes accounting for 12000, 100% of 12000 total
     flat  flat%   sum%
   11500 95.83% 95.83%  main.(*worker).run
```

Or the text dump for full stacks:

```
curl -s "http://localhost:6060/debug/pprof/goroutine?debug=2" | grep -c "^goroutine "
```

**Lesson.** The `flat` value in a goroutine profile is a *count*, not a time. Don't be fooled by row counts.

---

## Bug 9: "The hot line is line 0"

```
ROUTINE ======================== main.handleRequest
     800ms      800ms (flat, cum)
         .          .      0:
     800ms       800ms     0:
```

Source view points at line 0 of the file. The function exists; the source is on disk.

**Cause.** `pprof` couldn't resolve the source path. The profile records `function.filename = /build/src/main.go` but the local file is at `/home/me/repo/main.go`. Without the file, pprof can't annotate lines.

**Right view.**

```
go tool pprof -trim_path=/build/src -source_path=/home/me/repo cpu.pb.gz
```

Or `cd` to a directory where the path resolves naturally.

**Lesson.** Source path mismatch destroys `list`. Set `-trim_path` and `-source_path` for cross-machine profiles.

---

## Bug 10: "The profile is dominated by `runtime.gcWriteBarrier`"

```
(pprof) top
     flat  flat%   sum%        cum   cum%
   1.50s 30.00% 30.00%      1.50s 30.00%  runtime.gcWriteBarrier
   0.80s 16.00% 46.00%      0.80s 16.00%  runtime.gcDrain
```

GC-related frames dominate. "We need a faster GC."

**Cause.** Write barriers fire on every pointer store during the mark phase. A function that builds large pointer-rich structures (slices of `*T`, maps of struct→struct) writes many pointers. GC frames dominate because *your code writes many pointers*.

**Right view.**

```
(pprof) ignore=runtime\.gc
(pprof) top
```

Now you see *your* code that owns the write-barrier cost. Then in heap profile:

```
sample_index=inuse_objects
```

To reduce write barriers: store values instead of pointers (`[]T` over `[]*T`), use indices into a single backing slice, reduce pointer fan-out in your data model.

**Lesson.** `runtime.gcWriteBarrier` is *your* cost in disguise. Filter it out to find the responsible code.

---

## Bug 11: "Mutex profile blames sync.runtime_SemacquireMutex"

```
(pprof) top
     flat  flat%   sum%        cum   cum%
   2.10s 70.00% 70.00%      2.10s 70.00%  sync.runtime_SemacquireMutex
```

All cost in a runtime internal. "Bug in sync.Mutex?"

**Cause.** `sync.runtime_SemacquireMutex` is the function a contending goroutine sits in while waiting for the mutex. It's the *bottom* of the wait stack. The mutex it's waiting on is one frame up.

**Right view.**

```
(pprof) peek sync.runtime_SemacquireMutex
```

The "callers" section shows the `Lock` sites — those are the contended mutexes. Or just look at the flame graph: the parent of every `SemacquireMutex` box is the calling function.

**Lesson.** In a mutex profile, look one frame up from the wait function to find the contended lock.

---

## Bug 12: "After labeling, half my samples have no label"

You added `pprof.Do(ctx, pprof.Labels("route", ...), ...)` in middleware. The CPU profile's `tagfocus=route=...` filter shows only half the cost.

**Cause.** The other half is in goroutines launched with `go ...` from inside the handler. Those goroutines started unlabeled. `pprof.Do` does *not* propagate labels to spawned goroutines.

**Right view.**

```go
labels := pprof.Labels("route", route)
go func() {
    pprof.Do(ctx, labels, func(ctx context.Context) {
        work()
    })
}()
```

Or use `pprof.SetGoroutineLabels(pprof.WithLabels(ctx, labels))` at the top of the goroutine.

**Lesson.** Labels don't cross `go fn()`. Apply them inside each goroutine you care about.

---

## Bug 13: "The flame graph is dominated by `runtime.findRunnable`"

```
(pprof) top -cum
   3.20s 64.00%   runtime.findRunnable
   3.20s 64.00%   runtime.schedule
   3.20s 64.00%   runtime.mcall
```

Half the CPU is in the scheduler. "Go scheduler is slow."

**Cause.** `findRunnable` is what a P does when it has no goroutine to run. A profile that shows lots of `findRunnable` was taken while the program had *idle* Ps — it wasn't fully utilizing CPU. The 64% is "64% of samples were idle".

**Right view.**

Look at `relative_percentages` after filtering out the idle paths:

```
(pprof) ignore=runtime\.findRunnable|runtime\.schedule|runtime\.mcall
(pprof) top
```

Now the percentages are out of actual work, not total samples.

Better: take the profile during a period when the program is actually busy. If it's never actually busy, then the question isn't "what's slow", it's "what's missing work?"

**Lesson.** `runtime.findRunnable` is an idle marker, not a hot function. Filter it out, or take a busier profile.

---

## Bug 14: "I see `runtime.cgocall` and can't profile inside C"

```
(pprof) top
   2.50s   runtime.cgocall
   0.80s   runtime.systemstack
```

The bottom of the stack is C code (a library, OpenSSL, sqlite). pprof sees `runtime.cgocall` and stops.

**Cause.** `runtime/pprof` doesn't symbolize foreign frames. The CPU sample's stack ends at the boundary; no further attribution.

**Right view.**

For C-side profiling you need a different tool: `perf record` + `perf script` (Linux), Instruments (macOS), or eBPF-based profilers (Parca, Pyroscope's eBPF agent). They cross the cgo boundary because they sample at the OS level.

**Lesson.** pprof is a Go profiler. cgo cost is a black box to it.

---

## Bug 15: "The profile shrank to nothing after enabling labels"

You added `pprof.Do(ctx, labels, work)` and now the profile has ~20% of its previous size.

**Cause.** A subtle bug: `pprof.Do` was placed *outside* the busy work, so the labels apply, but the parent goroutine then spawned the workers via `go ...` (which inherit no labels), and your filter `tagfocus=route=...` excludes most samples.

**Right view.**

Strip the filter first to see total cost:

```
(pprof) tagfocus=     # clear it
(pprof) top
```

If total cost is fine but the filtered view is small, the workers aren't labeled. See Bug 12.

**Lesson.** When a label filter "loses" samples, check whether the labeled scope actually covers the work, or stops at a goroutine boundary.

---

## Bug 16: "Diffing profiles shows phantom regressions in stdlib"

```
go tool pprof -base=before.pb.gz after.pb.gz
(pprof) top
   80ms  encoding/json.(*decodeState).objectInterface
   60ms  net/http.(*conn).serve
   ...
```

You didn't touch JSON or HTTP. Why do they show up?

**Cause.** Two profiles taken at slightly different load levels. The "after" had a tiny bit more traffic, so all stdlib paths grew a bit. The diff shows the absolute difference, which surfaces as "regression" — it's just noise.

**Right view.**

Normalize by duration or sample count. The cleanest workflow is to run both versions under exactly the same synthetic workload (replay traffic against both, side by side). Real production diffs need longer windows and statistical care.

**Lesson.** Pprof diffs are absolute. Without controlling for workload, small ambient variation looks like regression.

---

## Bug 17: "The web UI says my function is wide; the source view says nothing is hot"

A function appears as a wide box on the flame graph. Click → Source view → every line shows trivial cost.

**Cause.** The function's cost is *cumulative* — it comes from its children. The function itself doesn't do much; it calls one or two expensive things. The Source view shows *self* time per line, which is small.

**Right view.**

Use `peek`:

```
(pprof) peek myFunction
```

The callee table shows the children. Or click into the callees on the flame graph — they're the wide boxes below.

**Lesson.** Source view is per-line *self* time. For "where does my cum come from?", use `peek` or click into children.

---

## Bug 18: "Profile collection itself shows up as a hot path"

```
(pprof) top
   200ms  runtime/pprof.profileWriter
   180ms  compress/gzip.(*Writer).Write
```

The profile-writing code appears in the profile.

**Cause.** Yes, `pprof.StopCPUProfile` finalizes the profile by writing it. Those final writes happen on-CPU and get sampled.

**Right view.**

Filter:

```
(pprof) ignore=runtime/pprof|compress/gzip
```

Negligible cost in normal operation; the artifact is just visible because total run was short.

**Lesson.** Profiling the profiler is a known artifact. Filter it.

---

## 19. Summary

Most "pprof lied to me" stories trace to one of: looking at the wrong sample_index, looking at the wrong profile type, missing labels, missing source paths, or interpreting cumulative as self. None of these are bugs in pprof; all of them are the tool doing exactly what it advertises. The skill is knowing which knob to turn. The scenarios above are the recurring ones; meet them once and you'll catch them all.

---

## Further reading
- `pprof` doc: https://github.com/google/pprof/blob/main/doc/README.md
- "Profiling Go programs" blog: https://go.dev/blog/pprof
- Common pprof gotchas (Polar Signals): https://www.polarsignals.com/blog
- Felix Geisendörfer "Why is your Go application slow?": https://www.youtube.com/watch?v=jiXnzkAzy30
