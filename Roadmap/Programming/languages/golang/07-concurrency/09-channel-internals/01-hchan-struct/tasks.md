# The `hchan` Struct — Tasks

[← Back to index](index.md)

## How to Use This Page

Each task is a self-contained exercise that pushes you to reproduce, instrument, or extend a piece of `hchan`. Hints and starting code are provided. Reference solutions are not — solving the tasks is the point.

Estimated time per task is listed in the heading. Work in order; later tasks build on earlier ones.

---

## Task 1 — Build a Toy `MiniChan[int]` for Buffered Sends (30 min)

Implement a tiny buffered integer channel using only `sync.Mutex` and `sync.Cond`. API:

```go
package mini

type MiniChan struct {
    // fill in
}

func New(capacity int) *MiniChan
func (c *MiniChan) Send(v int)
func (c *MiniChan) Recv() int
func (c *MiniChan) Close()
```

Requirements:

- `Send` blocks when the buffer is full.
- `Recv` blocks when the buffer is empty.
- `Close` makes subsequent `Recv` calls drain the buffer, then return zero. Subsequent `Send` panics.

Hint: use a slice as the buffer plus `qcount`, `sendx`, `recvx`, mirroring `hchan`. Use two `sync.Cond`s — one for "not full" and one for "not empty".

Validation: write a goroutine that sends 100 integers and another that receives them, asserting order.

Edge cases:
- Buffer of size 1.
- Many producers, one consumer.
- Close while producers are blocked (should panic them; one acceptable approach is to use `panic` after wake-up).

---

## Task 2 — Add Unbuffered Mode to `MiniChan` (30 min)

Extend Task 1 to support capacity 0 — the rendezvous semantics. Now `Send` cannot return until a `Recv` is ready to take the value.

Hint: keep a "current pending value" slot and a "receiver waiting" flag. `Send` checks for a waiting receiver; if present, hands off and returns. Otherwise sets the pending slot, signals "value pending", and waits for "value taken".

Edge case: multiple senders racing for one receiver — only one wins; the others must keep waiting.

Validation: a single channel of size 0 should rendezvous correctly when one sender and one receiver are present. Time the operation; it should be sub-microsecond on a modern laptop.

---

## Task 3 — Implement the Three Paths Explicitly (45 min)

Refactor your `MiniChan.Send` to clearly distinguish three code paths, mirroring `runtime.chansend`:

```go
func (c *MiniChan) Send(v int) {
    c.lock.Lock()

    if c.closed { c.lock.Unlock(); panic("send on closed") }

    // Path A: receiver waiting?
    if c.recvq.tryDequeue() { ... }

    // Path B: room in buffer?
    if c.qcount < c.dataqsiz { ... }

    // Path C: park.
    ...
}
```

Add a `tryDequeue` method to a `waitq` struct that returns whether it could pop a receiver. Use channel-of-channels or a slice of `chan int` as a FIFO of "blocked receivers".

Validation: instrument each path with a counter (`atomic.AddInt64`); after a benchmark, verify that all three paths fire under appropriate conditions.

---

## Task 4 — Measure the Cost of Each Path (30 min)

Write Go benchmarks:

```go
func BenchmarkMiniChanBufferedNoContention(b *testing.B) {
    c := mini.New(1024)
    for i := 0; i < b.N; i++ {
        c.Send(i)
        c.Recv()
    }
}

func BenchmarkMiniChanRendezvous(b *testing.B) {
    c := mini.New(0)
    done := make(chan struct{})
    go func() {
        for i := 0; i < b.N; i++ {
            c.Recv()
        }
        close(done)
    }()
    for i := 0; i < b.N; i++ {
        c.Send(i)
    }
    <-done
}
```

Run with `-benchmem` and `-cpuprofile`. Compare with the same benchmarks on the real Go channel.

Hint: expect your MiniChan to be 5–20x slower because `sync.Cond` is implemented atop `sync.Mutex`+notifyList, which is itself implemented atop the runtime — multiple layers of overhead. Real `hchan` uses the runtime mutex directly.

Validation: collect the numbers in a table. Identify the biggest source of overhead via `pprof`.

---

## Task 5 — Show `hchan` Memory Layout via `unsafe` (20 min)

You cannot reach inside the real `hchan` from user code (the type is unexported). But you can mimic it. Build a struct with the same field types and order:

