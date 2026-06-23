# When Object Thinking Fails — Senior

> **What?** At senior level the question is no longer "OO or not OO" but *which mechanical cost am I paying, and is the JVM about to make that cost obsolete?* This page goes under the hood: object headers, virtual dispatch, GC pressure, Valhalla value classes, Loom virtual threads, ECS internals, the Vector API, and how a mature codebase mixes OO and data-oriented design without becoming incoherent.
> **How?** Profile before switching. Isolate the regions where Object Thinking actually hurts. Keep a rich domain core. Push hot kernels and high-throughput pipelines into a data-oriented layer. Treat the choice as a *local* engineering decision, not a global ideology.

---

## 1. JVM mechanics that make OO costly in hot paths

Object Thinking gives every concept a heap object, an identity, and dynamic dispatch. The JVM pays for all three on every invocation. Senior engineers need to be able to *quantify* these costs, not just gesture at "OO is slow".

- **Object header.** On HotSpot, with compressed oops, every object carries 12 bytes of header (mark word + compressed klass pointer). Without compressed oops it is 16 bytes. A `record Point(double x, double y)` therefore weighs 12 + 16 = 28 bytes, padded to 32. The *data* is 16 bytes. The header is 75% overhead.
- **Virtual dispatch.** Non-final instance methods go through the vtable. When the call site is *megamorphic* (more than two receiver types) the JIT cannot inline, and you pay an indirect branch plus a load from the klass.
- **GC pressure.** Heap churn from short-lived objects fills the young generation. Minor GCs are cheap but not free; a hot allocator at 500 MB/s of garbage will trigger young GCs every few hundred milliseconds and start touching survivor space.
- **Pointer chasing.** OO favors graphs of small objects. The CPU prefetcher cannot follow a pointer it has not yet seen, so cache misses dominate.

```java
// Symptomatic shape: 10M small objects, virtual dispatch in the loop.
interface Shape { double area(); }
record Circle(double r) implements Shape { public double area() { return Math.PI * r * r; } }
record Square(double s) implements Shape { public double area() { return s * s; } }

double sum(Shape[] shapes) {
    double total = 0;
    for (Shape s : shapes) total += s.area();   // virtual call per element
    return total;
}
```

The same loop on `double[] radii` plus a single `for` body inlines to a vectorized FMA. The price of `Shape.area()` is not the cost of the math; it is the cost of the *abstraction*.

A useful mental model: every Object Thinking design is also implicitly choosing a *memory layout* and a *dispatch strategy*. When the workload is small (a request, an aggregate, a UI event), the JVM hides the cost — the JIT inlines, escape analysis stack-allocates, and the GC barely notices. When the workload is large (millions of elements, microsecond budgets), the same costs surface as long tail latencies and CPU you cannot account for.

---

## 2. Project Valhalla and value classes

Valhalla is the JVM's structural answer to "OO is heavy". Once value classes ship, the gap between Object Thinking and data-oriented layout narrows considerably.

A *value class* (`value class Point { ... }`) declares an object whose identity is irrelevant. The JVM is allowed to:

- inline the fields directly into containers (no header per element),
- pass it in registers across method boundaries (scalarization),
- store an array of value classes as a flat array of fields (no pointer chasing).

```java
// Sketch of the post-Valhalla world.
value class Point2D {
    double x;
    double y;
    public double distanceTo(Point2D other) { ... }
}

Point2D[] cloud = new Point2D[10_000_000];   // flat, no headers, cache-friendly
```

This is the same physical layout as the `double[] xs; double[] ys` trick from the junior page, but you keep the *method* `distanceTo` attached. Object Thinking and data-oriented layout stop being enemies; they become the same thing.

Until Valhalla lands generally, this is the future you design *toward*. Keep your value-shaped types small, final, and identity-free, so flipping them to `value class` is a one-line migration. Specifically: avoid `synchronized` on them, never call `System.identityHashCode` against them, do not rely on `==` for equality, and do not stash one in a `WeakReference`. Each of those uses identity, and each will block the migration later.

---

## 3. Project Loom and virtual threads

Loom changes a different cost. Before virtual threads, "an object per concurrent unit of work" was prohibitively expensive — platform threads cost about 1 MB of stack each, so you could not have a million live actors. The reaction was to abandon OO for reactive streams, callback chains, and thread-pool-with-tasks designs.

