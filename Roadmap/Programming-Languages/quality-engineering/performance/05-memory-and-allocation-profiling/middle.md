# Memory and Allocation Optimization — Middle Level

> **Roadmap:** [Performance](../README.md) → Memory and Allocation Optimization
> *The junior page taught you to read a heap profile. This page is about doing something with it: why a value lands on the heap in the first place, how to keep it on the stack, when pooling pays off and when it quietly backfires, and how allocation rate — not heap size — is the dial that controls how often the GC steals your CPU.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Escape Analysis — Why a Value Goes to the Heap](#escape-analysis--why-a-value-goes-to-the-heap)
4. [The Allocation-Rate → GC-Frequency Loop](#the-allocation-rate--gc-frequency-loop)
5. [Preallocation and Growth Amortization](#preallocation-and-growth-amortization)
6. [Value Semantics, In-Place Ops, and the `[]byte`↔`string` Tricks](#value-semantics-in-place-ops-and-the-bytestring-tricks)
7. [Object Pooling — `sync.Pool` and When It Hurts](#object-pooling--syncpool-and-when-it-hurts)
8. [Reading an Allocation Profile to Find the Worst Site](#reading-an-allocation-profile-to-find-the-worst-site)
9. [GC Tuning Basics — GOGC and the Heap Target](#gc-tuning-basics--gogc-and-the-heap-target)
10. [Worked Example — Escape Output and a benchmem Before/After](#worked-example--escape-output-and-a-benchmem-beforeafter)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What makes code allocate, and how do I make it allocate less?**

The junior page handed you the instruments: `-inuse_space` shows what's resident now, `-alloc_space` shows cumulative bytes, `benchmem` prints `allocs/op`. Reading those is necessary but not sufficient. The real skill is causal: given a hot loop that does `42 allocs/op`, *why* does it allocate, and which of those 42 can you remove without contorting the code?

Almost every allocation in a managed language traces back to one of a handful of mechanisms — a value that **escapes** the stack, a slice that **grows past its capacity**, an interface that **boxes** a concrete value, a `[]byte`-to-`string` conversion that **copies**. Each has a known cause and a known fix. And every allocation you remove pays twice: once for the allocation itself, and again because you didn't add to the **allocation rate** that drives how often the garbage collector runs. This page is about that causal layer. Pure profiler mechanics live in [01-profiling](../01-profiling/); here we use the profile as a means to an end — cutting cost.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can read an `-inuse_space` vs `-alloc_space` profile.
- **Required:** You can write and run a Go benchmark with `-benchmem`.
- **Helpful:** A rough mental model of stack vs heap and what a garbage collector does.
- **Helpful:** You've seen a service whose CPU profile was dominated by `runtime.mallocgc` or `gcBgMarkWorker`.

---

## Escape Analysis — Why a Value Goes to the Heap

The compiler would *prefer* to put everything on the stack: stack allocation is a pointer bump, and the whole frame is freed for free when the function returns — the GC never sees it. A value is forced onto the heap only when the compiler can't prove its lifetime ends with the function. That proof is **escape analysis**, and you can read its verdict directly:

```bash
go build -gcflags='-m' ./...
# ./main.go:12:9: &User{...} escapes to heap
# ./main.go:20:14: leaking param: cfg
# ./main.go:31:23: make([]byte, n) does not escape
```

`-m` once shows decisions; `-m -m` (or `-gcflags='-m=2'`) shows the *reasoning chain*. The common reasons a value escapes:

- **Returning a pointer to a local.** `func New() *User { u := User{}; return &u }` — `u` must outlive the frame, so it's heap-allocated. (Returning the *value* `User` instead keeps it on the stack until the caller decides.)
- **Storing a pointer in something that outlives the call** — a field of a longer-lived struct, an element of a heap slice, a channel.
- **Interface boxing.** Assigning a concrete value to an `interface{}` (or any interface) boxes it: the value is copied to the heap and the interface holds a pointer. `fmt.Println(x)` escapes `x` for exactly this reason — `...interface{}` boxes every argument.
- **Closures capturing by reference.** A closure captures variables *by reference*, not by value. If the closure escapes (returned, stored, run in a goroutine), every captured variable escapes with it.
- **Size or shape unknown at compile time.** `make([]int, n)` with a non-constant `n` large enough, or anything the compiler can't bound, goes to the heap.

```go
// Escapes: pointer to local is returned.
func NewUser(name string) *User { return &User{Name: name} }

// Does NOT escape: value returned, lives in caller's frame.
func MakeUser(name string) User { return User{Name: name} }
```

> **Key insight:** Escape analysis is *interprocedural but conservative* — the compiler heap-allocates whenever it *can't prove* a value stays local, not only when it's certain it escapes. So small, leaf-ish functions and avoiding "pointer to local out the door" are what keep values on the stack. Don't guess; run `-gcflags=-m` and read the verdict for the exact line.

---

## The Allocation-Rate → GC-Frequency Loop

Here is the relationship that reframes the whole topic. A tracing GC like Go's runs roughly when the live heap has grown by a set fraction since the last collection. So the *frequency* of GC is governed not by how big your heap is, but by **how fast you allocate**:

```
GC interval ≈ (GOGC% × live_heap) / allocation_rate
```

Two services with an identical 200 MB live heap behave completely differently if one allocates 50 MB/s and the other 2 GB/s — the second triggers GC ~40× more often, and each cycle burns CPU on marking and steals cache. This is why allocation-heavy code shows up in the *CPU* profile as `runtime.mallocgc` and `gcBgMarkWorker`, not as a memory problem at all. The bytes get reclaimed fine; you're paying in **throughput**, not in residency.

The practical consequence: **reducing allocations/op is a CPU optimization as much as a memory one.** A loop that drops from `42 allocs/op` to `3` doesn't just save memory — it cuts the GC's workload by an order of magnitude, often recovering more wall-clock time than the allocation savings alone would suggest.

> **Key insight:** Heap *size* is a tuning knob (GOGC). Allocation *rate* is a code property — and it's the one that determines how often the GC interrupts your hot path. Optimize the rate in code; tune the size last.

---

## Preallocation and Growth Amortization

Slices and maps grow by **reallocation**: when capacity runs out, the runtime allocates a larger backing array (Go roughly doubles for small slices, then grows ~1.25× for large ones) and **copies** the old contents over. A slice that grows to N elements one `append` at a time performs O(log N) reallocations and copies a total of ~2N elements along the way — all of it garbage the moment it's superseded.

```go
// Bad: starts at cap 0, reallocates ~log2(10000) times, copying as it goes.
var out []int
for i := 0; i < 10000; i++ { out = append(out, f(i)) }

// Good: one allocation, zero growth copies.
out := make([]int, 0, 10000)
for i := 0; i < 10000; i++ { out = append(out, f(i)) }
```

The fix is to tell the runtime the size up front when you know (or can estimate) it: `make([]T, 0, n)` for slices, `make(map[K]V, n)` for maps (the hint sizes the bucket array so it doesn't rehash repeatedly). You don't need an exact count — even a rough upper bound collapses many reallocations into one.

> **Key insight:** Doubling makes *amortized* append O(1), but "amortized cheap" still produces real garbage on every doubling step. Preallocation converts O(log N) allocations-plus-copies into exactly one. When the final size is knowable, there is no reason not to.

A subtlety: a slice and its backing array are different things. `s = s[:0]` resets the length but **keeps the capacity** — the backing array is reused, zero new allocation. This is the foundation of buffer reuse (next sections).

---

## Value Semantics, In-Place Ops, and the `[]byte`↔`string` Tricks

Many allocations come from creating *new* objects when you could mutate or reuse existing ones.

**Value semantics keep things on the stack.** Passing and returning small structs *by value* (rather than `*T`) often avoids the heap entirely — the value rides in the caller's frame. The instinct that "pointers are cheaper" is wrong for small values: a pointer can *force* an escape that a value wouldn't.

**In-place operations reuse backing storage.** `strings.Builder` and `bytes.Buffer` grow one backing array and write into it, instead of `+`-concatenating which allocates a fresh string per step:

```go
// Allocates a new string every iteration — O(n²) bytes of garbage.
s := ""
for _, p := range parts { s += p }

// One amortized buffer; reuse it across calls with b.Reset().
var b strings.Builder
b.Grow(estimatedLen)            // preallocate the backing array
for _, p := range parts { b.WriteString(p) }
s := b.String()
```

**The `[]byte`↔`string` conversions normally copy.** `string(b)` and `[]byte(s)` each allocate and copy, because Go strings are immutable and the runtime must guarantee the string can't be mutated through the original slice. In hot paths this copy is pure overhead. The standard library already avoids it in the right places — `m[string(keyBytes)]` is special-cased by the compiler to *not* allocate, since the temporary string can't escape the lookup. For your own code, the safe modern tool is `unsafe.String`/`unsafe.Slice` (Go 1.20+):

```go
// Zero-copy view: NO allocation, but the []byte MUST NOT be mutated afterward,
// and the string MUST NOT outlive the backing slice.
s := unsafe.String(unsafe.SliceData(b), len(b))
```

> **Key insight:** The zero-copy `[]byte`↔`string` trick removes a real allocation but **breaks Go's immutability guarantee**. It is correct *only* when you can prove the bytes won't change and the alias won't outlive its source. Reach for it in measured hot paths, never by default — a mutated "immutable" string is a memory-safety bug that corrupts silently.

---

## Object Pooling — `sync.Pool` and When It Hurts

When an object is large, frequently created, and short-lived, recreating it each time is pure allocation pressure. A pool lets you reuse instances across calls. Go's `sync.Pool` is the standard tool:

```go
var bufPool = sync.Pool{
	New: func() any { return new(bytes.Buffer) },
}

func handle(w io.Writer, data []byte) {
	buf := bufPool.Get().(*bytes.Buffer)
	buf.Reset()                 // critical: clear stale state before use
	defer bufPool.Put(buf)
	buf.Write(data)
	// ... use buf ...
	w.Write(buf.Bytes())
}
```

`sync.Pool` is designed for exactly this: a per-P (per-processor) free list that the GC drains on each cycle. But it is sharp, and pooling helps far less often than people assume:

- **It helps** when the pooled object is meaningfully expensive (large buffers, parsers, gzip writers, `bytes.Buffer` reused thousands of times/sec) and the churn is real. The win shows up as a drop in `allocs/op` *and* in GC CPU.
- **It hurts** when objects are small or cheap — the pool's own bookkeeping, the type assertion, and the `Get`/`Put` synchronization can cost more than the allocation you avoided. Pooling a `struct{ x, y int }` is almost always a net loss.
- **Pool churn** is the classic trap: `sync.Pool` is cleared on *every* GC cycle, so objects you `Put` may be gone before the next `Get`. If your get/put rate doesn't comfortably exceed the GC frequency, the pool acts like a cache with a near-zero hit rate — you pay the overhead and still allocate.
- **Variable-size objects fragment the pool.** Pooling slices of wildly different sizes means `Get` often returns one too small, forcing a fresh allocation anyway. Cap the size you put back, or the pool's average payload bloats.

The cardinal correctness rule: **always reset pooled state before use.** A `bytes.Buffer` from the pool still holds the previous caller's bytes. Forgetting `Reset()` leaks data between requests — a real, exploitable bug class.

> **Key insight:** A pool replaces allocation cost with synchronization + bookkeeping + a GC-driven eviction risk. It's a win only when the object is expensive *and* reuse rate dwarfs GC frequency. Benchmark with `-benchmem` before *and* after; a pool that doesn't move `allocs/op` and `ns/op` together is just added complexity.

---

## Reading an Allocation Profile to Find the Worst Site

A heap profile has three lenses, and choosing the wrong one sends you optimizing the wrong line:

| View | `pprof` flag | Measures | Use it to find |
|---|---|---|---|
| **In-use space** | `-inuse_space` | bytes *live now* | leaks, oversized caches, retained working set |
| **In-use objects** | `-inuse_objects` | object *count* live now | many tiny live objects (map/pointer overhead) |
| **Alloc space** | `-alloc_space` | bytes *ever allocated* (cumulative) | sites producing the most GC byte-pressure |
| **Alloc objects** | `-alloc_objects` | objects *ever allocated* (cumulative) | sites producing the most *allocation count* — the GC-frequency driver |

For cutting GC pressure, `-alloc_objects` is usually the right starting lens: GC cost scales with the *number* of allocations more than their total bytes, and `allocs/op` is what `benchmem` reports. A site allocating ten million 24-byte objects hurts more than one allocating a single 200 MB buffer, even though `-alloc_space` ranks the latter higher.

```bash
go test -bench=. -benchmem -memprofile=mem.out
go tool pprof -alloc_objects mem.out
(pprof) top10            # worst call sites by allocation count
(pprof) list MyFunc      # annotated source: allocations per line
```

`list` is the payoff — it shows allocations attributed to each *line*, so you go from "this function allocates a lot" to "*this exact `append`/conversion/closure* is the cost." That line-level attribution is what turns a profile into a fix.

> **Key insight:** `-inuse_*` answers "what's holding memory?" (leaks, residency). `-alloc_*` answers "what's *generating* garbage?" (GC pressure). They diagnose different diseases; reaching for `-inuse_space` when your problem is GC CPU will point you at the wrong code every time.

---

## GC Tuning Basics — GOGC and the Heap Target

`GOGC` (default `100`) sets the heap-growth target: GC triggers when the live heap has grown by `GOGC%` since the last cycle. `GOGC=100` means "run when the heap has doubled"; `GOGC=200` means "wait until it triples." Higher GOGC → fewer, larger collections → less GC CPU but more memory; lower GOGC → the reverse.

```bash
GOGC=200 ./server     # trade RAM for throughput: GC half as often
GOGC=off ./batch      # disable entirely for a short-lived batch job
```

For services with a hard memory ceiling (containers, especially), Go 1.19+ added `GOMEMLIMIT` — a **soft memory limit** that makes the GC run *more aggressively* as the heap approaches the limit, regardless of GOGC. The modern pattern is `GOMEMLIMIT` set near your container limit (with headroom) plus a generous `GOGC`: you get throughput in the common case but avoid the OOM kill when the heap spikes.

The order of operations matters and is constantly inverted:

1. **First, reduce allocation rate in code** (the sections above). This shrinks GC cost *and* memory, and it's the only lever that doesn't trade one resource for another.
2. **Then tune GOGC/GOMEMLIMIT** to dial the remaining memory-vs-CPU trade for your environment.

> **Key insight:** GOGC and GOMEMLIMIT *redistribute* the cost between RAM and CPU; they don't remove it. Tuning them before cutting allocations is treating the symptom. Cut the rate first, then tune the residual trade-off to fit the box you run on.

---

## Worked Example — Escape Output and a benchmem Before/After

A JSON-ish formatter that builds a response line per record. The naive version:

```go
func format(recs []Record) []string {
	out := []string{}                       // cap 0 → grows by reallocation
	for _, r := range recs {
		s := fmt.Sprintf("%s=%d", r.Key, r.Val)  // Sprintf boxes args → escapes
		out = append(out, s)
	}
	return out
}
```

Run escape analysis and the benchmark:

```bash
$ go build -gcflags='-m' .
./format.go:3:9:  []string{} escapes to heap
./format.go:5:23: ... argument does not escape    # but Sprintf's interface boxing does
./format.go:5:24: r.Key escapes to heap
./format.go:5:31: r.Val escapes to heap

$ go test -bench=Format -benchmem
BenchmarkFormat-8    52143    22841 ns/op    14208 B/op    402 allocs/op
```

402 allocs for 100 records: one growing `out`, one boxed `Key` and `Val` each (200), plus the per-call `Sprintf` machinery. Rewrite with preallocation and a builder, dropping `Sprintf`:

```go
func format(recs []Record) []string {
	out := make([]string, 0, len(recs))      // one allocation for the slice
	var b strings.Builder
	for _, r := range recs {
		b.Reset()
		b.WriteString(r.Key)
		b.WriteByte('=')
		b.WriteString(strconv.Itoa(r.Val))   // no interface boxing
		out = append(out, b.String())
	}
	return out
}
```

```bash
$ go test -bench=Format -benchmem
BenchmarkFormat-8   214905    5436 ns/op    4816 B/op    101 allocs/op
```

`402 → 101 allocs/op`, `22.8µs → 5.4µs` (~4.2× faster), and a third the bytes. The remaining 101 are the one slice plus the 100 result strings — irreducible without changing the API (the caller wants `[]string`). The `strconv.Itoa`-vs-`Sprintf` swap alone removed the interface boxing that `-gcflags=-m` flagged on lines `Key`/`Val`. Note the throughput win exceeds the byte win — that's the allocation-rate-to-GC effect from earlier, cashed out as real wall-clock time.

---

## Mental Models

- **The stack is free; the heap has a tax collector.** Stack values vanish for free at return. Heap values must be tracked, marked, and swept by the GC. Escape analysis decides which bucket each value lands in — and you can read its decision with `-gcflags=-m`.

- **Allocation rate is the throttle; heap size is the tank.** How *often* the GC runs is set by how fast you fill the heap, not how big it is. You cut frequency by allocating less per operation, not by buying more RAM.

- **Pooling is a loan, not a gift.** You borrow an object and *must* return it clean. The interest is synchronization plus the risk the GC repossesses your pool mid-cycle. Only worth it for expensive objects reused faster than the GC clears them.

- **A conversion that copies is an allocation in disguise.** `string(b)`, `[]byte(s)`, `+`-concatenation, `Sprintf` boxing — none look like `make` or `new`, but each puts bytes on the heap. The profile sees through the disguise; your eyes often don't.

- **`-alloc_objects` for the GC, `-inuse_space` for the leak.** Two different lenses for two different diseases. Pick by symptom: GC-bound CPU → count of allocations; growing RSS → live bytes.

---

## Common Mistakes

1. **Returning `*T` "for efficiency" on small values.** A pointer to a local often *forces* an escape that returning the value by copy would avoid. For small structs, value semantics are frequently cheaper. Check with `-gcflags=-m`.

2. **Optimizing `-alloc_space` when the problem is GC frequency.** Total bytes ranks the one giant buffer first; GC cost is driven by allocation *count*. Use `-alloc_objects` to find the line spraying millions of tiny objects.

3. **Pooling cheap or rarely-reused objects.** `sync.Pool` overhead can exceed the allocation it replaces, and pool churn (cleared every GC) makes a low-reuse pool a near-zero-hit cache. Benchmark before *and* after; if `allocs/op` doesn't drop, remove the pool.

4. **Forgetting to reset pooled objects.** A `bytes.Buffer` from the pool still holds the last caller's data. No `Reset()` → cross-request data leakage, a genuine security bug, not just a perf nit.

5. **`append`-ing in a loop without preallocating.** Known final size and still `var s []T` then `append`? You're paying O(log N) reallocations and copies for nothing. `make([]T, 0, n)` collapses it to one.

6. **Reaching for the zero-copy `unsafe.String` trick by default.** It breaks immutability. Correct only when you can prove the bytes are stable and the alias won't outlive its backing array. Default to the safe copy; use `unsafe` only in a measured, contained hot path.

7. **Tuning GOGC before cutting allocations.** GOGC trades CPU for RAM; it doesn't reduce the work. Cut the allocation rate in code first, then dial GOGC/GOMEMLIMIT for the residual trade-off.

---

## Test Yourself

1. Why does returning `&localVar` from a function force a heap allocation, while returning `localVar` by value usually doesn't?
2. Two services have the same 200 MB live heap but one allocates 40× faster. Which spends more CPU in GC, and why isn't heap *size* the deciding factor?
3. You see `make([]int, 0, n)` instead of `var s []int`. What does the preallocation save, in terms of allocations and copies?
4. When does `sync.Pool` *hurt* rather than help? Name two distinct failure modes.
5. You're chasing GC-driven CPU cost. Do you start with `-inuse_space`, `-alloc_space`, or `-alloc_objects`? Why?
6. What guarantee does the zero-copy `unsafe.String(b)` trick break, and under what two conditions is it actually safe?

<details>
<summary>Answers</summary>

1. `&localVar` makes a pointer that must remain valid after the frame is gone, so the compiler can't prove the value's lifetime ends with the function — it heap-allocates. Returning by value copies into the caller's frame, so the local can stay on the stack.
2. The faster-allocating service spends far more CPU in GC. GC frequency ≈ `(GOGC% × live_heap) / allocation_rate`; with identical heap and GOGC, frequency scales with allocation rate — so ~40× more collections, each burning mark/sweep CPU.
3. It collapses the O(log N) reallocations (and the ~2N elements of copying) of repeated `append` growth into exactly **one** allocation and zero growth copies, since the backing array never needs to be replaced.
4. (a) When objects are small/cheap — pool bookkeeping + sync + type assertion cost more than the avoided allocation. (b) Pool churn — `sync.Pool` is cleared every GC cycle, so if get/put rate doesn't exceed GC frequency, the hit rate collapses to ~zero and you pay overhead while still allocating. (Also acceptable: variable-size objects causing fragmentation/too-small returns.)
5. `-alloc_objects`. GC cost scales with the *count* of allocations, and that's the lens that ranks the sites generating the most allocation events. `-inuse_space` finds leaks/residency (wrong disease); `-alloc_space` ranks by bytes, which over-weights one large buffer over millions of small ones.
6. It breaks **string immutability** — the string aliases the slice's backing array with no copy. Safe only when (a) the `[]byte` is never mutated for the lifetime of the string, and (b) the string never outlives the backing slice.

</details>

---

## Cheat Sheet

```
WHY IT ALLOCATES (escape causes)
  return &local                pointer outlives frame  → heap
  v assigned to interface{}    boxing                  → heap (copy + ptr)
  closure captures, then escapes  captured vars escape → heap
  make([]T, n) non-const big   size unknown            → heap
  string(b) / []byte(s) / s+="…" / Sprintf  copy/box   → heap (hidden alloc)
  read the verdict:  go build -gcflags='-m'  (-m -m for the why)

CUT ALLOCATIONS
  make([]T, 0, n)  make(map[K]V, n)   preallocate, kill growth copies
  s = s[:0]                            reuse backing array (no alloc)
  strings.Builder / bytes.Buffer + Grow + Reset   in-place build/reuse
  strconv.Itoa not Sprintf            avoid interface boxing
  value semantics for small structs   keep on stack
  unsafe.String/Slice (Go 1.20+)      zero-copy — ONLY if bytes stable & no escape

POOLING (sync.Pool)
  Get → Reset(!) → use → defer Put
  win:  expensive object, reuse rate >> GC frequency
  hurt: cheap object, low reuse (churn — cleared every GC), variable sizes

PROFILE LENS
  -alloc_objects   #allocs ever     → GC-frequency driver  (START HERE for GC CPU)
  -alloc_space     bytes ever       → byte pressure
  -inuse_objects   #live objects    → tiny-object overhead
  -inuse_space     bytes live now   → leaks / residency
  list FuncName    per-line attribution → the exact offending line

GC TUNING (last, not first)
  GC freq ≈ (GOGC% × live_heap) / alloc_rate
  GOGC=200    fewer GCs, more RAM      GOGC=off  batch jobs
  GOMEMLIMIT  soft cap, GC harder near limit  (set near container limit)
```

---

## Summary

- A value escapes to the heap when the compiler **can't prove** its lifetime ends with the function — returning pointers to locals, interface boxing, escaping closures, unbounded `make`. Read the verdict with `go build -gcflags='-m'`.
- GC *frequency* is driven by **allocation rate**, not heap size: `freq ≈ (GOGC% × live_heap) / alloc_rate`. Cutting `allocs/op` is therefore a CPU win, often showing up as less time in `runtime.mallocgc`.
- **Preallocate** slices and maps when the size is knowable — `make([]T, 0, n)` collapses O(log N) reallocations-and-copies into one. Reuse backing arrays with `s = s[:0]` and `strings.Builder`/`bytes.Buffer`.
- Hidden allocations live in **conversions and boxing**: `string(b)`, `[]byte(s)`, `+`-concat, `Sprintf`. The zero-copy `unsafe.String` trick removes them but breaks immutability — measured hot paths only.
- **`sync.Pool`** pays off only for expensive objects reused faster than the GC clears them; it hurts for cheap objects and under churn. Always `Reset()` before use, and benchmark before *and* after.
- Pick the right profile lens: **`-alloc_objects`** for GC pressure, **`-inuse_space`** for leaks. Tune **GOGC/GOMEMLIMIT** last — they trade RAM for CPU, they don't remove the work.

---

## Further Reading

- *The Go Programming Language* (Donovan & Kernighan) — value vs pointer semantics, the foundation under escape behaviour.
- "Escape Analysis in Go" — the official compiler notes and `cmd/compile/internal/escape` design docs; the authoritative description of when values escape.
- Go runtime docs: `GOGC`, `GOMEMLIMIT`, and the GC guide at `tip.golang.org/doc/gc-guide` — the canonical text on the allocation-rate/heap-target relationship.
- *Java Performance: The Definitive Guide* (Scott Oaks) — for contrast: TLABs (thread-local allocation buffers) make young-gen allocation a pointer bump, and JFR's allocation profiling (`jdk.ObjectAllocationSample`) is the JVM analogue of `-alloc_objects`; escape analysis there enables scalar replacement and stack allocation of non-escaping objects.

---

## Related Topics

- [junior.md](junior.md) — reading the heap profile and the three pprof memory lenses, the foundation this page builds on.
- [senior.md](senior.md) — custom allocators, arena allocation, off-heap storage, and tuning the GC for tail-latency-sensitive services.
- [03 — Allocation Profiling](../01-profiling/03-allocation-profiling/) — the profiler mechanics for capturing and reading allocation profiles in depth.
- [04 — CPU-Bound Optimization](../04-cpu-bound-optimization/middle.md) — the other half of the throughput story, where GC pressure surfaces as `mallocgc` in the CPU profile.
