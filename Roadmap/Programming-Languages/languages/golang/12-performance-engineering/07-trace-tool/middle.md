# The Go Execution Tracer — Middle

## 1. Capture, then narrow

Before you can analyze a trace, you have to capture one that's small enough to navigate but long enough to contain the phenomenon you care about. The middle-level workflow is:

1. Reproduce the slow behavior on demand (a load script, a benchmark, a specific request).
2. Capture 2-5 seconds straddling that reproduction.
3. Open in `go tool trace`, find the candidate goroutine via "Goroutine analysis," then drill into the flame view at that time range.

Don't try to make sense of an unbounded trace from a busy production service first; isolate the workload.

---

## 2. Capturing during a test

`go test` integrates with the tracer via `-trace`:

```bash
go test -trace=trace.out -run TestSlowPath ./...
go tool trace trace.out
```

This captures the entire test run, including `TestMain`, setup, and teardown. The trace will include test framework noise at the start and end — focus on the middle.

For benchmarks, attach the trace via `runtime/trace` inside the benchmark instead so you skip `b.N` warmup:

```go
func BenchmarkPipeline(b *testing.B) {
    if traceOut := os.Getenv("TRACE"); traceOut != "" {
        f, _ := os.Create(traceOut)
        defer f.Close()
        trace.Start(f)
        defer trace.Stop()
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        runPipeline()
    }
}
```

Run with `TRACE=trace.out go test -bench=.` only when you want the trace.

---

## 3. Capturing from a running service

```go
import _ "net/http/pprof"
import "net/http"

func main() {
    go http.ListenAndServe("127.0.0.1:6060", nil)
    // ...
}
```

Then from another shell:

```bash
curl -o trace.out "http://127.0.0.1:6060/debug/pprof/trace?seconds=5"
go tool trace trace.out
```

`seconds=N` is required. The handler writes the trace to the HTTP response over the duration; the connection stays open for `N` seconds.

Production rules: bind pprof to localhost or an admin VIP, never to the internet, and don't capture during an incident on a critical instance — capture from a canary.

---

## 4. The flame view, navigated

The flame timeline (`/trace?p=PROC0` etc.) is in Chrome's `trace-viewer` format. Keys you need:

| Key | Action |
|-----|--------|
| `w` / `s` | Zoom in / out under cursor |
| `a` / `d` | Pan left / right |
| `f` | Zoom to the currently selected slice |
| `m` | Mark a measurement range; second `m` ends it |
| Click slice | Open the sidebar with goroutine ID, start function, stack |
| Shift-click | Select multiple slices; the sidebar shows the aggregate |

The most useful first step on any trace: find the slowest *single goroutine* slice (a long red block), click it, read the stack. That stack is your starting point.

---

## 5. Goroutine analysis page

The "Goroutine analysis" link groups every goroutine by the function it started in. For each group:

| Column | Meaning |
|--------|---------|
| Count | How many goroutines |
| Total | Sum of all states |
| Execution | Time running on a P |
| Network wait | Time blocked on netpoll |
| Sync block | Time blocked on chan/mutex |
| Block syscall | Time blocked in a syscall |
| Sched wait | Time `runnable` but not on a P |
| GC sweeping / GC pause | Time stolen by GC |

Click a function to see the per-goroutine table. A row with high *Sched wait* but low *Execution* means oversubscription. A row with high *Sync block* means contention. A row with high *Network wait* and low *Sync block* is fine — that goroutine is doing what it should.

---

## 6. User regions — labelling your own code

The viewer doesn't know what your functions mean. `trace.WithRegion` lets you annotate a single goroutine's slice with a name:

```go
import "runtime/trace"

func handleRequest(ctx context.Context, req *Request) *Response {
    var resp *Response
    trace.WithRegion(ctx, "parse", func() {
        req.Parsed = parse(req.Raw)
    })
    trace.WithRegion(ctx, "db", func() {
        req.Row = db.Lookup(ctx, req.Parsed.ID)
    })
    trace.WithRegion(ctx, "render", func() {
        resp = render(req)
    })
    return resp
}
```

In the flame view, those three phases will appear as labeled slices under the goroutine's main bar. The "User-defined regions" page also aggregates them.

A region must begin and end on the same goroutine. They can nest. Add them around any phase you suspect is the bottleneck.

---

## 7. User tasks — labelling across goroutines

A *task* spans goroutines via `context.Context`. Use it to follow one logical operation (a request, a job) through fan-out.

```go
func handleRequest(ctx context.Context, req *Request) *Response {
    ctx, task := trace.NewTask(ctx, "request")
    defer task.End()

    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error {
        return fetchA(ctx)
    })
    g.Go(func() error {
        return fetchB(ctx)
    })
    g.Wait()
    return render(req)
}
```

In the viewer, "User-defined tasks" lists every `request` task with its duration. Click one and you get a sub-timeline showing every region and every goroutine that participated in that task. This is the single most valuable feature for debugging request-scoped latency.

Tasks are hierarchical: `trace.NewTask` inside another task makes a child.

---

## 8. User log events

`trace.Log` writes a point event into the trace.

