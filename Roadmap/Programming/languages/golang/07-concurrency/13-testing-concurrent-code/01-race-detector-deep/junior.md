# Race Detector Deep Dive — Junior Level

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
> Focus: "How do I know my concurrent code is correct? What does `-race` actually do? How do I read a race report?"

The race detector is a flag you pass to the Go toolchain — `-race` — that turns on a powerful runtime check. With it, the Go runtime watches every memory read and every memory write in your program. If two goroutines touch the same memory location without an explicit synchronisation step between them, the runtime prints a detailed report and (when running tests) marks the test as failed.

```bash
go test -race ./...
go run -race main.go
go build -race -o app
```

That is the entire user interface. The mechanism behind it is large — millions of lines of compiler and runtime code — but the day-to-day usage is one extra flag.

Two facts make `-race` the single most important habit to form when writing concurrent Go:

1. **Data races are usually invisible.** A program can run for years with a race in it and never crash. The race causes occasional bad data, a flaky test once a month, or — worst case — silent corruption of customer records. The detector turns invisible races into loud, reproducible failures.
2. **Race-free code is the foundation of every other concurrency property.** No matter how clever your channels or your mutexes are, if there is a data race underneath, the program's behaviour is undefined per the Go memory model. The detector is the first gate every concurrent change should pass.

After reading this file you will:

- Know what a data race is and why the Go memory model forbids it
- Be able to build, run, and test your code with `-race` enabled
- Be able to read a race report and find the two lines of code involved
- Know what `-race` does *not* catch, so you do not over-trust it
- Understand the ballpark cost (about 5–15x CPU, about 5–10x memory)
- Recognise that the race detector is a runtime tool, not a static analyser

You do not yet need to understand vector clocks, TSan internals, or the layout of shadow memory. Those come at professional level. This file is about confidently turning on the flag, reading the report, and fixing the bug.

---

## Prerequisites

- **Required:** Go 1.18 or newer (1.21+ recommended). Check with `go version`.
- **Required:** Comfort writing a function, a test, and a `main()`.
- **Required:** Knowledge of what a goroutine is (see [01-goroutines](../../01-goroutines/)) and how to start one with `go f()`.
- **Required:** Awareness that shared variables between goroutines must be synchronised — even if you do not yet know all the ways to synchronise them.
- **Helpful:** Exposure to `sync.Mutex` and `sync.WaitGroup`. The examples use them.
- **Helpful:** A 64-bit machine running Linux, macOS, or Windows. The race detector requires 64-bit and a supported architecture (amd64, arm64, ppc64le, s390x, riscv64). 32-bit platforms are not supported.

If `go version` reports 1.18+ and you can run `go test -race ./...` without an error about your platform, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Data race** | Two or more goroutines access the same memory location, at least one access is a write, and no happens-before edge exists between them. The Go memory model forbids races; their behaviour is undefined. |
| **Happens-before** | An ordering relationship between two memory operations. If A happens-before B, B is guaranteed to see the effects of A. Established by channel operations, mutex Lock/Unlock pairs, `sync.Once`, `WaitGroup`, atomics, and goroutine creation. |
| **`-race`** | The Go compiler and linker flag that enables race detection. Pass it to `go build`, `go test`, `go run`, or `go install`. |
| **ThreadSanitizer (TSan)** | The C/C++ race detector library developed at Google. Go embeds TSan as its race detector runtime. |
| **Shadow memory** | TSan's internal data structure: extra metadata for every byte of program memory, tracking which goroutine last accessed it and under what synchronisation state. |
| **Compiler instrumentation** | Extra code the Go compiler inserts at every memory access when `-race` is enabled. Each load and store calls into the TSan runtime to record the access. |
| **Race report** | The multi-line output the runtime prints when it detects a race: WARNING header, two stack traces, "Previous read/write at", and a "Goroutine" identifier. |
| **`-count=1`** | The `go test` flag that disables the test result cache. Pair with `-race` so flaky races are not hidden by a cached "PASS". |
| **Logical race** | A higher-level concurrency bug (e.g. TOCTOU, ordering issue) that may not be a data race but still produces wrong results. `-race` does not catch these. |
| **Deadlock** | All goroutines blocked waiting for each other. Not a data race; `-race` does not catch it. Detected by `go test -timeout` or the runtime's "all goroutines are asleep" panic. |
| **`GORACE`** | The environment variable that tweaks race detector behaviour: `halt_on_error`, `history_size`, `log_path`, etc. |

