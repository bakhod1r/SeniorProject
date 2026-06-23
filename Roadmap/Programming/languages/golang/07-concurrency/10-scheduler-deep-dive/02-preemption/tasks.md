# Goroutine Preemption — Tasks

A graded set of hands-on exercises. Each task has a goal, hints, a starter, and notes on what success looks like.

---

## Task 1 — Observe the pre-1.14 hang (junior)

**Goal.** Reproduce the classic tight-loop hang on a modern Go using `GODEBUG=asyncpreemptoff=1`.

**Starter.**
```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    runtime.GOMAXPROCS(1)
    go func() {
        for {
        }
    }()
    fmt.Println("if you see this, async preemption fired")
}
```

**Run.**
```
go run main.go
GODEBUG=asyncpreemptoff=1 go run main.go
```

**Expected.**
- First run: prints the message.
- Second run: hangs forever (ctrl-C to exit).

**Success criterion.** You can articulate why the second run hangs.

---

## Task 2 — Measure async preemption latency (junior)

**Goal.** Measure how quickly the main goroutine is given the CPU when a spinner is holding the only P.

**Starter.**
```go
package main

import (
    "fmt"
    "runtime"
    "sync/atomic"
    "time"
)

func main() {
    runtime.GOMAXPROCS(1)
    var spinning uint64

    go func() {
        for {
            atomic.AddUint64(&spinning, 1)
        }
    }()

    time.Sleep(100 * time.Millisecond) // let spinner pin the P

    samples := 30
    var maxWait time.Duration
    for i := 0; i < samples; i++ {
        start := time.Now()
        runtime.Gosched()
        wait := time.Since(start)
        if wait > maxWait {
            maxWait = wait
        }
        time.Sleep(time.Millisecond)
    }

    fmt.Println("max wait:", maxWait)
}
```

**Expected.** Max wait around 10–20 ms (one sysmon tick).

**Success criterion.** You report a number and explain why.

---

## Task 3 — Build a fair "round robin" worker pool (junior-middle)

**Goal.** Spawn N CPU-bound workers; after a fixed time, report how many iterations each completed. Expect roughly equal counts.

**Starter.**
```go
package main

import (
    "fmt"
    "runtime"
    "sync/atomic"
    "time"
)

func main() {
    runtime.GOMAXPROCS(1)
    const N = 4
    counts := make([]uint64, N)

    for i := 0; i < N; i++ {
        i := i
        go func() {
            for {
                atomic.AddUint64(&counts[i], 1)
            }
        }()
    }

    time.Sleep(2 * time.Second)
    for i, c := range counts {
        fmt.Printf("worker %d: %d\n", i, atomic.LoadUint64(&c))
    }
}
```

**Expected.** All four counts within an order of magnitude of one another.

**Success criterion.** You can predict, before running, that the counts will be roughly equal — and explain why.

---

## Task 4 — Compare cooperative-only vs async (middle)

**Goal.** Run the same workload twice, once with default `GODEBUG` and once with `asyncpreemptoff=1`. Compare counts.

**Starter.** Use the program from Task 3.

**Run.**
```
go run main.go
GODEBUG=asyncpreemptoff=1 go run main.go
```

**Expected.** With async off and `GOMAXPROCS=1`, only one worker progresses (or one progresses far more than others) because the tight loops cannot be cooperatively preempted.

**Success criterion.** You can describe the difference quantitatively.

---

## Task 5 — Add a function call and watch it become fair again (middle)

**Goal.** Modify the spinner from Task 4 to call a small helper inside the loop. Observe that cooperative preemption now fires.

**Starter.**
```go
func tick() { /* nothing */ }

go func() {
    for {
        atomic.AddUint64(&counts[i], 1)
        tick() // cooperative preemption point
    }
}()
```

**Run.**
```
GODEBUG=asyncpreemptoff=1 go run main.go
```

**Expected.** With the function call, all workers progress evenly even without async preemption.

**Success criterion.** You can explain that the prologue check on `tick` is the cooperative preemption point.

---

## Task 6 — Use `runtime/trace` to visualise preemption (middle)

**Goal.** Capture a trace and identify `GoPreempt` events.

**Starter.**
```go
package main

import (
    "os"
    "runtime"
    "runtime/trace"
    "sync/atomic"
    "time"
)

func main() {
    runtime.GOMAXPROCS(1)

    f, _ := os.Create("trace.out")
    trace.Start(f)
    defer trace.Stop()

    var counts [4]uint64
    for i := 0; i < 4; i++ {
        i := i
        go func() {
            for j := 0; j < 1_000_000; j++ {
                atomic.AddUint64(&counts[i], 1)
            }
        }()
    }
    time.Sleep(500 * time.Millisecond)
}
```

**Run.**
```
go run main.go
go tool trace trace.out
```

**Expected.** Open the goroutine view. `GoPreempt` markers appear roughly every 10 ms.

**Success criterion.** You can take a screenshot, point at a `GoPreempt` marker, and read the timestamp.

---

## Task 7 — Implement explicit cancellation that beats preemption (middle)

**Goal.** Build a goroutine that responds to context cancellation in under 1 ms.

**Starter.**
```go
package main

import (
    "context"
    "fmt"
    "time"
)

func work(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }
        // simulate CPU-bound work
        for i := 0; i < 1000; i++ {
        }
    }
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    done := make(chan error)
    go func() { done <- work(ctx) }()

    time.Sleep(10 * time.Millisecond)
    start := time.Now()
    cancel()
    fmt.Println("cancel observed in:", time.Since(start), <-done)
}
```

