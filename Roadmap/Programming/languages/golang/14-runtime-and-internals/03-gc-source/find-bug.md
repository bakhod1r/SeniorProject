# GC Source — Find the Bug

## 1. How to use this file

Fourteen buggy Go programs that interact with the garbage collector — leaks the GC can't help with, finalizers that misfire, write-barrier corruption, slice and map shapes that pin memory, `sync.Pool` misuse, `runtime.GC()` thrashing, `GOGC`/`GOMEMLIMIT` misconfiguration. Read each in 30-60 seconds, decide where the defect is, then expand `<details>` for the answer. Every bug here has been seen in production Go services running against `runtime/mgc.go`, `runtime/mfinal.go`, and `runtime/mbarrier.go`.

GC bugs almost never crash on the happy path. They tilt `HeapInuse` upward over hours, fire finalizers in the wrong order, double-free a C handle two days after release, or freeze a service for 200 ms during a stop-the-world. Three questions to ask of every snippet:

1. *Is anything still reachable from a root (goroutine stack, global, finalizer queue, channel buffer) that logically shouldn't be?*
2. *Is the program lying to the GC — using `unsafe.Pointer` to dodge the write barrier, building a finalizer cycle, or relying on finalizer ordering?*
3. *Is the program working with the GC's cost model, or against it — calling `runtime.GC()` in a hot loop, sizing `GOMEMLIMIT` below the live set, treating `sync.Pool` as a cache?*

If a snippet can't answer all three, there's a bug. Runtime references throughout point at the current `runtime/` tree: `mgc.go` for the mark/sweep driver, `mfinal.go` for finalizer queuing, `mbarrier.go` for the deletion barrier. Read the source alongside the diagnoses — the comments in those files are canonical.

---

### Bug 1: Goroutine leak holding heap forever

**Difficulty:** Medium
**Skills:** goroutine lifecycle, GC reachability, unbuffered channels

```go
package main

import (
	"net/http"
	"time"
)

type Result struct{ Body []byte } // ~1 MiB per request

func handler(w http.ResponseWriter, r *http.Request) {
	out := make(chan Result) // unbuffered
	go func() {
		body := make([]byte, 1<<20)
		// ... fill body ...
		out <- Result{Body: body} // blocks forever if caller times out
	}()
	select {
	case res := <-out:
		w.Write(res.Body)
	case <-time.After(100 * time.Millisecond):
		http.Error(w, "timeout", http.StatusGatewayTimeout)
		return // goroutine still parked on the send
	}
}
```

**Observed behavior:** Under any load that triggers the timeout path even occasionally, `HeapInuse` climbs by ~1 MiB per timed-out request and never comes down. `runtime.NumGoroutine()` grows linearly. Heap profile points at `handler.func1`. Eventually OOM.

<details><summary>Hint</summary>

Every blocked goroutine is a GC root. What's still reachable from a goroutine parked on an unbuffered channel send?

</details>

**Diagnosis:** The child sends on an unbuffered channel. When the parent takes `time.After` and returns, nothing receives. The goroutine stays parked on the send forever — and `body` lives on its stack as the operand of `<-`, plus `out` is closed-over. A parked goroutine is a GC root (`runtime/mgc.go`'s mark phase scans every `g`'s stack via `scanstack`), so `body` cannot be collected. The GC is working perfectly; the leak is *reachable*, not garbage.

**Fix:** Make the channel buffered so the send completes even if nobody reads, or `select` on `ctx.Done()` inside the goroutine:

```go
out := make(chan Result, 1)
go func() {
	body := make([]byte, 1<<20)
	select {
	case out <- Result{Body: body}:
	case <-r.Context().Done():
	}
}()
```

The general rule: every spawned goroutine needs a reachable exit on every path. The GC cannot recycle what a stack frame references.

---

### Bug 2: Small slice pinning a huge backing array

**Difficulty:** Medium
**Skills:** slice internals, backing-array lifetime, span granularity

```go
package main

import "io"

type cache struct{ tokens [][]byte }

func extractToken(body []byte) []byte {
	i := tokenStart(body)
	return body[i : i+20] // BUG: shares the 4 MiB backing array
}

func (c *cache) handle(body []byte) {
	c.tokens = append(c.tokens, extractToken(body))
	// body falls out of scope — but is still alive
}

func tokenStart(b []byte) int   { return len(b) - 25 }
func _ulibm(_ io.Reader) []byte { return nil }
```

**Observed behavior:** `cache.tokens` is supposed to be a list of 20-byte strings. After 10k entries, the slice averages 20 bytes — but the heap profile shows ~40 GiB attributed to `io.ReadAll`. `inuse_space` blames `bytes.makeSlice`.

<details><summary>Hint</summary>

