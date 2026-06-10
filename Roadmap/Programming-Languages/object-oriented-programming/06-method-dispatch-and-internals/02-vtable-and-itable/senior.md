# vtable and itable — Senior

> **What?** How HotSpot actually constructs vtables and itables during class loading, the secondary-super check used during interface dispatch and `instanceof`, how covariant returns and bridge methods inflate vtable slots, what multiple-interface layouts look like in memory, and how sealed types let the JIT prune dispatch surface.
> **How?** By tracing the JVM's class-loading flow through `instanceKlass.cpp` and `klassVtable.cpp`, mapping the data structures to what HSDB reveals, and showing two real cases (bridge methods, sealed hierarchies) where vtable details leak into observable performance and bytecode.

---

## 1. Class loading — the moment vtables are built

The vtable is not a static artefact; it's constructed lazily as classes load. JVMS §5.3 (Creation and Loading), §5.4 (Linking), §5.5 (Initialization) describe the sequence; HotSpot's implementation lives mostly in `instanceKlass.cpp` and `klassVtable.cpp`.

Simplified flow when class `C` is loaded:

1. **Load.** The class loader reads bytes into a `ClassFileParser`, producing a `Klass` candidate in metaspace. Fields, methods, and constant pool entries are wired up.
2. **Verify.** Bytecode is checked against JVMS §4.10 rules.
3. **Prepare.** Static fields get default values. *Vtable size is computed.* HotSpot calls `klassVtable::compute_vtable_size_and_num_mirandas`:
   - Start from parent's vtable size.
   - For each method declared in `C`, decide: does it override a parent vtable slot, or does it need a new slot?
   - Account for *miranda* methods — interface methods that aren't implemented by any superclass and must be patched into the vtable so they exist by slot.
4. **Resolve.** Symbolic references in the constant pool are resolved lazily on first use (per JVMS §5.4.3).
5. **Vtable patch.** HotSpot allocates the vtable as part of the `Klass`, memcpy's the parent's vtable into the start of the new one, and patches the slots that this class overrides. It then iterates the class's methods to fill new slots and applies miranda entries.
6. **Itable construction.** For each interface in the transitive closure of `implements`, HotSpot creates an itable entry. Each itable maps interface method indices to concrete `Method*` pointers.
7. **Initialize.** `<clinit>` runs on first active use (JVMS §5.5).

If you've ever wondered why startup of a "Hello, World!" Spring Boot app takes a second despite the code doing nothing — most of that second is steps 1-6 happening for thousands of classes.

The cost is proportional to `(number of classes) * (average vtable size + average itable size)`. Deep hierarchies and broad interface implementations both inflate this. CDS (Class Data Sharing) precomputes much of it at JDK build time to make startup faster; AppCDS extends this to your application classes.

---

## 2. The miranda method problem

A "Miranda method" (named after Miranda rights — "if you do not have an implementation, one will be appointed for you") is an interface method that the class hierarchy must provide a vtable slot for, even if no concrete method in the class implements it.

```java
abstract class AbstractCar implements Drivable {
    // No drive() method here, but Drivable demands one.
}
class Sedan extends AbstractCar {
    @Override public void drive() { /* ... */ }
}
```

`AbstractCar`'s vtable needs a slot for `drive` even though `AbstractCar` itself doesn't define one — otherwise, when `Sedan` later overrides it, there's no slot to overwrite. HotSpot inserts a synthetic *abstract* `Method*` (or a thunk that throws `AbstractMethodError`) at that slot. `Sedan` then patches the slot with its real `drive`.

This is why an abstract class's vtable can be larger than the methods it physically declares. HSDB's vtable dump shows these as entries labelled with the abstract method or the originating interface method.

---

## 3. itable construction and the secondary-super check

Every class has, in addition to its primary superclass chain, a *secondary super array* listing all the interfaces it implements (directly or transitively). This array is the index for itable lookups.

When the JVM executes `invokeinterface` on receiver `r` for method `Drivable.drive`:

1. Load `r`'s klass pointer.
2. Search the klass's secondary super array for the `Drivable` klass.
3. The position in that array indexes the corresponding itable.
4. Within that itable, the precomputed offset gives the `Method*`.
5. Dispatch.

The secondary-super search is also used by `instanceof` and checked casts when the target type is an interface (or an arbitrarily related class). HotSpot accelerates step 2 with `Klass::secondary_super_cache` — a single-entry cache holding the most recently matched super. On hot paths the cache hits, the search is one compare, and the apparent cost is similar to `invokevirtual`. On a cache miss, the JVM falls back to a linear scan of the secondary super array — `Klass::is_subtype_of` (`klass.cpp`).

This is why a class implementing 30 interfaces can have measurably slower `instanceof` checks than one implementing 2, particularly under high type-diversity workloads. HotSpot 21+ uses an improved 64-entry packed cache in the klass (the "hash-based" secondary super check) — see JEP 8180450 and `klass.hpp` comments.

---

## 4. Covariant returns and bridge methods — concrete vtable impact

```java
class Box<T> {
    public Object peek() { return null; }
}
class StringBox extends Box<String> {
    @Override public String peek() { return "hi"; }
}
```

After erasure, the JVMS sees two distinct method signatures: `()Object` and `()String`. The class file for `StringBox` therefore contains *two* methods:

- `String peek()` — the real, non-synthetic one you wrote.
- `Object peek()` — a synthetic, `ACC_BRIDGE | ACC_SYNTHETIC` method whose bytecode is `aload_0; invokevirtual StringBox.peek()Ljava/lang/String;; areturn`.

Both go into the vtable. The bridge takes the slot that `Box.peek` originally claimed (so old call sites typed `Box<?>` still work). The covariant `String`-returning method takes a *new* slot in `StringBox`'s vtable.

Observable effect: javap on `StringBox` shows two `peek` methods. HSDB shows the vtable has one extra entry compared to a non-generic version. The JIT can usually fold the bridge away when it inlines, but if the call is dispatched dynamically through a `Box<?>` reference, you pay an extra indirection (bridge -> real method).

See [../03-covariant-returns-and-bridge-methods/](../03-covariant-returns-and-bridge-methods/) for the full bytecode story. The vtable angle: **covariant returns add one vtable slot per overriding class**.

---

## 5. itable layout under multiple interfaces

```java
interface A { void m1(); void m2(); }
interface B { void m3(); }
interface C extends A { void m4(); }
class X implements B, C { /* implementations */ }
```

`X`'s `Klass` ends up with:

- A vtable containing `Object` slots + slots for `m1`, `m2`, `m3`, `m4` (in declaration order encountered).
- A secondary super array: `[A, B, C, Object_secondaries...]`.
- Itables for `A`, `B`, and `C` — `C`'s itable inherits A's methods because `C extends A`.

Inside the `Klass`, itables are packed sequentially in memory:

```
Klass
  ...
  vtable[]            <- contiguous block
  itable_header[]     <- one per implemented interface, with offsets
    itable for A
    itable for B
    itable for C
  ...
```

This layout is laid out specifically so the JIT can compute itable offsets at compile time when the static type is precise (e.g., a checked cast to a specific interface). Source: `instanceKlass.cpp::itable_offset_in_words`.

---

## 6. Inline cache mechanics in deeper detail

The C1/C2 compilers maintain *type profiles* per call site, populated by the interpreter and by C1. When C2 compiles a method, it inspects the profile:

- **Monomorphic site (1 receiver type, > 95% of samples).** Emit a guarded direct call. The guard is `cmp Klass*, EXPECTED_KLASS; jne uncommon_trap`. The trap deoptimizes back to the interpreter if the assumption breaks.
- **Bimorphic site.** Two-way compare-and-branch, then direct call.
- **Megamorphic site.** Full vtable / itable load.

