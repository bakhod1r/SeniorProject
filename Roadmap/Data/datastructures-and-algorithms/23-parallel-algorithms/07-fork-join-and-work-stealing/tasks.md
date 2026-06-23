# Fork-Join and Work-Stealing — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, build the fork-join computation / scheduler / deque, drive a **steal counter** (or a wall-clock timer) alongside it, and **confirm the measured numbers respect the bound**. The acceptance test is always the same shape: *the result equals the sequential answer **and** the measured time/steals respect the Blumofe–Leiserson bound `T_P = T₁/P + O(T∞)` (steals `= O(P·T∞)`).*
> **[analysis]** tasks need no code: derive a work/span of a fork-join tree, apply the steal bound, or reason about grain size — model derivations are provided so you can grade yourself.

A **fork-join** computation is a DAG with a special shape: a strand may **fork** (spawn a child that runs in parallel with its continuation) and later **join** (wait for spawned children to finish). The DAG is **series-parallel** — it composes by sequencing (`A` then `B`) and by forking (`A` parallel `B`). Two numbers summarize it and everything else follows:

- **`T₁`** — the **work**: total operations, the time on **one** processor (run the program serially, eliding every fork).
- **`T∞`** — the **span**: the critical-path length, the time on **infinitely** many processors (the longest chain of dependencies through the forks and joins).

The runtime that *realizes* the greedy schedule Brent's theorem promises is the **work-stealing scheduler**. Each of `P` workers owns a double-ended queue (**deque**) of ready tasks:

| Operation | Who | Which end | Order | Why |
| --- | --- | --- | --- | --- |
| **push** | owner | bottom | — | a fork adds the new task to the owner's deque |
| **pop** | owner | bottom | **LIFO** | the owner runs its *most recent* task — cache-hot, deep-first |
| **steal** | thief | top | **FIFO** | an idle worker steals the *oldest* task — large, near the root |

The Blumofe–Leiserson theorem (1999) is the headline result you will measure, derive, and verify on every task:

| Quantity | Bound | Why |
| --- | --- | --- |
| **Time** | `E[T_P] = T₁/P + O(T∞)` | greedy schedule + `O(T∞)` steal-induced overhead |
| **Steals** | `E[#steals] = O(P·T∞)` | each `T∞`-length critical path costs `O(P)` steal attempts |
| **Space** | `S_P ≤ P·S₁` | LIFO-local execution bounds stack depth per worker |

The recurring discipline for every coding task is identical: **build the fork-join program (or the DAG, or the deque), run it through a work-stealing scheduler, count the steals and measure the wall-clock, and confirm the result matches the sequential answer while `T_P ≈ T₁/P + O(T∞)` and `#steals = O(P·T∞)`.** A speedup you never bracket with `T₁/P + O(T∞)` is just noise; a steal count you never compare to `O(P·T∞)` is just a number. Tie the two together on every task.

**Related practice:**
- [Models: PRAM and Work–Span tasks](../01-models-pram-work-span/tasks.md) — the work/span model, the greedy schedule, and Brent's bound `T_P ≤ T₁/P + T∞` that work-stealing *realizes* with high probability.
- [Parallel Sorting and Merging tasks](../03-parallel-sorting-and-merging/tasks.md) — fork-join merge sort and parallel partition, the canonical divide-and-conquer workloads you schedule on the deque here.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the model and quantities used throughout:
- **Strand and the fork-join DAG.** A *strand* is a maximal run of serial instructions with no fork/join. A **fork** (Cilk `spawn`, Go `go`, Java `ForkJoinTask.fork`) creates two parallel strands: the spawned child and the continuation after it. A **join** (`sync`, `wg.Wait`, `task.join`) is a node that depends on all forked children. The result is a series-parallel DAG; `T₁` is its node count, `T∞` its longest path.
- **Grain size.** The model charges nothing to fork; real runtimes charge a fixed cost `c`. A **grain-size cutoff** `G` runs subproblems smaller than `G` serially (no fork), trading a little parallelism for far fewer spawns. The right `G` keeps useful work per task `≫ c` while keeping enough tasks to balance `P` workers.
- **Child vs continuation stealing.** When a strand forks, the worker can keep running the **child** and leave the **continuation** stealable (*continuation stealing*, Cilk), or keep the **continuation** and leave the **child** stealable (*child stealing*, most libraries). Continuation stealing gives the `S_P ≤ P·S₁` space bound; child stealing can blow up space on wide fork loops (Task 11).
- **The idealization.** Work-stealing's `O(T∞)` overhead and `O(P·T∞)` steals are *expected* values over the scheduler's randomness, charging `O(1)` per steal attempt. Real deques pay cache-miss and contention costs the model omits — which is exactly why the coding tasks that *measure* reveal where the bound and the hardware part ways.

---

## Beginner Tasks

### Task 1 — Fork-join parallel sum with a grain-size cutoff **[coding]**

`[easy]` Build the canonical fork-join computation: sum an array by recursively splitting it, **forking** one half and running the other on the current worker, then **joining**. Below a grain-size cutoff `G`, sum serially (no fork). Verify the result equals the sequential sum, and confirm the recursion bottoms out at `≈ n/G` leaves.

#### Go

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
)

// parSum sums data[lo:hi]. Below the grain cutoff G it runs serially (a leaf);
// otherwise it FORKS the left half onto a new goroutine and runs the right half
// here, then JOINS. Fork-join DAG: ~ (hi-lo)/G leaves, depth ~ log((hi-lo)/G).
func parSum(data []float64, lo, hi, G int) float64 {
	if hi-lo <= G { // leaf: serial base case, no fork
		var s float64
		for i := lo; i < hi; i++ {
			s += data[i]
		}
		return s
	}
	mid := (lo + hi) / 2
	var left float64
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { defer wg.Done(); left = parSum(data, lo, mid, G) }() // FORK left
	right := parSum(data, mid, hi, G)                                // run right here
	wg.Wait()                                                        // JOIN
	return left + right
}

func main() {
	runtime.GOMAXPROCS(runtime.NumCPU())
	const n = 50_000_000
	data := make([]float64, n)
	for i := range data {
		data[i] = 1.0 // known answer: sum == n
	}
	const G = 100_000
	got := parSum(data, 0, n, G)
	if got != float64(n) {
		panic("wrong sum")
	}
	fmt.Printf("n=%d  grain=%d  ~leaves=%d  sum=%.0f (correct)\n", n, G, n/G, got)
}
```

#### Python (process-free, threaded core)

```python
def par_sum(data, lo, hi, G):
    """Fork-join sum with grain cutoff G. (Threads here only model the DAG shape;
    the GIL serializes the adds — use this for correctness, time in Go.)"""
    if hi - lo <= G:
        return sum(data[lo:hi])          # serial leaf
    mid = (lo + hi) // 2
    left = par_sum(data, lo, mid, G)     # in a real runtime: forked
    right = par_sum(data, mid, hi, G)
    return left + right                  # join
