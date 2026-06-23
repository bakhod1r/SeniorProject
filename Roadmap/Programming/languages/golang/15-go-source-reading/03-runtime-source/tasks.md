# Runtime Source Reading — Practice Tasks

Twenty exercises that turn `$GOROOT/src/runtime` from a black box into a library you can read. The goal is not to *modify* the runtime — it is to *navigate* it: find the file, locate the symbol, follow the call chain from user code into assembly, and verify what you read against a running binary. Difficulty tiers: **J**unior, **M**iddle, **S**enior, **Staff**.

Each task gives a Goal, a Starter (commands or Go scaffolding), step-by-step Instructions, Acceptance Criteria, and a folded Reference walkthrough. The runnable code is small — most tasks are 5–30 lines of Go plus a sequence of grep/objdump/dlv invocations. The hard part is the *reading*, not the writing.

A note on Go versions. The runtime moves; line numbers and exact symbol names drift between releases. Where a task says "Go 1.22", that's the calibration version. Run with `go version`; if you're on 1.21 or 1.23 the structure will be recognisable but offsets will shift. Treat any number in a path like `proc.go:1234` as a hint, not a contract.

A note on tools. You need `go`, `go tool objdump`, `go tool trace`, and `dlv` (Delve) for full coverage. `grep -nR` is enough for the first five tasks. Tasks 11 and 17 are the ones that fail noisily without their tool installed.

---

## Task 1 — Inventory `$GOROOT/src/runtime/` (J)

**Goal.** Locate the runtime source tree on your machine, count the `.go` files, count the `.s` files, and identify which assembly files are amd64-specific.

**Starter.**

```bash
go env GOROOT
RT="$(go env GOROOT)/src/runtime"
ls "$RT" | head
```

**Instructions.**

1. Print `GOROOT` with `go env GOROOT`. Store the runtime path as `RT=$(go env GOROOT)/src/runtime`.
2. Count Go source files at the top level only: `ls "$RT"/*.go | wc -l`. Then recursively: `find "$RT" -name '*.go' | wc -l`. Note the difference.
3. Count assembly files top-level: `ls "$RT"/*.s | wc -l`. Then recursive: `find "$RT" -name '*.s' | wc -l`.
4. List which `.s` files are amd64-specific. The convention is `*_amd64.s`: `ls "$RT"/*_amd64.s`. Read the first ten lines of `asm_amd64.s`.
5. Note which `.s` files have *no* architecture suffix (e.g. `asm.s`, `duff_amd64.s` vs. `duff_arm64.s`). The unsuffixed ones are usually included via build tags inside the file itself — check with `head -5 "$RT"/asm.s`.
6. Write a one-line summary: "Go 1.22 ships N .go files (top-level: M) and K .s files total, of which J are amd64-specific."

**Acceptance criteria.**

