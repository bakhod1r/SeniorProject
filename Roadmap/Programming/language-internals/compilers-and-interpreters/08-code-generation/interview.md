# Code Generation — Interview Questions

> **Topic:** [Code Generation](README.md)
> **Focus:** Probing whether a candidate understands the compiler back end — instruction selection, register allocation, scheduling, ABI lowering — and how real targets (x86-64, ARM, RISC-V, Wasm, LLVM) shape every decision.

---

## Introduction

These questions test whether a candidate can reason about the gap between optimized intermediate code and real machine instructions. A strong candidate distinguishes the three core sub-problems (selection, allocation, scheduling), knows the algorithms behind each (tree/DAG covering, graph coloring vs linear scan, list scheduling), understands *why* they conflict (the phase-ordering / pressure tension), and can connect the abstractions to specific targets and to tools (`-S`, `objdump`, `llc`). A weaker candidate talks about "the compiler optimizing" without naming a single mechanism.

The questions are grouped: **Conceptual** (the vocabulary and the three sub-problems), **Target-Specific** (x86-64, ARM, RISC-V, Wasm, LLVM backend), **Tricky / Trap** (where the obvious answer is wrong), and **Design** (build-a-back-end scenarios).

## Table of Contents

- [Conceptual](#conceptual)
- [Target-Specific](#target-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What are the three classic sub-problems of code generation, and in one line each, what does each solve?**

**Instruction selection** — map IR operations to target instructions (one instruction may implement several IR ops, like x86 `lea` or an FMA). **Register allocation** — assign the program's unlimited virtual registers to the target's few physical registers, spilling to the stack when they run out. **Instruction scheduling** — order instructions to hide latency and exploit instruction-level parallelism on pipelined/superscalar CPUs. A strong answer adds that the three *interact* (phase ordering) rather than being independent.

## Question 2

**Why isn't instruction selection just "one IR operation = one machine instruction"?**

Because real instruction sets offer instructions that do *more than one* IR operation: x86's `lea base, [b + i*4]` does a scaled multiply and an add; a fused multiply-add does `a*b + c`; an addressing mode folds an add and offset into a load. A good selector covers the IR tree with the largest, cheapest instruction "tiles," merging several IR ops into one instruction. Conversely, one IR op (a 128-bit add on a 64-bit target) may *split* into several instructions. The mapping is many-to-many.

## Question 3

**Explain instruction selection as a tree-covering problem, and contrast maximal munch with the DP/BURS approach.**

The IR expression is a tree; each instruction is a "tile" matching a subtree pattern at some cost. Selection covers the tree with non-overlapping tiles. **Maximal munch** is greedy — at each node pick the largest matching tile, recurse on the leftovers; simple, linear, good in practice, but not optimal. The **dynamic-programming / BURS (iburg)** approach computes the minimum-cost cover by considering, for each node, every matching tile plus the best costs of its sub-results; it's optimal *for trees* and is generated from a cost-annotated tree grammar. Real code is a DAG (shared subexpressions), where optimal covering is NP-hard, so DAG selectors use heuristics.

## Question 4

**Describe graph-coloring register allocation (Chaitin–Briggs).**

Compute each value's **live range** via liveness analysis. Build an **interference graph**: a node per value, an edge between values whose live ranges overlap. Color the graph with K colors (K = physical registers) so no two adjacent nodes share a color. The heuristic: **simplify** (repeatedly remove nodes of degree < K — always colorable later — onto a stack); if stuck, **spill** a chosen node; then **select** (pop and assign colors avoiding neighbors). Spilling inserts load/store code and you re-run. Briggs added *optimistic* coloring (push potential spills and try anyway) and conservative coalescing.

## Question 5

**What is spilling, and how does an allocator decide what to spill?**

Spilling is storing a value to a stack slot and reloading it because no register is free — correct but slow (memory traffic). The allocator spills the *cheapest* value, estimated by a spill-cost heuristic like `(uses weighted by 10^loop_depth) / interference_degree`: values used in deep loops are expensive to spill (high numerator), values that interfere with many others are attractive to spill (high denominator unblocks others). Modern allocators prefer **live-range splitting** (spill only the cold part of a range) and **rematerialization** (recompute cheap values) over wholesale spilling.

## Question 6

**Compare graph-coloring and linear-scan register allocation. When do you use each?**

Graph coloring builds and iterates an interference graph — high quality, good coalescing, but slow. Linear scan sorts live intervals by start point and sweeps left to right, assigning registers and expiring ended intervals — roughly O(n log n), lower quality but very fast. Use graph coloring (or SSA-based allocation) in an **ahead-of-time optimizing compiler** where run speed dominates; use linear scan in a **JIT or fast compiler** where compile time *is* run time (HotSpot C1, Go's compiler, many JS engines).

## Question 7

**What is instruction scheduling, and why does it matter even on out-of-order CPUs?**

Scheduling reorders instructions (preserving semantics) to keep the CPU's pipeline busy — e.g. issuing an independent instruction in the cycles a high-latency load takes to complete, instead of stalling. It's driven by a data-dependence DAG and typically done with list scheduling (greedily issue the highest-critical-path ready instruction). On out-of-order cores the hardware reorders too, so the compiler's schedule matters *less* — but it still matters for in-order cores (embedded, some phones), for not creating overly long dependence chains, and for keeping a load far from its use. On VLIW it's essential.

## Question 8

**What is the phase-ordering problem between scheduling and register allocation?**

Scheduling for instruction-level parallelism spreads independent work out, which keeps more values **alive simultaneously**, raising **register pressure** and risking spills. So: schedule-then-allocate gives a good schedule but may overshoot pressure and spill; allocate-then-schedule controls pressure but pins values to registers, creating false dependences that constrain the schedule. There's no globally optimal order. Real compilers compromise with **pressure-aware pre-RA scheduling**, **live-range splitting** instead of spilling, and **post-RA re-scheduling**.

## Question 9

**What does calling-convention (ABI) lowering involve in the back end?**

Materializing the ABI: placing outgoing arguments in the right registers/stack slots and reading the return value from the agreed register; classifying aggregates (split a struct across registers vs pass by hidden pointer / `sret`); handling varargs; generating the **prologue** (claim and align the stack frame, save used callee-saved registers, optionally set up the frame pointer) and matching **epilogue**; and laying out the stack frame (spill slots, locals, red zone / shadow space). Mistakes corrupt the stack silently.

## Question 10

**Caller-saved vs callee-saved registers — how does this affect allocation?**

Caller-saved (volatile) registers may be clobbered by a called function, so a value kept in one *across a call* must be spilled/reloaded around the call. Callee-saved (non-volatile) registers must be preserved, so using one costs one save/restore in the prologue/epilogue. Therefore values that live across calls prefer callee-saved registers; short-lived values prefer caller-saved. A good allocator models this cost.

## Question 11

**What is rematerialization and when is it better than spilling?**

Rematerialization recomputes a value at its use instead of spilling it to memory and reloading. It's better when the value is *cheap and side-effect-free* to recompute — a constant, a simple address computation (`lea`), a frame-relative offset. Then you pay one instruction instead of a stack store plus reload (memory traffic), and you avoid consuming a stack slot. It only applies to such cheap values; you can't rematerialize an expensive or side-effecting computation.

## Question 12

**Why is SSA form relevant to register allocation?**

The interference graph of a program in **SSA form is chordal**, and chordal graphs are **optimally colorable in polynomial time**. This means you can compute exact register pressure at every point and know the program is colorable with that many registers — splitting allocation into a clean **spill** phase (reduce pressure to ≤ K) and a **color** phase (guaranteed to succeed). The catch is **SSA destruction**: `phi` nodes become parallel copies on edges, and copy *cycles* (swaps) must be broken with a temporary or `xchg`.

---

## Target-Specific

## Question 13

**What about x86-64 makes instruction selection high-payoff and the assembler complex?**

x86-64 is CISC: **variable-length encoding** (1–15 bytes), **destructive two-operand** form (`add dst, src` overwrites `dst`), rich **addressing modes**, and powerful instructions like `lea` and memory-operand read-modify-writes. Selection is high-payoff because finding a big tile (e.g. folding a multiply-add into `lea`, or an add+offset into a load) saves real instructions and bytes. The assembler is complex precisely because of the variable-length, prefix-laden encoding. x86-64 is also register-poor (16 GPRs, several reserved), so allocation is tight.

## Question 14

**Show how x86 `lea` is used for plain arithmetic, and why a selector picks it.**

`lea dst, [base + index*scale + disp]` computes an address *without touching memory* — but the "address" is just arithmetic: `base + index*scale + disp` with scale ∈ {1,2,4,8}. So `a*4 + b` becomes `lea rax, [rbx + rdi*4]` — one instruction, three operands, non-destructive (doesn't clobber inputs, unlike `add`/`imul`), and it doesn't touch the condition flags. The selector picks it because it fuses a scaled multiply and an add into a single cheap instruction that also frees the inputs.

## Question 15

**How does AArch64 (ARM64) differ from x86-64 for code generation?**

AArch64 is RISC: **fixed 4-byte** instructions, **31 GPRs + 32 vector registers** (register-rich → fewer spills), **three-operand non-destructive** form, and useful composite operands like **shifted-register** (`add x0, x1, x2, lsl 2`) and extended-register. Selection is cleaner (smaller, more uniform tiles, though shifted operands give some fusion); the encoding is simple and fixed-width; the larger register file relieves allocation pressure. Note ARM64 dropped most of ARM32's pervasive conditional execution (predication) — only a few conditional-select instructions remain.

## Question 16

**What is notable about RISC-V as a code-generation target?**

RISC-V is a deliberately **minimal, clean RISC** ISA: a small base integer instruction set plus optional, modular **extensions** (M = multiply/divide, A = atomics, F/D = float, C = compressed 16-bit encodings, V = vector). Selection is simple and uniform; there are no surprising CISC tiles. The back end must respect *which* extensions the subtarget actually has (no `mul` without M; no vectors without V), and the **C** extension reintroduces some size optimization by allowing 16-bit forms of common instructions. Its regularity makes it a popular teaching and research target.

## Question 17

**Why is WebAssembly a fundamentally different code-generation target?**

Wasm is a **structured stack machine**, not a register machine. Operands live on an **operand stack** and in indexed **locals**; control flow is **structured** (`block`/`loop`/`if` and `br` to labels — no arbitrary `goto`). So a back end targeting Wasm does **no classical register allocation** (there are no registers to allocate) and must **reconstruct structured control flow** from a general CFG (the relooper / stackify problem; irreducible control flow needs extra work). The *real* register allocation happens later, inside the Wasm engine's own JIT when it compiles Wasm to native code — a double-compilation.

## Question 18

**Walk through LLVM's back-end pipeline at a high level.**

Optimized LLVM IR enters the back end. The classic path builds a per-block **SelectionDAG**, **legalizes** illegal types/operations, runs **DAG combines**, **selects** instructions (patterns mostly generated from TableGen), and schedules into `MachineInstr`s. **Register allocation** (LLVM's greedy allocator with live-range splitting/rematerialization) runs on Machine IR, SSA is destroyed, then post-RA **scheduling** and a final **peephole** run. The **MC layer** encodes `MCInst`s to bytes, emits relocations and the object file plus DWARF. The newer **GlobalISel** path (IRTranslator → Legalizer → RegBankSelect → InstructionSelect) is SSA-based and global, default at `-O0` on AArch64.

## Question 19

**What is LLVM TableGen and what role does it play in code generation?**

TableGen is LLVM's declarative DSL describing a target: registers and register classes (and how they alias), instructions (operands, **bit encoding**, assembly syntax, and the **DAG selection pattern** they match), calling conventions, and the scheduling model. `llvm-tblgen` generates the C++ for the instruction selector's matcher, the encoder/decoder, register info, and scheduling tables. The payoff: adding an instruction or an ISA extension is mostly *adding records*, keeping selection, encoding, and disassembly in sync. A wrong encoding record assembles but miscompiles — hence round-trip testing.

## Question 20

**SelectionDAG vs GlobalISel — what's the trade-off?**

SelectionDAG is mature, with powerful DAG combines and TableGen pattern matching, but it's **per-basic-block** (no global selection) and pays a real compile-time cost building/legalizing the DAG. GlobalISel is **SSA-based and global**, working directly on Machine IR through staged passes; it's faster at `-O0`, cleaner and more debuggable, and the default for AArch64 at `-O0`. The trade-off: GlobalISel reduces compile time and enables global reasoning, but outside well-supported targets it's less mature and can trail SelectionDAG's code quality at high optimization.

---

## Tricky / Trap

## Question 21

**A function got slower after you added one local variable. Why might that happen?**

Register pressure crossed the K threshold. The extra variable, alive across a hot loop, pushed the number of simultaneously-live values above the physical register count, forcing the allocator to **spill** — inserting stack stores/reloads in the hot path. The source change looks trivial, but it tipped a cost cliff. The fix: reduce simultaneously-live values, shorten live ranges, or split the function so each piece has its own register budget.

## Question 22

**You see `x * 8` compiled to a `shl` or folded into a `lea`. Is the compiler ignoring your multiply?**

No — that *is* the multiply. Multiplying by a power-of-two constant is strength-reduced to a shift, or folded into `lea`'s scale, because those are cheaper than a general `imul`. Instruction selection found the cheaper tile. Candidates who think the compiler "dropped" the multiply, or who manually write `x << 3` to "help," misunderstand selection — the clear form usually selects best.

## Question 23

**Your code works on x86-64 but the *generated assembly* looks totally different on AArch64 at the same `-O2`. Is the ARM compiler worse?**

No — different ISA, different instruction count and shape. x86 folds operations into `lea` and complex addressing; ARM expresses the same work with shifted-register operands and more, simpler fixed-width instructions; RISC-V more so. More instructions on RISC isn't "worse" — each is simpler and the register file is larger. Comparing raw instruction counts across architectures is meaningless; compare actual performance on each target.

## Question 24

**A JIT-compiled function runs correctly on x86 but crashes on ARM. The codegen is identical. What's the likely cause?**

A missing **instruction-cache flush**. On x86 the I-cache is effectively coherent with stores, so freshly written code runs. On ARM/AArch64 (and RISC-V) the I-cache is *not* coherent with data writes — after emitting code you must flush/invalidate the I-cache (e.g. `__builtin___clear_cache`, then `isb`) or the CPU executes stale bytes. "Works on Intel, crashes on the phone" is the classic signature.

## Question 25

**You're told "we use only atomics and a custom allocator, so our JIT has no concurrency bugs in code patching." Believe it?**

No. Patching code another thread is currently *executing* is the hazard, independent of how you allocate memory. If a rewrite isn't a single atomically-visible, instruction-aligned store (or done only at a safepoint where no thread is mid-instruction), another thread can fetch a half-written instruction and crash. Atomics on your data structures don't make instruction-stream patching safe; the patch point itself must be atomic or safepoint-guarded.

## Question 26

**At `-O2`, your debugger shows a variable as `<optimized out>` in part of the function and a plausible-but-wrong value elsewhere. What's going on?**

Live-range splitting plus DWARF location lists. The allocator moved the variable: in a register for one instruction range, on the stack for another, and **dead** (so `<optimized out>`) where it's no longer used. If the DWARF location list is stale or slightly wrong, the debugger reads the wrong register/slot and shows a confidently incorrect value. The variable didn't vanish; its *location* changes across the code, and the debug info must track that movement.

## Question 27

**Does the compiler's careful instruction scheduling still matter on a modern out-of-order x86 server core?**

Less than people think, but not zero. The out-of-order engine reorders at runtime, recovering much of what a perfect compiler schedule would gain. What still matters: not creating excessively long dependence chains, keeping register pressure manageable, and good code layout for the front end. On **in-order** cores (embedded, some efficiency cores) and **VLIW**, compiler scheduling is decisive. So "scheduling is obsolete" is wrong — it's target-dependent.

## Question 28

**You wrote inline assembly that uses `r12` and forgot to save it. The program corrupts data far from your code. Why?**

`r12` is **callee-saved** in the System V AMD64 ABI: any function that uses it must save and restore it. By clobbering it without saving, you destroyed a value the *caller* (or its caller) was relying on across your call. The corruption shows up far away, in unrelated code, when that older value is finally read. The compiler-generated code never makes this mistake; hand-written assembly that ignores the ABI does, and the failure is non-local and baffling.

## Question 29

**Aggressively coalescing every copy to remove `mov`s made your allocation *spill more*. How?**

Coalescing merges two copy-related values into one node. That merged node inherits *both* values' interference edges, so its **degree can rise above K**, making the graph harder to color and forcing a spill that costs more than the `mov` you saved. This is why allocators use **conservative coalescing** (only coalesce when the result stays safely colorable). Removing copies is good; doing it blindly backfires.

## Question 30

**Your `-fPIC` build is slightly slower than `-fno-pic` for the same code. Why, and is it a bug?**

Not a bug — it's the cost of position independence. PIC accesses some globals through the **GOT**, an extra memory indirection (load the address from the table, then load the value), and uses `rip`-relative addressing. That indirection costs a little. It buys shared-library support and ASLR. The back end and ABI minimize it (local symbols use direct `rip`-relative access without the GOT), but a residual cost for externally-visible globals is expected.

---

## Design

## Question 31

**Design the register allocator for a new JIT that must compile in well under a millisecond per method. What do you choose and why?**

Linear scan (or a linear-scan variant with lifetime holes / second-chance binpacking). Rationale: compile time *is* run time in a JIT, and graph coloring's interference-graph construction and iteration are too slow. Use SSA to compute pressure cheaply, do simple live-range splitting only around loops, prefer rematerialization for constants, and accept slightly worse code in the fast tier. Reserve graph-coloring-quality allocation (if at all) for an upper, profile-gated optimizing tier where the method is proven hot enough to amortize the cost.

## Question 32

**Design instruction selection for a target with a fused multiply-add (FMA). How do you make sure the selector uses it?**

Express FMA as a single instruction tile matching the IR pattern `(add (mul a b) c)` (and the fused/contracted form the middle end produces), with a cost lower than separate multiply + add. In a table-driven back end, that's a TableGen pattern `[(set $d, (fadd (fmul $a, $b), $c))]`. Ensure the middle end is allowed to *form* the fused node (floating-point contraction is only legal under fast-math / `contract` because it changes rounding), and order DAG combines so the multiply-add fuses before selection. Then verify with `-S` that `vfmadd...` appears.

## Question 33

**You're scheduling a tight loop on an in-order core and hitting load latency. Walk through your options.**

Build the dependence DAG, identify the critical path, and use **list scheduling** to fill the cycles between a load and its use with independent work. If a single iteration can't hide the latency, **software-pipeline** the loop (modulo scheduling): overlap iterations so, in steady state, the load for iteration i+2, the compute for i+1, and the store for i all issue together — maximizing ILP. Watch register pressure (overlapping iterations keep multiple iterations' values alive); throttle the unroll/pipeline depth so you don't spill away the gain. On an out-of-order core, less of this is needed.

## Question 34

**Design the ABI-lowering pass for a new platform. What must it handle?**

Argument and return placement per the calling convention (which registers, in what order, for each operand class); aggregate classification (split a struct across registers vs pass by hidden pointer; `sret` for large returns); varargs; stack alignment (e.g. 16-byte before a call); the prologue (claim/align frame, save *used* callee-saved registers, set up or omit the frame pointer) and matching epilogue; spill-slot and local layout, including any red zone or shadow-space rules. It must also emit correct **CFI** so unwinding works at every prologue/epilogue step. Get aggregate classification and stack alignment right first — those are the silent-corruption sources.

## Question 35

**Design a code generator that targets WebAssembly from a CFG-based IR. What are the hard parts?**

The CFG has arbitrary jumps; Wasm has only structured control flow (`block`/`loop`/`if`/`br` to labels). So the hard part is the **relooper / stackifier**: reconstruct nested structured control flow from the CFG, handling **irreducible** control flow (loops with multiple entries) by node-splitting or a dispatch loop. There's **no register allocation** — you manage the operand stack and indexed locals instead, deciding what to keep in locals vs recompute. Types must be legalized to Wasm's value types. You then rely on the Wasm engine's own JIT to do the real machine-code register allocation downstream.

## Question 36

**Design a peephole optimizer for the final machine-instruction stream. What rules, and what safety constraints?**

Rules: delete redundant/self moves, strength-reduce constant multiplies to shifts/`lea`, fuse `shl`+`add` into `lea`, rewrite `cmp x,0` to `test x,x`, fold compares into flag-setting arithmetic, remove jumps to the next instruction, simplify branch chains. Safety: every rewrite must be **provably semantics-preserving on the target** — respect condition-flag liveness (don't drop a flag a later branch reads), side effects, and exact encodings. Scope is local (a small window). Verify rules by differential testing; a peephole that silently drops a flag side effect is a miscompile.

## Question 37

**You must bring up a new ISA extension (say, new vector instructions) in an LLVM-style back end. Outline the work.**

Mostly TableGen: add register classes for the new vector registers (and aliasing), add instruction records with their **encodings**, **assembly syntax**, and **selection patterns** (the IR DAG shapes they implement), wire them into the **calling convention** if they carry arguments/returns, and add a **scheduling model** (latency/throughput/ports) for the subtargets that have them. Gate everything on a subtarget feature flag so only chips with the extension select them. Then legalize the relevant IR types to use them, and **round-trip test** (assemble → disassemble) every encoding to catch wrong bit fields before they ship as silent miscompiles.

## Question 38

**Design the debug-info generation for an optimizing compiler so that production crashes at `-O2` are diagnosable. What do you emit and what's hard?**

Emit DWARF: a **line table** (address → source line, kept as accurate as scheduling/inlining allow), **variable location lists** (where each variable lives across each instruction range, since allocation splits ranges between registers and stack), and **CFI** (how to unwind at every instruction, since the frame pointer is often omitted at `-O2`). Generate it *as* you lay out code and assign registers, not afterward. The hard parts: keeping location lists honest as live ranges split (a stale list makes the debugger show wrong values), and emitting CFI correct at every prologue/epilogue step so a signal mid-prologue still unwinds. Test the debug info, not just the code.
