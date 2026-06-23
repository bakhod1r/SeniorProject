# Iterator Pattern — Interview Preparation

## 1. What interviewers test for

Iterator is tested differently in Go than in other languages, especially since Go 1.23 added `iter.Seq`. Interviewers look for:

- Familiarity with `iter.Seq` and `iter.Seq2`.
- Knowing when to write an iterator vs return a slice.
- `Close()` and `Err()` discipline.
- Channel-based generator pitfalls (goroutine leaks).
- Composition (Map/Filter/Take) idioms.

Signals by level:

| Level | Looking for |
|-------|-------------|
| Junior | Use `range` correctly; know `Next/Value` exists for DB rows; understand `defer Close()` |
| Middle | Write iter.Seq[T]; compose iterators; handle pagination |
| Senior | Designing iterator APIs; cursor-based pagination; performance trade-offs |

---

## 2. Junior questions

### Q1. What's the Iterator pattern in Go?

**Answer:** Encapsulating sequential access to a collection without exposing its structure. In Go: `range` over built-ins is the simplest form; `Next/Value` interfaces (`sql.Rows`, `bufio.Scanner`) for explicit iteration; `iter.Seq[T]` (Go 1.23+) for custom iterators.

### Q2. Walk through processing `*sql.Rows` correctly.

**Answer:**

```go
rows, err := db.Query("SELECT id, name FROM users")
if err != nil { return err }
defer rows.Close()

for rows.Next() {
    var id int
    var name string
    if err := rows.Scan(&id, &name); err != nil { return err }
    /* use id, name */
}
return rows.Err()
```

The four crucial parts: error from `Query`, `defer Close()`, `Scan` errors, `rows.Err()` at the end.

### Q3. What's wrong here?

```go
for v := range myChan {
    process(v)
}
```

**Answer:** If `myChan` is never closed by the producer, the loop hangs forever (after consuming all sent values). Always `close(ch)` from the producer when iteration is complete.

### Q4. What's `iter.Seq[T]`?

**Answer:** A type alias `func(yield func(T) bool)`. A function that yields values via the caller's `yield` callback. `range` works on it (Go 1.23+):

