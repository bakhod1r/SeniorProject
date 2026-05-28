# Runtime Source Dive — Find the Bug

## 1. How to use this file

Seventeen buggy Go programs whose *diagnosis* requires reading the runtime — `runtime/proc.go`, `runtime/chan.go`, `runtime/mgc.go`, `runtime/mfinal.go`, `runtime/time.go`, `runtime/panic.go`, `runtime/cgocall.go`. The fix is usually one line of user code; the explanation is "what the scheduler / GC / finalizer goroutine was doing when this misbehaved". Read each in 30-60 seconds, decide where the defect is, then expand `<details>` for the answer.

Runtime-internals bugs are loud when they crash (`fatal error: all goroutines are asleep — deadlock!`, `runtime: goroutine stack exceeds 1000000000-byte limit`) and quiet when they don't (goroutines piling up at 200/s, a finalizer that never fires, a `sync.Pool` that allocates fresh every request). Three questions on every snippet:

1. *Which runtime subsystem owns this goroutine right now — scheduler queue, channel wait list, timer heap, finalizer queue, cgo call?*
2. *If I dumped goroutines with `SIGQUIT`, what `waitReason` would I see, and is that the one I expect?*
3. *Does this code make an assumption that holds only on a specific Go version, `GOMAXPROCS` setting, or platform?*

If a snippet can't answer all three, there's a bug.

---

### Bug 1: Goroutine leak from a channel receive that never unblocks
**Difficulty:** Middle
**Skills:** channel internals, goroutine parking, `pprof`

```go
package main

import (
    "fmt"
    "net/http"
    _ "net/http/pprof"
    "runtime"
    "time"
)

func fetch(url string) <-chan string {
    ch := make(chan string)              // unbuffered
    go func() {
        // … expensive work …
        ch <- "result for " + url        // BUG: nobody guarantees a receiver
    }()
    return ch
}

func handler() {
    ch := fetch("https://example.com")
    select {
    case v := <-ch:
        fmt.Println(v)
    case <-time.After(50 * time.Millisecond):
        // timed out; we walk away
    }
}

func main() {
    go http.ListenAndServe("localhost:6060", nil)
    for i := 0; i < 10_000; i++ {
        handler()
    }
    time.Sleep(time.Second)
    fmt.Println("goroutines:", runtime.NumGoroutine())  // ~10000
}
```

**Observed behavior:** `NumGoroutine` reports ~10 000. `/debug/pprof/goroutine?debug=2` shows thousands of goroutines stuck at `chan send`.

<details><summary>Hint</summary> The producer goroutine is still alive after `handler` walks away from the timeout branch. What is it waiting for? </details>

<details><summary>Diagnosis</summary>

The producer goroutine reaches `ch <- "…"` on an unbuffered channel. In `runtime/chan.go:chansend`, with no waiting receiver it calls `gopark` with `waitReasonChanSend`, parking the goroutine on `hchan.sendq`. The consumer left via the `time.After` branch and dropped its reference to `ch`. Because the producer still holds `ch`, the channel cannot be garbage-collected — and even if it could, the parked goroutine is itself a GC root. The goroutine waits forever; `pprof` shows it under `runtime.chansend1 → runtime.gopark`.

</details>

<details><summary>Fix</summary>

```go
func fetch(ctx context.Context, url string) <-chan string {
    ch := make(chan string, 1)           // buffered: producer never blocks
    go func() {
        select {
        case ch <- "result for " + url:
        case <-ctx.Done():
        }
    }()
    return ch
}
```

Either a buffered channel sized for a single send *or* a `ctx.Done()` escape. Both encode "the producer must be able to exit even if no one is listening".

</details>

---

### Bug 2: All goroutines parked: `fatal error: all goroutines are asleep — deadlock!`
**Difficulty:** Junior
**Skills:** `runtime.checkdead`, channel deadlock detection

```go
package main

import "fmt"

func main() {
    done := make(chan struct{})
    go func() {
        <-done                           // wait for shutdown
        fmt.Println("worker exiting")
    }()

    // main also waits for the worker
    <-done                               // BUG: nobody ever closes done
}
```

**Observed behavior:**
```
fatal error: all goroutines are asleep - deadlock!
goroutine 1 [chan receive]:
main.main()
goroutine 18 [chan receive]:
main.main.func1()
```

<details><summary>Hint</summary> The runtime is not crashing because the program is wrong in the abstract — it crashes because *every* goroutine is parked and there is no event source left that could ever wake one. </details>

<details><summary>Diagnosis</summary>

`runtime/proc.go:checkdead` runs after every scheduler decision. When no goroutine is runnable and no I/O is pending (no netpoller registrations, no timers), the runtime concludes that the program cannot make progress and panics. Both goroutines here are parked on `done` with `waitReasonChanReceive`; nothing else exists; nothing can ever close `done`. The runtime correctly diagnoses a deadlock — note that this detection works *only* when truly every goroutine is stuck, which is why the same bug in a server with one live HTTP handler does not trigger it.