The "uncommon trap" is interesting: it's not just a fallback, it's an *invalidation event*. The JVM may recompile the method with a different inline-cache decision. You can see traps in `-XX:+PrintInlining` output as `(uncommon trap)`.

A subtle consequence: if your call site starts monomorphic, runs hot, then later sees a new receiver type, C2 deoptimizes and re-profiles. If you have a megamorphic call site in a hot loop that you can't refactor, consider:

- Adding a `final` modifier to narrow the type the compiler trusts.
- Using `sealed` to enumerate the possible subtypes, allowing C2 to switch on type instead of looking up.
- Splitting the loop by concrete type at the source level.

---

## 7. Sealed types pruning the vtable surface

```java
sealed interface Shape permits Circle, Rectangle, Triangle {}
record Circle(double r) implements Shape {}
record Rectangle(double w, double h) implements Shape {}
record Triangle(double a, double b, double c) implements Shape {}
```

Sealed types do not change the *runtime* vtable/itable structure — `Shape` still has an itable per implementing class, and dispatch still goes through it. What they change is *what the compiler and JIT can prove*:

- `javac` enforces the closed set in pattern-matching switches.
- C2's CHA (Class Hierarchy Analysis) sees a finite set of subtypes. For a call like `shape.area()`, CHA knows the only possible targets are `Circle.area`, `Rectangle.area`, `Triangle.area`. This makes:
  - Monomorphic devirtualization more likely (one target reachable in this class loader).
  - Bimorphic/trimorphic inlining feasible (three explicit guards instead of a megamorphic fallback).

Records implementing the sealed interface are implicitly `final`, so there's *no* subclass to worry about — perfect for CHA. The combination "sealed interface + record implementations" is the closest Java gets to a closed algebraic type, and the JIT capitalizes on it.

For deep dispatch insight see also the related discussion of composition vs. inheritance in [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/) — sealed hierarchies often replace problematic open hierarchies, and the JIT's job gets easier.

---

## 8. Itable lookup cost in practice

The cost breakdown for a megamorphic `invokeinterface` (no inline cache available):

1. Load object header (1 cache line, often free if already hot).
2. Load `Klass*` from header (1 word).
3. Load `secondary_super_cache` and compare.
4. On miss: linear scan through `secondary_supers[]`.
5. Load `itable_offset` from the matched header.
6. Indexed load to get `Method*`.
7. Indirect call.

That's around 4-6 dependent loads in the worst case. With the inline cache, most of this collapses to one compare. Without it, you're paying the full chain on every invocation.

The new packed-cache secondary super check (JEP 8180450, integrated around JDK 21) replaces step 4 with a near-constant-time hash table lookup against a 64-entry cache. Workloads with many implemented interfaces saw double-digit `instanceof` speedups.

You can measure all of this with JMH plus `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining`. See `optimize.md` Section 3.

---

## 9. When you can't avoid the megamorphic case

Sometimes the right design *is* megamorphic — a plugin host, a generic event bus, a `Runnable` executor. The damage is limited because:

- The fallback is "merely" a few extra loads, not a search through method names.
- Modern hardware predicts indirect branches reasonably well with branch-target buffers.
- Most megamorphic sites are not in your hottest 1% of code — they're in dispatch code that runs once per work item.

If profiling shows a megamorphic site dominating, the levers are: split by type at source level, sealed + switch, narrow the receiver type with `final`, or accept that this is dispatch overhead and focus elsewhere.

A common anti-pattern is over-introducing interfaces for testability and then having every business method run through 4 layers of `invokeinterface`. The fix is usually fewer abstraction layers, not faster dispatch.

---

## 10. Reflection and identity — vtable is not the source of truth

Reflection (`Class.getMethod`, `Method.invoke`) does *not* go through the vtable in the same way `invokevirtual` does. `getMethod` consults the class's method list (the `Klass`'s methods table), not the vtable. So:

```java
Method m = Vehicle.class.getMethod("start");
m.invoke(sportsCar);   // calls SportsCar.start, the override
```

