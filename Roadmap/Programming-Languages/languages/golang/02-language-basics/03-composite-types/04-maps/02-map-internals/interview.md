# Map Internals — Interview Q&A

> Author: Bakhodir Yashin Mansur

Questions are grouped by depth. The expected answer is dense; in an interview, give the headline first and elaborate if asked.

---

## A. Layout fundamentals

### Q1. What does a Go map variable *physically* hold?

A single pointer to a `runtime.hmap` struct on the heap. `unsafe.Sizeof(m)` is 8 on 64-bit. The hmap header is ~48 bytes; the actual key/value data lives in a separate bucket array referenced via `hmap.buckets`.

### Q2. What is a bucket and how big is it?

A `runtime.bmap`. It holds an 8-byte `tophash[8]` array, packed slots for 8 keys, packed slots for 8 values, and one `*bmap` overflow pointer. Size depends on K and V; for `map[int64]int64` it is ~144 bytes.

### Q3. Why exactly 8 entries per bucket?

A tuning constant chosen so that a full bucket scan touches a cache line or two and the `tophash` filter can be evaluated in a handful of instructions. `bucketCnt = 1 << 3`.

### Q4. What is `tophash` for?

The high byte of each key's hash. On lookup, the runtime compares one byte per slot before paying the cost of a full key comparison. A few low values are reserved as sentinels (`emptyRest`, `emptyOne`, `evacuatedX/Y/Empty`).

### Q5. Why are keys and values packed separately inside a bucket?

To avoid alignment padding when key and value have different alignments. `kkkkkkkk vvvvvvvv` packs tighter than `kv kv kv ...` for asymmetric pairs.

---

## B. Hashing

### Q6. Where does the hash function come from?

`maptype.hasher` is chosen at compile time based on the key type. `int64` uses `memhash64`, `string` uses `strhash`, etc. The runtime never branches on key kind at lookup time — it just calls the function pointer.

### Q7. What is `hash0` and why is it per-map?

A 32-bit random seed stored in `hmap.hash0`. Initialised by `fastrand()` at `makemap`. Each map gets a different seed so that attackers cannot precompute colliding keys across processes. It is re-randomised when the map becomes empty.

### Q8. Is Go's map hash cryptographically secure?

No. It is `aeshashbody` on amd64 with AES-NI (fast but not a MAC) and `memhash` fallback otherwise. The per-map seed and a handful of mitigations exist, but if you put untrusted keys in a long-lived map you should bound it or use a different structure.

---

## C. Iteration order

### Q9. Why is map iteration order random?

To prevent code from accidentally depending on insertion order or hash collisions. The iterator (`hiter`) picks a random start bucket and a random offset inside that bucket via `fastrand()` at `mapiterinit`.

### Q10. Will two iterations of the same map at the same time give the same order?

No. Each `for range m` call freshly randomizes the start. Two ranges in a row produce different orders.

### Q11. Across two runs of the same program, would order be the same?

No. `hash0` is per-map and `fastrand()` is process-local. Even the same input produces different hashes across runs.

### Q12. Can iteration yield the same key twice?

Yes, if the map is mutated during iteration. During a grow, an entry seen in `oldbuckets` may be re-inserted by another writer and then yielded again from `buckets`. The Go spec explicitly allows this: "If a map entry is created during iteration, that entry may be produced during the iteration or may be skipped."

### Q13. Can iteration skip a key?

Yes, for the same reason: a key deleted from old before it migrates and never appears in new. Also: a key inserted during iteration may be missed if it lands in a bucket already passed.

---

## D. Value addressability

### Q14. Why is `m[k].Field = v` illegal?

Map values are not addressable. The compiler will not give you a pointer to the slot inside a bucket because the runtime may move the slot (a grow may relocate it to another bucket). Allowing pointers into buckets would either pin growth or invalidate pointers under your feet.

### Q15. Workaround?

Two options. (a) Read out, modify, write back: `v := m[k]; v.Field = x; m[k] = v`. (b) Use a pointer-valued map: `map[K]*V` so `m[k].Field = x` works because `m[k]` is now a pointer copy, not a value copy.

### Q16. Why doesn't taking `&m[k]` work either?

Same reason — taking the address would expose an unstable pointer into bucket memory. The compiler rejects `&m[k]` with "cannot take address of map index expression".

---

## E. Growth

### Q17. What is the load factor?

6.5 entries per bucket on average. The trigger is `count > 6.5 * 2^B`. The constants live in `runtime/map.go` as `loadFactorNum = 13`, `loadFactorDen = 2`.

### Q18. Why 6.5 and not 8?

Empirical benchmarks: above 6.5 the number of overflow buckets grows quickly, inflating cache footprint; below 6.5 you waste memory. 6.5 sits at the bottom of the bytes-per-entry curve.

### Q19. What is a same-size grow?

