# Iterator Pattern — Junior

## 1. What the Iterator pattern actually is

You have a collection. The caller wants to walk through its elements one at a time, without knowing how the collection stores them internally. The Iterator pattern encapsulates that walk.

In Go, this pattern existed in two main forms before Go 1.23, and now in three:

1. **`range` over a built-in** — slices, maps, strings, channels. The compiler handles iteration.
2. **An explicit `Next() bool` / `Value()` interface** — `sql.Rows`, `bufio.Scanner`, `csv.Reader`.
3. **`iter.Seq[T]` and `iter.Seq2[K,V]`** — Go 1.23's *range-over-function* iterators. Functions that *push* values to a caller-supplied yield function.

```go
// Built-in range
for i, v := range []int{1, 2, 3} { fmt.Println(i, v) }

// Explicit Next/Value
rows, _ := db.Query("SELECT id FROM users")
defer rows.Close()
for rows.Next() {
    var id int
    rows.Scan(&id)
}
if err := rows.Err(); err != nil { /* ... */ }

// Go 1.23+ range over function
for v := range slices.Values(nums) { fmt.Println(v) }
```

This file teaches:

1. When each form is appropriate.
2. The discipline around `Next()`/`Err()`/`Close()` — the three things every junior gets wrong.
3. The mental model for Go 1.23's range-over-function iterators.
4. Where iterators appear in the standard library.

---

## 2. Table of Contents

