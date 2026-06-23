# Set CRDTs: ORSWOT, GC & the Add-Wins Discipline — Senior Level

> You already know the four classic set designs — G-Set, 2P-Set, OR-Set, LWW-Set — and you can recite the add-wins argument: tag each addition with a unique token, and an element survives if any of its added tokens has not been observed-removed. That correctness story is settled. What is *not* settled, and what separates a textbook OR-Set from one you would actually ship, is the **metadata**. The naive OR-Set is correct and unbounded: it accumulates tombstones forever. This tier is about the engineering that makes observed-remove sets practical — **ORSWOT** (Observed-Remove Set Without Tombstones), the **dotted version vector** machinery underneath it, **causal stability** as the precondition for garbage collection, the irreducible **add-wins vs remove-wins** choice, and how you stack **maps and registers** on top without re-introducing the problem you just solved.

---

## Table of Contents

1. [Recap: OR-Set Semantics and Why Tags Exist](#1-recap-or-set-semantics-and-why-tags-exist)
2. [The Tombstone Problem](#2-the-tombstone-problem)
3. [ORSWOT: Observed-Remove Without Tombstones](#3-orswot-observed-remove-without-tombstones)
4. [Dotted Version Vectors and Dot Stores](#4-dotted-version-vectors-and-dot-stores)
5. [Causal Stability and Garbage Collection](#5-causal-stability-and-garbage-collection)
6. [Add-Wins vs Remove-Wins: The Choice You Cannot Avoid](#6-add-wins-vs-remove-wins-the-choice-you-cannot-avoid)
7. [Building Up: Maps and Registers](#7-building-up-maps-and-registers)
8. [Code: ORSWOT and OR-Map in Python and Go](#8-code-orswot-and-or-map-in-python-and-go)
9. [Metadata and Performance Comparison](#9-metadata-and-performance-comparison)
10. [Pitfalls](#10-pitfalls)
11. [Cheat Sheet](#11-cheat-sheet)
12. [Summary](#12-summary)
13. [Further Reading](#13-further-reading)

---

## 1. Recap: OR-Set Semantics and Why Tags Exist

The Observed-Remove Set (OR-Set) exists to answer one question that a plain grow-only or two-phase set cannot: *what happens when an add and a remove of the same element happen concurrently on different replicas?* The OR-Set answers **add-wins** — the element is present after merge — and it does so without any wall-clock comparison, by making each `add` produce a globally unique token (a **tag**, or in the modern vocabulary, a **dot**).

The classic state-based formulation carries, per element, a set of *added* tags and a set of *removed* tags:

```text
state = {
  A: { (e, t1), (e, t2), ... },   // adds: element e tagged with unique tokens
  R: { (e, t1), ... }             // removes: tombstones — tags observed-removed
}

lookup(e) ≡ ∃ t : (e, t) ∈ A  and  (e, t) ∉ R
merge(s1, s2) ≡ ( A = A1 ∪ A2 ,  R = R1 ∪ R2 )
```

An `add(e)` mints a *fresh* tag `t` and inserts `(e, t)` into `A`. A `remove(e)` is the crux of "observed-remove": it copies **every tag currently visible for `e`** into `R`. It removes only what it has *observed*. A concurrent `add` on another replica mints a tag the remover never saw, so that tag is not in `R`, so the element survives. That is the entire add-wins mechanism, and it is beautiful precisely because merge is just union — commutative, associative, idempotent — which is exactly what a state-based CRDT requires (see [State vs Op CRDTs](../02-state-vs-operation-based-crdts/senior.md)).

The reason tags exist at all is **causal discrimination**. Without unique tags you cannot tell "the add I am removing" apart from "an add that happened concurrently and that I never saw." A boolean per element collapses those two cases and breaks add-wins. The tag is the unit of causal identity: a remove that observed tag `t` is causally aware of the specific add that produced `t`, and nothing else. Hold onto that idea — *a remove targets observed adds, identified by dots* — because ORSWOT is the same idea with the bookkeeping turned inside out.

For the formal background — the join-semilattice, the monotonicity requirement, why merge must be idempotent — see [CRDT Fundamentals](../01-crdt-fundamentals/senior.md). For the analogous trick applied to numbers rather than membership, see [Counters](../03-counters-g-pn/senior.md). This file assumes all of that and goes straight at the cost.

---

## 2. The Tombstone Problem

Look again at the merge rule: `R = R1 ∪ R2`. The removed-tag set is grow-only. Once a tag enters `R`, it is there forever, because the only way two replicas can agree that an element is absent is for both to carry the evidence of its removal. Drop a tombstone too early and you risk **resurrection**: a replica that still holds the original add `(e, t)` in its `A`, and whose peer has silently forgotten `(e, t)` was removed, will merge to a state where `(e, t) ∈ A` and `(e, t) ∉ R` — the element comes back from the dead.

So the naive OR-Set is **correct but unbounded**. Its metadata grows with the *total number of operations ever performed*, not with the *current size of the set*. Consider a presence set — "users currently in this chat room" — churned by a thousand users joining and leaving over a day:

```text
Live elements at any moment:      ~50
add operations over the day:      100,000
remove operations over the day:    99,950
Tombstones retained (naive):       99,950+  ← forever, and growing
```

A 50-element set drags a 100,000-entry tombstone graveyard. Every merge ships it. Every disk flush persists it. The set you query is tiny; the object you replicate is enormous. This is not a tail problem — for any workload with high add/remove churn, tombstone bytes dominate within hours.

Three escape routes exist, and only one is generally satisfying:

1. **LWW-Set** — drop tags entirely; tag adds and removes with timestamps and let the latest win. This bounds metadata to *one timestamp per element ever seen* but changes the *semantics* to last-writer-wins, which silently discards concurrent updates and depends on clock quality. It is a different data structure with a different contract, not a cheaper OR-Set.
2. **Periodic tombstone GC under a quiescence assumption** — pause writes, let everything converge, garbage-collect. Workable for some systems, but "stop the world to converge" is a strong assumption, and getting the safety condition wrong resurrects elements.
3. **ORSWOT** — restructure the metadata so that a remove *deletes* its evidence instead of *accumulating* it, and use a version vector to remember "what I have already seen" so that a redelivered add is recognized and ignored rather than resurrected. This bounds metadata to roughly *one dot per live element plus one entry per replica*. This is the route Riak's `riak_dt_orswot` took and the one worth understanding deeply.

The rest of this document is mostly route 3, with route 1 (LWW-Set) kept in view as the deliberate-semantics alternative.

---

## 3. ORSWOT: Observed-Remove Without Tombstones

ORSWOT — **Observed-Remove Set Without Tombstones**, introduced by Bieniusa, Zawirski, Preguiça, Shapiro, Baquero, Balegas, and Duarte (2012) in "An Optimized Conflict-free Replicated Set" — keeps OR-Set's add-wins semantics but eliminates the standing tombstone set. It does this with two pieces of state:

- a **causal context**: a **version vector** `cc`, one counter per replica, recording the highest dot this replica has *seen* from each replica;
- an **entries map** `E`: `element → set of dots`, where each live element points to the dots (the adds) that currently keep it alive.

A **dot** is a pair `(replica_id, counter)` — a unique, monotonically increasing event identifier minted by one replica. Replica `a`'s first add produces dot `(a, 1)`, its second `(a, 2)`, and so on. Dots replace the opaque tags of the classic OR-Set, but now they live in a structured namespace that a version vector can summarize.

### The three operations

**add(e)** at replica `r`:
1. Increment `r`'s own component in the causal context: `cc[r] += 1`. Call the new value `n`. The fresh dot is `d = (r, n)`.
2. Replace `e`'s dot-set in `E` with `{d}` — *replace*, not union. A local re-add supersedes the element's previous local dots (more on the subtlety of "local" below). The version vector already advanced, so the new dot is recorded as seen.

```text
add("x") at replica a, when cc = {a:0, b:0}:
  cc → {a:1, b:0}
  E["x"] → {(a,1)}
```

**remove(e)** at replica `r`:
1. Drop `e` from `E` entirely — delete its dot-set. **No tombstone is written.** The causal context is *not* touched; it still remembers every dot we ever saw, including `e`'s now-deleted dots.

```text
remove("x") at replica a, when E["x"] = {(a,1)}, cc = {a:1, b:0}:
  E → {}              // "x" gone
  cc → {a:1, b:0}     // unchanged — we still remember we saw (a,1)
```

The version vector is the load-bearing trick. We *forgot the dot from `E`* but *the version vector still says we have seen `(a,1)`*. That memory is what prevents resurrection.

**merge(s1, s2)** — the heart of ORSWOT. For each element `e`, we must decide which dots survive. The rule, stated precisely:

> For element `e`, the surviving dot-set is:
> `(dots₁ ∩ dots₂)` — dots both replicas still hold —
> `∪ (dots₁ \ cc₂)` — dots replica 1 holds that replica 2 *has never seen* —
> `∪ (dots₂ \ cc₁)` — dots replica 2 holds that replica 1 *has never seen*.
> Then `cc = cc₁ ⊔ cc₂` (componentwise max). If `e`'s surviving dot-set is empty, drop `e`.

Read the three clauses as a tribunal on each dot:

- A dot in **both** dot-sets is uncontroversially alive — keep it.
- A dot that replica 1 holds but replica 2 *does not* — was it removed by replica 2, or has replica 2 simply never heard of it? The version vector answers: if `cc₂` **covers** the dot (the dot is causally below replica 2's knowledge), replica 2 *saw it and then removed it* → it must die. If `cc₂` does **not** cover it, replica 2 has *never seen it* → it is a concurrent add unknown to replica 2 → it lives.
- Symmetric for dots only on replica 2.

That single use of the version vector — "have you seen this dot?" — distinguishes *removed* from *not-yet-delivered*, and it is exactly the distinction the naive OR-Set needed a tombstone to make. ORSWOT moves the memory from a per-tag tombstone into a per-replica version-vector counter. One counter per replica summarizes *all* the dots that replica has ever seen, including the ones it removed.

### Worked example: concurrent add/remove, partition, redelivery

Two replicas `a` and `b`. We will follow the full state — `cc` and `E` — at each step.

```text
Initial (both):  cc = {a:0, b:0}   E = {}

── Step 1. a adds "x" ──────────────────────────────
a:  cc = {a:1, b:0}   E = { "x": {(a,1)} }

── Step 2. replicas sync; b learns about "x" ───────
both: cc = {a:1, b:0}   E = { "x": {(a,1)} }

── Step 3. PARTITION. a and b cannot talk. ─────────
   On a: remove("x")
     a:  E = {}             cc = {a:1, b:0}   // dropped "x", kept memory of (a,1)
   On b: add("x")  (a fresh, concurrent re-add)
     b:  cc = {a:1, b:1}    E = { "x": {(b,1)} }

── Step 4. HEAL. merge a ⊔ b. ──────────────────────
   Element "x":
     dots_a = {}            dots_b = {(b,1)}
     dots_a ∩ dots_b               = {}
     dots_a \ cc_b = {} \ ...      = {}
     dots_b \ cc_a = {(b,1)} \ {a:1,b:0}
        is (b,1) covered by cc_a? cc_a[b] = 0 < 1 → NOT covered
        → {(b,1)} survives
     surviving = {(b,1)}   →  "x" is PRESENT  ✅ add-wins
   cc = {a:1, b:1}
   E  = { "x": {(b,1)} }
```

`a` removed `x` and `b` re-added it concurrently; the re-add won. Add-wins holds, and notice there is **no tombstone anywhere** — `a` simply deleted `x` from `E`. The survival of `b`'s add hinged on `cc_a[b] = 0`: `a` had never seen dot `(b,1)`, so the merge classified it as a concurrent add, not a removed one.

Now the case that justifies the whole design — **redelivery without resurrection**:

```text
Continue from Step 4:  cc = {a:1, b:1}   E = { "x": {(b,1)} }

── Step 5. a removes "x" (it has now seen b's add) ─
   a:  E = {}            cc = {a:1, b:1}

── Step 6. A STALE MESSAGE from Step 1 is redelivered to a:
           "add x with dot (a,1)" arrives AGAIN.
   This is modeled as merging a state s = { E:{"x":{(a,1)}}, cc:{a:1,b:0} }.
   Element "x":
     dots_a = {}           dots_s = {(a,1)}
     dots_a ∩ dots_s              = {}
     dots_a \ cc_s               = {}
     dots_s \ cc_a = {(a,1)} \ {a:1,b:1}
        is (a,1) covered by cc_a? cc_a[a] = 1 ≥ 1 → COVERED
        → (a,1) is dropped (a saw it and removed it)
     surviving = {}        →  "x" stays ABSENT  ✅ no resurrection
```

The redelivered add does **not** resurrect `x`, because `a`'s causal context still records `cc_a[a] = 1` — "I have seen dot `(a,1)`." The merge reads that as "this is an old, already-removed add," not "a new add I must accept." This is the property a tombstone-free design must guarantee, and the version vector delivers it for free: the vector is a compact, permanent record of *every dot ever observed*, so any redelivered-old-add is automatically recognized as causally dominated and discarded.

### The replace-not-union subtlety in add

Why does `add` *replace* `E[e]` rather than *union* into it? Consider replica `a` adding `x` twice locally: dots `(a,1)` then `(a,2)`. After the second add, `E[a]["x"] = {(a,2)}` — the first dot is superseded *locally* because `cc_a[a]` now covers `(a,1)`, and a later merge would have classified `(a,1)` as "covered but absent" and dropped it anyway. Keeping it would be harmless but wasteful. Riak's `riak_dt_orswot` keeps only the *minimal* dot-set: dots not dominated by the local causal context. The practical rule: on a *local* add you may safely replace the element's local dots with the single new dot; dots minted by *other* replicas are preserved through merge by the three-clause rule, not by local add. (Implementations that union-then-minimize and implementations that replace converge to the same observable set; the code in §8 uses the simple, correct "replace on local add" form.)

---

## 4. Dotted Version Vectors and Dot Stores

ORSWOT is one instance of a general pattern. Preguiça, Baquero, and colleagues abstracted the machinery in the work on **Dotted Version Vectors (DVV)** and, more generally, **causal CRDTs built over dot stores** (Almeida, Baquero, Preguiça, et al., "Efficient State-based CRDTs by Delta-Mutation" and the causal-context literature). The vocabulary is worth fixing because it recurs across every causal CRDT — maps, registers, multi-value registers, RGAs.

**Dot.** `(replica_id, counter)` — a unique event identifier. Counters per replica are dense and monotonic: `(a,1), (a,2), (a,3), …`. Density matters: a version vector entry `cc[a] = n` is a *compact* claim that dots `(a,1)…(a,n)` have *all* been seen. There are no holes, so one integer summarizes an unbounded set of dots.

**Causal context (version vector).** The set of all dots seen, represented as a map `replica_id → max counter`. `cc` *covers* a dot `(r, n)` iff `cc[r] ≥ n`. Because counters are dense, coverage is a single comparison. When delivery is *not* causally ordered (deltas can arrive out of order, leaving holes), the causal context is augmented with an explicit set of "dot cloud" exceptions — dots seen above the contiguous prefix — but the steady-state representation is just the vector.

**Dot store.** The payload that maps "live structure" to dots. Three shapes recur:

| Dot store | Shape | Used by |
|---|---|---|
| `DotSet` | a set of dots | enable-wins flag, presence |
| `DotFun` | `dot → value` | multi-value register (MV-Register) |
| `DotMap` | `key → dot store` (recursive) | OR-Set (`key → DotSet`), OR-Map |

ORSWOT's entries map `E` is exactly a **DotMap** from element to **DotSet**. An OR-Map (§7) is a DotMap from key to *another CRDT's* dot store. The merge rule from §3 — keep intersection, keep dots the other side never saw, drop dots the other side saw-and-removed — is the **generic causal merge for a DotSet**, and it lifts recursively to DotFun and DotMap. This is why "understand ORSWOT merge once" pays off everywhere: it *is* the causal-CRDT merge, specialized to membership.

The DVV refinement matters most for **registers** in client-server topologies where a client reads a value, modifies it, and writes back. A plain version vector cannot capture "this write was based on exactly the version I read" without per-client entries that explode. The dotted version vector tags each write with a single dot *plus* the causal context it was based on, so the server can distinguish "overwrite (causally newer)" from "concurrent (must keep both)" with `O(replicas)` rather than `O(clients)` metadata. We return to this in §7.

---

## 5. Causal Stability and Garbage Collection

ORSWOT removed *standing* tombstones, but it did not remove the *version vector*, and the vector grows with the number of replicas that have ever minted dots. Two GC questions remain, and both reduce to the same principle: **causal stability**.

> A dot (or any causal event) is **causally stable** when *every* replica in the system has observed it. Once an event is stable, no future operation anywhere can be concurrent with it — every future operation will causally *follow* it — so any per-event metadata kept solely to detect concurrency with that event can be discarded.

This is the universal GC license for causal CRDTs. Concretely:

**GC question 1 — Can I shrink the causal context?** In an op-based ORSWOT (or a delta-based one) you may keep an explicit "dot cloud" of out-of-order dots above the contiguous version-vector prefix. Those can be folded into the vector once the prefix catches up — a local, cheap compaction that needs no global agreement. The *contiguous* part of the version vector cannot be dropped, because it is precisely the memory that prevents resurrection (§3). The vector is bounded by the number of replicas, not operations, so this is usually acceptable; the concern is *churning replica identities*, addressed below.

**GC question 2 — Can I drop a dropped-element's history?** In pure op-based designs that ship operations rather than full state, a delivered `remove` carries the dots it removes. A receiver must retain enough context to recognize a *late* concurrent add. Once the removed dots are causally stable — every replica has seen both the add and the remove — no concurrent add can still be in flight, so the operation buffers referencing those dots can be reclaimed.

### Detecting stability with version vectors

Stability detection is itself a CRDT-shaped problem: compute, for each replica, the *minimum across all replicas* of "how much of replica `r`'s dot stream everyone has seen." Each replica periodically gossips its own causal context. Replica `i` maintains a matrix `M[j]` = the last causal context it received *from* replica `j` (including `j = i`, its own). Then:

```text
stable_cc[r] = min over all replicas j of  M[j][r]
```

`stable_cc` is a version vector whose `r`-component is the largest counter such that *every* replica has acknowledged seeing dots `(r, 1) … (r, stable_cc[r])`. Any dot covered by `stable_cc` is causally stable and its concurrency-detection metadata is collectible. This is the standard "matrix clock" / stable-vector-timestamp computation; it costs `O(replicas²)` state on each node, which is fine for tens of replicas and a reason ORSWOT-style designs assume *modest, known* membership.

### The interaction with dynamic membership

The matrix-clock stability test has a brutal precondition: **you must know the full membership** to compute "min across all replicas." This is where GC and membership collide:

- **A silent or partitioned replica stalls GC.** If replica `c` is offline, `stable_cc` for every component freezes at whatever `c` last acknowledged. Nothing becomes stable; nothing is collected; metadata grows. A single dead node can pin the whole system's GC. Production systems therefore pair stability GC with a **failure detector and eviction protocol**: a replica unreachable past a threshold is *removed from the membership view*, allowing `stable_cc` to advance — at the cost that if the evicted replica returns with concurrent updates, those updates may be lost or require a full anti-entropy re-sync rather than a clean merge.
- **Adding a replica is easy; removing one is the hard part.** A new replica starts with an empty causal context and learns by anti-entropy. Removing a replica's *identity* from the version vector is the subtle operation: you cannot just delete `cc[c]`, because some elements may still be kept alive by dots `(c, n)`. Riak's approach is to never reuse a `replica_id` (actor id), and to let dead actors' components linger until causally stable, then compact — accepting bounded growth in the actor dimension in exchange for never resurrecting. The pithy version: **dots are cheap to create and expensive to forget; design your membership so you rarely have to forget one.**

The honest senior takeaway: ORSWOT bounds metadata to `O(live elements + replicas)` *in steady state with stable membership*, and degrades toward unbounded growth exactly when membership churns or a replica goes dark. GC is not free; it is a distributed agreement on "everyone has seen X," and like all such agreements it is only as live as your least-available replica — unless you are willing to evict, which trades a liveness win for a (bounded, detectable) correctness risk on the evicted node.

---

## 6. Add-Wins vs Remove-Wins: The Choice You Cannot Avoid

OR-Set and ORSWOT are **add-wins**: concurrent `add(e)` and `remove(e)` resolve to *present*. The mirror-image design, **remove-wins** (sometimes "observed-add" or a 2P-Set-flavored design), resolves the same concurrency to *absent*. The first thing to internalize is that **you must choose one**. There is no "keep both" outcome for a *set*, because a set element is binary — present or absent. Concurrency in counters can be additive ("both increments count"); concurrency in registers can be multi-valued ("keep both values for the app to resolve"); but concurrency in *membership* must collapse to a single bit, and that bit is your policy.

Why can't a set defer like a multi-value register? Because the *only* thing a set element carries is its presence. An MV-Register can hand the application two conflicting *values* and say "you decide." A set element has no value to hand over — "x is both in and out" is not a representable state. So the convergence rule *is* the semantics. Choose deliberately.

### How to choose

Frame it as: **when an add and a remove race with no causal order between them, which intent should the system favor?**

| Pick **add-wins** when… | Pick **remove-wins** when… |
|---|---|
| Losing an add is worse than keeping a stale element | Keeping a removed element is worse than losing a re-add |
| Re-adding is cheap/idempotent; deletion is a "soft" hide | Deletion is a *safety* or *compliance* action (revocation, GDPR erase, block-list) |
| Examples: tags on a doc, shopping-cart items, group membership where re-invite is fine, presence | Examples: access-control revocation, "user blocked," "consent withdrawn," "key compromised — remove" |
| Riak sets, Akka `ORSet`, most "social" features | Capability revocation, security denylists, kill-switches |

The asymmetry is about *which error is tolerable*. Add-wins risks a **zombie element** (something you tried to delete reappears) and never risks a **lost addition**. Remove-wins risks a **lost addition** (something you tried to add silently vanishes) and never risks a zombie. For a denylist, a zombie (a blocked user reappearing as allowed... wait — re-read: for a denylist *of blocked users*, you want the *block* to win, i.e. add-wins on the denylist, or equivalently remove-wins on the *allow*-list). The lesson: **frame the policy around the safety-critical direction, not around the word "add."** Ask "if these two ops race, which outcome can I never tolerate?" and let the data structure enforce it.

### Implementing remove-wins

Remove-wins is *not* simply "ORSWOT with the merge inverted" — naive inversion reintroduces tombstones, because to make a remove dominate a *never-seen* concurrent add, the remove must leave evidence the add cannot out-survive. Practical remove-wins designs keep, per element, both a set of *add-dots* and a set of *remove-dots*, with the rule "present iff there exists an add-dot not dominated by a remove-dot, AND no remove-dot is concurrent with or dominates it" — which is closer to the original 2P-Set and carries the tombstone cost ORSWOT was built to avoid. This is a real reason add-wins dominates in practice: it admits the tombstone-free optimization; remove-wins generally does not, or does so only with extra machinery. If your safety case demands remove-wins, budget for the metadata.

Riak DT and Akka Distributed Data both ship **add-wins** sets as the default and only first-class set; that is not laziness, it is the design that the ORSWOT optimization actually supports. If you need remove-wins semantics on those platforms, you typically model it as add-wins on the *complement* (track the removals as positive members of a "removed" set) — which is, again, choosing add-wins and pointing it at the safety-critical direction.

---

## 7. Building Up: Maps and Registers

Sets are the foundation; the structures you actually ship are usually **maps** of CRDTs. Riak's Map, Akka's `ORMap`/`LWWMap`, and Automerge/Yjs objects are all "keys → CRDT values." The construction is recursive and reuses everything from §3–§4.

### The OR-Map (observed-remove map)

An **OR-Map** is a DotMap from `key → (CRDT value)`, where the *keys* obey add-wins/observed-remove semantics — exactly an ORSWOT over keys — and each *value* is itself a CRDT (a counter, a register, a nested set, or a nested map). Three operations:

- **update(k, op)** — ensure `k` is present (mint a dot for `k` if needed, recording it in the causal context), then apply `op` to the value CRDT at `k`. The value CRDT merges by its own rule.
- **remove(k)** — observed-remove `k`: drop `k`'s key-dots from the DotMap (no tombstone, ORSWOT-style), *and* discard its value.
- **merge** — recurse: merge the key DotMap by the ORSWOT rule to decide which keys survive; for keys present on both sides, merge the value CRDTs by their rule; for a key present on one side, keep it iff its key-dots survive the ORSWOT classification (concurrent-update vs observed-remove).

The recursive merge is where the elegance compounds: because every layer is a causal CRDT over the *same* causal context, a single shared version vector serves the whole nested structure, and stability/GC apply uniformly.

### The remove-then-update conflict

The one genuinely tricky case in maps is **concurrent `remove(k)` and `update(k, op)`**:

```text
Replica a:  remove("counter")          // delete the whole entry
Replica b:  update("counter", inc 5)   // mutate the value concurrently
```

What is the merged value? With **observed-remove** map semantics, the *update wins the key* — same add-wins logic: `b`'s update minted a *new* key-dot that `a`'s remove never observed, so the key survives. The question becomes *what value*. The principled answer: the key is present with the value being the merge of "what `b` produced" against "what `a` had before removing." But `a` discarded the value on remove. The standard resolution, used by Riak Map and Akka `ORMap`, is:

> The surviving key's value is reconstructed from the *update side only* — the concurrent update re-establishes the entry, and any *value-level* dots that `a` removed-and-saw are dropped, while the concurrently-updated value-dots survive.

In other words the conflict is pushed down one level: the key follows add-wins (ORSWOT over keys), and the *value's own CRDT merge* decides the value, with the remove having deleted only the value-dots it had observed. A counter value re-emerges holding `b`'s `+5` (the part of the counter `a` never saw), and any increments `a` *had* seen and then removed are gone. This is consistent, convergent, and matches the principle of least surprise *given* you bought into observed-remove: "a delete only deletes what it saw; concurrent work survives." Document this for your users, because "I deleted the key but it came back holding a partial value" surprises people who did not read the contract.

### Registers on top: LWW-Register and MV-Register

Map *values* are frequently **registers**:

- **LWW-Register** — value plus a timestamp (logical or hybrid-logical clock); merge keeps the higher timestamp, ties broken by replica id. Cheap, total, lossy: concurrent writes — one silently wins. This is the same trade as the [LWW-Set](#2-the-tombstone-problem) at the value level, and the right choice when "some recent value" beats "a conflict to resolve."
- **MV-Register (multi-value)** — a **DotFun** (`dot → value`): an update mints a dot and *replaces* all dots the writer has seen with `{new_dot → value}`; merge keeps values whose dots are not causally dominated. Concurrent writes leave *multiple* values for the application to resolve (sibling values, exactly like Dynamo/Riak siblings). This is where DVV (§4) earns its keep: in a client-server setting, the dotted version vector lets the server tag each client write with one dot plus its read-context, distinguishing overwrite from concurrent with `O(replicas)` metadata instead of `O(clients)`.

The takeaway: **maps inherit their conflict story from their pieces.** Choose add-wins keys (ORSWOT) almost always; choose the value CRDT — counter, LWW-Register, MV-Register, nested map — per field, by the same "which error is tolerable" reasoning as §6. A Riak Map can mix a PN-Counter field, an LWW-Register field, and a nested ORSWOT field, each converging by its own rule, all sharing one causal context.

---

## 8. Code: ORSWOT and OR-Map in Python and Go

Two complete, runnable implementations. Both implement a state-based ORSWOT with a version-vector causal context, the three-clause merge, and an OR-Map built on top. Both drive a partition/heal + redelivery + concurrent add/remove scenario that demonstrates add-wins, no resurrection, and the remove-then-update map conflict.

### 8.1 Python

```python
"""ORSWOT (Observed-Remove Set Without Tombstones) + OR-Map.

State-based CRDT. Causal context is a version vector {replica_id: max_counter}.
Entries map E: element -> set of dots, where a dot is (replica_id, counter).
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Set, Tuple, Iterable

Dot = Tuple[str, int]          # (replica_id, counter)
VersionVector = Dict[str, int] # replica_id -> highest contiguous counter seen


def vv_covers(cc: VersionVector, dot: Dot) -> bool:
    """True iff the causal context has already observed `dot`."""
    rid, n = dot
    return cc.get(rid, 0) >= n


def vv_join(a: VersionVector, b: VersionVector) -> VersionVector:
    """Componentwise max of two version vectors."""
    out = dict(a)
    for rid, n in b.items():
        if n > out.get(rid, 0):
            out[rid] = n
    return out


@dataclass
class ORSWOT:
    replica_id: str
    cc: VersionVector = field(default_factory=dict)        # causal context
    entries: Dict[str, Set[Dot]] = field(default_factory=dict)  # element -> dots

    # ---- local operations -------------------------------------------------
    def add(self, element: str) -> None:
        n = self.cc.get(self.replica_id, 0) + 1
        self.cc[self.replica_id] = n
        dot = (self.replica_id, n)
        # Replace local dots: a fresh local add supersedes the element's
        # previously-held dots. (Other replicas' dots survive via merge.)
        self.entries[element] = {dot}

    def remove(self, element: str) -> None:
        # Observed-remove: drop the element's dots. NO tombstone is written.
        # The causal context is untouched, so it still "remembers" those dots.
        self.entries.pop(element, None)

    def contains(self, element: str) -> bool:
        return element in self.entries and len(self.entries[element]) > 0

    def value(self) -> Set[str]:
        return {e for e, dots in self.entries.items() if dots}

    # ---- merge ------------------------------------------------------------
    def merge(self, other: "ORSWOT") -> None:
        """In-place merge using the three-clause ORSWOT rule per element."""
        elements = set(self.entries) | set(other.entries)
        merged: Dict[str, Set[Dot]] = {}
        for e in elements:
            d1 = self.entries.get(e, set())
            d2 = other.entries.get(e, set())
            # 1. dots both replicas still hold
            both = d1 & d2
            # 2. dots I hold that OTHER has never seen (concurrent add) -> keep
            mine_unseen = {d for d in (d1 - d2) if not vv_covers(other.cc, d)}
            # 3. dots OTHER holds that I have never seen (concurrent add) -> keep
            theirs_unseen = {d for d in (d2 - d1) if not vv_covers(self.cc, d)}
            survivors = both | mine_unseen | theirs_unseen
            if survivors:
                merged[e] = survivors
            # else: element dropped (every dot was seen-and-removed somewhere)
        self.entries = merged
        self.cc = vv_join(self.cc, other.cc)

    def copy(self) -> "ORSWOT":
        c = ORSWOT(self.replica_id, dict(self.cc),
                   {e: set(d) for e, d in self.entries.items()})
        return c


# --------------------------------------------------------------------------
# OR-Map: keys obey ORSWOT (observed-remove); values are nested CRDTs.
# Here the value CRDT is a simple grow-only-ish PN counter keyed by dots,
# but any causal CRDT slots in the same way.
# --------------------------------------------------------------------------
@dataclass
class GCounter:
    counts: Dict[str, int] = field(default_factory=dict)

    def inc(self, rid: str, by: int = 1) -> None:
        self.counts[rid] = self.counts.get(rid, 0) + by

    def value(self) -> int:
        return sum(self.counts.values())

    def merge(self, other: "GCounter") -> None:
        for rid, n in other.counts.items():
            if n > self.counts.get(rid, 0):
                self.counts[rid] = n


@dataclass
class ORMap:
    replica_id: str
    cc: VersionVector = field(default_factory=dict)
    keys: Dict[str, Set[Dot]] = field(default_factory=dict)   # key -> dots (ORSWOT)
    values: Dict[str, GCounter] = field(default_factory=dict) # key -> value CRDT

    def update(self, key: str, by: int = 1) -> None:
        # ensure the key is present: mint a fresh key-dot (ORSWOT add on keys)
        n = self.cc.get(self.replica_id, 0) + 1
        self.cc[self.replica_id] = n
        self.keys[key] = {(self.replica_id, n)}
        self.values.setdefault(key, GCounter()).inc(self.replica_id, by)

    def remove(self, key: str) -> None:
        self.keys.pop(key, None)
        self.values.pop(key, None)

    def get(self, key: str) -> int | None:
        if key in self.keys and self.keys[key]:
            return self.values.get(key, GCounter()).value()
        return None

    def merge(self, other: "ORMap") -> None:
        all_keys = set(self.keys) | set(other.keys)
        merged_keys: Dict[str, Set[Dot]] = {}
        merged_vals: Dict[str, GCounter] = {}
        for k in all_keys:
            d1, d2 = self.keys.get(k, set()), other.keys.get(k, set())
            both = d1 & d2
            mine = {d for d in (d1 - d2) if not vv_covers(other.cc, d)}
            theirs = {d for d in (d2 - d1) if not vv_covers(self.cc, d)}
            survivors = both | mine | theirs
            if survivors:
                merged_keys[k] = survivors
                v = GCounter()
                if k in self.values:
                    v.merge(self.values[k])
                if k in other.values:
                    v.merge(other.values[k])
                merged_vals[k] = v
        self.keys, self.values = merged_keys, merged_vals
        self.cc = vv_join(self.cc, other.cc)


# --------------------------------------------------------------------------
# Scenario driver
# --------------------------------------------------------------------------
def line(msg: str) -> None:
    print(msg)


def demo_orswot() -> None:
    line("=== ORSWOT: partition / heal / redelivery ===")
    a, b = ORSWOT("a"), ORSWOT("b")

    # Step 1: a adds "x"
    a.add("x")
    # Step 2: b learns about x via sync
    b.merge(a)
    line(f"after sync   a={sorted(a.value())} b={sorted(b.value())}")

    # Step 3: PARTITION — a removes x, b concurrently re-adds x
    a.remove("x")
    b.add("x")
    line(f"partitioned  a={sorted(a.value())} b={sorted(b.value())}")

    # Step 4: HEAL — merge both directions
    a_snap, b_snap = a.copy(), b.copy()
    a.merge(b_snap)
    b.merge(a_snap)
    line(f"healed       a={sorted(a.value())} b={sorted(b.value())}  "
         f"(add-wins -> 'x' present)")
    assert a.value() == b.value() == {"x"}, "convergence + add-wins failed"

    # Step 5: a removes x now that it has seen b's add
    a.remove("x")
    b.merge(a.copy())
    line(f"a removes x  a={sorted(a.value())} b={sorted(b.value())}")
    assert a.value() == set() and b.value() == set()

    # Step 6: a STALE message from Step 1 is redelivered: "add x dot (a,1)"
    stale = ORSWOT("a", cc={"a": 1}, entries={"x": {("a", 1)}})
    a.merge(stale)
    line(f"redeliver    a={sorted(a.value())}  (no resurrection -> empty)")
    assert a.value() == set(), "RESURRECTION BUG"
    line("ORSWOT scenario OK\n")


def demo_ormap() -> None:
    line("=== OR-Map: concurrent remove(k) vs update(k) ===")
    a, b = ORMap("a"), ORMap("b")
    a.update("counter", 3)        # a: counter = 3
    b.merge(a)                     # b learns counter = 3
    line(f"after sync   a={a.get('counter')} b={b.get('counter')}")

    # concurrent: a removes the key, b increments it
    a.remove("counter")
    b.update("counter", 5)        # b mints a NEW key-dot a never saw
    a_snap, b_snap = ORMap("a", dict(a.cc), {k: set(v) for k, v in a.keys.items()},
                           {k: GCounter(dict(c.counts)) for k, c in a.values.items()}), \
                     ORMap("b", dict(b.cc), {k: set(v) for k, v in b.keys.items()},
                           {k: GCounter(dict(c.counts)) for k, c in b.values.items()})
    a.merge(b_snap)
    b.merge(a_snap)
    # add-wins on the KEY: the concurrent update re-establishes the entry.
    line(f"healed       a={a.get('counter')} b={b.get('counter')}  "
         f"(observed-remove map: update wins the key)")
    assert a.get("counter") == b.get("counter")
    line("OR-Map scenario OK\n")


if __name__ == "__main__":
    demo_orswot()
    demo_ormap()
```

Running it:

```text
=== ORSWOT: partition / heal / redelivery ===
after sync   a=['x'] b=['x']
partitioned  a=[] b=['x']
healed       a=['x'] b=['x']  (add-wins -> 'x' present)
a removes x  a=[] b=[]
redeliver    a=[]  (no resurrection -> empty)
ORSWOT scenario OK

=== OR-Map: concurrent remove(k) vs update(k) ===
after sync   a=3 b=3
healed       a=8 b=8  (observed-remove map: update wins the key)
OR-Map scenario OK
```

Note the map result: `a=8`. The key survives (add-wins on keys), and the value is the merge of the surviving counter dots — `a`'s original `+3` is preserved in the GCounter (which is itself causally monotone) and `b`'s `+5` adds in, giving 8. A stricter "remove discards observed value-dots" semantics would yield 5; the choice depends on whether your value CRDT is grow-only (GCounter, preserved) or itself observed-remove (discarded). The point is the *key*-level conflict resolves by ORSWOT and the *value*-level by the value CRDT — exactly the recursive story from §7.

### 8.2 Go

```go
// Package orswot implements a state-based Observed-Remove Set Without
// Tombstones plus an OR-Map, demonstrating add-wins and no-resurrection.
package main

import (
	"fmt"
	"sort"
)

// Dot is a unique event id: replica id + monotonic counter.
type Dot struct {
	Replica string
	Counter int
}

// VV is a version vector / causal context: replica -> highest counter seen.
type VV map[string]int

func (cc VV) covers(d Dot) bool { return cc[d.Replica] >= d.Counter }

func (cc VV) join(other VV) VV {
	out := VV{}
	for r, n := range cc {
		out[r] = n
	}
	for r, n := range other {
		if n > out[r] {
			out[r] = n
		}
	}
	return out
}

type dotSet map[Dot]struct{}

func (s dotSet) add(d Dot)         { s[d] = struct{}{} }
func (s dotSet) has(d Dot) bool    { _, ok := s[d]; return ok }
func (s dotSet) clone() dotSet {
	c := dotSet{}
	for d := range s {
		c[d] = struct{}{}
	}
	return c
}

// ORSWOT: causal context + element -> set of dots.
type ORSWOT struct {
	Replica string
	CC      VV
	Entries map[string]dotSet
}

func NewORSWOT(r string) *ORSWOT {
	return &ORSWOT{Replica: r, CC: VV{}, Entries: map[string]dotSet{}}
}

func (s *ORSWOT) Add(e string) {
	n := s.CC[s.Replica] + 1
	s.CC[s.Replica] = n
	s.Entries[e] = dotSet{{s.Replica, n}: struct{}{}} // replace local dots
}

func (s *ORSWOT) Remove(e string) {
	delete(s.Entries, e) // observed-remove: no tombstone; CC untouched
}

func (s *ORSWOT) Contains(e string) bool {
	ds, ok := s.Entries[e]
	return ok && len(ds) > 0
}

func (s *ORSWOT) Value() []string {
	out := []string{}
	for e, ds := range s.Entries {
		if len(ds) > 0 {
			out = append(out, e)
		}
	}
	sort.Strings(out)
	return out
}

// Merge applies the three-clause ORSWOT rule per element.
func (s *ORSWOT) Merge(other *ORSWOT) {
	keys := map[string]struct{}{}
	for e := range s.Entries {
		keys[e] = struct{}{}
	}
	for e := range other.Entries {
		keys[e] = struct{}{}
	}
	merged := map[string]dotSet{}
	for e := range keys {
		d1, d2 := s.Entries[e], other.Entries[e]
		survivors := dotSet{}
		for d := range d1 {
			if d2.has(d) { // both hold it
				survivors.add(d)
			} else if !other.CC.covers(d) { // other never saw it -> concurrent add
				survivors.add(d)
			} // else: other saw it and removed it -> drop
		}
		for d := range d2 {
			if !d1.has(d) && !s.CC.covers(d) { // I never saw it -> concurrent add
				survivors.add(d)
			}
		}
		if len(survivors) > 0 {
			merged[e] = survivors
		}
	}
	s.Entries = merged
	s.CC = s.CC.join(other.CC)
}

func (s *ORSWOT) Clone() *ORSWOT {
	c := NewORSWOT(s.Replica)
	for r, n := range s.CC {
		c.CC[r] = n
	}
	for e, ds := range s.Entries {
		c.Entries[e] = ds.clone()
	}
	return c
}

// ---- OR-Map over a grow-only counter value -------------------------------

type GCounter map[string]int

func (g GCounter) Inc(r string, by int) { g[r] += by }
func (g GCounter) Value() int {
	t := 0
	for _, n := range g {
		t += n
	}
	return t
}
func (g GCounter) Merge(o GCounter) {
	for r, n := range o {
		if n > g[r] {
			g[r] = n
		}
	}
}
func (g GCounter) clone() GCounter {
	c := GCounter{}
	for r, n := range g {
		c[r] = n
	}
	return c
}

type ORMap struct {
	Replica string
	CC      VV
	Keys    map[string]dotSet
	Values  map[string]GCounter
}

func NewORMap(r string) *ORMap {
	return &ORMap{Replica: r, CC: VV{}, Keys: map[string]dotSet{}, Values: map[string]GCounter{}}
}

func (m *ORMap) Update(k string, by int) {
	n := m.CC[m.Replica] + 1
	m.CC[m.Replica] = n
	m.Keys[k] = dotSet{{m.Replica, n}: struct{}{}}
	if m.Values[k] == nil {
		m.Values[k] = GCounter{}
	}
	m.Values[k].Inc(m.Replica, by)
}

func (m *ORMap) Remove(k string) {
	delete(m.Keys, k)
	delete(m.Values, k)
}

func (m *ORMap) Get(k string) (int, bool) {
	if ds, ok := m.Keys[k]; ok && len(ds) > 0 {
		return m.Values[k].Value(), true
	}
	return 0, false
}

func (m *ORMap) Merge(other *ORMap) {
	keys := map[string]struct{}{}
	for k := range m.Keys {
		keys[k] = struct{}{}
	}
	for k := range other.Keys {
		keys[k] = struct{}{}
	}
	mk := map[string]dotSet{}
	mv := map[string]GCounter{}
	for k := range keys {
		d1, d2 := m.Keys[k], other.Keys[k]
		survivors := dotSet{}
		for d := range d1 {
			if d2.has(d) || !other.CC.covers(d) {
				survivors.add(d)
			}
		}
		for d := range d2 {
			if !d1.has(d) && !m.CC.covers(d) {
				survivors.add(d)
			}
		}
		if len(survivors) > 0 {
			mk[k] = survivors
			v := GCounter{}
			if cur, ok := m.Values[k]; ok {
				v.Merge(cur)
			}
			if cur, ok := other.Values[k]; ok {
				v.Merge(cur)
			}
			mv[k] = v
		}
	}
	m.Keys, m.Values = mk, mv
	m.CC = m.CC.join(other.CC)
}

func (m *ORMap) Clone() *ORMap {
	c := NewORMap(m.Replica)
	for r, n := range m.CC {
		c.CC[r] = n
	}
	for k, ds := range m.Keys {
		c.Keys[k] = ds.clone()
	}
	for k, g := range m.Values {
		c.Values[k] = g.clone()
	}
	return c
}

func main() {
	fmt.Println("=== ORSWOT: partition / heal / redelivery ===")
	a, b := NewORSWOT("a"), NewORSWOT("b")

	a.Add("x")
	b.Merge(a)
	fmt.Printf("after sync   a=%v b=%v\n", a.Value(), b.Value())

	a.Remove("x") // concurrent remove on a
	b.Add("x")    // concurrent re-add on b
	fmt.Printf("partitioned  a=%v b=%v\n", a.Value(), b.Value())

	aSnap, bSnap := a.Clone(), b.Clone()
	a.Merge(bSnap)
	b.Merge(aSnap)
	fmt.Printf("healed       a=%v b=%v  (add-wins)\n", a.Value(), b.Value())

	a.Remove("x")
	b.Merge(a.Clone())
	fmt.Printf("a removes x  a=%v b=%v\n", a.Value(), b.Value())

	// stale redelivery of the original "add x dot (a,1)"
	stale := &ORSWOT{Replica: "a", CC: VV{"a": 1},
		Entries: map[string]dotSet{"x": {{"a", 1}: struct{}{}}}}
	a.Merge(stale)
	fmt.Printf("redeliver    a=%v  (no resurrection)\n\n", a.Value())

	fmt.Println("=== OR-Map: concurrent remove vs update ===")
	ma, mb := NewORMap("a"), NewORMap("b")
	ma.Update("counter", 3)
	mb.Merge(ma)
	av, _ := ma.Get("counter")
	bv, _ := mb.Get("counter")
	fmt.Printf("after sync   a=%d b=%d\n", av, bv)

	ma.Remove("counter")  // concurrent remove
	mb.Update("counter", 5) // concurrent update -> new key-dot a never saw
	maSnap, mbSnap := ma.Clone(), mb.Clone()
	ma.Merge(mbSnap)
	mb.Merge(maSnap)
	av, _ = ma.Get("counter")
	bv, _ = mb.Get("counter")
	fmt.Printf("healed       a=%d b=%d  (update wins the key)\n", av, bv)
}
```

Expected output (identical convergence to the Python version):

```text
=== ORSWOT: partition / heal / redelivery ===
after sync   a=[x] b=[x]
partitioned  a=[] b=[x]
healed       a=[x] b=[x]  (add-wins)
a removes x  a=[] b=[]
redeliver    a=[]  (no resurrection)

=== OR-Map: concurrent remove vs update ===
after sync   a=3 b=3
healed       a=8 b=8  (update wins the key)
```

Both implementations are deliberately *state-based and full-state* for clarity. A production system would ship **deltas** (only the changed dots + a small causal context) rather than the whole object — see [State vs Op CRDTs](../02-state-vs-operation-based-crdts/senior.md) for delta-state mechanics — but the merge rule and the resurrection-prevention logic are exactly what you see here.

---

## 9. Metadata and Performance Comparison

Let `n` = current live elements, `R` = number of distinct replicas ever active, `A` = total adds ever performed, `D` = total removes ever performed, `U` = total updates ever performed.

| Property | Naive OR-Set | ORSWOT | LWW-Set |
|---|---|---|---|
| Steady-state metadata | `O(A + D)` — every add-tag + every remove-tag, forever | `O(n + R)` — one dot per live element + version vector | `O(elements ever seen)` — one timestamp per element |
| Tombstones | Yes — grow-only `R` set, never collected without quiescence | **None** — remove deletes dots; VV remembers what was seen | None — but a removed element keeps a remove-timestamp |
| Bytes per live element | tag(s) + share of tombstone graveyard | ~1 dot (`replica_id` + `counter`) | 1 timestamp + present/absent flag |
| GC story | Hard — needs global quiescence to drop tombstones | Causal stability via matrix clock; bounded by membership liveness | Trivial per-element; old timestamps just overwritten |
| Concurrent add/remove | **add-wins** (correct, by design) | **add-wins** (correct, by design) | **last-writer-wins** — clock decides; a write can be silently lost |
| Clock dependency | None | None (logical dots only) | **Yes** — needs synchronized/HLC clocks; clock skew → wrong winner |
| Resurrection risk | Only if a tombstone is dropped too early | Prevented by version vector; safe even on redelivery | Possible if clocks regress / skew across the add↔remove pair |
| Merge cost | `O(A + D)` set unions | `O((n) · dot-set sizes)` + VV join | `O(elements)` timestamp compares |
| When to choose | Pedagogy; never in production at scale | Default production observed-remove set (Riak, Akka) | When LWW semantics are *desired* and clocks are trustworthy |

The dominant story: **ORSWOT trades the unbounded `O(A+D)` tombstone graveyard for a bounded `O(n+R)` footprint, at the cost of a version vector whose GC liveness depends on membership.** LWW-Set is the cheapest of all but buys that cheapness by *changing the semantics* to lossy last-writer-wins and by *depending on clocks*. There is no metadata-free observed-remove set: the version vector is the irreducible cost of remembering "what have I already seen" without a per-tombstone record.

A concrete back-of-envelope for the chat-presence workload from §2 (50 live users, 100k adds, 100k removes, 3 replicas):

```text
Naive OR-Set:  ~200,000 tag entries replicated   (~MBs, growing daily)
ORSWOT:        50 dots + 3-entry version vector   (~hundreds of bytes)
LWW-Set:       ~ (distinct users ever) timestamps  (bounded by user count)
```

---

## 10. Pitfalls

- **Dropping the version vector to "save space."** The causal context is *not* optional metadata — it is the entire anti-resurrection mechanism. Without it, a redelivered or out-of-order add is indistinguishable from a fresh add and the element comes back from the dead. Shrink the *dot cloud* (out-of-order exceptions), never the contiguous version vector.
- **GC under non-stable causal context.** Collecting a dot before it is *causally stable* (seen by every replica) can resurrect elements: a replica still holding a concurrent add will out-survive a remove whose evidence you collected. Only stable events are collectible, and stability requires a global "everyone has seen X" — which a single dead replica blocks.
- **A dead replica silently stalls all GC.** The matrix-clock min freezes on the least-available node. Without an eviction/failure-detector path, metadata grows unbounded precisely when one node is partitioned. Plan for eviction, and document that an evicted-then-returning replica may need full anti-entropy rather than a clean merge.
- **Reusing replica/actor ids.** Dots are `(replica_id, counter)`. If two physically different replicas ever share an id, their counters collide, two distinct events get the same dot, and the version vector lies about what has been seen. Never recycle actor ids; mint a fresh id on every (re)provisioning.
- **Assuming remove-wins is "ORSWOT with inverted merge."** It is not — remove-wins generally reintroduces tombstones because a remove must leave evidence that dominates *never-seen* concurrent adds. If you need remove-wins, budget the metadata or model it as add-wins on the complement.
- **Forgetting that a set must collapse concurrency to one bit.** Unlike registers, a set element cannot defer a conflict to the app ("keep both"). Concurrent add|remove *must* resolve to present-or-absent; the convergence rule *is* the semantics. Choose add-wins vs remove-wins deliberately, framed by the safety-critical direction.
- **Surprising users with remove-then-update in maps.** In an observed-remove map, `remove(k)` concurrent with `update(k, …)` keeps the key (add-wins) with a value reconstructed from the update side. "I deleted it but it came back holding a partial value" is correct but astonishing — document it.
- **LWW-Set without thinking about clocks.** LWW is cheap but *lossy and clock-dependent*. Skew or regression across the add↔remove pair silently flips the winner. Use a hybrid logical clock and accept that concurrent writes lose data by design — only adopt LWW where that loss is acceptable.
- **Local add as union instead of replace.** Unioning every local add's dot into the element's dot-set bloats the dot-set monotonically. A local add should replace the element's *local* dots (the causal context already covers the old ones); other replicas' dots are preserved by merge, not by local add.

---

## 11. Cheat Sheet

```text
DOT          (replica_id, counter)  — unique, dense, monotonic event id
CAUSAL CTX   version vector cc[r] = highest contiguous counter seen from r
             cc covers (r,n)  ⇔  cc[r] ≥ n
DOT STORE    DotSet (set), DotFun (dot→value, MV-Reg), DotMap (key→store, OR-Set/Map)

ORSWOT STATE  cc: VersionVector ;  E: element → set of dots
  add(e)@r   : cc[r] += 1 ; E[e] = {(r, cc[r])}        // replace local dots
  remove(e)  : del E[e]                                 // NO tombstone; cc untouched
  contains(e): E[e] nonempty
  merge      : per element e, survivors =
                 (d1 ∩ d2)                 // both hold
               ∪ {d∈d1\d2 : ¬cc2.covers(d)} // other never saw → concurrent add
               ∪ {d∈d2\d1 : ¬cc1.covers(d)} // I never saw    → concurrent add
               cc = cc1 ⊔ cc2 ; drop e if survivors empty

WHY NO RESURRECTION : a redelivered old add has a dot the cc already COVERS
                      → classified "seen & removed" → dropped, not re-added.

GC : a dot is collectible once CAUSALLY STABLE (every replica has seen it).
     stable_cc[r] = min over replicas j of M[j][r]   (matrix clock)
     dead/partitioned replica ⇒ stability stalls ⇒ pair with eviction.

CHOICE : add-wins  → concurrent add|remove = PRESENT  (tags survive)
         remove-wins→ concurrent add|remove = ABSENT  (reintroduces tombstones)
         a SET must pick one bit; it cannot "keep both."
         Frame by the safety-critical direction, not by the word "add".

MAPS : OR-Map = DotMap key→CRDT value. keys: ORSWOT (add-wins).
       remove(k) ∥ update(k): update wins the KEY; value by value-CRDT merge.
       value CRDTs: LWW-Register (lossy, clocked) | MV-Register (DotFun, siblings)
                    | PN-Counter | nested ORSWOT/ORMap (recursive merge, shared cc)

METADATA : OR-Set O(A+D) unbounded | ORSWOT O(n+R) | LWW-Set O(elems) lossy+clocked
```

---

## 12. Summary

The OR-Set's add-wins guarantee is correct and unconditional, but its naive form pays for that guarantee with an unbounded tombstone set whose size tracks *every operation ever performed*. **ORSWOT** keeps the semantics and discards the standing tombstones by restructuring the state into a **causal context** (a version vector) plus an **entries map** of element → dots. A remove simply *deletes* an element's dots; the version vector independently *remembers* that those dots were seen. The three-clause merge — keep dots both sides hold, keep dots the other side never saw (concurrent adds), drop dots the other side saw-and-removed — uses one `cc.covers(dot)` test to distinguish "removed" from "not-yet-delivered," which is exactly the distinction the old tombstone provided. That same test makes redelivered-old-adds harmless: their dots are already covered, so they are recognized as stale and dropped, not resurrected.

Underneath, ORSWOT is one instance of the **dot-store** machinery (DotSet / DotFun / DotMap) that powers every causal CRDT, and **dotted version vectors** extend it to client-server registers with `O(replicas)` rather than `O(clients)` metadata. The bounded footprint is real but not free: the version vector must be retained in full, and dropping any per-event metadata requires **causal stability** — proof that every replica has seen the event — detected with a matrix clock and stalled by any dead or partitioned replica, which is why GC and **dynamic membership** are inseparable and why production systems pair stability with eviction.

Two design facts are non-negotiable. First, a set must **collapse concurrent add|remove to a single bit**; it cannot defer to the application the way a register can, so the convergence rule *is* the semantics, and you must choose **add-wins** (the tombstone-free, default choice) or **remove-wins** (which reintroduces tombstones and suits safety-critical revocation) by asking which error you can never tolerate. Second, the structures you actually ship are **maps of CRDTs**: an OR-Map applies ORSWOT to keys and recurses into per-field value CRDTs (counters, LWW/MV registers, nested sets), with the remove-then-update conflict resolving by add-wins on the key and the value CRDT's own merge on the value. Master the ORSWOT merge once and you have mastered the merge for the entire causal-CRDT family.

For the formal lattice grounding see [CRDT Fundamentals](../01-crdt-fundamentals/senior.md); for the delta/op-based shipping mechanics see [State vs Op CRDTs](../02-state-vs-operation-based-crdts/senior.md); for the additive sibling of this design see [Counters](../03-counters-g-pn/senior.md); and for the ordered, position-stamped cousin where dots become *positions* in a sequence see [Sequence/Text CRDTs](../05-sequences-and-text-crdts/senior.md). The gentler builds are in [junior](junior.md) and [middle](middle.md); the operational hardening — sizing, anti-entropy schedules, real Riak/Akka tuning — continues in [professional](professional.md).

---

## 13. Further Reading

- **Shapiro, Preguiça, Baquero, Zawirski (2011)** — "Conflict-free Replicated Data Types," and the companion INRIA tech report "A comprehensive study of CRDTs." The foundational catalogue: G-Set, 2P-Set, OR-Set, LWW-Set, counters, and the state/op duality. Start here for the OR-Set proof you already know.
- **Bieniusa, Zawirski, Preguiça, Shapiro, Baquero, Balegas, Duarte (2012)** — "An Optimized Conflict-free Replicated Set" (arXiv:1210.3368). The ORSWOT paper: the tombstone-elimination construction, the version-vector causal context, and the correctness argument for no-resurrection. The primary source for this entire document.
- **Preguiça, Baquero, Almeida, Fonte, Gonçalves** — "Dotted Version Vectors: Logical Clocks for Optimistic Replication" / "Brief Announcement: Efficient Causality Tracking in Distributed Storage Systems with Dotted Version Vectors." The DVV machinery: dots, dot stores, and `O(replicas)` causality tracking for registers.
- **Almeida, Shoker, Baquero (2018)** — "Delta State Replicated Data Types" (JPDC). Delta-mutation for state-based CRDTs, including delta-ORSWOT — how to ship only the changed dots plus a minimal causal context instead of full state.
- **Baquero, Almeida, Lerche** — work on **causal stability** and the join-decomposition / digest-driven anti-entropy that underpins safe GC; the theoretical basis for "collect only stable dots."
- **Riak DT source** — `riak_dt_orswot.erl` and `riak_dt_map.erl` in the `basho/riak_dt` repository. The canonical production ORSWOT and observed-remove Map, with the actor-id discipline, minimal-dot-set maintenance, and merge exactly as described here. Reading the Erlang merge function next to §3 is the single most clarifying exercise.
- **Akka Distributed Data documentation** — `ORSet`, `ORMap`, `LWWMap`, `PNCounterMap`. A second production implementation (JVM) with a different API but the same dot/version-vector core; useful for seeing the recursive map construction in another language.
- **Kleppmann & Beresford, "A Conflict-Free Replicated JSON Datatype" (2017)** — extends the OR-Map/MV-Register stack to full nested JSON, the conceptual lineage from sets and maps to Automerge-style documents.
