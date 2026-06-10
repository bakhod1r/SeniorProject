# vtable and itable — Find the Bug

> 10 cases where the vtable/itable picture matters. Each one compiles, looks fine in review, and only reveals its real shape under profiling, HSDB inspection, or a strange production symptom. For each: read the code, find the dispatch surprise, identify the runtime symptom, and write the fix.

---

## Bug 1 — Vtable bloat from a deep "framework" hierarchy

```java
abstract class BaseEntity { /* 6 abstract + 4 protected methods */ }
abstract class AuditedEntity extends BaseEntity { /* 5 more */ }
abstract class VersionedEntity extends AuditedEntity { /* 4 more */ }
abstract class SoftDeletableEntity extends VersionedEntity { /* 4 more */ }
abstract class TenantOwnedEntity extends SoftDeletableEntity { /* 3 more */ }
abstract class WorkflowEntity extends TenantOwnedEntity { /* 6 more */ }

public final class Order extends WorkflowEntity {
    @Override public String tableName()    { return "orders"; }
    @Override public Long   primaryKey()   { return id; }
    // ... 22 other overrides because every level demanded one
}
```

The codebase has 200 concrete domain classes all sitting at the bottom of a six-level abstract hierarchy. Startup is slow; metaspace usage is high.

**Symptom.** `-Xlog:class+load=info` shows ~12,000 classes loaded for a small service. `-XX:MetaspaceSize=256m` is exhausted at startup. Class-load profiling (JFR `Class Load` events) shows each `Klass` taking longer than expected to prepare. HSDB shows `Order.vtable` has ~50 class-specific entries plus Object's, and the itable list contains 8+ interfaces dragged in by the framework.

**Cause.** Each level of inheritance doubles vtable construction work for every leaf class. Vtable copy + patch is O(parent_vtable_size); compound across 200 leaves and 6 levels and you're doing tens of thousands of slot operations. Add 8 itables per class for cross-cutting concerns and metaspace footprint balloons.

**Fix.** Composition for the cross-cutting concerns:

```java
public final class Order {
    private final AuditInfo audit;
    private final Versioning versioning;
    private final SoftDelete softDelete;
    // ... composed, not inherited
}
```

Dispatch cost is unchanged or better (monomorphic composed fields vs. virtual super-class methods); vtable depth drops to "Object slots + Order's own"; class loading goes from 12,000 classes to 8,000. Real-world Spring Data refactors have shown 30-40% startup improvements from this kind of change.

---

## Bug 2 — Itable cache thrashing under polymorphic load

```java
interface PriceStrategy {
    BigDecimal price(Item item);
}

class StandardPricing  implements PriceStrategy { /* ... */ }
class BulkPricing      implements PriceStrategy { /* ... */ }
class PromoPricing     implements PriceStrategy { /* ... */ }
class HolidayPricing   implements PriceStrategy { /* ... */ }
class ClearancePricing implements PriceStrategy { /* ... */ }
class B2BPricing       implements PriceStrategy { /* ... */ }

public BigDecimal total(List<Item> items, Map<Item, PriceStrategy> strategies) {
    BigDecimal sum = BigDecimal.ZERO;
    for (Item it : items) {
        sum = sum.add(strategies.get(it).price(it));    // 6 distinct strategy types
    }
    return sum;
}
```

The pre-rewrite version used a single `StandardPricing`. Throughput drops 35% after the strategy split.

**Symptom.** `-XX:+PrintInlining` shows the call site as `(megamorphic) PriceStrategy::price`. async-profiler flame graph spends 18% of time in `itable_stub`. The site used to be inlined; now it's a full itable lookup per iteration.

**Cause.** The receiver type changes every iteration. C2's bimorphic cache can't hold 6 types; it falls back to the megamorphic stub. Each iteration: load Klass*, secondary super search, itable offset, indexed load, indirect call — 4-5 dependent loads, no inlining of `price()`.

**Fix.** Re-shape the loop to group by strategy:

```java
public BigDecimal total(List<Item> items, Map<Item, PriceStrategy> strategies) {
    Map<PriceStrategy, List<Item>> byStrategy =
        items.stream().collect(Collectors.groupingBy(strategies::get));
    BigDecimal sum = BigDecimal.ZERO;
    for (var entry : byStrategy.entrySet()) {
        PriceStrategy s = entry.getKey();
        for (Item it : entry.getValue()) {     // monomorphic in this inner loop
            sum = sum.add(s.price(it));
        }
    }
    return sum;
}
```

Each inner loop is monomorphic; the JIT inlines `price`. Throughput recovers and exceeds the original because inlining enables further optimisations (e.g., scalar replacement of intermediate `BigDecimal` operations). If grouping isn't feasible, marking `PriceStrategy` `sealed` lets CHA enumerate the implementations and the JIT can emit a switch over Klass.

