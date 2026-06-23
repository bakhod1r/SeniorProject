# Generator Pattern — Specification

> A precise, normative description of what a "generator" is in this codebase, written so an engineer can verify a candidate implementation against the spec mechanically.

## 1. Definitions

**Generator.** A function whose return signature contains a receive-only channel `<-chan T` and which, when called, spawns exactly one private goroutine responsible for sending values on that channel and closing it.

**Source channel.** The channel returned by a generator.

**Producer goroutine.** The single goroutine spawned by a generator that owns the source channel.

**Consumer.** Any goroutine that receives values from a source channel.

**Cancellation signal.** A receive operation (`<-ctx.Done()`, `<-done`, or equivalent) that, when ready, instructs the producer goroutine to exit.

## 2. Type signatures

### 2.1 Non-cancellable, finite generator

```go
func Name[T any](args ...) <-chan T
```

### 2.2 Cancellable, finite or infinite generator

```go
func Name[T any](ctx context.Context, args ...) <-chan T
// or
func Name[T any](done <-chan struct{}, args ...) <-chan T
```

### 2.3 Generator with synchronous setup error

```go
func Name[T any](ctx context.Context, args ...) (<-chan T, error)
```

### 2.4 Result-typed streaming error

```go
type Result[T any] struct {
    Value T
    Err   error
}

func Name[T any](ctx context.Context, args ...) <-chan Result[T]
```

### 2.5 Permitted return types

A generator MUST return one of:
- `<-chan T`
- `(<-chan T, error)`
- `<-chan Result[T]`
- `(<-chan Result[T], error)`

A generator MUST NOT return `chan T` (bidirectional). The bidirectional channel inside the implementation is implicitly converted to receive-only on return.

## 3. Lifecycle requirements

### 3.1 Channel creation

The producer goroutine's channel MUST be created by the generator before the goroutine is spawned. The channel MUST be created by `make`, not received from outside.

### 3.2 Goroutine spawn

A generator MUST spawn exactly one producer goroutine, started inside the generator function before it returns.

Exceptions: a generator MAY internally spawn worker goroutines that funnel into a single send loop, provided a closer goroutine guarantees the source channel is closed exactly once.

### 3.3 Send loop

The producer goroutine MUST:
- Send each produced value exactly once on the source channel.
- Send values in the order they are produced (FIFO).
- Block on the send when the consumer is not ready, except when a cancellation signal is also ready.

### 3.4 Close

The producer goroutine MUST close the source channel exactly once, before it returns. The close MUST happen via `defer close(out)` as the *first* deferred statement in the goroutine, so that it runs last.

The consumer MUST NOT close the source channel.

### 3.5 Cancellation

If the generator accepts a cancellation signal, the producer goroutine MUST observe it via a `select` containing both the send and the cancellation receive:

```go
select {
case <-ctx.Done():
    return
case out <- v:
}
```

The cancellation MUST be observed at every send point. A `select` whose only cancellable case is at the top of the iteration is non-conforming because a long-running `compute()` between iterations renders cancellation ineffective.

### 3.6 Resource cleanup

If the generator opens external resources (file, socket, cursor, response body), it MUST release them before the source channel is closed. This is achieved by `defer`ring the cleanup *after* `defer close(out)`:

```go
defer close(out)   // first deferred, runs last
defer f.Close()    // runs first (LIFO)
```

## 4. Concurrency requirements

### 4.1 Channel ownership

The source channel is owned exclusively by the producer goroutine. No other goroutine sends on it or closes it.

### 4.2 Multiple consumers

Multiple consumers MAY receive from the same source channel. Each value is delivered to exactly one consumer (whichever wins the race). Order across consumers is not guaranteed.

### 4.3 Multiple producers internally

A generator MAY have multiple producer goroutines internally, provided exactly one closer goroutine is responsible for closing the source channel after all producers have finished. The closer goroutine MUST use `sync.WaitGroup` or equivalent to wait for producers.

