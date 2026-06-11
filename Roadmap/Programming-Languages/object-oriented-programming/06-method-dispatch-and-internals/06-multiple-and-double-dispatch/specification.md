# Multiple & Double Dispatch — Specification Reading Guide

> Java's single-dispatch model and static overload resolution are defined precisely by the JLS (what `javac` does) and the JVMS (what the runtime does). The Visitor pattern is canon from Gang of Four. Multiple dispatch is defined by the CLOS, Clojure, and Julia language specs. This file maps every claim in the topic to its authoritative source, with the exact sections to read.

---

## 1. Where to find the canonical text

| Concept                                                       | Authoritative source                                  |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| Method invocation expressions (the whole pipeline)            | **JLS §15.12**                                         |
| **Compile-time** step: determine method signature            | **JLS §15.12.1 – §15.12.3**                            |
| Phase 1/2/3 applicability (strict / loose / variable arity)   | **JLS §15.12.2.2 / .3 / .4**                           |
| Choosing the **most specific** method                         | **JLS §15.12.2.5**                                     |
| **Run-time** step: which body actually runs                   | **JLS §15.12.4** (esp. §15.12.4.4 *Locate Method*)    |
| Overloading is resolved using compile-time types              | **JLS §15.12.2** (entirely static)                    |
| Overriding (dynamic, single dispatch)                         | **JLS §8.4.8**, **JVMS §5.4.5 / §5.4.6**              |
| `invokevirtual` / `invokeinterface` selection                 | **JVMS §6.5**, **§5.4.6**                              |
| `instanceof` and type patterns                                | **JLS §15.20.2**, **JLS §14.30** (patterns)           |
| `switch` with pattern labels, exhaustiveness                  | **JLS §14.11.1**, **§14.30**, **§15.28** (Java 21)    |
| Record patterns / deconstruction                              | **JLS §14.30.1** (Java 21, JEP 440)                   |
| Sealed classes / interfaces                                   | **JLS §8.1.1.2**, **§9.1.1.4**                        |
| `typeSwitch` bootstrap                                        | `java.lang.runtime.SwitchBootstraps` Javadoc          |
| `invokedynamic` mechanics                                     | **JVMS §6.5.invokedynamic**, **§5.4.3.6**             |
| Visitor pattern (double dispatch)                             | **GoF**, *Design Patterns* (1994), pp. 331–349        |
| Multiple dispatch (multimethods)                              | **CLOS spec** (ANSI Common Lisp, §7); Julia manual    |

The split to internalize: **JLS §15.12.2 is purely static** (overload resolution by compile-time types) and **JLS §15.12.4 is the only dynamic step** (selecting the override on the *single* receiver). There is no JLS step that dispatches on argument runtime types — that absence *is* single dispatch.

---

## 2. JLS §15.12 — the two-stage method-call model

§15.12 splits every call `target.m(args)` into:

1. **Compile-time declaration determination (§15.12.1–§15.12.3).** `javac` finds the *single* method declaration the call refers to, using the **static types** of `target` and every `arg`. This is overload resolution. Its output is frozen into the constant-pool `Methodref` / `InterfaceMethodref`.
2. **Run-time method selection (§15.12.4).** At execution, the JVM picks the actual body to run — but only by walking the *receiver's* runtime class for an override of the already-chosen signature (§15.12.4.4). Arguments do not participate.

This is the spec-level proof of the junior.md trap. The argument types are consumed in step 1 and *never re-examined* in step 2. Read §15.12.4.4 (*Locate Method to Invoke*) and note it takes the receiver's class and the *resolved* method — not the arguments' runtime classes.

---

## 3. JLS §15.12.2 — the three applicability phases

§15.12.2 is where "widening beats boxing beats varargs" comes from. The compiler tries, in order:

- **§15.12.2.2 — Phase 1:** applicable by *strict invocation*. Subtyping and primitive widening only; no boxing, no varargs.
- **§15.12.2.3 — Phase 2:** applicable by *loose invocation*. Adds autoboxing/unboxing. Still no varargs.
- **§15.12.2.4 — Phase 3:** applicable by *variable-arity invocation*. Adds varargs.

The compiler uses the *first* phase that finds any applicable method, then applies §15.12.2.5 to pick the most specific. Because Phase 1 excludes boxing, `g(1)` with overloads `g(long)` and `g(Integer)` resolves to `g(long)` — `long` is reachable by widening in Phase 1; `Integer` needs boxing (Phase 2) and never gets considered.

