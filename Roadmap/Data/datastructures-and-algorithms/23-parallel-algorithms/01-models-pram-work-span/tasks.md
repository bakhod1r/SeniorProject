# Models of Parallel Computation: PRAM and Work–Span — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, build the **work–span analyzer / greedy scheduler / parallel benchmark**, run it, and **confirm the measured numbers respect the laws**. The acceptance test is always the same shape: *the measured or derived `T_P` respects the Work Law `T_P ≥ T₁/P`, the Span Law `T_P ≥ T∞`, and the Brent bound `T_P ≤ T₁/P + T∞`.*
> **[analysis]** tasks need no code: derive a work/span, apply Brent, or work an Amdahl/Gustafson number from first principles — model derivations are provided so you can grade yourself.

A parallel computation is modeled as a **DAG of unit tasks**. Two numbers summarize it and everything else follows from them:

- **`T₁`** — the **work**: the total number of unit tasks, equivalently the time on **one** processor.
- **`T∞`** — the **span** (depth, critical-path length): the number of tasks on the **longest directed path**, equivalently the time on **infinitely** many processors.

Two derived quantities recur and must become reflexes:

- `parallelism = T₁/T∞` — the *average* width of the DAG; the maximum speedup any schedule can ever achieve, and the processor count beyond which workers must idle.
- `S_P = T₁/T_P`, `E_P = S_P/P` — the **speedup** and **efficiency** on `P` processors.

The bounds you will measure, derive, and verify on every task:

| Bound | Statement | Why |
| --- | --- | --- |
| **Work Law** | `T_P ≥ T₁/P` | `P` workers do at most `P·T_P` tasks; all `T₁` must be done |
| **Span Law** | `T_P ≥ T∞` | the critical path serializes; even `∞` processors cannot beat `T∞` |
| **Brent bound** | `T_P ≤ T₁/P + T∞` | a greedy schedule has `≤ T₁/P` complete and `≤ T∞` incomplete steps |
| **Amdahl** | `S_P = 1/(s + (1−s)/P) → 1/s` | serial fraction `s` is a hard ceiling (fixed problem) |
| **Gustafson** | `S_P = s + (1−s)·P` | scaled problem; linear, unbounded |

The recurring discipline for every coding task is identical: **build the DAG (or the parallel program), compute `T₁` and `T∞`, run a schedule (or measure wall-clock), and confirm the achieved `T_P` lands between `max(T₁/P, T∞)` and `T₁/P + T∞`.** A work/span you never schedule against is just a pair of numbers; a measured speedup you cannot bracket with the laws is just noise. Tie the two together on every task.

**Related practice:**
- [Fork–Join and Work-Stealing tasks](../07-fork-join-and-work-stealing/tasks.md) — the runtime that *realizes* the greedy schedule Brent's theorem assumes, randomized work-stealing analysis, and grain-size control in practice.
- [Parallel Prefix Sum / Scan tasks](../02-parallel-prefix-sum-scan/tasks.md) — the work-efficient `Θ(n)`-work `Θ(log n)`-span scan you analyze here, built and benchmarked in full.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the model and quantities used throughout:
- **Unit task.** One DAG node = one strand of serial work taking one time step. Edges are dependencies: a node is **ready** only when all its predecessors have finished.
- **Greedy schedule.** At each step, if `≥ P` tasks are ready, run any `P` (a *complete* step); else run *all* ready tasks (an *incomplete* step). Never idle a processor next to a ready task.
- **PRAM vs work–span.** The PRAM fixes `P` and steps in lockstep (EREW ⊆ CREW ⊆ CRCW); the work–span model is `P`-independent and Brent's principle compiles it to any `P`. We use work–span for scheduling and PRAM only where the variant matters.
- **The idealization.** Both models charge **nothing** for communication, memory contention, or synchronization. `T_P = T₁/P + T∞` measures *inherent* parallelism, not wall-clock — which is exactly why the coding tasks that *do* measure wall-clock reveal where the model and the hardware part ways (the memory-bandwidth ceiling, scheduling overhead, grain size).

---

## Beginner Tasks

### Task 1 — Compute `T₁`, `T∞`, and parallelism of a task DAG by longest path **[coding]**

`[easy]` Build the core instrument used by every later task: given a DAG (each node a unit task, each edge a dependency), compute the **work** `T₁` (node count), the **span** `T∞` (longest path in nodes), and the **parallelism** `T₁/T∞`. Process nodes in topological order; the longest-path-to-a-node recurrence is `level[v] = 1 + max over predecessors u of level[u]`, and `T∞ = max_v level[v]`.

Then run it on a balanced binary reduction tree over 8 leaves (15 nodes, span 4) and confirm `T₁ = 15`, `T∞ = 4`, parallelism `= 3.75`.

#### Python

```python
def work_span(deps):
    """deps[v] = list of predecessors of node v, input in topological order.
    Returns (T1, Tinf, level): work = node count, span = longest path (nodes),
    level[v] = longest distance from a source to v (1-based)."""
    n = len(deps)
    level = [0] * n
    for v in range(n):
        best = max((level[u] for u in deps[v]), default=0)
        level[v] = best + 1            # one step below its deepest predecessor
    return n, max(level), level

if __name__ == "__main__":
    # Balanced binary reduction tree over 8 leaves.
    # 0..7 leaves; 8..11 level-1; 12,13 level-2; 14 root.
    deps = [
        [], [], [], [], [], [], [], [],     # 0..7 leaves
        [0, 1], [2, 3], [4, 5], [6, 7],     # 8..11
        [8, 9], [10, 11],                   # 12,13
        [12, 13],                           # 14 root
    ]
    T1, Tinf, level = work_span(deps)
    print(f"reduction DAG:  T1={T1}  Tinf={Tinf}  parallelism={T1/Tinf:.2f}")
    assert T1 == 15 and Tinf == 4
    assert abs(T1 / Tinf - 3.75) < 1e-9
    print("OK: T1 = node count, Tinf = longest path, parallelism = T1/Tinf")
```

#### Go (core)

```go
// WorkSpan returns T1 (= #nodes), Tinf (= longest path in nodes), and level[].
// deps[v] = predecessors of v; nodes given in topological order 0..n-1.
func WorkSpan(deps [][]int) (T1, Tinf int, level []int) {
	level = make([]int, len(deps))
	for v := range deps {
		best := 0
		for _, u := range deps[v] {
			if level[u] > best {
				best = level[u]
			}
		}
		level[v] = best + 1
		if level[v] > Tinf {
			Tinf = level[v]
		}
	}
	return len(deps), Tinf, level
}
```

- **Constraints:** Input must be in **topological order** so every predecessor is processed before the node (otherwise `level[u]` is not yet final). `T∞` is the genuine *longest* path, not the number of levels you drew — use the `max`-over-predecessors recurrence. A node with no predecessors has `level = 1`.
- **Hint:** The longest path to `v` is one more than the longest path to its deepest predecessor — a one-pass DP over a topological order, `O(V + E)`. The reduction tree has 4 levels (8 leaves → 4 → 2 → 1), so `T∞ = 4`; it has `8 + 4 + 2 + 1 = 15` nodes, so `T₁ = 15`.
- **Acceptance test:** `T₁ = 15`, `T∞ = 4`, parallelism `= 3.75` for the reduction tree. Keep this `work_span` function — every later task drives it (or the greedy scheduler built on top of it).

