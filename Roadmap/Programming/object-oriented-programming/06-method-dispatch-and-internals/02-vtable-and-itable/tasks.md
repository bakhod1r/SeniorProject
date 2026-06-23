# vtable and itable — Tasks

> 8 hands-on exercises that turn the concepts in `junior`/`middle`/`senior` into things you can see and measure. Use a JDK 21 (or later) and a Linux/macOS shell. Each task lists the tools needed, the steps to run, and the expected observations. Skip none — together they cover the toolkit professional Java engineers use to reason about dispatch.

---

## Task 1 — Inspect `ArrayList`'s vtable with HSDB

**Goal.** See an actual vtable in HotSpot.

**Tools.** `jhsdb` (ships with the JDK), a running JVM you can attach to.

**Steps.**

1. Start a small program that keeps the JVM alive with `ArrayList` loaded:

   ```java
   public class HsdbTarget {
       public static void main(String[] args) throws Exception {
           java.util.ArrayList<Integer> list = new java.util.ArrayList<>();
           list.add(1); list.add(2); list.add(3);
           System.out.println("pid=" + ProcessHandle.current().pid());
           Thread.sleep(Long.MAX_VALUE);
       }
   }
   ```

2. Run it: `java HsdbTarget`. Note the PID it prints.

3. In another terminal: `jhsdb hsdb --pid <pid>`. (On macOS you may need to disable SIP for the duration; alternatively use a Linux VM.)

4. In the HSDB GUI: `Tools` -> `Class Browser` -> filter for `java.util.ArrayList`. Double-click the class.

5. Click into the `Klass` and locate the vtable. Note:
   - The first ~10 slots are inherited from `Object`.
   - Slots for `AbstractList`'s methods follow.
   - Slots for `ArrayList`'s overrides (`add`, `get`, `size`, etc.).

**Observe.** `ArrayList`'s vtable is roughly 40-50 slots: Object's 10 + AbstractCollection + AbstractList + ArrayList's own. Compare with the vtable of `java.lang.Object` (Tools -> Class Browser -> `java.lang.Object`) which has just the base entries.

**Why this matters.** Numbers on paper become tangible. You can now answer "how many slots does class X have?" with a measurement instead of an estimate.

---

## Task 2 — Predict the vtable slot for an override

**Goal.** Confirm your mental model of slot allocation by predicting before checking.

**Steps.**

1. Write this code:

   ```java
   class A {
       public void m1() {}
       public void m2() {}
       public void m3() {}
   }
   class B extends A {
       @Override public void m2() {}   // override
       public void m4() {}              // new
   }
   class C extends B {
       @Override public void m1() {}   // override A's
       @Override public void m4() {}   // override B's
       public void m5() {}              // new
   }
   ```

2. Without running anything, write down (on paper) the expected slot layout for `C.vtable`, after Object's inherited slots.

3. Open HSDB on a running program that loads `C`. Compare your prediction with what HSDB shows.

