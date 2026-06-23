# Map Internals — Middle

> Author: Bakhodir Yashin Mansur

## 1. Where this file fits

[junior.md](junior.md) introduced `hmap`, the 8-slot bucket, tophash, iteration randomness, value non-addressability, and the concurrent-write crash. This file goes one layer deeper:

- The exact `hmap` field set.
- The **load factor 6.5** and the math behind it.
- The grow trigger and the difference between **doubling grow** and **same-size grow**.
- Overflow buckets — how they are allocated, when they accumulate, and why they matter.
- The `hashWriting` flag and the precise sequence of checks around concurrent writes.
- Why an iteration that runs across a grow may yield the same key twice or skip a key entirely.

Everything in this file is consistent with the classic ("legacy") Go map implementation that shipped from Go 1.0 through Go 1.23. The Swiss-table redesign in Go 1.24+ keeps the same observable semantics but changes the layout; see [specification.md](specification.md) §10.

---

## 2. The `hmap` struct in full

From `runtime/map.go`:

```go
type hmap struct {
    count     int            // # live cells == size of map
    flags     uint8          // iterator/writer state bits
    B         uint8          // log_2 of # of buckets (so 2^B buckets)
    noverflow uint16         // approximate count of overflow buckets
    hash0     uint32         // hash seed

    buckets    unsafe.Pointer // 2^B buckets; nil if count==0
    oldbuckets unsafe.Pointer // previous bucket array, half the size, non-nil during grow
    nevacuate  uintptr        // progress counter for incremental evacuation

    extra *mapextra            // optional fields: overflow trackers, nextOverflow
}

type mapextra struct {
    overflow     *[]*bmap   // overflow buckets in `buckets` that hold pointer keys/values
    oldoverflow  *[]*bmap   // same but for `oldbuckets`
    nextOverflow *bmap      // preallocated overflow bucket available for reuse
}
```

Three fields drive almost everything below:

- `B` decides how many buckets exist (`1 << B`).
- `count` is compared against `loadFactor * 2^B` on every insert to decide whether to grow.
- `oldbuckets != nil` means "we are mid-grow"; many code paths split into "growing" vs "not growing" branches.

---

## 3. The load factor — why 6.5?

The trigger for a doubling grow is:

```go
// runtime/map.go
const (
    loadFactorNum = 13
    loadFactorDen = 2          // → 6.5
    bucketCntBits = 3
    bucketCnt     = 1 << bucketCntBits  // 8
)

func overLoadFactor(count int, B uint8) bool {
    return count > bucketCnt &&
        uintptr(count) > loadFactorNum*(bucketShift(B)/loadFactorDen)
}
```

So the threshold is `(13/2) * 2^B = 6.5 buckets-worth-of-entries`. Why 6.5 and not 8 (the bucket capacity)?

Three empirical points from the runtime authors' benchmarks (see comments at the top of `map.go`):

| Load factor | Bytes/entry | Hit / miss probes | Overflow buckets per 100 buckets |
|-------------|------------|-------------------|----------------------------------|
| 4.0         | 27.0       | 1.2 / 1.5         | 1.4                              |
| 6.0         | 21.8       | 1.4 / 1.9         | 13                               |
| **6.5**     | **20.5**   | **1.6 / 2.1**     | **20**                           |
| 7.0         | 19.7       | 1.7 / 2.4         | 30                               |
| 8.0         | 18.0       | 2.0 / 3.1         | 73                               |

At 6.5 the bytes-per-entry curve flattens, but the overflow-bucket count is still small enough that miss probes stay near 2. Higher loads start producing too many overflow buckets, which inflate cache footprint. Lower loads waste memory.

The constant is not in the language spec — it is a runtime tuning value. The Swiss-table redesign moves it.

---

## 4. The two kinds of grow

The runtime has two distinct grow modes. Both swap `oldbuckets` into place; the difference is the **size** of the new `buckets` array.

### 4.1 Doubling grow

Triggered when `overLoadFactor` is true, i.e. `count > 6.5 * 2^B`. Action:

- `B++`, so the new array has 2× the buckets.
- A key that was in old bucket `i` will be in new bucket `i` **or** `i + 2^oldB`, depending on the bit of its hash now exposed by the larger mask.

### 4.2 Same-size grow

Triggered when `tooManyOverflowBuckets(noverflow, B)` returns true. The criterion is roughly `noverflow >= 2^min(B, 15)` — a load-independent ceiling. Action:

- `B` stays the same.
- New array has the same number of main buckets.
- Each entry is re-placed into its original bucket, but **without** overflow chains — slots that were spread across overflow buckets are now packed back into main buckets.

This handles the failure mode where a map has many inserts followed by many deletes: overflow buckets accumulate (one was needed for a 9th entry that has since been deleted), but the load factor never trips. The same-size grow compacts those wasted slots back into the main buckets.

In `runtime/map.go`:

```go
func hashGrow(t *maptype, h *hmap) {
    bigger := uint8(1)
    if !overLoadFactor(h.count+1, h.B) {
        bigger = 0
        h.flags |= sameSizeGrow
    }
    oldbuckets := h.buckets
    newbuckets, nextOverflow := makeBucketArray(t, h.B+bigger, nil)
    ...
    h.B += bigger
    h.flags = ...                 // preserve iterator/sameSizeGrow bits
    h.oldbuckets = oldbuckets
    h.buckets = newbuckets
    h.nevacuate = 0
    h.noverflow = 0
    ...
}
```

Notice the structure: doubling grow and same-size grow share `hashGrow`. The only difference is `bigger = 0 or 1` and the `sameSizeGrow` flag.

---

## 5. Incremental evacuation

If grow were synchronous, the operation that pushed the map across the threshold would pay the cost of moving every entry. For a 10-million-entry map that is unacceptable. So grow is **incremental**:

- `hashGrow` only swaps the pointers — no entries move yet.
- Each subsequent insert or delete migrates **at most two old buckets** into the new array via `evacuate`.
- Once all old buckets are evacuated, `oldbuckets` becomes `nil` and the map is "settled" again.

The `nevacuate` counter tracks progress: it is the index of the next old bucket to migrate. `evacuate(t, h, oldbucket)` is called on:

- `oldbucket = bucket & (oldbucketmask)` — the bucket your current operation touches.
- `oldbucket = h.nevacuate` — to ensure forward progress even on idle keys.

This pattern is sometimes called "the cooperative-grow": the work is paid for by the same flow of operations that grew the map in the first place.

Per-operation cost: at most 2 bucket evacuations. A bucket has 8 entries plus overflow, so the worst-case per-operation cost is bounded by the longest overflow chain. In practice (load factor 6.5) chains are short and the amortized cost is tiny.

---

## 6. The evacuation algorithm

```go
func evacuate(t *maptype, h *hmap, oldbucket uintptr) {
    b := (*bmap)(add(h.oldbuckets, oldbucket*uintptr(t.bucketsize)))
    newbit := h.noldbuckets()        // 2^oldB
    if !evacuated(b) {
        // xy[0] is the "low" destination bucket: same index in new array
        // xy[1] is the "high" destination bucket: index + newbit
        var xy [2]evacDst
        xy[0].b = (*bmap)(add(h.buckets, oldbucket*uintptr(t.bucketsize)))
        xy[0].k = add(unsafe.Pointer(xy[0].b), dataOffset)
        xy[0].e = add(xy[0].k, bucketCnt*uintptr(t.keysize))

        if !h.sameSizeGrow() {
            xy[1].b = (*bmap)(add(h.buckets, (oldbucket+newbit)*uintptr(t.bucketsize)))
            xy[1].k = add(unsafe.Pointer(xy[1].b), dataOffset)
            xy[1].e = add(xy[1].k, bucketCnt*uintptr(t.keysize))
        }

        for ; b != nil; b = b.overflow(t) {
            k := add(unsafe.Pointer(b), dataOffset)
            e := add(k, bucketCnt*uintptr(t.keysize))
            for i := 0; i < bucketCnt; i, k, e = i+1, add(k, uintptr(t.keysize)), add(e, uintptr(t.elemsize)) {
                top := b.tophash[i]
                if isEmpty(top) {
                    b.tophash[i] = evacuatedEmpty
                    continue
                }
                ...
                var useY uint8
                if !h.sameSizeGrow() {
                    hash := t.hasher(k, uintptr(h.hash0))
                    if hash&newbit != 0 {
                        useY = 1
                    }
                }
                b.tophash[i] = evacuatedX + useY
                dst := &xy[useY]
                ...
                // copy key and value to dst, advance dst pointers
            }
        }
        ...
    }

    if oldbucket == h.nevacuate {
        advanceEvacuationMark(h, t, newbit)
    }
}
```

