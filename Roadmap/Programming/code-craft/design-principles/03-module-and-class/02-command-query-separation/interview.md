# Command Query Separation — Interview Questions

> **Category:** [Design Principles](../../README.md) — every method should either *do* something or *answer* something, but never both.

Conceptual and coding questions, graded junior → professional, plus trick and behavioral questions.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What is Command Query Separation, and who named it?

**Answer:** Every method should be either a **command** that performs an action (changes state, returns nothing) or a **query** that returns data (and causes no observable side effects) — never both. It was named by **Bertrand Meyer** in *Object-Oriented Software Construction*. Its spirit: **"Asking a question should not change the answer."**

### J2. What does a command return? What does a query return?

**Answer:** A **command** returns nothing (`void`) — its job is to change state. A **query** returns data — its job is to answer, and it changes nothing. The return type signals the role.

### J3. Why is a query that secretly mutates dangerous?

**Answer:** Because *observing* the program changes it. Adding a log line, an assertion, or a debugger watch that calls the query now alters behavior — bugs move or vanish when you look (a Heisenbug), and asserts corrupt state. It also means you can't call the query freely.

### J4. Name the "freedoms" a pure query gives you.

**Answer:** You can **repeat** it (call it as often as you like), **reorder** it (order of two queries doesn't matter), **cache/memoize** it (remember the answer), and **remove** it (deleting an unused query call changes nothing observable). Commands give none of these — and that's fine.

### J5. Give an example of a CQS violation and its fix.

**Answer:** `getAndIncrement()` returns the value *and* changes it. Fix: split into `value()` (query, returns the number, no change) and `increment()` (command, returns nothing, bumps the counter). Similarly, a `getX()` that lazily writes a field or logs meaningfully should become a pure `x()` query plus an explicit command.

### J6. Is `Stack.pop()` a CQS violation?

**Answer:** Yes — it removes the top element (command) *and* returns it (query). But it's an **accepted** violation: "remove the top and tell me what it was" is naturally one **atomic** operation, and splitting it into `top()` + `removeTop()` opens a race window. It's the canonical example of a conscious, justified exception.

### J7. How do you tell a command from a query by its name?

**Answer:** Commands are **imperative verbs** (`add`, `save`, `clear`, `deactivate`) and should return nothing. Queries are **questions or nouns** (`isReady`, `count`, `balance`, `getName`) and must not change anything.

### J8. Does CQS forbid all side effects?

**Answer:** No. **Commands exist to have side effects** — that's their whole purpose. CQS only says don't put a side effect in the *same* method that *returns a value*. Separate the doing from the answering.

---

## Middle Questions

### M1. Restate CQS using the word "observable." Why does that matter?

**Answer:** A query must have **no *observable* side effects** — two calls return the same answer and running it (or not) is invisible to the rest of the program. It matters because some hidden activity is fine: **memoizing the result, lazy-initializing a computed value, or bumping a metrics counter** don't change the answer, so they don't violate CQS. Only effects a caller or test could detect count.

### M2. What's the difference between CQS and CQRS?

**Answer:** **CQS** is a **method-level** principle on one object: a method either changes state or returns data. **CQRS** (Command Query Responsibility Segregation, Greg Young, inspired by Meyer's CQS) is a **system/architecture pattern**: separate the *read model* from the *write model* — often into different objects/services and even separate data stores synced by events. **CQS separates *methods*; CQRS separates *models*.** CQS is free and always-on; CQRS is selective and costly (eventual consistency, dual models, sync infra).

### M3. When should you deliberately combine a command and a query?

**Answer:** For **atomicity** — when splitting them would create a check-then-act (TOCTOU) race under concurrency. Examples: `pop()`, `Queue.poll()`, `getAndIncrement()`, `compareAndSet()`, `putIfAbsent()`. Combine *only* for that reason (or a genuinely inseparable concept), and name the dual nature clearly. "It was convenient to return the value" is not a valid reason.

### M4. Why does a side-effecting HTTP `GET` break things?

**Answer:** The HTTP spec defines `GET` as **safe** (read-only) and idempotent, so caches/CDNs/browsers cache and **prefetch** it, and clients **retry** it on timeout. A side-effecting `GET` gets fired by prefetchers (mutating without a click) and executed multiple times by retries — it breaks caching, idempotency, and REST semantics. It's CQS violated at the network scale.

### M5. How do CQS and Tell-Don't-Ask interact?

**Answer:** They mostly agree (both dislike getter-soup), but tense on "should a command report its outcome?" Tell-Don't-Ask pushes commands ("tell the object to act"); CQS says a command shouldn't *also* hand back domain-state query data. Resolutions: **throw on failure** so the command stays `void`; **query-then-tell** (accepting a check-then-act gap); or consciously return an *action-outcome* result (not domain state).

### M6. Is a fluent builder returning `this` a CQS violation?

**Answer:** No. It returns the *same object* for chaining (`b.add(x).add(y)`), not a *query about domain state*. No question is being answered, so it doesn't violate the spirit of CQS.

### M7. Why is `account.balance()` allowed to cache its result?

**Answer:** Because memoization is a **non-observable** side effect — the answer is identical with or without the cache, and no caller can detect a difference. The query remains referentially transparent. CQS bans *observable* effects, not internal bookkeeping.

---

## Senior Questions

### S1. What property does CQS actually protect, and what does it buy?

**Answer:** **Referential transparency** of queries: a side-effect-free query can be replaced by its result value anywhere without changing behavior. That makes the freedoms rigorous — queries are **eliminable** (dead-code-removable), **reorderable/hoistable**, **cacheable** (memoization is sound), and **retry-safe** (why safe HTTP methods can be replayed). Commands are *not* referentially transparent. CQS draws a bright line between the pure and effectful parts of an object so every tool and engineer knows which reasoning rules apply.

### S2. How does CQS relate to "functional core, imperative shell"?

**Answer:** It's the method-level rule that makes that architecture emerge. If every method is cleanly a query or a command, you push the queries inward (a pure **functional core** holding the decision logic, testable without mocks) and the commands outward (a thin **imperative shell** that performs the effects the core decided on). CQS's "concentrate the change" benefit, scaled to a module.

### S3. How does immutability change the CQS picture?

**Answer:** On immutable types, CQS largely dissolves: there are no in-place mutating commands, so "changes" become **transformations** that return a *new* object (e.g., `money.plus(other)`) — which is *not* a CQS violation, because the receiver is unmuted and nothing observable changes. CQS governs *mutating* methods; immutability removes them, giving you CQS's benefits for free. The more you lean on immutability, the less CQS tension you have.

### S4. Explain precisely why splitting an atomic operation is unsafe.

**Answer:** It creates a **check-then-act / TOCTOU** race: a query observes state, then a command acts on what was observed, and under concurrency the state can change in the gap. E.g., `if(!q.isEmpty()){ x=q.peek(); q.remove(); }` — another thread can dequeue the last element between the check and the remove, so two threads process the same element or one underflows. `q.poll()` does observe-and-remove as one indivisible step. `compareAndSet` is the purest case: the compare and set are inseparable by definition, so a CQS split is *impossible* to do safely.

### S5. When is strict CQS the *wrong* call?

**Answer:** When the split breaks correctness or misrepresents the domain: **atomic operations** (races), **inherently single-step concepts** ("reserve the next free seat and tell me which" is one operation), **generated identity** (`save() -> id`), occasionally **performance** (avoid recomputing), and **result-returning commands** for control flow when exceptions would be misused. Override CQS *consciously* in these bounded cases and make the override legible. The anti-pattern is **CQS zealotry** that mechanically splits atomic ops and manufactures races.

### S6. How does CQS relate to SRP?

**Answer:** CQS is SRP at method granularity — "do one thing" specialized to "either change state *or* report it." A method that both mutates and answers has at least two responsibilities, so the CQS split is the same separation SRP would demand. They reinforce each other (along with Encapsulate-What-Changes, which CQS helps by keeping the mutation surface small and explicit).

### S7. Make the argument for promoting CQS to CQRS — and the argument against.

**Answer:** **For:** reads and writes have opposing pressures (writes want a normalized, invariant-enforcing model; reads want denormalized, query-shaped views and are often far more numerous). CQRS gives them separate models, scaled and shaped independently, synced via events. **Against:** it costs **eventual consistency**, **dual models** to maintain, and **sync infrastructure** (event bus, projections, replay). So CQRS is justified only by *severe read/write asymmetry or scale*, never by analogy to a free method-level principle. Most systems want CQS everywhere and *no* CQRS.

---

## Professional Questions

### P1. How do you enforce CQS in code review?

**Answer:** Read each changed method and ask the central question: *does it change observable state **and** return domain data, and if so is the combination justified by atomicity or generated identity — and stated?* Flag mutating getters, commands that return domain state, `getAndX` names without an atomicity reason, and especially **side-effecting `GET` endpoints** (escalate those as correctness bugs, not style). Push back on a mutating query as hard as on a bug — it *is* a latent bug.

### P2. Why is a side-effecting `GET` a production hazard, not just a style issue?

**Answer:** Infrastructure you don't own acts on the safety promise: link **prefetchers** fire the `GET` without a click, CDN/browser **caches** serve/replay it, security **crawlers** hit it, and clients **retry** on timeout. A `GET /delete` link gets deleted by a prefetcher; a `GET` that increments over-counts and can't be cached. Reads must be `GET`/`HEAD`; state changes must be `POST`/`PUT`/`DELETE`/`PATCH`, with idempotency keys for `POST`.

### P3. How do you refactor a legacy mutate-and-return method toward CQS safely?

**Answer:** **Characterize first** (tests pinning current behavior, *including* the side effect), **map the callers** (some may depend on the mutation!), add the **pure query + explicit command** while keeping the old method as a deprecated wrapper, **migrate callers** one by one (making the hidden mutation explicit at each site), then **delete** the combined method and guard the query's purity in CI. Never just neuter the side effect — that silently breaks callers that relied on it. Never split atomic operations.

### P4. How do you decide between CQS and CQRS for a feature?

**Answer:** CQS is the default for every method — free, always-on. Reach for **CQRS** only on **severe read/write asymmetry** (e.g., 100:1 reads), read views radically unlike the write schema, independent read/write scaling, or a need for an event-log source of truth/temporal queries. "We already do CQS" is *not* a reason. CQRS imports eventual consistency, dual models, and sync infra — require a written design note and a consistency contract.

### P5. How do APIs other than HTTP encode command/query separation?

**Answer:** **GraphQL** has separate `query` and `mutation` root types — a mutating query violates both GraphQL and CQS and breaks query caching/normalization. **gRPC/RPC** has weaker conventions, so the *team* enforces it: name read RPCs `Get*`/`List*` (side-effect-free) and writes `Create*`/`Update*`/`Delete*`. **Messaging** expresses it as **commands** (imperatives, `ChargeCard`) vs. **events** (facts, `CardCharged`).

---

## Coding Tasks

### C1. Split a method that does both (Python).

**Before** — returns *and* mutates:

```python
class Cart:
    def take_next(self):
        item = self._items.pop(0)   # mutates
        return item                 # AND returns
```

**After** — a query to look, a command to act:

```python
class Cart:
    def next_item(self):            # QUERY: returns, no change
        return self._items[0]
    def remove_next(self):          # COMMAND: changes, returns void
        del self._items[0]
```

State the payoff: you can now *peek* without consuming, log freely, and the cart only changes on an explicit command.

### C2. Fix a mutating getter (Java).

**Before:**

```java
public Instant getLastAccess() {
    this.lastAccess = Instant.now();   // ❌ side effect in a getter
    return this.lastAccess;
}
```

**After:**

```java
public Instant lastAccess() { return this.lastAccess; }   // QUERY
public void touch()        { this.lastAccess = Instant.now(); }  // COMMAND
```

Explain: logging `getLastAccess()` no longer changes the session — observing it is now safe.

### C3. Identify and justify an exception (Java).

```java
// This violates CQS — is it acceptable?
boolean won = ref.compareAndSet(expected, updated);
```

**Answer:** Acceptable, and in fact *required*. `compareAndSet` returns success (query) *and* mutates (command), but the compare and the set must be **one atomic step** — that's the entire point of CAS. Splitting it is *impossible* to do safely; a query+command version has a race between compare and set. This is a deliberate, named atomic exception.

### C4. Spot the CQS violation in an API design.

```
GET /articles/42/views/increment      # increments a view counter
```

**Answer:** A side-effecting `GET` — a query verb mutating state. Caches/prefetchers/retries will fire it without intent and multiple times (over-counting, un-cacheable). **Fix:** make it a command — `POST /articles/42/views` — or record the view server-side as a separate command triggered by the read, keeping the `GET` pure.

### C5. Keep a query pure when a read must be audited (Python).

**Before** — read with a hidden write:

```python
def view(self, doc_id, user):
    self._audit.record_access(doc_id, user)   # ❌ observable side effect on read
    return self._repo.get(doc_id)
```

**After** — pure query + explicit command, composed by the caller:

```python
def get(self, doc_id):                 # QUERY: pure, cacheable, retry-safe
    return self._repo.get(doc_id)
def record_access(self, doc_id, user): # COMMAND: explicit effect
    self._audit.record_access(doc_id, user)
```

Explain: the read is referentially transparent again (cacheable, safe to call from exports/tests), and the audit is now visible and skippable where it shouldn't fire.

---

## Trick Questions

### T1. "CQS means a method can never have side effects." True?

**False.** **Commands exist to have side effects** — that's their purpose. CQS forbids combining a side effect with a *return value* in one method, and bans only **observable** side effects in *queries*. Memoization, lazy-init, and metrics inside a query are fine.

### T2. "CQS and CQRS are the same thing at different names." Right?

**No.** CQS is a **method-level** principle on one object (separate command *methods* from query *methods*); CQRS is a **system architecture** that separates the read *model* from the write *model* (often separate data stores, synced by events, with eventual consistency). CQRS was *inspired* by CQS but operates at a completely different scope and cost.

### T3. "To follow CQS, always split `pop()` into `peek()` + `remove()`." Agree?

**No — that's dangerous.** Splitting an atomic operation reintroduces a **TOCTOU race** under concurrency: two threads can `peek()` the same element before either `remove()`s it. `pop()`/`poll()` combine on purpose for atomicity. **CQS yields to thread-safety.** Mechanically splitting atomic ops *creates* bugs.

### T4. "A `save()` that returns the new id violates CQS, so it's wrong." Correct?

**Strictly a violation, but accepted.** The id exists *only because* of the save and the caller needs it immediately — it's atomic do-and-report, like `pop()`. Returning a *generated identity* is a recognized soft exception. Returning *unrelated domain state* from a command is the real smell.

### T5. "We do CQS in our methods, so adopting CQRS is the natural next step." Sound reasoning?

**No.** CQS is free and always-on; CQRS is an architecture justified by **severe read/write asymmetry/scale**, costing eventual consistency, dual models, and sync infrastructure. Adopting CQRS by analogy to CQS — with no asymmetry to justify it — produces consistency bugs and operational pain. Most systems want CQS everywhere and *no* CQRS.

### T6. "A getter can log without violating CQS." Always?

**Depends on observability.** A *diagnostic* debug log is generally fine (non-observable). But if the "log" is **meaningful, depended-on state** — an audit row the system reads, a TTL refresh, a counter that changes a result — it's an **observable** side effect and a violation. Make such effects explicit commands.

---

## Behavioral Questions

### B1. Tell me about a bug caused by a query that secretly mutated.

**Sample:** "A `getSessionState()` lazily *refreshed* the session's TTL as a side effect. We had a 'sessions expire too early' bug that was impossible to reproduce — because adding a debug log that called `getSessionState()` refreshed the session and hid it. A textbook Heisenbug. I split it into a pure `sessionState()` query and an explicit `refreshSession()` command; the bug reproduced immediately and we fixed it. The lesson I quote now: asking a question shouldn't change the answer."

### B2. Describe a time you stopped a team from over-engineering with CQRS.

**Sample:** "A team wanted full CQRS — separate read/write databases synced by events — for an internal admin app with a few hundred users and symmetric read/write load. I pushed back: there was no read/write asymmetry to justify it, and CQRS would buy us eventual consistency (saved-but-not-showing tickets) and a pile of sync code to maintain. We kept CQS at the method level and a single model. The 'I saved it but don't see it' tickets we'd have created never happened. CQS is free; CQRS is an architecture you adopt for a specific scaling problem."

### B3. How do you push back when a teammate adds a side-effecting `GET`?

**Sample:** "I frame it as a correctness issue, not style. I explain that caches, prefetchers, and retry logic — infrastructure we don't control — assume `GET` is safe and will fire it without a click and multiple times. I share the war story about a prefetcher deleting records via `GET /delete` links. Then I propose the concrete fix: move the mutation to `POST`/`DELETE`, and cite our API verb convention so it's a standard, not my opinion."

### B4. When did you deliberately violate CQS, and how did you justify it?

**Sample:** "In a concurrent job queue, I kept the atomic `poll()` — which returns *and* removes — instead of splitting it into `peek()` + `remove()` for 'cleanliness.' Splitting it would open a TOCTOU window where two workers grab the same job. I documented the deliberate CQS exception with a comment naming the atomicity reason. An examined violation is an engineering decision; an unexamined one is a bug."

### B5. How do you keep CQS intact across a large codebase over time?

**Sample:** "Make the safe path the default: naming conventions (questions/nouns for queries, imperatives for commands), commands return `void` or a narrow result with a documented exception list (generated id, atomic ops), HTTP/GraphQL verb discipline enforced as a blocking rule, and review's central question — 'does this mutate *and* return, and is the combination justified?' Erosion happens one reasonable-looking PR at a time, so the defense is at review."

---

## Tips for Answering

1. **Lead with the definition and Meyer's line:** every method is a command *or* a query, and **"asking a question should not change the answer."**
2. **Say "observable" side effects** — memoization/metrics are fine; only effects a caller can detect are violations.
3. **Nail the conscious exceptions:** `pop`/`poll`/`compareAndSet` combine for **atomicity** (TOCTOU races otherwise) — and CQS *yields* to thread-safety.
4. **Crisply separate CQS from CQRS:** method-level principle (free, always-on) vs. system architecture separating read/write *models* (costly, selective). This distinction is the most common interview discriminator.
5. **Map CQS onto HTTP:** `GET`/`HEAD` are safe queries (cacheable, idempotent); a side-effecting `GET` breaks caching, prefetch, and retries.
6. **Mention referential transparency, functional-core/imperative-shell, and immutability** to show senior depth — CQS is the OO method-level form of "separate pure computation from effects."

---

[← Professional](professional.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md)
