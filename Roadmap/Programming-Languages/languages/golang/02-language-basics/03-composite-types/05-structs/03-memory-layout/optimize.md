# Struct Memory Layout — Optimize

## 1. Goal of this file

This file is about **reducing memory footprint and improving cache behaviour** through deliberate struct layout. The levers, in roughly the order they pay off:

1. Reorder fields large→small (the cheapest 10–30 % win).
2. Replace `time.Time` with `int64` Unix nanos where timezone/monotonic isn't needed.
3. Pack booleans into a bitfield.
4. Split hot and cold fields into separate structs.
5. Convert array-of-structs to struct-of-arrays for hot numeric sweeps.
6. Pad contended atomics to cache-line size.
7. Use `atomic.Int64`/`Uint64` (Go 1.19+) to avoid 32-bit alignment bugs.
8. Cluster pointer fields at the start of the struct to shrink GC scan area.
9. Gate new structs with `fieldalignment` in CI.

Typical end-to-end win on a struct-heavy service: 20–40 % heap reduction, 5–15 % GC pause improvement, 10–30 % throughput improvement on cache-bound paths. The remainder is bound by the algorithm and data, not by layout.

---

## 2. The measurement baseline

Before any layout change, capture:

| Metric | How |
|--------|-----|
| Per-struct size | `unsafe.Sizeof(YourStruct{})` printed in `main` |
| Heap allocations | `go test -bench=. -benchmem` |
| Steady-state heap | `runtime.ReadMemStats(&ms); ms.HeapAlloc` after warmup |
| GC pause time | `GODEBUG=gctrace=1` log output |
| CPU profile of hot path | `go test -cpuprofile=cpu.pb.gz`, `go tool pprof -top` |
| L1/L2 cache misses (Linux) | `perf stat -e cache-misses,cache-references ./binary` |
| Field alignment lint | `fieldalignment ./pkg/...` |

A 5× change in any column is meaningful. A 1.2× change is noise. Run the benchmark **at least 5 times** to filter out CI noise.

---

## 3. Field reordering: cheapest win

The single most impactful change for any naive struct: reorder fields large→small.

```go
// Before — 56 bytes
type Bad struct {
    a bool
    b int64
    c bool
    d int32
    e bool
    f int64
}

// After — 32 bytes
type Good struct {
    b int64
    f int64
    d int32
    a bool
    c bool
    e bool
}
```

Half the size. The reorder is mechanical:

1. List fields by their alignment requirement, descending.
2. Within each alignment tier, order doesn't matter.
3. Stop. Verify with `unsafe.Sizeof`.

Or let the tool do it:

```bash
fieldalignment -fix ./pkg/...
```

Caveats:

- **Wire-format structs** (`encoding/binary`, custom protocols) must keep declared order.
- **cgo structs** must match the C layout.
- **JSON output order** is determined by tag/declared order; consumers should not depend on it, but some do.

Add `// nolint:fieldalignment // wire format` on protected structs.

---

## 4. Type substitution: bigger wins

Layout reordering shaves padding; **type substitution** shrinks the fields themselves. The high-value swaps:

| Before | After | Saves per field |
|--------|-------|----------------|
| `time.Time` | `int64` (Unix nanos) | 16 bytes |
| `time.Duration` | `int32` (millis, if range fits) | 4 bytes |
| `int` | `int32` (if range fits) | 4 bytes |
| `string` (short fixed length) | `[N]byte` | varies |
| `map[K]V` (rarely populated) | `*map[K]V` (nil until used) | drops allocation |
| `[]T` (often empty) | first element + overflow `*[]T` | drops allocation |
| `bool` × N | `uint8`/`uint16`/`uint32` bitfield | (N-1) bytes |

The `time.Time` → `int64` swap deserves emphasis. `time.Time` is 24 bytes (a 16-byte wall+ext tuple plus an 8-byte `*time.Location` pointer). For most timestamp use cases (created-at, expires-at, last-seen), `int64` Unix nanos is sufficient. Reconstruct a `time.Time` on demand:

```go
displayTime := time.Unix(0, entry.TimestampNS).UTC()
```

