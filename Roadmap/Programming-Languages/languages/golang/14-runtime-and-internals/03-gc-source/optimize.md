# GC Source — Optimization

## 1. How to use this file

Fifteen scenarios where code creates GC pressure on a hot path — extra allocations, large scan surface, or mark-assist bursts that show up as P99 jitter. Each entry has a **Before** (code + benchmark + GC trace) and a collapsible **After** (optimized code + numbers + why grounded in the runtime + trade-offs + when NOT).

Anchored at Go 1.23, amd64, `GOGC=100`. Numbers are reproducible-shape — run `go test -bench=. -benchmem` with `GODEBUG=gctrace=1` on your hardware before quoting them. The mechanics referenced live in `runtime/mgc.go` (pacing), `runtime/mgcmark.go` (scan), `runtime/mgcsweep.go` (sweep), `runtime/mbarrier.go` (write barrier), and `runtime/malloc.go` (allocation fast path).

GC pressure has four shapes: per-call allocations that drive heap growth and trigger GCs sooner; large objects with many pointer fields that inflate scan time; sustained allocation rate forcing mark-assist onto mutator goroutines; short-lived garbage that escapes a cycle and inflates the next sweep. Most wins remove one of those four.

Reading order: Ex. 1, 2, 11, then any order. Ex. 4, 5, 12 are the ones senior reviews flag most.

How to read `gctrace`: format is `gc N @Ts %CPU: A+B+C ms clock, ... ms cpu, I->J->K MB, L MB goal, M P` — A is mutator assist time (the bill goroutines pay per `runtime/mgcmark.go:gcAssistAlloc`), B is background mark, I→J→K is heap at trigger → mid-cycle → live after sweep. Rising assist means the mutator is doing GC work; longer GC intervals mean less allocation pressure.

---

## 2. Exercise 1 — `fmt.Sprintf` in a hot loop

**Difficulty:** Junior+

A logger formats a cache key with `fmt.Sprintf("%d-%d", id, n)`. The format machinery boxes both ints into `any` (one `runtime.convT64` alloc each), pulls a `*pp` printer from the pool, walks the verb table, writes into an internal `[]byte`, and `string()`-copies the result. At 200k QPS that's 600k allocs/sec just to make a map key.

```go
func cacheKey(id int64, n int) string {
    return fmt.Sprintf("%d-%d", id, n)
}
```

```
BenchmarkSprintfKey-8   5000000   320 ns/op   48 B/op   3 allocs/op
gc 15 @4.34s 6%: 0.20+13+0.20 ms clock, 41->45->24 MB, 44 MB goal
```

GCs ~240 ms apart, mutator assist 1.5 ms — `runtime/mgc.go:gcSetTriggerRatio` lowered the trigger because alloc rate is high.

<details><summary>After</summary>

`strconv.AppendInt` writes digits directly into a caller-owned buffer. No iface boxing, no `fmt` state, one final string copy.

```go
func cacheKey(id int64, n int, buf []byte) string {
    buf = strconv.AppendInt(buf[:0], id, 10)
    buf = append(buf, '-')
    buf = strconv.AppendInt(buf, int64(n), 10)
    return string(buf)
}
// caller: var scratch [32]byte; k := cacheKey(id, n, scratch[:0])
```

```
BenchmarkAppendIntKey-8   30000000   38 ns/op   16 B/op   1 allocs/op
gc 15 @8.60s 3%: 0.11+8+0.18 ms clock, 32->33->18 MB, 36 MB goal
```

~8× faster, GC interval doubled, assist halved.

**Why faster:** `fmt.Sprintf` allocates the result string plus one `any` per arg. `strconv.AppendInt` writes into the caller's buffer; the values never escape. Lower alloc rate delays the next trigger and shrinks assist (`gcAssistAlloc` runs on whichever goroutine crosses the trigger).

**Trade-off:** The final `string(buf)` still copies. For map-probe-then-discard, `unsafe.String` skips it — but the map must not retain the slice.

**When NOT:** Cold paths, error messages, log lines where the I/O dwarfs format cost.
</details>

---

## 3. Exercise 2 — `[]byte(string)` in a hot loop

**Difficulty:** Junior+

`mac.Write([]byte(token))` triggers `runtime.stringtoslicebyte` — fresh `[]byte` allocation plus copy on every call. At 1M ops/s the GC fires every 120 ms.

