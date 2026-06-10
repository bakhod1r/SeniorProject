# DDD Tactical: Aggregates — Interview Q&A

> **What?** Twenty interview questions on aggregates, the level interviewers actually ask at senior and staff levels. Each question has a short, defensible answer plus a hint of the follow-up the interviewer is hoping to spring. Sourced from the recurring themes in Eric Evans (*DDD*, 2003) and Vaughn Vernon (*Implementing Domain-Driven Design*, 2013; *Effective Aggregate Design*, 2011).
> **How?** Answer each question out loud before reading the response. The goal is fluency: the patterns repeat across interviews and across real design reviews. A candidate who can articulate Vernon's four rules with concrete examples in 60 seconds is usually hired.

---

### 1. What is an aggregate?

A cluster of one or more related domain objects — entities and value objects — that are treated as a single unit for data changes. Every aggregate has exactly one designated entity called the *aggregate root*, and external code may reference and invoke only the root. The aggregate is the boundary of transactional consistency and the boundary of invariant enforcement.

---

### 2. Why does the aggregate root exist?

To funnel all writes through a single gatekeeper. If any code can mutate any internal object, business invariants that span the cluster live nowhere; with one root, those invariants live as guards in the root's methods. The single-root rule turns the cluster into a critical section that the root protects.

---

### 3. What's the difference between an entity and an aggregate root?

Every aggregate root is an entity, but not every entity is an aggregate root. An entity has identity within its aggregate; an aggregate root has identity that's meaningful outside the aggregate, and it's the only entity external code can reference. `LineItem` is an entity; `Order` is the aggregate root.

---

### 4. State Vernon's four rules of aggregate design.

1. Protect business invariants inside aggregate boundaries.
2. Design small aggregates.
3. Reference other aggregates by identity only.
4. Update other aggregates using eventual consistency.

From Vaughn Vernon, *Effective Aggregate Design* (2011).

---

### 5. Why "small aggregates"?

Large aggregates load more data per command, suffer more concurrent-write conflicts, are harder to test, and lock more state for longer. Vernon's rule of thumb: a root entity plus a handful of value objects, or a root plus a small collection of child entities. If "load the whole aggregate" feels expensive, the aggregate is too big.

---

### 6. Why reference other aggregates by id rather than by object reference?

Because object references invite three failures: (1) accidentally loading the other aggregate every time you load this one, (2) mutating the other aggregate through this one and corrupting its invariants, (3) pulling two aggregates into one transaction. Id references make cross-aggregate work explicit and decouple lifecycles.

---

### 7. What does "one aggregate per transaction" mean and why does it matter?

A single database transaction changes the state of exactly one aggregate. It matters because: (a) the aggregate is the unit the root keeps consistent, (b) multi-aggregate transactions create lock-ordering deadlocks, (c) they couple aggregates to the same database / schema, and (d) they suggest you've drawn the boundary wrong — if two aggregates must be updated jointly, they're probably one aggregate.

---

### 8. How do two aggregates coordinate without sharing a transaction?

Through domain events. Aggregate A emits an event after its commit; an event handler reacts in a separate transaction, updating aggregate B. There's a small window where A is changed but B isn't — that's the *eventual consistency* trade-off. The boundary is drawn so the window is acceptable for the rule in question.

---

### 9. What is `@Version` and why use it?

A JPA annotation that marks an integer/long field as the optimistic-lock version. On every update, Hibernate appends `WHERE version = ?` and increments it. Concurrent updates that started from the same version cause one of them to update zero rows, raising `OptimisticLockException`. This prevents silent overwrites.

---

### 10. How should you handle `OptimisticLockException`?

Retry the *whole command* — re-read the aggregate, re-apply the command, re-save. Typically 2-3 attempts with backoff. Never swallow it: a conflict means the command did not happen, and the caller assumes it did. After exhausting retries, propagate the failure.

---

### 11. When is pessimistic locking appropriate?

When measured conflict rates make optimistic retries wasteful (typically > ~10% conflicts). Pessimistic locking (`SELECT ... FOR UPDATE` / `LockModeType.PESSIMISTIC_WRITE`) serialises access — fewer retries, lower throughput. Reach for it only after measurement, and consider whether the high conflict rate signals a too-big aggregate.

