# Map Internals — Senior

> Author: Bakhodir Yashin Mansur

## Table of Contents
1. [Source map](#source-map)
2. [hmap, bmap, mapextra in detail](#hmap-bmap-mapextra-in-detail)
3. [Type-specific bucket layout](#type-specific-bucket-layout)
4. [makemap and makeBucketArray](#makemap-and-makebucketarray)
5. [mapaccess1 and mapaccess2](#mapaccess1-and-mapaccess2)
6. [mapassign — the write path](#mapassign--the-write-path)
7. [mapdelete and tombstone handling](#mapdelete-and-tombstone-handling)
8. [hashGrow, growWork, and evacuate](#hashgrow-growwork-and-evacuate)
9. [Fast paths: mapaccess1_fast32/64/str](#fast-paths-mapaccess1_fast3264str)
10. [Iteration: hiter, mapiterinit, mapiternext](#iteration-hiter-mapiterinit-mapiternext)
11. [Race detection integration](#race-detection-integration)
12. [Why mapaccess returns a pointer to the bucket](#why-mapaccess-returns-a-pointer-to-the-bucket)
13. [Version-by-version changes](#version-by-version-changes)

---

## 1. Source map

The implementation is mostly in two files:

```
src/runtime/map.go             // core hmap, bmap, all generic functions
src/runtime/map_fast32.go      // mapaccess/mapassign/mapdelete for uint32, int32, etc.
src/runtime/map_fast64.go      // same for 64-bit keys
src/runtime/map_faststr.go     // same for string keys
src/runtime/map_swiss.go       // Go 1.24+ Swiss-table backend (build tag)
```

Auxiliary:

```
src/runtime/alg.go             // hashing dispatch (algorithm picked at type instantiation)
src/runtime/type.go            // _type and maptype declarations
src/internal/abi/map.go        // ABI-side declarations shared with the compiler
src/cmd/compile/internal/typecheck/builtin.go  // calls into runtime from the compiler
```

A read of `runtime/map.go` is ~2300 lines; this file is your tour guide.

---

## 2. hmap, bmap, mapextra in detail

```go
// runtime/map.go
const (
    bucketCntBits = 3
    bucketCnt     = 1 << bucketCntBits   // 8

    loadFactorNum = 13
    loadFactorDen = 2                    // 6.5

    maxKeySize  = 128
    maxElemSize = 128

    dataOffset = unsafe.Offsetof(struct {
        b bmap
        v int64
    }{}.v)  // bucket data starts after `tophash[8]` aligned to int64
)

type hmap struct {
    count     int
    flags     uint8
    B         uint8
    noverflow uint16
    hash0     uint32

    buckets    unsafe.Pointer
    oldbuckets unsafe.Pointer
    nevacuate  uintptr

    extra *mapextra
}

type bmap struct {
    tophash [bucketCnt]uint8
    // followed by 8 keys
    // then    by 8 elems
    // then    by 1 overflow pointer (*bmap)
}
```

The `bmap` definition you see in source is **incomplete**. The compiler synthesises a full type per `maptype` with the actual key, elem, and overflow fields laid out. The shape:

```
bmap (instantiated for map[K]V):
  tophash  [8]uint8
  pad      to align(K)
  keys     [8]K
  pad      to align(V)
  elems    [8]V
  overflow *bmap
```

If `K` or `V` is larger than 128 bytes, the runtime instead stores `*K` or `*V` and dereferences on access. This is `indirectkey` / `indirectelem` in the maptype flags.

`mapextra`:

```go
type mapextra struct {
    overflow     *[]*bmap   // overflow buckets currently in use (pointer kind)
    oldoverflow  *[]*bmap
    nextOverflow *bmap      // next preallocated overflow slot
}
```

The two `[]*bmap` slices keep overflow buckets alive across GC when keys/elems contain pointers — without them, the bucket array (a single allocation) would not have a GC scan path to the separately allocated overflow buckets.

---

## 3. Type-specific bucket layout

`maptype` is the per-type descriptor the compiler emits:

```go
// runtime/type.go (abridged)
type maptype struct {
    typ        _type
    key        *_type
    elem       *_type
    bucket     *_type    // the synthesised bmap type
    hasher     func(unsafe.Pointer, uintptr) uintptr
    keysize    uint8
    elemsize   uint8
    bucketsize uint16
    flags      uint32    // indirectkey, indirectelem, reflexivekey, needkeyupdate, ...
}
```

The `hasher` field is set at compile time based on the key type. For `int64` keys it points at `memhash64`; for `string` keys it points at `strhash`; for `complex128` it points at a hand-written hasher; etc. The runtime never branches on key kind — it just calls `t.hasher(k, seed)`.

This is also why custom comparable types (struct keys) hash through `memhash` of their concatenated representation — and why a key type with internal padding bytes can hash inconsistently if the padding is uninitialised. The Go compiler handles this by zeroing struct values, but `unsafe` pointer tricks can produce surprising collisions.

---

## 4. makemap and makeBucketArray

```go
func makemap(t *maptype, hint int, h *hmap) *hmap {
    mem, overflow := math.MulUintptr(uintptr(hint), t.bucket.size)
    if overflow || mem > maxAlloc { hint = 0 }

    if h == nil { h = new(hmap) }
    h.hash0 = uint32(fastrand())

    B := uint8(0)
    for overLoadFactor(hint, B) {
        B++
    }
    h.B = B

    if h.B != 0 {
        var nextOverflow *bmap
        h.buckets, nextOverflow = makeBucketArray(t, h.B, nil)
        if nextOverflow != nil {
            h.extra = new(mapextra)
            h.extra.nextOverflow = nextOverflow
        }
    }
    return h
}
```

Three observations:

1. `hint` is *advisory*. It sizes `B` so the initial array can hold the hinted entries without a grow, but does not pin `count` to `hint`.
2. The `hmap` struct can be stack-allocated by the caller (the compiler passes a non-nil `h` for small maps that don't escape).
3. The bucket array is allocated lazily — `B == 0` defers the allocation until the first insert. This is how `map[K]V(nil)` becomes "a real map" on first write only when `make` was used (a `nil` map literal still cannot be written to).

`makeBucketArray`:

```go
func makeBucketArray(t *maptype, b uint8, dirtyalloc unsafe.Pointer) (buckets unsafe.Pointer, nextOverflow *bmap) {
    base := bucketShift(b)
    nbuckets := base
    if b >= 4 {
        nbuckets += bucketShift(b - 4)   // 1/16 extra for overflow preallocation
        sz := t.bucket.size * nbuckets
        up := roundupsize(sz, false)
        if up != sz {
            nbuckets = up / t.bucket.size
        }
    }
    ...
    if base != nbuckets {
        nextOverflow = (*bmap)(add(buckets, base*uintptr(t.bucketsize)))
        last := (*bmap)(add(buckets, (nbuckets-1)*uintptr(t.bucketsize)))
        last.setoverflow(t, (*bmap)(buckets)) // sentinel: end of preallocated chain
    }
    return
}
```

For `B >= 4`, the runtime over-allocates by `2^(B-4) / 2^B = 1/16` to preallocate overflow buckets. The first inserts that overflow don't pay an allocation — they pull from `nextOverflow`. The sentinel pointer on the last preallocated bucket lets `newoverflow` detect exhaustion.

---

## 5. mapaccess1 and mapaccess2

`mapaccess1` is the path for `v := m[k]`; `mapaccess2` is `v, ok := m[k]`. Their bodies are nearly identical; here is `mapaccess1`:

```go
func mapaccess1(t *maptype, h *hmap, key unsafe.Pointer) unsafe.Pointer {
    if raceenabled && h != nil { ... }
    if msanenabled && h != nil { ... }

    if h == nil || h.count == 0 {
        if t.hashMightPanic() { t.hasher(key, 0) } // generate the panic
        return unsafe.Pointer(&zeroVal[0])
    }
    if h.flags&hashWriting != 0 {
        throw("concurrent map read and map write")
    }

    hash := t.hasher(key, uintptr(h.hash0))
    m := bucketMask(h.B)
    b := (*bmap)(add(h.buckets, (hash&m)*uintptr(t.bucketsize)))

    if c := h.oldbuckets; c != nil {
        if !h.sameSizeGrow() { m >>= 1 }
        oldb := (*bmap)(add(c, (hash&m)*uintptr(t.bucketsize)))
        if !evacuated(oldb) {
            b = oldb
        }
    }

    top := tophash(hash)
bucketloop:
    for ; b != nil; b = b.overflow(t) {
        for i := uintptr(0); i < bucketCnt; i++ {
            if b.tophash[i] != top {
                if b.tophash[i] == emptyRest { break bucketloop }
                continue
            }
            k := add(unsafe.Pointer(b), dataOffset+i*uintptr(t.keysize))
            if t.indirectkey() { k = *((*unsafe.Pointer)(k)) }
            if t.key.equal(key, k) {
                e := add(unsafe.Pointer(b), dataOffset+bucketCnt*uintptr(t.keysize)+i*uintptr(t.elemsize))
                if t.indirectelem() { e = *((*unsafe.Pointer)(e)) }
                return e
            }
        }
    }
    return unsafe.Pointer(&zeroVal[0])
}
```

Walk-through:

1. **nil/empty short-circuit**: an empty map returns zero immediately, but still runs the hasher if the key type can panic on hash (`hashMightPanic` covers types with embedded interfaces).
2. **Concurrent write detection**: the bit-check turns racy reads into a `throw`. There is no recoverable path.
3. **Bucket lookup**: bitmask, then optional fall-back to the unevacuated old bucket.
4. **The hot loop**: iterate up to 8 slots in the bucket, check tophash byte first, only compare full keys on a fingerprint match. `emptyRest` short-circuits the whole chain — all subsequent slots are guaranteed empty.
5. **Indirect key/elem**: for large key/value types the slot stores a pointer; deref before comparing or returning.
6. **Return**: `unsafe.Pointer` to the slot in the bucket. The compiler copies the value into the caller's variable.

`mapaccess2` adds a `bool` return; otherwise identical.

---

## 6. mapassign — the write path

```go
func mapassign(t *maptype, h *hmap, key unsafe.Pointer) unsafe.Pointer {
    if h == nil { panic(plainError("assignment to entry in nil map")) }
    ...
    if h.flags&hashWriting != 0 {
        throw("concurrent map writes")
    }
    hash := t.hasher(key, uintptr(h.hash0))
    h.flags ^= hashWriting

    if h.buckets == nil {
        h.buckets = newobject(t.bucket)
    }

again:
    bucket := hash & bucketMask(h.B)
    if h.growing() {
        growWork(t, h, bucket)
    }
    b := (*bmap)(add(h.buckets, bucket*uintptr(t.bucketsize)))
    top := tophash(hash)

    var inserti *uint8
    var insertk unsafe.Pointer
    var elem unsafe.Pointer
bucketloop:
    for {
        for i := uintptr(0); i < bucketCnt; i++ {
            if b.tophash[i] != top {
                if isEmpty(b.tophash[i]) && inserti == nil {
                    inserti = &b.tophash[i]
                    insertk = add(unsafe.Pointer(b), dataOffset+i*uintptr(t.keysize))
                    elem = add(unsafe.Pointer(b), dataOffset+bucketCnt*uintptr(t.keysize)+i*uintptr(t.elemsize))
                }
                if b.tophash[i] == emptyRest { break bucketloop }
                continue
            }
            k := add(unsafe.Pointer(b), dataOffset+i*uintptr(t.keysize))
            if t.indirectkey() { k = *((*unsafe.Pointer)(k)) }
            if !t.key.equal(key, k) { continue }
            // matched: update path
            if t.needkeyupdate() { typedmemmove(t.key, k, key) }
            elem = add(unsafe.Pointer(b), dataOffset+bucketCnt*uintptr(t.keysize)+i*uintptr(t.elemsize))
            goto done
        }
        ovf := b.overflow(t)
        if ovf == nil { break }
        b = ovf
    }

    // not found; consider growing.
    if !h.growing() && (overLoadFactor(h.count+1, h.B) || tooManyOverflowBuckets(h.noverflow, h.B)) {
        hashGrow(t, h)
        goto again
    }

    if inserti == nil {
        // all buckets full; allocate overflow
        newb := h.newoverflow(t, b)
        inserti = &newb.tophash[0]
        insertk = add(unsafe.Pointer(newb), dataOffset)
        elem = add(insertk, bucketCnt*uintptr(t.keysize))
    }
    if t.indirectkey() {
        kmem := newobject(t.key)
        *(*unsafe.Pointer)(insertk) = kmem
        insertk = kmem
    }
    if t.indirectelem() {
        vmem := newobject(t.elem)
        *(*unsafe.Pointer)(elem) = vmem
    }
    typedmemmove(t.key, insertk, key)
    *inserti = top
    h.count++

done:
    if h.flags&hashWriting == 0 { throw("concurrent map writes") }
    h.flags &^= hashWriting
    if t.indirectelem() { elem = *((*unsafe.Pointer)(elem)) }
    return elem
}
```

Important details:

- `growWork(t, h, bucket)` evacuates the current bucket *and* `h.nevacuate` (the head of the queue), guaranteeing forward progress.
- The compiler rewrites `m[k] = v` into `*mapassign(...) = v` so the assignment writes the value into the returned slot. This is why `mapassign` returns `unsafe.Pointer` and why the returned pointer must remain valid until the caller writes — no grow can happen between the two.
- `needkeyupdate` is true for types like `float64` where bit-equal keys (`NaN` vs `NaN`) should still replace the stored representation. Most types skip this copy.
- The check `if h.flags&hashWriting == 0` near `done` catches races where another goroutine cleared the bit. If that happens, throw.

---

## 7. mapdelete and tombstone handling

```go
func mapdelete(t *maptype, h *hmap, key unsafe.Pointer) {
    ...
    if h.flags&hashWriting != 0 { throw("concurrent map writes") }
    hash := t.hasher(key, uintptr(h.hash0))
    h.flags ^= hashWriting

    bucket := hash & bucketMask(h.B)
    if h.growing() { growWork(t, h, bucket) }
    b := (*bmap)(add(h.buckets, bucket*uintptr(t.bucketsize)))
    bOrig := b
    top := tophash(hash)
search:
    for ; b != nil; b = b.overflow(t) {
        for i := uintptr(0); i < bucketCnt; i++ {
            if b.tophash[i] != top {
                if b.tophash[i] == emptyRest { break search }
                continue
            }
            k := add(unsafe.Pointer(b), dataOffset+i*uintptr(t.keysize))
            k2 := k
            if t.indirectkey() { k2 = *((*unsafe.Pointer)(k2)) }
            if !t.key.equal(key, k2) { continue }
            // matched
            if t.indirectkey() { *(*unsafe.Pointer)(k) = nil }
            else if t.key.ptrdata != 0 { memclrHasPointers(k, t.key.size) }
            e := add(unsafe.Pointer(b), dataOffset+bucketCnt*uintptr(t.keysize)+i*uintptr(t.elemsize))
            if t.indirectelem() { *(*unsafe.Pointer)(e) = nil }
            else if t.elem.ptrdata != 0 { memclrHasPointers(e, t.elem.size) }
            else { memclrNoHeapPointers(e, t.elem.size) }
            b.tophash[i] = emptyOne

            // try to extend an emptyRest run backwards
            if i == bucketCnt-1 {
                if b.overflow(t) != nil && b.overflow(t).tophash[0] != emptyRest { goto notLast }
            } else {
                if b.tophash[i+1] != emptyRest { goto notLast }
            }
            for {
                b.tophash[i] = emptyRest
                if i == 0 {
                    if b == bOrig { break }
                    c := b
                    for b = bOrig; b.overflow(t) != c; b = b.overflow(t) {}
                    i = bucketCnt - 1
                } else {
                    i--
                }
                if b.tophash[i] != emptyOne { break }
            }
        notLast:
            h.count--
            if h.count == 0 { h.hash0 = fastrand() } // re-seed empty map
            break search
        }
    }

    if h.flags&hashWriting == 0 { throw("concurrent map writes") }
    h.flags &^= hashWriting
}
```

Three things worth highlighting:

- **Tombstone**: deletion leaves `emptyOne` (a tombstone) in the slot, then tries to extend a trailing `emptyRest` run back through the bucket. The distinction matters for lookups: a lookup that hits `emptyOne` keeps scanning (the tombstone might be hiding a probe path); a lookup that hits `emptyRest` short-circuits the entire chain.
- **GC**: `memclrHasPointers` is used when the type contains pointers — it tells the write barrier that the slot becomes dead. `memclrNoHeapPointers` skips the barrier when safe.
- **Reseed**: when the last entry is deleted, `hash0` is regenerated. So an emptied map will re-randomize its bucket assignment on the next inserts.

The bucket array is **never** shrunk by `delete`. The only way to reclaim it is to drop the map and create a new one.

---

## 8. hashGrow, growWork, and evacuate

```go
func hashGrow(t *maptype, h *hmap) {
    bigger := uint8(1)
    if !overLoadFactor(h.count+1, h.B) {
        bigger = 0
        h.flags |= sameSizeGrow
    }
    oldbuckets := h.buckets
    newbuckets, nextOverflow := makeBucketArray(t, h.B+bigger, nil)

    flags := h.flags &^ (iterator | oldIterator)
    if h.flags&iterator != 0 { flags |= oldIterator }

    h.B += bigger
    h.flags = flags
    h.oldbuckets = oldbuckets
    h.buckets = newbuckets
    h.nevacuate = 0
    h.noverflow = 0

    if h.extra != nil && h.extra.overflow != nil {
        if h.extra.oldoverflow != nil { throw("oldoverflow is not nil") }
        h.extra.oldoverflow = h.extra.overflow
        h.extra.overflow = nil
    }
    if nextOverflow != nil {
        if h.extra == nil { h.extra = new(mapextra) }
        h.extra.nextOverflow = nextOverflow
    }
}
```

Note `iterator` becomes `oldIterator` — the iterator was walking what is now `oldbuckets`, so its provenance flips.

`growWork` is the bridge from "a writer touched bucket X" to "evacuation of bucket X happens now":

```go
func growWork(t *maptype, h *hmap, bucket uintptr) {
    evacuate(t, h, bucket & h.oldbucketmask())
    if h.growing() {
        evacuate(t, h, h.nevacuate)
    }
}
```

`evacuate` itself was sketched in [middle.md](middle.md) §6. The senior takeaways:

- The destination is a pair `xy[0]` (low) and `xy[1]` (high). The evacuator advances pointers within each destination as it copies entries.
- Tophashes in the old bucket are replaced with `evacuatedX`, `evacuatedY`, or `evacuatedEmpty` so that readers know not to use the old bucket — they should redirect to the new array.
- `advanceEvacuationMark` increments `h.nevacuate` past any contiguous evacuated buckets, eventually deciding the grow is complete:

```go
func advanceEvacuationMark(h *hmap, t *maptype, newbit uintptr) {
    h.nevacuate++
    stop := h.nevacuate + 1024
    if stop > newbit { stop = newbit }
    for h.nevacuate != stop && bucketEvacuated(t, h, h.nevacuate) {
        h.nevacuate++
    }
    if h.nevacuate == newbit {
        h.oldbuckets = nil
        if h.extra != nil { h.extra.oldoverflow = nil }
        h.flags &^= sameSizeGrow
    }
}
```

Once `oldbuckets` is nil, subsequent operations no longer pay the dual-bucket cost.

---

## 9. Fast paths: mapaccess1_fast32/64/str

For three common key kinds, the compiler emits calls to specialised functions that skip the type-erasure dance:

```go
func mapaccess1_fast32(t *maptype, h *hmap, key uint32) unsafe.Pointer
func mapaccess1_fast64(t *maptype, h *hmap, key uint64) unsafe.Pointer
func mapaccess1_faststr(t *maptype, h *hmap, ky string) unsafe.Pointer
```

The compiler dispatcher (`cmd/compile/internal/walk/walk.go`) picks the fast path when:

- The key type matches exactly (`uint32`/`int32` → fast32; `uint64`/`int64`/`uintptr` → fast64; `string` → faststr).
- The key size is the bucket's keysize (i.e., not indirect).

`map_fast64.go` (abridged):

```go
func mapaccess1_fast64(t *maptype, h *hmap, key uint64) unsafe.Pointer {
    if h == nil || h.count == 0 { return unsafe.Pointer(&zeroVal[0]) }
    if h.flags&hashWriting != 0 { throw("concurrent map read and map write") }

    var b *bmap
    if h.B == 0 {
        b = (*bmap)(h.buckets)
    } else {
        hash := t.hasher(noescape(unsafe.Pointer(&key)), uintptr(h.hash0))
        m := bucketMask(h.B)
        b = (*bmap)(add(h.buckets, (hash&m)*uintptr(t.bucketsize)))
        if c := h.oldbuckets; c != nil {
            if !h.sameSizeGrow() { m >>= 1 }
            oldb := (*bmap)(add(c, (hash&m)*uintptr(t.bucketsize)))
            if !evacuated(oldb) { b = oldb }
        }
    }
    for ; b != nil; b = b.overflow(t) {
        for i, k := uintptr(0), b.keys(); i < bucketCnt; i, k = i+1, add(k, 8) {
            if *(*uint64)(k) == key && !isEmpty(b.tophash[i]) {
                return add(unsafe.Pointer(b), dataOffset+bucketCnt*8+i*uintptr(t.elemsize))
            }
        }
    }
    return unsafe.Pointer(&zeroVal[0])
}
```

Compared with the generic `mapaccess1`:

- No `t.indirectkey()` branch.
- No `t.key.equal(...)` call — direct `uint64` compare.
- No tophash filter; the integer comparison is cheap enough.
- `B == 0` special case avoids the hash and mask entirely.

`mapaccess1_faststr` is more elaborate because string comparison costs more than `uint64` equality. It still uses the tophash filter, and has separate code paths for short strings (length ≤ 32 — common keys like user IDs) and longer strings.

Benchmarks (typical): fast64 ~1.5× faster than the generic path; faststr ~1.3× faster. The wins shrink with very long keys, where the actual `memequal` dominates.

---

## 10. Iteration: hiter, mapiterinit, mapiternext

```go
type hiter struct {
    key         unsafe.Pointer // *K — set by mapiternext
    elem        unsafe.Pointer // *V — set by mapiternext
    t           *maptype
    h           *hmap
    buckets     unsafe.Pointer // bucket ptr at iteration init
    bptr        *bmap          // current bucket
    overflow    *[]*bmap
    oldoverflow *[]*bmap
    startBucket uintptr        // randomised
    offset      uint8          // randomised offset within bucket
    wrapped     bool
    B           uint8
    i           uint8           // slot index inside current bucket
    bucket      uintptr
    checkBucket uintptr
}
```

`mapiterinit` chooses the start point:

```go
func mapiterinit(t *maptype, h *hmap, it *hiter) {
    it.t = t
    if h == nil || h.count == 0 { return }
    it.h = h
    it.B = h.B
    it.buckets = h.buckets
    if t.bucket.ptrdata == 0 {
        h.createOverflow()
        it.overflow = h.extra.overflow
        it.oldoverflow = h.extra.oldoverflow
    }
    r := uintptr(fastrand())
    if h.B > 31-bucketCntBits { r += uintptr(fastrand()) << 31 }
    it.startBucket = r & bucketMask(h.B)
    it.offset = uint8(r >> h.B & (bucketCnt - 1))
    it.bucket = it.startBucket

    if old := h.flags; old&(iterator|oldIterator) != iterator|oldIterator {
        atomic.Or8(&h.flags, iterator|oldIterator)
    }
    mapiternext(it)
}
```

Two random numbers — one bucket index, one slot offset — completely determine the order. The atomic OR on the flags tells the runtime that an iterator is live, so the next grow will treat `iterator` differently (see `hashGrow`).

`mapiternext` walks bucket by bucket, slot by slot, with the offset rotation applied to the slot index:

```go
func mapiternext(it *hiter) {
    h := it.h
    if h.flags&hashWriting != 0 {
        throw("concurrent map iteration and map write")
    }
    ...
    b := it.bptr
    bucket := it.bucket
    i := it.i
    checkBucket := it.checkBucket
next:
    if b == nil {
        if bucket == it.startBucket && it.wrapped { it.key = nil; it.elem = nil; return }
        if h.growing() && it.B == h.B {
            oldbucket := bucket & it.h.oldbucketmask()
            b = (*bmap)(add(h.oldbuckets, oldbucket*uintptr(t.bucketsize)))
            if !evacuated(b) {
                checkBucket = bucket
            } else {
                b = (*bmap)(add(h.buckets, bucket*uintptr(t.bucketsize)))
                checkBucket = noCheck
            }
        } else {
            b = (*bmap)(add(h.buckets, bucket*uintptr(t.bucketsize)))
            checkBucket = noCheck
        }
        bucket++
        if bucket == bucketShift(it.B) {
            bucket = 0
            it.wrapped = true
        }
        i = 0
    }
    for ; i < bucketCnt; i++ {
        offi := (i + it.offset) & (bucketCnt - 1)
        if isEmpty(b.tophash[offi]) || b.tophash[offi] == evacuatedEmpty {
            continue
        }
        k := add(unsafe.Pointer(b), dataOffset+uintptr(offi)*uintptr(t.keysize))
        ...
        if checkBucket != noCheck && !h.sameSizeGrow() {
            // re-derive the destination bucket; if it doesn't equal checkBucket, skip
            ...
        }
        if (b.tophash[offi] != evacuatedX && b.tophash[offi] != evacuatedY) ||
           !(t.reflexivekey() || t.key.equal(k, k)) {
            it.key = k
            it.elem = ...
        } else {
            // entry was evacuated; locate in new buckets and yield from there
            rk, re := mapaccessK(t, h, k)
            if rk == nil { continue }
            it.key, it.elem = rk, re
        }
        ...
        it.i = i + 1
        it.checkBucket = checkBucket
        return
    }
    b = b.overflow(t)
    i = 0
    goto next
}
```

The two important branches:

- **`checkBucket != noCheck`**: we are iterating an old bucket that has not yet been evacuated. Each entry must be checked against the new bucket index it would go to, so we don't double-yield an entry that we will yield again from the new bucket.
- **`mapaccessK` re-lookup**: when we land on an evacuated entry (during a concurrent grow), we look it up afresh to find its current location and yield from there.

These branches are why the iterator can yield the same key twice (we yielded once from `oldbuckets`, the writer re-inserted it after deletion, we yield it again from `buckets`) or skip a key (we evacuated through it, the writer deleted it from new before our iterator reached new).

---

## 11. Race detection integration

`map.go` peppers race calls everywhere:

```go
if raceenabled && h != nil { raceWriteObjectPC(...) }
if raceenabled && h != nil { raceReadObjectPC(...) }
if msanenabled && h != nil { msanwrite(...) }
if asanenabled && h != nil { asanwrite(...) }
```

These are *additional* to the `hashWriting` check. With `-race`, the runtime calls into TSAN to declare reads/writes of the bucket-array memory. A racy program that *coincidentally* avoids `hashWriting` detection will still trip `-race` with a precise stack trace.

In release builds these calls are compiled away (the `raceenabled` constant is false).

---

## 12. Why mapaccess returns a pointer to the bucket

Three reasons:

1. **`m[k] = v` semantics**: the compiler emits `*mapassign(...) = v` so the value is *written* into the slot inside the bucket. Returning a pointer lets the compiler avoid an extra copy.
2. **Compound expressions**: `m[k]++` is `(*p)++` where `p = mapassign(...)`. The pointer enables in-place updates of values that don't need to be re-hashed.
3. **Avoiding double lookup**: without the pointer, an `m[k]++` would translate to `mapaccess` then `mapassign`, doing the work twice.

This is also exactly why the slot pointer must not survive a grow — and why `mapassign` evacuates *before* returning the pointer. If a write happens between `mapassign`'s return and the caller's store, the underlying bucket may have been moved by another (hypothetical) grow. The single-goroutine assumption keeps this safe.

---

## 13. Version-by-version changes

| Version | Change relevant to map internals |
|---------|----------------------------------|
| 1.0     | Bucket-based hashmap with overflow chains established. |
| 1.5     | Hash function dispatch tightened; AES-NI hash on amd64. |
| 1.7     | `emptyRest` tombstone introduced for faster miss probes. |
| 1.8     | Same-size grow added to compact overflow chains. |
| 1.9     | `mapassign_fast{32,64,faststr}` and matching access fast paths. |
| 1.10    | Hash seed re-randomized on empty (`hash0 = fastrand()`). |
| 1.13    | `mapdelete_fast{32,64,faststr}` added. |
| 1.18    | Generics — type parameters compile to per-instantiation `maptype`; fast paths reused. |
| 1.20    | Better escape analysis around `make(map, hint)`; small maps stay on the stack more often. |
| 1.21    | `clear(m)` built-in added; calls `mapclear` which iterates buckets and resets `hash0`. |
| 1.22    | `for range m` semantics unchanged but `for k := range m` may share a loop variable scope change. |
| 1.24+   | **Swiss-table backend** (build tag, eventually default). New `runtime/map_swiss.go`; 8-slot group + SIMD probe; observable semantics preserved. See proposal #54766. |

The Swiss-table redesign is a layout change, not a semantics change. Iteration is still randomized, concurrent writes still throw, value non-addressability still holds. The internal grow algorithm and overflow concepts are replaced by a different probing strategy (Robin-Hood-style with 8-byte control words).

---

## 14. Summary

A senior reading of `runtime/map.go` shows:

- A single `hmap` per map, with `B` controlling bucket count and `count`/`flags`/`hash0` tracking state.
- `bmap` synthesised per `maptype` with packed keys, packed elems, and one overflow pointer.
- `makemap` allocates lazily; `makeBucketArray` over-allocates for overflow preallocation when `B >= 4`.
- `mapaccess` filters by tophash, falls back to old bucket on grow, and returns an `unsafe.Pointer` to the slot.
- `mapassign` checks `hashWriting`, walks for a match or empty slot, may trigger `hashGrow`, may allocate an overflow bucket.
- `mapdelete` writes a tombstone and tries to extend trailing `emptyRest`. Reseeds `hash0` on emptying.
- `hashGrow` swaps pointers; `growWork` evacuates at most two buckets per write; `evacuate` rehashes only to find the new bit.
- Iterators randomize start bucket and slot, walk old/new buckets in parallel during grow, and may yield duplicates or skip entries if writes happen during iteration.
- Fast paths for `int32`, `int64`, `string` keys avoid the type-erasure overhead.

[professional.md](professional.md) takes this understanding into production: capacity hints, sharded maps, sync.Map, and GC scan costs on large maps.

---

## 15. Further reading

- `runtime/map.go`: https://github.com/golang/go/blob/master/src/runtime/map.go
- `runtime/map_fast32.go` / `_fast64.go` / `_faststr.go`: https://github.com/golang/go/tree/master/src/runtime
- `cmd/compile/internal/walk/builtin.go` — the rewrite of `m[k]` into runtime calls.
- "Inside the Map Implementation" — Keith Randall, GopherCon 2016.
- Go 1.24 Swiss-tables proposal: https://github.com/golang/go/issues/54766
- Matt Kulukundis, "Designing a Fast, Efficient, Cache-friendly Hash Table" (CppCon 2017) — the original Swiss-table talk.
