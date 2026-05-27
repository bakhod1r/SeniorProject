# Iterator Pattern — Hands-on Tasks

## 1. How to use this file

Fifteen progressive tasks. Each has:

- **Problem statement** — the scenario.
- **Acceptance criteria** — checkboxes you should satisfy.
- **Hints** (collapsible) — reach for them if stuck.
- **Solution** (collapsible) — full compilable Go.
- **Discussion** — trade-offs you missed.

All code is written for Go 1.23+ (range-over-func is a hard requirement from Task 2 onwards). Use `go run` to verify; the solutions assume a `package main` unless otherwise noted.

---

## Task 1 — Manual `Iterator` interface for a slice

Before Go had `iter.Seq`, an iterator was a small interface — usually two methods: `Next() bool` to advance, and `Value() T` to read the current element. Implement that classic shape over a slice.

```go
type IntIterator interface {
    Next() bool
    Value() int
}
```

**Acceptance criteria:**
- [ ] `NewSliceIter([]int) IntIterator` constructor.
- [ ] `Next` returns `false` once the iterator is exhausted; further calls stay `false`.
- [ ] `Value` after `Next` returned `false` must be safe to call (return zero value).
- [ ] Demonstrate iteration with a `for it.Next()` loop.

<details><summary>Hints</summary>

- Hold the slice and a current index `i` initialized to `-1`. `Next` increments and returns `i < len(s)`.
- That `-1` start matters: the *first* `Next` moves you to index 0.
</details>

<details><summary>Solution</summary>

```go
package main

import "fmt"

type IntIterator interface {
    Next() bool
    Value() int
}

type sliceIter struct {
    s []int
    i int
}

func NewSliceIter(s []int) IntIterator {
    return &sliceIter{s: s, i: -1}
}

func (it *sliceIter) Next() bool {
    if it.i+1 >= len(it.s) {
        it.i = len(it.s) // pin to end so Value returns zero
        return false
    }
    it.i++
    return true
}

func (it *sliceIter) Value() int {
    if it.i < 0 || it.i >= len(it.s) {
        return 0
    }
    return it.s[it.i]
}

func main() {
    it := NewSliceIter([]int{10, 20, 30})
    for it.Next() {
        fmt.Println(it.Value())
    }
    // safe after exhaustion
    fmt.Println("after end:", it.Value())
}
```
</details>

**Discussion:** This is the GoF "Iterator" verbatim. The two-method split (`Next` advances and reports liveness; `Value` reads) is awkward at first — most non-Go languages collapse them into one method — but it lets the caller peek at the current value multiple times without advancing, and it composes naturally with `for` loops. Holding `i = -1` as the pre-start sentinel keeps `Next` simple; the alternative is a `started bool` flag, which is uglier. From Task 2 onward we'll replace this whole dance with `iter.Seq[T]`.

---

## Task 2 — `iter.Seq[T]` for a slice (Go 1.23+)

Go 1.23 added *range-over-func*: a function whose signature is `func(yield func(T) bool)` can be ranged over directly. The standard library calls this type `iter.Seq[T]`.

Write `Seq(s []int) iter.Seq[int]` and range over it.

**Acceptance criteria:**
- [ ] Function signature returns `iter.Seq[int]`.
- [ ] Caller uses `for v := range Seq(s)` syntax.
- [ ] Early `break` in the loop stops the producer cleanly (the producer must respect `yield`'s return value).

<details><summary>Hints</summary>

- `iter.Seq[T]` is literally `func(yield func(T) bool)`. Returning one is just returning a closure.
- `yield(v)` returns `false` when the consumer broke out — stop immediately.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "iter"
)

func Seq(s []int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for _, v := range s {
            if !yield(v) {
                return
            }
        }
    }
}

func main() {
    nums := []int{1, 2, 3, 4, 5}

    for v := range Seq(nums) {
        fmt.Println(v)
    }

    // Early break: producer must stop when yield returns false.
    fmt.Println("--- break at 3 ---")
    for v := range Seq(nums) {
        if v == 3 {
            break
        }
        fmt.Println(v)
    }
}
```
</details>

**Discussion:** Compare with Task 1. The Seq version is shorter, the call site is a plain `for-range`, and the compiler handles all the state. The contract you must honour as a producer: when `yield` returns `false`, return immediately — do not yield more values, do not leak goroutines, do not hold locks. That single rule is what makes range-over-func interruptible without explicit cancellation plumbing. From now on, "iterator" means `iter.Seq[T]` (or `iter.Seq2[K,V]`) unless we say otherwise.

---

## Task 3 — `iter.Seq2[K,V]` for a map

Maps have two values per element, so they want a two-value iterator. The stdlib type is `iter.Seq2[K, V] = func(yield func(K, V) bool)`.

Write `MapSeq[K comparable, V any](m map[K]V) iter.Seq2[K, V]` and range over it with `for k, v := range ...`.

**Acceptance criteria:**
- [ ] Generic over key and value types.
- [ ] `for k, v := range MapSeq(m)` works.
- [ ] Honours `yield`'s return value (break works).
- [ ] Demo with at least two different map types (`map[string]int`, `map[int]string`).

<details><summary>Hints</summary>

- `iter.Seq2[K, V]` is `func(yield func(K, V) bool)`. Same pattern as Task 2, just two args.
- Go's `for k, v := range m` already does this — you're rebuilding it so you can later add transformations.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "iter"
)

func MapSeq[K comparable, V any](m map[K]V) iter.Seq2[K, V] {
    return func(yield func(K, V) bool) {
        for k, v := range m {
            if !yield(k, v) {
                return
            }
        }
    }
}

func main() {
    counts := map[string]int{"a": 1, "b": 2, "c": 3}
    for k, v := range MapSeq(counts) {
        fmt.Printf("%s=%d\n", k, v)
    }

    labels := map[int]string{1: "one", 2: "two", 3: "three"}
    for k, v := range MapSeq(labels) {
        fmt.Printf("%d -> %s\n", k, v)
        if k == 2 {
            break
        }
    }
}
```
</details>

