# When Object Thinking Fails — Junior

> **What?** Object Thinking is a powerful default for designing systems that model a behaviour-rich domain — but it is *not* a universal solvent. In several common situations, forcing the metaphor produces worse code: clumsy classes, wasted memory, opaque data flow, or rigid systems where a simple function would do. This page lists the kinds of problem where you should *deliberately* step outside Object Thinking and use a different paradigm.
> **How?** Recognize the smells of "wrong-paradigm fit" early — too many classes for data that has no behavior; awkward agent metaphors; performance hot paths drowning in indirection. Switch to functional, data-oriented, or imperative styles in those regions of the codebase, and don't apologize for it.

---

## 1. Why this section exists

The previous six subsections of this chapter sell a strong case for behavior-first design: anthropomorphism, Tell-Don't-Ask, RDD, CRC cards, rich domain models. If you internalize them without an honest counterweight, you'll start applying Object Thinking to *every* problem — including ones where it makes the code worse.

This isn't a betrayal of OOP. It's professional maturity. The same engineer who builds a beautiful behavior-first `Order` aggregate can also write a 20-line function that reads a CSV, transforms it, and exits — without pretending the file is an "Agent" with an "intention" to be "parsed". Good engineers know which tool to use, and Object Thinking is *one* tool among several.

---

## 2. Data pipelines and transformations

A common case: you have data going in, transformations applied, data coming out. There is no domain rule, no invariant, no entity with identity. Just `input → step1 → step2 → step3 → output`.

```java
// Functional / data-oriented — natural fit
record CsvRow(String date, String amount, String memo) {}
record Transaction(LocalDate date, Money amount, String memo) {}

List<Transaction> txs = lines
    .map(CsvRow::parse)
    .filter(r -> !r.memo().isBlank())
    .map(r -> new Transaction(LocalDate.parse(r.date()),
                              Money.parse(r.amount()),
                              r.memo()))
    .toList();
```

Forcing OO on this gives you `CsvParser`, `TransactionMapper`, `MemoFilter`, `TransactionPipeline`, `TransactionPipelineFactory` — all of which can be replaced by five lines of stream code. The OO version isn't *wrong*, but it's heavier than the problem deserves.

**Rule of thumb:** if the data has no identity, no lifecycle, and no rules of its own, model it with **records** and **functions** (or streams). Don't dress it up as agents.

---

## 3. Stateless mathematical operations

Pure computation — geometry, statistics, signal processing, encoding — usually has no domain object to live on.

```java
// Object Thinking forced:
class GeometryCalculator {
    public double distance(Point a, Point b) { ... }
    public double area(Polygon p) { ... }
    public Polygon convexHull(Set<Point> points) { ... }
}

// Pure functions, statically dispatched:
public final class Geometry {
    private Geometry() {}
    public static double distance(Point a, Point b) { ... }
    public static double area(Polygon p) { ... }
    public static Polygon convexHull(Set<Point> points) { ... }
}
```

Neither is wrong, but the second is more honest: these operations have no state, no role, no identity. They're functions. A class with a private constructor and only `static` methods is a *function namespace*, and Java now offers cleaner alternatives like utility records or method references on records themselves.

`Math.sqrt(2.0)` is not "asking the math class for a square root". It's a function call. Stop trying to anthropomorphize `Math`.

---

## 4. Performance-critical hot paths

Object Thinking encourages many small objects, virtual method dispatch, and indirection. In hot paths (rendering loops, signal processing, packet processing, JIT-sensitive numeric kernels), each of these has a cost:

- **Allocation cost** — heap allocations stress the GC.
- **Indirection** — virtual calls inhibit inlining and prevent escape analysis.
- **Memory locality** — small objects scattered in memory cause cache misses.
- **Object headers** — every Java object has 12–16 bytes of header overhead.

For 10 million `Point2D` objects, the headers alone may dwarf the actual data.

```java
// Object-oriented: 10M points = 10M heap objects
record Point2D(double x, double y) {}
Point2D[] points = ...;   // each point on heap, headers + pointer chase

// Data-oriented: two arrays, no headers, sequential memory
double[] xs = new double[10_000_000];
double[] ys = new double[10_000_000];
```

The second form is what game engines and high-performance Java code actually use. It's the **Structure of Arrays (SoA)** layout, the opposite of OO's **Array of Structures**. Project Valhalla aims to close this gap with value classes, but for now, hot paths often need to abandon Object Thinking.

If your code runs once per request, this doesn't matter — keep your nice OO. If it runs 10 million times per request, profile and consider DoD.

---

## 5. Game development and ECS

Game engines famously dropped deep inheritance hierarchies (`Enemy extends Character extends GameObject`) in favor of **Entity-Component-System (ECS)** architectures.

In ECS:

- An **Entity** is just an ID (an integer).
- **Components** are pure data structs (`Position`, `Velocity`, `Health`).
- **Systems** are functions that loop over all entities with a given component combination and transform them.

```java
// Not OO:
class PhysicsSystem {
    void update(World w, double dt) {
        for (Entity e : w.with(Position.class, Velocity.class)) {
            Position p = e.get(Position.class);
            Velocity v = e.get(Velocity.class);
            p.x += v.x * dt;
            p.y += v.y * dt;
        }
    }
}
```

There is no `Enemy.move()`. There is a `PhysicsSystem` that moves *anything that has a position and a velocity*. The data is separate from the behavior. Inheritance is gone. Composition is by *adding components* to an entity, not by extending a class.

