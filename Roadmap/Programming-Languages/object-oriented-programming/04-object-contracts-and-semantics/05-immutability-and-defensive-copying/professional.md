# Immutability and Defensive Copying — Professional

> **What?** Driving immutability across a team and a codebase: the review vocabulary, the static-analysis rules that catch missed defensive copies, the team policy that makes new domain types immutable by default, the IDE inspections that surface field-mutation drift, the refactor sprint that converts a mutable layer to records, and the trade-offs you accept around frameworks that fight back.
> **How?** Treat immutability as the *default* and exceptions as exceptions. Wire the rules into CI where they can be mechanical. In code review, name the missed copy, point at the broken field, propose the smallest fix.

---

## 1. Code-review vocabulary — name the leak

Most immutability bugs are small, identifiable, and easy to fix once you have the words. Three review phrases cover most cases.

```java
// PR diff under review:
public record Order(long id, List<LineItem> items) { }
```

> **Reviewer.** This record has a mutable `List<LineItem>` component without a compact constructor. The caller's list reference is shared with the record, so they can `items.add(...)` post-construction and mutate the order. Add a compact constructor with `items = List.copyOf(items)`.

```java
// Another diff:
public List<Customer> getCustomers() {
    return customers;
}
```

> **Reviewer.** This is a leaky getter on a class that calls itself immutable. The internal list reference escapes; callers can mutate the customer collection. Either return `List.copyOf(customers)` here, or — better — store `customers` as `List.copyOf(...)` once in the constructor and return the field directly.

```java
// Constructor diff:
public Reservation(Date checkIn, Date checkOut) {
    this.checkIn = checkIn;
    this.checkOut = checkOut;
}
```

> **Reviewer.** `java.util.Date` is mutable and the constructor stores the caller's reference. A copy is required: `this.checkIn = new Date(checkIn.getTime())`. If this is new code, please replace `Date` with `Instant` and the whole defensive-copy problem disappears.

