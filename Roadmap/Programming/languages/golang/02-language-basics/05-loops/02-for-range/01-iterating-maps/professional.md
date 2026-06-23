# Iterating Maps — Professional Level (Internals, Compiler, Memory, Assembly)

## 1. hmap Structure in Detail

```go
// runtime/map.go
const (
    bucketCntBits = 3
    bucketCnt     = 1 << bucketCntBits // 8 key-value pairs per bucket
    loadFactorNum = 13
    loadFactorDen = 2
    // Load factor = 13/2 = 6.5: map grows when count > 6.5 * buckets
)

type hmap struct {
    count      int            // live entries
    flags      uint8          // iterator bits, same-size-grow, etc.
    B          uint8          // log_2(len(buckets))
    noverflow  uint16         // approximate number of overflow buckets
    hash0      uint32         // hash seed — set by runtime.fastrand at makemap()
    buckets    unsafe.Pointer // *[2^B]bmap — nil if count==0
    oldbuckets unsafe.Pointer // previous bucket array during grow
    nevacuate  uintptr        // evacuation progress counter
    extra      *mapextra      // optional: overflow buckets, etc.
}
```

The `flags` field uses bit positions:
- bit 0: iterator in progress on `buckets`
- bit 1: iterator in progress on `oldbuckets`
- bit 2: key-value pairs may need indirect storage
- bit 3: same-size grow (triggered by excess overflows)

---

## 2. Bucket Memory Layout

```
bmap layout for map[string]int (key=16B, val=8B):
Offset   Size  Field
0        8     tophash[0..7]  (1 byte each)
8        128   keys[0..7]     (16 bytes each: string header)
136      64    values[0..7]   (8 bytes each: int)
200      8     overflow ptr   (*bmap)
Total: 208 bytes per bucket
```

The tophash holds the top 8 bits of each key's hash. During lookup:
1. Compute full hash of target key
2. Extract top 8 bits
3. Scan tophash array — only full hash comparison when tophash matches
4. Linear scan through 8 slots (fits in 1-2 cache lines)

---

## 3. hiter Structure

```go
type hiter struct {
    key         unsafe.Pointer  // current key
    elem        unsafe.Pointer  // current value
    t           *maptype        // map type info
    h           *hmap
    buckets     unsafe.Pointer  // snapshot of buckets at start
    bptr        *bmap           // current bucket
    overflow    *[]*bmap        // slice of overflow buckets (current)
    oldoverflow *[]*bmap        // overflow buckets (old)
    startBucket uintptr         // bucket at which range started
    offset      uint8           // intra-bucket start offset (randomized)
    wrapped     bool            // already wrapped around from end to start
    B           uint8
    i           uint8           // current offset within bucket
    bucket      uintptr         // current bucket index
    checkBucket uintptr         // bucket to check during grow (oldbuckets)
}
```

`hiter` is 96 bytes on 64-bit systems. It is allocated on the goroutine's stack by the compiler unless it escapes.

---

## 4. Generated Assembly for Map Range

```go
package main

import "fmt"

func sumMap(m map[string]int) int {
    sum := 0
    for _, v := range m {
        sum += v
    }
    return sum
}
```

```bash
go tool compile -S main.go 2>&1 | grep -A 50 "sumMap"
```

Approximate output (x86-64):
```asm
TEXT main.sumMap(SB)
    ; Allocate hiter on stack
    SUB     $136, SP          ; 136 = sizeof(hiter) aligned
    ; Call mapiterinit
    LEAQ    type.map[string]int(SB), AX
    MOVQ    "".m+144(SP), BX  ; load map pointer
    LEAQ    autotmp_0(SP), CX ; address of hiter on stack
    CALL    runtime.mapiterinit(SB)
loop:
    ; Check if key is nil (end of iteration)
    MOVQ    (SP), AX          ; hiter.key
    TESTQ   AX, AX
    JE      done
    ; Load value
    MOVQ    8(SP), DX         ; hiter.elem
    MOVQ    (DX), SI          ; *elem = int value
    ADDQ    SI, "".sum+...    ; sum += v
    ; Advance iterator
    LEAQ    autotmp_0(SP), AX
    CALL    runtime.mapiternext(SB)
    JMP     loop
done:
    RET
```

Note: `hiter` is on the stack (136 bytes reserved). Each iteration calls `mapiternext` — a function call overhead (~10-50ns) per element.

---

## 5. mapiterinit: Full Logic

