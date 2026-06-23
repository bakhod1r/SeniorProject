# Traits, Mixins and Multiple Inheritance — Middle

> **What?** The practical mechanics of how each major language linearizes — or refuses to linearize — multiple parents, with real Scala, Ruby, Python and Java examples you can run. The goal is to be able to *predict the resolved method* in any of them, and to know which Java construct maps onto which foreign one.
> **How?** We work the linearization algorithms by hand on the same diamond, then map the result back to Java's "no automatic order, override explicitly" model.

This file assumes the conceptual map from [junior.md](junior.md): three inheritances (type/behavior/state), Java has multiple of the first two only.

---

## 1. The shared example we will resolve in every language

We use one diamond throughout so you can compare resolutions directly:

```
        Base.greet()
        /          \
   Polite.greet()   Loud.greet()
        \          /
         Person  (uses greet)
```

`Base` provides `greet()`. `Polite` and `Loud` each override it (and call up to `Base`). `Person` mixes in both. The question every language must answer: **when `Person.greet()` runs, in what order do `Polite`, `Loud`, `Base` participate?**

---

## 2. Scala: traits + linearization

Scala `trait`s are mixins (they can hold state, unlike formal traits). Conflicts are resolved by **linearization** — a deterministic total order computed from the inheritance graph. The rule: *right-most trait wins, and `super` walks left along the linear order.*

```scala
trait Base { def greet: String = "base" }
trait Polite extends Base { override def greet: String = "please-" + super.greet }
trait Loud   extends Base { override def greet: String = "HEY-"    + super.greet }

class Person extends Polite with Loud
// linearization of Person:  Person -> Loud -> Polite -> Base -> AnyRef -> Any
new Person().greet   // "HEY-please-base"
```

Read the linearization right-to-left as written but the *resolved order* is: the **last** mixin (`Loud`) is most specific, so `Person.greet` enters `Loud.greet`. `Loud`'s `super.greet` does **not** go to `Base` directly — it goes to the *next trait in the linearization*, which is `Polite`. `Polite`'s `super.greet` then reaches `Base`. Hence `"HEY-" + "please-" + "base"`.

The crucial insight: in Scala, `super` inside a trait means **"the next thing in the linearization,"** not "my declared parent". This is what makes *stackable modifications* possible — and what surprises people who read `super` as "the literal superclass". Swap the mixin order and the output changes:

```scala
class Person2 extends Loud with Polite   // linearization: Person2 -> Polite -> Loud -> Base
new Person2().greet   // "please-HEY-base"
```

Same traits, different order, different result. **Linearization makes order significant.**

### Computing a Scala linearization by hand

The algorithm: `lin(C) = C, then lin(parentN), ..., lin(parent1)` with duplicates removed *keeping the right-most occurrence*. For `Person extends Polite with Loud`:

```
lin(Base)   = [Base, AnyRef, Any]
lin(Polite) = [Polite] ++ lin(Base)          = [Polite, Base, AnyRef, Any]
lin(Loud)   = [Loud]   ++ lin(Base)          = [Loud, Base, AnyRef, Any]
lin(Person) = [Person] ++ lin(Loud) ++ lin(Polite),  right-most-wins dedup
            = [Person, Loud, Polite, Base, AnyRef, Any]
```

That linear chain is exactly the `super` walk.

---

## 3. Python: multiple base classes + C3 MRO

Python allows true MI (state and all) and computes a **Method Resolution Order** with the *C3 linearization* algorithm (adopted in Python 2.3). Every class exposes its MRO:

```python
class Base:
    def greet(self): return "base"
class Polite(Base):
    def greet(self): return "please-" + super().greet()
class Loud(Base):
    def greet(self): return "HEY-" + super().greet()
class Person(Polite, Loud):
    pass

Person.__mro__
# (Person, Polite, Loud, Base, object)
Person().greet()   # "please-HEY-base"
```

Here `super()` in `Polite.greet` does **not** call `Base` — it calls the *next class in `Person`'s MRO*, which is `Loud`. This is "cooperative multiple inheritance": each method calls `super()` and the MRO threads them. Note Python lists parents left-to-right as *most* specific first (`Polite` before `Loud`), the reverse of how Scala *writes* mixins — same idea, opposite text direction.

