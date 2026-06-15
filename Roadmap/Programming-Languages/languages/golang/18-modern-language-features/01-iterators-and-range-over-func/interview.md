# Iterators & Range-over-Func — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes. All answers assume Go 1.23+.

---

## Junior

### Q1. What is a range-over-func iterator in Go 1.23?

**Model answer.** It is a function of a specific shape that `for ... range` can loop over. The shape is `func(yield func(V) bool)` (named `iter.Seq[V]`) or `func(yield func(K, V) bool)` (named `iter.Seq2[K, V]`). Inside the function you call `yield` once per value; the compiler turns `for v := range f` into a call to `f`, passing the loop body as `yield`. This lets your own types — trees, lists, paginated APIs — work in a normal `for range` loop.

**Common wrong answers.**
- "It's a new keyword `yield`." (No — `yield` is just the conventional parameter name; the compiler recognises the function shape.)
- "It uses channels under the hood." (No — push iterators are single-threaded; no channels or goroutines.)
- "The function runs when you call it." (No — calling it returns the iterator; the loop runs on `range`.)

**Follow-up.** *What's the difference between `Seq` and `Seq2`?* — `Seq` yields one value per step; `Seq2` yields a pair (index/key + value), so you loop with `for k, v := range`.

---

### Q2. What does `yield` return, and why does it matter?

**Model answer.** `yield` returns a `bool`. `true` means the loop wants more values; `false` means it is done (the body broke, returned, or panicked). The iterator must stop calling `yield` the moment it returns `false`. The canonical pattern is `if !yield(v) { return }`. If you ignore it and call `yield` again after `false`, the program panics.

**Common wrong answers.**
- "`yield` returns the next value." (No — it returns whether to continue.)
- "Checking the return is optional." (No — calling after `false` panics.)

**Follow-up.** *What exactly panics?* — "range function continued iteration after function for loop body returned false."

---

### Q3. Write a `Count(n)` iterator that yields 0..n-1.

**Model answer.**
```go
func Count(n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < n; i++ {
            if !yield(i) {
                return
            }
        }
    }
}
```
Used as `for v := range Count(3) { ... }`, producing 0, 1, 2.

**Follow-up.** *If the consumer breaks at v==1, how many times does the inner loop run?* — Twice (i=0 yields true, i=1 the body breaks so `yield` returns false and the iterator returns).

---

### Q4. What `go.mod` setting does this feature require?

**Model answer.** The `go` directive must be `go 1.23` or higher, and the toolchain must be 1.23+. The language feature is gated on the module's *language version*, so even a 1.23 toolchain will reject `for range f` in a module that declares `go 1.22`.

**Follow-up.** *Was it available before 1.23?* — Yes, in 1.22 behind `GOEXPERIMENT=rangefunc`, as a preview. GA in 1.23.

---

### Q5. Name the standard-library iterator helpers you'd use most.

**Model answer.** From `slices`: `Values` (`Seq[V]`), `All` (`Seq2[int,V]`), `Backward`, `Collect` (iterator → slice), `Sorted` (sorted slice). From `maps`: `Keys`, `Values`, `All`, `Collect`. The most common idiom is iterating a map in sorted key order: `for _, k := range slices.Sorted(maps.Keys(m))`.

**Follow-up.** *Difference between `slices.Values` and `slices.All`?* — `Values` yields values only (`Seq`); `All` yields index+value (`Seq2`).

---

## Middle

### Q6. How does `for v := range seq` desugar?

**Model answer.** The compiler rewrites it to roughly `seq(func(v V) bool { body; return true })`. The loop body becomes the `yield` closure; returning `true` means "continue," and a `break`/`return` in the body makes the generated closure return `false`. So "calling `yield(v)`" literally means "run the loop body once with `v`."

**Follow-up.** *How does `return` from the enclosing function work then?* — The closure records the intent and returns `false`; the iterator unwinds (running its `defer`s); then post-call generated code performs the real `return`.

---

### Q7. When do you need `iter.Pull`, and what's the rule about `stop`?

**Model answer.** `iter.Pull(seq)` converts a push iterator into a pull `(next, stop)` pair so you can advance manually. You need it when `for range` can't express the iteration — merging or zipping two sequences, or interleaving on a runtime condition. The rule: **you must call `stop()`**, normally via `defer stop()`, even if you drain fully. `iter.Pull` runs the producer on a parked goroutine; skipping `stop()` leaves it blocked forever — a goroutine leak. `stop()` is idempotent.

