# Memory Management in Depth — Optimize

## 1. Measure first, optimize second

The most common mistake in memory optimization is starting with a guess. Before you change a single line:

1. Capture a baseline benchmark with `-benchmem`.
2. Capture an allocation profile (`-memprofile mem.out` + `pprof -alloc_objects`).
3. Capture a `gctrace` for at least one minute of representative load.
4. Identify the *one* allocation site responsible for the majority of bytes or count.

If you can't point at a specific call site and say "this is 40% of allocations", you don't have a target — you have a hunch. Don't optimize on a hunch.

```bash
go test -bench=. -benchmem -memprofile=mem.out -count=10 ./...
go tool pprof -alloc_objects mem.out
(pprof) top
(pprof) list YourHotFunc
```

---

## 2. Struct field ordering

Go follows the same alignment rules as C. A `struct` is laid out in declaration order, with padding to satisfy each field's alignment, plus tail padding to satisfy the struct's own alignment.

```go
type bad struct {
    a bool    // 1 + 7 padding
    b int64   // 8
    c bool    // 1 + 7 padding
}             // total: 24 bytes

type good struct {
    b int64   // 8
    a bool    // 1
    c bool    // 1 + 6 padding
}             // total: 16 bytes
```

For one struct nobody cares; for millions of records the savings are real.

Detection:

```bash
go install honnef.co/go/tools/cmd/structlayout@latest
go install honnef.co/go/tools/cmd/structlayout-pretty@latest
structlayout ./... MyType | structlayout-pretty
```

Or, for whole-package guidance:

```bash
go install honnef.co/go/tools/cmd/fieldalignment@latest
fieldalignment ./...
```

Order by alignment descending (`int64`, `*T`, `int32`, `int16`, `bool`) — that's a safe default that rarely beats hand layout but never loses.

---

## 3. Slices: capacity is half the API

```go
// Grows 6 times reaching cap 8192
s := make([]int, 0)
for i := 0; i < 5000; i++ {
    s = append(s, i)
}

// One allocation, zero copies
s := make([]int, 0, 5000)
for i := 0; i < 5000; i++ {
    s = append(s, i)
}
```

The first form allocates ~14× the final size in total over its growth sequence (1, 2, 4, 8, …, 8192) and copies repeatedly. Wherever you can predict the final length, pre-size.

For maps:

```go
m := make(map[string]int, 5000)  // hint, not a hard cap
```

The hint avoids rehashing as the map grows.

---

## 4. Avoid `interface{}` boxing in hot loops

```go
// Allocates per call — values box into iface{}
func sum(xs []any) (s int64) {
    for _, x := range xs {
        s += x.(int64)
    }
    return
}

// Zero allocation
func sum(xs []int64) (s int64) {
    for _, x := range xs {
        s += x
    }
    return
}
```

The first version pays a heap allocation when each `int64` is stored into the slice, regardless of how you read it back out. Generics (Go 1.18+) make typed code reusable without paying the boxing cost:

```go
func sum[T constraints.Integer](xs []T) T {
    var s T
    for _, x := range xs {
        s += x
    }
    return s
}
```

---

## 5. `strings.Builder` over `+=`

```go
// Quadratic allocations: each += allocates a new string
var s string
for _, p := range parts {
    s += p
}

// Linear: one backing array, grows geometrically
var b strings.Builder
b.Grow(estimatedSize)
for _, p := range parts {
    b.WriteString(p)
}
s := b.String()
```

`Grow` matters: without it, the builder still allocates several times. With it, often once.

Same pattern with `bytes.Buffer` for `[]byte`.

---

## 6. `sync.Pool` — when, where, how

Good candidates:

- Many short-lived allocations of similar size, in concurrent paths (HTTP handlers, codec scratch).
- The pooled type has no exclusive ownership (you can hand the value back trivially).

Bad candidates:

- Long-lived objects (just allocate once at startup).
- Variable-size objects without a cap discipline (grows unboundedly).
- Anything you couldn't safely call `Reset()` on.

Template:

```go
var pool = sync.Pool{
    New: func() any { return &Decoder{buf: make([]byte, 0, 4096)} },
}

func decode(r io.Reader) (*Result, error) {
    d := pool.Get().(*Decoder)
    defer func() {
        if cap(d.buf) <= 64<<10 {
            d.Reset()
            pool.Put(d)
        }
    }()
    return d.Decode(r)
}
```

Bench before vs. after. If the win is < 10%, the complexity probably isn't worth it.

---

## 7. Escape analysis as an optimization tool

```bash
go build -gcflags="-m=2" ./... 2>&1 | grep "escapes to heap"
```

`=2` adds detail: it explains *why* each variable escaped. The most actionable patterns:

| Compiler message | Fix |
|------------------|-----|
| `&x escapes to heap` (in `return &x`) | Return value instead of pointer |
| `make([]T, n)` escapes (`n` is non-constant) | Bound `n` if you can; or pass a pre-allocated slice in |
| `x escapes to heap: x converted to itype{}` | Avoid the interface conversion in the hot path |
| Closure captures `*x` | Pass by value into the closure or make it a method |

You don't need to chase every escape — many are harmless. Focus on those in functions that appear in your allocation profile.

---

## 8. Avoid allocations from common idioms

| Idiom | Allocates? | Fix |
|-------|-----------|-----|
| `fmt.Sprintf("%d", n)` | Yes | `strconv.Itoa(n)` |
| `[]byte(s)` | Yes (always copies) | `unsafe.StringData(s)` (Go 1.20+) for read-only access |
| `string(b)` | Yes (always copies) | Same, in reverse: `unsafe.String(&b[0], len(b))` |
| `time.Now().Sub(t)` | No, but `t.Sub(t2)` is a value-type subtract — prefer it | — |
| `errors.New("...")` in a hot path | Yes | Predefine the sentinel as a package var |
| `map[string]T` keyed by short stable strings | Hashes each call | Use a typed enum or `int` if domain allows |

`unsafe.StringData` / `unsafe.String` are sharp tools — they let the same backing memory be viewed as `string` and `[]byte`, which means you must guarantee no one mutates the bytes for the lifetime of any aliasing string.

---

## 9. `make` vs declared zero

```go
var s []int            // nil slice, no allocation
s := make([]int, 0)    // non-nil, empty slice, one allocation
s := []int{}           // same as make([]int, 0)
```

For an empty result you'll often return, prefer the `var` form. Callers can `append` to a nil slice without trouble, and you save the allocation.

Same for maps:

```go
var m map[K]V          // nil; reads return zero, writes panic
m := make(map[K]V)     // empty but writable; one allocation
```

Pick based on whether the function may write to it.

---

## 10. Concurrent allocation: per-P scratch

For a service that performs the same expensive allocation per request, the allocator scales well but locking inside your code might not. Instead of one global pool with a mutex, prefer:

- `sync.Pool` (per-P internally).
- A sharded slice keyed by `runtime.GOMAXPROCS` (rare, but useful for specialized cases).

```go
type shards [256]struct {
    _    [56]byte   // pad to 64B cache line (assuming 8B mutex)
    mu   sync.Mutex
    data map[string]int
}

var sh shards

func get(k string) int {
    s := &sh[fnv32(k)%uint32(len(sh))]
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.data[k]
}
```

Padding to 64 B prevents *false sharing* — when two adjacent shards live in one cache line and writes to one invalidate the other on every CPU. Measure with `perf c2c` (Linux) before reaching for this.

---

## 11. Profile-guided optimization (PGO)

Go 1.21 GA'd PGO. The flow:

```bash
# 1. Build a profilable binary
go build -o app ./cmd/app

# 2. Run under representative load, collect profile
curl http://localhost:6060/debug/pprof/profile?seconds=60 > default.pgo

# 3. Rebuild with the profile
mv default.pgo cmd/app/
go build -pgo=auto -o app ./cmd/app
```

Typical wins: 2–10% on CPU. For allocation patterns, PGO helps because the compiler inlines hotter paths more aggressively, which lets escape analysis see more, which can stack-allocate things that previously escaped.

See [11-pgo](../11-pgo/) for the full treatment.

---

## 12. The optimization checklist

Before claiming a memory optimization is done:

- [ ] You have a baseline benchmark.
- [ ] You have a profile that pinpointed the hotspot.
- [ ] You measured allocations/op, not just ns/op.
- [ ] You ran `benchstat` over at least 10 iterations and the change is statistically meaningful.
- [ ] You ran the full test suite, including the race detector.
- [ ] You wrote (or have) a benchmark that locks in the regression you fixed.
- [ ] You documented the change with the before/after numbers in the commit message.

Without these, you have a change. With them, you have an optimization.

---

## 13. Summary

The fastest way to optimize Go memory is to make the allocation never happen — pre-allocate, pool, avoid boxing, prefer values to pointers in small types. The second-fastest is to use the right primitive (`strings.Builder`, `strconv.Itoa`, generics over `interface{}`). Knobs (`GOGC`, `GOMEMLIMIT`) are blunter than they look; reach for them only when you've already done the algorithmic work. Measure, change one thing, measure again, commit with numbers.

---

## Further reading
- `pprof` deep dive: https://github.com/google/pprof/blob/main/doc/README.md
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- `fieldalignment`: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/fieldalignment
- PGO: https://go.dev/doc/pgo