### Computing C3 by hand

C3 merges parent MROs subject to two constraints: a class precedes its parents (monotonicity), and the relative order of parents in a `bases` list is preserved. Notation: `L[C] = C + merge(L[P1], ..., L[Pn], [P1, ..., Pn])`. The `merge` repeatedly takes the head of the first list that does *not* appear in the *tail* of any other list:

```
L[Base]   = [Base, object]
L[Polite] = [Polite, Base, object]
L[Loud]   = [Loud, Base, object]
L[Person] = Person + merge([Polite,Base,object], [Loud,Base,object], [Polite,Loud])
          = Person + Polite + merge([Base,object], [Loud,Base,object], [Loud])
          = Person + Polite + Loud + merge([Base,object], [Base,object], [])
          = Person + Polite + Loud + Base + object
          = [Person, Polite, Loud, Base, object]
```

`Base` is *not* taken early even though it's the head of the first list — it appears in the tail of `[Loud, Base, object]`, so C3 defers it until after `Loud`. **That deferral is the whole point of C3: a shared base is visited once, after all its children.** This is precisely how Python avoids the state diamond's double-visit while still calling each override once.

C3 can *fail*: if the constraints are contradictory, Python raises `TypeError: Cannot create a consistent method resolution order`. We show that failure in [find-bug.md](find-bug.md).

---

## 4. Ruby: modules mixed in, ancestor chain

