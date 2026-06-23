# Abstract Factory — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/abstract-factory](https://refactoring.guru/design-patterns/abstract-factory)
> **Format:** Q&A across all levels with model answers.

---

## Junior Questions (10)

### J1. What is Abstract Factory?

**Answer:** A creational pattern that produces **families of related objects** without specifying their concrete classes. Where Factory Method creates one product per Creator, Abstract Factory creates a coordinated set of products per Concrete Factory.

### J2. What's the difference between Abstract Factory and Factory Method?

**Answer:** Factory Method has **one** factory method per Creator subclass, returning **one** Product type. Abstract Factory has **multiple** factory methods, returning a **family** of related Products that must be consistent.

### J3. Give a real-world example.

**Answer:** Cross-platform UI toolkits. `WindowsFactory` produces a `WindowsButton` AND a `WindowsCheckbox` — both Windows-style. `MacFactory` produces Mac variants. Mixing a Windows button with a Mac checkbox would look broken.

### J4. What does "family" mean?

**Answer:** A set of related products that should be used together. They share characteristics — visual style, performance class, platform — and don't mix well with other variants.

### J5. What are the four roles in Abstract Factory?

**Answer:**
1. **Abstract Products** — interfaces for each product type (e.g., `Button`, `Checkbox`).
2. **Concrete Products** — specific variants (`WindowsButton`, `MacButton`).
3. **Abstract Factory** — interface declaring creation methods.
4. **Concrete Factory** — implements the abstract factory; produces matching variants.

### J6. Why does Abstract Factory not work classically in Go?

**Answer:** Go has no class inheritance. The classical version uses abstract base classes with subclasses. Idiomatic Go uses **interfaces only** — both for the factory and the products. Family consistency becomes a *convention* (verified by tests), not a language feature.

### J7. Name three patterns Abstract Factory often combines with.

**Answer:** Singleton (Concrete Factories are usually stateless and shared), Factory Method (each method of the Abstract Factory is a Factory Method), Prototype (factories may clone instead of constructing).

### J8. Why is the constructor private in Concrete Factories?

**Answer:** When a Concrete Factory is a Singleton, it's private to enforce the single-instance pattern. When it's not a Singleton, the constructor may be public — Abstract Factory doesn't strictly require private constructors.

### J9. Can Abstract Factory return null?

**Answer:** It can, but it's bad practice — defeats polymorphism. Throw, return Optional, or use a Null Object pattern.

### J10. What's the simplest mistake when using Abstract Factory?

**Answer:** Calling `new ConcreteX()` directly somewhere — bypassing the factory and breaking family consistency. Search the codebase for `new ConcreteX(` to find leaks.

---

## Middle Questions (10)

### M1. When should you use Abstract Factory vs multiple Factory Methods?

**Answer:** Abstract Factory when products form a real family (must be used together). Multiple Factory Methods when products are independently varying. The test: would mixing variants cause a bug?

### M2. What's the "Abstract Factory dilemma"?

**Answer:** Adding a new variant (Concrete Factory) is easy — one new file. Adding a new product type (factory method) is hard — every Concrete Factory must implement it. The pattern's flexibility is asymmetric.

### M3. How do you mitigate the dilemma?

