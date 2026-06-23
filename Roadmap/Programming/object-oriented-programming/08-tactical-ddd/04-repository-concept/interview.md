# Repository Concept — Interview

Twenty numbered questions and answers, ordered roughly junior to senior. Each answer is short on purpose — interview answers should be conversational, not lecture-length. Citations to Evans, Vernon, and Spring Data documentation are included where relevant.

---

**1. What is a Repository in Domain-Driven Design?**

A Repository is a domain-layer abstraction that gives the rest of the application the illusion of an in-memory collection of *aggregates*. You ask it for an aggregate by identity, save changes, remove members. The implementation hides the actual persistence mechanism — JPA, JDBC, MongoDB, anything. Eric Evans introduced the pattern in *Domain-Driven Design* (2003) as the standard answer to "how does the domain code retrieve and persist aggregates without learning SQL?"

---

**2. How does a Repository differ from a Data Access Object (DAO)?**

A DAO is row- or table-shaped — `insert`, `selectByColumn`, often one DAO per table. A repository is aggregate-shaped — `findById`, `save`, one repository per aggregate root. A repository lives at the *domain* level and speaks the business language; a DAO lives at the *persistence* level and speaks the schema. A repository may use DAOs internally, but its public contract never exposes them.

---

**3. Why "one repository per aggregate root", not per entity or per table?**

The aggregate root is the *consistency boundary* — the only place where the aggregate's invariants are enforced. If an internal entity had its own repository, callers could mutate it directly and bypass those invariants. Vaughn Vernon states this rule explicitly in *Implementing Domain-Driven Design*: one repository per aggregate type, no more.

---

**4. Where does the repository interface live, and where does the implementation live?**

The *interface* lives in the domain layer because it's part of the domain's language. The *implementation* lives in the infrastructure layer because it knows about JPA, JDBC, or whatever store you use. The arrow points inward: infrastructure depends on domain, never the reverse. This is the same shape as Dependency Inversion from SOLID.

---

**5. What's the difference between a collection-oriented and a persistence-oriented repository?**