For a struct allocated millions of times, the saving is 16 MiB per million instances — plus the GC no longer scans a pointer.

---

## 5. Bit-packing booleans

Each `bool` in Go is one byte. For structs with many bools, packing into an integer-sized bitfield is a clear win:

```go
// Before — 16 bytes after alignment
type Permissions struct {
    CanRead   bool
    CanWrite  bool
    CanDelete bool
    CanShare  bool
    CanAdmin  bool
    CanAudit  bool
    CanInvite bool
    CanExport bool
}

// After — 2 bytes
type Permissions struct {
    bits uint8  // up to 8 flags
}

const (
    PermRead = 1 << iota
    PermWrite
    PermDelete
    PermShare
    PermAdmin
    PermAudit
    PermInvite
    PermExport
)

func (p *Permissions) Grant(bit uint8) { p.bits |= bit }
func (p *Permissions) Has(bit uint8) bool { return p.bits&bit != 0 }
func (p *Permissions) Revoke(bit uint8) { p.bits &^= bit }
```

Trade-off: 5 lines of boilerplate methods, in exchange for 14 bytes per Permissions saved. For a per-user permission set in a service with 10 M users, that's 140 MiB.

For 16 flags use `uint16`, for 32 use `uint32`, for 64 use `uint64`. Beyond 64, use `[N]uint64` arrays:

```go
type ManyFlags [8]uint64  // 512 flags

func (f *ManyFlags) Has(bit int) bool {
    return f[bit/64]&(1<<(bit%64)) != 0
}
```

The bit operations compile to single instructions. Performance is essentially equal to bool reads.

---

## 6. Hot/cold field splitting

A struct with 30 fields where only 4 are read on the hot path wastes cache. Each hot-path read pulls in a 64-byte cache line containing mostly cold data.

```go
// Before — 256 bytes per Connection; hot reads pull cold bytes
type Connection struct {
    ID        uint64        // HOT
    State     uint32        // HOT
    LastSeq   uint64        // HOT
    Flags     uint32        // HOT
    Created   time.Time
    ClientIP  netip.Addr
    UserAgent string
    Session   map[string]any
    AuditLog  []AuditEvent
    Lock      sync.Mutex
    // ... more cold fields
}

// After — hot struct is 32 bytes (half a cache line)
type Connection struct {
    ID      uint64
    State   uint32
    LastSeq uint64
    Flags   uint32
    cold    *coldConnection
}

type coldConnection struct {
    Created   time.Time
    ClientIP  netip.Addr
    UserAgent string
    Session   map[string]any
    AuditLog  []AuditEvent
    Lock      sync.Mutex
    // ... cold fields
}
```

The hot Connection fits in one cache line (32 bytes + 32 bytes for the cold pointer half). Cold-path reads pay one extra pointer dereference.

Measurement: for a packet forwarder doing ~1 M Conn lookups/sec, the cache-miss rate dropped from 11 % to 4 %. Forwarding throughput went up 22 %.

The downside: API uglification. Accessing cold fields requires `conn.cold.UserAgent`. Document the split clearly; consider a method that handles the dereference:

```go
func (c *Connection) UserAgent() string {
    if c.cold == nil {
        return ""
    }
    return c.cold.UserAgent
}
```

---

## 7. Array-of-structs vs struct-of-arrays

For numeric data, SoA can beat AoS by 3–8× on hot loops that read one field at a time.

```go
// AoS — natural Go
type Sample struct {
    Time  int64
    Value float64
    Tag   uint32
}
samples := make([]Sample, 1_000_000)

// Loop reading only Value:
var sum float64
for _, s := range samples {
    sum += s.Value
}
```

Each iteration loads a 24-byte struct from a cache line, uses 8 bytes (Value). Cache utilization: 33 %.

```go
// SoA
type Samples struct {
    Time  []int64
    Value []float64
    Tag   []uint32
}
samples := Samples{
    Time:  make([]int64, 1_000_000),
    Value: make([]float64, 1_000_000),
    Tag:   make([]uint32, 1_000_000),
}

// Loop reading only Value:
var sum float64
for _, v := range samples.Value {
    sum += v
}
```

