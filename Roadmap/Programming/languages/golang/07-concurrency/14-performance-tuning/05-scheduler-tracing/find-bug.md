# Scheduler Tracing — Find the Bug

[Back to index](index.md)

Each section presents code, output, or a conclusion that is wrong. Your job is to identify the bug. Answers and explanations follow each.

## Table of Contents
1. [Bug 1: schedtrace Shows No Lines](#bug-1-schedtrace-shows-no-lines)
2. [Bug 2: Trace File is Empty](#bug-2-trace-file-is-empty)
3. [Bug 3: Task Spans Lost Across Goroutines](#bug-3-task-spans-lost-across-goroutines)
4. [Bug 4: Region Begin/End on Different Goroutines](#bug-4-region-beginend-on-different-goroutines)
5. [Bug 5: Wrong Conclusion from idleprocs](#bug-5-wrong-conclusion-from-idleprocs)
6. [Bug 6: Tracing Loop Leaks Files](#bug-6-tracing-loop-leaks-files)
7. [Bug 7: Percentile from Histogram is Wrong](#bug-7-percentile-from-histogram-is-wrong)
8. [Bug 8: Wrong Diagnosis of High threads](#bug-8-wrong-diagnosis-of-high-threads)
9. [Bug 9: Annotation Hot Path Cost](#bug-9-annotation-hot-path-cost)
10. [Bug 10: Continuous Tracing Without Bound](#bug-10-continuous-tracing-without-bound)

---

## Bug 1: schedtrace Shows No Lines

A user reports they set `GODEBUG=schedtrace=1000` and see no output.

```bash
GODEBUG="schedtrace=1000" ./prog
# nothing in stdout
```

**What is wrong?**

---

**Answer.**

`schedtrace` writes to **standard error**, not standard out. The user is reading stdout only.

```bash
GODEBUG=schedtrace=1000 ./prog 2>&1 | head
# or
GODEBUG=schedtrace=1000 ./prog 2>sched.log
```

A second possibility: the program exits before the first interval elapses. Set a smaller interval (`schedtrace=100`) or ensure the program runs at least one full second.

---

## Bug 2: Trace File is Empty

```go
package main

import (
    "log"
    "os"
    "runtime/trace"
)

func main() {
    f, err := os.Create("trace.out")
    if err != nil {
        log.Fatal(err)
    }
    if err := trace.Start(f); err != nil {
        log.Fatal(err)
    }
    f.Close()

    doWork()
    trace.Stop()
}
```

Trace file exists but `go tool trace` complains: "no events parsed."

**What is wrong?**

---

**Answer.**

`f.Close()` is called immediately after `trace.Start`. The runtime writes events to a closed file descriptor. Some platforms silently swallow the writes; others return errors that the tracer logs and ignores.

Fix: defer `f.Close()` after `trace.Stop()`.

```go
func main() {
    f, err := os.Create("trace.out")
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()
    if err := trace.Start(f); err != nil {
        log.Fatal(err)
    }
    defer trace.Stop()

    doWork()
}
```

Defer order matters: `Stop()` must run before `Close()`. With two `defer`s, the second-deferred runs first, so put `defer trace.Stop()` after `defer f.Close()`.

---

## Bug 3: Task Spans Lost Across Goroutines

```go
func handle(ctx context.Context, req *Request) {
    ctx, task := trace.NewTask(ctx, "handle")
    defer task.End()

    go process(req) // child goroutine
}

func process(req *Request) {
    trace.WithRegion(context.Background(), "process", func() {
        // work
    })
}
```

In the UI's User-defined tasks view, the `handle` task does not contain a `process` region.

**What is wrong?**

---

**Answer.**

The child goroutine is launched without the trace task context. Inside `process`, `context.Background()` is used — a fresh context with no task identity.

Fix: pass `ctx` through.

```go
func handle(ctx context.Context, req *Request) {
    ctx, task := trace.NewTask(ctx, "handle")
    defer task.End()

    go process(ctx, req) // pass the task ctx.
}

func process(ctx context.Context, req *Request) {
    trace.WithRegion(ctx, "process", func() {
        // work
    })
}
```

Note: the parent goroutine returns immediately after `go process(ctx, req)`. The deferred `task.End()` will fire as soon as `handle` returns, possibly *before* `process` runs. To track the child as part of the task, the parent must wait for it (with `sync.WaitGroup` or a channel). Alternatively, make `process` create its own subtask if it can outlive the parent.

---

## Bug 4: Region Begin/End on Different Goroutines

```go
func work(ctx context.Context) {
    r := trace.StartRegion(ctx, "work")
    go func() {
        defer r.End() // BUG
        doExpensiveThing()
    }()
}
```

The trace UI shows: "region opened but never closed" warnings.

**What is wrong?**

---

**Answer.**

Regions must begin and end on the same goroutine. `r.End()` is called in a different goroutine than `StartRegion`. The runtime detects this and discards the region.

Fix: do work synchronously, or use a task instead of a region for cross-goroutine work.

```go
// Option 1: synchronous.
func work(ctx context.Context) {
    trace.WithRegion(ctx, "work", func() {
        doExpensiveThing()
    })
}

// Option 2: task for cross-goroutine.
func work(ctx context.Context) {
    ctx, task := trace.NewTask(ctx, "work")
    go func() {
        defer task.End()
        doExpensiveThing()
    }()
}
```

---

## Bug 5: Wrong Conclusion from idleprocs

```
SCHED 1000ms: gomaxprocs=8 idleprocs=4 ...
SCHED 2000ms: gomaxprocs=8 idleprocs=5 ...
SCHED 3000ms: gomaxprocs=8 idleprocs=3 ...
```

Engineer concludes: "Half my cores are unused. I should lower `GOMAXPROCS` to save resources."

**What is wrong?**

---

**Answer.**

The schedtrace line is a **snapshot**. `idleprocs=4` means *at the exact moment of sampling*, 4 Ps were idle. Between samples, all 8 Ps may have been saturated. Conclusion from samples alone is unsafe.

Better signals:

- `runtime/metrics` `/cpu/classes/idle:cpu-seconds` over time → fraction of total CPU that was idle.
- A real load test or production traffic.
- A `runtime/trace` that shows the timeline.

If the *time-averaged* idle fraction is high, then `GOMAXPROCS` reduction is justified. From three sample lines, it is not.

---

## Bug 6: Tracing Loop Leaks Files

```go
func traceLoop(dir string) {
    for {
        time.Sleep(5 * time.Minute)
        f, _ := os.Create(filepath.Join(dir, fmt.Sprintf("trace-%d.out", time.Now().Unix())))
        trace.Start(f)
        time.Sleep(2 * time.Second)
        trace.Stop()
        // f never closed.
    }
}
```

After hours, the process has thousands of open file descriptors.

**What is wrong?**

---

**Answer.**

The file is opened but never `Close()`d. Each iteration leaks one FD.

Fix:

```go
func traceLoop(dir string) {
    for {
        time.Sleep(5 * time.Minute)
        captureOne(dir)
    }
}

func captureOne(dir string) {
    f, err := os.Create(filepath.Join(dir, fmt.Sprintf("trace-%d.out", time.Now().Unix())))
    if err != nil {
        log.Printf("create: %v", err)
        return
    }
    defer f.Close()
    if err := trace.Start(f); err != nil {
        log.Printf("trace.Start: %v", err)
        return
    }
    time.Sleep(2 * time.Second)
    trace.Stop()
}
```

Note the inner function: the `defer` runs at function return, not at end of loop iteration. Always factor out the body so `defer` works.

---

## Bug 7: Percentile from Histogram is Wrong

```go
func p99() float64 {
    s := metrics.Sample{Name: "/sched/latencies:seconds"}
    metrics.Read([]metrics.Sample{s})
    h := s.Value.Float64Histogram()
    target := uint64(0.99 * float64(len(h.Counts))) // BUG
    var cum uint64
    for i, c := range h.Counts {
        cum += c
        if cum >= target {
            return h.Buckets[i+1]
        }
    }
    return 0
}
```

The function always returns 0 or a too-small value.

**What is wrong?**

---

**Answer.**

The target is computed from `len(h.Counts)` (bucket count) instead of `sum(h.Counts)` (total events). It should be:

```go
var total uint64
for _, c := range h.Counts {
    total += c
}
target := total - total/100 // p99: 99% are below.
```

A histogram has, say, 60 buckets but billions of events. `0.99 * 60 = 59` is meaningless.

---

## Bug 8: Wrong Diagnosis of High threads

A user sees:

```
SCHED 1000ms: gomaxprocs=8 threads=120 ...
```

And concludes: "thread leak, must investigate."

**What is wrong?**

---

**Answer.**

`threads=120` is high but not necessarily a leak. The number includes:

- Ms actively running Gs (~8).
- Idle Ms parked in `notesleep` (could be many).
- Ms blocked in syscalls (the proximate cause of high counts).
- Ms tied to `LockOSThread` Gs.

Look at the **breakdown**:

- `idlethreads` from the same line. If idle Ms are most of it, no leak — just a high water mark.
- `scheddetail=1` to see which Ms are in which state.

A real thread leak shows monotonically growing `threads` over hours, with most Ms not idle and not running Go code.

---

## Bug 9: Annotation Hot Path Cost

```go
func handleRequest(ctx context.Context, req *Request) {
    for _, item := range req.Items { // 10000 items
        trace.WithRegion(ctx, "item", func() { // BUG
            process(item)
        })
    }
}
```

Under load, this code is 30% slower than the un-annotated version, but only when tracing is active.

**What is wrong?**

---

**Answer.**

The region is in the hot path. With 10000 items per request, every request emits 20000 region events (begin + end). Each costs ~150 ns, so ~3 ms per request just in trace overhead.

When tracing is off, `trace.WithRegion` short-circuits — the cost is negligible. When tracing is on, the inner loop becomes the trace.

Fix options:

- Move the region outside the loop:

```go
trace.WithRegion(ctx, "items", func() {
    for _, item := range req.Items {
        process(item)
    }
})
```

- Or sample:

```go
for i, item := range req.Items {
    if i%100 == 0 {
        trace.WithRegion(ctx, "item-sample", func() {
            process(item)
        })
        continue
    }
    process(item)
}
```

- Or remove the region entirely; the function-level region covers it.

---

## Bug 10: Continuous Tracing Without Bound

```go
func traceLoop(dir string) {
    for {
        time.Sleep(5 * time.Minute)
        captureOne(dir, 2*time.Second)
    }
}
```

After 30 days, the dir is 50 GB. The pod has run out of disk and crashed.

**What is wrong?**

---

**Answer.**

No retention. The loop captures and never deletes.

Fix: enforce a retention policy.

```go
func traceLoop(dir string, retain int) {
    for {
        time.Sleep(5 * time.Minute)
        captureOne(dir, 2*time.Second)
        cleanupOldest(dir, retain)
    }
}

func cleanupOldest(dir string, retain int) {
    entries, err := os.ReadDir(dir)
    if err != nil {
        return
    }
    type fi struct {
        name string
        info os.FileInfo
    }
    var files []fi
    for _, e := range entries {
        info, err := e.Info()
        if err != nil {
            continue
        }
        files = append(files, fi{e.Name(), info})
    }
    if len(files) <= retain {
        return
    }
    sort.Slice(files, func(i, j int) bool {
        return files[i].info.ModTime().Before(files[j].info.ModTime())
    })
    for i := 0; i < len(files)-retain; i++ {
        _ = os.Remove(filepath.Join(dir, files[i].name))
    }
}
```

Better still: upload to object storage and let the lifecycle policy handle retention. Local disk is fragile.

---

## Wrap-Up

Most scheduler-tracing bugs come from one of:

- Wrong output stream (stderr vs stdout).
- File handle hygiene (forgetting `Close`, `Stop`, `Sync`).
- Context not propagated (tasks lost across goroutines).
- Cross-goroutine region misuse.
- Misinterpretation (snapshot vs time average; bucket count vs event count).
- Resource leaks (FDs, disk).
- Cost inattention (annotation in hot loops).

A good rule: when tracing reveals something unexpected, *first* check your tracing code. Surprisingly often, the bug is in the observer, not the observed.
