# Traits, Mixins and Multiple Inheritance — Junior

> **What?** *Multiple inheritance* (MI) is when one type inherits from more than one parent. There are three different things you might inherit: **state** (fields), **behavior** (method bodies), and **type** (the "is-a" contract). Different languages allow different combinations. *Traits* and *mixins* are disciplined forms of behavior-and-type inheritance designed to avoid the classic failure mode — the **diamond problem**.
> **How?** Java forbids inheriting *state* from more than one parent (single class inheritance) but *allows* inheriting type and behavior from many `interface`s via default methods. Other languages make other choices: C++ allows full MI with `virtual` base classes, Scala has `trait`s with *linearization*, Ruby has `module`s mixed in, Python resolves multiple parents with the *C3* algorithm. This topic is the map across all of them, anchored on the Java reality.

---

## 1. Three things "inheritance" can mean

When we say a class "inherits" from a parent, we are quietly bundling three separate things:

| Inherited        | What it is                                  | Java single-class? | Java interface? |
| ---------------- | ------------------------------------------- | ------------------ | --------------- |
| **Type**         | the "is-a" relationship; usable where the parent is expected | yes | **yes (many)** |
| **Behavior**     | reusable method bodies                       | yes | **yes (default methods)** |
| **State**        | instance fields, the object's memory layout  | yes | **no** |

The whole story of multiple inheritance is which of these three a language lets you have from *more than one* parent. Keep this table in your head. Almost every confusing question ("why does Java allow multiple interfaces but not multiple superclasses?") dissolves once you separate the three.

Java's answer: **one parent for state, many parents for type and behavior.** That single design decision is what this topic explains.

---

## 2. The diamond problem in one picture

Suppose `A` defines something, and `B` and `C` both inherit from `A` and modify it, and then `D` inherits from both `B` and `C`:

```
      A
     / \
    B   C
     \ /
      D
```

The shape is a diamond. The question is: when `D` uses the thing from `A`, *which path wins* — `B`'s version or `C`'s? And if the thing is *state* (a field), does `D` get **one** copy of `A`'s field or **two**?

- For **state**, two copies is usually a bug: `D` has two `A`-fields that can disagree. This is the hard part of MI and why Java bans it.
- For **behavior**, you need a *rule* to pick a method when both paths supply one.

Every language that allows any form of MI has to answer the diamond question. The rest of this file is "how each one answers it".

---

## 3. Java's answer: single class, many interfaces

A Java class has exactly one direct superclass (`extends`), but can implement any number of interfaces (`implements`):

```java
public class ArrayList<E>
        extends    AbstractList<E>                       // one class
        implements List<E>, RandomAccess, Cloneable, Serializable {  // many interfaces
}
```

`AbstractList` carries *state* (the `modCount` field, for example). The four interfaces carry *type* and — since Java 8 — *behavior* via default methods, but **no state**. Because only the single superclass contributes fields, there is never a "two copies of a field" diamond. Java sidestepped the hard half of MI by simply forbidding it.

This is the central fact: **Java allows multiple inheritance of type and behavior, but never of state.**

---

## 4. Default methods make interfaces a "restricted mixin"

Before Java 8 an interface was pure type — every method abstract, no bodies. Java 8 added *default methods*: interface methods with a body.

```java
public interface Comparable<T> {
    int compareTo(T o);
}

public interface Sized {
    int size();
    default boolean isEmpty() { return size() == 0; }   // behavior, inherited
}
```

Now an interface can ship reusable behavior. A class that implements `Sized` gets `isEmpty()` for free. This is exactly what a *mixin* is in other languages — a bundle of behavior you mix into a class — except Java's version is *restricted*: it can carry behavior and type, but **still no state**. (The deep mechanics of default-method conflict resolution live in the sibling topic [../05-default-methods-and-diamond-problem/](../05-default-methods-and-diamond-problem/); here we stay at the cross-language altitude.)

---

## 5. What a trait and a mixin actually are

The words get used loosely. The precise distinctions:

- **Mixin** — a class-like unit of *behavior* designed to be "mixed into" other classes, contributing methods (and sometimes state). Ruby `module`s and Python multiple-base classes are mixins. The name comes from Flavors/CLOS in the 1980s; the metaphor is mixing flavors into ice cream.
- **Trait** — a *stateless* unit of behavior, formally defined by Schärli, Ducasse, Nierstrasz & Black (2003) as "composable units of behaviour". A trait provides and requires methods but holds **no state** and imposes **no ordering** — conflicts are resolved explicitly by the composing class, not by a linearization rule. This is a deliberately stricter, more predictable thing than a mixin.
- **Multiple inheritance (MI)** — the raw language feature of inheriting from several full classes, *including their state*. C++ is the canonical example.

So: traits ⊂ mixins ⊂ multiple-inheritance, in order of increasing power and decreasing safety. **Java's default-method interfaces are closest to the original *trait* definition** — stateless, behavior-only, explicit conflict resolution. (Confusingly, *Scala* calls its construct `trait`, but Scala traits *can* hold state and *do* use a linearization rule, so they are really mixins by the formal definition.)

---

## 6. How five languages solve the diamond

| Language | MI of state? | MI of behavior? | Diamond resolution |
| -------- | ------------ | --------------- | ------------------ |
| **C++**    | yes (with `virtual` base to dedupe) | yes | programmer picks `virtual` inheritance to share the base; else ambiguity error |
| **Scala**  | yes (traits with `val`/`var`) | yes (`trait`) | **linearization** — a deterministic total order over all mixed-in traits |
| **Ruby**   | no (modules are stateless-ish) | yes (`module` mixin) | **ancestor chain** — later `include` wins, `super` walks the chain |
| **Python** | yes (classes) | yes | **C3 linearization (MRO)** — a computed method resolution order |
| **Java**   | **no** | yes (default methods) | **explicit** — class must override and call `X.super.m()` |

