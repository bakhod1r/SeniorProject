# DRY, KISS, YAGNI — Junior

> **What?** Three orthogonal slogans that every team repeats and most teams misapply.
>   - **DRY** — *Don't Repeat Yourself* (Hunt & Thomas, *The Pragmatic Programmer*, 1999): every piece of *knowledge* should have a single, unambiguous representation in the system.
>   - **KISS** — *Keep It Simple, Stupid* (Kelly Johnson, Lockheed Skunk Works, ~1960): prefer the simplest design that solves today's problem.
>   - **YAGNI** — *You Aren't Gonna Need It* (Kent Beck, *Extreme Programming Explained*, 1999): don't build for a future that hasn't arrived.
> **How?** Apply them in this order when reading code: *Is this complexity solving today's problem?* (KISS) → *Is it adding something for a hypothetical future?* (YAGNI) → *Does it duplicate a piece of knowledge that already lives elsewhere?* (DRY). All three are about *change cost*: the simplest, most local code is cheapest to change.

---

## 1. The three rules in one snippet

```java
// Violates all three at once
public final class OrderProcessor {
    private static OrderProcessor INSTANCE;                       // YAGNI: no need for a singleton yet
    private final Map<String, Function<Order, Order>> hooks;      // YAGNI: no second hook in 6 months

    public static OrderProcessor getInstance() {                  // KISS: a fresh object would do
        if (INSTANCE == null) INSTANCE = new OrderProcessor();
        return INSTANCE;
    }

    public Order process(Order order) {
        if (order.getCustomer().getEmail() != null
            && order.getCustomer().getEmail().contains("@")) {     // DRY: same check copied 12 times
            // ...
        }
        return order;
    }
}
```

Three smells at once: a singleton nobody asked for (YAGNI), a hook system with no second hook (YAGNI), an email check duplicated through the codebase (DRY), and an `if/else` chain that's just a `switch` waiting to happen (KISS).

The clean version:

```java
public final class OrderProcessor {
    private final EmailValidator emails;
    public OrderProcessor(EmailValidator emails) { this.emails = emails; }
    public Order process(Order order) {
        if (emails.isValid(order.customer().email())) { /* ... */ }
        return order;
    }
}
```

One class, one job, one place to validate emails, and no future-proofing.

---

## 2. KISS in practice — "what does today need?"

KISS is the *first* filter. Before applying DRY or worrying about YAGNI, ask: *what does this code need to do today?*

```java
// Over-engineered for today's "send a welcome email"
public final class WelcomeEmailSender {
    private final EmailTemplateFactory templates;
    private final EmailDeliveryStrategy strategy;
    private final RetryPolicyConfigurer retryConfig;
    private final NotificationAuditLogger audit;
    // ...12 collaborators
}

// What today actually needs
public final class WelcomeEmailSender {
    private final SmtpClient smtp;
    public WelcomeEmailSender(SmtpClient smtp) { this.smtp = smtp; }
    public void sendTo(Customer c) {
        smtp.send(c.email(), "Welcome", "Thanks for joining " + c.name());
    }
}
```

Same feature, half the code. If retry, templating, or auditing arrive later, they'll arrive *with their own requirements* — and you'll design for those needs, not for guesses.

KISS doesn't mean "be sloppy"; it means *the design fits the problem*. Bigger problems deserve bigger designs. Smaller problems deserve smaller.

---

## 3. YAGNI in practice — "is this for now or for later?"

YAGNI is the second filter. After KISS asks "what's needed?", YAGNI asks "is anything here *not* needed yet?"

```java
// YAGNI red flags
public final class PaymentService {
    private final Map<String, PaymentProvider> providers = Map.of("stripe", new StripeProvider());
    // Only Stripe in production. The Map is for the "future when we add PayPal".

    public Receipt charge(String provider, BigDecimal amount, /* 7 more args */) {
        return providers.get(provider).charge(amount);
    }
}
```

The map, the string key, the seven extra arguments — all speculation. Today the system has exactly one provider; the design pretends there are many. The cost shows up when:

- The real second provider arrives and the API doesn't fit (e.g., PayPal's flow needs different args).
- A new developer reads the code and wonders which providers exist.
- A bug in the lookup forces a fix in a code path that was never exercised in production.

The KISS+YAGNI version:

```java
public final class PaymentService {
    private final StripeProvider stripe;
    public PaymentService(StripeProvider stripe) { this.stripe = stripe; }
    public Receipt charge(BigDecimal amount, PaymentMethod method) {
        return stripe.charge(amount, method);
    }
}
```

When PayPal arrives, you'll *refactor* to a strategy — informed by what PayPal actually needs, not by what you imagined.

---

## 4. DRY in practice — "is this knowledge or this code?"

DRY is the third filter. Once KISS and YAGNI have shaped the code, look for *duplicated knowledge*:

```java
// Knowledge duplication — same email rule lives in 3 places
public class OrderValidator {
    public void validate(Order o) {
        if (o.email() == null || !o.email().contains("@")) throw new InvalidEmailException();
    }
}
public class CustomerValidator {
    public void validate(Customer c) {
        if (c.email() == null || !c.email().contains("@")) throw new InvalidEmailException();
    }
}
public class SignupController {
    @PostMapping void signup(@RequestParam String email) {
        if (email == null || !email.contains("@")) throw new BadRequestException();
    }
}
```

