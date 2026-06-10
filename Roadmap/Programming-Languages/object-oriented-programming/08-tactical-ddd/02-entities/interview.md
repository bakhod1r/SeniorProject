# Entities — Interview Q&A

Twenty questions you should be ready to answer about entities, ranging from foundational to senior-level.

---

**1. What is the defining characteristic of a domain Entity?**

An Entity has an explicit, stable identity (`id`) that distinguishes it from other instances even when their attributes are identical. Equality is determined by id, not by attribute values. Two customers named "Alice" with the same email are the same customer if and only if they share the same `customerId`. Eric Evans (*Domain-Driven Design*, 2003, ch. 5) formalises this.

---

**2. Contrast Entity and Value Object in one paragraph.**

A Value Object has no identity — equality is by all attributes — and is immutable. An Entity has explicit identity (`id`), is mutable through behaviour methods, and persists through state changes. `Money` is a Value Object; `BankAccount` is an Entity. The test: "if I had two with identical attributes, would they be the same thing or two things?" Same → VO. Different → Entity.

---

**3. How should `equals` and `hashCode` be implemented on an Entity?**

`equals` returns true iff the ids are equal; `hashCode` returns the id's hash code (or a constant if the id isn't assigned yet). Mutable attributes are *never* included — including them breaks `HashSet`/`HashMap` invariants when the attributes change. The pattern survives Hibernate proxies if you use `instanceof` over `getClass() ==`.

---

**4. Why is using mutable fields in `equals`/`hashCode` dangerous?**

If a hash-based container caches the entity's hash on insert, and a later mutation changes the hash, the container can no longer find the entity. The entity is "lost in the set". `Set.contains` returns false for an object provably in the set; `Set.remove` becomes a no-op. Identity-by-id keeps the hash stable across mutations.

---

**5. What happens to `hashCode` if your id is assigned by `IDENTITY` and is null at construction?**

If `hashCode = id.hashCode()`, it throws NPE on transient entities. If `hashCode = id != null ? id.hashCode() : 0`, the hash changes from 0 to the real value when the id is assigned, and any hash-based container the entity was inserted into is now stale. The standard workaround is a constant hash (`getClass().hashCode()`), which is stable but degrades hash performance. Better fix: switch to UUID assigned at construction.

---

**6. What are the four Hibernate entity lifecycle states?**

Transient (new, unknown to Hibernate), Managed (in the persistence context, tracked for dirty checking, will be flushed), Detached (was managed, but the session closed or `em.detach` was called), and Removed (scheduled for DELETE on next flush). Transitions: `persist()` transient → managed; `merge()` detached → managed (returning a new reference); `remove()` managed → removed; closing the session: managed → detached.

---

**7. Why does JPA require a no-arg constructor on entities?**

Because Hibernate constructs the entity reflectively (via `Constructor.newInstance()`) before populating fields from the ResultSet. It can be `protected` (no need for `public`), but it must exist. JPA spec §2.1.

---

**8. Why must `@Id` be immutable?**

The id is the entity's identity — its meaning is "this specific thing". Changing the id changes which thing the object refers to, which breaks references from elsewhere (foreign keys, caches, sessions, audit logs). Plus, Hibernate uses the id to locate the row for UPDATE — changing it leads to row-not-found at best, accidental UPDATE of a different row at worst.

---

**9. What does `@Version` give you?**

Optimistic locking. Hibernate adds `AND version = ?` to every UPDATE and increments the version. If two transactions both load with `version = 7` and both flush, only one's UPDATE matches; the other matches zero rows and Hibernate throws `OptimisticLockException`. The application typically retries with fresh state. Cheap, no DB locks held; assumes conflicts are rare.

---

**10. When would you choose pessimistic locking over optimistic?**

When conflicts are frequent enough that optimistic retry storms are worse than holding a lock. High-traffic shared resources: a single counter, a fixed inventory row, a leader-election record. Use `LockModeType.PESSIMISTIC_WRITE` to issue `SELECT … FOR UPDATE`. Default optimistic; escalate to pessimistic only with measured evidence.

---

**11. Compare UUID vs auto-increment Long for primary keys.**

UUID is 128 bits, assigned at construction (no DB round-trip), distributed-friendly, but UUID v4's randomness hurts B-tree index locality. UUID v7 (time-sortable) fixes this. `IDENTITY` Long is 64 bits, assigned by the DB on INSERT, has excellent index locality, but is null in the entity until persist (which breaks `HashSet`/`equals`) and disables batch inserts. Modern default: UUID v7. Legacy / single-DB / no-write-batch tables: `Long` with SEQUENCE.

---

**12. Why does `GenerationType.IDENTITY` disable batch inserts?**

