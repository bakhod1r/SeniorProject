# GOGC and GOMEMLIMIT — Tasks

Hands-on tasks. Each one is a small, runnable program plus a question. Solutions follow each section.

---

## Easy

### Task 1 — Observe `GOGC` changing GC frequency

Run the following program three times with different `GOGC` values and report the number of GC cycles.

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    var before, after runtime.MemStats
    runtime.ReadMemStats(&before)

    for i := 0; i < 1000; i++ {
        _ = make([]byte, 1<<14) // 16 KiB
    }

    runtime.ReadMemStats(&after)
    fmt.Println("GC cycles:", after.NumGC-before.NumGC)
}
```

Run as:

```sh
go run main.go
GOGC=50 go run main.go
GOGC=200 go run main.go
```

**Question.** How does the cycle count change? Why?

---

### Task 2 — Set `GOMEMLIMIT` via env vs runtime

Write two versions of a program that allocates progressively until 200 MiB is live. Version A: set `GOMEMLIMIT=150MiB` via environment. Version B: call `debug.SetMemoryLimit(150 << 20)` at startup. Confirm both versions hit the soft limit (look at `runtime.MemStats.HeapAlloc`).

**Question.** Do they behave identically? What's the operational difference?

---

### Task 3 — Read `gctrace` output

Run any Go program (e.g. `go run main.go`) with `GODEBUG=gctrace=1`. Capture the first 5 lines. For each line, identify:

- The cycle number
- Total GC CPU percentage
- Heap-at-start, heap-at-mark-end, live heap
- The next-cycle goal

**Question.** Are the goals consistent with `GOGC=100`? Compute the expected goal from the live size.

---

### Task 4 — Disable GC and observe heap growth

```go
package main

import (
    "fmt"
    "runtime"
    "runtime/debug"
    "time"
)

func main() {
    debug.SetGCPercent(-1)

    for i := 0; i < 100; i++ {
        _ = make([]byte, 1<<20) // 1 MiB
    }

    time.Sleep(100 * time.Millisecond)

    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("HeapAlloc: %d MiB\n", m.HeapAlloc>>20)
    fmt.Printf("NumGC:     %d\n", m.NumGC)
}
```

**Question.** How much memory is live? How many GC cycles ran?

---

### Task 5 — Force a GC explicitly

Write a program that allocates 100 MiB of garbage, then calls `runtime.GC()`, then reports the heap. Use `runtime.MemStats.HeapAlloc` before and after.

**Question.** What is the live heap after the explicit GC? Why is it not zero?

---

## Medium

### Task 6 — Tune for throughput

You have this program that processes 1 million records:

```go
package main

import (
    "fmt"
    "time"
)

type Record struct {
    ID   int
    Data [256]byte
}

func process(r *Record) int {
    sum := 0
    for _, b := range r.Data {
        sum += int(b)
    }
    return sum
}

func main() {
    start := time.Now()
    total := 0
    for i := 0; i < 1_000_000; i++ {
        r := &Record{ID: i}
        total += process(r)
    }
    fmt.Println("total:", total)
    fmt.Println("elapsed:", time.Since(start))
}
```

Tune `GOGC` to minimise wall-clock time. Try 100, 200, 500, 1000. Report which is fastest.

**Question.** Why does raising `GOGC` speed up this program? What is the trade-off you accepted?

---

### Task 7 — Tune for memory

A program loads a 1 GiB working set (a slice of long-lived data) and serves queries against it. Set `GOMEMLIMIT` to limit peak memory to 1.2 GiB. Confirm via `runtime.MemStats.Sys`.

Skeleton:

```go
package main

import (
    "fmt"
    "runtime"
    "runtime/debug"
)

var workingSet [][]byte