Same email rule, three places, three slightly different error types. When the spec changes ("emails must have a `.` after the `@`"), three files change — and one inevitably gets missed.

DRY fix: one `EmailValidator` class, used by all three:

```java
public final class EmailValidator {
    public boolean isValid(String email) {
        return email != null && email.matches("^[^@]+@[^@]+\\..+$");
    }
}
```

Each consumer calls `EmailValidator.isValid(email)`. The rule lives in one place; updates propagate to every caller.

But — *important caveat* — DRY applies to *knowledge*, not to *syntax that looks similar*. Two methods that happen to have the same five lines but serve different stakeholders should *not* be merged. See §7.

---

## 5. The interaction — KISS first, YAGNI second, DRY third

The three rules combine in a specific order:

1. **KISS** asks: *what does this need to do today?* Strip everything that isn't required.
2. **YAGNI** asks: *is anything left that's a hedge against tomorrow?* Strip the hedges.
3. **DRY** asks: *is the same piece of knowledge duplicated in multiple places?* Consolidate the duplicates.

Applying DRY before YAGNI produces "shared abstractions" that cement speculative designs. Applying YAGNI before KISS produces clever-but-fragile code that's hard to read but technically minimal. Applying KISS first ensures the simplest shape *that matches the problem*; the other two then refine it.

---

## 6. Common newcomer mistakes

**Mistake 1: DRY-ing apparent duplication.**

```java
// Two validators, look identical
boolean isOrderValid(Order o) { return o.email() != null && o.email().contains("@"); }
boolean isCustomerValid(Customer c) { return c.email() != null && c.email().contains("@"); }

// "DRY fix":
boolean hasAt(String email) { return email != null && email.contains("@"); }
```

If `Order` and `Customer` email rules diverge later (e.g., orders accept catch-all aliases like `orders+xyz@`, customers don't), the shared helper becomes the wrong abstraction. The two rules looked identical; their *meanings* differ. Coincidental duplication is cheaper than the wrong abstraction.

**Mistake 2: KISS as an excuse for sloppiness.**

```java
// "I kept it simple"
public class Stuff {
    public void doIt(Object x, Object y, Object z) {
        // 200 lines of if/else on x.getClass()
    }
}
```

That's not simple; that's *primitive*. KISS means "appropriate to the problem", not "structureless".

**Mistake 3: YAGNI as an excuse for missing features.**

```java
public class PaymentService {
    public void charge(BigDecimal amount) {
        // no idempotency, no retry, no audit, no error handling
        gateway.charge(amount);
    }
}
```

If today's requirements *include* idempotency (and payment requirements almost always do), YAGNI doesn't excuse omitting it. YAGNI strips speculation, not requirements.

**Mistake 4: refusing all interfaces "because YAGNI".**

```java
// "We don't need an interface yet"
public class OrderService {
    private final PostgresOrderRepo repo = new PostgresOrderRepo();
}
```

Now `OrderService` can't be unit-tested without a Postgres database. The interface isn't a hedge against the future — it's a *current* requirement for testability. YAGNI doesn't override DIP.

---

## 7. The rules can conflict — and that's normal

```java
// Two methods with similar shapes
public Money calculateOrderTax(Order order) {
    BigDecimal rate = countries.rateFor(order.country());
    return order.subtotal().multiply(rate);
}
public Money calculateInvoiceTax(Invoice invoice) {
    BigDecimal rate = countries.rateFor(invoice.country());
    return invoice.amount().multiply(rate);
}
```

DRY says: extract `calculateTax(Money base, Country country)`. KISS says: *the two are simple as written; don't add a helper for two callers*. YAGNI says: *if order tax and invoice tax diverge tomorrow, you'll wish they were separate*.

In this case, the answer depends on *whether the two computations are the same piece of knowledge*. If the tax rules for orders and invoices are guaranteed to stay identical (one source of truth in domain rules), extract. If they're independent in the domain, leave them.

The senior heuristic: **wait for the third occurrence** before extracting. Two is coincidence; three is a pattern.

---

## 8. Quick rules

- [ ] KISS first: is this complexity solving today's problem?
- [ ] YAGNI second: is anything here a hedge against an unspecified future?
- [ ] DRY third: is the same *piece of knowledge* duplicated?
- [ ] Apparent duplication ≠ meaning duplication. Wait for the third copy.
- [ ] Singletons, factories, and plugin registries are YAGNI red flags unless multiple implementations exist today.
- [ ] An interface earns its keep with a second real implementation or an infrastructure boundary, not a "future plan".
- [ ] The simplest code that handles today's requirements is the right code.

---

## 9. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Worked refactors: extract real duplication, strip speculation | `middle.md`       |
| Rule of Three, Sandi Metz's "wrong abstraction" cost         | `senior.md`        |
| Driving the trio in code review                              | `professional.md`  |
| JLS/JEP support that makes the rules cheap                   | `specification.md` |
| Spotting hidden over-engineering                             | `find-bug.md`      |
| Performance trade-offs                                       | `optimize.md`      |
| Hands-on exercises                                           | `tasks.md`         |
| Interview Q&A                                                | `interview.md`     |

---

**Memorize this:** KISS asks *what's needed today*, YAGNI strips *what's for tomorrow*, DRY consolidates *shared knowledge*. Apply in order — KISS first, YAGNI second, DRY third. All three are about change cost: the simplest, most local code is the cheapest to change.
