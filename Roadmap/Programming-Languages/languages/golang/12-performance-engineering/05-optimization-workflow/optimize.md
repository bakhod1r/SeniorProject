# Optimization Workflow — Optimize

## 1. The framing: techniques by bottleneck

This file is the catalog of concrete techniques you reach for during step 4 of the loop ("apply one change"). The catalog is organized by which bottleneck the technique addresses, because choosing the right technique for the *wrong* bottleneck wastes both engineering time and the optimization budget.

Before applying anything below, you must know which bottleneck you're working on. If you don't, go back to step 2 (measure) and step 3 (identify) first.

---

## 2. CPU-bound: do less work

The most leveraged CPU optimization is removing work, not speeding up work.

### 2.1 Skip work entirely

```go
// Before: format the message even if debug is off
log.Debug("processing item " + item.Name)

// After: format only if it'll be emitted
if log.Enabled(slog.LevelDebug) {
    log.Debug("processing item", "name", item.Name)
}
```

Applies to metrics emission, audit logging, serialization for cold-path responses. If the result isn't used, don't compute it.

### 2.2 Cache the result

```go
var permCache = ttlcache.New[string, []string](5 * time.Minute)

func (s *Service) Permissions(user string) []string {
    if v, ok := permCache.Get(user); ok {
        return v
    }
    v := s.db.Query("...", user)
    permCache.Set(user, v)
    return v
}
```

Caching is the highest-leverage CPU optimization in most services. Costs (staleness, invalidation, memory) are known; benefits are dramatic for read-heavy workloads.

### 2.3 Batch the work

```go
// Before: one query per item
for _, id := range ids {
    item, _ := db.Get(id)
    process(item)
}

// After: one query for all
items, _ := db.GetMany(ids)
for _, item := range items { process(item) }
```

The fixed cost of a database round-trip dwarfs per-row cost. Same applies to network calls, file I/O, channel sends.

### 2.4 Better algorithm

```go
// O(n^2)
for _, x := range a {
    for _, y := range b {
        if x.ID == y.ID { merge(x, y) }
    }
}

// O(n)
bm := make(map[int]Item, len(b))
for _, y := range b { bm[y.ID] = y }
for _, x := range a {
    if y, ok := bm[x.ID]; ok { merge(x, y) }
}
```

Algorithmic improvements compound. A 10× win here exceeds every other CPU technique combined.

---

## 3. CPU-bound: do work faster

When you can't remove or batch work, the next lever is making each unit cheaper.

| Technique | Win |
|-----------|-----|
| Avoid reflection — `easyjson`/`sonic` over `encoding/json` | 2-5× on JSON |
| `strconv.AppendInt` over `fmt.Sprintf("%d", ...)` | 3-10× on integer formatting |
| Inline-friendly helpers — short, no `defer`/`for-range`/`select` | Lets escape analysis stack-allocate |
| Partition input by branch direction before processing | 1.2-2× on data-dependent loops |
| Type-specific comparators over `reflect.DeepEqual` | 5-50× on hot comparison |

Check inlining:

```bash
go build -gcflags="-m=2" ./... 2>&1 | grep "cannot inline"
```

If the cost-relevant helper isn't inlining, restructure or accept the cost.

---

## 4. Memory-bound: reduce allocations

In Go, "memory-bound" usually means GC-bound, which usually means too many allocations.

### 4.1 Pre-size slices and maps

```go
// Grows via geometric reallocation
out := []int{}
for i := 0; i < n; i++ { out = append(out, f(i)) }

// One allocation
out := make([]int, 0, n)
for i := 0; i < n; i++ { out = append(out, f(i)) }
```

Same for maps: `make(map[K]V, n)` allocates buckets upfront.

