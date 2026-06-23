# DDD Tactical: Aggregates — Specification

> **What?** A formal, contract-level statement of what an aggregate *is* and what it *guarantees* — independent of language, framework, or storage backend. Useful when reviewing code, drafting design docs, or arbitrating arguments about whether something "counts" as an aggregate. The contract synthesises Eric Evans (*DDD*, 2003, Ch. 6) and Vaughn Vernon's *Effective Aggregate Design* (2011), with notes on common Java/JPA realisations.
> **How?** Treat the rules below as testable propositions about a candidate aggregate. If any rule is violated, the design is *not* an aggregate in the DDD sense — it may still work, but it forfeits the guarantees that the pattern is supposed to provide.

---

## 1. Definitions

**Aggregate** — a cluster of one or more domain objects (entities and value objects) that:
1. Has exactly one designated entity called the *aggregate root*.
2. Is treated as a single unit for the purpose of data changes.
3. Has a well-defined boundary that separates *internal* objects from *external* code.

**Aggregate Root** — the unique entity within an aggregate through which all external interactions occur. The root:
- Has globally unique identity (across the bounded context).
- Is the only object referenced by code outside the aggregate.
- Is the sole gatekeeper of mutations to any state within the boundary.

**Aggregate Boundary** — the conceptual line that encloses exactly the state required to enforce a set of business invariants atomically.

**Invariant** — a business rule that must hold true for every observable state of the aggregate.

---

## 2. The aggregate contract

### C1. Single root

> Every aggregate has exactly one root entity. The root is fixed at design time and does not change during the aggregate's lifetime.

Consequence: code outside the aggregate may obtain references to the root only. Child entities and value objects are not addressable from outside.

### C2. Encapsulation of internals

> Internal entities of an aggregate are not exposed to external code by reference. Methods on the root must not return mutable references to internal state.

Java realisations:
- Internal entity constructors and mutators are package-private.
- Collections are returned as unmodifiable views (`Collections.unmodifiableList(...)`) or defensive copies.
- The root never returns a reference that allows the caller to bypass its own validation.

### C3. Root-enforced invariants

> All invariants whose evaluation requires only state inside the aggregate must be enforced by the root, at the conclusion of any state-changing operation.

The root's mutator methods must leave the aggregate in a state that satisfies every aggregate-local invariant, or must reject the mutation by throwing a domain exception.

```java
public void addItem(ProductId pid, int qty, Money price) {
    var newItem = new LineItem(pid, qty, price);
    var nextTotal = total.add(newItem.subtotal());
    requireInvariants(nextTotal, items.size() + 1);   // check first
    items.add(newItem);                                // then mutate
    total = nextTotal;
}
```

### C4. Transactional unit

> An aggregate is the unit of transactional consistency. Exactly one aggregate's state may change within a single transaction.

Consequence: application code must not load, mutate, and save more than one aggregate inside a single `@Transactional` boundary. Cross-aggregate effects use eventual consistency (see C6).

### C5. Cross-aggregate references by identity

> An aggregate must reference other aggregates only by their root's identity, never by object reference.

Java realisations:
- Store `CustomerId` (a value object), not `Customer`.
- In JPA: persist a column or `@Embedded` id, *not* `@ManyToOne Customer`.
- The owning aggregate is unaware of, and cannot mutate, the referenced aggregate's internal state.

### C6. Eventual consistency across aggregates

> When a command on one aggregate must result in a change to another, the relationship between the two changes is *eventually consistent*, mediated by domain events.

Consequences:
- The first aggregate emits an event after a successful commit.
- The second aggregate is updated in a *separate* transaction triggered by the event.
- There exists a (typically small) window during which the two aggregates' states are not jointly consistent. Aggregate boundaries are drawn so that this window is acceptable for the rule in question.

### C7. Concurrency control

> An aggregate must implement a concurrency control mechanism that prevents two concurrent writers from silently overwriting each other's changes.

Java realisations:
- **Optimistic locking** — `@Version` field; conflicts raise `OptimisticLockException`, which the application layer retries.
- **Pessimistic locking** — `SELECT ... FOR UPDATE` (`LockModeType.PESSIMISTIC_WRITE`), used when contention is high.

The default is optimistic. Pessimistic is justified only when measured conflict rates make retries wasteful.

### C8. Identity preservation

> An aggregate root's identity is assigned at construction and is immutable for the aggregate's lifetime. Two aggregate instances with the same identity refer to the same conceptual entity.

