# Visitor — Interview Prep

> **Source:** [refactoring.guru/design-patterns/visitor](https://refactoring.guru/design-patterns/visitor)

A practice bank for Visitor pattern interviews — concise answers, code, and trade-offs.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [System Design Questions](#system-design-questions)
7. [Anti-pattern / "What's wrong" Questions](#anti-pattern-whats-wrong-questions)
8. [Cross-pattern Questions](#cross-pattern-questions)
9. [Quick Drills (1-line answers)](#quick-drills-1-line-answers)
10. [Tips for Interviews](#tips-for-interviews)

---

## Junior Questions

### Q1: What is the Visitor pattern?

**A.** A behavioral design pattern that lets you add new operations to an existing object hierarchy without modifying the classes. Operations live in separate Visitor classes; elements have an `accept(visitor)` method that delegates to the right visit method via double dispatch.

### Q2: What is double dispatch?

**A.** Method selection based on the runtime types of *both* the receiver (element) and the argument (visitor). Standard OOP is single dispatch — only the receiver's type matters. Visitor simulates double dispatch by having the element call `visitor.visitX(this)` — the first virtual call selects which `accept` runs, the second selects which `visitX`.

### Q3: When should you use Visitor?

**A.** When:
- The element class hierarchy is **stable** (rarely changes).
- You need to perform **many different operations** on the elements.
- Adding operations should not require modifying element classes.
- Operations would otherwise pollute element classes with unrelated logic.

### Q4: When should you NOT use Visitor?

**A.** When:
- Element hierarchy changes often — every visitor breaks on each new element.
- You only have one or two operations — methods on elements are simpler.
- Operations need access to private state of elements.
- Languages have native pattern matching (Rust, Haskell) — use that instead.

### Q5: What roles are in the Visitor pattern?

**A.** Two main roles:
- **Element** (and ConcreteElement) — has an `accept(visitor)` method.
- **Visitor** (and ConcreteVisitor) — has a `visit<Element>` method per element type.

Plus the **Client** that drives the traversal.

### Q6: What's the difference between Visitor and Strategy?

**A.** Strategy swaps an algorithm at runtime; Visitor adds new operations to a hierarchy. Strategy: one operation, many implementations. Visitor: many operations across a class hierarchy.

### Q7: Show a minimal Visitor example.

**A.**

```java
interface Shape {
    <R> R accept(Visitor<R> v);
}

class Circle implements Shape {
    double radius;
    public <R> R accept(Visitor<R> v) { return v.visitCircle(this); }
}

interface Visitor<R> {
    R visitCircle(Circle c);
}

class AreaVisitor implements Visitor<Double> {
    public Double visitCircle(Circle c) { return Math.PI * c.radius * c.radius; }
}
```

### Q8: Why does the element need an `accept` method?

**A.** Because in single-dispatch languages (Java, C#, Python), the visitor cannot know the element's runtime type just from a reference. By having the element itself call `visitor.visitX(this)`, the element's type drives which visit method runs — that's the second dispatch.

---

## Middle Questions

### Q9: What's the expression problem?

**A.** A fundamental tension: extending a system in two dimensions — adding new types AND new operations — without modifying existing code is hard. Methods-on-element make adding types easy and operations hard. Visitor makes operations easy and types hard. Multimethods (Clojure, CLOS) and traits (Rust, Haskell) solve both.

### Q10: How would you walk a tree with a Visitor?

**A.** The visitor's `visit<Composite>` method recurses by calling `child.accept(this)` for each child:

```java
public Double visitGroup(Group g) {
    return g.children().stream().mapToDouble(c -> c.accept(this)).sum();
}
```

Order (pre/in/post) is the visitor's choice.

### Q11: Pre-order vs post-order — when to use which?

**A.**
- **Pre-order** (parent first): code emission, opening tags, top-down counting. Use when the parent's processing should happen *before* children's.
- **Post-order** (children first): evaluation, type inference, constant folding. Children's results compose into parent's result. Most "compute over tree" visitors are post-order.
- **In-order** (only for binary trees): pretty-print sorted BSTs.

### Q12: What's a stateful Visitor?

**A.** A visitor that accumulates information during traversal — depth counter, list of visited nodes, accumulated total. The visit methods read/write fields. Read accumulated state after traversal completes:

```java
StatsVisitor s = new StatsVisitor();
ast.accept(s);
System.out.println("nodes: " + s.count());
```

Visitor is **one-shot**: don't reuse without resetting.

### Q13: How do you replace Visitor with sealed types + switch in Java 17+?

**A.**

```java
sealed interface Shape permits Circle, Square, Triangle {}

double area(Shape s) {
    return switch (s) {
        case Circle c     -> Math.PI * c.radius() * c.radius();
        case Square sq    -> sq.side() * sq.side();
        case Triangle t   -> 0.5 * t.base() * t.height();
    };
}
```

Compiler enforces exhaustiveness. Adding a `Hexagon` to `permits` breaks every switch — exactly what you want.

### Q14: Explain Visitor + Composite.

**A.** Composite structures a tree of objects; Visitor performs operations on it. The composite's `accept` either calls `visitGroup(this)` and lets the visitor recurse, or recurses internally and calls visit on each child. Modern preference: visitor controls recursion via `visitGroup` calling `child.accept(this)`.

### Q15: How do you visit nodes in different orders without changing the tree?

**A.** Different visitors implement different traversal orders. The tree's `accept` is uniform; the visitor's `visit<Composite>` decides whether to call children before or after the parent's logic. **Order is the visitor's responsibility.**

### Q16: What is reflective Visitor?

**A.** Skip the strict Visitor interface; use reflection to find a `visit<X>` method matching the element's type:

```java
Method m = visitor.getClass().getMethod("visit" + node.getClass().getSimpleName(), node.getClass());
m.invoke(visitor, node);
```

Pros: no `accept` method on elements, narrow visitors easy.
Cons: no compile-time check, slower, IDE refactoring breaks.

### Q17: Show a Visitor that mutates the tree.

**A.** Constant folder:

```java
public Expr visitBinary(BinaryOp b) {
    Expr l = b.left().accept(this);
    Expr r = b.right().accept(this);
    if (l instanceof NumberLit ln && r instanceof NumberLit rn) {
        return new NumberLit(ln.value() + rn.value());
    }
    return new BinaryOp(l, b.op(), r);
}
```

Returns a new (or unchanged) tree. **Pure functional rewrite.**

### Q18: How do visitors handle cycles?

**A.** Maintain a `Set<Node>` (with identity comparison via `IdentityHashMap`) of already-visited nodes:

```java
public Void visit(Node n) {
    if (!visited.add(n)) return null;   // already seen
    // ... recurse
}
```

Without it, cyclic graphs cause infinite recursion → StackOverflow.

---

## Senior Questions

### Q19: What's an Acyclic Visitor?

**A.** Standard Visitor: one `Visitor` interface lists all element types → adding an element forces every visitor to recompile. Acyclic Visitor (Robert Martin): break it into per-element-type interfaces (e.g., `CircleVisitor`, `SquareVisitor`). Each visitor implements only what it cares about. Element's `accept` checks `instanceof` and calls if applicable.

```java
interface Visitor {}   // marker
interface CircleVisitor extends Visitor { void visitCircle(Circle c); }
class Circle implements Shape {
    public void accept(Visitor v) { if (v instanceof CircleVisitor cv) cv.visitCircle(this); }
}
```

Pros: plugin-friendly. Cons: lost compile-time exhaustiveness; runtime cost of `instanceof`.

### Q20: How do compilers use Visitor?

**A.** Modern compilers organize each pass as a Visitor over the AST:
- **Lexer** → tokens (not visitor).
- **Parser** → AST (not visitor; produces tree).
- **Resolver** → walks AST, builds symbol table (visitor).
- **Type checker** → walks AST, annotates types (visitor).
- **Optimizer** → walks AST, rewrites (visitor).
- **Code generator** → walks AST, emits bytecode (visitor).

javac, Roslyn (C#), TypeScript Compiler all use Visitor as the foundation.

### Q21: How does ANTLR use Visitor?

**A.** ANTLR generates parse trees and *both* a Listener (push: framework calls you) and a Visitor (pull: you call children). For computed values across the tree (e.g., evaluation), use Visitor with a typed return value. For event-driven processing (e.g., highlighting), use Listener.

### Q22: Compare internal vs external iteration with Visitor.

**A.**
- **Internal:** visitor recurses; tree structure decides order. Standard Visitor.
- **External:** an iterator yields nodes one-by-one; client controls pace. Pause / resume / skip possible.

External + Visitor: a `TreeWalker` returns nodes; a Visitor processes each. Combines benefits but more code.

### Q23: How would you compose multiple visitors into one walk?

**A.** Wrap them in a CompositeVisitor:

```java
public class CompositeVisitor<R> implements Visitor<List<R>> {
    private final List<Visitor<R>> visitors;
    public List<R> visitX(X x) {
        return visitors.stream().map(v -> v.visitX(x)).toList();
    }
}
```

Saves repeated tree walks; useful when traversal expensive (large ASTs).

### Q24: What's the performance cost of Visitor?

**A.** Two virtual calls per node: `accept` (dispatch on element type) + `visitX` (dispatch on visitor type). On warm JIT with monomorphic call sites: ~3-5ns per node. Megamorphic (10+ subclasses): ~10-15ns.

For 1M-node trees: 3-15ms total dispatch overhead. Negligible for compilers; significant in tight loops (game engines, packet processors).

### Q25: Why does sealed-types + switch sometimes outperform Visitor?

**A.** Pattern matching on sealed types compiles to `tableswitch` / `lookupswitch` bytecode — direct jump, no virtual dispatch. Visitor does two virtuals. For warm code with predictable type sets, switch is 2-3× faster. JIT can fully optimize switch with branch prediction.

### Q26: How do you rewrite a tree without allocating for every node?

**A.** Structural sharing: if no children changed, return the original node:

```java
if (newLeft == oldLeft && newRight == oldRight) return original;
return new BinaryOp(newLeft, op, newRight);
```

For a tree where 1 node changes: O(log N) allocations along the path. Persistent data structure principle.

### Q27: Hash-consing — what is it and why?

**A.** Cache constructed nodes by structural equality. `new BinaryOp(1, +, 2)` always returns the same instance. Equality by reference. Memory bounded by *unique* subtrees, not total node count. Used in SMT solvers, proof assistants, and many compilers.

### Q28: How do you avoid stack overflow in deep AST visitors?

**A.** Convert recursive Visitor to iterative — explicit work stack:

```java
Deque<Object> work = new ArrayDeque<>();
work.push(root);
while (!work.isEmpty()) {
    Object n = work.pop();
    // process or push children
}
```

Stack lives in heap; depth bounded by RAM. For 1M-deep right-recursive trees: necessary.

### Q29: What's a trampoline visitor?

**A.** Convert recursion to a loop by returning thunks (continuations). Each step returns either `Done(result)` or `More(supplier)`. A driver loop bounces:

```java
while (step instanceof More more) step = more.next().get();
return ((Done) step).value();
```

Used in functional languages; avoids stack overflow without explicit stack management.

### Q30: How do you test a Visitor?

**A.**
1. **Unit tests:** hand-built tree → call accept → assert result.
2. **Property tests:** for rewriting visitors, check invariants — e.g., constant folder preserves semantic value.
3. **Snapshot tests:** for renderers, compare to frozen output.
4. **Integration tests:** run multiple visitor passes; check final output.

---

## Professional Questions

### Q31: What does the JIT do with monomorphic Visitor calls?

**A.** Inlines `accept` into the call site, then inlines the right `visitX` into that. After warmup, dispatch is effectively zero-cost — like a hand-written method. Loading a second element subclass deoptimizes (but JIT recompiles).

### Q32: Why is megamorphic Visitor slow?

**A.** When 8+ element subclasses appear at a call site, JVM falls back to vtable lookup. ~3-5ns per call vs ~0ns inlined. For tight loops, ~10ms+ per million calls.

Mitigations:
1. Type-specialized batches (group by subclass).
2. Code-generated per-subclass templates.
3. Sealed types + switch (compiler-optimized jump table).

### Q33: How do you make Visitor cache-friendly?

**A.** Arena allocation: AST nodes contiguous in memory. Pre-order traversal hits adjacent cache lines. ANTLR, Roslyn, V8 use arenas. Alternative: structure-of-arrays (parallel arrays per field) — even denser cache for read-heavy walks.

### Q34: Compare ASM's Visitor API with materialized AST visitors.

**A.** ASM streams events: visitClass, visitMethod, visitField. **No materialized AST.** Memory cheap. Used for bytecode rewriters (AspectJ, ByteBuddy, profilers). Materialized visitors (JavaParser, Roslyn) hold the tree in memory — easier API but heavier.

### Q35: What's a source-generated Visitor?

**A.** Annotation processor / source generator produces the Visitor interface from element definitions:

```java
@GenerateVisitor sealed interface Shape permits Circle, Square {}
```

generates `ShapeVisitor` automatically. Adding `Hexagon` to permits regenerates and breaks all visitors — exactly what you want for a stable hierarchy.

### Q36: How does Visitor scale across distributed builds?

**A.** Each Visitor pass over a single file is independently distributable. Cross-file passes (resolution) need a centralized symbol table. Bazel and Buck split per `java_library`; per-unit visitors run sandboxed; outputs (.class + headers) shared via build cache.

### Q37: Visitor in GraphQL — explain.

**A.** GraphQL queries are trees; resolvers are visitors. Each (Type, Field) pair has a resolver function. Engine walks query AST; calls appropriate resolver per node. Type definitions stable; resolvers extensible. Classic Visitor pattern.

### Q38: How does LLVM use Visitor?

**A.** Each LLVM optimization pass is a Visitor over IR. Pass manager schedules them, tracks invalidations (e.g., DCE invalidates dominance analysis). Each pass can transform IR. Architecture: `PassManager → Pass → InstVisitor`. ~50+ passes per build.

### Q39: How is the Visitor pattern related to multimethods?

**A.** Visitor *simulates* double dispatch in single-dispatch languages. Languages with multimethods (Clojure, CLOS, Julia) dispatch on multiple argument types natively — no Visitor pattern needed. For these languages, multimethods solve the expression problem cleanly.

### Q40: Explain Roslyn's `SyntaxRewriter`.

**A.** A specialized Visitor that returns a transformed node — `Visit(node)` returns the new (or same) `SyntaxNode`. C# analyzers and code fixes are SyntaxRewriters. Persistent data structure pattern: only changed paths allocated; unchanged subtrees shared.

---

## Coding Tasks

### Task 1: Implement a Visitor for a small expression AST.

```java
sealed interface Expr permits Num, Bin {}
record Num(double v) implements Expr {}
record Bin(Expr l, String op, Expr r) implements Expr {}

interface ExprVisitor<R> {
    R visitNum(Num n);
    R visitBin(Bin b);
}

// Add accept methods:
sealed interface Expr permits Num, Bin {
    <R> R accept(ExprVisitor<R> v);
}

// Implement Evaluator
```

**Solution:**

```java
class Evaluator implements ExprVisitor<Double> {
    public Double visitNum(Num n) { return n.v(); }
    public Double visitBin(Bin b) {
        double l = b.l().accept(this);
        double r = b.r().accept(this);
        return switch (b.op()) {
            case "+" -> l + r;
            case "*" -> l * r;
            default -> throw new IllegalStateException();
        };
    }
}
```

### Task 2: Write a visitor that counts nodes by type.

**Solution:**

```java
class TypeCounter implements ExprVisitor<Void> {
    Map<Class<?>, Integer> counts = new HashMap<>();

    public Void visitNum(Num n) {
        counts.merge(Num.class, 1, Integer::sum);
        return null;
    }

    public Void visitBin(Bin b) {
        counts.merge(Bin.class, 1, Integer::sum);
        b.l().accept(this);
        b.r().accept(this);
        return null;
    }
}
```

### Task 3: Convert this `instanceof` chain to Visitor.

```java
double area(Shape s) {
    if (s instanceof Circle c) return Math.PI * c.radius * c.radius;
    if (s instanceof Square sq) return sq.side * sq.side;
    throw new IllegalArgumentException();
}
```

**Solution:**

```java
interface Visitor<R> {
    R visitCircle(Circle c);
    R visitSquare(Square s);
}

class AreaVisitor implements Visitor<Double> {
    public Double visitCircle(Circle c) { return Math.PI * c.radius * c.radius; }
    public Double visitSquare(Square s) { return s.side * s.side; }
}

interface Shape { <R> R accept(Visitor<R> v); }
class Circle implements Shape { public <R> R accept(Visitor<R> v) { return v.visitCircle(this); } }
class Square implements Shape { public <R> R accept(Visitor<R> v) { return v.visitSquare(this); } }
```

### Task 4: Add an undo log for an operation that mutates an AST.

**Solution:** Combine Visitor with Memento (or capture inverse operations):

```java
class TrackedRewriter implements ExprVisitor<Expr> {
    Deque<Runnable> undo = new ArrayDeque<>();

    public Expr visitBin(Bin b) {
        // ... transform
        undo.push(() -> /* restore */);
        return new Bin(...);
    }
    // ... other visit methods
}
```

### Task 5: Write a visitor that finds all variables used in an expression.

**Solution:**

```java
class VarFinder implements ExprVisitor<Set<String>> {
    public Set<String> visitVariable(Var v) { return Set.of(v.name()); }
    public Set<String> visitNum(Num n)      { return Set.of(); }
    public Set<String> visitBin(Bin b) {
        Set<String> r = new HashSet<>();
        r.addAll(b.l().accept(this));
        r.addAll(b.r().accept(this));
        return r;
    }
}
```

### Task 6: Write a visitor with depth tracking.

**Solution:**

```java
class DepthPrinter implements ExprVisitor<Void> {
    int depth = 0;

    public Void visitNum(Num n) {
        System.out.println("  ".repeat(depth) + "num: " + n.v());
        return null;
    }

    public Void visitBin(Bin b) {
        System.out.println("  ".repeat(depth) + "binary: " + b.op());
        depth++;
        b.l().accept(this);
        b.r().accept(this);
        depth--;
        return null;
    }
}
```

### Task 7: Compare two ASTs for structural equality.

**Solution:** A visitor that takes another tree as parameter:

```java
class EqualityChecker implements ExprVisitor<Boolean> {
    private Expr other;
    public EqualityChecker(Expr other) { this.other = other; }

    public Boolean visitNum(Num n) {
        return other instanceof Num o && n.v() == o.v();
    }

    public Boolean visitBin(Bin b) {
        if (!(other instanceof Bin o)) return false;
        if (!b.op().equals(o.op())) return false;
        Expr saved = other;
        other = o.l(); if (!b.l().accept(this)) return false;
        other = o.r(); if (!b.r().accept(this)) return false;
        other = saved;
        return true;
    }
}
```

(In practice: just `equals` on records — but as a Visitor exercise, instructive.)

### Task 8: Implement constant folding.

**Solution:**

```java
class ConstFolder implements ExprVisitor<Expr> {
    public Expr visitNum(Num n) { return n; }
    public Expr visitBin(Bin b) {
        Expr l = b.l().accept(this);
        Expr r = b.r().accept(this);
        if (l instanceof Num ln && r instanceof Num rn) {
            return new Num(combine(ln.v(), b.op(), rn.v()));
        }
        return new Bin(l, b.op(), r);
    }
}
```

---

## System Design Questions

### Q41: Design a static analyzer for Java code.

**A.** Architecture:
1. Parse source → AST (using JavaParser or Eclipse JDT).
2. Each rule = a Visitor over the AST.
3. Visitor inspects nodes, emits `Issue(file, line, message)` for violations.
4. Aggregator collects issues from all visitors.

```java
class NoSystemOutVisitor extends VoidVisitorAdapter<List<Issue>> {
    public void visit(MethodCallExpr m, List<Issue> issues) {
        if (m.toString().startsWith("System.out.")) {
            issues.add(new Issue(m.getRange().get(), "Use logger instead"));
        }
        super.visit(m, issues);
    }
}
```

Plugins extend by adding new visitors. AST stays untouched. Classic Visitor + extension model.

### Q42: Design a code formatter.

**A.** A Visitor that walks AST emitting tokens with formatting rules:
- Pre-order: emit opening tokens (e.g., `class X {`, `if (cond) {`).
- Recurse into children with adjusted indent.
- Post-order: emit closing tokens (`}`).

The visitor maintains state: current indent, line buffer, max line width. For wrapping: builder accumulates tokens; `LineWrapper` decides where to break.

Prettier, Black, gofmt all use Visitor-based architectures.

### Q43: Design a query optimizer for a database.

**A.** SQL parsed → query AST. Optimization passes as visitors:
1. **Constant folding:** `WHERE 1+1 = 2` → `WHERE TRUE`.
2. **Predicate pushdown:** `JOIN ... WHERE ... → JOIN with predicate inside`.
3. **Index selection:** annotate tables with available indexes.
4. **Join reordering:** transform tree.
5. **Plan generation:** emit physical plan.

Each pass is a Visitor; pass manager schedules them. Output of one feeds next.

### Q44: Design a JSON / XML pretty printer.

**A.** Document tree (object, array, string, number) with `accept(visitor)`. PrettyPrinter visitor: maintains indent; emits formatted output. JsonRenderer visitor for compact form. Different visitors = different outputs.

### Q45: Design an HTML sanitizer.

**A.** Parse HTML → DOM tree. Visitor walks tree:
- Allowed tags pass through.
- Disallowed tags removed.
- Disallowed attributes stripped.
- URLs validated.

Emits sanitized HTML. Classic Visitor over a stable hierarchy (HTML element types).

---

## Anti-pattern / "What's wrong" Questions

### Q46: What's wrong with this Visitor?

```java
class Visitor {
    public void visit(Object node) {
        if (node instanceof Circle) doCircle((Circle) node);
        if (node instanceof Square) doSquare((Square) node);
        // ...
    }
}
```

**A.** Not really a Visitor — it's a switch on type. No double dispatch. Adding a new shape requires editing this switch. The whole point of Visitor (separation of operation from class hierarchy via accept) is missing. Use proper Visitor with `accept(visitor)` on each element.

### Q47: What's wrong here?

```java
class StatsVisitor implements ShapeVisitor<Double> {
    private double total = 0;

    public Double visitCircle(Circle c) {
        total += Math.PI * c.radius * c.radius;
        return total;   // returns running total
    }
}
```

**A.** Confused responsibilities. The visitor's return value is a *running total*, not the shape's area. Either:
1. Use the visitor for traversal only, expose `total()` getter at end.
2. Return area per-call; let caller sum.

Mixing leads to bugs.

### Q48: What's wrong?

```java
class GodVisitor implements ShapeVisitor<Map<String, Object>> {
    public Map<String, Object> visitCircle(Circle c) {
        return Map.of(
            "area", Math.PI * c.radius * c.radius,
            "svg", "<circle .../>",
            "json", "{\"type\":\"circle\"...}"
        );
    }
    // ...
}
```

**A.** One visitor doing too many unrelated things. Split into AreaVisitor, SvgVisitor, JsonVisitor. Each visitor = one job. Composing = run them in sequence.

### Q49: Why is this bad?

```java
class Circle {
    public double radius;       // public for visitor
    public Point center;        // public for visitor
    public Color border;        // public for visitor
    // ... 20 more public fields
}
```

**A.** Visitor has broken encapsulation completely. Element exposes everything for visitor's benefit. If Visitor needs *that much* internal state, the operations probably belong on the class. Reconsider whether Visitor is the right pattern.

### Q50: What's the issue?

```java
class CycleSafeVisitor implements ExprVisitor<Void> {
    Set<Expr> visited = new HashSet<>();
    public Void visitBin(Bin b) {
        if (!visited.add(b)) return null;
        b.l().accept(this);
        b.r().accept(this);
        return null;
    }
}
```

**A.** Uses regular `HashSet` → equality-based comparison. Two structurally-equal-but-distinct subtrees both skipped. For DAG/cycle detection, want **identity-based** comparison: `Collections.newSetFromMap(new IdentityHashMap<>())`. Otherwise can miss legitimate visits.

---

## Cross-pattern Questions

### Q51: Visitor vs Strategy?

**A.** Strategy: one operation, swappable algorithms. Visitor: many operations, one hierarchy. Strategy is single dispatch on the strategy; Visitor is double dispatch on element + visitor.

### Q52: Visitor vs Iterator?

**A.** Iterator yields elements; client processes them. Visitor visits elements; visitor processes them. Iterator: external traversal. Visitor: internal traversal (typically). Combined: external iterator yields nodes; each node accepts a visitor.

### Q53: Visitor vs Composite?

**A.** Composite: structures a tree. Visitor: operates on a tree. Often combined — Visitor walks Composite. Composite stays focused on structure; Visitor on operation.

### Q54: Visitor vs Command?

**A.** Command encapsulates *one* operation as an object (plus undo). Visitor encapsulates *many* operations across a class hierarchy. Command is for queueing/logging operations; Visitor is for organizing operations on a stable hierarchy.

### Q55: Visitor vs Interpreter?

**A.** Interpreter pattern: each AST node has an `interpret()` method (operations on element). Visitor: external visitors operate on AST. **Interpreter pollutes nodes with operations; Visitor keeps them clean.** Modern compilers prefer Visitor for this reason.

### Q56: Can Visitor and Memento work together?

**A.** Yes — a Visitor that mutates a tree could capture Mementos before each change for undo. The Visitor performs the operation; the Memento captures the inverse.

### Q57: Visitor + Decorator?

**A.** Decorate a Visitor with timing, logging, caching:

```java
class TimingVisitor<R> implements V<R> {
    private V<R> inner;
    public R visitX(X x) {
        long start = System.nanoTime();
        R r = inner.visitX(x);
        record(System.nanoTime() - start);
        return r;
    }
}
```

Generic wrapper. Pure Decorator over the Visitor interface.

### Q58: Visitor vs Pattern matching?

**A.** Pattern matching: language-level dispatch on type, no class scaffolding. Visitor: pattern (in OOP without language support). For modern languages with sealed types + exhaustive switches, prefer pattern matching. Visitor still needed for plugin-extensible operations or stateful traversals.

---

## Quick Drills (1-line answers)

- **Visitor solves which problem?** Adding operations to a stable class hierarchy without modifying classes.
- **What's double dispatch?** Method selection based on two object types: receiver and argument.
- **Why does Visitor use `accept`?** To dispatch on element's runtime type via virtual call.
- **One-line Visitor pitfall:** Adding new element types breaks every visitor.
- **Modern alternative to Visitor in Java?** Sealed types + exhaustive switch (Java 17+).
- **Modern alternative in TypeScript?** Discriminated unions + switch.
- **Modern alternative in Rust?** Enum + match (built-in).
- **Modern alternative in Clojure?** Multimethods.
- **What's the expression problem?** Extending in two dimensions (types AND operations) is hard in single-dispatch OOP.
- **AST visitor in real life?** ANTLR, javac, Roslyn, ESLint, prettier, Babel.
- **One-line: when use Acyclic Visitor?** Plugin systems where adding elements shouldn't recompile unrelated visitors.
- **Visitor + Composite?** Composite structures the tree; Visitor performs operations on it.
- **One performance gotcha:** Megamorphic call sites in deep ASTs (~5ns × N nodes).
- **One safety gotcha:** Reused stateful visitors retain previous run's state.
- **One design gotcha:** Visitor can't access private element state without exposure.
- **Pre-order vs post-order:** Pre = parent first (code emit); Post = children first (evaluation).
- **Best language support:** Pattern matching (Rust, Haskell, modern Java/Kotlin/Scala).
- **Best industry use:** Compilers; LLVM, Roslyn, javac, V8.
- **Worst use case:** Hierarchies that change frequently.
- **Pitfall: cycles?** Use identity-based visited set.
- **Tree mutation strategy?** Return new node when changed; reuse when unchanged (structural sharing).

---

## Tips for Interviews

1. **Lead with the *why*.** "Visitor separates operations from a stable class hierarchy" — get to the problem, then the mechanism.
2. **Mention the trade-off.** Easy to add operations, hard to add types. Interviewers want to see you grasp the cost.
3. **Mention the modern alternative.** Sealed + switch is the new normal. Knowing both shows breadth.
4. **Show code.** Even just sketching `accept` + `visitX` demonstrates double dispatch.
5. **Reference real-world.** Compilers, ANTLR, ASM, Roslyn — anchors the pattern.
6. **Don't oversell.** Visitor is overkill for 1-2 operations. Saying "I'd use Visitor here" without justification looks naive.
7. **The expression problem.** Bonus points for citing it — shows theoretical depth.
8. **Performance numbers.** "Two virtual calls per node" + JIT inlining + memory layout = senior-level answer.
9. **Visitor + state.** Mention stateful visitors, depth tracking, parent stacks — real production patterns.
10. **Test the visitor.** Property-based testing for rewriters; snapshot for renderers — shows engineering maturity.

---

[← Professional](professional.md) · [Tasks →](tasks.md)
