# Struct Memory Layout — Find the Bug

A collection of realistic Go struct-layout bugs. For each: the symptom, the (often subtle) cause, and the fix. Reading them in order builds the intuition you need to diagnose layout issues in production — from 32-bit atomic crashes to silent 50 % memory bloat to false-sharing pathologies.

---

## Bug 1: The 32-bit atomic that segfaulted in production

```go
package main

import (
    "sync/atomic"
)

type Stats struct {
    Enabled bool
    Count   uint64
}

var s Stats

func bump() {
    atomic.AddUint64(&s.Count, 1)
}
```

**Symptom.** Works perfectly in dev (amd64 laptop). Deployed to a fleet that includes some 32-bit ARM IoT gateways. On those, the process segfaults the first time `bump()` runs. Crash log: `SIGBUS: invalid address alignment`.

**Cause.** On 32-bit ARM, `int64`/`uint64` fields inside a struct have `FieldAlign = 4` (not 8). So `s.Count` lives at offset 4 (after `Enabled` at offset 0 and 3 bytes of pad), which is 4-byte aligned but **not 8-byte aligned**. The `LDREXD`/`STREXD` atomic instruction pair on 32-bit ARM requires 8-byte alignment. Misalignment traps.

**Fix.** Three options.

**Fix A** — put the atomic field first:

```go
type Stats struct {
    Count   uint64  // offset 0: heap allocations guarantee 8-byte alignment of first field
    Enabled bool
}
```

**Fix B** (preferred since Go 1.19) — use the typed atomic:

```go
type Stats struct {
    Enabled bool
    Count   atomic.Uint64  // self-aligns regardless of position
}

func bump() {
    s.Count.Add(1)
}
```

**Fix C** — explicit padding:

```go
type Stats struct {
    Enabled bool
    _       [7]byte
    Count   uint64  // offset 8, manually aligned
}
```

Pick B. It works everywhere and survives future field additions.

---

## Bug 2: The 24-byte struct that should have been 16

```go
type SessionToken struct {
    Valid     bool
    ExpiresAt int64
    Revoked   bool
}

tokens := make([]SessionToken, 5_000_000)
```

**Symptom.** Heap inflates by 120 MiB when `tokens` is allocated. Engineer expected 80 MiB (5M × 16 bytes), got 120 MiB.

**Cause.** Layout walk:

| Offset | Field | Size |
|--------|-------|------|
| 0 | Valid (1) | 1 |
| 1–7 | pad | 7 |
| 8 | ExpiresAt (8) | 8 |
| 16 | Revoked (1) | 1 |
| 17–23 | trailing pad | 7 |

24 bytes per struct, not 16. Across 5M entries: 24 × 5M = 120 MiB. The 50 % overhead is **all padding**.

**Fix.** Reorder large→small:

```go
type SessionToken struct {
    ExpiresAt int64
    Valid     bool
    Revoked   bool
}
```

New layout:

| Offset | Field |
|--------|-------|
| 0 | ExpiresAt (8) |
| 8 | Valid (1) |
| 9 | Revoked (1) |
| 10–15 | trailing pad (6) |

16 bytes per struct. Total: 80 MiB. Save 40 MiB.

`fieldalignment` would have caught this immediately. Add to CI.

---

## Bug 3: The counter that scaled negatively

```go
type ConnStats struct {
    Connected     atomic.Uint64
    Disconnected  atomic.Uint64
    Errors        atomic.Uint64
    TotalBytesIn  atomic.Uint64
    TotalBytesOut atomic.Uint64
}

var stats ConnStats

// Goroutine per connection, hundreds of goroutines updating stats.
func onPacket(n int) {
    stats.TotalBytesIn.Add(uint64(n))
}
```

**Symptom.** Throughput **decreases** as goroutine count grows. 1 worker: 200 K ops/s. 8 workers: 60 K ops/s.

**Cause.** All five `atomic.Uint64` fields fit in one 64-byte cache line. Multiple CPUs writing to different fields ping-pong the line between L1 caches. Every write invalidates other cores' copies. Result: false sharing pathology.

