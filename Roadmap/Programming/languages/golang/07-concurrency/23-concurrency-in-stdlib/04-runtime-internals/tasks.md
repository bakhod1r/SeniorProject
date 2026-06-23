---
layout: default
title: Runtime Internals — Tasks
parent: Runtime Internals Used by Stdlib
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/04-runtime-internals/tasks/
---

# Runtime Internals Used by Stdlib — Tasks

[← Back](../)

> Hands-on exercises. Each task has a goal, starter code or scaffold, success criteria, and hints. Solutions are intentionally left out — the discovery is the lesson.

---

## Task 1 — Build a dedicated cgo worker with `LockOSThread` (junior)

**Goal.** Implement a worker goroutine pinned to one OS thread that serves cgo requests through a channel.

**Starter.**
```go
package main

/*
#include <pthread.h>
// returns the current pthread id, distinct per OS thread.
unsigned long my_tid(void) { return (unsigned long)pthread_self(); }
*/
import "C"

import (
	"fmt"
	"runtime"
	"sync"
)

type request struct {
	respond chan uint64
}

func cWorker(reqs <-chan request) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	for r := range reqs {
		r.respond <- uint64(C.my_tid())
	}
}

func main() {
	reqs := make(chan request)
	go cWorker(reqs)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp := make(chan uint64)
			reqs <- request{respond: resp}
			fmt.Println("tid:", <-resp)
		}()
	}
	wg.Wait()
	close(reqs)
}
```

**Success.** Every printed `tid:` is identical (same OS thread).

**Hint.** Remove `runtime.LockOSThread()` and re-run; the tids may differ.

---

## Task 2 — Detect a deadlock with the block profile (middle)

**Goal.** Capture a block profile of a contended program and identify the offending stack.

**Starter.**
```go
package main

import (
	"net/http"
	_ "net/http/pprof"
	"runtime"
	"sync"
)

var (
	muA, muB sync.Mutex
)

func goroutineAB() {
	muA.Lock()
	muB.Lock() // race for AB-order
	muB.Unlock()
	muA.Unlock()
}

func goroutineBA() {
	muB.Lock()
	muA.Lock() // race for BA-order
	muA.Unlock()
	muB.Unlock()
}

func main() {
	runtime.SetBlockProfileRate(1)
	go func() { http.ListenAndServe(":6060", nil) }()
	for {
		go goroutineAB()
		go goroutineBA()
	}
}
```

**Steps.**
1. Run the program.
2. In another shell: `go tool pprof http://localhost:6060/debug/pprof/block`.
3. `top` and `list goroutineAB` / `list goroutineBA`.

**Success.** Profile shows long blocking time on `sync.(*Mutex).Lock`. Cause: lock order inversion (AB vs BA).

**Hint.** A real deadlock would freeze the program; here the workload self-relieves because each goroutine eventually wins. Convert to true deadlock by ordering more carefully.

---

## Task 3 — Dump all goroutines on `SIGUSR1` (middle)

**Goal.** Install a signal handler that prints all goroutine stacks to stderr when the process receives `SIGUSR1`.

**Starter.**
```go
package main

import (
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"syscall"
)

func main() {
	c := make(chan os.Signal, 1)
	signal.Notify(c, syscall.SIGUSR1)
	go func() {
		for range c {
			buf := make([]byte, 1<<20)
			n := runtime.Stack(buf, true)
			fmt.Fprintf(os.Stderr, "=== goroutines ===\n%s\n", buf[:n])
		}
	}()

	// dummy workload
	select {}
}
```

**Steps.**
1. `go run task3.go &`
2. `kill -USR1 $!`
3. Observe stack dump.

**Success.** All goroutine stacks (at least main, signal handler, and any background goroutines) are printed.

**Hint.** Note that the dump takes a STW pause; do not call this in a hot signal loop.

---

## Task 4 — Verify `runtime.Pinner` semantics (senior)

**Goal.** Demonstrate that without `Pinner`, the GC can relocate a Go object, and that `Pinner` prevents this.

**Starter.**
```go
package main

import (
	"fmt"
	"runtime"
	"unsafe"
)

func addr(b []byte) uintptr { return uintptr(unsafe.Pointer(&b[0])) }

func main() {
	b := make([]byte, 16)
	for i := range b {
		b[i] = 0xFF
	}
	before := addr(b)
	for i := 0; i < 5; i++ {
		runtime.GC()
	}
	after := addr(b)
	fmt.Printf("without Pinner: before=%x after=%x same=%v\n", before, after, before == after)

	c := make([]byte, 16)
	var pin runtime.Pinner
	pin.Pin(&c[0])
	defer pin.Unpin()
	before = addr(c)
	for i := 0; i < 5; i++ {
		runtime.GC()
	}
	after = addr(c)
	fmt.Printf("with Pinner:    before=%x after=%x same=%v\n", before, after, before == after)
}
```