A slice is `{ptr, len, cap}`. What is `ptr` pointing into, and what does the GC keep alive when it sees that pointer?

</details>

**Diagnosis:** `body[i:i+20]` does not allocate. The new slice's `ptr` points into the middle of the 4 MiB backing array. The GC has no concept of partial liveness — it sees a pointer into the span and marks the entire span live. See `runtime/mgc.go` `scanobject`: marking is at object granularity, not field granularity. Every 20-byte token pins 4 MiB.

**Fix:** Copy the bytes so the new slice has its own backing array:

```go
func extractToken(body []byte) []byte {
	out := make([]byte, 20)
	copy(out, body[tokenStart(body):])
	return out
}
```

Or `bytes.Clone(body[i:i+20])` (Go 1.20+). Same trap applies to `strings.Split` substrings, `regexp.FindSubmatch` results, `bytes.Buffer.Bytes()` — any time a small slice of a large buffer outlives the buffer's expected lifetime, the buffer survives.

---

### Bug 3: Deleted map entries don't release memory

**Difficulty:** Medium
**Skills:** map internals, `runtime/map.go`, retained capacity

```go
package main

import "runtime"

type Session struct{ Data [4096]byte }

var sessions = make(map[string]*Session)

func reapAll() {
	for k := range sessions {
		delete(sessions, k) // BUG: doesn't shrink the bucket array
	}
}

func main() {
	for i := 0; i < 10_000_000; i++ {
		sessions[key(i)] = &Session{}
	}
	reapAll()
	runtime.GC()
	// HeapInuse barely drops; map still occupies ~GiB of bucket storage.
}

func key(int) string { return "" }
```

**Observed behavior:** After every session expires and `delete` is called for each key, `HeapInuse` drops a few percent — not by the gigabytes the `Session` pointers consumed. `len(sessions) == 0` but the map "remembers" its peak size.

<details><summary>Hint</summary>

`delete(m, k)` zeroes the slot but does not free buckets. What does that mean for a map that hit a peak and emptied?

</details>

**Diagnosis:** `runtime/map.go` allocates buckets in powers of two during inserts; `delete` clears the `tophash` and key/value slots but never shrinks. The bucket array stays at its peak size. The values (`*Session`) are unreferenced and collected, but the map header pins all bucket spine and overflow buckets. Go 1.24+ Swiss-tables (`runtime/maps`) improve this slightly but still retain control groups.

**Fix:** If you genuinely empty a large map, replace it:

```go
func reapAll() { sessions = make(map[string]*Session) }
```

For partial reaping, accept the memory floor or shard into many smaller maps and replace whole shards. There is no `map.Shrink()` — copying every live entry on shrink would be a worse cost model than the current behavior for most workloads.

---

### Bug 4: Finalizer that references its own object

**Difficulty:** Hard
**Skills:** `runtime.SetFinalizer`, finalizer queue, closure capture

```go
package main

import (
	"fmt"
	"runtime"
)

type Resource struct{ id int; closed bool }

func NewResource(id int) *Resource {
	r := &Resource{id: id}
	runtime.SetFinalizer(r, func(self *Resource) {
		if !self.closed {
			fmt.Printf("leaked %d\n", self.id)
			r.closed = true // BUG: closes over the outer r
		}
	})
	return r
}
```

**Observed behavior:** "leaked N" never prints. Memory grows. Finalizer behaves as if it never registered, even though `runtime.SetFinalizer` returned without panicking.

<details><summary>Hint</summary>

The finalizer is a closure. What variables does it capture? Are any of them the object itself, by a path other than `self`?

</details>

**Diagnosis:** The closure captures `r` — the outer variable, not just the `self` parameter. The closure's `funcval` carries a pointer to `*Resource`. During mark (`runtime/mfinal.go`'s `addfinalizer` sets up the special), the closure is reachable from the special, the closure references `r`, and `r` is therefore permanently reachable. The object can never become unreachable, so the finalizer never fires — exactly as documented in `mfinal.go`: "the finalizer must not keep the object alive."

**Fix:** Use only the parameter, never close over the object:

```go
runtime.SetFinalizer(r, func(self *Resource) {
	if !self.closed {
		fmt.Printf("leaked %d\n", self.id)
		self.closed = true
	}
})
```

The rule, repeated in `runtime/mfinal.go` and the `SetFinalizer` docs: the finalizer must reach the object only through its argument. Capturing the object — directly or transitively — defeats the entire mechanism.

---

### Bug 5: Finalizer fires too early; missing `KeepAlive`

**Difficulty:** Hard
**Skills:** finalizer timing, liveness analysis, `runtime.KeepAlive`