---

### Task 2 — Work and span of summing `n` numbers (the reduction tree) **[analysis]**

`[easy]` Before scheduling anything, derive the work and span of the canonical parallel primitive: summing `n` numbers with a balanced binary **reduction tree** (pair up adjacent elements, combine, halve the count, repeat).

> **No code.** Use this as the grading model.

**Model derivation.**

*Work.* Level `k` (counting from the leaves, `k = 0`) performs `n/2^{k+1}` additions. Summing over all levels:

```
T₁ = n/2 + n/4 + … + 1 = n − 1 = Θ(n).
```

Every value is touched a constant number of times, and the sequential sum also does `n − 1` additions — so the reduction is **work-efficient** (`T₁ = Θ(T_seq)`).

*Span.* The tree has `⌈log₂ n⌉` levels, and each level depends on the one below it (you cannot combine a partial sum before its inputs exist). The critical path runs leaf → … → root:

```
T∞ = Θ(log n).
```

*Parallelism.*

```
T₁/T∞ = Θ(n / log n).
```

*Worked numbers.* For `n = 1,048,576 = 2²⁰`:

```
T₁ = n − 1 = 1,048,575        (additions)
T∞ = log₂ n = 20              (tree height)
parallelism = T₁/T∞ ≈ 52,428  (you could keep ~52k processors busy on average)
```

So a million-element sum has *enormous* parallelism: any realistic core count `P` (say 64) sits far below `52,428`, putting you deep in the linear-speedup regime where `T∞ = 20` is a negligible additive term against `T₁/P ≈ 16,384`.

*Why span cannot be `O(1)`.* Combining `n` values into one on an EREW/CREW PRAM requires `Ω(log n)` steps — a cell's set of input-dependencies at most *doubles* per step, so reaching all `n` inputs needs `≥ log₂ n` steps. The `Θ(log n)` reduction span is forced, not an artifact of the tree shape. (Only a CRCW machine's concurrent-write collapses OR/AND-style reductions to `O(1)`.)

- **Constraints:** Derive `T₁ = n − 1 = Θ(n)`, `T∞ = ⌈log₂ n⌉ = Θ(log n)`, parallelism `= Θ(n/log n)`. Plug in a concrete `n` (e.g. `2²⁰`) and report all three. State why the algorithm is work-efficient and why `Θ(log n)` span is unavoidable on EREW.
- **Acceptance test:** Work `Θ(n)` (matching sequential), span `Θ(log n)`, parallelism `Θ(n/log n)`; the worked numbers for `n = 2²⁰` give `T₁ ≈ 10⁶`, `T∞ = 20`, parallelism `≈ 5.2·10⁴`. This is the work/span you will *measure* in Task 3 and *schedule* in Task 4.

---

### Task 3 — Write a parallel reduction and MEASURE speedup vs `P` **[coding]**

`[easy]` Leave the abstract DAG for a moment and run a real parallel reduction. Split an array of `n` numbers into `P` chunks, sum each chunk on its own worker (goroutine or process), then combine the `P` partial sums. Time it for `P = 1, 2, 4, 8, …` and report the **measured speedup** `S_P = T_1 / T_P` against the ideal `P`.

This is the work–efficient reduction of Task 2 realized: work `Θ(n)`, span `Θ(log n)` (here the final combine of `P` partials), and parallelism `Θ(n/log n)` — so for any small `P` you should see speedup close to `P` until overhead or the memory-bandwidth ceiling bites (Task 11).

#### Go

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
	"time"
)

// parallelSum splits data into P contiguous chunks, sums each on its own
// goroutine, then combines the P partial sums. Work Theta(n); span is the
// chunk-sum (n/P) plus the final combine (~log P), i.e. Theta(n/P + log P).
func parallelSum(data []float64, P int) float64 {
	n := len(data)
	partials := make([]float64, P)
	var wg sync.WaitGroup
	chunk := (n + P - 1) / P
	for p := 0; p < P; p++ {
		lo := p * chunk
		hi := lo + chunk
		if hi > n {
			hi = n
		}
		if lo >= n {
			break
		}
		wg.Add(1)
		go func(p, lo, hi int) {
			defer wg.Done()
			var s float64
			for i := lo; i < hi; i++ {
				s += data[i]
			}
			partials[p] = s // each worker writes its own slot: no contention
		}(p, lo, hi)
	}
	wg.Wait()
	var total float64
	for _, s := range partials { // final combine of P partials
		total += s
	}
	return total
}

func main() {
	runtime.GOMAXPROCS(runtime.NumCPU())
	const n = 200_000_000
	data := make([]float64, n)
	for i := range data {
		data[i] = 1.0 // known answer: sum == n
	}

	// Baseline T_1: single goroutine.
	t0 := time.Now()
	base := parallelSum(data, 1)
	t1 := time.Since(t0).Seconds()
	if base != float64(n) {
		panic("wrong sum")
	}
	fmt.Printf("P=1   time=%.4fs  speedup=1.00 (baseline)\n", t1)

	for _, P := range []int{2, 4, 8, 16} {
		t0 = time.Now()
		got := parallelSum(data, P)
		tp := time.Since(t0).Seconds()
		if got != float64(n) {
			panic("wrong sum")
		}
		fmt.Printf("P=%-3d time=%.4fs  speedup=%.2f  efficiency=%.2f\n",
			P, tp, t1/tp, (t1/tp)/float64(P))
	}
}
```

#### Python (multiprocessing core)

```python
from multiprocessing import Pool

def chunk_sum(args):
    data, lo, hi = args
    return sum(data[lo:hi])

def parallel_sum(data, P):
    n = len(data)
    chunk = (n + P - 1) // P
    tasks = [(data, p * chunk, min((p + 1) * chunk, n)) for p in range(P)]
    with Pool(P) as pool:
        return sum(pool.map(chunk_sum, tasks))   # P partials, then combine
```

- **Constraints:** Each worker writes its **own** partial slot (no shared accumulator → no contention or race). Use `n` large enough that the per-chunk work dwarfs spawn overhead (hundreds of millions of cheap ops, or a heavier per-element op in Python where interpreter overhead is large). Pin the data to a known value (all `1.0`) so the answer is `n` and you can assert correctness — *a wrong sum invalidates the timing*.
- **Hint:** Speedup will be near-linear for small `P` (you are far below the parallelism `n/log n`), then flatten. The flattening is **not** a violation of Brent — it is the memory-bandwidth wall and scheduling overhead the work–span model omits (Task 11 isolates it). Go shows cleaner scaling than Python's `multiprocessing`, which pays pickling/IPC overhead per chunk.
- **Acceptance test:** The sum is correct for every `P`; measured `S_P` increases with `P` and stays `≤ P` (the Work Law in wall-clock form — you can never beat linear speedup in the model). Report `S_P` and `E_P`; near-linear speedup at small `P` confirms the reduction's high parallelism.

---

### Task 4 — Apply Brent's bound to predict `T_P`; compare to a greedy schedule **[coding + analysis]**

`[easy]` Brent's theorem says a greedy schedule of a DAG runs in `T_P ≤ T₁/P + T∞`. Predict `T_P` for the reduction DAG of Task 1 at several `P`, then **simulate** a greedy schedule and confirm the achieved `T_P` lands between the lower bound `max(T₁/P, T∞)` and the upper bound `T₁/P + T∞`.

The greedy simulator is the second core instrument: maintain a ready set, and each step pop up to `P` ready tasks, mark them done, and release any successor whose last predecessor just finished.

#### Python

```python
from collections import deque

