# Goroutine Preemption — Find the Bug

A collection of buggy programs and subtle anti-patterns related to preemption. For each, read the code, predict the behaviour, then read the diagnosis.

---

## Bug 1 — The classic hang

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    runtime.GOMAXPROCS(1)
    done := false
    go func() {
        // intentional: wait for the flag
        for !done {
        }
        fmt.Println("done!")
    }()
    done = true
    fmt.Println("flag set")
}
```

**Predict.** Will "done!" be printed?

**Diagnosis.** Multiple issues compound here.

1. The `done` variable is read by the goroutine and written by main with no synchronisation. The race detector would flag this immediately.
2. Even on Go 1.14+ with async preemption, the spinning goroutine will eventually be preempted, the main goroutine will run, and `done = true` will be observed — *but only if the compiler does not optimise the load out*. A clever compiler can hoist `done` into a register, making the loop spin on a stale value forever.
3. With `GODEBUG=asyncpreemptoff=1`, the hang from pre-1.14 returns: the spinner never yields, the main goroutine never runs.

**Fix.** Use a channel or `sync/atomic`:
```go
var done atomic.Bool
go func() {
    for !done.Load() {}
    fmt.Println("done!")
}()
done.Store(true)
```

---

## Bug 2 — GC stalled by a counter loop

```go
package main

import (
    "runtime"
    "runtime/debug"
    "time"
)

func main() {
    runtime.GOMAXPROCS(2)
    debug.SetGCPercent(1)

    var x uint64
    go func() {
        for {
            x++ // looks innocent
        }
    }()

    for i := 0; i < 100; i++ {
        _ = make([]byte, 1<<20)
        time.Sleep(time.Millisecond)
    }
}
```

**Predict.** Is `x++` preemptible?

**Diagnosis.** `x++` is a plain variable update; the compiler emits a load, an add, and a store. There is no write barrier (the variable is not a pointer). The loop has no function calls, so cooperative preemption never fires. Async preemption *does* fire on Go 1.14+ — but the un-preemptible window between iterations is so short that GC sees only short STW-start delays.

**However.** With `GODEBUG=asyncpreemptoff=1`, the spinner runs forever and STW waits indefinitely. Programs that depend on bounded latency must keep async preemption enabled.

**Fix.** None needed in code; the bug is the *configuration* that disables async preemption.

---

## Bug 3 — Pinned cgo call starving Go goroutines

```go
package main

/*
#include <unistd.h>
*/
import "C"

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func main() {
    runtime.GOMAXPROCS(1)
    var wg sync.WaitGroup

    wg.Add(1)
    go func() {
        defer wg.Done()
        C.sleep(3) // 3 seconds in C
    }()

    start := time.Now()
    wg.Add(1)
    go func() {
        defer wg.Done()
        fmt.Println("hi from goroutine 2 at", time.Since(start))
    }()

    wg.Wait()
}
```

**Predict.** When does goroutine 2 print?

**Diagnosis.** With `GOMAXPROCS=1`, there is one P. The first goroutine enters `C.sleep`, which is a cgo call. The runtime detaches the P from the M (which is in C) and could start a new M for other goroutines. Sysmon will notice the long-running syscall and ensure a fresh M takes over the P. So goroutine 2 should print quickly.

But there are subtle conditions: if sysmon is sleeping when the cgo call starts, it can take up to 10 ms before it notices and reassigns. On a tight latency budget, this matters.

**Fix.** Avoid long cgo calls. Or set `GOMAXPROCS > 1` so the cgo call does not block the whole pool.

---

## Bug 4 — `runtime.Goexit` from `main`

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    fmt.Println("about to Goexit")
    runtime.Goexit()
    fmt.Println("after Goexit")
}
```

**Predict.** What does the program do?

**Diagnosis.** `Goexit` terminates the calling goroutine and runs its deferred functions. Called from `main`, it terminates the main goroutine. The runtime then notices there are no goroutines left and panics with:

```
fatal error: no goroutines (main called runtime.Goexit) - deadlock!
```

**Fix.** Use `os.Exit(0)` or just `return` from `main`. Reserve `Goexit` for worker goroutines.

---

## Bug 5 — Locked OS thread holding a signal

```go
package main

import (
    "fmt"
    "runtime"
    "syscall"
    "time"
)

func main() {
    runtime.LockOSThread()

    // mask SIGURG on this thread (bad idea!)
    var mask syscall.Sigset_t
    syscall.SigsetAdd(&mask, syscall.SIGURG)
    syscall.PthreadSigmask(syscall.SIG_BLOCK, &mask, nil)

    // tight loop
    for i := 0; i < 1_000_000_000; i++ {
    }
    fmt.Println("done")
    _ = time.Second
}
```

(Note: `syscall.SigsetAdd` is illustrative; the actual API varies.)

**Predict.** Will async preemption fire?

