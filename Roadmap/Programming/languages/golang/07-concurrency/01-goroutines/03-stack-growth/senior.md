# Goroutine Stack Growth — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Architectural Implications of Growable Stacks](#architectural-implications-of-growable-stacks)
3. [Recursion vs Iteration — When Each Wins](#recursion-vs-iteration--when-each-wins)
4. [Stack-Heavy Workloads](#stack-heavy-workloads)
5. [Designing Recursive-Descent Parsers Safely](#designing-recursive-descent-parsers-safely)
6. [Stack Cost in High-Concurrency Services](#stack-cost-in-high-concurrency-services)
7. [Stack Behaviour Across the Network Stack](#stack-behaviour-across-the-network-stack)
8. [Stacks and Cgo](#stacks-and-cgo)
9. [Stacks and Signal Handlers](#stacks-and-signal-handlers)
10. [Stack Growth and Latency Budgets](#stack-growth-and-latency-budgets)
11. [Memory Budgeting at Scale](#memory-budgeting-at-scale)
12. [Comparison with Other Runtimes](#comparison-with-other-runtimes)
13. [Summary](#summary)

---

## Introduction

At senior level the goal is to make *system-shaping* decisions with stack growth in mind. You decide whether to use recursion or iteration in a hot parser, whether to spawn a goroutine per request or use a worker pool, whether to bound user input or rely on the runtime's 1 GB ceiling. You also know the asymmetries between Go stacks and the other stacks lurking in your process: the M's system stack, the signal stack, and cgo stacks. These asymmetries matter when you wire Go into C libraries, OS signals, or extreme-concurrency network code.

This file is less about *how* growth works (covered at middle level) and more about *which architectural choices are good* given that it does.

---

## Architectural Implications of Growable Stacks

### Per-request goroutine is the canonical Go idiom

Because each goroutine costs ~2 KB initially, the dominant design pattern in Go is **one goroutine per logical unit of work**:

- One goroutine per accepted TCP connection.
- One goroutine per HTTP request.
- One goroutine per RPC handler.
- One goroutine per scheduled job.

In a thread-based language this pattern would not work — 100,000 threads each with 1 MB stacks would need 100 GB of address space. In Go it works because stacks scale with the work each goroutine does.

This single design pattern is what defines "idiomatic Go" for server code. It is *enabled by* growable stacks.

### Goroutine-per-task vs worker pool

The trade-off:

- **Goroutine-per-task** — simple, scales by spawning, each task gets its own stack. Cost: stack growth happens per task; aggregated growth shows up in pprof. Memory cost is `2 KB + peak_growth` per task.
- **Worker pool** — fixed number of goroutines that pull tasks from a channel. Each worker's stack settles to a peak after a few warmup tasks. Cost: complexity, channel contention. Memory cost is fixed.

When to use which:

- **Per-task** for I/O-bound work with hundreds to tens of thousands of concurrent operations. Latency benefits from no queueing.
- **Worker pool** for CPU-bound work, where you don't want to spawn more goroutines than CPUs. Also when each task's work is comparable in size and a long queue won't blow latency budgets.

The stack-growth angle: pools amortise growth across millions of tasks; per-task pays growth per task. For short tasks with low recursion, this rarely matters. For tasks that recurse heavily (e.g., parsing complex documents), it does.

### Avoid spawning goroutines you don't need to spawn

A common mistake at senior level is reflexively spawning a goroutine for every operation:

```go
for _, item := range items {
    go process(item)
}
```

If `items` has 10 million entries and each `process` is a millisecond of work, you have 10 million × 2 KB = 20 GB of stack memory transient. Better:

```go
const workers = runtime.GOMAXPROCS(0)
ch := make(chan Item, workers*2)
var wg sync.WaitGroup
for i := 0; i < workers; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for it := range ch {
            process(it)
        }
    }()
}
for _, it := range items {
    ch <- it
}
close(ch)
wg.Wait()
```

This caps both concurrency and stack memory.

---

## Recursion vs Iteration — When Each Wins

Growable stacks make recursion *safe* up to the 1 GB ceiling. But "safe" is not "fast."

### Recursion wins when

- **Depth is provably bounded.** Walking a balanced binary tree: depth is ~log N. A 1 million-node tree is ~20 levels deep. Recursion is clear, idiomatic, and the stack cost is trivial.
- **Code clarity matters more than performance.** Compilers, AST visitors, type-checkers. The recursive structure mirrors the data structure.
- **The recursion has visible base cases.** A reader can confirm termination.

### Iteration wins when

- **Depth depends on user input.** Anything that takes JSON, XML, regex, or user code as input is vulnerable.
- **Depth depends on data size linearly.** Walking a linked list of length N as recursion is N stack frames — wasteful.
- **Hot path performance matters.** Each recursive call pays the prologue check. A loop pays nothing comparable.
- **Tail-call structure exists.** Go does not optimise tail calls. Convert by hand.

### The "trampoline" pattern

For recursion whose depth is data-dependent but whose structure is simple, a trampoline converts it to iteration:

```go
type cont func() cont

func walk(n *node) cont {
    if n == nil {
        return nil
    }
    visit(n)
    return func() cont {
        if c := walk(n.left); c != nil {
            return c
        }
        return walk(n.right)
    }
}

func run(start cont) {
    for c := start; c != nil; c = c() {
    }
}
```

This pattern is less common in Go than in functional languages but appears in heavy-AST tooling. The cost is closure allocation per level, which goes to the heap — trading stack growth for GC pressure.

### Explicit-stack iteration

Most often, the right answer is to maintain an explicit slice as the work stack:

```go
func walk(root *node) {
    stack := []*node{root}
    for len(stack) > 0 {
        n := stack[len(stack)-1]
        stack = stack[:len(stack)-1]
        if n == nil {
            continue
        }
        visit(n)
        stack = append(stack, n.right, n.left)
    }
}
```

This puts the stack on the heap, which means:

- Growth is via slice doubling, not stack copying.
- No 1 GB ceiling — limited only by available heap memory.
- No goroutine-stack growth on the traversal.
- Heap allocation cost (mitigatable with `sync.Pool`).

For tree depths over a few thousand, this is the standard Go idiom.

---

## Stack-Heavy Workloads

Some workloads naturally stress goroutine stacks:

### Recursive descent parsers

`encoding/json`, `encoding/xml`, YAML libraries, regex engines, SQL parsers. Each level of nesting in the input is one or more stack frames.

`encoding/json` caps depth at **10,000** levels by default. Documents nested deeper return an error rather than triggering stack overflow. You should adopt the same pattern in any parser you write.

### Tree walkers

AST traversal (compilers, linters, code generators). Usually balanced enough that recursion is fine, but a degenerate input (a 10,000-deep `if x then if y then if z ...`) can blow stacks if unbounded.

### Backtracking algorithms

DFS, constraint satisfaction, game-tree search. Pure recursion grows stack linearly with search depth. For deep games (chess to depth 30), use iterative deepening with explicit stacks.

### Pattern matching

`regexp` is safe in Go because the standard library uses RE2 (no backtracking, no recursion proportional to input). But third-party regex libraries with PCRE-style backtracking can blow stacks on adversarial inputs.

### Functional-style code

Heavy higher-order combinators (map, fold, filter, monadic chains) can produce deep call chains. Less common in Go than in Haskell/Scala but appears in code ported from those languages.

---

## Designing Recursive-Descent Parsers Safely

Three patterns combine to make recursive parsers safe:

### 1. Bound depth explicitly

```go
const maxDepth = 1000

type parser struct {
    depth int
    // ...
}

func (p *parser) parseValue() (Value, error) {
    if p.depth > maxDepth {
        return nil, fmt.Errorf("nesting too deep (max %d)", maxDepth)
    }
    p.depth++
    defer func() { p.depth-- }()

    // ... actual parsing ...
}
```

The user sees a clean error; your process survives.

### 2. Lower `debug.SetMaxStack` for defence in depth

```go
import "runtime/debug"

func init() {
    debug.SetMaxStack(64 * 1024 * 1024) // 64 MB
}
```

If your depth limit fails (bug, missed code path), the process dies at 64 MB instead of 1 GB. Faster failure, less memory consumed, less impact on the rest of the host.

### 3. Iterative parsers where speed matters

A hand-written iterative JSON parser is 2–3× faster than a recursive one because it avoids the prologue check and growth on hot paths. `encoding/json/v2` and high-performance parsers like `jsoniter` and `fastjson` use iterative state machines for this reason.

For a normal application, the standard library's recursive parser is fine. For a service handling millions of small JSONs per second, switch to an iterative parser.

---

## Stack Cost in High-Concurrency Services

### The "million-connection" architecture

A server handling 1M concurrent TCP connections, one goroutine per connection, with each goroutine averaging a 4 KB stack, uses:

- 4 KB × 1,000,000 = 4 GB of stack memory.
- Plus 2 KB scheduler overhead per goroutine = 2 GB.
- Total: ~6 GB just for goroutine state.

This is reachable on commodity 16-core / 64 GB servers. With smarter pooling (read/write goroutines sharing buffers, sleep idle connections), it can be reduced further.

### The "buffer-per-goroutine" trap

A common pattern:

```go
func handleConn(c net.Conn) {
    buf := make([]byte, 64*1024) // 64 KB read buffer per connection
    for {
        n, err := c.Read(buf)
        // ...
    }
}
```

The `make` puts `buf` on the heap, but 64 KB × 1M connections = 64 GB. Plus the goroutine stack. Solutions:

- **Smaller buffer.** 4 KB or 8 KB is usually plenty.
- **Shared buffer pool.** `sync.Pool` so idle connections release the buffer.
- **`bufio.Reader` with a moderate size.** Lets you read efficiently without huge per-connection buffers.

### Choosing the right starting concurrency

Rule of thumb for typical Go services:

- **1K–10K** goroutines: no special design needed.
- **10K–100K** goroutines: pay attention to per-goroutine memory; use bufio sparingly.
- **100K–1M** goroutines: design for it — sleep idle connections, share buffers, watch StackSys.
- **>1M**: consider event-loop architecture (e.g., `gnet`, `evio`) that uses fewer goroutines + manual epoll.

The Go-native style works up to a few million on big hardware. Past that, the trade-off of one-goroutine-per-conn vs event-loop favours event loops.

---

## Stack Behaviour Across the Network Stack

When a goroutine blocks on `net.Conn.Read`, the runtime:

1. Calls the standard `read(2)` syscall (eventually).
2. The fd was set non-blocking when registered; `read` returns `EAGAIN` immediately if no data.
3. The runtime parks the goroutine on the netpoller (epoll-based on Linux).
4. The M is freed.

While the goroutine is parked, **its stack stays allocated**. The runtime cannot shrink a parked stack until GC runs and the goroutine is still in the parked state. If parked goroutines accumulate to millions, their stacks add up.

This is why `StackSys` in a million-connection server tends to hover at a few GB even when most goroutines are idle.

### Mitigation: connection pooling on the client side

A client that opens many connections and lets them idle is paying for idle goroutine stacks. Closing idle connections (e.g., `http.Transport.IdleConnTimeout`) returns those goroutines to the runtime, where they exit and free their stacks.

### Mitigation: read deadlines

A connection waiting forever on `Read` pins a goroutine forever. With a read deadline (`c.SetReadDeadline(...)`) the goroutine exits if no data arrives, freeing the stack.

---

## Stacks and Cgo

When a goroutine calls a C function via cgo:

1. The runtime switches from the goroutine's growable stack to the M's `g0` stack.
2. The C function runs on `g0` — a fixed-size, OS-allocated thread stack (typically 8 KB or larger).
3. The goroutine cannot grow its stack while in C. A deep C recursion can blow `g0`.

Implications:

- **Don't recurse deeply in C from cgo.** The fixed `g0` size limits depth.
- **Don't pass Go pointers to long-running C code.** The Go stack may move at any growth event. If C holds a pointer into a Go stack and the stack moves, the pointer dangles.

Go enforces this with `cgo.Handle` and pointer-check tooling (`GODEBUG=cgocheck=2`).

### Why two stacks?

The M's `g0` stack is used for runtime internals (scheduler, GC, signal handling). C code lives in the same "system" world. Switching to `g0` for cgo means:

- C code runs on a stack the kernel knows about.
- The Go stack-growth mechanism stays out of the way of C.
- The runtime's invariants (movable stacks, stack maps) are not violated.

### `runtime.LockOSThread` and stacks

A goroutine that calls `LockOSThread` still has its growable Go stack. The lock pins the goroutine to an M but doesn't change its stack.

---

## Stacks and Signal Handlers

When a signal (`SIGURG` for async preemption, `SIGPROF` for the CPU profiler, etc.) is delivered, the kernel switches to a separate signal stack — the M's `gsignal` stack. This is allocated at M creation, fixed size (~32 KB), and not growable.

Inside a signal handler:

- You cannot call most Go code (no allocations, no growable-stack operations).
- The Go runtime's signal handlers are written carefully to fit in 32 KB.
- User-installed signal handlers via `os/signal` package run in a normal goroutine — the runtime translates from the gsignal stack to a queued signal that a normal goroutine handles.

If you somehow ended up doing real work on `gsignal` (you would have to use cgo to install a signal handler that calls Go), you can blow it just like any fixed-size stack.

---

## Stack Growth and Latency Budgets

A stack grow event involves:

1. Allocate new stack (microseconds, hits the stack pool or the page allocator).
2. Copy bytes — for a 16 KB stack, ~3 μs on modern hardware.
3. Pointer fix-up — ~1 μs per frame, depending on number of pointer-containing slots.

Total: a single growth event is typically 5–20 μs for stack sizes up to 64 KB. Larger stacks take proportionally longer.

In a service with a 1 ms P99 latency budget, a stack grow event consumes 0.5–2% of the budget. Usually invisible. But if your request involves multiple growths (deep handler chain), it can add 50–100 μs to tail latency.

### Mitigation: warmup

In long-lived workers (e.g., a fixed pool of workers serving requests), the first few requests grow the stack; later requests don't. Some services do explicit warmup:

```go
func warmupWorker() {
    // pre-grow stack to expected peak
    var pad [32 * 1024]byte
    _ = pad
}
```

This is a niche optimisation; usually the first request's slight tail-latency hit is acceptable.

### Mitigation: per-request goroutine = always cold

If every request gets a fresh goroutine, every request pays the cold start. For latency-sensitive RPC servers handling tiny messages, switching to a worker pool can shave microseconds.

---

## Memory Budgeting at Scale

Budgeting per-goroutine memory at scale:

| Component | Cost |
|---|---|
| `g` struct | ~400 bytes |
| Initial stack | 2 KB |
| Scheduler bookkeeping | ~100 bytes |
| **Per-goroutine baseline** | **~2.5 KB** |
| Plus typical handler local vars | 1–4 KB |
| Plus handler-allocated buffers | varies |

So for an HTTP server with 100K connections and one goroutine each:

- Baseline: 2.5 KB × 100K = 250 MB
- Stacks after growth to ~4 KB average: 4 KB × 100K = 400 MB
- Application buffers: usually the dominant term

Stacks rarely dominate total memory. A service with a 10 GB RSS rarely has more than a few GB in stacks. The dominant memory cost is usually application data (caches, buffers, request bodies).

### Watching the budget

Track in production:

- `runtime.NumGoroutine()` — total goroutine count.
- `runtime.MemStats.StackInuse` — stack memory in active use.
- `runtime.MemStats.StackSys` — stack memory committed.

Alert when StackInuse exceeds an expected ceiling. A 10× growth usually indicates a leak.

---

## Comparison with Other Runtimes

### POSIX threads

Fixed stack size at creation (`pthread_attr_setstacksize`). Typically 8 MB default on Linux, 512 KB on macOS. No growth. Stack overflow crashes the process or, on some systems, segfaults.

A million pthreads = 8 TB of address space. Infeasible.

### Windows threads

Fixed at creation. Default 1 MB. Reserved virtual address space; committed lazily by the OS. Can be smaller, but no growth.

### Java threads

Backed by OS threads since the move away from green threads. Default stack 512 KB on most JVMs (`-Xss512k`). No growth. Java 21+ adds **virtual threads** (Project Loom) which *do* have growable stacks similar to goroutines.

### Erlang processes

Small stacks (typically a few hundred words), growable in segments. Erlang famously inspired the design pattern of "many lightweight processes." Garbage-collected per process, isolated address space per process.

### Async/await runtimes (Rust Tokio, JS V8, Python asyncio)

Conceptually a different model — no per-task stack at all. Each `async` function compiles to a state machine. Suspended state is a heap-allocated struct. Total memory per task is whatever the state machine occupies — often less than 2 KB.

Trade-off: code must be `async`-coloured (functions marked `async`, awaits explicit). Goroutines hide all of that behind the `go` keyword.

### Project Loom (Java)

Modern Java virtual threads use stack chunks similar to Go's segmented stacks of yore, with a twist: stacks are "thinned out" by unmounting (storing state in the heap when blocked, restoring on resume). The result is similar memory cost per virtual thread (~few KB) and similar performance to goroutines.

### Comparison summary

| Runtime | Per-task memory | Growth? | Max stack |
|---|---|---|---|
| Goroutine (Go 1.4+) | 2 KB | Yes, copying | 1 GB (settable) |
| pthread (Linux) | 8 MB default | No | Fixed at creation |
| Java thread | 512 KB | No | Fixed |
| Java virtual thread | ~few KB | Yes, segmented + heap | Heap-bounded |
| Erlang process | ~few KB | Yes, segmented | Per-VM cap |
| Rust async task | ~few hundred bytes | N/A (state machine) | Heap-bounded |
| Python asyncio task | ~few hundred bytes | N/A | Heap-bounded |

Goroutines sit in a sweet spot: synchronous, blocking-style code (no async coloring) plus low per-task memory.

---

## Summary

At senior level, stack growth becomes an *architectural input*:

- It enables the one-goroutine-per-task idiom that defines idiomatic Go.
- It does not free you from bounding recursion on untrusted input.
- It interacts with cgo (separate stack), signal handlers (separate stack), and the netpoller (parked stacks accumulate).
- It is amortised cheap but visible at the long tail of latency budgets.
- It is the reason Go is in the same conversation as Loom, Erlang, and async runtimes.

The professional level walks the runtime source — `morestack`, `newstack`, `stackalloc`, `copystack` — and details the pointer fix-up via stack maps.
