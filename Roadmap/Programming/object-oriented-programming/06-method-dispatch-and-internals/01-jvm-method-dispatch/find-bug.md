# JVM Method Dispatch — Find the Bug

> 10 buggy snippets, each illustrating a dispatch trap that compiles, looks fine in review, and only bites at runtime — wrong method invoked, throughput collapsed, deopt cascade, surprising `super` semantics. For each: read the code, decide which dispatch behaviour is violated, identify the runtime symptom (stack trace, slow throughput, wrong output), and write down the fix.

---

## Bug 1 — Megamorphic call site killing throughput

```java
public interface Handler { void handle(Event e); }

public final class EventBus {
    private final List<Handler> handlers = new ArrayList<>();
    public void register(Handler h) { handlers.add(h); }

    public void publish(Event e) {
        for (Handler h : handlers) {
            h.handle(e);   // hot loop, single call site
        }
    }
}

// In application startup:
bus.register(new MetricsHandler());
bus.register(new AuditHandler());
bus.register(new EmailHandler());
bus.register(new ArchiveHandler());
bus.register(new SlackHandler());
bus.register(new DataLakeHandler());
// 12 handlers total
```

**Symptom.** Throughput is roughly half of what a fresh prototype showed with one handler. The flame graph collected via async-profiler shows ~8% CPU in `itable stub` under `EventBus.publish`. JFR shows `EventBus.publish` compiling, deoptimizing, recompiling — three times during a 60-second window.

**Violation.** The call site `h.handle(e)` is megamorphic — 12 distinct receiver classes flow through one location. The polymorphic inline cache evicts after a few misses; subsequent calls fall back to a real `invokeinterface` walking the itable. CHA cannot help: `Handler` is an open interface with many implementations.

**Fix.** Two complementary moves:

1. **Seal the interface and `final` the implementations.** CHA now knows the type set is closed, but the call site is still megamorphic.
2. **Specialize per concrete handler class.** Group handlers by type at registration; build one `handle` call site per concrete class instead of one shared site.

```java
public final class EventBus {
    private final List<MetricsHandler> metrics = new ArrayList<>();
    private final List<AuditHandler>   audits  = new ArrayList<>();
    // ... etc.

    public void publish(Event e) {
        for (var h : metrics) h.handle(e);   // monomorphic on MetricsHandler
        for (var h : audits)  h.handle(e);   // monomorphic on AuditHandler
        // ...
    }
}
```

Each call site is now monomorphic. C2 inlines every `handle` body directly into the loop.

---

## Bug 2 — `final` method called via reflection becomes virtual again

```java
public final class TaxRule {
    public final BigDecimal apply(BigDecimal base) {
        return base.multiply(new BigDecimal("0.20"));
    }
}

public class TaxEngine {
    public BigDecimal compute(Object rule, BigDecimal base) throws Exception {
        Method m = rule.getClass().getMethod("apply", BigDecimal.class);
        return (BigDecimal) m.invoke(rule, base);
    }
}
```

**Symptom.** The team marked `TaxRule.apply` `final` for performance, expecting the JIT to inline it. Profiling shows `compute` is still slow — much slower than a direct call. The flame graph shows time in `sun.reflect.NativeMethodAccessorImpl.invoke` and `Method.invoke`.

**Violation.** Reflection bypasses the bytecode entirely. `Method.invoke` performs a generic dispatch through internal accessor objects; CHA and `final` are irrelevant because the actual call site is inside `Method.invoke`, not at the source-level `m.invoke(...)`. The static-binding benefit of `final` is wasted.

**Fix.** Don't dispatch through reflection on a hot path. Either:

1. **Statically type the parameter.** `public BigDecimal compute(TaxRule rule, BigDecimal base) { return rule.apply(base); }`. Direct call, fully inlined.
2. **Use a `MethodHandle`.** If reflective indirection is truly necessary, build a `MethodHandle` once at construction and invoke it repeatedly — the JIT inlines MethodHandle invocations.

```java
private static final MethodHandle APPLY;
static {
    try {
        APPLY = MethodHandles.lookup().findVirtual(
            TaxRule.class, "apply", MethodType.methodType(BigDecimal.class, BigDecimal.class));
    } catch (Exception e) { throw new ExceptionInInitializerError(e); }
}
```

