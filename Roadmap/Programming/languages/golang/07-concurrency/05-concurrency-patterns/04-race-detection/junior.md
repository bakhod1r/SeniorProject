# Race Detection — Junior Level

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
> Focus: "What is a data race, and how do I find one?"

You wrote some concurrent code. Two goroutines update a shared counter. Sometimes the counter is right; sometimes it is one too low. You re-read the code; it *looks* correct. You add fmt.Println. The bug disappears. You remove the println. The bug comes back, sometimes.

That is a **data race**. A data race is the situation where two goroutines access the same memory location, at least one of them writes to it, and there is no synchronisation between them. The result is undefined: the program may compute the right answer most of the time, then suddenly produce garbage, panic, or corrupt the heap.

Go ships with a tool for finding data races: the **race detector**. You enable it with the `-race` flag:

```bash
go run -race main.go
go test -race ./...
go build -race ./cmd/myservice
```

When enabled, the runtime watches every memory access and reports the first time it sees two unsynchronised accesses to the same address. The output is a stack trace of both accesses with goroutine ids — enough to pinpoint the bug.

After reading this file you will:
- Understand what a data race is (and how it differs from "race condition")
- Know how to enable the race detector
- Know what a race report looks like and how to read it
- Be able to fix the most common race patterns: shared counter, shared map, captured loop variable
- Understand the basics of the Go memory model: channels and mutexes provide happens-before
- Know when to use `-race` (always in CI and dev) and when not to (production)

You do **not** need to fully understand ThreadSanitizer internals, the formal memory model, or atomics. Those are middle and senior topics.

---

## Prerequisites

- **Required:** Comfort with goroutines and channels.
- **Required:** Knowing what `sync.Mutex` is.
- **Required:** Comfort running `go test`.
- **Helpful:** Having written at least one bug yourself in concurrent code.

If you have ever spawned a goroutine that updated a shared variable, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Data race** | Two goroutines access the same memory, at least one writes, and there is no happens-before relationship between them. The Go memory model leaves the result undefined. |
| **Race condition** | A logic-level bug whose outcome depends on goroutine timing — e.g. "check then act". Distinct from data race; may exist even with proper synchronisation. |
| **Race detector** | A runtime tool, enabled by `-race`, that instruments memory accesses and reports unsynchronised access pairs. Built on ThreadSanitizer. |
| **Happens-before** | A formal ordering between two events. If A happens-before B, then B is guaranteed to see the effects of A. Created by channels, mutexes, sync.Once, atomics, etc. |
| **Memory model** | The rules of the language about which writes are visible to which reads across goroutines. Defines what is and is not a race. |
| **Synchronised access** | Memory access protected by a mutex, channel send/receive, atomic operation, or other happens-before edge. |
| **Stack trace in race report** | The sequence of function calls leading to each access (the read and the write), with goroutine ids and source lines. |
| **`go test -race`** | The most common way to run the detector — all tests run with full race instrumentation. |
| **Overhead** | Roughly 5x to 10x slower CPU and 2x to 3x more memory when -race is enabled. Not for production. |
| **False negative** | A race the detector did not catch because the two accesses never happened during the test run. The detector cannot prove absence of races. |
| **False positive** | Extremely rare. The detector almost never reports a race that is not really there. |

---

## Core Concepts

### The simplest race

```go
var counter int

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter++ // ← data race
        }()
    }
    wg.Wait()
    fmt.Println(counter) // not always 1000
}
```

`counter++` is *three* operations: load `counter`, add 1, store it back. Two goroutines can load the same value, both add 1, both store — net effect is +1 instead of +2. Run this without `-race` and the output is sometimes 1000, sometimes 998, sometimes 750.

Run it with `-race` and you get a clear report:

```
==================
WARNING: DATA RACE
Read at 0x... by goroutine 7:
  main.main.func1()
      main.go:10 +0x...
Previous write at 0x... by goroutine 6:
  main.main.func1()
      main.go:10 +0x...
==================
```

### What "happens-before" means

The Go memory model says: a write to a variable is guaranteed to be visible to a read in another goroutine *only if* there is a happens-before edge between them. Edges come from:

