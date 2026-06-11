# Dependency-Breaking Techniques — Interview Q&A

## Table of Contents

- [How to use this bank](#how-to-use-this-bank)
- [Q1. Why do we break dependencies at all? (junior)](#q1-why-do-we-break-dependencies-at-all-junior)
- [Q2. Sensing vs. separation? (junior)](#q2-sensing-vs-separation-junior)
- [Q3. Parameterize Constructor without breaking callers? (junior)](#q3-parameterize-constructor-without-breaking-callers-junior)
- [Q4. Parameterize Method vs. Parameterize Constructor? (junior–middle)](#q4-parameterize-method-vs-parameterize-constructor-juniormiddle)
- [Q5. What does Extract Interface buy you? (middle)](#q5-what-does-extract-interface-buy-you-middle)
- [Q6. Subclass and Override Method — why the "workhorse"? (middle)](#q6-subclass-and-override-method--why-the-workhorse-middle)
- [Q7. A static call you must fake — what now? (middle)](#q7-a-static-call-you-must-fake--what-now-middle)
- [Q8. Faking a singleton safely? (middle–senior)](#q8-faking-a-singleton-safely-middlesenior)
- [Q9. HttpServletRequest is awful to fake — what do you do? (middle–senior)](#q9-httpservletrequest-is-awful-to-fake--what-do-you-do-middlesenior)
- [Q10. Which moves are safe without a test? (senior)](#q10-which-moves-are-safe-without-a-test-senior)
- [Q11. The constructor-override ordering trap (senior)](#q11-the-constructor-override-ordering-trap-senior)
- [Q12. final/sealed blocks your technique — recover (senior)](#q12-finalsealed-blocks-your-technique--recover-senior)
- [Q13. Scaffolding vs. real DI (senior)](#q13-scaffolding-vs-real-di-senior)
- [Q14. Break Out Method Object — when worth it? (senior)](#q14-break-out-method-object--when-worth-it-senior)
- [Q15. Smallest safe step under deadline (staff)](#q15-smallest-safe-step-under-deadline-staff)
- [Q16. Reviewing a dependency-breaking PR (staff)](#q16-reviewing-a-dependency-breaking-pr-staff)
- [Q17. Over-introducing interfaces — defend the line (staff)](#q17-over-introducing-interfaces--defend-the-line-staff)
- [Q18. Design a sequence for a fully tangled class (staff)](#q18-design-a-sequence-for-a-fully-tangled-class-staff)
- [Q19. Stub vs. spy vs. mock in a seam (middle–senior)](#q19-stub-vs-spy-vs-mock-in-a-seam-middlesenior)
- [Q20. Does the catalog change in C++ or Python? (senior)](#q20-does-the-catalog-change-in-c-or-python-senior)
- [Q21. When would you *not* break the dependency? (staff)](#q21-when-would-you-not-break-the-dependency-staff)

---

## How to use this bank

Questions run junior → staff. Each has a model answer, the signal an interviewer is listening for, and likely follow-ups. The strongest candidates connect a *specific technique* to the *reason* (sense vs. separate), name the *safety* of the move, and know when a technique is *scaffolding* versus the destination design.

---

## Q1. Why do we break dependencies at all? (junior)

**Model answer.** To get code into a test harness. Legacy code is usually tangled with things you can't run in a test — a real database, the system clock, a network call, a global. A dependency-breaking technique is a small, mechanical change that introduces a *seam*: a place where you can substitute a fake you control. Once a fake is in place, you can run the surrounding logic in isolation, write a characterization test that pins down current behavior, and only then change the code safely. So breaking the dependency isn't the goal — it's how you earn the right to write the test that makes change safe.

**Signal:** the candidate ties the technique to *testability*, not to abstract "decoupling," and mentions the seam → fake → test → change chain.

**Follow-ups:**
- *What's a "problem dependency"?* One that makes code hard, slow, or dangerous to run in a test.
- *Where does this fit in the legacy change algorithm?* It's step three: find change points, find test points, **break dependencies**, write tests, make changes.

---

## Q2. Sensing vs. separation? (junior)

**Model answer.** Feathers names exactly two reasons to break a dependency. **Sensing** is breaking it so you can *observe* an effect you otherwise couldn't see — e.g., your code calls `mailer.send(...)` and you want to assert what was sent, so you substitute a fake that *records* the call. **Separation** is breaking it so the code can *run at all* in a place it couldn't — e.g., it opens a real database, and you substitute a fake so the test never touches the network. The distinction matters because it tells you what your fake must do: a sensing fake must *record*; a separating fake just needs to *not do the real thing* and return something plausible.

**Signal:** correctly maps each reason to a fake's responsibility (record vs. neutralize).

**Follow-up:** *Can one break serve both?* Yes — you often separate from the DB *and* sense which queries ran; then you need a recording fake, not a constant stub.

---

## Q3. Parameterize Constructor without breaking callers? (junior)

**Model answer.** Add a *new* constructor that accepts the dependency, and keep the old one delegating to it with the production default. Existing callers keep compiling because the old signature still exists; new tests use the injecting constructor.

```java
public InvoiceService(EmailSender sender) {   // new seam
    this.sender = sender;
}
public InvoiceService() {                      // preserves all callers
    this(new SmtpEmailSender(...));
}
```

This is the cleanest technique and often the permanent design — it *is* dependency injection in miniature. Crucially it's behavior-preserving: production still builds the same `SmtpEmailSender`.

**Signal:** keeps the old constructor, knows the production diff is provably behavior-neutral.

**Follow-up:** *When would you instead change the only constructor's signature?* Once everything is injected and you want to force callers to supply dependencies — but that's a breaking change you do deliberately, later, with tests in place.

---

## Q4. Parameterize Method vs. Parameterize Constructor? (junior–middle)

**Model answer.** Same idea — pass the dependency in instead of constructing it — at different scopes. **Parameterize Constructor** when the dependency is a *collaborator* used across the class. **Parameterize Method** when the dependency (often a *value* like "now" or a flag) is used in *one method* and adding it to the constructor would be overkill. The method version typically adds an overload: the old signature supplies the real value and delegates.

```java
public boolean isExpired(Subscription s) { return isExpired(s, LocalDate.now()); }
public boolean isExpired(Subscription s, LocalDate today) {   // seam
    return s.endDate().isBefore(today);
}
```

**Signal:** chooses by *scope of the dependency*, and uses an overload to stay backward-compatible.

**Follow-up:** *Why is "now" a dependency?* Because it's nondeterministic input from outside; injecting it makes boundary cases (expires exactly today) testable.

---

## Q5. What does Extract Interface buy you? (middle)

**Model answer.** It makes a concrete collaborator *substitutable*. If your code depends on a concrete class that's `final`, does I/O in its constructor, or has no shared supertype, you can't supply a fake — fakes must share a type with the real object. Extract Interface pulls a *narrow* interface (only the methods this client calls) off the concrete class, the concrete class implements it, and the client depends on the interface. Now a fake is trivial.

```java
interface Carts { Cart load(String id); }
class CartRepository implements Carts { public Cart load(String id) { /* DB */ } }
// client depends on Carts; fake: Carts fake = id -> sampleCart();
```

It's also one of the *safest* moves — IDEs perform it and the compiler proves every reference still resolves, so behavior can't change. Keep the interface small (Interface Segregation): only what the client uses.

**Signal:** mentions narrow interface, compiler-verified safety, and that it requires also *injecting* the interface to be useful.

**Follow-ups:**
- *Risk of extracting interfaces everywhere?* Interface mania — single-impl interfaces that add indirection without abstraction. Extract where you need a seam, not by reflex.
- *Where's the destination?* This is Dependency Inversion: depend on an abstraction supplied from outside.

---

## Q6. Subclass and Override Method — why the "workhorse"? (middle)

**Model answer.** Because it's fast, surgical, and needs no new types. You take the awkward behavior (a network call, a sleep, randomness), put it behind one overridable method in production, and in the *test only* subclass the class and override that method to neutralize or sense it. Extract-and-Override-Call and Extract-and-Override-Factory are just specializations of it.

```java
CheckoutHandler h = new CheckoutHandler() {
    @Override protected String chargeCard(Card c, Money m) { return "TXN-FAKE"; }
};
```

Its costs: the method must be *overridable* — not `private`, `final`, or `static` — which often means widening visibility, a real design change. And the test subclass is *scaffolding*: a stepping stone you usually replace later with Extract Interface + injection.

**Signal:** knows the constraints (overridable method), names the visibility cost, and calls it scaffolding rather than a destination.

**Follow-up:** *Sensing version?* Override the method to *record* into a field, then assert on it — a spy subclass.

---

## Q7. A static call you must fake — what now? (middle)

**Model answer.** A `static` method has no instance to swap, so ordinary substitution can't reach it. Use **Introduce Instance Delegator**: add a non-static method (on the same class or a thin wrapper) that delegates to the static, then call the instance method. Now you depend on an object you can fake — and you'd usually combine it with Extract Interface so the client depends on an interface, not the concrete gateway.

```java
class PaymentGateway {
    static String charge(Card c, Money m) { /* real */ }
    String chargeInstance(Card c, Money m) { return charge(c, m); }  // fakeable
}
```

If you can't edit the static's class, wrap it: a small `Payments` interface with a real impl that calls the static, plus a fake.

**Signal:** names Instance Delegator, pairs it with Extract Interface + injection toward a clean design.

**Follow-up:** *Why is static *state* worse than a static *method*?* Static state is shared across all tests in the process — a source of order-dependent flakiness — so breaking dependencies on it is debt to pay down, not a pattern to adopt.

---

## Q8. Faking a singleton safely? (middle–senior)

**Model answer.** The quick move is **Introduce Static Setter**: give the singleton a test-only setter that installs a fake instance.

```java
static void setInstanceForTest(AuditLog fake) { instance = fake; }
```

But it's high-risk by these standards: it's *mutable global state shared across tests*, so a forgotten reset leaks one test's fake into another and produces order-dependent flakes. To use it safely: make the setter package-private/`@VisibleForTesting` (never public — that leaks into production), and **always reset in teardown**:

```java
@AfterEach void reset() { AuditLog.setInstanceForTest(new AuditLog()); }
```

Treat it as scaffolding. The destination is to *pass the dependency in* (inject it) so the global identity disappears from the design entirely.

**Signal:** flags the flakiness risk, mandates teardown reset, restricts visibility, and names injection as the real fix.

**Follow-up:** *Saw a flaky suite that bisected to a static setter — diagnosis?* A test installed a fake and didn't reset; another test, run after it in some orderings, saw the fake. Fix: reset in a shared base class, then migrate to injection.

---

## Q9. HttpServletRequest is awful to fake — what do you do? (middle–senior)

**Model answer.** Don't mock the fat framework type. Use **Adapt Parameter**: define a small interface *you own* exposing only the fields the logic needs, write a thin adapter wrapping the real type, and change the method to take your interface.

```java
interface CheckoutInput { String cartId(); }
class ServletCheckoutInput implements CheckoutInput {
    private final HttpServletRequest req;
    public ServletCheckoutInput(HttpServletRequest r) { this.req = r; }
    public String cartId() { return req.getParameter("cartId"); }
}
public String handle(CheckoutInput in) { ... }   // tests pass a lambda fake
```

This kills two birds: the logic becomes trivially testable (`CheckoutInput in = () -> "cart-7"`) *and* the design improves because your code now speaks its own vocabulary instead of the framework's. It's the Adapter pattern.

**Signal:** rejects mocking the servlet API, names Adapt Parameter / Adapter, notes the design benefit beyond testability.

**Follow-up:** *Mocking framework over Adapt Parameter — when acceptable?* Rarely — maybe a one-off test where adding an interface isn't worth it. As a default it produces brittle, unreadable `when(...)` chains.

---

## Q10. Which moves are safe without a test? (senior)

**Model answer.** The core tension: you break dependencies to write tests, but you have no test yet to protect the breaking edit. So the first edits must be ones whose correctness the *compiler and IDE* guarantee — behavior-preserving, structure-only moves. Ranked:

- **Very safe:** Extract Interface (IDE-driven, compiler proves references resolve), Extract Method.
- **Safe with discipline:** Parameterize Constructor (keep old ctor delegating), Parameterize Method (add an overload). Break the discipline — change the only signature — and it becomes a breaking change.
- **Moderate:** Break Out Method Object (behavior-preserving but large), Instance Delegator, Subclass and Override (requires widening visibility).
- **Risky:** Introduce Static Setter (adds mutable global test state), Extract-and-Override-Factory (constructor-ordering trap).

The professional move is to *lead with the very-safe edits*, get even one ugly characterization test in as a backstop, then do the riskier edits under that protection.

**Signal:** explicitly states the bootstrap problem and orders moves by compiler-verifiability.

**Follow-up:** *No technique is safely applicable — then what?* Sprout the new behavior into a fresh tested method/class and call it from the legacy code, leaving the tangle for later.

---

## Q11. The constructor-override ordering trap (senior)

**Model answer.** When a base-class constructor calls an overridable method, and a subclass overrides it, the override runs **before the subclass's own fields are initialized**. So Extract-and-Override-Factory-Method (or any override-from-constructor) can read `null` subclass state.

```java
class Base { Base() { this.svc = createService(); } protected Service createService(){...} }
class TestBase extends Base {
    String stub = "cfg";   // NOT assigned yet when Base() runs
    @Override protected Service createService() { return new FakeService(stub); } // stub==null
}
```

Mitigations: keep the overriding factory **self-contained** (don't read subclass state), set the fake *after* construction, or — best — use **Parameterize Constructor** so the value is passed before any virtual dispatch. This trap is a strong argument for plain constructor injection over factory-method overriding.

**Signal:** explains *why* (init order: base ctor before subclass field init), and prefers injection to dodge it.

**Follow-up:** *Same in C#/Kotlin?* Yes — virtual dispatch from a base constructor before derived initialization is common to Java, C#, and Kotlin.

---

## Q12. final/sealed blocks your technique — recover (senior)

**Model answer.** `final`/`sealed` classes can't be subclassed and `final` methods can't be overridden, so Subclass-and-Override, Extract-and-Override, and Pull Up/Push Down are all unavailable for that type. Kotlin/C# make this the *default*. The recovery, in order:

1. **Extract Interface and inject** — needs no subclassing at all; the right answer in a sealed world.
2. **Adapt/wrap** the final type behind your own interface.
3. Only if you control the source and have a real reason, *temporarily* relax `final` — but prefer #1, because relaxing `final` for tests is a design leak and the modifier is often intentional (security, API stability, performance).

```java
final class RateLimiter implements Limiter { public boolean allow() { ... } }
// depend on Limiter; final-ness of RateLimiter no longer blocks the fake.
```

**Signal:** reaches for Extract Interface (no subclassing needed), respects that `final` may be deliberate, treats relaxing it as last resort needing owner sign-off.

**Follow-up:** *Static method you can't subclass around?* Introduce Instance Delegator, then Extract Interface + inject.

---

## Q13. Scaffolding vs. real DI (senior)

**Model answer.** The catalog has two kinds of move. **Destination moves** *are* good design and you keep them: Parameterize Constructor, Extract Interface, Adapt Parameter, Encapsulate Global References — they're Dependency Inversion in miniature. **Scaffolding moves** make the design slightly worse to get tests in, and you remove them later: Subclass-and-Override (test-only subclass), Introduce Static Setter (test hook), relaxing visibility/`final`. After tests exist, you migrate scaffolding → destination:

```
Subclass-and-Override   ─▶ Extract Interface + Parameterize Constructor
Static Setter           ─▶ Inject the dependency; delete the global
Override factory method ─▶ Inject the created object
```

The discipline is: break the dependency to test *today*; let injection be the design *destination*. And don't ship the scaffolding move and its cleanup in the same crunch — get tests in, ship the fix, file the follow-up.

**Signal:** cleanly separates the two categories and names DIP as the destination.

**Follow-up:** *How do you stop scaffolding becoming permanent?* Mark it (`@VisibleForTesting`), file a tracked ticket, and make removal a small separate PR.

---

## Q14. Break Out Method Object — when worth it? (senior)

**Model answer.** When a method is so large that its logic lives in local variables and there's *no smaller testable unit*. You extract the whole method into its own class: parameters become constructor fields, locals become inspectable fields, the body becomes `compute()`. Now intermediate steps are individually testable and collaborators are injectable through the new class's constructor.

```java
class InvoiceCalculation {
    private final Order order; private Money subtotal;   // was a local
    InvoiceCalculation(Order o) { this.order = o; }
    Invoice compute() { computeSubtotal(); ...; }
    void computeSubtotal() { ... }   // now testable
}
// original method: return new InvoiceCalculation(order).compute();
```

It earns its larger cost over "just extract a few methods" when the locals carry state you need to *observe*, or when the method needs its own seams. Do it under any backstop test you can get, leaning on the IDE's Extract refactorings to stay safe.

**Signal:** ties the choice to "locals become observable fields" and "no smaller unit exists."

**Follow-up:** *Refactoring name?* Replace Method with Method Object — see the refactoring catalog.

---

## Q15. Smallest safe step under deadline (staff)

**Model answer.** The governing question: *what is the minimum edit that lets me write the one test I need for this change, that I can make without a test to protect it?* Concretely:

- **Scope to the change, not the class.** Break the one dependency in the path of the ticket; ignore the others.
- **Prefer compiler-verified moves** (Extract Interface, Extract Method) — the only edits you can fully trust on untested code.
- **Keep the production diff near-zero and behavior-neutral** — add a constructor overload, default the new path to the old behavior.
- **Separate the seam commit from the behavior-change commit** (ideally separate PRs), so a reviewer can verify the seam changed nothing and revert the behavior change independently.
- **Write the characterization test immediately**, then make the actual change, then file follow-ups to remove any scaffolding.

If even the minimal step is risky (must widen visibility / add a static setter), **Sprout** the new behavior into fresh tested code instead of forcing a risky break into the tangle.

**Signal:** optimizes for shipping the real change safely, not for ideal design; separates refactor and behavior commits; knows when to sprout instead.

**Follow-up:** *Why separate commits?* Behavior-neutral seam edits are trivially reviewable and safely revertible; mixing logic changes in destroys that property.

---

## Q16. Reviewing a dependency-breaking PR (staff)

**Model answer.** I check, in order:

1. **Did production behavior change?** A "seam-only" PR must be provably behavior-neutral; if it touches logic, it's mislabeled — split it.
2. **Did visibility widen?** Every `private`→`protected` or public test setter is permanent API surface. Justified and minimal?
3. **Is the new interface earning its keep?** One-impl interface with a fake that needs it = fine; without one = interface mania, push back.
4. **Can a test seam run in production?** An overridable factory or setter reachable from a prod path is a latent bug.
5. **Is static/global state reset in teardown?** Otherwise it's a future flake.
6. **Does the sensing fake actually record what's asserted?** A constant-returning override that "passes" may test nothing.
7. **Is the constructor cheap?** It should only assign injected fields.
8. **Are there tests?** A seam with no test is incomplete — the seam was the means, the test is the deliverable.

I also watch **scope**: a "fix tax rounding" PR that extracts six interfaces has lost the plot — smallest safe step applies to reviewers too.

**Signal:** behavior-neutrality, leak detection, interface-mania pushback, teardown discipline, scope control.

**Follow-up:** *Borderline single-impl interface?* Ask: is there a fake that needs it now? If not, test the concrete class directly.

---

## Q17. Over-introducing interfaces — defend the line (staff)

**Model answer.** "Extract an interface to make it testable" becomes harmful when applied reflexively: you get a codebase of single-implementation `IFoo`/`FooImpl` pairs. Costs are concrete — navigation jumps through indirection, "go to implementation" is two steps, and the interface advertises flexibility that doesn't exist, misleading readers. The line I defend: **extract an interface where a fake needs a seam, not as a ritual.** A pure function with no I/O (a mapper, a calculator) should be tested *directly* — the interface buys nothing. I've seen a cleanup delete ~70% of a codebase's interfaces with no loss. Interface Segregation also matters: when you do extract, keep it narrow to what the client uses, not a mirror of the whole class.

**Signal:** distinguishes "seam for a fake" from "abstraction for variation," cites concrete costs, knows pure functions need no interface.

**Follow-up:** *Tension with "program to an interface"?* That principle is about *real* polymorphism and stable abstractions, not about wrapping every class for mockability. A seam is justified by a fake; an abstraction is justified by multiple real implementations or a stable contract.

---

## Q18. Design a sequence for a fully tangled class (staff)

**Model answer.** Take a `ShipmentService.dispatch()` I must change: it builds a `KafkaProducer` in its constructor (heavy, network), calls `Clock.systemUTC()`, calls `static GeoApi.distance(...)`, and reads `FeatureFlags.instance()`. No tests. My sequence, ordered by *safety first, scaffolding last, tests in the middle*:

1. **Extract Interface** `Producer` off `KafkaProducer` — very safe, IDE-driven, compiler-verified. Now fakeable.
2. **Parameterize Constructor** to inject `Producer`, keeping a no-arg ctor that builds the real one — safe, no caller breaks; the heavy constructor work becomes optional in tests.
3. **Parameterize Method** to pass a `Clock` into `dispatch` via an overload — safe; deterministic time.
4. **Introduce Instance Delegator + Extract Interface** for `GeoApi.distance` → a `Geo` interface, injected. Turns the static into a fakeable collaborator.
5. **Introduce Static Setter** for `FeatureFlags` as a *temporary* hook, reset in `@AfterEach` — the one risky move, last, clearly marked for removal.
6. **Write characterization tests** — every dependency is now fakeable.
7. **Refactor toward DI** — replace the `FeatureFlags` setter with injection, drop the no-arg ctor once callers supply dependencies. Arrive at clean Dependency Inversion.

The shape is the lesson: compiler-checked moves first, the single risky move last and temporary, tests in the middle, redesign at the end.

**Signal:** sequences by safety, isolates the one risky move, knows each technique maps to a specific obstacle (internal `new`, clock, static, singleton), and ends at injection.

**Follow-ups:**
- *Why not do the static setter first?* It's the riskiest; do it last, after safer moves and ideally a backstop test, so it's isolated and easy to remove.
- *Deadline cuts you off after step 3?* I've already got the producer and clock fakeable — enough to test and ship the actual change. Steps 4–7 become a tracked follow-up. That's the smallest-safe-step discipline.

---

## Q19. Stub vs. spy vs. mock in a seam (middle–senior)

**Model answer.** Breaking the dependency gets me a seam; *what I put in it* is a separate choice driven by *why* I broke it. A **stub** returns canned answers and asks nothing — right for pure separation, where the collaborator is an input (a clock, a config read, a query result). A **spy** is a stub that also *records* what it received — right for sensing, where I assert on an outcome after the fact (`assertEquals(99, spy.lastCharged)`). A **fake** is a working lightweight implementation (in-memory repo) — right when the collaborator is stateful and the test reads it back. A **mock** is pre-programmed with expectations and fails if the call protocol differs — right only when the *interaction itself* is the contract ("publishes exactly once on success").

```java
// Spy: assert the OUTCOME — survives harmless internal refactoring.
assertEquals(money, spyGateway.lastCharged);
// Mock: assert the HOW — breaks if you reorder internal calls.
verify(gateway).charge(card, money);
```

The senior signal is *under*-using mocks: a mock couples the test to *how* the code calls collaborators, so a harmless refactor turns it red. I prefer a spy asserting on the result over a mock asserting on the call shape, unless the call shape genuinely is the behavior under test.

**Signal:** matches substitute to the reason (separation→stub/fake, sensing→spy, protocol→mock), and warns that mocks over-couple tests to implementation.

**Follow-up:** *Which techniques constrain the choice?* Object-yielding moves (Extract Interface, Adapt Parameter, Instance Delegator) let me pick any substitute; method-yielding moves (Subclass-and-Override) naturally give a hand-rolled stub or spy — usually fine.

---

## Q20. Does the catalog change in C++ or Python? (senior)

**Model answer.** The spirit is universal — introduce a seam to substitute a fake — but the cheap seam differs by language. In **C++** the linker and compiler are themselves seams: *Definition Completion* substitutes your own definition of a declared-elsewhere function in the test binary, *Replace Function with Function Pointer* repoints a call, and templates give a *compile-time* seam — a class templated on its collaborator type instantiates with a fake type, no interface or vtable needed (`Scheduler<FakeClock>`). In **Python/Ruby**, duck typing means I rarely Extract Interface — any object with the right methods is a valid fake; the dominant move is Parameterize with the global as a default, plus `unittest.mock.patch` to monkeypatch a name, which must be scoped or it leaks across tests. In **Kotlin/C#**, `final`/`sealed`-by-default deletes subclass-based moves up front, so Extract Interface + injection is the *normal* path, not a fallback — and adding `open` "just for tests" is the same design leak as relaxing `final` in Java.

**Signal:** knows the seam model is language-specific (link/compile-time in C++, namespace patching in Python, interface+injection by default in `final`-first languages), not a fixed list of Java moves.

**Follow-up:** *Why prefer templates over an interface in C++ when you can?* No runtime dispatch cost and the substitution is checked at compile time — though it bloats compile times and can't vary at runtime.

---

## Q21. When would you *not* break the dependency? (staff)

**Model answer.** Breaking a dependency is a cost, so I skip it when a cheaper path gives trustworthy coverage. Cases: (1) the collaborator is already fast, deterministic, and harmless — a pure calculator — so I use the real one; faking it adds indirection and proves nothing. (2) A fast integration test (Testcontainers, embedded DB/broker) already exercises the path acceptably — I add an assertion there rather than seam the class. (3) The module is slated for deletion or rewrite — I pin its behavior with a black-box characterization test at the edge and leave the internals. (4) Reaching the dependency would require a riskier edit than the change itself (relaxing a `sealed` modifier the security team owns) — I Sprout the new behavior into fresh tested code instead. The goal is coverage of the change I'm shipping, not a maximally seamed class.

**Signal:** treats seams as a cost-benefit decision, knows higher-level tests can substitute, and won't invest in doomed code.

**Follow-up:** *How do you decide the level to break at?* Low (Subclass-and-Override) is fast but couples to internals; high (injected interface at the module boundary) is durable but a larger edit. Under deadline I break at the level the one test I need requires, and note the higher-level seam as the destination.
