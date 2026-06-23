# Anemic Domain Model — Middle

> **What?** Fowler's 2003 critique placed the Anemic Domain Model squarely as an antipattern in *object-oriented* design, but kept open that the same shape, used outside the core domain, is fine. The shape is procedural code expressed in OO syntax — and most Java codebases drift into it gravitationally because JPA/Hibernate, JavaBeans tooling, Jackson, Spring MVC, and IDE "Generate Getters and Setters" wizards all reward it.
> **How?** This file walks the procedural-vs-OO mental shift, shows the four idiomatic Java forces that pull you toward anemia, and refactors a small `Account` example end-to-end — moving validation from `setBalance` into `deposit`, introducing a value object for `Money`, and shrinking the service to a coordinator.

---

## 1. Fowler's original critique

Martin Fowler's bliki entry *AnemicDomainModel* (November 2003, [martinfowler.com/bliki/AnemicDomainModel.html](https://martinfowler.com/bliki/AnemicDomainModel.html)) is short and worth reading in full. The core argument runs:

> "The catch comes when you look at the behavior, and you realize that there is hardly any behavior on these objects, making them little more than bags of getters and setters. ... The fundamental horror of this antipattern is that it's so contrary to the basic idea of object-oriented design; which is to combine data and process together."

Fowler credits the observation to Eric Evans (*Domain-Driven Design*, 2003), who treated it as the failure mode that DDD was built to prevent. The two books that you should read together are:

- **Eric Evans**, *Domain-Driven Design: Tackling Complexity in the Heart of Software* (Addison-Wesley, 2003) — the "rich model with invariants, value objects, aggregates, factories" doctrine.
- **Vaughn Vernon**, *Implementing Domain-Driven Design* (Addison-Wesley, 2013) — the modern Java/C# pragmatic restatement.

The original sin in anemic models is *not* "too many getters". It's that **the class with the data has no opinions about the data**. The opinions live somewhere else. Object orientation's whole point was to keep the two together.

---

## 2. Procedural vs object-oriented thinking

In a procedural language (C, classic Pascal), the natural decomposition is:

- **Data structures** — `struct Account { double balance; }`
- **Functions over those structures** — `void deposit(Account *a, double amt)`

Java's `class` keyword doesn't force you out of that style. You can write:

```java
class Account {
    double balance;       // public field, or fields-with-getters-and-setters
}

class AccountFunctions {
    static void deposit(Account a, double amt) {
        if (amt < 0) throw new IllegalArgumentException();
        a.balance += amt;
    }
    static void withdraw(Account a, double amt) {
        if (amt < 0) throw new IllegalArgumentException();
        if (a.balance < amt) throw new IllegalStateException();
        a.balance -= amt;
    }
}
```

This is C in Java's syntax. The fact that `AccountFunctions` is called `AccountService` and uses constructor injection doesn't change its shape — it's still a free function over a passive struct.

The object-oriented re-cast says the *struct* should be the *object*. `Account` is not a record of data the rest of the system manipulates — it is *the entity that knows how to deposit and withdraw*. The behaviour and the data are one indivisible unit, because the invariants between them ("balance never goes negative") can only be enforced when both are visible to the same scope.

When you internalise this shift, you stop writing `accountService.deposit(account, amount)` and start writing `account.deposit(amount)`. It is a tiny syntactic change with a large architectural consequence: invariants now live with the data they constrain.

---

## 3. Why Java codebases drift anemic

Four forces in the standard Java toolchain make the anemic shape the *default*, and a rich model an active choice.

### 3.1 JPA / Hibernate

JPA was specified around the JavaBeans convention: a no-arg constructor, every persistent property exposed via getter and setter. Reflect on the Hibernate user guide:

```java
@Entity
@Table(name = "accounts")
public class Account {
    @Id @GeneratedValue private Long id;
    @Column private BigDecimal balance;
    @Column private String currency;

    public Account() {}                                  // required by JPA

    public Long getId()                       { return id; }
    public void setId(Long id)                { this.id = id; }
    public BigDecimal getBalance()            { return balance; }
    public void setBalance(BigDecimal b)      { this.balance = b; }
    public String getCurrency()               { return currency; }
    public void setCurrency(String c)         { this.currency = c; }
}
```

