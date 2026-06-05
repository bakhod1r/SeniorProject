# 2-SAT (2-Satisfiability) — Senior Level

> **One-line summary:** At senior level, 2-SAT is a *modeling primitive* and a *subsystem*: a linear-time constraint engine you drop into config validators, feasibility checkers, two-way placement/scheduling services, and incremental constraint systems. The algorithm is settled (`O(n+m)` implication-graph SCC); the engineering questions are how to build the graph at scale, expose it as a service, observe it, and reason about its failure modes.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Design with 2-SAT](#2-system-design-with-2-sat)
3. [Large-Scale Implication Graphs](#3-large-scale-implication-graphs)
4. [Concurrency](#4-concurrency)
5. [Comparison at Scale](#5-comparison-at-scale)
6. [Architecture Patterns](#6-architecture-patterns)
7. [Reference Implementation — Service-Grade Solver](#7-reference-implementation--service-grade-solver)
8. [Observability](#8-observability)
9. [Failure Modes](#9-failure-modes)
10. [Capacity Planning](#10-capacity-planning)
11. [Summary](#11-summary)

---

## 1. Introduction

By the time 2-SAT shows up in a real system, the textbook algorithm is the *least* interesting part. The implication-graph + SCC reduction is fixed and optimal at `O(n + m)`. What a senior engineer actually owns is everything *around* it:

- **Modeling correctness** — does the clause set faithfully encode the business constraints? A wrong edge is a wrong answer with full confidence.
- **Graph construction at scale** — millions of variables and clauses, built from streaming or relational data, without blowing memory.
- **Service shape** — request/response feasibility checks, batch validation, incremental re-solves as constraints change.
- **Observability** — when a config is rejected as UNSAT, *which* constraints conflicted? Plain 2-SAT says "no" with no explanation; you must engineer the "why."
- **Failure modes** — silent direction bugs, numbering-convention drift, recursion stack overflow, pathological adversarial inputs.

2-SAT earns its place precisely because it is *linear and exact*. Unlike a general SAT/CSP solver, it never times out, never needs heuristics, and gives a provably-correct yes/no plus a witness. That predictability is what makes it deployable in a request path with a hard latency budget. This file treats 2-SAT as that deployable subsystem.

---

## 2. System Design with 2-SAT

Where 2-SAT fits in production:

**Configuration validation.** Many config systems reduce to binary toggles with "if A then not B," "at least one of A/B," "exactly one of A/B" rules. Modeling each feature flag as a variable and each policy as a clause turns "is this config internally consistent?" into a linear 2-SAT check — far cheaper and more predictable than a general constraint solver, and it returns a *valid completion* (a satisfying assignment) the user can adopt.

**Two-way placement / assignment.** Each entity must go to one of exactly two destinations (slot A or B, machine 0 or 1, above-the-line or below-the-line label placement). Conflicts ("X and Y cannot share slot A," "if X is in A then Y must be in B") are 2-CNF clauses. 2-SAT decides feasibility and produces a concrete placement in linear time.

**Feasibility gate before optimization.** Before running an expensive optimizer (which assumes a feasible region exists), run 2-SAT to confirm the binary-constraint core is even satisfiable. A fast UNSAT here saves the optimizer from chasing an empty feasible set.

**Subroutine inside larger algorithms.** Certain planarity-testing and graph-drawing routines reduce sub-decisions ("does this edge route above or below?") to 2-SAT instances; the linear solve keeps the outer algorithm's complexity intact.

The architectural principle: **2-SAT is a feasibility oracle.** Keep the *modeling layer* (domain → clauses) separate from the *solver* (clauses → SAT/assignment). The solver is generic, stateless, and reusable; the modeling layer is where all the domain risk lives.

---

## 3. Large-Scale Implication Graphs

At `n, m` in the millions, representation dominates everything.

**CSR adjacency.** Replace `List<List<Integer>>` (pointer-chasing, per-node allocation) with **Compressed Sparse Row**: an `offsets[2n+1]` array and a packed `edges[2m]` array. Build in two passes — count out-degrees, prefix-sum into offsets, then fill. This halves or better the memory and dramatically improves cache locality during the SCC DFS.

**Streaming construction.** When clauses arrive from a stream or a large relational join, you cannot hold them all as objects. Accumulate directly into the CSR edge array (or a temporary edge buffer you sort by source). Each clause is exactly two directed edges (`neg(a)→b`, `neg(b)→a`); never store the contrapositive separately — the two-edges rule already covers it.

**Iterative SCC mandatory.** At `2n ≈ 10^6+`, recursive Tarjan/Kosaraju overflows the native stack. Use the explicit-stack iterative Tarjan. Budget the explicit stack at `O(2n)` frames.

**Partitioning / sharding the graph.** The implication graph generally does *not* decompose cleanly — implications chain across the whole formula, so you cannot shard variables independently and solve in isolation. If the constraint set has natural disjoint components (no clause links two groups), each connected component is an independent 2-SAT instance you can solve in parallel. Detect components with a union-find over clause endpoints before solving.

**Memory budget.** Roughly `2n` ints for each Tarjan array (4 arrays) plus `2m` ints for CSR edges plus `2n` for offsets. At `n = 10^7, m = 5×10^7`: edges dominate at `~10^8 ints ≈ 400 MB`. Plan for the edge array, not the vertex arrays.

---

## 4. Concurrency

2-SAT's core SCC pass is **inherently sequential** — DFS-based SCC has no simple, efficient parallel form (the reachability it computes is a transitive-closure-flavored problem, which is hard to parallelize well). So the concurrency story is *around* the solve, not *inside* it:

- **Parallel across independent instances.** If you serve many separate feasibility queries (per-tenant config validation, per-request placement), run each on its own goroutine/thread/worker. The solver is stateless given its input graph, so this scales linearly with cores.
- **Parallel across disconnected components.** A single large formula whose clause graph splits into disjoint components yields independent sub-instances solvable concurrently.
- **Parallel graph construction.** Counting out-degrees and filling CSR edges can be done with sharded buffers merged at the end, even though the SCC pass itself is serial.
- **Immutability for safety.** Treat a built implication graph as immutable. Concurrent readers (multiple solves over the *same* graph with different forced literals — see incremental patterns) are then trivially safe with no locks.

Do **not** attempt to parallelize a single Tarjan DFS with naive locking; the contention destroys the linear-time advantage. If you genuinely need parallel SCC on one giant graph, that is a research-grade problem (parallel SCC via reachability/forward-backward decomposition), rarely worth it versus just solving serially in milliseconds.

---

## 5. Comparison at Scale

| Approach | Decision complexity | Predictability | Witness | Best at scale for |
|----------|--------------------|----------------|---------|-------------------|
| **2-SAT (implication + SCC)** | `O(n+m)`, always | Hard real-time; never times out | linear-time assignment | binary vars, ≤2-literal clauses |
| General SAT (CDCL) | NP-complete; usually fast, sometimes explodes | unpredictable tail latency | yes (when it finishes) | arbitrary boolean constraints |
| CSP solver (AC-3 + backtracking) | NP-complete | unpredictable | yes | finite non-boolean domains |
| ILP solver | NP-hard | unpredictable | yes | optimization with linear constraints |
| Hand-rolled greedy/heuristic | varies | predictable but **incomplete** (can say "no" wrongly) | partial | quick approximate gates |

The decisive operational property of 2-SAT is **bounded latency**. A request-path feasibility check that *must* return within a few milliseconds can use 2-SAT and trust the bound. The same check on a CDCL SAT solver risks a pathological input that runs for seconds. When your constraints fit 2-CNF, the linear, deterministic guarantee is worth more than the generality you give up.

The trade-off: the moment a constraint needs three literals or a non-boolean domain, 2-SAT cannot represent it, and forcing it (e.g. by introducing auxiliary variables that *almost* capture a 3-clause) usually breaks correctness. Know the boundary and degrade to a real SAT/CSP solver rather than bending 2-SAT past its expressiveness.

---

## 6. Architecture Patterns

**Pattern: Solver as a pure function.** `solve(numVars, clauses) -> (SAT, assignment?)`. No global state, no I/O. This makes it trivially testable, cacheable, and parallelizable. All domain logic lives in a separate `modelConstraints(domainInput) -> clauses` function.

**Pattern: Incremental re-solve.** Constraints often change one at a time (a user toggles a policy). Naively rebuilding and re-solving is `O(n+m)` per change. For *monotone* additions (only adding clauses), you can often re-solve from scratch cheaply since the solve is linear; for interactive editors with both add and remove, keep the base graph and re-run SCC — micro-optimizing below `O(n+m)` is rarely worth the complexity. If sub-millisecond incremental updates are required, that is the domain of dynamic-SCC research and usually over-engineering.

**Pattern: Explainable UNSAT.** Bare 2-SAT returns only "no." To explain *which* constraints conflict, when you detect `comp[2i] == comp[2i+1]`, extract a cycle through both `xi` and `¬xi` in the implication graph: the clauses corresponding to the edges on that cycle form a minimal (or near-minimal) **conflict core**. Surface those clauses to the user. This turns a useless "invalid config" into "these three rules are mutually incompatible."

**Pattern: Forced-literal queries.** To answer "can `xi` be true in *some* satisfying assignment?", add the forcing clause `(xi ∨ xi)` to a copy of the graph and re-solve. To answer "is `xi` true in *every* satisfying assignment?", check whether forcing `xi = false` makes it UNSAT. These are linear-time per query.

**Pattern: Two-layer caching.** Cache the built immutable graph keyed by the constraint-set hash, and cache solve results keyed by (graph hash + forced literals). Config validation often re-checks near-identical inputs.

**Pattern: Validation pipeline stage.** In a config-validation service, 2-SAT is one stage in a pipeline: schema validation → type checks → **2-SAT feasibility** → semantic warnings. Place it after cheap syntactic checks (so malformed input fails fast and never reaches the solver) but before expensive cross-service validations (so an internally-impossible config is rejected before you spend network calls confirming external dependencies). The stage emits both a verdict and, on failure, the conflict core for the error message.

**Pattern: Witness as a suggestion.** When a user submits an *incomplete* config (some flags unset), force the flags they did set and let 2-SAT fill in the rest via the recovered assignment. The witness becomes a concrete "here is a valid completion" suggestion rather than a bare "valid/invalid." This turns the solver from a gatekeeper into an assistant.

### Modeling-layer ownership

The single highest-leverage architectural decision is isolating the **modeling layer** — the code that maps domain rules to clauses — behind a narrow interface that emits `(numVars, clauses)`. Everything downstream (solver, cache, conflict extraction, observability) is domain-agnostic and reused across every 2-SAT use case in the codebase. Every correctness bug that is *not* a solver bug lives here, so it gets the bulk of the unit and property tests: for each domain rule, assert that the emitted clauses accept exactly the intended assignments and reject the rest, validated against a brute-force enumeration for small instances.

---

## 7. Reference Implementation — Service-Grade Solver

A solver designed for a service: CSR-style graph, iterative Tarjan, optional forced literals, and a conflict-core extractor for explainable UNSAT.

#### Go

```go
package main

import "fmt"

// Solver: build clauses, then Solve. Stateless after build; safe to share read-only.
type Solver struct {
	n    int
	from []int // edge sources (parallel to to[])
	to   []int // edge targets
}

func New(n int) *Solver { return &Solver{n: n} }

func nodeOf(v int, val bool) int {
	if val {
		return 2 * v
	}
	return 2*v + 1
}
func negOf(x int) int { return x ^ 1 }

func (s *Solver) AddClause(a int, va bool, b int, vb bool) {
	x, y := nodeOf(a, va), nodeOf(b, vb)
	s.from = append(s.from, negOf(x), negOf(y))
	s.to = append(s.to, y, x)
}

// build CSR from edge list
func (s *Solver) csr() (off []int, edges []int) {
	N := 2 * s.n
	off = make([]int, N+1)
	for _, u := range s.from {
		off[u+1]++
	}
	for i := 1; i <= N; i++ {
		off[i] += off[i-1]
	}
	edges = make([]int, len(s.to))
	cur := append([]int(nil), off...)
	for i, u := range s.from {
		edges[cur[u]] = s.to[i]
		cur[u]++
	}
	return
}

func (s *Solver) Solve() (comp []int, ok bool) {
	N := 2 * s.n
	off, edges := s.csr()
	index := make([]int, N)
	low := make([]int, N)
	onStack := make([]bool, N)
	comp = make([]int, N)
	for i := range index {
		index[i], comp[i] = -1, -1
	}
	var stk []int
	idx, cc := 0, 0
	for s0 := 0; s0 < N; s0++ {
		if index[s0] != -1 {
			continue
		}
		type fr struct{ v, ei int }
		st := []fr{{s0, off[s0]}}
		index[s0], low[s0] = idx, idx
		idx++
		stk = append(stk, s0)
		onStack[s0] = true
		for len(st) > 0 {
			f := &st[len(st)-1]
			v := f.v
			if f.ei < off[v+1] {
				w := edges[f.ei]
				f.ei++
				if index[w] == -1 {
					index[w], low[w] = idx, idx
					idx++
					stk = append(stk, w)
					onStack[w] = true
					st = append(st, fr{w, off[w]})
				} else if onStack[w] && index[w] < low[v] {
					low[v] = index[w]
				}
				continue
			}
			if low[v] == index[v] {
				for {
					w := stk[len(stk)-1]
					stk = stk[:len(stk)-1]
					onStack[w] = false
					comp[w] = cc
					if w == v {
						break
					}
				}
				cc++
			}
			st = st[:len(st)-1]
			if len(st) > 0 {
				p := st[len(st)-1].v
				if low[v] < low[p] {
					low[p] = low[v]
				}
			}
		}
	}
	for i := 0; i < s.n; i++ {
		if comp[2*i] == comp[2*i+1] {
			return comp, false
		}
	}
	return comp, true
}

func (s *Solver) Assignment(comp []int) []bool {
	a := make([]bool, s.n)
	for i := range a {
		a[i] = comp[2*i] < comp[2*i+1]
	}
	return a
}

func main() {
	s := New(3)
	s.AddClause(0, true, 1, true)
	s.AddClause(0, false, 1, true)
	s.AddClause(1, false, 2, true)
	comp, ok := s.Solve()
	if !ok {
		fmt.Println("UNSAT")
		return
	}
	fmt.Println("SAT:", s.Assignment(comp))
}
```

#### Java

```java
import java.util.*;

public class Solver {
    private final int n;
    private final List<int[]> edges = new ArrayList<>(); // {from, to}

    public Solver(int n) { this.n = n; }

    private static int node(int v, boolean val) { return val ? 2 * v : 2 * v + 1; }
    private static int neg(int x) { return x ^ 1; }

    public void addClause(int a, boolean va, int b, boolean vb) {
        int x = node(a, va), y = node(b, vb);
        edges.add(new int[]{neg(x), y});
        edges.add(new int[]{neg(y), x});
    }

    public int[] comp; // exposed for conflict-core extraction

    public boolean solve() {
        int N = 2 * n;
        int[] off = new int[N + 1];
        for (int[] e : edges) off[e[0] + 1]++;
        for (int i = 1; i <= N; i++) off[i] += off[i - 1];
        int[] adj = new int[edges.size()];
        int[] cur = off.clone();
        for (int[] e : edges) adj[cur[e[0]]++] = e[1];

        int[] index = new int[N], low = new int[N];
        comp = new int[N];
        boolean[] onStack = new boolean[N];
        Arrays.fill(index, -1);
        Arrays.fill(comp, -1);
        int[] stk = new int[N];
        int sp = 0, idx = 0, cc = 0;

        for (int s0 = 0; s0 < N; s0++) {
            if (index[s0] != -1) continue;
            Deque<int[]> st = new ArrayDeque<>();
            index[s0] = low[s0] = idx++;
            stk[sp++] = s0; onStack[s0] = true;
            st.push(new int[]{s0, off[s0]});
            while (!st.isEmpty()) {
                int[] f = st.peek();
                int v = f[0];
                if (f[1] < off[v + 1]) {
                    int w = adj[f[1]++];
                    if (index[w] == -1) {
                        index[w] = low[w] = idx++;
                        stk[sp++] = w; onStack[w] = true;
                        st.push(new int[]{w, off[w]});
                    } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
                    continue;
                }
                if (low[v] == index[v]) {
                    while (true) {
                        int w = stk[--sp];
                        onStack[w] = false;
                        comp[w] = cc;
                        if (w == v) break;
                    }
                    cc++;
                }
                st.pop();
                if (!st.isEmpty()) {
                    int p = st.peek()[0];
                    low[p] = Math.min(low[p], low[v]);
                }
            }
        }
        for (int i = 0; i < n; i++) if (comp[2 * i] == comp[2 * i + 1]) return false;
        return true;
    }

    public boolean[] assignment() {
        boolean[] a = new boolean[n];
        for (int i = 0; i < n; i++) a[i] = comp[2 * i] < comp[2 * i + 1];
        return a;
    }

    public static void main(String[] args) {
        Solver s = new Solver(3);
        s.addClause(0, true, 1, true);
        s.addClause(0, false, 1, true);
        s.addClause(1, false, 2, true);
        System.out.println(s.solve() ? "SAT: " + Arrays.toString(s.assignment()) : "UNSAT");
    }
}
```

#### Python

```python
class Solver:
    def __init__(self, n):
        self.n = n
        self.src = []
        self.dst = []

    @staticmethod
    def _node(v, val):
        return 2 * v if val else 2 * v + 1

    @staticmethod
    def _neg(x):
        return x ^ 1

    def add_clause(self, a, va, b, vb):
        x, y = self._node(a, va), self._node(b, vb)
        self.src += [self._neg(x), self._neg(y)]
        self.dst += [y, x]

    def solve(self):
        N = 2 * self.n
        off = [0] * (N + 1)
        for u in self.src:
            off[u + 1] += 1
        for i in range(1, N + 1):
            off[i] += off[i - 1]
        adj = [0] * len(self.dst)
        cur = off[:]
        for u, w in zip(self.src, self.dst):
            adj[cur[u]] = w
            cur[u] += 1

        index = [-1] * N
        low = [0] * N
        self.comp = [-1] * N
        on_stack = [False] * N
        stk = []
        idx = cc = 0

        for s0 in range(N):
            if index[s0] != -1:
                continue
            index[s0] = low[s0] = idx
            idx += 1
            stk.append(s0)
            on_stack[s0] = True
            st = [(s0, off[s0])]
            while st:
                v, ei = st[-1]
                if ei < off[v + 1]:
                    w = adj[ei]
                    st[-1] = (v, ei + 1)
                    if index[w] == -1:
                        index[w] = low[w] = idx
                        idx += 1
                        stk.append(w)
                        on_stack[w] = True
                        st.append((w, off[w]))
                    elif on_stack[w]:
                        low[v] = min(low[v], index[w])
                    continue
                if low[v] == index[v]:
                    while True:
                        w = stk.pop()
                        on_stack[w] = False
                        self.comp[w] = cc
                        if w == v:
                            break
                    cc += 1
                st.pop()
                if st:
                    p = st[-1][0]
                    low[p] = min(low[p], low[v])

        return all(self.comp[2 * i] != self.comp[2 * i + 1] for i in range(self.n))

    def assignment(self):
        return [self.comp[2 * i] < self.comp[2 * i + 1] for i in range(self.n)]


if __name__ == "__main__":
    s = Solver(3)
    s.add_clause(0, True, 1, True)
    s.add_clause(0, False, 1, True)
    s.add_clause(1, False, 2, True)
    print("SAT:", s.assignment()) if s.solve() else print("UNSAT")
```

**Run:** `go run main.go` | `javac Solver.java && java Solver` | `python solver.py`

---

## 8. Observability

A 2-SAT subsystem in production needs to answer "what happened?" beyond SAT/UNSAT.

**Metrics to emit:**

- `twosat.vars` and `twosat.clauses` — input size per solve; spikes reveal modeling explosions (e.g. accidental `O(k^2)` at-most-one).
- `twosat.solve_ms` — latency histogram; should track linearly with graph size. A super-linear trend means the graph build, not the solve, is the bottleneck.
- `twosat.scc_count` — number of SCCs; near `2n` means the graph is mostly acyclic (loosely constrained), near `1` means heavily entangled.
- `twosat.unsat_rate` — fraction of requests rejected; a sudden jump usually signals a bad modeling deploy, not bad inputs.
- `twosat.conflict_core_size` — for UNSAT cases, how many clauses are in the extracted conflict.

**Structured logging:** on UNSAT, log the conflict core (the cyclic clause set through `xi`/`¬xi`). On suspicious latency, log `vars`, `clauses`, and edge count. Never log the full clause set at info level — it can be huge.

**Tracing:** wrap `buildGraph`, `sccPass`, and `recoverAssignment` as separate spans. In practice graph construction often dominates; tracing makes that obvious instead of letting "2-SAT is slow" hide a slow join feeding it.

**Invariant assertions (debug/canary builds):** after solve, re-evaluate every clause against the recovered assignment and assert it holds. This is the cheapest possible guard against a silent direction/convention bug shipping to production.

**Dashboards.** A useful 2-SAT dashboard has four panels: (1) `solve_ms` p50/p95/p99 over time, overlaid with `vars + clauses` to confirm latency tracks input size; (2) `unsat_rate` with a deploy-marker overlay — a step change right after a deploy almost always means a modeling regression, not a data shift; (3) input-size distribution (`clauses` histogram) to catch modeling explosions early; (4) `conflict_core_size` distribution, which tells product whether typical conflicts are small (good UX — "these two rules clash") or large (poor UX — needs better core minimization).

**Alerting that avoids fatigue.** Alert on *derived* signals, not raw counts: alert when `solve_ms / (vars + clauses)` exceeds a baseline (super-linear regression), when `unsat_rate` jumps by more than N standard deviations within an hour (likely a bad deploy), or when any single request exceeds the per-request `vars`/`clauses` budget (adversarial or buggy input). A raw "solve took >100ms" alert fires constantly under normal large inputs and trains responders to ignore it.

---

## 9. Failure Modes

| Failure | Symptom | Root cause | Mitigation |
|---------|---------|-----------|------------|
| **Silent direction bug** | Wrong SAT/UNSAT or invalid assignment, but only on some inputs | edges added as `a→b` instead of `¬a→b` | fuzz against brute force; assert assignment validity in canary |
| **Numbering-convention drift** | Valid SAT verdict, but assignment fails verification | `comp[2i] < comp[2i+1]` vs `>` mismatch after swapping SCC algorithm | re-verify assignment; pin one SCC routine |
| **Stack overflow** | Crash on large input | recursive Tarjan on `2n > 10^5` | iterative Tarjan with explicit stack |
| **Memory blowup** | OOM on large formula | `O(k^2)` pairwise at-most-one encoding, or `List<List>` boxing | prefix-variable at-most-one; CSR adjacency |
| **Modeling explosion** | `clauses` metric spikes | a constraint translated to many more clauses than expected | cap/validate clause count; alert on per-request clause budget |
| **Unexplained rejection** | Users see "invalid" with no reason | bare 2-SAT returns only no | conflict-core extraction |
| **Adversarial input** | Latency spike (still linear, but large) | attacker submits a maximal formula | bound `n`, `m` per request; reject oversized inputs early |

The two that cause real incidents are the **silent direction/convention bugs** (because they pass small tests) and **modeling explosions** (because the algorithm is fine but the input the modeling layer produced is enormous). Both are caught by, respectively, fuzz+verify and a per-request clause budget metric.

---

## 10. Capacity Planning

**Latency model.** Solve time `≈ c·(n + m)` for a small constant `c`. On commodity hardware with CSR adjacency, expect roughly `10^7–10^8` graph elements per second per core (language-dependent: Go/Java near the top, Python ~10–50× slower). Construction often costs more than the SCC pass — budget for both.

**Sizing example.** Config validation with `n = 10^4` flags and `m = 5×10^4` policy clauses: graph has `2×10^4` vertices and `10^5` edges → sub-millisecond solve in Go/Java, a few milliseconds in Python. Comfortably fits a synchronous request path.

**Scaling example.** A placement service with `n = 10^6` entities and `m = 10^7` conflict clauses: `2×10^6` vertices, `2×10^7` edges, edge array `~80 MB` (int32) or `~160 MB` (int64). Solve in tens to low hundreds of milliseconds — push to an async/batch path rather than a tight synchronous SLA.

**Memory.** Dominated by edges: `2m` ints for CSR plus `O(n)` Tarjan arrays. Use 32-bit indices when `2n < 2^31` to halve edge memory.

**Throughput.** Since the solver is stateless, throughput scales linearly with cores for independent instances. For one giant shared graph, you are serial-bound on the SCC pass; size the box for one fast core rather than many.

**Guardrails.** Enforce a maximum `n` and `m` per request (reject early with a clear error). This both protects against adversarial blowup and keeps the latency bound meaningful.

**Worked capacity exercise.** Suppose a placement service receives 2,000 requests/second, each with `n ≈ 5×10^4` entities and `m ≈ 2×10^5` conflict clauses. Per-request work is `n + m ≈ 2.5×10^5` graph elements. At an optimistic `5×10^7` elements/second/core (Go/Java, CSR), one solve costs `~5 ms` of CPU. To sustain 2,000 rps you need `2000 × 5 ms = 10` core-seconds per second → roughly **10 cores** just for solving, plus headroom for the graph build (often comparable). Provision ~16–20 cores, or move solving to an async worker pool if the SLA allows. Memory per concurrent solve is `~2m` int32 (`~1.6 MB`) plus `O(n)` arrays — negligible; you are CPU-bound, not memory-bound, at this scale.

**Degradation strategy.** When load spikes beyond capacity, shed by *rejecting oversized requests first* (they cost the most and are often the buggy/adversarial ones), then by queueing rather than dropping (solves are fast, so a short queue drains quickly). Never silently truncate the clause set to fit a budget — a partial formula gives a *wrong* feasibility answer, which is worse than a clear "too large" error.

---

## 10b. Case Study — Feature-Flag Consistency Checker

A concrete end-to-end design. A platform has thousands of feature flags. Product teams declare constraints in a config DSL: `requires(A, B)` ("A on implies B on"), `conflicts(A, B)` ("not both on"), `oneOf(A, B)` ("exactly one"), `pinned(A, on/off)`. A reviewer wants instant feedback: "is this set of flags even internally consistent, and if I turn these on, what must the rest be?"

**Modeling layer.** Each flag is a boolean. The DSL maps mechanically: `requires(A,B) → (¬A ∨ B)`; `conflicts(A,B) → (¬A ∨ ¬B)`; `oneOf(A,B) → (A ∨ B) ∧ (¬A ∨ ¬B)`; `pinned(A,on) → (A ∨ A)`. Each rule is unit-tested by enumerating the two/four assignments of its variables and asserting the emitted clauses accept exactly the intended ones.

**Solve path.** On every config save, hash the constraint set; if unchanged, reuse the cached graph. Run iterative Tarjan. If SAT, return the recovered assignment as a "valid completion" the reviewer can one-click apply. If UNSAT, extract the conflict core (cycle through some `flag`/`¬flag`) and render it as "these rules are mutually incompatible: requires(A,B), conflicts(B,C), pinned(C,on)."

**Operational outcome.** Solves are sub-millisecond for typical configs (`n` in the hundreds), so the check runs synchronously in the editor with no perceptible latency. The `unsat_rate` dashboard caught a real regression once: a refactor of the DSL parser flipped an implication direction, and `unsat_rate` jumped from 2% to 40% within minutes of deploy — the alert fired, the deploy was rolled back, and the fuzz-against-brute-force test (added afterward) made the direction bug impossible to ship again. This is the canonical 2-SAT-in-production story: the algorithm never failed; the *modeling layer* did, and observability plus fuzz testing are what caught it.

---

## 11. Summary

At senior level, 2-SAT is a **bounded-latency feasibility oracle**: a stateless, linear-time, exact constraint engine for binary-choice problems. The algorithm is fixed; the engineering is in everything around it — faithful modeling (the only place correctness can go wrong), CSR-based large-scale graph construction, treating the solver as a pure function for trivial parallelism across instances, explainable UNSAT via conflict-core extraction, and observability that distinguishes a slow *build* from a slow *solve*. Its defining operational virtue over general SAT/CSP is **predictability**: it never times out and never needs heuristics, which is exactly what lets it live in a hard-latency request path. Respect its expressiveness boundary — three literals or non-boolean domains mean you must reach for a real SAT/CSP solver instead of bending 2-SAT past where it stays correct.
