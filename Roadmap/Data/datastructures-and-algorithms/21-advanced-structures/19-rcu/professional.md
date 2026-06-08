# RCU (Read-Copy-Update) — Professional Level

> **Audience:** Library authors, kernel/runtime engineers, and systems architects who must reason about RCU at the level of formal correctness and hardware memory models — proving no reader ever observes freed memory, stating the exact memory-ordering requirements, choosing between RCU and hazard pointers on principled grounds, and characterizing the linearizability of read-mostly structures. Prerequisite: all earlier levels.

This document is the rigorous treatment. We prove the **grace-period safety property** (no use-after-free), enumerate the **precise memory-ordering requirements** for publish/subscribe and for reclamation, contrast **RCU vs hazard pointers** (cross-link `20-hazard-pointers`) as the two dominant safe-memory-reclamation (SMR) schemes with a quantitative trade-off analysis, and analyze the **linearizability** (and where it weakens to a weaker consistency) of RCU-protected read-mostly structures.

---

## Table of Contents

1. [The Grace-Period Safety Theorem (No Use-After-Free)](#safety-proof)
2. [Exact Memory-Ordering Requirements](#memory-ordering)
3. [The Alpha Problem and Dependency Ordering](#alpha)
4. [RCU vs Hazard Pointers — SMR Trade-off Analysis](#vs-hazard)
5. [Linearizability of Read-Mostly Structures](#linearizability)
6. [Grace-Period Detection Algorithms](#gp-detection)
7. [Composing RCU with CAS and Writers](#composing)
8. [Quantitative Cost Model and Break-Even Analysis](#cost-model)
9. [Failure Modes and Their Formal Causes](#failure-modes)
10. [Verification, Testing, and Formal Models](#verification)
11. [Wait-Freedom, Progress Guarantees, and Real-Time](#progress)
12. [Designing an RCU-Safe API Surface](#api-design)
13. [The Grace-Period Guarantee as a Happens-Before Contract](#hb-contract)
14. [Reference Implementation of the Four Invariants](#reference-impl)

---

<a name="safety-proof"></a>
## 1. The Grace-Period Safety Theorem (No Use-After-Free)

The single correctness obligation of any RCU implementation is: **no reader ever dereferences a freed object.** We state and prove it.

### 1.1 Definitions

- A reader's **read-side critical section** is the half-open interval `[L, U)` between its `rcu_read_lock()` at time `L` and `rcu_read_unlock()` at time `U`.
- An object `O` is **unpublished** at time `t_remove` when the last reachable pointer to `O` from the published structure is overwritten (e.g., the delete's `rcu_assign_pointer`). After `t_remove`, no reader entering a new section can obtain a reference to `O`.
- A **grace period** `GP(t)` started at `t` ends at `e(t)`, the earliest time by which **every CPU has been in a quiescent state at least once within `(t, e(t)]`**.
- The reclamation rule: free `O` only at or after `e(t_remove)`.

### 1.2 The Fundamental Property of RCU

> **Lemma (no reference across a quiescent state).** A read-side critical section contains no quiescent state. Equivalently: if a CPU is observed quiescent at time `q`, then no read-side section that was active on that CPU before `q` is still active at `q`.

This is *guaranteed by construction*: in classic RCU, `rcu_read_lock` disables preemption, so the section cannot be interrupted by the events that constitute quiescent states (context switch, return to user, idle); the section therefore must end before any such event. In SRCU/preemptible variants, the per-CPU/per-task counters make the quiescent-state detector account for any still-open section, so a "quiescent" report is issued only when no section is open. Either way the lemma holds.

### 1.3 Theorem and proof

> **Theorem (grace-period safety).** If `O` is unpublished at `t_remove` and freed no earlier than `e(t_remove)`, then no reader dereferences `O` after it is freed.

**Proof.** Take any reader `R` with section `[L, U)` that holds a reference to `O`. There are two cases for `L` relative to `t_remove`.

*Case 1: `L ≥ t_remove`.* After `t_remove`, `O` is unreachable from the published structure (by definition of unpublish). A reader entering at `L ≥ t_remove` can only obtain references reachable from the published structure at `L`, which excludes `O`. So `R` cannot hold a reference to `O` — contradiction. Hence no such reader exists.

*Case 2: `L < t_remove`.* `R`'s section was open *before* `t_remove`, on some CPU `c`. Consider the grace period `GP(t_remove)` ending at `e(t_remove)`. By definition, CPU `c` was observed quiescent at some `q ∈ (t_remove, e(t_remove)]`. By the Lemma, `R`'s section — open before `q` on `c` — must have ended by `q`; i.e. `U ≤ q ≤ e(t_remove)`. Therefore `R` has exited its section by `e(t_remove)`, the earliest time `O` may be freed. So `R` does not dereference `O` after the free. ∎

The proof shows precisely *why* the conservative "wait for all CPUs quiescent" suffices: it upper-bounds the exit time `U` of **every** pre-existing reader by `e(t_remove)`, the reclamation point. RCU never identifies *which* readers held `O`; it only needs the bound.

### 1.4 Corollary: pure additions need no grace period

If an update only *adds* reachability (insert) and removes nothing, there is no `O` being freed, so no grace period is required for safety. Grace periods are needed exactly when reclaiming previously published memory.

---

<a name="memory-ordering"></a>
## 2. Exact Memory-Ordering Requirements

Safety (no use-after-free) is necessary but not sufficient; a reader must also see a **fully initialized** object and a **consistent** view. These are memory-ordering requirements, separate from the grace-period argument.

### 2.1 Publish — release ordering

The writer performs: initialize `O`'s fields (a set of stores `W_init`), then publish the pointer (store `W_pub`). Requirement:

> **R1 (publish/release).** `W_pub` must be a **release** store: every store in `W_init` happens-before `W_pub`, and any thread that observes the value written by `W_pub` also observes all of `W_init`.

Without R1, a weakly ordered CPU may make `W_pub` globally visible before some `W_init`, and a subscriber that loads the new pointer could read an uninitialized field. `rcu_assign_pointer` is exactly a release store (`smp_store_release`). In Go, `atomic.Pointer.Store`; in Java, a `volatile`/`AtomicReference` write or final-field publication.

### 2.2 Subscribe — dependency (consume) ordering

The reader performs: load the pointer (`R_sub`), then read fields through it (loads `R_use`, which are **address-dependent** on `R_sub`). Requirement:

> **R2 (subscribe/consume).** `R_sub` must establish **dependency ordering**: every load in `R_use` that is data-dependent on the value loaded by `R_sub` must observe memory at least as recent as the release `W_pub` that produced that value.

On all mainstream architectures (x86, ARMv8, POWER) the hardware **honors address dependencies automatically** — if `R_use` computes its address from `R_sub`'s result, the CPU will not reorder `R_use` before `R_sub`. So `rcu_dereference` compiles to a **plain load** plus a compiler barrier preventing the *compiler* from breaking the dependency. This is the deep reason RCU reads are free: R2 is satisfied by the data dependency itself, needing no hardware fence.

### 2.3 Reclamation — full grace-period ordering

> **R3 (reclaim ordering).** The free of `O` must not be reordered before the completion of `GP(t_remove)`. The grace-period primitive (`synchronize_rcu`/`call_rcu` machinery) carries the necessary full memory barriers so that all readers' final accesses to `O` happen-before the free.

Internally, grace-period detection includes barriers ensuring that a CPU's quiescent-state report happens-after all that CPU's prior read-side accesses, and that the writer's free happens-after observing all reports. This is what makes the Theorem's timeline (`U ≤ e(t_remove) ≤ free`) hold not just in wall-clock time but in the happens-before order.

### 2.4 Summary of the four ordering edges

```
W_init  --(release)-->  W_pub          (R1: writer publishes initialized object)
W_pub   --(dep)------>  R_sub --> R_use (R2: reader sees init via dependency)
R_use   --(happens-before)--> CPU quiescent report --> GP ends   (R3 part 1)
GP ends --(happens-before)--> free(O)                            (R3 part 2)
```

Chained: `W_init → W_pub → R_use` (reader sees a valid object) and `R_use → free` (no use-after-free). Both chains must hold; R1+R2 give the first, the grace period + R3 give the second.

| Operation | Required ordering | x86 | ARMv8 | Primitive |
|---|---|---|---|---|
| Publish | release | plain store | `STLR` / `DMB`+store | `rcu_assign_pointer` |
| Subscribe | consume/dependency | plain load | plain load (dep) | `rcu_dereference` |
| Reclaim | full barrier in GP machinery | in GP code | in GP code | `synchronize_rcu`/`call_rcu` |

---

<a name="alpha"></a>
## 3. The Alpha Problem and Dependency Ordering

A famous wrinkle: the **DEC Alpha** CPU could violate R2's "free" dependency ordering. Alpha had split caches and could, in rare cases, return a **stale value** for a dependent load even though the pointer load saw the new pointer — because a dependent load could be satisfied from a cache bank that hadn't yet seen the field's update. Alpha is the only mainstream architecture that did *not* honor address dependencies for free.

The historical fix was `smp_read_barrier_depends()` inside `rcu_dereference`, a **read-dependency barrier** that is a true no-op on every architecture *except* Alpha. Modern Linux (post-2018) removed Alpha's special case by folding the barrier into `READ_ONCE`/`rcu_dereference` and ultimately deprecating the separate macro, since Alpha support waned. The lesson for a professional: **dependency ordering is "free" only because virtually all hardware respects address dependencies; one architecture proved it is a hardware *guarantee*, not a law of nature.** When porting RCU to an exotic ISA, verify that loads dependent on a pointer observe the pointed-to memory consistently, or insert the dependency barrier.

This is also why C/C++'s `memory_order_consume` is contentious: compilers struggle to track dependency chains through arbitrary code without conservatively upgrading `consume` to `acquire` (which adds a fence). The kernel sidesteps the language model and relies on the documented hardware behavior plus `READ_ONCE` to preserve dependencies, which is why `rcu_dereference` stays a plain load in practice.

---

<a name="vs-hazard"></a>
## 4. RCU vs Hazard Pointers — SMR Trade-off Analysis

RCU and **hazard pointers** (HP, cross-link `20-hazard-pointers`) are the two dominant **safe memory reclamation (SMR)** schemes for lock-free/read-mostly structures. They solve the same core problem — "when is it safe to free a node a reader might still hold?" — with opposite strategies.

### 4.1 The mechanisms contrasted

- **RCU:** readers announce **nothing per-object**; they mark a coarse critical section. Reclamation waits for a **grace period** (all readers' sections to end). Reclamation is **deferred and batched**; memory is bounded by *time* (grace-period length × write rate), not by a fixed count.
- **Hazard pointers:** each reader **publishes the specific pointer(s)** it is currently dereferencing into a per-thread "hazard" slot, with a *store + full fence* on the read path. A writer wanting to free `O` scans all threads' hazard slots; if none names `O`, it frees `O` immediately; otherwise it defers `O` to a retry list. Memory is bounded by a **fixed number of objects** (≈ threads × hazards-per-thread + retired list cap).

### 4.2 Trade-off table

| Dimension | RCU | Hazard Pointers |
|---|---|---|
| Read-side cost | ~free (plain load, no fence on mainstream HW) | a store to a hazard slot **plus a full memory fence** per protected pointer |
| Read scalability | linear; no shared writes | each reader writes its own slot (no contention) but pays a fence |
| Memory bound | **time-bounded** (unbounded in principle; grows with GP length × write rate) | **count-bounded** (deterministic max retired objects) |
| Reclamation latency | a full grace period | as soon as no hazard names the object (often immediate) |
| Per-object overhead | one `rcu_head` (deferred); none per reference | one hazard slot per concurrently held pointer |
| Writer scan cost | none (waits for GP) | O(threads × hazards) scan per reclamation (or batched) |
| Best when | read-mostly, reads must be *absolutely* cheap, memory headroom exists | memory must be tightly bounded; reads can afford a fence; long-lived references |
| Blocking readers | classic: no; SRCU: yes | yes (a held hazard pointer is fine indefinitely) |
| Number of protected pointers | unbounded (whole section) | bounded by hazard slots per thread |

### 4.3 The crux of the choice

The decision reduces to **which resource you must bound**:

- **Bound memory ⇒ hazard pointers.** HP guarantees at most a fixed number of unreclaimed objects regardless of write rate, because a writer can free as soon as no hazard names the object. This is essential for memory-constrained or adversarial environments (an attacker can't force unbounded backlog as they can with `call_rcu`).
- **Bound read cost ⇒ RCU.** RCU's read path has **no store and no fence** on mainstream hardware; HP's read path requires a store-then-fence per dereference, which on a hot path can cost tens of cycles and limits scaling for pointer-chasing reads. For per-packet routing lookups or per-syscall dcache walks, RCU's free reads dominate.

A useful heuristic: **RCU trades memory for read speed; hazard pointers trade read speed for memory determinism.** Systems with ample RAM and brutal read rates (kernels, routers) pick RCU; systems with hard memory caps or unbounded write bursts (some lock-free libraries, embedded) pick HP. Hybrid schemes (e.g., epoch-based reclamation, or RCU with bounded backlog falling back to expedited GPs) sit between them.

### 4.4 A note on epoch-based reclamation (EBR)

EBR is essentially "RCU with an explicit global epoch counter": readers pin the current epoch; reclamation of objects retired in epoch `e` waits until all readers have advanced past `e` (two epochs). It shares RCU's free-ish reads and time-bounded memory; it's the scheme used by many lock-free libraries (e.g., crossbeam in Rust). Conceptually it is RCU with application-managed epochs rather than scheduler-derived quiescent states.

---

<a name="linearizability"></a>
## 5. Linearizability of Read-Mostly Structures

Is an RCU-protected structure **linearizable** — does every operation appear to take effect atomically at some point between its invocation and response, consistent with a sequential history?

### 5.1 The publish as a linearization point

A single RCU update with one `rcu_assign_pointer` has a clean **linearization point**: the instant the release store becomes globally visible. Before that instant the structure is in the old state for *all* observers; after it, the new state. Two updates serialized by the writer lock linearize in the order of their publish stores. So an RCU map/list with single-pointer publishes and writer-serialized updates is **linearizable for writes**, and each **read linearizes at its subscribe load** (`rcu_dereference`): the read returns the state published at or before its subscribe instant.

### 5.2 Where it weakens: stale-but-consistent reads

The subtlety is what "the latest" means for a reader. A reader whose subscribe load happens at time `s` returns the version published most recently *as of `s`*. If an update publishes at `s + ε`, the reader does **not** observe it — even though the read *response* may come after `s + ε`. Is this linearizable?

It **is** linearizable: the read's linearization point is its subscribe `s`, which lies within `[invocation, response]`. The read "took effect" at `s`, returning the then-current state. A concurrent update that linearizes after `s` is simply ordered after the read in the linear history. So a single RCU read is linearizable.

What RCU does **not** provide is the stronger illusion that a read reflects every write that *completed in wall-clock time before the read's response*. That is fine — linearizability only requires consistency with *some* legal ordering where each op's point is in its interval, not with wall-clock completion of overlapping ops.

### 5.3 Where it genuinely weakens: multi-pointer / multi-step reads

A traversal that performs **multiple** `rcu_dereference` loads over a section (e.g., walking a list) can observe a structure mutated *between* its loads — unless the design guarantees each node's snapshot is internally consistent. Consider a writer that, in one logical update, deletes node B and inserts node C: if these are two separate publishes, a reader mid-traversal might see neither, B-only, C-only, or both. To keep multi-step reads linearizable, the writer must make the logically-atomic change a **single publish** — typically by swapping one top-level pointer to a new immutable aggregate (the whole new list/tree root), so the reader subscribes once and sees one coherent version. This is the design discipline that preserves linearizability: **funnel each logically atomic update through a single published pointer.**

### 5.4 Consistency taxonomy for RCU structures

| Design | Read consistency | Linearizable? |
|---|---|---|
| Single top-level pointer to immutable aggregate; writer-serialized | Each read sees one whole consistent version | **Yes** (publish = lin. point, subscribe = read point) |
| Multi-pointer structure, each logical update = one publish | Consistent per logical update | **Yes** |
| Multi-pointer structure, logical update spread over several publishes | Reader may see intermediate states | **No** — only per-publish consistency |
| RCU read combined with a "must see latest" requirement | Reader may be one version stale | **Linearizable, but not the stronger "real-time latest"** |

### 5.5 The practical statement

> An RCU-protected read-mostly structure is **linearizable** provided (a) each logically atomic update is committed by a single release publish (one pointer), (b) writers are serialized so publishes are totally ordered, and (c) readers subscribe once per logical view. The "staleness" of RCU is **not** a linearizability violation — each read linearizes at its subscribe instant — it is the (correct) absence of a stronger real-time guarantee that overlapping later writes be observed.

---

<a name="gp-detection"></a>
## 6. Grace-Period Detection Algorithms

How does the runtime actually detect `e(t)`? The three families:

1. **Quiescent-state-based (classic kernel, liburcu QSBR).** A central grace-period kthread/engine waits for each CPU/thread to report a quiescent state (context switch, or explicit `rcu_quiescent_state()`). When all have reported after the GP request, the GP ends. Reads are free; the cost is the engine's polling and the per-CPU quiescent reporting that piggybacks on existing events. Tree-RCU organizes CPUs into a hierarchy (`rcu_node` tree) so quiescent-state aggregation scales to thousands of CPUs without a single contended counter.

2. **Counter/epoch-based (EBR, liburcu memory-barrier flavor).** A global epoch counter; readers snapshot it on entry (with a fence). Reclamation waits until all readers have been seen in a newer epoch. Memory time-bounded; reads cost one fence.

3. **Expedited.** Force the GP by sending IPIs to all CPUs, making them report quiescent immediately. Cuts GP latency from milliseconds to microseconds at the cost of interrupting every CPU — used when a writer needs prompt reclamation.

The professional concern is the **scalability of detection**: a naive single shared counter for quiescent states would itself ping-pong across cores. Tree-RCU's hierarchical `rcu_node` structure and per-CPU state are what let grace-period detection scale to 4096-CPU machines without reintroducing the contention RCU exists to avoid.

---

<a name="composing"></a>
## 7. Composing RCU with CAS and Writers

RCU protects **readers and reclamation**; it does **not** order **writers**. Three composition patterns:

1. **Single writer / serialized writers (most common).** A mutex around the write path. Publishes are totally ordered; linearizability per §5 holds. Simple and correct.

2. **Lock-free writers via CAS (cross-link `15-cas-atomic-primitives`).** Multiple writers race to publish using compare-and-swap on the top-level pointer: read `old`, build `new = f(old)`, `CAS(ptr, old, new)`; on failure, retry with the new `old`. This yields lock-free *writers* layered on RCU *readers*. The retired `old` from a successful CAS is reclaimed via grace period. Care: the ABA problem (cross-link 15/20) — RCU sidesteps classic ABA because a reclaimed pointer's memory can't be reused until after a grace period, so a reader can't observe a recycled address mid-section; this is one reason RCU/EBR pairs naturally with CAS-based lock-free structures.

3. **RCU for readers + hazard pointers / refcounts for long-lived references.** When a reader needs to *retain* a reference beyond its section (escape the critical section), pure RCU is insufficient (the reference would dangle after the next GP). The pattern is: inside the section, `rcu_dereference` and then **acquire a refcount** (atomically, guarding against concurrent drop-to-zero with `refcount_inc_not_zero`); now the object is pinned independent of RCU and can be used after `rcu_read_unlock`. This composes RCU's cheap lookup with refcount's long-lived pinning — the standard kernel idiom for "look up cheaply, then hold."

```
rcu_read_lock()
p = rcu_dereference(gPtr)
if !try_get_ref(p):          // someone is freeing it; treat as not-found
    rcu_read_unlock(); return MISS
rcu_read_unlock()
... use p beyond the section, protected by the refcount ...
put_ref(p)                   // may trigger reclamation when count hits 0
```

---

<a name="cost-model"></a>
## 8. Quantitative Cost Model and Break-Even Analysis

To decide *when* RCU pays off, model the costs explicitly. Let:

- `r` = read rate (reads/sec), `w` = write rate (writes/sec), `P` = core count.
- `c_R^rcu` = per-read cost under RCU ≈ one plain load ≈ a few cycles, **independent of `P`** (no shared write, no contention).
- `c_R^rw` = per-read cost under an rwlock ≈ two atomics + a contended cache line. Under contention this grows roughly with `P` because the reader-count line ping-pongs: `c_R^rw ≈ a + b·P` for constants `a, b` (the linear term is the coherence traffic).
- `c_W^rcu` = per-write cost under RCU ≈ copy cost `K` + publish + (amortized) grace-period share `g`. With structural sharing, `K ≈ O(log n)`.
- `c_W^rw` = per-write cost under an rwlock ≈ in-place mutation under the exclusive lock ≈ small, but it *blocks all readers* for its duration.

### 8.1 Read-side throughput

Total read cost per second: RCU = `r · c_R^rcu` (flat in `P`); rwlock = `r · (a + b·P)` (rises with cores). On `P = 64` cores at `r = 10^7 reads/sec`, the rwlock's `b·P` term dominates and read throughput **saturates**, while RCU's stays flat. This is the empirical 2×–10× win reported in kernel benchmarks — it is not a constant-factor tweak but an **asymptotic difference in `P`**.

### 8.2 The break-even ratio

RCU wins overall when the read savings exceed the extra write cost:

```
r · (c_R^rw − c_R^rcu)   >   w · (c_W^rcu − c_W^rw)
```

Define the read:write ratio `ρ = r / w`. RCU wins when:

```
ρ  >  (c_W^rcu − c_W^rw) / (c_R^rw − c_R^rcu)
```

The numerator (extra per-write cost: copy + grace period) is large; the denominator (per-read saving) is modest per-read but **scales with `P`** via the contention term. So the break-even `ρ` **falls as core count rises** — the more cores, the lower the read:write ratio at which RCU becomes worthwhile. On a single core, RCU rarely beats a lock; on 64 cores it wins even at modest read dominance.

### 8.3 Memory cost as a function of write rate

With `call_rcu`, outstanding (retired-but-unreclaimed) memory is bounded by `w · T_gp · S`, where `T_gp` is the grace-period latency and `S` is the per-version size. This is the **time-bounded** memory characteristic: it grows with write rate and grace-period length, *not* with a fixed count (contrast hazard pointers' count bound `P · H · S`, with `H` hazards per thread). The two memory bounds cross at `w · T_gp = P · H`; above that write rate, RCU holds more memory than HP would.

| Quantity | RCU | rwlock | Hazard pointers |
|---|---|---|---|
| Per-read cost | O(1), flat in P | O(1)+contention (rises with P) | O(1) + one fence |
| Read scaling | linear in P | saturates | linear (own slot) but fence-limited |
| Per-write cost | copy + GP share | in-place under lock | copy/CAS + scan |
| Outstanding memory | `w·T_gp·S` (time-bounded) | 0 | `P·H·S` (count-bounded) |
| Break-even improves with P? | yes | — | yes |

### 8.4 Worked example

Routing table, `n = 10^5` entries, `P = 32` cores, `r = 5·10^6` lookups/sec, `w = 50` route changes/sec, structural sharing so `K ≈ 17` node-copies/write, `T_gp ≈ 1 ms`, `S ≈ 1 KB`/version.

- RCU outstanding memory ≈ `50 × 0.001 × 1 KB = 0.05 KB` average — negligible. Even a 100× write burst is 5 KB. Memory is a non-issue here.
- Read scaling: flat — all 32 cores do lock-free lookups. An rwlock here would bottleneck on the reader count at this read rate.
- Break-even `ρ`: with `ρ = r/w = 10^5 ≫ break-even`, RCU is overwhelmingly correct. The model confirms intuition: extreme read dominance + many cores ⇒ RCU.

---

<a name="failure-modes"></a>
## 9. Failure Modes and Their Formal Causes

Each classic RCU failure maps to violating one premise of the safety theorem or an ordering requirement. Knowing the mapping makes debugging principled.

### 9.1 Use-after-free → R3 / theorem premise violated

**Symptom:** reader dereferences freed memory; crash or corruption under load.
**Formal cause:** the object was freed before `e(t_remove)` (the grace period was skipped or shortened), so Case 2 of the theorem's bound `U ≤ e(t_remove)` no longer holds.
**Fix:** ensure a full grace period (or refcount pinning) between unpublish and free. In managed languages, ensure no path drops the reference prematurely or stashes a raw pointer past GC's view.

### 9.2 Reader observes uninitialized fields → R1 violated

**Symptom:** reader loads the new pointer but reads garbage/default field values.
**Formal cause:** publish was not a release store, so `W_init` did not happen-before `W_pub`; a subscriber observed `W_pub` without `W_init`.
**Fix:** publish via `rcu_assign_pointer` / `atomic.Store` / `AtomicReference.set` (release).

### 9.3 Reader reads stale field despite new pointer → R2 violated (the Alpha case)

**Symptom:** rare, architecture-specific stale dependent reads.
**Formal cause:** dependency ordering not preserved (compiler broke the dependency, or Alpha-class hardware).
**Fix:** `rcu_dereference` / `READ_ONCE` to forbid the compiler from breaking the dependency; rely on hardware address-dependency ordering elsewhere.

### 9.4 RCU stall / grace period never ends → Lemma premise violated

**Symptom:** memory grows without bound; `synchronize_rcu` never returns; kernel logs "RCU stall."
**Formal cause:** a reader is blocked/sleeping inside a (non-sleepable) read-side section, so its CPU never reaches a quiescent state; `e(t_remove)` is unbounded.
**Fix:** never block in classic/preemptible sections; use SRCU if the section must sleep; keep sections short.

### 9.5 Lost update → writers not serialized (orthogonal to RCU)

**Symptom:** a concurrent update vanishes after two writers race.
**Formal cause:** RCU does not order writers; two `read-modify-publish` sequences interleaved and one publish overwrote the other.
**Fix:** serialize writers (mutex) or use a CAS loop so a writer detects and retries on a concurrent publish.

### 9.6 Non-linearizable multi-step read → multi-publish update

**Symptom:** a reader observes a logically-impossible intermediate state.
**Formal cause:** a single logical update was committed via several publishes (§5.3); the reader subscribed between them.
**Fix:** funnel each logically atomic change through one aggregate publish.

### 9.7 call_rcu backlog OOM → reclamation rate < retirement rate

**Symptom:** memory balloons under a write storm.
**Formal cause:** `w · T_gp` exceeds the system's tolerable outstanding-memory bound (§8.3); callbacks queue faster than grace periods drain them.
**Fix:** rate-limit writes, expedite grace periods, or fall back to synchronous `synchronize_rcu` (back-pressure) above a backlog threshold.

---

<a name="verification"></a>
## 10. Verification, Testing, and Formal Models

RCU's subtlety (memory ordering + concurrency + deferred reclamation) makes it a prime target for rigorous verification. Professionals should know the tooling.

### 10.1 Stress testing — rcutorture and race detectors

The kernel ships **`rcutorture`**, a stress module that hammers RCU with concurrent readers/writers/updaters across flavors and checks invariants (e.g., a value read inside a section must not be reclaimed). In userspace, run reader/writer stress under **ThreadSanitizer** (Go `-race`, C/C++ TSan) to catch missing ordering and use-after-free. The key invariant to assert: **a value or object obtained inside a read-side section is never freed/mutated before the section ends.**

### 10.2 Model checking — litmus tests and the LKMM

The **Linux Kernel Memory Model (LKMM)**, with the `herd7`/`klitmus` tools, lets you write **litmus tests** — tiny multi-thread programs with assertions about which final states are allowed — and exhaustively check them against the formal memory model. RCU's publish/subscribe is the canonical "message passing" (MP) litmus test:

```
P0 (writer):                 P1 (reader):
  WRITE_ONCE(data, 42);        r1 = rcu_dereference(ptr);
  rcu_assign_pointer(ptr,&data); r2 = (r1 ? *r1 : 0);
exists (1:r1=&data /\ 1:r2=0)  // must be FORBIDDEN
```

A correct model forbids `r1 = &data ∧ r2 = 0` (seeing the new pointer but the stale data). Running this under `herd7` proves the release/dependency ordering is sufficient on the modeled architecture. The LKMM additionally formalizes RCU's **grace-period guarantee** with `rcu_read_lock`/`unlock`/`synchronize_rcu` axioms, so you can model-check reclamation-ordering claims, not just publish/subscribe.

### 10.3 What to verify in your own RCU code

| Property | How to check |
|---|---|
| No use-after-free | TSan/ASan stress; assert "read value never reclaimed before section end" |
| Publish ordering (R1) | MP litmus test; ensure release store on publish |
| Dependency ordering (R2) | use `rcu_dereference`/atomic load; litmus on weak-memory model |
| Writers serialized | invariant: final state contains all writes (no lost update) |
| Single-publish linearizability | model the update; assert no intermediate observable state |
| Bounded backlog | monitor outstanding-version count under write bursts |

### 10.4 The discipline

A professional treats RCU code as **memory-ordering-critical** and **concurrency-critical** simultaneously: every published pointer is release-stored and dependency-loaded, every reclamation is gated by a proven grace period (or refcount), writers are serialized, and the whole thing is validated by both **adversarial stress testing** (to find use-after-free and torn reads empirically) and, where stakes are high, **formal litmus checking** (to prove the ordering against the architecture's memory model). The two together — empirical and formal — are how the kernel keeps RCU correct across thousands of call sites and every supported ISA.

---

<a name="progress"></a>
## 11. Wait-Freedom, Progress Guarantees, and Real-Time

A precise classification of RCU's progress properties matters for real-time and high-assurance systems.

### 11.1 The progress hierarchy

Recall the standard non-blocking hierarchy:

- **Wait-free:** every thread completes its operation in a bounded number of its own steps, regardless of other threads. Strongest.
- **Lock-free:** *some* thread always makes progress (system-wide progress guaranteed), but an individual thread can be starved.
- **Obstruction-free:** a thread completes if it runs in isolation.
- **Blocking:** a thread can be stalled indefinitely by another (e.g., a lock holder being descheduled).

### 11.2 Where RCU sits

- **RCU readers are wait-free.** A read-side critical section executes a bounded number of steps (subscribe + traverse) with no loop, no CAS retry, no spin, and cannot be blocked by any writer or reader. This is the strongest possible guarantee and is *the* reason RCU is favored on real-time and per-packet paths: reader latency has a hard upper bound.
- **RCU writers are *blocking* in the classic serialized design** (they take a writer mutex) or **lock-free** if they use a CAS-retry publish loop (§7). Even lock-free writers, though, **block on the grace period** for *reclamation* — `synchronize_rcu` is a blocking wait. So the *publish* can be lock-free, but *reclamation completion* is not wait-free; it depends on readers reaching quiescent states.
- **Grace-period completion is not bounded in general.** A misbehaving reader (stuck in a section) can delay it unboundedly — which is exactly the RCU-stall failure mode. Real-time RCU (preemptible flavor) bounds reader-induced delay by making sections preemptible and using priority boosting so a low-priority reader holding up a grace period gets boosted to run and exit.

### 11.3 The real-time tension and its resolution

Classic RCU disables preemption in read-side sections — great for grace-period detection (any context switch is quiescent) but bad for real-time, because a long read-side section delays a high-priority task. Preemptible RCU resolves this: sections are preemptible, and **RCU priority boosting** temporarily raises the priority of a reader that is blocking a grace period so it runs and exits promptly. The cost is heavier grace-period bookkeeping. The professional takeaway: **reader wait-freedom is preserved across flavors; what changes is how the system bounds the *grace period's* dependence on reader scheduling.**

| Property | Classic RCU | Preemptible RCU | SRCU |
|---|---|---|---|
| Reader progress | wait-free, non-preemptible | wait-free, preemptible | wait-free, may sleep |
| Reader latency under high-prio task | can delay it (no preempt) | bounded (preemptible + boost) | bounded per-domain |
| Grace-period bound | scheduler-driven | priority-boost-bounded | per-domain counters |
| Real-time fit | poor | good | good (sleepable) |

---

<a name="api-design"></a>
## 12. Designing an RCU-Safe API Surface

When you expose an RCU-protected structure as a library, the API itself must make misuse hard. Principles:

### 12.1 Hand out immutable snapshots, never mutable references

`Read()` should return a value the caller **cannot** mutate to corrupt the shared state — an immutable snapshot (Go: a pointer to a struct the caller is contracted not to write; Java: an immutable class with `final` fields and unmodifiable collections; Rust: `Arc<T>` with `T: !Mut`). If the language can enforce immutability (Rust, or Java with truly immutable types), do so; if not (Go), document the contract loudly and consider returning copies of mutable sub-fields.

### 12.2 Scope the reference to the critical section

In unmanaged settings, the API should make it structurally hard to use a reference after the section ends. A common idiom is a **closure-based** read API:

```
registry.WithSnapshot(func(snap *Snapshot) {
    // snap is valid only inside this callback (the read-side section)
    use(snap)
})  // section ends when the callback returns; snap must not escape
```

This pins the section's lifetime to the callback and prevents the "use after `rcu_read_unlock`" bug by construction. For references that must escape, provide an explicit `Acquire()` returning a refcounted handle (the escape pattern from §7) with a `Release()`.

### 12.3 Make updates atomic by construction

Expose update methods that perform the **whole** copy-modify-publish internally and serialize writers themselves, so callers cannot accidentally do a non-atomic two-publish update. Prefer `update(transform func(old) new)` over separate `setX` / `setY` that each publish. If multiple fields must change atomically, the transform produces one new aggregate, published once — enforcing the single-publish linearizability rule (§5.3).

### 12.4 Encapsulate reclamation

Callers should never call `free`/`synchronize_rcu` directly. The library owns reclamation (GC in managed languages, or an internal `call_rcu`/epoch engine with backlog limits) so that the safety theorem's premise — free only after a grace period — is guaranteed by the implementation, not by every caller remembering to wait.

### 12.5 A checklist for the API author

```
[ ] Read() returns an immutable / contractually-read-only snapshot
[ ] References are section-scoped (closure API) or refcount-escapable
[ ] Update() does copy+modify+publish atomically and serializes writers internally
[ ] Multi-field updates funnel through a single aggregate publish (linearizable)
[ ] Reclamation is owned by the library (GC / bounded call_rcu), never the caller
[ ] Publish uses release; subscribe uses an atomic load with dependency ordering
[ ] Backlog is bounded with back-pressure under write bursts
[ ] Concurrent reader+writer stress test runs under a race detector in CI
```

An RCU API designed this way lets ordinary application engineers get the read-mostly performance of RCU without needing to understand grace periods or memory ordering — the dangerous parts are sealed inside the library, exactly as the kernel seals them behind `rcu_read_lock`/`rcu_dereference`/`synchronize_rcu`.

---

<a name="hb-contract"></a>
## 13. The Grace-Period Guarantee as a Happens-Before Contract

The cleanest formal statement of RCU's reclamation safety is in terms of the **happens-before** relation, which subsumes both the timing argument (§1) and the ordering argument (§2) into one contract.

### 13.1 The contract

RCU's `synchronize_rcu` provides the following happens-before guarantee:

> For any RCU read-side critical section `C` and any `synchronize_rcu()` call `G`, **either** `G` happens-after every memory access in `C` (if `C` started before `G`'s grace period began), **or** `C` happens-after `G` returns (if `C` started after). There is no "concurrent" case in which `G` returns while `C`'s accesses are unordered with respect to it.

In symbols, with `→` denoting happens-before: for every access `a ∈ C`, either `a → return(G)` or `invoke(G) → a` (where the latter implies `C` saw the post-`G` published state). This is the formal core: **`synchronize_rcu` partitions all read-side sections into "before me" and "after me," with no overlap.**

### 13.2 Why this gives reclamation safety, restated

Consider the delete sequence: `rcu_assign_pointer(ptr, new)` (unpublish `old`) ; `synchronize_rcu()` (= `G`) ; `free(old)`. Any reader `C` that accessed `old` must have started before `G`'s grace period (a reader starting after the unpublish cannot reach `old`). By the contract, `G` happens-after every access in `C`. Since `free(old)` is program-ordered after `G` returns, we get `(accesses in C) → return(G) → free(old)`. Therefore every reader access to `old` happens-before its free — **the definition of no use-after-free**, now as a happens-before chain rather than a wall-clock argument. The two views (timing in §1, happens-before here) are equivalent; the happens-before form is the one that composes with the language/kernel memory model and is what `herd7`/LKMM actually check.

### 13.3 The dual barrier inside synchronize_rcu

For the contract to hold, `synchronize_rcu` must carry **two** memory barriers: one ensuring that readers' accesses (which happened before they reported quiescent) are visible to the writer, and one ensuring the writer's post-`G` actions (the free) are ordered after observing all quiescent reports. Concretely the grace-period engine includes full memory barriers around the quiescent-state aggregation, so that:

```
reader access  →  reader's quiescent report  →  GP engine observes all reports  →  G returns  →  free
       \_______________ happens-before chain (the §13.1 contract) ________________/
```

Missing either barrier breaks the contract: without the first, the writer might free while a reader's last write to `old` is still in a store buffer; without the second, the compiler/CPU could hoist the `free` before the grace period completes. This is why **you must use the provided `synchronize_rcu`/`call_rcu` primitives** and never approximate a grace period with a plain sleep or a bare counter — only the real primitive carries both barriers.

### 13.4 Implication for custom (epoch / liburcu) implementations

When you implement epoch-based reclamation yourself, the §13.1 contract is your correctness specification. Your epoch-advance and reclamation logic must establish the same happens-before partition: a reader pinning epoch `e` must have its accesses ordered before the reclamation of objects retired in epoch `< e - 1`, with full fences at the pin and at the reclamation scan. Verifying *that* — typically with litmus tests against the LKMM or a TLA+/Coq model — is the difference between an epoch reclaimer that works and one that has a one-in-a-billion use-after-free under weak memory.

### 13.5 Why "just sleep a bit" is not a grace period

A tempting but wrong shortcut: instead of `synchronize_rcu`, "sleep 10 ms — surely all readers finished by then." This is unsound for two reasons grounded in §13.1–13.3:

1. **No happens-before edge.** A wall-clock sleep establishes *no* memory-ordering relationship between a reader's accesses and the subsequent free. Even if every reader has finished in real time, the writer may not have *observed* their final writes (they could still sit in store buffers / unflushed caches), so the free can race a reader's last access at the memory-model level. The §13.1 contract requires barriers, which a sleep does not provide.
2. **No bound on reader duration.** A reader can, in principle, be descheduled for longer than your sleep (page fault, preemption, VM pause). The grace-period engine *waits for the actual quiescent reports*; a fixed sleep gambles on a duration that an adversarial or unlucky schedule can exceed, yielding a use-after-free.

The lesson: a grace period is a **logical** condition (all pre-existing readers observed quiescent, with the requisite barriers), not a **temporal** one (enough time elapsed). Only the real primitive — or a correctly-fenced epoch scheme — implements the logical condition. This is exactly why the kernel and liburcu invest so heavily in grace-period machinery instead of approximating it with timers.

### 13.6 Putting the formal pieces together

The complete correctness of an RCU-protected reclaiming structure decomposes into independent obligations, each proven by a distinct argument:

| Obligation | Guarantees | Established by | Section |
|---|---|---|---|
| No use-after-free (timing) | freed object unreferenced by all readers | grace-period safety theorem (quiescent-state bound) | §1 |
| No use-after-free (ordering) | reader accesses happen-before free | happens-before contract + GP barriers | §13.1–13.3 |
| Reader sees initialized object | no torn/garbage fields | publish release (R1) | §2.1 |
| Reader sees consistent dependent reads | no stale field via fresh pointer | subscribe dependency/consume (R2) | §2.2, §3 |
| No lost writer update | every update survives | writer serialization (lock or CAS) | §7, §9.5 |
| Linearizable view | one coherent version per logical read | single aggregate publish, total publish order | §5 |
| Bounded memory | no unbounded backlog | rate-limit / back-pressure on reclamation | §8.3, §9.7 |

A structure that satisfies all seven is a correct, performant, linearizable RCU structure. The discipline of a professional is to enumerate these obligations for any RCU design and discharge each one explicitly — by proof, by the right primitive, or by an operational bound — rather than trusting that "it seems to work under test." Concurrency bugs in this space are rare-but-catastrophic and frequently invisible to ordinary testing, so the formal decomposition is not academic ceremony; it is the practical checklist that prevents the one-in-a-billion crash.

### 13.7 The minimal correct RCU, distilled

If you strip RCU to the irreducible core that a professional must guarantee, it is exactly four invariants:

1. **Immutability after publish.** No store ever targets a published version. (Prevents reader-corruption races.)
2. **Single release publish per logical update; writers serialized.** (Gives linearizability and lost-update freedom.)
3. **Dependency-ordered subscribe on every followed pointer.** (Prevents stale/uninitialized reads.)
4. **Free only after a grace period (happens-before, not a timer).** (Prevents use-after-free.)

Everything else in this document — flavors, `call_rcu` batching, structural sharing, the cost model, the linearizability analysis — is engineering elaboration on top of these four. A reviewer can audit any RCU change by checking the four invariants in order; a violation of any one is a bug, and conversely satisfying all four is sufficient for a correct read-mostly RCU structure. This is the level of compression a professional should be able to apply on sight.

---

<a name="reference-impl"></a>
## 14. Reference Implementation of the Four Invariants

The happens-before chain that makes reclamation safe is worth seeing as a diagram and as code that embodies all four invariants from §13.7.

```mermaid
flowchart LR
    A["writer: init fields (W_init)"] -->|release| B["writer: publish pointer (W_pub)"]
    B -->|dependency| C["reader: subscribe load (R_sub)"]
    C --> D["reader: field reads (R_use)"]
    D -->|happens-before| E["reader quiescent report"]
    E --> F["grace period ends (G returns)"]
    F -->|happens-before| G["writer: free(old)"]
```

The chain `W_init → W_pub → R_sub → R_use → quiescent → G → free` is exactly the union of the publish/subscribe ordering (R1, R2) and the grace-period happens-before contract (§13.1). Code that realizes the invariants in each language:

**Go** — release publish, dependency subscribe, GC as grace period:
```go
type Snapshot struct{ data []int } // immutable after publish (invariant 1)

type RCU struct {
	ptr     atomic.Pointer[Snapshot] // single pointer (invariant 2)
	writeMu sync.Mutex               // writers serialized (invariant 2)
}

func (r *RCU) Read() *Snapshot { return r.ptr.Load() }          // subscribe (invariant 3)
func (r *RCU) Update(f func(old *Snapshot) *Snapshot) {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	r.ptr.Store(f(r.ptr.Load())) // single release publish (invariants 1,2)
	// GC frees the old snapshot only after no reader holds it (invariant 4)
}
```

**Java** — `AtomicReference` (release set / acquire get), immutable snapshot, GC grace period:
```java
public final class Rcu<T> {
    private final java.util.concurrent.atomic.AtomicReference<T> ref;
    private final Object writeLock = new Object();
    public Rcu(T initial) { ref = new java.util.concurrent.atomic.AtomicReference<>(initial); }
    public T read() { return ref.get(); }                       // subscribe (invariant 3)
    public void update(java.util.function.UnaryOperator<T> f) {
        synchronized (writeLock) {                              // serialized (invariant 2)
            ref.set(f.apply(ref.get()));                        // single release publish (1,2)
        }                                                       // GC reclaims old (invariant 4)
    }
}
```

**Python** — atomic name rebind under the GIL (note):
```python
import threading
class Rcu:
    def __init__(self, initial):
        self._cur = initial                # immutable snapshot (invariant 1)
        self._lock = threading.Lock()
    def read(self):                        # subscribe (invariant 3)
        return self._cur
    def update(self, f):
        with self._lock:                   # serialized (invariant 2)
            self._cur = f(self._cur)       # single rebind = publish (1,2); refcount reclaims (4)
```
**Note:** Python's GIL precludes true parallel reads, but the four invariants still hold; use Go/Java/C+liburcu for parallelism. The `Update(f)` shape — a single transform producing one new immutable snapshot, published once — structurally enforces invariants 1 and 2 (single-publish, no in-place mutation), which is why a transform-based API is the safest surface to expose (§12.3).

---

## Summary

RCU's correctness rests on a single theorem: because **a read-side section contains no quiescent state**, waiting until **every CPU is quiescent after an unpublish** upper-bounds the exit time of every pre-existing reader, so reclamation after a grace period **cannot** produce use-after-free — and pure additions need no grace period at all. Separately, the **memory-ordering** obligations are exact: **publish = release**, **subscribe = dependency/consume** (free on all mainstream hardware because address dependencies are honored — the Alpha anomaly proved this is a hardware guarantee, not automatic), and the **grace-period machinery carries the full barriers** that make the reclaim happen-after all reader accesses. Against **hazard pointers**, RCU trades **memory** (time-bounded, can backlog) for **read speed** (no store, no fence), while HP trades read speed for **deterministic, count-bounded memory** — choose by which resource you must bound. RCU structures are **linearizable** when each logically atomic update is one release publish over writer-serialized, single-subscribe reads; their "staleness" is the correct absence of a stronger real-time guarantee, not a consistency bug. Compose RCU with **serialized or CAS-based writers** (RCU's deferred reuse neutralizes classic ABA) and with **refcounts** when a reference must outlive its read-side section.

This completes the RCU track: from the read-copy-update pattern and grace-period intuition (`junior`), through grace periods / quiescent states / publish-subscribe and the rwlock comparison (`middle`), to kernel/userspace systems and flavors (`senior`), to formal safety, memory ordering, the hazard-pointer trade-off, and linearizability (`professional`). For the alternative reclamation scheme, continue to `20-hazard-pointers`; for the atomic primitive under publish, see `15-cas-atomic-primitives`; for an RCU-protected map, see `18-concurrent-hash-map`.
