# `min`, `max` & `clear` Built-ins — Find the Bug

> Each snippet contains a real-world bug related to the Go 1.21 built-ins `min`, `max`, and `clear`. Recall the semantics: `min`/`max` take one or more arguments of an ordered type and return the smallest/largest of the same type, propagating NaN and ordering `-0.0 < +0.0`; they fold to constants when all arguments are constant. `clear(m)` deletes all map entries (including NaN keys); `clear(s)` zeroes a slice's elements without changing its length or capacity. Find the bug, explain it, fix it.

---

## Bug 1 — `clear(s)` expected to empty the slice

```go
func drain(queue []Job) []Job {
    for _, j := range queue {
        process(j)
    }
    clear(queue)          // "reset the queue"
    return queue
}
```

```go
q := drain(q)
fmt.Println(len(q))       // 5, not 0 — every element is now the zero Job
```

**Bug:** `clear(queue)` zeroes every element but leaves `len(queue)` unchanged. The caller expected an empty queue and instead gets a slice of zero-valued `Job`s, which the next loop will "process" as if they were real.

**Fix:** to empty the slice, set its length to zero:

```go
return queue[:0]          // length 0, capacity retained
```

If `Job` contains pointers and you also want to drop references before reuse, do both:

```go
clear(queue)
return queue[:0]
```

---

## Bug 2 — NaN poisons a running maximum

```go
func peakLatency(samples []float64) float64 {
    peak := samples[0]
    for _, s := range samples[1:] {
        peak = max(peak, s)
    }
    return peak
}
```

```go
fmt.Println(peakLatency([]float64{12, 8, math.NaN(), 20}))   // NaN
```

**Bug:** `max` propagates NaN. One NaN sample turns `peak` into NaN, and it stays NaN for every subsequent iteration. The reported peak latency is NaN instead of 20.

**Fix:** filter NaN before reducing:

```go
peak := math.Inf(-1)
for _, s := range samples {
    if !math.IsNaN(s) {
        peak = max(peak, s)
    }
}
```

Decide deliberately whether a NaN sample is an error (return it / log it) or simply skipped. The built-in will not skip it for you.

---

## Bug 3 — `delete` loop can't empty a map with NaN keys

```go
// cache keyed by computed float scores
func reset(cache map[float64]*Entry) {
    for k := range cache {
        delete(cache, k)
    }
}
```

```go
cache[math.NaN()] = e
reset(cache)
fmt.Println(len(cache))   // 1 — the NaN key survived
```

**Bug:** `delete(cache, NaN)` performs a lookup, but `NaN != NaN`, so it never matches and the entry is never removed. The `delete` loop silently leaves NaN keys behind, leaking entries forever.

**Fix:** use `clear`, which empties the map at the runtime level regardless of key reachability:

```go
func reset(cache map[float64]*Entry) {
    clear(cache)
}
```

`clear` is the only correct way to empty any `map[float64]V` that could contain a NaN key.

---

## Bug 4 — `max(slice...)` does not compile

```go
func highest(scores []int) int {
    return max(scores...)          // compile error
}
```

```
./main.go:2:13: invalid use of ... with built-in max
```

**Bug:** `min`/`max` take a fixed list of ordered arguments; they are not variadic over a spread slice. You cannot pass `scores...`.

**Fix:** use the `slices` package for a whole slice:

```go
import "slices"

func highest(scores []int) int {
    return slices.Max(scores)      // panics on empty slice — guard if needed
}
```

If the slice may be empty, check `len(scores) == 0` first, because `slices.Max` panics on an empty slice.

---

## Bug 5 — Mixed argument types

```go
func cap(used int, ratio float64) float64 {
    return max(used, ratio*100)    // compile error
}
```

```
./main.go:2:13: invalid argument: mismatched types int and float64
```

**Bug:** `max(used, ratio*100)` mixes an `int` variable with a `float64` value. The built-ins require all arguments to combine to a single type; two distinct typed operands do not mix.

**Fix:** convert explicitly, deciding which type you actually want:

```go
return max(float64(used), ratio*100)   // float64 result
```

---

## Bug 6 — Array size from a variable `max`

```go
func newBuffer(n int) {
    var buf [max(n, 1024)]byte       // compile error
    _ = buf
}
```

```
./main.go:2:14: array length max(n, 1024) (value of type int) must be constant
```

**Bug:** `min`/`max` fold to a constant *only when all arguments are constant*. Here `n` is a variable, so the expression is a runtime value and cannot be an array length.

**Fix:** use a slice (runtime-sized) rather than an array:

```go
buf := make([]byte, max(n, 1024))    // runtime size is fine for a slice
```

Arrays need a constant length; for a variable-derived size, use a slice.

---

## Bug 7 — `clear(s[:0])` clears nothing

```go
func recycle(buf []*Conn) []*Conn {
    buf = buf[:0]
    clear(buf)             // intended to drop references
    return buf
}
```

**Bug:** the order is reversed. `buf = buf[:0]` first makes the slice length 0, so `clear(buf)` then has *no elements to clear* — the pointers still live in the backing array beyond the new (zero) length, pinning the `*Conn`s. The reference-drop never happens.

**Fix:** clear *before* truncating, so the elements are still in range:

```go
func recycle(buf []*Conn) []*Conn {
    clear(buf)             // zero the live elements first
    return buf[:0]
}
```

Or clear the whole backing array if references can live past `len`:

```go
clear(buf[:cap(buf)])
return buf[:0]
```

---

## Bug 8 — `math.Max` on integers

```go
func cap(x, limit int) int {
    return int(math.Max(float64(x), float64(limit)))   // works but wrong tool
}
```

**Bug:** This compiles, but it round-trips integers through `float64` to call `math.Max`. For large `int` values (beyond 2^53) the float conversion loses precision, and the code is needlessly convoluted. The author reached for `math.Max` out of habit from pre-1.21 code.

**Fix:** use the built-in, which works on `int` directly with no precision loss:

```go
func cap(x, limit int) int {
    return max(x, limit)
}
```

Reserve `math.Max` for code that genuinely needs `float64` IEEE behaviour.

---

## Bug 9 — Reference leak from `s = s[:0]` without `clear`

```go
type Batch struct {
    items []*Record
}

func (b *Batch) Reset() {
    b.items = b.items[:0]      // keep capacity for reuse
}
```

**Bug:** truncating with `s[:0]` keeps the backing array, which still holds every `*Record` pointer. Those records stay reachable and uncollectable for the lifetime of the `Batch`. In a long-lived, reused `Batch` this is a steadily growing memory leak.

**Fix:** drop the references with `clear` before (or instead of) truncating:

```go
func (b *Batch) Reset() {
    clear(b.items)             // nil out every *Record
    b.items = b.items[:0]
}
```

For pointer-element slices, always `clear` before reuse.

---

## Bug 10 — Signed zero surprises a test

```go
func TestNormalize(t *testing.T) {
    got := max(0.0, normalize(-0.0))   // normalize returns its input
    if fmt.Sprint(got) != "0" {
        t.Fatalf("got %v", got)        // sometimes fails printing -0
    }
}
```

**Bug:** `max(0.0, -0.0)` returns `+0.0`, but if `normalize` ever returns a *different* signed zero or the test compares the wrong pair, the printed form can be `-0`. More generally, comparing floats by their string form is fragile because `-0.0` and `0.0` are equal under `==` but print differently. The test conflates value equality with printed form.

**Fix:** compare numerically, not by string, and be explicit about sign if it matters:

```go
if got != 0 {                          // -0.0 == 0.0 is true
    t.Fatalf("got %v", got)
}
```

If the *sign* of zero is semantically important, test it explicitly with `math.Signbit(got)`.

---

## Bug 11 — `clear` on a nil map assumed to panic

```go
func safeReset(m map[string]int) {
    if m == nil {
        return                 // "avoid the panic"
    }
    clear(m)
}
```

**Bug:** Not a crash, but dead defensive code born of a misconception. `clear` on a nil map is a safe no-op — it does not panic (unlike *writing* to a nil map). The `if m == nil` guard is unnecessary.

**Fix:** drop the guard:

```go
func safeReset(m map[string]int) {
    clear(m)                   // safe even if m is nil
}
```

The same applies to `clear` on a nil slice.

---

## Bug 12 — `clamp` with reversed bounds

```go
func clamp(x, lo, hi int) int {
    return min(max(x, lo), hi)
}

clamp(5, 10, 0)               // returns 0 — silently wrong
```

**Bug:** `clamp` assumes `lo <= hi`. With `lo=10, hi=0`, `max(5, 10)` is `10`, then `min(10, 0)` is `0` — a result outside any sensible range, produced silently. The caller passed bounds in the wrong order and got no error.

**Fix:** validate the bounds (or normalize them) when they are caller-supplied:

```go
func clamp(x, lo, hi int) int {
    if lo > hi {
        panic("clamp: lo > hi")     // or swap, or return an error
    }
    return min(max(x, lo), hi)
}
```

