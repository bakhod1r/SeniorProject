# Runtime Source — Find the Bug

## 1. How to use this file

Fourteen buggy snippets of Go code whose diagnosis requires reading the runtime source — `runtime/chan.go`, `runtime/select.go`, `runtime/time.go`, `runtime/mfinal.go`, `runtime/panic.go`, `runtime/map.go`, `runtime/proc.go`, `sync/atomic/doc.go`. Read each in 30-60 seconds, decide where the defect lives, then expand `<details>` for the answer.

Runtime bugs almost never look like "the runtime did the wrong thing". They look like "my goroutine is stuck", "my finalizer never ran", "my select is broken". The cause is always at a deeper layer: a channel rule, a scheduler invariant, a timer-heap edge case, a finalizer reachability rule. Three questions to ask every snippet:

1. *What runtime function is actually executing on the line in question — `chansend`, `selectgo`, `gopanic`, `mallocgc`?*
2. *What invariant does that function require of its callers, and which line of the snippet violates it?*
3. *Does the symptom match the invariant violation, or am I looking at a downstream effect?*

If a snippet can't answer all three, there's a bug.

---

## Bug 1 — Goroutine never returns from `chansend` (send on nil channel)

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    var ch chan int                       // BUG: nil channel, never made
    go func() {
        ch <- 42                          // blocks forever in chansend
        fmt.Println("buyer sent")
    }()
    go func() {
        time.Sleep(10 * time.Millisecond)
        v := <-ch                         // also blocks forever
        fmt.Println("got", v)
    }()
    time.Sleep(100 * time.Millisecond)
    fmt.Println("main exits, buyer dead")
}
```

<details><summary>Answer</summary>

**Bug:** `ch` was declared but never initialised — `var ch chan int` produces the nil channel. Per `runtime/chan.go::chansend`, the very first branch is:

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    if c == nil {
        if !block { return false }
        gopark(nil, nil, waitReasonChanSendNilChan, traceBlockForever, 2)
        throw("unreachable")
    }
    ...
}
```

`gopark` with `traceBlockForever` puts the goroutine in `Gwaiting` and never wakes it. The send goroutine is leaked; the receive in `chanrecv` takes the symmetric branch and is leaked too.

**Why subtle:** `nil` channels compile cleanly and are *useful* in `select` (a nil case is never selected — that's how you dynamically disable a branch). Outside `select`, send/receive on nil is a permanent park, not a panic.

**Spot:** Any `var ch chan T` followed by `ch <- x` or `<-ch` without an intervening `make`. `go vet` does not flag this; only runtime-source familiarity does.

**Fix:** Make the channel:

```go
ch := make(chan int)
```

If the nil-park behaviour is intentional (a sentinel "disabled" case in `select`), document it loudly. Anywhere else it's a leak.

**Source reference:** `runtime/chan.go` — the `if c == nil` head of both `chansend` and `chanrecv`. The matching `waitReason` strings show up as `chan send (nil chan)` / `chan receive (nil chan)` in `runtime.Stack` dumps.
</details>

---

## Bug 2 — `for range ch` runs forever after `close(ch)`

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)
    ch <- 1
    ch <- 2
    ch <- 3
    close(ch)
    for {
        v := <-ch                         // BUG: after close + drain, yields 0 forever
        if v == 0 {
            break                         // wrong stop signal
        }
        fmt.Println(v)
    }
}
```

<details><summary>Answer</summary>

**Bug:** After `close(ch)` and draining the buffered values, every further `<-ch` returns the zero value of the element type *immediately, without blocking*. The author treats `0` as the "no more values" signal — but `0` is a legitimate `int` and, more importantly, the loop will only ever see the post-drain zero if the buffer happened not to contain a real zero. If `ch <- 0` were in the buffer, the loop would stop mid-stream.

`runtime/chan.go::chanrecv` documents the contract on the closed/empty path:

```go
if c.closed != 0 && c.qcount == 0 {
    if raceenabled { racerecv(c, ep) }
    if ep != nil { typedmemclr(c.elemtype, ep) }   // zeroes destination
    return true, false                              // received=true, ok=false
}
```

The second return value (`ok`) is the closed-and-drained signal — *not* the value. The `for v := range ch` form encodes this correctly: range exits when `chanrecv` returns `ok==false`. The hand-rolled `for { v := <-ch }` loses the `ok` bit unless you write `v, ok := <-ch`.

**Why subtle:** Works perfectly until a zero value is genuinely in the stream. The bug is a misread of "what does receiving from a closed channel return".

**Spot:** Any explicit `<-ch` in a loop without the `, ok` form, or any `for { v := <-ch }` that should be `for v := range ch`.

**Fix:**

```go
for v := range ch {
    fmt.Println(v)
}
// or:
for {
    v, ok := <-ch
    if !ok { break }
    fmt.Println(v)
}
```

**Source reference:** `runtime/chan.go::chanrecv` — the closed-and-empty path zeros the destination and returns `(true, false)`. `runtime/chan.go::chanrecv2` and `chanrecv1` are the compiler-generated wrappers for the two receive forms.
</details>

---

## Bug 3 — `select` with one ready case and `default` never picks `default`

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 1)
    ch <- 7
    select {
    case v := <-ch:
        fmt.Println("got", v)
    default:
        fmt.Println("would block")        // never reached; programmer expected this
    }
}
```

