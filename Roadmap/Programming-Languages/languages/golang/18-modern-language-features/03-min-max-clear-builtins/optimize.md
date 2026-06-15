# `min`, `max` & `clear` Built-ins — Optimization

> Honest framing first: `min`, `max`, and `clear` are tiny operations. `min`/`max` lower to an inlined compare-and-select with no call and no allocation; `clear` lowers to a runtime map-clear or a vectorized memory-zero. None of them is a bottleneck on its own. What is worth optimizing is the *code around* them: removing the hand-rolled helpers and slice allocations they replace, choosing `clear`-and-reuse over reallocation (and knowing when to do the opposite), and using `clear` to fix allocation and reference-leak problems that show up in profiles.
>
> Each entry states the problem, shows a "before" and "after", and the realistic gain. The closing sections cover measurement and the cases where these built-ins are the wrong reach.

---

## Optimization 1 — Replace allocating variadic helpers with the built-in

**Problem:** A pre-1.21 `Max(vals ...int) int` helper allocates a slice for the variadic pack on every call, and the call itself is not inlined across the slice loop.

**Before:**
```go
func Max(vals ...int) int {
    m := vals[0]
    for _, v := range vals[1:] {
        if v > m { m = v }
    }
    return m
}

best := Max(a, b, c)        // allocates a []int{a, b, c} each call
```

**After:**
```go
best := max(a, b, c)        // no slice, no allocation, inlined fold
```

**Expected gain:** Eliminates one heap (or stack) slice allocation per call and removes the loop overhead. In hot paths called millions of times, this removes measurable allocation pressure and GC work. The built-in's multi-argument form is a compile-time-unrolled fold — strictly cheaper than packing a slice.

---

## Optimization 2 — Drop the `math.Max`/`float64` round-trip on integers

**Problem:** Legacy code computes integer maxima by converting to `float64`, calling `math.Max`, and converting back — extra instructions and, for large integers, precision loss.

**Before:**
```go
n := int(math.Max(float64(a), float64(b)))
```

**After:**
```go
n := max(a, b)
```

