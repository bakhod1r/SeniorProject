# Idempotent Operations — Professional

> **Axis:** technical / theoretical depth. This file treats idempotency as a formal
> algebraic property, proves *why* exactly-once delivery is impossible while
> exactly-once *effect* is achievable, characterizes the algebra of mergeable
> operations, and derives the atomicity requirement that any correct dedup store
> must satisfy. The applied "how do I ship it" material lives in `senior.md`; this
> is the "why is it correct" layer.

## Table of Contents

1. [Formal Definition](#1-formal-definition)
2. [Idempotence vs Commutativity vs Associativity](#2-idempotence-vs-commutativity-vs-associativity)
3. [Why Exactly-Once Delivery Is Impossible](#3-why-exactly-once-delivery-is-impossible)
4. [At-Least-Once + Idempotent Apply = Exactly-Once Effect](#4-at-least-once--idempotent-apply--exactly-once-effect)
5. [The Algebra of Mergeable Operations](#5-the-algebra-of-mergeable-operations)
6. [Connection to CRDTs](#6-connection-to-crdts)
7. [Dedup Keys, Monotonicity, and Fencing Tokens](#7-dedup-keys-monotonicity-and-fencing-tokens)
8. [The Atomicity Requirement (Dedup Check + Effect)](#8-the-atomicity-requirement-dedup-check--effect)
9. [Failure-Model Walkthrough](#9-failure-model-walkthrough)
10. [Comparison Tables and Decision Notes](#10-comparison-tables-and-decision-notes)
11. [Summary and Invariants](#11-summary-and-invariants)

---

## 1. Formal Definition

An operation `f` is **idempotent** with respect to a state space `S` when applying it
one or more times has the same effect on the observable state as applying it exactly
once. Two related but distinct formalizations appear in the literature; keep them
separate because they are used in different places.

**Unary (function idempotence).** A function `f : S → S` is idempotent iff

```text
    ∀ x ∈ S:   f(f(x)) = f(x)
```

Equivalently, `f ∘ f = f`, i.e. `f` is a *projection* (a retraction onto its image).
`f` restricted to its image `f(S)` is the identity: every element already in the
image is a fixed point (`y ∈ f(S) ⇒ f(y) = y`). This is the definition that governs
**state-setting** operations: `SET x := 5`, `DELETE key`, `UPSERT row`, `s := s ∪ {e}`.
Re-applying them from a state that already reflects them changes nothing.

**Binary (element idempotence under an operator).** An element `e` is idempotent under
a binary operator `·` iff `e · e = e`. When *every* element is idempotent
(`∀ x: x · x = x`), the operator itself is called idempotent. This governs **merge**
operations: `max`, `min`, `∪`, `∧`, `∨`, GCD, LCM. Idempotent binary operators are the
algebraic backbone of Section 5.

The two collapse into one practical rule for distributed systems:

> **Idempotency rule.** A request handler is idempotent iff the *net effect on
> persistent state* of processing the request `k ≥ 1` times equals the effect of
> processing it exactly once. The *response* may differ across attempts (that is a
> separate, weaker requirement); the *state* must not.

Two subtleties that trip up otherwise-correct designs:

- **Effect idempotence, not implementation idempotence.** The handler may internally
  do different work on a retry (read a cached result, take a different branch). What
  must be invariant is the externally observable state transition, including all
  side effects: rows written, money moved, emails sent, messages emitted.
- **HTTP method semantics are a claim, not a guarantee.** RFC 9110 §9.2.2 defines
  `PUT`, `DELETE`, `GET`, `HEAD`, and the other safe methods as *idempotent* and
  `POST`/`PATCH` as *not necessarily* idempotent. That is a semantic contract the
  server promises to honor; the runtime does not enforce it. A `PUT` that appends to
  a log is a broken `PUT`. Idempotency is a property you *engineer into the effect*,
  not one you inherit from a verb.

---

## 2. Idempotence vs Commutativity vs Associativity

These three properties are constantly conflated because mergeable data types often
satisfy all three at once. They are logically independent. Precision here is what lets
you reason about which retries and reorderings are safe.

| Property | Definition | What it buys you | Independent of the others? |
|----------|-----------|------------------|----------------------------|
| **Idempotence** | `x · x = x` (or `f(f(x)) = f(x)`) | Safe against **duplicate** delivery | Yes |
| **Commutativity** | `x · y = y · x` | Safe against **reordered** delivery | Yes |
| **Associativity** | `(x · y) · z = x · (y · z)` | Safe against **regrouping / batching** | Yes |

Worked separations (each shows one property holding while another fails):

```text
Idempotent but NOT commutative:
    f(x) = "last-write-wins set to a fixed value V"
    Two setters SET:=A and SET:=B are each idempotent (SET:=A twice == once),
    but A then B ≠ B then A. Duplicates are safe; reorder changes the result.

Commutative but NOT idempotent:
    ordinary integer addition, x + y.
    +5 then +3 == +3 then +5 (commutes), but applying "+5" twice ≠ once.
    Reorder-safe; duplicate-UNSAFE. This is exactly why counters need dedup.

Associative but NOT idempotent:
    string concatenation, (a·b)·c = a·(b·c), but a·a ≠ a.
    Regroup-safe; duplicate-unsafe.

Idempotent AND commutative AND associative (a semilattice — see §5):
    set union ∪, integer max, boolean OR.
    Safe against duplicates, reorder, AND regrouping simultaneously.
```

The load-bearing insight for retry design:

> **Idempotence defeats duplication; commutativity defeats reordering.**
> A network that can *duplicate* messages needs idempotent apply. A network that can
> *reorder* messages needs commutative apply. A real asynchronous network does both,
> so the operations you can apply blindly (no coordination, no dedup log) are exactly
> those that are **both** — that is the algebraic sweet spot Section 5 characterizes.

---

## 3. Why Exactly-Once Delivery Is Impossible

The phrase "exactly-once" is overloaded and the overload causes real production bugs.
Separate two claims:

- **Exactly-once *delivery*** — the transport delivers each message to the receiver
  precisely once. *Impossible* over an unreliable network.
- **Exactly-once *processing / effect*** — the receiver's persistent state reflects
  each logical operation precisely once. *Achievable* (Section 4).

**Impossibility argument for delivery.** Consider a sender `S` and receiver `R`
communicating over a channel that may drop or delay any message (the standard
asynchronous fair-lossy model). `S` sends message `m`. To know whether to resend, `S`
needs to learn whether `R` received it, so `R` must reply with an acknowledgment `a`.
But the channel can drop `a` just as it can drop `m`. Now `S` faces an irreducible
ambiguity:

```text
No ack received by S. Which world are we in?
    World 1:  m was lost.               → S MUST resend, or the message is lost forever.
    World 2:  m arrived, a was lost.     → S resends anyway → R sees a DUPLICATE.
S cannot distinguish World 1 from World 2 from local information.
```

Whatever fixed strategy `S` picks, an adversarial (or merely unlucky) channel forces
an error:

- **Resend on timeout** ⇒ in World 2, `R` receives `m` twice ⇒ *at-least-once*.
- **Never resend** ⇒ in World 1, `R` receives `m` zero times ⇒ *at-most-once*.

There is no third option that is safe in *both* worlds, because the only signal that
would let `S` choose correctly (the ack) is itself subject to loss. This is the same
kernel as the **Two Generals Problem**: no finite exchange of messages over a lossy
channel yields common knowledge of delivery. Hence:

> **Delivery theorem (informal).** Over an asynchronous channel that may lose
> messages, no protocol can guarantee that every message is delivered exactly once.
> Every protocol is either at-most-once (may lose) or at-least-once (may duplicate). ∎

"Exactly-once" systems (Kafka EOS, Flink, transactional outbox pipelines) do **not**
repeal this. They run **at-least-once transport underneath** and add **idempotent /
transactional apply on top** so that duplicates are *absorbed*. What is exactly-once
is the *effect*, never the *delivery*. Marketing says "exactly-once"; the mechanism is
"at-least-once + dedup." Section 4 is that mechanism.

```mermaid
sequenceDiagram
    autonumber
    participant S as Sender
    participant Net as Lossy Channel
    participant R as Receiver
    S->>Net: send m (attempt 1)
    Net-->>R: deliver m
    R-->>Net: ack a
    Net--xS: ack DROPPED
    Note over S: timeout fires — ambiguous:<br/>was m lost, or was the ack lost?
    S->>Net: resend m (attempt 2)
    Net-->>R: deliver m (DUPLICATE)
    Note over R: transport gave R the same<br/>message twice → at-least-once
    Note over S,R: exactly-once DELIVERY is impossible;<br/>R must make apply idempotent
```

---

## 4. At-Least-Once + Idempotent Apply = Exactly-Once Effect

Given that transport is stuck at at-least-once, we recover exactly-once *effect* by
making the receiver's apply function idempotent. The construction is small and its
correctness follows directly from the Section 1 definition.

**Construction.** Attach to each logical operation a stable **idempotency key** `k`
that is identical across all retries of *that* operation (client-generated; see §7).
The receiver maintains a **dedup store** `D` (a set of processed keys, or a map
key → result). Its apply function is:

```text
apply(k, op):
    atomically:                          # the atomicity is the whole ballgame — §8
        if k ∈ D:
            return D[k]                   # already applied: replay stored result, no re-effect
        r := execute(op)                  # perform the state change exactly once
        D[k] := r                         # record that k is now applied
        return r
```

**Correctness (why re-delivery is harmless).** Let `A` be this `apply` function over
the combined state `(business_state, D)`. On the first delivery of `k`, `A` runs
`execute(op)` and records `k`. On every subsequent delivery of the same `k`, the guard
`k ∈ D` is true, so `A` skips `execute` and returns the stored result. Thus for the
combined state:

```text
    A(k, op) applied n ≥ 1 times  ==  A(k, op) applied once
```

which is precisely `f(f(x)) = f(x)` lifted to the whole handler: **`A` is idempotent by
construction**. `execute(op)` — the part with side effects — runs exactly once across
all deliveries of `k`. Therefore the *effect* is exactly-once even though *delivery* is
at-least-once. ∎

**Two ways to be idempotent.** The dedup-store construction above makes an *arbitrary*
operation idempotent by external bookkeeping. But some operations are *natively*
idempotent and need no store at all:

- **Natively idempotent** — `SET x := v`, `DELETE k`, `s := s ∪ {e}`, `max(s, v)`. The
  operation is a projection; re-applying it from a state that already reflects it is a
  no-op. Cheapest possible: no dedup log, no coordination, safe under duplicates.
- **Made idempotent** — `balance += 100`, "send one email", "append row". Not
  projections (Section 2 showed `+` is not idempotent). Wrap them in the dedup store.

Prefer native idempotence when you can model the state that way; fall back to the
dedup store only for operations that are irreducibly non-idempotent (money movement,
external side effects). This preference is *the* design lever and Section 5 explains
when native modeling is even possible.

---

## 5. The Algebra of Mergeable Operations

Which operations are natively idempotent — safe to apply under duplication *and*
reordering with no coordination? The answer is an algebraic structure: the
**join-semilattice**.

A set `S` with a binary operator `⊔` (the *join* / *merge*) is a **join-semilattice**
when `⊔` is:

```text
    idempotent:     x ⊔ x = x
    commutative:    x ⊔ y = y ⊔ x
    associative:    (x ⊔ y) ⊔ z = x ⊔ (y ⊔ z)
```

These three axioms are exactly the three properties of Section 2, together. The join
induces a **partial order** `x ≤ y  ⟺  x ⊔ y = y`, and `x ⊔ y` is the *least upper
bound* of `x` and `y`. State only ever moves *up* this order — merges are
**monotonic**: `x ≤ x ⊔ y`. This monotonicity is what makes the structure duplicate-
and reorder-proof:

> **Semilattice theorem.** If application of updates is a semilattice join, then the
> final state depends only on the *set* of updates received, not on their **order**,
> **multiplicity**, or **grouping**. Duplicates are absorbed (idempotence), reorders
> vanish (commutativity), and batching is free (associativity).

*Proof sketch.* Any expression built from the updates using `⊔` can be reassociated
(associativity), reordered (commutativity), and have repeats collapsed (idempotence)
into the join over the *distinct set* of updates. All evaluation trees for the same
set therefore reduce to the same value. ∎

Common semilattice merges and the data they model:

| Merge `⊔` | State type | Semantics |
|-----------|-----------|-----------|
| `max` | number | monotonic counter, high-water mark, version number |
| `min` | number | earliest-timestamp, low-water mark |
| `∪` (set union) | set | grow-only set of tags/members |
| `∨` (OR) | boolean | latched flag (once true, stays true) |
| entrywise `max` over a vector | version vector | causal clock (Lamport / vector clock) |
| LWW register (max by `(timestamp, node_id)`) | (value, ts) | last-writer-wins cell |
| "upsert to fixed value" | record | last-write-wins row |

**Where the algebra breaks — and the escape hatch.** A plain counter under `+` is
commutative and associative but *not* idempotent, so `+` is **not** a semilattice join
— duplicate `+1`s are silently double-counted. You cannot make raw addition
idempotent. The standard fix reshapes the state so that a semilattice *does* apply: a
grow-only counter (G-Counter) stores a **map `node_id → max value seen from that
node`** and merges by entrywise `max` (a semilattice). Each node's contribution is
merged by `max`, which *is* idempotent, so re-delivering a node's increment is
absorbed; the logical count is the sum over the map. The takeaway: when an operation
is not natively idempotent, either (a) wrap it in the dedup store (§4), or (b)
**re-model the state into a semilattice** so idempotence falls out of the algebra.
Option (b) is what CRDTs systematize.

---

## 6. Connection to CRDTs

**Conflict-free Replicated Data Types** (Shapiro, Preguiça, Baquero, Zawirski, 2011)
are the direct generalization of Section 5. A **state-based (convergent) CRDT** — a
CvRDT — is exactly a join-semilattice of states with a monotonic merge, plus the rule
that every local mutation moves the state *up* the lattice. Its convergence guarantee
(**Strong Eventual Consistency**: replicas that have received the same set of updates
have equal state) is *precisely* the semilattice theorem of Section 5 applied across
replicas.

The link to idempotency is direct and mechanical:

```text
    idempotent merge  →  re-receiving the same state is a no-op   →  duplicate-safe
    commutative merge →  receiving states in any order converges  →  reorder-safe
    associative merge →  gossiping partial merges is safe         →  batch/anti-entropy-safe
```

Because the merge is a semilattice join, a CvRDT needs **no dedup log and no
idempotency key**: the *algebra itself* provides exactly-once effect. Anti-entropy
protocols can gossip states redundantly, in any order, arbitrarily often, and still
converge. That is the strongest possible form of the Section 4 result — idempotency is
not bolted on, it is a *theorem* about the data type.

**Op-based CRDTs (CmRDTs)** take the complementary stance: they ship *operations* over
a channel assumed to deliver each op **exactly once and in causal order**. They then
require operations to be **commutative** but explicitly rely on the delivery layer to
suppress duplicates — i.e. they push the idempotency requirement *down* to the
transport (a causal-broadcast layer that dedups) rather than *into* the data type.
This is the same at-least-once-plus-dedup pattern of Section 4, relocated to the
messaging middleware.

| Flavor | Ships | Merge/apply must be | Duplicate handling | Idempotency lives in |
|--------|-------|---------------------|--------------------|----------------------|
| State-based (CvRDT) | full state | idempotent + commutative + associative (semilattice join) | absorbed by the merge | the **data type's algebra** |
| Op-based (CmRDT) | operations | commutative | suppressed by causal-broadcast layer | the **delivery layer** |

The unifying lesson: *idempotency has to live somewhere.* Either the data type is a
semilattice (idempotency in the algebra), or the transport dedups (idempotency in the
delivery layer), or the application keys and logs each op (idempotency in the dedup
store). There is no free version — the impossibility of §3 guarantees that.

---

## 7. Dedup Keys, Monotonicity, and Fencing Tokens

The dedup store of Section 4 is only as correct as its **keys**. Two adversaries must
be defeated: **duplicate** retries of the *same* operation, and **stale** retries — an
old, delayed message that should no longer take effect because newer state has
superseded it.

**Key requirements for duplicate suppression.**

- **Client-generated and stable across retries.** The key identifies the *logical
  operation*, so all retries of it carry the same key. A server-generated key changes
  on each attempt and cannot dedup — the retry looks like a brand-new operation.
- **Globally unique per logical operation.** A UUIDv4, or a content hash of the
  request, or a `(client_id, sequence_number)` pair. Reusing a key for a genuinely new
  operation causes a *false* dedup (the new op is silently dropped as a "duplicate").
- **Scoped and TTL'd deliberately.** The key's uniqueness scope (per endpoint? per
  account?) and retention window bound how long duplicates can be caught. A retry that
  arrives after the key's TTL expires will be re-processed. Size the TTL to exceed the
  maximum realistic retry horizon.

**Stale retries need more than a dedup set.** A pure "seen this key?" check does not
stop an *old* write from clobbering *newer* state, because the old write carries a key
the store has never seen. The tool for staleness is **monotonic ordering**: attach a
monotonically increasing token — a **version number**, **epoch**, or **fencing token**
— and have the resource **reject any update whose token is ≤ the highest already
applied**.

**Fencing tokens** (Kleppmann, *Designing Data-Intensive Applications*, ch. 8) make
this concrete for the classic "a paused process resumes and issues a stale write"
failure. A coordinator hands out a strictly increasing token with each grant of
authority (a lease, a lock, a leadership epoch). Every write carries its token; the
resource remembers the highest token it has honored and refuses lower ones:

```text
    guard on the resource:
        if incoming.token > resource.max_token_seen:
            apply(incoming); resource.max_token_seen := incoming.token
        else:
            reject   # stale — a newer authority has already written
```

This is a `max` semilattice on the token axis (Section 5): the resource's
`max_token_seen` only moves up, so a delayed low-token write can never win, regardless
of how many times it is retried. Compare-and-swap on a version column
(`UPDATE ... SET v = v+1 WHERE id = ? AND v = ?`) is the same idea implemented in the
database: the CAS fails for a stale writer whose expected version is out of date.

```mermaid
sequenceDiagram
    autonumber
    participant W1 as Writer A (token 33)
    participant Res as Resource (max_token=?)
    participant W2 as Writer B (token 34)
    Note over W1: A holds lease, then STALLS (GC pause / netsplit)
    W2->>Res: write X, token 34
    Res-->>W2: accept (34 > max) → max_token := 34
    Note over W1: A resumes, unaware it lost the lease
    W1->>Res: write Y, token 33 (STALE)
    Res-->>W1: REJECT (33 ≤ 34)
    Note over Res: monotonic token defeats the stale retry;<br/>duplicate keys alone would NOT have caught this
```

The two mechanisms are complementary and both are usually needed:

| Adversary | Defeated by | Mechanism |
|-----------|------------|-----------|
| **Duplicate** of the *same* op | Idempotency key | dedup store: skip if key already seen |
| **Stale** delayed op superseded by newer state | Monotonic / fencing token | reject if token ≤ max seen (a `max` semilattice) |
| **Reordered** ops (order-dependent effect) | Commutativity / versioned CAS | apply order-independently, or CAS on version |

---

## 8. The Atomicity Requirement (Dedup Check + Effect)

Everything above assumes the word "atomically" in the Section 4 pseudocode is real.
It is the crux, and getting it wrong reintroduces the exact duplicate the whole
apparatus was built to prevent. State it as a theorem and prove the necessity.

> **Atomicity requirement.** The **dedup check** (`k ∈ D?`), the **effect**
> (`execute(op)`), and the **key record** (`D[k] := r`) must commit as a **single
> atomic unit**. If any interleaving can execute the effect without simultaneously
> recording the key — or record the key without committing the effect — the handler
> is **not** idempotent.

**Necessity argument (why non-atomic dedup fails).** Suppose the check and the record
are *separate* commits, in the order: (1) check, (2) effect, (3) record. Consider two
concurrent deliveries of the same key `k` (a duplicate that arrived while the first
was in flight — exactly the §3 scenario):

```text
    T1: check k → not in D          (step 1)
                                     T2: check k → not in D      (step 1)   ← both pass!
    T1: execute(op)  → EFFECT #1     (step 2)
                                     T2: execute(op) → EFFECT #2 (step 2)   ← DOUBLE EFFECT
    T1: record k                     (step 3)
                                     T2: record k                (step 3)
```

The effect ran **twice**. The dedup store gave a false sense of safety because the
check-to-record window was not atomic — a classic **time-of-check-to-time-of-use
(TOCTOU)** race. A crash between step 2 and step 3 is equally fatal in the sequential
case: the effect committed but the key was never recorded, so the *next* retry sees
`k ∉ D` and re-executes. In both variants, `f(f(x)) ≠ f(x)` — the handler is not a
projection — so it is *not idempotent*. Hence atomicity is **necessary**, not merely
convenient. ∎

**How to obtain the atomicity.** Make the key record and the effect share a single
commit boundary:

- **Same-transaction dedup.** Put the dedup row and the business effect in **one ACID
  transaction**, with a **`UNIQUE` constraint on the idempotency key**. The insert of
  the key either commits atomically with the effect or rolls back with it. The unique
  constraint turns the "already processed?" check into a serialized, all-or-nothing
  operation: the second inserter gets a constraint violation and takes the "duplicate"
  path. This is the most robust construction and needs only the database you already
  have.

    ```text
    BEGIN;
      INSERT INTO idempotency_keys(k, ...) VALUES (?, ...);  -- UNIQUE(k): fails on dup
      -- ... the business effect (debit, insert order, etc.) ...
    COMMIT;   -- key + effect commit together, or neither does
    ```

- **Atomic conditional write.** A single-round-trip conditional primitive:
  `INSERT ... ON CONFLICT DO NOTHING`, Redis `SET k v NX`, DynamoDB
  `PutItem` with `attribute_not_exists(k)`, or a compare-and-swap. Exactly one caller
  wins the insert; the losers are duplicates. Correct **only if** the effect is
  co-located under the same atomic unit (same key/row, or a transaction), otherwise
  the TOCTOU window reopens between "win the insert" and "do the effect."

- **Cross-store outbox.** When the effect and the dedup record cannot share a
  transaction (effect is an external API call), use the **transactional outbox**: in
  one DB transaction, record the key *and* enqueue an intent row; a separate,
  at-least-once, idempotent worker performs the external effect keyed by the same `k`.
  The external side must itself accept the idempotency key (most payment APIs do), so
  its duplicate suppression is *its* atomic dedup — the pattern composes recursively.

**Corollary — dedup store consistency.** The dedup store must be at least as strongly
consistent as the effect it guards on the key it guards. A dedup store that is only
*eventually* consistent can answer "not seen" for a key that a concurrent replica has
already recorded, reopening the double-effect window. This is why idempotency keys are
typically kept in a **linearizable / strongly-consistent** store (a single-primary SQL
row, a Redis primary with `NX`, a DynamoDB conditional write) rather than an eventually
consistent one. If you *must* use an eventually consistent store, you have to re-model
the effect itself as a semilattice (Section 5) so that a missed dedup is harmless —
which is exactly the CRDT escape hatch of Section 6.

```mermaid
stateDiagram-v2
    [*] --> Received: request (key k) arrives
    Received --> BeginTxn: open atomic unit
    BeginTxn --> KeyExists: k already in D?
    KeyExists --> ReplayResult: yes
    KeyExists --> Execute: no (UNIQUE insert wins)
    Execute --> RecordKey: effect committed
    RecordKey --> CommitTxn: key + effect in ONE commit
    CommitTxn --> [*]: exactly-once effect
    ReplayResult --> [*]: no re-effect, return stored result
    note right of CommitTxn
        If effect and key do NOT
        commit together, a crash or
        concurrent retry re-runs the
        effect -> NOT idempotent (see 8)
    end note
```

---

## 9. Failure-Model Walkthrough

Trace one payment through the full machinery to see each theorem do its job. Setup: a
client charges `$100`; the network is at-least-once (§3); the dedup store is a
linearizable SQL table with `UNIQUE(idempotency_key)` (§8); writes carry a lease
fencing token (§7).

```text
1. Client mints idempotency_key = K (UUIDv4), stable across all retries of THIS charge.
2. Attempt 1: POST /charge  {key: K, amount: 100, token: 42}
     Server BEGIN;
       INSERT idempotency_keys(K) -> succeeds (K unseen)
       token 42 > resource.max_token(41) -> accept
       debit account 100; write charge row; D[K] := {status: ok, charge_id: C1}
     COMMIT;  -> $100 moved exactly once, K recorded, max_token := 42
     Response ack DROPPED by network (World 2 of §3).

3. Client times out, cannot tell "lost request" from "lost ack", RESENDS (§3 forces this).
   Attempt 2: POST /charge  {key: K, amount: 100, token: 42}
     Server BEGIN;
       INSERT idempotency_keys(K) -> UNIQUE violation (K already present)
       -> take duplicate path: return stored D[K] = {ok, C1}
     COMMIT;  -> NO second debit. Effect stayed exactly-once (§4 idempotent apply).

4. Meanwhile a stale writer (paused since it held token 41) resumes and tries token 41:
     token 41 <= resource.max_token(42) -> REJECT (§7 fencing defeats stale retry).

Net effect: exactly one $100 debit, despite duplicate delivery AND a stale writer,
over a transport that can only promise at-least-once.
```

Every guarantee is doing distinct work: §3 explains *why the duplicate and the
ambiguity are unavoidable*; §4 *absorbs the duplicate*; §7 *rejects the stale writer*;
§8 *makes the absorb-and-record atomic* so a concurrent retry or crash cannot slip a
second debit through.

---

## 10. Comparison Tables and Decision Notes

**Native idempotence vs made idempotent (dedup store).**

| | Natively idempotent op | Made idempotent (dedup store) |
|---|---|---|
| Examples | `SET`, `DELETE`, `∪`, `max`, upsert | `+= amount`, send email, append |
| Extra state needed | none | dedup store (keys → results) |
| Coordination | none | atomic check+effect (§8) |
| Reorder-safe? | if also commutative (semilattice) | only if op itself commutes |
| Storage cost | zero | O(#operations) until TTL |
| Preferred when | state can be modeled as a projection/semilattice | irreducible side effects (money, external calls) |

**Dedup / exactly-once-effect strategies.**

| Strategy | Mechanism | Atomicity source | Handles stale? | Best fit |
|----------|-----------|------------------|----------------|----------|
| Unique-key in same txn | `UNIQUE(k)` + effect in one ACID txn | the transaction | with a version/token column | single-DB effects |
| Conditional write | `INSERT ON CONFLICT`, `SET NX`, DynamoDB `attribute_not_exists` | single atomic primitive | add fencing token | KV / single-row effects |
| Transactional outbox | key+intent in txn; idempotent worker | txn for record, key for external | key propagated downstream | effect is an external API |
| Fencing token / lease epoch | reject token ≤ max seen | `max` on token axis | **yes (its purpose)** | leader/lock-guarded writes |
| Semilattice / CRDT | idempotent+commutative+assoc merge | the algebra itself | monotonic by construction | replicated, offline-tolerant data |

**"Exactly-once" claims, decoded.**

| Marketing claim | What actually runs underneath |
|-----------------|-------------------------------|
| "Exactly-once delivery" | *Impossible* (§3); really at-least-once transport |
| "Exactly-once processing" (Kafka EOS, Flink) | at-least-once + transactional/idempotent apply |
| "Exactly-once" via idempotent consumer | at-least-once transport + dedup store (§4/§8) |
| CRDT "conflict-free" convergence | semilattice merge = idempotent apply as a theorem (§5/§6) |

---

## 11. Summary and Invariants

- **Definition.** `f` is idempotent iff `f(f(x)) = f(x)` (a projection); a binary
  operator is idempotent iff `x · x = x`. Practically: processing a request `k ≥ 1`
  times has the same *effect* as processing it once.
- **Three independent properties.** Idempotence defeats **duplication**; commutativity
  defeats **reordering**; associativity defeats **regrouping**. A real async network
  does all three, so blindly-applyable operations are the ones with all three — a
  **semilattice**.
- **Delivery is not effect.** Exactly-once *delivery* is impossible over a lossy
  channel (the ack ambiguity / Two Generals); every transport is at-most-once or
  at-least-once. Exactly-once *effect* is achievable via **at-least-once + idempotent
  apply**.
- **Two routes to idempotent apply.** (a) model the state as a **semilattice** so
  idempotency is a theorem (CRDTs, `max`/`∪`/upsert, no dedup log); or (b) wrap an
  irreducibly non-idempotent op in a **dedup store** keyed by a stable
  client-generated idempotency key.
- **Keys and staleness.** Idempotency keys catch **duplicates**; **monotonic /
  fencing tokens** catch **stale** retries (reject token ≤ max seen — a `max`
  semilattice on the token axis).
- **Atomicity is mandatory.** The dedup check, the effect, and the key record must
  commit as **one atomic unit** (unique-constraint-in-transaction, conditional write,
  or outbox). Any check-to-record gap is a TOCTOU race that re-admits the double
  effect, breaking `f(f(x)) = f(x)`. The dedup store must be **linearizable** on the
  guarded key — or the effect must itself be a semilattice.

**Invariant to carry into every design review:** *idempotency has to live somewhere* —
in the data type's algebra, in the delivery layer, or in an atomic dedup store — and
the impossibility of exactly-once delivery guarantees you never get it for free.

*Next step:* [Idempotent Operations — Staff](staff.md)