```go
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

The `if !yield(i) { return }` lets the caller `break` out cleanly.

### Q5. Why is `rows.Err()` necessary?

**Answer:** `rows.Next()` returns `false` either at end-of-data or on error. The two cases are indistinguishable. `rows.Err()` after the loop tells you which. Without checking, errors are silently swallowed.

### Q6. Should you call `rows.Close()` if the query failed?

**Answer:** No. If `db.Query` returned an error, `rows` is nil (or unusable). Only `defer rows.Close()` *after* checking the query's error:

```go
rows, err := db.Query(...)
if err != nil { return err }
defer rows.Close()
```

### Q7. How does map iteration order work?

**Answer:** Randomised intentionally — Go scrambles the start position to discourage code that depends on order. The randomness is per-call; the same map iterated twice will likely produce different orders.

### Q8. Channel-based iterator — what's the goroutine leak?

**Answer:** When the consumer breaks early, the producer goroutine continues running, blocked on `ch <- v`. The goroutine leaks. Fix: producer accepts `context.Context` and uses `select` to check `ctx.Done()`.

### Q9. iter.Seq vs returning []T — which is better?

**Answer:** Depends:

- **Return []T** if the result is small and always fully consumed. Simpler API.
- **Return iter.Seq[T]** if the result is large, lazy evaluation helps, or you don't know all values up front (paginated APIs).

For 10 items, slice. For 10 million items, iter.Seq.

### Q10. What does `_ = rows.Err()` mean?

**Answer:** It explicitly discards the error from `rows.Err()`. Bad practice for iterator errors — you're silently ignoring iteration failures. Usually a code smell unless you have a documented reason (like "fail-tolerant best-effort scan").

---

## 3. Middle questions

### Q1. Implement Map for iter.Seq.

**Answer:**

```go
func Map[T, U any](seq iter.Seq[T], f func(T) U) iter.Seq[U] {
    return func(yield func(U) bool) {
        for v := range seq {
            if !yield(f(v)) { return }
        }
    }
}
```

Lazy: `f` runs only when the caller requests a value.

### Q2. What's `iter.Pull` and when do you use it?

**Answer:** Converts an `iter.Seq[T]` (push) into a pull API:

```go
next, stop := iter.Pull(seq)
defer stop()
for {
    v, ok := next()
    if !ok { break }
    /* use v */
}
```

Use it when:
- You need two iterators in lockstep.
- You need to look ahead without consuming.
- You're bridging to an API that wants pull semantics.

Always `defer stop()` — without it, the underlying goroutine leaks.

### Q3. Implement a paginated API iterator.

**Answer:**

```go
func ListUsers(ctx context.Context, client *API) iter.Seq2[*User, error] {
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
            if page.NextCursor == "" { return }
            cursor = page.NextCursor
        }
    }
}
```

The caller iterates as if all users were in memory. The HTTP roundtrips happen lazily.

### Q4. How would you implement Filter that also passes through errors?

**Answer:**

```go
func Filter[T any](seq iter.Seq2[T, error], pred func(T) bool) iter.Seq2[T, error] {
    return func(yield func(T, error) bool) {
        for v, err := range seq {
            if err != nil {
                if !yield(v, err) { return }
                continue
            }
            if pred(v) {
                if !yield(v, nil) { return }
            }
        }
    }
}
```

Errors propagate; values are filtered.

### Q5. Channel iterator — design with proper cleanup.

**Answer:**

```go
func Generate(ctx context.Context, n int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < n; i++ {
            select {
            case out <- i:
            case <-ctx.Done(): return
            }
        }
    }()
    return out
}
```

Producer respects `ctx.Done()`. Consumer should `defer cancel()` of the context to signal cleanup.

### Q6. iter.Seq vs channel for a Generator?

**Answer:**

iter.Seq: no goroutine, faster, lazy by default. Good for in-process iteration.

Channel: producer in a goroutine, can be concurrent, but extra overhead.

Default to iter.Seq. Use channels only when the producer needs to run independently.

### Q7. How do you test an iterator?

**Answer:** Three tests:

1. **All-elements:** collect into slice, compare against expected.
2. **Early termination:** break after N; verify only N elements computed (use a counter).
3. **Cleanup:** verify Close was called / resources released.

```go
got := slices.Collect(myIterator())
slices.Equal(got, expected)
```

### Q8. iter.Seq with mutable shared state?

**Answer:** Avoid. Iterator should be pure or own its state. Sharing state with other goroutines means races.

If you need to track stats during iteration, accumulate in the consumer:

```go
count := 0
for v := range seq {
    count++
    use(v)
}
```

### Q9. Composing 5 iterators — what's the cost?

**Answer:** Each layer is a function value (closure). Composing 5 means 5 closures, each capturing the previous. Per element, 5 function calls (plus the user's loop body).

Cost: ~25-50ns per element extra over a hand-rolled loop. Negligible for I/O-bound code, noticeable for tight CPU loops.

For very hot paths, materialise once and iterate the slice directly.

### Q10. When would you switch from iter.Seq to channels?

**Answer:**

- When the producer benefits from running in a separate goroutine (overlapping with consumer).
- When the producer is I/O-bound and concurrency matters.
- When you need fan-out (multiple consumers).

For in-process, single-consumer iteration, iter.Seq wins on performance and simplicity.

---

## 4. Senior questions

### Q1. Design an iterator for a 100M-row database table.

**Answer:** Use cursor-based pagination plus iter.Seq2:

```go
func AllUsers(ctx context.Context, db *sql.DB) iter.Seq2[*User, error] {
    return func(yield func(*User, error) bool) {
        lastID := ""
        for {
            users, err := fetchPage(ctx, db, lastID, 1000)
            if err != nil {
                yield(nil, err)
                return
            }
            if len(users) == 0 { return }
            for _, u := range users {
                if !yield(u, nil) { return }
                lastID = u.ID
            }
        }
    }
}
```

Key: cursor (lastID) is stable; OFFSET-based pagination breaks on insertions.

### Q2. iter.Seq adoption: convert an existing Next/Value type.

**Answer:** Add a method:

```go
type Rows struct { /* existing */ }
func (r *Rows) Next() bool { /* ... */ }
func (r *Rows) Scan(dest ...any) error { /* ... */ }

