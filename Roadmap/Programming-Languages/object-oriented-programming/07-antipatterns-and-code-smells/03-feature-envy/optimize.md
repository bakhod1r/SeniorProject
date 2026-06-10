# Feature Envy — Optimize

Feature Envy is usually framed as a design problem. It is also a **performance** problem. The JIT, the CPU cache, and the garbage collector all reward methods that work close to their own data. This file gives ten concrete angles where removing envy improves runtime, plus quick rules for when those angles actually matter.

---

## 1. Getter call chains pay invocation overhead

Each `customer.getAddress().getCountry().getCode()` is three virtual method calls. Even on hot paths the JIT inlines most of these, but cold or megamorphic call sites can pay 5–15 ns per chain on commodity hardware. When the envious method runs millions of times per second (request hot path, batch job), the overhead is measurable.

**Move Method removes the chain entirely.** `customer.countryCode()` is a single dispatch.

---

## 2. Megamorphic dispatch defeats the inliner

HotSpot inlines monomorphic and bimorphic call sites aggressively. As soon as a call site sees three or more receiver types it becomes **megamorphic** and inlining stops. Envious methods that call `obj.getX()` across many concrete subtypes of a base interface hit this wall faster, because the envy concentrates dispatch in one place.

Moving the method onto each subtype makes dispatch monomorphic at the call site — the JIT inlines aggressively again. Pattern: a `Renderer.render(Shape s)` that envies `Shape` subclasses through `instanceof` chains becomes `Shape.render()` polymorphic, faster on the JIT.

---

## 3. Field access beats getter access when fields move

Once you move the method to the owning class, the foreign getters become field reads. Field reads are essentially free (single load from L1 if cached). Getters can still be inlined to that, but only after profiling warmup. Direct field access on day one means consistent latency from the first request, not after JIT tier 4.

This matters for **CDS/AOT compilation** (JEP 295, JEP 483) where AOT-compiled code is shipped without runtime profile data.

---

## 4. Cache locality improves when data and method co-locate

Modern CPUs love spatial locality. When a method's body repeatedly touches fields of one object, keeping that object in registers and L1 is the JIT's optimisation target. Envious methods touching three different objects fragment the working set across cache lines — each `customer.getX()` triggers a load from a different cache line than `product.getY()`.

Move Method tends to concentrate field access on one receiver, improving the chances of register allocation and L1 hits.

---

## 5. Escape analysis eliminates temporaries

HotSpot's Escape Analysis (EA) can scalarise objects that do not escape their creating method. Envious methods often build short-lived wrapper objects (`new PriceInfo(customer, product)`) which then escape because the wrapper is returned or passed onward.

When you move the method to its proper home, intermediate wrappers often become unnecessary or stay local — EA can scalarise them, eliminating the allocation. The G1 / ZGC nursery does less work.

---

## 6. Reduced parameter count = better calling convention

JVM calling convention puts the first few arguments in registers (platform-dependent: 6 on x86-64 System V, 4 on Windows x64). Envious methods often have signatures like `compute(Customer c, Order o, Product p, Region r)` — four pointers, all four still in registers, but each `c.getX()` reload spills more state.

A method moved to `Order.compute(Customer c)` has fewer args, fewer reloads, and more registers free for arithmetic.

---

## 7. Polymorphism beats type-switching

A classic envy shape:

```java
public BigDecimal price(Item item) {
    if (item.getType() == ItemType.BOOK) return item.getBasePrice().multiply(BD_098);
    if (item.getType() == ItemType.FOOD) return item.getBasePrice().multiply(BD_095);
    if (item.getType() == ItemType.LUXURY) return item.getBasePrice().multiply(BD_120);
    return item.getBasePrice();
}
```

The envy is `getType()` + `getBasePrice()` plus the type discriminator. Replace with polymorphism — `Book extends Item` overrides `price()`. The branch becomes a single virtual call, which the JIT can profile and inline as monomorphic per call site.

On modern Java (21+), pattern matching for `switch` (JEP 441) keeps the syntactic compactness while still being amenable to JIT optimisation through sealed-type dispatch tables.

---

## 8. Eliminating envy reduces autoboxing on hot paths

Envious code that pulls primitive values through getters often pays boxing costs. `customer.getDiscountRate()` returning `Double` vs `double`, or a chain `map.get(customer.getId()).intValue()`, introduces boxes on every call.

When you move the calculation to the owning class, you can choose the primitive signature internally. The JIT can keep values in CPU registers without going through `Integer` / `Double` heap objects.

---

## 9. Method inlining budgets favour small methods

HotSpot has a default `MaxInlineSize = 35` bytecodes and `FreqInlineSize = 325` for hot methods. Envious methods balloon because they have to do their work *plus* navigate to foreign state. Moving the method to the owner shrinks both the envious caller (now a one-liner) and the moved-to method (no navigation needed). Both become more inline-friendly.

Use `-XX:+PrintInlining` to verify before/after.

---

## 10. Profiling proves it — JFR and async-profiler

Do not optimise envy for performance speculatively. Two tools to confirm:

- **Java Flight Recorder** (`-XX:StartFlightRecording=...`) — look at `jdk.MethodSample` events for the envious method. If it has a hot stack frame, refactoring may help.
- **async-profiler** — generates flame graphs that show getter chains as wide stack frames. A wide frame on `Customer.getAddress` in the flame graph is a candidate.

Refactor envy, rerun the same workload, compare flame graph widths and JFR sample counts. If nothing changed, the envy was not the bottleneck — the design fix is still worth doing but the performance argument was wrong.

---

## Quick rules

- Getter chains cost 5–15 ns each cold; negligible after JIT inlining.
- Megamorphic call sites stop inlining at 3+ receiver types — concentrating envy makes this worse.
- Moving methods improves register allocation and L1 cache locality.
- Escape Analysis works better when wrappers stay local.
- Polymorphism beats type-switch for both clarity and JIT optimisation.
- Profile with JFR and async-profiler *before* claiming a performance win.
- Performance is the secondary reason to fix envy — design clarity is primary.

## Memorize this

Removing Feature Envy improves performance through three mechanisms: shorter call chains reduce dispatch overhead, monomorphic call sites enable JIT inlining, and concentrated field access improves cache locality and register allocation. Escape Analysis benefits when intermediate wrapper objects stop escaping. Polymorphism beats `instanceof`/type-switch chains for both readability and JIT efficiency. Always verify with JFR or async-profiler before claiming a win — the design reason to fix envy is stronger than the performance reason in 90% of cases.
