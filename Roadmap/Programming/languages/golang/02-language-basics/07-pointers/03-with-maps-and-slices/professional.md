# Go Pointers with Maps & Slices — Professional / Internals Level

## 1. Overview

This document covers the binary mechanics: slice header layout in registers, `runtime.growslice` implementation, map bucket layout, hash table internals, the `runtime.mapaccess` family, GC interaction with slice/map data, and `sync.Map` internals.

---

## 2. Slice Header in Registers

For `func f(s []int)` on amd64:
- AX = slice array pointer
- BX = slice length
- CX = slice capacity

Indexing `s[i]`:
```asm
; bounds check: i < len(s)
CMPQ  i, BX
JAE   panic
; address of element: array + i * 8 (for int)
LEAQ  (AX)(i*8), reg
MOVQ  (reg), reg
```

Or with bounds-check elimination (BCE), the bounds check disappears.

---

## 3. `runtime.growslice`

When `append` exceeds capacity:
```go
func growslice(et *_type, old slice, cap int) slice {
    // ... compute new cap ...
    newSlice := alloc(newCap * et.size)
    copy(newSlice, old.data, old.len * et.size)
    return slice{newSlice, old.len, newCap}
}
```

Cost:
- New allocation (heap).
- memcpy of all old elements.

Pre-allocating capacity avoids these.

---

## 4. Map Bucket Layout

```
bucket {
    tophash [8]uint8           // top 8 bits of each entry's hash
    keys    [8]Key             // contiguous keys
    values  [8]Value           // contiguous values
    overflow *bucket           // for chaining
}
```

Keys and values stored in separate arrays for cache-friendly probing. Top 8 bits used for fast comparison.

For pointer values, each value slot is 8 B. For inline values (small structs), the slot holds the entire value.

---

## 5. Map Lookup (`runtime.mapaccess1`)

```go
func mapaccess1(t *maptype, m *hmap, key unsafe.Pointer) unsafe.Pointer {
    hash := alg.hash(key, uintptr(m.hash0))
    bucket := hash & ((1 << m.B) - 1)
    b := bucketAt(m.buckets, bucket)
    for ; b != nil; b = b.overflow {
        for i := 0; i < 8; i++ {
            if tophash[i] != top { continue }
            if alg.equal(key, &b.keys[i]) {
                return &b.values[i]
            }
        }
    }
    return zeroValue
}
```

Returns a POINTER to the value (internal). Cost ~10-30 ns depending on hash collisions.

For `m[k]++`, the compiler uses `mapassign` which returns a pointer to the value slot — direct increment is possible.

---

## 6. Why Maps Forbid `&m[k]`

The runtime moves values during rehash. Returning `&m[k]` to user code would create dangling pointers after rehash.

The internal pointer returned by `mapaccess1` is used immediately and not retained.

---

## 7. `sync.Map` Internals

`sync.Map` uses two internal maps:
- `read` (atomic.Pointer to readOnly): lock-free reads.
- `dirty`: mutex-protected for writes.

Reads check `read` first (fast path). Misses fall through to `dirty` (slow path with mutex).

Optimized for:
- Set-once, read-many keys.
- Goroutines accessing disjoint keys.

NOT optimized for general read+write workloads.

---

## 8. Slice Pointer Operations Optimization

Compiler can hoist bounds checks out of loops:
```go
for i := 0; i < len(s); i++ {
    use(s[i]) // BCE: compiler proves safe
}
```

Verify:
```bash
go build -gcflags="-d=ssa/check_bce/debug=1"
```

For unproven bounds:
```go
for _, idx := range indices {
    use(s[idx]) // bounds check each iter
}
```

Add an explicit check or assertion to enable BCE.

---

## 9. GC and Slice/Map

### 9.1 Slice Backing Array
The slice header IS the GC root for the backing array. As long as the header is reachable, the array stays alive.

A subslice keeps the WHOLE array alive (the slice header's `array` pointer points to the original allocation's start, but the GC keeps the entire allocation block).

### 9.2 Map Buckets
Map allocates a 2^B array of buckets. The GC tracks the buckets and overflow chains.

For pointer-typed values, each value slot is a GC root. For value-typed, no roots within the bucket.

### 9.3 Map Rehash Cost
Rehashing during writes is incremental — each operation moves a few buckets. Amortized O(1).

---

## 10. Microbenchmarks

```go
package main

import "testing"

func BenchmarkSliceAppendNoCap(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var s []int
        for j := 0; j < 1000; j++ {
            s = append(s, j)
        }
        _ = s
    }
}

func BenchmarkSliceAppendPreCap(b *testing.B) {
    for i := 0; i < b.N; i++ {
        s := make([]int, 0, 1000)
        for j := 0; j < 1000; j++ {
            s = append(s, j)
        }
        _ = s
    }
}
```

Typical:
- NoCap: ~5 µs/op, 8 KB, ~10 allocs (for the realloc copies)
- PreCap: ~2 µs/op, 8 KB, 1 alloc

For maps:
```go
func BenchmarkMapNoSize(b *testing.B) {
    for i := 0; i < b.N; i++ {
        m := map[int]int{}
        for j := 0; j < 1000; j++ { m[j] = j }
    }
}

func BenchmarkMapWithSize(b *testing.B) {
    for i := 0; i < b.N; i++ {
        m := make(map[int]int, 1000)
        for j := 0; j < 1000; j++ { m[j] = j }
    }
}
```

Pre-sized is ~30% faster.

---

## 11. PGO and Maps/Slices

PGO can:
- Devirtualize interface calls in slices of interface values.
- Inline hot map access patterns.

For slice/map heavy code, PGO offers significant speedups.

---

## 12. Reading Generated Code

```bash
go build -gcflags="-S" 2>asm.txt
grep -A 10 "runtime.growslice" asm.txt
grep -A 10 "runtime.mapaccess" asm.txt
```

Identify hot map/slice operations.

---

## 13. Self-Assessment Checklist

- [ ] I know slice header layout (3 words)
- [ ] I understand growslice cost
- [ ] I know map bucket structure
- [ ] I understand mapaccess1 returns internal pointer (don't retain)
- [ ] I know sync.Map's two-map design
- [ ] I can verify BCE
- [ ] I understand GC roots for slices and maps

---

## 14. References

- [Slice growth source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/slice.go)
- [Map source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/map.go)
- [`sync.Map` source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/sync/map.go)
- [Slice internals](https://go.dev/blog/slices-intro)
- 2.7.1, 2.7.2, 2.7.4
