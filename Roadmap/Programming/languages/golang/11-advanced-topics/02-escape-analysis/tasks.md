# Escape Analysis — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.22+.

---

## Task 1: First escape

Write two tiny functions:

```go
func valueReturn() int { x := 42; return x }
func pointerReturn() *int { x := 42; return &x }
```

**Acceptance criteria**
- [ ] `go build -gcflags="-m"` reports nothing for `valueReturn` and "moved to heap: x" for `pointerReturn`.
- [ ] You explain in your own words why.

---

## Task 2: Boxing into `any`

```go
func dump(v any) { fmt.Println(v) }

func main() {
    n := 42
    dump(n)
}
```

**Acceptance criteria**
- [ ] `-gcflags="-m"` reports that `n` escapes.
- [ ] You rewrite using a typed function `dumpInt(int)` and confirm no escape.
- [ ] You then rewrite using a generic `func Dump[T any](v T)` and observe the behavior — does it escape? Document what you see.

---

## Task 3: Closure capture

Write three closure tests:

1. Closure created and called locally; reads a local variable.
2. Closure assigned to a package-level variable.
3. Closure returned from the function.

**Acceptance criteria**
- [ ] Identify which of the three causes the captured variable to escape.
- [ ] Confirm with `-gcflags="-m=2"`.
- [ ] Write one sentence per case explaining the analyzer's reasoning.

---

## Task 4: Sub-slice retention

Read a 50 MiB file with `os.ReadFile`, then return `data[:100]`.

**Acceptance criteria**
- [ ] A benchmark calling this function in a loop shows growing `runtime.MemStats.HeapAlloc`.
- [ ] Replacing the return with `slices.Clone(data[:100])` keeps memory flat.
- [ ] You write a comment in the original code documenting the leak.

---

## Task 5: `interface{}` cost

Benchmark:

```go
func sumAny(xs []any) int64 {
    var s int64
    for _, x := range xs { s += x.(int64) }
    return s
}

func sumTyped(xs []int64) int64 {
    var s int64
    for _, x := range xs { s += x }
    return s
}
```

**Acceptance criteria**
- [ ] Both benches produce identical results.
- [ ] `sumAny`'s allocator footprint depends on how you populate `xs` — describe what allocations occur when you put `int64` values into a `[]any`.
- [ ] Rewrite as generics and confirm zero allocations across both call sites.

---

## Task 6: Reflection cost

```go
func describe(v any) string {
    return fmt.Sprintf("%T: %v", v, v)
}
```

**Acceptance criteria**
- [ ] Bench shows allocations.
- [ ] Read `-gcflags="-m"` and identify the escapes.
- [ ] Replace with a typed version for `string` and `int` (separate functions), bench, and document the alloc reduction.

---

## Task 7: Builder vs concat

```go
func concatString(parts []string) string {
    var s string
    for _, p := range parts { s += p }
    return s
}

func builderString(parts []string) string {
    var b strings.Builder
    for _, p := range parts { b.WriteString(p) }
    return b.String()
}
```

**Acceptance criteria**
- [ ] Bench both with 100 parts; report `allocs/op` and `ns/op`.
- [ ] Add `b.Grow(estimatedSize)` and confirm further improvement.
- [ ] Explain in two sentences why `+=` is quadratic in allocations.

---

## Task 8: `sync.Pool` ergonomics

Build an HTTP handler that JSON-decodes a request body and renders a response.

**Acceptance criteria**
- [ ] Baseline: no pool, measure with `pprof -alloc_objects` under steady load.
- [ ] Add a `sync.Pool` for the decoder's scratch buffer; re-measure.
- [ ] Add a cap-based discard to the `Put` and confirm pool memory stays bounded.
- [ ] Document what the alloc count was at each step.

---

## Task 9: Find an escape in your own code

Pick a small package you've written (or any open-source package).

**Acceptance criteria**
- [ ] Run `go build -gcflags="-m" ./pkg 2>&1 | wc -l` — get a count of escape decisions.
- [ ] Identify one site where the escape surprised you.
- [ ] Either fix it (and bench) or write a one-paragraph explanation of why the escape is correct.

---

## Task 10: Generic monomorphization

```go
func MaxAny[T constraints.Ordered](a, b T) T {
    if a > b { return a }
    return b
}
```

**Acceptance criteria**
- [ ] Call it with `int`, `int64`, and `float64` in three different places.
- [ ] Inspect the binary with `go tool objdump -S` or `go build -gcflags=-m` and verify that distinct instantiations were created (for value-shaped types they share bodies; you may need to check the symbol table).
- [ ] Bench against a hand-written `MaxInt(int, int) int` and report the difference.

---

## Task 11: Map allocation patterns

```go
func loadMapNoHint(items []KV) map[string]int {
    m := make(map[string]int)
    for _, kv := range items { m[kv.K] = kv.V }
    return m
}

func loadMapHinted(items []KV) map[string]int {
    m := make(map[string]int, len(items))
    for _, kv := range items { m[kv.K] = kv.V }
    return m
}
```

**Acceptance criteria**
- [ ] Bench both with 1M items.
- [ ] Confirm the hinted version has fewer rehash-related allocations and is meaningfully faster.
- [ ] Write the result down so you remember to set the hint next time.

---

## Task 12: Carry-the-slice API

Convert this:

```go
func Split(s string) []string { return strings.Split(s, ",") }
```

to:

```go
func AppendSplit(dst []string, s string) []string {
    // ...
}
```

**Acceptance criteria**
- [ ] Callers can reuse a single backing slice across calls.
- [ ] Bench with 100K iterations and confirm the carried-slice version has ~0 allocs/op in the hot loop.
- [ ] Document in the function comment the contract ("appends to dst, returns the extended slice").

---

## Stretch — Task 13: Zero-alloc binary parser

Pick a small binary format (e.g., a fixed 24-byte header). Implement a `Parse` function that fills a struct from a `[]byte`.

**Acceptance criteria**
- [ ] `BenchmarkParse` reports `0 allocs/op`.
- [ ] The function does not use `unsafe` (or if it does, justify why and document the invariants).
- [ ] You write a fuzz test (`go test -fuzz=FuzzParse`) and run it for a minute.

---

## Submission

For each task, capture:

1. The code (or a link).
2. The before/after bench output.
3. Two lines of analysis.

These artifacts demonstrate not just "I read about escape analysis" but "I can find and fix escape problems".
