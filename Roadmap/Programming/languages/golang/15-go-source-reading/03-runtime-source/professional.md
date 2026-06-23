# Runtime Source — Professional

> Focus: the runtime package is the deepest stdlib reading challenge in Go. Unlike `net/http` (Go-only, conventional) or `sync` (Go-only with a thin runtime back-channel), `runtime` is *self-hosted infrastructure*: it implements goroutines, the scheduler, channels, defer, panic, GC, and stack growth using its own primitives — but with restrictions that ordinary Go code never sees. Reading it is not "harder Go". It is a separate dialect with its own compiler pragmas, its own register conventions, its own ABI, and its own debugging story. This file is the systematic walkthrough: how to attack it, where to start, what the dialect markers mean, and what techniques transfer from `net/http` and `sync` reading versus what is unique to `runtime`. Source excerpts target Go 1.22+ on `linux/amd64`; structures shift between versions, so always check `git blame` for the version you are reading.

---

## 1. The runtime as a self-hosted package

`runtime` compiles as Go but with rules that no other package follows. It implements the scheduler that runs *itself*. It manages the heap that holds *itself*. It services the GC that scans *itself*. This circularity is solved through bootstrap restrictions and compiler annotations.

The bootstrap problem is concrete. Consider `runtime.newproc` — it starts a new goroutine. To call `newproc`, you need a goroutine (`g`). To allocate memory for the new `g`, you need the heap. To use the heap, you need write barriers, which need the GC, which needs goroutines. The runtime breaks this cycle by:

1. **Pre-allocating system goroutines** at startup (`g0`, `gsignal`, `m0.g0`). These exist before user code.
2. **Running scheduler code on `g0`** — a special "scheduler goroutine" per OS thread (`m`). User goroutines run on their own stacks; scheduler decisions run on `g0`'s stack.
3. **Marking functions that cannot allocate** with `//go:nosplit` and `//go:nowritebarrier`. These compile differently — no stack-growth checks, no GC barriers.
4. **Bootstrapping in assembly.** The first instruction of a Go process is in `runtime/asm_amd64.s`, not Go. It sets up `g0`, then calls `runtime.rt0_go`, which sets up everything else.

The reading rule that follows: **most runtime functions cannot be called from arbitrary Go code, and most are called only from other runtime functions or from compiler-generated stubs.** A `runtime.chansend` call you see in a stack trace was emitted by the compiler when you wrote `ch <- x`, not by your code.

```
user code:                ch <- x
compiler emits:           runtime.chansend1(c, &x)
chansend1 calls:          chansend(c, ep, true, getcallerpc())
chansend may park on:     gopark → schedule() on g0
schedule() picks next g:  execute(gp, false) → gogo(&gp.sched)   (asm)
```

Every Go statement that "feels like a language feature" — `go f()`, `defer`, `ch <- x`, `m[k] = v`, `make([]T, n)`, even `+` on strings — is a call into runtime. Reading runtime is reading the implementation of the language itself.

---

## 2. The five dialect markers

The runtime introduces compiler pragmas — magic comments prefixed `//go:` — that change codegen. Most Go programmers never see them; runtime is *built* of them. Five matter most for source reading.

### 2.1 `//go:nosplit` — no stack-growth check

Every Go function preamble checks "is the stack about to overflow? If so, grow it". This check itself uses the stack. Functions that *implement* stack growth, or run with the scheduler holding locks, cannot tolerate this check. `//go:nosplit` removes it.

```go
// from runtime/stubs.go, simplified
//go:nosplit
func getg() *g
```

`getg()` returns the current goroutine pointer. It is implemented in assembly (read from a register on amd64) and must not split — the result *is* how stack splits know where to find the stack bounds.

### 2.2 `//go:nowritebarrier` — no GC write barrier

The GC inserts a write barrier on every pointer store to maintain its tri-color invariant. Functions in the write barrier code path itself cannot use barriers (infinite recursion). They are tagged `//go:nowritebarrier` and the compiler emits raw stores.

```go
// from runtime/mbarrier.go, simplified
//go:nowritebarrier
//go:nosplit
func wbBufFlush1(pp *p) {
    // ... flush write barrier buffer; cannot itself use barriers ...
}
```

There is also `//go:nowritebarrierrec` ("nowritebarrier recursive") — applies to the function *and everything it calls*. If a tagged function calls a function that *would* use a write barrier, compile error.

### 2.3 `//go:systemstack` — must run on g0

Some operations (acquiring scheduler locks, manipulating Ms) must not run on a user goroutine's small stack — they need the larger system stack. The compiler enforces this.

```go
// from runtime/proc.go, simplified
//go:systemstack
func startTheWorld() int64 {
    return startTheWorldWithSema()
}
```

To call a `//go:systemstack` function from a user goroutine, you go through `systemstack(fn)` — an assembly trampoline that switches stacks. Reading runtime source you will see `systemstack(func() { ... })` constantly; it marks a stack boundary, not just a closure.

### 2.4 `//go:linkname` — link to a private symbol

Normally, `sync.runtime_Semacquire` (an unexported name in package `sync`) cannot be defined — only `sync` itself can define `sync.*`. `//go:linkname` is the override: it tells the linker "this symbol resolves to that symbol in another package, regardless of visibility".

```go
// from runtime/sema.go, simplified
//go:linkname sync_runtime_Semacquire sync.runtime_Semacquire
func sync_runtime_Semacquire(s *uint32) {
    semacquire1(s, false, semaBlockProfile, 0, waitReasonSemacquire)
}
```

