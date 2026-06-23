# Or-Done-Channel — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Architectural Role](#architectural-role)
3. [Channel Combinators as a Vocabulary](#channel-combinators-as-a-vocabulary)
4. [Designing Around Cancellation Semantics](#designing-around-cancellation-semantics)
5. [Cross-Cutting Concerns](#cross-cutting-concerns)
6. [Long-Term Maintenance](#long-term-maintenance)
7. [Migration Strategies](#migration-strategies)
8. [Decision Framework](#decision-framework)
9. [Closing Thoughts](#closing-thoughts)

---

## Introduction

At the professional level, the question is no longer "how does `orDone` work?" but "how does it fit the architecture of a system, what does it cost, what does it imply, and when is the broader system better off without it?"

This file is opinionated. It reflects the kind of judgement that comes from running channel-heavy code in production over years — the kind that survives team turnover, version upgrades, and gradual scope expansion.

The reference implementation is the same fifteen lines from the junior file:

```go
func orDone[T any](done <-chan struct{}, c <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            select {
            case <-done:
                return
            case v, ok := <-c:
                if !ok {
                    return
                }
                select {
                case out <- v:
                case <-done:
                    return
                }
            }
        }
    }()
    return out
}
```

The professional move is rarely changing this code. It is choosing whether to use it at all, where to put it, and what to expose around it.

---

## Architectural Role

`orDone` lives at a specific layer in a Go service:

```
                 +-------------------+
                 |  Public API       |   <- context.Context everywhere
                 +-------------------+
                            |
                 +-------------------+
                 |  Service layer    |   <- business logic
                 +-------------------+
                            |
                 +-------------------+
                 |  Pipeline layer   |   <- orDone, tee, bridge, fanIn
                 +-------------------+
                            |
                 +-------------------+
                 |  Producers        |   <- DB cursors, network streams, generators
                 +-------------------+
```

The public API speaks `context.Context`. The producer layer speaks bare channels. The *pipeline layer* in the middle uses combinators — `orDone` and its siblings — to compose producers into useful streams while preserving cancellation. The boundary between the API and the pipeline layer is exactly where `orDone(ctx.Done(), c)` adapters live.

This separation matters: keeping `context.Context` out of the pipeline internals makes the channel code unit-testable without a real context, and keeps the API surface small.

---

## Channel Combinators as a Vocabulary

A mature codebase usually has a small package — `internal/channels`, `pkg/streams`, etc. — containing the entire channel-combinator vocabulary:

```go
package streams

func OrDone[T any](done <-chan struct{}, c <-chan T) <-chan T
func Take[T any](done <-chan struct{}, c <-chan T, n int) <-chan T
func Repeat[T any](done <-chan struct{}, vs ...T) <-chan T
func RepeatFn[T any](done <-chan struct{}, fn func() T) <-chan T
func Tee[T any](done <-chan struct{}, c <-chan T) (<-chan T, <-chan T)
func Bridge[T any](done <-chan struct{}, chans <-chan <-chan T) <-chan T
func FanIn[T any](done <-chan struct{}, cs ...<-chan T) <-chan T
func FanOut[T any](done <-chan struct{}, c <-chan T, n int) []<-chan T
func Filter[T any](done <-chan struct{}, c <-chan T, pred func(T) bool) <-chan T
func Map[T, U any](done <-chan struct{}, c <-chan T, fn func(T) U) <-chan U
```

Every function takes `done` first, every function returns a cancellable output, every function closes its output channels. Once a team agrees to this vocabulary, pipelines become almost prose-like:

```go
nums := streams.Repeat(done, 1, 2, 3)
positive := streams.Filter(done, nums, func(n int) bool { return n > 0 })
squared := streams.Map(done, positive, func(n int) int { return n * n })
first10 := streams.Take(done, squared, 10)
for v := range streams.OrDone(done, first10) {
    fmt.Println(v)
}
```

This is the goal: pipelines that read as data flow, not as goroutine bookkeeping. `orDone` is the foundation of that vocabulary.

If your team has not built this vocabulary, the cost is a tax on every channel pipeline you write. Building it once pays back permanently.

---

## Designing Around Cancellation Semantics

Cancellation in distributed systems is not a single concept. There are at least five distinct semantics:

| Semantic | Meaning | `orDone` fit |
|---|---|---|
| **Drop** | Stop sending, discard in-flight | Natural fit, the default |
| **Drain** | Stop accepting new, deliver remaining | Needs custom `drainOrDone` |
| **Block** | Refuse to cancel until quiescent | Wrong tool — use a state machine |
| **Compensate** | Cancel and emit rollbacks | `orDone` + sibling rollback channel |
| **Defer** | Accept cancel but execute pending | `orDone` after explicit flush |

At the professional level you ask, for *each* pipeline stage, which semantic applies. The wrong semantic is the source of subtle production bugs — payments processed after "cancel," messages dropped after "ack," double-deliveries after retry.

`orDone` gives you Drop. If you need anything else, the pattern is one ingredient, not the whole recipe.

A concrete example: a payments service receives a stream of `Charge` requests. On shutdown, you must *not* drop in-flight charges — they have side effects. The pipeline therefore wraps the input with `orDone` for *new* charges but separately handles in-flight ones via a `WaitGroup`:

```go
ctx, cancel := context.WithCancel(ctx)
var inflight sync.WaitGroup

for charge := range orDoneCtx(ctx, charges) {
    inflight.Add(1)
    go func(c Charge) {
        defer inflight.Done()
        process(c) // not cancellable
    }(charge)
}

cancel()
inflight.Wait() // wait for in-flight goroutines, even after cancel
```

The `orDone` covers the *intake* side. The `WaitGroup` covers the *processing* side. Two different cancellation semantics in one pipeline, expressed clearly.

---

## Cross-Cutting Concerns

### Logging

Sprinkle `log.Printf("ordone exit: cause=%s", cause)` inside the `orDone` goroutine and you have a giant log volume problem at scale. Either:

- Log only at the supervisor level: "pipeline shutting down."
- Use sampled logging if you must log inside `orDone`.
- Or do not log at all and rely on metrics.

In production, metrics beat logs for cardinality reasons. Use logs for unexpected events (panics, errors), not for normal lifecycle transitions.

### Tracing

A wrapped channel hides a goroutine. If you use OpenTelemetry spans, the span from the producer does not naturally propagate to the consumer through `orDone`. You have to thread spans through the value type:

```go
type traced[T any] struct {
    Span trace.Span
    Val  T
}
```

Or recreate context-with-span on the consumer side. Most systems do not need this for pipelines internal to a single service; reserve it for cross-service boundaries.

### Backpressure observation

Track the *time spent in `out <- v`*. If it climbs, you have downstream backpressure. Wrap the inner select:

```go
sendStart := time.Now()
select {
case out <- v:
    metrics.ObserveSend(time.Since(sendStart))
case <-done:
    return
}
```

This single instrumentation, sampled, is one of the most informative pipeline metrics you can collect.

---

## Long-Term Maintenance

Code outlives its authors. `orDone`-using code needs to be:

- **Recognisable.** Use the canonical function name (`orDone` or `OrDone`). Do not invent a synonym.
- **Discoverable.** Keep it in a documented utility package, not duplicated across services.
- **Tested.** A `goleak` suite that runs every cancellation path in CI catches the failure modes that production hides for months.
- **Documented.** Three sentences per public function: when does it close, what happens to in-flight values, what the caller must do.

A common failure mode is "we have three implementations of `orDone` in the codebase because nobody knew the others existed." The fix is a single owned package and a lint rule that flags channel-select-with-cancel patterns outside that package.

For library authors: ship `orDone` only if it would otherwise force users to write the same pattern. If your library returns one channel, wrap it internally with `orDone` and expose the wrapped channel. Do not export `orDone` itself unless your library is, in spirit, a channel-combinator library.

---

## Migration Strategies

If you inherit a codebase with leaky pipelines (long-running goroutines reading from channels that no one closes), you do not "add `orDone` everywhere" in one PR. You stage the migration:

### Stage 1: identify

Run `pprof goroutine` snapshots after a long-running test. Goroutines stuck in `chan receive` or `chan send` for the full test duration are leak candidates. Map them to source code by stack trace.

### Stage 2: introduce `done`

For each leak site, add a `done <-chan struct{}` parameter and observe it in the send/receive selects. Push the parameter outward through the call chain. This usually breaks one or two API signatures; do it deliberately.

### Stage 3: wrap external channels

At the boundary where you do not control the producer, wrap with `orDone(done, externalC)`. The original producer still leaks, but your code stops contributing.

### Stage 4: migrate to context

Once `done` is plumbed, convert to `context.Context`. The cancellation semantics are equivalent; the type now also carries deadlines and values. This is usually the longest stage because it touches every caller.

### Stage 5: enforce

Add a `goleak` test for every pipeline subsystem. Add a linter that disallows naked `for ... range chan` without an associated `done` or context. Now new code cannot regress.

This sequence takes weeks for a large codebase. Do not try to do it all at once. Each stage delivers value on its own.

---

## Decision Framework

When you sit down to write a new channel pipeline:

1. **Does the consumer need to stop before the producer naturally ends?**
   - No → plain `for v := range c`. No cancellation needed.
   - Yes → continue.

2. **Is `context.Context` already plumbed?**
   - Yes → use `orDoneCtx(ctx, c)`, derive `WithCancel` / `WithTimeout` as needed.
   - No → use a bare `done := make(chan struct{})` and pair with `defer close(done)`.

3. **How fast is the stream?**
   - < 100K elements/second → wrap freely.
   - 100K–1M → measure; consider inlining hot stages.
   - > 1M → inline the select, skip the wrapper.

4. **What is the cancellation semantic?**
   - Drop → `orDone` directly.
   - Drain → `drainOrDone`.
   - Block / Compensate / Defer → state machine or `WaitGroup` complementary to `orDone`.

5. **How many cancellation sources?**
   - 1–2 → nest `orDone` or pass two done parameters.
   - 3+ → merge or build a context tree.

6. **Who owns the lifecycle?**
   - A supervisor goroutine. Always one place that creates `done`, closes it, and joins workers.

These questions are the senior-and-above checklist. Asking them once at design time is cheap; debugging the wrong choice in production is expensive.

---

## Closing Thoughts

The or-done-channel pattern is small enough to fit in a tweet and important enough to anchor a chapter in *Concurrency in Go*. It is the smallest piece of code that gives you cancellable channel iteration without leaking goroutines.

At the professional level, your relationship with the pattern changes:

- You no longer write `orDone` from scratch in every project. You depend on (or own) a single canonical implementation.
- You decide the pipeline-vs-API boundary at design time, not after the fact.
- You build the combinator vocabulary so that pipelines read as data flow.
- You think about cancellation semantics — Drop, Drain, Block, Compensate, Defer — not just "is it cancellable."
- You instrument the boundary so production tells you when something is leaking.
- You teach the pattern by writing the code, not by quoting the book.

That last point matters. If your team has two people who can sketch `orDone` on a whiteboard from memory and explain why each `select` is there, your pipelines will not leak. If nobody can, they will. The pattern's value is not in any single use; it is in the shared mental model it gives your team for thinking about cancellation.

In the next section of this directory you will find the same idea applied to `tee-channel`, `bridge-channel`, and on through the rest of the family. They all share the same `done`-first shape, the same closure semantics, the same lifecycle. Once you have `orDone`, you have them all.
