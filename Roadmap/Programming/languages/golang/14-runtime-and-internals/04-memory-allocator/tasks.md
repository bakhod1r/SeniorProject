# Memory Allocator — Practice Tasks

Twenty hands-on exercises to build intuition for how the Go runtime allocates memory: escape analysis, size classes, mcache/mcentral/mheap, the tiny allocator, large-object path, the scavenger, and the radix-tree page allocator. The goal is not to memorise `runtime/malloc.go` — it is to read code, run an experiment, and *predict* the allocator's response before the numbers come back. Difficulty climbs from **Junior** through **Staff**.

Each task gives a Goal, Difficulty, Skills, Steps, Acceptance criteria, a folded Hint, and a folded Reference solution. Read junior.md first — the difference between "the compiler decided this escapes" (escape analysis), "the runtime grabbed an mspan from mcentral" (small allocation), and "the runtime took a page from mheap" (large allocation) is the spine of every task below. The exercises force you to live with that distinction.

Source references throughout: `runtime/malloc.go`, `runtime/mcache.go`, `runtime/mcentral.go`, `runtime/mheap.go`, `runtime/sizeclasses.go`, `runtime/mpagealloc.go`, `runtime/mgcscavenge.go`. Read them with the failing benchmark in one window and the source in the other — the questions you ask the source change after you've measured.

---

### Task 1: ReadMemStats before/after a 1M allocation

**Goal.** Use `runtime.ReadMemStats` to print HeapAlloc/HeapSys/HeapIdle before and after allocating 1,000,000 small items, and explain the deltas.

**Difficulty.** Junior.

**Skills.** `runtime.MemStats`, basic allocation accounting, reading `HeapAlloc` vs `HeapSys`.

**Steps.**

1. Write a program that calls `runtime.GC()` then `runtime.ReadMemStats(&m1)`.
2. Allocate `[]*struct{ X int }` of length 1,000,000 and fill each slot with `&struct{ X int }{i}`.
3. Call `runtime.GC()` then `runtime.ReadMemStats(&m2)`.
4. Print `HeapAlloc`, `HeapSys`, `HeapIdle`, `HeapObjects`, `Mallocs` deltas.
5. Comment on which delta is "live bytes" and which is "OS-reserved".

**Acceptance criteria.**

- `HeapObjects` delta is at least 1,000,000.
- `HeapAlloc` delta is bounded near `1_000_000 * 16` bytes (size class 2 / size 16, give or take alignment).
- You explain in a code comment why `HeapSys >= HeapAlloc` always.
- Program does not leak the slice (keep it alive until after the second ReadMemStats).

<details><summary>Hint</summary>

Call `runtime.GC()` before *each* `ReadMemStats` so the figure isn't polluted by unreachable garbage. To keep the slice alive past the measurement, reference it after the print — `runtime.KeepAlive(s)` is idiomatic. The smallest struct (`struct{ X int }` = 8 bytes) actually allocates into size class 2 (16 bytes) — see `runtime/sizeclasses.go`.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"fmt"
	"runtime"
)

type Item struct{ X int }

func main() {
	var m1, m2 runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&m1)

	const N = 1_000_000
	items := make([]*Item, N)
	for i := 0; i < N; i++ {
		items[i] = &Item{X: i}
	}

	runtime.GC()
	runtime.ReadMemStats(&m2)

	fmt.Printf("HeapAlloc   delta: %d bytes (%.2f MB)\n",
		m2.HeapAlloc-m1.HeapAlloc, float64(m2.HeapAlloc-m1.HeapAlloc)/1<<20)
	fmt.Printf("HeapSys     delta: %d bytes (%.2f MB)\n",
		m2.HeapSys-m1.HeapSys, float64(m2.HeapSys-m1.HeapSys)/1<<20)
	fmt.Printf("HeapIdle    delta: %d bytes\n", int64(m2.HeapIdle)-int64(m1.HeapIdle))
	fmt.Printf("HeapObjects delta: %d\n", m2.HeapObjects-m1.HeapObjects)
	fmt.Printf("Mallocs     delta: %d\n", m2.Mallocs-m1.Mallocs)

	// HeapAlloc  = live bytes the allocator has handed out to the program.
	// HeapSys    = bytes the runtime got from the OS via mmap (>= HeapAlloc).
	// HeapIdle   = pages held but not currently used to back live allocations.
	// HeapSys = HeapAlloc + HeapIdle + (small fixed metadata). Always.
	runtime.KeepAlive(items)
}
```

The delta is approximately `N * sizeclass[2].size = 1_000_000 * 16 = 16 MB` for the items plus `N * 8 = 8 MB` for the backing slice of pointers. If you see a much smaller `HeapAlloc` delta, you forgot to keep `items` alive — the GC reclaimed everything between the two ReadMemStats calls.

</details>

**Extension.** Re-run with `GOGC=off` and observe how `HeapSys` behaves differently when no GC fires between the two measurements.

---

### Task 2: Escape analysis on three functions

**Goal.** Run `go build -gcflags="-m"` on a small program and identify the compiler's escape decision for three functions.

**Difficulty.** Junior.

**Skills.** Reading `-gcflags="-m"` output, distinguishing stack vs heap allocation.

**Steps.**

1. Write a file `escape.go` with three functions: (a) returns a pointer to a local struct, (b) returns the struct by value, (c) takes the address but does not return it.
2. Build with `go build -gcflags="-m=2" escape.go` and capture the output.
3. For each function, write a one-line comment summarising the compiler's decision: "escapes to heap" or "does not escape".
4. Cross-check against your prediction — write predictions in a comment *before* running the build.

**Acceptance criteria.**

- Function (a) reports "moved to heap" or "escapes to heap".
- Function (b) reports no escape (return by value).
- Function (c) reports "does not escape" (address-of stays on stack).
- You can name which line of `-m=2` output justifies each decision.

<details><summary>Hint</summary>

The `-m` flag prints escape decisions; `-m=2` prints why. Look for phrases `escapes to heap`, `moved to heap`, and `does not escape`. The classic "pointer escapes via return" appears as `&T literal escapes to heap`. A struct returned by value is copied into the caller's frame and never appears in escape output at all — that itself is the answer.

</details>

<details><summary>Reference solution</summary>

```go
// escape.go
package main

type T struct{ X, Y int }

// (a) PREDICTION: escapes — address leaks via return.
// $ go build -gcflags='-m=2' says: "&T{...} escapes to heap"
func newT() *T {
	return &T{X: 1, Y: 2}
}

// (b) PREDICTION: stays on stack — return by value, no address taken.
// $ go build says nothing because there's no allocation to report.
func makeT() T {
	return T{X: 3, Y: 4}
}

// (c) PREDICTION: stays on stack — address taken but does not escape.
// $ go build says: "&t does not escape"
func useT() int {
	t := T{X: 5, Y: 6}
	p := &t
	return p.X + p.Y
}

func main() {
	_ = newT()
	_ = makeT()
	_ = useT()
}
```

Expected `-gcflags="-m"` output (Go 1.22+, abridged):

```
escape.go:7:9: &T{...} escapes to heap
escape.go:16:2: moved to heap: t   <-- NO, in (c) it does NOT move; this line should be absent
escape.go:19:7: &t does not escape
```

The lesson: returning a pointer to a local is the canonical escape. Returning by value is the canonical non-escape. Taking the address of a local without leaking it is *also* a non-escape — the compiler can keep `t` on the stack and let `p` reference it because `p`'s lifetime is bounded by the function frame. See `cmd/compile/internal/escape/` for the algorithm.

</details>

**Extension.** Add a fourth function that stores `&t` into a global slice. Predict, then verify the escape.

---

### Task 3: `new(int)` vs `&Int{0}` — heap or stack?

**Goal.** Demonstrate that `new(int)` and `&Int{0}` may or may not heap-allocate depending on how the result is used.

**Difficulty.** Junior.

**Skills.** Escape analysis, understanding that allocation syntax does not determine allocation site.

**Steps.**

1. Write four small functions:
   - `a()` calls `new(int)` and returns the pointer.
   - `b()` calls `new(int)`, dereferences once, and returns the int.
   - `c()` returns `&Int{0}` (a custom struct).
   - `d()` uses `&Int{0}` locally and returns one of its fields.
2. Run `go build -gcflags="-m"` and record which escape.
3. Add benchmarks `BenchmarkA`/`BenchmarkB`/`BenchmarkC`/`BenchmarkD` and run with `-benchmem`. Observe `allocs/op`.

**Acceptance criteria.**

- `a()` and `c()` show 1 alloc/op.
- `b()` and `d()` show 0 allocs/op.
- You can articulate "the keyword `new` does not force heap allocation — the *use* of the result does".

<details><summary>Hint</summary>

Allocation in Go is not a syntactic decision. `new(T)` is *exactly* equivalent to `&T{}` to the compiler — both go through escape analysis. The decision rule is: if the address can outlive the current stack frame, heap; otherwise stack. Returning the pointer leaks the address upward; dereferencing immediately and returning the value does not.

</details>

<details><summary>Reference solution</summary>

```go
package alloc

type Int struct{ V int }

// a: escapes — pointer returned.
func a() *int {
	p := new(int)
	*p = 7
	return p
}

// b: does not escape — pointer never leaves the frame.
func b() int {
	p := new(int)
	*p = 7
	return *p
}

// c: escapes — pointer returned.
func c() *Int {
	return &Int{V: 7}
}