The `sync` package declares `func runtime_Semacquire(s *uint32)` with no body; the linker wires it to `runtime.sync_runtime_Semacquire`. This is the only legal way for stdlib packages to reach into runtime. We trace one end-to-end (§7).

### 2.5 `//go:notinheap` — not GC-managed memory

A struct tagged `//go:notinheap` must never be allocated on the GC heap. The compiler refuses `new(T)` for such a `T`. Used for memory that lives outside the normal Go heap — `mheap`, `mspan`, `mcache` — to break recursion in the allocator.

```go
// from runtime/mheap.go, simplified
//go:notinheap
type mspan struct {
    next *mspan      // ordinary pointer, but no write barrier needed
    prev *mspan
    // ...
}
```

`//go:notinheap` types' pointers do not trigger write barriers either — they cannot point at heap objects (compiler enforces) so the GC need not track them.

There are a dozen more (`//go:noinline`, `//go:noescape`, `//go:cgo_unsafe_args`, `//go:uintptrescapes`, …) but these five define the dialect. Recognising them on sight is the entry fee.

---

## 3. The `g` register: how runtime knows "current goroutine"

C runtimes find the current thread through `__thread` TLS or `pthread_self()`. Go has its own answer: on every architecture, one register is permanently dedicated to holding the current `*g`.

On amd64, this register is `R14` (since Go 1.17 register ABI; previously it was loaded from `FS:0x30`). On arm64, it is `R28`. The compiler emits code that reads from this register whenever Go code needs `getg()`.

```go
// from runtime/stubs.go
// getg returns the pointer to the current g.
// The compiler rewrites calls to this function into instructions
// that fetch the g directly. (In most contexts this is R14 on amd64.)
func getg() *g
```

The corresponding assembly stub (older convention, still present for non-register-ABI paths):

```asm
// from runtime/asm_amd64.s, simplified
TEXT runtime·getg(SB),NOSPLIT,$0-8
    MOVQ (TLS), AX
    MOVQ AX, ret+0(FP)
    RET
```

Why a register and not a global? **Goroutines move between OS threads.** A global variable per process is wrong (multiple goroutines run concurrently). TLS per OS thread is correct but slow. A dedicated register is one instruction. The cost: one fewer general-purpose register everywhere.

The reading consequence: every time you see `gp := getg()` you should mentally translate "load R14". Every time you see `mp := getg().m` you are reading: current goroutine → its current OS thread. The runtime's data graph is rooted in this single register.

---

## 4. Source walkthrough: `runtime/chan.go::chansend`

`chansend` implements `ch <- x`. It is the single most-read runtime function — every channel send goes through it. Roughly 150 lines.

```go
// from runtime/chan.go, simplified
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    if c == nil {
        if !block { return false }            // (1) nil + non-block: report busy
        gopark(nil, nil, waitReasonChanSendNilChan, traceBlockForever, 2)
        throw("unreachable")                   // (2) nil + block: forever park
    }

    if !block && c.closed == 0 && full(c) {
        return false                           // (3) fast path: select non-default
    }

    var t0 int64
    if blockprofilerate > 0 { t0 = cputicks() }

    lock(&c.lock)                              // (4) acquire channel mutex

    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("send on closed channel"))   // (5) closed-channel panic
    }

    if sg := c.recvq.dequeue(); sg != nil {
        // (6) direct handoff: receiver is parked, hand value straight to it
        send(c, sg, ep, func() { unlock(&c.lock) }, 3)
        return true
    }

    if c.qcount < c.dataqsiz {
        // (7) buffered, space available: copy into ring buffer
        qp := chanbuf(c, c.sendx)
        typedmemmove(c.elemtype, qp, ep)
        c.sendx++
        if c.sendx == c.dataqsiz { c.sendx = 0 }
        c.qcount++
        unlock(&c.lock)
        return true
    }

    if !block {
        unlock(&c.lock)
        return false                           // (8) select non-default: no space
    }

    // (9) Block: enqueue self on sendq and park.
    gp := getg()
    mysg := acquireSudog()
    mysg.elem = ep
    mysg.g = gp
    mysg.c = c
    gp.waiting = mysg
    c.sendq.enqueue(mysg)
    atomic.Store8(&gp.parkingOnChan, 1)
    gopark(chanparkcommit, unsafe.Pointer(&c.lock),
        waitReasonChanSend, traceBlockChanSend, 2)

    // (10) Unparked by a receiver or by close. Clean up.
    KeepAlive(ep)
    if mysg != gp.waiting { throw("G waiting list is corrupted") }
    gp.waiting = nil
    closed := !mysg.success
    mysg.c = nil
    releaseSudog(mysg)
    if closed {
        if c.closed == 0 { throw("chansend: spurious wakeup") }
        panic(plainError("send on closed channel"))
    }
    return true
}
```

Annotated structure:

- **(1)–(3)** Pre-lock fast paths. Avoid the mutex when behaviour is deterministic.
- **(4)–(5)** Lock, then re-check `closed`. The check before lock is racy; this one is authoritative.
- **(6)** Direct handoff. If a receiver is already parked, the value never enters the buffer — it goes straight from sender's stack to receiver's destination. This is the unbuffered-channel hot path and the buffered-channel synchronisation point.
- **(7)** Buffered queue. Ring buffer at `c.buf`, `sendx` is the write index. `typedmemmove` is the typed copy that drives write barriers.
- **(8)** Non-blocking branch for `select { case ch <- x: ... default: ... }`.
- **(9)** Park. `acquireSudog` allocates a `sudog` (suspended-goroutine record) from a per-P cache. The `chanparkcommit` is the *unlock function* — `gopark` calls it after the goroutine is in `Gwaiting`, ensuring the lock is held until parking is committed (otherwise a receiver could wake us before we are parkable).
- **(10)** Resumed. Either a receiver picked us (success), or `close(c)` woke us with `success=false` and we must panic.

