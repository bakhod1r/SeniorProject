# DDD Tactical: Domain Services — Junior

> **What?** A *Domain Service* is a stateless operation that expresses a piece of domain logic which doesn't naturally belong to any single Entity or Value Object. Eric Evans introduced the pattern in *Domain-Driven Design* (2003): when a behaviour involves several aggregates, or represents a domain *policy* with no clear owner, you give that behaviour its own home — a service — rather than forcing it into an entity that doesn't really own it.
> **How?** When you find a method on an entity that needs more than the entity's own state to do its job (e.g., a second entity, a policy, an exchange rate), pause. Ask: *does this behaviour conceptually belong to this entity, or is it a domain operation involving this entity?* If the latter, lift it into a Domain Service — a class with no fields (beyond injected ports), named after the *capability* (`TransferService`, `PricingService`, `RoutingService`), and called by application code with the relevant domain objects passed in.

---

## 1. The smell that motivates the pattern

You're modelling a bank. You have an `Account` entity with `deposit`, `withdraw`, and `balance`. Now the business wants a *transfer*. You instinctively write:

```java
public class Account {
    public void transferTo(Account other, Money amount) {
        this.withdraw(amount);
        other.deposit(amount);
    }
}
```

It compiles. It even works in a unit test. But several things feel wrong:

- The behaviour mutates *two* aggregates, not one. Which `Account` "owns" the transfer? Neither does, really — a transfer is an interaction *between* accounts.
- Audit rules (fees, FX, daily limits) start piling up. Suddenly `Account` knows about exchange-rate providers and compliance checks. SRP melts away.
- If the second `Account` lives in a different aggregate boundary, calling `other.deposit(...)` directly violates aggregate consistency rules — you've crossed boundaries inside a single method.

The Evans answer: extract a **Domain Service**. The transfer doesn't belong to one account — it's a domain operation involving two.

---

## 2. What a Domain Service actually is

Three defining traits, all from Evans (Chapter 5):

