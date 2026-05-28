# Go Runtime Architecture — Professional

> Focus: source-level walkthrough of what happens between the kernel handing control to a Go binary and `main.main` returning. Targets go1.22+ with notes on 1.23/1.24 deltas. Every section names the file you should `git clone` and read alongside this document. Paths are relative to `$GOROOT/src/`. No commentary — read with the runtime tree open in the other window.

---

## 1. Reading order

Before tracing live code, the prerequisites:

```
runtime/HACKING.md                  -- terminology (g, m, p, gp, mp, pp)
runtime/runtime2.go                 -- struct definitions (g, m, p, sched, hchan, ...)
runtime/proc.go                     -- scheduler core: schedinit, schedule, findrunnable
runtime/asm_amd64.s                 -- entry, gogo, mcall, systemstack, asyncPreempt
runtime/stubs.go                    -- the Go-side declarations for asm symbols
runtime/malloc.go                   -- the allocator entry points
runtime/mgc.go                      -- the GC state machine
```

Read `runtime2.go` first. Without the field layout of `g` and `m` in your head, every other file looks like a wall of pointer dereferences. Then read `proc.go::schedule` once top to bottom — that is the bottom of the stack for every goroutine in the program.

ASCII map of the runtime subsystems and their entry points:

```
                +-----------------------------+
   kernel -->   |  rt0_<os>_<arch>.s (entry)  |   asm_amd64.s::rt0_go
                +--------------+--------------+
                               v
                +-----------------------------+
                |  schedinit (proc.go)        |   one-time bring-up
                +--------------+--------------+
                               v
                +-----------------------------+
                |  newproc(main) (proc.go)    |   creates g for runtime.main
                +--------------+--------------+
                               v
                +-----------------------------+
                |  mstart -> schedule (loop)  |   never returns on m0
                +--------------+--------------+
                               v
                +-----------------------------+
                |  runtime.main -> main.main  |   user code starts here
                +-----------------------------+
```

Everything below is the expansion of that pipeline.

---

## 2. Boot path, step by step (amd64 Linux)

### 2.1 The ELF entry point

The kernel jumps to `_rt0_amd64_linux` after exec. From `runtime/rt0_linux_amd64.s`:

```
// from runtime/rt0_linux_amd64.s, simplified
TEXT _rt0_amd64_linux(SB),NOSPLIT,$-8
    JMP   _rt0_amd64(SB)

// from runtime/asm_amd64.s
TEXT _rt0_amd64(SB),NOSPLIT,$-8
    MOVQ  0(SP), DI           // argc
    LEAQ  8(SP), SI           // argv
    JMP   runtime·rt0_go(SB)
```

`DI` and `SI` follow the System V AMD64 ABI for the first two integer arguments. The kernel has already placed `argc` at the top of the stack, with `argv` immediately above. No call instruction was executed — control arrived via `_start` substitution in the linker.

### 2.2 `rt0_go` — pre-Go setup

This is the longest piece of hand-written assembly in the runtime. Annotated excerpt:

```
// from runtime/asm_amd64.s, simplified
TEXT runtime·rt0_go(SB),NOSPLIT,$0
    // 1. Copy argc/argv onto our stack
    MOVQ  DI, AX
    MOVQ  SI, BX
    SUBQ  $(4*8+7), SP
    ANDQ  $~15, SP            // 16-byte align for SSE
    MOVQ  AX, 16(SP)
    MOVQ  BX, 24(SP)

    // 2. Bootstrap g0 (the system goroutine for this m)
    MOVQ  $runtime·g0(SB), DI
    LEAQ  (-64*1024+104)(SP), BX
    MOVQ  BX, g_stackguard0(DI)
    MOVQ  BX, g_stackguard1(DI)
    MOVQ  BX, (g_stack+stack_lo)(DI)
    MOVQ  SP, (g_stack+stack_hi)(DI)

    // 3. CPUID probe (lands in x86HasAVX etc.)
    MOVL  $0, AX
    CPUID
    ...

    // 4. Install TLS: this is the crucial step that makes
    //    "get_tls(CX); MOVQ g(CX), R14" work everywhere afterwards
    LEAQ  runtime·m0+m_tls(SB), DI
    CALL  runtime·settls(SB)

    // 5. Wire m0 <-> g0
    LEAQ  runtime·m0(SB), AX
    MOVQ  AX, m_g0(DI)         // m0.g0 = &g0
    MOVQ  $runtime·g0(SB), BX
    MOVQ  BX, g_m(AX)          // g0.m = &m0
    MOVQ  AX, R14              // R14 is the g register; see §3

    // 6. Now we can call Go functions on g0's stack
    CALL  runtime·args(SB)
    CALL  runtime·osinit(SB)
    CALL  runtime·schedinit(SB)

    // 7. Create the goroutine that will run runtime.main
    MOVQ  $runtime·mainPC(SB), AX
    PUSHQ AX
    CALL  runtime·newproc(SB)
    POPQ  AX

    // 8. Hand control to the scheduler. Never returns.
    CALL  runtime·mstart(SB)
    CALL  runtime·abort(SB)     // unreachable
    RET
```