// d: does not escape — address-of used purely locally.
func d() int {
	i := &Int{V: 7}
	return i.V
}
```

```go
package alloc

import "testing"

func BenchmarkA(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = a()
	}
}

func BenchmarkB(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = b1()
	}
}

func b1() int { return b() }

func BenchmarkC(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = c()
	}
}

func BenchmarkD(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = d()
	}
}
```

Expected output of `go test -bench=. -benchmem`:

```
BenchmarkA  ... 0.5 ns/op  8 B/op  1 allocs/op
BenchmarkB  ... 0.3 ns/op  0 B/op  0 allocs/op
BenchmarkC  ... 0.5 ns/op  8 B/op  1 allocs/op
BenchmarkD  ... 0.3 ns/op  0 B/op  0 allocs/op
```

The internalisation: `new` is a fossil keyword from early Go. Modern code uses `&T{}` for clarity, but the compiler treats them identically. If you see `new(T)` in a benchmark eating allocations, the *use* (return, store in global, pass into interface) is what costs — not the keyword.

</details>

**Extension.** Add `e()` that passes `new(int)` to a function whose argument is `interface{}`. Predict the escape, then verify. Interface conversions are a notorious escape trigger.

---

### Task 4: Allocations of `fmt.Sprintf` vs `strconv.Itoa`

**Goal.** Use `-benchmem` to measure allocations for converting an int to a string two ways.

**Difficulty.** Junior.

**Skills.** Benchmarking, reading `allocs/op`, understanding when reflection-heavy APIs cost more.

**Steps.**

1. Write `BenchmarkSprintf` that calls `fmt.Sprintf("%d", 12345)` in a loop.
2. Write `BenchmarkItoa` that calls `strconv.Itoa(12345)` in a loop.
3. Run `go test -bench=. -benchmem -benchtime=2s`.
4. Compare `B/op` and `allocs/op`.

**Acceptance criteria.**

- `Sprintf` reports at least 2 allocs/op (interface conversion + result string + formatter buffer churn).
- `Itoa` reports 1 alloc/op (just the result string).
- `ns/op` for `Itoa` is roughly 5–10x faster.

<details><summary>Hint</summary>

`fmt.Sprintf` runs the reflection-based formatter, which boxes `12345` into an `interface{}` (one alloc), allocates a `pp` formatter (often pooled — sometimes zero), and assembles the string (one more alloc). `strconv.Itoa` is a hand-rolled digit loop into a `[]byte` whose result is converted to `string`. Read `strconv/itoa.go` — it's a hundred lines, all of which exist to skip the boxing.

</details>

<details><summary>Reference solution</summary>

```go
package fmtbench

import (
	"fmt"
	"strconv"
	"testing"
)

func BenchmarkSprintf(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = fmt.Sprintf("%d", 12345)
	}
}

func BenchmarkItoa(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = strconv.Itoa(12345)
	}
}

func BenchmarkAppendInt(b *testing.B) {
	// Bonus: zero-alloc with a reusable scratch buffer.
	b.ReportAllocs()
	buf := make([]byte, 0, 32)
	for i := 0; i < b.N; i++ {
		buf = strconv.AppendInt(buf[:0], 12345, 10)
	}
	_ = buf
}
```

Typical output:

```
BenchmarkSprintf   ... 60 ns/op  24 B/op  2 allocs/op
BenchmarkItoa      ... 12 ns/op   8 B/op  1 allocs/op
BenchmarkAppendInt ...  4 ns/op   0 B/op  0 allocs/op
```

The takeaway: in any hot path that converts numbers to strings, `strconv.AppendInt` into a reused buffer is the zero-alloc form. Logging libraries (zerolog, zap) are fast for exactly this reason — they hand-roll formatters and reuse buffers; they never call `fmt`.

</details>

**Extension.** Reproduce the comparison for `fmt.Errorf("got %d", n)` vs `errors.New("got " + strconv.Itoa(n))`. The "fmt for errors" idiom costs more than most engineers realise.

---

### Task 5: Read `runtime/sizeclasses.go` — explain three classes

**Goal.** Pick three size classes from the table in `runtime/sizeclasses.go` and explain `npages`, `size`, `nclass`, and the resulting `objects per span`.

**Difficulty.** Middle.

**Skills.** Reading runtime sources, understanding span layout, computing waste.

**Steps.**

1. Locate `runtime/sizeclasses.go`. Read the comment block at the top.
2. Pick size classes 3 (size 32 B), 25 (size 1024 B), and 67 (size 32768 B).
3. For each: compute `objects per span = (npages * 8192) / size`. Verify against the table.
4. Identify the "tail waste" — bytes per span unused because `pagesize % size != 0`.
5. Explain in plain English why class 67 needs more pages.

**Acceptance criteria.**

- Three correct (`size`, `npages`, `objects`, `tail-waste`) tuples in a comment.
- One sentence per class explaining why the runtime chose that `npages`.

<details><summary>Hint</summary>

A "page" in the Go runtime is 8192 bytes (`_PageSize` in `runtime/malloc.go`). A size class with `npages = N` means each span occupies `N * 8192` bytes and holds `(N * 8192) / size` objects. The number of pages is chosen so that the leftover at the tail of the span is < ~12.5% of the span — read the constants `_MaxSmallSize` and `tailWaste` near the top of the file.

</details>

<details><summary>Reference solution</summary>

```go
// notes_sizeclasses.go
package notes

// runtime/sizeclasses.go (Go 1.22) table excerpt:
//
//   class  bytes/obj  bytes/span  objects  tail waste  max waste
//   ...
//      3        32        8192      256        0          46.88%
//   ...
//     25      1024        8192        8        0          21.48%
//   ...
//     67     32768       32768        1        0          12.50%
//
// Class 3 (size = 32 B):
//   npages   = 1
//   span     = 8192 B
//   objects  = 8192 / 32 = 256
//   tail     = 8192 - 256*32 = 0 B  (perfect packing)
//   why 1 page: 32 divides 8192 evenly, so a single page is optimal.
//
// Class 25 (size = 1024 B):
//   npages   = 1
//   span     = 8192 B
//   objects  = 8192 / 1024 = 8
//   tail     = 0 B (perfect)
//   why 1 page: 1024 divides 8192; 8 objects per span is enough granularity.
//
// Class 67 (size = 32 KiB):
//   npages   = 4
//   span     = 32768 B
//   objects  = 32768 / 32768 = 1
//   tail     = 0 B
//   why 4 pages: a single object IS the span. Above _MaxSmallSize (32 KiB)
//   we'd go through the large-object path (mheap directly, no mcache).
//
// The table is generated by runtime/mksizeclasses.go, which searches for
// the (size, npages) pair that keeps waste < 12.5% for each size class.
// See the comment in malloc.go for the historical justification — the
// 12.5% bound is the "worst-case fragmentation" guarantee Go gives.
```

The senior internalisation: size classes are a static, code-generated array. There are 68 of them (class 0 is reserved). Every small allocation is rounded up to one of these sizes — there are no other sizes. When you see `HeapAlloc - HeapSys` mismatch, the gap is "rounding waste plus span tails plus per-mspan metadata".

</details>

**Extension.** Run `go run runtime/mksizeclasses.go` (it's a generator) and observe the algorithm. What would happen if you changed `_MaxSmallSize` to 16 KiB?

---

### Task 6: Trigger a small-object refill from mcentral

**Goal.** Construct a benchmark that allocates so many objects of one size class that the per-P mcache must refill from mcentral, and observe the refill via a tracer.

**Difficulty.** Middle.

**Skills.** mcache/mcentral interaction, GODEBUG tracing, span lifecycle.

**Steps.**

1. Pick size class 5 (size 64 B). Write a benchmark allocating 100,000 `[64]byte` arrays.
2. Run with `GODEBUG=allocfreetrace=0,gctrace=1` — observe GC frequency.
3. Run with `GOEXPERIMENT=` and `GODEBUG=gctrace=1` capturing one cycle.
4. Estimate: a single mspan for class 5 holds `8192 / 64 = 128` objects, so 100,000 allocations require ~780 mcentral refills per P. Multiply by GOMAXPROCS.
5. Write the prediction as a comment; verify the gctrace pace agrees in order of magnitude.

**Acceptance criteria.**

- Benchmark allocates 100k `[64]byte` and reports `>= 100k allocs/op` aggregate.
- A comment estimates refill count and explains "refill = mcache asks mcentral for a fresh mspan".
- `GODEBUG=gctrace=1` shows GC cycles consistent with the heap-growth rate.

<details><summary>Hint</summary>

The per-P mcache holds at most one mspan per size class. When that span runs out of free objects, mcache calls `(*mcentral).cacheSpan()` (see `runtime/mcentral.go`). mcentral keeps two lists per class: spans with free objects (`partial`) and spans that are full (`full`). On refill, mcentral pops from `partial`; if empty, it asks mheap for a fresh span. The full lifecycle is in the comment block of `mcentral.go`.

</details>

<details><summary>Reference solution</summary>

```go
package refill

import "testing"

type Block [64]byte