Hibernate needs the generated id back after every INSERT to populate the entity. With IDENTITY, the id is known only *after* the INSERT runs. Hibernate must therefore execute each INSERT individually (to read back the id via `getGeneratedKeys`) — batching is impossible. SEQUENCE pre-fetches ids and lets Hibernate batch.

---

**13. What's wrong with putting `@Data` on a JPA entity?**

Lombok's `@Data` generates `equals` and `hashCode` over **all** fields. For an entity, that means equality changes when any attribute changes — the worst possible behaviour. Plus `@Data` generates public setters for everything, destroying invariants. Use `@Getter` only (and add `equals`/`hashCode` by hand or via `@EqualsAndHashCode.Include` on the id field).

---

**14. How does Hibernate's dirty checking work, and what does it cost?**

When an entity is loaded, Hibernate takes a snapshot of its field values. At flush time, it compares the current values to the snapshot; changed fields produce an UPDATE. The cost is one extra copy per managed entity in memory. Bytecode-enhanced entities track dirty fields directly and skip the snapshot. Read-only mode (`hibernate.readOnly` hint) skips dirty checking entirely.

---

**15. What is the identity map and what does it guarantee?**

Within one persistence context, Hibernate guarantees `em.find(E.class, id)` returns the same Java reference for the same id. So `em.find(X, 1) == em.find(X, 1)` is true within a session. Across sessions, the references differ — you rely on `equals` by id. The identity map is also Hibernate's first-level cache.

---

**16. What is an aggregate root, and how does it relate to entities?**

An aggregate is a cluster of entities and value objects with one *root entity* through which all access flows. The root is the only thing repositories load and save; non-root entities are reached via the root and are only visible inside the aggregate. Order is an aggregate root; LineItem might be an internal entity of the Order aggregate. Cross-aggregate references are by id, never by direct object reference. Vaughn Vernon (*Implementing DDD*, 2013, ch. 10) lays out the rules.

---

**17. Why is the anaemic domain model an anti-pattern for entities?**

An anaemic entity has only getters and setters — all behaviour lives in services that mutate the entity from outside. Invariants are scattered across services; the entity itself can be put into invalid states by any caller. Behaviour belongs *with the data it operates on*: `account.debit(amount)` rather than `accountService.debit(account, amount)`. The latter forces every caller to remember the validation rules; the former encapsulates them. Martin Fowler coined the term in 2003.

---

**18. How do you handle `equals` for a Hibernate proxy?**

Use `instanceof` instead of `getClass() ==` — a proxy is an enhanced subclass, so `instanceof Customer` succeeds but `getClass() == Customer.class` fails. Unwrap with `Hibernate.unproxy(o)` before accessing fields on the comparison target:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Customer)) return false;
    Customer that = (Customer) Hibernate.unproxy(o);
    return id != null && id.equals(that.id);
}
```

---

**19. When should you split the domain entity from the JPA entity into two classes?**

When you need the domain layer to be testable without a database (pure POJO domain), when you might swap the persistence provider (JPA → jOOQ → MyBatis), or when the JPA mapping contorts the domain model (e.g., a JPA-only child entity needed for a denormalised performance shortcut). Start single-class — one class that is both domain and JPA entity — and split on evidence, not anticipation. Two classes means two test surfaces and ongoing mapper maintenance, which has a real cost.

---

**20. Name the most common entity bugs and their fixes.**

| Bug | Fix |
| --- | --- |
| `@Data` on a JPA entity | Identity-only `equals`/`hashCode` |
| Mutable `@Id` | Surrogate UUID, `updatable = false` |
| Missing `@Version` (lost update) | Add `@Version`, retry on `OptimisticLockException` |
| `toString` triggers lazy load | `toString` references only id and primitives |
| `getClass() ==` in equals | `instanceof` + `Hibernate.unproxy` |
| Cascade across aggregate boundary | Reference other aggregates by id |
| `HashSet<Order>` with `IDENTITY` id | Constant hashcode, or switch to UUID |
| Sharing EntityManager across threads | Transaction-scoped EM, one per request |

These are the recurring suspects in entity-related production bugs.

---

**Memorize this:** an interview on entities covers four areas — *concept* (identity vs values, aggregates, anaemic vs rich), *Java mechanics* (equals/hashCode by id, no-arg constructor, immutable id), *JPA mechanics* (`@Id` strategies, `@Version`, lifecycle states, identity map), and *production traps* (`@Data` on entities, lazy in toString, `getClass() ==` vs proxies, missing version, cascade across aggregates). If you can answer the twenty questions above with concrete code examples and cite Evans, Vernon, or the JPA spec where it earns the answer, you have a senior-level grasp of the topic. Memorise the bug table — interviewers ask "what's wrong with this code?" more often than "define an entity".