Hibernate uses the no-arg constructor to materialise instances and *then* sets fields. The path of least resistance — and almost every tutorial — leaves the constructor public, the setters public, and the entity wide open to mutation by any caller. The behaviour that *should* be on `Account` ends up in `AccountService` because that's where the JPA `EntityManager` lives.

The fix is non-obvious but real: make the no-arg constructor `protected` (JPA allows it), drop the setters or make them `private`, and use static factory methods plus domain methods. JPA still works through reflection. The entity stays rich.

### 3.2 Jackson / Spring MVC

Spring's REST controllers consume and produce JSON via Jackson. Jackson defaults assume getters and setters. When the *same class* you use for the REST payload is the *same class* you persist as a domain entity, the convenience pulls you into anemic shape on both ends.

The cure is to separate the two: `UserCreateRequest` (the JSON DTO) is anemic by design; `User` (the domain entity) is rich. We'll cover the MapStruct mechanics in `professional.md`.

### 3.3 IDE wizards

Every Java IDE has "Generate Getters and Setters" on the right-click menu. None of them have "Generate Domain Methods". A junior dev declares fields, right-clicks, accepts the generated code, and moves on. The output is anemic by default, and nothing in the tooling questions it.

### 3.4 Lombok

```java
@Data                // generates getters, setters, equals, hashCode, toString
@AllArgsConstructor
@NoArgsConstructor
public class Account {
    private Long id;
    private BigDecimal balance;
    private String currency;
}
```

`@Data` is the IDE wizard at compile time. It produces a perfect anemic shape in three annotations. Lombok itself isn't the villain — `@Value` (immutable, no setters) and `@Getter` (no setters) exist — but the path of least resistance is `@Data`.

---

## 4. A small refactor: `Account` with `setBalance` to `Account.deposit`

Start with the anemic shape we'd find in production:

```java
@Entity
@Table(name = "accounts")
public class Account {
    @Id @GeneratedValue private Long id;
    @Column private BigDecimal balance;
    @Column private String currency;

    public Account() {}
    public Long getId()                       { return id; }
    public BigDecimal getBalance()            { return balance; }
    public void setBalance(BigDecimal b)      { this.balance = b; }
    public String getCurrency()               { return currency; }
    public void setCurrency(String c)         { this.currency = c; }
}

@Service
public class AccountService {
    private final AccountRepository repo;
    public AccountService(AccountRepository repo) { this.repo = repo; }

    @Transactional
    public void deposit(Long accountId, BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
        Account a = repo.findById(accountId)
                        .orElseThrow(() -> new NoSuchElementException("account"));
        a.setBalance(a.getBalance().add(amount));
        repo.save(a);
    }

    @Transactional
    public void withdraw(Long accountId, BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
        Account a = repo.findById(accountId)
                        .orElseThrow(() -> new NoSuchElementException("account"));
        if (a.getBalance().compareTo(amount) < 0) {
            throw new IllegalStateException("insufficient funds");
        }
        a.setBalance(a.getBalance().subtract(amount));
        repo.save(a);
    }
}
```

Several smells live together here. The class `Account` has no behaviour; the rules ("amount > 0", "balance never goes negative") are in the service; the same caller could bypass `withdraw` and call `setBalance(-1_000_000)` and Hibernate would happily persist it. The currency is a `String` that no one validates.

### Step 1 — move the operation onto `Account`

```java
@Entity
@Table(name = "accounts")
public class Account {
    @Id @GeneratedValue private Long id;
    @Column private BigDecimal balance;
    @Column private String currency;

    protected Account() {}                                 // JPA only

    public Account(BigDecimal initialBalance, String currency) {
        if (initialBalance == null || initialBalance.signum() < 0) {
            throw new IllegalArgumentException("initial balance must be >= 0");
        }
        if (currency == null || currency.length() != 3) {
            throw new IllegalArgumentException("currency must be ISO 4217");
        }
        this.balance = initialBalance;
        this.currency = currency;
    }

    public void deposit(BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
        this.balance = this.balance.add(amount);
    }

    public void withdraw(BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
        if (this.balance.compareTo(amount) < 0) {
            throw new IllegalStateException("insufficient funds");
        }
        this.balance = this.balance.subtract(amount);
    }

    public Long id()              { return id; }
    public BigDecimal balance()   { return balance; }
    public String currency()      { return currency; }
}

@Service
public class AccountService {
    private final AccountRepository repo;
    public AccountService(AccountRepository repo) { this.repo = repo; }

    @Transactional
    public void deposit(Long accountId, BigDecimal amount) {
        Account a = repo.findById(accountId)
                        .orElseThrow(() -> new NoSuchElementException("account"));
        a.deposit(amount);
    }

    @Transactional
    public void withdraw(Long accountId, BigDecimal amount) {
        Account a = repo.findById(accountId)
                        .orElseThrow(() -> new NoSuchElementException("account"));
        a.withdraw(amount);
    }
}
```