**Diagnosis.** No. The thread has masked `SIGURG`. The signal is delivered but pending; the handler does not run. Async preemption is silently disabled on this thread. With `GOMAXPROCS=1`, the program may hang STW for the duration of the loop.

**Fix.** Do not mask `SIGURG`. If you must call into a third-party library that masks signals, undo the mask afterwards.

---

## Bug 6 — Channel send inside a write barrier

```go
type Holder struct {
    ptr *int
    ch  chan int
}

func (h *Holder) Update(p *int) {
    h.ptr = p          // pointer write -> write barrier
    h.ch <- 42         // channel send
}
```

**Predict.** Is anything fundamentally wrong?

**Diagnosis.** Nothing wrong. The write barrier for `h.ptr = p` runs and completes *before* the channel send. The write barrier is not async-preemptible, but the goroutine fully exits the barrier before the channel operation. The misconception is that a write barrier is somehow a multi-statement region; it is a single, brief atomic-ish event around one pointer store.

**The real bug** would be if you wrote a *manual* write barrier in unsafe code that spanned multiple statements. Do not do that.

---

## Bug 7 — Tight loop in a request handler

```go
package main

import (
    "fmt"
    "net/http"
)

func slow(w http.ResponseWriter, r *http.Request) {
    var sum int64
    for i := int64(0); i < 1_000_000_000; i++ {
        sum += i
    }
    fmt.Fprintln(w, "sum:", sum)
}

func main() {
    http.HandleFunc("/slow", slow)
    http.ListenAndServe(":8080", nil)
}
```

**Predict.** What latency do other concurrent requests see?

**Diagnosis.** The tight loop is preemptible (Go 1.14+) so other handlers will get CPU. But preemption happens on the 10 ms granularity. If your `GOMAXPROCS` is small, p99 latency for parallel requests will spike noticeably. p999 may be even worse.

**Fix.** Move the work to a background worker pool, or break it into chunks that yield. A `select { case <-ctx.Done(): return; default: }` once per chunk integrates cancellation and preemption.

---

## Bug 8 — Misbelief about `runtime.Gosched` ordering

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        fmt.Println("A1")
        runtime.Gosched()
        fmt.Println("A2")
    }()
    go func() {
        defer wg.Done()
        fmt.Println("B1")
        runtime.Gosched()
        fmt.Println("B2")
    }()
    wg.Wait()
}
```

**Predict.** Will the output be exactly `A1 B1 A2 B2`?

**Diagnosis.** No guarantee. `Gosched` is a *hint*, not a barrier. Possible outputs include `A1 A2 B1 B2`, `B1 A1 B2 A2`, etc. With multiple Ps, the goroutines may even interleave their prints arbitrarily. `Gosched` does not promise that other goroutines have made progress.

**Fix.** If you need ordering, use channels:
```go
ch := make(chan struct{}, 1)
// A side: ch <- struct{}{}
// B side: <-ch
```

---

## Bug 9 — Signal handler installed on `SIGURG`

```go
package main

import (
    "fmt"
    "os"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    c := make(chan os.Signal, 1)
    signal.Notify(c, syscall.SIGURG)

    go func() {
        for range c {
            fmt.Println("got SIGURG!")
        }
    }()

    time.Sleep(5 * time.Second)
}
```

**Predict.** Does it print frequently? Does anything break?

**Diagnosis.** The runtime forwards `SIGURG` to user channels after handling its own preemption logic. So the program may print frequently — every time sysmon decides to preempt. This is essentially a way to *observe* async preemption rate.

Nothing breaks, but the program is noisy and the channel may fill up. Avoid `signal.Notify(c, syscall.SIGURG)` in production unless you have a specific reason.

---

## Bug 10 — Forgetting that `select { default }` is not a true loop yield

```go
for {
    select {
    case <-ctx.Done():
        return
    default:
    }
    // tight inner work
    for j := 0; j < 1000; j++ {
        sum += int64(j)
    }
}
```

**Predict.** Does the `select` add a meaningful preemption point?

**Diagnosis.** Yes, the `select` (with channel ops) goes through runtime helpers and is a function call from the prologue's perspective. So cooperative preemption fires here on every outer iteration. But the *inner* `for j := 0` loop has no calls, so within an iteration of the outer loop, preemption only fires asynchronously.

For most code this is fine. The bug is the *misbelief* that the `select` magically protects the inner loop. It does not. It only adds a preemption point at the outer iteration boundary.

---

## Bug 11 — `runtime.LockOSThread` and goroutine leak

```go
package main

import (
    "runtime"
    "time"
)

func worker() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    // do work that needs thread-local state
    time.Sleep(10 * time.Millisecond)
}

