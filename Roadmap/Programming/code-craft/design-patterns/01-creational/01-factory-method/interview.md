# Factory Method — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/factory-method](https://refactoring.guru/design-patterns/factory-method)
> **Format:** Q&A across all levels with model answers.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What is the Factory Method pattern?

**Answer:** A creational design pattern where a base class declares a method for creating an object, but lets subclasses decide which concrete class to instantiate. The base class works against an abstract Product interface.

### J2. What problem does Factory Method solve?

**Answer:** Tight coupling to concrete classes. Without it, code is full of `new ConcreteX()`, making it hard to add or swap implementations. Factory Method moves the `new` call into a method that subclasses can override.

### J3. Who decides which Concrete Product gets created?

**Answer:** The Concrete Creator subclass. The base Creator declares the abstract `createX()` method; each subclass overrides it to return its specific Product type.

### J4. Give a real-world example.

**Answer:** A cross-platform UI library:
- `Application.createButton()` is the factory method.
- `WindowsApp.createButton()` returns `WindowsButton`.
- `WebApp.createButton()` returns `HtmlButton`.

The framework's button-rendering code uses `createButton()` polymorphically.

### J5. Why is Factory Method awkward in Go?

**Answer:** Go has no class inheritance. The classical Factory Method pattern relies on a Creator base class with subclasses overriding the factory method. In Go, the idiomatic alternative is **Simple Factory**: a function that returns an interface, often with a `switch` over a kind parameter.

### J6. What's the relationship between Factory Method and the Open/Closed Principle?

**Answer:** Adding a new product type means adding a new Concrete Creator subclass — without modifying any existing code. That's "open for extension, closed for modification."

### J7. Name three patterns that often follow or evolve from Factory Method.

**Answer:** Abstract Factory (when you need a *family* of products), Builder (when construction is multi-step), Prototype (when copying is cheaper than creating).

### J8. What's a "Concrete Creator"?

**Answer:** A subclass of the abstract Creator that implements the factory method to return a specific Concrete Product. Example: `WindowsApp` is a Concrete Creator; its `createButton()` returns `WindowsButton`.

### J9. Should the factory method return a concrete type or an interface?

**Answer:** An interface (or abstract base type). Returning the concrete type defeats the decoupling — clients would still depend on it. The whole point is that callers see only the abstraction.

### J10. What's the simplest mistake when applying Factory Method?

**Answer:** Calling `new ConcreteProduct()` somewhere outside the factory method. That's the smell the pattern is supposed to remove. Search the code base for `new ConcreteX(` to find leaks.

---

## Middle Questions

### M1. When should you use Simple Factory instead of GoF Factory Method?

**Answer:** When the decision of which product to create is based on **runtime data** (a config string, a request parameter), not on subclass identity. Simple Factory uses a function with a `switch`; Factory Method uses inheritance. Simple Factory has less ceremony when you control all the variants.

### M2. Compare Factory Method with Abstract Factory.

**Answer:** Factory Method has **one** factory method per Creator subclass, returning **one** Product type. Abstract Factory has **multiple** factory methods (`createButton`, `createCheckbox`, `createWindow`), returning a **family** of products that must be consistent (e.g., all Windows-style or all Mac-style).

### M3. How do you make a Factory Method testable?

**Answer:** Multiple options:
1. Override `createX()` in a test subclass to return mocks.
2. Inject the factory as a `Supplier<X>` or functional interface.
3. Use a registry that tests can mutate.
4. Use a DI container with test scope.

The most common modern approach is **inject the factory** — Factory Method becomes a `Supplier<T>`.

### M4. What's a "registry-backed" Factory Method?

**Answer:** Instead of a class hierarchy, you keep a map of `String → Supplier<Product>` or similar. Adding a new product means registering a new supplier — no new class. This is essentially Factory Method with composition replacing inheritance, common in modern Java/Kotlin.

### M5. How does ServiceLoader implement Factory Method?

**Answer:** Each plugin JAR contains a `META-INF/services/com.example.MyFactory` file listing implementations. `ServiceLoader.load(MyFactory.class)` discovers them at runtime, instantiates each, and the host calls their factory methods. Used by JDBC drivers, slf4j providers, etc.

### M6. What's the trade-off between Factory Method and direct `new`?

**Answer:**
- Factory Method: more flexibility (open/closed), more classes (overhead).
- Direct `new`: less flexibility, less code.

Use Factory Method when the variant set is open or callers will extend. Use `new` for closed, simple cases.