---

### 12. Why one repository per aggregate root?

Because the repository abstracts "the collection of aggregates of this type" and the aggregate is the unit of load and save. Child-entity repositories tempt you to load and save children outside their root, defeating the boundary. If you find yourself wanting a child repository, the child is probably a root in disguise.

---

### 13. Describe a clean JPA mapping for the `Order` aggregate.

`Order` is the root: `@Entity`, `@Version`, `@Embedded` ids for cross-aggregate references (`CustomerId`). `LineItem` is a child entity inside the aggregate: mapped via `@OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)`. The line item's back-reference to `Order` is `@ManyToOne` (allowed *within* the aggregate). The customer reference is *not* `@ManyToOne Customer` — that would cross an aggregate boundary.

---

### 14. What's CQRS and how does it relate to aggregates?

Command-Query Responsibility Segregation: the write side uses aggregates (focused on invariants and small state) while the read side uses denormalised projections (focused on display shape and join performance). It matters for aggregates because reading through them deforms their design — they end up carrying fields just for queries. With CQRS, aggregates stay pure write-side units; reads use DTOs from raw SQL or materialised views.

---

### 15. When would you choose event sourcing for an aggregate?

When the aggregate's history is itself valuable — full audit log, temporal queries, the ability to rebuild read models. Orders, accounts, conversations are good candidates. Aggregates that are mostly "current state of a thing" (user profiles, configuration) get little from event sourcing and pay the complexity cost.

---

### 16. What's a snapshot and why do event-sourced aggregates need them?

A snapshot is a serialised representation of the aggregate's state at a given version, persisted so loads don't have to replay the full history. Without snapshots, replay cost grows linearly with event count — fine at 10 events, painful at 10,000. Typical strategy: snapshot every 100 events.

---

### 17. How do you decide where to draw an aggregate boundary?

Find the invariants first. Identify business rules that *must* be true at every observable instant (not just "eventually"). Group the state needed to enforce each rule. The smallest grouping that satisfies all "must-be-true-always" rules is your aggregate. Anything else — rules that tolerate seconds of staleness — is cross-aggregate, mediated by events.

---

### 18. What's wrong with this code: `order.getItems().add(new LineItem(...))`?

It bypasses the root's invariants. The order's total isn't recomputed; the "max 50 items" rule isn't checked; concurrent callers can both mutate the list and clobber each other. The root is supposed to be the sole mutator. Fix: make `items()` return an unmodifiable view, and route additions through `order.addItem(...)`.

---

### 19. How do aggregates interact with microservices?

An aggregate belongs to exactly one bounded context, which typically maps to one service. Cross-service communication is cross-aggregate communication — id references, asynchronous events, eventual consistency. Multi-aggregate transactions across services are *not* a thing; the same prohibition that applies inside one service applies across services, only more so.

---

### 20. What's the single most common aggregate-design mistake you've seen?

Treating "naturally grouped" data as one aggregate without checking invariants — e.g., `Customer` containing all of a customer's orders. The model looks intuitive but loads megabytes per command, conflicts under load, and doesn't enforce any real invariant. The fix is almost always: separate aggregates, id-only references, eventual consistency via events. The boundary should match invariants, not nouns.

---

## Bonus: "Tell me about a time" questions

These appear in senior interviews to test whether you've *applied* the pattern, not just memorised it.

- **"Tell me about a time you found an aggregate that was too large. What were the symptoms? What did you do?"** — Expected: symptoms (slow load, high conflict rate), refactor (split by invariant, id reference, event-driven sync).
- **"Tell me about a time you needed cross-aggregate consistency. How did you handle it?"** — Expected: domain event, post-commit handler, idempotent processing, monitoring the lag.
- **"Tell me about a deadlock in production. What was the cause?"** — A correct answer often turns out to be a multi-aggregate transaction. The fix is one-aggregate-per-transaction plus eventual consistency.

---

**Memorize this:** Aggregate = cluster + single root + invariant boundary + transactional unit + id-references across + eventual consistency across + `@Version` for concurrency. Vernon's four rules are the entire pattern in compressed form. Most interview questions are testing whether you can apply those four rules to a concrete scenario without reverting to the comfortable but wrong instinct of "just wrap two saves in `@Transactional`".
