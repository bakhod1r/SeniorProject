# Stack Management & Unwinding — Hands-On Tasks

> **Topic:** [Stack Management & Unwinding](README.md)

---

## Introduction

This file is a structured set of exercises that take you from "I can read a
stack trace" to "I can walk frames by hand in a debugger, interpret DWARF CFI,
watch a Go stack get copied, and detect a stack overflow on an alternate signal
stack." Every task is small enough for one or two focused sessions, and they
build on each other. Attempt each one *before* reading the hints — five minutes
of stepping through a debugger teaches more than any paragraph.

How to use this file: read the task, write/compile the code, run it under a
debugger or with `objdump`/`readelf`/`perf` as instructed, and only then check
the hints. Mark a self-check box when you can *explain the result to someone
else*, not when the program merely runs. Solutions are intentionally sparse —
they appear only where the canonical answer is more instructive than your first
attempt.

A note on platforms: examples assume Linux x86-64 with GCC/Clang and
GDB/LLDB unless stated. Most translate directly to macOS (use LLDB) and, with
effort, to Windows (use the Visual Studio debugger / `dumpbin`).

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These rebuild the mental model. Short, but each introduces a tool or failure
mode you'll reuse.

### Task 1: Read a backtrace cold

**Problem.** Without running anything, read the following trace and answer:
(a) on which line did the program crash, (b) what is the full call chain that
got there, (c) is this output ordered innermost-first or outermost-first?

```text
Traceback (most recent call last):
  File "report.py", line 31, in <module>
    build_report(rows)
  File "report.py", line 22, in build_report
    totals = summarize(rows)
  File "report.py", line 14, in summarize
    return aggregate(rows) / count
  File "report.py", line 9, in aggregate
    return sum(r["amount"] for r in rows)
KeyError: 'amount'
```

**Self-check.**
- [ ] You named the crash line and the exact exception.
- [ ] You traced the full caller chain in order.
- [ ] You identified whether Python prints oldest- or newest-first, and how
      that differs from Java/Go.

<details>
<summary>Solution sketch</summary>

