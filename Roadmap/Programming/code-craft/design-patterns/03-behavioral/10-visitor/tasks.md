# Visitor — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/visitor](https://refactoring.guru/design-patterns/visitor)

Each task includes a brief and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Shape area + perimeter](#task-1-shape-area-perimeter)
2. [Task 2: Expression evaluator](#task-2-expression-evaluator)
3. [Task 3: File system size + count](#task-3-file-system-size-count)
4. [Task 4: AST pretty printer](#task-4-ast-pretty-printer)
5. [Task 5: Constant folding](#task-5-constant-folding)
6. [Task 6: HTML sanitizer](#task-6-html-sanitizer)
7. [Task 7: JSON renderer](#task-7-json-renderer)
8. [Task 8: Variable collector](#task-8-variable-collector)
9. [Task 9: Visitor for refactoring (rename)](#task-9-visitor-for-refactoring-rename)
10. [Task 10: Refactor instanceof chain to Visitor](#task-10-refactor-instanceof-chain-to-visitor)
11. [How to Practice](#how-to-practice)

---

## Task 1: Shape area + perimeter

**Brief.** Build a `Shape` hierarchy (`Circle`, `Square`, `Triangle`). Two visitors: `AreaVisitor` (returns area) and `PerimeterVisitor` (returns perimeter).

### Solution (Java)

```java
public sealed interface Shape permits Circle, Square, Triangle {
    <R> R accept(ShapeVisitor<R> v);
}

public record Circle(double radius) implements Shape {
    public <R> R accept(ShapeVisitor<R> v) { return v.visitCircle(this); }
}

public record Square(double side) implements Shape {
    public <R> R accept(ShapeVisitor<R> v) { return v.visitSquare(this); }
}

public record Triangle(double a, double b, double c) implements Shape {
    public <R> R accept(ShapeVisitor<R> v) { return v.visitTriangle(this); }
}

public interface ShapeVisitor<R> {
    R visitCircle(Circle c);
    R visitSquare(Square s);
    R visitTriangle(Triangle t);
}

public final class AreaVisitor implements ShapeVisitor<Double> {
    public Double visitCircle(Circle c)     { return Math.PI * c.radius() * c.radius(); }
    public Double visitSquare(Square s)     { return s.side() * s.side(); }
    public Double visitTriangle(Triangle t) {
        double s = (t.a() + t.b() + t.c()) / 2;
        return Math.sqrt(s * (s - t.a()) * (s - t.b()) * (s - t.c()));   // Heron's
    }
}

public final class PerimeterVisitor implements ShapeVisitor<Double> {
    public Double visitCircle(Circle c)     { return 2 * Math.PI * c.radius(); }
    public Double visitSquare(Square s)     { return 4 * s.side(); }
    public Double visitTriangle(Triangle t) { return t.a() + t.b() + t.c(); }
}

class Demo {
    public static void main(String[] args) {
        List<Shape> shapes = List.of(
            new Circle(5),
            new Square(4),
            new Triangle(3, 4, 5)
        );
        AreaVisitor av = new AreaVisitor();
        PerimeterVisitor pv = new PerimeterVisitor();
        shapes.forEach(s -> {
            System.out.printf("%s → area=%.2f perimeter=%.2f%n",
                s, s.accept(av), s.accept(pv));
        });
    }
}
```

Two operations on the same hierarchy. Adding `Hexagon` requires updating `Shape` permits + both visitors.

---

## Task 2: Expression evaluator

**Brief.** Expression AST: `Num`, `Var`, `Bin`. Visitor evaluates the expression with a variable environment.

### Solution (TypeScript)

```typescript
type Expr =
    | { kind: "num"; value: number }
    | { kind: "var"; name: string }
    | { kind: "bin"; op: "+" | "-" | "*" | "/"; l: Expr; r: Expr };

interface Visitor<R> {
    visitNum(e: { value: number }): R;
    visitVar(e: { name: string }): R;
    visitBin(e: { op: string; l: Expr; r: Expr }): R;
}

function visit<R>(e: Expr, v: Visitor<R>): R {
    switch (e.kind) {
        case "num": return v.visitNum(e);
        case "var": return v.visitVar(e);
        case "bin": return v.visitBin(e);
    }
}

class Evaluator implements Visitor<number> {
    constructor(private env: Record<string, number>) {}
    visitNum(e: { value: number }): number { return e.value; }
    visitVar(e: { name: string }): number  { return this.env[e.name] ?? 0; }
    visitBin(e: { op: string; l: Expr; r: Expr }): number {
        const a = visit(e.l, this);
        const b = visit(e.r, this);
        switch (e.op) {
            case "+": return a + b;
            case "-": return a - b;
            case "*": return a * b;
            case "/": return a / b;
            default: throw new Error("op");
        }
    }
}

const ast: Expr = {
    kind: "bin", op: "+",
    l: { kind: "num", value: 1 },
    r: { kind: "bin", op: "*", l: { kind: "var", name: "x" }, r: { kind: "num", value: 3 } }
};

const v = new Evaluator({ x: 2 });
console.log(visit(ast, v));   // 7
```

Discriminated union + visitor: TypeScript's natural form. The `visit` helper does the dispatch.

---

## Task 3: File system size + count

**Brief.** `File` and `Directory` form a tree. Two visitors: total size, file count.

### Solution (Python)

```python
from abc import ABC, abstractmethod
from typing import Generic, TypeVar

R = TypeVar("R")


class FsNode(ABC):
    def __init__(self, name: str): self.name = name
    @abstractmethod
    def accept(self, v: "FsVisitor[R]") -> R: ...


class File(FsNode):
    def __init__(self, name: str, size: int):
        super().__init__(name)
        self.size = size

    def accept(self, v): return v.visit_file(self)


class Directory(FsNode):
    def __init__(self, name: str, children: list[FsNode]):
        super().__init__(name)
        self.children = children

    def accept(self, v): return v.visit_directory(self)


class FsVisitor(ABC, Generic[R]):
    @abstractmethod
    def visit_file(self, f: File) -> R: ...
    @abstractmethod
    def visit_directory(self, d: Directory) -> R: ...


class TotalSize(FsVisitor[int]):
    def visit_file(self, f: File) -> int:
        return f.size

    def visit_directory(self, d: Directory) -> int:
        return sum(c.accept(self) for c in d.children)


class FileCount(FsVisitor[int]):
    def visit_file(self, f: File) -> int:
        return 1

    def visit_directory(self, d: Directory) -> int:
        return sum(c.accept(self) for c in d.children)


root = Directory("/", [
    File("a.txt", 100),
    Directory("docs", [
        File("readme.md", 200),
        File("guide.pdf", 5000),
    ]),
    File("photo.jpg", 8000),
])

print(f"Total size: {root.accept(TotalSize())}")    # 13300
print(f"File count: {root.accept(FileCount())}")    # 4
```

The `visit_directory` method recurses; the visitor walks the tree.

---

## Task 4: AST pretty printer

**Brief.** Print the expression AST with parentheses around binary operations.

### Solution (Java)

```java
public final class PrettyPrinter implements ExprVisitor<String> {
    public String visitNum(Num n)   { return String.valueOf(n.value()); }
    public String visitVar(Var v)   { return v.name(); }
    public String visitBin(Bin b) {
        return "(" + b.left().accept(this) + " " + b.op() + " " + b.right().accept(this) + ")";
    }
}

// Usage:
Expr ast = new Bin(new Num(1), "+", new Bin(new Var("x"), "*", new Num(3)));
System.out.println(ast.accept(new PrettyPrinter()));   // (1.0 + (x * 3.0))
```

The visitor returns a string; recursion concatenates.

---

## Task 5: Constant folding

**Brief.** Visitor that simplifies an expression by evaluating constant sub-expressions.

### Solution (Java)

```java
public final class ConstFolder implements ExprVisitor<Expr> {
    public Expr visitNum(Num n) { return n; }
    public Expr visitVar(Var v) { return v; }

    public Expr visitBin(Bin b) {
        Expr l = b.left().accept(this);
        Expr r = b.right().accept(this);

        if (l instanceof Num ln && r instanceof Num rn) {
            return new Num(switch (b.op()) {
                case "+" -> ln.value() + rn.value();
                case "-" -> ln.value() - rn.value();
                case "*" -> ln.value() * rn.value();
                case "/" -> ln.value() / rn.value();
                default  -> throw new IllegalStateException();
            });
        }
        return new Bin(l, b.op(), r);
    }
}

// Usage:
Expr ast = new Bin(new Num(1), "+", new Bin(new Num(2), "*", new Num(3)));
Expr folded = ast.accept(new ConstFolder());   // Num(7)
```

Returning `Num(7)` instead of `Bin(1, +, Bin(2, *, 3))` — pure tree rewrite.

---

## Task 6: HTML sanitizer

**Brief.** HTML element tree (`Tag`, `Text`). Visitor strips disallowed tags.

### Solution (Python)

```python
from abc import ABC, abstractmethod
from typing import Generic, TypeVar

R = TypeVar("R")


class HtmlNode(ABC):
    @abstractmethod
    def accept(self, v: "HtmlVisitor[R]") -> R: ...


class Tag(HtmlNode):
    def __init__(self, name: str, children: list[HtmlNode]):
        self.name = name
        self.children = children

    def accept(self, v): return v.visit_tag(self)


class Text(HtmlNode):
    def __init__(self, value: str):
        self.value = value

    def accept(self, v): return v.visit_text(self)


class HtmlVisitor(ABC, Generic[R]):
    @abstractmethod
    def visit_tag(self, t: Tag) -> R: ...
    @abstractmethod
    def visit_text(self, t: Text) -> R: ...


class Sanitizer(HtmlVisitor[HtmlNode | None]):
    ALLOWED = {"p", "b", "i", "a", "ul", "li"}

    def visit_text(self, t: Text) -> HtmlNode:
        return t

    def visit_tag(self, t: Tag) -> HtmlNode | None:
        if t.name not in self.ALLOWED:
            return None
        new_children = []
        for c in t.children:
            result = c.accept(self)
            if result is not None:
                new_children.append(result)
        return Tag(t.name, new_children)


tree = Tag("div", [
    Tag("p", [Text("hello")]),
    Tag("script", [Text("alert('xss')")]),   # disallowed
    Tag("b", [Text("bold")])
])

clean = tree.accept(Sanitizer())
# Result: outer div removed (not in allow list); only the children would normally bubble up
```

For full sanitization: visitor returns sub-list; or wrap output. This shows the basic mechanism.

---

## Task 7: JSON renderer

**Brief.** Same expression AST. Visitor renders to JSON.

### Solution (TypeScript)

```typescript
type Expr =
    | { kind: "num"; value: number }
    | { kind: "var"; name: string }
    | { kind: "bin"; op: string; l: Expr; r: Expr };

class JsonVisitor {
    visit(e: Expr): object {
        switch (e.kind) {
            case "num": return { type: "number", value: e.value };
            case "var": return { type: "variable", name: e.name };
            case "bin":
                return {
                    type: "binary",
                    op: e.op,
                    left: this.visit(e.l),
                    right: this.visit(e.r),
                };
        }
    }
}

const ast: Expr = {
    kind: "bin", op: "+",
    l: { kind: "num", value: 1 },
    r: { kind: "var", name: "x" }
};

console.log(JSON.stringify(new JsonVisitor().visit(ast), null, 2));
```

Output:

```json
{
  "type": "binary",
  "op": "+",
  "left": { "type": "number", "value": 1 },
  "right": { "type": "variable", "name": "x" }
}
```

Different visitor = different output format. Same AST.

---

## Task 8: Variable collector

**Brief.** Collect all variable names used in an expression.

### Solution (Java)

```java
public final class VarCollector implements ExprVisitor<Set<String>> {
    public Set<String> visitNum(Num n) { return Set.of(); }
    public Set<String> visitVar(Var v) { return Set.of(v.name()); }
    public Set<String> visitBin(Bin b) {
        Set<String> result = new HashSet<>();
        result.addAll(b.left().accept(this));
        result.addAll(b.right().accept(this));
        return result;
    }
}

// Usage:
Expr ast = new Bin(new Var("x"), "+", new Bin(new Var("y"), "*", new Num(2)));
Set<String> vars = ast.accept(new VarCollector());   // [x, y]
```

Useful for type checkers, optimizers, dependency analysis.

---

## Task 9: Visitor for refactoring (rename)

**Brief.** Rewrite an AST: rename variable `x` to `userInput`.

### Solution (Java)

```java
public final class Renamer implements ExprVisitor<Expr> {
    private final String from;
    private final String to;

    public Renamer(String from, String to) {
        this.from = from;
        this.to = to;
    }

    public Expr visitNum(Num n) { return n; }
    public Expr visitVar(Var v) {
        return v.name().equals(from) ? new Var(to) : v;
    }
    public Expr visitBin(Bin b) {
        Expr nl = b.left().accept(this);
        Expr nr = b.right().accept(this);
        if (nl == b.left() && nr == b.right()) return b;   // structural sharing
        return new Bin(nl, b.op(), nr);
    }
}

Expr ast = new Bin(new Var("x"), "+", new Var("y"));
Expr renamed = ast.accept(new Renamer("x", "userInput"));
```

Structural sharing: only the path from root to changed leaf reallocates. Foundational for IDEs (rename refactoring), compilers (alpha-conversion), formal verification (term rewriting).

---

## Task 10: Refactor instanceof chain to Visitor

**Brief.** This is bad — convert to Visitor:

```java
public class Calculator {
    public double area(Shape s) {
        if (s instanceof Circle c)      return Math.PI * c.radius * c.radius;
        if (s instanceof Square sq)     return sq.side * sq.side;
        if (s instanceof Triangle t)    return 0.5 * t.base * t.height;
        throw new IllegalArgumentException("unknown");
    }

    public double perimeter(Shape s) {
        if (s instanceof Circle c)      return 2 * Math.PI * c.radius;
        if (s instanceof Square sq)     return 4 * sq.side;
        if (s instanceof Triangle t)    return t.a + t.b + t.c;
        throw new IllegalArgumentException("unknown");
    }
}
```

### Solution

```java
public interface ShapeVisitor<R> {
    R visitCircle(Circle c);
    R visitSquare(Square s);
    R visitTriangle(Triangle t);
}

public sealed interface Shape permits Circle, Square, Triangle {
    <R> R accept(ShapeVisitor<R> v);
}

public record Circle(double radius) implements Shape {
    public <R> R accept(ShapeVisitor<R> v) { return v.visitCircle(this); }
}
// ... Square, Triangle similar

public class AreaVisitor implements ShapeVisitor<Double> {
    public Double visitCircle(Circle c)     { return Math.PI * c.radius() * c.radius(); }
    public Double visitSquare(Square s)     { return s.side() * s.side(); }
    public Double visitTriangle(Triangle t) { return 0.5 * t.base() * t.height(); }
}

public class PerimeterVisitor implements ShapeVisitor<Double> {
    public Double visitCircle(Circle c)     { return 2 * Math.PI * c.radius(); }
    public Double visitSquare(Square s)     { return 4 * s.side(); }
    public Double visitTriangle(Triangle t) { return t.a() + t.b() + t.c(); }
}

// Usage:
Shape s = new Circle(5);
double area = s.accept(new AreaVisitor());
double perim = s.accept(new PerimeterVisitor());
```

**Better still (Java 21+):** sealed types + exhaustive switch:

```java
double area(Shape s) {
    return switch (s) {
        case Circle c     -> Math.PI * c.radius() * c.radius();
        case Square sq    -> sq.side() * sq.side();
        case Triangle t   -> 0.5 * t.base() * t.height();
    };
}
```

No accept method, no visitor interface — compiler enforces exhaustiveness directly.

The Visitor + interface form is preferable when you have **many** operations to organize as classes. The pattern-match form is preferable for **one-off** operations.

---

## How to Practice

- **Build the shape Visitor first.** Smallest hierarchy, multiple operations.
- **Then the AST Visitor.** Closer to real-world (compilers, parsers).
- **Try mutating visitors.** Constant folding, renaming — see structural sharing.
- **Compare with sealed-types switch.** Same problem; different idiom.
- **Look at a real codebase.** ANTLR-generated code, ASM source, JavaParser examples — see Visitor at scale.
- **Property-based test the rewriter.** For constant folder, test that `eval(folded(ast)) == eval(ast)` for any `ast`.
- **Implement a linter.** Walk a small AST; emit warnings for bad patterns. Real production use case.
- **Try Acyclic Visitor.** Decouple element types — see how plugin systems work.

[← Interview](interview.md) · [Find Bug →](find-bug.md)