---

## Bug 3 — `super.method()` not calling the expected ancestor

```java
class Sensor {
    public void calibrate() { System.out.println("Sensor.calibrate"); }
}

class TempSensor extends Sensor {
    @Override public void calibrate() {
        System.out.println("TempSensor.calibrate");
        super.calibrate();
    }
}

class HighPrecisionTempSensor extends TempSensor {
    @Override public void calibrate() {
        System.out.println("HighPrecisionTempSensor.calibrate");
        super.calibrate();
    }
}

// Someone adds a calibration audit by overriding Sensor.calibrate in a fourth subclass:
class AuditingSensor extends Sensor {
    @Override public void calibrate() {
        System.out.println("AuditingSensor.calibrate");
        super.calibrate();
    }
}
```

The team expects `new HighPrecisionTempSensor().calibrate()` to also run audit logic.

**Symptom.** No `AuditingSensor.calibrate` ever runs. Stack trace shows:

```
HighPrecisionTempSensor.calibrate
TempSensor.calibrate
Sensor.calibrate
```

`AuditingSensor` is never on the call chain even though it "extends Sensor".

**Violation.** `super.calibrate()` is `invokespecial` — statically bound to the *immediate* superclass's method. Inheritance is single; `AuditingSensor` is a sibling, not an ancestor, of `HighPrecisionTempSensor`. There is no way for `super.calibrate()` to thread through a parallel class.

**Fix.** This is a design mistake masquerading as a dispatch bug. The pattern you want is composition with explicit cross-cutting concerns:

```java
public final class CalibrationPipeline {
    private final List<CalibrationStep> steps;
    public CalibrationPipeline(CalibrationStep... steps) { this.steps = List.of(steps); }
    public void run() { for (var s : steps) s.calibrate(); }
}

new CalibrationPipeline(new AuditingStep(), new HighPrecisionStep(), new TempStep()).run();
```

Each step is independent. The chain is data, not class inheritance. See [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/).

---

## Bug 4 — `@FunctionalInterface` call site with multiple lambda targets

```java
public final class Cache<K, V> {
    private final Map<K, V> map = new HashMap<>();
    public V getOr(K key, Function<K, V> loader) {
        return map.computeIfAbsent(key, loader);
    }
}

// Many call sites pass different lambdas:
cache.getOr(id, this::loadUser);
cache.getOr(id, this::loadOrder);
cache.getOr(id, this::loadInvoice);
cache.getOr(id, k -> heavyComputation(k));
cache.getOr(id, k -> remoteFetch(k));
```

**Symptom.** Throughput regressions appear after switching from explicit anonymous-class `Function` implementations to lambdas. JFR shows `HashMap.computeIfAbsent` recompiling repeatedly. `-XX:+PrintInlining` shows the inner call `loader.apply(k)` as `(megamorphic)`.

**Violation.** Each lambda compiles to a distinct synthetic class. Five callers means five `Function` implementations at the same `computeIfAbsent` call site. The call site inside `HashMap.computeIfAbsent` is megamorphic. CHA cannot help because the synthetic lambda classes are open — and they're loaded lazily, triggering deopt as each new one appears.

**Fix.** Three options:

1. **Inline the `computeIfAbsent` per caller.** Don't share a `getOr` method; each caller writes the small `if (!map.containsKey) map.put(...)` directly. Each caller's `computeIfAbsent` is monomorphic on its own lambda.
2. **Force eager loading of all lambda types at startup.** A no-op call site warm-up at app boot loads each lambda class; the JIT sees all five before compiling the hot path. The site is still megamorphic, but at least the deopt cascade is bounded.
3. **Replace the lambda with a stable function-pool object.** If five distinct loaders are needed, define five named classes implementing `Function`. The JIT still sees five types at the call site, but at least the deopts don't keep happening at random.

This bug is common in functional-Java codebases. Lambdas are cheap to write, expensive when they fan in to a shared utility.

---

## Bug 5 — CHA invalidation cascade after class load