def greedy(deps, P):
    """Simulate a greedy schedule on P processors; return T_P (steps).
    A node becomes ready when all its predecessors have completed."""
    n = len(deps)
    remaining = [len(deps[v]) for v in range(n)]    # unfinished predecessors
    succ = [[] for _ in range(n)]
    for v in range(n):
        for u in deps[v]:
            succ[u].append(v)
    ready = deque(v for v in range(n) if remaining[v] == 0)

    steps = 0
    while ready:
        steps += 1
        take = min(P, len(ready))      # incomplete step runs ALL ready tasks
        batch = [ready.popleft() for _ in range(take)]
        for u in batch:
            for w in succ[u]:
                remaining[w] -= 1
                if remaining[w] == 0:
                    ready.append(w)
        return_check = None            # (placeholder; loop continues)
    return steps

if __name__ == "__main__":
    from math import ceil
    deps = [
        [], [], [], [], [], [], [], [],
        [0, 1], [2, 3], [4, 5], [6, 7],
        [8, 9], [10, 11],
        [12, 13],
    ]
    T1, Tinf = len(deps), 4
    print(f"reduction DAG: T1={T1} Tinf={Tinf} parallelism={T1/Tinf:.2f}")
    for P in (1, 2, 4, 8, 16):
        tp = greedy(deps, P)
        lower = max(ceil(T1 / P), Tinf)        # max(Work Law, Span Law)
        brent = ceil(T1 / P) + Tinf            # Brent upper bound
        print(f"  P={P:2d}: T_P={tp:2d}  lower=max(T1/P,Tinf)={lower:2d}  "
              f"Brent=T1/P+Tinf={brent:2d}  speedup={T1/tp:.2f}")
        assert lower <= tp <= brent, "T_P must satisfy the Work/Span laws and Brent"
    print("OK: max(T1/P, Tinf) <= T_P <= T1/P + Tinf for every P")
```

> **Bug to fix first (intentional):** the `return_check = None` line and a missing re-loop make this snippet terminate after one step. Remove the stray line and ensure the `while ready:` loop iterates until `ready` is empty — the structure above (pop a batch, release successors, repeat) is correct once the spurious early statement is deleted. Verifying the fix *is* part of the task: a scheduler that stops early reports a falsely small `T_P` that violates the Span Law.

- **Analysis to write:** For `P = 8` on the 15-node reduction tree, `T₁/P = ⌈15/8⌉ = 2` and `T∞ = 4`, so Brent predicts `T_P ≤ 6`; the lower bound is `max(2, 4) = 4`. A correct greedy schedule achieves `T_P = 4` (it is span-bound: 8 leaves run in step 1, then 4, 2, 1 partials over the next 3 levels). At `P = 8 ≥ parallelism = 3.75`, more processors cannot help — the span dominates, and speedup pins at `T₁/T_P = 15/4 = 3.75`, exactly the parallelism.
- **Constraints:** The greedy rule is exact: run up to `P` ready tasks per step, never fewer when more are ready. The achieved `T_P` must satisfy **both** lower-bound laws and the Brent upper bound for *every* `P`. Fix the seeded bug before trusting any number.
- **Acceptance test:** `max(⌈T₁/P⌉, T∞) ≤ T_P ≤ ⌈T₁/P⌉ + T∞` for `P ∈ {1, 2, 4, 8, 16}`; at `P ≥ parallelism` the speedup saturates at exactly `T₁/T∞ = 3.75`. The simulator confirms Brent's theorem on a real DAG.

---

## Intermediate Tasks

### Task 5 — Verify the Brent bound across many random DAGs **[coding]**

`[medium]` One DAG proves nothing. Generate **many random DAGs** (random layered or random-edge graphs in topological order), compute `T₁` and `T∞` for each, run the greedy scheduler for several `P`, and assert that *every* run satisfies `max(T₁/P, T∞) ≤ T_P ≤ T₁/P + T∞`. This stress-tests both your analyzer and Brent's theorem.

#### Python

```python
import random
from collections import deque
from math import ceil

def random_dag(n, edge_prob):
    """Random DAG on n nodes in topological order: edge u->v only if u < v."""
    deps = [[] for _ in range(n)]
    for v in range(1, n):
        for u in range(v):
            if random.random() < edge_prob:
                deps[v].append(u)
    return deps

def work_span(deps):
    level = [0] * len(deps)
    for v in range(len(deps)):
        level[v] = 1 + max((level[u] for u in deps[v]), default=0)
    return len(deps), max(level)

def greedy(deps, P):
    n = len(deps)
    remaining = [len(deps[v]) for v in range(n)]
    succ = [[] for _ in range(n)]
    for v in range(n):
        for u in deps[v]:
            succ[u].append(v)
    ready = deque(v for v in range(n) if remaining[v] == 0)
    steps = 0
    while ready:
        steps += 1
        for _ in range(min(P, len(ready))):
            u = ready.popleft()
            for w in succ[u]:
                remaining[w] -= 1
                if remaining[w] == 0:
                    ready.append(w)
    return steps

if __name__ == "__main__":
    random.seed(0)
    trials, violations = 0, 0
    for _ in range(2000):
        n = random.randint(5, 60)
        deps = random_dag(n, edge_prob=random.uniform(0.05, 0.4))
        T1, Tinf = work_span(deps)
        for P in (1, 2, 3, 5, 8):
            tp = greedy(deps, P)
            lower = max(ceil(T1 / P), Tinf)
            brent = ceil(T1 / P) + Tinf
            trials += 1
            if not (lower <= tp <= brent):
                violations += 1
    print(f"ran {trials} (DAG, P) trials; bound violations = {violations}")
    assert violations == 0, "Brent and the Work/Span laws must hold on every DAG"
    print("OK: max(T1/P, Tinf) <= T_P <= T1/P + Tinf on all random DAGs")