The two patterns to memorise: **(a) pre-lock fast paths + lock + authoritative re-check**, and **(b) park-with-commit-function** — the same shape recurs in `sync.Mutex.lockSlow`, `sync.WaitGroup.Wait`, `time.Sleep`, every blocking primitive.

---

## 5. Source walkthrough: `runtime/panic.go::gopanic`

`gopanic` runs when `panic(x)` executes. It walks the defer chain, invokes each deferred function, and either recovers or terminates the program. ~100 lines.

```go
// from runtime/panic.go, simplified
func gopanic(e any) {
    gp := getg()
    if gp.m.curg != gp {
        print("panic: ")
        printany(e)
        print("\n")
        throw("panic on system stack")          // (1) only user g may panic
    }

    var p _panic
    p.arg = e
    p.link = gp._panic
    gp._panic = (*_panic)(noescape(unsafe.Pointer(&p)))  // (2) push panic frame

    runningPanicDefers.Add(1)

    for {
        d := gp._defer
        if d == nil { break }                   // (3) no more defers → fatal

        // (4) If this defer was already started by a previous panic, skip it.
        if d.started {
            if d._panic != nil { d._panic.aborted = true }
            d._panic = nil
            if !d.openDefer {
                d := d
                gp._defer = d.link
                freedefer(d)
                continue
            }
        }

        d.started = true
        d._panic = (*_panic)(noescape(unsafe.Pointer(&p)))

        // (5) Invoke the deferred call. If d.openDefer, we run inline-
        //     compiled defers; else we call the closure via reflectcall.
        done := true
        if d.openDefer {
            done = runOpenDeferFrame(d)
            if !done { addOneOpenDeferFrame(gp, 0, nil) }
        } else {
            p.argp = unsafe.Pointer(getargp())
            reflectcall(nil, unsafe.Pointer(d.fn), deferArgs(d), uint32(d.siz), uint32(d.siz))
        }
        p.argp = nil

        // (6) Did the deferred function recover?
        if p.recovered {
            gp._panic = p.link
            // Drop panics aborted by the recovered one.
            for gp._panic != nil && gp._panic.aborted {
                gp._panic = gp._panic.link
            }
            if gp._panic == nil { gp.sig = 0 }
            gp.sigcode0 = uintptr(p.sp)
            gp.sigcode1 = p.pc
            mcall(recovery)                      // (7) jump back into d's caller
            throw("recovery failed")
        }

        // (8) Defer returned normally; pop it and continue.
        if done {
            d := d
            gp._defer = d.link
            freedefer(d)
        }
    }

    // (9) No defer recovered. Print and crash.
    preprintpanics(gp._panic)
    fatalpanic(gp._panic)
    *(*int)(nil) = 0
}
```

The structure to internalise:

- **(2)** A `_panic` record links to outer panics. Nested `panic` inside a deferred function pushes a new `_panic` on top; the outer one is `aborted`.
- **(3)** The loop drives one defer at a time. `gopanic` does not run defers itself — it iterates and reflect-calls each.
- **(5)** Two defer flavours. **Open-coded defers** (Go 1.14+) are inlined into the function and tracked by a bitmask in the frame — fast for the common case of a small bounded set of defers per function. **Heap-allocated defers** are linked through `gp._defer` and called via `reflectcall`.
- **(6)–(7)** Recovery is detected by `p.recovered` being set inside the deferred function (by a call to `runtime.gorecover` which sets it). On recovery, `mcall(recovery)` switches stacks and jumps to the deferred function's caller — bypassing the normal return path. This is how `recover()` "unwinds" without C++-style exceptions.
- **(9)** No recovery: print all panics on the chain, call `fatalpanic`, then write to nil to ensure we crash if anything beyond that returns.

`gopanic` reads as a state machine, not a control flow. The chain of `_panic` records, the `started`/`aborted` flags on `_defer`, the open-coded defer bitmask — they all encode "where are we in the unwind". This is what `defer`/`recover` is, mechanically.

---

## 6. Source walkthrough: `runtime/proc.go::newproc` and `newproc1`

`go f(x)` compiles to `runtime.newproc(siz, &f)`. `newproc` is the entry; `newproc1` does the work. ~80 lines combined.

```go
// from runtime/proc.go, simplified
func newproc(fn *funcval) {
    gp := getg()
    pc := getcallerpc()
    systemstack(func() {                          // (1) switch to g0
        newg := newproc1(fn, gp, pc)
        pp := getg().m.p.ptr()
        runqput(pp, newg, true)                   // (2) put on local runq
        if mainStarted {
            wakep()                               // (3) maybe wake an M
        }
    })
}

func newproc1(fn *funcval, callergp *g, callerpc uintptr) *g {
    mp := acquirem()                              // (4) lock to M
    pp := mp.p.ptr()
    newg := gfget(pp)
    if newg == nil {
        newg = malg(stackMin)                     // (5) new g with fresh stack
        casgstatus(newg, _Gidle, _Gdead)
        allgadd(newg)
    }

    totalSize := uintptr(4*goarch.PtrSize + sys.MinFrameSize)
    totalSize = alignUp(totalSize, sys.StackAlign)
    sp := newg.stack.hi - totalSize               // (6) carve top of stack

    memclrNoHeapPointers(unsafe.Pointer(&newg.sched), unsafe.Sizeof(newg.sched))
    newg.sched.sp = sp
    newg.stktopsp = sp
    newg.sched.pc = abi.FuncPCABI0(goexit) + sys.PCQuantum
    newg.sched.g = guintptr(unsafe.Pointer(newg))
    gostartcallfn(&newg.sched, fn)                // (7) splice fn onto stack
    newg.parentGoid = callergp.goid
    newg.gopc = callerpc
    newg.ancestors = saveAncestors(callergp)
    newg.startpc = fn.fn
    if isSystemGoroutine(newg, false) {
        sched.ngsys.Add(1)
    }
    casgstatus(newg, _Gdead, _Grunnable)          // (8) ready to run
    newg.goid = pp.goidcache
    pp.goidcache++
    releasem(mp)
    return newg
}
```

