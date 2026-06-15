# `min`, `max` & `clear` Built-ins — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end. All require Go 1.21+ with `go 1.21`+ in `go.mod`.

---

## Easy

### Task 1 — Basic `min`/`max`

In a `main.go`, print the results of:

```go
min(3, 7)
max(3, 7)
max(2, 9, 4, 1)
min(2.5, 1.1)
max("go", "rust", "c")
min(42)
```

Predict each output before running, then confirm.

**Goal.** See that `min`/`max` are variadic, work on ints, floats, and strings, and return the argument type.

---

### Task 2 — `clear` a map vs `clear` a slice

```go
m := map[string]int{"a": 1, "b": 2, "c": 3}
clear(m)
fmt.Println(len(m))            // ?

s := []int{1, 2, 3}
clear(s)
fmt.Println(s, len(s))         // ?
```

Predict both outputs. Explain in one sentence why the slice's length is unchanged but the map's length is 0.

**Goal.** Internalize that `clear` removes map entries but only *zeroes* slice elements.

---

### Task 3 — Clamp a value

Write a function `clamp(x, lo, hi int) int` using only `min` and `max` (no `if`). Test it with `clamp(5, 0, 10)`, `clamp(-3, 0, 10)`, `clamp(99, 0, 10)`.

**Goal.** Learn the `min(max(x, lo), hi)` idiom.

---

### Task 4 — `clear` removes a NaN map key

```go
nan := math.NaN()
m := map[float64]string{nan: "stuck", 1.0: "ok"}
delete(m, nan)
fmt.Println(len(m))   // ?
clear(m)
fmt.Println(len(m))   // ?
```

Predict the two lengths. Explain why `delete` failed.

**Goal.** See the headline correctness motivation for `clear`.

---

### Task 5 — `clear` is not truncation

Start with `s := []string{"x", "y", "z"}`. Use `clear(s)` and then `s = s[:0]` in two separate experiments. Print `s`, `len(s)`, and `cap(s)` after each. Note the difference.

**Goal.** Distinguish `clear(s)` (zero elements, keep length) from `s = s[:0]` (length 0, keep capacity).

---

## Medium

### Task 6 — Compile-time sizing with constants

Write code that declares:

```go
const Window = max(1024, 4096)
var buf [min(64, 128)]byte
```

Then try to declare `var bad [max(n, 8)]byte` where `n` is a variable. Observe the compile error and explain it.

**Goal.** See that constant `min`/`max` fold and can size arrays, but variable arguments cannot.

---

### Task 7 — NaN poisoning a reduction

Write a loop that computes the running max of a `[]float64` using `best = max(best, x)`. Include a `math.NaN()` somewhere in the slice. Observe that the result is NaN. Then write a NaN-skipping version and confirm it gives the real max.

**Goal.** Experience NaN propagation and learn to filter.

---

### Task 8 — Reference leak with a pointer slice

Create a `[]*int` holding three pointers. Truncate with `s = s[:0]` and confirm (via reflection or by reasoning) that the backing array still holds the pointers. Then do it again with `clear(s)` first. Discuss why the second prevents a leak.

**Goal.** Understand `clear` as reference hygiene for pointer slices.

---

### Task 9 — `clear` the whole backing array

Given `s := make([]int, 3, 5)` filled with `[1, 2, 3]` plus two more values written into the capacity region via reslicing, show that `clear(s)` zeroes only `s[0:3]` but `clear(s[:cap(s)])` zeroes all five slots.

**Goal.** Know the difference between clearing the length range and the capacity range.

---

### Task 10 — `min`/`max` vs `math.Min`/`math.Max`