`m` points at `Vehicle.start`, but `invoke` does a virtual dispatch internally (because the receiver is `sportsCar`). The vtable is used at the actual call inside the JVM, not at the reflective lookup. Beginners sometimes assume `m == Vehicle.start` means "this will call Vehicle.start" — it doesn't. This is consistent with `invokevirtual` semantics (JVMS §6.5).

For non-virtual reflective dispatch (calling exactly the method on the named class), use `MethodHandles.Lookup.findSpecial` plus `bindTo`, which translates to `invokespecial`-like behaviour and bypasses the vtable.

---

## 11. Records — no vtable surprises

Records are implicitly `final`. The compiler-generated accessors are non-virtual to subclasses (because none exist), but they still occupy vtable slots for the methods inherited from `Object` and `Record`. CHA proves these classes are leaves, and the JIT devirtualizes their methods aggressively. From a vtable cost perspective, records are essentially free — they exist precisely so the JIT can be confident about dispatch.

```java
public record Point(int x, int y) {
    // accessors x(), y() are final by virtue of the class being final
}
```

`Point`'s vtable: `Object`'s slots + slots for `equals`, `hashCode`, `toString` (overridden), the accessors. No subclass can ever appear, so every call site receiving a `Point` is monomorphic by construction.

---

## 12. Tooling — HSDB, JOL, diagnostic flags

To inspect vtables and itables:

- **HSDB** (`jhsdb hsdb`) — graphical Klass browser. Shows vtable entries by slot, itable entries by interface. Best tool for "what does the JVM actually have for this class".
- **JOL** (`java.org.openjdk.jol`) — `ClassLayout.parseInstance(obj).toPrintable()` shows object layout; doesn't directly show vtables but gives the klass pointer to chase.
- **`-XX:+PrintVtables`** — internal HotSpot flag (requires diagnostic options); prints vtables on class load.
- **`-XX:+PrintInlining`** — shows inlining decisions and reports `(virtual call)` vs `(inline)` vs `(megamorphic)` per call site.
- **`-XX:+PrintMethodData`** — dumps the call-site type profiles C2 uses for inline-cache decisions.

See `tasks.md` for hands-on use.

---

## 13. Quick rules

- [ ] Vtable is built at class load: copy parent, patch overrides, append new, add mirandas for unimplemented interface methods.
- [ ] Itables sit in the `Klass`, one per implemented interface, packed sequentially; secondary super array indexes them.
- [ ] `invokeinterface` cost = `invokevirtual` cost + secondary super search, mitigated by inline caches and the modern packed-cache secondary super check.
- [ ] Covariant returns produce bridge methods, which add one vtable slot per overriding class.
- [ ] CHA + `final` + `sealed` + records = monomorphic call sites = aggressive inlining.
- [ ] Megamorphic call sites pay full table lookups; refactor only if profiling proves the cost matters.
- [ ] Reflection lookups bypass the vtable but `invoke` still uses virtual dispatch on the receiver.

---

## 14. What's next

| Topic                                                  | File              |
| ------------------------------------------------------ | ----------------- |
| Mentoring, tooling, ArchUnit guardrails                | `professional.md`  |
| JVMS sections, HotSpot source pointers                 | `specification.md` |
| Bug stories with stack traces and HSDB output          | `find-bug.md`      |
| Cost numbers, benchmarks, devirtualization recipes     | `optimize.md`      |
| HSDB/JOL/JMH exercises                                 | `tasks.md`         |
| Interview Q&A                                          | `interview.md`     |

---

**Memorize this:** vtables are built at class load by "copy parent, patch overrides, append new, fill mirandas". Itables sit per-interface inside the `Klass` and are reached via the secondary super array. Bridge methods and covariant returns add slots. The JIT's inline cache is what makes `invokeinterface` fast in practice — when it can't, the megamorphic fallback is a chain of dependent loads. Sealed types + records are the JVM's friend because they cap the dispatch surface.
