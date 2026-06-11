# Seams and Enabling Points — Middle Level

## Table of Contents

- [Recap and goal](#recap-and-goal)
- [Object seams in depth](#object-seams-in-depth)
  - [Interface injection](#interface-injection)
  - [Subclass and override](#subclass-and-override)
  - [Parameterize the method](#parameterize-the-method)
- [Link seams](#link-seams)
- [Preprocessor seams](#preprocessor-seams)
- [Text and configuration seams](#text-and-configuration-seams)
- [How to find seams in unfamiliar code](#how-to-find-seams-in-unfamiliar-code)
- [Enabling points: where the decision lives](#enabling-points-where-the-decision-lives)
- [Choosing the right seam](#choosing-the-right-seam)
- [Worked example: putting it together](#worked-example-putting-it-together)
- [Mini Glossary](#mini-glossary)
- [Review questions](#review-questions)

---

## Recap and goal

From the [junior](./junior.md) page: a **seam** is a place where you can alter behavior without editing in that place, and its **enabling point** is where you choose which behavior runs. The reason you want one is **testability** — you slot a fake in at the enabling point so you can test the surrounding logic in isolation.

This page is the hands-on tier. For each seam type you will see working before/after code, the exact location of the enabling point, and notes on when each applies. By the end you should be able to (a) spot existing seams in code you have never read, and (b) introduce a new seam where none exists.

> **Key idea:** Every seam type answers the same question — "how do I bind a different implementation here?" — but the *binding mechanism* differs: an object reference (object seam), the linker (link seam), the preprocessor (preprocessor seam), or the runtime (configuration seam).

---

## Object seams in depth

The object seam is the workhorse of OO legacy work. There are three common forms, in rough order of preference.

### Interface injection

The cleanest object seam. The class depends on an **interface**, and the concrete implementation is passed in at construction. The enabling point is the constructor.

```java
// AFTER — interface seam, injected via constructor.
public interface Clock {
    Instant now();
}

public final class SystemClock implements Clock {
    @Override public Instant now() { return Instant.now(); }
}

public final class SubscriptionService {
    private final Clock clock; // the seam

    public SubscriptionService(Clock clock) { // <-- enabling point
        this.clock = clock;
    }

    public boolean isExpired(Subscription sub) {
        return clock.now().isAfter(sub.endsAt());
    }
}
```

Testing expiry logic that depends on "now" is otherwise miserable — you cannot make real wall-clock time move. With the seam, the test controls time exactly:

```java
@Test
void reportsExpiredWhenNowIsPastEnd() {
    Instant fixed = Instant.parse("2030-01-01T00:00:00Z");
    Clock frozen = () -> fixed; // lambda implements Clock — the fake
    SubscriptionService svc = new SubscriptionService(frozen);

    Subscription sub = new Subscription(Instant.parse("2029-12-31T00:00:00Z"));
    assertTrue(svc.isExpired(sub));
}
```

The same shape works in TypeScript, where the "interface" can be a structural type:

```typescript
// TypeScript — structural interface seam.
interface Clock {
  now(): Date;
}

class SubscriptionService {
  constructor(private readonly clock: Clock) {} // enabling point

  isExpired(sub: { endsAt: Date }): boolean {
    return this.clock.now() > sub.endsAt;
  }
}

// In a test:
const frozen: Clock = { now: () => new Date("2030-01-01T00:00:00Z") };
const svc = new SubscriptionService(frozen);
```

### Subclass and override

When you *cannot* change the constructor easily — perhaps the class is constructed in many places, or creation is tangled — you can expose the awkward operation as an overridable method, then subclass it in the test. This creates a seam at the method boundary.

```java
// BEFORE — the network call is welded into the method.
public class WeatherReport {
    public String summary(String city) {
        String json = new HttpClient().get("https://api.example.com/w/" + city);
        return parse(json).headline();
    }
    private Weather parse(String json) { /* ... */ }
}
```

Extract the hard part into a method, then override it in a test subclass:

```java
// AFTER — subclass-and-override seam.
public class WeatherReport {
    public String summary(String city) {
        String json = fetchRaw(city); // seam: overridable
        return parse(json).headline();
    }

    // Made protected so a test subclass can override it. This is the seam.
    protected String fetchRaw(String city) {
        return new HttpClient().get("https://api.example.com/w/" + city);
    }

    private Weather parse(String json) { /* ... */ }
}
```

```java
// Test subclass overrides the seam — the enabling point is the override.
@Test
void buildsHeadlineFromRawJson() {
    WeatherReport report = new WeatherReport() {
        @Override protected String fetchRaw(String city) {
            return "{\"headline\":\"Sunny\"}"; // canned response, no network
        }
    };
    assertEquals("Sunny", report.summary("Tashkent"));
}
```

This is the **Subclass and Override Method** technique from the [dependency-breaking](../05-dependency-breaking-techniques/) catalogue. The enabling point is *the override itself* — choosing which subclass to instantiate. It is less clean than interface injection (the seam hides inside an inheritance relationship), but it is invaluable when constructor injection is not yet possible.

### Parameterize the method

The smallest object seam: pass the collaborator as a method argument rather than storing it. Useful when only one method needs the dependency and you want minimal disturbance.

```java
// AFTER — parameterized method. The seam is the argument.
public class Invoice {
    public Money totalDueAt(Clock clock) { // <-- seam AND enabling point in one
        return baseAmount().plus(lateFeeAsOf(clock.now()));
    }
}
```

Here the seam and the enabling point are the *same place* — the parameter. That is the simplest possible arrangement, though it pushes the choice of `Clock` up to every caller, which can get noisy if many methods need it.

---

## Link seams

A **link seam** swaps behavior at *link time*: the code is unchanged, but a different library or object file is bound when the program is built. The enabling point is the build/link configuration, not the source.

In C/C++ this is classic. Suppose production links a real `db.c`; a test build links a `fake_db.c` that provides the same symbols.

```c
/* report.c — calls into a function declared in db.h. No knowledge of impl. */
#include "db.h"

int active_user_count(void) {
    return db_count_where("status = 'active'"); // the seam: a linked symbol
}
```

```makefile
# The Makefile is the enabling point — it decides which object to link.
report_prod: report.o db.o          # links the REAL database access
	$(CC) -o $@ $^

report_test: report.o fake_db.o     # links the FAKE — same symbols, canned data
	$(CC) -o $@ $^ test_main.o
```

`fake_db.c` defines `db_count_where` to return a fixed value, so the test build never touches a database. The source of `report.c` is identical in both builds — behavior was altered without editing in that place.

On Linux, `LD_PRELOAD` is a runtime link seam: it forces a shared library to be loaded ahead of others, letting you override functions (e.g. `time`, `malloc`) for the duration of a process — enabling point is the environment variable.

On the JVM, the **classpath** is a link seam. If two jars expose the same fully qualified class, the one earlier on the classpath wins. Tests sometimes exploit this by placing a stub class with the same name ahead of the production jar:

```bash
# Enabling point = classpath order. The stub jar shadows the real class.
java -cp test-stubs.jar:app.jar com.example.Main
```

> **Warning:** Link seams are powerful but **invisible in the source**. A reader of `report.c` has no hint that its behavior depends on which `.o` was linked. Senior engineers treat link seams as a last resort for exactly this reason — see the [senior](./senior.md) page.

---

## Preprocessor seams

In C/C++ the **preprocessor** runs before compilation and can include or exclude code based on flags. This is a **preprocessor seam**: the enabling point is a compiler `-D` flag.

```c
#include "logger.h"

void process(Request *r) {
#ifdef UNIT_TEST
    Clock *clock = fake_clock();   /* deterministic time in tests */
#else
    Clock *clock = system_clock(); /* real time in production */
#endif
    handle(r, clock_now(clock));
}
```

```makefile
test:  ; $(CC) -DUNIT_TEST process.c -o process_test   # enabling point
prod:  ; $(CC)            process.c -o process_prod
```

A subtler use is redefining a function with a macro so the call site is unchanged but routed elsewhere:

```c
// In a test header, redirect db_save to a fake without touching call sites.
#define db_save(x) fake_db_save(x)
```

Preprocessor seams are even more dangerous than link seams: the same source compiles to *different programs* depending on flags, and the two can drift apart silently (a bug present only in the production branch is never exercised by tests). Reserve them for environments where no better seam exists — typically embedded C with no DI machinery.

---

## Text and configuration seams

Late-bound and dynamic languages give you seams that compiled languages cannot. The enabling point is the runtime itself.

**Python monkeypatching** replaces an attribute on a module or object at runtime:

```python
# billing.py
import emailer

def charge(customer, amount):
    process_payment(customer, amount)
    emailer.send(customer.email, f"Charged {amount}")  # the seam: a module attribute
```

```python
# test_billing.py — the enabling point is the patch.
def test_charge_sends_receipt(monkeypatch):
    sent = {}
    monkeypatch.setattr(
        "billing.emailer.send",
        lambda to, body: sent.update(to=to, body=body),  # fake replaces real
    )
    charge(Customer(email="a@b.com"), 50)
    assert sent["to"] == "a@b.com"
```

No interface, no constructor change — Python lets the test rebind `emailer.send` for the duration of the test. This is convenient but fragile: the patch target is a string, so a rename of the real symbol silently breaks the patch with no compiler to catch it.

**Configuration seams** swap behavior via external config rather than code. A factory chooses an implementation based on a setting:

```typescript
// The config value is the enabling point.
function makeMailer(cfg: Config): Mailer {
  return cfg.env === "test" ? new InMemoryMailer() : new SmtpMailer();
}
```

This is really an object seam whose *enabling point has been lifted into configuration*. Useful in integration environments, but keep the decision logic in one obvious factory so it does not scatter.

---

## How to find seams in unfamiliar code

When you open a method you need to test, scan for the boundaries where behavior crosses out of "logic you care about" into "the outside world." Those boundaries are your seam candidates.

| Smell in the code | Seam candidate | Move to make it a seam |
|---|---|---|
| `new SomeService()` inside a method | Object seam | Extract interface, inject via constructor |
| `static` call to a singleton or utility | Object seam (harder) | Wrap in an instance collaborator, inject it |
| `Instant.now()`, `new Date()`, `System.currentTimeMillis()` | Object seam | Introduce a `Clock` collaborator |
| Direct file / socket / DB access | Object seam | Extract a gateway interface |
| A global function call (C) | Link or preprocessor seam | Provide an alternate object at link time |
| A module-level function call (Python/JS) | Configuration / text seam | Monkeypatch or inject |

The mechanical recipe: pick the method under test, find the first line that talks to something you cannot control or sense, and ask *"can I make this an argument, an injected field, an overridable method, or a swapped library?"* The cheapest answer that is also visible in the source is usually the right one.

---

## Enabling points: where the decision lives

A seam is useless if you cannot reach its enabling point from your test. Always locate both. The table maps seam types to their enabling points:

| Seam type | Enabling point | How a test reaches it |
|---|---|---|
| Interface injection | Constructor / setter parameter | Pass a fake when constructing |
| Subclass and override | The subclass chosen | Instantiate a test subclass |
| Parameterized method | Method argument | Pass a fake on the call |
| Link seam | Build/link configuration | Build a separate test binary / classpath |
| Preprocessor seam | Compiler `-D` flag | Compile with the test flag |
| Configuration seam | Config value / env var | Set the value in the test environment |

Notice that the bottom three enabling points live *outside the source file*. That is the central trade-off: the further the enabling point is from the code, the harder the seam is to see, reason about, and keep correct. This drives the preference order in the next section.

---

## Choosing the right seam

Use this decision order. Stop at the first one that applies cleanly.

1. **Can you inject an interface via the constructor?** Do that. Visible, type-checked, local. This is the default.
2. **Is the constructor too entangled to change right now?** Use **subclass and override** to create a temporary seam, then refactor toward injection later.
3. **Only one method needs the dependency?** Parameterize that method.
4. **Dynamic language and a quick test needed?** A configuration/monkeypatch seam is acceptable — but treat it as a stepping stone, not a destination.
5. **Compiled language with no way to inject (legacy C, third-party binary)?** Fall back to a link or preprocessor seam, accepting the invisibility cost.

> **Key idea:** Prefer the seam whose enabling point is *closest to the code and checked by the compiler*. Object seams win on both counts; link and preprocessor seams lose on both and are last resorts.

---

## Worked example: putting it together

Start with untestable code — a price quote that reads the clock, calls a remote FX service, and is constructed bare.

```java
// BEFORE — two welded-in dependencies, zero seams.
public class QuoteService {
    public Money quote(String sku, String currency) {
        Money base = catalogPrice(sku);
        double rate = new FxClient().rateFor(currency);  // network
        Money converted = base.times(rate);
        if (LocalTime.now().getHour() < 6) {             // clock
            converted = converted.times(0.95);           // night discount
        }
        return converted;
    }
    private Money catalogPrice(String sku) { /* ... */ }
}
```

Introduce two object seams via constructor injection:

```java
// AFTER — two object seams, both enabled at the constructor.
public class QuoteService {
    private final FxRates fx;     // seam 1
    private final Clock clock;    // seam 2

    public QuoteService(FxRates fx, Clock clock) { // <-- enabling point
        this.fx = fx;
        this.clock = clock;
    }

    public Money quote(String sku, String currency) {
        Money base = catalogPrice(sku);
        Money converted = base.times(fx.rateFor(currency));
        if (clock.now().atZone(ZoneOffset.UTC).getHour() < 6) {
            converted = converted.times(0.95);
        }
        return converted;
    }
    private Money catalogPrice(String sku) { /* ... */ }
}
```

Now the night-discount rule is fully testable without a network or a midnight test run:

```java
@Test
void appliesNightDiscountBeforeSixUtc() {
    FxRates fixedFx = currency -> 2.0; // fake: always 2x
    Clock atFour = () -> Instant.parse("2030-06-01T04:00:00Z");
    QuoteService svc = new QuoteService(fixedFx, atFour);

    Money q = svc.quote("BOOK-1", "EUR"); // base 10 * 2.0 * 0.95 = 19.00
    assertEquals(Money.of(19, 0), q);
}
```

Two seams, one shared enabling point (the constructor), and a once-untestable method is now pinned down by a fast, deterministic test. That is the entire move, applied for real.

---

## Mini Glossary

| Term | Meaning |
|---|---|
| **Object seam** | Swap a collaborator via interface injection, subclass-and-override, or method parameter. |
| **Interface injection** | Depend on an interface; pass the concrete implementation in at construction. |
| **Subclass and override** | Make an awkward operation an overridable method and override it in a test subclass. |
| **Parameterize method** | Pass the collaborator as a method argument; seam and enabling point coincide. |
| **Link seam** | Bind a different library/object file at link time; enabling point is the build config. |
| **Preprocessor seam** | Include/exclude code via `#ifdef`/macros; enabling point is a compiler flag. |
| **Configuration / text seam** | Swap implementation at runtime via config, monkeypatch, or env var. |
| **Gateway** | A thin interface wrapping access to an external resource (DB, network, filesystem). |
| **Enabling point** | The location where the seam's behavior is chosen. |

---

## Review questions

1. Write the three forms of object seam and rank them by preference. Why is interface injection first?
2. In the subclass-and-override example, what is the enabling point? Why is this seam less clean than injection?
3. Show a Makefile fragment that uses a link seam to build a test binary. Where is the enabling point?
4. Why are link and preprocessor seams described as "invisible in the source"? What risk does that create?
5. Give a Python monkeypatch example. What is fragile about the patch target?
6. Walk through the table of code smells: for `Instant.now()` inside a method, what seam and what move would you use?
7. A method has both a network call and a clock read welded in. Describe how to introduce two object seams and where their enabling point would be.
8. When is a configuration seam acceptable, and why should it be treated as a stepping stone?
9. State the decision order for choosing a seam. What property do you optimise for at each step?
10. Why does pushing the enabling point further from the source (into build/config) make a seam harder to maintain?
