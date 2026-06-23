# Nil Channels — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `hchan` Pointer and Nil](#the-hchan-pointer-and-nil)
3. [`chansend` and the Nil Branch](#chansend-and-the-nil-branch)
4. [`chanrecv` and the Nil Branch](#chanrecv-and-the-nil-branch)
5. [`closechan` and the Panic Path](#closechan-and-the-panic-path)
6. [How `select` Encodes Nil Cases](#how-select-encodes-nil-cases)
7. [`gopark` and Wait Reasons](#gopark-and-wait-reasons)
8. [Deadlock Detection and Nil Channels](#deadlock-detection-and-nil-channels)
9. [Interaction with the Race Detector](#interaction-with-the-race-detector)
10. [Compiler Treatment of Nil-Receive in `for ... range`](#compiler-treatment-of-nil-receive-in-for--range)
11. [Reading the Runtime Source](#reading-the-runtime-source)
12. [Summary](#summary)

---

## Introduction

The professional level is where the rule "send/receive on nil blocks forever" is replaced by *exactly which instruction in `runtime/chan.go` makes that happen, and what wait reason `gopark` records*. You read the runtime source, you follow a `select` from the compiler-emitted call all the way through `selectgo`, you see how `pollorder` and `lockorder` arrays handle nil channels, and you can answer "why doesn't the deadlock detector always fire when only one goroutine is parked on a nil channel?"

References below are to Go 1.22 source under `src/runtime/`. Line numbers drift; function names are stable.

---

## The `hchan` Pointer and Nil

A Go `chan T` is, at the machine level, a pointer to an `hchan` struct defined in `runtime/chan.go`:

```go
type hchan struct {
    qcount   uint           // total data in the queue
    dataqsiz uint           // size of the circular queue (buffer capacity)
    buf      unsafe.Pointer // pointer to dataqsiz array of size elemsize
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint   // send index
    recvx    uint   // receive index
    recvq    waitq  // list of recv waiters
    sendq    waitq  // list of send waiters
    lock     mutex
}
```

When you write `make(chan int, 10)`, the runtime allocates an `hchan` (plus a backing buffer), initialises the fields, and returns the pointer. The Go variable `ch chan int` holds that pointer.

When you write `var ch chan int`, the variable holds the zero value of a pointer: 0, i.e. nil. No `hchan` exists. There is nothing to lock, no buffer, no waitq. Every runtime entry point therefore must check for nil before doing anything else.

### Why a single pointer, not a struct value?

The Go team chose pointer semantics for channels so that:

- Channels are reference types: `ch2 := ch` shares the same underlying buffer/waiters.
- Channels can be compared (pointer equality).
- The zero value is naturally nil.

The same applies to maps and pointers — they share this property. Slices, strings, and interfaces have multi-word zero values, but their nil checks are similar (nil data pointer).

---

## `chansend` and the Nil Branch

The runtime function `chansend` implements every channel send. From `runtime/chan.go`:

```go
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    if c == nil {
        if !block {
            return false
        }
        gopark(nil, nil, waitReasonChanSendNilChan, traceBlockForever, 2)
        throw("unreachable")
    }
    // ... normal send path: lock, buffer or sudog, etc. ...
}
```

Walk through this:

1. **`c == nil`** — the very first check.
2. **`if !block`** — `block` is `false` only for non-blocking sends, i.e., `select` with `default`. In that case, we report "send did not complete" by returning `false`. The `select` runtime then falls through to the `default` case.
3. **`block == true`** — the goroutine must commit to sending. It calls `gopark` with wait reason `waitReasonChanSendNilChan`.
4. **`throw("unreachable")`** — `gopark` never returns for a nil-channel wait because no one will ever wake the goroutine. The `throw` is a compiler hint and a safety net; if execution somehow reached it, the runtime would crash with "unreachable" in the trace.

### `gopark` with no unparker

`gopark`'s signature:

```go
func gopark(unlockf func(*g, unsafe.Pointer) bool, lock unsafe.Pointer, reason waitReason, traceReason traceBlockReason, traceskip int)
```

The first argument is an "unlock function" that runs after the goroutine has been parked but before another goroutine can resume it. For nil-channel waits, both `unlockf` and `lock` are nil. The goroutine is parked with *no unpark mechanism* — there is no waitq it is enqueued onto, no condition variable to signal.

This is the technical reason a nil-channel send/receive is "forever": the goroutine is in the `_Gwaiting` state but there is no path back to `_Grunnable`. Only goroutine destruction (program exit) ends the wait.

---

## `chanrecv` and the Nil Branch

Symmetric structure in `runtime/chan.go`:

```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    if c == nil {
        if !block {
            return
        }
        gopark(nil, nil, waitReasonChanReceiveNilChan, traceBlockForever, 2)
        throw("unreachable")
    }
    // ... normal receive path ...
}
```

Differences from send:

- The wait reason is `waitReasonChanReceiveNilChan` instead of `waitReasonChanSendNilChan`.
- The return values are `(selected, received)`: `selected` tells `select` whether this case was taken; `received` is the `ok` value seen by the user as `v, ok := <-ch`.

For non-blocking nil receive (in a `select` with `default`), both return values are `false` — the `select` knows the case did not fire.

For blocking nil receive, the same `gopark(nil, nil, ...)` pattern: park with no unparker, never wake.

### The two wait reasons

| Wait reason | Constant | When |
|---|---|---|
| `waitReasonChanSendNilChan` | "chan send (nil chan)" | Send on nil channel, blocking |
| `waitReasonChanReceiveNilChan` | "chan receive (nil chan)" | Receive on nil channel, blocking |

These strings appear in `pprof goroutine?debug=2` and in `runtime.Stack` output. Production diagnostics rely on grepping for `(nil chan)` to find nil-induced leaks.

---

## `closechan` and the Panic Path

From `runtime/chan.go`:

```go
func closechan(c *hchan) {
    if c == nil {
        panic(plainError("close of nil channel"))
    }
    lock(&c.lock)
    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("close of closed channel"))
    }
    // ... mark closed, wake all waiters ...
}
```

The nil check is the first thing. `panic(plainError(...))` raises a runtime error. The string `"close of nil channel"` is hardcoded in the runtime.

The asymmetry with send/receive — *panic instead of block* — is deliberate. There is no useful "wait" semantics for close: you cannot "wait until the channel exists." The operation is unambiguously a bug.

`plainError` is a special panic type used by the runtime for messages that should not capture a stack frame the way user-code panics do. It implements `error` and `runtime.Error`, allowing `errors.As`/`errors.Is` to match it.

### Recovering from close-nil

A `recover()` in a deferred function inside the same goroutine catches the panic:

```go
func safeClose(ch chan int) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("%v", r)
        }
    }()
    close(ch)
    return nil
}
```

This works because `panic(plainError("close of nil channel"))` is a normal Go panic. The recovery is the same as for any other panic.

Idiomatically, prefer guard:

```go
if ch != nil { close(ch) }
```

Hides nothing, allocates nothing.

---

## How `select` Encodes Nil Cases

The compiler translates a `select` statement into a call to `runtime.selectgo`. The signature:

```go
func selectgo(cas0 *scase, order0 *uint16, pc0 *uintptr, nsends, nrecvs int, block bool) (int, bool)
```

The compiler builds an array of `scase` structs, one per case:

```go
type scase struct {
    c    *hchan         // channel
    elem unsafe.Pointer // data element (send source or receive destination)
}
```

For a nil-channel case, `c == nil`. The same scase is passed to `selectgo` as for a non-nil case.

### `pollorder` and `lockorder`

`selectgo` builds two index arrays:

- `pollorder` — a random permutation of case indices, used to fairly poll cases for readiness.
- `lockorder` — case indices sorted by channel pointer, used to lock channels in a deterministic order to prevent deadlock between concurrent selects.

For nil channels, the implementation has a key shortcut: in `lockorder`, nil channels are still included, but `selparkcommit` does not enqueue the goroutine on their waitq (because there is no waitq). In `pollorder`, the nil channels are polled but the readiness check fails (no buffer, no waiters), so they appear "not ready."

From the source (paraphrased):

```go
for _, casei := range pollorder {
    casi := int(casei)
    cas = &scases[casi]
    c = cas.c
    if c == nil {
        continue // nil case is never ready
    }
    // ... normal readiness check ...
}
```

After polling all cases and finding none ready, `selectgo` proceeds to park the goroutine on the active cases' waitqs. Nil cases are again skipped:

```go
for _, casei := range lockorder {
    casi := int(casei)
    cas = &scases[casi]
    c = cas.c
    if c == nil {
        continue
    }
    // ... enqueue this goroutine on c.recvq or c.sendq ...
}
```

The goroutine is enqueued only on the non-nil channels. Wake-up happens when any of those channels makes progress. If *all* channels in the select are nil (and no default), the goroutine is enqueued on nothing and parks via the deadlock fallback.

### The all-nil case

When every channel in a `select` is nil and there is no `default`:

```go
var a, b chan int
select {
case <-a:
case <-b:
}
```

`selectgo` ends up enqueueing the goroutine on zero waitqs. The runtime treats this similarly to a direct nil-channel send/receive: `gopark` with a wait reason. The wait reason in this case is `waitReasonSelectNoCases` if no cases existed at all, or `waitReasonSelect` if there were cases (even though they were all nil).

The deadlock detector (`checkdead`) eventually sees the goroutine parked with no chance of wakeup and fires "all goroutines are asleep" — but only if every other goroutine is also parked.

---

## `gopark` and Wait Reasons

The `waitReason` enum lives in `runtime/runtime2.go`. Excerpt:

```go
const (
    waitReasonZero waitReason = iota
    waitReasonGCAssistMarking
    // ...
    waitReasonChanReceiveNilChan
    waitReasonChanSendNilChan
    waitReasonChanSend
    waitReasonChanReceive
    waitReasonSelect
    waitReasonSelectNoCases
    // ...
)
```

Each constant has a string representation in a map `waitReasonStrings`, used when formatting goroutine stacks. The `(nil chan)` suffix you see in pprof comes from `waitReasonChanSendNilChan.String()` returning `"chan send (nil chan)"`.

### Why a separate wait reason?

The runtime could have used `waitReasonChanSend` for both initialised and nil channels. The separate reason exists for diagnostics. The choice was made because:

1. Production debugging benefits from a clear marker for "this is impossible to unstick."
2. The runtime's own deadlock detector uses the wait reason in its decision logic — although the practical effect is small because `chan send` is also "impossible to unstick" from the goroutine's perspective if no one ever receives.

### Wait reasons in trace events

The Go execution tracer (`runtime/trace`) records wait reasons in block events. A trace inspection (`go tool trace`) shows "blocked on chan (nil chan)" as a distinct visual category. For production traces collected via `runtime/trace.Start`, you can filter to nil-channel blocks specifically.

---

## Deadlock Detection and Nil Channels

The runtime's deadlock detector lives in `checkdead` (`runtime/proc.go`):

```go
func checkdead() {
    // ...
    if grunning == 0 {
        // ... format "all goroutines are asleep - deadlock!" ...
    }
    // ...
}
```

`grunning` is the number of goroutines that are in a "can possibly make progress" state. The runtime considers a goroutine "running" if it is `_Grunnable`, `_Grunning`, `_Gsyscall`, etc. Goroutines parked via `gopark` are not counted.

For a nil-channel-only program, `grunning` is 0 (the main goroutine is parked), and the runtime prints:

```
fatal error: all goroutines are asleep - deadlock!

goroutine 1 [chan receive (nil chan)]:
main.main()
    /app/main.go:5 +0x...
```

### The detector does *not* fire on partial nil waits

If your program has 100 goroutines doing useful work and 1 goroutine stuck on a nil channel, the detector does not fire. `grunning >= 1`, so the runtime concludes "everything is fine." The leaked goroutine is silent.

This is the production gotcha: **the deadlock detector is a development aid, not a production safety net**. You cannot rely on it to surface nil-channel leaks under real load. Use pprof, leak detectors, and goroutine count monitoring.

### What about background runtime goroutines?

The detector accounts for them: sysmon, GC workers, and the finalizer goroutine are not counted as "user runnable." The check is specifically whether *user* goroutines can make progress.

---

## Interaction with the Race Detector

The race detector (`go run -race`, `go test -race`) instruments memory accesses and reports unsynchronised access. It interacts with nil channels in two ways:

1. **The variable holding the channel pointer.** If goroutine A writes `ch = nil` and goroutine B reads `ch` in a `select`, the race detector flags it. The mutation must be synchronised (mutex, atomic, or single-goroutine ownership).

2. **The channel's contents.** Sends and receives on a non-nil channel establish happens-before relationships. Sends and receives on a nil channel never complete, so they establish no relationships. A goroutine parked on a nil channel does not synchronise with anything — its captured state is "frozen" in the moment it parked.

The race detector's treatment of nil channels is the same as for any unreachable code path: it instruments the access but never observes a completion, so no relationship is recorded.

### Race on the variable, not on the operation

```go
var ch chan int

go func() {
    ch = make(chan int)  // write
}()

go func() {
    <-ch                 // read of ch's value, then operation on whatever ch was
}()
```

The race detector flags the read of `ch` in goroutine 2 against the write in goroutine 1. Even though the receive operation is safe regardless of whether `ch` is nil or initialised, the variable itself is racy. Fix: synchronise the assignment (sync.Once, atomic.Pointer).

---

## Compiler Treatment of Nil-Receive in `for ... range`

A `for v := range ch` loop is compiled to roughly:

```go
for {
    v, ok := <-ch
    if !ok {
        break
    }
    // body
}
```

When `ch` is nil, the receive blocks the goroutine on the very first iteration. There is no "skip" — the compiler does not insert a nil check. This is consistent with the runtime's "nil = block forever" semantics.

A particularly subtle bug:

```go
func emitIfActive(active bool) chan int {
    if !active {
        return nil
    }
    ch := make(chan int)
    go produce(ch)
    return ch
}

for v := range emitIfActive(false) {
    // never runs; goroutine blocks forever
}
```

The function returns nil; the caller's `range` blocks on the first receive. The compiler does not protect against this. The caller must defend with:

```go
ch := emitIfActive(false)
if ch == nil {
    return
}
for v := range ch {
    // ...
}
```

Or use a `select` with `default`:

```go
ch := emitIfActive(false)
for {
    select {
    case v, ok := <-ch:
        if !ok { return }
        // ...
    case <-ctx.Done():
        return
    }
}
```

---

## Reading the Runtime Source

To explore nil-channel handling in the runtime, key files:

| File | Purpose |
|---|---|
| `runtime/chan.go` | `chansend`, `chanrecv`, `closechan`, `hchan` type |
| `runtime/select.go` | `selectgo`, `scase`, `pollorder`/`lockorder` arrays |
| `runtime/runtime2.go` | `waitReason` enum, `g`/`m`/`p` types |
| `runtime/proc.go` | `gopark`, `goready`, `checkdead` |
| `runtime/trace.go` | trace event recording for blocks |

A productive trace:

1. Open `runtime/chan.go`, find `chansend`, read the `c == nil` branch.
2. Follow `gopark`'s third argument: `waitReasonChanSendNilChan`.
3. Open `runtime/runtime2.go`, search for `waitReasonChanSendNilChan` to find the enum value and the corresponding string.
4. Open `runtime/proc.go`, find `gopark` and read what happens when `unlockf == nil` and `lock == nil`.
5. Follow the goroutine state transition: `casgstatus(gp, _Grunning, _Gwaiting)`.

You will see that the entire mechanism is: change state to `_Gwaiting`, schedule another goroutine, and the parked goroutine simply never gets re-added to a runqueue because no one will ever call `goready` on it.

### Useful experiments

- **Print all `chansend` nil-branch invocations** by patching the runtime source to log. Useful for catching every place your program hits this path.
- **Trace a `select` execution** with `GODEBUG=schedtrace=1000` to see when goroutines park and unpark.
- **Inspect `select` compilation** with `go tool compile -S mycode.go` to see the calls to `runtime.selectgo`.

### Design rationale (from commit history and proposals)

The nil-channel semantics were established in the earliest Go versions and have not changed. The rationale appears in the Go FAQ and in Rob Pike's talks: nil-channel-in-`select` provides a clean way to dynamically disable cases, which was considered preferable to introducing flags or restructuring loops. The forever-block on direct nil send/receive is a consequence of treating "no channel" and "channel with no progress" symmetrically — the runtime has one code path.

---

## Summary

At the runtime level, nil channels are not a special case — they are *the absence of an `hchan`*. The runtime entry points (`chansend`, `chanrecv`, `closechan`) all begin with `if c == nil` and route to either a forever-park (`gopark` with no unlock function) or a panic (`close`).

The `select` statement integrates nil channels via `selectgo`: nil cases are present in the `scase` array but are skipped during polling and locking. The goroutine parks on the non-nil channels; if none, it parks with no waitq association and depends on the deadlock detector or external cancellation to ever wake.

The wait reasons `waitReasonChanSendNilChan` and `waitReasonChanReceiveNilChan` give production diagnostics a clear marker. pprof, `runtime.Stack`, and the execution tracer all surface the `(nil chan)` suffix.

The deadlock detector (`checkdead`) fires only when *every* user goroutine is parked. Nil-channel leaks under load are silent — production observability is the only defence.

Three key insights:

1. **Nil = no `hchan`**. The runtime has one code path; nil is handled with explicit branches.
2. **`gopark(nil, nil, reason, ...)`** is the technical mechanism for "block forever." No waitq, no unlock function, no possible wake.
3. **`select` is fair to nil cases**. They consume one comparison per iteration but never fire; the runtime keeps things symmetric.

The specification level documents the formal Go spec text for nil channels and the references to the language specification, memory model, and runtime contracts.
