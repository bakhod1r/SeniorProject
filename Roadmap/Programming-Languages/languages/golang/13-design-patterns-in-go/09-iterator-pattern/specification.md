# Iterator Pattern — Specification

## 1. Origins

The Iterator pattern was formalized in *Design Patterns: Elements of Reusable Object-Oriented Software* (Gamma, Helm, Johnson, Vlissides, 1994):

> "Provide a way to access the elements of an aggregate object sequentially without exposing its underlying representation."

The pattern existed long before GoF:

- **CLU (1974)** — Liskov's *iterators* as language constructs (`for x in producer()`).
- **Smalltalk (1980)** — `Collection.do:[:item | ...]` block-passing.
- **C++ STL (1994)** — iterator categories (input, forward, bidirectional, random-access).
- **Java 1.2 (1998)** — `Iterator` interface; later `Iterable` and enhanced `for`.
- **Python 2.2 (2001)** — generators via `yield`.
- **C# 2.0 (2005)** — `IEnumerator` and `yield return`.
- **Rust (2010+)** — `Iterator` trait, lazy by default.

Go's history with iterators:

- **Go 1.0 (2012)** — `range` keyword on slices, maps, strings, channels.
- **Go 1.0** — `sql.Rows`, `bufio.Scanner` established the `Next/Value/Err/Close` interface convention.
- **Go 1.18 (2022)** — generics enabled `Iterable[T]`-style libraries but no language-level iterator.
- **Go 1.22 (2024)** — `range` over integer (`for i := range 10`); fix for loop-variable capture.
- **Go 1.23 (2024)** — *range over function* via `iter.Seq[T]`, `iter.Seq2[K, V]`, `iter.Pull`, `iter.Pull2`. The most significant language addition since generics.

---

## 2. Go language mechanics

### 2.1 `range` (Go 1.0)

