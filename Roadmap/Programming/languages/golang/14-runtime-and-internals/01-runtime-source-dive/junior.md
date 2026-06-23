# Runtime Source Dive — Junior

## 1. What is "the Go runtime"?

When you write `go run main.go`, your program isn't just the lines you typed. Two other things are stitched into the final binary:

1. **The Go standard library** — `fmt`, `os`, `net/http`, etc.
2. **The Go runtime** — a chunk of Go (plus a sprinkle of assembly) that manages goroutines, channels, memory, garbage collection, panics, and the bridge to the operating system.

The runtime is the layer that makes Go *feel* like Go. `go func() { ... }()` is just three tokens for you, but behind that the runtime spins up a tiny stack, hands it to a scheduler, and parks an OS thread waiting for work. None of that is your code — it's `runtime` code, shipped with every Go binary.

> If you came from C, the runtime is what C doesn't have. If you came from Java, it's the JVM — except statically linked into the executable instead of installed separately.

---

## 2. Where the source lives

On your machine, the runtime source is inside the Go installation directory:

```bash
go env GOROOT
# e.g., /usr/local/go
ls $(go env GOROOT)/src/runtime
```

You'll see hundreds of `.go` and `.s` (assembly) files. The headline ones:

| File | What it covers |
|------|----------------|
| `proc.go` | The scheduler — goroutines, M, P, G |
| `chan.go` | Channel send/recv/close |
| `mheap.go`, `malloc.go` | Memory allocator |
| `mgc.go`, `mgcsweep.go` | Garbage collector |
| `panic.go` | `panic`, `recover`, `defer` |
| `slice.go`, `map.go` | Built-in data structures |
| `select.go` | `select` statement |
| `stack.go` | Goroutine stack growth |
| `time.go` | Timers, `time.Sleep` |

The same code is on GitHub at `github.com/golang/go/tree/master/src/runtime`. Pin to a tag (e.g., `go1.22.0`) when you read — internals shift between versions.

---

## 3. Prerequisites

- Comfort with basic Go: goroutines, channels, slices, maps.
- A vague sense that "things must happen behind the scenes" when you write `go f()`.
- Willingness to read Go that *looks* normal but uses internal helpers (`mcall`, `gopark`, `systemstack`).

You do **not** need assembly, OS internals, or compiler theory yet — those come in `senior.md` and `professional.md`.

---

## 4. Glossary

| Term | Meaning |
|------|---------|
| **Runtime** | The Go code (and a bit of asm) embedded in every Go binary that runs goroutines, allocates memory, runs the GC |
| **GOROOT** | The directory where Go is installed; `$GOROOT/src/runtime` holds the source |
| **GMP** | Three runtime types: **G**oroutine, **M**achine (OS thread), **P**rocessor (logical CPU slot) |
| **goroutine** | A user-space thread managed by the runtime, not the OS |
| **scheduler** | The piece of the runtime that picks which goroutine runs on which M |
| **mcall** | A switch from a goroutine's stack to a special "scheduler" stack |
| **gopark / goready** | Park a goroutine (off the run queue); make it runnable again |
| **systemstack** | Run code on the OS-allocated stack instead of the goroutine stack |
| **GC** | Garbage collector — concurrent, tri-color mark-and-sweep |

---

## 5. Why read runtime source at all?

Most Go programmers never open `runtime/proc.go`. They don't need to — Go's whole point is that the runtime is invisible. So why bother?

- **You will hit a bug that's runtime-shaped.** Goroutine leak. Deadlock you can't reproduce. Surprising allocation. The fix is usually in your code, but understanding the *symptom* requires runtime knowledge.
- **You will hit a performance question.** "Why does this make 20M allocations?" "Why is GC pause 8ms?" Profilers (`pprof`, `trace`) speak in runtime terms.
- **It demystifies Go.** Goroutines aren't magic. Channels aren't magic. They're datastructures and algorithms — readable Go code. Once you've seen `runqget` in `proc.go`, "goroutines are lightweight threads" becomes "goroutines are entries in a per-P queue with an atomic head/tail".

You don't have to read all of it. You don't even have to understand half of it. The goal at this level is to know the *map* — what file does what — and to be able to open one and orient yourself.

---

## 6. A 30-second tour of `proc.go`

`proc.go` is the biggest file in the runtime (~6000+ lines). It owns the scheduler. The headline functions:

```go
// Schedule a new goroutine. This is what `go f()` compiles to.
func newproc(fn *funcval)

// The main scheduling loop. Picks a runnable goroutine and runs it.
func schedule()

// Park the current goroutine — take it off the run queue.
func gopark(unlockf func(*g, unsafe.Pointer) bool, ...)

// Mark a goroutine as runnable again.
func goready(gp *g, traceskip int)
```

You don't run these from your code. They're called by:
- The compiler (rewrites `go f()` into a `newproc` call).
- Channel operations (`gopark` blocks the sender; `goready` wakes the receiver).
- The network poller (`gopark` blocks on `Read`; `goready` wakes when an `epoll` event fires).

This is the "everything is just function calls" insight — there's no magic thread suspension. Blocked goroutines call `gopark` and the scheduler picks something else.

---

## 7. The G, M, P types

In `runtime2.go` you'll find the three structs that the scheduler revolves around:

```go
type g struct {
    stack       stack    // stack range for this goroutine
    sched       gobuf    // saved registers (PC, SP) when parked
    atomicstatus atomic.Uint32 // _Gidle, _Grunnable, _Grunning, _Gwaiting, ...
    // ... ~100 more fields
}

type m struct {
    g0     *g       // a special "system" goroutine for scheduling work
    curg   *g       // the goroutine currently running on this M
    p      puintptr // the P this M is bound to
    // ... lots more
}

type p struct {
    runq      [256]guintptr // local run queue
    runnext   guintptr      // priority slot
    // ... more queues, caches, stats
}
```

