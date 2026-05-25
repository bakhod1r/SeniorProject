# go tool trace — Junior

## 1. What does `go tool trace` do?

`go tool trace` is Go's **execution tracer viewer**. It opens a trace file your program produced and shows, on a precise per-event timeline, what every goroutine, processor (P), and OS thread did over a small window of time — when goroutines ran, when they blocked, when the GC paused the world, when a syscall returned, when network I/O woke a goroutine up.

It is **orthogonal to pprof**. pprof tells you *where* CPU time or allocations went on average. The tracer tells you *what happened, in order, on what processor, and when* — moment by moment.

```bash
go tool trace trace.out
```

This opens a browser pointing at a local server (e.g., `http://127.0.0.1:54321`) showing the timeline.

---

## 2. Prerequisites
- Go installed (`go version` ≥ 1.21; trace format v2 ships in 1.21+).
- A browser (the UI runs locally in your browser).
- A trace file to view (we'll produce one in section 4).

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Event** | A timestamped record (goroutine start, syscall enter, GC done, ...) |
| **G / goroutine** | A user-space concurrent task |
| **P / processor** | A logical scheduler slot; `GOMAXPROCS` of them by default |
| **M / machine** | An OS thread the runtime uses to run a P |
| **STW** | Stop-the-world pause (mostly during GC mark setup) |
| **Region** | A user-defined named span inside a goroutine (`runtime/trace.WithRegion`) |
| **Task** | A user-defined higher-level unit spanning regions (`runtime/trace.NewTask`) |
| **Flight recorder** | A rolling in-memory trace buffer (Go 1.23+) |

---

## 4. The two ways to collect a trace

### (a) From a test

```bash
go test -trace=trace.out ./...
```

`-trace` is built into `go test`. It produces `trace.out` covering the entire test run.

### (b) From program code

```go
package main

import (
    "os"
    "runtime/trace"
)

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    doWork()
}
```

`trace.Start` begins recording; `trace.Stop` flushes. Without `Stop` you get a truncated, often unopenable trace.

---

## 5. Viewing the trace

```bash
go tool trace trace.out
```

The tool starts a local HTTP server and prints a URL. Open it in a browser. You will see a landing page with tabs/links:

| Tab | What it shows |
|-----|---------------|
| **View trace** | The timeline (the big one). Rows are processors and goroutines; coloured bars are events. |
| **Goroutine analysis** | Per-goroutine totals: running time, blocked-on-channel, blocked-on-syscall, ... |
| **Network blocking profile** | Where goroutines were stuck on the network poller |
| **Synchronization blocking profile** | Where goroutines were stuck on mutexes/channels |
| **Syscall blocking profile** | Where goroutines were stuck in syscalls |
| **Scheduler latency profile** | How long goroutines were *runnable but not yet running* |
| **User-defined tasks / regions** | Your `trace.NewTask` / `WithRegion` annotations, if any |

The first one — **View trace** — is the famous timeline. Use `?` in the browser view to see keyboard shortcuts (`w`/`s` to zoom, `a`/`d` to pan).

---

## 6. A complete minimal example

```go
package main

import (
    "os"
    "runtime/trace"
    "sync"
    "time"
)

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            time.Sleep(10 * time.Millisecond)
        }()
    }
    wg.Wait()
}
```

```bash
go run .
go tool trace trace.out
```

In the **View trace** tab you will see four short goroutines created near the start, each parked for ~10ms, then woken up and finishing. You can click one bar to inspect that event's details on the bottom panel.

---

## 7. Capturing a trace from a live server

If your program already imports `net/http/pprof`, you get a trace endpoint for free:

```go
import _ "net/http/pprof"
// http.ListenAndServe("localhost:6060", nil) somewhere
```

```bash
curl -o trace.out 'http://localhost:6060/debug/pprof/trace?seconds=5'
go tool trace trace.out
```

That captures 5 seconds of live execution. Keep the window short — traces grow fast.

---

## 8. When to reach for it (vs pprof)

| Symptom | Use |
|---------|-----|
| "CPU is high, *where* is it spent?" | pprof CPU profile |
| "Memory keeps growing." | pprof heap profile |
| "p99 latency is bad even though CPU is low." | **trace** |
| "Goroutines look stuck." | **trace** + goroutine profile |
| "GC pauses feel long." | **trace** |
| "I want to know *why* one slow request was slow." | **trace** (with user tasks/regions) |

pprof aggregates; trace shows the precise ordering of events. They answer different questions.

---

## 9. A common beginner mistake

Forgetting `trace.Stop()` (or returning before `defer trace.Stop()` runs) leaves the file unflushed:

```bash
$ go tool trace trace.out
failed to parse trace: unexpected EOF
```

Always pair `Start` with a deferred `Stop` and check the file size after your run.

---

## 10. Summary

`go tool trace` is the Go execution tracer's viewer: it shows a precise, per-event timeline of goroutine scheduling, GC, syscalls, and network I/O. You collect a trace with `go test -trace=...`, `runtime/trace.Start`/`Stop`, or `/debug/pprof/trace?seconds=N`, then open it with `go tool trace file`. The browser UI exposes a timeline plus per-dimension blocking profiles. Reach for it when latency or scheduler behaviour is the question — pprof handles "where is the time/memory spent on average?"

---

## Further reading
- `runtime/trace`: https://pkg.go.dev/runtime/trace
- `go doc cmd/trace`
- `net/http/pprof`: https://pkg.go.dev/net/http/pprof