Consequences:
- The root's `equals`/`hashCode` are based on identity, not on attributes.
- Identity is typically assigned by the domain (e.g., generated `UUID`), not by the database.

---

## 3. The boundary-drawing rule

> The aggregate boundary must enclose *exactly* the state required to enforce the aggregate's invariants atomically — no more, no less.

This is the most important and least automatable of all the rules. Too narrow a boundary, and you cannot enforce a true invariant. Too wide a boundary, and you suffer load cost, contention, and tangled lifecycles.

A useful test: for each candidate invariant, ask whether the rule must be true *at every observable instant*, or whether it may be momentarily false and corrected within seconds. The first kind belongs inside the aggregate; the second is cross-aggregate.

---

## 4. The concurrency model

The aggregate provides the following concurrency guarantees:

1. **Atomicity** — a successful commit reflects all mutations of the command; a failure reflects none.
2. **Isolation** — concurrent commands on the *same* aggregate are serialised either optimistically (retries on conflict) or pessimistically (lock waits).
3. **Linearisability of the root** — observed by external code, the root behaves as if commands were applied in some total order.

These guarantees apply within an aggregate. *Across* aggregates, only eventual consistency is provided.

---

## 5. Lifecycle

An aggregate's lifecycle is:

1. **Construction** — the root and its initial children are created in memory in a valid state. No partial construction.
2. **Loading** — a repository reconstructs the entire aggregate from persistent storage. Partial loading violates C2.
3. **Mutation** — only via methods on the root. Each method either succeeds (leaving the aggregate valid) or throws (leaving it unchanged).
4. **Persistence** — the entire aggregate is saved atomically. JPA realisation: `cascade = ALL`, `orphanRemoval = true` on collections.
5. **Removal** — deletion removes the root and all internal objects. No orphans.

---

## 6. What an aggregate is *not*

- **A folder of related classes.** "Order things" grouped under a package is not an aggregate unless they have a single root and an invariant boundary.
- **A unit of code ownership.** Aggregates are *invariant* boundaries, not team boundaries.
- **A microservice.** A microservice may host multiple aggregates; an aggregate may be hosted in any service. The mapping is design-time, not definitional.
- **A read model.** A query DTO is not an aggregate; it has no invariants to enforce and no identity-bearing root. Use CQRS to separate.
- **A row in a table.** A single-row entity *can* be an aggregate, but the converse is false — most aggregates span multiple tables.

---

## 7. Compliance checklist

| # | Rule                                                              | Test                                                                              |
| - | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1 | Single root                                                       | Exactly one entity in the cluster is the public type.                            |
| 2 | Internals encapsulated                                            | No public mutators on child entities; no exposed mutable collections.            |
| 3 | Invariants on the root                                            | Every aggregate-local rule is enforced in a root method.                         |
| 4 | One aggregate per transaction                                     | Application services touch one aggregate per `@Transactional` boundary.          |
| 5 | Id references across boundaries                                   | No `@ManyToOne` to another aggregate root; only id fields.                       |
| 6 | Eventual consistency across boundaries                            | Cross-aggregate effects driven by domain events, after commit.                   |
| 7 | Optimistic locking                                                | `@Version` on the root entity; retries on `OptimisticLockException`.             |
| 8 | Identity preservation                                             | Root's `equals/hashCode` use identity; identity assigned at construction.        |
| 9 | Boundary matches invariants                                       | No invariant requires data outside the boundary; no internal state without rule. |

---

## 8. References

- Eric Evans, *Domain-Driven Design: Tackling Complexity in the Heart of Software*, Addison-Wesley, 2003. Chapter 6, "The Life Cycle of a Domain Object", introduces Aggregates as a building block.
- Vaughn Vernon, *Effective Aggregate Design*, three-part essay, dddcommunity.org, 2011. The canonical concise treatment, source of the four rules.
- Vaughn Vernon, *Implementing Domain-Driven Design*, Addison-Wesley, 2013. Chapter 10, "Aggregates", expands the essay with worked examples.

---

**Memorize this:** An aggregate is a single-rooted, encapsulated cluster of domain objects forming a transactional consistency boundary. The root enforces invariants over the cluster's state. Cross-aggregate references are by identity only; cross-aggregate consistency is eventual, mediated by events; concurrent writes are serialised by optimistic (default) or pessimistic locking. The boundary contains exactly the state required to enforce the cluster's invariants — no less, and no more.