Key reading points:

- **(1)** All of `newproc` runs on the system stack. Scheduling primitives must not be paused mid-step by stack growth.
- **(2)** `runqput` puts the new `g` on the *current P's* local run queue. Not the global queue. This is the locality optimisation: child runs near parent.
- **(3)** `wakep()` wakes a spinning or idle M if any. Without this, a process with one busy goroutine could spawn 1000 children and never use the other cores.
- **(5)** `gfget` reuses dead `g`s from a free list. New stack allocation (`malg`) only on miss. This is why creating a million goroutines and exiting them does not allocate a million stacks — they recycle.
- **(6)–(7)** The clever bit. The new `g`'s stack pointer is set so that when the scheduler does `gogo(&newg.sched)`, control resumes at `gostart` which calls `fn`. `gostartcallfn` writes the return address to `goexit` — so when `fn` returns, it returns to `goexit`, which calls `goexit1`, which destroys the goroutine. This is how `go f(); return` cleans up.
- **(8)** Status transition. The status machine is the truth: a `g` is `_Gidle`, `_Grunnable`, `_Grunning`, `_Gsyscall`, `_Gwaiting`, `_Gdead`. Every transition uses `casgstatus` (atomic CAS) and many parts of runtime branch on the current value.

```
status:   _Gidle ──malg──► _Gdead ──newproc1──► _Grunnable
            │                                       │
            ▼                                       ▼ execute
         (never)                               _Grunning
                                                    │
                                  ┌─────────────────┼─────────────────┐
                                  ▼                 ▼                 ▼
                              gopark           entersyscall         goexit
                              _Gwaiting        _Gsyscall            _Gdead → gfput
```

Read `proc.go` with this diagram beside you. Every `casgstatus(gp, A, B)` is an edge.

---

## 7. The `//go:linkname` back-channel: `sync.runtime_Semacquire` → `runtime.sema.go`

`sync.Mutex.Lock` ultimately blocks on a semaphore. The semaphore is in runtime (it needs to park goroutines), but it is invoked from `sync`. The link is `//go:linkname`.

Start in `sync/runtime.go`:

```go
// from sync/runtime.go, simplified
// runtime_Semacquire blocks until *s > 0, then atomically decrements it.
// It is intended as a simple sleep primitive for use by the sync library.
func runtime_Semacquire(s *uint32)

// from sync/mutex.go, simplified
func (m *Mutex) lockSlow() {
    // ... spin + CAS attempts ...
    runtime_SemacquireMutex(&m.sema, queueLifo, 1)
    // ... woken up; resume lock attempt ...
}
```

`sync/runtime.go` declares a function with no body. The compiler accepts this only because the linker will resolve it. Resolution is on the runtime side:

```go
// from runtime/sema.go, simplified
//go:linkname sync_runtime_Semacquire sync.runtime_Semacquire
func sync_runtime_Semacquire(s *uint32) {
    semacquire1(s, false, semaBlockProfile, 0, waitReasonSemacquire)
}

//go:linkname sync_runtime_SemacquireMutex sync.runtime_SemacquireMutex
func sync_runtime_SemacquireMutex(s *uint32, lifo bool, skipframes int) {
    semacquire1(s, lifo, semaBlockProfile|semaMutexProfile, skipframes, waitReasonSyncMutexLock)
}
```

The `//go:linkname` directive says: "the symbol `sync.runtime_Semacquire` resolves to this function". `sync_runtime_Semacquire` is the linker name; `sync.runtime_Semacquire` is the call site.

`semacquire1` itself is conventional runtime code — `semroot(addr)` finds the per-address treap of waiters, parks the current goroutine with `goparkunlock`. The call chain end-to-end:

```
sync.Mutex.Lock()             [sync/mutex.go]
  └─ m.lockSlow()
       └─ runtime_SemacquireMutex(&m.sema, ...)        [declared in sync/runtime.go]
            └─ sync_runtime_SemacquireMutex(...)       [linknamed in runtime/sema.go]
                 └─ semacquire1(s, ...)
                      └─ goparkunlock(&root.lock, waitReasonSyncMutexLock, ...)
                           └─ gopark(...)
                                └─ mcall(park_m)        [asm switch to g0]
                                     └─ schedule()
```

Every `sync` primitive (Mutex, RWMutex, WaitGroup, Cond, Once) terminates in a `//go:linkname` to runtime. The set is documented in `runtime/HACKING.md`. **When you do not find the implementation in the package directory, search for `//go:linkname <package>_<name>` in runtime.** This single grep pattern is the second-most-useful runtime reading tool, after `git blame`.

---

## 8. Assembly trampolines: `mcall`, `systemstack`, `gogo`

Three assembly functions implement the runtime's stack-switching control flow. Read them once; they reappear behind every blocking primitive.

### 8.1 `runtime·mcall` — switch from user g to g0