<details><summary>Answer</summary>

**Bug:** Misreading of `select`'s ordering. `runtime/select.go::selectgo` does *not* prefer `default` — `default` only fires if no other case is ready. Here `ch` has a buffered value, so the receive case is ready, so it wins. The `default` only fires when all real cases would block.

`selectgo` randomises among *ready* cases, but `default` is not in the candidate set unless every non-default case is unready:

```go
// runtime/select.go (paraphrased)
// Pass 1: find all cases that can proceed now (channel ready or closed).
// If any are ready, pick one at random.
// Pass 2 (only if pass 1 empty): if there is a default, take it; else block on all cases.
```

The author may have confused `default` with "fallback if I don't want to wait" — it *is* that, but only when nothing else is available right now.

**Why subtle:** The intent — "non-blocking peek that prints something either way" — looks correct. With a *buffered* channel pre-filled, the peek succeeds and `default` never runs. If the buffer were empty, `default` would fire and the misreading would never be exposed.

**Spot:** Any `select { case ...; default: ... }` where the author expects `default` as a "no-op skip" but the case is sometimes already satisfied. Common in non-blocking sends/receives.

**Fix:** None needed if you actually want "receive if available, else skip" — that *is* what this does. The bug is the *expectation*, not the code: if you wanted both branches to run, write them sequentially, not in `select`.

```go
// non-blocking receive — current code is correct
select {
case v := <-ch:
    fmt.Println("got", v)
default:
    // ch was empty
}
```

**Source reference:** `runtime/select.go::selectgo` — search for "pass 1" / "pass 2" in the function body. The randomisation among ready cases uses `fastrandn(uint32(norder))`.
</details>

---

## Bug 4 — `time.After(d)` in a hot loop leaks Timer goroutines

```go
package main

import (
    "fmt"
    "time"
)

func worker(in <-chan int) {
    for {
        select {
        case v := <-in:
            fmt.Println(v)
        case <-time.After(1 * time.Second):   // BUG: new Timer allocated every iteration
            fmt.Println("idle")
        }
    }
}
```

<details><summary>Answer</summary>

**Bug:** Every iteration through `select` evaluates `time.After(1*time.Second)`, which calls `runtime.startTimer` to install a fresh timer in the runtime's timer heap. If `in` is busy, the timeout case never fires; the timer fires anyway one second later and the result is dropped, but it lives in the heap until then.

`runtime/time.go::startTimer` documents the cost:

```go
//go:linkname time_startTimer time.startTimer
func time_startTimer(t *timeTimer) {
    t.trace1("startTimer")
    if raceenabled { racerelease(unsafe.Pointer(&t.timer)) }
    t.maybeRunChan()
    t.modify(t.when, 0, t.f, t.arg, t.seq)   // inserts/moves in the per-P timer heap
}
```

Under load — `in` delivering thousands of items per second — the heap fills with un-fired timers. Each is a heap node with a channel that will eventually receive and then become garbage. Heap operations become O(log n) over an ever-growing n; GC sees more live timers; memory climbs.

**Why subtle:** `time.After` *looks* like a cheap function returning a channel. It is not — it allocates a `runtime.timer` and a `chan Time`, schedules with the runtime, and ties up that channel until either fire or GC.

