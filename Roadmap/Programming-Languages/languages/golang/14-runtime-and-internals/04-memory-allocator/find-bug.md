# Memory Allocator — Find the Bug

## 1. How to use this file

Eighteen buggy Go programs about how the runtime allocator behaves: escape analysis surprising you, slices pinning huge backing arrays, conversions copying on every call, `sync.Pool` extending lifetimes, deferred records bloating hot loops, `time.NewTicker` quietly leaking memory plus a goroutine. Read each in 30-60 seconds, decide what the allocator is actually doing, then expand `<details>` for the diagnosis.

Allocator bugs almost never crash. They show up as RSS that climbs and never drops, `runtime.MemStats.HeapAlloc` that's 10x what you predicted, GC pauses that get longer release-by-release, or `pprof` flame graphs where `runtime.mallocgc` is the hottest frame in a "pure compute" function. Three questions per snippet:

1. *Where does the value live — stack, heap, pool, mmap'd arena — and who decided?*
2. *What pins the allocation alive past the moment the program looks "done" with it?*
3. *How many allocations does this code path do per call, and is that the count you'd guess by reading it?*

Diagnoses reference `runtime/malloc.go`, `runtime/mbitmap.go`, `runtime/mheap.go`, and `runtime/mgc.go` where the answer is in the runtime source.

---

### Bug 1: Slice of small range pinning a huge backing array

**Difficulty:** Middle
**Skills:** escape analysis, slice headers, GC roots

```go
package main

import (
	"fmt"
	"os"
	"runtime"
)

// Header keeps only the first 64 bytes of the file but the rest is unreachable... right?
func Header(path string) ([]byte, error) {
	data, err := os.ReadFile(path) // file is 200 MiB
	if err != nil {
		return nil, err
	}
	return data[:64], nil
}

func main() {
	hdrs := make([][]byte, 0, 100)
	for i := 0; i < 100; i++ {
		h, _ := Header("big.bin")
		hdrs = append(hdrs, h)
	}
	var m runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&m)
	fmt.Printf("HeapAlloc=%d MiB\n", m.HeapAlloc>>20) // 20 GiB, not 6 KiB
	_ = hdrs
}
```

**Observed behavior:** Process RSS climbs to roughly file_size × iterations even though every retained slice has `len == 64`. `pprof -inuse_space` blames `os.ReadFile`.

<details><summary>Hint</summary>

A `[]byte` is a three-word header: `(ptr, len, cap)`. Slicing changes `len` and `cap` — does it change `ptr`?

</details>

**Diagnosis:** `data[:64]` returns a slice whose `ptr` still points into the original 200 MiB backing array. As long as `hdrs` holds even one byte of that array, the GC mark phase (`runtime/mgc.go`, `scanobject`) finds the pointer and marks the whole span as live. `runtime/malloc.go` allocates spans from `mheap`; the allocator can't return part of a span — it's all-or-nothing. The 64-byte slice pins the entire 200 MiB span.

**Fix:** Copy out, then let the original go.

```go
out := make([]byte, 64)
copy(out, data) // new backing array, sized exactly
return out, nil
```

Or use `bytes.Clone(data[:64])` on Go 1.20+. The general rule: when you keep a small slice from a large source longer than the source's natural lifetime, copy it.

---

### Bug 2: `bytes.Buffer.Bytes()` retaining full capacity

**Difficulty:** Middle
**Skills:** `bytes.Buffer` internals, slice aliasing

```go
package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"os"
)

// Decompress reads ~500 KiB compressed, expands to ~50 MiB, hands back the result.
func Decompress(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if _, err := io.Copy(&buf, gz); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func main() {
	results := make([][]byte, 0, 50)
	for i := 0; i < 50; i++ {
		b, _ := Decompress("data.gz")
		results = append(results, b[:4096]) // we only keep the header
	}
	_ = results
}
```

**Observed behavior:** Memory usage is ~50 × 50 MiB instead of ~50 × 4 KiB. `pprof` blames `bytes.(*Buffer).grow`.

<details><summary>Hint</summary>

Two compounding problems: what does `bytes.Buffer.Bytes()` return, and what does `b[:4096]` do to it?

</details>