### M7. How do you refactor a 30-case `if/else` chain of `new ConcreteX()` calls?

**Answer:**
1. Identify the abstraction (Product interface).
2. Extract each `new` into a Factory Method.
3. If subclasses make sense, create Concrete Creators.
4. If the variants are flat, use a Simple Factory or registry.
5. If construction is identical except for the type, use Java's `Supplier<T>` map or Python's class dict.

### M8. How does DI replace Factory Method?

**Answer:** A DI container (Spring, Guice, Wire) is configured with bindings: "when someone asks for `ButtonFactory`, give them this implementation." Consumers `@Autowired` the factory or product. The container *is* the factory; you don't write Concrete Creators yourself.

### M9. What's the connection between Factory Method and Template Method?

**Answer:** Factory Method is often a **step** inside a Template Method algorithm. The base class's template (`process()`) calls `createDocument()` (factory method) as one of its steps; subclasses override `createDocument()` to vary the document type while reusing the rest of the algorithm.

### M10. When does Factory Method become an anti-pattern?

**Answer:** When:
- The hierarchy is deep with each level adding only `create()`.
- Most Concrete Creators differ only in which class to `new`.
- The system has outgrown manual factory wiring; DI would be cleaner.
- You're using inheritance just to vary one method.

---

## Senior Questions

### S1. Walk me through the architecture of a plugin system based on Factory Method.

**Answer:**
1. **Define abstract Product interface** (`Plugin`) and abstract `PluginFactory` interface.
2. Use **`ServiceLoader`** (Java) or **entry points** (Python) or **`init()` registration** (Go) to discover factories.
3. Plugin authors implement `PluginFactory` and register via the platform mechanism.
4. Host calls `factory.create(config)` for each discovered factory.
5. Each plugin runs in its own classloader (for isolation and unloading).

### S2. How do you avoid memory leaks with reloadable plugin factories?

**Answer:**
- Plugin classes hold references to the plugin classloader.
- If the host retains plugin objects, the classloader can't be collected.
- Use **`WeakReference`** for plugin instances in the host.
- After unload, **explicitly null all references**, then trigger GC and verify the classloader is collected.
- Use **`Cleaner`** (Java 9+) for cleanup callbacks.

### S3. Compare Factory Method-based design with a DI container approach.

**Answer:**

| | Factory Method | DI |
|---|---|---|
| Configuration | Compile-time class hierarchy | Runtime / config-driven |
| Discovery | Subclass / ServiceLoader | Container scanning |
| Testability | Override subclass | Inject mock |
| Code volume | More classes | More configuration |
| Performance | JIT-friendly | Container lookup |
| Used in | Frameworks, plugins | Enterprise apps |

For new enterprise code, DI usually wins. For libraries with extension points, Factory Method (often via `ServiceLoader`) is still the standard.

### S4. How does generics erasure impact Java Factory Method?

**Answer:** `T` doesn't exist at runtime, so you can't `new T()`. Workarounds:
- Pass `Class<T>` explicitly.
- Pass a `Supplier<T>` (the factory itself).
- Use TypeToken (super-type token trick) to recover generic info from anonymous subclasses.
- Switch to Kotlin (`reified`) or Scala (`TypeTag`) for cleaner syntax.

### S5. How would you make a Factory Method registry thread-safe?

**Answer:**
- Use **`ConcurrentHashMap`** instead of `HashMap`.
- For static registration at startup with no further changes, use **`Map.of(...)`** (immutable, fastest).
- For dynamic registration, accept a small locking cost.
- For the *create* path, the lookup is read-only — `ConcurrentHashMap.get` is lock-free.

### S6. How do you optimize a megamorphic factory call site?

**Answer:** Megamorphic call sites (3+ Concrete Creators observed) prevent JIT inlining. Mitigations:
- **Specialize by call site** — separate hot path with one type from cold path with many.
- **Cache the Supplier** — call once, reuse `Supplier<T>` reference.
- **`LambdaMetafactory`** to convert constructor refs to direct calls (~5 ns).
- **Inline the factory** at the call site if the type is known statically.

### S7. What's the role of `Supplier<T>` in modern Java factories?

**Answer:** `Supplier<T>` is a **function-shaped Factory Method**: `T get()`. Modern Java code prefers passing `Supplier<T>` to writing whole class hierarchies. It plays well with method references (`Foo::new`) and with `Optional.orElseGet(supplier)`. Spring, Caffeine, and many libraries take `Supplier<T>` as a customization point.

### S8. How does Factory Method interact with serialization?