`mcall(fn)` saves the current goroutine's state and runs `fn` on the `g0` stack. After `fn` returns (or never, for `schedule`), control resumes elsewhere — `mcall` itself never returns.

```asm
// from runtime/asm_amd64.s, simplified
TEXT runtime·mcall<ABIInternal>(SB), NOSPLIT, $0-8
    MOVQ    AX, DX            // DX = fn (incoming first arg, ABI register)
    MOVQ    g_sched+gobuf_g(R14), BX   // BX = g.sched.g (which is current g)
    MOVQ    0(SP), BX                  // caller's PC
    MOVQ    BX, (g_sched+gobuf_pc)(R14)
    LEAQ    fn+0(FP), BX               // caller's SP
    MOVQ    BX, (g_sched+gobuf_sp)(R14)
    MOVQ    BP, (g_sched+gobuf_bp)(R14)

    MOVQ    g_m(R14), BX
    MOVQ    m_g0(BX), SI               // SI = g0
    CMPQ    SI, R14
    JNE     goodm
    JMP     runtime·badmcall(SB)
goodm:
    MOVQ    R14, AX                    // AX = old g (arg to fn)
    MOVQ    SI, R14                    // current g = g0
    get_tls(CX)
    MOVQ    R14, g(CX)
    MOVQ    (g_sched+gobuf_sp)(R14), SP   // switch to g0 stack
    PUSHQ   AX
    MOVQ    DX, BX
    MOVQ    0(DX), DX
    CALL    DX                         // call fn(old_g)
    POPQ    AX
    JMP     runtime·badmcall2(SB)
    RET
```

Sequence: save current `g`'s PC/SP/BP into `g.sched`, swap the `g` register to `g0`, swap SP to `g0.sched.sp`, call `fn(old_g)`. `fn` typically calls `schedule()` and never returns — execution resumes on a different `g` via `gogo` (below).

### 8.2 `runtime·systemstack` — call fn on g0, return to caller

`systemstack(fn)` is `mcall`'s safe cousin: it runs `fn` on `g0`, then *returns* to the caller on the original goroutine.

```asm
// from runtime/asm_amd64.s, simplified
TEXT runtime·systemstack(SB), NOSPLIT, $0-8
    MOVQ    fn+0(FP), DI
    MOVQ    g_m(R14), BX
    MOVQ    m_gsignal(BX), DX
    CMPQ    R14, DX
    JEQ     noswitch                  // already on gsignal
    MOVQ    m_g0(BX), DX
    CMPQ    R14, DX
    JEQ     noswitch                  // already on g0

    // Save state of caller goroutine.
    MOVQ    $runtime·systemstack_switch(SB), SI
    MOVQ    SI, (g_sched+gobuf_pc)(R14)
    MOVQ    SP, (g_sched+gobuf_sp)(R14)
    MOVQ    BP, (g_sched+gobuf_bp)(R14)
    MOVQ    R14, (g_sched+gobuf_g)(R14)

    // Switch to g0.
    MOVQ    DX, R14
    get_tls(CX); MOVQ R14, g(CX)
    MOVQ    (g_sched+gobuf_sp)(R14), BX
    MOVQ    BX, SP

    // Call fn.
    MOVQ    DI, DX
    MOVQ    0(DI), DI
    CALL    DI

    // Switch back. (omitted: symmetric restore)
    RET
```

The `noswitch` paths matter — `systemstack` is cheap (one branch) when already on `g0`, expensive (full stack switch) otherwise. Runtime functions often call `systemstack` unconditionally; the cost is paid only when called from a user goroutine.

### 8.3 `runtime·gogo` — jump to a saved gobuf

After `schedule()` picks the next `g`, it calls `gogo(&gp.sched)` to actually start running it.

```asm
// from runtime/asm_amd64.s, simplified
TEXT runtime·gogo<ABIInternal>(SB), NOSPLIT, $0-8
    MOVQ    buf+0(FP), BX               // BX = gobuf*
    MOVQ    gobuf_g(BX), DX
    MOVQ    0(DX), CX                   // make sure g != nil (load fault if so)
    JMP     gogo<>(SB)

TEXT gogo<>(SB), NOSPLIT, $0
    get_tls(CX); MOVQ DX, g(CX)
    MOVQ    DX, R14                     // R14 = current g
    MOVQ    gobuf_sp(BX), SP            // restore SP
    MOVQ    gobuf_ret(BX), AX
    MOVQ    gobuf_ctxt(BX), DX
    MOVQ    gobuf_bp(BX), BP
    MOVQ    $0, gobuf_sp(BX)            // clear to ease GC scanning
    MOVQ    $0, gobuf_ret(BX)
    MOVQ    $0, gobuf_ctxt(BX)
    MOVQ    $0, gobuf_bp(BX)
    MOVQ    gobuf_pc(BX), BX
    JMP     BX                          // jump to gobuf.pc
```

This is "goroutine resume" in 14 instructions. Set R14 to the new `g`, restore SP/BP/AX/DX from `gobuf`, jump to `gobuf.pc`. The next thing the CPU executes is whatever code that goroutine last paused at.

Three trampolines, three roles: **`mcall` enters the scheduler, `systemstack` borrows g0 briefly, `gogo` resumes a goroutine.** The entire blocking story — channels, mutexes, syscalls, GC park — terminates in some combination of these three.

---

## 9. `runtime/runtime2.go` as schema

`runtime2.go` declares the core types: `g`, `m`, `p`, `sched`, `hchan`, `mutex`, `funcval`, `_defer`, `_panic`, status constants. It is a 1200-line file with almost no logic — it is the *schema* of the runtime. Reading it is reading the data model.

