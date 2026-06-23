# Traits, Mixins and Multiple Inheritance — Find the Bug

Ten snippets across Java, Scala, Python, Ruby and C++ where multiple inheritance, mixins, or linearization produce something surprising or wrong. For each: read the code, decide what's wrong (or what it actually prints), then reveal the diagnosis. The Java equivalent is shown wherever the bug is cross-language so you can see how Java's *explicit* model would have caught it.

---

## 1. The Java default conflict that "should just pick one"

```java
interface Json { default String render() { return "{}"; } }
interface Xml  { default String render() { return "<x/>"; } }

class Document implements Json, Xml { }

String s = new Document().render();
```

**What's wrong?**

<details><summary>Diagnosis</summary>

It doesn't compile: *"class Document inherits unrelated defaults for render() from types Json and Xml"*. Java refuses to pick between two unrelated defaults — there is no specificity order. Fix by overriding and choosing:

```java
class Document implements Json, Xml {
    @Override public String render() { return Json.super.render(); }   // explicit choice
}
```

This is the *feature*, not a limitation: a Scala/Python version would silently pick the right-most/MRO-first one and you'd never know a conflict existed.
</details>

---

## 2. The Scala linearization that surprises

```scala
trait Base { def tag: String = "B" }
trait L extends Base { override def tag: String = "L-" + super.tag }
trait R extends Base { override def tag: String = "R-" + super.tag }

class C extends L with R
println(new C().tag)
```

**What does it print — `"L-R-B"` or `"R-L-B"`?**

<details><summary>Diagnosis</summary>

`"R-L-B"`. Linearization of `C` is `[C, R, L, Base]` — the **right-most** mixin (`R`) is most specific, so `R.tag` runs first; its `super.tag` is *not* `Base` but the next in the linear order, `L`; `L`'s `super.tag` is `Base`. The trap: reading `super` as "the lexical parent `Base`" gives the wrong answer. In Scala, `super` means "next in the linearization".

The Java equivalent would force you to write the order explicitly (`R.super.tag()` then `L.super.tag()`), so the surprise can't happen — you *typed* the order.
</details>

---

## 3. The Python `super()` that skips to a sibling

```python
class A:
    def who(self): return ["A"]
class B(A):
    def who(self): return ["B"] + super().who()
class C(A):
    def who(self): return ["C"] + super().who()
class D(B, C): pass

print(D().who())
```

**`["B", "A"]`? Something else?**

<details><summary>Diagnosis</summary>

`["B", "C", "A"]`. The MRO of `D` is `[D, B, C, A, object]`. `B.who`'s `super()` resolves to **`C`** — the next class in `D`'s MRO — even though `B` only inherits from `A`. The shared base `A` runs once, last. If you wrote `B` expecting `super()` to mean "`A`", you'd be wrong: `super()` follows the *final object's* MRO, not lexical parents.

There is no Java equivalent to get wrong, because Java has no implicit `super` chain across unrelated interfaces — you name the one you mean.
</details>

---

## 4. The C++ diamond that compiles but stores two values

```cpp
struct Account { double balance = 0; };
struct Checking : Account { };
struct Savings  : Account { };
struct Combined : Checking, Savings { };

Combined c;
c.Checking::balance = 100;
double total = c.Savings::balance;   // what is total?
```

**What is `total`?**

<details><summary>Diagnosis</summary>

`0`, not `100`. `Combined` contains **two** `Account` subobjects — `c.Checking::balance` and `c.Savings::balance` are *different fields*. `c.balance` alone won't even compile (ambiguous). The bug is the assumption that there's one `balance`. Fix with virtual inheritance:

```cpp
struct Checking : virtual Account { };
struct Savings  : virtual Account { };   // now ONE shared Account
```

This is the *state diamond* in its purest form — exactly what Java forbids by allowing only one superclass. In Java, `Combined` could implement two interfaces but they'd carry no `balance` field, so there's only ever one piece of state, from the single superclass.
</details>

---

## 5. The Ruby module order bug

```ruby
module Greet  def hi; "hi"; end end
module Shout  def hi; "HI"; end end

class Speaker
  include Shout
  include Greet
end

puts Speaker.new.hi
```

**`"HI"` or `"hi"`?**

<details><summary>Diagnosis</summary>

`"hi"`. **Last `include` wins** — `Greet` was included last, so it sits closest to `Speaker` in the ancestor chain (`[Speaker, Greet, Shout, ...]`) and its `hi` is found first. Developers who read top-to-bottom expect `Shout` (first listed) to win; the rule is the opposite. Reordering the two `include` lines silently flips behavior.

Java analog: two interfaces with default `hi()` → compile error, forcing an explicit choice. No silent order-dependence.
</details>

---

## 6. The Java "interface-as-state" that's secretly global

```java
interface Counted {
    AtomicInteger COUNT = new AtomicInteger();          // looks like per-instance state
    default int next() { return COUNT.incrementAndGet(); }
}
class A implements Counted { }
class B implements Counted { }

new A().next();   // 1
new B().next();   // ??
```

**What does `new B().next()` return?**

<details><summary>Diagnosis</summary>

