---
layout: default
title: Handshaking — Specification
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/06-handshaking/specification/
---

# Handshaking — Specification

[← Back](../)

## Table of Contents
1. [Scope](#scope)
2. [Definitions](#definitions)
3. [Memory Model Rules](#memory-model-rules)
4. [Close-as-Broadcast Semantics](#close-as-broadcast-semantics)
5. [Invariants of the Patterns](#invariants-of-the-patterns)
6. [Edge Cases](#edge-cases)
7. [References](#references)

---

## Scope

This file states the formal guarantees Go provides for the synchronisation primitives that underlie the handshake patterns covered in [Junior](junior.md), [Middle](middle.md), [Senior](senior.md), and [Professional](professional.md). The relevant Go reference is the **Go Memory Model** (golang.org/ref/mem). All quotations below paraphrase, not reproduce, that document.

A handshake is a protocol on top of channels. Its correctness rests on three things:

1. The happens-before guarantees of channel send / receive / close.
2. The runtime's enforcement of "send on closed channel panics" and "receive on closed channel returns zero".
3. The programmer's discipline in following the pattern.

This file pins down (1) and (2). (3) is covered in the per-level files.

---

## Definitions

- **Handshake**: a synchronisation protocol in which goroutine A signals an event on a channel and waits for goroutine B's acknowledgement before A proceeds.
- **One-shot channel**: a channel used as a one-way signal — usually `chan struct{}` — closed exactly once and never sent on.
- **Reply channel**: a channel embedded in a request value so the receiver can send a result back to the sender.
- **`chan chan T`**: a channel whose elements are themselves channels of `T`. Used for rendezvous: the sender provides a fresh inner channel to the receiver and then reads from it.
- **Started signal**: a one-shot channel a child goroutine closes when it has finished initialising; the parent blocks reading it.
- **Stop/Stopped pair**: two one-shot channels — one closed by the parent to request termination, the other closed by the child once termination has completed.
- **N-way barrier**: a coordination point where N parties signal readiness and then all advance together.

---

## Memory Model Rules

The Go Memory Model defines a partial happens-before order over events in a program. For channels:

### 1. Send happens-before completion of corresponding receive

> A send on a channel is synchronised before the completion of the corresponding receive from that channel.

In plain language, if goroutine A executes `c <- v` and goroutine B executes `x := <-c`, then **all writes A made before the send are visible to B after the receive**. This is the rule that makes the started-channel pattern correct:

```go
data := 0
started := make(chan struct{})
go func() {
    data = 42       // (1)
    close(started)  // (2)
}()
<-started           // (3)
fmt.Println(data)   // (4) guaranteed to print 42
```

(1) happens-before (2); (2) happens-before (3); therefore (1) happens-before (4) by transitivity.

### 2. Close happens-before receive of the zero value

> The closing of a channel is synchronised before a receive that returns because the channel is closed.

Close acts as a "send" to every blocked or future receiver. Every goroutine that observes the zero-value receive can see all writes that happened-before the close.

### 3. Receive happens-before send completion on unbuffered channels

> The kth receive on a channel with capacity C is synchronised before the completion of the (k+C)th send from that channel.

For an unbuffered channel (C = 0), the kth receive is synchronised before the kth send completes. This is the property that makes the rendezvous handshake — "I will hand you this exact value at this exact moment" — work.

### 4. Buffered channel ordering

For a buffered channel, the send completes when the value is placed in the buffer (or when a paired receive is ready). Rule (1) still holds — every send synchronises-before its corresponding receive — but goroutines do not block in lock-step. Use unbuffered channels when you need synchronous handoff.

---

## Close-as-Broadcast Semantics

The runtime guarantees the following about a closed channel `c`:

| Operation | Effect |
|-----------|--------|
| `<-c` | Returns the zero value, immediately, for every receiver, any number of times. |
| `v, ok := <-c` | Returns `(zero, false)` after the channel is drained. |
| `c <- v` | Panics. |
| `close(c)` again | Panics. |

These rules make `close` the idiomatic broadcast primitive for one-shot handshakes:

- One goroutine closes `started`. Any number of goroutines waiting on `<-started` unblock simultaneously.
- One goroutine closes `stop`. Any number of workers selecting on `<-stop` see the signal in the next iteration of their loop.

Because close is one-shot — calling it twice panics — handshakes that rely on close-as-broadcast must arrange for **exactly one goroutine** to perform the close. `sync.Once` is the canonical guard.

---

## Invariants of the Patterns

### Started channel

- The channel is created before the child goroutine is started.
- The child closes (or sends to) the channel after all observable initialisation is complete.
- The parent receives from the channel before performing any work that depends on that initialisation.

Violation: closing `started` before initialisation finishes erases the happens-before guarantee for any writes that follow the close.

### Stop / Stopped pair

- `stop` is owned by the parent. Only the parent closes it.
- `stopped` is owned by the child. Only the child closes it.
- The child watches `<-stop` in every blocking select. On receipt, it begins shutdown and closes `stopped` last.
- The parent calls `close(stop)`, then receives `<-stopped`, then returns.

Violation: if the child closes `stopped` before finishing cleanup, the parent may exit while resources are still leaking.

### Request / Ack loop

- The request value carries a private reply channel, allocated by the requester.
- The worker writes exactly one value to the reply channel and never closes it.
- The requester reads exactly one value from the reply channel.

Violation: if the worker writes twice, the second send blocks forever (unbuffered reply channel) or leaks (buffered, sized one).

### N-way barrier

- N child goroutines each close a private `started_i` channel after initialisation.
- The coordinator waits on all N channels before proceeding.

Equivalently, the coordinator uses a single `sync.WaitGroup` of size N — the patterns are interchangeable for the startup case.

---

## Edge Cases

### Race: parent reads before child writes

The parent must hold a reference to the channel before the child goroutine is launched. If the parent allocates the channel inside the child, the parent's first reference to it races with the child's send.

### Receive on nil channel

A receive from a nil channel blocks forever. Some handshakes exploit this — set a stop channel to nil after the first close to disable it in a `select` — but this is a subtle technique and best confined to a comment.

### Buffered ack channels

A common trick is to make the ack channel buffered (capacity 1) so the worker can always send the ack without blocking, even if the requester has lost interest. This breaks the happens-before chain only for the requester that abandoned the read; for the worker, the send still happens-before any later observation of the ack.

### Multiple-ack to a buffered reply channel of size 1

If a worker sends a second ack to the same one-slot buffered channel and the requester never reads it, the second send blocks the worker. Always size the reply channel to the maximum number of replies you intend to write — usually one.

---

## Worked Proof: Started Channel

Claim: in the program below, `data` is read as `42` deterministically.

```go
var data int
started := make(chan struct{})
go func() {
    data = 42       // W
    close(started)  // C
}()
<-started           // R
fmt.Println(data)   // P
```

Proof.

1. By the program-order rule, `W` happens-before `C` within the child goroutine.
2. By the channel close rule, `C` is synchronised-before `R` (the receive that returns because the channel is closed).
3. By the program-order rule, `R` happens-before `P` within the parent goroutine.
4. By transitivity of happens-before, `W` happens-before `P`.
5. Therefore the read of `data` at `P` must observe the write at `W`. The program prints `42`. ∎

This is the simplest valid use of the started-channel pattern. Without step (2) — that is, without the channel close — there would be no happens-before edge between `W` and `P`, and the read at `P` could legally observe the zero value.

## Worked Proof: Stop / Stopped Pair

Claim: in the program below, `cleanupDone` is read as `true` deterministically.

```go
var cleanupDone bool
stop := make(chan struct{})
stopped := make(chan struct{})

go func() {
    defer close(stopped)
    <-stop
    cleanupDone = true   // W
}()

close(stop)              // C1
<-stopped                // R
fmt.Println(cleanupDone) // P
```

Proof.

1. `C1` (close of `stop`) is synchronised-before the child's `<-stop` returning.
2. The child's `<-stop` return happens-before `W` within the child.
3. `W` happens-before `defer close(stopped)` (call it `C2`) within the child, because `defer` evaluates and stores the call but the actual `close(stopped)` runs on goroutine return — after `W`.
4. `C2` is synchronised-before `R`.
5. `R` happens-before `P` within the parent.
6. By transitivity, `W` happens-before `P`. The print reads `true`. ∎

Note: the `defer` placement matters. If the close were placed *before* `cleanupDone = true`, the chain would break: the parent's `R` could complete, then race the child's `W`. Always place the close at the latest possible point — typically `defer close(stopped)` as the first line of the goroutine body, so it runs after every other deferred call and after all explicit statements.

## References

- Go Memory Model: https://go.dev/ref/mem
- Pike, R. *Go Concurrency Patterns* (Google I/O 2012): https://talks.golang.org/2012/concurrency.slide
- Pike, R. *Advanced Go Concurrency Patterns* (Google I/O 2013): https://talks.golang.org/2013/advconc.slide
- Cox, R. *Bell Labs and CSP Threads*: https://swtch.com/~rsc/thread/
- Effective Go — Concurrency: https://go.dev/doc/effective_go#concurrency
- `sync.Cond` documentation: https://pkg.go.dev/sync#Cond
- `context.Context` documentation: https://pkg.go.dev/context
- Hoare, C.A.R. *Communicating Sequential Processes*: https://www.usingcsp.com/
- Boehm, H. *Threads cannot be implemented as a library*: PLDI 2005.
