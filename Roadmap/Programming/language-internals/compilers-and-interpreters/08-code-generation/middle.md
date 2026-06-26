# Code Generation — Middle Level

> **Topic:** [Code Generation](README.md)
> **Focus:** The algorithms behind the back end: tree-pattern instruction selection, graph-coloring and linear-scan register allocation, and list scheduling over a dependence DAG.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)

---

## Introduction

> Focus: **How does the back end actually decide?** The junior page named the three sub-problems. This page gives you the algorithms that solve them — and the costs and trade-offs baked into each.

At the junior level, code generation was three jobs — selection, allocation, scheduling — described in plain language. Now we make them mechanical. Each is a real algorithmic problem with a literature, a textbook solution, and a set of well-understood compromises, because the *optimal* version of each is intractable.

The themes you'll internalize here:

- **Instruction selection** is a *covering* problem on a tree (or DAG). You have a set of instruction "tiles," each matching a pattern of IR operations and carrying a cost; you want to tile the IR tree as cheaply as possible. The greedy answer is **maximal munch**; the optimal answer (for trees) is **dynamic programming**, the engine behind tools like BURS/iburg.
- **Register allocation** is **graph coloring** in its classical formulation: build an interference graph, color it with K colors (K = number of registers), and when you can't, **spill**. The Chaitin–Briggs allocator is the canonical version. Its fast cousin, **linear scan**, trades quality for speed and is what JITs use.
- **Instruction scheduling** is **list scheduling** over a **data-dependence DAG**: a greedy, priority-driven topological ordering that tries to keep functional units busy and hide latency.

And the unifying tension — the **phase-ordering problem** — is that these three passes interfere. Scheduling for parallelism raises register pressure; allocating tightly constrains scheduling; selection choices change both. No order of the three is optimal in general.

> 🎓 **Why this matters at this level:** Once you know these algorithms, generated assembly stops being mysterious. You can predict when a value will spill (high interference + few registers), why a particular instruction was chosen (lowest-cost tile covering that subtree), and why a hot loop didn't vectorize or schedule the way you hoped. This is the level where "the compiler is a black box" becomes "the compiler made a specific, explainable decision."

This page stays target-agnostic where it can and uses x86-64/AArch64 for concrete examples. `senior.md` moves to the modern frameworks (LLVM SelectionDAG, GlobalISel, SSA-based allocation) and the deeper phase-ordering theory; `professional.md` covers TableGen target descriptions, JIT codegen, and DWARF.

---

## Prerequisites