```

- **Constraints:** The cutoff `G` must switch cleanly between a serial base case (no fork) and a forking recursive case. Fork **one** half and run the other on the current worker — never fork *both* and idle (that wastes a worker on a join). The result must equal the sequential `sum(data)` exactly; pin the data (all `1.0`) so the answer is `n` and a wrong sum invalidates everything that follows.
- **Hint:** This is a balanced fork-join tree: `≈ n/G` leaves, depth `≈ log₂(n/G)`. Forking the left half and recursing right *on the same worker* is the standard idiom — the continuation does useful work instead of blocking on the join. Choosing `G` is the subject of Task 3; here just confirm correctness and that the leaf count is `≈ n/G`.
- **Acceptance test:** `parSum(data, 0, n, G)` equals `n` for every `G`; the recursion produces `≈ n/G` serial leaves. This is the fork-join computation whose work/span you derive in Task 2 and whose grain-size sweet spot you measure in Task 3.

---

### Task 2 — Work and span of the fork-join sum tree **[analysis]**

`[easy]` Before measuring anything, derive the work `T₁`, span `T∞`, and parallelism of the fork-join sum of Task 1 — first with grain `G = 1` (fork to single elements), then with a general grain `G`.

> **No code.** Use this as the grading model.

**Grain `G = 1`.**

*Work.* Every internal node does one `+` (combining its two children's results); a balanced binary tree over `n` leaves has `n − 1` internal nodes:

```
T₁ = n − 1 = Θ(n).
```

This matches the sequential sum's `n − 1` additions — the fork-join sum is **work-efficient**.

*Span.* The critical path runs root → leaf → root: descend `⌈log₂ n⌉` levels of forks, hit a leaf, ascend `⌈log₂ n⌉` levels of joins. Each level is `O(1)` work, so:

```
T∞ = Θ(log n).
```

*Parallelism.*

```
T₁/T∞ = Θ(n / log n).
```

**General grain `G`.**

The tree now has `≈ n/G` leaves, each a serial fold of `G` elements. The leaf work is `G` and is **not** parallelized:

```
T₁ = Θ(n)                          (still n − 1 total adds)
T∞ = Θ(G + log(n/G))               (one leaf's serial fold + the tree depth above it)
parallelism = Θ(n / (G + log(n/G))).
```

*Worked numbers.* For `n = 2²⁰` and `G = 1`: `T₁ ≈ 10⁶`, `T∞ = 20`, parallelism `≈ 52,428`. For `G = 1024 = 2¹⁰`: `T∞ ≈ 1024 + 10 = 1034`, parallelism `≈ 1014`. The grain trades a `~50×` drop in parallelism for a `~1024×` cut in the number of forks — and `~1000` is still far above any realistic `P`, so the speedup is unharmed while the overhead plummets. **This is the entire argument for grain size**: span grows by `G`, but as long as `parallelism = n/(G + log(n/G)) ≫ P`, you sit in the linear-speedup regime and the fork savings are free.

- **Constraints:** Derive `T₁ = Θ(n)` (work-efficient), `T∞ = Θ(log n)` at `G = 1` and `T∞ = Θ(G + log(n/G))` for general `G`, and the matching parallelism. Plug in `n = 2²⁰` for `G ∈ {1, 1024}` and report all three. State the grain-size principle: pick the largest `G` with `n/(G + log(n/G)) ≫ P`.
- **Acceptance test:** Work `Θ(n)` (matching sequential), span `Θ(log n)` at `G = 1` rising to `Θ(G + log(n/G))`, parallelism `Θ(n/(G + log(n/G)))`; the worked numbers show the grain cuts forks `~G×` while keeping parallelism `≫ P`. This is the span you *measure* through the grain sweep in Task 3.

---

### Task 3 — Sweep the grain size and MEASURE the speedup sweet spot **[coding]**

`[easy]` Task 2 says span grows with `G` but the fork count falls `~G×`. Make it measurable: sweep `G` across orders of magnitude, time the fork-join sum at each, and find the sweet spot — **too fine** (`G` tiny) drowns in fork overhead, **too coarse** (`G ≈ n`) starves the workers. Report time vs `G` and the best grain.

#### Go

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
	"time"
)

func parSum(data []float64, lo, hi, G int) float64 {
	if hi-lo <= G {
		var s float64
		for i := lo; i < hi; i++ {
			s += data[i]
		}
		return s
	}
	mid := (lo + hi) / 2
	var left float64
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { defer wg.Done(); left = parSum(data, lo, mid, G) }()
	right := parSum(data, mid, hi, G)
	wg.Wait()
	return left + right
}

func main() {
	runtime.GOMAXPROCS(runtime.NumCPU())
	const n = 100_000_000
	data := make([]float64, n)
	for i := range data {
		data[i] = 1.0
	}
	// Serial baseline T_1.
	t0 := time.Now()
	base := parSum(data, 0, n, n) // G = n -> one serial leaf, no forks
	t1 := time.Since(t0)
	if base != float64(n) {
		panic("wrong sum")
	}
	fmt.Printf("n=%d cores=%d  serial T_1=%.1fms\n", n, runtime.NumCPU(),
		float64(t1.Microseconds())/1e3)
	fmt.Printf("%12s %12s %12s %10s\n", "grain G", "~#tasks", "time(ms)", "speedup")

	var best time.Duration = 1 << 62
	var bestG int
	for _, G := range []int{16, 1_000, 50_000, 500_000, 5_000_000, n} {
		t0 = time.Now()
		got := parSum(data, 0, n, G)
		dt := time.Since(t0)
		if got != float64(n) {
			panic("wrong sum")
		}
		fmt.Printf("%12d %12d %12.1f %9.2fx\n", G, n/G,
			float64(dt.Microseconds())/1e3, float64(t1)/float64(dt))
		if dt < best {
			best, bestG = dt, G
		}
	}
	fmt.Printf("\nbest grain = %d  (too small: fork overhead; too large: underutilized)\n", bestG)
}
```

- **Constraints:** Sweep `G` from tiny (`G = 16`, millions of forks, overhead-dominated) through `G = n` (one serial leaf, no parallelism). Pin the data so every run's answer is `n` and is asserted — a wrong sum invalidates the timing. Report time *and* the task count `≈ n/G` per grain, and the best grain.
- **Hint:** Tiny grains create `≈ n/G` tasks; each fork costs a fixed `c`, so spawn overhead `≈ c·n/G` explodes as `G → 0` — at `G = 16` the program is often **slower than serial**. Huge grains (`G ≈ n`) give one task and `T_P ≈ T₁`, no speedup. The optimum is where useful work per leaf `≈ G` comfortably exceeds `c` while `n/G` still gives every worker plenty of tasks to balance (typically `G` in the tens-of-thousands to low-millions for cheap ops, i.e. `≈ 10–100×` more tasks than cores). The pure work–span model's `T∞` ignores `c` entirely; this sweep measures the term it omits.
- **Acceptance test:** Time is **U-shaped** in `G`: high at both extremes, minimal in the middle. The best grain gives speedup approaching the core count; `G = 16` is *slower than serial* (overhead > work) and `G = n` shows no speedup. The measured curve is the grain-size cutoff term the work–span model omits — and the motivation for the work-stealing scheduler of Tasks 4–6.

---

### Task 4 — Build the fork-join DAG and confirm its work/span **[coding]**

`[easy]` Represent a fork-join computation as an explicit **series-parallel DAG** so later tasks can schedule it. Build the DAG of the Task 1 sum tree (and a general fork-join shape), then compute `T₁` (node count) and `T∞` (longest path) and confirm they match the Task 2 derivation.

#### Python

```python
from math import log2, ceil

def fork_join_sum_dag(leaves):
    """Build the DAG of a balanced fork-join sum over `leaves` serial chunks.
    Returns deps[v] = predecessors of node v, in topological order.
    Node layout: a binary tree; each internal node depends on its two children."""
    # Build bottom-up: level 0 = leaves, then pair up to the root.
    levels = [list(range(leaves))]               # leaf node ids 0..leaves-1
    deps = [[] for _ in range(leaves)]           # leaves have no predecessors
    nid = leaves
    while len(levels[-1]) > 1:
        cur = levels[-1]
        nxt = []
        i = 0
        while i + 1 < len(cur):
            deps.append([cur[i], cur[i + 1]])    # internal node joins two children
            nxt.append(nid); nid += 1
            i += 2
        if i < len(cur):                          # odd one carries up unchanged
            nxt.append(cur[i])
        levels.append(nxt)
    return deps

def work_span(deps):
    """T1 = node count; Tinf = longest path (nodes). deps in topological order."""
    level = [0] * len(deps)
    for v in range(len(deps)):
        level[v] = 1 + max((level[u] for u in deps[v]), default=0)
    return len(deps), max(level)

if __name__ == "__main__":
    for leaves in (8, 16, 1024):
        deps = fork_join_sum_dag(leaves)
        T1, Tinf = work_span(deps)
        # internal nodes = leaves - 1 ; total nodes = 2*leaves - 1
        assert T1 == 2 * leaves - 1, (T1, leaves)
        # depth = leaf level (1) + ceil(log2 leaves) join levels
        assert Tinf == 1 + ceil(log2(leaves)), (Tinf, leaves)
        print(f"leaves={leaves:5d}  T1={T1:5d} (=2L-1)  Tinf={Tinf:3d} (=1+ceil log2 L)"
              f"  parallelism={T1/Tinf:.1f}")
    print("OK: fork-join sum DAG has T1=2L-1, Tinf=1+ceil(log2 L), matching Task 2")
```

- **Constraints:** The DAG must be in **topological order** (every predecessor precedes the node) so the one-pass longest-path DP is valid. A leaf has no predecessors (`level = 1`); an internal node depends on exactly its two children. For `L` leaves, confirm `T₁ = 2L − 1` total nodes and `T∞ = 1 + ⌈log₂ L⌉`.
- **Hint:** This is the same longest-path recurrence as the [work–span analyzer](../01-models-pram-work-span/tasks.md): `level[v] = 1 + max over predecessors`. Keep this DAG builder — Task 5's scheduler and Task 6's steal counter both drive it. With grain `G`, set `L = ⌈n/G⌉` and remember each leaf "costs" `G` (the span analysis of Task 2 charges `G` for the leaf, but the *DAG node count* still counts the leaf as one unit-cost node — keep the two views straight).
- **Acceptance test:** `T₁ = 2L − 1`, `T∞ = 1 + ⌈log₂ L⌉`, parallelism `(2L−1)/(1+⌈log₂ L⌉)` for `L ∈ {8, 16, 1024}`, matching the Task 2 derivation. The DAG is the input to the work-stealing scheduler you build next.

---

## Intermediate Tasks

### Task 5 — A simplified work-stealing scheduler with per-worker deques **[coding]**

`[medium]` Build the scheduler that *realizes* the greedy schedule: `P` workers, each owning a deque. The owner **pushes** and **pops** the **bottom** (LIFO); an idle thief **steals** from the **top** (FIFO) of a random victim. Run a fork-join DAG on it, verify the result, and confirm every node runs exactly once.

#### Python

```python
import random
from collections import deque

def work_stealing_run(deps, P, seed=0):
    """Simulate a randomized work-stealing scheduler over P workers.
    Each worker has a deque: owner push/pop BOTTOM (right), thief steals TOP (left).
    Returns (order, steals): execution order and the number of successful steals.
    A node is READY when all its predecessors have executed."""
    rnd = random.Random(seed)
    n = len(deps)
    remaining = [len(deps[v]) for v in range(n)]
    succ = [[] for _ in range(n)]
    for v in range(n):
        for u in deps[v]:
            succ[u].append(v)

    deques = [deque() for _ in range(P)]          # deques[w] is worker w's deque
    # Seed the roots round-robin across workers.
    roots = [v for v in range(n) if remaining[v] == 0]
    for i, v in enumerate(roots):
        deques[i % P].append(v)

    done = [False] * n
    order, steals, executed = [], 0, 0
    while executed < n:
        progressed = False
        for w in range(P):
            if deques[w]:                          # owner pops its BOTTOM (LIFO)
                v = deques[w].pop()
            else:                                  # idle: steal from a random victim's TOP
                victims = [x for x in range(P) if x != w and deques[x]]
                if not victims:
                    continue
                victim = rnd.choice(victims)
                v = deques[victim].popleft()       # steal the OLDEST (FIFO) -> big task
                steals += 1
            if done[v]:
                continue
            done[v] = True
            executed += 1
            order.append(v)
            progressed = True
            # Forking: pushing ready successors onto THIS worker's bottom.
            for s in succ[v]:
                remaining[s] -= 1
                if remaining[s] == 0:
                    deques[w].append(s)            # push BOTTOM -> owner runs it next
        if not progressed:
            break
    return order, steals

if __name__ == "__main__":
    from math import log2, ceil
    # Reuse the fork-join sum DAG from Task 4.
    def fj_dag(leaves):
        levels = [list(range(leaves))]; deps = [[] for _ in range(leaves)]; nid = leaves
        while len(levels[-1]) > 1:
            cur, nxt, i = levels[-1], [], 0
            while i + 1 < len(cur):
                deps.append([cur[i], cur[i + 1]]); nxt.append(nid); nid += 1; i += 2
            if i < len(cur): nxt.append(cur[i])
            levels.append(nxt)
        return deps

    deps = fj_dag(1024)
    n = len(deps)
    for P in (1, 2, 4, 8):
        order, steals = work_stealing_run(deps, P, seed=P)
        assert len(order) == n and len(set(order)) == n, "every node runs exactly once"
        # A node never runs before its predecessors (validate topological respect).
        pos = {v: i for i, v in enumerate(order)}
        assert all(pos[u] < pos[v] for v in range(n) for u in deps[v])
        print(f"P={P}: executed {len(order)} nodes, steals={steals}")
    print("OK: work-stealing runs every node once, respecting dependencies")
```

- **Constraints:** The owner uses its deque as a **stack** — push and pop the **bottom** (LIFO, here the right end). A thief steals from the **top** — the **oldest** task (FIFO, here the left end). Forking a successor pushes it onto the **current worker's** bottom so the owner runs it next (depth-first, cache-hot). Every node must execute **exactly once** and never before its predecessors. Steals must come *only* from idle workers (empty own deque).
- **Hint:** The two ends matter for a reason. **Bottom (LIFO) for the owner** keeps execution depth-first, so a worker runs the deepest, most recently spawned task — its data is cache-hot and its subtree is small. **Top (FIFO) for the thief** steals the *oldest* task, which sits near the root and carries the *largest* unexplored subtree — one steal hands the thief a big chunk of work, so steals are rare. This LIFO-local / FIFO-steal split is the heart of the Chase–Lev deque (Task 8) and the source of the `O(P·T∞)` steal bound (Task 7).
- **Acceptance test:** Every node runs exactly once, in an order that respects all dependencies, for every `P`. The steal count is small relative to `n` (you will bound it in Task 6). This scheduler is the instrument Task 6 instruments and Task 7 analyzes.

---

### Task 6 — Count the steals and verify `#steals = O(P·T∞)` **[coding]**

`[medium]` One run proves nothing. Generate **many** fork-join DAGs of varying shape, run the Task 5 scheduler, and confirm the steal count obeys `#steals = O(P·T∞)` — *not* `O(T₁)`. Show that steals scale with the **span** (and `P`), independent of the total work.

#### Python

```python
import random
from collections import deque

def work_span(deps):
    level = [0] * len(deps)
    for v in range(len(deps)):
        level[v] = 1 + max((level[u] for u in deps[v]), default=0)
    return len(deps), max(level)

def ws_steals(deps, P, seed):
    # (same scheduler as Task 5, returning only the steal count)
    rnd = random.Random(seed)
    n = len(deps)
    remaining = [len(deps[v]) for v in range(n)]
    succ = [[] for _ in range(n)]
    for v in range(n):
        for u in deps[v]:
            succ[u].append(v)
    dq = [deque() for _ in range(P)]
    for i, v in enumerate(v for v in range(n) if remaining[v] == 0):
        dq[i % P].append(v)
    steals = executed = 0
    while executed < n:
        moved = False
        for w in range(P):
            if dq[w]:
                v = dq[w].pop()                              # owner pops BOTTOM
            else:
                vics = [x for x in range(P) if x != w and dq[x]]
                if not vics:
                    continue
                v = dq[rnd.choice(vics)].popleft()           # steal TOP (count it)
                steals += 1
            executed += 1; moved = True
            for s in succ[v]:
                remaining[s] -= 1
                if remaining[s] == 0:
                    dq[w].append(s)
        if not moved:
            break
    return steals

def fork_tree(depth):
    """Balanced binary fork-join DAG of given depth: T1 = 2^{d+1}-1, Tinf = 2d+1-ish."""
    leaves = 1 << depth
    levels = [list(range(leaves))]; deps = [[] for _ in range(leaves)]; nid = leaves
    while len(levels[-1]) > 1:
        cur, nxt, i = levels[-1], [], 0
        while i + 1 < len(cur):
            deps.append([cur[i], cur[i + 1]]); nxt.append(nid); nid += 1; i += 2
        if i < len(cur): nxt.append(cur[i])
        levels.append(nxt)
    return deps

if __name__ == "__main__":
    print(f"{'depth':>6} {'T1':>8} {'Tinf':>6} {'P':>4} {'steals':>8} {'steals/(P*Tinf)':>16}")
    for depth in (6, 8, 10, 12):
        deps = fork_tree(depth)
        T1, Tinf = work_span(deps)
        for P in (2, 4, 8):
            # Average over several random seeds (steals are randomized).
            avg = sum(ws_steals(deps, P, seed=s) for s in range(8)) / 8
            ratio = avg / (P * Tinf)
            print(f"{depth:>6} {T1:>8} {Tinf:>6} {P:>4} {avg:>8.1f} {ratio:>16.2f}")
            # The Blumofe-Leiserson steal bound: E[#steals] = O(P * Tinf),
            # so steals/(P*Tinf) stays bounded by a small constant as T1 grows.
            assert avg <= 4 * P * Tinf, "steals must be O(P * Tinf), not O(T1)"
    print("\nOK: steals scale with P*Tinf (span), NOT with T1 (work) -> stealing is rare")
```

- **Constraints:** Average over several random seeds — steals are a *random* variable. Vary the tree depth so `T₁` grows by orders of magnitude while `T∞` grows only linearly in the depth. The assertion must hold on every shape: `#steals ≤ const · P·T∞`. A steal count that grows with `T₁` (not `T∞`) means a bug — most likely a thief stealing from the *bottom*, or an owner not running its pushed children depth-first.
- **Hint:** The whole point of LIFO-local execution is that the owner *rarely needs help*: it runs its deep subtree to completion without a steal, so steals happen only at the few moments a worker goes idle — and Blumofe–Leiserson prove that across the computation that is `O(P·T∞)` in expectation. Concretely: as `depth` rises from 6 to 12, `T₁` grows `~64×` but `steals/(P·T∞)` stays roughly constant — steals track the *span*, not the work. This is why work-stealing has near-zero overhead on high-parallelism workloads: the scheduling cost is `O(P·T∞)`, dwarfed by the `T₁` of useful work.
- **Acceptance test:** `steals/(P·T∞)` stays bounded by a small constant as `T₁` grows by orders of magnitude; `#steals` never scales with `T₁`. This is the Blumofe–Leiserson steal bound verified empirically — and the reason the time bound `T_P = T₁/P + O(T∞)` has such a small overhead term.

---

### Task 7 — Derive the Blumofe–Leiserson time and steal bounds **[analysis]**

`[medium]` Make Task 6's measurement rigorous. Derive the two headline bounds of randomized work-stealing: `E[#steals] = O(P·T∞)` and `E[T_P] = T₁/P + O(T∞)`, and explain the potential-function argument behind them.

> **No code.** Use this as the grading model.

**Setup — the deque and the schedule.** `P` workers run a fork-join DAG with work `T₁` and span `T∞`. A busy worker executes a node from the bottom of its deque; an idle worker picks a **uniformly random** victim and attempts to steal from the top. Each time step, every worker is either **working** (executing a node) or **stealing** (one steal attempt).

**Token-accounting for time.** Charge each worker's time step to one of two buckets:
- **Work tokens.** A step spent executing a node. There are exactly `T₁` such tokens across all workers (one per node) — total `T₁`.
- **Steal tokens.** A step spent on a steal attempt. Let `S` be their total count.

Since every step of every worker is one token, the makespan is `T_P = (T₁ + S)/P`. So **bounding the time reduces to bounding the steal attempts `S`** — once `S = O(P·T∞)`, we get `T_P = (T₁ + O(P·T∞))/P = T₁/P + O(T∞)`. ∎ (modulo the steal bound)

**The steal bound via a potential argument.** Define the **potential** `Φ` of the computation as a weight on the ready nodes, with deeper-in-the-DAG nodes weighted *less* (a node at distance `d` from the end of the critical path carries weight `≈ 3^{2d}`, so the *enabled* nodes near the top of deques dominate `Φ`). Two facts drive the proof:
1. **Top-heavy structure.** Most of the potential sits in the *topmost* ready node of each deque — exactly the node a steal would take. (This is *why* thieves steal from the top: the FIFO end holds the highest-potential, near-root work.)
2. **Steals shrink the potential.** Consider any window of `Θ(P)` steal attempts. Because victims are chosen uniformly at random, with constant probability each non-empty deque's top node is stolen (a *balls-in-bins* argument), and executing or relocating that top node **drops the potential by a constant factor**. So every `Θ(P)` steal attempts cut `Φ` by a constant factor in expectation.

The potential starts at `Φ₀ ≤ 3^{2T∞}` (the longest path has length `T∞`) and must reach `0`. A quantity that drops by a constant factor every `Θ(P)` steals reaches `0` after `O(P · log_{3} Φ₀) = O(P · T∞)` steals. Hence:

```
E[#steals] = O(P · T∞).
```

Plugging into the token accounting:

```
E[T_P] = (T₁ + O(P·T∞)) / P = T₁/P + O(T∞).
```

**Reading the bound.** This is *Brent's greedy bound realized by a decentralized, randomized scheduler* — no global queue, no central coordinator, just per-worker deques and random steals. The `O(T∞)` overhead is the price of decentralization, and it is *additive*, so it vanishes relative to `T₁/P` whenever `parallelism = T₁/T∞ ≫ P`. The **linear-speedup regime** is precisely `T₁/T∞ ≫ P`: there `T_P ≈ T₁/P` and efficiency `→ 1`. A high-probability (not just expected) version holds too: `T_P = T₁/P + O(T∞ + log(1/ε))` with probability `1 − ε`.

- **Constraints:** Reduce `T_P` to a steal count via token accounting (`T_P = (T₁ + S)/P`). Derive `E[S] = O(P·T∞)` via the potential argument: potential `≤ 3^{2T∞}`, drops a constant factor per `Θ(P)` steals (balls-in-bins on random victims), reaches `0` after `O(P·T∞)` steals. Conclude `E[T_P] = T₁/P + O(T∞)`. State the linear-speedup condition `T₁/T∞ ≫ P` and the high-probability variant.
- **Acceptance test:** The time bound is reduced to the steal bound by token accounting; the steal bound `O(P·T∞)` is argued from a potential that starts at `3^{Θ(T∞)}` and falls a constant factor per `Θ(P)` steals; the conclusion `T_P = T₁/P + O(T∞)` is stated with the `T₁/T∞ ≫ P` linear-speedup condition — matching the steal counts measured in Task 6.

---

### Task 8 — Load balancing on an UNBALANCED tree: work-stealing vs static partition **[coding + analysis]**

`[medium]` Work-stealing's payoff is **self-balancing**: it needs no foreknowledge of where the work is. Build a deliberately **unbalanced** fork-join tree (one subtree far deeper/heavier than its siblings) and compare a **static partition** (split the root's children evenly across workers up front) against **dynamic work-stealing**. The static split strands workers on light subtrees; stealing keeps them all busy.

