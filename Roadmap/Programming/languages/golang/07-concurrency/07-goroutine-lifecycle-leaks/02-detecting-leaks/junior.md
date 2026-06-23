# Detecting Goroutine Leaks — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "How do I know my program has goroutine leaks, and what tools tell me where they are?"

A **goroutine leak** is a goroutine that you started but that will never finish. It sits forever inside a blocking channel send, a blocking channel receive, a `select` with no ready case, a mutex `Lock` that will never be released, a `Wait` on a `sync.Cond` that nobody signals, or an infinite `for` loop that has no exit. The goroutine is stuck. The Go runtime cannot prove that nothing will ever wake it up, so it does not collect it. Its stack, its captured variables, and everything those variables reference remain alive — invisibly — for the rest of the process's lifetime.

A single leaked goroutine costs about 2 KB plus whatever it retains. That is invisible. A thousand leaked goroutines per minute, in a server that runs for a week, is not invisible. It is a slow memory growth that eventually triggers an OOM kill, or a connection pool that quietly exhausts, or a database that runs out of file handles. Goroutine leaks are the single most common Go-specific bug in production. Race conditions are flashier. Leaks are more common.

This file is about **detection**. Prevention — using `context.Context`, bounded channels, structured concurrency — belongs in [03-preventing-leaks](../03-preventing-leaks/). The deeper `pprof` workflow lives in [04-pprof-tools](../04-pprof-tools/). Here we focus on the first question: "How do I even know I have a leak?"

After reading this file you will:

- Define what a goroutine leak is and what makes it different from a slow operation.
- Use `runtime.NumGoroutine()` as a baseline-and-trend counter.
- Import `net/http/pprof` and hit `/debug/pprof/goroutine?debug=2` to read stack traces.
- Write a `TestMain` that calls `goleak.VerifyTestMain` to fail tests on leaks.
- Use `goleak.VerifyNone(t)` for per-test detection.
- Recognise the small set of "always-running" goroutines that are not leaks: the runtime sysmon, GC workers, the network poller, finalisers.
- Read a goroutine stack trace and identify the line where the goroutine is parked.
- Dump a goroutine profile programmatically with `pprof.Lookup("goroutine").WriteTo`.
- Know what `gops`, `dlv`, and `runtime/trace` are for and when to reach for them.

You do not need deep `pprof` internals yet. You do not need to write a Prometheus exporter yet. You need to be able to *notice* a leak — in development, in tests, in a running process — and find the line where the stuck goroutine is waiting.

---

## Prerequisites

- **Required:** A Go installation, version 1.20 or newer.
- **Required:** Comfort writing and running a small Go program with `go run`.
- **Required:** Basic understanding of goroutines, channels, and `select`. If `go func() { ... }()` is unfamiliar, read [01-goroutines/01-overview](../../01-goroutines/01-overview/) first.
- **Required:** Awareness that a goroutine that blocks forever is wrong. The [01-lifecycle](../01-lifecycle/) page covers the four ways a goroutine can end.
- **Helpful:** Familiarity with `go test`. You will write tests that use `goleak`.
- **Helpful:** Awareness that `go get` adds external dependencies.

If you can run `go test ./...` and read a stack trace, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Goroutine leak** | A goroutine that is started but will never exit. It blocks forever on a channel, a mutex, a `WaitGroup`, a network read with no deadline, or an infinite loop. |
| **Live goroutine** | A goroutine that has been scheduled and has not yet returned. The Go runtime tracks all live goroutines in an internal table. |
| **`runtime.NumGoroutine()`** | A function that returns the current count of live goroutines, including the main goroutine. The baseline for trend-based leak detection. |
| **`net/http/pprof`** | A package whose import side-effect registers HTTP handlers under `/debug/pprof/` on the default `http.DefaultServeMux`. |
| **Goroutine profile** | A snapshot of all live goroutines, each with a stack trace. Two formats: a compressed binary format readable by `go tool pprof`, and a human-readable text format from `?debug=2`. |
| **`goleak`** | The package `go.uber.org/goleak`, a small library that fails a Go test if extra goroutines remain after the test finishes. |
| **`VerifyTestMain`** | A `goleak` function called from `TestMain` that checks for leaked goroutines after all tests in a package have run. |
| **`VerifyNone`** | A `goleak` function called inside a single test that checks for leaks at the end of just that test. |
| **`pprof.Lookup("goroutine")`** | A function in the standard `runtime/pprof` package that returns a `*Profile` representing all live goroutines. |
| **`runtime.Stack`** | A function that writes a stack trace of one or all goroutines into a buffer. Lower level than `pprof`. |
| **Sysmon** | The Go runtime's *system monitor* goroutine. It is always alive, never exits, and is not a leak. |
| **Network poller** | A runtime helper that integrates with `epoll` / `kqueue` / IOCP. It manages goroutines that are waiting on network I/O. Always alive. |
| **GC worker** | A goroutine the runtime spawns to do background garbage-collection work. It comes and goes; it is not a leak. |
| **Stack frame grouping** | Counting how many goroutines share the same stack trace. The shared frame near the top is the place where many goroutines are stuck. |
| **`gops`** | A command-line tool from the Go team for inspecting live Go processes — version, goroutine count, stack dump, GC stats. |
| **`dlv`** | The Delve debugger. The `goroutines` command lists every live goroutine and lets you inspect one. |
| **`runtime/trace`** | A standard library tool that records every goroutine creation, block, unblock, and exit, viewable in a browser timeline. |

