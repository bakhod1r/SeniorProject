# Pass by Value / Pass by Reference — Middle

> **What?** Argument evaluation rules, the relationship between Java's pass-by-value and immutable types, mutable input pitfalls, and how to design APIs that don't surprise callers.
> **How?** By understanding what happens at the language level (JLS) when arguments are evaluated and bound to parameters.

---

## 1. Argument evaluation order

JLS §15.7.4 specifies left-to-right evaluation:

```java
void m(int a, int b) { }

int x = 0;
m(x++, ++x);    // arguments evaluated: 0, 2 (then x=2)
```

`x++` is evaluated first (returns 0, x becomes 1). Then `++x` (x becomes 2, returns 2).

This is critical when arguments have side effects. Don't rely on right-to-left.

---

## 2. Boxing in argument passing

```java
void m(Integer x) { }
m(5);               // boxed: Integer.valueOf(5)
```

The compiler inserts a boxing call. For values in the cache range (-128 to 127), `valueOf` returns a cached instance — no allocation.

For larger values:
```java
m(1000);           // allocates a new Integer
```

Be aware of boxing in hot paths; it can dominate cost.

---

## 3. Varargs as arrays

```java
void m(int... values) { ... }

m(1, 2, 3);   // calls m(new int[]{1, 2, 3})
m();          // calls m(new int[0])
```

Internally, the compiler creates an array. The varargs syntax is sugar.

```java
int[] arr = {1, 2, 3};
m(arr);    // passes the same array — caller's mutations to arr affect the method
```

---

## 4. Mutable arguments and aliasing

```java
public class Order {
    private final List<Item> items;
    public Order(List<Item> items) {
        this.items = items;    // alias
    }
}

var caller = new ArrayList<Item>();
var order = new Order(caller);
caller.add(item);    // also visible in order.items!
```

The `Order` shares the caller's list. Mutations to `caller` affect `order.items`.

**Fix:** defensive copy:
```java
this.items = List.copyOf(items);
```

---

## 5. The mutable input rule

Whenever your method takes a mutable type, decide:
- **Will I modify it?** Document clearly. Callers must know.
- **Will I store it?** If yes, defensively copy.
- **Will I just read it?** Document; callers can mutate without surprise.

These decisions form the API contract.

---

## 6. Parameter modification — almost always bad

```java
void process(List<Item> items) {
    items.removeIf(Item::expired);   // mutates caller's list
}
```

Surprising. Caller may not expect their list to change.

Safer: return a new list:
```java
List<Item> filterExpired(List<Item> items) {
    return items.stream().filter(i -> !i.expired()).toList();
}
```

Java tradition tilts toward mutation (Stream/Collection APIs do `Collection.removeIf`); modern functional style prefers return.

---

## 7. The `final` modifier on parameters

```java
void m(final int x) { ... }
```

Just prevents reassigning `x` within the method. Has no caller-visible effect. Style choice; many teams require it for clarity.

```java
void m(final List<Item> items) {
    items.add(item);    // OK — final on the reference, not the list
    items = new ArrayList<>();   // ERROR
}
```

---

## 8. `null` as an argument

```java
void m(String s) { ... }
m(null);    // permitted unless method validates
```

Null is a valid value for any reference parameter (unless declared `@NotNull` and checked). For overloaded methods, null can cause ambiguity:

```java
void m(String s) { ... }
void m(Object o) { ... }
m(null);    // chooses String (more specific)
```

```java
void m(String s) { ... }
void m(StringBuilder sb) { ... }
m(null);    // ambiguous — both apply, neither more specific
```

---

## 9. Return values vs out parameters

C/C++ have output parameters via pointers. Java doesn't. Use return values:

```java
// C-style (not Java):
void parse(String input, int* result, String* error);

// Java:
record ParseResult(int value, String error) { }
ParseResult parse(String input) { ... }
```

Or use exceptions for errors and return value:
```java
int parse(String input) throws ParseException { ... }
```

---

## 10. Wrapper types as "out parameters"

You can simulate output via wrapper types, but it's awkward:

```java
class IntBox { int value; }

void inc(IntBox box) { box.value++; }

var b = new IntBox();
inc(b);
System.out.println(b.value);   // 1
```

Java prefers return values. Use wrappers only when truly multiple "out" values are needed and a record is overkill.

---

## 11. Generic parameters and erasure

```java
<T> T identity(T x) { return x; }
```

After erasure, `T` is `Object`. The method passes/returns `Object`. The compiler inserts casts at the call site if needed.

This means generic methods don't differ at the bytecode level from `Object`-typed ones. Pass-by-value semantics are unchanged.

---

## 12. Lambdas and captured variables

```java
int x = 5;
Runnable r = () -> System.out.println(x);   // x is captured
x = 10;       // ERROR — x is effectively final after capture
```

Lambdas capture *values* (effectively-final variables). The captured value is a snapshot, not a live reference. After capture, the variable can't change.

For mutable capture, use an array or AtomicInteger:
```java
int[] counter = {0};
Runnable r = () -> counter[0]++;
r.run();
System.out.println(counter[0]);   // 1
```

---

## 13. Generics and primitive types

```java
<T> void m(T x) { }

m(5);                  // boxed: m(Integer.valueOf(5))
m(Integer.valueOf(5));  // direct
```

Generics don't work with primitives directly — they require boxing. This is part of Java's erasure design.

Modern alternatives: primitive specializations (`IntStream`, `LongAdder`, etc.) avoid boxing.

---

## 14. Pass-by-value rules summary

| Type            | What's passed       | Caller sees mutations? | Caller sees reassignment? |
|-----------------|---------------------|------------------------|---------------------------|
| Primitive        | Value (number)      | No mutation possible    | No                        |
| Reference        | Reference (pointer) | Yes (object mutations) | No (param reassignment)   |
| Array            | Reference            | Yes (element changes)   | No                        |
| Boxed primitive  | Reference            | Yes if mutable; not if Integer (immutable) | No |

---

## 15. What's next

| Topic                          | File              |
|--------------------------------|-------------------|
| JIT and register allocation     | `senior.md`        |
| Bytecode of arg passing         | `professional.md`  |
| JLS rules                       | `specification.md` |
| Common bugs                     | `find-bug.md`      |

---

**Memorize this**: Java is pass-by-value, but for reference types, the "value" is a reference. The reference is copied; you can mutate the pointed-to object (visible to caller) but reassigning the parameter only affects the local copy. Defensive copy mutable inputs you store; document mutation behavior; prefer return values over out parameters.