**Discussion:** `iter.Seq2` is the right type whenever a logical element is a pair: map entries, key-value rows from a database, `(index, value)` enumerations. Don't reach for `iter.Seq[struct{K K; V V}]` — that loses the ergonomic `for k, v := range` form and forces field access on every read. The `comparable` constraint comes from `map`, not from `Seq2` itself; if you build pairs out of a non-map source, you can drop it.

---

## Task 4 — Channel-based generator with cleanup

Sometimes the data source is "running" — a goroutine that emits values as they're produced (file watcher, network listener, simulation). The traditional Go shape: a channel. Build a generator that emits 100 integers on a channel, *but* respects a stop signal so the producing goroutine exits when the consumer breaks early.

Wrap it as an `iter.Seq[int]` so callers don't see the channel at all.

**Acceptance criteria:**
- [ ] Producer goroutine emits on an unbuffered channel.
- [ ] Consumer can `break` early; no goroutine leak.
- [ ] Wrapper has signature `func() iter.Seq[int]`.
- [ ] Verify "no leak" by printing a "producer exiting" line.

<details><summary>Hints</summary>

- Use a `done chan struct{}` the wrapper closes when `yield` returns `false` or the loop ends.
- The producer selects on `done` and the channel send — that's the standard cancellation idiom.
- `defer close(done)` inside the `iter.Seq` body guarantees cleanup even on early return.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "iter"
)

func Numbers(n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        ch := make(chan int)
        done := make(chan struct{})
        defer close(done)

        go func() {
            defer fmt.Println("producer exiting")
            defer close(ch)
            for i := 0; i < n; i++ {
                select {
                case ch <- i:
                case <-done:
                    return
                }
            }
        }()

        for v := range ch {
            if !yield(v) {
                return // defer close(done) wakes producer
            }
        }
    }
}

func main() {
    fmt.Println("--- consume all ---")
    for v := range Numbers(3) {
        fmt.Println(v)
    }

    fmt.Println("--- break early ---")
    for v := range Numbers(100) {
        if v == 5 {
            break
        }
        fmt.Println(v)
    }
}
```
</details>

**Discussion:** The "channel as iterator" pattern is older than `iter.Seq`, and pre-1.23 code is full of it. The bug it punishes is *goroutine leaks*: if the consumer stops reading and you forget the cancellation signal, the producing goroutine sits blocked on the send forever. Wrapping the channel inside `iter.Seq` and using `defer close(done)` makes the cancellation handshake automatic — the consumer never sees the channel, but the producer still gets a clean exit when the `range` loop ends. Run it with `go run -race` to confirm clean shutdown.

---

## Task 5 — Paginated API iterator (HTTP roundtrip per page)

Most real iterators are over data you don't have yet — you fetch one page at a time and yield its rows. Build a paginated client over a stub HTTP server: the server returns 5 records per page until page 4, after which the cursor field is empty.

The iterator should:
- Yield one *record* per `yield` call, not one page.
- Make one HTTP request per page (not per record).
- Stop cleanly when the cursor is empty *or* the caller breaks.

**Acceptance criteria:**
- [ ] `Records(client *http.Client, base string) iter.Seq[Record]`.
- [ ] Exactly one HTTP request per page.
- [ ] Demonstrated against an `httptest.Server`.
- [ ] Network error stops the iterator (you can log it; in Task 11 we'll evolve to surface it).

<details><summary>Hints</summary>

- The stdlib pattern: `nextCursor` string, request once with empty cursor, then loop until the server returns empty.
- Yield records inside the inner page-loop; check `yield`'s return value to stop fetching.
- Use `httptest.NewServer` so the test is self-contained.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "encoding/json"
    "fmt"
    "iter"
    "net/http"
    "net/http/httptest"
    "net/url"
    "strconv"
)

type Record struct {
    ID   int    `json:"id"`
    Name string `json:"name"`
}

type page struct {
    Records []Record `json:"records"`
    Next    string   `json:"next"`
}

func Records(client *http.Client, base string) iter.Seq[Record] {
    return func(yield func(Record) bool) {
        cursor := ""
        for {
            u, _ := url.Parse(base)
            q := u.Query()
            if cursor != "" {
                q.Set("cursor", cursor)
            }
            u.RawQuery = q.Encode()

            resp, err := client.Get(u.String())
            if err != nil {
                fmt.Println("http error:", err)
                return
            }
            var p page
            if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
                resp.Body.Close()
                fmt.Println("decode error:", err)
                return
            }
            resp.Body.Close()

            for _, r := range p.Records {
                if !yield(r) {
                    return
                }
            }
            if p.Next == "" {
                return
            }
            cursor = p.Next
        }
    }
}

func main() {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        cur := r.URL.Query().Get("cursor")
        page, _ := strconv.Atoi(cur)
        if cur == "" {
            page = 0
        }
        out := struct {
            Records []Record `json:"records"`
            Next    string   `json:"next"`
        }{}
        for i := 0; i < 5; i++ {
            id := page*5 + i
            out.Records = append(out.Records, Record{ID: id, Name: fmt.Sprintf("r%d", id)})
        }
        if page < 3 {
            out.Next = strconv.Itoa(page + 1)
        }
        json.NewEncoder(w).Encode(out)
    }))
    defer srv.Close()

    count := 0
    for rec := range Records(srv.Client(), srv.URL) {
        fmt.Printf("%d: %s\n", rec.ID, rec.Name)
        count++
    }
    fmt.Println("total:", count)
}
```
</details>