---

## Core Concepts

### A goroutine leak is "no one is going to call you"

When you start a goroutine, three things must be true for it to eventually exit:

1. The code path it runs ends in a `return`, a panic, or `runtime.Goexit()`.
2. Every blocking operation it performs (channel send, channel receive, `Mutex.Lock`, `WaitGroup.Wait`, network read) is eventually unblocked.
3. The thing that unblocks it actually happens. A `chan<-` send only completes when someone receives. A `<-chan` receive only completes when someone sends or closes the channel.

A leak is the failure of point 3. The goroutine is sitting at a blocking operation, waiting forever, because the thing that would unblock it has gone away. The receiver has returned. The cancel signal was never sent. The producer closed without flushing.

Example:

```go
func leaky() {
    ch := make(chan int) // unbuffered
    go func() {
        // This send blocks until someone receives.
        // Nobody ever receives. This goroutine leaks.
        ch <- 1
    }()
    // We never read from ch. We return.
}
```

The receiver side of `ch` becomes unreachable when `leaky` returns. The sender goroutine is now stuck at `ch <- 1` for as long as the program lives. There is no error message, no panic, no warning at compile time. The goroutine is leaked.

### Detection is about counting and about reading stacks

There are two complementary techniques:

- **Counting.** Take a snapshot of `runtime.NumGoroutine()` before some operation. Take another after. If the number stays elevated and never returns to the baseline, you have a leak. This is the cheapest signal.
- **Stack inspection.** Dump the stack trace of every live goroutine and look at where each one is parked. The line shown at the top of each stack is the line where the goroutine is currently blocked. If hundreds of goroutines are parked at the same line, that line is your culprit.

Every other technique in this file is one of these two ideas wrapped in a different tool — `goleak` is "count, then dump", `pprof` is "dump and group", `gops` is "ask another process for its stacks", `dlv` is "attach a debugger and walk the goroutine table by hand."

### Some goroutines are always alive — those are not leaks

When your program starts, the Go runtime spawns several goroutines for itself:

- The **sysmon** goroutine. It monitors blocked syscalls, retakes Ps from long-running goroutines, and pokes the GC. Always alive.
- The **network poller** goroutine on systems that have one. It handles `epoll`/`kqueue` events.
- **GC mark workers** and **GC dedicated workers**. They appear during GC cycles. They may be alive at any sampling point.
- A **finaliser** goroutine that runs `runtime.SetFinalizer` callbacks.
- A **template goroutine** for `runtime.LockOSThread` and a couple of other runtime helpers.

Depending on Go version, OS, and what you imported, the baseline count is typically between 4 and 10. Do not panic if `runtime.NumGoroutine()` is 7 at startup. That is normal. Worry when a number that should return to 7 keeps climbing — 50, then 100, then 1000.

### Tests are the cheapest place to catch leaks

`go.uber.org/goleak` lets you fail your unit tests automatically when a test leaks a goroutine. Before any test runs, it records the baseline goroutines. After your test, it compares. Extra goroutines that match user code are reported. The test fails. CI rejects the PR. The leak never reaches main.

This is the single highest-leverage tool in this file. Adopt it on day one.

---

## Real-World Analogies

