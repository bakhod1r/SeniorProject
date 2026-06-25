# Stack Management & Unwinding — Interview Questions

> **Topic:** [Stack Management & Unwinding](README.md)
> **Focus:** Frames, calling conventions, unwind tables (DWARF CFI / Win64), exception unwinding, growable stacks (Go), JVM frames — questions graded from "explain the concept" to "design the runtime."

---

## Introduction

This file is a bank of interview questions on stack management and unwinding, written as flat `## Question N` entries so you can quiz yourself or be quizzed. Each question has a crisp model answer at the depth a senior systems/runtime engineer is expected to give. Questions are grouped into four bands: **Conceptual** (the mechanics everyone should know), **Platform-Specific** (x86-64 SysV / Win64 frames, DWARF CFI, Go growable stacks, JVM frames), **Tricky / Trap** (where confident-sounding answers are wrong), and **Design** (open-ended runtime/tooling design).

Treat the model answers as a *floor*, not a script. The strongest candidates connect mechanisms: "no frame pointer → unwinding is a table lookup → that table is `.eh_frame` → which also drives exceptions → which is why stripping it breaks both crash reports and `throw`."

## Table of Contents

- [Conceptual](#conceptual)
- [Platform-Specific](#platform-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**Q: What is a stack frame, and what does one contain?**

A stack frame (activation record) is the slice of the call stack belonging to one live function call. It contains, broadly: the **return address** (pushed by `call`), often a **saved frame pointer** (the caller's FP, forming a walkable chain), **local variables** and **spilled registers**, saved **callee-saved registers** the function clobbers, and space for **outgoing arguments** that don't fit in registers. Its exact layout is dictated by the platform's calling convention. The frame is created by the function prologue and destroyed by the epilogue; on return, the whole thing is freed by resetting the stack pointer.

## Question 2

**Q: Explain what happens, at the machine level, when one function calls another and returns.**

The caller places arguments (in registers per the ABI, or on the stack), then executes `call foo`, which atomically pushes the return address (the instruction after the `call`) and jumps to `foo`. `foo`'s **prologue** runs: optionally `push rbp; mov rbp, rsp` to establish a frame pointer, then `sub rsp, N` to reserve locals, and saves any callee-saved registers it will use. The body runs. The **epilogue** restores callee-saved registers, tears down the frame (`mov rsp, rbp; pop rbp` or `add rsp, N`), and `ret` pops the return address into the program counter, resuming the caller.

## Question 3

**Q: What is the difference between the stack pointer and the frame pointer?**

The **stack pointer** (`rsp` on x86-64) always points at the top (lowest address) of the stack and moves constantly as the function pushes/pops. The **frame pointer** (`rbp`), when used, points at a fixed location in the current frame so locals have stable addresses (`[rbp-8]`) even while `rsp` moves. The frame pointer also chains frames into a linked list (each saved FP points at the previous one), which is what makes naive stack walking possible. The stack pointer is mandatory; the frame pointer is a convention the compiler can omit.

## Question 4

**Q: Which direction does the stack grow, and why does it matter?**

On essentially all mainstream architectures (x86-64, ARM64) the stack grows toward **lower** addresses: `push` decrements `rsp`. It matters because (a) the guard page for overflow detection is placed *below* the stack, (b) offsets to locals from the frame pointer are typically *negative* (`[rbp-8]`), and (c) it lets the stack and heap grow toward each other from opposite ends of the address space (a historical layout reason).

## Question 5

**Q: What is a calling convention, and name three things it specifies.**

A calling convention (part of the ABI) is the binary contract between caller and callee. It specifies: (1) which registers carry arguments and the return value; (2) which registers are **caller-saved** (callee may clobber) vs **callee-saved** (callee must preserve); (3) stack alignment requirements at a call; plus where the return address goes and how stack arguments are laid out. It's why separately-compiled code — even from different compilers — can interoperate.

## Question 6

**Q: What is the difference between caller-saved and callee-saved registers?**

**Callee-saved (non-volatile)** registers must be preserved across a call: if the callee uses one, it saves and restores it. **Caller-saved (volatile)** registers may be freely clobbered by the callee, so if the caller has a live value in one across a call, the caller must save it. The split is a performance optimization: leaf functions can use volatile registers with zero save/restore overhead, and only callee-saved registers cost a push/pop when needed.

## Question 7

**Q: What is stack unwinding?**

Stack unwinding is the process of removing frames from the stack and restoring the machine state (registers, stack pointer) to that of an earlier frame. It's used in two contexts: (1) **walking** the stack to *read* it — backtraces, profilers, GC root scanning — without changing it; and (2) **exception unwinding**, which actually removes frames while running cleanup code (destructors / `finally` / landing pads) on the way out. Both rely on knowing, for each frame, where the return address and saved registers are.

## Question 8

**Q: How does a debugger produce a backtrace?**

It starts at the current PC and SP/FP, identifies the current function, and steps outward frame by frame. With frame pointers, it follows the FP chain: read the return address next to each saved FP. Without frame pointers (optimized/FPO code), it consults **unwind tables** (DWARF CFI in `.eh_frame`/`.debug_frame`) to compute, at the current PC, the CFA, the return address location, and the restored registers — then repeats. It symbolizes each return address to a function name and source line using debug info.

## Question 9

**Q: What is a stack overflow, mechanically?**

The stack has a bounded size with a **guard page** (inaccessible) just past its end. When the stack grows (deep recursion, a huge local) into the guard page, the CPU raises a page fault → `SIGSEGV` (Linux) / access violation (Windows). A managed runtime that controls the stack (Go, JVM) detects the limit explicitly and reports a clean "stack overflow"; native C just dies with a segfault. A large enough single allocation can *skip over* a one-page guard, causing silent corruption — which is why compilers emit stack probes.

## Question 10

**Q: Why is frame-pointer omission an optimization, and what does it cost?**

`rbp` is a usable general-purpose register; if the compiler can address all locals relative to `rsp`, it can free `rbp` for computation and skip the `push rbp/pop rbp` prologue/epilogue instructions (`-fomit-frame-pointer`, default at `-O1`+). The benefit is one more register and slightly faster/smaller code (~1%). The cost: the FP chain that naive stack walkers rely on is gone, so backtraces and profiling now require unwind tables (DWARF) or hardware (LBR) — which are more expensive and, in signal handlers, fragile.

## Question 11

**Q: What does tail-call elimination do to the stack?**

A tail call (a call in return position) reuses the current frame instead of pushing a new one — the callee returns directly to *our* caller. This makes tail recursion run in O(1) stack space (mandatory in Scheme, available via `musttail` in LLVM, in WebAssembly's tail-call proposal, etc.). Consequence for unwinding: the eliminated frame is genuinely absent from the stack, so it correctly does *not* appear in backtraces — which can confuse debugging ("where did my caller go?").

---

## Platform-Specific

## Question 12

**Q: Describe a System V AMD64 stack frame and its argument-passing rules.**

SysV (Linux/macOS) passes the first 6 integer/pointer args in `rdi, rsi, rdx, rcx, r8, r9`, the first 8 FP args in `xmm0–xmm7`, and the rest on the stack; returns in `rax`/`xmm0`. Callee-saved: `rbx, rbp, r12–r15`. At a `call`, `rsp` must be 16-byte aligned. A typical frame (top to bottom): stack args, return address, saved `rbp`, saved callee-saved registers, locals/spills, outgoing-arg/alignment padding. There's also the **red zone** — 128 bytes below `rsp` usable by leaf functions without adjusting `rsp`.

## Question 13

**Q: What is the SysV red zone, and when is it unsafe?**

The red zone is the 128 bytes immediately below `rsp` that a **leaf function** may use for locals without subtracting from `rsp`, saving two instructions. It's safe only because nothing will overwrite that region during the leaf's execution — no `call` pushes over it, and the kernel ensures signal handlers don't land there. It's **unsafe** in code that runs other things on the same stack below `rsp`: signal/interrupt handlers, hand-written async code, and kernel code (which is built with `-mno-red-zone`).

## Question 14

**Q: How does the Windows x64 convention differ, and what is shadow space?**

Win64 passes the first 4 args in `rcx, rdx, r8, r9` (or `xmm0–xmm3`) **by position**, the rest on the stack; returns in `rax`/`xmm0`. There is **no red zone**. Instead, the *caller* must reserve **32 bytes of shadow space** (home space) before the return address — room for the callee to spill its 4 register arguments. Win64 also requires structured prologues (all stack allocation and register saves up front) so the OS unwinder can interpret `.pdata`/`.xdata`. Forgetting shadow space in hand-written asm corrupts the caller's stack.

## Question 15

**Q: What is DWARF Call Frame Information, and where does it live?**

DWARF CFI is a bytecode-like table describing, for each instruction address in each function, how to compute the **CFA** (canonical frame address), where the return address is, and how to restore each callee-saved register. It lives in `.eh_frame` (used by the *runtime* unwinder — kept even in stripped binaries because exceptions need it) and/or `.debug_frame` (for debuggers — strippable). It's organized as **CIE** (shared settings) + **FDE** (per-function unwind program of `DW_CFA_*` opcodes). It's what lets unwinding work without frame pointers.

## Question 16

**Q: What is the CFA and why is it the anchor for unwinding?**

The **Canonical Frame Address** is a stable per-frame reference — conceptually the value of `rsp` at the moment just before the `call` that entered this function. Everything in the unwind table is expressed relative to it: "return address at CFA−8," "`rbx` saved at CFA−24." It's used because `rsp` moves throughout the function and `rbp` may not exist, but the CFA is a fixed point the table can define (e.g. "CFA = current `rsp` + 40 here"). Stepping a frame means computing the CFA, reading the return address from it, restoring registers, then setting `rsp` = CFA and PC = return address.

## Question 17

**Q: How does Windows x64 unwinding (`.pdata`/`.xdata`) differ from DWARF CFI?**

Windows is more structured and less general. Each non-leaf function has a `RUNTIME_FUNCTION` in `.pdata` pointing to `UNWIND_INFO` in `.xdata`, which lists **unwind codes** (`UWOP_PUSH_NONVOL`, `UWOP_ALLOC_SMALL`, `UWOP_SET_FPREG`, …) describing exactly what the prologue did. To unwind, `RtlVirtualUnwind` **replays the prologue in reverse**. Because Windows mandates strict prologue rules (no interleaving of allocation and computation), this is simpler and faster to interpret than general DWARF, at the cost of flexibility. DWARF is a general per-PC state machine; Win64 is a structured prologue description.

## Question 18

**Q: Explain how Go's growable goroutine stacks work and why Go moved away from segmented stacks.**

Goroutines start with a tiny stack (~2–8 KB) so millions can exist. When a function prologue (`runtime.morestack`) detects the stack is nearly full, the runtime **allocates a contiguous block twice as large, copies the entire stack into it, relocates every pointer that points into the stack, frees the old block, and continues**. Go originally used **segmented stacks** (allocate a new linked chunk on growth) but abandoned them because of the **hot-split** problem: a call straddling a segment boundary inside a hot loop would allocate and free a segment every iteration — an unpredictable performance cliff. Copying stacks have no boundary to thrash and give amortized O(1) growth. Copying is only possible because Go has precise **stack maps** identifying which slots hold pointers (tied to escape analysis).

## Question 19

**Q: Why does Go require escape analysis to make stack copying work?**

Because when the stack moves, the runtime must rewrite every pointer that points into it. That's only possible if the *set* of stack-internal pointers is statically known — which requires precise stack maps. Escape analysis decides, at compile time, whether a value can safely live on the (movable) stack or must be heap-allocated. If a stack value's address could be stored somewhere the runtime can't track (e.g. handed to C, or shared across goroutines in an opaque way), it **escapes to the heap** so the runtime never has to relocate an untracked pointer. Stack copying and escape analysis are two sides of the same design.

## Question 20

**Q: Describe a JVM stack frame and how it differs from a native frame.**

Each JVM thread has a stack of frames, one per method call. A JVM frame contains the **operand stack** (a small evaluation stack for bytecode operations), the **local variable array** (parameters + locals, indexed slots), and a reference to the **runtime constant pool** of the method's class. Unlike a native frame, the layout is defined by the JVM spec in abstract terms, not by hardware registers — the *interpreter* manipulates the operand stack, while the **JIT** compiles methods to native code with real native frames (and must register unwind/stack-map info so the GC and exceptions work). The JVM throws a clean `StackOverflowError` because it tracks frame depth, and it has stack maps (`StackMapTable` attribute) for verification and GC.

## Question 21

**Q: How does a sampling profiler walk the stack, and what are the three common mechanisms?**

It periodically interrupts a thread (usually via a signal or a perf event) and unwinds the captured stack to attribute the sample to a call chain. Three mechanisms: (1) **frame pointers** — follow the FP chain; cheap, deep, signal-safe, but needs `-fno-omit-frame-pointer`; (2) **DWARF CFI** — interpret unwind tables; works on FPO/optimized builds but is expensive per sample (must copy the stack) and fragile in signal context; (3) **hardware LBR** (Last Branch Record) — the CPU records recent branches; near-zero overhead and FP-independent, but shallow depth. This trade-off is why frame pointers were re-enabled fleet-wide for continuous profiling.

---

## Tricky / Trap

## Question 22

**Q: A colleague returns a pointer to a local variable and says "it works in my tests." What's happening?**

The local lives in the function's frame, which is *abandoned* on return (the runtime just moves `rsp` back; it doesn't erase the bytes). So immediately after the call, the dead frame's memory often still holds the old value — the pointer "works." But the next function call reuses that stack memory and overwrites it. It's a dangling pointer and undefined behavior; it appears to work only because nothing has clobbered the bytes *yet*. The fix: return by value, or heap-allocate. (Rust rejects this at compile time via the borrow checker.)

## Question 23

**Q: "We strip the binary to save space." Why might exceptions or crash reports break?**

Stripping `.debug_*` is fine, but if the strip/linker config also removes `.eh_frame`, you break the *runtime* unwinder. `.eh_frame` is not debug info — C++/Rust exceptions and crash-reporter backtraces *need* it at runtime to unwind. So a throw might call `terminate` instead of finding its handler, and crash dumps lose their backtraces. `.eh_frame` must survive stripping; only `.debug_frame`/`.debug_*` are safe to drop.

## Question 24

**Q: A `noexcept` function throws. What happens, and why is the stack often *not* unwound?**

`std::terminate` is called immediately. `noexcept` is a promise that lets the compiler omit unwind machinery through that frame and optimize accordingly; when violated, the standard requires `terminate`, and implementations typically call it **without unwinding** the frames above the violation. So destructors of outer scopes may *not* run — which is exactly why you must only mark code `noexcept` when you can guarantee it won't throw.

## Question 25

**Q: A destructor throws during stack unwinding. What happens?**

If a destructor throws *while* the stack is already being unwound due to another exception, there are now two exceptions in flight, which the runtime cannot resolve → `std::terminate`. This is why the rule "destructors must not throw" exists, and why standard-library destructors are `noexcept`. Practically: never let an exception escape a destructor; catch and log inside it if cleanup can fail.

## Question 26

**Q: Your `perf` flame graph is a wall of `[unknown]`. The code is at `-O2`. Why, and how do you fix it?**

At `-O2` the compiler omits frame pointers (`-fomit-frame-pointer`), so `perf`'s default frame-pointer-based call-graph mode can't walk past frames — it shows `[unknown]`. Fixes, in order of preference for production: rebuild with `-fno-omit-frame-pointer` (cheap, signal-safe walking); or use `perf record --call-graph dwarf` (works on FPO builds but expensive — copies the stack per sample); or `--call-graph lbr` (hardware, low overhead, shallow). Make sure the build also has `-fasynchronous-unwind-tables` if relying on DWARF.

## Question 27

**Q: Your async service crashes inside a continuation, and the backtrace ends at the event loop's `poll`. Where did the caller chain go?**

Stackless async (Rust/C#/JS/Python) compiles `async fn`s into state machines; locals that live across an `await` are stored in a heap future, not on a stack. When you `await`, your function *returns* to the executor — so the physical stack at the crash reflects the event loop, not the logical chain of awaiting tasks. That chain lives in the continuation/future metadata on the heap. To debug it you need the runtime's **logical async stack** reconstruction (async stack traces, task dumps) or your own propagated trace/span context. The physical backtrace genuinely doesn't contain the caller.

## Question 28

**Q: Code that recurses on user-supplied nesting depth works in tests but crashes in production. What's the bug class?**

It's a **stack-overflow denial-of-service**: recursion depth scales with attacker-controlled input (deeply nested JSON/XML, a pathological query), eventually exhausting the stack — a `SIGSEGV` in native code or a runtime error in managed languages. Even Go's 1 GB goroutine stack limit still crashes. The fix is to bound depth explicitly or convert recursion to iteration with a heap-allocated explicit stack (which can grow far larger). Fuzz the depth as part of testing.

## Question 29

**Q: You wrote a hand-coded assembly routine. Now backtraces stop at it and an exception thrown through it calls `terminate`. Why?**

Your assembly has no **CFI annotations** (`.cfi_startproc`/`.cfi_def_cfa_offset`/`.cfi_offset`/…), so there's no FDE describing how to unwind it. A debugger/profiler walking the stack can't compute the CFA or find the return address through your frame, and an exception propagating *through* it can't find the caller, so unwinding fails → `terminate`. The fix is to annotate the routine with the correct CFI directives matching what your prologue does to `rsp` and which registers you save.

## Question 30

**Q: Is reading a stack backtrace inside a `SIGSEGV` handler safe? What can go wrong?**

It's dangerous. The handler runs in the interrupted thread's context, possibly mid-`malloc` or holding a lock. Full DWARF unwinding may allocate or take locks — not async-signal-safe — risking deadlock or corruption. Worse, if the `SIGSEGV` was a *stack overflow*, there's no stack left for the handler to run on unless you installed an **alternate signal stack** (`sigaltstack` + `SA_ONSTACK`). Safe practice: run on an alt stack, use a signal-safe unwinder (frame-pointer walking or precomputed info), and defer symbolization out of the handler.

## Question 31

**Q: "We use only goroutines and pass pointers to stack locals between them — it's fine, Go has a GC." Where's the latent bug?**

Go can move (copy) a goroutine's stack on growth, relocating pointers it can *track*. If a pointer to a stack local is handed somewhere the runtime tracks, Go forces that variable to **escape to the heap** so it's never on a movable stack. The danger is passing a Go stack pointer across **cgo** to C, where the runtime can't track or relocate it — a stack copy then invalidates it. That's why cgo rules forbid passing Go pointers to memory containing Go pointers to C. The bug reproduces only when the stack actually grows, making it intermittent and nasty.

---

## Design

## Question 32

**Q: Design the stack-management strategy for a runtime that must support millions of concurrent tasks.**

Don't use OS thread stacks per task (8 MB reservations don't scale). Use **small growable user-space stacks**: start at a few KB. For growth, prefer **contiguous copying** over segmented to avoid the hot-split cliff — double, copy, relocate pointers. That mandates **precise stack maps** (which slots are pointers at each safepoint) and an **escape analysis** pass so untracked stack pointers go to the heap. Multiplex tasks onto a pool of OS threads (M:N scheduler) with **safepoints** at function prologues for growth/preemption/GC. Detect true overflow with a per-stack limit and a clean error. Provide stack maps to the GC for root scanning. Trade-off summary: copying stacks cost a copy at growth points but give predictable performance and tiny per-task memory.

## Question 33

**Q: Design the exception-unwinding mechanism for a new systems language. Table-based or `setjmp`/`longjmp`?**

Choose **table-based "zero-cost"** unwinding for the common case where throws are rare. Emit per-function unwind tables (à la DWARF CFI / `.eh_frame`) plus a per-function LSDA mapping PC ranges to landing pads and catch types. Use a **two-phase** protocol: phase 1 searches up the stack via a **personality routine** at each frame to confirm a handler exists *without* unwinding (so an unhandled exception can `terminate` with the stack intact); phase 2 unwinds, running landing pads (destructors) and entering the handler. The non-throwing path then costs nothing. Avoid `setjmp`/`longjmp` (runtime cost on every protected scope) unless you specifically need its simplicity or can't emit tables. Accept the trade-offs: larger binaries (tables) and slow throws.

## Question 34

**Q: Design a low-overhead, always-on, fleet-wide CPU profiler. How do you guarantee usable stacks?**

Sample via perf events / a periodic signal, and unwind in a signal-safe, allocation-free fast path. The single most important decision is **how stacks are walked**: mandate **frame pointers** fleet-wide (`-fno-omit-frame-pointer`) so walking is a cheap, deep, signal-safe FP chase — accepting ~1% CPU. As a fallback for code you can't rebuild, support **DWARF** unwinding (heavier; copy a bounded stack snapshot per sample) and **LBR** (hardware; shallow). Symbolize **off the hot path** (ship raw addresses + build IDs, resolve centrally). Consider **eBPF**-based collection to unwind in kernel context. Validate in CI that flame graphs aren't `[unknown]`. The core insight: profilability is a *build-time* property; you can't bolt it on at incident time.

## Question 35

**Q: Design overflow detection that gives clean errors and survives to report them.**

Place a **guard region** (multiple no-access pages) past each stack so an overshoot faults reliably; enable **stack-clash protection** (`-fstack-clash-protection` / stack probes) so a large single frame can't *skip over* the guard into valid memory. Catch the resulting `SIGSEGV`, check whether the faulting address is in/near the current thread's guard region, and if so report "stack overflow" instead of a generic crash. Run the handler on an **alternate signal stack** (`sigaltstack` + `SA_ONSTACK`) so it has room to execute when the main stack is exhausted. In a managed runtime, additionally enforce an explicit per-stack size limit at safepoints for a cleaner, earlier error. Document each thread's stack-size needs so deep libraries don't overflow tiny caller-created stacks.

## Question 36

**Q: You're adding async/await to a language. How do you keep stack traces useful across suspension points?**

Recognize that stackless async severs the physical call chain at each `await` (the function returns to the executor; cross-`await` state lives in a heap future). To keep traces useful, record a **logical parent link** in each task/future — who awaited this — so you can splice a **logical async stack** by following continuation pointers, independent of the physical stack. Expose this via task dumps / async stack traces, and integrate **structured context propagation** (trace/span IDs) so distributed and async boundaries both carry causality. Make the physical unwinder cover one segment and stitch the rest from continuation metadata. Decide whether to capture the logical stack eagerly (cost on every await) or lazily (reconstruct on demand) based on overhead budget.

---

## Summary

The through-line across these questions: a frame is structured by the **calling convention**; a stable frame pointer makes walking trivial but is often **omitted** for speed; once omitted, walking — for backtraces, profilers, GC roots, and exceptions — becomes a **table lookup** (DWARF CFI `.eh_frame` on Unix, `.pdata`/`.xdata` on Windows). Exceptions are that unwinder driven by a **two-phase, personality-routine** protocol with **zero cost** on the normal path. At scale, stacks become **growable and movable** (Go's copying stacks + stack maps + escape analysis), overflow is a **guard-page fault** you must design to survive, and async **loses the physical stack**, forcing logical reconstruction. The recurring practical lesson — strong to voice in an interview — is that **frame pointers came back fleet-wide** because always-on profilability outweighs a ~1% tax, and that `.eh_frame`, CFI annotations, `sigaltstack`, and bounded recursion are the non-negotiables of a robust runtime.