```go
func sign(mac hash.Hash, token string) []byte {
    mac.Reset()
    mac.Write([]byte(token))
    return mac.Sum(nil)
}
```

```
BenchmarkStringToBytes-8   10000000   140 ns/op   96 B/op   2 allocs/op
gc 29 @2.22s 8%: 0.21+18+0.20 ms clock, 52->58->30 MB, 56 MB goal
```

<details><summary>After</summary>

`io.WriteString` dispatches to `hash.Hash`'s `WriteString` method (Go 1.19+) — no conversion. For APIs that only take `[]byte`, reuse a per-goroutine buffer with `append(buf[:0], s...)`.

```go
func sign(mac hash.Hash, token string) []byte {
    mac.Reset()
    io.WriteString(mac, token)
    return mac.Sum(nil)
}
```

```
BenchmarkWriteString-8   80000000   18 ns/op   0 B/op   0 allocs/op
gc 29 @5.40s 1%: 0.08+4+0.18 ms clock, 22->23->14 MB, 28 MB goal
```

~7× faster, zero allocations, GC interval 5× longer, assist negligible.

**Why faster:** `[]byte(s)` always copies in safe Go. `io.WriteString` lets the writer keep the string as-is. Fewer allocations → trigger ratio relaxes → assist drops.

**Trade-off:** A reused buffer pins the largest payload ever seen; cap with `if cap(buf) > maxIdle { buf = nil }`.

**When NOT:** When the byte slice escapes to another goroutine — reuse becomes a race.
</details>

---

## 4. Exercise 3 — `+=` for string concat in a loop

**Difficulty:** Junior+

`s += t` is `s = runtime.concatstring2(s, t)` — fresh allocation each call, O(N²) bytes copied across the loop. The intermediates each survive long enough to be scanned by the next mark phase.

```go
func serialize(fields []string) string {
    result := ""
    for _, f := range fields { result += f + "," }
    return strings.TrimSuffix(result, ",")
}
```

```
BenchmarkStringConcat-8   5000   280000 ns/op   480000 B/op   199 allocs/op
gc 6 @1.00s 12%: 0.40+24+0.22 ms clock, 60->68->32 MB, 64 MB goal
```

Mark-assist 3 ms.

<details><summary>After</summary>

`strings.Builder` writes into one growing `[]byte`, returns it via `unsafe.String` — no copy on `String()`.

```go
func serialize(fields []string) string {
    var b strings.Builder
    b.Grow(estimateSize(fields))
    for i, f := range fields {
        if i > 0 { b.WriteByte(',') }
        b.WriteString(f)
    }
    return b.String()
}
```

```
BenchmarkBuilder-8   500000   3200 ns/op   4096 B/op   1 allocs/op
gc 6 @4.00s 2%: 0.10+6+0.20 ms clock, 30->32->18 MB, 36 MB goal
```

~87× faster, 199× fewer allocations, assist drops to <1 ms.

**Why faster:** Builder grows geometrically — `log2(200) ≈ 8` allocations vs 200. With `Grow`, just one. The dead intermediates in the `+=` version each lived through one mark phase (`runtime/mgcmark.go:scanobject`).

**Trade-off:** Builder isn't safe to share across goroutines. After `String()`, further writes alias into the returned string.

**When NOT:** Single concat. Constant-shape `fmt.Sprintf` for occasional logging.
</details>

---

## 5. Exercise 4 — `make([]byte, n)` per request

**Difficulty:** Middle

A decoder allocates a fresh buffer per message. Average 4 KB, spikes to 64 KB; 50k QPS = ~200 MB/sec of garbage. The 64 KB buffers go through `mheap` (large object path in `runtime/malloc.go:mallocgc`), bypassing per-P caches.

```go
func handleConn(c net.Conn) {
    for {
        var hdr [4]byte
        if _, err := io.ReadFull(c, hdr[:]); err != nil { return }
        n := binary.BigEndian.Uint32(hdr[:])
        buf := make([]byte, n)
        io.ReadFull(c, buf)
        process(buf)
    }
}
```

```
BenchmarkPerReqBuffer-8   20000   62000 ns/op   65536 B/op   1 allocs/op
gc 33 @1.30s 18%: 0.6+38+0.24 ms clock, 124->148->62 MB, 130 MB goal
```

GC every 100 ms, assist 5 ms — mutators pay 5 ms of GC work per cycle.

<details><summary>After</summary>

