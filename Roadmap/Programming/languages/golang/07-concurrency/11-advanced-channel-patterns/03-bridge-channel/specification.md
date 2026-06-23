# Bridge-Channel — Specification

## Table of Contents
1. [Scope](#scope)
2. [Terminology](#terminology)
3. [Function Signature](#function-signature)
4. [Behavioural Contract](#behavioural-contract)
5. [Pre-conditions](#pre-conditions)
6. [Post-conditions](#post-conditions)
7. [Invariants](#invariants)
8. [Error Conditions](#error-conditions)
9. [Performance Guarantees](#performance-guarantees)
10. [Conformance Tests](#conformance-tests)
11. [Versioning Notes](#versioning-notes)

---

## Scope

This specification defines the contract for the `bridge` (or `Bridge`) function as introduced in Katherine Cox-Buday's *Concurrency in Go* (O'Reilly, 2017) and as commonly implemented in modern Go codebases. The specification covers both the `done <-chan struct{}` and `context.Context` forms; they are behaviourally equivalent for the purposes of this document and we use `done` interchangeably with `ctx.Done()` unless explicitly noted.

The specification covers a single-goroutine, order-preserving implementation. Variants such as `BridgeParallel` are out of scope; they have a different name and a different contract.

---

## Terminology

| Term | Meaning |
|------|---------|
| **Outer channel** | The receive-only channel of receive-only channels of `T` passed as input. |
| **Inner channel** | An element received from the outer channel. |
| **Output channel** | The receive-only channel of `T` returned by bridge. |
| **Done** | The cancellation signal, either `done <-chan struct{}` or `ctx.Done()`. |
| **Drained** | An inner channel is "drained" once a receive from it has returned `ok == false`. |
| **Active** | A bridge instance is "active" between the start of its helper goroutine and the close of its output channel. |

---

## Function Signature

The canonical signature is:

```go
func Bridge[T any](ctx context.Context, chanStream <-chan <-chan T) <-chan T
```

Equivalently, the `done`-based form:

```go
func Bridge[T any](done <-chan struct{}, chanStream <-chan <-chan T) <-chan T
```

Both:

- Are generic over `T`.
- Return a receive-only channel — the output type is `<-chan T`.
- Accept cancellation as the first parameter.
- Accept the outer channel-of-channels as the second parameter.
- Do not return an error.

### Parameter constraints

- `chanStream` MUST be non-nil. Passing a nil outer channel is undefined behaviour (the helper goroutine will block on receive forever).
- `ctx` MUST be non-nil. Passing `nil` is undefined behaviour. Use `context.Background()` to indicate "no cancellation."
- `T` may be any type. No constraints beyond `any`.

---

## Behavioural Contract

Bridge MUST satisfy the following:

### B1: Output is monotonically appended from inner channels

For each inner channel `c_i` received from `chanStream` in order, all values received from `c_i` are sent to the output channel before any value from `c_{i+1}` is sent. Order within an inner channel is preserved exactly.

### B2: Output closes on EOF

If `chanStream` is closed by its sender and bridge has drained the last inner channel received from `chanStream`, bridge MUST close the output channel.

### B3: Output closes on cancellation

If `done` is closed (or `ctx` is cancelled) at any point during bridge's lifetime, bridge MUST close the output channel within a bounded number of channel operations.

### B4: No value forwarded after cancellation

After `done` is closed, no value received from any inner channel MAY be sent to the output channel.

Strictly: between the moment `done` is observed and the moment the output is closed, the helper goroutine MAY hold one received-but-not-forwarded value; that value MUST be discarded.

### B5: Single output closure

Bridge MUST close the output channel exactly once. Double-closing the output channel is forbidden.

### B6: No closure of inner channels

Bridge MUST NOT close any inner channel. Closing of inner channels is the sole responsibility of their producers.

### B7: No closure of the outer channel

Bridge MUST NOT close `chanStream`. Closing of `chanStream` is the sole responsibility of its sender.

### B8: One helper goroutine

A bridge instance MUST launch exactly one persistent helper goroutine for its own loop. (The canonical implementation also launches one `OrDone` helper per inner channel; this is part of the implementation, not the contract — alternative implementations may inline.)

### B9: No retained references after termination

Once bridge closes the output channel, the helper goroutine MUST exit and release all references to received values and to `chanStream`. Memory must not be retained beyond termination.

---

## Pre-conditions

- `chanStream` is non-nil.
- `ctx` (or `done`) is non-nil.
- Each inner channel that will be sent on `chanStream` will eventually be closed by its sender, OR `ctx` will eventually be cancelled.

If neither condition holds (an inner channel never closes AND cancellation never fires), bridge will block forever on that inner channel — by design.

---

## Post-conditions

After bridge's output channel is closed:

- The helper goroutine has exited.
- All `OrDone` helpers spawned by bridge have exited.
- No value will be sent on the output channel.
- The output channel may still be received-from; receivers will observe the closed state.

---

## Invariants

### I1: At-most-once delivery

Every value received from an inner channel is either sent to the output exactly once, or discarded (if `done` fires between receive and send). It is never sent twice.

### I2: Output order is the concatenation of inner-channel orders

Let `c_1, c_2, ..., c_n` be the inner channels received from `chanStream`, in order. Let `v_{i,1}, v_{i,2}, ...` be the values from `c_i` in order. The output sequence is `v_{1,1}, v_{1,2}, ..., v_{2,1}, v_{2,2}, ...` — concatenation, no interleaving.

### I3: No more than one value in-flight

At any moment, bridge's helper goroutine holds at most one received-but-not-forwarded value. There is no internal queue.

### I4: Output closure precedes goroutine exit

The output channel is closed via `defer close(out)` immediately before the helper goroutine exits. Other goroutines observing the close are guaranteed that the helper has finished.

---

## Error Conditions

Bridge has no error return value. The following situations are not errors but are noted:

### E1: `chanStream` emits a nil inner channel

Bridge attempts to read from the nil channel. Receives on a nil channel block forever. The bridge will stall until `done` fires. This is consistent with general Go channel semantics; bridge does not protect against malformed input.

### E2: `chanStream` is itself nil

Receives on nil block forever. Bridge will stall until `done` fires. Undefined behaviour per the pre-condition.

### E3: An inner channel sends a panic-causing value

Bridge does not unmarshal or inspect values; it forwards them. If the consumer panics on a value, that is consumer-side behaviour.

### E4: A goroutine other than bridge closes the output

This is forbidden. Bridge has exclusive ownership of the output channel. External closure produces undefined behaviour (typically a panic on bridge's `close(out)`).

---

## Performance Guarantees

### Throughput

Each value forwarded through bridge incurs:

- One receive from an inner channel.
- One send to the output.

If `OrDone` is used (canonical), an additional channel hop per value.

On modern x86-64 hardware: ~50–200 ns per value. No allocations on the hot path if `T` is a value type and the inner/output channels are reused.

### Memory

- O(1) per bridge instance: one output channel, one helper goroutine stack (~2 KB initially).
- O(1) per active inner channel: one `OrDone` helper goroutine and channel.

### Latency

Worst-case latency from cancellation to output close: one channel-operation worth of select. Typically < 1 ms even under contention.

### Scaling

Bridge does not scale with inner-channel count. One bridge serves any number of inner channels with constant resource cost.

---

## Conformance Tests

A conformant implementation MUST pass these tests:

### T1: Empty outer channel

```go
ctx := context.Background()
cs := make(chan (<-chan int))
close(cs)
out := Bridge(ctx, cs)
v, ok := <-out
assert(!ok, "expected closed output")
```

### T2: Single inner channel

```go
cs := make(chan (<-chan int), 1)
inner := make(chan int, 3)
inner <- 1; inner <- 2; inner <- 3; close(inner)
cs <- inner; close(cs)
out := Bridge(ctx, cs)
var got []int
for v := range out {
    got = append(got, v)
}
assert(equal(got, []int{1, 2, 3}))
```

### T3: Multiple inner channels preserve order

```go
cs := make(chan (<-chan int), 3)
for i := 0; i < 3; i++ {
    c := make(chan int, 2)
    c <- i*2; c <- i*2+1; close(c)
    cs <- c
}
close(cs)
got := drain(Bridge(ctx, cs))
assert(equal(got, []int{0,1,2,3,4,5}))
```

### T4: Cancellation closes output

```go
ctx, cancel := context.WithCancel(context.Background())
cs := make(chan (<-chan int))
inner := make(chan int) // never sends, never closes
go func() { cs <- inner }()
out := Bridge(ctx, cs)
cancel()
select {
case _, ok := <-out:
    assert(!ok)
case <-time.After(time.Second):
    fail("bridge did not close after cancel")
}
```

### T5: No goroutine leak

Using `goleak`, run T1–T4 and assert no goroutines remain.

### T6: Empty inner channel handled

```go
cs := make(chan (<-chan int), 2)
empty := make(chan int); close(empty)
full := make(chan int, 1); full <- 42; close(full)
cs <- empty; cs <- full; close(cs)
got := drain(Bridge(ctx, cs))
assert(equal(got, []int{42}))
```

### T7: Inner channel that arrives during cancellation

```go
ctx, cancel := context.WithCancel(context.Background())
cs := make(chan (<-chan int))
out := Bridge(ctx, cs)
cancel()
// After cancel, bridge should exit without consuming cs.
select {
case _, ok := <-out:
    assert(!ok)
case <-time.After(time.Second):
    fail("bridge did not exit on cancel")
}
```

---

## Versioning Notes

### Pre-generics (Go < 1.18)

Bridge can be written with `interface{}` element type. The signature becomes `func bridge(done <-chan struct{}, chanStream <-chan <-chan interface{}) <-chan interface{}`. Consumers must type-assert. This form is obsolete.

### Generics (Go 1.18+)

The signature uses `T any`. This is the recommended form.

### Range-over-func (Go 1.23+)

A non-channel form is possible:

```go
func BridgeSeq[T any](chanStream <-chan <-chan T) iter.Seq[T]
```

This form has a different lifecycle (no helper goroutine, synchronous cancellation via the consumer's `yield` return) and a different conformance test set. It is not a drop-in replacement for the channel-based bridge.

### Cox-Buday original

The book uses the `done <-chan struct{}` form and `interface{}` values. Modern code should use `context.Context` and generics. The behavioural contract is identical.