**Success.** With `Pinner`, addresses match across GC cycles. Without `Pinner` they often match too (Go's GC is mostly non-moving), but `Pinner` *guarantees* it.

**Hint.** Stack allocations may move when the stack grows; heap-allocated slices generally do not move in current Go but the language does not guarantee non-moving GC forever.

---

## Task 5 — Trace channel block events (senior)

**Goal.** Use `runtime/trace` to visualise goroutine blocking on channel operations.

**Starter.**
```go
package main

import (
	"os"
	"runtime/trace"
	"sync"
)

func main() {
	f, _ := os.Create("trace.out")
	defer f.Close()
	trace.Start(f)
	defer trace.Stop()

	ch := make(chan int)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			ch <- id
		}(i)
	}
	for i := 0; i < 4; i++ {
		<-ch
	}
	wg.Wait()
}
```

**Steps.**
1. `go run task5.go`
2. `go tool trace trace.out`
3. Open the trace viewer; look for `Goroutine analysis` and `Network blocking profile`.

**Success.** Each goroutine's lifeline shows `chan send` block intervals.

---

## Task 6 — Implement a finalizer-based leak warner (middle)

**Goal.** Implement a `Resource` type that warns once if it is GC'd without `Close` being called.

**Starter.**
```go
package main

import (
	"fmt"
	"runtime"
	"sync/atomic"
)

type Resource struct {
	id     int
	closed atomic.Bool
}

func NewResource(id int) *Resource {
	r := &Resource{id: id}
	runtime.SetFinalizer(r, (*Resource).warn)
	return r
}

func (r *Resource) warn() {
	if !r.closed.Load() {
		fmt.Printf("LEAK: Resource %d not closed\n", r.id)
	}
}

func (r *Resource) Close() {
	r.closed.Store(true)
	runtime.SetFinalizer(r, nil)
}

func main() {
	good := NewResource(1)
	good.Close()
	_ = good

	_ = NewResource(2) // intentionally leaked

	runtime.GC()
	runtime.GC()
}
```

**Success.** Output: `LEAK: Resource 2 not closed`.

**Hint.** Notice that the finalizer takes `*Resource` as a parameter — never closes over the variable.

---

## Task 7 — Measure netpoll latency (senior)

**Goal.** Measure how long it takes from a TCP packet arriving on a fd to a Go goroutine waking up.

**Starter (idea).**
1. Open a listening socket.
2. Have one goroutine `Accept` and `Read`; record `time.Now()` upon return.
3. Another goroutine `Dial`s and `Write`s a single byte; record `time.Now()` immediately before `Write`.
4. Compare timestamps.

**Success.** Median delta in the low microseconds (5-50 us on a local socket).

**Hint.** The Go runtime polls the netpoller at every scheduler tick plus when sysmon runs. With light load it is fast; with all Ps busy on CPU it may be milliseconds.

---

## Task 8 — Reproduce a `Gosched`-induced delay (middle)

**Goal.** Show that `Gosched` can defer a goroutine by a measurable amount under high load.

**Starter.**
```go
package main

import (
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

func main() {
	runtime.GOMAXPROCS(2)
	var done atomic.Bool
	var wg sync.WaitGroup

	// CPU-burner
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for !done.Load() {
				// burn
			}
		}()
	}

	start := time.Now()
	for i := 0; i < 1000; i++ {
		runtime.Gosched()
	}
	fmt.Println("1000 Goscheds took:", time.Since(start))

	done.Store(true)
	wg.Wait()
}
```

**Success.** With heavy contention, each `Gosched` takes longer than with no other goroutines.

---

## Task 9 — Compare `sync.Mutex` and `runtime.lock` semantics by reading source (senior)

**Goal.** Read both implementations and write a 200-word comparison.

**Files to read.**
- `src/sync/mutex.go` (public mutex)
- `src/runtime/lock_futex.go` (Linux runtime lock)
- `src/runtime/lock_sema.go` (macOS/BSD runtime lock)
- `src/runtime/sema.go` (semaphore backing `sync.Mutex`)

**Questions to answer.**
- Why does `runtime.lock` not use `sudog`?
- How does the futex implementation handle a contended unlock?
- Why is the spin loop count different in each?

**Success.** A short essay explaining the layering.

---

## Task 10 — Build a per-goroutine ID using `runtime.Stack` parsing (advanced)

**Goal.** Extract the current goroutine's id from `runtime.Stack` output (educational only — do not use in production).

**Starter.**
```go
package main

import (
	"bytes"
	"runtime"
	"strconv"
	"strings"
)

func goid() uint64 {
	b := make([]byte, 64)
	b = b[:runtime.Stack(b, false)]
	b = bytes.TrimPrefix(b, []byte("goroutine "))
	idEnd := bytes.IndexByte(b, ' ')
	id, _ := strconv.ParseUint(string(b[:idEnd]), 10, 64)
	_ = strings.Index // silence import; remove
	return id
}

func main() {
	println("goid:", goid())
}
```

**Success.** Prints a small integer.

**Warning.** Do not actually use this. `runtime.Stack` is expensive, and goids may be re-used. This task exists only to show how brittle goid tracking is.

---

## Task 11 — Measure block-profile overhead (professional)

**Goal.** Quantify the runtime cost of `SetBlockProfileRate(1)` on a contention-heavy workload.

**Steps.**
1. Run a benchmark with mutex contention; record ns/op.
2. Run the same benchmark with `runtime.SetBlockProfileRate(1)` in `init`.
3. Compare.

**Success.** Reproduce the well-known 5-15% slowdown.

---

## Task 12 — Force preemption with `runtime.Gosched` vs async preemption (senior)

**Goal.** Show that on Go 1.14+, a tight loop without function calls is preempted by signal-based async preemption.

**Starter.**
```go
package main

import (
	"runtime"
	"time"
)

func tight() {
	for {
		// no function call!
	}
}

func main() {
	runtime.GOMAXPROCS(1)
	go tight()
	time.Sleep(100 * time.Millisecond)
	// did main get CPU?
	println("alive")
}
```

**Success.** On Go 1.14+: prints "alive". On Go 1.13 or with `GODEBUG=asyncpreemptoff=1`: hangs.

---

## Task 13 — Reproduce a finalizer queue stall (advanced)

**Goal.** Show that a slow finalizer blocks all subsequent finalizers because they share one goroutine.

**Starter.**
```go
package main

import (
	"runtime"
	"time"
)

type slow struct{ id int }
type fast struct{ id int }

func main() {
	for i := 0; i < 5; i++ {
		s := &slow{id: i}
		runtime.SetFinalizer(s, func(p *slow) {
			println("slow start", p.id)
			time.Sleep(2 * time.Second)
			println("slow done", p.id)
		})
	}
	for i := 0; i < 5; i++ {
		f := &fast{id: i}
		runtime.SetFinalizer(f, func(p *fast) {
			println("fast", p.id)
		})
	}

	runtime.GC()
	time.Sleep(15 * time.Second)
}
```

**Success.** Output interleaves "slow start", waits 2 s each, then "slow done" before any "fast" runs.

**Lesson.** Finalizers are sequential; never block.

---

## Task 14 — Configure `GOMEMLIMIT` and observe GC behaviour (professional)

**Goal.** See how GOMEMLIMIT changes GC frequency.

**Steps.**
1. Write a program that allocates 100 MB / sec.
2. Run with `GODEBUG=gctrace=1 GOMEMLIMIT=200MiB`.
3. Run again with `GOMEMLIMIT=2GiB`.
4. Compare GC frequency.

**Success.** Fewer GC cycles under the larger limit; higher steady-state memory.

---

## Task 15 — Capture a goroutine dump on panic (professional)

**Goal.** Install a panic handler that dumps all goroutines before re-panicking.

**Starter.**
```go
func recoverAndDump() {
	if r := recover(); r != nil {
		buf := make([]byte, 1<<20)
		n := runtime.Stack(buf, true)
		fmt.Fprintf(os.Stderr, "panic: %v\n%s\n", r, buf[:n])
		panic(r)
	}
}

func worker() {
	defer recoverAndDump()
	// ... work
}
```

**Success.** On a forced panic, you see all goroutines.

**Hint.** The Go runtime already does this for unrecovered panics; this is for cases where you want to log before deferring to the default handler.

---

## Solutions and discussion

Solutions are deliberately not given. The skills you build by struggling through:
- reading runtime source,
- using `pprof` to find primitives in flight,
- reading `GODEBUG` output,

are exactly the skills you need when something goes wrong in production. Pair this file with `senior.md` and `professional.md` and revisit after each project.
