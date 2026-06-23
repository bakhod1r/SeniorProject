# Factory Method — Find the Bug

> **Source:** [refactoring.guru/design-patterns/factory-method](https://refactoring.guru/design-patterns/factory-method)

12 buggy snippets. Read, find the bug, then check the answer. Bugs distributed across Go, Java, Python.

---

## Table of Contents

1. [Bug 1: Returning concrete type instead of interface (Java)](#bug-1-returning-concrete-type-instead-of-interface-java)
2. [Bug 2: `new ConcreteX` outside the factory (Java)](#bug-2-new-concretex-outside-the-factory-java)
3. [Bug 3: Caching products that should be fresh (Go)](#bug-3-caching-products-that-should-be-fresh-go)
4. [Bug 4: Race condition in registry (Go)](#bug-4-race-condition-in-registry-go)
5. [Bug 5: Subclass returns null (Java)](#bug-5-subclass-returns-null-java)
6. [Bug 6: instanceof check leaking through (Java)](#bug-6-instanceof-check-leaking-through-java)
7. [Bug 7: Static factory method shadowed (Python)](#bug-7-static-factory-method-shadowed-python)
8. [Bug 8: Generics erasure ClassCastException (Java)](#bug-8-generics-erasure-classcastexception-java)
9. [Bug 9: Plugin classloader leak (Java)](#bug-9-plugin-classloader-leak-java)
10. [Bug 10: Forgotten registration (Go)](#bug-10-forgotten-registration-go)
11. [Bug 11: Mutable shared registry (Python)](#bug-11-mutable-shared-registry-python)
12. [Bug 12: Default factory infinite loop (Java)](#bug-12-default-factory-infinite-loop-java)

---

## Bug 1: Returning concrete type instead of interface (Java)

```java
abstract class Logistics {
    abstract Truck createTransport();   // ← BUG
    public void planDelivery() {
        Truck t = createTransport();
        t.deliver();
    }
}

class RoadLogistics extends Logistics {
    Truck createTransport() { return new Truck(); }
}

class SeaLogistics extends Logistics {
    Truck createTransport() { return new Truck(); /* ??? */ }
}
```

**Symptoms:** `SeaLogistics` is forced to return a `Truck` even though it should return a `Ship`. The whole point of Factory Method is broken — you can't add new types without changing the abstraction.

<details><summary>Find the bug</summary>

The factory method's return type is `Truck` (concrete), not `Transport` (abstract). This couples the Creator to one Concrete Product.

</details>

### Fix

```java
abstract class Logistics {
    abstract Transport createTransport();   // ← interface, not concrete class
    public void planDelivery() {
        Transport t = createTransport();
        t.deliver();
    }
}

class SeaLogistics extends Logistics {
    Transport createTransport() { return new Ship(); }
}
```

### Lesson

Factory Method must return the **abstract type**, never the concrete one. Returning a concrete type defeats the whole purpose of the pattern.

---

## Bug 2: `new ConcreteX` outside the factory (Java)

```java
abstract class App {
    abstract Button createButton();
    public void renderToolbar() {
        Button save = createButton();
        save.render();
        Button cancel = new HtmlButton();   // ← BUG
        cancel.render();
    }
}
```

**Symptoms:** On Windows, `save` is a `WindowsButton` but `cancel` is always `HtmlButton`. Visual inconsistency.

<details><summary>Find the bug</summary>

Direct `new HtmlButton()` bypasses the factory method. The pattern's contract — "all buttons come through `createButton()`" — is violated.

</details>

### Fix

```java
abstract class App {
    abstract Button createButton();
    public void renderToolbar() {
        Button save   = createButton();
        Button cancel = createButton();   // ← always use the factory
        save.render();
        cancel.render();
    }
}
```

### Lesson

Once you commit to Factory Method, **search the entire class for `new` calls** of any Concrete Product. They are all bugs.

---

## Bug 3: Caching products that should be fresh (Go)

```go
type Connection struct{ /* mutable state */ }

var cached *Connection

func New() *Connection {
    if cached == nil {
        cached = &Connection{}
    }
    return cached
}

// Caller A
c1 := New()
c1.SetTransaction(tx1)
// Caller B (concurrent)
c2 := New()
c2.SetTransaction(tx2)   // overwrites tx1!
```

**Symptoms:** Two concurrent transactions corrupt each other's state. Hard-to-reproduce data corruption.

<details><summary>Find the bug</summary>

The factory caches the product, returning the same instance to all callers. For mutable per-caller state (transactions), each caller needs its own object.

</details>

### Fix

```go
func New() *Connection {
    return &Connection{}   // fresh every call
}
```

If caching is needed for *immutable* products, document it clearly. For mutable per-caller state, never cache.

### Lesson

Factory methods should be **predictable about identity**. Either always return fresh, or always return the same — and document which.

---

## Bug 4: Race condition in registry (Go)

```go
package factory

var registry = map[string]func() Product{}

func Register(name string, f func() Product) {
    registry[name] = f
}

func Create(name string) Product {
    return registry[name]()
}
```

If `Register` is called concurrently with `Create`, or two `Register`s run concurrently, you get races.

**Symptoms:** `go test -race` reports races. Occasional `nil` returns. `panic: assignment to entry in nil map` if init order is wrong.

<details><summary>Find the bug</summary>

Plain `map` is not safe for concurrent read+write. Without synchronization, the runtime crashes or returns inconsistent state.

</details>

### Fix

```go
package factory

import "sync"

var (
    registry = map[string]func() Product{}
    mu       sync.RWMutex
)

func Register(name string, f func() Product) {
    mu.Lock(); defer mu.Unlock()
    registry[name] = f
}

func Create(name string) (Product, bool) {
    mu.RLock(); defer mu.RUnlock()
    f, ok := registry[name]
    if !ok { return nil, false }
    return f(), true
}
```

If `Register` is only called at startup (during `init()`), reads are safe without a lock — but the **convention** must be enforced. A read lock is cheaper than a bug.

### Lesson

Any factory registry must be thread-safe. `sync.RWMutex` is sufficient and cheap. Document whether registration is allowed at runtime or only at init.

---

## Bug 5: Subclass returns null (Java)

```java
abstract class Pluggable {
    abstract Plugin createPlugin();

    public void run() {
        Plugin p = createPlugin();
        p.execute();   // NPE if subclass returned null
    }
}

class IncompletePluggable extends Pluggable {
    Plugin createPlugin() {
        if (config.isPresent()) return new RealPlugin(config);
        return null;   // ← BUG
    }
}
```

**Symptoms:** `NullPointerException` deep in `run()`. Stack trace points to the abstract class, not the actual subclass.

<details><summary>Find the bug</summary>

The factory contract is "returns a Plugin" — null is a violation. The base class trusts the contract; subclass breaks it.

</details>

### Fix — Throw

```java
class IncompletePluggable extends Pluggable {
    Plugin createPlugin() {
        if (config.isEmpty()) throw new IllegalStateException("no config");
        return new RealPlugin(config.get());
    }
}
```

### Fix — Null Object

```java
class NoOpPlugin implements Plugin {
    public void execute() {}
}

class IncompletePluggable extends Pluggable {
    Plugin createPlugin() {
        return config.map(RealPlugin::new).orElse(new NoOpPlugin());
    }
}
```

### Fix — Optional

```java
abstract class Pluggable {
    abstract Optional<Plugin> createPlugin();
    public void run() {
        createPlugin().ifPresent(Plugin::execute);
    }
}
```

### Lesson

Document and enforce the factory's null-handling contract. Throw, return Null Object, or return Optional — but don't silently return null.

---

## Bug 6: instanceof check leaking through (Java)

```java
abstract class Renderer {
    abstract Document createDocument();
    public void render() {
        Document doc = createDocument();
        if (doc instanceof PdfDocument pdf) {
            pdf.setMetadata("...");   // ← only PDFs have this
        }
        doc.render();
    }
}
```

**Symptoms:** Adding a new document type that *also* needs metadata requires editing the abstract base class. The pattern's open/closed property is broken.

<details><summary>Find the bug</summary>

The base class checks the runtime type and calls a concrete-only method. The abstraction is leaking. New variants force base-class changes.

</details>

### Fix — Move the method to the abstraction

```java
interface Document {
    void render();
    default void setMetadata(String md) {}   // no-op default
}

class PdfDocument implements Document {
    public void render() { /* ... */ }
    public void setMetadata(String md) { /* PDF-specific */ }
}
```

Now the base `Renderer` calls `doc.setMetadata("...")` polymorphically — no `instanceof`.

### Fix — Visitor pattern

If concrete-specific operations multiply, use [Visitor](../../03-behavioral/10-visitor/junior.md).

### Lesson

`instanceof` checks against Concrete Products are a code smell. The abstraction should expose the operations needed by the algorithm, with default behavior where appropriate.

---

## Bug 7: Static factory method shadowed (Python)

```python
class Vehicle:
    @staticmethod
    def create() -> "Vehicle":
        return Vehicle()

class Car(Vehicle):
    @staticmethod
    def create() -> "Car":
        return Car()

# ...
v = Vehicle.create()       # → Vehicle
c = Car.create()           # → Car
generic = (Vehicle if random_bool() else Car).create()
```

**Symptoms:** `Vehicle.create()` always returns a `Vehicle` even when called via a subclass reference (with explicit `Vehicle.create()`). Polymorphism doesn't apply.

<details><summary>Find the bug</summary>

`@staticmethod` doesn't dispatch on the calling class. `Vehicle.create()` is fixed at definition time — even `Car.create()` ignores `Car` if it didn't override `create`.

For *polymorphic* factory methods, use `@classmethod`:

</details>

### Fix

```python
class Vehicle:
    @classmethod
    def create(cls) -> "Vehicle":
        return cls()

class Car(Vehicle):
    pass   # inherits create

c = Car.create()      # → Car (cls = Car)
v = Vehicle.create()  # → Vehicle
```

### Lesson

In Python, `@classmethod` binds the actual receiving class as `cls`, enabling polymorphic factory methods. `@staticmethod` is for stateless helpers, not factories.

---

## Bug 8: Generics erasure ClassCastException (Java)

```java
public abstract class Repository<T> {
    public abstract T create();
}

public class UserRepo extends Repository<User> {
    public User create() {
        return (User) Class.forName("com.example.Bot").newInstance();
        // returning a Bot, not a User
    }
}
```

**Symptoms:** `ClassCastException` at the caller, but only when they assign to a `User`-typed variable.

<details><summary>Find the bug</summary>

Java erases `T` to `Object`. The bridge method auto-generated for `UserRepo.create()` casts `Object` to `User`. If the actual returned object is *not* a `User`, the cast fails — but the failure happens at the bridge, not at the typing site.

</details>

### Fix

Trust the type system: `create()` declared as returning `User` must return a `User`. Refactor the implementation:

```java
public class UserRepo extends Repository<User> {
    public User create() { return new User(); }
}
```

If you need dynamic class loading, use parameterized factories properly:

```java
public class DynamicRepo extends Repository<Object> {
    public Object create() { return ...; }
}
```

### Lesson

Generics are compile-time. The runtime doesn't know `T`. Don't lie to the type system — return the declared type or use raw types explicitly.

---

## Bug 9: Plugin classloader leak (Java)

```java
public class PluginHost {
    private static final List<Plugin> plugins = new ArrayList<>();

    public void load(URL jar) throws Exception {
        URLClassLoader cl = new URLClassLoader(new URL[]{jar});
        Class<?> factoryClass = cl.loadClass("PluginFactory");
        PluginFactory pf = (PluginFactory) factoryClass.getDeclaredConstructor().newInstance();
        plugins.add(pf.create());
    }

    public void unload(int idx) {
        plugins.remove(idx);   // hopes this is enough
    }
}
```

**Symptoms:** After unloading and reloading plugins many times, the JVM's Metaspace fills up with old `Class<?>` objects. Eventually `OutOfMemoryError: Metaspace`.

<details><summary>Find the bug</summary>

The `URLClassLoader` reference is held inside each `Class<?>` it loaded. If *any* object from that classloader (or any class loaded by it) is reachable, the classloader can't be collected. Even after `plugins.remove(idx)`, internal references in JVM caches, listeners, etc., may keep the classloader alive.

</details>

### Fix

```java
public class PluginHost {
    private static final List<PluginEntry> plugins = new ArrayList<>();

    private static class PluginEntry {
        final URLClassLoader cl;
        Plugin plugin;
        PluginEntry(URLClassLoader cl, Plugin p) { this.cl = cl; this.plugin = p; }
    }

    public void load(URL jar) throws Exception {
        URLClassLoader cl = new URLClassLoader(new URL[]{jar}, getClass().getClassLoader());
        Class<?> factoryClass = cl.loadClass("PluginFactory");
        PluginFactory pf = (PluginFactory) factoryClass.getDeclaredConstructor().newInstance();
        plugins.add(new PluginEntry(cl, pf.create()));
    }

    public void unload(int idx) throws IOException {
        PluginEntry e = plugins.remove(idx);
        e.plugin = null;
        e.cl.close();   // ← closes URL streams
        // GC will reclaim eventually
    }
}
```

Plus: ensure the plugin doesn't register itself in any singleton (e.g., `EventBus.getInstance().subscribe(this)`) without unregistering on shutdown.

### Lesson

Classloader leaks are insidious — a single forgotten reference holds an entire classloader. Plugin systems need a strict lifecycle: load, use, **explicitly unregister**, drop references, close classloader. Use `WeakReference` for any cross-classloader holders.

---

## Bug 10: Forgotten registration (Go)

```go
package main

import "host/plugins"

// import _ "host/plugins/csv"   ← BUG: commented out

func main() {
    p, ok := plugins.Create("csv", nil)
    if !ok {
        panic("csv plugin missing!")   // panics at runtime
    }
    p.Run()
}
```

**Symptoms:** Build succeeds, but at runtime the registry is empty. `plugins.Create` returns `nil, false`.

<details><summary>Find the bug</summary>

The plugin's `init()` only runs if the package is imported. Without `_ "host/plugins/csv"`, the `init()` never fires, the factory is never registered.

</details>

### Fix

```go
package main

import (
    "host/plugins"
    _ "host/plugins/csv"
    _ "host/plugins/xml"
    _ "host/plugins/json"
)
```

For dynamic plugin loading, use Go plugins (`plugin` package) — but they have many caveats and are rarely used in production.

### Lesson

`init()`-based registration in Go is fragile: the `import _ "..."` is the only thing keeping the package alive. Document this in the host project, and consider explicit registration calls in `main()` for clarity.

---

## Bug 11: Mutable shared registry (Python)

```python
class FactoryRegistry:
    factories = {}   # ← class-level mutable, shared!

    @classmethod
    def register(cls, name, factory):
        cls.factories[name] = factory

# Test 1
class TestA:
    def setup(self):
        FactoryRegistry.register("foo", lambda: A())
    def test(self):
        assert FactoryRegistry.factories["foo"]() == A()

# Test 2
class TestB:
    def setup(self):
        FactoryRegistry.register("foo", lambda: B())
    def test(self):
        assert FactoryRegistry.factories["foo"]() == B()
        # Test 1's "foo" is overwritten
```

**Symptoms:** Tests pass individually but fail when run together. Test order affects results.

<details><summary>Find the bug</summary>

The `factories` dict lives at the class level — shared across all uses. Tests pollute each other. Worse: production code might depend on a registration that a test fixture has overwritten.

</details>

### Fix — Per-test cleanup

```python
import pytest

@pytest.fixture(autouse=True)
def reset_registry():
    snapshot = dict(FactoryRegistry.factories)
    yield
    FactoryRegistry.factories.clear()
    FactoryRegistry.factories.update(snapshot)
```

### Fix — Instance-based

```python
class FactoryRegistry:
    def __init__(self):
        self.factories = {}
    def register(self, name, factory):
        self.factories[name] = factory
```

Each component gets its own registry instance. No global shared state.

### Lesson

Class-level mutable state is global state in disguise. For factories, prefer per-instance registries or fixture-isolated globals. Document if global registration is allowed.

---

## Bug 12: Default factory infinite loop (Java)

```java
abstract class Creator {
    public Product create() {
        return create();   // ← BUG: calls itself forever
    }
}

class ConcreteCreator extends Creator {
    public Product create() {
        return super.create();   // also recursive
    }
}
```

**Symptoms:** `StackOverflowError` immediately on first call.

<details><summary>Find the bug</summary>

`create()` calls itself with no terminating condition or different concrete method. The whole pattern is botched.

</details>

### Fix

If the base class shouldn't have a default, make it abstract:

```java
abstract class Creator {
    public abstract Product create();
}
```

If a default is desired, return a sentinel:

```java
class Creator {
    public Product create() { return new DefaultProduct(); }
}

class ConcreteCreator extends Creator {
    public Product create() { return new SpecialProduct(); }
}
```

### Lesson

`super.method()` in an override is for delegating to the parent's *implementation* — make sure that implementation exists and isn't recursive. When the base class has no default, mark it `abstract`.

---

## Practice Tips

1. **Spot the bug in 30-60 seconds.** If you can't, expand and re-read in a week.
2. **Categorize:** abstraction-leak, concurrency, language-specific, lifecycle.
3. **Match each bug to a fix variant.** There are usually multiple — pick the one that fits the codebase.
4. **Run the buggy code.** Watch the symptoms appear: NPE, StackOverflow, race report.
5. **Cross-reference with [optimize.md](optimize.md).** Some bugs are caused by misguided optimization attempts.

---

[← Tasks](tasks.md) · [Creational](../README.md) · [Roadmap](../../../README.md) · **Next:** [Optimize](optimize.md)