```

- **Constraints:** Generate DAGs *in topological order* (edge `u → v` only when `u < v`) so acyclicity is automatic. Vary `n`, edge density, and `P`. The assertion must hold on **every** trial — a single violation means a bug in `work_span` (likely a non-topological order) or in `greedy` (likely an incomplete step that idles a processor).
- **Hint:** Sparse DAGs (low edge probability) have small span and high parallelism, so they are usually Work-Law-bound (`T_P ≈ T₁/P`); dense, chain-like DAGs have large span and are Span-Law-bound (`T_P ≈ T∞`). Both extremes — and everything between — must fall inside `[max(T₁/P, T∞), T₁/P + T∞]`. The bound is *never* violated; greedy can only ever be within `2×` of the lower bound.
- **Acceptance test:** Zero bound violations across thousands of `(DAG, P)` pairs. This is Brent's theorem and the two laws verified empirically — the same instrument that, applied to a fork–join runtime's DAG, certifies its scheduler.

---

### Task 6 — Plot Amdahl's law (speedup vs `P` for several serial fractions) **[coding]**

`[medium]` Amdahl's law `S_P = 1/(s + (1−s)/P)` says a serial fraction `s` caps speedup at `1/s` regardless of `P`. Compute and **plot** the family of curves for several `s`, showing each flatten toward its `1/s` ceiling. Even an ASCII table or a matplotlib chart makes the diminishing returns vivid.

#### Python

```python
def amdahl(s, P):
    return 1.0 / (s + (1.0 - s) / P)

if __name__ == "__main__":
    serial_fractions = [0.0, 0.01, 0.05, 0.10, 0.25, 0.50]
    procs = [1, 2, 4, 8, 16, 64, 256, 1024, 1 << 16]
    header = "  s \\ P  " + "".join(f"{P:>9}" for P in procs)
    print(header)
    for s in serial_fractions:
        row = f"  {s:>5.2f}  "
        for P in procs:
            row += f"{amdahl(s, P):>9.2f}"
        ceiling = float('inf') if s == 0 else 1.0 / s
        print(row + f"   ceiling 1/s = {ceiling:.1f}")
        # The curve must be monotone in P and bounded by 1/s.
        prev = 0.0
        for P in procs:
            sp = amdahl(s, P)
            assert sp >= prev - 1e-9, "speedup is monotone non-decreasing in P"
            if s > 0:
                assert sp <= 1.0 / s + 1e-9, "speedup never exceeds 1/s"
            prev = sp
    print("\nOK: each Amdahl curve rises monotonically toward its 1/s ceiling")

    # Optional matplotlib plot:
    try:
        import matplotlib.pyplot as plt
        Ps = list(range(1, 1025))
        for s in [0.01, 0.05, 0.10, 0.25, 0.50]:
            plt.plot(Ps, [amdahl(s, P) for P in Ps], label=f"s={s}")
            plt.axhline(1.0 / s, ls="--", lw=0.6)
        plt.xscale("log", base=2); plt.xlabel("P"); plt.ylabel("speedup S_P")
        plt.title("Amdahl's law: speedup vs P"); plt.legend()
        plt.savefig("amdahl.png", dpi=120)
        print("wrote amdahl.png")
    except ImportError:
        pass
```

- **Constraints:** `S_P = 1/(s + (1−s)/P)`. Each curve must be **monotone non-decreasing** in `P` and **bounded above by `1/s`** (for `s > 0`); `s = 0` gives the ideal `S_P = P`. Show at least the rows `s = 0.05` (ceiling `20×`) and `s = 0.25` (ceiling `4×`) so the ceiling's harshness is visible.
- **Hint:** The headline numbers: `s = 0.05` caps at `20×`, yet at `P = 1024` you already have `≈ 19.6×` — going from `1024` to `65536` cores buys essentially nothing. `s = 0.25` caps at `4×`. This is why attacking the *serial fraction itself* (I/O, initialization, a sequential reduction) beats buying more cores once `P ≫ 1/s`.
- **Acceptance test:** Every curve is monotone and respects its `1/s` ceiling; the `s = 0.05` curve is within `5%` of `20×` by `P = 256` and essentially flat thereafter. The plot/table shows the ceiling each `s` imposes — the quantitative face of "fixed-problem-size parallelism has a wall."

---

### Task 7 — Gustafson's law next to Amdahl's: scaled vs fixed problem **[coding + analysis]**

`[medium]` Amdahl fixes the problem and scales the machine (ceiling `1/s`); Gustafson scales *both* — a bigger machine runs a bigger problem, and `S_P = s + (1−s)·P` is linear and unbounded. Compute both for the same `s` and show the contrast, then explain which question each answers.

#### Python

```python
def amdahl(s, P):
    return 1.0 / (s + (1.0 - s) / P)

def gustafson(s, P):
    return s + (1.0 - s) * P          # = P - s*(P - 1)

if __name__ == "__main__":
    s = 0.05
    print(f"serial fraction s = {s}   (Amdahl ceiling 1/s = {1/s:.0f})")
    print(f"{'P':>8} {'Amdahl':>10} {'Gustafson':>12}")
    for P in (1, 4, 16, 64, 256, 1024):
        a, g = amdahl(s, P), gustafson(s, P)
        print(f"{P:>8} {a:>10.2f} {g:>12.2f}")
        assert a <= 1 / s + 1e-9, "Amdahl bounded by 1/s"
        assert abs(g - (P - s * (P - 1))) < 1e-9, "Gustafson is linear in P"
    # Gustafson slope is (1 - s): doubling P nearly doubles scaled speedup.
    slope = (gustafson(s, 1024) - gustafson(s, 512)) / 512
    print(f"\nGustafson slope ~ (1 - s) = {1 - s:.2f}  (measured {slope:.2f})")
    assert abs(slope - (1 - s)) < 1e-9
    print("OK: Amdahl -> 1/s (bounded); Gustafson -> ~(1-s)*P (linear, unbounded)")