```go
// from runtime/runtime2.go, simplified
type g struct {
    stack        stack       // offset 0; assembly hardcodes this
    stackguard0  uintptr     // checked by stack-split prologue
    stackguard1  uintptr     // checked by C g0/gsignal stack

    _panic       *_panic
    _defer       *_defer
    m            *m
    sched        gobuf
    syscallsp    uintptr
    syscallpc    uintptr
    stktopsp     uintptr
    param        unsafe.Pointer
    atomicstatus atomic.Uint32
    stackLock    uint32
    goid         uint64
    schedlink    guintptr
    waitsince    int64
    waitreason   waitReason
    preempt      bool
    preemptStop  bool
    preemptShrink bool
    asyncSafePoint bool
    paniconfault bool
    gcscandone   bool
    throwsplit   bool
    activeStackChans bool
    parkingOnChan atomic.Bool
    raceignore   int8
    nocgocallback bool
    tracking     bool
    trackingSeq  uint8
    trackingStamp int64
    runnableTime int64
    lockedm      muintptr
    sig          uint32
    writebuf     []byte
    sigcode0     uintptr
    sigcode1     uintptr
    sigpc        uintptr
    parentGoid   uint64
    gopc         uintptr
    ancestors    *[]ancestorInfo
    startpc      uintptr
    racectx      uintptr
    waiting      *sudog
    cgoCtxt      []uintptr
    labels       unsafe.Pointer
    timer        *timer
    selectDone   atomic.Uint32
    coroarg      *coro

    gcAssistBytes int64
}
```

Three patterns to recognise:

**Layout invariants encoded as field order.** `stack` is first (offset 0) because assembly reads it without a runtime offset. `stackguard0` is next because the function prologue tests `SP <= g.stackguard0` with a hardcoded offset. Move a field and the assembly breaks. Comments like `// offset hardcoded; do not move` mark these landmines.

**Cache-line padding.** `runtime.p` (per-P scheduler state) and `mcache` are padded to 128 bytes (two cache lines on most modern x86) to avoid false sharing between cores. You will see `pad [N]byte` fields or explicit `//go:notinheap` types with sysAlloc-controlled placement.

**Atomic field placement.** Fields touched by atomics (`atomicstatus`, `parkingOnChan`, `preempt`) are placed away from fields touched by non-atomic writes, to minimise the false sharing of fields the scheduler hot-paths touch. The `atomic.Uint32` type itself is alignment-correct (8-byte aligned on 32-bit platforms via padding in its definition).

`hchan` shows the same discipline:

```go
// from runtime/chan.go, simplified
type hchan struct {
    qcount   uint           // total data in the queue
    dataqsiz uint           // size of the circular queue
    buf      unsafe.Pointer // points to an array of dataqsiz elements
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint           // send index
    recvx    uint           // receive index
    recvq    waitq          // list of recv waiters
    sendq    waitq          // list of send waiters
    lock     mutex          // contended by every send/recv
}
```

The `lock` is at the end. `qcount` and `dataqsiz` are at the start (read pre-lock by `full()` and `len(c)`). The order reflects access pattern: fields-read-without-lock first, fields-read-under-lock middle, lock last.

Reading `runtime2.go` first, before any logic file, is how senior runtime readers calibrate. The schema constrains every algorithm.

---

## 10. Tests as spec: `runtime/chan_test.go`

Runtime has unusually thorough tests. Reading them reveals invariants the code never states.

```go
// from runtime/chan_test.go, simplified
func TestSendClose(t *testing.T) {
    c := make(chan int, 1)
    done := make(chan bool)
    go func() {
        defer func() {
            if recover() == nil {
                t.Errorf("send on closed channel did not panic")
            }
            done <- true
        }()
        c <- 1                       // first send: buffered, succeeds
        c <- 2                       // second send: blocks, then panics on close
    }()
    time.Sleep(10 * time.Millisecond)
    close(c)
    <-done
}
```

This test pins down **"close while sender is parked panics in the sender"**. The closer's `closechan` walks the `sendq` and wakes each sender with `sg.success = false`; the sender's `chansend` (§4 step 10) sees `!success` and panics. Without this test, you might think `close` simply releases buffered sends — instead it kills them.

Other patterns to grep for in runtime tests:

- `TestBlocking…` — pins down which operations are guaranteed to block.
- `TestNonblocking…` — pins down which operations are guaranteed not to block.
- `TestRace…` — pins down which operations are race-detector-safe.
- `BenchmarkChan…` — performance contracts; regressions here are usually treated as bugs.
- `TestStackGrow`, `TestStackShrink` — invariants of the stack copier.

For any runtime function you read, `grep -l <FuncName>` in `runtime/*_test.go` and read the matching tests. They are shorter than the implementation, executable, and document edge cases.

---

## 11. Comparative reading: `net/http`, `sync`, `runtime`

The three packages share a top-down trace-one-call-chain discipline, but `runtime` adds two unique challenges.

| Aspect | `net/http` | `sync` | `runtime` |
|---|---|---|---|
| Entry point | Handler interface; `Server.Serve` | `Mutex.Lock`, `WaitGroup.Add/Wait` | Compiler-emitted calls (`chansend1`, `newproc`, `gopanic`) |
| Reading order | Server → request lifecycle → transport | Type def → fast path → slow path | `runtime2.go` (schema) → entry → asm trampoline |
| Language | Pure Go | Pure Go + 5–10 `//go:linkname` to runtime | Go + heavy pragmas + asm |
| Lock primitives | `sync.Mutex` (caller-visible) | `runtime_Semacquire` (linked to runtime) | `lock(&l)`, `gopark`, status CAS |
| Stack model | One goroutine per request | Caller's goroutine | Two stacks: g and g0; explicit switches |
| Version drift | API stable; internals refactor often | API frozen; internals refactor often | Internals refactor *every release*; check `git log` |
| Asm presence | None | None | ~5000 lines of arch-specific asm |
| Test density | Integration heavy | Race-test heavy | Unit + benchmark + race + ASM-level |