</details>

<details><summary>Fix</summary>

```go
func main() {
    done := make(chan struct{})
    go func() {
        defer close(done)                // worker signals when it's done
        // … work …
    }()
    <-done
}
```

Whoever owns the lifetime of `done` must close it. Here the worker owns its own exit, so it closes; main waits.

</details>

---

### Bug 3: Tight CPU loop starves other goroutines on Go 1.13 but works on 1.14+
**Difficulty:** Senior
**Skills:** async preemption, `sysmon`, Go 1.14 release notes

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    runtime.GOMAXPROCS(1)

    go func() {
        for {
            // BUG (pre-Go-1.14): no function call → no preemption point
        }
    }()

    time.Sleep(100 * time.Millisecond)
    fmt.Println("main woke up")          // never prints on go 1.13
}
```

**Observed behavior:**
- Compiled with Go 1.13: program hangs forever, no output.
- Compiled with Go 1.14+: prints `main woke up` after ~100 ms.

<details><summary>Hint</summary> What changed between Go 1.13 and Go 1.14 about how the scheduler interrupts a busy goroutine? </details>

<details><summary>Diagnosis</summary>

Before Go 1.14, goroutine preemption was *cooperative*: the compiler inserted preemption checks at function prologues, and the runtime could only switch goroutines when one of them called a function. A `for {}` loop with no calls had no preemption points; on `GOMAXPROCS=1`, that goroutine owned the P forever, and the timer goroutine that would wake `main` never got to run.

Go 1.14 introduced *asynchronous preemption* (`runtime/preempt.go`, proposal 24543): `sysmon` notices a goroutine that has been running for >10 ms and sends a signal (`SIGURG` on Unix) to its thread. The signal handler injects a preemption call into the goroutine's stack via `runtime.asyncPreempt`. The tight loop is interrupted whether it wants to be or not.

</details>

<details><summary>Fix</summary>

```go
go func() {
    for {
        runtime.Gosched()                // explicit yield works on every version
        // … or do real work whose iterations include a function call
    }
}()
```

The right *fix* is not to write a `for {}` busy-loop in the first place — but if you must, an explicit yield restores cooperative scheduling on any Go version.

</details>

---

### Bug 4: `runtime.LockOSThread` without matching `UnlockOSThread`
**Difficulty:** Senior
**Skills:** OS thread binding, M lifecycle, `runtime/proc.go:dolockOSThread`

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func callOpenGL() {
    runtime.LockOSThread()
    // … pretend we made GL calls that require this OS thread …
    // BUG: never call UnlockOSThread
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            callOpenGL()
        }()
    }
    wg.Wait()
    fmt.Println("threads stayed around:", runtime.NumGoroutine())
}
```

**Observed behavior:** The process accumulates 1000 OS threads. `ps -L` shows a thread per goroutine, none returning to the pool. On systems with a low `RLIMIT_NPROC` you eventually see `runtime: failed to create new OS thread`.

<details><summary>Hint</summary> When a goroutine that has called `LockOSThread` exits, the runtime has only one safe option for the M it was running on. What is it? </details>

<details><summary>Diagnosis</summary>

`runtime/proc.go:dolockOSThread` increments `g.lockedm` and `m.lockedg`, pinning the goroutine to its M. When such a goroutine exits *without* unlocking, `runtime.goexit0` sees that the M is still "locked" — but to a goroutine that no longer exists. The M cannot be safely returned to the scheduler's pool because the user may have configured arbitrary thread-local state (locale, signal mask, GL context). The runtime's only safe choice in `runtime.gfput`/`mexit` is to *kill* the M: the OS thread terminates. With 1000 short-lived locked goroutines, you spawn 1000 threads and destroy 1000 threads — expensive, and on platforms with thread-creation limits, fatal.

</details>

<details><summary>Fix</summary>

```go
func callOpenGL() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    // … GL calls …
}
```

`defer UnlockOSThread()` is the canonical pattern. The M returns to the pool and is reused by the scheduler. The only legitimate "lock and never unlock" case is `main` on platforms that require the main thread for UI — which is precisely why `cmd/cgo` and `gioui` lock without unlocking exactly once, at process start.

</details>

---

### Bug 5: `runtime.SetFinalizer` keeps its target alive forever (self-referential closure)
**Difficulty:** Senior
**Skills:** finalizer queue, GC reachability, `runtime/mfinal.go`

```go
package main

import (
    "fmt"
    "runtime"
)

type Resource struct {
    name string
    fd   int
}

func NewResource(name string) *Resource {
    r := &Resource{name: name, fd: 42}
    runtime.SetFinalizer(r, func(_ *Resource) {
        fmt.Println("closing", r.name)   // BUG: closure captures r itself
    })
    return r
}

func main() {
    for i := 0; i < 100; i++ {
        _ = NewResource(fmt.Sprintf("r%d", i))
    }
    runtime.GC()
    runtime.GC()
    fmt.Println("done")                  // no finalizers printed
}
```