**Discussion:** This is the iterator pattern at its most useful: the *caller* writes a simple `for r := range Records(...)` loop without knowing whether the data comes from one page or thirty. Pagination is an implementation detail. Two things to watch: (1) one HTTP request per *page*, not per record — record-level requests would be a disaster; (2) the `yield` return value lets the caller stop after the first match without fetching the next page. Errors are dropped here for brevity; Task 11 will show how to bridge errors into the iterator's surface.

---

## Task 6 — Iterator with context cancellation

Build an `iter.Seq[int]` that produces a tick value every 50ms, but stops when a `context.Context` is cancelled. The caller passes the context in.

```go
func Ticks(ctx context.Context, every time.Duration) iter.Seq[int]
```

**Acceptance criteria:**
- [ ] When `ctx` is cancelled, the iterator stops on its next opportunity.
- [ ] No goroutine or ticker leak.
- [ ] Demonstrate with `context.WithTimeout`.

<details><summary>Hints</summary>

- `time.NewTicker` + `defer tick.Stop()` inside the iterator body.
- `select` on `ctx.Done()` and `tick.C`.
- The iterator's "stop" can come from two sources: `ctx.Done()` *or* `yield(...) == false`. Handle both.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "context"
    "fmt"
    "iter"
    "time"
)

func Ticks(ctx context.Context, every time.Duration) iter.Seq[int] {
    return func(yield func(int) bool) {
        t := time.NewTicker(every)
        defer t.Stop()
        i := 0
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
                if !yield(i) {
                    return
                }
                i++
            }
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 220*time.Millisecond)
    defer cancel()

    for v := range Ticks(ctx, 50*time.Millisecond) {
        fmt.Println("tick", v)
    }
    fmt.Println("done")
}
```
</details>

**Discussion:** A bare `iter.Seq` has no place for a context argument — so you pass the context *into the factory function* that returns the `Seq`. That's the standard shape for cancellable iterators. The body then has two reasons to exit: caller broke out (`yield` returned false), or context cancelled. Both must drain the ticker, both must `return`. Note we deliberately don't yield on `ctx.Done()` — once the context is cancelled, we stop emitting; the loop ends naturally for the consumer.

---

## Task 7 — Composable `Map`, `Filter`, `Take`, `Skip`

Iterators get powerful when they compose. Build the four classic operators over `iter.Seq[T]`:

```go
func Map[T, U any](seq iter.Seq[T], f func(T) U) iter.Seq[U]
func Filter[T any](seq iter.Seq[T], pred func(T) bool) iter.Seq[T]
func Take[T any](seq iter.Seq[T], n int) iter.Seq[T]
func Skip[T any](seq iter.Seq[T], n int) iter.Seq[T]
```

**Acceptance criteria:**
- [ ] All four are lazy (no work until ranged over).
- [ ] All four propagate early termination correctly.
- [ ] Demo: `Take(Filter(Map(...), pred), 3)` — first three even squares.

<details><summary>Hints</summary>

- Each operator is a `func` that returns a closure of type `iter.Seq[?]`.
- For `Take(n)`, stop after `n` yields *and* return `false` from your inner `yield`.
- Range *over* the inner `seq` to consume it.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "iter"
)

func Map[T, U any](seq iter.Seq[T], f func(T) U) iter.Seq[U] {
    return func(yield func(U) bool) {
        for v := range seq {
            if !yield(f(v)) {
                return
            }
        }
    }
}

func Filter[T any](seq iter.Seq[T], pred func(T) bool) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range seq {
            if !pred(v) {
                continue
            }
            if !yield(v) {
                return
            }
        }
    }
}

func Take[T any](seq iter.Seq[T], n int) iter.Seq[T] {
    return func(yield func(T) bool) {
        if n <= 0 {
            return
        }
        i := 0
        for v := range seq {
            if !yield(v) {
                return
            }
            i++
            if i >= n {
                return
            }
        }
    }
}

func Skip[T any](seq iter.Seq[T], n int) iter.Seq[T] {
    return func(yield func(T) bool) {
        i := 0
        for v := range seq {
            if i < n {
                i++
                continue
            }
            if !yield(v) {
                return
            }
        }
    }
}

func intRange(start, end int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := start; i < end; i++ {
            if !yield(i) {
                return
            }
        }
    }
}

func main() {
    seq := intRange(1, 1000)
    squares := Map(seq, func(n int) int { return n * n })
    evenSquares := Filter(squares, func(n int) bool { return n%2 == 0 })
    firstThree := Take(evenSquares, 3)

    for v := range firstThree {
        fmt.Println(v)
    }

    fmt.Println("--- skip 5, take 3 ---")
    for v := range Take(Skip(intRange(0, 100), 5), 3) {
        fmt.Println(v)
    }
}
```
</details>

