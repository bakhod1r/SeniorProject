# Law of Demeter — Junior

> **What?** The *Law of Demeter* (LoD), sometimes called the **Principle of Least Knowledge**, says a method `m` on object `O` should only call methods on:
>   1. `O` itself,
>   2. parameters passed to `m`,
>   3. objects `m` creates locally, and
>   4. objects held in `O`'s fields.
>
> What it forbids is reaching *through* one object to call methods on another — "talking to strangers" via chains like `a.getB().getC().doX()`. Each `.` you write past the first is a knowledge debt: your method now knows about types it didn't *receive*.
> **How?** Whenever you find yourself writing `x.getY().getZ().doSomething()`, ask *who should be making this call?* — usually it's `x` itself, with a new method named after the *intent* of the operation.

---

## 1. The smell, in one snippet

```java
// LoD violation — train wreck:
public class CheckoutService {
    public Money totalDue(Order order) {
        return order.getCustomer().getAddress().getCountry().taxFor(order);
    }
}
```

`CheckoutService` knows that `Order` has a `Customer`, that `Customer` has an `Address`, that `Address` has a `Country`, and that `Country` knows how to compute tax. Four pieces of internal structure leak into a class that should only care about *checkout*.

The fix is to push the question to whoever owns the answer:

```java
public class CheckoutService {
    public Money totalDue(Order order) {
        return order.taxAmount();          // ask the order; it figures it out
    }
}

public class Order {
    public Money taxAmount() {
        return customer.taxAmount(this);    // delegate one level deeper
    }
}

public class Customer {
    public Money taxAmount(Order order) {
        return address.taxAmount(order);
    }
}

public class Address {
    public Money taxAmount(Order order) {
        return country.taxFor(order);
    }
}
```

Now each class only talks to its immediate collaborators. If `Address` changes how it relates to `Country` (maybe regions get inserted), only `Address` and `Country` are touched — `CheckoutService` and `Order` and `Customer` don't notice.

---

## 2. The everyday analogy

You don't walk into a store, open the cashier's wallet, and take a refund. You ask the cashier to refund you. The cashier might consult a manager, who consults a policy book, who decides — but *you* only talk to the cashier. You're a stranger to the manager, to the policy book, to the bank that funded the till.

The Law of Demeter codifies this etiquette into code. Your method is a customer; it only speaks with whom it was introduced to.

---

## 3. The "one dot" heuristic

A common shorthand: **prefer one dot per line, not many**. It's not a strict rule (some idioms — builders, streams — chain on purpose), but as a smell detector it works.

```java
// Many dots, many strangers:
report.getTransactions().stream()
      .filter(t -> t.getCustomer().getStatus().isActive())     // LoD violation
      .map(t -> t.getCustomer().getTier().getName())           // ditto
      .toList();

// Fewer dots, clearer intent:
report.transactions().stream()
      .filter(Transaction::isFromActiveCustomer)
      .map(Transaction::customerTierName)
      .toList();
```

Helpers move into the object that owns the data. The stream pipeline still reads, but each step now operates on what `Transaction` is *willing to say about itself*.

---

## 4. What LoD does NOT forbid

LoD is about *behavioural coupling*, not about how many dots you literally type. Some `.x.y.z` chains are fine:

- **Fluent builders**: `new StringBuilder().append("a").append("b").toString()`. Each step returns the same object; you're talking to one stranger, not three.
- **Streams**: `list.stream().filter(...).map(...).toList()`. Each call returns a new stream — a `Stream<T>` is the only collaborator, and it's an intentional pipeline type.
- **Records and value objects**: `point.x() + point.y()`. A `Point` is a *value*, not a hidden domain; reading its components is fine.

LoD targets *behaviour through structure* — `order.getCustomer().getAddress().getCountry().changeTax(0.5)` — where the long chain leaks an internal model.

---

## 5. A worked example — a loan disbursement chain

You're writing the code that disburses a loan:

```java
// LoD violation:
public class LoanDisbursementService {
    public void disburse(Loan loan) {
        BankAccount account = loan.getBorrower().getAccounts().get(0);
        if (account.getStatus().isFrozen()) {
            throw new AccountFrozenException();
        }
        account.setBalance(account.getBalance().plus(loan.getPrincipal()));
    }
}
```

The service knows about borrower internals, account internals, balance internals. Refactoring the borrower model breaks the service. The check-and-mutate is also non-atomic.