**Observed behavior:** No `closing rN` lines ever print. The resources are never finalized; if `fd` were a real file descriptor, the process leaks all 100 of them.

<details><summary>Hint</summary> A finalizer fires only when its target becomes unreachable. What is reachable from the finalizer function's closure? </details>

<details><summary>Diagnosis</summary>

`runtime/mfinal.go:SetFinalizer` records `(obj, fn)` in the finalizer table. During GC marking, the runtime traces references from `fn`'s closure as roots — because the closure is what runs after the object becomes "almost" unreachable. Here the closure captures `r` by referring to `r.name` directly instead of using the parameter `_ *Resource`. The closure pins `r`, so `r` is never unreachable, so the finalizer never fires. The resources leak silently. The fix is to use the parameter the runtime passes in.

</details>

<details><summary>Fix</summary>

```go
runtime.SetFinalizer(r, func(victim *Resource) {
    fmt.Println("closing", victim.name)  // use the parameter, not the outer r
})
```

Equivalently: a top-level `func finalize(r *Resource)` referenced by name avoids closure capture entirely. As of Go 1.24, `runtime.AddCleanup` provides a cleaner API that makes this mistake impossible — the cleanup function receives only a chosen argument, not the object itself.

</details>

---

### Bug 6: `runtime.KeepAlive` missing — finalizer fires too early
**Difficulty:** Senior
**Skills:** escape analysis, finalizer timing, `runtime.KeepAlive`

```go
package main

import (
    "fmt"
    "runtime"
    "syscall"
)

type File struct{ fd int }

func newFile(path string) *File {
    fd, _ := syscall.Open(path, syscall.O_RDONLY, 0)
    f := &File{fd: fd}
    runtime.SetFinalizer(f, func(f *File) { syscall.Close(f.fd) })
    return f
}

func readFirstByte(f *File) byte {
    var buf [1]byte
    fd := f.fd                           // copy fd into local; f no longer used
    // BUG: between this line and the syscall, the compiler may consider f dead.
    // If GC runs here, the finalizer closes fd before we use it.
    _, _ = syscall.Read(fd, buf[:])
    return buf[0]
}

func main() {
    f := newFile("/etc/hosts")
    fmt.Printf("%c\n", readFirstByte(f))
}
```

**Observed behavior:** Most of the time prints the expected byte. Under memory pressure or with `GOGC=1`, occasionally fails with `bad file descriptor` because the finalizer ran while `syscall.Read` was in progress.

<details><summary>Hint</summary> The compiler's escape analysis decides when a pointer is "last used". The finalizer can fire as soon as that point passes — even if the integer copied out of the struct is still in use. </details>

<details><summary>Diagnosis</summary>

Go's GC tracks pointer reachability, not value reachability. Once `fd := f.fd` copies the int out, the optimizer is allowed to consider `f` dead — there are no further uses of the *pointer*. If GC runs between that line and `syscall.Read`, the finalizer fires, `syscall.Close` runs, the kernel reuses the fd number, and your `Read` operates on whatever the kernel handed to the next `open()`. This is the classic "use after finalize" race documented in `runtime.KeepAlive`'s doc comment.

</details>

<details><summary>Fix</summary>

```go
func readFirstByte(f *File) byte {
    var buf [1]byte
    _, _ = syscall.Read(f.fd, buf[:])
    runtime.KeepAlive(f)                 // f is reachable past the syscall
    return buf[0]
}
```

`runtime.KeepAlive` is a no-op at runtime — it exists purely to mark a use point for escape analysis. Place it *after* the last operation that depends on `f`'s underlying resource. The standard library's `os.File` does exactly this on every `Read`/`Write` call.

</details>

---

### Bug 7: `go:linkname` to a renamed runtime symbol
**Difficulty:** Senior
**Skills:** `//go:linkname`, runtime API stability, build failures

```go
package main

import (
    "fmt"
    _ "unsafe"                           // required for go:linkname
)

//go:linkname nanotime runtime.nanotime
func nanotime() int64                    // BUG: not the public name

func main() {
    fmt.Println("ns:", nanotime())
}
```

**Observed behavior:**
- On Go 1.20: works fine.
- On Go 1.21+: builds, but at link time fails with `relocation target runtime.nanotime not defined` (the runtime exposes `runtime.nanotime1` internally; the public-shaped name was renamed). On Go 1.23+, `cmd/link` rejects unauthorized `linkname` references entirely unless the source is on an allowlist.

<details><summary>Hint</summary> The runtime is not a public API. Names in it can be — and have been — renamed between versions without notice. </details>

<details><summary>Diagnosis</summary>

