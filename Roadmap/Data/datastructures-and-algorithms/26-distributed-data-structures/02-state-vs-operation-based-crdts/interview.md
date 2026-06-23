# State-based vs Operation-based CRDTs — Interview Questions

A focused question bank for distributed-systems interviews on the two canonical CRDT formulations: **state-based (CvRDT)** and **operation-based (CmRDT)**. The questions move from definitions, to the precise mathematical conditions each model demands, to the delivery and causality guarantees the network must supply, to delta-state CRDTs, and finally to the system-design tradeoffs and trick questions that separate someone who has *read* about CRDTs from someone who has *shipped* them.

If you have not yet internalized join-semilattices, idempotent merge, and the partial order on states, start with the [CRDT Fundamentals interview](../01-crdt-fundamentals/interview.md). For graded explanations of this same material see [junior](junior.md), [senior](senior.md), and [professional](professional.md).

---

## Table of Contents

- [Conceptual](#conceptual)
- [The Two Models Precisely](#the-two-models-precisely)
- [Delivery Guarantees & Causality](#delivery-guarantees--causality)
- [Delta-state CRDTs](#delta-state-crdts)
- [Tradeoffs & System Design](#tradeoffs--system-design)
- [Gotcha / Trick](#gotcha--trick)
- [Rapid-Fire](#rapid-fire)
- [Common Mistakes](#common-mistakes)
- [Tips & Summary](#tips--summary)

---

## Conceptual

### Q1: In one sentence each, what is a state-based CRDT and an operation-based CRDT? *(Easy)*

**Answer**: A **state-based CRDT (CvRDT — Convergent Replicated Data Type)** propagates updates by shipping its *whole local state* to other replicas, which then **merge** received states into their own using a commutative, associative, idempotent **join** function. An **operation-based CRDT (CmRDT — Commutative Replicated Data Type)** propagates updates by broadcasting the *operations themselves* (e.g. "increment by 3", "add element x"), which each replica applies locally; convergence holds because concurrent operations **commute**.

The mnemonic: **state-based ships values, op-based ships verbs.**

---

### Q2: Why do both models exist if they solve the same problem? *(Easy)*

**Answer**: They make opposite bets about where complexity should live.

- State-based pushes complexity into the **merge function and the payload size** but demands almost nothing of the network — it works over a gossip channel that loses, duplicates, and reorders messages.
- Op-based pushes complexity into the **messaging layer** (it needs reliable, exactly-once, causally-ordered delivery) but keeps payloads tiny (just the operation) and the per-op logic simple.

Different systems have different "cheapest resource." If you already run a reliable causal broadcast bus, op-based is attractive. If your only transport is best-effort gossip, state-based is the safer foundation.

---

### Q3: Give a canonical example data type in each model. *(Easy)*

**Answer**: A **counter**.

- **State-based G-Counter**: state is a vector of per-replica counts `[c0, c1, ..., cn]`. To increment, a replica bumps its own slot. Merge takes the **element-wise maximum** of two vectors. The value is the sum of all slots.
- **Op-based counter**: each replica broadcasts an `increment(k)` operation. Every replica applies all increments it receives. Because integer addition is commutative, order does not matter — as long as each op is delivered **exactly once**.

Note how the state-based version needs O(replicas) state, while the op-based version needs a reliable network. That contrast is the entire topic in miniature.

---

### Q4: What does "convergence" mean here, and what guarantee do CRDTs actually provide? *(Medium)*

**Answer**: CRDTs provide **Strong Eventual Consistency (SEC)**: any two replicas that have **received the same set of updates** are in the **same state**, with no need for consensus, conflict-resolution callbacks, or rollback. "Eventual" is the liveness part (updates eventually reach everyone); "strong" is the safety part (same delivered set ⇒ identical state, *deterministically*, not "some merge the application picks").

The key word is *set*. State-based reasons about the set of states merged; op-based reasons about the set of operations delivered. Neither cares about the *order* in which that set arrived (op-based cares about causal order among *dependent* ops, but not total order).

---

## The Two Models Precisely

### Q5: State the exact mathematical conditions a state-based CRDT's merge must satisfy. *(Medium)*

**Answer**: The merge (join) `⊔` together with the set of states must form a **join-semilattice**: a partial order in which every pair of elements has a least upper bound. Concretely, `⊔` must be:

1. **Commutative**: `a ⊔ b = b ⊔ a` — so the order states arrive in doesn't matter.
2. **Associative**: `(a ⊔ b) ⊔ c = a ⊔ (b ⊔ c)` — so the grouping doesn't matter.
3. **Idempotent**: `a ⊔ a = a` — so receiving the same state twice is harmless.

Additionally, every local update must be **inflationary**: it moves the state *upward* in the partial order (`s ≤ update(s)`). Together these guarantee that merging always moves both replicas toward a common least upper bound, and that lost/duplicated/reordered states can't break convergence.

---

### Q6: State the exact conditions an operation-based CRDT must satisfy. *(Medium)*

**Answer**: Two conditions:

1. **Concurrent operations commute**: if two operations are *concurrent* (neither causally precedes the other), applying them in either order yields the same state. Operations related by causality must be applied in causal order.
2. **Each operation is delivered exactly once** to each replica, in an order consistent with causality (causal delivery).

Formally, the op-based proof of SEC assumes a **reliable causal broadcast** that delivers every operation to every replica precisely once and never delivers an operation before the operations it causally depends on. Given that, commutativity of concurrent ops is sufficient for all replicas to converge.

---

### Q7: What is the "prepare / effect" split in an op-based CRDT, and why is it needed? *(Medium)*

**Answer**: An op-based operation is implemented in two phases:

- **prepare(op, state)** runs **only at the origin replica**, atomically with the user's call, against the local state. It is **side-effect-free** — it just computes a *message* to broadcast (e.g. for an OR-Set add, it picks a fresh unique tag and produces `add(element, tag)`).
- **effect(message, state)** runs at **every replica** (including the origin) when the message is delivered, and actually mutates the state.

The split exists because some decisions must be made *once, at the source*, where the causal context is known — for example minting a unique identity or capturing which elements an op observed. If that logic ran on every replica independently, replicas would mint *different* tags and diverge. Prepare centralizes the non-deterministic/contextual decision; effect is the deterministic, commutative application.

---

### Q8: Why must *concurrent* operations commute, but causally-ordered ones need not? *(Hard)*

**Answer**: Because causal delivery already pins down the order of causally-related operations — every replica applies them in the same (causal) order, so there is no ambiguity to resolve and no commutativity requirement. The only freedom the network leaves is the *relative* order of **concurrent** operations: two updates made without knowledge of each other may be delivered in different orders at different replicas. Convergence therefore demands exactly that *those* operations produce the same result regardless of order — i.e. concurrent ops commute. Requiring all ops to commute would be unnecessarily strong; requiring none to commute would be unsound. Commutativity-of-concurrent-ops is precisely the minimal condition that pairs with causal delivery.

---

### Q9: Are the two models equivalent in expressive power? *(Hard)*

**Answer**: Yes. Shapiro et al. proved the two formulations are **equivalent**: any state-based CRDT can be **emulated** by an op-based one and vice versa.

- **State-based → op-based**: treat "merge this whole state" as a single operation. Merge is commutative/associative/idempotent, so it trivially satisfies the op-based commutativity requirement; you can even relax delivery because merge is idempotent.
- **Op-based → state-based**: have each replica maintain the *log of operations it has applied* (or a state that summarizes it) as its payload, and define merge as "union the logs / take the join of the summaries." Shipping that state reproduces op-based semantics.

Equivalence means the *choice is an engineering one* (payload size vs delivery guarantees vs GC cost), not a question of what is computable. Any data type expressible in one model is expressible in the other.

---

### Q10: Walk through the OR-Set in both models to show the prepare/effect and merge differences. *(Hard)*

**Answer**: An **Observed-Remove Set (OR-Set)** supports add and remove with "add wins on concurrency," using unique tags.

**Op-based OR-Set:**
- `add(e)`: **prepare** mints a globally-unique tag `t` and broadcasts `add(e, t)`. **effect** inserts the pair `(e, t)`.
- `remove(e)`: **prepare** reads the set of tags currently observed for `e` (say `{t1, t2}`) and broadcasts `remove(e, {t1,t2})`. **effect** deletes exactly those tag-pairs.
- A concurrent `add(e, t3)` survives a concurrent remove, because the remove only targeted the tags it *observed*. This is why prepare must capture the observed tags at the source — and why it must run before broadcast.

**State-based OR-Set:**
- State is a set of `(e, tag)` pairs plus a set of *removed* tags (a "tombstone"/2P-Set style structure, or a version-vector-summarized variant).
- Merge takes the union of live pairs and union of removed tags, then removes any pair whose tag is tombstoned. The union-of-unions is idempotent and commutative, so it satisfies the semilattice laws.

Same observed semantics; entirely different machinery. The op-based version leans on unique-tag minting at prepare time; the state-based version leans on a monotone tombstone set that merges cleanly.

---

## Delivery Guarantees & Causality

### Q11: Why does state-based tolerate a lossy, duplicating, reordering network? *(Medium)*

**Answer**: Because the merge is **idempotent, commutative, and associative**, and updates are **inflationary**:

- **Duplication** is harmless: `a ⊔ a = a`. Receiving the same state twice changes nothing.
- **Reordering** is harmless: commutativity + associativity mean the order of merges doesn't affect the result.
- **Loss** is *eventually* recovered: because state only ever moves up the lattice, the *next* state a replica successfully ships subsumes everything it lost. A dropped message just means "you'll get the information in the next, more-advanced state."

So state-based needs only an **eventually-reliable** channel — it can run over anti-entropy gossip where each round re-ships the (current) full state. No acknowledgements, ordering, or dedup required.

---

### Q12: Why does op-based require reliable, exactly-once, causally-ordered delivery? *(Medium)*

**Answer**: Each operation carries *unique information* that exists nowhere else once applied:

- **At-most-once / no duplication**: operations are generally **not idempotent**. Applying `increment(1)` twice adds 2. So a redelivered op corrupts state — duplication must be prevented (or de-duplicated).
- **At-least-once (reliable)**: a dropped op is *lost forever* — no later message re-includes it (unlike state-based, where later full states subsume losses). So every op must eventually be delivered.
- **Causal order**: applying an op before its causal dependencies can violate the type's invariants — e.g. an OR-Set `remove(e, {t})` arriving before the `add(e, t)` it targets would silently no-op, then the add would make the element reappear, diverging from a replica that saw them in order.

Combine these and you need **exactly-once causal broadcast**.

---

### Q13: What is *causal delivery* precisely, and how is it implemented? *(Medium)*

**Answer**: Causal delivery means: if operation `A` **happened-before** operation `B` (Lamport's `→`, i.e. `A` was known at the replica when `B` was generated), then **every replica delivers `A` before `B`**. Concurrent operations (neither happened-before the other) may be delivered in any relative order.

It is implemented with **vector clocks** (or version vectors): each replica keeps a vector counting messages seen per origin. A message is tagged with the sender's vector. On receipt, a replica **buffers** the message until its own vector shows it has delivered every causal predecessor (the sender's vector entries are all `≤` its own, except exactly +1 in the sender's own slot). Only then does it deliver and bump its clock. This is the standard causal-broadcast / "causal stability" machinery (e.g. used in Bayou, and conceptually in causal-consistency layers).

---

### Q14: Does a *state-based* CRDT need vector clocks for delivery? *(Medium)*

**Answer**: **No** — and this is a frequent point of confusion. State-based CRDTs need **no causal delivery and no vector clocks for the transport**. The merge's algebraic properties (idempotent/commutative/associative + inflationary updates) replace ordering guarantees entirely; states can arrive in any order, dropped or duplicated, and convergence still holds.

The caveat that catches people: a state-based CRDT may use a **version vector *inside its payload*** (as part of the state) to *represent* causal information — e.g. an OR-Set or an MV-Register encodes which updates it has observed. That's a vector clock used as *data for conflict semantics*, not as a *delivery mechanism*. The transport itself remains order-agnostic.

---

### Q15: Can op-based CRDTs run over UDP? *(Medium)*

**Answer**: Not over raw UDP, because UDP gives you neither reliability, nor de-duplication, nor ordering — exactly the three things op-based needs. You would have to **build a reliable causal broadcast layer on top of UDP** (sequence numbers + acks/retransmits for reliability and dedup, vector clocks + buffering for causal order). At that point you're using UDP as a packet primitive, not relying on its semantics.

The honest interview answer: "Raw UDP, no. UDP *plus* a reliable causal-broadcast protocol, yes — but then you've reconstructed the middleware op-based CRDTs assume. State-based, by contrast, *can* run over best-effort UDP gossip with no such layer."

---

### Q16: If two concurrent increments are delivered in different orders at two replicas, do op-based counters still converge? *(Easy)*

**Answer**: Yes. Increments are concurrent and **commute** (integer addition), so `apply(+3) then apply(+5)` equals `apply(+5) then apply(+3)`. Both replicas reach the same total. This is precisely the case where commutativity of concurrent ops does the work — causal delivery wasn't even needed for these two, since they're independent. The requirement that *bites* is exactly-once: each increment must be applied once at each replica, no more, no less.

---

## Delta-state CRDTs

### Q17: What problem do delta-state CRDTs solve? *(Medium)*

**Answer**: The **payload-size problem** of classic state-based CRDTs. Pure state-based replication ships the *entire* state on every sync round. For large objects (a set with millions of elements, a big map) this is catastrophic bandwidth waste — you re-send megabytes to communicate a one-element change. **Delta-state CRDTs (δ-CRDTs)** ship only **small "deltas"** that represent the *recent changes*, while keeping the full algebraic guarantees of state-based merge.

So delta-state keeps the **robust, order-agnostic transport** of state-based CRDTs, but with **op-based-like message sizes**.

---

### Q18: How do delta-state CRDTs work mechanically? *(Hard)*

**Answer**: A **delta-mutator** `mδ` is a function that, instead of returning the full mutated state, returns a **delta** — a value in the *same join-semilattice* that captures just the effect of one update. The delta is itself a state fragment, so:

- A replica applies its own update by `state = state ⊔ mδ(state)` (joining the delta in locally).
- It ships the **delta** (not the whole state) to peers, who also **join** it: `state' = state' ⊔ δ`.
- Because deltas live in the same lattice and merge is the same join, all the semilattice laws still hold — deltas can be lost, duplicated, reordered, and even **batched** (joined together into a "delta-group" before sending).

The subtlety is the **anti-entropy protocol**: to be safe against loss, a replica tracks which deltas each neighbor has acknowledged, and when uncertain it can always **fall back to shipping the full state** (which is just the join of all deltas). So correctness never depends on a delta arriving — full-state shipping remains the safety net.

---

### Q19: Is a delta-state CRDT op-based or state-based? *(Hard)*

**Answer**: It is **state-based**. This is the classic trick question. Delta-state CRDTs are an *optimization of the state-based model*, not a third model and not op-based:

- A delta is an element of the **same join-semilattice** as the full state, and it is incorporated with the **same idempotent, commutative, associative merge**.
- Therefore deltas inherit state-based's tolerance to **loss, duplication, and reordering** — no exactly-once, no causal delivery required.

What makes it *feel* op-based is only that the messages are small and change-shaped. But a "delta" is a *partial state*, not an *operation*: you `⊔`-merge it, you don't `effect`-apply it; redelivering it is a no-op (idempotent), unlike redelivering an increment. So: **delta-state = state-based semantics with op-based-sized messages.** That sentence is the whole answer.

---

### Q20: What does a delta-state CRDT give up compared to pure state-based, if anything? *(Hard)*

**Answer**: It trades a little **protocol complexity and bookkeeping** for the bandwidth win:

- You must run a **delta anti-entropy protocol** that remembers which deltas each peer has seen, so you know what to (re)send and when to fall back to full state. Pure state-based is dead simple — "ship current state periodically."
- Naively, **causally-unstable deltas can't always be merged independently** without care: a received delta must be join-compatible with the receiver's state. For most CRDTs this just works, but designing correct delta-mutators (especially for remove-heavy types) requires precision; a buggy delta-mutator that isn't a true semilattice fragment breaks convergence.
- It does **not** give up any of the safety guarantees: convergence, idempotence, and order-independence all survive, because the safety net is "fall back to full-state merge."

So you give up *simplicity*, not *correctness* — and you can always degrade gracefully to full-state shipping.

---

## Tradeoffs & System Design

### Q21: Summarize the core message-size vs delivery-infrastructure tradeoff. *(Medium)*

**Answer**:

| Dimension | State-based (CvRDT) | Op-based (CmRDT) |
|---|---|---|
| Message content | Full state (or delta) | The operation |
| Message size | Large (full) / small (delta) | Small |
| Network requirement | Eventually-reliable; loss/dup/reorder OK | Reliable, exactly-once, causal delivery |
| Vector clocks for delivery? | No | Yes |
| Robustness to flaky networks | High | Low (relies on middleware) |
| Per-op logic | Merge function | prepare + effect, must commute |

The single sentence: **state-based pays in bytes-per-message and asks little of the network; op-based pays in network guarantees and asks little in bytes.** Delta-state CRDTs are the attempt to get small messages *without* paying the network tax.

---

### Q22: How does garbage collection / state growth differ between the two models? *(Hard)*

**Answer**: They accumulate different debts.

- **Op-based** must keep enough to enforce **exactly-once causal delivery**: a buffer/log of in-flight operations and vector-clock metadata. The good news is operations can be *discarded* once they are **causally stable** — i.e. once every replica is known to have delivered them, the op can never be re-needed and its delivery metadata can be trimmed. So op-based GC is fundamentally about establishing causal stability across the cluster.
- **State-based** carries growth inside the *state itself* — chiefly **tombstones**: markers for removed elements that must linger so that a late-arriving "add" of the same element can be correctly suppressed (or so removes converge). Reclaiming tombstones safely also requires knowing which updates are causally stable across all replicas. Delta-state adds delta-buffer bookkeeping on top.

Net: both ultimately need a notion of **causal stability** to GC safely, but op-based GCs an *operation log* while state-based GCs *tombstones/metadata embedded in the value*. A counter is cheap in both; a remove-heavy set is the GC pain point for state-based.

---

### Q23: You're designing collaborative text editing across mobile clients on flaky cellular networks. Which model? *(Hard)*

**Answer**: Lean **state-based (or delta-state)** for the *transport robustness*, because mobile clients go offline, retry, and reconnect over lossy links — you do not want correctness to hinge on exactly-once causal broadcast to a phone on the subway.

Nuance worth stating: real collaborative-text CRDTs (RGA, LSEQ, Yjs/Automerge-style sequences) are often *described* and *reasoned about* operationally (insert/delete operations with positions), but production systems typically **persist and sync via state/deltas plus dedup**, precisely so a duplicated or reordered message can't corrupt the document. So the strong answer is: "Model the *type* with commutative insert/delete semantics, but choose a **delta-state-style sync** so the flaky network can lose/dup/reorder freely." That's the modern pragmatic synthesis (it's roughly what Automerge/Yjs do).

---

### Q24: When is op-based clearly the better fit? *(Medium)*

**Answer**: When **all three** of these hold:

1. You already operate a **reliable, ordered messaging backbone** — e.g. a Kafka/log-based bus, a totally-or-causally-ordered broadcast layer, or a system where you control delivery end-to-end.
2. **Bandwidth is precious** and states are large, so you can't afford to ship whole states (and delta-state's complexity isn't desired).
3. Operations are naturally **small and semantically rich** (e.g. "apply this insert at this position"), and you want the audit/event-sourcing benefits of having the operation log itself.

In that world the network guarantees are "free" (you'd build the bus anyway), and op-based's tiny messages plus clean event log are pure upside.

---

### Q25: When is state-based clearly the better fit? *(Medium)*

**Answer**: When the network is the weak link:

1. Transport is **best-effort gossip / anti-entropy** with loss, duplication, and reordering (e.g. peer-to-peer, IoT/edge, intermittently-connected mobile).
2. You want **operational simplicity** — no causal-broadcast middleware, no per-message vector clocks, trivial recovery ("on reconnect, just merge states").
3. States are **small or bounded** (counters, small sets, registers, presence info), so full-state shipping is cheap — or you adopt delta-state to handle larger ones.

Riak's CRDTs and many gossip-based systems are state-based for exactly these reasons.

---

### Q26: Two replicas have been partitioned for an hour. How does reconciliation differ between the models on heal? *(Medium)*

**Answer**:

- **State-based**: trivial. On heal, each side ships its **current state**; both **merge**. One merge (or a couple of anti-entropy rounds) and they're identical. Nothing was lost during the partition because each side just kept advancing its local state; the merge subsumes everything.
- **Op-based**: each side must **reliably replay every operation** the other missed during the hour, **in causal order, exactly once**. This requires a durable per-peer operation log and careful dedup/ordering on replay. Miss one op or apply one twice and the replicas diverge silently.

This is the cleanest illustration of why state-based is "partition-friendly": healing is a merge, not a replay.

---

## Gotcha / Trick

### Q27: Is a redelivered `increment` safe in an op-based counter? *(Easy)*

**Answer**: **No.** Increments are **not idempotent** — applying `increment(1)` twice yields +2. A redelivered increment over-counts and diverges. This is exactly why op-based needs **at-most-once** delivery (dedup). Contrast with state-based G-Counter, where re-merging the same state vector is a no-op (`max` is idempotent). "Op-based increments are not idempotent" is the crispest one-line justification for op-based's exactly-once requirement.

---

### Q28: Trick — "Op-based CRDTs only need commutativity, so order never matters." True? *(Hard)*

**Answer**: **False / dangerously imprecise.** Op-based requires that **concurrent** operations commute — order doesn't matter *for independent ops*. But **causally-dependent** operations must still be delivered in **causal order**; their order very much matters. Saying "order never matters" ignores the causal-delivery half of the contract and would let you build a broken OR-Set (remove arriving before its add). The accurate statement: *concurrent ops commute; causally-related ops are ordered by delivery.*

---

### Q29: Trick — "State-based CRDTs need vector clocks." True? *(Medium)*

**Answer**: **False as stated.** State-based CRDTs need **no vector clocks for delivery** — the merge's algebra handles ordering. The trap: *some* state-based CRDTs (OR-Set, MV-Register) carry a **version vector inside their payload** as conflict-resolution *data*. That's data, not a delivery mechanism. So "needs vector clocks for the transport" is false; "may embed a version vector as part of its value" is true for certain types. Distinguishing transport-ordering from in-payload-metadata is the whole point of the question.

---

### Q30: Trick — "Delta-state CRDTs are basically op-based because they send small change messages." True? *(Hard)*

**Answer**: **False.** A delta is a **partial state in the same semilattice**, merged with the **same idempotent join** — so deltas tolerate loss, duplication, and reordering, with **no exactly-once or causal delivery needed**. Operations are *applied* (and aren't idempotent); deltas are *merged* (and are idempotent). Delta-state is firmly **state-based**, just with op-sized messages. Calling it op-based confuses *message size* with *delivery semantics*, which is precisely the conceptual error the topic exists to prevent.

---

### Q31: Gotcha — Can you make an op-based CRDT tolerate duplicates without a dedup layer? *(Hard)*

**Answer**: Only if you **design the operations to be idempotent**, which usually means re-encoding them as *state-fragment* operations — at which point you've drifted toward state/delta-based. For example, an op-based set with `add(e, uniqueTag)` is *naturally* idempotent (re-applying inserts the same `(e, tag)` pair, a no-op), so it survives duplication. But a `increment(k)` op is not. So the honest answer: idempotent-by-design ops can drop the dedup requirement, but the moment an operation's effect depends on being applied *exactly once* (counters, list-position shifts), you need the dedup/exactly-once layer. This is why the literature sometimes calls idempotent op-based variants "pure" or notes their convergence to delta-style reasoning.

---

### Q32: Gotcha — Does state-based merge ever lose information that op-based would have kept? *(Hard)*

**Answer**: It can lose *intermediate* information, but never *converged* information. Merge yields the **least upper bound**, which by design captures the union of what both states observed — so the final agreed value is the same as op-based's. What state-based discards are the **intermediate states** between syncs: if a replica increments three times then ships, peers see only the resulting count, not the three steps. Op-based, shipping each operation, preserves the **operation history** (useful for audit/event-sourcing). So: same converged value, but op-based retains a richer log; state-based collapses the journey into a destination. Choose op-based if the *history of operations itself* is a product requirement.

---

## Rapid-Fire

> One- or two-line answers. Good for warm-ups and to check breadth.

### RF1: State-based ships ___; op-based ships ___. *(Easy)*
**Answer**: Full state (values); operations (verbs).

### RF2: Three algebraic laws state-based merge must satisfy? *(Easy)*
**Answer**: Commutativity, associativity, idempotence (over a join-semilattice).

### RF3: The one extra property local updates need in state-based? *(Easy)*
**Answer**: They must be **inflationary** (monotone — move state up the lattice).

### RF4: The two conditions op-based needs? *(Easy)*
**Answer**: Concurrent ops commute **and** exactly-once causal delivery.

### RF5: Does state-based tolerate message loss? *(Easy)*
**Answer**: Yes — later, more-advanced states subsume the loss.

### RF6: Does op-based tolerate message loss? *(Easy)*
**Answer**: No — a lost op is lost forever; needs reliable delivery.

### RF7: Does op-based tolerate duplicates? *(Easy)*
**Answer**: No (unless ops are idempotent by design); needs at-most-once.

### RF8: Does state-based need vector clocks for delivery? *(Easy)*
**Answer**: No.

### RF9: What provides causal delivery? *(Easy)*
**Answer**: Vector clocks / version vectors + buffering until predecessors are delivered.

### RF10: What are the two halves of an op-based operation? *(Easy)*
**Answer**: **prepare** (origin-only, side-effect-free, builds the message) and **effect** (all replicas, mutates state).

### RF11: Is a delta-state CRDT state-based or op-based? *(Medium)*
**Answer**: State-based (an optimization with op-sized messages).

### RF12: What is a delta? *(Medium)*
**Answer**: A partial state — an element of the same semilattice — merged with the same join.

### RF13: Are the two models equivalent in power? *(Medium)*
**Answer**: Yes — each can emulate the other (Shapiro et al.).

### RF14: Consistency level both models guarantee? *(Easy)*
**Answer**: Strong Eventual Consistency (SEC).

### RF15: One word for state-based's main GC burden? *(Medium)*
**Answer**: Tombstones.

### RF16: One phrase for op-based's main GC burden? *(Medium)*
**Answer**: The operation log (trimmable once causally stable).

### RF17: Which model fits best-effort UDP gossip? *(Easy)*
**Answer**: State-based (or delta-state).

### RF18: Which model fits a Kafka-style reliable ordered bus? *(Easy)*
**Answer**: Op-based.

---

## Common Mistakes

These are the errors interviewers listen for. Naming them proactively signals depth.

- **Saying op-based "doesn't need ordering because it commutes."** It needs **causal** ordering for dependent ops; only *concurrent* ops commute. (Q8, Q28)
- **Claiming state-based needs vector clocks for delivery.** It doesn't; a version vector may live *in the payload* as data, but the transport is order-agnostic. (Q14, Q29)
- **Calling delta-state CRDTs op-based.** They're state-based — small messages, idempotent merge, loss/dup/reorder tolerant. (Q19, Q30)
- **Assuming op-based increments are idempotent.** They are not; that's the whole reason exactly-once delivery is mandatory. (Q27)
- **Forgetting the inflationary-update requirement** for state-based — it's not enough for merge to be a semilattice join; local updates must move *up* the lattice. (Q5)
- **Putting `prepare`'s contextual decision (unique tags, observed set) on every replica.** It must run **once at the origin**, or replicas mint different identities and diverge. (Q7, Q10)
- **Treating "convergence" as order-sensitive.** SEC is about the *set* of delivered updates, not their order (modulo causality in op-based). (Q4)
- **Believing one model is more "powerful."** They're equivalent; the choice is operational (bytes vs network guarantees vs GC). (Q9, Q21)
- **Ignoring partition-heal asymmetry.** State-based heals by *merge*; op-based heals by *reliable causal replay*. The latter is much harder to get right. (Q26)

---

## Tips & Summary

**The single mental model.** State-based ships *values* and leans on **algebra** (idempotent/commutative/associative merge) so the **network can be terrible**. Op-based ships *operations* and leans on **infrastructure** (exactly-once causal broadcast) so the **messages can be tiny**. Delta-state is state-based pretending to be op-based on the wire: op-sized messages, state-based safety.

**The contract table, memorized:**

| | State-based | Op-based |
|---|---|---|
| Wire content | full state / delta | operation |
| Needs reliable delivery? | No | Yes |
| Needs exactly-once? | No (idempotent) | Yes (ops not idempotent) |
| Needs causal order? | No | Yes (for dependent ops) |
| Vector clocks for transport? | No | Yes |
| Concurrent updates must... | merge cleanly (join) | commute |
| GC burden | tombstones in state | op log (trim when causally stable) |

**How to answer "which would you choose?"** Don't pick blindly. Diagnose the *cheapest resource and the weakest link*: flaky/gossip network ⇒ state-based or delta-state; rich reliable bus + bandwidth pressure + desire for an event log ⇒ op-based. Then mention delta-state as the way to get small messages *without* the delivery tax — that's the answer that shows you've kept up with the literature.

**The four trick questions to never miss:**
1. Redelivered increment, op-based ⇒ **unsafe** (not idempotent).
2. Op-based over raw UDP ⇒ **no** (must build reliable causal broadcast on top).
3. State-based needs vector clocks ⇒ **no** (for delivery; maybe in payload as data).
4. Delta-state is op-based ⇒ **no** (it's state-based, op-sized).

**Where to go next.** Solidify the lattice/merge intuition in [CRDT Fundamentals interview](../01-crdt-fundamentals/interview.md); for graded depth on this topic see [junior](junior.md), [senior](senior.md), and [professional](professional.md).
