# Abstract Factory — Optimize

> **Source:** [refactoring.guru/design-patterns/abstract-factory](https://refactoring.guru/design-patterns/abstract-factory)

10 inefficient implementations + benchmarks + optimized versions.

Apple M2 Pro, single thread.

---

## Optimization 1: Make Concrete Factories Singletons

### Slow code (Java)

```java
GuiFactory pick() {
    return new WindowsGuiFactory();   // new every call
}
```

For each request: factory allocated, immediately discarded.

### Benchmark

```
NewFactoryEachCall   thrpt   10  200M ops/s
```

### Optimized — singleton

```java
public final class WindowsGuiFactory implements GuiFactory {
    private static final WindowsGuiFactory INSTANCE = new WindowsGuiFactory();
    private WindowsGuiFactory() {}
    public static WindowsGuiFactory getInstance() { return INSTANCE; }
    // ...
}
```

### Benchmark after

```
SingletonFactory     thrpt   10  900M ops/s
```

**~4.5× speedup.** Eliminates allocation; JIT inlines.

---

## Optimization 2: Cache Stateless Products

### Slow code

```java
public Button createButton() { return new WindowsButton(); }
```

If `WindowsButton` is stateless and shareable, every call allocates unnecessarily.

### Benchmark

```
NewProductEachCall   thrpt   10  300M ops/s
```

### Optimized

```java
private static final Button BUTTON = new WindowsButton();
public Button createButton() { return BUTTON; }
```

### Benchmark after

```
CachedProduct        thrpt   10  900M ops/s
```

**3× speedup.** Document immutability.

### Tradeoff

- Caching mutable products is a bug.
- Document the contract: "returned object is immutable; do not modify."

---

## Optimization 3: Lazy Initialization for Heavy Concrete Factories

### Slow code

```java
public final class AwsCloudFactory implements CloudFactory {
    private static final AwsCloudFactory INSTANCE = new AwsCloudFactory();   // expensive on class load
    private AwsCloudFactory() {
        // initializes AWS SDK clients (~200 ms)
    }
}
```

App startup pays 200 ms even if AWS is never used.

### Optimized — lazy holder

```java
public final class AwsCloudFactory implements CloudFactory {
    private AwsCloudFactory() { /* expensive setup */ }
    private static class Holder { static final AwsCloudFactory I = new AwsCloudFactory(); }
    public static AwsCloudFactory get() { return Holder.I; }
}
```

### Benchmark

| | Eager | Lazy |
|---|---|---|
| App startup | +200 ms | +0 ms |
| First call | +0 ms | +200 ms |
| Steady state | identical | identical |

For services that often skip AWS, this saves 200 ms × N processes.

---

## Optimization 4: Avoid Megamorphic Call Sites

### Slow code (Java)

```java
public void renderAll(List<GuiFactory> factories) {
    for (GuiFactory f : factories) {
        Button b = f.createButton();
        b.render();
    }
}
```

If `factories` contains 5+ different Concrete Factories, the call site becomes megamorphic — JIT can't inline.

### Benchmark

```
HeterogeneousList       thrpt   10  100M ops/s
```

### Optimized — homogeneous loop

```java
public void renderAllSameType(List<? extends GuiFactory> factories) {
    if (factories.isEmpty()) return;
    Class<?> firstType = factories.get(0).getClass();
    if (factories.stream().allMatch(f -> f.getClass() == firstType)) {
        // hot path: monomorphic call site
        for (GuiFactory f : factories) f.createButton().render();
    } else {
        // cold path: still works, just slower
        renderAll(factories);
    }
}
```

### Benchmark after (homogeneous)

```
HomogeneousList         thrpt   10  450M ops/s
```

**~4.5× speedup** for homogeneous lists. Real production code rarely mixes more than one factory anyway.

---

## Optimization 5: Pool Heavy Products

### Slow code

```java
public Connection createConnection() {
    return DriverManager.getConnection(dsn);   // ~50 ms
}
```

Each call opens a TCP connection.

### Optimized — pool

```java
private final BlockingQueue<Connection> pool = new ArrayBlockingQueue<>(20);

public Connection createConnection() throws InterruptedException, SQLException {
    Connection c = pool.poll(1, TimeUnit.SECONDS);
    return c != null ? c : DriverManager.getConnection(dsn);
}

public void releaseConnection(Connection c) { pool.offer(c); }
```

### Result

50 ms per request → ~0.1 ms (amortized).

In production, use HikariCP / `pgxpool` / `asyncpg.Pool`.

---

## Optimization 6: Generate Concrete Factories from a Spec

### Slow / verbose

```java
class WindowsGuiFactory implements GuiFactory { /* 50 lines */ }
class MacGuiFactory     implements GuiFactory { /* 50 lines */ }
class WebGuiFactory     implements GuiFactory { /* 50 lines */ }
class IosGuiFactory     implements GuiFactory { /* 50 lines */ }
class AndroidGuiFactory implements GuiFactory { /* 50 lines */ }
```

5 factories × 50 lines = 250 lines of mostly-mechanical code.

### Optimized — annotation processor or code generator

```java
@GenerateFactories(variants = {"windows", "mac", "web", "ios", "android"})
interface GuiFactory {
    Button   createButton();
    Checkbox createCheckbox();
}
```

An annotation processor generates the 5 Concrete Factories at build time. Only the `*Button` and `*Checkbox` classes are hand-written.

### Tradeoff

- Build complexity.
- Worth it for stable, large factory hierarchies.
- Examples: Dagger (DI), Lombok (boilerplate), MapStruct (mappers).

---

## Optimization 7: Use Functional Interfaces Instead of Class Hierarchy

### Slow / verbose

```java
interface GuiFactory {
    Button   createButton();
    Checkbox createCheckbox();
}

class WindowsGuiFactory implements GuiFactory { /* full class */ }
```

For many lightweight variants, the class boilerplate is heavy.

### Optimized — functional record

```java
public record GuiFactory(Supplier<Button> createButton, Supplier<Checkbox> createCheckbox) {}

GuiFactory windows = new GuiFactory(WindowsButton::new, WindowsCheckbox::new);
GuiFactory mac     = new GuiFactory(MacButton::new,     MacCheckbox::new);

// Usage
windows.createButton().get().render();
```

### Tradeoff

- More compact for simple cases.
- Loses subclassing-based extension.
- Combines well with DI (just register the record).

---

## Optimization 8: Batch Family Construction

### Slow code

```java
Button   b = factory.createButton();
Checkbox c = factory.createCheckbox();
Slider   s = factory.createSlider();
// 3 separate factory calls
```

For frequently-created complete families, three method dispatches is wasteful.

### Optimized — bundle method

```java
record Bundle(Button button, Checkbox checkbox, Slider slider) {}

interface GuiFactory {
    Bundle createBundle();
}

class WindowsGuiFactory implements GuiFactory {
    private final Button   B = new WindowsButton();
    private final Checkbox C = new WindowsCheckbox();
    private final Slider   S = new WindowsSlider();
    public Bundle createBundle() { return new Bundle(B, C, S); }
}
```

### Tradeoff

- Single dispatch returns the family.
- Loses ability to create only one product at a time.
- Mostly useful when callers always create the full set.

---

## Optimization 9: Compile-Time Factory Selection (Go Build Tags)

### Slow code

```go
func New(provider string) Provider {
    switch provider {
    case "aws":   return &awsProvider{}
    case "gcp":   return &gcpProvider{}
    case "local": return &localProvider{}
    }
    panic("unknown")
}
```

Every binary includes all three providers, even if only one is needed.

### Optimized — build tags

```go
//go:build aws
package cloud
func New() Provider { return &awsProvider{} }
```

```go
//go:build !aws && gcp
package cloud
func New() Provider { return &gcpProvider{} }
```

```go
//go:build !aws && !gcp
package cloud
func New() Provider { return &localProvider{} }
```

Build with `go build -tags aws` to include only AWS provider. Smaller binary, no unused code.

### Tradeoff

- Build complexity.
- Useful for embedded/mobile binaries where size matters.
- For cloud-native services, single binary with runtime selection is fine.

---

## Optimization 10: DI Container Replaces Hand-Written Factory

### Slow / verbose

```java
public class Application {
    public Application(GuiFactory factory) {
        this.button   = factory.createButton();
        this.checkbox = factory.createCheckbox();
    }
}
```

Plus: `WindowsGuiFactory`, `MacGuiFactory`, manual `pickFactory()`.

### Optimized — DI

```java
@Component
public class Application {
    private final Button button;
    private final Checkbox checkbox;

    public Application(Button button, Checkbox checkbox) {
        this.button = button;
        this.checkbox = checkbox;
    }
}

@Configuration
@Profile("windows")
class WindowsConfig {
    @Bean Button   button()   { return new WindowsButton(); }
    @Bean Checkbox checkbox() { return new WindowsCheckbox(); }
}

@Configuration
@Profile("mac")
class MacConfig {
    @Bean Button   button()   { return new MacButton(); }
    @Bean Checkbox checkbox() { return new MacCheckbox(); }
}
```

### Result

- No `GuiFactory` interface needed.
- Variants are configuration profiles.
- Test profile uses test products.
- Adding a variant = new `@Configuration` class.

### Tradeoff

- Requires DI framework.
- Implicit wiring (less greppable than `factory.create...`).
- For large codebases, DI usually wins.

---

## Optimization Tips

### How to find Abstract Factory bottlenecks

1. **Profile factory dispatch.** `pprof` / `async-profiler` / `pyperf` should show factory methods if they're hot.
2. **Look for unnecessary product allocation** — stateless products that get recreated every call.
3. **Look for new factory instances per request** — should be singletons.
4. **Check for megamorphic call sites** — JIT inlining warnings (`-XX:+PrintInlining`).
5. **Memory profile for retained products** — long-lived factory products can hold listener lists, caches.

### Optimization checklist

- [ ] Concrete Factories are singletons.
- [ ] Stateless products are cached.
- [ ] Heavy products are lazy-init.
- [ ] Hot loops are homogeneous (one factory).
- [ ] Heavy resources (DB, HTTP) are pooled.
- [ ] Boilerplate is generated for stable hierarchies.
- [ ] Functional records used for simple variants.
- [ ] Build tags for binary-size-sensitive deployments.
- [ ] DI replaces factory hierarchy for large codebases.

### Anti-optimizations

- ❌ **Caching mutable products.** Bug factory.
- ❌ **Eager init of heavy resources.** Slows startup.
- ❌ **Hot-swap factory under contention.** Wakes up old product references.
- ❌ **Generic-typed family** for runtime safety. Type erasure means it doesn't help.
- ❌ **Megamorphic call sites in hot loops.** Profile, then split.

---

## Summary

Most optimizations boil down to: **share what's safe to share, avoid allocation, keep hot paths monomorphic, and replace hand-written hierarchies with framework-generated ones when possible.**

Abstract Factory's overhead is dispatch + product construction. Both are amenable to standard optimizations: caching, pooling, JIT-friendly call sites.

---

[← Find-Bug](find-bug.md) · [Creational](../README.md) · [Roadmap](../../../README.md)

**Abstract Factory roadmap complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

**Next pattern:** Builder (pending).