The seven distinct phases:

1. **Argument preservation** — the kernel-provided `argc`/`argv` survive the alignment dance.
2. **g0 init** — `g0` is a static `g` in `runtime/proc.go`. Its stack *is* the OS thread's stack (not a regular goroutine stack). Stack bounds are filled in from the current `SP`.
3. **CPU feature detection** — populates `internal/cpu.X86.HasAVX` etc. before any Go code that might use them runs.
4. **TLS installation** — calls `arch_prctl(ARCH_SET_FS, ...)` on Linux to point `fs` at `m0.tls`. After this, `MOVQ fs:-8, R14` retrieves `g`.
5. **m0 ↔ g0 wiring** — the back-pointers that make `getg().m` and `getg().m.g0` work.
6. **First Go calls** — `osinit` reads `/proc/cpuinfo`-equivalents, `schedinit` is §4.
7. **The first goroutine** — `newproc` queues `runtime.main` on the run queue. `mstart` then enters the scheduler.

The scheduler loop is the floor of the call stack for `m0` until program exit.

---

## 3. The g register (R14 on amd64)

Since Go 1.17, `g` lives in a dedicated register, not TLS. On amd64 that register is **R14**. The compiler emits `MOVQ R14, AX` rather than `get_tls(CX); MOVQ g(CX), AX` for every stack-check prologue.

```
// every Go function prologue starts with something like:
//   CMPQ SP, 16(R14)        // R14 = g; 16(g) = g.stackguard0
//   JLS  morestack_noctxt
// thousands of these per binary; R14 must be valid in user code at all times
```

Who sets `R14`:

- `rt0_go` for `m0` (see §2.2 step 5).
- `runtime/asm_amd64.s::mstart` for every other `m` — loads `m.g0` into R14 before any Go code on the new thread.
- `runtime/asm_amd64.s::gogo` when switching to a user goroutine — the standard context switch.
- `cgocallback` — when a foreign thread enters Go, we re-establish `g` from TLS (the only place TLS still matters at steady state). See §13.

If `R14` is ever wrong, the next function prologue compares `SP` against garbage memory. The fault is unrecoverable (SIGSEGV inside the stack-grow path).

---

## 4. `schedinit` walkthrough

From `runtime/proc.go`. The order is load-bearing — each step depends on the previous having completed.

```go
// from runtime/proc.go, simplified
func schedinit() {
    lockInit(&sched.lock, lockRankSched)
    lockInit(&sched.sysmonlock, lockRankSysmon)
    // ... lockInit for ~20 global locks

    gp := getg()
    sigsave(&gp.m.sigmask)        // remember the kernel's signal mask
    initSigmask = gp.m.sigmask

    goargs()                       // copy argv into os.Args
    goenvs()                       // copy environ
    parsedebugvars()               // GODEBUG=schedtrace=1000 etc.
    gcinit()                       // GOGC, gcController init

    sched.lastpoll.Store(nanotime())
    procs := ncpu
    if n, ok := atoi32(gogetenv("GOMAXPROCS")); ok && n > 0 {
        procs = n
    }
    if procresize(procs) != nil {
        throw("unknown runnable goroutine during bootstrap")
    }

    // After procresize, we have `procs` P's and m0 owns P0.
}
```

The full call order, with one-line purpose for each:

| # | Call | What it does |
|---|---|---|
| 1 | `lockInit(...)` | Registers rank-ordered locks for the deadlock detector |
| 2 | `sigsave` | Saves the kernel signal mask so children inherit a clean one |
| 3 | `stackinit` | Initialises the stack pool (`stackpool`, `stackLarge`) |
| 4 | `mallocinit` | Reserves the heap arena, builds `mheap`, `mcentral`, `mcache` |
| 5 | `cpuinit` | Re-reads `internal/cpu` after `GODEBUG=cpu.<feature>=off` parsing |
| 6 | `alginit` | Picks hash functions; reads AES-NI; **seeds aeshash** |
| 7 | `mcommoninit(m0)` | Allocates `m0.id`, links into `allm` |
| 8 | `modulesinit` | Builds the `firstmoduledata` linked list of modules |
| 9 | `typelinksinit` | Deduplicates `*_type` across modules (plugin support) |
| 10 | `itabsinit` | Populates the global `itab` hash (see §8) |
| 11 | `goargs`/`goenvs` | Fills `os.Args` / `os.Environ` |
| 12 | `parsedebugvars` | Reads `GODEBUG` into runtime flags |
| 13 | `gcinit` | Sets `gcController.heapMinimum`, parses `GOGC`/`GOMEMLIMIT` |
| 14 | `procresize(procs)` | Allocates `allp[0:procs]`, attaches P0 to m0 |