A grow that keeps `B` the same but re-allocates the bucket array and re-packs entries. Triggered when there are too many overflow buckets — typically after lots of insert+delete churn that leaves overflow chains with mostly-empty slots.

### Q20. Is growth synchronous?

No. `hashGrow` swaps pointers; actual migration happens incrementally. Each subsequent insert or delete evacuates at most two old buckets via `growWork`. No single operation pays the full grow cost.

### Q21. How is the bucket destination chosen during a doubling grow?

By one bit of the rehashed key — the bit that the larger mask now exposes. Each old entry maps to "low" (same index in new array) or "high" (index + 2^oldB).

### Q22. Are buckets ever shrunk back?

Not by the runtime. `delete(m, k)` decrements `count` but doesn't deallocate buckets. To reclaim memory you must allocate a fresh map and let the old one be GC'd.

---

## F. Concurrent writes

### Q23. What happens on concurrent writes?

The runtime maintains `hmap.flags & hashWriting`. On entry to `mapassign`, `mapdelete`, or `mapclear`, the runtime checks the bit. If set by another goroutine, it calls `throw("concurrent map writes")` — a fatal error, not a panic.

### Q24. Is the check a lock?

No. It is a debug aid. Two goroutines that race the check before either sets the bit will both proceed and silently corrupt the map. The visible crash is the good outcome.

### Q25. Why a `throw` and not a `panic`?

Because once a map's invariants are broken, the runtime cannot trust itself. Any subsequent operation may corrupt arbitrary memory or call into nonsense pointers. Killing the process is the safe move.

### Q26. Are concurrent reads safe?

Only if there are no concurrent writes. With one writer present, all readers must synchronize — typically via `sync.RWMutex`.

### Q27. Does `-race` catch every concurrent map bug?

It catches more than `hashWriting` does, because it instruments the bucket-array memory at every access. But `-race` is sampling and slower, so it is used in tests, not production. The `hashWriting` check stays on in production.

---

## G. Fast paths

### Q28. What is `mapaccess1_fast64`?

A specialised version of `mapaccess1` that skips the type-erasure dance for 8-byte integer keys. It does a direct `uint64` compare instead of calling `t.key.equal`. ~1.5× faster than the generic path.

### Q29. When does the compiler pick a fast path?

When the key type matches exactly: `int32`/`uint32`/`rune` → `*_fast32`; `int64`/`uint64`/`uintptr` → `*_fast64`; `string` → `*_faststr`; pointer-sized types → `*_fastNNptr`. Otherwise generic.

### Q30. Does a `type ID uint64` get the fast path?

Yes. Defined types with the same kind as `uint64` use the same fast path. Only the size and kind matter.

---

## H. Pre-sizing

### Q31. Why hint the map size at `make` time?

To avoid the chain of doubling grows. `make(map[int]int, 1_000_000)` picks `B` large enough that the initial allocation holds 1M entries without growing. Filling without a hint causes 17 grows for the same insert count.

### Q32. What happens if the hint is wrong?

If too small: normal grows happen later. If too large: the bucket array is over-allocated and that memory is held for the map's lifetime.

### Q33. Is the hint a hard cap?

No, advisory only. The map grows past it normally if you insert more than hinted.

---

## I. Memory and GC

### Q34. Why does GC time grow with map size even if values are not pointers?

It doesn't, if both keys and values are pointer-free (`map[int]int`). GC scans only the hmap header. If keys are strings or values contain pointers, GC walks every bucket and every overflow bucket, scanning pointer slots — which costs time even for empty slots in the chain.

### Q35. How do you reduce GC cost on a 10M-entry pointer-rich map?

Move the values into a contiguous slice indexed by integer. The map becomes `map[K]int` (no pointers in values), and the data lives in `[]V`. GC scans the slice linearly, much cheaper than walking the bucket array.

### Q36. Does `clear(m)` free memory?

No. It resets `count`, re-randomises `hash0`, and zeros the entries — but retains the bucket array. To reclaim memory, drop the map and `make` a new one.

---

## J. Concurrency patterns

### Q37. When is `sync.Map` faster than `map + RWMutex`?

Two patterns: (a) write-once, read-many for distinct keys (config, registries); (b) disjoint key sets per goroutine. Otherwise the overhead of `sync.Map`'s double-map structure makes it slower.

### Q38. What is a sharded map?

An array of `[N]struct{ mu sync.RWMutex; m map[K]V }` where the shard is `hash(key) & (N-1)`. Reduces lock contention proportional to N. Common N is 256.

### Q39. When do you reach for sharding?

When more than ~4 writers contend, or throughput exceeds ~100k QPS on a single map. Below that, `RWMutex` is simpler and fast enough.

### Q40. What is false sharing in sharded maps and how do you avoid it?

Two adjacent shards' mutexes may share a 64-byte cache line. Writes to shard 0 invalidate shard 1's cache. Mitigate by padding each shard struct to a multiple of 64 bytes.

---