**Fix.** Pad each contended counter to its own cache line.

```go
type paddedU64 struct {
    v atomic.Uint64
    _ [56]byte  // 64 - 8
}

type ConnStats struct {
    Connected     paddedU64
    Disconnected  paddedU64
    Errors        paddedU64
    TotalBytesIn  paddedU64
    TotalBytesOut paddedU64
}

func onPacket(n int) {
    stats.TotalBytesIn.v.Add(uint64(n))
}
```

After the fix at 8 workers: 1.4 M ops/s — 23× improvement on the same hardware.

Note: pad to 128 bytes for Apple Silicon CPUs (their cache line is 128B, not 64B). For portable code:

```go
const cacheLine = 128  // safe upper bound

type paddedU64 struct {
    v atomic.Uint64
    _ [cacheLine - 8]byte
}
```

---

## Bug 4: The trailing zero-sized field that wasted 8 bytes

```go
type Marker struct{}

type Event struct {
    Timestamp int64
    UserID    int64
    _         Marker  // "type-level marker for compile-time discrimination"
}

events := make([]Event, 10_000_000)
```

**Symptom.** Heap usage 160 MiB. Expected 160 MiB (10M × 16). But adding a field elsewhere caused the struct to balloon unpredictably.

**Cause.** The non-zero struct's last field is zero-sized — the compiler adds **1 byte of padding** to prevent past-end pointers. After that, the struct's size is rounded up to the alignment of its largest field (8). So:

| Offset | Field | Size |
|--------|-------|------|
| 0 | Timestamp (8) | 8 |
| 8 | UserID (8) | 8 |
| 16 | Marker (0) | 0 |
| 17–23 | last-field rule pad + trailing pad | 7 (becomes 8 with rounding) |

Sizeof = 24 (not 16). Across 10M: 240 MiB, not 160 MiB.

**Fix.** Move the marker to a non-last position, or remove it:

```go
type Event struct {
    _         Marker  // not last; no extra padding
    Timestamp int64
    UserID    int64
}
// Sizeof = 16
```

Or drop the marker entirely (markers are an antipattern in Go — use a typed wrapper or method instead). After fix: 160 MiB, as expected. 80 MiB saved.

---

## Bug 5: The `time.Time` field that doubled memory

```go
type LogEntry struct {
    Level     int
    Timestamp time.Time
    Message   string
}

entries := make([]LogEntry, 2_000_000)
```

**Symptom.** Heap usage ~110 MiB. Engineer estimated ~56 MiB based on rough math.

**Cause.** `time.Time` is **24 bytes** (`(wall uint64, ext int64, loc *Location)`), not 8. Plus alignment:

| Offset | Field | Size |
|--------|-------|------|
| 0 | Level (8) | 8 |
| 8 | Timestamp (24) | 24 |
| 32 | Message (16) | 16 |

Sizeof = 48 (not 24 or 32). 2M × 48 = 96 MiB just for the struct headers; plus the Message strings' backing bytes adds more.

**Fix.** If timezone and monotonic clock aren't needed, replace with `int64` Unix nanos:

```go
type LogEntry struct {
    Level         int
    TimestampNano int64
    Message       string
}
// Sizeof = 32
```

Save 16 bytes per entry. 2M × 16 = 32 MiB saved. Plus the GC no longer scans through `Location` pointers. Reconstruct `time.Time` on demand:

```go
ts := time.Unix(0, entry.TimestampNano)
```

For most logging use cases this is the right choice. Keep `time.Time` only when timezone or wall/monotonic distinction is needed.

---

## Bug 6: The embedded struct's hidden internal padding

```go
type Header struct {
    Flag bool
    Size int64
}
// Sizeof(Header) = 16: 1 + 7 pad + 8

type Packet struct {
    H    Header
    Type byte
    Code byte
}

packets := make([]Packet, 1_000_000)
```

**Symptom.** Heap usage 24 MiB. Expected 18 MiB (estimated 16 + 1 + 1 = 18, rounded to 24 for alignment).

