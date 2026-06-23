# Method Chaining — Junior

> **What?** *Method chaining* is the technique of calling multiple methods on the same object in a single expression by having each method return a reference suitable for the next call. The pattern produces fluent, readable code like `text.trim().toUpperCase().replace(' ', '_')`.
> **How?** Design methods that return either `this` (mutating builders) or a new object of compatible type (immutable transformations). The caller can then chain calls without intermediate variables.

---

## 1. The simplest example

```java
String result = "  hello world  ".trim().toUpperCase().replace(' ', '_');
// result = "HELLO_WORLD"
```

Each method returns a `String`, which is itself the receiver of the next call. Three operations, one expression, no temporaries.

Compare to the unchained version:

```java
String s1 = "  hello world  ".trim();
String s2 = s1.toUpperCase();
String result = s2.replace(' ', '_');
```

Same result, more lines, more named variables to track.

---

## 2. The two flavors of chaining

### A. Builder/setter chaining (mutating)

The method modifies the receiver and returns `this`:

```java
class StringBuilder {
    public StringBuilder append(String s) {
        // modify internal buffer
        return this;
    }
    public StringBuilder reverse() {
        // mutate
        return this;
    }
}

new StringBuilder().append("hello").append(" ").append("world").reverse();
```

Same instance flows through the chain. Used in `StringBuilder`, `Stream.Builder`, and most "builder pattern" code.

### B. Functional chaining (immutable)

Each method returns a *new* object, leaving the original untouched:

```java
String s = "hello";
String t = s.toUpperCase();  // new String, s unchanged
String u = t.replace('L', 'X');  // another new String

// Chained:
String result = "hello".toUpperCase().replace('L', 'X');  // "HEXXO"
```

The `String` class is fully immutable; every method that "modifies" returns a new instance. The chain works because each call produces a String to receive the next call.

---

## 3. The Builder pattern

Method chaining shines when constructing complex objects step by step:

```java
class Pizza {
    private final String size;
    private final List<String> toppings;
    private final boolean extraCheese;

    private Pizza(Builder b) {
        this.size = b.size;
        this.toppings = List.copyOf(b.toppings);
        this.extraCheese = b.extraCheese;
    }

    public static Builder builder() { return new Builder(); }

    public static class Builder {
        private String size = "medium";
        private List<String> toppings = new ArrayList<>();
        private boolean extraCheese;

        public Builder size(String s) { this.size = s; return this; }
        public Builder addTopping(String t) { this.toppings.add(t); return this; }
        public Builder extraCheese(boolean b) { this.extraCheese = b; return this; }
        public Pizza build() { return new Pizza(this); }
    }
}

Pizza p = Pizza.builder()
    .size("large")
    .addTopping("mushrooms")
    .addTopping("olives")
    .extraCheese(true)
    .build();
```

The chain reads like a sentence: "Build a large pizza with mushrooms, olives, and extra cheese."

---

## 4. Why chaining helps readability

Without chaining:
```java
Pizza.Builder b = Pizza.builder();
b.size("large");
b.addTopping("mushrooms");
b.addTopping("olives");
b.extraCheese(true);
Pizza p = b.build();
```

Many lines, redundant `b.` prefix on each call. The reader's eyes have to track that all calls happen on the same `b`.

With chaining, the connection is structural — each return value becomes the next receiver. Whitespace and indentation make the chain readable as a single thought.

---

## 5. Streams: the canonical fluent API

Java's Stream API uses chaining for data pipelines:

```java
List<String> result = users.stream()
    .filter(u -> u.age() >= 18)
    .map(User::name)
    .sorted()
    .toList();
```

Each operation returns a new `Stream<T>`, set up to receive the next operation. The terminal operation (`toList()`) actually runs the pipeline. Until then, the stream is lazy.

This is **functional chaining** at scale: every step returns a new "view" of the data.

---

## 6. Comparator chaining