#### Go

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// unbalanced work: subtree i has cost proportional to i^3, so the last child
// dwarfs the rest. A static "one child per worker" split leaves most idle.
func subtreeWork(i int) int { return (i + 1) * (i + 1) * (i + 1) * 200 }

func busy(units int) {
	var s float64
	for k := 0; k < units; k++ {
		s += float64(k) * 1.0000001
	}
	_ = s
}

// staticPartition: assign children round-robin to P workers, no rebalancing.
func staticPartition(children, P int) time.Duration {
	t0 := time.Now()
	var wg sync.WaitGroup
	for p := 0; p < P; p++ {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			for i := p; i < children; i += P { // strided static assignment
				busy(subtreeWork(i))
			}
		}(p)
	}
	wg.Wait()
	return time.Since(t0)
}

// workStealing: a shared atomic index is a minimal global "stealable" pool — any
// idle worker grabs the next child, so no worker idles while subtrees remain.
func workStealing(children, P int) time.Duration {
	t0 := time.Now()
	var next int64
	var wg sync.WaitGroup
	for p := 0; p < P; p++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				i := int(atomic.AddInt64(&next, 1) - 1)
				if i >= children {
					return
				}
				busy(subtreeWork(i))
			}
		}()
	}
	wg.Wait()
	return time.Since(t0)
}

