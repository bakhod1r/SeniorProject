# Observer Pattern — Under the Hood

## 1. What this level covers

Junior taught the shape; middle added concurrency, generics, and async patterns. Professional is what happens *underneath* the Observer pattern at the Go runtime and compiler level:

- Channel internals (`hchan`, `sudog`, recv/send queues).
- Goroutine scheduling during fan-out notifications.
- `sync.RWMutex` internals — reader counting, writer starvation prevention.
- Memory order semantics for observer list updates.
- Copy-on-write subscriber lists via `atomic.Pointer`.
- `select` statement compilation.
- `close(chan)` broadcast semantics.
- Escape analysis for observer closures.
- Assembly for a typical notify loop.

Anchored at Go 1.22, amd64. Runtime details (especially around channels and the scheduler) shift between versions — verify against `go version`.

---

## 2. Table of Contents

1. [What this level covers](#1-what-this-level-covers)
2. [Table of Contents](#2-table-of-contents)
3. [The `hchan` struct](#3-the-hchan-struct)
4. [Channel send/recv at the runtime level](#4-channel-sendrecv-at-the-runtime-level)
5. [Goroutine scheduling during fan-out](#5-goroutine-scheduling-during-fan-out)
6. [`sync.RWMutex` internals](#6-syncrwmutex-internals)
7. [Memory order in observer list updates](#7-memory-order-in-observer-list-updates)
8. [Copy-on-write via `atomic.Pointer`](#8-copy-on-write-via-atomicpointer)
9. [`select` compilation](#9-select-compilation)
10. [`close(chan)` broadcast semantics](#10-closechan-broadcast-semantics)
11. [Escape analysis for closures](#11-escape-analysis-for-closures)
12. [Assembly for notify loop](#12-assembly-for-notify-loop)
13. [Benchmarks](#13-benchmarks)
14. [Tricky questions](#14-tricky-questions)
15. [Further reading](#15-further-reading)

---

## 3. The `hchan` struct

Every Go channel is backed by `runtime.hchan` (`src/runtime/chan.go`):

```go
type hchan struct {
    qcount   uint           // number of items currently queued
    dataqsiz uint           // size of the buffer (0 = unbuffered)
    buf      unsafe.Pointer // pointer to the circular buffer
    elemsize uint16
    closed   uint32
    elemtype *_type         // type descriptor
    sendx    uint           // send index
    recvx    uint           // receive index
    recvq    waitq          // list of recv-waiting goroutines
    sendq    waitq          // list of send-waiting goroutines
    lock     mutex
}
```

For Observer use cases, the two queues (`recvq`, `sendq`) are the interesting part. When a notify-via-channel happens, the sender's payload goes through one of three paths:

1. **Direct delivery** — there's a goroutine already waiting in `recvq`. The runtime hands the value over, no copy into the buffer.
2. **Buffered enqueue** — `qcount < dataqsiz`. The value lands in `buf[sendx]`, `sendx` advances.
3. **Blocking send** — buffer full, no recv waiting. The sending goroutine is parked into `sendq`.

For a one-to-many fan-out, having M receivers each blocked in `recvq` makes notification cheap: each `ch <- event` immediately wakes one receiver.

---

## 4. Channel send/recv at the runtime level

The `ch <- v` statement compiles to `runtime.chansend1(ch, &v)`. The body of `chansend`:

1. Acquire `c.lock`.
2. If `c.closed != 0` → panic.
3. If `c.recvq` is non-empty → dequeue a waiter, copy `v` to the waiter's slot, wake the waiter, release lock.
4. Else if `qcount < dataqsiz` → copy `v` to `buf[sendx]`, advance `sendx`, increment `qcount`, release lock.
5. Else → enqueue current goroutine to `sendq`, park.

Recv (`<-ch`) is symmetric: check `sendq`, then buffer, then park.

The cost of an Observer notification per receiver:
- Lock acquire/release.
- One copy (sender → receiver slot or buffer slot).
- If receiver was parked, one wake (rescheduling).

Total: ~100-200 ns per receiver on amd64. For 100 observers, that's 10-20 µs per event. Acceptable for moderate-rate notifications; expensive for million-event-per-second workloads.

---

## 5. Goroutine scheduling during fan-out

For an asynchronous observer pattern with per-observer goroutines:

```go
for _, obs := range observers {
    go obs.Notify(event)
}
```

Each `go obs.Notify(event)` allocates a new goroutine (or reuses one from the pool):

- `runtime.newproc` is called per `go` statement.
- The new goroutine is placed on the current P's local run queue.
- The scheduler picks it up when the current goroutine yields or blocks.

The cost: ~200-300 ns per goroutine creation. For 100 observers, ~30 µs in scheduling overhead alone.

For very high QPS, this overhead dominates. Alternatives:

- **Synchronous notification** — call each observer in the same goroutine. No scheduling, but slow observers block all others.
- **Worker pool** — a fixed set of goroutines drain from a work queue. Trades work creation cost for queue contention.
- **Batched notifications** — collect events, dispatch in batches.

---

## 6. `sync.RWMutex` internals

The observer list is read-heavy: many goroutines read the subscriber slice, few mutate it. `sync.RWMutex` is the typical choice.

```go
// src/sync/rwmutex.go
type RWMutex struct {
    w           Mutex  // held if there are pending writers
    writerSem   uint32 // semaphore for writers to wait for readers
    readerSem   uint32 // semaphore for readers to wait for writer
    readerCount atomic.Int32
    readerWait  atomic.Int32
}
```

- **RLock fast path:** atomic increment of `readerCount`. If positive (no pending writer), the lock is acquired with no contention.
- **RLock slow path:** if `readerCount` is negative, a writer is pending — block on `readerSem`.
- **Lock (writer):** acquire `w` (writer-exclusive mutex), atomically subtract a large value from `readerCount` to signal "no new readers", wait for active readers to finish.
- **Unlock:** atomic addition; if there were waiting writers, wake them.

Writer starvation prevention: once a writer is waiting, new readers are blocked. This means RWMutex is *fair* — important for an observer system where notifications might otherwise stall list updates indefinitely.

The cost: ~10 ns for an uncontended RLock; up to microseconds when contended.

---

## 7. Memory order in observer list updates

A subtle bug:

```go
type Observer struct {
    handlers []func(Event)
}

func (o *Observer) Subscribe(h func(Event)) {
    o.handlers = append(o.handlers, h)  // race
}

func (o *Observer) Notify(e Event) {
    for _, h := range o.handlers {  // race
        h(e)
    }
}
```

Without synchronization, the slice's backing array may be reallocated during `append` while another goroutine reads. The reader might observe a partially-updated `handlers` slice header (old length, new array pointer, or vice versa).

Even with proper locking, *cache coherency* matters. Reads from one CPU's cache might lag behind writes from another. Go's memory model says: "a write to a variable is visible to another goroutine *if* both are synchronized via channels, mutexes, or atomics."

Practical implication: every observer list update must go through a synchronization primitive (`sync.Mutex`, `sync.RWMutex`, `atomic.Pointer`). Naked field access from multiple goroutines is undefined behavior — even if it "works" most of the time.

---

## 8. Copy-on-write via `atomic.Pointer`

For read-heavy observer lists, `atomic.Pointer[[]Observer]` outperforms RWMutex:

```go
type Subject struct {
    observers atomic.Pointer[[]Observer]
}

func (s *Subject) Subscribe(o Observer) {
    for {
        old := s.observers.Load()
        var next []Observer
        if old != nil {
            next = make([]Observer, len(*old)+1)
            copy(next, *old)
        } else {
            next = make([]Observer, 0, 1)
        }
        next = append(next, o)
        if s.observers.CompareAndSwap(old, &next) {
            return
        }
    }
}

func (s *Subject) Notify(e Event) {
    obs := s.observers.Load()
    if obs == nil { return }
    for _, o := range *obs {
        o.Notify(e)
    }
}
```

**Notify** is a single atomic load. No contention, no mutex.

**Subscribe** copies the slice and CAS-swaps the pointer. Under contention, the CAS may fail and retry — but the *readers* never wait.

Trade-offs:
- Each Subscribe allocates the full new slice. For 1000 subscribers, that's 1000 elements copied per Subscribe.
- Notify always loads the latest pointer; no risk of stale reads.

Use this pattern when reads dominate writes by ~100×. For balanced workloads, RWMutex is simpler.

---

## 9. `select` compilation

The `select` statement is the workhorse of channel-based observers:

```go
select {
case ev := <-events:
    handle(ev)
case <-done:
    return
}
```

The compiler lowers this to `runtime.selectgo` (`src/runtime/select.go`). The function:

1. Builds an array of `scase` structs (one per case).
2. Shuffles randomly to avoid bias.
3. Polls each case's channel — if any is ready, dispatch.
4. If none ready, parks the goroutine on *all* channels' wait queues.
5. When any channel becomes ready, wake up, dequeue from all wait queues, return.

Cost: ~50-100 ns for the polling loop; the random shuffle adds ~10 ns. Use `select` liberally — it's not a hot-path concern unless you have thousands of cases.

---

## 10. `close(chan)` broadcast semantics

A powerful pattern: broadcast cancellation by closing a shared channel.

```go
done := make(chan struct{})

// Many goroutines wait on done
for i := 0; i < 100; i++ {
    go func() {
        <-done  // blocks until done is closed
        cleanup()
    }()
}

close(done)  // wakes all 100 goroutines simultaneously
```

`close(chan)` semantics:
1. Acquire `c.lock`.
2. Set `c.closed = 1`.
3. Walk `c.recvq`, wake every waiting goroutine. Each receives the zero value (or buffered values, if any).
4. Walk `c.sendq` — if non-empty, panic (sending on closed channel).
5. Release `c.lock`.

The broadcast is *atomic* — all waiters see the close simultaneously. This is the basis of `context.Context.Done()` and many other Go cancellation patterns.

---

## 11. Escape analysis for closures

Observers stored as `func(Event)` are closures. Each closure is a pair (function pointer + captured-variables pointer). The captured variables can be:

- On the *stack* of the function that created the closure, if the closure doesn't outlive that function.
- On the *heap*, if the closure escapes.

For observer registration, the closure *always* escapes:

```go
func setup(s *Subject) {
    counter := 0
    s.Subscribe(func(e Event) {
        counter++
    })
}  // counter must outlive setup — heap allocate
```

`go build -gcflags="-m"` confirms: `counter escapes to heap`. The closure also escapes because it's stored in the observer list.

For high-frequency subscription patterns, this allocation cost matters. The fix is rarely "avoid closures" (which loses expressiveness); it's "reduce the rate of subscription churn".

---

## 12. Assembly for notify loop

A simple notify loop:

```go
func (s *Subject) Notify(e Event) {
    for _, obs := range s.observers {
        obs.Handle(e)
    }
}
```

Compiled (amd64, simplified):

```
TEXT (*Subject).Notify
    MOVQ s+0(FP), AX           ; s pointer
    MOVQ 8(AX), CX             ; len(observers)
    MOVQ 0(AX), DX             ; &observers[0]
    XORQ BX, BX                ; i = 0
loop:
    CMPQ BX, CX                ; i < len?
    JGE done
    MOVQ (DX)(BX*16), DI       ; observers[i].tab
    MOVQ 8(DX)(BX*16), SI      ; observers[i].data
    MOVQ e+8(FP), R8           ; event arg
    MOVQ 24(DI), R9            ; itab.fun[0] = Handle
    CALL R9                    ; indirect call
    INCQ BX
    JMP loop
done:
    RET
```

Each iteration:
- Load itab pointer (one memory access).
- Load data pointer (one memory access).
- Load function pointer from itab (one memory access).
- Indirect call.

~5 ns per iteration with cache hits. For 100 observers, 500 ns per notification.

---

## 13. Benchmarks

Measured on Go 1.22, amd64:

```
BenchmarkSyncMutexNotify-8     10000000   115 ns/op   0 B/op   0 allocs/op
BenchmarkRWMutexNotify-8       20000000    75 ns/op   0 B/op   0 allocs/op
BenchmarkAtomicPtrNotify-8     50000000    25 ns/op   0 B/op   0 allocs/op
BenchmarkChannelFanout-8        1000000  1850 ns/op   0 B/op   0 allocs/op
BenchmarkGoroutineNotify-8      1000000  3200 ns/op  96 B/op   2 allocs/op
```

(All with 10 observers; ns/op is per Notify call.)

**Observations:**
- `atomic.Pointer` is 3× faster than RWMutex for read-only access.
- Channel fan-out is 20× slower than direct synchronous notify, because of per-channel lock/wake.
- Per-goroutine notify adds another 1.5× over channel fan-out.

For high-rate workloads, prefer synchronous notification with copy-on-write list management.

---

## 14. Tricky questions

**Q1.** Why doesn't `close(chan)` panic when no one is listening?

<details><summary>Answer</summary>

`close(chan)` is fine on a channel with no receivers. The "panic on close" is for *sending on a closed channel*, not for closing without listeners. Closed channels simply emit the zero value on subsequent receives (and `ok=false` from the comma-ok form).

This is why `close(done)` for broadcast cancellation works — even if some goroutines aren't yet waiting, they'll observe the closed state when they do receive.
</details>

**Q2.** What happens if you `close()` a channel twice?

<details><summary>Answer</summary>

Panic. `close()` checks `c.closed` and panics if already set. To safely close-or-noop, use a mutex or `sync.Once`:

```go
var once sync.Once
once.Do(func() { close(c) })
```

This is a common pattern for "shutdown" channels that may be triggered from multiple paths.
</details>

**Q3.** Why is `atomic.Pointer` faster than RWMutex for read-heavy observer lists?

<details><summary>Answer</summary>

RWMutex's RLock involves:
- Atomic increment of `readerCount`.
- Memory barrier to ensure visibility.
- (Possibly) a system call to wait if a writer is pending.

`atomic.Pointer.Load()` is a single atomic load — no barrier beyond what the load itself provides, no contention with writers.

The trade-off: writers do more work (copy-on-write the entire slice). But for 100× more reads than writes, the read wins dominate.
</details>

**Q4.** A goroutine reads `len(s.observers)` without locking. Is it safe?

<details><summary>Answer</summary>

No. `len()` on a slice reads the slice header (length field). If another goroutine is appending and the header is updated mid-read, the reader may see a partial header — incorrect length, or worse, a length pointing past the actual backing array's end.

Even with `len()` returning a sensible value, a subsequent `range` over the slice reads the *current* header, which may have advanced.

The fix: hold a read lock (or use `atomic.Pointer` for the slice).
</details>

---

## 15. Further reading

- **`src/runtime/chan.go`** — channel implementation
- **`src/runtime/select.go`** — select statement runtime
- **`src/sync/rwmutex.go`** — RWMutex implementation
- **`src/sync/atomic/`** — atomic primitives
- **Go memory model** — https://go.dev/ref/mem
- **Russ Cox, "Bell Labs and CSP Threads"** — historical context for channels
- **Dave Cheney, "Concurrency made easy"** — talk on channel idioms

Channel-based Observer in Go is one of the highest-leverage runtime mechanisms in the language. Understanding what happens beneath `ch <- ev` and `select` separates application-level Go code from systems-level Go code.