For an internal helper with trusted bounds, a comment documenting the precondition may suffice.

---

## Bug 13 — `clear` only the length range, missing capacity residue

```go
func wipe(secret []byte) {
    secret = secret[:0]
    clear(secret)             // wipe the secret
}
```

**Bug:** Two problems. First, `secret = secret[:0]` makes the slice empty, so `clear` zeroes nothing — the secret bytes remain in the backing array. Second, even `clear(secret)` (before truncation) only zeroes `len(secret)` bytes; if the secret was ever in the capacity region (after a prior reslice), those bytes survive. The "wipe" wipes nothing.

**Fix:** clear the full backing array before doing anything else:

```go
func wipe(secret []byte) {
    clear(secret[:cap(secret)])   // zero every byte the slice can reach
}
```

(And note `clear` is hygiene, not a hard secure-erase guarantee — copies may survive elsewhere.)

---

## Bug 14 — `min`/`max` undefined on old `go` directive

```go.mod
module example.com/app

go 1.20
```

```go
x := max(a, b)
```

```
./main.go:1:6: undefined: max
```

**Bug:** The built-ins exist only when the module's `go` directive is `1.21` or higher. With `go 1.20`, the compiler does not predeclare `min`/`max`/`clear`, even on a 1.21+ toolchain. The language-version gate applies.

**Fix:** bump the `go` directive:

```go.mod
go 1.21
```

Run `go mod tidy` afterward. If the project must support older toolchains, keep a build-tagged fallback helper instead.

---

## Bug 15 — Shadowed built-in

```go
func process(values []int) {
    max := 0                          // local variable named max
    for _, v := range values {
        max = maxOf(max, v)           // had to write a helper...
    }
    use(max)
    best := max(values[0], values[1]) // compile error: max is an int
}
```

```
./main.go:8:13: cannot call non-function max (variable of type int)
```

**Bug:** A local variable named `max` shadows the built-in within the function. After `max := 0`, the identifier `max` refers to the `int`, not the built-in, so `max(...)` is a call on a non-function. This is the compatibility mechanism (built-ins can be shadowed) biting an unaware author.

**Fix:** rename the local variable so the built-in stays accessible:

```go
func process(values []int) {
    best := 0
    for _, v := range values {
        best = max(best, v)           // built-in works now
    }
    use(best)
}
```

Avoid naming locals `min`, `max`, or `clear` unless you intend to shadow.

---

## Bug 16 — `clear`-and-reuse on a once-huge map

```go
var seen = make(map[int]struct{})

func dedup(stream <-chan int) {
    for batch := range batches(stream) {     // some batches are millions of items
        for _, x := range batch {
            seen[x] = struct{}{}
        }
        emit(unique(seen))
        clear(seen)                          // reuse across batches
    }
}
```

**Bug:** Not a correctness bug, but a memory one. After a multi-million-item batch, `seen`'s bucket array is huge. `clear(seen)` empties the entries but *retains* the oversized buckets, and `clear` itself is O(bucket count). Every subsequent small batch carries the giant allocation and pays a large clear cost.

**Fix:** for maps whose size varies wildly, reallocate to shed the oversized storage:

```go
seen = make(map[int]struct{})   // fresh small map; GC reclaims the huge one
```

Use `clear`-and-reuse only when the map stays a roughly stable size.

---

## Bug 17 — Empty argument list from a generator

```go
// codegen builds the argument list from a set that can be empty
func emitMax(args []string) string {
    return "max(" + strings.Join(args, ", ") + ")"
}
```

```go
emitMax(nil)        // produces: max()
```

```
./generated.go:1:1: not enough arguments to max
```

**Bug:** `min`/`max` require **at least one argument**. A code generator that builds the argument list from a possibly-empty input set emits `max()`, which does not compile.

**Fix:** special-case the empty (and possibly single) input:

```go
func emitMax(args []string) string {
    switch len(args) {
    case 0:
        return "/* no values */"     // or a sensible default
    case 1:
        return args[0]
    default:
        return "max(" + strings.Join(args, ", ") + ")"
    }
}
```

---

## Bug 18 — `clear` on an array

```go
func zero(grid [9]int) {
    clear(grid)              // compile error
}
```

```
./main.go:2:8: invalid argument: clear expects a map or slice; grid is [9]int
```

**Bug:** `clear` accepts maps and slices, not arrays. (Also, `grid` is passed by value here, so even a working zero wouldn't affect the caller's array.)

**Fix:** slice the array and pass a pointer if the caller's array must change:

```go
func zero(grid *[9]int) {
    clear(grid[:])          // slice of the array
}
```