---

## Bug 3 — Bridge method creates a confusing extra slot

```java
class Container<T> {
    public Object peek() { return null; }
}
class StringContainer extends Container<String> {
    @Override public String peek() { return "value"; }
}

void debug(StringContainer sc) {
    Method[] methods = StringContainer.class.getDeclaredMethods();
    for (Method m : methods) {
        System.out.println(m.getReturnType() + " " + m.getName());
    }
}
```

**Symptom.** The output shows *two* `peek` methods:

```
class java.lang.String peek
class java.lang.Object peek
```

Reflective code that filters by name `peek` finds two methods and picks the wrong one (often the synthetic bridge, because it appears first depending on JVM).

**Cause.** Generic erasure: the parent's signature is `Object peek()`, the child's is `String peek()`. javac inserts a bridge method on `StringContainer` with signature `Object peek()` whose body is `aload_0; invokevirtual peek()String; areturn`. Both methods are in the class file and both occupy vtable slots — the bridge in the slot inherited from `Container`, the real method in a new slot.

`javap -v -p StringContainer.class` confirms it:

```
public java.lang.String peek();    flags: ACC_PUBLIC
public java.lang.Object peek();    flags: ACC_PUBLIC, ACC_BRIDGE, ACC_SYNTHETIC
```

**Fix.** Filter by `Method.isBridge()` or `Method.isSynthetic()`:

```java
for (Method m : methods) {
    if (m.isBridge() || m.isSynthetic()) continue;
    System.out.println(m.getReturnType() + " " + m.getName());
}
```

Or use `getMethod(name, paramTypes)` instead of iterating, since `getMethod` returns the most specific (non-bridge) by JVMS §5.4.3.3 rules.

See [../03-covariant-returns-and-bridge-methods/](../03-covariant-returns-and-bridge-methods/) for the full bridge-method story.

---

## Bug 4 — Covariant return causing dispatch surprise

```java
class Repository {
    public Entity load(long id) { return new Entity(id); }
}
class UserRepository extends Repository {
    @Override public User load(long id) { return new User(id); }   // covariant return
}

// Production code uses both types:
Repository r = new UserRepository();
Object x = r.load(42L);     // what type comes back?
```

**Symptom.** A logging line like `log.info("loaded: " + x.getClass().getName())` shows `User` even though the variable is typed `Object` and the call goes through `Repository`. So far so good. But a benchmark shows `r.load(42L)` is 5-10ns slower than `new UserRepository().load(42L)` — same code, different receiver type.

**Cause.** Through `Repository r`, the call `r.load(42L)` compiles to `invokevirtual Repository.load`. The vtable slot for `Repository.load` in `UserRepository`'s vtable contains the *bridge* `Entity load(long)` method (synthetic, `ACC_BRIDGE`), which in turn calls `User load(long)`. Two dispatches instead of one. Through `UserRepository u`, the compiler picks the more specific signature directly — one dispatch.

**Fix.** Usually no fix needed; the 5ns difference is meaningless. If it matters in a tight loop, type the local variable as the specific subclass so javac picks the non-bridge signature. Be aware that mixed APIs with covariant returns *can* show this overhead.

---

## Bug 5 — Multiple interfaces with conflicting default methods

```java
interface Loggable {
    default void log()  { System.out.println("logged"); }
}
interface Auditable {
    default void log()  { System.out.println("audited"); }
}
class Order implements Loggable, Auditable {
    // no override of log()
}
```

**Symptom.** Compile-time error:

```
error: types Loggable and Auditable are incompatible;
  class Order inherits unrelated defaults for log() from types Loggable and Auditable
```

If, somehow, this slips through (e.g., the class is compiled before one of the interfaces gains a default, then a binary upgrade adds a conflicting default), the runtime symptom is `IncompatibleClassChangeError` at the call site.

**Cause.** JVMS §5.4.3.3 maximally-specific rule: neither `Loggable.log` nor `Auditable.log` is more specific than the other (the interfaces are siblings, neither extends the other). No unique selection exists. The itable entry can't be filled with a unique target. javac refuses to compile; the runtime refuses to dispatch.

**Fix.** Explicit override in `Order`:

```java
class Order implements Loggable, Auditable {
    @Override public void log() {
        Loggable.super.log();
        Auditable.super.log();
        // or pick one, or define new behaviour
    }
}
```

The itable now has a clear target.

---

## Bug 6 — HSDB shows unexpected method ordering

A developer inspects `MyClass`'s vtable in HSDB after refactoring and sees:

```
slot 0: java.lang.Object.finalize
slot 1: java.lang.Object.wait
slot 2: java.lang.Object.wait
slot 3: java.lang.Object.wait
slot 4: java.lang.Object.equals
slot 5: java.lang.Object.toString
slot 6: java.lang.Object.hashCode
slot 7: java.lang.Object.clone
slot 8: java.lang.Object.notify
slot 9: java.lang.Object.notifyAll
slot 10: java.lang.Object.getClass
slot 11: MyClass.businessMethod
```

"Why are there *three* `wait` slots?"

**Symptom.** Confusion, not a bug. But misreading this leads to time wasted on a non-issue.

**Cause.** `Object` has three overloads of `wait`: `wait()`, `wait(long)`, `wait(long, int)`. Each is a distinct method by JVMS signature (different parameter descriptors), each gets its own vtable slot. The vtable shows the *method name* in the HSDB tool, not the signature, which makes them look identical.

**Fix.** Read the full signatures in HSDB (click into the method to see the descriptor) or use `jhsdb clhsdb` and `printvtbl <klass>` which prints full signatures.

---

## Bug 7 — Reflection vs. vtable identity check

```java
class Parent { public void m() { System.out.println("parent"); } }
class Child extends Parent { @Override public void m() { System.out.println("child"); } }

Method parentM = Parent.class.getMethod("m");
Method childM  = Child.class.getMethod("m");

Child c = new Child();
parentM.invoke(c);      // prints what?
System.out.println(parentM.equals(childM));    // prints what?
```

**Symptom.** First line prints `child`. Second prints `false`.

**Cause.** `parentM.invoke(c)` performs *virtual* dispatch — it goes through `Child.vtable[slot_of_m]`, which is `Child.m`. The `Method` object you reflect on is not a function pointer; it's a description of *which named method on which class* to invoke, and the JVM then does normal `invokevirtual`-style dispatch from there.

`parentM.equals(childM)` compares the two `Method` objects, which are *different* — they describe different declaring classes. Reflection sees the inheritance, the vtable executes it.

**Fix.** Not a bug, but if you want *exactly the parent's* method to run, use `MethodHandles.Lookup.findSpecial`:

```java
MethodHandle mh = MethodHandles.lookup()
    .findSpecial(Parent.class, "m", MethodType.methodType(void.class), Parent.class);
mh.invoke(c);    // prints "parent" — bypasses the vtable
```

This is `invokespecial` semantics. Used carefully — most code wants the virtual behaviour.

---

## Bug 8 — Records and the "missing" vtable

```java
public record Point(int x, int y) {}

public class Geometry {
    public double distanceTo(Point origin, Point other) {
        return Math.hypot(other.x() - origin.x(), other.y() - origin.y());
    }
}
```

A developer reads about vtables, then asks: "Can I subclass `Point` to add a `z` coordinate and have `distanceTo` dispatch dynamically?"

**Symptom.** `class Point3D extends Point` won't compile:

```
error: cannot inherit from final class Point
```

**Cause.** Records are *implicitly final* per JLS §8.10. They have no extension surface. Their vtable contains the standard Object methods (overridden by `equals`, `hashCode`, `toString`) plus the accessors — but no subclass can exist, so the vtable's "overridable" portion is closed.

**Fix.** Use composition or a sealed interface:

```java
sealed interface Point permits Point2D, Point3D {}
record Point2D(int x, int y)         implements Point {}
record Point3D(int x, int y, int z)  implements Point {}
```

Now `distanceTo` can dispatch through the sealed interface; the JIT, knowing the interface is sealed, can devirtualize aggressively via CHA.

The lesson: records are the JVM's *friend* exactly because their vtable is closed and CHA can prove monomorphism.

---

## Bug 9 — Sealed type prunes itable, then someone widens it

```java
public sealed interface Event permits OrderPlaced, OrderShipped {}
public record OrderPlaced (long id, Instant at) implements Event {}
public record OrderShipped(long id, Instant at) implements Event {}

public void handle(Event e) {
    switch (e) {
        case OrderPlaced  op -> place(op);
        case OrderShipped os -> ship(os);
    }
}
```

A second team needs to dispatch their own events through the same handler, so they widen the seal:

```java
public sealed interface Event permits OrderPlaced, OrderShipped, OrderRefunded, OrderReturned,
    OrderCancelled, PaymentReceived, PaymentFailed, ShippingDelayed, ShippingCompleted,
    InventoryAdjusted, InventoryLow, WarehouseTransfer, ... {}
```

Now 30+ records implement `Event`.

**Symptom.** The switch in `handle` still compiles (every case covered). Performance is OK initially. Two months later, profiling shows `itable_stub` showing up. The call site went from "trimorphic, JIT inlined a 3-way switch" to "megamorphic, full itable lookup".

