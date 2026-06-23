# Simplifying Conditional Expressions — Professional Level

> Branch prediction, cache effects, JIT specialization, switch dispatch tables, and the runtime cost of refactoring conditionals.

---

## Table of Contents

1. [Branch prediction basics](#branch-prediction-basics)
2. [tableswitch vs. lookupswitch in JVM](#tableswitch-vs-lookupswitch-in-jvm)
3. [Polymorphic dispatch costs revisited](#polymorphic-dispatch-costs-revisited)
4. [Pattern matching at the bytecode level](#pattern-matching-at-the-bytecode-level)
5. [Null Object: cost vs. branch](#null-object-cost-vs-branch)
6. [Guard clauses and instruction cache](#guard-clauses-and-instruction-cache)
7. [Profile-guided optimization](#profile-guided-optimization)
8. [Go: switch, jump tables, and devirtualization](#go-switch-jump-tables-and-devirtualization)
9. [Python: bytecode dispatch overhead](#python-bytecode-dispatch-overhead)
10. [Review questions](#review-questions)

---

## Branch prediction basics

Modern CPUs predict the outcome of conditional branches before evaluating them. A correctly-predicted branch costs ~0–1 cycles; a mispredicted branch costs ~10–20 cycles (pipeline flush).

### What helps prediction

- **Patterns.** "Always taken" / "always not taken" / "alternating" — predicted with ~99% accuracy.
- **Predictable correlations.** "If X happened, Y often follows."

### What hurts

- **Random outcomes.** A branch on hash(value) % 2 is unpredictable.
- **Frequent transitions.** Many calls with different inputs.

### Implication for refactoring

- **Replace Nested with Guard Clauses** — the early-out pattern is highly predictable. Predictor learns "rare branch."
- **Decompose Conditional** — adds a method call (highly predictable: always taken).
- **Replace Conditional with Polymorphism** — moves the branch from a `switch` to a virtual call. Both are predictable when monomorphic; both stutter when megamorphic.

For most code: branch prediction is invisible. For data-heavy hot loops: refactor with care.

---

## tableswitch vs. lookupswitch in JVM

When you write a `switch (intValue)`, the JVM emits one of two opcodes:

- **`tableswitch`** — jump table indexed by integer. O(1) dispatch. Used when cases are dense (e.g., `case 1, 2, 3, 5, 7`).
- **`lookupswitch`** — sorted lookup. O(log N) dispatch. Used when cases are sparse (e.g., `case 1000, 5000, 100000`).

### When you change the cases

Adding or removing a case can flip between the two. `javap -c` reveals which.

### Implication

- A 5-case enum switch → `tableswitch` → jump → ~1 cycle.
- A 100-case enum switch over sparse codes → `lookupswitch` → ~7 cycles.
- A 1000-case switch (rare!) → may compile poorly. Consider a `Map<Integer, Handler>` for genuinely huge dispatch.

### Modern Java switch expressions (14+)

```java
return switch (status) {
    case ACTIVE -> ...;
    case INACTIVE -> ...;
    default -> throw ...;
};
```

Compiled the same as the statement form — no perf difference.

---

## Polymorphic dispatch costs revisited

When you Replace Conditional with Polymorphism, the dispatch moves from `tableswitch` to virtual call.

### Cost comparison

| Variant | Cost (post-JIT) |
|---|---|
| Direct call (`final` method, monomorphic call site) | ~1 cycle |
| Monomorphic virtual | ~1 cycle (JIT inlines) |
| Bimorphic | ~2 cycles |
| Polymorphic (3 types) | ~3-5 cycles |
| Megamorphic (4+ types) | ~5-15 cycles |
| `tableswitch` | ~1-2 cycles |

For most call sites, dispatch cost is invisible. For a tight loop (millions of iterations), it shows.

### Inline caches

HotSpot remembers recent receiver types at each call site (inline cache, IC). For monomorphic sites, the IC entry is a single check + jump. For bimorphic, two checks. Megamorphic falls back to the vtable.

### Implication

- If a call site is genuinely monomorphic in production, polymorphism is essentially free.
- Adding a fifth type to a polymorphic site can drop performance by 5–10× in inner loops (megamorphic transition).
- Pattern matching with sealed types compiles to `instanceof` chains — similar costs.

---

## Pattern matching at the bytecode level

Java 21+ pattern matching:

```java
return switch (s) {
    case Circle c -> Math.PI * c.r() * c.r();
    case Square sq -> sq.side() * sq.side();
};
```

Compiles to:
1. `invokedynamic` to a bootstrap method that builds a switch on `Class<?>` hash.
2. The dispatch is sub-linear in the number of cases (constant for small, log for large).

For closed sealed hierarchies, the JIT may specialize even further — sometimes generating a single `instanceof` chain that branch-predicts well.

### Performance

In Brian Goetz's benchmarks (JDK design), pattern matching is comparable to or faster than the equivalent virtual call dispatch in most cases. The compiler has more information (closed set) and can optimize harder.

---

## Null Object: cost vs. branch

```java
// With null:
if (customer != null) { return customer.name(); }
return "guest";
```

```java
// With Null Object:
return customer.name();   // NullCustomer returns "guest"
```

### Branch cost

- Nullcheck: 1 predictable branch (almost always not-null in production).
- Null Object: 1 virtual call (monomorphic OR bimorphic).

For monomorphic call sites: roughly equivalent.

### Memory cost

- Null: zero per "missing" case (just the null pointer).
- Null Object: an instance per "missing" — though typically a singleton.

For 10M missing customers represented as Null Objects, you have 1 NullCustomer instance, not 10M. **No memory cost.**

### When Null Object hurts perf

- The Null Object is genuinely a different class with different inlining behavior. Bimorphic site.
- The Null Object's no-op methods aren't trivial (do they log? trace?).

For most cases: indistinguishable from null check post-JIT.

---

## Guard clauses and instruction cache

A method with deeply nested conditionals has more bytecode than the same method with guard clauses and helper extractions. Sometimes meaningfully more.

### Cache implications

- Larger method body → less likely to fit in I-cache.
- More likely to hit JIT inlining cliffs (`MaxInlineSize`, `FreqInlineSize`).
- Profile-cold sections still occupy bytecode space.

### Counter-effect

Guard clauses + Decompose Conditional spread the code across more methods. Each adds overhead in interpreted mode (negligible in JIT). Total bytecode grows slightly.

### Net

For typical web service code: invisible. For numerical inner loops: keep the conditional inline; don't extract.

---

## Profile-guided optimization

JIT compilers profile code at runtime to optimize hot paths:

- HotSpot tracks branch frequencies and inline-caches receiver types.
- Go (1.21+) uses PGO from collected profiles to inline aggressively.
- LLVM-based languages have explicit `-fprofile-generate / -fprofile-use`.

### When refactoring conditionals helps PGO

- Removing a megamorphic site (extracting via interface).
- Reducing branch count on hot paths.
- Making frequently-taken branches the "true" arm of `if`.

### When it hurts

- Adding indirection that JIT can't see through (e.g., reflection-driven dispatch).
- Over-decomposing into small methods that exceed inline budget.

---

## Go: switch, jump tables, and devirtualization

Go's `switch` doesn't generally compile to a jump table — even for dense int cases. Each case is an `if-else` chain, branch-predicted normally.

### Why

Go's compiler is simpler than HotSpot. Jump tables are added in newer versions for some cases.

### Interface dispatch

A method call on an interface in Go:
1. Loads the itab pointer.
2. Loads the method pointer from the itab.
3. Calls indirectly.

PGO can devirtualize hot interface calls in Go 1.21+.

### Implication

Replace Conditional with Polymorphism in Go is not free for hot paths — interface dispatch is genuinely slower than direct call. Use sparingly in inner loops; prefer simple structs + explicit switch + generics.

---

## Python: bytecode dispatch overhead

Every Python conditional is bytecode dispatched (`POP_JUMP_IF_FALSE`, etc.). Each conditional costs ~50-100ns.

### Implications

- Refactoring conditionals doesn't change bytecode count meaningfully.
- Pattern matching (`match`) in Python 3.10+ is implemented as bytecode-level dispatch on cases — not faster than a chain of `if-elif-else`.
- For tight inner loops, the only meaningful optimization is to vectorize (NumPy / pandas / polars).

---

## Review questions

1. What's the cost of a mispredicted branch?
2. When does the JVM emit `tableswitch` vs. `lookupswitch`?
3. How do inline caches reduce polymorphic dispatch cost?
4. What's the cost difference between monomorphic and megamorphic call sites?
5. How does pattern matching compile in Java 21+?
6. Does Null Object cost more than null checks at runtime?
7. How does guard clause refactoring affect inlining?
8. What does PGO buy for conditional-heavy code?
9. How does Go handle switch dispatch differently from Java?
10. What's the cost of conditionals in CPython vs. PyPy?
