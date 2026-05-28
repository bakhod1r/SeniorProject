# Runtime Source Dive — Professional

> Focus: read the runtime the way the people who wrote it read it. Open `runtime/proc.go` at line 5158 and follow `newproc` through `newproc1`, `runqput`, `schedule`, `mcall`, `gogo`, until the goroutine ends up running. Match the Go source to the assembly it depends on. Track which lines change between Go versions and why. This is not a tour; it is a guided dissection of the few paths that explain everything else.

References below are from `go1.25.3` on `linux/amd64`. Line numbers shift between minor releases — keep `git blame` open in `github.com/golang/go` and check the commit that introduced any line you are about to trust. The shapes are stable; the line numbers are not.

---

## 1. The four paths worth dissecting

The runtime is ~80 files of Go and ~30 of assembly. You will never read all of it. Four paths cover ~90% of the questions that drive people to read source in the first place:

| Path | Files | Why you read it |
|---|---|---|
| `go f()` becoming a runnable G | `proc.go` (`newproc`, `newproc1`, `runqput`) | Why is `go` so cheap? Where do new goroutines actually go? |
| The scheduler loop | `proc.go` (`schedule`, `findRunnable`, `execute`) | Why did my goroutine wait 8 ms before starting? |
| Stack switching | `asm_amd64.s` (`mcall`, `systemstack`, `gogo`) | Why does the runtime have a "g0"? What's TLS doing here? |
| Park/ready lifecycle | `proc.go` (`gopark`, `park_m`, `goready`, `ready`) | Why does the channel pass a callback? Who unlocks what? |

Every other interesting question — channel send, mutex slow path, GC stop-the-world, timer firing — composes those four. If you can read them, you can read the rest. The rest of this file walks each in order.

---

## 2. Path 1: `go f()` from compiler to run queue

### 2.1 The compiler rewrite

`go f(a, b)` is not a runtime call you can `grep` for. The compiler in `cmd/compile/internal/walk/order.go` and `cmd/compile/internal/walk/expr.go` rewrites it into:

```go
// pseudo-Go, what the compiler emits
__fn := f         // capture the funcval (closure + entry PC)
runtime.newproc(__fn)
```

For closures, the closure heap allocation happens here too — the funcval points at the entry of the closure body and carries captured variables in trailing fields. Run `go build -gcflags='-S' main.go 2>&1 | grep -A2 'CALL.*newproc'` and you will see exactly this:

```asm
; from `go f()` where f := func() { x++ }
LEAQ    main.main.func1·f(SB), AX     ; load funcval address into AX
CALL    runtime.newproc(SB)           ; spawn the goroutine
```

That is the entire calling convention: one register (`AX`) holds the `*funcval`, one CALL. Everything else is the runtime's problem.

### 2.2 `runtime.newproc` — `proc.go:5158`

```go
// from runtime/proc.go, paraphrased from go1.25
func newproc(fn *funcval) {
    gp := getg()                       // 1. current G (whoever ran `go f()`)
    pc := sys.GetCallerPC()            // 2. capture caller PC for traceback
    systemstack(func() {               // 3. switch to g0 for the rest
        newg := newproc1(fn, gp, pc, false, waitReasonZero)
        pp := getg().m.p.ptr()         // 4. now-on-g0; getg() returns g0
        runqput(pp, newg, true)        // 5. enqueue as runnext on owner P
        if mainStarted {
            wakep()                    // 6. wake an idle P if any
        }
    })
}
```

Line-by-line:

1. `getg()` is a compiler intrinsic: on amd64 it reads `g` from register `R14` (changed in Go 1.17 from TLS). Zero-cost; not a function call.
2. `sys.GetCallerPC()` reads the return address sitting on the stack. The runtime stores this in `newg.gopc` so `runtime/pprof` can attribute the goroutine to the `go` statement that started it.
3. `systemstack(fn)` is the critical pivot: most of `newproc` runs on g0 (the scheduler stack), not on the caller's goroutine stack. Why? Allocation of a new G may grow the heap, which may run write barriers, which must not happen on a user stack that the GC might be scanning. Run on g0, you sidestep that hazard.
4. After the `systemstack` pivot, `getg()` returns g0, and `g0.m.p` is the owner P of the current M. This is the only safe way to access `pp` here.
5. `runqput(pp, newg, true)` — second arg `next=true` is the optimization that makes child-goroutine spawn fast (§2.4).
6. `wakep()` — only after `main` has started. Before that, the scheduler is bootstrapping and waking Ps would be incorrect.

### 2.3 `newproc1` — the allocation

`newproc1` builds a `g`. The core sequence:

```go
// from runtime/proc.go:5176, heavily trimmed
func newproc1(fn *funcval, callergp *g, callerpc uintptr, parked bool, ...) *g {
    if fn == nil { fatal("go of nil func value") }
    mp := acquirem()
    pp := mp.p.ptr()
    newg := gfget(pp)                  // free-list of dead Gs on this P
    if newg == nil {
        newg = malg(stackMin)          // alloc fresh 8 KB stack
        casgstatus(newg, _Gidle, _Gdead)
        allgadd(newg)
    }
    sp := newg.stack.hi - uintptr(4*goarch.PtrSize+sys.MinFrameSize)
    memclrNoHeapPointers(unsafe.Pointer(&newg.sched), unsafe.Sizeof(newg.sched))
    newg.sched.sp = sp
    newg.sched.pc = abi.FuncPCABI0(goexit) + sys.PCQuantum
    newg.sched.g  = guintptr(unsafe.Pointer(newg))
    gostartcallfn(&newg.sched, fn)     // first gogo will land in fn
    newg.parentGoid, newg.gopc, newg.startpc = callergp.goid, callerpc, fn.fn
    casgstatus(newg, _Gdead, _Grunnable)
    releasem(mp)
    return newg
}
```

Two subtleties:

**The `goexit` return address.** `newg.sched.pc` is `goexit + PCQuantum`. `gostartcallfn` patches the saved frame so the *first* `gogo` resumes inside `fn` — but the bottom-of-stack return address still points at `runtime.goexit`. When `fn` returns, control flows to `goexit`, which marks the G `_Gdead` and reschedules. **You never `RET` out of `fn`; you `RET` into `goexit`.**

**`gfget`.** Dead Gs are pooled per-P (`pp.gFree`). In steady state `go f()` almost never allocates a fresh G — it grabs one off the free list and resets the stack pointer. That is why `go f()` benchmarks at ~150 ns: no allocation in the hot path, just a stack reset and an enqueue.

### 2.4 `runqput` — `proc.go:7058`

```go
// from runtime/proc.go:7058
func runqput(pp *p, gp *g, next bool) {
    if randomizeScheduler && next && randn(2) == 0 {
        next = false                   // race-detector mode randomizes
    }
    if next {
    retryNext:
        oldnext := pp.runnext
        if !pp.runnext.cas(oldnext, guintptr(unsafe.Pointer(gp))) {
            goto retryNext             // another P stole runnext; retry
        }
        if oldnext == 0 { return }
        gp = oldnext.ptr()             // kick old runnext into the regular runq
    }
retry:
    h := atomic.LoadAcq(&pp.runqhead)  // load-acquire pairs with consumer
    t := pp.runqtail
    if t-h < uint32(len(pp.runq)) {    // local runq is 256 entries
        pp.runq[t%uint32(len(pp.runq))].set(gp)
        atomic.StoreRel(&pp.runqtail, t+1)  // store-release publishes the slot
        return
    }
    if runqputslow(pp, gp, h, t) { return }  // local full -> push half to sched.runq
    goto retry
}
```

- `pp.runnext` is a single slot for the *next* G to run on this P — locality optimization for goroutines that spawn one child and want the child to run on the same P with a warm cache.
- The ring buffer `pp.runq[256]` is single-producer (owner P pushes to the tail), multi-consumer (peer Ps may steal from the head). The atomic acquire/release pair on `runqhead`/`runqtail` makes it lock-free.
- When the local runq is full, `runqputslow` grabs `sched.lock` and pushes half the local queue (128 Gs) plus the new one onto the global `sched.runq`. This prevents one P from hoarding work.

`wakep()` then releases an idle M if one is parked — `notewakeup` on a futex (Linux) / `semaphore_signal` (Darwin), see `runtime/lock_futex.go` and `runtime/lock_sema.go`. End-to-end cost on a warm scheduler: ~80 ns from `go f()` to G enqueued, plus ~2 µs if a sleeping M has to be woken. The runtime is *fast* because almost all of this is per-P state and avoids the OS.

---

## 3. Path 2: the scheduler loop — `schedule()` at `proc.go:4123`

```go
// from runtime/proc.go:4123, paraphrased and trimmed
func schedule() {
    mp := getg().m
    if mp.locks != 0 { throw("schedule: holding locks") }
    if mp.lockedg != 0 {
        stoplockedm()
        execute(mp.lockedg.ptr(), false)  // LockOSThread G; never returns
    }
    if mp.incgo { throw("schedule: in cgo") }

top:
    pp := mp.p.ptr()
    pp.preempt = false
    if mp.spinning && (pp.runnext != 0 || pp.runqhead != pp.runqtail) {
        throw("schedule: spinning with local work")  // invariant
    }
    gp, inheritTime, tryWakeP := findRunnable()  // blocks until work exists
    if mp.spinning { resetspinning() }
    if sched.disable.user && !schedEnabled(gp) {
        // park user G while user scheduling is disabled
        lock(&sched.lock); sched.disable.runnable.pushBack(gp); unlock(&sched.lock)
        goto top
    }
    if tryWakeP { wakep() }
    if gp.lockedm != 0 {
        startlockedm(gp)             // hand P to locked M
        goto top                     // come back and pick something else
    }
    execute(gp, inheritTime)         // jumps via gogo; doesn't return here
}
```