```java
public interface Encoder { String encode(Object o); }
public class JsonEncoder implements Encoder { public String encode(Object o) { ... } }

public final class ApiResponder {
    private final Encoder encoder;
    public ApiResponder(Encoder encoder) { this.encoder = encoder; }

    public byte[] respond(Object payload) {
        return encoder.encode(payload).getBytes(StandardCharsets.UTF_8);
    }
}
```

The service runs fine for an hour. Then a plugin loads:

```java
// Plugin loaded reflectively at hour 1:
public class XmlEncoder implements Encoder { public String encode(Object o) { ... } }
```

**Symptom.** A latency spike of ~50ms appears in 99th-percentile response time exactly when the plugin loads. The histogram of response times shows a bimodal distribution for the next minute, then settles back to the prior level — but ~10% slower than before.

**Violation.** CHA had devirtualized `encoder.encode(...)` in compiled `ApiResponder.respond` based on the assumption "only `JsonEncoder` implements `Encoder`". When `XmlEncoder` loaded, HotSpot deoptimized every method depending on that assumption — `ApiResponder.respond` and possibly its callers transitively. The interpreter handled requests during the deopt window (the latency spike). After recompilation, the call site is now bimorphic instead of fully devirtualized, hence the steady ~10% slowdown.

**Fix.** Two complementary moves:

1. **Eagerly load all plugins at startup**, before the JIT compiles hot paths. Walk the plugin directory at boot, instantiate each implementer once. CHA sees the full set before optimizing.
2. **Seal the interface if the implementer set is small and known**:

```java
public sealed interface Encoder permits JsonEncoder, XmlEncoder, YamlEncoder { ... }
```

`sealed` makes CHA's invariant permanent. A new implementer is a compile-time edit, not a runtime surprise.

---

## Bug 6 — Static method called via instance reference

```java
public class IdGenerator {
    public static long next() { return System.nanoTime(); }
}

public class OrderFactory {
    private final IdGenerator gen;
    public OrderFactory(IdGenerator gen) { this.gen = gen; }
    public Order make() {
        return new Order(gen.next(), ...);   // looks like a normal instance call
    }
}
```

A teammate reviews `OrderFactory` and says: "you can mock `IdGenerator` for tests because you're injecting it through the constructor."

**Symptom.** A test attempts to substitute a deterministic `IdGenerator`:

```java
IdGenerator fake = mock(IdGenerator.class);
when(fake.next()).thenReturn(42L);
Order o = new OrderFactory(fake).make();
assertEquals(42L, o.id());   // FAILS: o.id() is some real System.nanoTime() value
```

**Violation.** `gen.next()` looks like an instance call, but `next` is `static`. The bytecode is `invokestatic IdGenerator.next`, not `invokevirtual`. The `gen` receiver is evaluated for null-check only; the *static* method runs regardless of which `IdGenerator` instance `gen` points to. Mocking is impossible because there's no dispatch happening.

**Fix.** Two options:

1. **Make `next` an instance method.** It now dispatches; `mock(IdGenerator.class)` works.
2. **If `next` truly is a pure function (no per-instance state), don't inject it.** A static utility called as `IdGenerator.next()` is honest about its lack of polymorphism. Tests that need to control IDs use a different abstraction (a `Clock`-like `IdProvider` interface).

The general rule: `obj.staticMethod()` is a code smell — it pretends to be virtual dispatch but isn't. The IDE warning ("static method called through instance reference") exists for this exact reason; turn it into an error in your style guide.

---

## Bug 7 — "Override" of a private method silently creates a new method

```java
class Auditor {
    public void audit(Event e) {
        beforeAudit(e);
        record(e);
        afterAudit(e);
    }
    private void beforeAudit(Event e) { System.out.println("default before"); }
    private void afterAudit(Event e)  { System.out.println("default after"); }
    private void record(Event e)      { /* write to file */ }
}

class StrictAuditor extends Auditor {
    private void beforeAudit(Event e) {
        if (e.severity() < 3) throw new IllegalStateException("low severity rejected");
    }
}
```

A `StrictAuditor` is supposed to reject low-severity events before recording.