**Discussion:** This is what makes iterators worth the trouble. Each operator is a pure function from `Seq` to `Seq`; nothing is computed until the final `for-range` pulls. `Take(Filter(Map(seq, ...), ...), 3)` over a 1000-element source does *not* compute 1000 squares — it computes only as many as it needs to find three matches, then stops. Three subtle points: (1) operators must propagate the `false` from their inner yield, (2) `Take(0)` should produce nothing without consuming the source, (3) `Skip` does consume but does not yield — easy to forget. Compare to the stdlib `slices.Collect` and the in-progress `xiter` proposal for the canonical names.

---

## Task 8 — Tree traversal iterator (in-order)

Iterators over linear data are easy; tree traversals are where they shine, because the bookkeeping moves *into* the iterator and out of the call site. Build an in-order traversal of a binary search tree as an `iter.Seq[int]`.

```go
type Node struct {
    Val         int
    Left, Right *Node
}
func InOrder(root *Node) iter.Seq[int]
```

**Acceptance criteria:**
- [ ] In-order traversal yields values in sorted order for a BST.
- [ ] Early `break` stops traversal cleanly.
- [ ] Recursive *or* iterative implementation; both are fine.

<details><summary>Hints</summary>

- The recursive version is cleanest: a helper `visit(n)` that calls itself for left, yields, then recurses right. Helper returns a `bool` (whether to keep going).
- The iterative version uses an explicit stack and is the standard interview answer.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "iter"
)

type Node struct {
    Val         int
    Left, Right *Node
}

func InOrder(root *Node) iter.Seq[int] {
    var visit func(n *Node, yield func(int) bool) bool
    visit = func(n *Node, yield func(int) bool) bool {
        if n == nil {
            return true
        }
        if !visit(n.Left, yield) {
            return false
        }
        if !yield(n.Val) {
            return false
        }
        return visit(n.Right, yield)
    }
    return func(yield func(int) bool) {
        visit(root, yield)
    }
}

func main() {
    //         5
        //       /   \
        //      3     8
        //     / \   / \
        //    1   4 7   9
    root := &Node{Val: 5,
        Left:  &Node{Val: 3, Left: &Node{Val: 1}, Right: &Node{Val: 4}},
        Right: &Node{Val: 8, Left: &Node{Val: 7}, Right: &Node{Val: 9}},
    }

    for v := range InOrder(root) {
        fmt.Println(v)
    }

    fmt.Println("--- first three ---")
    count := 0
    for v := range InOrder(root) {
        fmt.Println(v)
        count++
        if count == 3 {
            break
        }
    }
}
```
</details>

**Discussion:** The interesting part isn't the traversal — it's how `iter.Seq` makes the *interruptibility* trivial. A classic recursive walk that "returns a slice" computes the whole tree. An "iterator" that's just a goroutine-with-channel needs explicit cancellation plumbing. Range-over-func gives you cancellation for free: each `visit` call checks the recursive return value, and a single `break` at the top of the call site unwinds the entire stack. Iterative-with-explicit-stack implementations are sometimes preferred for very deep trees where Go's goroutine-stack growth costs add up; for balanced BSTs the recursive form is unbeatable.

---

## Task 9 — CSV reader as `iter.Seq`

Wrap the standard library's `encoding/csv.Reader` as an iterator. Each yielded element is one row (`[]string`). Stop on EOF; stop on `yield == false`; stop on error (log and return).

**Acceptance criteria:**
- [ ] `CSVRows(r io.Reader) iter.Seq[[]string]`.
- [ ] One row per yield.
- [ ] EOF ends the iterator silently.
- [ ] Parse errors are logged and end the iterator.
- [ ] Test with a `strings.Reader` (no real file).

<details><summary>Hints</summary>

- `csv.NewReader(r)` returns a reader; call `Read()` until it returns `io.EOF`.
- Errors that are not `io.EOF` should be reported (Task 11 shows a cleaner way to bubble them).
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "encoding/csv"
    "errors"
    "fmt"
    "io"
    "iter"
    "strings"
)

func CSVRows(r io.Reader) iter.Seq[[]string] {
    return func(yield func([]string) bool) {
        cr := csv.NewReader(r)
        for {
            row, err := cr.Read()
            if errors.Is(err, io.EOF) {
                return
            }
            if err != nil {
                fmt.Println("csv error:", err)
                return
            }
            if !yield(row) {
                return
            }
        }
    }
}

func main() {
    src := `id,name,score