func main() {
    for i := 0; i < 1000; i++ {
        go worker()
    }
    time.Sleep(2 * time.Second)
}
```

**Predict.** Any preemption-related issue?

**Diagnosis.** Each `worker` locks an OS thread. After it sleeps and exits, `UnlockOSThread` runs, and the M becomes reusable. But while 1000 workers are alive, you have 1000 OS threads. Each thread costs 1–8 MB of RSS. The program's memory footprint balloons.

This is not strictly a preemption bug, but it interacts: preemption helps workers progress fairly within their P, but `LockOSThread` makes each worker its own M, defeating the M-pool sharing the runtime tries to do.

**Fix.** Use `LockOSThread` only for the few goroutines that truly need it (e.g., OpenGL, X11, certain syscalls). Most code does not.

---

## Bug 12 — Race between preemption and a global

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

var counter int

func main() {
    runtime.GOMAXPROCS(4)
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 1_000_000; j++ {
                counter++
            }
        }()
    }
    wg.Wait()
    fmt.Println("counter:", counter)
}
```

**Predict.** Is `counter` correct?

**Diagnosis.** No. `counter++` is a data race. The 10,000,000 increments will produce *some* number, but not 10,000,000. The race happens whether or not preemption fires. Preemption merely increases the *likelihood* that two goroutines observe each other's incomplete updates.

**Fix.** Use `atomic.Int64.Add`, a mutex, or a channel.

The connection to preemption: students sometimes blame races on "preemption between the read and the write." That is wrong — even without preemption, two goroutines on two cores can race. Preemption is unrelated to the correctness of unsynchronised shared state.

---

## Bug 13 — Custom signal handler clobbering `SIGURG`

```go
package main

/*
#include <signal.h>
void install_handler();
*/
import "C"

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    runtime.GOMAXPROCS(1)
    C.install_handler() // installs SIG_IGN for SIGURG

    go func() {
        for {
        }
    }()

    time.Sleep(2 * time.Second)
    fmt.Println("hi")
}
```

Where the C side is:

```c
#include <signal.h>
void install_handler() {
    signal(SIGURG, SIG_IGN);
}
```

**Predict.** What happens?

**Diagnosis.** The C code overrides Go's `SIGURG` handler with `SIG_IGN` (ignore). When sysmon sends `SIGURG`, the kernel ignores it. Async preemption fails. The tight loop runs forever; the main goroutine never resumes.

**Fix.** Do not install handlers for `SIGURG` from C. If a C library does, you must reinstall Go's handler afterwards using `os/signal.Reset(syscall.SIGURG)` or by ensuring the library is loaded *before* the Go runtime initialises.

---

## Bug 14 — Forgotten cancellation in a long-running goroutine

```go
package main

import (
    "context"
    "fmt"
    "time"
)

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    _ = cancel

    go func() {
        sum := 0
        for i := 0; i < 1_000_000_000; i++ {
            sum += i
        }
        fmt.Println("sum:", sum)
    }()

    <-ctx.Done()
    fmt.Println("ctx done:", ctx.Err())
    time.Sleep(time.Second)
}
```

**Predict.** Does the goroutine respect the timeout?

**Diagnosis.** No. The goroutine never checks `ctx`. It runs until completion. The `ctx.Done()` fires for the *main* goroutine, but the worker keeps spinning. Preemption gives main fair CPU, but it cannot magically inject cancellation logic into the worker.

**Fix.** Periodically check `ctx.Done()`:
```go
for i := 0; i < 1_000_000_000; i++ {
    if i%1024 == 0 {
        select {
        case <-ctx.Done():
            return
        default:
        }
    }
    sum += i
}
```

---

## Bug 15 — Misusing `runtime.GC()` to force fairness

```go
go func() {
    for {
        doWork()
        runtime.GC() // "to give others a chance"
    }
}()
```

**Predict.** What is the problem?

**Diagnosis.** `runtime.GC()` triggers a full garbage collection cycle. It is *very* expensive (milliseconds, allocating, syncing all Ms). Using it as a yield is the most expensive yield possible. If you wanted preemption help, `runtime.Gosched()` is the right call — but on Go 1.14+ even that is rarely needed.

**Fix.** Remove the call. If the goroutine truly needs to yield, use `runtime.Gosched`. If it does not, do not yield at all.

---

## Bug 16 — `select` with only a `default` is not a yield

```go
for {
    select {
    default:
    }
    work()
}
```

**Predict.** Is the `select` a yield point?

**Diagnosis.** No. A `select` with only a `default` arm compiles to essentially nothing — the compiler recognises the pattern and emits no scheduler dispatch. It is *not* a preemption point.

**Fix.** Use `runtime.Gosched()` directly if you mean to yield. Or add a real channel arm.

---

## Wrap-up

A pattern across these bugs: preemption is rarely *the* bug, but it often determines *whether the bug manifests*. Disabling async preemption, masking `SIGURG`, pinning a thread with cgo, or running pre-1.14 Go — all of these turn quiet preemption assumptions into loud failures. When debugging a "my service hangs under load" or "GC pauses are huge," ask first: is preemption working?