**Cause.** Embedded `Header` is **not flattened**. Its internal padding remains. The Packet layout:

| Offset | Field | Size |
|--------|-------|------|
| 0 | H.Flag (1) | 1 |
| 1–7 | pad (inside H) | 7 |
| 8 | H.Size (8) | 8 |
| 16 | Type (1) | 1 |
| 17 | Code (1) | 1 |
| 18–23 | trailing pad | 6 |

Sizeof = 24, of which 13 are padding (more than half). The 7 bytes of internal Header padding are unreachable from outside Packet.

**Fix.** Flatten the fields:

```go
type Packet struct {
    Size int64  // 8
    Flag bool   // 1
    Type byte   // 1
    Code byte   // 1
}
// Sizeof = 16: 8 + 1 + 1 + 1 + 5 trailing pad
```

Saved 8 bytes per packet; 8 MiB across 1M packets. Cost: you lose the `Header` abstraction. Whether that's acceptable depends on how Header is used elsewhere — flattening is a refactor, not a free transform.

---

## Bug 7: The "bool array" that ate 8× too much memory

```go
type FeatureFlags struct {
    A, B, C, D, E, F, G, H, I, J bool
}

flags := make([]FeatureFlags, 1_000_000)
```

**Symptom.** Allocates ~16 MiB. Engineer expected 1.25 MiB (10 bits × 1M / 8).

**Cause.** Each `bool` is **one byte** in Go, not one bit. Plus, the struct has trailing pad to its alignment (1 for bools → no trailing pad needed):

| Offset | Field |
|--------|-------|
| 0–9 | A..J (10 bytes) |
| 10–15 | trailing pad (6 bytes for 8-byte align? No — struct align is 1) |

Actually: alignment of bool is 1, so struct alignment is 1, no trailing pad. Sizeof = 10. But 10 doesn't divide 8 evenly so the array `[1M]FeatureFlags` packs 10 bytes per element = **10 MiB**, not 16.

Wait — recomputing. With 10 bool fields, alignment is 1, size is 10. So 1M × 10 = 10 MiB. Still 8× the bitfield approach.

**Fix.** Pack into a bitfield:

```go
type FeatureFlags struct {
    bits uint16  // 2 bytes; supports up to 16 flags
}

const (
    FlagA = 1 << iota
    FlagB
    FlagC
    // ...
    FlagJ
)

func (f *FeatureFlags) Set(bit uint16)        { f.bits |= bit }
func (f *FeatureFlags) Clear(bit uint16)      { f.bits &^= bit }
func (f *FeatureFlags) Has(bit uint16) bool   { return f.bits&bit != 0 }
```

Sizeof = 2. Across 1M = 2 MiB. Saved 8 MiB. Cost: bit-twiddling boilerplate.

---

## Bug 8: The map field that "didn't count"

```go
type UserCache struct {
    LastSeen int64
    Settings map[string]string
}

caches := make([]UserCache, 100_000)
for i := range caches {
    caches[i].Settings = map[string]string{"theme": "dark"}
}
```

**Symptom.** `unsafe.Sizeof(UserCache{})` returns 16, but `runtime.MemStats.HeapAlloc` after allocating 100 K of them shows 60+ MiB. Engineer thought it should be 1.6 MiB.

**Cause.** `unsafe.Sizeof` of a map field is **8 bytes** — the pointer to `runtime.hmap`. The actual map (the hmap struct, the buckets, the keys, the values) lives **behind** the pointer and is NOT included in `Sizeof`. Each `map[string]string{"theme": "dark"}` allocates ~200 bytes minimum for the hmap + bucket + bucket overflow + string headers + string bytes.

100 K maps × ~600 bytes each = 60 MiB. The struct itself is fine; the maps it points to are heavy.

**Fix.** Two options. **Option A**: if the per-cache settings are small and known-bounded, use a fixed array:

```go
type UserCache struct {
    LastSeen int64
    Theme    string  // just the one setting we actually use
}
```

**Option B**: lazily allocate the map only when needed:

```go
type UserCache struct {
    LastSeen int64
    settings *map[string]string  // pointer; nil until first write
}

func (c *UserCache) SetSetting(k, v string) {
    if c.settings == nil {
        m := make(map[string]string)
        c.settings = &m
    }
    (*c.settings)[k] = v
}
```

Most caches stay at LastSeen-only and don't allocate the map.

The general lesson: `unsafe.Sizeof` of a struct with pointer/slice/map fields tells you only the **header cost**, not the total reachable memory.

---

## Bug 9: The `[]any` slice that performed terribly

```go
type Event struct {
    Name string
    Tags []any
}

func handle(e Event) {
    for _, t := range e.Tags {
        process(t)
    }
}
```

**Symptom.** `Event` looks small (`Sizeof = 40`: 16 string + 24 slice). But CPU profile shows 30 % of time in `runtime.convT64` and `runtime.mallocgc`.

**Cause.** Every value stored in `[]any` is **boxed** if it's not already a pointer-shaped type. `e.Tags = append(e.Tags, 42)` triggers `runtime.convT64` to allocate a heap word holding the int. Each `any` slot is 16 bytes (type + value pointers). Plus a tiny heap allocation per non-pointer value.

For 10 tags per event × 1M events/sec: 10 M heap allocations per second just to box integers. GC pressure explodes.

**Fix.** Use a concrete type:

```go
type Event struct {
    Name string
    Tags []int
}
```

Or, if tag types genuinely vary, use a sum-type-like pattern:

```go
type Tag struct {
    Kind uint8
    Int  int64
    Str  string
}
```

24 bytes per Tag (with padding) but zero allocations per assignment, and no `runtime.convT*` overhead.

`any` (`interface{}`) is convenient and expensive. For hot paths, eliminate it.

---

## Bug 10: The wire-format struct that broke after a Go upgrade

```go
type WireFrame struct {
    Magic   uint32
    Version uint16
    Length  uint32
    Body    [256]byte
}

// Sent to peer via UnixConn.Write(unsafe.Slice(...))
```

**Symptom.** Peer can't parse frames. Field offsets shifted. Yet no source code changed; the only change was upgrading from Go 1.21 to Go 1.22.

**Cause.** Reading the bytes via `(*WireFrame)(unsafe.Pointer(&buf[0]))` assumes a specific layout. Layout-wise the struct is:

| Offset | Field | Why |
|--------|-------|-----|
| 0 | Magic (4) | 4 |
| 4 | Version (2) | 2 |
| 6 | pad (2) | Length needs align 4 |
| 8 | Length (4) | 4 |
| 12 | Body (256) | 4-byte aligned, no extra pad |

Total = 268 (rounded up to 4-byte align = 268).

The Go version upgrade didn't actually change layout — but a peer running on a 32-bit platform interprets `Length` at offset 8, while another on a different toolchain with explicit packing pragmas interprets it at offset 6. The wire format was never deterministic; the Go upgrade just exposed the latent disagreement.

**Fix.** Never use struct layout for wire formats. Marshal/unmarshal byte-by-byte:

```go
func (f *WireFrame) MarshalBinary() []byte {
    buf := make([]byte, 4+2+4+256)
    binary.LittleEndian.PutUint32(buf[0:], f.Magic)
    binary.LittleEndian.PutUint16(buf[4:], f.Version)
    binary.LittleEndian.PutUint32(buf[6:], f.Length)
    copy(buf[10:], f.Body[:])
    return buf
}
```

Now the byte layout is in code, not in the struct, and is independent of Go version, architecture, and compiler choices. Add a test that asserts the marshalled bytes against a golden file.

---

## Bug 11: The huge struct on the stack that caused stack copy storms

```go
type Buffer struct {
    data [128 * 1024]byte  // 128 KiB inline
    next *Buffer
    prev *Buffer
}

func process() {
    var b Buffer  // stack-allocated if escape analysis allows
    populate(&b)
    use(&b)
}
```

**Symptom.** A high-rate handler shows long GC pauses and stack-growth events in `runtime/trace`. Each call to `process()` allocates 128 KiB on the goroutine stack, triggering frequent stack growths.