The shape of useful review feedback: name the broken field, name the rule it broke (rule 5 of Bloch's recipe), propose one concrete fix. "This is not immutable" without specifics is finger-pointing.

---

## 2. Static analysis — what tooling can catch

Several rules in mainstream Java static analysis flag missed immutability or wrong defensive copies. Wire what you can into CI; reviewers spend their attention where machines can't see.

**SonarQube** (java rules):

- `java:S1659` — "Multiple variables should not be declared on the same line." A small style rule, but it's how `private final` declarations stay easy to skim.
- `java:S1450` — "Private fields only used as local variables in methods should become local variables." Hints at fields that are mutated method-locally and don't need to exist.
- `java:S1170` — "Public constants and fields initialized at declaration should be 'static final' rather than just 'final'." Catches near-misses on intent.
- `java:S2386` — "Mutable fields should not be 'public static'." The canonical "static mutable singleton list" bug.
- `java:S3014` — "ThreadGroups should not be used." Tangential, but related: anything that smells of shared mutable state is worth a rule.
- `java:S3437` — "java.util.Date and java.sql.* date types should not be used." Surfaces uses of mutable date types — the perfect prompt to migrate to `Instant`.
- `java:S2055` — "The non-serializable super class of a 'Serializable' class should have a no-argument constructor." Immutability adjacency: deserialisation can build objects that skip your constructor.

**SpotBugs**:

- `EI_EXPOSE_REP` — "May expose internal representation by returning reference to mutable object." The classic leaky-getter detector.
- `EI_EXPOSE_REP2` — "May expose internal representation by incorporating reference to mutable object." The classic missed-defensive-copy in the constructor.
- `MS_MUTABLE_ARRAY` / `MS_MUTABLE_COLLECTION` — static mutable fields.
- `SE_NO_SUITABLE_CONSTRUCTOR` — serialisable classes with mutable state and no constructor for deserialisation.

The `EI_EXPOSE_REP` family alone catches most of bugs 1, 2, 4, 5, 8, 10 in `find-bug.md`. Enabling SpotBugs with these rules at error severity is the single highest-yield intervention for teams that have not adopted immutability discipline yet.

**ArchUnit** for enforcing a team policy:

```java
@ArchTest
static final ArchRule domain_classes_are_immutable_records =
    classes().that().resideInAPackage("..domain..")
             .and().areNotInterfaces()
             .should().beRecords();

@ArchTest
static final ArchRule no_mutable_date_in_domain =
    noClasses().that().resideInAPackage("..domain..")
               .should().dependOnClassesThat()
               .haveFullyQualifiedName("java.util.Date");
```

ArchUnit makes architectural rules into tests. The first one fails any new domain class that isn't a record; the second one fails on the first `import java.util.Date` in the domain. Both are reversible — annotate the exception and document the choice — but the default points the right direction.

**Error Prone** (Google) ships `@Immutable` and an analyser that verifies the annotated class actually is immutable (transitively):

```java
@com.google.errorprone.annotations.Immutable
public final class Money {
    private final long cents;
    private final Currency currency;
    // compiler error if a field's type is not provably immutable
}
```

When you can introduce Error Prone, the `@Immutable` checker is the closest Java has to a *compile-time* immutability guarantee. It is conservative — it doesn't trust `List` unless you also annotate or use `ImmutableList` — but conservative is what you want for the safety-critical classes.

---

## 3. Team policy: immutable by default

The most leverage-positive policy a team can adopt is a *default* — not a mandate, a default. The wording matters.

> **New domain types are records or `final` classes with `final` fields. Mutability is documented with a comment that names the reason.**

This formulation has three effects:

1. **Reviewers don't need a discussion every PR.** The default is the conversation; the deviation is the conversation.
2. **The reason for mutability ends up in the diff.** "`// Mutable: framework demands setters for JPA hydration"` or `"// Mutable: this is a builder, hand-off contract"`.
3. **The exceptions stay countable.** Six classes out of two hundred are mutable; the team can debate each one on its merits.

The policy applies to *new* code. Don't rewrite legacy in one swoop. The strangler-fig story (see section 8) covers migration.

Documenting it in a short team handbook entry is enough. The entry I've used:

> **Immutability rule.** When introducing a new value/domain type, prefer `record`. If you cannot use a record (e.g., the type is an entity managed by JPA), make the class `final` with `private final` fields and no setters. If the class must hold a mutable component (a legacy `Date`, an `int[]`, a `List` from a third-party API), defensively copy in the constructor and either copy out in the getter or expose an immutable view. New code may not use `java.util.Date`, `java.util.Calendar`, or mutable static collections without an explicit `@SuppressWarnings` and a one-line rationale.

The two paragraphs above, in a `CONVENTIONS.md` or wiki page, cover 95% of the questions.

---

## 4. IDE inspections — surface the drift

IntelliJ IDEA ships several inspections worth raising to error level on the team profile.

- **"Field can be `final`."** Any non-final private field flagged. The default is *warning*; raise to *error* if you want to enforce.
- **"Method can be 'final'."** Subset of the same idea applied to methods. Useful for sealed-class subclasses.
- **"Class can be `final`."** Catches concrete classes with no subclasses in the project.
- **"Return of internal mutable field."** Direct counterpart to SpotBugs `EI_EXPOSE_REP`.
- **"Local variable can be `final`."** Minor, but normalises the discipline.
- **"Use of `java.util.Date`."** Custom inspection; flag any new usage.

Eclipse and VS Code Java extensions have similar inspections; the names vary. The point is to make the IDE itself surface the drift as the code is being written, before the PR is opened.

A useful complementary practice: a *project-level code-style template* that turns "convert to record" into a one-click refactor when applicable. Modern IntelliJ supports this directly. The "Refactor → Convert to record" action handles most of the boilerplate.

---

## 5. Anti-patterns juniors will introduce

These appear in nearly every codebase that adopts immutability without enough mentoring. Recognise them in review.

**Defensive copy of an already-immutable type.**

```java
public final class Person {
    private final String name;
    public Person(String name) {
        this.name = new String(name);                       // wasteful
    }
}
```

`String` is immutable. `new String(s)` allocates a fresh object that holds the same backing characters and accomplishes nothing except teaching the next reader that you don't trust `String`. Drop the copy. The same applies to `Instant`, `LocalDate`, `BigDecimal`, `UUID`, `Optional`, and records.

**Returning `Collections.unmodifiableList(new ArrayList<>(items))` instead of `List.copyOf(items)`.**

The first allocates an `ArrayList` and wraps it. The second allocates one immutable list. Functionally similar, but `List.copyOf` is shorter, faster, and short-circuits when the input is already immutable.

**The "wither" that forgets a field.**

```java
public Customer withEmail(String e) {
    return new Customer(id, name, e, /* addresses = */ null);    // bug
}
```

Hand-written `with*` methods drift out of sync when fields are added. Use Lombok `@With`, Immutables, or a code-generation tool — or write a single `from(existing).field(new).build()` builder that has only one place to maintain.

**`Collections.unmodifiableList` on a list the class continues to mutate.**

```java
private final List<String> tags = new ArrayList<>();
public void addTag(String t) { tags.add(t); }
public List<String> tags()   { return Collections.unmodifiableList(tags); }
```

This is *not* immutability. The class is mutable; the getter returns a *read-only view* of a list the class keeps mutating. Callers who store the returned view see it change unexpectedly. If the class is supposed to be immutable, drop `addTag` entirely and accept tags in the constructor. If the class is supposed to be mutable but the API is read-only, document it; don't pretend.

**Immutable field of a mutable type.**

```java
private final OkHttpClient http;
```

The reference is final, but `OkHttpClient` is a stateful, mutable, multithreaded object. The class is *not* immutable in the value-object sense, but it may be *thread-safe* if the embedded objects are. Use vocabulary precisely: this class is *stateless* in user-facing semantics, not *immutable*.

---

## 6. When to call a refactor sprint

Most immutability work happens in PR-sized increments — each new class arrives immutable; each legacy class gets migrated when its owner team next touches it. Occasionally a dedicated sprint is justified. Signals:

1. **A specific module dominates the bug list because of mutation surprises.** Three production incidents in six months caused by "someone set a field and stale data slipped through" is your evidence.
2. **Concurrency rework is on the roadmap.** Migrating to immutable snapshots up-front pays for itself many times over in the new lock-free code.
3. **A framework upgrade introduces records support** (Hibernate 6, Jackson 2.12+, Spring 6) and the team wants to take the chance to flip the default.

Scope the sprint tightly. "Migrate domain values in the `pricing` package to records, with defensive copies on three remaining legacy `Date` fields" is a sprint. "Make the codebase immutable" is not.

> **Lead to team.** This sprint we touch only `pricing.*`. The exit criteria: every value class is a record or `final` with `final` fields, no `java.util.Date` remains, every `List`/`Map`/`Set` field stores a `List.copyOf`/`Map.copyOf`/`Set.copyOf` snapshot. The existing test suite plus the new property-based test for `Money` round-trips both pass. We do not touch entity classes, repositories, or DTO mappers.

---

## 7. The framework wars — choose the trade

Three frameworks reliably push back against immutability. Senior judgement is choosing where to bend.

**JPA / Hibernate.** Entities want a no-arg constructor, getters/setters, and a mutable lifecycle (the persistence context tracks changes through dirty fields). Records as entities are technically supported in Hibernate 6.2+ but the framework is happier with mutable. *Trade:* keep entities mutable, but extract immutable *value objects* for everything that doesn't need to be persistent-context-aware — money, addresses, IDs, currency codes. The entity holds immutable values; the entity itself stays mutable to keep the framework happy.

**Jackson / JSON binding.** Modern Jackson handles records cleanly. Pre-records, you needed `@JsonCreator` + `@JsonProperty` on parameters. Today: records as DTOs at the API boundary, mapped to/from domain types or entities one layer in. No fight.

**Lombok.** `@Data` generates setters and breaks immutability. `@Value` generates the immutable version. If your project uses Lombok, mandate `@Value` for value-shaped types and reserve `@Data` for explicit DTOs that you've decided are mutable. The ArchUnit rule from section 2 doubles as a guard.

**Bean validation (`@Valid`, `@NotNull`).** Works on records; works on immutable `final` classes; no fight.

**JAXB / older XML.** Wants setters. Avoid if you can. Use Jackson XML, JAXB with builder-based unmarshalling, or a separate mutable parsing layer.

The pattern across all of these: *let the framework keep the layer it owns, push immutable values down into the domain.* The application's brain is immutable; the framework's edges are not. A clean conversion at the boundary is much cheaper than fighting the framework on its home turf.

---

## 8. Migrating a legacy module — strangler fig

You inherit `LegacyCustomerService` with twenty mutable POJOs, half of them stale-cached in `static Map` fields. The temptation is a rewrite. Don't. The strangler-fig pattern grows immutability around the legacy and slowly retires it.

The phased move:

1. **Build immutable DTOs at the boundaries.** Anywhere `LegacyCustomerService` returns a mutable `Customer` to a controller or to another module, introduce an immutable `CustomerView` record and convert. The legacy still mutates internally; callers see immutable snapshots.

```java
public record CustomerView(long id, String name, String email, List<AddressView> addresses) {
    public CustomerView {
        addresses = List.copyOf(addresses);
    }
    public static CustomerView from(Customer legacy) {
        return new CustomerView(
            legacy.getId(),
            legacy.getName(),
            legacy.getEmail(),
            legacy.getAddresses().stream().map(AddressView::from).toList());
    }
}
```

2. **Stop mutating after read.** Every method that reads a `Customer` and then modifies it on the side becomes two methods: one that reads and returns a `CustomerView`, one that takes a *new desired state* and persists. The legacy machinery is unchanged inside; the API surface is immutable.

3. **Migrate writers one at a time.** Each call site that holds a mutable `Customer` and calls `customer.setX(...)` gets refactored to build a new `CustomerView`, hand it to a write method, and discard the old reference. The legacy still has setters; new code stops calling them.

4. **Replace the legacy with a record-based implementation.** Once no external caller mutates the legacy directly, swap the implementation for one that uses immutable records internally too. The interface stays the same; the guts change.

5. **Delete the setters.** Last step. Now the type itself is immutable.

> **Senior to team.** Two sprints. Sprint one: introduce `CustomerView` and `AddressView`, migrate all read paths through them. Sprint two: replace the writer paths. The legacy `Customer` class deletes at the end of sprint two. We don't touch `Order` or `Invoice` in this round — they get their own sprints.

Strangler-fig is immutability applied as *motion through time*. The principle is unchanged; the work is sequenced so the codebase compiles every day.

---

## 9. Quick rules

- [ ] In review, name the broken field and the rule it broke. Propose one concrete fix.
- [ ] Wire SpotBugs `EI_EXPOSE_REP` / `EI_EXPOSE_REP2` at error severity. Add Sonar `java:S3437` for legacy `Date`.
- [ ] Adopt the team policy: *new domain types are records or `final` with `final` fields; mutability is documented in a comment*.
- [ ] Add an ArchUnit rule for the domain package: must be a record (or annotated exception).
- [ ] Raise IDE inspections "Field can be final", "Class can be final", "Return of internal mutable field" to error.
- [ ] Defensive copy applies to mutable components only. `String`/`Instant`/records pass through untouched.
- [ ] Prefer `List.copyOf` over `Collections.unmodifiableList(new ArrayList<>(...))`.
- [ ] Frameworks that need setters get their own layer at the boundary. The domain stays immutable.
- [ ] Migrate legacy by strangler fig: immutable views first, immutable writers second, delete setters last.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| JLS §17.5, JEP 395 records, JEP 401 value classes           | `specification.md` |
| Spot the bug — 10 broken-immutability snippets              | `find-bug.md`      |
| Escape analysis, scalar replacement, allocation cost        | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

Cross-references inside this section:

- [../01-equals-hashcode-tostring-contracts/](../01-equals-hashcode-tostring-contracts/) — once a class is immutable, the equality discipline becomes trivial.
- [../03-clone-and-copy-semantics/](../03-clone-and-copy-semantics/) — copy-on-input replaces `Cloneable` as the modern idiom.
- [../04-object-identity-vs-equality/](../04-object-identity-vs-equality/) — immutable values trend toward value equality and (under Valhalla) value identity.
- [../../03-design-principles/](../../03-design-principles/) — immutability is the substrate for SOLID's SRP value carriers and DIP's `final`-field injection.

---

**Memorize this:** immutability is a *team default*, enforced by tooling, with explicit and documented exceptions. The code review vocabulary is "name the field, name the broken rule, propose the smallest fix". SpotBugs and ArchUnit catch 80% of the mistakes mechanically; the rest is mentoring. Frameworks that fight back get their own layer; the domain stays immutable. Legacy migrates by strangler fig — immutable views first, immutable writers second, delete the setters last.
