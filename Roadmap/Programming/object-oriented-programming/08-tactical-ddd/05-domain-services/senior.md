# DDD Tactical: Domain Services — Senior

> **What?** A Domain Service is a *last-resort* placement for behaviour. Evans, Vernon, and every serious DDD practitioner agree: the model is healthiest when behaviour lives on Entities and Value Objects, and Services are reserved for the cases where no single object is the natural home. The senior judgement is *when to extract* and, just as important, *when to refuse* — because the easy slide from "I'll just make it a service" to anaemic-domain rot kills more DDD projects than any other mistake.
> **How?** Apply a three-question filter before creating a service: **(1)** Is there an Entity or VO that already owns most of the data this operation needs? **(2)** Does the operation cross aggregate boundaries or depend on a policy/strategy not tied to one object? **(3)** Is the operation expressible as a *verb* in the Ubiquitous Language with no obvious noun owner? Only when answers favour the service should you create one — and even then, keep it side-effect-free where possible and have it depend on repository ports, not concrete repositories.

---

## 1. The three legitimate reasons to extract a Domain Service

Evans names three (*DDD* Chapter 5), and the literature has not really added a fourth.

### 1.1 Cross-aggregate operation

The behaviour mutates or reads more than one aggregate. A transfer touches two `Account`s. A merger involves two `Company` aggregates. A swap exchanges items between two `Inventory`s. No single aggregate is the owner; either would be lying.

```java
public final class MergerService {
    public Company merge(Company acquirer, Company target, MergerTerms terms) {
        // Cross-aggregate logic — neither company "owns" the merge.
    }
}
```

### 1.2 No clear owner for the data

The operation needs inputs from multiple value objects or entities and produces a result that doesn't belong to any of them. Pricing a basket is the canonical example: the price isn't a property of any one `LineItem`, of the `Basket`, or of the `Customer` — it's the result of *applying* a policy to all of them.

```java
public final class BasketPricingService {
    public Money price(Basket basket, Customer customer, PricingRules rules) {
        // Result is a fresh Money — no entity "owns" it.
    }
}
```

### 1.3 Policy or strategy with multiple implementations

A *policy* (Evans uses the term in Chapter 10) is a domain rule with variants. Retail vs wholesale pricing. Domestic vs international shipping. Standard vs preferred-customer discounting. Each variant has the same shape but different logic. Polymorphism via a Domain Service interface is the natural fit.

```java
public interface ShippingCostPolicy {
    Money cost(Order order, Address destination);
}
public final class DomesticShippingCostPolicy   implements ShippingCostPolicy { ... }
public final class InternationalShippingCostPolicy implements ShippingCostPolicy { ... }
```

If your operation doesn't fit one of these three buckets, push back. Look harder for an entity that wants the behaviour.

---

## 2. The anaemic-domain trap

Martin Fowler coined "Anemic Domain Model" in 2003 to describe what happens when every method becomes a service:

> "The basic symptom of an Anemic Domain Model is that at first blush it looks like the real thing. ... When you look more closely you'll notice that there is barely any behaviour on these objects, making them little more than bags of getters and setters."

The mechanism: every time a developer needs *anything*, they reach for a `*Service`. Slowly, entities lose their methods. They become data carriers. The model can no longer be read aloud in the domain expert's language because all the verbs live elsewhere.

Counter-example. The wrong way:

```java
public class Account {
    private BigDecimal balance;
    public BigDecimal getBalance() { return balance; }
    public void setBalance(BigDecimal v) { this.balance = v; }
}

public class AccountService {
    public void withdraw(Account a, Money amount) {
        if (a.getBalance().compareTo(amount.value()) < 0) throw ...;
        a.setBalance(a.getBalance().subtract(amount.value()));
    }
}
```

`Account` is a bag of getters/setters; `AccountService` does everything. The invariant *cannot* be enforced because anyone can call `setBalance` directly. This is anaemic.

The right way:

```java
public final class Account {
    private Money balance;
    public Money balance() { return balance; }
    public void withdraw(Money amount) {
        if (balance.lessThan(amount)) throw new InsufficientFundsException(id, amount);
        this.balance = balance.minus(amount);
    }
}
```

Now the invariant lives *with the data it protects*. `withdraw` belongs to `Account` because everything it needs is already inside `Account`. No service required.

A `TransferService` is still legitimate for moving money *between* two accounts — that's the cross-aggregate case. But `withdraw` itself stays on the entity.

---

## 3. Side-effect-free where possible

A *pure* Domain Service — one that takes inputs and returns outputs without mutating anything — is dramatically easier to test, reason about, and parallelise. Prefer purity.

```java
// Pure: returns a new Money, no mutation
public final class PricingService {
    public Money price(Basket basket, PricingRules rules) { ... }
}

// Impure: mutates the second account
public final class TransferService {
    public void transfer(Account from, Account to, Money amount) { ... }
}
```

The pricing service is pure; the transfer service is not. Both are valid Domain Services, but where you have a choice, lean towards pure. Pure services compose. Pure services are trivially parallelisable. Pure services have no temporal dependency on call order.

When mutation is necessary (as in `TransferService`), make sure the mutation lives on the *entities*, not in the service. The service should ask the entity to mutate itself, not reach in and modify fields.

---

## 4. Dependency on Repository ports — yes, on Repository implementations — no

