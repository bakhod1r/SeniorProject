# Struct Memory Layout — Professional

## 1. Where layout becomes a load-bearing concern

Struct layout is almost always a micro-optimization. In a hundred-line CLI it doesn't matter. In a production system it matters when:

- **A struct is allocated in bulk** — per-request, per-event, per-row. Tens of millions of copies live in the heap or move through a pipeline.
- **A struct is on a hot atomic path** — counters, ring buffers, lock-free queues. False sharing is the dominant cost.
- **A struct is on a wire** — RPC, file format, shared memory. Layout drift breaks consumers.
- **A service is GC-bound** — pause times, scan time, or `runtime.gcAssist` shows up in profiles. Pointer-bytes-per-struct dictates scan cost.
- **A service hits memory limits** — Kubernetes OOM, Lambda memory caps, embedded systems. Per-struct bytes multiplied by millions cross the threshold.

This file is about production cases: large configs, hot atomics, struct-of-arrays rewrites, real measurements, integration into CI. The Go compiler doesn't optimize for you; your team has to.

---

## 2. The 4 MiB config that wasn't

A real-world starting point: a service maintains 200 000 active rule objects in memory. Each rule struct is naively defined:

```go
type Rule struct {
    Enabled     bool          // 1
    ID          string        // 16
    MatchCount  int64         // 8
    Source      string        // 16
    Priority    int32         // 4
    Created     time.Time     // 24
    Disabled    bool          // 1
    LastFired   time.Time     // 24
    Description string        // 16
    Score       float64       // 8
}
```

`unsafe.Sizeof(Rule{})` on amd64: **128 bytes**. 200 000 × 128 = **25.6 MB**.

`fieldalignment` reports: "could be 112 bytes". Reordered:

```go
type Rule struct {
    Created     time.Time
    LastFired   time.Time
    ID          string
    Source      string
    Description string
    MatchCount  int64
    Score       float64
    Priority    int32
    Enabled     bool
    Disabled    bool
}
```

`unsafe.Sizeof = 112`. New total: 22.4 MB. Savings: 3.2 MB.

Modest. But the real wins came from two further changes:

1. **Replacing `time.Time` with `int64` Unix nanos.** `time.Time` is 24 bytes (a wall-time tuple plus a pointer to a location). For most timestamps we only need a single instant. Two `int64` fields drop 32 bytes per rule.
2. **Interning `Source` and `ID` strings.** 90 % of rules share a small set of source/ID strings. A `sync.Map[string]string` interning table reduced the actual byte-cost of those strings dramatically, even though the header in the struct stayed 16 bytes.

Final per-rule footprint: **80 bytes header + interned bytes**. Total RSS dropped from 540 MiB to 380 MiB. The point: layout reordering was a small wedge; **type substitution** (Time → int64) and **string interning** were the real fixes. Reordering is the cheapest 10–20 %; type rethinking is the next 30 %.

---

## 3. Padding the hot atomic counter

Production telemetry of a high-throughput API gateway showed a strange profile: a counter struct serving QPS counters was **scaling negatively** with goroutine count. At 1 worker: 12 ns per increment. At 8 workers: 95 ns per increment. The counters lived in:

```go
type Stats struct {
    Requests   atomic.Uint64
    Errors     atomic.Uint64
    LatencySum atomic.Uint64
    Timeouts   atomic.Uint64
}
```

Four counters, 32 bytes total — all on the **same 64-byte cache line**. Eight workers writing to four counters on one line meant every write invalidated the line on the other seven cores. The fix:

```go
type paddedCounter struct {
    v atomic.Uint64
    _ [56]byte  // pad to 64 bytes total
}

type Stats struct {
    Requests   paddedCounter
    Errors     paddedCounter
    LatencySum paddedCounter
    Timeouts   paddedCounter
}
```

`unsafe.Sizeof(Stats{}) = 256` (4 × 64). Each counter has its own cache line. Result at 8 workers: 14 ns per increment. The size grew 8×; the throughput grew ~7×.

On Apple Silicon (M1/M2/M3) the cache line is **128 bytes**, not 64. Code that pads to 64 on those CPUs leaves two counters per line and false-shares anyway:

```go
const cacheLineSize = 128  // safe upper bound across all current CPUs

type paddedCounter struct {
    v atomic.Uint64
    _ [cacheLineSize - 8]byte
}
```

The Go runtime defines `internal/cpu.CacheLinePadSize` for its own internal padded types. User code typically hardcodes 64 or 128 (with a comment).

For an exhaustive treatment of cache-line-aware programming see [structlayout-cache-lines](https://www.usenix.org/system/files/conference/atc14/atc14-paper-yokota.pdf) and the Linux kernel's `____cacheline_aligned_in_smp` macro.

---

## 4. Separating hot and cold fields

A common production pattern: a struct has 30 fields, but only 4 are read on the hot path. The remaining 26 fields cost cache space — when the hot path reads `s.id`, the CPU loads the 64-byte line containing it, which displaces other cache lines you needed.

```go
type Connection struct {
    // hot — used on every packet
    id          uint64
    state       uint32
    seqNum      uint64
    flags       uint32

    // cold — used at connect/disconnect, audit, debug
    createdAt   time.Time
    clientIP    netip.Addr
    userAgent   string
    sessionData map[string]any
    audit       []AuditEvent
    ...
}
```

The hot fields are 24 bytes; the cold fields are ~200 bytes. Every cache miss on a hot read may pull in cold bytes you don't need. Split the struct:

```go
type Connection struct {
    id     uint64
    state  uint32
    seqNum uint64
    flags  uint32
    cold   *coldConnectionData  // pointer; one cache miss only if cold path runs
}

type coldConnectionData struct {
    createdAt   time.Time
    clientIP    netip.Addr
    userAgent   string
    sessionData map[string]any
    audit       []AuditEvent
}
```

Now the `Connection` struct is 32 bytes (fits in half a cache line). The cold path pays one pointer dereference. The hot path is dense in cache.

Measure with `perf stat -e cache-misses,cache-references` (Linux) before and after. Expect 30–60 % cache-miss reduction on hot paths. For a packet-forwarding service this often translates to 10–20 % throughput improvement.

---

## 5. Array-of-structs vs struct-of-arrays

When you have a million records each with 5 numeric fields, two layouts are possible:

**Array of structs (AoS)** — the natural Go style:

```go
type Point struct {
    X, Y, Z float64
    Mass    float64
    Charge  float64
}

points := make([]Point, 1_000_000)
// each Point is 40 bytes; total 40 MB; contiguous in memory
```

**Struct of arrays (SoA)** — uncommon in Go, common in HPC:

```go
type PointBatch struct {
    X      []float64
    Y      []float64
    Z      []float64
    Mass   []float64
    Charge []float64
}

batch := PointBatch{
    X: make([]float64, 1_000_000),
    Y: make([]float64, 1_000_000),
    ...
}
```

When does SoA win? When the hot path reads **only one or two fields** of every record:

```go
// AoS: per iteration loads a full 40-byte cache line, uses 8 bytes (X)
for _, p := range points {
    sumX += p.X
}

// SoA: per iteration loads a full 8-byte slot; cache lines fully utilized
for _, x := range batch.X {
    sumX += x
}
```

The SoA loop processes 8 elements per cache line; the AoS loop processes 1.6. SIMD-friendly compilers can also auto-vectorize SoA loops more easily. In Go, the gap is often 3–8× on numeric sweeps.

When does SoA lose? When you read multiple fields per record (`p.X + p.Y + p.Z`). The AoS layout already has them on one line; SoA needs three separate cache lines per element.

This pattern shows up in image processing, telemetry, time-series databases. The conversion is heavy (rewrite all the access sites) but well worth it for the right workload.

---

## 6. Profiling for layout issues

Three signals tell you struct layout is your bottleneck:

| Signal | Source | What it means |
|--------|--------|---------------|
| `runtime.scanobject` dominates CPU profile | `go tool pprof -top cpu.pb.gz` | GC scan is heavy; reduce PtrBytes or shrink structs |
| `bench-cmpr` shows scaling regression | `testing.B.RunParallel` over GOMAXPROCS | False sharing on a hot atomic |
| L1/L2 cache miss rate high | `perf stat` or `linux perf record` | Layout-induced cache misses; consider SoA or hot/cold split |

For the GC angle, set `GODEBUG=gctrace=1` and look at the per-cycle scan time:

```
gc 42 @4.123s 2%: 0.18+1.5+0.03 ms clock, 0.36+0.5/1.4/0.0+0.06 ms cpu, 14->15->8 MB, 16 MB goal, 8 P
```

The `1.5 ms` here is the concurrent mark phase — the time spent scanning. If this grows linearly with heap and your structs are full of pointers, layout-driven reduction (replace `string` with `[]byte` clusters, hoist pointer fields to the front, split hot/cold) pays.

For CPU profiles, look for `runtime.memmove`, `runtime.heapBitsForAddr`, and `runtime.scanblock` near the top of `pprof -top`. Those are GC and copy hotspots.

---

## 7. Layout in shared memory and persistent stores

For struct layouts crossing process boundaries — `mmap`, shared memory rings, file-backed caches — the byte layout **is the API**. Two services need to agree on offsets exactly.

```go
type SharedHeader struct {
    Magic     uint32   // offset 0
    Version   uint32   // offset 4
    WriterPID int64    // offset 8
    SeqNum    uint64   // offset 16
    _         [40]byte // explicit padding to 64 (full cache line)
}

const expectedSize = 64

func init() {
    if unsafe.Sizeof(SharedHeader{}) != expectedSize {
        panic(fmt.Sprintf("header size drift: got %d, want %d", unsafe.Sizeof(SharedHeader{}), expectedSize))
    }
}
```

Three production lessons:

1. **Pin every offset with an explicit `_ [N]byte` field**. Don't trust the compiler's padding; it's correct but invisible.
2. **`init()` size assertions**. If a field is added without the size being updated, the program panics at startup, not silently corrupting data.
3. **Version field at offset 0 (or 4)**. The first read after `mmap` should be the version; mismatched versions take the safe-rejection path.

For cross-language interop (Go writes, Rust reads), additionally add a per-build hash of the type's field list to the header. Compute it at build time via `go generate`.

---

## 8. The `unsafe.Slice` and aligned read pattern

When parsing a binary protocol, the temptation is to write:

```go
type Header struct {
    Magic  uint32
    Length uint32
    Type   uint16
}

func parse(buf []byte) *Header {
    return (*Header)(unsafe.Pointer(&buf[0]))  // DANGER
}
```

This works **only if** `&buf[0]` is aligned to the struct's alignment requirement (4 here). On amd64 it works because the malloc returns aligned pointers; on a slice produced by `bytes.Split` or `bufio.Reader` the alignment is **not guaranteed**.

Safer:

```go
func parse(buf []byte) (Header, error) {
    var h Header
    if len(buf) < int(unsafe.Sizeof(h)) {
        return Header{}, errors.New("buf too short")
    }
    h.Magic = binary.LittleEndian.Uint32(buf[0:4])
    h.Length = binary.LittleEndian.Uint32(buf[4:8])
    h.Type = binary.LittleEndian.Uint16(buf[8:10])
    return h, nil
}
```

The explicit `binary.LittleEndian.Uint32` reads byte-at-a-time and tolerates any alignment. The cost is a few ns per field — invisible compared to network or disk I/O.

For Go 1.20+, `unsafe.Slice` and `unsafe.SliceData` are the supported primitives for converting between byte slices and typed slices, with explicit length:

```go
func asUint64s(buf []byte) []uint64 {
    return unsafe.Slice((*uint64)(unsafe.Pointer(&buf[0])), len(buf)/8)
}
```

Still requires alignment. Treat as a sharp tool.

---

## 9. Wire formats and field reordering: don't

Struct-tagged wire formats (`encoding/json`, `encoding/binary`, protobuf, msgpack) emit fields in declaration order or per-tag order. Reordering for layout efficiency can:

- Break binary protocols (`encoding/binary` reads in declaration order).
- Reorder JSON output (some consumers depend on key ordering, even though the spec says they shouldn't).
- Change the layout of cgo structs to mismatch C.

The rule: **wire-bound structs are exempt from layout optimization**. Document with a comment:

```go
// nolint:fieldalignment // wire layout must match protocol spec
type WireFrame struct {
    Magic    uint32
    Version  uint8
    _        [3]byte    // explicit pad documented in protocol
    Length   uint32
    Body     [256]byte
}
```

The `nolint` directive suppresses the analyzer. The explicit `_ [3]byte` makes the wire layout match the spec exactly.

For internal-only structs, optimize freely. The boundary is where bytes leave the process.

---

## 10. `fieldalignment` in CI without false positives

Roll out `fieldalignment` to a large codebase in three stages:

**Stage 1: baseline report**. Run on the whole tree, count findings. Sort by package; some packages will have hundreds (`api/`, `models/`), others zero.

```bash
fieldalignment -json ./... > baseline.json
jq 'group_by(.package) | map({package: .[0].package, count: length})' baseline.json
```

**Stage 2: gate new code**. Add a CI check that fails if **new** structs (not in `baseline.json`) violate. This stops the bleeding without forcing a megafix.

```bash
fieldalignment -json ./... > current.json
jq '[.[] | select(IN($baseline[].file) | not)]' --slurpfile baseline baseline.json current.json
```

**Stage 3: cleanup waves**. Pick one package at a time. Run `fieldalignment -fix ./internal/foo/...`. Review the diff manually (the tool will reorder struct tags too; if you have a `json` tag carrying field order semantics, restore manually). Commit. Move to next package.

In our experience this takes ~1 day per 50-package codebase. After cleanup the baseline shrinks and the gate becomes a clean "no findings".

Exclude wire-format and cgo packages with build-tag-gated comments or `.fieldalignmentignore` (if you wrap the tool yourself).

---

## 11. Layout-driven memory profiling

Use `pprof -alloc_space` to find allocation hotspots; use `pprof -inuse_objects` to find which struct types are most numerous on the heap.

```bash
go test -run=X -bench=. -benchmem -memprofile=mem.pb.gz ./...
go tool pprof -alloc_space mem.pb.gz
(pprof) top20
(pprof) list NewConnection
```

For long-running services, install a `/debug/pprof/heap` endpoint (gated by env var or admin auth):

```go
import _ "net/http/pprof"

go func() {
    log.Println(http.ListenAndServe("127.0.0.1:6060", nil))
}()
```

Then:

```bash
curl http://prod-host:6060/debug/pprof/heap > heap.pb.gz
go tool pprof -alloc_space -top heap.pb.gz
```

Sample output:

```
Showing top 20 nodes out of 142
      flat  flat%   sum%        cum   cum%
  920.43MB 28.45% 28.45%   920.43MB 28.45%  internal/rule.NewRule
  410.20MB 12.68% 41.13%   410.20MB 12.68%  internal/cache.Set
  ...
```

`internal/rule.NewRule` is the largest allocator. Inspect the `Rule` struct. If it's 128 bytes per allocation and it's allocated 7 million times, that's 896 MiB of churn. Shrinking the struct by 16 bytes saves 112 MiB of allocation pressure per minute of high traffic.

This is how layout work translates into operational wins: less allocation, less GC, lower latency p99.

---

## 12. The decision framework

When a junior asks "should I optimize this struct?" — the framework:

| Question | If yes | If no |
|----------|--------|-------|
| Allocated > 100 k times in steady state? | Optimize. | Skip. |
| On a wire? | Don't optimize order. Pad explicitly. | Reorder freely. |
| Atomically accessed? | Pad to cache line if contended. | Standard layout. |
| Embedded in a hot loop? | Hot/cold split, SoA candidate. | Standard layout. |
| Cross-platform (32-bit)? | Use `atomic.Int64`, not raw `int64`. | Either. |
| Crosses cgo boundary? | Match C layout exactly. | N/A. |

If all answers are "no", **leave it alone**. Premature layout optimization is the same as any other premature optimization: it costs reviewer time, complicates the struct, and pretends to give performance you can't measure.

---

## 13. Real war story: the 12 % p99 latency win

A team owned a streaming aggregation service: events in via Kafka, transformations in a goroutine pool, output to Elasticsearch. P99 latency was 84 ms. Their `Event` struct:

```go
type Event struct {
    Timestamp time.Time      // 24
    UserID    string         // 16
    Action    string         // 16
    Payload   map[string]any // 8
    Source    string         // 16
    Region    string         // 16
    Version   int            // 8
    Critical  bool           // 1
    Logged    bool           // 1
    enabled   bool           // 1 (internal flag)
}
```

`unsafe.Sizeof(Event{})` = 120 bytes (with 13 bytes of waste). Allocated ~3 million times per second in steady state.

Three changes:

1. **Replace `time.Time` with `int64` Unix nanos** → -16 bytes (24 to 8).
2. **Group bools** → -10 bytes via reorder.
3. **Replace `map[string]any` with a fixed `[8]kv` array** for the common case → reduce heap pressure (the map allocates separately).

After:

```go
type Event struct {
    TimestampNS int64         // 8
    Version     int           // 8
    UserID      string        // 16
    Action      string        // 16
    Source      string        // 16
    Region      string        // 16
    payload     [8]kv         // 96 bytes inline; falls back to map if overflows
    Critical    bool
    Logged    bool
    enabled   bool
}
```

Sizeof increased to 176 bytes per event — but the map allocation was eliminated for 95 % of events. Total memory churn dropped 40 %. GC pause p99 dropped from 4 ms to 1.5 ms. End-to-end p99 latency dropped from 84 ms to 74 ms — **12 % improvement**.

The layout change alone didn't do it; the map → inline-array change was the big one. But the layout review surfaced the map as suspicious in the first place. Layout audits are a discovery tool, not just a final optimization.

---

## 14. Patterns to keep in your back pocket

| Pattern | When | Effect |
|---------|------|--------|
| `_ [N]byte` explicit padding | Wire structs, cache-line alignment | Documents intent; survives reordering |
| `atomic.Uint64` field type | Any atomic counter | 8-byte alignment guaranteed; cross-platform safe |
| Hot/cold split via embedded `*coldData` | 30+ field struct, hot path uses < 5 | Half the cache footprint of hot reads |
| `time.Time` → `int64` Unix nanos | Bulk-allocated events/records | -16 bytes per record |
| `string` → interned `string` or `[N]byte` | Repeated short strings | Drops the GC pointer cost |
| `map[K]V` → fixed `[N]kv` array | Small, known-bound maps inline | One allocation instead of two |
| SoA via parallel slices | Hot numeric sweeps, single-field reads | 3–8× speedup on tight loops |
| `paddedCounter` struct wrapping `atomic.Uint64` | Contended atomics under high concurrency | Eliminates false sharing |
| Pointer fields at struct start | Heavy GC scan time | Smaller PtrBytes, faster mark |

---

## 15. Summary

Production layout work follows a discipline: measure first (`pprof -alloc_space`, `gctrace`, `perf stat`), pick the struct with the biggest leverage (high allocation count or hot atomic), apply the right tool (reorder, pad, hot/cold split, type substitution, SoA), and verify the win in production (p99 latency, RSS, GC pause). The cheapest wins come from `fieldalignment -fix`; the larger wins come from type-level rethinking — `time.Time` to `int64`, `map` to `[N]kv`, AoS to SoA. Pad explicitly for cache lines and wire formats; trust the compiler for everything else. CI gates with the `fieldalignment` analyzer keep new code from regressing. Layout is rarely a service's first bottleneck and rarely its biggest, but in the right place it removes a stubborn 10–30 % from the bottom line.

---

## Further reading

- `fieldalignment` analyzer: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/fieldalignment
- `pprof` tutorial: https://go.dev/blog/pprof
- `runtime.SetMemoryLimit` (Go 1.19): https://pkg.go.dev/runtime/debug#SetMemoryLimit
- Cache-line aware programming (Intel): https://software.intel.com/content/www/us/en/develop/articles/avoiding-and-identifying-false-sharing-among-threads.html
- Linux `perf stat`: https://perf.wiki.kernel.org/index.php/Tutorial
- AOS vs SOA design: https://en.wikipedia.org/wiki/AoS_and_SoA
- Sibling: [optimize.md](optimize.md) for the full Go-level optimization playbook.