### 4.2 Pool reusable scratch space

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func handle(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() {
        if buf.Cap() < 64<<10 {
            buf.Reset()
            bufPool.Put(buf)
        }
    }()
    // ... use buf ...
}
```

The cap check prevents one oversized request from pinning a 64 MiB buffer forever. `Reset` is mandatory; otherwise pooled buffers leak references through their contents.

### 4.3 `strings.Builder` over `+=`

```go
// O(n^2) allocations
var s string
for _, p := range parts { s += p }

// O(n), often 1-2 with Grow
var b strings.Builder
b.Grow(estimatedSize)
for _, p := range parts { b.WriteString(p) }
s := b.String()
```

### 4.4 Avoid interface boxing in hot loops

```go
// Each value boxes into iface{}
func sum(xs []any) (s int64) {
    for _, x := range xs { s += x.(int64) }
    return
}

// Zero allocation
func sum[T constraints.Integer](xs []T) T {
    var s T
    for _, x := range xs { s += x }
    return s
}
```

Generics monomorphize per shape, so the body runs on concrete types.

### 4.5 Carry the destination slice

```go
// Allocates a fresh slice every call
func Words(s string) []string {
    var out []string
    for _, w := range strings.Fields(s) { out = append(out, w) }
    return out
}

// Caller reuses
func AppendWords(dst []string, s string) []string {
    for _, w := range strings.Fields(s) { dst = append(dst, w) }
    return dst
}
```

The standard library uses this pattern in `strconv.AppendInt`, `time.AppendFormat`, and many `encoding/*` packages.

### 4.6 Sentinel errors

```go
// Allocates each call
return errors.New("not found")

// Allocated once
var ErrNotFound = errors.New("not found")
return ErrNotFound
```

Bonus: enables `errors.Is(err, ErrNotFound)` for callers.

### 4.7 Stack buffers for known-bounded output

```go
func quickFormat(n int64) string {
    var buf [20]byte
    b := strconv.AppendInt(buf[:0], n, 10)
    return string(b)
}
```

`[20]byte` lives on the stack. Only the final `string(b)` allocates.

---

## 5. Memory-bound: shrink the live set

If the working set is too large, allocations aren't the problem; *what's retained* is.

| Technique | When to use |
|-----------|------------|
| Struct field ordering (descending alignment) | Millions of records; detect with `fieldalignment` |
| Value over pointer for small structs (< 64 B) | Hot path that allocates pointer types |
| Smaller integer types (`uint32` over `int64` when range allows) | Tabular data, large in-memory tables |
| SoA over AoS for hot scans | Workload scans a subset of fields per row |

```bash
go install golang.org/x/tools/go/analysis/passes/fieldalignment/cmd/fieldalignment@latest
fieldalignment ./...
```

SoA example:

```go
// AoS: wastes cache when scanning one field
type Row struct{ A, B, C, D int64 }
rows := []Row{...}
for _, r := range rows { sum += r.A }

// SoA: dense cache usage for the field actually scanned
type Table struct{ A, B, C, D []int64 }
for _, a := range t.A { sum += a }
```

---

## 6. Contention-bound: reduce critical section size

When CPU is underutilized at high concurrency, contention is the suspect.

### 6.1 Shrink the locked region

```go
// Holds the lock during expensive work
m.Lock()
defer m.Unlock()
result := expensive(state)
state.update(result)

// Compute outside the lock
result := expensive(stateSnapshot())
m.Lock()
state.update(result)
m.Unlock()
```

### 6.2 RWMutex when reads dominate

Worth it when read:write ratio is ≥ 10:1. For balanced ratios, `sync.Mutex` is often faster because `RWMutex` has higher per-operation overhead.

### 6.3 Sharding

```go
type shards [256]struct {
    _    [56]byte   // pad to cache line, prevent false sharing
    mu   sync.Mutex
    data map[string]V
}

var sh shards

func get(k string) V {
    s := &sh[fnv32(k)%uint32(len(sh))]
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.data[k]
}
```

The padding prevents two adjacent shards from sharing a cache line, which would cause writes to one to invalidate the other on every CPU.

### 6.4 Lock-free where appropriate

`sync/atomic` for counters, flags, pointer swaps. `sync.Map` for "write-rarely, read-often" maps. Advanced — they trade lock cost for correctness risk.

---

## 7. I/O-bound: overlap, batch, or skip

When syscall wait dominates, you don't fix it by making the code faster.

### 7.1 Concurrency for independent calls

```go
// Serial: latency = sum of dependencies
a := callA()
b := callB()
c := callC()

// Parallel: latency = max of dependencies
var a, b, c Result
var wg sync.WaitGroup
wg.Add(3)
go func() { defer wg.Done(); a = callA() }()
go func() { defer wg.Done(); b = callB() }()
go func() { defer wg.Done(); c = callC() }()
wg.Wait()
```

### 7.2 Connection pooling

```go
tr := &http.Transport{
    MaxIdleConns:        100,
    MaxIdleConnsPerHost: 10,
    IdleConnTimeout:     90 * time.Second,
}
client := &http.Client{Transport: tr}
```

Establishing a TCP+TLS connection is 20–100 ms per remote call. Pooling eliminates that cost on subsequent calls.

### 7.3 Buffered I/O

```go
w := bufio.NewWriter(f)
for _, line := range lines { w.Write(line) }
w.Flush()
```

`bufio.Writer` typically reduces syscall count by 100× or more for line-oriented output.

---

## 8. PGO as a final pass

```bash
# 1. Build profilable
go build -o app ./cmd/app

# 2. Capture under representative load
curl http://localhost:6060/debug/pprof/profile?seconds=120 > default.pgo

# 3. Move to source and rebuild
mv default.pgo cmd/app/
go build -pgo=auto -o app ./cmd/app
```

Typical wins: 2-10% CPU. Run it after structural optimizations.

---

## 9. The hidden allocation list

| Idiom | Allocates? | Fix |
|-------|-----------|-----|
| `fmt.Sprintf("%d", n)` | Yes | `strconv.Itoa(n)` |
| `[]byte(s)` and `string(b)` | Yes (copies) | `unsafe.String`/`unsafe.Slice` at internal borders |
| `errors.New("...")` in hot path | Yes | Predefine the sentinel |
| `time.After` in long-lived select | Yes (timer + goroutine + closure) | `time.NewTimer` with explicit `Stop` |
| `context.WithTimeout` without `cancel()` | Leaks the timer | Always defer `cancel` |
| `regexp.MustCompile` inside a handler | Yes | Compile once at package init |
| Range over map for filtering | Yes (iter state) | Direct key lookup if possible |
| `interface{}` parameter with concrete arg | Yes (boxing) | Generics, or concrete-typed function |
| `append` after assignment to `[]any` | Yes per element | Type-specific slice + generic helper |

---

## 10. The optimization checklist

- [ ] You have a baseline benchmark output saved.
- [ ] You have a profile that pinpointed the hotspot.
- [ ] You measured allocations/op, not just ns/op.
- [ ] You ran `benchstat` over at least 10 iterations and `p < 0.05`.
- [ ] You ran the full test suite including the race detector.
- [ ] You wrote a benchmark that locks in the property you fixed.
- [ ] You documented the change with before/after numbers in the commit message.
- [ ] You noted the trade-off you accepted (memory, readability, complexity).

Without these you have a change. With them you have an optimization.

---

## 11. Summary

The fastest way to make Go faster is to remove work: cache, batch, skip, or replace the algorithm. The next step is to use the right standard library tool — `strings.Builder`, `strconv.Append*`, generics, `sync.Pool`. Knobs like `GOGC` are blunter than they look; reach for them only after the structural work is done. Always pair every technique above with a benchmark, a profile, and `benchstat`.

---

## Further reading
- `pprof` deep dive: https://github.com/google/pprof/blob/main/doc/README.md
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- `fieldalignment`: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/fieldalignment
- PGO: https://go.dev/doc/pgo
- Damian Gryski, go-perfbook: https://github.com/dgryski/go-perfbook
