# Map Internals — Specification

> Author: Bakhodir Yashin Mansur
>
> **Focus.** Precise reference for the Go runtime's hashmap implementation. Field-by-field layout of `hmap` and `bmap`, runtime function signatures, tuning constants, type-specific fast paths, the Swiss-table redesign for Go 1.24+, and a version history of changes.
>
> **Sources.**
> - `runtime/map.go`: https://github.com/golang/go/blob/master/src/runtime/map.go
> - `runtime/map_fast32.go` / `_fast64.go` / `_faststr.go`: https://github.com/golang/go/tree/master/src/runtime
> - Go spec, map types: https://go.dev/ref/spec#Map_types
> - Swiss-table proposal #54766: https://github.com/golang/go/issues/54766
> - `pkg.go.dev` reference for `sync.Map`: https://pkg.go.dev/sync#Map

---

## 1. The map type at language level

```
MapType = "map" "[" KeyType "]" ElementType .
```

Semantic rules (Go spec):

- The key type must be **comparable** (every type whose `==` is defined: booleans, numerics, strings, pointers, channels, interfaces, arrays of comparables, structs of comparables).
- Slice, map, and function types are not comparable; therefore not valid as keys.
- The zero value of a map is `nil`. Reads from a nil map return the zero value of the element type. Writes to a nil map panic with `assignment to entry in nil map`.
- `make(map[K]V, n)` allocates a non-nil empty map sized for ~`n` entries.
- Index expressions `m[k]` are **not addressable**.

The spec deliberately avoids specifying the implementation. The rest of this file documents the current runtime.

---

## 2. `hmap` struct (Go ≤ 1.23 backend)

`runtime/map.go`:

```go
type hmap struct {
    count     int            // number of live key/value pairs
    flags     uint8          // bitfield: iterator | oldIterator | hashWriting | sameSizeGrow
    B         uint8          // log_2 of the number of main buckets (2^B)
    noverflow uint16         // approximate count of overflow buckets in use
    hash0     uint32         // per-map random hash seed

    buckets    unsafe.Pointer // pointer to 2^B `bmap`s; nil before first insert when B==0
    oldbuckets unsafe.Pointer // previous bucket array (half-size) during incremental grow
    nevacuate  uintptr        // next old bucket to evacuate; counter

    extra *mapextra          // overflow tracking; preallocated next overflow bucket
}

type mapextra struct {
    overflow     *[]*bmap    // pinned overflow buckets in `buckets` with pointer-bearing keys/values
    oldoverflow  *[]*bmap    // same for `oldbuckets`
    nextOverflow *bmap       // next preallocated overflow bucket; nil when exhausted
}
```

Sizes on amd64 (64-bit):

| Field | Bytes |
|-------|-------|
| count | 8 |
| flags + B + noverflow | 4 (with 1 byte padding) |
| hash0 | 4 |
| buckets, oldbuckets | 16 |
| nevacuate | 8 |
| extra | 8 |
| **Total** | **48** |

---

## 3. `bmap` struct — the physical bucket

The declared type in source is a stub:

```go
type bmap struct {
    tophash [bucketCnt]uint8   // bucketCnt = 8
}
```

The compiler emits a *synthetic* version per map type:

```
bmap_K_V {
    tophash  [8]uint8
    keys     [8]K        // padded to K's alignment
    elems    [8]V        // padded to V's alignment
    overflow *bmap_K_V
}
```

| Slot | Notes |
|------|-------|
| `tophash[i]` | Top byte of key hash, or a sentinel: see table below. |
| `keys[i]` | The key, or `*K` if `t.indirectkey()` (K size > `maxKeySize = 128`). |
| `elems[i]` | The value, or `*V` if `t.indirectelem()` (V size > `maxElemSize = 128`). |
| `overflow` | `*bmap` to the chain's next bucket, or `nil`. |

Sentinel tophash values:

| Constant | Value | Meaning |
|----------|-------|---------|
| `emptyRest` | 0 | Slot is empty *and* all subsequent slots/overflow buckets are also empty. Lookup may stop. |
| `emptyOne` | 1 | Slot is empty (tombstone). Lookup continues. |
| `evacuatedX` | 2 | Slot was migrated to the low destination of a doubling grow. |
| `evacuatedY` | 3 | Slot was migrated to the high destination of a doubling grow. |
| `evacuatedEmpty` | 4 | Slot was empty when the bucket was evacuated. |
| `minTopHash` | 5 | All hash-derived tophashes are `>= 5`; if `tophash(hash) < 5`, the runtime adds `minTopHash` to disambiguate. |

---

## 4. `maptype` — the per-type descriptor