- **G** = one goroutine. Cheap (KBs of memory). Many millions can exist.
- **M** = an OS thread. Created lazily, capped by `GOMAXPROCS` + blocked syscalls.
- **P** = "permission to run Go code". One P per logical CPU you've asked for (default = `runtime.NumCPU()`).

A G runs on an M, but only if that M holds a P. No P, no Go code — that's how `GOMAXPROCS` caps parallelism.

---

## 8. How to start exploring (a recipe)

1. **`go env GOROOT`** — find the source.
2. Open `runtime/proc.go` in your editor with "Go to definition" enabled.
3. Search for `func schedule(` — that's the entry to the scheduler loop. Read 40 lines top-to-bottom; don't try to understand every branch.
4. Follow one call: `findRunnable` (where does a goroutine come from?).
5. Step away. Come back tomorrow.

Reading runtime code is a marathon, not a sprint. The first time you skim `schedule()` it's a wall of names you've never heard (`stopm`, `pidleget`, `wakep`). The third time, the names mean things.

> **Cheat code:** start with the commit history of `runtime/proc.go`. Many commits link to design proposals on the Go issue tracker. A 10-line change with a linked proposal often explains a 500-line region of code you'd never decode by reading.

---

## 9. The "go runtime" you can actually call

The exported `runtime` package (the one you `import "runtime"` in your code) is the *tip of the iceberg*. Useful functions for junior-level exploration:

```go
import "runtime"

// How many goroutines exist right now?
runtime.NumGoroutine()

// How many CPUs is Go allowed to use?
runtime.GOMAXPROCS(0) // 0 means "just tell me, don't change it"

// Force a garbage collection. Useful in tests, not in production code.
runtime.GC()

// Read memory stats.
var m runtime.MemStats
runtime.ReadMemStats(&m)
fmt.Println("alloc:", m.Alloc, "heap objects:", m.HeapObjects)
```

These are thin wrappers over the *unexported* internals (`gcount`, `gcStart`, `readmemstats_m`). Reading the runtime source connects the exported API to what's actually happening.

---

## 10. A tiny example that touches the runtime

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            fmt.Printf("goroutine %d, total now: %d\n", id, runtime.NumGoroutine())
        }(i)
    }
    wg.Wait()
    fmt.Println("done, goroutines:", runtime.NumGoroutine())
}
```

Each `go func(...)` calls `runtime.newproc` under the hood. `NumGoroutine()` reads `sched.gcount`. `sync.WaitGroup.Wait()` ends up in `runtime_Semacquire` — a runtime hook that `sync` uses to block efficiently.

You don't see any of those calls in your code. They're hidden by the compiler and the standard library. Reading runtime source is how you make them visible.

---

## 11. Common confusion at this level

- **"Goroutines are OS threads." No.** A goroutine is `runtime.g`, a struct. Many goroutines run on one OS thread (`m`).
- **"`runtime.Gosched()` is `sleep(0)`." Kind of, but it specifically calls `gosched_m` to swap to the scheduler — not "be polite to the OS".
- **"The runtime is C." Mostly Go.** A few low-level files (`asm_amd64.s`, `sys_linux_amd64.s`) are assembly. The interesting algorithms (scheduler, GC, allocator) are in Go.
- **"The runtime is huge." It's ~50,000 lines.** Big but readable. The Linux kernel scheduler is 10× that.
- **"Channels use a mutex." Yes, internally.** `runtime/chan.go` has a `hchan` struct with a `lock`. The optimization story is in `senior.md`.

---

## 12. The map you should leave with

```
$GOROOT/src/runtime/
├── proc.go         # Scheduler: GMP, newproc, schedule, gopark
├── runtime2.go     # Type definitions for G, M, P
├── chan.go         # Channels (hchan, send, recv)
├── select.go       # select
├── mheap.go        # Heap arena management
├── malloc.go       # mallocgc — the main allocation function
├── mgc.go          # Garbage collector entry points
├── stack.go        # Goroutine stack growth
├── panic.go        # panic / recover / defer
├── time.go         # Timers
├── netpoll.go      # Network poller (epoll/kqueue/iocp)
├── sema.go         # Semaphore primitive (used by sync.Mutex etc.)
└── asm_*.s         # Architecture-specific assembly
```

If you can name these and roughly say what each does, you've achieved the junior-level goal of this topic.

---

## 13. Summary

The Go runtime is a chunk of Go (and a bit of assembly) embedded into every Go binary. It lives in `$GOROOT/src/runtime`. It runs goroutines (`proc.go`), manages channels (`chan.go`), allocates memory (`malloc.go`, `mheap.go`), and garbage-collects it (`mgc.go`). At this level the goal is not to *understand* it — it's to know the *map*, recognize the names, and lose the fear of opening the source. Tomorrow, open `proc.go` and read `func schedule(`. Don't try to finish it. Just look.

---

## Further reading
- Go source: `https://github.com/golang/go/tree/master/src/runtime` (pin to a tag like `go1.22.0`)
- "The Go scheduler" — Daniel Morsing, 2013 — short and still accurate on the basics
- "Scalable Go Scheduler Design Doc" — Dmitry Vyukov, 2012 — the proposal that introduced P
- `runtime` package docs: `https://pkg.go.dev/runtime`
- "Go's work-stealing scheduler" — Jaana Dogan blog