func main() {
    debug.SetMemoryLimit(1200 << 20) // 1.2 GiB
    workingSet = make([][]byte, 1024)
    for i := range workingSet {
        workingSet[i] = make([]byte, 1<<20) // 1 MiB each
    }

    // Simulate work
    for i := 0; i < 1000; i++ {
        _ = make([]byte, 1<<20)
    }

    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("Sys: %d MiB\n", m.Sys>>20)
    fmt.Printf("HeapAlloc: %d MiB\n", m.HeapAlloc>>20)
}
```

**Question.** Does `Sys` stay under 1200 MiB? What is the value of `GCCPUFraction`?

---

### Task 8 — `sync.Pool` to reduce GC pressure

Take this program and reduce GC cycles by introducing a `sync.Pool`:

```go
package main

import (
    "bytes"
    "fmt"
    "runtime"
)

func work() {
    var buf bytes.Buffer
    for i := 0; i < 1000; i++ {
        buf.WriteByte(byte(i))
    }
    _ = buf.String()
}

func main() {
    var before, after runtime.MemStats
    runtime.ReadMemStats(&before)
    for i := 0; i < 100_000; i++ {
        work()
    }
    runtime.ReadMemStats(&after)
    fmt.Println("GC cycles:", after.NumGC-before.NumGC)
}
```

**Question.** How many cycles did you save? What is the cost of pooling here?

---

### Task 9 — Inspect escape analysis

Run `go build -gcflags='-m -l'` on the following file and identify which allocations escape:

```go
package main

type Point struct{ X, Y int }

func newPoint(x, y int) *Point { return &Point{x, y} }

func makePoint(x, y int) Point { return Point{x, y} }

func main() {
    p1 := newPoint(1, 2)
    p2 := makePoint(3, 4)
    _ = p1
    _ = p2
}
```

**Question.** Why does `newPoint` escape but not `makePoint`? Can you rewrite `newPoint` to keep its result on the stack?

---

### Task 10 — Read `runtime/metrics`

Write a goroutine that prints, every 5 seconds, the values of these metrics:

- `/gc/heap/live:bytes`
- `/gc/heap/goal:bytes`
- `/cpu/classes/gc/total:cpu-seconds`
- `/gc/cycles/total:gc-cycles`

Run alongside a workload that allocates 10 MiB/s. Capture 1 minute of output.

**Question.** How does `live` track `goal`? Does GC CPU climb steadily or plateau?

---

## Hard

### Task 11 — Diagnose a death spiral

Run this program with `GOMEMLIMIT=64MiB`:

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

var keep [][]byte

func main() {
    start := time.Now()
    for i := 0; i < 1_000_000; i++ {
        keep = append(keep, make([]byte, 1024)) // 1 KiB each
        if i%10_000 == 0 {
            var m runtime.MemStats
            runtime.ReadMemStats(&m)
            fmt.Printf("i=%d heap=%dMiB cycles=%d gc%%=%.2f\n",
                i, m.HeapAlloc>>20, m.NumGC, m.GCCPUFraction*100)
        }
    }
    fmt.Println("elapsed:", time.Since(start))
}
```

**Question.** What happens to elapsed time, GC count, and `GCCPUFraction`? Why? What is the fix?

---

### Task 12 — Tune a JSON server

You have an HTTP server that decodes 10 KiB JSON requests and responds. Profile it under `GOGC=100` and `GOGC=300`. Compare:

- P50 / P99 latency
- Throughput (req/s)
- RSS

Use `wrk` or `vegeta` for load. Report which configuration wins for your workload.

**Question.** What does the tail latency tell you that the average does not?

---

### Task 13 — Replace ballast with `GOMEMLIMIT`

A legacy service uses a 1 GiB ballast:

```go
var ballast = make([]byte, 1<<30)
```

The ballast was added to convince the pre-1.19 pacer that live size was high, so it would set bigger heap goals and run GC less often. Rewrite using `GOMEMLIMIT` to achieve the same throughput without the wasted memory.

**Question.** What `GOMEMLIMIT` and `GOGC` values give equivalent behaviour? Why is the new approach better?

---

### Task 14 — Bound a service under load

