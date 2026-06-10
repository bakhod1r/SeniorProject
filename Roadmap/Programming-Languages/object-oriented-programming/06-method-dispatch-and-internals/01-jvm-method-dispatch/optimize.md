# JVM Method Dispatch — Optimize

> Five `invoke*` opcodes; three inline-cache states; one big tradeoff between closed-world dispatch (fast, JIT-friendly) and open-world polymorphism (extensible, slow when megamorphic). This file walks the cost of each opcode in cycles and cache lines, how HotSpot's tiered compilation specializes call sites, when to reach for `sealed` and `final` as JIT hints, how to read `-XX:+PrintInlining` output, and a worked JMH harness comparing four dispatch shapes. All numbers are illustrative; verify in your environment.

---

## 1. Cost of each opcode in cycles

Approximate steady-state costs on modern x86_64 hardware with HotSpot JDK 21. Numbers vary by µarch, code layout, and cache state.

| Opcode            | Monomorphic | Bimorphic | Megamorphic |
| ----------------- | ----------- | --------- | ----------- |
| `invokestatic`    | ~0 ns       | n/a       | n/a         |
| `invokespecial`   | ~0 ns       | n/a       | n/a         |
| `invokevirtual`   | ~0 ns       | ~1–2 ns   | ~5–7 ns     |
| `invokeinterface` | ~0 ns       | ~1–2 ns   | ~7–10 ns    |
| `invokedynamic`   | ~0 ns (CCS) | n/a       | n/a (MCS depends) |

(`CCS` = `ConstantCallSite`; `MCS` = `MutableCallSite`. A constant call site behind `invokedynamic` is inlined to the cost of the target method handle, which is typically the same as a direct call. Mutable call sites cost more depending on swap frequency.)

For monomorphic and bimorphic sites, all four opcodes inline to roughly the same cost. The gap appears when the IC is megamorphic — at that point, `invokevirtual` walks a vtable (one indirection), `invokeinterface` walks an itable (one indirection plus a small hashed lookup). The difference is small but measurable.

The headline: **dispatch is essentially free when monomorphic**, and the cost rises sharply once you exceed bimorphism. Profile the receiver-type distribution; don't guess.

---

## 2. HotSpot's tiered compilation, revisited

The compiler pipeline:

```
Bytecode --> Interpreter (level 0)
                  |  invocation counter exceeds threshold
                  v
              C1 with profiling (level 2 or 3)
                  |  collects type profile at every virtual call site
                  v
              C2 (level 4)
                  uses the profile to make inlining decisions
```

The profiling is the critical step. C1 instruments each virtual call site to record up to ~4 receiver klasses + counts. When C2 compiles, it reads those slots:

- 1 slot used → monomorphic; direct call (with optional guard).
- 2 slots used → bimorphic; type-switch inlining of both bodies.
- 3+ slots used → megamorphic; fall back to vtable / itable.

The threshold for promotion from level 0 → 2 is typically ~2500 invocations; from level 2 → 4 is ~10000. Hot code reaches C2 quickly in real workloads. Code paths that run rarely stay in the interpreter or at C1; for them, dispatch cost is dominated by the interpreter's overhead, not by opcode choice.

You can inspect the JIT's decisions with:

```
$ java -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining App
```

Sample output:

```
@ 14   Pipeline::run (54 bytes)   inline (hot)
  @ 23   JsonFormatter::format (12 bytes)   inline (hot)
@ 14   Pipeline::run (54 bytes)   already compiled into a big method
  @ 23   Formatter::format (0 bytes)   virtual call
```

The first run inlined `JsonFormatter.format` directly into `Pipeline.run`. The second saw `Formatter.format` as a virtual call (likely megamorphic, or CHA could not prove a single impl). The first is essentially zero-cost; the second pays vtable cost on every invocation.

---

## 3. CHA + `final` + `sealed` for full devirtualization

CHA's job: at JIT time, prove that a virtual call site has a single possible target. When it succeeds, the JIT emits a direct call (with a guard against future class loads).

The strongest CHA hints:

**`final` class.** No subclass possible. CHA's "only impl" is permanent; no deopt guard needed.

```java
public final class JsonFormatter implements Formatter {
    public String format(Event e) { ... }
}
```

**`final` method.** That specific method cannot be overridden. CHA proves the target is fixed at the declaring class.