The key insight: for a doubling grow, each old entry has exactly two possible destinations — bucket `i` (low) or bucket `i + 2^oldB` (high) — and the bit that decides this is the one new bit exposed by the larger mask. The evacuator rehashes each key just to recover that bit; everything else is a byte copy.

For a same-size grow, every entry goes to bucket `i` of the new array — `useY` is always 0.

---

## 7. Overflow buckets

When you insert a 9th key whose hash points at an already-full bucket, the runtime needs a 9th slot. It allocates an **overflow bucket** and links it through the original bucket's `overflow` pointer:

```
[bucket]  → [overflow_1] → [overflow_2] → nil
 8 entries     8 entries     8 entries
```

The runtime preallocates a small pool of overflow buckets during `makeBucketArray`, kept in `h.extra.nextOverflow`. The first few overflow needs are served from this pool with no allocation. Once exhausted, each new overflow bucket is a fresh allocation.

`hmap.noverflow` tracks the count approximately (it is incremented under different conditions for different sizes — see `runtime/map.go newoverflow`). The approximation is good enough for the `tooManyOverflowBuckets` check.

Long overflow chains slow lookups: a miss must scan every bucket in the chain. The `hashGrow` machinery is what keeps chains short.

---

## 8. The `flags` byte and the writing detector

```go
const (
    iterator     = 1 // there may be an iterator using buckets
    oldIterator  = 2 // there may be an iterator using oldbuckets
    hashWriting  = 4 // a goroutine is writing to the map
    sameSizeGrow = 8 // current map growth is same-size grow
)
```

The check inside `mapassign`:

```go
func mapassign(t *maptype, h *hmap, key unsafe.Pointer) unsafe.Pointer {
    if h == nil { panic(plainError("assignment to entry in nil map")) }
    if raceenabled { raceWriteObjectPC(...) }
    if msanenabled { msanwrite(...) }

    if h.flags&hashWriting != 0 {
        throw("concurrent map writes")
    }
    hash := t.hasher(key, uintptr(h.hash0))
    h.flags ^= hashWriting     // set the bit
    ...
    // perform the write
    if h.flags&hashWriting == 0 {
        throw("concurrent map writes")   // someone reset it under us
    }
    h.flags &^= hashWriting    // clear the bit
    return val
}
```

`mapaccess1` does **not** check `hashWriting` directly, but `mapaccess1_fast32`/`fast64`/`faststr` do an early check that surfaces some races. The `-race` detector instruments reads and writes more thoroughly than the built-in `hashWriting` test.

Why is the failure a `throw` (fatal) and not a `panic` (recoverable)? Because once the map's invariants are violated, **any** subsequent operation may corrupt arbitrary memory. The runtime cannot trust itself after the fact. Killing the process is the only safe response.

The protection is not a lock. Two writes that race the check before either sets the bit will both proceed and silently corrupt the map. Use `sync.RWMutex` or `sync.Map`.

---

## 9. Iteration anomalies during grow

If you start iterating a map and then mutate it during the iteration, the spec says:

> The iteration order over maps is not specified and is not guaranteed to be the same from one iteration to the next. If a map entry that has not yet been reached is removed during iteration, the corresponding iteration value will not be produced. If a map entry is created during iteration, that entry may be produced during the iteration or may be skipped.

The runtime implementation is more specific. The iterator (`hiter` in `runtime/map.go`) snapshots:

- `buckets` and `oldbuckets` pointers at iteration start.
- A random `startBucket` and `offset` inside that bucket.