**Answer:**
- Java 8+ default methods on the interface (new methods don't break old impls).
- Versioned factory interfaces (`CloudFactoryV1`, `CloudFactoryV2`).
- Composition over a single mega-factory (split into sub-factories).
- Code generation for boilerplate.

### M4. How do you test family consistency?

**Answer:** Per-Concrete-Factory test:

```java
@Test
void windowsFactoryProducesAllWindowsVariants() {
    GuiFactory f = new WindowsGuiFactory();
    assertThat(f.createButton()).isInstanceOf(WindowsButton.class);
    assertThat(f.createCheckbox()).isInstanceOf(WindowsCheckbox.class);
}
```

Plus contract tests run against multiple factories.

### M5. How do you mock an Abstract Factory in tests?

**Answer:** Use `Mockito.mock(GuiFactory.class)` and stub each factory method with mock products. Or use a Test Concrete Factory that returns in-memory products.

### M6. What's the relationship between Abstract Factory and DI?

**Answer:** A DI container is a runtime-configurable factory that often replaces hand-written Abstract Factories. Each "variant" becomes a configuration profile (Spring `@Profile`, Guice modules). For new code, prefer DI for large systems; Abstract Factory still wins for libraries with extension points.

### M7. Should Concrete Factories be Singletons?

**Answer:** Usually yes. They're typically stateless, and there's only one variant active per process. But: tests benefit from fresh factories for isolation. Compromise: production uses singleton; tests use direct instantiation.

### M8. What's the role of `ServiceLoader` in Abstract Factory?

**Answer:** `ServiceLoader.load(GuiFactory.class)` discovers factory implementations declared via `META-INF/services`. Each plugin JAR provides its Concrete Factory; the host iterates and picks the right one. Used by JDBC, slf4j, JPMS.

### M9. How do you handle a factory needing configuration?

**Answer:** Pass configuration to the Concrete Factory's constructor:

```java
public AwsCloudFactory(AwsConfig cfg) { this.cfg = cfg; }
```

Or use a Builder that produces the factory, or a `ConfigurableFactory` interface adding `configure(Config)`.

### M10. When does Abstract Factory become an anti-pattern?

**Answer:** When the "family" isn't real — products don't actually need consistency. When variants change rapidly but types are stable — Strategy is better. When configuration drives the variant — DI is better. When the factory grows beyond ~5 methods — split.

---

## Senior Questions (10)

### S1. How would you architect a cross-platform application using Abstract Factory?

**Answer:**
1. Define abstract products at the API layer (`Button`, `Checkbox`, `Window`).
2. Define `GuiFactory` interface as the variant axis.
3. Each platform module implements its Concrete Factory + Concrete Products.
4. Bootstrap picks the factory by detecting the platform.
5. Application code works only against abstractions.
6. Plug new platforms by adding a new module + Concrete Factory.

### S2. How do you handle product cross-references?

**Answer:** When `Checkbox` needs to know its `Button` parent, the factory coordinates:

```java
public Checkbox createCheckbox(Button parent) { ... }
```

Or: products take an opaque "context" from the factory. Avoid concrete cross-references — they leak the variant identity.

### S3. How do you migrate from Abstract Factory to DI?

**Answer:**
1. Make each product injectable (interface + DI binding).
2. Tag the variant via DI profile.
3. Replace `factory.createX()` with `@Inject X` in consumers.
4. Configure the DI container per environment.
5. Delete the Abstract Factory once all consumers are migrated.

### S4. How do you handle factory versioning across releases?

**Answer:**
- Add new methods as `default` (Java 8+).
- For breaking changes: introduce `FactoryV2 extends FactoryV1` with new methods; deprecate V1.
- Document the migration path.
- For libraries: hold a long deprecation cycle (≥ 2 minor versions).

### S5. How do you test that Concrete Factories satisfy the same contract?

**Answer:** **Contract tests** parameterized on the factory:

```java
@ParameterizedTest
@MethodSource("allFactories")
void factoryContract(CloudFactory f) {
    Storage s = f.storage("test");
    assertRoundtrip(s);
}
```

Same suite runs against in-memory, AWS, GCP factories. Failures isolate variant-specific bugs.

### S6. What's the difference between path-dependent types (Scala) and Java generics for family typing?

**Answer:**
- Scala path-dependent types let the factory's product types be tied to the factory instance: `factory.Button` is a different type than `otherFactory.Button`.
- Java generics provide compile-time parameterization but erase at runtime — cross-variant casts can succeed at compile time and fail at runtime.

Path-dependent types prevent more mix-ups statically; Java generics + tests give 90% of the safety with less syntactic complexity.

### S7. How would you implement hot-swap of the Concrete Factory at runtime?

**Answer:**

```java
private final AtomicReference<GuiFactory> current = new AtomicReference<>(initial);

public void switchTo(GuiFactory next) { current.set(next); }
public Button getButton() { return current.get().createButton(); }
```

Caveats: existing products aren't swapped — only future creations. The product types must still be compatible (no method changes), or callers crash.

### S8. How does Abstract Factory work in a microservices architecture?

**Answer:** Less commonly than in monoliths. In microservices:
- The "factory" is often **a service**, not a class — call out to it for Products (e.g., a "user-creation service").
- Within a service, Abstract Factory still applies for cross-cutting variants (e.g., dialect-specific data access).
- DI is more common at the service level.

### S9. How do you balance flexibility (many factories) vs simplicity?

**Answer:**
- Start with the minimum: enough variants for actual use cases.
- Add factories when a real second variant emerges, not speculatively.
- Watch for the dilemma: if you're adding 5 product types but only 2 variants, Abstract Factory is overkill.

### S10. How does Abstract Factory interact with multi-classloader environments?

**Answer:** Concrete Factories loaded by different classloaders produce products under those classloaders. If consumer code lives in a parent classloader, the cast `(Button) factoryProduct` succeeds only if `Button` is loaded by the **parent** (not the plugin's child loader). Use parent-first delegation for shared interfaces; document the contract.

---

## Professional Questions (10)

### P1. How does the JVM dispatch a multi-method factory call?

**Answer:** Each `factory.createX()` is an `INVOKEINTERFACE` lookup in the receiver's interface method table (itable). One vtable per Concrete Factory class; one entry per method. Cost: ~5 cycles cold; inlined to ~1-2 cycles after JIT for monomorphic call sites.

### P2. Does generics-typed Abstract Factory provide runtime safety?

**Answer:** No. Generics are erased; bridge methods cast Object → typed at the call site. The actual class types of products are still enforced (a `WindowsButton` is still a `WindowsButton`), but the **variant** isn't separately tracked.

### P3. How does GraalVM Native Image handle Abstract Factory?

**Answer:** Closed-world — all Concrete Factories must be reachable at build time. `ServiceLoader` discovery requires `--initialize-at-build-time` flags. Plugin systems with runtime-loaded factories don't work. For known-at-build-time variants, Native Image works smoothly.

### P4. What's the cost of Go's interface dispatch for a 5-method factory?

**Answer:** Per call: itab lookup (~2 ns) + indirect call (~1 ns). Constant per call regardless of how many methods the interface has. The itab itself is ~56 bytes per (interface, type) pair, in `.rodata`.

### P5. Why doesn't Go inline factory method calls?

**Answer:** The compiler can't trace through the factory function to recover the concrete type. Once you have an interface variable (`var f GUIFactory = NewWindowsFactory()`), each method call goes through the itab. Recent Go versions have limited devirtualization, but typical Abstract Factory usage defeats it.

### P6. How does Python's MRO affect mixin Concrete Factories?

**Answer:** MRO orders class hierarchy resolution. With cooperative multiple inheritance (using `super()`), each mixin can extend the factory method. Example: `HighDPIWindowsFactory(HighDPIFactory, WindowsBaseFactory)` resolves `create_button` via the MRO chain, allowing layered customization.

### P7. What happens when Abstract Factory is loaded by a plugin classloader?

**Answer:** The plugin's `Concrete Factory` retains its classloader. If any product remains reachable from the host (subscribed listener, cached value), the plugin classloader can't be GC'd. Memory leak. Mitigation: weak references, explicit unload protocol, JPMS module layers.

### P8. How does HotSpot's Polymorphic Inline Cache (PIC) optimize multi-method factories?

**Answer:** Each call site (`factory.createButton()`, `factory.createCheckbox()`, …) gets its own PIC. If each site sees only one Concrete Factory, all are monomorphic and inlined. If sites see multiple, bimorphic with type guards. Megamorphic falls back to vtable. PICs are per-call-site, not per-method.

### P9. How does adding a method to a Go interface compare to adding to a Java interface?

**Answer:** Java: with `default` methods, no break. Go: every implementor must add the method to compile. Workaround in Go: interface composition (`GuiFactoryV2 interface { GuiFactoryV1; CreateSlider() Slider }`). Old code uses V1; new code requires V2.

### P10. How would you benchmark an Abstract Factory for production deployment?

**Answer:**
1. JMH (Java) / `go test -bench` / `pyperf` for per-method dispatch cost.
2. Memory profile with `pprof` / `jmap -histo` / `tracemalloc` to verify no factory state leaks.
3. Stress test with concurrent factory access to verify thread safety.
4. Cross-variant contract tests (same suite against multiple Concrete Factories).
5. Native Image build to ensure AOT-friendliness.

---

## Coding Tasks (5)

### C1. Implement a UI Abstract Factory in Java with Windows + Mac variants.

```java
interface Button   { void render(); }
interface Checkbox { void render(); }

interface GuiFactory {
    Button   createButton();
    Checkbox createCheckbox();
}

class WindowsButton   implements Button   { public void render() { /* ... */ } }
class WindowsCheckbox implements Checkbox { public void render() { /* ... */ } }
class MacButton       implements Button   { public void render() { /* ... */ } }
class MacCheckbox     implements Checkbox { public void render() { /* ... */ } }

class WindowsGuiFactory implements GuiFactory {
    public Button   createButton()   { return new WindowsButton(); }
    public Checkbox createCheckbox() { return new WindowsCheckbox(); }
}

class MacGuiFactory implements GuiFactory {
    public Button   createButton()   { return new MacButton(); }
    public Checkbox createCheckbox() { return new MacCheckbox(); }
}
```

### C2. Convert a 4-product Abstract Factory to a registry-decorated Python version.

```python
from abc import ABC, abstractmethod
from typing import Type

class ThemeFactory(ABC):
    @abstractmethod
    def make_button(self) -> Button: ...
    @abstractmethod
    def make_checkbox(self) -> Checkbox: ...

_THEMES: dict[str, Type[ThemeFactory]] = {}

def theme(name: str):
    def deco(cls):
        _THEMES[name] = cls
        return cls
    return deco

@theme("light")
class LightTheme(ThemeFactory):
    def make_button(self): return LightButton()
    def make_checkbox(self): return LightCheckbox()

@theme("dark")
class DarkTheme(ThemeFactory):
    def make_button(self): return DarkButton()
    def make_checkbox(self): return DarkCheckbox()

def use_theme(name: str) -> ThemeFactory:
    return _THEMES[name]()
```

### C3. Implement Abstract Factory in Go with cloud-provider variants.

```go
type Provider interface {
    Storage(name string) Storage
    Queue(name string) Queue
}

type aws struct{ cfg AwsConfig }
func (a *aws) Storage(name string) Storage { return &s3{a.cfg, name} }
func (a *aws) Queue(name string)   Queue   { return &sqs{a.cfg, name} }

type local struct{}
func (local) Storage(name string) Storage { return &memStorage{name: name} }
func (local) Queue(name string)   Queue   { return &memQueue{name: name} }

func New(kind string) Provider {
    switch kind {
    case "aws":   return &aws{cfg: defaultAwsCfg()}
    case "local": return local{}
    }
    panic("unknown provider")
}
```

### C4. Write a contract test parameterized over multiple Concrete Factories.

```java
@ParameterizedTest
@MethodSource("allFactories")
void factoryProducesUsableProducts(GuiFactory f) {
    Button   b = f.createButton();
    Checkbox c = f.createCheckbox();
    assertNotNull(b);
    assertNotNull(c);
    b.render();
    c.render();
}

static Stream<GuiFactory> allFactories() {
    return Stream.of(new WindowsGuiFactory(), new MacGuiFactory(), new WebGuiFactory());
}
```

### C5. Implement family hot-swap in Java with `AtomicReference`.

```java
public class ThemeManager {
    private final AtomicReference<GuiFactory> current;
    public ThemeManager(GuiFactory initial) { this.current = new AtomicReference<>(initial); }
    public void switchTo(GuiFactory next) { current.set(next); }
    public Button   newButton()   { return current.get().createButton(); }
    public Checkbox newCheckbox() { return current.get().createCheckbox(); }
}
```

---

## Trick Questions (5)

### T1. Can a Concrete Factory return products from different families?

**Technically yes** (the type system permits it), but it's a bug — defeats family consistency. Tests should catch.

### T2. Is Abstract Factory always implemented with classes?

**No.** In Go, it's purely interfaces. In functional languages, it's a tuple of factory functions. The pattern's spirit (a coordinated set of creators) is what matters.

### T3. Can Abstract Factory be a static class?

**No** in classical Java — static methods can't be overridden. But Java 8+ static interface methods are possible, just not polymorphic. For polymorphic Abstract Factory, use instance methods.

### T4. Is `ServiceLoader.load(GuiFactory.class)` itself a Factory Method?

**Yes, in spirit.** It's a static factory that produces multiple `GuiFactory` instances. You then pick one. Combine with Abstract Factory in a single mechanism.

### T5. Can two Concrete Factories share code?

**Yes**, via inheritance, composition, or mixins. Common in plugin systems where a "base" factory provides defaults and platform-specific factories override only what differs.

---

## Behavioral Questions (5)

### B1. Tell me about Abstract Factory in production.

**Sample answer:**

"At a job board company, we built Abstract Factory for the cloud abstraction. `CloudProvider` interface with `Storage`, `Queue`, `Compute` methods. Three Concrete Factories: AWS, GCP, in-memory (for tests). Migrating from AWS to GCP for one region became a configuration change instead of a code rewrite. The dilemma did bite us: when we needed to add `Compute`, the in-memory factory needed a no-op implementation. Worth it for the flexibility."

### B2. When did Abstract Factory cause more pain than gain?

**Sample answer:**

"A team had built Abstract Factory for what turned out to be a single-variant system. Every product had only one implementation. We had three layers of abstraction (factory + abstract product + concrete product) for what could have been three classes. We collapsed it to direct instantiation. Lesson: don't introduce variant axes speculatively."

### B3. How do you decide between Abstract Factory and DI?

**Sample answer:**

"For libraries with extension points, Abstract Factory + ServiceLoader. For application code, DI. The key question: who's wiring the system? If it's the application (closed), DI. If it's third-party plugins (open), Abstract Factory exposes a clean extension surface."

### B4. How do you handle scope creep in factory interfaces?

**Sample answer:**

"We had a `GuiFactory` that grew from 3 to 12 methods over 18 months. Each new product type forced changes in 5 Concrete Factories. We split it: `WidgetFactory` (button, checkbox), `LayoutFactory` (window, panel), `DialogFactory` (alert, prompt). Each Concrete Factory implements the relevant subset. Tighter contracts, easier evolution."

### B5. Describe an Abstract Factory bug in production.

**Sample answer:**

"`AwsCloudFactory.createQueue()` accidentally returned an SQS queue when it should have been Kinesis (for streaming). Compiles cleanly because both are `Queue`. Production users were surprised by SQS semantics on what they thought was a stream. Caught only after a customer escalation. Fix: contract tests that asserted, for each factory, the *concrete* class of returned products. Now we test family identity, not just type compatibility."

---

## Tips for Answering

1. **Lead with families.** "It produces a family of related products."
2. **Compare with Factory Method.** Always.
3. **Mention the dilemma.** Senior interviewers want to hear this.
4. **Mention Singleton + DI.** Show pattern composition awareness.
5. **Know the language idioms.** Go uses interfaces; Java uses interfaces + ServiceLoader; Python uses ABC + decorators.
6. **Be specific about variant vs type axes.**

---

[← Senior Singleton interview](../05-singleton/interview.md) · [Creational](../README.md) · [Roadmap](../../../README.md) · **Next:** [Tasks](tasks.md)