1. **The operation refers to a domain concept that is not a natural part of an Entity or Value Object.** A transfer is a verb between two nouns; pricing is a policy applied to a basket; routing is an algorithm over a graph.
2. **The interface is defined in terms of other elements of the domain model.** Inputs and outputs are entities, value objects, or domain primitives — never DTOs, never `ResultSet`, never `HttpResponse`.
3. **The operation is stateless.** A service has no instance fields that change between calls (constructor-injected dependencies are fine; they don't count as state).

If a class satisfies all three, it's a Domain Service. If it fails any one, it's something else: an Entity, an Application Service, an Infrastructure adapter.

---

## 3. The classic example — `TransferService`

```java
public final class TransferService {

    public void transfer(Account from, Account to, Money amount) {
        if (!from.canWithdraw(amount)) {
            throw new InsufficientFundsException(from.id(), amount);
        }
        from.withdraw(amount);
        to.deposit(amount);
    }
}
```

What changed compared to the method-on-`Account` version?

- `Account` no longer knows about other accounts. It owns only *its own* state and invariants.
- `TransferService` has no fields. You can instantiate it once and reuse it for every request — it's effectively a stateless function packaged as a class so it can be dependency-injected and mocked.
- The name `transfer` is a *verb*. Domain Services are named after the **capability** they expose, not the data they hold.

Crucially, this service still uses only domain types: `Account`, `Money`. It doesn't touch a `Connection`, doesn't take a `HttpServletRequest`, doesn't log. Those concerns belong in the layer above.

---

## 4. Why not just make it a static method?

You *can*. A static method is stateless by definition. But you lose three things:

- **Injectable dependencies.** When `TransferService` grows to need an `ExchangeRateProvider` or a `FraudPolicy`, you'll want to inject them in the constructor and mock them in tests. Static methods make that painful.
- **Polymorphism.** Different bounded contexts might need different `PricingService` implementations (retail vs wholesale). An interface plus implementations gives you that lever; a static method doesn't.
- **Testability.** A class is a thing you can stub, spy on, or replace; a static method is global state. As soon as you write `TransferService.transfer(...)`, your callers are coupled to that exact symbol.

So: package it as a class with no mutable state. Spring users will recognise this as a `@Service` bean — but be careful, *not every Spring `@Service` is a Domain Service*. We'll come back to that distinction in `professional.md`.

---

## 5. What a Domain Service is *not*

| It's not...                  | Because...                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| An Application Service       | App services orchestrate use cases, manage transactions, talk to the outside world. |
| An Infrastructure Service    | Those wrap technology (SMTP, S3, Postgres). A Domain Service has zero tech inside.  |
| A bag of unrelated methods   | Each service models *one capability*. `UtilService` is a code smell, not a pattern. |
| A replacement for entity logic | If the behaviour fits on the entity, keep it there. Don't make `Account` anaemic.    |

The fourth row is the most dangerous trap and gets its own treatment in `senior.md`. Vaughn Vernon (*Implementing Domain-Driven Design*, 2013) is blunt: "When in doubt, prefer placing behaviour on Entities and Value Objects." Services are the *exception*, not the default.

---

## 6. Where it lives in your project

In a typical hexagonal layout:

```
com.example.banking
├── domain
│   ├── model
│   │   ├── Account.java                 // Entity (Aggregate Root)
│   │   ├── Money.java                   // Value Object
│   │   └── ...
│   └── service
│       └── TransferService.java         // Domain Service ← here
├── application
│   └── TransferUseCase.java             // Application Service (orchestrates)
└── infrastructure
    └── persistence
        └── JpaAccountRepository.java    // Infra Service (adapter)
```

The Domain Service sits *inside* the domain package. It is part of the model. It depends only on other domain types and on **ports** (interfaces) the domain defines for itself — never on Spring, JPA, or HTTP.

---

## 7. A quick end-to-end view

```java
// Domain
public final class Money { /* immutable VO */ }
public final class Account { /* aggregate root with withdraw/deposit */ }

// Domain Service (the focus of this section)
public final class TransferService {
    public void transfer(Account from, Account to, Money amount) { /* ... */ }
}

// Application Service (next layer up)
public final class TransferUseCase {
    private final AccountRepository accounts;
    private final TransferService transfers;

    public TransferUseCase(AccountRepository accounts, TransferService transfers) {
        this.accounts = accounts;
        this.transfers = transfers;
    }

    @Transactional
    public void execute(AccountId fromId, AccountId toId, Money amount) {
        Account from = accounts.findById(fromId).orElseThrow();
        Account to   = accounts.findById(toId).orElseThrow();
        transfers.transfer(from, to, amount);
        accounts.save(from);
        accounts.save(to);
    }
}
```

Two things to notice:

- `TransferService` does *not* call the repository. It receives already-loaded `Account`s. Loading is the application service's job.
- `@Transactional` lives on the application service, not on the domain service. Transactions are an infrastructure concern; the domain shouldn't know they exist.

---

## 8. Common newcomer mistakes

**Mistake 1: making everything a service.** New DDD adopters hear "Domain Service" and start putting every method into a service, leaving entities as data carriers. That's the *anaemic domain model* anti-pattern, named and condemned by Martin Fowler. The cure: behaviour on entities first; services only when behaviour has no clear single owner.

**Mistake 2: stuffing infrastructure into a Domain Service.** `TransferService` should not have a `JdbcTemplate`, a `RestTemplate`, or a `Logger`. If it needs persistence, it depends on a *repository interface* defined in the domain — and the implementation of that interface lives in infrastructure.

**Mistake 3: storing state in the service.** A field like `private List<Transfer> recentTransfers` makes the service stateful, breaking the third defining trait. If you find yourself wanting state, you probably want an *Entity* or a *Repository*, not a service.

**Mistake 4: naming services after data.** `AccountService` is vague — what does it *do*? Better: `TransferService`, `OverdraftPolicy`, `InterestAccrualService`. Names should describe the capability, the verb.

---

## 9. Quick rules

- [ ] Behaviour involves more than one entity, or no entity owns it cleanly → consider a Domain Service.
- [ ] Behaviour fits on one entity and uses only its own state → keep it on the entity.
- [ ] Service has zero mutable fields. Constructor-injected ports are fine.
- [ ] Inputs and outputs are domain types only. No DTOs, no framework types.
- [ ] Name the service after the *capability*, not the data.

---

## 10. What's next

| Topic                                                                  | File               |
| ---------------------------------------------------------------------- | ------------------ |
| Domain vs Application vs Infrastructure service, with worked examples  | `middle.md`        |
| When to extract, when to refuse; avoiding the anaemic trap             | `senior.md`        |
| Spring `@Service`, hexagonal placement, transactions, sagas            | `professional.md`  |
| Formal contract: statelessness, naming, dependency rules               | `specification.md` |
| 10 buggy services with diagnosis and fix                               | `find-bug.md`      |
| Singletons, JIT, batching, parallelism for stateless services          | `optimize.md`      |
| Hands-on exercises: `TransferService`, `FXRateService`, `PricingPolicy`| `tasks.md`         |
| Interview Q&A                                                          | `interview.md`     |

Related sections in this folder: [`../02-entities/`](../02-entities/), [`../01-value-objects/`](../01-value-objects/), [`../03-aggregates/`](../03-aggregates/), [`../04-repository-concept/`](../04-repository-concept/).

---

**Memorize this:** A Domain Service is a *stateless, domain-typed, verb-named* operation that lives in the domain layer and exists because no single Entity or Value Object is the natural owner of that behaviour. Default to putting logic on entities; reach for a Domain Service when — and only when — the behaviour has no clean single owner.
