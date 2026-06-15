# Iterators & Range-over-Func — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `iter` Package in Full](#the-iter-package-in-full)
3. [How `range`-over-Func Desugars](#how-range-over-func-desugars)
4. [`break`, `continue`, `return`, `goto`, Labels](#break-continue-return-goto-labels)
5. [The `yield` Contract and the Double-Call Panic](#the-yield-contract-and-the-double-call-panic)
6. [`iter.Pull` and `iter.Pull2`: Push → Pull](#iterpull-and-iterpull2-push--pull)
7. [The Standard-Library Helpers (`slices`, `maps`)](#the-standard-library-helpers-slices-maps)
8. [Writing Real Iterators (Tree, Pagination, Lines)](#writing-real-iterators-tree-pagination-lines)
9. [Composing Iterators (Filter, Map, Take)](#composing-iterators-filter-map-take)
10. [Errors in Iterators](#errors-in-iterators)
11. [Common Iterator Errors and Their Causes](#common-iterator-errors-and-their-causes)
12. [Self-Assessment](#self-assessment)
13. [Summary](#summary)

---

## Introduction

You already know the mechanical shape: an iterator is `func(yield func(V) bool)`, you call `yield` per value, and `if !yield(v) { return }` is the guard. The middle-level questions are: *what does the compiler actually turn `for x := range f` into?*, *how do `break`/`return`/`goto` survive the function boundary?*, *when do I need the pull form?*, and *what exactly does the standard library give me?*

This file fills in the machinery between "I can write a `Count`" and "I can design a composable iterator library." After reading you will:
- Know the full `iter` package: `Seq`, `Seq2`, `Pull`, `Pull2`
- Explain the desugaring of `range`-over-func into a `yield` call
- Predict how `break`, `continue`, `return`, `goto`, and labelled jumps behave
- Know exactly when `yield` returns `false` and what panics if you ignore it
- Convert a push iterator to a pull `(next, stop)` pair and know the must-call-`stop` rule
- Use every 1.23 stdlib helper correctly

---

## The `iter` Package in Full

The entire public surface of `iter` is small:

```go
package iter

// Push iterators.
type Seq[V any]     func(yield func(V) bool)
type Seq2[K, V any] func(yield func(K, V) bool)

// Push → pull converters.
func Pull[V any](seq Seq[V]) (next func() (V, bool), stop func())
func Pull2[K, V any](seq Seq2[K, V]) (next func() (K, V, bool), stop func())
```

That is it. Four identifiers. `Seq` and `Seq2` are the *push* iterators you range over. `Pull` and `Pull2` convert a push iterator into a *pull* interface — a `next` function you call to drive iteration yourself, and a `stop` function you must call to release the iterator.

The asymmetry is deliberate: push iterators are easy to *write* (a normal loop calling `yield`) and easy to *consume* with `for range`. Pull iterators are what you need when `for range` is not expressive enough — when you must advance two sequences in lockstep, or interleave producers. Everything is built on the push form; pull is derived from it.

---

## How `range`-over-Func Desugars

When the compiler sees:

```go
for v := range seq {
    body(v)
}
```

where `seq` has type `func(V) bool`-compatible (i.e. `iter.Seq[V]`), it rewrites it to roughly:

```go
seq(func(v V) bool {
    body(v)
    return true // "keep going" — unless body breaks/returns/etc.
})
```

The loop body becomes the `yield` function. "Run the body once" *is* "call `yield`." The `return true` at the end means "the body completed normally, send the next value." If the body contains a `break`, `return`, or similar, the generated `yield` returns `false` instead (see next section).

For `Seq2`:

```go
for k, v := range seq2 {
    body(k, v)
}
// becomes:
seq2(func(k K, v V) bool {
    body(k, v)
    return true
})
```

Two consequences worth internalising:

1. **The loop variables are the `yield` parameters.** `v` in `for v := range seq` is exactly the argument the iterator passes to `yield`.
2. **Per-iteration scoping (Go 1.22+) still holds.** Each iteration gets a fresh `v`. Capturing `v` in a closure inside the body is safe, just like with slice ranges since 1.22.

The desugaring is not a literal source transform you would write by hand — `break`/`return` need special handling the naive version above cannot express. That is the next section.

---

## `break`, `continue`, `return`, `goto`, Labels

This is the subtle part. The loop body is lifted into a `yield` closure, yet `break`, `continue`, and `return` must still mean what they always mean — break the *loop*, return from the *enclosing function*. The compiler makes this work.

### `continue`

`continue` in the body means "this iteration is done; ask for the next value." The generated `yield` simply returns `true`. The iterator calls `yield` again for the next element. Easiest case.

### `break`

`break` means "stop the loop." The generated `yield` returns `false`. The iterator's `if !yield(v) { return }` fires, the iterator stops, and control resumes *after* the `for` statement. The iterator must honour the `false`.

### `return` (from the enclosing function)

```go
func find(seq iter.Seq[int], target int) bool {
    for v := range seq {
        if v == target {
            return true // returns from find, not just the loop
        }
    }
    return false
}
```

A `return` inside the body must exit `find`, not merely stop the loop. The compiler implements this by having `yield` return `false` (to stop the iterator) and then, once the iterator has unwound, executing the actual `return` with its value. The iterator's `defer`s run in between. The net effect is exactly what you would expect from a slice range.

### `goto` and labelled `break`/`continue`

Labelled `break`/`continue` targeting an *outer* loop, and `goto` to a label outside the ranged loop, also work. The mechanism generalises: `yield` returns `false`, the iterator tears down, and then the non-local jump completes. A `goto` *into* the range body from outside is not allowed (it never was for any loop).

### The key guarantee

From the body author's perspective, **range-over-func loops behave identically to range-over-slice loops** with respect to control flow. `break` breaks, `return` returns, labels work, `defer`s in the enclosing function run at the right time. The only new obligation is on the *iterator author*: honour `yield`'s `false` return.

---

## The `yield` Contract and the Double-Call Panic

The contract has two sides.

### What the consumer (compiler-generated `yield`) guarantees

- `yield` returns `true` if the loop wants more values.
- `yield` returns `false` exactly once the loop is finished (break/return/goto/panic in the body, or the loop reached the end via the iterator returning).
- After returning `false`, `yield` must not be called again.

### What the iterator author must do

- Stop calling `yield` as soon as it returns `false`.
- Run cleanup (close files, release locks) — ideally via `defer` so it runs on normal completion *and* early stop *and* panic.

### The panics

The runtime enforces the contract:

1. **Calling `yield` after it returned `false`** panics with: *"range function continued iteration after function for loop body returned false."* This catches the most common bug — ignoring the bool.
2. **Calling `yield` after the iterator function has returned** (e.g. you stashed `yield` in a goroutine and called it later) also panics: *"range function continued iteration after whole loop exit."*

Both panics exist because the compiler-generated `yield` is only valid *during* the call to the iterator. It captures loop state that becomes invalid once the loop is over. The runtime sets a flag and checks it; a late call trips the flag.

The practical rule is unchanged from junior level: `if !yield(v) { return }`, and never let `yield` escape the iterator's own call stack.

---

## `iter.Pull` and `iter.Pull2`: Push → Pull

`for range` is a *push* model: the iterator drives, calling your body. Sometimes you need to drive yourself — to pull one value at a time, on your schedule. That is what `iter.Pull` provides.

```go
next, stop := iter.Pull(seq)
defer stop() // MANDATORY

for {
    v, ok := next()
    if !ok {
        break
    }
    use(v)
}
```

- `next()` returns the next `(value, true)`, or `(zero, false)` when exhausted.
- `stop()` releases the iterator. **You must call it**, normally via `defer`, even if you drain the iterator fully. Calling `stop()` more than once is safe (idempotent).

### How it works (and why `stop` matters)

`iter.Pull` runs the push iterator on a **separate goroutine**, blocked at each `yield`, and hands you a `next` that unblocks it for one step. The goroutine stays parked between `next()` calls.

This is the crux: if you stop pulling early (you got what you needed after 3 of a million values) and never call `stop()`, **that goroutine stays blocked forever — a goroutine leak.** `stop()` signals the parked goroutine to unwind (its `yield` returns `false`), letting it run `defer`s and exit. Hence the must-call-`stop` rule. `defer stop()` immediately after the `iter.Pull` call is the idiom.

### When you actually need pull

The push form (`for range`) handles almost everything. Reach for `Pull` only when you must advance iteration manually:

- **Merging / zipping two sequences.** To produce `min(a, b)` step by step you must look at the head of *both* and advance one — impossible with a single `for range`.
- **Interleaving on a condition** that depends on values you have already pulled.
- **Adapting an iterator into a different interface** (e.g. an `io.Reader`-style `Read` that returns N at a time).

```go
// Merge two sorted Seq[int] into one sorted Seq[int].
func Merge(a, b iter.Seq[int]) iter.Seq[int] {
    return func(yield func(int) bool) {
        na, sa := iter.Pull(a)
        defer sa()
        nb, sb := iter.Pull(b)
        defer sb()

        va, oka := na()
        vb, okb := nb()
        for oka && okb {
            if va <= vb {
                if !yield(va) { return }
                va, oka = na()
            } else {
                if !yield(vb) { return }
                vb, okb = nb()
            }
        }
        for oka { if !yield(va) { return }; va, oka = na() }
        for okb { if !yield(vb) { return }; vb, okb = nb() }
    }
}
```

`Pull2` is the same but for `Seq2`: `next()` returns `(K, V, bool)`.

---

## The Standard-Library Helpers (`slices`, `maps`)

Go 1.23 added iterator producers and collectors. Memorise their arities.

### `slices`

| Function | Returns | Yields |
|----------|---------|--------|
| `slices.All(s)` | `Seq2[int, V]` | index, value (ascending) |
| `slices.Values(s)` | `Seq[V]` | value (ascending) |
| `slices.Backward(s)` | `Seq2[int, V]` | index, value (descending) |
| `slices.Collect(seq)` | `[]V` | drains a `Seq[V]` into a slice |
| `slices.Sorted(seq)` | `[]V` | collects then sorts (ordered V) |
| `slices.SortedFunc(seq, cmp)` | `[]V` | collects then sorts with `cmp` |
| `slices.SortedStableFunc(seq, cmp)` | `[]V` | stable sorted |

### `maps`

| Function | Returns | Yields |
|----------|---------|--------|
| `maps.Keys(m)` | `Seq[K]` | keys (unordered) |
| `maps.Values(m)` | `Seq[V]` | values (unordered) |
| `maps.All(m)` | `Seq2[K, V]` | key, value (unordered) |
| `maps.Collect(seq2)` | `map[K]V` | drains a `Seq2[K,V]` into a map |

### Idiomatic combinations

```go
// Sorted keys of a map:
for _, k := range slices.Sorted(maps.Keys(m)) { ... }

// Map → slice of values, then sort:
vals := slices.Sorted(maps.Values(m))

// Collect a custom iterator into a map:
m := maps.Collect(pairs())   // pairs() is iter.Seq2[K,V]

// Build a set from a slice iterator and back:
seen := slices.Collect(slices.Values(dedup(slices.Values(s))))
```

Note that `maps.Keys`/`maps.Values`/`maps.All` yield in *unspecified* order (map iteration order is randomised). `slices.Sorted` is the standard way to impose order.

---

## Writing Real Iterators (Tree, Pagination, Lines)

### In-order tree walk

```go
type Node struct {
    Val         int
    Left, Right *Node
}

func (n *Node) InOrder() iter.Seq[int] {
    return func(yield func(int) bool) {
        n.walk(yield)
    }
}

// walk returns false if the consumer asked to stop, so callers can short-circuit.
func (n *Node) walk(yield func(int) bool) bool {
    if n == nil {
        return true
    }
    if !n.Left.walk(yield) {
        return false
    }
    if !yield(n.Val) {
        return false
    }
    return n.Right.walk(yield)
}
```

The recursive helper threads the `bool` back up so a `break` deep in the tree unwinds the whole recursion. This is the standard recursive-iterator idiom.

### Paginated API

```go
func AllUsers(c *Client) iter.Seq[User] {
    return func(yield func(User) bool) {
        for page := 1; ; page++ {
            users, hasNext, err := c.fetchPage(page)
            if err != nil {
                return // or yield an error via Seq2[User, error]
            }
            for _, u := range users {
                if !yield(u) {
                    return // stops fetching further pages too
                }
            }
            if !hasNext {
                return
            }
        }
    }
}
```

The win: a consumer that finds its user on page 1 and `break`s never fetches page 2.

### Line reader

```go
func Lines(r io.Reader) iter.Seq[string] {
    return func(yield func(string) bool) {
        sc := bufio.NewScanner(r)
        for sc.Scan() {
            if !yield(sc.Text()) {
                return
            }
        }
        // sc.Err() handled by caller or via Seq2[string, error]
    }
}
```

---

## Composing Iterators (Filter, Map, Take)

Iterators wrap iterators, no intermediate slices:

```go
func Filter[V any](seq iter.Seq[V], keep func(V) bool) iter.Seq[V] {
    return func(yield func(V) bool) {
        for v := range seq {
            if keep(v) {
                if !yield(v) {
                    return
                }
            }
        }
    }
}

func Map[A, B any](seq iter.Seq[A], f func(A) B) iter.Seq[B] {
    return func(yield func(B) bool) {
        for a := range seq {
            if !yield(f(a)) {
                return
            }
        }
    }
}

func Take[V any](seq iter.Seq[V], n int) iter.Seq[V] {
    return func(yield func(V) bool) {
        i := 0
        for v := range seq {
            if i >= n {
                return
            }
            if !yield(v) {
                return
            }
            i++
        }
    }
}
```

Usage reads as a pipeline:

```go
even := Filter(Count(1_000_000), func(x int) bool { return x%2 == 0 })
firstThree := Take(even, 3)
for v := range firstThree {
    fmt.Println(v) // 0 2 4 — and Count never ran a million times
}
```

Because everything is lazy, `Take(.., 3)` ensures the upstream `Count` produces only as many values as needed. Each wrapper is a push iterator that forwards `false` upstream via `if !yield(v) { return }`. Composition correctness *depends* on every layer honouring the bool.

---

## Errors in Iterators

A push iterator cannot `return error`. Two idioms:

### `Seq2[T, error]`

```go
func Records(r io.Reader) iter.Seq2[Record, error] {
    return func(yield func(Record, error) bool) {
        dec := json.NewDecoder(r)
        for dec.More() {
            var rec Record
            if err := dec.Decode(&rec); err != nil {
                yield(Record{}, err) // terminal error
                return
            }
            if !yield(rec, nil) {
                return
            }
        }
    }
}

for rec, err := range Records(r) {
    if err != nil {
        return err
    }
    handle(rec)
}
```

### Post-loop `Err()`

Mirror `bufio.Scanner`: yield only values, store the error, expose it after the loop. Use when the error is always terminal and never per-element.

The `Seq2[T, error]` form composes better with generic helpers and is generally preferred for new APIs.

---

## Common Iterator Errors and Their Causes

### `range function continued iteration after function for loop body returned false`

You called `yield` again after it returned `false`. Cause: missing `if !yield(v) { return }`. Fix: guard every `yield`. In a recursive iterator, thread the bool back up the recursion.

### `range function continued iteration after whole loop exit`

You captured `yield` and called it after the iterator returned (e.g. stashed it in a struct or a goroutine). `yield` is only valid during the iterator's own call. Fix: never let `yield` escape.

### Goroutine leak after using `iter.Pull`

You forgot `stop()`. The pull goroutine stays parked at a `yield`. Fix: `defer stop()` immediately after `iter.Pull`. `go test -run X -count=1` plus `goleak`, or pprof's goroutine profile, will show the leak.

### `cannot range over seq (variable of type func(func(int) bool))`

`go.mod` declares a `go` version below `1.23`. Fix: bump to `go 1.23`+. (The toolchain must also be 1.23+.)

### Iterator yields nothing on the second range

It is a single-use iterator wrapping a consumed stream. Fix: `slices.Collect` it once and range the slice, or rewrite it to be restartable.

### Deadlock / hang in `iter.Pull` consumer

You called `next()` from inside the same iterator's `yield` body, or nested pulls incorrectly. Pull runs the producer on another goroutine; recursive/re-entrant misuse can deadlock. Keep pull-driving code outside the producer.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] List the full `iter` package surface (`Seq`, `Seq2`, `Pull`, `Pull2`)
- [ ] Explain how `for v := range seq` desugars into a `yield` call
- [ ] Predict the behaviour of `break`, `continue`, `return`, `goto`, and labels in a range-over-func loop
- [ ] State both `yield` panic conditions and what causes each
- [ ] Convert a push iterator to pull with `iter.Pull` and explain the must-call-`stop` rule
- [ ] Explain why forgetting `stop()` leaks a goroutine
- [ ] Use every `slices`/`maps` 1.23 helper with the correct arity
- [ ] Write a recursive tree iterator that threads the bool back up
- [ ] Compose Filter/Map/Take and explain why laziness makes them efficient
- [ ] Implement error propagation with `Seq2[T, error]`

---

## Summary

The `iter` package is four identifiers: `Seq`, `Seq2` (push iterators you range over) and `Pull`, `Pull2` (converters to a pull `(next, stop)` interface). `for v := range seq` desugars into `seq(func(v) bool { body; return true })` — the loop body *is* the `yield` closure, and `break`/`return`/`goto`/labels are implemented by having `yield` return `false`, letting the iterator tear down, then completing the jump. The result behaves exactly like a slice range for the body author; the only new burden is on the iterator author, who must honour `yield`'s `false` with `if !yield(v) { return }`. Violating that — calling `yield` after `false`, or after the iterator returned — panics.

`iter.Pull` runs the producer on a parked goroutine and hands you `next`/`stop`; you must `defer stop()` or leak that goroutine. Use pull only when push is not enough: merging, zipping, manual interleaving. The standard library ships `slices.{All,Values,Backward,Collect,Sorted,SortedFunc}` and `maps.{Keys,Values,All,Collect}`, with `Seq` for single values and `Seq2` for pairs. Composition (Filter/Map/Take) works because every layer is lazy and forwards the stop signal upstream — which is exactly why honouring the bool at every level is non-negotiable.
