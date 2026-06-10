# Inappropriate Intimacy — Tasks

Eight exercises that take you from "spot the smell" to "prove the boundary in CI". Work through them in order — earlier ones build the vocabulary later ones rely on.

## Exercise 1 — Catalogue bidirectional access

Given the following classes, list every place where `Customer` and `LoyaltyAccount` read or write each other's internals. Produce a table of access pairs.

```java
class Customer {
    String name;
    int tier;
    LoyaltyAccount account;
    void upgrade() {
        if (account.points > 1000) tier = 2;
        account.lastUpgradeAt = LocalDate.now();
    }
}
class LoyaltyAccount {
    int points;
    LocalDate lastUpgradeAt;
    Customer owner;
    void debit(int p) {
        points -= p;
        if (points < 0 && owner.tier == 2) owner.tier = 1;
    }
}
```

Validation: at least 4 bidirectional accesses identified.

## Exercise 2 — Refactor to one-way ownership

Refactor Exercise 1 so `Customer` is the only side that mutates `tier`, and `LoyaltyAccount` is the only side that mutates `points` and `lastUpgradeAt`. Use messages (`account.debit(p)` returns a result) rather than field access.

Validation: each field has exactly one writer class; no cross-class field assignment remains.

## Exercise 3 — Break a Jackson serialisation cycle

Given:

```java
@Entity class Author { @Id Long id; String name;
    @OneToMany(mappedBy = "author") List<Book> books; }
@Entity class Book   { @Id Long id; String title;
    @ManyToOne Author author; }

@RestController class AuthorController {
    @GetMapping("/authors/{id}") Author get(@PathVariable Long id) { ... }
}
```

Produce two solutions:

1. Annotate the entities with `@JsonManagedReference` / `@JsonBackReference`.
2. Return a DTO (`AuthorView` with `List<BookView>`) instead of the entity.

Validation: GET `/authors/1` returns a finite JSON document; integration test covers both solutions.

## Exercise 4 — Fix an equals/hashCode cycle

Two entities have `equals`/`hashCode` that recurse into each other (see find-bug Scenario 3). Rewrite them so identity is based on `id` only, then write a test that adds 1,000 such objects to a `HashSet` in 50 ms and proves no StackOverflow.

Validation: test asserts no exception and timing under 50 ms.

## Exercise 5 — Enforce a domain-purity rule with ArchUnit

Add a test class `ArchitectureRulesTest` with rules that:

1. Forbid `javax.persistence` and `jakarta.persistence` imports from `com.shop..domain..`.
2. Forbid Spring annotations in the same packages.
3. Forbid `com.fasterxml.jackson` imports in domain.
4. Forbid cycles between sub-packages of `com.shop`.

Then deliberately introduce a violation and watch the test fail.

Validation: build fails on the deliberate violation, passes after revert.

## Exercise 6 — Split a JPMS module

You are given a single Maven module with packages:

```
com.shop.api
com.shop.api.impl
com.shop.persistence
com.shop.persistence.entity
com.shop.util
```

Create a `module-info.java` that:

- Exports `com.shop.api` only.
- Keeps `com.shop.api.impl` and `com.shop.persistence.*` hidden.
- Uses a qualified export to share `com.shop.util` with `com.shop.tests` only.

Validation: `javac` rejects any external module trying to import a hidden package.

## Exercise 7 — Compute CBO and MPC manually

For the following class, compute CBO, MPC, and MPC/CBO. Then state whether refactoring is warranted.

```java
class OrderProcessor {
    private final OrderRepository repo;
    private final TaxCalculator tax;
    private final ShippingService shipping;

    void process(Order o) {
        repo.lock(o.id());
        repo.attach(o);
        var t = tax.compute(o);
        var s = tax.region(o);
        shipping.book(o);
        shipping.notify(o.customer());
        shipping.track(o.id());
        repo.flush();
    }
}
```

Validation: CBO = 3, MPC = 8, MPC/CBO ≈ 2.7 — within healthy band; no refactor needed.

## Exercise 8 — Replace cross-service cache invalidation with events

Starting point:

```java
class UserService {
    final Map<Long, User> cache = new ConcurrentHashMap<>();
    public User load(long id) { ... }
}
class AuditService {
    final UserService users;
    void onEvent(Event e) { users.cache.remove(e.userId()); }
}
```

Refactor so:

1. `UserService.cache` is `private`.
2. `AuditService` no longer references `UserService`.
3. A `UserChangedEvent` flows between them through Spring's `ApplicationEventPublisher`.

Validation: `AuditService.onEvent` publishes; `UserService` consumes and evicts itself; ArchUnit rule forbids any class outside `users` package from naming `UserService.cache`.

## Validation table

| # | Skill | Pass condition |
|---|-------|----------------|
| 1 | Recognise bidirectional access | 4+ pairs listed |
| 2 | Apply one-way ownership | Each field has one writer |
| 3 | Break Jackson cycle | Two working solutions implemented |
| 4 | Anchor equals/hashCode on id | 1,000-element set test passes under 50 ms |
| 5 | Enforce purity with ArchUnit | Build fails on violation |
| 6 | Use JPMS to hide packages | External import is rejected by `javac` |
| 7 | Read CBO/MPC numbers | Correct computation, correct verdict |
| 8 | Decouple via events | No direct field access between services remains |

## Worked solution sketch — Exercise 2

```java
public final class Customer {
    private final CustomerId id;
    private String name;
    private Tier tier;
    private final LoyaltyAccount account;

    public Customer(CustomerId id, String name, LoyaltyAccount account) {
        this.id = id;
        this.name = name;
        this.tier = Tier.BRONZE;
        this.account = account;
    }

    public void upgradeIfEligible() {
        if (account.qualifiesForUpgrade()) {
            this.tier = this.tier.next();
            account.recordUpgrade(LocalDate.now());
        }
    }

    void downgrade() { this.tier = this.tier.previous(); }
}

public final class LoyaltyAccount {
    private int points;
    private LocalDate lastUpgradeAt;
    private final Consumer<DebitResult> onOverdraft; // callback, not a field reach

    public LoyaltyAccount(int points, Consumer<DebitResult> onOverdraft) {
        this.points = points;
        this.onOverdraft = onOverdraft;
    }

    public boolean qualifiesForUpgrade() { return points > 1000; }

    public DebitResult debit(int p) {
        points -= p;
        var result = new DebitResult(points >= 0, points);
        if (!result.ok()) onOverdraft.accept(result);
        return result;
    }

    void recordUpgrade(LocalDate at) { this.lastUpgradeAt = at; }
}
```

What changed:

- No class reads or writes another's fields.
- Callback (`onOverdraft`) replaces the previous reach into `owner.tier` — `LoyaltyAccount` does not know `Customer` exists.
- `Customer` exposes a package-private `downgrade()` that the same package can wire as the overdraft handler — explicit, narrow, and reviewable.
- Field writers are now: `tier` -> `Customer`, `points` and `lastUpgradeAt` -> `LoyaltyAccount`. Each field has exactly one owner.

## Memorize this

- Decoupling is incremental — eliminate one bidirectional access at a time.
- A successful refactor is measured by *each field has one writer*, not by line count.
- Tests, not comments, prove that a boundary is real (ArchUnit, JPMS, integration tests).
- Callbacks and events are the way to keep behaviour without keeping intimacy.
- A finite JSON document and a fast `HashSet` lookup are the two most common tangible wins.
- Run the metrics before and after — numbers convince teams that the refactor was worth it.