**`sealed` interface + `final` records.** The type set is closed. Every implementer is itself non-extensible. CHA knows the *entire* hierarchy at compile time.

```java
public sealed interface PaymentMethod permits CardPayment, BankPayment, CryptoPayment {}
public record CardPayment(String token)   implements PaymentMethod {}
public record BankPayment(String iban)    implements PaymentMethod {}
public record CryptoPayment(String wallet) implements PaymentMethod {}
```

A pattern switch on this type compiles to a type-switch chain with all three branches inlined. Zero vtable cost; no deopt risk on future class loads.

**`non-sealed`** is the escape hatch — a subclass in a sealed hierarchy that re-opens that one branch for extension. The JIT gives up devirtualization on the `non-sealed` branch but keeps it on the other branches. Use sparingly.

---

## 4. Profile-Guided Optimization via `-XX:+TieredCompilation`

`-XX:+TieredCompilation` is the default since JDK 8 and enables the level-2 profiling stage that C2 depends on. Disabling it (`-XX:-TieredCompilation`) skips C1 profiling — C2 has to guess at receiver types, often suboptimally.

You won't typically disable tiered compilation; it's mentioned because some HotSpot tuning guides from the JDK 7 era talk about `-server` and `-client` modes. Those are obsolete. Modern HotSpot ships tiered compilation as the default and you should leave it on.

Two related flags worth knowing:

- **`-XX:CompileThreshold=N`** — invocation count required for compilation. Default ~10000. Lowering it makes the JIT compile earlier (less profile data, possibly worse decisions). Raising it delays compilation (more profile data, longer warmup).
- **`-XX:Tier3InvocationThreshold=N`** — threshold for promotion from level 2 to level 3 (compiled, still profiling). Affects how aggressively C2 collects more samples before deciding.

For most applications, defaults are fine. Tune only with measurable wins to back the change.

---

## 5. Deoptimization triggers and how to read the log

Deoptimization is the JIT abandoning a compiled method and restarting in the interpreter. Common triggers:

- **`uncommon_trap(class_check)`** — a type guard failed. The compiled code assumed receiver type X; got Y.
- **`uncommon_trap(class_loaded)`** — a class load invalidated a CHA assumption.
- **`uncommon_trap(unstable_if)`** — a branch the compiler thought was always-taken got skipped.
- **`uncommon_trap(intrinsic)`** — a JIT-recognised intrinsic (like array bounds) tripped its assumption.

Enable trace output:

```
$ java -XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation -XX:+TraceDeoptimization App
```

You'll see lines like:

```
   1234   4   made not entrant   com.example.HotLoop::run (54 bytes)
[Deoptimization] reason=class_check action=reinterpret
   compile_id=12  bci=14  method=com.example.HotLoop.run
```

A handful of deopts during warmup is normal (the JIT speculatively assumes things, then learns better). A *cascade* of deopts in steady state — the same method being recompiled and invalidated repeatedly — is a tuning bug. Common causes: open hierarchies with classes loading lazily (use `sealed` or eager-load), inline cache thrashing (see Bug 10 in [`find-bug.md`](./find-bug.md)), or `MutableCallSite` whose target is swapped frequently.

---

## 6. JMH benchmark: four dispatch shapes

The benchmark below compares four dispatch shapes for the same logical operation: a simple arithmetic dispatch among `add`, `sub`, `mul`.

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@State(Scope.Benchmark)
@Fork(value = 2, jvmArgsAppend = {"-XX:+UnlockDiagnosticVMOptions"})
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
public class DispatchBench {

    // 1. Static dispatch
    static long staticAdd(long a, long b) { return a + b; }

    // 2. Final virtual (monomorphic by definition)
    static final class FinalAdder { public long apply(long a, long b) { return a + b; } }

    // 3. Monomorphic interface
    interface Op { long apply(long a, long b); }
    static final class AddOp implements Op { public long apply(long a, long b) { return a + b; } }

    // 4. Megamorphic interface (3 impls in rotation)
    static final class SubOp implements Op { public long apply(long a, long b) { return a - b; } }
    static final class MulOp implements Op { public long apply(long a, long b) { return a * b; } }

    private FinalAdder finalAdder = new FinalAdder();
    private Op monomorphic = new AddOp();
    private Op[] mega = { new AddOp(), new SubOp(), new MulOp() };
    private int megaIdx;