§15.12.2.5 (*Choosing the Most Specific Method*) defines "more specific" via applicability: `m1` is more specific than `m2` if every argument valid for `m1` is valid for `m2`. For reference types this means "more specific = more derived parameter type". `null` (the null type, §4.1) is a subtype of all reference types, so the *most derived* reference overload wins — and if two are incomparable, the call is *ambiguous* (a compile error), per §15.12.2.5.

---

## 4. JLS §8.4.8 + JVMS §5.4.6 — single dispatch, formally

Overriding (the *one* dynamic dispatch Java has) is defined at the source level in **JLS §8.4.8** and enforced at the JVM level in **JVMS §5.4.5 (overriding)** and **§5.4.6 (selection)**. §5.4.6 takes the *resolved* method and the *receiver's* class `C`, then walks `C` and its superclasses for an override. One class, one walk — single dispatch by construction. There is deliberately no analogous "argument selection" algorithm anywhere in the JVMS; that is why double dispatch must be *emulated*.

---

## 5. GoF Visitor — the canonical double-dispatch reference

The Gang of Four, *Design Patterns* (1994), define Visitor on pp. 331–349. Key passages to read:

- **Intent** (p. 331): "Represent an operation to be performed on the elements of an object structure. Visitor lets you define a new operation without changing the classes of the elements on which it operates."
- **"Double dispatch"** (p. 338, *Implementation* note 1): GoF explicitly name the mechanism — *"The key to the Visitor pattern is the technique called double-dispatch... the operation that gets executed depends on the type of Visitor and the type of Element it visits."* This is the canonical definition of the term.
- **Consequences** (pp. 335–337): Visitor makes adding operations easy and adding `ConcreteElement` classes hard — GoF's statement of what Wadler later named the *expression problem*.

GoF also note Visitor's central liability (p. 336): *"adding new ConcreteElement classes is hard"* because every `Visitor` subclass must gain a `Visit` method. That liability is precisely what sealed pattern switches mitigate via compiler-checked exhaustiveness.

The **Acyclic Visitor** variant is Robert C. Martin, *"Acyclic Visitor"* (in *Pattern Languages of Program Design 3*, 1997) — the source for middle.md §8.

---

## 6. JLS §14.30 / §14.11.1 / §15.28 — pattern switch (Java 21)

The modern alternative is defined across:

- **JLS §14.30 — Patterns.** Type patterns (`Circle c`) and record patterns (`Circle(var r)`). §14.30.1 covers record deconstruction (JEP 440).
- **JLS §14.11.1 — Switch labels** with pattern cases, the *dominance* rule (a more general pattern must not precede a more specific one), and the **exhaustiveness** requirement for a switch *expression* over a sealed type.
- **JLS §15.28 / §14.11** — switch *expressions* and statements with patterns (JEP 441, Java 21).

Exhaustiveness over a sealed type means: if the `switch` covers every permitted subtype, no `default` is required, and the compiler *adds* an implicit `MatchException` arm for the separate-compilation-skew case. Adding a permitted subtype later makes the switch non-exhaustive → **compile error** (the property professional.md leans on).

---

## 7. `SwitchBootstraps.typeSwitch` — how the switch lowers

A pattern switch on reference types does **not** compile to a chain of `instanceof` checks. It compiles to an `invokedynamic` whose bootstrap is `java.lang.runtime.SwitchBootstraps.typeSwitch`. From `javap -c -v`:

```
11: invokedynamic #13, 0   // InvokeDynamic #0:typeSwitch:(Ljava/lang/Object;I)I
16: lookupswitch  { 0:.. 1:.. 2:.. default:.. }

BootstrapMethods:
  0: REF_invokeStatic java/lang/runtime/SwitchBootstraps.typeSwitch:(
        Ljava/lang/invoke/MethodHandles$Lookup;Ljava/lang/String;
        Ljava/lang/invoke/MethodType;[Ljava/lang/Object;)Ljava/lang/invoke/CallSite;
    Method arguments: #22 Circle  #30 Square  #34 Group
```