**Answer:** Default Java serialization bypasses constructors — including factory methods. If your factory does important setup (caches, lookups), deserialized objects won't have it. Mitigations:
- Implement `readResolve()` to redirect to the factory.
- Use `Serializable` lambdas carefully — they capture surrounding state.
- Prefer custom serialization (e.g., JSON via Jackson, which calls constructors).

### S9. Why might you use Factory Method over inheritance in a microservices architecture?

**Answer:** Microservices favor configuration-driven behavior over class hierarchies. Factory Method via registry + DI lets:
- Each service load only the implementations it needs.
- Runtime config picks the right factory.
- New implementations don't require redeploys of consumers.

But: in microservices, "factory" often means a *service* (HTTP/gRPC), not a class. Factory Method is more relevant within a service than across services.

### S10. How do you design a Factory Method API for backward compatibility?

**Answer:**
- Make the factory method **abstract by default**, but provide a deprecated default to ease migration.
- Use **`@Deprecated`** + Javadoc pointing to the new method.
- For breaking changes: introduce **a new factory class**, deprecate the old.
- For products: extend the Product interface with **default methods** (Java 8+) to add behavior without breaking subclasses.

---

## Professional Questions

### P1. What's the JIT cost of a virtual factory method call?

**Answer:** Cold: 3-5 ns (vtable lookup + dispatch). Hot **monomorphic**: 1-2 ns (inlined). Hot **bimorphic**: 2-3 ns (inlined with type guard). Hot **megamorphic** (3+ types): 3-5 ns (vtable, no inlining).

### P2. How does GraalVM Native Image handle Factory Method?

**Answer:** GraalVM uses closed-world assumption — all reachable types must be known at build time. Issues:
- **`ServiceLoader`**: requires explicit reflection config or `META-INF/services` registration.
- **Reflection-based factories**: must be in `reflect-config.json`.
- **Dynamic class loading**: not supported; plugins must be linked at build time.

`native-image-agent` can record reflection use during a test run and generate the configs automatically.

### P3. Compare reflection, MethodHandle, and LambdaMetafactory for dynamic factories.

**Answer:**
- **Reflection** (`Class.newInstance`): ~500 ns. Slow because every call goes through security checks and method resolution.
- **MethodHandle** (Java 7+): ~10-20 ns after warmup. Constants are pre-resolved.
- **LambdaMetafactory** (Java 8+): ~5 ns. Generates a direct invokedynamic call site.

Modern bytecode-generating libraries (ByteBuddy, ASM) often use LambdaMetafactory for maximum speed.

### P4. How does Go's interface dispatch work, and why doesn't it inline factory results?

**Answer:** Go interface variables are `(itab pointer, data pointer)`. Calling a method goes through the itab's function pointer slot — one indirection. The compiler **doesn't trace through factory functions** to recover the concrete type, so the call after `t, _ := New()` stays virtual. Recent Go versions can devirtualize when the type is local and obvious.

### P5. What's the memory cost of a Factory Method hierarchy in Java?

**Answer:** Each `Class<?>` ~500 B - 5 KB in Metaspace. 20 Concrete Creators × 10 methods ≈ 50 KB - 1 MB. Negligible for desktop / server JVMs; relevant for embedded JVMs or Android.

### P6. How does Python's metaclass `__call__` differ from Java reflection?

**Answer:** Python's metaclass `__call__` is the *normal* dispatch mechanism — it just runs Python bytecode. Cost: ~250-400 ns vs ~150 ns for plain `Foo()`. Java reflection goes through an entirely different code path with security checks; ~500 ns vs ~5 ns for direct `new`. Python's "factory" mechanism is much closer to direct construction in cost than Java's reflection-based equivalent.

### P7. How would you implement a hot-path factory that produces millions of objects per second?

**Answer:**
- **Object pool**: reuse instances. Factory `borrow()` returns a pooled or new object.
- **`LambdaMetafactory`-cached supplier**: factory becomes a direct call.
- **Avoid megamorphism**: split hot/cold paths; the hot one sees only one type.
- **Stack allocation** (escape analysis): not for Factory Method (instance escapes), but for related fast-path objects.

For >10M ops/s, factories are usually the wrong abstraction — direct construction or pre-allocated arrays win.

### P8. What's the relationship between Factory Method and JPMS modules?

**Answer:** With JPMS (Java 9+), `ServiceLoader.load(Class)` scans for service providers declared in `module-info.java`:

```java
provides com.example.PluginFactory with com.example.csv.CsvFactory;
```