**Common wrong answer.** "Use `Pull` for everything for control." (No — push/`for range` is cheaper and leak-resistant; pull costs a goroutine.)

**Follow-up.** *Why does it leak?* — The producer is parked at a `yield`; only `stop()` resumes it to run its `defer`s and exit.

---

### Q8. How do you handle errors in a push iterator?

**Model answer.** Two idioms. (1) `iter.Seq2[T, error]`: yield `(value, nil)` per element and a terminal `(zero, err)` on failure; consumers check `for v, err := range stream` and handle `err`. (2) bufio.Scanner-style: yield only values, store the error internally, expose it via an `Err()` method after the loop. The `Seq2[T, error]` form composes better through `Map`/`Filter` wrappers and is preferred for new APIs.

**Follow-up.** *Can `yield` carry the error directly?* — Only by being a `Seq2`'s second value; a `Seq[V]` has no error channel.

---

### Q9. How does `break` inside a range-over-func loop reach the iterator?

**Model answer.** `break` makes the compiler-generated `yield` return `false`. The iterator's `if !yield(v) { return }` then fires, the iterator stops (running its `defer`s), and control resumes after the `for` statement. If the iterator ignores the `false` and calls `yield` again, it panics. So early `break` correctness depends on the iterator honouring the bool.

**Follow-up.** *Does the iterator's `defer rows.Close()` run on `break`?* — Yes, because `return` triggers the `defer`. That's why cleanup must be deferred, not placed after the loop.

---

### Q10. Are iterators slower than slices?

**Model answer.** Not when inlined. For a concrete, shallow iterator whose `yield` closure doesn't escape, the compiler inlines everything into a plain loop with zero heap allocation — matching a slice range. Cost appears when the iterator is dispatched through an interface (closure escapes), the pipeline is deep/dynamic (closures allocate, call overhead per element), or the body is too big to inline. Verify with `go build -gcflags=-m` and `go test -benchmem`.

**Follow-up.** *Why is a channel-based "iterator" slower?* — It needs a goroutine plus a channel send/receive per element, going through the scheduler.

---

### Q11. What's the difference between a single-use and a restartable iterator?

**Model answer.** A restartable iterator (e.g. `slices.Values(s)`) re-reads its source each time it is ranged — it behaves like a slice. A single-use iterator wraps a consumed stream (a `bufio.Scanner`, `sql.Rows`, network reader); once drained, ranging again yields nothing. The type `iter.Seq[T]` is silent on which it is, so it must be documented. If callers need replay of a single-use iterator, `slices.Collect` it first.

**Follow-up.** *How might a "restartable" iterator accidentally become single-use?* — By capturing a mutable counter in the closure that isn't reset per range.

---

### Q12. What are the two panics related to `yield`?

**Model answer.**
1. Calling `yield` after it returned `false` → "continued iteration after function for loop body returned false." Cause: missing the `if !yield(v) { return }` guard.
2. Calling `yield` after the iterator function has returned (e.g. you stashed `yield` in a goroutine) → "continued iteration after whole loop exit." Cause: letting `yield` escape its valid dynamic extent.

**Follow-up.** *Why are these errors at all?* — The `yield` closure captures loop state that's invalid once the loop is over; the runtime flags the misuse instead of corrupting state.

---

## Senior

### Q13. When should an API return an iterator versus a slice?

**Model answer.** Return an iterator only when laziness pays off: the data is large/unbounded, per-element production is expensive, or early-exit saves work (pagination, search). Return `[]T` when data is small and in memory — callers get `len`, indexing, and reuse for free, and the code is simpler. Returning `iter.Seq[T]` for a three-element list is over-engineering. Also weigh that returning `iter.Seq` raises the library's minimum Go to 1.23.

**Follow-up.** *Seq or Seq2 for a non-keyed stream that can error?* — `Seq2[T, error]`, the idiomatic streaming-error shape.

---

### Q14. How do you guarantee a resource-owning iterator doesn't leak?

**Model answer.** Acquire the resource inside the iterator and `defer` its cleanup immediately, so it runs on all three exit paths: normal completion, early `break`/`return` (which makes `yield` return `false` and triggers `return`), and a panic in the loop body (which unwinds through the iterator). Never clean up *after* the loop — that's skipped on early exit and panic. For `iter.Pull`-based iterators, also `defer stop()` to release the producer goroutine.