Now `grid[:]` is a slice over the caller's array, and `clear` zeroes it in place.

---

## Bug 19 — Untyped constant not representable

```go
const ratio = 0.75

func cap(n int) int {
    return min(n, ratio*1000)    // compile error
}
```

```
./main.go:2:12: 750 (untyped float constant) truncated to int
```

**Bug:** `ratio*1000` is `750.0`, an untyped *float* constant. Mixed with the `int` variable `n`, the built-in requires it to be representable as `int`. `750.0` is integral so some forms work, but if the product were non-integral (e.g. `ratio*1001 = 750.75`) it would be rejected — and depending on Go version the float-typed constant trips a truncation error against the int operand.

**Fix:** make the constant an integer, or convert deliberately:

```go
return min(n, int(ratio*1000))   // explicit, intent-revealing
```

Keep constant kinds aligned with the typed operand to avoid surprises.

---

## Bug 20 — Assuming `slices.Max` and `max` behave the same on empty input

```go
func safeMax(xs []int) int {
    if len(xs) == 1 {
        return max(xs...)        // compile error anyway
    }
    return slices.Max(xs)        // panics if xs is empty
}
```

**Bug:** Two issues. `max(xs...)` does not compile (built-ins aren't slice-spread). And `slices.Max(xs)` *panics* on an empty slice, while the author seems to think there is a graceful path. The `len == 1` branch is both wrong and unreachable as written.

**Fix:** guard the empty case explicitly and use `slices.Max` for the rest:

```go
func safeMax(xs []int) (int, bool) {
    if len(xs) == 0 {
        return 0, false
    }
    return slices.Max(xs), true
}
```

`slices.Max` for collections, `max` for fixed arguments, and always guard empty input.

---

## Bug 21 — `clear` not dropping interface references

```go
type Cache struct {
    entries []any
}

func (c *Cache) Flush() {
    c.entries = make([]any, 0, len(c.entries))   // "fresh slice"
}
```

**Bug:** Subtle. `make([]any, 0, len)` allocates a *new* backing array, so the old one — still holding every `any` (and whatever each interface boxed) — is dropped and collectable. That part is actually fine. The real bug is the wasted allocation: a new backing array is built every flush when the existing one could be reused. The author conflated "drop references" (which `clear` does in place) with "allocate fresh."

**Fix:** reuse the existing storage with `clear`, dropping references without allocating:

```go
func (c *Cache) Flush() {
    clear(c.entries)            // drop every boxed value's reference
    c.entries = c.entries[:0]   // reuse the backing array
}
```

This drops references *and* avoids the per-flush allocation.

---

## Bug 22 — Comparing the built-in result against a wrong-typed constant

```go
func bump(level int8) int8 {
    return max(level, 100)       // compile error on some inputs
}
```

```
./main.go:2:21: cannot use 100 ... as int8 value (overflows)
// (when the operand type is int8 and the constant exceeds 127)
```

**Bug:** `level` is `int8` (range -128..127). The untyped constant `100` is representable, but had the code said `max(level, 200)`, the constant `200` overflows `int8` and the call is rejected — the built-in inherits the typed operand's range. The author assumed any integer literal works regardless of the operand's width.

**Fix:** use a constant within the operand's range, or widen the type deliberately:

```go
return max(level, int8(100))     // explicit, within int8 range
// or work in a wider type if larger bounds are needed
```

---

## Summary

`min`, `max`, and `clear` are small, but they encode precise rules that trip people who treat them casually. Most bugs cluster into three families:

1. **`clear` is not truncation, and order matters.** `clear(s)` zeroes elements but keeps the length; to empty a slice use `s = s[:0]`. For pointer slices, `clear` *before* truncating to drop references, and `clear(s[:cap(s)])` if data lives past `len`. `clear(m)` is the *only* way to empty a map with NaN keys.

2. **Floats propagate NaN and order signed zeros.** A single NaN poisons a `min`/`max` reduction; filter deliberately. `-0.0 < +0.0`, and comparing float results by printed form is fragile. The built-ins are not `math.Min`/`math.Max` — don't round-trip ints through `float64` to use the library functions.

3. **Type and arity rules are strict.** All arguments must combine to one ordered type; untyped constants must be representable in the typed operand's range; at least one argument is required; `max(slice...)` doesn't compile (use `slices.Max`); only constant arguments fold for array sizes; and a local named `min`/`max`/`clear` shadows the built-in.

Treat the built-ins as precise tools with exact contracts, mind the float corners, and remember that `clear` empties maps but only zeroes slices — and the rest follows.