`//go:linkname` is a compiler directive that tells the linker "the local declaration here aliases this other (possibly unexported) symbol". It is the back door that lets packages like `time` and `sync` reach into runtime internals. The runtime does not maintain compatibility for symbols accessed this way. `runtime.nanotime` was renamed to `runtime.nanotime1` in commit history; user code that linked to the old name broke. Go 1.23 added an opt-in allowlist (`GODEBUG=linkname=…`) that rejects unauthorized `linkname` by default.

The lesson: anything in `runtime` (`runtime/internal/...`, unexported names, names starting with lowercase) is private. If you `linkname` to it, your build is one Go release from breaking.

</details>

<details><summary>Fix</summary>

```go
import "time"

func main() {
    fmt.Println("ns:", time.Now().UnixNano())
}
```

Use the public API. If you genuinely need monotonic nanos for benchmarking, `time.Since(start)` measures monotonic time on every platform without touching the runtime. If you need the actual `runtime.nanotime` for sub-`time.Now` precision (you almost never do), accept that you are writing platform-and-version-specific code and pin to a Go version in `go.mod`.

</details>

---

### Bug 8: Long cgo call holds the M, blocking GC
**Difficulty:** Senior
**Skills:** `runtime.cgocall`, M/P split, GC stop-the-world

```go
package main

/*
#include <unistd.h>

void slow(void) {
    sleep(30);                           // 30s C-land sleep
}
*/
import "C"

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    runtime.GOMAXPROCS(2)

    for i := 0; i < 2; i++ {
        go func() {
            C.slow()                     // BUG: blocks an M for 30 seconds each
        }()
    }

    time.Sleep(100 * time.Millisecond)
    start := time.Now()
    runtime.GC()                         // tries to STW
    fmt.Println("GC took:", time.Since(start))
}
```

**Observed behavior:** With `GOMAXPROCS=2` and two goroutines stuck in `C.slow`, `runtime.GC()` blocks for several seconds (until `sysmon` retakes the Ps from the blocked Ms). With `GODEBUG=schedtrace=1000`, you see `idleprocs=0` even though Go code is idle.

<details><summary>Hint</summary> What does the scheduler do with the P when a goroutine makes a cgo call? What does GC need from every P to make progress? </details>

<details><summary>Diagnosis</summary>

`runtime/cgocall.go:cgocall` calls `entersyscall` before crossing into C, marking the M as "in syscall" and releasing the P so another goroutine can run. So far so good. But GC's stop-the-world phase needs every M to reach a *safepoint* — and an M stuck in C code is not at a safepoint. `runtime.stopTheWorldWithSema` waits for blocked Ms; `sysmon` (`runtime.retake`) eventually steals the P, but the actual C call must still finish or the M must voluntarily return for GC's STW to complete.

For *short* cgo calls (microseconds) this is invisible. For *long* cgo calls (seconds), GC pauses balloon and the whole program stalls. The bug is calling code that blocks for seconds inside cgo without a way to interrupt it.

</details>

<details><summary>Fix</summary>

Avoid long-blocking cgo calls. If unavoidable:

```go
// Run the long C call on a dedicated OS thread, isolated from the scheduler:
runtime.LockOSThread()
defer runtime.UnlockOSThread()
C.slow()
```