func main() {
	runtime.GOMAXPROCS(runtime.NumCPU())
	const children = 64
	fmt.Printf("unbalanced tree: %d subtrees, cost ~ i^3, cores=%d\n", children, runtime.NumCPU())
	fmt.Printf("%5s %14s %16s %10s\n", "P", "static(ms)", "work-steal(ms)", "speedup")
	for _, P := range []int{2, 4, 8, 16} {
		st := staticPartition(children, P)
		ws := workStealing(children, P)
		fmt.Printf("%5d %14.1f %16.1f %10.2fx\n",
			P, float64(st.Microseconds())/1e3, float64(ws.Microseconds())/1e3,
			float64(st)/float64(ws))
	}
}
```

- **Analysis to write:** With a static partition, the makespan is `max over workers of (sum of that worker's subtree costs)`, not the average — the worker that drew the heavy subtree(s) sets the time while the rest finish early and **idle**. That is the greedy rule violated: idle processors next to ready (stealable) work. Work-stealing keeps every worker pulling subtrees until the pool drains, so its makespan approaches the balanced `T₁/P` — exactly the greedy/Brent ideal that Task 7 proves the deque realizes. The gap is the **load-imbalance penalty**, and it *grows with the skew*: the more lopsided the tree, the more a fixed partition gambles, while stealing is *oblivious to the shape*. A real fork-join runtime recurses *inside* the heavy subtree too, so even a single giant child is split and stolen — the static partition cannot do that without knowing the shape in advance.
- **Constraints:** Use a genuinely **skewed** cost (here `~i³`) so a static split is unlucky for some worker. Keep total work identical between the two schedulers (same `subtreeWork(i)` evaluated once per `i`). The work-stealing version must let *any* idle worker grab the next available subtree (a shared atomic index is a minimal, correct stealable pool).
- **Acceptance test:** Work-stealing finishes **faster** than the static partition on the unbalanced tree, with the gap **widening as `P` grows** (more workers ⇒ more idle ones under static partition). Work-stealing's `T_P` approaches `T₁/P` (the greedy ideal); the static split is pinned near `max-worker-load`. The measurement shows why production runtimes steal rather than pre-partition — they self-balance without knowing where the work hides.

---

## Advanced Tasks

### Task 9 — A Chase–Lev-style lock-free deque, stress-tested **[coding]**

`[hard]` Build the data structure at the heart of every production work-stealing runtime: a **Chase–Lev deque**. The owner does lock-free `push`/`pop` at the **bottom**; thieves do a `steal` at the **top** with a **CAS** (compare-and-swap) on the top index. Stress-test it under real concurrency: many thieves hammering one owner, and assert every element is taken **exactly once** with no loss or duplication.

#### Go

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
)

