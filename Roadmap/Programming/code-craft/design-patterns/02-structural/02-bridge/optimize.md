# Bridge — Optimize

> **Source:** [refactoring.guru/design-patterns/bridge](https://refactoring.guru/design-patterns/bridge)

Each section presents a Bridge that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Stateless implementors share one instance](#optimization-1-stateless-implementors-share-one-instance)
2. [Optimization 2: Group by type to avoid megamorphism (Java)](#optimization-2-group-by-type-to-avoid-megamorphism-java)
3. [Optimization 3: Batch the implementor call](#optimization-3-batch-the-implementor-call)
4. [Optimization 4: Memoize values across the bridge](#optimization-4-memoize-values-across-the-bridge)
5. [Optimization 5: Pointer receivers + reused interface (Go)](#optimization-5-pointer-receivers-reused-interface-go)
6. [Optimization 6: Decorator stack on implementor](#optimization-6-decorator-stack-on-implementor)
7. [Optimization 7: Lazy-construct heavy implementors](#optimization-7-lazy-construct-heavy-implementors)
8. [Optimization 8: Drop the Bridge when only one implementor exists](#optimization-8-drop-the-bridge-when-only-one-implementor-exists)
9. [Optimization 9: Specialize hot-path combinations](#optimization-9-specialize-hot-path-combinations)
10. [Optimization 10: Data-oriented Bridge for large arrays](#optimization-10-data-oriented-bridge-for-large-arrays)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Stateless implementors share one instance

### Before

```java
for (User u : users) {
    Logger logger = new Logger(new ConsoleSink());   // new ConsoleSink per user!
    logger.info("processing " + u.id());
    process(u);
}
```

**Cost:** Every loop iteration allocates a fresh `ConsoleSink` (and `Logger`). Even if the sink is stateless, allocation costs and GC pressure add up. With 1M users, a million pointless allocations.

### After

```java
private static final Sink SHARED_SINK = new ConsoleSink();
private static final Logger SHARED_LOGGER = new Logger(SHARED_SINK);

for (User u : users) {
    SHARED_LOGGER.info("processing " + u.id());
    process(u);
}
```

**Measurement.** GC time drops; allocation profile flattens.

**Lesson:** Stateless implementors are reusable. Construct once, share.

---

## Optimization 2: Group by type to avoid megamorphism (Java)

### Before

```java
// 8 shape types, 4 renderer types, fully shuffled.
List<Shape> all = ...;
for (Shape s : all) s.draw();
```

**Cost:** Both the `Shape.draw()` site and the `Renderer.render*` site go megamorphic. JIT inline caches fail; every call is a vtable lookup.

### After

```java
Map<Class<?>, List<Shape>> byClass = all.stream()
    .collect(Collectors.groupingBy(Shape::getClass));

byClass.forEach((cls, group) -> {
    for (Shape s : group) s.draw();   // monomorphic at this site
});
```

**Measurement.** JMH: 5-8 ns/call → 1-2 ns/call after grouping. Throughput up ~3-4×.

**Lesson:** When both sides of a Bridge are polymorphic, group iteration to keep call sites monomorphic.

---

## Optimization 3: Batch the implementor call

### Before

```java
public void render(List<Shape> shapes) {
    for (Shape s : shapes) renderer.render(s);   // 1 call per shape
}
```

### After (when the implementor supports batches)

```java
public void render(List<Shape> shapes) {
    renderer.renderAll(shapes);   // 1 call total
}
```

**Cost.** Per-call overhead, GPU command-buffer flushes, network round-trips — all multiplied by N before, paid once after.

**Measurement.** A batched OpenGL renderer drops a 4 ms per-frame loop to 0.4 ms. Database batch insert: 100× faster.

**Lesson:** If the implementor supports batching, expose batched methods on the abstraction. Don't hide it behind a per-item interface.

---

## Optimization 4: Memoize values across the bridge

### Before

```java
public class Circle extends Shape {
    public Geometry geometry() { return computeTessellation(); }   // expensive
}

public class VectorRenderer implements Renderer {
    public void renderShape(Shape s) {
        Geometry g = s.geometry();          // call 1
        if (looksWeird(g)) g = s.geometry(); // call 2 — recomputes!
        ...
    }
}
```

**Cost:** Tessellation can run twice. Profiler shows 60% of time in geometry computation.

### After

```java
public abstract class Shape {
    private Geometry cached;
    public final Geometry geometry() {
        if (cached == null) cached = computeGeometry();
        return cached;
    }
    protected abstract Geometry computeGeometry();
}
```

**Measurement.** Frame time halves on geometry-heavy scenes. Memory cost: one extra reference per shape.

**Lesson:** When the abstraction has expensive computed values that the implementor calls multiple times, memoize on the abstraction.

---

## Optimization 5: Pointer receivers + reused interface (Go)

### Before

```go
type Renderer interface { Render(s Shape) }

type RasterRenderer struct{ /* ... */ }
func (r RasterRenderer) Render(s Shape) { ... }   // value receiver

for _, s := range shapes {
    var r Renderer = RasterRenderer{...}   // allocates per iter!
    r.Render(s)
}
```

**Cost:** Each `var r Renderer = RasterRenderer{}` allocates a copy on the heap (interface needs a stable pointer). Per iteration → GC churn.

### After

```go
func (r *RasterRenderer) Render(s Shape) { ... }   // pointer receiver

renderer := &RasterRenderer{...}
var r Renderer = renderer
for _, s := range shapes {
    r.Render(s)
}
```

**Measurement.** `pprof -alloc_objects`: zero allocations in the loop. CPU drops slightly; GC pauses drop more.

**Lesson:** In Go, Bridge implementors should use pointer receivers and be passed as pointers through interfaces. Construct once.

---

## Optimization 6: Decorator stack on implementor

### Before

The abstraction does retries and metrics inline:

```java
public abstract class Notification {
    protected final Channel ch;
    public void send(String to, String body) {
        long start = System.nanoTime();
        for (int attempt = 0; attempt < 3; attempt++) {
            try { ch.send(to, body); break; }
            catch (TransientException e) { /* sleep */ }
        }
        metrics.record(System.nanoTime() - start);
    }
}
```

### After

Move retries and metrics into Decorators on the implementor:

```java
public class RetryingChannel implements Channel {
    private final Channel inner; private final int attempts;
    public void send(String to, String body) {
        for (int i = 0; i < attempts; i++) {
            try { inner.send(to, body); return; }
            catch (TransientException e) { if (i == attempts - 1) throw e; }
        }
    }
}

public class MeteredChannel implements Channel {
    private final Channel inner; private final Metrics m;
    public void send(String to, String body) {
        long start = System.nanoTime();
        try { inner.send(to, body); }
        finally { m.record(System.nanoTime() - start); }
    }
}

// Wiring
Channel ch = new MeteredChannel(new RetryingChannel(new EmailChannel(client), 3), metrics);
Notification n = new Welcome(ch);
```

**Measurement.** Notification's logic shrinks; decorators are independently testable; new abstractions get retries/metrics for free.

**Lesson:** Cross-cutting concerns belong in decorators on the implementor side, not in the abstraction.

---

## Optimization 7: Lazy-construct heavy implementors

### Before

```java
public class Logger {
    private final Sink fileSink = new FileSink("/var/log/app.log");   // opens file at load
    private final Sink netSink  = new NetworkSink("logs.example.com:514"); // opens socket
}
```

**Cost:** Every `Logger` constructed opens a file *and* a socket — even if you only ever use the console. Boot time and resource usage explode.

### After

```java
public class Logger {
    private final Supplier<Sink> sinkSupplier;
    private Sink resolved;

    public Logger(Supplier<Sink> s) { this.sinkSupplier = s; }

    private Sink sink() {
        if (resolved == null) resolved = sinkSupplier.get();
        return resolved;
    }

    public void info(String msg) { sink().emit("INFO", msg); }
}
```

Or use a DI container with lazy beans.

**Measurement.** Boot time drops from 10s to 1s on test runs that only use console logging.

**Lesson:** Implementors with heavy initialization should be lazy. Construct on first use.

---

## Optimization 8: Drop the Bridge when only one implementor exists

### Before

```java
public interface Storage { void save(...); byte[] load(...); }
public final class FileStorage implements Storage { ... }   // only implementor

public class Repo {
    private final Storage s;
    public Repo(Storage s) { this.s = s; }
}
```

After 18 months, still no second implementor.

### After

```java
public final class FileStorage { void save(...); byte[] load(...); }

public class Repo {
    private final FileStorage s;
    public Repo(FileStorage s) { this.s = s; }
}
```

**Measurement.** Code size drops, IDE navigation faster, dispatch slightly faster (CHA more aggressive).

**Caveat:** if the interface enables fast tests via a fake, that fake counts as a second implementor — keep it.

**Lesson:** Don't keep abstractions you never benefit from. Reverse over-engineering aggressively.

---

## Optimization 9: Specialize hot-path combinations

### Before

Generic Bridge handles all combinations through dispatch:

```java
for (Sprite s : sprites) renderer.render(s);   // 10M calls/frame
```

### After

For the *single hottest* combination (e.g., 95% are `Sprite × VectorRenderer`), specialize:

```java
if (renderer instanceof VectorRenderer && allSprites(allItems)) {
    VectorRenderer vr = (VectorRenderer) renderer;
    for (Sprite s : allItems) vr.renderSprite(s);   // monomorphic, inlinable
} else {
    for (Drawable d : allItems) renderer.render(d);   // generic path
}
```

**Cost.** A small `instanceof` check; one specialized loop alongside the generic one.

**Measurement.** Hot-path FPS doubles in profiler-driven test scenes.

**Lesson:** Profile-guided specialization is appropriate when one combination dominates. Don't preemptively unroll all combinations.

---

## Optimization 10: Data-oriented Bridge for large arrays

### Before

Array of pointers to Bridges:

```go
sprites := make([]Sprite, 1_000_000)   // each is a pointer to an obj
for i := range sprites { sprites[i].Draw() }   // dereferences scattered memory
```

**Cost:** Cache misses dominate; each sprite + its renderer + the renderer's vtable live in scattered cache lines. Per-frame budget blown.

### After

Struct of arrays (data-oriented design):

```go
type Sprites struct {
    Xs, Ys, Sizes []float32
    Renderer      Renderer
}

func (sp *Sprites) Draw() {
    sp.Renderer.RenderBatch(sp.Xs, sp.Ys, sp.Sizes)   // one call, contiguous memory
}
```

**Cost:** Architectural shift; not always feasible.

**Measurement.** Game engines see 2-5× FPS improvements on heavy sprite scenes.

**Lesson:** Bridge with array-of-objects is fine for thousands; for millions, consider struct-of-arrays + batched implementor calls.

---

## Optimization Tips

1. **Profile before optimizing.** "Bridge is slow" is rarely the actual cause. Most slowness is in the implementor's I/O.
2. **Stateless implementors are free to share.** Avoid per-call allocations.
3. **Watch for megamorphism.** Two-axis polymorphism at the same site degrades JIT optimization. Group by type.
4. **Batch when the implementor supports it.** Per-item interfaces hide batching power.
5. **Memoize across the bridge.** Computations called multiple times by the implementor should be cached on the abstraction.
6. **Use pointer receivers in Go.** Avoid per-iteration interface allocation traps.
7. **Move cross-cutting concerns into decorators on the implementor.** Keep the abstraction focused.
8. **Lazy-construct heavy implementors.** Don't pay for what's not used.
9. **Drop the Bridge if it never paid off.** Reverse over-engineering aggressively.
10. **Specialize the hot path.** When 95% of calls are one combination, write a fast loop for it; keep the generic path for the rest.
11. **Don't optimize what the JIT erases.** Microbench first; HotSpot often makes Bridge dispatch free.
12. **Optimize for change too.** A clean Bridge that's easy to swap is more valuable than a tweaked one nobody understands.

---

← Back to Bridge folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**You've completed the Bridge pattern suite.** Continue to: [Composite](../03-composite/junior.md) · [Decorator](../04-decorator/junior.md) · [Facade](../05-facade/junior.md)