Or break the C-side work into chunks that periodically return to Go (the libsodium and SQLite bindings do this). For libraries that genuinely *must* block (a blocking syscall the kernel won't return from), use an interruptible variant: `pselect` with a self-pipe, `epoll` with a timeout, or `pthread_cancel`. The general rule: every cgo call is a microscopic STW risk; treat it like a lock.

</details>

---

### Bug 9: `time.After` in a select leaks goroutines and timers
**Difficulty:** Middle
**Skills:** timer goroutine, `runtime.startTimer`, `time.NewTimer` vs `time.After`

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func worker(jobs <-chan int) {
    for {
        select {
        case j := <-jobs:
            _ = j
        case <-time.After(5 * time.Second):  // BUG: new timer every iteration
            return
        }
    }
}

func main() {
    jobs := make(chan int)
    go worker(jobs)

    for i := 0; i < 1_000_000; i++ {
        jobs <- i
    }
    fmt.Println("goroutines:", runtime.NumGoroutine())
    fmt.Println("alloc heavy?")
}
```

**Observed behavior:** Heap profile shows 1 million `runtime.NewTimer` allocations and a high count of pending timers. Memory climbs to hundreds of megabytes before any timer fires.

<details><summary>Hint</summary> What does `time.After(d)` allocate, and what happens to that allocation when the surrounding `select` picks a different case? </details>

<details><summary>Diagnosis</summary>

`time.After(d)` is sugar for `time.NewTimer(d).C` — it allocates a `*Timer` and inserts it into the runtime's timer heap (`runtime/time.go:addtimer`). When the `select` picks the `case j := <-jobs:` branch, the timer is *not* cancelled; it stays in the heap until it fires 5 s later. With one million iterations and a 5-second timeout, you can have hundreds of thousands of live timers at once. Each timer carries a goroutine waiting on its channel and bookkeeping in the 4-heap-per-P timer structure introduced in Go 1.14.

Pre-Go-1.23 this was particularly bad because timers were managed by a separate timer goroutine and global heap; Go 1.23 made the timer heap per-P, reducing contention but not the leak.

</details>

<details><summary>Fix</summary>

```go
func worker(jobs <-chan int) {
    t := time.NewTimer(5 * time.Second)
    defer t.Stop()
    for {
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(5 * time.Second)
        select {
        case j := <-jobs:
            _ = j
        case <-t.C:
            return
        }
    }
}
```

Reuse one timer; reset on each iteration; stop in defer. Go 1.23+ simplifies the drain dance (`Stop` and `Reset` are race-free now), but the pattern of "one timer per loop, not one per iteration" remains.

</details>

---

### Bug 10: `runtime.Gosched()` masking a real deadlock
**Difficulty:** Senior
**Skills:** scheduler intuition, debugging discipline

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    var mu sync.Mutex
    var v int

    mu.Lock()

    go func() {
        for {
            mu.Lock()                    // BUG: main never unlocks
            v++
            mu.Unlock()
            return
        }
    }()

    // "Workaround": give the other goroutine a chance to run
    for i := 0; i < 100; i++ {
        runtime.Gosched()                // BUG: doesn't fix anything
    }
    fmt.Println("v =", v)                // still 0
}
```

**Observed behavior:** `v` is 0. Adding more `Gosched` calls doesn't help. Wrapping in a longer `time.Sleep` doesn't help either.

<details><summary>Hint</summary> `runtime.Gosched` yields the P to other goroutines — but it doesn't release any locks the current goroutine holds. What is the other goroutine actually waiting on? </details>

<details><summary>Diagnosis</summary>

`runtime/proc.go:Gosched` puts the current G back on the run queue and picks another. The other goroutine runs, tries `mu.Lock()`, and parks on `sema.go:semacquire` with `waitReasonSemacquire`. No amount of yielding by `main` will release the mutex — only `mu.Unlock()` will. The "fix" of sprinkling `Gosched` calls is treating a deadlock as if it were a scheduling fairness problem.

The general lesson: `runtime.Gosched` is correct when the scheduler genuinely needs a hint (rare; the preemptive scheduler handles most cases). It is almost never the right fix for "this goroutine doesn't seem to run" — that almost always means it is blocked on something the current goroutine controls.

</details>

<details><summary>Fix</summary>

```go
mu.Lock()
go func() {
    mu.Lock()
    v++
    mu.Unlock()
}()
// … do work that needs the lock …
mu.Unlock()                              // release so the goroutine can proceed
```

Release the lock when you're done with the critical section. If you find yourself adding `Gosched` to "make a test pass", stop and ask which goroutine is blocked on what — `pprof`'s goroutine profile will tell you.

</details>

---

### Bug 11: `GOMAXPROCS(1)` is not a substitute for synchronization
**Difficulty:** Middle
**Skills:** memory model, race detector, scheduler points

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
    counter := 0

    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            counter++                    // BUG: still a data race
        }()
    }
    wg.Wait()
    fmt.Println("counter:", counter)     // not always 1000
}
```

**Observed behavior:** `counter` is usually less than 1000. `go run -race main.go` reports a data race regardless of `GOMAXPROCS`.

<details><summary>Hint</summary> Does `GOMAXPROCS(1)` mean "one goroutine runs at a time"? Yes. Does it mean "goroutines don't interleave"? No. </details>

<details><summary>Diagnosis</summary>

`GOMAXPROCS(1)` allows only one P, so at most one goroutine executes at any instant. But the scheduler can still *interleave* goroutines at any preemption point — channel operations, syscalls, function calls (cooperative), or async signals (Go 1.14+). `counter++` compiles to a load, an increment, and a store; the scheduler can switch goroutines between the load and the store. The Go memory model (`memmodel.md`) defines races by happens-before, not by parallelism — interleaving on a single core is enough.

The race detector instrumented by `-race` doesn't care about `GOMAXPROCS`; it instruments every memory access and tracks vector clocks per goroutine. The race exists logically, not physically.

</details>

<details><summary>Fix</summary>

```go
var counter atomic.Int64
// inside goroutine:
counter.Add(1)
```

Or a mutex. Or pass updates through a channel. The point is that synchronization is about ordering between goroutines, not about how many CPUs run them.

</details>

---

### Bug 12: Panic in a goroutine crashes the entire program
**Difficulty:** Junior
**Skills:** `runtime.fatalpanic`, recover semantics, per-goroutine recovery

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("main recovered:", r)
        }
    }()

    go func() {
        panic("worker exploded")         // BUG: main's recover doesn't catch this
    }()

    time.Sleep(time.Second)
    fmt.Println("main exiting normally")
}
```