- **Required:** The junior page — the three sub-problems and the kitchen/burner mental model.
- **Required:** Basic data structures: trees, DAGs, graphs, topological sort, greedy vs dynamic-programming algorithms.
- **Required:** What **SSA form** is, at least loosely — each value assigned once; this shapes modern allocation and selection.
- **Required:** What a **basic block** and **control-flow graph (CFG)** are.
- **Helpful but not required:** Familiarity with **graph coloring** as an abstract problem (and that it's NP-hard).
- **Helpful but not required:** Some exposure to CPU pipelines — why a load has latency and why independent work hides it.

You do **not** yet need: LLVM's SelectionDAG internals, TableGen, JIT runtime patching, or DWARF (all later).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Tile / pattern** | An instruction template matching a subtree of IR operations, with an associated cost. |
| **Tree covering** | Selecting a set of non-overlapping tiles that together cover the whole IR tree. |
| **Maximal munch** | Greedy selection: at each node, pick the largest matching tile, then recurse on the leftover subtrees. |
| **BURS / iburg** | Bottom-Up Rewrite System; a dynamic-programming instruction selector generated from a cost-annotated grammar. |
| **Live range** | The span of instructions over which a value is alive (defined, then later used). |
| **Liveness analysis** | The dataflow analysis computing, at each program point, which values are live. |
| **Interference graph** | A graph with one node per value; an edge between two values means their live ranges overlap (they can't share a register). |
| **Graph coloring** | Assigning K colors (registers) to graph nodes so no two adjacent nodes share a color. |
| **K (degree of the target)** | The number of allocatable physical registers. |
| **Spill** | Storing a value to a stack slot and reloading it because no register is available. |
| **Spill cost** | An estimate of how expensive it is to spill a given value (uses × loop depth ÷ live-range length). |
| **Coalescing** | Merging two values connected by a copy into one node, eliminating the `mov`, if they don't interfere. |
| **Linear scan** | A fast allocator that sweeps live ranges left to right and assigns registers greedily. |
| **Caller-saved / callee-saved** | Registers the caller must save before a call (caller-saved) vs registers the callee must preserve (callee-saved). |
| **Data-dependence DAG** | A DAG of instructions where edges encode "must run after" relationships (true/anti/output dependences). |
| **List scheduling** | Greedy scheduling: repeatedly pick the highest-priority ready instruction and emit it. |
| **Latency** | Cycles from when an instruction issues to when its result is usable. |
| **ILP** | Instruction-Level Parallelism: independent instructions that can execute simultaneously. |
| **Phase ordering** | The problem that selection, allocation, and scheduling interfere, with no globally optimal order. |

---

## Core Concepts

### 1. Instruction Selection as Tree Covering

Represent an IR expression as a tree. `a[i] + 7` (with `int a[]`) becomes:

```text
            (+)
           /   \
       (load)   7
          |
        (+)
       /    \
   a_base   (*)
           /    \
          i      4
```

You have a library of **tiles**, each matching some subtree shape and producing one machine instruction at some cost. For x86-64, among the tiles are:

- `ADD reg, imm` — matches `(+ reg imm)`, cost 1.
- `MOV reg, [base + index*scale]` — matches the whole `(load (+ base (* index scale)))` subtree, cost 1.
- `LEA reg, [base + index*scale + disp]` — matches `(+ (+ base (* index scale)) disp)`, cost 1.

**Tiling** = covering the tree with non-overlapping tiles so every node is covered exactly once. The big `MOV [base+index*scale]` tile swallows four IR nodes at once, which is why the selector prefers it: fewer, cheaper instructions.

**Maximal munch** is the greedy strategy: start at the root, choose the *largest* tile that matches, then recurse on the subtrees dangling below that tile. It's simple and fast and gives good (not always optimal) results. The risk: a locally-large tile can leave an awkward, expensive remainder.

**Optimal tree covering** uses **dynamic programming**: for each node, compute the minimum cost to produce its value in each possible "kind" (register, condition flag, address), considering every tile that matches there and adding the best costs of its sub-results. This is exactly what **BURS/iburg-style** generators do — you write a cost-annotated tree grammar, and a tool produces a linear-time optimal tree-pattern matcher. For a single tree, DP gives a provably minimum-cost cover.

### 2. Why CISC and RISC Selection Differ

On **CISC (x86-64)**, the tile library is large and tiles overlap heavily: `lea`, complex addressing modes, read-modify-write memory operands, instructions with implicit operands. Selection is rich and high-payoff — finding the right big tile saves real instructions. The variable-length encoding also means a "good" choice can be smaller in bytes, helping the instruction cache.

On **RISC (RISC-V, and largely AArch64)**, tiles are mostly small and uniform — most instructions are register-register, fixed 4 bytes. There's less to discover; selection is closer to one-IR-op-to-one-instruction, with a few useful composite forms (AArch64's shifted-register operands, load/store with index). The payoff of clever selection is smaller, but scheduling and register allocation carry more weight because you emit more instructions.

### 3. Register Allocation by Graph Coloring (Chaitin–Briggs)

The classical formulation:

1. **Liveness analysis.** For each value, compute its **live range** — from its definition to its last use. Across basic blocks this is a standard backward dataflow analysis.
2. **Build the interference graph.** One node per value. Add an edge between two values whose live ranges **overlap** — they're simultaneously alive, so they can't occupy the same register.
3. **Color with K colors.** K = number of allocatable physical registers. A valid K-coloring assigns each value a register such that no two interfering values share one. Graph coloring is NP-hard in general, so we use a heuristic:
   - **Simplify:** repeatedly remove any node with **degree < K** and push it on a stack. Such a node is *always* colorable later (fewer than K neighbors means a free color exists).
   - **Spill:** if every remaining node has degree ≥ K, pick one to **spill** (mark it as memory-resident), remove it, continue.
   - **Select:** pop nodes off the stack, assigning each a color not used by its already-colored neighbors.
4. **Insert spill code.** For each spilled value, add a store after each definition and a load before each use, then *rebuild and recolor* (spilling creates tiny new live ranges). Iterate until colorable.

**Briggs's improvements** over Chaitin's original: *optimistic coloring* (push potential spills onto the stack and try to color them anyway during select — they often succeed) and better coalescing.

### 4. Spill Cost and Coalescing

When you must spill, *which* value? You want to spill the cheapest one. A standard **spill-cost** heuristic:

```text
spill_cost(v) = (sum over uses/defs of v: 10^loop_depth) / degree(v)
```

Values used inside deep loops are expensive to spill (the `10^loop_depth` weight); values with high interference degree are attractive to spill (removing them unblocks many others). Real allocators tune this formula heavily.

**Coalescing** addresses copies. SSA and calling conventions introduce many `mov a, b` instructions. If `a` and `b` don't interfere, you can **coalesce** them into one value, deleting the `mov`. But aggressive coalescing can *raise* the merged node's degree and cause spills — so allocators use **conservative coalescing** (Briggs: only coalesce if the result has < K neighbors of significant degree) to avoid making the graph harder to color.

### 5. Linear-Scan Allocation (the JIT Favorite)

Graph coloring is high quality but slow — building and iterating the interference graph is expensive. **Linear scan** trades a little code quality for a lot of compile speed:

1. Order all live ranges by their start point.
2. Sweep left to right. Maintain an "active" set of currently-live ranges sorted by end point.
3. At each new range: **expire** any active range that has ended (free its register); if a register is free, assign it; if not, **spill** — either the new range or the active one ending latest, whichever is cheaper.

It's roughly O(n log n), produces decent (not optimal) allocations, and is exactly why JITs (HotSpot's C1, many JavaScript engines) and fast compilers (Go's compiler uses a linear-scan-style allocator) choose it: when you compile at runtime, *compile time is run time*, so a fast allocator wins even if the code is slightly worse.

### 6. Callee-Saved vs Caller-Saved Interaction

The ABI splits physical registers into two classes, and the allocator must respect both:

- **Caller-saved (volatile):** a called function may clobber these freely. If the allocator keeps a value in a caller-saved register *across a call*, it must spill/reload around the call.
- **Callee-saved (non-volatile):** a function must preserve these — if it uses one, it saves it in the prologue and restores it in the epilogue.

So values that live *across* calls prefer callee-saved registers (no per-call spilling, just one save/restore in prologue/epilogue), while short-lived values prefer caller-saved registers (no prologue cost). A good allocator models this as part of the cost.

### 7. Instruction Scheduling: the Dependence DAG and List Scheduling

Within a basic block, build a **data-dependence DAG**:

- **True (read-after-write) dependence:** B reads what A wrote → B must follow A.
- **Anti (write-after-read) dependence:** B overwrites what A read → ordering constraint.
- **Output (write-after-write) dependence:** both write the same location.

Each node carries a **latency**. The scheduler wants a topological order of this DAG that minimizes total cycles, keeping functional units busy and ensuring a result is ready by the time it's needed.

**List scheduling** is the standard greedy method:

1. Compute a **priority** per instruction — commonly the **critical-path length** (longest latency-weighted path to a DAG leaf). Higher priority = more urgent.
2. Maintain a **ready set** (instructions whose predecessors are all scheduled).
3. Repeatedly: pick the highest-priority ready instruction whose required functional unit is free, "issue" it, advance the cycle clock, and move newly-ready instructions into the ready set.

The classic win: place a high-latency load early and fill the cycles before its use with independent instructions, so the load result is ready exactly when needed instead of stalling.

### 8. Software Pipelining (Loop Scheduling)

For tight loops, list scheduling within one iteration isn't enough — the win is *overlapping iterations*. **Software pipelining** (e.g. **modulo scheduling**) restructures a loop so that, in steady state, each iteration of the new loop body executes operations from *several* original iterations at once (load for iteration i+2, multiply for i+1, store for i). It massively increases ILP for in-order machines, at the cost of a complex prologue/epilogue and high register pressure (multiple iterations' values alive at once).

