# Comparable vs Comparator Contracts — Specification Reading Guide

> The `Comparable` and `Comparator` contracts live in the *Java API specification* (javadoc), not in the Java Language Specification. The compiler enforces *signatures*; the *contract* — antisymmetry, transitivity, consistency with equals, the recommended-but-not-required clauses — is checked only at runtime by sorted collections and by Timsort. This file maps each clause of each contract to its authoritative source, links the relevant JEPs, and shows where the JVM machinery (`invokeinterface`, `Comparable` bridges) sits underneath.

---

## 1. Where to find the canonical text

| Concept                                       | Authoritative source                              |
|-----------------------------------------------|---------------------------------------------------|
| `Comparable<T>` interface contract            | `java.lang.Comparable` Javadoc                    |
| `Comparator<T>` interface contract            | `java.util.Comparator` Javadoc                    |
| `compareTo` four clauses                      | `Comparable.compareTo(T)` Javadoc                 |
| `compare` symmetry/transitivity rules         | `Comparator.compare(T,T)` Javadoc                 |
| Sorted collections — `TreeMap` / `TreeSet`    | `java.util.NavigableMap` / `NavigableSet` Javadoc |
| `Arrays.sort` stability guarantee             | `java.util.Arrays.sort(Object[])` Javadoc         |
| `Collections.sort` deprecation status         | `java.util.Collections.sort(List)` Javadoc        |
| `List.sort(Comparator)`                       | `java.util.List.sort` Javadoc — JEP 269           |
| Default and static methods on interfaces      | **JLS §9.4.3**, §9.4.4 — JEP 126                  |
| Functional interfaces                         | **JLS §9.8** — JEP 335                            |
| `invokeinterface` dispatch                    | **JVMS §6.5.invokeinterface**                     |
| Records (often used with `Comparable`)        | JLS §8.10 — JEP 395                               |
| Pattern matching for `switch` (alternative dispatch) | JLS §14.11, §15.28 — JEP 441               |

The JLS gives you the *signature* enforcement and the *generics* of the comparator API. The Javadoc gives you the *contract*. Both matter.

---

## 2. The `Comparable.compareTo` contract — verbatim summary

The Javadoc for `java.lang.Comparable.compareTo(T)` defines the contract in four clauses. Paraphrased:

1. **Sign convention.** Returns a negative integer, zero, or a positive integer as this object is less than, equal to, or greater than the specified object.
2. **Antisymmetry.** `sgn(x.compareTo(y)) == -sgn(y.compareTo(x))` for all `x` and `y`. If `x.compareTo(y)` throws, `y.compareTo(x)` must throw too.
3. **Transitivity.** `(x.compareTo(y) > 0 && y.compareTo(z) > 0)` implies `x.compareTo(z) > 0`.
4. **Substitution.** `x.compareTo(y) == 0` implies `sgn(x.compareTo(z)) == sgn(y.compareTo(z))` for all `z`.

A fifth, *recommended but not required*, clause:

5. **Consistency with `equals`.** `(x.compareTo(y) == 0) == x.equals(y)`. Implementations that violate this *must* document the divergence: "Note: this class has a natural ordering that is inconsistent with equals."

The contract is *invariant under runtime use*. `Arrays.sort`, `Collections.sort`, and Timsort actively check the first three; sorted collections (`TreeSet`, `TreeMap`) depend on all five being correct, with clause 5 governing whether *distinct equal-by-equals* objects survive the collection.

The Javadoc is explicit that `compareTo` is "*the natural ordering* of objects of class `T`" — singular, definite article. A class has at most one natural order. If you have two candidate orderings and no obvious winner, don't implement `Comparable`.

---

## 3. The `Comparator.compare` contract

`java.util.Comparator.compare(T, T)` has a slightly shorter contract because it is not tied to a single class. The clauses:

1. **Sign convention** — same as `compareTo`.
2. **Antisymmetry** — `sgn(compare(x,y)) == -sgn(compare(y,x))`.
3. **Transitivity** — same as `compareTo`.
4. **Substitution** — `compare(x,y) == 0` implies `sgn(compare(x,z)) == sgn(compare(y,z))` for all `z`.

And a *strongly recommended* (not required) clause:

5. **Consistency with `equals`** — `(compare(x,y) == 0) == x.equals(y)`. Same warning as `Comparable`: a comparator inconsistent with `equals` will deduplicate distinct objects when used with `TreeSet` / `TreeMap`.

