# Refactoring Toward Structural Patterns — Junior Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/structural-patterns](https://refactoring.guru/design-patterns/structural-patterns)

Structural patterns describe how objects are **composed** — how you assemble small objects into bigger ones, wrap one object inside another, or present a tangle of objects as a single clean shape. The *Gang of Four* gives you the destinations (Composite, Decorator, Adapter, Facade, Proxy, Bridge, Flyweight). Kerievsky gives you the **roads**: the smell that tells you to move, and the small behavior-preserving steps that get you there safely.

This file is the on-ramp. You will learn what "structural refactoring" means, which smells trigger it, and two refactorings in full mechanical detail: **Move Embellishment to Decorator** and **Replace Implicit Tree with Composite**.

---

## Table of Contents

- [What "structural" refactoring means](#what-structural-refactoring-means)
- [The smells that drive you toward structural patterns](#the-smells-that-drive-you-toward-structural-patterns)
- [Real-world analogy](#real-world-analogy)
- [Refactoring 1: Move Embellishment to Decorator](#refactoring-1-move-embellishment-to-decorator)
- [Refactoring 2: Replace Implicit Tree with Composite](#refactoring-2-replace-implicit-tree-with-composite)
- [Smell → refactoring table](#smell--refactoring-table)
- [Mini glossary](#mini-glossary)
- [Review questions](#review-questions)
- [Next](#next)

---

## What "structural" refactoring means

A **structural** refactoring changes *how objects are wired together* without changing *what the program computes*. You are not adding a feature or fixing a bug. You are rearranging the object graph so that future changes are cheaper.

Three moves dominate:

1. **Compose** — replace ad-hoc parent/child bookkeeping with a uniform tree (Composite).
2. **Wrap** — replace boolean flags that toggle optional behavior with stackable wrappers (Decorator).
3. **Translate / hide** — replace scattered conditional version-handling with one wrapper per API (Adapter), or hide a noisy subsystem behind one entry point (Facade).

The golden rule, inherited from Fowler's *Refactoring*: **behavior is preserved at every step**. You make a series of tiny, individually-safe edits, running tests after each, until the new structure emerges. You never "rewrite into a pattern" in one big leap — that is a rewrite, not a refactoring, and it loses the safety net.

> **Patterns are a destination, not a starting point.** Kerievsky's whole thesis is that you should *refactor toward* a pattern when a smell demands it — not sprinkle patterns on speculatively. See the sibling topic [When to Refactor to Patterns](../01-when-to-refactor-to-patterns/junior.md), and the counterweight [Refactoring Away From Patterns](../05-refactoring-away-from-patterns/junior.md) for when to remove one you no longer need.

---

## The smells that drive you toward structural patterns

You don't reach for a structural pattern because it's elegant. You reach for it because the code is hurting in a specific, recognizable way.

| Smell you feel | What it looks like | Structural destination |
| --- | --- | --- |
| **Conditional Complexity** around optional features | `if (withBorder) {...} if (withScrollbar) {...}` piling up | **Decorator** |
| **Hand-rolled tree** | manual `parent`, `List<Child>` fields and recursive walks copied around | **Composite** |
| **One/Many duplication** | every method has a "single item" branch and a "collection" branch | **Composite** |
| **Duplicated tree code in siblings** | two classes each implement the same add/remove/traverse logic | **Extract Composite** |
| **Conditional adaptation** | `if (apiVersion == 1) ... else if (v2) ...` to talk to different libraries | **Adapter** |
| **Incompatible interface** | the client wants method `read()` but the library offers `fetchBytes()` | **Adapter** |
| **Clients reaching deep into a subsystem** | callers wire up 6 collaborators in the right order every time | **Facade** |
| **Expensive object created eagerly / unguarded access** | a heavy image loaded even when never shown | **Proxy** |
| **Memory pressure from many identical objects** | a million `Glyph('a')` objects, all the same | **Flyweight** |
| **Class explosion on two axes** | `RedCircle, RedSquare, BlueCircle, BlueSquare...` | **Bridge** |

The full smell catalog lives next door under [code smells](../../01-code-smells/README.md) — *Conditional Complexity*, *Duplicated Code*, and *Combinatorial Explosion* are the ones that most often point here.

---

## Real-world analogy

Think about ordering coffee. ☕

- A **base coffee** is your component.
- "Add milk", "add caramel", "add an extra shot" are **embellishments**. You could try to model every combination as its own menu item — `CoffeeWithMilk`, `CoffeeWithMilkAndCaramel`, `CoffeeWithCaramelAndExtraShot`... — and drown in a combinatorial menu. That is the flag-soup smell. Instead, the barista **wraps** your coffee: each add-on is a layer that takes the price/description of what's underneath and adds its own. That is **Decorator**.
- Now think about a company **org chart**. A manager has reports; some reports are individual contributors (leaves), some are themselves managers with their own reports (branches). When you ask "what's the total headcount under Alice?", you don't care whether each node is an IC or a manager — you ask every node the same question and it answers. That uniform "treat a leaf and a branch the same way" is **Composite**.

Hold those two pictures. The refactorings below are just the disciplined way to *arrive* at them from messy code.

---

## Refactoring 1: Move Embellishment to Decorator

> Full pattern reference: [Decorator](../../../design-patterns/02-structural/04-decorator/junior.md).

### Starting smell

A class has grown a cluster of boolean flags that switch optional behavior on and off. Every method that does real work is now threaded with `if (flag)` checks for behavior that only *some* callers want.

```java
// SMELL: optional behaviors bolted on with flags
public class TextView {
    private final String text;
    private boolean withBorder;
    private boolean withScrollbar;

    public TextView(String text) { this.text = text; }

    public void setWithBorder(boolean b)    { this.withBorder = b; }
    public void setWithScrollbar(boolean b) { this.withScrollbar = b; }

    public String render() {
        String body = text;
        if (withBorder) {
            body = "[" + body + "]";          // border embellishment
        }
        if (withScrollbar) {
            body = body + " ▮";               // scrollbar embellishment
        }
        return body;
    }
}
```

### Motivation

The flags don't compose well. The moment a second flag appears, you have an implicit ordering problem ("border inside scrollbar or outside?") that lives *inside* `render()`. Adding a new embellishment (say, a shadow) means editing `TextView` again — it violates the Open/Closed Principle. The optional behaviors are also stuck to this one class; a different view that wants a border has to duplicate the logic.

A **Decorator** turns each embellishment into its own object that wraps a component and adds behavior. Decorators share the component's interface, so they stack.

### Mechanical steps (behavior-preserving)

1. **Extract a component interface.** Identify the operation the embellishments wrap (`render()`). Create an interface `Component` declaring it, and make the plain class implement it.
2. **Create an abstract decorator** that implements `Component`, holds a `Component` field (the wrappee), and by default **delegates** every method to it. This default-delegate base is what guarantees a decorator that adds nothing still preserves behavior.
3. **Move one embellishment** into a concrete decorator subclass. It calls `super`/the wrappee, then adds its piece. Delete the corresponding flag and `if` from the original class.
4. **Run tests.** Behavior must be identical for the case where that flag was true (now: wrap in the decorator) and where it was false (now: don't wrap).
5. **Repeat steps 3–4** for each remaining flag, one at a time.
6. **Update construction sites.** Replace `view.setWithBorder(true)` with `new BorderDecorator(view)`.

### After

```java
// Component: the shared interface
public interface View {
    String render();
}

// Concrete component: now flag-free
public class TextView implements View {
    private final String text;
    public TextView(String text) { this.text = text; }
    @Override public String render() { return text; }
}

// Abstract decorator: delegates by default (the safety hinge)
public abstract class ViewDecorator implements View {
    protected final View wrappee;
    protected ViewDecorator(View wrappee) { this.wrappee = wrappee; }
    @Override public String render() { return wrappee.render(); }
}

// One embellishment per decorator
public class BorderDecorator extends ViewDecorator {
    public BorderDecorator(View wrappee) { super(wrappee); }
    @Override public String render() { return "[" + wrappee.render() + "]"; }
}

public class ScrollbarDecorator extends ViewDecorator {
    public ScrollbarDecorator(View wrappee) { super(wrappee); }
    @Override public String render() { return wrappee.render() + " ▮"; }
}
```

```java
// Construction is now compositional and order-explicit
View view = new ScrollbarDecorator(new BorderDecorator(new TextView("Hello")));
// render() -> "[Hello] ▮"   (border applied first, then scrollbar)
```

Adding a `ShadowDecorator` later requires **zero** edits to `TextView` or the other decorators. The ordering question that used to hide inside `render()` is now visible and chosen at the construction site.

### When NOT to

- **Two flags, forever.** If there are only one or two embellishments and the set is closed, the flags may be simpler than four new classes. Don't pay the indirection tax for a problem you don't have.
- **Embellishments that must see each other.** Decorators see only the layer beneath them. If "border" needs to *know* whether a scrollbar is present and react to it, decorators fight you — that coupling belongs elsewhere.
- **The wrapped interface is wide.** If `View` had 20 methods, every decorator must delegate all 20. That delegation boilerplate can outweigh the benefit; consider whether the interface should be narrower first.

---

## Refactoring 2: Replace Implicit Tree with Composite

> Full pattern reference: [Composite](../../../design-patterns/02-structural/03-composite/junior.md).

### Starting smell

You have a tree — a file system, a menu, an org chart, an XML-like document — but it isn't modeled as a tree of objects. Instead, one class carries raw parent/child arrays and the recursive logic is hand-rolled and scattered, often with a flag distinguishing "is this a leaf or a folder?".

```java
// SMELL: a hand-rolled tree with a type flag
public class Node {
    private final String name;
    private final boolean isFile;           // type flag distinguishing leaf vs branch
    private final long size;                // only meaningful when isFile
    private final List<Node> children;      // only meaningful when !isFile

    public Node(String name, long size) {   // file ctor
        this.name = name; this.isFile = true;
        this.size = size; this.children = null;
    }
    public Node(String name) {              // directory ctor
        this.name = name; this.isFile = false;
        this.size = 0; this.children = new ArrayList<>();
    }

    public void add(Node child) {
        if (isFile) throw new UnsupportedOperationException("file has no children");
        children.add(child);
    }

    public long totalSize() {
        if (isFile) {
            return size;
        } else {
            long sum = 0;
            for (Node c : children) {
                sum += c.totalSize();       // recursion with isFile branching everywhere
            }
            return sum;
        }
    }
}
```

### Motivation

Every operation (`totalSize`, `print`, `find`) repeats the same `if (isFile) ... else ...` fork. The flag means each method must remember the two halves; the unused fields (`children` for a file, `size` for a directory) are an invitation for bugs. Adding a third node kind (say, a symlink) means touching *every* method.

A **Composite** replaces the flag with **types**. A common interface declares the operations; a `File` (leaf) and a `Directory` (branch) each implement them their own way. The branch holds children and delegates; the leaf just answers. The `if (isFile)` checks vanish because the *type system* now makes the distinction.

### Mechanical steps (behavior-preserving)

1. **Define the component interface.** Declare the operations clients call (`totalSize()`, `add(child)`). Name it `FileSystemNode`.
2. **Create the leaf class.** Move the file branch of every method here. A `File` implements `totalSize()` by returning its own size; `add()` throws (or is absent — see "When NOT to").
3. **Create the composite class.** Move the directory branch here. A `Directory` holds `List<FileSystemNode>`, implements `add()`, and implements `totalSize()` by summing children's `totalSize()`.
4. **Make recursion polymorphic.** Inside `Directory.totalSize()`, the loop calls `child.totalSize()` against the *interface* — it no longer checks a flag; the child's own type decides what to do.
5. **Run tests** on the existing tree-building code path; results must match the flagged version exactly.
6. **Replace construction.** `new Node("a.txt", 100)` becomes `new File("a.txt", 100)`; `new Node("docs")` becomes `new Directory("docs")`.
7. **Delete the old flagged `Node`.**

### After

```java
// Component: one interface for leaf and branch
public interface FileSystemNode {
    long totalSize();
    default void add(FileSystemNode child) {
        throw new UnsupportedOperationException();   // default: not addable
    }
}

// Leaf
public class File implements FileSystemNode {
    private final String name;
    private final long size;
    public File(String name, long size) { this.name = name; this.size = size; }
    @Override public long totalSize() { return size; }
}

// Composite (branch)
public class Directory implements FileSystemNode {
    private final String name;
    private final List<FileSystemNode> children = new ArrayList<>();
    public Directory(String name) { this.name = name; }

    @Override public void add(FileSystemNode child) { children.add(child); }

    @Override public long totalSize() {
        long sum = 0;
        for (FileSystemNode child : children) {
            sum += child.totalSize();   // polymorphic recursion — no isFile check
        }
        return sum;
    }
}
```

```java
Directory root = new Directory("root");
root.add(new File("a.txt", 100));
Directory docs = new Directory("docs");
docs.add(new File("readme.md", 50));
root.add(docs);

root.totalSize(); // 150 — same answer, zero flag checks
```

The `if (isFile)` fork is gone from every operation. A new node kind is a new class implementing the interface; existing classes don't change.

### When NOT to

- **Transparency vs. safety.** Putting `add()` on the shared interface lets clients treat leaf and branch uniformly (*transparent*), but a leaf must then refuse `add()` at runtime. If calling `add()` on a leaf is a serious bug you want caught at compile time, keep `add()` off the interface and only on `Directory` (*safe*), accepting that clients sometimes must downcast. This is a genuine trade-off — Kerievsky and GoF both flag it.
- **No real recursion.** If the "tree" is always exactly two levels deep and never grows, a `Map<Group, List<Item>>` may be plainer than a full Composite.
- **Leaf and branch barely overlap.** Composite pays off when many operations are *uniform* across node kinds. If a leaf and a branch share almost no behavior, forcing them under one interface creates a fake abstraction.

---

## Smell → refactoring table

| If you see... | Apply... | You arrive at... |
| --- | --- | --- |
| Flags toggling optional behavior in one class | **Move Embellishment to Decorator** | [Decorator](../../../design-patterns/02-structural/04-decorator/junior.md) |
| A hand-rolled tree with `isLeaf`-style flags | **Replace Implicit Tree with Composite** | [Composite](../../../design-patterns/02-structural/03-composite/junior.md) |
| Methods that special-case single vs. collection | **Replace One/Many Distinctions with Composite** (see [middle](middle.md)) | Composite |
| Sibling classes duplicating tree logic | **Extract Composite** (see [middle](middle.md)) | Composite |
| `if (version == ...)` to talk to several libraries | **Extract Adapter** (see [middle](middle.md)) | [Adapter](../../../design-patterns/02-structural/01-adapter/junior.md) |
| Client expects an interface a class doesn't offer | **Unify Interfaces with Adapter** (see [middle](middle.md)) | Adapter |
| Clients wiring up a whole subsystem by hand | **Introduce Facade** (see [senior](senior.md)) | [Facade](../../../design-patterns/02-structural/05-facade/junior.md) |

---

## Mini glossary

- **Component** — the shared interface a Decorator wraps or a Composite's nodes implement.
- **Leaf** — a Composite node with no children (e.g. `File`).
- **Branch / Composite node** — a node that holds children and delegates to them (e.g. `Directory`).
- **Embellishment** — optional behavior added around a base operation (border, scrollbar, logging).
- **Wrappee** — the object a Decorator wraps; the next layer down.
- **Adaptee** — the existing class an Adapter translates calls to.
- **Transparent vs. safe** — whether child-management methods live on the shared interface (transparent) or only on the branch (safe).
- **Behavior-preserving** — each refactoring step leaves the program's observable output unchanged.

---

## Review questions

1. What single smell most strongly signals "Move Embellishment to Decorator", and why do flags fail to scale?
2. In the abstract `ViewDecorator`, why is the default-delegate `render()` essential to the refactoring being behavior-preserving?
3. After Replace Implicit Tree with Composite, where did the `if (isFile)` checks go? What replaced them?
4. Explain the *transparent vs. safe* trade-off for putting `add()` on the Composite component interface.
5. Give one concrete situation where you should **not** introduce a Decorator and should keep the boolean flags.
6. Why does Kerievsky insist you refactor *toward* a pattern from a smell rather than design with the pattern upfront?

---

## Next

- [middle.md](middle.md) — One/Many Distinctions, Extract Composite, Extract Adapter & Unify Interfaces with Adapter.
- [senior.md](senior.md) — Composite + Visitor, Decorator ordering & invariants, Bridge, Proxy, Flyweight.
- [professional.md](professional.md) — Performance & memory cost of structural indirection; when to inline it.
- [interview.md](interview.md) — Interview Q&A.
- [tasks.md](tasks.md) — Hands-on refactoring exercises.
- [find-bug.md](find-bug.md) — Broken/mis-applied structural patterns to diagnose.
- [optimize.md](optimize.md) — Smelly snippets to refactor (or argue against).