- A channel send happens-before the matching receive completes.
- A channel close happens-before a receive that returns the zero value.
- A `sync.Mutex.Unlock()` happens-before the next `Lock()` on the same mutex.
- A `sync.Once.Do(f)` happens-before any later call to `Do` on the same `Once`.
- A `sync.WaitGroup.Done` happens-before the matching `Wait` returns.
- The end of a goroutine started with `go f()` happens-before any code after `f`'s return — but goroutine *start* itself is also synchronised: code before `go f()` happens-before `f` running.

If two memory accesses (and one is a write) are not connected by any of these, they race.

### Fixing the counter race

```go
var (
    counter int
    mu      sync.Mutex
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()
            counter++
            mu.Unlock()
        }()
    }
    wg.Wait()
    fmt.Println(counter) // always 1000
}
```

Or with `sync/atomic`:

```go
var counter int64
// ...
atomic.AddInt64(&counter, 1)
```

Both establish happens-before edges between increments. The detector is happy.

### The captured loop variable race

```go
for i := 0; i < 5; i++ {
    go func() {
        fmt.Println(i) // ← race + logic bug
    }()
}
```

Two problems: (1) all goroutines print the same `i`, often `5`; (2) the main goroutine writes `i` while the children read it — a race. Fix:

```go
for i := 0; i < 5; i++ {
    i := i // shadow per iteration
    go func() {
        fmt.Println(i)
    }()
}
```

Or, in Go 1.22+, the loop variable is per-iteration by default — but many codebases still target older versions, so the explicit shadow is safest.

### Shared map race

```go
m := map[string]int{}
go func() { m["a"] = 1 }()
go func() { _ = m["a"] }()
```

Reads and writes to a Go map without synchronisation race *and can crash the program* with a "concurrent map read and map write" runtime panic — even without `-race`. Use `sync.RWMutex` or `sync.Map`.

### How to enable the detector

```bash
go test -race ./...        # tests
go run -race main.go       # one-off run
go build -race -o app cmd/app  # produce a race-instrumented binary
```

### Reading a race report

The report has three parts:

1. The bad access (the more recent of the two): file, line, goroutine id.
2. The previous access: file, line, goroutine id, and where that goroutine was started.
3. Stack traces for both.

The fix is almost always: add a `Mutex`, an atomic op, or replace the shared variable with channel communication.

---

## Real-World Analogies

### Two cashiers, one cash drawer
Both reach into the drawer at once. The total at end of day is wrong — and you cannot tell which cashier shorted the till. The race detector is a CCTV that catches the moment two hands enter the drawer simultaneously.

### Two editors, one document, no version control
They both open the doc, both type, both save. The last save wins; the other's changes vanish. You need locking (file lock) or a happens-before relationship (one finishes before the other opens).

### A whiteboard with two students
Both write and erase at the same time. The board ends up garbled — sometimes by chance, the writes don't overlap and the result *looks* correct.

### Two airline check-in agents, one seat list
Both check seat 14A available, both assign it. Two passengers turn up. A lock around "check-and-assign" prevents the race.

---

## Mental Models

### Model 1: "Race = unsynchronised access"
A race is not bad timing. It is two memory accesses without any happens-before edge. The fix is always to add an edge.

### Model 2: "The detector is a lie detector for memory"
It instruments every load and store. If two goroutines touch the same byte without coordination, it tells you immediately.

### Model 3: "A test that passes without `-race` proves nothing about concurrency"
A race may not produce a wrong answer on the platform, scheduler, or CPU you happened to test on. It can blow up in production. `-race` is the only reliable way to find races.

### Model 4: "Channels and mutexes are the canonical happens-before tools"
"Don't communicate by sharing memory; share memory by communicating" — channels build happens-before for free. Mutexes are the second tool.

### Model 5: "Atomic operations are not magic"
`sync/atomic` ensures atomicity (no torn read/write) and provides happens-before for that one operation. They do not solve all races; multi-step operations still need a mutex or a more carefully designed atomic protocol.

---

