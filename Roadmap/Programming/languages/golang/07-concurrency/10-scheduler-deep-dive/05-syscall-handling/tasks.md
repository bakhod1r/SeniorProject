# Syscall Handling — Tasks

## Table of Contents
1. [How to Use This Page](#how-to-use-this-page)
2. [Task 1: Thread Counter](#task-1-thread-counter)
3. [Task 2: Demonstrate Netpoller vs Blocking Path](#task-2-demonstrate-netpoller-vs-blocking-path)
4. [Task 3: Build a Bounded File-I/O Pool](#task-3-build-a-bounded-file-io-pool)
5. [Task 4: Cgo Worker Pool with Pinning](#task-4-cgo-worker-pool-with-pinning)
6. [Task 5: Observe the Sysmon Handoff](#task-5-observe-the-sysmon-handoff)
7. [Task 6: Visualise with `go tool trace`](#task-6-visualise-with-go-tool-trace)
8. [Task 7: Measure Cgo Overhead](#task-7-measure-cgo-overhead)
9. [Task 8: Compare VDSO vs Real Syscall](#task-8-compare-vdso-vs-real-syscall)
10. [Task 9: Detect an M Leak](#task-9-detect-an-m-leak)
11. [Task 10: Implement a Simple Netpoller (Conceptual)](#task-10-implement-a-simple-netpoller-conceptual)
12. [Task 11: Read Go's `runtime/proc.go`](#task-11-read-gos-runtimeprocgo)
13. [Task 12: Reproduce a Pids.Max Panic in a Container](#task-12-reproduce-a-pidsmax-panic-in-a-container)
14. [Task 13: Profile Syscall-Heavy Code](#task-13-profile-syscall-heavy-code)

---

## How to Use This Page

Each task has:

- A clear goal (what you should learn).
- Starter code or instructions.
- Discussion questions.

Run on Linux when possible (most of the diagnostics tools are Linux-specific). macOS will work for most but `/proc` is Linux-only — substitute `ps -M` or `lsof`.

Time budget: each task ~30 min to 2 hours. Do them in order; later tasks build on earlier ones.

---

## Task 1: Thread Counter

**Goal**: get comfortable counting OS threads from inside a Go program.

```go
package main

import (
    "fmt"
    "os"
    "runtime"
    "strings"
    "time"
)

func threadCount() int {
    data, err := os.ReadFile("/proc/self/status")
    if err != nil {
        return -1
    }
    for _, line := range strings.Split(string(data), "\n") {
        if strings.HasPrefix(line, "Threads:") {
            var n int
            fmt.Sscanf(line, "Threads: %d", &n)
            return n
        }
    }
    return -1
}

func main() {
    fmt.Printf("GOMAXPROCS=%d, goroutines=%d, threads=%d\n",
        runtime.GOMAXPROCS(0), runtime.NumGoroutine(), threadCount())
    for i := 0; i < 5; i++ {
        time.Sleep(1 * time.Second)
        fmt.Printf("threads=%d\n", threadCount())
    }
}
```

**Run it** and confirm: ~5–8 threads at startup. They are sysmon, GC workers, the netpoller helper, plus a few parked Ms.

**Discussion**:
- Why is the count ≥ 2 even for a hello-world program?
- Why does it not equal `GOMAXPROCS`?

---

## Task 2: Demonstrate Netpoller vs Blocking Path

**Goal**: see with your own eyes that network I/O does not grow thread count, but file I/O does.

```go
package main

import (
    "fmt"
    "io"
    "net"
    "os"
    "runtime"
    "strings"
    "sync"
    "time"
)

func threadCount() int { /* as before */ return -1 }

func networkTest() {
    ln, _ := net.Listen("tcp", "127.0.0.1:0")
    defer ln.Close()
    go func() {
        for {
            c, err := ln.Accept()
            if err != nil { return }
            go func(c net.Conn) {
                defer c.Close()
                io.Copy(io.Discard, c)
            }(c)
        }
    }()
    var wg sync.WaitGroup
    for i := 0; i < 5000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c, err := net.Dial("tcp", ln.Addr().String())
            if err != nil { return }
            defer c.Close()
            time.Sleep(500 * time.Millisecond)
        }()
    }
    time.Sleep(200 * time.Millisecond)
    fmt.Printf("network: gs=%d threads=%d\n",
        runtime.NumGoroutine(), threadCount())
    wg.Wait()
}

func fileTest() {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            // open and read a small file, but slow it down
            data, _ := os.ReadFile("/etc/hostname")
            _ = data
            time.Sleep(500 * time.Millisecond)
        }()
    }
    time.Sleep(200 * time.Millisecond)
    fmt.Printf("file: gs=%d threads=%d\n",
        runtime.NumGoroutine(), threadCount())
    wg.Wait()
}

func main() {
    runtime.GOMAXPROCS(4)
    fmt.Printf("baseline: gs=%d threads=%d\n",
        runtime.NumGoroutine(), threadCount())
    networkTest()
    fmt.Printf("post-network: gs=%d threads=%d\n",
        runtime.NumGoroutine(), threadCount())
    fileTest()
    fmt.Printf("post-file: gs=%d threads=%d\n",
        runtime.NumGoroutine(), threadCount())
}

func init() { strings.HasPrefix("","") } // keep import
```

(Implement `threadCount` from Task 1.)

**Expected output (rough)**:
- baseline: threads=~6
- network (5000 connections): threads=~10–15
- file (100 reads): threads=~30–60

**Discussion**: why such a big difference for 50× fewer concurrent operations? Because file reads each held an M; network connections shared the netpoller.

---

## Task 3: Build a Bounded File-I/O Pool

**Goal**: implement and verify a semaphore-bounded I/O wrapper.

```go
type FileIO struct {
    sem chan struct{}
}

func NewFileIO(n int) *FileIO {
    return &FileIO{sem: make(chan struct{}, n)}
}

func (p *FileIO) Read(ctx context.Context, path string) ([]byte, error) {
    select {
    case p.sem <- struct{}{}:
    case <-ctx.Done():
        return nil, ctx.Err()
    }
    defer func() { <-p.sem }()
    return os.ReadFile(path)
}
```

**Verify**:

1. Spawn 1000 goroutines that all call `p.Read(ctx, somefile)` with `n=4`.
2. Track thread count throughout.
3. Confirm thread count stays low (~10 + 4) instead of climbing to ~hundreds.

**Discussion**:
- What `n` is right for your machine? Try `n=1`, `n=4`, `n=16`. Measure throughput.
- What happens if `n` is much larger than disk parallelism?

---

## Task 4: Cgo Worker Pool with Pinning

**Goal**: build a pinned worker pool for cgo and verify thread count is fixed.

You need a simple C function. Create `worker.go`:

```go
package main

/*
#include <unistd.h>
void slow_work() { usleep(50 * 1000); } // 50 ms
*/
import "C"

import (
    "context"
    "fmt"
    "os"
    "runtime"
    "strings"
    "sync"
    "time"
)

type Pool struct {
    work chan struct{ done chan struct{} }
    n    int
}

func NewPool(n int) *Pool {
    p := &Pool{work: make(chan struct{ done chan struct{} }, n*4), n: n}
    for i := 0; i < n; i++ {
        go p.worker()
    }
    return p
}

func (p *Pool) worker() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    for job := range p.work {
        C.slow_work()
        job.done <- struct{}{}
    }
}

func (p *Pool) Call(ctx context.Context) error {
    done := make(chan struct{}, 1)
    select {
    case p.work <- struct{ done chan struct{} }{done}:
    case <-ctx.Done():
        return ctx.Err()
    }
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func threadCount() int {
    data, _ := os.ReadFile("/proc/self/status")
    for _, line := range strings.Split(string(data), "\n") {
        if strings.HasPrefix(line, "Threads:") {
            var n int
            fmt.Sscanf(line, "Threads: %d", &n)
            return n
        }
    }
    return -1
}

func main() {
    runtime.GOMAXPROCS(4)
    p := NewPool(8)

    fmt.Println("Starting threads:", threadCount())

    var wg sync.WaitGroup
    for i := 0; i < 200; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            p.Call(context.Background())
        }()
    }

    go func() {
        for {
            fmt.Println("threads:", threadCount(), "goroutines:", runtime.NumGoroutine())
            time.Sleep(500 * time.Millisecond)
        }
    }()

    wg.Wait()
    time.Sleep(500 * time.Millisecond)
    fmt.Println("Done. threads:", threadCount())
}
```

Compile and run with `go run .` (cgo will be enabled automatically if `gcc` is on PATH).

**Expected**: thread count stays near `4 + 8 + sysmon + few = ~15`, no matter how many parallel `Call`s are made.

**Compare**: without the pool (200 goroutines each doing `C.slow_work()` directly). Thread count climbs to ~200.

**Discussion**:
- Why pin? Because we know each worker will keep its M busy in cgo — pinning is just confirming the runtime's bookkeeping.
- What is the bound on throughput? `n / 50 ms` = 160 calls/sec for `n=8`.

---

## Task 5: Observe the Sysmon Handoff

**Goal**: see sysmon's handoff in action via `GODEBUG=schedtrace`.

Run the file-test (Task 2) with:

```bash
GODEBUG=schedtrace=100 go run main.go
```

You will get one trace line per 100 ms. Look for:

- `threads=` rising during the file-read phase.
- `idleprocs=` fluctuating as Ps go in and out of `_Psyscall`.
- `idlethreads=` showing the M pool size.

**Discussion**:
- Why does `threads` not return to baseline immediately after the file reads finish? Because the M pool retains parked Ms.
- How long until they are killed? (Runtime keeps Ms in pool indefinitely under typical loads; killing is rare.)

---

## Task 6: Visualise with `go tool trace`

**Goal**: see a graphical trace of syscall behaviour.

Add tracing to a file-reading program:

```go
import "runtime/trace"

func main() {
    f, _ := os.Create("trace.out")
    trace.Start(f)
    defer trace.Stop()
    // ... your file-reading code ...
}
```

Run, then:

```bash
go tool trace trace.out
```

In the browser UI:
- "Goroutine analysis": see which goroutines spent time in syscall.
- "Procs": see per-P utilisation; gaps = idle.
- "Threads": M count over time.

**Discussion**:
- Identify yellow ("Syscall") regions. Are they the file reads?
- Identify green ("Sched wait") regions. Why are they short?

---

## Task 7: Measure Cgo Overhead

**Goal**: quantify the cost of a no-op cgo call.

```go
package main

/*
void noop() {}
*/
import "C"

import (
    "fmt"
    "time"
)

func main() {
    const N = 1_000_000

    // Cgo call benchmark
    start := time.Now()
    for i := 0; i < N; i++ {
        C.noop()
    }
    cgoElapsed := time.Since(start)

    // Pure Go call benchmark
    fn := func() {}
    start = time.Now()
    for i := 0; i < N; i++ {
        fn()
    }
    goElapsed := time.Since(start)

    fmt.Printf("Cgo:  %v per call (%v total)\n", cgoElapsed/N, cgoElapsed)
    fmt.Printf("Go:   %v per call (%v total)\n", goElapsed/N, goElapsed)
    fmt.Printf("Cgo overhead ratio: %.1fx\n", float64(cgoElapsed)/float64(goElapsed))
}
```

**Expected**: cgo ~80–150 ns per call; pure Go ~1 ns. Ratio ~100×.

**Discussion**:
- When is cgo overhead acceptable? When the C function does >> 1 µs of real work.
- When should you batch? Always, for tight loops.

---

## Task 8: Compare VDSO vs Real Syscall

**Goal**: compare the cost of `time.Now()` (VDSO) vs a real syscall.

```go
package main

import (
    "fmt"
    "syscall"
    "time"
)

func main() {
    const N = 1_000_000

    start := time.Now()
    for i := 0; i < N; i++ {
        _ = time.Now()
    }
    fmt.Printf("time.Now (VDSO):    %v per call\n", time.Since(start)/N)

    start = time.Now()
    for i := 0; i < N; i++ {
        syscall.Getpid()
    }
    fmt.Printf("syscall.Getpid:     %v per call\n", time.Since(start)/N)
}
```

**Expected**:
- `time.Now()`: ~20–40 ns (VDSO).
- `syscall.Getpid()`: ~50–200 ns (sometimes a real syscall, sometimes cached).

On macOS, `getpid` may be cached too. On Linux, the difference is starker.

**Discussion**: why is `time.Now()` not in your profiler's hot list even when you call it heavily?

---

## Task 9: Detect an M Leak

**Goal**: intentionally cause an M leak and observe it.

```go
package main

import (
    "fmt"
    "os"
    "runtime"
    "strings"
    "time"
)

func leak() {
    runtime.LockOSThread()
    // NO UnlockOSThread!
    select {} // block forever
}

func threadCount() int { /* as before */ return -1 }

func main() {
    fmt.Println("baseline:", threadCount())
    for i := 0; i < 5; i++ {
        go leak()
        time.Sleep(100 * time.Millisecond)
        fmt.Printf("after %d leaks: threads=%d\n", i+1, threadCount())
    }
    fmt.Println("waiting...")
    time.Sleep(5 * time.Second)
    fmt.Println("final:", threadCount())
}
```

**Expected**: thread count climbs by 1 each iteration and stays elevated. Even after waiting, the leaked Ms do not return — they are pinned by `LockOSThread` to goroutines that never return.

**Discussion**:
- How would you find this in a real codebase? Search for `LockOSThread` without nearby `defer UnlockOSThread`.
- What if the locked goroutine *does* return but did not unlock? The M is destroyed.

---

## Task 10: Implement a Simple Netpoller (Conceptual)

**Goal**: understand the netpoller by sketching a minimal version.

Write Go pseudocode for a netpoller-like structure:

```go
type Poller struct {
    epfd     int
    parked   map[uintptr]chan struct{} // fd -> wakeup channel
    parkedMu sync.Mutex
}

func New() *Poller { /* epoll_create1 */ ... }

func (p *Poller) Wait(fd uintptr, mode int) {
    p.parkedMu.Lock()
    ch := make(chan struct{}, 1)
    p.parked[fd] = ch
    p.parkedMu.Unlock()
    // register with epoll (one-shot, edge-triggered)
    syscall.EpollCtl(p.epfd, syscall.EPOLL_CTL_ADD, int(fd), &epollEvent{...})
    <-ch
}

func (p *Poller) Loop() {
    var events [128]syscall.EpollEvent
    for {
        n, _ := syscall.EpollWait(p.epfd, events[:], -1)
        for i := 0; i < n; i++ {
            fd := uintptr(events[i].Fd)
            p.parkedMu.Lock()
            ch := p.parked[fd]
            delete(p.parked, fd)
            p.parkedMu.Unlock()
            ch <- struct{}{}
        }
    }
}
```

This is conceptually what the Go runtime does, but in user-space code. Not a real implementation, but instructive.

**Discussion**:
- What does Go's runtime do differently? It uses `pollDesc` instead of channels (cheaper). It integrates with the scheduler so the wakeup directly schedules the G, not via channel send.
- Why edge-triggered? Avoids re-firing for the same readiness.

---

## Task 11: Read Go's `runtime/proc.go`

**Goal**: read the actual runtime source for `entersyscall` and `exitsyscall`.

Find the file:

```bash
go env GOROOT
# typically /usr/local/go or ~/go
# the file is at $GOROOT/src/runtime/proc.go
```

Open it and search for:

- `func reentersyscall`
- `func exitsyscall`
- `func exitsyscallfast`
- `func handoffp`
- `func sysmon`
- `func retake`

Read each carefully. Identify:

- The CAS race between `retake` and `exitsyscallfast`.
- The `m.locks++` / `m.locks--` brackets.
- The `oldp` field of `m`.

**Discussion**:
- What happens if `m.locks++` is forgotten? The runtime could preempt mid-transition, corrupting state.
- What if the CAS were not there? Sysmon and exitsyscall could both believe they "own" the P.

---

## Task 12: Reproduce a Pids.Max Panic in a Container

**Goal**: see what happens when a Go service exceeds `pids.max`.

In Docker:

```bash
docker run -it --pids-limit 100 golang:1.22 bash
```

Inside, run a program that intentionally creates many Ms:

```go
package main

import (
    "runtime"
    "sync"
)

/*
#include <unistd.h>
void slow_work() { sleep(60); }
*/
import "C"

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 200; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            runtime.LockOSThread()
            C.slow_work()
        }()
    }
    wg.Wait()
}
```

You will see:

```
runtime: program exceeds 10000-thread limit
fatal error: thread exhaustion
```

…or earlier, if `pids.max` is the binding limit.

**Discussion**:
- How would you handle this in production? Bound cgo concurrency before it hits the limit.
- Should you raise `SetMaxThreads`? Only as a stopgap; the root cause is unbounded cgo.

---

## Task 13: Profile Syscall-Heavy Code

**Goal**: use `pprof` to diagnose syscall behaviour.

Add to a program:

```go
import _ "net/http/pprof"
import "net/http"

go func() {
    log.Println(http.ListenAndServe("localhost:6060", nil))
}()
```

Run your file-heavy program. While it runs:

```bash
curl http://localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt
curl http://localhost:6060/debug/pprof/threadcreate > threadcreate.pprof
go tool pprof -http=:8080 threadcreate.pprof
```

In `goroutines.txt`, look for many goroutines stuck in `syscall.Read` or `runtime.entersyscall`. Each is an M held in the kernel.

In the `pprof` browser, the "Source" view shows where threads were created. Identifying which call site spawns most Ms = identifying where to add bounds.

**Discussion**:
- Why does `threadcreate` show fewer than current threads? Because it tracks creations, not current count. Some Ms are parked from earlier creations.
- How do you connect pprof output to your code? Look up the file:line for each entry; identify the user-code call that triggered the M.

---

These tasks build a working knowledge from "I read about it" to "I have seen it". Do at least 5 of them before moving on. The diagnostics skills (3, 5, 6, 9, 13) are the ones you will use most in production.