// One Block goes into size class 5 (size 64). One mspan for class 5 has
// npages = 1, so 8192 / 64 = 128 objects per span. 100_000 allocations
// require ~782 mcentral refills per goroutine, multiplied across all Ps
// that get scheduled to allocate.
func BenchmarkSmallRefill(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		bs := make([]*Block, 100_000)
		for j := range bs {
			bs[j] = &Block{}
		}
		_ = bs
	}
}
```

Run with:

```
$ GODEBUG=gctrace=1 go test -bench=BenchmarkSmallRefill -benchmem -benchtime=2s
```

Each `gc` line in the trace prints heap-before/heap-after sizes. A 100k * 64 = 6.4 MB allocation pass will trigger one or two GC cycles depending on the initial heap target (`GOGC=100` doubles the heap before triggering). Per cycle the mcache-mcentral traffic is hundreds of refills per P.

You won't see refills directly in `gctrace` — they're internal. To see them, use the runtime/trace tool:

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()
// ... allocate ...
```

Then `go tool trace trace.out` and inspect the "GC and Sweep" lane for `runtime.mcache.refill` frames. The intuition: a hot allocation loop on a single size class burns through mcache spans quickly, and mcentral is the next-tier cache that prevents every refill from going to mheap (which would hit a global lock).

</details>

**Extension.** Run the same benchmark with `runtime.GOMAXPROCS(1)` vs `GOMAXPROCS(8)`. mcache is per-P; refill rate per P drops as Ps multiply because work is distributed.

---

### Task 7: HeapAlloc delta for 100k small objects

**Goal.** Allocate 100,000 small objects and measure the precise `HeapAlloc` delta.

**Difficulty.** Middle.

**Skills.** `runtime.MemStats`, size-class rounding, predicting allocator bookkeeping.

**Steps.**

1. Define `type S struct { A, B int32 }` — 8 bytes net.
2. Capture `m1` before, allocate 100,000 `*S`, capture `m2` after (with `runtime.GC()` between).
3. Predict `HeapAlloc` delta: `100_000 * sizeClass(8) = 100_000 * 16 = 1_600_000` bytes for the items, plus `100_000 * 8 = 800_000` for the pointer slice.
4. Print actual delta. Reconcile to within 1%.

**Acceptance criteria.**

- Prediction within 1% of observed `HeapAlloc` delta.
- Comment explains why net 8 bytes per object becomes 16 on the heap (size class 2: size 16, alignment & header overhead).
- Slice is kept alive via `runtime.KeepAlive`.

<details><summary>Hint</summary>

The minimum object size in the small allocator is 16 bytes (size class 2). Anything <= 16 bytes rounds up to 16. To see the rounding, read `nextFreeFast` in `runtime/malloc.go` — it computes the size class via `class_to_size[sizeclass]`. The "extra" bytes are not visible to the program but cost real heap.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"fmt"
	"runtime"
)

type S struct {
	A, B int32
}

func main() {
	const N = 100_000

	var m1, m2 runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&m1)

	xs := make([]*S, N)
	for i := 0; i < N; i++ {
		xs[i] = &S{A: int32(i), B: int32(-i)}
	}

	runtime.GC()
	runtime.ReadMemStats(&m2)

	want := uint64(N*16 + N*8) // 16 B per S (rounded), 8 B per slice slot
	got := m2.HeapAlloc - m1.HeapAlloc

	fmt.Printf("want ~%d B, got %d B (%.2f%% diff)\n",
		want, got, 100*float64(int64(got)-int64(want))/float64(want))

	runtime.KeepAlive(xs)
}
```

Expected: `want ~2_400_000`, `got ~2_400_000` ± a few KiB for mspan headers and pre-existing heap usage. If you see a 10% difference, you've either skipped `runtime.GC()` (so old garbage still counts) or you've used a struct that crosses into a different size class than you predicted — recheck against `runtime/sizeclasses.go`.

</details>

**Extension.** Change `S` to `struct{ A, B, C int64 }` (24 bytes net). Predict the new delta: 32 B/object (size class 4). Verify.

---

### Task 8: `sync.Pool` for 1 KiB buffers

**Goal.** Use `sync.Pool` to recycle 1 KiB scratch buffers; compare allocations with/without the pool.

**Difficulty.** Middle.

**Skills.** `sync.Pool`, allocation amortisation, when pooling helps and when it doesn't.

**Steps.**

1. Write `BenchmarkNoPool` that creates a fresh `make([]byte, 1024)` per iteration, writes a digit pattern into it, and returns the first byte.
2. Write `BenchmarkPool` using a `sync.Pool` whose `New` returns a 1 KiB buffer; get, write, return via `Put`.
3. Run both with `-benchmem`. Compare `allocs/op` and `B/op`.
4. Add `BenchmarkPoolUnderGC` that calls `runtime.GC()` once per iteration to show the pool drain on GC.

**Acceptance criteria.**

- `NoPool` reports 1 alloc/op, 1024 B/op.
- `Pool` reports near 0 allocs/op steady-state.
- `PoolUnderGC` reports near 1 alloc/op (pool is fully drained each GC cycle).
- A comment explains "sync.Pool entries are cleared at every GC".

<details><summary>Hint</summary>

`sync.Pool` is *not* an object cache that survives GC — every full GC cycle empties pool victim caches. The two-generation Get/Put logic is in `sync/pool.go`. The pool wins when allocations are hot *between* GC cycles (most production workloads). Under tight memory pressure it offers little.

</details>

<details><summary>Reference solution</summary>

```go
package poolbench

import (
	"runtime"
	"sync"
	"testing"
)

var bufPool = sync.Pool{
	New: func() any {
		b := make([]byte, 1024)
		return &b
	},
}

func BenchmarkNoPool(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		buf := make([]byte, 1024)
		buf[0] = byte(i)
		_ = buf[0]
	}
}

func BenchmarkPool(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		pb := bufPool.Get().(*[]byte)
		buf := *pb
		buf[0] = byte(i)
		_ = buf[0]
		bufPool.Put(pb)
	}
}

func BenchmarkPoolUnderGC(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		pb := bufPool.Get().(*[]byte)
		(*pb)[0] = byte(i)
		bufPool.Put(pb)
		if i%1000 == 0 {
			runtime.GC()
		}
	}
}
```

Typical output:

```
BenchmarkNoPool       ... 50 ns/op  1024 B/op  1 allocs/op
BenchmarkPool         ... 12 ns/op     0 B/op  0 allocs/op
BenchmarkPoolUnderGC  ... 60 ns/op   ~1 KB/op  ~1 allocs/op
```

The senior detail: store `*[]byte` in the pool, not `[]byte`. Storing a slice value boxes it via an interface conversion on every Put — defeating the pool. Storing the pointer is one heap-cold load and one assignment. See `bytes/buffer.go` for the same idiom in the stdlib.

</details>

**Extension.** Use `runtime.SetFinalizer` to count how many pool buffers are reclaimed by GC. The number should equal the pool size at the moment GC ran.

---

### Task 9: Pointer-heavy vs value-heavy structs and GC scan time

**Goal.** Compare a struct with all pointer fields vs all value fields; benchmark GC scan time.

**Difficulty.** Middle.

**Skills.** GC mark phase, pointer-bitmap layout, `runtime.MemStats.PauseNs`.

**Steps.**

1. Define `type P struct { A, B, C *int }` and `type V struct { A, B, C int }`.
2. Allocate 1,000,000 of each in two separate runs.
3. Trigger 10 GC cycles in each run; record `PauseTotalNs`.
4. Compare. Pointers force GC to walk; values do not.

**Acceptance criteria.**

- `P`-heap GC pause time is measurably larger (often 2–5x).
- A comment explains "the GC mark phase walks pointer bitmaps; value-only structs have a zero bitmap and skip scanning".

<details><summary>Hint</summary>

Every type has a "ptr-mask" the compiler emits — one bit per word indicating "pointer here". The mark phase only enqueues words flagged as pointers. A struct of pure `int`s has an all-zero ptr-mask. A struct of `*int` has an all-ones ptr-mask. The cost difference is real and measurable on multi-million-object heaps.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"fmt"
	"runtime"
)

type P struct{ A, B, C *int }
type V struct{ A, B, C int }

func gcStats() (uint64, uint64) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return m.PauseTotalNs, m.NumGC
}

func runPointers(n int) {
	xs := make([]*P, n)
	one := 1
	for i := range xs {
		xs[i] = &P{A: &one, B: &one, C: &one}
	}
	for i := 0; i < 10; i++ {
		runtime.GC()
	}
	runtime.KeepAlive(xs)
}

func runValues(n int) {
	xs := make([]*V, n)
	for i := range xs {
		xs[i] = &V{A: 1, B: 1, C: 1}
	}
	for i := 0; i < 10; i++ {
		runtime.GC()
	}
	runtime.KeepAlive(xs)
}

func main() {
	const N = 1_000_000

	p0, g0 := gcStats()
	runPointers(N)
	p1, g1 := gcStats()
	fmt.Printf("pointers: %d GCs, total pause %.2f ms\n",
		g1-g0, float64(p1-p0)/1e6)

	p2, g2 := gcStats()
	runValues(N)
	p3, g3 := gcStats()
	fmt.Printf("values:   %d GCs, total pause %.2f ms\n",
		g3-g2, float64(p3-p2)/1e6)
}
```

Typical output:

```
pointers: 12 GCs, total pause 42.30 ms
values:   12 GCs, total pause 14.10 ms
```

The intuition for senior engineers: when you design a data-heavy struct, prefer `int64 ID` to `*Owner` if you can resolve the pointer via a side-table later. Database-row caches, in-memory indexes, and time-series buffers benefit from this. The classic Discord story (switching from Go to Rust partially) cited GC scan cost on 11M-entry hot caches — they were pointer-rich.

</details>

**Extension.** Use `runtime.GCStats` (from `runtime/debug`) for richer per-cycle data. Plot pause times across cycles — you'll see the first 1–2 cycles are noisier than steady-state.