Ruby has single class inheritance plus **module mixins** via `include`. The resolution order is the *ancestor chain*, and the rule is **last `include` wins** (it's inserted just above the class in the chain):

```ruby
module Base   def greet; "base"; end end
module Polite def greet; "please-" + super; end end
module Loud   def greet; "HEY-"    + super; end end

class Person
  include Base
  include Polite
  include Loud
end

Person.ancestors   # [Person, Loud, Polite, Base, Object, ...]
Person.new.greet   # "HEY-please-base"
```

`include Loud` last puts `Loud` closest to `Person`, so `Loud.greet` runs first; its `super` walks down the ancestor chain to `Polite`, then `Base`. Same result as Scala's `extends Polite with Loud` — because "last include wins" and "right-most mixin wins" are the same rule spelled differently. Ruby also has `prepend` (insert *below* the class) and `extend` (mix into the singleton/metaclass), which let you wrap a method *around* the class's own definition.

---

## 5. C++: real MI, and the `virtual` base

C++ allows inheriting full classes — state included — from multiple parents. Without help, the diamond duplicates the base:

```cpp
struct Base { int id; };
struct Polite : Base { };
struct Loud   : Base { };
struct Person : Polite, Loud { };   // Person has TWO Base subobjects

Person p;
// p.id;            // error: ambiguous — Polite::Base::id or Loud::Base::id?
p.Polite::id = 1;   // must qualify which Base
p.Loud::id   = 2;   // a different field!
```

`Person` literally contains two `Base` subobjects with two `id` fields. To get the shared-base behavior you must declare the inheritance `virtual`:

```cpp
struct Polite : virtual Base { };
struct Loud   : virtual Base { };
struct Person : Polite, Loud { };   // ONE shared Base subobject

Person p; p.id = 1;   // unambiguous now
```

`virtual` inheritance costs a per-object pointer to locate the shared subobject and a special constructor-ordering rule (the *most-derived* class, `Person`, is responsible for constructing the virtual `Base`, not the intermediate classes). This machinery is exactly the complexity Java refused — see [senior.md](senior.md).

---

## 6. Java: the deliberate non-linearization

Java's contrast with all four above is sharp: **there is no automatic order.** When two unrelated defaults collide, Java does not silently pick the "last" one — it fails to compile and demands an explicit choice:

```java
interface Polite { default String greet() { return "please"; } }
interface Loud   { default String greet() { return "HEY"; } }

class Person implements Polite, Loud {                 // compile error
    // error: class Person inherits unrelated defaults for greet()
    //        from types Polite and Loud
}
```

You must override:

```java
class Person implements Polite, Loud {
    @Override public String greet() {
        return Loud.super.greet() + "-" + Polite.super.greet();   // YOU choose the order
    }
}
```

Java *does* have an automatic rule for one case only: **"more specific interface wins"** when one interface extends the other. If `B extends A` and both supply `greet()`, `B`'s default wins with no error — because there *is* a clear specificity order. But for *unrelated* interfaces there is no order, and Java will not invent one. The full resolution algorithm (classes-win, more-specific-wins, otherwise-conflict) is detailed in the sibling topic [../05-default-methods-and-diamond-problem/](../05-default-methods-and-diamond-problem/).

---

## 7. The mapping table: foreign construct → Java equivalent

| Foreign construct                       | Closest Java construct                          | What you lose |
| --------------------------------------- | ----------------------------------------------- | ------------- |
| Scala `trait` (stateless)               | interface + default methods                     | linearization (must resolve by hand) |
| Scala `trait` with `val`/`var`          | interface + default methods + **a field in the class** or a delegate | shared state must move to the class |
| Ruby `module` mixin                     | interface + default methods                     | `super`-chaining, `prepend` wrapping |
| Python mixin base class                 | interface + default methods, or abstract class  | MI of state; cooperative `super()` |
| C++ non-virtual MI base                 | single superclass + composition (delegate field)| second base's state moves to a field |
| C++ `virtual` base (shared)             | single superclass; share via composition        | implicit shared-base machinery |

The recurring theme: **everything Java lacks is the *state* and the *automatic ordering*.** Whenever a foreign feature needs either, the Java translation pushes that state into a field (composition) and makes the order explicit (override + `X.super.m()`).

---

## 8. Stackable behavior in Java without linearization

Scala/Python/Ruby get "stackable modifications" for free from the linear `super` chain. Java can approximate it with explicit chaining or with the **decorator pattern** over composition:

```java
interface Greeter { String greet(); }

// each "modifier" wraps the next — explicit, no hidden order
record Politely(Greeter inner) implements Greeter {
    public String greet() { return "please-" + inner.greet(); }
}
record Loudly(Greeter inner) implements Greeter {
    public String greet() { return "HEY-" + inner.greet(); }
}

Greeter g = new Loudly(new Politely(() -> "base"));
g.greet();   // "HEY-please-base"  — the order is visible in the construction
```

This is the honest Java idiom for stackable behavior: the "linearization" becomes the *nesting order of decorators*, written out explicitly at construction. You trade Scala's concision for Java's no-surprise transparency — the order is in the code, not in a computed table.

---

## 9. Quick reference: what `super` means in each language

| Language | `super` inside a mixin/trait means…                       |
| -------- | -------------------------------------------------------- |
| Scala    | next type in the **linearization**                        |
| Python   | next class in the **MRO** (not the literal base)          |
| Ruby     | next module/class in the **ancestor chain**               |
| C++      | a *named* base — you write `Base::m()`, no implicit chain  |
| Java     | `Interface.super.m()` — a **named** direct superinterface  |

Scala/Python/Ruby `super` is *dynamic over a linear order*; C++/Java `super` is *static and named*. That single difference explains most cross-language porting bugs: code that relies on the implicit chain breaks when ported to a named-super language, and vice versa.

---

## 10. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Why state MI is genuinely hard; trait calculus; FBCP, init order   | `senior.md`        |
| Review patterns, ArchUnit, mixin-abuse detection                   | `professional.md`  |
| JLS, Schärli 2003, Scala spec, C3 paper                            | `specification.md` |
| Diamond/linearization-surprise snippets                            | `find-bug.md`      |
| Mixin-by-interface vs delegation cost                              | `optimize.md`      |
| Implement a Java mixin; read an MRO                                | `tasks.md`         |
| Interview Q&A                                                      | `interview.md`     |

---

**Memorize this:** the four "automatic" languages compute a linear order — Scala *linearization*, Python *C3 MRO*, Ruby *ancestor chain*, all making `super` mean "the next thing in that order" — so mixin **order is significant** and a shared base is visited once. C++ allows true state MI and needs `virtual` bases to dedupe. Java alone refuses to linearize unrelated parents: it has no automatic order, demands explicit `X.super.m()` resolution, and pushes any shared *state* into a field. To port a linearized mixin into Java, make the order explicit (override or decorators) and move the state into composition.