**Observed behavior:**
```
panic: worker exploded
goroutine 18 [running]:
main.main.func2()
…
exit status 2
```

The deferred recover in `main` never runs.

<details><summary>Hint</summary> `recover` only catches panics in the *same* goroutine. The runtime treats an unrecovered panic in any goroutine as fatal for the whole program. </details>

<details><summary>Diagnosis</summary>

`runtime/panic.go:gopanic` walks the deferred calls *of the panicking goroutine* looking for one that calls `recover()`. The worker goroutine has none. When the unwind reaches the goroutine's bottom, `runtime.fatalpanic` runs — it prints the panic message, dumps all goroutines, and calls `exit(2)`. The deferred recover in `main` is on a different goroutine's stack and is never visited.

This is by design: a panic represents a broken invariant, and continuing the program after an unhandled panic in an arbitrary goroutine is unsafe. The fix is to install a recover in every goroutine that might panic — typically as a deferred call at the top of the goroutine's function.

</details>

<details><summary>Fix</summary>

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v\n%s", r, debug.Stack())
        }
    }()
    panic("worker exploded")
}()
```

A standard helper (`go safelyGo(workerFn)`) that wraps every goroutine in a panic-logging recover prevents this whole class of crash. Library code that spawns goroutines should always install one.

</details>

---

### Bug 13: `unsafe.Pointer` into a runtime struct that changed layout
**Difficulty:** Senior
**Skills:** `unsafe.Pointer`, runtime ABI instability, `go:linkname`

```go
package main

import (
    "fmt"
    "unsafe"
)

// reverse-engineered from runtime/runtime2.go on Go 1.18
type hchanLayout struct {
    qcount   uint
    dataqsiz uint
    buf      unsafe.Pointer
    elemsize uint16
    closed   uint32
    // …
}

func chanLen(ch unsafe.Pointer) uint {
    return (*hchanLayout)(ch).qcount     // BUG: layout depends on Go version
}

func main() {
    ch := make(chan int, 4)
    ch <- 1
    ch <- 2
    p := *(*unsafe.Pointer)(unsafe.Pointer(&ch))
    fmt.Println("len:", chanLen(p))      // might print 2, or garbage, or panic
}
```

**Observed behavior:**
- Go 1.18: prints `len: 2`.
- Go 1.22: prints garbage (e.g. `len: 12884901890`) because the `hchan` struct gained a `timer` field and the offsets shifted.

<details><summary>Hint</summary> Why is `len(ch)` a builtin rather than a field access? The runtime owns the struct layout and is allowed to change it. </details>

<details><summary>Diagnosis</summary>

`runtime/chan.go` defines `hchan` with no guarantee of layout stability — the struct gains and loses fields between releases (a `timer` pointer was added for `runtime.chansend`'s timeout integration in Go 1.21+). The `len` and `cap` builtins compile to runtime calls that know the current layout. User code reaching into the struct via `unsafe.Pointer` reads whatever bytes happen to live at the assumed offset on the build's Go version — and silently breaks on upgrade.

The same trap exists for `runtime.g`, `runtime.m`, `runtime.p`, `iface`, `eface`, `slice`, `string`. The header layouts in `reflect.SliceHeader`/`StringHeader` are deprecated as of Go 1.20 for exactly this reason; use `unsafe.SliceData` / `unsafe.StringData` instead.

</details>

<details><summary>Fix</summary>

```go
ch := make(chan int, 4)
ch <- 1
ch <- 2
fmt.Println("len:", len(ch))             // 2 — and works on every Go version
```

Use the language builtin. If you genuinely need to introspect runtime structures (a tracing tool, say), use `runtime/trace`, `runtime/pprof`, or the `runtime.Stack` text format — these are documented surfaces.

</details>

---

### Bug 14: `runtime.NumGoroutine()` returns more than expected
**Difficulty:** Junior
**Skills:** runtime housekeeping goroutines, `runtime.NumGoroutine`

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    fmt.Println("at start:", runtime.NumGoroutine())  // expected 1, often prints 2
}
```

**Observed behavior:** Prints `2` (or more) on every recent Go version, not the `1` users naively expect.

<details><summary>Hint</summary> `main` is one goroutine. What other goroutines does the runtime spawn before `main` runs? </details>

<details><summary>Diagnosis</summary>

`runtime.NumGoroutine()` returns `gcount` — the total number of *user-visible* goroutines, which includes runtime housekeeping. Before `main` runs, `runtime/proc.go:schedinit` and `runtime.main` start:

- the **finalizer goroutine** (`runtime/mfinal.go:createfing`, lazily spawned but often counted)
- the **scavenger goroutine** for returning memory to the OS (`runtime/mgcscavenge.go`)
- the **GC worker goroutines** during a cycle (`runtime/mgc.go:gcBgMarkWorker`)
- the **trace reader** if `runtime/trace` is enabled
- on `GODEBUG=cgocheck=2`, additional goroutines

