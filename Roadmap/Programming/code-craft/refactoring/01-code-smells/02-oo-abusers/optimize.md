# OO Abusers — Optimize

> 12 inefficient implementations of OO Abuser fixes — each looks clean but has measurable performance issues.

---

## Optimize 1 — Megamorphic call site (Java)

```java
interface Shape { double area(); }
record Circle(double r) implements Shape { ... }
record Square(double s) implements Shape { ... }
record Triangle(double b, double h) implements Shape { ... }
record Pentagon(...) implements Shape { ... }
record Hexagon(...) implements Shape { ... }
record Octagon(...) implements Shape { ... }

// Hot loop:
double total = 0;
for (Shape s : shapes) total += s.area();  // megamorphic
```

**Issue:** 6 different concrete types observed at one call site → JIT cannot devirtualize → vtable cost per call.

**Fix 1:** group by type before processing.

```java
Map<Class<?>, List<Shape>> byType = shapes.stream().collect(groupingBy(Object::getClass));
double total = 0;
for (var entry : byType.entrySet()) {
    for (Shape s : entry.getValue()) total += s.area();  // monomorphic per group
}
```

**Fix 2:** if shapes really are mixed, accept the cost — it's still O(N) and probably fine. Profile first.

**Measurement:** with 6 types: monomorphic ≈ 1ns per call; megamorphic ≈ 6-10ns. The cost is real but rarely the bottleneck.

---

## Optimize 2 — Polymorphism allocation pressure (Java)

```java
sealed interface Event { void handle(); }
record OrderPlaced(OrderId id) implements Event { ... }

// Hot path emits 1M events/sec:
eventBus.publish(new OrderPlaced(id));  // allocation per event
```

**Issue:** every event is an allocation. 1M/sec × 16+ bytes = ~16 MB/sec of GC pressure.

**Fix 1:** event pooling.

```java
class EventPool {
    private final ArrayDeque<OrderPlaced> pool = new ArrayDeque<>();
    
    OrderPlaced acquire(OrderId id) {
        OrderPlaced e = pool.poll();
        if (e == null) return new OrderPlaced(id);
        e.reset(id);  // requires mutable record-like class, not record
        return e;
    }
    void release(OrderPlaced e) { pool.add(e); }
}
```

**Trade-off:** mutable records, threading complexity, "use-after-release" bugs.

**Fix 2:** primitive event encoding. Skip the object entirely:

```java
eventBus.publish(EVENT_ORDER_PLACED, orderId.toLong());
```

Loses type safety. Use only when profiling proves the allocation matters.

---

## Optimize 3 — Sealed type pattern match repeated (Java)

```java
sealed interface Notification permits Email, Sms, Push {}

// Same pattern match in 5 places:
switch (n) {
    case Email e -> ...;
    case Sms s -> ...;
    case Push p -> ...;
}
```

**Issue:** 5 places to edit when adding a new variant. Linear pattern-match dispatch.

**Fix:** put the operation on the type.

```java
sealed interface Notification permits Email, Sms, Push {
    void send();
    String displayText();
    boolean isUrgent();
}
```

Each variant implements all operations once. The 5 switch sites become 5 calls to typed methods.

This is the "expression problem" trade-off: do you want to add operations easily (pattern matching wins) or types easily (polymorphism wins)? Pick based on what you'll add more often.

---

## Optimize 4 — Hash-based dispatch instead of switch (Java)

```java
// Original switch:
String displayName(String tier) {
    switch (tier) {
        case "BRONZE": return "Bronze Member";
        case "SILVER": return "Silver Member";
        case "GOLD":   return "Gold Member";
        case "PLATINUM": return "Platinum Member";
    }
    throw new IllegalStateException();
}

// "Refactored":
private static final Map<String, String> NAMES = Map.of(
    "BRONZE", "Bronze Member",
    "SILVER", "Silver Member",
    "GOLD", "Gold Member",
    "PLATINUM", "Platinum Member"
);

String displayName(String tier) { return NAMES.get(tier); }
```

**Issue:** the map lookup is slower than the switch (hash + compare + memory load). For small fixed sets, switch wins.

**Best for small sets (≤8):** switch.
**Best for large sets:** map.

**Best for *any* size:** convert `String tier` to `Tier enum` (Primitive Obsession cure) — then use `tier.displayName()` (zero overhead).

---

