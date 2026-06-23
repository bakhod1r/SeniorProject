# Goroutine Stack Growth — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Compiler-Emitted Prologue](#the-compiler-emitted-prologue)
3. [`morestack` and `morestack_noctxt` — Assembly Entry](#morestack-and-morestack_noctxt--assembly-entry)
4. [`newstack` — Allocate, Copy, Switch](#newstack--allocate-copy-switch)
5. [`stackalloc` and the Stack Pool](#stackalloc-and-the-stack-pool)
6. [`copystack` and Pointer Fix-up](#copystack-and-pointer-fix-up)
7. [Stack Maps Emitted by the Compiler](#stack-maps-emitted-by-the-compiler)
8. [Shrinking — `shrinkstack`](#shrinking--shrinkstack)
9. [GC Integration](#gc-integration)
10. [Edge Cases — `g0`, `gsignal`, cgo](#edge-cases--g0-gsignal-cgo)
11. [Reading `runtime/stack.go`](#reading-runtimestackgo)
12. [Summary](#summary)

---

## Introduction

The professional level is where the abstraction of "the goroutine stack grows when needed" decomposes into specific functions in `runtime/stack.go`, specific assembly stubs in `runtime/asm_*.s`, and specific data structures from `runtime/runtime2.go`. References point to Go 1.22 source; minor versions may shift line numbers but the design is stable.

The flow you should be able to recite from memory by the end of this file:

```
function prologue
   |
   v
  CMPQ SP, g.stackguard0          ; compiler-inserted
   |
   v
runtime.morestack_noctxt           ; assembly
   |
   v
runtime.newstack                   ; Go
   |     |
   |     +--> stackalloc(new size)
   |     +--> copystack(g, new)
   |     +--> stackfree(old)
   v
function body resumes on new stack
```

---

## The Compiler-Emitted Prologue

The Go compiler (`cmd/compile`) emits a prologue at the start of nearly every function. On amd64, conceptually:

```
TEXT main.f(SB), $framesize-argsize
    MOVQ (TLS), CX                 ; CX = G (pointer to current goroutine)
    CMPQ SP, 16(CX)                ; offset 16 = g.stackguard0
    JLS  morestack_noctxt
    SUBQ $framesize, SP            ; lay down frame
    ; ... body ...
    ADDQ $framesize, SP
    RET
```

In Go 1.17+ the register-based ABI uses a dedicated register (R14 on amd64) instead of TLS to point at `g`, making the check:

```
CMPQ SP, 16(R14)
JLS  morestack_noctxt
```

### Variants

- **`morestack_noctxt`** — for functions that don't use the closure context.
- **`morestack`** — for functions that do (e.g., closures referencing captured variables).

The compiler picks the right variant based on the function's properties. Both lead to `newstack`.

### Frame-size aware check

For functions with frames larger than `_StackSmall` (~128 bytes), the prologue subtracts the frame size before comparing, ensuring growth happens *before* the frame is laid out:

```
LEAQ -framesize(SP), AX
CMPQ AX, 16(R14)
JLS  morestack_noctxt
```

### The `_StackGuard` constant

Defined in `runtime/stack.go`:

```go
const (
    _StackSystem  = goos.IsWindows*512*goarch.PtrSize +
                    goos.IsPlan9*512 + goos.IsIos*goarch.IsArm64*1024
    _StackMin     = 2048    // 2 KB initial size
    _FixedStack0  = _StackMin + _StackSystem
    _FixedStack   = _FixedStack0 + ...  // rounded up
    _StackGuard   = 928*sys.StackGuardMultiplier + _StackSystem
    _StackSmall   = 128
    _StackBig     = 4096
)
```

`_StackGuard` is the headroom maintained between SP and the bottom of the stack. The check `SP <= stackguard0` becomes `SP > stack.lo + _StackGuard`, which means "at least 928 bytes of stack are below SP for emergencies."

### Why `_StackGuard` exists

`//go:nosplit` functions skip the check, but they may still consume stack. The runtime guarantees that ~928 bytes are always free below the current SP so a nosplit chain of typical depth (a few dozen calls) fits without overflow. Runtime invariant: total nosplit-frame depth must fit in `_StackGuard` bytes.

---

## `morestack` and `morestack_noctxt` — Assembly Entry

When the prologue's `JLS` jumps to `morestack_noctxt`, control enters assembly. From `runtime/asm_amd64.s`:

```
TEXT runtime·morestack_noctxt(SB),NOSPLIT,$0
    MOVL    $0, DX           ; no context
    JMP     runtime·morestack(SB)

TEXT runtime·morestack(SB),NOSPLIT,$0-0
    // Cannot grow scheduler stack (m->g0).
    get_tls(CX)
    MOVQ    g(CX), BX
    MOVQ    g_m(BX), BX
    MOVQ    m_g0(BX), SI
    CMPQ    g(CX), SI
    JNE     3(PC)
    CALL    runtime·badmorestackg0(SB)
    INT     $3

    // Save state of caller in g->sched.
    MOVQ    8(SP), AX        ; saved PC
    MOVQ    AX, (g_sched+gobuf_pc)(BX)
    LEAQ    16(SP), AX       ; SP just before caller's frame
    MOVQ    AX, (g_sched+gobuf_sp)(BX)
    MOVQ    BP, (g_sched+gobuf_bp)(BX)
    MOVQ    DX, (g_sched+gobuf_ctxt)(BX)

    // Switch to m->g0 stack and call newstack.
    MOVQ    m_g0(g_m(g(CX))), BX
    MOVQ    (g_sched+gobuf_sp)(BX), SP
    CALL    runtime·newstack(SB)
    CALL    runtime·abort(SB)  // newstack does not return here
```

Key steps:

1. Verify we are not growing the M's `g0` stack (which is fixed-size; growing it would be a bug).
2. Save the caller's PC, SP, BP, and context into `g.sched` — this is the "frozen" state of the goroutine.
3. Switch to the M's `g0` stack (the system stack) so `newstack` runs with a known, fixed amount of headroom.
4. Call `newstack`.

`newstack` does not return to `morestack`; it does its work and then re-enters the goroutine via `gogo(&gp.sched)`, which restores the saved PC/SP/BP.

---

## `newstack` — Allocate, Copy, Switch

From `runtime/stack.go`, simplified:

```go
func newstack() {
    thisg := getg()
    // ... lots of assertion / setup ...

    gp := thisg.m.curg
    morebuf := thisg.m.morebuf
    thisg.m.morebuf.pc = 0
    thisg.m.morebuf.lr = 0
    thisg.m.morebuf.sp = 0
    thisg.m.morebuf.g = 0

    // Is this an async preemption disguised as a stack-growth?
    preempt := atomic.Loaduintptr(&gp.stackguard0) == stackPreempt

    if preempt {
        // Handle preemption path: gopreempt_m → schedule.
        // (Async preemption is implemented by overloading stackguard0.)
        if !canPreemptM(thisg.m) {
            gp.stackguard0 = gp.stack.lo + _StackGuard
            gogo(&gp.sched)
        }
        gopreempt_m(gp)
    }

    // Real stack growth path.
    sp := gp.sched.sp
    if !canGrowStack(gp) || ... {
        throw("stack growth not allowed")
    }

    oldsize := gp.stack.hi - gp.stack.lo
    newsize := oldsize * 2

    // Check max.
    if f := readgstatus(gp); f&_Gscan != 0 { ... }
    if newsize > maxstacksize {
        print("runtime: goroutine stack exceeds ", maxstacksize, "-byte limit\n")
        print("runtime: sp=", hex(sp), " stack=[", hex(gp.stack.lo), ", ", hex(gp.stack.hi), "]\n")
        throw("stack overflow")
    }

    // Switch the goroutine to a new stack.
    casgstatus(gp, _Grunning, _Gcopystack)
    copystack(gp, newsize)
    casgstatus(gp, _Gcopystack, _Grunning)
    gogo(&gp.sched)
}
```

### Three things happen here

1. **Preempt check first.** The runtime overloads `stackguard0` to also signal preemption: setting it to the sentinel `stackPreempt` makes every prologue check fail and enter `newstack`. If `preempt` is set, the goroutine is descheduled instead of grown.
2. **Size doubling.** New size = old size × 2. If above `maxstacksize`, throw `"stack overflow"`.
3. **`copystack(gp, newsize)`.** This does the heavy lifting.

### Why the status changes to `_Gcopystack`

GC must not scan a goroutine's stack while it is being copied. Setting status to `_Gcopystack` prevents the GC from racing with `copystack`. After the copy, status returns to `_Grunning`.

### `gogo(&gp.sched)`

Restores the goroutine's PC, SP, and BP from `gp.sched` — but the SP is now an offset into the *new* stack (`copystack` adjusts it). The goroutine resumes at the same logical instruction with a bigger stack.

---

## `stackalloc` and the Stack Pool

`stackalloc(size)` returns a `stack` (a `{lo, hi}` pair):

```go
func stackalloc(n uint32) stack {
    thisg := getg()
    // Must be on the system stack — otherwise we could grow inside stackalloc.
    if thisg != thisg.m.g0 {
        throw("stackalloc not on scheduler stack")
    }

    // Fast path: small stacks come from per-P cache.
    if n < _FixedStack<<_NumStackOrders {
        order := uint8(0)
        n2 := n
        for n2 > _FixedStack {
            order++
            n2 >>= 1
        }
        var x gclinkptr
        c := thisg.m.p.ptr().mcache
        if c == nil || stackNoCache != 0 {
            // Global pool.
            lock(&stackpool[order].item.mu)
            x = stackpoolalloc(order)
            unlock(&stackpool[order].item.mu)
        } else {
            x = c.stackcache[order].list
            if x.ptr() == nil {
                stackcacherefill(c, order)
                x = c.stackcache[order].list
            }
            c.stackcache[order].list = x.ptr().next
            c.stackcache[order].size -= uintptr(n)
        }
        v := unsafe.Pointer(x)
        return stack{uintptr(v), uintptr(v) + uintptr(n)}
    }

    // Slow path: large stacks come from heap allocator.
    var s *mspan
    npage := uintptr(n) >> _PageShift
    log2npage := stacklog2(npage)
    lock(&stackLarge.lock)
    if !stackLarge.free[log2npage].isEmpty() {
        s = stackLarge.free[log2npage].first
        stackLarge.free[log2npage].remove(s)
    }
    unlock(&stackLarge.lock)
    if s == nil {
        s = mheap_.allocManual(npage, &memstats.stacks_inuse)
        // ...
    }
    v := unsafe.Pointer(s.base())
    return stack{uintptr(v), uintptr(v) + uintptr(n)}
}
```

### Bucket sizes (Go 1.22)

`_NumStackOrders = 4` on 64-bit, meaning size classes are 2 KB, 4 KB, 8 KB, 16 KB. Sizes above 16 KB go to the large-stack allocator (`stackLarge`).

### Per-P stack cache (`mcache.stackcache`)

Each P has an `mcache` with per-order linked lists of free stacks. Allocation is lock-free (one cache line per P). Refill from the global pool only when the cache is empty.

### Global pool (`stackpool`)

One per order. Protected by a per-order mutex. Refilled from new heap allocations when empty.

### Large stacks

For sizes > 16 KB, the runtime uses the heap allocator with a separate free-list per page-count log (`stackLarge.free`). These are not pooled aggressively; they go through the page allocator on alloc/free.

---

## `copystack` and Pointer Fix-up

From `runtime/stack.go`:

```go
func copystack(gp *g, newsize uintptr) {
    if gp.syscallsp != 0 {
        throw("stack growth not allowed in system call")
    }
    old := gp.stack
    if old.lo == 0 {
        throw("nil stackbase")
    }
    used := old.hi - gp.sched.sp

    // Allocate new stack.
    new := stackalloc(uint32(newsize))

    // Compute adjustment info.
    var adjinfo adjustinfo
    adjinfo.old = old
    adjinfo.delta = new.hi - old.hi

    // Adjust sudogs (channel wait records pointing into stack).
    ncopy := used
    if !gp.activeStackChans {
        adjustsudogs(gp, &adjinfo)
    } else {
        // Tricky: another goroutine may be using a sudog
        // pointing into our stack. Synchronise.
        gp.parkingOnChan.Store(true)
        adjustsudogs(gp, &adjinfo)
    }

    // Copy the stack contents.
    memmove(unsafe.Pointer(new.hi - ncopy), unsafe.Pointer(old.hi - ncopy), ncopy)

    // Adjust remaining state.
    adjustctxt(gp, &adjinfo)
    adjustdefers(gp, &adjinfo)
    adjustpanics(gp, &adjinfo)
    if adjinfo.sghi != 0 {
        adjinfo.sghi += adjinfo.delta
    }

    // Swap stacks.
    gp.stack = new
    gp.stackguard0 = new.lo + _StackGuard
    gp.sched.sp = new.hi - used
    gp.stktopsp += adjinfo.delta

    // Adjust pointers in the frame chain.
    var u unwinder
    for u.init(gp, 0); u.valid(); u.next() {
        adjustframe(&u.frame, &adjinfo)
    }

    // Free old stack.
    stackfree(old)
}
```

### Adjustment functions

| Function | What it adjusts |
|---|---|
| `adjustsudogs` | Pointers inside `sudog` channel-wait records that point into the goroutine's stack. |
| `adjustctxt` | The function context pointer (closure) saved in `gp.sched.ctxt`. |
| `adjustdefers` | Each defer record's pointers (PC, SP, function argument areas). |
| `adjustpanics` | Each panic record's `argp` (which points to the panic's argument frame). |
| `adjustframe` (in loop) | Each function frame in the call chain — locals, arguments, saved registers — using the function's stack map. |

### `adjustframe` — the inner workhorse

```go
func adjustframe(frame *stkframe, adjinfo *adjustinfo) {
    if frame.continpc == 0 {
        return
    }
    f := frame.fn
    pcdata := pcdatavalue(f, abi.PCDATA_StackMapIndex, frame.continpc-1, nil)
    if pcdata == -1 {
        pcdata = 0
    }

    // Locals.
    locals, args, objs := frame.getStackMap(nil, true)
    if locals.n > 0 {
        size := uintptr(locals.n) * goarch.PtrSize
        adjustpointers(unsafe.Pointer(frame.varp - size), &locals, adjinfo, f)
    }

    // Arguments.
    if args.n > 0 {
        adjustpointers(unsafe.Pointer(frame.argp), &args, adjinfo, funcInfo{})
    }

    // Heap-escaped objects rooted in this frame.
    if frame.varp != 0 {
        for _, obj := range objs {
            off := obj.off
            // ... adjust pointer at offset off ...
        }
    }
}

func adjustpointers(scanp unsafe.Pointer, bv *bitvector, adjinfo *adjustinfo, f funcInfo) {
    minp := adjinfo.old.lo
    maxp := adjinfo.old.hi
    delta := adjinfo.delta
    num := uintptr(bv.n)
    for i := uintptr(0); i < num; i++ {
        if bv.ptrbit(i) == 1 {
            pp := (*uintptr)(add(scanp, i*goarch.PtrSize))
            p := *pp
            if minp <= p && p < maxp {
                *pp = p + delta
            }
        }
    }
}
```

### What this loop does

For each pointer slot in each frame:

1. Read the current value `p`.
2. If `p` is in the old stack range `[minp, maxp)`, add `delta` to it. This makes `p` point to the corresponding location in the new stack.
3. Otherwise leave `p` alone (it points to heap or to global memory).

This is *only safe* because the compiler emits stack maps describing which slots are pointers.

---

## Stack Maps Emitted by the Compiler

The compiler emits, for each function, metadata describing:

- For each possible PC value, which stack slots hold pointers.
- This is stored as `funcdata` accessible via `funcInfo.funcdata(_FUNCDATA_LocalsPointerMaps)` etc.

### Why per-PC?

A local variable might not have been initialised at the start of a function; it becomes a valid pointer only after the assignment. The stack map for early PCs marks the slot as "not a pointer"; for later PCs it marks it as "pointer." This precision is needed for both GC scanning and stack copying.

### `pcdata` and `funcdata`

- **`pcdata`** — PC-indexed metadata (e.g., stack map index, line numbers).
- **`funcdata`** — function-level metadata blobs (e.g., the actual stack maps).

Defined in `runtime/symtab.go`.

### What if a pointer is hidden?

If your code stores a pointer as `uintptr`:

```go
var p uintptr = uintptr(unsafe.Pointer(&local))
```

The stack map marks `p` as a *uintptr*, not a pointer. During growth, the runtime does *not* adjust `p`. After the stack moves, `p` is a stale address that no longer refers to anything valid.

This is the canonical "unsafe is unsafe" hazard. The standard library uses `unsafe.Pointer` carefully but always re-derives the address right before use, never storing it across calls.

---

## Shrinking — `shrinkstack`

From `runtime/stack.go`:

```go
func shrinkstack(gp *g) {
    if !gp.activeStackChans {
        // We can shrink.
        if gp.syscallsp != 0 {
            return  // in a syscall, leave it alone
        }
    }

    oldsize := gp.stack.hi - gp.stack.lo
    newsize := oldsize / 2
    if newsize < _FixedStack {
        return  // already at minimum
    }
    avail := gp.stack.hi - gp.stack.lo
    if used := gp.stack.hi - gp.sched.sp + _StackLimit; used >= avail/4 {
        return  // too much in use
    }

    copystack(gp, newsize)
}
```

### When is it called?

`shrinkstack` is called by `scanstack` during GC. Each goroutine's stack is scanned once per GC cycle; while we're scanning, we check whether we should shrink.

### Why not shrink eagerly?

Two reasons:

1. We'd race with the goroutine using its stack. Shrinking has to copy, which requires the goroutine to be stopped at a safe point.
2. Shrinking has a cost (memcpy + pointer fix-up). Doing it on every "low water mark" event would dominate runtime. Once per GC is rare enough.

### Lower bound

`_FixedStack` = `_StackMin` + system padding = ~2 KB on most systems. The runtime never shrinks below this; the cost of growing back exceeds the savings.

---

## GC Integration

Stack growth and GC interact in three ways:

### 1. GC scans stacks for roots

To find live heap objects, GC walks each goroutine's stack and identifies pointer slots via stack maps. The same maps used for `copystack` adjustment are used for GC scanning.

This means *every Go function must have correct stack maps*. The compiler enforces this; manual assembly must use `GO_ARGS_STACKMAP` and friends to declare them.

### 2. GC stops the world (or specific goroutines) to scan

During the mark phase, the runtime asks each goroutine to "yield at a safe point." Once a goroutine is at a safe point, GC can scan its stack. Stack growth happens at safe points (function-call boundaries) so growth and scan are naturally serialised by status flags (`_Gscan`, `_Gcopystack`).

### 3. GC may shrink stacks

As described above, `shrinkstack` is called during `scanstack`.

### Concurrent GC and stack copying

Go's GC is concurrent. A goroutine may be running while GC scans most things; but during stack scan, the goroutine is stopped briefly. The runtime's "rescan" mechanism plus the `_Gscan` bit ensures that:

- If GC is scanning my stack, I cannot also be growing it.
- If I am growing, GC waits until the growth completes before scanning.

This is implemented via atomic CAS on `g.atomicstatus`.

---

## Edge Cases — `g0`, `gsignal`, cgo

### `g0` — the M's system stack

Every M (OS thread) has a `g0` that runs scheduler code, GC code, and `newstack` itself. `g0`'s stack is **not growable** — it is allocated once when the M is created, typically 8 KB on Linux (mapped via the OS thread's stack at `clone(2)` time).

`g0` is in `_Grunning` but its status is special: code running on `g0` must be `//go:nosplit` or carefully audited to stay within `g0`'s fixed budget. The runtime checks: `if g0.stackguard0 > g0.stack.lo + _StackGuard` ... we've blown `g0`'s stack, throw.

### `gsignal` — the signal-handling stack

Each M has a `gsignal` for handling signals. Allocated via `sigaltstack(2)` so the kernel delivers signals onto this stack. Typically 32 KB. Not growable.

Signal-handler code (`sigtramp`, `sigtrampgo`, `sighandler`) must fit within `gsignal`'s budget. The Go runtime's signal handlers are short and carefully bounded.

### cgo — Go calls C

`cgocall` switches from the goroutine stack to `g0`:

```
asmcgocall:
    save Go SP in g.sched.sp
    SP = m.g0.sp
    call C function
    SP = saved Go SP
```

While in C, the goroutine's stack does not exist for the running code — execution is on `g0`. C cannot grow `g0`. A C function with a 16 KB local array on an 8 KB `g0` stack will overflow and segfault.

Workaround: ensure C code respects the `g0` budget. For very deep C recursion, use `runtime.LockOSThread` plus a custom C-side thread with a larger stack.

### cgo callbacks — C calls Go

When C calls a Go callback, the runtime allocates a new G (or finds an existing one) and switches to its stack. The C-side stack remains; the new G has its own growable Go stack. The cost is significant (~3× a normal cgo call); avoid frequent callbacks.

---

## Reading `runtime/stack.go`

The full implementation is ~1500 lines. Key sections:

| Region | Contents |
|---|---|
| Constants | `_StackMin`, `_StackGuard`, `_NumStackOrders`, `_FixedStack`. |
| `stackpoolinit` | Initialise per-order stack pools. |
| `stackalloc` | Allocate a stack from pool or heap. |
| `stackfree` | Return a stack to pool or heap. |
| `newstack` | The entry from `morestack` — orchestrates growth. |
| `copystack` | The copy + fix-up logic. |
| `adjustsudogs`, `adjustctxt`, `adjustdefers`, `adjustpanics` | Pointer adjustment helpers. |
| `adjustframe`, `adjustpointers` | Frame-walking adjusters. |
| `shrinkstack` | Shrink if usage low. |
| `scanstack` | GC scan; calls `shrinkstack`. |
| `stackmapdata`, `funcInfo` helpers | Stack-map metadata access. |

### Related files

- `runtime/runtime2.go` — types (`g`, `m`, `p`, `stack`).
- `runtime/asm_amd64.s` (and `arm64`, etc.) — `morestack` assembly.
- `runtime/proc.go` — scheduler, calls `newstack` indirectly via gobuf.
- `runtime/mgcmark.go` — GC stack scanning, calls `scanstack`.
- `runtime/cgocall.go` — cgo stack switching.
- `runtime/signal_unix.go` — signal stacks (`gsignal`).

### Reading strategy

Pick a question (e.g., "what happens when I `defer f()` and the stack grows?") and trace it:

1. Find `runtime.deferproc` in `runtime/panic.go`. Note how the defer record is added to `g._defer`.
2. Find `adjustdefers` in `runtime/stack.go`. See how each defer's pointers are adjusted on stack copy.
3. Confirm via test: write a function with several defers and trigger growth in the middle; check that each defer runs correctly.

The same approach works for panics, closures, channels (`sudog`), and any feature that intersects with stacks.

---

## Summary

At professional level, "stack growth" decomposes into:

- A 2-3 instruction compiler-inserted prologue check.
- `morestack[_noctxt]` assembly that saves state and switches to `g0`.
- `newstack` (Go) that decides on growth, calls `copystack`.
- `stackalloc` (Go) that allocates from per-P pool or global pool or heap.
- `copystack` (Go) that allocates new, memmoves frames, runs `adjust*` for each pointer-holding region, walks the frame chain via `unwinder` and `adjustframe`.
- `stackfree` (Go) that returns the old stack to the pool.
- Pointer fix-up using compiler-emitted stack maps (`pcdata`, `funcdata`).
- `shrinkstack` (Go) called during GC's `scanstack`, with a 1/4-utilisation threshold.

You can answer:

- **What does the prologue check actually do?** Compare SP to `g.stackguard0`; jump if too low.
- **Why is it safe to move a stack?** Stack maps tell the runtime every pointer's location; pointers in the old stack are rewritten to point into the new stack.
- **What happens when a goroutine's stack is being grown and GC starts?** Status `_Gcopystack` prevents GC from scanning concurrently; GC waits.
- **Why can't a `//go:nosplit` chain be arbitrarily deep?** Because the runtime guarantees only `_StackGuard` bytes of nosplit headroom; deeper chains overflow that headroom and crash.
- **Why is cgo's stack model different?** Because cgo runs on `g0`, a fixed-size kernel-owned stack, not on the goroutine's growable stack.

The specification level catalogues the formal documentation, GODEBUG knobs, and runtime/debug APIs related to stacks.