```go
package main

/*
typedef struct { int fd; } file_t;
extern int  read_byte(file_t*);
extern void close_file(file_t*);
*/
import "C"
import (
	"runtime"
	"unsafe"
)

type File struct{ c *C.file_t }

func Open() *File {
	f := &File{c: openNative()}
	runtime.SetFinalizer(f, func(f *File) { C.close_file(f.c) })
	return f
}

func ReadByte(f *File) byte {
	raw := unsafe.Pointer(f.c)
	b := C.read_byte((*C.file_t)(raw))
	return byte(b)
}

func openNative() *C.file_t { return nil }
```

**Observed behavior:** Under high load, occasional `EBADF` from the C side. Single-stepping in a debugger never reproduces it. Adding any `fmt.Printf("%v", f)` after `read_byte` makes it disappear.

<details><summary>Hint</summary>

`ReadByte` extracts the C pointer and then doesn't touch `f`. What does the Go compiler know about `f`'s liveness for the rest of the function?

</details>

**Diagnosis:** Liveness analysis decides where `f` is "last used". Once `ReadByte` has read `f.c` into `raw`, `f` itself has no further use — the compiler may consider it dead immediately. If a concurrent GC mark (`runtime/mgc.go` `gcStart` → `gcMarkRootCheck`) runs in the window between "read `f.c`" and "call `read_byte`", the finalizer queue (`runtime/mfinal.go` `runfinq`) may fire `close_file`. `read_byte` then operates on a closed fd. The bug is timing-sensitive and disappears whenever you add a use of `f` after the C call.

**Fix:** Anchor `f` past the last point where the C side needs it:

```go
func ReadByte(f *File) byte {
	b := C.read_byte(f.c)
	runtime.KeepAlive(f) // forces the liveness analyzer to mark f used here
	return byte(b)
}
```

`runtime.KeepAlive` is a no-op at runtime — it exists to extend the liveness range. See `runtime/mfinal.go`'s comment on `KeepAlive`: the canonical fix for "finalizer fired during the syscall I'm still inside of."

---

### Bug 6: `sync.Pool` used as a long-term cache

**Difficulty:** Medium
**Skills:** `sync.Pool` semantics, `poolCleanup`, GC clearing

```go
package main

import (
	"sync"
	"time"
)

type ExpensiveResult struct{ Computed [1 << 20]byte }

var cache = sync.Pool{
	New: func() any { return computeExpensive() }, // 500 ms
}

func computeExpensive() *ExpensiveResult { return &ExpensiveResult{} }

func Get() *ExpensiveResult { return cache.Get().(*ExpensiveResult) }
func Put(r *ExpensiveResult) { cache.Put(r) }

func main() {
	for {
		r := Get()
		Put(r)
		time.Sleep(10 * time.Second) // GC will run between iterations
	}
}
```

**Observed behavior:** The caching layer was meant to amortize a 500 ms computation. Latency dashboards show ~500 ms on essentially every `Get`. Cache hit rate is 0%. Removing the pool entirely changes nothing.

<details><summary>Hint</summary>

When does `sync.Pool` drop the items you put into it? Read `sync/pool.go` `poolCleanup`.

</details>

**Diagnosis:** `sync.Pool` is not a cache. `sync/pool.go` registers `poolCleanup` via `runtime.registerPoolCleanup`, called from `runtime/mgc.go`'s `clearpools` during sweep termination. At the start of each GC cycle the pool's local and victim slices rotate: the previous victim is dropped entirely, the locals become the new victim, locals are zeroed. Two GCs and any item is gone. With a 10-second sleep, default `GOGC` runs the GC several times — every cached item is collected before the next `Get`.

**Fix:** Use a real cache (`hashicorp/golang-lru`, a `map` + mutex with size bounds) for items meant to outlive a GC. Reserve `sync.Pool` for what it's designed for: per-operation scratch buffers (`bytes.Buffer`, `[]byte`, `*gzip.Writer`) where the consumer returns the item before the next GC. Read `sync/pool.go`'s package doc: "An appropriate use of a Pool is to manage a group of temporary items silently shared among and potentially reused by concurrent independent clients of a package."

---

### Bug 7: Closure capture in hot path forces allocation

**Difficulty:** Medium
**Skills:** escape analysis, allocation rate, GC frequency

```go
package main

import "sort"

type Record struct{ Score, ID int }

func sortByScoreThen(records []Record, secondary func(a, b Record) bool) {
	sort.Slice(records, func(i, j int) bool {
		if records[i].Score != records[j].Score {
			return records[i].Score > records[j].Score
		}
		return secondary(records[i], records[j])
	})
}

func RankForUser(records []Record, userID int) {
	bias := userID & 0xff
	sortByScoreThen(records, func(a, b Record) bool {
		return (a.ID^bias)%1000 < (b.ID^bias)%1000 // captures bias
	})
}
```