From the [Go spec](https://go.dev/ref/spec#For_range):

> "The range expression x is evaluated once before beginning the loop, with one exception: if at most one iteration variable is present and len(x) is constant, the range expression is not evaluated."

`range` works on:
- Array, slice, pointer-to-array.
- String (yields runes + byte index).
- Map (random order).
- Channel (until closed).
- Integer (Go 1.22+).
- Function (Go 1.23+).

### 2.2 `for-range` over function (Go 1.23+)

> "If the range expression has type `func(yield func() bool)`, `range` produces an iteration variable per call to yield; the loop ends when yield returns false."

Three variants:

- `func(yield func() bool)` — zero values per yield (for side-effect iteration).
- `func(yield func(V) bool)` — one value.
- `func(yield func(K, V) bool)` — two values.

The `iter` package wraps the second and third forms:

```go
// src/iter/iter.go (Go 1.23+)
type Seq[V any] func(yield func(V) bool)
type Seq2[K, V any] func(yield func(K, V) bool)
```

### 2.3 `iter.Pull` and `iter.Pull2`

Convert push iterators to pull:

```go
func Pull[V any](seq Seq[V]) (next func() (V, bool), stop func())
```

Implementation uses Go runtime's coroutine support (`runtime.coroswitch`) for efficient suspension.

---

## 3. Canonical Go shapes

### 3.1 Built-in `range`

```go
for v := range slice { ... }
for k, v := range myMap { ... }
for r := range str { ... }
for v := range ch { ... }
```

### 3.2 Next/Value interface (pre-1.23)

```go
type Iter interface {
    Next() bool
    Value() T
    Err() error
    Close() error  // when resource-holding
}
```

Used by `sql.Rows`, `bufio.Scanner`.

### 3.3 iter.Seq[T] (Go 1.23+)

```go
type Seq[V any] func(yield func(V) bool)

func MyIter() iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < 10; i++ {
            if !yield(i) { return }
        }
    }
}
```

### 3.4 Channel-based generator

```go
func Generate(ctx context.Context) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for { /* produce */ select { case out <- v: case <-ctx.Done(): return } }
    }()
    return out
}
```

### 3.5 Visitor callback

```go
func WalkDir(root string, fn func(path string, d fs.DirEntry, err error) error) error
```

Caller passes a function; the iterator invokes it per element. Pre-iter.Seq alternative.

---

## 4. Standard library use

### 4.1 Built-in range

Always available; the most common shape.

### 4.2 Next/Value style

- `sql.Rows` — `Next`, `Scan`, `Err`, `Close`.
- `bufio.Scanner` — `Scan`, `Text`/`Bytes`, `Err`.
- `csv.Reader.Read()` — returns one record per call.
- `json.Decoder.More()/Decode()` — streaming decode.
- `gob.Decoder.Decode()` — same as JSON.

### 4.3 Visitor (callback) style

- `ast.Inspect(node, visitor)` — AST traversal.
- `filepath.Walk`, `filepath.WalkDir` — file system traversal.
- `template.Funcs(map[string]any{"name": fn})` — registers function callbacks.

### 4.4 iter.Seq style (Go 1.23+)

- `slices.Values(s)` — yields slice elements.
- `slices.All(s)` — yields index + element.
- `slices.Backward(s)` — reverse iteration.
- `slices.Chunk(s, n)` — fixed-size chunks.
- `maps.Keys(m)`, `maps.Values(m)`, `maps.All(m)` — map iteration.
- `regexp.FindAllStringIndex` — slice (eager); `*Regexp` has no Seq-returning method as of Go 1.23.
- `bytes.Lines`, `bytes.SplitSeq` — Go 1.24+ stream variants.

### 4.5 Function/channel hybrids

- `context.Context.Done()` returns `<-chan struct{}` — iteration of "is it done yet".

---

## 5. Real library use

### 5.1 Kubernetes client-go

```go
list, _ := clientset.CoreV1().Pods("default").List(ctx, opts)
// list.Items is a []Pod — eager

// Watch returns an iterator:
watcher, _ := clientset.CoreV1().Pods("default").Watch(ctx, opts)
for event := range watcher.ResultChan() {
    /* ... */
}
```

`Watch.ResultChan()` returns `<-chan watch.Event` — channel-based iterator.

### 5.2 Kafka clients (segmentio/kafka-go)

```go
r := kafka.NewReader(kafka.ReaderConfig{Brokers: ..., Topic: ..., GroupID: ...})
for {
    m, err := r.ReadMessage(ctx)
    if err != nil { break }
    /* ... */
}
```

`ReadMessage` is pull-style. The library doesn't expose iter.Seq (legacy API).

### 5.3 Bigquery (cloud.google.com/go/bigquery)

```go
it := query.Read(ctx)
for {
    var row []bigquery.Value
    err := it.Next(&row)
    if err == iterator.Done { break }
    /* ... */
}
```

`Next` with sentinel `iterator.Done`. Pre-iter.Seq pattern.

### 5.4 AWS SDK Paginator

```go
paginator := s3.NewListObjectsV2Paginator(client, params)
for paginator.HasMorePages() {
    page, err := paginator.NextPage(ctx)
    /* ... */
}
```

`HasMorePages` + `NextPage` is a paginated iterator.

---

## 6. Formal specification

A Go iterator implementation consists of:

| Element | Description |
|---------|-------------|
| **Source** | The collection or stream being iterated. |
| **State** | Position within the source (cursor, index, current value). |
| **Advance** | Operation moving to the next element (`Next()`, internal in `iter.Seq`). |
| **Read** | Operation accessing current element (`Value()`, the yield argument). |
| **Termination** | Signal that iteration is complete (false from Next, exit from Seq). |
| **Error** | Mechanism for surfacing errors (`Err()`, second yield value). |
| **Cleanup** | Resource release (`Close()`, deferred in Seq, `stop()` in Pull). |

**Invariants:**

1. Each element is visited at most once (per iteration).
2. After termination, no further values are produced.
3. Resources are released by the caller (`Close()`, `stop()`) or by the iterator on natural completion.
4. Errors don't cause silent termination — they're reported via Err() or yielded.

---

## 7. Anti-patterns

### 7.1 Missing Close

Resource leak. `defer rows.Close()` immediately after the constructor.

### 7.2 Missing Err() check

Iteration silently terminates on error. `if err := rows.Err(); err != nil` after the loop.

### 7.3 Materializing infinite sequences

```go
fibs := slices.Collect(Fibonacci())  // infinite loop or OOM
```

`Fibonacci` is a generator; don't materialize.

### 7.4 Channel iterator without cancellation

Goroutine leak when consumer breaks early. Accept `context.Context`.

### 7.5 iter.Pull without stop

```go
next, _ := iter.Pull(seq)  // stop ignored
```

Coroutine leak. Always `defer stop()`.

### 7.6 iter.Seq ignoring yield's return

```go
func Bad() iter.Seq[int] {
    return func(yield func(int) bool) {
        for i := 0; i < 1000; i++ {
            yield(i)  // ignores false return
        }
    }
}
```

`break` doesn't stop iteration. Always `if !yield(v) { return }`.

### 7.7 Iterator with side effects

```go
func List() iter.Seq[int] {
    return func(yield func(int) bool) {
        sendMetric()  // side effect on every call
        for _, v := range items { yield(v) }
    }
}
```

Surprising. Side effects belong in the consumer.

---

## 8. Variants and dialects

| Variant | Use case |
|---------|----------|
| Built-in range | Slices, maps, strings, channels |
| Next/Value | DB rows, scanners (pre-1.23) |
| iter.Seq[T] | Custom iterators (Go 1.23+) |
| iter.Seq2[K,V] | Key-value or value+error |
| Visitor callback | Tree/graph traversal |
| Channel-based | Concurrent producer |
| Cursor pagination | Large remote data sets |

---

## 9. Naming conventions

- **`All()`** — full iteration. `slices.All`, `maps.All`.
- **`Values()`** — value-only. `slices.Values`, `maps.Values`.
- **`Keys()`** — key-only. `maps.Keys`.
- **`Range(start, stop)`** — bounded range.
- **`Chunk(s, n)`** — fixed-size groups.
- **`Backward()`** — reverse.
- **`Next/Value/Err/Close`** — legacy interface.

---

## 10. Related patterns

- **Composite** — iterators traverse tree structures.
- **Visitor** — callback-based iteration.
- **Strategy** — comparator passed to sort; not iteration but related.
- **Pipeline** — sequence of iterators chained (Map/Filter/Take).
- **Generator** — Iterator with lazy production (Strategy variation).

---

## 11. Further reading

- **Go 1.23 release notes** — iter.Seq adoption guidance.
- **`src/iter/iter.go`** — the iter package source.
- **`src/cmd/compile/internal/rangefunc/rewrite.go`** — compiler lowering of range-over-func.
- **Russ Cox, blog posts on iterators** — design rationale.
- **`src/slices/iter.go`**, **`src/maps/iter.go`** — adoption examples.
- **Python generators (PEP 255)** — historical reference.
- **C# yield return** — alternative push iterator design.
- **GoF (1994)** — original Iterator pattern.

Iterator in Go is in transition. The new iter.Seq style is cleaner; legacy Next/Value persists for compatibility. Senior-level knowledge means using the new style for new code while respecting the old style in inherited codebases.

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **Push iterator** | Iterator drives; calls yield for each value. |
| **Pull iterator** | Caller drives; calls Next() to fetch each. |
| **Lazy** | Computation deferred until value requested. |
| **Eager** | All computed upfront. |
| **Cursor** | Position within a remote sequence. |
| **Coroutine** | Cooperatively-scheduled execution unit; Go 1.23+ runtime feature underlying iter.Pull. |
| **Yield** | Per-value callback in push iterators. |
| **Materialise** | Collect an iterator into a slice or map. |