---

## Core Concepts

### What a data race is

A data race occurs when:

1. Two or more goroutines access the same memory location, **and**
2. At least one of those accesses is a write, **and**
3. No synchronisation edge orders them.

If all three are true, the Go memory model says the program's behaviour is undefined. That is not a soft "you might see stale data" — it means the optimiser is free to reorder, the CPU is free to reorder, and the program is no longer a Go program in any meaningful sense.

```go
var counter int
go func() { counter++ }()
go func() { counter++ }()
```

Two goroutines, both writing, no synchronisation. A textbook data race. The detector flags this every time it runs.

### What the race detector watches

Every memory access compiled with `-race`:

- Every read of a variable
- Every write to a variable
- Every read or write through a pointer
- Every slice element access, every map access, every struct field

For each access, the runtime records: "goroutine G touched address A at vector clock V, as a read/write." When a subsequent access conflicts (different goroutine, no happens-before edge, at least one write), the runtime emits a report.

### What "happens-before" looks like in Go

Operations that establish happens-before:

- A send on a channel happens-before the corresponding receive.
- The closing of a channel happens-before a receive that observes the close.
- The unlock of a `sync.Mutex` happens-before the subsequent lock by another goroutine.
- A single `sync.Once.Do` happens-before any other return from `Do` for the same `Once`.
- `wg.Wait()` returns after all `wg.Done()` calls complete; the Dones happen-before the Wait.
- Atomic operations in `sync/atomic` establish happens-before in well-defined ways.
- Goroutine creation: the `go f()` statement happens-before the start of `f`.

If two accesses do not have a chain of these relationships between them, the detector treats them as concurrent.

### How `-race` is wired into the toolchain

The flag works in four steps:

1. **Compiler.** When `-race` is set, the Go compiler inserts a call to a TSan function (`runtime.racewrite`, `runtime.raceread`, etc.) before every memory access. These calls record the access in shadow memory.
2. **Runtime.** Go links a special version of its runtime that includes the TSan library plus glue code in `runtime/race/`. Each platform has its own assembly entrypoints.
3. **Sync primitives.** `sync.Mutex.Lock`, channel operations, `sync.WaitGroup`, atomics — all are augmented to publish a happens-before edge to the TSan runtime.
4. **Reporter.** When TSan sees a conflicting pair of accesses, it walks the recent history (the "shadow stacks") for both goroutines, formats a report, and writes it to stderr.

The whole thing is invisible from the source. You write normal Go; the toolchain swaps in the instrumented version.

### What the report tells you

A typical race report has four parts:

1. **Header** — `WARNING: DATA RACE`.
2. **One access** — the goroutine that read or wrote, with a stack trace, and the file:line of the access.
3. **The other access** — the same, for the conflicting goroutine.
4. **Where the goroutines were created** — `Goroutine N (running) created at:` followed by another stack.

You can usually fix the bug by looking only at the two file:lines and asking: "what synchronises these two operations?" If the answer is "nothing," that is the bug.

### What `-race` does *not* catch

The detector is precise but limited:

- **Deadlocks.** All goroutines stuck waiting? The runtime panics with "all goroutines are asleep", not the race detector.
- **Logical race conditions.** Reading the bank balance, then writing a new one, with a mutex held only for each operation individually — that is a check-then-act bug, not a data race.
- **Races on code paths your test never exercises.** No instrumented access, no record.
- **Races on a pure single-goroutine program.** Obvious, but worth saying.
- **Performance issues** — lock contention, false sharing, scheduler thrash. Different tools.

The mantra: `-race` finds *data races on the paths you actually exercise*. Coverage of those paths is your responsibility.

---

## Real-World Analogies