**Cause.** The default goroutine stack is 8 KiB. The Go runtime grows it dynamically by copying the entire stack to a larger one, fixing all pointer references. A 128 KiB local variable forces a stack growth on every call. Growth is amortized but visible.

**Fix.** Heap-allocate large buffers explicitly:

```go
func process() {
    b := new(Buffer)  // heap-allocated, no stack copy
    populate(b)
    use(b)
}
```

`new(Buffer)` allocates on the heap (or stack if escape analysis proves it doesn't escape; for a 128 KiB struct, the runtime is biased toward heap). No stack growth.

Better: rethink the design. A 128 KiB inline buffer per struct is almost always wrong; use a slice (`make([]byte, 128*1024)`) and a pool (`sync.Pool`) to reuse buffers.

---

## Bug 12: The struct with mixed pointer/non-pointer fields that doubled GC time

```go
type Record struct {
    ID         int64
    Tags       []string
    Score      float64
    Metadata   map[string]any
    Created    time.Time
    UpdatedAt  time.Time
    Owner      string
    AuxBuffer  [4096]byte  // big inline buffer
    Children   []*Record
}

records := make([]Record, 500_000)
```

**Symptom.** GC pause time jumps from 1 ms to 8 ms once `records` is populated. `pprof -alloc_space` doesn't show new allocations — the data is already there.

**Cause.** The `Record` struct is huge (~4.2 KB each). The GC's mark phase must scan the entire pointer-bytes region of each struct. The pointer fields (`Tags`, `Metadata`, `Children`, `Owner`) are scattered throughout the struct — placed after the 4 KiB `AuxBuffer`, meaning the GC's `PtrBytes` for `Record` extends past offset 4096+ to include `Children`.

Per the runtime: `PtrBytes` is the offset of the last pointer-containing word + word size. With `Children` at the end and `AuxBuffer` in between, `PtrBytes` ≈ struct size ≈ 4200 bytes. The GC traverses the metadata bitmap word by word for those 4200 bytes per record — across 500 K records, that's significant time.

**Fix.** Cluster pointer fields at the start; move the big inline buffer to the end (or out-of-band):

```go
type Record struct {
    Tags       []string             // pointer
    Metadata   map[string]any       // pointer
    Owner      string               // pointer
    Children   []*Record            // pointer
    ID         int64
    Score      float64
    Created    time.Time            // contains a *Location
    UpdatedAt  time.Time            // contains a *Location
    AuxBuffer  [4096]byte           // moved to end
}
```

Now `PtrBytes` is the offset of the last pointer-containing field, which is `Children` near the top. The GC scans only a small prefix and skips the 4 KiB buffer tail. Pause time drops back to 1.5 ms.

Better: move `AuxBuffer` out:

```go
type Record struct {
    Tags     []string
    // ...
    Aux      *[4096]byte  // pointer; one allocation; GC just scans the pointer
}
```

---

## Bug 13: The slice of structs that wouldn't shrink

```go
type Job struct {
    ID       string
    Payload  []byte
    Priority int
}

queue := make([]Job, 0, 1_000_000)
// ... add and remove many jobs ...
queue = queue[:0]  // logical reset
runtime.GC()
// Yet HeapAlloc doesn't drop
```

**Symptom.** Even after `queue = queue[:0]` and `runtime.GC()`, the heap doesn't return the memory.

**Cause.** Two issues:

1. `queue[:0]` only zeroes the length; the **underlying array** is still 1M Job-sized slots, allocated and reachable through the slice header.
2. Each `Job` contains a `Payload []byte` whose backing array was also allocated and is still referenced (until the Job slot is overwritten).

The runtime never gives memory back to the OS in this situation; it only stops scanning the cleared regions. Even worse, the next `append` will reuse the array — but only after re-zeroing the slots, which costs CPU.

**Fix.** To actually release the memory:

```go
queue = nil  // drops the slice header; the array becomes unreachable
runtime.GC()
debug.FreeOSMemory()  // hint to release pages to the OS
```

Or, for a queue you'll reuse, explicitly zero the Job fields to break pointer references:

```go
for i := range queue {
    queue[i] = Job{}  // explicitly clear pointers to release Payload backing arrays
}
queue = queue[:0]
```

This breaks references to all `Payload` backing arrays, letting the GC collect them.

The general layout lesson: slices of structs with pointer fields keep those pointers reachable for as long as the underlying array is allocated. Length reset isn't enough; you must zero or replace the elements.

---

## Bug 14: The cgo struct mismatch

```go
// #include "thing.h"
// struct Thing { uint8_t flag; uint64_t count; };
import "C"

type GoThing struct {
    Flag  byte
    Count uint64
}

func sendToC(t GoThing) {
    C.process(unsafe.Pointer(&t))
}
```

**Symptom.** On 64-bit Linux, `C.process` reads the correct values. On 32-bit ARM Linux, the values are garbled — `count` reads as the low 32 bits of garbage.

**Cause.** The C compiler on 32-bit Linux pads `struct Thing` differently than the Go compiler:

- C: `Flag` at offset 0, pad to 4 bytes, `count` at offset 4 (C aligns uint64_t to 4 in structs on 32-bit Linux).
- Go: `Flag` at offset 0, pad to 4 bytes, `Count` at offset 4 (FieldAlign(uint64) = 4 on 32-bit).

Wait — actually they agree on 32-bit. Recheck 64-bit:

- C: `Flag` at 0, 7 bytes pad, `count` at 8.
- Go: `Flag` at 0, 7 bytes pad, `Count` at 8.

They agree on 64-bit too. So where's the bug? Look closer: on macOS amd64, C aligns `uint64_t` to 8 in structs. On Linux 32-bit i386, C aligns `uint64_t` to **4**. Go on 32-bit i386 also uses FieldAlign=4. They agree.

The actual bug: when **calling** C through cgo with an `unsafe.Pointer` to a Go struct, you're passing a pointer to a stack-allocated Go value. C can read the bytes — but if C **retains** the pointer past the call (stores it in a global), the Go runtime may move the value (stack growth, GC compaction in future versions), invalidating the C-side pointer.

**Fix.** Never pass long-lived `&goStruct` pointers to C. Either:

1. Marshal the Go struct into a `C.struct_Thing` and pass that.
2. Use `runtime.Pinner` (Go 1.21+) to pin the Go value for the duration:

```go
var pinner runtime.Pinner
defer pinner.Unpin()
pinner.Pin(&t)
C.processWithRetain(unsafe.Pointer(&t))
```

And always verify layouts agree:

```go
func init() {
    if unsafe.Sizeof(GoThing{}) != C.sizeof_struct_Thing {
        panic("Go/C struct size mismatch")
    }
}
```

---

## 15. Summary

Go struct-layout bugs cluster around five themes: **32-bit alignment** for atomics (Bug 1), **forgotten padding** that inflates allocations (Bugs 2, 4, 5, 6, 7), **false sharing** on hot atomics (Bug 3), **invisible memory behind pointer fields** (Bugs 8, 9, 13), and **layout-as-wire-format** assumptions that drift (Bugs 10, 14). Plus two adjacent concerns: stack vs heap for large structs (Bug 11) and GC scan cost for pointer-heavy structs (Bug 12). Recognizing the shape of each — "this struct allocates millions of times, what's the per-instance padding?", "this counter is contended, what cache line is it on?", "this `Sizeof` looks small but the heap is huge, what's behind the pointers?" — is most of the debugging.

---

## Further reading

- `sync/atomic` 32-bit alignment: https://pkg.go.dev/sync/atomic#pkg-note-BUG
- `fieldalignment` analyzer: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/fieldalignment
- False sharing in Go (talk): https://www.youtube.com/results?search_query=false+sharing+go
- `runtime.Pinner` (Go 1.21+): https://pkg.go.dev/runtime#Pinner
- Cgo and Go pointer rules: https://pkg.go.dev/cmd/cgo#hdr-Passing_pointers
- Go FAQ on struct size: https://go.dev/doc/faq#size_of_struct
