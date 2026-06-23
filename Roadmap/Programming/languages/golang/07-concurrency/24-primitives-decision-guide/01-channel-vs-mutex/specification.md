---
layout: default
title: Channels vs Mutexes — Specification
parent: Channels vs Mutexes
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/01-channel-vs-mutex/specification/
---

# Channels vs Mutexes — Specification

[← Back](../)

## Table of contents
1. [Scope](#scope)
2. [Channel semantics from the Go spec](#channel-semantics-from-the-go-spec)
3. [Mutex semantics from sync godoc](#mutex-semantics-from-sync-godoc)
4. [Go memory model — happens-before for channels](#go-memory-model--happens-before-for-channels)
5. [Go memory model — happens-before for mutexes](#go-memory-model--happens-before-for-mutexes)
6. [Closure rules for channels](#closure-rules-for-channels)
7. [Send and receive on nil channels](#send-and-receive-on-nil-channels)
8. [Buffer rules and ordering](#buffer-rules-and-ordering)
9. [Copy and pointer rules for sync types](#copy-and-pointer-rules-for-sync-types)
10. [Cross references in the runtime source](#cross-references-in-the-runtime-source)

---

## Scope
This file gathers the *normative* statements that govern channels and `sync.Mutex`. It does not teach how to use them; it states what the language and standard library promise. When a behaviour described in `junior.md` or `senior.md` is "guaranteed", it is guaranteed by one of the sentences quoted here.

The two source-of-truth documents are:
- **The Go Programming Language Specification**, sections "Channel types", "Send statements", "Receive operator", and "Close".
- **The Go Memory Model**, sections "Channel communication" and "Locks".
- **Package `sync` godoc**, types `Mutex`, `RWMutex`, plus the documented invariant in `sync.Locker`.

---

## Channel semantics from the Go spec

> "A channel provides a mechanism for concurrently executing functions to communicate by sending and receiving values of a specified element type. The value of an uninitialized channel is `nil`."
> — Go spec, *Channel types*.

> "The channel direction is part of its type; in `chan<- T` the channel may only be sent to, in `<-chan T` it may only be received from. A bidirectional channel may be implicitly converted to either directional type, but not the other way."
> — Go spec, *Channel types*.

> "A new, initialized channel value can be made using the built-in function `make`, which takes the channel type and an optional capacity as arguments."
> — Go spec, *Making channels*.

Send and receive:

> "A send statement sends a value on a channel. The channel expression must be of channel type, the channel direction must permit send operations, and the type of the value to be sent must be assignable to the channel's element type."
> — Go spec, *Send statements*.

> "The expression blocks until the send can proceed. A send on an unbuffered channel can proceed if a receiver is ready. A send on a buffered channel can proceed if there is room in the buffer."
> — Go spec, *Send statements*.

> "A send on a closed channel proceeds by causing a run-time panic. A send on a nil channel blocks forever."
> — Go spec, *Send statements*.

> "The receive operator `<-ch` … blocks until a value is available. Receiving from a nil channel blocks forever. A receive operation on a closed channel can always proceed immediately, yielding the element type's zero value after any previously sent values have been received."
> — Go spec, *Receive operator*.

> "A receive expression used in an assignment or initialization of the form `x, ok = <-ch` yields an additional untyped boolean result reporting whether the communication succeeded. The value of `ok` is `true` if the value received was delivered by a successful send operation, or `false` if it is a zero value generated because the channel is closed and empty."
> — Go spec, *Receive operator*.

Close:

> "The `close` built-in function closes a channel, which must be either bidirectional or send-only. … Sending to or closing a closed channel causes a run-time panic. Closing the nil channel also causes a run-time panic."
> — Go spec, *Close*.

---

## Mutex semantics from sync godoc

> "A Mutex is a mutual exclusion lock. The zero value for a Mutex is an unlocked mutex."
> — package `sync` godoc, type `Mutex`.

> "A Mutex must not be copied after first use."
> — package `sync` godoc, type `Mutex`.

> "If the lock is already locked for reading or writing, Lock blocks until the lock is available."
> — package `sync` godoc, `(*Mutex).Lock`.

> "Unlock unlocks m. It is a run-time error if m is not locked on entry to Unlock. A locked Mutex is not associated with a particular goroutine. It is allowed for one goroutine to lock a Mutex and then arrange for another goroutine to unlock it."
> — package `sync` godoc, `(*Mutex).Unlock`.

For `RWMutex`:

> "A RWMutex is a reader/writer mutual exclusion lock. The lock can be held by an arbitrary number of readers or a single writer. The zero value for a RWMutex is an unlocked mutex."
> — package `sync` godoc, type `RWMutex`.

> "If a goroutine holds a RWMutex for reading and another goroutine might call Lock, no goroutine should expect to be able to acquire a read lock until the initial read lock is released. In particular, this prohibits recursive read locking. This is to ensure that the lock eventually becomes available; a blocked Lock call excludes new readers from acquiring the lock."
> — package `sync` godoc, type `RWMutex`.

`sync.Locker` interface:

> ```go
> type Locker interface {
>     Lock()
>     Unlock()
> }
> ```
> — package `sync`, type `Locker`.

Both `*Mutex` and `*RWMutex` (via `(*RWMutex).RLocker` for read access) satisfy this interface.

---

## Go memory model — happens-before for channels

The Go Memory Model (https://go.dev/ref/mem) states the following synchronization guarantees for channels. Quoting the *Channel communication* section:

> "A send on a channel is synchronized before the completion of the corresponding receive from that channel. This rule generalizes both buffered and unbuffered channels."
> — Go memory model, *Channel communication*.

> "The closing of a channel is synchronized before a receive that returns because the channel is closed."
> — Go memory model, *Channel communication*.

> "The k-th receive on a channel with capacity C is synchronized before the completion of the (k+C)-th send from that channel. This rule generalizes the previous one to buffered channels: it corresponds to the fact that a buffered channel can be viewed as equivalent to an unbuffered channel together with a queue of length C; with this rule it is possible to use a buffered channel as a counting semaphore."
> — Go memory model, *Channel communication*.

> "A receive from an unbuffered channel is synchronized before the completion of the corresponding send on that channel."
> — Go memory model, *Channel communication*.

Practical reading of these four rules:
1. Whatever a sender writes before `ch <- v` is visible to a receiver of `v`.
2. Whatever the closer writes before `close(ch)` is visible to a goroutine that observes the channel as closed.
3. With a buffered channel of capacity `C`, the *(k+C)*-th send waits for the *k*-th receive — that is the formal basis for "buffered channel as semaphore".
4. On an unbuffered channel only, the receive completes *before* the send completes; this is why a `ch <- x` paired with a receiving goroutine can be used as an arrival barrier.

---

## Go memory model — happens-before for mutexes

> "For any call to `l.Lock` where `l` is a `sync.Mutex` or `sync.RWMutex`, there is a strict total order over all preceding `l.Unlock` calls, and the n-th call to `l.Lock` is synchronized after the n-th call to `l.Unlock`."
> — Go memory model, *Locks*.

> "Any call to `(*RWMutex).RLock` that returns after a corresponding call to `(*RWMutex).Unlock` is synchronized after that call to `(*RWMutex).Unlock`. Any call to `(*RWMutex).RUnlock` is synchronized before the next call to `(*RWMutex).Lock`."
> — Go memory model, *Locks*.

Two consequences:
- Whatever the n-th unlocking goroutine wrote before `Unlock` is visible to the (n+1)-th locker after `Lock` returns.
- An `RWMutex` writer sees everything every previous reader observed under the read lock, even though readers are not mutually exclusive among themselves.

---

## Closure rules for channels
Summarised from the spec and the `close` built-in:

| Operation | nil chan | open chan | closed chan |
|---|---|---|---|
| `ch <- v` | blocks forever | sends (blocks until receiver / room) | **panics** |
| `<-ch` | blocks forever | receives (blocks if empty) | returns zero + `ok=false` |
| `close(ch)` | **panics** | closes | **panics** |
| `len(ch)`, `cap(ch)` | `0`, `0` | current length / capacity | current length / capacity |

A receive-only channel (`<-chan T`) cannot be closed; `close` requires a bidirectional or send-only channel — enforced at compile time.

---

## Send and receive on nil channels
The blocking-forever behaviour of nil channels is *load-bearing* for the `select` idiom:

```go
var ch chan int          // nil
select {
case v := <-ch:           // never chosen — ch is nil
    use(v)
case <-time.After(time.Second):
    // always runs
}
```

This is how production code disables a `case` in a `select`: by setting the channel variable to nil. It is guaranteed by the spec, not an implementation detail.

---

## Buffer rules and ordering
> "Channels act as first-in-first-out queues. For example, if one goroutine sends values on a channel and a second goroutine receives them, the values are received in the order sent."
> — Go spec, *Channel types* (paraphrased; see runtime `chan.go` for the underlying ring buffer).

There is no ordering guarantee across *different* channels, nor across multiple senders on the same channel beyond FIFO at the channel.

---

## Copy and pointer rules for sync types
The standard library's `go vet` rule `copylocks` enforces:
> "Locks that are erroneously passed by value can be hard-to-find bugs. The vet check `copylocks` reports a copy of any value containing a `sync.Mutex` or other lock."
> — `golang.org/x/tools/go/analysis/passes/copylocks` documentation.

In source: a struct embedding `sync.Mutex` (or any type whose `Lock`/`Unlock` methods take a pointer receiver) must be passed by pointer once it has been locked. The same applies to `sync.WaitGroup`, `sync.Cond`, `sync.Once`, `sync.RWMutex`, `atomic.Value`, `atomic.Int64`, and the `noCopy` marker types in the standard library.

Channels, in contrast, are reference types — copying a channel value copies a pointer to the underlying `hchan`. There is no `noCopy` on channel types.

---

## Cross references in the runtime source

| Symbol | File | What it implements |
|---|---|---|
| `hchan` struct | `src/runtime/chan.go` | Channel header: buffer, send/recv queues, lock |
| `chansend1`, `chansend` | `src/runtime/chan.go` | Implements `ch <- v` |
| `chanrecv1`, `chanrecv2`, `chanrecv` | `src/runtime/chan.go` | Implements `v <- ch` and `v, ok <- ch` |
| `closechan` | `src/runtime/chan.go` | Implements `close(ch)` |
| `selectgo` | `src/runtime/select.go` | Implements `select` |
| `Mutex`, `Lock`, `Unlock` | `src/sync/mutex.go` | Implements `sync.Mutex` (state word + futex-like park) |
| `RWMutex`, `RLock`, `RUnlock`, `Lock`, `Unlock` | `src/sync/rwmutex.go` | Implements `sync.RWMutex` (writer wait counter + reader count) |
| `Map` | `src/sync/map.go` | Implements `sync.Map` (read map + dirty map, amortised) |

Each of these files is short (under 1000 lines) and is the most authoritative description of what these primitives actually do. When the spec is ambiguous, the runtime source is the next reference.

---

[← Back](../)