### `-race` is a wiretap on memory

Imagine every variable in your program has a tiny microphone attached. The TSan runtime is a transcriber: every access is logged with a timestamp (the vector clock) and the goroutine that made it. If two goroutines mention the same variable in overlapping time windows without any handover note ("I am done with it, you can have it"), TSan reports it as a violation. The microphone slows your program down because each access is logged, but the report is invaluable.

### `-race` is a librarian counting overlapping reads of the same book

A library has one copy of a rare book. The librarian (TSan) records every person who picks it up and every time they put it down. If two people are holding the same book at the same time and at least one is writing in it, the librarian shouts. The shout is the race report. The shout does not happen for books no one touches concurrently.

### `-race` is the speed camera

Speed cameras catch you only where they are installed. The race detector catches races only on code paths you run. A speed-free highway behind your house is no proof of safe driving; it just means there is no camera. Likewise, "go test -race passed" only means "passed on the paths the tests exercised."

### Shadow memory is a parallel filing cabinet

For every drawer in the office (every byte of program memory), there is a matching drawer in a hidden room (shadow memory) with a note: "last touched by clerk 7 at 10:23, write." When clerk 12 comes to pull the file at 10:24, the shadow drawer is checked. If clerk 12 has no signed handoff slip from clerk 7, the alarm rings.

---

## Mental Models

### Model 1: "Every memory access is a function call"

When `-race` is on, an assignment like `x = 5` is no longer a single store instruction. The compiler rewrites it to roughly:

```go
runtime.racewrite(&x)
x = 5
```

This is the simplest possible mental model: every line of code that touches memory does a small bookkeeping call first. That call is fast — a handful of instructions — but multiplied across millions of accesses per second, you get the 5–15x slowdown.

### Model 2: "The detector is a memory model checker, not a thread checker"

The detector does not care about *threads*. It cares about *memory*. Two goroutines that never share memory cause zero work for TSan. Two goroutines that share memory but always do so under a mutex cause shadow updates but no reports. The detector triggers only when shared memory + missing ordering meet.

### Model 3: "Happens-before is a graph; the detector traces edges"

Think of every synchronisation operation (channel send, Mutex.Unlock, etc.) as drawing an arrow in a directed graph. When TSan sees two accesses A and B to the same address, it asks: "is there a directed path from A to B in the graph, or from B to A?" If yes, they are ordered, no race. If no, they are concurrent, race report.

### Model 4: "Coverage is the limit, not the algorithm"

The TSan algorithm itself is **sound and precise** for a given execution — it does not produce false positives, and it does not miss races on lines that ran. The limit is which lines ran. If your test never spawns the third goroutine that races with the first two, the third race is invisible. The detector is exactly as good as your test coverage.

### Model 5: "It is a sledgehammer; do not be afraid to run it"

Some engineers avoid `-race` because of the overhead. That is the wrong instinct for tests. Tests already run on a developer machine or CI server; an extra few seconds is nothing compared to shipping a race. Always test with `-race` locally and in CI. Reserve "race off" for production binaries.

---

## Pros & Cons

### Pros

- **Sound.** When TSan reports a race, there is a race. False positives are extremely rare and almost always indicate a real bug in a piece of unsafe code (often `unsafe.Pointer` games or low-level memory tricks).
- **Precise.** The report points at both offending lines and both stack traces. No guessing.
- **Built in.** No third-party install, no external service. One flag, every platform Go supports.
- **Works with `go test`, `go run`, `go build`.** Uniform across the toolchain.
- **No code changes required.** You do not annotate variables. The compiler instruments everything.
- **Catches races at any depth in the call stack.** Library code, runtime callbacks, deferred functions — all instrumented.

### Cons

- **5–15x CPU overhead.** Not suitable for production hot paths.
- **5–10x memory overhead.** Mostly shadow memory and history buffers.
- **Misses races on uncovered paths.** Pure dynamic; what you do not run, you do not check.
- **No deadlock detection.** Need a separate test timeout and runtime panic.
- **No logical-race detection.** Check-then-act and TOCTOU bugs slip through.
- **Cannot be combined with `-buildmode=plugin`.** And some other niche modes have constraints.
- **Slightly different binary.** A `-race` binary is not bit-for-bit equivalent to a non-`-race` binary. Do not ship it to production unless intentional.

