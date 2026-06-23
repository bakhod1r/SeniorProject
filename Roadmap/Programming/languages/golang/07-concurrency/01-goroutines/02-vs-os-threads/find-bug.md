# Goroutines vs OS Threads — Find the Bug

> Bugs hide in the gap between "goroutine" and "OS thread." This file is a series of broken programs that confuse the two. For each one, find the bug, explain why it matters, and describe a fix. Difficulty rises through the file. Solutions are at the end.

---

## Easy

### Bug 1 — "But I called `LockOSThread`!"

```go
package main

import (
    "fmt"
    "runtime"
    "syscall"
)

func main() {
    runtime.LockOSThread()
    tid := syscall.Gettid()
    fmt.Println("locked to tid:", tid)

    go func() {
        // I want to do work here on the same thread!
        fmt.Println("worker tid:", syscall.Gettid())
        // ... some thread-affine work ...
    }()

    // ... more work ...
}
```

**Observation.** The worker often prints a different tid.

**Find the bug.**

---

### Bug 2 — Counting threads "the easy way"

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    // Spawn 10000 goroutines doing I/O.
    var wg sync.WaitGroup
    for i := 0; i < 10000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            // some work
        }()
    }

    threads := runtime.NumGoroutine()
    fmt.Println("thread count:", threads)
    wg.Wait()
}
```

**Observation.** `threads` is reported as ~10001, which the developer interprets as "10001 OS threads."

**Find the bug.**

---

### Bug 3 — `GOMAXPROCS=1` is "single-threaded, no need for sync"

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    runtime.GOMAXPROCS(1)

    counter := 0
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter++ // no lock — GOMAXPROCS=1, so it's safe, right?
        }()
    }
    wg.Wait()
    fmt.Println(counter)
}
```

**Observation.** `counter` is often less than 1000.

**Find the bug.**

---

### Bug 4 — Capturing the loop variable to call a C function

```go
package main

/*
#include <stdio.h>
void print_int(int x) { printf("%d\n", x); }
*/
import "C"
import "sync"

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            C.print_int(C.int(i))
        }()
    }
    wg.Wait()
}
```

**Observation.** Output on Go ≤ 1.21 is often `5 5 5 5 5` instead of `0..4`.

**Find the bug.**

---

### Bug 5 — A thread-affine library called twice

```go
package main

import (
    "fmt"
    "runtime"
)

// Imagine: this library requires the same thread for every call after init.
func initTLib()  { /* sets thread-local state */ }
func useTLib()   { /* reads thread-local state — crashes if not set */ }

func main() {
    runtime.LockOSThread()
    initTLib()
    runtime.UnlockOSThread() // we unlock too early

    useTLib() // may be on a different thread now
    fmt.Println("done")
}
```

**Observation.** Sometimes works, sometimes crashes.

**Find the bug.**

---

## Medium

### Bug 6 — A leaked OS thread

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func doThreadAffine() {
    runtime.LockOSThread()
    // do work that requires this thread...
    fmt.Println("done in pinned goroutine")
    // forgot to UnlockOSThread
}

func main() {
    for i := 0; i < 1000; i++ {
        go doThreadAffine()
    }
    time.Sleep(5 * time.Second)
}
```

**Observation.** Thread count climbs to ~1000 and stays there.

**Find the bug.**

---

### Bug 7 — `setns` from an unpinned goroutine

```go
package main

import (
    "syscall"
)

func enterNetnsAndDial(nsFD int, addr string) error {
    // Switch the namespace and dial
    if err := syscall.Setns(nsFD, syscall.CLONE_NEWNET); err != nil {
        return err
    }
    // ... dial ...
    return nil
}

func main() {
    // ... call enterNetnsAndDial concurrently from many goroutines ...
}
```

**Observation.** Sometimes the dial happens in the wrong namespace.

**Find the bug.**

---

### Bug 8 — A pool of pinned goroutines that exits and leaks Ms

```go
package main

import (
    "runtime"
    "time"
)

func worker(in <-chan int) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    for v := range in {
        // process
        _ = v
        if v < 0 {
            return // early exit — the thread will be destroyed by the runtime
        }
    }
}