```go
type maptype struct {
    typ        _type
    key        *_type
    elem       *_type
    bucket     *_type     // synthesised bmap_K_V type
    hasher     func(unsafe.Pointer, uintptr) uintptr
    keysize    uint8
    elemsize   uint8
    bucketsize uint16
    flags      uint32
}
```

`flags` is a bitfield:

| Flag bit | Meaning |
|----------|---------|
| `indirectkey` | Keys are stored as pointers (size > 128). |
| `indirectelem` | Elements are stored as pointers (size > 128). |
| `reflexivekey` | `k == k` for all keys of this type (false for `NaN`-bearing types). |
| `needkeyupdate` | Replace stored key bits on overwrite (e.g., `float64` to handle `-0.0` vs `+0.0`). |
| `hashMightPanic` | Hashing this key type may panic (interfaces with un-hashable dynamic types). |

---

## 5. Tuning constants

```go
const (
    bucketCntBits = 3
    bucketCnt     = 1 << bucketCntBits  // 8

    loadFactorNum = 13
    loadFactorDen = 2                    // 6.5

    maxKeySize  = 128
    maxElemSize = 128

    dataOffset = unsafe.Offsetof(struct {
        b bmap
        v int64
    }{}.v)                                // alignment of bucket data after tophash[8]

    minTopHash    = 5
)
```

Derived numbers worth remembering:

| Quantity | Value |
|----------|-------|
| Load factor | 6.5 (`13/2`) |
| Bucket entry capacity | 8 |
| Grow trigger | `count > 6.5 * 2^B` |
| Same-size grow trigger | `noverflow >= 2^min(B, 15)` (`tooManyOverflowBuckets`) |
| Initial allocation | none until first insert when `B == 0` |
| Overflow preallocation | `2^(B-4)` buckets when `B >= 4` |

---

## 6. Public runtime functions

These are the entry points the compiler emits calls to:

```go
// generic (any key/value)
func makemap(t *maptype, hint int, h *hmap) *hmap
func makemap_small() *hmap
func makemap64(t *maptype, hint int64, h *hmap) *hmap
func mapaccess1(t *maptype, h *hmap, key unsafe.Pointer) unsafe.Pointer
func mapaccess2(t *maptype, h *hmap, key unsafe.Pointer) (unsafe.Pointer, bool)
func mapassign(t *maptype, h *hmap, key unsafe.Pointer) unsafe.Pointer
func mapdelete(t *maptype, h *hmap, key unsafe.Pointer)
func mapclear(t *maptype, h *hmap)
func mapiterinit(t *maptype, h *hmap, it *hiter)
func mapiternext(it *hiter)

// hot fast paths
func mapaccess1_fast32(t *maptype, h *hmap, key uint32) unsafe.Pointer
func mapaccess2_fast32(t *maptype, h *hmap, key uint32) (unsafe.Pointer, bool)
func mapassign_fast32(t *maptype, h *hmap, key uint32) unsafe.Pointer
func mapassign_fast32ptr(t *maptype, h *hmap, key unsafe.Pointer) unsafe.Pointer
func mapdelete_fast32(t *maptype, h *hmap, key uint32)

func mapaccess1_fast64(t *maptype, h *hmap, key uint64) unsafe.Pointer
func mapaccess2_fast64(t *maptype, h *hmap, key uint64) (unsafe.Pointer, bool)
func mapassign_fast64(t *maptype, h *hmap, key uint64) unsafe.Pointer
func mapassign_fast64ptr(t *maptype, h *hmap, key unsafe.Pointer) unsafe.Pointer
func mapdelete_fast64(t *maptype, h *hmap, key uint64)

func mapaccess1_faststr(t *maptype, h *hmap, ky string) unsafe.Pointer
func mapaccess2_faststr(t *maptype, h *hmap, ky string) (unsafe.Pointer, bool)
func mapassign_faststr(t *maptype, h *hmap, ky string) unsafe.Pointer
func mapdelete_faststr(t *maptype, h *hmap, ky string)
```

Dispatch rules (from `cmd/compile/internal/walk`):

| Key kind | Function family used |
|----------|----------------------|
| `int32`, `uint32`, `rune` | `*_fast32` |
| `int64`, `uint64`, `uintptr` | `*_fast64` |
| any pointer type, 4-byte aligned | `*_fast32ptr` / `*_fast64ptr` |
| `string` | `*_faststr` |
| everything else | generic `mapaccess1`/`mapassign`/`mapdelete` |

`makemap_small()` allocates an `hmap` with no bucket array (`B == 0`). Used for `make(map[K]V)` with no hint and for compile-time map literals that fit in one bucket.

---

## 7. `hiter` struct — iterator state