Build a small HTTP server that allocates 1 MiB per request, processes for 50 ms, then returns. Configure it so that with 100 concurrent requests, RSS stays under 512 MiB. Use `GOMEMLIMIT` and request concurrency limiting.

**Question.** Which is doing the work — the runtime or your admission control? What happens if you remove either?

---

### Task 15 — Build a load-shedding middleware

Write HTTP middleware that, when GC CPU fraction (from `runtime/metrics`) exceeds 25%, returns HTTP 503 to new requests for 1 second. Test it by overloading a service with concurrent requests.

**Question.** Does the service stay responsive under overload? What is the cost (rejected requests, false positives)?

---

## Solutions

### Solution 1

`GOGC=50` produces roughly double the cycles of default `GOGC=100`. `GOGC=200` produces roughly half. The trigger is `live × (1 + GOGC/100)`; smaller percentages mean tighter triggers and more frequent GC.

### Solution 2

They behave identically once both are applied. Operational difference: env var works without code change and applies from the moment the runtime starts (catching very early allocations). The runtime call requires modifying source and applies only after the call executes.

### Solution 3

Each `gctrace` line shows the goal. For `GOGC=100`, the goal should be roughly `live × 2`. Compare the third number in `a->b->c MB` to the goal — the ratio is the live-to-goal factor.

### Solution 4

`HeapAlloc` will be around 100 MiB. `NumGC` is `0` because GC is disabled. The allocator just keeps mapping more memory from the OS.

### Solution 5

`HeapAlloc` after `runtime.GC()` is the live working set, not zero. The program's globals, stacks, and the `MemStats` struct itself still occupy memory.

### Solution 6

`GOGC=500` or `GOGC=1000` usually wins for this CPU-bound loop. Each `Record` is small but allocations add up; less frequent GC means more useful CPU. The trade-off: peak heap is larger.

### Solution 7

`Sys` should stay close to 1200 MiB. `GCCPUFraction` rises modestly as the soft limit starts pulling collections forward.

### Solution 8

A `sync.Pool` of `*bytes.Buffer` (reset on `Get`, returned on `Put`) reduces cycles substantially. Cost: pool bookkeeping and slightly more peak memory (pooled buffers across cycles).

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func work() {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)
    for i := 0; i < 1000; i++ {
        buf.WriteByte(byte(i))
    }
    _ = buf.String()
}
```

### Solution 9

`newPoint` escapes because the function returns a pointer to a stack-allocated value, which forces it to the heap. `makePoint` returns a value, so the compiler can store the result in the caller's frame. Rewriting `newPoint` to return a `Point` value (not a pointer) keeps it on the stack.

### Solution 10

`live` should approach `goal` then trigger a cycle that drops it. GC CPU rises roughly linearly with allocation rate at steady state.

### Solution 11

Elapsed time grows non-linearly because GC is running constantly trying to free memory that is genuinely live. `GCCPUFraction` climbs toward 0.50 (the cap). Fix: raise `GOMEMLIMIT`, or reduce working set, or remove the unbounded `keep`.

### Solution 12

`GOGC=300` likely wins for throughput; latency depends on whether GC pauses dominate. Tail latency reveals occasional stalls that the average smooths over.

### Solution 13

`GOMEMLIMIT` matching the desired peak (say, 1.5 GiB) with `GOGC=100` lets the runtime keep memory in check without a fake allocation. Better because no real memory is wasted on the ballast; the runtime self-tunes.

### Solution 14

`GOMEMLIMIT` plus a semaphore (`golang.org/x/sync/semaphore` or a buffered channel) is the standard combination. The runtime contains memory; the semaphore contains concurrency. Removing the semaphore lets requests pile up; removing `GOMEMLIMIT` lets memory creep upward.

### Solution 15

The middleware reads `/cpu/classes/gc/total:cpu-seconds` at two times, computes the delta, divides by elapsed CPU. If above 25%, sets an atomic flag for 1 second. Cost: false rejections during normal bursts; tune the threshold and the cooldown for your workload.