## K. Swiss-table backend

### Q41. What is the Swiss-table redesign?

A new map backend (Go 1.24+, proposal #54766) using groups of 8 slots with separate control byte arrays that allow SIMD probing across 8 slots per cycle. Same observable semantics: random iteration order, concurrent-write detection, value non-addressability.

### Q42. Does the new backend change my code?

No. Same API, same semantics. The exact iteration shuffle differs (more reason to never rely on order). Performance characteristics improve, especially for misses and large maps.

### Q43. Is it on by default?

Initially a `GOEXPERIMENT` toggle in 1.24. The default switch and removal of the old backend happen over subsequent releases.

---

## L. Spec-level questions

### Q44. What types can be map keys?

Any **comparable** type: booleans, numerics, strings, pointers, channels, interfaces, and arrays/structs of comparable types. Slices, maps, and functions cannot be keys.

### Q45. What happens reading from a nil map?

You get the zero value of the element type. `m[k]` returns zero; `v, ok := m[k]` returns zero, false. No panic.

### Q46. What about writing to a nil map?

Runtime panic: `assignment to entry in nil map`. Use `make` or a composite literal first.

### Q47. What does `len(m)` cost?

O(1). It returns `hmap.count`.

### Q48. Is `range m` over a nil map an error?

No. It iterates zero times.

---

## M. Edge cases

### Q49. What about `NaN` keys?

`NaN != NaN`, so any `NaN` you insert is unreachable by lookup. The runtime stores it (the bucket has the slot), but `m[math.NaN()]` always returns zero. Inserting many NaNs is a memory leak with no way to delete by key — only `range` plus `delete` (or `clear`) can remove them.

### Q50. Can I take the address of `m["x"]` if value is a pointer?

No, you cannot take the address of the map slot itself. But `m["x"]` evaluates to a pointer value, which you can copy and dereference. The slot in the bucket is still un-addressable.

### Q51. What happens if I `delete` during `range`?

Legal. Per the spec: "If a map entry that has not yet been reached is removed during iteration, the corresponding iteration value will not be produced." Already-yielded entries are unaffected.

### Q52. What about `m[k] = newval` during `range`?

Also legal, but the new entry "may be produced during the iteration or may be skipped". Do not rely on either outcome.

---

## N. Source-level

### Q53. Where is `mapassign` defined?

`src/runtime/map.go`. The fast-path variants live in `map_fast32.go`, `map_fast64.go`, `map_faststr.go`.

### Q54. What does `growWork(t, h, bucket)` do?

Evacuates two buckets: the current operation's `bucket` and `h.nevacuate` (the head of the queue). Guarantees forward progress on grow regardless of which keys are being touched.

### Q55. What is `emptyRest`?

A tophash sentinel meaning "this slot is empty *and* all subsequent slots in this bucket and its overflow chain are empty". Lookups can short-circuit the entire chain when they encounter it.

### Q56. What is `evacuatedX` vs `evacuatedY`?

After a doubling grow's evacuation: `evacuatedX` means "this slot was migrated to the low destination" (same index in new array); `evacuatedY` means "high destination" (index + 2^oldB). Same-size grow uses only `evacuatedX`.

---

## O. Two scenario questions interviewers love

### Q57. "Why is my map slow to look up but a `map[int]int` of the same size is fast?"

Most likely: complex key type (struct, string), so `t.key.equal` is expensive, *and* you are not on a fast path. Switch the key to an integer ID if possible (a separate `map[string]int` for ID lookup, then `map[int]Data`), and the hot map becomes fast-path-eligible.

### Q58. "I see `fatal error: concurrent map writes` from a goroutine I don't control. Where do I start?"

Run with `-race` to get a precise stack trace from both writers. Without `-race`, search for package-level `var X map[...]...` that any handler can touch. Add the appropriate mutex; or, if the access pattern fits, switch to `sync.Map` or a sharded map. Confirm with `-race` afterwards.

---

## P. Trick questions

### Q59. Two maps with the same keys — are their internal bucket layouts the same?

No. `hash0` is different per map, so the same key hashes to a different bucket index. Two empty maps freshly created and identically populated will lay out differently.

### Q60. If I `delete` every key in a map and check `len(m)`, will it be 0?

Yes. `delete` decrements `count` so `len(m) == 0` correctly.

### Q61. Will the *memory* footprint be the same as a fresh empty map after deleting everything?

No. The bucket array is retained.

### Q62. Does `make(map[int]int, 0)` allocate a bucket array?

No. `B == 0` defers the bucket array allocation until the first insert. Iteration and reads on the empty map return immediately.

---

## Summary

The internals topic is mostly answered with three concepts: **bucket+overflow layout**, **incremental grow**, and **the hashWriting flag**. Most other answers cascade from those. If you can re-derive iteration randomness, value non-addressability, and the concurrent-write fatal error from first principles, you can handle almost any map-internals question.