**Spot:** Any `time.After` inside a `for { select { ... } }`. Same for `time.Tick` used briefly then dropped.

**Fix:** Hoist the timer outside the loop and reset:

```go
func worker(in <-chan int) {
    t := time.NewTimer(1 * time.Second)
    defer t.Stop()
    for {
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(1 * time.Second)
        select {
        case v := <-in:
            fmt.Println(v)
        case <-t.C:
            fmt.Println("idle")
        }
    }
}
```

Go 1.23 simplified `Reset` semantics — the `Stop`+drain dance is no longer required in 1.23+, but the timer-reuse pattern is still essential.

**Source reference:** `runtime/time.go` — `startTimer`, `addtimer`, and the per-P `timers` field on `p` (the timer heap). `time/sleep.go::After` shows the wrapper that allocates the channel and calls `runtime.startTimer`.
</details>

---

## Bug 5 — `runtime.SetFinalizer` never fires (closure captures the object)

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

type Resource struct{ id int }

func newResource(id int) *Resource {
    r := &Resource{id: id}
    runtime.SetFinalizer(r, func(_ *Resource) {
        fmt.Println("finalising", r.id)   // BUG: captures r, keeps it reachable
    })
    return r
}

func main() {
    _ = newResource(1)
    runtime.GC()
    runtime.GC()
    time.Sleep(100 * time.Millisecond)
    // expected: "finalising 1"
    // actual:   nothing
}
```

<details><summary>Answer</summary>

**Bug:** The finalizer closure captures `r` from the enclosing scope. Per `runtime/mfinal.go`, a finalizer only fires when the object is unreachable from all GC roots — *and the finalizer's own closure is one of those roots while it exists*. As long as the finalizer references `r`, `r` is reachable from the finalizer, which is reachable from the object's finalizer slot. Circular reachability: never collected.

`runtime/mfinal.go::SetFinalizer` documents the rule:

> The argument obj must be a pointer to an object allocated by calling new, by taking the address of a composite literal, or by taking the address of a local variable. The finalizer is scheduled to run at some arbitrary time after the program can no longer reach the object to which obj points. **There is no guarantee that finalizers will run before a program exits**, so they are typically useful only for releasing non-memory resources.

The "no longer reach" clause is the trap. Use the *parameter* the finalizer is called with — never the captured outer variable.

**Why subtle:** Test code prints from the closure; production code does `r.Close()`. Both keep `r` reachable. The fix — use the parameter — looks like a stylistic nit, not a correctness fix.

**Spot:** Any `SetFinalizer(obj, func(_ T) { ... obj ... })` where the body references the captured outer variable instead of the parameter.

**Fix:** Bind through the parameter:

```go
func newResource(id int) *Resource {
    r := &Resource{id: id}
    runtime.SetFinalizer(r, func(r *Resource) {
        fmt.Println("finalising", r.id)
    })
    return r
}
```

Better still: don't rely on finalizers. Use explicit `Close` + `defer`, or `runtime.AddCleanup` (Go 1.24+) which is designed to avoid this exact closure trap.

**Source reference:** `runtime/mfinal.go` — `SetFinalizer`, `addfinalizer`, and the `specialfinalizer` struct that gets attached to the object's span. The "reachable from finalizer" rule is enforced implicitly by the GC tracing roots; there's no special-case code, which is why the bug is so easy to write.
</details>

---

## Bug 6 — `panic` inside a deferred function masks the original panic

```go
package main

import "fmt"

func cleanup() {
    panic("cleanup also failed")           // BUG: replaces original panic
}

