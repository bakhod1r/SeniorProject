# Scheduler Source — Junior

## 1. What is a scheduler?

A scheduler is a piece of software that decides *which unit of work runs next*. Pick any system where many things want to run on fewer CPUs than there are things, and somebody, somewhere, is making that call. The OS scheduler decides which process gets a CPU slice. The Linux CFS picks the next thread. A web server's worker pool decides which request a worker picks up.

Schedulers come in two big flavors:

- **Pre-emptive.** The scheduler can yank work mid-execution. You don't get a choice — your time slice expires, a timer interrupt fires, and you're off the CPU. This is what your OS does to your processes.
- **Cooperative.** Work only yields when it *asks to*. If a task spins in a tight loop without yielding, nothing else runs. Old Mac OS 9 was like this. Early goroutines were too.

Go has its own scheduler — a user-space one, baked into the runtime, that schedules **goroutines** onto OS threads. Since Go 1.14 it's mostly **pre-emptive** (the runtime can interrupt a tight loop via a signal), but most of the day-to-day yielding is cooperative — at function calls, channel ops, system calls, allocations.

---

## 2. Why does Go have its own scheduler?

A reasonable question: the OS already has a perfectly good scheduler. Why not just use OS threads?

- **OS threads are expensive.** Each one has a megabyte-ish stack and a kernel-side struct. Creating a hundred thousand is realistic on a server; creating a hundred million is not.
- **OS thread switches are expensive.** A context switch crosses into the kernel, saves a lot of state, flushes some caches. A goroutine switch is a function call into Go that swaps a few registers.
- **The OS doesn't know what your program is doing.** It can't say "this thread is waiting on a channel, so wake that other goroutine instead". The Go runtime *does* know that.

So Go runs *many* goroutines on a *few* OS threads. A goroutine costs a few KB of stack at birth (grown on demand) and a fast switch. You can have a million live goroutines on a laptop without the OS noticing. That number with OS threads would melt the machine.

---

## 3. Prerequisites
- You've read `01-runtime-source-dive` — you know what G, M, P are and where the runtime source lives.
- Basic Go: `go f()`, channels, `select`.
- `GOMAXPROCS` rings a bell as "the number of CPUs Go uses".

---

## 4. Glossary