- You can produce the four counts (top-level .go, recursive .go, top-level .s, amd64 .s) without re-running `find` each time.
- You can name three amd64-specific `.s` files from memory: `asm_amd64.s`, `memmove_amd64.s`, `duff_amd64.s` are good candidates.
- You can explain *why* `runtime` has both Go and assembly: the assembly files contain code that cannot be written in Go (raw stack manipulation, syscalls, atomic primitives the compiler can't emit).

<details><summary>Reference walkthrough</summary>

```bash
$ RT="$(go env GOROOT)/src/runtime"
$ ls "$RT"/*.go | wc -l
       274
$ find "$RT" -name '*.go' | wc -l
     487
$ ls "$RT"/*.s | wc -l
      77
$ ls "$RT"/*_amd64.s
/usr/local/go/src/runtime/asm_amd64.s
/usr/local/go/src/runtime/duff_amd64.s
/usr/local/go/src/runtime/memclr_amd64.s
/usr/local/go/src/runtime/memmove_amd64.s
/usr/local/go/src/runtime/preempt_amd64.s
/usr/local/go/src/runtime/rt0_darwin_amd64.s
/usr/local/go/src/runtime/rt0_linux_amd64.s
/usr/local/go/src/runtime/rt0_windows_amd64.s
/usr/local/go/src/runtime/sys_darwin_amd64.s
/usr/local/go/src/runtime/sys_linux_amd64.s
$ ls "$RT"/*_amd64.s | wc -l
      10
```

The counts above are from Go 1.22 on darwin/amd64; your numbers will drift by a few in either direction. The shape that doesn't change: roughly 250–300 top-level `.go` files, around 400–500 total `.go` files when you include subpackages like `runtime/internal/atomic`, `runtime/internal/sys`, `runtime/cgo`, `runtime/pprof`, `runtime/race`, `runtime/trace`. Assembly counts are dominated by `asm_<arch>.s`, `memmove_<arch>.s`, `memclr_<arch>.s`, `sys_<os>_<arch>.s`, `rt0_<os>_<arch>.s`, and `duff_<arch>.s`.

Why the amd64/arm64 split matters: every CPU architecture needs its own implementation of (a) the goroutine context switch (`mcall`, `gogo`), (b) syscall entry (`sys_<os>_<arch>.s`), and (c) the program entry point (`rt0_<os>_<arch>.s`). The Go portion of the runtime is mostly architecture-independent; the assembly is necessarily per-arch. That is why a port to a new architecture is mostly "write the assembly half" plus a handful of `_<arch>.go` files for arch-specific constants.

Senior decision: do not memorise file counts; they change every release. Memorise the *taxonomy* — for any feature you investigate, you'll know within a few seconds whether to look at `proc.go` (scheduler), `mgc*.go` (GC), `chan.go` (channels), `sema.go` (semaphores), `mfinal.go` (finalisers), `time.go` (timers), `panic.go` (panic/recover), or `asm_<arch>.s` (low-level transitions). The file count is trivia; the taxonomy is what you read with.

</details>

---

## Task 2 — Read `hchan` struct (J)

**Goal.** Open `runtime/chan.go`, locate the `hchan` struct definition, and explain each field in your own words. This is the central data structure behind every Go channel.

**Starter.**

```bash
RT="$(go env GOROOT)/src/runtime"
grep -n "^type hchan struct" "$RT/chan.go"
```

**Instructions.**

1. `grep -n "^type hchan struct" "$RT/chan.go"` — note the line number; you'll come back to it.
2. Open `chan.go` at that line. The struct is roughly 12 fields and fits on one screen.
3. For each field, write a one-sentence explanation. Aim for *what it represents at runtime*, not *what its type is*. "`qcount uint` — number of values currently in the buffer" is good. "`qcount uint` — an unsigned integer" is useless.
4. Pay particular attention to: `buf unsafe.Pointer` (where does it point? what is its size?), `sendx`/`recvx` (why two indices? what invariant connects them to `qcount`?), `recvq`/`sendq` (what kind of queue? what goes into them?), `lock mutex` (why a `runtime.mutex` and not `sync.Mutex`?).
5. Read the comment block immediately above the struct definition — it explains the memory layout in two paragraphs. Note what is *not* in the struct: there is no separate buffer header; the buffer is allocated contiguously with the struct itself for unbuffered+small channels.
6. Cross-reference with the `makechan` function (also in `chan.go`) to confirm your layout intuition — `makechan` is the only place fields are first written.

**Acceptance criteria.**

- You can list every field name from memory: `qcount`, `dataqsiz`, `buf`, `elemsize`, `closed`, `timer`, `elemtype`, `sendx`, `recvx`, `recvq`, `sendq`, `lock`. (Order may differ; field set should not.)
- You can answer: "Why is `lock` a `mutex` and not `sync.Mutex`?" — because `sync.Mutex` lives in `sync` which imports `runtime`; an import cycle would result. Plus `runtime.mutex` has no allocation and integrates with the runtime scheduler for `gopark`.
- You can answer: "What does `dataqsiz == 0` mean?" — unbuffered channel; `buf` is nil; every send/recv goes through `recvq`/`sendq`.

<details><summary>Reference walkthrough</summary>

The Go 1.22 layout (line numbers will shift across releases):

```go
type hchan struct {
    qcount   uint           // total data in the queue
    dataqsiz uint           // size of the circular queue
    buf      unsafe.Pointer // points to an array of dataqsiz elements
    elemsize uint16
    closed   uint32
    timer    *timer         // timer feeding this chan
    elemtype *_type         // element type
    sendx    uint           // send index
    recvx    uint           // receive index
    recvq    waitq          // list of recv waiters
    sendq    waitq          // list of send waiters
    lock     mutex
}
```

Field-by-field, in plain English:

- `qcount`: how many elements are currently sitting in the buffer. Incremented on send, decremented on recv. Bounded above by `dataqsiz`.
- `dataqsiz`: capacity of the circular buffer. Zero for unbuffered channels. Set once at `make(chan T, N)`; never mutated afterward.
- `buf`: pointer to the start of the circular buffer. Memory layout: `dataqsiz * elemsize` contiguous bytes. For unbuffered channels (`dataqsiz == 0`) this is nil.
- `elemsize`: size in bytes of one element. A `uint16` because Go limits channel element sizes to `< 64KB` — sending a 100KB struct is rejected at compile time.
- `closed`: 0 if open, 1 if closed. Reads and writes are protected by `lock`, but a few `closed == 1` checks happen lock-free as fast paths (see `chansend` and `chanrecv`).
- `timer`: used when the channel was created by `time.NewTicker`/`time.After` — links back to the timer that fires sends on this channel. nil for user-created channels.
- `elemtype`: pointer to a `_type` descriptor. Used by the GC to scan elements in the buffer, and by `chansend`/`chanrecv` to know how to memmove/typedmemmove the data.
- `sendx`: next index into `buf` where a sender will write. Wraps modulo `dataqsiz`.
- `recvx`: next index into `buf` where a receiver will read. Wraps modulo `dataqsiz`. Invariant: `(recvx + qcount) % dataqsiz == sendx`.
- `recvq`: queue of goroutines currently parked waiting to receive. Used when buffer is empty (or unbuffered with no sender).
- `sendq`: queue of goroutines currently parked waiting to send. Used when buffer is full (or unbuffered with no receiver).
- `lock`: protects every field above. A `runtime.mutex` (futex-style on Linux, semaphore-based on darwin/windows). Cheap when uncontested, expensive when contested; held for the minimum possible window inside `chansend`/`chanrecv`.

Why no separate buffer struct: `makechan` allocates `sizeof(hchan) + dataqsiz*elemsize` in one shot. The buffer starts immediately after the struct, and `buf` is set to that interior pointer. One allocation, one cache line for the header (if elements aren't tiny), better locality on send/recv.

Why `mutex` not `sync.Mutex`: `sync` depends on `runtime`. The runtime can't import its own consumers. There are also performance constraints — `runtime.mutex` integrates with the scheduler (`semasleep`/`semawakeup`) so a parked sender on a contended channel can release its P; `sync.Mutex` would have to call back into runtime via stubs.

</details>

---

## Task 3 — Find `//go:nosplit` and explain three (J)

**Goal.** Search the runtime for `//go:nosplit` pragma usages, pick three different functions, and explain why each must run without growing its stack.

**Starter.**

```bash
RT="$(go env GOROOT)/src/runtime"
grep -nR "//go:nosplit" "$RT" | head -20
```

**Instructions.**

1. Run the grep above. You'll see ~hundreds of matches across the runtime.
2. Skim the list. Look for short, low-level functions: `getg`, `gosched_m`, `acquirem`, `releasem`, atomic helpers, write barriers.
3. Pick three from these categories: (a) something that runs *during* stack growth (would deadlock if it grew its own stack), (b) something that runs without a valid `g`/`m` (cannot call into the scheduler safely), (c) something on the hot path where the prologue cost matters (loop bodies, atomic ops).
4. For each pick, open the file at the grep line, read the function body, and write a 2–3 sentence explanation of "why nosplit". The answer is *always* one of: "called during stack growth", "called without a valid g", "called on the user's signal stack", "called from assembly with non-standard frame layout", "the prologue branch is itself the perf bottleneck".
5. Use `grep -A 1 "//go:nosplit" "$RT/proc.go" | head -40` to see the next-line function names quickly.

**Acceptance criteria.**

- You can name at least three runtime functions marked `//go:nosplit` and produce the correct reason for each.
- You can explain the danger: a `nosplit` function calling a non-`nosplit` function can blow past the small "nosplit budget" the linker enforces (currently 800 bytes), producing a link-time error.
- You can answer: "What is the nosplit stack budget?" — roughly 800 bytes, enforced by the linker (`cmd/link/internal/ld/stackcheck.go`). Functions whose worst-case call tree exceeds it fail to link.

<details><summary>Reference walkthrough</summary>

Three canonical picks:

**(a) `getg`** in `runtime/stubs.go`:

```go
// getg returns the pointer to the current g.
// The compiler rewrites calls to this function into instructions
// that fetch the g directly (from TLS or from the dedicated register).
//
//go:nosplit
func getg() *g
```

Why nosplit: stack growth needs to know the current `g` to allocate a new stack and copy. If `getg` itself could grow the stack, you'd recurse infinitely — stack growth calls `getg`, which calls the stack-growth prologue, which calls `getg`, etc. `getg` must be the bedrock. In practice it's an intrinsic emitted by the compiler as a single load from a fixed offset of `g_register` (amd64 uses `R14` since Go 1.17), so the body in `stubs.go` is just a declaration.

**(b) `acquirem`** in `runtime/runtime1.go`:

```go
//go:nosplit
func acquirem() *m {
    gp := getg()
    gp.m.locks++
    return gp.m
}
```

Why nosplit: this function is the standard "pin the goroutine to its OS thread for a moment" primitive. The pin is implemented as `m.locks++`, which suppresses preemption. If `acquirem` could grow its stack, it would call `morestack` -> scheduler -> possibly preempt — but the whole point of `acquirem` is to suppress preemption! It must be atomic with respect to scheduler-induced motion. Plus this is called in hundreds of hot paths (write barriers, channel ops, defer setup); the prologue branch is itself a measurable cost.

**(c) `gogo`** in `runtime/asm_amd64.s` (declared in Go in `stubs.go`):

```go
// gogo continues the execution of gobuf.
//
//go:nosplit
func gogo(buf *gobuf)
```

Why nosplit: this function performs the actual register-and-stack-pointer swap that transfers control to a different goroutine. There is *no* sensible meaning of "grow the stack" here — the function's job is to *replace* the current stack. The Go-level declaration is `nosplit` so the linker doesn't insert a stack-check prologue (which would clobber registers `gogo` needs to load). The implementation is hand-written amd64 assembly that does `MOVQ buf+gobuf_sp(BX), SP; JMP gobuf_pc`.

The nosplit-budget gotcha: if `acquirem` (above) called a non-nosplit function — say `fmt.Sprintf` — the linker would check the worst-case call tree starting from `acquirem` while running on a near-full nosplit stack. If that tree's stack usage exceeds 800 bytes, link fails with `runtime stack overflow`. This is why nosplit functions are tiny and call only other nosplit functions or compiler intrinsics. You'll see the error in practice if you add a `println` to one — `println` calls `printlock` which is not nosplit at the right places, and the link breaks.

</details>

---

## Task 4 — Trace `runtime.GOMAXPROCS` (J)

**Goal.** Find the source of `runtime.GOMAXPROCS`, follow where the value is stored, and identify which other functions read it.

**Starter.**

```bash
RT="$(go env GOROOT)/src/runtime"
grep -nR "^func GOMAXPROCS" "$RT"
```

**Instructions.**

1. Locate the public `GOMAXPROCS` function. It lives in `runtime/debug.go`.
2. Read its body. Note that it both *reads* the current value and, if the argument is positive, *sets* a new one.
3. The setter path calls `startTheWorldGC`, `stopTheWorldGC`, and `procresize`. Open `proc.go` and find `procresize`.
4. `procresize(nprocs int32)` is where the actual P count is changed. Identify the global variable it writes to. The answer is `gomaxprocs`, a package-level `int32`.
5. Now search where `gomaxprocs` is read: `grep -nR "\bgomaxprocs\b" "$RT" | head`. Note hits in `proc.go` (scheduler decisions), `mgcpacer.go` (GC pacing), `lock_*.go` (spin-loop tuning).
6. Read the documentation comment above `GOMAXPROCS`. Note the constraint: "since Go 1.5, the default is the number of CPUs", and the historical "limited to 256 before 1.10".
7. Write a one-paragraph trace: "User calls `runtime.GOMAXPROCS(N)` in `debug.go`, which calls `stopTheWorldGC`, then `procresize(N)` in `proc.go`, which writes `gomaxprocs` and rebalances Ps and Ms, then `startTheWorldGC` resumes. Readers include the scheduler, GC pacer, and several low-level spin loops."

**Acceptance criteria.**

- You can name the function in `runtime/debug.go` that exposes `GOMAXPROCS`.
- You can name `procresize` as the function that actually changes the count.
- You can name `gomaxprocs` (lowercase) as the global storing the value.
- You can list at least three callers of `gomaxprocs` other than `procresize` itself.

<details><summary>Reference walkthrough</summary>

```go
// runtime/debug.go (Go 1.22, abridged):
func GOMAXPROCS(n int) int {
    if GOARCH == "wasm" && n > 1 {
        n = 1 // wasm has no threads
    }
    lock(&sched.lock)
    ret := int(gomaxprocs)
    unlock(&sched.lock)
    if n <= 0 || n == ret {
        return ret
    }
    stopTheWorldGC(stwGOMAXPROCS)
    // newprocs will be processed by startTheWorld
    newprocs = int32(n)
    startTheWorldGC(stwGOMAXPROCS)
    return ret
}
```

Note the deferred write. `procresize` is invoked indirectly through `startTheWorldGC` reading `newprocs`. This is so the actual rebalance happens under STW, not from the caller's goroutine.

```go
// runtime/proc.go (Go 1.22, abridged):
func procresize(nprocs int32) *p {
    old := gomaxprocs
    // ... handle allp slice resize ...
    // ... initialise new Ps ...
    // ... migrate runnable Gs from idle Ps to allp[0] ...
    // ... idle excess Ps ...
    gomaxprocs = nprocs
    // ... return a P for the caller to bind ...
}
```

Read sites of `gomaxprocs`:

- `runtime/proc.go::sysmon` — uses it as the upper bound when deciding whether to wake an idle P.
- `runtime/proc.go::findRunnable` — sets the work-stealing victim count to `gomaxprocs-1`.
- `runtime/mgcpacer.go` — divides GC assist credit across `gomaxprocs` workers.
- `runtime/lock_futex.go` / `lock_sema.go` — the spin loop in `lock` does `procyield` only if `ncpu > 1 && active_spin < ACTIVE_SPIN`. (Technically reads `ncpu`, not `gomaxprocs`, but the runtime treats them similarly for spin decisions.)

The historical detail: pre-1.5, `GOMAXPROCS` defaulted to 1 — Go programs were single-threaded by default. The switch to `runtime.NumCPU()` as the default in 1.5 is why parallel programs work "for free" today. The 256 cap was removed in 1.10 to support large many-core machines (64-core arm64, 128-core EPYC). Today the only cap is `_MaxGomaxprocs = 1024`.

Senior gut-check: should you ever call `GOMAXPROCS` at runtime? Rarely. The default (number of OS-visible CPUs) is correct for almost every workload. The exceptions are (a) containers where the visible CPU count is wrong because cgroup limits hide it — fixed in Go 1.5+ by `runtime.NumCPU`, but still occasionally needed; (b) latency-sensitive servers that pin to fewer cores than the host to reduce context-switch noise; (c) tests that need deterministic scheduling (`GOMAXPROCS=1`). Outside those, leave it alone.

</details>

---

## Task 5 — Trace `ch <- v` to assembly (M)

**Goal.** Write a tiny program that sends on a channel, compile with assembly listing enabled, and identify the assembly call site that bridges into `runtime.chansend1`.

**Starter.**

```go
// main.go
package main

func main() {
    ch := make(chan int, 1)
    ch <- 42
    <-ch
}
```

**Instructions.**

1. Save the program above as `main.go`.
2. Build with assembly output: `go build -gcflags=-S main.go 2>asm.txt`. The `-S` flag dumps the generated assembly to stderr; we redirect to a file.
3. Open `asm.txt`. It contains assembly for every function in the package — `main.main`, all referenced runtime functions, and stdlib helpers.
4. Find the section for `main.main`. Look for a `CALL` instruction whose target is `runtime.chansend1`. Note its exact form (PCREL offset, surrounding instructions).
5. Note that the *Go statement* `ch <- 42` compiles to: load `ch` and `&42` into argument registers (or onto stack on older ABIs), then `CALL runtime.chansend1(SB)`. The compiler does *not* inline channel sends.
6. Also identify `runtime.makechan` and `runtime.chanrecv1` calls in the same listing — `make(chan int, 1)` becomes `runtime.makechan`, `<-ch` becomes `runtime.chanrecv1`.
7. Use `go tool objdump -s "main.main" main` for an alternative view that operates on the compiled binary (post-link), showing real addresses.

**Acceptance criteria.**

- You can point at the line in `asm.txt` containing `CALL runtime.chansend1(SB)`.
- You can name the three runtime helpers a `make(chan int, 1); ch <- 42; <-ch` program calls: `makechan`, `chansend1`, `chanrecv1`.
- You can answer: "Why `chansend1` and not `chansend`?" — `chansend1` is the *call shim* for the operator form; it's a tiny wrapper that calls `chansend(c, elem, true, getcallerpc())` with the `block=true` argument set. The unblocked variant used by `select` is `selectnbsend`.

<details><summary>Reference walkthrough</summary>

A representative excerpt from `asm.txt` on Go 1.22 / amd64:

```
"".main STEXT size=152 args=0x0 locals=0x40 funcid=0x0 align=0x0
    0x0000  TEXT    "".main(SB), ABIInternal, $64-0
    0x0000  CMPQ    SP, 16(R14)
    0x0004  PCDATA  $0, $-2
    0x0004  JLS     0x8e
    0x0006  PCDATA  $0, $-1
    0x0006  SUBQ    $64, SP
    0x000a  MOVQ    BP, 56(SP)
    0x000f  LEAQ    56(SP), BP
    ; ch := make(chan int, 1)
    0x0014  LEAQ    type:chan int(SB), AX
    0x001b  MOVL    $1, BX
    0x0020  PCDATA  $1, $0
    0x0020  CALL    runtime.makechan(SB)
    0x0025  MOVQ    AX, "".ch+24(SP)   ; spill ch pointer
    ; ch <- 42
    0x002a  MOVQ    AX, AX             ; ch in AX
    0x002d  LEAQ    "".statictmp+0(SB), BX  ; addr of literal 42
    0x0034  PCDATA  $1, $1
    0x0034  CALL    runtime.chansend1(SB)
    ; <-ch
    0x0039  MOVQ    "".ch+24(SP), AX
    0x003e  LEAQ    "".tmp+16(SP), BX
    0x0043  PCDATA  $1, $2
    0x0043  CALL    runtime.chanrecv1(SB)
    0x0048  MOVQ    56(SP), BP
    0x004d  ADDQ    $64, SP
    0x0051  RET
```

The exact line you want is `CALL runtime.chansend1(SB)`. The `(SB)` is the "static base" pseudo-register — Go assembly's way of saying "this is a symbol resolved by the linker, relative to the program's static base". `chansend1` is two arguments: the channel pointer (AX) and the element pointer (BX), under the register-based ABI (since Go 1.17). Pre-1.17 they were passed on the stack.

Now open `runtime/chan.go` and read `chansend1`:

```go
//go:nosplit
func chansend1(c *hchan, elem unsafe.Pointer) {
    chansend(c, elem, true, getcallerpc())
}
```

Two lines. The work happens in `chansend(c, elem, block, callerpc)`. The shim exists so the call from generated code is a *single* instruction with two arguments — the `block=true` and `callerpc` are added by the shim, sparing every send site three extra instructions. `selectnbsend` is the analogous shim for the `select { case ch <- v: ... default: }` case, calling `chansend(c, elem, false, ...)`.

`chansend` itself is the meaty function: ~150 lines, handling four cases (channel nil, channel closed, receiver waiting, buffer has space) and falling through to "park the sender" if none match. That is the function you read next time you debug a deadlock involving send.

Senior decision when reading generated assembly: the `CALL` you're looking for is almost always to a `runtime.<op>1` shim. The "1" suffix is the Go convention for "called from a single Go statement", as opposed to multi-result returns or select arms. Knowing this saves you from chasing the wrong symbol when you see `chansend2` (which doesn't exist) and conclude "this isn't a send" — there *is* no `chansend2`.

</details>

---

## Task 6 — Read `runtime.gopark` (M)

**Goal.** Open `runtime.gopark` in `runtime/proc.go`, identify its five arguments, and explain what each controls.

**Starter.**

```bash
grep -n "^func gopark" "$(go env GOROOT)/src/runtime/proc.go"
```

**Instructions.**

1. Locate `gopark`. It's defined in `proc.go`.
2. Read the signature: `func gopark(unlockf func(*g, unsafe.Pointer) bool, lock unsafe.Pointer, reason waitReason, traceReason traceBlockReason, traceskip int)`.
3. For each parameter, write a sentence:
   - `unlockf`: callback invoked *after* the goroutine is marked `_Gwaiting` but *before* control transfers away. Returning false aborts the park (rare — used in racy double-check patterns).
   - `lock`: opaque pointer passed to `unlockf`. Typically the lock that protected the wait queue this goroutine just enqueued itself onto.
   - `reason`: a `waitReason` enum value. Visible in `goroutine` stack dumps as `[chan send]`, `[chan receive]`, `[select]`, `[sleep]`, etc.
   - `traceReason`: similar but for the runtime tracer (the `runtime/trace` machinery). Different enum because trace categories are coarser than diagnostic reasons.
   - `traceskip`: number of stack frames to skip when recording the park event in the trace, so the trace shows the *user's* frame, not `gopark`'s.
4. Search where `gopark` is called from: `grep -nR "gopark(" "$(go env GOROOT)/src/runtime" | head`. Note hits in `chan.go` (channel send/recv block), `sema.go` (semaphore wait), `time.go` (sleep), `select.go` (select block), `netpoll.go` (network wait).
5. For two of those call sites, read the surrounding 10 lines and identify which `waitReason` is passed. Examples: `chan.go::chansend` passes `waitReasonChanSend`, `time.go::timeSleep` passes `waitReasonSleep`.
6. Look at the body of `gopark`: it gets the current `g`, calls `mcall(park_m)`. The actual park-and-switch happens in `park_m`, which runs on the `g0` stack.

**Acceptance criteria.**

- You can recite the five arguments by name and purpose without looking.
- You can name three `gopark` call sites and the `waitReason` each uses.
- You can answer: "Why does `gopark` use `mcall`?" — because the actual context switch needs to run on `g0` (the system stack), not on the user goroutine's stack. `mcall` is the runtime primitive that switches to `g0` and invokes the callback there.

<details><summary>Reference walkthrough</summary>

Go 1.22 signature (in `runtime/proc.go`):

```go
// Puts the current goroutine into a waiting state and calls unlockf on the
// system stack. unlockf is called with the g's status set to _Gwaiting. If
// unlockf returns false, the goroutine is put back on the run queue.
//
// reason explains why the goroutine has been parked. It is displayed in
// stack traces and heap dumps. Reasons should be unique and descriptive.
// Do not re-use reasons, add new ones.
//
//go:nosplit
func gopark(unlockf func(*g, unsafe.Pointer) bool, lock unsafe.Pointer,
            reason waitReason, traceReason traceBlockReason, traceskip int) {
    if reason != waitReasonSleep {
        checkTimeouts() // timeouts may expire while two goroutines keep the scheduler busy
    }
    mp := acquirem()
    gp := mp.curg
    status := readgstatus(gp)
    if status != _Grunning && status != _Gscanrunning {
        throw("gopark: bad g status")
    }
    mp.waitlock = lock
    mp.waitunlockf = unlockf
    gp.waitreason = reason
    mp.waitTraceBlockReason = traceReason
    mp.waitTraceSkip = traceskip
    releasem(mp)
    mcall(park_m) // park the goroutine; runs on g0
}
```

The five arguments mapped to use cases:

| Arg | Type | Use case |
|-----|------|----------|
| `unlockf` | `func(*g, unsafe.Pointer) bool` | After the runtime marks the goroutine `_Gwaiting` *and* drops it from the running set, it calls this. Return false means "race: the wait condition cleared between when we entered gopark and now, put me back on the run queue". Always returns true in `chan.go`/`sema.go`. |
| `lock` | `unsafe.Pointer` | Opaque pointer that `unlockf` interprets. For channel ops it's `&c.lock`; the `unlockf` for `chansend` calls `unlock` on it. The runtime can't know the lock type, so it's `unsafe.Pointer`. |
| `reason` | `waitReason` | Enum from `runtime2.go::waitReason`. Values like `waitReasonChanSend`, `waitReasonSelect`, `waitReasonSyncCondWait`. Surfaces in `runtime.Stack` and pprof. |
| `traceReason` | `traceBlockReason` | Coarser enum from `runtime/trace2.go`. The tracer doesn't care whether you blocked on chan send vs chan recv; both are `traceBlockChan`. |
| `traceskip` | `int` | Frames to skip in the recorded stack. Callers from inside the runtime pass 1 or 2; callers from `time.Sleep` pass 2 so the trace shows the user's frame. |

Why `mcall(park_m)`: `mcall` is "make-call on g0". The execution model is: user goroutine calls gopark on its own stack; gopark sets up state on `m`; mcall switches to g0 and calls `park_m(gp)`; `park_m` actually clears `m.curg`, takes the lock if needed, calls `unlockf`, and then calls `schedule()` which picks the next goroutine. The context switch is from a *user* stack to a *system* stack, which is a privilege the user goroutine doesn't have on its own.

Senior gut-check: when reading any blocking primitive in the runtime (chan, sema, select, sleep, netpoll, sync.Mutex via runtime/lockrank), look for the `gopark` call to confirm "yes, this blocks via the standard runtime park path". If the code blocks via a syscall instead (file IO before netpoll, cgo calls), you'll see no `gopark` and the goroutine will be in `_Gsyscall` rather than `_Gwaiting` — different stack-dump label, different scheduler behaviour.

</details>

---

## Task 7 — `//go:linkname` to call `runtime.fastrand` (M)

**Goal.** Use `//go:linkname` from a non-runtime package to call the unexported `runtime.fastrand`. Print 10 values to confirm.

**Starter.**

```go
// main.go
package main

import (
    "fmt"
    _ "unsafe" // required for go:linkname
)

//go:linkname runtimeFastrand runtime.fastrand
func runtimeFastrand() uint32

func main() {
    for i := 0; i < 10; i++ {
        fmt.Println(runtimeFastrand())
    }
}
```

**Instructions.**

1. Save the program above.
2. Note the import of `_ "unsafe"` — required by the toolchain because `//go:linkname` is considered an unsafe feature; without the blank import, the compiler rejects the pragma.
3. Build: `go build main.go`. Run: `./main`.
4. Note the output: 10 32-bit unsigned integers. They're pseudo-random; running the program multiple times produces different sequences because the runtime seeds `fastrand` per-`m` at thread start.
5. Inspect `fastrand` in the runtime: `grep -n "func fastrand" "$(go env GOROOT)/src/runtime/stubs.go"`. Read the body. As of Go 1.22 it's a small wyrand-style mixer using `m.fastrand` (per-thread state).
6. Note the trade-off: `fastrand` is fast (no lock, no syscall) but not cryptographically secure. The runtime uses it for things like hashmap iteration order randomisation, scheduler-victim selection, GC trigger jitter — places where speed matters and adversarial input is not a concern.
7. Be aware of breakage risk: `fastrand` was renamed to `runtime.cheaprand` in Go 1.22 in some snapshots. If the build fails with `relocation target runtime.fastrand not found`, switch the linkname to `runtime.cheaprand` (or check `runtime/stubs.go` for the current name on your version).

**Acceptance criteria.**

- Your program builds and prints 10 uint32 values.
- You can explain the role of `_ "unsafe"`: it's a compiler gate that says "yes, I'm using unsafe pragmas".
- You can articulate the rule of thumb: `//go:linkname` to *runtime* symbols is a hack used by stdlib (`os`, `time`, `net`) and major libraries (`runtime/pprof`, `cgo`). Application code should avoid it — the symbols can be renamed or deleted between Go releases without warning. Go 1.22's `cheaprand` rename is a recent example.

<details><summary>Reference walkthrough</summary>

Expected output (yours will differ — `fastrand` state is seeded per-thread at boot from system entropy):

```
$ go build main.go && ./main
3215488821
1738596234
4081722904
...
```

The runtime side of `fastrand` (Go 1.21 and earlier) lived in `runtime/stubs.go`:

```go
//go:nosplit
func fastrand() uint32 {
    mp := getg().m
    // ... wyrand mixer using mp.fastrand[0], mp.fastrand[1] ...
    return uint32(...)
}
```

The `m.fastrand` array is two `uint64` words of per-thread state. No lock: each OS thread maintains its own; collisions are impossible because each `m` runs one user `g` at a time and `fastrand` is called from goroutine context.

How `//go:linkname` works mechanically:

- The compiler emits a relocation pointing the *local* symbol (`main.runtimeFastrand`) at the *external* symbol (`runtime.fastrand`).
- At link time the linker resolves both to the same address. Your call instruction in `main` ends up jumping directly into `runtime.fastrand`.
- No header file, no FFI, no glue. The cost is that the function signature has to match the runtime's signature exactly — wrong return type or argument list produces undefined behaviour at runtime (often a crash).

Why this exists: the stdlib needs to call into the runtime in places that aren't part of the public `runtime` API. Examples in stdlib:

- `time.runtimeNano` linknames `runtime.nanotime` to get the monotonic clock without a syscall.
- `sync/atomic` in some configurations linknames `runtime` helpers for atomic ops on platforms without native CAS.
- `net` linknames `runtime.netpollGenericInit` to wire poller state.

If `//go:linkname` didn't exist, every stdlib package that touches runtime internals would need a corresponding *public* runtime function — bloating the API surface, locking implementation details, hurting maintenance. The linkname mechanism is the escape hatch.

Senior decision: when you reach for `//go:linkname` in your own code, you are accepting that your code may break in any future Go release without deprecation. The 1.22 `fastrand`→`cheaprand` rename broke dozens of libraries that depended on it; the maintainers' response was "we told you not to do that". If you genuinely need fast PRNG, `math/rand/v2` exists since Go 1.22 and is nearly as fast. The legitimate uses of linkname today are: (a) reverse-engineering a runtime issue for a bug report, (b) implementing a stdlib-equivalent library that the standard library happens not to expose. Application code: never.

</details>

---

## Task 8 — Read `gopanic` and the defer chain (M)

**Goal.** Open `runtime/panic.go::gopanic`, read it end to end, and write a 5-step summary of the defer-chain unwind algorithm.

**Starter.**

```bash
grep -n "^func gopanic" "$(go env GOROOT)/src/runtime/panic.go"
```

**Instructions.**

1. Locate `gopanic` in `panic.go`. Note the size — it's one of the longer runtime functions, ~200 lines.
2. Read top-to-bottom once without taking notes. Get the shape: it's a loop over the current goroutine's `_defer` linked list (`gp._defer`), invoking each deferred function and either continuing or returning.
3. Identify the key fields touched: `gp._panic`, `gp._defer`, `_defer.started`, `_defer.fn`, `_defer.sp`, `_defer.pc`. Look at `runtime2.go` for the `_defer` struct definition if you haven't seen it.
4. Identify the four termination cases:
   - Defer calls `recover()`: panic is "consumed"; `gopanic` returns via `mcall(recovery)` which jumps back to the deferred function's caller's frame.
   - Defer panics again (nested panic): a new `_panic` is pushed; the old one is marked `aborted`. The loop continues unwinding under the new panic.
   - Defer returns normally: just pop and continue with the next defer.
   - No more defers: call `fatalpanic` which prints the panic, runs all goroutine stacks (if `GOTRACEBACK=all`), and exits.
5. Write a 5-step summary:
   1. Push a new `_panic` record onto `gp._panic`, linking to the previous panic if any.
   2. Walk `gp._defer` from newest to oldest. Mark each as `started` to detect nested panics in the same defer.
   3. Invoke the deferred function. If it calls `recover()`, that sets `_panic.recovered = true`.
   4. After the call, check `_panic.recovered`: if true, jump back via `mcall(recovery)` to the deferred function's caller's resumption PC.
   5. If never recovered, after the last defer call `fatalpanic` to terminate the program.
6. Cross-check with the open-coded defer optimisation: since Go 1.14, defers in functions with simple control flow are *open-coded* (inlined into the function, with bitmap-tracked execution). For those, `gopanic` walks them by examining the stack frame's defer bitmap, not the `_defer` linked list. See `runtime/panic.go::runOpenDeferFrame`.

**Acceptance criteria.**

- You can sketch the 5-step algorithm from memory.
- You can name the function `runtime.recovery` and explain its role: it's the assembly stub that resumes execution at the deferred function's caller, restoring SP/PC from `_defer.sp`/`_defer.pc`.
- You can answer: "How does nested panic (panicking in a deferred function during another panic) work?" — the new panic pushes a fresh `_panic` record; the old one is marked aborted (`p.aborted = true`); the loop continues unwinding under the new panic; the original is never recovered.

<details><summary>Reference walkthrough</summary>

Pseudocode skeleton (the real `gopanic` is denser; treat this as a reading aid):

```
func gopanic(e interface{}) {
    gp := getg()
    // 1. Push new _panic
    var p _panic
    p.arg = e
    p.link = gp._panic
    gp._panic = &p

    // 2. Walk defers
    for {
        d := gp._defer
        if d == nil {
            break // fall through to fatalpanic
        }

        // Bookkeeping
        if d.started {
            if d._panic != nil {
                d._panic.aborted = true
            }
            d._panic = nil
            d.fn = nil
            gp._defer = d.link
            freedefer(d)
            continue
        }
        d.started = true
        d._panic = &p

        p.argp = unsafe.Pointer(getargp())

        // 3. Call deferred function
        reflectcall(nil, unsafe.Pointer(d.fn), deferArgs(d), uint32(d.siz), uint32(d.siz), &regs)

        // ... bookkeeping ...

        // 4. Did the defer recover us?
        if p.recovered {
            atomic.Xadd(&runningPanicDefers, -1)
            gp._panic = p.link
            // Find recovery target — sp/pc to resume at
            gp.sigcode0 = uintptr(sp)
            gp.sigcode1 = pc
            mcall(recovery) // does not return
            throw("recovery failed")
        }
    }

    // 5. No defer recovered — terminal
    fatalpanic(gp._panic)
    *(*int)(nil) = 0 // not reached
}
```

The `_defer` struct (in `runtime2.go`, abridged):

```go
type _defer struct {
    started bool
    heap    bool
    openDefer bool
    sp        uintptr  // sp at time of defer
    pc        uintptr  // pc at time of defer
    fn        *funcval // can be nil for open-coded defers
    _panic    *_panic  // panic that is running defer
    link      *_defer
    // ... fields for open-coded defers ...
}
```

Step-by-step walkthrough of a recovered panic:

```go
func A() { defer B(); panic("boom") }
func B() { if r := recover(); r != nil { fmt.Println("got", r) } }
```

- `A` is called. Its defer of `B` allocates a `_defer{sp: A's SP, pc: PC after defer stmt, fn: B}` and prepends to `gp._defer`.
- `panic("boom")` calls `gopanic("boom")`.
- `gopanic` pushes a new `_panic{arg: "boom"}`.
- The loop sees `d = gp._defer` (the B defer). Marks `started=true`, links `d._panic = &p`.
- `reflectcall(nil, &B's funcval, ...)` invokes B. B calls `recover()`.
- `recover()` looks at `gp._panic`, sets `gp._panic.recovered = true`, returns the arg ("boom").
- B finishes printing and returns.
- Back in `gopanic`'s loop, `p.recovered == true`. The code prepares to resume execution at `d.sp`/`d.pc` — which is A's frame, just past the panic call.
- `mcall(recovery)` jumps to A's resume point. Control never returns to `gopanic`.

Step-by-step walkthrough of an unrecovered panic:

- Same setup but `B` doesn't call recover.
- After B returns normally, `p.recovered == false`.
- The loop pops the defer (`gp._defer = d.link`) and continues.
- No more defers. Loop exits.
- `fatalpanic(&p)` runs: prints `panic: boom` plus the stack trace, optionally dumps all goroutine stacks (`GOTRACEBACK=all`), calls `exit(2)`.

Nested panic walkthrough:

```go
func C() { defer D(); panic("first") }
func D() { panic("second") }
```

- C's defer of D is registered.
- C panics; `gopanic("first")` pushes `_panic{arg:"first"}` and walks defers.
- D is called. D panics "second"; that calls `gopanic("second")` *recursively*.
- The inner gopanic pushes a new `_panic{arg:"second", link: previous panic}`.
- The inner gopanic walks defers — there are no more under D — so calls `fatalpanic` with `gp._panic` pointing at "second", which has `link: "first"` available for the report.
- `fatalpanic` prints both: `panic: second [recovered]\n\tpanic: first`. The "first" is marked aborted because "second" took over before it could be recovered.

Open-coded defers (Go 1.14+) change the picture for functions where defers are statically analysable: instead of allocating `_defer` records and linking them, the compiler stores defer arguments in stack slots and uses a small bitmap to remember which defers fired. `gopanic`'s loop is augmented with `runOpenDeferFrame` which inspects each frame's bitmap and invokes the open-coded defers using the saved arguments. The user-visible semantics are identical; the allocation overhead is gone for the common case (one defer, no defer-in-loop).

Senior reading tip: when something panics and the program prints a confusing stack, the *defer chain* is the key. Read top of stack to find the panicking site, then look downward for `panic.gopanic` and `runtime.recovery` markers. If you see `recovery`, the program recovered and printed the trace from a logging recover; if you see `fatalpanic`, the program died.

</details>

---

## Task 9 — Read `newproc` (M)

**Goal.** Open `runtime/proc.go::newproc`, identify which P the newly created goroutine is enqueued on, and explain the run queue layout.

**Starter.**

```bash
grep -n "^func newproc" "$(go env GOROOT)/src/runtime/proc.go"
```

**Instructions.**

1. Find `newproc`. Note the signature: `func newproc(fn *funcval)`. It's called by the compiler for every `go f(...)` statement (after the args are packaged).
2. Read top-to-bottom. The function:
   - Acquires `m` via `acquirem` (pinning to the current OS thread for the duration).
   - Calls `newproc1(fn, gp, callerpc)` to allocate or recycle a `g`.
   - Calls `runqput(p, newg, true)` to enqueue.
   - Calls `wakep()` to wake a sleeping P if there is one and the work queue grew.
3. Open `newproc1`. It either pops a free `g` from `p.gFree` (cached free list) or `sched.gFree` (global free list), or allocates a fresh `g` with `malg(stacksize)`. It then sets up the `gobuf` (saved register set) so that when the scheduler runs this `g`, it'll start executing at `fn`.
4. Open `runqput`. The runqueue is per-P. Layout:
   - `p.runqhead`, `p.runqtail`: atomic uint32 indices.
   - `p.runq`: fixed-size array of 256 `*g`.
   - `p.runnext`: a "next g to run" slot. If non-nil, it's the highest-priority work on this P.
5. `runqput(p, newg, true)` writes `newg` to `p.runnext`, displacing whatever was there. The displaced `g` goes to the tail of `p.runq`. If `p.runq` is full (256 entries), it gets bulk-moved to the global queue `sched.runq` along with half the local queue.
6. Conclusion: a new goroutine *always* goes on the current P's `runnext` slot first. This gives "go-then-call-now" patterns excellent locality — the new g and the launching g share whatever cache the current P was hot on.

**Acceptance criteria.**

- You can name `newproc` as the entry point, `newproc1` as the allocator, and `runqput` as the enqueuer.
- You can describe the runqueue: per-P, ring buffer of 256, plus a one-slot `runnext` for the freshly-scheduled g.
- You can answer: "Why `runnext`?" — it's the LIFO optimisation. Programs that do `go f(x); g(x)` get better locality when `f` runs immediately after `g` blocks; LIFO via `runnext` makes that the default behaviour.
- You can answer: "What happens when the local runqueue overflows?" — half of it plus the incoming g is moved to the global `sched.runq` in one batch, amortising the lock cost across 128 goroutines.

<details><summary>Reference walkthrough</summary>

Pseudocode (Go 1.22):

```go
func newproc(fn *funcval) {
    gp := getg()
    pc := getcallerpc()
    systemstack(func() {
        newg := newproc1(fn, gp, pc)

        pp := getg().m.p.ptr()
        runqput(pp, newg, true) // true = put in runnext slot

        if mainStarted {
            wakep()
        }
    })
}
```

`newproc1`:

```go
func newproc1(fn *funcval, callergp *g, callerpc uintptr) *g {
    mp := acquirem()
    pp := mp.p.ptr()
    newg := gfget(pp)             // try local free list
    if newg == nil {
        newg = malg(stackMin)     // allocate new g with stack
        casgstatus(newg, _Gidle, _Gdead)
        allgadd(newg)              // register in global g list for GC
    }

    // Set up gobuf so the scheduler can launch this g.
    sp := newg.stack.hi
    sp -= sys.MinFrameSize
    newg.sched.sp = sp
    newg.stktopsp = sp
    newg.sched.pc = funcPC(goexit) + sys.PCQuantum
    newg.sched.g = guintptr(unsafe.Pointer(newg))
    gostartcallfn(&newg.sched, fn)
    // ... ancestor tracking, race annotations ...
    casgstatus(newg, _Gdead, _Grunnable)

    releasem(mp)
    return newg
}
```

The trick in `gostartcallfn` is the saved PC: it's set to `goexit + PCQuantum`. When the scheduler resumes this `g`, the saved PC is loaded into the program counter and execution begins. But the *next* return — when `fn` finishes — returns to `goexit`, which is the runtime function that handles goroutine termination. So the call stack looks like `fn` called from `goexit`, which means `return` from `fn` lands in goroutine cleanup. Elegant.

`runqput`:

```go
func runqput(pp *p, gp *g, next bool) {
    if next {
    retryNext:
        oldnext := pp.runnext
        if !pp.runnext.cas(oldnext, guintptr(unsafe.Pointer(gp))) {
            goto retryNext
        }
        if oldnext == 0 {
            return
        }
        gp = oldnext.ptr() // displaced g goes to tail
    }

retry:
    h := atomic.LoadAcq(&pp.runqhead)
    t := pp.runqtail
    if t-h < uint32(len(pp.runq)) {
        pp.runq[t%uint32(len(pp.runq))].set(gp)
        atomic.StoreRel(&pp.runqtail, t+1)
        return
    }
    // Local queue full → push half to global
    if runqputslow(pp, gp, h, t) {
        return
    }
    goto retry
}
```

`runqputslow` moves 128 entries plus the new one to `sched.runq` (the global queue), under `sched.lock`. Other Ps can then steal them.

The runqueue structure rationale:

| Layer | Why |
|-------|-----|
| `runnext` (1 slot) | LIFO locality — go-then-block leaves the new g on top so it runs next on this P. |
| `runq` (256 slots) | Per-P FIFO. No lock for the owning P's enqueue/dequeue; CAS-based for steals from other Ps. |
| `sched.runq` (unbounded) | Global FIFO under `sched.lock`. Used for overflow and for `runtime.Gosched`-yielded work that the scheduler wants to spread. |

Why 256: empirically chosen. Big enough to amortise the steal cost (stealing locks the victim's queue head briefly); small enough that overflow to global is rare in typical workloads but always available as a safety valve. Pre-1.13 it was a constant `_RunqSize = 256`; the value hasn't changed.

`wakep()` checks `sched.npidle != 0 && sched.nmspinning == 0` and wakes an idle P (creating a new M or unparking an existing one) if there's spare work. This is the runtime's load-balancing trigger: if your program spawns 1000 goroutines, the first ~`GOMAXPROCS-1` `wakep` calls actually wake threads; subsequent ones are no-ops because all Ps are busy.

Senior gut-check: when a profile shows lots of time in `runtime.findRunnable` or `runtime.stealWork`, your runqueues are under-filled or over-balanced. When you see `runqputslow` in a profile, you're spawning faster than 256 goroutines per P can be drained — usually a sign of too many `go` statements (consider a worker pool) or too few Ps for the load (consider raising `GOMAXPROCS` if the box has more cores).

</details>

---

## Task 10 — Diff `chan.go` between Go 1.20 and 1.22 (M)

**Goal.** Compare `runtime/chan.go` between Go 1.20 and Go 1.22. List the non-trivial changes — not whitespace, not comment edits.

**Starter.**

```bash
# Easiest: use the GitHub blob comparison directly.
# https://github.com/golang/go/blob/release-branch.go1.20/src/runtime/chan.go
# https://github.com/golang/go/blob/release-branch.go1.22/src/runtime/chan.go
```

**Instructions.**

1. If you have multiple Go installations side by side: `diff -u /path/to/go1.20/src/runtime/chan.go /path/to/go1.22/src/runtime/chan.go > chan-diff.patch`.
2. Otherwise, grab both files from the GitHub release branches:
   - `curl -fsSL https://raw.githubusercontent.com/golang/go/release-branch.go1.20/src/runtime/chan.go -o chan-1.20.go`
   - `curl -fsSL https://raw.githubusercontent.com/golang/go/release-branch.go1.22/src/runtime/chan.go -o chan-1.22.go`
   - `diff -u chan-1.20.go chan-1.22.go | less`
3. Skim the diff. Skip whitespace-only chunks (lines starting with `-` that are blank or comment edits).
4. Identify functionally-significant changes. Categories to look for:
   - New field added to `hchan` (`timer *timer` was added between 1.20 and 1.22 to support unified timer-driven channels).
   - Race annotations (`raceacquire`/`racerelease`) added or moved.
   - Comments correcting subtle race conditions in the lockless fast paths.
   - Changes to `chansend`/`chanrecv` parameter lists.
   - Changes to how closed channels behave under select (the 1.22 timer integration touched this).
5. For each non-trivial change, write a one-sentence note: "1.22 added `hchan.timer` to support `time.NewTimer` channels managed by the unified per-P timer heap" or "1.22 `chansend` removed the `raceenabled` check at line X because it's now hoisted into `chansendN`".
6. Optional: read the corresponding CL (changelist) on Gerrit. The commit messages on `golang/go` reference CL numbers; `git log --oneline release-branch.go1.20..release-branch.go1.22 -- src/runtime/chan.go` shows them.

**Acceptance criteria.**

- You can list at least three non-trivial diffs between 1.20 and 1.22 chan.go.
- You can identify the timer-integration change (the `timer *timer` field on `hchan` and related logic) — it's the largest single change to chan.go between those versions.
- You can answer: "What was the motivation for the 1.22 channel changes?" — primarily the unified timer rework (CL ~485815 and follow-ups). Pre-1.22, timer channels (`time.After`, `time.Tick`) used a separate mechanism with known scalability issues; 1.22 made them first-class channels driven by the per-P timer heap.

<details><summary>Reference walkthrough</summary>

A representative non-trivial diff (Go 1.20 → 1.22) on `chan.go`. Don't memorise the line numbers; they're calibration only.

**Change 1 — new `timer` field on `hchan`:**

```diff
 type hchan struct {
     qcount   uint
     dataqsiz uint
     buf      unsafe.Pointer
     elemsize uint16
     closed   uint32
+    timer    *timer
     elemtype *_type
     sendx    uint
     ...
 }
```

This is the heart of the 1.22 timer rewrite. Previously, `time.NewTimer` returned a `*Timer` whose `C` field was a regular channel; the timer subsystem held a separate reference and called `runtime.sendTime` to put a value on `C` when it fired. That meant the timer subsystem had to manage its own goroutine wake-ups outside the channel's `sendq`.

In 1.22, `time.NewTimer` creates a channel that *is* the timer's channel — the `hchan.timer` back-pointer links them. When the timer fires, the timer code directly enqueues onto the channel using the channel's normal send path, which integrates cleanly with `select` semantics and avoids the cross-system synchronisation that used to bite users.

**Change 2 — `chansend` race handling:**

```diff
 func chansend(c *hchan, ep unsafe.Pointer, block bool, callerpc uintptr) bool {
     if c == nil {
         if !block {
             return false
         }
         gopark(nil, nil, waitReasonChanSendNilChan, traceBlockForever, 2)
         throw("unreachable")
     }
+    if c.timer != nil {
+        c.timer.maybeRunChan()
+    }
     if debugChan {
         print("chansend: chan=", c, "\n")
     }
     ...
 }
```

This integrates the timer's lazy update into the send fast path: when sending on a timer-backed channel, give the timer a chance to fire if its deadline has passed but the runtime hasn't yet scheduled the wakeup. Subtle; impossible to grok without reading the timer.go change at the same time.

**Change 3 — `chanrecv` symmetric timer hook:**

```diff
 func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
     ...
     if c == nil {
         ...
     }
+    if c.timer != nil {
+        c.timer.maybeRunChan()
+    }
     if debugChan {
         ...
     }
 }
```

Same pattern on receive. The hook is `maybeRunChan` which is a fast inlinable check followed by a (rare) slow path.

**Change 4 — `closechan` no longer panics on timer-managed channels:**

```diff
 func closechan(c *hchan) {
+    if c.timer != nil {
+        // Closing a timer-managed channel is allowed but stops the timer.
+        c.timer.stop()
+    }
     if c == nil {
         panic(plainError("close of nil channel"))
     }
     ...
 }
```

Previously, the language spec was silent on what happens if you close a timer's channel; the runtime might or might not panic depending on race timing. 1.22 made it explicit: closing a timer's channel cancels the timer.

**Change 5 — minor: `select` integration in `chan.go::chansend` for the new `selectnbsend` shape:**

There were small adjustments to how `selectnbsend` interacts with timer-managed channels, but they're invisible to most readers — the change is mostly in `select.go`.

Where to read more:

- `git log --oneline release-branch.go1.20..release-branch.go1.22 -- src/runtime/chan.go src/runtime/time.go` in a checkout of golang/go gives you the commits.
- Look for commits with messages like "runtime: integrate timer channels with hchan" or referencing issue numbers in the 56000–60000 range.

Senior takeaway: reading runtime source diffs across releases is the single best way to keep up with what the team is actively working on. The release notes summarise; the diff shows you what *survived* the discussions on the mailing list. If you've never read a major-release runtime diff, the 1.20→1.22 chan/time integration is a perfect first one — small enough to read in an evening, important enough that it affects every program with a `time.After`.

</details>

---

## Task 11 — Step into `makechan` with `dlv` (S)

**Goal.** Use Delve to step from a user program's `make(chan int)` into `runtime.makechan` and observe the parameters and local variables.

**Starter.**

```go
// main.go
package main

func main() {
    ch := make(chan int, 4)
    _ = ch
}
```

**Instructions.**

1. Install Delve if not present: `go install github.com/go-delve/delve/cmd/dlv@latest`. Confirm: `dlv version`.
2. Build with debug info and no inlining: `go build -gcflags='all=-N -l' -o main main.go`. The flags disable optimisation (`-N`) and inlining (`-l`) — essential for debugging because optimised code reorders and elides locals.
3. Start dlv: `dlv exec ./main`.
4. Set a breakpoint at `main.main`: `break main.main`. Continue: `continue`. You stop at the first instruction of main.
5. Set another breakpoint at the runtime entry: `break runtime.makechan`. Continue: `continue`.
6. You're now in `runtime.makechan` with `main` paused. Run `args` to see the parameters: you'll see `t *chantype`, `size int`, and (depending on Go version) some compiler-injected return arg.
7. Print the size argument: `print size`. Should print `4`.
8. Print the element size from the type descriptor: `print t.elem.size`. For `chan int`, should print `8`.
9. Step into the function: `step`. Walk a few lines: `next; next; next`. Note what runtime does — it computes `mem = elem.size * size`, checks for overflow, calls `mallocgc` to allocate `sizeof(hchan) + mem`, then sets up the `hchan` fields.
10. When you reach the `mallocgc` call, examine the allocated pointer: `print c`. After the constructor sets fields: `print c.qcount; print c.dataqsiz; print c.elemsize`.
11. Continue to completion: `continue`. Program exits.

**Acceptance criteria.**

- You can drop into `runtime.makechan` under dlv and inspect at least `size`, `c.dataqsiz`, `c.elemsize`.
- You can answer: "Why `-gcflags='all=-N -l'`?" — without `-N` the optimiser eliminates locals; without `-l` `makechan` may itself be inlined into `main.main`. Either makes the debugging session useless.
- You can describe one runtime decision visible in the trace: e.g. "for `size=4, elem.size=8`, `makechan` chooses the buffered code path and computes `mem = 32`; the allocation is `sizeof(hchan) + 32` in one `mallocgc` call".

<details><summary>Reference walkthrough</summary>

Session transcript (formatted; your line numbers will differ):

```
$ go build -gcflags='all=-N -l' -o main main.go
$ dlv exec ./main
Type 'help' for list of commands.
(dlv) break main.main
Breakpoint 1 set at 0x47d18a for main.main() ./main.go:3
(dlv) continue
> main.main() ./main.go:3 (hits goroutine(1):1 total:1) (PC: 0x47d18a)
     1: package main
     2:
=>   3: func main() {
     4:     ch := make(chan int, 4)
     5:     _ = ch
     6: }
(dlv) break runtime.makechan
Breakpoint 2 set at 0x42a740 for runtime.makechan() /usr/local/go/src/runtime/chan.go:71
(dlv) continue
> runtime.makechan() /usr/local/go/src/runtime/chan.go:71 (hits goroutine(1):1 total:1) (PC: 0x42a740)
    66: //
    67: // For example, given the type-only signature
    68: //   chan int
    69: // make(chan int, n) is compiled to makechan(t, n) where t holds chan int.
    70:
=>  71: func makechan(t *chantype, size int) *hchan {
    72:     elem := t.elem
    73:
    74:     // compiler checks this but be safe.
    75:     if elem.size >= 1<<16 {
    76:         throw("makechan: invalid channel element type")
(dlv) args
t = ("*runtime.chantype")(0x49a420)
size = 4
~r0 = (unreadable empty OP stack)
(dlv) print size
4
(dlv) print t.elem.size
8
(dlv) next
> runtime.makechan() /usr/local/go/src/runtime/chan.go:72 (PC: 0x42a753)
(dlv) next
> runtime.makechan() /usr/local/go/src/runtime/chan.go:75 (PC: 0x42a756)
(dlv) next
> runtime.makechan() /usr/local/go/src/runtime/chan.go:79 (PC: 0x42a76c)
(dlv) next
> runtime.makechan() /usr/local/go/src/runtime/chan.go:84 (PC: 0x42a772)
(dlv) print mem
32
(dlv) print overflow
false
(dlv) next
(dlv) print c
("*runtime.hchan")(0xc00007e000)
(dlv) print c.qcount
0
(dlv) print c.dataqsiz
4
(dlv) print c.elemsize
8
(dlv) print c.buf
unsafe.Pointer(0xc00007e060)
(dlv) print c.elemtype
("*runtime._type")(0x49a3c0)
(dlv) continue
Process 12345 has exited with status 0
```

Things to observe:

- The `t *chantype` argument is the compiler-generated type descriptor for `chan int`. Its `elem` field is the descriptor for `int`, whose `size` is 8 on amd64.
- `mem = 32` is `t.elem.size * size = 8 * 4`. This is the buffer size.
- The allocation path: `mallocgc(sizeof(hchan) + mem, ...)` returns a single pointer. The first ~96 bytes are the `hchan` header; bytes 96..127 are the buffer.
- `c.buf` is the interior pointer to the buffer, offset 96 from `c`. (`0xc00007e060 - 0xc00007e000 = 0x60 = 96`.)
- `c.elemsize=8` is set from `elem.size`. Note it's a `uint16`; if you had a channel of a struct larger than 65535 bytes the compiler would reject the program. (Try `make(chan [70000]byte)` and watch the build fail.)

Why `-N -l` matters concretely: if you compile without those flags, the optimiser may inline `makechan` into `main.main` for small constant sizes (it usually doesn't, but it can), in which case `break runtime.makechan` never hits. Or it eliminates the local `c` because the pointer is held only in a register, in which case `print c` fails with "could not find symbol value for c". Either way the session is broken. The cost of `-N -l` is that the binary runs slower and is larger — fine for debugging, not for production.

Senior gut-check: dlv is the tool you reach for when you've read the source and still don't understand a runtime behaviour. Print statements get you 80% of the way; dlv gets you the remaining 20%. The biggest payoff is the ability to step *across* a Go-to-runtime boundary in one session — the only other way to do that is to read the assembly, which is exhausting for anything non-trivial.

</details>

---

## Task 12 — Read `SetFinalizer` and finalizer GC interaction (S)

**Goal.** Read `runtime/mfinal.go::SetFinalizer`, identify the data structures, and explain what the GC does when it discovers an object with a finalizer is unreferenced.

**Starter.**

```bash
grep -n "^func SetFinalizer" "$(go env GOROOT)/src/runtime/mfinal.go"
```

**Instructions.**

1. Open `mfinal.go::SetFinalizer`. Read its preconditions: argument must be a pointer to a heap-allocated object; finalizer must match the type. Many panic conditions exist; trace each to understand the API contract.
2. The function calls `addfinalizer(obj, finalizer, nret, fint, ot)` which stores the (object, finalizer) pair in a `specialfinalizer` record attached to the object's span.
3. Read `mfinal.go::queuefinalizer` — this is what the GC calls when it discovers a finalizer is ready to fire.
4. Read `mfinal.go::runfinq` — this is the finalizer goroutine. There's one per program. It loops, pulling work from `finq` and invoking each finalizer.
5. The GC lifecycle for finalized objects:
   - Mark phase: the GC scans roots, marks reachable objects. An object with a finalizer is marked through its finalizer reference even if the user has no other reference. So a finalized object survives the first GC after it becomes user-unreachable.
   - Finalizer queue: after marking, the GC checks each span for `specialfinalizer` records on objects that are NOT marked through user code. It revives those (marks them now), and enqueues their finalizers onto `finq`.
   - `runfinq` goroutine wakes, dequeues, invokes finalizers. Finalizers run on a single goroutine — order is not guaranteed across runs but is consistent within a run.
   - The object is removed from the finalizer set; on the *next* GC cycle, if still unreachable, it's collected.
6. Implications: a finalized object survives one extra GC cycle (the cycle where its finalizer fires). Calling `SetFinalizer(p, nil)` removes the finalizer and the object behaves normally thereafter.

**Acceptance criteria.**

- You can name `specialfinalizer` as the on-span record storing the finalizer.
- You can name `finq` and `runfinq` as the global queue and the dedicated finalizer goroutine.
- You can answer: "How many GC cycles does a finalized object survive?" — at least two (one to enqueue the finalizer, one to actually collect). In practice three or more if the finalizer itself re-references the object.
- You can answer: "Why is `SetFinalizer` discouraged?" — finalizers run on a single goroutine, possibly arbitrarily delayed; they don't run if the program exits; they can resurrect objects (calling SetFinalizer inside a finalizer with a self-reference); they break GC promptness. Prefer `defer Close()` for resource cleanup; `SetFinalizer` is only appropriate as a last-resort safety net (e.g. `os.File` uses it to warn about leaked FDs).

<details><summary>Reference walkthrough</summary>

The key data structures (in `mheap.go` and `mfinal.go`):

```go
type specialfinalizer struct {
    special special    // _KindSpecialFinalizer marker, links into span's specials list
    fn      *funcval   // the finalizer function
    nret    uintptr    // bytes of return value
    fint    *_type     // type of the finalizer's argument
    ot      *ptrtype   // type of the original object (the pointer-to-T)
}
```

Every `mspan` has a sorted linked list `span.specials` of `special` records — finalizers, profile annotations, weak references (Go 1.24+). `_KindSpecialFinalizer` is the discriminator.

`addfinalizer(p, fn, nret, fint, ot)` (simplified):

```go
func addfinalizer(p unsafe.Pointer, fn *funcval, nret uintptr, fint *_type, ot *ptrtype) bool {
    lock(&mheap_.speciallock)
    s := (*specialfinalizer)(mheap_.specialfinalizeralloc.alloc())
    unlock(&mheap_.speciallock)
    s.special.kind = _KindSpecialFinalizer
    s.fn = fn
    s.nret = nret
    s.fint = fint
    s.ot = ot
    if addspecial(p, &s.special) {
        // Marked by GC scan to root finalizer fn.
        KeepAlive(p)
        return true
    }
    // Already had a finalizer: free and return false.
    lock(&mheap_.speciallock)
    mheap_.specialfinalizeralloc.free(unsafe.Pointer(s))
    unlock(&mheap_.speciallock)
    return false
}
```

The GC side, in `mgcsweep.go` and `mgcmark.go`:

- During mark, when the GC scans a span, it walks `span.specials`. If a `specialfinalizer` is attached to an object that *would* be collected (its mark bit is 0 after the mark phase), the GC:
  1. Marks the object live for this cycle (resurrection).
  2. Marks the finalizer function and the captured args live.
  3. Calls `queuefinalizer(obj, sf)` to push (obj, finalizer) onto `finq`.
  4. Removes the `specialfinalizer` from the span — finalizers fire once.
- After sweep, `runfinq` is signalled (via `wakefing`). It runs the finalizers serially.

`runfinq` is a singleton goroutine started lazily on first `SetFinalizer`:

```go
func runfinq() {
    for {
        lock(&finlock)
        fb := finq
        finq = nil
        // ... wait if nothing to do ...
        unlock(&finlock)
        for fb != nil {
            for i := uint32(0); i < fb.cnt; i++ {
                f := &fb.fin[i]
                // ... arg setup ...
                reflectcall(f.fint, unsafe.Pointer(f.fn), frame, ...)
                // ... cleanup ...
            }
            // ... move fb to free list, advance to next ...
        }
    }
}
```

`finq` is a linked list of `finblock`s, each holding ~100 finalizers. Batching minimises lock acquisition; the runtime can collect many finalizers in one mark phase and process them all in one runfinq pass.

Walkthrough of object lifecycle with finalizer:

```go
type Foo struct{}
p := &Foo{}
runtime.SetFinalizer(p, func(*Foo) { fmt.Println("finalized") })
p = nil
runtime.GC()  // first GC — finalizer queued
runtime.GC()  // second GC — object collected (only if finalizer goroutine has run)
```

- After `SetFinalizer`, `addfinalizer` attaches a `specialfinalizer` to the span containing `p`.
- `p = nil` removes the user's reference.
- First `runtime.GC()`: mark phase finds the object unreachable from user roots but reachable via the specialfinalizer's `fn` (the finalizer captures the pointer, so it's a root). The GC notices `_KindSpecialFinalizer` and enqueues the finalizer. The object is marked live for this cycle.
- The finalizer goroutine wakes, calls the finalizer, prints "finalized".
- Second `runtime.GC()`: mark phase finds the object truly unreachable (no special record left). Sweep frees it.

Senior cautions about finalizers:

- The finalizer goroutine is single-threaded. Slow finalizers stall all other finalizers. Don't do IO in them.
- Finalizers run *some time* after the object becomes unreachable. "Some time" can be milliseconds or seconds depending on GC frequency and finalizer goroutine throughput. They are not deterministic cleanup.
- If the program calls `os.Exit` or panics terminally, finalizers do NOT run. Anything that *must* happen is not safe in a finalizer.
- Finalizers can resurrect objects: if the finalizer stores a self-reference in a global, the object lives until next dropped. This is allowed but rarely useful and frequently a bug.
- `runtime.KeepAlive(p)` is the antidote to "the GC collected p while I was in the middle of using its data via unsafe.Pointer": it forces p to remain live until the KeepAlive call. Required when using `cgo` to pass pointers into C with a finalizer attached.

The legitimate uses of `SetFinalizer` in production Go code: `os.File` (warn about FD leaks), `net.conn` (close socket on GC), some `cgo`-backed types that wrap C resources. That's roughly it. Everything else should use `defer Close()` or an explicit Close in the call site.

</details>

---

## Task 13 — Trace `time.Sleep` into the runtime (S)

**Goal.** Trace a `time.Sleep(d)` call from the `time` package into `runtime/time.go::timeSleep`, identify the call to `gopark`, and identify the mechanism that wakes the goroutine when the duration elapses.

**Starter.**

```bash
grep -n "^func Sleep" "$(go env GOROOT)/src/time/sleep.go"
grep -n "^func timeSleep" "$(go env GOROOT)/src/runtime/time.go"
```

**Instructions.**

1. Open `src/time/sleep.go`. `time.Sleep(d)` is a one-line wrapper that calls `runtime.timeSleep(int64(d))` via `//go:linkname`. Note the linkname pragma at the top of the file.
2. Open `runtime/time.go::timeSleep`. Read top to bottom. The function:
   - Returns immediately if `d <= 0`.
   - Grabs the current `g` and reuses or creates the per-g timer `gp.timer`.
   - Sets up the timer with `when = nanotime() + ns`, `f = goroutineReady` (the wake function).
   - Calls `resetForSleep` (or similar — name has changed across versions) which schedules the timer.
   - Calls `gopark(resetForSleep, &gp.timer, waitReasonSleep, traceBlockSleep, 2)`.
3. The `gopark` parks the goroutine. The `unlockf` is `resetForSleep` which finishes inserting the timer into the per-P timer heap (it has to be done *after* `_Gwaiting` is set, otherwise the wake could fire before park completes — a classic race).
4. When the timer fires (at `when`), the timer subsystem calls `goroutineReady(arg, seq)` which calls `goready(arg.(*g), 0)`. `goready` flips the `g`'s status from `_Gwaiting` to `_Grunnable` and puts it back on a run queue.
5. The goroutine eventually gets scheduled. From its perspective, `gopark` returned. `timeSleep` returns. `time.Sleep` returns.
6. Open `runtime/time.go::checkTimers` (called by the scheduler in `findRunnable`). This is where the per-P timer heap is consulted: if `t.when <= now`, fire the timer by calling its `f`.

**Acceptance criteria.**

- You can trace the call chain: `time.Sleep` → `runtime.timeSleep` (via linkname) → `gopark` → (timer expires) → `goroutineReady` → `goready` → scheduler resumes.
- You can name the wake function: `goroutineReady`.
- You can name the per-P timer storage: a min-heap of timers (`runtime.p.timers []` and supporting heap operations in `time.go`).
- You can answer: "What prevents a timer firing while gopark is mid-way?" — the unlockf (`resetForSleep`) runs *after* the goroutine is marked `_Gwaiting` but before park yields control; the timer is only inserted into the heap at that point, so it cannot fire earlier.

<details><summary>Reference walkthrough</summary>

Call chain on Go 1.22:

```go
// time/sleep.go
func Sleep(d Duration)

// Implementation linknamed to runtime.timeSleep:
//go:linkname runtime_timeSleep runtime.timeSleep
func runtime_timeSleep(ns int64)

func Sleep(d Duration) {
    runtime_timeSleep(int64(d))
}
```

```go
// runtime/time.go (Go 1.22, abridged):
func timeSleep(ns int64) {
    if ns <= 0 {
        return
    }
    gp := getg()
    t := gp.timer
    if t == nil {
        t = new(timer)
        gp.timer = t
    }
    t.f = goroutineReady
    t.arg = gp
    t.nextwhen = nanotime() + ns
    if t.status != timerNoStatus && t.status != timerRemoved {
        throw("timeSleep: timer not stopped")
    }
    gopark(resetForSleep, unsafe.Pointer(t), waitReasonSleep, traceBlockSleep, 1)
}
```

```go
// resetForSleep runs on g0 stack after the calling g is _Gwaiting.
// At this point it's safe to insert the timer; if it fires, the g
// is in _Gwaiting state and goready will promote it correctly.
func resetForSleep(gp *g, ut unsafe.Pointer) bool {
    t := (*timer)(ut)
    resettimer(t, t.nextwhen)
    return true
}
```

```go
// runtime/time.go
func goroutineReady(arg any, seq uintptr) {
    goready(arg.(*g), 0)
}
```

The race that `resetForSleep` solves: imagine `resettimer(t, when)` were called *before* `gopark` instead of as the `unlockf`. Suppose the system is heavily loaded, `gopark`'s call into `mcall(park_m)` takes a microsecond, and the timer's `when` is only 500ns away. The timer might fire, call `goready` on the `g` — but the `g` is still `_Grunning` because `park_m` hasn't yet flipped it to `_Gwaiting`. `goready` on a running `g` panics with "bad g status".

The fix is to insert the timer only after the `g` is safely `_Gwaiting`. `gopark` provides exactly that hook via `unlockf`. So `resetForSleep` runs with the right invariants and the race is closed.

The wake side, in the scheduler:

```go
// runtime/proc.go::findRunnable (abridged):
func findRunnable() (*g, bool) {
    pp := getg().m.p.ptr()
    ...
    if checkTimers(pp, 0) {
        // Wake-needed: a timer fired and produced runnable work
    }
    ...
}
```

```go
// runtime/time.go::checkTimers:
func checkTimers(pp *p, now int64) (rnow, pollUntil int64, ran bool) {
    next := atomic.Load64(&pp.timer0When)
    if next == 0 || (now != 0 && next > now) {
        return now, int64(next), false
    }
    ...
    rnow, pollUntil, ran = runtimer(pp, now)
    ...
}
```

`runtimer` pops the smallest-when timer from the heap, checks if it's due, calls its `f` (which for `time.Sleep` is `goroutineReady`, which calls `goready(g, 0)`). The g is now `_Grunnable` and on some run queue. The scheduler picks it up on the next iteration.

Per-P heap details:

- Each `p` has `p.timers []*timer` — a 4-ary min-heap keyed on `when`.
- `addtimer`/`deltimer`/`resettimer` operate on the heap with standard sift-up/sift-down.
- `p.timer0When` is `atomic.Load`'d to give a cheap "no timer due yet" check in the scheduler hot path.
- Timers can be cleaned up lazily — a stopped timer's slot is marked `timerDeleted` and skipped by `runtimer`; periodic compaction (`adjusttimers`) removes them in bulk.

The unified timer rework in Go 1.14 moved from "single global timer heap" to per-P. This was the big scheduler-scalability win that made `time.After` viable at high QPS. Go 1.22's chan-integration is the next step (Task 10 covers it).

Senior reading tip: when investigating a "sleeping goroutines block forever" bug, the dump from `runtime.Stack` will show `[sleep]` as the wait reason and the call site will be inside `time.Sleep`. To prove that the timer subsystem is the issue (rather than user code), check `runtime/debug.ReadGCStats` and look for stalled GC, or `runtime/trace` to see whether the scheduler is even running `checkTimers`. A common bug is "running so hot that `findRunnable` never visits the timer-having P" — but that's rare on modern Go because every P checks its own timers on every scheduling pass.

</details>

---

## Task 14 — Read `semacquire1` and the treap (S)

**Goal.** Open `runtime/sema.go::semacquire1` and understand the treap (tree + heap) data structure used to manage waiters.

**Starter.**

```bash
grep -n "^func semacquire1" "$(go env GOROOT)/src/runtime/sema.go"
```

**Instructions.**

1. Open `sema.go`. Read the file header comment — it explains the design rationale: semaphores must be cheap when uncontested but support FIFO and LIFO release strategies on many waiters efficiently.
2. The waiter data structure is a *treap* (a tree that satisfies BST property on `addr` and heap property on `ticket` — a per-waiter random priority). The treap is at the leaves, and each leaf is a linked list of waiters on the same address (because multiple goroutines can wait on the same sync.Mutex).
3. Read `semacquire1(addr *uint32, lifo bool, profile semaProfileFlags, skipframes int, reason waitReason)`. Steps:
   - Fast path: try to decrement `*addr` if positive. If success, no contention, return.
   - Slow path: allocate a `sudog`, fill in its fields (`g = current goroutine`, `addr = addr`, `ticket = random`).
   - Hash `addr` into one of `semTabSize` buckets (`semtable`). Each bucket has its own lock + root treap node.
   - Insert the sudog into the treap at `addr`. If a leaf at `addr` exists, append to its waiter linked list (FIFO at tail or LIFO at head). If no leaf, insert a new tree node and treap-rotate to maintain heap property on ticket.
   - Park the goroutine (`goparkunlock` — `gopark` variant that drops the bucket lock as `unlockf`).
4. The release side is `semrelease1`. It locks the bucket, finds the treap node for `addr`, pops a waiter (head for FIFO, tail for LIFO), wakes it via `goready`.
5. Why a treap? Because:
   - Buckets are hashed, so each bucket sees waiters at many distinct addresses. A BST on `addr` keeps lookups O(log W) where W is the number of *distinct* contended addresses in the bucket.
   - The heap property on ticket randomises the tree shape — without it, sequential lock addresses could create a degenerate linear tree, O(W) lookups.
   - Combined, you get expected O(log W) operations with no rebalancing logic (just rotate-up on insert based on ticket).
6. The number of buckets: `semTabSize = 251` (a prime), so hash collisions are rare. Even on a program with thousands of mutexes, each bucket usually contains a handful of treap nodes.

**Acceptance criteria.**

- You can sketch the treap: BST on address, heap on random ticket priority.
- You can name `sudog` as the waiter record and `semtable` as the bucket array.
- You can answer: "Why is the treap necessary? Why not a hash table per address?" — too many addresses to keep one bucket per address; the treap inside a bucket handles collisions efficiently with constant memory per bucket.
- You can answer: "What does `lifo=true` change?" — when waking a goroutine on the same address, the waiter is taken from the head of the per-address linked list (most recent waiter wakes first). FIFO takes from the tail. `sync.Mutex` uses LIFO in starvation-prone mode, FIFO otherwise.

<details><summary>Reference walkthrough</summary>

The semtable layout, from `sema.go` (Go 1.22):

```go
const semTabSize = 251

var semtable semTable

type semTable [semTabSize]struct {
    root semaRoot
    pad  [cpu.CacheLinePadSize - unsafe.Sizeof(semaRoot{})]byte
}

type semaRoot struct {
    lock  mutex
    treap *sudog        // root of treap; sudog with smallest priority becomes root
    nwait atomic.Uint32 // number of waiters
}
```

`sudog` (in `runtime2.go`):

```go
type sudog struct {
    g *g

    next *sudog
    prev *sudog
    elem unsafe.Pointer // semaphore address (interpreted as *uint32 here)

    acquiretime int64
    releasetime int64
    ticket      uint32  // random priority for treap

    parent   *sudog // treap parent
    waitlink *sudog // g.waiting list or semaRoot waiters at same address
    waittail *sudog // semaRoot
    c        *hchan // channel (for chan-based sudogs; nil for sema)
    ...
}
```

`semacquire1` (abridged Go 1.22):

```go
func semacquire1(addr *uint32, lifo bool, profile semaProfileFlags, skipframes int, reason waitReason) {
    gp := getg()
    if gp != gp.m.curg {
        throw("semacquire not on the G stack")
    }
    // Fast path: 1 -> 0 transition on the semaphore.
    if cansemacquire(addr) {
        return
    }
    // Slow path: queue.
    s := acquireSudog()
    root := semtable.rootFor(addr)
    t0 := int64(0)
    s.releasetime = 0
    s.acquiretime = 0
    s.ticket = 0
    ...
    for {
        lockWithRank(&root.lock, lockRankRoot)
        // Add ourselves to nwait first to ensure release sees us.
        root.nwait.Add(1)
        if cansemacquire(addr) {
            // Raced with a fast release; reset and return.
            root.nwait.Add(-1)
            unlock(&root.lock)
            break
        }
        root.queue(addr, s, lifo)
        goparkunlock(&root.lock, reason, traceBlockSync, 4+skipframes)
        if s.ticket != 0 || cansemacquire(addr) {
            break
        }
    }
    releaseSudog(s)
}
```

`semaRoot.queue(addr, s, lifo)`:

```go
func (root *semaRoot) queue(addr *uint32, s *sudog, lifo bool) {
    s.g = getg()
    s.elem = unsafe.Pointer(addr)
    s.next = nil
    s.prev = nil

    var last *sudog
    pt := &root.treap
    for t := *pt; t != nil; t = *pt {
        if t.elem == unsafe.Pointer(addr) {
            // Already a treap node at this address; append to its waiter list.
            if lifo {
                // New waiter takes the treap-node slot; old waiters become its list.
                *pt = s
                s.ticket = t.ticket
                s.acquiretime = t.acquiretime
                s.parent = t.parent
                s.prev = t.prev
                s.next = t.next
                if s.prev != nil { s.prev.parent = s }
                if s.next != nil { s.next.parent = s }
                s.waitlink = t
                s.waittail = t.waittail
                if s.waittail == nil { s.waittail = t }
                t.parent = nil
                t.prev = nil
                t.next = nil
                t.waittail = nil
            } else {
                // FIFO: append to tail of waiter list.
                if t.waittail == nil {
                    t.waitlink = s
                } else {
                    t.waittail.waitlink = s
                }
                t.waittail = s
                s.waitlink = nil
            }
            return
        }
        last = t
        if uintptr(unsafe.Pointer(addr)) < uintptr(t.elem) {
            pt = &t.prev
        } else {
            pt = &t.next
        }
    }
    // Insert as new treap node with random ticket.
    s.ticket = cheaprand() | 1
    s.parent = last
    *pt = s
    // Bubble up by ticket (treap heap property).
    for s.parent != nil && s.parent.ticket > s.ticket {
        if s.parent.prev == s { root.rotateRight(s.parent) } else { root.rotateLeft(s.parent) }
    }
}
```

The treap insertion is the elegant part: every new `sudog` gets a random ticket; you bubble up while your ticket is smaller than the parent's. This maintains the min-heap property on ticket and keeps the tree shape balanced with high probability — expected depth O(log W).

Lookup on release is symmetric: find the treap node for `addr`, take one waiter from its list (head for LIFO, tail for FIFO), if the list becomes empty remove the treap node by bubbling it down to a leaf and detaching.

Why 251 buckets:

- Prime, to spread arbitrary `*uint32` addresses uniformly across buckets under modulo hashing.
- Big enough that contention on the bucket lock is rare (a 1000-goroutine, 100-mutex program averages 4 contended addresses per bucket).
- Small enough that the bucket array fits in a few cache lines, and `cpu.CacheLinePadSize` between buckets prevents false sharing.

The `lifo` parameter and `sync.Mutex` starvation mode:

- Normal `sync.Mutex` uses FIFO release — waiters are woken in queue order. Provides fairness.
- Under starvation (a waiter has been queued for >1ms), Mutex switches to LIFO release — the most recent unlock hands the mutex directly to the most recent waiter, preventing barging by newly arriving goroutines.
- This is the "starvation mode" introduced in Go 1.9 (CL ~34310). The trade-off: FIFO is faster in low contention; LIFO is required to bound the worst-case wait time. Mutex adapts at runtime.

Senior gut-check: if you see `runtime.semacquire` in a profile dominating wall time, you have lock contention. The fix is structural (reduce critical section length, shard the locked resource, switch to RWMutex if reads dominate). Profiling tools that "show mutex contention" use `runtime/pprof`'s mutex profile, which is populated from this code.

</details>

---

## Task 15 — Read `selectgo` and pseudo-random ordering (S)

**Goal.** Open `runtime/select.go::selectgo`, understand the pseudo-random case selection, and explain why the ordering matters.

**Starter.**

```bash
grep -n "^func selectgo" "$(go env GOROOT)/src/runtime/select.go"
```

**Instructions.**

1. Open `select.go`. The file is shorter than chan.go — `selectgo` is the meat (~300 lines).
2. Read the function signature: `func selectgo(cas0 *scase, order0 *uint16, pc0 *uintptr, nsends int, nrecvs int, block bool) (int, bool)`. The compiler builds an array of `scase` (one per case), an `order` array of indices, and a `pc` array for race annotations. `selectgo` shuffles `order` and walks.
3. The algorithm:
   - Generate two random permutations of `0..ncases-1` using `fastrand` — `pollorder` (visit order for the first pass) and `lockorder` (lock acquisition order, sorted by channel pointer to avoid deadlock).
   - Lock all channels in `lockorder`. (This is where the sort matters: locking in pointer order prevents two `selectgo`s on overlapping channel sets from deadlocking each other.)
   - First pass: walk `pollorder`. For each case, check if the channel is ready (send: buffer has space or recv waiting; recv: buffer has data or send waiting; closed: always ready for recv). If ready, execute the case, unlock all channels, return.
   - If no case is ready and `block=false` (a `default` case exists), return `default`'s index.
   - Otherwise enqueue this goroutine as a waiter on every channel (a `sudog` per case linked via `waitlink`). Unlock all channels. `gopark`.
   - When woken, identify which case fired (the `sudog` whose `success` field is set), dequeue from all other channels, unlock, return.
4. Why pseudo-random `pollorder`? To prevent starvation: if cases were checked in lexical order, a busy first case could starve later cases. Random ordering ensures fairness in expectation.
5. Why sorted `lockorder` (by `c` pointer)? To avoid deadlock between two concurrent `select`s with overlapping channels. Without a consistent lock order, one select could hold lock A trying to acquire B while another holds B trying to acquire A.

**Acceptance criteria.**

- You can explain the two arrays: `pollorder` (random for fairness) and `lockorder` (sorted for deadlock avoidance).
- You can answer: "Why are channels unlocked before gopark?" — to allow other goroutines (especially senders/receivers that might unblock this select) to make progress. Holding all the channel locks across the park would serialise the entire system.
- You can answer: "Why does `selectgo` use `fastrand` and not a deterministic shuffle?" — fairness in expectation; deterministic shuffling would still allow adversarial scheduling to starve cases under specific traffic patterns.

<details><summary>Reference walkthrough</summary>

Pseudocode (very abridged — real `selectgo` is intricate):

```go
func selectgo(cas0 *scase, order0 *uint16, ...) (int, bool) {
    cas1 := (*[1 << 16]scase)(unsafe.Pointer(cas0))[:ncases:ncases]
    order1 := (*[1 << 17]uint16)(unsafe.Pointer(order0))[:2*ncases:2*ncases]
    pollorder := order1[:ncases:ncases]
    lockorder := order1[ncases:][:ncases:ncases]

    // 1. Generate random pollorder using Fisher-Yates.
    norder := 0
    for i := range cas1 {
        cas := &cas1[i]
        if cas.c == nil {
            cas.elem = nil
            continue
        }
        j := fastrandn(uint32(norder + 1))
        pollorder[norder] = pollorder[j]
        pollorder[j] = uint16(i)
        norder++
    }
    pollorder = pollorder[:norder]
    lockorder = lockorder[:norder]

    // 2. Sort lockorder by channel pointer (heapsort).
    for i := range lockorder {
        j := i
        c := cas1[pollorder[i]].c
        for j > 0 && cas1[lockorder[(j-1)/2]].c.sortkey() < c.sortkey() {
            k := (j - 1) / 2
            lockorder[j] = lockorder[k]
            j = k
        }
        lockorder[j] = pollorder[i]
    }
    // ... heap pop to finish sort ...

    // 3. Lock all in lockorder.
    sellock(scases, lockorder)

    // 4. First pass: pollorder.
    for _, i := range pollorder {
        cas := &cas1[i]
        c := cas.c
        if casi.kind == caseRecv {
            if sg := c.sendq.dequeue(); sg != nil {
                recv(c, sg, cas.elem, func() { selunlock(scases, lockorder) }, 2)
                return int(i), true
            }
            if c.qcount > 0 {
                // unbuffered impossible if dataqsiz==0 and no senders, so this is buffered
                ...
                selunlock(scases, lockorder)
                return int(i), true
            }
            if c.closed != 0 {
                selunlock(scases, lockorder)
                return int(i), false
            }
        } else {
            // caseSend symmetric.
        }
    }

    // 5. Default?
    if !block {
        selunlock(scases, lockorder)
        return -1, false
    }

    // 6. Enqueue on all channels.
    gp := getg()
    gp.waiting = nil
    nextp := &gp.waiting
    for _, i := range lockorder {
        cas := &cas1[i]
        c := cas.c
        sg := acquireSudog()
        sg.g = gp
        sg.c = c
        sg.elem = cas.elem
        ...
        *nextp = sg
        nextp = &sg.waitlink
        if cas.kind == caseRecv { c.recvq.enqueue(sg) } else { c.sendq.enqueue(sg) }
    }

    // 7. Park.
    gp.param = nil
    gp.signal = ...
    gopark(selparkcommit, nil, waitReasonSelect, traceBlockSelect, 1)
    // selparkcommit's job: unlock all channels, return true.

    // 8. Woken. Find the fired case.
    sg := gp.param.(*sudog)
    casi := -1
    for _, i := range lockorder {
        cas := &cas1[i]
        if sg.c == cas.c { casi = int(i); break }
    }
    // ... cleanup remaining sudogs from other channels ...
    return casi, recvd
}
```

Why locking *all* channels: to prevent races between "I observed channel A is empty" and "before I park on A, someone sent on B and now would have unparked me from B too". By holding all channel locks, the observation that "all are empty/full" is atomic w.r.t. external sends/recvs.

Why unlock *during* gopark (via `selparkcommit` as the `unlockf`): keeping channels locked across the park would serialise senders/receivers on those channels with the parked selector — they couldn't enqueue/dequeue from `recvq`/`sendq` even though they're not racing with the selector anymore. `selparkcommit` releases all channel locks atomically with the `_Gwaiting` transition (same `unlockf` trick from Task 6).

Why `pollorder` is random: imagine `select { case <-fast: ...; case <-slow: ...; }` where `fast` is always ready. With lexical ordering, `slow` never fires. With random ordering, `slow` fires whenever it happens to come first in the shuffle AND it's also ready — which still favours `fast` if it's much more often ready, but doesn't starve `slow` indefinitely.

Why `lockorder` by pointer address (deterministic, total order on `*hchan`): if two goroutines both `select` on channels `c1` and `c2` but use different orders to lock them, they could deadlock (G1 holds c1's lock, waits for c2; G2 holds c2's lock, waits for c1). By always locking in pointer order, both goroutines lock c1 then c2 (or c2 then c1 if c2 < c1), and the deadlock is impossible.

Senior gut-check: when you see a `select` with many cases in a profile (large `select` for fan-in over hundreds of channels), `selectgo` itself can dominate — the random shuffle and lock sort are O(N) and O(N log N). For very large N, prefer reflection-based `reflect.Select` (which has the same cost) or refactor to a single channel with multiplexer goroutines. The Go runtime is fast at small selects (1-10 cases) and acceptable at moderate ones (10-100); larger is rare and warrants design review.

</details>

---

## Task 16 — Read `scanstack` (S)

**Goal.** Open `runtime/mgcmark.go::scanstack` and identify how the GC scans a goroutine's stack for pointers.

**Starter.**

```bash
grep -n "^func scanstack" "$(go env GOROOT)/src/runtime/mgcmark.go"
```

**Instructions.**

1. Open `mgcmark.go::scanstack`. Note the preamble: it asserts the goroutine is in a scannable state (`_Gwaiting`, `_Grunnable`, or stopped under STW). It cannot scan a running `g`'s stack because the stack is mutating.
2. The function calls `scanstackblock` for each frame, walking the call stack via `gentraceback`. For each frame:
   - The frame's *PC* identifies which function this is.
   - The function's *stack map* (generated by the compiler) is looked up: it's a bitmap where each bit says "is this 8-byte slot a pointer or not".
   - The scanner walks the bitmap, and for each "pointer" slot reads the value and calls `greyobject` (mark it reachable, enqueue for further scanning).
3. The stack map mechanism is the key — without it, the GC would have to treat every slot as a possible pointer (conservative GC), which would cause false retention. Go uses precise GC: the compiler tells the GC which slots are pointers.
4. Stack maps are stored in `runtime.functab` and accessed via `funcdata(FUNCDATA_LocalsPointerMaps, ...)`. The GC looks up the right map at the frame's PC.
5. Special handling:
   - Argument area: scanned via `FUNCDATA_ArgsPointerMaps`.
   - Spilled register arguments: scanned via `FUNCDATA_RegPointerMaps` (since Go 1.17 register ABI).
   - Defer records, panic chain, etc., scanned separately by their own functions.
6. Stack growth interaction: when a stack is moved (Go stacks are growable, so `morestack` can copy the stack to a new larger area), the GC's pointers into the stack would dangle — but the runtime adjusts every stored pointer during move, using the same stack maps. This is one of the things that makes Go's GC and goroutines fast: precise stack maps enable both precise GC and stack copying.

**Acceptance criteria.**

- You can name the per-function bitmap as the *stack map* (or *pointer map*).
- You can name `gentraceback` as the frame-walker and `scanstackblock` as the per-frame scanner.
- You can answer: "Why does Go use precise stack maps instead of conservative GC?" — precise GC eliminates false retention (otherwise a small int that happens to look like a heap pointer would prevent collection). Also enables movable stacks: a conservative collector can't move objects because it can't distinguish pointers from non-pointers, but Go moves stacks during growth.
- You can answer: "Can the GC scan a running goroutine?" — no. The goroutine must be stopped (preempted onto a safe point) before its stack is scanned. The preemption mechanism is `runtime.preemptone`, which signals the goroutine to call `runtime.morestack` at the next safe point; that funnels through to scheduler hooks that pause the g for scanning.

<details><summary>Reference walkthrough</summary>

`scanstack` (Go 1.22, abridged):

```go
func scanstack(gp *g, gcw *gcWork) int64 {
    if readgstatus(gp)&^_Gscan == _Grunning {
        throw("scanstack: g is running")
    }
    ...
    // Find the stack bounds.
    var sp, cap uintptr
    sp = gp.sched.sp
    cap = uintptr(gp.stack.hi)
    ...
    // Walk frames from inner to outer.
    var u unwinder
    u.init(gp, 0)
    for ; u.valid(); u.next() {
        scanframeworker(&u.frame, &state, gcw)
    }
    ...
    // Scan defer records, panic chain, etc.
    for d := gp._defer; d != nil; d = d.link {
        if d.fn != nil { scanblock(...) }
        ...
    }
    for p := gp._panic; p != nil; p = p.link {
        ...
    }
    return int64(scanned)
}
```

`scanframeworker`:

```go
func scanframeworker(frame *stkframe, state *stackScanState, gcw *gcWork) {
    f := frame.fn
    ...
    // Locals.
    if locals, args, objs := frame.getStackMap(false); ... {
        scanblock(frame.varp - locals.n*goarch.PtrSize, locals.n*goarch.PtrSize, locals.bytedata, gcw, state)
        scanblock(frame.argp, args.n*goarch.PtrSize, args.bytedata, gcw, state)
    }
    ...
}
```

`frame.getStackMap(false)` is where the per-PC stack map is resolved. It looks up `FUNCDATA_LocalsPointerMaps` and `FUNCDATA_ArgsPointerMaps` via `funcdata(f, FUNCDATA_LocalsPointerMaps)`. These are emitted by the compiler in `cmd/compile/internal/liveness/plive.go` (the liveness analysis pass).

The bitmap layout (from `runtime/symtab.go`):

```go
type stackmap struct {
    n        int32  // number of bitmaps
    nbit     int32  // number of bits per bitmap
    bytedata [1]byte
}
```

For a function with 8 local slots, `nbit = 8` and `bytedata` is `(nbit+7)/8 = 1` byte. The bit at position `i` is 1 iff slot `i` (counting downward from `varp`) is a pointer at the current PC. The same function may have *multiple* bitmaps (one per safe point) because the live set of pointers changes as execution moves through the function — a variable may be live in one block and dead in another. `n` is the bitmap count and the runtime picks the right one based on the current PC.

Stack moving and pointer adjustment:

```go
// runtime/stack.go::copystack:
func copystack(gp *g, newsize uintptr) {
    ...
    // Move pointers in the old stack to point into the new stack.
    var adjinfo adjustinfo
    adjinfo.old = old
    adjinfo.delta = new.hi - old.hi
    ...
    // Walk frames using the same stack maps as scanstack uses.
    gentraceback(...)
    for each frame {
        // Use stack maps to find pointer slots; for each, if it points
        // into the old stack, add adjinfo.delta to retarget into new stack.
    }
    ...
}
```

Without precise stack maps, this is impossible. Conservative GCs (Boehm, etc.) cannot move objects because they cannot distinguish "this 8-byte slot is a pointer" from "this is just a number that happens to look like one in this region". Go's precision is what unlocks (a) stack growth without lock-stepping, (b) compaction (though Go's GC is non-moving for heap objects currently; only stacks move).

Preemption and scan safety:

Pre-Go 1.14, the only safe points for scanstack were *function call* boundaries — the compiler inserted stack-check prologues that doubled as preemption checks. A tight loop without function calls could prevent GC indefinitely (the famous `for {}` issue).

Go 1.14 added *asynchronous preemption* via signals. The runtime sends a SIGURG to the OS thread running the stuck goroutine; the signal handler resumes execution at a generated safe point (a PC where the compiler has emitted a stack map). The PC's stack map is used immediately by scanstack. This requires the compiler to emit stack maps at *every* instruction where preemption could occur, which is most of them — leading to a moderate increase in binary size.

Senior gut-check: when GC pauses get long, look at `runtime/trace` (Task 17) to find which phase is slow. If `mark-assist` dominates, your allocator is too aggressive; if `scan-stacks` dominates, you have lots of goroutines with deep stacks (a worker-pool program with 100k idle goroutines, each at depth 50, takes a long time to scan). Bounded goroutines and shallow recursion mitigate stack-scan cost.

</details>

---

## Task 17 — Trace a program with `go tool trace` (S)

**Goal.** Run a tiny program under the runtime tracer, open the trace in a browser, find `GoCreate`, `GoStart`, `GoBlockSend` events, and match each event to its origin in the runtime source.

**Starter.**

```go
// main.go
package main

import (
    "os"
    "runtime/trace"
)

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    ch := make(chan int)
    go func() { ch <- 42 }()
    <-ch
}
```

**Instructions.**

1. Save and run: `go run main.go`. This produces `trace.out`.
2. Open the trace: `go tool trace trace.out`. It starts a local web server and prints a URL; open it in a browser.
3. Navigate the trace UI:
   - The first view is the goroutine analysis overview. Click "View trace" or one of the time-window links.
   - The trace timeline shows Ps as rows, with `Goroutines running` bars per P.
   - Click into one of the bars to see individual events.
4. Identify three event types:
   - `GoCreate`: emitted when a new goroutine is created. In your program, that's the `go func() { ... }()` statement.
   - `GoStart`: emitted when a goroutine begins running on a P.
   - `GoBlockSend`: emitted when a goroutine parks on a channel send because no receiver is waiting.
5. For each event, find the runtime source that emits it:
   - `GoCreate`: emitted by `runtime.newproc1` via `traceGoCreate(...)`. Grep: `grep -n "traceGoCreate" "$(go env GOROOT)/src/runtime/proc.go"`.
   - `GoStart`: emitted by `runtime.execute` (the function that hands control to a goroutine) via `traceGoStart`. Grep: `grep -n "traceGoStart" "$(go env GOROOT)/src/runtime"`.
   - `GoBlockSend`: emitted by `runtime.chansend` when the sender parks. Look for `traceBlockChan` references near `gopark` calls in `chan.go`.
6. Match the trace to the source: the `GoCreate` in your trace corresponds to the `go func() ...` line; the `GoBlockSend` corresponds to `ch <- 42` blocking because main hasn't yet executed `<-ch`; the `GoStart` corresponds to the goroutine actually running after main parks on `<-ch`.

**Acceptance criteria.**

- `trace.out` exists and `go tool trace` opens it in a browser without errors.
- You can identify at least three event types in the trace and name the runtime source location that emits each.
- You can answer: "Why does the runtime tracer have so many event types?" — to enable post-hoc analysis of *every* scheduler event without re-running the program. The trace is dense (~30 event types) but precise; tools like `gotrace` and `pprof -trace` consume it to produce flame graphs, blocking profiles, and STW analyses.

<details><summary>Reference walkthrough</summary>

A typical trace from the program above looks like:

```
Time     P    Event           G      Stack
0.000ms  0    ProcStart       0
0.001ms  0    GoStart         1      main.main
0.002ms  0    HeapAlloc       1      runtime.makechan
0.003ms  0    GoCreate        2      main.main:13   (creates G2 running main.main.func1)
0.004ms  0    GoStart         2      main.main.func1
0.005ms  0    GoBlockSend     2      main.main.func1:15  (ch <- 42 blocks; G2 parks)
0.006ms  0    GoUnblock       1      runtime.chansend  (receiver wakes sender? — actually here G1 was running, G2 parked, then G1 ran <-ch and unblocked G2)
0.007ms  0    GoStart         2      runtime.gopark  (G2 resumed)
0.008ms  0    GoEnd           2
0.009ms  0    GoEnd           1
```

(The exact event order varies — your trace will look slightly different. The key shapes are GoCreate → GoStart on the new G, GoBlockSend on the sender, GoUnblock when the receiver consumes, GoStart again to resume.)

Where each event is emitted, in Go 1.22:

- `GoCreate`: `runtime/proc.go::newproc1` near the end, just before returning the new `g`:
  ```go
  if trace.enabled { traceGoCreate(newg, newg.startpc) }
  ```
  This logs the new goroutine's id, its start PC, and the creator's stack.

- `GoStart`: `runtime/proc.go::execute`, the function that actually runs a goroutine:
  ```go
  func execute(gp *g, inheritTime bool) {
      ...
      if trace.enabled { traceGoStart() }
      gogo(&gp.sched)
  }
  ```

- `GoBlockSend`: emitted from inside `chansend` via the `gopark` reason. Look for:
  ```go
  // runtime/chan.go::chansend (abridged):
  gopark(chanparkcommit, unsafe.Pointer(&c.lock), waitReasonChanSend, traceBlockChan, 2)
  ```
  The `traceBlockChan` is the trace-tag; the tracer reads it from `m.waitTraceBlockReason` and writes a `GoBlock` event with that reason. Various subreasons (`GoBlockSend`, `GoBlockRecv`, `GoBlockSelect`) are derived by post-processing in `go tool trace`.

The trace file format itself is documented (loosely) in `runtime/trace/trace.go` and `runtime/traceback.go`. It's a binary stream of events; each event is a tag byte plus per-tag arguments. Events include timestamps (since trace start, monotonic), stack-trace indices (interned), and event-specific fields.

What `go tool trace` does with the file:

1. Parses the binary stream into a list of events.
2. Groups events by goroutine, P, and time window.
3. Renders timelines using the Chromium tracing format internally.
4. Computes summaries: blocking profile (which call sites blocked the most), GC analysis, scheduler latency.

Useful sub-pages of `go tool trace`:

- **Goroutine analysis**: per-goroutine wall time, scheduling latency, IO/sync wait.
- **User-defined regions**: if you use `trace.WithRegion(ctx, "name", fn)`, regions show up here.
- **Network blocking profile**: how long did the program spend blocked in netpoll?
- **Synchronization blocking profile**: how long blocked in channel ops, sync.Mutex, semaphores?
- **Scheduler latency profile**: time between `GoUnblock` and `GoStart` — a measure of how long runnable goroutines wait for a P.

Senior gut-check: `go tool trace` is the highest-resolution tool you have for understanding scheduler behaviour. If pprof says "your program is spending 30% of wall time blocking on channels" but you can't tell *which* channels or *why*, the trace will. The cost is large trace files (10MB/s of program activity is normal) and a long load time in the browser; use short program runs (<5 seconds) for the cleanest data.

</details>

---

## Task 18 — Read `mcall` assembly (Staff)

**Goal.** Open `runtime/asm_amd64.s::runtime·mcall` and explain the stack switch line by line.

**Starter.**

```bash
grep -n "^TEXT runtime·mcall" "$(go env GOROOT)/src/runtime/asm_amd64.s"
```

**Instructions.**

1. Open `asm_amd64.s`. Locate `TEXT runtime·mcall(SB)`. It's short — ~20 instructions.
2. The function signature in Go: `func mcall(fn func(*g))`. Calling convention: `fn` is passed in `AX` (register ABI since Go 1.17).
3. Read the assembly. The flow is:
   - Save the caller's `PC` and `SP` into the calling `g`'s `g.sched`.
   - Switch SP to `g0.sched.sp` (the system stack).
   - Set `g_register` (R14) to point at `g0`.
   - Call `fn(callergp)` — the callback runs on g0's stack with the caller's g pointer as argument.
   - The callback typically doesn't return; it calls `schedule()` or `goexit`. If it does return (uncommon), control resumes here and we restore.
4. Match each instruction to a step. Annotate:
   ```
   MOVQ    fn+0(FP), DI     // save fn pointer
   MOVQ    g_m(R14), BX     // m = g.m
   MOVQ    m_g0(BX), SI     // g0 = m.g0
   CMPQ    SI, R14          // current g == g0?
   JEQ     bad              // panic if so — mcall on g0 makes no sense
   MOVQ    SP, (g_sched+gobuf_sp)(R14)  // save caller's SP into g.sched.sp
   MOVQ    PC, (g_sched+gobuf_pc)(R14)  // save caller's PC
   ...
   MOVQ    SI, R14          // switch g register to g0
   MOVQ    (g_sched+gobuf_sp)(SI), SP   // switch SP to g0's stack
   ...
   CALL    DI               // call fn — runs on g0
   ```
5. The "switch g" step is the magic: changing R14 changes what `getg()` returns to subsequent code. The runtime never holds a g pointer in a Go-visible variable; everywhere uses `getg()` which compiles to a single load from R14.
6. The "switch SP" step is the actual stack swap. Once SP points into `g0.stack`, the call to `DI` (the fn argument) operates entirely on g0's stack; the caller's stack is untouched.

**Acceptance criteria.**

- You can name the register-ABI calling convention: arguments come in `AX, BX, CX, DI, SI, R8, R9, R10, R11` (in order, integer types).
- You can name `R14` as the dedicated `g` register on amd64.
- You can explain the three writes that constitute a context switch: save caller's SP and PC into `g.sched`, switch R14 to `g0`, load `g0.sched.sp` into SP.
- You can answer: "Why must `mcall` panic if called from g0?" — because mcall switches *to* g0; if you're already on g0, the operation is meaningless and likely a bug.

<details><summary>Reference walkthrough</summary>

The full Go 1.22 `mcall` on amd64 (formatted; comments added):

```asm
// func mcall(fn func(*g))
// Switch to m->g0's stack, call fn(g).
// Fn must never return. It should gogo(&g->sched) to continue running g.
TEXT runtime·mcall<ABIInternal>(SB), NOSPLIT, $0-8
    MOVQ    AX, DX          // DX = fn (move from arg register AX to scratch DX)

    // Save state in g->sched. The state in this case is the resume PC and SP
    // for the calling g — when the runtime eventually calls gogo(&g.sched)
    // again, it'll come back here.
    MOVQ    0(SP), BX       // BX = caller's PC (top of stack at function entry)
    MOVQ    BX, (g_sched+gobuf_pc)(R14)  // g.sched.pc = caller's PC
    LEAQ    fn+0(FP), BX    // BX = caller's SP just above this frame
    MOVQ    BX, (g_sched+gobuf_sp)(R14)  // g.sched.sp = that SP
    MOVQ    BP, (g_sched+gobuf_bp)(R14)  // g.sched.bp = frame pointer

    // Switch to m->g0 and its stack, call fn.
    MOVQ    R14, AX         // AX = g (to be passed as fn's argument)
    MOVQ    g_m(R14), BX    // BX = g.m
    MOVQ    m_g0(BX), SI    // SI = m.g0
    CMPQ    SI, R14         // are we already on g0?
    JNE     goodm           // no, proceed
    JMP     runtime·badmcall(SB)  // yes — bug
goodm:
    MOVQ    SI, R14         // g = g0   (switch the g register)
    MOVQ    (g_sched+gobuf_sp)(SI), SP  // SP = g0.sched.sp  (switch stack)

    // We're now on g0. Push the original g as an argument and call fn.
    PUSHQ   AX              // push g (the user goroutine pointer)
    MOVQ    DX, AX          // AX = fn (the ABI register)
    MOVQ    0(DX), DX       // DX = fn's actual code address (funcval indirection)
    CALL    DX
    POPQ    AX

    JMP     runtime·badmcall2(SB)  // fn returned — bug; fn should never return
    RET
```

Step-by-step walk through what happens when a goroutine `gp` running on thread `m` calls `mcall(park_m)` (the typical case):

1. **Entry**. We're executing on `gp`'s stack. R14 points at `gp`. SP is somewhere in `gp.stack.lo..gp.stack.hi`.
2. **Argument move**: `MOVQ AX, DX`. The fn `park_m` is in AX (per register ABI); we move it to DX so AX is free for the next argument.
3. **Save PC**: read the return address off the top of the stack (`MOVQ 0(SP), BX`), write to `gp.sched.pc`. Now if anyone later resumes `gp` via `gogo(&gp.sched)`, execution will resume at this PC.
4. **Save SP**: compute the caller's SP (`LEAQ fn+0(FP), BX`) and write to `gp.sched.sp`. The `fn+0(FP)` is the address of the function's first argument — i.e., one slot above the saved return PC — which is the caller's SP at the moment of CALL.
5. **Save BP**: frame pointer to `gp.sched.bp`. Used to walk the stack later for tracebacks.
6. **Pass gp as fn's arg**: `MOVQ R14, AX`. AX now holds the user goroutine pointer. `park_m`'s signature is `func(gp *g)`; this is how the argument arrives.
7. **Fetch g0**: `MOVQ g_m(R14), BX; MOVQ m_g0(BX), SI`. SI now holds the `g0` for this M.
8. **Sanity check**: if R14 == SI we're already on g0 — abort.
9. **Switch g register**: `MOVQ SI, R14`. From this instruction onwards, `getg()` returns g0. Note: nothing has actually moved yet — we just changed which g pointer is in the register.
10. **Switch stack**: `MOVQ (g_sched+gobuf_sp)(SI), SP`. NOW we're on g0's stack. The previous SP (pointing into gp's stack) is overwritten in the SP register.
11. **Call fn**: push the saved gp argument, call park_m via the funcval pointer. park_m runs on g0's stack; it can do scheduler operations (allocate new stacks, manipulate run queues) that would be unsafe on a user goroutine's stack.
12. **park_m does its thing**: marks gp as `_Gwaiting`, calls schedule() to pick the next g, calls `gogo(&newg.sched)` to jump into the next goroutine. *park_m does not return* — `gogo` is a jump, not a call.
13. **(If park_m did return — bug)**: `JMP runtime·badmcall2(SB)` panics.

Why this is so spare: every instruction matters. `mcall` is called on every goroutine block — channel block, mutex contention, time.Sleep, network IO, GC pause. If `mcall` is slow, the whole system is slow. The hand-written assembly avoids any frame setup, any prologue stack check (note `NOSPLIT`), any allocation.

Why the funcval indirection (`MOVQ 0(DX), DX`): in Go, a `func` value is *not* a code pointer — it's a pointer to a `funcval` struct whose first field is the code pointer (and remaining fields are captures, if any). For closures with captures, the captures are at offsets `8, 16, ...` from the funcval base. `mcall`'s `fn` is `func(*g)` with no captures, so only the code pointer matters; `0(DX)` fetches it.

The dance is the same on arm64 (`mcall` in `asm_arm64.s`) but with different register names (X28 for g, X0 for AX, etc.) and ARM's load-store instruction set. The structure is identical.

Senior reading tip: every time you see a runtime function call `mcall(somefn)`, you know two things — (a) `somefn` runs on g0 with the caller's g as argument, (b) `somefn` typically does not return. Examples: `mcall(park_m)`, `mcall(goexit0)`, `mcall(gopreempt_m)`. Each is a scheduler operation that transfers control to a different goroutine; the user g resumes via a future `gogo(&g.sched)` triggered by some external event.

</details>

---

## Task 19 — Cross-reference a runtime issue (Staff)

**Goal.** Find a closed issue on `golang/go` labeled `runtime`, read both the fix commit and the regression test, and explain the bug.

**Starter.**

```bash
# Browse closed runtime issues:
# https://github.com/golang/go/issues?q=is%3Aissue+is%3Aclosed+label%3Aruntime+sort%3Aupdated-desc
# Pick one with a "Fixes" commit link.
```

**Instructions.**

1. Open the GitHub URL above. Filter by `label:runtime` and `is:closed`. Sort by recently updated to find well-discussed bugs.
2. Pick an issue that meets all three criteria:
   - Has a clear reproducer (small program).
   - Has a linked fix commit (look for "Fixed by abcd123" or "Closes #N" in commits).
   - Has a regression test (the fix commit usually adds a test file or function).
3. Read in this order:
   - **Issue description**: the symptom. What did the user observe? What was the expected behaviour?
   - **Discussion**: who diagnosed it? What was the root cause hypothesis?
   - **Fix commit diff**: what code changed? Often a one-line fix in a sea of context.
   - **Regression test**: how was the bug caught permanently? Often the test triggers the original symptom and asserts it no longer happens.
4. Recommended candidates (browse to verify links still work):
   - Issue #45886: "runtime: deadlock when calling time.Sleep" — race between timer subsystem and goroutine creation.
   - Issue #50865: "runtime: scheduler can leak threads" — a path where `findRunnable` could leave an `m` spinning indefinitely.
   - Issue #57069: "runtime: scanstack panics with bad g status" — scan/preempt race.
   - (Older but classic) Issue #14406: "runtime: handle non-Go signals on signal stack" — long-standing platform bug.
5. Write a 200-word summary of your chosen issue:
   - One paragraph on the symptom and reproducer.
   - One paragraph on the root cause.
   - One paragraph on the fix and how the regression test exercises it.

**Acceptance criteria.**

- You have a written summary of a specific runtime bug with issue number, commit SHA, and source file paths.
- You can name the fix file and at least one line that changed.
- You can describe the regression test in one sentence (what it does, what it asserts).
- You can identify the bug class: race condition, memory ordering, signal handling, scheduler invariant violation, etc.

<details><summary>Reference walkthrough</summary>

Worked example: issue #57069 (illustrative — verify the specifics on github before citing).

**Symptom.** Users observed sporadic crashes with `runtime: g 12345 in unexpected status 9` during high-throughput services. Reproducer: a benchmark that creates many short-lived goroutines while a `runtime.GC()` is being driven from a separate goroutine. Frequency: roughly 1 in 10⁶ goroutine creations under load.

**Discussion.** Initial reports suspected a hardware bug due to rarity. After several reports across architectures, the maintainers ran a stress test with `GODEBUG=schedtrace=1,gctrace=1` and observed the bad `_Gscan*` status was being read while a separate goroutine was attempting to transition the same g out of `_Gscanwaiting`.

**Root cause.** Race in `casgstatus` (in `runtime/proc.go`): when a goroutine is transitioning from `_Grunning` to `_Gwaiting`, the scanner might concurrently observe the transitional `_Gscanrunning` state and attempt a CAS to `_Gscanwaiting`. Both CASes can technically succeed in interleaved order, leaving the status field inconsistent.

**Fix.** A two-line change in `casgstatus` adding an explicit ordering between the user-side transition and the scanner-side transition: the scanner must observe the user's _G* state *before* attempting its _Gscan* CAS. The fix changes the order of two atomic operations to enforce this.

**Regression test.** A new test in `runtime/proc_test.go` that spawns 10,000 goroutines while calling `runtime.GC()` 1000 times concurrently; asserts no `throw` occurs and all goroutines terminate. The test is `t.Parallel`-safe and runs in <1s on CI.

**Files changed:**
- `src/runtime/proc.go`: 4 lines added, 2 deleted in `casgstatus`.
- `src/runtime/proc_test.go`: 40 lines added (`TestGCRaceCasgstatus`).

**Commit SHA**: would be e.g. `abc1234567...`. The full diff is small enough to read in five minutes; the regression test is the hardest part to write because reproducing 1-in-million race conditions is notoriously hard.

Why staff-level: understanding *why* the original code was wrong requires you to think about Go's memory model, atomic ordering, and the runtime's invariants (the `_Gscan*` states are deliberately a bitmask overlay on top of the base `_G*` states — this is the source of subtlety). A staff engineer recognises the bug class on first read; a senior follows the analysis on second; a middle engineer learns the pattern.

How to find good issues to read:

- The "Old issues closed by recent commits" view on github: `is:issue is:closed label:runtime closed:>2023-01-01`.
- `git log --all -- src/runtime` in a `golang/go` checkout, then `git show <sha>` for any commit message that includes "Fixes #N" or "Closes #N".
- The Go release notes' "Runtime" section calls out major fixes; each one usually has an issue number.

Senior gut-check: if you can read a complex runtime fix commit and predict where the regression test will go (file, function name, test technique), you've internalised the runtime team's discipline. If not, that's the skill to build — *every* runtime fix in golang/go is accompanied by a regression test, and reading them is the fastest way to absorb their style.

</details>

---

## Task 20 — Diff `schedule` between Go 1.14 and Go 1.22 (Staff)

**Goal.** Compare `runtime/proc.go::schedule` between Go 1.14 (the asynchronous preemption release) and Go 1.22, pick the single most impactful change, and write a 200-word explanation.

**Starter.**

```bash
# Get both versions:
# https://raw.githubusercontent.com/golang/go/release-branch.go1.14/src/runtime/proc.go
# https://raw.githubusercontent.com/golang/go/release-branch.go1.22/src/runtime/proc.go
```

**Instructions.**

1. Fetch both files:
   - `curl -fsSL https://raw.githubusercontent.com/golang/go/release-branch.go1.14/src/runtime/proc.go -o proc-1.14.go`
   - `curl -fsSL https://raw.githubusercontent.com/golang/go/release-branch.go1.22/src/runtime/proc.go -o proc-1.22.go`
2. Extract just the `schedule` function from each (use a Go-aware grep or just open in an editor and copy). It's ~100 lines in 1.14, ~150 in 1.22.
3. Look for these categories of change:
   - **Network polling integration**: 1.20+ added per-P netpoll polling steps; 1.14 still ran netpoll only from the netpoll thread.
   - **Timer integration**: 1.14 had global timers; 1.20+ has per-P timer heaps, and `schedule` checks them.
   - **Spinning M accounting**: how `nmspinning` is decremented changed across releases; affects load balancing.
   - **Preemption hooks**: 1.14 added safe-point preemption; later releases tuned the placement.
   - **GC integration**: GC assists, mark-worker scheduling — each release tweaks the placement of these checks.
4. Pick the change with the biggest *behaviour* impact (not just code reorg). Candidates:
   - **Per-P timer checks in `findRunnable` / `schedule`**: changed scheduler from "occasionally checks timers" to "every P checks its timers on every scheduling pass". Reduced timer-firing latency from milliseconds to microseconds for hot programs.
   - **Network poller embedded in scheduler**: previously a dedicated netpoll thread; now any P can drive netpoll. Improved tail latency for network-heavy workloads.
   - **`stealWorkFromGCWorkers`**: added a path to steal GC mark workers when no user work is available.
5. Write 200 words on your chosen change:
   - The old behaviour (specific code reference in 1.14).
   - The new behaviour (specific code reference in 1.22).
   - The motivating workload — what kind of program benefits?
   - The trade-off — what regressed (if anything) for what other workload?
   - The CL or issue number, if you can find it.

**Acceptance criteria.**

- You have a 200-word write-up identifying a specific scheduler change with file/line references in both Go 1.14 and Go 1.22.
- You can articulate the workload that motivated the change.
- You can articulate a potential regression: every scheduler change has a downside; identifying it shows you understand the trade-off.

<details><summary>Reference walkthrough</summary>

Worked example: the integration of per-P timer checks into `findRunnable` (and indirectly into the body of `schedule`'s loop).

**Old behaviour (Go 1.14).** Timers lived in a per-P heap (this had landed in 1.14 itself; pre-1.14 it was global). However, `schedule` did not call `checkTimers` in the hot path. Instead, the timer-check happened in a few places: the sysmon thread polled timers every 10ms, the netpoller did so when waiting for events, and `runtime.Gosched` would prompt a check. The consequence was that a timer firing at, say, `now + 1µs` might wait up to several milliseconds before being processed if the P was busy or sleeping — even with a per-P heap.

**New behaviour (Go 1.22).** `findRunnable` now includes `checkTimers(pp, now)` as one of its first steps before trying the local runqueue:

```go
func findRunnable() (gp *g, inheritTime, tryWakeP bool) {
    mp := getg().m
    ...
top:
    pp := mp.p.ptr()
    ...
    if pp.runSafePointFn != 0 { runSafePointFn() }

    // Now also check for timer creation or expiry concurrently with
    // transitioning from spinning to non-spinning.
    now, pollUntil, _ := checkTimers(pp, 0)
    ...
    // local runq, global runq, netpoll, work-steal ...
}
```

`checkTimers` walks the local timer heap, fires any expired timers (which calls `goready` on waiters), and returns `pollUntil` (the next timer's deadline) which is later used by the netpoll wait to time out at the right moment.

**Motivating workload.** Latency-sensitive servers using `context.WithTimeout` heavily. Pre-1.14, every request had a `context.WithTimeout` adding to the global timer heap, with `sched.lock` contention as a bottleneck. Post-1.14 (per-P), the locks were eliminated but the *check frequency* still varied. Post-1.22, the check happens every scheduling decision, which is at least microseconds-frequent under load.

**Trade-off.** The cost is a small constant overhead added to `findRunnable`'s hot path: heap-peek is O(1) but still a memory load. On programs that don't use timers, this is dead work — measured at ~1% scheduler overhead. Benchmarks showed it was worth paying universally because timers are pervasive in modern Go programs (every HTTP handler with a deadline, every `time.After` in a select).

**Reference**: CL 219799 ("runtime: improve timer poll scalability") is the seminal commit; subsequent CLs (around the 1.20-1.22 window) refined the placement. The change made `time.After` scalable enough that the longstanding advice "avoid time.After in hot loops" became less urgent — though `time.NewTimer` + manual `Stop` is still the recommended pattern for very high QPS.

**Why this is staff-level.** Understanding the change requires holding three things in your head simultaneously: (a) the per-P timer heap, (b) the netpoll's interaction with timer deadlines for sleep durations, (c) the spinning-M accounting that's adjacent in the schedule loop. A staff engineer reads the diff and immediately sees how the three interact; a senior engineer needs to read the surrounding comments and CL discussion to catch the interaction.

How to write the 200-word summary effectively:

- Lead with the workload: "Latency-sensitive servers with millions of context.WithTimeouts per second"
- Quote one line from old code, one from new.
- Name the CL number if possible.
- Name the trade-off in one sentence: "1% added scheduler overhead for programs without timers, justified by the elimination of timer-firing latency tail."
- Don't include code beyond two snippets; this is prose, not a code dump.

Other equally valid choices for the diff to focus on:

- **Spinning-M decrement ordering (CL 310850 area)**: changed how `nmspinning` is decremented relative to finding work; eliminated a race where a g could be left behind on a P with no spinning waker.
- **`stealWorkFromGCWorkers`**: when no user goroutines are runnable, a P can steal a GC mark worker. Improved GC throughput on imbalanced workloads where some Ps had user work and others had GC work.
- **Direct netpoll in scheduler (CL 359976)**: integrated `netpoll(0)` (non-blocking poll) into `findRunnable`'s steal loop so any P can opportunistically check for IO. Reduced tail latency for IO-bound services.

Each is a 200-word write-up of substance; pick the one you find most interesting after reading the diffs.

Senior gut-check: doing this exercise twice a year — once per major Go release — keeps you current with runtime evolution without having to read the full release notes. The diff plus the CLs are usually more useful than the release notes because they show what was *considered* and *rejected* along with what landed.

</details>

---

## How to grade yourself

Score each task `0` (didn't try), `1` (read with hints), `2` (read unaided and can recall), `3` (read AND wrote notes a colleague could use to find the same code). Sum:

| Score | What it means |
|-------|---------------|
| 0–15  | You haven't built the navigation reflex yet. Redo Tasks 1–4. The four-line answer to "where does chan send live? what does GOMAXPROCS write to? what's gopark's signature?" should be instant. |
| 16–30 | You can find specific symbols and read their bodies. Tasks 5–10 take you from "can find" to "can trace across boundaries" (user code → assembly → runtime → assembly). |
| 31–45 | You can use the full toolbox: dlv, trace, objdump, source diffs. Tasks 11–17. The skill jump here is "I have hypotheses about behaviour and I verify them against running binaries". |
| 46–60 | Staff-level reading. Tasks 18–20 are about cross-referencing — assembly + Go source + git history + issue tracker — and producing a written analysis. If you can do all three well, you can also be the person who reviews someone else's runtime patch. |

The core skill this module builds is *taxonomy*. For any runtime question you can imagine — "how does Go pick which goroutine runs next?", "what happens when a channel buffer overflows?", "why is my GC pause 10ms instead of 1ms?" — you should be able to (a) name the file likely to hold the answer, (b) name the function within that file, (c) name the type of investigation (read source, run dlv, capture trace) most likely to confirm or refute your hypothesis. The taxonomy is durable; the line numbers are not.

Concrete verification before declaring this module done:

- You can write three runtime symbol names on a whiteboard from memory: `chansend1`, `gopark`, `selectgo`. If those are not yet reflex, redo Tasks 5, 6, 15.
- You can describe the per-P runqueue layout (runnext, 256-slot ring, global) without referring back to Task 9.
- You can name three GC-related files (`mgcmark.go`, `mfinal.go`, `mgcpacer.go`) and what each handles.
- You can recall the difference between FIFO and LIFO semaphore acquire (Task 14) and the workload that motivates each.

---

## Stretch challenges

**S1 — Custom runtime trace consumer.** Write a Go program that reads a `trace.out` file (the binary format produced by `runtime/trace.Start`) and produces per-goroutine timelines as ASCII art (one line per goroutine, characters representing running/blocked/runnable). The trace parser exists at `internal/trace` (publicised as `golang.org/x/exp/trace` in newer releases). Constraint: process a 100MB trace in under 10 seconds. The exercise is to learn the trace event vocabulary by parsing it yourself rather than relying on `go tool trace`.

**S2 — Runtime instrumentation harness.** Write a tool that, given a Go program, instruments specific runtime functions (e.g. `chansend`, `gopark`, `schedule`) by injecting trace-style events via `runtime/trace.Log` from a patched runtime copy. Run a small program under the harness and produce a custom trace showing per-call latency distributions for the chosen runtime functions. Constraint: do not modify the program source — the instrumentation goes in the runtime layer the program already links against. The lesson is understanding `GOFLAGS=-toolexec`, custom `GOROOT_LOCAL`, and how to ship a modified runtime to production for debugging.

**S3 — Cross-release behaviour regression detector.** Build a benchmark suite that runs the same N microbenchmarks under both `go1.20`, `go1.22`, and `tip`, captures `runtime.MemStats` + `go test -bench` + `go tool trace` for each, and produces a diff report highlighting regressions and improvements with statistical confidence. Constraint: the report should call out one specific runtime change (per the diff approach in Task 20) for each significant delta and link to the relevant CL. The skill is connecting micro-benchmark deltas to specific runtime evolution — the inverse of Task 20's exercise.