The discovery is **module-aware** — only modules that **read** the service interface module are scanned. This replaces classpath-based discovery with module-graph-based discovery.

### P9. How does the JVM resolve `creator.create()` where `creator` is the result of `Class.forName(...).newInstance()`?

**Answer:**
1. **`Class.forName`** loads the class (if not already loaded), running static initializers.
2. **`newInstance()`** calls the no-arg constructor via reflection.
3. The returned `Object` reference has a runtime type (the concrete class).
4. Calling `creator.create()` (after casting to the abstract type) goes through a normal `INVOKEVIRTUAL` — vtable dispatch on the actual concrete type.
5. After enough calls, JIT may inline if the call site is mono/bimorphic.

The **first call's** total cost is dominated by `Class.forName` (~10-50 µs); subsequent calls are normal speed.

### P10. How do you handle classloader-related `ClassCastException` in a plugin Factory Method?

**Answer:**
- **Cause:** Plugin classloader loads `Plugin` independently from host classloader. `(Plugin) plugin.getClass()` cast fails because there are two `Class<Plugin>` objects.
- **Fix:** ensure both classloaders see the same `Plugin` interface. Typically: load `Plugin` from a parent classloader, then plugins depend on it.
- **Pattern:** **parent-first delegation** for shared API; **child-first** for plugin-private classes.

---

## Coding Tasks

### C1. Convert this `if/else` to Factory Method (Java)

**Before:**
```java
class Renderer {
    void render(String type) {
        if (type.equals("pdf"))      new PdfWriter().write();
        else if (type.equals("html")) new HtmlWriter().write();
        else                          new TextWriter().write();
    }
}
```

**After:**
```java
abstract class Renderer {
    abstract Writer createWriter();
    void render() { createWriter().write(); }
}
class PdfRenderer extends Renderer {
    Writer createWriter() { return new PdfWriter(); }
}
class HtmlRenderer extends Renderer {
    Writer createWriter() { return new HtmlWriter(); }
}
class TextRenderer extends Renderer {
    Writer createWriter() { return new TextWriter(); }
}
```

Or, with a registry:
```java
class Renderer {
    private static final Map<String, Supplier<Writer>> WRITERS = Map.of(
        "pdf",  PdfWriter::new,
        "html", HtmlWriter::new,
        "text", TextWriter::new
    );
    void render(String type) { WRITERS.get(type).get().write(); }
}
```

### C2. Implement a thread-safe registry-based factory in Go

```go
package factory

import "sync"

type Product interface{ Use() }

var (
    registry = make(map[string]func() Product)
    mu       sync.RWMutex
)

func Register(kind string, f func() Product) {
    mu.Lock(); defer mu.Unlock()
    registry[kind] = f
}

func Create(kind string) (Product, bool) {
    mu.RLock(); defer mu.RUnlock()
    f, ok := registry[kind]
    if !ok { return nil, false }
    return f(), true
}
```

### C3. Make a Factory Method generic in Java

```java
public abstract class RepositoryFactory<T> {
    public abstract Repository<T> create();
}

public class JpaRepositoryFactory<T> extends RepositoryFactory<T> {
    private final Class<T> type;
    public JpaRepositoryFactory(Class<T> type) { this.type = type; }
    @Override
    public Repository<T> create() { return new JpaRepository<>(type); }
}

// Usage
RepositoryFactory<User> rf = new JpaRepositoryFactory<>(User.class);
Repository<User> ur = rf.create();
```

### C4. Implement a discriminated-union factory in Python

```python
from typing import Literal
from dataclasses import dataclass

@dataclass(frozen=True)
class Spec:
    kind: Literal["a", "b", "c"]
    value: int

class A: pass
class B: pass
class C: pass

_FACTORIES = {"a": A, "b": B, "c": C}

def make(spec: Spec):
    return _FACTORIES[spec.kind]()
```

### C5. Build a plugin loader using `ServiceLoader` (Java)

```java
public interface PluginFactory {
    Plugin create(Config config);
}

public class PluginHost {
    public List<Plugin> loadAll(Config config) {
        ServiceLoader<PluginFactory> loader = ServiceLoader.load(PluginFactory.class);
        return loader.stream()
                     .map(p -> p.get().create(config))
                     .toList();
    }
}
```

Plugin author provides:
```
META-INF/services/com.example.PluginFactory
com.example.csv.CsvPluginFactory
```

---

## Trick Questions

### T1. Is Factory Method always implemented with inheritance?