**Symptom.** Low-severity events are recorded normally — the rejection logic in `StrictAuditor.beforeAudit` never runs.

```java
new StrictAuditor().audit(lowSeverityEvent);
// prints "default before" then records — no exception thrown
```

**Violation.** `Auditor.beforeAudit` is `private`. Its call from `Auditor.audit` is `invokespecial`, statically bound to `Auditor.beforeAudit`. `StrictAuditor.beforeAudit` is a *new* method, not an override — `private` methods cannot be overridden (JLS §8.4.8, "a private method cannot override anything"). The two `beforeAudit` methods are unrelated; only one is ever called via `audit`.

**Fix.** Either:

1. **Make `beforeAudit` `protected`.** Now it's overridable, the call site uses `invokevirtual`, and `StrictAuditor.beforeAudit` actually overrides.
2. **Use a template method pattern with an explicit hook interface.** `Auditor` takes a `BeforeHook` collaborator and calls `hook.run(e)`. Composition replaces inheritance.

Use `@Override` on `StrictAuditor.beforeAudit` and `javac` would have caught this at compile time with *method does not override*. The `@Override` annotation isn't decoration; it's a static check.

---

## Bug 8 — Default method diamond resolution surprise

```java
interface Greeter {
    default String hello() { return "Greeter says hello"; }
}

interface Farewell {
    default String hello() { return "Farewell says hello"; }
}

class Chatty implements Greeter, Farewell {
    // forgot to override hello()
}
```

**Symptom.** Compilation fails:

```
error: class Chatty inherits unrelated defaults for hello() from types Greeter and Farewell
```

The team "fixes" it:

```java
class Chatty implements Greeter, Farewell {
    @Override public String hello() { return Greeter.super.hello(); }
}
```

Now another developer adds a new interface for "polite chat" and `Chatty` extends it:

```java
interface PoliteGreeter extends Greeter {
    @Override default String hello() { return "Greetings, kind soul."; }
}

class Chatty implements PoliteGreeter, Farewell {
    @Override public String hello() { return Greeter.super.hello(); }   // still
}
```

**Symptom.** `new Chatty().hello()` returns `"Greeter says hello"`, not `"Greetings, kind soul."` — even though `Chatty` implements `PoliteGreeter`.

**Violation.** `Greeter.super.hello()` is `invokespecial` pointing at `Greeter.hello`, not at the maximally specific default. The `super.hello()` walks the *direct* superinterface as named, not the inheritance chain. PoliteGreeter's override is irrelevant because the source code says `Greeter.super.hello()`.

**Fix.** Either:

1. **Call `PoliteGreeter.super.hello()` explicitly.** The most specific superinterface for this method.
2. **Implement `hello` directly in `Chatty`.** Most maintainable; no surprises when the interface hierarchy grows.

The general principle: `Interface.super.method()` is statically bound to *that* interface's method, just like class `super.method()`. Don't write code that depends on the lookup walking further.

---

## Bug 9 — Bridge method invocation surprise

```java
public class StringList extends ArrayList<String> {
    @Override
    public boolean add(String s) {
        System.out.println("StringList.add(String): " + s);
        return super.add(s);
    }
}

class Caller {
    void use() {
        List rawList = new StringList();   // raw type
        rawList.add(new Integer(42));      // legal due to raw type
    }
}
```

**Symptom.** The code prints `StringList.add(String): 42` then crashes with `ClassCastException`:

```
java.lang.ClassCastException: Integer cannot be cast to String
    at com.example.StringList.add(StringList.java:5)
```

But the `add` line is `super.add(s)` — there's no obvious cast.

