# Runtime Source Dive — Interview

## 1. How to use this file

Runtime topics show up in mid+/senior Go interviews. At junior you'll be asked what "the runtime" even is; at middle you'll explain `go f()` end-to-end and what `runtime.Gosched` actually does; at senior you'll walk the scheduler, channel send, preemption, and read a 200-goroutine stack dump live. The bar at staff is *reading* and *reasoning about* runtime source — naming files, naming functions, naming the trade-offs the Go team made and the ones they didn't.

Each question has a **short answer** (the length you'd say in the room, two to five sentences), then expanded discussion with code or source references. Read top to bottom on first pass; on revision skim only the ones that surprised you. Type out the code in the live-coding-shaped answers at least once. Be honest about gaps — interviewers prefer "I haven't read `findRunnable` in detail, but I know it's the scheduler's main loop in `proc.go`" over a wrong fluent answer.

Source references throughout point at files in `$GOROOT/src/runtime`. Pin a Go version when you read — internals move between releases. References below match Go 1.22+ unless noted.

---

## 2. Junior questions

### Q: What is "the Go runtime"?

**A:** It's the chunk of Go code (plus a little assembly) that ships inside every Go binary and runs goroutines, allocates memory, sweeps garbage, dispatches panics, and bridges to the OS. Your `main` runs on top of it. You don't link to it explicitly — the compiler stitches it in.

The runtime is what makes Go *feel* like Go. `go func() { ... }()` looks like three tokens in your source, but the compiler lowers that to `runtime.newproc`, which allocates a tiny stack, builds a `g` struct, and parks it on a run queue for a scheduler to pick up. That whole transaction is invisible to you. If you came from C, the runtime is what C doesn't have. If you came from Java, it's the JVM — except statically linked into the executable instead of installed separately on the box.

The source lives in `$GOROOT/src/runtime` — hundreds of `.go` and `.s` files. The headline files: `proc.go` (scheduler), `chan.go` (channels), `mheap.go`/`malloc.go` (allocator), `mgc.go` (GC), `panic.go` (panic/recover/defer). Everything you can do "for free" in Go has a corresponding function in there.

**Follow-up to expect:** Is the runtime written in Go? Mostly yes — by Go 1.5 the runtime was rewritten from C to Go. A small core remains in Plan 9-style assembly (`asm_amd64.s`, `asm_arm64.s`) for context switches, stack manipulation, and atomic primitives that Go can't express.

---

### Q: What's GOROOT and where do I find the runtime source?

**A:** `GOROOT` is the directory your Go toolchain is installed into; the runtime source lives in `$GOROOT/src/runtime`. Find it with `go env GOROOT`. Online, the same code is at `github.com/golang/go/tree/master/src/runtime` — pin to a tag like `go1.22.0` to read a stable snapshot.

```bash
go env GOROOT
# /usr/local/go on Linux, /opt/homebrew/Cellar/go/1.22.0/libexec on macOS Homebrew
ls $(go env GOROOT)/src/runtime
```

You'll see hundreds of files. Don't try to read them top-to-bottom. Use the map: `proc.go` is the scheduler, `chan.go` is channels, `mgc.go` is GC, `malloc.go` is the allocator, `panic.go` is panic/recover. Start at a function name (e.g., `newproc`) and follow callers/callees.

The reason to know GOROOT specifically: when you `go to definition` on `runtime.Gosched` in an IDE, it jumps into `$GOROOT/src/runtime/proc.go`. Reading the actual implementation is two clicks away — most Go developers never make those clicks. The point of this topic is that you do.

**Follow-up to expect:** Where's `GOPATH`? Different thing — `GOPATH` is where your *modules* and third-party code live (`$HOME/go` by default). Runtime is part of the toolchain, not your modules, so it lives under GOROOT.

---

### Q: GMP — what are G, M, and P?

**A:** Three runtime types that form the scheduler. **G** is a goroutine (one stack, one set of registers, a state machine). **M** is a "machine" — an OS thread the runtime obtained via `clone` (Linux) or `pthread_create`. **P** is a "processor" — a logical CPU slot that lets an M run user Go code; there are `GOMAXPROCS` of them. Only an M holding a P can run user goroutines. The Gs run on Ms, Ms attach to Ps to do work.

The picture: imagine `GOMAXPROCS=4`. The runtime creates 4 P structs. There can be any number of Ms — usually a few more than 4 — but at most 4 run user code simultaneously because only 4 Ps exist. Hundreds of thousands of Gs may exist; most are parked, the runnable ones are queued on P's local run queues (and a global queue as overflow).

```go
// pseudo-fields from runtime/runtime2.go
type g struct {
    stack       stack    // [lo, hi)
    sched       gobuf    // saved registers
    atomicstatus uint32  // _Grunnable, _Grunning, _Gwaiting, etc.
    goid         int64
    // ...
}
type m struct {
    g0          *g       // scheduler goroutine
    curg        *g       // current user G
    p           puintptr // attached P (or nil)
    // ...
}
type p struct {
    runq        [256]guintptr // local run queue
    runqhead    uint32
    runqtail    uint32
    runnext     guintptr      // priority slot
    // ...
}
```

See `runtime/runtime2.go` for the real definitions (much longer). The scheduling loop in `runtime/proc.go` — `schedule`, `findRunnable`, `execute` — is the heart of GMP.

**Follow-up to expect:** Why not just G and M — why have P at all? Without P, every scheduling decision (which goroutine runs next?) would need a global lock. P partitions the runnable goroutines into per-P queues so most scheduling is lock-free. P also caches memory allocation arenas, timer heaps, and defer pools — anything that wants per-CPU locality lives on P.

---

### Q: What's the difference between `go func()` and `func()`?

**A:** `func()` calls the function and waits for it to return on the current goroutine. `go func()` *schedules* the function as a new goroutine and returns immediately — the caller doesn't wait. The new goroutine may run on the same M or a different one; you don't get to choose. There's no return value from `go func()` — anything you want to communicate back has to come through a channel or a shared variable.

```go
func a() {
    fmt.Println("a")
}

func main() {
    a()      // prints "a", main blocks until a returns
    go a()   // schedules a; main keeps going; "a" may print before or after main exits
    time.Sleep(time.Second) // hack to keep main alive long enough to see the output
}
```

The compiler lowers `go a()` to `runtime.newproc(funcPC(a))`. `newproc` (in `runtime/proc.go`) allocates a new `g` with a 2KB stack, sets up its `gobuf` to look like it's about to enter `a`, and pushes it onto the current P's local run queue. The next `schedule()` round picks it up.

**Follow-up to expect:** What happens if `main` returns before the goroutine runs? The whole program exits — Go does not wait for background goroutines on `main` exit. Either keep `main` alive (channel receive, `sync.WaitGroup.Wait`) or accept that the goroutine may never run.

---

### Q: How many goroutines can I create?

**A:** Practically, hundreds of thousands to millions on a modern machine — limited by memory, not by an explicit cap. Each goroutine starts with a 2KB stack (`_StackMin` in `runtime/stack.go`), so a million goroutines is about 2GB of stack baseline before any heap use. The hard limit is set by `runtime.SetMaxThreads` (default 10000) — but that limits *OS threads* (Ms), not goroutines.

The misleading "lightweight" framing breaks down at extremes. A million parked goroutines is fine. A million *runnable* goroutines means the scheduler is doing a lot of work picking what to run next. And each goroutine has overhead beyond the stack — `g` struct (a few hundred bytes), defer/panic state, GC bookkeeping.

```go
func main() {
    var wg sync.WaitGroup
    for i := 0; i < 1_000_000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            time.Sleep(time.Hour) // park
        }()
    }
    fmt.Println("created 1M goroutines; mem =", runtime.NumGoroutine())
    wg.Wait()
}
```

This runs fine on a laptop with ~2-3GB resident. Try the same with one million OS threads (`pthread_create`) and you'll OOM around 100k on most kernels — each pthread defaults to 8MB stack.

**Follow-up to expect:** Why is 2KB the starting stack? It's small enough that millions of goroutines fit, and big enough that most goroutines never need to grow. When a goroutine *does* need more stack, `runtime/stack.go`'s `morestack` handler doubles it (`newstack`). Stacks grow up to 1GB (`maxstacksize`) before the runtime panics.

---

## 3. Middle questions

### Q: What does `runtime.Gosched()` do exactly?

**A:** It yields the current goroutine: tells the scheduler "I have nothing urgent, run someone else if anyone's ready, then come back to me". The goroutine stays *runnable* — it just gets moved to the back of the queue. The implementation lives in `runtime/proc.go` as `Gosched` calling `mcall(gosched_m)`.

```go
// Simplified from runtime/proc.go
func Gosched() {
    checkTimeouts()
    mcall(gosched_m) // switch to scheduler stack, then back
}

func gosched_m(gp *g) {
    goschedImpl(gp) // mark gp _Grunnable, put on global queue
    schedule()       // pick next G to run
}
```

`mcall` is the key trick: it switches from the goroutine's stack to `g0`'s stack (the scheduler stack belonging to the M), so the scheduler can manipulate the goroutine's state without standing on it. After `goschedImpl` puts the goroutine back on the runnable queue, `schedule()` picks another goroutine and `execute`s it.

In practice, `Gosched` is rarely needed. The scheduler preempts goroutines on its own (since Go 1.14 via async preemption). You'd reach for `Gosched` when running a tight CPU loop that doesn't hit any natural preemption points and you want to be a cooperative citizen — but even that case is largely gone post-1.14.

**Follow-up to expect:** What's the difference between `Gosched` and `runtime.Goexit`? `Goexit` terminates the current goroutine (runs defers, then dies). `Gosched` just yields. Conceptually: `Gosched` is "I'm taking a break"; `Goexit` is "I'm done forever".

---

### Q: What is `g0`?

**A:** `g0` is a special goroutine attached to each M, used for running scheduler code and other system code. Its stack is the OS-allocated thread stack (~8MB), not the small 2KB user-goroutine stack. When the M needs to run scheduler logic — `schedule`, `findRunnable`, GC scan — it switches to `g0` first via `mcall` or `systemstack`.

The two-stack model is central to how the runtime works. User goroutines have small, movable, growable stacks. Scheduler code has a fixed, large, OS-managed stack. They can't be the same stack because (a) scheduler code might need more stack than a user goroutine has, and (b) the scheduler manipulates the user goroutine's state, which is awkward if it's living on that state.

```go
// runtime/runtime2.go
type m struct {
    g0      *g // goroutine with scheduler stack
    curg    *g // current running user goroutine
    // ...
}
```

When you see `systemstack(fn)` in runtime source, it means "switch to g0, run fn, switch back". Used for things like memory allocation slow paths, GC marking, and stack growth — operations that mustn't recurse onto the user stack.

**Follow-up to expect:** Do I ever see `g0` in my code? Almost never directly. `runtime.Stack` skips it. The only place users notice it is in a panic stack trace from inside the runtime, where you'll see `runtime.g0` in the frame metadata.

---

### Q: Why does the runtime have its own scheduler — why not just OS threads?

**A:** Four reasons. (1) **Cost**: OS threads have ~8MB default stacks and switching costs microseconds (full register save + kernel trap). Goroutines are 2KB and switch in nanoseconds (just register save, all in userspace). (2) **Scale**: a million OS threads OOMs; a million goroutines is routine. (3) **Cooperation with the language**: the runtime knows about channels, blocking sends, GC safepoints — it can schedule with that information; the OS can't. (4) **Portability**: the runtime smooths over differences between Linux's `futex`, macOS's `kqueue`, Windows IOCP — your Go code is unchanged.

The trade is real: the runtime now has to do work the OS would've done — handle blocking syscalls (`entersyscall`/`exitsyscall`), implement preemption (post-1.14 async preemption via SIGURG), keep work distributed across cores (work stealing). When the runtime gets it wrong (rare), debugging is hard because the stack traces don't match what `top` and `strace` see.

The historical alternative — N:1 (all goroutines on one OS thread) — was Go pre-1.0 and didn't scale. The opposite — 1:1 (one goroutine per OS thread) — is what Java's `Thread` was before virtual threads. Go's M:N model is the middle: many Gs multiplexed over a small number of Ms.

**Follow-up to expect:** Why not just have N Ms equal to NumCPU and pin them? Because Ms block: a goroutine making a syscall takes its M into the kernel, so the runtime *needs* spare Ms to keep the CPU busy. It maintains a pool of Ms and creates new ones (up to `runtime.SetMaxThreads`, default 10000) as needed.

---

### Q: When does an M get created?

**A:** Whenever the runtime needs a new OS thread because all existing Ms are busy and there's still work to do. Most commonly: (1) a goroutine enters a blocking syscall and the runtime hands off its P to a fresh M so the P keeps doing work; (2) initial process startup creates one M per P; (3) the GC creates Ms for its background sweeper/marker; (4) `LockOSThread` requires the runtime to maintain a dedicated M for the locked goroutine.

The function is `runtime.newm` in `proc.go`:

```go
// Simplified
func newm(fn func(), pp *p, id int64) {
    mp := allocm(pp, fn, id) // allocate M struct, g0 stack
    mp.nextp.set(pp)
    newm1(mp) // ultimately calls clone()/pthread_create
}
```

The OS thread starts in `runtime.mstart`, which calls `schedule()` and joins the scheduler loop. From there it's indistinguishable from any other M.

Ms are not destroyed on goroutine exit — they're cached in a free list and reused. A long-idle M will eventually be released back to the OS, but the runtime keeps a pool to avoid the cost of `clone` on every burst of work.

**Follow-up to expect:** What's the max number of Ms? `runtime.SetMaxThreads(n)` — default 10000. If you hit that, the process crashes with "fatal error: thread exhaustion". You'd hit it by doing thousands of blocking syscalls simultaneously without `GOMAXPROCS` to back them.

---

### Q: How does a channel send block a goroutine (under the hood)?

**A:** When a goroutine sends on a channel and the receive isn't ready, the runtime parks the goroutine: marks it `_Gwaiting`, adds it to the channel's `sendq` (a linked list of waiting senders), and calls `gopark` which yields to the scheduler. The M then runs other goroutines. When a receiver arrives, it pops the sender off `sendq`, copies the value directly into the receiver's stack, and calls `goready` to mark the sender `_Grunnable` again.

The source is `runtime/chan.go`'s `chansend` and `chanrecv`. The path:

```
chansend(c, elem, block):
    if c.recvq has a waiter:
        send directly to that goroutine (skip the buffer), goready it
    else if c.buf has space:
        memcpy elem into c.buf, increment c.sendx, return
    else:
        append current g to c.sendq with the elem pointer
        gopark(...)   // park, switch to scheduler, M runs other goroutines
        // wake here when a receiver arrives; the receiver has copied our value
        return
```

Two senior-grade details. First: **direct send**. When a sender meets a parked receiver, the runtime copies the value directly from the sender's stack into the receiver's stack — bypassing the buffer entirely. This is faster than buffer round-tripping. Second: **fairness**. `sendq` and `recvq` are FIFO, so channels are first-come-first-served. Combined with `select`'s pseudorandom branch ordering, this gives the predictable channel semantics Go promises.

**Follow-up to expect:** What's different for buffered vs unbuffered? Unbuffered: every send blocks unless a receiver is parked. Buffered with free slots: the send memcpys into `c.buf` and returns without blocking. Buffered when full: same path as unbuffered. The fast path (one branch, one memcpy) is the buffered-with-space case.

---

### Q: What does `//go:linkname` do?

**A:** `//go:linkname localname importpath.remotename` is a compiler pragma that links a local symbol to a function or variable in another package, including unexported ones. It bypasses Go's normal visibility rules. The runtime uses it heavily to expose internals to `sync`, `time`, `reflect`, and `net` without making them part of the public API.

```go
// Inside the sync package — references the runtime's semaphore primitives:
//go:linkname runtime_Semacquire sync.runtime_Semacquire
func runtime_Semacquire(s *uint32)

//go:linkname runtime_Semrelease sync.runtime_Semrelease
func runtime_Semrelease(s *uint32, handoff bool, skipframes int)
```

The runtime declares `func runtime_Semacquire(...)` and uses `//go:linkname` to make it callable from `sync` under the same name. Both halves agree on the symbol; the compiler/linker wires them up. Without this, `sync.Mutex` would have to live inside the runtime — instead, only the cheap primitives do.

Using `//go:linkname` in *your* code is heavily discouraged. It's an internal escape hatch, will break across Go versions, and as of Go 1.23 there's a transition plan to forbid linkname-ing into the standard library from non-standard-library packages.

**Follow-up to expect:** What's the cost of `//go:linkname`? Zero at runtime — it's a link-time pun. The "cost" is that the symbol you target is not part of any API contract; the next Go release may rename or delete it without warning.

---

### Q: Why is `runtime.LockOSThread` needed?

**A:** Some OS-level APIs are *thread-local*: they associate state with the OS thread, not the process. If a goroutine making such calls gets rescheduled onto a different M, the thread-local state is lost. `LockOSThread` pins the calling goroutine to its current M so the M cannot be reused for other goroutines and the goroutine cannot migrate elsewhere. Use cases: OpenGL contexts, Linux `setuid`/`seteuid` (per-thread on Linux), some C libraries that store data in `__thread` variables.

```go
func main() {
    runtime.LockOSThread() // pin to current M for life of program
    defer runtime.UnlockOSThread()

    // Now safe to call OpenGL, X11, or any thread-local-state C library
    initGLContext()
    runMainLoop()
}
```

A locked goroutine still cooperates with the scheduler — it can be parked on a channel send — but when it resumes, it's guaranteed to be on the same M. If the goroutine exits without `UnlockOSThread`, the M is destroyed rather than recycled (otherwise the next goroutine on that M would inherit the locked thread-local state). See `runtime/proc.go` — search for `lockedExt`.

**Follow-up to expect:** What's the analogue for "lock to this P"? There isn't one in the public API. `runtime.LockOSThread` locks at the M layer; P is a scheduler-internal concept. If you need CPU pinning, that's an OS-level operation (`sched_setaffinity` on Linux via cgo).

---

## 4. Senior questions

### Q: Walk me through what happens from `go f()` to `f` actually running on a CPU.

**A:** Compiler lowers `go f()` to `runtime.newproc(fn)`. `newproc` allocates a fresh `g` (or reuses one from a free list), sets up its `gobuf` so resuming it jumps into `f`, and pushes it onto the current P's local run queue (`runq` or `runnext` slot). Some M — the current one or another — eventually calls `schedule`, which calls `findRunnable`, which pops the new G off a queue, calls `execute(g)`, which switches register state via `gogo` (assembly) and jumps to `f`'s entry point.

The detailed path:

1. **Compile-time lowering.** `go f(x, y)` becomes a call to `runtime.newproc(siz, fn, x, y)` where `fn` is `f`'s address and `siz` is the size of arguments. See `cmd/compile/internal/walk/order.go` for the rewrite.
2. **`newproc` in `runtime/proc.go`.** Allocates a `g` (from `sched.gFree` cache if possible, else fresh from the heap). Sets up `gobuf` (saved register state): PC points at `goexit`, SP points at the new stack top, and the arguments are copied above SP.
3. **`runqput`.** Places the new G on the local P's run queue. If `next=true`, into the `runnext` priority slot; else into the FIFO `runq` (256-entry circular buffer). If `runq` is full, half of it moves to the global runnable queue (`sched.runq`) to make room.
4. **Some M runs `schedule()`.** This is the main loop. It calls `findRunnable`, which checks: (a) `runnext`, (b) local `runq`, (c) global `sched.runq` every 61 iterations (to avoid starvation), (d) network poller (`netpoll`), (e) GC mark workers, (f) work-stealing from another P. Returns a runnable G.
5. **`execute(gp)`.** Marks `gp.atomicstatus = _Grunning`, links it to the current M (`mp.curg = gp`), then calls `gogo(&gp.sched)`.
6. **`gogo` in `asm_*.s`.** Loads the saved registers from `gp.sched` (PC, SP, BP) and `JMP`s to PC. Now the CPU is executing `f`'s first instruction.
7. **`f` runs.** When it returns, it returns into `goexit` (because that's what `newproc` set up). `goexit` marks the G dead, returns it to the free list, and calls `schedule()` again.

The whole transaction — from `go f()` to first instruction of `f` — costs a few hundred nanoseconds on a warm scheduler. The "lightweight" claim about goroutines is grounded here: this path is faster than `pthread_create` by orders of magnitude.

**Follow-up to expect:** What if the local runq is empty when we get to `findRunnable`? Then work-stealing kicks in — see next question.

---

### Q: How does work-stealing work, and what's the cost?

**A:** When a P's local run queue is empty, the M attached to that P doesn't sit idle — it scans other Ps' run queues, picks one with work, and steals half. The stealer takes the back half of the victim's queue (atomically, via `runqsteal` in `proc.go`); the victim doesn't notice until it next tries to pop. The cost is two cache misses per steal attempt plus contention on the victim's queue header. The benefit is that load stays balanced across all Ps without a global queue lock on every scheduling decision.

```go
// Simplified from runtime/proc.go
func findRunnable() (gp *g) {
    // ... check local runq, global runq, netpoll ...
    
    // Steal from other Ps
    for i := 0; i < 4; i++ { // try up to 4 times
        for _, pp := range randomEnum(allp) {
            if gp := runqsteal(pp_, pp); gp != nil {
                return gp
            }
        }
    }
    
    // Truly nothing — park the M
    stopm()
}
```

Two senior-grade details. First: **the stealer randomizes its scan order** so all Ps don't pile up on the same victim. Second: **`runnext` is *not* stolen on the first pass** — only on subsequent passes — to give the recently-spawned G a chance to run on its origin P (cache locality).

The cost shows up under two patterns: a "thundering herd" where all Ps wake at once and contend for one busy P's queue (rare); and a producer-consumer pattern where one P always generates and others always steal, paying cross-CPU cache invalidation on every steal. Profile with `go tool trace` — the "Goroutines" track shows steal events.

**Follow-up to expect:** Why steal half, not one? Stealing half amortizes the cost of the steal across multiple subsequent dispatches. Stealing one would mean every dispatch needs another cross-P steal. Half is a classic work-stealing tuning (Cilk used the same heuristic).

---

### Q: How is preemption implemented in modern Go (post-1.14)?

**A:** Asynchronously, via signals. The sysmon thread or the GC sends `SIGURG` to a target M; the signal handler in `runtime/signal_unix.go` examines the M's current G and, if it's safe to preempt (correct alignment, not in a non-preemptible region), rewrites the saved PC to jump into `asyncPreempt`. When the signal handler returns, control resumes at `asyncPreempt`, which calls `Gosched`. The goroutine is now back on a run queue and the M picks something else.

Pre-1.14 preemption was *cooperative*: the compiler inserted preemption checks at function prologues, and a goroutine in a tight loop with no function calls (e.g., `for { i++ }`) could run forever without yielding. This caused real bugs — GC couldn't make progress because it couldn't get the goroutine to a safepoint. The 1.14 fix introduced async preemption.

```go
// Tight loop that pre-1.14 would block GC forever:
for i := 0; ; i++ {
    // No function calls, no compiler-inserted check.
}
```

Implementation outline in `runtime/preempt.go`. Key functions: `preemptM` (queue a signal), `sigPreempt` (signal handler entry), `asyncPreempt2` (the function the signal handler reroutes to). The "is it safe?" check examines whether the PC is inside an unsafe region (manipulating raw pointers, GC write barriers in progress, etc.) — if not safe, the preempt is deferred.

**Follow-up to expect:** Why `SIGURG`? It's rarely used by applications (Go used to use `SIGUSR2`, but applications use that too). `SIGURG` is for "urgent" data on sockets, virtually never used in modern code. Choosing an obscure signal minimizes conflicts with application code.

---

### Q: What's `findRunnable` doing when no goroutine is runnable?

**A:** Trying very hard to find work before parking the M. The function in `runtime/proc.go` is one of the most performance-critical in the runtime. The path: check local runq, check global runq (every 61 scheduling rounds to avoid starvation), poll the network for ready connections (`netpoll(0)`), check GC mark work, work-steal from other Ps (up to 4 passes), check timers across all Ps, then poll the network *with blocking*, then finally `stopm` — park the M until something wakes it.

The 61-round counter is a real number, not poetic. It's `_GoroutineProfileBatchSize` adjacent — picked to prevent a global-runnable G from waiting forever while local queues stay busy. Without it, a producer keeping its local queue full could starve the global queue indefinitely.

```go
// Heavily simplified from runtime/proc.go
func findRunnable() (gp *g, inheritTime, tryWakeP bool) {
top:
    pp := getg().m.p.ptr()

    // 1. Local runnext + runq
    if gp, inheritTime := runqget(pp); gp != nil { return gp, inheritTime, false }

    // 2. Global runq (with anti-starvation)
    if sched.runqsize != 0 {
        lock(&sched.lock); gp := globrunqget(pp, 0); unlock(&sched.lock)
        if gp != nil { return gp, false, false }
    }

    // 3. Network poller (non-blocking)
    if list, _ := netpoll(0); !list.empty() {
        gp := list.pop(); injectglist(&list); return gp, false, false
    }

    // 4. Work-steal
    if gp, ... := stealWork(now); gp != nil { return gp, ... }

    // 5. Timers, GC mark, idle handoff
    // ...

    // 6. Truly nothing — park the M, wait for wakep
    stopm()
    goto top
}
```

The fact that `findRunnable` is this complex tells you the runtime takes "an idle M wastes a CPU core" very seriously. Every check is an attempt to find work before giving up.

**Follow-up to expect:** When does `stopm` actually wake up? When another P calls `wakep` because it just pushed work onto its queue and notices that idle Ms exist. The wakeup uses a futex on Linux (`semasleep`/`semawakeup` in `runtime/lock_futex.go`).

---

### Q: Explain how `sync.Mutex` cooperates with the runtime.

**A:** Fast path: an atomic CAS on the mutex state. If contention is rare, lock and unlock are just one atomic instruction each. Slow path: when the CAS fails, the mutex calls `runtime_SemacquireMutex` — a runtime function exposed to `sync` via `//go:linkname` — which parks the goroutine on the mutex's semaphore. When the holder releases, `runtime_Semrelease` wakes one waiter. So `sync.Mutex` is a userspace spinlock for the common case and a runtime-managed parking primitive for contended cases.

```go
// sync/mutex.go (simplified)
func (m *Mutex) Lock() {
    if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        return // fast path
    }
    m.lockSlow() // slow path: spin briefly, then call runtime_SemacquireMutex
}

// Linked to runtime/sema.go:
//go:linkname runtime_SemacquireMutex sync.runtime_SemacquireMutex
func runtime_SemacquireMutex(s *uint32, lifo bool, skipframes int)
```

The semaphore implementation in `runtime/sema.go` uses a treap (tree + heap) keyed by address, indexed by an array of `semtable` buckets. Acquirers park on the semaphore's wait queue; releasers wake one waiter. Because the wait state is in the runtime, parked goroutines cost zero CPU.

Two senior moves to mention. (1) **Starvation mode**: if a waiter has been queued more than 1ms, `Mutex` enters starvation mode where the lock is handed directly to the next waiter (not re-contested by new arrivals). Prevents long-tail latency. (2) **Brief spinning before parking**: on multicore, the slow path spins a few times (active CPU wait) before parking — cheaper than a park/unpark cycle if the holder will release quickly.

**Follow-up to expect:** What about `sync.RWMutex`? Same model: fast atomic for the common case, runtime semaphore for parking readers and writers separately. Writers always win on the next release (writer preference) to avoid writer starvation.

---

### Q: Why does `runtime.GOMAXPROCS(1)` not make Go single-threaded under the hood?

**A:** `GOMAXPROCS` controls the number of Ps — the slots that can execute *user Go code* simultaneously. It does *not* control the number of Ms (OS threads). The runtime always has additional Ms for: the sysmon thread (background monitor, no P), GC workers (parked when idle), goroutines making blocking syscalls (the M goes into the kernel; the P is handed to a new M), and finalizers. So `GOMAXPROCS(1)` means "at most one user goroutine runs at a time", not "the process has one OS thread".

```go
runtime.GOMAXPROCS(1)
go func() {
    f, _ := os.Open("largefile") // syscall — M enters kernel
    _, _ = f.Read(buf)            // blocking syscall
}()
go func() {
    for i := 0; i < 1e9; i++ {}   // CPU bound
}()
// Both goroutines make progress: the first M is in the kernel,
// the runtime created a new M for the second goroutine.
```

You can see this with `ps -L` (Linux) on a `GOMAXPROCS=1` program — `ps` shows multiple LWPs even though only one runs user code at a time.

The reason `GOMAXPROCS=1` was *historically* used to debug data races: it forced cooperative scheduling, so race conditions that only manifest with true parallelism would disappear (or change shape). That trick stopped working reliably with async preemption (1.14) — interleavings now happen even with `GOMAXPROCS=1`.

**Follow-up to expect:** Then how do I get truly single-threaded for debugging? You don't — Go has no public API for that. The closest is `runtime.LockOSThread` + `GOMAXPROCS(1)` + structuring your program so only one goroutine ever runs. Production-relevant only for niche cases.

---

### Q: How would you read a 200-goroutine stack dump to find a deadlock?

**A:** Goroutines pile up where they're blocked. Group them by their last stack frame: 198 of them are likely waiting on the same channel or mutex — that's your culprit. The other 2 hold the resource. Look for "semacquire" or "chan receive" in the leaf frames, then trace backward to your code. `pprof`'s `goroutine` profile and `go tool trace` give grouped views automatically.

Concrete recipe in the room:

1. **Capture.** `kill -SIGQUIT $pid` (Linux/macOS) or `kill -ABRT` — dumps all goroutine stacks to stderr. Or `pprof.Lookup("goroutine").WriteTo(os.Stderr, 1)` from inside the program.
2. **Group by leaf frame.** Real dumps have hundreds of goroutines but maybe 5-10 unique stacks. The stacks that appear 100+ times are *waiters*. The stacks that appear 1-2 times are *holders or workers*.
3. **Identify the wait reason.** Each goroutine header includes its state: `chan receive`, `chan send`, `semacquire` (mutex), `select`, `IO wait`, `sleep`. Cluster on this.
4. **Find the orphan holder.** If 200 are blocked on `chan receive`, who holds the sender? Look for a goroutine in `running`, `runnable`, or stuck in user code that you can trace to the producer side.
5. **Cross-check with `goroutine` profile.** `go tool pprof http://host:6060/debug/pprof/goroutine` (with `net/http/pprof` imported) gives you the same data with grouping built-in.

```go
import _ "net/http/pprof"

go http.ListenAndServe("localhost:6060", nil)
// Then: curl http://localhost:6060/debug/pprof/goroutine?debug=2
```

The senior move: when 200 goroutines block on `semacquire` for one mutex, the holder is the bug. Find the holder's stack, work out why it's not releasing, fix that — not the waiters.

**Follow-up to expect:** What if no goroutine appears to hold the resource — they're all waiting? Then it's a lost wakeup or a circular wait. For mutexes that's hard (Go doesn't lock-track), but for channels you can look for the producer that exited without closing. The `chan receive` waiters will eventually block forever — that's the bug.

---

## 5. Staff / "show off" questions

### Q: How would you add tracing to a specific event in the runtime?

**A:** The runtime uses a built-in tracing facility — `runtime/trace.go` and `runtime/traceback.go` — exposed via `go tool trace`. To add a new traced event: define a new event code in `runtime/trace/trace.go`'s event table, emit it with `traceEvent` at the right point in the runtime source (e.g., right after a goroutine is unparked), and add a renderer in `cmd/trace`. Build the toolchain (`./make.bash` from `src/`), then your event shows up in trace output. This is invasive — requires building Go from source — but is how the runtime maintainers add new diagnostics.

The non-invasive option: `runtime/trace` (note the user-facing variant — `import "runtime/trace"`) lets *you* emit custom events from user code via `trace.WithRegion` and `trace.Log`. Those events show up in the same trace viewer alongside built-in events like "goroutine block on channel". You can't add events to the runtime itself this way, but for most diagnostics user-region tracing is enough.

```go
import "runtime/trace"

func work(ctx context.Context) {
    ctx, task := trace.NewTask(ctx, "process-batch")
    defer task.End()

    trace.WithRegion(ctx, "validate", func() {
        // ... validation runs as a labeled region in trace output
    })
}
```

Then `go test -trace=trace.out ./...` and `go tool trace trace.out` to see it.

For runtime-internal events, study how `traceEvGoBlockSend` is emitted in `runtime/chan.go` (search for `traceEvent`). It's a one-liner: `if traceEnabled() { traceEvent(traceEvGoBlockSend, 1) }` at the right point in the function. Add yours the same way and rebuild the toolchain.

**Follow-up to expect:** Why not just `fmt.Println` from the runtime? Two reasons. (1) Runtime code often runs on the system stack (`g0`) where `fmt` may not be safe — it allocates and `g0` doesn't tolerate heap allocs during scheduling. (2) `fmt` introduces ordering effects that bias the very behaviours you're trying to observe. The trace framework is designed to be lock-free per-P and minimal-impact.

---

### Q: Compare Go's scheduler to Erlang's BEAM and Java's ForkJoinPool.

**A:** All three are M:N user-space schedulers, but they make different trade-offs. Go is *preemptive* (async preemption via signals), uses work-stealing, and has explicit `LockOSThread` for thread-local APIs. BEAM is *reduction-counted* — every Erlang process gets a "reduction budget" and yields after N reductions (no signals needed because the VM controls dispatch). ForkJoinPool is also work-stealing but designed for *divide-and-conquer* parallelism, not general-purpose; the pool isn't preemptive at all (tasks must complete or self-suspend).

| Aspect | Go (GMP) | Erlang BEAM | Java ForkJoinPool |
|--------|----------|-------------|-------------------|
| Preemption | Async signals (1.14+) | Reduction counter | None (cooperative) |
| Unit of work | Goroutine (~2KB stack) | Process (~340B initial) | Task (heap object) |
| Communication | Channels | Mailboxes (built into process) | Futures/queues |
| Schedulers | One per P | One per CPU | One per CPU |
| Work distribution | Steal-half from victim | Migrate when idle | Steal-half |
| Blocking I/O | Hand off P to new M | Async-by-default; never blocks | Compensation threads |
| OS thread binding | `LockOSThread` (rare) | Never | Never |

BEAM's strength: zero shared memory, isolated heaps per process, supervision trees. Cost: copying on every message, no shared data structures. Go's strength: shared memory with explicit synchronization, much faster per-message in the common case. Cost: data races possible. ForkJoinPool's strength: divide-and-conquer parallelism extremely cheap because work is just a function. Cost: not suitable for I/O-heavy or long-running tasks.

The "right" choice depends on workload: BEAM dominates fault-tolerant telecom; Go dominates network services with shared state; ForkJoinPool dominates CPU-parallel computation inside a JVM application. Saying one is universally better is wrong.

**Follow-up to expect:** Where does Go's scheduler still lose to BEAM? Latency tails. BEAM's reduction counter is more deterministic than Go's signal-based preemption, so worst-case scheduling jitter is lower. For hard-real-time soft constraints (sub-millisecond response 99.99% of the time), BEAM still wins.

---

### Q: What changed in Go's preemption story 1.13 -> 1.14, and why?

**A:** 1.13 had cooperative preemption only — the compiler inserted preemption checks at function prologues. If your goroutine ran a tight loop with no calls, the runtime couldn't preempt it; the goroutine ran forever. This blocked GC (couldn't safepoint everyone), `runtime.GOMAXPROCS` (couldn't pause Ps), and made a class of bugs near-impossible to debug. 1.14 introduced *async* preemption: the runtime sends `SIGURG` to the target M; the signal handler reroutes to `asyncPreempt`, which yields the goroutine. Now any goroutine can be preempted at almost any instruction.

The motivating example (well-known from the 1.14 release notes):

```go
// Pre-1.14: this prints "1 2 3" once and then hangs.
// Post-1.14: prints "1 2 3" and the goroutine yields, allowing prints to continue.
func main() {
    go func() {
        for i := 0; i < 3; i++ {
            fmt.Println(i + 1)
        }
        for {} // tight loop, no calls
    }()
    runtime.GC() // 1.13: blocks forever waiting for the goroutine to safepoint
}
```

The implementation cost: every function had to grow safepoint metadata so the signal handler can decide "is this PC safe to preempt?". The compiler emits per-PC liveness maps (`runtime/stackmap.go`) listing which stack slots hold pointers at each PC. The signal handler examines the PC, looks up the map, decides whether to redirect to `asyncPreempt` or defer until later. The cost was binary size growth (~3-5% across Go programs) and slightly slower signal-handler entry.

The reason it took so long to land: getting "safe PC" right is hard. Go calls into unsafe regions all the time — pointer arithmetic in the allocator, write barriers in progress for GC, atomic operations across multiple instructions. Preempting in the middle of those would corrupt state. The 1.14 design (proposal #24543) is the result of years of iteration on what "safe" means.

**Follow-up to expect:** Are there still cooperative preemption points? Yes — function prologues still emit a stack-growth check that doubles as a preemption check. Async is a *backstop* for when a goroutine doesn't hit a cooperative point in reasonable time. The two coexist.

---

### Q: When does the runtime "spin" an M, and why is that desirable?

**A:** When an M finds no work locally and decides to keep trying for a short while before parking. The spin shows up in `findRunnable` and `wakep`. The state is recorded in `sched.nmspinning` — the number of Ms actively looking for work. The runtime maintains the invariant: if there's runnable work somewhere, at least one M is spinning or running it (modulo a tiny race window). This avoids the "wakeup latency hole" where a P pushes work but no M notices for milliseconds.

Specifically: when an M decides to look for work, it CASes `nmspinning` from N to N+1 and enters its scan loop. When a producer P pushes a new G onto its queue, it checks `nmspinning` — if zero, it calls `wakep` to wake an idle M (or create a new one) to do the scan. The spinning M finds the new G and runs it. Without spinning, the producer would wake a parked M every time it pushed work, paying a futex round-trip on every dispatch.

```go
// Sketch from runtime/proc.go:
func wakep() {
    if atomic.Load(&sched.nmspinning) != 0 { return } // someone's already looking
    if atomic.Load(&sched.npidle) == 0 { return }     // no idle Ps anyway
    // ... start a new M to spin and find work ...
}
```

The cost of spinning is CPU burned without doing useful work. The runtime caps spinning at roughly `GOMAXPROCS/2` Ms to avoid burning all cores on speculation. Tune this poorly and you either pay wakeup latency (too little spinning) or waste CPU (too much).

**Follow-up to expect:** Does spinning hurt power consumption on laptops/embedded? Yes, marginally. Go has not exposed a tunable for "spin less, save power" — this is a known issue for battery-sensitive workloads but considered low priority because the spin durations are short (single-digit milliseconds at most).

---

### Q: Propose a runtime feature you'd want and what it would cost to implement.

**A:** Per-goroutine CPU time accounting. Today `runtime.ReadMemStats` gives heap stats, but there's no `runtime.GoroutineCPU(gid) time.Duration`. Profilers do this approximately via sampling, but a deterministic "how much CPU did this goroutine consume?" is not available. Cost: every context switch (entering/exiting `execute`/`schedule`) needs to read a high-resolution timer and accumulate into the G's `g.cputime` field. Roughly 30-50ns per switch — a 5-10% scheduling overhead — which is why Go hasn't shipped it. The fix would need either (a) opt-in per-goroutine flag, or (b) sampling-based accumulation that approximates the full count.

The implementation outline:

1. Add `cputime int64` to the `g` struct (`runtime/runtime2.go`).
2. In `execute(gp)`, just before `gogo`, record `gp.lastSchedTime = nanotime()`.
3. In `schedule()`, just after the G returns, increment `gp.cputime += nanotime() - gp.lastSchedTime`.
4. Expose `runtime.GoroutineCPU() time.Duration` returning `getg().cputime`.

The 30-50ns figure comes from `nanotime`'s cost — on Linux it's `clock_gettime(CLOCK_MONOTONIC)`, vDSO'd to about 25ns; on macOS it's a Mach API call closer to 80ns. Two reads per switch (entry + exit) doubles that.

Alternatives that are cheaper: sampling-based. Every Nth schedule, record the time delta into a histogram per G. Approximate but much cheaper. The runtime already does something similar for `pprof` CPU sampling at 100Hz — adapting that to per-G would be lower overhead than deterministic tracking.

The cost story matters more than the feature: when proposing runtime features in an interview, lead with "what's it worth, and what does it cost" — not with the API. Anyone can imagine an API; senior signal is reasoning about the overhead.

**Follow-up to expect:** Is there really *no* per-goroutine accounting? Goroutine profiles capture stack samples but not CPU time. `runtime/trace` records goroutine start/stop events with timestamps, so you can post-process trace files to compute per-G CPU. So the data exists in traces — it just isn't queryable at runtime.

---

## 6. What NOT to say

These are common mistakes that interviewers grade down.

- **"Goroutines are lightweight threads."** Without *why* — that they have 2KB stacks vs OS threads' 8MB, that they switch in userspace not the kernel, that they multiplex M:N onto OS threads — this phrase is meaningless and signals you've memorized a tagline. Always pair the phrase with the mechanism.
- **"M is just an OS thread."** Close enough but glosses over: Ms have a `g0` scheduler stack, they cache an allocator (`mcache`), they participate in GC mark assistance, they can be locked to specific goroutines. "M is the runtime's wrapper around an OS thread that also carries scheduler-local state" is the correct sentence.
- **"GC is non-blocking."** Wrong — there's still a stop-the-world phase at the start and end of every cycle (~10s of microseconds typical, can be longer). The *mark* and *sweep* phases run concurrently with user code, but STW exists. Saying "GC is non-blocking" tells the interviewer you've read marketing and not source.
- **"Channels are mutexes."** They're closer to bounded queues with a mutex underneath plus blocking semantics. Calling them "just mutexes" misses the parking machinery, the direct send optimization, and the FIFO fairness.
- **"GOMAXPROCS is the number of threads."** It's the number of *Ps* — the number of goroutines that can run simultaneously. The number of OS threads is usually higher (sysmon, syscalls, GC workers). Conflating P and M is a junior-grade error.
- **"`runtime.Gosched` makes my program faster."** Almost always false. Async preemption (1.14+) means `Gosched` is rarely needed; calling it gratuitously is cargo-cult. The honest answer: "I haven't needed `Gosched` in production code since 1.14 — it's mostly useful for runtime tests."
- **"`panic` is like an exception."** Sort of, but Go panics traverse defers in reverse order, can be recovered only within a deferred function in the same goroutine, and crash the whole program if they cross a goroutine boundary. The differences matter and "like an exception" papers over them.
- **"Work-stealing means goroutines move."** Goroutines move when their P's queue is empty *and* another P has too many. They don't move when both queues are balanced. Saying "Go constantly migrates goroutines" suggests more movement than actually happens — the runtime tries to keep Gs on their origin P for cache locality.
- **"The runtime is written in C."** Was true pre-1.5. Since 1.5 it's been mostly Go (with assembly for low-level transitions). Saying "C" signals you stopped learning around Go 1.4.
- **"You can't have a memory leak in Go because of GC."** Goroutine leaks are memory leaks — a parked goroutine holds its stack, its captured variables, and its `g` struct alive forever. The GC can't collect a goroutine that's parked on a channel that will never receive. This is the most common production leak in Go services.

---

## 7. 5-minute prep checklist

Run through this list right before the interview. If you can't recite the answer, study the linked file.

### Must-know phrases

- "**GMP**: G is goroutine, M is OS thread, P is logical CPU slot. Only an M with a P runs user code."
- "**`newproc`** in `runtime/proc.go` allocates a new G and puts it on a run queue."
- "**`schedule` -> `findRunnable` -> `execute`** is the scheduler main loop."
- "**Work-stealing** steals half from a victim P's queue when local is empty."
- "**Async preemption** in 1.14+: `SIGURG` reroutes the PC to `asyncPreempt`."
- "**`g0`** is the M's scheduler-stack goroutine; user code never runs there."
- "**`gopark` / `goready`** park and unpark goroutines."
- "**`runtime_Semacquire`** is the `//go:linkname`'d primitive `sync.Mutex` uses for parking."
- "**Channel send** parks on the channel's `sendq`; direct send copies sender->receiver bypassing the buffer."
- "**STW phases** exist at the start and end of every GC cycle — concurrent mark and sweep run otherwise."

### Source files to mention by name

| File | What's in it |
|------|--------------|
| `runtime/proc.go` | Scheduler: `newproc`, `schedule`, `findRunnable`, `execute`, `gopark`, `goready` |
| `runtime/chan.go` | Channels: `chansend`, `chanrecv`, `closechan` |
| `runtime/sema.go` | Semaphores backing `sync.Mutex`: `runtime_Semacquire`, `runtime_Semrelease` |
| `runtime/runtime2.go` | Struct definitions: `g`, `m`, `p`, `gobuf`, `schedt` |
| `runtime/stack.go` | Stack growth: `morestack`, `newstack` |
| `runtime/preempt.go` | Async preemption: `preemptM`, `asyncPreempt2` |
| `runtime/mgc.go` | GC main loop: `gcStart`, `gcMarkTermination` |
| `runtime/malloc.go` | Allocator: `mallocgc`, size classes |
| `runtime/panic.go` | Panic/recover/defer: `gopanic`, `gorecover`, `deferproc` |
| `runtime/signal_unix.go` | Signal handling including async preempt |
| `runtime/trace.go` | Built-in tracing for `go tool trace` |

### Functions to be able to sketch in pseudocode

- **`newproc`**: allocate G, set up gobuf, `runqput`.
- **`schedule`**: loop calling `findRunnable` and `execute`.
- **`runqsteal`**: atomic load of victim head/tail, copy half, atomic CAS to commit.
- **`chansend`** fast path: try direct send to receiver in `recvq`; else memcpy to buffer; else park.
- **`gopark`**: mark G `_Gwaiting`, switch to `g0`, call `schedule`.

### "I haven't read X in detail" — acceptable gaps

You don't need to know everything. Acceptable junior-to-mid gaps:

- The exact GC pacer algorithm.
- The internals of `netpoll` (epoll/kqueue/IOCP details).
- The page allocator's size-class table.
- Race detector internals (TSAN-derived, mostly in `runtime/race/`).

Senior is expected to know GC pacing at a conceptual level (write barriers, soft/hard memory targets) and `netpoll` enough to explain how a blocking `Read` becomes a parked goroutine. Staff is expected to read source and reason about trade-offs, not necessarily to recite the page allocator from memory.

### Closing line for the interview

If you only remember one thing, remember this: **the runtime is just Go code**. It's in `$GOROOT/src/runtime`, and you can read it. Most Go developers never do. The senior signal in this topic isn't memorizing the scheduler — it's having opened `proc.go`, found `schedule`, and traced one call path. Do that once before the interview and you'll outperform 80% of candidates.
