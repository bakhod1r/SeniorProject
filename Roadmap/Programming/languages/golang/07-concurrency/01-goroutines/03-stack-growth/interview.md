# Goroutine Stack Growth — Interview Questions

## Table of Contents
1. [Introduction](#introduction)
2. [Junior Level](#junior-level)
3. [Middle Level](#middle-level)
4. [Senior Level](#senior-level)
5. [Staff / Principal Level](#staff--principal-level)
6. [Coding Exercises](#coding-exercises)
7. [Whiteboard Drawings](#whiteboard-drawings)
8. [System-Design Questions](#system-design-questions)

---

## Introduction

These questions appear in Go interviews ranging from screening rounds to staff-engineer system-design discussions. The answers are summarised; depth scales with seniority. A junior should know the initial size and the existence of growth; a staff engineer should be able to sketch `morestack` → `newstack` → `copystack` and discuss pointer fix-up.

---

## Junior Level

### Q1. What is the initial stack size of a goroutine?

**A:** 2 KB, since Go 1.4. Earlier versions used 4 KB (Go 1.3) and 8 KB (Go 1.0–1.2).

### Q2. What happens if a goroutine needs more stack than it has?

**A:** The Go runtime allocates a larger stack (typically double the current size), copies the existing frames into it, fixes any pointers that referred to the old stack, frees the old stack, and resumes execution. This is called copy-and-grow.

### Q3. Can a goroutine's stack ever shrink?

**A:** Yes. During garbage collection, if a goroutine's stack is more than 4× its actual usage, the runtime shrinks it (down to a minimum of ~2 KB).

### Q4. What is the maximum stack size?

**A:** 1 GB on 64-bit systems, 250 MB on 32-bit, by default. Configurable with `runtime/debug.SetMaxStack`.

### Q5. What happens when a goroutine exceeds the maximum?

**A:** The runtime prints `runtime: goroutine stack exceeds 1000000000-byte limit` and `fatal error: stack overflow`, then aborts the process. The error is not recoverable via `recover()`.

### Q6. Why are goroutines cheaper than OS threads?

**A:** A goroutine starts with a 2 KB stack; an OS thread typically reserves 1–8 MB. Plus goroutines are user-space, so creation, context-switching, and destruction don't involve the kernel.

### Q7. Can you recover from a stack overflow with `recover()`?

**A:** No. Stack overflow is a fatal error, not a recoverable panic. The runtime aborts directly without running deferred functions.

### Q8. What is the difference between a goroutine's stack and the heap?

**A:** The stack holds function-local variables, arguments, and saved registers — its memory is reclaimed when the function returns. The heap holds variables that escape their function (live longer than the call); heap memory is reclaimed by the garbage collector. The compiler decides via escape analysis.

---

## Middle Level

### Q9. How does the compiler decide whether to insert the stack-growth check?

**A:** Almost every function gets the check. Exceptions:
- Functions marked `//go:nosplit` (used in the runtime).
- Some inlined functions (the caller's check covers the inlined body).
- Very small leaf functions with no frame may sometimes skip the check.

### Q10. Describe the stack-growth check in assembly terms.

**A:** Roughly:
```
CMPQ SP, 16(R14)       ; compare stack pointer to g.stackguard0
JLS  morestack_noctxt  ; if SP is below the guard, jump to growth path
```
The check is 2-3 instructions. R14 holds the current G pointer (since Go 1.17 register ABI); pre-1.17 used TLS.

### Q11. What is `g.stackguard0` and why is it used instead of `g.stack.lo`?

**A:** `stackguard0` is `g.stack.lo + _StackGuard` (~928 bytes of headroom). Using the guard pointer leaves a buffer for `//go:nosplit` functions that don't check. Additionally, the runtime overloads `stackguard0` for async preemption — setting it to a sentinel forces the next prologue check to fail, triggering descheduling.

### Q12. Why doubling and not linear growth?

**A:** Amortised O(1) per push. Total copying cost across all grows is O(2N) where N is final size — same analysis as a `std::vector`.

### Q13. What was the segmented-stack approach and why was it replaced?

**A:** Go 1.0–1.2 used segmented stacks: when full, link a new segment; when empty, free it. Problem: a function call that crossed a segment boundary triggered alloc/free; if it ran in a loop, every iteration paid. This was the "hot split" problem, and could slow code 10–100×. Go 1.3 switched to copying stacks: one allocation, possibly large, but predictable cost.

### Q14. When does stack shrinking happen?

**A:** During garbage collection, in `scanstack`. Condition: `in_use < allocated / 4`. Down to a minimum of `_FixedStack` (~2 KB).

### Q15. How can you observe stack usage in a running program?

**A:**
- `runtime.MemStats.StackInuse` — bytes currently used.
- `runtime.MemStats.StackSys` — bytes obtained from OS for stacks.
- `runtime/metrics` — `/memory/classes/heap/stacks:bytes`.
- pprof goroutine profile — per-goroutine traces (not bytes).
- `runtime.Stack(buf, true)` — text dump.

### Q16. What does `runtime.morestack_noctxt` mean if it shows up in a CPU profile?

**A:** Stack growth is happening on a hot path. Look for: large local arrays, deep recursion, many short-lived goroutines each growing their stack.

### Q17. How does `runtime/debug.SetMaxStack` work?

**A:** Sets the per-goroutine maximum stack size. When a goroutine tries to grow beyond this limit, the runtime crashes with `stack overflow`. Useful for failing fast on infinite recursion rather than letting it consume 1 GB.

### Q18. Why is `defer` related to stack growth?

**A:** Each `defer` registers a record on the goroutine. Pre-1.13, this could allocate a heap object; 1.13+ uses an "open-coded defer" that lives in the stack frame. Either way, frame size grows with defers, which can trigger stack growth in tight loops.

---

## Senior Level

### Q19. How does the runtime move pointers when copying a stack?

**A:** The compiler emits stack maps describing which slots in each frame are pointers. After allocating the new stack and `memmove`ing the contents, the runtime walks the frame chain. For each pointer slot, it checks whether the value points into the *old* stack range; if so, it adds the delta `(new.lo - old.lo)` to translate.

### Q20. What is `unsafe.Pointer` arithmetic's interaction with stack growth?

**A:** Disguising a pointer as `uintptr` hides it from the stack map. The runtime cannot adjust it during growth. After the move, the `uintptr` is a stale address. This is why `unsafe` code must re-derive pointer values immediately before use, never store them across function calls.

### Q21. Why do `//go:nosplit` functions exist?

**A:** Some runtime code must not grow the stack — e.g., the stack-growth code itself (you can't recursively grow during growth), signal handlers, GC barriers. `//go:nosplit` tells the compiler to skip the prologue check. The runtime statically guarantees a budget (~928 bytes) of free stack below any nosplit chain.

### Q22. What is `g0`, and how does its stack differ from a goroutine's stack?

**A:** `g0` is each M's "system goroutine" — runs the scheduler, GC, and stack-growth code itself. Its stack is allocated by the OS at thread creation, fixed size (typically 8 KB+), and not growable. C code (via cgo) and signal handlers run on `g0` or `gsignal`, not on the goroutine stack.

### Q23. Why does the runtime use the same mechanism for stack growth and async preemption?

**A:** Setting `g.stackguard0` to a sentinel (`stackPreempt`) makes the next prologue check fail. Inside `newstack`, the runtime distinguishes "real overflow needs growth" from "preempt sentinel needs descheduling" and branches accordingly. Reusing the same check avoids adding a second per-call overhead.

### Q24. When is stack growth *unsafe* to perform?

**A:** Several cases the runtime explicitly forbids:
- During a system call (`gp.syscallsp != 0`).
- During a stack copy already in progress (`_Gcopystack` status).
- On the M's `g0` stack itself.
- In code marked `//go:nosplit` — by definition.

### Q25. What is a `sudog` and why does stack growth need to adjust them?

**A:** A `sudog` is a record allocated when a goroutine parks on a channel. The `sudog` may hold a pointer to a value on the goroutine's stack (e.g., the destination of a channel receive). When the goroutine's stack moves, the `sudog`'s pointer must be updated. `adjustsudogs` in `runtime/stack.go` handles this.

### Q26. If two goroutines call the same function, do they execute identical code?

**A:** Yes. The same machine code runs in both. The prologue check reads `g.stackguard0` from a register or thread-local that gives each goroutine its own G; that field holds *that goroutine's* current stack bounds. The check is data-driven, not code-driven.

### Q27. Why must the goroutine's status change to `_Gcopystack` during growth?

**A:** Two reasons:
1. GC must not scan a stack that is being copied — pointer fix-up would race.
2. Other runtime code that walks stacks (e.g., panic propagation, stack traces) must wait.

The atomic status flag synchronises these phases.

### Q28. How does cgo affect stack growth?

**A:** When Go code calls a C function via cgo, the runtime switches from the goroutine's growable stack to the M's `g0` (system) stack. The C function runs on `g0`. Deep C recursion can blow `g0`'s fixed size. C cannot grow the Go stack. Likewise, C must not hold pointers into Go stacks because they may move at any time.

---

## Staff / Principal Level

### Q29. A microservice routinely uses 12 GB of memory. `runtime.MemStats.StackSys` is 800 MB. Is that high?

**A:** Probably not, but it depends on the goroutine count. 800 MB / 2 KB ≈ 400,000 goroutines if all stacks are minimum. If goroutine count is ~10,000, individual stacks have grown — average 80 KB per goroutine. Either tasks recurse deeply or large locals are used. Investigate with pprof goroutine profiles.

### Q30. Design a system that accepts arbitrarily nested JSON and is robust to stack-overflow DoS.

**A:** Several layers:
1. **Cap input size** at the HTTP layer (e.g., 10 MB) — limits worst-case depth.
2. **Cap nesting depth** in the parser — `encoding/json` caps at 10,000; do the same.
3. **Lower `debug.SetMaxStack`** at process start (e.g., 64 MB) — fail fast if (1) and (2) are bypassed.
4. **Run untrusted parsing in a subprocess** if extreme isolation is needed — process crash doesn't take down the parent.
5. **Add request timeouts** — a process under stack-growth attack also consumes CPU.

### Q31. You're optimising a parser that shows `morestack_noctxt` in pprof at 8%. What do you investigate?

**A:**
1. Identify the stack-growing function — pprof's caller relationship usually shows it.
2. Check for large local arrays or structs. Move to `sync.Pool` if so.
3. Check for recursion. Convert to iteration with an explicit slice as stack.
4. Check goroutine creation. If each request spawns a fresh goroutine that grows, consider a worker pool.
5. Pre-grow stacks of long-lived workers with a warmup function.

### Q32. Walk through what happens, step by step, when a goroutine with a 4 KB stack calls a function that needs 8 KB.

**A:**
1. **Prologue check** — `CMPQ SP, 16(R14)` — fails because SP minus 8 KB frame size would be below `g.stackguard0`.
2. **Jump to `morestack_noctxt`** — assembly stub.
3. **Save state in `g.sched`** — caller's PC, SP, BP, context.
4. **Switch to `g0` stack** — so `newstack` runs with known headroom.
5. **`newstack`** runs:
   - Computes new size = 8 KB (double of 4 KB).
   - Calls `stackalloc(8 KB)` — gets a free 8 KB stack from per-P cache.
   - Calls `copystack(g, 8 KB)`:
     - Sets `g.atomicstatus = _Gcopystack`.
     - Allocates the new stack.
     - `memmove`s the 4 KB of frames into the bottom (or top, depending on direction) of the new 8 KB stack.
     - Walks frame chain via `unwinder`. For each frame:
       - Reads function stack map at the saved PC.
       - For each pointer slot in the frame, if the value points into `[old.lo, old.hi)`, adds delta `(new.lo - old.lo)`.
     - Adjusts `g._defer`, `g._panic`, channel sudogs.
     - Updates `g.stack`, `g.stackguard0`, `g.sched.sp`.
     - Sets status back to `_Grunning`.
   - Calls `stackfree(old stack)` — back to pool.
6. **`gogo(&g.sched)`** — restores PC/SP/BP. SP now points into the new stack.
7. **Function body executes** as if the prologue check had passed.

### Q33. The runtime never shrinks below `_FixedStack` (~2 KB). Why not allow even smaller?

**A:** Three reasons:
1. The compiler emits prologues assuming at least `_StackGuard` (~928 bytes) of nosplit headroom. Stacks below ~2 KB cannot meet this constraint.
2. The first function called on a goroutine will almost certainly need at least a KB or two; shrinking to 512 B then immediately growing wastes work.
3. The amortisation argument only works if the minimum size is "close enough" to typical usage. 2 KB is empirically right for almost all goroutines.

### Q34. What is the impact of stack growth on a 99.9-percentile latency budget?

**A:** A single growth event is 5–20 μs for stacks up to 64 KB. A request that triggers 2-3 growths adds 15-60 μs to tail latency. On a 1 ms p99 budget that's 1.5%–6%. Mitigation: pre-grow long-lived workers, or use iterative algorithms. The 1.4 → 2 KB initial size makes more growths happen, but each is amortised cheap. The trade-off is intentional.

### Q35. How would you write a test that asserts a function does not grow the stack?

**A:** Hard to do directly because growth happens transparently. Indirect approaches:
- Measure `runtime.MemStats.StackInuse` before and after; assert no change.
- Use `GODEBUG=stackdebug=1` and capture stderr in tests.
- Use `runtime/metrics` to count stack-allocation events (no such metric exists today, so this is aspirational).
- Run the function with a very low `debug.SetMaxStack` (e.g., 8 KB); if it doesn't crash, you know it stayed within budget.

In practice, asserting "no growth" is rarely the right test. Better is to assert behaviour (correctness, max depth, etc.) and let stack mechanics happen.

---

## Coding Exercises

### Exercise 1 — Cause and observe stack growth

Write a program that recursively increases stack usage in 1 KB increments and prints `runtime.MemStats.StackInuse` at each step. Expected: monotone increases, doubling at growth points.

### Exercise 2 — Convert recursion to iteration

Given a recursive tree walker, write an iterative version using an explicit `[]*Node` as stack. Show that for a degenerate left-skewed tree of depth 100,000, the recursive version overflows but the iterative version succeeds.

### Exercise 3 — Trigger a controlled stack overflow

Write a test that calls `debug.SetMaxStack(64 << 10)` and then recurses. Verify the panic message, document that it's unrecoverable.

### Exercise 4 — Identify large frames

Compile a program with `go tool compile -m -S yourfile.go`. Identify functions with frames over 1 KB. Refactor to use heap allocations and verify reduced frame sizes.

### Exercise 5 — Measure cost of growth on a hot path

Benchmark two implementations of the same function: one with a 256-byte local array, one with `sync.Pool`. Measure with `go test -bench`. Look for the `morestack` overhead in the local-array version.

---

## Whiteboard Drawings

Be prepared to draw:

1. **The stack before and after growth** — two columns showing frames at old vs new addresses, with arrows showing the move.
2. **The prologue check** — a small ASCII snippet with `CMPQ SP, ...` and the jump.
3. **The stack pool** — bucketed by size, per-P caches refilling from global pool.
4. **The history of Go stacks** — Go 1.0 segmented → 1.3 contiguous → 1.4 2 KB.
5. **Where stacks live** — heap-allocated for goroutines, OS-allocated for `g0` and `gsignal`.

---

## System-Design Questions

### Q36. Design a Go service handling 5 million concurrent WebSocket connections.

Stack considerations:
- 5M goroutines × ~2 KB = 10 GB just baseline. Plus read/write buffers.
- Decide: one goroutine per conn, two (reader + writer), or share a writer goroutine?
- Watch StackSys. Plan for ~20 GB of stack-related memory at peak.
- Maybe consider event-loop libraries (`gnet`, `evio`) that use fewer goroutines per conn.

### Q37. Design a recursive descent parser for a domain-specific language. Make it production-safe.

- Cap depth (explicit counter, error if exceeded).
- Cap input size at API layer.
- Lower `debug.SetMaxStack` at process start.
- Consider iterative or table-driven parser for performance-critical paths.
- Add fuzzing to find pathological inputs.

### Q38. A microservice spawns one goroutine per Kafka message. It OOMs at high message rates.

Diagnose:
- `runtime.NumGoroutine()` — does it climb without bound?
- `runtime.MemStats.StackSys` — does it grow with goroutine count?
- Pprof goroutine — where are they parked?

Likely cause: faster than they're processed, leading to goroutine pile-up. Each parked goroutine holds its stack. Solution: use a worker pool with a bounded channel; back-pressure to Kafka by slowing the consumer.

### Q39. Why is Go a good choice for a million-connection chat server but not for a deep-recursive theorem prover?

- Million conns: low per-goroutine memory, transparent growth, async I/O via netpoller. Go shines.
- Theorem prover: deep recursion, large frames, possibly tail-call-heavy. Go's lack of TCO and 1 GB cap mean you must architect around recursion (explicit stacks, trampolines). Functional languages like Haskell or OCaml handle this more naturally.

### Q40. How would you instrument a production service to alert on stack-related anomalies?

- Periodic sampling of `runtime.MemStats.StackInuse / NumGoroutine` — alert if average rises 10× from baseline.
- Periodic sampling of `runtime.MemStats.StackSys` — alert if doesn't drop after spike subsides (potential pool leak).
- pprof scrape on alert — capture goroutine + heap profile for offline analysis.
- Crash budget — if process restarts due to stack overflow, page on-call immediately.
- Synthetic tests with adversarial input — fail CI if a malformed input causes overflow.
