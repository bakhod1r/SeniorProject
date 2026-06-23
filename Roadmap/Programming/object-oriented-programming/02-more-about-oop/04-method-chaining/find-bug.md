# Method Chaining — Find the Bug

Twelve buggy snippets. Each compiles. Each is wrong because of a chaining mistake.

---

## Bug 1 — Forgot `return this`

```java
class Builder {
    int x;
    public Builder x(int v) { this.x = v; }     // ERROR: missing return
}
```

**Fix:** add `return this;` and declare return type `Builder`.

---

## Bug 2 — Returning parent type, losing subtype

```java
class Animal {
    public Animal name(String n) { /* ... */ return this; }
}
class Dog extends Animal {
    public Dog bark() { return this; }
}

new Dog().name("Rex").bark();   // ERROR: Animal has no method bark()
```

**Why?** `name()` returns `Animal`; subsequent `.bark()` fails.

**Fix:** generic self-type:
```java
class Animal<T extends Animal<T>> {
    public T name(String n) { return (T) this; }
}
class Dog extends Animal<Dog> { public Dog bark() { return this; } }
```

---

## Bug 3 — Modifying String "in place"

```java
String s = "  hello  ";
s.trim();
s.toUpperCase();
System.out.println(s);   // "  hello  "
```

**Why?** Strings are immutable. `trim()` and `toUpperCase()` return *new* Strings; the originals are unchanged.

**Fix:** assign or chain:
```java
s = s.trim().toUpperCase();
```

---

## Bug 4 — Side effect inside `map`

```java
list.stream()
    .map(u -> { logger.info(u.name()); return u; })
    .toList();
```

**Why?** `map` should be a pure transformation. Side effects (logging) here pollute the pipeline. If the stream is short-circuited (e.g. with `findFirst`), some logs may not fire.

**Fix:** use `peek` for debugging, or `forEach` for terminal side effects:
```java
list.stream().peek(u -> logger.info(u.name())).toList();
```

(Note: `peek` is itself a debugging hook; don't rely on it for production logic either.)

---

## Bug 5 — Chain reads wrong order

```java
new StringBuilder("World")
    .insert(0, " ")
    .insert(0, "Hello")
    .toString();   // "Hello World" — works, but reverse-reading is confusing
```

**Why?** Using `insert(0, ...)` to prepend forces reverse-thinking. Cleaner to build forward.

**Fix:**
```java
new StringBuilder("Hello").append(" ").append("World").toString();
```

---

## Bug 6 — Builder reused after `build()`

```java
PizzaBuilder b = new PizzaBuilder().size("large").addTopping("mushrooms");
Pizza p1 = b.build();
b.addTopping("olives");
Pizza p2 = b.build();   // p2 has both toppings — but does p1 also?
```

**Why?** If the builder shares the toppings list with the built Pizza, mutating later affects the previously-built object too.

**Fix:** `build()` should make defensive copies (`List.copyOf(toppings)`) so the built object is independent.

---

## Bug 7 — NPE in chain

```java
order.getCustomer().getAddress().getCity().getName();
```

**Why?** Any of `getCustomer`, `getAddress`, or `getCity` could return null, NPE'ing midway.

**Fix:** Use `Optional`:
```java
order.customer()
    .flatMap(Customer::address)
    .flatMap(Address::city)
    .map(City::name)
    .orElse("unknown");
```

Or refactor to delegate (Law of Demeter): `order.customerCityName()`.

---

## Bug 8 — Throwing checked exception in chain

```java
list.stream()
    .map(s -> {
        try { return decode(s); }   // decode throws IOException
        catch (IOException e) { throw new RuntimeException(e); }
    })
    .toList();
```

**Why?** Lambda must conform to `Function<String, X>`, which doesn't declare `throws IOException`. Wrapping in `RuntimeException` works but loses the checked-exception discipline.

**Fix:** define a custom interface that throws checked, use a helper that propagates, or convert to a Result type.

---

## Bug 9 — Builder mutated by aliasing

```java
List<String> shared = new ArrayList<>();
Builder b = builder().toppings(shared);
shared.add("mushrooms");
Pizza p = b.build();
System.out.println(p.toppings());   // includes "mushrooms"
```

**Why?** The builder stored the *reference* to the caller's list. Caller mutated it post-build.

**Fix:** copy in the setter:
```java
public Builder toppings(List<String> t) { this.toppings = new ArrayList<>(t); return this; }
```

---

## Bug 10 — Stream consumed twice

```java
Stream<String> s = list.stream().filter(p -> !p.isEmpty());
s.count();
s.toList();   // IllegalStateException: stream has already been operated upon or closed
```

**Why?** Streams are single-use. Calling a terminal op closes the stream; reusing throws.

**Fix:** create a fresh stream:
```java
list.stream().filter(...).count();
list.stream().filter(...).toList();
```

Or hold the source list and re-stream as needed.

---

## Bug 11 — Builder without `build()`

```java
class Builder {
    Pizza pizza = new Pizza();
    public Builder size(String s) { pizza.setSize(s); return this; }
    public Builder addTopping(String t) { pizza.addTopping(t); return this; }
}

Pizza p = new Builder().size("large").addTopping("mushrooms").pizza;   // public field?
```

**Why?** Without `build()`, you must expose internal state. Now `Pizza` is mutable, no validation occurs at end.

**Fix:** add a `build()` that returns an immutable snapshot.

---

## Bug 12 — Wrong order of operations

```java
list.stream()
    .filter(s -> s.length() > 5)
    .findFirst()
    .ifPresent(System.out::println);
```

If `findFirst` is intended to return the first long string, this is fine. But if you wanted "the longest," the chain is wrong:

```java
.max(Comparator.comparingInt(String::length))   // not findFirst!
```

**Why?** `findFirst` after `filter` returns the first qualifying element, not the largest. Easy to confuse intent.

**Fix:** use the right operator (`max`, `min`, etc.) for what you actually want.

---

## Pattern recap

| Bug | Family                          | Cure                              |
|-----|---------------------------------|-----------------------------------|
| 1   | Missing `return this`           | Always return                     |
| 2   | Lost subtype in chain           | Self-typed generic                |
| 3   | Treating immutable as mutable   | Reassign returned value            |
| 4   | Side effects in `map`           | Use `peek` or external action      |
| 5   | Confusing chain direction        | Reorder for forward-reading        |
| 6   | Builder shares state with built  | Defensive copy in `build()`        |
| 7   | NPE midway                      | Optional or delegation             |
| 8   | Checked exceptions in lambdas    | Wrap or refactor                   |
| 9   | Builder aliases caller's data    | Copy in setter                     |
| 10  | Stream reuse                    | Re-stream                          |
| 11  | Missing `build()`                | Add explicit terminal              |
| 12  | Wrong operator for intent        | Match operator to goal             |

---

**Memorize the shapes**: most chain bugs are about state ownership (who owns the data?), terminal selection (which operator?), and immutable-vs-mutable confusion. Be explicit in API contracts.