Two additional Javadoc points specific to `Comparator`:

- A `Comparator` may impose orderings *inconsistent with* `equals` deliberately; this is a normal use case (sort `Customer` by surname only; surnames are not unique).
- `Comparator` should be a *value*: `equals` and `hashCode` of two comparator instances are not required to match the comparator semantics. In particular, lambdas of the same body do not compare equal.

---

## 4. The Javadoc warning paragraph — read it once

Both `Comparable` and `Comparator` Javadocs contain a paragraph that engineers should read once and never forget:

> "It is strongly recommended, but not strictly required, that `(x.compareTo(y)==0) == (x.equals(y))`. Generally speaking, any class that implements the `Comparable` interface and violates this condition should clearly indicate this fact. The recommended language is "Note: this class has a natural ordering that is inconsistent with equals." For example, if one adds two keys `a` and `b` such that `(!a.equals(b) && a.compareTo(b) == 0)` to a sorted set that does not use an explicit comparator, the second `add` operation returns `false` (and the size of the sorted set does not increase) because `a` and `b` are equivalent from the sorted set's perspective."

`BigDecimal` is the standard library's canonical example of a violator, and its class-level Javadoc carries the recommended note.

---

## 5. JLS §9 — interfaces, default methods, and `Comparator`

`Comparator` is a *functional interface* in the JLS sense (§9.8): one abstract method (`compare`), the rest are `default` or `static`. JLS §9.4.3 governs default methods; §9.4.4 governs static methods on interfaces. Both were added in Java 8 via **JEP 126**.

Before Java 8, `Comparator` had only `compare` and `equals`. Java 8 added the methods that make modern comparator code possible:

- `static <T,U extends Comparable<? super U>> Comparator<T> comparing(Function<? super T, ? extends U>)`
- `static <T> Comparator<T> comparingInt(ToIntFunction<? super T>)`
- `static <T> Comparator<T> comparingLong(ToLongFunction<? super T>)`
- `static <T> Comparator<T> comparingDouble(ToDoubleFunction<? super T>)`
- `default Comparator<T> thenComparing(Comparator<? super T>)`
- `default Comparator<T> thenComparing(Function<? super T, ? extends U>)`
- `default Comparator<T> reversed()`
- `static <T> Comparator<T> nullsFirst(Comparator<? super T>)`
- `static <T> Comparator<T> nullsLast(Comparator<? super T>)`
- `static <T extends Comparable<? super T>> Comparator<T> naturalOrder()`
- `static <T extends Comparable<? super T>> Comparator<T> reverseOrder()`

The composition style we use today (`Comparator.comparing(...).thenComparing(...)`) was impossible before JEP 126 made it legal to ship method bodies on interfaces. Today's typical comparator code is a direct consequence of that JEP.

---

## 6. Generics in the comparator API — PECS spelled out

The static `Comparator.comparing` signature is the textbook example of PECS in the JDK:

```java
public static <T, U extends Comparable<? super U>> Comparator<T>
    comparing(Function<? super T, ? extends U> keyExtractor);
```

Three wildcards:

- **`Function<? super T, ?>`** — PECS-consumer. The function *consumes* `T`, so any `Function` over a supertype of `T` works (a `Function<Object, ?>` is fine).
- **`Function<?, ? extends U>`** — PECS-producer. The function *produces* a key, and any subtype of `U` is acceptable.
- **`U extends Comparable<? super U>`** — `U` is comparable to itself *or to a supertype*. This lets you sort `Truck` by `Comparator.comparing(Truck::weight)` where `weight` is, say, `Integer` and `Integer extends Comparable<Integer>` — but it would equally accept a key type that implements `Comparable<Number>`.

The methods that *take* comparators carry the contravariance:

```java
public static <T> void sort(List<T> list, Comparator<? super T> c);
public default void List<T>.sort(Comparator<? super T> c);
public static <T> Stream<T> Stream.sorted(Comparator<? super T> c);
```

`? super T` is the contravariant input: a `Comparator<Vehicle>` can sort a `List<Truck>` because the comparator accepts anything *at least as wide as* `Truck`. The pattern is consistent across the JDK; mirror it in your own factories.

---

## 7. Sorted collections — `TreeMap` / `TreeSet` / `PriorityQueue`

The three collections whose semantics depend on a comparator:

- **`TreeMap<K,V>`** — a red-black tree keyed by `K`. Uses the comparator (or the natural ordering of `K` if no comparator is supplied) for *every* ordering and equality operation. `equals` on `K` is never called.
- **`TreeSet<E>`** — a wrapper over `TreeMap<E, PRESENT>`. Same rules.
- **`PriorityQueue<E>`** — a binary heap. Uses the comparator (or natural ordering) for *priority*, but uses `equals` for `contains` and `remove(Object)`. This *inconsistency between iteration order and equality* is the most-cited `PriorityQueue` gotcha.

The Javadoc for `TreeMap` says explicitly:

> "Note that the ordering maintained by a tree map, like any sorted map, and whether or not an explicit comparator is provided, must be consistent with `equals` if this sorted map is to correctly implement the `Map` interface. (See `Comparable` or `Comparator` for a precise definition of consistent with equals.) This is so because the `Map` interface is defined in terms of the `equals` operation, but a sorted map performs all key comparisons using its `compareTo` (or `compare`) method, so two keys that are deemed equal by this method are, from the standpoint of the sorted map, equal."

In plain language: a `TreeMap` with a comparator inconsistent with `equals` *violates the `Map` contract* — but it *works as a SortedMap*. The implication is that any code holding a `Map<K,V>` reference (rather than `SortedMap` / `NavigableMap`) and reasoning about `equals` is making a mistake when the implementation is a `TreeMap`.

---

## 8. `Arrays.sort` and stability — JEP history