---

### Task 10: Closure capture forcing heap escape

**Goal.** Write code where closure capture forces a local variable onto the heap; confirm with `-gcflags="-m"`.

**Difficulty.** Middle.

**Skills.** Closures, escape analysis, lifetime of captured variables.

**Steps.**

1. Write a function that creates a local int `n`, returns a closure capturing `&n`, and observe the escape.
2. Write a contrasting function that creates a local int `n`, returns a closure that captures `n` by value, and observe no escape.
3. Build with `-gcflags="-m=2"` to see the escape graph.

**Acceptance criteria.**

- First closure: `-m` reports `moved to heap: n` (or `&n escapes to heap`).
- Second closure: no escape diagnostics for `n`.
- A comment explains "a closure captures variables by reference; if the closure outlives the frame, the captured vars must move to the heap".

<details><summary>Hint</summary>

A Go closure is a struct holding pointers to captured variables. If the closure is returned (escapes the frame), every captured variable must outlive the frame too, which forces them to the heap. Capturing by *value* (passing the int as an argument to the closure factory) doesn't capture — the value lives inside the closure struct and never needs heap promotion if the closure itself doesn't escape further.

</details>

<details><summary>Reference solution</summary>

```go
// closure_escape.go
package main

import "fmt"

// counter1 returns a closure that mutates `n`. `n` escapes because the
// closure outlives the frame and holds a pointer to `n`.
//
// $ go build -gcflags='-m' says: "moved to heap: n"
func counter1() func() int {
	n := 0
	return func() int {
		n++
		return n
	}
}

// counter2 returns a closure that does NOT mutate the captured int,
// but captures BY REFERENCE because that's what closures do. So `n`
// still escapes.
//
// $ go build -gcflags='-m' says: "moved to heap: n"
func counter2() func() int {
	n := 42
	return func() int {
		return n // still captured by reference; n must outlive counter2
	}
}

// counter3 uses a factory that takes the int as an argument. The
// closure captures a parameter, but the parameter is copied into the
// closure struct itself; nothing on the outer frame needs to outlive
// counter3.
//
// $ go build -gcflags='-m' says nothing about heap for the int (the
// returned func itself still escapes — closures are heap-allocated when
// returned — but the int is part of the closure object).
func counter3(start int) func() int {
	return func() int {
		return start
	}
}

func main() {
	c1 := counter1()
	fmt.Println(c1(), c1(), c1()) // 1 2 3
	c2 := counter2()
	fmt.Println(c2()) // 42
	c3 := counter3(7)
	fmt.Println(c3()) // 7
}
```

Run:

```
$ go build -gcflags='-m=2' closure_escape.go 2>&1 | grep -E 'heap|escape'
./closure_escape.go:10:2: moved to heap: n
./closure_escape.go:11:9: func literal escapes to heap
./closure_escape.go:21:2: moved to heap: n
./closure_escape.go:22:9: func literal escapes to heap
./closure_escape.go:32:9: func literal escapes to heap
```

The closure itself always escapes when returned — that's a separate allocation for the closure struct. The interesting variable is whether *captured locals* escape. They do whenever the closure captures by reference (default) and the closure outlives the frame. The mitigation in `counter3` is to make the value a *parameter* of the closure factory — Go copies parameters into the new frame, and the closure embeds the value rather than a pointer.

</details>

**Extension.** Write a closure that captures a 64-byte struct. Build with `-m=2`. Then make a version that captures only a slice header (24 bytes). Compare allocation sizes.

---

### Task 11: Profile with `pprof -alloc_space` — top 3 allocators

**Goal.** Profile a small program with `pprof -alloc_space` and identify the top 3 allocation sites.

**Difficulty.** Senior.

**Skills.** `net/http/pprof`, `go tool pprof`, reading flame graphs by allocated bytes.

**Steps.**

1. Write a program that imports `_ "net/http/pprof"` and starts a `http.ListenAndServe(":6060", nil)` in a goroutine.
2. In the main goroutine, run three workloads: (a) JSON-marshal 10,000 structs, (b) build 10,000 strings via `+`, (c) allocate 10,000 1 KiB scratch buffers.
3. Capture a heap profile: `go tool pprof -alloc_space http://localhost:6060/debug/pprof/allocs`.
4. Use `top10` and `list` to identify the top 3 sites by `flat` bytes.
5. Document the three top callers in a comment.

**Acceptance criteria.**

- Three callers identified with their `flat` and `cum` byte counts.
- One sentence per site explaining the allocator's view (which size class, hot path or cold).

<details><summary>Hint</summary>

`-alloc_space` is "cumulative bytes allocated since process start" — *not* live heap. It captures churn. The complementary view `-inuse_space` is "what's still live now". For finding hot allocation sites, `-alloc_space` is the right axis. `top10 -cum` sorts by cumulative; `list <func>` shows per-line bytes inside one function.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"encoding/json"
	"log"
	"net/http"
	_ "net/http/pprof"
	"strconv"
	"time"
)

type Item struct{ ID int; Name string }

func workA() {
	for i := 0; i < 10_000; i++ {
		b, _ := json.Marshal(Item{ID: i, Name: "item-" + strconv.Itoa(i)})
		_ = b
	}
}

func workB() {
	for i := 0; i < 10_000; i++ {
		s := ""
		for j := 0; j < 10; j++ {
			s += "x"
		}
		_ = s
	}
}

func workC() {
	for i := 0; i < 10_000; i++ {
		b := make([]byte, 1024)
		b[0] = byte(i)
		_ = b
	}
}

func main() {
	go func() { log.Fatal(http.ListenAndServe(":6060", nil)) }()
	for {
		workA()
		workB()
		workC()
		time.Sleep(50 * time.Millisecond)
	}
}
```

Capture:

```
$ go tool pprof -alloc_space http://localhost:6060/debug/pprof/allocs
(pprof) top10
Showing nodes accounting for 130MB, 96.30% of 135MB total
      flat   flat%   sum%        cum   cum%
      40MB  29.6%  29.6%       40MB  29.6%  main.workB (string concat)
      35MB  25.9%  55.5%       45MB  33.3%  encoding/json.Marshal
      25MB  18.5%  74.0%       25MB  18.5%  main.workC ([]byte alloc)
      15MB  11.1%  85.1%       15MB  11.1%  strconv.Itoa
      ...
