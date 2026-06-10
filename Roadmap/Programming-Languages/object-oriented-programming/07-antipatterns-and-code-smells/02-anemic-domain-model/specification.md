# Anemic Domain Model — Specification

> Reference: Martin Fowler, *AnemicDomainModel* (https://martinfowler.com/bliki/AnemicDomainModel.html), 2003.

This file gives you precise, falsifiable criteria for calling a class *anemic*. Vague accusations ("this feels like an anemic model") lose code reviews. Numbers and ArchUnit rules win them.

## 1. Formal definition

A class `C` is **anemic** when all of the following hold:

1. `C` declares one or more domain-meaningful fields (not just an ID or timestamps).
2. `C` exposes at least one mutator (setter, or constructor + setter combination) that lets an arbitrary caller place `C` into a state forbidden by the business rules.
3. Behavior that mutates `C` or computes values *derived from* `C`'s state lives in a separate "service" class rather than on `C` itself.
4. Removing `C`'s behavior-bearing methods leaves the class still useful to its current callers — meaning callers depend on `C` only as a data carrier.

A **rich** model is the negation: invariants hold by construction, mutations are domain operations, and removing behavior from the class breaks callers.

## 2. Quantitative metrics

### 2.1 Method-to-field ratio (MFR)

```
MFR = (non-accessor methods) / (domain-meaningful fields)
```

Exclude `getX`, `setX`, `equals`, `hashCode`, `toString`, JPA lifecycle callbacks, and synthetic methods.

| MFR | Verdict |
| --- | --- |
| 0.0 | Pure data class — definitely anemic |
| 0.0 – 0.3 | Suspicious, almost certainly anemic |
| 0.3 – 0.8 | Borderline, inspect manually |
| 0.8 – 2.0 | Likely rich |
| > 2.0 | Probably has behavior that belongs elsewhere |

### 2.2 Getter-to-behavior ratio (GBR)

```
GBR = (public getters) / (public behavior methods)
```

Behavior methods are the ones that *do* something other than return a field. `GBR > 3` strongly suggests anemia. `GBR < 1` suggests over-encapsulation worth checking.

### 2.3 LCOM (Lack of Cohesion of Methods)

LCOM4 counts disjoint sets of methods that share fields. For an anemic class with N getters and M setters:

```
LCOM4 ≈ min(N, M)
```

because every getter touches one field and never overlaps with others. A rich class with cross-field invariants has `LCOM4 = 1`.

### 2.4 Mutator-to-invariant ratio

Count `setX` methods on the class. Count business invariants the class is supposed to maintain (you'll find these in the requirements, the database constraints, or scattered across services). If `setters > invariants` you have an anemia signal — the class lets you bypass at least one invariant per setter that doesn't validate.

## 3. Rich vs anemic — worked comparison

### Anemic

```java
public class Account {
    private UUID id;
    private BigDecimal balance;
    private String currency;
    private boolean frozen;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public BigDecimal getBalance() { return balance; }
    public void setBalance(BigDecimal balance) { this.balance = balance; }
    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public boolean isFrozen() { return frozen; }
    public void setFrozen(boolean frozen) { this.frozen = frozen; }
}
```

- Domain fields: 4 (id, balance, currency, frozen).
- Behavior methods: 0.
- MFR = 0.0 / 4 = **0.0** → anemic.
- LCOM4 = 4 (every setter is a disjoint cluster).
- Invariants violated freely: negative balance, currency change mid-flight, balance change on frozen account.

### Rich

```java
public final class Account {
    private final AccountId id;
    private Money balance;
    private boolean frozen;

    private Account(AccountId id, Money initial) {
        this.id = Objects.requireNonNull(id);
        this.balance = Objects.requireNonNull(initial);
        this.frozen = false;
    }

    public static Account open(AccountId id, Money initialDeposit) {
        if (initialDeposit.amount().signum() < 0) {
            throw new IllegalArgumentException("Negative initial deposit");
        }
        return new Account(id, initialDeposit);
    }

    public void deposit(Money amount) {
        requireActive();
        requireSameCurrency(amount);
        balance = balance.add(amount);
    }

    public void withdraw(Money amount) {
        requireActive();
        requireSameCurrency(amount);
        if (balance.amount().compareTo(amount.amount()) < 0) {
            throw new InsufficientFundsException(id, balance, amount);
        }
        balance = balance.subtract(amount);
    }

    public void freeze() {
        if (frozen) throw new IllegalStateException("Already frozen");
        frozen = true;
    }

    private void requireActive() {
        if (frozen) throw new AccountFrozenException(id);
    }

    private void requireSameCurrency(Money m) {
        if (!balance.currency().equals(m.currency())) {
            throw new CurrencyMismatchException(balance.currency(), m.currency());
        }
    }

    public AccountId id() { return id; }
    public Money balance() { return balance; }
    public boolean isFrozen() { return frozen; }
}
```

- Domain fields: 3 (id, balance, frozen). `currency` moved into `Money`.
- Behavior methods: 4 (`open`, `deposit`, `withdraw`, `freeze`).
- MFR = 4 / 3 ≈ **1.33** → rich.
- LCOM4 = 1 (every behavior touches `balance` and `frozen` together).
- Invariants enforced: non-negative balance, currency consistency, no operations on frozen accounts.

## 4. Detection automation

### 4.1 ArchUnit rules

```java
@AnalyzeClasses(packages = "com.example.domain")
class AnemiaDetectionTest {

    @ArchTest
    static final ArchRule no_setters_on_domain_entities =
        methods()
            .that().arePublic()
            .and().haveNameStartingWith("set")
            .and().areDeclaredInClassesThat().areAnnotatedWith(Entity.class)
            .should().bePrivate()
            .orShould().beProtected();

    @ArchTest
    static final ArchRule entities_must_have_behavior_methods =
        classes()
            .that().areAnnotatedWith(Entity.class)
            .and().areNotInterfaces()
            .should(new ArchCondition<JavaClass>("declare at least one non-accessor public method") {
                @Override
                public void check(JavaClass clazz, ConditionEvents events) {
                    long behaviorCount = clazz.getMethods().stream()
                        .filter(m -> m.getModifiers().contains(JavaModifier.PUBLIC))
                        .filter(m -> !m.getName().startsWith("get"))
                        .filter(m -> !m.getName().startsWith("set"))
                        .filter(m -> !m.getName().startsWith("is"))
                        .filter(m -> !m.getName().equals("equals"))
                        .filter(m -> !m.getName().equals("hashCode"))
                        .filter(m -> !m.getName().equals("toString"))
                        .count();
                    if (behaviorCount == 0) {
                        events.add(SimpleConditionEvent.violated(clazz,
                            clazz.getName() + " is anemic: no behavior methods"));
                    }
                }
            });

    @ArchTest
    static final ArchRule services_must_not_be_the_only_mutators =
        noClasses()
            .that().haveSimpleNameEndingWith("Service")
            .should().callMethodWhere(JavaCall.Predicates.target(
                HasName.Predicates.nameMatching("set[A-Z].*"))
                .and(JavaCall.Predicates.target(
                    HasOwner.Predicates.With.owner(
                        JavaClass.Predicates.resideInAPackage("..domain..")))));
}
```

### 4.2 Static analysis hints

- **PMD**: `DataClass` rule flags pure data carriers.
- **SonarQube**: `java:S1820` (too many fields) and `java:S1448` (too many methods, often appears with anemic + helper services).
- **Custom Checkstyle**: write a check that fails when an `@Entity` class has only `public` getters/setters and no other public methods.

## 5. Decision flow

When reviewing a class, walk this in order:

1. Is the class in the domain layer? If no → skip; anemic data carriers are fine in DTO/persistence/projection layers.
2. Does it have business invariants documented? If no → write them first, then re-evaluate.
3. Compute MFR. If MFR < 0.3 → anemic candidate.
4. List its setters. For each setter, ask "can a caller create an invalid state through this?" If yes for any → anemic.
5. Look at the services calling this class. Are they implementing logic that mutates the class's state based on the class's state? That logic belongs on the class.
6. Apply the fix: replace setters with behavior methods, move invariant checks into the class, validate in the constructor.

## 6. When anemic is the correct answer

- **DTOs** at API boundaries — they carry data across the wire and have no business rules.
- **Read models / projections** in CQRS — they exist to be displayed, not validated.
- **Event payloads** — events are immutable facts, often records with no behavior beyond what `record` gives you.
- **Configuration objects** — `@ConfigurationProperties` POJOs.
- **JPA entities for legacy schemas** when you cannot refactor and choose to keep a thin entity + a separate domain object that wraps it.

Outside these contexts, anemia in the domain layer is a defect.

## Memorize this

- **Anemic = data + no invariants + behavior elsewhere.** All three conditions must hold.
- **MFR < 0.3 in the domain layer is a red flag.** Investigate every such class.
- **LCOM4 ≈ field-count for anemic classes, ≈ 1 for rich classes.** Cohesion follows behavior.
- **Setters per invariant > 1 means at least one invariant is unguarded.** Count them in code review.
- **ArchUnit rules catch anemia in CI.** Add them once and stop arguing forever.
- **DTOs, read models, and events are correctly anemic.** Domain entities are not.