---

## Use Cases

| Scenario | Why `-race` is the right tool |
|---|---|
| Every test run on a CI server | The cost is small compared to the test suite; catching one race saves a 3am incident. |
| Local development before pushing | A 30-second extra wait is cheap insurance. |
| Reproducing a flaky test | Many flakes are subtle races that only fail under `-race`'s slower scheduling. |
| Verifying a refactor that touches goroutines | The detector confirms you did not introduce unsynchronised access. |
| Stress-testing a new sync primitive | Run with `-race` plus high goroutine counts. |

| Scenario | Why `-race` is *not* the right tool |
|---|---|
| Production traffic | Overhead is too high; instead use sampled canary instances. |
| Detecting deadlocks | Use `-timeout` and goroutine dumps. |
| Catching logical races (TOCTOU) | Use code review, model checking (TLA+), and integration tests. |
| Performance profiling | Use `pprof`, `trace`. The race-instrumented binary is slow on purpose. |
| Validating distributed-system invariants | The detector sees only one process. |

---

## Code Examples

### Example 1: The classic race

```go
package main

import (
	"fmt"
	"sync"
)

var counter int

func main() {
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

Without `-race`, this often prints a number less than 1000 (the increment is not atomic). Sometimes it prints 1000 by luck. Either way, run with `-race`:

```
go run -race main.go
```

Output:

```
==================
WARNING: DATA RACE
Read at 0x00c00001a0a8 by goroutine 8:
  main.main.func1()
      /tmp/main.go:14 +0x44

Previous write at 0x00c00001a0a8 by goroutine 7:
  main.main.func1()
      /tmp/main.go:14 +0x5a

Goroutine 8 (running) created at:
  main.main()
      /tmp/main.go:12 +0xe4

Goroutine 7 (finished) created at:
  main.main()
      /tmp/main.go:12 +0xe4
==================
Found 1 data race(s)
exit status 66
```

Read the report top to bottom:

- **Header.** "WARNING: DATA RACE" — TSan caught a conflict.
- **Read at ... line 14.** The increment expression `counter++` does a read.
- **Previous write at ... line 14.** Another goroutine wrote there.
- **Both goroutines created at line 12.** That is your `go func()`.

The fix is to use a mutex or `sync/atomic`:

```go
import "sync/atomic"

var counter int64

go func() {
    defer wg.Done()
    atomic.AddInt64(&counter, 1)
}()
```

Re-run with `-race` — no warnings.

### Example 2: Race on a slice append

```go
package main

import "sync"

func main() {
	var s []int
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s = append(s, i)
		}(i)
	}
	wg.Wait()
}
```

`append` reads the slice header, possibly grows it, and writes back. Done concurrently, the writes overlap. `-race` flags both the read of the header and the writes. Fix by protecting with a mutex or by collecting into per-goroutine buffers and concatenating after `Wait()`.

### Example 3: Race on a map

```go
package main

import "sync"

func main() {
	m := map[string]int{}
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			m["key"] = i
		}(i)
	}
	wg.Wait()
}
```

Unsynchronised map writes are doubly dangerous: the runtime itself panics with "concurrent map writes" sometimes, and `-race` flags the race deterministically. Fix with `sync.Mutex` around access or use `sync.Map`.

### Example 4: A test that uses `-race`

```go
package counter

import (
	"sync"
	"testing"
)

func TestCounterRace(t *testing.T) {
	c := NewCounter()
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c.Inc()
		}()
	}
	wg.Wait()
	if got := c.Value(); got != 100 {
		t.Fatalf("got %d want 100", got)
	}
}
```

Run with:

```
go test -race -count=1 ./...
```

`-count=1` defeats the test cache so the race actually runs again on every invocation.

### Example 5: A race the detector cannot see

```go
package main

import "fmt"

var balance = 100