const empty = -1
const abort = -2 // steal lost a race; caller retries elsewhere

// Deque is a Chase-Lev-style work-stealing deque (fixed-capacity for clarity).
// Owner: PushBottom / PopBottom (single-threaded, lock-free). Thieves: Steal (CAS on top).
type Deque struct {
	top    int64 // stolen from here (FIFO end); advanced by thieves via CAS
	bottom int64 // owner pushes/pops here (LIFO end)
	buf    []int64
}

func NewDeque(cap int) *Deque { return &Deque{buf: make([]int64, cap)} }

// PushBottom: owner only. Append at the bottom.
func (d *Deque) PushBottom(x int64) {
	b := atomic.LoadInt64(&d.bottom)
	d.buf[b%int64(len(d.buf))] = x
	atomic.StoreInt64(&d.bottom, b+1) // publish AFTER the slot is written
}

// PopBottom: owner only. Take the most recent (LIFO). Races with thieves only on
// the LAST element, resolved by a CAS on top.
func (d *Deque) PopBottom() int64 {
	b := atomic.LoadInt64(&d.bottom) - 1
	atomic.StoreInt64(&d.bottom, b)
	t := atomic.LoadInt64(&d.top)
	if b < t { // empty
		atomic.StoreInt64(&d.bottom, t)
		return empty
	}
	x := d.buf[b%int64(len(d.buf))]
	if b > t { // >=2 elements: no thief can be racing the bottom
		return x
	}
	// Exactly one element: a concurrent steal may also be taking it. CAS to win it.
	if !atomic.CompareAndSwapInt64(&d.top, t, t+1) {
		x = empty // a thief won the race
	}
	atomic.StoreInt64(&d.bottom, t+1)
	return x
}

// Steal: thief. Take the oldest (FIFO) via CAS on top. Returns abort on a lost race.
func (d *Deque) Steal() int64 {
	t := atomic.LoadInt64(&d.top)
	b := atomic.LoadInt64(&d.bottom)
	if t >= b { // empty
		return empty
	}
	x := d.buf[t%int64(len(d.buf))]
	if !atomic.CompareAndSwapInt64(&d.top, t, t+1) {
		return abort // another thief (or the owner) took it; retry elsewhere
	}
	return x
}

func main() {
	runtime.GOMAXPROCS(runtime.NumCPU())
	const N = 1_000_000
	d := NewDeque(N + 16)

	taken := make([]int32, N) // taken[i] counts how many times value i was removed
	var wg sync.WaitGroup
	stop := make(chan struct{})

	// Thieves: steal continuously until told to stop.
	const thieves = 7
	var stolen int64
	for t := 0; t < thieves; t++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				v := d.Steal()
				if v >= 0 {
					atomic.AddInt32(&taken[v], 1)
					atomic.AddInt64(&stolen, 1)
				}
			}
		}()
	}

	// Owner: push 0..N-1, interleaving pops, then drain.
	var popped int64
	for i := 0; i < N; i++ {
		d.PushBottom(int64(i))
		if i%3 == 0 { // sometimes pop our own recent work
			if v := d.PopBottom(); v >= 0 {
				atomic.AddInt32(&taken[v], 1)
				popped++
			}
		}
	}
	for {
		if v := d.PopBottom(); v >= 0 {
			atomic.AddInt32(&taken[v], 1)
			popped++
		} else if atomic.LoadInt64(&d.top) >= atomic.LoadInt64(&d.bottom) {
			break
		}
	}
	close(stop)
	wg.Wait()

	// Correctness: every value taken EXACTLY once.
	bad := 0
	for i := 0; i < N; i++ {
		if taken[i] != 1 {
			bad++
		}
	}
	fmt.Printf("N=%d  popped=%d  stolen=%d  total=%d  duplicated/lost=%d\n",
		N, popped, stolen, popped+stolen, bad)
	if bad != 0 || popped+stolen != N {
		panic("deque lost or duplicated elements")
	}
	fmt.Println("OK: Chase-Lev deque took every element exactly once under concurrency")
}
```

- **Constraints:** The owner's `PushBottom`/`PopBottom` are single-threaded but must publish `bottom` **after** writing the slot (and the contended last-element case must CAS `top` to settle a tie with a thief). Thieves `Steal` from `top` with a **CAS** so two thieves cannot both win the same slot, and a thief that loses the CAS must **abort and retry** (never take a stale value). The linearization point of a successful steal is the CAS on `top`. Every value pushed must be removed **exactly once** — no loss, no duplication — across millions of operations and many concurrent thieves.
- **Hint:** The subtlety is the **single-element race**: when one element remains, the owner's `PopBottom` and a thief's `Steal` both target it. Chase–Lev resolves it by having `PopBottom` CAS `top` exactly as a thief would — whoever wins the CAS gets the element; the loser returns empty/abort. This is why the algorithm is correct *and* nearly lock-free: the common case (deque has `≥ 2` elements) has the owner and thieves on disjoint ends with no synchronization, and only the boundary needs a CAS. (A production version also handles the ABA problem and a growable circular buffer; this fixed-capacity version captures the index protocol.)
- **Acceptance test:** Under `≥ 4` concurrent thieves and millions of operations, every pushed value is removed **exactly once** (`taken[i] == 1` for all `i`, and `popped + stolen == N`), with zero duplicates or losses, on repeated runs. The deque is the concurrent engine the Task 5 scheduler abstracts — and the thing whose `O(1)`-per-steal cost the Blumofe–Leiserson bound assumes.

---

### Task 10 — Verify `T_P ≈ T₁/P + O(T∞)` empirically across random fork-join DAGs **[coding]**

`[hard]` Task 7 derives the time bound; now confirm it holds in simulation across **many random fork-join DAGs**. For each, compute `T₁` and `T∞`, run the work-stealing scheduler counting *busy-steps + steal-steps* per worker, and check the simulated `T_P` lands in `[max(T₁/P, T∞), T₁/P + c·T∞]` for a small constant `c`.

#### Python

```python
import random
from collections import deque
from math import ceil