func work() {
    defer cleanup()
    panic("original failure")
}

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)   // prints "cleanup also failed", not original
        }
    }()
    work()
}
```

<details><summary>Answer</summary>

**Bug:** When `work` panics, the runtime unwinds and invokes the deferred `cleanup`. `cleanup` panics again. Per `runtime/panic.go::gopanic`, a panic during a deferred function does not "wrap" the prior panic — it replaces it as the current active panic, while the prior panic is marked aborted:

```go
// runtime/panic.go (paraphrased)
// gopanic walks the defer chain. For each deferred call:
//   - if the deferred call itself panics, the new panic becomes "current"
//   - the previous panic is marked aborted=true and is no longer reported by recover
```

By the time `recover` runs in `main`, it sees the cleanup panic. The original `"original failure"` is gone unless you specifically inspect the panic chain — and Go does not expose it through the standard `recover` API.

**Why subtle:** `cleanup` looks unrelated; the test that triggered `work`'s panic sees a *different* error message and the team debugs the wrong thing.

**Spot:** Any deferred function that can itself panic — particularly cleanup code that does `Close()`, `Unlock()`, or further work that may fail.

**Fix:** Make deferred functions panic-safe. Either recover internally and log, or guarantee they cannot panic:

```go
func cleanup() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("cleanup failed: %v", r)
        }
    }()
    // ... work that may panic ...
}
```

For libraries, document deferred-panic semantics. For application code, prefer explicit error returns over panics in cleanup paths.

**Source reference:** `runtime/panic.go::gopanic` — the loop over `gp._defer` and the `_panic.aborted` flag. `runtime/panic.go::recovery` shows how `recover` reads the active panic but skips aborted ones.
</details>

---

## Bug 7 — `recover` outside of a deferred call returns nil

```go
package main

import "fmt"

func tryRecover() {
    if r := recover(); r != nil {         // BUG: recover only works in deferred call
        fmt.Println("recovered:", r)
    }
}

func main() {
    defer func() {
        tryRecover()                       // calling a function that calls recover
    }()
    panic("boom")
}
```

<details><summary>Answer</summary>

**Bug:** `recover` returns the active panic value *only when called directly from a deferred function*. Calling `recover` from a function that is itself called from a deferred function (one extra frame deep) does not work — `recover` returns `nil` and the panic continues to propagate.

`runtime/panic.go::recovery` (and the spec-level rule in the language spec) defines the contract:

> The return value of recover is nil if any of the following conditions holds:
> - panic's argument was nil;
> - the goroutine is not panicking;
> - **recover was not called directly by a deferred function**.

The check is on the PC — the runtime walks the goroutine's defer chain and confirms the calling frame matches a deferred call. One frame too deep, the check fails, and `nil` is returned.

**Why subtle:** It feels like an arbitrary restriction. The test "does my panic get caught?" is the only way to notice — and small refactors that extract `recover` into a helper silently break it.

**Spot:** Any `recover()` call that is not lexically inside `defer func() { ... recover() ... }()` or `defer someFunctionThatCallsRecoverDirectly()`. Helpers that wrap `recover` only work if the helper is the *direct* target of `defer`.

**Fix:** Inline the `recover`, or make the helper itself the deferred call:

```go
// inline
defer func() {
    if r := recover(); r != nil {
        fmt.Println("recovered:", r)
    }
}()

// or: helper is the deferred call directly
func recoverHandler() {
    if r := recover(); r != nil {
        fmt.Println("recovered:", r)
    }
}
defer recoverHandler()
```

**Source reference:** `runtime/panic.go::recovery` and `runtime/panic.go::gorecover` — the latter does the PC-walk check against the current deferred frame. The check `gp._defer.started && gp._defer.sp == sp` is what makes the depth restriction binding.
</details>

---

## Bug 8 — Test depends on map iteration order

```go
package main

import "fmt"

func firstKey(m map[string]int) string {
    for k := range m {
        return k                          // BUG: order not stable across iterations
    }
    return ""
}

func main() {
    m := map[string]int{"a": 1, "b": 2, "c": 3}
    fmt.Println(firstKey(m))              // sometimes "a", sometimes "b" or "c"
    fmt.Println(firstKey(m))              // may differ from line above
}
```

<details><summary>Answer</summary>

**Bug:** Go deliberately randomises map iteration order — not as an implementation detail, but as a documented guarantee, precisely to prevent this kind of dependency. `runtime/map.go::mapiterinit` seeds the iterator with `fastrand()`:

```go
// runtime/map.go (paraphrased)
func mapiterinit(t *maptype, h *hmap, it *hiter) {
    ...
    // decide where to start
    r := uintptr(fastrand())
    if h.B > 31-bucketCntBits {
        r += uintptr(fastrand()) << 31
    }
    it.startBucket = r & bucketMask(h.B)
    it.offset      = uint8(r >> h.B & (bucketCnt - 1))
    ...
}
```

Two iterations of the same map produce different orders. The Go authors did this on purpose so that code accidentally relying on a stable order would break loudly in development rather than silently in production after a Go version bump.

**Why subtle:** With three elements, the bug may not show within a single program run; with one element, it never shows. Tests that assert `firstKey(m) == "a"` pass intermittently and fail at random.

**Spot:** Any `for k := range m { return k }`, any test that compares iteration output to a literal slice without sorting, any code that "depends on the first key".

**Fix:** Be explicit about which key you want, or sort:

```go
import "sort"