`sync.Pool` of byte buffers. Per-P pool slots are O(1) reads (`sync/pool.go`), and the pool is auto-drained by `runtime/mgc.go:clearpools` so it can't grow without bound.

```go
var bufPool = sync.Pool{ New: func() any { b := make([]byte, 0, 8192); return &b } }

func getBuf(n int) *[]byte {
    bp := bufPool.Get().(*[]byte)
    if cap(*bp) < n { b := make([]byte, n); return &b }
    *bp = (*bp)[:n]
    return bp
}
func putBuf(bp *[]byte) {
    if cap(*bp) > 1<<20 { return }
    *bp = (*bp)[:0]
    bufPool.Put(bp)
}
```

```
BenchmarkPooledBuffer-8   1000000   1200 ns/op   8 B/op   0 allocs/op
gc 33 @5.40s 3%: 0.12+8+0.20 ms clock, 38->42->22 MB, 44 MB goal
```

~50× faster, GC 6× less frequent, assist drops from 5 ms to ~1 ms.

**Why faster:** Pool hits skip `mallocgc` entirely — they read a per-P `poolLocal` slot. Alloc rate plummets, so the trigger ratio relaxes. Pointers to slices (not slice values) avoid the iface boxing alloc inside `Get`/`Put`.

**Trade-off:** Pool entries clear on each GC cycle — under bursty traffic the pool may be empty right after GC. Pooled buffers must be reset to avoid leaking prior contents. Outlier-cap with `cap(*bp) > 1<<20` to bound memory.

**When NOT:** Buffers that escape to another goroutine with fuzzy lifetime. Bytes retained cross-request. Single-shot CLI tools.
</details>

---

## 6. Exercise 5 — Pointer-heavy struct inflating scan time

**Difficulty:** Middle

