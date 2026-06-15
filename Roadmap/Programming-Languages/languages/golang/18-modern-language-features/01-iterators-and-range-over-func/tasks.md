# Iterators & Range-over-Func — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are sketched at the end. All tasks assume Go 1.23+ with `go 1.23` in `go.mod`.

---

## Easy

### Task 1 — Your first iterator

Write `Count(n int) iter.Seq[int]` that yields `0..n-1`. Range over `Count(5)` and print each value. Then add a `break` at `v == 3` and confirm it stops.

**Goal.** Internalise the `func(yield func(int) bool)` shape and the `if !yield(i) { return }` guard.

---

### Task 2 — Seq2 with index and value

Write `Enumerate[T any](s []T) iter.Seq2[int, T]` that yields each index and value. Range over it with `for i, v := range Enumerate([]string{"a","b","c"})`. Compare its output to the built-in `for i, v := range s`.

**Goal.** Understand `Seq2` and two-variable range clauses.

---

### Task 3 — Use the stdlib helpers

Given `nums := []int{3, 1, 2}` and `m := map[string]int{"b":2, "a":1}`:

- Print values with `slices.Values(nums)`.
- Print index+value with `slices.All(nums)`.
- Print values reversed with `slices.Backward(nums)`.
- Print map keys in sorted order with `slices.Sorted(maps.Keys(m))`.
- Collect `slices.Values(nums)` back into a slice with `slices.Collect`.

**Goal.** Know which helper returns `Seq` vs `Seq2` and how to collect.

---

### Task 4 — Trigger the version gate

Take a working program from Task 1. Edit `go.mod` to say `go 1.22`. Run `go build`. Observe the compile error. Restore `go 1.23`.

**Goal.** See firsthand that the feature is gated on the `go` directive, not just the toolchain.

---

### Task 5 — Trigger the double-yield panic

Rewrite `Count` to call `yield(i)` **without** checking its return value. Range over it and `break` after the first value. Observe the panic message.

```
panic: range function continued iteration after function for loop body returned false
```

Then fix it with `if !yield(i) { return }` and confirm the panic disappears.

**Goal.** Experience the most common iterator bug and its exact panic.

---

## Medium

### Task 6 — Lazy line reader

Write `Lines(r io.Reader) iter.Seq[string]` using `bufio.Scanner`. Feed it a `strings.Reader` with several lines. Range over it and `break` after the second line. Add a print inside the iterator before `yield` to prove that lines 3+ are never scanned.

**Goal.** Demonstrate laziness — unproduced elements cost nothing.

---

### Task 7 — Resource cleanup on early break

Extend Task 6 so the iterator opens a real file (`os.Open`) and must close it. Put `defer f.Close()` inside the iterator. Range and `break` early. Prove the file is closed (e.g. by tracking with a wrapper that logs `Close`). Then deliberately move the close to *after* the loop and show it leaks on `break`.

**Goal.** Learn why cleanup must be `defer`ed inside the iterator.

---

### Task 8 — Filter / Map / Take pipeline

Implement `Filter`, `Map`, and `Take` combinators (each returns `iter.Seq`). Build `Take(Map(Filter(Count(1_000_000), even), square), 3)` and print the result. Add a counter to `Count` proving it produced far fewer than a million values.

**Goal.** Compose lazy iterators and observe short-circuiting through the whole pipeline.

---

### Task 9 — Streaming errors with Seq2

Write `Records(r io.Reader) iter.Seq2[Record, error]` that JSON-decodes a stream of objects, yielding `(rec, nil)` per object and `(zero, err)` on a decode error. Consume it with `for rec, err := range Records(r)` and stop on the first error.

**Goal.** Implement the idiomatic `Seq2[T, error]` streaming-error pattern.

---

### Task 10 — Convert push to pull with `iter.Pull`

Take `Count(5)`. Use `iter.Pull` to drive it manually: print every value via `next()`, and `defer stop()`. Then write a second version that pulls only the first 2 values and breaks — confirm (with a `goleak` test or a goroutine count) that `stop()` prevents a leak.