Now each iteration loads a 64-byte cache line of 8 `float64`s. Cache utilization: 100 %. The Go compiler may also auto-vectorize the simpler loop.

Benchmark on a typical x86_64:

| Layout | ns/element |
|--------|-----------|
| AoS | 3.2 |
| SoA | 0.45 |

7× speedup on the hot sum loop. Cost: any operation needing multiple fields at once now needs index synchronization across slices. For mixed workloads, AoS is still the right default.

This pattern appears in time-series databases (InfluxDB chunks data SoA), image processing (separate R/G/B channels), and scientific computing.

---

## 8. Cache-line padding for contended atomics

False sharing turns scalable counters into bottlenecks. The fix:

```go
const cacheLineSize = 128  // safe across x86_64 (64), arm64 (64), Apple Silicon (128)

type paddedAtomic struct {
    v atomic.Uint64
    _ [cacheLineSize - 8]byte
}

type Metrics struct {
    Requests    paddedAtomic
    Errors      paddedAtomic
    LatencySum  paddedAtomic
    Throughput  paddedAtomic
}
```

Each counter on its own cache line. No cross-counter invalidation. Measure with `go test -bench=. -cpu=1,2,4,8`:

| | 1 CPU | 8 CPUs |
|-|-------|--------|
| Unpadded | 1.2 ns/op | 78 ns/op (worse than serial) |
| Padded | 1.2 ns/op | 1.4 ns/op (scales) |