### 9. The Phase-Ordering Conflict, Concretely

Now the central tension. Consider scheduling a loop to expose ILP: you spread independent loads early so their results are ready later. But "ready later" means those loaded values are **alive longer**, overlapping more other values — which **raises register pressure** and can force the allocator to spill. The spill code adds memory traffic, partly undoing the scheduling win.

So:

- **Schedule before allocate:** you get a good schedule but may have created so much pressure that allocation spills, hurting performance.
- **Allocate before schedule:** allocation pins values to registers, adding **false dependences** (two values forced into the same register can't be reordered freely), constraining the scheduler.

There is no universally correct order. Real compilers compromise: schedule, allocate, then *re-schedule* (post-allocation scheduling) to clean up; or use **register-pressure-aware scheduling** that throttles parallelism when pressure gets high. This is the canonical example of the phase-ordering problem.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Tile covering** | Tiling a floor with pieces of various sizes; bigger tiles cover more area with fewer pieces, but must fit the shape. |
| **Maximal munch** | Always grabbing the biggest tile that fits right now, then dealing with the gaps. |
| **DP optimal selection** | Planning the *whole* floor first to minimize total tile cost, not just grabbing greedily. |
| **Interference graph** | A seating chart where two guests who feud (overlap in time) can't share a chair (register). |
| **Graph coloring** | Coloring a map so no two bordering countries share a color, with only K crayons. |
| **Spilling** | Out of chairs at the party, so some guests stand in the hallway (stack) and come back when a chair frees up. |
| **Spill cost** | Choosing who stands in the hallway — not the guest who needs to sit constantly (deep-loop value). |
| **Coalescing** | Two name-tags for the same person; merge them and throw one away (delete the copy). |
| **Linear scan** | Seating guests as they arrive, in order, freeing chairs as guests leave — fast, not optimal. |
| **Dependence DAG** | A recipe's step graph: you can't ice the cake before it bakes (true dependence). |
| **List scheduling** | Cooking by always starting the most time-critical ready step, filling waits with other prep. |
| **Software pipelining** | A laundromat: while load i dries, you wash load i+1 and fold load i−1 — all stages busy at once. |
| **Phase ordering** | Packing a suitcase: optimize for fitting more in, and it gets harder to find what you need; optimize for access, and it's less full. |

---

## Mental Models

### The "Cover, Color, Order" Pipeline

Three verbs in sequence: **cover** the IR with instruction tiles (selection), **color** the values with registers (allocation), **order** the instructions to hide latency (scheduling). Each is a classic CS problem — covering, graph coloring, list scheduling — and each is intractable optimally, so each uses a smart heuristic. Carry the three verbs; they organize the entire back end.

### The "Pressure Gauge" Model

Hold a mental gauge labeled **register pressure** — how many values are alive at the busiest point. The whole drama of allocation and the scheduling conflict is about this gauge. Below K (registers), everything fits and life is good. Push it above K — by writing more live variables, or by scheduling for more parallelism — and you spill, paying memory traffic. Many real-world performance fixes are just "lower the gauge."

### The "Critical Path" Model for Scheduling

Picture the dependence DAG with the longest latency-weighted path highlighted in red. That red path is your *floor* on execution time — you can't finish faster than it. The scheduler's job is to ensure nothing *off* the critical path stalls progress *on* it, by filling the slack cycles with independent work. Optimizing the schedule = keeping the critical path moving.

---

## Code Examples

### Maximal Munch, Sketched

A toy maximal-munch selector over a tiny expression tree (pseudocode in Python-like form):

```python
# IR tree nodes: ('const', n), ('reg', name), ('add', l, r), ('mul', l, r), ('load', addr)

def munch(node, emit):
    # Try the LARGEST tiles first; fall back to smaller ones.
    if node[0] == 'load':
        addr = node[1]
        # Tile: load [base + index*scale]
        if addr[0] == 'add' and addr[2][0] == 'mul' and addr[2][2] == ('const', 4):
            base = munch(addr[1], emit)          # recurse on leftover subtree
            index = munch(addr[2][1], emit)
            d = fresh_reg()
            emit(f"mov {d}, [{base} + {index}*4]")   # ONE instruction, 4 nodes
            return d
        a = munch(addr, emit)
        d = fresh_reg(); emit(f"mov {d}, [{a}]"); return d
    if node[0] == 'add':
        l = munch(node[1], emit); r = munch(node[2], emit)
        d = fresh_reg(); emit(f"add {d}, {l}, {r}"); return d
    if node[0] == 'const':
        d = fresh_reg(); emit(f"mov {d}, {node[1]}"); return d
    if node[0] == 'reg':
        return node[1]
```

The key move: when matching `load`, the selector *peeks deeper* into the address subtree to grab the big `[base + index*4]` tile before falling back to a plain `[addr]`. That peek is what fuses multiple IR nodes into one instruction.

### Building an Interference Graph

```python
# live[i] = set of values live AT instruction i (from backward liveness analysis)
def interference_graph(instructions, live):
    edges = set()
    for i, ins in enumerate(instructions):
        defined = ins.defs        # values this instruction writes
        for d in defined:
            for other in live[i]:
                if other != d:
                    edges.add(frozenset((d, other)))  # they overlap -> interfere
    return edges
```

A value interferes with everything else alive at the point it's defined: they coexist, so they need distinct registers.

### Chaitin-Style Simplify / Spill / Select

```python
def color(nodes, adj, K):
    stack, spilled = [], set()
    graph = {n: set(adj[n]) for n in nodes}
    work = set(nodes)
    while work:
        # SIMPLIFY: remove a low-degree (< K) node — always colorable later.
        low = next((n for n in work if len(graph[n]) < K), None)
        if low is None:
            # SPILL: every node has degree >= K. Pick cheapest to spill.
            low = min(work, key=spill_cost)
            spilled.add(low)
        stack.append(low)
        work.discard(low)
        for m in graph[low]:
            graph[m].discard(low)
    # SELECT: pop and assign a color avoiding neighbors' colors.
    colors = {}
    while stack:
        n = stack.pop()
        used = {colors[m] for m in adj[n] if m in colors}
        free = next((c for c in range(K) if c not in used), None)
        if free is None:          # optimistic spill that didn't pan out
            spilled.add(n)
        else:
            colors[n] = free
    return colors, spilled
```

If `spilled` is non-empty, the real allocator inserts spill code and reruns the whole thing.

### Linear Scan, Core Loop

```python
def linear_scan(intervals, K):           # intervals sorted by start
    active = []                            # sorted by end point
    free = list(range(K))
    location = {}
    for iv in intervals:
        # EXPIRE intervals that ended before iv starts -> free their registers.
        active = [a for a in active if a.end > iv.start
                  or (free.append(location[a.id]) or False)]
        if free:
            location[iv.id] = free.pop()
            active.append(iv); active.sort(key=lambda a: a.end)
        else:
            spill = active[-1]             # the one ending latest
            if spill.end > iv.end:
                location[iv.id] = location[spill.id]
                location[spill.id] = 'STACK'
                active[-1] = iv; active.sort(key=lambda a: a.end)
            else:
                location[iv.id] = 'STACK'
    return location
```

One left-to-right sweep, no interference graph — that's the speed advantage.

### List Scheduling Over a Dependence DAG

```python
def list_schedule(dag, latency):
    # priority = critical-path length (longest latency-weighted path to a leaf)
    prio = critical_path_lengths(dag, latency)
    ready = [n for n in dag.nodes if not dag.preds(n)]
    cycle, schedule, finish = 0, [], {}
    while ready:
        ready.sort(key=lambda n: prio[n], reverse=True)
        n = ready.pop(0)                    # highest-priority ready instr
        start = max([finish[p] for p in dag.preds(n)] + [cycle])
        finish[n] = start + latency[n]
        schedule.append((start, n))
        for s in dag.succs(n):
            if all(p in finish for p in dag.preds(s)):
                ready.append(s)
        cycle += 1
    return sorted(schedule)
```

Picking the highest-critical-path instruction first is the heuristic that keeps the longest chain moving.

### Seeing the Conflict in Real Output

```c
// Compile this at -O2 and inspect the loop. With more accumulators the
// compiler exposes more ILP (good for the pipeline) but uses more registers.
double dot(const double *a, const double *b, long n) {
    double s = 0;
    for (long i = 0; i < n; i++) s += a[i] * b[i];
    return s;
}
```

```bash
gcc -O3 -S dot.c -o dot.s          # look for multiple xmm accumulators / FMA
```

At `-O3` the compiler often **unrolls** and uses several accumulator registers to break the dependence chain on `s` (more ILP) — and uses correspondingly more `xmm` registers. That's the scheduling-vs-pressure trade-off made visible: more parallelism, more registers consumed.

---

## Pros & Cons

| Technique | Pros | Cons |
|-----------|------|------|
| **Maximal munch selection** | Simple, fast, linear-time, good in practice. | Greedy; can miss the globally cheapest cover. |
| **DP / BURS selection** | Optimal tree cover; table-driven from a grammar. | More complex to build; optimal only for trees, not general DAGs. |
| **Graph-coloring allocation** | High-quality allocation; well-understood; good coalescing. | Slow (build + iterate interference graph); NP-hard core, heuristic spills. |
| **Linear-scan allocation** | Very fast (~O(n log n)); ideal for JITs. | Lower code quality; coarse spill decisions. |
| **List scheduling** | Effective, fast, the industry standard within a block. | Greedy; limited to a basic block unless extended; ignores cross-block effects. |
| **Software pipelining** | Big ILP wins on tight loops, especially in-order cores. | Complex; high register pressure; intricate prologue/epilogue. |
| **Schedule-then-allocate** | Good schedule. | May overshoot register pressure → spills. |
| **Allocate-then-schedule** | Controlled pressure. | False dependences from register reuse constrain the schedule. |

---

## Use Cases

- **Predicting and explaining spills.** Knowing the interference-graph/K model lets you say *why* a hot loop spilled and how to relieve it (fewer live values, splitting the function).
- **Choosing an allocator for a compiler/JIT.** Building a JIT? Linear scan. Building an ahead-of-time optimizing compiler? Graph coloring (or SSA-based). The decision flows from compile-time-vs-quality.
- **Reading `-O3` loop code.** Understanding list scheduling and software pipelining explains unrolling, multiple accumulators, and interleaved loads/stores.
- **Diagnosing ABI-related spills.** Recognizing caller-saved/callee-saved interaction explains why values get spilled around calls.
- **Understanding why selection differs across targets.** The CISC-vs-RISC tile story explains why the same source yields denser code on x86 and more, simpler instructions on RISC-V.

---

## Coding Patterns

### Pattern 1: Lower Register Pressure to Avoid Spills

Identify the loop's *simultaneously live* values. Reduce them: scalar-replace fewer arrays, shorten live ranges by computing values closer to use, or split a monster function so each piece has its own register budget.

### Pattern 2: Help the Selector See the Pattern

Write expressions in the *natural algebraic shape* the selector recognizes (`base[i]`, `a*b + c`). Obfuscating with manual shifts and temporaries can hide the very tile the selector wanted (`lea`, FMA).

### Pattern 3: Break Dependence Chains for ILP

When a reduction loop (`s += ...`) is latency-bound, manually use multiple accumulators (or let `-ffast-math`/`-O3` do it) so independent partial sums can issue in parallel — the same trick the scheduler/unroller applies.

### Pattern 4: Pin Hot Values, Spill Cold Ones

If you control codegen (writing a compiler), bias the spill heuristic with loop depth so deep-loop values stay in registers and cold setup values spill. The standard `10^loop_depth` weighting encodes this.

### Pattern 5: Post-Allocation Re-Scheduling

In a compiler, run a light scheduling pass *after* allocation to clean up the false dependences allocation introduced. This is a pragmatic answer to the phase-ordering conflict.

---

## Best Practices

- **Think in live ranges, not variables.** A "variable" may have several disjoint live ranges; the allocator works on ranges, and so should your reasoning.
- **Treat K as a hard budget.** The number of allocatable registers is small (x86-64: ~14 usable GPRs after reserving). Design hot code to stay under it.
- **Coalesce conservatively.** Eliminating copies is good, but aggressive coalescing that raises degree can cause spills. Briggs/George conservative coalescing is the safe default.
- **Pick the allocator to match the compiler's job.** Compile speed critical (JIT) → linear scan. Run speed critical (AOT) → graph coloring / SSA-based.
- **Schedule with pressure awareness.** Don't expose ILP blindly; throttle when register pressure approaches K, or you'll trade scheduling gains for spill losses.
- **Respect the ABI register classes.** Values that live across calls belong in callee-saved registers; short-lived ones in caller-saved. Model this in the cost, not as an afterthought.
- **Validate selection cost models against real latencies.** A tile that's "one instruction" isn't always cheap (a memory-operand RMW can be slower than separate ops on some microarchitectures).

---

## Edge Cases & Pitfalls

- **Maximal munch's greedy trap.** A large tile chosen at the root can fragment the rest of the tree into expensive small pieces. Greedy isn't optimal; DP avoids it but costs more.
- **Spilling creates new live ranges.** Each spill inserts load/store instructions with their own (tiny) live ranges, which can *increase* pressure elsewhere and force re-iteration. Allocation isn't single-pass.
- **Coalescing too aggressively causes spills.** Merging two non-interfering copies can produce a high-degree node that no longer colors. The "obvious" optimization can backfire — hence conservative coalescing.
- **Pre-colored registers constrain coloring.** ABI-fixed registers (argument registers, the return register, `rsp`) are *pre-colored* nodes — already assigned a color — which constrains everything adjacent. Forgetting these is a classic allocator bug.
- **Anti- and output-dependences are real scheduling constraints.** They're not data flow but they still forbid reorderings, because reuse of a register/location creates ordering requirements. Ignoring them produces wrong code.
- **List scheduling is per-basic-block by default.** Latency hiding across block boundaries needs extensions (superblock/trace scheduling). A naive scheduler leaves cross-block opportunities on the table.
- **Software pipelining explodes register pressure.** Overlapping N iterations keeps N iterations' values alive; on a register-poor target this can spill away the benefit.
- **Phase ordering has no winner.** Whichever order you run selection/allocation/scheduling, some program loses. Don't expect a "correct" order — expect compromises (re-scheduling, pressure-aware passes).
- **On out-of-order CPUs, careful scheduling is partly wasted.** The hardware reorders anyway. Don't over-invest compiler scheduling for big OoO cores; do invest for in-order embedded targets.
- **Linear scan's lifetime holes hurt.** Basic linear scan treats a live range as one interval even when the value is dead in the middle ("lifetime holes"); it can hold a register unnecessarily. Extensions (second-chance binpacking, interval splitting) fix this — plain linear scan doesn't.
- **Spill-cost heuristics are estimates, not truth.** The `uses × loop_depth / degree` formula can misjudge; profile-guided weights do better but require profiles. Don't treat the heuristic as ground truth.
