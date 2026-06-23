# Goroutine Common Pitfalls — Tasks

> Hands-on exercises. Reproduce each pitfall, observe the failure, apply the fix, verify with tests or tooling. Tasks grow in difficulty.

## How to use this file

1. Pick a task.
2. Write the broken version yourself (do not copy — typing it helps internalise).
3. Run it. Observe the actual failure mode (race detector output, panic, hang, wrong output).
4. Write the fix.
5. Verify with `go test -race`, `goleak`, or `pprof` as appropriate.

A solution sketch is at the bottom of each task.

---

## Task 1 — Reproduce and fix the captured loop variable

**Goal.** See the bug on Go ≤ 1.21 (or with a `go 1.21` directive in `go.mod`), then fix it.

**Steps.**

1. Write a program that spawns 5 goroutines in a `for i := 0; i < 5; i++ {}` loop, each printing `i`.
2. Run with `go run` on a 1.21 toolchain (or pin `go 1.21` in `go.mod`).
3. Observe `5 5 5 5 5` (or similar).
4. Fix by passing `i` as a parameter.
5. Verify output is some permutation of `0..4`.

**Bonus.** Make the same bug visible on Go 1.22+ using a non-loop variable: `for _, item := range items { x := compute(item); go func() { use(x) }() }` — the `x` is captured. Find a way to make it racy.

**Solution sketch.**

```go
for i := 0; i < 5; i++ {
    go func(i int) { fmt.Println(i) }(i)
}
```

---

## Task 2 — `wg.Add(1)` inside the goroutine

**Goal.** Write code where `wg.Wait()` returns prematurely, then fix it.

**Steps.**

1. Write a program that spawns 100 goroutines. Each calls `wg.Add(1)` inside the body, does work, calls `wg.Done()`.
2. Call `wg.Wait()` and print "all done."
3. Add a sleep inside each goroutine (~10 ms) and observe that "all done" prints before the work finishes.
4. Move `wg.Add(1)` to the parent before `go`.
5. Verify "all done" prints after all work completes.

**Solution sketch.**

```go
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
    wg.Add(1)               // parent
    go func() {
        defer wg.Done()
        time.Sleep(10 * time.Millisecond)
    }()
}
wg.Wait()
fmt.Println("all done")
```

---

## Task 3 — Forgetting `wg.Done()`

**Goal.** Cause `wg.Wait()` to deadlock, then fix with `defer`.

**Steps.**

1. Write a goroutine with two return paths: one happy, one error. Call `wg.Done()` only on the happy path.
2. Force the error path and observe the runtime detect deadlock.
3. Replace with `defer wg.Done()` at the top.

**Solution sketch.**

```go
go func() {
    defer wg.Done()
    if err := work(); err != nil {
        return                       // wg.Done still fires
    }
    finalize()
}()
```

---

## Task 4 — Goroutine leak via unread channel

**Goal.** Create a leak, detect it, fix it.

**Steps.**

1. Write a function `compute()` that spawns a goroutine sending on an unbuffered channel, then returns early without reading.
2. Call `compute()` in a loop 10 000 times.
3. Print `runtime.NumGoroutine()` — observe rising count.
4. Add `goleak.VerifyTestMain(m)` to a test and run it; observe the failure.
5. Fix by buffering the channel: `make(chan int, 1)`.

**Solution sketch.**

```go
ch := make(chan int, 1)         // size 1
go func() { ch <- expensive() }()
return cached                   // safe: goroutine can send and exit
```

---

## Task 5 — Ticker not stopped

**Goal.** Leak goroutines and tickers, detect, fix.

**Steps.**

1. In a loop, call `time.NewTicker(time.Second)` without `Stop`.
2. Wrap each ticker's consumption in a goroutine with no exit condition.
3. Observe goroutine and memory growth.
4. Fix: `defer t.Stop()` and add `select { case <-ctx.Done(): return; case <-t.C: ... }`.

---

## Task 6 — `time.Sleep` for synchronisation, failing in CI

**Goal.** Show that `time.Sleep`-based sync fails reliably under load.

**Steps.**

1. Write `go heavyWork(); time.Sleep(50 * time.Millisecond); fmt.Println("done")`.
2. Make `heavyWork` deterministically slow by adding `time.Sleep(75 * time.Millisecond)` inside.
3. Run repeatedly; observe `done` printed before the work finishes.
4. Replace with `WaitGroup` or `done` channel; verify.

---

## Task 7 — Concurrent map writes

**Goal.** Crash with `fatal error: concurrent map writes`.

**Steps.**

1. Spawn 100 goroutines each writing to a shared `map[int]int`.
2. Run; observe the fatal error.
3. Try to `recover` it — observe that `recover` does not work for fatal errors.
4. Fix with `sync.Mutex`. Verify with `-race` shows no race.

---

## Task 8 — Double close

**Goal.** Reproduce `panic: close of closed channel`, fix with single-closer.

**Steps.**

