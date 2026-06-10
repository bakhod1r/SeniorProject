# Yo-Yo Problem — Junior

> **What?** The *Yo-Yo Problem* is the antipattern where understanding a single call requires scrolling up and down a deep inheritance chain repeatedly — like a yo-yo bouncing along the hierarchy. You read a method, find it calls `super.something()`, jump to the parent, find that calls a `protected` hook the grandchild overrides, jump back down, then back up to follow the next step. By the time you've understood `process()`, you've visited five files and you can't hold the call order in your head.
> **How?** Watch for it when a "single" behaviour is split across `AbstractFoo`, `BaseFoo`, `AbstractBaseFoo`, `DefaultFoo`, and `ConcreteFoo`. The hierarchy isn't long because the *domain* is rich — it's long because each layer overrode a different hook of a Template Method. Reading the code requires the yo-yo motion. Refactor by flattening: prefer composition over inheritance, inline trivial overrides, and keep the inheritance depth low (a rule of thumb: depth-of-inheritance-tree ≤ 3 for application code).

---

## 1. The name and the picture

The term was coined by **Taenzer, Ganti, and Podar (1989)** in their paper "Object-Oriented Software Reuse: The Yoyo Problem". The image is literal: hold the parent class in your head, scroll down to the child, scroll back up to the parent's hook, then back down to the next override. Your finger on the scroll wheel traces a yo-yo.

```
     class A                  ← step 1: process() calls validate() then doStep()
       │
       ▼
     class B extends A        ← step 2: B overrides validate(), calls super.validate() then extra checks
       │
       ▼
     class C extends B        ← step 3: C overrides doStep(), splits into pre/main/post hooks
       │
       ▼
     class D extends C        ← step 4: D overrides pre() and post()
       │
       ▼
     class E extends D        ← step 5: E overrides main() and finally returns
```

Reading `E.process()` means: `process` is in `A`, so jump to `A`; `validate` is overridden in `B`, so jump to `B`; `doStep` is overridden in `C`, so jump to `C`; the hooks `C` introduced are overridden in `D` and `E`, so jump to each in turn. Five files, one call.

---

## 2. A minimal yo-yo

Here is a five-level chain that splits a single `process()` operation across all five classes using the Template Method pattern. None of the individual classes looks bad in isolation. The aggregate does.

```java
// Level 1
public abstract class A {
    public final void process() {
        validate();
        doStep();
        finish();
    }
    protected void validate() { /* base validation */ }
    protected abstract void doStep();
    protected void finish() { /* base finish */ }
}

// Level 2
public abstract class B extends A {
    @Override protected void validate() {
        super.validate();
        validateExtra();         // new hook
    }
    protected abstract void validateExtra();
}

// Level 3
public abstract class C extends B {
    @Override protected final void doStep() {
        before();
        main();
        after();
    }
    protected abstract void before();
    protected abstract void main();
    protected abstract void after();
}

// Level 4
public abstract class D extends C {
    @Override protected void before() { /* default before */ }
    @Override protected void after()  { /* default after  */ }
    @Override protected void finish() {
        super.finish();
        cleanup();
    }
    protected abstract void cleanup();
}

// Level 5
public final class E extends D {
    @Override protected void validateExtra() { /* E's validation */ }
    @Override protected void main()          { /* E's main work  */ }
    @Override protected void cleanup()       { /* E's cleanup    */ }
}
```

To understand what happens when you call `new E().process()`, you must visit `A.process` (entry), `B.validate` (super + extra), `E.validateExtra`, `C.doStep` (template), `D.before`, `E.main`, `D.after`, `A.finish`, `D.cleanup`. That is nine hops across five files for one call.

---

## 3. Why this is bad — even when each layer is "clean"

Each class above is small. Each method has a clear name. Each override calls `super` where appropriate. A code reviewer looking at `class E` in isolation would say "fine — small, focused, follows Template Method". And yet the *cumulative* reading cost is awful:

- **High extraneous cognitive load.** Working memory holds about four items. A nine-hop trace overflows it within seconds. You forget what `before()` was supposed to do by the time you've traced `main()`.
- **Debugging is a maze.** A bug in `cleanup()` shows up at the call site of `process()`. The stack trace lists `A.process → A.finish → D.finish → D.cleanup → E.cleanup`. Finding the cause means yo-yoing through the same five files in the IDE.
- **Adding a new subclass is risky.** What hooks must you implement? Which can you leave as `super` calls? You can't tell without reading the whole tower.
- **Refactoring is paralysed.** Renaming `before()` requires checking that no level reuses the name; introducing a new hook means deciding *which* level owns it.

The classic symptom: **IDE "navigate to declaration" or "go to implementation" takes five or more hops** for a single method call. If you keep landing in another `abstract` parent, you have a yo-yo.