`procresize` is the moment the scheduler becomes operational. Before it, no goroutine could run on a P. After it, m0 holds P0, and the next call (`newproc(main)` in `rt0_go`) puts a goroutine on P0's local run queue.

Two subtle invariants in this sequence:

- `mallocinit` must precede *every* Go-level allocation. Anything between TLS setup and `mallocinit` runs in nosplit assembly with no `runtime.newobject`.
- `alginit` seeds the random hash function. It must precede `itabsinit` (which hashes itabs) and any map creation. Maps created before `alginit` would use a zero seed, defeating hash flooding protection.

---

## 5. TLS layout per platform

On Linux/amd64, every `m` has a `tls [tlsSlots]uintptr` field. `runtime/sys_linux_amd64.s::settls` calls `arch_prctl(ARCH_SET_FS, &m.tls[0]+8)`. After that, the address `fs:-8` is `&m.tls[0]`, and `m.tls[0]` stores `g`.

```
// from runtime/sys_linux_amd64.s, simplified
TEXT runtime·settls(SB),NOSPLIT,$32
    ADDQ  $8, DI                 // ARCH_SET_FS expects (m.tls + 8)
    MOVQ  DI, SI
    MOVQ  $0x1002, DI            // ARCH_SET_FS
    MOVQ  $158, AX               // arch_prctl
    SYSCALL
    CMPQ  AX, $0xfffffffffffff001
    JLS   2(PC)
    MOVL  $0xf1, 0xf1            // crash
    RET
```

After 1.17, we still need TLS — but only for one purpose: when a non-Go thread calls back into Go (cgo callback), R14 holds whatever C had in it, so we must recover `g` from `fs:-8`.

Per-platform table:

| OS / arch | Mechanism | File |
|---|---|---|
| linux/amd64 | `arch_prctl(ARCH_SET_FS, ...)` | `runtime/sys_linux_amd64.s`, `runtime/tls_linux_amd64.s` |
| linux/arm64 | `tpidr_el0` system register | `runtime/sys_linux_arm64.s` |
| darwin/amd64 | `pthread_setspecific` via libSystem | `runtime/cgo/gcc_darwin_amd64.c`, `runtime/sys_darwin_amd64.s` |
| darwin/arm64 | `tpidrro_el0`; key allocated by libpthread | `runtime/sys_darwin_arm64.s` |
| windows/amd64 | `gs:0x28` (TEB slot 0); pre-cloned by Windows | `runtime/sys_windows_amd64.s` |
| freebsd/amd64 | `amd64_set_fsbase` syscall | `runtime/sys_freebsd_amd64.s` |

The darwin path is the asymmetric one. macOS dynamic loader uses `pthread_key_t`, and the Go runtime cannot call `pthread_setspecific` directly without going through libSystem. The bootstrap therefore links a small C shim in `runtime/cgo/gcc_darwin_amd64.c` and `dlopen`s libpthread to obtain the key. Pure-static Go binaries on darwin are not possible for this reason.

---

## 6. Cross-component invariants

The runtime has six subsystems (scheduler, allocator, GC, stack manager, network poller, timer heap) that share state. Three invariants hold the system together.

### 6.1 GC pacer ↔ allocator cooperation

When the GC is marking, every allocation may incur an **assist**:

```go
// from runtime/malloc.go, simplified
func mallocgc(size uintptr, typ *_type, needzero bool) unsafe.Pointer {
    ...
    if gcBlackenEnabled != 0 {
        assistG := getg()
        if assistG.m.preemptoff != "" {
            assistG = nil
        }
        if assistG != nil {
            assistG.gcAssistBytes -= int64(size)
            if assistG.gcAssistBytes < 0 {
                gcAssistAlloc(assistG)    // pay the debt
            }
        }
    }
    ...
}
```

`gcAssistAlloc` runs mark work proportional to the bytes the goroutine wants to allocate. Mutators that allocate fast pay for the GC they cause. Without this, the heap grows unbounded until the dedicated mark workers catch up.

The pacer (`runtime/mgcpacer.go::gcController`) computes the assist ratio:

```
assistRatio = (heap_goal - heap_marked) / (heap_live - heap_marked)
                                          == bytes_remaining_to_mark / bytes_remaining_to_allocate
```