Compare `max(2.0, math.NaN())` with `math.Max(2.0, math.NaN())`. Then compare `max(0.0, math.Copysign(0, -1))` with `math.Max(0.0, math.Copysign(0, -1))`. Document any differences and try the same with `int` arguments (note that `math.Max` won't compile on ints).

**Goal.** Feel the practical differences between the built-in and the library function.

---

### Task 11 — Generic clamp with `cmp.Ordered`

Rewrite Task 3's clamp as `func Clamp[T cmp.Ordered](x, lo, hi T) T`. Use it on `int`, `float64`, and `string`. Confirm it compiles and works for all three.

**Goal.** Use the built-ins inside generics.

---

### Task 12 — Reuse a map across iterations

Write a loop that processes batches. Inside the loop, use `clear(cache)` then refill, instead of `cache = make(...)` each iteration. Benchmark both versions with `testing.B` and `-benchmem`. Compare allocations.

**Goal.** See that `clear`-and-reuse avoids per-iteration allocation.

---

## Hard

### Task 13 — When reallocation beats `clear`

Build a map, grow it to a million entries, then delete down to three. Benchmark `clear(m)` + refill-3 vs `m = make(...)` + fill-3. Observe that `clear` on the once-huge map can be slower and retains the oversized buckets. Document the crossover reasoning.

**Goal.** Learn that `clear`-and-reuse is not always the win; oversized retained storage matters.

---

### Task 14 — A NaN-skipping `MinMax` reducer

Write `func MinMax(xs []float64) (mn, mx float64, ok bool)` that returns the min and max ignoring NaN values. `ok` is false if every value was NaN (or the slice is empty). Use the built-ins on the non-NaN values.

**Goal.** Build a correct float reducer on top of the NaN-propagating built-ins.

---

### Task 15 — Exponential backoff cap

Implement a retry loop where the wait time is `wait = min(base*(1<<attempt), maxWait)`. Cap it so it never exceeds `maxWait`. Add jitter. Confirm the cap holds across many attempts using `min`.

**Goal.** Use `min` to bound a growing value in real backoff logic.

---

### Task 16 — Leak-free object pool

Build a `sync.Pool` of `[]*Conn` slices. On `Get`, return a usable slice; on `Put`, `clear` the slice to drop references before returning it. Write a test that holds a weak reference (or uses finalizers) to confirm objects are collectable after `Put`.

**Goal.** Apply `clear` to pooled pointer slices for real memory hygiene.

---

### Task 17 — Migrate a file off `maxInt`/`minInt`

Take a file (or write one) full of `maxInt`/`minInt` helper calls. Migrate it: bump `go.mod`, replace call sites with the built-ins, delete the helpers, run tests. Use `gofmt -r 'maxInt(a, b) -> max(a, b)'` to mechanize.

**Goal.** Practice the standard migration off hand-rolled helpers.

---

### Task 18 — Audit a float migration

Write a `maxF(a, b float64) float64` that wraps `math.Max`. Replace its call sites with the built-in `max`. Then write a test feeding NaN and signed zeros to *both* and document where (if anywhere) the behaviour diverges.

**Goal.** Understand why float migrations need individual auditing.

---

## Bonus / Stretch

### Task 19 — `clear` for sensitive data hygiene

Write a function that reads a password into a `[]byte`, uses it, then `clear`s the buffer. Discuss in comments what `clear` does and does *not* guarantee about scrubbing the secret from memory (copies in registers, GC-moved data).

**Goal.** Use `clear` for hygiene while understanding its limits as a security wipe.

---

### Task 20 — Reset-and-rebuild with `maps.Copy`

Build the `clear(dst); maps.Copy(dst, src)` pattern to reuse a destination map's storage when copying from a source. Compare against `dst = maps.Clone(src)` (which allocates). Benchmark both.

**Goal.** Combine `clear` with `maps.Copy` for allocation-free map reuse.

---

### Task 21 — Branchless clamp benchmark

Benchmark `clamp(x, lo, hi)` built on `min`/`max` against a hand-written `if`-ladder clamp. Use `-gcflags=-S` to inspect the generated assembly for both. Note whether they compile to similar code.

**Goal.** Confirm the built-ins are as cheap as hand-written comparisons.

---

### Task 22 — `min`/`max` over a slice the right way

You have a `[]int`. Write three approaches to its maximum: (a) a loop with `best = max(best, x)`, (b) `slices.Max(s)`, (c) the wrong `max(s...)` (note the compile error). Benchmark (a) vs (b) and explain which to prefer.

**Goal.** Know when to use the built-in in a loop vs `slices.Max`.

---

## Solutions (sketched)

### Solution 1
```
3
7
9
1.1
rust    // 'r' > 'g' > 'c'
42
```
Untyped constants default to `int`/`float64`; strings compare lexicographically by byte.

### Solution 2
`len(m)` is `0` (map emptied). `s` is `[0 0 0]` and `len(s)` is `3` (elements zeroed, length kept). A map's entries are removed; a slice's elements are merely set to the zero value.

### Solution 3
```go
func clamp(x, lo, hi int) int { return min(max(x, lo), hi) }
// 5, 0, 10
```

### Solution 4
`len(m)` is `2` after `delete` (NaN never matches, so nothing deleted), then `0` after `clear`. `delete(m, nan)` looks up `nan`, but `nan != nan`, so the lookup misses.

### Solution 5
After `clear(s)`: `[  ]` (three empty strings), `len 3`, `cap 3`. After `s = s[:0]`: `[]`, `len 0`, `cap 3`. `clear` zeroes; reslicing shortens.

### Solution 6
The first two compile (`Window == 4096`, a `[64]byte`). `var bad [max(n, 8)]byte` fails: "array length max(n, 8) (value of type int) must be constant" — a variable argument disables folding.

### Solution 7
With NaN in the slice, `best` becomes NaN and stays NaN. NaN-skipping version:
```go
best := math.Inf(-1)
for _, x := range xs {
    if !math.IsNaN(x) {
        best = max(best, x)
    }
}
```

### Solution 8
`s = s[:0]` keeps the backing array, which still references the three `*int`s — they stay reachable (leak in a pooled slice). `clear(s)` sets each slot to `nil` first, dropping the references so the GC can collect them.

### Solution 9
`clear(s)` zeroes `s[0:3]`; the two capacity-region slots keep their values. `clear(s[:cap(s)])` zeroes all five. `clear` only touches the length range unless you reslice to capacity.

### Solution 10
Both `max(2.0, NaN)` and `math.Max(2.0, NaN)` give `NaN`. Signed zero: both order `-0 < +0` in the same direction. The documented divergence is in the NaN-and-infinity *combinations*; for plain values they agree. `math.Max(intA, intB)` does not compile — it requires `float64`.

### Solution 11
```go
func Clamp[T cmp.Ordered](x, lo, hi T) T { return min(max(x, lo), hi) }
Clamp(5, 0, 10)            // int
Clamp(2.5, 0.0, 1.0)       // float64
Clamp("m", "a", "z")       // string
```

### Solution 12
```go
cache := make(map[string]int, 100)
for _, batch := range batches {
    clear(cache)
    for _, it := range batch { cache[it.K] = it.V }
}
```
`-benchmem` shows zero allocations per iteration for the `clear` version vs one map allocation per iteration for `make`.

### Solution 13
After growing to 1M and deleting to 3, `clear(m)` still walks the large bucket array (O(buckets)) and keeps it allocated. `m = make(...)` allocates a fresh small map and lets the GC reclaim the huge one. For one-time-huge maps, reallocate.

### Solution 14
```go
func MinMax(xs []float64) (mn, mx float64, ok bool) {
    mn, mx = math.Inf(1), math.Inf(-1)
    for _, x := range xs {
        if math.IsNaN(x) { continue }
        mn, mx, ok = min(mn, x), max(mx, x), true
    }
    return
}
```

### Solution 15
```go
wait := min(base<<attempt, maxWait)
wait += time.Duration(rand.Int63n(int64(wait / 4)))   // jitter
```
`min` guarantees `wait <= maxWait` for every attempt.

### Solution 16
```go
func (p *Pool) Put(s []*Conn) {
    clear(s)              // drop *Conn references
    p.pool.Put(s[:0])
}
```
After `Put`, the previously held `*Conn`s are unreferenced by the pooled slice and become collectable.

### Solution 17
```bash
gofmt -r 'maxInt(a, b) -> max(a, b)' -w ./...
gofmt -r 'minInt(a, b) -> min(a, b)' -w ./...
# delete the helpers, run: go test ./...
```

### Solution 18
For integral and ordinary values, `max` and `maxF` (via `math.Max`) agree. Feed `math.NaN()` and `math.Copysign(0,-1)`: both produce NaN for NaN; signed-zero ordering agrees. The lesson is that you must *check* rather than assume — most cases match, but the NaN/Inf corners are documented as differing, so audit any code path that can see them.

### Solution 19
```go
pw := readPassword()
defer clear(pw)        // zero the buffer when done
use(pw)
```
`clear(pw)` zeroes the slice's bytes — good hygiene — but does not guarantee no copy survives in a register, on the stack, or in a GC-relocated allocation. For hard guarantees, a dedicated wipe is needed; Go gives no absolute promise.

### Solution 20
```go
clear(dst)
maps.Copy(dst, src)    // reuses dst's storage
// vs
dst = maps.Clone(src)  // allocates a new map
```
`clear`+`Copy` shows fewer allocations on `-benchmem` when `dst` is reused across calls.

### Solution 21
The `-S` output shows both clamps lowering to compares and conditional moves/branches with no call and no allocation. The built-in version is as cheap as the hand-written ladder and far more readable.

### Solution 22
(a) and (b) are both O(n) single passes; `slices.Max(s)` is clearer and is itself implemented with the `max` built-in. (c) `max(s...)` does not compile. Prefer `slices.Max` for a whole slice; use `max` in a loop only when you're already iterating for other reasons.

---

## Checkpoints

After the easy tasks: you can call `min`/`max` on any ordered type, clamp values, and distinguish `clear` on maps from `clear` on slices (including the NaN-key fix).
After the medium tasks: you can size arrays with constant `min`/`max`, handle NaN poisoning, prevent reference leaks with `clear`, and contrast the built-ins with `math.Min`/`math.Max`.
After the hard tasks: you can decide between `clear`-and-reuse and reallocation, build NaN-aware reducers, apply `clear` in pools, and migrate a codebase off hand-rolled helpers.
After the bonus tasks: you understand `clear`'s limits as a security wipe, combine it with `maps.Copy`, verify the built-ins compile to cheap code, and pick the right tool for slice extremes.