## Optimize 5 — Strategy pattern with stateless objects (Java)

```java
interface PricingStrategy {
    BigDecimal price(Item item);
}

class StandardPricing implements PricingStrategy {
    public BigDecimal price(Item item) { return item.basePrice(); }
}

// Created per use:
BigDecimal p = new StandardPricing().price(item);
```

**Issue:** `StandardPricing` has no state. Constructing it per call is waste.

**Fix:** singleton.

```java
enum StandardPricing implements PricingStrategy {
    INSTANCE;
    public BigDecimal price(Item item) { return item.basePrice(); }
}

// Use:
BigDecimal p = StandardPricing.INSTANCE.price(item);
```

For stateless strategies, an `enum` singleton is idiomatic. JIT can fully devirtualize.

---

## Optimize 6 — Refused Bequest workaround with delegation overhead (Python)

```python
class CachedDict:
    def __init__(self):
        self._data = {}
    
    def __getitem__(self, key): return self._data[key]
    def __setitem__(self, key, val): self._data[key] = val
    def __contains__(self, key): return key in self._data
    def __len__(self): return len(self._data)
    def __iter__(self): return iter(self._data)
    # ... 15 more dunder methods to fully wrap dict
```

**Issue:** explicit forwarding of every dict method. Pure overhead — each method call goes through Python's dispatch + the wrapper's lookup.

**Fix 1 (Python idiom):** subclass `UserDict` (designed for safe subclassing).

```python
from collections import UserDict

class CachedDict(UserDict):
    pass  # no extra wrapping needed; UserDict provides correct base
```

**Fix 2:** subclass `dict` if Refused Bequest doesn't apply (i.e., you want all dict operations).

The original `__delegate to self._data` pattern is right when you genuinely want to *restrict* operations (like the Java `ReadOnlyFile` case). But if you want all operations, just subclass.

---

## Optimize 7 — Visitor pattern for stable types (Java)

```java
interface ExprVisitor<R> {
    R visitLiteral(Literal e);
    R visitBinaryOp(BinaryOp e);
    R visitVariable(Variable e);
}

abstract class Expr {
    public abstract <R> R accept(ExprVisitor<R> v);
}
```

**Issue:** double-dispatch indirection. Each `accept` is a virtual call → which calls the visitor method → which is another virtual call.

**Fix (modern Java):** sealed types + pattern matching. One direct dispatch.

```java
sealed interface Expr permits Literal, BinaryOp, Variable {}

double evaluate(Expr e) {
    return switch (e) {
        case Literal l -> l.value();
        case BinaryOp b -> /* ... */;
        case Variable v -> /* ... */;
    };
}
```

Pattern matching is faster (single instanceof chain or jump table) and easier to read.

Visitor is right when:
- Your language has no pattern matching (Java < 17).
- You can't modify the AST classes (third-party types).
- You have many operations and few types — visitor centralizes operations, sealed types centralize types.

---

## Optimize 8 — Polymorphism with reflection (Java)

```java
// Anti-pattern:
Class<?> handlerClass = Class.forName("com.example." + eventType + "Handler");
EventHandler handler = (EventHandler) handlerClass.getDeclaredConstructor().newInstance();
handler.handle(event);
```

**Issue:** `Class.forName` + reflection + new instance per event = ~1000x slower than a static dispatch table.

**Fix:** registry initialized once.

```java
static final Map<String, EventHandler> HANDLERS = Map.of(
    "OrderPlaced", new OrderPlacedHandler(),
    "PaymentReceived", new PaymentHandler(),
    // ...
);

EventHandler h = HANDLERS.get(eventType);
if (h == null) throw new UnknownEventException(eventType);
h.handle(event);
```

Reflection-based dispatch is the most expensive form of "polymorphism." Avoid in hot paths. Use a registry initialized at startup.

---

## Optimize 9 — Composition with too many forwarding methods (Go)

```go
type ReadOnlyFile struct {
    f *os.File
}

func (r *ReadOnlyFile) Read(p []byte) (int, error) { return r.f.Read(p) }
func (r *ReadOnlyFile) Close() error               { return r.f.Close() }
func (r *ReadOnlyFile) Stat() (os.FileInfo, error) { return r.f.Stat() }
func (r *ReadOnlyFile) Name() string               { return r.f.Name() }
// ... 10 more forwarding methods
```

**Issue:** too many methods exposed; each is a maintenance burden.

