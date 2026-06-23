# Iterators & Range-over-Func — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is a range-over-func iterator?" and "How do I write one and loop over it?"

Before Go 1.23, the `for ... range` loop worked over a fixed set of built-in types: slices, arrays, maps, strings, channels, and integers (1.22). If you wanted to iterate over your own data structure — a tree, a linked list, a paginated API — you could not plug it into a `range` loop. You had to expose a slice (allocating everything up front), or hand the caller a channel (a whole goroutine), or write a callback-style `ForEach(func(T))` method that nobody could `break` out of cleanly.

Go 1.23 fixed this. Now you can `range` over a **function** of a specific shape, and the compiler turns it into a loop. That function is called an **iterator**.

```go
for line := range readLines(file) {
    fmt.Println(line)
}
```

Here `readLines(file)` is not a slice and not a channel — it is a function. Go calls it, feeds each line into the loop body one at a time, and stops when the data runs out or you `break`. The whole machinery is built on one small idea: a function that takes a callback named `yield`.

After reading this file you will:
- Understand what `iter.Seq[V]` and `iter.Seq2[K,V]` are
- Know what `yield` does and what its `bool` return value means
- Write your first custom iterator and loop over it
- Use the new `slices` and `maps` iterator helpers
- Know when an iterator is the right tool and when a plain slice is simpler

You do **not** need to understand `iter.Pull`, the exact compiler desugaring, or goroutine-leak edge cases yet. Those are in [middle.md](middle.md) and [senior.md](senior.md). This file is about the moment you say "I want my own type to work in a `for range` loop."

---

## Prerequisites

- **Required:** Go 1.23 or newer. The feature is generally available (GA) only from 1.23. Check with `go version`.
- **Required:** Your module's `go.mod` must declare `go 1.23` (or higher). The language feature is gated on this directive — see [Tricky Points](#tricky-points).
- **Required:** Comfort with ordinary `for ... range` over slices and maps.
- **Required:** Comfort with functions as values and passing functions as arguments (closures). An iterator *is* a function value.
- **Helpful:** Familiarity with generics (`[T any]`), since `iter.Seq[V]` is a generic type.

If `go version` prints `go1.23` or higher and your `go.mod` says `go 1.23`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Iterator** | In Go 1.23, a function you can pass to `for ... range`. It produces a sequence of values by calling `yield` for each one. |
| **`iter.Seq[V]`** | The type `func(yield func(V) bool)`. A "single-value" iterator — yields one value at a time. |
| **`iter.Seq2[K,V]`** | The type `func(yield func(K, V) bool)`. A "pair" iterator — yields two values (e.g. index+value, key+value). |
| **`yield`** | The callback the iterator calls to hand one value (or pair) to the loop body. Supplied by the compiler, not by you. |
| **Push iterator** | An iterator that *pushes* values into the loop by calling `yield`. `iter.Seq`/`iter.Seq2` are push iterators. |
| **`range`-over-func** | The language feature that lets `for ... range f` work when `f` is an iterator function. |
| **`yield` returning `false`** | The loop's signal "stop now." Happens on `break`, `return`, a labelled break, or a panic in the body. The iterator must stop calling `yield`. |
| **`iter.Pull`** | A function that converts a push iterator into a *pull*-based `(next, stop)` pair. Advanced; see middle. |
| **`slices.Values`, `maps.Keys`, …** | Standard-library functions added in 1.23 that return iterators over slices and maps. |

---

## Core Concepts

### An iterator is just a function with a `yield` parameter

The single most important shape to memorise:

```go
func(yield func(V) bool)
```

That is the entire type of a single-value iterator. The standard library gives it a name in the `iter` package:

```go
package iter

type Seq[V any]     func(yield func(V) bool)
type Seq2[K, V any] func(yield func(K, V) bool)
```

`Seq` yields one value per step. `Seq2` yields two — exactly mirroring `for i, v := range slice` (index + value) or `for k, v := range m` (key + value).

