# Set CRDTs — Interview Questions

A focused question bank on the four canonical set CRDTs — **G-Set**, **2P-Set**, **LWW-Element-Set**, and **OR-Set / ORSWOT** — built to surface the one idea every interviewer is probing: *adds are easy, removes are hard, and how you make remove safe is the whole design space.*

Pair this with the [CRDT Fundamentals interview](../01-crdt-fundamentals/interview.md) for the semilattice/merge theory and the [Counters interview](../03-counters-g-pn/interview.md) for the simpler G-Counter/PN-Counter warm-up. For depth progression see [junior](junior.md), [senior](senior.md), and [professional](professional.md).

---

## Table of Contents

- [Conceptual](#conceptual)
- [The Four Designs](#the-four-designs)
- [Why Remove Is Hard](#why-remove-is-hard)
- [OR-Set & Add-Wins](#or-set--add-wins)
- [ORSWOT & Tombstone GC](#orswot--tombstone-gc)
- [LWW & Data Loss](#lww--data-loss)
- [System Design](#system-design)
- [Gotcha / Trick](#gotcha--trick)
- [Rapid-Fire](#rapid-fire)
- [Common Mistakes](#common-mistakes)
- [Tips & Summary](#tips--summary)

---

## Conceptual

### Q1: What is a set CRDT, and why is a plain replicated set not one? *(Easy)*

**Answer**: A **set CRDT** is a replicated set whose concurrent updates on different replicas can be merged deterministically into the same final state on every replica, with no coordination, no consensus, and no matter what order updates arrive in. Convergence is guaranteed by construction: the merge is a **join** over a semilattice (commutative, associative, idempotent), so replicas that have seen the same set of updates are byte-for-byte identical.

A "plain" replicated set — say, you ship `add(x)` and `remove(x)` operations and apply them as they arrive — is **not** a CRDT, because the result depends on delivery order. If replica A applies `add(x)` then `remove(x)` while replica B applies `remove(x)` then `add(x)`, they diverge. CRDTs eliminate that order-sensitivity. The interesting work is making *remove* order-insensitive, which (as we'll see) is the hard part.

---

### Q2: Why is `add` trivial to make convergent but `remove` is not? *(Medium)*

**Answer**: `add` is trivial because **set union is the perfect merge function**: it's commutative (`A ∪ B = B ∪ A`), associative, and idempotent (`A ∪ A = A`). Those are exactly the semilattice laws a state-based CRDT needs. An add-only set (the **G-Set**) merges by union and is automatically a CRDT — adds can be re-delivered, reordered, duplicated, and the answer never changes.

`remove` breaks this. To remove an element you'd want to *subtract* it, but set difference is **not** monotone and **not** commutative with respect to union. If replica A removes `x` while replica B concurrently re-adds (or just still holds) `x`, then when you merge by union, `x` reappears — the remove is silently undone. This is the **resurrection problem**: a naive union-based merge cannot distinguish "I added x" from "I removed x and you didn't know yet." Every set-CRDT design is essentially a different answer to *how do we record removes so that union still works?*

---

### Q3: What does it mean for two concurrent operations on a set to "conflict," and who resolves it? *(Medium)*

**Answer**: For sets the only real conflict is **concurrent add(x) and remove(x)** on the same element on different replicas with no causal ordering between them. (Two adds of the same element don't conflict — union handles it. Two removes don't conflict either.) The conflict is: after the dust settles, is `x` in the set or not?

There is **no universally correct answer** — it's a semantic choice the *designer* must make up front, baked into the data type:

- **Add-wins** (OR-Set, ORSWOT): a concurrent add beats a concurrent remove → `x` is present.
- **Remove-wins** (a variant, less common): a concurrent remove beats a concurrent add → `x` is absent.
- **Last-writer-wins** (LWW-Set): whichever has the later timestamp wins, add or remove.

The CRDT doesn't "resolve" conflicts at merge time by asking a human; it resolves them *deterministically* by the rule chosen at design time. Choosing the rule is the actual design decision, and the right choice depends on the application (more in [System Design](#system-design)).

---

## The Four Designs

### Q4: Describe the G-Set. What can and can't it do? *(Easy)*

**Answer**: **G-Set** = Grow-only Set. State is a single set `S`. Operations: `add(x)` inserts into `S`; `lookup(x)` is `x ∈ S`. Merge is **union**: `merge(A, B) = A ∪ B`.

- **Pros**: dead simple, trivially a CRDT (union is a join), no metadata, no resurrection issues.
- **Cons**: **no remove, ever.** Once an element is in, it's in forever.

G-Sets are the foundation everything else builds on. They're genuinely useful when you never need removal — e.g., the set of nodes that have *ever* joined a cluster, a set of observed event IDs for dedup, the set of "seen" tombstone identifiers. Whenever someone says "but how do I delete?", the answer is "you've left G-Set territory and now you need tombstones or tags."

---

### Q5: Describe the 2P-Set and its core limitation. *(Medium)*

**Answer**: **2P-Set** = Two-Phase Set. It's literally two G-Sets:

- `A` — the **add set** (elements ever added).
- `R` — the **remove set**, often called the **tombstone set** (elements ever removed).

Operations: `add(x)` → `A.add(x)`. `remove(x)` → `R.add(x)` (typically only allowed if `x ∈ A`). `lookup(x)` → `x ∈ A ∧ x ∉ R`. Merge = union both sets independently: `(A₁∪A₂, R₁∪R₂)`.

Because remove is "add to the tombstone set" and the tombstone set is itself a G-Set (union-merged), removes are now monotone and convergent — resurrection is impossible. But this buys convergence at the cost of a brutal limitation:

> **Once `x` is in `R`, it can never be in the set again.** Re-adding `x` is a no-op, because `lookup` still sees `x ∈ R`.

This is the **"no re-add"** limitation, and it's the single most common 2P-Set interview question. It's the price of using a permanent tombstone keyed by *element value*.

---

### Q6: Describe the LWW-Element-Set. *(Medium)*

**Answer**: **LWW-Element-Set** = Last-Writer-Wins Element Set. Like the 2P-Set it keeps an add set and a remove set, but each entry carries a **timestamp**: `A` is a map `element → latest-add-timestamp`, `R` is a map `element → latest-remove-timestamp`.

- `add(x, t)` → record `t` in `A` if it's newer than the current `A[x]`.
- `remove(x, t)` → record `t` in `R` if newer than current `R[x]`.
- `lookup(x)` → `x ∈ A` **and** (`x ∉ R` **or** `A[x] > R[x]`). I.e., `x` is present iff its newest add timestamp beats its newest remove timestamp.

Merge takes, per element, the max timestamp on each side. Crucially, **LWW-Set supports re-add**: if you remove `x` at `t=5` then add it again at `t=10`, the add timestamp wins and `x` is back. This fixes the 2P-Set's no-re-add flaw. The cost: you've now introduced clocks, and clocks introduce ties and skew (see [LWW & Data Loss](#lww--data-loss)).

---

### Q7: Describe the OR-Set at a high level. *(Medium)*

**Answer**: **OR-Set** = Observed-Remove Set (also "Add-Wins Set"). The key insight: instead of tracking elements by *value*, track each *individual add* with a globally **unique tag** (a UUID, or a `(replica-id, counter)` dot). The state is a set of `(element, tag)` pairs.

- `add(x)` → generate a fresh unique tag `t`, insert `(x, t)`.
- `remove(x)` → remove **all `(x, t)` pairs the removing replica has currently observed** — and only those.
- `lookup(x)` → there exists at least one live `(x, t)` pair.

The "observed" qualifier is the whole trick. A remove only kills the specific add-tags it has seen. If another replica concurrently does a *fresh* add with a *new* tag, that new tag wasn't observed by the remover, so it survives the merge — hence **add-wins**. And because every add gets a brand-new tag, re-adding after a remove just creates a new tag and works perfectly. OR-Set is the workhorse design behind real systems (Riak's sets, Akka Distributed Data, Redis-CRDT). ORSWOT is its space-optimized cousin (see [ORSWOT & Tombstone GC](#orswot--tombstone-gc)).

---

## Why Remove Is Hard

### Q8: Walk through the resurrection bug with a concrete union-merge example. *(Medium)*

**Answer**: Take the naive "single set, union merge, remove = set difference" design. Two replicas, both start with `{x}`.

1. Replica A: `remove(x)` → A's local state is `{}`.
2. Replica B: does nothing — B's local state is still `{x}`. (Or B concurrently `add(x)` again — same outcome.)
3. They sync. Merge is union: `{} ∪ {x} = {x}`.

Result: `x` is back. A's remove was silently lost. The merge can't tell whether `x ∈ B` means "B added x" (keep it) or "B simply hadn't learned about A's remove yet" (drop it). Union always keeps it — that's **resurrection**.

The general lesson: **a remove must leave a positive, monotone trace that survives merge**, because union can only ever *add* information, never subtract it. 2P-Set's trace is a value-keyed tombstone; OR-Set's trace is "the set of tags I removed." Both turn "remove" into "add something to a grow-only structure," which is the only way to stay inside the semilattice.

---

### Q9: Why can't we just attach a timestamp and "the later op wins" without thinking harder? *(Hard)*

**Answer**: You *can* — that's LWW-Element-Set, and it does converge. The catch is that "later op wins" only resolves a conflict; it doesn't make the resolution *desirable*. Two problems:

1. **You need a real notion of "later."** Wall-clock timestamps drift between machines; a node with a fast clock wins every conflict. Concurrent ops can also get the *same* timestamp, forcing an arbitrary tiebreaker. So LWW is convergent but exposes you to **clock skew data loss**: a remove issued causally *after* an add can lose to it because the remover's clock was slow.

2. **LWW makes a global, total decision per element**, collapsing all concurrency to "whoever had the max timestamp." That throws away information. OR-Set instead resolves at the granularity of *individual adds via unique tags*, which lets it implement add-wins cleanly and support re-add without depending on synchronized clocks. The deeper point: timestamps give convergence cheaply but tie correctness to clock quality; tags give convergence *and* skew-independence at the cost of metadata. "Just use a timestamp" is the right answer only when occasional clock-skew-driven loss is acceptable.

---

### Q10: Restate the central trade-off across all four set CRDTs in one frame. *(Medium)*

**Answer**: Every design answers "how do I record a remove so union still converges?" and pays a different price:

| Design | Remove mechanism | Re-add? | Concurrent add/remove | Metadata cost |
|---|---|---|---|---|
| **G-Set** | none | n/a | n/a | none |
| **2P-Set** | value-keyed tombstone (permanent) | **No** | remove-wins (once removed, gone) | grows forever (tombstones) |
| **LWW-Set** | timestamped remove | Yes | timestamp-wins | per-element timestamps |
| **OR-Set** | remove only *observed* tags | Yes | **add-wins** | per-add unique tags |
| **ORSWOT** | observed-remove via **version vectors** | Yes | add-wins | version vector + live dots (no per-element tombstones) |

The progression is a story of *paying more metadata to recover more semantics*: G-Set gives up remove; 2P-Set gives up re-add; LWW recovers re-add but couples to clocks; OR-Set recovers clean add-wins + re-add via tags; ORSWOT keeps OR-Set semantics while slashing the tag/tombstone bloat using version vectors.

---

## OR-Set & Add-Wins

### Q11: Explain precisely how OR-Set's unique tags produce add-wins on a concurrent add/remove. *(Hard)*

**Answer**: Start with both replicas holding `{(x, t₁)}` — `x` was added once with tag `t₁`.

- Replica A: `remove(x)`. A has observed only `t₁`, so it removes `(x, t₁)`. A's live state: `{}`.
- Replica B (concurrently): `add(x)`. B generates a **fresh** tag `t₂` and inserts `(x, t₂)`. B's live state: `{(x, t₁), (x, t₂)}`.

Now merge. The merge keeps a tag iff it's been added somewhere and *not* removed by a replica that observed it. `t₁` was added (in the original) and removed by A → it dies. `t₂` was added by B and **was never observed by A's remove** (A removed before learning of `t₂`) → it lives. Final state: `{(x, t₂)}`, so `lookup(x) = true`.

The concurrent add won. The mechanism is purely local: A's remove is scoped to the tags A *had seen*, so any concurrent add carrying a new, unseen tag is structurally immune. This is why OR-Set is also called the **Add-Wins Observed-Remove Set** — "observed" describes the remove, "add-wins" describes the conflict outcome they produce together.

---

### Q12: Why does OR-Set support re-add when 2P-Set doesn't? *(Medium)*

**Answer**: 2P-Set tombstones by **value**: once `x ∈ R`, `lookup` permanently subtracts it, no matter how many times you "add" `x` again — adds touch only `A`, and `x ∈ R` still vetoes. There's no way to express "this is a *new* `x` that should override the old removal."

OR-Set tombstones by **tag**, and every add mints a *new* tag. Re-adding `x` after a remove just creates `(x, t_new)`. The old removal only killed the old tags it observed; it says nothing about `t_new`. So `lookup(x)` sees a live pair and returns true. The element value being "the same `x`" is irrelevant — what matters is that the new add carries an identity (the tag) that no prior remove could have observed. That indirection from value to tag is exactly what restores re-add.

---

### Q13: What is a "dot" and how does it relate to OR-Set tags? *(Hard)*

**Answer**: A **dot** is a compact unique tag of the form `(replica-id, counter)` — e.g., `(B, 7)` means "the 7th event originated at replica B." Instead of random UUIDs, replicas mint dots from a per-replica monotonically increasing counter. Dots are globally unique (no two replicas share an id) and, unlike UUIDs, they're **summarizable**: the set of dots a replica has seen from replica B is just a contiguous range `B:1..n`, compressible into a single integer per replica — a **version vector**.

This summarizability is the bridge from OR-Set to ORSWOT. With UUID tags you can't compactly say "I've observed all of B's adds"; with dots you can. ORSWOT exploits this to replace the unbounded tombstone/tag bloat with a bounded version vector plus the currently-live dots. (See the next section.)

---

### Q14: In an OR-Set, can you remove an element you've never observed? What happens? *(Medium)*

**Answer**: **No — and it's a no-op, which is the correct and safe behavior.** `remove(x)` removes only the `(x, tag)` pairs *currently in this replica's observed state*. If the replica has never seen any `(x, ·)` pair, there's nothing to remove; the operation removes the empty set of tags and changes nothing.

This matters for correctness. Suppose replica A removes `x` while its state is empty (it never saw `x`), and concurrently replica B adds `(x, t)`. Since A's remove observed no tags for `x`, it can't kill `t`. After merge, `(x, t)` is live and `x` is present — add-wins holds. If "remove an unobserved element" *did* somehow create a value-keyed veto, OR-Set would resurrect the 2P-Set no-re-add bug and break add-wins. The observed-remove rule — *you can only remove what you've seen* — is precisely what keeps the semantics clean.

---

### Q15: Show how OR-Set's add-wins resolves a true concurrent add vs remove tie. *(Medium)*

**Answer**: Concurrent means *no causal ordering* between the two ops. Replicas A and B both start from `{(x, t₁)}`.

- A: `remove(x)` (observes `t₁`) → kills `t₁`.
- B: `add(x)` → mints `t₂`.

Neither op is causally after the other. At merge, OR-Set's rule is: an element is present iff **at least one** of its added tags is not yet removed-by-an-observer. `t₁` is gone, `t₂` is alive → `x` present. Add wins.

Contrast remove-wins: a remove-wins set would let a concurrent remove suppress concurrent adds, so `x` would be absent. Both are valid CRDTs; OR-Set deliberately picks add-wins because for most user-facing data (carts, friend lists, tags) "accidentally keeping something" is safer than "accidentally losing something the user just added." You choose; the type encodes the choice.

---

## ORSWOT & Tombstone GC

### Q16: What problem does ORSWOT solve over the basic OR-Set? *(Medium)*

**Answer**: **ORSWOT** = Observed-Remove Set **Without Tombstones**. The plain OR-Set accumulates metadata forever: every add leaves a tag, and to remember which tags were removed you keep tombstone records. Over millions of add/remove cycles this metadata dwarfs the actual elements — a set with 10 live items might carry megabytes of dead tags. That's the **metadata-growth / GC problem**.

ORSWOT keeps the exact same *semantics* (observed-remove, add-wins, re-add works) but represents state as:

1. A **version vector** (a.k.a. context/clock) summarizing every dot the replica has ever observed, per originating replica.
2. A map of **currently-live elements → the set of live dots** supporting them.

Crucially it stores **no explicit per-removed-tag tombstones**. A removed element's dots are simply dropped from the live map; the *fact that they were observed* survives implicitly in the version vector. This is the whole win: tombstones become implicit and bounded (one entry per replica) instead of explicit and unbounded (one per remove).

---

### Q17: How does ORSWOT remove tombstones using version vectors, yet not resurrect re-delivered adds? *(Hard)*

**Answer**: This is the crux ORSWOT question. The merge of two ORSWOT states compares, for each element, the live dots on each side against the **other replica's version vector (context)**. The rule for keeping a dot `d` for element `x`:

- `d` is **live on both** sides → keep it.
- `d` is **live on A only**: keep it *unless* B's version vector already **covers** `d` (i.e., B has observed `d`). If B observed `d` but doesn't list it as live, B must have **removed** it → drop `d`. If B has *not* observed `d` at all, it's a **concurrent add** B simply hasn't seen → **keep** it (add-wins).
- Symmetrically for dots live on B only.

That single distinction — *"does your context cover this dot?"* — is what separates a **remove** from a **not-yet-delivered add**:

- **Re-delivered / duplicate add**: the dot is already in the receiver's version vector. The receiver knows it removed that dot, so it correctly **does not resurrect** it. The version vector is the memory that says "I've seen this; I deleted it on purpose."
- **Genuinely concurrent add**: the dot is *outside* the receiver's version vector, so it's preserved — add-wins.

So the version vector replaces an unbounded pile of tombstones with one compact clock that answers "have I seen this dot before?" — exactly the question needed to avoid resurrection without storing every dead tag.

---

### Q18: Why doesn't ORSWOT need explicit tombstones at all, then? *(Hard)*

**Answer**: Because the version vector *is* the tombstone — in aggregate, implicit form. A traditional tombstone is a record saying "tag t was removed; don't resurrect it." ORSWOT's version vector says "I have observed all dots up to `(A:5, B:9, C:2)`." For any dot in that covered range that is **not** in my live map, the only explanation is "it was added (so I observed it) and then removed (so it's not live)" — i.e., it's tombstoned, deduced rather than stored.

This collapses N individual tombstones into one O(replicas) version vector. The trade is that you can only *summarize* removes this way when dots are dense and contiguous per replica (which they are, since each replica mints a monotonic counter). You cannot do this with random UUID tags — there's nothing to summarize — which is exactly why ORSWOT requires dot-based tags. The cost ORSWOT can't fully escape: the version vector grows with the number of replicas that have *ever* participated, and "actor explosion" (many ephemeral replica ids) re-inflates it — a real operational concern handled by reusing stable actor ids and pruning retired ones.

---

### Q19: What does merge do to tombstones / removed elements in general? *(Medium)*

**Answer**: Depends on the design, and this is a favorite trick question:

- **2P-Set**: merge **unions** the tombstone sets. Tombstones are permanent and only grow. A removed element stays removed across all merges, forever — that's the no-re-add limitation surfacing.
- **OR-Set (with explicit tombstones)**: merge unions live tags and unions removed-tag tombstones; an element is live iff it has a tag that no merged tombstone covers. Tombstones accumulate (hence GC pressure).
- **ORSWOT**: merge **unions the version vectors** and reconciles live dots against the other side's context (per Q17). There are no explicit tombstones to merge — "tombstone state" is folded into the version vector. A removed element's dots get dropped *unless* a concurrent add re-introduces a dot outside the other's context.

The unifying rule: **merge never resurrects something both sides have causally seen-and-removed**, and merge **always preserves a concurrent add**. How "seen-and-removed" is recorded (permanent value tombstone, removed-tag set, or version vector) is what differs.

---

### Q20: When and how can you safely garbage-collect set-CRDT metadata? *(Hard)*

**Answer**: General principle: **a tombstone (or dead dot) is safe to GC once every replica has observed it**, because after that no future merge can carry an older concurrent add that the tombstone needed to suppress. Determining "every replica has seen it" requires knowing the slowest replica's progress — a **causal stability** condition.

Mechanisms:

- **2P-Set**: essentially *cannot* GC safely in the open case — a long-partitioned or future replica might still ship an old add for a tombstoned element, and you'd have to keep the tombstone to suppress it. This is why 2P-Sets are avoided at scale.
- **OR-Set / ORSWOT**: prune dead dots once they're **causally stable** — i.e., covered by the *minimum* version vector across all replicas (often gathered via a stability protocol or a coordinator computing the elementwise-min clock). ORSWOT additionally compacts naturally: removed dots simply vanish from the live map; the version vector is already bounded by replica count.
- **Actor pruning**: retire version-vector entries for replicas that are permanently gone, which requires confidence they'll never return with stale data (tricky; usually handled with epochs or operator action).

The honest interview answer: **GC requires global knowledge (causal stability), which partly reintroduces coordination** — so it's a real cost, not free, and ORSWOT's value is minimizing how much you must GC, not eliminating GC entirely.

---

## LWW & Data Loss

### Q21: How does LWW-Set break ties, and why are ties dangerous? *(Medium)*

**Answer**: A tie is when an add and a remove (or two ops) for the same element carry the **same timestamp**. LWW must still converge deterministically, so it applies a fixed tiebreaker — commonly "remove wins on tie" (bias toward absence) or "add wins on tie" (bias toward presence), or a tiebreak by replica id. Whatever the rule, it must be *total and identical on all replicas*, or they diverge.

Ties are dangerous because the tiebreaker is **arbitrary** with respect to user intent. If two real, independent operations collide on the same millisecond timestamp, the outcome is decided by, say, lexicographic replica id — not by what the user wanted. With coarse clocks (1-second granularity) ties are common, and a systematic tiebreaker like "remove wins" silently and repeatedly drops adds under load. The fix is finer/unique timestamps (e.g., `(physical-time, replica-id, counter)` or a hybrid logical clock), but you can never make ties *meaningful* — only rarer.

---

### Q22: Explain clock-skew data loss in LWW-Set with a scenario. *(Hard)*

**Answer**: LWW decides by wall-clock timestamp, assuming "larger timestamp = happened later." Clock skew violates that assumption:

- Replica A's clock runs **5 seconds fast**. At true time 10:00:00, A stamps an event as `10:00:05`.
- A user adds `x` on replica B at true time `10:00:03`, stamped `10:00:03` (B's clock is correct).
- The same user, realizing a mistake, removes `x` on replica A at true time `10:00:04` — **causally after** the add — but A stamps it `10:00:09` (fast clock). Fine, remove wins, correct.
- Now reverse the skew: B is fast, A is slow. A's *causally-later* remove gets a *smaller* timestamp than B's add. LWW keeps the add. **The user's later remove is silently lost.**

This is **clock-skew data loss**: LWW can invert causality, letting an older operation beat a newer one purely because of clock drift. No merge error, no exception — the wrong element state just becomes durable on every replica. It's why LWW is "convergent but lossy," and why systems that can't tolerate dropped writes prefer OR-Set/ORSWOT, which don't depend on synchronized clocks for correctness.

---

### Q23: Is LWW-Set always safe? When is it actually the right choice? *(Medium)*

**Answer**: **No, LWW-Set is not always safe** — it can silently drop the causally-later of two concurrent (or even falsely-ordered) operations due to clock skew and ties. "Safe" here means "never loses an operation that should have won," and LWW cannot promise that without a perfect global clock, which doesn't exist.

LWW *is* the right choice when:

- The data is **single-value-ish per key** and "latest wins" matches user intent (a user profile field, a presence/status flag, a feature toggle's last-set value).
- **Occasional loss of a concurrent update is acceptable** — losing one of two near-simultaneous edits to the same field is tolerable.
- You have **good clocks** (NTP-disciplined, or hybrid logical clocks) so skew is small.
- You value **minimal metadata** (just timestamps) over the richer semantics of OR-Set.

It's the wrong choice for sets where losing a user's add is bad (shopping carts, collaborative collections) — there, add-wins OR-Set/ORSWOT is the standard answer.

---

## System Design

### Q24: Design a replicated shopping cart. Which set CRDT, and why — and what's the Dynamo anomaly? *(Hard)*

**Answer**: Model the cart as a **set of items** (or a map of item → quantity built on an OR-Set/PN-Counter combo). For the membership part, use an **OR-Set / ORSWOT (add-wins)**.

Reasoning: a cart is the canonical case where **losing a user's add is the bad failure** and **resurrecting a deleted item is also bad — but adding-wins is the lesser evil**. Add-wins guarantees that if a user adds an item on their phone while concurrently the cart syncs from a stale replica, the item survives. Re-add works (remove then re-add a product) because each add mints a new tag.

The famous **Amazon Dynamo shopping-cart resurrection anomaly**: Dynamo used vector-clock-versioned values and, on concurrent writes, did **sibling reconciliation** with a merge that *unioned* cart contents. The practical effect was that **deleted items could reappear** — a customer removes an item, but because a concurrent/stale version still contained it, the union-merge resurrected it. This is the resurrection problem (Q8) showing up in production. The lesson the CRDT literature drew: union-merge gives you add-wins-flavored resurrection "for free," which is *acceptable for carts* (better to show an extra item than to lose an add), but if you want principled, GC-able semantics you should use an OR-Set/ORSWOT rather than ad-hoc value union — and if you truly need removes to stick, you need a different (remove-wins or LWW) policy and must accept its costs.

---

### Q25: Design a replicated "friends list" / social connections set. *(Medium)*

**Answer**: Use an **OR-Set (add-wins)** keyed by friend-id, replicated across regions.

- `add(friendId)` and `remove(friendId)` (unfriend) map directly to OR-Set ops.
- **Add-wins** means: if you concurrently friend someone on one device while a stale replica thinks you'd removed them, the friend relationship survives — generally the user-friendly default ("I just added them, keep it").
- **Re-add works**: unfriend then re-friend is common and must succeed — OR-Set handles it via new tags; a 2P-Set would *permanently* forbid re-friending, which is a non-starter.

Caveats to raise: friendship is often **bidirectional**, so you may keep two OR-Sets (A's friends, B's friends) and reconcile, or model it as edges. And **privacy/removal semantics** sometimes demand *remove-wins* ("when I block/unfriend, it MUST stick even against a concurrent add") — if so, you'd choose a remove-wins set or layer a block-list with stronger guarantees. The interview point: state the add-wins-vs-remove-wins choice explicitly and justify it from product requirements, don't just say "OR-Set."

---

### Q26: Design a "presence" set (who's online) for chat. *(Medium)*

**Answer**: Presence is interesting because it's **ephemeral and time-bounded**, so a pure OR-Set isn't the cleanest fit. Two good designs:

1. **OR-Set + TTL/heartbeat**: members are added on connect, removed on disconnect. Use **add-wins** so a reconnect (concurrent add) beats a stale "left" event — you'd rather briefly show someone online than wrongly show them offline. Layer a **TTL**: each presence entry expires unless refreshed by a heartbeat, which sidesteps the "missed disconnect → ghost online" problem and also bounds metadata (expired entries GC naturally).
2. **LWW-Set keyed by (user → last-seen-timestamp)**: presence = "seen within last N seconds." LWW is actually *acceptable* here because presence is inherently last-writer-wins semantics ("most recent heartbeat wins") and **transient loss is harmless** — a wrong presence flash for a second is fine. Clock skew matters less when entries expire quickly.

The discriminator: presence tolerates loss and is time-decayed, so either add-wins-with-TTL or LWW works; you'd pick LWW for minimal metadata and OR-Set+TTL if you also want richer per-session tracking.

---

### Q27: Design a replicated set of feature flags (which flags are enabled). *(Medium)*

**Answer**: Model "enabled flags" as a set; choose the policy by *failure preference*:

- **Add-wins (OR-Set)** if "accidentally enabling" is safer than "accidentally disabling" — rarely true for risky features.
- **Remove-wins** if "when someone disables a flag, it MUST stay disabled" (e.g., a kill-switch) — you want the *off* state to dominate concurrent enables. This is a legitimate case where **remove-wins beats add-wins**.
- **LWW-Set** if flags are toggled by a single control plane and "latest operator action wins" is exactly the intent — usually the pragmatic choice, since flag changes are administrative, low-concurrency, and you *want* the most recent setting. Good clocks (it's your control plane) make LWW's skew risk small.

The takeaway: feature flags are the textbook case where the answer isn't "add-wins OR-Set by default." Safety-critical kill-switches push toward **remove-wins**, and admin-driven toggles push toward **LWW**. State the failure mode you're optimizing against, then pick.

---

### Q28: How do you bound metadata growth in a long-lived production set CRDT? *(Hard)*

**Answer**: A layered answer:

1. **Pick the right type.** Avoid 2P-Set (unbounded permanent tombstones, no GC). Prefer **ORSWOT**, whose tombstones are implicit in a version vector bounded by *replica count*, not *operation count*.
2. **Use dots, not UUIDs**, so observed-history is summarizable into version vectors (enables GC and compact merge).
3. **Causal stability GC**: prune dead dots once they're covered by the elementwise-min version vector across all replicas; drive this with a periodic stability protocol.
4. **Control actor cardinality**: reuse stable replica/actor ids; don't mint a new actor per client session, or the version vector explodes ("actor explosion"). Prune retired actors via epochs.
5. **Delta-CRDTs**: ship deltas instead of full state to bound *bandwidth*, an orthogonal but related cost.
6. **Cap set size / use TTLs** where semantics allow (presence, sessions), letting entries expire instead of accumulating.

The honest caveat: GC needs global progress knowledge, so it reintroduces a coordination-lite step — the goal is *minimizing* unbounded growth, not pretending it's free.

---

## Gotcha / Trick

### Q29: "Can you remove an element you never observed in an OR-Set?" *(Medium)*

**Answer**: **No.** Remove in OR-Set deletes only the `(element, tag)` pairs *currently observed* by the removing replica. Never having observed the element means there are zero such pairs, so the remove is a **no-op**. This is by design and is exactly what preserves add-wins: a remove that "saw nothing" cannot suppress a concurrent add that carries a tag the remover never saw. If OR-Set allowed value-level removal of unobserved elements, it would resurrect the 2P-Set bug. The crisp soundbite: *you can only remove what you've seen.*

---

### Q30: "Does a 2P-Set let you re-add an element after removing it?" *(Easy)*

**Answer**: **No.** Once `x` enters the tombstone (remove) set `R`, `lookup(x) = x ∈ A ∧ x ∉ R` is permanently false, because `R` is a grow-only set and `x` can never leave it. A subsequent `add(x)` only re-inserts into `A`, which `R` still vetoes. This permanent no-re-add is the defining limitation of 2P-Set and the reason it's rarely used in practice; OR-Set/LWW-Set both fix it (via new tags and via newer timestamps, respectively).

---

### Q31: "What does merge do to tombstones?" *(Medium)*

**Answer**: It **never removes information about a removal** — merge is monotone. Concretely: 2P-Set merge *unions* tombstone sets (they only grow, permanent). OR-Set merge *unions* removed-tag info and keeps an element iff some live tag is uncovered by tombstones. ORSWOT merge *unions version vectors* and reconciles live dots against the other side's context, with no explicit tombstones to merge — removal knowledge lives in the version vector. The invariant across all: **after merge, anything both replicas have causally observed-and-removed stays removed; any concurrent add is preserved.** Merge can resurrect *only* via a genuinely concurrent re-add, never via a re-delivered old one.

---

### Q32: "Is LWW-Set always safe against data loss?" *(Medium)*

**Answer**: **No.** LWW-Set can silently drop the causally-later of two operations when clock skew makes it carry the smaller timestamp, and it makes arbitrary decisions on timestamp ties. It always *converges*, but convergence and safety aren't the same thing — it converges on the *possibly-wrong* value. It's only "safe enough" when clocks are well-disciplined, loss of a concurrent update is acceptable, and last-writer-wins matches intent. For sets where losing a user's add is unacceptable, use add-wins OR-Set/ORSWOT.

---

### Q33: "Two replicas both `add(x)` independently, each with its own tag, then one removes. Is x present?" *(Hard)*

**Answer**: Depends on *when* the remove happened relative to observing the other add. Say A adds `(x, t_A)` and B adds `(x, t_B)` concurrently, then they sync so both hold `{(x, t_A), (x, t_B)}`. Now A does `remove(x)`: A has observed **both** tags, so it removes both → `x` absent everywhere after merge. But if A removes *before* learning of `t_B` (A only saw `t_A`), it kills `t_A` only; `t_B` survives → `x` present (add-wins). The trick is that "remove(x)" isn't atomic over the value — it's "remove the tags I've observed," so the answer hinges on which tags were in A's observed state at remove time. This is the most common subtle OR-Set mistake.

---

### Q34: "If I re-deliver an old add message after a remove, does the element come back?" *(Hard)*

**Answer**: **No — in a correctly built OR-Set/ORSWOT.** The re-delivered add carries an *old* tag/dot that the removing replica has already **observed** (it's in the version vector / it was the very tag the remove killed). Because the receiver's context already covers that dot, merge treats it as "seen and removed," not "new," and does **not** resurrect it. This is precisely the property ORSWOT's version vector buys you (Q17): the clock remembers "I've seen this dot," distinguishing a duplicate/late add (drop) from a concurrent add (keep). If a system *does* resurrect on re-delivered adds, it's a bug — likely it's doing naive value-union (the Dynamo anomaly), not true observed-remove.

---

## Rapid-Fire

Short, sharp answers — the kind you'd fire back in 10 seconds.

1. **Merge function for G-Set?** Set union.
2. **What two sets make a 2P-Set?** Add set `A` and remove (tombstone) set `R`.
3. **2P-Set lookup predicate?** `x ∈ A ∧ x ∉ R`.
4. **2P-Set's fatal limitation?** No re-add after remove.
5. **Why can't union-merge support remove naively?** It resurrects removed elements (union only adds info).
6. **OR-Set's core trick?** Tag every add with a globally unique id; remove only observed tags.
7. **OR-Set conflict policy?** Add-wins.
8. **Does OR-Set support re-add?** Yes — each add mints a fresh tag.
9. **What's a "dot"?** A unique tag `(replica-id, counter)`.
10. **ORSWOT expands to?** Observed-Remove Set Without Tombstones.
11. **How does ORSWOT avoid explicit tombstones?** A version vector summarizes observed dots; live map holds the rest.
12. **What distinguishes a remove from a late add in ORSWOT merge?** Whether the receiver's version vector already covers the dot.
13. **LWW-Set decides conflicts by?** Latest timestamp (add-ts vs remove-ts per element).
14. **LWW-Set's main risk?** Clock-skew / tie data loss.
15. **Add-wins vs remove-wins — who chooses?** The designer, up front; it's a semantic choice, not automatic.
16. **The Dynamo cart anomaly?** Deleted items resurrect under union-based sibling merge.
17. **Safe to GC a tombstone when?** Once every replica has observed it (causal stability).
18. **Can you remove an unobserved element in OR-Set?** No — it's a no-op.

---

## Common Mistakes

### Q35: What are the most common mistakes candidates make on set CRDTs? *(Medium)*

**Answer**:

1. **Claiming union-merge "just works" for remove.** It doesn't — it resurrects. Removes need a positive, monotone trace (tombstone/tag/version-vector).
2. **Saying 2P-Set supports re-add.** It permanently doesn't; that's its signature flaw.
3. **Treating OR-Set's remove as value-level.** It's *observed-tag*-level — "remove the tags I've seen," which is the whole reason add-wins and re-add work.
4. **Thinking LWW-Set is "the safe default."** It converges but loses writes under clock skew and ties; never call it safe without qualifying.
5. **Forgetting that add-wins vs remove-wins is a *design choice*.** Interviewers want you to name the choice and justify it from requirements (cart → add-wins; kill-switch → remove-wins).
6. **Hand-waving metadata growth.** Real systems live and die on tombstone GC; not mentioning version vectors / causal stability / actor explosion signals shallow understanding.
7. **Confusing convergence with correctness.** All four converge; they differ in *which* outcome they converge to, and whether that outcome loses information.
8. **Resurrecting on re-delivered adds.** A correct observed-remove set must NOT resurrect a duplicate old add — only a genuinely concurrent one. Mixing these up is the Dynamo bug.

---

### Q36: A candidate says "I'll just keep a timestamp per element and take the max on merge — done." What's missing? *(Hard)*

**Answer**: That's LWW-Set, and they've skipped four things: (1) you need **separate** add and remove timestamps (or a sign), or you can't represent "removed"; (2) you must define a **deterministic tiebreaker** for equal timestamps or replicas diverge; (3) you're now exposed to **clock-skew data loss** and have said nothing about clock discipline (NTP / hybrid logical clocks); and (4) you've **chosen LWW semantics implicitly** without checking whether the application can tolerate losing concurrent writes. The right move is to surface the trade: LWW is fine for low-concurrency, last-writer-wins, loss-tolerant data with good clocks — and the *wrong* tool for carts/friend-lists where add-wins OR-Set/ORSWOT avoids clock dependence and loss. Naming the trade-off, not just the algorithm, is what passes the question.

---

## Tips & Summary

### Q37: Give a one-paragraph mental model to walk into the interview with. *(Easy)*

**Answer**: *Adds are free because union is a join; removes are the entire problem because union can't subtract.* Each design records removes differently and pays a different price: **G-Set** can't remove; **2P-Set** uses permanent value-tombstones and so can't re-add; **LWW-Set** timestamps removes so re-add works but couples correctness to clocks (skew/tie data loss); **OR-Set** tags every add uniquely and removes only *observed* tags, giving clean **add-wins** plus re-add; **ORSWOT** keeps OR-Set semantics but replaces unbounded tombstones with a compact **version vector**, which also remembers "I've seen this dot" so re-delivered old adds don't resurrect. The recurring villain is **resurrection** (vividly: the Dynamo cart), and the recurring design decision is **add-wins vs remove-wins**, which *you* must choose from the application's failure preference.

### Key tips

- **Lead with the asymmetry**: "add is trivial via union, remove is hard because union resurrects." It frames every follow-up.
- **Know the four lookup predicates cold** and the one-line flaw of each design.
- For any system-design prompt, **state the conflict policy explicitly** (add-wins / remove-wins / LWW) and justify it from the cost of being wrong.
- Always mention **metadata growth and GC** unprompted for OR-Set/ORSWOT — it's the production reality.
- Separate **convergence** (all four have it) from **correctness/loss** (where they differ).
- Use **ORSWOT's version vector** as the punchline for "how do you avoid tombstone bloat *and* resurrection."

For the underlying semilattice/merge theory revisit the [CRDT Fundamentals interview](../01-crdt-fundamentals/interview.md); for the simpler numeric counterparts see the [Counters interview](../03-counters-g-pn/interview.md). Build depth via [junior](junior.md) → [senior](senior.md) → [professional](professional.md).