`sysmon` does *not* count — it runs on its own M without a G. The exact baseline depends on Go version and `GOGC`/`GOMEMLIMIT` settings; treating any specific number as "the right baseline" is brittle. Use `NumGoroutine` as a *trend* signal (rising over time = leak), not an absolute count.

</details>

<details><summary>Fix</summary>

```go
base := runtime.NumGoroutine()
// … do work that spawns goroutines …
fmt.Println("extra goroutines:", runtime.NumGoroutine()-base)
```

Sample once as a baseline and report deltas. For leak detection, the `goleak` package (`go.uber.org/goleak`) handles the runtime-baseline subtraction correctly.

</details>

---

### Bug 15: `for { go work() }` exhausts memory in seconds
**Difficulty:** Junior
**Skills:** goroutine stack arithmetic, scheduler limits

```go
package main

import "time"

func work() {
    time.Sleep(time.Hour)                // never returns
}

func main() {
    for {
        go work()                        // BUG: unbounded spawn
    }
}
```

**Observed behavior:** Memory climbs linearly; after a few seconds the process is consuming gigabytes; eventually OOM-killed or `runtime: out of memory: cannot allocate ... bytes`.

<details><summary>Hint</summary> Each goroutine has a small initial stack. How small, and how many goroutines does it take to exhaust 8 GB of RAM? </details>

<details><summary>Diagnosis</summary>

`runtime/stack.go` allocates each goroutine a 2 KiB initial stack (`StackMin = 2048`). At a spawn rate of roughly 1 million goroutines per second on modern hardware, the math is brutal:

- 1 million goroutines = ~2 GB of stack memory
- plus per-G overhead (`runtime.g` struct ~256 bytes) = ~256 MB
- plus scheduler bookkeeping (run queues, allgs slice growth)

You reach 8 GB in around 3 seconds. The `for {}` loop in `main` has no preemption point on pre-1.14 Go *and* the scheduler can't free the stacks because the work goroutines are alive (parked in `time.Sleep`'s timer). The fix is bounded concurrency: a worker pool, a semaphore, or a buffered channel as a token bucket.

</details>

<details><summary>Fix</summary>

```go
sem := make(chan struct{}, 100)          // at most 100 concurrent workers
for {
    sem <- struct{}{}                    // blocks when full
    go func() {
        defer func() { <-sem }()
        work()
    }()
}
```

Or a fixed worker pool reading from a job channel. The general rule: any unbounded `for { go … }` loop is a memory bomb; cap concurrency at the spawn site.

</details>

---

### Bug 16: `sync.Pool` clears on every GC, allocation behavior surprises
**Difficulty:** Middle
**Skills:** `sync.Pool` lifetime, `runtime.mgc.go` integration

```go
package main

import (
    "bytes"
    "runtime"
    "sync"
    "testing"
)

var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func BenchmarkPool(b *testing.B) {
    for i := 0; i < b.N; i++ {
        buf := bufPool.Get().(*bytes.Buffer)
        buf.Reset()
        buf.WriteString("hello")
        bufPool.Put(buf)
        if i%1000 == 0 {
            runtime.GC()                 // BUG: drains the pool every 1000 iters
        }
    }
}
```

**Observed behavior:** Benchmark shows `~5000 B/op` and ~5 allocs/op despite the pool. Removing `runtime.GC()` drops it to `0 allocs/op` as expected.

<details><summary>Hint</summary> When does the runtime decide that pooled objects are no longer needed? Read `runtime/mgc.go:clearpools`. </details>

<details><summary>Diagnosis</summary>

`sync.Pool` is integrated with the garbage collector. `runtime/mgc.go:clearpools` runs at the start of every GC cycle and walks `sync.poolCleanup`, which empties each pool's per-P caches. The design intent is that pools should hold *transient* objects — anything you want to outlive a GC must be referenced normally. Calling `runtime.GC()` (or letting natural GC fire under memory pressure) drops everything in the pool, so the next `Get` calls `New` and allocates.

This is the most common surprise with `sync.Pool`: it caches between allocations but not across GC. Go 1.13 added the "victim cache" (objects survive one GC instead of zero) which softens the cliff, but a pool is still not a long-term cache. For long-lived caching, use a sized LRU; for hot-path allocation reuse within a request, `sync.Pool` is exactly right.

</details>

<details><summary>Fix</summary>

Either:

1. **Don't force GC**: in production code, `runtime.GC()` should appear only in shutdown sequences and very specific debugging. Letting the pool serve hot allocations between GCs is the whole point.
2. **Use a sized cache** for objects that must survive GC — e.g. `groupcache/lru`, an `atomic.Pointer[ring]`, or a bounded channel of pre-allocated buffers.

The bug here is treating `sync.Pool` as a long-term cache. It's a short-term allocation amortizer; GC is part of its contract, not a bug.

</details>

