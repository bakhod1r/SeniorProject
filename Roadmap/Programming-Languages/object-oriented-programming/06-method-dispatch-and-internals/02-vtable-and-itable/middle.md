# vtable and itable — Middle

> **What?** A close look at how HotSpot lays out vtables for multi-level inheritance, how it builds an itable per implemented interface, and how the JIT's inline cache turns a slow itable lookup into a one-instruction check on hot paths.
> **How?** Walk through a 3-level hierarchy and write out the vtable slot by slot. Then add two interfaces and see two itables appear. Then look at a `invokeinterface` call site and trace what HotSpot does the first, second, and Nth time it runs.

---

## 1. Why this level matters

At junior level you carry a mental model: vtable = array of pointers, fixed slots. That model is enough to *read* polymorphic code. To *predict* its cost — to know which call sites the JIT can devirtualize, why a megamorphic interface call is suddenly slow, why class loading time scales with hierarchy depth — you need to see what's actually in the tables.

This file works through three concrete artefacts: a deep vtable, a class implementing multiple interfaces (multiple itables), and the inline-cache pattern HotSpot uses for `invokeinterface`. Each is a structure you can inspect with HSDB (HotSpot Serviceability Debugger) — covered in `tasks.md`.

---

## 2. Vtable layout for a 3-level hierarchy

```java
class Vehicle {
    public void start()  { /* base */ }
    public void stop()   { /* base */ }
    public int  speed()  { return 0; }
}

class Car extends Vehicle {
    @Override public void start() { /* car-specific */ }
    public void honk() { /* new */ }
}

class SportsCar extends Car {
    @Override public void start() { /* sports tuning */ }
    @Override public int  speed() { return 250; }
    public void launchControl() { /* new */ }
}
```

HotSpot lays out each `Klass`'s vtable starting with `Object`'s inherited methods (`finalize`, `wait`, `notify`, `toString`, `equals`, `hashCode`, `getClass`, `clone`), followed by the class's own overridable methods, in declaration order. The class-specific portion looks like this:

```
Vehicle.vtable (after Object's slots):
  [N+0] Vehicle.start
  [N+1] Vehicle.stop
  [N+2] Vehicle.speed

Car.vtable:
  [N+0] Car.start          <-- override, same slot
  [N+1] Vehicle.stop       <-- inherited, parent's pointer reused
  [N+2] Vehicle.speed      <-- inherited
  [N+3] Car.honk           <-- new method, appended

SportsCar.vtable:
  [N+0] SportsCar.start    <-- override
  [N+1] Vehicle.stop       <-- still inherited from grandparent
  [N+2] SportsCar.speed    <-- override
  [N+3] Car.honk           <-- inherited from Car
  [N+4] SportsCar.launchControl  <-- new
```

Key properties:

- `start` always sits at slot N+0. `Vehicle v = new SportsCar(); v.start();` compiles to `invokevirtual Vehicle.start`, which the JVM resolves to "slot N+0 of the receiver's vtable" — and that happens to be `SportsCar.start`.
- Inherited methods keep their parent's pointer until somebody overrides; this is why vtable construction is cheap (memcpy from parent's vtable, then patch overrides).
- New methods are *appended* — vtables grow downward as the hierarchy deepens.

This layout is described informally in the JVMS but actually implemented in HotSpot's `klassVtable.cpp`. The cost model: each level adds (number of new methods) slots to every descendant's vtable. A six-level hierarchy where every level adds three methods produces an 18-slot class-specific vtable for the leaf class, plus the inherited `Object` slots.

---

## 3. What `invokevirtual` actually compiles to

For the call `vehicle.start()` where `vehicle` is typed `Vehicle`:

```
   bytecode: invokevirtual #M           // Method Vehicle.start:()V
```

The first time this call site runs, HotSpot's interpreter resolves `#M` to a vtable index (let's say 7 for this example). After resolution, the equivalent native code for the call site looks roughly like:

```
   load   klass_ptr     <- [object + klass_offset]    // load the Klass pointer from header
   load   method_ptr    <- [klass_ptr + vtable_base + 7 * word_size]
   jump   method_ptr.entry_point
```

Three machine operations: a `mov`, a `mov` at a fixed offset, and an indirect `jmp`. The JIT can inline the entire sequence when it can prove the receiver type.

Compare with `invokeinterface`, coming up next.

---

## 4. itables — one per implemented interface