**Cause.** CHA worked when the seal had 2 permits. With 30, the JIT sees too many possible targets to inline. The site degrades to a megamorphic interface call.

**Fix.** Either split the seal into a hierarchy of seals (`OrderEvent`, `PaymentEvent`, ...) where each branch stays small, or accept the cost and route `handle` to per-category sub-handlers:

```java
public void handle(Event e) {
    switch (e) {
        case OrderEvent oe    -> orderHandler.handle(oe);     // monomorphic per category
        case PaymentEvent pe  -> paymentHandler.handle(pe);
        case ShippingEvent se -> shippingHandler.handle(se);
    }
}
```

Each branch's call site has a small, sealed set of subtypes — CHA and inlining work again.

---

## Bug 10 — `instanceof` chain hitting the secondary super check

```java
public void route(Notifiable target, Message msg) {
    if (target instanceof Email   e) e.email.sendTo(msg);
    else if (target instanceof Sms     s) s.phone.sendTo(msg);
    else if (target instanceof Push    p) p.device.push(msg);
    else if (target instanceof Webhook w) w.url.post(msg);
    else if (target instanceof Slack   k) k.channel.post(msg);
    else if (target instanceof Discord d) d.channel.post(msg);
    else if (target instanceof Teams   t) t.channel.post(msg);
    else if (target instanceof Pager   p) p.dispatch(msg);
}
```

Each handler implements many interfaces. `target` is typed as `Notifiable`, but in practice the various concrete classes also implement `Auditable`, `Loggable`, `Traceable`, `Versionable`...

**Symptom.** This dispatcher is hot. async-profiler shows time in `Klass::is_subtype_of`. Throughput is lower than expected.

**Cause.** Each `instanceof` against an interface triggers a secondary-super-array search. Eight chained checks * a secondary-super-cache miss rate * the linear scan over the implemented-interfaces array = significant cost on classes with many interfaces.

On JDK 21+ with the hashed secondary super check (JEP 8180450), most of this collapses to constant time. On JDK 17 / 11, it's still painful.

**Fix options:**

- Replace the chain with a sealed-interface + switch (the JIT compiles to a single Klass-pointer comparison tree).
- Add a type tag/enum to `Notifiable` and switch on it.
- Move to JDK 21+ if you can.

```java
public sealed interface Notifiable
    permits Email, Sms, Push, Webhook, Slack, Discord, Teams, Pager {}

public void route(Notifiable target, Message msg) {
    switch (target) {
        case Email e   -> e.email.sendTo(msg);
        case Sms s     -> s.phone.sendTo(msg);
        case Push p    -> p.device.push(msg);
        case Webhook w -> w.url.post(msg);
        case Slack k   -> k.channel.post(msg);
        case Discord d -> d.channel.post(msg);
        case Teams t   -> t.channel.post(msg);
        case Pager p   -> p.dispatch(msg);
    }
}
```

`javac` proves exhaustiveness; the JIT compiles to a switch on Klass identity, no secondary-super search.

---

## How to spot these bugs in code review

- A class that `extends` something abstract that already extends three things — Bug 1.
- A polymorphic interface with 5+ implementations called inside a loop with no grouping — Bug 2.
- Reflection code that iterates `getDeclaredMethods` and filters by name — Bug 3.
- A covariant return inserted late in an existing API — Bug 4.
- Two interfaces with the same `default` method name implemented by one class — Bug 5.
- Surprise when looking at HSDB vtables — Bug 6.
- Tests that compare `Method` objects with `.equals` — Bug 7.
- "Let me subclass this record" — Bug 8.
- A sealed interface whose `permits` list keeps growing — Bug 9.
- An `if/else if instanceof` chain longer than 3 in a hot path — Bug 10.

---

## Quick rules

- [ ] Inheritance depth and interface count are *real* class-loading and dispatch costs at scale.
- [ ] Megamorphic call sites destroy inlining; group polymorphic work by concrete type.
- [ ] Bridge methods and covariant returns add vtable slots; reflection code must filter `isBridge`.
- [ ] Records are final, sealed types prune dispatch, both help CHA — use them.
- [ ] `instanceof` against interfaces is not free on pre-JDK 21 JVMs with deep type hierarchies.
- [ ] `MethodHandles.Lookup.findSpecial` bypasses the vtable; `Method.invoke` does not.

---

**Memorize this:** every bug here is a vtable/itable cost made visible by either profiling or a refactor. The patterns repeat: megamorphic call sites, broad implements lists, deep inheritance, covariant-return bridges, default-method conflicts. Catching them is a habit — vtable thinking applied to ordinary code.