**Diagnosis:** `bytes.Buffer.Bytes()` returns the buffer's internal `buf` slice — its capacity equals the largest size the buffer ever grew to (~50 MiB after gzip expansion). Then `b[:4096]` re-slices that, keeping `cap == ~50 MiB`. Both `len` and `cap` matter for retention: `runtime/mbitmap.go`'s scanner walks pointers based on the underlying span, not on `len`. The 4 KiB slice pins the full ~50 MiB span just like Bug 1.

**Fix:** Three-index slice does *not* help here (`b[:4096:4096]` still points at the same backing array). Only `copy` into a fresh allocation releases the source:

```go
small := make([]byte, 4096)
copy(small, b)
results = append(results, small)
```

---

### Bug 3: Closure capture forcing escape in a hot loop

**Difficulty:** Middle
**Skills:** escape analysis, closure capture, `go build -gcflags=-m`

```go
package main

import "sync"

type Counter struct{ n int64 }

// Tally runs work on each item; the per-iteration closure should be stack-allocated.
func Tally(items []int, wg *sync.WaitGroup) *Counter {
	c := &Counter{}
	for _, x := range items {
		x := x
		wg.Add(1)
		go func() {
			defer wg.Done()
			if x > 0 {
				c.n++ // race aside, we're measuring allocation
			}
		}()
	}
	return c
}
```

**Observed behavior:** `go build -gcflags='-m=2'` reports `func literal escapes to heap` and `&Counter{} escapes to heap`. `pprof -alloc_objects` shows millions of tiny allocations.

<details><summary>Hint</summary>

`go` (spawning a goroutine) forces *something* to live longer than the spawning stack frame. What exactly?

</details>

**Diagnosis:** Three escapes per iteration. (1) The closure itself escapes because `go` makes its lifetime exceed the loop iteration; the compiler emits `runtime.newproc` with a heap-allocated funcval. (2) The captured `x` is in the closure's environment — heap. (3) `c` was already heap-allocated because `Tally` returns it. Escape analysis (`cmd/compile/internal/escape`) sees the goroutine boundary and refuses to stack-allocate anything that crosses it.