Notice what changed:

- The service no longer contains the rules. It loads, delegates, and lets JPA's dirty-checking persist the changed entity at transaction commit. (No explicit `repo.save(a)` is needed — Hibernate detects the changed state of the managed entity.)
- The constructor enforces invariants. You cannot create an `Account` with a negative balance or a non-ISO currency.
- The no-arg constructor is `protected`. JPA still uses it via reflection; application code cannot.
- The setters are gone. Mutation happens through `deposit` and `withdraw`, methods whose names describe domain operations.

### Step 2 — introduce a `Money` value object

The pair `(balance, currency)` always moves together. Splitting them as two scalar fields is a sign of *Primitive Obsession* (see `../09-primitive-obsession/`). Wrap them:

```java
public record Money(BigDecimal amount, String currency) {
    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        if (currency.length() != 3) {
            throw new IllegalArgumentException("currency must be ISO 4217");
        }
        if (amount.signum() < 0) {
            throw new IllegalArgumentException("amount must be >= 0");
        }
    }

    public Money plus(Money other) {
        requireSameCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }

    public Money minus(Money other) {
        requireSameCurrency(other);
        BigDecimal result = amount.subtract(other.amount);
        if (result.signum() < 0) {
            throw new IllegalStateException("result would be negative");
        }
        return new Money(result, currency);
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("currency mismatch");
        }
    }
}
```

`Account` now holds a `Money`, not a pair of scalars:

```java
@Embeddable
public record Money(BigDecimal amount, String currency) { /* same */ }

@Entity
@Table(name = "accounts")
public class Account {
    @Id @GeneratedValue private Long id;

    @Embedded
    @AttributeOverrides({
        @AttributeOverride(name = "amount",   column = @Column(name = "balance")),
        @AttributeOverride(name = "currency", column = @Column(name = "currency"))
    })
    private Money balance;

    protected Account() {}

    public Account(Money initialBalance) {
        this.balance = Objects.requireNonNull(initialBalance);
    }

    public void deposit(Money amount) {
        this.balance = this.balance.plus(amount);
    }

    public void withdraw(Money amount) {
        this.balance = this.balance.minus(amount);
    }

    public Money balance() { return balance; }
}
```

The currency-mismatch and negative-amount checks are now in `Money`, exactly once. `Account` doesn't repeat them. Two accounts in different currencies cannot accidentally combine.

---

## 5. What the service looks like after the refactor

Before:

```java
public void deposit(Long accountId, BigDecimal amount) {
    if (amount == null || amount.signum() <= 0) throw ...;
    Account a = repo.findById(accountId).orElseThrow(...);
    a.setBalance(a.getBalance().add(amount));
    repo.save(a);
}
```

After:

```java
public void deposit(Long accountId, Money amount) {
    Account a = repo.findById(accountId).orElseThrow(...);
    a.deposit(amount);
}
```

The service is now a **coordinator** — it answers *"when does this happen, and in what unit of work?"*, not *"what does deposit mean?"*. Three things to notice:

1. The validation has disappeared from the service. It moved to `Money` (currency, sign) and `Account.deposit` (positive amount, sufficient funds).
2. The service is shorter and harder to write incorrectly. A new developer can't accidentally call `setBalance(-1_000_000)` because no setter exists.
3. The unit of business meaning is on the entity. `account.deposit(amount)` reads like a sentence in the domain language.

---

## 6. Where the service still earns its keep