| Term | Meaning |
|------|---------|
| **GMP** | The scheduler's three-actor model: **G**oroutine, **M**achine (OS thread), **P**rocessor (logical slot) |
| **Run queue** | A queue of runnable G's waiting for a P |
| **Local runq** | A P's own queue — 256 entries, lock-free for the owning P |
| **Global runq** | A shared queue protected by a mutex; overflow + special cases |
| **runnext** | A single-G "priority" slot on each P |
| **Park** | Take a G off the run queue (it's blocked, sleeping, waiting) |
| **Ready** | Mark a G runnable again, push it back onto a runq |
| **Work stealing** | An idle P grabs work from a busy P's local runq |

---

## 5. Quick GMP recap (just enough to follow along)

Already covered in 01, so the short version:

- **G** — one goroutine. A struct. ~2 KB stack at birth.
- **M** — one OS thread. The thing the kernel actually schedules on a CPU.
- **P** — one "permission to run Go code". There are exactly `GOMAXPROCS` of them, period.

A G runs *on* an M *only if* that M holds a P. No P, no Go code. P is the bottleneck the scheduler manages.

What the scheduler **does** with these three things is the rest of this file.

---

## 6. The two run queues

Every P has a **local run queue**: a fixed-size ring buffer of runnable G's. In `runtime/runtime2.go`:

```go
type p struct {
    runqhead uint32
    runqtail uint32
    runq     [256]guintptr // local run queue, fixed size
    runnext  guintptr      // priority slot
    // ...
}
```

256 entries. Why 256? Big enough to avoid constant overflow, small enough to fit in cache and stay lock-free. The owning P pushes and pops from it without taking any lock — it's the whole reason Go scheduling is fast.

When the local runq is *full*, half of it is bulk-moved to the **global run queue** (`sched.runq`), which lives on the central `schedt` struct and is protected by a mutex. The global runq is where overflow goes, where newly-created G's sometimes land, and where idle P's check after their own queue is empty.

The shape of "scheduler is fast" is: local queue almost always has work, so almost nothing touches the global lock.

---

## 7. The runnext slot

There's one more place a G can live on a P: **runnext**. A single pointer-sized slot, separate from the 256-entry queue. It holds the goroutine that should run *immediately next* on this P.

When goroutine A does `go B()`, the new G `B` typically gets dropped into A's P's `runnext` — not the runq tail. Why? Because A just spawned B, often A is about to send B a message on a channel and wait, or do nothing useful itself. Running B *next* preserves locality and tends to keep producer-consumer patterns hot in cache.

If `runnext` was already occupied, the previous occupant is bumped down into the regular runq. So the slot is more like a "freshest job, jump the queue" lane.

---

## 8. The life of a goroutine

Walk through the states a goroutine passes through:

```
       go f()               schedule picks it
[ created ] ─── newproc ──> [ runnable ] ─────────────> [ running ]
                                ^                            │
                                │                            │
                                │    goready                 │ ch <-, mu.Lock(),
                                │  (someone wakes it)        │ ctx, syscall, ...
                                │                            ▼
                                └─────────── [ waiting ] <── gopark
                                                              │
                                                              │ goexit
                                                              ▼
                                                          [ dead ]
```

- **Created.** `go f()` is rewritten by the compiler into `runtime.newproc(&f)`. That allocates a G (or reuses one from a free list), copies the arguments to its tiny stack, and pushes it onto the current P (into `runnext`, or the local runq, or sometimes the global one).
- **Runnable.** The G is sitting in some runq, waiting for a P to pick it up. Status `_Grunnable`.
- **Running.** A P picked it. It's executing on an M. Status `_Grunning`.
- **Waiting.** It called something that blocks — channel send/recv on an empty/full channel, mutex contention, `time.Sleep`, network read. Under the hood that bottoms out in `gopark`, which sets the G to `_Gwaiting` and tells the scheduler "find something else, here's why I'm sleeping".
- **Runnable again.** When the wait condition fires (channel sent, mutex released, timer expired, epoll said the socket is readable), `goready` is called. The G goes back into a runq.
- **Dead.** Function returns → `goexit` runs → the G is recycled to a free list.

The whole point of the scheduler is to keep all P's running G's in the "running" box, by constantly pulling new ones from the "runnable" box and pushing blocked ones into the "waiting" box.

---

## 9. How `go f()` enters the scheduler

This one line:

```go
go DoWork()
```

is compiled by the Go compiler into roughly:

```go
runtime.newproc(funcval(DoWork))
```

`newproc` (in `runtime/proc.go`) does, very roughly:

1. Allocate a new G (or grab one from the per-P free list `pp.gFree`).
2. Copy `DoWork` and its captured arguments onto the new G's stack.
3. Set the G's status to `_Grunnable`.
4. Push the G onto the current P. By default this goes into `runnext`. If `runnext` was full, the displaced G goes onto the local runq. If the local runq is full, half of it spills into the global runq.

Notice what *didn't* happen: no OS thread was created. No system call. The whole thing is a few dozen instructions of pure user-space Go and atomic operations. That's why "just spawn another goroutine" is the right answer to so many Go problems — it's almost free.

---

## 10. The scheduler loop

The heart of `proc.go` is `schedule()`. The structure of it (heavily simplified):

```go
func schedule() {
    mp := getg().m
    // 1. Find a runnable G.
    gp, inheritTime := findRunnable()
    // 2. Run it.
    execute(gp, inheritTime)
    // execute() never returns — it jumps into the G.
}
```

`findRunnable()` is where the action lives. It tries, roughly in order:

1. **Local runnext** — is there a freshly-spawned G waiting on this P?
2. **Local runq** — pop one off the front.
3. **Global runq** — grab a batch (so we don't keep coming back).
4. **Network poller** — any goroutines whose I/O just completed?
5. **Work stealing** — pick another P at random, steal half of its local runq.
6. **Park the M** — give up, no work anywhere; the M goes to sleep.

The "steal half" rule is what makes the scheduler self-balancing. If P0 has 200 G's queued and P1 has 0, P1 won't sit idle — it'll steal 100 of them and run them in parallel. No central coordinator, no per-G load balancer — just "if you're hungry, raid the fridge of whoever's nearest".

---

## 11. `runtime.Gosched()` — voluntary yield

The simplest way to interact with the scheduler from your own code:

```go
import "runtime"

for i := 0; i < bigNumber; i++ {
    doSomeWork(i)
    if i % 1000 == 0 {
        runtime.Gosched() // be polite — let other goroutines run
    }
}
```

`Gosched()` says "I'm not done, but pause me, put me at the back of the runnable line, run someone else for a bit". Internally it calls `mcall(gosched_m)` which moves the current G out of `_Grunning`, pushes it to the global runq, and re-enters `schedule()` to pick the next G.

It's almost never needed in modern Go. Since 1.14, the scheduler can pre-empt CPU-bound loops on its own using a signal-based mechanism. But it's still useful when you want predictable yield points in benchmarks, demos, or tight low-level code.

---

## 12. `GOMAXPROCS`

```go
import "runtime"

fmt.Println(runtime.GOMAXPROCS(0)) // 0 means "read, don't set"
```

`GOMAXPROCS` is the number of **P's** the runtime creates. By default it's `runtime.NumCPU()` — every logical CPU gets its own P. That's the cap on how many goroutines can be executing Go code *in parallel* on this process.

If you set `GOMAXPROCS=1`, you've serialized all your Go code onto one CPU, period — no parallelism, only concurrency. (Goroutines still interleave, but only one runs at a time.) Useful for debugging races, terrible for throughput.

Note the gotcha: `GOMAXPROCS` is the number of **P's**, not **M's**. Go can have more M's than P's (extra threads to handle blocked syscalls), but only `GOMAXPROCS` M's can hold a P at any moment, so only that many goroutines can be running Go code at once.

In a container with CPU limits, the default `runtime.NumCPU()` reads the host's CPU count, not the cgroup limit. That's why production Go on Kubernetes often pins `GOMAXPROCS` to the actual CPU quota (libraries like `uber-go/automaxprocs` do this automatically). Worth knowing.

---

## 13. Where this all lives in source

You don't need to memorize line numbers, but you should know which file owns which concept:

| File | What lives there |
|------|------------------|
| `runtime/proc.go` | `schedule`, `findRunnable`, `newproc`, `gopark`, `goready`, `runqput`, `runqget`, work stealing |
| `runtime/runtime2.go` | The `g`, `m`, `p`, and `schedt` struct definitions |
| `runtime/asm_amd64.s` (and friends) | The actual register-level G ↔ M context switch — `gogo`, `mcall`, `systemstack` |
| `runtime/preempt.go` | Pre-emption signaling (Go 1.14+) |
| `runtime/netpoll.go` | The netpoller — how blocked-on-I/O G's become runnable again |

If you only ever open one file for scheduling, it's `proc.go`. Start at `func schedule(` and scroll.

---

## 14. Observing the scheduler — `schedtrace`

Go has a built-in environment variable that makes the scheduler periodically print its state:

```bash
GODEBUG=schedtrace=1000 ./your-program
```

Every 1000ms (the number is milliseconds), it prints one line like:

```
SCHED 1004ms: gomaxprocs=8 idleprocs=5 threads=11 spinningthreads=1 idlethreads=4 runqueue=0 [0 0 0 0 0 0 0 0]
```

Reading it:

- `gomaxprocs=8` — there are 8 P's.
- `idleprocs=5` — 5 of them are sitting idle (no work).
- `threads=11` — 11 OS threads exist (M's).
- `runqueue=0` — global runq is empty.
- `[0 0 0 0 0 0 0 0]` — the local runq length on each P. All zero here.

Run a CPU-burning program and you'll see the local runqs fill up. Run a network-heavy program and you'll see `idleprocs` and `idlethreads` move in sync with load. It's the cheapest possible scheduler observability — no profiler, no instrumentation.

For more detail there's `GODEBUG=scheddetail=1` (very verbose, one block per G), and for serious work the execution tracer (`runtime/trace`, `go tool trace`) — but `schedtrace=1000` is the friendly entry point.

---

## 15. Common confusion at this level

- **"Goroutines have their own OS thread." No.** Many goroutines share a small number of OS threads. That's the whole point.
- **"`runtime.Gosched()` makes my code faster." Almost never.** Yielding doesn't add CPU. It just changes who runs next. Most of the time it does nothing useful.
- **"`GOMAXPROCS` limits the number of goroutines." No.** It limits parallel *Go code execution*. You can have a million goroutines with `GOMAXPROCS=1`; they'll just take turns.
- **"A blocked syscall blocks the whole program." No.** When a goroutine enters a blocking syscall, its M detaches from the P, and the P is handed to another M to keep running other goroutines. The syscall returns later and its M tries to grab a P back.
- **"Channels are scheduler primitives." Kind of.** Channel send/recv on an empty/full channel calls `gopark`. The waker side calls `goready`. So channels are *implemented on top of* the scheduler's park/ready mechanism, not magic.
- **"Work stealing means goroutines move around all the time." No — only when a P runs dry.** A hot, balanced workload barely steals at all.

---

## 16. Summary

The Go scheduler is a user-space scheduler in `runtime/proc.go` that maps many goroutines (G's) onto a small number of OS threads (M's), gated by `GOMAXPROCS` "permission slots" (P's). Each P has a 256-entry local runq, a one-slot `runnext` priority lane, and a shared global runq for overflow. `go f()` becomes `newproc`, which puts the new G on the current P. Blocking calls park the G via `gopark`; whatever unblocks it calls `goready`. Idle P's steal from busy ones. `runtime.Gosched()` voluntarily yields. `GODEBUG=schedtrace=1000` is the easiest way to *see* it happen. You don't need to memorize the algorithm at this level — just know the names, the queues, and where to look.

---

## Further reading
- `runtime/proc.go` — start at `func schedule(`
- `runtime/runtime2.go` — `g`, `m`, `p`, `schedt`
- "Scalable Go Scheduler Design Doc" — Dmitry Vyukov, 2012
- "The Go scheduler" — Daniel Morsing, 2013
- "Go scheduler: Ms, Ps & Gs" — povilasv blog
- `GODEBUG=schedtrace=1000` — try it on your own programs
- `uber-go/automaxprocs` — for `GOMAXPROCS` in containers