```go
type hchanMirror struct {
    qcount   uint
    dataqsiz uint
    buf      unsafe.Pointer
    elemsize uint16
    closed   uint32
    elemtype unsafe.Pointer
    sendx    uint
    recvx    uint
    recvq    [2]unsafe.Pointer  // waitq is just first, last
    sendq    [2]unsafe.Pointer
    lock     uintptr
}
```

Print `unsafe.Sizeof(hchanMirror{})` and `unsafe.Offsetof(...)` for each field. Match against the source's `hchanSize`.

Validation: on amd64, total should be ~96 bytes. Fields with the same name in `runtime/chan.go` should match offsets within a few bytes (the runtime may reorder for alignment).

Hint: use `go run` to verify on your platform. On arm64 the answers should be identical (same word size). On 386/arm (32-bit) sizes drop to roughly 60 bytes.

---

## Task 6 — Implement `len` and `cap` Without Locking (15 min)

Add `Len()` and `Cap()` methods to your MiniChan that read without taking the lock. Use `atomic.Load` on `qcount`.

Now write a stress test:
- Goroutine A: `for { c.Send(1); c.Recv() }` continuously.
- Goroutine B: `for { fmt.Println(c.Len()) }` (or write to a counter).

Confirm that B sees varying values, not a constant. Confirm that the value is always in `[0, cap]`. There should never be torn reads (because `qcount` is word-sized and aligned).

Hint: this exercise demonstrates why `len(ch)` is documented as a "snapshot" — the value is consistent but stale.

---

## Task 7 — Reproduce the Closed-While-Parked Panic (25 min)

Write a program that:
1. Creates an unbuffered channel.
2. Starts a goroutine that does `ch <- 42`.
3. After a small sleep, calls `close(ch)` from the main goroutine.
4. Recovers from the resulting panic and prints the panic message.

