# Visitor — Find the Bug

> **Source:** [refactoring.guru/design-patterns/visitor](https://refactoring.guru/design-patterns/visitor)

Each snippet has a bug. Read carefully, identify, fix.

---

## Table of Contents

1. [Bug 1: Stale state in reused visitor](#bug-1-stale-state-in-reused-visitor)
2. [Bug 2: accept calls wrong visit method](#bug-2-accept-calls-wrong-visit-method)
3. [Bug 3: Forgotten recursion in composite](#bug-3-forgotten-recursion-in-composite)
4. [Bug 4: Cycle causes infinite recursion](#bug-4-cycle-causes-infinite-recursion)
5. [Bug 5: HashSet vs IdentityHashMap for visited](#bug-5-hashset-vs-identityhashmap-for-visited)
6. [Bug 6: Mutating visitor returns wrong tree](#bug-6-mutating-visitor-returns-wrong-tree)
7. [Bug 7: Missing visit method silently ignored](#bug-7-missing-visit-method-silently-ignored)
8. [Bug 8: Order of children messes evaluation](#bug-8-order-of-children-messes-evaluation)
9. [Bug 9: Concurrent visitor without synchronization](#bug-9-concurrent-visitor-without-synchronization)
10. [Bug 10: super.visit not called](#bug-10-supervisit-not-called)
11. [Bug 11: Element exposes mutable state to visitor](#bug-11-element-exposes-mutable-state-to-visitor)
12. [Bug 12: Boxing in generic visitor](#bug-12-boxing-in-generic-visitor)

---

## Bug 1: Stale state in reused visitor

```java
public final class CountVisitor implements ExprVisitor<Integer> {
    private int count = 0;

    public Integer visitNum(Num n) {
        count++;
        return count;
    }

    public Integer visitBin(Bin b) {
        count++;
        b.left().accept(this);
        b.right().accept(this);
        return count;
    }
}

CountVisitor v = new CountVisitor();
ast1.accept(v);   // 5 nodes
System.out.println(v.count);   // 5

ast2.accept(v);   // 3 nodes
System.out.println(v.count);   // 8 — bug!
```

**Bug.** `count` is not reset between traversals. The second result includes the first.

**Fix.** Reset before each traversal, or make the visitor one-shot:

```java
ast1.accept(v); System.out.println(v.count);
v.count = 0;   // reset
ast2.accept(v); System.out.println(v.count);
```

Or better, make the visitor not have stateful fields — return the count from `accept`:

```java
public Integer visitBin(Bin b) {
    return 1 + b.left().accept(this) + b.right().accept(this);
}
```

Stateless visitors are safer. Stateful ones must be reset or one-shot.

---

## Bug 2: accept calls wrong visit method

```java
public final class Square implements Shape {
    public final double side;
    public Square(double side) { this.side = side; }

    public <R> R accept(ShapeVisitor<R> v) {
        return v.visitCircle(new Circle(side));   // BUG: wrong method
    }
}
```

**Bug.** `Square.accept` calls `visitCircle` — total disaster. Square's area would be calculated as if it were a circle.

**Fix.**

```java
public <R> R accept(ShapeVisitor<R> v) {
    return v.visitSquare(this);
}
```

This is a common copy-paste mistake. Test each `accept` to ensure it dispatches correctly. A simple integration test:

```java
@Test void squareDispatchesToVisitSquare() {
    var marker = new ShapeVisitor<String>() {
        public String visitCircle(Circle c)   { return "circle"; }
        public String visitSquare(Square s)   { return "square"; }
        public String visitTriangle(Triangle t) { return "triangle"; }
    };
    assertEquals("square", new Square(1).accept(marker));
}
```

---

## Bug 3: Forgotten recursion in composite

```java
public final class CountVisitor implements ExprVisitor<Integer> {
    public Integer visitNum(Num n) { return 1; }
    public Integer visitVar(Var v) { return 1; }
    public Integer visitBin(Bin b) {
        return 1;   // BUG: doesn't recurse
    }
}

Expr ast = new Bin(new Num(1), "+", new Bin(new Num(2), "*", new Num(3)));
System.out.println(ast.accept(new CountVisitor()));   // 1 — wrong; should be 5
```

**Bug.** `visitBin` returns 1 without visiting children. For composite/recursive structures, the visit method MUST recurse.

**Fix.**

```java
public Integer visitBin(Bin b) {
    return 1 + b.left().accept(this) + b.right().accept(this);
}
```

This is a dual to Composite's "iterate over children" duty. The Visitor's job is to recurse explicitly via the children's `accept`.

For frameworks (e.g., JDT's `ASTVisitor`): returning `false` from a `visit(node)` skips children. Be aware of the convention.

---

## Bug 4: Cycle causes infinite recursion

```java
class Node {
    List<Node> children = new ArrayList<>();
    public void accept(NodeVisitor v) { v.visit(this); }
}

class PrintVisitor implements NodeVisitor {
    public void visit(Node n) {
        System.out.println(n);
        for (Node c : n.children) c.accept(this);
    }
}

// Setup:
Node a = new Node(), b = new Node();
a.children.add(b);
b.children.add(a);   // cycle!

a.accept(new PrintVisitor());   // StackOverflowError
```

**Bug.** Visitor enters infinite recursion on cyclic graph.

**Fix.** Track visited nodes:

```java
class PrintVisitor implements NodeVisitor {
    private final Set<Node> visited = Collections.newSetFromMap(new IdentityHashMap<>());

    public void visit(Node n) {
        if (!visited.add(n)) return;   // already seen
        System.out.println(n);
        for (Node c : n.children) c.accept(this);
    }
}
```

`IdentityHashMap` ensures we compare by reference. Without it, structurally-equal-but-distinct nodes would all be skipped, missing legitimate visits.

---

## Bug 5: HashSet vs IdentityHashMap for visited

```java
class CycleSafeVisitor implements ExprVisitor<Void> {
    private Set<Expr> visited = new HashSet<>();

    public Void visitBin(Bin b) {
        if (!visited.add(b)) return null;
        b.left().accept(this);
        b.right().accept(this);
        return null;
    }
    // ...
}

// AST has shared subtree:
Num n = new Num(1);
Expr ast = new Bin(new Bin(n, "+", n), "*", n);   // n appears 3 times
ast.accept(new CycleSafeVisitor());   // n visited only ONCE, not 3 times — bug
```

**Bug.** `HashSet` uses `equals/hashCode`. If `Num` is a record (or implements equality by value), all `Num(1)` instances are equal — visiting one skips the others.

**Fix.** Use identity-based set:

```java
private Set<Expr> visited = Collections.newSetFromMap(new IdentityHashMap<>());
```

Now each instance is treated as distinct, even if structurally equal.

**Trade-off:** if shared subtrees should be visited once (DAG, hash-consed AST), use `equals` (HashSet). If each occurrence must be visited, use identity (IdentityHashMap). Pick based on semantics.

---

## Bug 6: Mutating visitor returns wrong tree

```java
public final class Renamer implements ExprVisitor<Expr> {
    private final String from, to;

    public Renamer(String from, String to) {
        this.from = from;
        this.to = to;
    }

    public Expr visitVar(Var v) {
        return v.name().equals(from) ? new Var(to) : v;
    }

    public Expr visitBin(Bin b) {
        b.left().accept(this);   // BUG: result discarded
        b.right().accept(this);  // BUG: result discarded
        return b;                 // returns original — rename never applied
    }

    public Expr visitNum(Num n) { return n; }
}
```

**Bug.** `visitBin` doesn't capture return values. The renamed children are discarded; the original `b` returned.

**Fix.**

```java
public Expr visitBin(Bin b) {
    Expr l = b.left().accept(this);
    Expr r = b.right().accept(this);
    if (l == b.left() && r == b.right()) return b;   // structural sharing
    return new Bin(l, b.op(), r);
}
```

Now changes propagate up. The `if` is an optimization: reuse the original node when nothing changed.

---

## Bug 7: Missing visit method silently ignored

```java
public abstract class DefaultVisitor<R> implements ExprVisitor<R> {
    public R visitNum(Num n)   { return defaultValue(); }
    public R visitVar(Var v)   { return defaultValue(); }
    public R visitBin(Bin b)   {
        b.left().accept(this);
        b.right().accept(this);
        return defaultValue();
    }
    protected abstract R defaultValue();
}

public class CollectNumbers extends DefaultVisitor<List<Double>> {
    private List<Double> nums = new ArrayList<>();

    public List<Double> visitNum(Num n) {
        nums.add(n.value());
        return nums;
    }

    protected List<Double> defaultValue() { return List.of(); }
}

// Usage:
Expr ast = new Bin(new Num(1), "+", new Var("x"));
ast.accept(new CollectNumbers());
// nums = []  — bug! should contain [1.0]
```

**Bug.** `CollectNumbers` overrides `visitNum` (modifying `nums` field) but `visitBin` (inherited) returns `defaultValue()` after recursing. The recursion happens, but the result is discarded.

This works *if* the visitor uses field accumulation (like `nums`). But the *return value* of `visitBin` is always `[]`, not what user expects.

**Fix.** Either:

1. Override `visitBin` to merge child results:

```java
public List<Double> visitBin(Bin b) {
    List<Double> l = b.left().accept(this);
    List<Double> r = b.right().accept(this);
    nums.addAll(l);
    nums.addAll(r);
    return nums;
}
```

2. Return the field directly:

```java
public List<Double> visitNum(Num n) {
    nums.add(n.value());
    return null;   // or new ArrayList<>(nums)
}

// Then read 'nums' externally:
CollectNumbers v = new CollectNumbers();
ast.accept(v);
System.out.println(v.nums);
```

The bug shows: when extending a default visitor, beware of inherited methods that don't propagate your changes. Either override completely or use field-based accumulation with explicit getters.

---

## Bug 8: Order of children messes evaluation

```java
public final class Subtraction implements ExprVisitor<Double> {
    public Double visitBin(Bin b) {
        if (!b.op().equals("-")) throw new IllegalStateException();
        double r = b.right().accept(this);
        double l = b.left().accept(this);
        return l - r;   // looks right
    }
    // ... other visit methods
}
```

**Bug.** Code is correct *mathematically*, but if visitors have side effects (logging, profiling) that depend on left-to-right order, evaluating right first surprises.

For pure functional eval: no issue.
For logging visitor:

```java
public Void visitBin(Bin b) {
    b.right().accept(this);   // logs right child first
    b.left().accept(this);    // then left
    return null;
}
```

Output order is reversed from source. If users expect left-to-right output, bug.

**Fix.** Be deliberate about order. Pre-/in-/post-order are documented choices:

```java
public Double visitBin(Bin b) {
    double l = b.left().accept(this);   // left first
    double r = b.right().accept(this);
    return switch (b.op()) {
        case "+" -> l + r;
        case "-" -> l - r;
        case "*" -> l * r;
        case "/" -> l / r;
        default  -> throw new IllegalStateException();
    };
}
```

For non-commutative operators (`-`, `/`), order matters. Make it explicit and document.

---

## Bug 9: Concurrent visitor without synchronization

```java
public final class CounterVisitor implements ExprVisitor<Void> {
    private int count = 0;

    public Void visitNum(Num n) {
        count++;
        return null;
    }

    public Void visitBin(Bin b) {
        count++;
        b.left().accept(this);
        b.right().accept(this);
        return null;
    }

    public int count() { return count; }
}

// Run on multiple threads:
CounterVisitor v = new CounterVisitor();
List<Expr> trees = ...;
trees.parallelStream().forEach(t -> t.accept(v));
System.out.println(v.count());   // race condition — wrong
```

**Bug.** `count` mutated from multiple threads without synchronization. Lost updates → undercounts.

**Fix.** Either:

1. **One visitor per thread:**

```java
trees.parallelStream()
    .mapToInt(t -> {
        CounterVisitor v = new CounterVisitor();
        t.accept(v);
        return v.count();
    })
    .sum();
```

2. **Atomic counter:**

```java
private final AtomicInteger count = new AtomicInteger();

public Void visitNum(Num n) {
    count.incrementAndGet();
    return null;
}
```

Stateful visitors should not be shared across threads. Default to one-per-thread.

---

## Bug 10: super.visit not called

```java
public class JavaCounter extends VoidVisitorAdapter<Integer> {
    private int methodCount = 0;

    @Override
    public void visit(MethodDeclaration m, Integer arg) {
        methodCount++;
        // missing super.visit(m, arg)  — bug: doesn't recurse into method body
    }

    public int count() { return methodCount; }
}
```

**Bug.** `JavaParser`'s `VoidVisitorAdapter` requires explicit `super.visit(m, arg)` to recurse into children. Without it, nested classes' methods are missed.

**Fix.**

```java
@Override
public void visit(MethodDeclaration m, Integer arg) {
    methodCount++;
    super.visit(m, arg);   // recurse into method body, find inner classes
}
```

Many frameworks (JavaParser, JDT, ANTLR Listener) require `super` calls. Common pitfall — easy to forget in tutorials, leads to incomplete analysis. Always read the framework's recursion contract.

---

## Bug 11: Element exposes mutable state to visitor

```java
public class Polygon implements Shape {
    public List<Point> vertices = new ArrayList<>();   // public mutable

    public <R> R accept(ShapeVisitor<R> v) { return v.visitPolygon(this); }
}

public class CenterOfMassVisitor implements ShapeVisitor<Point> {
    public Point visitPolygon(Polygon p) {
        p.vertices.add(new Point(0, 0));   // BUG: mutates the element!
        return centroidOf(p.vertices);
    }
}
```

**Bug.** Visitor mutates element. Two issues:
1. Element shouldn't expose mutable internals.
2. Visitor shouldn't mutate the element it's visiting (unless it's an explicit rewriting visitor that returns a new element).

**Fix.** Encapsulate:

```java
public class Polygon implements Shape {
    private final List<Point> vertices;

    public Polygon(List<Point> vertices) {
        this.vertices = List.copyOf(vertices);   // immutable copy
    }

    public List<Point> vertices() { return vertices; }
}
```

And:

```java
public class CenterOfMassVisitor implements ShapeVisitor<Point> {
    public Point visitPolygon(Polygon p) {
        return centroidOf(p.vertices());   // read-only access
    }
}
```

Pure read-only visitor; immutable element. Thread-safe, side-effect-free.

---

## Bug 12: Boxing in generic visitor

```java
public interface ShapeVisitor<R> {
    R visitCircle(Circle c);
    R visitSquare(Square s);
}

public class HotPath implements ShapeVisitor<Double> {
    public Double visitCircle(Circle c) { return Math.PI * c.radius * c.radius; }
    public Double visitSquare(Square s) { return s.side * s.side; }
}

double total = shapes.stream()
    .mapToDouble(s -> s.accept(new HotPath()))
    .sum();
```

**Bug.** `R = Double` → autoboxing on every visit. For 1M shapes: 1M `Double` allocations. GC pressure.

**Fix.** Use a primitive-specific visitor interface:

```java
public interface DoubleShapeVisitor {
    double visitCircle(Circle c);
    double visitSquare(Square s);
}

public class HotPath implements DoubleShapeVisitor {
    public double visitCircle(Circle c) { return Math.PI * c.radius * c.radius; }
    public double visitSquare(Square s) { return s.side * s.side; }
}

// Update accept signatures or have separate accept method:
public interface Shape {
    <R> R accept(ShapeVisitor<R> v);
    double acceptDouble(DoubleShapeVisitor v);
}
```

For hot paths, primitive specializations matter. Java's stream API has `IntStream`, `LongStream`, `DoubleStream` for this reason. Generic `Stream<Integer>` boxes; primitive streams don't.

Same lesson for visitors in tight loops: primitive return = no allocation.

---

[← Tasks](tasks.md) · [Optimize →](optimize.md)
