# Dependency-Breaking Techniques — Middle Level

## Table of Contents

- [The working catalog](#the-working-catalog)
- [A shared example to break apart](#a-shared-example-to-break-apart)
- [1. Parameterize Constructor](#1-parameterize-constructor)
- [2. Parameterize Method](#2-parameterize-method)
- [3. Extract Interface](#3-extract-interface)
- [4. Extract and Override Call](#4-extract-and-override-call)
- [5. Extract and Override Factory Method](#5-extract-and-override-factory-method)
- [6. Subclass and Override Method](#6-subclass-and-override-method)
- [7. Introduce Instance Delegator](#7-introduce-instance-delegator)
- [8. Introduce Static Setter / replace singleton](#8-introduce-static-setter--replace-singleton)
- [9. Adapt Parameter](#9-adapt-parameter)
- [10. Break Out Method Object](#10-break-out-method-object)
- [11. Encapsulate Global References](#11-encapsulate-global-references)
- [The rest of the catalog, briefly](#the-rest-of-the-catalog-briefly)
- [How to pick one](#how-to-pick-one)
- [Mini Glossary](#mini-glossary)
- [Review questions](#review-questions)

---

## The working catalog

The [junior page](./junior.md) covered four techniques and the core idea: every move introduces a *seam* so you can substitute a fake to **sense** or **separate**. This page is the working catalog — roughly the moves you will actually reach for, each with a before→after and a clear "use when." Treat it as a lookup table you return to while you are elbow-deep in a method that will not test.

The order is rough difficulty/invasiveness, easiest first. The [senior page](./senior.md) ranks them by *safety* (which are mechanical and which can change behavior) and tells you the order to apply them.

> **Key idea:** You do not need every technique memorized. You need to recognize the *shape* of the obstacle — internal `new`, a `static` call, an ugly parameter type, a global — and know the move that matches each shape.

| Obstacle in the code | Reach for |
|----------------------|-----------|
| Class `new`s its dependency in the constructor | Parameterize Constructor |
| One method `new`s its dependency | Parameterize Method |
| You depend on a concrete class you can't fake | Extract Interface |
| A hard-coded call sits mid-method | Extract and Override Call |
| Object creation is tangled into the constructor | Extract and Override Factory Method |
| An awkward method you can make overridable | Subclass and Override Method |
| A `static` call you must fake | Introduce Instance Delegator |
| A singleton / global you must swap | Introduce Static Setter |
| An ugly, un-fakeable parameter type | Adapt Parameter |
| A giant method whose locals you need to see | Break Out Method Object |
| Scattered global references | Encapsulate Global References |

---

## A shared example to break apart

We will keep returning to one realistic class. It is a checkout handler that has *every* kind of problem dependency at once: an internally constructed collaborator, a static call, a singleton, the system clock, and an ugly framework parameter.

```java
public class CheckoutHandler {

    public String handle(HttpServletRequest request) {
        String cartId = request.getParameter("cartId");
        Cart cart = new CartRepository().load(cartId);          // internal `new`

        if (AuditLog.instance().isThrottled()) {                // singleton
            return "RETRY_LATER";
        }

        Money total = cart.total();
        String txn = PaymentGateway.charge(cart.card(), total); // static call

        Receipt receipt = new Receipt(txn, LocalDateTime.now()); // clock + new
        EmailService.send(cart.email(), receipt);               // static call

        return "OK:" + txn;
    }
}
```

None of `handle` can run in a test as written. Over the page we break each obstacle with the matching technique.

---

## 1. Parameterize Constructor

**Problem.** A dependency is created with `new` inside the constructor, so it cannot be substituted.

**Before.**

```java
public class CheckoutHandler {
    private final CartRepository repo;
    public CheckoutHandler() {
        this.repo = new CartRepository();   // not swappable
    }
}
```

**After.** Accept the dependency; keep a no-arg constructor that supplies the production default so existing callers compile.

```java
public class CheckoutHandler {
    private final CartRepository repo;

    public CheckoutHandler(CartRepository repo) {   // seam
        this.repo = repo;
    }

    public CheckoutHandler() {                      // preserves callers
        this(new CartRepository());
    }
}
```

**Use when.** The dependency is constructed in the constructor and a fake can be supplied from outside. Cleanest technique; usually the permanent design too.

**Risk.** Very low. If you keep the old constructor, no caller breaks.

---

## 2. Parameterize Method

**Problem.** A dependency (often a *value* dependency like "now") is created inside a single method.

**Before.**

```java
Receipt receipt = new Receipt(txn, LocalDateTime.now());
```

**After.** Push the value in as a parameter via an overload; the old method supplies the real value.

```java
public String handle(HttpServletRequest request) {
    return handle(request, LocalDateTime.now());     // production path
}

// Seam: time is injected.
public String handle(HttpServletRequest request, LocalDateTime now) {
    ...
    Receipt receipt = new Receipt(txn, now);
    ...
}
```

**Use when.** The dependency is used in one method and is cheap to pass (a clock, a flag, a value). Avoids touching the constructor.

**Risk.** Low. Watch for callers that need updating if you change the *primary* signature instead of adding an overload.

---

## 3. Extract Interface

**Problem.** You depend on a concrete type you cannot fake (final, I/O in constructor, no shared supertype).

**Before.**

```java
public class CheckoutHandler {
    public CheckoutHandler(CartRepository repo) { ... }   // concrete
}
```

**After.** Extract an interface containing only the methods you call; make the concrete class implement it; depend on the interface.

```java
public interface Carts {
    Cart load(String cartId);
}

public class CartRepository implements Carts {
    @Override public Cart load(String cartId) { /* real DB */ }
}

public class CheckoutHandler {
    private final Carts carts;
    public CheckoutHandler(Carts carts) { this.carts = carts; }
}
```

Now a fake is trivial:

```java
Carts fake = id -> sampleCart();
```

**Use when.** You need to substitute a concrete collaborator. The default move to make a real object fakeable.

**Risk.** Low and mechanical — most IDEs do "Extract Interface" automatically. Keep the interface *narrow* (Interface Segregation): only the methods this client uses.

---

## 4. Extract and Override Call

**Problem.** A hard-coded call sits in the *middle* of a method. You cannot easily parameterize it, but you can isolate it.

**Before.**

```java
public String handle(...) {
    ...
    EmailService.send(cart.email(), receipt);   // static, buried mid-method
    ...
}
```

**After.** Extract the call into its own `protected` method, then override that method in a test subclass.

```java
public String handle(...) {
    ...
    sendEmail(cart.email(), receipt);   // now goes through a seam
    ...
}

protected void sendEmail(String to, Receipt receipt) {
    EmailService.send(to, receipt);     // production keeps the real call
}
```

```java
@Test
void doesNotSendEmailOnRetry() {
    List<String> sent = new ArrayList<>();
    CheckoutHandler handler = new CheckoutHandler() {
        @Override protected void sendEmail(String to, Receipt r) {
            sent.add(to);   // sense the call instead of sending
        }
    };
    ...
    assertEquals(List.of("ada@x.com"), sent);
}
```

**Use when.** A single problematic call is embedded in a method and you want a localized seam without restructuring the class. Especially good for *static* calls you cannot otherwise intercept.

**Risk.** Low–moderate. The extracted method must be overridable (not `private`/`final`/`static`). You are adding a test-only override point — a small design smell to clean up later.

---

## 5. Extract and Override Factory Method

**Problem.** An object is created *inside the constructor*, so you cannot substitute it and you cannot parameterize the constructor cleanly (perhaps creation is conditional or expensive).

**Before.**

```java
public class CheckoutHandler {
    private final AuditLog audit;
    public CheckoutHandler() {
        this.audit = new AuditLog(loadConfig());   // creation tangled in ctor
    }
}
```

**After.** Move the creation into an overridable factory method called from the constructor.

```java
public class CheckoutHandler {
    private final AuditLog audit;

    public CheckoutHandler() {
        this.audit = createAuditLog();   // seam
    }

    protected AuditLog createAuditLog() {
        return new AuditLog(loadConfig());
    }
}
```

```java
CheckoutHandler handler = new CheckoutHandler() {
    @Override protected AuditLog createAuditLog() {
        return new FakeAuditLog();
    }
};
```

**Use when.** Creation logic is locked inside a constructor and you cannot inject. The override-during-construction sibling of Subclass and Override.

**Risk.** Moderate, and there is a language trap: calling an overridable method *from a constructor* runs the subclass override **before the subclass's own fields are initialized**. Keep the factory method self-contained — do not let it touch subclass state. (Senior page covers this in depth.)

---

## 6. Subclass and Override Method

**Problem.** A method does something awkward (network, sleep, randomness) and you need to neutralize or sense it.

**Before.**

```java
public class CheckoutHandler {
    public String handle(...) {
        String txn = chargeCard(cart.card(), total);
        ...
    }
    protected String chargeCard(Card card, Money amount) {
        return PaymentGateway.charge(card, amount);   // real network
    }
}
```

**After (test only).**

```java
CheckoutHandler handler = new CheckoutHandler() {
    @Override protected String chargeCard(Card card, Money amount) {
        return "TXN-FAKE";   // neutralize
    }
};
```

**Use when.** You can make the awkward behavior live behind one overridable method. This is the **workhorse**: fast, surgical, no new types. Extract and Override Call and Extract and Override Factory Method are specializations of it.

**Risk.** Moderate. Needs an overridable method; in `sealed`/`final` worlds you cannot subclass. The subclass is test-only scaffolding — keep an eye on what it overrides so you do not accidentally neutralize logic you meant to test.

---

## 7. Introduce Instance Delegator

**Problem.** A `static` call cannot be faked through normal substitution (no instance to swap).

**Before.**

```java
String txn = PaymentGateway.charge(cart.card(), total);   // static method
```

**After.** Add a *non-static instance method* on the same class (or a thin gateway object) that delegates to the static, then call the instance. Now you depend on an object you can fake.

```java
public class PaymentGateway {
    public static String charge(Card card, Money amount) { /* real */ }

    // Instance delegator: a fakeable wrapper around the static call.
    public String chargeInstance(Card card, Money amount) {
        return charge(card, amount);
    }
}
```

```java
public class CheckoutHandler {
    private final PaymentGateway gateway;   // injected (see #1)
    ...
    String txn = gateway.chargeInstance(cart.card(), total);
}
```

Better still, combine with **Extract Interface** so the handler depends on a `Payments` interface, not the gateway class.

**Use when.** You are stuck with static calls (legacy utility classes, `Calendar.getInstance()`, framework statics) and want them swappable without rewriting every call site at once.

**Risk.** Low–moderate. You are introducing an object where there was a static; pairs naturally with constructor injection and interface extraction toward a clean design.

---

## 8. Introduce Static Setter / replace singleton

**Problem.** A singleton (`X.instance()`) is reached for directly inside the code; tests cannot swap the global instance.

**Before.**

```java
if (AuditLog.instance().isThrottled()) { ... }
```

**After.** Give the singleton a *test-only setter* so a test can install a fake instance, and reset it afterward.

```java
public class AuditLog {
    private static AuditLog instance = new AuditLog();

    public static AuditLog instance() { return instance; }

    // Test seam. Package-private / clearly test-only.
    static void setInstanceForTest(AuditLog replacement) {
        instance = replacement;
    }
}
```

```java
@AfterEach
void resetSingleton() { AuditLog.setInstanceForTest(new AuditLog()); }

@Test
void retriesWhenThrottled() {
    AuditLog.setInstanceForTest(new ThrottledAuditLog());   // fake
    ...
}
```

**Use when.** A singleton or global is hard-wired in and you cannot inject it yet. The fastest way to make global state swappable.

**Risk.** **High by these standards.** A static setter is mutable global state shared across tests — a source of flaky, order-dependent tests. Always reset in teardown, prefer package-private visibility, and treat it as scaffolding to delete once you inject the dependency properly. Loosening the singleton to allow a setter can also let production code mutate it; guard against that.

---

## 9. Adapt Parameter

**Problem.** A method takes an *ugly, un-fakeable parameter type* — a framework class like `HttpServletRequest` with dozens of methods, a `final` class, or something you cannot construct in a test.

**Before.** `handle(HttpServletRequest request)` forces every test to build or mock a heavyweight servlet request.

**After.** Define a *small interface you own* that exposes only what the method needs, then write a thin adapter for the real type. The method now takes your interface.

```java
// 1. A tiny interface you control.
public interface CheckoutInput {
    String cartId();
}

// 2. Adapter wrapping the ugly real type.
public class ServletCheckoutInput implements CheckoutInput {
    private final HttpServletRequest req;
    public ServletCheckoutInput(HttpServletRequest req) { this.req = req; }
    @Override public String cartId() { return req.getParameter("cartId"); }
}

// 3. The method now depends on your interface, not the framework.
public String handle(CheckoutInput input) {
    String cartId = input.cartId();
    ...
}
```

```java
@Test
void readsCartId() {
    CheckoutInput input = () -> "cart-7";   // trivial fake, no servlet
    ...
}
```

**Use when.** A method is shackled to a fat framework or third-party type that is painful to fake. Also improves the design: your code now speaks its own vocabulary, not the framework's.

**Risk.** Low. The only cost is the extra interface + adapter; for a one-method type this is cheap and almost always worth it. (This is the **Adapter** pattern; see [`../../design-patterns/`](../../design-patterns/).)

---

## 10. Break Out Method Object

**Problem.** A single method is enormous, its logic lives in local variables, and there is no smaller unit you can test. You cannot get at the intermediate state.

**Before.** A 120-line `calculate(...)` with a dozen locals and no seams.

**After.** Extract the whole method into its own class. The method's *parameters become constructor arguments*, its *locals become fields*, and the body becomes a `run()`/`compute()` method. Now you can test pieces and substitute collaborators in the new class's constructor.

```java
// Was: public Invoice calculate(Order o, TaxTable t) { ...120 lines... }

public class InvoiceCalculation {
    private final Order order;
    private final TaxTable taxTable;
    private Money subtotal;   // was a local; now an inspectable field
    private Money tax;

    public InvoiceCalculation(Order order, TaxTable taxTable) {
        this.order = order;
        this.taxTable = taxTable;
    }

    public Invoice compute() {
        computeSubtotal();
        computeTax();
        return new Invoice(subtotal, tax);
    }

    void computeSubtotal() { ... }   // now individually testable
    void computeTax() { ... }
}
```

The original method becomes a one-liner: `return new InvoiceCalculation(order, taxTable).compute();`

**Use when.** A monster method has no smaller testable unit and you need to break it into pieces with their own seams. This is also a major *Replace Method with Method Object* refactoring (see [`../../refactoring/`](../../refactoring/)).

**Risk.** Moderate. It is a larger restructuring; do it under whatever tests you can scrape together first, and lean on automated "Extract" refactorings to stay safe.

---

## 11. Encapsulate Global References

**Problem.** Global references (global variables, static config, `System.getenv`) are scattered through the code and read directly.

**Before.**

```java
int timeout = GlobalConfig.TIMEOUT;          // global field
String region = System.getenv("AWS_REGION"); // global call
```

**After.** Wrap the globals behind an object with an interface, and depend on that object. Now a fake config replaces all of them at once.

```java
public interface Config {
    int timeout();
    String region();
}

public class EnvConfig implements Config {
    @Override public int timeout() { return GlobalConfig.TIMEOUT; }
    @Override public String region() { return System.getenv("AWS_REGION"); }
}

// Client depends on Config (injected via #1), not on the globals.
public class CheckoutHandler {
    private final Config config;
    public CheckoutHandler(Config config) { this.config = config; }
}
```

**Use when.** Global state is read in many places and you want to make it all swappable with one injected object.

**Risk.** Low–moderate per wrap, but the *scope* can be large if globals are everywhere. Encapsulate the references the code under test actually touches; do not boil the ocean.

---

## The rest of the catalog, briefly

You will reach for these less often; recognize them by name.

| Technique | One-line summary |
|-----------|------------------|
| **Pull Up Feature** | Move the features you want to test up into a new abstract superclass, leaving the awkward dependencies behind in the subclass, then test the superclass in isolation. |
| **Push Down Dependency** | The mirror image: push the *problem* dependencies *down* into a subclass, making the original class abstract and testable. |
| **Replace Function with Function Pointer** | (C/C++ and functional langs) swap a hard call for a function pointer / first-class function you can repoint in a test. |
| **Definition Completion** | (C/C++) provide your own definitions for functions declared but defined elsewhere, so the linker uses your test versions. |
| **Replace Global Reference with Getter** | Route global access through an overridable getter so a subclass can return a fake. |
| **Expose Static Method** | If a method uses no instance state, make it `static` so you can test it without constructing the awkward object. |

---

## How to pick one

A simple decision flow:

```
Is the dependency CONSTRUCTED inside the class?
   └─ in the constructor?  ──▶ Parameterize Constructor (or Extract & Override Factory)
   └─ in one method?       ──▶ Parameterize Method

Is the dependency a CONCRETE type you can't fake?
   └─ ──▶ Extract Interface (+ inject it)

Is the call STATIC / a SINGLETON / a GLOBAL?
   └─ static call          ──▶ Introduce Instance Delegator (then Extract Interface)
   └─ singleton            ──▶ Introduce Static Setter (scaffolding; reset it!)
   └─ scattered globals    ──▶ Encapsulate Global References

Is the awkward thing a CALL buried in a method?
   └─ ──▶ Extract and Override Call  /  Subclass and Override Method

Is the PARAMETER TYPE ugly / un-fakeable?
   └─ ──▶ Adapt Parameter

Is the METHOD a monster with no testable unit?
   └─ ──▶ Break Out Method Object
```

Two tie-breakers when more than one fits:

1. **Prefer the technique that improves the design** (Parameterize Constructor, Extract Interface, Adapt Parameter) over pure scaffolding (Introduce Static Setter, Subclass and Override). The senior page expands this ranking.
2. **Prefer the smallest change that gets you a seam.** Your goal right now is a test, not a redesign. Get the test green, then refactor.

> **Key idea:** Pick by the *shape of the obstacle*, break by the *minimum-footprint move*, and remember the clean moves (inject + interface) are both your safest dependency break *and* your eventual end state.

---

## Mini Glossary

| Term | Meaning |
|------|---------|
| **Parameterize Constructor / Method** | Pass a dependency in rather than constructing it internally. |
| **Extract Interface** | Pull a narrow interface off a concrete class so it can be faked. |
| **Extract and Override Call** | Move an embedded call into an overridable method, then override it in a test. |
| **Factory Method (extract & override)** | Move construction into an overridable method called from the constructor. |
| **Subclass and Override Method** | Subclass in the test and override the awkward method to neutralize or sense it. |
| **Instance Delegator** | A non-static method wrapping a static call, so it becomes fakeable. |
| **Static Setter** | A test-only setter that swaps a singleton/global instance (scaffolding). |
| **Adapt Parameter** | Wrap an ugly parameter type behind a small interface you own. |
| **Break Out Method Object** | Extract a big method into a class; locals become inspectable fields. |
| **Encapsulate Global References** | Wrap globals behind an injectable object. |

---

## Review questions

1. Map each obstacle to its technique: (a) `LocalDate.now()` inside a method, (b) a static `Mailer.send(...)`, (c) a `final` concrete `KafkaProducer` dependency, (d) a 150-line method with no seams.
2. Show before/after for **Introduce Instance Delegator** on a static call. Why is it usually paired with Extract Interface?
3. Why is **Introduce Static Setter** flagged as high-risk even though it is fast? What two habits make it safer?
4. **Extract and Override Factory Method** has a constructor-ordering trap. Describe it and how to avoid it.
5. You receive an `HttpServletRequest` and only need one field from it. Which technique applies, what pattern is it, and why does it improve the design as well as testability?
6. Two techniques both fit your situation. What are the two tie-breakers for choosing between them?
7. Rewrite the no-arg-constructor trick from **Parameterize Constructor** and explain why it keeps existing callers compiling.
8. When does **Break Out Method Object** earn its larger cost over simply extracting a few small methods?