Then trace through `runtime/chan.go` and identify exactly which line panics. (Hint: it's the `panic(plainError("send on closed channel"))` near the end of `chansend`, in the "after wake-up" cleanup.)

Validation: the panic message should be exactly `"send on closed channel"`.

Variation: replace the send with a receive. The receive should *not* panic; it returns the zero value with `ok == false`.

---

## Task 8 — Implement a Channel of Generic Type (45 min)

Using Go generics, build:

```go
type GenericChan[T any] struct { ... }

func New[T any](capacity int) *GenericChan[T]
func (c *GenericChan[T]) Send(v T)
func (c *GenericChan[T]) Recv() (T, bool)
func (c *GenericChan[T]) Close()
```

This requires:
- A slice `[]T` as buffer.
- Proper zero-value handling on closed receive: `var zero T`.
- Type-safe panic on send-after-close.

Compare the assembly output for `chan int` vs `GenericChan[int]` using `go build -gcflags='-S'`. Note that the real `chan` is monomorphic (one runtime function for all types, via `_type` descriptor), while generics produces specialised code.

Hint: think about whether your `GenericChan[int]` can match the real `chan int` performance. (Probably not without unsafe tricks.)

---

## Task 9 — Build a `selectGo` Helper (60 min)

Write a function that simulates a two-case `select`:

```go
func Select2[A, B any](
    sendA chan<- A, valA A, recvCaseA bool,
    sendB chan<- B, valB B, recvCaseB bool,
    recvA <-chan A, recvB <-chan B,
) (chosenIdx int, recvVal any, recvOk bool)
```

This is intentionally ugly — Go's real `select` is a language construct, not a function. The exercise is to see how messy it gets without compiler support.

Hint: use real Go channels for input. Use the built-in `select` to implement (which feels like cheating, but the point is to understand the *interface*, not to reimplement). Compare the user experience.

Validation: drive the function from a test with combinations of ready/not-ready cases and confirm it picks correctly.

---

## Task 10 — Trace a Real Channel Operation (30 min)

Write a tiny program:

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 2)
    ch <- 1
    ch <- 2
    fmt.Println(<-ch, <-ch)
}
```

Build with `-gcflags='-l -m'` to see escape analysis. Build with `-gcflags='-S' 2> ssa.txt` to see SSA output. Find:
- The call to `runtime.makechan`.
- The call to `runtime.chansend1`.
- The call to `runtime.chanrecv1`.

Confirm that `ch` itself does not escape to the heap (since you don't share it across goroutines in this example) — wait, actually it does, because `makechan` returns a heap pointer regardless. Check the escape analysis output to confirm.

Validation: identify the exact instructions that call into runtime.

---

## Task 11 — Implement `LenAtomic` Snapshot Consistency Test (30 min)

Build a test that:
1. Spawns N producers each sending 1000 values.
2. Spawns M consumers each receiving 1000 values.
3. A monitor goroutine prints `len(ch)` 1000 times.
4. Asserts every monitored value is in `[0, cap]`.

Confirm the monitor never sees a torn read. Why? Because `qcount` is a `uint` (machine word), aligned, and atomic word loads are guaranteed by hardware on supported platforms.

Hint: this is a property-test for the documented "snapshot" behavior.

---

## Task 12 — `chanbuf` Pointer Arithmetic (20 min)

Implement the runtime helper:

```go
func chanbuf(c *YourChan, i uint) unsafe.Pointer {
    return unsafe.Pointer(uintptr(c.buf) + uintptr(i)*uintptr(c.elemsize))
}
```

Verify that:
- The address is properly aligned for the element type.
- For `chan int` (8-byte elements), consecutive indices differ by 8 bytes.
- For `chan struct{ a, b int }` (16-byte elements), they differ by 16 bytes.

Use this to read/write your buffer instead of slice indexing. Compare benchmark numbers — typically minor difference because Go's slice indexing also compiles to similar pointer arithmetic.

---

## Task 13 — Reproduce the "stale `sudog` in `select`" Race (45 min)

This is hard. Build a setup with three channels and one goroutine doing a 3-way `select`. Trigger conditions where multiple channels become ready almost simultaneously. Use a counter to track how many times each case fires.

The race detector should not complain (because the runtime handles this race correctly). But you can observe via `runtime/trace` that the goroutine wakes once and other channels keep stale `sudog`s briefly until the cleanup.

Hint: this task is really about reading `runtime/select.go` and seeing how `selparkcommit` / `selunlock` clean up. The goal is awareness, not reproduction.

---

## Task 14 — Build a Race-Free Counter on Top of a Channel (15 min)

Implement a counter where every `Inc()` is a `ch <- 1` and the count is read via a goroutine that does `for v := range ch { sum += v }`.

Demonstrate that this is race-free (the race detector is happy), even though the variable `sum` is "shared". Why? Because the channel is the synchronization point.

Validation: run with `-race`. Compare with the same counter using `int` + `atomic.AddInt64` — both should be race-free but with very different performance.

Hint: this is a tiny example of how channels provide both communication and synchronization.

---

## Task 15 — Stress Test: How Many Channels Can You Make? (20 min)

Write a program that allocates `chan int` channels in a loop until memory runs out:

```go
var channels []chan int
for i := 0; ; i++ {
    channels = append(channels, make(chan int, 4))
    if i%100000 == 0 {
        var m runtime.MemStats
        runtime.ReadMemStats(&m)
        fmt.Printf("alloc=%d MB, channels=%d\n", m.Alloc/1024/1024, i)
    }
}
```

Compute the per-channel cost from the slope. Compare against `hchanSize + 4*8` ~ 128 bytes. Slice growth amortises away.

Validation: per-channel memory should be ~128–256 bytes (the slice header overhead included).

Hint: at one million channels you should see ~128 MB allocated. This is what makes "channel per actor" sometimes prohibitive.

---

## Task 16 — Implement a Bounded Multi-Producer Queue Without Channels (60 min)

Build a fixed-size MPSC (multi-producer, single-consumer) queue using:
- A fixed `[]T` ring buffer.
- An atomic head and tail.
- A `sync.Mutex` guarding the producer side, no mutex on consumer side.

Compare performance against a `make(chan T, N)` channel. Measure throughput in elements/second under N producers and 1 consumer for N = 1, 2, 4, 8.

Hint: a non-locking single-consumer can read `head` atomically, then read the slot, then advance `head`. Producers must coordinate around the tail.

Validation: under no contention, your custom queue should be roughly the same speed as the channel; under heavy multi-producer contention, the channel may pull ahead (because its lock is the runtime spin-mutex, which is briefer than `sync.Mutex`).

This task drives home why `hchan` exists: it is a well-tuned default for general-purpose use.

---

## What to Read Next

After working through these tasks, return to:

- **`find-bug.md`** — Bugs that only show up when you understand the internals.
- **`optimize.md`** — Performance work grounded in the data structure.
- **`02-runtime-behavior/`** — How the scheduler interacts with parked goroutines on channels.