```go
func mapiterinit(t *maptype, h *hmap, it *hiter) {
    // Handle nil/empty map
    if h == nil || h.count == 0 {
        return
    }

    // Validate hiter size matches compiled expectation
    if unsafe.Sizeof(hiter{})/ptrSize != 12 {
        throw("hash_iter size incorrect")
    }

    it.t = t
    it.h = h

    // Snapshot bucket pointers at start
    it.B = h.B
    it.buckets = h.buckets
    if t.bucket.ptrdata == 0 {
        // Allocate overflow slice for non-pointer buckets
        h.createOverflow()
        it.overflow = h.extra.overflow
        it.oldoverflow = h.extra.oldoverflow
    }

    // RANDOMIZE: decide starting bucket and offset
    r := uintptr(fastrand())
    if h.B > 31-bucketCntBits {
        r += uintptr(fastrand()) << 31
    }
    it.startBucket = r & bucketMask(h.B)
    it.offset = uint8(r >> h.B & (bucketCnt - 1))
    it.bucket = it.startBucket

    // Set iterator-in-progress flag (prevents 'same-size grow' during iteration)
    h.flags |= iterator | oldIterator

    mapiternext(it) // advance to first element
}
```

---

## 6. mapiternext: Bucket Traversal

```go
func mapiternext(it *hiter) {
    h := it.h
    t := it.t
    bucket := it.bucket
    b := it.bptr
    i := it.i
    // ... (simplified)

next:
    if b == nil {
        // Determine next bucket to visit
        if bucket == it.startBucket && it.wrapped {
            // Done: returned to start
            it.key = nil
            it.elem = nil
            return
        }
        if h.growing() && it.B == h.B {
            // Map is growing — check old bucket
            oldbucket := bucket & it.h.oldbucketmask()
            b = (*bmap)(add(h.oldbuckets, oldbucket*uintptr(t.bucketsize)))
            if !evacuated(b) {
                // Old bucket not yet evacuated — iterate it
            } else {
                b = (*bmap)(add(h.buckets, bucket*uintptr(t.bucketsize)))
                it.checkBucket = oldbucket
            }
        } else {
            b = (*bmap)(add(h.buckets, bucket*uintptr(t.bucketsize)))
            it.checkBucket = noCheck
        }
        bucket++
        if bucket == bucketShift(it.B) {
            bucket = 0
            it.wrapped = true
        }
        i = 0
    }

    // Scan slots within bucket
    for ; i < bucketCnt; i++ {
        offi := (i + it.offset) & (bucketCnt - 1)
        if isEmpty(b.tophash[offi]) || b.tophash[offi] == evacuatedEmpty {
            continue
        }
        // Found a live entry
        k := add(unsafe.Pointer(b), dataOffset+uintptr(offi)*uintptr(t.keysize))
        e := add(unsafe.Pointer(b), dataOffset+bucketCnt*uintptr(t.keysize)+uintptr(offi)*uintptr(t.elemsize))
        it.key = k
        it.elem = e
        it.bucket = bucket
        it.bptr = b
        it.i = i + 1
        return
    }
    b = b.overflow(t)
    i = 0
    goto next
}
```

---

## 7. reflect.MapIter — Reflection-Based Iteration

```go
package main

import (
    "fmt"
    "reflect"
)

func genericRangeMap(m interface{}, fn func(k, v reflect.Value)) {
    mv := reflect.ValueOf(m)
    if mv.Kind() != reflect.Map {
        panic("not a map")
    }
    iter := mv.MapRange() // returns *reflect.MapIter
    for iter.Next() {
        fn(iter.Key(), iter.Value())
    }
}

func main() {
    m := map[string]int{"a": 1, "b": 2}
    genericRangeMap(m, func(k, v reflect.Value) {
        fmt.Printf("%v: %v\n", k, v)
    })
}
```

`reflect.MapIter` wraps `hiter` internally. The overhead is ~20-50x vs direct range due to:
- `reflect.Value` boxing
- Additional indirection through `maptype`
- Type assertion on every key/value access

---

## 8. Map Type Descriptor

```go
// runtime/type.go
type maptype struct {
    typ        _type
    key        *_type
    elem       *_type
    bucket     *_type     // bucket type (auto-generated)
    hasher     func(unsafe.Pointer, uintptr) uintptr
    keysize    uint8
    elemsize   uint8
    bucketsize uint16
    flags      uint32
}
```

The `hasher` function is selected at compile time based on key type:
- `runtime.strhash` for strings
- `runtime.memhash32/64` for fixed-size types
- Composite types get auto-generated hashers

---

## 9. Compiler Optimization: Inline Map Operations

For small, constant maps, the compiler may not use `hmap` at all:

```go
// A map with compile-time-known small set may be optimized
// to a series of comparisons (no hash table at runtime)
// This is done by the compiler for switch statements, not for maps

// Maps are NEVER inlined by the compiler — they always use the runtime
// Even map[string]int{"a": 1} allocates an hmap at runtime

// For constant lookup tables, use switch or sorted slice + binary search:
func lookup(key string) int {
    switch key {
    case "a": return 1
    case "b": return 2
    case "c": return 3
    }
    return 0
}
// No runtime allocation, O(1) or O(log n) via binary search tree
```

---

## 10. Maps and the Garbage Collector

```go
// Maps with pointer keys or values are scanned by GC on every cycle
// Maps with non-pointer types have a compact no-pointer bmap

// For performance with large maps of non-pointer types:
type Point struct{ X, Y int32 } // no pointers — GC-friendly
m := map[Point]float64{} // GC skips scanning bmap entries

// For maps with pointer values, GC must scan all live buckets
// This adds GC pause time proportional to map size
m2 := map[string]*Record{} // GC scans all *Record pointers per cycle
```

---

## 11. Benchmarks: Map Iteration Cost Breakdown

```go
package main

import "testing"

var (
    smallMap  = makeMap(10)
    medMap    = makeMap(100)
    largeMap  = makeMap(10000)
)

func makeMap(n int) map[int]int {
    m := make(map[int]int, n)
    for i := 0; i < n; i++ { m[i] = i }
    return m
}

func BenchmarkSmallMap(b *testing.B) {
    for n := 0; n < b.N; n++ {
        s := 0; for _, v := range smallMap { s += v }; _ = s
    }
}
func BenchmarkMedMap(b *testing.B) {
    for n := 0; n < b.N; n++ {
        s := 0; for _, v := range medMap { s += v }; _ = s
    }
}
func BenchmarkLargeMap(b *testing.B) {
    for n := 0; n < b.N; n++ {
        s := 0; for _, v := range largeMap { s += v }; _ = s
    }
}
// Results (approximate):
// BenchmarkSmallMap: ~200 ns/op   (20 ns/element)
// BenchmarkMedMap:   ~2 μs/op     (20 ns/element)
// BenchmarkLargeMap: ~200 μs/op   (20 ns/element)
// Note: per-element cost is constant; dominated by cache misses at large size
```

---

## 12. GOSSAFUNC Analysis of Map Range

```bash
GOSSAFUNC=sumMap go build main.go
# Opens ssa.html in browser

# Key SSA phases for map range:
# 1. "start" — initial SSA
# 2. "opt" — optimizations (nil checks, BCE)
# 3. "lower" — replaces range with runtime calls
# 4. "regalloc" — register allocation
# 5. "genssa" — final assembly generation
```

At the "lower" phase, the `RANGE` SSA node is replaced with:
- `mapiterinit` call
- Loop checking `hiter.key != nil`
- `mapiternext` call at end of each iteration

---

## 13. Map Evacuation and Iterator Interaction

During map growth (doubling), the old buckets array is kept alive until fully evacuated. The iterator must handle this:

```go
// Pseudo-code for iterator with growing map
if h.growing() {
    // Map is currently evacuating old buckets
    // - If visiting a bucket in old array that's evacuated: skip to new buckets
    // - If visiting a bucket in old array not yet evacuated: iterate old
    // This ensures each element is visited exactly once
    // even though bucket positions shift during growth
}
```

This is why `for range` over a map during heavy writes can be slow — bucket evacuation adds overhead per iteration.

---

## 14. Runtime Flags that Affect Map Behavior

```bash
# Disable map randomization for debugging (NEVER in production)
GONOSEED=1 go run main.go  # does not exist — randomization is always on

# Map growth can be observed with:
GOGC=off go run main.go  # disable GC to see map memory without collection

# Race detector adds shadow memory to map operations:
go run -race main.go
# Each map access is checked against the shadow memory for concurrent access
```

---

## 15. Professional Summary: Map Iteration Cost Model

| Cost Factor | Impact | Mitigation |
|---|---|---|
| `mapiternext` function call | ~10-50 ns per element | Cannot avoid; use slice for hot paths |
| Cache miss per bucket | ~100 ns per cache miss | Sort into slice if order needed anyway |
| Evacuation during range | Up to 2x slower per element | Avoid heavy writes during range |
| Reflection (MapIter) | ~20-50x slower | Avoid; use code generation instead |
| Pointer GC scanning | GC pause proportional to size | Use non-pointer value types |
| `hiter` on stack | 96 bytes stack reservation | Usually fine; watch for stack pressure |
| Random start overhead | Negligible (~1 fastrand call) | No action needed |

**When to replace map with slice:**
- Need O(1) cache-friendly sequential scan
- Map is built once, read many times
- Keys are integers 0..N (use `[]T` directly)
- Need guaranteed iteration order