```java
// Virtual threads make per-request OO viable again.
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request req : requests) {
        executor.submit(() -> {
            var session = new Session(req);   // a real, behavior-rich object
            session.handle();                 // blocking I/O is fine
        });
    }
}
```

A virtual thread costs a few hundred bytes plus a `Continuation` object. You can have a million of them. The implication for Object Thinking is large: the "OO is heavy because you need an object per connection" critique evaporates. The remaining heavy OO cases are *intra-request* (millions of small objects per request), not *inter-request* (millions of concurrent contexts).

Loom does not fix hot numeric loops. It does retire most of the historical reasons people fled OO for concurrency frameworks. A second-order consequence: structured concurrency (`StructuredTaskScope`) lets a request scope own its child tasks as *objects* with lifetimes and cancellation semantics. Object Thinking returns even to the concurrency layer that reactive programming had carved out.

---

## 4. ECS in detail: data layout, query patterns, system order

The junior page introduced ECS. At senior level you should understand the layout choices that make it fast.

- **Archetype storage.** Entities with the same component set live in the same chunk of memory (an *archetype*). Iterating "all entities with `Position` and `Velocity`" becomes a linear walk over one archetype's columns.
- **Sparse sets.** An alternative layout that indexes each component by entity ID; better for entities whose component set changes often.
- **System order.** Systems are scheduled in a known order per frame (`InputSystem -> PhysicsSystem -> CollisionSystem -> RenderSystem`). Parallelism is allowed when two systems read disjoint columns.

```java
// Archetype query, pseudo-Java.
Chunk[] chunks = world.chunksWith(Position.class, Velocity.class);
for (Chunk c : chunks) {
    double[] px = c.column(Position.class, "x");
    double[] py = c.column(Position.class, "y");
    double[] vx = c.column(Velocity.class, "x");
    double[] vy = c.column(Velocity.class, "y");
    int n = c.size();
    for (int i = 0; i < n; i++) {
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
    }
}
```

There is no `Entity` object in the inner loop. The CPU sees four `double[]` arrays and does linear arithmetic. The JIT vectorizes it. ECS is data-oriented design with a vocabulary attached.

The cost of ECS is conceptual: the code no longer reads like the domain. Use ECS where the *count* of entities matters more than the *expressiveness* of any one of them.

A second design lever in ECS is *component granularity*. Too many tiny components (`PositionX`, `PositionY`, `VelocityX`) and the archetype table fragments into hundreds of variants; too few coarse components (`Transform` mixing physics + render data) and unrelated systems contend on the same column. The sweet spot is one component per *system's worth* of access pattern.

---

## 5. SIMD and the Vector API for numeric kernels

For numeric kernels, the JVM exposes `jdk.incubator.vector` (the Vector API). Where Object Thinking would say "ask each pixel for its color", the Vector API says "process eight pixels per instruction".

```java
static final VectorSpecies<Float> SP = FloatVector.SPECIES_PREFERRED;

void scale(float[] data, float k) {
    int i = 0;
    int upper = SP.loopBound(data.length);
    var kv = FloatVector.broadcast(SP, k);
    for (; i < upper; i += SP.length()) {
        FloatVector v = FloatVector.fromArray(SP, data, i);
        v.mul(kv).intoArray(data, i);
    }
    for (; i < data.length; i++) data[i] *= k;   // tail
}
```

You cannot wrap this in `Pixel.scale(k)` without giving up the win. The Vector API is a language inside Java for the cases where you must pay attention to lane width, alignment, and tail handling. It is explicitly anti-OO at the loop level — and that is the right trade for the 1% of code that is numeric hot path.

The right organisational shape is a thin OO facade over a wide DoD kernel: `ImageOps.scale(image, k)` looks like an ordinary method, but its body is the vector loop above. Callers see a polymorphic API; the loop sees flat arrays. The Object Thinking discipline lives at the interface; the data-oriented discipline lives at the implementation.

---

## 6. Data-oriented design beyond games

Data-oriented design (DoD) is not just a game-engine technique. The same patterns appear wherever throughput matters more than expressiveness.

