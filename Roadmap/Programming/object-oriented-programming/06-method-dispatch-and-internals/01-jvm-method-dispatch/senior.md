# JVM Method Dispatch — Senior

> **What?** The HotSpot machinery beneath the five opcodes: tiered compilation, inline caches and their eviction policy, deoptimization when CHA invalidates, the `invokedynamic` bootstrap protocol in depth, and the choice between abstract classes and interfaces seen through the lens of `invokevirtual` vs `invokeinterface`.
> **How?** By treating method dispatch as a *speculation system*: the JIT bets on what it observes, leaves a guard, and falls back when the bet fails. Once you can name the speculation, the inline cache state, and the deoptimization condition, every "why did my hot loop slow down?" question has a structural answer.

---

## 1. Tiered compilation: C1, C2, and the receiver-type profile

HotSpot ships with two JIT compilers and a tiered policy that bridges them.

- **Interpreter (level 0)** — every method starts here. Bytecode is executed directly. A simple invocation counter ticks.
- **C1 (levels 1–3)** — the fast compiler. Produces decent code quickly. At level 2 (the typical first compile) it also instruments the code to *collect type profiles* at every virtual call site.
- **C2 (level 4)** — the optimizing compiler. Uses the profile collected by C1 to make inlining decisions: monomorphic gets a direct call, bimorphic gets a type-switch with two inlined bodies, megamorphic gets a real `invokevirtual` / `invokeinterface`.
- **Graal (alternative level 4)** — an experimental replacement for C2 available via `-XX:+UseJVMCICompiler`. Same theory, different heuristics.

Each call site accumulates a *receiver type profile* during the interpreted + C1 phase: typically four slots, each holding `(klass, count)`. When C2 compiles, it reads the profile and decides:

```
profile slots used  |  C2's choice
1                   |  monomorphic — direct call, optionally guarded
2                   |  bimorphic   — `if (klass == A) callA; else if (klass == B) callB;`
3+                  |  megamorphic — fall back to vtable / itable
```

The bimorphic-inlining trick — two inlined bodies plus a guard — is HotSpot's signature optimization. It catches most real polymorphism in production code, because the *distribution* of receiver types at a single call site tends to be heavily skewed: one or two types dominate, even when the hierarchy has dozens of implementations.

---

## 2. Inline caches: monomorphic, polymorphic, megamorphic

The *inline cache* (IC) is the data structure HotSpot maintains at every virtual call site in compiled code. Conceptually three states:

**Monomorphic IC.** The first call records the receiver's `klass`. Subsequent calls check `klass == recorded`; if true, jump direct. The check is one load + compare + conditional branch — about 1 ns.

```
; pseudo-asm of a monomorphic IC for `formatter.format(e)`
cmp  [rdi+klass_offset], JsonFormatter_klass
jne  ic_miss
call JsonFormatter::format
```

**Polymorphic IC (PIC).** After the first IC miss with a *different* klass, HotSpot rewrites the call site to hold *two* `(klass, target)` pairs and a fall-through. Three loads + compares; still cheap.

```
cmp  [rdi+klass_offset], JsonFormatter_klass
je   call_json
cmp  [rdi+klass_offset], CsvFormatter_klass
je   call_csv
jmp  ic_miss          ; megamorphic transition
```