It walks each bucket using a checkBucket dance:

- For each old bucket, the iterator must decide whether to read from `oldbuckets` (if the bucket has not been evacuated) or skip it (it has been evacuated; the new buckets will produce its entries).
- For each new bucket, similar logic in reverse.

Now imagine this sequence:

1. Iteration starts at new bucket 5. The map is in grow; `oldbuckets` still has data.
2. The iterator reaches new bucket 5 and reads key `K1`. `K1` came from old bucket `5 mod oldB`.
3. The iterator continues, eventually reaching old bucket `5 mod oldB`. It must decide whether `K1` has already been produced.

The check is conservative: if the bucket has been evacuated, the iterator scans the *destination* low bucket (the same bucket it already produced from) for the key. This is correct in the static case, but when the program **also writes** to the map mid-iteration, an entry that has been moved between buckets can be yielded twice (once from oldbuckets, once from new buckets after a re-insertion), or skipped (deleted from oldbuckets, never present in new).

The reference comment in `runtime/map.go` is explicit:

> If a map entry that has not yet been reached is removed during iteration, the corresponding iteration value will not be produced. If a map entry is created during iteration, that entry may be produced during the iteration or may be skipped.

Mutating a map during iteration is *legal* but the result is unpredictable. The conservative pattern is to collect keys into a slice first, then iterate the slice.

---

## 10. Worked example: walking through a grow

Start with `B = 2`, so 4 buckets and a doubling threshold of `6.5 * 4 = 26`. Insert keys until count = 26; the next insert tips us over. Trace:

```
state before insert #27:
  B=2, count=26
  buckets = [b0 b1 b2 b3]    (each has up to 8 entries, possibly overflow)

step 1: mapassign called
  - overLoadFactor(27, 2) == true  → hashGrow
  - new bucket array allocated with B=3, 8 buckets
  - oldbuckets = previous 4 buckets
  - buckets    = new 8 buckets
  - h.B = 3
  - h.nevacuate = 0
  - No entries moved yet.

step 2: still inside mapassign, write the new entry
  - growWork is called: evacuate(t, h, nevacuate=0) AND evacuate(t, h, targetBucket)
  - say target is new bucket 5, which corresponds to old bucket 1 → evacuate(1) and evacuate(0)
  - After evacuation, the entry for the new key is written into new bucket 5.

step 3: subsequent inserts/deletes each call growWork
  - At most 2 buckets evacuated per call.
  - After ~4 more operations, all old buckets are evacuated.
  - h.oldbuckets = nil; grow is done.
```

The amortized per-operation cost is `O(1)`. No single operation pays more than the cost of evacuating two buckets.

---

## 11. Why `runtime` uses `hash & (2^B - 1)` and not modulo

Bucket selection:

```go
bucket := hash & bucketMask(h.B)   // hash & (1<<B - 1)
```

Two reasons for bitmask over modulo:

1. **Speed**: `&` is one cycle; `mod` is many.
2. **Compatibility with doubling grow**: when `B` increases by 1, the new mask exposes exactly one more bit. The old bucket `i` maps to either new bucket `i` or new bucket `i + 2^oldB`, which is exactly the "low / high" split the evacuator uses. With a modulo operation, the relationship between old and new buckets would be much more complex.

This is also why bucket counts are always powers of two — modulo and bitmask agree only on powers of two.

---

## 12. When a grow is paused

`growWork` is called from `mapassign` and `mapdelete`. It is **not** called from `mapaccess`. So a map that is being read-only after a grow trigger will sit in mid-grow indefinitely — `oldbuckets != nil`, lookups must check both old and new buckets, and you pay a small performance tax forever.

In practice this is rare because grow is triggered by inserts, and a map that takes only inserts will keep evacuating. But a steady-state read-mostly map after a delete-driven same-size grow can stall.

The check in `mapaccess1`:

```go
if h.oldbuckets != nil {
    if !h.sameSizeGrow() { m >>= 1 }
    oldb := (*bmap)(add(c, (hash&m)*uintptr(t.bucketsize)))
    if !evacuated(oldb) {
        b = oldb
    }
}
```