Notice the split: Scala, Ruby and Python pick a winner *automatically* via a linear order; Java and C++ make the programmer *choose*. Automatic resolution is convenient but can surprise you (you get a method you didn't expect); explicit resolution is verbose but never surprises. Java deliberately chose the never-surprise route.

---

## 7. The Java conflict: two defaults collide

When a class inherits two unrelated default methods with the same signature, Java refuses to pick:

```java
public interface Walker { default String move() { return "walk"; } }
public interface Swimmer { default String move() { return "swim"; } }

public class Duck implements Walker, Swimmer { }   // compile error: must override move()
```

The compiler error names both candidates. You resolve it by overriding and choosing a path with `Interface.super.method()`:

```java
public class Duck implements Walker, Swimmer {
    @Override public String move() {
        return Walker.super.move() + "/" + Swimmer.super.move();   // "walk/swim"
    }
}
```

`Walker.super.move()` means "the `move` default declared on `Walker`". This is Java's whole answer to the behavior diamond: *make the programmer disambiguate explicitly*. Contrast Scala, where the linearization rule would silently pick the rightmost trait.

---

## 8. Why Java forbids state MI specifically

The state diamond is the genuinely hard problem, and the reason is *object layout and initialization*:

- If `Duck` could inherit a field `energy` from both `Walker` and `Swimmer`, does the object have one `energy` slot or two? One means they share (which path initializes it?); two means the object silently has two values for "the same" field.
- Constructors compound it: each parent's constructor wants to initialize its own state, in some order. With a diamond, `A`'s constructor could run once (shared) or twice (duplicated) — both are surprising.

C++ "solves" this with `virtual` inheritance, which costs a layer of indirection (a vtable-like pointer to the shared base) and a notoriously confusing constructor-ordering rule. Java's designers looked at that complexity and decided the cost wasn't worth it: **forbid multiple state inheritance entirely, and you never have a state diamond.** Interfaces carry no fields, so implementing twenty interfaces still gives you exactly one object layout — the one from your single superclass.

This is why default methods were *allowed* but interface fields were *not*: behavior reuse is safe to share; state is not.

---

## 9. Simulating a mixin in Java

You don't have real mixins, but you can fake the common case — a reusable capability — with an interface + default methods that delegate to a small required method:

```java
public interface Timestamped {
    Instant createdAt();                                // the one required hook

    default Duration age() {                            // free behavior
        return Duration.between(createdAt(), Instant.now());
    }
    default boolean olderThan(Duration d) {
        return age().compareTo(d) > 0;
    }
}

public record Order(String id, Instant createdAt) implements Timestamped { }

new Order("A1", Instant.now().minusSeconds(60)).olderThan(Duration.ofSeconds(30));  // true
```

`Order` "mixes in" timestamp behavior by implementing one interface and supplying one field-backed accessor. When the capability genuinely needs its own *state*, the interface trick stops working and you reach for **composition** instead — hold a helper object as a field and delegate to it. That trade-off (mixin-by-interface vs delegation) is the subject of [optimize.md](optimize.md), and the broader principle is [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/).

---

## 10. Common newcomer confusions

**"Interfaces give multiple inheritance, so Java has MI."** Half true. Java has MI of *type* and *behavior*, never of *state*. Say it precisely; the distinction is the whole topic.

**"Default methods are dangerous like C++ MI."** No — they are the *safe* subset. No state means no state diamond; explicit `X.super.m()` resolution means no silent winner. The dangerous part of MI was always the state and the implicit ordering, and Java has neither.

**"Scala traits are the same as Java interfaces."** Not quite. Scala traits can hold state and resolve conflicts by *linearization* (an automatic order). Java interface defaults hold no state and resolve conflicts by *explicit override*. Scala traits are mixins; Java defaults are traits in the formal sense.

**"The diamond is about methods."** The *hard* diamond is about state. The method diamond is annoying but solvable by any "pick a winner" rule. The state diamond is what made C++ MI infamous.

---

## 11. Quick rules

- [ ] Separate the three inheritances: **type**, **behavior**, **state**. Java gives you multiple of the first two, single of the third.
- [ ] Java has **no** multiple inheritance of state — that is why interfaces can't have instance fields.
- [ ] A Java interface with default methods is a *restricted mixin* (a formal *trait*): behavior + type, no state.
- [ ] Two conflicting defaults → override and call `X.super.m()`. Java never picks for you.
- [ ] Scala/Ruby/Python pick automatically (linearization / ancestor chain / C3 MRO); C++ and Java make you choose.
- [ ] To "mix in" reusable behavior in Java, use an interface + defaults over a small required hook. When the capability needs *state*, switch to composition — see [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/).

---

## 12. What's next

| Topic                                                                       | File              |
| --------------------------------------------------------------------------- | ----------------- |
| Real Scala linearization, Ruby ancestor chains, Python C3 MRO worked out    | `middle.md`        |
| Why state MI is hard; C++ virtual bases; the trait calculus; FBCP overlap   | `senior.md`        |
| Review vocabulary, ArchUnit, spotting "interface-as-mixin" abuse            | `professional.md`  |
| JLS §9.4 / §8.4.8, Schärli 2003, Scala spec, C3 (Barrett et al.)            | `specification.md` |
| Diamond/linearization-surprise snippets across languages                    | `find-bug.md`      |
| Mixin-by-interface vs delegation: cost and clarity                          | `optimize.md`      |
| Implement a Java mixin; read an MRO by hand                                 | `tasks.md`         |
| Interview Q&A                                                               | `interview.md`     |

---

**Memorize this:** "inheritance" bundles three things — **type, behavior, state**. Multiple inheritance is about which of them you can have from many parents. Java allows multiple type and behavior (interfaces + default methods) but **never state** — which is exactly why there is no state diamond to solve. Default-method interfaces are Java's *restricted mixin* / formal *trait*: stateless behavior with explicit `X.super.m()` conflict resolution. Other languages (C++ virtual bases, Scala linearization, Ruby modules, Python C3 MRO) allow more and resolve diamonds differently — automatically, which is convenient but can surprise.