1. [What the Iterator pattern actually is](#1-what-the-iterator-pattern-actually-is)
2. [Table of Contents](#2-table-of-contents)
3. [The three Go shapes](#3-the-three-go-shapes)
4. [Built-in `range`](#4-built-in-range)
5. [Explicit `Next/Value` iterators](#5-explicit-nextvalue-iterators)
6. [`iter.Seq` (Go 1.23+)](#6-iterseq-go-123)
7. [Channel-based iterators](#7-channel-based-iterators)
8. [When to use each](#8-when-to-use-each)
9. [Iterators in the standard library](#9-iterators-in-the-standard-library)
10. [Common mistakes](#10-common-mistakes)
11. [Tricky points](#11-tricky-points)
12. [Quick test](#12-quick-test)
13. [Cheat sheet](#13-cheat-sheet)
14. [What to learn next](#14-what-to-learn-next)

---

## 3. The three Go shapes

### 3.1 Built-in `range`

Compiler-generated iteration over slices, maps, strings, channels. No interface needed.

```go
for k, v := range myMap { fmt.Println(k, v) }
```

### 3.2 Explicit interface

A struct with methods. Classic shape: `Next() bool` advances, value accessor returns the current item.

```go
type Iterator interface {
    Next() bool
    Value() Item
    Err() error
    Close() error
}
```

Used in `sql.Rows`, `bufio.Scanner`. Verbose but explicit.

### 3.3 Range-over-function (Go 1.23+)

A function that takes a *yield* function and calls it for each value:

```go
type Seq[T any] func(yield func(T) bool)

func numbers() iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < 10; i++ {
            if !yield(i) { return }
        }
    }
}

for n := range numbers() {
    fmt.Println(n)
}
```

The `range` keyword now works with these function types. The caller's loop body becomes the yield function.

---

## 4. Built-in `range`

The simplest iterator. Compiler handles everything:

```go
// Over slice
for i, v := range []int{1, 2, 3} { ... }

// Over map (random order)
for k, v := range myMap { ... }

// Over string (runes)
for i, r := range "héllo" { ... }

// Over channel (until closed)
for msg := range ch { ... }

// Index-only over count (Go 1.22+)
for i := range 10 { ... }
```

Use this whenever you can. It's the most idiomatic and the fastest. The other forms exist for situations `range` can't handle.

### 4.1 Caveats

- **Map iteration order is randomised.** Don't depend on order.
- **String range yields runes**, not bytes. Use `for i := 0; i < len(s); i++ { c := s[i] }` for bytes.
- **Slice range copies the loop variable.** Modifying `v` doesn't modify the slice. Use `slice[i]` to mutate.
- **Channel range exits when channel closes.** If never closed, the loop hangs.

---

## 5. Explicit `Next/Value` iterators

Pre-1.23 way to iterate over a collection you don't own (database rows, scanner tokens).

```go
rows, err := db.Query("SELECT id, name FROM users")
if err != nil { return err }
defer rows.Close()

for rows.Next() {
    var id int
    var name string
    if err := rows.Scan(&id, &name); err != nil {
        return err
    }
    fmt.Println(id, name)
}
if err := rows.Err(); err != nil {
    return err
}
```

Four things every caller must do:

1. **Check the constructor's error** — `Query()` returns one.
2. **`defer rows.Close()`** — release resources (database connection back to pool).
3. **Call `rows.Next()` in a loop** — advances and returns false when done.
4. **Check `rows.Err()` after the loop** — distinguishes "no more rows" from "error during iteration".

Forgetting any of these is a bug. `rows.Close()` is the most-forgotten — symptom: connection pool exhausted under load.

---

## 6. `iter.Seq` (Go 1.23+)

The new idiom. Functions returning `iter.Seq[T]` plug into `range`:

```go
import "iter"

func Range(start, stop int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := start; i < stop; i++ {
            if !yield(i) { return }
        }
    }
}

for i := range Range(0, 5) {
    fmt.Println(i)
}
// Output: 0 1 2 3 4
```

The signature is `func(yield func(T) bool)`:
- `yield(v)` reports the value `v` to the caller.
- If `yield` returns `false`, the iterator should stop (the caller hit `break` or `return`).

**Two-value form:**

```go
type Seq2[K, V any] func(yield func(K, V) bool)

func Enumerate[T any](s []T) iter.Seq2[int, T] {
    return func(yield func(int, T) bool) {
        for i, v := range s {
            if !yield(i, v) { return }
        }
    }
}

for i, v := range Enumerate([]string{"a", "b", "c"}) {
    fmt.Println(i, v)
}
```

### 6.1 Why this matters

Before Go 1.23, custom iterators required the `Next/Value` interface. Now you can write a function that *looks like* an iterator and use it directly with `range`. The compiler generates the equivalent code.

Standard library examples (Go 1.23+):
- `slices.Values(s) iter.Seq[T]` — iterate slice elements.
- `slices.All(s) iter.Seq2[int, T]` — iterate index+value.
- `maps.Keys(m) iter.Seq[K]` — iterate map keys.
- `maps.Values(m) iter.Seq[V]` — iterate map values.
- `maps.All(m) iter.Seq2[K, V]` — iterate key+value (random order).

### 6.2 The `iter.Pull` helper

For cases where push-style (yield-based) doesn't fit, `iter.Pull` converts to a pull-style API:

```go
seq := slices.Values([]int{1, 2, 3})
next, stop := iter.Pull(seq)
defer stop()

for {
    v, ok := next()
    if !ok { break }
    fmt.Println(v)
}
```

Use this when:
- You need to read from two iterators in lockstep.
- You need to "look ahead" without consuming.
- You're bridging to an API that wants pull-style semantics.

Otherwise, plain `range` over the `Seq` is shorter and faster.

---

## 7. Channel-based iterators

Before Go 1.23, channel-based iteration was a common pattern:

```go
func ProduceNumbers() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < 10; i++ {
            out <- i
        }
    }()
    return out
}

for n := range ProduceNumbers() {
    fmt.Println(n)
}
```

Pros: works with `range`; producer can be in a separate goroutine.

Cons:
- **Goroutine leak** if the consumer stops early. The producer goroutine blocks forever on the unbuffered channel send.
- **Allocation cost.** Each goroutine has its own stack.
- **Slower than direct iteration.** Channel operations involve scheduler.

For most cases, prefer `iter.Seq` (Go 1.23+) which doesn't need a goroutine.

---

## 8. When to use each

| Situation | Use |
|-----------|-----|
| Iterating over a slice, map, string, channel | Built-in `range` |
| Database rows, file scanners | Stdlib's existing `Next/Value` types |
| Custom iterator for your own collection | `iter.Seq[T]` (Go 1.23+) |
| Generator that needs to do work between yields | `iter.Seq` (push) |
| Two iterators in lockstep | `iter.Pull` |
| Pre-Go-1.23 codebase | `Next/Value` interface |
| Concurrent producer | Channel-based (with leak prevention) |

---

## 9. Iterators in the standard library

| Where | Style |
|-------|-------|
| `range` over slice/map/string/channel | Built-in |
| `sql.Rows` | `Next/Scan/Err/Close` |
| `bufio.Scanner` | `Scan/Text/Bytes/Err` |
| `csv.Reader.Read()` returns one record per call | Pull |
| `json.Decoder.Token()` | Pull |
| `ast.Inspect(node, f)` | Visitor (callback) |
| `filepath.WalkDir(root, fn)` | Visitor (callback) |
| `slices.Values`, `slices.All` | `iter.Seq` (Go 1.23+) |
| `maps.Keys`, `maps.Values`, `maps.All` | `iter.Seq` (Go 1.23+) |
| `regexp.FindAllStringIndex` | Slice (eager) |
| `net/http.Header.Values` | Slice |

The transition from `Next/Value` to `iter.Seq` is gradual. Existing types keep their old API; new types adopt `iter.Seq`.

---

## 10. Common mistakes

### 10.1 Forgetting `Close()`

```go
rows, _ := db.Query("...")
for rows.Next() { /* ... */ }
// forgot rows.Close()
```

Connection leaks. Under load, the pool exhausts.

Fix: `defer rows.Close()` immediately after the constructor.

### 10.2 Forgetting `Err()`

```go
for rows.Next() { /* ... */ }
// done — but did iteration fail mid-way?
```

`rows.Next()` returns `false` on both end-of-data and error. The only way to distinguish is `rows.Err()` *after* the loop.

```go
for rows.Next() { /* ... */ }
if err := rows.Err(); err != nil {
    return err
}
```

### 10.3 Channel iterator goroutine leak

```go
ch := produceNumbers()
for n := range ch {
    if n == 5 { break }  // exits early
}
// producer goroutine is now blocked on ch <- ... forever
```

Fix: producer must check a cancellation signal:

```go
func produceNumbers(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < 10; i++ {
            select {
            case out <- i:
            case <-ctx.Done(): return
            }
        }
    }()
    return out
}
```

### 10.4 Modifying the loop variable expecting it to mutate the source

```go
for _, v := range slice {
    v.field = 1  // !
}
// slice unchanged
```

`v` is a copy. To mutate: `slice[i].field = 1`.

### 10.5 Range over closed channel returns zero values forever — wrong

Actually, `range ch` exits when the channel is closed. The mistake is the opposite — assuming you can range over a never-closed channel.

```go
ch := make(chan int)
go func() { ch <- 1; ch <- 2 }()  // never closes
for v := range ch { fmt.Println(v) }  // hangs after printing 1, 2
```

Always `close(ch)` from the producer when done.

---

## 11. Tricky points

### 11.1 Map iteration order

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}
for k := range m { fmt.Println(k) }
// Order varies between runs! "b", "a", "c" then "c", "a", "b" then ...
```

The order is randomised intentionally to prevent code from depending on it.

### 11.2 Range capturing loop variable (pre-1.22)

```go
funcs := []func(){}
for i := 0; i < 3; i++ {
    funcs = append(funcs, func() { fmt.Println(i) })
}
for _, f := range funcs { f() }
// Pre-Go 1.22: prints 3, 3, 3
// Go 1.22+:    prints 0, 1, 2
```

Go 1.22 changed `range` and `for i := 0; i < N; i++` to create a new variable per iteration. This bug class is gone in modern Go.

### 11.3 `iter.Seq` and early termination

```go
seq := slices.Values([]int{1, 2, 3, 4})
for v := range seq {
    if v == 3 { break }
}
```

The `break` causes `yield` to return `false`. The iterator must check and return:

```go
func Seq() iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < 100; i++ {
            if !yield(i) { return }  // crucial
        }
    }
}
```

Forgetting to check `!yield(...)` means `break` and `return` from the loop body don't stop the iterator — wasted work.

### 11.4 `iter.Pull` requires `stop()`

```go
next, stop := iter.Pull(seq)
defer stop()  // MUST call this
```

Forgetting `stop()` leaks the underlying goroutine that `iter.Pull` spawns. `defer stop()` immediately after the call.

---

## 12. Quick test

### Q1. What's wrong?

```go
rows, _ := db.Query("SELECT id FROM users")
for rows.Next() {
    var id int
    rows.Scan(&id)
}
```

<details><summary>Answer</summary>

Two bugs:
1. **Constructor error ignored.** `_ = err` loses information about query failure.
2. **No `rows.Close()`.** Connection leaks.
3. **No `rows.Err()`.** Iteration errors are silently swallowed.

Fix:

```go
rows, err := db.Query("SELECT id FROM users")
if err != nil { return err }
defer rows.Close()
for rows.Next() {
    var id int
    if err := rows.Scan(&id); err != nil { return err }
}
return rows.Err()
```
</details>

### Q2. What does this print?

```go
m := map[string]int{"a": 1, "b": 2}
for k, v := range m {
    fmt.Println(k, v)
}
```

<details><summary>Answer</summary>

Either:
```
a 1
b 2
```
or:
```
b 2
a 1
```

Map iteration order is randomised. Don't depend on order.
</details>

### Q3. How would you write a Range function returning `iter.Seq[int]`?

<details><summary>Answer</summary>

```go
func Range(start, stop int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := start; i < stop; i++ {
            if !yield(i) { return }
        }
    }
}

// Usage:
for i := range Range(0, 10) { /* ... */ }
```

The crucial parts: `func(yield func(int) bool)` signature, `if !yield(i) { return }` for early termination.
</details>

---

## 13. Cheat sheet

| Goal | Approach |
|------|----------|
| Walk a slice/map/string/channel | `for ... := range x` |
| Walk DB rows | `rows.Next()`, `Scan`, `Err`, `Close` |
| Walk file lines | `bufio.Scanner.Scan/Text/Err` |
| Custom iterator (Go 1.23+) | Return `iter.Seq[T]` |
| Walk in lockstep | `iter.Pull` |
| Bridge to channel | Channel + `close()` at end of producer |
| Don't forget | `defer Close()`, `Err()` check, `close(chan)` |
| Map order | Randomised — don't rely on it |

---

## 14. What to learn next

1. **[middle.md](middle.md)** — `iter.Pull`, composition (Map/Filter/Take), generators, paginated iterators.
2. **`../09-iterator-pattern/senior.md`** — Iterator design at scale, postmortems, real ecosystems.
3. **Go 1.23 release notes** — official `iter` package documentation.
4. **`slices` and `maps` packages** — modern iter.Seq-returning helpers.

Iterator in Go is in transition. The old `Next/Value` style is fine for existing code. New code should use `iter.Seq[T]`. Knowing both lets you bridge legacy and modern code.
