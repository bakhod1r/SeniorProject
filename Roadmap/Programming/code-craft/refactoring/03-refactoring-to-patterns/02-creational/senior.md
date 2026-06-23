# Refactoring Toward Creational Patterns — Senior Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/creational-patterns](https://refactoring.guru/design-patterns/creational-patterns)

At this level the question is no longer "which refactoring names this object's creation?" but "how do families of creation evolve, how do they interact with the container that already wires my application, and how do I keep all of this from metastasizing into a forest of single-method factory classes?" We cover:

1. [From scattered factories to a factory hierarchy](#1-from-scattered-factories-to-a-factory-hierarchy)
2. [Arriving at Abstract Factory by refactoring](#2-arriving-at-abstract-factory-by-refactoring)
3. [Creation in the presence of a DI container](#3-creation-in-the-presence-of-a-di-container)
4. [Testing seams created by factories](#4-testing-seams-created-by-factories)
5. [Avoiding factory sprawl](#5-avoiding-factory-sprawl)
6. [Prototype: refactoring toward clone-based creation](#6-prototype-refactoring-toward-clone-based-creation)
7. [Next](#7-next)

---

## 1. From scattered factories to a factory hierarchy

A single Simple Factory (`create(kind)` switching over an enum) is fine until a *second axis of variation* appears. The classic giveaway: your factory's `switch` is duplicated by a *parallel* `switch` somewhere else, both keyed on the same discriminator.

```java
class WidgetFactory {
    Button  createButton(Theme t)  { return t == DARK ? new DarkButton()  : new LightButton(); }
    Slider  createSlider(Theme t)  { return t == DARK ? new DarkSlider()  : new LightSlider(); }
    Menu    createMenu(Theme t)    { return t == DARK ? new DarkMenu()    : new LightMenu();   }
}
```

Every method repeats `t == DARK ? ... : ...`. The discriminator (`Theme`) appears in three places; adding a `HighContrast` theme means editing all three. The duplicated branching is the smell. The fix is to lift the discriminator into a *type*: one factory per theme.

---

## 2. Arriving at Abstract Factory by refactoring

### Starting smell

A factory whose every method branches on the same discriminator (above), or — equivalently — clients that must keep a *consistent family* of objects together (all-dark or all-light, never mixed) but nothing enforces it.

### Motivation

[Abstract Factory](../../../design-patterns/01-creational/02-abstract-factory/junior.md) makes the *family* a first-class object. Each concrete factory produces a coherent set of products; choosing the factory once chooses the whole family, and the type system prevents mixing a `DarkButton` with a `LightSlider`. You don't design this up front — you arrive by removing the duplicated discriminator.

### Mechanical steps

1. **Extract an interface** from the existing factory that lists the creation methods *without* the discriminator parameter: `Button createButton()`, `Slider createSlider()`, `Menu createMenu()`.
2. **Create one implementation per discriminator value** (`DarkWidgetFactory`, `LightWidgetFactory`), each hard-coding its family. Run tests.
3. **Move the `switch` on the discriminator up to the composition root** — the single place that decides which factory to instantiate (`Theme.DARK -> new DarkWidgetFactory()`).
4. **Inject the chosen `WidgetFactory`** into clients; they call `factory.createButton()` with no theme argument, structurally unable to mix families.
5. Delete the old parameterized factory once unused.

### After

```java
interface WidgetFactory {                 // the abstraction (step 1)
    Button createButton();
    Slider createSlider();
    Menu   createMenu();
}

class DarkWidgetFactory implements WidgetFactory {   // a coherent family (step 2)
    public Button createButton() { return new DarkButton(); }
    public Slider createSlider() { return new DarkSlider(); }
    public Menu   createMenu()   { return new DarkMenu();   }
}
class LightWidgetFactory implements WidgetFactory { /* light family */ }

// Composition root (step 3) — the ONE remaining switch:
WidgetFactory factory = switch (theme) {
    case DARK  -> new DarkWidgetFactory();
    case LIGHT -> new LightWidgetFactory();
};

// Client (step 4) — no discriminator, can't mix families:
class Toolbar {
    private final WidgetFactory factory;
    Toolbar(WidgetFactory factory) { this.factory = factory; }
    void render() { factory.createButton(); factory.createSlider(); }
}
```

The discriminator now exists in exactly **one** place. Adding `HighContrast` means adding *one* new factory class — Open/Closed in action ([OCP](../../../design-principles/04-solid/02-ocp-open-closed/junior.md)).

### When NOT to

- If you have **one** product type, you want Factory Method, not Abstract Factory. Abstract Factory earns its weight only when *several* products must vary *together* as a family.
- If families don't actually need to stay consistent — mixing is legal — Abstract Factory's main benefit (type-enforced coherence) is wasted; a Simple Factory is lighter.

---

## 3. Creation in the presence of a DI container

Once a Spring/Guice/Dagger container is in play, a real tension emerges: the container is *itself* a factory. When does a hand-written factory still belong?

The container excels at **singleton-ish, configuration-time wiring** — "there is one `PricingEngine`, built from these beans, injected wherever needed." If your *Move Creation Knowledge to Factory* ([middle.md](./middle.md)) result just picks one implementation at startup, you usually don't need a bespoke factory class — express it as a container `@Bean`/`@Provides` method:

```java
@Configuration
class PricingConfig {
    @Bean
    PricingEngine pricingEngine(Config config) {        // the container IS the factory
        return switch (config.region()) {
            case "EU" -> new EuPricingEngine(config.vatTable(), config.currency());
            case "US" -> new UsPricingEngine(config.taxRates());
            default   -> new DefaultPricingEngine();
        };
    }
}
```

A hand-written factory still earns its place when:

- **Runtime, per-call creation** is needed (one object *per request/message/row*), with arguments only known at call time. Inject a factory interface or a `Provider<T>` / `ObjectProvider<T>` (Spring) / `Provider<T>` (Guice), not the product. Guice's **assisted injection** (`@AssistedInject`) exists precisely for "container builds the wired parts, caller supplies the runtime parts."
- **The selection logic is domain logic** you want to unit-test without a container spun up.
- You want to **keep the container out of the domain layer** — a clean-architecture concern. The factory is a domain abstraction; the container implements it in the outer layer.

The anti-pattern to avoid: injecting the container itself (`ApplicationContext.getBean(...)`) into domain code — *service locator*. It hides dependencies and defeats the testability you refactored to gain.

---

## 4. Testing seams created by factories

The under-appreciated payoff of pulling `new` into a factory is the **testing seam** it opens. A class that does `new EmailClient()` internally cannot be tested without sending email. The same class that *receives* a factory (or the product) can be handed a fake.

```java
class SubscriptionService {
    private final NotifierFactory notifiers;   // seam
    SubscriptionService(NotifierFactory notifiers) { this.notifiers = notifiers; }

    void onSignup(User u) {
        Notifier n = notifiers.forChannel(u.preferredChannel());
        n.send(u, "Welcome");
    }
}

// Test: no real email/SMS, full control:
@Test void sends_via_preferred_channel() {
    RecordingNotifier fake = new RecordingNotifier();
    NotifierFactory stub = channel -> fake;          // lambda factory
    new SubscriptionService(stub).onSignup(userPreferring(SMS));
    assertEquals(1, fake.sentCount());
}
```

Two seam-design principles:

- **Inject the smallest thing that gives control.** If the consumer needs the product once, inject the *product*; if it needs to create per-call, inject the *factory*. Don't inject a factory "just in case" — that is needless indirection.
- **Prefer functional-interface factories** (`Supplier<T>`, `Function<K,V>`, a one-method interface) over heavyweight factory classes in test-driven designs. A lambda is the cheapest possible stub, as above.

For the *Factory Method* refactoring ([junior.md](./junior.md)), the seam is a **protected creation method** you override in a test subclass to return a stub product — the "Subclass to Test" technique. Useful, but inject-a-collaborator is usually cleaner.

---

## 5. Avoiding factory sprawl

Creational refactoring has a failure mode: applied reflexively, it breeds a class hierarchy of trivial factories — `FooFactory`, `BarFactory`, `BazFactory`, each with a single `create()` that just calls `new`. This is *speculative generality* and it makes the codebase harder to navigate, not easier. Guardrails:

- **A factory must pay rent.** It earns its existence by hiding a *choice* (multiple impls), *complexity* (multi-step assembly), or *a seam* (testability). A factory that wraps a single bare `new` with no branching pays no rent — inline it.
- **Prefer a static factory method on the product** over a separate factory class until a second product or real branching appears. `User.guest()` beats a `UserFactory` with one method.
- **Prefer the DI container's wiring** over bespoke factory classes for startup-time selection (§3).
- **Use `Supplier<T>` / `Function<>` instead of a named factory interface** when the factory has one method and no identity worth naming.
- **Collapse parallel single-method factories into an Abstract Factory** only when they vary *together* (§2). If they don't, they were never a family — keep them separate or inline them.

The meta-rule: refactoring *toward* a pattern and refactoring *away* from one are the same skill. If a factory stops paying rent, the right move is to *remove* it — foreshadowing [refactoring away from patterns](../05-refactoring-away-from-patterns/junior.md), of which **Inline Singleton** is the headline case.

---

## 6. Prototype: refactoring toward clone-based creation

### Starting smell

Constructing an object from scratch is *expensive* (heavy parsing, network/DB calls, deep computed defaults), yet you need many objects that differ from a baseline only slightly. Code re-runs the costly construction each time, or — worse — clients reconstruct a complex template by hand and drift out of sync.

```java
// Each call re-parses a 2MB template and re-queries default rules.
GameLevel base = new GameLevel(parseTemplate("level.tmx"), loadDefaultRules());
GameLevel hard = new GameLevel(parseTemplate("level.tmx"), loadDefaultRules());
hard.setEnemyMultiplier(3);
```

### Motivation

[Prototype](../../../design-patterns/01-creational/04-prototype/junior.md) builds the expensive baseline **once**, then produces variants by *copying* it and tweaking — turning O(n) costly constructions into one construction plus n cheap clones.

### Mechanical steps

1. **Build the expensive baseline once** and hold it as a prototype instance.
2. **Add a copy operation** — a copy constructor `GameLevel(GameLevel other)` or a well-defined `copy()`. *Be explicit about deep vs shallow*: clone mutable nested state you intend to vary; share immutable parts.
3. **Replace from-scratch construction at variant sites with `prototype.copy()`** followed by the small mutation. Run tests.
4. **Verify isolation**: mutating a clone must not affect the prototype or its siblings (the classic shallow-copy bug — see [find-bug.md](./find-bug.md)).

### After

```java
final class GameLevel {
    private final Tilemap map;          // large, immutable → safe to share
    private Ruleset rules;              // mutable → must be copied
    private int enemyMultiplier = 1;

    GameLevel(Tilemap map, Ruleset rules) { this.map = map; this.rules = rules; }

    GameLevel(GameLevel other) {                    // copy constructor (step 2)
        this.map = other.map;                       // share immutable
        this.rules = other.rules.copy();            // deep-copy mutable
        this.enemyMultiplier = other.enemyMultiplier;
    }
    GameLevel copy() { return new GameLevel(this); }
}

GameLevel base = new GameLevel(parseTemplate("level.tmx"), loadDefaultRules()); // once
GameLevel hard = base.copy(); hard.setEnemyMultiplier(3);                        // cheap
```

In Java, prefer a **copy constructor or copy factory** over implementing `Cloneable`/`clone()`, whose contract is famously broken (*Effective Java* Item 13). The pattern is "Prototype"; the idiomatic Java mechanism is the copy constructor.

### When NOT to

- If construction is **cheap**, Prototype adds copy-correctness risk for no speed gain.
- If the object graph has **shared mutable state with unclear ownership**, getting deep/shallow copy right is error-prone; a Builder that re-assembles deterministically may be safer than a clone.
- Prototype trades a construction bug for a *copy* bug. Only adopt it when the construction cost is measured, not assumed.

---

## 7. Next

- [junior.md](./junior.md) · [middle.md](./middle.md) — the foundational and construction-complexity refactorings.
- [professional.md](./professional.md) — pooling vs factories, allocation cost, Singleton's hidden costs, thread-safe lazy init, Spring/Guice lifecycle realities.
- [interview.md](./interview.md) · [tasks.md](./tasks.md) · [find-bug.md](./find-bug.md) · [optimize.md](./optimize.md)
- Patterns: [Abstract Factory](../../../design-patterns/01-creational/02-abstract-factory/junior.md) · [Prototype](../../../design-patterns/01-creational/04-prototype/junior.md) · [Singleton](../../../design-patterns/01-creational/05-singleton/junior.md)
- Principles: [OCP](../../../design-principles/04-solid/02-ocp-open-closed/junior.md) · [DIP](../../../design-principles/04-solid/05-dip-dependency-inversion/junior.md)