```java
Comparator<User> byAgeThenName = Comparator
    .comparingInt(User::age)
    .thenComparing(User::name);

users.sort(byAgeThenName);
```

`Comparator.comparingInt` returns a `Comparator<User>`. `thenComparing` wraps it into a new `Comparator` that breaks ties by name. The chain reads top-down: "compare by age, then by name."

---

## 7. Optional chaining

```java
String email = userOpt
    .map(User::contactInfo)
    .map(ContactInfo::email)
    .orElse("none");
```

Each step is "if the Optional has a value, transform it; otherwise propagate empty." Equivalent to nested null checks but much cleaner.

---

## 8. The `return this` rule

For chainable mutating methods:

```java
public Builder size(String s) {
    this.size = s;
    return this;       // this is what makes it chainable
}
```

Forget `return this`, and the chain stops compiling: the caller would receive `void` and can't keep chaining.

For functional chaining, you return the *new* object:

```java
public Money plus(Money other) {
    return new Money(this.cents + other.cents, this.currency);
}
```

---

## 9. When NOT to chain

Method chaining is great when each step is meaningful and the final intent is clear. It's bad when:

- The chain is too long (>5-6 calls) — reader loses context
- Side effects are scattered (some methods mutate, some don't)
- Errors are hard to attribute (which call in the chain failed?)
- The same chain is repeated in many places (extract a method)

Use intermediate variables when they help readability:

```java
// not great
return svc.fetch(id).user().team().lead().email();

// better
User lead = svc.fetch(id).user().team().lead();
return lead.email();
```

---

## 10. Mixing chains and conditionals

A common need: sometimes apply a step, sometimes not. Without chaining-friendly support, you break the chain:

```java
StringBuilder b = new StringBuilder("Hello");
if (loud) b.append("!!!");
if (named) b.append(", " + name);
b.append(".");
```

Some libraries provide `applyIf(condition, fn)` helpers:

```java
new StringBuilder("Hello")
    .applyIf(loud, b -> b.append("!!!"))
    .applyIf(named, b -> b.append(", " + name))
    .append(".");
```

Useful in DSLs but not in standard Java.

---

## 11. Common newcomer mistakes

**Mistake 1: forgetting `return this`**

```java
public Builder size(String s) {
    this.size = s;
    // return this missing!
}
```

Compiler warns of mismatched return types if the method declares `Builder` return.

**Mistake 2: chaining mutating and immutable APIs**

```java
"hello".replace("h", "H");   // returns new String — original unchanged
```

If you write `String s = "hello"; s.replace("h", "H");` and expect `s` to change, you've made a mistake. Always use the return value of immutable transformations.

**Mistake 3: NPE in the middle of a chain**

```java
user.team().lead().email();   // any of team(), lead(), email() can return null
```

Either return `Optional` from each step (and use `Optional.flatMap`), or use safe navigation patterns.

---

## 12. Quick reference

| Style              | Returns       | Example                              |
|--------------------|---------------|--------------------------------------|
| Mutating chain     | `this`        | `StringBuilder.append`, `List.add`?  |
| Immutable chain    | new instance  | `String.replace`, `Money.plus`       |
| Lazy chain (Stream)| pipeline op   | `stream().filter().map()`            |
| Optional chain     | `Optional`    | `.map().filter().orElse()`           |
| Comparator chain   | `Comparator`  | `.comparing().thenComparing()`       |

---

## 13. What's next

| Question                                  | File              |
|-------------------------------------------|-------------------|
| Builder pattern variants, BUILDER vs DSL  | `middle.md`        |
| JIT inlining of chains, escape analysis   | `senior.md`        |
| Bytecode of fluent calls                  | `professional.md`  |
| Functional vs builder API design          | `interview.md`     |

---

**Memorize this**: method chaining = each method returns a usable receiver for the next call. Mutating chain returns `this`; functional chain returns a new instance. Use it for builders, streams, and anywhere a sequence of related operations reads naturally as a fluent expression.
