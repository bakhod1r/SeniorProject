# The Go Execution Tracer — Junior

## 1. Why "another" profiling tool?

You already know `pprof`. It tells you **where** CPU is spent and **what** allocates. But it can't tell you:

- Why a request took 200 ms when the CPU profile shows the program was idle for 180 of them.
- Why two CPUs are pegged while four sit unused.
- Whether your goroutines are waiting on a channel, a mutex, the network, or the GC.

The execution tracer answers those. It records every scheduler decision the Go runtime makes and lets you watch the program execute, nanosecond by nanosecond, in a browser.

---

## 2. Your first trace

The shortest program that produces a trace file:

```go
package main

import (
    "os"
    "runtime/trace"
    "time"
)

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()

    trace.Start(f)
    defer trace.Stop()

    go func() {
        time.Sleep(50 * time.Millisecond)
    }()
    time.Sleep(100 * time.Millisecond)
}
```

Run it and then open the trace in a browser:

```bash
go run main.go
go tool trace trace.out
```

`go tool trace` starts a local HTTP server and prints a URL. Click "View trace" — you'll see two goroutines, the GC lane, and the heap chart.

---

## 3. The three ways to capture a trace

| Method | When to use |
|--------|-------------|
| `trace.Start(w)` / `trace.Stop()` | Inside `main` or a CLI tool; one capture per process |
| `go test -trace=trace.out ./pkg` | While running a specific test |
| `curl http://host:6060/debug/pprof/trace?seconds=5` | Live from a running server with `net/http/pprof` imported |

For a service you can hit:

```go
import _ "net/http/pprof"
import "net/http"

func main() {
    go http.ListenAndServe("localhost:6060", nil)
    // ... rest of the server ...
}
```

Then `curl 'http://localhost:6060/debug/pprof/trace?seconds=5' > trace.out`. Don't expose this port to the internet.

---

## 4. The viewer pages

When you run `go tool trace trace.out` you land on an index with about a dozen links. The ones you'll use most as a junior:

| Link | What it gives you |
|------|--------------------|
| **View trace** | The timeline — every goroutine on every P, GC events, syscalls |
| **Goroutine analysis** | A list of goroutine functions and their counts/durations |
| **Network blocking profile** | Where goroutines blocked on netpoll |
| **Synchronization blocking profile** | Where goroutines blocked on chans/mutexes |
| **Syscall blocking profile** | Where goroutines blocked in syscalls |
| **Scheduler latency profile** | How long runnable goroutines waited for a P |

The flame timeline is the powerful one; the profiles above it are summaries that point you at the right region of the timeline.

---

## 5. What you see in the flame view

Imagine four rows stacked vertically:

```
PROCS  : P0 | P1 | P2 | P3    each shows the goroutine currently running on that P
GC     :                       mark and sweep phases
STW    :                       narrow vertical bars for stop-the-world events
HEAP   :                       a line graph of live bytes vs. the GC trigger goal
```

Each colored slice is one goroutine running on one P for some interval. Click on a slice and a sidebar shows you:

- The goroutine ID and starting function.
- The duration.
- The wall-clock start time (in seconds since trace start).
- The event that started it (e.g., "GoUnblock from G42").

If you see a slice followed by a gap on the same P, that means the goroutine yielded or blocked and the P then had nothing to run.

---

## 6. Goroutine states, simplified

For each instant, every goroutine is in exactly one of these states:

| State | Color in viewer | Meaning |
|-------|-----------------|---------|
| Running | Bright color | On a P, executing your code |
| Runnable | Pale color | Ready to run, queued for a P |
| Waiting | Hidden (or in "Goroutine analysis") | Blocked on chan, mutex, netpoll, timer, syscall, GC |
| Dead | Not shown after exit | Finished |

A goroutine spends most of its life waiting. Time in `Runnable` but not `Running` is *scheduler latency* — and a big chunk of `Runnable` time means you have more goroutines than `GOMAXPROCS` can serve.

---

## 7. Opening "Goroutine analysis"

Click "Goroutine analysis" on the index. You'll see a table of goroutine-starting functions:

```
main.worker            count=8    total=512ms    sched-wait=12ms   I/O-wait=480ms
main.fanOut.func1      count=64   total=128ms    sched-wait=5ms    block-recv=120ms
runtime.gcBgMarkWorker count=4    total=18ms     ...
```

Click `main.worker` and the viewer drills into the per-goroutine breakdown: total time, time running, time blocked, time in syscalls, time in GC assists. This is often where you find your answer before ever opening the flame view.

---

## 8. The "block profile" pages

The three blocking profiles (network, sync, syscall) are like little `pprof` graphs aimed only at "what was the program blocked on?"

- **Network blocking profile**: stack traces where goroutines waited on `read`, `accept`, or other netpoll-driven I/O.
- **Synchronization blocking profile**: stack traces where goroutines waited on `chan` send/receive or `sync.Mutex.Lock`.
- **Syscall blocking profile**: stack traces where goroutines were stuck in a blocking syscall (e.g., a slow file read).

These tell you the *shape* of waiting in the program; the flame view tells you *when*.

---

## 9. A worked example: a slow web request

You have a handler that takes 200 ms on a development laptop, no obvious bottleneck.

```go
func slow(w http.ResponseWriter, r *http.Request) {
    a := callA(r.Context())  // calls service A
    b := callB(r.Context())  // calls service B
    fmt.Fprintf(w, "%v %v", a, b)
}
```

Capture a trace for 5 seconds, fire one request, then open the viewer.

In "Synchronization blocking profile" you'd see `callA` and `callB` waiting on the `http.Client` response channel. In the flame view, you'd see the request goroutine going `Running → Waiting → Running → Waiting → Running`, with the gaps being the network calls. The two waits run **sequentially**, not in parallel.

Fix: run them concurrently with `errgroup`. Re-run the trace and see the two waits overlap.

---

## 10. Trace vs CPU profile

| Question | Use |
|----------|-----|
| "Which function burns CPU?" | CPU profile |
| "Why was the program idle for 80 ms?" | Trace |
| "Are my goroutines saturating GOMAXPROCS?" | Trace |
| "Is GC taking too long?" | Trace + `GODEBUG=gctrace=1` |
| "How much memory does each allocation type use?" | Heap profile |
| "Why is this one request slow?" | Trace (with user regions) |

Rule of thumb: if the answer involves the word "**when**" or "**wait**", reach for the trace.

---

## 11. Don't trace forever

A trace running for 30 seconds on a busy service can produce hundreds of megabytes and the viewer will struggle to render it. Start short:

- 1-3 seconds for "is the program doing what I think?"
- 5-10 seconds for "find that latency spike."
- 30+ seconds only if you have a specific rare event to catch — and then prefer the flight recorder.

---

## 12. The tracer is not free

Capture overhead is in the 5-10% range while a trace is running. When the trace stops, overhead drops to zero. Production rule: keep traces short, don't run them continuously, and never capture from a node that's already overloaded — you'll make it worse.

---

## 13. A small but useful program to trace

A program with both CPU work and blocking I/O is the best teacher:

```go
package main

import (
    "io"
    "net/http"
    "os"
    "runtime/trace"
    "sync"
)

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f); defer trace.Stop()

    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            resp, _ := http.Get("https://example.com")
            io.Copy(io.Discard, resp.Body)
            resp.Body.Close()
        }()
    }
    wg.Wait()
}
```

Run, open `go tool trace trace.out`, and look at the flame view. You should see four goroutines, each going `Running → Waiting (netpoll) → Running` as the response arrives. The CPU work is tiny; the wait is the story.

---

## 14. Summary

The execution tracer records every scheduler decision, GC event, and goroutine state transition the runtime makes. You capture a trace with `runtime/trace.Start/Stop`, `go test -trace`, or `/debug/pprof/trace?seconds=N`, then open it in a browser with `go tool trace`. The viewer's flame timeline shows goroutines per P over time; the analysis pages summarize where time went. Reach for the trace when CPU profiling can't explain "why is this slow *right now*".

---

## Further reading
- `runtime/trace`: https://pkg.go.dev/runtime/trace
- Go diagnostics guide: https://go.dev/doc/diagnostics
- Felix Geisendorfer, "Reading a Go trace": https://blog.felixge.de/reading-go-execution-traces/