1. Five goroutines each `defer close(ch)` and send a value.
2. Run; observe the panic.
3. Fix: remove `defer close(ch)` from senders; add one closer goroutine: `go func() { wg.Wait(); close(ch) }()`.

---

## Task 9 — Send on closed channel

**Goal.** Cause `panic: send on closed channel`, diagnose, fix.

**Steps.**

1. Producer sends in a loop; another goroutine closes the channel after 100 ms.
2. Run; observe the panic.
3. Fix: ensure producer finishes before closing. Use `WaitGroup` or `context.Context`.

---

## Task 10 — `time.After` in a hot select loop

**Goal.** Observe memory growth from per-iteration timer allocation.

**Steps.**

1. Write a select loop receiving from a high-rate channel with `time.After(time.Second)` as the timeout case.
2. Run for 30 seconds at 100k messages/s.
3. Observe `go tool pprof http://localhost:6060/debug/pprof/heap` showing timer heap allocations.
4. Replace with `time.NewTimer` + `Reset`; rerun and observe reduced allocations.

---

## Task 11 — `defer` in a tight loop

**Goal.** Run out of file descriptors due to accumulated `defer`s.

**Steps.**

1. Loop over 10 000 files, open each, `defer f.Close()`, read.
2. Observe "too many open files" error.
3. Extract the body to a function so `defer` runs per iteration.
4. Verify the FD count stays bounded.

---

## Task 12 — Forgotten `cancel()`

**Goal.** See `go vet` warn; observe runtime impact.

**Steps.**

1. Write `ctx, _ := context.WithTimeout(parent, time.Second)`.
2. Run `go vet`; observe the warning.
3. Make the parent context long-lived; observe via pprof that the timer goroutine lives until the deadline.
4. Add `defer cancel()`; rerun.

---

## Task 13 — Mutex over a syscall

**Goal.** Demonstrate latency impact, then fix.

**Steps.**

1. A goroutine pool of 4 workers each take a global `sync.Mutex`, then make an HTTP GET request that takes ~1s, then release.
2. Measure throughput: ~1 req/s (serialised).
3. Move the HTTP GET outside the critical section.
4. Measure throughput: ~4 req/s.

---

## Task 14 — Atomic + non-atomic mixing

**Goal.** See the race detector flag the mix.

**Steps.**

1. One goroutine does `atomic.AddInt64(&counter, 1)`.
2. Another reads `fmt.Println(counter)` (plain).
3. Run `go test -race`; observe the race report.
4. Fix: use `atomic.LoadInt64` on the read side, or `atomic.Int64` typed wrapper.

---

## Task 15 — Singleton race

**Goal.** Show that `if instance == nil { instance = ... }` is racy.

**Steps.**

1. Spawn 100 goroutines each calling `Get()`.
2. Each `Get()` checks-then-creates without a mutex.
3. Run with `-race`; observe the race.
4. Replace with `sync.Once`. Verify no race.

---

## Task 16 — Background goroutine outliving a request

**Goal.** Memory grows under load.

**Steps.**

1. Build a tiny HTTP server. Each handler `go logRequest(r)` and returns immediately.
2. Make `logRequest` sleep 1 second to simulate work.
3. Load-test at 1000 RPS for a minute.
4. Observe goroutine count and memory growing linearly.
5. Fix: bounded worker pool consuming from a buffered channel.

---

## Task 17 — WaitGroup passed by value

**Goal.** See the `go vet copylocks` warning, understand why.

**Steps.**

1. Write `func spawn(wg sync.WaitGroup) { ... }`.
2. Run `go vet`; observe the warning.
3. Convince yourself the function's local `wg` is independent from the caller's by adding logging.
4. Fix: take `*sync.WaitGroup`.

---

## Task 18 — Reusing WaitGroup across rounds

**Goal.** Trigger undefined behaviour.

**Steps.**

1. One `WaitGroup` outside a loop; `Add`/`Done`/`Wait` per iteration.
2. Add a small race window: a goroutine from round N is still in `Wait` when round N+1's `Add` runs.
3. Observe failures (timing-dependent; may need many runs).
4. Fix: fresh `WaitGroup` per iteration.

---

## Task 19 — Errgroup ignoring context

**Goal.** Show that ignoring `ctx` defeats fail-fast.

**Steps.**

1. `errgroup.WithContext`. Five tasks; one returns an error after 100 ms; others sleep 5 s ignoring the context.
2. Measure: `g.Wait()` takes 5 s.
3. Modify tasks to respect `ctx.Done()`.
4. Measure: `g.Wait()` takes ~100 ms.

---

## Task 20 — HTTP client with no timeout

**Goal.** Leak goroutines due to slow servers.

**Steps.**

1. Use `&http.Client{}` (no timeout).
2. Hit an endpoint that hangs (a small Go server with `time.Sleep(1 * time.Hour)`).
3. Observe the calling goroutine stuck.
4. Add `client.Timeout = 5 * time.Second` (or context with deadline).
5. Verify the call returns with `context deadline exceeded`.