**Observed behavior:** `pprof` `inuse_space` is calm; `allocs` is enormous. GC runs every 50 ms. CPU profile: ~30% in `runtime.mallocgc` and `runtime.gcBgMarkWorker`. The comparator looks innocent.

<details><summary>Hint</summary>

Where does the inner closure live? Where does its captured `bias` live? Run `go build -gcflags='-m=2'`.

</details>

**Diagnosis:** The inner closure captures `bias`. Because it's passed to `sortByScoreThen` (which passes it to `sort.Slice`), it outlives the calling frame as far as escape analysis can prove — the compiler heap-allocates the closure environment, including a fresh `int` cell for `bias`. One allocation per call; thousands per second at load. GC frequency is proportional to allocation rate, not live set size (see `runtime/mgcpacer.go` `heapGoal`: the *target* is a multiple of the previous live heap, but how *often* you hit it depends on allocation speed).

**Fix:** Hoist the capture into a parameter so no nested closure is needed:

```go
func sortByScoreThenBias(records []Record, bias int) {
	sort.Slice(records, func(i, j int) bool {
		if records[i].Score != records[j].Score {
			return records[i].Score > records[j].Score
		}
		return (records[i].ID^bias)%1000 < (records[j].ID^bias)%1000
	})
}
```

Better: `slices.SortFunc` (Go 1.21+) with a generic comparator and let inlining take it from there.

---

### Bug 8: `runtime.GC()` in a hot loop

**Difficulty:** Easy
**Skills:** STW pauses, GC pacing, `runtime/mgc.go`

```go
package main

import (
	"runtime"
	"time"
)

func processBatch(items []Item) []Result {
	results := make([]Result, 0, len(items))
	for _, it := range items {
		results = append(results, transform(it))
		runtime.GC() // "to keep memory low between items"
	}
	return results
}

type Item struct{}
type Result struct{}

func transform(Item) Result { time.Sleep(time.Microsecond); return Result{} }
```

**Observed behavior:** A batch that should run in 1 second takes 30. CPU is pinned. `go tool trace` shows the program is in STW pauses for most of wall time, with garbage collector workers running back-to-back.

<details><summary>Hint</summary>

What does `runtime.GC()` actually do? Read its doc and `runtime/mgc.go`'s `GC` function.

</details>

**Diagnosis:** `runtime.GC()` initiates a full GC cycle synchronously: STW for `gcStart`, concurrent mark, STW for mark termination, concurrent sweep, and it *waits* for the previous sweep to finish before returning. Per-item calls mean per-item STW pauses, and they defeat the pacer (`runtime/mgcpacer.go`), whose purpose is to amortize GC work across allocations so the program never has to wait. Forcing GC per iteration is asking the runtime to do its slowest path on demand.

**Fix:** Delete the `runtime.GC()` call. The pacer triggers cycles at the right cadence from `GOGC` (default 100 — next GC when the heap doubles since the last live-set measurement). If between-batch memory is genuinely a concern, call `runtime.GC()` once after the whole batch, not per item. For predictable pauses, consider `debug.SetGCPercent(-1)` with manual triggers at known idle moments — but that's almost always a worse design.

---

### Bug 9: Forgotten `Close` on a finalizer-backed handle

**Difficulty:** Hard
**Skills:** finalizer queue depth, fd exhaustion vs heap

```go
package main

import (
	"net"
	"runtime"
)

type Conn struct{ c net.Conn }

func Dial(addr string) (*Conn, error) {
	c, err := net.Dial("tcp", addr)
	if err != nil {
		return nil, err
	}
	w := &Conn{c: c}
	runtime.SetFinalizer(w, func(w *Conn) { w.c.Close() }) // safety net
	return w, nil
}

func ping(addr string) error {
	conn, err := Dial(addr)
	if err != nil {
		return err
	}
	_, err = conn.c.Write([]byte("PING"))
	return err // BUG: never calls Close
}
```

**Observed behavior:** Single-threaded testing: fine. Production at 5k RPS: the process accumulates `CLOSE_WAIT` sockets and eventually hits `socket: too many open files`. Heap looks healthy. `pprof` shows `runtime.runfinq` consuming non-trivial CPU.

<details><summary>Hint</summary>

Finalizers run on a single goroutine in queue order. What happens when the queue fills faster than it drains?

</details>

**Diagnosis:** The finalizer is a safety net. It works under light load: the connection goes out of scope, the next GC's `runtime/mfinal.go` `queuefinalizer` enqueues it, the dedicated `runfinq` goroutine pops it, the socket closes. Under heavy load two problems compound: (1) finalizers don't run until the next GC, and the program needs descriptors *now*; (2) finalizers run serially on a single goroutine — if `Close` does TCP FIN or TLS shutdown, the queue grows. File descriptors are not GC-managed, but the program is leaning on GC cadence to release them.