You write the body of the iterator. Inside it, every time you want to produce a value, you **call `yield`** with that value:

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

`Count(3)` returns an iterator that will produce `0`, `1`, `2`.

### `yield` returns a `bool` — and you must check it

Every call to `yield` returns a `bool`. It answers the question *"should I keep going?"*

- `yield(x)` returned **`true`** → the loop wants more. Continue.
- `yield(x)` returned **`false`** → the loop is done (the body did `break`, `return`, etc.). **You must stop calling `yield` and return from the iterator.**

This is why the canonical pattern is `if !yield(v) { return }`. Ignoring the return value is the most common beginner bug — and in Go 1.23 calling `yield` again after it returned `false` causes a **panic**.

### Looping over an iterator

Once you have an iterator, the loop looks completely ordinary:

```go
for v := range Count(3) {
    fmt.Println(v) // 0, 1, 2
}
```

For a `Seq2` you get two loop variables:

```go
for k, v := range pairs() {
    fmt.Println(k, v)
}
```

You did not call `yield`. You did not see the bool. The compiler wrote all of that for you. From the loop's side, an iterator looks exactly like a slice.

### The standard library now ships iterators

You rarely have to write the boilerplate for common cases. Go 1.23 added iterator helpers:

```go
import (
    "maps"
    "slices"
)

s := []string{"a", "b", "c"}
for i, v := range slices.All(s) { ... }   // index + value (Seq2)
for v := range slices.Values(s) { ... }   // values only (Seq)
for v := range slices.Backward(s) { ... } // values, last to first

m := map[string]int{"x": 1, "y": 2}
for k := range maps.Keys(m) { ... }       // keys (Seq)
for v := range maps.Values(m) { ... }     // values (Seq)
```

And to go the other way — collect an iterator back into a slice or map:

```go
out := slices.Collect(slices.Values(s)) // []string{"a","b","c"}
keys := slices.Sorted(maps.Keys(m))     // sorted []string
```

### An iterator is lazy

A slice holds *all* its elements at once. An iterator produces them *one at a time, on demand*. Nothing happens until the loop asks for the next value. If you `break` after the first item, the iterator never computes the rest. This laziness is the feature's superpower — you can iterate over an infinite sequence, or a 10-GB file, without ever holding it all in memory.

---

## Real-World Analogies

**1. A vending machine.** A slice is a shelf with every snack laid out at once. An iterator is a vending machine: you press the button (`yield`), one snack drops, you press again for the next. If you walk away, the machine never dispenses the rest. You only pay for what you take.

**2. A tour guide.** The guide (`yield`) shows you one room at a time. You say "next" to continue or "I've seen enough" to stop (`break`). The guide does not unlock every room in the building before you arrive — only the one you are about to enter.

**3. A water tap.** A bucket (slice) is filled before you carry it. A tap (iterator) gives water only while it is open. Close it (`break`) and no more flows. You never store more than the glass in your hand.

**4. A conveyor belt with a stop button.** Items arrive one by one. `yield` puts an item in front of you and waits to hear whether to send the next. Hit the stop button (`yield` returns `false`) and the belt halts — the worker upstream must notice and stop loading.

---

## Mental Models

### Model 1 — An iterator is a function, not data

You can store it in a variable, return it from a function, pass it as an argument. `Count(3)` does not run the loop; it *returns a function* that will run the loop when ranged over. Calling `Count(3)` twice gives two independent iterators.

### Model 2 — `yield` is the loop body in disguise

When you write `for v := range seq { body }`, the compiler packages `body` into a function and passes it to `seq` as the `yield` parameter. So "calling `yield(v)`" literally means "run the loop body with `v`." The bool it returns means "the body did not break/return."

### Model 3 — Control flows back and forth

Producer (your iterator) and consumer (the loop) take turns. The iterator runs until it calls `yield`; control jumps to the loop body; the body runs; control jumps back to right after the `yield` call. It is cooperative, single-threaded ping-pong — no goroutines, no channels.

