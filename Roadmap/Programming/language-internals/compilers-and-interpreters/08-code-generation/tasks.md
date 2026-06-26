# Code Generation — Tasks & Exercises

> **Topic:** [Code Generation](README.md)
> **Focus:** Hands-on exercises for reading and reasoning about the back end — instruction selection, register allocation, scheduling, ABI lowering — using real compiler output and small algorithm implementations.

---

## How to Use This Page

Each task states a goal, a **self-check** so you know when you've succeeded, a **hint** if you're stuck, and a **sparse solution** (the key idea or commands, not a full walkthrough). Resist reading the solution first — the value is in producing the answer yourself. Most tasks need only a C compiler (`gcc` or `clang`), `objdump`, and optionally `llc`/`clang` for LLVM IR. A few are pure pen-and-paper or small scripts.

Tasks are grouped:

- **A. Reading Generated Code** — observe selection, allocation, scheduling in real output.
- **B. Instruction Selection** — tree covering and pattern matching by hand and in code.
- **C. Register Allocation** — interference graphs, coloring, spilling, linear scan.
- **D. Scheduling** — dependence DAGs and list scheduling.
- **E. ABI & Targets** — calling conventions, x86 vs ARM vs RISC-V vs Wasm.
- **F. Capstone** — build a tiny back end for a toy expression language.

---

## A. Reading Generated Code

### Task A1 — See the three sub-problems in one function

Compile a small function to assembly and identify, by line, where instruction selection, register allocation, and ABI lowering each show up.

```c
int f(int *base, int i) { return base[i] + 7; }
```

**Self-check:** You can point at (a) the single instruction that did the scaled-load (selection folding a multiply + add into an addressing mode), (b) which physical registers the arguments arrived in and where the result went (allocation/ABI), and (c) why there's no spill.

<details>
<summary>Hint</summary>

`gcc -O2 -S` it. Look for a `mov ...,[reg + reg*4]` form and the `eax`/`rdi`/`esi` registers.
</details>

<details>
<summary>Sparse solution</summary>

```bash
gcc -O2 -S a1.c -o a1.s
```
Expect `mov eax, [rdi + rsi*4]` (selection folded `i*4 + base` into the load), `rdi`/`esi` are the System V argument registers, `eax` is the return register. No spill because only ~2 values are alive.
</details>

---

### Task A2 — Make the compiler emit `lea`

Write a function whose natural compilation uses x86 `lea` to do arithmetic (not memory access), and confirm it.

**Self-check:** Your `-S` output contains a `lea` instruction performing `base + index*scale + disp`-style arithmetic, and you can explain why the selector preferred it over `imul`+`add`.

<details>
<summary>Hint</summary>

Something like `a * 4 + b` or `5 * x` (which becomes `lea rax, [rax + rax*4]`).
</details>

<details>
<summary>Sparse solution</summary>

```c
long g(long a, long b) { return a*4 + b; }   // -> lea rax, [rsi + rdi*4]
long h(long x)         { return x*5; }        // -> lea rax, [rdi + rdi*4]
```
`lea` is preferred: one non-destructive instruction, doesn't touch flags, fuses scale + add.
</details>

---

### Task A3 — Force and recognize a spill

Write a function with enough simultaneously-live values to force register spilling, then point at the spill code.

**Self-check:** The `-O2` assembly contains `mov [rsp+N], reg` / `mov reg, [rsp+N]` pairs for the *same* offset, and reducing the number of live values removes them.

<details>
<summary>Hint</summary>

Create ~12 long values that must *all* still be alive at the final expression (use each one in the return).
</details>

<details>
<summary>Sparse solution</summary>

Sum and cross-multiply ten-plus arguments in one return expression (see `spill.c` pattern from the junior page). Grep the output:
```bash
gcc -O2 -S a3.c -o a3.s && grep -E 'rsp' a3.s
```
The `mov [rsp+N], ...` / `mov ..., [rsp+N]` pairs are spills. Splitting the work across two smaller functions removes them.
</details>

---

