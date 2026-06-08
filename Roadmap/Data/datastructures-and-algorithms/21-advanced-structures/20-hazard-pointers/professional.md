# Hazard Pointers — Correctness, Bounded-Memory Analysis, and Reclamation Theory

## Table of Contents

1. [Formal Model](#formal-model)
2. [The Safe Memory Reclamation Problem](#the-safe-memory-reclamation-problem)
3. [Safety Proof — No Node Freed While Hazard-Protected](#safety-proof)
4. [Memory-Ordering Requirements](#memory-ordering-requirements)
5. [Bounded Retired-Memory Analysis](#bounded-retired-memory-analysis)
6. [Amortized Reclamation Cost](#amortized-reclamation-cost)
7. [Progress and Liveness](#progress-and-liveness)
8. [Comparison: Read-Cost vs Reclaim-Latency](#comparison-read-cost-vs-reclaim-latency)
9. [Comparison with Alternatives](#comparison-with-alternatives)
10. [Summary](#summary)

---

## Formal Model

```text
System: a set P of processes (threads), |P| = H.
Shared:
  - A lock-free object O reachable from a set of roots R (atomic pointers).
  - A hazard-pointer array HP[1..N], each cell an atomic pointer, N = H·K.
    Process p owns cells HP[p,1..K].
  - A heap H of allocated nodes; free(n) returns n's memory to the allocator.

Per process:
  - rlist(p): a thread-local list of retired (unlinked) nodes.

Operations:
  Protect(p, i, src):  publish then validate a pointer read from atomic src.
  Clear(p, i):         HP[p,i] := null.
  Retire(p, n):        rlist(p) := rlist(p) ∪ {n}; if |rlist(p)| ≥ R, Scan(p).
  Scan(p):             prot := { HP[c] : c ∈ all cells, HP[c] ≠ null };
                       for n ∈ rlist(p): if n ∉ prot then free(n)
                                          else keep n in rlist(p).

Definitions:
  retired(n):    n has been passed to Retire and not yet freed.
  protected(n):  ∃ cell c with HP[c] = n at the considered instant.
  reachable(n):  n is reachable from some root in R.
```

We assume the standard lock-free object discipline: a node is retired **only
after** it has been made unreachable (unlinked from all roots by a successful
atomic update), and a node is retired **at most once**.

---

## The Safe Memory Reclamation Problem

```text
SMR PROBLEM. Provide operations to (a) protect a pointer before dereference and
(b) retire an unlinked node, such that:
  (SMR-1 Safety)  free(n) never executes while some process holds and may
                  dereference a pointer to n.
  (SMR-2 Liveness) every retired node is eventually freed, assuming processes
                  make progress and clear their slots.
  (SMR-3 Bounded) the number of retired-but-unfreed nodes is bounded by a
                  function of H and K, independent of execution length.
```

Naive immediate `free` violates SMR-1; never freeing violates SMR-2 and SMR-3.
Hazard pointers satisfy all three. We prove SMR-1 and SMR-3, then argue SMR-2 and
progress.

---

## Safety Proof — No Node Freed While Hazard-Protected

We prove: **`free(n)` executes only when no process can subsequently dereference a
valid pointer to `n` obtained from the shared structure.**

### The hazard-pointer protection lemma

```text
LEMMA (Protected ⇒ Not Freed).
If a process p completes Protect(p,i,src) returning pointer n at time t_v
(the validating load), and HP[p,i] = n continuously over [t_pub, t_v] with the
StoreLoad fence between publish and validate, then any Scan that linearizes at or
after t_pub observes HP[p,i] = n and therefore does not free n.
```

**Proof.**
Let `t_pub` be the instant `HP[p,i] := n` (publish) and `t_v` the validating load
of `src` that returned `n`. The StoreLoad fence orders the publish store before
the validate load in the memory order, so any process whose load of `HP[p,i]`
linearizes after `t_pub` sees `n` (until `p` clears it). Consider the retiring
process q that may free `n`. By the retirement discipline, `q` retired `n` only
after `n` became unreachable, say at unlink time `t_u`. Two cases:

1. **`t_pub ≤ t_u`'s observation by p.** The validate load at `t_v` re-read `src`
   and returned `n`, meaning at `t_v` the structure still presents `n` at `src`;
   hence `n` was not yet unlinked from that root as observed by `p`, so any later
   `Scan` by `q` runs after `t_pub` and reads `HP[p,i] = n`, keeping `n`.

2. **`t_u < t_pub` (n unlinked before publish).** Then the validate load at `t_v`
   would observe `src ≠ n` (the unlink changed `src`), so `Protect` does **not**
   return `n`; it retries. Contradiction with the hypothesis that `Protect`
   returned `n`. Hence this case cannot produce a dangling return.

In both surviving cases, every `Scan` that could free `n` linearizes after
`t_pub` and reads `HP[p,i] = n`, so `n ∈ prot` and `Scan` keeps `n`. Therefore `n`
is not freed while `p` holds it. ∎

### Main safety theorem

```text
THEOREM (SMR-1).
For every node n and every process p that obtains n via Protect and dereferences
n before Clear, free(n) does not execute during p's dereference window.
```

**Proof.**
By the Lemma, while `HP[p,i] = n` no `Scan` frees `n`. `p` dereferences `n` only
within `[t_v, Clear]`, a sub-interval of the interval during which `HP[p,i] = n`.
`free(n)` can only occur inside some `Scan`, and every such `Scan` that linearizes
in `[t_pub, Clear]` observes `HP[p,i] = n` and skips `n`. A `Scan` linearizing
after `Clear` may free `n`, but that is after `p`'s dereference window ends.
Hence no `free(n)` overlaps a dereference of `n` by `p`. ∎

This is exactly the use-after-free guarantee: the published slot is a barrier that
the scan must respect.

### Worked linearization

To make the proof concrete, trace the four critical events on a Treiber-stack pop
where reader `p` protects node `n` and remover `q` retires it.

```text
e1 (p): t_pub  -- HP[p] := n           (publish, release+fence)
e2 (p): t_v    -- load(head) == n      (validate)
e3 (q): t_u    -- CAS(head, n, n.next) (unlink n)
e4 (q): t_s    -- Scan reads HP[p]     (decide free(n))
```

Memory order must place `e1 → e2` (StoreLoad fence) and `e3 → e4` (q scans after
its own unlink). Two orderings of the inter-thread events are possible:

- **`t_u < t_v`:** q unlinked `n` before p's validate. Then `e2` loads `head ≠ n`,
  so `Protect` does **not** return `n` (it retries). No dangling pointer is handed
  to `p`; vacuously safe.
- **`t_v ≤ t_u`:** p validated while `n` was still at `head`, so `t_pub < t_v ≤
  t_u < t_s`. Therefore `t_pub < t_s`: q's scan reads `HP[p]` *after* p published
  `n`, sees `HP[p] = n`, and keeps `n`. Safe.

No third ordering frees `n` during p's window. The fence on `e1 → e2` is what
forbids the compiler/CPU from moving `e2` before `e1`, which would otherwise let p
validate against a stale `head` it read *before* publishing — re-opening case
analysis with no guarantee. This single example is the engine behind the general
Lemma.

---

## Memory-Ordering Requirements

The proof depends on two ordering facts:

```text
(O1) Publish (store HP) is ordered before Validate (load src) — StoreLoad fence.
(O2) A Scan's load of HP[c] is ordered after the retiring unlink it follows,
     so it observes publishes that happened-before the unlink's visibility.
```

(O1) requires a `seq_cst` store + load or an explicit `StoreLoad` barrier between
the publish and the validate. A relaxed store would let the validate load be
reordered before the publish, breaking the Lemma's case analysis. (O2) follows
from the retiring thread issuing its scan after its unlink CAS (release) and the
scan reading slots with acquire semantics. On TSO (x86) the publish store + a
subsequent load already provides the needed `StoreLoad` only with an explicit
fence (x86 does **not** order Store→Load by default); on ARM/Power an explicit
barrier (`dmb ish` / `sync`) is required. This is why correct implementations use
`atomic_thread_fence(seq_cst)` or `seq_cst` accesses on the publish/validate pair.

---

## Bounded Retired-Memory Analysis

```text
THEOREM (SMR-3, Bounded Memory).
At any instant, the number of retired-but-unfreed nodes is at most
    H·K  +  H·R
where R is the per-thread retire threshold. With R = Θ(H·K), this is Θ(H²·K).
```

**Proof.**
Partition retired-unfreed nodes into *pinned* and *pending*.

- **Pinned:** a node survives a `Scan` only if it is in `prot`, i.e. some slot
  holds it. There are exactly `H·K` slots and each holds at most one node, so at
  most `H·K` pinned nodes exist at any instant.
- **Pending:** between scans, each process accumulates at most `R` nodes in its
  `rlist` before being forced to `Scan`. Across `H` processes that is at most
  `H·R` nodes not yet subjected to a scan.

Summing, retired-unfreed ≤ `H·K + H·R`. Choosing `R = Θ(H·K)` gives `Θ(H²·K)`,
independent of execution length. ∎

The crucial qualitative point, contrasted with epoch/RCU: a process that stalls
**indefinitely** while holding slots pins at most its `K` slots, contributing at
most `K` to the pinned set — **not** an unbounded number of nodes retired during
the stall. This is the formal statement of "bounded memory under stalls."

---

## Amortized Reclamation Cost

```text
THEOREM (Amortized O(1) reclamation).
With threshold R = (1+α)·H·K (α > 0 constant) and an O(1) membership test, the
amortized cost of Retire (including its share of Scan) is O(1/α) = O(1).
```

**Proof (accounting / potential method).**
Define potential `Φ = c · |rlist(p)|` for constant `c` chosen below. A `Scan`
fires when `|rlist(p)| = R`. After building `prot` (a hash set, O(H·K) to build,
O(1) lookup), the scan inspects `R` nodes in O(R) and frees all that are
unprotected. At most `H·K` survive (pinned bound), so it frees at least
`R − H·K = α·H·K` nodes.

Charge each `Retire` an amortized cost `â = 1 + ΔΦ`. The actual `Scan` cost is
`O(R + H·K) = O(R)` (since `R = Θ(H·K)`). Across the `R` retires since the last
scan, total actual scan work `O(R)` is spread over `R` retires, i.e. `O(1)` actual
work per retire, plus the `O(1)` append. The potential released by freeing
`α·H·K` nodes pays for the `O(H·K)` set construction. Hence amortized
`â = O(1 + 1/α) = O(1)`. ∎

Without the hash set, the membership test is O(H·K) per retired node, giving an
O(R·H·K) scan and O(H·K) amortized per node — still bounded but worse; production
code uses a sorted array or hash set to recover O(1) amortized.

---

## Quantitative Read-Side Cost Model

To compare schemes precisely we model the reader's per-protected-access cost as a
weighted sum of memory-system events.

```text
c_read = w_store · (publish store)
       + w_fence · (StoreLoad fence)
       + w_load  · (validate load)
       + p_retry · c_read           (expected geometric retry)

Solving the recurrence (p_retry < 1):
  E[c_read] = (w_store + w_fence + w_load) / (1 - p_retry)
```

On commodity x86, the dominant term is `w_fence` (a `mfence`/locked instruction,
tens of cycles) because `w_store` and `w_load` to a hot cache line are a few
cycles each. The retry factor `1/(1 - p_retry)` is ≈ 1 whenever the per-access
modification probability is well below 1; under saturation it can blow up, which
is the regime where one shards the structure or switches to Hazard Eras to amortize
the fence across a whole critical section instead of per dereference.

```text
COROLLARY. Hazard Eras reduces amortized read cost by a factor d, where d is the
number of dereferences sharing one published era within a critical section: it
pays one era store + fence per critical section rather than per dereference.
  E[c_read]^HE ≈ (w_store + w_fence) / d  + w_load_per_deref
```

This makes explicit why interval-based schemes win on read-heavy traversals
(large `d`) while plain hazard pointers are competitive when each operation
protects only one or two nodes (`d ≈ 1`), as in a stack pop or queue dequeue.

---

## Progress and Liveness

```text
SMR-2 (Eventual freeing). If every process eventually clears each slot it
publishes and continues to retire/scan, then every retired node is eventually
freed.
```

**Argument.** A retired node `n` survives a scan only while some slot holds it.
Slots holding `n` belong to processes that protected `n`; by hypothesis each such
process eventually clears that slot. Once all such slots are cleared, the next
scan that linearizes finds `n ∉ prot` and frees it. Since the retiring process
scans every `R` retirements and retirement continues, such a scan occurs. ∎

**Non-blocking progress.** Protect, Clear, Retire each complete in a bounded
number of steps regardless of other processes' actions; the only loop is the
protect/validate retry, which restarts only when a concurrent **successful**
modification changed `src`. Thus the protocol is **lock-free**: at least one
process always makes progress, because a failed validate implies another
process's modification succeeded (a system-wide step). The data-structure
operation built on top inherits the data structure's own progress property
(Treiber stack and MS queue are lock-free), and hazard pointers add no blocking.

```mermaid
flowchart TD
    A[Protect retry loop] -->|fails| B[Some other op succeeded]
    B --> C[System made progress -> lock-free]
    A -->|succeeds| D[Bounded steps]
    E[Retire] --> F[Bounded: append + maybe scan]
    F --> G[Scan: O(R) bounded]
```

---

## Comparison: Read-Cost vs Reclaim-Latency

The fundamental trade among SMR schemes is **how much readers pay** versus **how
long reclamation is delayed** and **how much memory that delay can pin**.

```text
Let:
  c_read  = per-protected-access reader overhead
  L_rec   = reclamation latency (retire -> free)
  M_max   = worst-case pinned memory under a stalled reader

Hazard pointers:  c_read = store + StoreLoad fence + validate load  (O(1), nonzero)
                  L_rec  = until next scan after slots cleared (short, bounded)
                  M_max  = K nodes per stalled reader               (bounded)

RCU:              c_read = rcu_read_lock/unlock (often compiler barrier only ≈ 0)
                  L_rec  = grace period: until all readers exit (unbounded under stall)
                  M_max  = all nodes retired during the stall      (unbounded)

Epoch (EBR):      c_read = enter/exit epoch counter (cheap)
                  L_rec  = until global epoch advances 2 steps     (unbounded under stall)
                  M_max  = nodes retired in 2 epochs               (unbounded)
```

Formally, hazard pointers minimize `M_max` (the Θ(H·K) bound proven above) at the
cost of a nonzero `c_read` (the fence). RCU/EBR drive `c_read → 0` but allow
`M_max → ∞` if any reader stalls, because they track **time/epochs** rather than
**per-object protection**. This is the precise sense in which hazard pointers are
"object-granular" and RCU is "time-granular": hazard pointers pay per dereference
to win a per-object memory bound.

A hybrid result (Hazard Eras, Interval-Based Reclamation) interpolates: use epoch
*intervals* stamped on objects to get RCU-like read cost with hazard-pointer-like
bounds, at the cost of per-object era fields.

### The hybrid frontier, formally

Hazard Eras (Ramalhete & Correia, 2017) reframes protection from "publish the
*pointer*" to "publish the *era*." Each object carries a birth era and a
retirement era; a reader publishes the current global era into its slot instead of
a pointer. A retired object is freed only when no slot holds an era within
`[birth, retire]`.

```text
Reader cost:   read global era, store it (no per-pointer validate loop)  -> O(1)
Object fields: + birth_era, + retire_era                                 -> O(1) space/object
Memory bound:  objects retired within the span of the oldest live era    -> bounded
```

This recovers an RCU-like reader (a single era store, amortizing across many
dereferences in the same critical section) while keeping a **bounded** memory
guarantee (the oldest live era caps how far back unreclaimed objects can reach).
The cost is two integer fields per object and a global era counter. Formally it
moves the design point on the `(c_read, M_max)` curve toward lower `c_read`
without surrendering boundedness — the property RCU gives up. Choose plain hazard
pointers when objects must stay field-free and `K` is tiny; choose Hazard
Eras/IBR when read-side fence cost dominates and you can afford the era fields.

### A note on wait-freedom

The lock-free result above is tight: hazard pointers cannot make an arbitrary
lock-free operation wait-free, because the underlying structure's progress bounds
the composite. However, the *protection protocol itself* can be made wait-free in
isolation by bounding the validate retries: a reader that fails validation `c`
times can fall back to a slower wait-free path (e.g. announce-and-help). In
practice the unbounded-retry lock-free version is used because validation almost
never spins more than once under realistic contention; the expected number of
retries is `O(1)` whenever the per-operation modification rate is below saturation.

---

## Scan Correctness and the Retirement Discipline

The safety proof assumed two discipline conditions on retirement. We now state
them precisely and show the scan preserves them.

```text
(R1 Unlinked-before-retire). Retire(n) is invoked only after a successful atomic
    update made n unreachable from every root. Hence reachable(n) is false at and
    after the retire point.
(R2 Retire-once). Each node is passed to Retire at most once; the lock-free
    operation that unlinks it is the unique retirer.
```

```text
PROPOSITION (Scan preserves no-double-free).
Under (R1) and (R2), Scan frees each node at most once across the entire
execution, and never frees a node still in prot.
```

**Proof.** By (R2) a node appears on exactly one thread's `rlist`. `Scan` removes
`n` from `rlist` exactly when it frees it (the `n ∉ prot` branch); the `n ∈ prot`
branch keeps `n` on the list. Once freed, `n` is gone from `rlist`, so no later
`Scan` of that list can reach it again. Cross-thread double-free is impossible
because no other thread's `rlist` contains `n`. The `n ∈ prot` guard is exactly
the safety condition, so a node in `prot` is never freed. ∎

The combination of the protection Lemma, (R1), and (R2) is what makes hazard
pointers a *complete* SMR solution: protection prevents premature free, (R1)
prevents freeing a reachable node, and (R2) prevents double free.

### Why validation cannot be dropped even with (R1)

A tempting "optimization" is to skip the validate re-read, arguing that (R1)
already guarantees a retired node was unlinked. This is wrong. (R1) constrains the
*retirer*, not the *reader*. The reader's bug is temporal: it reads `head = n`,
and **before** publishing, `n` is unlinked and retired (legally, under (R1)) and
then freed by a scan that ran before the reader's publish. The publish writes a
dangling `n`; no later scan can un-free it. Validation is the reader-side check
that closes this gap by re-confirming `n` is still presented at the source after
the publish is visible. Formally, validation establishes the hypothesis
`Protect returns n ⇒ t_pub < t_s` used in the Lemma; without it that implication
fails.

---

## Lower Bounds and Impossibility

```text
OBSERVATION (Read-side cost is unavoidable for bounded SMR).
Any SMR scheme that (a) is non-blocking and (b) bounds reclaimable memory by a
function of H and K independent of stall duration must impose a per-protected-
access ordering constraint (a fence-equivalent) on readers.
```

**Intuition.** To bound memory under an arbitrarily long reader stall, a stalled
reader must communicate *which specific objects* it protects (else the reclaimer
must conservatively keep everything retired during the stall — unbounded, the RCU
behavior). Publishing that information is a store that must be ordered before the
protected dereference, i.e. a `StoreLoad`-class fence relative to the reader's
view of the structure. Thus the nonzero read cost is not an implementation
artifact; it is the price of the bounded-memory guarantee. RCU/EBR achieve
near-zero read cost precisely by **declining** to publish per-object information,
which is why their memory is unbounded under stalls. This formalizes the central
trade: `bounded memory ⟹ nonzero per-access read ordering`.

A corollary sizes the slot requirement: to protect `m` distinct objects
simultaneously, a thread needs `K ≥ m` slots; no scheme bounded by `H·K` can
protect more than `K` objects per thread at once. Algorithms are therefore
designed to need only a small constant `K` of simultaneous protections (1 for a
stack, 2 for a queue), which is what keeps the `Θ(H²·K)` bound small.

---

## Linearizability of the Protected Operation

Hazard pointers are a *reclamation* layer; the *correctness* (linearizability) of
the data-structure operation is inherited from the underlying lock-free algorithm.
We state the composition result.

```text
THEOREM (Reclamation transparency).
Let A be a lock-free object whose operations are linearizable when memory is never
reclaimed (the "GC assumption"). Augmenting A with hazard-pointer protection on
every dereference and retire-on-unlink yields an object A' that is linearizable
and free of use-after-free, with the same linearization points as A.
```

**Proof sketch.** Protect/Clear add no shared-state mutations to A's logical state
(slots are auxiliary), so they cannot create or move linearization points. The
validate retry only repeats a read that found the structure changed — equivalent
to A re-reading under its own GC assumption. By the safety Theorem, no dereference
in A' touches freed memory, so every read returns the same value it would under
the GC assumption. Hence A' has identical responses and ordering to A-under-GC,
which is linearizable; therefore A' is linearizable. The retirement discipline
(R1) ensures retired nodes are already past their last linearization point, so
deferring their free changes no observable behavior. ∎

This is why one can take a textbook Treiber stack or Michael–Scott queue proved
correct "assuming a garbage collector" and obtain a correct manual-memory version
purely by bolting on hazard pointers — the proof obligations factor cleanly.

---

## Comparison with Alternatives

| Attribute | Hazard Pointers | RCU | Epoch-Based | Reference Counting |
|-----------|-----------------|-----|-------------|--------------------|
| Reader cost | O(1) + StoreLoad fence | ≈ 0 | O(1) cheap | atomic inc/dec |
| Reclaim latency | bounded (next scan) | unbounded under stall | unbounded under stall | immediate at 0 |
| Worst pinned memory | **Θ(H²·K)** | unbounded | unbounded | tight |
| Deterministic bound | **Yes** | No | No | Yes |
| Per-object overhead | none | none | none | refcount word |
| Lock-free? | Yes | readers wait-free; reclaim deferred | Yes | Yes (contended) |
| Solves reclamation-ABA | Yes (pins prevent reuse) | Yes | Yes | Yes |

### Decision criterion (formal)

Given a workload with per-access modification probability `q`, read-to-write ratio
`ρ`, dereferences per critical section `d`, and a memory budget `B`:

```text
Use hazard pointers      when  B is hard and small  (need Θ(H²·K) determinism)
                          and  d ≈ 1..2             (fence amortizes poorly anyway)
Use Hazard Eras / IBR     when  d is large           (amortize fence across deref)
                          and  B is still bounded   (era span caps memory)
Use RCU / EBR             when  ρ ≫ 1 and B is soft (tolerate unbounded reclaim)
Use reference counting    when  sharing is the model and q is low (few atomics)
```

The single discriminator is whether the **memory bound must be deterministic
under arbitrary reader stalls**. Only hazard pointers (and their interval hybrids)
provide it; RCU and EBR trade it away for cheaper reads. This is the theorem of
record from the read-cost/reclaim-latency analysis above.

---

## Summary

Hazard pointers solve **Safe Memory Reclamation** with three provable guarantees.
**Safety (SMR-1):** the protection lemma shows a published-and-validated pointer is
never freed during its dereference window, because every scan that could free the
node linearizes after the publish and observes the slot — provided the StoreLoad
fence orders publish before validate. **Bounded memory (SMR-3):** at most `H·K`
pinned plus `H·R` pending nodes, i.e. `Θ(H²·K)` independent of run length, with the
defining property that a stalled reader pins only its `K` slots. **Amortized O(1)
reclamation:** a threshold `R = Θ(H·K)` plus an O(1) membership test spreads each
O(R) scan over Ω(H·K) freed nodes. The whole protocol is **lock-free** (the only
retry is driven by a competing success). Against RCU and epochs, hazard pointers
deliberately accept a nonzero per-read fence cost to obtain a **deterministic
memory bound** and **stall isolation** that time-/epoch-based schemes cannot
provide.

---

**Next step:** [interview.md](./interview.md) — tiered interview questions and a
full protect + retire + scan coding challenge for a Treiber-stack pop in Go, Java,
and Python.