1,alice,42
2,bob,17
3,carol,99
`
    for row := range CSVRows(strings.NewReader(src)) {
        fmt.Println(row)
    }
}
```
</details>

**Discussion:** This is the typical "wrap a `Reader`" iterator: an external resource with its own state, exposed as a pull-based sequence. The pattern shows up for `bufio.Scanner` (lines), `json.Decoder` (tokens), `sql.Rows`, and anywhere else the stdlib already has a "step through" API. The cost of swallowing errors here is real — Task 11 fixes that. The reason `csv.Reader` doesn't already implement `iter.Seq` itself is that the iterator package landed in 1.23 and the stdlib is still catching up; expect such wrappers to disappear in future Go versions.

---

## Task 10 — Lazy infinite sequence (Fibonacci, primes)

Infinite sequences are the strongest argument for laziness. Build two: `Fib() iter.Seq[int]` (Fibonacci) and `Primes() iter.Seq[int]` (sieve-free trial-division is fine). Combine them with `Take` from Task 7 to get the first 10 of each.

**Acceptance criteria:**
- [ ] Both iterators never return on their own — they only stop when `yield` returns `false`.
- [ ] `Take(Fib(), 10)` produces exactly 10 values.
- [ ] `Primes()` yields 2, 3, 5, 7, 11, ...
- [ ] No global state.

<details><summary>Hints</summary>

- `Fib`: two state ints `a, b`; yield `a`, then `a, b = b, a+b`.
- `Primes`: for each candidate `n`, test divisibility by every smaller prime up to √n. Hold the primes you've found so far in a slice.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "iter"
)

func Fib() iter.Seq[int] {
    return func(yield func(int) bool) {
        a, b := 0, 1
        for {
            if !yield(a) {
                return
            }
            a, b = b, a+b
        }
    }
}

func Primes() iter.Seq[int] {
    return func(yield func(int) bool) {
        var found []int
        n := 2
        for {
            isPrime := true
            for _, p := range found {
                if p*p > n {
                    break
                }
                if n%p == 0 {
                    isPrime = false
                    break
                }
            }
            if isPrime {
                found = append(found, n)
                if !yield(n) {
                    return
                }
            }
            n++
        }
    }
}

func Take[T any](seq iter.Seq[T], n int) iter.Seq[T] {
    return func(yield func(T) bool) {
        if n <= 0 {
            return
        }
        i := 0
        for v := range seq {
            if !yield(v) {
                return
            }
            i++
            if i >= n {
                return
            }
        }
    }
}

func main() {
    fmt.Println("--- first 10 fib ---")
    for v := range Take(Fib(), 10) {
        fmt.Println(v)
    }
    fmt.Println("--- first 10 primes ---")
    for v := range Take(Primes(), 10) {
        fmt.Println(v)
    }
}
```
</details>

**Discussion:** Infinite sequences are the showpiece for lazy iterators. The producer would loop forever if the consumer didn't break — but the consumer can decide *at any point* it's seen enough, and the producer stops on the very next `yield`. Memory stays O(state), not O(values-emitted). Compare with `[]int{...}`: you cannot return "all primes". A small but real gotcha: the inner state (`a, b` in Fib, `found` in Primes) is captured by the closure — if you call `Fib()` twice you get two independent sequences. That's the right behaviour.

---

## Task 11 — Bridging `Next()/Value()` to `iter.Seq`

You inherit a library with the old-school iterator from Task 1:

```go
type Rows interface {
    Next() bool
    Scan(dst ...any) error
    Err() error
    Close() error
}
```

You want callers to use `for r := range ...` over it. Build the bridge.

```go
type Row struct {
    ID   int
    Name string
}
func IterRows(rs Rows) iter.Seq2[Row, error]
```

`iter.Seq2[Row, error]` is the conventional Go shape for "iterator that can fail": the second value is an error (mostly `nil`, but the final element may carry the iteration error).

**Acceptance criteria:**
- [ ] `iter.Seq2[Row, error]`.
- [ ] On scan/iteration error, yield `(Row{}, err)` once, then stop.
- [ ] `Close` is called when iteration ends (success, error, or early break).
- [ ] Demo with a fake `Rows` implementation.

<details><summary>Hints</summary>

- Use `defer rs.Close()` inside the iterator body.
- After the `for rs.Next()` loop, check `rs.Err()` — that's where stdlib `sql.Rows` and `bufio.Scanner` put trailing errors.
- The `(value, error)` Seq2 shape is the Go-blog-recommended way to surface errors from iterators.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "errors"
    "fmt"
    "iter"
)

type Rows interface {
    Next() bool
    Scan(dst ...any) error
    Err() error
    Close() error
}

type Row struct {
    ID   int
    Name string
}

func IterRows(rs Rows) iter.Seq2[Row, error] {
    return func(yield func(Row, error) bool) {
        defer rs.Close()
        for rs.Next() {
            var r Row
            if err := rs.Scan(&r.ID, &r.Name); err != nil {
                yield(Row{}, err)
                return
            }
            if !yield(r, nil) {
                return
            }
        }
        if err := rs.Err(); err != nil {
            yield(Row{}, err)
        }
    }
}

// --- fake Rows for the demo ---

type fakeRows struct {
    data   []Row
    i      int
    failAt int
    closed bool
}

func (f *fakeRows) Next() bool { return f.i < len(f.data) }
func (f *fakeRows) Scan(dst ...any) error {
    if f.i == f.failAt {
        return errors.New("scan failed")
    }
    *(dst[0].(*int)) = f.data[f.i].ID
    *(dst[1].(*string)) = f.data[f.i].Name
    f.i++
    return nil
}
func (f *fakeRows) Err() error   { return nil }
func (f *fakeRows) Close() error { f.closed = true; fmt.Println("rows closed"); return nil }

func main() {
    rows := &fakeRows{
        data:   []Row{{1, "alice"}, {2, "bob"}, {3, "carol"}},
        failAt: -1,
    }
    for r, err := range IterRows(rows) {
        if err != nil {
            fmt.Println("error:", err)
            break
        }
        fmt.Printf("%+v\n", r)
    }

    fmt.Println("--- with scan error at row 2 ---")
    rows2 := &fakeRows{
        data:   []Row{{1, "alice"}, {2, "bob"}, {3, "carol"}},
        failAt: 1,
    }
    for r, err := range IterRows(rows2) {
        if err != nil {
            fmt.Println("error:", err)
            break
        }
        fmt.Printf("%+v\n", r)
    }
}
```
</details>