**Goal.** Use the pull form and internalise the must-call-`stop` rule.

---

## Hard

### Task 11 — Recursive tree iterator

Define a binary tree. Write `(*Node).InOrder() iter.Seq[int]` using a recursive helper `walk(yield func(int) bool) bool` that threads the bool back up so a `break` deep in the tree unwinds the whole recursion. Test that breaking after the 3rd value stops traversal.

**Goal.** Master the recursive-iterator idiom with correct stop propagation.

---

### Task 12 — Merge two sorted iterators

Write `Merge(a, b iter.Seq[int]) iter.Seq[int]` that merges two ascending iterators into one ascending iterator. Use `iter.Pull` on both, compare heads, `defer stop()` each. Test with `Merge(slices.Values([]int{1,3,5}), slices.Values([]int{2,4,6}))` → `1 2 3 4 5 6`.

**Goal.** Implement the canonical case where pull is necessary (you can't merge with a single `for range`).

---

### Task 13 — Paginated API iterator

Simulate an API with `fetchPage(n) ([]User, hasNext bool, err error)`. Write `AllUsers() iter.Seq2[User, error]` that lazily fetches pages and yields users. Prove that a consumer that finds its target on page 1 and `break`s never fetches page 2 (log fetches).

**Goal.** Build a real-world lazy paginator that stops early.

---

### Task 14 — context cancellation

Extend Task 13's `AllUsers(ctx context.Context)` to check `ctx.Err()` each page and stop, yielding the context error. Drive it from a consumer that cancels the context after 1 page. Confirm iteration stops.

**Goal.** Thread cooperative cancellation through an iterator.

---

### Task 15 — Detect a goroutine leak

Write a test using `go.uber.org/goleak` (or `runtime.NumGoroutine()` before/after) that fails when an `iter.Pull` consumer forgets `stop()`. Then write the correct version and show the test passes.

**Goal.** Build the CI guard that catches the #1 pull-iterator bug.

---

## Bonus / Stretch

### Task 16 — Prove zero-allocation

Benchmark `for v := range Count(1000)` summing values, with `go test -bench=. -benchmem`. Confirm `0 allocs/op`. Then route the iterator through an `iter.Seq[int]` variable assigned via an interface and re-benchmark; observe allocations appear. Use `go build -gcflags=-m` to see the escape decision.

**Goal.** Verify the "zero-allocation when inlined" claim and find where it breaks.

---

### Task 17 — Reimplement `slices.Collect` and `slices.Sorted`

Write your own `Collect[V any](seq iter.Seq[V]) []V` (append loop) and `Sorted[V cmp.Ordered](seq iter.Seq[V]) []V` (collect then `slices.Sort`). Compare against the stdlib versions for correctness.

**Goal.** Understand the collectors are thin wrappers you could have written.

---

### Task 18 — A `Zip` iterator

Write `Zip[A, B any](a iter.Seq[A], b iter.Seq[B]) iter.Seq2[A, B]` that yields paired elements until either runs out. Use `iter.Pull` on both. Test with two slices of different lengths and confirm it stops at the shorter one (with both `stop`s deferred).

**Goal.** Another pull-only pattern; reinforce lifecycle discipline.

---

### Task 19 — Single-use vs restartable

Write two iterators producing the same values: one over a slice (restartable) and one over a `bufio.Scanner` (single-use). Range each twice. Document — in a comment — which one yields nothing the second time and why. Then make the single-use one replayable with `slices.Collect`.

**Goal.** Feel the reusability distinction the type doesn't express.

---

### Task 20 — Panic safety

Write a resource-owning iterator (`defer res.Close()` inside). In the consumer loop body, deliberately `panic`. Recover at the top level. Prove (via a logging `Close`) that the resource was still closed as the panic unwound through the iterator.

**Goal.** Confirm `defer` inside the iterator covers the panic path, not just `break`.

---

## Solutions (sketched)

### Solution 1
```go
func Count(n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < n; i++ {
            if !yield(i) { return }
        }
    }
}
```
Breaking at v==3 runs the inner loop for i=0,1,2,3 (yield returns false at i=3).

### Solution 2
`Enumerate` mirrors `for i, v := range s`; range with two variables. Output identical to the built-in.

### Solution 3
`slices.Values`→`Seq`, `slices.All`/`slices.Backward`→`Seq2`, `slices.Sorted(maps.Keys(m))`→sorted `[]string`, `slices.Collect`→`[]int`.

### Solution 4
`go 1.22` produces: `cannot range over Count(5) (...): requires go1.23 or later`. Restore `go 1.23`.

### Solution 5
Unguarded `yield(i)` panics on the call *after* the body broke. The fix is `if !yield(i) { return }`.

### Solution 6
Print before `yield`; after breaking at line 2, the "scanning line N" log never prints for N≥3 — lines were never read.

### Solution 7
`defer f.Close()` inside the iterator fires on the `return` that follows `!yield`. Moving `Close` after the loop leaks it on `break` (the post-loop code is skipped).

### Solution 8
Each combinator is `func(yield...) { for v := range upstream { if keep/transform; if !yield(...) { return } } }`. `Take(.., 3)` makes `Count`'s counter stop near the first 3 even values.

### Solution 9
```go
for dec.More() {
    var rec Record
    if err := dec.Decode(&rec); err != nil { yield(Record{}, err); return }
    if !yield(rec, nil) { return }
}
```
Consumer checks `err` and `return`s on the first non-nil.

### Solution 10
```go
next, stop := iter.Pull(Count(5))
defer stop()
for { v, ok := next(); if !ok { break }; fmt.Println(v) }
```
The early-break version still `defer stop()`s; without it a goroutine leaks.

### Solution 11
```go
func (n *Node) walk(yield func(int) bool) bool {
    if n == nil { return true }
    if !n.Left.walk(yield) { return false }
    if !yield(n.Val) { return false }
    return n.Right.walk(yield)
}
```
`InOrder` returns `func(yield) { n.walk(yield) }`. The bool unwinds the recursion on break.

### Solution 12
Pull both; loop while both have heads; yield the smaller and advance that side; drain the remainder; `defer` both stops. Output `1 2 3 4 5 6`.

### Solution 13
`AllUsers` loops `page := 1; ;page++`, yields each user, returns on `!yield` or `!hasNext`. Breaking on page 1 means `fetchPage(2)` is never logged.

### Solution 14
Check `if err := ctx.Err(); err != nil { yield(User{}, err); return }` at the top of each page. Cancelling after page 1 stops the next iteration.

### Solution 15
`goleak.VerifyNone(t)` (via `TestMain` or `defer goleak.VerifyNone(t)`) fails when the parked `iter.Pull` producer is still alive — i.e. when `stop()` was skipped.

### Solution 16
`-benchmem` shows `0 allocs/op` for the direct loop. Routing through an interface forces the `yield` closure to escape; allocs appear. `-gcflags=-m` prints `... escapes to heap`.

### Solution 17
`Collect`: `var out []V; for v := range seq { out = append(out, v) }; return out`. `Sorted`: `out := Collect(seq); slices.Sort(out); return out`.

### Solution 18
Pull both; loop while both `ok`; `yield(a, b)`; advance both. `defer` both stops. Stops at the shorter input.

### Solution 19
The slice iterator yields on every range. The scanner iterator yields nothing the second time (the scanner is exhausted). `slices.Collect` it once, then range the collected slice.

### Solution 20
A `panic` in the body unwinds through `yield` and the iterator, running `defer res.Close()`. The Close log appears before the recover at the top level.

---

## Checkpoints

After the easy tasks: you can write `Seq`/`Seq2` iterators, use the stdlib helpers, and recognise the version gate and double-yield panic.
After the medium tasks: you can build lazy readers with correct cleanup, compose pipelines, stream errors via `Seq2`, and use `iter.Pull` with `stop()`.
After the hard tasks: you can write recursive iterators, merge/zip with pull, build lazy paginators with cancellation, and detect goroutine leaks.
After the bonus tasks: you can prove and break the zero-allocation property, reimplement the collectors, and guarantee resource safety under panic.
