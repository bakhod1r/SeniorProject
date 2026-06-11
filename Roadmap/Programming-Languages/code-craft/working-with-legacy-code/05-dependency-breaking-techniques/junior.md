# Dependency-Breaking Techniques — Junior Level

## Table of Contents

- [Why we break dependencies](#why-we-break-dependencies)
- [Sense and separate: the two reasons](#sense-and-separate-the-two-reasons)
- [What a dependency-breaking technique actually is](#what-a-dependency-breaking-technique-actually-is)
- [Technique 1: Parameterize Constructor](#technique-1-parameterize-constructor)
- [Technique 2: Parameterize Method](#technique-2-parameterize-method)
- [Technique 3: Extract Interface](#technique-3-extract-interface)
- [Technique 4: Subclass and Override Method](#technique-4-subclass-and-override-method)
- [A picture of the whole idea](#a-picture-of-the-whole-idea)
- [These are scaffolding, not the goal](#these-are-scaffolding-not-the-goal)
- [How this connects to the rest of legacy work](#how-this-connects-to-the-rest-of-legacy-work)
- [Mini Glossary](#mini-glossary)
- [Review questions](#review-questions)

---

## Why we break dependencies

When you join a real team you will mostly change code that already exists, and a lot of that code has no tests. To change it safely you want to put it under test first — to wrap it in a *test harness* so you can run a small piece of it in isolation and check what it does. But you usually cannot, because the piece you care about is *tangled up with* things you cannot run in a test:

- it opens a real database connection,
- it sends a real email,
- it reads the real system clock,
- it calls a payment provider over the network,
- it reads a global configuration object that only exists in production.

These entanglements are called **dependencies**. A dependency is anything your code needs from the outside world in order to run. When a dependency makes it hard or slow or dangerous to run your code in a test, we say the code has a *problem dependency*.

A **dependency-breaking technique** is a small, mechanical change to the code that lets you replace one of those problem dependencies with a *fake* you control during the test — without breaking what the code does in production. The catalog of these techniques comes from Michael Feathers' book *Working Effectively with Legacy Code*, which is the source this whole topic draws on.

> **Key idea:** We break a dependency so we can slip a fake in its place, run the surrounding logic in a test, and finally start changing the code with confidence instead of fear.

This page teaches four of the simplest techniques with clear before/after code. The [middle](./middle.md) page gives the full working catalog; [senior](./senior.md) covers trade-offs and safety; [professional](./professional.md) covers doing this on real systems under deadline.

---

## Sense and separate: the two reasons

Feathers gives exactly two reasons you ever need to break a dependency. Knowing which one you are doing keeps you focused.

| Reason | What you want | Example |
|--------|---------------|---------|
| **Sensing** | To *see* an effect your code produces that you otherwise could not observe | Your method calls `mailer.send(...)`. You cannot read the sent email in a test. You break the dependency on the mailer so a fake can record what was sent, and you assert on it. |
| **Separation** | To *get the code out of* an environment it cannot run in | Your method opens a real database. A test cannot reach the database. You break the dependency so the code runs against a fake and never touches the network. |

Most real situations are a mix: you separate from the database *and* sense what queries were run. But naming the reason first tells you what your fake has to do. A *sensing* fake has to **record**. A *separating* fake just has to **not do the real thing** (it can return a canned value and stay silent).

```
  Sensing                              Separation
  ┌─────────────┐                      ┌─────────────┐
  │  your code  │── send() ──▶ [fake]  │  your code  │── query() ─▶ [fake]
  └─────────────┘            records   └─────────────┘   returns canned
                             the call                    data, no network
        you ASSERT on what                  the code RUNS at all,
        the fake recorded                   off in a test harness
```

---

## What a dependency-breaking technique actually is

Every technique in the catalog does the same fundamental thing: it introduces a **seam** — a place where you can change what the code does without editing the code at that place (see [`../03-seams-and-enabling-points/`](../03-seams-and-enabling-points/)). The techniques differ only in *how* they make that seam and *how invasive* the change is.

The shape is always:

1. Find the problem dependency (the line that does the dangerous/slow/unobservable thing).
2. Apply the smallest technique that lets you substitute something there.
3. In the test, substitute a fake.
4. Now write a *characterization test* (see [`../04-characterization-tests/`](../04-characterization-tests/)) that pins down current behavior.
5. Only then start changing the code.

We will now walk through four techniques, easiest first. Each shows the **before** (untestable), the **after** (a seam exists), and **when to use** it.

---

## Technique 1: Parameterize Constructor

**Problem.** A class builds its own dependency inside its constructor with `new`. Because the dependency is created internally, a test has no way to swap it.

**Before.** This `InvoiceService` reaches out and creates its own `EmailSender`, which talks to a real SMTP server.

```java
public class InvoiceService {
    private final EmailSender sender;

    public InvoiceService() {
        // Hard-coded dependency: creates a real SMTP-backed sender.
        this.sender = new SmtpEmailSender("smtp.company.com", 587);
    }

    public void sendOverdueNotice(Invoice invoice) {
        String body = "You owe " + invoice.amountDue();
        sender.send(invoice.customerEmail(), "Overdue", body);
    }
}
```

You cannot test `sendOverdueNotice` without sending real email. There is no seam.

**After.** Add a constructor that *accepts* the dependency. Keep the old one if other code still needs it, so you do not break callers.

```java
public class InvoiceService {
    private final EmailSender sender;

    // New constructor: the dependency is passed in. This is the seam.
    public InvoiceService(EmailSender sender) {
        this.sender = sender;
    }

    // Old constructor kept so existing callers still compile.
    public InvoiceService() {
        this(new SmtpEmailSender("smtp.company.com", 587));
    }

    public void sendOverdueNotice(Invoice invoice) {
        String body = "You owe " + invoice.amountDue();
        sender.send(invoice.customerEmail(), "Overdue", body);
    }
}
```

Now the test passes in a fake:

```java
@Test
void sendsOverdueNoticeToCustomer() {
    FakeEmailSender fake = new FakeEmailSender();   // records calls
    InvoiceService service = new InvoiceService(fake);

    service.sendOverdueNotice(new Invoice("ada@x.com", 42));

    assertEquals("ada@x.com", fake.lastRecipient());
    assertTrue(fake.lastBody().contains("42"));
}
```

**When to use it.** When a class constructs its dependency internally and you can get the dependency object from the *outside*. This is the cleanest technique and the one to reach for first — it leaves the class in a genuinely better, more flexible shape.

---

## Technique 2: Parameterize Method

**Problem.** A *single method* creates a dependency internally. You do not want to touch the constructor — maybe the dependency is only used in one method, or the class is huge and you want the smallest possible change.

**Before.** The method builds its own clock.

```java
public class SubscriptionChecker {

    public boolean isExpired(Subscription sub) {
        LocalDate today = LocalDate.now();   // hard-coded "now"
        return sub.endDate().isBefore(today);
    }
}
```

You cannot test the boundary case ("expires exactly today") because `now()` always returns the real date.

**After.** Add an overload that takes the dependency as a parameter; the old method delegates to it.

```java
public class SubscriptionChecker {

    // Old signature kept; delegates to the parameterized version.
    public boolean isExpired(Subscription sub) {
        return isExpired(sub, LocalDate.now());
    }

    // New seam: "now" is passed in.
    public boolean isExpired(Subscription sub, LocalDate today) {
        return sub.endDate().isBefore(today);
    }
}
```

```java
@Test
void notExpiredOnTheLastDay() {
    SubscriptionChecker checker = new SubscriptionChecker();
    Subscription sub = new Subscription(LocalDate.of(2026, 6, 11));

    assertFalse(checker.isExpired(sub, LocalDate.of(2026, 6, 11)));
}
```

**When to use it.** When the dependency lives inside *one* method and adding it to the constructor would be overkill. It is the method-level twin of Parameterize Constructor.

---

## Technique 3: Extract Interface

**Problem.** Your code depends on a *concrete class* that is hard to fake — maybe it is `final`, maybe it does real I/O in its constructor, maybe it has no interface you can implement. You want to substitute a fake, but you can only substitute things that share a type with the real object.

**Before.** `ReportJob` depends directly on the concrete `PostgresDatabase`.

```java
public class ReportJob {
    private final PostgresDatabase db;   // concrete, does real I/O

    public ReportJob(PostgresDatabase db) {
        this.db = db;
    }

    public int countActiveUsers() {
        return db.queryInt("SELECT count(*) FROM users WHERE active");
    }
}
```

Even though the dependency is passed in (good!), you still cannot fake it: `PostgresDatabase` opens a connection and you cannot subclass it cleanly.

**After.** Pull an **interface** off the concrete class that contains only the methods `ReportJob` actually calls. Make the concrete class implement it, and depend on the interface.

```java
// 1. The new small interface — only what ReportJob needs.
public interface Database {
    int queryInt(String sql);
}

// 2. The real class implements it (one line added).
public class PostgresDatabase implements Database {
    @Override
    public int queryInt(String sql) { /* real I/O */ }
}

// 3. ReportJob now depends on the interface, not the concrete class.
public class ReportJob {
    private final Database db;

    public ReportJob(Database db) {
        this.db = db;
    }

    public int countActiveUsers() {
        return db.queryInt("SELECT count(*) FROM users WHERE active");
    }
}
```

```java
@Test
void countsActiveUsers() {
    Database fake = sql -> 7;   // a one-line fake (lambda)
    ReportJob job = new ReportJob(fake);

    assertEquals(7, job.countActiveUsers());
}
```

**When to use it.** When you depend on a concrete type you cannot subclass or fake directly. Extract Interface is the bread-and-butter move for replacing real collaborators with fakes. Keep the interface *small* — only the methods you use.

> **Key idea:** Extracting an interface is "find a place to swap a part." Parameterizing a constructor is "make the part swappable from outside." Many real fixes use both together.

---

## Technique 4: Subclass and Override Method

**Problem.** The awkward call is buried inside the class you are testing, and you cannot easily parameterize it (maybe it is deep in a method you do not want to change much). You need a way to neutralize *just that one call* during a test.

This is the **workhorse** of the catalog. The trick: in the test only, you subclass the class under test and override the one awkward method to do nothing (or to record).

**Before.** `OrderProcessor.charge` calls a real payment gateway through a private-ish step.

```java
public class OrderProcessor {

    public Receipt process(Order order) {
        validate(order);
        String txnId = chargeCard(order.card(), order.total());  // real network call
        return new Receipt(order.id(), txnId);
    }

    // The awkward dependency: a real call to the outside world.
    protected String chargeCard(Card card, Money amount) {
        return PaymentGateway.charge(card, amount);   // hits the network
    }
}
```

Notice we made `chargeCard` a `protected` method. That single change turns it into a seam.

**After (test only).** In the test, subclass and override the awkward method.

```java
@Test
void buildsReceiptWithTransactionId() {
    OrderProcessor processor = new OrderProcessor() {
        @Override
        protected String chargeCard(Card card, Money amount) {
            return "TEST-TXN-123";   // neutralize the network call
        }
    };

    Receipt receipt = processor.process(sampleOrder());

    assertEquals("TEST-TXN-123", receipt.transactionId());
}
```

The production code still calls the real gateway; the test substitutes a harmless version of one method.

**When to use it.** When you cannot (or do not want to) parameterize, and the awkward behavior sits behind a method you can make overridable. It is fast and surgical. Its cost: the method must be overridable (not `private`, not `final`, not `static`), and the subclass is test-only "scaffolding."

### Neutralizing vs. sensing with the same technique

The example above *neutralizes* the call: the override returns a constant and forgets it (separation). If you also need to *sense* — to check that you charged the right amount — make the override **record** what it received into a field:

```java
@Test
void chargesTheOrderTotal() {
    final Money[] chargedAmount = new Money[1];

    OrderProcessor processor = new OrderProcessor() {
        @Override
        protected String chargeCard(Card card, Money amount) {
            chargedAmount[0] = amount;   // record for the assertion
            return "TEST-TXN-123";
        }
    };

    processor.process(orderTotalling(new Money(99)));

    assertEquals(new Money(99), chargedAmount[0]);   // sense the effect
}
```

This is the same technique doing both jobs from [Sense and separate](#sense-and-separate-the-two-reasons): the constant return value handles *separation* (no real network), and the recorded field handles *sensing* (we can assert on what happened). A subclass that records like this is sometimes called a **spy**.

---

## A picture of the whole idea

```
        ┌──────────────────────────────────────────────┐
        │   1. Find the problem dependency              │
        │      (DB, clock, network, global, email…)     │
        └───────────────────┬──────────────────────────┘
                            ▼
        ┌──────────────────────────────────────────────┐
        │   2. Apply the smallest technique that adds   │
        │      a SEAM right there                        │
        │        • Parameterize Constructor              │
        │        • Parameterize Method                   │
        │        • Extract Interface                     │
        │        • Subclass and Override Method          │
        └───────────────────┬──────────────────────────┘
                            ▼
        ┌──────────────────────────────────────────────┐
        │   3. In the test, substitute a FAKE           │
        │      (to SENSE or to SEPARATE)                 │
        └───────────────────┬──────────────────────────┘
                            ▼
        ┌──────────────────────────────────────────────┐
        │   4. Write a characterization test            │
        │      (pin down what the code does today)       │
        └───────────────────┬──────────────────────────┘
                            ▼
        ┌──────────────────────────────────────────────┐
        │   5. NOW change the code safely               │
        └──────────────────────────────────────────────┘
```

---

## These are scaffolding, not the goal

A dependency-breaking technique gets you *into the building*. It is scaffolding, not the finished wall. Some of these moves — like Subclass and Override Method or a test-only setter — make the design slightly worse on purpose, in exchange for getting tests in place.

Once the tests exist, you refactor toward a *real* design where dependencies are injected cleanly (see [`../../design-principles/`](../../design-principles/) for the Dependency Inversion Principle). Parameterize Constructor often *is* the clean end state; Subclass and Override is usually a stepping stone you remove later.

> **Key idea:** Break the dependency to get the test. Keep the test. Then improve the design until the ugly scaffolding is no longer needed.

A warning you will hear repeated on every level of this topic: do not loosen access modifiers (making things `public` or `protected` "just for tests") or add test-only hooks carelessly. Each one leaks your test concerns into production design. Do it on purpose, with a small footprint, and clean it up.

---

## Common beginner mistakes

A few traps that catch people the first time they break dependencies:

- **Breaking every dependency at once.** If your change only touches the email logic, you only need a seam on the email sender. You do not need to make the database, the clock, and the config swappable too. Break the *one* dependency in the path of your change; ignore the rest. Doing more is how a small fix balloons into a week.
- **Changing the only constructor's signature.** If you replace `new InvoiceService()` with `new InvoiceService(sender)` and there is no fallback constructor, every existing caller stops compiling. Keep the old constructor delegating to the new one (as shown above) so production code is undisturbed.
- **Writing a fake that does too much.** A fake should be the simplest thing that lets the test run. If you only need to *separate*, return a canned value and stay silent. If you need to *sense*, record the one thing you will assert on. A fake that tries to reimplement the real dependency is a second bug factory.
- **Forgetting to write the test.** The seam is not the goal. Plenty of people introduce a beautiful seam and then never write the characterization test, which means they did design work for no safety benefit. The test is the deliverable; the seam just makes it possible.
- **Making a method `public` when `protected` (or package-private) would do.** The smaller the visibility you open, the less you have leaked into production. Open the minimum the test mechanism requires.

> **Key idea:** The smallest, most local change that gets you the one test you need is almost always the right one. Resist the urge to "clean up while you're in there" before you have any tests.

---

## How this connects to the rest of legacy work

- **[`../02-the-legacy-change-algorithm/`](../02-the-legacy-change-algorithm/)** — the five-step loop (find change points, find test points, *break dependencies*, write tests, make changes). This topic is step three.
- **[`../03-seams-and-enabling-points/`](../03-seams-and-enabling-points/)** — every technique here creates a *seam*. That topic is the theory; this one is the catalog of practical moves.
- **[`../04-characterization-tests/`](../04-characterization-tests/)** — what you write *after* you have broken the dependency. Breaking the dependency is the means; the characterization test is the end.
- **[`../../design-principles/`](../../design-principles/)** and **[`../../design-patterns/`](../../design-patterns/)** — where you go *after*: real Dependency Inversion, and patterns like Adapter and Factory that these techniques quietly introduce.

---

## Mini Glossary

| Term | Meaning |
|------|---------|
| **Dependency** | Anything your code needs from the outside to run (a database, clock, network service, global). |
| **Problem dependency** | A dependency that makes the code hard, slow, or dangerous to run in a test. |
| **Dependency-breaking technique** | A small mechanical change that lets you substitute a problem dependency with a fake. |
| **Seam** | A place where you can change behavior without editing the code at that place. |
| **Sensing** | Breaking a dependency to *observe* an effect you otherwise could not see. |
| **Separation** | Breaking a dependency to *get the code out of* an environment it cannot run in. |
| **Fake** | An object that stands in for a real dependency in a test (it records calls or returns canned data). |
| **Test harness** | The setup that lets you run a piece of code in isolation under a test framework. |
| **Scaffolding** | A temporary structure (test-only subclass, setter) you add to get tests in, then remove or improve. |
| **Characterization test** | A test that captures the code's *current* behavior so you can change it safely. |

---

## Review questions

1. In your own words, what is a "problem dependency," and why can it block you from writing a test?
2. What are the *two* reasons (per Feathers) for ever breaking a dependency? Give an example of each.
3. A class creates a `new SmtpEmailSender()` inside its constructor. Which technique gives you the cleanest seam, and what does the "after" code look like?
4. When would you reach for **Parameterize Method** instead of **Parameterize Constructor**?
5. You depend on a `final` concrete class that opens a network connection in its constructor. Why does **Extract Interface** help here, and what should go in the interface?
6. Why is **Subclass and Override Method** called the "workhorse"? What single change to the production code makes it possible, and what are the constraints on the method you override?
7. Why do we call these techniques "scaffolding"? What do you do once the tests exist?
8. Give one concrete reason it is risky to make a method `protected` "just so a test can override it."