    @Benchmark public long s_static()       { return staticAdd(3, 4); }
    @Benchmark public long s_finalVirtual() { return finalAdder.apply(3, 4); }
    @Benchmark public long s_monoIface()    { return monomorphic.apply(3, 4); }

    @Benchmark public long s_megaIface() {
        Op o = mega[(megaIdx++) % 3];
        return o.apply(3, 4);
    }
}
```

Typical results on a modern x64 JDK 21:

| Benchmark        | Time/op  | Notes                                       |
| ---------------- | -------- | ------------------------------------------- |
| `s_static`       | ~0.4 ns  | Inlined `invokestatic`; just an add         |
| `s_finalVirtual` | ~0.4 ns  | CHA + `final` → fully inlined               |
| `s_monoIface`    | ~0.4 ns  | Monomorphic IC + CHA → inlined              |
| `s_megaIface`    | ~6–10 ns | Megamorphic itable walk, plus the rotation  |

The headline you'll defend in design review:

> Monomorphic dispatch is essentially free. Megamorphic interface dispatch costs ~10ns per call. For a million-call-per-second hot loop, that's 10ms of overhead — measurable but not catastrophic. For a billion-call-per-second loop, that's 10s — clearly a tuning target.

Run `-prof gc` in JMH too — the `mega` rotation in the example allocates nothing, but real-world megamorphic call sites often correlate with allocation in the called method (escape analysis fails when the JIT can't inline).

---

## 7. Sealed types as a JIT hint

Sealed types are widely sold as a *modelling* feature (closed sum types, exhaustive switch). They are also a JIT hint with measurable impact.

The case for `sealed` in performance-sensitive code:

1. **Closed CHA.** The set of implementers is fixed at compile time. CHA doesn't need a deopt guard; the assumption is permanent.
2. **Pattern switch lowers cleanly.** Pattern matching on sealed types via `switch` compiles via `invokedynamic` to a type-switch bootstrap. The JIT specializes the bootstrap into a chain of `instanceof` checks plus inlined branches.
3. **Survives class loads.** A future class load cannot invalidate a sealed CHA. No deopt cascade.

```java
public sealed interface Decision permits Allow, Deny, Challenge {}
public record Allow()              implements Decision {}
public record Deny(String reason)  implements Decision {}
public record Challenge(String t)  implements Decision {}

public Response route(Request r, Decider d) {
    return switch (d.decide(r)) {
        case Allow a     -> proceed(r);
        case Deny x      -> reject(x.reason());
        case Challenge c -> challenge(c.t());
    };
}
```

The `switch` is a `tableswitch` over types, each branch's body inlined. There is no vtable lookup; no itable lookup; no megamorphic IC. Compared to the equivalent open hierarchy with virtual `decide.act()`, this typically runs 2–3× faster in a tight loop.

The cost you pay for `sealed`: adding a fourth `Decision` is a real edit — update `permits`, add the record, add a `case` to every exhaustive `switch`. For a closed set of variants (auth decisions, HTTP states, payment methods you control), this is correct. For an open plugin system, `sealed` is wrong; use open polymorphism and accept the dispatch cost.

---

## 8. When to break SOLID for dispatch

Sometimes the profiler points at a virtual call inside a hot loop. The options, in increasing severity:

**Severity 1 — `final` everything possible.** No source rewrite. CHA gets stronger hints. Often enough.

**Severity 2 — seal the interface.** Closes the type set. Pattern switch becomes fast. Requires touching the type declarations only.

**Severity 3 — split the call site.** If a shared utility is profile-polluted, duplicate it into each caller. DRY suffers; dispatch improves.

**Severity 4 — break DIP locally.** Replace an injected interface with a concrete `final` class field, on a hot path. Documented as a perf decision.

```java
public final class FastBatch {
    private final JsonFormatter formatter;       // concrete on purpose
    public FastBatch(JsonFormatter f) { this.formatter = f; }
    public void run(List<Event> events) {
        for (var e : events) write(formatter.format(e));   // direct, fully inlined
    }
}
// Comment: 2024-Q3 — JFR showed 8% CPU in formatter.format itable stub.
// Specialized to concrete JsonFormatter; throughput up 18%. Re-evaluate
// if we ever need XmlFormatter at this layer.
```

This is *local* SOLID denormalization, justified by measurement, documented for the next maintainer. The high-level layer of the application still uses `Formatter`; only the hot leaf is specialized.

---

## 9. Reading `-XX:+PrintInlining` output

The full incantation:

```
$ java -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining App
```

Sample output for a simple dispatch chain:

```
@ 14   Pipeline::run (54 bytes)
  @ 7    Logger::info (12 bytes)   inline (hot)
  @ 23   JsonFormatter::format (28 bytes)   inline (hot)
    @ 4    StringBuilder::append (8 bytes)   inline (hot)
    @ 12   StringBuilder::append (8 bytes)   inline (hot)
  @ 41   PrintStream::println (15 bytes)   virtual call