func main() {
    in := make(chan int)
    for i := 0; i < 1000; i++ {
        go worker(in)
    }
    // send a few values, then close
    for i := 0; i < 10; i++ {
        in <- -1 // make 10 of the workers exit early
    }
    time.Sleep(time.Second)
    close(in)
    time.Sleep(time.Second)
}
```

**Observation.** Each worker that exits via `return` (while pinned) destroys its OS thread instead of recycling it. Total threads spawned during the program rises by 10. In a long-running version, this is a slow leak.

**Find the bug.**

---

### Bug 9 — A signal handler in a C library expecting a specific thread

```go
package main

/*
#include <signal.h>
#include <stdio.h>

// A C library that uses SIGUSR1 with thread-local handler state.
void install_handler(void) {
    // ... pthread_sigmask, sigaction with thread-local state ...
}
void use_handler(void) {
    // ... requires that signal is unmasked on THIS thread ...
}
*/
import "C"
import "sync"

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        C.install_handler() // installs handler on whichever thread this goroutine ran on
        C.use_handler()     // assumes handler is set on current thread — but goroutine may have drifted
    }()
    wg.Wait()
}
```

**Observation.** Intermittently, `use_handler` finds no handler set.

**Find the bug.**

---

### Bug 10 — Mixing `signal.Notify` with `runtime.LockOSThread`

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
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGTERM)
    // ... do work, then ...
    s := <-sigCh
    fmt.Println("received", s)
}
```

**Observation.** Works on macOS, sometimes hangs on Linux when many goroutines are running. The developer assumed pinning was needed for signal handling.

**Find the bug.**

---

## Hard

### Bug 11 — `GOMAXPROCS=64` in a 500m-CPU pod

```go
// At service startup
package main

import (
    "fmt"
    "log"
    "runtime"
)

func main() {
    log.Println("Go version:", runtime.Version())
    log.Println("GOMAXPROCS:", runtime.GOMAXPROCS(0))
    log.Println("NumCPU:", runtime.NumCPU())

    // ... run service ...
    fmt.Println("started")
}
```

Container config:
```yaml
resources:
  limits:
    cpu: 500m
```

Go version: 1.15.

**Observation.** The service has poor p99 latency. Logs show `GOMAXPROCS: 64 NumCPU: 64`. Throughput is fine, latency is awful.

**Find the bug.**

---

### Bug 12 — A subtle cgo-induced M leak

```go
package main

/*
#include <unistd.h>
void slow(void) { sleep(2); }
*/
import "C"
import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    for {
        for i := 0; i < 50; i++ {
            go C.slow()
        }
        time.Sleep(2 * time.Second)
        fmt.Println("goroutines:", runtime.NumGoroutine())
    }
}
```

**Observation.** Thread count climbs every cycle, never returns to baseline.

**Find the bug.**

---

### Bug 13 — Goroutine that "blocks" the entire program on Go 1.13

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    runtime.GOMAXPROCS(1)

    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        // tight loop, no function calls inside
        x := 0
        for x < 1_000_000_000 { x++ }
    }()

    go func() {
        defer wg.Done()
        fmt.Println("hello from second goroutine")
    }()

    wg.Wait()
}
```

**Observation.** On Go 1.13, "hello from second goroutine" never prints — the program freezes.

**Find the bug.**

---

### Bug 14 — Signal masks set in one goroutine

```go
package main

/*
#include <signal.h>
#include <pthread.h>
void mask_sigterm(void) {
    sigset_t set;
    sigemptyset(&set);
    sigaddset(&set, SIGTERM);
    pthread_sigmask(SIG_BLOCK, &set, NULL);
}
*/
import "C"
import (
    "fmt"
    "os"
    "os/signal"
    "syscall"
)

func main() {
    // Block SIGTERM via the C library — but on which thread?
    go C.mask_sigterm()

    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGTERM)

    fmt.Println("waiting for SIGTERM")
    <-sigCh
    fmt.Println("got it")
}
```

**Observation.** SIGTERM still wakes the program (or sometimes doesn't — flaky).

**Find the bug.**

---

### Bug 15 — `runtime.Gosched` "fixing" a tight loop

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    runtime.GOMAXPROCS(1)

    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        for {
            // After every iteration, yield so other goroutines run.
            runtime.Gosched()
        }
    }()
    go func() {
        defer wg.Done()
        fmt.Println("hello")
    }()
    wg.Wait()
}
```

