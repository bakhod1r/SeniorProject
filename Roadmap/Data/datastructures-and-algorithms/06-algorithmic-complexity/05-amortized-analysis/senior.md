# Amortized Analysis — Senior Level

## Prerequisites

- [Middle Level](./middle.md) — the three methods: aggregate, accounting (banker's), potential (physicist's)
- [Time vs Space Complexity — Senior](../01-time-vs-space-complexity/senior.md) — trade-offs at system scale

## Table of Contents

1. [What Senior-Level Amortization Is About](#what-senior-level-amortization-is-about)
2. [Choosing the Right Method per Structure](#choosing-the-right-method-per-structure)
3. [Fibonacci Heap — Potential = #trees + 2·#marked](#fibonacci-heap)
4. [Splay Trees — The Access Lemma](#splay-trees)
5. [Union-Find — The Inverse-Ackermann Bound](#union-find)
6. [Dynamic Arrays and Hash Resizing — Recap at Speed](#dynamic-arrays-and-hash-resizing)
7. [Amortized vs Worst-Case, and De-amortization](#amortized-vs-worst-case)
8. [Amortization Under Persistence — The Subtle Trap](#amortization-under-persistence)
9. [Worked Reference: A Splay Tree in Go](#worked-reference-splay-tree)
10. [Decision Framework](#decision-framework)
11. [Research Pointers](#research-pointers)
12. [Key Takeaways](#key-takeaways)

---

## What Senior-Level Amortization Is About

Junior and middle levels teach the *mechanics*: an expensive operation is paid for by many cheap ones, and you prove it with the aggregate, accounting, or potential method. Senior-level amortization is about three harder things:

1. **Picking the right potential function for a non-trivial structure** — the art is in the Φ, not the algebra. A good potential makes the bound fall out; a bad one obscures it.
2. **Knowing when an amortized bound is a lie for your workload** — hard real-time, latency-SLO-bound, adversarial, or concurrent systems can be wrecked by the one O(n) operation that the average hides.
3. **Knowing when amortized bounds silently break** — specifically under **persistence**, where the expensive operation can be re-run arbitrarily often, defeating the "pay once" accounting unless you adapt the method (Okasaki's debits + lazy evaluation).

Get these wrong and you ship a data structure whose textbook bound is correct and whose production behavior is a disaster.

---

## Choosing the Right Method per Structure

The three methods are equivalent in power (each can prove what the others can), but each is *ergonomic* for different structures.

| Structure | Best method | Why | Bound |
|---|---|---|---|
| Dynamic array | Aggregate or accounting | Total copy work telescopes cleanly | O(1) push |
| Binary counter increment | Aggregate or accounting | Bits flipped sum to ~2n | O(1) increment |
| Splay tree | Potential (Φ = Σ rank) | The access lemma is a potential argument | O(log n) per op |
| Fibonacci heap | Potential (Φ = #trees + 2·#marked) | Two opposing forces need a state-valued Φ | O(1) decrease-key, O(log n) extract-min |
| Union-find (compression + rank) | Aggregate with a clever charging scheme | Inverse-Ackermann needs Tarjan's leveling, not a simple Φ | O(α(n)) per op |

The pattern: **the more the cost of an operation depends on accumulated structural state, the more you want the potential method**, because Φ *is* a function of state. Union-find is the exception — its tightest bound resists a simple potential and needs a dedicated charging argument.

---

## Fibonacci Heap

The Fibonacci heap is the canonical "potential method earns its keep" example. It supports `insert`, `find-min`, `decrease-key`, `extract-min`, `merge` with these amortized bounds:

| Operation | Amortized | Worst-case (single op) |
|---|---|---|
| insert | O(1) | O(1) |
| find-min | O(1) | O(1) |
| merge | O(1) | O(1) |
| decrease-key | **O(1)** | O(log n) |
| extract-min | **O(log n)** | O(n) |

The O(1) amortized `decrease-key` is what makes Dijkstra and Prim run in O(E + V log V). See [`../../10-heaps/03-fibonacci-heap/`](../../10-heaps/03-fibonacci-heap/) for the structural details; here we focus on *why the bounds hold*.

### The structure, in one paragraph

A Fibonacci heap is a forest of heap-ordered trees with a pointer to the minimum root. `decrease-key` cuts the affected node from its parent and adds it as a new root — cheap, O(1) — but to keep trees "bushy" enough that `extract-min` consolidates them in O(log n), each node carries a **mark bit**: a node is marked when it loses its *first* child. When it loses a *second* child, it too is cut and moved to the root list (a "cascading cut"), and unmarked. Cascading cuts can chain, which is the worst-case O(log n) for a single `decrease-key`.

### The potential

$$\Phi = t(H) + 2\,m(H)$$

where `t(H)` = number of trees in the root list and `m(H)` = number of marked nodes. Φ ≥ 0 always, and Φ of an empty heap is 0, so the amortized total upper-bounds the actual total.

**Why `2·m`?** The factor 2 is the whole trick. A cascading cut at a marked node does two things simultaneously: it adds a tree to the root list (cost charged to `t`) *and* it clears a mark (releasing potential from `m`). The mark carried *two* units of stored potential precisely so that one unit pays for the new tree and one unit pays for the constant work of the cut itself. The marks are pre-paid IOUs for the cuts they will eventually trigger.

### decrease-key is O(1) amortized

Suppose `decrease-key` triggers `c` cascading cuts before stopping.

- **Actual cost:** O(c) — one cut per level of the cascade, plus the initial cut.
- **Change in t:** each of the `c` cascaded nodes plus the directly-cut node become new roots, so `t` increases by `c + 1`, contributing `+(c+1)` to ΔΦ.
- **Change in m:** the `c` cascaded nodes were marked and are now unmarked (each cut node loses its mark): `m` decreases by at least `c`, and at most one new node becomes marked (the highest ancestor that stopped the cascade). So `Δm ≤ 1 − c`, contributing `2(1 − c) = 2 − 2c` to ΔΦ.

Amortized cost = actual + ΔΦ = O(c) + (c + 1) + (2 − 2c) = O(c) + (3 − c) = **O(1)**.

The `−c` from the released marks cancels the `+c` actual cost of the cascade. Without the factor of 2 on `m`, one unit would not be enough to pay for both the new tree and the cut, and the cancellation would fail.

### extract-min is O(log n) amortized

`extract-min` promotes the min's children to roots, then **consolidates**: repeatedly link roots of equal degree until all root degrees are distinct.

- **Actual cost:** O(D(n) + t(H)), where D(n) is the max degree. The `t(H)` term is the work to walk the root list during consolidation; D(n) bounds the size of the degree-array.
- **After consolidation** there are at most `D(n) + 1` trees (one per distinct degree).
- **ΔΦ:** `t` drops from `t(H)` to at most `D(n) + 1`, so Δt ≤ D(n) + 1 − t(H). Marks only decrease or stay, so the `m` term doesn't hurt.

Amortized = O(D(n) + t(H)) + (D(n) + 1 − t(H)) = **O(D(n))**.

The `+t(H)` actual cost is exactly cancelled by the `−t(H)` potential released when the root list collapses — the potential method's signature move. It remains only to show **D(n) = O(log n)**: the marking discipline guarantees that a node of degree `k` roots a subtree of at least `F_{k+2}` nodes (the (k+2)-th Fibonacci number), and since `F_{k+2} ≥ φ^k` with φ the golden ratio, `k ≤ log_φ n = O(log n)`. This is where the name comes from.

---

## Splay Trees

A splay tree is a self-adjusting BST with **no balance information stored** — no colors, no heights, no ranks in the nodes. Every access (search, insert, delete) ends by **splaying** the accessed node to the root via rotations. Sleator and Tarjan (1985) proved that any sequence of `m` operations on a tree of `n` keys costs O((m + n) log n), i.e., **O(log n) amortized per operation** — matching balanced trees without the bookkeeping.

### The potential and the access lemma

Assign each node `x` a positive **weight** `w(x)` (any positive assignment works; the proof is parametric). Define:

- **size** `s(x)` = sum of weights in the subtree rooted at `x`.
- **rank** `r(x) = log₂ s(x)`.
- **potential** `Φ = Σ_x r(x)`.

**Access Lemma.** The amortized cost to splay a node `x` to the root of a tree rooted at `t` is at most

$$3\,(r(t) - r(x)) + 1.$$

The proof is a telescoping sum over the splay steps. A splay is a sequence of double rotations of three kinds — **zig-zig**, **zig-zag**, and a final **zig** — and the core of the proof is showing each *single* step's amortized cost is bounded by `3(r'(x) − r(x))`, where `r'` is the rank after the step (plus `+1` for the lone terminal zig). Summing telescopes: all intermediate ranks cancel, leaving `3(r(t) − r(x)) + 1`. The non-obvious algebraic engine is the inequality

$$\log a + \log b \le 2\log\!\left(\frac{a+b}{2}\right) = 2\log(a+b) - 2,$$

a consequence of concavity of `log`, which is what makes the zig-zig case close.

### From the lemma to O(log n)

Set all weights `w(x) = 1`. Then `s(root) = n`, so `r(t) ≤ log n` and `r(x) ≥ 0`, giving amortized cost ≤ `3 log n + 1 = O(log n)` per access. Because Φ is bounded between 0 and `n log n`, the *total* potential swing over a sequence is absorbed and the per-operation amortized bound holds across any sequence.

### Why weights are a feature, not a footnote

Choosing non-uniform weights yields stronger *workload-aware* theorems for free:

- **Static Optimality:** with `w(x)` ∝ access frequency, splay trees are within a constant factor of the best *static* BST — without knowing the frequencies in advance.
- **Working Set & Static Finger:** recently or near-by accessed keys are cheaper.
- **Dynamic Optimality Conjecture:** that splay trees are O(1)-competitive against *any* BST algorithm, online — still open after 40 years, and one of the most famous open problems in data structures.

The senior takeaway: splay trees trade worst-case-per-operation guarantees (a single splay can be O(n)) for amortized optimality *and* automatic adaptivity to access patterns. That trade is excellent for caches and lookups with locality, and disqualifying for hard real-time.

---

## Union-Find

Union-find (disjoint-set) with both **path compression** and **union by rank** achieves O(α(n)) amortized per operation, where α is the inverse Ackermann function — effectively a small constant (α(n) ≤ 4 for any `n` writable in this universe). The structure and operations live at [`../../12-disjoint-set/01-union-find/`](../../12-disjoint-set/01-union-find/), with the two optimizations at [`../../12-disjoint-set/02-path-compression/`](../../12-disjoint-set/02-path-compression/) and [`../../12-disjoint-set/03-union-by-rank/`](../../12-disjoint-set/03-union-by-rank/).

### Why this resists a simple potential

Each optimization alone gives O(log n) amortized. Combined, the bound collapses to O(α(n)) — but **a clean potential function does not produce it**. Tarjan's proof uses a multi-level **charging argument**: each unit of work in a `find` is charged either to the operation itself or to a node, and nodes are partitioned into "blocks" by how their rank sits in the Ackermann hierarchy. A node can only be charged a bounded number of times before path compression promotes it to a higher block, and the number of blocks a rank can climb through is α(n). The accounting is genuinely subtle; this is one of the few classical bounds where the *amortized constant is the inverse of a hyper-fast-growing function*.

### Stating the bound precisely

For `m` operations (finds and unions) on `n` elements:

$$T(m, n) = O(m\,\alpha(m, n)).$$

- **Path compression alone:** O(log n) amortized (a different, simpler aggregate argument).
- **Union by rank alone:** O(log n) worst-case per find (rank bounds tree height).
- **Both together:** O(α(m, n)) amortized — Tarjan, 1975; later shown tight (Fredman–Saks lower bound in the cell-probe model: Ω(α(n)) is unavoidable).

α grows so slowly that for all practical `n`, union-find is "constant time" — but it is **not** O(1): the lower bound proves the α factor is real, just unobservably small.

### The mental model

`union by rank` keeps trees shallow (height ≤ log n) and `path compression` flattens them further on every traversal. Each `find` you pay for *also pays forward*: it shortens future paths. The α(n) is the amortized residue after that pay-it-forward accounting saturates — almost nothing per operation, but provably not zero.

---

## Dynamic Arrays and Hash Resizing

A recap at speed, since junior/middle cover the derivations.

**Dynamic array (geometric growth ×2):** `n` pushes copy at most `n + n/2 + n/4 + … < 2n` elements total. Amortized O(1) per push, by aggregate or by the accounting trick of charging 3 credits per push (1 to place, 2 saved to fund the eventual copy of this element and one already-copied element).

**Why ×2 and not +k:** arithmetic growth (`capacity += k`) makes `n` pushes cost Θ(n²/k) total = Θ(n/k) amortized — *not* constant. Geometric growth is what buys O(1) amortized. The growth *factor* (1.5 vs 2 vs golden ratio φ ≈ 1.618) is a memory-fragmentation vs copy-frequency trade; factors below φ let freed blocks be reused by later allocations.

**Hash table resizing:** identical analysis. Rehash when load factor crosses a threshold, doubling buckets; each insert is O(1) amortized despite occasional O(n) full rehashes. The catch — and the segue to the next section — is that *one* insert is O(n) worst-case, which is unacceptable for tail-latency-sensitive systems.

---

## Amortized vs Worst-Case

An amortized bound is a statement about a **sequence**: the average cost over the sequence is low. It says nothing about any *individual* operation, which may be Θ(n). For many systems that distinction is the difference between "fine" and "outage."

### When amortized is unacceptable

- **Hard real-time** (avionics, motor control, audio DSP): a deadline missed once is a failure. The O(n) rehash that "averages out" still blows the frame budget on the frame it lands in.
- **Latency SLOs (p99/p999):** amortization hides cost in the tail — exactly the percentile your SLO measures. A structure with O(1) amortized and O(n) worst-case can have a beautiful mean and a catastrophic p999. See [`../01-time-vs-space-complexity/senior.md`](../01-time-vs-space-complexity/senior.md) on tail-latency trade-offs.
- **Adversarial inputs:** an attacker who can trigger the expensive operation on demand (e.g., forcing rehashes via hash collisions — the classic algorithmic-complexity DoS) defeats the average. Amortized bounds assume the *sequence* is fixed in advance, not chosen reactively.
- **Concurrent systems:** the thread that happens to run the O(n) resize stalls while holding a lock; every other thread blocks behind it. The cost isn't amortized across operations — it's *concentrated on one unlucky thread and propagated* to all waiters.

### De-amortization: converting amortized to worst-case

The general technique is **incremental / lazy rebuilding**: spread the expensive operation's work across the cheap operations so no single operation pays the full price.

- **Incremental array growth:** keep both the old and new arrays during a grow. On each operation, copy a constant number `k` of elements from old to new. Size the trigger so the old array is fully drained before it overflows again. Result: every push is **worst-case** O(1), at the cost of ~2× memory during transitions and slightly higher constants.
- **Incremental hashing (real-time rehash):** maintain two tables; on every insert/lookup, migrate O(1) buckets from the old table. Redis uses exactly this for its dict rehashing so a `SET` never blocks on a full table copy.
- **Real-time queues (de-amortized banker's queue):** the two-stack queue is O(1) *amortized* (reverse the back stack only when the front empties). The **real-time** variant performs the reversal incrementally — a few steps per operation, using a lazy stream — so every `dequeue` is worst-case O(1). This is Hood–Melville / Okasaki's real-time queue.

De-amortization buys worst-case guarantees and pays in constant factors and memory. You do it precisely for the four "unacceptable" cases above.

---

## Amortization Under Persistence

This is the senior insight that catches even strong engineers off guard.

### The trap

Amortized analysis (banker's or physicist's) rests on a hidden assumption: **each operation is executed at most once.** The accounting works because credits saved by cheap operations are spent *once* by the expensive one. The expensive operation consumes the stored potential and the bank balance returns to baseline.

A **persistent** (immutable / functional) data structure breaks this assumption. Persistence means every version remains usable forever, so you can take a version that sits *just before* the expensive operation and **execute that expensive operation repeatedly** — once per held reference.

Concretely: the two-stack queue is O(1) amortized ephemerally. Make it persistent and save the version `v` whose next `dequeue` triggers the O(n) reversal. Now call `dequeue v` `n` times. Each call re-runs the full O(n) reversal, because in a persistent setting nothing was mutated to "consume" the saved potential. Total: O(n²) for `n` operations — the amortized bound is **gone**. The bank balance trick fails because the same credits get "spent" many times.

### The fix: Okasaki's debits + lazy evaluation

Chris Okasaki's *Purely Functional Data Structures* (1998) restores amortized bounds in a persistent setting by changing what the accounting tracks:

1. **Lazy evaluation with memoization.** The expensive operation is suspended as a *thunk* and not forced until needed. Crucially, once forced, the result is **memoized** — re-executing the "same" suspension on a shared version returns the cached value in O(1), not the full O(n). Memoization is what neutralizes the repeated-execution attack: the second through n-th caller pay nothing.
2. **The banker's method with debits.** Instead of *credits* (savings you accumulate to spend later), Okasaki uses **debits** — deferred costs attached to suspensions. A debit represents work that has been *promised but not yet paid*. An operation may *discharge* a bounded number of debits per step; a suspension may not be *forced* until all its debits are discharged. Because debits are paid down incrementally and memoization ensures the forced work happens once, the amortized bound survives persistence.
3. **The physicist's method** has a persistent analog too, but it's weaker: it requires the potential to be a function only of the *output* of the suspension, and it doesn't compose with persistence as cleanly as debits. Okasaki generally prefers the banker's/debit framing for persistent structures.

The deep point: **lazy evaluation transforms an amortized ephemeral structure into an amortized persistent one**, because memoized thunks make "re-execution" free, and debits give you an accounting that survives sharing. Strict (eager) functional structures cannot do this — they are forced to be worst-case, or they lose the bound under persistence.

| Setting | Banker's/physicist's bound | Why |
|---|---|---|
| Ephemeral, single-threaded | Holds | Each op runs once; credits spent once |
| Persistent, **strict** | **Breaks** | Expensive op can be re-run per saved version → O(n) each |
| Persistent, **lazy + memoized** | Holds (debits) | Memoization makes re-execution O(1); debits track deferred work |
| Concurrent | Subtle | Memoization needs thread-safety; a forced-once thunk may race |

---

## Worked Reference: Splay Tree

A minimal top-down-friendly splay tree in Go, splaying via bottom-up rotations, with the potential argument restated against the code.

```go
package splay

// Node of a splay tree. No balance/rank field is stored —
// that is the whole point: balance is maintained amortized,
// not via per-node invariants.
type Node struct {
	key         int
	left, right *Node
	parent      *Node
}

type Tree struct {
	root *Node
}

// rotate performs a single rotation bringing x above its parent.
// O(1) pointer surgery; the engine of every splay step.
func (t *Tree) rotate(x *Node) {
	p := x.parent
	g := p.parent
	if p.left == x { // right rotation
		p.left = x.right
		if x.right != nil {
			x.right.parent = p
		}
		x.right = p
	} else { // left rotation
		p.right = x.left
		if x.left != nil {
			x.left.parent = p
		}
		x.left = p
	}
	p.parent = x
	x.parent = g
	if g == nil {
		t.root = x
	} else if g.left == p {
		g.left = x
	} else {
		g.right = x
	}
}

// splay moves x to the root using zig, zig-zig, and zig-zag steps.
// Amortized cost <= 3(r(root) - r(x)) + 1 by the access lemma,
// which is O(log n) with unit weights since r(root) <= log2(n).
func (t *Tree) splay(x *Node) {
	for x.parent != nil {
		p := x.parent
		g := p.parent
		switch {
		case g == nil:
			// zig: single terminal step (the "+1" in the lemma).
			t.rotate(x)
		case (g.left == p) == (p.left == x):
			// zig-zig: rotate the parent first, then x.
			// This case needs the concavity inequality
			// log a + log b <= 2 log((a+b)/2) to close.
			t.rotate(p)
			t.rotate(x)
		default:
			// zig-zag: rotate x twice.
			t.rotate(x)
			t.rotate(x)
		}
	}
}

// Find searches for key and splays the last accessed node to the
// root. Even a miss splays the closest node — this is what makes
// repeated/clustered access amortized-cheap (working-set property).
func (t *Tree) Find(key int) bool {
	x := t.root
	var last *Node
	for x != nil {
		last = x
		if key == x.key {
			t.splay(x)
			return true
		} else if key < x.key {
			x = x.left
		} else {
			x = x.right
		}
	}
	if last != nil {
		t.splay(last) // splay on miss too: keeps the structure adaptive
	}
	return false
}

// Insert adds key, then splays it to the root.
func (t *Tree) Insert(key int) {
	if t.root == nil {
		t.root = &Node{key: key}
		return
	}
	x := t.root
	var p *Node
	for x != nil {
		p = x
		if key == x.key {
			t.splay(x)
			return
		} else if key < x.key {
			x = x.left
		} else {
			x = x.right
		}
	}
	n := &Node{key: key, parent: p}
	if key < p.key {
		p.left = n
	} else {
		p.right = n
	}
	t.splay(n)
}
```

### Invariants and complexity discussion

- **Invariant (BST):** in-order traversal yields sorted keys; preserved because rotations are BST-preserving by construction.
- **No stored balance invariant:** unlike AVL/red-black, no per-node height/color is maintained. There is *no* worst-case-per-operation bound — a single `Find` on a degenerate (linked-list-shaped) tree is O(n). The guarantee is purely amortized.
- **Potential:** `Φ = Σ_x log₂(s(x))`, where `s(x)` is the subtree size of `x` (unit weights). After `splay` brings `x` to the root, the amortized cost is `≤ 3(r(root) − r(x)) + 1 ≤ 3 log₂ n + 1`. The actual rotations performed equal the depth of `x`; the potential drop pays for any deep splay.
- **Why splay-on-miss:** splaying even on an unsuccessful search is what delivers the *working-set* and *static-finger* properties — recently and nearby accessed keys migrate toward the root, so real workloads with locality run far faster than the `log n` worst case.
- **When to use:** caches, lookup tables with temporal/spatial locality, rope/sequence structures. **When not to:** hard real-time (single op is O(n)), and concurrent read-heavy workloads (every *read* mutates the tree, so reads can't share a lock-free fast path — a frequently-overlooked disqualifier).

---

## Decision Framework

Reason **amortized** when:

- The workload is a long sequence and you care about *throughput / total cost*, not per-operation latency.
- Occasional spikes are tolerable (batch jobs, build tools, offline processing, ephemeral single-threaded use).
- You want simplicity and good constants (a doubling array beats an incremental one in code and cache behavior).

Reason **worst-case** (and de-amortize) when:

- Hard real-time or a tight p99/p999 SLO — the tail is the product.
- Adversarial inputs can trigger the expensive op on demand (rehash-DoS, persistence re-execution attacks).
- Concurrent / shared structures where one thread's O(n) op stalls all others behind a lock.
- The structure is **persistent**: confirm the amortized bound survives sharing — if it's a strict functional structure, assume it does *not*, and either de-amortize or use Okasaki's lazy+debit construction.

A compact decision table:

| Question | If yes → |
|---|---|
| Is per-op latency contractually bounded? | Worst-case; de-amortize |
| Can an adversary pick the operation sequence reactively? | Worst-case; assume amortized average is unreachable |
| Is the structure persistent / immutable? | Verify under persistence; use lazy+debit or de-amortize |
| Shared across threads with one op holding a lock? | Worst-case; incremental rebuilding |
| Long offline sequence, throughput-bound, single-threaded? | Amortized is ideal; pick the simplest doubling/potential design |

---

## Research Pointers

- **Tarjan, R. E. (1985). "Amortized Computational Complexity."** *SIAM J. Algebraic Discrete Methods* 6(2). The paper that named and systematized amortized analysis; introduces the banker's and potential framings as we use them.
- **Sleator, D. D., & Tarjan, R. E. (1985). "Self-Adjusting Binary Search Trees."** *JACM* 32(3). Splay trees, the access lemma, static optimality, and the dynamic optimality conjecture.
- **Fredman, M. L., & Tarjan, R. E. (1987). "Fibonacci Heaps and Their Uses…"** *JACM* 34(3). The Φ = t + 2m potential and O(1) amortized decrease-key.
- **Tarjan, R. E. (1975). "Efficiency of a Good But Not Linear Set Union Algorithm."** *JACM* 22(2). The O(m α(m,n)) union-find bound and the charging argument.
- **Fredman, M. L., & Saks, M. (1989). "The Cell Probe Complexity of Dynamic Data Structures."** STOC. The Ω(α(n)) lower bound proving union-find's α factor is unavoidable.
- **Okasaki, C. (1998). *Purely Functional Data Structures.*** Cambridge Univ. Press. Lazy evaluation, the debit-based banker's method, and amortization under persistence — chapters 5–6 are the canonical treatment.
- **Cormen, Leiserson, Rivest, Stein. *Introduction to Algorithms*, Ch. 17 (Amortized Analysis) and Ch. 19 (Fibonacci Heaps).** The standard textbook derivations.

---

## Key Takeaways

1. **Pick the method that fits the structure:** potential for state-dependent costs (splay, Fibonacci heap), aggregate/charging for union-find's inverse-Ackermann bound.
2. **The Fibonacci heap potential `Φ = #trees + 2·#marked`** makes decrease-key O(1) amortized; the factor 2 pre-pays both the cut and the new tree of each cascading cut.
3. **Splay trees** get O(log n) amortized from the access lemma (`Φ = Σ log(size)`), with no stored balance info — and adapt to access patterns for free, but offer no per-op worst-case guarantee.
4. **Union-find with compression + rank is O(α(n))** — provably not O(1), but unobservably close; the bound needs Tarjan's charging argument, not a simple potential.
5. **Amortized ≠ worst-case.** Hard real-time, p99 SLOs, adversarial inputs, and concurrency can all be wrecked by the one expensive operation the average hides.
6. **De-amortize via incremental/lazy rebuilding** (real-time queues, incremental array growth, Redis-style incremental rehash) to buy worst-case guarantees at the cost of constants and memory.
7. **Amortized bounds can break under persistence** because the expensive operation can be re-run per saved version. **Okasaki's lazy evaluation + memoization + debits** restores them — the subtle, senior-defining insight.

---

> **See also:** [`./middle.md`](./middle.md) for the three core methods · [`../../10-heaps/03-fibonacci-heap/`](../../10-heaps/03-fibonacci-heap/) · [`../../12-disjoint-set/01-union-find/`](../../12-disjoint-set/01-union-find/) · [`../01-time-vs-space-complexity/senior.md`](../01-time-vs-space-complexity/senior.md)