A Domain Service may *depend on a repository interface defined in the domain*. It must not depend on a concrete repository implementation.

```java
// domain/AccountRepository.java   ← interface in the domain
public interface AccountRepository {
    Optional<Account> findById(AccountId id);
    void save(Account account);
}

// domain/service/InterestAccrualService.java
public final class InterestAccrualService {
    private final AccountRepository accounts;     // domain port — OK

    public InterestAccrualService(AccountRepository accounts) {
        this.accounts = accounts;
    }

    public void accrueFor(AccountId id, LocalDate asOf, InterestRate rate) {
        Account a = accounts.findById(id).orElseThrow();
        a.accrue(asOf, rate);
        accounts.save(a);
    }
}
```

Caveat: many practitioners (Vernon included) argue that *loading* by id is an application-service responsibility, and the domain service should receive already-loaded aggregates. Both styles are defensible. The non-negotiable is: never depend on `JpaAccountRepository` (the concrete class). Always depend on the interface.

Pragmatic rule of thumb:

- If the service handles **one specific use case end-to-end** and is closely paired with an application call, prefer passing the aggregate in.
- If the service models a **reusable domain capability** that might be invoked from many places (batch jobs, controllers, schedulers), letting it accept a repository port is fine — it spares every caller the load/save dance.

---

## 5. When to refuse a Domain Service

You're asked to extract `AccountValidationService.validate(Account a)`. Stop. Validation that uses only the account's own state belongs on the account:

```java
public final class Account {
    public void validate() {
        if (balance.isNegative()) throw new InvariantViolation("negative balance");
        ...
    }
}
```

You're asked to extract `OrderStatusUpdateService.updateStatus(Order o, Status s)`. Stop. The order owns its status:

```java
public final class Order {
    public void markShipped() {
        if (status != PAID) throw new IllegalStateTransition(status, SHIPPED);
        this.status = SHIPPED;
        ...
    }
}
```

The heuristic: *if the only argument is an entity and the operation reads/mutates only that entity's state, it's a method on the entity, not a service.* The fact that someone wrote `*Service` in the JIRA ticket is not a reason.

---

## 6. Naming the policy variant

When a service represents a *policy* (Section 1.3), name it as a policy:

```java
public interface DiscountPolicy {
    Money discount(Order order, Customer customer);
}

public final class LoyaltyDiscountPolicy    implements DiscountPolicy { ... }
public final class SeasonalDiscountPolicy   implements DiscountPolicy { ... }
public final class NoDiscountPolicy         implements DiscountPolicy { ... }
```

`Policy` is the standard suffix in DDD literature for a strategy-shaped Domain Service. Some teams use `Strategy` instead; both are fine. Avoid `XxxRule`, which tends to suggest a single boolean check rather than a computation.

Domain Services that *aren't* polymorphic policies are usually named with `Service` (`TransferService`, `RoutingService`) or by capability noun (`Router`, `Pricer`). All three are acceptable; consistency within a bounded context matters more than the choice.

---

## 7. The dual-write hazard

A `TransferService` mutates two aggregates. If you persist them in the same transaction, you've coupled their lifecycles in a way Evans cautions against: aggregates are supposed to be independently consistent. Two patterns help:

- **Eventual consistency.** The service decrements one account *and emits a domain event*; an event handler increments the other. Each save is a single-aggregate transaction. (See [`../03-aggregates/`](../03-aggregates/).)
- **Tolerated dual-write.** For small systems, persisting both accounts in one transaction is pragmatic. Be honest about the trade-off.

The senior call is to know which one your context tolerates and to make the choice deliberately.

---

## 8. Quick rules

- [ ] Default to behaviour on entities/VOs; reach for a Domain Service only when no single object naturally owns the operation.
- [ ] Three legitimate triggers: cross-aggregate operation, no clear owner, policy/strategy with variants.
- [ ] Prefer pure (side-effect-free) services where the domain allows it.
- [ ] Depend on repository *interfaces*, never on concrete implementations.
- [ ] Validation and status changes that use only one entity's state are *not* services.
- [ ] Name policy-shaped services `XxxPolicy`; name capability-shaped services after the verb.
- [ ] If a transfer-style service mutates two aggregates, decide explicitly: single transaction or domain event.

---

## 9. What's next

| Topic                                                                  | File               |
| ---------------------------------------------------------------------- | ------------------ |
| Spring `@Service`, hexagonal placement, transactions, sagas            | `professional.md`  |
| Formal contract: statelessness, naming, dependency rules               | `specification.md` |
| Buggy services and diagnoses                                           | `find-bug.md`      |
| Performance angles                                                     | `optimize.md`      |
| Hands-on exercises                                                     | `tasks.md`         |
| Interview Q&A                                                          | `interview.md`     |

Related: [`../02-entities/`](../02-entities/), [`../01-value-objects/`](../01-value-objects/), [`../03-aggregates/`](../03-aggregates/), [`../04-repository-concept/`](../04-repository-concept/).

---

**Memorize this:** The hardest part of Domain Services is *not creating one when you shouldn't*. Three triggers justify extraction — cross-aggregate, no clear owner, policy/strategy. Everything else is a method on an entity in disguise. When you do extract, depend on domain ports (never concrete adapters), prefer purity, and name the service after the capability or the policy.