func firstKeySorted(m map[string]int) string {
    keys := make([]string, 0, len(m))
    for k := range m {
        keys = append(keys, k)
    }
    sort.Strings(keys)
    if len(keys) == 0 { return "" }
    return keys[0]
}
```

If you need a deterministic ordering, choose one (lex, insertion order via a parallel slice, etc.) and encode it.

**Source reference:** `runtime/map.go::mapiterinit` — the `fastrand()` seeding of the starting bucket/offset. The Go spec explicitly states: "The iteration order over maps is not specified and is not guaranteed to be the same from one iteration to the next."
</details>

---

## Bug 9 — Sending on a closed channel panics

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int, 4)
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            ch <- i                       // BUG: one of these races with close
        }(i)
    }
    close(ch)                              // BUG: close before producers finish
    wg.Wait()
    for v := range ch {
        fmt.Println(v)
    }
}
```

<details><summary>Answer</summary>

**Bug:** `close(ch)` runs concurrently with the producers. Whichever producer sends after the close hits the panic path in `runtime/chan.go::chansend`:

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    ...
    lock(&c.lock)
    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("send on closed channel"))
    }
    ...
}
```

Buffered or unbuffered, the rule is the same: once `c.closed != 0`, any further send panics. The panic message is the literal string `"send on closed channel"` — instantly recognisable in logs.

**Why subtle:** With four producers and a buffered channel, three of them might finish before `close`, and the program prints the right values most of the time. The panic-on-fourth shows up only when scheduling stretches the producer execution past the `close` call.

**Spot:** Any `close(ch)` that is not strictly *after* all senders have completed. The standard pattern is: only the sender closes, and senders coordinate (via `sync.WaitGroup`) before any party closes.

**Fix:** Close *after* `wg.Wait`:

```go
go func() {
    wg.Wait()
    close(ch)
}()
for v := range ch {
    fmt.Println(v)
}
```

The closer goroutine waits for all producers, then closes. The consumer's `range` exits when the channel is closed and drained.

**Source reference:** `runtime/chan.go::chansend` — the `c.closed != 0` check after acquiring the lock. The matching `runtime/chan.go::closechan` sets `c.closed = 1` and wakes all parked receivers; any sender that arrives later sees the flag.
</details>

---

## Bug 10 — "all goroutines are asleep — deadlock"

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    fmt.Println(<-ch)                     // BUG: no sender, no other goroutine
}
```

<details><summary>Answer</summary>

**Bug:** The main goroutine receives on a channel that nobody will ever send on. There are no other goroutines. The runtime's deadlock detector — `runtime/proc.go::checkdead` — notices that *every* goroutine is in a wait state with no possibility of waking, and aborts the program:

```go
// runtime/proc.go (paraphrased)
func checkdead() {
    // ... count goroutines that are runnable, syscall-blocked,
    // or waiting on something that could fire externally (timer, finalizer).
    if grunning == 0 && nmidle == nmidleworker {
        throw("all goroutines are asleep - deadlock!")
    }
}
```

The check runs whenever a goroutine parks. If no runnable goroutine remains and no timer is pending and no syscall is in flight, the runtime knows nothing can wake the system and prints the fatal error.

**Why subtle:** The detector is conservative — it only catches *complete* deadlocks. A leaked goroutine in a multi-goroutine program is not flagged: as long as *one* other goroutine is making progress (or might, e.g. a network read), `checkdead` stays silent. So this small reproducer fails loudly, but the same shape of bug in a larger program leaks goroutines silently.

**Spot:** Any single-goroutine `<-ch` / `ch <-` with no other party. In multi-goroutine programs, `goleak` (uber-go/goleak) detects leaked-but-undetected goroutines that `checkdead` lets through.

**Fix:** Start a sender, give the channel a buffered value, or use `context.Context` with a deadline:

```go
ch := make(chan int, 1)
ch <- 42
fmt.Println(<-ch)
```

The deadlock detector is a backstop; the right fix is always to design the communication so it terminates.

**Source reference:** `runtime/proc.go::checkdead` — the counting of runnable/syscall/locked goroutines and the `throw("all goroutines are asleep - deadlock!")` call. `runtime/proc.go::throw` aborts the process.
</details>

---

## Bug 11 — `runtime.LockOSThread` without `UnlockOSThread`

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func work(id int, wg *sync.WaitGroup) {
    defer wg.Done()
    runtime.LockOSThread()                // BUG: no matching UnlockOSThread
    defer fmt.Println("worker", id, "done")
    // ... do CGO / OpenGL / setuid work that needs OS-thread affinity ...
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go work(i, &wg)
    }
    wg.Wait()
    fmt.Println("all workers done")
}
```

<details><summary>Answer</summary>

**Bug:** When a goroutine that called `LockOSThread` exits without calling `UnlockOSThread`, the runtime *destroys* the underlying OS thread (M) rather than returning it to the pool. Per `runtime/proc.go::goexit0`:

```go
// runtime/proc.go (paraphrased)
if locked && mp.lockedInt != 0 {
    // The locked M is exiting along with the locked G.
    // Don't return it to the M pool. Destroy it.
    gogo(&_g_.m.g0.sched)   // exit the M
}
```

Spawning 1000 short-lived goroutines that each lock-and-exit creates and destroys 1000 OS threads. Thread creation is expensive (~100µs on Linux, more on macOS) and exhausts ulimits under load. CPU time spent in `clone`/`pthread_create`/`pthread_exit` dwarfs the actual work.

**Why subtle:** Functionally correct. The program produces the right output. Performance and resource consumption are the symptoms — `perf top` shows kernel time in thread setup; `/proc/self/status` shows the thread count climbing then falling.

**Spot:** Any `LockOSThread` in code that doesn't have a matching `UnlockOSThread` *before* the goroutine exits. The exception: if you *want* the M destroyed (it has dirty thread-local state from CGO, e.g. a Python interpreter), the pattern is intentional.

**Fix:** Match every lock with an unlock:

```go
func work(id int, wg *sync.WaitGroup) {
    defer wg.Done()
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    // ... thread-affine work ...
}
```

The `defer` pairing ensures even panics don't leak the lock. For long-lived workers (the typical case for `LockOSThread`), one thread pinned per worker is fine; for short-lived per-request goroutines, the unlock is mandatory.

**Source reference:** `runtime/proc.go::goexit0` — the `locked && mp.lockedInt != 0` branch that bypasses the M-pool return. `runtime/proc.go::LockOSThread` and `UnlockOSThread` increment/decrement `mp.lockedInt`.
</details>

---

## Bug 12 — Atomic on misaligned 64-bit field on 32-bit ARM

```go
package main

import (
    "fmt"
    "sync/atomic"
)

type Counter struct {
    Name  string
    Total int64                            // BUG: not guaranteed 8-byte aligned on 32-bit
}

func main() {
    c := &Counter{Name: "hits"}
    atomic.AddInt64(&c.Total, 1)          // panics on 32-bit ARM / 386
    fmt.Println(c.Total)
}
```

<details><summary>Answer</summary>

**Bug:** `sync/atomic/doc.go` documents the alignment constraint:

> On ARM, 386, and 32-bit MIPS, it is the caller's responsibility to arrange for 64-bit alignment of 64-bit words accessed atomically. The first word in a variable or in an allocated struct, array, or slice can be relied upon to be 64-bit aligned.

`Total` is the *second* field. On 32-bit platforms, struct fields are only guaranteed 4-byte aligned by default, and the runtime's atomic helpers — `runtime/internal/atomic` on 32-bit — assert alignment and panic with `unaligned 64-bit atomic operation` if violated.

On amd64 / arm64 the constraint doesn't bite (8-byte alignment is automatic), so CI on x86 passes; deployment to ARM SBCs or older Android targets crashes.

**Why subtle:** Architecture-specific. Most modern developer machines are 64-bit and never hit this. The fix is mechanical — reorder fields, or use `atomic.Int64` from Go 1.19+ which has its alignment requirement built into the type.

**Spot:** Any `atomic.AddInt64`/`LoadInt64`/`StoreInt64`/`CompareAndSwapInt64` on a struct field that is not the first field of the struct. `go vet` does *not* catch this; `unaligned64bit` is a runtime panic, not a static check (though there are third-party linters such as `fieldalignment`).

**Fix:** Use Go 1.19+ atomic types (`atomic.Int64`), which embed alignment guarantees:

```go
type Counter struct {
    Name  string
    Total atomic.Int64                     // alignment guaranteed by type definition
}