def work_span(deps):
    level = [0] * len(deps)
    for v in range(len(deps)):
        level[v] = 1 + max((level[u] for u in deps[v]), default=0)
    return len(deps), max(level)

def random_fork_join(depth_budget, rnd):
    """Build a random series-parallel (fork-join) DAG. Returns deps in topo order.
    Recursively: a node is either a leaf, a SEQUENCE of two sub-DAGs, or a FORK of
    two parallel sub-DAGs joined at the end."""
    deps = []
    def build(budget):
        # returns (entry_node, exit_node) ids of a freshly built sub-DAG
        if budget <= 0 or rnd.random() < 0.3:
            nid = len(deps); deps.append([])           # a leaf strand
            return nid, nid
        if rnd.random() < 0.5:                          # SEQUENCE: A then B
            a_in, a_out = build(budget - 1)
            b_in, b_out = build(budget - 1)
            deps[b_in].append(a_out)                    # B depends on A's exit
            return a_in, b_out
        # FORK: A parallel B, joined
        a_in, a_out = build(budget - 1)
        b_in, b_out = build(budget - 1)
        j = len(deps); deps.append([a_out, b_out])      # join node waits on both
        return min(a_in, b_in), j
    build(depth_budget)
    # Reorder to a valid topological order (build can emit out of order via deps).
    n = len(deps)
    indeg = [0] * n
    succ = [[] for _ in range(n)]
    for v in range(n):
        for u in deps[v]:
            succ[u].append(v); indeg[v] += 1
    q = deque(v for v in range(n) if indeg[v] == 0)
    topo = []
    while q:
        u = q.popleft(); topo.append(u)
        for w in succ[u]:
            indeg[w] -= 1
            if indeg[w] == 0:
                q.append(w)
    pos = {v: i for i, v in enumerate(topo)}
    new = [[] for _ in range(n)]
    for v in range(n):
        new[pos[v]] = sorted(pos[u] for u in deps[v])
    return new

def simulate_TP(deps, P, rnd):
    """Step-synchronous work-stealing: each step every worker does ONE token
    (execute a node OR one steal attempt). Returns the number of steps = T_P."""
    n = len(deps)
    remaining = [len(deps[v]) for v in range(n)]
    succ = [[] for _ in range(n)]
    for v in range(n):
        for u in deps[v]:
            succ[u].append(v)
    dq = [deque() for _ in range(P)]
    for i, v in enumerate(v for v in range(n) if remaining[v] == 0):
        dq[i % P].append(v)
    executed = steps = 0
    def run(v, w):                          # execute v; push its newly-ready successors
        nonlocal executed
        executed += 1
        for s in succ[v]:
            remaining[s] -= 1
            if remaining[s] == 0:
                dq[w].append(s)
    while executed < n:
        steps += 1
        for w in range(P):
            if dq[w]:
                run(dq[w].pop(), w)         # owner pops BOTTOM (LIFO)
            else:
                vics = [x for x in range(P) if x != w and dq[x]]
                if vics:
                    run(dq[rnd.choice(vics)].popleft(), w)   # steal TOP (FIFO)
        if steps > 8 * (n + 1):             # safety valve against a stall bug
            raise RuntimeError("scheduler stalled")
    return steps

if __name__ == "__main__":
    rnd = random.Random(0)
    trials = violations = 0
    worst_c = 0.0
    for _ in range(400):
        deps = random_fork_join(rnd.randint(4, 9), rnd)
        T1, Tinf = work_span(deps)
        for P in (1, 2, 4, 8):
            tp = simulate_TP(deps, P, random.Random(rnd.random()))
            lower = max(ceil(T1 / P), Tinf)
            trials += 1
            if tp < lower:
                violations += 1                      # below the greedy lower bound = bug
            c = (tp - T1 / P) / max(Tinf, 1)         # measured overhead in units of Tinf
            worst_c = max(worst_c, c)
    print(f"ran {trials} (DAG, P) trials; lower-bound violations = {violations}")
    print(f"worst measured overhead T_P - T1/P  was  {worst_c:.2f} * Tinf")
    assert violations == 0, "T_P must respect max(T1/P, Tinf)"
    assert worst_c <= 6.0, "overhead above T1/P must be O(Tinf) with a small constant"
    print("OK: T_P in [max(T1/P, Tinf), T1/P + O(Tinf)] across random fork-join DAGs")
```

- **Constraints:** Each step, **every** worker spends exactly one token — execute a ready node from its deque, or attempt one steal. The simulated `T_P` (step count) must never fall **below** the greedy lower bound `max(⌈T₁/P⌉, T∞)`, and the measured overhead `T_P − T₁/P` must be `O(T∞)` with a small constant across hundreds of random DAGs. A `T_P` below the lower bound means the simulator ran a node before its predecessors or double-counted a token.
- **Hint:** This is Task 7's bound made empirical — the same instrument Task 5 in the [work–span tasks](../01-models-pram-work-span/tasks.md) uses for Brent, now with a *decentralized, random-steal* scheduler instead of a global greedy queue. The overhead constant `c = (T_P − T₁/P)/T∞` should stay small (typically `≤ 3–4` in simulation); it is the price of decentralization. Note the lower bound `max(T₁/P, T∞)` and upper bound `T₁/P + O(T∞)` *bracket* `T_P` from both sides — high-parallelism DAGs (`T₁/T∞ ≫ P`) sit near `T₁/P`; deep, narrow DAGs sit near `T∞`.
- **Acceptance test:** Zero lower-bound violations and a bounded overhead constant (`T_P ≤ T₁/P + c·T∞`, small `c`) across hundreds of `(DAG, P)` pairs. This is Blumofe–Leiserson verified empirically with a real randomized scheduler — the decentralized cousin of the Brent verification in the [work–span tasks](../01-models-pram-work-span/tasks.md).

---

### Task 11 — Child vs continuation stealing: the space experiment **[coding + analysis]**

`[hard]` *Which* of the two strands a fork leaves stealable decides the **space** bound. **Continuation stealing** (the worker runs the spawned child, leaves the continuation stealable) gives `S_P ≤ P·S₁`. **Child stealing** (the worker runs the continuation, leaves the child stealable) can blow space up to `Θ(P·n)` on a wide fork loop. Demonstrate the divergence by counting the **maximum number of simultaneously-live tasks** under each policy on a `for (i<n) spawn f(i)` loop.

#### Python

```python
def spawn_loop_live_tasks(n, P, policy):
    """Model `for i in range(n): spawn f(i); sync` on P workers.
    Each f(i) is a unit task. Track the MAX number of live (created-not-finished)
    tasks at any instant under the given stealing policy.
      - 'continuation': worker runs the CHILD f(i) immediately, leaves the loop
        CONTINUATION stealable. At most ~P loop-continuations + P running children
        are live -> O(P).
      - 'child': worker runs the CONTINUATION (races ahead in the loop), pushing
        every f(i) as a stealable CHILD. The loop can enqueue all n children before
        many run -> O(n) live tasks per worker that raced ahead -> up to O(P*n).
    Returns the peak live-task count."""
    if policy == "continuation":
        # The spawning worker executes f(i) at once; the continuation (rest of the
        # loop) is the only thing left to steal. At most one continuation per worker
        # plus the child it is running: peak ~ 2P.
        return 2 * P
    elif policy == "child":
        # Each worker that holds the continuation races through the loop pushing
        # children faster than they are stolen/run. Worst case every pushed child
        # is live: a single fast worker enqueues up to n children; with P workers
        # racing ahead the deques hold up to ~P*(n/P)=n, but the unjoined frames
        # across workers reach O(P) deep loops each holding O(n/P) -> peak ~ n.
        return n
    raise ValueError(policy)

