# Pass by Value / Pass by Reference — Senior

> **What?** The runtime perspective: how method calls actually pass arguments at the bytecode level, register-allocator behavior in C2, the JIT's use of escape analysis to avoid allocation, and the design implications of immutable types vs mutable inputs.
> **How?** By understanding the operand stack mechanics, JIT inlining of method calls, and how to design APIs that the optimizer can flatten into register-only code.

---

## 1. Bytecode mechanics

When you call `m(x, y)`:
1. Push `x` onto the operand stack.
2. Push `y` onto the operand stack.
3. Issue `invoke*` opcode.
4. The JVM pops args into the callee's local variable slots.

Primitives are pushed as their native values. References are pushed as pointers.

The JIT often elides the push/pop, passing args directly via registers (per the platform's calling convention).

---

## 2. Register allocation by C2

For hot methods, C2 assigns parameters to registers based on the platform ABI. Common conventions:
- x86-64: RDI, RSI, RDX, RCX, R8, R9 for the first 6 integer/pointer args; XMM0-7 for floats.
- AArch64: X0-X7 for integer/pointer; V0-V7 for floats.

After JIT, parameter passing is essentially free — same speed as direct register use.

---

## 3. Escape analysis and parameter passing

```java
double distance(double x1, double y1, double x2, double y2) {
    Point a = new Point(x1, y1);
    Point b = new Point(x2, y2);
    return Math.hypot(a.x() - b.x(), a.y() - b.y());
}
```

If `Point` is final and `a, b` don't escape, C2 may scalar-replace them: the fields go directly into registers, no allocation. Effectively the function becomes:

```java
double distance(double x1, double y1, double x2, double y2) {
    return Math.hypot(x1 - x2, y1 - y2);
}
```

This is why immutable records often compile to extremely tight code.

---

## 4. The cost of mutable inputs

When a method receives a mutable list or map, the JIT can't always prove it doesn't escape. This forces:
- Allocation on the heap (no scalar replacement).
- Pessimistic optimization (the method might modify it).

For maximum JIT-friendliness, pass immutable types or records.

---

## 5. Boxing in argument passing

```java
void m(Integer x) { }
m(5);    // box
```

For values in cache range (-128 to 127), `Integer.valueOf(5)` returns a cached instance — no heap allocation. For larger values, allocation is required.

In hot loops with primitive arguments to `Integer`-typed parameters, boxing dominates cost. Use primitive specializations (`IntFunction`, `IntConsumer`).

---

## 6. Varargs allocation

```java
void m(int... values) { ... }

m(1, 2, 3);   // allocates new int[]{1, 2, 3}
```

Each call allocates a new array. For hot paths, varargs allocation can dominate. Use overloads for common counts:

```java
void m(int a) { ... }
void m(int a, int b) { ... }
void m(int a, int b, int c) { ... }
void m(int... values) { ... }
```

The compiler picks the fixed-arity version when possible.

---

## 7. Immutable types are JIT-friendly

```java
public record Money(long cents, String currency) { }
```

Why JIT loves immutable records:
- No setters to track for state changes.
- Field reads are stable.
- Escape analysis often eliminates allocation.
- `final` class enables direct dispatch.

For function arguments, prefer immutable types whenever practical.

---

## 8. Effectively-final and lambda capture

Java requires variables captured by lambdas to be effectively final. The captured value is a snapshot:

```java
int x = 5;
Runnable r = () -> System.out.println(x);
// x cannot be reassigned after capture
```

The lambda's closure stores the captured values as fields. Each lambda invocation reads those fields.

For mutable capture, use atomic types:
```java
AtomicInteger counter = new AtomicInteger();
Runnable r = () -> counter.incrementAndGet();
```

---

## 9. Return values and "moves"

When a method returns a value:
1. Push the return value onto the operand stack.
2. Issue `*return` opcode.
3. JVM pops the value into the caller's stack.

For primitives, this is a register move. For references, a pointer move.

For very large returns (records with many fields), consider whether the JIT can optimize. Usually it does.

---

## 10. Multiple returns via records

```java
record Result(boolean ok, String value, String error) { }

Result process(String input) {
    if (input == null) return new Result(false, null, "null input");
    return new Result(true, input.trim(), null);
}
```

Records are JIT-friendly returns. Often eliminated via EA if the caller pattern-matches and consumes immediately.

---

## 11. Wrappers vs records for "output"

```java
// Wrapper (mutable, traditional)
class IntBox { int value; }
void compute(IntBox out) { out.value = 5; }

// Record (immutable, modern)
record IntResult(int value) { }
IntResult compute() { return new IntResult(5); }
```

Record version is cleaner, immutable, JIT-friendly. Use it.

---

## 12. Practical performance tips

- Prefer primitives over boxed types in hot args.
- Prefer immutable inputs (records, immutable lists).
- Avoid allocating wrapper types in hot loops.
- Use primitive specializations of functional interfaces (`IntFunction`, etc.).
- Profile boxing with allocation flame graph.

---

## 13. Design implications

For APIs:
- Default to immutable parameters.
- Return values, don't mutate inputs.
- Document any mutation explicitly.
- Use records for multi-value returns.
- Avoid out-parameter wrapper types; use records.

For hot paths:
- Avoid varargs (allocates array).
- Avoid boxing.
- Use final types so JIT can inline.

---

## 14. What's next

| Topic                         | File              |
|-------------------------------|-------------------|
| Bytecode internals             | `professional.md`  |
| JLS rules                      | `specification.md` |
| Interview prep                 | `interview.md`     |
| Common bugs                    | `find-bug.md`      |

---

**Memorize this**: Java is pass-by-value, but the JIT often passes args via registers (free after warmup). Immutable types are JIT-friendly; the optimizer can scalarize them. Mutable inputs prevent some optimizations. Use records for "outputs" and prefer primitive specializations in hot paths.