// usage
c.Total.Add(1)
```

If stuck on pre-1.19 Go: place the 64-bit field first, or wrap it in a separately-allocated struct whose first field is the int64.

**Source reference:** `sync/atomic/doc.go` — the alignment paragraph. `runtime/internal/atomic/atomic_arm.go` and `atomic_386.go` — the assertions that panic on misalignment. `sync/atomic/type.go` (1.19+) — `Int64` is defined as `struct { _ noCopy; _ align64; v int64 }` where `align64` is a zero-width type whose declaration forces 8-byte alignment.
</details>

---

## Bug 13 — `make(chan int, -1)` panics

```go
package main

import "fmt"

func main() {
    n := computeBufferSize()              // returns -1 in some edge case
    ch := make(chan int, n)               // BUG: negative size panics
    ch <- 1
    fmt.Println(<-ch)
}

func computeBufferSize() int {
    // bug elsewhere returns negative under high load
    return -1
}
```

<details><summary>Answer</summary>

**Bug:** `runtime/chan.go::makechan` validates the size and panics:

```go
func makechan(t *chantype, size int) *hchan {
    elem := t.elem
    ...
    mem, overflow := math.MulUintptr(elem.size, uintptr(size))
    if overflow || mem > maxAlloc-hchanSize || size < 0 {
        panic(plainError("makechan: size out of range"))
    }
    ...
}
```

The panic message is the literal `"makechan: size out of range"`. Same check rejects sizes that would overflow when multiplied by element size (huge `size * sizeof(T)`).

The author assumed `make(chan int, n)` would clamp or silently default — it doesn't. The runtime is strict.

**Why subtle:** The negative-size path is reached only via the *other* bug — whatever computes `n` returning negative under load. The panic happens far from the root cause. Stack trace points at `make(chan int, n)`, not at `computeBufferSize`.

**Spot:** Any `make(chan T, n)` or `make([]T, n)` or `make(map[K]V, n)` where `n` comes from a computation that could be negative. `make([]T, n)` panics the same way for negative `n`.

**Fix:** Validate at the source:

```go
n := computeBufferSize()
if n < 0 {
    n = 0
}
ch := make(chan int, n)
```

Or — better — fix `computeBufferSize` to never return negative. Defensive clamping at the `make` site hides the upstream defect.

**Source reference:** `runtime/chan.go::makechan` — the `size < 0` and `overflow` checks. `runtime/slice.go::makeslice` has the analogous panic for slices.
</details>

---

## Bug 14 — Append to nil slice works; "append" to nil channel blocks forever

```go
package main

import "fmt"

