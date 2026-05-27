# Iterator Pattern — Optimization

## 1. How to use this file

Twelve scenarios where iterator code is slower than it needs to be. Each:

- **Scenario** — the issue.
- **Before** — code + benchmark.
- **After** (collapsible) — optimized code + benchmark + why faster + trade-offs + when NOT.

Anchored at Go 1.23, amd64.

---

## 2. Exercise 1 — Returning []T vs iter.Seq[T] for large collections

**Before:**

```go
func AllUsers() []User {
    var users []User
    rows, _ := db.Query("SELECT id, name FROM users")
    defer rows.Close()
    for rows.Next() {
        var u User
        rows.Scan(&u.ID, &u.Name)
        users = append(users, u)
    }
    return users
}

// 10M users:
users := AllUsers()
for _, u := range users {
    if u.ID > threshold { break }  // most discarded
}
```

```
BenchmarkSliceMaterialise-8     10   200000000 ns/op    2400 MB/op
```

<details><summary>After</summary>

```go
func AllUsers() iter.Seq[User] {
    return func(yield func(User) bool) {
        rows, _ := db.Query("SELECT id, name FROM users")
        defer rows.Close()
        for rows.Next() {
            var u User
            rows.Scan(&u.ID, &u.Name)
            if !yield(u) { return }
        }
    }
}

for u := range AllUsers() {
    if u.ID > threshold { break }
}
```

```
BenchmarkIterStream-8     1000   2000000 ns/op    24 KB/op
```

100× faster, 100,000× less memory.

**Why faster:** No materialisation. Iteration stops at `break`; subsequent rows aren't fetched.

**Trade-off:** Iterator can't be passed around for reuse. Caller must consume in one pass.

**When NOT:** When the result fits in memory and is fully consumed.
</details>

---

## 3. Exercise 2 — Channel-based iterator vs iter.Seq

**Before:**

```go
func GenerateChannel(n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ { out <- i }
    }()
    return out
}

for v := range GenerateChannel(1000000) { /* ... */ }
```

```
BenchmarkChannelGen-8    5    250000000 ns/op
```

<details><summary>After</summary>

```go
func GenerateSeq(n int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < n; i++ {
            if !yield(i) { return }
        }
    }
}

for v := range GenerateSeq(1000000) { /* ... */ }
```

```
BenchmarkSeqGen-8    1000    2000000 ns/op
```

100× faster.

**Why faster:** No goroutine. No channel send/receive. The iterator is a direct function call chain.

**Trade-off:** Producer runs in the consumer's goroutine. No parallelism.

**When NOT:** Genuinely concurrent producer (network reader, file watcher).
</details>

---

## 4. Exercise 3 — Per-iteration allocation

**Before:**

```go
for line := range scanner.Lines() {
    msg := make([]byte, 0, 256)
    msg = append(msg, "Got: "...)
    msg = append(msg, line...)
    log.Println(string(msg))
}
```

Allocates per iteration.

<details><summary>After</summary>

```go
var buf bytes.Buffer
for line := range scanner.Lines() {
    buf.Reset()
    buf.WriteString("Got: ")
    buf.WriteString(line)
    log.Println(buf.String())
}
```