A ratio of 0.5 means: for every 1 byte allocated, mark 0.5 bytes. The ratio is recomputed every 64 KB of allocation.

### 6.2 Mark worker ↔ mutator deadlock avoidance

Mark workers are normal goroutines (with `gp.gcAssistBytes = -1<<63` so they never assist). The scheduler runs at most `0.25 * GOMAXPROCS` dedicated workers concurrently (`runtime/proc.go::findRunnableGCWorker`).

The deadlock that *could* happen: a mutator holds a lock, runs out of assist credit, blocks in `gcAssistAlloc` on the mark queue — but every mark worker is also waiting for that lock. Solution in `runtime/mgcwork.go::gcw.balance` and `runtime/mgcmark.go::gcDrain`: mark workers periodically yield and check preemption; they never take user locks; and `gcAssistAlloc` can fall through to direct mark work without queueing if the global queue is contended.

### 6.3 Stack growth ↔ GC barrier

Stack scanning runs in two phases. The first scan happens with the goroutine paused. After resume, writes through pointers on the stack are *not* tracked by the write barrier (stacks are scanned grey-on-the-fly, not via barriers — performance). This is safe only because the second scan is a stop-the-world rescan of *changed* stacks (the `gp.gcscandone` flag tracks which goroutines have been rescanned).

Stack growth (`runtime/stack.go::copystack`) preserves the GC's view: the new stack is scanned identically to the old one, and `gp.gcscandone` is reset if growth happens between scans.

---

## 7. Channels in source

`runtime/chan.go` defines:

```go
// from runtime/chan.go, simplified
type hchan struct {
    qcount   uint           // total data in queue
    dataqsiz uint           // size of the circular queue
    buf      unsafe.Pointer // points to dataqsiz elements
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint   // send index
    recvx    uint   // receive index
    recvq    waitq  // list of recv waiters
    sendq    waitq  // list of send waiters
    lock     mutex  // *not* a sync.Mutex; runtime-internal
}
```

`chansend` (the `c <- v` operation):

```go
// from runtime/chan.go, simplified
func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
    if c == nil {
        if !block { return false }
        gopark(nil, nil, waitReasonChanSendNilChan, traceBlockForever, 2)
        throw("unreachable")
    }
    lock(&c.lock)
    if c.closed != 0 {
        unlock(&c.lock)
        panic(plainError("send on closed channel"))    // (*)
    }
    if sg := c.recvq.dequeue(); sg != nil {
        // direct hand-off to waiting receiver
        send(c, sg, ep, func() { unlock(&c.lock) }, 3)
        return true
    }
    if c.qcount < c.dataqsiz {
        // buffered slot available
        qp := chanbuf(c, c.sendx)
        typedmemmove(c.elemtype, qp, ep)
        c.sendx++; if c.sendx == c.dataqsiz { c.sendx = 0 }
        c.qcount++
        unlock(&c.lock)
        return true
    }
    if !block { unlock(&c.lock); return false }
    // park sender on sendq
    ...
}
```

The line marked `(*)` is the only place "send on closed channel panics" is enforced. The check happens *after* acquiring `c.lock`, which is why concurrent `close(c)` and `c <- v` cannot race — one of them serialises behind the other, and whichever observes `closed != 0` panics.

`chanrecv` mirror-images this: it dequeues from `sendq` for direct hand-off, then drains the buffer, then parks. Closed channels with empty buffers return the zero value (no panic on receive).

Lock contention on `c.lock` is the practical scaling ceiling. A channel handing off 50M items/sec is hitting the lock 100M times/sec.

---

## 8. Maps in source

### 8.1 Pre-1.24: open-addressed bucket hash

`runtime/map.go`:

```go
// from runtime/map.go (go1.22), simplified
type hmap struct {
    count     int
    flags     uint8
    B         uint8           // log_2 of #buckets
    noverflow uint16
    hash0     uint32          // seed, set in alginit
    buckets   unsafe.Pointer  // 2^B buckets of bmap
    oldbuckets unsafe.Pointer // non-nil during grow
    nevacuate uintptr
    extra     *mapextra
}

type bmap struct {
    tophash [8]uint8
    // followed in memory by:
    //   keys     [8]keytype
    //   values   [8]valuetype
    //   overflow *bmap
}
```

Each bucket holds 8 key/value pairs plus an overflow pointer. Lookup:

1. Hash the key with `c.hash0` as seed.
2. Low `B` bits select the bucket.
3. Top 8 bits are compared against `tophash[0..8]` for a fast inequality reject.
4. On a match, compare the full key.