The lookup looks at the old bucket if it has not been evacuated yet. So correctness is preserved; only performance is degraded.

---

## 13. Concurrent reads vs concurrent writes

The Go memory model and the runtime together give you these rules:

| Goroutines | Operation | Safe? |
|------------|-----------|-------|
| Many       | Read only | Yes |
| Many       | Read + one writer with external sync | Yes with sync |
| Many       | Read with concurrent writer (no sync) | **No** — fatal or silent corruption |
| Many       | Concurrent writers | **No** — fatal or silent corruption |

"External sync" means a mechanism that establishes a happens-before relationship between the writer's completion and the readers' start. `sync.RWMutex` is the canonical choice. Channels also work but are usually overkill for in-memory data.

For maps that are written rarely and read often by many goroutines, `sync.Map` is *not* the right choice — `RWMutex` is faster. `sync.Map` shines when the access pattern is "many distinct keys, mostly read, occasional write, never read after write the same key heavily". See [professional.md](professional.md) §3.

---

## 14. Hash seed and adversarial input

`hmap.hash0` is set by `fastrand()` at `makemap` time. Every map has its own seed. So even if you somehow knew the algorithm Go uses (it is `aeshashbody` on amd64 with AES-NI, FNV-based fallback elsewhere), you cannot precompute colliding keys without first observing some hashes from this particular map.

The mitigations are *partial*: the hash itself is not cryptographic, and the runtime does not rehash with a new seed on grow. An attacker who can observe iteration order or insertion-induced grows in a long-running map could mount a hash-flooding attack over time.

In practice, if you take untrusted keys (HTTP headers, query params, anything user-controlled) and stash them in a long-lived map, prefer:

- A bounded cache with eviction (so attacker keys roll out).
- A pre-validated key shape (numeric IDs, hashed forms).
- An explicit `sync.Map` for the read-mostly case, since its top-level read map is replaced wholesale, breaking accumulated collisions.

---

## 15. A practical mental model

To reason about a map at the middle level, ask three questions:

1. **Where is this key likely to land?** `hash & (2^B - 1)`. If `B` is small and the hash distribution is bad, expect collisions.
2. **What state is the map in?** `oldbuckets == nil` means "settled"; non-nil means "growing". Inserts and deletes are slightly more expensive during grow.
3. **Who writes to this map?** A single goroutine? Multiple with `RWMutex`? Multiple without? The last case is a latent crash.

Three rules of thumb fall out:

- Pre-size with `make(map[K]V, hint)` if you know the final count. It picks an initial `B` that avoids a grow. See [optimize.md](optimize.md) §3.
- For maps with high write churn and many goroutines, prefer **sharded** maps (an array of `[N]struct{ m map; mu sync.Mutex }` keyed by `hash(key) % N`) over a single `RWMutex`. See [optimize.md](optimize.md) §6.
- For maps that drain to small after being large, copy the live entries into a fresh map and let the old one be collected.

---

## 16. Summary

- `hmap` carries `count`, `B`, `buckets`, `oldbuckets`, `hash0`, and a `flags` byte.
- Load factor is 6.5: a doubling grow triggers when `count > 6.5 * 2^B`.
- Same-size grow triggers when overflow buckets accumulate beyond a fixed threshold — compacts entries back into main buckets.
- Grow is **incremental**: each insert/delete migrates at most two old buckets.
- The `hashWriting` bit detects concurrent writes — turns them into a fatal error, not a panic.
- Iteration across a concurrent write or grow can yield the same key twice or skip a key; this is intentional, not a bug.

Next: [senior.md](senior.md) walks the actual functions in `runtime/map.go` line by line.

---

## 17. Further reading

- `runtime/map.go`: https://github.com/golang/go/blob/master/src/runtime/map.go
- Keith Randall, "Inside the Map Implementation" (GopherCon 2016)
- Go spec on for-range over maps: https://go.dev/ref/spec#For_statements
- Go memory model: https://go.dev/ref/mem
- Swiss-tables proposal: https://github.com/golang/go/issues/54766