- **High-throughput trading.** Order books are arrays of price levels, not graphs of `Order` objects. LMAX Disruptor passes events through a ring buffer of pre-allocated slots — zero allocation in steady state.
- **Network packet processing.** Netty's `ByteBuf` is a column of bytes, not a `Packet` object graph. Parsers operate on offsets, not on parsed sub-objects, until they have to.
- **Stream processors.** Kafka Streams and Flink push records through operators as flat tuples, with optional state stores. The "OO domain object" appears only at boundaries.
- **Columnar analytics.** Arrow, Parquet, DuckDB: a `Trade` is not an object; it is a row index into many columnar arrays. Scans, filters, and aggregations are vectorized over columns.

The unifying observation: when the *cardinality of data* dominates the *cardinality of behavior*, columnar wins. Object Thinking optimizes the opposite case — few entities, many behaviors per entity.

A specific anti-pattern to recognise: building a Kafka consumer that materializes every record into a domain aggregate, applies one rule, and re-emits an event. The aggregate's invariants do not span records, so the OO model is doing no work; the GC pays the bill. Flatten the record, run the rule as a function, and keep the aggregate for the genuinely multi-record commands.

---

## 7. Hybrid systems: OO domain core + columnar history

Real systems rarely pick one paradigm. A mature trading or accounting service often looks like this:

- **Write side.** A behavior-rich domain model (`Order`, `Position`, `Trade`) enforces invariants. Each command produces immutable events.
- **Event log.** Events are appended to a log (Kafka, an event-sourced table). The log is *not* objects; it is a column of timestamps, types, and payloads.
- **Read side.** Read models are columnar, denormalized, and queried with SQL or vectorized operators. They never reconstruct the full domain graph.

```java
// Write side: rich domain.
public Result place(Order order, RiskRules rules) {
    if (!rules.allows(order)) return Result.rejected();
    return Result.accepted(order.commit());
}

// Read side: a query over columnar storage.
record TradeRow(long ts, String symbol, double px, long qty) {}
Stream<TradeRow> last24h = warehouse.scan("trades")
    .where("ts > ?", now - DAY)
    .as(TradeRow.class);
```

The same business concept lives in two shapes. The aggregate enforces "what can happen". The columnar history answers "what did happen, fast". Neither layer pretends to be the other.

---

## 8. When OO and FP collide: sealed records as a peace treaty

Sealed interfaces with record permits give Java a *tagged union* — the data structure functional programmers reach for and OO programmers used to fake with the Visitor pattern. They let you keep behavior on a type *and* exhaustively pattern-match on its shape.

```java
sealed interface PaymentResult permits Approved, Declined, RequiresReview {}
record Approved(String authCode, Money amount) implements PaymentResult {}
record Declined(String reason) implements PaymentResult {}
record RequiresReview(String caseId) implements PaymentResult {}

String describe(PaymentResult r) {
    return switch (r) {
        case Approved a -> "OK " + a.authCode();
        case Declined d -> "NO " + d.reason();
        case RequiresReview rr -> "HOLD " + rr.caseId();
    };
}
```

Senior taste: use sealed records when the *set of outcomes* is small and stable and the *operations* over them are open-ended. Use polymorphism when the *operations* are small and stable and the *set of subtypes* is open-ended. That is the Expression Problem, and Java now lets you choose the right side per case.

Sealed records also serve a practical second role: they make `switch` exhaustive at compile time, so the moment you add a new variant the compiler points at every site that has to handle it. That is structural enforcement of "no silent default branch" — a property OO polymorphism gives for free at the type level but loses the moment you reach for `instanceof`.

---

## 9. Profiling-driven paradigm shifts

A senior engineer does not switch paradigms on instinct. They switch on evidence.

Tools to know:

- **JFR (Java Flight Recorder).** Allocation pressure, hot methods, lock contention, GC pauses. Almost free in production.
- **async-profiler.** Flame graphs with native frames. The first place to look for "why is this slow".
- **JMH.** Microbenchmarks with proper warmup and dead-code elimination. Never trust a `System.nanoTime()` loop.
- **PrintCompilation / PrintInlining / `-XX:+UnlockDiagnosticVMOptions`.** Find megamorphic call sites and inlining failures.

Heuristics for *actually* switching paradigm in a hot region:

1. The region accounts for more than 5% of CPU in production (otherwise the change does not matter).
2. Allocation rate is over 100 MB/s, *or* the loop is dominated by virtual calls, *or* the cache miss rate is high.
3. You have a benchmark that reproduces the bottleneck outside production.
4. You can wall off the region behind a small API so the rest of the codebase stays OO.