```

Top three (typical):

```
// 1. main.workB — string concatenation in a loop.
//    Each "s += 'x'" allocates a new string of length |s|+1. The total
//    cost is O(N^2) bytes per outer iteration. The fix is strings.Builder
//    or []byte assembly.
//
// 2. encoding/json.Marshal — emits a fresh []byte per call.
//    Reflection-based marshalling allocates scratch buffers and a result
//    slice every call. Mitigation: json.Encoder against a pooled bytes.Buffer.
//
// 3. main.workC — explicit make([]byte, 1024).
//    Direct alloc; one per loop iteration. Already pool-able via sync.Pool
//    if the call site can release the buffer at a defined point.
```

The senior skill: reading the pprof output AND knowing which fix corresponds to each site. JSON marshalling cost has a fixed mitigation (encoder + pool). String concatenation cost has a fixed mitigation (`strings.Builder`). The third site (explicit `make`) requires deciding whether the buffer's lifetime is bounded enough for a pool — sometimes yes, often no.

</details>

**Extension.** Add `pprof.SetGoroutineLabels` around each `work*` call. The flame graph then groups by label, which makes the per-workload view trivial.

---

### Task 12: `pprof -alloc_objects` vs `-alloc_space`

**Goal.** Capture both `-alloc_space` (bytes) and `-alloc_objects` (count). Discuss when each view matters.

**Difficulty.** Senior.

**Skills.** Profile interpretation, distinguishing GC pressure from allocator throughput.

**Steps.**

1. Reuse the program from Task 11.
2. Capture two profiles: `-alloc_space` and `-alloc_objects`.
3. Compare the top 5 in each. Are they the same? Probably not.
4. Identify one site that is hot in count but cool in bytes (many small allocs) and one that is hot in bytes but cool in count (few large allocs).
5. Write a one-paragraph rule of thumb: when to optimise the count and when to optimise the bytes.

**Acceptance criteria.**

- Two distinct top-5 lists captured.
- At least one "count-heavy, byte-light" callsite identified.
- One paragraph explains: count drives mcache/mcentral traffic and GC mark cost; bytes drive heap size and pause time.

<details><summary>Hint</summary>

The mark phase of the GC walks pointers; each *object* contributes mark-bitmap work proportional to its size, but the per-object overhead (queue push/pop, span lookup) is constant. So 1,000,000 16-byte allocs cost more *mark work* than 10,000 1 KiB allocs even though the latter is more bytes. Conversely, allocator throughput is dominated by `mallocgc` calls — also per-object, not per-byte.

</details>

<details><summary>Reference solution</summary>

```go
// Capture commands:
//
//   $ go tool pprof -alloc_space   http://localhost:6060/debug/pprof/allocs
//   (pprof) top5 -cum
//
//   $ go tool pprof -alloc_objects http://localhost:6060/debug/pprof/allocs
//   (pprof) top5 -cum
//
// Typical divergence:
//
//   Space view (bytes):
//     1. workB (string concat)         40 MB   - bytes hot, count cool
//     2. encoding/json.Marshal         35 MB   - bytes hot, count moderate
//     3. workC ([]byte 1024)           25 MB   - bytes hot, count hot
//
//   Object view (count):
//     1. strconv.Itoa                  500_000 - count hot, bytes cool
//     2. json.encodeStringField        400_000 - count hot, bytes moderate
//     3. workB (string concat)         100_000 - count moderate, bytes hot
//
// Rule of thumb:
//   * Optimise BYTES when paus times grow with heap size — i.e. the mark
//     phase is your bottleneck, or RSS is climbing.
//   * Optimise COUNT when malloc/mcache traffic dominates CPU — i.e. you
//     see runtime.mallocgc high in CPU profiles, or GC frequency is high
//     (small frequent allocs trigger GC sooner because GOGC is %-based).
//
// Practical priority: object-count optimisations almost always pay for
// themselves first. Bytes follow naturally — fewer small allocs usually
// means a tighter heap. The exception is "rarely-allocated large blob"
// (image decoders, big JSON payloads) — for those, bytes is the only
// useful axis.
```

The senior judgement: `-alloc_objects` is the better starting view because it surfaces allocations the byte view obscures — a function that does 500k tiny mallocs may not show in `top10` by bytes at all but is shredding the allocator. `-alloc_space` is the view your manager wants to see in a slide deck about "memory growth".

</details>

**Extension.** Add `runtime/pprof.WriteHeapProfile` programmatically every 30 seconds. Diff successive snapshots with `go tool pprof -base older.pb.gz newer.pb.gz` to see *what changed* between two points in time.

---

### Task 13: Watch the scavenger with `GODEBUG=scavtrace=1`

**Goal.** Set `GODEBUG=scavtrace=1` and observe the scavenger releasing memory back to the OS over time.

**Difficulty.** Senior.

**Skills.** Reading scavtrace output, understanding the page scavenger lifecycle.

**Steps.**

1. Write a program that allocates 100 MB of slices, drops them, runs `runtime.GC()`, and sleeps for 60 seconds in a loop.
2. Run with `GODEBUG=scavtrace=1 go run .`.
3. Observe the trace lines: `scav N KiB...`. Note the cadence (~1 line per second when scavenger is active).
4. Compare `RSS` (via `ps -orss= -p $PID`) at 0 s, 10 s, and 60 s.

**Acceptance criteria.**

- Scavtrace output captured.
- RSS measured at three timestamps showing post-drop decline.
- A comment explains: the scavenger releases idle pages back to the OS via `madvise(MADV_DONTNEED)` (Linux) or `VM_PAGEABLE` (BSD/Darwin), and runs continuously in the background paced by `runtime.GOMEMLIMIT` and `GOGC`.

<details><summary>Hint</summary>

The scavenger runs as a background goroutine (`runtime.bgscavenge`) that walks the page allocator's radix tree looking for runs of "released-able" pages. It releases at a pace targeted to keep the heap close to its target size. The `scavtrace=1` output prints per-cycle stats: how many KiB returned, current RSS estimate, time spent. Read `runtime/mgcscavenge.go` — the goal-seeking logic is well-commented.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"fmt"
	"os"
	"runtime"
	"time"
)

func main() {
	fmt.Printf("pid=%d\n", os.Getpid())
	for cycle := 0; cycle < 6; cycle++ {
		// Allocate 100 MB.
		big := make([][]byte, 100)
		for i := range big {
			big[i] = make([]byte, 1<<20) // 1 MiB
		}
		runtime.KeepAlive(big)
		// Drop.
		big = nil
		runtime.GC()
		fmt.Printf("cycle=%d dropped 100MB, sleeping 10s\n", cycle)
		time.Sleep(10 * time.Second)
	}
}
```

Run:

```
$ GODEBUG=scavtrace=1 go run scav.go

pid=12345
cycle=0 dropped 100MB, sleeping 10s
scav 1 KiB work (1 KiB in 0 ms; 0% util), 50 MiB total, 0% util
scav 2 KiB work (1 KiB in 0 ms; 1% util), 75 MiB total, 0% util
scav 4 KiB work (2 KiB in 0 ms; 1% util), 90 MiB total, 1% util
cycle=1 ...
```

Verify RSS in another terminal:

```
$ while sleep 5; do ps -orss= -p 12345; done
512000   # right after first allocation
410000   # 5s after drop
180000   # 30s after drop — scavenger is releasing
80000    # 60s after drop — fully released back to OS
```

The senior intuition: GC frees memory back to the *heap* (sets HeapAlloc down); scavenger frees memory back to the *OS* (sets RSS down). They are decoupled. A program can have `HeapAlloc = 10 MB` and `RSS = 500 MB` for a long time after a peak — that's normal and the scavenger will close the gap *eventually*. If RSS staying high is a problem (containers with strict limits), `debug.FreeOSMemory()` forces it now (next task).

</details>

**Extension.** Set `GOMEMLIMIT=200MiB` (Go 1.19+) and re-run. The scavenger will be aggressive trying to keep RSS under the limit — observe how scavtrace cadence changes.

---

### Task 14: `debug.FreeOSMemory` and RSS measurement

**Goal.** Force the scavenger via `debug.FreeOSMemory` and measure RSS before and after.

**Difficulty.** Senior.

**Skills.** `runtime/debug.FreeOSMemory`, `/proc/self/status` parsing, knowing when (and when not) to call it.

**Steps.**

1. Allocate 200 MB. Print RSS via `/proc/self/status` (Linux) or `ps -orss=`.
2. Drop the allocation. Run `runtime.GC()`. Print RSS — likely unchanged.
3. Call `debug.FreeOSMemory()`. Print RSS — should drop substantially.
4. Document the observation in a comment, including the warning from godoc: this is a stop-the-world operation, not for hot paths.

**Acceptance criteria.**

- RSS measurements at three points: post-alloc, post-GC, post-FreeOSMemory.
- Drop after FreeOSMemory is at least 50% of the peak.
- Comment quotes/paraphrases the FreeOSMemory godoc warning.

<details><summary>Hint</summary>

`debug.FreeOSMemory` calls `runtime.GC()` then synchronously runs the scavenger to release every page it can. The godoc note: "FreeOSMemory forces a garbage collection followed by an attempt to return as much memory to the operating system as possible. (Even if this is not called, the runtime gradually returns memory to the operating system in a background task.)" Use this at known low-traffic moments (e.g. after a batch import), never in a per-request handler.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"time"
)

func rssKB() int {
	f, err := os.Open("/proc/self/status")
	if err != nil {
		return -1
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "VmRSS:") {
			fields := strings.Fields(line)
			n, _ := strconv.Atoi(fields[1])
			return n
		}
	}
	return -1
}

func main() {
	fmt.Printf("startup: RSS=%d KB\n", rssKB())

	// Allocate 200 MB.
	big := make([][]byte, 200)
	for i := range big {
		big[i] = make([]byte, 1<<20)
		big[i][0] = 1 // touch the page so it's resident
	}
	fmt.Printf("after alloc: RSS=%d KB\n", rssKB())

	// Drop and GC.
	big = nil
	runtime.GC()
	time.Sleep(100 * time.Millisecond) // GC is async-ish
	fmt.Printf("after GC: RSS=%d KB (likely unchanged)\n", rssKB())

	// Force OS release.
	// "FreeOSMemory forces a garbage collection followed by an attempt
	//  to return as much memory to the operating system as possible.
	//  Use sparingly — it stops the world and is expensive."
	debug.FreeOSMemory()
	fmt.Printf("after FreeOSMemory: RSS=%d KB\n", rssKB())
}
```

Expected output (Linux):

```
startup: RSS=2500 KB
after alloc: RSS=207000 KB
after GC: RSS=207000 KB
after FreeOSMemory: RSS=12000 KB
```

The senior policy: don't call `FreeOSMemory` from request handlers — its STW component is real and serialises every goroutine. Call it from explicit lifecycle hooks: after large batch jobs, before going idle for a long time, when receiving a SIGUSR1. In production with `GOMEMLIMIT` set, you almost never need this — the runtime targets memory continuously.

</details>

**Extension.** Wrap the program with `cgroup` memory limit and observe how the OOM-killer triggers without `FreeOSMemory` but is dodged with it. Reproduces the Kubernetes memory-pressure pattern.

---

### Task 15: Tiny allocator vs small-class allocator benchmark

**Goal.** Construct a benchmark comparing the tiny allocator (objects <16 B, no pointers) against the regular small-class allocator.

**Difficulty.** Senior.

**Skills.** Tiny allocator semantics, `runtime/malloc.go`, `noscan` types.

**Steps.**

1. Read `mallocgc` in `runtime/malloc.go`, specifically the `if size < maxTinySize` branch and the explanation of why tiny allocs pack multiple small objects into a single 16-byte block.
2. Write `BenchmarkTiny` allocating millions of `*int8` (1 byte, noscan).
3. Write `BenchmarkSmallNoScan` allocating millions of `*[16]byte` (16 bytes, noscan).
4. Write `BenchmarkSmallScan` allocating millions of `*struct{ p *int }` (16 bytes, scan).
5. Compare `B/op` and `ns/op` — the tiny allocator should pack 16 `*int8` per 16-byte block.

**Acceptance criteria.**

- `BenchmarkTiny` reports B/op << 16 (typically 1–2 B/op effective; the runtime amortises).
- `BenchmarkSmallNoScan` reports 16 B/op.
- `BenchmarkSmallScan` reports 16 B/op AND noticeably more GC pause time across runs.
- Comment explains "tiny allocator: bumps a 16-byte offset; new block only when full".

<details><summary>Hint</summary>

The tiny allocator path in `runtime/malloc.go` is: if `size < 16` and the type has no pointers (`noscan`), use the per-P `mcache.tiny` buffer. The mcache holds a 16-byte block and a bump offset; objects of size 1, 2, 4, 8 are packed in. Once full, a fresh 16-byte block is taken from size class 2. This is why `make([]byte, 4)` rarely shows up in alloc profiles by bytes — they're amortised.

</details>

<details><summary>Reference solution</summary>

```go
package tinybench

