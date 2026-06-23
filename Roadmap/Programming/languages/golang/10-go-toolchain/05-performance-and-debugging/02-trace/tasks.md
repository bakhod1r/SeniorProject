# go tool trace — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+ (Go 1.23+ for the flight recorder task).

---

## Task 1: Capture a trace via test

Write a small test that does some concurrent work (a few goroutines sending on a channel) and capture a trace via `go test`.

```bash
go test -trace=trace.out ./...
```

**Acceptance criteria**
- [ ] `trace.out` exists and is non-empty.
- [ ] You can explain in one sentence what `-trace` does to the test binary.
- [ ] The file would not have appeared without the `-trace` flag.

---

## Task 2: Open the trace in the browser

Open the trace from Task 1 in the viewer.

```bash
go tool trace trace.out
```

**Acceptance criteria**
- [ ] The command prints a URL like `http://127.0.0.1:54321` and your browser opens it (or you open it manually).
- [ ] You see the landing page and can name at least four tabs (View trace, Goroutine analysis, blocking profiles, ...).
- [ ] In "View trace" you can zoom (`w`/`s`) and pan (`a`/`d`) on the timeline.

---

## Task 3: Find a STW pause

Write a program that allocates aggressively (e.g., create lots of small slices in a loop for a few seconds), capture a trace from it, and locate a GC STW phase.

```go
trace.Start(f); defer trace.Stop()
for i := 0; i < 1_000_000; i++ {
    _ = make([]byte, 1024)
}
```

**Acceptance criteria**
- [ ] You can point to the GC band in the timeline.
- [ ] You can identify a STW sub-phase (vertical band across all PROCs).
- [ ] You can report the STW duration from clicking the bar (sub-millisecond on a healthy run).

---

## Task 4: Capture a trace from a live HTTP server

Wire `net/http/pprof` into a tiny server, generate some load (e.g., `hey` or a `for` loop with `curl`), and capture 5 seconds of trace.

```go
import _ "net/http/pprof"
// expose on 127.0.0.1:6060
```

```bash
curl -o trace.out 'http://127.0.0.1:6060/debug/pprof/trace?seconds=5'
go tool trace trace.out
```

**Acceptance criteria**
- [ ] The endpoint is bound to a non-public address (verify `lsof -i` or netstat shows `127.0.0.1`, not `0.0.0.0`).
- [ ] The capture takes ~5 seconds and produces a non-empty `trace.out`.
- [ ] You can identify HTTP handler goroutines in the timeline.

---

## Task 5: Instrument code with `runtime/trace.WithRegion`

Add tasks and regions around a request flow in your server.

```go
ctx, task := trace.NewTask(r.Context(), "GET /work")
defer task.End()
trace.WithRegion(ctx, "auth",  func() { authorize(r) })
trace.WithRegion(ctx, "db",    func() { queryDB(ctx) })
trace.WithRegion(ctx, "render", func() { render(w) })
```

Capture another trace from the running server.

**Acceptance criteria**
- [ ] The "User-defined tasks" tab lists `GET /work` entries with their child regions and durations.
- [ ] Clicking a task in the UI jumps the timeline to that region.
- [ ] You can answer "which region took the most time in the slowest task?" from the UI alone.

---

## Task 6: Identify a goroutine blocked on a syscall

Write code that performs a long syscall (e.g., reads from a slow pipe, opens a slow file, or use `time.Sleep` is NOT a syscall — try `os.Stdin.Read` with no input piped). Capture and find it.

**Acceptance criteria**
- [ ] In the "Syscall blocking profile" tab, the offending call site is the top entry.
- [ ] In the timeline, you can see the `PROC` row sit in the "Syscall" state for that goroutine.
- [ ] You can explain whether the runtime handed the P off to another M during that wait.

---

## Task 7: Identify scheduler latency

Cause over-subscription: spawn `runtime.NumCPU() * 50` goroutines that each do a small CPU burn (`for i := 0; i < 1e7; i++ {}`), all started near-simultaneously. Capture a trace.

**Acceptance criteria**
- [ ] In the "Scheduler latency profile", you see non-trivial runnable-to-running delays for goroutines created at your spawn site.
- [ ] You can name two likely causes (over-subscription; CPU quota / `GOMAXPROCS` mismatch in containers).
- [ ] You confirm `GOMAXPROCS` (via `runtime.GOMAXPROCS(0)` or `go env GOMAXPROCS`) matches expectations.

---

## Task 8: Flight recorder — snapshot on SLO miss (Go 1.23+)

Use `runtime/trace.FlightRecorder` to keep a rolling buffer. In a synthetic request handler, snapshot the trace whenever a request takes longer than 200ms.

```go
fr := trace.NewFlightRecorder()
fr.Start()
defer fr.Stop()

http.HandleFunc("/req", func(w http.ResponseWriter, r *http.Request) {
    start := time.Now()
    work() // sometimes slow
    if time.Since(start) > 200*time.Millisecond {
        f, _ := os.Create(fmt.Sprintf("slo-miss-%d.trace", time.Now().UnixNano()))
        fr.WriteTo(f); f.Close()
    }
})
```

**Acceptance criteria**
- [ ] Slow requests produce `.trace` files; fast requests do not.
- [ ] Each snapshot opens cleanly in `go tool trace` and covers the recent past (a few seconds).
- [ ] You can articulate why this is cheaper in steady state than writing a continuous trace to disk.

---

## Task 9 (stretch): Custom analysis without the UI

Write a small program that uses `golang.org/x/exp/trace` to parse `trace.out` and print, for each goroutine, the time it spent in each state (Running, Runnable, Waiting, Syscall).

**Acceptance criteria**
- [ ] Your program produces a CSV (goroutine ID, state, total time) for the trace.
- [ ] The total per goroutine roughly matches what "Goroutine analysis" shows in the UI.
- [ ] You can imagine wiring this into a CI gate that fails when p99 scheduler latency exceeds an SLO.