## Pros & Cons

| Pros (using `-race`) | Cons |
|------|------|
| Catches real races at runtime. | 5-10x CPU overhead. |
| Output is human-readable. | 2-3x memory overhead. |
| Integrates with `go test`. | Cannot detect a race that does not happen in the run. |
| Almost zero false positives. | Has a cap on tracked goroutines (~8128). |
| Works on Linux, macOS, Windows, FreeBSD. | Not for production. |
| Required for serious Go work. | Some code paths under `-race` panic where they would silently corrupt without it. |

---

## Use Cases

- **Local development.** Run all unit tests with `-race` while iterating.
- **CI pipelines.** A required CI stage runs the full test suite with `-race`.
- **Pre-merge gate.** Pull requests cannot land until `go test -race ./...` passes.
- **Stress testing.** Combine `-race` with `-count=N` and a stress test that hammers shared state for thousands of iterations.
- **Reproducing flaky tests.** Many flaky concurrency tests are races; run them under `-race` with `-count=100`.

---

## Code Examples

### Example 1: detecting the counter race

```go
// main.go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var counter int
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter++
        }()
    }
    wg.Wait()
    fmt.Println(counter)
}
```

```bash
$ go run -race main.go
==================
WARNING: DATA RACE
Read at 0x... by goroutine 7:
  main.main.func1()
      main.go:13 +0x...
Previous write at 0x... by goroutine 6:
  main.main.func1()
      main.go:13 +0x...
...
==================
```

### Example 2: fix with mutex

```go
var (
    counter int
    mu      sync.Mutex
)

func add() {
    mu.Lock()
    defer mu.Unlock()
    counter++
}
```

### Example 3: fix with atomic

```go
import "sync/atomic"

var counter int64

func add() {
    atomic.AddInt64(&counter, 1)
}
```

### Example 4: captured loop variable race

```go
for i := 0; i < 5; i++ {
    i := i // shadow
    go func() {
        fmt.Println(i)
    }()
}
```

### Example 5: shared map race detection

```go
m := map[string]int{}
go func() { m["a"] = 1 }()
go func() { _ = m["a"] }()

// Run with -race: reports a race.
// Run without: may panic with "concurrent map read and map write".
```

Fix:

```go
var (
    mu sync.RWMutex
    m  = map[string]int{}
)

func get(k string) int {
    mu.RLock()
    defer mu.RUnlock()
    return m[k]
}

func set(k string, v int) {
    mu.Lock()
    defer mu.Unlock()
    m[k] = v
}
```

### Example 6: a test that requires `-race`

```go
func TestCounter(t *testing.T) {
    var c int
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); c++ }()
    }
    wg.Wait()
    if c != 100 {
        t.Fatalf("c = %d, want 100", c)
    }
}
```

This test will sometimes pass and sometimes fail without `-race`. Run with `-race -count=100` and it fails almost every time, with a clear report.

---

## Coding Patterns

### Pattern: every test runs with -race in CI
A standard CI step: `go test -race ./...`. No exceptions.

### Pattern: stress harness
For concurrency-heavy code, run tests with `-count=100` and `-race` to multiply the chances of catching infrequent races.

### Pattern: prefer channels for communication, mutex for state
Channels create happens-before naturally. If you need shared mutable state (counters, caches), reach for a mutex or atomic.

### Pattern: `defer mu.Unlock()`
Always pair `Lock` with a deferred `Unlock` to make exits race-free even on panic.

### Pattern: shadow loop variables in pre-1.22 code
`i := i` in any loop where the iteration variable is captured by a goroutine.

---

## Clean Code

- Keep critical sections small. The smaller the locked region, the less contention and the easier it is to reason about.
- Use one mutex per small struct, not one global mutex per package.
- Document the locking discipline in a comment near the struct: "Both `count` and `last` are guarded by `mu`."
- Prefer `RWMutex` only when measurements show contention on `Mutex`.
- Avoid copying structs that contain mutexes — `go vet` will flag this.

---

## Product Use / Feature

