---
layout: default
title: Specification
parent: Channel Close Violations
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 5
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/03-channel-close-violations/specification/
---

# Channel Close Violations — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [The close Built-in Function](#the-close-built-in-function)
3. [Send on a Closed Channel](#send-on-a-closed-channel)
4. [Receive From a Closed Channel](#receive-from-a-closed-channel)
5. [Receive From a Nil Channel](#receive-from-a-nil-channel)
6. [Send on a Nil Channel](#send-on-a-nil-channel)
7. [Close on a Nil Channel](#close-on-a-nil-channel)
8. [Close on a Closed Channel](#close-on-a-closed-channel)
9. [The Comma-Ok Form](#the-comma-ok-form)
10. [The range Statement and Close](#the-range-statement-and-close)
11. [The select Statement and Close](#the-select-statement-and-close)
12. [Memory Model Ordering Around Close](#memory-model-ordering-around-close)
13. [Channel Direction Types](#channel-direction-types)
14. [Comparison With Other Languages](#comparison-with-other-languages)
15. [Implementation Details](#implementation-details)
16. [Summary](#summary)

---

## Introduction

This document specifies the precise semantics of `close` and its interactions with channels in Go. It is grounded in the Go Programming Language Specification (golang.org/ref/spec) and the Go Memory Model (go.dev/ref/mem).

Where the spec is terse, this document expands with practical implications. Where the spec is silent, this document refers to authoritative behaviour from the canonical implementation (gc compiler and runtime).

---

## The close Built-in Function

From the Go spec (Close):

> The built-in function `close` records that no more values will be sent on the channel. It is an error if `ch` is a receive-only channel. Sending to or closing a closed channel causes a run-time panic. Closing the nil channel also causes a run-time panic. After calling close, and after any previously sent values have been received, receive operations will return the zero value for the channel's type without blocking. The multi-valued receive operation returns a received value along with an indication of whether the channel is closed.

Signature:

```go
func close(c chan<- Type)
```

Notes:

1. Parameter type is `chan<- Type` (send-only directional) — the compiler enforces that `<-chan` cannot be closed.
2. Return type is none.
3. Panics on close of nil channel, close of closed channel, send on closed channel.
4. No effect on receive operations except the post-close behaviour described below.

### Compile-time restrictions

```go
var ch <-chan int = make(chan int)
close(ch) // compile error: cannot close receive-only channel
```

The receive-only direction is a compile-time check. This implements Rule 4 (the receiver should not close) at the type level.

```go
var ch chan int
close(ch) // valid syntax; runtime panic because ch is nil
```

Nil channels pass the compile-time check (the variable is of type `chan int`, not `<-chan int`). The panic is runtime.

---

## Send on a Closed Channel

From the spec:

> Sending to ... a closed channel causes a run-time panic.

Behaviour:

- The send expression `c <- v` first evaluates `v`.
- The runtime acquires the channel's internal lock.
- If the channel's closed flag is set, the runtime releases the lock and panics with the string `"send on closed channel"`.
- The panic is recoverable via `recover()` in a deferred function.

```go
ch := make(chan int)
close(ch)
ch <- 1 // panic: send on closed channel
```

The panic is observable from the sending goroutine's stack. Other goroutines are not affected unless they share state with the panicking goroutine.

### Buffered channels

Closed buffered channels also panic on send, regardless of buffer occupancy:

```go
ch := make(chan int, 10)
close(ch)
ch <- 1 // panic
```

The buffer is for receive-side draining; sends after close are always rejected.

### Non-blocking send

```go
select {
case ch <- 1:
default:
}
```

If ch is closed, the runtime panics during the case evaluation. The `default` arm does not save you.

---

## Receive From a Closed Channel

From the spec:

> After calling close, and after any previously sent values have been received, receive operations will return the zero value for the channel's type without blocking. The multi-valued receive operation returns a received value along with an indication of whether the channel is closed.

Behaviour:

- For buffered channels, receive drains remaining values first (FIFO).
- After the buffer is empty (or for unbuffered channels), receive returns:
  - The zero value of the element type.
  - `ok = false` in the comma-ok form.
- Receive is non-blocking after close.

```go
ch := make(chan int, 2)
ch <- 1; ch <- 2
close(ch)
fmt.Println(<-ch) // 1
fmt.Println(<-ch) // 2
fmt.Println(<-ch) // 0 (zero value), non-blocking
v, ok := <-ch
fmt.Println(v, ok) // 0 false
```

### Implication for receivers

A receiver can detect close via `ok = false`. It can also detect via `for range`: the loop exits when the channel is closed and drained.

A receiver cannot detect close *before* attempting a receive, because there is no `IsClosed` query in the language.

---

## Receive From a Nil Channel

```go
var ch chan int
<-ch // blocks forever
```

Behaviour: blocks forever. The runtime detects "all goroutines are asleep" deadlock if every goroutine is in this state.

This is sometimes used deliberately: setting a channel variable to nil in a select disables that case forever.

```go
select {
case <-ch1: // active
case <-ch2: // disabled if ch2 is nil
}
```

A `nil` case is never ready, so select considers only the other cases.

---

## Send on a Nil Channel

```go
var ch chan int
ch <- 1 // blocks forever
```

Same as receive: blocks forever. Sometimes used to disable a send arm in a select.

---

## Close on a Nil Channel

```go
var ch chan int
close(ch) // panic: close of nil channel
```

Behaviour: panics with `"close of nil channel"`. Unlike send/receive on nil, close does not block.

The asymmetry (block vs panic) is deliberate: closing a nil channel is almost always a bug; the panic surfaces it. Sending or receiving on a nil channel may be deliberate (select-disabling).

---

## Close on a Closed Channel

```go
ch := make(chan int)
close(ch)
close(ch) // panic: close of closed channel
```

Behaviour: panics with `"close of closed channel"`. The runtime detects via the channel's internal closed flag.

This is the most common close-related bug. The fix is always to ensure exactly one close per channel.

---

## The Comma-Ok Form

```go
v, ok := <-ch
```

`ok` indicates:

- `true`: value successfully received from a send or from the buffer.
- `false`: channel is closed and drained; `v` is the zero value.

The form is the canonical way to detect close.

Spec excerpt:

> If the result of a receive expression is used as the operand of an assignment, the receive expression may have a special form ... where an additional untyped boolean result indicates whether the communication succeeded.

This is a special form of the receive expression. It cannot be used in arbitrary contexts (e.g., as a function argument that takes one value).

### Idiom

```go
for {
    v, ok := <-ch
    if !ok { break }
    process(v)
}
```

Equivalent to `for v := range ch { process(v) }`. The range form is preferred for clarity.

---

## The range Statement and Close

From the spec:

> For channels, the iteration values produced are the successive values sent on the channel until the channel is closed. If the channel is `nil`, the range expression blocks forever.

Behaviour:

- `for v := range ch` iterates until ch is closed.
- After close, the loop receives any buffered values, then exits.
- If ch is nil, the loop blocks forever (the runtime may detect a deadlock).

```go
ch := make(chan int, 3)
go func() {
    for i := 0; i < 5; i++ { ch <- i }
    close(ch)
}()
for v := range ch {
    fmt.Println(v) // 0, 1, 2, 3, 4
}
// loop exits when ch closes
```

### Why range exits on close

The range form is equivalent to a receive in a loop with the comma-ok check:

```go
for {
    v, ok := <-ch
    if !ok { break }
    // use v
}
```

When `ok = false`, the loop terminates. This is exactly the closed-channel behaviour.

### What range does not do

- Range does not close ch when it exits early via break.
- Range does not handle panics from sends to ch (those are sender-side).
- Range does not signal anything to the sender; the sender continues until it decides to stop.

---

## The select Statement and Close

A select statement evaluates each case's channel operation. A case with a closed channel:

- Receive case: always ready, returns zero value (and `ok = false` if comma-ok used).
- Send case: panics when evaluated (send on closed).

```go
select {
case v, ok := <-ch1: // if ch1 closed, ok = false
case ch2 <- 1:        // if ch2 closed, panic
default:
}
```

### Nil channel cases

A case with a nil channel is never ready:

```go
var ch chan int
select {
case <-ch: // never selected
case <-other: ...
}
```

This is the basis of "disable a case by nil-ing the channel".

### Select with closed and open cases

If a select has a closed channel case and an open one, both are ready (the closed one is always ready). Select picks pseudo-randomly:

```go
ch1 := make(chan int)
close(ch1)
ch2 := make(chan int, 1)
ch2 <- 42

select {
case <-ch1: // ready (closed)
case <-ch2: // ready (buffered value)
}
```

Either case may be selected. To prefer the closed signal, do a non-blocking pre-check:

```go
select {
case <-ch1:
    // closed-priority handler
default:
}
select {
case <-ch1: // shouldn't be reached if first check fired
case <-ch2: // normal path
}
```

---

## Memory Model Ordering Around Close

From the Go Memory Model:

> The closing of a channel is synchronized before a receive that returns because the channel is closed.

Formally: let `c` be the close event and `r` be a receive that returns because the channel is closed (`ok = false`). Then `c` synchronizes with `r`; any write that happens before `c` in the closer's goroutine is observable by `r`'s goroutine.

### Practical implication

```go
var data Result

go func() {
    data = compute()
    close(done)
}()

<-done
fmt.Println(data) // guaranteed to see compute's value
```

The write to `data` is sequenced before `close(done)`. The receive sees the close (because it returned a closed-channel reception). By the memory model rule, the receive happens-after the write. The read sees the value.

This is the basis of "broadcast on close" patterns: any data the closer wrote before close is visible to observers after the close.

### Important asymmetry

Writes *before* close are visible. Writes *after* close are not synchronized via the close:

```go
go func() {
    close(done)
    data = compute() // WRITE AFTER CLOSE
}()

<-done
fmt.Println(data) // may NOT see compute's value
```

The race detector flags this; the result is unspecified.

Order matters: writes before close, not after.

### Sends as synchronisation

The memory model also has:

> A send on a channel is synchronized before the completion of the corresponding receive from that channel.

This means sent values carry their pre-send writes to the receiver. Close is a special case where there is no "value" but the synchronisation still holds.

---

## Channel Direction Types

Go has three channel direction types:

- `chan T` — bidirectional.
- `chan<- T` — send-only.
- `<-chan T` — receive-only.

Conversion rules:

- A bidirectional channel can be implicitly converted to either directional type.
- Directional types cannot be converted back to bidirectional.
- Directional types cannot be converted to other directional types.

### close and direction

- `close(ch)` requires `ch` to have type `chan T` or `chan<- T`. Receive-only is rejected at compile time.
- Send on receive-only is rejected.
- Receive on send-only is rejected.

This means: a function with parameter `<-chan T` cannot send to or close the channel. The compiler enforces this.

### API design implication

A function returning `<-chan T`:

- Its caller cannot close.
- Its caller cannot send.
- Its caller can only receive (and range).

This is the canonical way to design a producer API: the function is the closer; the caller is a pure consumer.

A function accepting `chan<- T`:

- The function can send and close.
- The function cannot receive from the channel.

This designates the function as the closer-and-sender; the caller is the receiver.

---

## Comparison With Other Languages

### Rust mpsc (multiple-producer, single-consumer)

```rust
let (tx, rx) = std::sync::mpsc::channel();
drop(tx); // close
```

`drop(tx)` on the *last* sender closes the channel. Multiple senders can be dropped independently; the channel closes when all are dropped. The receiver detects via `recv()` returning `Err`.

Comparison to Go: Rust's mpsc has built-in multi-sender close. Go requires explicit coordination. Rust's approach is more ergonomic for the common case but less flexible (you cannot "force close" before all senders drop).

### Erlang processes

Erlang has no channels; processes communicate via messages. "Close" is implicit: the receiver process terminates when it decides to.

A message-passing system can model close by sending a `done` message:

```erlang
receive
    {data, X} -> process(X), loop();
    done      -> ok
end.
```

Comparison to Go: Erlang's approach is purely message-based. Go's channel close is a special control message handled by the runtime.

### Java BlockingQueue

`java.util.concurrent.BlockingQueue` does not have a close. The producer-consumer pattern uses a sentinel value (e.g., a poison pill):

```java
queue.put(POISON);
```

Consumers check `if (item == POISON) break`. Multiple consumers each need their own poison pill.

Comparison to Go: Java's approach is library-level, not runtime-level. Go's close is a first-class operation with runtime support.

### Python asyncio.Queue

`asyncio.Queue` does not close. Producers signal end-of-stream via sentinels. The `JoinableQueue` adds `task_done` and `join` for explicit completion tracking.

Comparison to Go: Python's approach is similar to Java's. Go's close avoids the sentinel pattern.

### Kotlin Channels

`kotlinx.coroutines.channels.Channel` has `close()` and `cancel()`. Close is a graceful end-of-stream; cancel is an abort. Sends after close raise `ClosedSendChannelException`.

Comparison to Go: Kotlin's API is closer to Go's. The two-method distinction (close vs cancel) is more explicit than Go's pattern of "data channel close" + "done channel close".

### Summary

Go's close is:

- First-class (runtime support, not library).
- Strict (panic on misuse).
- Asymmetric (sender closes; receiver detects).
- One-shot (cannot be reopened).

Other languages mostly use sentinels (Java, Python), implicit close (Rust), or process termination (Erlang). Each has trade-offs.

---

## Implementation Details

These are not specified but are stable across versions.

### The hchan structure

```go
type hchan struct {
    qcount   uint           // total data in queue
    dataqsiz uint           // size of circular queue
    buf      unsafe.Pointer // points to array of elements
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint           // send index
    recvx    uint           // receive index
    recvq    waitq          // list of recv waiters
    sendq    waitq          // list of send waiters
    lock     mutex
}
```

The `closed` field is a uint32 (could be a bool; uint32 for alignment). Read and written under `lock`.

### closechan operation

Approximate pseudo-code:

```
func closechan(c *hchan) {
    if c == nil { panic("close of nil channel") }
    lock(&c.lock)
    if c.closed != 0 {
        unlock(&c.lock)
        panic("close of closed channel")
    }
    c.closed = 1
    // wake up receivers with zero value
    // wake up senders to panic
    unlock(&c.lock)
}
```

The lock is held during the state change. Concurrent operations on the channel are serialised.

### chansend behaviour on closed

```
func chansend(c *hchan, ep unsafe.Pointer, ...) bool {
    lock(&c.lock)
    if c.closed != 0 {
        unlock(&c.lock)
        panic("send on closed channel")
    }
    // ... normal send logic ...
}
```

Closed check before buffer or recvq check. Closed always panics, regardless of other state.

### chanrecv behaviour on closed

```
func chanrecv(c *hchan, ep unsafe.Pointer, ...) (selected, received bool) {
    lock(&c.lock)
    if c.closed != 0 && c.qcount == 0 {
        unlock(&c.lock)
        // return zero value, ok = false
        return true, false
    }
    // ... normal recv logic (including draining buffer) ...
}
```

Closed-and-empty returns zero. Closed-with-buffer drains first.

### Implementation portability

The implementation details above are for gc (the standard compiler/runtime). Other implementations (gccgo, TinyGo) follow the spec but may differ in internal details.

The user-visible behaviour is portable: panic, zero-value-on-receive, range-exits, etc. The internal hchan layout is not.

---

## Edge Cases

### close on a struct{} channel

```go
done := make(chan struct{})
close(done)
v, ok := <-done
// v = struct{}{}, ok = false
```

Same semantics as any other channel. The element type is irrelevant.

### close on a chan of pointers

```go
ch := make(chan *T, 2)
ch <- &T{1}
close(ch)
v, ok := <-ch
// v = &T{1}, ok = true (still buffered)
v, ok = <-ch
// v = nil, ok = false (drained, closed)
```

Pointers' zero value is nil; that's what receive returns after drain.

### close on a chan of interfaces

```go
ch := make(chan error, 1)
ch <- errors.New("oops")
close(ch)
e, ok := <-ch
// e = errors.New("oops"), ok = true
e, ok = <-ch
// e = nil (interface zero), ok = false
```

Interfaces' zero value is nil; receive returns nil after drain.

### close with elements still in buffer

```go
ch := make(chan int, 3)
ch <- 1; ch <- 2
close(ch)
fmt.Println(<-ch) // 1
fmt.Println(<-ch) // 2
v, ok := <-ch
// v = 0, ok = false
```

Buffered values are still accessible; close does not discard them.

### close from within a select

```go
ch := make(chan int)
select {
case ch <- 1:
    close(ch) // can we close here?
default:
}
```

The send case executed; ch had a receiver. close after send is OK if you are the sole sender. If there are other senders, this is a race.

### close on a channel inside a select case

```go
select {
case <-done:
    close(out) // closing in handler
case out <- v:
}
```

If done fires, close out. If `out <- v` fires, we sent successfully. No conflict.

But: another goroutine might also try to close out. If that happens, double-close. Use sync.Once.

---

## Summary

The Go specification's treatment of close is concise:

- `close(ch)` records that no more sends will occur.
- Send on closed: runtime panic.
- Close of closed: runtime panic.
- Close of nil: runtime panic.
- Receive from closed: zero value, ok = false, non-blocking.
- range over channel: exits when closed and drained.
- select on closed channel: receive case always ready; send case panics on evaluation.
- Channel directions: `<-chan` cannot be closed; `chan<-` can.
- Memory model: close happens-before any receive that returns due to close.

The runtime enforces these rules via internal state (the closed flag) and panics when invariants are violated.

Implementation details (hchan, lock semantics) are not part of the spec but are stable in the standard implementation.

For practical use, see `junior.md` through `professional.md` for patterns; the spec is the language definition, while the patterns are conventions for using the language safely.