The cost: 120 bytes wasted per counter. For a handful of hot counters, trivial. For 1000s, reconsider — at that scale you probably want per-CPU sharding (Go doesn't expose CPU IDs portably, so this is hard).

Alternative: the [runtime/internal/atomic](https://github.com/golang/go/tree/master/src/runtime/internal/atomic) package provides similar padded types — they're internal-only, but the source is a useful reference for the production-grade padding pattern.

---

## 9. `atomic.Int64` / `Uint64` for cross-platform safety

For any code that may run on 32-bit (ARM, 386), using bare `int64` + `atomic.AddInt64` is a latent crash. The Go 1.19 typed atomics solve this:

```go
// Cross-platform safe — works on 32-bit anywhere in the struct
type Stats struct {
    Enabled bool
    Count   atomic.Uint64
    Total   atomic.Int64
}

stats.Count.Add(1)
val := stats.Total.Load()
```

The `atomic.Uint64` type contains an internal `align64` field that forces 8-byte alignment regardless of position in the parent struct. On 64-bit it's a no-op; on 32-bit it adds padding to ensure the wrapped value sits on an 8-byte boundary.

Migrate existing code:

```go
// Before
type Stats struct {
    Count uint64
}
atomic.AddUint64(&s.Count, 1)

// After
type Stats struct {
    Count atomic.Uint64
}
s.Count.Add(1)
```

The typed atomics also prevent **accidental non-atomic reads** — you can't do `s.Count` to read the value, you must call `.Load()`. That's a minor API uglification with major correctness benefits.

---

## 10. Pointer field clustering for GC

The Go GC scans every allocation's "pointer bitmap" up to the last pointer-containing word. Clustering pointers at the start shrinks this scan area.

```go
// Before — PtrBytes = 48 (last pointer at offset 32+, bitmap covers all)
type Record struct {
    Flag1 bool       // 1
    Name  string     // pointer at offset 8 (after padding)
    Flag2 bool       // offset 24
    Email string     // pointer at offset 32
    Flag3 bool       // offset 48
    Score int64      // offset 56
}

// After — PtrBytes = 32 (last pointer at offset 16, bitmap is smaller)
type Record struct {
    Name  string     // pointer at 0
    Email string     // pointer at 16
    Score int64      // offset 32
    Flag1 bool       // offset 40
    Flag2 bool
    Flag3 bool
}
```

The GC's mark phase walks the bitmap word by word. For a slice of 10 M Records, the original has 8M words of bitmap to walk; the reordered has 4M. On a typical GC cycle this can cut scan time by 30–50 %.

Measure with `GODEBUG=gctrace=1`:

```
gc 12 @1.5s 1%: 0.10+2.1+0.02 ms clock
                       ^^^ mark phase
```

`fieldalignment` reports pointer-bytes savings alongside size savings.

---

## 11. Removing unnecessary pointer fields

A `string` field is 16 bytes plus the bytes behind the pointer. A `[16]byte` field is 16 bytes, period — no pointer, no GC scan. Trade-offs:

| | `string` | `[N]byte` |
|-|----------|----------|
| Struct size | 16 bytes (header) | N bytes |
| Backing memory | Shared with other strings | Inline |
| GC pointer | Yes (1 word to scan) | No |
| Mutability | Immutable | Mutable |
| Length flexibility | Variable | Fixed at N |
| Substring ops | Cheap (no copy) | Need slice |

When N is small and fixed (UUIDs, short tokens, fixed-width IDs), `[N]byte` is the right choice for the hot-path struct. For typical text data, `string` wins.

```go
// Before — string field forces GC scan
type Session struct {
    Token string  // always 32 chars (a SHA256 hex)
    UserID int64
}

// After — fixed-width array, no pointer
type Session struct {
    Token  [32]byte  // store the 32 hex bytes directly
    UserID int64
}
```

`unsafe.Sizeof(SessionBefore{}) = 24` (16 string + 8 int64). `unsafe.Sizeof(SessionAfter{}) = 40` (32 + 8). The new struct is **larger** by 16 bytes. But:

- No pointer for GC to scan.
- No backing string allocation per session.
- The Token bytes live inline, with the rest of the session data, in the same cache line.

For a high-allocation-rate service, the savings in allocation count and GC scan time often outweigh the extra bytes. Measure both ways.

---

## 12. Inline arrays vs separate allocations

When a struct has a small variable-length collection (tags, headers, attributes), the natural Go is `[]T`. But each non-empty slice is a separate heap allocation:

```go
type Event struct {
    Name string
    Tags []string  // typically 1–3 tags; sometimes 0
}
```

Each `Event` with 2 tags: 1 allocation for the Event + 1 for the slice backing array + 2 string allocations for the tag bytes = 4 allocations. For 100 K events/sec, that's 400 K allocations/sec just for tags.

Inline the common case:

```go
type Event struct {
    Name      string
    inlineTags [4]string  // up to 4 tags inline; no allocation
    extraTags  []string   // overflow for >4 tags
    tagCount   int8
}

func (e *Event) Tags() []string {
    if e.tagCount <= 4 {
        return e.inlineTags[:e.tagCount]
    }
    result := make([]string, 0, e.tagCount)
    result = append(result, e.inlineTags[:]...)
    result = append(result, e.extraTags...)
    return result
}
```

Now 95 % of events (with ≤4 tags) avoid the slice allocation. The Event grows by 64 bytes (4 × 16-byte string headers) but GC pressure drops dramatically. This is the same pattern as C++ `small_vector` or Rust `SmallVec`.

Whether the size increase is worth the allocation savings depends on rates. Profile both.

---

## 13. `sync.Pool` for struct reuse

For structs allocated and discarded at very high rates, pooling reuses memory and removes GC pressure entirely:

```go
var packetPool = sync.Pool{
    New: func() any { return new(Packet) },
}

func handle(buf []byte) {
    p := packetPool.Get().(*Packet)
    defer func() {
        *p = Packet{}  // zero out to release any pointer refs
        packetPool.Put(p)
    }()
    p.parse(buf)
    process(p)
}
```

The pool gives back the same struct on subsequent gets within the same goroutine (mostly). Allocations drop to near zero in steady state.

Layout consideration: `sync.Pool` Get/Put doesn't change layout, but it **does** mean your struct lives through many requests. Any leaked field reference (e.g., a slice you forgot to clear) keeps memory alive across uses. The `*p = Packet{}` in defer is the safe pattern.

Pool wins are largest for structs of 256 bytes or more. For tiny structs the allocator is already very fast.

---

## 14. PGO and layout

Profile-guided optimization (PGO, Go 1.21+) reads a representative CPU profile and re-optimizes code based on observed hot paths. Layout itself isn't changed by PGO — the field order in source code wins. But PGO can:

- Inline functions that access struct fields, exposing more layout-driven optimization opportunities to the compiler.
- De-virtualize interface calls, removing indirection cost on struct method dispatch.
- Improve register allocation around struct field reads.

The interplay: a well-laid-out struct (cache-friendly, hot fields clustered) combined with PGO often shows multiplicative gains. Apply layout fixes first; then PGO; then re-measure.

```bash
# Collect profile from production for 60s
curl -o cpu.pgo "http://prod:6060/debug/pprof/profile?seconds=60"

# Build with PGO
go build -pgo=cpu.pgo -o app ./cmd/app
```

Expected gain from PGO alone on struct-heavy hot paths: 3–8 %. Combined with layout work: 15–30 %.

---

## 15. CI integration

Three CI checks to set up:

**1. `fieldalignment` gate**. Fails on new findings:

```yaml
- name: Field alignment
  run: |
    go install golang.org/x/tools/go/analysis/passes/fieldalignment/cmd/fieldalignment@v0.20.0
    fieldalignment ./internal/... ./pkg/...
```

Exclude wire-format and cgo packages.

**2. Struct size regression test**. For load-bearing structs, assert size in a test:

```go
func TestRecordSize(t *testing.T) {
    const expected = 80
    if got := unsafe.Sizeof(Record{}); got != expected {
        t.Errorf("Record size regressed: got %d, want %d (update if intentional)", got, expected)
    }
}
```

The test fails loudly on a layout change — forcing a reviewer to acknowledge it.

**3. Benchmark regression on hot structs**. Run benchmarks in CI and compare:

```bash
go test -run=X -bench=BenchmarkHandle -benchmem -count=5 ./... > new.txt
benchstat baseline.txt new.txt
```

`benchstat` (`golang.org/x/perf/cmd/benchstat`) does statistical comparison and reports significant changes only.

---

## 16. The optimization checklist

Run through this on every load-bearing struct before declaring it done:

1. [ ] `fieldalignment` reports no finding (or is documented).
2. [ ] `time.Time` fields replaced with `int64` where timezone/monotonic unnecessary.
3. [ ] Bools packed if there are 4 or more.
4. [ ] Hot/cold split applied if struct has > 100 bytes and < 30 % of fields are on hot paths.
5. [ ] Pointer fields clustered at the start (for GC scan).
6. [ ] Contended atomic counters padded to cache-line size.
7. [ ] Bare `int64` + `atomic.AddInt64` replaced with `atomic.Int64`.
8. [ ] Inline small collections (`[N]T`) instead of `[]T` for the common case.
9. [ ] `sync.Pool` used if allocation rate > 100 K/sec.
10. [ ] Struct size locked in a regression test if layout matters.
11. [ ] SoA considered for numeric sweeps reading one field at a time.
12. [ ] PGO applied after layout work, not before.

---

## 17. Summary

Optimizing Go struct layout is a layered exercise: reorder for padding wins, substitute types for raw size wins, split hot/cold for cache wins, pad atomics for false-sharing wins, cluster pointers for GC wins. Tools — `unsafe.Sizeof`, `fieldalignment`, `pprof -alloc_space`, `GODEBUG=gctrace=1`, `perf stat` — make every step measurable. CI gates with `fieldalignment` and size-regression tests prevent backsliding. The realistic envelope on a struct-heavy production service: 20–40 % heap reduction, 10–30 % steady-state performance improvement. The hard part isn't the technique; it's knowing **which** struct to optimize. Profile first, optimize second.

---

## Further reading

- `fieldalignment`: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/fieldalignment
- `sync/atomic` typed wrappers: https://pkg.go.dev/sync/atomic
- `sync.Pool` patterns: https://pkg.go.dev/sync#Pool
- Go PGO guide: https://go.dev/doc/pgo
- `runtime.SetMemoryLimit`: https://pkg.go.dev/runtime/debug#SetMemoryLimit
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- Cache-line awareness (Intel): https://software.intel.com/content/www/us/en/develop/articles/avoiding-and-identifying-false-sharing-among-threads.html
- AoS vs SoA: https://en.wikipedia.org/wiki/AoS_and_SoA
- Sibling: [professional.md](professional.md) for production rollout stories.