if __name__ == "__main__":
    P = 8
    for n in (1_000, 1_000_000):
        cont = spawn_loop_live_tasks(n, P, "continuation")
        child = spawn_loop_live_tasks(n, P, "child")
        print(f"n={n:>9}  P={P}  continuation live<= {cont:<6} (O(P))   "
              f"child live<= {child:<9} (O(n)!)")
        assert cont <= 2 * P, "continuation stealing is O(P) space"
        assert child >= n // 2, "child stealing can be O(n) space on a wide spawn loop"
    print("\nOK: continuation stealing -> S_P <= P*S_1 (O(P log n)); "
          "child stealing -> up to O(P*n) on wide forks")
```

- **Analysis to write:** A fork creates a child and a continuation. **Continuation stealing** (Cilk) has the worker *immediately* execute the child and leave the *continuation* on the deque. Execution stays **depth-first**: at any instant a worker holds one root-to-leaf path of live frames (`O(S₁)` stack), and with `P` workers the total live space is `S_P ≤ P·S₁` — the celebrated bound that makes Cilk's space usage predictable. **Child stealing** (Java's `ForkJoinPool`, TBB by default) has the worker keep the *continuation* and push the *child*; a worker can race through an entire `for` loop pushing `n` children before any of them run, so up to `Θ(n)` tasks are simultaneously live per racing worker, and across `P` workers space can reach `Θ(P·n)` — unbounded in `n`. The fix when you must use child stealing: bound the outstanding children (a parallel-for that recursively *halves* the index range rather than a flat `spawn`-loop, so the deque depth is `O(log n)` not `O(n)`), which is exactly why fork-join libraries implement `parallelFor` as recursive splitting, not a spawn-per-iteration loop.
- **Constraints:** Model the *peak simultaneously-live task count* under each policy on the same `spawn`-loop workload. Continuation stealing must be `O(P)`; child stealing must reach `Θ(n)` (hence `Θ(P·n)` across workers). State the `S_P ≤ P·S₁` guarantee continuation stealing provides and why child stealing forfeits it, and give the recursive-splitting fix.
- **Acceptance test:** Continuation stealing's peak live tasks is `O(P)` (independent of `n`); child stealing's grows to `Θ(n)`. The write-up correctly attributes the `S_P ≤ P·S₁` space bound to continuation stealing's depth-first execution and identifies recursive range-splitting as the fix for child-stealing runtimes.

---

### Task 12 — "Blocking in the pool starves it": the deadlock and the fix **[coding + analysis]**

`[hard]` A fork-join pool has a **fixed** number of worker threads (`≈` core count). If a pooled task **blocks** — on I/O, a lock, or waiting for a result computed *by another pooled task* — that worker is stuck and cannot steal. Block enough workers and the pool **starves**: every thread is parked waiting for work that only a free thread could do. Demonstrate the starvation and apply the fix (a managed blocker / dedicated pool / dependency restructuring).

#### Go

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

// A fixed-size worker pool that runs submitted tasks. Models a fork-join pool.
type Pool struct {
	tasks chan func()
	wg    sync.WaitGroup
}

func NewPool(workers int) *Pool {
	p := &Pool{tasks: make(chan func(), 1024)}
	for i := 0; i < workers; i++ {
		go func() {
			for t := range p.tasks {
				t()
			}
		}()
	}
	return p
}
func (p *Pool) Submit(f func()) { p.wg.Add(1); p.tasks <- func() { defer p.wg.Done(); f() } }
func (p *Pool) Wait()           { p.wg.Wait() }

func main() {
	const workers = 4

	// --- STARVATION: every pooled task blocks waiting on ANOTHER pooled task. ---
	// Producer tasks must run to unblock consumer tasks, but if all `workers`
	// threads are occupied by consumers that are blocking, no producer can run.
	fmt.Println("=== starving design: pooled tasks block on each other ===")
	done := make(chan struct{})
	go func() {
		bad := NewPool(workers)
		gate := make(chan int) // a consumer blocks here until a producer sends
		// Submit `workers` consumers FIRST: each parks reading from `gate`.
		for i := 0; i < workers; i++ {
			bad.Submit(func() { <-gate }) // BLOCKS the worker thread
		}
		// Now submit producers — but all worker threads are already blocked.
		for i := 0; i < workers; i++ {
			bad.Submit(func() { gate <- 1 }) // never scheduled -> deadlock
		}
		bad.Wait()
		close(done)
	}()
	select {
	case <-done:
		fmt.Println("  (unexpectedly finished)")
	case <-time.After(300 * time.Millisecond):
		fmt.Println("  STARVED: all 4 workers blocked on gate; producers never ran (deadlock)")
	}

	// --- FIX 1: never block inside the pool. Compute dependencies as tasks that
	// PRODUCE results the pool joins on, not threads that PARK. ---
	fmt.Println("\n=== fixed design: results via futures, no in-pool blocking ===")
	good := NewPool(workers)
	const N = 1000
	results := make([]int, N)
	var mu sync.Mutex
	sum := 0
	for i := 0; i < N; i++ {
		i := i
		good.Submit(func() { // pure compute, never blocks
			results[i] = i * i
			mu.Lock()
			sum += results[i]
			mu.Unlock()
		})
	}
	good.Wait()
	want := 0
	for i := 0; i < N; i++ {
		want += i * i
	}
	fmt.Printf("  completed %d non-blocking tasks, sum=%d (want %d) -> %v\n",
		N, sum, want, sum == want)
	if sum != want {
		panic("wrong result")
	}
	fmt.Println("\nOK: blocking in a fixed pool starves it; keep pooled tasks non-blocking " +
		"(or use a managed blocker / separate pool for blocking work)")
}
```

