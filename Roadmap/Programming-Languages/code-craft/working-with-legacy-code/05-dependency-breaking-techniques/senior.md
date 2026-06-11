# Dependency-Breaking Techniques — Senior Level

## Table of Contents

- [The senior framing](#the-senior-framing)
- [Safety: which moves change behavior, which don't](#safety-which-moves-change-behavior-which-dont)
- [The "I can't even get the seam in" bootstrap problem](#the-i-cant-even-get-the-seam-in-bootstrap-problem)
- [Order of application](#order-of-application)
- [Language constraints that block techniques](#language-constraints-that-block-techniques)
  - [final and sealed](#final-and-sealed)
  - [static methods and static state](#static-methods-and-static-state)
  - [global state and singletons](#global-state-and-singletons)
  - [constructors that do real work](#constructors-that-do-real-work)
- [The constructor-override ordering trap](#the-constructor-override-ordering-trap)
- [Scaffolding vs. destination: from dependency break to real DI](#scaffolding-vs-destination-from-dependency-break-to-real-di)
- [Sensing vs. separation drives the choice](#sensing-vs-separation-drives-the-choice)
- [Choosing the fake: stub, spy, fake, or mock](#choosing-the-fake-stub-spy-fake-or-mock)
- [Cross-language notes: where the catalog bends](#cross-language-notes-where-the-catalog-bends)
- [Smells in the seam itself](#smells-in-the-seam-itself)
- [A worked decision on a real-ish class](#a-worked-decision-on-a-real-ish-class)
- [Related Topics](#related-topics)

---

## The senior framing

At junior and middle level the question is "which technique matches this obstacle?" At senior level the questions are different and harder:

- **Is this move *safe*?** Can I make it without a test (because I don't have one yet), or does it risk changing behavior?
- **What's the right *order*?** Some moves only become available after others.
- **What does the *language* permit?** `final`, `sealed`, `static`, value types, and module visibility quietly delete techniques from your menu.
- **Is this scaffolding or the destination?** Which moves do I keep, and which do I tear out once tests exist?

The deep point of the whole catalog is this chicken-and-egg: *you break dependencies to write tests, but you have no tests yet to protect the dependency-breaking edit itself.* So your first edits must be ones you can trust without a safety net — mechanical, structure-preserving moves that the compiler and IDE verify. Everything else flows from that constraint.

> **Key idea:** The first dependency-breaking edit is the most dangerous one, because it is the only one you make with zero test coverage. Choose a move whose correctness the compiler can guarantee.

---

## Safety: which moves change behavior, which don't

Feathers distinguishes edits you can make *safely without tests* (mechanical, refactoring-tool-assisted, structure-only) from edits that can alter behavior and therefore want a test first — except you can't have one yet. Rank the catalog by this:

| Technique | Behavior-preserving? | Tool-supported? | Safety without tests |
|-----------|---------------------|-----------------|----------------------|
| Extract Interface | Yes (adds a type, redirects references) | Yes (IDE) | **Very safe** |
| Parameterize Constructor | Yes, if you keep the old ctor delegating | Partly | **Safe** |
| Parameterize Method | Yes, if you add an overload | Partly | **Safe** |
| Adapt Parameter | Mostly (adds interface + adapter) | Partly | **Safe-ish** |
| Extract and Override Call | Extraction is mechanical; the *override* is test-only | Yes (extract method) | **Safe** (the extraction); the seam is inert in prod |
| Break Out Method Object | Behavior-preserving but large | Yes (extract) | **Moderate** — many small mechanical steps |
| Introduce Instance Delegator | Adds a method; call sites change | Partly | **Moderate** |
| Subclass and Override Method | Prod unchanged except access modifier | No | **Moderate** — relies on widening visibility |
| Extract and Override Factory Method | Moves construction; ordering trap | No | **Moderate–risky** |
| Encapsulate Global References | Behavior-preserving but wide blast radius | Partly | **Moderate** |
| Introduce Static Setter | Adds mutable global test hook | No | **Risky** — easy to introduce test interdependence |

How to read this table operationally:

- **Lead with the "very safe" moves.** Extract Interface is the canonical first edit: an IDE performs it, the compiler confirms every reference still resolves, and behavior cannot change because you only *added* a type and *renamed references to it*. You can do this with full confidence on untested code.
- **The "safe" moves are safe *because of a discipline*** — keeping the old constructor delegating, adding an overload rather than changing a signature. Break the discipline (change the only constructor's signature) and you turn a safe move into a breaking change for every caller.
- **The "risky" moves buy speed by adding test-only state or visibility.** Use them when nothing safer reaches the dependency, and earmark them for removal.

A subtlety: "behavior-preserving" is about *production* behavior. Subclass and Override is behavior-preserving in production (the prod object never instantiates your test subclass), yet it required widening a method's visibility — a *design* change with a real cost even though runtime behavior is identical.

---

## The "I can't even get the seam in" bootstrap problem

Sometimes the method you want to test is so tangled that you cannot apply *any* technique without first doing some edit you can't verify. The senior tactic is to find the **safest tiny edit that the compiler proves correct**, then build from there:

1. **Lean on the compiler as a test.** Rename a field, extract a method, extract an interface — if it compiles and the IDE did it, behavior is preserved. These "leaning on the compiler" moves are your only safety net before tests exist.
2. **Sprout / Wrap if you can't even open the method.** If you need *new* behavior in an untestable method, write the new logic in a fresh, fully-tested method or class (a "Sprout Method"/"Sprout Class") and call it from the legacy method. You add tested code without first untangling the old code. (Covered as part of [`../02-the-legacy-change-algorithm/`](../02-the-legacy-change-algorithm/).)
3. **Get *one* characterization test in any way possible**, even an ugly end-to-end one, then use it to protect the more invasive dependency breaks.

> **Key idea:** When no technique is safely applicable, don't force one. Either lean on a compiler-verified micro-edit, or sprout the new code beside the old code and leave the tangle for later.

---

## Order of application

Techniques compose, and order matters because each can *enable* the next. A common, reliable progression:

```
  (1) Extract Interface            ← very safe, compiler-checked, makes the type fakeable
        │
        ▼
  (2) Introduce Instance Delegator ← only needed if the call was static
        │   (turns a static call into an instance call on the new type)
        ▼
  (3) Parameterize Constructor     ← inject the now-fakeable interface
        │
        ▼
  (4) write characterization tests ← you finally have a seam + a fake
        │
        ▼
  (5) refactor toward real DI       ← delete scaffolding, clean the design
```

Heuristics for ordering:

- **Safest first.** Do compiler-verified moves (Extract Interface, Extract Method) before any move that widens visibility or adds state. You want the riskier edits to happen *after* you have at least a thin characterization test.
- **Type-shaping before wiring.** Make the dependency *fakeable* (Extract Interface, Adapt Parameter, Instance Delegator) before you change how it's *supplied* (Parameterize Constructor). Wiring a concrete type you still can't fake gains nothing.
- **Localized before global.** Prefer breaking the *one* dependency blocking *this* test over a sweeping Encapsulate-Global-References across the module. Scope creep here is how a "small fix" becomes a two-week refactor.
- **Scaffolding last and reversible.** If you must use Subclass-and-Override or a Static Setter, add it last, isolated, and obviously temporary, so removing it later is a local change.

---

## Language constraints that block techniques

Half of seniority here is knowing which technique the language *won't let you use*, and what to do instead.

### final and sealed

In Java a `final` class can't be subclassed and a `final` method can't be overridden, so **Subclass and Override Method**, **Extract and Override Call/Factory**, and **Pull Up/Push Down** are all off the table for that type. Kotlin makes classes and methods `final` *by default*; C# `sealed` and `record` do similar; C++ `final` likewise.

Workarounds, in preference order:

1. **Extract Interface** and inject — does not require subclassing at all. The right answer in a `final`/`sealed` world.
2. **Adapt Parameter / wrap** the final type behind your own interface.
3. If you control the source and have a justified reason, *temporarily* relax `final` to apply an override-based move — but prefer #1, because relaxing `final` for tests is a design leak.

```java
// final class blocks Subclass-and-Override:
final class RateLimiter { boolean allow() { /* real */ } }

// Solution: depend on an interface, not the final class.
interface Limiter { boolean allow(); }
final class RateLimiter implements Limiter { public boolean allow() { ... } }
// test fakes Limiter; the final-ness of RateLimiter no longer matters.
```

### static methods and static state

A `static` method has no instance to substitute, so ordinary fakes can't reach it. **Introduce Instance Delegator** is the standard answer: wrap the static behind an instance method, then Extract Interface + inject.

The deeper problem is `static` *state* — a static field mutated at runtime is shared across every test in the JVM, producing order-dependent, flaky tests. Breaking dependencies *on* static state (Encapsulate Global References, Introduce Static Setter) is doable but should be treated as paying down a debt, not a permanent pattern.

```python
# Python: a module-level singleton read directly is global state.
# settings.py
CLIENT = RealClient()           # global

# Test-hostile usage:
def charge(amount): return CLIENT.charge(amount)

# Break it: inject, with the global as the default.
def charge(amount, client=None):
    client = client or CLIENT   # seam: tests pass a fake; prod uses the global
    return client.charge(amount)
```

### global state and singletons

Singletons compound the static problem with *initialization* coupling: the global is created once and lives for the process. The swap-via-setter trick (**Introduce Static Setter**) works but must be reset in teardown, or one test's fake leaks into the next. The senior stance: use the setter to *get tests in*, then refactor the singleton to be *passed in* so the global identity disappears from the design entirely.

### constructors that do real work

A constructor that opens connections, reads files, or spins threads makes a class un-instantiable in a test no matter how good your other seams are. This is why **constructor-injected dependencies** beat **constructor-constructed** ones: the whole point is to keep the constructor cheap and side-effect-free. If you inherit a heavy constructor, **Extract and Override Factory Method** can move the heavy creation into an overridable method so a test subclass skips it — at the cost of the ordering trap below.

> **Key idea:** Most "untestable" classes are untestable because their constructor does work. The cheapest long-term fix is to make constructors do nothing but assign injected fields.

---

## The constructor-override ordering trap

**Extract and Override Factory Method** and any technique that calls an overridable method *from a constructor* hit a JVM/CLR initialization-order hazard. When a base-class constructor calls an overridden method, the subclass override runs **before the subclass's fields are initialized**:

```java
class Base {
    private final Service service;
    Base() {
        this.service = createService();   // calls the OVERRIDE during base ctor
    }
    protected Service createService() { return new RealService(); }
}

class TestBase extends Base {
    private final String stub = "fake-config";   // NOT yet assigned when ctor runs!
    @Override protected Service createService() {
        return new FakeService(stub);   // stub is still null here → NPE / wrong value
    }
}
```

When `new TestBase()` runs, `Base()` executes first and calls `createService()`, which dispatches to `TestBase.createService()` — but `TestBase`'s field initializers haven't run, so `stub` is `null`. C#, Java, and Kotlin all behave this way.

Mitigations:

- Keep the overriding factory method **self-contained** — it must not read subclass state.
- Prefer setting the fake *after* construction via a setter, or use **Parameterize Constructor** so the value is passed in before any virtual dispatch.
- This trap is a strong argument for plain constructor injection over factory-method overriding whenever you have the choice.

---

## Scaffolding vs. destination: from dependency break to real DI

The catalog contains two kinds of move that are easy to confuse:

| "Destination" moves (keep them) | "Scaffolding" moves (remove them) |
|--------------------------------|-----------------------------------|
| Parameterize Constructor | Subclass and Override Method (test-only subclass) |
| Extract Interface | Introduce Static Setter (test hook) |
| Adapt Parameter | Extract and Override (test-only override point) |
| Encapsulate Global References | Relaxing `final`/visibility "just for tests" |

The destination moves *are* Dependency Inversion in miniature: depend on an abstraction, have it supplied from outside. After tests exist, your job is to migrate the scaffolding moves toward destination moves:

```
  Subclass-and-Override   ──refactor──▶  Extract Interface + Parameterize Constructor
  Static Setter           ──refactor──▶  Inject the dependency; delete the global
  Override factory method ──refactor──▶  Inject the created object directly
```

This is exactly the Dependency Inversion Principle (see [`../../design-principles/`](../../design-principles/)) and the Factory/Adapter patterns made concrete (see [`../../design-patterns/`](../../design-patterns/)). The dependency-breaking techniques are how you *get there* on code that wasn't built for it.

> **Key idea:** A dependency-breaking technique answers "how do I test this *today*." Dependency injection answers "how should this be *designed*." Use the first to earn the right to do the second.

A caution that becomes more important the more senior you are: **don't over-introduce interfaces.** Extracting an interface for every class to enable a fake produces a codebase of one-implementation interfaces — "interface mania" — that adds indirection without abstraction. Extract an interface where you *need a seam*, not reflexively. The same goes for leaking test seams (`protected` hooks, static setters) into the production API: each one is a public promise you didn't mean to make.

---

## Sensing vs. separation drives the choice

The *reason* you're breaking the dependency narrows the technique:

- **Pure separation** (just get the code to run): you need a fake that *does nothing harmful and returns plausible values*. Cheap moves win — Subclass-and-Override returning a constant, or a stub interface. You don't need to record anything.
- **Sensing** (observe an effect): your fake must *record*, so you need a real substitutable object — Extract Interface + a recording fake, or an Instance Delegator you can spy on. A constant-returning override won't do; you must capture the call.

```java
// Separation: neutralize, return anything plausible.
@Override protected String chargeCard(Card c, Money m) { return "X"; }

// Sensing: must capture what happened.
class SpyHandler extends CheckoutHandler {
    Money charged;
    @Override protected String chargeCard(Card c, Money m) {
        this.charged = m;        // record for the assertion
        return "X";
    }
}
```

If you need *both* (run the code *and* verify it charged the right amount), you need a sensing-capable seam — which usually means an interface + recording fake rather than a quick constant override.

---

## Choosing the fake: stub, spy, fake, or mock

The dependency-breaking *move* gets you a seam; the *thing you put in the seam* is a separate decision, and getting it wrong is how seams that should have helped instead produce brittle or vacuous tests. Four kinds, ordered by how much they couple the test to implementation:

| Substitute | What it does | Couples test to | Use when |
|------------|--------------|-----------------|----------|
| **Stub** | Returns canned answers; asks nothing | Return values only | Pure *separation* — the collaborator is an *input* (a clock, a config read, a query result). |
| **Spy** | A stub that also *records* what it received | Inputs + which calls happened | *Sensing* an output you assert on after the fact (`assertEquals(99, spy.chargedAmount)`). |
| **Fake** | A working but lightweight implementation (in-memory repo, hash-map cache) | Behavior, not call shape | The collaborator is stateful and the test reads it back (save then load). |
| **Mock** | Pre-programmed with *expectations*; fails if the protocol differs | The exact call sequence/arguments | The interaction *is* the behavior under test (e.g. "publishes exactly once on success"). |

> **Key idea:** Match the substitute to *why* you broke the dependency. Separation → stub or fake. Sensing → spy. Verifying a protocol → mock. Reaching for a mock when a stub would do is the most common way a good seam produces a bad test.

Seniority shows in *under*-using mocks. A mock asserts on *how* the code calls its collaborator; refactor the internals harmlessly and the mock-based test goes red even though behavior is unchanged. Prefer a spy that lets you assert on the *outcome* (what was charged) over a mock that asserts on the *call shape* (that `charge` was invoked with these exact arguments in this order) unless the call shape genuinely is the contract.

```java
// Over-coupled (mock): breaks if you reorder harmless internal calls.
verify(gateway).charge(card, money);          // asserts the HOW

// Looser (spy): asserts the WHAT — survives internal refactoring.
assertEquals(money, spyGateway.lastCharged);  // asserts the OUTCOME
```

A practical corollary for the catalog: techniques that yield a real substitutable *object* (Extract Interface, Adapt Parameter, Instance Delegator) let you choose any of the four substitutes freely. Techniques that yield only an *overridable method* (Subclass-and-Override, Extract-and-Override) naturally give you a stub or spy and make full mock frameworks awkward — which is usually fine, because a hand-rolled spy is often the better choice anyway.

---

## Cross-language notes: where the catalog bends

Feathers' catalog is shaped by static, class-based languages; the *spirit* is universal but the *moves* change with the language's seam model.

**C++.** The compiler/linker is itself a seam. *Definition Completion* and *Replace Function with Function Pointer* exist precisely because you can substitute at link time: provide your own definition of a declared-but-defined-elsewhere function in the test binary, or `#include` a different header. Templates add a *compile-time* seam — a class templated on its collaborator type can be instantiated with a fake type, no virtual dispatch needed:

```cpp
// Compile-time seam: the collaborator is a template parameter.
template <class Clock>
class Scheduler {
    Clock clock_;                 // real Clock in prod, FakeClock in test
public:
    bool isDue(Task t) { return t.deadline() < clock_.now(); }
};
// prod:  Scheduler<SystemClock> s;
// test:  Scheduler<FakeClock>   s;   // no interface, no vtable
```

**Python / Ruby (dynamic).** Duck typing means you rarely need Extract Interface — any object with the right methods is a valid fake. The dominant move is *Parameterize* (constructor or method) with the global as a default, plus `unittest.mock.patch` to monkeypatch a name in a module's namespace. The hazard mirrors Java's static state: `patch` mutates a global name and *must* be scoped (context manager / decorator) or it leaks across tests.

```python
def charge(amount, gateway=None):       # parameterize; global is the default
    gateway = gateway or DEFAULT_GATEWAY
    return gateway.charge(amount)
# test: charge(99, FakeGateway())  — any duck-typed object works, no interface
```

**Kotlin / C# / Scala.** `final`/`sealed`-by-default (Kotlin) and `sealed` (C#) delete the subclass-based moves *by default*, pushing you toward Extract Interface + injection as the *normal* path rather than a fallback. Kotlin's `open` keyword is the explicit opt-in to a subclass seam; needing to add `open` "just for tests" is the same design leak as relaxing `final` in Java, and the `all-open` compiler plugin (used for Spring) is essentially institutionalized seam-opening.

> **Key idea:** The technique you reach for is a function of the language's seam model — link-time and compile-time in C++, namespace patching in Python, interface+injection by default in `final`-by-default languages. Learn the seam your language gives you cheaply, and prefer it.

---

## Smells in the seam itself

A seam can be technically correct and still be a liability. Watch for these:

- **The seam that lies.** An overridable method whose default does real work *and* is reachable in production is a behavior fork waiting to happen. If a production subclass overrides it differently than you assumed, you've introduced a bug the test can't see.
- **The widening that escapes.** A method made `protected` to enable an override becomes part of your inheritance contract; in a published library, external subclasses can now depend on it. The seam outlived its purpose and became API.
- **The recording fake nobody asserts on.** A spy that records but whose field is never asserted is a sensing seam with no sensing — pure cost.
- **The interface that mirrors the class.** Extracting a wide interface (every public method) instead of a *client-specific* narrow one re-couples every fake to the whole surface, defeating Interface Segregation.

The senior discipline is to keep the seam *as small and as private as the test mechanism allows*, and to revisit it after tests exist — widening you needed for the first test is often removable once injection replaces the override.

---

## A worked decision on a real-ish class

Take a `ShipmentService` whose `dispatch()` you must change. It: constructs a `KafkaProducer` in its constructor (heavy, network), calls `Clock.systemUTC()`, calls a `static GeoApi.distance(...)`, and reads `FeatureFlags.instance()`. You have no tests.

Sequenced senior plan:

1. **Extract Interface** `Producer` off `KafkaProducer` — *very safe*, IDE-driven, compiler-verified. Now it's fakeable.
2. **Parameterize Constructor** to inject `Producer`, keeping a no-arg constructor that builds the real `KafkaProducer` — *safe*, no caller breaks. The heavy constructor work is now optional in tests.
3. **Parameterize Method** to pass a `Clock` into `dispatch` (overload) — *safe*; deterministic time.
4. **Introduce Instance Delegator** + **Extract Interface** for `GeoApi.distance` → a `Geo` interface, injected. Turns the static into a fakeable collaborator.
5. **Introduce Static Setter** for `FeatureFlags` as a *temporary* hook, reset in `@AfterEach` — *risky*, flagged for removal.
6. Write characterization tests now that every dependency is fakeable.
7. Refactor: replace the `FeatureFlags` static setter with proper injection; delete the no-arg constructor once all callers pass dependencies; you've arrived at clean DI.

Notice the shape: **safe, compiler-checked moves first; the one risky move last and clearly temporary; tests in the middle; redesign at the end.**

---

## Related Topics

- [`../02-the-legacy-change-algorithm/`](../02-the-legacy-change-algorithm/) — the loop that places dependency-breaking as step three; Sprout/Wrap for when you can't even get a seam in.
- [`../03-seams-and-enabling-points/`](../03-seams-and-enabling-points/) — the theory of seams; every technique here is a seam-creation tactic.
- [`../04-characterization-tests/`](../04-characterization-tests/) — what you write the moment a seam exists; the payoff for breaking the dependency.
- [`../../design-principles/`](../../design-principles/) — Dependency Inversion and Interface Segregation; the *destination* these techniques scaffold toward.
- [`../../design-patterns/`](../../design-patterns/) — Adapter (Adapt Parameter), Factory Method (Extract and Override Factory), and the patterns the clean refactor lands on.
- [`../../refactoring/`](../../refactoring/) — Replace Method with Method Object, Extract Method, and the catalog of behavior-preserving moves you lean on as your "compiler-as-test" safety net.