In every production Go service, the CI pipeline must run the full test suite under `-race`. A failure is a hard block. Many companies also run a nightly job with `-race -count=200` on a known-flaky package to surface long-tail races.

A junior engineer's contribution is usually:
- Make sure new code does not introduce shared mutable state without protection.
- Run `go test -race` locally before pushing.
- When `-race` reports a race in a teammate's code, post the report on the PR with a fix proposal.

---

## Error Handling

The race detector does not throw errors; it prints reports to stderr. Two configurable behaviours:

- `GORACE="halt_on_error=1"` — stop the process on first race. Useful in scripts.
- `GORACE="exitcode=66"` — make the binary exit non-zero when a race is detected. Useful in CI.

Combine them with the standard `go test -race` for fail-fast behaviour:

```bash
GORACE="halt_on_error=1 exitcode=66" go test -race ./...
```

---

## Security Considerations

A data race in production is a security risk:
- Memory corruption can lead to type confusion or out-of-bounds access.
- Sensitive data may be partially overwritten; a request to user A may briefly see fragments of user B's data.
- Race-induced map corruption can cause crashes (a DoS vector).

Always remove or fix any race the detector finds. "It only happens 1% of the time" means it happens to 1% of your users.

---

## Performance Tips

- Do not run `-race` in production. The 5-10x slowdown is unacceptable.
- For benchmarks, run both with and without `-race`. Some optimisations only show up without race instrumentation.
- A race-free build is also a faster build — adding correct synchronisation is rarely a performance cost worth worrying about for typical web/service code.

---

## Best Practices

1. Always `go test -race ./...` before pushing.
2. CI must include a `-race` stage.
3. Use channels first; mutex when state is unavoidable.
4. Keep critical sections short.
5. Always `defer mu.Unlock()`.
6. Run flaky tests under `-race -count=100` to find races.
7. Remove dead races even if the answer "looks right" — `-race` warnings are not optional.

---

## Edge Cases & Pitfalls

- **Goroutine cap.** The detector tracks up to ~8128 goroutines. Above that, results are unreliable.
- **Unaligned 64-bit fields on 32-bit platforms.** `atomic` operations require 8-byte alignment; misaligned fields panic. Use `atomic.Int64` (Go 1.19+) which avoids this.
- **Sleep "synchronisation".** `time.Sleep` does not create a happens-before edge. A race that hides behind `Sleep(1*time.Millisecond)` is still a race.
- **printf debugging masks races.** `fmt.Println` involves a mutex on stdout; adding it can hide the race. Always rely on `-race`.
- **Cgo.** Race detection skips memory accesses inside C code; pure-Go is fully covered.

---

## Common Mistakes

1. Believing "the test passed once, so it's safe."
2. Using `time.Sleep` to hide a race.
3. Using `volatile`-style tricks (Go has no `volatile`).
4. Ignoring a race report because "it's only triggered once in 100 runs."
5. Wrapping each statement individually in Lock/Unlock instead of grouping into a critical section.
6. Forgetting `defer mu.Unlock()` and leaking a lock on panic.
7. Using `RWMutex` everywhere — it has more overhead than `Mutex` for unevenly mixed read/write workloads.

---

## Common Misconceptions

- "If two goroutines never run at the same time, there is no race." Wrong — the memory model is about ordering, not wall-clock simultaneity. Without synchronisation, the compiler and CPU can reorder writes.
- "Reading a variable is always safe." Wrong if any goroutine writes to it concurrently.
- "I tested it 1000 times; if there were a race, I would have seen it." Wrong; some races appear once a month.
- "Atomic int64 makes everything thread-safe." Wrong — atomic operations on different fields are not atomic together.
- "The race detector slows down production code." It does not, because you do not ship `-race` builds.

---

## Tricky Points

- **`for ; ; <-time.After(...)` is not synchronisation.** It establishes wall-clock delay, not happens-before.
- **Goroutine start is synchronised.** Code before `go f()` happens-before `f` runs. So passing a value into the goroutine's closure is safe even though it looks like a write-then-read.
- **Channel send happens-before receive completes — not the reverse.** The receiver does not "synchronise back" to the sender.
- **Closing a channel is a synchronisation event.** Receivers see the close after every send happens-before it.
- **Atomic loads do not necessarily see atomic stores.** They do, in the Go memory model, but only because Go atomics provide sequential consistency.