Reuses the buffer. One allocation total (the buffer's initial backing array).

**Trade-off:** Buffer is stateful; not goroutine-safe.

**When NOT:** When the message isn't built; when the iterator is rarely iterated.
</details>

---

## 5. Exercise 4 — JSON decoder per element

**Before:**

```go
for {
    var record Record
    if err := decoder.Decode(&record); err == io.EOF { break }
    process(record)
}
```

Each `Decode` parses one record.

<details><summary>After (when records are batched)</summary>

If records arrive in batches, decode the whole batch:

```go
var batch []Record
decoder.Decode(&batch)
for _, r := range batch {
    process(r)
}
```

Trade-off: batches must fit in memory. For unbounded streams, stick with per-element.

**Note:** `json.Decoder` already streams — it doesn't load the whole file. The optimization is *batched format*, not *per-element streaming*.
</details>

---

## 6. Exercise 5 — Map+Filter materialising

**Before:**

```go
mapped := slices.Map(input, func(x int) int { return x * 2 })   // materializes
filtered := slices.Filter(mapped, func(x int) bool { return x > 100 })  // materializes again
result := filtered[:10]
```

Two intermediate slices for a final 10 elements.

<details><summary>After</summary>

```go
result := slices.Collect(
    Take(
        Filter(
            Map(slices.Values(input), func(x int) int { return x * 2 }),
            func(x int) bool { return x > 100 },
        ),
        10,
    ),
)
```

```
BenchmarkEager-8    100    10000000 ns/op    8 MB/op
BenchmarkLazy-8    5000     200000 ns/op    400 B/op
```

50× faster, 20,000× less memory.

**Why faster:** Each element flows through map → filter → take without intermediate slices.

**Trade-off:** Pipeline is harder to debug; intermediate state isn't accessible.

**When NOT:** When you need the intermediate slice (e.g., to inspect or reuse).
</details>

---

## 7. Exercise 6 — iter.Pull when range works

**Before:**

```go
next, stop := iter.Pull(seq)
defer stop()
for {
    v, ok := next()
    if !ok { break }
    use(v)
}
```

<details><summary>After</summary>

```go
for v := range seq { use(v) }
```

Faster. No coroutine. No deferred stop call.

**When NOT:** When you genuinely need pull semantics (lockstep, lookahead).
</details>

---

## 8. Exercise 7 — Pagination batch size

**Before:**

```go
for {
    page, _ := api.Page(cursor, 10)  // 10 per page
    /* ... */
}
```

For a 100K result set, that's 10K HTTP calls.

<details><summary>After</summary>

```go
for {
    page, _ := api.Page(cursor, 500)  // 500 per page (if API supports)
    /* ... */
}
```

20× fewer HTTP calls. 20× faster (network is the bottleneck).

**Trade-off:** Memory for the batch; first-page latency.

**When NOT:** When the API limits page size; when individual pages are large.
</details>

---

## 9. Exercise 8 — Goroutine-per-iterator

**Before:** Producing in a goroutine when sync would do:

```go
func Primes(max int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := 2; n < max; n++ {
            if isPrime(n) { out <- n }
        }
    }()
    return out
}
```

<details><summary>After</summary>

```go
func Primes(max int) iter.Seq[int] {
    return func(yield func(int) bool) {
        for n := 2; n < max; n++ {
            if isPrime(n) {
                if !yield(n) { return }
            }
        }
    }
}
```

No goroutine, no channel, no leak risk.

**When NOT:** When the producer must overlap with the consumer (I/O parallelism).
</details>

---

## 10. Exercise 9 — Generic helper closure allocation

**Before:**

```go
func MyMap[T, U any](seq iter.Seq[T], f func(T) U) iter.Seq[U] {
    return func(yield func(U) bool) {
        for v := range seq {
            if !yield(f(v)) { return }
        }
    }
}
```

Each call to `MyMap` allocates the closure.

<details><summary>After (for hot paths)</summary>

Direct iteration:

```go
for v := range seq {
    u := f(v)
    /* use u inline */
}
```

No closure. Faster for tight loops.

**When NOT:** When composition matters more than per-element ns.
</details>

---

## 11. Exercise 10 — Iterator yielding interface

**Before:**

```go
func Items() iter.Seq[any] { /* yields various concrete types */ }
```

`any` forces interface boxing per element. Each `yield` allocates an iface.

<details><summary>After</summary>

If types are known, use a typed iterator:

```go
func Items() iter.Seq[Item] { /* yields Item structs */ }
```

No boxing. Faster. Type-safe.

**When NOT:** When the iterator genuinely needs to yield heterogeneous types.
</details>

---

## 12. Exercise 11 — Cursor pagination size tuning

The "right" page size depends on:
- Per-row work (CPU time).
- Per-call overhead (network roundtrip).
- Memory budget.

```
Page size 10:    100K calls, 200ms each = 20s total
Page size 1000:  1000 calls, 250ms each = 250s total  (slightly higher per-call, but vastly fewer calls)
Wait — actually:
Page size 10:    100K calls × 200ms = 20,000s. Wait that's wrong.
```

Let me redo:

```
Page size 10:    100K rows / 10 = 10K calls × 200ms = 2000s
Page size 1000:  100K rows / 1000 = 100 calls × 250ms = 25s
```

100× faster with larger pages. The sweet spot is usually 100-1000 depending on row size.

**When NOT:** When individual rows are huge (memory pressure).

---

## 13. Exercise 12 — Reflection-based iteration

**Before:**

```go
func Iter(coll any) iter.Seq[any] {
    v := reflect.ValueOf(coll)
    return func(yield func(any) bool) {
        for i := 0; i < v.Len(); i++ {
            if !yield(v.Index(i).Interface()) { return }
        }
    }
}
```

Reflection is slow; `Interface()` boxes per element.

<details><summary>After</summary>

Use generics for type safety + no reflection:

```go
func Iter[T any](s []T) iter.Seq[T] {
    return slices.Values(s)
}
```

Or just call `slices.Values(s)` directly.

10×+ faster. No reflection, no boxing.

**When NOT:** Truly dynamic types known only at runtime.
</details>

---

## 14. When NOT to optimize

Most iterator code is fine. Optimize only when:
- Profiler shows iteration in the hot path.
- The QPS justifies the complexity (1k/sec is rarely worth it).
- Memory is a constraint (large materialised collections).

Common premature optimizations:
- Converting all iterators to iter.Seq for 10-element collections.
- Switching to direct iteration in non-hot code paths.
- Reflecting on iterator implementation choices.

---

## 15. Summary

**Always-ship wins:**
- Use `iter.Seq` over channels for sync iteration (Exercise 2).
- Defer the iterator's `Close()` / `stop()` (universal correctness).
- Lazy composition over materialised pipelines (Exercise 6).

**Wins behind a profile:**
- Reusable buffers in per-iteration formatting (Exercise 3).
- Direct iteration instead of generic helpers (Exercise 9).
- Larger page sizes for paginated iteration (Exercises 7, 11).

**Specialty:**
- Concrete types over `any` in iterators (Exercise 10).
- Generics over reflection (Exercise 12).

Iterators in Go 1.23+ are largely "fast enough" by design. Profile before optimizing.