**Discussion:** `iter.Seq2[T, error]` is the consensus pattern for fallible iterators in Go 1.23+. It maps cleanly to the SQL idiom (`for rows.Next() ... rows.Err()`), it shows up in `bufio.Scanner` wrappers, and it composes with `Filter`/`Map` *if those are written to thread errors through*. The crucial discipline: when you yield an error, *stop*. Don't keep emitting more rows after a failure. The `defer rs.Close()` is the resource-cleanup half of the contract — Task 4 was about goroutines, this one is about `Close`.

---

## Task 12 — Pull iterator using `iter.Pull`

`for-range` is the *push* model: the producer drives. Sometimes you want the *pull* model: the consumer calls a function to get the next value, and the iterator advances exactly once per call. The stdlib gives you that via `iter.Pull(seq)`.

```go
next, stop := iter.Pull(seq)
defer stop()
v, ok := next()
```

Use it to build a `Zip[A, B]` operator that pulls one value from each of two iterators per round.

```go
func Zip[A, B any](sa iter.Seq[A], sb iter.Seq[B]) iter.Seq2[A, B]
```

**Acceptance criteria:**
- [ ] Use `iter.Pull` for both inputs.
- [ ] Always call `stop` on both pull iterators when done (defer is fine).
- [ ] When either input ends, the zip ends.
- [ ] Demo: zip `[a, b, c, d]` with `[1, 2, 3]` — three pairs.

<details><summary>Hints</summary>

- `iter.Pull[T](seq iter.Seq[T]) (next func() (T, bool), stop func())`.
- Stop the *other* iterator promptly when the first one returns `ok=false`.
- `defer stopA(); defer stopB()` is fine — defer order doesn't matter here.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "iter"
)

func Zip[A, B any](sa iter.Seq[A], sb iter.Seq[B]) iter.Seq2[A, B] {
    return func(yield func(A, B) bool) {
        nextA, stopA := iter.Pull(sa)
        defer stopA()
        nextB, stopB := iter.Pull(sb)
        defer stopB()
        for {
            a, okA := nextA()
            if !okA {
                return
            }
            b, okB := nextB()
            if !okB {
                return
            }
            if !yield(a, b) {
                return
            }
        }
    }
}

func sliceSeq[T any](s []T) iter.Seq[T] {
    return func(yield func(T) bool) {
        for _, v := range s {
            if !yield(v) {
                return
            }
        }
    }
}

