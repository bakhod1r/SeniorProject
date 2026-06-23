# Memory Fences — Find the Bug

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Bug 1 — The Missing Atomic Flag](#bug-1--the-missing-atomic-flag)
3. [Bug 2 — Hoisted Loop Read](#bug-2--hoisted-loop-read)
4. [Bug 3 — Mixed Atomic and Non-Atomic](#bug-3--mixed-atomic-and-non-atomic)
5. [Bug 4 — Half-Constructed Publication](#bug-4--half-constructed-publication)
6. [Bug 5 — Re-reading the Same Snapshot](#bug-5--re-reading-the-same-snapshot)
7. [Bug 6 — TSO Hides the Reorder on x86](#bug-6--tso-hides-the-reorder-on-x86)
8. [Bug 7 — The `runtime.Gosched()` "Fence"](#bug-7--the-runtimegosched-fence)
9. [Bug 8 — Race Through the Cgo Boundary](#bug-8--race-through-the-cgo-boundary)
10. [Bug 9 — Wrong Acquire Pairing](#bug-9--wrong-acquire-pairing)
11. [Bug 10 — Stale Pointer in Lock-Free Stack](#bug-10--stale-pointer-in-lock-free-stack)
12. [Bug 11 — `unsafe.Pointer` Skips the Fence](#bug-11--unsafepointer-skips-the-fence)
13. [Bug 12 — 32-bit Alignment Trap](#bug-12--32-bit-alignment-trap)
14. [Bug 13 — Atomic Load Outside the Loop](#bug-13--atomic-load-outside-the-loop)
15. [Bug 14 — Two-Step Initialisation Race](#bug-14--two-step-initialisation-race)
16. [Bug 15 — Reordered Stop Sequence](#bug-15--reordered-stop-sequence)
17. [Summary](#summary)

---

## How to Use This File

Each bug is presented as a real-looking code snippet with a problem. Read the code, try to spot the bug, then read the fix. The bugs are sorted roughly by difficulty: bug 1 is something a junior should catch instantly; bug 15 is a senior-level reordering issue.

For each bug:

- The "buggy" version is what someone actually shipped or proposed.
- The "fix" version is the minimal correct change.
- The "explanation" is what to look for next time.

Many of these bugs are race-detector-catchable. Treat the race detector as your first line of defence.

---

## Bug 1 — The Missing Atomic Flag

**Buggy code.**

```go
var ready bool
var data int

func main() {
    go func() {
        data = 42
        ready = true
    }()

    for !ready {
    }
    fmt.Println(data)
}
```

**The bug.** Both `ready` and `data` are accessed concurrently without atomics or any other synchronisation. The compiler may keep `ready` in a register and loop forever; the CPU on ARM may see `ready == true` while `data` is still 0; the race detector reports two races.

**Fix.**

```go
var ready atomic.Bool
var data int // still non-atomic — see explanation

func main() {
    go func() {
        data = 42
        ready.Store(true)
    }()

    for !ready.Load() {
    }
    fmt.Println(data)
}
```

**Explanation.** The atomic store/load gives a release/acquire edge. The non-atomic `data` write happens-before the atomic store; the atomic load happens-before the print. Transitivity makes the print safe. Only `ready` needs to be atomic; the protocol ensures `data` is only read after `ready` is true.

---

## Bug 2 — Hoisted Loop Read

**Buggy code.**

```go
type Worker struct {
    stop bool
}

func (w *Worker) Run() {
    for !w.stop {
        // do work
    }
}

func (w *Worker) Stop() {
    w.stop = true
}
```

**The bug.** Even if `Stop()` runs, the compiler is allowed to hoist `w.stop` out of the loop and keep it in a register. `Run()` never sees the update. No race detector report on x86 if you do not run the test under enough contention to catch the issue.

**Fix.**

```go
type Worker struct {
    stop atomic.Bool
}

func (w *Worker) Run() {
    for !w.stop.Load() {
        // do work
    }
}

func (w *Worker) Stop() {
    w.stop.Store(true)
}
```

**Explanation.** Atomic load on every iteration. The fence forces the CPU and the compiler to re-fetch the variable each time. Cost: a few nanoseconds per iteration — invisible against any real work the worker does.

---

## Bug 3 — Mixed Atomic and Non-Atomic

**Buggy code.**

```go
var counter atomic.Int64

func incrementAndStore() {
    n := counter.Load()
    counter.Add(1)
    *(*int64)(unsafe.Pointer(&counter)) = n + 1 // direct write
}
```

**The bug.** The direct unsafe write bypasses the atomic API. The race detector cannot see it; the compiler treats it as a plain store. Two goroutines calling this function will corrupt the counter.

**Fix.**

```go
var counter atomic.Int64

func incrementAndStore() {
    counter.Add(1)
}
```

**Explanation.** Never mix atomic and non-atomic access to the same variable. The unsafe trick to "speed up" access is always wrong — the few cycles saved are not worth the corruption.

---

## Bug 4 — Half-Constructed Publication

**Buggy code.**

```go
type Cache struct {
    entries map[string]int
}

var cache atomic.Pointer[Cache]

func reload() {
    c := &Cache{entries: make(map[string]int)}
    cache.Store(c) // publish empty
    c.entries["foo"] = 1
    c.entries["bar"] = 2
}
```

**The bug.** The cache is published before it is filled. Readers between the `Store` and the population see an empty cache. The fence does its job — the empty cache is correctly published — but the protocol is wrong.

**Fix.**

```go
type Cache struct {
    entries map[string]int
}

var cache atomic.Pointer[Cache]

func reload() {
    c := &Cache{entries: map[string]int{"foo": 1, "bar": 2}}
    cache.Store(c) // publish complete
}
```

**Explanation.** Build first, publish second. Always make the published value immutable from the moment of `Store`. If you need mutability, use a different pattern (a snapshot per writer, or a mutex around the writer).

---

## Bug 5 — Re-reading the Same Snapshot

**Buggy code.**

```go
var config atomic.Pointer[Config]

func handleRequest(r *http.Request) {
    if config.Load().LogRequests {
        log.Println(r)
    }
    if config.Load().AuthRequired {
        auth(r)
    }
    timeout := config.Load().Timeout
    // ...
}
```

**The bug.** Three loads, three potentially different `Config` snapshots. Between the load for `LogRequests` and the load for `AuthRequired`, a reload may have stored a new config. The handler now uses a mixture of old and new values.

**Fix.**

```go
func handleRequest(r *http.Request) {
    cfg := config.Load()
    if cfg.LogRequests {
        log.Println(r)
    }
    if cfg.AuthRequired {
        auth(r)
    }
    timeout := cfg.Timeout
    // ...
}
```

**Explanation.** Load the snapshot once per request. Atomic loads are cheap but they are not consistent across multiple calls — by design. Use one load and pass the result around.

---

## Bug 6 — TSO Hides the Reorder on x86

**Buggy code.**

```go
type Token struct {
    Value string
    Ready bool
}

var current *Token

func publish(v string) {
    t := &Token{Value: v}
    current = t // plain assignment
    t.Ready = true
}

func consume() string {
    t := current
    if t != nil && t.Ready {
        return t.Value
    }
    return ""
}
```

**The bug.** `current = t` and `t.Ready = true` can be reordered on ARM. Even on x86, the compiler can reorder them. A consumer may see `current != nil` and `t.Ready == true` while `t.Value` is still uninitialised — wait, that one is fine because `Value` was set in the constructor. The real bug: `current = t` is non-atomic, so a consumer may see a torn pointer on a 32-bit ARM platform.

**Fix.**

```go
var current atomic.Pointer[Token]

func publish(v string) {
    t := &Token{Value: v, Ready: true}
    current.Store(t)
}

func consume() string {
    t := current.Load()
    if t != nil && t.Ready {
        return t.Value
    }
    return ""
}
```

**Explanation.** Atomic pointer publication. Build the entire struct before the atomic store; readers see a fully formed object or nil. On x86 the original may "work" because TSO masks pointer reordering, but on ARM it fails.

---

## Bug 7 — The `runtime.Gosched()` "Fence"

**Buggy code.**

```go
var data int
var ready bool

go func() {
    data = 42
    runtime.Gosched() // "make sure data is published"
    ready = true
}()

for !ready {
}
fmt.Println(data)
```

**The bug.** `runtime.Gosched()` is a scheduling hint, not a memory fence. It yields the goroutine to the scheduler, but it does not establish memory ordering. The compiler may still reorder; the CPU may still reorder; the race detector reports both `data` and `ready`.

**Fix.** As in Bug 1 — use atomics. There is no "yield for ordering" idiom in Go.

**Explanation.** Scheduling and memory ordering are orthogonal. Yields and sleeps do not synchronise memory. Only the explicit synchronisation primitives (atomics, mutexes, channels, `sync.Once`, `sync.WaitGroup`) do.

---

## Bug 8 — Race Through the Cgo Boundary

**Buggy code.**

```c
// stub.c
static int flag = 0;
void c_set_flag(void) { flag = 1; } // plain assignment
int c_get_flag(void) { return flag; }
```

```go
/*
#include "stub.h"
*/
import "C"

func main() {
    go func() { C.c_set_flag() }()
    for C.c_get_flag() == 0 {
    }
}
```

**The bug.** The C code uses plain assignment and plain read — no atomic, no fence. The Go side cannot supply synchronisation that the C side did not establish. On weak hardware, the Go reader may loop forever.

**Fix.** Change the C side to use atomics:

```c
#include <stdatomic.h>
static _Atomic int flag = 0;
void c_set_flag(void) { atomic_store_explicit(&flag, 1, memory_order_seq_cst); }
int c_get_flag(void) { return atomic_load_explicit(&flag, memory_order_seq_cst); }
```

**Explanation.** Both sides of the Cgo boundary need to use compatible atomics. If you control the C code, use C11 `_Atomic` types or GCC `__atomic_*` builtins. If you do not control the C code, wrap the API and document the assumptions.

---

## Bug 9 — Wrong Acquire Pairing

**Buggy code.**

```go
type Pair struct {
    Left  int
    Right int
}

var p atomic.Pointer[Pair]
var leftReady atomic.Bool

func writer() {
    pp := &Pair{Left: 1, Right: 2}
    p.Store(pp)
    leftReady.Store(true)
}

func reader() {
    for !leftReady.Load() {
    }
    pp := p.Load() // is this guaranteed to be non-nil?
    fmt.Println(pp.Left, pp.Right)
}
```

**The bug.** This actually works in Go because both atomics are seq_cst. The `leftReady` store happens after the `p.Store` in program order, and seq_cst preserves program order globally. So by the time the reader sees `leftReady == true`, it must also see `p != nil`.

In C++ with `memory_order_release` on `leftReady` and `memory_order_acquire` on the load, this is still correct because release/acquire on the same variable creates a happens-before edge, and the previous store to `p` was sequenced-before the release. In C++ with `memory_order_relaxed`, it breaks.

**Lesson.** In Go, the global seq_cst order saves you. Do not rely on this if you are porting from a language with weaker orderings — verify the original was correct, do not just translate the atomics literally.

---

## Bug 10 — Stale Pointer in Lock-Free Stack

**Buggy code.**

```go
type node struct {
    value int
    next  *node // plain pointer
}

type Stack struct {
    head atomic.Pointer[node]
}

func (s *Stack) Push(v int) {
    n := &node{value: v}
    for {
        old := s.head.Load()
        n.next = old // plain write
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}
```

**The bug.** The write to `n.next` is plain. Another goroutine that reads `head` via `Load` and dereferences `head.next` will get a non-atomic read. On weak hardware the reader may see the new `head` but stale data in `n.next`.

**Fix.**

```go
type node struct {
    value int
    next  atomic.Pointer[node]
}

func (s *Stack) Push(v int) {
    n := &node{value: v}
    for {
        old := s.head.Load()
        n.next.Store(old)
        if s.head.CompareAndSwap(old, n) {
            return
        }
    }
}
```

**Explanation.** The new node has not yet been published; `n.next` is local. But once the CAS succeeds, the node is published, and any subsequent reader of `head` who dereferences `next` is reading shared state. Make `next` atomic from the start.

In practice, the CAS that publishes the node is a release fence, so the prior write to `n.next` is visible to a subsequent acquire-loading consumer. But a consumer who reads `head` and then walks the list without atomic loads on each `next` field has a problem if any other thread later modifies that `next`. Treiber's stack is read-only on `next` from any node once it is in the stack, so the plain pointer may actually be safe — but the rule of thumb is to make every shared field atomic.

---

## Bug 11 — `unsafe.Pointer` Skips the Fence

**Buggy code.**

```go
type Box struct {
    val int64
}

var box unsafe.Pointer // *Box

func publish() {
    b := &Box{val: 42}
    atomic.StorePointer(&box, unsafe.Pointer(b))
}

func read() int64 {
    b := (*Box)(atomic.LoadPointer(&box))
    return b.val // plain read
}
```

**The bug.** The pointer load is fenced; the field read is not. On ARM, the dereference may load stale data from the cache before the cache coherence protocol has settled. Wait — actually the publish wrote the value before the atomic store, so the release fence on the store guarantees the field is visible. This particular example is correct.

**The actual bug pattern.** If the writer modifies `b.val` after publication, those modifications are racy with readers. Example:

```go
func publish() {
    b := &Box{val: 42}
    atomic.StorePointer(&box, unsafe.Pointer(b))
    b.val = 43 // RACE — readers may see 42 or 43 or some intermediate
}
```

**Fix.** Treat published structs as immutable. If you need to update, publish a new struct.

**Explanation.** The release fence publishes whatever existed before it. Anything you do after is a race against readers who have already obtained the pointer.

---

## Bug 12 — 32-bit Alignment Trap

**Buggy code.**

```go
type Stats struct {
    misc   bool
    count  int64 // misaligned on 32-bit
}
```

**The bug.** On 32-bit platforms (`GOARCH=386`, `arm`), `int64` access via `atomic.AddInt64` requires 8-byte alignment. The `misc bool` pushes `count` to offset 1 (or after padding, possibly offset 4) — not 8. The atomic call panics on those platforms.

**Fix 1.** Put the 64-bit field first.

```go
type Stats struct {
    count int64
    misc  bool
}
```

**Fix 2.** Use the typed atomic API, which the runtime aligns correctly.

```go
type Stats struct {
    misc  bool
    count atomic.Int64 // guaranteed correctly aligned
}
```

**Explanation.** Pre-Go-1.19 atomics on raw `int64` had the alignment problem. The typed API (`atomic.Int64`) solves it. Always prefer the typed API.

---

## Bug 13 — Atomic Load Outside the Loop

**Buggy code.**

```go
var ready atomic.Bool

func waitForReady() {
    r := ready.Load()
    for !r {
        runtime.Gosched()
    }
}
```

**The bug.** The load happens once, before the loop. The loop spins on the local `r`, which never changes. Infinite loop if `ready` was false initially.

**Fix.**

```go
func waitForReady() {
    for !ready.Load() {
        runtime.Gosched()
    }
}
```

**Explanation.** The atomic load must be inside the loop body — every iteration re-fetches. Pulling it outside defeats the purpose; the fence happens once, the spin happens infinitely.

---

## Bug 14 — Two-Step Initialisation Race

**Buggy code.**

```go
var (
    initialized atomic.Bool
    value       *Resource
)

func get() *Resource {
    if !initialized.Load() {
        value = build()
        initialized.Store(true)
    }
    return value
}
```

**The bug.** Two goroutines can both observe `initialized == false`, both call `build()`, and both write to `value`. The atomic flag flip happens after `build()` returns, so it does not protect the construction. The result depends on which write to `value` wins.

**Fix.** Use `sync.Once`:

```go
var (
    once  sync.Once
    value *Resource
)

func get() *Resource {
    once.Do(func() { value = build() })
    return value
}
```

**Explanation.** A single atomic does not protect a compound operation. `sync.Once` is implemented with a CAS-protected slow path that serialises the construction. Always reach for it when you have a "build once, use forever" pattern.

---

## Bug 15 — Reordered Stop Sequence

**Buggy code.**

```go
type Server struct {
    listener net.Listener
    done     chan struct{}
}

func (s *Server) Stop() {
    close(s.done)
    s.listener.Close()
}

func (s *Server) Serve() {
    for {
        conn, err := s.listener.Accept()
        if err != nil {
            select {
            case <-s.done:
                return
            default:
                log.Println(err)
            }
        }
        go s.handle(conn)
    }
}
```

**The bug.** Subtle but real. Close `done` first, then close the listener. The `Accept` returns with an error. The `select` checks `done` — which has been closed — and returns cleanly. Looks fine.

But: what if `Accept` returns a connection right before `Close` runs? The check `if err != nil` is false, so the code spawns a handler. The handler runs against a server that thinks it is shutting down. Now you have a handler that uses resources the shutdown is tearing down.

**Fix.** Use an atomic flag and check it after each `Accept` regardless of error:

```go
type Server struct {
    listener net.Listener
    done     chan struct{}
    stopped  atomic.Bool
}

func (s *Server) Stop() {
    s.stopped.Store(true)
    close(s.done)
    s.listener.Close()
}

func (s *Server) Serve() {
    for {
        conn, err := s.listener.Accept()
        if s.stopped.Load() {
            if conn != nil {
                conn.Close()
            }
            return
        }
        if err != nil {
            log.Println(err)
            continue
        }
        go s.handle(conn)
    }
}
```

**Explanation.** The bug is not strictly about fence semantics — the operations are individually correct. The bug is about ordering between two channels and a TCP listener. The atomic flag provides a single source of truth checked after every `Accept`.

---

## Summary

The bugs in this file fall into three families:

1. **Missing fence.** A shared variable is accessed without any synchronisation. The race detector catches most of these. Fix: use `atomic.*` or a mutex.
2. **Wrong fence pairing.** The fence is on the wrong variable, in the wrong order, or paired with weaker semantics on the other side (notably across Cgo). Fix: make every shared piece atomic; document protocols at boundaries.
3. **Right fence, wrong protocol.** The atomic call is correct, but the program logic puts the writes in the wrong order, reads the same snapshot twice, or hoists the load out of a loop. Fix: think about the data flow as a sequence of fence-separated phases.

Run every concurrent test under `-race`. Run them on ARM in CI if you deploy on ARM. Treat any race report as a P0 bug, even if it only fires once in a million runs — the absence of a fence today is the corruption of tomorrow on a new architecture.