**Fix:** expose the minimum needed.

```go
type ReadOnlyFile struct {
    f *os.File
}

// Only what callers actually need:
func (r *ReadOnlyFile) Read(p []byte) (int, error) { return r.f.Read(p) }
func (r *ReadOnlyFile) Close() error               { return r.f.Close() }
```

Each forwarding method is a code-review opportunity: "do callers actually need this?" Most don't. The minimal interface is a feature.

---

## Optimize 10 — Switch with String comparison vs enum (Java)

```java
public Result process(Order order) {
    switch (order.getStatus()) {  // String
        case "DRAFT":     return processDraft(order);
        case "PAID":      return processPaid(order);
        case "SHIPPED":   return processShipped(order);
        case "DELIVERED": return processDelivered(order);
    }
    throw new IllegalStateException();
}
```

**Issue:** `String` switch compiles to hash + equals comparison. Slower than enum-ordinal switch.

**Fix:** enum.

```java
enum OrderStatus { DRAFT, PAID, SHIPPED, DELIVERED }

public Result process(Order order) {
    return switch (order.getStatus()) {
        case DRAFT     -> processDraft(order);
        case PAID      -> processPaid(order);
        case SHIPPED   -> processShipped(order);
        case DELIVERED -> processDelivered(order);
    };  // exhaustive, JIT compiles to tableswitch
}
```

Enum switch compiles to `tableswitch` (single-instruction jump). String switch compiles to hash lookup + equals + secondary switch on `int` ordinal. Enum is ~3-5x faster.

---

## Optimize 11 — Strategy pattern with megamorphism (Java)

```java
interface DiscountStrategy {
    BigDecimal apply(BigDecimal amount);
}

// 20 different discount strategies:
class SeasonalDiscount implements DiscountStrategy { ... }
class LoyaltyDiscount implements DiscountStrategy { ... }
class PromoCodeDiscount implements DiscountStrategy { ... }
// ... 17 more

// Hot path:
List<DiscountStrategy> applicable = ...;  // 5-10 strategies
BigDecimal total = orderAmount;
for (DiscountStrategy s : applicable) {
    total = s.apply(total);  // megamorphic
}
```

**Issue:** with 20 strategy types, the call site is megamorphic. Each call: vtable lookup, indirect call, possibly cache miss.

**Fix 1:** group strategies by type.

**Fix 2:** sort strategies so the most common comes first; the JIT may optimize the hot path more aggressively.

**Fix 3 (radical):** if strategies are stateless and few, use a switch on an enum:

```java
enum DiscountKind { SEASONAL, LOYALTY, PROMO_CODE, ... }

BigDecimal applyDiscount(DiscountKind kind, BigDecimal amount) {
    return switch (kind) {
        case SEASONAL -> applySeasonal(amount);
        case LOYALTY -> applyLoyalty(amount);
        case PROMO_CODE -> applyPromo(amount);
    };
}
```

Sacrifices the Open/Closed advantage of strategy for ~30% speed in tight loops. Only if profiling proves it matters.

---

## Optimize 12 — Pattern matching on classes vs records (Java 21)

```java
sealed interface Expr permits Literal, BinaryOp {}
final class Literal implements Expr {  // class, not record
    private final double value;
    public Literal(double v) { value = v; }
    public double value() { return value; }
}

final class BinaryOp implements Expr {
    private final String op;
    private final Expr left, right;
    // constructor + accessors
}

// Pattern match:
double eval(Expr e) {
    return switch (e) {
        case Literal l -> l.value();
        case BinaryOp b -> switch (b.op()) {
            case "+" -> eval(b.left()) + eval(b.right());
            // ...
        };
    };
}
```

**Issue:** classes (not records) make deconstruction patterns verbose; you can't use `BinaryOp(var op, var left, var right)` syntax.

**Fix:** use records when possible. Compiler-generated accessors enable pattern deconstruction.

```java
record Literal(double value) implements Expr {}
record BinaryOp(String op, Expr left, Expr right) implements Expr {}

double eval(Expr e) {
    return switch (e) {
        case Literal(var v) -> v;  // direct deconstruction
        case BinaryOp(var op, var l, var r) -> /* ... */;
    };
}
```

Records + sealed types + deconstruction patterns are designed to work together. Use them in concert.

---

> **Next:** [interview.md](interview.md) — 50+ Q&A.