func main() {
    letters := sliceSeq([]string{"a", "b", "c", "d"})
    numbers := sliceSeq([]int{1, 2, 3})

    for l, n := range Zip(letters, numbers) {
        fmt.Printf("%s=%d\n", l, n)
    }
}
```
</details>

**Discussion:** `iter.Pull` is the escape hatch from the push model. It runs the producer in a coroutine and lets you ask for the next value on demand. The cost: each `Pull` call sets up a goroutine-style coroutine pair, so it's heavier than a direct `for-range`. Use it when you need to interleave two or more iterators (zip, merge, alternate), peek ahead, or expose a `Next/Value`-style API on top of an `iter.Seq` producer. Always `stop()` — that's how the coroutine knows you're done; forgetting it leaks the underlying goroutine. The `defer` pair is the canonical shape.

---

## Task 13 — Concurrent merge of multiple iterators

Given `n` iterators producing the same type, merge them into one iterator that yields values in *first-come* order — whichever source has one ready next. Each source runs in its own goroutine; the merge fan-ins onto one channel and yields from it.

```go
func Merge[T any](sources ...iter.Seq[T]) iter.Seq[T]
```

**Acceptance criteria:**
- [ ] All sources run concurrently.
- [ ] Caller `break` stops every source — no leaks.
- [ ] Order is not guaranteed (it depends on goroutine scheduling).
- [ ] `go run -race` clean.

<details><summary>Hints</summary>

- Each source goroutine ranges over its `iter.Seq` and pushes onto a shared channel; honour a `done` channel.
- A `sync.WaitGroup` knows when all sources have finished; close the merge channel from a separate goroutine that waits on the group.
- The receiving loop ranges over the channel and `yield`s; on `yield == false`, close `done` to wake the sources.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "iter"
    "sync"
    "time"
)

func Merge[T any](sources ...iter.Seq[T]) iter.Seq[T] {
    return func(yield func(T) bool) {
        out := make(chan T)
        done := make(chan struct{})
        defer close(done)

        var wg sync.WaitGroup
        wg.Add(len(sources))
        for _, src := range sources {
            go func(s iter.Seq[T]) {
                defer wg.Done()
                for v := range s {
                    select {
                    case out <- v:
                    case <-done:
                        return
                    }
                }
            }(src)
        }
        go func() {
            wg.Wait()
            close(out)
        }()

        for v := range out {
            if !yield(v) {
                return
            }
        }
    }
}

func slow(name string, vals []int, delay time.Duration) iter.Seq[string] {
    return func(yield func(string) bool) {
        for _, v := range vals {
            time.Sleep(delay)
            if !yield(fmt.Sprintf("%s:%d", name, v)) {
                return
            }
        }
    }
}

func main() {
    a := slow("a", []int{1, 2, 3}, 30*time.Millisecond)
    b := slow("b", []int{10, 20, 30}, 50*time.Millisecond)
    c := slow("c", []int{100, 200, 300}, 20*time.Millisecond)

    for v := range Merge(a, b, c) {
        fmt.Println(v)
    }
}
```
</details>

**Discussion:** This is fan-in by another name — `Merge` is the iterator-shaped twin of the classic "select on N channels" goroutine. The hard part is *cancellation*: when the consumer breaks, the parent iterator's `defer close(done)` triggers every source goroutine's `select` to fall through and return. Without that signal you leak `N` goroutines per merge. The output channel must also be drained for the merge to know when all sources finished — that's the `wg.Wait(); close(out)` goroutine. Run with `-race`. Compare to a `select`-driven merge that doesn't use a channel at all: simpler for `N=2`, hard at `N=K`.

---

## Task 14 — Test fixture: deterministic iterator

Tests over iterator-based code need a known, replayable sequence. Build a small test helper:

```go
type FakeSeq[T any] struct {
    Values  []T
    StopAt  int    // if > 0, stop yielding after this many values
    Yielded int    // populated as the seq runs
}
func (f *FakeSeq[T]) Seq() iter.Seq[T]
```

The fixture should let a test assert exactly how many values were consumed.

**Acceptance criteria:**
- [ ] `Seq()` returns an `iter.Seq[T]` over `Values`.
- [ ] If `StopAt > 0`, the fixture refuses to yield beyond that many values (simulates a finite source).
- [ ] `Yielded` reflects the actual count after a `for-range`.
- [ ] Demonstrate with a `Filter`-style consumer that breaks early — confirm `Yielded` matches.

<details><summary>Hints</summary>

- Increment `Yielded` *before* calling `yield(v)` — it's the count of values you handed to the consumer.
- This is the iterator equivalent of the user factory in Factory Pattern Task 14.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "fmt"
    "iter"
)

type FakeSeq[T any] struct {
    Values  []T
    StopAt  int
    Yielded int
}

func (f *FakeSeq[T]) Seq() iter.Seq[T] {
    return func(yield func(T) bool) {
        for i, v := range f.Values {
            if f.StopAt > 0 && i >= f.StopAt {
                return
            }
            f.Yielded++
            if !yield(v) {
                return
            }
        }
    }
}

func Filter[T any](seq iter.Seq[T], pred func(T) bool) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range seq {
            if !pred(v) {
                continue
            }
            if !yield(v) {
                return
            }
        }
    }
}

func main() {
    fixture := &FakeSeq[int]{
        Values: []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10},
    }

    // Find the first even number; iterator must stop after value 2.
    var found int
    for v := range Filter(fixture.Seq(), func(n int) bool { return n%2 == 0 }) {
        found = v
        break
    }
    fmt.Println("found:", found)
    fmt.Println("values pulled from source:", fixture.Yielded) // expect 2

    fixture2 := &FakeSeq[int]{
        Values: []int{1, 2, 3, 4, 5},
        StopAt: 3,
    }
    for v := range fixture2.Seq() {
        fmt.Println("emitted:", v)
    }
    fmt.Println("yielded total:", fixture2.Yielded) // expect 3
}
```
</details>

**Discussion:** Tests for code that consumes iterators have one job: assert that the consumer reads *only as much as it should*. A `Filter(Take(seq, 1))` over an expensive source had better not consume the whole source. The fixture above turns "consumed how many" into a plain integer you can assert. Determinism beats "use a real `[]int`" because the fixture also tracks consumption — you'd otherwise have to wrap the source in another instrumentation layer. This is the same shape as `httptest.ResponseRecorder`: a thin, observable stand-in for the real thing.

---

## Task 15 — Mini-project: streaming JSON array parser

Build a streaming reader for top-level JSON arrays of objects. The input is potentially huge (gigabytes); you must not load it all into memory. The output is an iterator that yields one decoded object at a time, plus an error iterator-pair (`iter.Seq2[T, error]`).

```go
type Event struct {
    ID   int       `json:"id"`
    Type string    `json:"type"`
    At   time.Time `json:"at"`
}
func StreamEvents(r io.Reader) iter.Seq2[Event, error]
```

**Acceptance criteria:**
- [ ] Reads the opening `[`, then decodes one object per element.
- [ ] Yields each `Event` with a `nil` error; on decode error, yields `(zero, err)` and stops.
- [ ] Reads the closing `]` and ends silently.
- [ ] Works on streams larger than memory (no `io.ReadAll`).
- [ ] Demonstrated with a stub stream containing 5 events.

<details><summary>Hints</summary>

- `json.Decoder` is the right tool: `dec.Token()` to consume `[`, `dec.More()` to check for more elements, `dec.Decode(&ev)` to decode each one, `dec.Token()` again for `]`.
- Validate that the first token is `json.Delim('[')` — anything else is a malformed stream.
- Always yield exactly one error tuple on failure, then return.
</details>

<details><summary>Solution</summary>

```go
package main