```go
rows, _ := db.Query(q)
defer rows.Close() // covers break, return, panic
for rows.Next() { ...; if !yield(r) { return } }
```

**Follow-up.** *Show where a panic in the consumer body runs cleanup.* — It unwinds through `yield` into the iterator, running its deferred `rows.Close()`.

---

### Q15. Explain `iter.Pull`'s internals and why `stop()` is mandatory.

**Model answer.** `iter.Pull` runs the push iterator on a separate goroutine implemented with the runtime's coroutine primitive (`newcoro`/`coroswitch`). The producer runs until its `yield`, which switches control back to the consumer and parks the producer. `next()` switches in, runs one step, and returns the value. Between calls the producer goroutine is alive but suspended — holding its stack, open resources, and locks. If you stop pulling early and never call `stop()`, that goroutine stays parked forever: a leak that also never runs the producer's `defer`s. `stop()` resumes it with a signal that makes the in-flight `yield` return `false`, so it unwinds and exits. Hence `defer stop()`.

**Follow-up.** *Why a coroutine instead of goroutine+channel?* — Lower overhead (direct stack switch, no scheduler round-trip) and deterministic single-threaded handoff.

---

### Q16. Iterators vs channels — when each?

**Model answer.** Push iterators replaced channels-*as-sequences*, not channels-for-concurrency. Use a push iterator for in-process, single-consumer iteration: it's faster (near-zero cost when inlined), `break`-clean (its `defer`s run), and leak-resistant. Use a channel when you need real concurrency — the producer running on its own goroutine while the consumer does other work, or fan-out to N workers. A push iterator is synchronous ping-pong; it gives no parallelism. `iter.Pull` is itself channel-like (it uses a goroutine), so don't reach for it expecting push performance.

**Follow-up.** *What was the classic channel-iterator leak?* — A goroutine feeding a channel that the consumer abandons; the goroutine blocks on send forever. Push iterators avoid this; pull iterators reintroduce it unless you `stop()`.

---

### Q17. How do you propagate cancellation through an iterator?

**Model answer.** `yield` can't carry a cancel signal, so pass a `context.Context` to the iterator *constructor* and have the producer check `ctx.Err()` each iteration (and pass `ctx` to blocking calls like `db.QueryContext`). The consumer cancels by cancelling the context; the producer notices on its next check and returns, possibly yielding the context error via `Seq2[T, error]`. Cancellation is cooperative — it takes effect at the next check, not instantly mid-operation.

**Follow-up.** *Why not check the context in the loop body?* — The body can `break`, but that doesn't stop work already in flight inside the producer; the producer must check `ctx` itself.

---

### Q18. You added `iter.Seq[T]` returns to a popular library and users complain. Why?

**Model answer.** Importing `iter` and using `iter.Seq` requires the Go 1.23 standard library, so the library's minimum supported Go version jumped to 1.23. Conservative consumers pinned to older Go can no longer build it. Returning iterators is therefore a versioning decision — effectively a minor breaking change for the most conservative users. The fix is to (a) document the minimum-Go bump in release notes, and possibly (b) offer slice-returning APIs alongside, or gate the iterator API behind a build constraint, until the ecosystem floor moves past 1.23.

**Follow-up.** *Does merely calling a function that returns `iter.Seq` need 1.23 syntax?* — Calling it is an ordinary call; only the `for range f` *syntax* needs language version 1.23. But importing `iter` needs the 1.23 stdlib.

---

## Staff / Architect

### Q19. Design a composable, lazy stream-processing API for a data pipeline using iterators.

**Model answer.** Build everything around `iter.Seq2[T, error]` so errors thread through. Provide combinators that each return an iterator and forward the stop signal:

- `Source(ctx) Seq2[T, error]` — owns the resource, `defer`s cleanup, checks `ctx`.
- `Filter(seq, pred) Seq2[T, error]`, `Map(seq, f) Seq2[U, error]`, `Take(seq, n)`, `Batch(seq, size)` — each does `if !yield(v, err) { return }` and threads `err` unchanged.
- Terminal sinks: `Collect`, `ForEach`, `Reduce`.

Lazy composition means a `Take(.., 10)` only pulls 10 from the source. Critical design rules: every combinator guards `yield`; errors short-circuit; the source checks `ctx`; resource cleanup is deferred. Performance caveat: deep dynamic pipelines may stop inlining and allocate closures — measure with `-benchmem`; for hot paths, consider a fused combinator rather than many small ones.