A cache entry has 8 `*string` fields (nullable text columns). 5M entries = 40M pointers for `runtime/mgcmark.go:scanobject` to walk each mark phase. The pointer-mask bitmap (`runtime/type.go`'s `gcdata`) determines per-byte whether a slot is a pointer — pointers cost a dereference, scalars skip in O(1).

```go
type Entry struct {
    Title, Description, Author, Source *string
    Tag1, Tag2, Tag3, Tag4 *string
    CreatedAt, UpdatedAt int64
}
var cache = make(map[int64]*Entry, 5_000_000)
```

```
gc 50 @60s 0%: 0.4+220+0.4 ms clock, 480->480->478 MB, 500 MB goal
```

Mark phase 220 ms. CPU time 440 ms across 8 Ps — ~1.5% baseline lost to scanning.

<details><summary>After</summary>

Replace `*string` with `string` for usually-populated fields; for tags use IDs into an intern table (`[4]uint32` — no pointers, skipped in one bitmap step).

```go
type Entry struct {
    Tags      [4]uint32  // tag IDs into intern table — pointer-free
    Title     string     // string header still has data pointer
    Body      string
    CreatedAt int64
    UpdatedAt int64
    NullMask  uint8
}
```

```
gc 50 @60s 0%: 0.4+45+0.4 ms clock, 360->360->358 MB, 380 MB goal
```

Mark phase ~45 ms (~5× faster), heap 25% smaller.

**Why faster:** `scanobject` skips runs of non-pointer fields via the pointer-mask bitmap. 4 pointers per entry × 5M = 20M dereferences eliminated. String headers still hold a data pointer — but field count dropped from 8 string-pointers + 2 strings (10 pointers) to 4 strings + 0 (4 pointers).

**Trade-off:** Intern table adds lookup cost on read. Nullable semantics move to a `NullMask` — easy to forget on write. Empty string is now indistinguishable from "no value" without the mask.

**When NOT:** Small heaps (<100 MB) where mark phase is already milliseconds. Schemas with reflect-driven code that special-cases `*string` for nullability.
</details>

---

## 7. Exercise 6 — Map of pointers when values would do

**Difficulty:** Middle

`map[string]*Metadata` where `Metadata` is a 32-byte struct. Storing pointers costs: extra alloc per insert, every map bucket holds 1 pointer to the metadata + 2 string pointers inside it, and every read indirects.

```go
type Metadata struct {
    SizeBytes, ModTime int64
    Owner, MIME        string
}
var cache = make(map[string]*Metadata, 1_000_000)
```

```
BenchmarkMapOfPointers-8   20000000   62 ns/op   0 B/op   0 allocs/op
gc 12 @30s 0%: 0.4+120+0.4 ms clock, 200->200->198 MB, 220 MB goal
```

<details><summary>After</summary>

Store the value inline. Go map buckets (`runtime/map.go:bmap`) hold values directly when small enough.

```go
var cache = make(map[string]Metadata, 1_000_000)
```

```
BenchmarkMapOfValues-8   30000000   42 ns/op   0 B/op   0 allocs/op
gc 12 @30s 0%: 0.4+90+0.4 ms clock, 180->180->178 MB, 200 MB goal
```

~1.5× faster lookup, mark phase 25% faster.

**Why faster:** Without the `*Metadata` slot, the bucket layout has 1M fewer pointers for `scanobject` to walk. Cache locality also improves: hit lands in the bucket cache line, no remote-heap fetch.

**Trade-off:** Map values are copied on assignment and read. For values >128 bytes the copy cost flips the equation. Mutation of a returned value doesn't update the map (`cache[k].Owner = "x"` is a compile error). Concurrent reads+writes still need a lock or `sync.Map`.

**When NOT:** Large values (>128 B). Values mutated in place by callers. Schemas where the pointer let callers share state.
</details>

---

## 8. Exercise 7 — `[]interface{}` boxing in a hot loop

**Difficulty:** Middle

`append(out, intVal)` where `out` is `[]interface{}` calls `runtime.convT64` — an 8-byte heap object + iface header per int. 1M pushes/sec = 1M tiny allocs/sec.

```go
type Pipeline struct{ out []interface{} }
func (p *Pipeline) Push(v int64) { p.out = append(p.out, v) }
```

```
BenchmarkIfacePush-8   20000000   62 ns/op   16 B/op   1 allocs/op
gc 8 @1.50s 9%: 0.30+22+0.20 ms clock, 56->62->28 MB, 60 MB goal
```

<details><summary>After</summary>

Typed slice. If mixed types are required, generics monomorphize per type.

```go
type Pipeline[T any] struct{ out []T }
func (p *Pipeline[T]) Push(v T) { p.out = append(p.out, v) }
```

```
BenchmarkTypedPush-8   200000000   4 ns/op   0 B/op   0 allocs/op
gc 8 @8.00s 1%: 0.10+5+0.18 ms clock, 28->30->18 MB, 36 MB goal
```

~15× faster, allocations gone except for slice growth, GC interval 5× longer.

**Why faster:** `runtime/iface.go`'s `convT64` allocates a heap word per int. Generics monomorphize the slice into `[]int64`, eliminating the box. The compiler can also emit tight loop code on a primitive slice.

**Trade-off:** Generics inflate binary size per instantiation. `any`-typed APIs read nicely but the cost is real until profiled.

**When NOT:** Genuinely heterogeneous slices (YAML config values). Low call rates where boxing is invisible.
</details>

---

## 9. Exercise 8 — `time.After` in a select loop

**Difficulty:** Middle

`time.After` allocates a fresh `*Timer` and channel each call, plus a runtime timer-heap entry (see `runtime/time.go`). In a select loop firing 10k/s this is 30k allocs/sec.

```go
func worker(ch <-chan Task, timeout time.Duration) {
    for {
        select {
        case t := <-ch: process(t)
        case <-time.After(timeout): heartbeat()
        }
    }
}
```

```
BenchmarkTimeAfter-8   2000000   640 ns/op   192 B/op   3 allocs/op
gc 14 @5.00s 4%: 0.20+14+0.20 ms clock, 40->44->24 MB, 44 MB goal
```

<details><summary>After</summary>

One `*Timer` outside the loop, `Reset` per iteration.

```go
func worker(ch <-chan Task, timeout time.Duration) {
    t := time.NewTimer(timeout)
    defer t.Stop()
    for {
        if !t.Stop() { select { case <-t.C: default: } }
        t.Reset(timeout)
        select {
        case task := <-ch: process(task)
        case <-t.C: heartbeat()
        }
    }
}
```

```
BenchmarkNewTimerReset-8   20000000   60 ns/op   0 B/op   0 allocs/op
gc 14 @20s 0%: 0.10+5+0.18 ms clock, 22->23->16 MB, 32 MB goal
```

~10× faster, zero allocs, GC interval 4× longer.

**Why faster:** The runtime timer (`runtime/time.go`) keeps a per-P heap. New timers insert O(log N); the `*Timer` plus its channel are GC roots until fired or stopped. `Reset` reuses both with an in-place heap update.

**Trade-off:** The drain-on-reset dance is one of Go's gnarliest API edges. Go 1.23 relaxed it (`Reset` is safer post-stop), but the explicit drain stays correct across versions.

**When NOT:** One-shot timeouts. Tests where the timer fires before the goroutine exits.
</details>

---

## 10. Exercise 9 — Reading whole file into memory

**Difficulty:** Junior+

`os.ReadFile` on a 200 MB log: one 200 MB byte allocation + 200 MB string + a `[]string` per line. Mark phase has to scan all line headers; peak RSS ~850 MB.

```go
func countErrors(path string) (int, error) {
    data, _ := os.ReadFile(path)
    lines := strings.Split(string(data), "\n")
    n := 0
    for _, line := range lines {
        if strings.Contains(line, "ERROR") { n++ }
    }
    return n, nil
}
```

```
BenchmarkReadAll-8   50   420000000 ns/op   420000000 B/op   2000001 allocs/op
gc 3 @0.95s 22%: 0.6+200+0.30 ms clock, 420->440->420 MB, 440 MB goal
```

Mark-assist 5 ms; peak RSS ~850 MB.

<details><summary>After</summary>

`bufio.Scanner` streams. `sc.Bytes()` returns a view into the scanner's buffer — no per-line alloc.

```go
func countErrors(path string) (int, error) {
    f, err := os.Open(path)
    if err != nil { return 0, err }
    defer f.Close()
    sc := bufio.NewScanner(f)
    sc.Buffer(make([]byte, 64*1024), 1024*1024)
    n := 0
    for sc.Scan() {
        if bytes.Contains(sc.Bytes(), []byte("ERROR")) { n++ }
    }
    return n, sc.Err()
}
```

```
BenchmarkScanner-8   500   38000000 ns/op   72000 B/op   8 allocs/op
gc 2 @0.04s 1%: 0.10+5+0.20 ms clock, 22->23->18 MB, 32 MB goal
```

~11× faster, ~5800× fewer allocations, peak RSS ~25 MB.

**Why faster:** Streaming caps live bytes. `sc.Bytes()` returns a view, no allocation. The GC never sees a 200 MB live object whose scan dominates a mark phase.

**Trade-off:** `sc.Bytes()` is reused across `Scan()` calls — retaining it across iterations is a bug. Lines beyond `Buffer` cap fail; tune for outliers.

**When NOT:** Small files (<1 MB) where reading-all is simpler. Code needing random line access.
</details>

---

## 11. Exercise 10 — `json.Marshal` building intermediate buffers

**Difficulty:** Middle

`json.Marshal` builds the full output in an internal `bytes.Buffer`, copies to a result `[]byte`, returns. For a 500 KB payload, peak heap ~1 MB (tree + buffer + return).

```go
func writeJSON(w http.ResponseWriter, payload any) {
    data, _ := json.Marshal(payload)
    w.Header().Set("Content-Type", "application/json")
    w.Write(data)
}
```

```
BenchmarkMarshalCopy-8   1000   1200000 ns/op   980000 B/op   2400 allocs/op
gc 18 @2.00s 11%: 0.40+28+0.22 ms clock, 80->110->48 MB, 90 MB goal
```

<details><summary>After</summary>

`json.NewEncoder(w).Encode(payload)` writes directly to the writer. The encoder reuses an internal scratch buffer, bounded by the largest field — not the whole document.

```go
func writeJSON(w http.ResponseWriter, payload any) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(payload)
}
```

```
BenchmarkEncoderDirect-8   3000   400000 ns/op   320000 B/op   1100 allocs/op
gc 18 @5.00s 4%: 0.20+12+0.20 ms clock, 50->58->32 MB, 60 MB goal
```

~3× faster, ~3× fewer allocations, GC interval 2.5× longer.

**Why faster:** No monolithic `[]byte` exists in memory simultaneously with the payload. Peak resident heap drops, and the trigger ratio sees lower allocation pressure per request.

**Trade-off:** `Encode` appends a trailing newline by design. Mid-stream errors leave partial JSON on the writer; buffer if rollback matters.

**When NOT:** Tiny payloads (<4 KB). Code retrying the same payload on transient errors — buffer first.
</details>

---

## 12. Exercise 11 — Per-request closure capture

**Difficulty:** Middle

A closure passed to a callback captures the request-scoped logger. Because the closure escapes through the callback API, `cmd/compile/internal/escape` marks the captured variables heap-allocated.

```go
func handle(req Req, logger *Logger) error {
    return forEachItem(req.Items, func(item Item) error {
        logger.Info("processing", "id", item.ID)
        return process(item)
    })
}
```

```
BenchmarkClosureCapture-8   5000000   240 ns/op   64 B/op   2 allocs/op
gc 22 @3.00s 7%: 0.30+18+0.22 ms clock, 60->68->32 MB, 64 MB goal
```

<details><summary>After</summary>

Pass dependencies through arguments. The function value becomes a static code pointer with no captured environment.

```go
func handle(req Req, logger *Logger) error {
    return forEachItemCtx(logger, req.Items, processOne)
}
func processOne(logger *Logger, item Item) error {
    logger.Info("processing", "id", item.ID)
    return process(item)
}
func forEachItemCtx[C, T any](ctx C, items []T, fn func(C, T) error) error {
    for _, it := range items { if err := fn(ctx, it); err != nil { return err } }
    return nil
}
```

```
BenchmarkPassThrough-8   30000000   36 ns/op   0 B/op   0 allocs/op
gc 22 @12.00s 1%: 0.10+6+0.20 ms clock, 28->30->20 MB, 36 MB goal
```

~6.5× faster, allocations gone, GC interval 4× longer.

**Why faster:** Capture forces the variable onto the heap because the closure escapes the stack. Argument-passing leaves it on the caller's frame. The function value with no captures is one code pointer, not a closure header.

**Trade-off:** Argument-threading deepens parameter lists. Closure form reads slightly tighter for one-off cases.

**When NOT:** Closures over compile-time constants (no escape). APIs you don't own with fixed callback signatures.
</details>

---

## 13. Exercise 12 — Large struct passed by value

**Difficulty:** Middle

`process(cfg Config, item Item)` with a 512-byte `Config` copies 512 bytes per call. In a hot loop over 100k items, `runtime.memmove` dominates the CPU profile.

```go
type Config struct {
    Endpoints  [16]string
    Timeouts   [16]int64
    Flags      uint64
    AuthHeader, UserAgent, Region, Tenant string
}
func process(cfg Config, item Item) error { /* read cfg */ }
```

```
BenchmarkByValue-8   1000000   1100 ns/op   0 B/op   0 allocs/op
```

CPU profile: `runtime.memmove` near the top. GC quiet — but each call frame is huge.

<details><summary>After</summary>

Pass by pointer. The struct stays in one place; the callee gets an 8-byte word.

```go
func process(cfg *Config, item Item) error { /* read cfg.* */ }
```

```
BenchmarkByPointer-8   5000000   220 ns/op   0 B/op   0 allocs/op
```

~5× faster.

**Why faster:** One MOV instead of 64 (a 512-byte memmove is dozens of cycles). Cache locality improves — `*Config` stays in L1 across the batch.

**Trade-off:** Callee can mutate; document immutability. For concurrent hot-reload, `atomic.Pointer[Config]`.

**When NOT:** Small structs (≤16 B) — copy beats indirection. Value semantics matter for the design (each call sees an immutable snapshot).
</details>

---

## 14. Exercise 13 — `append` without capacity hint

**Difficulty:** Junior+

`var ids []int64; for ... { ids = append(ids, x) }` triggers `runtime/slice.go:growslice` 14 times for N=10k — geometric doubling under cap 1024 then ×1.25. Each growth allocates and copies; intermediates become garbage.

```go
func collectIDs(items []Item) []int64 {
    var ids []int64
    for _, it := range items {
        if it.Active { ids = append(ids, it.ID) }
    }
    return ids
}
```

```
BenchmarkAppendNoHint-8   10000   240000 ns/op   420000 B/op   14 allocs/op
gc 10 @2.50s 6%: 0.20+15+0.22 ms clock, 48->54->28 MB, 52 MB goal
```

<details><summary>After</summary>

Pre-size with `make([]T, 0, n)`.

```go
func collectIDs(items []Item) []int64 {
    ids := make([]int64, 0, len(items))
    for _, it := range items {
        if it.Active { ids = append(ids, it.ID) }
    }
    return ids
}
```

```
BenchmarkAppendPresized-8   50000   60000 ns/op   80000 B/op   1 allocs/op
gc 10 @8.00s 2%: 0.10+8+0.20 ms clock, 30->33->20 MB, 36 MB goal
```

~4× faster, 14× fewer allocations, GC interval 3× longer.

**Why faster:** One alloc instead of 14. Total bytes copied during growth is ~2× the final size; pre-allocation skips it. Even with a loose upper bound (50% fill rate), one oversize allocation beats 14 growths.

**Trade-off:** Overestimate wastes memory in the returned slice. `slices.Clip` trims excess at the cost of one copy.

**When NOT:** N small (<32) — growth is once and cheap. N unboundable.
</details>

---

## 15. Exercise 14 — `defer` in a hot loop

**Difficulty:** Middle

`for _, it := range items { ... defer close(it) ... }` accumulates defer records (`runtime/runtime2.go:_defer`) on the heap — one per iteration — and they all run at function return, exhausting file descriptors meanwhile. Pre-1.14 defer was open-coded only at function scope; inside a loop it's not.

```go
func processAll(items []Item) error {
    for _, it := range items {
        r, err := open(it)
        if err != nil { return err }
        defer r.Close()  // accumulates!
        if err := process(r); err != nil { return err }
    }
    return nil
}
```

```
BenchmarkDeferInLoop-8   10000   320000 ns/op   480000 B/op   10000 allocs/op
gc 14 @2.00s 8%: 0.30+22+0.22 ms clock, 56->64->32 MB, 60 MB goal
```

<details><summary>After</summary>

Restructure: per-item defer in a helper function. The compiler open-codes defers in single-statement functions (≤8 defers, no recursion).

```go
func processOne(it Item) error {
    r, err := open(it)
    if err != nil { return err }
    defer r.Close()  // open-coded, no heap record
    return process(r)
}
func processAll(items []Item) error {
    for _, it := range items {
        if err := processOne(it); err != nil { return err }
    }
    return nil
}
```

```
BenchmarkDeferOpenCoded-8   1000000   3200 ns/op   0 B/op   0 allocs/op
gc 14 @20s 0%: 0.10+5+0.20 ms clock, 24->26->18 MB, 36 MB goal
```

~100× faster, zero allocations, resources close promptly.

**Why faster:** Open-coded defer (Go 1.14+) compiles into inline epilogue code at function exit — no heap record. Per-iteration close also bounds the live FD set.

**Trade-off:** Restructuring requires a helper function. `Close` errors are normally swallowed; use a named return + deferred wrapper if you need them.

**When NOT:** When the loop body genuinely needs all resources open across iterations (very rare — usually a design smell).
</details>

---

## 16. Exercise 15 — `errors.New` per call

**Difficulty:** Junior+

`errors.New("invalid")` allocates an `*errorString` on the heap each call. At 100k QPS × 1% rejection = 1k error allocs/sec.

```go
func validate(in Input) error {
    if in.Name == "" { return errors.New("name required") }
    if in.Age < 0 { return errors.New("age must be non-negative") }
    return nil
}
```

```
BenchmarkErrorsNew-8   50000000   24 ns/op   16 B/op   1 allocs/op
gc 8 @5.00s 1%: 0.10+6+0.20 ms clock, 26->28->18 MB, 36 MB goal
```

<details><summary>After</summary>

Package-level sentinel — one allocation at init.

```go
var (
    ErrNameRequired = errors.New("validate: name required")
    ErrNegativeAge  = errors.New("validate: age must be non-negative")
)
func validate(in Input) error {
    if in.Name == "" { return ErrNameRequired }
    if in.Age < 0 { return ErrNegativeAge }
    return nil
}
```

```
BenchmarkSentinelErr-8   1000000000   1.8 ns/op   0 B/op   0 allocs/op
gc 8 @30s 0%: 0.08+4+0.18 ms clock, 20->21->16 MB, 32 MB goal
```

~13× faster, zero allocations, GC interval 6× longer.

**Why faster:** Sentinel is a static `*errorString`. Returning it copies a two-word iface header. `errors.New` always allocates. Bonus: `errors.Is(err, ErrNameRequired)` becomes a pointer compare.

**Trade-off:** Sentinel messages can't carry per-call context. Wrap with `fmt.Errorf("got %d: %w", val, ErrSentinel)` only when the value matters — that wrap still allocates, but only on the path that needs it.

**When NOT:** Errors carrying genuine per-call structured data (validation field list). Cold paths where readability beats nanoseconds.
</details>

---

## 17. When NOT to optimize

GC pressure dominates a profile only when (a) allocation rate × live-set triggers GC frequently and (b) mark-assist or STW contributes meaningfully to your latency budget. A CLI tool allocating 100 MB once at startup pays one GC; nothing here helps.

**Profile first.** GC overhead has four signatures in CPU and `gctrace` output:

- `runtime.mallocgc` near top of CPU profile → Ex. 1, 4, 5, 10, 13 (eliminate allocations).
- `runtime.gcAssistAlloc` rising assist times in `gctrace` → Ex. 2, 4, 13 (cut alloc rate).
- `runtime.scanobject` dominating mark phase → Ex. 5, 6 (reduce pointer slots).
- Short GC interval in `gctrace` despite small live set → high allocation rate, see Ex. 1–4.

**Common premature optimizations:** `sync.Pool` (Ex. 4) for once-per-minute allocs; hand-unrolled keys (Ex. 1) on 1k-QPS endpoints; pre-sized slices (Ex. 13) for N=3; flattening `*string` (Ex. 5) on a struct with 10 instances total.

**Correctness gaps disguised as optimizations:** pool of buffers (Ex. 4) without `Reset` — next caller sees previous payload; reused timer (Ex. 8) without drain — phantom fires; map of values (Ex. 6) where callers mutated the returned struct expecting it to update the map; `bufio.Scanner` slice retained across iterations (Ex. 9) — buffer overwrites; defer moved into a helper (Ex. 14) silently swallowing `Close` errors; sentinel errors (Ex. 15) where two call sites needed distinguishable messages; pointer-field removal (Ex. 5) where `nil` semantically meant "absent" — null vs zero confusion.

**GC tuning escape hatches.** When code-level fixes are exhausted: `GOMEMLIMIT` (Go 1.19+) caps total runtime memory, triggering GCs sooner to avoid OOM; `GOGC=200` doubles heap-growth target, trading memory for CPU; `runtime/debug.SetGCPercent` for hot-reconfigure. Read `runtime/mgcpacer.go` for the pacing math behind `gctrace` lines.

---

## 18. Summary

**Always-ship wins** (apply by default in any hot-path code):

- `strconv.AppendInt` over `fmt.Sprintf` for numeric keys (Ex. 1).
- `io.WriteString` / `append(buf[:0], s...)` over `[]byte(s)` in tight loops (Ex. 2).
- `strings.Builder` over `+=` for concat (Ex. 3).
- `bufio.Scanner` for line-oriented file processing (Ex. 9).
- `json.NewEncoder(w).Encode` for response writers (Ex. 10).
- Pass dependencies through arguments, not closures, in hot callbacks (Ex. 11).
- Pre-size slices with `make([]T, 0, n)` when N is bounded (Ex. 13).
- Package-level sentinel errors for hot-path rejection (Ex. 15).
- Restructure to keep `defer` out of hot loops (Ex. 14).
- Reuse `time.Timer` with `Reset` in worker loops (Ex. 8).

**Wins behind a profile** (when measurements justify them):

- `sync.Pool` of byte buffers when alloc rate is documented (Ex. 4).
- Map of values over map of pointers for read-mostly small structs (Ex. 7).
- Generics/typed slices over `[]interface{}` boxing (Ex. 8).
- Pointer pass for large structs (Ex. 12).
- Flatten pointer-heavy structs in large caches (Ex. 5/6).

**Specialty** (only when the design calls for it):

- Custom arena per request for batch parsers with millions of small objects.
- String interning to fold repeated text into IDs.
- `GOMEMLIMIT` + `GOGC` tuning for steady-state services with predictable working set.
- `runtime.SetFinalizer` — avoid unless wrapping CGo handles; finalizers extend lifetimes across two GC cycles.
- `unsafe.String` / `unsafe.SliceData` for zero-copy at boundaries where lifetime is provable.

GC pressure on the hot path comes from four mechanics living in `runtime/mgc.go` and friends: every allocation moves the heap closer to the next trigger (`gcSetTriggerRatio`); every live pointer in a marked object costs `scanobject` time; sustained alloc rate forces mark-assist onto mutator goroutines (`gcAssistAlloc`); short-lived garbage that escapes a cycle inflates the next sweep. Strip allocations from the hot path, flatten pointer-heavy structs that live in big caches, pool the unavoidable churn, and the four mechanics quiet down together. Profile, then apply the lever the trace points to — the four signatures above tell you which one.