**Expected.** Latency well under 1 ms — the `select` runs many times per ms.

**Success criterion.** You measure < 1 ms and explain why context.Done is faster than waiting for sysmon.

---

## Task 8 — Measure cgo preemption blackout (middle-senior)

**Goal.** Show that a cgo call blocks preemption.

**Starter.**
```go
package main

/*
#include <unistd.h>
*/
import "C"

import (
    "fmt"
    "runtime"
    "sync/atomic"
    "time"
)

func main() {
    runtime.GOMAXPROCS(1)
    var n uint64

    go func() {
        C.sleep(2) // 2 seconds in C
    }()

    go func() {
        for {
            atomic.AddUint64(&n, 1)
        }
    }()

    time.Sleep(2500 * time.Millisecond)
    fmt.Println("iterations:", atomic.LoadUint64(&n))
}
```

**Expected.** With `GOMAXPROCS=1` and a 2-second `C.sleep` holding the M, the spinner cannot run because no thread is available. (In some Go versions sysmon will spawn an extra M to recover; verify experimentally.)

**Success criterion.** You can describe sysmon's handoff to a new M and confirm whether your platform exercises it.

---

## Task 9 — Reproduce a GC stall from a tight loop (senior)

**Goal.** Show that with `asyncpreemptoff=1`, a tight loop delays GC mark-termination by seconds.

**Starter.**
```go
package main

import (
    "fmt"
    "runtime"
    "runtime/debug"
    "time"
)

func main() {
    runtime.GOMAXPROCS(2)
    debug.SetGCPercent(10)

    go func() {
        for {
            // tight loop, no calls
        }
    }()

    for i := 0; i < 5; i++ {
        // produce garbage
        _ = make([]byte, 10<<20)
        start := time.Now()
        runtime.GC()
        fmt.Printf("GC %d: %v\n", i, time.Since(start))
    }
}
```

**Run.**
```
go run main.go
GODEBUG=asyncpreemptoff=1 go run main.go
```

**Expected.** First run: GC completes in microseconds. Second run: GC takes seconds or never completes.

**Success criterion.** You quantify the difference.

---

## Task 10 — Inspect pcdata for unsafe points (senior)

**Goal.** Use `go tool objdump` to find a function's PCDATA markers.

**Run.**
```
go build -o app main.go
go tool objdump -s 'main.foo' app | head -100
```

Look for `PCDATA` directives between instructions.

**Expected.** You can read the dump and identify a region where `PCDATA_UnsafePoint` switches between safe and unsafe.

**Success criterion.** You can point at the dump and say "this PC range is the write barrier."

---

## Task 11 — Sysmon tick measurement (senior)

**Goal.** Enable `schedtrace` and observe sysmon's cadence.

**Run.**
```
GODEBUG=schedtrace=1 ./app 2>&1 | head -50
```

**Expected.** A line every ~1 ms showing scheduler state.

**Success criterion.** You can read the line format and explain what each field means.

---

## Task 12 — Write a preemption-aware spinlock (senior)

**Goal.** Build a spinlock that periodically yields. Compare against `sync.Mutex`.

**Starter.**
```go
package main

import (
    "runtime"
    "sync/atomic"
    "testing"
)

type SpinLock struct{ state uint32 }

func (s *SpinLock) Lock() {
    spins := 0
    for !atomic.CompareAndSwapUint32(&s.state, 0, 1) {
        spins++
        if spins%128 == 0 {
            runtime.Gosched()
        }
    }
}

func (s *SpinLock) Unlock() {
    atomic.StoreUint32(&s.state, 0)
}

// benchmark against sync.Mutex
```

**Expected.** Under low contention, the spinlock is faster. Under heavy contention with `GOMAXPROCS` < waiters, it is much slower without the `Gosched`.

**Success criterion.** You compare benchmarks and explain when each wins.

---

## Task 13 — Walk a runtime stack trace through async preemption (professional)

**Goal.** Use `delve` to break on `runtime.asyncPreempt2` and inspect the saved PC.

**Run.**
```
dlv debug ./app
(dlv) break runtime.asyncPreempt2
(dlv) continue
(dlv) bt
```

**Expected.** A stack trace showing `asyncPreempt -> asyncPreempt2 -> goschedImpl -> schedule`.

**Success criterion.** You can read the trace and identify the goroutine PC the runtime is preempting.

---

## Task 14 — Re-implement `runtime.Gosched` (professional)

**Goal.** Sketch a no-op-equivalent `Gosched` that runs `runtime.GC()` instead. Observe the cost.

**Starter.**
```go
func MyGosched() {
    runtime.GC() // heavy alternative
}
```

Compare wall-clock latency of a tight loop with `runtime.Gosched()` vs `MyGosched()`.

**Success criterion.** You can quote the cost difference (typically 100x or more) and explain it.

---

## Task 15 — Patch the runtime to log every preemption (professional)

**Goal.** Clone the Go source, add a `println` in `asyncPreempt2`, build a custom toolchain, run a small program.

**Steps.**
1. `git clone https://go.googlesource.com/go ~/go-src`
2. Edit `src/runtime/preempt.go`, add `println("ASYNC PREEMPT")` to `asyncPreempt2`.
3. `cd ~/go-src/src && ./make.bash`
4. Run a test program with the new `~/go-src/bin/go`.

**Expected.** Each preemption logs to stderr.

**Success criterion.** You can count log lines and correlate them with sysmon ticks.

---

## End of tasks
