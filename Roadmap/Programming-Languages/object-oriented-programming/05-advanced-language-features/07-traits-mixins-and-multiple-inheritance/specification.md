# Traits, Mixins and Multiple Inheritance — Specification Reading Guide

> This topic spans a *language feature* (Java's interface inheritance and default methods, fixed by the JLS) and a *body of programming-language research* (the trait calculus, the C3 linearization algorithm, Scala's linearization rule, C++'s `virtual` base semantics). This file maps each claim — "Java forbids state MI", "more-specific interface wins", "Scala right-most trait wins", "Python uses C3", "traits are stateless by definition" — to the canonical text that pins it down. For the Java *mechanics* of default-method resolution, the authoritative companion is the sibling topic [../05-default-methods-and-diamond-problem/specification.md](../05-default-methods-and-diamond-problem/specification.md); this guide stays at the cross-language / design-theory altitude.

---

## 1. Where to find the canonical text

| Concept                                                          | Authoritative source                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| Single class inheritance (`extends` takes one class)             | **JLS §8.1.4** — *Superclass and Subclasses*               |
| Multiple interface inheritance (`implements` takes many)         | **JLS §8.1.5** — *Superinterfaces*                         |
| Interface method declarations, `default`                         | **JLS §9.4** — *Method Declarations*                       |
| Inheritance/overriding among interface methods (more-specific wins) | **JLS §9.4.1** — *Inheritance and Overriding*           |
| "Classes win" over interface defaults                            | **JLS §8.4.8** — *Inheritance, Overriding, and Hiding*     |
| Maximally-specific method (formalizes "more specific wins")      | **JLS §15.12.2.5** — *Choosing the Most Specific Method*   |
| Unrelated-default conflict → must override                       | **JLS §8.4.8.4** — *Override-Equivalent Signatures*        |
| `Interface.super.method()` syntax                                | **JLS §15.12.1** / **§15.12.3**                            |
| No instance fields on interfaces (only `static final` constants) | **JLS §9.3** — *Field (Constant) Declarations*             |
| Trait calculus (formal definition of a trait)                    | **Schärli, Ducasse, Nierstrasz, Black (ECOOP 2003)**       |
| Scala linearization                                              | **Scala Language Specification §5.1.2** — *Class Linearization* |
| Python C3 method resolution order                                | **Barrett et al. (1996)** + **Python docs / van Rossum essay** |
| C++ multiple & virtual inheritance                               | **ISO/IEC 14882 §11.7** (*Multiple base classes*, *Virtual base classes*) |

The JLS binds `javac`; the research papers and the Scala/Python specs bind the *other* languages this topic compares against. Java's stance is best understood as a *design choice among* the options these documents formalize.

---

## 2. JLS §8.1.4–§8.1.5 — one class, many interfaces

§8.1.4 states a class declaration's `extends` clause names **at most one** direct superclass. §8.1.5 states the `implements` clause may name **any number** of direct superinterfaces. Together these encode the core fact of this topic:

> Java permits multiple inheritance of **interface type** (§8.1.5) but only single inheritance of **class** (§8.1.4).

Because only classes carry instance fields (§9.3 forbids them on interfaces), single class inheritance is *also* single **state** inheritance. The "no multiple state inheritance" rule is therefore not a standalone clause — it is the *consequence* of §8.1.4 (one superclass) combined with §9.3 (no interface fields). This is worth knowing: when asked "where in the spec does it say Java has no MI of state?", the answer is "nowhere directly — it follows from §8.1.4 ∧ §9.3."

---

## 3. JLS §9.3 — why interfaces hold no state

§9.3 says every field declared in an interface body is implicitly `public static final`. There is **no syntax** for an instance field in an interface. This is the spec-level load-bearing constraint behind the whole topic:

```java
public interface Counter {
    int count = 0;           // §9.3: implicitly public static final — a CONSTANT, shared, not per-instance
    // int n;                // not legal: interfaces have no instance fields
}
```

Because `count` is `static final`, it is one value shared by the entire program, not per-object state. It cannot participate in object layout, so it cannot create a state diamond. Default methods (§9.4) added *behavior* on top of this without touching §9.3 — which is exactly why they are the *trait* (stateless) form of mixin and not full multiple inheritance.

---

## 4. JLS §9.4.1 + §8.4.8 — the resolution rules (summary)

The full algorithm is treated in the sibling topic; the cross-language-relevant summary:

- **§8.4.8 (Rule 1, "classes win"):** a class method overrides any interface default with an override-equivalent signature. Interface defaults are reached only when nothing class-side claims the signature.
- **§9.4.1 / §15.12.2.5 (Rule 2, "more specific wins"):** when interface `B extends A` and both declare a default `m`, `B`'s is *maximally specific* and is inherited; no conflict.
- **§8.4.8.4 (Rule 3, "must override"):** when two *unrelated* interfaces supply override-equivalent defaults and neither is more specific, the class **must** override `m` or it is a compile-time error.

The contrast with the other languages is *exactly* Rule 3. Where Scala/Python/Ruby resolve the unrelated case automatically via a linear order, the JLS makes it a **compile-time error** demanding explicit resolution. The spec is choosing *programmer disambiguation over implicit ordering* — the language-design decision this whole topic is about.

```java
interface A { default int m() { return 1; } }
interface B { default int m() { return 2; } }
class C implements A, B { }   // §8.4.8.4: compile error — must override m()
```

---

## 5. JLS §15.12.1 / §15.12.3 — `Interface.super.method()`

The disambiguation syntax is grammar from §15.12. `T.super.Identifier(...)` requires that `T` be a **direct** superinterface of the type being compiled, and binds *statically* to the method declared in `T`. This is the spec mechanism that lets Java resolve a behavior diamond *without* a linearization: instead of an implicit "next in order", you name the exact superinterface.

The deep point for this topic: §15.12.1's "direct superinterface only" constraint is what *prevents* Java from having a `super`-chain like Scala/Python. You cannot reach a grand-superinterface's default through the chain — you name a direct one. There is no order to walk because there is no chain. (Mechanics and the `invokespecial` lowering are in the sibling topic.)

---

## 6. Schärli, Ducasse, Nierstrasz & Black (2003) — the trait calculus

**"Traits: Composable Units of Behaviour"**, ECOOP 2003 (Springer LNCS 2743). The paper that formally separates *trait* from *mixin* from *multiple inheritance*. Its definition of a trait, and the three properties relevant here:

1. **A trait provides and requires methods but defines no state.** State lives in the composing class.
2. **The flattening property:** a class using a trait is semantically equivalent to the same class with the trait's methods inlined. Traits add *no* new dispatch semantics — no implicit `super` chain.
3. **Conflicts are resolved by the composing class** (via override, *aliasing*, or *exclusion*), never by an automatic linear order.

Map this onto Java: default-method interfaces satisfy (1) (§9.3 — no state) and (3) (§8.4.8.4 — must override unrelated conflicts) and approximately (2) (a default is a normal inherited method). Java lacks the paper's *aliasing* and *exclusion* operators, so it is "traits minus rename/exclude". The paper is the canonical justification for calling Java default-method interfaces *traits* rather than *mixins*, and for calling Scala `trait`s *mixins* (they hold state and linearize, violating (1) and (2)).

Companion reading: **Ducasse, Nierstrasz, Schärli, Wuyts, Black, "Traits: A Mechanism for Fine-grained Reuse"** (ACM TOPLAS 28(2), 2006) — the journal-length treatment with the full calculus and the Smalltalk implementation.

---

## 7. Scala Language Specification §5.1.2 — class linearization

The Scala spec defines **linearization** as a total order over a class and all its mixed-in traits. The rule (paraphrased from §5.1.2):

> `L(C)` = `C` concatenated with the linearizations of its parents, taken **right to left**, with all but the **last** (right-most) occurrence of each class removed.

This is the formal statement of "right-most trait wins" and of "`super` in a trait means the next type in `L(C)`". The spec's worked examples mirror [middle.md](middle.md) §2. Critically, the spec makes order *significant*: `A with B` and `B with A` produce different linearizations and thus different behavior — a property the JLS deliberately does not have.

---

## 8. Python C3 — Barrett et al. (1996) and the language docs

The C3 algorithm originated in **Barrett, Cassels, Haahr, Moon, Playford, Withington, "A Monotonic Superclass Linearization for Dylan"** (OOPSLA 1996). Python adopted it for new-style classes in **Python 2.3**; the canonical Python writeup is **Guido van Rossum, "The Python 2.3 Method Resolution Order"** (python.org essay), and the language reference at `docs.python.org` ("The Python Language Reference" → data model → `__mro__`).

C3 guarantees three properties the paper proves:

1. **Consistency with the local precedence order** — a class's direct bases keep their listed order.
2. **Monotonicity** — a class always precedes its parents, and the MRO of a subclass is consistent with the MRO of each parent.
3. **Existence is not guaranteed** — if (1) and (2) conflict, C3 *fails* and Python raises `TypeError` at class-creation time. (This non-existence is the [find-bug.md](find-bug.md) failure case.)

The merge step ("take the head of the first list not appearing in the tail of any other") is the operational core; [middle.md](middle.md) §3 works it by hand.

---

## 9. ISO/IEC 14882 §11.7 — C++ multiple and virtual base classes

The C++ standard (§11.7, *Multiple base classes*, and the virtual-base subclause) defines:

- A class may have **multiple direct base classes**, each contributing a *base class subobject* — including its state.
- A non-virtual diamond produces **multiple subobjects** of the shared base (the duplicated-`id` example in [middle.md](middle.md) §5); member access is *ambiguous* and must be qualified.
- A **virtual base** (`: virtual Base`) is shared: exactly one subobject regardless of how many paths reach it, located via an implementation-defined mechanism (typically a virtual-base pointer). The **most-derived** object is responsible for initializing each virtual base; intermediate mem-initializers for a virtual base are ignored when the class is used as an intermediate.

This subclause is the formal source for the "cost of `virtual` inheritance" claims in [senior.md](senior.md) §3 — extra indirection, the most-derived-initializes rule, and the layout complexity Java chose to avoid.

---

## 10. Cross-spec interactions worth knowing

- **Sealed interfaces (JLS §9.1.1.4)** + defaults: a closed implementor set bounds the fragile-base risk of shared behavior; the safest place to put default-method "traits". See [../01-sealed-classes-and-pattern-matching/specification.md](../01-sealed-classes-and-pattern-matching/specification.md).
- **Records (JLS §8.10)** + defaults: a record's accessor *overrides* a same-named default (Rule 1, classes win — §8.10.3), the common idiom for satisfying a trait's required hook.
- **Class initialization (JLS §12.4)**: single class inheritance means a single, linear superclass-initialization chain — the property that multiple state inheritance would shatter. See [../06-class-loading-and-initialization/](../06-class-loading-and-initialization/).
- **Kotlin** resolves interface-default conflicts with an explicit `super<Interface>.m()` — the same "name the interface" choice as Java, *not* linearization. Good evidence the Java approach is a considered design, not an accident.

---

## 11. Reading list

1. **JLS §8.1.4 / §8.1.5** — one superclass, many superinterfaces (the core of Java's MI stance).
2. **JLS §9.3** — interface fields are `static final` constants; the spec basis for "no state in interfaces".
3. **JLS §9.4.1, §8.4.8, §8.4.8.4, §15.12.2.5** — the resolution rules; Rule 3 is the deliberate "no auto-linearization" choice.
4. **JLS §15.12.1 / §15.12.3** — `Interface.super.method()`; direct-superinterface-only constraint.
5. **Schärli, Ducasse, Nierstrasz, Black (ECOOP 2003)** — *Traits: Composable Units of Behaviour*. The formal trait definition; flattening; explicit conflict resolution.
6. **Ducasse et al. (ACM TOPLAS 28(2), 2006)** — the journal-length trait calculus.
7. **Scala Language Specification §5.1.2** — *Class Linearization*. "Right-most wins", `super` over the linear order.
8. **Barrett et al. (OOPSLA 1996)** — *A Monotonic Superclass Linearization for Dylan*. The C3 algorithm and its monotonicity proof.
9. **van Rossum, "The Python 2.3 Method Resolution Order"** (python.org) — C3 as Python adopted it.
10. **ISO/IEC 14882 §11.7** — C++ multiple base classes and virtual bases; the cost model.
11. **Bracha & Cook, "Mixin-Based Inheritance"** (OOPSLA 1990) — the foundational formalization of *mixins* (the broader category traits refine).
12. **Bloch, *Effective Java* (3e), Items 18–22** — favor composition over inheritance; interfaces over abstract classes; the practitioner's distillation of when behavior inheritance pays off.
13. **Stroustrup, *The Design and Evolution of C++* (1994), ch. 12** — why C++ has MI and what it cost; the cautionary history Java reacted against.

The spec text constrains Java; the papers explain the *space of choices* Java picked from. When a coworker argues "Java should just add linearization like Scala", §8.4.8.4 (Java chose explicit) and Schärli 2003 (flattening over hidden semantics) are the citations for why the explicit choice is defensible — and the Scala §5.1.2 / C3 monotonicity proofs show exactly what convenience, and what fragility, automatic linearization buys.