What transfers from `net/http` and `sync` reading:

- **Top-down trace from one entry point.** Pick `chansend`, follow every call. Do not depth-first into every callee on first pass; sketch the spine.
- **One file at a time.** `chan.go`, then `proc.go`, then `panic.go`. Mixing causes confusion.
- **Read tests after the function, before re-reading.** Tests pin invariants.
- **Use `git blame` to find when a structure changed.** Runtime layouts drift; blame reveals the commit and the rationale.

What is unique to `runtime`:

- **Asm stubs are part of the call chain.** You cannot skip `gogo`, `mcall`, `systemstack`. They are not boilerplate; they are the load-bearing structure.
- **Pragmas change semantics.** `//go:nosplit` is not a hint; the function is genuinely allocation-free and a missing pragma is a bug.
- **The status machine drives control flow.** `casgstatus` is the actual control transfer, not function calls. Trace by status transitions, not by call graph.
- **Version-specific layout.** A 1.22 reader of 1.18 source will misread fields. Pin to the version (`go version` of your toolchain) and grep within `$(go env GOROOT)/src/runtime`.

The discipline that works for all three: **trace one path from caller to deepest callee, ignore everything else, draw the spine, then go back and fill in branches**. Runtime adds: the spine includes asm and the spine is gated by pragmas; read both as first-class.

---

## 12. Tools

Six tools turn runtime reading from "what is this?" into "I know exactly what this does".

**`dlv`** (Delve). Set breakpoints in runtime functions; step through `chansend`, watch `getg().sched.pc` change. Required runtime-aware debugger flags:

```
dlv exec ./prog --check-go-version=false
(dlv) break runtime.chansend
(dlv) condition 1 c.dataqsiz > 0
(dlv) continue
(dlv) print *c
(dlv) print *getg()
```

`dlv` understands `g`/`m`/`p` natively. `goroutines` lists all; `goroutine N` switches; `stack` shows the Go stack across stack-switch boundaries.

**`go tool objdump`**. Disassemble compiled binary; see the actual instructions emitted for a Go function:

```
go tool objdump -s 'main\.fn' ./prog | less
```

Reveals what the compiler did with your `//go:noinline`, your range loop, your channel send. The output interleaves source line numbers with x86 — exactly the bridge between Go source and asm trampolines.

**`GOSSAFUNC=funcname go build`**. Emits `ssa.html` showing the SSA pass output of one function. For `runtime.chansend`, this is how you see what survives inlining, escape analysis, write-barrier insertion. Mandatory for understanding why a "trivial" Go function compiles to 200 instructions.