```

- **Analysis to write:** The two laws answer *different* questions. **Amdahl (strong scaling):** the problem size is fixed; you want the *same* computation done faster. The serial part `s` does not shrink, so `S_P → 1/s` — a hard wall. **Gustafson (weak scaling):** the problem grows with the machine; you want a *bigger* computation in the same time. The parallel work grows with `P` while the serial part stays roughly constant, so the *scaled* speedup `s + (1−s)·P` is linear with slope `1 − s`. They do not contradict each other — Amdahl measures the same job on more cores, Gustafson measures more job on more cores. The classic error is quoting Amdahl's `1/s` pessimism for a workload that actually scales with the machine (most scientific computing): nobody buys a supercomputer to solve last year's problem `20×` faster; they solve a `1000×` bigger one.
- **Constraints:** Same `s` for both. Amdahl must stay `≤ 1/s`; Gustafson must be linear with slope `1 − s`. Tabulate both side by side so the bounded-vs-unbounded contrast is unmistakable.
- **Acceptance test:** Amdahl saturates near `1/s = 20`; Gustafson reaches `≈ 0.95·P` (e.g. `≈ 973` at `P = 1024`). The write-up names which scaling regime each law describes and why reporting the wrong one mis-states parallel value.

---

### Task 8 — Analyze the work/span of prefix-sum and matrix multiply **[analysis]**

`[medium]` Two algorithms beyond reduction, by hand. These are the canonical cases where **work-efficiency** (not just low span) decides the winner.

> **No code.** Use this as the grading model.

**Prefix sum (scan): naive vs work-efficient.**

*Naive (Hillis–Steele).* For `d = 1, 2, 4, …, n/2`, every element adds the element `d` positions to its left. There are `log₂ n` rounds, each doing `Θ(n)` independent additions:

```
naive scan:   T₁ = Θ(n log n)   T∞ = Θ(log n)   parallelism = Θ(n)
```

The span is great (`Θ(log n)`), but the work is `Θ(n log n)` — **work-inefficient**, since sequential scan is `Θ(n)`. That extra `log n` factor of work is paid by every processor on every run.

*Work-efficient (Blelloch).* An **up-sweep** (a reduction tree computing partial sums) followed by a **down-sweep** (pushing prefixes back down), each `Θ(log n)` levels with `Θ(n)` *total* work across the whole sweep:

```
Blelloch scan:  T₁ = Θ(n)   T∞ = Θ(log n)   parallelism = Θ(n/log n)
```

This matches the sequential `Θ(n)` work *and* keeps `Θ(log n)` span — the best of both, which is why it is the production algorithm. (Full derivation in the [scan tasks](../02-parallel-prefix-sum-scan/tasks.md).)

**Matrix multiply (definitional `C[i][j] = Σ_k A[i][k]·B[k][j]`).**

There are `n²` output entries, each a dot product of length `n`. The `n` products for one entry are independent (compute in parallel); summing them is a **reduction** of `n` terms (span `Θ(log n)`). All `n²` entries are mutually independent:

```
matrix multiply:  T₁ = Θ(n³)   T∞ = Θ(log n)   parallelism = Θ(n³/log n)
```

Work `Θ(n³)` is work-efficient against the *classical* sequential algorithm (not against Strassen's `Θ(n^{2.807})`); span `Θ(log n)` is just the depth of the dot-product reductions. The parallelism `Θ(n³/log n)` is gigantic — for any realistic `P` you sit far below it, in the linear-speedup regime.

*Worked comparison.* For `n = 10⁶`, the naive scan does `≈ 10⁶ · 20 = 2·10⁷` work versus the efficient scan's `10⁶` — a `20×` work blow-up. By the Work Law, speedup over sequential is capped at `P · (T_seq/T₁) = P · (10⁶ / 2·10⁷) = P/20`: the naive scan **throws away a factor of 20 in processors** before it starts, even though its span is identical to the efficient one's.

- **Constraints:** Derive `T₁`, `T∞`, parallelism for all three (naive scan, Blelloch scan, matrix multiply). State which are work-efficient. Show numerically how the naive scan's work blow-up caps its speedup at `P/log n`.
- **Acceptance test:** Naive scan `T₁ = Θ(n log n)` (inefficient), Blelloch scan and matrix multiply work-efficient; matrix multiply parallelism `Θ(n³/log n)`. The comparison shows a low span is worthless if bought with inflated work — the central lesson of work-efficiency.

---

### Task 9 — Show a work-inefficient algorithm wastes processors **[coding + analysis]**

`[medium]` Make Task 8's point measurable. Take the same problem (prefix sum) two ways — the work-efficient `Θ(n)` algorithm and a work-inefficient `Θ(n log n)` one — and compare their **effective speedup over the sequential baseline** at a fixed `P`. The inefficient version, despite identical span, delivers less wall-clock speedup because every processor does redundant work.

Model it through the scheduler: build the DAG of each algorithm (or just its `T₁`, `T∞`), apply Brent to predict `T_P`, and compare `S_P = T_seq / T_P` for both. Since `T_seq = Θ(n)` is the *same* sequential baseline, the efficient algorithm's `S_P` can reach `Θ(P)` while the inefficient one's caps at `Θ(P/log n)`.

#### Python

```python
import math

def predict_TP(T1, Tinf, P):
    """Brent upper bound on T_P."""
    return math.ceil(T1 / P) + Tinf

def compare(n, P):
    T_seq = n                                   # sequential scan: Theta(n)
    # Work-efficient (Blelloch): work Theta(n), span Theta(log n).
    eff_T1, eff_Tinf = 2 * n, 2 * math.ceil(math.log2(n))   # ~2n up+down sweep
    # Work-inefficient (Hillis-Steele): work Theta(n log n), span Theta(log n).
    inef_T1, inef_Tinf = n * math.ceil(math.log2(n)), math.ceil(math.log2(n))

    eff_TP = predict_TP(eff_T1, eff_Tinf, P)
    inef_TP = predict_TP(inef_T1, inef_Tinf, P)
    return {
        "T_seq": T_seq,
        "eff": (eff_T1, eff_Tinf, eff_TP, T_seq / eff_TP),
        "inef": (inef_T1, inef_Tinf, inef_TP, T_seq / inef_TP),
    }

if __name__ == "__main__":
    P = 64
    print(f"P={P}   speedup over sequential = T_seq / T_P")
    print(f"{'n':>10} {'efficient S_P':>15} {'inefficient S_P':>17} {'ratio':>8}")
    for n in (2**12, 2**16, 2**20, 2**24):
        r = compare(n, P)
        eff_sp = r["eff"][3]
        inef_sp = r["inef"][3]
        print(f"{n:>10} {eff_sp:>15.2f} {inef_sp:>17.2f} {eff_sp/inef_sp:>8.2f}")
        # Efficient speedup approaches P; inefficient is ~log n times worse.
        assert eff_sp > inef_sp, "work-efficient must out-speed work-inefficient"
        assert eff_sp / inef_sp >= 0.5 * math.log2(n) / 2  # gap grows ~ log n
    print("\nOK: inefficient algo wastes ~log n factor of processors (same span!)")