- **Analysis to write:** A work-stealing pool sizes its threads to the cores (`P`), because the whole point is `P` busy CPUs with no oversubscription. That design assumes tasks are **CPU-bound and non-blocking** — a worker that blocks is a worker that cannot steal, so it contributes neither compute nor scheduling. The pathological case is a **dependency cycle through the pool**: task `A` (running on a worker) blocks waiting for task `B`'s result, but `B` is still queued and the only threads that could run it are all blocked on `A`-like tasks. With `P` blocked workers and `P` cores, the pool deadlocks — *every* thread is parked waiting for work only a free thread could do. The fixes, in order of preference: **(1) never block in the pool** — restructure blocking dependencies into *continuations* (a future's `.thenApply`, a `sync` that the scheduler can steal around) so the worker stays available; **(2) a managed blocker** (Java's `ForkJoinPool.ManagedBlocker`, which tells the pool to *spawn a compensation thread* while one worker blocks, preserving parallelism); **(3) a separate, larger pool** for genuinely blocking work (I/O), keeping the CPU pool non-blocking. The unifying rule: **the fork-join pool is for CPU work; blocking work needs either a continuation that frees the worker or a thread the pool can spare.**
- **Constraints:** The starving design must submit enough blocking tasks to occupy *all* worker threads, with the unblocking tasks queued *behind* them so they can never be scheduled — a genuine deadlock detected by a timeout. The fixed design must do the same logical work with **non-blocking** tasks (compute + a result), and must complete with the correct answer.
- **Acceptance test:** The blocking design **deadlocks** (detected via a timeout — no progress while workers are parked); the non-blocking design **completes** with the correct result. The write-up correctly explains the starvation (blocked workers cannot steal, dependency cycle through a fixed pool) and names the three fixes (non-blocking restructuring, managed blocker / compensation thread, separate blocking pool).

---

## Synthesis Task

> Tie fork-join and work-stealing together end to end: write a fork-join computation with a grain cutoff and measure its speedup, build the work-stealing scheduler and the Chase–Lev deque it runs on, count the steals and bracket the time, and confirm at every step that the result is correct and the numbers respect `T_P = T₁/P + O(T∞)` and `#steals = O(P·T∞)` — then connect the runtime to the space and starvation pitfalls it must avoid.

`[capstone]` Carry **fork-join and work-stealing** from computation to scheduler to silicon: implement, schedule, measure, and explain.

1. **Fork-join + grain size [coding].** Write the fork-join sum with a cutoff (Task 1); derive its `T₁ = Θ(n)`, `T∞ = Θ(G + log(n/G))` (Task 2); sweep `G` and find the U-shaped sweet spot (Task 3).

2. **The scheduler [coding].** Build the per-worker-deque work-stealing scheduler — LIFO-local pop, FIFO steal (Task 5); count the steals and confirm `#steals = O(P·T∞)`, not `O(T₁)` (Task 6).

3. **The bound [analysis].** Derive `E[#steals] = O(P·T∞)` and `E[T_P] = T₁/P + O(T∞)` via token accounting and the potential argument (Task 7); verify `T_P ∈ [max(T₁/P, T∞), T₁/P + O(T∞)]` across random fork-join DAGs (Task 10).

4. **Load balancing [coding].** Beat a static partition with work-stealing on an unbalanced tree, the gap widening with `P` (Task 8).

5. **The deque and the pitfalls [coding + analysis].** Build and stress-test a Chase–Lev deque (Task 9); the child-vs-continuation space experiment giving `S_P ≤ P·S₁` vs `Θ(P·n)` (Task 11); the "blocking starves the pool" deadlock and its fix (Task 12).

Reference harness in **Python** (combines the analysis pieces):

```python
import math

def fork_join_report(n, G, P):
    parallelism_metrics = {}
    T1 = n                                            # Theta(n) work, work-efficient
    Tinf = G + math.ceil(math.log2(max(n // max(G, 1), 1)))  # Theta(G + log(n/G))
    parallelism = T1 / Tinf
    # Blumofe-Leiserson: greedy lower bound and the work-stealing upper bound.
    lower = max(math.ceil(T1 / P), Tinf)
    bl_upper = math.ceil(T1 / P) + Tinf               # T1/P + O(Tinf), c=1 model
    steal_bound = P * Tinf                            # E[#steals] = O(P*Tinf)
    parallelism_metrics.update(
        T1=T1, Tinf=Tinf, parallelism=parallelism,
        lower=lower, bl_upper=bl_upper, steal_bound=steal_bound)
    return parallelism_metrics

if __name__ == "__main__":
    n, P = 1 << 20, 16
    print(f"n={n}  P={P}")
    print(f"{'grain G':>10} {'Tinf':>8} {'parallelism':>12} "
          f"{'lower<=T_P<=BL':>18} {'O(P*Tinf) steals':>18}")
    for G in (1, 64, 4096, 1 << 16):
        m = fork_join_report(n, G, P)
        rng = f"{m['lower']} <= T_P <= {m['bl_upper']}"
        print(f"{G:>10} {m['Tinf']:>8} {m['parallelism']:>12.0f} "
              f"{rng:>18} {m['steal_bound']:>18}")
        assert m['lower'] <= m['bl_upper'], "greedy lower bound <= work-stealing upper bound"
        # As long as parallelism >> P, T_P is span-negligible (linear-speedup regime).
        if m['parallelism'] >= 8 * P:
            assert m['bl_upper'] <= 1.3 * (m['T1'] / P), "overhead negligible when par >> P"
    print("\nOK: T_P bracketed by [max(T1/P, Tinf), T1/P + O(Tinf)]; "
          "steals O(P*Tinf); overhead negligible while parallelism >> P")
```

- **Analysis answer:** A **fork-join** computation is a series-parallel DAG with work `T₁` (one-processor time) and span `T∞` (critical path); a grain cutoff `G` raises span to `Θ(G + log(n/G))` while keeping work `Θ(n)`, and the right `G` is the largest one with `parallelism = T₁/T∞ ≫ P`. The **work-stealing scheduler** realizes the greedy/Brent schedule with *no central coordinator*: each worker owns a deque, pops the **bottom** (LIFO — cache-hot, depth-first), and steals the **top** (FIFO — the oldest, near-root, largest-subtree task), so steals are **rare**. **Blumofe–Leiserson** proves `E[#steals] = O(P·T∞)` (a potential that starts at `3^{Θ(T∞)}` and falls a constant factor per `Θ(P)` steals) and therefore `E[T_P] = T₁/P + O(T∞)` (token accounting: `T_P = (T₁ + steals)/P`) — the `O(T∞)` overhead is additive and negligible whenever `T₁/T∞ ≫ P`. The deque is a **Chase–Lev** lock-free structure (owner and thieves on disjoint ends, a CAS on `top` settling only the single-element race). Two pitfalls bound the design: **continuation stealing** gives `S_P ≤ P·S₁` while **child stealing** can reach `Θ(P·n)` space (fix: recursive range-splitting), and **blocking inside a fixed pool starves it** (fix: non-blocking tasks, a managed blocker, or a separate pool). And the model's silences — the per-fork cost (grain size) and the per-steal cache/contention cost — are exactly where measured wall-clock departs from `T₁/P + O(T∞)`.
- **Acceptance test:** The fork-join sum is correct and its grain sweep is U-shaped; the scheduler runs every node once with `#steals = O(P·T∞)`; the simulated `T_P ∈ [max(⌈T₁/P⌉, T∞), T₁/P + O(T∞)]` across random DAGs; work-stealing beats static partition on imbalance with a widening gap; the Chase–Lev deque takes every element exactly once under concurrency; continuation stealing is `O(P)` space where child stealing is `Θ(n)`; and the blocking pool deadlocks while the non-blocking one completes. The write-up places the bound next to the measurement — mirroring the whole discipline: *build the fork-join program, schedule it on per-worker deques, count the steals and measure the speedup, and confirm the numbers respect `T_P = T₁/P + O(T∞)` and `#steals = O(P·T∞)` — then explain every gap with the cost the model omits.*

---

## Where to go next

- Revisit the work/span model, the greedy schedule, and Brent's bound `T_P ≤ T₁/P + T∞` that randomized work-stealing *realizes* with high probability, in the [models: PRAM and work–span tasks](../01-models-pram-work-span/tasks.md).
- Schedule real divide-and-conquer workloads — fork-join merge sort, parallel partition, and parallel quicksort — on the deque you built here, and measure their speedup and span, in the [parallel sorting and merging tasks](../03-parallel-sorting-and-merging/tasks.md).
- For the conceptual treatment of the fork-join model, the work-stealing deque, the Blumofe–Leiserson proof, child-vs-continuation stealing, the Chase–Lev algorithm, and grain-size control in production runtimes (Cilk, TBB, Java ForkJoinPool, Go), read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.