(a) Line 9, `aggregate`, a `KeyError: 'amount'` — a row dict is missing the
`amount` key. (b) `<module>` (line 31) → `build_report` (22) → `summarize`
(14) → `aggregate` (9). (c) Python prints **oldest-first** ("most recent call
last"), so the crash is at the **bottom**. Java and Go print **innermost-first**
(crash at the top). Always find the actual error line before assuming a
direction.

</details>

---

### Task 2: Make the stack visible with recursion

**Problem.** Write a recursive function in any language that prints the live
stack at its base case (Python `traceback.print_stack()`, Go
`debug.PrintStack()`, Java `Thread.dumpStack()`). Call it 4 levels deep.
Count the frames and match each to a function call.

**Hints (try without first).**
- Each recursive call should appear as its own frame.
- The base-case frame is the innermost; `main`/`<module>` is outermost.
- If you see fewer frames than expected at high optimization, suspect
  tail-call or inlining (note it — Task 13 returns to this).

**Self-check.**
- [ ] The number of frames equals the recursion depth (plus a couple for the
      harness).
- [ ] You can point to which frame corresponds to which call.

---

### Task 3: The dangling-pointer-to-a-local bug

**Problem.** In C, write a function that returns the address of a local `int`.
In `main`, dereference it, then call an unrelated function, then dereference
it again. Compile with `-O0` and observe both reads.

**Constraints.**
- Don't use the heap.
- Print both dereferenced values.

**Hints (try without first).**
- Right after the call, the dead frame's bytes often still hold the old value.
- The *second* read, after calling another function, frequently shows garbage
  because the second call reused that stack memory.
- Try `-Wall` — the compiler likely warns you.

**Self-check.**
- [ ] You can explain why the first read "works" and the second often doesn't.
- [ ] You can state why this is undefined behavior regardless of what prints.
- [ ] You know how Rust's borrow checker would reject the equivalent code.

---

### Task 4: Hit a stack overflow on purpose

**Problem.** Write unbounded recursion in (a) Python and (b) C. Observe the
*different* failure modes. Record the exact error each produces.

**Hints (try without first).**
- Python counts frames and raises a clean `RecursionError` (`sys.getrecursionlimit()`).
- C has no net: it runs into the guard page and dies with `Segmentation fault`.
- In Go, `func f(){ f() }` gives `fatal error: stack overflow` with the 1 GB
  goroutine limit — note this is *still a crash*.

**Self-check.**
- [ ] You can explain why managed runtimes give a clean error and C doesn't.
- [ ] You can describe what "the guard page" has to do with the C segfault.

---

## Core

These require a debugger and the toolchain. This is where the topic becomes real.

### Task 5: Walk the frames by hand in GDB

**Problem.** Compile this at `-O0 -g`, set a breakpoint in `c`, and walk the
stack manually — *without* using `bt`. Use `info registers rsp rbp`, then read
the saved `rbp` and return address from memory to step to each caller, and
confirm against `bt`.

```c
// frames.c
#include <stdio.h>
void c(int x) { printf("in c: %d\n", x); }   // breakpoint here
void b(int x) { c(x + 1); }
void a(int x) { b(x + 1); }
int main(void) { a(1); return 0; }
```

**Hints (try without first).**
- `gcc -O0 -g frames.c -o frames; gdb ./frames`
- `break c`, `run`, then `info registers rbp rsp`.
- The saved caller `rbp` is at `[rbp]`; the return address is at `[rbp+8]`.
  In GDB: `x/2gx $rbp` shows both — the first qword is the previous `rbp`,
  the second is the return address.
- Set `$prev = *(unsigned long*)$rbp` and `info symbol *(unsigned long*)($rbp+8)`
  to identify the caller.
- Repeat from the previous `rbp` to reach `main`.

**Self-check.**
- [ ] You walked `c → b → a → main` purely from memory contents.
- [ ] Your hand walk matches `bt` exactly.
- [ ] You can explain *why* `[rbp]` is the previous frame pointer and `[rbp+8]`
      is the return address (relate it to `push rbp` in the prologue).

<details>
<summary>Solution sketch</summary>

After `push rbp; mov rbp, rsp`, the current `rbp` points at the slot holding
the *caller's* saved `rbp`. The slot just above it (`rbp+8`, higher address)
holds the return address pushed by `call`. So `x/2gx $rbp` prints
`[prev_rbp, return_addr]`. Following `prev_rbp` repeatedly reconstructs the
exact chain `bt` shows. This is *literally* what naive stack walking does.

</details>

---

### Task 6: See the prologue, epilogue, and red zone

**Problem.** Compile a leaf function and a non-leaf function and disassemble
both at `-O2`. Identify (a) which one sets up a frame pointer, (b) whether the
leaf uses the red zone (writes below `rsp` without `sub rsp`), (c) the
alignment-related `sub`/`push` arithmetic.

```c
// proepi.c
long leaf(long x) { return x * x + 7; }
long nonleaf(long x) { return leaf(x) + leaf(x + 1); }
```

**Hints (try without first).**
- `gcc -O2 -S -masm=intel proepi.c` and read the `.s`, or
  `objdump -d --no-show-raw-insn proepi.o`.
- A pure leaf often needs *no* stack at all (everything in registers).
- Force red-zone use with a small local array and re-check; compare against
  `gcc -O2 -mno-red-zone`.

**Self-check.**
- [ ] You can point to the prologue/epilogue (or note their absence).
- [ ] You can show a red-zone access (a write to `[rsp-8]` with no `sub rsp`)
      and explain why it's safe only in a leaf.
- [ ] You can explain the 16-byte alignment requirement at the `call`.

---

### Task 7: Frame pointer present vs omitted

**Problem.** Compile the Task 5 program at `-O0`, `-O2`, and
`-O2 -fno-omit-frame-pointer`. Disassemble each and find where the
`push rbp; mov rbp, rsp` prologue appears and disappears.

**Hints (try without first).**
- `for o in "-O0" "-O2" "-O2 -fno-omit-frame-pointer"; do gcc $o -S -masm=intel frames.c -o "out${o// /_}.s"; done`
- At `-O2`, `rbp` is typically gone (omitted); at
  `-O2 -fno-omit-frame-pointer` it returns.
- Now run a GDB `bt` on the FPO build — does it still work? (It does, because
  GDB falls back to `.eh_frame`.)

**Self-check.**
- [ ] You can identify which builds keep the frame pointer.
- [ ] You can explain why `bt` still works on the FPO build (DWARF CFI).
- [ ] You can state what a *naive* FP-only walker would do on the FPO build.

---

### Task 8: Read the DWARF CFI

**Problem.** For the Task 6 binary, dump the unwind tables and locate the FDE
for `nonleaf`. Identify the `DW_CFA_def_cfa_offset` opcodes that track the CFA
as the prologue runs, and any `DW_CFA_offset` saving a callee-saved register.

**Hints (try without first).**
- `gcc -O2 -g proepi.c -o proepi`
- `objdump --dwarf=frames proepi` (decoded CIE/FDE), or
  `readelf --debug-dump=frames proepi`.
- Also try `gcc -O2 -S proepi.c -o proepi.s; grep cfi proepi.s` to see the
  `.cfi_*` directives the compiler emitted — these *generate* the FDE.
- Match a `.cfi_def_cfa_offset 16` to the instruction that changed `rsp`.

**Self-check.**
- [ ] You found `nonleaf`'s FDE and its CIE.
- [ ] You matched at least one CFI opcode to a prologue instruction.
- [ ] You can explain how an unwinder uses these to compute the return address
      location at an arbitrary PC.

---

### Task 9: Break a profiler with FPO; fix it

**Problem.** Write a CPU-bound program with a clear call hierarchy (e.g.
`main → outer → middle → hot_loop`). Profile it with `perf record -g` built
two ways: plain `-O2`, and `-O2 -fno-omit-frame-pointer`. Compare the flame
graphs / `perf report`.

**Hints (try without first).**
- `perf record -g ./prog; perf report --stdio | head -40`
- The plain `-O2` build will show `[unknown]` frames or truncated chains.
- Re-run with `perf record --call-graph dwarf ./prog` on the FPO build — it
  recovers the chain (at higher overhead).
- Try `--call-graph lbr` if your CPU supports it.

**Self-check.**
- [ ] You reproduced `[unknown]` on the FPO build with default `fp` walking.
- [ ] You fixed it three ways: frame pointers, DWARF, and LBR.
- [ ] You can articulate the cost trade-off of each (this is the "frame
      pointers came back" argument).

---

### Task 10: Watch RAII cleanup run during unwinding

**Problem.** In C++, write a function with a local RAII guard (a struct whose
destructor prints) that `throw`s. Catch the exception in `main`. Confirm the
destructor runs *during* unwinding, before the `catch` body.

```cpp
#include <cstdio>
struct Guard { ~Guard() { puts("~Guard"); } };
void inner() { Guard g; throw 1; }
int main() { try { inner(); } catch (int) { puts("caught"); } }
```

**Hints (try without first).**
- Expected output order: `~Guard` then `caught`.
- Now add `g++ -O2 -fno-exceptions` — it won't compile / will abort; explain why.
- Inspect `readelf -S` for `.eh_frame` and `.gcc_except_table` (the LSDA).

**Self-check.**
- [ ] You observed the destructor run before the catch body.
- [ ] You can explain phase-1 (search) vs phase-2 (cleanup) in terms of this
      output.
- [ ] You located the `.eh_frame` and LSDA sections and can say what each does.

---

## Advanced

### Task 11: Detect a stack overflow with a signal handler on an alt stack

**Problem.** In C, install a `SIGSEGV` handler on an **alternate signal stack**
(`sigaltstack` + `SA_ONSTACK`) that prints "stack overflow detected" and
exits. Then trigger overflow via unbounded recursion. Show that **without**
`SA_ONSTACK` the handler fails (the process dies anyway), and **with** it the
handler runs cleanly.

**Hints (try without first).**
- Allocate `char alt[SIGSTKSZ]`, fill a `stack_t`, call `sigaltstack`.
- Register `SIGSEGV` with `sigaction`, flags `SA_SIGINFO | SA_ONSTACK`.
- Without `SA_ONSTACK`, the handler needs stack the overflowed thread doesn't
  have → it can't run.
- Use `siginfo->si_addr` to confirm the fault address is near the stack limit.

**Self-check.**
- [ ] The handler runs *only* when on the alternate stack.
- [ ] You can explain why a stack-overflow handler needs `sigaltstack`.
- [ ] You can distinguish this `SIGSEGV` from a null-deref `SIGSEGV` using
      `si_addr` relative to the stack region.

<details>
<summary>Solution sketch</summary>

The overflow consumes the main stack down to the guard page; the `SIGSEGV`
delivery needs somewhere to build the handler's frame. With `SA_ONSTACK` the
kernel switches to the alternate stack you registered, so the handler runs;
without it, the handler tries to use the exhausted main stack and the process
dies. `si_addr` will point at (or just past) the stack's low limit, near the
guard page — distinguishing it from a wild pointer deref elsewhere.

</details>

---

### Task 12: Watch a Go goroutine stack grow and copy

**Problem.** Write Go code that recurses deeply (with a non-trivial frame size)
so the goroutine stack must grow several times. Confirm a pointer to a stack
local **stays valid across growth**, proving the runtime relocated it. Then
make a version where the variable escapes to the heap and compare with
`go build -gcflags=-m`.

**Hints (try without first).**
- A recursing function that holds a `*int` to a caller's local across the call
  forces the address to be live during growth.
- `go build -gcflags="-m" main.go` prints escape-analysis decisions
  ("moved to heap", "escapes to heap").
- If the value were *not* relocatable and *not* escaped, growth would corrupt
  it — but Go either relocates the tracked stack pointer or moves the value to
  the heap. You should never observe corruption.

**Self-check.**
- [ ] The stack-local pointer's target is correct after multiple growths.
- [ ] You can read `-gcflags=-m` output and say what escaped and why.
- [ ] You can explain the link between stack copying, stack maps, and escape
      analysis.

---

### Task 13: Tail-call elimination removes a frame

**Problem.** Write a tail-recursive function (a loop expressed as a tail call).
Compile at `-O0` and at `-O2` (Clang with `[[clang::musttail]]` makes it
explicit). At `-O0`, deep recursion overflows; at `-O2` with TCE it runs
forever in bounded stack. Confirm with a debugger that the eliminated caller
is **absent** from the backtrace.

**Hints (try without first).**
- Clang: `__attribute__((musttail)) return f(...)` forces a tail call or errors.
- Break inside the function at `-O2` and run `bt`; the chain of recursive
  callers won't be there — just one frame.
- At `-O0` the same code grows the stack per call and overflows.

**Self-check.**
- [ ] You demonstrated bounded vs unbounded stack at `-O2` vs `-O0`.
- [ ] You confirmed the backtrace omits the eliminated frames.
- [ ] You can explain why this is *correct* unwinding, not a bug.

---

### Task 14: The "useless" async backtrace, and rebuilding it

**Problem.** In a stackless-async runtime (Rust `tokio`, C# `async`, JS, or
Python `asyncio`), raise an error several `await`s deep. Capture the *physical*
backtrace at the throw and compare it to the runtime's *logical* async trace.
Then add explicit context (a request ID threaded through, or the runtime's
task-dump facility) and show you can recover the logical caller chain.

**Hints (try without first).**
- In many runtimes the physical stack at the throw bottoms out at the event
  loop's `poll`/`run`, not your handler.
- Python's `asyncio` actually chains the traceback for you — note where the
  reconstruction comes from (task/coroutine metadata, not the physical stack).
- Rust: compare a raw panic backtrace to `tracing` spans / `tokio-console`.

**Self-check.**
- [ ] You can show where the physical backtrace "loses" the logical caller.
- [ ] You can explain where the logical chain actually lives (heap futures /
      continuation metadata).
- [ ] You designed a context-propagation approach that survives suspension.

---

## Capstone

### Task 15: Build a minimal frame-pointer stack walker

**Problem.** Write a function `backtrace_fp(void **out, int max)` in C that
walks the **frame-pointer chain** by hand (read `rbp`, follow saved-`rbp`
links, collect return addresses) and returns the call chain. Compile the
*whole program* with `-fno-omit-frame-pointer`. Symbolize the addresses with
`backtrace_symbols` or `addr2line`. Verify it matches GDB's `bt`.

**Constraints.**
- Use inline asm or `__builtin_frame_address(0)` to get the starting `rbp`.
- Walk until you hit a null/again-implausible frame pointer (or `main`).
- Compare your output to glibc `backtrace()` and to GDB.

**Hints (try without first).**
- `void **fp = __builtin_frame_address(0);`
- Each step: `ret_addr = fp[1]; fp = (void**)fp[0];`
- Stop when `fp` is null, not increasing, or outside the stack region.
- This *only* works because you built with frame pointers — that's the point.

**Self-check.**
- [ ] Your walker reproduces the call chain.
- [ ] You can explain exactly why it breaks under `-fomit-frame-pointer`.
- [ ] You can describe what you'd need instead on an FPO build (interpret
      `.eh_frame` / DWARF CFI) and why that's much harder.

<details>
<summary>Solution sketch</summary>

The walk is `fp[0]` = previous frame pointer, `fp[1]` = return address (because
`push rbp` then the return address sits just above the saved `rbp`). Loop,
collecting `fp[1]`, until the chain ends. It is correct *only* when every frame
keeps a frame pointer; on an FPO build `fp[0]`/`fp[1]` are arbitrary stack
bytes and you get garbage. The robust alternative is a DWARF CFI interpreter
(or using `libunwind`), which computes the CFA and return-address location per
PC from `.eh_frame` — far more code, but the only thing that works without
frame pointers.

</details>

---

### Task 16: Cross-language unwind audit

**Problem.** Construct a call chain that crosses languages: C++ → C → C++,
where the innermost C++ frame throws and the outermost catches. Make the
middle C translation unit compiled *without* unwind tables and observe the
failure; then recompile the C with `-fexceptions` (or `-funwind-tables`) and
observe success.

**Hints (try without first).**
- The middle C function must merely call back into a C++ function that throws.
- Without unwind info through the C frame, the unwinder can't propagate the
  exception across it → `terminate`.
- `gcc -fexceptions` makes C emit the cleanup/unwind tables needed.

**Self-check.**
- [ ] You reproduced `terminate` from missing unwind info in the C frame.
- [ ] You fixed it by emitting unwind tables for the C TU.
- [ ] You can explain why `.eh_frame` is required for *any* frame an exception
      must pass through, not just the throwing/catching ones.

---

### Task 17: Capacity story — a million-task memory budget

**Problem.** (Analysis, little code.) Estimate the memory cost of running one
million concurrent tasks (a) as OS threads with default 8 MB stacks, and (b)
as Go goroutines starting at 8 KB. Then explain what *copying* stacks cost at
growth time and why the design still wins.

**Hints (try without first).**
- (a) 1,000,000 × 8 MB = 8 TB of reserved address space (even if lazily
  committed, the reservation and bookkeeping are ruinous).
- (b) 1,000,000 × 8 KB = ~8 GB *if all grow*; most stay tiny, so far less.
- Copying costs a memcpy + pointer relocation at each doubling, amortized O(1)
  per byte; the win is feasibility and predictability (no hot-split).

**Self-check.**
- [ ] You produced both numbers and explained the address-space problem.
- [ ] You can articulate the copying-stack trade-off (copy cost vs feasibility).
- [ ] You can connect this back to *why* growable stacks need precise stack
      maps and escape analysis.

<details>
<summary>Solution sketch</summary>

OS threads are infeasible: even uncommitted, a million 8 MB reservations
exhaust a 48-bit address space's practical budget and the kernel's per-thread
bookkeeping. Small growable stacks make a million tasks routine because most
tasks never grow. Copying-on-growth pays a memcpy + relocation at each
geometric doubling — amortized O(1) per byte — and avoids the segmented
hot-split cliff. It's only sound because the runtime has precise stack maps to
relocate pointers and escape analysis to keep untracked pointers off the
movable stack.

</details>

---

## Closing Note

If you completed Tasks 5, 8, 11, 12, and 15, you can now do the five things
that separate someone who *uses* the stack from someone who *understands the
runtime*: walk frames by hand, read DWARF CFI, survive and report a stack
overflow, observe a stack being copied and pointers relocated, and write a
working stack walker (and explain precisely when it breaks). Everything else in
this topic — exceptions, profiling, async logical stacks, GC root scanning — is
a specialization of those mechanics.
