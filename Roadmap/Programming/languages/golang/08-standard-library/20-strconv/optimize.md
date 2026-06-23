# 8.20 `strconv` — Optimize

> Ten optimizations grounded in benchmarks. Each is a before/after
> pair with measurable improvement. Run `go test -bench=. -benchmem
> -benchtime=1s` to verify.

## O1 — Replace `fmt.Sprintf("%d", x)` with `strconv.Itoa`

### Before

```go
func format(x int) string {
    return fmt.Sprintf("%d", x)
}
```

```
BenchmarkFmtSprintf  10000000  180 ns/op  16 B/op  2 allocs/op
```

### After

```go
func format(x int) string {
    return strconv.Itoa(x)
}
```

```
BenchmarkItoa  50000000  30 ns/op  8 B/op  1 allocs/op
```

6× faster, half the allocations.

## O2 — Replace `Itoa` with `AppendInt` into a pooled buffer

### Before

```go
func encode(values []int) string {
    var b strings.Builder
    for _, v := range values {
        b.WriteString(strconv.Itoa(v))
        b.WriteByte(',')
    }
    return b.String()
}
```

Each `Itoa` allocates a fresh string. For 100 values, 100 transient
allocations.

### After

```go
func encode(values []int) string {
    var b strings.Builder
    b.Grow(len(values) * 6)
    var buf [16]byte
    for _, v := range values {
        b.Write(strconv.AppendInt(buf[:0], int64(v), 10))
        b.WriteByte(',')
    }
    return b.String()
}
```

`buf` is stack-allocated (escape analysis keeps it there). One
allocation per `encode` call (the final string).

## O3 — Pre-validate before parsing

### Before

```go
func parsePort(s string) (int, error) {
    return strconv.Atoi(s)
}
```

When called with malformed input frequently (e.g., from probe
clients), each failure allocates a `*NumError` (~50 bytes).

### After

```go
func parsePort(s string) (int, error) {
    if len(s) == 0 || len(s) > 5 {
        return 0, errInvalidPort
    }
    for _, c := range []byte(s) {
        if c < '0' || c > '9' {
            return 0, errInvalidPort
        }
    }
    return strconv.Atoi(s)
}
```

The fast-rejection path avoids the `NumError` allocation entirely.
For hostile traffic mostly producing failures, this halves CPU and
removes GC pressure.

## O4 — Use `Atoi` instead of `ParseInt(s, 10, 0)`

### Before

```go
v, err := strconv.ParseInt(s, 10, 0)
i := int(v)
```

### After

```go
i, err := strconv.Atoi(s)
```

`Atoi` has an inline fast path for short decimals; `ParseInt`
always goes through the general path. ~2× faster for short inputs.

## O5 — Choose the right `bitSize`

### Before

```go
v, err := strconv.ParseInt(s, 10, 64)
if err != nil { return err }
if v > math.MaxInt32 || v < math.MinInt32 {
    return errOverflow
}
return int32(v), nil
```

Two range checks: one inside `ParseInt`, one outside.

### After

```go
v, err := strconv.ParseInt(s, 10, 32)
if err != nil { return err } // includes overflow
return int32(v), nil
```

`ParseInt` does the range check itself when given `bitSize=32`.
One fewer comparison; clearer intent.

## O6 — Avoid `string(b)` round-trip for parsing

### Before

```go
func parseField(b []byte) (int, error) {
    s := string(b)         // allocates
    return strconv.Atoi(s)
}
```

### After

For Go 1.20+:

```go
func parseField(b []byte) (int, error) {
    return strconv.Atoi(unsafe.String(unsafe.SliceData(b), len(b)))
}
```

Or, more portably, take advantage of the compiler optimization
that elides `string(b)` when used as a function argument:

```go
func parseField(b []byte) (int, error) {
    return strconv.Atoi(string(b))  // Go compiler may elide
}
```

Confirm with `-gcflags="-m"`: you want to see "does not escape"
for the `string(b)` expression.

## O7 — Replace `FormatFloat(_, 'f', -1, 64)` with `'g'` when possible

### Before

```go
s := strconv.FormatFloat(f, 'f', -1, 64)
```

`'f'` with `prec=-1` produces non-scientific output, but for very
small or very large values, it can produce extremely long strings:

```go
strconv.FormatFloat(1e-20, 'f', -1, 64)
// "0.00000000000000000001"
```

### After

```go
s := strconv.FormatFloat(f, 'g', -1, 64)
// "1e-20"
```

`'g'` switches to scientific notation when it's shorter. Smaller
output, fewer bytes to allocate, faster downstream parsing.

Pick `'f'` only when the consumer can't parse scientific notation.

## O8 — Batch parse with worker pool

For parsing 10M strings to ints:

### Before

```go
results := make([]int, len(inputs))
for i, s := range inputs {
    v, _ := strconv.Atoi(s)
    results[i] = v
}
```

Single-threaded, ~50M ops/sec on a single core.

### After

```go
results := make([]int, len(inputs))
var wg sync.WaitGroup
chunk := (len(inputs) + runtime.NumCPU() - 1) / runtime.NumCPU()
for w := 0; w < runtime.NumCPU(); w++ {
    start := w * chunk
    end := start + chunk
    if end > len(inputs) { end = len(inputs) }
    wg.Add(1)
    go func(start, end int) {
        defer wg.Done()
        for i := start; i < end; i++ {
            results[i], _ = strconv.Atoi(inputs[i])
        }
    }(start, end)
}
wg.Wait()
```

Parallelizes across cores. For a CPU-bound workload, scales nearly
linearly to `NumCPU`.

Caveat: writing to `results[i]` from multiple goroutines is safe
only because each writes a unique index. Sharing a single slice
header is fine; sharing a single index would race.

## O9 — Reuse `[]byte` for `AppendInt` output

### Before

```go
for _, v := range values {
    b := strconv.AppendInt(nil, int64(v), 10)
    process(b)
}
```

Each call allocates a fresh slice.

### After

```go
buf := make([]byte, 0, 32)
for _, v := range values {
    buf = strconv.AppendInt(buf[:0], int64(v), 10)
    process(buf)
}
```

One allocation total (the initial `make`). The `buf[:0]` reslice
keeps the capacity; `AppendInt` writes into it.

**Caveat:** if `process` retains the slice past the next iteration,
it must copy. The contract here is "valid for this iteration only".

## O10 — Profile-driven `Sprintf` audit

This isn't an optimization recipe — it's the workflow.

```bash
go test -bench=. -benchmem -cpuprofile=cpu.out
go tool pprof -top cpu.out
```

If the top frames include:

- `fmt.(*pp).doPrintf` → look for `Sprintf` in the calling code.
- `runtime.convT64` or `convT32` → look for `interface{}` boxing
  (often from `fmt.Sprint*`).
- `runtime.mallocgc` from `strconv.FormatInt` → switch to
  `AppendInt`.
- `runtime.mallocgc` from `strconv.NumError` → fast-reject before
  parsing.

Apply the fix. Re-profile. Repeat until the top frames are your
business logic, not number conversions.

## Bonus — When `fmt` is actually fine

The above optimizations matter when:

- Sustained throughput > 100k calls/sec on the path.
- A profile pinpoints `fmt`/`strconv` as the top frames.
- The code is reviewed and tested (no regression risk).

If your code converts numbers only on startup, in error messages,
or once per HTTP request at < 1k req/s, the difference between
`fmt.Sprintf` and `strconv.Itoa` is unmeasurable. Pick the
clearest version.

Production rules:

| Path | Tool |
|------|------|
| Hot serialization (> 10k/sec) | `Append*` into pooled buffer |
| Warm code (1k–10k/sec) | `Itoa`/`FormatFloat` |
| Cold code (< 100/sec) | `fmt.Sprintf` for readability |

## Checklist

After optimizing a number-heavy path:

- [ ] No `fmt.Sprintf` for single-value conversions.
- [ ] `Append*` used in inner loops, results written to pooled
  buffers or stack arrays.
- [ ] `bitSize` parameter matches destination type.
- [ ] Errors checked, not silently discarded.
- [ ] No unnecessary `string(b)` / `[]byte(s)` conversions.
- [ ] Benchmark shows the expected improvement.
- [ ] Race detector (`go test -race`) passes if concurrency was
  added.
- [ ] The change is documented (commit message or comment)
  explaining the why.