### Task A4 — Compare `-O0` and `-O2`

Compile the same function at `-O0` and `-O2`, diff the assembly, and attribute each difference to a back-end pass.

**Self-check:** You can label differences as "register allocation kept this in a register instead of the stack," "scheduling reordered these," "the frame pointer was omitted," or "this redundant load was eliminated."

<details>
<summary>Hint</summary>

`-O0` keeps everything on the stack and maps cleanly to source; `-O2` lives in registers and reorders.
</details>

<details>
<summary>Sparse solution</summary>

```bash
gcc -O0 -S x.c -o x_O0.s ; gcc -O2 -S x.c -o x_O2.s ; diff x_O0.s x_O2.s
```
`-O0`: explicit `push rbp; mov rbp,rsp`, every local on the stack. `-O2`: values in registers, FP often omitted (`-fomit-frame-pointer` default), instructions reordered, redundant memory traffic gone.
</details>

---

### Task A5 — Same source, three targets

Cross-compile one function to x86-64, AArch64, and RISC-V; compare how the same operation is expressed.

**Self-check:** You can show the same multiply-add as an x86 `lea`, an AArch64 shifted-register `add`, and a RISC-V `slli`+`add` (or `sh2add` with the Zba extension), and explain why instruction counts differ.

<details>
<summary>Hint</summary>

Use cross compilers: `aarch64-linux-gnu-gcc`, `riscv64-linux-gnu-gcc` (or `clang --target=`).
</details>

<details>
<summary>Sparse solution</summary>

```bash
gcc -O2 -S m.c -o m_x86.s
aarch64-linux-gnu-gcc -O2 -S m.c -o m_arm.s
riscv64-linux-gnu-gcc -O2 -S m.c -o m_rv.s
```
x86: `lea`. ARM: `add x0, x1, x0, lsl 2`. RISC-V (base): `slli` then `add` (two instructions) — RISC has smaller tiles, so more instructions, but each is simpler and the register file is larger.
</details>

---

## B. Instruction Selection

### Task B1 — Tile a tree by hand

Given the IR tree for `load(add(base, mul(i, 4)))` and the tiles `{ADD reg,imm; MUL reg,imm; LOAD [reg]; LOAD [base+index*scale]}`, find (a) the maximal-munch cover and (b) the minimum-cost cover. Assume every tile costs 1.

**Self-check:** Both methods here pick the single `LOAD [base+index*scale]` tile (cost 1) over the three-tile cover (cost 3); you can state when greedy and optimal would *diverge*.

<details>
<summary>Hint</summary>

The big load tile matches the whole tree. Greedy and DP agree when the largest tile is also globally cheapest; they diverge when a big tile leaves an expensive remainder.
</details>

<details>
<summary>Sparse solution</summary>

Both choose `LOAD [base + i*4]` (cost 1). Divergence example: a root tile that's cheap but forces its two children into a costly form, where two medium tiles would total less — there DP wins, maximal munch loses.
</details>

---

### Task B2 — Implement maximal munch

Write a maximal-munch selector over a small expression-tree representation that emits pseudo-assembly, including the folded `load [base + index*4]` tile.

**Self-check:** For `load(add(base, mul(i, 4)))` your selector emits a single `mov d, [base + i*4]`; for `load(add(base, x))` (no `*4`) it falls back to computing the address then `mov d, [addr]`.

<details>
<summary>Hint</summary>

When matching `load`, peek into the address subtree for the `add(_, mul(_, const4))` shape before falling back.
</details>

<details>
<summary>Sparse solution</summary>