**Megamorphic IC.** After enough distinct misses (HotSpot's default threshold is small, often 4), the call site transitions to a *megamorphic stub* that performs a real vtable or itable walk. The PIC entries are evicted. Once a call site is megamorphic, it stays megamorphic for the lifetime of the compiled method — the recompile would not improve it.

The implication: a call site that has *ever* seen many types stays slow even after the load pattern narrows. The way back is **deoptimization** (next section), which throws away the compiled code so a fresh profile can be collected.

---

## 3. Deoptimization triggers

Deoptimization is HotSpot abandoning a compiled method mid-execution and falling back to the interpreter (and eventually recompiling with new assumptions). The mechanism:

1. The compiled method has *frame metadata* that maps compiled state back to interpreter state.
2. When a guard fails — a CHA assumption violated, a class load invalidates an inline assumption, an `instanceof` check disagrees with the assumed type — HotSpot reconstructs an interpreter frame at the deopt point and resumes execution there.
3. The invocation counter eventually triggers recompilation, this time with the new information.

Common deopt triggers for dispatch:

- **`uncommon_trap(class_check)`** — a guard inserted by C2 found an unexpected receiver class.
- **`uncommon_trap(unstable_if)`** — a branch the compiler thought was never taken got taken.
- **`uncommon_trap(class_loaded)`** — a new subclass of a CHA-devirtualized type loaded.
- **`uncommon_trap(intrinsic)`** — an intrinsic (like `Object.getClass()`) saw something unexpected.

You can see deopts with `-XX:+PrintCompilation -XX:+PrintAssembly` or, more usefully, `-XX:+UnlockDiagnosticVMOptions -XX:+TraceDeoptimization`. A handful of deopts during warmup is fine. A *cascade* of deopts in steady state means your assumptions are wrong and the JIT is thrashing.

```
$ java -XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation App
...
   1234 12 % 4   com.example.HotLoop::run @ 14 (54 bytes)
   1235    4   made not entrant   com.example.HotLoop::run (54 bytes)   <-- deopt
   1240 13 % 4   com.example.HotLoop::run @ 14 (54 bytes)               <-- recompile
```

A method that goes through three or more deopt/recompile cycles is a tuning problem.

---

## 4. CHA invalidation cascade

CHA-based devirtualization is the most aggressive optimization the JIT performs on virtual calls, and the one most likely to be invalidated. Suppose:

```java
interface PaymentMethod { void charge(BigDecimal amount); }
final class CardPayment implements PaymentMethod { public void charge(BigDecimal a) { ... } }
// Only CardPayment loaded so far.

class Checkout {
    void run(PaymentMethod m, BigDecimal amount) {
        m.charge(amount);   // CHA: only CardPayment exists, devirtualize.
    }
}
```

C2 compiles `Checkout.run` with the call to `CardPayment.charge` inlined directly. Three months later, someone deploys a build that loads `CryptoPayment`:

```java
final class CryptoPayment implements PaymentMethod { public void charge(BigDecimal a) { ... } }
```

The class-load event fires a *dependency notification*: HotSpot tracks which compiled methods depended on "only one impl of `PaymentMethod`". `Checkout.run` is one such method. HotSpot invalidates it, marks it *not entrant*, and the next call falls into the interpreter. When `Checkout.run` is recompiled, CHA sees two impls — it falls back to bimorphic inlining or a real `invokeinterface`.

The cascade: if `Checkout.run` is itself inlined into a caller, that caller is also invalidated. If those callers are themselves inlined elsewhere, deopt propagates. A class load can wipe out a large chunk of compiled code.

The mitigation, already noted in middle.md: `final` and `sealed`. With `final class CardPayment`, CHA's "no subclass exists" is *permanent*; the deopt risk is gone. With `sealed interface PaymentMethod permits CardPayment, CryptoPayment`, the set of impls is closed at compile time; CHA can't be invalidated by a class load (because no new impl is permitted).

---

## 5. Profile pollution — when many call sites share one method

A subtle failure mode: a *generic utility* method gets called from dozens of sites, each with a different receiver type distribution. The receiver-type profile inside the utility's call sites becomes a union of all callers' types. C2 sees megamorphism everywhere, even though *each individual caller* would have been monomorphic on its own.

```java
public class Pipeline {
    public <T, R> List<R> apply(List<T> items, Function<T, R> fn) {
        return items.stream().map(fn).toList();    // <-- shared call site to fn.apply
    }
}
```

If `Pipeline.apply` is called from 20 different sites with 20 different lambdas, the *one* call site `fn.apply(item)` inside `Pipeline.apply` sees 20 receiver types. Profile pollution. Even though each caller would have been monomorphic in its own context, the shared bottleneck is megamorphic.

Fixes:

1. **Inline the utility.** Stop sharing; let each caller inline `stream().map(fn).toList()` inline.
2. **Force C2 to inline the utility.** `-XX:+UseInlineCaches` is on by default; for HotSpot to specialize per caller, the utility has to be inline-small enough that C2 chooses to inline it into each call site. Small utilities (a few lines) typically do; large ones don't.
3. **Specialize types.** If only a few distinct concrete lambdas exist, give each its own dedicated pipeline method.

JFR (`-XX:StartFlightRecording=duration=60s,settings=profile`) shows per-call-site receiver distributions; async-profiler does similarly. If you see the same method showing up hot with megamorphic dispatch, profile pollution is the suspect.

---

## 6. Abstract class vs interface — the cost gap

`invokevirtual` (class) and `invokeinterface` (interface) are *not* equal cost when both are megamorphic.

- **`invokevirtual`** walks a *vtable*: a flat, contiguous array of method pointers, one per virtual method in the class. The index is fixed at compile time. One load + one indirect call.
- **`invokeinterface`** walks an *itable*: each class that implements an interface has an itable for that interface, stored in the class metadata. To dispatch, the JVM looks up the receiver's itable for the interface (a search), then indexes into it. Modern HotSpot caches the itable pointer per call site to amortize the search, but the cold path is more expensive than `invokevirtual`.

In numbers: a megamorphic `invokevirtual` typically costs ~5 ns; a megamorphic `invokeinterface` ~7–10 ns. For monomorphic and bimorphic call sites, both inline to roughly the same code and the gap vanishes.

**When the gap matters:** a hot loop that runs billions of times per second over a heterogeneous collection through an interface. Replacing the interface with a sealed abstract class (closing the type set) is the cleanest fix; replacing with a sealed *interface* doesn't change the opcode but does enable CHA-driven devirtualization.

**When it doesn't matter:** anywhere outside hot loops, which is 99% of code. Interfaces win on design grounds (`Composition over inheritance`, ISP, DIP from [../../03-design-principles/](../../03-design-principles/)). Don't choose abstract class over interface for dispatch reasons unless you've measured and you're losing percent.

---

## 7. `invokedynamic` bootstrap in depth

`invokedynamic` is HotSpot's most flexible call site. The wire-level protocol:

1. **The bytecode** is `invokedynamic indyCpIndex, 0`. The constant pool slot at `indyCpIndex` is a `CONSTANT_InvokeDynamic_info` containing:
   - A bootstrap method specifier (an index into the class file's `BootstrapMethods` attribute).
   - A name and method type descriptor (the call site's signature).
2. **The `BootstrapMethods` attribute** holds the bootstrap method handle plus its *static arguments* — constants known at compile time.
3. **First execution** triggers *call site resolution*:
   - The JVM resolves the bootstrap method handle (an `invokestatic` reference).
   - It calls the bootstrap method with `(Lookup, name, MethodType, ...staticArgs)`.
   - The bootstrap returns a `java.lang.invoke.CallSite` object.
   - The JVM caches the call site at this `invokedynamic` instruction.
4. **Subsequent executions** invoke the `MethodHandle` held in the `CallSite`. The MethodHandle is essentially a function pointer the JIT can inline.

The `CallSite` has three flavors:

- **`ConstantCallSite`** — the target never changes. The JIT inlines aggressively (the MethodHandle is a compile-time constant). Lambdas use this.
- **`MutableCallSite`** — the target can be swapped at runtime via `setTarget`. Dynamic-language implementations use this for class redefinition.
- **`VolatileCallSite`** — like mutable but with cross-thread memory ordering. Rare.

The performance bet: bootstrap is *expensive* (typically microseconds), but it runs once. After that, the call site is at most a MethodHandle invocation, which the JIT inlines essentially to a direct call.

JEPs to know:

- **JEP 181 (Java 8)** — lambdas via `LambdaMetafactory`. The canonical use of `invokedynamic`.
- **JEP 280 (Java 9)** — `StringConcatFactory` for string `+`. Replaces the old `StringBuilder` chain.
- **JEP 309 (Java 11)** — constant dynamic (`condy`). Lets you have constants that compute lazily via a bootstrap.
- **JEP 406 / 441 (Java 17 / 21)** — pattern matching `switch`, which compiles patterns via `invokedynamic` to type-switch bootstraps.

---

## 8. Megamorphic profile in `record` hierarchies

A subtle interaction: records are implicitly `final`. So when you write:

```java
public sealed interface Result<T> permits Success, Failure {}
public record Success<T>(T value)        implements Result<T> {}
public record Failure<T>(Throwable cause) implements Result<T> {}
```

CHA knows `Result<T>` has exactly two implementers, and each is `final`. A call site typed as `Result<T>` that calls a hypothetical method on it has the *best* possible dispatch profile: closed-world, two `final` classes, no subclassing risk. Pattern-matching `switch` on `Result<T>` compiles to a type-switch and inlines both branches.

Compare with the open-world version:

```java
public interface Result<T> {}
public class Success<T> implements Result<T> { ... }
public class Failure<T> implements Result<T> { ... }
```

Same logical shape, *worse* dispatch profile: open interface, non-`final` classes, CHA's "only two impls" assumption is speculative and could be invalidated by any future class load.

When you reach for records implementing a sealed interface, you're not just expressing intent — you're handing the JIT a closed type set that survives every future class load. That is one of the strongest invariants you can give HotSpot.

---

## 9. The hot path checklist

When profiling shows dispatch overhead on a hot path, walk this checklist:

1. **Identify the call site.** `-XX:+PrintInlining` shows decisions per call site. Find the one labeled `(virtual call)` or `(megamorphic)`.
2. **Count the receiver types.** JFR or async-profiler shows the per-call-site type distribution. One type → already monomorphic, look elsewhere. Two → bimorphic, the JIT inlined both. Three or more → megamorphic, here's your problem.
3. **Can you close the type set?** Apply `sealed` to the interface and `final` to each implementer. CHA can then fully devirtualize.
4. **Is the call site shared across many callers?** Profile pollution. Inline the shared utility into each caller, or specialize.
5. **Is the deopt log busy?** A class load is invalidating CHA. Either move the class load earlier (warm up before the steady state) or harden the type set with `final`.
6. **Is the call truly hot?** If the dispatch cost is 5 ns and the method body is 50 ns, dispatch is 10% of the cost. Worth a refactor. If the body is 5 µs, dispatch is in the noise.

A useful number to remember: a monomorphic inlined call is ~0–1 ns, a megamorphic interface call is ~10 ns. The gap is real but only matters when you're calling many billions of times.

---

## 10. The cost of indirection through abstract classes vs interfaces

A common middle-level mistake is treating *abstract class* and *interface* as interchangeable for dispatch. They have different costs even at the same logical shape:

```java
// Abstract class version
public abstract class Formatter {
    public abstract String format(Event e);
}
public final class JsonFormatter extends Formatter { public String format(Event e) { ... } }

// Interface version
public interface Formatter {
    String format(Event e);
}
public final class JsonFormatter implements Formatter { public String format(Event e) { ... } }
```

For monomorphic call sites both inline identically. For megamorphic call sites the abstract-class version uses `invokevirtual` (vtable lookup), the interface version uses `invokeinterface` (itable lookup). On x64 the gap is typically 1–3 cycles in steady-state cached state, more in cold cases.

The *design* recommendation in [../../03-design-principles/](../../03-design-principles/) is to prefer interfaces for dependency abstractions — it composes better, supports multiple inheritance of type, plays well with `record` and `sealed`. The *dispatch* implication is small enough that you should ignore it unless profiling proves otherwise.

The legitimate use case for an abstract class as a dispatch optimization is when you have a *single* deep hierarchy of related types that all share state, are virtually called in a hot loop, and you've measured a real win. This is rare. Most teams who chose abstract class for performance reasons would not survive a code review.

---

## 11. `final` methods and `invokevirtual`

`final` methods are an interesting case at the bytecode level. The opcode is still `invokevirtual`:

```java
public class Engine {
    public final int rpm() { return 800; }
}

class Caller {
    void use(Engine e) {
        int x = e.rpm();
    }
}
```

```
0: aload_1
1: invokevirtual #2  // Method Engine.rpm:()I
```

But because the method is `final`, the JIT proves at compile time that no subclass can override `rpm`. CHA + the `final` modifier together let C2 inline the call as if it were `invokestatic`. The opcode is `invokevirtual` for compatibility (so the JVM knows there's a receiver, runs null checks, etc.), but the runtime cost matches `invokestatic`.

This is why marking method as `final` is a meaningful performance hint, even though Java doesn't require it for correctness. The JIT can usually figure it out via CHA, but `final` removes the deopt risk: a future `non-sealed` subclass cannot make `rpm` virtual again, because the modifier is encoded in the class file.

`private` methods have a similar story. They use `invokespecial` (not `invokevirtual`), so they're *statically bound* by the opcode itself. The JIT inlines freely with no CHA dance.

---

## 12. Quick rules

- [ ] Each call site has an inline cache: monomorphic → polymorphic (PIC) → megamorphic. Once megamorphic, the compiled code stays that way until a deopt.
- [ ] Tiered compilation: interpreter → C1 (profiling) → C2 (optimizing). Profile pollution at the C1 stage poisons C2's choices.
- [ ] CHA-driven devirtualization is *speculative*. `final` and `sealed` make it non-speculative.
- [ ] Deoptimization is the JIT's escape hatch. A few during warmup is normal; cascades in steady state are tuning bugs.
- [ ] `invokevirtual` and `invokeinterface` cost the same when monomorphic. Megamorphic interface dispatch costs slightly more (itable lookup).
- [ ] `invokedynamic` bootstraps once, runs many times. The bootstrap returns a `CallSite` the JIT inlines.
- [ ] Profile pollution: a shared utility's call site sees the union of all callers' types. Fix by specializing or inlining the utility.
- [ ] `final` methods compile to `invokevirtual` but cost like `invokestatic` thanks to CHA.

---

## 13. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Driving dispatch-aware reviews, ArchUnit, JFR               | `professional.md`  |
| JVMS §6.5, §5.4.5, JLS §8.4.8, JEPs 181/280/309             | `specification.md` |
| 10 buggy dispatch snippets                                  | `find-bug.md`      |
| Cost per opcode, CHA, sealed, JMH                           | `optimize.md`      |
| Hands-on exercises with `javap`, JMH, PrintInlining         | `tasks.md`         |
| 20 interview questions                                      | `interview.md`     |

See also [../02-vtable-and-itable/](../02-vtable-and-itable/) for the table layout walked by `invokevirtual` and `invokeinterface`, and [../05-escape-analysis-and-scalar-replacement/](../05-escape-analysis-and-scalar-replacement/) for how monomorphic dispatch unlocks scalar replacement.

---

**Memorize this:** dispatch is a *speculation system*. The JIT bets on receiver type via inline caches, on hierarchy shape via CHA, on call-site stability via `invokedynamic`'s ConstantCallSite. Each bet has a guard; a failed guard triggers deoptimization. `final` and `sealed` convert speculative bets into permanent invariants. Megamorphism is the failure mode — it kills inlining, escape analysis, and constant folding all at once. Read the deopt log, count receiver types per call site, and close the type set when it matters.