**Violation.** Because `ArrayList<String>.add` erases to `add(Object)`, the JVM generates a *bridge method* `boolean add(Object)` that casts the argument to `String` and forwards to `add(String)`. The cast happens in the synthetic bridge, not in your source. With a raw `List` reference, the bridge `add(Object)` is invoked, the cast fails before `add(String)` even runs (or in some compilers, fails inside `add(String)`'s entry).

`javap -c StringList` shows two `add` methods: the one you wrote, and a synthetic bridge `add(Object)` with a `checkcast` to `String`.

```
public boolean add(java.lang.String);
  ...

public boolean add(java.lang.Object);     // <-- synthetic bridge
  Code:
     0: aload_0
     1: aload_1
     2: checkcast     #2   // class java/lang/String
     5: invokevirtual #3   // Method add:(Ljava/lang/String;)Z
     8: ireturn
```

**Fix.** Don't use raw types. The bridge method is correct; the bug is that a `List` reference allowed unchecked insertion of `Integer`. Use `List<String>` and `javac` rejects the `Integer` argument.

The bridge-method mechanism is necessary for generics + erasure to work; it's a dispatch detail that mostly stays out of sight. Raw types are how it leaks. See [../03-covariant-returns-and-bridge-methods/](../03-covariant-returns-and-bridge-methods/).

---

## Bug 10 — Inline cache thrashing under load

```java
public interface RequestFilter { boolean accept(Request r); }

public final class FilterChain {
    private RequestFilter filter;
    public void setFilter(RequestFilter f) { this.filter = f; }
    public boolean check(Request r) { return filter.accept(r); }
}
```

The production setup:

```java
// At runtime, an admin endpoint can swap the filter:
POST /admin/filter   { "type": "RegionFilter" }
POST /admin/filter   { "type": "RateFilter" }
POST /admin/filter   { "type": "WafFilter" }
POST /admin/filter   { "type": "RegionFilter" }
// ... swapped every few seconds during incident response
```

**Symptom.** Under steady-state traffic, throughput is fine. During the incident — when ops keeps swapping filters — throughput collapses by 40%. `-XX:+PrintCompilation` shows `FilterChain.check` being marked not-entrant and recompiled repeatedly:

```
  1234 12 % 4   FilterChain::check (12 bytes)
  1240    4   made not entrant   FilterChain::check
  1250 13 % 4   FilterChain::check (12 bytes)
  1260    4   made not entrant   FilterChain::check
  1280 14 % 4   FilterChain::check (12 bytes)
```

**Violation.** The inline cache for `filter.accept(r)` keyed on the call site sees a different concrete type after each swap. Initially monomorphic, it goes bimorphic, then megamorphic, then HotSpot recompiles to a megamorphic stub — which is slower than the original monomorphic version. After enough swaps, the IC may stabilize, but each transition costs a deopt.

**Fix.** Three options:

1. **Pre-load all filter classes at startup.** All concrete types are visible to CHA from the start; the IC stabilizes earlier.
2. **Use `MutableCallSite` via `invokedynamic`.** A `MutableCallSite` lets you swap the target MethodHandle atomically. The JIT knows the call site is mutable from day one and doesn't speculate on monomorphism. The first compile assumes "this is a mutable call site"; swaps don't trigger deopt cascades.
3. **Don't swap in production.** If the admin endpoint exists for incident response, accept the perf hit during incident response — it's a feature, not a bug.

`MutableCallSite` is the canonical answer to "I need runtime swappable dispatch without deopt thrashing". See JVMS §6.5.invokedynamic and the `java.lang.invoke` Javadoc.

---

## Pattern summary

| Trap                                            | What to look for                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| Megamorphic call site (Bugs 1, 4)               | One call site, many concrete receiver types, slow throughput      |
| Static binding misread as virtual (Bugs 6, 7)   | `obj.staticMethod()`, private "overrides" with no `@Override`     |
| `invokespecial` semantics (Bugs 3, 8)           | `super.m()` not threading through unexpected siblings; default method `super.` resolution |
| CHA invalidation (Bugs 5, 10)                   | Latency spikes correlated with class loads; deopt cascades in logs |
| Reflection vs `final` (Bug 2)                   | `Method.invoke` on a `final` method — `final` doesn't reach reflection |
| Bridge methods (Bug 9)                          | Raw types + `ClassCastException` in a method without an explicit cast |

These bugs usually compile cleanly and pass shallow tests. They surface as throughput regressions, latency spikes, deopt cascades, and "the wrong method ran". Train your eye to read the bytecode (`javap -c -v`) and the compile log (`-XX:+PrintCompilation`); the compiler won't catch them, the runtime will, expensively.
