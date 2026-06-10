# Clone and Copy Semantics — Professional

> **What?** Driving copy semantics across a team and a codebase: the vocabulary you bring to PR review, the static-analysis and ArchUnit rules you wire into CI, the IDE auto-generation traps that ship broken `clone()` on autopilot, the team policy that retires `Cloneable` from new code, and the migration playbook for legacy classes that already implement it.
> **How?** Make copy semantics a *named team policy* with mechanical enforcement where possible. In review, point at the specific bug (shallow array, missing defensive copy, `Cloneable` chain dependency) and propose one replacement (copy constructor, `copyOf`, record). Migrate legacy `Cloneable` classes by the strangler-fig pattern, one class per sprint.

---

## 1. Code-review vocabulary: name the symptom, name the fix

Review comments on copy semantics are most useful when they cite the specific failure mode and propose a single replacement. A vague "this leaks state" comment is worse than no comment.

```java
// PR diff under review:
public final class AuditRecord {
    private final byte[] payload;
    public AuditRecord(byte[] payload) { this.payload = payload; }
    public byte[] payload() { return payload; }
}
```

> **Reviewer:** The constructor and accessor both expose `payload` to outside mutation. A caller can mutate the array after construction, or mutate the array returned by `payload()`, and the audit record changes silently. Take a defensive copy on both sides: `this.payload = payload.clone()` in the constructor, `return payload.clone()` in the accessor. Or convert to an immutable wrapper like `ByteBuffer.wrap(payload).asReadOnlyBuffer()`.

Contrast with:

> **Reviewer:** This class implements `Cloneable`. Our policy bans new `Cloneable` code (see `docs/copy-policy.md`). Replace with a copy constructor `public AuditRecord(AuditRecord other)` and remove the `Cloneable` marker. If you need polymorphic copying, expose an abstract `copy()` method on the base.

Both reviews name the symptom (mutable array leak / `Cloneable` use), propose one fix, and end. That is the shape of useful review feedback on copy semantics.

---

## 2. Static analysis: what tooling catches per smell

Several copy-semantic smells are mechanically detectable. Wire them into CI so reviewers can spend attention on the parts machines miss.

**SonarQube rules that map to copy issues:**