```

What to look at:

- **`inline (hot)`** — the JIT inlined the callee into the caller. Best case.
- **`virtual call`** — the JIT did *not* inline; it left a real virtual call. Why? Several common reasons:
  - **`too big`** — the callee exceeded the inlining size threshold (`-XX:MaxInlineSize`, default 35 bytes).
  - **`virtual call (multiple receivers)`** — the call site is megamorphic; no single inline target.
  - **`not inlineable (intrinsic)`** — the method is an intrinsic, handled specially by C2.
  - **`callee uses too much stack`** — exceeds `-XX:MaxInlineLevel` recursion depth.
- **`(hot)`** vs no annotation — `(hot)` means the JIT considered the call hot enough to prioritize for inlining.

The pattern to look for in a perf investigation: a virtual call you expected to inline shows `virtual call (multiple receivers)`. That's a megamorphic call site. Cross-reference with JFR's receiver-type profile, then refactor per section 6 / 7 / 8 above.

---

## 10. Quick rules — dispatch optimization checklist

- [ ] Default to `final` on concrete classes. CHA gets a permanent invariant.
- [ ] Seal interfaces with a small, known set of implementers. Pattern switch becomes a closed-world dispatch.
- [ ] Make hot record types implement sealed interfaces. The combination unlocks the strongest devirtualization.
- [ ] Eagerly load plugin classes at startup; don't let lazy loading deopt the JIT mid-flight.
- [ ] Profile receiver-type distributions with JFR or async-profiler. Three or more types at one call site = megamorphic.
- [ ] Don't share a polymorphic utility across many callers — profile pollution. Inline at the caller, or specialize.
- [ ] Read `-XX:+PrintInlining` output. `virtual call (multiple receivers)` is the smell.
- [ ] Read the deopt log. Cascades in steady state are tuning bugs; isolated warmup deopts are normal.
- [ ] When breaking SOLID for dispatch, do it *locally*, document the profile, leave the surrounding architecture clean.
- [ ] Bench with JMH (5+ warmup, 10+ measurement, 2 forks). Run `-prof gc` and `-prof perfasm` to see full cost.

---

## 11. What's next

| Topic                                                    | File              |
| -------------------------------------------------------- | ----------------- |
| Junior-level introduction to the 5 opcodes               | `junior.md`        |
| Reading bytecode, CHA, sealed types, lambdas             | `middle.md`        |
| Inline caches, deopt, megamorphic, indy bootstrap        | `senior.md`        |
| Code review, ArchUnit, JFR for dispatch                  | `professional.md`  |
| JVMS §6.5, §5.4.5, JLS §8.4.8, JEPs 181/280/309          | `specification.md` |
| 10 buggy dispatch snippets                               | `find-bug.md`      |
| Hands-on exercises with `javap`, JMH, PrintInlining      | `tasks.md`         |
| 20 interview questions                                   | `interview.md`     |

See also [../02-vtable-and-itable/](../02-vtable-and-itable/) for the table mechanics behind `invokevirtual` and `invokeinterface`, and [../05-escape-analysis-and-scalar-replacement/](../05-escape-analysis-and-scalar-replacement/) for how monomorphic dispatch unlocks the deeper EA optimizations.

---

**Memorize this:** dispatch cost is a function of *receiver-type distribution*, not opcode choice. Monomorphic dispatch is essentially free; megamorphic dispatch costs measurable cycles. The strongest JIT hints are `final` (no subclasses) and `sealed` (closed set). Profile the live distribution with JFR or async-profiler; read inlining decisions with `-XX:+PrintInlining`; benchmark refactors with JMH. Most code never reaches the threshold where dispatch matters. For the 1% that does, the techniques above buy back most of the cost.