---

### Bug 17: Channel send inside `init()` deadlocks (receiver not spawned yet)
**Difficulty:** Middle
**Skills:** package init ordering, runtime init phase, `runtime.checkdead`

```go
package main

import "fmt"

var events = make(chan string, 0)        // unbuffered

func init() {
    events <- "package initialised"      // BUG: no receiver exists yet
}

func main() {
    go func() {
        for ev := range events {
            fmt.Println("event:", ev)
        }
    }()
    // …
}
```

**Observed behavior:**
```
fatal error: all goroutines are asleep - deadlock!
goroutine 1 [chan send]:
main.init.0()
```

<details><summary>Hint</summary> When does `init()` run relative to `main()`? And the goroutine in `main` that reads `events` — has it been spawned at the moment `init()` runs? </details>

<details><summary>Diagnosis</summary>

`runtime/proc.go:main` runs all package `init` functions in dependency order *before* invoking `main.main`. At the moment `init()` tries to send on the unbuffered `events` channel, no goroutine exists that could receive — the consumer is set up inside `main.main`, which has not yet been called. The send parks on `hchan.sendq` with `waitReasonChanSend`; no other goroutine is runnable (the runtime hasn't reached `main` yet); `runtime.checkdead` fires.

The general rule: `init()` runs in a single-threaded, pre-main context. Anything that requires another goroutine to be running cannot happen in `init`. Spawn goroutines, send on channels, and start servers from `main` or a function called by `main`.

</details>

<details><summary>Fix</summary>

```go
var events = make(chan string, 16)       // buffered: init's send doesn't block

func init() {
    events <- "package initialised"      // OK now, buffer absorbs it
}

func main() {
    go func() {
        for ev := range events {
            fmt.Println("event:", ev)
        }
    }()
}
```

Or move the send out of `init` entirely — into a `Start()` function called by `main` after the consumer goroutine exists. The buffered-channel fix works but couples buffer size to the number of pre-main events; the explicit-startup-order fix is more robust.

</details>

---

## Summary

These bugs cluster into five families.

**Goroutine lifecycle (1, 2, 4, 12, 15, 17):** receivers that vanish, all-asleep deadlocks, OS threads pinned forever, panics that cross goroutine boundaries, unbounded spawn, sends before receivers exist. The scheduler's invariant is "every parked goroutine has a future event that will wake it"; every bug here violates that.

**Preemption and scheduling (3, 10, 11):** cooperative preemption pre-1.14, `Gosched` as a deadlock band-aid, `GOMAXPROCS(1)` as a race-prevention measure. All three confuse the scheduler's "what runs next" decision with synchronization or correctness guarantees.

**GC and finalizers (5, 6, 16):** closures that pin their finalizer target, missing `KeepAlive` letting a finalizer fire mid-use, `sync.Pool` cleared by GC. The reachability rules are subtle; reading `runtime/mfinal.go` and `runtime/mgc.go` is the only reliable way to predict timing.

**Runtime ABI fragility (7, 13):** `go:linkname` to renamed symbols, `unsafe.Pointer` into runtime structs whose layout changed. The runtime is private; anything you reach into is a future build failure.

**Timing and cgo (8, 9, 14):** long cgo calls blocking GC's STW, `time.After` leaking timers in a loop, `NumGoroutine` returning more than expected because of runtime housekeeping. The runtime spawns and runs its own goroutines; user code must account for them, not pretend they don't exist.

Review checklist for any runtime-touching PR:

- [ ] For every `<-ch` or `ch <-`, is there a guaranteed path that wakes (or cancels) the blocked side, even under timeout or error?
- [ ] Does any goroutine call `runtime.LockOSThread` without a matching `UnlockOSThread`? Is it deliberately holding the M (UI thread) or accidentally killing it on exit?
- [ ] For every `runtime.SetFinalizer`, does the finalizer function reference the target *only* through its parameter — never via closure capture of the outer variable?
- [ ] For code that uses a struct's underlying resource (file descriptor, mmap, C pointer) after copying the resource out into a local, is there a `runtime.KeepAlive` past the last use?
- [ ] Does the code use `//go:linkname` or `unsafe.Pointer` to reach into `runtime.*` internals? If yes, is a Go version pinned and is there a CI job that fails the build when the assumption breaks?
- [ ] Are cgo calls bounded in duration, or wrapped in `runtime.LockOSThread` to isolate the M from GC's STW?
- [ ] In `select` loops, is `time.After` replaced with a reused `time.Timer` and `t.Reset`/`t.Stop`?
- [ ] Does every goroutine spawned by library code install a deferred recover that logs and returns, rather than letting a panic crash the whole program?
- [ ] Is every `for { go work() }` loop bounded by a semaphore, worker pool, or rate limit?
- [ ] Does any code in `init()` send on an unbuffered channel, start a server that depends on another goroutine, or otherwise assume concurrent goroutines exist?