**Follow-up.** *How do you keep it from being slower than a hand loop?* — Keep pipelines shallow/static so they inline; provide fused operators (`FilterMap`) for hot paths; benchmark per-element allocs.

---

### Q20. How would you migrate a channel-and-goroutine sequence API to iterators without breaking callers?

**Model answer.** Phased. (1) Add an `iter.Seq`/`Seq2` method alongside the existing `<-chan T` API; mark the channel API deprecated. (2) Internally, implement the channel API on top of the iterator (or vice versa) to avoid duplicated logic — typically wrap the iterator with `iter.Pull` and feed a channel, or feed the iterator from the existing producer. (3) Audit callers for the classic abandoned-goroutine leak the channel API had; the iterator version fixes it for `for range` consumers. (4) Bump minimum Go to 1.23 in a clearly-noted release. (5) Remove the channel API in a later major version. Keep the cancellation story (`context`) consistent across both.

**Follow-up.** *Risk in bridging channel→iterator with `iter.Pull`?* — Forgetting `stop()` in the bridge re-introduces the leak; the bridge must `defer stop()`.

---

### Q21. A team reports intermittent goroutine growth in a service that uses `iter.Pull`. How do you diagnose and fix it?

**Model answer.** Hypothesis: a missing or skipped `stop()`. Steps: (1) capture a goroutine profile (`pprof`) under load — leaked producers show as goroutines parked in `iter.Pull`'s internal `coroswitch`/`yield`. (2) Grep for `iter.Pull(` and verify each is immediately followed by `defer stop()`; look for early returns/`break`s between the `Pull` call and the `defer`, or `stop` placed conditionally. (3) Check panics: if code panics between `Pull` and `defer stop()`, the defer was never registered — register it on the very next line. (4) Add a `goleak` test around the hot paths to catch regressions in CI. The fix is structural: `next, stop := iter.Pull(seq); defer stop()` with nothing in between.

**Follow-up.** *Could it be concurrent `next`/`stop`?* — Yes; `next`/`stop` are not safe for concurrent use. Sharing them across goroutines without synchronisation is undefined and can corrupt the coroutine state.

---

### Q22. When is range-over-func the wrong tool entirely?

**Model answer.** When you actually need concurrency (use channels/goroutines — iterators are synchronous). When the data is small and in memory (use a slice — simpler, indexable). When the consumer needs random access, length, or multiple independent passes over the same materialised data (slice again). When you must support consumers on pre-1.23 Go (the `iter` import and `for range f` syntax aren't available). When the per-element cost of a deep dynamic pipeline (closure allocations, lost inlining) outweighs the laziness benefit on a hot path — there, a fused hand-written loop wins. Iterators are a sequencing/laziness abstraction, not a performance silver bullet and not a concurrency primitive.

**Follow-up.** *Give one case where a slice beats an iterator even for large data.* — When you need to sort, index, or re-scan it multiple times; you'd `Collect` to a slice anyway, so produce the slice directly.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Is `yield` a keyword? | No — conventional parameter name. |
| Type of a single-value iterator? | `iter.Seq[V]` = `func(func(V) bool)`. |
| What does `yield` return? | `bool` — keep going? |
| Panic if you call `yield` after `false`? | Yes. |
| GA in which Go version? | 1.23 (experiment in 1.22). |
| `go.mod` gate? | `go 1.23+`. |
| Push → pull converter? | `iter.Pull` / `iter.Pull2`. |
| Must you call `stop()`? | Yes — or leak a goroutine. |
| Zero-allocation? | When inlined. |
| Map in sorted key order? | `slices.Sorted(maps.Keys(m))`. |

---

## Mock Interview Pacing

A 30-minute interview on Go iterators might cover:

- 0–5 min: warm-up — Q1, Q2, Q3.
- 5–15 min: middle topics — Q6, Q7, Q9, Q12.
- 15–25 min: a senior scenario — Q14, Q15, or Q16.
- 25–30 min: a curveball — Q19 or Q21.

If the candidate claims hands-on iterator experience, drive straight to Q7/Q15 (`iter.Pull` and the `stop()` leak) and Q14 (resource safety on early exit) — both are field-test questions. If they have only read about the feature, stay in middle territory and probe the desugaring (Q6) and the two panics (Q12). A staff candidate should reach Q19 (pipeline design) within fifteen minutes and should immediately bring up the inlining/allocation caveat unprompted.