If any of those four fails, keep the rich domain and move on.

A frequent failure mode is "speculative DoD": rewriting an aggregate as a column store because someone read a blog post. The rewrite usually wins a microbenchmark, loses a production benchmark, and costs three sprints of domain-model regression. Without a JFR profile pointing at the exact bottleneck, do not start.

---

## 10. Trade-offs of mixed paradigms in one codebase

A codebase that uses OO in the domain and DoD in hot loops pays real costs:

- **Cognitive switching.** Engineers must hold two mental models. A new hire sees aggregates and then sees `double[] xs`, `double[] ys`, and asks why.
- **Boundary cost.** Translating between OO objects and columnar buffers happens at the seam. If the seam moves on every commit, the translation churn dominates the savings.
- **Tooling.** Static analysis, refactoring tools, and code generators are built for OO. A column-of-bytes inner loop is largely unsupported by your IDE's refactoring engine.
- **Testing strategy.** OO favors fine-grained unit tests; DoD favors property tests and benchmarks. The two test pyramids look different.

The way to make the mix tolerable:

- **Stable seams.** Define one or two boundary types (an `Event`, a `Row`, a `Frame`) and translate at *those* boundaries only.
- **One paradigm per package.** Inside `domain.order`, it is OO. Inside `hot.matching`, it is DoD. No mixing within a class.
- **Document the rationale.** Every DoD module gets a short comment that says *what profile evidence* forced the shift. Without it, juniors will OO-ify the hot loop and undo the win.

---

## 11. The "rich-domain + pure-shell" sweet spot

For most enterprise systems, the configuration that ages best is:

- A **rich OO domain core**: aggregates, invariants, value objects, sealed result types.
- A **functional adapter layer**: pure mapping from DTOs to commands and from events to read models.
- A **thin imperative shell**: I/O, persistence, network, scheduling.
- A **small DoD island**, only where profiling demanded it.

```java
// Shell: imperative, side-effecting.
public OrderResponse handle(CreateOrderRequest req) {
    var cmd = mapper.toCommand(req);                    // FP adapter
    var snap = inventoryRepo.snapshotFor(cmd.items());  // I/O
    var result = orderService.place(cmd, snap);         // OO domain core
    persist(result);                                    // I/O
    return responseMapper.from(result);                 // FP adapter
}
```

This is not a compromise; it is a deliberate division of labor. OO carries domain meaning. FP carries shape transformations. Imperative carries side effects. DoD carries throughput. Each paradigm does what it is best at, and you stop arguing about which one wins overall.

The honest test for whether your codebase has the right shape: pick a random aggregate, trace a single command through it, and count the layers it crosses. If the count is *one* (a method on the aggregate), the model is healthy. If it is *six* (controller, mapper, service, helper, util, repository) without any of them carrying real domain rules, you have a service-oriented data-bag design with OO syntax — and the paradigm you are paying for is not the one you are getting.

---

## 12. Quick rules

- [ ] Measure header overhead and allocation rate before declaring OO "too slow".
- [ ] Treat sealed records as the bridge between FP tagged unions and OO polymorphism.
- [ ] Loom retires the "one object per connection is too expensive" critique; do not cite it anymore.
- [ ] Design value-shaped types so they can become `value class` with one keyword.
- [ ] ECS is DoD with a vocabulary; reach for it when *entity count* dominates *behavior count*.
- [ ] Vector API and SIMD belong inside small, well-named numeric kernels — never spread across the domain.
- [ ] Hybrid systems should have *stable seams*; translation churn eats the throughput win.
- [ ] Switch paradigm only when production profiles, not opinions, demand it.
- [ ] Rich OO core, pure FP adapter, thin imperative shell, small DoD island — that is the long-lived shape.

---

## 13. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| Side-by-side OO vs DoD vs functional refactors of the same task  | `middle.md`        |
| Driving paradigm choices on a team without dogma                 | `professional.md`  |
| Hands-on "pick the paradigm" exercises                           | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |

---

**Memorize this:** Object Thinking's costs are concrete — headers, dispatch, GC, pointer chasing — and the JVM is steadily closing the gap with Valhalla, Loom, and the Vector API. A senior keeps a rich OO domain core, a pure FP adapter layer, and a small DoD island where profiling proves it earns its keep; paradigm shifts are local engineering decisions, justified by evidence and walled off behind stable seams.