func transfer(amount int) {
	// Bug: read and write are not atomic, but each is done
	// with the mutex below by a future change. Without it, race.
	balance = balance - amount
}

func main() {
	go transfer(10)
	go transfer(20)
	// Without sync, race. With one Mutex around both lines, no race.
	fmt.Println(balance)
}
```

After adding a `sync.Mutex` and locking around each read and write **separately** in a banking app, the data race disappears, but a *logical* race remains: a deposit might land between a read and a write of a balance check. The detector cannot help here. You need a wider critical section that wraps the whole check-then-act.

### Example 6: Reading the channel report

```go
package main

import "fmt"

func main() {
	ch := make(chan int, 1)
	x := 0
	go func() {
		x = 42
		ch <- 1
	}()
	<-ch
	fmt.Println(x)
}
```

This is **not** a race. The send `ch <- 1` happens-before the receive `<-ch`, and within each goroutine, statements are sequenced. So `x = 42` happens-before `Println(x)`. `-race` is silent. The detector understands channel ordering.

Compare to:

```go
go func() {
	x = 42
}()
fmt.Println(x)
```

No channel, no synchronisation, race confirmed.

---

## Coding Patterns

### Pattern 1: Always pass `-race` in test commands

In your Makefile or task runner:

```makefile
test:
	go test -race -count=1 -timeout 60s ./...
```

This is the project-wide default. CI runs the same line. Local developers run the same line. There is no "race off" mode in tests.

### Pattern 2: A `-race` build tag for race-only files

Some helper files exist only for testing under `-race`. Use a build tag:

```go
//go:build race

package mylib

import "fmt"

func init() {
	fmt.Println("running with race detector enabled")
}
```

The file compiles only when `-race` is on. Use this for race-only diagnostics or assertions.

### Pattern 3: Halt-on-error in CI

By default, the race detector keeps running after reporting. In CI you usually want the test to stop the moment a race is detected, so the log is short and the report is at the bottom:

```
GORACE="halt_on_error=1" go test -race ./...
```

### Pattern 4: Bigger history for tricky races

If a report's stack trace is cut off, the history buffer was too small. Increase it:

```
GORACE="history_size=7" go test -race ./...
```

Values from 0 to 7. Each step doubles the buffer. Costs more memory.

### Pattern 5: Logging the race report somewhere

```
GORACE="log_path=/tmp/race-report" go test -race ./...
```

This appends each report to `/tmp/race-report.PID`. Handy in CI for archiving.

---

## Clean Code

- Run `-race` in CI on every PR. Make it a required check.
- Document in `CONTRIBUTING.md` that all tests must pass with `-race`.
- Do not silence race reports with `// nolint:race`. There is no such directive; that is a code smell.
- Do not gate race fixes behind feature flags. Fix them immediately.
- A test that passes only without `-race` is a broken test, not a working test.

---

## Product Use / Feature

`-race` is a developer-tool feature, not a product feature. You do not ship a race-instrumented binary to customers. But the value to the product is enormous: it is the single biggest reason concurrent Go services hold up under load. A team that runs `-race` in CI catches data corruption bugs years earlier than a team that does not.

For tooling teams: integrate `-race` into the standard test target. For platform teams: track race-build CPU usage so CI runners are sized correctly. For application teams: pair `-race` with stress tests that hammer concurrent paths with thousands of goroutines.

---

## Error Handling

Race reports are not Go errors; they are runtime output. A `go test -race` invocation exits with status 66 (the TSan convention) when a race fires. CI systems read that exit code and mark the job failed.

In code, you do not "handle" a race report — you fix the underlying bug. If you find yourself wanting to suppress one, stop and ask: is the race real (fix it) or is this a benign access (still fix it, the detector is almost never wrong).

---

## Security Considerations

A data race is a security vulnerability when it touches authentication, authorisation, billing, or capability checks. Examples:

- Token validation that races with token refresh, allowing a stale token to pass.
- Permission cache that races with permission revocation, allowing a revoked admin to keep acting.
- Rate-limit counter that races with itself, letting attackers exceed the limit.

