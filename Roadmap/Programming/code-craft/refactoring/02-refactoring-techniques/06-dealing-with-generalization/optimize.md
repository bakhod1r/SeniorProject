# Dealing with Generalization — Optimize

> 12 cases where the refactor is correct but introduces a perf cost.

---

## Optimize 1 — Pull Up Method to abstract creates virtual call (Java)

```java
abstract class Employee { abstract double pay(); }
class Engineer extends Employee { double pay() { return 5000; } }
class Manager extends Employee { double pay() { return 7000; } }

double total = list.stream().mapToDouble(Employee::pay).sum();   // virtual call per element
```

<details><summary>Cost & Fix</summary>

For monomorphic call site (only Engineers), JIT inlines. Bimorphic: still fast. Megamorphic (4+ types): falls back to vtable.

**Fix:** Mark `Employee` `sealed` (Java 17+):
```java
sealed abstract class Employee permits Engineer, Manager, Salesman {}
```
JIT knows the closed set; can devirtualize completely.

For pre-Java 17: mark methods `final` if they shouldn't be overridden in deeper subclasses.
</details>

---

## Optimize 2 — Form Template Method makes hot loop slow (Java)

```java
abstract class Statement {
    public final String emit(Customer c) {
        return header() + lines(c) + footer();
    }
    protected abstract String header();
    protected abstract String lines(Customer c);
    protected abstract String footer();
}
```

In a batch generating 10K statements: 30K virtual calls.

<details><summary>Cost & Fix</summary>

If only one Statement type is used in this batch, monomorphic — JIT inlines. ~zero cost.

If multiple types: bimorphic still fine. Megamorphic costs vtable lookups.

**Fix:**
1. Sealed types — closed set, JIT specializes.
2. Specialized batch processors (each Statement type gets its own batch).
3. Profile with `-XX:+PrintInlining` to confirm inlining happens.
</details>

---

## Optimize 3 — Replace Inheritance with Delegation adds dereference (Java)

```java
class Stack<E> {
    private final Vector<E> data;
    public void push(E e) { data.add(e); }   // 1 extra deref
}
```

In a hot loop pushing 1M items.

<details><summary>Cost & Fix</summary>

Each `push` dereferences `data` then calls `add`. JIT inlines, eliminating the deref.

In steady state: zero cost.

If `data` field is volatile or otherwise can't be cached by JIT: small overhead.

**Fix:** No fix needed in typical case. For very hot paths: profile.
</details>

---

## Optimize 4 — Pull Up Field carries waste in subclasses (Java)

```java
abstract class Employee {
    protected double quota;   // only Salesman uses
    protected int level;      // only Engineer uses
    protected int grade;      // only Manager uses
}
```

Every Employee instance now has 3 unused fields most of the time.

<details><summary>Cost & Fix</summary>

For 10M employees, each carries 24 unused bytes. 240 MB wasted.

**Fix:** Push these fields down to specific subclasses where they belong. Pull Up was wrong.

```java
abstract class Employee {}
class Salesman extends Employee { private double quota; }
class Engineer extends Employee { private int level; }
class Manager extends Employee { private int grade; }
```
</details>

---

## Optimize 5 — Extract Interface introduces interface dispatch (Go)

```go
type Greeter interface { Greet() string }
func process(g Greeter) { fmt.Println(g.Greet()) }   // virtual call

for _, e := range employees {
    process(e)   // interface dispatch
}
```

<details><summary>Cost & Fix</summary>

Each `g.Greet()` is an itable lookup + indirect call. ~3-5 cycles vs. direct call (~1 cycle).

**Fix:**
1. **Generics (Go 1.18+):**
   ```go
   func process[T Greeter](g T) { fmt.Println(g.Greet()) }
   ```
   Compiler instantiates per type — direct call.
2. **PGO (Go 1.21+):** devirtualize hot interface calls.
3. **Concrete types in hot loops:** if you only have one type, don't use the interface.
</details>

---

## Optimize 6 — Sealed types still megamorphic (Java)

```java
sealed interface Op permits Add, Sub, Mul, Div, Mod, And, Or, Xor, Shl, Shr {}
```

10 cases. Pattern matching:

```java
double evaluate(Op op, ...) {
    return switch (op) {
        case Add a -> ...;
        case Sub s -> ...;
        // 8 more
    };
}
```

<details><summary>Cost & Fix</summary>

For 10 cases with random distribution, the switch is a chain of `instanceof` (or hashed dispatch). Branch prediction works for skewed distributions; uniform distribution costs.

**Fix:**
1. **Sort cases by frequency.** Most common first.
2. **Use a `Map<Class<?>, Function<Op, Double>>` for many cases:** O(1) lookup.
3. **Profile.** For 10 cases with skewed distribution (90% Add), inlined chain is fast.
</details>

---

## Optimize 7 — Push Down Method causes downcast at callers (Java)

```java
abstract class Employee {}
class Engineer extends Employee {
    public double rate() { return 5000; }   // pushed down
}

// Caller:
for (Employee e : list) {
    if (e instanceof Engineer eng) total += eng.rate();
}
```