**Fix:** Close explicitly. The finalizer is a backstop for *bugs*, not a release mechanism:

```go
func ping(addr string) error {
	conn, err := Dial(addr)
	if err != nil {
		return err
	}
	defer conn.c.Close()
	_, err = conn.c.Write([]byte("PING"))
	return err
}
```

The standard-library pattern (`os.File`, `*sql.DB`) sets a finalizer *and* documents that callers must `Close`. The finalizer prints a warning or no-ops; correctness comes from `Close`. Resource lifetime should never depend on GC pressure, which has no relationship to resource exhaustion.

---

### Bug 10: `GOGC=off` in production

**Difficulty:** Medium
**Skills:** GC pacer, `GOGC` env var, heap growth

```bash
ENV GOGC=off
```

```go
package main

import "fmt"

func main() {
	cache := make(map[string][]byte)
	for i := 0; ; i++ {
		k := fmt.Sprintf("key-%d", i)
		cache[k] = make([]byte, 1024)
		if len(cache) > 100_000 {
			delete(cache, fmt.Sprintf("key-%d", i-100_000)) // bounded
		}
	}
}
```

**Observed behavior:** A developer found that disabling GC improved a benchmark by 8% and shipped `GOGC=off` to production. Service ran fine for an hour, slower after four, OOM-killed after six. The map keeps 100k entries; allocator-side garbage that *was* being recycled is now accumulating without bound.

<details><summary>Hint</summary>

`GOGC=off` doesn't mean "stop allocating". What does the live set look like vs the heap size?

</details>

**Diagnosis:** `GOGC=off` (equivalent to `debug.SetGCPercent(-1)`) tells the pacer in `runtime/mgcpacer.go` never to trigger a cycle. Mark and sweep don't run. Every allocation succeeds against new span memory from `mheap`, and nothing returns to the OS. The live set may be bounded (100k × 1 KiB ≈ 100 MiB), but the *heap* grows linearly with allocation count because allocations from deleted slots are never reclaimed. Eventually OOM.

**Fix:** Don't disable GC in long-running services. If the benchmark gain was real, the right knobs are: `GOGC=200` or `500` to trade memory for CPU but keep collecting; `GOMEMLIMIT` to set a hard ceiling and let the pacer auto-tune (Go 1.19+); `debug.SetGCPercent(-1)` *temporarily* around a known burst followed by `runtime.GC()` and re-enable. `GOGC=off` is acceptable only for batch programs whose total runtime is short enough that the heap can't outgrow available memory.

---

### Bug 11: `GOMEMLIMIT` set far below the live set

**Difficulty:** Medium
**Skills:** `GOMEMLIMIT` semantics, GC thrash, pacer feedback

```bash
ENV GOMEMLIMIT=512MiB
```

```go
package main

// service caches ~2 GiB of model weights, immutable, lives for process lifetime
var weights = make([][]float64, 0, 1000)

func init() {
	for i := 0; i < 1000; i++ {
		weights = append(weights, make([]float64, 256*1024)) // 2 MiB each
	}
}

func main() {
	for {
		_ = make([]float64, 1024) // tiny scratch per request
	}
}
```

**Observed behavior:** Service was assigned 512 MiB by a misconfigured deployment template. Live model is 2 GiB. The runtime never panics, never OOM-kills — but spends 95% of CPU in GC, request p50 is 500 ms when the model evaluates in 5 ms, and `runtime.MemStats.GCCPUFraction` reads 0.95.

<details><summary>Hint</summary>

`GOMEMLIMIT` is a soft limit. What does the pacer do when the live set already exceeds it?

</details>