The race detector is a security tool: catching the race in CI is cheaper than discovering it after a breach.

---

## Performance Tips

- The cost is paid per memory access, so tight inner loops bear most of the overhead.
- Reducing test count or parallelism does not avoid the cost; the instrumentation is everywhere.
- Use `-race` in CI but ship production builds without it.
- For long test suites, shard race jobs (see senior level).
- For micro-benchmarks, run without `-race` for accurate timing.

---

## Best Practices

- Always run tests with `-race` locally and in CI.
- Always include `-count=1` to defeat the test cache.
- Configure `GORACE=halt_on_error=1` in CI.
- Pair `-race` with stress tests, not just unit tests.
- Treat any race report as a release blocker.
- Never ship `-race` binaries to production.
- Keep a `race` job and a normal `test` job in CI for clarity.

---

## Edge Cases & Pitfalls

### Pitfall 1: The race fires only on busy machines

A race detector may miss a race if the test never schedules the two goroutines in an interleaving that conflicts. On a busy CI runner, the scheduler is more chaotic, and the race manifests. On a quiet developer laptop, it does not. The detector is *deterministic on the schedule it sees*, not on the schedule it might see.

### Pitfall 2: The error count is per process, not per test

If multiple races fire, you may see only the first if `halt_on_error=1`. Without halt, all races are reported, and the test framework counts each as a failure.

### Pitfall 3: `init()` races

`init()` functions also instrumented. If two packages' `init` access shared state via goroutines, you may see races at startup before any test runs.

### Pitfall 4: cgo and `-race`

Go's `-race` works with cgo on supported platforms but cannot see into C code. A C library that mutates state shared with Go will race silently from the C side.

### Pitfall 5: `unsafe.Pointer` and `reflect`

`-race` instruments these too. But code that bypasses Go's type system (e.g., reading bytes that you treat as an int) can confuse TSan and produce odd reports. Fix the unsafe code, not the report.

---

## Common Mistakes

### Mistake 1: "It passed once without `-race`, so it is fine"

Without `-race`, a data race may run silently for years. Always re-run with `-race`.

### Mistake 2: Caching test results

`go test` caches results. The second `go test -race ./...` may print PASS without re-running. Add `-count=1` to force re-execution.

### Mistake 3: Treating "races are too slow" as a reason to skip

The cost is 5–15x. A 1-second test suite becomes 15 seconds. That is cheap insurance.

### Mistake 4: Putting the fix behind a build tag

```go
//go:build race
m.Lock()
//go:build !race
// nothing
```

This is a self-defeating hack. The race exists either way. Fix it for all builds.

### Mistake 5: Misreading the report

Newcomers often look at "Goroutine 8" and "Goroutine 7" and think those are line numbers. They are goroutine IDs, internal to the detector. The line numbers are in the file path, after the colon.

### Mistake 6: Re-introducing a race after a "fix"

A common pattern: add a mutex around the write but forget to add it around the read. `-race` flags the read; you may think the mutex did not help. It did — for the write. The read is unprotected. Both must be guarded.

---

## Common Misconceptions

### "The race detector finds all concurrency bugs"

No. It finds **data races**. Deadlocks, livelocks, starvation, logical races, ordering bugs — different tools.

### "The race detector slows my program by 1000x"

No. The typical slowdown is 5–15x CPU. Anything beyond that suggests a memory hotspot or extremely small allocations being instrumented.

### "False positives are common"

No. True false positives in well-formed Go are extremely rare. If you see a report, the bug is almost certainly real.

### "The detector requires special hardware"

No. It runs on any supported 64-bit platform. No special instructions needed.

### "Atomic operations are not raced even without `-race`"

True in the runtime, but the *detector itself* understands atomics and produces happens-before edges for them. The detector is correct in the presence of atomics.

### "If a test passes once with `-race`, the code is race-free"

Only on the code paths that ran. Coverage matters.

---

## Tricky Points