// New method for iter.Seq adoption
func (r *Rows) All() iter.Seq2[*Row, error] {
    return func(yield func(*Row, error) bool) {
        for r.Next() {
            var row Row
            if err := r.Scan(&row.ID, &row.Name); err != nil {
                yield(nil, err)
                return
            }
            if !yield(&row, nil) { return }
        }
        if err := r.Err(); err != nil {
            yield(nil, err)
        }
    }
}
```

Old callers use `Next/Value`; new callers use `range rows.All()`.

### Q3. Postmortem: an iterator consumed 8 GB before crashing.

**Answer:** Likely a materialising operation in the middle:

```go
for u := range allUsers() {
    cache[u.ID] = u  // accumulates in memory
}
```

If the iterator is over 80M users, the map grows to 80M entries.

Fix: stream — process and discard:

```go
for u := range allUsers() {
    if u.Active { processNow(u) }
    // don't accumulate
}
```

Or: bounded LRU cache.

### Q4. Concurrent iteration — when is it safe?

**Answer:** Iterating an iterator concurrently from multiple goroutines is *almost never safe*. The iterator's state isn't typically protected. Each consumer needs its own iterator.

Exception: `sync.Map.Range` is safe for concurrent use because the map handles it internally.

### Q5. iter.Pull's hidden goroutine.

**Answer:** Pre-Go-1.23-final, `iter.Pull` ran the push-style iterator in a goroutine, communicating via channels. Cost: goroutine creation + channel sends per element.

Go 1.23+'s implementation uses *coroutines* (`runtime.coro` / `runtime.coroswitch`) — same goroutine, no channel. Faster.

Either way, `defer stop()` releases the resources. Failing to call `stop` leaks (the coroutine remains suspended).

### Q6. Should iter.Seq2 always use error as the second value?

**Answer:** No. iter.Seq2 is for any (K, V) pair:

- `maps.All(m)` returns `iter.Seq2[K, V]` — key-value.
- `slices.All(s)` returns `iter.Seq2[int, T]` — index-value.
- A paginated API returns `iter.Seq2[*Item, error]` — error semantics.

Pick the second type by what makes sense for the data.

### Q7. Designing a `Watch()` iterator (long-lived).

**Answer:** A long-lived iterator that emits as events arrive:

```go
func Watch(ctx context.Context, resource string) iter.Seq2[Event, error] {
    return func(yield func(Event, error) bool) {
        stream := openStream(resource)
        defer stream.Close()
        for {
            select {
            case ev := <-stream.Events:
                if !yield(ev, nil) { return }
            case err := <-stream.Errors:
                if !yield(Event{}, err) { return }
            case <-ctx.Done():
                yield(Event{}, ctx.Err())
                return
            }
        }
    }
}
```

`ctx` controls lifetime. Caller cancels ctx to stop the watcher.

### Q8. Why might you prefer Next/Value over iter.Seq for a library?

**Answer:** Backwards compatibility. If your library has been Go 1.18-compatible, switching to iter.Seq forces all callers to bump to Go 1.23.

Middle ground: keep Next/Value for compatibility; *add* iter.Seq method (`.All()`) for new code.

### Q9. Cross-language: how does Java's Iterable + Iterator + Stream compare to Go's iter.Seq?

**Answer:** Java:
- `Iterable.iterator()` returns an `Iterator` with `hasNext()`, `next()`.
- `Stream` adds composition (map, filter, collect) — but is lazy and one-shot.

Go:
- `range` on slices/maps/channels.
- `iter.Seq` for custom iteration.
- Composition is via free functions (no method chaining like Streams).

Java is OO (methods on streams); Go is functional (passing seqs to functions). Both are lazy.

### Q10. iter.Seq vs Reactive Streams (RxJava, Project Reactor).

**Answer:**

iter.Seq is *pull-style with push semantics*: the iterator pushes when the consumer calls. Reactive streams are *push with backpressure*: the producer pushes; consumer signals demand.

iter.Seq is simpler — no backpressure, no async. Sufficient for in-process iteration. Reactive streams shine for I/O-bound, async pipelines (HTTP responses, message queues).

For Go: iter.Seq for sync; channels for async; full reactive systems are rare.

---

## 5. Live coding challenges

### Challenge 1: Implement Chain

Concatenate two iterators:

```go
func Chain[T any](a, b iter.Seq[T]) iter.Seq[T]
```

### Challenge 2: Implement Zip

Yield pairs from two iterators in lockstep:

```go
func Zip[A, B any](a iter.Seq[A], b iter.Seq[B]) iter.Seq2[A, B]
```

Requires `iter.Pull` for both inputs.

### Challenge 3: Streaming CSV parser

Yield rows one at a time without loading the entire file.

### Challenge 4: Paginated HTTP iterator

Encapsulate cursor logic.

### Challenge 5: Worker-based map (concurrent)

`Map` that runs `f` in parallel across N workers, preserving order.

---

## 6. System design starters

- **Cursor-based pagination** — large result sets, stable ordering.
- **Log tailing** — long-lived iterator over a growing file.
- **Streaming JSON parser** — process events without materialising.
- **Watch API** — emit changes as they happen.

---

## 7. Traps

- Forgetting `Close()` on `sql.Rows` — connection leak.
- Forgetting `Err()` after iteration — silent failures.
- Channel iterator goroutine leak — producer blocked on send forever.
- iter.Pull without `defer stop()` — coroutine leak.
- Materialising large iterators — memory blowup.
- iter.Seq without `!yield(v) { return }` — break doesn't stop iteration.

---

## 8. Questions to ASK

- "Has your codebase adopted iter.Seq?"
- "How do you handle pagination — eager slice or cursor-based?"
- "What's the largest sequence you've iterated?"

---

## 9. Cross-references

- **`../03-strategy-pattern/`** — Iterators *are* strategies in many APIs (custom Less, Scan).
- **`../04-decorator-pattern/`** — Map/Filter/Take wrap iterators (decorate).
- **`../06-factory-pattern/`** — `slices.Values`, `maps.Keys` — factories returning iterators.
- **`../16-pubsub-pattern/`** — Long-lived iterators are pubsub subscribers.

Iterator in Go is in transition between `Next/Value` and `iter.Seq`. Senior-level knowledge: when to adopt the new style, how to maintain backwards compatibility, and when iterators are even the right pattern (vs returning a slice).