A collection-oriented repository behaves like a `Set<T>` — you `add` an aggregate once, and subsequent mutations are tracked automatically by the underlying ORM. It requires a unit-of-work mechanism (JPA's persistence context). A persistence-oriented repository requires an explicit `save` after every change. The latter is honest with non-tracking engines (JDBC, MyBatis) and survives changes of ORM more cheaply.

---

**6. Where should `@Transactional` go — on the repository or on the application service?**

Always on the application service (the use case). A use case may call multiple repositories, and they must commit atomically. Putting `@Transactional` on a repository method means every `save` commits independently, so a failure midway through a use case leaves the system in an inconsistent state.

---

**7. Should I expose `findAll` on my repository?**

Almost never. `findAll` on a table with a million rows will OOM your JVM. If you really need to scan the whole set (e.g., a batch job), do it via a streaming query inside a transaction, in chunks — but don't expose the unbounded version to general callers. For screens, use a paginated query service instead.

---

**8. What's wrong with letting the controller call `customerRepository.findAll(Pageable)` for a list screen?**

Two things. First, you've fetched whole `Customer` aggregates with all their associations, when the screen only needs five fields per row. Second, returning the aggregate to the controller invites code that mutates it without going through the aggregate's invariants. Use a query service that projects to a DTO instead.

---

**9. When is the Specification pattern better than `findByXAndY…` methods?**

When the count of combinations is growing or unpredictable. Five filters with three boolean states gives you 243 combinations — you can't reasonably name them all. Specifications compose with `and`/`or`/`not` and turn each filter into a small named domain class. Evans introduces this in *DDD* §6.5 specifically as the antidote to runaway query-method proliferation.

---

**10. Should the Specification translate to SQL, or is in-memory filtering fine?**

For tiny aggregate sets, in-memory is fine. Past a thousand rows, in-memory `isSatisfiedBy` is fatal — you're loading every aggregate and filtering in Java. Add a translation hook (`toPredicate` for JPA, a `BooleanExpression` for QueryDSL) so the same Specification runs in the database. Spring Data offers this via `JpaSpecificationExecutor`.

---

**11. What's the trade-off of extending `JpaRepository<T, ID>` from the domain package?**

Productivity vs purity. Extending it for free gives you `save`, `findById`, `findAll`, `deleteById`, and derived query methods. The cost is that the domain package now transitively depends on Spring Data and JPA — swapping ORMs becomes painful, mocking the repository for unit tests is awkward (`JpaRepository` has dozens of methods), and Spring's `Page<T>` and `Pageable` leak inward. The mature compromise: keep a clean domain interface, back it with a Spring Data interface in the infrastructure layer.

---

**12. What is "derived query method" and when does it become a problem?**

Spring Data parses method names into queries: `findByCustomerIdAndStatusOrderByPlacedAtDesc` becomes a JPQL `WHERE customer_id = ? AND status = ? ORDER BY placed_at DESC`. It works well for two or three predicates. Beyond that, names get unreadable, refactoring a field breaks queries silently, and you lose performance hooks (no index hints, no fetch joins). Rule: ≤3 predicates → derived; more → `@Query`, Specification, or a query service.

---

**13. Where does `nextIdentity` belong?**

On the repository, not on the database. The aggregate needs an identity *before* it's stored — to publish domain events, log, or hand back to the caller. UUIDs or a pre-allocated sequence work. Letting the database auto-generate the ID after `INSERT` couples domain code to the moment of persistence.

---

**14. How do you write a repository test without a real database?**

Hand-write an `InMemoryFooRepository` that implements the domain interface and uses a `ConcurrentHashMap` internally. Deep-copy aggregates on both `save` and `findById` so the fake honours persistence-oriented semantics (no accidental dirty-checking). Application-service tests then run without Spring, without a database, in milliseconds.

---

**15. What happens if your in-memory fake stores references instead of copies?**

Tests pass on the fake, fail on the real persistence implementation. The fake accidentally provides dirty-checking — mutating the aggregate after `save` and then calling `findById` returns the mutated state. A JDBC-backed repository wouldn't, because the database has no way to see the in-memory mutation. Always deep-copy.

---

**16. What is CQRS and how does it interact with repositories?**

Command Query Responsibility Segregation separates the *write side* (commands that mutate aggregates) from the *read side* (queries that produce screen-shaped data). The repository is a write-side abstraction — it returns whole aggregates. Read-side queries go through a *query service* that projects to DTOs and may read from denormalised tables or materialised views. The two never share methods.

---

**17. What's the danger of `spring.jpa.open-in-view=true`?**

The persistence context stays open from the controller's entry to its exit, which silently "fixes" `LazyInitializationException` — at the cost of issuing N+1 SELECTs during view rendering or JSON serialisation. Turn it off. The application will fail loudly on bad fetch boundaries; you fix them in the repository with `join fetch` or explicit transactional methods. That's the correct level for the fix.

---

**18. How does optimistic locking interact with the repository?**

The aggregate carries the version field (`@Version` in JPA). The repository's implementation participates by reading the version on load and asserting it on save; if it changed in between, JPA throws an `OptimisticLockException`. The use case decides whether to retry, surface a conflict, or abort. The repository contract itself doesn't expose the version — concurrency control is an aggregate concern, not a repository concern.

---

**19. When would you reach for QueryDSL or JOOQ over JPA `@Query`?**

When the query is the value, not the aggregate. Complex search screens with dynamic filters, reporting with window functions, exports with CTEs — `@Query` strings become unmaintainable and JPA can't express some of the SQL. QueryDSL gives you type-safe predicates that compose; JOOQ gives you full typed SQL. The mature combination: JPA + Spring Data for the write side, JOOQ for the read side.

---

**20. If I had to remember three rules about repositories, what would they be?**

First: one repository per aggregate root — interface in the domain, implementation in the infrastructure. Second: the contract speaks the domain's language, never the database's — no `EntityManager`, no SQL, no `Page<EntityClass>`. Third: writes go through the repository, reads for screens go through a query service — never mix the two on the same interface.

---

**Memorize this:** Repository = collection of aggregates, one per root, interface in domain and implementation in infrastructure, contract free of persistence types. Transactions wrap use cases. Reads for screens are a query service, not a repository. The three rules of question 20 cover 80% of repository design conversations.