- **Restaurant waiter who left.** A goroutine sending to an unbuffered channel is like a waiter holding a plate, waiting for a customer to take it. If the customer has left and nobody told the waiter, the waiter stands there forever. Detection is opening the kitchen door and counting how many waiters are still holding plates.
- **Call-centre operators on hold.** Each operator is a goroutine. Each "hold" is a blocking receive. If you start 1000 calls and only 200 customers ever pick up, 800 operators are stuck on hold. `runtime.NumGoroutine()` is the supervisor counting headsets.
- **Library book-return slot.** A goroutine doing `<-done` is like the librarian waiting at the return slot. If the slot is welded shut and nobody can drop a book in, the librarian waits forever. `pprof goroutine` dumps the librarian's location: "standing at slot #3."
- **Smoke alarm.** `goleak` is the smoke alarm: it does not put out the fire, but it makes the noise that gets you to the kitchen before the house burns down.

---

## Mental Models

### The "where is everyone parked?" model

A running Go program at any instant has N live goroutines. Each one is doing one of three things:

1. **Running.** Actively executing on a CPU.
2. **Runnable.** Waiting for a P to free up so it can run.
3. **Parked.** Blocked on something — a channel, a mutex, a syscall, a timer, a network read.

Almost every leak shows up in the **parked** group. So the first move in any leak hunt is: dump all goroutines, look at the parked ones, group them by where they are parked, and find the line that has more goroutines stuck on it than makes sense.

### The "baseline and slope" model

Treat goroutine count as a metric. Plot it over time.

- **Flat line at the baseline.** Healthy.
- **Sawtooth around a baseline.** Healthy — goroutines spawn and finish as work arrives.
- **Slow upward slope.** Leaking. Every unit of time adds a few stuck goroutines.
- **Step function up.** A burst of leaks, often from a one-time event (failed deploy, network blip).

The shape is more important than the absolute number. A server with a flat 50,000 goroutines is fine. A server going from 100 to 200 to 400 over an hour is broken.

### The "stack frame as fingerprint" model

Two goroutines stuck at the same code line have the same stack-trace fingerprint near the top. When you dump 10,000 goroutines and they group into one bucket of 9,995 plus a handful of singletons, the 9,995 are your bug, and the file:line at the top of the shared frame is the address of the bug.

---

## Pros & Cons

### `runtime.NumGoroutine()`

**Pros:**
- Zero dependencies, in the standard library.
- Effectively free to call (microseconds).
- Easy to expose as a metric.

**Cons:**
- Tells you a number, not a reason.
- Cannot tell which goroutines are leaks vs. legitimate work.
- Easy to misinterpret in long-running servers (handlers spike the count).

### `net/http/pprof`

**Pros:**
- Built-in, ready to use with a single import.
- Returns full stack traces for every goroutine.
- The same endpoints work in development and in production.

**Cons:**
- Exposes potentially sensitive info — must not be on a public port.
- The `?debug=2` text format is verbose; large servers print megabytes.
- The default mux is hijacked; you may want a separate one.

### `goleak`

**Pros:**
- Fails tests automatically on leaks.
- Tiny API surface, easy to adopt.
- Handles runtime-internal goroutines correctly out of the box.

**Cons:**
- Third-party dependency (Uber).
- False positives possible when tests leave background work intentionally.
- Adds a small amount of runtime overhead to each test run.

### `gops`

**Pros:**
- Inspect a running process without modifying its code.
- One command to list version, runtime stats, goroutine count.

**Cons:**
- Requires the `gops` agent to be started inside the program for the most useful features.
- Not in the standard library; another binary to install.

### `dlv`

**Pros:**
- Lets you step into a goroutine's frame and read variables.
- Indispensable for "this goroutine is stuck for some reason I do not understand."

**Cons:**
- Heavy. Attaches, pauses, debug-builds preferred.
- Steep learning curve compared to a text-mode profile.

---

## Use Cases

- **Local development.** Run a small program, hit Ctrl+C, see the goroutine count printed at exit. Catch leaks before commit.
- **Unit tests.** Adopt `goleak.VerifyTestMain` in every package. Reject PRs that leak.
- **Integration tests.** End each scenario with `goleak.VerifyNone(t)` to ensure background workers exited cleanly.
- **Staging environment.** Expose `/debug/pprof/goroutine?debug=2` and check it after a load test.
- **Production canary.** Emit `go_goroutines` (the count) as a Prometheus metric. Alert when the slope crosses a threshold.
- **Incident response.** When memory is climbing, hit `/debug/pprof/goroutine` to see if a hot path is leaking.
- **Code review.** Look at any new `chan`, `select`, or `go` statement and ask: "Is there a covered path where this goroutine could block forever?"