**Expected layout** (after Object's slots):

```
slot N+0  -> C.m1     (override of A.m1)
slot N+1  -> A.m2     (no wait — B.m2 overrode it; let's redo)
```

Try again carefully:

```
slot N+0  -> C.m1
slot N+1  -> B.m2
slot N+2  -> A.m3
slot N+3  -> C.m4
slot N+4  -> C.m5
```

**Observe.** Each subclass inherits or replaces the parent's slot order. New methods append. Your first prediction is probably wrong somewhere; checking against HSDB calibrates your mental model.

---

## Task 3 — Compare vtable sizes: `Object`, `String`, custom deep hierarchy

**Goal.** Quantify how vtable size scales with class complexity.

**Steps.**

1. Create three classes:
   - `Empty` (extends `Object`, declares nothing).
   - A wrapper around `String` (use `String.class` directly).
   - A 6-level deep hierarchy where each level adds 5 methods. The leaf `Deep` is your custom class.

2. In HSDB, navigate to each class. Note the total vtable length.

3. Tabulate:

   ```
   Object   -> ~10 slots
   Empty    -> ~10 slots (no own methods, so same as Object)
   String   -> ~30+ slots (final class with many own methods)
   Deep     -> ~10 + 30 = ~40 slots
   ```

4. Now look at itables. `String` implements 4 interfaces (`Serializable`, `Comparable`, `CharSequence`, `Constable`). Each contributes an itable. HSDB shows them as separate entries under the `Klass`.

**Observe.** Vtable size is roughly `Object slots + sum(declared overridable methods up the chain)`. Itable count equals the size of the implements-closure. For an enterprise class implementing 8 marker/role interfaces, itable cost can exceed vtable cost.

---

## Task 4 — Verify devirtualization with `-XX:+PrintInlining`

**Goal.** See the JIT decide whether to devirtualize a call.

**Tools.** JDK, `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining`.

**Steps.**

1. Write a tight loop:

   ```java
   interface Op { int apply(int x); }
   static final class AddOne implements Op { public int apply(int x){ return x+1; } }

   public static int sum(Op op) {
       int s = 0;
       for (int i = 0; i < 100_000_000; i++) s = op.apply(s);
       return s;
   }

   public static void main(String[] args) {
       Op op = new AddOne();
       for (int warm = 0; warm < 5; warm++) sum(op);
       System.out.println(sum(op));
   }
   ```

2. Run with: `java -XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation -XX:+PrintInlining DevirtTest 2>&1 | grep -A 3 'sum'`.

3. Look for lines like:

   ```
   @ 12   DevirtTest$AddOne::apply (4 bytes) inline (hot)
   ```

   Versus the megamorphic case (when `op` varies):

   ```
   @ 12   Op::apply (0 bytes) (virtual call)
   ```

**Observe.** With one implementation, the call is inlined. Add `MulTwo`, `Negate`, `Square` implementations and rotate them — the inlining annotation changes to `(virtual call)` or `(megamorphic)`.

---

## Task 5 — Refactor a megamorphic interface call site

**Goal.** Practice the refactor pattern from `find-bug.md` Bug 2.

**Steps.**

1. Start with the megamorphic loop:

   ```java
   interface Handler { void handle(Event e); }
   class HandlerA implements Handler { ... }
   class HandlerB implements Handler { ... }
   class HandlerC implements Handler { ... }
   class HandlerD implements Handler { ... }
   class HandlerE implements Handler { ... }

   public void process(List<Event> events, Map<EventType, Handler> handlers) {
       for (Event e : events) {
           handlers.get(e.type()).handle(e);
       }
   }
   ```

2. Write a JMH benchmark of `process` with 100,000 events distributed across all 5 types. Record the score.

3. Refactor to group by type:

   ```java
   public void process(List<Event> events, Map<EventType, Handler> handlers) {
       Map<Handler, List<Event>> grouped =
           events.stream().collect(Collectors.groupingBy(e -> handlers.get(e.type())));
       grouped.forEach((handler, batch) -> {
           for (Event e : batch) handler.handle(e);
       });
   }
   ```

4. Re-run the benchmark. The second version should be 2-3x faster on a CPU-bound `handle` because each inner loop is monomorphic.

5. Bonus: seal `Handler` (`sealed interface Handler permits HandlerA, HandlerB, ...`) and verify with `-XX:+PrintInlining` that the JIT inlines via CHA even in the original loop.

**Observe.** Source-level structure determines call-site polymorphism. Same logic, different shape, different cost.

---

## Task 6 — Design a sealed hierarchy to keep itables small

**Goal.** Apply sealed types to a real domain.

**Steps.**

1. Take an existing open hierarchy in your codebase (or invent one — payment methods, notification channels, audit events).

2. List the current implementations. If there are 3-8, you're in the sweet spot for sealed.

3. Convert:

   ```java
   public sealed interface PaymentMethod permits Card, Bank, Wallet, ApplePay {
       void charge(BigDecimal amount);
   }

   public final class Card    implements PaymentMethod { ... }
   public final class Bank    implements PaymentMethod { ... }
   public final class Wallet  implements PaymentMethod { ... }
   public final class ApplePay implements PaymentMethod { ... }
   ```

4. Replace any `if/else if instanceof` chains with `switch` over the sealed type:

   ```java
   switch (method) {
       case Card c     -> processCard(c);
       case Bank b     -> processBank(b);
       case Wallet w   -> processWallet(w);
       case ApplePay a -> processApplePay(a);
   }
   ```

5. Verify exhaustiveness: remove one `case` and confirm `javac` rejects the code.

6. Compare HSDB output before/after: the implementations are now `final` records or final classes, so subclass-related vtable slack is gone, and CHA sees a closed set of itable targets.

**Observe.** Sealed + final implementations + exhaustive switch is the JVM-friendly equivalent of an algebraic data type. The vtable/itable structures don't change shape, but the JIT's confidence in them does.

---

## Task 7 — Profile a polymorphic loop with JMH + async-profiler

**Goal.** Combine throughput numbers with flame-graph evidence.

**Tools.** JMH (Gradle/Maven plugin), async-profiler (download from GitHub), JDK 21.

**Steps.**

1. Build the `DispatchBench` from `optimize.md` Section 4 (mono/bi/megamorphic Shape loop).

2. Run JMH with async-profiler attached:

   ```
   java -jar benchmarks.jar -prof async:output=flamegraph DispatchBench.megamorphic
   ```

3. Open the resulting `flame-megamorphic.html`. You should see:
   - The `area()` call dispatched through `itable_stub` or `vtable_stub` frame.
   - A wide bar in `Klass::is_subtype_of` or the itable lookup path.

4. Compare with `flame-monomorphic.html`: the `area()` call is inlined; you see only the arithmetic.

5. As an extra, run with `-XX:+PrintInlining` enabled in the JMH fork:

   ```java
   @Fork(jvmArgsAppend = {"-XX:+UnlockDiagnosticVMOptions", "-XX:+PrintInlining"})
   ```

   and grep for `(megamorphic)` and `(virtual call)` annotations.

**Observe.** The flame graph and JMH numbers tell complementary stories. JMH gives you scalar latency; the flame graph tells you *which code is responsible*.

---

## Task 8 — Explain bridge methods' vtable impact

**Goal.** See the bridge method that `javac` produces and where it lives in the vtable.

**Steps.**

1. Write the code:

   ```java
   class Container<T> {
       public Object peek() { return null; }
   }
   class StringContainer extends Container<String> {
       @Override public String peek() { return "hi"; }
   }
   ```

2. Compile and run `javap -v -p StringContainer.class`. Look for two `peek` entries:

   ```
   public java.lang.String peek();
       flags: ACC_PUBLIC

   public java.lang.Object peek();
       flags: ACC_PUBLIC, ACC_BRIDGE, ACC_SYNTHETIC
       Code:
         0: aload_0
         1: invokevirtual #N // Method peek:()Ljava/lang/String;
         4: areturn
   ```

3. Load `StringContainer` in HSDB. Look at the vtable. You should see *both* methods occupying *separate slots*.

4. Write a small driver:

   ```java
   Container<?> c = new StringContainer();
   System.out.println(c.peek());      // dispatches through bridge -> real method
   StringContainer s = new StringContainer();
   System.out.println(s.peek());      // dispatches directly
   ```

5. Run with `-XX:+PrintInlining`. The first call shows two inlined methods (bridge + real); the second shows one.

**Observe.** The bridge is real. It occupies a vtable slot. Through a generic-erased reference, you pay an extra hop. The JIT inlines both in practice, so the cost vanishes — but in reflective code, both methods are visible and must be filtered (Bug 3 in `find-bug.md`).

---

## Wrap-up checklist

After completing all eight tasks, you should be able to:

- [ ] Open HSDB and read a class's vtable and itables.
- [ ] Predict slot allocation for a given hierarchy and verify your prediction.
- [ ] Compare vtable sizes across classes of different complexity.
- [ ] Use `-XX:+PrintInlining` to identify devirtualized vs. virtual call sites.
- [ ] Refactor a megamorphic call site to recover monomorphism.
- [ ] Design a sealed hierarchy and confirm `javac` checks exhaustiveness.
- [ ] Run JMH + async-profiler to combine numbers with flame graphs.
- [ ] Identify a bridge method in javap output and explain its vtable cost.

---

## Quick rules

- [ ] HSDB is for *structural* questions ("what's in the vtable?").
- [ ] `-XX:+PrintInlining` is for *behavioural* questions ("did the JIT devirtualize?").
- [ ] JMH is for *quantitative* questions ("how much faster after the refactor?").
- [ ] async-profiler is for *production-shaped* questions ("where is the time going under load?").
- [ ] Combine all four — no single tool gives the full picture.

---

**Memorize this:** the eight tasks are a vocabulary. Once you've done them, conversations about dispatch performance stop being abstract and become "let me check with X, run Y, look at Z". That's the skill these exercises build.