```go
type hiter struct {
    key         unsafe.Pointer  // current key (set by mapiternext)
    elem        unsafe.Pointer  // current element
    t           *maptype
    h           *hmap
    buckets     unsafe.Pointer  // bucket pointer at iteration start
    bptr        *bmap           // current bucket being walked
    overflow    *[]*bmap
    oldoverflow *[]*bmap
    startBucket uintptr         // random start, in [0, 2^B)
    offset      uint8           // random start within a bucket, in [0, 8)
    wrapped     bool            // whether we've wrapped past startBucket
    B           uint8
    i           uint8
    bucket      uintptr
    checkBucket uintptr
}
```

Iteration semantics:

- Start bucket and offset are chosen with `fastrand()` at `mapiterinit`.
- Walking touches each main bucket and its overflow chain.
- During grow, the iterator may walk both `oldbuckets` and `buckets` for the same logical bucket range — see `checkBucket` logic in [senior.md](senior.md) §10.

---

## 8. The `clear(m)` builtin (Go 1.21+)

Resets a map without freeing the bucket array:

```go
func mapclear(t *maptype, h *hmap) {
    if h == nil || h.count == 0 { return }
    if h.flags&hashWriting != 0 { throw("concurrent map writes") }

    h.flags ^= hashWriting

    h.flags &^= sameSizeGrow
    h.oldbuckets = nil
    h.nevacuate = 0
    h.noverflow = 0
    h.count = 0
    h.hash0 = uint32(fastrand())

    if h.extra != nil { *h.extra = mapextra{} }

    // walk every bucket and zero entries
    _, nextOverflow := makeBucketArray(t, h.B, h.buckets)
    ...
    if h.flags&hashWriting == 0 { throw("concurrent map writes") }
    h.flags &^= hashWriting
}
```

Visible effects:

- `len(m)` becomes 0.
- All entries are zeroed (GC sees no more pointers from these slots).
- `hash0` is re-randomised, so the next inserts get fresh placements.
- Bucket array memory is **retained**.

---

## 9. The `hashWriting` protocol

Order of operations in any write (`mapassign`, `mapdelete`, `mapclear`):

1. Check `h.flags & hashWriting`. If set, `throw("concurrent map writes")`.
2. Set the bit: `h.flags ^= hashWriting`.
3. Perform the operation.
4. Check the bit again. If cleared, `throw`.
5. Clear the bit: `h.flags &^= hashWriting`.

Reads (`mapaccess1`, `mapaccess2`, `mapiternext`) check the bit at entry. If set, `throw("concurrent map read and map write")`.

The protocol is **not** a lock — concurrent writers can both pass the check before either sets the bit. The Go race detector (`-race`) provides more rigorous detection by instrumenting the bucket-array memory.

---

## 10. Swiss-table backend (Go 1.24+, build-controlled)