import "testing"

type Big16 [16]byte
type Ptr16 struct{ P *int }

func BenchmarkTiny(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		x := new(int8) // 1 byte, noscan -> tiny allocator
		*x = int8(i)
		_ = x
	}
}

func BenchmarkSmallNoScan(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		x := new(Big16) // 16 bytes, noscan -> size class 2
		x[0] = byte(i)
		_ = x
	}
}

func BenchmarkSmallScan(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		x := &Ptr16{} // 16 bytes, HAS a pointer -> size class 2, scan
		_ = x
	}
}
```

Typical output:

```
BenchmarkTiny          ... 8 ns/op   2 B/op  1 allocs/op   (amortised; tiny packs 8x int8 per 16-byte block in practice)
BenchmarkSmallNoScan   ... 9 ns/op  16 B/op  1 allocs/op
BenchmarkSmallScan     ... 9 ns/op  16 B/op  1 allocs/op   (allocs equal, but GC cost differs across runs)
```

The senior internalisation: the tiny allocator is a per-P bump allocator that exists ONLY for noscan objects < 16 bytes. It's why allocating millions of small ints, runes, or byte counters is much cheaper than the per-object 16-byte rounding suggests. Add a single pointer field and the type becomes scan, falling back to the regular size-class path — and the amortisation disappears.

</details>

**Extension.** Add a benchmark allocating `*int` (8 bytes, scan because Go internals treat scalar size as a hint but pointer types are always scan). Compare with `*int8`. The scan/noscan distinction matters more than the size.

---

### Task 16: Large-object allocation (>32 KiB) benchmark

**Goal.** Benchmark allocations larger than `_MaxSmallSize` (32 KiB) which take the large-object path: straight to mheap.

**Difficulty.** Senior.

**Skills.** mheap, large-object lifecycle, `runtime.MemStats.HeapInuse`.

**Steps.**

1. Write `BenchmarkLarge64KiB` allocating one `make([]byte, 65536)` per iteration.
2. Read `largeAlloc` in `runtime/malloc.go`. Note that large allocs bypass mcache entirely — every call goes through `mheap.alloc` under the heap lock.
3. Compare against `BenchmarkLarge8KiB` (one page, still small-class) and `BenchmarkLarge128KiB`.
4. Observe whether `ns/op` scales linearly with size.

**Acceptance criteria.**

- All three benchmarks measured; B/op equals object size in each.
- ns/op shows the large path is significantly higher latency per byte than the small path (mheap lock + page allocation).
- Comment explains "large alloc bypasses mcache/mcentral, locks mheap, takes pages from the page allocator directly".

<details><summary>Hint</summary>

Anything `> _MaxSmallSize` (32 KiB) goes through `largeAlloc` -> `mheap_.alloc` -> `pageAlloc.alloc`. The heap is single-locked at the top. mcache short-circuits this for small allocs — every P has its own — but for large allocs, every goroutine contends. In a multi-tenant service that allocates large objects (image decoders, JSON payloads), this lock is the bottleneck.

</details>

<details><summary>Reference solution</summary>

```go
package largebench

import "testing"

func BenchmarkLarge8KiB(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		x := make([]byte, 8192)
		x[0] = byte(i)
		_ = x
	}
}

func BenchmarkLarge64KiB(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		x := make([]byte, 65536)
		x[0] = byte(i)
		_ = x
	}
}

func BenchmarkLarge128KiB(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		x := make([]byte, 131072)
		x[0] = byte(i)
		_ = x
	}
}
```

Typical results:

```
BenchmarkLarge8KiB    ...   500 ns/op    8192 B/op  1 allocs/op
BenchmarkLarge64KiB   ...  4500 ns/op   65536 B/op  1 allocs/op
BenchmarkLarge128KiB  ... 11000 ns/op  131072 B/op  1 allocs/op
```

The slope (~70 ns/KiB) reflects: mheap lock acquisition (~50 ns under contention), page allocator search through the radix tree (~10 ns), and the page-zeroing pass that the runtime performs on first-use (~5 ns/KiB). Read `mheap.alloc_m` in `runtime/mheap.go`.

The senior optimisation: for fixed-size large buffers, `sync.Pool` is a huge win because it skips both the mheap lock and the page-zeroing. For variable-size large buffers, consider preallocating one larger buffer and slicing it. Both move the lock out of the hot path.

</details>

**Extension.** Run `BenchmarkLarge64KiB` with `GOMAXPROCS=16` and observe contention. Use `go tool trace` to see goroutines waiting on the mheap lock.

---

### Task 17: Track a single allocation with `MemProfileRate=1`

**Goal.** Set `runtime.MemProfileRate = 1` and `runtime/pprof.Lookup("heap")` to capture every allocation, then identify one specific allocation by stack.

**Difficulty.** Senior.

**Skills.** `runtime.MemProfileRate`, `runtime/pprof.Lookup`, sampled-vs-exhaustive profiling.

**Steps.**

1. At program start, set `runtime.MemProfileRate = 1` (default is 512 KiB — sampled).
2. Allocate exactly one 1024-byte slice from a function named `mySpecificAllocSite`.
3. Capture: `pprof.Lookup("heap").WriteTo(f, 0)`.
4. Run `go tool pprof prof.out` and `list mySpecificAllocSite`.
5. Verify the single allocation is visible.

**Acceptance criteria.**

- Profile contains the precise call site with non-zero `flat` bytes.
- Comment explains "MemProfileRate=1 = sample every allocation; default 524288 samples ~1-in-512KiB; setting to 1 has 10-30% overhead and is for debugging not prod".

<details><summary>Hint</summary>

`runtime.MemProfileRate` is the sampling cadence in bytes between recorded allocations. With the default 512 KiB, small allocations are unlikely to appear at all. Setting it to 1 records every alloc — useful when chasing "why was this object created" but unacceptable in production. The setting must be applied *before* any allocation you want recorded.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"log"
	"os"
	"runtime"
	"runtime/pprof"
)

func mySpecificAllocSite() []byte {
	return make([]byte, 1024)
}

func main() {
	runtime.MemProfileRate = 1 // record every allocation
	defer func() { runtime.MemProfileRate = 524288 }()

	x := mySpecificAllocSite()
	_ = x

	f, err := os.Create("heap.prof")
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()

	runtime.GC() // ensure profile is up to date
	if err := pprof.Lookup("heap").WriteTo(f, 0); err != nil {
		log.Fatal(err)
	}
}
```

Inspect:

```
$ go tool pprof heap.prof
(pprof) list mySpecificAllocSite
Total: 1.00kB
ROUTINE ===== main.mySpecificAllocSite in main.go
    1.00kB  1.00kB (flat, cum) 100% of Total
       .       .   8:func mySpecificAllocSite() []byte {
    1.00kB  1.00kB   9:    return make([]byte, 1024)
       .       .   10:}
```

The single 1 KiB allocation is visible because we set `MemProfileRate = 1` BEFORE allocating. If you toggle it after the alloc, no record exists — sampling decisions are made at the call site, not retroactively.

Production note: leave `MemProfileRate` at default in production. The 1-in-512 KiB sample is statistically excellent for finding hot sites; setting it to 1 adds bookkeeping to every `mallocgc` call. Use `MemProfileRate=1` only locally, scoped to a single bug-hunt.

</details>

**Extension.** Compare profile sizes: same program with `MemProfileRate=1` vs default. The exhaustive profile can be 100x larger.

---

### Task 18: Read `runtime/mpagealloc.go` — summarise the radix tree

**Goal.** Read `runtime/mpagealloc.go` and summarise the `pageAlloc` radix tree: structure, depth, why it exists.

**Difficulty.** Staff.

**Skills.** Reading dense runtime code, understanding hierarchical bitmap data structures.

**Steps.**

1. Open `runtime/mpagealloc.go`. Skim the top-of-file comment block.
2. Find `pageAlloc` struct definition; identify `summary`, `chunks`, `searchAddr`.
3. Understand the 5-level summary tree: each summary entry summarises 8 children below.
4. Write a paragraph: what does the radix tree store? Why isn't a flat bitmap enough?
5. Identify the function `(pageAlloc).find` — how does it search?

**Acceptance criteria.**

- A 4-6 paragraph summary in a comment file (no code needed).
- Identifies: depth (5 levels), chunk size (4 MiB), per-summary "max contiguous free pages" hint.
- Explains why the tree exists: O(log N) search for a run of N free pages instead of O(heap-size) bitmap scan.

<details><summary>Hint</summary>

The radix tree is keyed by "address". Each leaf summarises a `pallocChunk` (4 MiB = 512 pages). Each higher level summarises 8 children below (so depth-1 = 32 MiB, depth-2 = 256 MiB, etc.). A summary entry records `(start, max, end)` — the run of free pages at the start, in the middle, and at the end of the region. Finding a run of N pages is then "descend the tree, pruning subtrees whose max < N".

</details>

<details><summary>Reference solution</summary>