`2`. `COUNT` is implicitly `public static final` (JLS §9.3 — interfaces have no instance fields), so the `AtomicInteger` is **shared by every implementor of `Counted`**, across `A` and `B` and every instance. The author wanted per-instance state and got a global. This is "stateful mixin" abuse — the spec literally cannot give you instance state on an interface. Fix with composition: a `Counter` field per object.
</details>

---

## 7. The Python C3 that won't even load

```python
class A: pass
class B: pass
class X(A, B): pass
class Y(B, A): pass
class Z(X, Y): pass        # <-- here
```

**What happens at the marked line?**

<details><summary>Diagnosis</summary>

`TypeError: Cannot create a consistent method resolution order (MRO) for bases A, B`. `X` requires `A` before `B`; `Y` requires `B` before `A`; `Z` inherits both constraints, which are contradictory — C3 has no consistent linearization, so the *class definition itself* fails. The bug isn't in `Z`'s body; it's an emergent conflict between two distant base orderings. This is the fragile-base hazard of automatic linearization — Java cannot hit it because it never computes a cross-interface order.
</details>

---

## 8. The Java default that's silently dead code

```java
interface Loggable {
    default String describe() { return "loggable"; }
}
class Entity {
    public String describe() { return "entity"; }
}
class User extends Entity implements Loggable { }

new User().describe();
```

**Does this return `"loggable"`?**

<details><summary>Diagnosis</summary>

No — `"entity"`. **Classes win** (JLS §8.4.8): `Entity.describe()` overrides the `Loggable` default, so the default is never reached for `User`. The bug is the author's assumption that the default would "provide" `describe()`; it's dead for any implementor that already inherits the method from a class. No compile error — it just silently does the class thing. The fix depends on intent: if the default should win, the class shouldn't define `describe()`; if not, delete the misleading default.
</details>

---

## 9. The Scala stackable-trait order regression

```scala
trait Validating extends Service { abstract override def run() = { validate(); super.run() } }
trait Logging    extends Service { abstract override def run() = { log(); super.run() } }

// v1
class S1 extends BaseService with Logging with Validating
// v2 — someone "tidied" the mixin order
class S2 extends BaseService with Validating with Logging
```

**Why might `S2` be a production incident?**

<details><summary>Diagnosis</summary>

In `S1` (linearization `S1, Validating, Logging, BaseService`) the order is `validate(); log(); run()`. In `S2` it's `log(); validate(); run()` — logging now happens *before* validation, so invalid requests get logged (or logged with un-sanitized data), and a validation failure may abort *after* a log line claiming the request was accepted. A purely cosmetic reorder of `with` clauses changed runtime behavior. **Mixin order is significant in Scala** — there is no such hazard in Java because there is no implicit order; you'd write the sequence explicitly.
</details>

---

## 10. The Java `super` that can't reach the grandparent

```java
interface Vehicle { default String kind() { return "vehicle"; } }
interface Car extends Vehicle { }
class Sedan implements Car {
    @Override public String kind() {
        return Vehicle.super.kind() + "/sedan";   // <-- here
    }
}
```

**Why won't this compile?**

<details><summary>Diagnosis</summary>

`Vehicle` is an *indirect* superinterface of `Sedan` (via `Car`), and `X.super.m()` requires `X` to be a **direct** superinterface (JLS §15.12.1). You can only name an interface in your own `implements`/`extends` clause. Fix: either call `Car.super.kind()` (which inherits `Vehicle`'s default), or add `implements Vehicle` to `Sedan` directly. This is the deliberate consequence of Java having *no* `super`-chain: you name a direct superinterface, you don't walk an order.
</details>

---

## 11. The mixin that breaks `equals`/`hashCode` expectations

```java
interface Identified {
    String id();
    default boolean sameAs(Identified o) { return id().equals(o.id()); }
}
record User(String id, String name) implements Identified { }

Set<User> set = new HashSet<>();
set.add(new User("u1", "Ann"));
boolean dup = set.contains(new User("u1", "Bob"));   // ??
```

**Is `dup` true?**

<details><summary>Diagnosis</summary>

`false`. The `Identified` mixin provides `sameAs` based on `id()` only, but `HashSet` uses `equals`/`hashCode`, which for a **record** are generated from *all* components (`id` *and* `name`). So `User("u1","Ann")` and `User("u1","Bob")` are not `equals`. The mixin created a *second*, inconsistent notion of identity that silently doesn't participate in collections. The lesson: a default method can't override `Object.equals`/`hashCode` (JLS §9.4.1.3 forbids it), so "identity mixins" are a trap — define identity in the type itself, or use a custom comparator/`Set` keyed on `id()`.
</details>

---

## Patterns across these bugs

- **Implicit order is the recurring hazard** (#2, #3, #5, #9): Scala linearization, Python MRO, Ruby ancestor chain all make `super` mean "next in a computed order", and reordering mixins silently changes behavior. Java's explicit `X.super.m()` (#1, #10) trades verbosity for the elimination of this entire class of bug.
- **State on interfaces is always global** (#6): §9.3 gives you `static final`, never per-instance — "stateful mixin" is a contradiction.
- **Classes win, silently** (#8): a default never beats a class method; defaults written to "provide" behavior can be dead code.
- **The state diamond is real in C++** (#4) and impossible in Java — the single payoff of forbidding multiple state inheritance.
- **Linearization can fail to exist** (#7): an emergent, fragile-base-style failure Java structurally cannot produce.