**Expected gain:** Removes two `int`→`float64` conversions and one `float64`→`int` conversion per call, plus the (non-inlined in older code) `math.Max` call. For `int` values beyond 2^53 it also fixes a correctness bug (float can't represent them exactly). Pure win: faster, simpler, and more correct.

---

## Optimization 3 — `clear`-and-reuse a map instead of reallocating per iteration

**Problem:** A loop allocates a fresh map every iteration to "reset" it, producing one map allocation per cycle and steady GC pressure.

**Before:**
```go
for _, batch := range batches {
    seen := make(map[string]struct{}, len(batch))   // alloc every iteration
    for _, item := range batch {
        seen[item] = struct{}{}
    }
    process(seen)
}
```

**After:**
```go
seen := make(map[string]struct{}, 1024)
for _, batch := range batches {
    clear(seen)                                       // reuse the storage
    for _, item := range batch {
        seen[item] = struct{}{}
    }
    process(seen)
}
```

**Expected gain:** One map allocation total instead of one per iteration. On a loop over thousands of batches this removes thousands of allocations and the GC work to reclaim them. Confirm with `-benchmem`: allocs/op should drop to near zero for the map.

---

## Optimization 4 — Know when reallocation beats `clear` (the once-huge map)

**Problem:** `clear`-and-reuse is applied blindly to a map whose size varies wildly. After a huge batch, `clear` is O(bucket count) and retains the oversized bucket array, so every later small batch carries the giant allocation and pays a large clear cost.

**Before:**
```go
seen := make(map[int]struct{})
for _, batch := range batches {         // one batch is 10M items, rest are 100
    for _, x := range batch { seen[x] = struct{}{} }
    process(seen)
    clear(seen)                          // retains 10M-bucket array forever
}
```

**After:**
```go
for _, batch := range batches {
    seen := make(map[int]struct{}, len(batch))   // sized per batch
    for _, x := range batch { seen[x] = struct{}{} }
    process(seen)
    // GC reclaims the per-batch map; no oversized residue
}
```

**Expected gain:** Releases the oversized backing storage after the big batch instead of pinning it. The right rule: `clear`-and-reuse for *stable* sizes; reallocate when the size varies wildly. Measure peak RSS, not just allocs/op — this is a memory-footprint optimization, not a throughput one.

---

## Optimization 5 — `clear` to fix reference leaks in reused slices

**Problem:** A long-lived, reused `[]*T` is reset with `s = s[:0]`, leaving the backing array full of old pointers. The referenced objects stay reachable; memory grows over time. A heap profile shows the leak.

**Before:**
```go
func (b *Buffer) Reset() {
    b.items = b.items[:0]        // backing array still holds every *Record
}
```

**After:**
```go
func (b *Buffer) Reset() {
    clear(b.items)               // drop references so the GC can reclaim them
    b.items = b.items[:0]
}
```

**Expected gain:** The previously pinned objects become collectable, flattening a slowly rising heap. This is a correctness-and-memory fix, not a speed one — but it is often the single most impactful use of `clear` in production code.

---

## Optimization 6 — Use the recognized memclr idiom or `clear` instead of a manual loop

**Problem:** Zeroing a slice with a hand-written index loop is verbose, and while the compiler recognizes the idiom, the intent is unclear and easy to get subtly wrong.

**Before:**
```go
for i := 0; i < len(buf); i++ {
    buf[i] = 0
}
```

**After:**
```go
clear(buf)                       // lowers to vectorized memclr for []byte/[]int/...
```

**Expected gain:** Identical or better generated code (both reach `runtime.memclrNoHeapPointers` for pointer-free elements), in one clear line. For pointer-element slices, `clear` also emits the GC-aware clear correctly, which a careless manual loop might not. Clarity plus correctness at no runtime cost.

---

## Optimization 7 — Bound a growing value with `min` instead of a branch

**Problem:** Exponential backoff or buffer-growth code caps a value with an explicit `if`, which is more code and occasionally gets the comparison direction wrong.

**Before:**
```go
wait := base << attempt
if wait > maxWait {
    wait = maxWait
}
```

**After:**
```go
wait := min(base<<attempt, maxWait)
```

**Expected gain:** No runtime difference — both compile to a compare-and-select — but the one-liner is clearer and removes a class of off-by-direction bugs. The optimization here is readability and correctness density, not cycles.

---

## Optimization 8 — Avoid allocating a slice just to call a reducer

**Problem:** Code collects a handful of values into a temporary slice solely to find their maximum, allocating needlessly.

**Before:**
```go
candidates := []int{a, b, c, d}
best := slices.Max(candidates)   // allocates a 4-element slice
```

**After:**
```go
best := max(a, b, c, d)          // no slice, fixed-arg fold
```

**Expected gain:** Removes the temporary slice allocation. Use `slices.Max` only when the values *already* live in a slice; for a fixed set of values, the built-in's variadic form is allocation-free.

---

## Optimization 9 — Combine `clear` with `maps.Copy` for allocation-free map refresh

**Problem:** Refreshing a destination map from a source with `maps.Clone` allocates a brand-new map every time.

**Before:**
```go
dst = maps.Clone(src)            // allocates a new map per refresh
```

**After:**
```go
clear(dst)                       // reuse dst's storage
maps.Copy(dst, src)
```

**Expected gain:** Reuses the destination's backing storage across refreshes instead of allocating each time. On a frequently refreshed map this removes per-refresh allocations. (Apply the once-huge caveat from Optimization 4 if sizes vary wildly.)

---

## Optimization 10 — Constant-fold limits at compile time

**Problem:** A size or limit derived from two constants is computed with a runtime helper, forcing it out of constant contexts and preventing its use as an array size.

**Before:**
```go
var limit = computeMax(MinBuf, DefaultBuf)   // runtime function → not a constant
buf := make([]byte, limit)
```

**After:**
```go
const Limit = max(MinBuf, DefaultBuf)        // folded at compile time
var buf [Limit]byte                          // can now be a fixed-size array
```

**Expected gain:** The limit becomes a true compile-time constant, usable as an array length and in other `const` expressions, with zero runtime cost. This is a capability the built-ins have that no function call does — leverage it where the bound is genuinely constant.

---

## Optimization 11 — Delete duplicated helpers to shrink the binary and the cognitive load

**Problem:** A codebase carries `maxInt`, `minInt`, `maxInt64`, `maxFloat`, etc., scattered across packages — dead weight after Go 1.21, and a source of inconsistency.

**Before:**
```go
// in five different packages
func maxInt(a, b int) int { if a > b { return a }; return b }
func minInt(a, b int) int { if a < b { return a }; return b }
```

**After:**
```bash
gofmt -r 'maxInt(a, b) -> max(a, b)' -w ./...
gofmt -r 'minInt(a, b) -> min(a, b)' -w ./...
# then delete the now-unused helpers
```

**Expected gain:** Removes duplicated functions (slightly smaller binary, less to maintain), gives the codebase one canonical spelling, and lets the inliner treat every call uniformly. The real win is maintainability; the binary-size effect is marginal but real.

---

## Optimization 12 — Clear pooled buffers to keep `sync.Pool` effective

**Problem:** A `sync.Pool` of slices returns dirty buffers (old data, old references), forcing callers to allocate fresh anyway or risk leaks — defeating the pool.

**Before:**
```go
func put(buf []*Job) {
    pool.Put(buf)                // returns a slice still referencing old Jobs
}
```

**After:**
```go
func put(buf []*Job) {
    clear(buf)                   // drop references
    pool.Put(buf[:0])            // return clean, empty, allocated
}
```

**Expected gain:** The pool actually recycles storage instead of pinning old objects, so the pool's hit rate translates into real allocation savings and no reference leak. Without the `clear`, a pool of pointer slices is a memory hazard.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For these built-ins the useful signals are:

```go
// min/max: FORCE non-constant inputs or the call folds away and you measure nothing.
func BenchmarkMax(b *testing.B) {
    x, y := 3, 7              // variables, not constants
    var sink int
    for i := 0; i < b.N; i++ {
        sink = max(x, y)
    }
    _ = sink
}
```

```bash
# clear-and-reuse vs reallocate: watch allocs AND peak memory
go test -bench=Map -benchmem ./...

# inspect the generated code for min/max (confirm no call, no alloc)
go build -gcflags=-S ./... 2>&1 | grep -A5 'max'

# heap profile to confirm a clear-based leak fix actually flattens the heap
go test -memprofile=mem.out -bench=. ./...
go tool pprof -top mem.out
```

Two metrics matter most: **allocations per operation** (the headline gain from removing variadic helpers and from `clear`-and-reuse) and **peak resident memory** (the signal that tells you whether `clear`-and-reuse on a once-huge map is helping or hurting).

---

## When NOT to Reach for These

- **`clear` as a secure-erase primitive.** It zeroes the slice's elements but gives no guarantee that copies in registers, on the stack, or in GC-relocated memory are gone. For key material, use a dedicated wipe and accept Go's lack of a hard guarantee.
- **`clear`-and-reuse on wildly varying sizes.** Retaining a once-huge bucket array can cost more memory than the allocations you saved. Reallocate to shed it.
- **`max(slice...)` to reduce a collection.** It does not compile; `slices.Max`/`slices.Min` own that job. Do not allocate a slice just to reduce it, but do not try to spread one into the built-in either.
- **`min`/`max` on floats without a NaN policy.** A single NaN poisons the result. If inputs can be NaN, decide explicitly (filter, error, or accept poisoning) — the built-in's "optimization" of being branch-free is not worth a silently-NaN metric.
- **Micro-optimizing `min`/`max` themselves.** They are already a compare-and-select. There is nothing to tune; spend the effort on the allocations and leaks around them.

---

## Summary

`min`, `max`, and `clear` are not slow — they are about as cheap as operations get: inlined compare-and-select, or a vectorized/runtime memory clear. The optimizations are all in the surrounding code. Replace allocating variadic helpers and `math.Max` round-trips with the built-ins to cut allocations and conversions. Use `clear`-and-reuse to remove per-iteration map allocations — but reallocate instead when a map's size varies wildly, to shed oversized storage. Reach for `clear` to fix reference leaks in reused pointer slices and to keep `sync.Pool` buffers clean. Constant-fold limits with `min`/`max` where the bounds are genuinely constant. And measure the two metrics that actually move — allocations per operation and peak memory — rather than benchmarking the built-ins in isolation, where the compiler will fold a constant call to nothing and tell you everything is free.