**Observation.** Hangs forever. Even with `Gosched`.

**Find the bug.**

---

### Bug 16 — A pinned goroutine that calls a Go function that itself pins

```go
package main

import (
    "runtime"
    "syscall"
)

func enterNS(fd int) error {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    return syscall.Setns(fd, syscall.CLONE_NEWNET)
}

func makeRequest(ns int) error {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    if err := enterNS(ns); err != nil {
        return err
    }
    // ... dial, request, etc. ...
    return nil
}

func main() {
    // ...
}
```

**Observation.** Sometimes the dial happens in the wrong namespace; sometimes the program panics on `UnlockOSThread`.

**Find the bug.**

---

### Bug 17 — Misreading `runtime.NumGoroutine` after `time.Sleep`

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func work(wg *sync.WaitGroup) {
    defer wg.Done()
    time.Sleep(100 * time.Millisecond)
}

func main() {
    var wg sync.WaitGroup
    wg.Add(100)
    for i := 0; i < 100; i++ {
        go work(&wg)
    }

    // Wait for them to finish, then check.
    time.Sleep(50 * time.Millisecond)
    fmt.Println("during:", runtime.NumGoroutine()) // expected: ~101

    time.Sleep(200 * time.Millisecond)
    fmt.Println("after:", runtime.NumGoroutine())  // expected: 1
    wg.Wait()
}
```

**Observation.** Sometimes "after" prints 5–10 instead of 1.

**Find the bug.**

---

## Solutions

### Solution 1

`LockOSThread` only locks the **calling** goroutine. The spawned goroutine in `go func() {...}` is a different goroutine; it runs on its own M and is not locked. To pin both, each must call `LockOSThread` itself. Or do the work in the same goroutine without spawning.

### Solution 2

`runtime.NumGoroutine()` returns the **goroutine** count, not the thread count. The developer confused the layers. To count OS threads, read `/proc/<pid>/status:Threads` on Linux or use OS-specific APIs.

### Solution 3

`GOMAXPROCS=1` ensures only one goroutine runs Go code at a time on a single thread, but goroutines still preempt each other at safe points (since Go 1.14, at any instruction). Even within one thread, the read-modify-write of `counter++` can be interrupted between the read and write. The race detector (`go test -race`) catches this. Fix with `sync.Mutex` or `atomic.Int64`.

### Solution 4

The loop variable `i` is captured by reference in pre-1.22 Go. By the time the goroutines run, `i == 5` (or values are inconsistent). Fix: pass `i` as a parameter: `go func(i int) { ... }(i)`. Or upgrade to Go 1.22+.

### Solution 5

`UnlockOSThread` was called before `useTLib`. After unlock, the goroutine can drift. Move `UnlockOSThread` to **after** the last call that depends on thread state. Or never unlock — let the goroutine exit (and the runtime destroys the M).

### Solution 6

`defer runtime.UnlockOSThread()` is missing. When the goroutine exits without `UnlockOSThread`, the runtime *destroys* the OS thread rather than reusing it. 1000 calls = 1000 threads destroyed (but the kernel keeps them around briefly before reaping). Add `defer runtime.UnlockOSThread()` if you want the thread to be reusable.

### Solution 7

`setns` is a per-thread syscall. Calling it from an unpinned goroutine switches the namespace of whichever M happened to run the call. The next dial might happen on a different M, in a different namespace. Fix: `runtime.LockOSThread()` before `setns`, keep the lock through the dial, then unlock (or let the goroutine exit so the M is destroyed).

### Solution 8

A pinned goroutine that exits *and was the one that pinned* causes the runtime to destroy the M. The intent here is probably to "exit the worker but keep the thread for the next worker." That is not how `LockOSThread` works. Fix: do not pin if the goroutine may exit while pinned; or don't exit while pinned.

### Solution 9

The handler is installed on whichever thread `install_handler` ran on. The same goroutine, on the next iteration of the scheduler, may run on a different thread. `use_handler` then finds no handler. Fix: `runtime.LockOSThread()` for the lifetime that needs both calls to share thread state.

### Solution 10

`signal.Notify` does not need `LockOSThread`. The runtime routes signals into the Go channel regardless of which thread receives them. Pinning here is unnecessary and can cause subtle issues if the pinned thread is needed elsewhere. Remove the `LockOSThread`.

### Solution 11

Go 1.15 does not read cgroup CPU quota. `GOMAXPROCS=64` (the node CPU count). Pod is limited to 500m CPU; the scheduler creates 64 Ps competing for half a CPU, leading to massive scheduling latency. Fix: upgrade to Go 1.16+ on Linux (reads cgroup), or import `_ "go.uber.org/automaxprocs"` to set it correctly at startup.

### Solution 12

`go C.slow()` does not have a `WaitGroup` or any synchronisation. Each iteration spawns 50 goroutines that each call `C.slow`. The outer `for` keeps spawning, but the goroutines from previous iterations are still in `C.slow`. Goroutine count grows unboundedly (and thread count, because each cgo call holds an M). Fix: bound cgo concurrency with a semaphore, and use a `WaitGroup` if you want each iteration to finish before the next.

### Solution 13

Pre-Go 1.14, the scheduler could only preempt at function-call points. A tight loop `for x < N { x++ }` has no function calls inside, so the goroutine is uninterruptible. With `GOMAXPROCS=1`, the one M is stuck running that loop; the other goroutine never gets to run. Fix: upgrade to Go 1.14+ (async preemption), or insert a `runtime.Gosched()` inside the loop.

### Solution 14

`mask_sigterm` is called from a goroutine via `go`. The goroutine might run on any M. Whichever thread executes the C call gets `SIGTERM` masked. Other threads still receive it. The Go runtime's signal handler runs on those other threads and routes the signal. So `signal.Notify` still gets the signal. Fix: either pin the goroutine and mask `SIGTERM` on that thread *and* know what thread the signal will be delivered to (rare and exotic), or use `signal.Ignore` / `signal.Reset` in Go, which is process-wide.

### Solution 15

`runtime.Gosched()` only yields if **another goroutine is runnable**. In this code, the second goroutine is runnable, so `Gosched` *does* let it run — but the first goroutine resumes immediately afterwards. The actual issue: the loop runs forever (`for {}`), and even with `Gosched`, the program never terminates. The second goroutine prints "hello" but `wg.Wait()` blocks forever because the first goroutine never returns. Fix: have the first goroutine actually terminate (add an exit condition).

### Solution 16

Nested `LockOSThread` calls are counted. After `enterNS` returns, its `defer UnlockOSThread` decrements the count. Then `makeRequest` later calls `UnlockOSThread` — if the count goes negative, it's a no-op; the lock might still be in effect if there are other outstanding locks. The bigger issue: the inner `defer UnlockOSThread` may unpin the goroutine in the middle of `makeRequest`. Fix: do not pin inside `enterNS` if `makeRequest` is already pinning. Or use a counter-aware design.

### Solution 17

Background goroutines (GC mark workers, sysmon, netpoller, finalizer goroutine) are normal. "1" goroutine after main = only the main goroutine. But the runtime has several internal goroutines. `NumGoroutine` includes them. The "after" count of 5–10 reflects the runtime's own goroutines. This is not a bug — it is just the runtime. Use `goleak` for leak testing, which knows about runtime goroutines.

---

## Wrap-up

These bugs share a pattern: the developer conflated goroutine semantics (cheap, runtime-scheduled, no identity) with thread semantics (heavy, kernel-scheduled, OS-visible). The fixes are about making the distinction explicit:

- `LockOSThread` for thread-affine work — applied at the right scope.
- `runtime.NumGoroutine()` ≠ thread count.
- `GOMAXPROCS=1` does not eliminate races.
- Cgo holds an M; bound concurrency with semaphores.
- Modern Go (1.14+ for preemption, 1.16+ for cgroup) eliminates older footguns.

Next: [optimize.md](optimize.md) for optimization exercises around tuning `GOMAXPROCS`, reducing M creation, and measuring thread count efficiently in production.
