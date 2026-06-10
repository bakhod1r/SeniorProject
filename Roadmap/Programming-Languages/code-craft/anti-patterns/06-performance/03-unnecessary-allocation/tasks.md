# Unnecessary Allocation — Exercises

> **Category:** [Performance Anti-Patterns](../README.md) → **Unnecessary Allocation** — *hands-on practice cutting throwaway objects in a measured hot path.*

---

These are **do-it** exercises, not recognition quizzes. Each gives a problem, starting code (Go, Java, or Python — the language varies on purpose), acceptance criteria, and a collapsible solution. The recurring discipline is the one from the level files: **prove the allocation with `-benchmem` / a profiler before you fix it, fix it without changing behavior, then prove the fix with the same measurement.**

> **How to use this file.** Try each in your editor *before* opening the solution — and where it says "prove it," actually run the benchmark. The `allocs/op` number is the point; the gap between what you *expected* and what the tool *reported* is where the learning is. Refer back to [`middle.md`](middle.md) for the tooling and [`senior.md`](senior.md) for the judgment about when to stop.

---

## Table of Contents

| # | Exercise | Form | Lang | Key tool |
|---|---|---|---|---|
| 1 | [Fix the O(n²) string build](#exercise-1--fix-the-on-string-build) | String building | Go | `-benchmem`, `strings.Builder` |
| 2 | [Presize a collection](#exercise-2--presize-a-collection) | Un-presized growth | Go | `-benchmem`, `make(…,0,n)` |
| 3 | [Remove the autoboxing](#exercise-3--remove-the-autoboxing) | Boxing | Java | JMH `-prof gc` |
| 4 | [Reuse a buffer in a hot loop](#exercise-4--reuse-a-buffer-in-a-hot-loop) | Reuse vs re-create | Go | `-benchmem`, aliasing check |
| 5 | [Confirm a value stays on the stack](#exercise-5--confirm-a-value-stays-on-the-stack) | Escape analysis | Go | `-gcflags=-m` |
| 6 | [Collapse the pipeline's intermediates](#exercise-6--collapse-the-pipelines-intermediates) | Intermediate collections | Python | `tracemalloc` |

---

## Exercise 1 — Fix the O(n²) string build

**Form:** string building. **Goal:** make `Join` linear and drop allocations to a constant. **Acceptance:** identical output for all inputs; `allocs/op` independent of input length; a benchmark proving the before/after.

```go
// Before — quadratic, n allocations.
func Join(parts []string) string {
	s := ""
	for _, p := range parts {
		s = s + p + "\n"
	}
	return s
}
```

<details>
<summary>Solution</summary>

```go
// After — O(n), presized buffer → 1 allocation.
func Join(parts []string) string {
	n := 0
	for _, p := range parts {
		n += len(p) + 1 // +1 for '\n'
	}
	var b strings.Builder
	b.Grow(n) // presize the buffer: no growth reallocations
	for _, p := range parts {
		b.WriteString(p)
		b.WriteByte('\n')
	}
	return b.String()
}
```

**Prove it.**

```go
func BenchmarkJoin(b *testing.B) {
	parts := make([]string, 2000)
	for i := range parts {
		parts[i] = "line"
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = Join(parts)
	}
}
```

```text
# before
BenchmarkJoin-8     1180   1018342 ns/op   10742889 B/op   2001 allocs/op
# after
BenchmarkJoin-8   154208      7771 ns/op      16384 B/op      1 allocs/op
```

`allocs/op` 2001 → **1** (the single `Grow`-sized buffer; `String()` on a `strings.Builder` reuses that buffer, no copy). `ns/op` 1018342 → 7771 (**131×**). The output is byte-identical. **Why it mattered:** 2000-element inputs are realistic for this path; at n=5 you'd see no difference and shouldn't bother.

</details>

---

## Exercise 2 — Presize a collection

**Form:** un-presized growth. **Goal:** eliminate the reallocation chain when the final size is known. **Acceptance:** same slice contents; `allocs/op` drops to 1; benchmark proving it.

```go
// Before — grows from nil; reallocates ~log2(n) times.
func Evens(n int) []int {
	out := []int{}
	for i := 0; i < n; i++ {
		if i%2 == 0 {
			out = append(out, i)
		}
	}
	return out
}
```

<details>
<summary>Solution</summary>

```go
// After — exact capacity known: n/2 evens in [0,n).
func Evens(n int) []int {
	out := make([]int, 0, (n+1)/2) // presize to the count of evens
	for i := 0; i < n; i++ {
		if i%2 == 0 {
			out = append(out, i)
		}
	}
	return out
}
```

**Prove it.**

```go
func BenchmarkEvens(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = Evens(10000)
	}
}
```

```text
# before
BenchmarkEvens-8   38940   30562 ns/op   357626 B/op   19 allocs/op
# after
BenchmarkEvens-8   86510   13994 ns/op    40960 B/op    1 allocs/op
```

19 → **1** allocation. **Subtlety to note:** this is `make([]int, 0, cap)`, *not* `make([]int, cap)`. The latter would prefill `cap` zeros and then `append` *past* them, doubling the slice and defeating the point. If you only have an *estimate* of the size, presizing to the estimate still removes most reallocations — an approximate presize beats none.

</details>

---

## Exercise 3 — Remove the autoboxing

**Form:** boxing. **Goal:** eliminate per-element `Integer` allocation in a hot sum. **Acceptance:** same result; `gc.alloc.rate.norm` drops toward zero; JMH proof.

```java
// Before — List<Integer>: every element is a boxed heap object.
long sumOf(List<Integer> nums) {
    long total = 0;
    for (Integer n : nums) {   // unboxing each iteration
        total += n;
    }
    return total;
}
```

<details>
<summary>Solution</summary>

```java
// After — int[]: flat, contiguous, zero per-element objects.
long sumOf(int[] nums) {
    long total = 0;
    for (int n : nums) {       // no boxing, no unboxing
        total += n;
    }
    return total;
}
```

**Prove it** (JMH; the `-prof gc` profiler reports normalized allocation):

```java
@Benchmark
public long boxed(BoxedState s)      { return sumOf(s.list); }   // List<Integer>
@Benchmark
public long primitive(PrimState s)   { return sumOf(s.arr); }    // int[]
```

```text
# mvn ... -prof gc
boxed       avgt   42.1 us/op    boxed:gc.alloc.rate.norm   0.0 B/op   (the LIST upstream did the boxing)
primitive   avgt    9.7 us/op    primitive:gc.alloc.rate.norm  0.0 B/op
```

The *iteration* itself allocates nothing in either case once the list exists — but building and holding the `List<Integer>` cost N `Integer` allocations and N pointer dereferences during the scan (cache misses), which the `int[]` version never pays. The honest comparison includes construction; profile the full path. **Caveat:** if the data genuinely arrives as `List<Integer>` from an API you don't control, the win is in *not boxing it in the first place* upstream, or using a primitive-specialized collection (fastutil `IntArrayList`). Don't convert `List<Integer>`→`int[]` on a cold path just to "avoid boxing" — the conversion itself allocates.

</details>

---

## Exercise 4 — Reuse a buffer in a hot loop

**Form:** reuse vs re-create. **Goal:** allocate the scratch buffer once, not per record. **Acceptance:** same emitted bytes; `allocs/op` drops to a constant; **and** you must verify no aliasing bug.

```go
// Before — a fresh buffer every record.
func EncodeAll(records [][]byte, w io.Writer) error {
	for _, r := range records {
		buf := make([]byte, 0, 256) // allocated every iteration
		buf = encode(buf, r)
		if _, err := w.Write(buf); err != nil {
			return err
		}
	}
	return nil
}
```

<details>
<summary>Solution</summary>

```go
// After — one buffer, reset with buf[:0] each iteration.
func EncodeAll(records [][]byte, w io.Writer) error {
	buf := make([]byte, 0, 256) // allocated once
	for _, r := range records {
		buf = encode(buf[:0], r) // reuse the backing array
		if _, err := w.Write(buf); err != nil {
			return err
		}
	}
	return nil
}
```

**Prove it.**

```go
func BenchmarkEncodeAll(b *testing.B) {
	recs := makeRecords(1000)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = EncodeAll(recs, io.Discard)
	}
}
```

```text
# before
BenchmarkEncodeAll-8   2210   532104 ns/op   256000 B/op   1000 allocs/op
# after
BenchmarkEncodeAll-8   4602   254880 ns/op      256 B/op      1 allocs/op
```

1000 → **1** allocation. **The mandatory aliasing check:** `w.Write(buf)` must *fully consume* `buf` before the next `buf[:0]` overwrites it. `io.Writer.Write` copies its argument synchronously, so this is safe. It would be a **bug** if you instead did `out = append(out, buf)` — every stored slice would alias the one backing array and show the last record's bytes. Reuse is only correct when the consumer doesn't retain the slice. **When it mattered:** 1000 records per call on a hot path; on a 3-record cold path the per-iteration `make` is invisible and the reset adds noise — leave it.

</details>

---

## Exercise 5 — Confirm a value stays on the stack

**Form:** escape analysis. **Goal:** make a helper return its result *without* heap-allocating, and prove it with `-gcflags=-m`. **Acceptance:** `-gcflags=-m` shows "does not escape" (or no "moved to heap") for the local; `allocs/op == 0`.

```go
type Vec struct{ X, Y, Z float64 }

// Before — returns *Vec; the local escapes to the heap.
func AddPtr(a, b Vec) *Vec {
	v := Vec{a.X + b.X, a.Y + b.Y, a.Z + b.Z}
	return &v // escapes: pointer outlives the call
}
```

<details>
<summary>Solution</summary>

```go
// After — return the value; nothing escapes, stays on the stack.
func Add(a, b Vec) Vec {
	return Vec{a.X + b.X, a.Y + b.Y, a.Z + b.Z}
}
```

**Prove the escape decision.**

```bash
go build -gcflags=-m ./...
```

```text
# before
./vec.go:N: moved to heap: v          ← AddPtr heap-allocates
# after
./vec.go:M: Add ... does not escape   ← no allocation
```

**Prove it costs nothing.**

```go
var sink Vec
func BenchmarkAdd(b *testing.B) {
	x, y := Vec{1, 2, 3}, Vec{4, 5, 6}
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		sink = Add(x, y) // assign to sink → defeats dead-code elimination
	}
}
```

```text
BenchmarkAddPtr-8   ...   24 B/op   1 allocs/op
BenchmarkAdd-8      ...    0 B/op   0 allocs/op
```

**The lever:** you didn't "tell" the compiler to stack-allocate — you *removed the escape* by returning the value instead of a pointer. For a small fixed-size struct like `Vec`, value semantics are both cheaper (no allocation) and idiomatic. Note the `sink` assignment in the benchmark: without it the compiler could eliminate the call entirely and report a misleading `0 allocs/op`. **Don't over-apply:** returning a pointer is correct and necessary when the struct is large or genuinely shared — this is about *needless* escape, not a ban on pointers.

</details>

---

## Exercise 6 — Collapse the pipeline's intermediates

**Form:** intermediate collections. **Goal:** stop materializing a list at every transformation step. **Acceptance:** same total; peak allocation drops; `tracemalloc` proof.

```python
# Before — three full lists in memory for a one-pass computation.
def total_active_spend(users):
    active = [u for u in users if u.is_active]      # list 1
    spends = [u.monthly_spend for u in active]      # list 2
    annual = [s * 12 for s in spends]               # list 3
    return sum(annual)
```

<details>
<summary>Solution</summary>

```python
# After — one lazy generator pipeline; nothing materialized.
def total_active_spend(users):
    return sum(u.monthly_spend * 12 for u in users if u.is_active)
```

**Prove it.**

```python
import tracemalloc

def measure(fn, users):
    tracemalloc.start()
    fn(users)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return peak

users = make_users(1_000_000, active_ratio=0.5)
print("before peak:", measure(total_active_spend_before, users))  # e.g. 24.1 MB
print("after  peak:", measure(total_active_spend_after,  users))  #      ~0.0 MB
```

```text
before peak:  24117248   # three intermediate lists for 500k actives
after  peak:       128   # generator holds one item at a time
```

The "before" builds three lists totaling ~1.5M elements just to sum them once; the generator version streams element-by-element with constant memory. Same result. **Caveat:** generators are the win only when you iterate **once**. If you needed `active` twice, materializing it once is correct — don't re-run a generator twice (it's exhausted) or re-filter from scratch. And on a small `users` list this is invisible — the fix matters because the input is a million rows.

</details>

---

## The discipline — recap

Every exercise ran the same loop:

```text
measure (allocs/op or peak)  →  one targeted fix  →  measure again  →  confirm same output
```

- **Measure before and after.** `go test -benchmem`, JMH `-prof gc`, Python `tracemalloc`. A fix that doesn't move `allocs/op` / `gc.alloc.rate.norm` / peak fixed nothing.
- **Same behavior.** Every fix above is output-identical. If the answer changed, it's a bug, not an optimization.
- **Defeat the measurement traps.** Assign benchmark results to a sink (DCE), use realistic sizes (O(n²) hides at n=5), warm up on the JVM (scalar replacement is steady-state only).
- **Know when to stop.** Each "when it mattered" note is the point — these fixes earn their keep *only* on a hot path. On cold code, the clearer original wins.

| Fix | Form | Allocation result |
|---|---|---|
| `strings.Builder` + `Grow` | string building | n → 1 |
| `make([]T, 0, n)` | un-presized growth | log n → 1 |
| `int[]` over `List<Integer>` | boxing | per-element → 0 |
| hoist + `buf[:0]` | reuse | n → 1 (mind aliasing) |
| return value, not pointer | escape | heap → stack (0) |
| generator pipeline | intermediates | n lists → constant |

---

## Related Topics

- [`find-bug.md`](find-bug.md) — the spotting counterpart: identify the needless allocation (and the one that's necessary).
- [`optimize.md`](optimize.md) — take a full allocation-heavy hot path, profile it, and cut allocations end-to-end.
- [`middle.md`](middle.md) · [`senior.md`](senior.md) — the forms and tooling, then hot-path judgment.
- [Premature Optimization Traps](../01-premature-optimization-traps/tasks.md) — the measure-first discipline these exercises rest on.
- The `profiling-techniques` and `big-o-analysis` skills.