**`go build -gcflags='-S -m'`**. `-S` emits Go asm (the SSA backend's pre-linker output, more readable than objdump). `-m` prints escape analysis decisions ("moved to heap: x"). For runtime code, `-m=2` adds inlining decisions:

```
go build -gcflags='-S -m=2' runtime 2>&1 | grep chansend
```

**`runtime/trace`**. The `go tool trace` viewer shows scheduler events: goroutine create, block, unblock, syscall enter/exit, GC mark phases, P state transitions. The visualisation is the scheduler running in real time.

**`runtime/pprof`**. CPU, heap, goroutine, mutex, block profiles. The block profile is uniquely useful for runtime study — it samples `gopark` calls and shows where goroutines spend their wait time. Configure: `runtime.SetBlockProfileRate(1)`.

The reading workflow: pick a function, read the source, set a `dlv` breakpoint, run a triggering program, step through, watch the registers. Repeat until "what does `mcall(park_m)` do at this point" is no longer a question.

---

## 13. A 10-step reading path

A serious reader can absorb the runtime in roughly 10 sessions of 2–3 hours each. The order matters; later steps depend on earlier ones.

1. **`runtime2.go` — schema.** Read every struct definition. Don't read the logic files yet. Sketch a diagram of `g → m → p → sched` and how `hchan`, `_defer`, `_panic`, `sudog` link in. The point: you are not reading code yet, you are learning the data model. (~3 hours.)

2. **`stubs.go` + `asm_amd64.s` — primitives.** `getg`, `mcall`, `systemstack`, `gogo`, `morestack`, `gosave`. Read each asm function with its Go counterpart side by side. Annotate every register move. (~3 hours.)

3. **`proc.go` — scheduler, half 1.** Start with `schedule()`. Trace one full path: `schedule → findRunnable → execute → gogo`. Ignore `findRunnable`'s details — note "it eventually returns a `g`". (~3 hours.)

4. **`proc.go` — scheduler, half 2.** `findRunnable` in full: local runq → global runq → netpoll → work stealing. `newproc`/`newproc1` (§6). `gopark`/`goready`. The state machine of `g.atomicstatus`. (~3 hours.)

5. **`chan.go` — channels.** `chansend`/`chanrecv` (§4). `closechan`. `selectgo` is later — leave for now. Run §10's test in `dlv`; watch the `hchan` change. (~2 hours.)

6. **`panic.go` — defer/panic/recover.** `gopanic` (§5). `runtime.deferreturn` (compiler-emitted; read its assembly). Open-coded defers. `recovery`. (~2 hours.)

7. **`sema.go` — semaphores and `//go:linkname`.** Read every `//go:linkname` in runtime (`grep -rn //go:linkname runtime/`). Trace `sync.Mutex.Lock` through the linkname boundary (§7). Trace one more: `sync.WaitGroup.Wait`. (~2 hours.)

8. **`mgc.go` + `mbarrier.go` — GC overview.** Not a full pass — the GC is its own multi-day study. Goal: understand the mark phase as a goroutine running `gcBgMarkWorker`, and the write barrier as `wbBufFlush1`. (~3 hours.)

9. **`malloc.go` + `mheap.go` — allocator overview.** `mallocgc` entry point. The `mcache → mcentral → mheap → sysAlloc` hierarchy. Read `runtime/sizeclasses.go` once (auto-generated). Span states. (~3 hours.)

10. **`signal_unix.go` + `os_linux.go` — OS interface.** How signals are received and delivered to Go code. How `gsignal` differs from `g0`. How `Sleep` becomes `usleep` becomes `nanosleep` syscall. The boundary between Go-managed and kernel-managed scheduling. (~2 hours.)

After step 10, you can read any runtime function from cold. The remaining files — `select.go`, `map.go`, `slice.go`, `string.go`, `iface.go`, `mfinal.go`, `traceback.go`, `pprof.go` — all reduce to "data-structure logic + the primitives you already know". They are easier than steps 1–10.

```
schema      primitives    scheduler   channels   defer/panic   linkname   GC      alloc    OS
runtime2 →  stubs+asm  →  proc.go  →  chan.go →  panic.go  →  sema.go → mgc.go → malloc → signal
   (1)         (2)          (3-4)       (5)         (6)         (7)       (8)      (9)     (10)
```

Read in order. Skipping (1) is the most common failure mode — every other file references types you have not internalised, and the cognitive load compounds.

---

## 14. Closing principles

The runtime package looks intimidating because it is. It is the only Go code that operates under restrictions Go itself does not normally permit, calls primitives that other packages cannot call, runs on stacks the runtime itself manages, and is half written in assembly. But the difficulty is structural, not accidental — every restriction has a documented reason and every assembly stub does one specific thing.

1. **Treat runtime as a dialect, not "harder Go".** Recognise the five pragmas (`//go:nosplit`, `//go:nowritebarrier`, `//go:systemstack`, `//go:linkname`, `//go:notinheap`) on sight. They change semantics; they are not noise.

2. **`getg()` is one register.** Everywhere you see goroutine access, mentally translate to one instruction. The runtime's data graph is rooted in R14 (amd64) or R28 (arm64).

3. **Read the schema first.** `runtime2.go` is 1200 lines of structs with almost no logic. Read it before any algorithm file. Layout invariants — field order, padding, atomic placement — encode performance and correctness contracts the code never restates.

4. **Trace one call chain end-to-end.** `ch <- x → chansend1 → chansend → gopark → mcall(park_m) → schedule → gogo`. Memorise the spine. Don't depth-first into every callee.

5. **Assembly trampolines are first-class.** `mcall`, `systemstack`, `gogo`. Three functions, three roles: enter the scheduler, borrow g0, resume a goroutine. Every blocking primitive uses some combination.

6. **The status machine is the truth.** `casgstatus(gp, A, B)` is the actual control transfer. Trace runtime by status transitions, not by function calls.

7. **`//go:linkname` is the back-channel.** Stdlib packages reach into runtime through declarations in the package and linknames in `runtime/sema.go`, `runtime/runtime.go`, `runtime/lock_*.go`. `grep -rn '//go:linkname'` once and bookmark the result.

8. **Tests are spec.** Runtime tests pin invariants the code does not state. Read them after the implementation, before re-reading.

9. **Tools collapse the unknown.** `dlv` for live walking, `go tool objdump` for emitted code, `GOSSAFUNC` for SSA, `-gcflags='-S -m'` for codegen + escape, `go tool trace` for scheduler behaviour, `runtime/pprof` for block profiles. Use them.

10. **Version-pin everything.** Runtime internals change every release. A 1.18 layout is not a 1.22 layout. `go version`, `git -C $GOROOT log --oneline runtime/proc.go`, and `git blame` for the lines you are reading.

The reward for reading runtime is not trivia. It is the ability to predict why your goroutine is parked, what cost a `ch <- x` actually pays, why a `panic` in a deferred function behaves the way it does, and what `GOMAXPROCS=1` versus `=16` changes about your program — at the level of which instructions execute, not just at the level of documentation. Every other Go book stops at the API. Runtime source is where the API stops being magic.

---

## Further reading

- `go.dev/doc/asm` — Go's plan-9-flavoured assembler reference
- `runtime/HACKING.md` — official tour of runtime internals; lists `//go:linkname` pairs
- Dmitry Vyukov, *Scalable Go Scheduler Design Doc* — the M:P:G model spec, 2012
- Austin Clements, *Proposal: Eliminate STW stack re-scanning* — write barrier evolution
- Russ Cox, *Goroutines as a Concurrency Primitive* — scheduler design rationale
- `golang/go` issue tracker, label `compiler/runtime` — current changes in flight
- `src/cmd/compile/internal/ssa/_gen/genericOps.go` — operations the SSA backend lowers, including runtime calls the compiler emits
- `src/runtime/MAINTAINERS.md` — who to ask when something is unclear
- *The Go Programming Language Specification*, §"Run-time panics" and §"Goroutines" — the user-facing contracts runtime implements
- Ian Lance Taylor, *Go Internals* talks — multi-year recording series on the gc compiler and runtime