Apply LoD: push the operation into the object that owns the data.

```java
public class LoanDisbursementService {
    public void disburse(Loan loan) {
        loan.disburseTo(loan.borrower());       // tell the loan
    }
}

public class Loan {
    public void disburseTo(Borrower b) {
        b.receive(principal);                   // borrower handles its accounts
    }
}

public class Borrower {
    public void receive(Money amount) {
        primaryAccount().deposit(amount);       // borrower picks the account
    }
}

public class BankAccount {
    public void deposit(Money amount) {
        assertNotFrozen();
        balance = balance.plus(amount);         // single owner of the rule
    }
}
```

Every method now talks to at most one collaborator. Each rule lives where the data lives. The non-atomic problem disappears because `deposit` is now a single operation on `BankAccount`.

---

## 6. LoD's relatives

The Law of Demeter is one face of a small family of principles. It overlaps with:

- **Tell, Don't Ask** (see `[../../00-object-thinking/03-tell-dont-ask/](../../00-object-thinking/03-tell-dont-ask/)`). LoD is about *who you talk to*; Tell-Don't-Ask is about *what you say to them*.
- **Encapsulation** (see `[../../02-more-about-oop/05-encapsulation/](../../02-more-about-oop/05-encapsulation/)`). LoD violations are usually encapsulation violations — internal structure leaking.
- **Information Hiding**. Same idea, broader scope.

When you fix one of them well, the others tend to improve automatically.

---

## 7. The "wrapper" anti-pattern

A naïve "fix" for LoD is to wrap the long chain in a helper:

```java
public class Helpers {
    public static Country countryOf(Order order) {
        return order.getCustomer().getAddress().getCountry();   // still LoD-violating
    }
}

// Then:
checkout.taxFor(Helpers.countryOf(order));
```

You've moved the smell, not removed it. `Helpers` now carries the same forbidden knowledge that `CheckoutService` had. Real LoD compliance means *eliminating* the chain by giving the responsibility to the right object — not stashing it behind a static method.

---

## 8. Common newcomer mistakes

**Mistake 1: counting dots blindly.**

```java
// Looks like 4 dots, panicking:
items.stream().filter(Item::isActive).map(Item::price).reduce(Money.ZERO, Money::plus);
```

This is fine. It's a pipeline on a `Stream`, which is the same collaborator. Not a LoD violation.

**Mistake 2: solving the chain by exposing fields.**

```java
// Don't do this:
public Country getCountry() { return customer.getAddress().getCountry(); }   // helper that LEAKS country
```

Better: don't expose `Country` at all. Provide whatever *answer* the caller actually wanted (`taxAmount`, `currency`, …).

**Mistake 3: treating LoD as absolute.**

LoD has trade-offs. Strict adherence sometimes pushes responsibilities into the wrong object (a `Country` shouldn't usually know about `Order`s, even if LoD says you can't get to it). Use judgement — the goal is to keep coupling low, not to satisfy a literal rule.

**Mistake 4: confusing LoD with "no return values".**

LoD allows return values; it forbids you to *navigate the returned graph and act on its internals*. `order.totalAmount()` returns a `Money` — fine, that's an answer at the right level. `order.getCart().getLineItems()` returns internal structure — not fine if you then iterate and act on it.

---

## 9. Quick rules

- [ ] Inside a method, only call methods on `this`, on parameters, on locally-created objects, or on fields.
- [ ] Train-wreck chain (`a.b().c().d().…`) → fold into one method on `a`.
- [ ] Fluent builders and stream pipelines are exceptions — same collaborator, intentional.
- [ ] Records / value objects: reading components is allowed; mutating internals is not.
- [ ] If a method needs information from a stranger, ask its immediate collaborator for a higher-level answer.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Worked LoD refactors of train-wreck chains                  | `middle.md`        |
| LoD vs streams, builders, value objects — nuances           | `senior.md`        |
| Driving LoD across a team and code review                   | `professional.md`  |
| JLS background; package access; module boundaries           | `specification.md` |
| Spotting subtle LoD violations and runtime symptoms         | `find-bug.md`      |
| Cost of indirection: dispatch, allocation, JIT inlining     | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** talk only to your immediate collaborators. Every extra `.` is knowledge debt — it ties you to another class's internal structure. The fix is almost never a helper that hides the chain; it's giving the responsibility to the object that owns the data.