The Swiss-table redesign in [#54766](https://github.com/golang/go/issues/54766) replaces the bucket+overflow layout with **groups of 8 slots** and a separate **control byte array** that can be probed with SIMD.

Key differences:

| Concept | Old (bucket) | New (Swiss) |
|---------|--------------|-------------|
| Storage unit | `bmap` (8 entries + overflow pointer) | Group (8 slots + 8 control bytes) |
| Probing | Linear within bucket, then overflow chain | Quadratic probing across groups; SIMD scans 8 control bytes per cycle |
| Tombstones | `emptyOne` keeps probe-path open | Dedicated `TOMBSTONE` byte |
| Grow algorithm | Doubling + same-size | Doubling; tombstones cleaned during grow |
| Iteration | Random start bucket + offset | Random start group + offset; semantics preserved |
| `hashWriting` | Same | Same |
| Concurrent-write detection | `throw` | `throw` |

Observable changes for user code:

- Iteration order randomization is different — code that relies on a particular shuffle will see a new one.
- Lookup performance improves ~20 % on cache-warm hits, more on misses.
- Memory overhead increases ~10 % (control bytes).
- `unsafe`-based introspection that walked the bucket array no longer works under the new backend.

Migration path:

- Go 1.24 ships both backends; default selected via `GOEXPERIMENT=swisstable` (or its successor).
- A later release switches the default; the old backend stays available behind a tag for a transition window.
- Eventually the old code is removed.

Documentation status: the Swiss-table backend is described in the proposal and in the source under `runtime/map_swiss.go` and `internal/runtime/maps/`. The Go spec remains unchanged — it never documented the old layout either.

---

## 11. Memory layout examples

### 11.1 `map[int32]int32`

```
hmap        : 48 bytes
bmap_int32_int32:
  tophash    : 8 bytes
  pad        : 0 bytes (int32 is 4-byte aligned; 8 is fine)
  keys[8]    : 32 bytes
  elems[8]   : 32 bytes
  overflow   : 8 bytes
  -----------------
  total      : 80 bytes per bucket
```

For 1000 entries, expected `B = ceil(log2(1000/6.5)) = 8`, so 256 buckets × 80 = 20 KB plus overflow.

### 11.2 `map[string]int64`

```
bmap_string_int64:
  tophash    : 8 bytes
  pad        : 8 bytes (16-byte alignment of string header)
  keys[8]    : 8 * 16 = 128 bytes (string header is {ptr, len})
  elems[8]   : 8 * 8  = 64 bytes
  overflow   : 8 bytes
  -----------------
  total      : 216 bytes per bucket
```

Key-stored bytes are headers; the underlying string data is separate and shared if the same string is the source.

### 11.3 `map[K]V` where K is a 256-byte struct

`indirectkey` is set: each slot stores `*K` (8 bytes). The bucket is small; the `K` payload lives in a separate allocation per entry. GC sees one pointer per slot and scans the K data.

---

## 12. Concurrency guarantees

From the Go memory model and the runtime:

| Scenario | Outcome |
|----------|---------|
| Multiple goroutines reading, none writing | Safe. No synchronization required. |
| Read with concurrent write (no sync) | Undefined behavior; runtime may `throw`. |
| Multiple writers (no sync) | Undefined behavior; runtime may `throw`. |
| Writes serialized by `sync.RWMutex.Lock`/reads by `RLock` | Safe. |
| `sync.Map` operations | Safe — different API, different layout. |

`sync.Map` is not a layout variant of the runtime map; it is a separate type backed by two maps and a mutex. See `pkg.go.dev/sync#Map`.

---

## 13. Version history

| Go version | Map-related change |
|------------|---------------------|
| 1.0  | Bucket-based hashmap baseline. |
| 1.5  | AES-NI hash on amd64 via `aeshashbody`; per-map `hash0` seed. |
| 1.7  | `emptyRest` tombstone; faster miss probes. |
| 1.8  | Same-size grow added to compact overflow chains. |
| 1.9  | Fast paths added for `int32`, `int64`, `string` keys (`mapaccess1_fast*`, `mapassign_fast*`). |
| 1.10 | Hash seed re-randomised when map becomes empty. |
| 1.13 | `mapdelete_fast*` family added. |
| 1.18 | Generics — `maptype` now per type-parameter instantiation. |
| 1.20 | Improved escape analysis: more small maps stay on the stack. |
| 1.21 | `clear(m)` built-in; `mapclear` runtime function. |
| 1.22 | Loop variable scoping change affects `for k, v := range m` (each iteration gets a fresh k, v). |
| 1.24 | Swiss-table backend introduced as experiment; same observable semantics. |

---

## 14. Glossary

| Term | Definition |
|------|------------|
| `hmap` | The map header struct held behind every map variable. |
| `bmap` | A bucket. Holds up to 8 key/value pairs plus an overflow pointer. |
| Tophash | High byte of a key's hash, used to filter slot comparisons. |
| Overflow bucket | A `bmap` linked off another bucket to hold the 9th+ entries with the same primary bucket index. |
| Load factor | `count / 2^B`. Grow triggers when this exceeds 6.5. |
| Doubling grow | New bucket array has 2× the buckets; entries split low/high by one bit. |
| Same-size grow | New bucket array has the same size; compacts entries to remove tombstones and overflow. |
| Evacuation | The act of moving entries from `oldbuckets` to `buckets`. Incremental, paid per insert/delete. |
| `hashWriting` | The flag bit that detects concurrent writes; raises `throw` on conflict. |
| `hash0` | Per-map random hash seed; re-randomised on emptying. |
| Fast path | Specialised function for `int32`/`int64`/`string` keys. |
| Swiss table | The Go 1.24+ backend; SIMD-probed groups; replaces bucket+overflow. |

---

## 15. Cross-references

- Basic usage: [01-comma-ok-idiom](../01-comma-ok-idiom/) and the parent `04-maps/` directory.
- Source walk: [senior.md](senior.md).
- Tuning: [optimize.md](optimize.md).
- Production patterns: [professional.md](professional.md).
- Concurrency primitives (`sync.Map`, `sync.RWMutex`): `../../../../07-concurrency/...` once those topics exist.

---

## 16. Further reading

- `runtime/map.go`: https://github.com/golang/go/blob/master/src/runtime/map.go
- Swiss-table proposal #54766: https://github.com/golang/go/issues/54766
- Go memory model: https://go.dev/ref/mem
- `sync.Map`: https://pkg.go.dev/sync#Map
- Go spec — map types: https://go.dev/ref/spec#Map_types
- Matt Kulukundis, "Designing a Fast, Efficient, Cache-friendly Hash Table" (CppCon 2017)