**Answer:** **No.** The classical GoF version uses inheritance, but modern implementations often use composition (registry of `Supplier<T>`), DI containers, or plain functions. The *spirit* of the pattern — decoupling clients from concrete instantiation — survives without inheritance.

### T2. Can a factory method be `static`?

**Answer:** **Technically yes**, but then it's "static factory method" — a common Java idiom (`Integer.valueOf`, `List.of`) — not GoF Factory Method. The GoF version requires polymorphism (subclasses override), which static methods can't provide.

### T3. Does Factory Method always return a fresh object?

**Answer:** **No.** Subclasses are free to cache, pool, or return singletons. The contract is "returns a Product," not "returns a new Product." If callers need a fresh object every time, document it.

### T4. Can two Concrete Creators return the same Concrete Product?

**Answer:** **Yes**, but it's a smell — the Concrete Creators are functionally identical. Either consolidate them, or differentiate via configuration.

### T5. Is a Builder a Factory Method?

**Answer:** **No.** Builder produces *one* product through *multiple* steps; Factory Method produces *different* products through *one* step. They can be combined: a Builder's `build()` is itself a factory method.

---

## Behavioral Questions

### B1. Tell me about a time Factory Method was the wrong choice.

**Sample answer:**

"A team I joined had built a Factory Method hierarchy for `MessageProcessor` with 12 Concrete Creators. Each subclass differed only in which `Processor` class to `new`. Adding a new variant required a new class file plus changes to a registry of which creator to instantiate. We replaced the entire hierarchy with a `Map<String, Supplier<Processor>>` populated at startup — 80% less code, same behavior, easier to read. The lesson: Factory Method earns its complexity when callers will *extend* it. If you control all variants, Simple Factory or a registry is enough."

### B2. How do you decide between Factory Method and DI?

**Sample answer:**

"For a library where third parties will provide implementations, Factory Method (often via ServiceLoader) is the standard. The third party doesn't have access to my DI container; they just implement an interface and register. For application code where I control all the wiring, DI wins — it's easier to reconfigure for tests and different environments. The deciding factor is *who else will need to extend this?* If the answer is 'just me,' DI. If it's 'unknown plugin authors,' Factory Method."

### B3. Walk me through a Factory Method refactor in production code.

**Sample answer:**

"We had a `ReportGenerator` that did `if/else` on report type and called `new XYZReport()`. Adding a new report meant editing the `if/else` and writing a new class — and developers often forgot to update the central switch. I extracted `ReportFactory` as an interface, made each `Report` provide its own `Factory`, and used `ServiceLoader` for discovery. Now adding a report is one new file with a `META-INF/services` entry. The central switch is gone; the system is open/closed."

### B4. Describe debugging a memory leak in a Factory Method-based plugin system.

**Sample answer:**

"Heap usage grew monotonically after each plugin reload. I dumped the heap and found the old plugin classloader still alive. Tracking down GC roots, I found the host's plugin instance list. We had 'reloaded' the plugin by replacing the entry in the list, but the old instance was still referenced by an event listener registered with the host. We added explicit `unregister()` calls in the plugin lifecycle and switched to `WeakReference` for caching plugin instances. Memory stabilized after the change."

### B5. Tell me about a tradeoff between flexibility and simplicity in factory design.

**Sample answer:**

"For a small CLI tool, I wrote a `Renderer` Factory Method with three subclasses for PDF/HTML/text. A reviewer asked why I didn't just `new XRenderer()` — the variant set was fixed and small. They were right; the Factory Method added indirection without flexibility benefit. I simplified to direct construction. The lesson: design patterns earn complexity only when the flexibility is real. Three fixed implementations don't justify a hierarchy."

---

## Tips for Answering

1. **Lead with the problem.** "Factory Method solves *this* problem: tight coupling to concrete classes."
2. **Mention modern alternatives.** Senior interviewers want to know you've evolved beyond GoF.
3. **Know the language idioms.** Go uses Simple Factory; Python uses class-as-arg; Java uses Supplier/ServiceLoader.
4. **Acknowledge cost.** Factory Method adds indirection. Mention when it's worth it.
5. **Compare with Abstract Factory** unprompted — it's the #1 follow-up.
6. **Mention DI when relevant.** Modern code often replaces Factory Method with DI.
7. **Be specific about *who* extends.** "Who decides the type" is the central question.

---

[← Singleton interview](../05-singleton/interview.md) · [Creational](../README.md) · [Roadmap](../../../README.md) · **Next:** [Tasks](tasks.md)