**Diagnosis:** `GOMEMLIMIT` (`runtime/mgcpacer.go` `memoryLimit`) is a soft target. When the live set exceeds the limit the pacer cannot reduce live memory (it's live — nothing to collect) and falls back to running GCs as often as possible to recover any garbage at all. The pacer's escape valve (also in `mgcpacer.go`) refuses to let GC consume more than 50% of CPU via `gcCPULimit` — so it eventually backs off and lets the heap grow past the limit. But not before burning 50% of CPU on doomed cycles.

**Fix:** Set `GOMEMLIMIT` above the live set with headroom — 1.5× to 2× the steady-state live size, or unset and rely on `GOGC`. The pacer docs explicitly warn: "If the application's actual live heap is close to or exceeds GOMEMLIMIT, the GC will run continuously." Containerized deployments should derive `GOMEMLIMIT` from the cgroup memory limit, not pin it independently.

---

### Bug 12: Pointer to local escapes via goroutine

**Difficulty:** Medium
**Skills:** escape analysis, goroutine spawn, allocation rate

```go
package main

import "sync"

type Job struct{ Payload [4096]byte }

func handle(in <-chan Job) {
	var wg sync.WaitGroup
	for job := range in {
		wg.Add(1)
		go func() {
			defer wg.Done()
			process(&job) // BUG
		}()
	}
	wg.Wait()
}

func process(*Job) {}
```

**Observed behavior:** A worker processing 10k jobs/sec runs GC every 30 ms. `go build -gcflags='-m'` reports `moved to heap: job`. Heap profile: ~40 MiB of `Job` objects churning. Comments claim "we pass a pointer to avoid copying."

<details><summary>Hint</summary>

The goroutine captures `job` by reference. What does escape analysis decide about a variable whose address is taken by a closure that outlives the iteration?

</details>

**Diagnosis:** `&job` takes the address of the loop variable. The goroutine closure captures it. Since the goroutine may live past the iteration (and past the function return), the compiler must heap-allocate `job` so its address stays valid. The 4 KiB `Job` allocates on the heap per iteration. On Go versions before 1.22 the bug was worse — the loop variable was shared across iterations and all goroutines saw the same `job`. On 1.22+ each iteration gets a fresh `job`, but each one still escapes.

**Fix:** Pass by value:

```go
go func(job Job) {
	defer wg.Done()
	process(&job) // address of the parameter, on the goroutine's stack
}(job)
```

`job` is now a value parameter on the goroutine's own stack — no heap allocation. `&job` is the address of the parameter, valid for the goroutine's lifetime, and escape analysis sees it does not escape further. Verify with `-gcflags='-m'`: the "moved to heap" message should be gone.

---

### Bug 13: `unsafe.Pointer` dodges the write barrier

**Difficulty:** Hard
**Skills:** write barriers, `runtime/mbarrier.go`, mark phase invariants

```go
package main

import "unsafe"

type Node struct {
	Next *Node
	Data [128]byte
}

type List struct {
	headBits uintptr // store *Node as uintptr to "save a word of header"
}

func (l *List) Push(n *Node) {
	// BUG: bypasses the write barrier
	*(*uintptr)(unsafe.Pointer(&l.headBits)) = uintptr(unsafe.Pointer(n))
}

func (l *List) Head() *Node { return (*Node)(unsafe.Pointer(l.headBits)) }
```

**Observed behavior:** Tests pass. Under sustained load with concurrent GC active, the program crashes occasionally with `runtime: marked free object in span` or `fatal error: found pointer to free object`. Crashes happen far from the unsafe code. `GOGC=off` makes them disappear.

<details><summary>Hint</summary>

`runtime/mbarrier.go` describes the Yuasa-style deletion barrier. What does the runtime do on a normal pointer assignment that the unsafe path skips?

</details>

**Diagnosis:** Go's GC is concurrent with the mutator. During mark, the runtime maintains the tricolor invariant via the write barrier: every pointer write goes through `runtime/mbarrier.go`'s `gcWriteBarrier`, which records the *old* value so the GC can re-trace it (Yuasa-style deletion barrier — see the comment at the top of `mbarrier.go`). Storing a pointer as `uintptr` bypasses this entirely: the compiler emits a plain word store, no barrier. The GC then mis-marks: an object reachable through `l.headBits` is treated as garbage and freed, and a later read through `Head()` returns a freed object. The crash is far from the cause because the dangling pointer survives until dereferenced.

**Fix:** Store pointers as pointers:

```go
type List struct{ head *Node }
func (l *List) Push(n *Node) { l.head = n } // barrier inserted automatically
```

The "saved word" was imaginary — `*Node` and `uintptr` are the same size. The `unsafe` package documentation explicitly forbids holding pointers as `uintptr` across statements; the GC has no obligation to keep the underlying object alive when it appears only as integer bits. `runtime/mbarrier.go` and `unsafe/unsafe.go` are the canonical sources, and the rule has not relaxed since Go 1.0.

---

### Bug 14: Finalizer on a cycle never runs

**Difficulty:** Hard
**Skills:** finalizer reachability rules, cycle handling

```go
package main

import (
	"fmt"
	"runtime"
)

type Node struct {
	Name string
	Peer *Node
}

func New(name string) *Node {
	n := &Node{Name: name}
	runtime.SetFinalizer(n, func(n *Node) {
		fmt.Printf("finalized %s\n", n.Name)
	})
	return n
}

func main() {
	a, b := New("a"), New("b")
	a.Peer = b
	b.Peer = a
	a, b = nil, nil
	runtime.GC()
	runtime.GC()
	// expected: "finalized a" and "finalized b"
	// actual: nothing
}
```

**Observed behavior:** Two objects form a cycle. Both go out of scope. Neither finalizer ever runs, even after multiple forced GCs. Memory holds the pair indefinitely.

<details><summary>Hint</summary>

Read `runtime.SetFinalizer` on cycles. What does the runtime do with a group of mutually-referencing finalizable objects?

</details>

**Diagnosis:** Quoting `runtime/mfinal.go` and the `SetFinalizer` docs: "A cycle of objects with finalizers is not guaranteed to be collected." The finalizer machinery requires a topological order in which to run finalizers — and a cycle has no such order. The pair is reachable through each other, and the GC refuses to break the cycle for fear of running `a`'s finalizer with `a.Peer` already finalized. Both objects (and any subgraph they pin) leak.

**Fix:** Don't put finalizers on objects that can be part of cycles. If a cycle is unavoidable, designate one object as the finalized owner and break the cycle explicitly:

```go
type Group struct{ a, b *Node }

func NewGroup() *Group {
	g := &Group{a: &Node{Name: "a"}, b: &Node{Name: "b"}}
	g.a.Peer, g.b.Peer = g.b, g.a
	runtime.SetFinalizer(g, func(g *Group) {
		g.a.Peer, g.b.Peer = nil, nil
	})
	return g
}
```

Better still: don't rely on finalizers. They're a last resort for non-memory resources (file descriptors, C handles), and only when explicit `Close` is also provided. Cycles plus finalizers are documented in `mfinal.go` as "do not do this."

---

### Bug 15: `time.Ticker` never stopped; ticker and goroutine leak

**Difficulty:** Medium
**Skills:** `time.Ticker` internals, runtime timer heap, channel reachability

```go
package main

import (
	"context"
	"time"
)

type Worker struct{ State map[string]int } // ~1 MiB per worker

func (w *Worker) Run(ctx context.Context) {
	tick := time.NewTicker(time.Second)
	// BUG: no defer tick.Stop()
	for {
		select {
		case <-tick.C:
			w.collectMetrics()
		case <-ctx.Done():
			return
		}
	}
}

func (w *Worker) collectMetrics() {}

func main() {
	for i := 0; i < 1_000_000; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		w := &Worker{State: make(map[string]int)}
		go w.Run(ctx)
		cancel()
	}
	select {}
}
```

**Observed behavior:** `Worker.Run` exits cleanly when `ctx.Done()` fires. But `runtime.NumGoroutine()` doesn't drop, and `HeapInuse` keeps climbing. After a million workers, ~1 GiB of state and ~1 million goroutines remain.

<details><summary>Hint</summary>

`time.NewTicker` registers a `runtimeTimer` with the runtime's timer heap. What keeps the ticker and its channel reachable after `Run` returns?

</details>

**Diagnosis:** `time.NewTicker` registers a `runtimeTimer` with the runtime's timer heap (`runtime/time.go`). The timer holds a pointer to channel `tick.C`. The timer heap is a root: the ticker, its channel, and anything reachable from it stay alive. When `Run` returns via `ctx.Done()` *without* `tick.Stop()`, the ticker stays in the heap forever, firing every second into a channel no one reads. The channel and surrounding closure remain reachable, which keeps `w` (with its 1 MiB `State`) alive. Each unstopped ticker leaks a ticker plus its surrounding `Worker`.

**Fix:** Always pair `time.NewTicker` with `tick.Stop()`:

```go
func (w *Worker) Run(ctx context.Context) {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-tick.C:
			w.collectMetrics()
		case <-ctx.Done():
			return
		}
	}
}
```

Go 1.23+ mitigates this somewhat — the ticker's runtime timer is removed when the ticker becomes unreachable. On earlier versions, `tick.Stop()` is mandatory. The same rule applies to `time.NewTimer` if not consumed and to `time.AfterFunc` returns.

---

### Bug 16: `s = s[:0]` keeps pointer-bearing tail alive

**Difficulty:** Hard
**Skills:** slice clearing, reachability of unused capacity

```go
package main

type Customer struct{ Profile [256 * 1024]byte }

type Order struct {
	Customer *Customer
	Total    float64
}

type Batch struct{ orders []Order }

func (b *Batch) Reset() {
	b.orders = b.orders[:0] // BUG: doesn't clear pointers in the underlying array
}

func (b *Batch) Add(o Order) { b.orders = append(b.orders, o) }
```

**Observed behavior:** A batch processor reuses a `Batch` across many runs. After a large batch (10k orders, each pinning a 256 KiB `Customer`), it calls `Reset()` and proceeds. Memory stays elevated even with `len(b.orders) == 0`. Heap profile shows ~2.5 GiB of `Customer` objects reachable through what looks like an empty slice.

<details><summary>Hint</summary>

`s = s[:0]` changes `len`. What happens to elements past the new `len` but within `cap`?

</details>

**Diagnosis:** `s = s[:0]` sets `len` to 0 but leaves `cap` unchanged — the backing array still holds the previous `Order` values with their `*Customer` pointers. The GC marks the backing array from the slice header; `runtime/mgc.go`'s `scanobject` walks the type's pointer bitmap for every word the type covers, not bounded by any user-level "logical length." Every `*Customer` in the unused tail keeps its 256 KiB `Customer` alive.

**Fix:** Clear pointer-bearing slots before truncating. Go 1.21+:

```go
func (b *Batch) Reset() {
	clear(b.orders) // zeros all elements in [0, len)
	b.orders = b.orders[:0]
}
```

Pre-1.21:

```go
func (b *Batch) Reset() {
	for i := range b.orders {
		b.orders[i] = Order{}
	}
	b.orders = b.orders[:0]
}
```

Same rule applies to maps via `clear(m)` (post-1.21). For slices of non-pointer types (`[]int`, `[]byte`), the trick isn't needed — there's nothing to keep alive.

---

## Summary

These bugs cluster into five families.

**Reachability leaks the GC can't fix (1, 2, 3, 15, 16):** goroutines parked on roots, slices pinning oversized backing arrays, maps that don't shrink, tickers in the timer heap, slice tails retaining pointers past `len`. The common pattern: the GC keeps reachable objects alive — exactly as designed — and the program's mental model of "reachable" disagrees with the runtime's.

**Finalizers used incorrectly (4, 5, 9, 14):** capturing the object in the finalizer closure, missing `runtime.KeepAlive`, leaning on finalizers for resource release, attaching finalizers to cyclic objects. Finalizers are subtle, single-threaded, ordering-sensitive, and explicitly disclaim cycles. They are a last-resort backstop, never the primary release path. Read `runtime/mfinal.go`'s package comment before using `runtime.SetFinalizer`.

**Fighting the pacer (6, 7, 8, 10, 11):** `sync.Pool` as a cache, closures inflating allocation rate, `runtime.GC()` per item, disabling GC entirely, `GOMEMLIMIT` below the live set. The pacer in `runtime/mgcpacer.go` does an excellent job when given accurate cost signals; sabotaging it reliably produces a worse outcome than the default.

**Allocation pressure (7, 12):** closures and goroutine spawns that force heap allocations on hot paths. Escape analysis is a contract: if you take the address of a stack value and let it leave the frame, you pay for a heap allocation and a future GC scan. `-gcflags='-m'` is the cheapest debugging tool for finding these.

**Write-barrier corruption (13):** `unsafe.Pointer` to `uintptr` stores that skip `runtime/mbarrier.go`'s barrier. These produce arbitrary crashes far from the cause. The fix is always the same: store pointers as pointers, treat `unsafe` as a last resort with documented invariants.

Review checklist for any PR that touches allocation, finalization, or runtime tuning:

- [ ] Does every spawned goroutine have a reachable exit on every path (cancellation, timeout, channel close), so its stack can be released?
- [ ] Are slices and substrings copied out of large parent buffers before the parent buffer goes out of scope (`bytes.Clone`, explicit `copy`)?
- [ ] For maps that empty under load, is the map replaced rather than emptied entry-by-entry?
- [ ] Does any `runtime.SetFinalizer` capture the object via anything other than the function parameter? Is there a `runtime.KeepAlive` past the last point a C side needs the object?
- [ ] Is `sync.Pool` used only for per-operation scratch objects, never as a cross-GC cache?
- [ ] Are there `runtime.GC()` calls outside debugging/benchmarking? `GOGC=off` outside a short-lived batch program?
- [ ] Is `GOMEMLIMIT` set above the steady-state live set with at least 50% headroom, ideally derived from the cgroup limit?
- [ ] Have you run `go build -gcflags='-m'` on hot-path functions and confirmed no unexpected "moved to heap" reports?
- [ ] Do long-lived collections (caches, indexes, registries) have a deletion path matching their insertion path?
- [ ] Is there *any* `unsafe.Pointer` → `uintptr` round-trip where the `uintptr` lives across a statement, or any pointer stored as `uintptr` in a struct field? If so, the write barrier is being bypassed and the program is unsound under concurrent GC.
- [ ] Does every `time.NewTicker` have a `defer tick.Stop()`? Does every buffered channel have a reader or a bounded lifetime?
- [ ] When reusing slices of pointer-bearing types, is `clear(s)` (or per-element zeroing) called before `s = s[:0]`?
