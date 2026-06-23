# Visitor — Optimize

> **Source:** [refactoring.guru/design-patterns/visitor](https://refactoring.guru/design-patterns/visitor)

Each section presents a Visitor that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Replace with sealed types + switch](#optimization-1-replace-with-sealed-types-switch)
2. [Optimization 2: Structural sharing on rewrite](#optimization-2-structural-sharing-on-rewrite)
3. [Optimization 3: Hash-cons identical subtrees](#optimization-3-hash-cons-identical-subtrees)
4. [Optimization 4: Iterative traversal for deep trees](#optimization-4-iterative-traversal-for-deep-trees)
5. [Optimization 5: Arena-allocated AST](#optimization-5-arena-allocated-ast)
6. [Optimization 6: Specialize for primitive return types](#optimization-6-specialize-for-primitive-return-types)
7. [Optimization 7: Skip unaffected subtrees](#optimization-7-skip-unaffected-subtrees)
8. [Optimization 8: Compose visitors into one walk](#optimization-8-compose-visitors-into-one-walk)
9. [Optimization 9: Cache results for read-only visitors](#optimization-9-cache-results-for-read-only-visitors)
10. [Optimization 10: Parallel visitor for independent subtrees](#optimization-10-parallel-visitor-for-independent-subtrees)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Replace with sealed types + switch

### Before

```java
public interface ShapeVisitor<R> {
    R visitCircle(Circle c);
    R visitSquare(Square s);
    R visitTriangle(Triangle t);
}

public class AreaVisitor implements ShapeVisitor<Double> {
    public Double visitCircle(Circle c)     { return Math.PI * c.radius * c.radius; }
    public Double visitSquare(Square s)     { return s.side * s.side; }
    public Double visitTriangle(Triangle t) { return 0.5 * t.base * t.height; }
}

double total = shapes.stream()
    .mapToDouble(s -> s.accept(new AreaVisitor()))
    .sum();
```

Two virtual calls per shape (`accept` + `visit`). Also `Double` boxing on every call.

### After

```java
public sealed interface Shape permits Circle, Square, Triangle {}
public record Circle(double radius) implements Shape {}
public record Square(double side) implements Shape {}
public record Triangle(double base, double height) implements Shape {}

double area(Shape s) {
    return switch (s) {
        case Circle c     -> Math.PI * c.radius() * c.radius();
        case Square sq    -> sq.side() * sq.side();
        case Triangle t   -> 0.5 * t.base() * t.height();
    };
}

double total = shapes.stream().mapToDouble(this::area).sum();
```

**Measurement.** JIT compiles switch over sealed types into `tableswitch` bytecode. No virtual dispatch, no boxing. ~2-3× faster than Visitor.

**Trade-off.** Operations live in functions, not classes. Less organization for many operations. Adding a new shape forces switch updates everywhere — but the compiler enforces it.

**Lesson:** For stable hierarchies in modern Java/Kotlin/Scala/TypeScript/Rust, sealed types + pattern matching outperform Visitor on every dimension *if* operations don't need class-level organization.

---

## Optimization 2: Structural sharing on rewrite

### Before

```java
public final class Renamer implements ExprVisitor<Expr> {
    private final String from, to;

    public Expr visitVar(Var v) {
        return v.name().equals(from) ? new Var(to) : new Var(v.name());   // always new
    }

    public Expr visitNum(Num n) { return new Num(n.value()); }   // always new

    public Expr visitBin(Bin b) {
        return new Bin(b.left().accept(this), b.op(), b.right().accept(this));   // always new
    }
}
```

Every visit allocates. For a 1M-node tree, 1M new objects per traversal. GC pressure huge.

### After

```java
public final class Renamer implements ExprVisitor<Expr> {
    private final String from, to;

    public Expr visitVar(Var v) {
        return v.name().equals(from) ? new Var(to) : v;   // reuse if no change
    }

    public Expr visitNum(Num n) { return n; }   // never changes

    public Expr visitBin(Bin b) {
        Expr l = b.left().accept(this);
        Expr r = b.right().accept(this);
        if (l == b.left() && r == b.right()) return b;   // structural sharing
        return new Bin(l, b.op(), r);
    }
}
```

**Measurement.** For a tree where 10% of variables match `from`: ~90% reduction in allocations. Only the path from root to changed leaves allocates. **Persistent data structure principle.**

**Lesson:** Mutating visitors must reuse unchanged subtrees. Roslyn, Scalameta, all major compilers do this. O(log N) allocations per change instead of O(N).

---

## Optimization 3: Hash-cons identical subtrees

### Before

```java
Expr e1 = new Bin(new Num(1), "+", new Num(2));
Expr e2 = new Bin(new Num(1), "+", new Num(2));   // different instance
e1.equals(e2);   // true (record equals)
e1 == e2;        // false (separate objects)
// ... 1M such expressions in memory
```

Memory bloated by duplicate subtrees.

### After

```java
public final class AstFactory {
    private final Map<Object, Expr> cache = new ConcurrentHashMap<>();

    public Num num(double value) {
        return (Num) cache.computeIfAbsent(
            new NumKey(value),
            k -> new Num(value)
        );
    }

    public Bin bin(Expr l, String op, Expr r) {
        return (Bin) cache.computeIfAbsent(
            new BinKey(l, op, r),
            k -> new Bin(l, op, r)
        );
    }

    record NumKey(double value) {}
    record BinKey(Expr l, String op, Expr r) {}
}

AstFactory f = new AstFactory();
Expr e1 = f.bin(f.num(1), "+", f.num(2));
Expr e2 = f.bin(f.num(1), "+", f.num(2));
e1 == e2;   // true (same instance)
```

**Measurement.** For ASTs with many duplicate sub-expressions (typical compiler input): ~50-90% memory reduction. Equality checks become reference comparisons (~ns vs structural comparison).

**Trade-off.** Cache lookups have overhead per node creation. Use only for long-lived ASTs. Concurrent cache for thread safety.

**Lesson:** SMT solvers (Z3, CVC), proof assistants (Coq, Lean), and many compilers hash-cons. Memory-bounded by *unique* subtrees, not total.

---

## Optimization 4: Iterative traversal for deep trees

### Before

```java
public final class Evaluator implements ExprVisitor<Double> {
    public Double visitBin(Bin b) {
        return combine(b.left().accept(this), b.op(), b.right().accept(this));
    }
    public Double visitNum(Num n) { return n.value(); }
    public Double visitVar(Var v) { return env.get(v.name()); }
}

// Right-recursive tree of depth 1M:
Expr deep = buildRightRecursive(1_000_000);
deep.accept(new Evaluator());   // StackOverflowError
```

Default JVM stack ~512KB; ~32K frames. Deep trees crash.

### After

```java
public Double evaluate(Expr root) {
    Deque<Expr> work = new ArrayDeque<>();
    Deque<Object> values = new ArrayDeque<>();
    work.push(root);

    while (!work.isEmpty()) {
        Object current = work.pop();
        if (current instanceof Num n) {
            values.push(n.value());
        } else if (current instanceof Var v) {
            values.push(env.get(v.name()));
        } else if (current instanceof Bin b) {
            work.push(new Combine(b.op()));
            work.push(b.right());
            work.push(b.left());
        } else if (current instanceof Combine c) {
            double r = (Double) values.pop();
            double l = (Double) values.pop();
            values.push(combine(l, c.op(), r));
        }
    }
    return (Double) values.pop();
}
```

**Measurement.** Stack lives in heap; depth bounded by RAM (gigabytes), not stack (KB). Required for deep ASTs in production.

**Trade-off.** More code; less natural recursion. Use only when stack overflow is a real risk.

**Lesson:** For input data of unbounded depth (e.g., user-supplied expressions, deeply nested JSON), iterative traversal is mandatory. JVM has no tail-call optimization.

---

## Optimization 5: Arena-allocated AST

### Before

```java
// Each AST node allocated separately:
Expr ast = new Bin(
    new Num(1),
    "+",
    new Bin(new Num(2), "*", new Num(3))
);
// In heap: nodes scattered randomly.
```

Cache misses every node access during traversal.

### After

```java
public final class AstArena {
    private final Object[] nodes = new Object[1024 * 1024];
    private int next = 0;

    public Num num(double value) {
        Num n = new Num(value);
        nodes[next++] = n;
        return n;
    }

    public Bin bin(Expr l, String op, Expr r) {
        Bin b = new Bin(l, op, r);
        nodes[next++] = b;
        return b;
    }
}

AstArena arena = new AstArena();
Expr ast = arena.bin(
    arena.num(1),
    "+",
    arena.bin(arena.num(2), "*", arena.num(3))
);
```

**Measurement.** Pre-order traversal with arena: nodes adjacent in memory → cache-friendly access. ~3-5× faster traversal for large ASTs (cache miss savings).

**Trade-off.** GC less effective (many references in the array). Arena freed all-at-once after compilation. Suits compile-once / discard-once workloads.

**Lesson:** ANTLR, Roslyn, V8 use arena allocation. For long-lived ASTs (IDE PSI), conventional allocation may be better; for one-shot compilation, arena wins.

---

## Optimization 6: Specialize for primitive return types

### Before

```java
public interface ShapeVisitor<R> {
    R visitCircle(Circle c);
    R visitSquare(Square s);
}

class AreaVisitor implements ShapeVisitor<Double> {
    public Double visitCircle(Circle c) { return Math.PI * c.radius * c.radius; }
    public Double visitSquare(Square s) { return s.side * s.side; }
}

double total = shapes.stream()
    .mapToDouble(s -> s.accept(new AreaVisitor()))
    .sum();
```

`Double` autoboxing on every call. 1M shapes = 1M boxed Double allocations.

### After

```java
public interface DoubleShapeVisitor {
    double visitCircle(Circle c);
    double visitSquare(Square s);
}

public sealed interface Shape permits Circle, Square {
    double acceptDouble(DoubleShapeVisitor v);
}

public record Circle(double radius) implements Shape {
    public double acceptDouble(DoubleShapeVisitor v) { return v.visitCircle(this); }
}

public record Square(double side) implements Shape {
    public double acceptDouble(DoubleShapeVisitor v) { return v.visitSquare(this); }
}

class AreaVisitor implements DoubleShapeVisitor {
    public double visitCircle(Circle c) { return Math.PI * c.radius() * c.radius(); }
    public double visitSquare(Square s) { return s.side() * s.side(); }
}

double total = shapes.stream().mapToDouble(s -> s.acceptDouble(new AreaVisitor())).sum();
```

**Measurement.** No boxing. ~10× speedup in tight loops over 1M shapes due to cache locality + zero allocation.

**Trade-off.** Multiple visitor interfaces (one per primitive type). API duplication.

**Lesson:** Java's `IntStream`/`LongStream`/`DoubleStream` exist for this exact reason. For hot paths, primitive specializations matter; generic boxes hurt.

---

## Optimization 7: Skip unaffected subtrees

### Before

```java
public final class TypeChecker implements ExprVisitor<Type> {
    public Type visitBin(Bin b) {
        Type l = b.left().accept(this);
        Type r = b.right().accept(this);
        // ... type-check the operation ...
        return resultType;
    }
}

// On every code change, re-run TypeChecker over entire AST.
```

Even if only one method changed, full AST re-typed.

### After (incremental)

```java
public final class IncrementalTypeChecker implements ExprVisitor<Type> {
    private final Map<Expr, Type> cache;
    private final Set<Expr> dirty;

    public Type visitBin(Bin b) {
        if (!dirty.contains(b) && cache.containsKey(b)) {
            return cache.get(b);   // skip — unchanged
        }
        Type l = b.left().accept(this);
        Type r = b.right().accept(this);
        Type result = computeResultType(l, r, b.op());
        cache.put(b, result);
        return result;
    }
}
```

**Measurement.** Typical edit affects <1% of AST. Re-typing only dirty subtrees: ~100× faster for incremental compilation.

**Trade-off.** Cache invalidation logic. Hard to get right. Need to track dependencies (a changed declaration may invalidate distant references).

**Lesson:** Incremental compilation (Bazel, Pants, Roslyn) saves orders of magnitude. Visitor with selective traversal is the foundation. IDE responsiveness depends on it.

---

## Optimization 8: Compose visitors into one walk

### Before

```java
ast.accept(new Evaluator());     // walk 1
ast.accept(new VarCollector());  // walk 2
ast.accept(new ConstFolder());   // walk 3
```

Three traversals over a 1M-node AST: ~30M virtual calls.

### After

```java
public final class CompositeVisitor implements ExprVisitor<Void> {
    private final List<ExprVisitor<?>> visitors;

    public CompositeVisitor(ExprVisitor<?>... visitors) {
        this.visitors = List.of(visitors);
    }

    public Void visitNum(Num n) {
        for (ExprVisitor<?> v : visitors) v.visitNum(n);
        return null;
    }

    public Void visitVar(Var v) {
        for (ExprVisitor<?> vis : visitors) vis.visitVar(v);
        return null;
    }

    public Void visitBin(Bin b) {
        for (ExprVisitor<?> v : visitors) v.visitBin(b);
        b.left().accept(this);
        b.right().accept(this);
        return null;
    }
}

// One walk:
ast.accept(new CompositeVisitor(eval, varCollector, constFolder));
```

**Measurement.** One traversal vs three: ~3× faster. Cache locality benefit (each node touched once).

**Trade-off.** Visitors must be compatible (same traversal order). Errors in one shouldn't break others. Coupling visitors.

**Lesson:** When traversal is expensive (large AST, expensive node access), batch operations. Roslyn, ESLint, Babel often run multiple analyses in one walk.

---

## Optimization 9: Cache results for read-only visitors

### Before

```java
public final class TreeHeight implements ExprVisitor<Integer> {
    public Integer visitNum(Num n) { return 1; }
    public Integer visitVar(Var v) { return 1; }
    public Integer visitBin(Bin b) {
        return 1 + Math.max(b.left().accept(this), b.right().accept(this));
    }
}

// Call repeatedly on same AST:
for (int i = 0; i < 1000; i++) {
    int h = ast.accept(new TreeHeight());
}
```

Same value computed 1000× on identical AST.

### After

```java
public final class CachedTreeHeight implements ExprVisitor<Integer> {
    private final Map<Expr, Integer> cache = new IdentityHashMap<>();

    public Integer visitNum(Num n) { return cache.computeIfAbsent(n, k -> 1); }
    public Integer visitVar(Var v) { return cache.computeIfAbsent(v, k -> 1); }
    public Integer visitBin(Bin b) {
        return cache.computeIfAbsent(b, k ->
            1 + Math.max(b.left().accept(this), b.right().accept(this))
        );
    }
}

// First call computes; subsequent calls hit cache.
CachedTreeHeight v = new CachedTreeHeight();
for (int i = 0; i < 1000; i++) {
    int h = ast.accept(v);   // first ~ms; rest ~ns
}
```

**Measurement.** First traversal: same as uncached. Subsequent on same AST: ~constant time (single map lookup at root).

**Trade-off.** Cache must be invalidated on AST change. For immutable ASTs: free. For mutable: hard.

**Lesson:** Memoization works perfectly with read-only visitors over immutable trees. IDEs use this for fast re-rendering. Combine with hash-consing for compact memory.

---

## Optimization 10: Parallel visitor for independent subtrees

### Before

```java
public final class ParseAll implements FsVisitor<List<File>> {
    public List<File> visitFile(File f) {
        // expensive: parse the file, run analyzers
        return List.of(parseAndAnalyze(f));
    }

    public List<File> visitDirectory(Directory d) {
        List<File> result = new ArrayList<>();
        for (FsNode child : d.children()) result.addAll(child.accept(this));
        return result;
    }
}

// 1000 files, each takes 50ms → 50s sequential.
```

### After

```java
public final class ParallelParseAll implements FsVisitor<List<File>> {
    public List<File> visitFile(File f) {
        return List.of(parseAndAnalyze(f));
    }

    public List<File> visitDirectory(Directory d) {
        return d.children().parallelStream()
            .flatMap(child -> child.accept(this).stream())
            .toList();
    }
}
```

**Measurement.** With 8 CPU cores: ~8× speedup. 1000 files × 50ms / 8 = ~6s instead of 50s.

**Trade-off.**
- Visitor must be **stateless** or **thread-safe** (each subtree visit independent).
- Order of accumulation may differ — must be commutative (lists become sets if order doesn't matter).
- ForkJoinPool overhead for small tasks; only use for genuinely expensive per-file work.

**Lesson:** Independent subtrees → parallel traversal. Build systems (Bazel), parsers (parallel module compilation), analyzers (linters across files) all parallelize this way. Visitor's recursive structure naturally maps to fork-join.

---

## Optimization Tips

- **Replace Visitor with sealed types + switch** when modern languages allow. JIT optimizes switch into jump tables; Visitor pays vtable cost.
- **Structural sharing on rewrite.** Reuse unchanged subtrees; allocate only on the change path.
- **Hash-cons** identical subtrees in long-lived ASTs. Cuts memory dramatically.
- **Iterative traversal** for unbounded depth. JVM has no tail-call optimization.
- **Arena allocation** for compile-once ASTs. Cache locality dominates.
- **Primitive specializations** for hot-path visitors. No boxing.
- **Skip unaffected subtrees** for incremental work. Cache + dirty tracking.
- **Compose visitors** when traversal is expensive. One walk, multiple operations.
- **Memoize read-only visitors** over immutable trees.
- **Parallelize** when subtrees are independent and per-node work is expensive.
- **Profile first.** Visitor dispatch is rarely the bottleneck; cache misses and allocations usually are. Measure, don't guess.

[← Find Bug](find-bug.md) · [Behavioral patterns home](../README.md)