```

- **Analysis to write:** Both algorithms have span `Θ(log n)`, so a naive "minimize the span" view rates them equal. But speedup over *sequential* is `T_seq / T_P`, and by the Work Law `T_P ≥ T₁/P`, so `S_P ≤ P · (T_seq/T₁)`. The efficient algorithm has `T_seq/T₁ = Θ(1)`, ceiling `Θ(P)`; the inefficient one has `T_seq/T₁ = Θ(1/log n)`, ceiling `Θ(P/log n)`. The inefficient algorithm spends `P` processors re-doing work the sequential machine never did — the redundant `log n` factor is paid on *every* run by *every* processor. **Span buys latency; work buys throughput**, and throughput is what speedup-over-sequential measures.
- **Constraints:** Use the *same* `T_seq = Θ(n)` baseline for both. Predict `T_P` via Brent. Show the speedup gap **grows with `n`** (it is `≈ log n`), proving the waste is not a constant overhead but an asymptotic processor loss.
- **Acceptance test:** Efficient `S_P` approaches `P`; inefficient `S_P` is `≈ log n` times smaller, and the ratio widens with `n`. The numbers show a work-inefficient algorithm with a beautiful span can be *slower in practice* than a work-efficient one — work-efficiency is the first thing to check.

---

## Advanced Tasks

### Task 10 — Classify problems: embarrassingly parallel / work-efficient parallel / inherently sequential **[analysis]**

`[hard]` Sort a list of problems into three buckets by their *inherent* parallelism, with justification grounded in work and span. This is the conceptual payoff of the whole model: knowing where a problem sits before you write a line of parallel code.

> **No code.** Use this as the grading model.

**The three classes.**

1. **Embarrassingly parallel** — `T∞ = Θ(1)` or tiny; the work splits into independent pieces with no (or a trivial) combine. Parallelism `≈ T₁`. Examples: applying a pure function to every element of an array (map); Monte Carlo trials; rendering independent pixels; brute-force search over a partitioned space. *Justification:* no dependency edges between the pieces, so the DAG is `P` independent chains; the only span is a final `O(log P)` combine if any.

2. **Work-efficient parallel (poly-log span)** — `T∞ = Θ(polylog n)` *and* `T₁ = Θ(T_seq)`. The problem has a logarithmic-depth dependency structure you can exploit without inflating work. Examples: reduction (`Θ(n)` work, `Θ(log n)` span); work-efficient prefix sum (Blelloch); merge sort and other divide-and-conquer with balanced combines; connected components via pointer jumping. *Justification:* a recursion or sweep of `Θ(log n)` depth, each level `Θ(n)` total work — high parallelism `Θ(n/log n)` with no wasted work.

3. **Inherently sequential (P-complete-ish)** — believed to have **no** poly-log-span work-efficient algorithm; the dependency chain is intrinsic. Examples: the **Circuit Value Problem** (evaluate a Boolean circuit — `P`-complete, the canonical "hard to parallelize"); **lexicographically-first DFS / greedy maximal independent set by lowest-index rule**; **linear-programming** (P-complete); a strict **left-fold with a non-associative operator** (each step needs the previous result). *Justification:* the answer at step `k` *requires* the answer at step `k − 1` through a chain of length `Θ(n)`, so `T∞ = Θ(n)` and parallelism is `Θ(1)` — adding processors cannot help.

**Borderline cases to discuss.** Quicksort with a *sequential* partition is `Θ(n)`-span (the partition is a left-to-right scan) but with a *parallel* partition (a scan-based filter) becomes `Θ(log² n)`-span — the class depends on the algorithm, not just the problem. General DFS *order* is sequential, but *reachability* (which the DFS computes) is parallelizable via BFS-style frontier expansion. Always ask: is the sequential bottleneck **intrinsic to the problem** or an **artifact of the chosen algorithm**?

- **Constraints:** Place at least 8 named problems across the three classes. For each, state `T₁`, `T∞` (or the reason span is `Θ(n)`), and the parallelism. Identify at least two *borderline* cases where the classification flips with the algorithm. Name why the P-complete class resists poly-log span (the chain is intrinsic — formalized as "no NC algorithm unless NC = P").
- **Acceptance test:** Each problem is justified by its span: embarrassingly parallel ⇒ `T∞ = Θ(1)`–`Θ(log P)`; work-efficient parallel ⇒ `T∞ = Θ(polylog n)` with `T₁ = Θ(T_seq)`; inherently sequential ⇒ `T∞ = Θ(n)`, parallelism `Θ(1)`. The borderline discussion correctly separates *problem-intrinsic* from *algorithm-induced* serialization.

---

### Task 11 — Grain-size cutoff: measure the overhead/speedup tradeoff **[coding]**

`[hard]` The work–span model charges nothing for spawning a task. Reality does: spawning a goroutine/process/future has fixed overhead, so splitting work into too-fine grains drowns the computation in scheduling cost. Implement a parallel divide-and-conquer with a **grain-size cutoff** — below a threshold `G`, run serially; above it, fork — and measure how total time varies with `G`. There is a sweet spot: too large and you lose parallelism; too small and overhead dominates.

#### Go

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
	"time"
)

// parSum sums data[lo:hi]. If the segment is smaller than the grain cutoff,
// sum it serially; otherwise split and fork. The cutoff bounds the number of
// spawned tasks: ~ (hi-lo)/grain leaves, each with one fork's overhead.
func parSum(data []float64, lo, hi, grain int) float64 {
	if hi-lo <= grain {
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
	go func() { defer wg.Done(); left = parSum(data, lo, mid, grain) }()
	right := parSum(data, mid, hi, grain) // stay on this goroutine for the right half
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
	fmt.Printf("n=%d  cores=%d\n", n, runtime.NumCPU())
	fmt.Printf("%12s %12s %14s\n", "grain", "time(ms)", "~#tasks")
	var best time.Duration = 1 << 62
	var bestGrain int
	for _, grain := range []int{64, 1_000, 100_000, 1_000_000, 10_000_000, n} {
		t0 := time.Now()
		got := parSum(data, 0, n, grain)
		dt := time.Since(t0)
		if got != float64(n) {
			panic("wrong sum")
		}
		fmt.Printf("%12d %12.2f %14d\n", grain, float64(dt.Microseconds())/1e3, n/grain)
		if dt < best {
			best, bestGrain = dt, grain
		}
	}
	fmt.Printf("\nbest grain = %d  (too small: fork overhead; too large: serial)\n", bestGrain)
}
```

- **Constraints:** The cutoff `G` must switch cleanly between serial base case and parallel fork. Sweep `G` across several orders of magnitude — from `G = 64` (millions of tiny tasks, overhead-dominated) to `G = n` (one task, no parallelism). Pin the data so the answer is checkable. Report time and the approximate task count `n/G` per grain.
- **Hint:** Tiny grains create `≈ n/G` tasks; each fork costs a fixed `c`, so spawn overhead is `≈ c·n/G` — explosive as `G → 0`. Huge grains (`G ≈ n`) give one serial task — `T_P ≈ T₁`, no speedup. The optimum is where per-task useful work `≈ G` comfortably exceeds the spawn cost `c`, typically `G` in the thousands-to-millions for cheap ops. The work–span model's `T∞` ignores the spawn cost entirely; this task measures the term it omits.
- **Acceptance test:** Time is **U-shaped** in `G`: high at both extremes, minimal in the middle. The best grain gives speedup approaching the core count, while `G = 64` is *slower than the serial sum* (overhead `> work`) and `G = n` shows no speedup. The measured curve exposes the spawn-overhead term the pure work–span model omits — and motivates the work-stealing runtimes of the [fork–join tasks](../07-fork-join-and-work-stealing/tasks.md).

---

### Task 12 — Demonstrate the memory-bandwidth ceiling: a parallel sum that stops scaling **[coding + analysis]**

`[hard]` The PRAM/work–span model gives unit-cost memory access, so a reduction *should* speed up linearly to the parallelism `n/log n`. Real machines share a finite **memory bandwidth**: once the cores collectively saturate it, adding more cores cannot deliver more bytes/second, and speedup flattens far below `P`. Demonstrate it: run a **bandwidth-bound** reduction (sum over a large array — almost no arithmetic per byte) and a **compute-bound** reduction (an expensive per-element function), and show only the latter keeps scaling.

#### Go