**Fix:** Pass values as goroutine arguments (which copy onto the spawned goroutine's stack), don't capture them:

```go
go func(x int) {
	defer wg.Done()
	// work...
}(x)
```

Even better, batch — one goroutine per CPU, processing slices. The general rule: `go func(){}()` capturing locals turns those locals into heap allocations.

---

### Bug 4: `fmt.Sprintf` boxing arguments via `interface{}`

**Difficulty:** Middle
**Skills:** interface boxing, `fmt` allocations

```go
package main

import (
	"fmt"
	"log"
)

// LogPacket runs in the hot path: ~50k qps.
func LogPacket(srcIP string, port int, size int) {
	msg := fmt.Sprintf("packet from %s:%d size=%d", srcIP, port, size)
	log.Println(msg)
}
```

**Observed behavior:** `pprof -alloc_objects` shows `fmt.Sprintf` allocating ~5 objects per call. `runtime.convT64` and `runtime.convTstring` near the top.

<details><summary>Hint</summary>

`Sprintf(format string, args ...interface{})`. What does it take to put an `int` into an `interface{}`?

</details>

**Diagnosis:** Variadic `...interface{}` boxes each non-pointer argument. `int` doesn't fit inline in an interface header (after the type word), so `runtime.convT64` (`runtime/iface.go`) allocates an 8-byte cell on the heap and the interface value points at it. Same for `convTstring`. With three args you get three allocations *before* `fmt`'s buffer pool, format-state, and result string are even considered. Per call: three boxings plus a `[]byte` plus a string copy.

**Fix:** Use a structured logger that takes typed key/value pairs (`slog`, `zap`, `zerolog`), or build the string manually for the truly hot path:

```go
// zerolog-style: no boxing, no Sprintf
log.Info().Str("src", srcIP).Int("port", port).Int("size", size).Msg("packet")
```

`go vet -gcflags='-m'` won't catch this — it's runtime boxing, not escape. `pprof -alloc_objects` does.

---

### Bug 5: Returning pointer to a local — looks stack-friendly, isn't

**Difficulty:** Junior
**Skills:** escape analysis, stack vs heap

```go
package main

type Point struct{ X, Y float64 }

// NewPoint "looks" stack-safe: local struct, returned by pointer.
func NewPoint(x, y float64) *Point {
	p := Point{X: x, Y: y}
	return &p
}

func main() {
	for i := 0; i < 10_000_000; i++ {
		_ = NewPoint(float64(i), 0)
	}
}
```

**Observed behavior:** Ten million heap allocations. GC runs constantly. `go build -gcflags='-m'` says `moved to heap: p`.

<details><summary>Hint</summary>

The local `p` lives in the stack frame. The pointer returned outlives that frame. Where does Go put `p`?

</details>

**Diagnosis:** Escape analysis sees that `&p` is returned. Once the function returns, its stack frame is gone — the pointer would dangle. The compiler's only safe move is to allocate `p` on the heap (`cmd/compile/internal/escape/escape.go`, `flowAcrossFunc`). This is the canonical "address-taken and returned" escape; it doesn't matter how small `Point` is.

**Fix:** Return by value when the struct is small (under a cacheline or two):

```go
func NewPoint(x, y float64) Point { return Point{X: x, Y: y} }
```

For Go, pointer-everywhere is a Java/C# habit that costs allocations. Return values until profiling says otherwise.

---

### Bug 6: Map's allocator footprint never shrinks

**Difficulty:** Middle
**Skills:** `hmap` internals, GC of map buckets

```go
package main

import (
	"fmt"
	"runtime"
)

func main() {
	m := make(map[int][]byte)
	for i := 0; i < 1_000_000; i++ {
		m[i] = make([]byte, 256)
	}
	for k := range m {
		delete(m, k)
	}
	runtime.GC()
	var s runtime.MemStats
	runtime.ReadMemStats(&s)
	fmt.Printf("HeapAlloc=%d MiB, MapLen=%d\n", s.HeapAlloc>>20, len(m))
	// HeapAlloc still high; MapLen=0
}
```

**Observed behavior:** `len(m) == 0` but `HeapAlloc` stays in the hundreds of MiB. Repopulating the map doesn't allocate new buckets.

<details><summary>Hint</summary>

`delete` clears entries. Does it free *buckets*?

</details>

**Diagnosis:** `runtime/map.go` allocates bucket arrays (`bmap`) on growth and never returns them. `delete(m, k)` clears the cell and emptyness bit but the `[]bmap` backing array stays at peak size. The runtime has no shrink path for maps — the design assumes maps either continue to be used (capacity amortized) or are dropped wholesale. Until the map variable itself becomes unreachable, the buckets remain pinned.

**Fix:** Replace the map when it's been drained:

```go
m = make(map[int][]byte, expectedSize)
// the old hmap and all its buckets become collectable
```

For workloads that are "fill, drain, repeat", a slice plus an index or `sync.Pool` for values fits better. Long-lived maps with bounded but churning keys are the wrong shape.

---

### Bug 7: `sync.Pool` extending lifetimes of large structures

**Difficulty:** Senior
**Skills:** `sync.Pool` semantics, victim cache, escape

```go
package main

import (
	"bytes"
	"sync"
)

type Request struct {
	Body  *bytes.Buffer
	Trace []byte // sometimes 100 MiB for diagnostic dumps
}

var reqPool = sync.Pool{
	New: func() any { return &Request{Body: new(bytes.Buffer)} },
}

func Handle() {
	r := reqPool.Get().(*Request)
	defer reqPool.Put(r) // BUG: returns r including any Trace it accumulated
	r.Body.Reset()
	// ... fills r.Body, may set r.Trace ...
}
```

**Observed behavior:** RSS grows over hours despite a "stable" request rate. `pprof -inuse_space` shows hundreds of `Trace` slices pinned via `sync.Pool`.

<details><summary>Hint</summary>

`sync.Pool` lets you reuse the *container*. Does the container reset its fields between uses?

</details>

**Diagnosis:** `Put` returns the struct including any large `Trace` slice. The pool retains the struct across GC cycles (between cycles it sits in the local `Pool`, after one cycle it moves to the *victim cache* — `sync/pool.go` `poolCleanup`). The victim cache holds objects for one extra cycle before discard. Every pooled `Request` keeps its `Trace` alive — so a single rare large trace persists for many GC cycles through pool reuse.

**Fix:** Clear large fields before `Put`:

```go
defer func() {
	r.Body.Reset()
	r.Trace = nil // critical: drop the large slice's backing array
	reqPool.Put(r)
}()
```

General rule: `sync.Pool` stores *reusable* state. Anything that grew to "unusually large" should be reset to small (or nil) before `Put`. Otherwise the pool becomes a leak.

---

### Bug 8: Struct with rarely-nil pointer field paying scan cost

**Difficulty:** Senior
**Skills:** GC scanning, `runtime/mbitmap.go`, type bitmaps

```go
package main

import "time"

type Event struct {
	ID        uint64
	Timestamp int64
	Payload   []byte
	Context   *DebugContext // populated for ~1% of events
}

type DebugContext struct {
	Stack [128]uintptr
	Tags  map[string]string
}

func main() {
	events := make([]Event, 50_000_000)
	for i := range events {
		events[i].ID = uint64(i)
		events[i].Timestamp = time.Now().UnixNano()
		// Context left nil for 99% of events
	}
	for {
		time.Sleep(time.Second)
	}
}
```

**Observed behavior:** GC mark phase walks 50M structs; the scan cost is dominated by `Event.Payload` and `Event.Context` even though `Context` is almost always nil.

<details><summary>Hint</summary>

The GC needs a bitmap to know which words in a struct are pointers. Does "nil" save you from scanning?

</details>

**Diagnosis:** `runtime/mbitmap.go` stores a *type* bitmap (`gcdata`) per type: one bit per word, set if that word may hold a pointer. The mark phase reads the bitmap for `Event`, sees pointer slots at `Payload.Data` and `Context`, and follows them. The check is "is this word a pointer-typed slot?" not "is the pointer non-nil?". A nil pointer still costs a bitmap lookup and a nil-check; multiply by 50M and the mark pause is dominated by the rare field.

**Fix:** Move the rare path to a sidecar:

```go
type Event struct {
	ID        uint64
	Timestamp int64
	Payload   []byte
}
var debugByID = map[uint64]*DebugContext{}
```

For huge homogeneous arrays where almost no element has the optional field, an "exception map" beats a per-element pointer.

---

### Bug 9: Pre-allocating 1 GiB against `GOMEMLIMIT`

**Difficulty:** Middle
**Skills:** `GOMEMLIMIT`, `runtime/debug.SetMemoryLimit`, accounting

```go
package main

import "runtime/debug"

// "Reserve" a 1 GiB scratch buffer once at startup; only the first MiB is ever touched.
var scratch = make([]byte, 1<<30) // 1 GiB

func main() {
	debug.SetMemoryLimit(2 << 30) // 2 GiB soft limit
	// rest of program does ~500 MiB of real work
	_ = scratch[0]
	select {}
}
```

**Observed behavior:** Real working set is ~500 MiB but the runtime triggers GC aggressively and warns about being near the memory limit. Pages of `scratch` may not even be resident yet on Linux.

<details><summary>Hint</summary>

`GOMEMLIMIT` is an accounting target. What counts toward it — virtual size or RSS?

</details>

**Diagnosis:** `make([]byte, 1<<30)` calls `runtime.mallocgc` for a 1 GiB span. The allocator (`runtime/malloc.go`, `largeAlloc`) reserves and commits 1 GiB of address space; the OS may not back it with physical pages until first touch, but the runtime *accounts* the full size against `HeapAlloc` and `GOMEMLIMIT` (`runtime/mgcpacer.go`, `gcController.heapGoal`). The pacer thinks you're using 1.5 GiB total and tightens GC frequency accordingly. The OS sees ~500 MiB RSS; the runtime sees ~1.5 GiB.

**Fix:** Allocate lazily, or in pages:

```go
var scratch []byte
func ensure(n int) {
	if cap(scratch) < n {
		scratch = make([]byte, n)
	}
}
```

The myth is "uncommitted memory is free" — for the runtime's pacing, it isn't, even if for the OS it nearly is.

---

### Bug 10: `string([]byte)` conversion in hot path

**Difficulty:** Junior
**Skills:** string immutability, conversion copies

```go
package main

import (
	"bufio"
	"os"
)

func main() {
	seen := make(map[string]int)
	s := bufio.NewScanner(os.Stdin)
	s.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for s.Scan() {
		key := string(s.Bytes()) // BUG in hot path
		seen[key]++
	}
}
```

**Observed behavior:** `pprof -alloc_space` blames `runtime.stringtoslicebyte` / `runtime.slicebytetostring`. Throughput is half what equivalent C is.

<details><summary>Hint</summary>

Strings are immutable. `s.Bytes()` returns a mutable slice into the scanner's buffer. How does Go reconcile these?

</details>

**Diagnosis:** `string(b)` is not free — `runtime/string.go`'s `slicebytetostring` allocates a fresh byte array and copies. The runtime cannot alias because the scanner will overwrite its buffer on the next `Scan()`. The compiler recognizes `m[string(b)]` and `case string(b):` patterns and elides the allocation by hashing the byte slice directly (`cmd/compile/internal/walk/order.go`, `mapfast` family). Assigning to a variable first defeats that optimization.

**Fix:** Index the map directly so the compiler elides the allocation:

```go
for s.Scan() {
	seen[string(s.Bytes())]++ // compiler elides allocation
}
```

If you must keep the string, copy is mandatory. For one-shot map lookups, write the pattern the compiler recognizes. `go build -gcflags='-m'` will say `string([]byte) does not escape` for the optimized case.

---

### Bug 11: `[]byte(string)` conversion in hot path

**Difficulty:** Junior
**Skills:** mutability, conversion copies

```go
package main

import "crypto/sha256"

func main() {
	keys := loadStrings() // 10M strings
	for _, k := range keys {
		_ = sha256.Sum256([]byte(k)) // BUG: allocates per call
	}
}

func loadStrings() []string { return nil }
```

**Observed behavior:** `pprof -alloc_objects` blames `runtime.stringtoslicebyte`. Throughput is 30% lower than expected.

<details><summary>Hint</summary>

The reverse of Bug 10 has the same root cause — and a narrower compiler optimization.

</details>

**Diagnosis:** `[]byte(s)` allocates because the resulting slice is mutable and the source string is not. `runtime/string.go`'s `stringtoslicebyte` allocates and memcpys. The compiler elides for narrow cases: `for i, c := range []byte(s)`, and recent versions also elide some short-lived passes where the callee provably doesn't retain.

**Fix:** Use `unsafe.StringData` carefully when the callee is well-behaved:

```go
import "unsafe"

func sumString(s string) [32]byte {
	// Safe iff sha256 doesn't retain or mutate the returned slice — it doesn't.
	b := unsafe.Slice(unsafe.StringData(s), len(s))
	return sha256.Sum256(b)
}
```

The shortest defensible fix is profiling-driven: if `stringtoslicebyte` is in the top 10, audit each call site.

---

### Bug 12: `append` without capacity hint

**Difficulty:** Junior
**Skills:** slice growth, `runtime.growslice`

```go
package main

// Collect filters one slice into another.
func Collect(items []int, keep func(int) bool) []int {
	var out []int
	for _, x := range items {
		if keep(x) {
			out = append(out, x) // BUG: grows from 0
		}
	}
	return out
}

func main() {
	items := make([]int, 10_000_000)
	_ = Collect(items, func(x int) bool { return x%2 == 0 })
}
```

**Observed behavior:** `pprof -alloc_objects` shows `runtime.growslice` near the top. For 5M kept items, the slice reallocates ~30 times, copying older contents each time.

<details><summary>Hint</summary>

Without a starting cap, what's the cap after the first `append`?

</details>

**Diagnosis:** `append` to a nil slice creates a small backing array; subsequent appends grow it (`runtime/slice.go`, `growslice`). The growth strategy is roughly: double until 256 elements, then ×1.25, with size-class rounding from `runtime/sizeclasses.go`. Each growth allocates a new array and `memmove`s the old contents. For 5M kept ints, you copy ~2× the final size in total across reallocations. `growslice` allocations also count against `mallocgc` rate, accelerating GC pacing.

**Fix:** Hint capacity:

```go
out := make([]int, 0, len(items)) // worst case; trim later if needed
```

Capacity hints are one of the highest-ROI fixes in Go profiling.

---

### Bug 13: Expecting RSS drop without forcing a GC cycle

**Difficulty:** Senior
**Skills:** `debug.FreeOSMemory`, GC cycles

```go
package main

import (
	"fmt"
	"runtime"
	"runtime/debug"
)

func main() {
	huge := make([]byte, 500<<20) // 500 MiB
	_ = huge
	huge = nil // drop the reference

	debug.FreeOSMemory() // BUG: expects RSS to drop now

	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	fmt.Printf("HeapInuse=%d MiB Sys=%d MiB\n", m.HeapInuse>>20, m.Sys>>20)
	// HeapInuse still ~500 MiB
}
```

**Observed behavior:** `HeapInuse` does not drop. RSS does not drop. Repeating the experiment with `runtime.GC()` first does work.

<details><summary>Hint</summary>

`FreeOSMemory` releases *free* spans back to the OS. What does "free" mean here?

</details>

**Diagnosis:** `runtime/debug.FreeOSMemory` (`runtime/mgc.go`, `freeOSMemory`) returns free spans to the OS via `madvise(MADV_FREE/MADV_DONTNEED)`. A span is "free" only after the mark phase finds it unreachable and the sweep phase moves it to the free list. Setting `huge = nil` makes the data unreachable, but no GC cycle has run yet — the span is still on the in-use list. `FreeOSMemory` finds no free spans to release.

**Fix:** Run a GC cycle first:

```go
huge = nil
runtime.GC()           // mark unreachable, sweep to free list
debug.FreeOSMemory()   // now spans are free and can be released
```

Note Linux's `MADV_FREE` (Go default since 1.12) doesn't immediately reduce RSS — the kernel reclaims pages lazily under pressure. Use `GODEBUG=madvdontneed=1` to force `MADV_DONTNEED` if you need RSS to drop visibly.

---

### Bug 14: Heap-allocated channel leaking with its readers

**Difficulty:** Middle
**Skills:** channel allocation, goroutine leaks

```go
package main

import (
	"fmt"
	"runtime"
)

// FanOut spawns a reader per shard; sends on the channel; never closes it.
func FanOut(nShards int) chan int {
	ch := make(chan int, 64) // heap-allocated runtime.hchan
	for i := 0; i < nShards; i++ {
		go func() {
			for v := range ch {
				_ = v
			}
			// never reached
		}()
	}
	return ch
}

func main() {
	for i := 0; i < 1000; i++ {
		ch := FanOut(4)
		for j := 0; j < 10; j++ {
			ch <- j
		}
		// caller "done" with this batch; drops ch
	}
	runtime.GC()
	fmt.Printf("goroutines=%d\n", runtime.NumGoroutine()) // ~4001
}
```

**Observed behavior:** Goroutine count grows without bound. Each leaked goroutine pins its `hchan` plus its 8 KiB initial stack.

<details><summary>Hint</summary>

`range ch` blocks until the channel is closed. The caller drops `ch` — does that close it?

</details>

**Diagnosis:** `make(chan int, 64)` allocates a `runtime.hchan` on the heap (`runtime/chan.go`, `makechan`). Each reader goroutine parks in `chanrecv` waiting on `hchan.recvq`. As long as the goroutine is parked on the channel, the channel is a GC root (held by the goroutine's stack), and the channel keeps the goroutine alive (via `sudog`). Dropping `ch` in `main` is irrelevant — the goroutines still reference it. Without `close(ch)`, the readers never see "end" and the cycle never breaks.

**Fix:** Close when done, with a sentinel or a context:

```go
func FanOut(ctx context.Context, nShards int) chan int {
	ch := make(chan int, 64)
	for i := 0; i < nShards; i++ {
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case v, ok := <-ch:
					if !ok {
						return
					}
					_ = v
				}
			}
		}()
	}
	return ch
}
```

A goroutine blocked on an unowned channel is a leak. Either the goroutine owns the lifetime (close from inside), the caller owns it (caller closes when done), or context cancellation is wired in.

---

### Bug 15: Long-lived interface value boxing a small struct

**Difficulty:** Senior
**Skills:** interface representation, `runtime.convT*`

```go
package main

import "sync"

type Metric interface{ Value() float64 }

type Counter struct{ n uint64 }

func (c Counter) Value() float64 { return float64(c.n) }

type Registry struct {
	mu sync.Mutex
	m  map[string]Metric
}

func (r *Registry) Add(name string, c Counter) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.m[name] = c // BUG: boxes c on every call
}
```

**Observed behavior:** `pprof -alloc_objects` shows `runtime.convT64`-class function as a hot allocator. Short-lived heap allocations occur on every `Add`.

<details><summary>Hint</summary>

An `interface{}` is two words: type descriptor and data pointer. Where does a `Counter{}` live when stored as `Metric`?

</details>

**Diagnosis:** An interface value is `(*itab, data)`. If the concrete value fits in a single word and the type allows direct storage, the runtime stores inline. Go's rules (`runtime/iface.go`, `convT*` family) box anything the static analysis can't prove fits as a non-pointer word. `Counter`-by-value to `Metric` calls `runtime.convT64` which `mallocgc`s an 8-byte cell. Each `Add` allocates even though logically nothing should escape.

**Fix:** Use pointer receivers and pointer values when stored as interface:

```go
func (c *Counter) Value() float64 { return float64(c.n) }

func (r *Registry) Add(name string, c *Counter) {
	r.m[name] = c // interface { *Counter, &c.n } — no boxing
}
```

Storing a value type into an interface in a hot path is an allocation. Either use a pointer, or keep the value out of the interface.

---

### Bug 16: `defer` in a hot loop allocating `_defer` records

**Difficulty:** Middle
**Skills:** `defer` mechanics, open-coded defers

```go
package main

import "sync"

type Cache struct {
	mu sync.Mutex
	m  map[string]int
}

func (c *Cache) Bump(key string) {
	for i := 0; i < 32; i++ {
		c.mu.Lock()
		defer c.mu.Unlock() // BUG: defer accumulates inside the loop
		c.m[key]++
	}
}
```

**Observed behavior:** Each call enters with one lock and returns with 32 deferred unlocks queued. `pprof` shows `runtime.deferproc` allocating; the lock is held across the whole loop body (and the unlocks only fire at function return).

<details><summary>Hint</summary>

How many deferred calls does each invocation of `Bump` register?

</details>

**Diagnosis:** Go 1.14+ has "open-coded defers" — the compiler inlines `defer fn()` into the function epilogue when (a) there are at most 8 defers in the function and (b) all defers are visible to the compiler (no `defer` inside loops). A `defer` inside a loop forces the heap-allocated `_defer` chain (`runtime/runtime2.go`, `_defer` struct) via `runtime.deferproc`. Each iteration allocates a `_defer` record, and all fire only when the function returns.

**Fix:** Don't defer inside a loop:

```go
for i := 0; i < 32; i++ {
	c.mu.Lock()
	c.m[key]++
	c.mu.Unlock()
}
```

Or factor the body so each `defer` is one-per-call:

```go
func (c *Cache) bumpOnce(key string) {
	c.mu.Lock()
	defer c.mu.Unlock() // open-coded; one defer
	c.m[key]++
}
```

`defer` is cheap when open-coded and expensive when not. Hot loops are exactly where it falls back to expensive.

---

### Bug 17: JSON unmarshal into reused struct retaining old pointers

**Difficulty:** Senior
**Skills:** `encoding/json`, reuse semantics

```go
package main

import "encoding/json"

type Doc struct {
	ID    string
	Tags  []string
	Notes *Notes
}

type Notes struct{ Body string }

// Pipeline reuses one Doc to avoid per-message allocation. Or so we thought.
func Pipeline(messages [][]byte) {
	var d Doc
	for _, raw := range messages {
		if err := json.Unmarshal(raw, &d); err != nil {
			continue
		}
		process(d)
	}
}

func process(Doc) {}
```

**Observed behavior:** Memory grows over time. `inuse_space` shows old `Notes` and `Tags` slices retained. The Doc struct itself is one value, but each unmarshal can leave stale fields from the previous message.

<details><summary>Hint</summary>

When the next JSON omits `notes` or has fewer tags, what happens to the previous `Notes` and `Tags`?

</details>

**Diagnosis:** `json.Unmarshal` into a reused struct does *not* reset fields absent from the new input (`encoding/json/decode.go`, `object`). Slice fields are reused when possible — if the new array is shorter, elements past the new length are zeroed but the backing array stays. Pointer fields are left untouched if absent from input, meaning `process(d)` may see stale `Notes` from a previous message. If `process` retains anything (queue, log line, batch), the old `Notes` body sticks around.

**Fix:** Reset before each unmarshal, or don't reuse:

```go
for _, raw := range messages {
	d := Doc{} // fresh per iteration; let escape analysis decide stack vs heap
	if err := json.Unmarshal(raw, &d); err != nil {
		continue
	}
	process(d)
}
```

Or, if reuse really matters:

```go
d.Tags = d.Tags[:0]  // keeps backing array
d.Notes = nil        // lets the previous *Notes go
```

Reused decode targets are only safe when you understand every field's reset policy.

---

### Bug 18: `time.NewTicker` not stopped — ticker memory plus a goroutine leak

**Difficulty:** Junior
**Skills:** timer heap, goroutine lifetime

```go
package main

import (
	"context"
	"time"
)

func Watch(ctx context.Context, dur time.Duration) {
	deadline := time.After(dur)
	t := time.NewTicker(time.Second) // BUG: never Stop()ped
	for {
		select {
		case <-ctx.Done():
			return
		case <-deadline:
			return
		case <-t.C:
			poll()
		}
	}
}

func poll() {}
```

**Observed behavior:** Each `Watch` call leaves behind a `*time.Ticker`. After thousands of calls, `runtime.NumGoroutine()` is in the thousands; the runtime timer heap (`runtime/time.go`) holds thousands of ticker entries; CPU spent in `runtime.checkTimers` is visible in profiles.

<details><summary>Hint</summary>

`time.NewTicker` schedules a timer entry in the runtime. What removes it?

</details>

**Diagnosis:** `time.NewTicker` (`time/tick.go`) creates a `*Ticker` whose `runtimeTimer` is inserted into the per-P timer heap (`runtime/time.go`, `addtimer`). The timer fires forever, sending on `t.C` every period. Even when no one reads from `t.C`, the timer occupies a slot in the heap and the runtime still wakes up to check it. `time.After` has the same issue for one-shot timers — they don't get garbage collected until they fire.

`Watch` returns when `ctx.Done()` fires; the ticker keeps ticking. The `*Ticker` is unreachable from user code, but the runtime timer heap holds a reference. Result: leaked timer slot, leaked `hchan` for `t.C`. Go 1.23 fixed the GC-of-active-timers gap for new code, but explicit `Stop` is still the only guarantee.

**Fix:** Always `defer t.Stop()`:

```go
t := time.NewTicker(time.Second)
defer t.Stop()
```

For a one-shot timeout inside a long-lived `select`, prefer `t := time.NewTimer(dur); defer t.Stop()` over `time.After(dur)`.

---

## Summary

These bugs cluster into four families.

**Pinning and aliasing (1, 2, 7):** small slices retaining huge backing arrays, `bytes.Buffer.Bytes()` exposing full capacity, `sync.Pool` holding large fields through victim cache. The runtime allocates spans whole and the GC tracks reachability from any pointer into a span. A 4 KiB slice can keep a 50 MiB span alive; a pooled struct with a stray 100 MiB field keeps it alive for many GC cycles.

**Escape and boxing (3, 4, 5, 10, 11, 15):** closures crossing the `go` boundary, `interface{}` boxing in `fmt.Sprintf` and registry maps, returning pointers to locals, `string([]byte)` and `[]byte(string)` conversions, value types into interface storage. The compiler's escape analysis is conservative — anything it can't prove stack-safe goes to the heap. The runtime's interface representation forces boxing for value types. Both bite hardest in hot loops.

**Allocator accounting and lifecycle (6, 9, 12, 13, 16, 17):** maps that don't shrink, pre-allocations counting against `GOMEMLIMIT`, `append` without capacity, expecting `FreeOSMemory` to work without `runtime.GC()`, `defer` in loops falling off the open-coded fast path, JSON unmarshal into reused structs. The runtime accounts and paces based on what it sees, not what you intended.

**Goroutines and timers (8, 14, 18):** rare-pointer scan cost, leaked channels with parked readers, leaked tickers in the timer heap. Long-lived references — through interfaces, channels, or the timer heap — keep memory alive past the point your code "looks done" with it.

Review checklist for any code that crosses an allocator-sensitive boundary:

- [ ] When you return a small slice taken from a large source, did you `copy` (or `bytes.Clone`) rather than re-slice?
- [ ] Does any hot path call `fmt.Sprintf`, `string([]byte)` outside the map-key special case, or `[]byte(string)` other than via `unsafe.Slice(unsafe.StringData(s), len(s))`?
- [ ] Have you run `go build -gcflags='-m=2'` on hot functions and looked for `escapes to heap` on anything that should be local?
- [ ] Do `sync.Pool.Put` paths reset large slice/map fields to nil or empty before returning the object?
- [ ] Does every `time.NewTicker`/`time.NewTimer` have a `defer Stop()`, and does every `chan` made for goroutine coordination have a documented close path?
- [ ] When you call `debug.FreeOSMemory`, did you call `runtime.GC()` first?
- [ ] Do hot `append` sites have a capacity hint, and do hot `defer` sites live in a function whose defer count the compiler can see (no `defer` inside loops)?
- [ ] When you reuse a decode target across messages, have you audited every field's reset policy — slices truncated, pointers nilled, maps drained?
- [ ] For tagged-but-rarely-used pointer fields on huge homogeneous arrays, have you moved the rare path to a sidecar map so the hot path's GC scan bitmap is cheaper?