---

## 4. The two parents of the yo-yo: inheritance depth and Template Method overuse

The Yo-Yo Problem almost always has two contributing causes:

- **Deep inheritance.** The *Chidamber-Kemerer* DIT (Depth of Inheritance Tree) metric counts the number of ancestor classes up to `Object`. DIT > 4 in application code is a yellow flag. DIT > 6 is a red flag. The deeper the tree, the more places a `super.x()` call can hide.
- **Template Method overuse.** Template Method is a fine pattern — when it has *one* level of "abstract skeleton + concrete leaf". When the skeleton itself is split across three abstract classes, each introducing more hooks, the pattern becomes a yo-yo factory.

```java
// Template Method at one level — fine
abstract class Report {
    public final void render() { header(); body(); footer(); }
    protected void header() { }                       // optional override
    protected abstract void body();                   // must implement
    protected void footer() { }
}
class SalesReport extends Report {
    @Override protected void body() { /* draw sales */ }
}
```

You read `SalesReport` and see exactly what changes vs. the default. Two files, one hop, no yo-yo.

---

## 5. How the IDE shows the yo-yo

Open `class E` in IntelliJ. Press *Ctrl-H* (or *Cmd-H* on macOS) for the **Hierarchy** view. If the type hierarchy of `E` reaches more than three or four levels deep, you have a structural risk. Now click on `process()` in `E` and press *Ctrl-Alt-B* (Go to Implementation). The dialog asks which of five overrides you mean. That dialog is the yo-yo signature.

A second sign: when you press *Ctrl-B* (Go to Declaration) on `super.finish()` inside `D.finish()`, you land in `A.finish()`, skipping `B` and `C` because they don't override it. The reader is left wondering: "Wait, didn't `C` change anything?" — they have to *check* every layer just to find out which ones are irrelevant.

---

## 6. A first refactor: flatten via composition

The cure for the yo-yo is almost never "make the hierarchy slightly less deep". It is to *flatten the chain entirely* and re-express the variation as composition.

```java
// One concrete class, three pluggable collaborators.
public final class Processor {
    private final Validator validator;
    private final Step step;
    private final Finisher finisher;

    public Processor(Validator v, Step s, Finisher f) {
        this.validator = v;
        this.step = s;
        this.finisher = f;
    }

    public void process() {
        validator.validate();
        step.run();
        finisher.finish();
    }
}

public interface Validator { void validate(); }
public interface Step      { void run(); }
public interface Finisher  { void finish(); }
```

Each collaborator is a small, focused interface. The "five levels" become three implementations of three small interfaces, wired together at construction. No more yo-yo: the reader sees `process()` and the three collaborators in one screen.

---

## 7. A second refactor: inline trivial overrides

Sometimes you don't even need composition — the chain exists because each level "wraps" the parent with one extra line. Inline those into the leaf class:

```java
// Before: B exists only to add one validation rule.
abstract class A { protected void validate() { /* base */ } }
abstract class B extends A {
    @Override protected void validate() {
        super.validate();
        if (somethingExtra()) throw new IllegalStateException();
    }
    protected abstract boolean somethingExtra();
}
class C extends B {
    @Override protected boolean somethingExtra() { return cond(); }
}

// After: collapse B into C.
class C extends A {
    @Override protected void validate() {
        super.validate();
        if (cond()) throw new IllegalStateException();
    }
}
```

You traded one level of abstract inheritance for two lines of duplication in one place. Most of the time, that is the right trade.

---

## 8. What's next

| Topic                                                        | File              |
| ------------------------------------------------------------ | ----------------- |
| Symptom catalogue, IDE traces, structured refactors          | `middle.md`        |
| Cognitive load research, links to Fragile Base Class         | `senior.md`        |
| Framework hierarchies, ArchUnit DIT rules, migration         | `professional.md`  |
| Chidamber-Kemerer DIT/NOC, PMD/Checkstyle rules              | `specification.md` |
| 10 yo-yo bugs and their fixes                                | `find-bug.md`      |
| Vtable depth, JIT inlining limits, escape analysis           | `optimize.md`      |
| Practice exercises                                           | `tasks.md`         |
| Interview Q&A                                                | `interview.md`     |

Related smells: [Fragile Base Class Problem](../../03-design-principles/06-fragile-base-class-problem/), [Composition over Inheritance](../../03-design-principles/02-composition-over-inheritance/), [Refused Bequest](../04-refused-bequest/).

---

**Memorize this:** The Yo-Yo Problem is "one call, many hops". If understanding `process()` requires reading five files in a particular order, your hierarchy is too deep or your Template Method is too split. Cap inheritance depth at three, prefer composition, and inline trivial overrides.