`Arrays.sort(Object[])` and `Arrays.sort(Object[], Comparator)` have been **stable** since Java 7. The algorithm is *Timsort* (Tim Peters' adaptive merge sort), as documented in `Arrays.sort(Object[])` Javadoc:

> "The implementation was adapted from Tim Peters's list sort for Python (TimSort). It uses techniques from Peter McIlroy's "Optimistic Sorting and Information Theoretic Complexity"."

Stability means: elements that compare as `0` retain their relative order. `Collections.sort` and `List.sort` delegate to `Arrays.sort`, so both are stable for `Object[]` / `List<Object>`.

Primitive sorts are *not* stable: `Arrays.sort(int[])`, `Arrays.sort(long[])`, etc. use *dual-pivot quicksort* (Vladimir Yaroslavskiy's algorithm, JEP not formally recorded but introduced in JDK 7). Stability is meaningless for primitives — `1 == 1` literally, there's nothing to keep in order — so the trade for speed is fine.

`Collections.sort(List, Comparator)` is *not* deprecated. Its current Javadoc:

> "Sorts the specified list according to the order induced by the specified comparator. ... This implementation defers to the `List.sort(Comparator)` method using the specified list and comparator."

So `Collections.sort` is a one-line wrapper now. Modern style prefers `list.sort(cmp)`, but `Collections.sort` still works and is not going away.

---

## 9. JEP references

| JEP   | Feature                                  | Relevance to this contract                              |
|-------|------------------------------------------|---------------------------------------------------------|
| 126   | Default and static interface methods     | Made `Comparator.comparing` / `thenComparing` possible  |
| 269   | Convenience factory methods for Collections | `List.of`, `Set.of` — not directly comparator, but shapes the immutable-list style |
| 335   | Deprecate the Nashorn JavaScript engine  | Indirectly: marks the era of "everything is a functional interface now" |
| 395   | Records (final)                          | The recommended value-carrier type to make `Comparable` on |
| 441   | Pattern matching for `switch` (final)    | Alternative to `compareTo` for sealed type dispatch     |
| 401   | Value classes (preview, in flight)       | When final, will let `Comparable` types be allocation-free |

No JEP redefines the `Comparable` / `Comparator` contracts themselves — the contracts are part of the API specification and have been stable since Java 1.2 (`Comparable`) and Java 1.2 (`Comparator`, repurposed by Java 8). The big functional changes are JEP 126 (Java 8) for the comparator combinators and the implicit "stable sort" of JEP-less Java 7.

---

## 10. JVMS §6.5 — `invokeinterface` and the cost of `Comparator.compare`

`Comparator` is an interface, so every `cmp.compare(a, b)` call site emits an `invokeinterface` bytecode. JVMS §6.5.invokeinterface defines the resolution:

> "The Java Virtual Machine searches the class of `objectref` for a method ... that has the same name and descriptor as resolved by `<class name>.<method name>`. The interface method is then invoked."

At runtime, HotSpot uses an *itable* (interface dispatch table) — a hashed lookup keyed by interface. For a *monomorphic* call site (always the same concrete comparator), C2 specializes to a direct call; for *bimorphic* (two types), a type check and two inlined targets; for *megamorphic* (three or more), a true itable lookup.

The implication for comparator design:

- **A static-final comparator is monomorphic.** The JIT inlines `cmp.compare(a, b)` after the first few invocations.
- **A `private static final Comparator<Order> NATURAL = ...`** ensures the JIT only ever sees one concrete `Comparator` at this call site — the captured-lambda or returned-method-reference singleton.
- **Comparator passed through layers** (e.g., a sort utility that accepts `Comparator<? super T>` and is called with five different ones) is megamorphic at the utility's call site. This is usually fine but matters for hot inner loops.

`Comparable.compareTo` is *also* dispatched virtually — every concrete class has its own implementation, found via the vtable. Same monomorphic/bimorphic/megamorphic distinction. `optimize.md` has numbers.

---

## 11. The `naturalOrder()` and `reverseOrder()` static methods

```java
public static <T extends Comparable<? super T>> Comparator<T> naturalOrder();
public static <T extends Comparable<? super T>> Comparator<T> reverseOrder();
```

The Javadoc for `naturalOrder` says simply:

> "Returns a comparator that compares Comparable objects in natural order."

What's worth knowing is that the implementation is a *singleton* — `Comparator.naturalOrder()` returns the same object every call, and the lambda inside (`(a, b) -> a.compareTo(b)`) is cached. Similarly `reverseOrder()` returns a singleton, and `reverseOrder()` followed by `reverseOrder()` returns the same object as `naturalOrder()` (HotSpot doesn't necessarily collapse this, but the contract permits it).

`Comparator.<T>nullsFirst(naturalOrder())` is the right way to express "sort `Comparable` values, with nulls first". The recipe occurs constantly in sorting collections of nullable references.

---

## 12. Records and `Comparable`

A `record` is implicitly `final` and has auto-generated `equals` and `hashCode` (based on all components). It does *not* automatically implement `Comparable`, but it's a common pattern to add one:

```java
public record Version(int major, int minor, int patch) implements Comparable<Version> {
    private static final Comparator<Version> NATURAL =
        Comparator.comparingInt(Version::major)
                  .thenComparingInt(Version::minor)
                  .thenComparingInt(Version::patch);

    @Override
    public int compareTo(Version other) {
        return NATURAL.compare(this, other);
    }
}
```

The record's `equals` is structural: two `Version`s with the same three components are equal. The comparator returns `0` exactly when all three components match — *consistent with equals*. This is the cleanest possible setup for a Comparable: records + chained `Comparator.comparing` + static-final cache. JLS §8.10 (JEP 395) makes the record's structural equality automatic; the chained comparator makes the natural ordering consistent with it.

---

## 13. Reading list

1. **`java.lang.Comparable` Javadoc** — the four-clause contract, the consistency-with-equals recommendation.
2. **`java.util.Comparator` Javadoc** — the static and default methods, the same contract clauses applied externally.
3. **`java.util.TreeMap` Javadoc** — the explicit "consistent with `equals`" requirement for `Map` compliance.
4. **`java.util.Arrays.sort(Object[])` Javadoc** — stability since Java 7, Timsort attribution.
5. **`java.math.BigDecimal` Javadoc** — the standard example of `compareTo`/`equals` divergence, with the recommended note.
6. **JLS §9.4.3 / §9.4.4** — default and static methods on interfaces.
7. **JLS §8.10** — records.
8. **JLS §14.11 / §15.28** — pattern matching for `switch`, useful as an alternative to comparator chains for sealed types.
9. **JVMS §6.5.invokeinterface** — interface dispatch mechanics that govern comparator cost.
10. **JEP 126** — default methods (the foundation of the modern `Comparator` API).
11. **JEP 269** — convenience factory methods.
12. **JEP 395** — records.
13. **Joshua Bloch, *Effective Java*, 3rd ed., Item 14** — "Consider implementing Comparable." The clearest treatment of the contract in any textbook.
14. **Tim Peters' original Timsort write-up** — `https://github.com/python/cpython/blob/main/Objects/listsort.txt` — the algorithm that Java 7+ uses for object arrays.

The contract is *Javadoc*, not JLS. But the Javadoc is normative: every standard library that takes a comparator (`Arrays.sort`, `Collections.sort`, `TreeMap`, `PriorityQueue`, `Stream.sorted`) relies on the contract holding, and breaks visibly when it doesn't. Treat the Javadoc as the spec; cite section numbers when arguing about a design.