The bootstrap receives the case labels (the permitted subtypes) as static arguments and returns a `CallSite` mapping the scrutinee + a starting index to an `int` result, which then drives an ordinary `lookupswitch`. Read the `SwitchBootstraps` and `java.lang.invoke.SwitchPoint`/`CallSite` Javadoc; the underlying `invokedynamic` resolution is **JVMS §6.5.invokedynamic** and **§5.4.3.6** (call-site specifier resolution).

---

## 8. CLOS — the multiple-dispatch reference

Multiple dispatch is defined in the **ANSI Common Lisp standard, Chapter 7 (Objects)**, the CLOS specification. Core concepts to read:

- **Generic functions** — a named collection of methods sharing a call protocol.
- **Methods and *specializers*** — a method may specialize on *any* required parameter; the dispatch considers all specialized parameters.
- **Method selection** — at call time, CLOS computes the *applicable* methods for the actual argument classes, sorts by specificity (a precedence ordering over the argument tuple), and invokes the most specific, with `call-next-method` to chain.

The pre-CLOS canonical text is Daniel Bobrow et al., *"Common Lisp Object System Specification"* (1988). The decoupling of *method* from *class* is the design feature that enables symmetric multiple dispatch — there is no single "owner" receiver.

---

## 9. Clojure and Julia — JVM and modern multimethods

- **Clojure** — `defmulti` / `defmethod`. The reference is the Clojure docs, *Multimethods and Hierarchies*. `defmulti` takes a *dispatch function* of all arguments returning a dispatch value; `defmethod` registers per value. Dispatch is on arbitrary values, not just types — a strict superset of type-based multiple dispatch. It runs on the JVM, proving the JVM does not *forbid* multiple dispatch; Java's language just doesn't expose it.
- **Julia** — the Julia manual, *Methods*. Multiple dispatch is the central paradigm; `f(x::T1, y::T2)` defines a method specialized on both argument types, and the runtime selects by the full argument-type tuple. Performance comes from per-tuple JIT specialization. Julia is the canonical "what Java's overloading would be if it were dynamic".
- **Groovy** — the Groovy language docs, *runtime dispatch*. Groovy resolves ordinary method overloads by **runtime** argument types by default, the inverse of Java's §15.12.2. Same JVM, opposite policy — the clean demonstration that overload-resolution timing is a language decision.

---

## 10. Reading list

1. **JLS §15.12** — method invocation. Read §15.12.2 (static overload resolution) and §15.12.4 (runtime selection) back to back; the split *is* the topic.
2. **JLS §15.12.2.2–.5** — the three applicability phases and "most specific". Internalize widening-beats-boxing-beats-varargs.
3. **JVMS §5.4.6 / §6.5** — single-dispatch selection and the `invoke*` opcodes.
4. **JLS §14.11.1, §14.30, §15.28** — pattern switch, dominance, exhaustiveness, record patterns (Java 21, JEP 440/441).
5. **JLS §8.1.1.2 / §9.1.1.4** — sealed types; the basis for exhaustiveness.
6. **`java.lang.runtime.SwitchBootstraps` Javadoc** — how a type switch actually lowers.
7. **GoF, *Design Patterns* (1994), pp. 331–349** — Visitor; p. 338 names "double-dispatch".
8. **Robert C. Martin, *"Acyclic Visitor"* (PLoPD 3, 1997)** — the decoupled variant.
9. **Philip Wadler, *"The Expression Problem"* (1998 email, widely archived)** — the framing for every Visitor-vs-switch decision.
10. **ANSI Common Lisp, Ch. 7 (CLOS)** / Bobrow et al. (1988) — the origin of multimethods.
11. **Julia manual, *Methods*** — multiple dispatch as a primary paradigm with a specializing JIT.
12. **Joshua Bloch, *Effective Java* 3e, Items 10 (`equals`/symmetry) and 52 (use overloading judiciously)** — the practitioner's distillation of the overloading trap and double-dispatch-equals hazard.

The spec sections *define* dispatch; GoF and Wadler *frame* the design choice; CLOS/Julia *show the road not taken*. When a reviewer insists `draw(s)` should pick the `Circle` overload, cite **JLS §15.12.2** — resolution is static, period. When they want exhaustiveness without `default`, cite **JLS §14.11.1** over a sealed type. When they ask "why can't Java just dispatch on both", the answer is: nothing in **JVMS §5.4.6** ever looks at an argument's runtime class.