```go
trace.Log(ctx, "cache", "miss")
trace.Logf(ctx, "db", "rows=%d", n)
```

Categories let you filter the "User-defined log messages" view. Logs are cheap (~50 ns) and survive even very high-volume traces. Use them to mark events the viewer has no native concept of — "I just retried," "I just got a 429," "I just rotated my connection pool."

---

## 9. Finding goroutine blocking

A goroutine that "isn't doing anything" leaves a gap on the timeline. To find why it's blocked:

1. Locate the gap in the flame view.
2. Click the slice **just before** the gap — that's where the goroutine yielded.
3. Read the bottom-of-sidebar "Linked event": it shows the event that started the next slice (e.g., `GoUnblock from G42`).
4. If the unblock is on a channel, the linked goroutine is the one that sent. If it's `GoBlockNet`, it was netpoll.

The "Synchronization blocking profile" gives you the aggregate version of this analysis — stack traces ranked by total blocked time.

---

## 10. Scheduler latency

When `Runnable` time exceeds `Running` time, you have a scheduling problem.

```
GOMAXPROCS=4
goroutine count: 4000
average Running:   1 ms / sec
average Runnable: 50 ms / sec
```

The goroutines are spending 50× more time waiting for a P than running. Either:

- You have too many goroutines for the work (CPU-bound oversubscription).
- A few goroutines are hogging Ps with tight loops without yielding (pre-emption usually handles this, but it's worth checking).
- `GOMAXPROCS` is too low (e.g., container with 8 CPUs but `GOMAXPROCS=1`).

The "Scheduler latency profile" ranks functions by the time their goroutines spent runnable-but-not-running. High entries there point to the worst-served code paths.

---

## 11. The heap chart and GC events

Below the procs in the flame view, the **HEAP** lane plots `live` (the green line) and `next_gc` (the goal line). When `live` reaches `next_gc`, a GC cycle starts and you'll see:

- A `GCStart` event in the GC lane.
- Mark phase slices in `gcBgMarkWorker` (background) and `runtime.gcAssistAlloc` (when your goroutine is forced to help).
- Two narrow STW bars in the STW lane (sweep termination, mark termination).

If you see `gcAssistAlloc` slices on your goroutines, the GC is falling behind allocation. Tune `GOGC` higher, reduce allocation rate, or set `GOMEMLIMIT`.

---

## 12. Worked example: a fan-out you thought was parallel

```go
func loadAll(ctx context.Context, ids []int) []Row {
    out := make([]Row, len(ids))
    var wg sync.WaitGroup
    for i, id := range ids {
        wg.Add(1)
        go func(i, id int) {
            defer wg.Done()
            out[i] = db.Get(ctx, id)
        }(i, id)
    }
    wg.Wait()
    return out
}
```

You expected `len(ids)`-way parallelism. The benchmark shows it scaling like 4-way. Trace it:

```bash
go test -bench=BenchmarkLoadAll -trace=trace.out -benchtime=2s
go tool trace trace.out
```

In the flame view, you see all the goroutines spawn but only 4 run at once. The rest sit `Runnable`. The DB connection pool has `MaxOpenConns=4`; goroutines beyond that block in `db.Get` waiting for a connection.

The trace told you in three minutes what reading the standard library docs would have eventually revealed. That's the value.

---

## 13. Trace-output size, in practice

A rough rule for a single-process Go service:

| Concurrency / activity | Bytes per second |
|------------------------|------------------|
| Idle, GC quiet | 100 KB/s |
| Hundreds of goroutines, moderate I/O | 1-5 MB/s |
| Thousands of goroutines, heavy chan churn | 10-50 MB/s |
| Allocation storm, frequent GC | 50-200 MB/s |

If your trace file is > 100 MB the viewer will be slow. Capture a shorter window or filter by `--starttime` / `--endtime` when launching `go tool trace`.

---

## 14. Common middle-level mistakes

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| Capturing 60+ seconds of "everything" | Unusable file size | Capture 2-5 seconds; reproduce first |
| Forgetting `defer trace.Stop()` | Truncated file, viewer error | Always pair `Start` and `Stop` |
| Importing `net/http/pprof` into the main mux | Endpoints exposed publicly | Use a dedicated mux on localhost |
| Reading the trace with a different Go version | "unsupported format" | Match `go tool trace` to the Go that ran the program |
| Using regions across goroutines | Wrong slice attributed | Use tasks for cross-goroutine work |
| Looking only at the flame view | Drowning in detail | Start in "Goroutine analysis" or one of the blocking profiles |

---

## 15. Summary

At the middle level, the trace is a tool you reach for to answer "why is *this specific* code slow," armed with `trace.NewTask` to follow one request through its goroutines and `trace.WithRegion` to label each phase. Capture short windows, start your investigation in the analysis pages, and use the flame view to confirm. The blocking profiles answer "what was the program waiting on?"; user regions answer "where, in my code, did it wait?"

---

## Further reading
- `runtime/trace` package: https://pkg.go.dev/runtime/trace
- "Diagnose user-perceived latency with execution traces", Go blog: https://go.dev/blog/execution-traces-2024
- `cmd/trace` source: https://github.com/golang/go/tree/master/src/cmd/trace