---

## Code Examples

### Example 1 — The simplest possible leak

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    fmt.Println("before:", runtime.NumGoroutine())
    for i := 0; i < 1000; i++ {
        go func() {
            ch := make(chan int)
            ch <- 42 // blocks forever
        }()
    }
    time.Sleep(100 * time.Millisecond)
    fmt.Println("after :", runtime.NumGoroutine())
}
```

Output, roughly:

```
before: 1
after : 1001
```

Each spawned goroutine creates its own private channel, sends to it, and is stuck because nobody else has a reference to that channel. The count climbed from the baseline to baseline + 1000. That is the leak signal.

### Example 2 — Reading `/debug/pprof/goroutine?debug=2`

```go
package main

import (
    "fmt"
    "log"
    "net/http"
    _ "net/http/pprof"
)

func leakyHandler(w http.ResponseWriter, r *http.Request) {
    ch := make(chan int)
    go func() {
        ch <- 1 // leak: no one reads
    }()
    fmt.Fprintln(w, "ok")
}

func main() {
    http.HandleFunc("/leak", leakyHandler)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

After hitting `curl localhost:8080/leak` a few times, fetch:

```
curl 'localhost:8080/debug/pprof/goroutine?debug=2'
```

You will see entries like:

```
goroutine 42 [chan send]:
main.leakyHandler.func1(0xc0000a0080)
        /tmp/main.go:14 +0x37
created by main.leakyHandler
        /tmp/main.go:13 +0x6f
```

The string `[chan send]` is the wait reason. The line `/tmp/main.go:14` is the *exact* place the goroutine is parked. The `created by` line tells you who spawned it. That is the entire investigation: line 14 of `main.go`, in the inner closure of `leakyHandler`.

### Example 3 — `goleak.VerifyTestMain`

```go
// file: leak_test.go
package mypkg

import (
    "testing"

    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Add this once per package. Run `go test ./mypkg`. If any test leaks a goroutine, the test binary exits with a non-zero status and prints the offending stack trace:

```
=== TestSomething
--- PASS: TestSomething (0.01s)
PASS
goleak: Errors on successful test run: found unexpected goroutines:
[Goroutine 33 in state chan send, with mypkg.startWorker.func1 on top of the stack:
goroutine 33 [chan send]:
mypkg.startWorker.func1()
        /go/src/mypkg/worker.go:21 +0x3c
created by mypkg.startWorker
        /go/src/mypkg/worker.go:19 +0x6e
]
exit status 1
```

Now your CI will reject the PR that introduced the leak.

### Example 4 — `goleak.VerifyNone` in a single test

```go
package mypkg

import (
    "testing"

    "go.uber.org/goleak"
)

func TestWorkerShutsDown(t *testing.T) {
    defer goleak.VerifyNone(t)

    w := NewWorker()
    w.Start()
    w.Stop() // if Stop doesn't actually stop, this test fails
}
```

Use `VerifyNone` when you cannot use `VerifyTestMain` (for example, the package has other tests that legitimately leave goroutines) or when you want per-test granularity.

### Example 5 — Dump goroutines programmatically

```go
package main

import (
    "log"
    "os"
    "runtime/pprof"
)

func main() {
    // ... your program runs and possibly leaks ...

    f, err := os.Create("goroutines.txt")
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()

    // debug=2 produces human-readable stack traces
    if err := pprof.Lookup("goroutine").WriteTo(f, 2); err != nil {
        log.Fatal(err)
    }
}
```

Now you have a `goroutines.txt` file you can grep, diff, or attach to a bug report.

### Example 6 — Manual count-before / count-after

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func suspectOperation() {
    go func() {
        ch := make(chan int)
        <-ch // leak
    }()
}

func main() {
    runtime.GC()
    before := runtime.NumGoroutine()

    for i := 0; i < 100; i++ {
        suspectOperation()
    }
    time.Sleep(50 * time.Millisecond) // give them a chance to schedule

    runtime.GC()
    after := runtime.NumGoroutine()
    fmt.Printf("delta: %d\n", after-before)
}
```

A delta of 0 is the goal. A delta of 100 is a confirmed leak.

### Example 7 — Read `runtime.Stack` of all goroutines

```go
package main

import (
    "fmt"
    "runtime"
)

func dumpAll() {
    buf := make([]byte, 1<<20)
    n := runtime.Stack(buf, true) // true = all goroutines
    fmt.Println(string(buf[:n]))
}
```

This is the lowest-level way to dump goroutines. It is what `pprof goroutine?debug=2` is built on. Use it when you cannot bring in `net/http/pprof` (for example, a CLI tool with no HTTP server).

### Example 8 — Print goroutine count on `SIGUSR1`

```go
package main

import (
    "fmt"
    "os"
    "os/signal"
    "runtime"
    "syscall"
)

func main() {
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGUSR1)
    go func() {
        for range sigs {
            fmt.Fprintf(os.Stderr, "goroutines: %d\n", runtime.NumGoroutine())
        }
    }()

    // ... your program ...
    select {} // wait forever for demo purposes
}
```

Now `kill -USR1 <pid>` prints the live count without restarting the program.

---

## Coding Patterns

### Pattern: register `pprof` once, on a separate port

Do not put pprof on your public service port. Bind it to localhost or a private port:

```go
import (
    "net/http"
    _ "net/http/pprof"
    "log"
)

func init() {
    go func() {
        log.Println(http.ListenAndServe("localhost:6060", nil))
    }()
}
```

Now `/debug/pprof/...` is only reachable from inside the container or via `kubectl port-forward`. External users cannot scrape stacks.

### Pattern: one `TestMain` per package

```go
package mypkg

import (
    "testing"

    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m,
        // ignore goroutines that the test package or its dependencies leak intentionally
        goleak.IgnoreTopFunction("github.com/example/lib.backgroundLoop"),
    )
}
```

The `Ignore*` options let you carve out known background goroutines. Use them sparingly — every ignore is a small leak you accepted.

### Pattern: poll-and-wait for shutdown in tests

```go
func waitGoroutines(t *testing.T, target int) {
    t.Helper()
    deadline := time.Now().Add(2 * time.Second)
    for time.Now().Before(deadline) {
        if runtime.NumGoroutine() <= target {
            return
        }
        time.Sleep(10 * time.Millisecond)
    }
    t.Fatalf("still %d goroutines, expected %d", runtime.NumGoroutine(), target)
}
```

Useful as an alternative to `goleak` when you want to assert a specific count rather than "no leaks beyond baseline."

---

## Clean Code

- Put pprof imports in a single `cmd/.../pprof.go` file with a build tag, so they are easy to find. Example: `//go:build !no_pprof`.
- Group every `go` statement near a clear shutdown path. If you spawn a goroutine, the next thing in the same struct should be its stop signal.
- Name your goroutines mentally. When you read a stack trace, you want the function name to tell you the role: `pollMetrics`, not `func1`. Prefer named functions over anonymous closures for anything non-trivial.
- Comment any goroutine that intentionally never exits. The next maintainer will read your comment, not your shrug.
- Never call `runtime.NumGoroutine` in a tight hot loop. It walks a small lock but is not free at millions of calls per second.

---

## Product Use / Feature

- **CLI health command.** Add `myapp doctor` or `myapp debug goroutines` that prints the live count and stack dump. Useful when a customer says "the daemon is using too much memory."
- **Admin endpoint.** A protected `/admin/runtime` endpoint that returns goroutine count and key runtime stats. Use it during incidents.
- **Status badge.** In your dashboard UI, surface goroutine count next to memory and CPU. Engineers learn to trust the trend line.

---

## Error Handling

Detecting a leak is not a runtime error — there is nothing to recover from. But your *response* to a detection signal is operational error handling:

- A `goleak` test failure is a CI error. Treat it like a compile failure.
- A `/debug/pprof/goroutine` HTTP error (5xx) is usually because the runtime is too busy to lock the goroutine list — that itself is a signal.
- If your monitoring alert "goroutines climbing" fires, page the on-call. Pretend it is OOM.

Do not silently swallow detection signals. The whole point of detection is to make leaks loud.

---

## Security Considerations

- **Never expose `/debug/pprof` on a public interface.** Goroutine stacks can leak data: SQL with embedded parameters, keys passed by value, internal hostnames. Bind to localhost or guard with auth.
- **Sanitise stack traces before posting in bug reports.** A copy-pasted stack from a production server can contain customer data in argument lists. The argument values you see at the top of each frame are the actual runtime values.
- **`goleak` and `runtime/pprof` themselves are safe** — they read in-process state, do not call out to anything, and add no new attack surface.
- **`gops` agent listens on a local TCP socket.** Make sure that socket is not reachable from anywhere except localhost. The default behaviour is local-only; double-check before deploying.

---

## Performance Tips

- `runtime.NumGoroutine()` is cheap but not free — about 100 ns. Once per metrics-scrape interval is fine. Once per request is also fine. Once per loop iteration is not.
- `pprof.Lookup("goroutine").WriteTo(w, 2)` stops the world briefly to walk the goroutine list. At 10,000+ goroutines, the dump itself can take milliseconds. Do not put it on a hot HTTP handler.
- `runtime.Stack(buf, true)` is the same operation but lower-level. Same caveats.
- `goleak` adds at most a few microseconds per test. Run it on every package.
- `/debug/pprof/goroutine?debug=2` returns a large body — sometimes megabytes. Stream it to disk, do not load it into a string in your shell.

---

## Best Practices

1. **Adopt `goleak.VerifyTestMain` from day one.** It is the cheapest insurance.
2. **Expose `go_goroutines` as a metric.** Even a single dashboard panel will tell you about leaks long before the OOM killer does.
3. **Run a leak audit every release.** Hit `/debug/pprof/goroutine?debug=1` (numeric counts) and compare to last release.
4. **Document long-running goroutines.** Put a comment "// Lives until process exit. Owned by serverShutdown." above any goroutine that never returns.
5. **Bound your channels and your timeouts.** Most leaks are blocked channel operations; bounded queues and `context.WithTimeout` prevent them.
6. **Treat tests as the first line of defence.** Then staging. Then production. Never let production be the first place a leak is caught.
7. **When in doubt, dump.** A `pprof.Lookup("goroutine").WriteTo(os.Stderr, 2)` on shutdown is a one-line investment.
8. **Keep pprof imports behind a build tag if you ship binaries to untrusted environments.** Or expose them only on a private port.

---

## Edge Cases & Pitfalls

- **Goroutines that exit on `runtime.Goexit()` count as exited.** They do not show up in subsequent profiles, and they release their `defer`s.
- **Goroutines that panic without `recover` crash the program.** They cannot leak — there is no program left.
- **A `select { case <-ctx.Done(): }` with no other case effectively waits for cancellation.** If the context is never cancelled, that is a leak. The compiler does not warn you.
- **`time.After(d)` in a `select` that breaks out of the loop without consuming it leaks the timer goroutine** until `d` elapses. For `d` of 24 hours, that is 24 hours of leak. Prefer `time.NewTimer` + explicit `Stop`.
- **CGo-blocked goroutines look like leaks but may be legitimate.** A goroutine blocked in `[syscall]` for hours might be waiting on a real I/O operation. Look at the call site before declaring leakage.
- **A `goleak` failure on a passing test is not a bug in `goleak` — it is a real leak.** Treat false positives as a last resort, not a default.
- **Newly spawned goroutines may not be visible in a profile taken in the same nanosecond.** Add a `time.Sleep(10 * time.Millisecond)` between spawning work and counting if you want determinism.

---

## Common Mistakes

1. **Counting goroutines once.** A single sample tells you nothing. Trends are what matters.
2. **Ignoring the baseline.** Forgetting that the runtime itself owns several goroutines, and panicking when `NumGoroutine` is 5 at startup.
3. **Putting pprof on the public port.** A serious information leak. Always bind privately.
4. **Calling `WriteTo(os.Stdout, 2)` in production.** That can be megabytes per request. Use a file or a private endpoint.
5. **Believing `goleak` is a substitute for `context.Context`.** `goleak` *finds* leaks; it does not *fix* them. The fix is structured concurrency.
6. **Adding `goleak.IgnoreTopFunction` whenever a test fails.** That hides bugs. Each ignore should be justified in a comment.
7. **Reading only the top of the stack trace.** The `created by` line is often more revealing than the topmost frame.
8. **Treating "5000 goroutines" as a leak.** A server with 5000 active connections has 5000+ live goroutines. The shape of the count, not its value, matters.

---

## Common Misconceptions

- **"The garbage collector cleans up leaked goroutines."** No. A blocked goroutine has a reachable stack and reachable captured variables. The GC sees it as alive.
- **"If a goroutine has no references, it gets collected."** A live goroutine is a GC root. There is no escape via "nobody references it" — *it* references things, and *it* is rooted by the runtime.
- **"`runtime.NumGoroutine` includes finished goroutines."** No. It returns only live ones.
- **"pprof works only with `go tool pprof`."** No. `?debug=2` is plain text. `?debug=1` is compact text with counts. Only `?debug=0` (the default) is the protobuf format that `go tool pprof` consumes.
- **"`goleak` slows tests down."** Negligibly. The overhead is one `runtime.Stack` call per package.
- **"You need a profiler for every detection."** You do not. The `NumGoroutine` + log line catches most production regressions.

---

## Tricky Points

- A goroutine in `[syscall]` state is not parked on Go — it is in the kernel. It will return to Go state when the syscall returns. It still counts toward `NumGoroutine`.
- `pprof.Lookup("goroutine")` may return slightly different counts on consecutive calls because the GC and sysmon spawn workers around the boundary. Differences of 1–3 are noise.
- `goleak.VerifyTestMain` runs *after* all `TestXxx` finish. If you leak inside `TestMain` itself (before calling `m.Run()`), `goleak` will not catch it.
- A goroutine that holds a lock will keep that lock forever if it leaks. Any other goroutine waiting on that lock now leaks too. Leaks cascade.
- The `runtime/pprof` API guarantees one profile per name. Multiple calls to `Lookup("goroutine")` return the same handle but a fresh snapshot when you `WriteTo`.

---

## Test

You will be tested on these:

1. Write a test that spawns a goroutine, fails to clean it up, and demonstrate that `goleak.VerifyNone(t)` catches it.
2. Given a `/debug/pprof/goroutine?debug=2` dump with 200 goroutines parked at `chan send`, name the line of code responsible.
3. Explain why `runtime.NumGoroutine()` returns 5 immediately after `main` starts.
4. Show how to dump every goroutine's stack to a file without using HTTP.
5. Identify which of these are leaks: (a) `select {}` with no cases, (b) `time.Sleep(1 * time.Hour)`, (c) `<-ctx.Done()` where `ctx` is never cancelled.
6. Write a `TestMain` that ignores goroutines whose top frame is `pkg.LoggerFlush`.
7. Given two goroutine profiles taken five minutes apart, write a one-liner shell command to find new stack signatures.

---

## Tricky Questions

**Q1. "I see 3 goroutines at startup. Is that normal?"**
Yes. The runtime always has a small constant baseline. Numbers between 4 and 10 at startup are typical.

**Q2. "My test passes locally but `goleak` fails in CI. Why?"**
CI is slower. A background goroutine may not have exited before `VerifyTestMain` ran. Either give it time (poll-and-wait) or fix it to exit synchronously.

**Q3. "`/debug/pprof/goroutine?debug=2` is huge. How do I make it manageable?"**
Use `?debug=1` — it counts identical stacks and prints each unique stack once. The output is much smaller and easier to read.

**Q4. "A goroutine in `[chan receive, 30 minutes]` — is that a leak?"**
Probably. The `30 minutes` is how long it has been parked. A legitimate long wait (waiting for a periodic job) is rare. Most 30-minute parks are leaks.

**Q5. "Does `goleak` work with parallel tests?"**
Yes, but be careful. If two tests run in parallel and both legitimately spawn workers, `goleak` may see one test's workers as leaks of the other. Prefer `VerifyTestMain` over per-test `VerifyNone` when running parallel tests.

**Q6. "What is the difference between `pprof.Lookup` and `runtime.Stack`?"**
`runtime.Stack` writes raw bytes. `pprof.Lookup` wraps it in the pprof format. For human reading, `pprof.Lookup` with `debug=2` is cleaner.

**Q7. "Why does `dlv goroutines` show more goroutines than `runtime.NumGoroutine`?"**
Delve sees runtime-internal goroutines in different states. The user-visible `NumGoroutine` count is consistent; debugger views are exhaustive.

---

## Cheat Sheet

```go
// Quick count
n := runtime.NumGoroutine()

// Dump all stacks to stderr
buf := make([]byte, 1<<20)
n = runtime.Stack(buf, true)
os.Stderr.Write(buf[:n])

// pprof goroutine profile to a file (text)
f, _ := os.Create("g.txt")
pprof.Lookup("goroutine").WriteTo(f, 2)

// goleak in TestMain
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}

// goleak in a single test
func TestX(t *testing.T) {
    defer goleak.VerifyNone(t)
    // ...
}
```

HTTP endpoints once `net/http/pprof` is imported:

| URL | Purpose |
|------|---------|
| `/debug/pprof/goroutine?debug=2` | Full stack trace of every goroutine |
| `/debug/pprof/goroutine?debug=1` | Compact text with counts per unique stack |
| `/debug/pprof/goroutine` | Protobuf for `go tool pprof` |

---

## Self-Assessment Checklist

- [ ] I can define "goroutine leak" in one sentence.
- [ ] I know `runtime.NumGoroutine()` and what numbers to expect at startup.
- [ ] I can register `net/http/pprof` and curl the goroutine endpoint.
- [ ] I have added `goleak.VerifyTestMain` to at least one of my Go packages.
- [ ] I can read a `chan send` stack frame and find the leaky line.
- [ ] I know not to expose pprof on a public port.
- [ ] I can list at least three runtime goroutines that are always alive.
- [ ] I can use `pprof.Lookup("goroutine").WriteTo` from inside my own code.
- [ ] I can explain to a teammate why a leaked goroutine retains memory even though "nobody references it."

---

## Summary

A goroutine leak is a goroutine that never exits. It silently retains memory and resources, and a slow stream of leaks eventually crashes long-running servers. Detection is built on two ideas: counting (`runtime.NumGoroutine`, exported as a metric) and stack inspection (`pprof.Lookup("goroutine")`, `/debug/pprof/goroutine?debug=2`, or `runtime.Stack`). In tests, `go.uber.org/goleak` automates both — it counts the baseline and dumps mismatching stacks on test failure. In production, `gops`, `dlv`, and `runtime/trace` give you more powerful but more invasive views. The first move on any "memory is growing" symptom is to look at the goroutine count over time; if it is rising, you have a leak, and the rest of this section ([03-preventing-leaks](../03-preventing-leaks/), [04-pprof-tools](../04-pprof-tools/)) tells you how to fix it.

---

## What You Can Build

- A small **leak-canary HTTP middleware** that wraps every handler and logs if the goroutine count climbs more than N after the handler returns.
- A **`go vet`-style linter** that scans for `go func()` followed by an unbounded channel send with no `select { case ... case <-ctx.Done(): }`.
- A **`make leak-audit`** target that runs the binary against a load test, snapshots `/debug/pprof/goroutine?debug=1`, and diffs against last release.
- A **debug command** in your CLI: `myapp debug goroutines`, which `kill -USR1`s itself and tails the stderr dump.

---

## Further Reading

- The `runtime/pprof` package documentation.
- The `net/http/pprof` package documentation.
- The `go.uber.org/goleak` GitHub repository and README.
- Dave Cheney, "Never start a goroutine without knowing how it will stop" — a foundational essay.
- The Go blog post "Profiling Go Programs" — the canonical pprof walkthrough.
- The `gops` repository at `github.com/google/gops`.
- The `dlv` documentation, specifically the `goroutines` and `goroutine` commands.

---

## Related Topics

- [01-lifecycle](../01-lifecycle/) — How a goroutine starts and ends; the four exit conditions.
- [03-preventing-leaks](../03-preventing-leaks/) — Patterns that stop leaks at the source: `context`, cancellation, bounded channels.
- [04-pprof-tools](../04-pprof-tools/) — Deep dive on `go tool pprof`, flame graphs, allocation profiles, and trace viewers.
- [04-channels](../../04-channels/) — Most leaks happen at a `chan` operation; understanding channel semantics is prerequisite.
- [06-context](../../06-context/) — The standard way to plumb cancellation through goroutines.

---

## Diagrams & Visual Aids

```
                  HEALTHY                       LEAKING
   NumGoroutine                       NumGoroutine
       ^                                    ^
       |   _   _   _                        |             ___---
       |  / \ / \ / \                       |     ___---
       | /   v   v   \____                  |  ---
       |/                                   |
       +-----------------> time             +-----------------> time
       sawtooth around baseline             monotonic upward slope
```

```
   A leaked goroutine, retention chain
   ============================================
   runtime.allgs ----+
                     |
                     v
                 [goroutine 42]
                 stack frame:  ch <- 1
                 captures:     ch -> chan int
                               ctx -> *context.cancelCtx
                               buf -> *[]byte (3 KB)
                 result:       3 KB + chan + ctx + ... live forever
```

```
   Investigation flow
   ============================================
   "memory is growing" --> NumGoroutine over time?
                              |
                              +-- flat ---> not a goroutine leak; check heap
                              |
                              +-- climbing --> dump /debug/pprof/goroutine?debug=2
                                                |
                                                +-- group by top frame
                                                |
                                                +-- find file:line with many parked
                                                |
                                                +-- read code, find missing cancellation
```
