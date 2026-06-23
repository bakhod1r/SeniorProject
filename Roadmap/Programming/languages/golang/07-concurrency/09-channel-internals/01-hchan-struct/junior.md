# The `hchan` Struct — Junior

[← Back to index](index.md)

## Table of Contents
1. [Why Look Inside a Channel](#why-look-inside-a-channel)
2. [Where the Source Lives](#where-the-source-lives)
3. [What `make(chan T, N)` Returns](#what-makechan-t-n-returns)
4. [The `hchan` Struct in One Glance](#the-hchan-struct-in-one-glance)
5. [Walking the Fields Slowly](#walking-the-fields-slowly)
6. [`qcount` and `dataqsiz`](#qcount-and-dataqsiz)
7. [`buf` — the Ring Buffer](#buf-the-ring-buffer)
8. [`elemsize` and `elemtype`](#elemsize-and-elemtype)
9. [`closed`](#closed)
10. [`sendx` and `recvx`](#sendx-and-recvx)
11. [`recvq` and `sendq` — the Wait Queues](#recvq-and-sendq-the-wait-queues)
12. [`lock` — a Runtime Mutex, Not `sync.Mutex`](#lock-a-runtime-mutex-not-syncmutex)
13. [One Allocation, Two Regions](#one-allocation-two-regions)
14. [Memory Layout Diagram](#memory-layout-diagram)
15. [`makechan` — Where It All Starts](#makechan-where-it-all-starts)
16. [What the Compiler Does to `ch <- v`](#what-the-compiler-does-to-ch--v)
17. [What the Compiler Does to `<-ch`](#what-the-compiler-does-to--ch)
18. [Why a Channel Is a Pointer](#why-a-channel-is-a-pointer)
19. [The Unbuffered Special Case](#the-unbuffered-special-case)
20. [A First Look at `sudog`](#a-first-look-at-sudog)
21. [How a Goroutine Parks on a Channel](#how-a-goroutine-parks-on-a-channel)
22. [Sizes and `unsafe.Sizeof`](#sizes-and-unsafesizeof)
23. [Comparison With Other Languages](#comparison-with-other-languages)
24. [A Brief History of `hchan`](#a-brief-history-of-hchan)
25. [Common Misconceptions](#common-misconceptions)
26. [Reading the Source in 30 Minutes](#reading-the-source-in-30-minutes)
27. [A Small Demo You Can Run](#a-small-demo-you-can-run)
28. [Quick Self-Check](#quick-self-check)
29. [What to Read Next](#what-to-read-next)

---

## Why Look Inside a Channel

You can use channels for years without opening `src/runtime/chan.go`. Send, receive, close, range — the surface API is tiny. So why bother?

Because every now and then a channel mystery hits you that no blog post answers:

- "Why is `cap(ch)` for an unbuffered channel zero, but the channel still works?"
- "Where exactly is the goroutine stored when it blocks on send?"
- "Why does `runtime.Gosched()` not help my contended channel?"
- "Why does `pprof` show `chansend1` and `chanrecv1` in the stack instead of my code?"
- "Why is a closed channel still indexable by `recvx`?"

All five are easy to answer once you have seen the struct. The struct is small — about a dozen fields — and the file that defines it is a thousand lines of well-commented Go. Reading it gives you a mental model that survives every "weird channel" surprise you will ever meet.

This junior page tours `hchan` slowly, names every field, draws the memory picture, and shows what the compiler emits for `ch <- v` and `<-ch`. The middle and senior pages go deeper into the algorithms; this page is the map.

---

## Where the Source Lives

The whole channel implementation is in two files:

```
$GOROOT/src/runtime/chan.go        // ~700 lines, all the logic
$GOROOT/src/runtime/select.go      // ~600 lines, multi-way select
```

Plus a tiny piece in the compiler that lowers the `<-` operator:

```
$GOROOT/src/cmd/compile/internal/ssagen/ssa.go
$GOROOT/src/cmd/compile/internal/walk/select.go
```

Anything you read on the internet about how channels work boils down to facts you can verify in those four files. If you do not have a Go checkout, browse online at <https://github.com/golang/go/blob/master/src/runtime/chan.go>.

A useful trick: set `GODEBUG=schedtrace=1000` while running a program with many channels and watch the scheduler logs. They give the runtime's view of who is parked where.

---

## What `make(chan T, N)` Returns

The literal answer: `make(chan T, N)` returns a value of type `chan T`. But what *is* a `chan T` at the machine level? A pointer. Specifically, a pointer to an `hchan` struct allocated on the heap by the runtime function `makechan` in `runtime/chan.go`.

So this code:

```go
ch := make(chan int, 3)
```

allocates a single block of memory big enough to hold:

- the `hchan` header, and
- a contiguous ring buffer of three `int` slots.

The variable `ch` holds the pointer to that block. Copying `ch` into another variable does **not** copy the channel — it copies the pointer. That is why you can pass channels to goroutines without losing identity: they all see the same `hchan`.

```go
ch := make(chan int, 3)
go func(c chan int) {
    c <- 1            // writes into the same hchan
}(ch)
fmt.Println(<-ch)     // reads from the same hchan
```

The function parameter `c` is a fresh local variable, but its value (the pointer) is identical.

---

## The `hchan` Struct in One Glance

Here is the actual definition, copied with the comments preserved, from `runtime/chan.go` (Go 1.22):

```go
type hchan struct {
    qcount   uint           // total data in the queue
    dataqsiz uint           // size of the circular queue
    buf      unsafe.Pointer // points to an array of dataqsiz elements
    elemsize uint16
    closed   uint32
    elemtype *_type // element type
    sendx    uint   // send index
    recvx    uint   // receive index
    recvq    waitq  // list of recv waiters
    sendq    waitq  // list of send waiters

    // lock protects all fields in hchan, as well as several
    // fields in sudogs blocked on this channel.
    //
    // Do not change another G's status while holding this lock
    // (in particular, do not ready a G), as this can deadlock
    // with stack shrinking.
    lock mutex
}
```

That is the whole thing. Eleven fields. We will visit them one by one.

The `waitq` type is also tiny:

```go
type waitq struct {
    first *sudog
    last  *sudog
}
```

A doubly-linked-list head/tail pointer pair, where each node is a `sudog` (we meet `sudog` shortly).

---

## Walking the Fields Slowly

Before deep-diving each field, here is the short story:

| Field | Meaning |
|---|---|
| `qcount` | How many elements are currently in the buffer. |
| `dataqsiz` | Buffer capacity. `0` for unbuffered. |
| `buf` | Pointer to the ring buffer; `nil` if `dataqsiz == 0`. |
| `elemsize` | Bytes per element. |
| `closed` | `0` if open, `1` if `close()` has been called. |
| `elemtype` | Pointer to the runtime type descriptor for element type. |
| `sendx` | Index where the **next send** will write. |
| `recvx` | Index where the **next receive** will read. |
| `recvq` | Queue of goroutines blocked on receive. |
| `sendq` | Queue of goroutines blocked on send. |
| `lock` | Runtime spin-mutex protecting the rest of the struct. |

Sizes and alignment vary by GOARCH, but on 64-bit Linux the total is roughly 96 bytes plus the buffer.

---

## `qcount` and `dataqsiz`

`qcount` is the current number of elements in the buffer. `dataqsiz` is the capacity. Both are `uint` (typically 64 bits on amd64).

If `dataqsiz == 0` the channel is **unbuffered**. There is no ring at all; `buf` is `nil` and `qcount` is always `0`.

If `dataqsiz == 3` and you do three sends with no receiver, `qcount` reaches `3` and any further send blocks (parks on `sendq`).

User code observes these via `len(ch)` and `cap(ch)`. Their implementations are one-liners in `chan.go`:

```go
func chanlen(c *hchan) int { return int(c.qcount) }
func chancap(c *hchan) int { return int(c.dataqsiz) }
```

Note: `len(ch)` is not synchronised with sends/receives — it reads `qcount` without taking the lock. The number you get is a *snapshot* that may already be stale when you act on it. (Detail covered in the senior page.)

---

## `buf` — the Ring Buffer

`buf` is `unsafe.Pointer` because the runtime treats the buffer as a raw byte array. The element type is known via `elemtype`, so the runtime computes the address of slot `i` as:

```
buf + i * elemsize
```

The buffer is a *circular queue*. There are two index variables — `sendx` and `recvx` — that wrap around modulo `dataqsiz`. When `sendx == recvx`, the buffer is either empty (`qcount == 0`) or full (`qcount == dataqsiz`); the count disambiguates.

For unbuffered channels, `buf` is `nil`. Sends and receives synchronise directly between goroutines, without ever touching a buffer.

---

## `elemsize` and `elemtype`

`elemsize` is a `uint16` — the runtime caps it at 65535 bytes. If your element type is larger, the runtime panics at `makechan` time.

`elemtype` points to the runtime's type descriptor (`*_type`). The runtime needs it for:

- Knowing how to **copy** elements (`typedmemmove` handles pointers and write barriers correctly for GC).
- Reporting type names in panic messages.

When the buffer holds pointers (or types containing pointers), the GC must scan the buffer's slots. `elemtype` tells the GC what to do. This is one reason channels of pointer-containing types are slightly more expensive than channels of plain integers.

---

## `closed`

`closed` is a `uint32` flag. `0` means open, `1` means `close()` has been called. The runtime uses an integer rather than a `bool` because some platforms historically required word-sized atomics; `uint32` lets the field be read atomically without the lock in fast paths.

Once closed, `closed` never returns to `0`. There is no "reopen" operation. Calling `close()` on an already-closed channel panics; sending on a closed channel panics; receiving returns the zero value with `ok == false` once the buffer is drained.

---

## `sendx` and `recvx`

The two indices into the ring buffer.

- `sendx` is where the next send will store its value.
- `recvx` is where the next receive will fetch its value.

After each operation, the matching index advances and wraps modulo `dataqsiz`:

```go
c.sendx++
if c.sendx == c.dataqsiz {
    c.sendx = 0
}
```

Same for `recvx`. The actual lines from `runtime/chan.go`:

```go
// inside chansend, fast-path buffer write
qp := chanbuf(c, c.sendx)
typedmemmove(c.elemtype, qp, ep)
c.sendx++
if c.sendx == c.dataqsiz {
    c.sendx = 0
}
c.qcount++
```

`chanbuf(c, i)` is a small helper that returns `buf + i*elemsize` as `unsafe.Pointer`.

---

## `recvq` and `sendq` — the Wait Queues

These are the most interesting fields. Each is a `waitq`:

```go
type waitq struct {
    first *sudog
    last  *sudog
}
```

When a goroutine has to **block** (the buffer is full on send, or empty on receive), the runtime:

1. Allocates a `sudog` (or reuses one from a per-P pool).
2. Fills it with the goroutine pointer, the element pointer, etc.
3. Appends it to the appropriate `waitq` (`sendq` for blocked senders, `recvq` for blocked receivers).
4. Parks the goroutine via `gopark`.

When the opposite operation comes along, the runtime pops a `sudog` from the queue and wakes its goroutine. That is how a channel transfers data: not through the buffer in the unbuffered case, but goroutine-to-goroutine.

---

## `lock` — a Runtime Mutex, Not `sync.Mutex`

Look closely:

```go
lock mutex
```

That `mutex` is not `sync.Mutex`. It is the **runtime-internal mutex** defined in `runtime/lock_*.go`. It is much smaller, spins briefly on contention, and is used for very short critical sections. The runtime never blocks on this lock for long; if it has to block, it transitions through `gopark` instead.

Why not `sync.Mutex`? Because `sync.Mutex` calls into the runtime via `runtime_SemacquireMutex`, which itself needs to operate on goroutines. A circular dependency is avoided by using the low-level runtime mutex inside data structures the runtime itself manages.

The comment in the source says it well:

```
// lock protects all fields in hchan, as well as several
// fields in sudogs blocked on this channel.
//
// Do not change another G's status while holding this lock
// (in particular, do not ready a G), as this can deadlock
// with stack shrinking.
```

That last sentence is a real constraint enforced by the way `chansend`/`chanrecv` are written: they release the lock before calling `goready` on a partner goroutine.

---

## One Allocation, Two Regions

A subtle point that often confuses newcomers: when `make(chan T, N)` runs, the runtime performs a **single** heap allocation that holds both the `hchan` header *and* the buffer, laid out contiguously.

From `runtime/chan.go`:

```go
func makechan(t *chantype, size int) *hchan {
    elem := t.Elem
    // ... size and alignment checks ...

    mem, overflow := math.MulUintptr(elem.Size_, uintptr(size))
    if overflow || mem > maxAlloc-hchanSize || size < 0 {
        panic(plainError("makechan: size out of range"))
    }

    var c *hchan
    switch {
    case mem == 0:
        // Queue or element size is zero.
        c = (*hchan)(mallocgc(hchanSize, nil, true))
        c.buf = c.raceaddr()
    case elem.PtrBytes == 0:
        // Elements do not contain pointers.
        // Allocate hchan and buf in one call.
        c = (*hchan)(mallocgc(hchanSize+mem, nil, true))
        c.buf = add(unsafe.Pointer(c), hchanSize)
    default:
        // Elements contain pointers.
        c = new(hchan)
        c.buf = mallocgc(mem, elem, true)
    }

    c.elemsize = uint16(elem.Size_)
    c.elemtype = elem
    c.dataqsiz = uint(size)
    lockInit(&c.lock, lockRankHchan)

    return c
}
```

Three cases:

- **Zero-size buffer or zero-size element**: one allocation for `hchan` only; `c.buf` set to a placeholder address.
- **Pointer-free element type**: one allocation containing `hchan` then buffer contiguously.
- **Element contains pointers**: two allocations — header and buffer separately — because the GC needs the buffer to be its own object with proper type metadata.

The pointer-free single-allocation case is the most common in practice (e.g., `chan int`, `chan struct{}`) and is the fastest.

---

## Memory Layout Diagram

For `make(chan int, 4)` on amd64 (8-byte `int`), the heap object looks like this:

```
+-------------------- one allocation -----------------------+
|                                                           |
|   hchan header (~96 B)            ring buffer (4*8 = 32B) |
|   +-------------------------+   +-----+-----+-----+-----+ |
|   | qcount    = 0           |   |  ?  |  ?  |  ?  |  ?  | |
|   | dataqsiz  = 4           |   +-----+-----+-----+-----+ |
|   | buf       = ----------------+                         |
|   | elemsize  = 8           |   ^                         |
|   | closed    = 0           |   |                         |
|   | elemtype  = *_type(int) |   |                         |
|   | sendx     = 0  ---------+   recvx == 0                |
|   | recvx     = 0           |                             |
|   | recvq     = {nil, nil}  |                             |
|   | sendq     = {nil, nil}  |                             |
|   | lock      = {0}         |                             |
|   +-------------------------+                             |
+-----------------------------------------------------------+
```

After three sends and one receive, with one goroutine blocked on a fourth receive (no producer ready), the picture is:

```
hchan
  qcount   = 2
  sendx    = 3  (next send goes to slot 3)
  recvx    = 1  (next receive from slot 1)
buffer
  [_, v1, v2, _]
sendq    -> nil
recvq    -> sudog(g=G42, elem=&local_var, next=nil)  // one goroutine parked waiting
```

The "waiter" `G42` is sitting parked. As soon as any goroutine sends a fourth element (or another receive on a non-empty buffer happens), the runtime will hand the element directly to `G42` and unpark it.

---

## `makechan` — Where It All Starts

`make(chan T, N)` is lowered by the compiler to a call to `runtime.makechan` (or `runtime.makechan64` if the size is a 64-bit value on a 32-bit platform — but that is a corner case).

You already saw `makechan` above. Three things matter for a junior view:

1. **It validates**. Negative size, too-big element, too-big total → panic.
2. **It allocates one or two objects**. Two only if elements have pointers.
3. **It initialises** `elemsize`, `elemtype`, `dataqsiz`, and the lock.

`hchanSize` is a runtime constant equal to `unsafe.Sizeof(hchan{})` rounded up to a maxAlign. For amd64 it is exactly 96 bytes.

---

## What the Compiler Does to `ch <- v`

When the compiler sees:

```go
ch <- v
```

it does not emit a special instruction. It rewrites the expression into a call to `runtime.chansend1`:

```go
runtime.chansend1(ch, &v)
```

`chansend1` (in `runtime/chan.go`) is a one-line wrapper:

```go
func chansend1(c *hchan, elem unsafe.Pointer) {
    chansend(c, elem, true, getcallerpc())
}
```

The real work is in `chansend(c, ep, block, callerpc)`. The `block` flag is `true` for ordinary sends and `false` for `select` non-blocking cases.

So at the machine level, every send is just a function call into the runtime. The caller has its address of `v` taken (because `&v` is passed). The runtime knows the element size via `c.elemsize` and copies the element into the right place (buffer slot, or direct hand-off to a waiting receiver).

---

## What the Compiler Does to `<-ch`

For `<-ch` (value-only) the compiler emits:

```go
runtime.chanrecv1(ch, &target)
```

For `v, ok := <-ch` (two-value form) the compiler emits:

```go
ok := runtime.chanrecv2(ch, &target)
```

Both wrap `runtime.chanrecv(c, ep, block)`:

```go
func chanrecv1(c *hchan, elem unsafe.Pointer) {
    chanrecv(c, elem, true)
}

func chanrecv2(c *hchan, elem unsafe.Pointer) (received bool) {
    _, received = chanrecv(c, elem, true)
    return
}
```

So the only difference between `v := <-ch` and `v, ok := <-ch` is which runtime entry point the compiler picks. Same underlying `chanrecv` function.

---

## Why a Channel Is a Pointer

The Go specification allows a channel value to be the zero value of its type, which is `nil`. Why? Because `chan T` is, under the hood, `*hchan`, and `(*hchan)(nil)` is a perfectly representable value. Sends and receives on a nil channel block forever — implemented by `chansend` and `chanrecv` checking `if c == nil` and either panicking (for `block == false` paths in some cases) or parking forever.

Passing channels by value is cheap because you are passing a single pointer — typically 8 bytes. This is also why `chan T` can be a map key, a struct field, etc., with predictable size.

---

## The Unbuffered Special Case

For `make(chan T)` (no size, or size 0):

- `dataqsiz` is `0`.
- `buf` points to a stand-in address (it is never dereferenced as a buffer).
- `sendx` and `recvx` are unused.
- All transfers happen via `recvq`/`sendq` direct hand-off.

When a sender meets a parked receiver in `recvq`, the runtime copies the value directly from the sender's `&v` into the receiver's destination address, then unparks the receiver. There is no buffer slot in the middle. This is the "rendezvous" property of unbuffered channels.

When neither party is present, the first to arrive parks itself on its queue (`sendq` for sender, `recvq` for receiver) and waits for the other side.

---

## A First Look at `sudog`

`sudog` is a tiny struct defined in `runtime/runtime2.go`. It stands for "scheduling user-data G". Each parked goroutine has one (and may have many if it is waiting in multiple `select` cases).

Simplified definition:

```go
type sudog struct {
    g          *g            // pointer to the goroutine
    next, prev *sudog        // linked-list pointers inside waitq
    elem       unsafe.Pointer // pointer to data (sender's source, receiver's destination)
    c          *hchan        // the channel we are parked on
    isSelect   bool          // is this part of a select?
    success    bool          // did the operation complete vs. channel-was-closed?
    waitlink   *sudog        // chain in g.waiting (per-G list)
    // ... a few other fields ...
}
```

The runtime keeps a per-P cache of free `sudog`s so that parking on a channel does not always allocate. The fast path is essentially:

1. Pop a `sudog` off the local P's freelist.
2. Fill it in.
3. Append to `c.sendq` (or `c.recvq`).
4. `gopark(...)` — give up the M and become `_Gwaiting`.

When woken, the steps reverse.

---

## How a Goroutine Parks on a Channel

Take this code:

```go
ch := make(chan int)   // unbuffered
go func() {
    ch <- 7
}()
```

The producer goroutine reaches `ch <- 7`, calls `chansend1(ch, &7)`. Inside `chansend`:

1. Acquire `c.lock`.
2. Check `c.recvq`. Empty → no receiver waiting.
3. Buffer? `dataqsiz == 0`, so cannot buffer.
4. Allocate a `sudog`, fill in `elem = &7` and `g = current G`.
5. Append to `c.sendq`.
6. Release `c.lock`.
7. `gopark(chanparkcommit, ...)` — goroutine becomes `_Gwaiting`.

Now the main goroutine arrives at `v := <-ch`, calls `chanrecv1(ch, &v)`. Inside `chanrecv`:

1. Acquire `c.lock`.
2. Check `c.sendq`. Found the parked producer!
3. Copy from producer's `elem` (`&7`) to receiver's destination (`&v`).
4. `goready(producer.g)` — re-mark producer runnable.
5. Release `c.lock`.
6. Return.

After this, the producer continues at the instruction after `ch <- 7`, and the main goroutine continues with `v == 7`. No buffer slot was ever used.

---

## Sizes and `unsafe.Sizeof`

You can poke at the size with a tiny program:

```go
package main

import (
    "fmt"
    "reflect"
    "unsafe"
)

func main() {
    // We can't take &hchan directly (unexported), but we can size it
    // via reflect on a channel value, sort of indirectly.
    ch := make(chan int, 4)
    // The channel value itself is one word: an *hchan.
    fmt.Println("size of chan int value:", unsafe.Sizeof(ch))     // 8 on amd64
    fmt.Println("len:", len(ch), "cap:", cap(ch))                  // 0, 4
    fmt.Println("kind:", reflect.TypeOf(ch).Kind())                // chan
}
```

`unsafe.Sizeof(ch)` reports `8` on amd64 because the channel *variable* is a pointer. The underlying `hchan` plus buffer lives on the heap and is much bigger.

A rough `hchanSize` on amd64 today is about **96 bytes**. Plus the buffer. So `make(chan int, 4)` allocates roughly `96 + 4*8 = 128` bytes, all in one shot, in one heap object.

---

## Comparison With Other Languages

Channels are not unique to Go, but the implementation choices are. A short comparison:

| Language / library | Equivalent | Backed by |
|---|---|---|
| Go | `chan T` | `*hchan`: ring buffer + two FIFO queues + runtime mutex |
| Rust | `std::sync::mpsc::channel` | Linked queue (head-tail pointers) + parking |
| Rust | `crossbeam::channel` | Array-backed bounded queue with epoch GC |
| C++ | `std::experimental::concurrent_bounded_queue` (TBB) | Lock-free or lock-based bounded array |
| Java | `BlockingQueue<T>` | Array or linked node; OS-level monitors |
| Erlang | mailbox + `!` send | Per-process mailbox linked list |

What is distinctive about Go's design:

- **One struct for buffered and unbuffered**: same data structure, `dataqsiz == 0` flips behavior.
- **Direct hand-off on rendezvous**: data jumps from sender stack to receiver stack without going through a buffer.
- **Runtime mutex, not OS mutex**: blocking is goroutine parking, not thread blocking.
- **GC integration via `elemtype`**: the runtime knows how to scan the buffer.

These trade-offs are why Go channels feel lightweight: the cost is one runtime call plus possibly a `sudog` allocation, no kernel involvement on the fast path.

---

## A Brief History of `hchan`

A short timeline (commit messages are public in the Go repo):

- **Go 1.0 (2012)**: channels existed; `hchan` shape similar to today; element copies via raw memmove.
- **Go 1.1 (2013)**: `select` statement rewritten to be linear-time when one case is ready.
- **Go 1.5 (2015)**: runtime translated to Go; `hchan` declared in `chan.go` as a Go struct.
- **Go 1.7 (2016)**: race-detector hooks moved into `chan.go`; `c.raceaddr()` introduced.
- **Go 1.14 (2020)**: async preemption interacts with parked goroutines on channels; the parking discipline gains new constraints.
- **Go 1.18 (2022)**: generics. No change to `hchan` (the runtime is monomorphic; the type descriptor `elemtype` always existed).
- **Go 1.21+ (2023+)**: minor tweaks; the struct shape has been stable for years.

The remarkable fact is that `hchan` has barely changed since Go 1.0. The discipline of "one struct, two regions, two queues, one lock" turned out to be a good choice.

---

## Common Misconceptions

A few popular misunderstandings, cleared up by looking at the struct:

- **"A channel is just a queue."** Half true. Buffered channels have a queue; unbuffered ones have only `sendq` and `recvq`. The two cases are unified by the struct but conceptually different.

- **"Sending always copies through the buffer."** False. On rendezvous (unbuffered, or buffered with a waiting receiver), the value goes directly from sender's stack to receiver's destination.

- **"`close(ch)` frees the channel."** False. `close` only sets `c.closed = 1` and wakes parked receivers/senders. The `hchan` is freed by the GC like any other heap object.

- **"`len(ch)` is atomic."** Misleading. The read of `qcount` is atomic in the sense that the CPU performs an aligned word read, but there is no synchronisation with concurrent sends/receives. The value can be stale by the time you look at it.

- **"Channels are implemented with futexes / kernel queues."** False on the fast path. The runtime uses `gopark` and a goroutine-level wait list. Futexes appear only deep down inside the runtime's mutex implementation, and only under heavy contention.

- **"You can call `make(chan T)` with a million entries cheaply."** Only if the element type is small. The buffer is allocated immediately; `make(chan [1<<20]byte, 1000)` allocates a gigabyte upfront.

---

## Reading the Source in 30 Minutes

If you have half an hour, here is a productive path:

1. Open `src/runtime/chan.go`. Read the type definitions (`hchan`, `waitq`) at the top — five minutes.
2. Read `makechan` — three minutes.
3. Read `chansend` from top to bottom, ignoring `select` paths for now — ten minutes.
4. Read `chanrecv` similarly — ten minutes.
5. Skim `closechan` — two minutes.

Total: ~30 minutes. You will see references to `sudog`, `gopark`, `goready`, `mcall`, `goroutineWaitReasonChanSend`. They are runtime primitives covered elsewhere in the roadmap, but the channel logic is self-contained enough to follow.

A second pass with the *middle* page in this folder will fill in the buffer mechanics; a third with the *senior* page will tighten the parking discipline.

---

## A Small Demo You Can Run

The runtime exposes very little of `hchan` to user code, but we can confirm behavior empirically:

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    ch := make(chan int, 2)

    // Producers
    for i := 0; i < 5; i++ {
        go func(i int) {
            ch <- i
        }(i)
    }

    // Give time for some to park
    time.Sleep(50 * time.Millisecond)

    // Buffer cap = 2, so 2 sends succeed and 3 producers are parked in sendq.
    fmt.Println("len(ch) =", len(ch), "cap(ch) =", cap(ch))
    // Expected: len(ch) = 2 cap(ch) = 2

    // Show that we have many goroutines parked
    fmt.Println("goroutines:", runtime.NumGoroutine())
    // Expected: at least 4 (main + 3 parked producers; 2 producers already done)

    // Drain
    for i := 0; i < 5; i++ {
        <-ch
    }
}
```

If you run with `GOTRACEBACK=all` and then send `SIGQUIT` while paused, you will see the parked goroutines blocked in `runtime.chansend1`. That is the wait queue made visible.

---

## Quick Self-Check

Without scrolling back, answer:

1. How many fields does `hchan` have?
2. What is the type of `lock` in `hchan`?
3. When is `buf` nil?
4. How many allocations does `make(chan int, 100)` do?
5. What runtime function does `ch <- v` lower to?
6. Where is the parked goroutine when it is blocked on send?
7. What does `closed = 1` mean?
8. Is `len(ch)` atomic with respect to concurrent sends?

Answers:

1. Eleven (qcount, dataqsiz, buf, elemsize, closed, elemtype, sendx, recvx, recvq, sendq, lock).
2. `mutex` — the runtime-internal mutex, **not** `sync.Mutex`.
3. When `dataqsiz == 0` (unbuffered) and even then it is set to a placeholder address, not always `nil` — but it is never used as a buffer.
4. One — the element type `int` is pointer-free, so `hchan` and buffer share a single `mallocgc` call.
5. `runtime.chansend1`, which calls `runtime.chansend`.
6. In a `sudog` linked into `c.sendq`. Its `elem` field points to the value being sent.
7. The channel is closed. Sends panic; receives drain the buffer then return zero with `ok == false`.
8. No. It is a plain word read of `qcount`. The value is a snapshot that can be stale.

---

## What to Read Next

- **`middle.md`** — Field-by-field deep dive into the ring buffer, `chansend`'s three paths (waiter present, room in buffer, must block), and `chanrecv` symmetrically.
- **`senior.md`** — `waitq`/`sudog` mechanics, the runtime mutex spin behavior, cache-line layout, and what the compiler does in special cases (`select`, `case <-ch:`).
- **`professional.md`** — Walk the entire `runtime/chan.go` source with line references; the GC interaction; race-detector hooks.
- **`02-runtime-behavior/`** — How the scheduler interacts with parked goroutines on channels.
- **`03-buffer-mechanics/`** — More on the circular buffer math and edge cases.
- **`04-send-receive-flow/`** — The full lifecycle of a send and a receive, including `select`.

Once these are absorbed, the rest of channel internals (closing, `select`, leaky channels, fan-in/fan-out under the microscope) become straightforward variations on the same theme.