func main() {
    var s []int
    s = append(s, 1, 2, 3)                // works fine — nil slice is OK for append
    fmt.Println(s)

    var ch chan int
    ch <- 1                                // BUG: nil channel — sender blocks forever
    fmt.Println(<-ch)
}
```

<details><summary>Answer</summary>

**Bug:** Different runtime types, different nil semantics. A nil slice is a valid empty slice: `append` reads its length (`0`), allocates a backing array, and produces a new slice header. A nil channel is *not* a valid empty channel: `chansend` and `chanrecv` both go to the `if c == nil` branch and park the goroutine forever (Bug 1).

The asymmetry is by design:

- `runtime/slice.go::growslice` handles `nil` as `len=0, cap=0, ptr=nil` and allocates. The `append` builtin is just a `growslice` call when capacity is exceeded.
- `runtime/chan.go::chansend` treats `nil` as a sentinel meaning "this channel is permanently unwakeable" — useful in `select` to dynamically disable a case, fatal everywhere else.

The author generalised from "nil works for slices" to "nil works for channels". The two follow different contracts because slices have a value-type header (so nil has structure) and channels are pointers to runtime structs (so nil has no struct to operate on).

**Why subtle:** Both look like zero values of compound types. The mental model "Go treats zero values uniformly" is *almost* true and breaks on channels specifically because they are pointers to runtime objects. Maps are similar: read from nil map returns zero, write to nil map panics — yet another nil contract.

**Spot:** Any reliance on "nil chan T works like an empty channel" — there is no such thing. `var ch chan T` is for explicit `select` disablement only.

**Fix:** Always `make` channels before use:

```go
ch := make(chan int, 1)
ch <- 1
fmt.Println(<-ch)
```

Reference card for nil contracts:

- `var s []T`           → append OK, range OK (zero iterations), index panics
- `var m map[K]V`       → read returns zero, range OK, write panics
- `var ch chan T`       → send/receive park forever, close panics
- `var p *T`            → deref panics
- `var f func()`        → call panics
- `var i interface{}`   → method call panics (nil interface) or works (typed-nil-interface, depending)

Knowing these by heart is the cheapest insurance against nil bugs.

**Source reference:** `runtime/slice.go::growslice` — accepts nil source. `runtime/chan.go::chansend` and `chanrecv` — `if c == nil` parks. `runtime/map.go::mapassign` — `if h == nil` panics with "assignment to entry in nil map". The asymmetry across these three is the source of the bug.
</details>

---

## Summary

These bugs cluster into four families, each rooted in a runtime contract that's invisible from the call site.

**Channel contracts (1, 2, 9, 13, 14):** nil channels park forever, closed channels return zero+ok=false (not "any zero is end-of-stream"), sending on closed panics, negative buffer size panics, nil chan ≠ empty slice. Every one of these is a one-line rule in `runtime/chan.go` — `chansend`, `chanrecv`, `closechan`, `makechan`. Reading the file once costs an hour and saves a year.

**Select / scheduler (3, 10):** `select` doesn't prefer `default`; it picks randomly among ready cases and falls to `default` only when all real cases would block. The deadlock detector (`checkdead`) catches whole-program deadlocks but not partial goroutine leaks — `goleak` covers what `checkdead` misses.

**Timers / panics / finalizers (4, 5, 6, 7):** `time.After` allocates a runtime timer per call (hoist and reuse); finalizer closures must use the parameter not the captured object; `panic` during deferred replaces the original; `recover` must be called *directly* from a deferred function. All four are documented in their respective runtime files and almost never noticed until production.

**Platform / alignment / OS-thread (8, 11, 12):** map iteration order is randomised on purpose; `LockOSThread` without `UnlockOSThread` destroys the M on goroutine exit; 64-bit atomics on 32-bit platforms require explicit alignment. The first hides design-time bugs; the second wastes resources at scale; the third crashes on architectures developers don't test on.

Review checklist for any concurrency / runtime-touching PR:

- [ ] Every channel variable initialised via `make` before send/receive (no implicit nil channel parks)?
- [ ] Every channel receive in a loop uses `for v := range ch` or the `v, ok := <-ch` form?
- [ ] Every `select { default: }` matches the author's expectation that `default` only fires when *all* other cases would block?
- [ ] Every `time.After` in a `for { select }` replaced with a hoisted `time.NewTimer` + `Reset`?
- [ ] Every `SetFinalizer` callback uses its parameter — never captures the object from the outer scope?
- [ ] Every deferred function panic-safe (internal `recover` or proven non-panicking)?
- [ ] Every `recover()` lexically inside a `defer func() { ... }()` — never in a helper one frame deep?
- [ ] Every test/code path that iterates a map either sorts the keys or asserts on the set, not the sequence?
- [ ] Every `close(ch)` strictly after all sends are complete (typically `wg.Wait()` + close in a single goroutine)?
- [ ] Every `LockOSThread` paired with `defer runtime.UnlockOSThread` — or explicitly documented as "M must be destroyed on exit"?
- [ ] Every 64-bit atomic field declared as `atomic.Int64`/`atomic.Uint64` (Go 1.19+) or placed first in its struct?
- [ ] Every `make(chan T, n)` / `make([]T, n)` with a computed `n` validated against negative values at the source, not at the `make` site?
- [ ] Every nil contract distinguished: nil slice (append OK), nil map (read OK / write panics), nil chan (parks forever), nil ptr/func (panics)?