Growth (`hashGrow` → `growWork` → `evacuate`) is **incremental**. Doubling allocates `2*2^B` buckets; subsequent insertions/lookups evacuate one or two old buckets at a time. The user never sees a stop-the-world rehash.

### 8.2 1.24: Swiss tables

Go 1.24 replaces the bucket layout with a Swiss-table-style design (`runtime/maps/`):

- Groups of 8 slots; each slot has a 7-bit "control byte" + a tombstone bit.
- SIMD probing: 16 control bytes loaded in one SSE/AVX2 instruction, compared against the search hash; the result mask gives the candidate slots.
- Same incremental growth contract; same `hash0` seed.

Reading order for the new code: `runtime/maps/table.go` → `runtime/maps/runtime.go`.

### 8.3 The seed and hash function

`runtime/alg.go::alginit` chooses:

```go
// from runtime/alg.go, simplified
func alginit() {
    if (GOARCH == "amd64" && cpu.X86.HasAES && cpu.X86.HasSSSE3) ||
       (GOARCH == "arm64" && cpu.ARM64.HasAES) {
        useAeshash = true
        initAlgAES()
    }
    getRandomData(aeskeysched[:])    // 128 bytes of /dev/urandom
}
```

`hash0` per map is also random (`fastrand()` at map creation). Together they defeat the predictable-collision attack on JSON/HTTP servers — an attacker cannot precompute keys that all collide.

---

## 9. Interfaces in source

`runtime/iface.go`:

```go
// from runtime/iface.go, simplified
type iface struct {
    tab  *itab
    data unsafe.Pointer
}

type eface struct {
    _type *_type
    data  unsafe.Pointer
}

type itab struct {
    inter *interfacetype     // the interface type (e.g. io.Reader)
    _type *_type             // the concrete type
    hash  uint32             // copy of _type.hash for fast type switch
    _     [4]byte
    fun   [1]uintptr         // method pointer table; variable-length
}
```

Two interface shapes:

- `iface` for typed interfaces (`io.Reader`, `error`): carries an `*itab` that points to a method table.
- `eface` for `interface{}` / `any`: carries `*_type` directly, no method table.

The `itab` cache (`runtime/iface.go::itabTable`) is a global open-addressed hash:

```go
// from runtime/iface.go, simplified
var (
    itabLock     mutex
    itabTable    = &itabTableInit
    itabTableInit = itabTableType{size: 512}
)

func getitab(inter *interfacetype, typ *_type, canfail bool) *itab {
    t := (*itabTableType)(atomic.Loadp(unsafe.Pointer(&itabTable)))
    if m := t.find(inter, typ); m != nil { return m }
    // slow path: lock, build itab, install
    lock(&itabLock)
    ...
}
```

The fast-path lookup is atomic-load + linear probe — no lock. The slow path runs once per (interface, concrete) pair for the lifetime of the program, then the result lives forever (itabs are never freed).

Cost: a type assertion `r.(*os.File)` walks the cache (1 ns hit) or builds an itab on first encounter (~1 µs). Type switches with N cases compile to a hash of `tab.hash` against case constants, not N comparisons.

---

## 10. Panic / recover / defer in source

`runtime/panic.go` and the "open-coded defer" optimisation introduced in Go 1.14.

### 10.1 Open-coded defer

For functions where the compiler can statically bound the number of `defer` statements and prove they all dominate the function exits, the compiler emits **inline** epilogues instead of pushing a `_defer` record:

```go
func f() {
    defer A()
    defer B()
    // ...
}
```

Compiles roughly to:

```
    deferBits = 0
    ; defer A
    deferBits |= 1
    save args for A
    ; defer B
    deferBits |= 2
    save args for B
    ; function body
    ...
    ; epilogue
    if deferBits & 2 { B(savedArgsB) }
    if deferBits & 1 { A(savedArgsA) }
    return
```

`deferBits` is a single byte on the stack. There is no `runtime.deferproc` call, no allocation, no linked list traversal at `return`. Benchmarks show defer overhead drops from ~30 ns to ~2 ns per defer.

Conditions for open-coded defer (compiler enforces):

- ≤ 8 defers in the function (one bit each).
- No defer inside a loop (count is not statically bounded).
- No `recover()` in a goroutine that survives the defer (the slow path is needed for unwinding).
- Function is not inlined into a parent that exceeds the budget.

Fallback to slow path: `runtime.deferproc` allocates a `_defer` from `p.deferpool`, links it onto `g._defer`. `runtime.deferreturn` walks the list at `return`. ~30 ns per defer; the price was acceptable for 6 years before the compiler effort to eliminate it.

### 10.2 Panic unwind