```go
package main

import (
	"fmt"
	"math"
	"runtime"
	"sync"
	"time"
)

func parReduce(data []float64, P int, f func(float64) float64) float64 {
	n := len(data)
	partials := make([]float64, P)
	chunk := (n + P - 1) / P
	var wg sync.WaitGroup
	for p := 0; p < P; p++ {
		lo, hi := p*chunk, (p+1)*chunk
		if hi > n {
			hi = n
		}
		if lo >= n {
			break
		}
		wg.Add(1)
		go func(p, lo, hi int) {
			defer wg.Done()
			var s float64
			for i := lo; i < hi; i++ {
				s += f(data[i])
			}
			partials[p] = s
		}(p, lo, hi)
	}
	wg.Wait()
	var t float64
	for _, s := range partials {
		t += s
	}
	return t
}

func bench(name string, data []float64, f func(float64) float64) {
	t0 := time.Now()
	parReduce(data, 1, f)
	t1 := time.Since(t0).Seconds()
	fmt.Printf("\n%s (baseline P=1: %.3fs)\n", name, t1)
	for _, P := range []int{2, 4, 8, 16} {
		t0 = time.Now()
		parReduce(data, P, f)
		tp := time.Since(t0).Seconds()
		fmt.Printf("  P=%-3d time=%.3fs speedup=%.2f\n", P, tp, t1/tp)
	}
}

func main() {
	runtime.GOMAXPROCS(runtime.NumCPU())
	const n = 200_000_000
	data := make([]float64, n)
	for i := range data {
		data[i] = float64(i%7) + 1
	}
	// Bandwidth-bound: trivial work per element -> limited by memory throughput.
	bench("BANDWIDTH-BOUND (s += x)", data, func(x float64) float64 { return x })
	// Compute-bound: heavy work per element -> limited by arithmetic, scales.
	bench("COMPUTE-BOUND (s += sqrt(sin^2+cos^2...))", data, func(x float64) float64 {
		y := x
		for k := 0; k < 50; k++ {
			y = math.Sqrt(math.Sin(y)*math.Sin(y) + math.Cos(y)*math.Cos(y) + 1)
		}
		return y
	})
}
```

- **Analysis to write:** Both reductions have *identical* work–span: `T₁ = Θ(n)`, `T∞ = Θ(log n)`, parallelism `Θ(n/log n)`. The model predicts near-linear speedup for both. Yet the bandwidth-bound sum flattens early — say at `≈ 3–4×` regardless of how many cores you add — while the compute-bound version keeps scaling toward `P`. The reason is *outside the model*: the bandwidth-bound loop's bottleneck is bytes/second from DRAM, a **shared, fixed** resource; once a handful of cores saturate it, extra cores starve. The compute-bound loop does `O(1)` memory traffic per `O(50)` flops, so it is limited by arithmetic throughput, which *does* scale with cores. **Arithmetic intensity** (flops per byte) decides whether the work–span prediction holds. This is the single most important way the idealized model diverges from hardware — and why "high parallelism" does not guarantee "high speedup."
- **Constraints:** Keep the two kernels structurally identical (same loop, same chunking) so *only* the per-element work differs. The bandwidth kernel must be near-trivial (a bare add); the compute kernel must do enough arithmetic per element to be limited by the ALU, not memory. Use an array far larger than last-level cache so DRAM traffic is real.
- **Acceptance test:** The bandwidth-bound reduction's speedup **saturates** well below `P` (and below its parallelism), while the compute-bound reduction's keeps climbing toward `P`. Both obey the work–span *bounds* (`T_P` is never below `max(T₁/P, T∞)`), but only the compute-bound one approaches the *optimistic* `T₁/P`. The write-up attributes the gap to shared memory bandwidth — the cost the PRAM model sets to zero.

---

### Task 13 — Work-stealing vs static partition on an imbalanced workload **[coding + analysis]**

`[hard]` Greedy scheduling assumes a scheduler that never idles a processor next to a ready task. A **static partition** (split the work into `P` equal *index ranges* up front) violates this when the per-task cost is **imbalanced**: a worker that drew the cheap tasks finishes early and sits idle while one worker grinds through the expensive ones. **Work-stealing** (idle workers steal ready tasks from busy ones) approximates the greedy schedule and recovers the lost time. Build both on a deliberately imbalanced workload and measure.

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

// cost(i): heavily skewed — a few indices are very expensive, most are cheap.
// Static range partition will give one worker most of the expensive indices.
func cost(i int) int {
	if i%97 == 0 {
		return 20000 // rare, very expensive task
	}
	return 10 // common, cheap task
}

func busy(work int) float64 { // simulate `work` units of computation
	var s float64
	for k := 0; k < work; k++ {
		s += float64(k) * 1.0000001
	}
	return s
}

// staticPartition: contiguous index ranges. Imbalance -> idle workers.
func staticPartition(n, P int) time.Duration {
	t0 := time.Now()
	chunk := (n + P - 1) / P
	var wg sync.WaitGroup
	for p := 0; p < P; p++ {
		lo, hi := p*chunk, (p+1)*chunk
		if hi > n {
			hi = n
		}
		wg.Add(1)
		go func(lo, hi int) {
			defer wg.Done()
			for i := lo; i < hi; i++ {
				busy(cost(i))
			}
		}(lo, hi)
	}
	wg.Wait()
	return time.Since(t0)
}

// workStealing: a shared atomic counter as a global task queue — every idle
// worker grabs the next index, so no worker idles while tasks remain.
func workStealing(n, P int) time.Duration {
	t0 := time.Now()
	var next int64 = 0
	var wg sync.WaitGroup
	for p := 0; p < P; p++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				i := int(atomic.AddInt64(&next, 1) - 1)
				if i >= n {
					return
				}
				busy(cost(i))
			}
		}()
	}
	wg.Wait()
	return time.Since(t0)
}