- The compiler instruments accesses, **including reads**. A read-only goroutine racing with a writer is a data race.
- A `sync.Once` establishes a happens-before edge for all goroutines that observe the `Do`. The detector understands this.
- A close of a channel happens-before any receive that returns the zero value. The detector understands this.
- Reading a `nil` channel never proceeds and never races (it blocks forever).
- The detector tracks unbuffered channels and buffered channels differently in terms of which send pairs with which receive.
- Race-free does **not** mean correct. Logical races slip past.

---

## Test

### Test 1: Predict the report

```go
var x int
go func() { x = 1 }()
go func() { x = 2 }()
```

Question: how many races does `-race` report?

Answer: at least one — two writes to `x` from different goroutines with no ordering. The exact count depends on the schedule.

### Test 2: Channel ordering

```go
ch := make(chan struct{})
var x int
go func() {
	x = 7
	close(ch)
}()
<-ch
fmt.Println(x)
```

Question: race?

Answer: no. The close happens-before the receive's return; the assignment happens-before the close. Therefore the read of `x` sees `7` cleanly.

### Test 3: Mutex but not everywhere

```go
var (
	mu sync.Mutex
	x  int
)
go func() {
	mu.Lock()
	x = 1
	mu.Unlock()
}()
fmt.Println(x)
```

Question: race?

Answer: yes. The reader in `main` did not take the mutex. Symmetry rule: every access must use the same synchronisation.

### Test 4: Atomic flag, plain data

```go
var (
	ready int32
	data  int
)
go func() {
	data = 42
	atomic.StoreInt32(&ready, 1)
}()
for atomic.LoadInt32(&ready) == 0 {
}
fmt.Println(data)
```

Question: race?

Answer: no, because `atomic.Store` and `atomic.Load` establish a release/acquire pair, which establishes happens-before per Go's memory model. The detector recognises this.

### Test 5: Loop variable in Go < 1.22

```go
for i := 0; i < 5; i++ {
	go func() { fmt.Println(i) }()
}
```

Question: is this a data race?

Answer: it is **read of `i` from goroutines** plus the loop's writes to `i`. The detector flags it on Go versions before 1.22 (where `i` is shared). In Go 1.22+, each iteration gets a fresh `i`, so there is no race.

---

## Tricky Questions

1. **Why is `-race` not the default?** Because of the 5–15x slowdown. Most builds run without it; only tests turn it on.
2. **Can the race detector be wrong?** Extremely rarely. Unsafe code or platform bugs can confuse it. Almost every report is a real race.
3. **Why does `-race` need 64-bit?** Shadow memory uses a fixed mapping that fits naturally in 64-bit address space. 32-bit has insufficient virtual address room.
4. **What is the exit code on race?** 66 — TSan's convention.
5. **Does `-race` work with `go run`?** Yes: `go run -race file.go`.
6. **Does `-race` work in `go build`?** Yes: `go build -race -o app`. The binary itself runs with detection on. Use only for development binaries.
7. **Why does my map race not get caught sometimes?** Because Go's runtime sometimes panics first with "concurrent map writes" before TSan reports. Both indicate the same bug.
8. **What is `halt_on_error`?** A `GORACE` knob that exits the process on the first race instead of continuing.

---

## Cheat Sheet

```
# Run tests with race detector
go test -race -count=1 ./...

# Run a program with race detector
go run -race main.go

# Build a development binary with race detector
go build -race -o app

# Tweak runtime behaviour
GORACE="halt_on_error=1 history_size=7 log_path=/tmp/race" go test -race ./...

# Exit codes
0   no race
66  race detected
```

| Action | Race? |
|---|---|
| Two goroutines read shared int, no writer | No race. |
| One goroutine writes, another reads, no sync | Race. |
| Two writers with `sync.Mutex` around each access | No race. |
| Channel send happens-before receive | No race. |
| `sync.Once.Do` ordering all subsequent reads | No race. |
| `atomic.Load` and `atomic.Store` paired | No race (release/acquire edge). |
| Loop variable captured by goroutine, Go 1.21 | Race. |
| Loop variable captured by goroutine, Go 1.22+ | No race. |

---

## Self-Assessment Checklist