See the `munch` function in the middle page — match the largest tile first (peek into `load`'s address for `[base+index*4]`), recurse on the leftover subtrees, fall back to smaller tiles. Test both shapes.
</details>

---

### Task B3 — Add a fused multiply-add tile

Extend your B2 selector with an FMA tile matching `add(mul(a, b), c)` at lower cost than separate `mul` + `add`, and confirm it fires on `a*b + c` but not on `a*b + c*d` at the top.

**Self-check:** `add(mul(a,b), c)` selects one `fma d, a, b, c`; `add(mul(a,b), mul(c,d))` cannot use a single FMA at the root (only one of the two products fuses).

<details>
<summary>Hint</summary>

Match `add` whose *left* child is a `mul`; the right child is the addend `c`. If both children are `mul`, you can fuse at most one.
</details>

<details>
<summary>Sparse solution</summary>

Add a case: if `node == add(mul(a,b), c)`, emit `fma`; else fall back to `mul` then `add`. For `add(mul,mul)`, fuse one product into an FMA and emit a plain `mul` for the other (or fuse the other side) — you cannot cover both multiplies with one FMA.
</details>

---

## C. Register Allocation

### Task C1 — Build an interference graph

Given this straight-line code, list each value's live range and draw the interference graph.

```text
a = 1          ; def a
b = 2          ; def b
c = a + b      ; def c,  last use a, b
d = c + 1      ; def d,  last use c
ret d          ;         last use d
```

**Self-check:** Your live ranges are a:[1–3], b:[2–3], c:[3–4], d:[4–5]; the only interference edges are a–b (both alive at line 3's def of c) — c and d never overlap a/b. The graph is 2-colorable.

<details>
<summary>Hint</summary>

Two values interfere if both are alive at the same program point (specifically, a value interferes with whatever is live where it's defined).
</details>

<details>
<summary>Sparse solution</summary>

Edges: {a,b}. So `a` and `b` need different registers; `c` can reuse `a`'s or `b`'s register; `d` can reuse `c`'s. Minimum registers (chromatic number) = 2.
</details>

---

### Task C2 — Color with K registers and force a spill

Take the interference graph of a small function (or build a synthetic one with a clique of size K+1) and run simplify/spill/select with K = 3. Show which node spills.

**Self-check:** A clique of 4 nodes is not 3-colorable, so simplify gets stuck (every node has degree 3 ≥ K) and exactly one node must be spilled; you can name a spill-cost reason for choosing one.

<details>
<summary>Hint</summary>

In a 4-clique every node has degree 3. With K=3, simplify can't remove any node (need degree < K), so you must spill.
</details>

<details>
<summary>Sparse solution</summary>

Implement the `color(nodes, adj, K)` routine from the middle page. On a 4-clique with K=3 it spills one node (pick the lowest spill-cost = fewest uses / highest degree). After spilling, the remaining 3-clique is 3-colorable.
</details>

---

### Task C3 — Spill-cost decision

Two values are spill candidates: `x` used 3 times inside a loop nested 2 deep with interference degree 4; `y` used 5 times outside any loop with degree 2. Using `cost = (sum 10^loop_depth over uses) / degree`, which do you spill?

**Self-check:** You compute `cost(x) = 3·10² / 4 = 75` and `cost(y) = 5·10⁰ / 2 = 2.5`, so you spill `y` (far cheaper). You can explain why loop depth dominates.

<details>
<summary>Hint</summary>

`10^loop_depth` makes loop-resident uses enormously more expensive to spill.
</details>

<details>
<summary>Sparse solution</summary>

Spill `y` (cost 2.5) and keep `x` in a register (cost 75). The deep-loop value must stay in a register; the cheaper-to-spill flat-region value goes to the stack.
</details>

---

### Task C4 — Implement linear scan

Implement linear-scan allocation over a list of live intervals and compare its assignment to an optimal coloring on a small example where they differ.

**Self-check:** Your allocator sweeps intervals by start, expires ended intervals, assigns free registers, and spills the latest-ending active interval when out of registers; you can construct an input where linear scan spills but graph coloring would not (lifetime holes).

<details>
<summary>Hint</summary>

Linear scan treats an interval as contiguous even when the value is dead in the middle ("lifetime hole"), so it can hold a register it doesn't need.
</details>

<details>
<summary>Sparse solution</summary>

Use the `linear_scan` routine from the middle page. A value alive [1–10] but unused [3–8] blocks a register the whole time under plain linear scan; an interference-graph allocator (or interval-splitting linear scan) sees the hole and reuses the register, avoiding a spill.
</details>

---

### Task C5 — Callee-saved vs caller-saved

Write a function that calls another function in the middle and keeps a value alive across the call. Inspect whether the compiler put that value in a callee-saved register or spilled it around the call.

**Self-check:** You can show that a value live across a call is either in a callee-saved register (saved once in the prologue) or stored/reloaded around the `call`, and explain the trade-off.

<details>
<summary>Hint</summary>

`long v = compute(); other(); return v + 1;` — `v` must survive the `other()` call.
</details>

<details>
<summary>Sparse solution</summary>

```bash
gcc -O2 -S c5.c -o c5.s
```
Look for `v` in a callee-saved register like `rbx`/`r12` (with a `push rbx`/`pop rbx` in prologue/epilogue) — preferred for cross-call values — or a spill `mov [rsp+N], ...` around the `call`. Callee-saved costs one save/restore; per-call spilling costs per call.
</details>

---

## D. Scheduling

### Task D1 — Build a dependence DAG

For this block, draw the data-dependence DAG and identify the true/anti/output dependences.

```text
1: r1 = load [p]
2: r2 = r1 + 4
3: r3 = load [q]
4: r1 = r3 * 2     ; reuses r1
```

**Self-check:** True: 1→2 (2 reads r1). Anti: 2→4 (4 writes r1 that 2 read). Output: 1→4 (both write r1). Lines 1 and 3 are independent and can be reordered.

<details>
<summary>Hint</summary>

True = read-after-write; anti = write-after-read; output = write-after-write.
</details>

<details>
<summary>Sparse solution</summary>

Edges: 1→2 (true), 2→4 (anti, because 4 overwrites r1 that 2 read), 1→4 (output). 1 and 3 have no dependence — independent loads, schedulable in either order or in parallel.
</details>

---

### Task D2 — Hide load latency by reordering

Given a load with latency 4 followed immediately by an add that uses it, and two independent instructions available, schedule to eliminate the stall.

**Self-check:** Your schedule issues the load, then the two independent instructions (filling the latency cycles), then the dependent add — no stall — versus the naive order that stalls ~3 cycles.

<details>
<summary>Hint</summary>

Move the independent work *between* the load and its consumer.
</details>

<details>
<summary>Sparse solution</summary>

Naive: `load; add(uses load)` → stall while the load completes. Scheduled: `load; indep1; indep2; add` → the two independent instructions execute during the load's latency, so the result is ready when `add` issues.
</details>

---

### Task D3 — Implement list scheduling

Implement list scheduling over a dependence DAG with per-instruction latencies, using critical-path length as the priority, and verify it beats a random topological order on a small example.

**Self-check:** Your scheduler issues the highest-critical-path ready instruction each step and produces a total cycle count ≤ a naive ordering; you can explain why prioritizing the critical path helps.

<details>
<summary>Hint</summary>

Critical-path length = longest latency-weighted path from a node to any DAG leaf; compute it bottom-up.
</details>

<details>
<summary>Sparse solution</summary>

Use the `list_schedule` routine from the middle page. Compute `prio` = critical-path length, maintain a ready set, repeatedly issue the highest-priority ready node. On a DAG with one long latency chain and several short ones, prioritizing the chain keeps the bottleneck moving and shortens total cycles.
</details>

---

### Task D4 — Observe the scheduling/pressure conflict

Compile a reduction loop at `-O2` and `-O3` and observe how unrolling for ILP increases the number of registers (accumulators) used.

**Self-check:** At `-O3` the loop uses multiple accumulator registers (breaking the dependence chain on the running sum) and correspondingly more registers; you can articulate that more ILP costs more register pressure.

<details>
<summary>Hint</summary>

A `for` loop doing `s += a[i]*b[i]` is latency-bound on `s`; the compiler unrolls with several `s` accumulators.
</details>

<details>
<summary>Sparse solution</summary>

```bash
gcc -O3 -S dot.c -o dot.s   # multiple xmm accumulators, possibly FMA
```
Several `xmm` registers accumulate partial sums in parallel — more ILP, more registers. That's the scheduling-vs-pressure trade-off made visible.
</details>

---

## E. ABI & Targets

### Task E1 — Identify the prologue and epilogue

Compile a function with a local array at `-O0` and annotate the prologue (frame setup) and epilogue (teardown).

**Self-check:** You can point at `push rbp; mov rbp, rsp; sub rsp, N` (prologue) and `leave`/`mov rsp,rbp; pop rbp; ret` (epilogue) and explain what each does.

<details>
<summary>Hint</summary>

Use `-O0` so the frame is explicit; at `-O2` the frame pointer is often omitted.
</details>

<details>
<summary>Sparse solution</summary>

```bash
gcc -O0 -S e1.c -o e1.s
```
Prologue: save old `rbp`, set `rbp = rsp`, subtract frame size from `rsp`. Epilogue: restore `rsp`, pop `rbp`, `ret`. This is the ABI's stack-frame contract.
</details>

---

### Task E2 — Map arguments to registers

For a function with six integer parameters, identify which registers each argument arrives in under the System V AMD64 ABI, and what happens to a seventh argument.

**Self-check:** You list `rdi, rsi, rdx, rcx, r8, r9` for the first six integer args and show the seventh passed on the stack.

<details>
<summary>Hint</summary>

System V passes the first six integer/pointer args in registers; the rest go on the stack.
</details>

<details>
<summary>Sparse solution</summary>

```c
long f(long a,long b,long c,long d,long e,long f7,long g) { return a+b+c+d+e+f7+g; }
```
`gcc -O2 -S` shows `a..f7` in `rdi,rsi,rdx,rcx,r8,r9`; `g` loaded from `[rsp+8]` (passed on the stack by the caller).
</details>

---

### Task E3 — PIC vs non-PIC

Compile a function that reads a global with `-fno-pic` and `-fPIC` and explain the difference in how the global is addressed.

**Self-check:** The `-fno-pic` version uses an absolute or simple `rip`-relative load; the `-fPIC` version reaches an externally-visible global through the GOT (`[rip + sym@GOTPCREL]`), an extra indirection.

<details>
<summary>Hint</summary>

`extern int g; int r(){ return g; }`
</details>

<details>
<summary>Sparse solution</summary>

```bash
gcc -O2 -fno-pic -S e3.c -o nopic.s
gcc -O2 -fPIC   -S e3.c -o pic.s
```
PIC: `mov rax, [rip + g@GOTPCREL]; mov eax, [rax]` — load the address from the GOT, then the value. The indirection is the cost of position independence.
</details>

---

### Task E4 — Wasm has no registers

Compile a small function to WebAssembly and confirm there is no register allocation — values flow through the operand stack and locals, with structured control flow.

**Self-check:** The `.wat` output uses `local.get`/`local.set` and `f32.add`-style stack operations and `loop`/`block`/`br_if`, with no register names; you can explain that the real register allocation happens in the Wasm engine's JIT later.

<details>
<summary>Hint</summary>

`clang --target=wasm32 -O2 -S file.c -o file.wat`
</details>

<details>
<summary>Sparse solution</summary>

```bash
clang --target=wasm32 -O2 -S e4.c -o e4.wat
```
You'll see operand-stack ops and structured control flow, no registers. Codegen here manages the stack and locals; the engine (V8, Wasmtime) does machine-level register allocation when it compiles the Wasm.
</details>

---

### Task E5 — Break the ABI on purpose (and observe the damage)

In inline assembly, clobber a callee-saved register without declaring it as clobbered, and observe the resulting corruption.

**Self-check:** You can produce wrong output or a crash, and explain that clobbering a callee-saved register (e.g. `rbx`, `r12`) without saving/declaring it violates the contract the caller relies on.

<details>
<summary>Hint</summary>

Use GCC inline asm that writes `rbx` but omits it from the clobber list — undefined behavior, but instructive.
</details>

<details>
<summary>Sparse solution</summary>

Inline asm that does `mov $0, %%rbx` without `"rbx"` in the clobber list (or without saving it) corrupts a value the caller kept in `rbx` across the asm block. The compiler trusted you to preserve it. Declaring the clobber (or saving/restoring) fixes it — this is exactly what the back end does automatically.
</details>

---

## F. Capstone

### Task F1 — A tiny back end for an expression language

Build a minimal back end that takes an arithmetic-expression IR tree (constants, variables, `+`, `*`, `load[addr]`) and emits pseudo-assembly for a register machine with K registers. Implement: maximal-munch selection (including a folded `[base+index*4]` load and a multiply-add), a simple linear-scan allocator over the resulting virtual registers, and a basic list scheduler over the emitted instructions' dependence DAG.

**Self-check:** Given an expression with more live values than K, your back end spills correctly (emits store/reload) and still produces semantically correct pseudo-assembly; given an expression matching the fused tiles, it emits the single fused instruction; the scheduler keeps a `load` away from its immediate use when independent work exists.

<details>
<summary>Hint</summary>

Stage it: (1) selection produces instructions over *virtual* registers; (2) compute live intervals from that linear instruction list; (3) linear-scan to physical registers, inserting spills; (4) build the dependence DAG and list-schedule. Reuse the routines from the middle page.
</details>

<details>
<summary>Sparse solution</summary>

Pipeline the four middle-page routines: `munch` (selection, emitting fused tiles where matched) → liveness over the instruction list → `linear_scan` (assigning physical registers, marking spills `STACK` and inserting store/reload) → `list_schedule` over the dependence DAG. Test with: a deeply-nested expression (forces spills with small K), `a*b+c` (forces an FMA), and `base[i]` (forces the folded load). Verify correctness by interpreting the emitted pseudo-assembly and comparing to evaluating the IR directly.
</details>

---

### Task F2 — Add a peephole pass

Add a final peephole pass to your F1 back end that deletes self-moves (`mov r, r`), strength-reduces multiply-by-power-of-two into shifts, and removes a `mov` whose result is immediately overwritten before use.

**Self-check:** On output containing those patterns, your peephole produces shorter, semantically identical pseudo-assembly; you can argue each rewrite is safe (no flag/side-effect dependence in your toy ISA).

<details>
<summary>Hint</summary>

Scan a sliding window of 1–2 instructions; rewrite only when provably equivalent. In a toy ISA with no condition flags, the safety check is just "is the overwritten value used in between?"
</details>

<details>
<summary>Sparse solution</summary>

Window-scan the instruction list: drop `mov r,r`; replace `mul r, 8` with `shl r, 3`; if instruction `i` writes `r` and instruction `i+1` overwrites `r` with no read of `r` between, delete instruction `i`. Re-run until no change. Verify by re-interpreting the result equals the pre-peephole result.
</details>

---

### Task F3 — Reflective write-up

Write a one-page note: for your toy back end, where did the phase-ordering conflict appear? Did scheduling before allocation raise pressure? Would post-allocation re-scheduling have helped? What would change if your target were a stack machine (Wasm-like) instead of a register machine?

**Self-check:** Your note concretely identifies a case where exposing parallelism in scheduling increased simultaneously-live values (pressure), and correctly states that a stack-machine target removes classical register allocation entirely (you'd manage an operand stack and reconstruct structured control flow instead).

<details>
<summary>Hint</summary>

Re-run F1 with scheduling before vs after allocation and count peak live values in each.
</details>

<details>
<summary>Sparse solution</summary>

Expect: scheduling-before-allocation spreads independent ops out, raising peak live values and causing more spills at small K; allocating first constrains the schedule via reused-register false dependences; a light post-RA re-schedule recovers some freedom. For a stack-machine target, you'd drop the allocator, manage the operand stack + locals, and solve the relooper/stackify problem for control flow — the register-allocation chapter of the back end disappears, replaced by stack scheduling.
</details>