<details><summary>Cost & Fix</summary>

Each `instanceof` check + conditional add. ~1 ns per iteration.

For most workloads: invisible.

**Fix if hot:**
1. Iterate Engineer-typed lists separately.
2. Use polymorphism (Pull the method back up if all subclasses need it).

Lesson: Push Down moves cost from one place to many. If callers proliferate `instanceof`, reconsider.
</details>

---

## Optimize 8 — Extract Superclass adds vtable level (Java)

```java
class Department extends Party { ... }
class Employee extends Party { ... }
```

Methods on Department previously dispatched via Department's vtable. Now via Party → Department, with one extra layer.

<details><summary>Cost & Fix</summary>

Vtable lookup is one indirection regardless of depth. **No additional cost.**

The cost might come from:
- Object header is the same size.
- Methods inherited from Party are still dispatched virtually.
- Field offsets may shift slightly.

In practice: zero observable difference.
</details>

---

## Optimize 9 — Replace Delegation with Inheritance drops final (Java)

**Original:**
```java
class Person {
    private final Office office;
    public String getAddress() { return office.getAddress(); }
}
```

`Person.office` is `final` — initialized once, never null.

**"Refactored":**
```java
class Person extends Office { ... }
```

Now Person's fields are inherited; if Office's fields aren't `final`, they're mutable.

<details><summary>Cost & Fix</summary>

The replacement might introduce mutability where there was none. Caches and other immutability-dependent optimizations lose validity.

**Fix:** Mark Office's fields `final`. Or, more often, **don't replace delegation with inheritance** — keep the delegate.
</details>

---

## Optimize 10 — Form Template Method allocates StringBuilder per call (Java)

```java
public final String emit(Customer c) {
    StringBuilder b = new StringBuilder();
    b.append(header()); b.append(lines(c)); b.append(footer());
    return b.toString();
}
```

For 1M emits: 1M StringBuilders, ~MB of garbage.

<details><summary>Cost & Fix</summary>

StringBuilder allocations are typical. For batch processing, the allocation rate is real.

**Fix:**
1. Pass the StringBuilder in: `emit(Customer c, StringBuilder b)` — caller manages.
2. Pre-size: `new StringBuilder(estimateSize)`.
3. For huge batches: write directly to an output stream / writer.

JIT typically optimizes short-lived StringBuilder allocations via escape analysis. Profile first.
</details>

---

## Optimize 11 — Inheritance hierarchy for serialization (Java + Jackson)

```java
abstract class Animal {}
class Dog extends Animal {}
class Cat extends Animal {}
```

Without polymorphic type info:
```java
String json = mapper.writeValueAsString(dog);
Animal a = mapper.readValue(json, Animal.class);   // ❌ can't instantiate Animal
```

<details><summary>Cost & Fix</summary>

Deserialization fails. Or: with `@JsonTypeInfo`, every JSON adds a `"type": "Dog"` discriminator field. Each request adds a few bytes.

**Fix options:**
1. Type info via property: `@JsonTypeInfo(use=Id.NAME, property="type")`.
2. Use sealed types + Jackson's pattern-match support (newer versions).
3. Avoid polymorphic JSON entirely: use separate endpoints / DTOs per concrete type.

For high-throughput APIs, the per-message overhead matters.
</details>

---

## Optimize 12 — Mixin order changes performance (Python)

```python
class Cache:
    def get(self, k): ...
class Sync:
    def get(self, k): ...

class A(Cache, Sync): pass    # Cache.get takes precedence
class B(Sync, Cache): pass    # Sync.get takes precedence
```

If `Cache.get` is fast and `Sync.get` is slow:
- A is fast (Cache hit fast path).
- B is slow (Sync always taken first).

<details><summary>Cost & Fix</summary>

MRO determines dispatch order. Mixin order affects performance.

**Fix:**
1. Order mixins thoughtfully — fast paths first.
2. Document MRO assumptions.
3. Avoid deep mixin hierarchies for hot code; use composition.

This is a subtle Python footgun. Inspect with `MyClass.__mro__`.
</details>

---

## Patterns

| Refactor | Cost |
|---|---|
| Pull Up Method | Virtual call instead of direct |
| Form Template Method | Multiple virtual calls per skeleton run |
| Replace Inheritance with Delegation | One extra deref (eliminated by JIT) |
| Pull Up Field carrying unused fields | Memory waste |
| Extract Interface in Go | Interface dispatch cost |
| Sealed types pattern matching | Linear case dispatch |
| Push Down forces caller instanceof | Per-iteration check |
| Extract Superclass | Negligible |
| Replace Delegation with Inheritance | Mutability concerns |
| StringBuilder per skeleton call | Allocation rate |
| Polymorphic JSON | Discriminator bytes |
| Mixin order | Dispatch chain length |

---

## Next

- [tasks.md](tasks.md), [find-bug.md](find-bug.md), [interview.md](interview.md)