```go
// from runtime/panic.go, simplified
func gopanic(e any) {
    gp := getg()
    var p _panic
    p.arg = e
    p.link = gp._panic
    gp._panic = (*_panic)(noescape(unsafe.Pointer(&p)))

    for {
        d := gp._defer
        if d == nil { break }
        // run d.fn; if it calls recover(), p.recovered = true
        d.started = true
        reflectcall(nil, unsafe.Pointer(d.fn), ...)
        gp._defer = d.link
        if p.recovered {
            // jump back into the recovering frame
            mcall(recovery)
        }
    }
    // unrecovered: terminate
    fatalpanic(gp._panic)
}
```

`recover()` is a single field write: `getg()._panic.recovered = true`. The actual stack jump is `mcall(recovery)` → `gogo(&gp.sched)` with the SP/PC set to just-after the deferred call in the recovering frame.

A `recover` outside a deferred function is a no-op because `gp._panic` is nil when no panic is unwinding.

---

## 11. Timers since 1.21

Before 1.21, all `time.Timer`s lived in a single global heap protected by one mutex. At 1M timers and 1M Hz of fire/reset, the mutex was the bottleneck.

1.21 moved timers to **per-P heaps** (`runtime/time.go`):

```go
// from runtime/runtime2.go (go1.22), simplified
type p struct {
    ...
    timersLock mutex
    timers     []*timer        // heap, sorted by `when`
    numTimers  atomic.Uint32
    deletedTimers atomic.Uint32
    timer0When atomic.Int64    // earliest deadline; sysmon reads this
    ...
}
```

`time.NewTimer(d)` adds to the current P's heap. The scheduler's `findrunnable` checks `p.timer0When` against `nanotime()` and pops expired timers, sending the value on the channel or running the function.

Cross-P interaction is now rare:

- Work stealing (`runtime/proc.go::stealWork`) also steals ready timers from victim P's.
- `sysmon` polls P timer heaps when all P's are sleeping (idle case).

Net effect: timer-heavy services (HTTP servers with per-request timeouts) scale linearly with `GOMAXPROCS` instead of plateauing on a global mutex. The migration is fully transparent at the `time` package API.

---

## 12. Signal handling end to end

The classic case: goroutine preemption.

### 12.1 SIGURG arrives

`sysmon` detects that a goroutine has run too long (>10 ms without a function call). It calls `preemptone(p)`, which calls `signalM(m, sigPreempt)`. `sigPreempt` is **SIGURG** on most Unixes (Go re-purposes it; nothing else in user code is supposed to use SIGURG).

### 12.2 Kernel delivery

The kernel pushes a signal frame onto the *current* user stack (or `m.gsignal` stack if `SA_ONSTACK` is set — Go does set it) and resumes execution at `sigtramp`:

```
// from runtime/signal_amd64.S, simplified
TEXT runtime·sigtramp(SB),NOSPLIT,$72
    MOVQ  DI, 0(SP)              // signum
    MOVQ  SI, 8(SP)              // siginfo
    MOVQ  DX, 16(SP)             // context (ucontext_t)
    MOVQ  $runtime·sigtrampgo(SB), AX
    CALL  AX
    RET
```

`sigtramp` is the kernel-visible entry; it sets up a Go-callable frame and forwards to `sigtrampgo` in `runtime/signal_unix.go`.

### 12.3 Dispatch

`sigtrampgo` switches to `g.signalStack` (`m.gsignal`) so the handler runs on a guaranteed-large stack. It then calls `sighandler`. For SIGURG:

```go
// from runtime/signal_unix.go, simplified
func sighandler(sig uint32, info *siginfo, ctxt unsafe.Pointer, gp *g) {
    if sig == sigPreempt && debug.asyncpreemptoff == 0 {
        doSigPreempt(gp, (*sigctxt)(noescape(unsafe.Pointer(&ctx))))
        return
    }
    ...
}
```

`doSigPreempt` checks whether the goroutine is at a "safe point" (no critical runtime call in progress, no `//go:nosplit` function on top). If so, it edits the saved PC in the signal context to point at `runtime.asyncPreempt`:

```go
// from runtime/preempt.go, simplified
func doSigPreempt(gp *g, ctxt *sigctxt) {
    if wantAsyncPreempt(gp) {
        if ok, newpc := isAsyncSafePoint(gp, ctxt.sigpc(), ctxt.sigsp(), ctxt.siglr()); ok {
            ctxt.pushCall(funcPC(asyncPreempt), newpc)
        }
    }
}
```

### 12.4 Resume

The kernel returns from the signal frame (`rt_sigreturn`). The goroutine resumes — but at `asyncPreempt`, not at the interrupted instruction.