```java
interface Drivable { void drive(); int speed(); }
interface Honkable  { void honk(); }

class Car implements Drivable, Honkable {
    @Override public void drive() { /* ... */ }
    @Override public int  speed() { return 100; }
    @Override public void honk()  { /* ... */ }
}
```

`Car`'s `Klass` now contains *three* lookup structures:

```
Car.vtable:
  Object slots
  [N+0] Car.drive
  [N+1] Car.speed
  [N+2] Car.honk

Car.itables:
  itable for Drivable:
    interface method drive -> Car.drive
    interface method speed -> Car.speed
  itable for Honkable:
    interface method honk  -> Car.honk
```

Each itable is structurally simple: an array of `{interface method, target method}` pairs. The complication is that *finding the right itable* costs a search — `Car` may implement many interfaces, and the JVM has to identify which itable corresponds to the interface in the call (`Drivable` vs. `Honkable`).

`invokeinterface` therefore looks like:

```
   load   klass_ptr           <- [object + klass_offset]
   search for "Drivable" in klass.secondary_super_array  (linear, cached)
   load   itable_base
   load   method_ptr          <- itable_base[index_of(drive)]
   jump   method_ptr.entry_point
```

That's more loads, plus a search step. Without optimization it could be slow. HotSpot fixes it with the inline cache.

---

## 5. Inline caches — the trick that makes `invokeinterface` fast

A call site that is *monomorphic* in practice (only one concrete type ever shows up) doesn't need a full lookup every time. HotSpot rewrites the call site after the first call into a *guarded direct call*:

```
   load   klass_ptr   <- [object + klass_offset]
   cmp    klass_ptr, EXPECTED_KLASS    // e.g. Car
   jne    slow_path                    // type changed, redo lookup
   call   Car.drive                    // direct call, no vtable / itable
slow_path:
   ... full resolution + rewrite cache ...
```

This is called a **monomorphic inline cache**. The cost is one compare, one branch (predicted not-taken), and a direct call — basically the same as a `final` method call. As long as your code hits the same concrete type at this site, it stays fast.

If a second type shows up, HotSpot can either:

- Expand the cache to a *bimorphic* inline cache (check two types).
- Mark the site as **megamorphic** (3+ types) and fall back to the full itable lookup.

The C2 compiler uses this profile to decide whether to inline. A monomorphic site is a green light to inline the callee. A megamorphic site is where dispatch starts to dominate the cost — see `optimize.md`.

---

## 6. Method resolution and the call site lifecycle

A single call site goes through stages:

1. **Unresolved.** First execution. The interpreter resolves the symbolic reference in the constant pool to a vtable index (for `invokevirtual`) or a method pointer (for `invokeinterface`), via the algorithm in JVMS §5.4.5.
2. **Resolved, cold.** Subsequent executions use the resolved vtable/itable slot. The interpreter records receiver types for profiling.
3. **JIT-compiled monomorphic.** C1/C2 emits the guarded direct call described above.
4. **JIT-compiled bimorphic.** Two type checks in sequence, then direct call.
5. **Megamorphic.** Full vtable/itable load every call.

You can watch these transitions with `-XX:+PrintInlining` and `-XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation`. A site labelled `(megamorphic)` is one your code visits with too many concrete types — see `find-bug.md` Bug 2.

---

## 7. A worked example — printing-cost vs. polymorphism

Consider a tight loop calling `shape.area()`:

```java
public double totalArea(List<Shape> shapes) {
    double sum = 0;
    for (Shape s : shapes) sum += s.area();
    return sum;
}
```

- If the list contains only `Circle`s: monomorphic site, JIT inlines `Circle.area`, this loop is ~free.
- If the list mixes `Circle` and `Rectangle`: bimorphic, two type-checks per iteration, inlining still possible.
- If the list mixes `Circle`, `Rectangle`, `Triangle`, `Star`, ...: megamorphic, full vtable load per iteration. Throughput drops noticeably (see `optimize.md` for measurements).

If `Shape` were an interface, the dispatch instruction would be `invokeinterface`, and the megamorphic fallback would also include the secondary-super search. That's where the cost difference between abstract classes (single-inheritance, simple vtable) and interfaces (multiple-inheritance, itable + super search) shows up under load.

---

## 8. Visualizing vtable size — `Object`, `String`, deep hierarchy