import (
    "encoding/json"
    "fmt"
    "io"
    "iter"
    "strings"
    "time"
)

type Event struct {
    ID   int       `json:"id"`
    Type string    `json:"type"`
    At   time.Time `json:"at"`
}

func StreamEvents(r io.Reader) iter.Seq2[Event, error] {
    return func(yield func(Event, error) bool) {
        dec := json.NewDecoder(r)

        tok, err := dec.Token()
        if err != nil {
            yield(Event{}, fmt.Errorf("reading opening token: %w", err))
            return
        }
        d, ok := tok.(json.Delim)
        if !ok || d != '[' {
            yield(Event{}, fmt.Errorf("expected '[', got %v", tok))
            return
        }

        for dec.More() {
            var ev Event
            if err := dec.Decode(&ev); err != nil {
                yield(Event{}, fmt.Errorf("decode: %w", err))
                return
            }
            if !yield(ev, nil) {
                return
            }
        }

        if _, err := dec.Token(); err != nil && err != io.EOF {
            yield(Event{}, fmt.Errorf("reading closing token: %w", err))
            return
        }
    }
}

func main() {
    body := `[
        {"id": 1, "type": "click",  "at": "2025-01-01T10:00:00Z"},
        {"id": 2, "type": "view",   "at": "2025-01-01T10:00:05Z"},
        {"id": 3, "type": "click",  "at": "2025-01-01T10:00:10Z"},
        {"id": 4, "type": "logout", "at": "2025-01-01T10:00:15Z"},
        {"id": 5, "type": "login",  "at": "2025-01-01T10:00:20Z"}
    ]`

    count := 0
    for ev, err := range StreamEvents(strings.NewReader(body)) {
        if err != nil {
            fmt.Println("error:", err)
            break
        }
        fmt.Printf("%+v\n", ev)
        count++
    }
    fmt.Println("events:", count)

    fmt.Println("--- malformed input ---")
    bad := `[{"id": 1, "type": "click", "at": "not-a-date"}]`
    for _, err := range StreamEvents(strings.NewReader(bad)) {
        if err != nil {
            fmt.Println("got expected error:", err)
            break
        }
    }
}
```
</details>

**Discussion:** This is the iterator pattern doing real work. The parser holds *one event* in memory at a time; the caller can `break` after the first interesting record and the rest of the gigabyte file is never read. Three pieces have to align: `json.Decoder` for *streaming* parse (don't ever reach for `json.Unmarshal` on a huge array), `iter.Seq2[T, error]` for *fallible iteration* (Task 11's pattern), and the closure-shape `iter.Seq` so the call site is a plain `for-range`. Each piece is small; together they replace a hand-rolled `Next/Value/Err` parser that would be five times longer and easier to get wrong.

Compare to "load the whole array, then range" — that works fine until the file is 500 MB and your service OOMs at 3am. Compare to "callbacks: `func(Event) error`" — that works, but the caller has to thread their own loop state through a closure, can't `break` naturally, can't compose with `Filter`/`Take`. The iterator wins on every axis.

---

## Wrap-up

You've now written iterators for: a slice, a slice via `iter.Seq`, a map via `iter.Seq2`, a goroutine-fed channel, a paginated HTTP API, a context-bound ticker, composable Map/Filter/Take/Skip, a binary tree, a CSV stream, two infinite sequences, a legacy `Next/Value` bridge, a pull-mode `Zip`, a concurrent `Merge`, a deterministic test fixture, and a streaming JSON parser.

The common thread: every iterator is a *contract*. The producer agrees to stop when `yield` returns `false`; the consumer agrees to use the values once and not retain them past the next iteration. `iter.Seq[T]` is the canonical type; `iter.Seq2[T, error]` is how Go expresses fallible iteration; `iter.Pull` is the escape hatch when push isn't enough. Reach for an iterator whenever your data is large, lazy, infinite, or expensive to produce — and whenever you want a `for-range` at the call site to stand in for a hand-written `Next/Value/Close` loop.