ECS exists because behavior-first OO doesn't scale to *thousands of entities with overlapping but not identical behaviors*. A shooter game has player, enemy, projectile, particle, pickup — each shares some behaviors with others but no clean hierarchy works. ECS sidesteps the question.

---

## 6. ETL, reporting, analytics

When the goal is "read a lot of data, transform it, write a lot of data" — without business rules in between — OO is friction.

- **ETL jobs:** ingest 10 GB, project, join, aggregate, write to warehouse. Best modeled with SQL or Spark, not with `IngestionService → TransformationService → WarehouseWriter`.
- **Reports:** select-where-group-by from a database, produce a PDF. The interesting logic is the SQL; the Java around it is glue.
- **Analytics events:** record what users do, ship to a pipeline. Each event is a record with no behavior of its own.

Trying to anthropomorphize a row in a fact table ("the row chooses which dimension to join with") is absurd. Use SQL where it belongs.

---

## 7. Configuration and DTOs

Configuration objects, request/response DTOs, JSON envelopes, protobuf messages — all of these are *intentionally* anemic. Their job is to cross a boundary (over the wire, into a file, between processes) and they should be:

- **Simple** (no behavior).
- **Serializable** (no surprises in serialization).
- **Immutable** (no mid-flight mutation).
- **Self-validating where needed**, but otherwise *just data*.

```java
public record CreateOrderRequest(
        String customerId,
        List<LineItem> items,
        ShippingAddress address) {}
```

Telling a `CreateOrderRequest` to "place itself" is a category error. It's not an order — it's a *request to place an order*. Its job is to be parsed, validated, and translated into a real domain operation. That's it. Make it a `record` and move on.

---

## 8. Functional cores, imperative shells

Gary Bernhardt's pattern: keep the *core* of your application *pure* (no I/O, no state, functions over immutable data) and push side effects to the *shell* (the thin imperative layer that talks to the outside world).

This isn't anti-OO, but it does shift the balance. The pure core is *functional*; the shell is *imperative*; the domain *aggregates* — the OO heart — sit in between.

```java
// Pure functional core:
public static OrderResult place(Cart cart, Inventory snapshot, Pricing rules) {
    if (!snapshot.has(cart.items())) return OrderResult.outOfStock();
    Money total = rules.priceFor(cart);
    return OrderResult.placed(cart, total);
}

// Imperative shell:
public void placeOrder(String userId, CartDto dto) {
    var cart = Cart.from(dto);
    var snapshot = inventoryRepo.snapshot();
    var rules = pricingRepo.current();
    var result = OrderDomain.place(cart, snapshot, rules);   // ← pure core
    switch (result) {
        case Placed p -> orderRepo.save(p.order());
        case OutOfStock o -> notifier.notifyUnavailable(userId);
    }
}
```

The core has no side effects and is trivially testable. The shell handles persistence, network, time — and is more imperative than OO. Both layers are deliberately *not* full Object Thinking.

---

## 9. The honest critique: OO isn't always the right paradigm

Several respected engineers have argued, in various forms:

- **Joe Armstrong** (Erlang creator): "You wanted a banana but you got a gorilla holding the banana." OO drags state and inheritance into everything.
- **Steve Yegge** ("Execution in the Kingdom of Nouns", 2006): Java's class-only world forces verbs to become nouns (`OrderProcessor`), distorting the model.
- **John Carmack**: noted that game programmers had to abandon deep OO hierarchies for ECS because OO didn't scale.
- **Casey Muratori** (game dev): "Compression-Oriented Programming" / data-oriented design.

You don't have to agree with all of them. But every one of these critiques points at a real limitation of OO in their domain. Acknowledging the limits is part of using OO well.

---

## 10. When *to* use Object Thinking, still

After all the warnings above — when *should* you reach for behavior-first OO?

- Rich business domains with **rules, states, and identity**: orders, accounts, reservations, loans, contracts, insurance claims.
- Long-lived **aggregates** with invariants that span multiple fields.
- Systems where multiple **stakeholders** speak about behavior in natural language (anthropomorphism pays off).
- Code that has to **survive years of requirement changes** — rich domain models tend to localize change better than data-bag-plus-service designs.

In other words: where the previous six subsections shine. Don't abandon Object Thinking. Just don't apply it to a CSV importer.

---

## 11. Quick rules

- [ ] No identity + no lifecycle + no invariants → records and functions, not classes.
- [ ] Pure computation → static functions (or instance methods on the value type itself).
- [ ] Hot path with 10M+ allocations → consider data-oriented design.
- [ ] Many overlapping behaviors across many entities → consider ECS or composition.
- [ ] ETL / analytics / reporting → SQL or stream operators, not service classes.
- [ ] DTOs and configs → anemic records, on purpose.
- [ ] Side-effect-heavy code → push into an imperative shell, keep the core pure.

---

## 12. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| Side-by-side OO vs DoD vs functional refactors of the same task  | `middle.md`        |
| ECS, Valhalla, project Loom; when JVM mechanics matter           | `senior.md`        |
| Driving paradigm choices on a team without dogma                 | `professional.md`  |
| Hands-on "pick the paradigm" exercises                           | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |

---

**Memorize this:** Object Thinking is a default, not a religion. When the data has no identity, the path is hot, the domain is computational, or the boundary is over-the-wire — use a different paradigm without guilt. Knowing *when not to* anthropomorphize is part of professional taste.
