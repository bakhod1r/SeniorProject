# Template Method — Optimize

> **Source:** [refactoring.guru/design-patterns/template-method](https://refactoring.guru/design-patterns/template-method)

Each section presents a Template Method that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Mark template `final` for JIT inlining](#optimization-1-mark-template-final-for-jit-inlining)
2. [Optimization 2: Cache non-capturing lambdas](#optimization-2-cache-non-capturing-lambdas)
3. [Optimization 3: Async template with `thenCompose`](#optimization-3-async-template-with-thencompose)
4. [Optimization 4: Avoid stateful base class](#optimization-4-avoid-stateful-base-class)
5. [Optimization 5: Replace inheritance with functional template](#optimization-5-replace-inheritance-with-functional-template)
6. [Optimization 6: Sealed types for monomorphic dispatch](#optimization-6-sealed-types-for-monomorphic-dispatch)
7. [Optimization 7: Inline hot path manually for tight loops](#optimization-7-inline-hot-path-manually-for-tight-loops)
8. [Optimization 8: Precompute hooks at registration](#optimization-8-precompute-hooks-at-registration)
9. [Optimization 9: Drop hooks that are always no-op](#optimization-9-drop-hooks-that-are-always-no-op)
10. [Optimization 10: Move logic out of god-class base](#optimization-10-move-logic-out-of-god-class-base)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Mark template `final` for JIT inlining

### Before

```java
public abstract class Pipeline {
    public void run(Input input) {
        validate(input);
        process(input);
        cleanup();
    }
    protected abstract void process(Input input);
}
```

`run()` is virtual. JIT must check at every call.

### After

```java
public abstract class Pipeline {
    public final void run(Input input) {
        validate(input);
        process(input);
        cleanup();
    }
}
```

**Measurement.** JIT can devirtualize. Inline through `run` to its body. ~ns saved per call; matters in tight loops.

**Lesson:** Mark Template Methods `final`. Helps JIT and locks the algorithm.

---

## Optimization 2: Cache non-capturing lambdas

### Before

```java
public List<User> findUsers() {
    return jdbc.query("SELECT * FROM users",
        rs -> new User(rs.getString("id"), rs.getString("name"))   // lambda allocated per call
    );
}
```

Each invocation allocates a new lambda.

### After

```java
private static final RowMapper<User> USER_MAPPER = rs ->
    new User(rs.getString("id"), rs.getString("name"));

public List<User> findUsers() {
    return jdbc.query("SELECT * FROM users", USER_MAPPER);
}
```

**Measurement.** Allocation rate drops; same instance reused across calls.

**Trade-off.** Less inline; slightly less readable.

**Lesson:** Static-final non-capturing lambdas avoid allocation in hot paths.

---

## Optimization 3: Async template with `thenCompose`

### Before

```java
public Response process(Request req) {
    Request validated = validate(req).join();   // blocks!
    Request authed = authenticate(validated).join();   // blocks!
    return handle(authed).join();
}
```

Each `.join()` blocks the calling thread.

### After

```java
public CompletableFuture<Response> process(Request req) {
    return validate(req)
        .thenCompose(this::authenticate)
        .thenCompose(this::handle);
}
```

**Measurement.** Throughput rises with available threads. No blocking on async results.

**Lesson:** Async templates compose futures; never `.join()` mid-template.

---

## Optimization 4: Avoid stateful base class

### Before

```java
public abstract class Pipeline {
    private List<String> buffer = new ArrayList<>();   // shared mutable state

    public final void run(String input) {
        buffer.clear();   // reset
        process(input);
        save(buffer);
    }

    protected final void emit(String item) { buffer.add(item); }
    protected abstract void process(String input);
}
```

Concurrent calls race on `buffer`.

### After

```java
public abstract class Pipeline {
    public final void run(String input) {
        List<String> buffer = new ArrayList<>();
        process(input, buffer);
        save(buffer);
    }

    protected abstract void process(String input, List<String> buffer);
}
```

**Measurement.** Concurrent-safe. No synchronization needed.

**Lesson:** Stateless base classes are concurrency-friendly. Pass state through method parameters.

---

## Optimization 5: Replace inheritance with functional template

### Before

```java
public abstract class Importer {
    public final void run(String path) {
        var data = read(path);
        var rows = parse(data);
        save(rows);
    }
    protected abstract List<Row> parse(String data);
}

class CsvImporter extends Importer { /* ... */ }
class JsonImporter extends Importer { /* ... */ }
class XmlImporter extends Importer { /* ... */ }
```

Inheritance hierarchy; one class per format.

### After

```java
public final class Importer {
    public static void run(String path, Function<String, List<Row>> parser) {
        var data = read(path);
        var rows = parser.apply(data);
        save(rows);
    }
}

// Usage:
Importer.run("data.csv", CsvParser::parse);
Importer.run("data.json", JsonParser::parse);
```

**Measurement.** Less code, less hierarchy. Easier to test.

**Trade-off.** Less type structure; less self-documentation.

**Lesson:** Functional Template Method via callbacks is lighter and more flexible than inheritance.

---

## Optimization 6: Sealed types for monomorphic dispatch

### Before

```java
public abstract class Beverage {
    public final void make() { /* ... */ }
    protected abstract void brew();
}

class Tea extends Beverage { ... }
class Coffee extends Beverage { ... }
class Mocha extends Coffee { ... }
class Latte extends Coffee { ... }
// ... unbounded subclass set; megamorphic call site
```

JIT can't predict subclass types.

### After (Java 17+)

```java
public sealed abstract class Beverage permits Tea, Coffee {}
public sealed abstract class Coffee extends Beverage permits Mocha, Latte {}
```

Bounded set; pattern matching exhaustive; JIT specializes.

**Measurement.** Slight JIT improvement; refactoring safer.

**Lesson:** Sealed hierarchies enable JIT optimization and compile-time exhaustiveness.

---

## Optimization 7: Inline hot path manually for tight loops

### Before

```java
abstract class Updater {
    public final void tick(List<Entity> entities) {
        for (Entity e : entities) update(e);   // megamorphic if many Updater types
    }
    protected abstract void update(Entity e);
}
```

For 10K entities × 10 updater types: vtable cost ~30µs.

### After (manual specialization)

```java
public final class TightLoop {
    public static void tick(EntityList list) {
        switch (list.type) {
            case PHYSICS -> tickPhysics(list);
            case AI -> tickAi(list);
            case RENDER -> tickRender(list);
        }
    }

    private static void tickPhysics(EntityList list) {
        for (PhysicsEntity e : list.physicsEntities) {
            // fully monomorphic; JIT inlines
            e.position.add(e.velocity);
        }
    }
}
```

**Measurement.** Per-tick savings of µs; matters in 60+fps loops.

**Trade-off.** More code; less polymorphic flexibility. Use only in measured hot paths.

**Lesson:** For ultra-hot inner loops, hand-specialize beyond polymorphic dispatch.

---

## Optimization 8: Precompute hooks at registration

### Before

```java
public final void run() {
    for (Plugin p : plugins) {
        p.before();
        p.handle();
        p.after();
    }
}
```

Polymorphic dispatch per call per plugin.

### After

```java
private final List<Runnable> beforeHooks = new ArrayList<>();
private final List<Runnable> handleHooks = new ArrayList<>();
private final List<Runnable> afterHooks = new ArrayList<>();

public void register(Plugin p) {
    beforeHooks.add(p::before);
    handleHooks.add(p::handle);
    afterHooks.add(p::after);
}

public final void run() {
    for (Runnable r : beforeHooks) r.run();
    for (Runnable r : handleHooks) r.run();
    for (Runnable r : afterHooks) r.run();
}
```

**Measurement.** Tighter loops; better cache locality. Only registered hooks actually present.

**Lesson:** Convert plugin polymorphism to flat lists of method references; JIT optimizes better.

---

## Optimization 9: Drop hooks that are always no-op

### Before

```java
public abstract class Workflow {
    public final void run() {
        beforeStart();
        process();
        afterStart();
        beforeProcess();
        afterProcess();
        beforeEnd();
        afterEnd();
    }

    protected void beforeStart() {}
    protected void afterStart() {}
    protected void beforeProcess() {}
    protected void afterProcess() {}
    protected void beforeEnd() {}
    protected void afterEnd() {}
}
```

7 hooks; 5 always no-op in practice.

### After

```java
public abstract class Workflow {
    public final void run() {
        process();
    }

    protected abstract void process();
}
```

**Measurement.** Less code; less indirection; faster.

**Lesson:** Audit hooks. Drop those nobody uses. If everyone overrides one to inject the same thing, make it part of the template.

---

## Optimization 10: Move logic out of god-class base

### Before

```java
public abstract class GodBase {
    public final void run() {
        // 20 hooks
        beforeXxx(); xxx();
        beforeYyy(); yyy();
        beforeZzz(); zzz();
        // ...
    }

    // 20 abstract methods + 20 hooks
}
```

Subclasses must implement 20 things; most are stubs.

### After

```java
public final class CompositeWorkflow {
    private final List<Step> steps;
    public CompositeWorkflow(List<Step> steps) { this.steps = steps; }
    public void run() { for (Step s : steps) s.run(); }
}

interface Step { void run(); }
```

**Measurement.** Each Step is simple, focused, testable. No god-class; composition over inheritance.

**Lesson:** When Template Method becomes a god class, refactor to composition (Strategy / middleware / pipeline).

---

## Optimization Tips

- **Mark template `final`.** JIT inlining + algorithmic integrity.
- **Cache non-capturing lambdas as static fields.** No allocation.
- **Async templates compose futures.** Never `.join()` mid-template.
- **Stateless base class for concurrency.** Pass state through parameters.
- **Functional Template Method for flexibility.** Callbacks over inheritance.
- **Sealed hierarchies for bounded subclass sets.** JIT specialization.
- **Manual specialization for tight loops.** Last resort; profile first.
- **Precompute plugin hooks** as flat lists.
- **Drop unused hooks.** Audit periodically.
- **Refactor god-class templates** to composition.
- **Profile before optimizing.** Template Method dispatch is rarely the bottleneck.

[← Find Bug](find-bug.md) · [Behavioral patterns home](../README.md)