### 3.1 Why the `top:` label

Every `goto top` is a place where work between the function entry and that point invalidated the earlier candidate, requiring a re-pick:

1. **`sched.disable.user`** — STW operations (tracing, GC mark phase end) park user Gs.
2. **`gp.lockedm`** — the G is locked to a different M (via `runtime.LockOSThread`). Hand the P off and find a different G to run here.

Go uses an explicit jump rather than recursion (which would grow g0's stack on every reschedule) or a state-machine loop (uglier). **Every `goto top` is a place where work has invalidated the candidate.**

### 3.2 `findRunnable` — the meat

`findRunnable` is the function this entire file is built around. Skim its 350+ lines and you will see the priority order:

1. **GC mark worker** if a fractional worker is needed.
2. **Trace reader** if execution tracing is on and a reader is parked.
3. **Local runq** — `runnext`, then ring buffer (`runqget`).
4. **Global runq** — under `sched.lock`, take up to `len(local)/2 + 1` items.
5. **Network poller** — `netpoll(0)` non-blocking; readied Gs are added globally.
6. **Steal** — pick a random P, try its runq, its `runnext`, its timer ready queue.
7. If still nothing, **park the M** via `stopm()`. Spin a fixed number of Ms before parking to avoid wake/sleep ping-pong (`sched.nmspinning`).

Each step exists for a measured reason. Step 5 (poll before steal) catches the common case of "lots of network-blocked goroutines just got readied" before paying steal contention. Step 7 (spin) caps the rate of OS wake/sleep transitions when work arrives in bursts.

### 3.3 Preemption causes a `schedule()` re-entry

When `sysmon` (a special M that does no user work) decides a G has run too long, it sets `gp.preempt = true` and `gp.stackguard0 = stackPreempt`. The next time the running G does a stack-growth check (every function prologue not marked `//go:nosplit`), it sees `stackPreempt` and calls `runtime.morestack_noctxt`, which detects the preempt flag and reroutes to `runtime.goschedImpl`. That function calls `dropg()`, marks the G `_Grunnable`, pushes it back to the global runq, and falls through into `schedule()`.

From the source: `proc.go` → `goschedImpl` → `schedule`. There is no "interrupt handler" in the OS sense for cooperative preemption. Go 1.14+ added *asynchronous* preemption (signal-driven), which uses a SIGURG handler in `runtime/signal_unix.go` to inject a call to `asyncPreempt`, but the rendezvous point is still the scheduler loop. **`schedule()` is the one place every goroutine returns to between executions.** Read it once carefully and the rest of the runtime makes sense.

---

## 4. Path 3: `mcall` and `systemstack` — `asm_amd64.s:427`

The runtime has two stacks per M: the user goroutine's stack (8 KB+, segmented/copied as needed) and `g0`'s stack (~32 KB, OS-allocated, fixed-size). Code that must not grow its stack — the scheduler, GC, write barriers — runs on g0.

There are two primitives for switching:

- **`mcall(fn)`** — switch from user G to g0, run `fn(curg)`, *do not return*. Used when the running G is going away (parking, exiting, yielding).
- **`systemstack(fn)`** — switch to g0, run `fn`, *come back* to user G. Used for short bursts of stack-sensitive work.

### 4.1 The `mcall` stub

```asm
; from runtime/asm_amd64.s:427, lightly annotated
TEXT runtime·mcall<ABIInternal>(SB), NOSPLIT, $0-8
    MOVQ    AX, DX                  ; AX is fn (per ABIInternal); save in DX

    ; Save caller state into g.sched so we can resume here later (if ever)
    MOVQ    SP, BX
    MOVQ    8(BX), BX               ; caller's PC (return addr on stack)
    MOVQ    BX, (g_sched+gobuf_pc)(R14)
    LEAQ    fn+0(FP), BX            ; caller's SP (just above the saved PC)
    MOVQ    BX, (g_sched+gobuf_sp)(R14)
    MOVQ    (BP), BX                ; caller's BP via frame-pointer chain
    MOVQ    BX, (g_sched+gobuf_bp)(R14)

    ; R14 currently holds *g* (the current G). Swap to g0.
    MOVQ    g_m(R14), BX            ; BX = curg.m
    MOVQ    m_g0(BX), SI            ; SI = m.g0
    CMPQ    SI, R14                 ; sanity: if already on g0, that's a bug
    JNE     goodm
    JMP     runtime·badmcall(SB)
goodm:
    MOVQ    R14, AX                 ; first arg to fn = the *prior* G
    MOVQ    SI, R14                 ; R14 = g0 now (the "g register")
    get_tls(CX)
    MOVQ    R14, g(CX)              ; also publish g0 into TLS slot
    MOVQ    (g_sched+gobuf_sp)(R14), SP  ; SP = g0.sched.sp
    MOVQ    $0, BP                  ; reset frame pointer
    PUSHQ   AX                      ; spill slot for fn's *g argument
    MOVQ    0(DX), R12              ; load fn.fn (funcval entry)
    CALL    R12                     ; fn(g)
    BYTE    $0x90                   ; NOP — Windows unwinder workaround
    POPQ    AX
    JMP     runtime·badmcall2(SB)   ; mcall must not return
    RET
```

Several register conventions are doing critical work here:

- **R14 is the `g` register** on amd64 (since Go 1.17). Reading the current G is a register read, not a memory load. The TLS slot is still kept in sync as a fallback (and for code that came up before R14 was set).
- **AX holds the first argument** in ABIInternal. `mcall` passes the prior G to `fn` so the callee can manipulate it (e.g., `park_m(gp)` parks the G it was just on).
- **SP swap** changes which stack the code runs on. After `MOVQ (g_sched+gobuf_sp)(R14), SP`, all locals live on g0's stack. The caller's frame is preserved in `g.sched` so if we ever `gogo(&gp.sched)` we land back where we left off.
- **`get_tls(CX); MOVQ R14, g(CX)`** keeps the TLS-based `g` pointer in lockstep. Some platforms and some legacy paths still read it from TLS.

The reason `mcall` is asm and not Go: there is no way to express "save the current SP and PC into a struct, then jump to another stack" in Go without help. The stack switch must happen between two well-defined instructions; a Go function call would push a return address on the wrong stack.

### 4.2 `systemstack` — same trick, with a return

`systemstack(fn)` does the same swap but switches back at the end of `fn`. The bottom of the user stack is marked with a sentinel (`systemstack_switch`) so traceback can cross the boundary. g0's stack is fixed-size, so every `systemstack` callee must be `//go:nosplit` or carefully bounded — stack growth is forbidden.

Search for `mcall(` and `systemstack(` in `runtime/` and every hit is a place the runtime decided "this work cannot run on a user goroutine stack." Useful index of stack-fragility hot spots.

---

## 5. Path 4: `gopark` / `goready` and the unlock callback

Almost every blocking operation in Go — channel send/recv, mutex contention, semaphore wait, select wait, network read — ends up calling `gopark`. Almost every wakeup calls `goready`. Read these two functions and you have read 80% of how Go does blocking.

### 5.1 `gopark` and `park_m`

```go
// from runtime/proc.go:443, trimmed
func gopark(unlockf func(*g, unsafe.Pointer) bool, lock unsafe.Pointer,
            reason waitReason, traceReason traceBlockReason, traceskip int) {
    if reason != waitReasonSleep { checkTimeouts() }
    mp := acquirem()
    gp := mp.curg
    if s := readgstatus(gp); s != _Grunning && s != _Gscanrunning {
        throw("gopark: bad g status")
    }
    mp.waitlock, mp.waitunlockf = lock, unlockf  // park_m reads these
    gp.waitreason = reason
    mp.waitTraceBlockReason, mp.waitTraceSkip = traceReason, traceskip
    releasem(mp)
    mcall(park_m)                      // actual park happens on g0
}

// park_m runs on g0 after the stack switch.
func park_m(gp *g) {
    mp := getg().m                     // g0
    casgstatus(gp, _Grunning, _Gwaiting)
    dropg()                            // m.curg = nil
    if fn := mp.waitunlockf; fn != nil {
        ok := fn(gp, mp.waitlock)      // USER CALLBACK on g0
        mp.waitunlockf, mp.waitlock = nil, nil
        if !ok {                       // callback aborted the park
            casgstatus(gp, _Gwaiting, _Grunnable)
            execute(gp, true)          // never returns
        }
    }
    schedule()                         // never returns
}
```

The crucial subtlety: `gopark` itself does *not* park the G. It stashes `unlockf` and `lock` into the M (so `park_m`, which runs after the stack switch, can read them), then `mcall`s into `park_m`. The `mcall` is the atomic switch point — until it runs, no other M can see this G and try to schedule it.

### 5.2 Who unlocks the channel? — `chansend` (chan.go:240)

```go
gp := getg()
mysg := acquireSudog()
// ... fill sudog with elem, gp, ...
c.sendq.enqueue(mysg)
gp.parkingOnChan.Store(true)
gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanSend,
       traceBlockChanSend, 2)
```

`chanparkcommit` is the `unlockf`. It runs **on g0**, *after* the G has been marked `_Gwaiting` but *before* `schedule()` is called. That ordering is the whole point of the callback: if `c.lock` were released before the G transitioned to `_Gwaiting`, a concurrent receiver could `goready(gp)` while `gp` is still `_Grunning` — scheduler corruption. By delaying the unlock until after the status change, the runtime guarantees that any receiver seeing the G in `sendq` also sees it in `_Gwaiting`, so `goready` can safely transition it back.

Same pattern is used by `sync.Mutex` (`sema.go`), `sync.Cond`, the network poller — anywhere a G parks while another goroutine might already be racing to wake it. **The unlock-after-status-change invariant is the load-bearing wall of Go's blocking primitives.**

### 5.3 `goready` — the other side

```go
//go:linkname goready
func goready(gp *g, traceskip int) {
    systemstack(func() {
        ready(gp, traceskip, true)
    })
}
```

`ready` (also in `proc.go`) does:

1. `casgstatus(gp, _Gwaiting, _Grunnable)`
2. `runqput(getg().m.p.ptr(), gp, true)` — push to current P's `runnext`
3. `wakep()` if there's idle parallelism to use

So the goroutine that called `goready` (the sender, the unlocker, the network poller) effectively donates its `runnext` slot to the wakee. That is how channel handoffs achieve sub-microsecond latency — the wakee runs *next* on the *same* P that woke it, inheriting a warm cache.

The `//go:linkname goready` annotation and the "hall of shame" comment in the source — listing `gvisor.dev/gvisor` and `github.com/sagernet/gvisor` — is the runtime's way of admitting that even internals leak. External packages reach into the runtime via `linkname`, and once enough of them do, the symbol becomes part of the implicit ABI. The team is documenting "we cannot remove this without breaking real users."

---

## 6. Reading `runtime2.go` — the data structures

`runtime/runtime2.go` is ~1500 lines that define `g`, `m`, `p`, `sched`, `gobuf`, `stack`, `funcval`, and the `_G*` status constants. The file is documentation as much as code — every field has a comment that is the only reliable source on what the field is for.

### 6.1 The `g` struct and its layout

```go
// from runtime/runtime2.go:394, scheduling-relevant fields only
type g struct {
    stack       stack          // [stack.lo, stack.hi); offset known to runtime/cgo
    stackguard0 uintptr        // compared in stack-growth prologue
    stackguard1 uintptr        // compared in //go:systemstack prologue
    _panic      *_panic
    _defer      *_defer
    m           *m             // current m; nil if not running
    sched       gobuf          // saved PC/SP/BP for gogo
    syscallsp   uintptr        // valid during _Gsyscall
    syscallpc   uintptr
    syscallbp   uintptr
    stktopsp    uintptr
    param       unsafe.Pointer // wakeup payload (sudog, etc.)
    atomicstatus atomic.Uint32 // _Grunnable, _Grunning, _Gwaiting, ...
    goid        uint64
    schedlink   guintptr       // intrusive next-in-runq pointer
    waitreason  waitReason
    preempt        bool        // duplicates stackguard0 = stackPreempt
    // ... plus many GC, race, trace fields ...
    startpc     uintptr        // pc of go statement target
    gopc        uintptr        // pc of the `go` statement itself
    parentGoid  uint64
}
```

Fields tagged `// offset known to liblink` or `// offset known to runtime/cgo` have hardcoded byte offsets in the linker or cgo glue; **moving them breaks the build in non-obvious ways**. Any change to `g` triggers PR review questions like "did you update `runtime/cgo/gcc_amd64.S`?"

Layout on amd64:

```
offset  size  field             notes
------  ----  ----------------- -----------------------------------
  0      8    stack.lo          stack range start
  8      8    stack.hi          stack range end (grow checks)
 16      8    stackguard0       compared every prologue
 24      8    stackguard1       g0/gsignal only
 32      8    _panic / _defer   panic+defer chains
 48      8    m                 owning M when running
 56     56    sched (gobuf)     PC, SP, BP, G, RET, CTXT
112      8    syscallsp         valid in _Gsyscall
 ...
```

`gobuf` is 56 bytes (7 × 8) — exactly the registers `gogo` restores: PC, SP, BP, G self-pointer, return slot, context (closure data), and one arch-dependent slot. One cache line's worth of save/restore.

### 6.2 The `p` struct's runq layout

```go
// from runtime2.go:642
type p struct {
    id          int32
    status      uint32         // _Pidle, _Prunning, _Psyscall, _Pgcstop, _Pdead
    link        puintptr
    schedtick   uint32
    syscalltick uint32
    sysmontick  sysmontick
    m           muintptr
    mcache      *mcache        // per-P allocation cache
    // ...
    runqhead    uint32         // consumer index (atomic; stealable)
    runqtail    uint32         // producer index (owner-only)
    runq        [256]guintptr  // ring buffer
    runnext     guintptr       // single-slot fast queue
    // ...
}
```

`runqhead` and `runqtail` are *separate* uint32s — they sit on the same cache line by default, which is exactly the false-sharing failure mode you would expect. Read the field comments and the source carefully: stealers read `runqhead` with acquire semantics and CAS it; the owner writes `runqtail` with release semantics and never reads `runqhead` except for a length check. The hot paths don't conflict in practice. Earlier versions of the runtime had explicit padding between them; the current version trusts the workload mix.

### 6.3 `hchan` — `chan.go:34`

```go
type hchan struct {
    qcount   uint           // elements in buffer
    dataqsiz uint           // buffer capacity (0 = unbuffered)
    buf      unsafe.Pointer // *[dataqsiz]elem
    elemsize uint16
    closed   uint32
    timer    *timer         // timer feeding this chan (after-style)
    elemtype *_type
    sendx    uint           // ring buffer send index
    recvx    uint           // ring buffer recv index
    recvq    waitq          // parked receivers (FIFO sudog list)
    sendq    waitq          // parked senders
    bubble   *synctestBubble
    lock     mutex          // protects the whole struct
}
```

```
+---------+---------+----------+-------+------+-----+
| qcount  | dataqsiz| buf*     |  ...  | recvq| sendq|  lock
+---------+---------+----------+-------+------+-----+
   8         8         8        ...     16     16     8
```

The `lock` field is at the end — every send/recv acquires it, so it lives on its own cache line in practice (preceded by the 16-byte sudog list heads). Channel ops are *not* lock-free; the fast path in `chansend` does a `closed`+`full` check outside the lock, but the moment there's actual work, the mutex is taken. This is why ultra-high-contention channels are slower than you would expect from "it's just a queue."

---

## 7. Compiler→runtime boundary, by example

You can verify every rewrite below with `go build -gcflags='-S'`. Lines marked with `;` are the actual emitted assembly (trimmed).

### 7.1 `go f()` → `runtime.newproc`

```go
go f()
```

```asm
LEAQ    f·f(SB), AX
CALL    runtime.newproc(SB)
```

### 7.2 `make(chan int, 4)` and `ch <- v`

```go
ch := make(chan int, 4)
ch <- 42
```

```asm
LEAQ    type:chan int(SB), AX
MOVL    $4, BX
CALL    runtime.makechan(SB)
; ...
MOVQ    main..autotmp_3(SP), AX    ; AX = ch
LEAQ    main..autotmp_4(SP), BX    ; BX = &v
CALL    runtime.chansend1(SB)
```

The compiler picks `makechan`/`makechan64`/`makechansmall` by element type and size. `chansend1` is a fixed-arg wrapper around `chansend(c, ep, true, callerpc)`. The same send inside a `select` becomes `runtime.selectgo` — different entry, same `hchan`.

### 7.3 `m[k] = v` → `runtime.mapassign_*`

The compiler picks `mapassign_fast32`, `_fast64`, `_faststr`, or generic `mapassign` based on key type — fast variants skip a hash function indirection. Same shape: load type descriptor into AX, key into BX/CX, `CALL`, store returned slot pointer.

### 7.4 The `funcval` story

A `funcval` is the runtime representation of a function value:

```go
// runtime/runtime2.go, simplified
type funcval struct {
    fn uintptr        // entry PC
    // closure captures follow inline, accessed via context register (DX on amd64)
}
```

Closures and plain function references both produce `*funcval`. The captured-variable area is laid out by the compiler; the runtime never looks inside it — it only uses `fn`. When the closure is invoked, the calling convention places `&closure` into the *context* register (`DX` on amd64). Inside the closure body, captured variables are loaded via `DX` offsets.

`newproc(fn *funcval)` stores `fn` into `newg.startpc` and arranges (via `gostartcallfn`) for the first `gogo` to land at `fn.fn` with `DX` pointing back to the funcval. That is how a closure goroutine sees its captures.

---

## 8. Platform splits — build tags and friends

`runtime/os_linux.go`, `runtime/os_darwin.go`, `runtime/os_windows.go` implement the same set of functions (`osinit`, `mpreinit`, `minit`, `getproccount`, `goenvs`, `sigprocmask`) differently per OS, selected via build tags or filename suffixes. Per-OS-per-arch assembly stubs (`sys_linux_amd64.s`, `sys_darwin_amd64.s`) hold the syscall wrappers — every kernel call is hand-written asm because the runtime must avoid Go's prologues and register conventions when crossing the kernel boundary.

A quick map of which files combine on `linux/amd64`:

```
runtime/os_linux.go             ; futex, sched_yield, sigaltstack
runtime/sys_linux_amd64.s       ; SYS_clone, SYS_futex, SYS_mmap, ...
runtime/signal_linux_amd64.go   ; sigtramp, sigreturn, signal frame layout
runtime/asm_amd64.s             ; mcall, gogo, systemstack, jmpdefer
runtime/cgo/gcc_linux_amd64.c   ; cgo bootstrap; sets up TLS for new M
```

For a `linux/amd64` issue, start with `os_linux.go` and `asm_amd64.s`. For `darwin/arm64`, the file set rotates — same shapes, different bodies.

---

## 9. Comparing Go versions: what changed and why

Reading source means reading source *over time*. A few examples of changes that have rippled through the runtime between go1.20 and go1.22+ (and are still present in go1.25):

### 9.1 Loopvar semantics — go1.22

Pre-go1.22:

```go
for _, x := range xs {
    go func() { use(x) }()   // all goroutines see the LAST x
}
```

Post-go1.22 (`GOEXPERIMENT=loopvar` in 1.21):

```go
for _, x := range xs {
    go func() { use(x) }()   // each goroutine sees its own x
}
```

Compiler change, not a runtime change — but it directly affects closure layout. Pre-1.22, the compiler allocated *one* heap slot for `x` and every closure captured the same address; post-1.22, the compiler allocates a *new* heap slot per iteration. Effect on runtime: more allocations (each iteration's `x` is now an escaped variable), more GC work, more `funcval` closure objects. The runtime didn't change; the volume of work it does on `for/go` loops did.

You can spot the difference in `-gcflags='-m'` escape analysis: post-1.22 the loop variable is reported as "moved to heap" inside the loop body where pre-1.22 it was outside.

### 9.2 R14 as the `g` register — go1.17

Before go1.17, `g` was always read from TLS via a small per-arch stub. From go1.17, on amd64 `g` lives in `R14`, on arm64 in `R28`, on arm in `R10`. This was the same release that introduced ABIInternal (register-based Go calling convention). The cost: every function that calls into the runtime (which is nearly every function) now requires R14 to be preserved across the call.

This is why `mcall` in `asm_amd64.s` references `R14` explicitly and why every `//go:nosplit` runtime function works hard to not touch R14 unnecessarily. The `get_tls(CX); MOVQ R14, g(CX)` you see in the `mcall` stub is the cross-check: keep R14 and TLS in lockstep so a debugger reading TLS still sees a valid G.

### 9.3 Asynchronous preemption — go1.14

Before 1.14, only cooperative preemption (at function prologues) existed. A `for { }` loop with no function calls could hold a P forever, blocking GC stop-the-world. go1.14 introduced signal-based preemption: SIGURG on Unix, the runtime's signal handler injects a call to `asyncPreempt`, which saves all registers, runs `mcall(gopreempt_m)`, and resumes.

Read `runtime/preempt.go` and `runtime/preempt_amd64.s` together. The asm stub `asyncPreempt` is large because it must save and restore *every* register the user code might be using — including XMM/YMM SIMD state — because the signal can land at any instruction. This is a much heavier preemption than the cooperative one, which only saves the small set of registers in `gobuf`.

A practical consequence: post-1.14, you can no longer reliably `for { runtime.Gosched() }` to ensure cooperative-only preemption — async preemption can still interrupt you. This matters for code that uses `//go:nosplit` and assumes register stability.

---

## 10. Reading checklist — the order to take

If you genuinely want to internalize the runtime, here is the order that minimizes wasted detours.

1. **`runtime2.go` end to end** — absorb the data model. ~1 hour.
2. **`proc.go:newproc`, `newproc1`** — trace `go f()` through G allocation. ~30 min.
3. **`proc.go:schedule`, `findRunnable`** — understand every `goto top`; trace paths through `runqget`, `globrunqget`, `stealWork`. ~1 hour.
4. **`asm_amd64.s:mcall`, `systemstack`, `gogo`** — read back-to-back; sketch the stack on paper. ~30 min.
5. **`proc.go:gopark`, `park_m`, `goready`, `ready`** — the unlock-callback pattern. ~30 min.
6. **`chan.go:chansend`, `chanrecv`, `send`, `recv`** — real consumer of `gopark`. ~45 min.
7. **`sema.go:semacquire1`** — `sync.Mutex` slow path. ~30 min.
8. **`mheap.go`, `mcache.go`, `malloc.go`** — allocator, starting at `mallocgc`. ~2 hours.
9. **`mgc.go`, `mgcmark.go`, `mgcsweep.go`** — GC; read after the allocator. ~3 hours.
10. **`netpoll.go` + `netpoll_epoll.go`/`netpoll_kqueue.go`** — network poller. ~1 hour.
11. **`signal_unix.go`, `signal_amd64.go`, `preempt.go`** — signals and async preemption. ~1 hour.
12. **`cgocall.go` + `cgo/gcc_*.c`** — only if you use cgo. ~2 hours.

Steps 1-5 are mandatory for any "I read the runtime" claim. Steps 6-7 cover the blocking patterns most teams hit. Steps 8-12 are domain-specific; pull them in when an incident demands.

---

## 11. Anti-patterns of runtime reading

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Reading without pinning a Go version | Quoted lines drift in 6 months | Cite `go1.X.Y` next to every reference |
| Reading `proc.go` top-to-bottom | Drown in 8 000 lines; lose the thread | Pick a path (§1); follow it through several files |
| Skipping the assembly | Hand-wave over `mcall`; wrong mental model of stack switching | Read the asm; sketch the stack |
| Trusting outdated blog posts | Runtime in the post is go1.5; you're on go1.25 | Cross-check against current source |
| `go:linkname`-ing into the runtime | Builds today; breaks in a minor release | Stop; if you need it, file a proposal |
| Microbenchmarking primitives in isolation | `go func(){}()` at 150 ns; real workload at 50 µs | Profile real workloads; ratios beat absolutes |
| Reading without `git log -p` | Miss the *why* behind every quirky line | `git log -p runtime/proc.go` for rationale |
| Believing `//go:linkname` symbols are stable | Hall-of-shame list is a warning, not a guarantee | Don't depend on undocumented runtime |
| Replicating runtime patterns in your own code | "I'll write my own goroutine pool with `runqput` semantics" | Use `errgroup`, `singleflight`; the runtime already won |

The deepest anti-pattern: **using the runtime as a library.** The runtime is *infrastructure*. Read it to understand your program; do not import its private symbols. Every `//go:linkname` to a runtime function is a future on-call incident.

---

## 12. Closing principles

The Go runtime is ~50 000 lines of mostly Go. It is readable. It is well-commented. It is the single best way to understand why your program does what it does.

1. **Pin a version.** Line numbers drift across releases; always cite file and commit.
2. **Read paths, not files.** `newproc → runqput → schedule → execute → gogo` is a 4-file path. End-to-end file reads are a 4-month commitment; the path is an afternoon.
3. **Compiler-runtime boundary is the source of truth.** When the runtime surprises you, ask "what did the compiler emit?" — `go build -gcflags='-S'` answers more questions than any blog post.
4. **The g0 stack is the load-bearing distinction.** Almost every interesting piece of code either runs on g0 or transitions to it. `mcall` and `systemstack` are the two transitions; learn both.
5. **The unlock-callback pattern is universal.** `gopark(unlockf, lock, ...)` is the same shape in channels, mutexes, semaphores, and timers. The callback runs on g0 after the status change.
6. **`runqput`/`runqget` is the work-stealing heart.** Per-P ring buffer, single-slot `runnext`, lock-free push/pop, lock-held steal. Every scheduling question routes through these.
7. **Layout matters.** Field offsets in `g` are known to the linker. The 256-entry ring buffer is sized for L1 fit. Read `runtime2.go` as a layout document.
8. **Platform splits are real.** Pick your target (`linux/amd64`, `darwin/arm64`); ignore the rest until you switch.
9. **Version diffs are educational.** `git log -p runtime/proc.go` and read commits — every interesting line was added in response to a specific bug or perf problem.
10. **The runtime is private API.** `runtime.GOMAXPROCS`, `runtime.Gosched`, `runtime/pprof`, `runtime/trace`, `runtime/debug` are the contract. Everything else is internal.

Get these right and reading the runtime stops feeling like spelunking and starts feeling like reading a well-written codebase that happens to schedule millions of goroutines per second. **The runtime is small enough to read and important enough to know.**

---

## Further reading

- `go.dev/src/runtime/HACKING.md` — the runtime team's onboarding document, definitive
- `go.dev/src/runtime/README.md` — file map maintained alongside the source
- `golang/go` issue tracker tagged `compiler/runtime` — design discussions in real time
- Dmitry Vyukov, *Scalable Go Scheduler Design Doc* (2012) — the original GMP design proposal
- Russ Cox, *Goroutines vs OS threads* — historical context for why the runtime exists
- Austin Clements, *Proposal: Non-cooperative goroutine preemption* (go1.14) — asynchronous preemption rationale
- Rhys Hiltner, *An Introduction to the Go Memory Model* — what guarantees the runtime provides
- Felix Geisendörfer, *Go's work-stealing scheduler* — modern walk-through with benchmarks
- `golang/go` CL 31766 — the patch that moved `g` from TLS to R14; read for context on register conventions
- Keith Randall's GopherCon talks on the compiler — covers the rewrites in §7
- `go-internals` (teh-cmc/go-internals) — community-maintained deep-dive notes on the runtime
- Ian Lance Taylor's writings on linker, runtime, and cgo — primary-source quality