```go
// notes_pagealloc.md (in code as a Go comment for the task)
//
// runtime/mpagealloc.go — pageAlloc radix tree
// ==============================================
//
// What it stores. Tracks which 8-KiB pages of the heap are free vs in
// use. Lives on top of mheap; small/large object allocations both end
// up asking pageAlloc for N contiguous pages.
//
// Why not a flat bitmap? A flat bitmap (one bit per page) requires
// scanning O(heap-size) bits to find a run of N free pages. For a 100
// GiB heap that's 1.6 GB of bitmap and a multi-millisecond scan per
// alloc. Unacceptable for the inner allocator loop. The radix tree
// short-circuits subtrees that cannot satisfy N.
//
// Structure. Up to 5 levels of summaries. Each leaf is a pallocChunk
// (4 MiB = 512 pages). Each summary entry above leaves contains:
//   start: contiguous free pages at the START of the region
//   max:   longest contiguous free run ANYWHERE in the region
//   end:   contiguous free pages at the END of the region
// Combining children is associative: parent.max = max(child[0].end +
// child[1].start, max(child[i].max for i in children), ...).
//
// On 64-bit Linux, the maximum heap is 4 PiB. Five levels are enough
// to cover this: 4 MiB * 8^5 = 4 MiB * 32768 = 128 GiB per top-level
// entry; 8 top-level entries = 1 TiB; further extension via "heap
// arenas". See arenaL1Bits and arenaL2Bits in malloc.go.
//
// (pageAlloc).find(npages). Descends from the top. At each level,
// picks the leftmost child whose summary indicates a free run of
// >= npages. Recurses. At the leaf (chunk), does a bitmap scan over
// 512 bits. The descent prunes >99% of the heap on a typical lookup.
//
// scavenger interaction. The same radix tree carries "scavenged"
// state — pages that are free AND have been released to the OS via
// madvise. The scavenger uses the tree to find runs of in-heap-but-
// not-released pages, then madvise's them. The tree is the single
// source of truth for both allocation and scavenging.
//
// Senior takeaway. The page allocator went from a free-list of mspans
// (pre-1.14) to this radix tree because GC mark-termination is
// dominated by the time to scan free lists; the tree is essentially
// a B+ tree of free-page runs that supports both lookup and update
// in O(log N) where N is heap-page-count. Read commits 7fb5fe4
// (Go 1.14) for the rationale.
```

The point of the task isn't to memorise the tree — it's to learn that the allocator is *not* a flat bitmap or a free-list. When colleagues say "the page allocator", they mean this 5-level summarised structure, and questions about allocator performance ("why does my 10 GiB heap allocate fast?") have their answer here.

</details>

**Extension.** Run `pprof` against `runtime.(*pageAlloc).find` in a CPU profile of an allocation-heavy program. Notice the depth-first descent in the flame graph.

---

### Task 19: Per-package allocation tracker

**Goal.** Build a custom allocation tracker that counts allocations per package by sampling `runtime.MemProfile` records and grouping by call-site package.

**Difficulty.** Staff.

**Skills.** `runtime.MemProfile`, `runtime.FuncForPC`, package-path parsing.

**Steps.**

1. Call `runtime.MemProfile(records, true)` to fetch the in-process memory profile.
2. For each record, walk `record.Stack()` from the top frame.
3. Use `runtime.FuncForPC(pc).Name()` to get qualified function names.
4. Extract the package path (everything before the last `.`).
5. Aggregate `AllocBytes`/`AllocObjects` per package into a `map[string]struct{Bytes, Objects int64}`.
6. Print top 10 packages by `AllocBytes`.

**Acceptance criteria.**

- Tracker prints a per-package breakdown.
- Self-test: allocate from three different packages and verify they appear distinctly.
- Comment explains "MemProfile is sampled; numbers are estimates not exact counts".

<details><summary>Hint</summary>

`runtime.MemProfile` writes into a slice of `runtime.MemProfileRecord`. Each record has `AllocBytes`, `AllocObjects`, `FreeBytes`, `FreeObjects`, and a `Stack []uintptr`. Live = Alloc - Free. The function name format is `pkg/path.FuncName` — strip from the last `.` to get the package path. For methods, the format is `pkg/path.(*Type).Method` — same strip-from-last-`.` trick works after balancing parentheses.

</details>

<details><summary>Reference solution</summary>

```go
package alloctracker

import (
	"fmt"
	"io"
	"runtime"
	"sort"
	"strings"
)

type PackageStats struct {
	AllocBytes   int64
	AllocObjects int64
	InUseBytes   int64
	InUseObjects int64
}

// Snapshot walks the runtime's memory profile and groups by package
// of the top-of-stack frame.
func Snapshot() map[string]*PackageStats {
	// Fetch records. Loop until the buffer is large enough.
	var records []runtime.MemProfileRecord
	for {
		n, ok := runtime.MemProfile(records, true)
		if ok {
			records = records[:n]
			break
		}
		records = make([]runtime.MemProfileRecord, n+50)
	}

	out := map[string]*PackageStats{}
	for _, r := range records {
		pkg := packageOfStack(r.Stack())
		if pkg == "" {
			pkg = "<unknown>"
		}
		s := out[pkg]
		if s == nil {
			s = &PackageStats{}
			out[pkg] = s
		}
		s.AllocBytes += r.AllocBytes
		s.AllocObjects += r.AllocObjects
		s.InUseBytes += r.InUseBytes()
		s.InUseObjects += r.InUseObjects()
	}
	return out
}

func packageOfStack(stack []uintptr) string {
	for _, pc := range stack {
		f := runtime.FuncForPC(pc)
		if f == nil {
			continue
		}
		name := f.Name()
		// Skip runtime frames so we attribute to user code.
		if strings.HasPrefix(name, "runtime.") {
			continue
		}
		return packageOf(name)
	}
	return ""
}

func packageOf(funcName string) string {
	// "pkg/path.FuncName"        -> "pkg/path"
	// "pkg/path.(*Type).Method"  -> "pkg/path"
	// Find the last '/'; from there, look for the first '.'.
	slash := strings.LastIndex(funcName, "/")
	dot := strings.Index(funcName[slash+1:], ".")
	if dot < 0 {
		return funcName
	}
	return funcName[:slash+1+dot]
}

func PrintTop(w io.Writer, n int) {
	stats := Snapshot()
	type row struct {
		pkg string
		s   *PackageStats
	}
	rows := make([]row, 0, len(stats))
	for k, v := range stats {
		rows = append(rows, row{k, v})
	}
	sort.Slice(rows, func(i, j int) bool {
		return rows[i].s.AllocBytes > rows[j].s.AllocBytes
	})
	if n > len(rows) {
		n = len(rows)
	}
	fmt.Fprintf(w, "%-40s %15s %15s\n", "PACKAGE", "ALLOC_BYTES", "INUSE_BYTES")
	for _, r := range rows[:n] {
		fmt.Fprintf(w, "%-40s %15d %15d\n",
			r.pkg, r.s.AllocBytes, r.s.InUseBytes)
	}
	// MemProfile is SAMPLED at runtime.MemProfileRate (default 512 KiB).
	// Numbers are statistical estimates, not exact counts. Set
	// runtime.MemProfileRate = 1 for exhaustive recording (high cost).
}
```

Caveats baked into the implementation: (a) we attribute to the *top* user frame, not the leaf; some pkgs (encoding/json) allocate through helpers in subpackages — depending on what you want, walking deeper or shallower matters. (b) Inlined functions report the outer caller's PC, so inlined small helpers don't get their own row. (c) The sample rate determines accuracy — at default, a package with 100 small allocs may not appear at all.

Production use: this lives behind a `/debug/allocs/by-package` endpoint. Operators load it when investigating "which library is leaking" without needing the full pprof toolchain.

</details>

**Extension.** Group by the *second*-to-leaf frame (the caller's caller). For libraries like `encoding/json` this often reveals "which of *my* packages is feeding json.Marshal the most data".

---

### Task 20: "RSS grows but Heap is flat" — diagnose with scavtrace

**Goal.** Reproduce the pathological case where process RSS grows over time but `HeapAlloc` stays flat. Diagnose using `GODEBUG=scavtrace=1`.

**Difficulty.** Staff.

**Skills.** Scavenger lifecycle, fragmentation, `madvise(MADV_DONTNEED)` vs returning to the runtime.

**Steps.**

1. Write a program that, in a loop forever, does: (a) allocates 50 MB of small objects scattered across many goroutines, (b) drops all of them, (c) sleeps 100 ms.
2. Run under `GODEBUG=scavtrace=1`. Capture scavtrace lines.
3. Measure RSS every 5 seconds for 2 minutes.
4. Observe: `HeapAlloc` returns to baseline after each drop, but RSS climbs slowly.
5. Explain the cause — *fragmentation*. Pages with even one live object cannot be released; over time, "holes" accumulate.

**Acceptance criteria.**

- RSS climbs across measurements while HeapAlloc oscillates around a low baseline.
- Scavtrace output captured and a comment interprets each field.
- Diagnosis: each allocation cycle leaves *some* pages with at least one survivor (Go GC + scheduling timing), preventing those pages from being scavenged.
- Mitigation suggested: `debug.FreeOSMemory()` periodic call, or `GOMEMLIMIT` to cap total RSS, or restructuring to allocate from a `sync.Pool` of large buffers.

<details><summary>Hint</summary>

The scavenger can only release a *page* (8 KiB) once *all* objects on that page are free. If even one survivor pins a page, the whole page stays resident. With small objects spread across many goroutines, the random survivor pattern leaves many pages with one-or-two live objects each — those pages are wasted. This is the classic "heap fragmentation" pathology, common in services with high allocation churn and concurrent allocators.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

func rssKB() int {
	f, err := os.Open("/proc/self/status")
	if err != nil {
		return -1
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "VmRSS:") {
			fs := strings.Fields(line)
			n, _ := strconv.Atoi(fs[1])
			return n
		}
	}
	return -1
}