func main() {
	runtime.GOMAXPROCS(runtime.NumCPU())
	const n = 2_000_000
	fmt.Printf("imbalanced workload, n=%d, cores=%d\n", n, runtime.NumCPU())
	fmt.Printf("%5s %14s %16s %10s\n", "P", "static(ms)", "work-steal(ms)", "speedup")
	for _, P := range []int{2, 4, 8, 16} {
		st := staticPartition(n, P)
		ws := workStealing(n, P)
		fmt.Printf("%5d %14.1f %16.1f %10.2fx\n",
			P, float64(st.Microseconds())/1e3, float64(ws.Microseconds())/1e3,
			float64(st)/float64(ws))
	}
}
```

- **Analysis to write:** With a static index partition, the makespan is `max over workers of (sum of that worker's task costs)`, not the average — one unlucky worker holding the expensive tasks sets the time, and the rest idle. This is the greedy rule violated: idle processors next to ready (stealable) tasks. Work-stealing keeps every worker busy until the global queue drains, so its makespan approaches the *balanced* `T₁/P` — exactly the greedy/Brent ideal. The achieved gap between the two is the **load-imbalance penalty**, and it grows with the skew of the cost distribution. (A finer-grained static partition — many small chunks round-robined — narrows the gap but never closes it the way dynamic stealing does; this is why production fork–join runtimes steal rather than pre-partition.)
- **Constraints:** Use a genuinely **skewed** cost function (a few very expensive tasks among many cheap ones) so a contiguous partition is unlucky for some worker. Keep both schedulers' total work identical (same `cost(i)` evaluated once per `i`). The work-stealing version must let *any* idle worker grab the next task (a shared atomic index is a simple, correct global queue).
- **Acceptance test:** Work-stealing finishes **faster** than the static partition on the imbalanced workload, with the gap widening as `P` grows (more workers ⇒ more idle ones under static partition). Work-stealing's `T_P` approaches `T₁/P` (the greedy ideal); the static partition's is pinned near `max-worker-load`. The measurement confirms why real runtimes realize Brent's greedy schedule via stealing — continued in the [fork–join and work-stealing tasks](../07-fork-join-and-work-stealing/tasks.md).

---

## Synthesis Task

> Tie the model together end to end: build the analyzer and the greedy scheduler, drive real DAGs through them, write and measure parallel code, and confirm at every step that the numbers respect the Work Law, the Span Law, and the Brent bound — then connect the idealized model to where hardware diverges.

`[capstone]` Carry the **work–span model** from DAG to silicon: analyze, schedule, measure, and explain the gaps.

1. **Analyzer + scheduler [coding].** Build `work_span` (Task 1) and `greedy` (Task 4); confirm `max(⌈T₁/P⌉, T∞) ≤ T_P ≤ ⌈T₁/P⌉ + T∞` on the reduction DAG and on thousands of random DAGs (Task 5) — zero violations.

2. **Derive the canonical bounds [analysis].** Work/span of reduction (Task 2), prefix sum, and matrix multiply (Task 8); classify a slate of problems as embarrassingly parallel / work-efficient parallel / inherently sequential (Task 10).

3. **Scaling laws [coding + analysis].** Plot Amdahl's `1/(s + (1−s)/P) → 1/s` next to Gustafson's `s + (1−s)·P` (Tasks 6–7); name which scaling regime each answers.

4. **Measure real speedup [coding].** Write a parallel reduction and measure `S_P` vs `P` (Task 3); confirm `S_P ≤ P` and near-linear at small `P`. Show a work-inefficient algorithm wastes a `log n` factor of processors (Task 9).

5. **Where the model breaks [coding + analysis].** Find the grain-size sweet spot (Task 11), demonstrate the memory-bandwidth ceiling (Task 12), and beat a static partition with work-stealing on an imbalanced load (Task 13).

Reference harness in **Python** (combines the analysis pieces):

```python
import math

def report(T1, Tinf, P, T_seq, s):
    parallelism = T1 / Tinf
    brent = math.ceil(T1 / P) + Tinf            # Brent upper bound on T_P
    lower = max(math.ceil(T1 / P), Tinf)        # Work + Span lower bound
    speedup_ceiling = P * (T_seq / T1)          # capped by work-efficiency
    amdahl = 1.0 / (s + (1.0 - s) / P)
    gustafson = s + (1.0 - s) * P
    return parallelism, lower, brent, speedup_ceiling, amdahl, gustafson

if __name__ == "__main__":
    P, s = 64, 0.05
    cases = [
        # (name, T1, Tinf, T_seq)
        ("reduction",        10**6,  20, 10**6),
        ("Blelloch scan",  2*10**6,  40, 10**6),
        ("Hillis-Steele",  20*10**6, 20, 10**6),   # work-inefficient
        ("matrix multiply", 10**9,   30, 10**9),
    ]
    print(f"P={P}  serial fraction s={s}")
    print(f"{'algorithm':>16} {'parallelism':>12} {'lower<=T_P<=Brent':>20} "
          f"{'S_P ceiling':>12}")
    for name, T1, Tinf, T_seq in cases:
        par, lo, br, ceil_sp, _, _ = report(T1, Tinf, P, T_seq, s)
        print(f"{name:>16} {par:>12.0f} {f'{lo} <= T_P <= {br}':>20} "
              f"{ceil_sp:>12.2f}")
        assert lo <= br                          # lower bound <= upper bound, always
        assert ceil_sp <= P + 1e-9               # speedup ceiling never exceeds P
    a = 1.0 / (s + (1 - s) / P)
    g = s + (1 - s) * P
    print(f"\nAmdahl(s={s}, P={P}) = {a:.2f}  (ceiling 1/s = {1/s:.0f})   "
          f"Gustafson = {g:.2f}")
    assert a <= 1 / s + 1e-9
    print("OK: T_P bracketed by the laws; S_P <= P; Amdahl <= 1/s; Gustafson linear")
```

- **Analysis answer:** Work `T₁` is the 1-processor time; span `T∞` is the `∞`-processor time; parallelism `T₁/T∞` is the speedup ceiling and the processor count past which workers idle. The **Work Law** `T_P ≥ T₁/P` and **Span Law** `T_P ≥ T∞` bound `T_P` from below; **Brent** `T_P ≤ T₁/P + T∞` bounds it from above, so greedy is within `2×` of optimal. Speedup over sequential is capped at `P·(T_seq/T₁)`, so **work-efficiency** (`T₁ = Θ(T_seq)`) matters more than a small span — a `log n` work blow-up throws away a `log n` factor of processors. **Amdahl** (`→ 1/s`) governs the fixed-size problem, **Gustafson** (`s + (1−s)·P`) the scaled one. And the model's silences — spawn overhead (grain size), shared memory bandwidth (arithmetic intensity), and load imbalance (static vs work-stealing) — are exactly where measured wall-clock departs from `T₁/P + T∞`.
- **Acceptance test:** Every analyzed and measured `T_P` satisfies `max(⌈T₁/P⌉, T∞) ≤ T_P ≤ ⌈T₁/P⌉ + T∞`; `S_P ≤ P` always; the work-inefficient algorithm's speedup ceiling is `≈ P/log n`; Amdahl respects `1/s` and Gustafson is linear; the grain-size curve is U-shaped, the bandwidth-bound reduction saturates below `P`, and work-stealing beats static partition on imbalance. The write-up places the model's predictions next to the hardware's behavior — mirroring the whole discipline: *build the DAG, compute work and span, schedule it, measure the speedup, and confirm the numbers respect the laws — then explain every gap with the cost the model omits.*

---

## Where to go next

- Realize the greedy schedule Brent's theorem assumes — randomized work-stealing, the `T_P = T₁/P + O(T∞)` bound it achieves, deques and steal protocols, and grain-size control in production runtimes — in the [fork–join and work-stealing tasks](../07-fork-join-and-work-stealing/tasks.md).
- Build and benchmark the work-efficient `Θ(n)`-work `Θ(log n)`-span scan you analyzed here — up-sweep/down-sweep, segmented scan, and its role as the workhorse behind compaction, sorting, and graph algorithms — in the [parallel prefix sum / scan tasks](../02-parallel-prefix-sum-scan/tasks.md).
- For the conceptual treatment of PRAM variants, the Work/Span laws, Brent's proof, work-efficiency, and the Amdahl/Gustafson derivations, read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.