- [ ] I can explain what a data race is in one sentence.
- [ ] I can run my tests with `-race` and `-count=1`.
- [ ] I can read a race report and identify the two offending lines.
- [ ] I know that `-race` does not catch deadlocks or logical races.
- [ ] I know the rough overhead (5–15x CPU, 5–10x memory).
- [ ] I know what `GORACE=halt_on_error=1` does.
- [ ] I have at least once observed a real race that the detector caught.
- [ ] I have a CI job that runs `go test -race -count=1`.
- [ ] I do not ship race-instrumented binaries to production.

---

## Summary

The race detector is a compiler-and-runtime tool that turns Go's hardest-to-find concurrency bug — the data race — into a loud, reproducible failure. You enable it with `-race` on `go test`, `go run`, or `go build`. It costs 5–15x CPU and 5–10x memory, and it catches every data race that runs through instrumented code paths. It does not catch deadlocks (use timeouts), logical races (use design and integration tests), or races on paths your tests do not exercise (improve coverage). Read race reports calmly: each report shows two file:lines and the goroutines involved; the fix is to add a synchronisation edge between the two. Run `-race` in CI, on every PR, every time, forever.

---

## What You Can Build

After this file you can:

- Add a `make test` target that always passes `-race -count=1`.
- Configure CI (GitHub Actions, GitLab, CircleCI) to run a race job on every PR.
- Read a race report from a flaky test and diagnose the underlying bug in under five minutes.
- Write a stress test that hammers a concurrent function with hundreds of goroutines and verify race-free behaviour.
- Explain to teammates why "passed without `-race`" is not the same as "race-free."

---

## Further Reading

- The Go Blog — "Introducing the Go Race Detector" (Dmitry Vyukov, 2013).
- The Go Memory Model — `go.dev/ref/mem`.
- The TSan paper — "ThreadSanitizer: data race detection in practice" (Serebryany & Iskhodzhanov, 2009).
- Go source: `runtime/race.go`, `runtime/race/`.
- `cmd/compile/internal/race`.

---

## Related Topics

- [01-goroutines](../../01-goroutines/) — what is being scheduled and accessing memory.
- [04-mutexes](../../04-mutexes/) — primary tool for ordering memory accesses.
- [05-channels](../../05-channels/) — alternative ordering mechanism.
- [07-goroutine-lifecycle-leaks](../../07-goroutine-lifecycle-leaks/) — what to do once goroutines themselves leak.
- [02-deterministic-testing](../02-deterministic-testing/) — making concurrent tests reproducible.
- [03-waitgroup-in-tests](../03-waitgroup-in-tests/) — coordinating test goroutines.
- [12-lock-free-programming](../../12-lock-free-programming/) — atomics and the memory model in depth.

---

## Diagrams & Visual Aids

### Toolchain pipeline

```
Source code
   |
   v
[ Compile with -race ]
   |
   v
.o files with calls to runtime.racewrite / runtime.raceread
   |
   v
[ Link with race runtime ]
   |
   v
Instrumented binary
   |
   v
[ Execute ]
   |
   v
Every memory access -> TSan runtime -> shadow memory update
   |
   v
Conflict? -> report to stderr -> exit 66
```

### Anatomy of a report

```
==================
WARNING: DATA RACE          <-- header
Read at 0x... by goroutine 8:
  main.foo()                 <-- access A, file:line
      /path:42 +0x44

Previous write at 0x... by goroutine 7:
  main.foo()                 <-- access B, file:line
      /path:42 +0x5a

Goroutine 8 (running) created at:    <-- creator stack for A
  main.main()
      /path:12 +0xe4

Goroutine 7 (finished) created at:   <-- creator stack for B
  main.main()
      /path:12 +0xe4
==================
Found 1 data race(s)
exit status 66
```

### Happens-before graph (simple)

```
goroutine G1:           goroutine G2:
  x = 1                    
  ch <- 1   ----edge---->  <-ch
                           print(x)    <-- no race; G1's write happens-before G2's read
```

```
goroutine G1:           goroutine G2:
  x = 1                    print(x)    <-- race; no edge between them
```