## 5. Error semantics

### 5.1 Setup errors

Errors occurring before the producer goroutine is spawned MUST be returned synchronously as the second return value. The source channel MUST NOT be returned in this case.

### 5.2 Streaming errors

Errors occurring inside the producer goroutine MUST be surfaced via one of:
- A `Result[T]` element on the source channel, after which the producer MAY continue or MAY exit.
- A trailing `Err()` method on a returned struct, set before the channel closes.
- A side error channel returned alongside the source channel.

The choice MUST be consistent within a package.

### 5.3 Panics

If the producer goroutine panics, the panic MUST be recovered by the goroutine itself if the generator is documented as panic-safe. The recovered panic value SHOULD be surfaced as a streaming error. The source channel MUST still be closed (the `defer close(out)` runs even on panic).

## 6. Performance requirements

### 6.1 Lazy production

Production MUST be lazy: the producer goroutine SHOULD block between values when the consumer is not reading, except when a buffer permits a small amount of pre-fetching.

### 6.2 Buffer size

The source channel MAY be buffered. The buffer size is a property of the generator and MUST be documented in the function comment if non-zero. A buffer size SHOULD be justified by a measured backpressure profile.

### 6.3 Goroutine count

A generator MUST NOT spawn additional goroutines per yielded value. The goroutine count is a constant property of the generator instance.

## 7. Testability requirements

### 7.1 Race-detector clean

Every generator MUST pass `go test -race` for its intended usage.

### 7.2 Cancellation test

Every cancellable generator MUST have a test that:
1. Starts the generator.
2. Receives at least one value.
3. Cancels.
4. Verifies the source channel closes within a bounded time.

### 7.3 Empty-input test

A generator with a natural empty case MUST be tested with empty input and MUST close the source channel without sending any values.

### 7.4 Leak test

A generator's test suite SHOULD include a leak-detection test (e.g., using `go.uber.org/goleak`) to verify no goroutine outlives the test.

## 8. Compatibility with related patterns

### 8.1 Pipeline source

A generator's output type MUST be compatible with the input type of standard pipeline stages: `func stage(in <-chan T) <-chan U`.

### 8.2 Fan-out

A generator's source channel MUST tolerate being read by multiple consumer goroutines. (Standard channel semantics guarantee this.)

### 8.3 Tee

A generator's source channel MAY be passed into a tee adapter, producing two independent receive-only channels that each see every value.

### 8.4 Bridge

A generator MAY yield other receive-only channels (`<-chan (<-chan T)`); a bridge adapter flattens this to `<-chan T`.

### 8.5 Or-done

A generator that does not natively accept a cancellation signal MAY be wrapped by an `or-done` adapter to become cancellable.

## 9. Forbidden constructs

A generator MUST NOT:
- Return `chan T` (bidirectional).
- Allow consumers to close the source channel.
- Send `nil`-as-sentinel to signal EOF (close is the sentinel).
- Spawn an unbounded number of goroutines per call.
- Block in the generator function itself (only the producer goroutine blocks).
- Retain references to caller-passed slices longer than the producer goroutine's lifetime if the documentation does not say so.

## 10. Conformance checklist

A reviewer applies this checklist to any candidate generator:

- [ ] Return type is `<-chan T` or one of the permitted variants.
- [ ] Exactly one producer goroutine (or one closer if multi-producer).
- [ ] `defer close(out)` is the first deferred statement in the goroutine.
- [ ] If cancellable: every send is inside a `select` with the cancel case.
- [ ] If resource-holding: cleanup deferred after `defer close(out)`.
- [ ] Setup errors returned synchronously.
- [ ] Streaming errors surfaced consistently with package convention.
- [ ] Buffer size documented if non-zero.
- [ ] Race-detector clean.
- [ ] Cancellation test present.
- [ ] No `nil`-as-EOF.

A generator that passes all eleven items conforms to this specification.