### Model 4 — `false` means "tear down"

A `false` from `yield` is a one-way door. The producer must clean up (close files, release locks) and return. It must never call `yield` again. Think of `false` as the loop saying "we're leaving — lock up behind you."

### Model 5 — Seq vs Seq2 mirrors range arity

`for v := range x` → one variable → `Seq`. `for k, v := range x` → two variables → `Seq2`. Pick the type whose `yield` arity matches how callers will loop.

---

## Pros & Cons

### Pros

- **Custom types finally `range`.** Trees, lists, ring buffers, paginated APIs — all become first-class loop sources.
- **Laziness for free.** Values are produced on demand; `break` stops work immediately.
- **No allocation in the common case.** When the iterator and loop inline, there is no slice and no heap garbage. (See [Performance Tips](#performance-tips).)
- **Composable.** Iterators can wrap other iterators (filter, map, take) without materialising intermediate slices.
- **Uniform consumer code.** The loop reads the same whether the source is a slice or an iterator.

### Cons

- **A new shape to learn.** The `func(yield func(V) bool)` signature is unusual at first.
- **Easy to forget the bool.** Not checking `yield`'s return is a real, common bug that can panic.
- **Harder to debug.** Stack traces cross the producer/consumer boundary in ways that surprise newcomers.
- **Overkill for small fixed data.** If you already have a slice, just range the slice.
- **`go.mod` gating.** The feature only compiles when `go.mod` declares `go 1.23+`.

---

## Use Cases

Reach for a custom iterator when:

- **The data does not fit in memory.** Lines of a huge file, rows of a database cursor, a network stream.
- **The data is infinite or unbounded.** Fibonacci numbers, an ID generator, a retry schedule.
- **Producing every element is expensive.** Pagination over an HTTP API — you want to stop after the first match without fetching all pages.
- **You have a custom container.** A tree, graph, or linked list that has no natural slice form.
- **You are building a pipeline.** Filter → map → take, composed without intermediate slices.

Prefer a plain slice when:

- The data is small and already in memory.
- Callers need random access or `len()`.
- The simplest possible code matters more than laziness.

---

## Code Examples

### Example 1 — Your first iterator

```go
package main

import (
    "fmt"
    "iter"
)

func Count(n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < n; i++ {
            if !yield(i) {
                return
            }
        }
    }
}

func main() {
    for v := range Count(3) {
        fmt.Println(v) // 0 1 2
    }
}
```

### Example 2 — A Seq2 iterator (index + value)

```go
func Enumerate[T any](s []T) iter.Seq2[int, T] {
    return func(yield func(int, T) bool) {
        for i, v := range s {
            if !yield(i, v) {
                return
            }
        }
    }
}

for i, v := range Enumerate([]string{"a", "b"}) {
    fmt.Println(i, v) // 0 a / 1 b
}
```

### Example 3 — `break` stops the iterator early

```go
for v := range Count(1_000_000) {
    if v == 3 {
        break // iterator stops; it never produced 4..999999
    }
    fmt.Println(v) // 0 1 2
}
```

`Count` never loops a million times. When the body breaks, `yield` returns `false`, and `Count`'s `if !yield(i) { return }` fires.

### Example 4 — Using the standard-library helpers

```go
import (
    "fmt"
    "maps"
    "slices"
)

func main() {
    nums := []int{3, 1, 2}

    for v := range slices.Values(nums) {
        fmt.Println(v) // 3 1 2
    }
    for v := range slices.Backward(nums) {
        fmt.Println(v) // 2 1 3  (last to first; value only here is index/value pair — see note)
    }

    m := map[string]int{"b": 2, "a": 1}
    for _, k := range slices.Sorted(maps.Keys(m)) {
        fmt.Println(k) // a b  (sorted)
    }
}
```

> Note: `slices.Backward` returns a `Seq2[int, V]` (index + value, descending). Use `for i, v := range slices.Backward(nums)` if you want both. `slices.Values` is the value-only `Seq[V]`.

### Example 5 — Collecting an iterator into a slice

```go
import "slices"

squares := func(yield func(int) bool) {
    for i := 1; i <= 4; i++ {
        if !yield(i * i) {
            return
        }
    }
}

out := slices.Collect(squares) // []int{1, 4, 9, 16}
fmt.Println(out)
```

### Example 6 — A line reader (lazy, no full-file slice)

```go
import (
    "bufio"
    "io"
    "iter"
)

func Lines(r io.Reader) iter.Seq[string] {
    return func(yield func(string) bool) {
        sc := bufio.NewScanner(r)
        for sc.Scan() {
            if !yield(sc.Text()) {
                return
            }
        }
    }
}

// for line := range Lines(file) { ... }  // never loads the whole file
```

---

## Coding Patterns

### Pattern: always `if !yield(v) { return }`

This is the workhorse. Every place you produce a value, guard it:

```go
if !yield(v) {
    return
}
```

Never call `yield` and ignore the result.

### Pattern: return an `iter.Seq` from a constructor

A method or function that produces a sequence returns the iterator; the caller ranges over it:

```go
func (t *Tree) Values() iter.Seq[int] {
    return func(yield func(int) bool) { t.walk(yield) }
}
```

### Pattern: name the helper to match arity

`Values()` → `Seq`. `All()` → `Seq2` (index/key + value). Following the stdlib's naming (`slices.Values`, `slices.All`, `maps.Keys`, `maps.All`) makes your API instantly readable.

### Pattern: clean up with `defer` inside the iterator

If the iterator opens a resource, `defer` its close so it runs whether the loop finishes normally or breaks early:

```go
func Rows(db *sql.DB, q string) iter.Seq[Row] {
    return func(yield func(Row) bool) {
        rows, _ := db.Query(q)
        defer rows.Close() // runs on normal end AND on early break
        for rows.Next() {
            var r Row
            rows.Scan(&r)
            if !yield(r) {
                return
            }
        }
    }
}
```

---

## Clean Code

- **Return `iter.Seq[V]`, not a bare `func(func(V) bool)`.** The named type documents intent and reads better.
- **Always check `yield`'s return.** `if !yield(v) { return }` — make it muscle memory.
- **Keep iterators pure where possible.** An iterator that only produces values is easy to reason about; one that also mutates shared state is not.
- **`defer` cleanup right after acquiring a resource**, so early `break` cannot leak it.
- **Do not start goroutines in a simple push iterator.** It is unnecessary and risks leaks; the producer/consumer ping-pong is single-threaded.
- **Name by arity:** `Values`/`Keys` for `Seq`, `All` for `Seq2`.

---

## Product Use / Feature

Iterators show up wherever a product streams or paginates:

- **Paginated API clients.** `client.AllUsers()` returns `iter.Seq[User]` that fetches pages lazily; UI code just ranges over it and stops when it has enough.
- **Log/event processing.** Stream millions of events through a filter → transform pipeline without buffering them.
- **Database cursors.** Wrap `sql.Rows` in an `iter.Seq[Row]` so business code never touches `rows.Next()`/`rows.Close()`.
- **Config and tree walks.** Walk a config tree or filesystem and yield matching nodes.

The payoff for the product: lower memory, faster time-to-first-result (you can show or act on element #1 before element #1000 exists), and code that reads like looping over a list.

---

## Error Handling

A push iterator's `yield` only carries values, not errors. There are two standard patterns:

### Pattern A — yield a value-and-error pair with `Seq2`

```go
func Lines(r io.Reader) iter.Seq2[string, error] {
    return func(yield func(string, error) bool) {
        sc := bufio.NewScanner(r)
        for sc.Scan() {
            if !yield(sc.Text(), nil) {
                return
            }
        }
        if err := sc.Err(); err != nil {
            yield("", err) // final yield carries the error
        }
    }
}

for line, err := range Lines(file) {
    if err != nil {
        log.Fatal(err)
    }
    process(line)
}
```

### Pattern B — store the error and expose it after the loop

```go
it := NewScanner(r)
for v := range it.Values() {
    use(v)
}
if it.Err() != nil { ... } // bufio.Scanner-style
```

Both are idiomatic. Choose `Seq2[T, error]` when the error is tied to a specific element; choose the post-loop `Err()` method when the error is terminal.

---

## Security Considerations

- **A breaking loop must not leak resources.** If your iterator holds a file, DB cursor, or lock, a `break` in the consumer must still close it. Use `defer` inside the iterator. This is a resource-exhaustion (denial-of-service) concern at scale.
- **Untrusted iterators run your `yield`.** When you accept an `iter.Seq` from a caller, remember it is arbitrary code that will call back into your loop body. Treat values it yields as untrusted input and validate them.
- **Infinite iterators need a bound.** Ranging over an unbounded iterator without a `break` condition is an infinite loop. Always pair an infinite source with a `take`/limit or a break condition.
- **Do not panic across the boundary carelessly.** A panic in the loop body unwinds through the iterator; ensure cleanup `defer`s are in place so a panic does not leave a resource open.

---

## Performance Tips

- **Iterators are zero-allocation when inlined.** If the iterator function and the loop body are small enough to inline, the compiler produces a plain loop with no heap allocation — as fast as ranging a slice. (Details in [optimize.md](optimize.md).)
- **Don't build a slice just to range it.** `for v := range slices.Values(s)` over an existing slice is fine, but if you already have `s`, `for _, v := range s` is simpler and identical in cost.
- **Laziness avoids work.** Breaking early means the unproduced elements cost nothing. This is the biggest win for pagination and search.
- **Prefer push iterators over channels for in-process iteration.** A channel-based iterator needs a goroutine and synchronisation; a push iterator does not. Channels are dramatically slower for this.

---

## Best Practices

1. **Set `go 1.23` (or newer) in `go.mod`.** Without it, the feature does not compile.
2. **Always `if !yield(v) { return }`.** Never ignore the bool.
3. **Return the named `iter.Seq`/`iter.Seq2` type** from your APIs.
4. **`defer` resource cleanup inside the iterator** so early `break` is safe.
5. **Use the stdlib helpers** (`slices.Values`, `slices.Collect`, `maps.Keys`, …) instead of reinventing them.
6. **Don't reach for `iter.Pull` until you actually need it** (merging/zipping). The push form covers almost everything.
7. **Keep iterators single-pass-friendly** and document if an iterator can be ranged more than once.
8. **Don't spawn goroutines** in a plain push iterator.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Forgetting to check `yield`'s return

```go
// WRONG: keeps yielding after the loop broke
return func(yield func(int) bool) {
    for i := 0; i < n; i++ {
        yield(i) // ignores the bool!
    }
}
```

If the consumer `break`s, `yield` returns `false`, but this code keeps calling it — and the **second call after `false` panics**. Always guard with `if !yield(i) { return }`.

### Pitfall 2 — `go.mod` not at 1.23

If `go.mod` says `go 1.22`, `for v := range someFunc` is a compile error ("cannot range over ..."). Bump the directive.

### Pitfall 3 — Treating the iterator like a slice

You cannot index it, call `len()` on it, or get element #3 directly. It is a function; it only produces values via a loop.

### Pitfall 4 — Re-ranging a single-use iterator

Some iterators (e.g. one wrapping a network stream) are exhausted after one pass. Ranging again produces nothing. If you need multi-pass, `slices.Collect` into a slice first.

### Pitfall 5 — Resource leak on early break

If you open a file but only close it "after the loop," an early `break` skips that. Put the close in a `defer` inside the iterator.

### Pitfall 6 — Confusing `slices.Values` (Seq) with `slices.All` (Seq2)

`slices.Values` yields just values; `slices.All` yields index+value. Loop with the matching number of variables.

---

## Common Mistakes

- **Ignoring `yield`'s `bool`** — the number-one mistake; can panic.
- **Forgetting the `go 1.23` directive** — the code simply will not compile.
- **Closing a resource after the loop instead of `defer`ing it inside** — leaks on early break.
- **Spawning a goroutine inside a push iterator** — unnecessary, and a leak source.
- **Using `iter.Pull` when a plain `for range` would do** — over-engineering.
- **Calling the iterator function and discarding the result** — `Count(3)` returns an iterator; you must range over it.
- **Expecting `len()` or indexing** — iterators are not slices.

---

## Common Misconceptions

> *"An iterator runs as soon as I call the function."*

No. `Count(3)` only *returns* an iterator. The loop runs when you `range` over it.

> *"Iterators use channels or goroutines under the hood."*

No. The standard push iterator is single-threaded cooperative ping-pong between the producer and the loop body. No goroutine, no channel.

> *"`yield` is a keyword."*

No. `yield` is just the conventional *name* of the callback parameter. You could call it anything, but everyone calls it `yield`.

> *"Iterators are slower than slices."*

When inlined, they are allocation-free and as fast as a slice loop. They are only slower if they cannot inline or do real per-element work.

> *"I need to handle the `bool` only sometimes."*

You must handle it every time you call `yield`. Calling `yield` again after it returned `false` panics.

---

## Tricky Points

- **The feature is gated on the `go` directive in `go.mod`.** `go 1.23+` enables range-over-func; lower versions reject it at compile time. This is a *language version* gate, not just a toolchain gate.
- **In 1.22 it was an experiment** behind `GOEXPERIMENT=rangefunc`. In 1.23 it is GA and needs no experiment flag. (History in [professional.md](professional.md).)
- **`yield`'s return value is the only channel of "stop" information.** There is no other signal; honour it.
- **A panic in the loop body** propagates out through the iterator (running its `defer`s) and then out of the `range` statement.
- **`slices.Backward` and `slices.All` are `Seq2`** (index + value); `slices.Values` is `Seq`. Match your loop variable count.
- **`iter.Seq` is just a named function type.** Anywhere a `func(func(V) bool)` is expected, an `iter.Seq[V]` fits, and vice versa.

---

## Test

Try this in a scratch folder (Go 1.23+, `go.mod` with `go 1.23`).

```go
package main

import (
    "fmt"
    "iter"
)

func Count(n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < n; i++ {
            if !yield(i) {
                return
            }
        }
    }
}

func main() {
    for v := range Count(5) {
        if v == 3 {
            break
        }
        fmt.Println(v)
    }
}
```

Expected output: `0 1 2`.

Now answer:
1. How many times does `Count`'s inner loop actually execute? (Answer: 4 — it runs for i=0,1,2,3; at i=3 `yield` returns `false` and it returns.)
2. What happens if you delete `if !yield(i)` and just write `yield(i)`? (Answer: after `break`, the next `yield` call panics with "range function continued iteration after function for loop body returned false".)
3. What is the type of `Count(5)`? (Answer: `iter.Seq[int]`, i.e. `func(func(int) bool)`.)
4. Change `range Count(5)` to collect into a slice with `slices.Collect`. What do you get with no `break`? (Answer: `[]int{0,1,2,3,4}`.)

---

## Tricky Questions

**Q1.** Is `yield` a Go keyword?

A. No. It is the conventional name of the callback parameter in `func(yield func(V) bool)`. The compiler recognises the *shape*, not the name.

**Q2.** What does `yield` returning `false` mean, and what must I do?

A. It means the consumer is done (broke, returned, or panicked). You must stop calling `yield` and return from the iterator. Calling `yield` again panics.

**Q3.** Does calling `Count(3)` run the loop?

A. No. It returns an iterator function. The loop runs only when you `range` over it.

**Q4.** What Go version do I need, and what must `go.mod` say?

A. Go 1.23+ toolchain, and `go 1.23` (or higher) in `go.mod`. Both are required.

**Q5.** When should I write `iter.Seq2` instead of `iter.Seq`?

A. When each step naturally produces two values — like index+value or key+value — so callers can write `for k, v := range it`.

**Q6.** I broke out of the loop but my file stayed open. Why?

A. You closed it after the loop instead of `defer`ing inside the iterator. Early `break` skips post-loop code; `defer` inside the iterator runs regardless.

**Q7.** Can I range over the same iterator twice?

A. Only if it is written to be re-rangeable (e.g. it re-reads a slice each call). Stream-backed iterators are usually single-use; `slices.Collect` them first if you need replay.

**Q8.** How do I turn an iterator back into a slice?

A. `slices.Collect(seq)` for a `Seq[V]`; `slices.Sorted(seq)` for a sorted slice; `maps.Collect(seq2)` for a `Seq2` into a map.

**Q9.** Are iterators slower than slices?

A. Not when inlined — they allocate nothing and match a slice loop. Cost only appears if they can't inline or do real work per element.

**Q10.** What's the difference between `slices.Values` and `slices.All`?

A. `slices.Values` is a `Seq[V]` (values only). `slices.All` is a `Seq2[int, V]` (index + value).

---

## Cheat Sheet

```go
// The two iterator types (package iter)
type Seq[V any]     func(yield func(V) bool)
type Seq2[K, V any] func(yield func(K, V) bool)

// Writing one
func Count(n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < n; i++ {
            if !yield(i) { // ALWAYS check the bool
                return
            }
        }
    }
}

// Looping
for v := range Count(3) { ... }       // Seq
for k, v := range pairs() { ... }     // Seq2

// Stdlib helpers
slices.All(s)       // Seq2[int, V]  index+value
slices.Values(s)    // Seq[V]        values
slices.Backward(s)  // Seq2[int, V]  reversed
slices.Collect(seq) // []V
slices.Sorted(seq)  // sorted []V
maps.Keys(m)        // Seq[K]
maps.Values(m)      // Seq[V]
maps.All(m)         // Seq2[K, V]
maps.Collect(seq2)  // map[K]V
```

```
go.mod MUST contain:  go 1.23   (or higher)

| Symptom                                   | Cause                          | Fix                          |
|-------------------------------------------|--------------------------------|------------------------------|
| "cannot range over f"                     | go.mod < 1.23                  | bump go directive            |
| panic: continued after false              | called yield after it returned false | if !yield(v) { return } |
| resource leaked on break                  | closed after loop, not defer   | defer close inside iterator  |
| iterator produces nothing on 2nd range    | single-use stream iterator     | slices.Collect first         |
```

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Write the type of `iter.Seq[V]` and `iter.Seq2[K,V]` from memory
- [ ] Explain what `yield` is and what its `bool` return means
- [ ] Write a correct `Count` iterator with the `if !yield(v) { return }` guard
- [ ] Loop over both a `Seq` and a `Seq2`
- [ ] Explain why calling `Count(3)` does not run the loop
- [ ] Name the `go.mod` directive the feature requires
- [ ] Use `slices.Values`, `slices.All`, `slices.Collect`, `maps.Keys`
- [ ] Explain why early `break` needs `defer` cleanup inside the iterator
- [ ] Describe what happens if you call `yield` after it returned `false`
- [ ] Decide between an iterator and a plain slice for a given task

---

## Summary

Go 1.23 lets `for ... range` work over a **function** — an iterator. An iterator is a value of type `iter.Seq[V]` (`func(yield func(V) bool)`) or `iter.Seq2[K,V]` (`func(yield func(K,V) bool)`). Inside it, you call `yield` once per value; `yield` returns a `bool` that tells you whether to keep going. The canonical line is `if !yield(v) { return }`, and calling `yield` after it returns `false` panics.

From the consumer's side, ranging over an iterator looks identical to ranging over a slice — the compiler writes the `yield` plumbing for you. The standard library ships ready-made iterators in `slices` (`Values`, `All`, `Backward`, `Collect`, `Sorted`) and `maps` (`Keys`, `Values`, `All`, `Collect`).

Iterators are lazy (values on demand), composable, and allocation-free when inlined — making them the right tool for huge files, infinite sequences, paginated APIs, and custom containers. Require `go 1.23` in `go.mod`, always honour `yield`'s return, and `defer` your cleanup.

---

## What You Can Build

After learning this:

- **A lazy line reader** that streams a multi-gigabyte file without loading it.
- **A custom tree or list** whose values plug straight into a `for range` loop.
- **A paginated API client** that fetches pages on demand and stops early.
- **A small pipeline** (filter → map) over an existing slice using stdlib helpers.
- **An infinite generator** (counter, Fibonacci) consumed safely with a `break`.

You cannot yet:
- Convert a push iterator into a pull-based `(next, stop)` pair (next: `iter.Pull` in middle.md)
- Merge or zip two iterators (needs pull; middle/senior)
- Reason about the compiler desugaring and inlining in detail (professional.md)
- Avoid the goroutine-leak edge cases of `iter.Pull` (senior.md)

---

## Further Reading

- [`iter` package documentation](https://pkg.go.dev/iter) — the authoritative reference for `Seq`, `Seq2`, `Pull`, `Pull2`.
- [Go 1.23 Release Notes](https://go.dev/doc/go1.23#iterators) — the version that made range-over-func GA.
- [Go blog: Range Over Function Types](https://go.dev/blog/range-functions) — the official introduction with worked examples.
- [`slices` package](https://pkg.go.dev/slices) — `All`, `Values`, `Backward`, `Collect`, `Sorted`, `SortedFunc`.
- [`maps` package](https://pkg.go.dev/maps) — `Keys`, `Values`, `All`, `Collect`.

---

## Related Topics

- 18.2 Generics in Practice — `iter.Seq[V]` is a generic type; helpers are generic functions
- [3.x `for` and `range` loops](../../03-control-flow/) — the base loop this feature extends
- 18.x Functions as Values & Closures — an iterator is a closure
- 6.x Error Handling — the `Seq2[T, error]` pattern for streaming errors
- 12.x I/O & bufio — the line-reader example builds on `bufio.Scanner`

---

## Diagrams & Visual Aids

```
The shape of an iterator:

    iter.Seq[V]  =  func(yield func(V) bool)
                         │         │     │
                         │         │     └── return: keep going?
                         │         └──────── one value per step
                         └────────────────── the callback the loop supplies
```

```
Control flow (single-threaded ping-pong):

    consumer                         producer (iterator)
    --------                         -------------------
    for v := range seq { ... }
         │
         │  call seq(yield)
         └──────────────────────────►  for i ... {
                                            yield(i) ──┐
            ┌──────────────────────────────────────────┘
            ▼
        run loop body with v=i
            │
            │  body returns true (no break)
            └──────────────────────────►  if !yield -> continue
                                            yield(i+1) ...

    On break/return: body returns FALSE
            └──────────────────────────►  if !yield { return }  // tear down
```

```
Lazy vs eager:

    SLICE (eager):   [e0][e1][e2][e3][e4]   all built up front
                      ▲ break here still paid for e3,e4

    ITERATOR (lazy):  e0 → e1 → e2 → (break)
                                      ▲ e3,e4 never computed
```

```
Stdlib helper map:

    slices.Values(s)   ─► Seq[V]        for v := range ...
    slices.All(s)      ─► Seq2[int,V]   for i,v := range ...
    slices.Backward(s) ─► Seq2[int,V]   reversed
    slices.Collect(seq)─► []V           iterator → slice
    slices.Sorted(seq) ─► []V (sorted)
    maps.Keys(m)       ─► Seq[K]
    maps.Values(m)     ─► Seq[V]
    maps.All(m)        ─► Seq2[K,V]
    maps.Collect(seq2) ─► map[K]V
```
