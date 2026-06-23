# Goroutine Stack Growth — Hands-On Tasks

## Table of Contents
1. [Introduction](#introduction)
2. [Task 1 — Measure the Initial Stack Size](#task-1--measure-the-initial-stack-size)
3. [Task 2 — Observe Stack Growth Step by Step](#task-2--observe-stack-growth-step-by-step)
4. [Task 3 — Trigger a Stack Overflow](#task-3--trigger-a-stack-overflow)
5. [Task 4 — Cap the Stack with SetMaxStack](#task-4--cap-the-stack-with-setmaxstack)
6. [Task 5 — Watch Shrink in MemStats](#task-5--watch-shrink-in-memstats)
7. [Task 6 — Find morestack in pprof](#task-6--find-morestack-in-pprof)
8. [Task 7 — Convert Recursion to Iteration](#task-7--convert-recursion-to-iteration)
9. [Task 8 — Compare Stack vs Heap Allocation Cost](#task-8--compare-stack-vs-heap-allocation-cost)
10. [Task 9 — Spawn a Million Goroutines](#task-9--spawn-a-million-goroutines)
11. [Task 10 — Pre-Grow a Worker Stack](#task-10--pre-grow-a-worker-stack)
12. [Task 11 — Build a Stack-Bounded JSON Parser](#task-11--build-a-stack-bounded-json-parser)
13. [Task 12 — Diagnose a Goroutine Stack Leak](#task-12--diagnose-a-goroutine-stack-leak)

---

## Introduction

Each task is a short, runnable program plus a question to answer from its output. Times are approximate. Tasks build on each other; do them in order if possible.

Use Go 1.21 or later. Run on Linux or macOS; Windows works but some `GODEBUG` knobs print slightly different formats.

---

## Task 1 — Measure the Initial Stack Size

**Goal:** Estimate how much memory a fresh goroutine uses.

**Time:** 10 minutes.

**Code:**

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    var before, after runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&before)

    const N = 50_000
    done := make(chan struct{})
    var spawned sync.WaitGroup
    spawned.Add(N)
    for i := 0; i < N; i++ {
        go func() {
            spawned.Done()
            <-done
        }()
    }
    spawned.Wait()

    runtime.GC()
    runtime.ReadMemStats(&after)

    fmt.Printf("StackInuse before: %d KB\n", before.StackInuse/1024)
    fmt.Printf("StackInuse after:  %d KB\n", after.StackInuse/1024)
    fmt.Printf("approx per goroutine: %d bytes\n",
        (after.StackInuse-before.StackInuse)/N)

    close(done)
}
```

**Tasks:**
1. Run the program. Note the per-goroutine bytes.
2. Vary `N` (1K, 10K, 100K). Does per-goroutine bytes change?
3. Increase the goroutine's work slightly (e.g., declare `var pad [256]byte`). Re-measure.

**Expected:** Per-goroutine ~2 KB plus some overhead. With a 256-byte local, it should still fit in the initial 2 KB.

---

## Task 2 — Observe Stack Growth Step by Step

**Goal:** Watch the stack grow as recursion deepens.

**Time:** 15 minutes.

**Code:**

```go
package main

import (
    "fmt"
    "runtime"
)

func recurse(depth int) {
    var pad [128]byte
    _ = pad
    if depth%200 == 0 {
        var m runtime.MemStats
        runtime.ReadMemStats(&m)
        fmt.Printf("depth=%d StackInuse=%d KB\n", depth, m.StackInuse/1024)
    }
    if depth > 0 {
        recurse(depth - 1)
    }
}

func main() {
    recurse(2000)
}
```

**Tasks:**
1. Run the program. Observe `StackInuse` at each printout.
2. Identify the depth at which the stack first grows beyond 2 KB.
3. Compute the growth pattern: 2 → 4 → 8 → 16 → 32 → 64 KB.

**Expected:** Growth doubles. At depth ~10, stack is around 4 KB; by depth ~50, ~8 KB; etc.

---

## Task 3 — Trigger a Stack Overflow

**Goal:** See the `fatal error: stack overflow` message.

**Time:** 5 minutes.

**Code:**

```go
package main

func recurse() {
    recurse()
}

func main() {
    recurse()
}
```

**Tasks:**
1. Run with `go run main.go`. Capture stderr.
2. Verify the message: `runtime: goroutine stack exceeds 1000000000-byte limit`.
3. Add a `defer func() { recover() }()` in `main`. Re-run. Does it help?

**Expected:** The overflow takes several seconds to manifest (10+ growths of 2 → 4 → 8 → … → 1 GB). The recover does *not* help; stack overflow is unrecoverable.

---

## Task 4 — Cap the Stack with SetMaxStack

**Goal:** Make the overflow happen faster.

**Time:** 5 minutes.

**Code:**

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func recurse() {
    var pad [1024]byte
    _ = pad
    recurse()
}

func main() {
    debug.SetMaxStack(8 * 1024 * 1024) // 8 MB
    fmt.Println("starting...")
    recurse()
}
```

**Tasks:**
1. Run. Verify it fails fast (within a second).
2. Lower to 1 MB. Does it fail even faster?
3. Try raising to 100 MB. Compare time-to-fail.

**Expected:** Time-to-fail scales roughly with the limit because growth takes longer to reach. At 1 MB you'll fail in milliseconds.

---

## Task 5 — Watch Shrink in MemStats

**Goal:** Observe a stack shrinking during GC.

**Time:** 20 minutes.

**Code:**

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func deepWork(done chan struct{}, depth int) {
    var pad [256]byte
    _ = pad
    if depth > 0 {
        deepWork(done, depth-1)
        return
    }
    // Hold at the bottom for a while, then drain.
    <-done
}

func main() {
    done := make(chan struct{})
    go deepWork(done, 1000)

    time.Sleep(100 * time.Millisecond)

    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("during recursion: StackInuse=%d KB\n", m.StackInuse/1024)

    close(done)
    time.Sleep(100 * time.Millisecond)
    runtime.GC()
    runtime.GC() // second GC to ensure shrink

    runtime.ReadMemStats(&m)
    fmt.Printf("after GC:          StackInuse=%d KB\n", m.StackInuse/1024)
}
```

**Tasks:**
1. Run and compare StackInuse during vs after.
2. Remove the GC calls. Does StackInuse drop on its own? (Eventually yes, on a periodic GC.)
3. Try with multiple goroutines all recursing then quiescing.

**Expected:** StackInuse drops significantly after GC because the deep goroutine has returned and others may have been shrunk.

---

## Task 6 — Find morestack in pprof

**Goal:** Identify the runtime growth path in a CPU profile.

**Time:** 30 minutes.

**Code:**

```go
package main

import (
    "fmt"
    "net/http"
    _ "net/http/pprof"
)

func bigStack() {
    var pad [4096]byte
    _ = pad
    for i := 0; i < 1000; i++ {
        pad[i]++
    }
}

func main() {
    go http.ListenAndServe("localhost:6060", nil)

    fmt.Println("running. pprof at http://localhost:6060/debug/pprof/")
    for i := 0; i < 10_000_000; i++ {
        go func() {
            bigStack()
        }()
    }
    select {}
}
```

**Tasks:**
1. Start the program. From another shell:
   ```
   go tool pprof http://localhost:6060/debug/pprof/profile?seconds=5
   ```
2. In pprof, type `top` and look for `runtime.morestack_noctxt` or `runtime.newstack`.
3. Refactor `bigStack` to use `sync.Pool` for the buffer. Re-profile. Did `morestack` decrease?

**Expected:** With a 4 KB local, every fresh goroutine grows. With a `sync.Pool`, the stack stays small. Morestack visible should drop substantially.

---

## Task 7 — Convert Recursion to Iteration

**Goal:** Practice rewriting a recursive walker iteratively.

**Time:** 30 minutes.

**Recursive starter:**

```go
type Node struct {
    Value    int
    Children []*Node
}

func walkRecursive(n *Node, visit func(int)) {
    if n == nil {
        return
    }
    visit(n.Value)
    for _, c := range n.Children {
        walkRecursive(c, visit)
    }
}
```

**Task:** Rewrite `walkRecursive` as `walkIterative` using a `[]*Node` as work stack. Verify both functions produce the same DFS order on a sample tree of depth 100.

**Bonus:** Build a tree of depth 100,000 (linked list-like). Show the recursive version overflows; the iterative version succeeds.

**Sample iterative skeleton:**

```go
func walkIterative(root *Node, visit func(int)) {
    if root == nil {
        return
    }
    stack := []*Node{root}
    for len(stack) > 0 {
        n := stack[len(stack)-1]
        stack = stack[:len(stack)-1]
        visit(n.Value)
        for i := len(n.Children) - 1; i >= 0; i-- {
            stack = append(stack, n.Children[i])
        }
    }
}
```

**Expected:** The iterative version handles arbitrary depth.

---

## Task 8 — Compare Stack vs Heap Allocation Cost

**Goal:** Benchmark the cost of large stack frames.

**Time:** 30 minutes.

**Code:**

```go
package main

import "testing"

func stackBuf() {
    var buf [4096]byte
    for i := range buf {
        buf[i] = byte(i)
    }
    _ = buf
}

var pool = sync.Pool{New: func() any {
    return make([]byte, 4096)
}}

func poolBuf() {
    buf := pool.Get().([]byte)
    for i := range buf {
        buf[i] = byte(i)
    }
    pool.Put(buf)
}

func BenchmarkStackBuf(b *testing.B) {
    for i := 0; i < b.N; i++ {
        stackBuf()
    }
}

func BenchmarkPoolBuf(b *testing.B) {
    for i := 0; i < b.N; i++ {
        poolBuf()
    }
}
```

**Tasks:**
1. Run `go test -bench=.`. Compare nanoseconds per op.
2. Now wrap each call in `go`. The point: a goroutine that runs `stackBuf` once must grow its stack from 2 KB to ~4 KB.

**Expected:** `stackBuf` is faster *within* one goroutine (already grown), but `poolBuf` wins when each call is in a fresh goroutine because it avoids growth.

---

## Task 9 — Spawn a Million Goroutines

**Goal:** Confirm goroutines are cheap.

**Time:** 15 minutes.

**Code:**

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    const N = 1_000_000
    var wg sync.WaitGroup
    wg.Add(N)
    done := make(chan struct{})

    for i := 0; i < N; i++ {
        go func() {
            wg.Done()
            <-done
        }()
    }

    wg.Wait()
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("Goroutines: %d\n", runtime.NumGoroutine())
    fmt.Printf("StackInuse: %d MB\n", m.StackInuse/1024/1024)
    fmt.Printf("StackSys:   %d MB\n", m.StackSys/1024/1024)
    fmt.Printf("HeapAlloc:  %d MB\n", m.HeapAlloc/1024/1024)
    close(done)
}
```

**Tasks:**
1. Run. Confirm it works on a normal 16 GB laptop.
2. Note total memory. Compare to estimate of 1M × 2 KB = 2 GB.
3. Try 10M. Does it fit?

**Expected:** ~2-3 GB for 1M goroutines.

---

## Task 10 — Pre-Grow a Worker Stack

**Goal:** Practice eager stack growth for latency tuning.

**Time:** 20 minutes.

**Code:**

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func warmup() {
    var pad [32 * 1024]byte // force stack to ~32 KB
    _ = pad
}

func work() {
    var pad [256]byte
    _ = pad
}

func main() {
    // Worker A — cold.
    var coldDuration time.Duration
    done := make(chan struct{})
    go func() {
        defer close(done)
        start := time.Now()
        for i := 0; i < 1_000_000; i++ {
            work()
        }
        coldDuration = time.Since(start)
    }()
    <-done

    // Worker B — pre-warmed.
    var warmDuration time.Duration
    done = make(chan struct{})
    go func() {
        defer close(done)
        warmup()
        start := time.Now()
        for i := 0; i < 1_000_000; i++ {
            work()
        }
        warmDuration = time.Since(start)
    }()
    <-done

    fmt.Printf("cold: %v\nwarm: %v\n", coldDuration, warmDuration)

    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("StackInuse: %d KB\n", m.StackInuse/1024)
}
```

**Tasks:**
1. Run. Observe whether warmed worker is faster.
2. Realistically: the difference is small (a few growths total). Pre-grow is a micro-optimisation.

**Expected:** Modest difference. Useful in long-lived workers facing latency budgets.

---

## Task 11 — Build a Stack-Bounded JSON Parser

**Goal:** Write a parser that rejects deeply nested input safely.

**Time:** 60 minutes.

**Outline:**

```go
package main

import (
    "errors"
    "io"
)

const maxDepth = 100

type Parser struct {
    r     io.Reader
    buf   []byte
    pos   int
    depth int
}

func (p *Parser) parseValue() (any, error) {
    if p.depth > maxDepth {
        return nil, errors.New("nesting too deep")
    }
    p.depth++
    defer func() { p.depth-- }()

    // ... skip whitespace, dispatch on next byte ...
    // ... for '[' or '{', recurse via parseValue ...
}
```

**Task:** Implement enough of a JSON parser to handle `null`, numbers, strings, arrays, objects. Test with:
- A well-formed deeply nested input of depth 99 — should succeed.
- A well-formed deeply nested input of depth 101 — should return "nesting too deep" error.
- An attempt at depth 1,000,000 — should also return the error, not crash.

**Expected:** Your parser handles all three cases gracefully.

---

## Task 12 — Diagnose a Goroutine Stack Leak

**Goal:** Use pprof to find leaking goroutines that hold growing stacks.

**Time:** 45 minutes.

**Buggy code:**

```go
package main

import (
    "fmt"
    "net/http"
    _ "net/http/pprof"
    "runtime"
    "time"
)

func handler(w http.ResponseWriter, r *http.Request) {
    // Spawn a goroutine that "leaks" — never exits.
    go func() {
        var pad [16 * 1024]byte
        _ = pad
        select {} // block forever
    }()
    fmt.Fprintln(w, "ok")
}

func main() {
    http.HandleFunc("/", handler)
    go func() {
        for range time.Tick(time.Second) {
            var m runtime.MemStats
            runtime.ReadMemStats(&m)
            fmt.Printf("Goroutines=%d StackSys=%d KB\n",
                runtime.NumGoroutine(), m.StackSys/1024)
        }
    }()
    http.ListenAndServe(":8080", nil)
}
```

**Tasks:**
1. Start the server. From another shell:
   ```
   for i in $(seq 1 1000); do curl http://localhost:8080/; done
   ```
2. Watch `Goroutines` and `StackSys` climb.
3. Open `go tool pprof http://localhost:8080/debug/pprof/goroutine` and run `top`. Find the offender.
4. Fix: have the goroutine exit when the request context is cancelled, or use a timeout.

**Expected:** Goroutine count and stack memory grow monotonically while leaking. Pprof identifies the offending function.

---

## Wrap-up

After these tasks you should be comfortable:

- Measuring per-goroutine memory.
- Causing and observing stack growth.
- Triggering and recognising stack overflow.
- Using `SetMaxStack` as a safety knob.
- Detecting `morestack` in pprof.
- Converting recursion to iteration.
- Diagnosing real-world stack-related leaks.