The rich-model refactor doesn't kill the service. It changes what the service is *for*. Legitimate service responsibilities after the refactor:

- **Loading and saving aggregates.** The repository call and the transaction boundary live in the service, not on the entity.
- **Coordinating multiple aggregates.** A `transfer(fromId, toId, amount)` touches two accounts — it doesn't belong on either of them alone.
- **Calling out to external systems.** Sending an email, publishing a Kafka message, calling a fraud-detection API — all infrastructure concerns the entity should never know about.
- **Mapping between DTOs and entities.** The boundary translation belongs at the boundary, not in the domain.

A service that only loads, calls one method on the entity, and lets the transaction commit is doing exactly what a service *should* do.

---

## 7. The hardest part: JPA's reflection-based mutation

JPA frameworks will happily reach in via reflection regardless of your encapsulation. If you make `setBalance` private, Hibernate can still set the field because it uses field access (or reflective property access) under the hood. The encapsulation you're enforcing is for **your application code**, not for Hibernate's internals.

That's fine. Hibernate is part of the trusted infrastructure that materialises your entities; your goal is to prevent the *rest of your code* from mutating the entity invalidly. The pattern:

```java
@Entity
public class Account {
    @Id @GeneratedValue private Long id;
    @Embedded private Money balance;

    protected Account() {}                                 // for Hibernate

    public Account(Money initial) { this.balance = initial; }

    public void deposit(Money amount) { /* invariant-enforcing */ }
}
```

works fine. Hibernate populates `id` and `balance` reflectively when loading. Your code never has a way to set `balance` other than through `deposit` or `withdraw`. That's the right level of protection.

---

## 8. Common newcomer mistakes (continuing from `junior.md`)

**Mistake 1: refactoring the model but leaving setters in for "convenience".**

```java
public class Account {
    private BigDecimal balance;
    public void deposit(BigDecimal amount) { /* validation, then assignment */ }
    public void setBalance(BigDecimal b)   { this.balance = b; }   // backdoor
}
```

If `setBalance` is public, the rich-model refactor was theatre. Any caller can bypass `deposit`. Either delete the setter or make it `private`.

**Mistake 2: leaving the no-arg constructor public for JPA.**

A public no-arg constructor lets application code create an `Account` with `balance = null`. Mark it `protected` and JPA still works.

**Mistake 3: putting cross-aggregate logic on one entity.**

```java
public class Account {
    public void transferTo(Account other, Money amount) {
        this.withdraw(amount);
        other.deposit(amount);
    }
}
```

This is tempting but problematic. The transfer touches two aggregates; if it fails midway, you have a consistency hole. Cross-aggregate operations belong in a service or domain service, not on either aggregate.

**Mistake 4: enriching DTOs.**

Adding behaviour to your `UserCreateRequest` DTO is a category error. DTOs are anemic by design — they're transport. Put behaviour on the domain entity that receives the DTO's data.

---

## 9. Quick rules

- [ ] **No public setters** on domain entities.
- [ ] **Constructor enforces invariants** — you cannot leave the constructor with an invalid object.
- [ ] **Group fields that always change together** into value objects (Money, Address, DateRange).
- [ ] **Services orchestrate**; entities decide.
- [ ] **JPA no-arg constructors stay `protected`**; the public constructors enforce invariants.
- [ ] **DTOs at the boundary** stay anemic on purpose.

---

## 10. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Tell-Don't-Ask, justified anemia, encapsulation breaks             | `senior.md`        |
| DDD aggregates, ArchUnit policy, MapStruct, CQRS read models       | `professional.md`  |
| Metrics, definitions, sample ArchUnit rules                        | `specification.md` |
| 10 buggy snippets with diagnosis and fix                           | `find-bug.md`      |
| JIT, escape analysis, dirty checking, value-object grouping        | `optimize.md`      |
| 8 refactoring exercises                                            | `tasks.md`         |
| 20 interview questions                                             | `interview.md`     |

---

**Memorize this:** Fowler's critique is procedural-in-OO-clothes. JPA, Jackson, Lombok, and IDE wizards all default you to anemic; rich models are an active choice. Move `setX` validation into `domain-verb(amount)` methods, group co-changing fields into value objects, and let the service shrink to a coordinator that loads, delegates, and commits.