`asyncPreempt` is hand-written assembly (`runtime/preempt_amd64.s`) that saves *all* registers (it didn't know which the user code was using), calls `runtime.asyncPreempt2` which calls `gopreempt_m`, which yields to the scheduler. On reschedule, `gogo` restores the registers and resumes the *real* interrupted instruction.

The entire round trip takes ~3 µs. Critically, it works in tight loops that have no function calls — pre-1.14 Go could not preempt those, leading to GC starvation in CPU-bound code.

---

## 13. Cgo bridge

### 13.1 Go calling C

`runtime/cgocall.go::cgocall`:

```go
// from runtime/cgocall.go, simplified
func cgocall(fn, arg unsafe.Pointer) int32 {
    mp := getg().m
    mp.ncgocall++
    mp.ncgo++

    entersyscall()
    // we are now off the P; another goroutine can run on it
    errno := asmcgocall(fn, arg)
    exitsyscall()
    // we have a P again (maybe a different one)
    return errno
}
```

`entersyscall` (`runtime/proc.go`) hands the current P back to the scheduler. The OS thread continues into C without holding a P. Other goroutines can run on the surrendered P in parallel.

`exitsyscall` reattaches a P. Fast path: the original P is still idle, reattach in nanoseconds. Slow path: park the M, wait for a P.

### 13.2 C calling Go

`runtime/cgocallback.go::cgocallback`. The challenge: the C thread may have no `g` at all (created by C, never seen by Go). We need to:

1. Recover or create an `m`.
2. Switch onto `m.g0`'s stack.
3. Set R14 to the user goroutine's `g`.
4. Call the Go function.
5. Restore the C stack on return.

```
// from runtime/asm_amd64.s, simplified
TEXT runtime·cgocallback(SB),NOSPLIT,$24-24
    // C may have clobbered FS. Reload g from TLS.
    get_tls(CX)
    MOVQ  g(CX), R14
    CMPQ  R14, $0
    JNE   havem
    // No g: this is a foreign thread. Allocate one.
    CALL  runtime·needAndBindM(SB)
    ...
```

`needAndBindM` allocates an `m` and `g0`, pthread-keys an exit callback to release them when the thread dies. Once bound, the same C thread can re-enter Go cheaply.

### 13.3 `m.dying` state

When a Go panic propagates back through a cgo frame, the runtime sets `m.dying` to track unwinding state. C code is not allowed to longjmp through Go frames; the runtime aborts the process if `m.dying != 0` and another panic starts.

---

## 14. Module init order

The linker emits a `runtime/moduledata` per object module (the main binary plus each plugin). Each module has an `inittasks` slice listing functions to run, in dependency order computed by the compiler.

```go
// from runtime/proc.go::doInit, simplified
func doInit(ts []*initTask) {
    for _, t := range ts {
        for (*t).state != 2 {     // not finished
            doInit1(t)
        }
    }
}

func doInit1(t *initTask) {
    switch t.state {
    case 0: // not started
        t.state = 1
        for _, dep := range t.deps() {
            doInit1(dep)            // post-order
        }
        for _, f := range t.fns() {
            f()                     // package init funcs in source order
        }
        t.state = 2
    case 1: // already running -- cycle, compiler caught this
        throw("recursive call during initialization")
    }
}
```

Order: dependencies first (post-order traversal of the import graph); within a package, `var` initialisers in declaration order, then `init()` functions in source order. The compiler reorders `var` initialisers to satisfy data dependencies between them — a fact that occasionally surprises users who expect strict source order.

`runtime.main` (in `runtime/proc.go`) calls `doInit(runtime_inittasks)` for the runtime, then `doInit(main_inittasks)` for the user program, then `main.main`.

---

## 15. Case study: `os.Open("/etc/hosts")`

Walk the path from user code to kernel and back. Annotated:

```
os.Open("/etc/hosts")                              // os/file.go
  -> OpenFile(name, O_RDONLY, 0)                   // os/file.go
    -> openFileNolog(name, flag, perm)             // os/file_unix.go
      -> ignoringEINTR(func() { ... })
        -> syscall.Open(name, flag, perm)          // syscall/zsyscall_linux_amd64.go
          -> Syscall(SYS_OPENAT, AT_FDCWD,         // syscall/syscall_linux.go
                     uintptr(unsafe.Pointer(p)),
                     uintptr(flags))
            -> RawSyscall6 OR Syscall6             // runtime/sys_linux_amd64.s
```

`syscall.Syscall` (the version that goes through the runtime, not `RawSyscall`) wraps the actual SYSCALL instruction with `entersyscall`/`exitsyscall`:

```
// from runtime/sys_linux_amd64.s, conceptual; the real path is in syscall/asm_linux_amd64.s
TEXT syscall·Syscall(SB),NOSPLIT,$0-56
    CALL  runtime·entersyscall(SB)
    MOVQ  a1+8(FP), DI
    MOVQ  a2+16(FP), SI
    MOVQ  a3+24(FP), DX
    MOVQ  trap+0(FP), AX
    SYSCALL
    CMPQ  AX, $0xfffffffffffff001
    JLS   ok
    ...
    CALL  runtime·exitsyscall(SB)
    RET
ok:
    MOVQ  AX, r1+32(FP)
    MOVQ  $0, err+48(FP)
    CALL  runtime·exitsyscall(SB)
    RET
```

What happens inside `entersyscall`:

```go
// from runtime/proc.go, simplified
func entersyscall() {
    gp := getg()
    gp.m.locks++
    gp.stackguard0 = stackPreempt   // no preemption inside syscall
    gp.throwsplit = true
    save(getcallerpc(), getcallersp())
    gp.syscallsp = gp.sched.sp
    gp.syscallpc = gp.sched.pc
    gp.m.syscalltick = gp.m.p.ptr().syscalltick
    pp := gp.m.p.ptr()
    pp.m = 0
    gp.m.oldp.set(pp)
    gp.m.p = 0
    atomic.Store(&pp.status, _Psyscall)
    gp.m.locks--
}
```

The P (`pp`) is parked in `_Psyscall` state. `sysmon`, watching for syscalls that stall longer than 20 µs, will hand `pp` to another M (`handoffp` → wake or create an M).

`exitsyscall` tries the fast path:

```go
func exitsyscall() {
    gp := getg()
    oldp := gp.m.oldp.ptr()
    if oldp != nil && atomic.Cas(&oldp.status, _Psyscall, _Pidle) {
        // we got our P back; resume immediately
        wirep(oldp)
        ...
        return
    }
    // slow path: park M, find a P
    mcall(exitsyscall0)
}
```

For our `open()`: the SYSCALL completes in microseconds, `sysmon` does not have time to steal the P, the fast path wins, and the goroutine resumes on the same P with the same M.

Total runtime instrumentation cost: ~50 ns of overhead around a syscall that itself takes ~1 µs. The same goroutine can be scheduled away if the syscall blocks (network reads on a non-pollable fd, disk reads on a slow disk) without blocking the underlying P.

Network sockets are special: `os.Open` on a socket fd attached to the netpoller never invokes `entersyscall`. Instead, `internal/poll.FD.Read` does a non-blocking syscall and parks the goroutine on the netpoller (`runtime/netpoll.go`) on EAGAIN. The P stays attached. This is why a Go HTTP server runs 1M idle connections on 4 OS threads.

---

## 16. Cross-references and where to read next

| Subsystem | Primary file | Companion reading |
|---|---|---|
| Scheduler | `runtime/proc.go` | `runtime/runtime2.go`, `runtime/asm_amd64.s` |
| Allocator | `runtime/malloc.go`, `runtime/mheap.go` | `runtime/mcache.go`, `runtime/mcentral.go`, `runtime/mspan.go` |
| GC | `runtime/mgc.go`, `runtime/mgcpacer.go` | `runtime/mgcmark.go`, `runtime/mgcwork.go`, `runtime/mgcsweep.go` |
| Stack | `runtime/stack.go` | `runtime/asm_amd64.s::morestack` |
| Channels | `runtime/chan.go` | `runtime/select.go` |
| Maps | `runtime/map.go`, `runtime/maps/` (1.24+) | `runtime/alg.go` |
| Interfaces | `runtime/iface.go` | `runtime/type.go` |
| Defers/Panic | `runtime/panic.go` | `runtime/preempt.go` |
| Timers | `runtime/time.go` | `runtime/runtime2.go::p.timers` |
| Signals | `runtime/signal_unix.go` | `runtime/signal_amd64.go`, `runtime/sigtab_linux_generic.go` |
| Cgo | `runtime/cgocall.go`, `runtime/cgocallback.go` | `runtime/cgo/*.c`, `runtime/asm_amd64.s::cgocallback` |
| Netpoller | `runtime/netpoll.go` | `runtime/netpoll_epoll.go` (linux), `runtime/netpoll_kqueue.go` (darwin/bsd) |
| Sysmon | `runtime/proc.go::sysmon` | drives preemption, syscall retake, GC trigger, scavenger |

Read in this order for first exposure: `runtime2.go` → `proc.go::schedinit` → `proc.go::schedule` → `chan.go` → `iface.go` → `panic.go` → `mgc.go::gcStart` → `cgocall.go`. By the end of that path, every runtime-introduced stack frame in a Go pprof has a name and a purpose.