---

## Test

```go
package main

import (
    "sync"
    "sync/atomic"
    "testing"
)

func TestAtomicCounter(t *testing.T) {
    var c int64
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            atomic.AddInt64(&c, 1)
        }()
    }
    wg.Wait()
    if c != 1000 {
        t.Fatalf("got %d, want 1000", c)
    }
}
```

Run: `go test -race ./...`. Should pass cleanly.

---

## Tricky Questions

1. **What is the difference between a data race and a race condition?** A data race is a memory-level bug (concurrent unsynchronised access). A race condition is a logic-level bug (outcome depends on timing). You can have one without the other.
2. **Why does `time.Sleep` not fix a race?** It is not a happens-before edge.
3. **Why is `printf` debugging unreliable for races?** It adds a mutex that may hide the race.
4. **Why is `-race` not used in production?** 5-10x slowdown and 2-3x memory overhead.
5. **What happens-before edges does Go provide?** Channel send/receive, channel close, mutex lock/unlock, sync.Once, WaitGroup, atomic, goroutine start/end.
6. **Can `-race` produce false positives?** Almost never.
7. **Why is `sync.Map` sometimes used instead of `map+Mutex`?** When read patterns dominate and entries are mostly write-once, sync.Map can be faster.
8. **What is the maximum number of goroutines `-race` tracks?** Around 8128.

---

## Cheat Sheet

```bash
# Run with race detection
go run -race ./cmd/app
go test -race ./...
go build -race -o app ./cmd/app

# Make CI fail on race
GORACE="halt_on_error=1 exitcode=66" go test -race ./...
```

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Counter wrong | Unsynchronised increment | `atomic.AddInt64` or `Mutex` |
| Map panic | Concurrent map read/write | `sync.RWMutex` or `sync.Map` |
| Loop var same value | Captured loop variable | Shadow `i := i` |
| Random crash | Pointer race | Mutex around the access |

---

## Self-Assessment Checklist

- [ ] I can define a data race precisely.
- [ ] I can run `go test -race`.
- [ ] I can read a race report and identify the line.
- [ ] I can fix a counter race with mutex or atomic.
- [ ] I can fix a captured-loop-variable race.
- [ ] I can name three happens-before edges in Go.
- [ ] I know not to ship `-race` builds to production.

---

## Summary

A data race is concurrent memory access without a happens-before edge. Go's race detector, enabled with `-race`, instruments memory accesses and prints a report when it sees one. Fixes use channels, mutexes, or atomic operations. Always run `-race` in development and CI; never in production. Mastery of race detection is the first step to writing safe concurrent Go.

---

## What You Can Build

- A safe counter library that exposes Add and Get under a mutex, tested with `-race`.
- A toy bank-balance simulator with deposits and withdrawals across goroutines, fixing each race the detector finds.
- A concurrent cache (`map+RWMutex`) and a benchmark comparing it to `sync.Map`.

---

## Further Reading

- The Go Memory Model: https://go.dev/ref/mem
- The Go Blog: "Introducing the Go Race Detector".
- ThreadSanitizer paper (Google).

---

## Related Topics

- Mutexes and `sync.RWMutex`.
- `sync/atomic`.
- `sync.Map`.
- The Go Memory Model (specification.md).
- Race detector internals (senior.md, professional.md).

---

## Diagrams & Visual Aids

```
Race scenario:

  goroutine A          goroutine B
  ──────────           ──────────
  load counter ──┐
                 ├── overlap, no edge
  load counter ──┘
  store +1 ──┐
             │
  store +1 ──┘   ← second write loses
```

```
Synchronised:

  goroutine A           goroutine B
  ──────────            ──────────
  Lock(mu)
  load counter
  store +1
  Unlock(mu) ─────────▶ Lock(mu)
                        load counter   ← sees previous store
                        store +1
                        Unlock(mu)
```