type Small struct{ A, B int }

// keep is a global retention list that catches a small random fraction
// of allocations in each cycle. This emulates the realistic case where
// "some pointers survive" — caches, work queues, recently-completed
// records still being logged, etc.
var (
	keepMu sync.Mutex
	keep   []*Small
)

func cycle() {
	const N = 50_000
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			local := make([]*Small, N)
			for i := range local {
				local[i] = &Small{A: g, B: i}
			}
			// Pin ~0.1% of objects randomly via the global keep slice.
			// In production this models "incidental retention".
			keepMu.Lock()
			for i := 0; i < N; i += 1000 {
				keep = append(keep, local[i])
			}
			if len(keep) > 5_000 {
				keep = keep[2_500:] // trim, but not all the way
			}
			keepMu.Unlock()
			runtime.KeepAlive(local)
		}(g)
	}
	wg.Wait()
	runtime.GC()
}

func main() {
	fmt.Printf("pid=%d\n", os.Getpid())
	go func() {
		for {
			cycle()
			time.Sleep(100 * time.Millisecond)
		}
	}()

	var m runtime.MemStats
	for t := 0; t < 24; t++ {
		runtime.ReadMemStats(&m)
		fmt.Printf("t=%3ds  HeapAlloc=%6d KB  HeapInuse=%6d KB  RSS=%6d KB  NumGC=%d\n",
			t*5, m.HeapAlloc/1024, m.HeapInuse/1024, rssKB(), m.NumGC)
		time.Sleep(5 * time.Second)
	}
}
```

Expected output (Linux):

```
pid=12345
t=  0s  HeapAlloc=  1500 KB  HeapInuse=  3000 KB  RSS=  20000 KB  NumGC=4
t=  5s  HeapAlloc=  1800 KB  HeapInuse=  9000 KB  RSS=  45000 KB  NumGC=22
t= 10s  HeapAlloc=  1900 KB  HeapInuse= 14000 KB  RSS=  68000 KB  NumGC=45
t= 30s  HeapAlloc=  2100 KB  HeapInuse= 28000 KB  RSS= 140000 KB  NumGC=120
t= 60s  HeapAlloc=  2300 KB  HeapInuse= 52000 KB  RSS= 280000 KB  NumGC=240
t=120s  HeapAlloc=  2500 KB  HeapInuse= 88000 KB  RSS= 460000 KB  NumGC=470
```

With `GODEBUG=scavtrace=1` you'll see lines like:

```
scav 32 KiB work (32 KiB in 0 ms; 4% util), 128 MiB total, 88% util
```

`util` = percentage of heap that's actually backing live objects. Healthy: high `util`. Fragmented: low `util` despite low `HeapAlloc`. In the example above, `HeapAlloc` is 2.5 MiB but `HeapInuse` is 88 MiB and RSS is 460 MiB — the gap is fragmentation.

Diagnosis:

```
// HeapAlloc stays around 2 MiB — the program does NOT leak in the
// language sense. Each cycle drops 99.9% of its allocations and GC
// reclaims them. But because each cycle pins ~50 random objects in
// `keep`, those objects are scattered across hundreds of mspans. A
// page (8 KiB) holding even one live object cannot be returned to
// the OS. Over time, ever more pages become "lightly populated" and
// stick around.
//
// RSS climb = fragmentation, NOT leak.
//
// Mitigations (in order of impact):
//   1. Allocate the long-lived `keep` set from a separate arena
//      (one big preallocated []Small) so retained objects are
//      densely packed. Frees fragmentation immediately.
//   2. Set GOMEMLIMIT to cap RSS; the scavenger becomes aggressive.
//   3. Periodic debug.FreeOSMemory() during quiet windows.
//   4. Restart-on-bloat policy (last resort; trades availability).
//
// What is NOT a fix:
//   - sync.Pool by itself — Pool entries also get scattered.
//   - GOGC = lower — triggers more GCs but does not address packing.
//   - Calling runtime.GC() in a tight loop — same as above.
```

The senior diagnostic: when you see RSS climb with flat HeapAlloc and flat *application* error rates, it's fragmentation 90% of the time. The two test inputs are (a) `HeapInuse - HeapAlloc` is large and growing (fragmentation signal), and (b) scavtrace reports low `util`. Once confirmed, the mitigation is structural — denser packing of long-lived data — not a runtime knob.

</details>

**Extension.** Replace the random-retention pattern with a `sync.Pool` of preallocated large arenas, where short-lived objects are sliced off the arena and dropped together. Re-run and verify RSS no longer climbs.

---

## Self-grading rubric

Score each task `0` (skipped), `1` (got it with hints), `2` (got it unaided), `3` (got it AND can predict the behaviour of a similar task before running it). Sum:

| Score | What it means |
|-------|---------------|
| 0–20  | You've seen `runtime.MemStats` and `-benchmem` once. Re-read junior.md and middle.md; redo Tasks 1–8. The mental model of "size classes -> mcache -> mcentral -> mheap" must be reflex before deeper work. |
| 21–35 | You can run the allocator's diagnostics and predict the small-object path. Tasks 9–14 cement escape analysis, the scavenger, and `pprof`. The "RSS vs HeapAlloc" distinction in Task 13/14 is the single most common production confusion — confirm you've internalised it. |
| 36–48 | Senior level. You distinguish tiny vs small vs large allocations and can read a `-alloc_space` profile critically. Tasks 15–17 push you into the runtime source — start using it as documentation, not folklore. |
| 49–60 | Staff level. Tasks 18–20 require holding the radix tree and the fragmentation pathology in your head simultaneously. If Task 20's diagnosis didn't feel familiar, you haven't lived through it yet — ask any operator of a long-running Go service for war stories. |

The most important question is not *did you finish* — it is *can you predict, for any new allocation pattern, which path through the allocator it takes and what its long-term RSS curve will look like?* "This is a 24-byte struct with a pointer — size class 4, scan." "This is a 50 KiB buffer — large path, mheap lock, candidate for sync.Pool." "This is a hot []byte returning from a hot function — escape analysis will keep it on the stack unless the result interface-converts." If those come reflexively, you understand the allocator. If not, the rest is plumbing.

Concrete checks worth running before declaring done:

- `go test -bench=. -benchmem` clean on every numerical claim — predict, then verify, then explain any 10%+ delta.
- For escape analysis tasks (2, 3, 10): always rebuild with `-gcflags="-m=2"` and read the *justification*, not just the verdict. Compiler decisions change between Go versions.
- For pprof tasks (11, 12, 17): cross-check `-alloc_space` against `-alloc_objects`. Top-N divergence between them is the diagnostic, not either one alone.
- For scavenger tasks (13, 14, 20): always include RSS measurement, not just `MemStats`. The whole point is that they disagree.
- For Task 19 (per-package tracker): exercise from three packages and verify isolation; without that smoke test, name-parsing bugs will silently merge unrelated callers.

---

## Stretch challenges

**S1 — Cross-version allocator regression detector.** Build a CI tool that runs a benchmark suite under Go 1.21, 1.22, 1.23 and reports allocator-related regressions per benchmark. Constraint: detect changes in `B/op`, `allocs/op`, AND new `flat` lines in `pprof -alloc_objects` between versions. The hard part is identifying *which* allocations are version-sensitive (escape analysis changes between minor versions affect specific patterns). Output: a Markdown table per affected package, showing baseline vs current numbers and the specific functions whose escape decisions changed. Bonus: integrate with `go test -bench=.` JSON output (`go test -bench=. -count=10 -benchtime=2s -json | tee bench.json`).

**S2 — Live fragmentation observer.** Build an HTTP endpoint that exposes the *current* heap fragmentation ratio: `HeapInuse / HeapAlloc` plus the per-size-class breakdown of "spans with one live object" (the fragmentation indicator). Pull data from `runtime.ReadMemStats` and `runtime/metrics` (the new structured metrics API). Constraint: < 1 ms p99 to respond, because the endpoint will be scraped by Prometheus every 15 seconds. The hard part is that `runtime.MemStats` is *not* cheap (it stops the world briefly) — you need to cache, choose the right sample window, and decide which metrics are actually fragmentation-sensitive (`HeapInuse - HeapAlloc`) versus which are noise.

**S3 — Arena-backed object pool with safe lifetimes.** Implement a typed arena allocator (similar to the experimental `arena` package but production-safe) that grants `N` instances of `T` from a preallocated chunk, tracks per-arena reference counts, and recycles the entire chunk when the count hits zero. Constraints: (a) the arena must work for types containing pointers — the chunk's pages must be scanned by the GC for the duration of any live reference, but freed atomically when no references remain. (b) Misuse (using an instance after the arena is freed) must be detectable in `-race` mode via explicit `runtime.SetFinalizer`-based instrumentation. (c) The benchmark `BenchmarkArenaVsHeap` must show 2-5x throughput improvement vs equivalent `new(T)` for hot workloads. Worth understanding before attempting: read the design doc for `golang.org/x/exp/arena` and the criticism of it (lifetime safety is the hard problem, not the speedup).