- `java:S2975` — *"Cloneables" should implement "clone"*. Catches half-implemented `Cloneable` chains.
- `java:S2157` — *"Cloneables" should be "Serializable"* (or rather, the relationship between them; Sonar flags inconsistencies).
- `java:S2384` — *Mutable members should not be stored or returned directly*. The defensive-copy lint — flags `this.list = list` and `return list` when the list is a known mutable type.
- `java:S2089` — *Locales should be created with language constants* (unrelated, but co-fired by Sonar's mutability lint family).
- `java:S2386` — *Mutable fields should not be "public static"*. Catches the classic `public static final byte[] KEY = ...` leak.

**SpotBugs:**

- `EI_EXPOSE_REP` — *May expose internal representation by returning reference to mutable object*. Fires on accessors that return arrays/lists/maps without a defensive copy.
- `EI_EXPOSE_REP2` — same but on the *constructor* side: `this.x = x` for mutable `x`.
- `CN_IDIOM` — `Cloneable` implementation issues (e.g., not calling `super.clone()`).
- `CN_IDIOM_NO_SUPER_CALL` — `clone()` method that returns `new X(...)` instead of `super.clone()`.
- `CN_IMPLEMENTS_CLONE_BUT_NOT_CLONEABLE` — half-built clone implementations.

These four SpotBugs rules combined cover most legacy `Cloneable` mistakes. The Sonar `S2384` covers most defensive-copy mistakes. Together they catch perhaps 70% of the bug class — leaving the senior judgement calls (cycles, persistent structures, polymorphic copy hierarchies) to humans.

**ArchUnit** is the most direct: encode the team policy as a test that fails the build.

```java
@ArchTest
static final ArchRule no_new_cloneable_in_domain =
    noClasses().that().resideInAPackage("com.acme.domain..")
               .should().implement(Cloneable.class)
               .as("Cloneable is banned in new domain code; use a copy constructor or copyOf.");

@ArchTest
static final ArchRule no_array_accessor_returning_field =
    methods().that().haveRawReturnType(byte[].class)
             .and().areDeclaredInClassesThat().resideInAPackage("com.acme..")
             .should(beAccessorsThatCloneTheirField())
             .as("byte[] accessors must clone; otherwise return ByteBuffer or List<Byte>.");
```

Sonar, SpotBugs, ArchUnit — three lines of defence. Sonar/SpotBugs warn on individual rules; ArchUnit blocks merges on architectural policy. Reviewers handle what the tools can't see.

---

## 3. IDE auto-generation traps

IntelliJ IDEA and Eclipse both offer "Generate clone() method" and "Generate copy constructor" wizards. They get the easy cases right and the interesting cases wrong.

**IntelliJ "Generate clone()" — broken by default.**

IntelliJ generates:

```java
@Override
public AuditRecord clone() throws CloneNotSupportedException {
    AuditRecord clone = (AuditRecord) super.clone();
    // TODO: copy mutable state here, so the clone can't change the internals of the original
    return clone;
}
```

The comment is honest — it tells you exactly what's missing. But the human now has to walk the field list and remember which fields are mutable. IntelliJ does *not* generate the deep-copy lines for `List`, `byte[]`, or custom mutable types. Anyone who accepts the default is shipping a shallow clone. The defaults give you a shape, not a correct copy.

**IntelliJ "Generate copy constructor" — better, but only for primitives + records.**

```java
public AuditRecord(AuditRecord other) {
    this.id          = other.id;
    this.timestamp   = other.timestamp;
    this.payload     = other.payload;          // wrong if mutable
    this.headers     = other.headers;          // wrong if mutable
}
```

Same problem in a different idiom. The wizard performs shallow assignment for every field. The reviewer still has to walk the list against the conversion table from `middle.md` section 11 and convert each mutable-field assignment into the right copy.

**Eclipse** is essentially identical — same shape, same shallow-by-default behaviour, same missing TODO list.

**Team practice:** when you turn on the wizard, *always* immediately scan every assignment line and convert mutable types to `List.copyOf` / `new ArrayList<>` / `array.clone()` / `new Address(other.address)`. Treat the IDE output as a skeleton, not a finished method.

A junior engineer who has just discovered "Generate copy constructor" is the most common source of shallow-copy production bugs. The mentoring move is to pair on the first one and make the per-field judgement visible.

---

## 4. Team policy template: "no `Cloneable` in new code"

A short policy document, posted in your team handbook or `docs/copy-policy.md`, removes the per-PR debate. Sample text:

> **Copy semantics policy**
>
> 1. **`Cloneable` is banned in new code.** Any class introduced after 2024-01-01 in `com.acme..` must not declare `implements Cloneable`. This is enforced by ArchUnit (`CopyPolicyTest`).
> 2. **Use copy constructors for mutable types.** Pattern: `public Foo(Foo other) { ... }`. Walk the field list and use the per-field rules from `senior.md`.
> 3. **Use `copyOf` static factories where the type is shared with other code.** Mirror the JDK's pattern: `Foo.copyOf(other)`.
> 4. **Prefer records.** If the type is a value carrier, declare it as a record. Use `with...` accessors for variants.
> 5. **Defensive copy at every boundary.** Constructor copies in, accessor copies out, for any mutable field that crosses the class wall.
> 6. **Existing `Cloneable` classes are migrated incrementally.** Each migration owner produces a copy constructor, switches callers, and removes the `clone()` method in the same PR. The legacy method may live in deprecated form for one release.
>
> *Exceptions* require sign-off from the platform team and a written rationale.

Three properties make this policy work in practice:

- **Mechanical enforcement.** Rule 1 is an ArchUnit test, not a wiki paragraph.
- **A migration path.** Rule 6 says "incrementally", with a known shape. No big-bang rewrite.
- **An escape hatch.** Some legacy interop genuinely needs `Cloneable` — name the path explicitly, don't pretend it doesn't exist.

Policies without all three either get ignored (no enforcement), block legitimate work (no escape hatch), or produce hostile-rewrite sprints (no migration path).

---

## 5. Migration playbook: retiring `Cloneable` from a legacy module

You inherit a 50-class module where every domain object implements `Cloneable`. The temptation is a single PR that replaces them all. Don't. Strangler-fig per class.

The phased move per class:

1. **Add a copy constructor** alongside the existing `clone()` method. The two coexist for one release. The copy constructor delegates to a fresh field-by-field initialisation; the legacy `clone()` keeps its existing behaviour for any caller that still uses it.

```java
public final class Customer implements Cloneable {

    @Deprecated(forRemoval = true)
    @Override
    public Customer clone() {
        try { return (Customer) super.clone(); }
        catch (CloneNotSupportedException e) { throw new AssertionError(e); }
    }

    public Customer(Customer other) {                  // new — preferred
        this.id      = other.id;
        this.name    = other.name;
        this.address = new Address(other.address);
        this.tags    = List.copyOf(other.tags);
    }
}
```

2. **Migrate callers to the copy constructor.** Search the codebase for `customer.clone()` calls; replace each with `new Customer(customer)`. The IDE's "find usages" + macro replacement makes this mechanical.

3. **Run the test suite.** Any test that used `instanceof Cloneable` or `castedFromClone` flags itself. Fix or delete.

4. **Remove the `Cloneable` marker and the `clone()` method.** The class no longer carries the legacy protocol. The ArchUnit rule from section 2 starts applying.

5. **Repeat per class.** A typical pace is 3–5 classes per sprint, prioritising classes that have recently produced bugs or that are blocking other migrations.

A migration tracker (a Markdown table, a Jira board, a sticky note) listing every `implements Cloneable` occurrence and its owner keeps the work visible. A SonarQube custom rule that counts `Cloneable` implementations gives you a single number that goes down every sprint.

> **Lead to team:** *No big-bang rewrite. We migrate one or two classes per sprint, behind a copy constructor and a contract test. Success is measured by the count of `implements Cloneable` going to zero.*

---

## 6. Mentoring copy semantics

A junior who has just read Bloch item 13 will want to delete every `Cloneable` they see. A junior who has not read it will keep generating `clone()` from the IDE. Neither extreme is useful in a team setting.

The mentoring rhythm:

> **Mentor:** Remember the bug last sprint where the test fixture mutated `customer.address` and broke an unrelated test? That's a defensive-copy bug — the constructor stored the address by reference. Add a `new Address(other.address)` in the constructor and the bug class disappears.

> **Junior:** Should I also rewrite all the other classes that store `Address`?
> **Mentor:** No — only the classes where the next plausible bug is the same shape. Find them by grep, not by rewriting the world.

The rule: teach copy semantics *attached to a real bug the team felt*, not as a five-point list to apply to greenfield code. The five-point list belongs in a policy document; the lived lesson belongs in mentoring.

Pair on the first three migrations. After that, the junior owns the pattern and the senior reviews from afar.

---

## 7. Anti-patterns the team will introduce

These show up in nearly every codebase where copy semantics was taught before it was felt. Spot them early.

**The "I'll just clone everything" reflex.** A junior, having learned `Cloneable` is broken, replaces every reference assignment with a defensive copy *whether or not the type is mutable*:

```java
this.name      = new String(other.name);          // pointless — String is immutable
this.createdAt = Instant.from(other.createdAt);   // pointless — Instant is immutable
this.amount    = new BigDecimal(other.amount.toString()); // pointless, and lossy
```

Each line allocates an object for no semantic gain. Walk the conversion table and only copy types that *need* it.

**The "deep copy everything" overcorrection.** A class that holds a `Currency` (immutable, JDK-managed) gets a "deep copy" that allocates a new `Currency`. Mutable types need copying; immutable types do not. The conversion table is the cure.

**Hand-rolled deep copy via serialization.**

```java
public static <T extends Serializable> T deepCopy(T src) {
    try (var bos = new ByteArrayOutputStream();
         var oos = new ObjectOutputStream(bos)) {
        oos.writeObject(src);
        try (var bis = new ByteArrayInputStream(bos.toByteArray());
             var ois = new ObjectInputStream(bis)) {
            return (T) ois.readObject();
        }
    }
}
```

Convenient, slow (10–100× a hand-rolled copy), brittle (one non-`Serializable` field crashes the walk), and a security risk if `src` ever comes from untrusted input. Banned in most senior codebases. The serialization machinery handles cycles correctly, which is its sole technical merit; everything else is worse than a copy constructor.

**`Cloneable` plus `final` fields, "fixed" with reflection.**

```java
Customer c = (Customer) original.clone();
Field f = Customer.class.getDeclaredField("address");
f.setAccessible(true);
f.set(c, new Address(original.address));
```

If you're here, the design is wrong. Drop `Cloneable`, drop the reflection, write a copy constructor.

**"Get a copy" methods that don't actually copy.**

```java
public List<Order> getOrders() { return this.orders; }
public List<Order> getOrdersCopy() { return new ArrayList<>(this.orders); }
```

The presence of *two* methods is a red flag: one tempts callers into the bug, the other names the safe path. Pick one — either return an unmodifiable view from `getOrders()` and delete the "copy" version, or migrate to a record-based design where the field is itself unmodifiable.

---

## 8. Architectural-level enforcement

The strongest copy-semantics rules are *deny by default at module boundaries*. Three patterns:

- **No mutable types in module exports.** A module's `module-info.java` exports only packages of records, sealed interfaces, and immutable value types. Mutable types are confined to the module's internals.
- **Wrapper types at the API.** A module's public API returns `ImmutableList<T>` (Guava) or `List` produced by `List.copyOf` exclusively. Callers cannot mutate what they receive, ever.
- **Read-only views for stream-style queries.** A `QueryResult` exposes a `Stream<Row>` rather than a `List<Row>`; consumers iterate or collect; the source is never aliased.

The ArchUnit suite enforces all three:

```java
@ArchTest
static final ArchRule exported_apis_return_immutable_lists =
    methods().that().areDeclaredInClassesThat().resideInAPackage("..api..")
             .and().haveRawReturnType(List.class)
             .should(returnUnmodifiableListsOnly());
```

This single rule eliminates a class of `EI_EXPOSE_REP` bugs at the architecture level rather than per class.

---

## 9. Documentation and code comments

Copy-semantic intent is one of the few cases where a code comment *carries information the type signature can't*. Be explicit:

```java
/**
 * A defensive copy of the input list is taken. Subsequent mutations of {@code lines}
 * by the caller do not affect this {@code Cart}; mutations of the returned list
 * from {@link #lines()} are impossible because the returned list is unmodifiable.
 */
public Cart(List<LineItem> lines) {
    this.lines = List.copyOf(lines);
}
```

Two paragraphs, no ceremony. The next maintainer reading the constructor knows the contract without having to reason from first principles. For the high-traffic API classes — `Reservation`, `Order`, `Customer` — these javadoc paragraphs are worth their weight.

A second documentation pattern: when a class is intentionally *shallow* in its copying (because of cost), say so:

```java
/**
 * Shallow copy: the returned {@code Report} shares the same backing {@code Map<String, Aggregate>}
 * as the original. Aggregates are themselves immutable (records); mutation of the map's spine
 * is not possible because both copies wrap the same {@link Map#copyOf} result.
 */
public Report(Report other) {
    this.title       = other.title;
    this.aggregates  = other.aggregates;
}
```

A future reviewer wondering "why didn't they `new HashMap<>(other.aggregates)`" has an answer in two lines.

---

## 10. Cross-team policy: snapshots, audits, history

Copy semantics is also the foundation for cross-cutting concerns. Three places where senior engineers should set policy:

- **Audit logs.** When a domain event records "the order at this moment", it should store an immutable snapshot, not a live reference. A record is the ideal shape; if the underlying type is a class, the audit row stores a deep copy. The senior who skips this introduces "time-travelling audit" bugs that are impossible to debug.

- **Caches.** Whatever you put into a cache must be either immutable or owned by the cache. A cache that returns a shared mutable object to multiple callers will eventually produce a mutation race. The senior policy: caches hold records or unmodifiable values only.

- **Event sourcing.** Events are by definition immutable historical records. A codebase that stores events as mutable classes is one mutation away from a corrupted history. Records, again, are the canonical shape; legacy classes that participate in event sourcing should be deep-copied at the event-write boundary.

Each of these is a place where the copy-policy document earns its keep. A junior writing the cache class doesn't know the rules; the policy plus ArchUnit make the rules visible at PR time.

---

## 11. Quick rules

- [ ] In review, name the specific smell (shallow array, missing defensive copy, `Cloneable` chain dependency) and propose one fix.
- [ ] Wire SpotBugs (`EI_EXPOSE_REP*`, `CN_*`), Sonar (`S2384`, `S2975`), and ArchUnit (no new `Cloneable` in domain) into CI. Reviewers cover what the tools can't.
- [ ] Treat IDE-generated `clone()` / copy-constructor output as a *skeleton*; walk every assignment line against the per-field conversion table.
- [ ] Write a one-page copy policy document, posted alongside other team handbooks. Include enforcement, migration, and escape hatches.
- [ ] Migrate legacy `Cloneable` per class, not per module. Add the copy constructor, switch callers, remove `Cloneable`, in one PR per class.
- [ ] Pair on the first migration with each new team member. Pattern visibility beats documentation.
- [ ] Ban serialization-based deep copy except where bytes-on-wire is the *actual* requirement.
- [ ] Document copy intent on high-traffic constructors and accessors; one paragraph saves an hour of future archaeology.
- [ ] Audit logs, caches, and event-sourced histories are policy-bearing — every junior touching them should know the team rules.

---

## 12. What's next

| Topic                                                                  | File              |
| ---------------------------------------------------------------------- | ----------------- |
| Why `Cloneable` is broken; FBCP; cycles; persistent structures         | `senior.md`        |
| JLS §Object.clone, §Cloneable, JEP 395 records                         | `specification.md` |
| Buggy snippets across clone/copy idioms                                | `find-bug.md`      |
| Native clone vs constructor; escape analysis; Valhalla flat copies     | `optimize.md`      |
| 8 hands-on copy and defensive-copy exercises                           | `tasks.md`         |
| Interview Q&A on clone and copy semantics                              | `interview.md`     |

---

**Memorize this:** copy semantics is a *team policy*, not a per-developer judgement call. Write the policy down, enforce what you can with SpotBugs/Sonar/ArchUnit, mentor the rest by pairing on real bugs, migrate legacy `Cloneable` one class per sprint, and document copy intent at the API boundary. The bug class you never have to debug is the bug class your policy retired.