---

## Task 21 — Panic in a goroutine

**Goal.** Make a service-killing panic; recover at the boundary.

**Steps.**

1. Write a handler that spawns a goroutine which dereferences a nil pointer.
2. Observe the program crashes.
3. Add `defer recover()` at the top of the goroutine body; verify the program continues.
4. Log the recovered panic + stack trace.

---

## Task 22 — `sync.Pool` without `Reset`

**Goal.** See cross-contamination between pool users.

**Steps.**

1. `sync.Pool` of `*bytes.Buffer`. Get, write, return without Reset.
2. Next Get inherits the previous content.
3. Add `buf.Reset()` after `Get`.

---

## Task 23 — `goleak` integration

**Goal.** Add `goleak` to a test and make a test fail.

**Steps.**

1. `import "go.uber.org/goleak"` and add `goleak.VerifyTestMain(m)` to a test file.
2. Write a test that spawns a goroutine and forgets to clean up.
3. Run; observe the test fails listing the leaked goroutine.
4. Fix the test.

---

## Task 24 — Build a leak detector for a service

**Goal.** Implement a leak-budget alarm.

**Steps.**

1. Expose `runtime.NumGoroutine()` on `/metrics`.
2. Track over a 5-minute window.
3. If the count is monotonically rising with constant input, alarm.
4. Implement, simulate a leak, confirm alarm fires.

---

## Task 25 — Production-style pprof investigation

**Goal.** Reproduce a leak and diagnose it via pprof.

**Steps.**

1. Build a service with a deliberate leak (unread channel in a "fast path").
2. Enable pprof: `import _ "net/http/pprof"; go http.ListenAndServe("localhost:6060", nil)`.
3. Run load.
4. Dump goroutine profile: `curl http://localhost:6060/debug/pprof/goroutine?debug=2 > gor.txt`.
5. Read it; identify the dominant blocked stack.
6. Fix the bug.
7. Re-run; verify the dominant stack is gone.

---

## Task 26 — Subtle: capture in a method receiver

**Goal.** Pre-1.22 capture of receiver in a goroutine.

**Steps.**

1. `for _, s := range services { go s.Start() }` where `s` is a value receiver.
2. Pre-1.22, the captured `s` is the same address.
3. Reproduce, then fix with parameter pass or `s := s` shadow.

---

## Task 27 — Subtle: deferred close with multiple senders

**Goal.** Show that `defer close(ch)` from N senders panics.

**Steps.**

1. N goroutines, each `defer close(ch); send`.
2. Observe panic.
3. Apply single-closer; observe success.

---

## Task 28 — Subtle: cgo + LockOSThread without unlock

**Goal.** Observe M creation pressure.

**Steps.**

1. Spawn 1000 goroutines that each `runtime.LockOSThread()`, do work, return without unlock.
2. Observe `runtime.NumGoroutine()` and OS thread count (`/proc/<pid>/status`).
3. Note threads being destroyed.
4. Apply `defer runtime.UnlockOSThread()`; observe reuse.

---

## Task 29 — Build a "pitfall finder" linter

**Goal.** Write a small program that scans Go source for these pitfalls.

**Steps.**

1. Use `go/parser` and `go/ast` to parse a directory of `.go` files.
2. Find every `*ast.GoStmt` (go statement).
3. For each, check whether its function literal references a loop variable from the enclosing `*ast.ForStmt`.
4. Print warnings.

This is an intermediate-difficulty AST exercise. The goal is to internalise that pitfalls have *syntactic shapes* tools can find.

---

## Task 30 — Capstone: stress-test your own code

**Goal.** Find your own pitfalls.

**Steps.**

1. Pick a service you have written or one in your codebase.
2. Add `goleak` to its tests.
3. Run all tests with `-race -count=10`.
4. Fix everything that fails.
5. Add the metrics from Task 24.
6. Document one pitfall you fixed and why.

---

## Tooling cheat sheet

```bash
# Race detector
go test -race ./...

# Vet (catches some)
go vet ./...

# Goroutine count
curl http://localhost:6060/debug/pprof/goroutine?debug=2

# Continuous heap profile
go tool pprof -seconds=30 http://localhost:6060/debug/pprof/heap

# Trace
import "runtime/trace"
trace.Start(f); defer trace.Stop()
# then: go tool trace trace.out

# Scheduler debug
GODEBUG=schedtrace=1000,scheddetail=1 ./your-binary

# GC debug
GODEBUG=gctrace=1 ./your-binary
```

---

## Wrap-up

Pitfall reproduction is the fastest path to recognition. Tasks 1–10 give you the "shape muscle memory" — you have seen the bug, you know its symptom, you have applied the fix. Tasks 11–20 add real-world context. Tasks 21–30 push into observability, design, and tooling — the senior skills.

After completing this file, the pitfalls in [find-bug.md](find-bug.md) should feel familiar. The bugs there are dressed up; the shapes are the same.
