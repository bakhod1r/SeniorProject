# Unnecessary Allocation — Middle Level

> **Category:** [Performance Anti-Patterns](../README.md) → **Unnecessary Allocation** — *throwaway objects, boxing, and copies churned in a hot path.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [How to See Allocations: `-benchmem`](#how-to-see-allocations--benchmem)
4. [Form 1 — String Building](#form-1--string-building)
5. [Form 2 — Presizing Collections](#form-2--presizing-collections)
6. [Form 3 — Boxing and Autoboxing](#form-3--boxing-and-autoboxing)
7. [Form 4 — Reuse vs Re-create](#form-4--reuse-vs-re-create)
8. [Form 5 — Intermediate Collections in Pipelines](#form-5--intermediate-collections-in-pipelines)
9. [Reading the Numbers Honestly](#reading-the-numbers-honestly)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The common forms** and **the fixes — measured, not guessed.**

At the junior level you learned the headline case (loop string concatenation) and the one rule (*allocate fewer times, only where hot*). This file is the working catalog: the **five forms** of unnecessary allocation you'll actually meet, each with a before/after and — critically — the **numbers** that prove the fix.

The skill that separates this level from the last is **measurement**. You stop *believing* an allocation is there and start *seeing* it: `allocs/op` and `B/op` from a benchmark, allocation counts from a profiler. A change that "should be faster" but moves no numbers is not an optimization — it's a guess. Every fix below comes with the flag that makes the allocation visible.

> **The discipline:** before you change code to allocate less, run the benchmark with `-benchmem` (Go) or an allocation profiler (Java/Python). After, run it again. If `allocs/op` didn't drop, you fixed nothing.

---

## Prerequisites

- **Required:** [`junior.md`](junior.md) — you can spot loop concatenation and reach for a builder.
- **Required:** You can run a benchmark in your language — Go `testing.B`, a JMH harness or a timed loop in Java, `timeit`/`tracemalloc` in Python.
- **Helpful:** A rough mental model of the heap and a tracing GC (objects live on the heap; the GC reclaims unreachable ones).
- **Helpful:** Familiarity with the `profiling-techniques` skill — `-benchmem` is the entry-level version of allocation profiling.

---

## How to See Allocations: `-benchmem`

In Go, every benchmark can report allocations for free. This single flag is the most useful tool in this entire topic:

```go
func BenchmarkJoin(b *testing.B) {
	words := make([]string, 1000)
	for i := range words {
		words[i] = "abc"
	}
	b.ReportAllocs()           // or pass -benchmem on the command line
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = joinSlow(words)
	}
}
```

```bash
go test -bench=Join -benchmem
```

```text
BenchmarkJoinSlow-8     2014    583012 ns/op   2557104 B/op   999 allocs/op
BenchmarkJoinFast-8   228913      5216 ns/op      5376 B/op     2 allocs/op
```

Read the last two columns first. `B/op` is bytes allocated per operation; `allocs/op` is the *number* of allocations per operation. The slow version makes **999** allocations (one per word, as predicted) and ~2.5 MB of garbage *per call*; the builder makes **2** and ~5 KB. The `ns/op` improvement (112×) follows from the allocation drop. **`allocs/op` is the signal; `ns/op` is the consequence.**

In Java the equivalent is JMH with `-prof gc`, which reports `gc.alloc.rate.norm` — bytes allocated per operation. In Python, `tracemalloc` snapshots show allocation by line. We'll use all three below.

---

## Form 1 — String Building

The junior case, now with numbers and the subtler variants.

```go
// Before — O(n²), n allocations.   After — O(n), ~2 allocations.
func joinSlow(ws []string) string { s := ""; for _, w := range ws { s += w }; return s }
func joinFast(ws []string) string {
	var b strings.Builder
	b.Grow(totalLen(ws))        // optional: presize the buffer → 1 alloc
	for _, w := range ws { b.WriteString(w) }
	return b.String()
}
```

`b.Grow(n)` is the pro touch: if you know the final length, presize the builder's buffer so it never reallocates while growing. That takes `joinFast` from ~2 allocs to **1**.

**The hidden version** — `fmt.Sprintf` in a hot loop. It's a builder-killer because it allocates for formatting *and* boxes its `...interface{}` arguments:

```go
// Hot-path logging — Sprintf allocates a lot.
msg := fmt.Sprintf("user=%d action=%s", id, action)   // formatting + arg boxing
// Cheaper when hot:
var b strings.Builder
b.WriteString("user="); b.WriteString(strconv.Itoa(id))
b.WriteString(" action="); b.WriteString(action)
```

> **Don't reflexively kill every `Sprintf`** — it's fine on a cold path and far more readable. Replace it only where a profile shows the allocations matter.

---

## Form 2 — Presizing Collections

A slice or list that doesn't know its final size **reallocates** as it grows: it allocates a backing array, fills it, then when full allocates a bigger one (typically ~2×), copies everything over, and discards the old one. For *n* elements you pay roughly `log₂(n)` reallocations and copy ~2n elements total — all avoidable if you knew the size.

```go
// Before — grows from nil; ~log2(n) reallocations.
func squares(n int) []int {
	out := []int{}                 // cap 0
	for i := 0; i < n; i++ { out = append(out, i*i) }
	return out
}

// After — one allocation, exact size known.
func squaresFast(n int) []int {
	out := make([]int, 0, n)       // cap n up front
	for i := 0; i < n; i++ { out = append(out, i*i) }
	return out
}
```

```text
BenchmarkSquaresSlow-8   122163   9788 ns/op   357627 B/op   19 allocs/op
BenchmarkSquaresFast-8   384720   3110 ns/op    81920 B/op    1 allocs/op
```

Same answer, 19 allocations → 1. The Java equivalent is the constructor argument:

```java
List<Integer> out = new ArrayList<>(n);   // not new ArrayList<>(); presize to n
Map<String,V> m   = new HashMap<>(n * 4 / 3 + 1);  // presize to avoid rehash/resize
```

> Presizing is the **cheapest, lowest-risk** allocation win there is: no reuse, no pooling, no correctness hazard — you just tell the collection what you already know.

---

## Form 3 — Boxing and Autoboxing

A **boxed** primitive is the value wrapped in a heap object: Java's `Integer` for `int`, `Double` for `double`. A `List<Integer>` doesn't store ints — it stores *pointers to Integer objects*, each its own heap allocation. **Autoboxing** silently converts `int ↔ Integer` at the boundaries, so the allocations hide in plain-looking code.

```java
// Before — every element is a boxed Integer on the heap.
long sumBoxed(List<Integer> nums) {
    long total = 0;
    for (Integer n : nums) {     // unbox each; the list already boxed them
        total += n;
    }
    return total;
}

// After — primitives never leave the stack / a flat array.
long sumPrimitive(int[] nums) {
    long total = 0;
    for (int n : nums) {         // no boxing, no per-element object
        total += n;
    }
    return total;
}
```

A JMH run with `-prof gc` tells the story:

```text
sumBoxed      gc.alloc.rate.norm   16.0 B/op   (plus the list's boxing upstream)
sumPrimitive  gc.alloc.rate.norm    0.0 B/op   ← zero allocation
```

Boxing's worst hiding spots:

- **`Map<Integer, Integer>` / `Map<Long, …>`** — keys *and* values boxed. Reach for a primitive-specialized map (Eclipse Collections, fastutil, HPPC) in hot code.
- **Streams over `Integer`** — use `IntStream`, `LongStream`, `DoubleStream`, which carry primitives, not boxed wrappers.
- **`Integer` cache trap** — `==` on boxed values works for −128..127 (cached) and breaks above it. That's a *correctness* bug riding along with the allocation cost.

Go has no autoboxing of numbers, but it has the analogous trap: **putting a value into an `interface{}`/`any`** boxes it (the value escapes to the heap). `fmt.Println(x)`, `[]any{...}`, and `sync.Map` storing primitives all box.

```go
var s []any
s = append(s, 42)   // 42 escapes to the heap — boxed into an interface
```

---

## Form 4 — Reuse vs Re-create

When the same buffer is needed every iteration, allocating a fresh one each time is pure waste. **Hoist** it out of the loop and reuse it.

```go
// Before — a new scratch buffer per record.
func process(records [][]byte) {
	for _, r := range records {
		buf := make([]byte, 0, 4096)   // fresh allocation every iteration
		buf = transform(buf, r)
		emit(buf)
	}
}

// After — one buffer, reset and reused. (buf[:0] keeps the capacity.)
func processFast(records [][]byte) {
	buf := make([]byte, 0, 4096)       // allocate once
	for _, r := range records {
		buf = transform(buf[:0], r)    // reuse the backing array
		emit(buf)
	}
}
```

`buf[:0]` resets the length to zero while keeping the capacity, so `transform` writes into the same memory. Allocations drop from one-per-record to **one total**.

> **The catch — only reuse what's truly done being used.** `emit(buf)` must *consume* `buf` before the next iteration overwrites it. If `emit` stashes the slice for later, you've created an [aliasing bug](../04-wrong-data-structure/middle.md) — the stored slices all point at the same buffer and show the last record's bytes. Reuse trades a small allocation win for a real correctness obligation. (The heavyweight version of reuse — `sync.Pool` — and its dangers are `senior.md`.)

---

## Form 5 — Intermediate Collections in Pipelines

Each `map`/`filter`/`collect` step that *materializes* a whole new collection allocates a throwaway. Chaining four of them allocates four lists you never name.

```java
// Before — three intermediate lists, then a fourth result.
List<String> result = users.stream()
    .collect(Collectors.toList())          // materialize
    .stream().filter(User::isActive)
    .collect(Collectors.toList())          // materialize
    .stream().map(User::name)
    .collect(Collectors.toList());         // materialize

// After — one lazy pipeline, one terminal allocation.
List<String> result = users.stream()
    .filter(User::isActive)
    .map(User::name)
    .collect(Collectors.toList());         // single materialization
```

Streams are **lazy**: `filter` and `map` don't allocate collections — they're applied element-by-element and only the terminal `collect` materializes. The "before" forces a list at each step by re-streaming, defeating laziness. The fix is simply *don't break the pipeline* — keep it lazy until one terminal operation.

Python's analog: prefer **generators** over building intermediate lists when you only iterate once.

```python
# Before — two full lists in memory.
names = [u.name for u in users]
active = [n for n in names if is_active(n)]

# After — generator pipeline, no intermediate list.
active = (u.name for u in users if u.is_active)   # lazy; materialize only if needed
```

---

## Reading the Numbers Honestly

A few rules so your benchmarks don't lie to you:

- **Look at `allocs/op` and `B/op`, not just `ns/op`.** Allocation cost is partly *deferred* into future GC cycles; a micro-benchmark may not pay that bill, so the `ns/op` win understates the real one. The allocation count is the honest signal.
- **Make sure the result is used.** If you discard the benchmark's output, the compiler may delete the work (dead-code elimination). Assign it to a package-level sink or `b`-scoped variable. (More in `professional.md`.)
- **Benchmark realistic sizes.** Loop concatenation looks fine at n=10 and catastrophic at n=100,000. Use an input size near production.
- **Same answer, fewer allocations.** Every fix above is *behavior-preserving*. If the output changed, you didn't optimize — you broke it.

---

## Common Mistakes

1. **Trusting `ns/op` alone.** A change can shave nanoseconds in a micro-benchmark while making *more* garbage that hits you under real GC load. Watch `allocs/op`.
2. **Presizing with the wrong number.** `make([]T, n)` (length n) vs `make([]T, 0, n)` (capacity n) — the first prefills n zero values; appending then *doubles* the slice. For "append n items," you want `0, n`.
3. **Killing every `Sprintf`/stream/`Integer`.** These are fine on cold paths and far clearer. Replace them only where a profile points.
4. **Reusing a buffer that's still referenced.** Buffer reuse is a correctness contract: the old contents must be fully consumed before overwrite. Get this wrong and you have an aliasing bug, not a speedup.
5. **`HashMap` without sizing, then surprised by rehashes.** A map that outgrows its capacity rehashes — reallocating the whole table. Presize from the known element count.
6. **Boxing in the hot loop you didn't notice.** `map.get(key)` where `key` is an `int` autoboxes on every call. The allocation is invisible in the source.

---

## Test Yourself

1. You see `BenchmarkX-8  ...  120000 B/op  300 allocs/op`. Which number tells you there's an unnecessary-allocation problem, and what does each mean?
2. In Go, what's the difference between `make([]int, n)` and `make([]int, 0, n)` when you're about to `append` n items? Which avoids reallocation?
3. Why does `List<Integer>` allocate more than `int[]` for the same numbers? What's the name for wrapping a primitive in a heap object?
4. Rewrite to one allocation:
   ```go
   out := []string{}
   for _, u := range users { out = append(out, u.Name) }   // n known: len(users)
   ```
5. A four-step Java stream pipeline calls `.collect(Collectors.toList())` after every step. How many lists does it materialize, and how do you get to one?
6. You hoist a `make([]byte, 4096)` out of a loop and reuse it with `buf[:0]`. What new bug must you check for?

<details>
<summary>Answers</summary>

1. **`allocs/op` (300)** is the key signal — 300 separate allocations per call strongly suggests one-per-something in a loop. `B/op` (120 KB) is the total bytes; high bytes with low allocs is one big allocation, high allocs is many small ones (usually the fixable kind).
2. `make([]int, n)` creates a slice of **length n**, prefilled with n zeros; appending adds a 2nd batch and triggers growth. `make([]int, 0, n)` creates **length 0, capacity n**; appending n items fits exactly with **no reallocation**. Use the second.
3. `List<Integer>` stores pointers to heap `Integer` **objects** — one allocation per element, plus pointer-chasing. `int[]` is a flat block of raw ints, zero per-element objects. Wrapping a primitive in a heap object is **boxing**.
4. ```go
   out := make([]string, 0, len(users))
   for _, u := range users { out = append(out, u.Name) }
   ```
5. **Four** lists (one per `.collect`). Keep the pipeline lazy — `filter`/`map` don't allocate — and `collect` **once** at the end: `users.stream().filter(...).map(...).collect(toList())`.
6. **Aliasing.** If anything downstream keeps a reference to `buf` past the iteration, the next `buf[:0]` overwrites its data. Reuse is only safe if each result is fully consumed before the buffer is reused.

</details>

---

## Cheat Sheet

| Form | Before | After | What drops |
|---|---|---|---|
| **String building** | `s += x` in a loop | `strings.Builder` / `StringBuilder` (+`Grow`) | n allocs → 1–2 |
| **Presizing** | `[]T{}` / `new ArrayList<>()` | `make([]T,0,n)` / `new ArrayList<>(n)` | log n reallocs → 1 |
| **Boxing** | `List<Integer>`, `Map<Integer,…>` | `int[]`, primitive-specialized maps | per-element objects → 0 |
| **Reuse** | `make(...)` inside loop | hoist + `buf[:0]` | n allocs → 1 (mind aliasing) |
| **Pipelines** | `.collect()` per step | one lazy pipeline, one terminal | n lists → 1 |

> **Measure both ends:** `go test -benchmem`, JMH `-prof gc`, Python `tracemalloc`. If `allocs/op` didn't fall, you changed nothing.

---

## Summary

- The five everyday forms of unnecessary allocation are **string building**, **un-presized collections**, **boxing/autoboxing**, **re-creating instead of reusing**, and **intermediate collections in pipelines**.
- Each fix is behavior-preserving and provable: run the benchmark with **`-benchmem`** (Go), **`-prof gc`** (JMH), or **`tracemalloc`** (Python) and watch `allocs/op` fall.
- **`allocs/op` is the signal, `ns/op` is the consequence** — and a micro-benchmark *understates* allocation cost because GC is deferred.
- **Presizing** is the cheapest, safest win (no reuse, no pool). **Boxing** hides in `List<Integer>` and `interface{}`. **Buffer reuse** is fast but carries an aliasing correctness contract.
- Apply these where they're measured to matter; on cold paths, prefer the clearer code. ([Premature optimization](../01-premature-optimization-traps/middle.md) is the failure on the other side.)
- Next: [`senior.md`](senior.md) — *reading a real allocation profile, escape analysis (`-gcflags=-m`), `sync.Pool` and its dangers, and the rule "profile first — most allocations don't matter."*

---

## Further Reading

- **Systems Performance** — Brendan Gregg (2nd ed., 2020) — connecting allocation rate to observed CPU and latency.
- **Java Performance** — Scott Oaks (2nd ed., 2020) — autoboxing costs, the young generation, and allocation rate as the GC's primary input.
- **The Go Blog — escape analysis** (go.dev/blog) — why some allocations vanish entirely when a value stays on the stack.
- **Effective Java** — Joshua Bloch (3rd ed., 2018) — Item 6 (unnecessary objects), Item 61 (prefer primitives to boxed primitives).

---

## Related Topics

- [Premature Optimization Traps](../01-premature-optimization-traps/middle.md) — apply these fixes only where measured; don't pre-pool cold paths.
- [N+1 in Code](../02-n-plus-one-in-code/middle.md) — repeated *work* in a loop, the structural cousin of repeated *allocation*.
- [Wrong Data Structure](../04-wrong-data-structure/middle.md) — the wrong collection often allocates badly *and* runs slow; aliasing on reuse links here.
- [Profiling Techniques](../../../../../../skills) — the `profiling-techniques` skill; `-benchmem` is the entry point to allocation profiling.
- [`junior.md`](junior.md) · [`senior.md`](senior.md) — the headline case, then reducing allocation in a real hot path.