The vtable of `Object` is the JVM-wide base: a handful of slots (`hashCode`, `equals`, `toString`, `getClass`, `wait`, `notify`, `notifyAll`, `finalize`, `clone`). `String` adds a few of its own. A deep custom hierarchy can add dozens.

```java
final class Empty {}                              // ~9 inherited Object slots, 0 own
final class StringLike { /* a few public methods */ }   // ~9 + N

class Lvl1 { void a(){} void b(){} }
class Lvl2 extends Lvl1 { void c(){} void d(){} void e(){} }
class Lvl3 extends Lvl2 { void f(){} void g(){} void h(){} void i(){} }
// Lvl3.vtable = Object slots + 2 (Lvl1) + 3 (Lvl2) + 4 (Lvl3) = ~18 slots
```

Each slot is 8 bytes on 64-bit JVMs (with compressed klass pointers, sometimes 4). 18 slots is small. But scale this to 5,000 classes in an application server, each with 20+ slots and several itables, and metaspace usage in the tens of megabytes is normal.

This is why deep inheritance is "free for dispatch" (slot index is precomputed) but "expensive for class loading" — every subclass copies and patches the parent's vtable and rebuilds its itables.

---

## 9. Bridge methods and the surprise extra slot

When a generic class overrides a method with a more specific return type after type erasure, javac inserts a *bridge method* to preserve the parent's erased signature.

```java
class Box<T> {
    public Object peek() { return null; }
}
class StringBox extends Box<String> {
    @Override public String peek() { return "hi"; }
}
```

After erasure, `Box.peek` has signature `()Object` and `StringBox.peek` has `()String`. The JVM's vtable is keyed by *erased* signatures, so `StringBox` actually gets *two* methods:

- `String StringBox.peek()` — the real one you wrote.
- `Object StringBox.peek()` — a synthetic bridge that calls the real one and casts.

The bridge occupies the vtable slot that `Box.peek` used (so `Box b = new StringBox(); b.peek()` still works). The non-bridge `String`-returning method gets *its own* slot. Net: one extra vtable entry per covariant return. See [../03-covariant-returns-and-bridge-methods/](../03-covariant-returns-and-bridge-methods/) and `find-bug.md` Bug 3.

---

## 10. Default methods and itables

`default` methods in interfaces complicate itable construction:

```java
interface Greeter {
    default void greet() { System.out.println("hi"); }
}
class Robot implements Greeter { /* uses default */ }
class LoudRobot implements Greeter {
    @Override public void greet() { System.out.println("HI"); }
}
```

For `Robot`, the itable slot for `Greeter.greet` points at the interface's default implementation. For `LoudRobot`, it points at the overriding method on the class. The JVM resolves "which default wins" using JVMS §5.4.3.3 (method resolution rules) — and when two interfaces provide conflicting defaults, it throws `IncompatibleClassChangeError`. Diamond cases are covered in `find-bug.md` Bug 5.

---

## 11. Quick rules

- [ ] `Klass.vtable` is built at class load time: memcpy parent, patch overrides, append new methods.
- [ ] One slot per overridable method, including inherited ones; `private`/`static`/`final` are excluded.
- [ ] Each implemented interface gets its own itable; the JVM finds the right one via the class's secondary-super array.
- [ ] `invokevirtual` is one indexed load; `invokeinterface` is several loads plus a search, mitigated by inline caches.
- [ ] Bridge methods (covariant returns, generic erasure) add extra vtable slots.
- [ ] Monomorphic call sites are nearly free; megamorphic sites pay the full vtable/itable cost every call.
- [ ] Deep hierarchies are free at dispatch time but copy more slots at class loading and pay more cache footprint.

---

## 12. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| Class loading walk-through, secondary super check, vtable rebuild | `senior.md`        |
| Mentoring, ArchUnit guards, async-profiler                       | `professional.md`  |
| JVMS sections + HotSpot source line refs                         | `specification.md` |
| Concrete buggy patterns with stack traces                        | `find-bug.md`      |
| Cost numbers, devirtualization, JMH benchmarks                   | `optimize.md`      |
| HSDB / JOL / JMH exercises                                       | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |

---

**Memorize this:** the vtable is built once at class load via "copy parent, patch overrides, append new". The itable is one *per interface* and is reached via a secondary-super search that the inline cache makes free on hot paths. The slot number is precomputed; the search isn't. Dispatch cost = "how often does this call site change its concrete receiver type" — monomorphic ~free, megamorphic full table lookup.
