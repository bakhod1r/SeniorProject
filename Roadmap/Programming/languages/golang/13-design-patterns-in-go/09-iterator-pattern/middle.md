# Iterator Pattern — Middle

## 1. What this level adds

Junior taught the three shapes. Middle is about *using them well*:

- `iter.Seq[T]` and `iter.Seq2[K,V]` deep-dive (Go 1.23+).
- Pull vs push iterators — when each is appropriate.
- Composing iterators: Map, Filter, Take, Skip, Zip, Reduce.
- Lazy vs eager evaluation.
- Stateful iterators with cleanup (Close).
- Paginated API iterators (network roundtrip per page).
- Generic iterator helpers.
- Channel-based generators and their gotchas.
- Testing iterators.

---

## 2. Table of Contents

1. [What this level adds](#1-what-this-level-adds)
2. [Table of Contents](#2-table-of-contents)
3. [Push vs Pull iterators](#3-push-vs-pull-iterators)
4. [`iter.Seq` and `iter.Seq2`](#4-iterseq-and-iterseq2)
5. [Composing iterators](#5-composing-iterators)
6. [Lazy evaluation](#6-lazy-evaluation)
7. [Stateful iterators with Close](#7-stateful-iterators-with-close)
8. [Paginated API iterators](#8-paginated-api-iterators)
9. [Generic iterator helpers](#9-generic-iterator-helpers)
10. [Channel-based generators](#10-channel-based-generators)
11. [Testing iterators](#11-testing-iterators)
12. [Common middle-level mistakes](#12-common-middle-level-mistakes)
13. [Performance notes](#13-performance-notes)
14. [Tricky points](#14-tricky-points)
15. [Test](#15-test)
16. [Cheat sheet](#16-cheat-sheet)

---

## 3. Push vs Pull iterators

Two fundamental modes:

- **Push:** the iterator pushes values to a caller-supplied function (`yield(v)`). The iterator drives. `iter.Seq[T]` is push.
- **Pull:** the caller pulls values one at a time. `Next() bool` + `Value()` is pull. `iter.Pull` converts push to pull.

```go
// Push (iter.Seq)
for v := range slices.Values(xs) {
    if v > 100 { break }
    use(v)
}

// Pull (iter.Pull)
next, stop := iter.Pull(slices.Values(xs))
defer stop()
for {
    v, ok := next()
    if !ok { break }
    if v > 100 { break }
    use(v)
}
```

### 3.1 When to use which

| Scenario | Push (iter.Seq) | Pull (iter.Pull / Next-Value) |
|----------|----------------|-------------------------------|
| Simple iteration | ✓ | works but verbose |
| Two iterators in lockstep | hard | natural |
| Lookahead without consuming | hard | natural |
| Producer in a goroutine | hard | natural (channel-based) |
| Composition (map/filter/take) | ✓ | possible but more code |
| Performance | ~5% faster | slightly slower (goroutine overhead in iter.Pull) |

For 95% of code, push is the right default. Pull is for the cases push can't handle.

---

## 4. `iter.Seq` and `iter.Seq2`

The Go 1.23 iterator types:

```go
type Seq[V any] func(yield func(V) bool)
type Seq2[K, V any] func(yield func(K, V) bool)
```

A function that produces values. The `yield` callback is supplied by `range`; the iterator calls it for each value.

### 4.1 Writing an iter.Seq

```go
func Range(start, stop int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := start; i < stop; i++ {
            if !yield(i) { return }
        }
    }
}

for i := range Range(0, 10) {
    if i == 5 { break }  // causes yield to return false
    fmt.Println(i)
}
```

### 4.2 The `!yield(v) { return }` discipline

When the caller breaks/returns from the loop body, `yield` returns `false`. The iterator must:

1. Not call `yield` again.
2. Clean up any resources.
3. Return promptly.

Forgetting `!yield` checks means `break` does nothing — the iterator continues running.

### 4.3 iter.Seq2 for key-value

```go
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

Same pattern, with two values per yield.

---

## 5. Composing iterators

Iterators are first-class values; you can compose them.

### 5.1 Map

```go
func Map[T, U any](seq iter.Seq[T], f func(T) U) iter.Seq[U] {
    return func(yield func(U) bool) {
        for v := range seq {
            if !yield(f(v)) { return }
        }
    }
}

// Usage:
doubled := Map(slices.Values([]int{1, 2, 3}), func(n int) int { return n * 2 })
for v := range doubled { fmt.Println(v) }  // 2, 4, 6
```

### 5.2 Filter

```go
func Filter[T any](seq iter.Seq[T], pred func(T) bool) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range seq {
            if pred(v) {
                if !yield(v) { return }
            }
        }
    }
}
```

### 5.3 Take, Skip, Zip

```go
func Take[T any](seq iter.Seq[T], n int) iter.Seq[T] {
    return func(yield func(T) bool) {
        i := 0
        for v := range seq {
            if i >= n { return }
            if !yield(v) { return }
            i++
        }
    }
}

func Skip[T any](seq iter.Seq[T], n int) iter.Seq[T] {
    return func(yield func(T) bool) {
        i := 0
        for v := range seq {
            if i >= n {
                if !yield(v) { return }
            }
            i++
        }
    }
}
```

### 5.4 Pipeline

```go
result := Take(
    Filter(
        Map(
            slices.Values(numbers),
            func(n int) int { return n * 2 },
        ),
        func(n int) bool { return n > 10 },
    ),
    5,
)

for v := range result {
    fmt.Println(v)
}
```

Each call returns a new `iter.Seq`. No work happens until `range` runs.

### 5.5 Lazy evaluation

```go
seq := Map(infiniteNumbers(), func(n int) int {
    fmt.Println("computing", n)
    return n * 2
})

for v := range Take(seq, 3) {
    fmt.Println("got", v)
}
// computes only 3 elements; the rest are never evaluated
```

This is *the* feature of iter.Seq — lazy by construction. Composing iterators doesn't materialize the result.

---

## 6. Lazy evaluation

Compare:

```go
// Eager — materializes all 1M elements
results := slices.Map(million, func(x int) int { return expensive(x) })
return results[:5]

// Lazy — only computes 5
seq := Map(slices.Values(million), expensive)
result := slices.Collect(Take(seq, 5))
return result
```

When you need only the first N (or filter most away), lazy saves work proportional to the difference.

When you need *all* elements, lazy doesn't help — and adds slight per-element overhead.

The rule: use lazy when intermediate operations dominate cost, eager when the result is always fully consumed.

---

## 7. Stateful iterators with Close

Some iterators hold resources (open files, DB connections, network sockets). They need explicit cleanup.

### 7.1 The Close pattern

```go
type fileIterator struct {
    f       *os.File
    scanner *bufio.Scanner
}

func NewFileIterator(path string) (*fileIterator, error) {
    f, err := os.Open(path)
    if err != nil { return nil, err }
    return &fileIterator{
        f: f,
        scanner: bufio.NewScanner(f),
    }, nil
}

func (i *fileIterator) Next() bool      { return i.scanner.Scan() }
func (i *fileIterator) Value() string   { return i.scanner.Text() }
func (i *fileIterator) Err() error      { return i.scanner.Err() }
func (i *fileIterator) Close() error    { return i.f.Close() }
```

Caller:

```go
it, err := NewFileIterator(path)
if err != nil { return err }
defer it.Close()
for it.Next() {
    line := it.Value()
    /* ... */
}
return it.Err()
```

### 7.2 Bridging to iter.Seq with cleanup

```go
func FileLines(path string) (iter.Seq[string], func(), error) {
    f, err := os.Open(path)
    if err != nil { return nil, nil, err }

    scanner := bufio.NewScanner(f)
    seq := func(yield func(string) bool) {
        for scanner.Scan() {
            if !yield(scanner.Text()) { return }
        }
    }
    return seq, func() { f.Close() }, nil
}

// Usage:
seq, cleanup, err := FileLines("data.txt")
if err != nil { return err }
defer cleanup()

for line := range seq {
    /* ... */
}
```

Return the iter.Seq alongside a cleanup function. Caller defers cleanup.

---

## 8. Paginated API iterators

A common real-world iterator: paginate through an HTTP API.

```go
func ListUsers(ctx context.Context, client *APIClient) iter.Seq2[*User, error] {
    return func(yield func(*User, error) bool) {
        cursor := ""
        for {
            page, err := client.UsersPage(ctx, cursor)
            if err != nil {
                yield(nil, err)
                return
            }
            for _, u := range page.Users {
                if !yield(u, nil) { return }
            }
            if page.NextCursor == "" {
                return
            }
            cursor = page.NextCursor
        }
    }
}

// Usage:
for user, err := range ListUsers(ctx, client) {
    if err != nil { return err }
    process(user)
}
```

The iterator hides the pagination from the caller. Each "next user" might be a cached value from the current page or trigger an API call for the next page.

### 8.1 Why iter.Seq2 with error

The error case fits naturally as a second return value. Alternative: return errors via a separate accessor (like `rows.Err()`).

```go
type ResultSeq[T any] struct {
    seq iter.Seq[T]
    err error
}

func (r *ResultSeq[T]) Err() error { return r.err }
```

Both work. `iter.Seq2[T, error]` is more idiomatic for the new style.

---

## 9. Generic iterator helpers

A utility package for reusable iterators:

```go
package iters

import "iter"

func Collect[T any](seq iter.Seq[T]) []T {
    var result []T
    for v := range seq { result = append(result, v) }
    return result
}

func Count[T any](seq iter.Seq[T]) int {
    n := 0
    for range seq { n++ }
    return n
}

func ForEach[T any](seq iter.Seq[T], f func(T)) {
    for v := range seq { f(v) }
}

func Reduce[T, U any](seq iter.Seq[T], init U, f func(U, T) U) U {
    acc := init
    for v := range seq { acc = f(acc, v) }
    return acc
}
```

The Go 1.23 stdlib has some of these (`slices.Collect`, `slices.SortedFunc`, etc.). Your custom helpers fill the gaps.

---

## 10. Channel-based generators

Pre-Go 1.23, channels were the iterator primitive:

```go
func PrimeNumbers(max int) <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for n := 2; n < max; n++ {
            if isPrime(n) { ch <- n }
        }
    }()
    return ch
}

for p := range PrimeNumbers(100) {
    fmt.Println(p)
}
```

Pros:
- Producer in separate goroutine — possibly parallel.
- Works with `range` directly.

Cons:
- **Goroutine leak** on early termination. The producer blocks on the channel forever if the consumer stops reading.

Fix: accept `context.Context` and check `<-ctx.Done()`:

```go
func PrimeNumbers(ctx context.Context, max int) <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for n := 2; n < max; n++ {
            if isPrime(n) {
                select {
                case ch <- n:
                case <-ctx.Done(): return
                }
            }
        }
    }()
    return ch
}
```

For most uses, prefer `iter.Seq` over channels. The exception: when the producer must run in a separate goroutine (e.g., reading from a network).

---

## 11. Testing iterators

### 11.1 Verify all elements

```go
func TestPrimes(t *testing.T) {
    got := slices.Collect(Primes(20))
    want := []int{2, 3, 5, 7, 11, 13, 17, 19}
    if !slices.Equal(got, want) {
        t.Errorf("got %v, want %v", got, want)
    }
}
```

`slices.Collect` materialises into a slice for easy comparison.

### 11.2 Verify early termination

```go
func TestEarlyTermination(t *testing.T) {
    count := 0
    for v := range Primes(1000000) {
        count++
        if count >= 3 { break }
        _ = v
    }
    if count != 3 { t.Errorf("got %d, want 3", count) }
}
```

The iterator should respect `break`. If it computes all 1M primes anyway, it's broken.

### 11.3 Verify cleanup

```go
func TestFileIterCleanup(t *testing.T) {
    f := makeTempFile(t)
    it, cleanup, _ := FileLines(f)
    defer cleanup()

    for range it { break }  // exit early

    // Verify the file is closed:
    if _, err := f.Read(buf); !errors.Is(err, os.ErrClosed) {
        t.Errorf("file not closed after cleanup")
    }
}
```

---

## 12. Common middle-level mistakes

### 12.1 Materialising large sequences

```go
// Anti-idiom
items := slices.Collect(query.AllUsers(ctx))  // 10M users → 10M heap allocations
for _, u := range items { /* ... */ }

// Idiomatic
for u := range query.AllUsers(ctx) {
    /* process one at a time */
}
```

Use `iter.Seq` to its strength: lazy, streaming.

### 12.2 Forgetting `iter.Pull` cleanup

```go
next, _ := iter.Pull(seq)  // stop function ignored
for {
    v, ok := next()
    if !ok { break }
    use(v)
}
```

Without calling `stop`, the underlying goroutine leaks. Always `defer stop()`.

### 12.3 Mutating the iterator's source mid-iteration

```go
for _, v := range slice {
    slice = append(slice, computeMore(v)...)  // !
}
```

`range` captures the slice header at loop start. Appending may reallocate the backing array; the loop still iterates the original.

For most cases, don't mutate the source during iteration. If you must, use an index-based loop and decide explicitly how new elements are handled.

### 12.4 iter.Seq with side effects on yield-false

```go
func Items() iter.Seq[Item] {
    return func(yield func(Item) bool) {
        for _, item := range allItems {
            yield(item)
            doSideEffect(item)  // runs even when caller broke
        }
    }
}
```

The side effect runs after `yield` returned `false`. If that's wrong, check:

```go
if !yield(item) { return }
doSideEffect(item)
```

---

## 13. Performance notes

```
BenchmarkSliceRange-8         500000000   3 ns/op
BenchmarkIterSeq-8            300000000   5 ns/op
BenchmarkNextValue-8          200000000   8 ns/op
BenchmarkChannelRange-8       1000000     1200 ns/op
BenchmarkIterPull-8           5000000     350 ns/op
```

- Built-in slice range is the fastest.
- `iter.Seq` is close (extra function call indirection).
- `Next/Value` interface is a bit slower (method calls).
- Channel iteration is much slower (scheduler overhead).
- `iter.Pull` is slow because it spawns a goroutine internally (in older implementations; future versions may improve).

For tight inner loops, prefer slice range. For composable iteration, `iter.Seq` is the right tool.

---

## 14. Tricky points

### 14.1 iter.Seq composition allocates closures

Each `Map`, `Filter`, `Take` returns a new `iter.Seq`, which is a function value capturing the underlying seq. The closure escapes; allocated on heap.

For a single iteration, this is fine (one closure per stage). For repeated iteration of the same pipeline, build it once.

### 14.2 The "leaked" generator goroutine

Even with `iter.Pull`'s built-in `stop()`, if the underlying iterator spawns a goroutine (e.g., a channel-based producer), `stop()` must terminate it. Use `context.Context` for explicit lifetime.

### 14.3 `for range` over a function with no return

```go
for range someFunc() { ... }  // valid for iter.Seq[V] — V is discarded
```

Works in Go 1.23+. The single-value form ignores the yielded value.

---

## 15. Test

### Q1. What does this print?

```go
seq := Range(0, 5)
for v := range seq {
    if v == 2 { break }
    fmt.Println(v)
}
```

<details><summary>Answer</summary>

`0` then `1`. The `if v == 2 { break }` exits before printing. The iterator's `yield(2)` returned false; the iterator stops.
</details>

### Q2. What's wrong?

```go
for u := range ListUsers(ctx) {
    if u.Active { return u }
}
```

<details><summary>Answer</summary>

If `ListUsers` returns `iter.Seq2[*User, error]`, the second value (error) is being ignored. Use `for u, err := range ...` and handle errors.

If it's `iter.Seq[*User]`, errors might be exposed via a separate accessor — check the API.
</details>

### Q3. Implement `Chain` — concatenate two iterators.

<details><summary>Answer</summary>

```go
func Chain[T any](a, b iter.Seq[T]) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range a {
            if !yield(v) { return }
        }
        for v := range b {
            if !yield(v) { return }
        }
    }
}
```

First exhausts `a`, then `b`. Caller's `break` stops both.
</details>

---

## 16. Cheat sheet

| Need | Solution |
|------|----------|
| Walk a built-in collection | `range` |
| Custom iterator | `iter.Seq[T]` |
| Key-value iterator | `iter.Seq2[K, V]` |
| Compose: map/filter/take | Free functions returning `iter.Seq[T]` |
| Two iterators in lockstep | `iter.Pull` |
| Cleanup needed | Return `iter.Seq` plus cleanup func |
| Paginated API | `iter.Seq2[T, error]` |
| Concurrent producer | Channel with context-aware producer |
| Materialise | `slices.Collect(seq)` |
| Count | `for range seq { n++ }` |
| Forget | `iter.Pull` requires `stop()` always |
