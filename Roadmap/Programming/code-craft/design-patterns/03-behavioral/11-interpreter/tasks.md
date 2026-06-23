# Interpreter — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/interpreter](https://refactoring.guru/design-patterns/interpreter)

Each task includes a brief and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Boolean expression interpreter](#task-1-boolean-expression-interpreter)
2. [Task 2: Math expression interpreter](#task-2-math-expression-interpreter)
3. [Task 3: Roman numeral parser/evaluator](#task-3-roman-numeral-parserevaluator)
4. [Task 4: Postfix calculator interpreter](#task-4-postfix-calculator-interpreter)
5. [Task 5: Mini SQL WHERE clause](#task-5-mini-sql-where-clause)
6. [Task 6: Regex-like pattern matcher](#task-6-regex-like-pattern-matcher)
7. [Task 7: Add a new grammar rule](#task-7-add-a-new-grammar-rule)
8. [Task 8: Hand-written recursive descent parser](#task-8-hand-written-recursive-descent-parser)
9. [Task 9: Constant folding optimizer](#task-9-constant-folding-optimizer)
10. [Task 10: Refactor a giant if/elseif evaluator to Interpreter](#task-10-refactor-a-giant-ifelseif-evaluator-to-interpreter)
11. [How to Practice](#how-to-practice)

---

## Task 1: Boolean expression interpreter

**Brief.** Build a `BoolExpression` interface with leaves (`Constant`, `Variable`) and operators (`And`, `Or`, `Not`). A `Context` maps variable names to boolean values. Evaluate `(x AND y) OR NOT z` against several contexts.

### Solution (Java)

```java
import java.util.HashMap;
import java.util.Map;

public final class Context {
    private final Map<String, Boolean> values = new HashMap<>();
    public Context set(String name, boolean v) { values.put(name, v); return this; }
    public boolean lookup(String name) {
        Boolean v = values.get(name);
        if (v == null) throw new IllegalStateException("undefined: " + name);
        return v;
    }
}

public interface BoolExpression {
    boolean interpret(Context ctx);
}

public record Constant(boolean value) implements BoolExpression {
    public boolean interpret(Context ctx) { return value; }
}

public record Variable(String name) implements BoolExpression {
    public boolean interpret(Context ctx) { return ctx.lookup(name); }
}

public record And(BoolExpression left, BoolExpression right) implements BoolExpression {
    public boolean interpret(Context ctx) {
        return left.interpret(ctx) && right.interpret(ctx);
    }
}

public record Or(BoolExpression left, BoolExpression right) implements BoolExpression {
    public boolean interpret(Context ctx) {
        return left.interpret(ctx) || right.interpret(ctx);
    }
}

public record Not(BoolExpression inner) implements BoolExpression {
    public boolean interpret(Context ctx) { return !inner.interpret(ctx); }
}

class Demo {
    public static void main(String[] args) {
        // (x AND y) OR NOT z
        BoolExpression expr = new Or(
            new And(new Variable("x"), new Variable("y")),
            new Not(new Variable("z"))
        );

        Context c1 = new Context().set("x", true).set("y", true).set("z", true);   // true
        Context c2 = new Context().set("x", true).set("y", false).set("z", true);  // false
        Context c3 = new Context().set("x", false).set("y", false).set("z", false); // true (NOT false)

        System.out.println(expr.interpret(c1));   // true
        System.out.println(expr.interpret(c2));   // false
        System.out.println(expr.interpret(c3));   // true
    }
}
```

Each grammar production is a class. The AST mirrors the expression tree. `interpret(ctx)` is the recursive evaluator.

---

## Task 2: Math expression interpreter

**Brief.** Numeric AST: `Number`, `Variable`, `Add`, `Sub`, `Mul`, `Div`. Build `(2 + x) * 3 - y` and evaluate with `{x: 4, y: 5}` → 13.

### Solution (Java)

```java
import java.util.Map;

public interface MathExpr {
    double interpret(Map<String, Double> env);
}

public record Num(double value) implements MathExpr {
    public double interpret(Map<String, Double> env) { return value; }
}

public record Var(String name) implements MathExpr {
    public double interpret(Map<String, Double> env) {
        Double v = env.get(name);
        if (v == null) throw new IllegalStateException("undefined: " + name);
        return v;
    }
}

public record Add(MathExpr l, MathExpr r) implements MathExpr {
    public double interpret(Map<String, Double> env) { return l.interpret(env) + r.interpret(env); }
}

public record Sub(MathExpr l, MathExpr r) implements MathExpr {
    public double interpret(Map<String, Double> env) { return l.interpret(env) - r.interpret(env); }
}

public record Mul(MathExpr l, MathExpr r) implements MathExpr {
    public double interpret(Map<String, Double> env) { return l.interpret(env) * r.interpret(env); }
}

public record Div(MathExpr l, MathExpr r) implements MathExpr {
    public double interpret(Map<String, Double> env) {
        double rv = r.interpret(env);
        if (rv == 0) throw new ArithmeticException("div by zero");
        return l.interpret(env) / rv;
    }
}

class Demo {
    public static void main(String[] args) {
        // (2 + x) * 3 - y
        MathExpr expr = new Sub(
            new Mul(new Add(new Num(2), new Var("x")), new Num(3)),
            new Var("y")
        );
        System.out.println(expr.interpret(Map.of("x", 4.0, "y", 5.0)));   // 13.0
    }
}
```

**Variation.** Add `Pow(base, exp)` and `Neg(inner)`. Both are pure additive changes.

---

## Task 3: Roman numeral parser/evaluator

**Brief.** Convert Roman numeral strings (e.g. `"MCMXCIV"`) to integers via Interpreter. One class per symbol (I, V, X, L, C, D, M) and a top-level evaluator that handles subtraction pairs (IV=4, IX=9, XL=40, XC=90, CD=400, CM=900).

### Solution (Java)

```java
public interface RomanExpression {
    int interpret(StringBuilder romanRest);
}

abstract class RomanSymbolExpression implements RomanExpression {
    public int interpret(StringBuilder s) {
        if (s.length() == 0) return 0;
        // Subtraction case: pair like CM, CD, XC, XL, IX, IV
        if (s.length() >= 2 && s.substring(0, 2).equals(twoChar())) {
            s.delete(0, 2);
            return twoCharValue();
        }
        // Otherwise: consume up to maxCount of the symbol
        int count = 0;
        while (s.length() > 0 && s.charAt(0) == oneChar() && count < maxCount()) {
            s.deleteCharAt(0);
            count++;
        }
        return count * oneCharValue();
    }
    abstract char oneChar();
    abstract int oneCharValue();
    abstract String twoChar();
    abstract int twoCharValue();
    abstract int maxCount();
}

class Thousand extends RomanSymbolExpression {
    char oneChar()       { return 'M'; }
    int oneCharValue()   { return 1000; }
    String twoChar()     { return ""; }       // no subtractive pair
    int twoCharValue()   { return 0; }
    int maxCount()       { return 4; }
}

class Hundred extends RomanSymbolExpression {
    char oneChar()       { return 'C'; }
    int oneCharValue()   { return 100; }
    String twoChar()     { return "CM"; }
    int twoCharValue()   { return 900; }
    int maxCount()       { return 3; }
}

class Ten extends RomanSymbolExpression {
    char oneChar()       { return 'X'; }
    int oneCharValue()   { return 10; }
    String twoChar()     { return "XC"; }
    int twoCharValue()   { return 90; }
    int maxCount()       { return 3; }
}

class One extends RomanSymbolExpression {
    char oneChar()       { return 'I'; }
    int oneCharValue()   { return 1; }
    String twoChar()     { return "IX"; }
    int twoCharValue()   { return 9; }
    int maxCount()       { return 3; }
}

// (Five-class would handle V/CD/XL/IV at the half-step positions; trimmed for brevity.)

class RomanEvaluator {
    public static int evaluate(String roman) {
        StringBuilder s = new StringBuilder(roman);
        RomanExpression[] tree = { new Thousand(), new Hundred(), new Ten(), new One() };
        int total = 0;
        for (RomanExpression e : tree) total += e.interpret(s);
        return total;
    }

    public static void main(String[] args) {
        System.out.println(evaluate("MCMXCIV"));   // 1994
        System.out.println(evaluate("MMXXIV"));    // 2024
        System.out.println(evaluate("XLII"));      // 42
    }
}
```

A classical GoF Interpreter example. Each symbol is its own class. The evaluator chains symbol interpreters from largest to smallest place value.

---

## Task 4: Postfix calculator interpreter

**Brief.** Parse RPN tokens like `["3", "4", "+", "5", "*"]` into an AST and interpret to get 35. Operands push onto an evaluation stack; operators pop two and push the result.

### Solution (Python)

```python
from abc import ABC, abstractmethod


class PostfixExpr(ABC):
    @abstractmethod
    def interpret(self) -> float: ...


class Number(PostfixExpr):
    def __init__(self, value: float):
        self.value = value
    def interpret(self) -> float:
        return self.value


class BinaryOp(PostfixExpr):
    def __init__(self, op: str, left: PostfixExpr, right: PostfixExpr):
        self.op = op
        self.left = left
        self.right = right

    def interpret(self) -> float:
        a = self.left.interpret()
        b = self.right.interpret()
        match self.op:
            case "+": return a + b
            case "-": return a - b
            case "*": return a * b
            case "/": return a / b
            case _:   raise ValueError(self.op)


def build(tokens: list[str]) -> PostfixExpr:
    stack: list[PostfixExpr] = []
    for t in tokens:
        if t in {"+", "-", "*", "/"}:
            r = stack.pop()
            l = stack.pop()
            stack.append(BinaryOp(t, l, r))
        else:
            stack.append(Number(float(t)))
    if len(stack) != 1:
        raise ValueError("malformed RPN")
    return stack[0]


tokens = ["3", "4", "+", "5", "*"]
ast = build(tokens)
print(ast.interpret())   # 35.0
```

Building the AST is its own step (a tiny parser). The interpreter is the recursive `interpret()` method on each node. Worth separating: same AST could feed a pretty-printer or optimizer.

---

## Task 5: Mini SQL WHERE clause

**Brief.** Interpret a small predicate language over rows (`Map<String, Object>`). Implement `Equals`, `GreaterThan`, `LessThan`, `And`, `Or`. Evaluate `age > 18 AND country == "US"` against a list of rows.

### Solution (Java)

```java
import java.util.*;

public interface Predicate {
    boolean evaluate(Map<String, Object> row);
}

public record Equals(String field, Object value) implements Predicate {
    public boolean evaluate(Map<String, Object> row) {
        return Objects.equals(row.get(field), value);
    }
}

public record GreaterThan(String field, Comparable<Object> value) implements Predicate {
    @SuppressWarnings("unchecked")
    public boolean evaluate(Map<String, Object> row) {
        Comparable<Object> cell = (Comparable<Object>) row.get(field);
        return cell != null && cell.compareTo(value) > 0;
    }
}

public record LessThan(String field, Comparable<Object> value) implements Predicate {
    @SuppressWarnings("unchecked")
    public boolean evaluate(Map<String, Object> row) {
        Comparable<Object> cell = (Comparable<Object>) row.get(field);
        return cell != null && cell.compareTo(value) < 0;
    }
}

public record AndP(Predicate l, Predicate r) implements Predicate {
    public boolean evaluate(Map<String, Object> row) { return l.evaluate(row) && r.evaluate(row); }
}

public record OrP(Predicate l, Predicate r) implements Predicate {
    public boolean evaluate(Map<String, Object> row) { return l.evaluate(row) || r.evaluate(row); }
}

class Demo {
    @SuppressWarnings({"unchecked", "rawtypes"})
    public static void main(String[] args) {
        // age > 18 AND country == "US"
        Predicate where = new AndP(
            new GreaterThan("age", (Comparable) Integer.valueOf(18)),
            new Equals("country", "US")
        );

        List<Map<String, Object>> rows = List.of(
            Map.of("name", "Alice",  "age", 25, "country", "US"),
            Map.of("name", "Bob",    "age", 17, "country", "US"),
            Map.of("name", "Carol",  "age", 30, "country", "UK"),
            Map.of("name", "Dave",   "age", 21, "country", "US")
        );

        rows.stream()
            .filter(where::evaluate)
            .forEach(r -> System.out.println(r.get("name")));
        // Alice, Dave
    }
}
```

Each predicate is a tiny classifier; combining them via `AndP`/`OrP` builds arbitrarily complex queries. This is the bones of an in-memory query engine.

---

## Task 6: Regex-like pattern matcher

**Brief.** Build a tiny regex AST: `Char(c)`, `Concat(l, r)`, `Alt(l, r)`, `Star(inner)`. Interpret it as a recursive matcher over an input string. Match patterns like `a*b` or `(a|b)c`.

### Solution (Python)

```python
from abc import ABC, abstractmethod


class Pattern(ABC):
    """Match against text starting at index i; return set of next indices that succeed."""
    @abstractmethod
    def match(self, text: str, i: int) -> set[int]: ...


class Char(Pattern):
    def __init__(self, c: str):
        self.c = c
    def match(self, text, i):
        if i < len(text) and text[i] == self.c:
            return {i + 1}
        return set()


class Concat(Pattern):
    def __init__(self, l: Pattern, r: Pattern):
        self.l = l
        self.r = r
    def match(self, text, i):
        result = set()
        for j in self.l.match(text, i):
            result |= self.r.match(text, j)
        return result


class Alt(Pattern):
    def __init__(self, l: Pattern, r: Pattern):
        self.l = l
        self.r = r
    def match(self, text, i):
        return self.l.match(text, i) | self.r.match(text, i)


class Star(Pattern):
    def __init__(self, inner: Pattern):
        self.inner = inner
    def match(self, text, i):
        result = {i}                                  # zero matches
        frontier = {i}
        while frontier:
            new = set()
            for j in frontier:
                for k in self.inner.match(text, j):
                    if k not in result:
                        new.add(k)
                        result.add(k)
            frontier = new
        return result


def fullmatch(p: Pattern, text: str) -> bool:
    return len(text) in p.match(text, 0)


# a*b
pat = Concat(Star(Char("a")), Char("b"))
print(fullmatch(pat, "b"))      # True
print(fullmatch(pat, "ab"))     # True
print(fullmatch(pat, "aaab"))   # True
print(fullmatch(pat, "abc"))    # False

# (a|b)c
pat2 = Concat(Alt(Char("a"), Char("b")), Char("c"))
print(fullmatch(pat2, "ac"))    # True
print(fullmatch(pat2, "bc"))    # True
print(fullmatch(pat2, "cc"))    # False
```

A non-deterministic recursive matcher: `match` returns the **set** of all positions reachable from `i`. Star explores until the frontier is empty. The AST is the regex; the interpreter is the matcher. Compilers turn this into NFA/DFA for speed.

---

## Task 7: Add a new grammar rule

**Brief.** Take the boolean interpreter from Task 1. Add `Xor` and `Implies` **without modifying any existing class**. Show that the open/closed principle holds: the existing tree continues to work; new constructs slot in.

### Solution (Java)

```java
// New nodes — added without touching Constant, Variable, And, Or, Not, Context.

public record Xor(BoolExpression left, BoolExpression right) implements BoolExpression {
    public boolean interpret(Context ctx) {
        return left.interpret(ctx) ^ right.interpret(ctx);
    }
}

public record Implies(BoolExpression antecedent, BoolExpression consequent)
        implements BoolExpression {
    public boolean interpret(Context ctx) {
        // p → q  ≡  ¬p ∨ q
        return !antecedent.interpret(ctx) || consequent.interpret(ctx);
    }
}

class Demo {
    public static void main(String[] args) {
        // p XOR q
        BoolExpression xor = new Xor(new Variable("p"), new Variable("q"));
        Context c = new Context().set("p", true).set("q", false);
        System.out.println(xor.interpret(c));   // true

        // (p AND q) IMPLIES r
        BoolExpression impl = new Implies(
            new And(new Variable("p"), new Variable("q")),
            new Variable("r")
        );
        Context c2 = new Context().set("p", true).set("q", true).set("r", false);
        System.out.println(impl.interpret(c2)); // false
    }
}
```

This is the headline strength of Interpreter: **adding a grammar rule is a pure add**. (Compare with Visitor, where adding a node type forces every visitor to change. The trade-offs are dual.)

---

## Task 8: Hand-written recursive descent parser

**Brief.** Write a parser that turns a string like `"x AND (y OR NOT z)"` into the boolean Interpreter AST from Task 1. Combine parser + interpreter end-to-end so a string + a context produces a boolean result.

### Solution (Java)

```java
import java.util.*;

// Reuses BoolExpression / Constant / Variable / And / Or / Not / Context from Task 1.

public final class BoolParser {
    private final List<String> tokens;
    private int pos = 0;

    public BoolParser(String input) { this.tokens = tokenize(input); }

    private static List<String> tokenize(String s) {
        List<String> out = new ArrayList<>();
        int i = 0;
        while (i < s.length()) {
            char c = s.charAt(i);
            if (Character.isWhitespace(c)) { i++; continue; }
            if (c == '(' || c == ')') { out.add(String.valueOf(c)); i++; continue; }
            if (Character.isLetter(c)) {
                int j = i;
                while (j < s.length() && Character.isLetterOrDigit(s.charAt(j))) j++;
                out.add(s.substring(i, j));
                i = j;
                continue;
            }
            throw new IllegalArgumentException("bad char: " + c);
        }
        return out;
    }

    private String peek()  { return pos < tokens.size() ? tokens.get(pos) : null; }
    private String eat()   { return tokens.get(pos++); }
    private boolean match(String t) {
        if (Objects.equals(peek(), t)) { pos++; return true; }
        return false;
    }

    // Grammar (lowest to highest precedence):
    //   expr   := orExpr
    //   orExpr := andExpr ("OR" andExpr)*
    //   andExpr:= notExpr ("AND" notExpr)*
    //   notExpr:= "NOT" notExpr | atom
    //   atom   := "(" expr ")" | "true" | "false" | IDENT

    public BoolExpression parse() {
        BoolExpression e = orExpr();
        if (pos != tokens.size()) throw new IllegalStateException("trailing: " + peek());
        return e;
    }

    private BoolExpression orExpr() {
        BoolExpression l = andExpr();
        while (match("OR")) l = new Or(l, andExpr());
        return l;
    }

    private BoolExpression andExpr() {
        BoolExpression l = notExpr();
        while (match("AND")) l = new And(l, notExpr());
        return l;
    }

    private BoolExpression notExpr() {
        if (match("NOT")) return new Not(notExpr());
        return atom();
    }

    private BoolExpression atom() {
        if (match("(")) {
            BoolExpression e = orExpr();
            if (!match(")")) throw new IllegalStateException("expected )");
            return e;
        }
        String t = eat();
        if (t.equals("true"))  return new Constant(true);
        if (t.equals("false")) return new Constant(false);
        return new Variable(t);
    }

    public static void main(String[] args) {
        BoolExpression ast = new BoolParser("x AND (y OR NOT z)").parse();
        Context ctx = new Context().set("x", true).set("y", false).set("z", false);
        System.out.println(ast.interpret(ctx));   // true (NOT false = true; y OR true = true; x AND true = true)
    }
}
```

A real Interpreter system has two halves: **parser** (string → AST) and **interpreter** (AST → value). Recursive descent maps the grammar onto methods one-to-one. Operator precedence is encoded by the call order: `or → and → not → atom`.

---

## Task 9: Constant folding optimizer

**Brief.** Walk the boolean AST from Task 1 and return a simplified AST. For example: `Constant(true) AND x` → `x`; `Constant(false) OR x` → `x`; `NOT NOT x` → `x`. This is a tree-rewrite pass.

### Solution (Java)

```java
public final class BoolFolder {

    public static BoolExpression fold(BoolExpression e) {
        return switch (e) {
            case Constant c -> c;
            case Variable v -> v;
            case Not n -> foldNot(fold(n.inner()));
            case And a -> foldAnd(fold(a.left()), fold(a.right()));
            case Or o  -> foldOr(fold(o.left()),  fold(o.right()));
            default    -> e;
        };
    }

    private static BoolExpression foldNot(BoolExpression x) {
        if (x instanceof Constant c) return new Constant(!c.value());
        if (x instanceof Not n)      return n.inner();             // NOT NOT x = x
        return new Not(x);
    }

    private static BoolExpression foldAnd(BoolExpression l, BoolExpression r) {
        if (l instanceof Constant lc) return lc.value() ? r : new Constant(false);
        if (r instanceof Constant rc) return rc.value() ? l : new Constant(false);
        return new And(l, r);
    }

    private static BoolExpression foldOr(BoolExpression l, BoolExpression r) {
        if (l instanceof Constant lc) return lc.value() ? new Constant(true) : r;
        if (r instanceof Constant rc) return rc.value() ? new Constant(true) : l;
        return new Or(l, r);
    }

    public static void main(String[] args) {
        // (true AND x) OR (NOT NOT y) → x OR y
        BoolExpression input = new Or(
            new And(new Constant(true), new Variable("x")),
            new Not(new Not(new Variable("y")))
        );
        BoolExpression folded = fold(input);
        System.out.println(folded);   // Or[left=Variable[name=x], right=Variable[name=y]]
    }
}
```

**Design choice.** This is written as a static recursive function with `switch` on sealed types — that is itself an interpreter-shaped traversal. The same logic could be packaged as a Visitor (one `visit*` method per node, return `BoolExpression`). Visitor wins when you'll have many such passes (folder, type-checker, renamer, code-gen). The static-switch form wins for one-off utilities. Both are valid; pick by how much the operation set will grow.

---

## Task 10: Refactor a giant if/elseif evaluator to Interpreter

**Brief.** Below is a sketch of a string-based filter evaluator that has grown into an `if/elseif` jungle. Refactor it into a proper Interpreter with a parser + AST + per-node `interpret`.

```java
// BAD: parse + evaluate tangled together; new operator = edit a giant chain.
public class FilterEvaluator {
    public boolean evaluate(String filter, Map<String, Object> row) {
        if (filter.contains(" AND ")) {
            String[] parts = filter.split(" AND ", 2);
            return evaluate(parts[0], row) && evaluate(parts[1], row);
        } else if (filter.contains(" OR ")) {
            String[] parts = filter.split(" OR ", 2);
            return evaluate(parts[0], row) || evaluate(parts[1], row);
        } else if (filter.contains(" == ")) {
            String[] parts = filter.split(" == ", 2);
            return Objects.equals(
                row.get(parts[0].trim()),
                parts[1].trim().replace("\"", "")
            );
        } else if (filter.contains(" > ")) {
            String[] parts = filter.split(" > ", 2);
            return ((Comparable) row.get(parts[0].trim()))
                .compareTo(Integer.parseInt(parts[1].trim())) > 0;
        }
        // ... and on, and on. Operator precedence is broken; no grouping; etc.
        throw new IllegalArgumentException("unknown filter: " + filter);
    }
}
```

### Solution (Java)

Two clean halves: AST + interpreter, then parser.

```java
import java.util.*;

// ---------- AST + Interpreter ----------
public interface FilterExpr {
    boolean evaluate(Map<String, Object> row);
}

public record Eq(String field, Object value) implements FilterExpr {
    public boolean evaluate(Map<String, Object> row) {
        return Objects.equals(row.get(field), value);
    }
}

public record Gt(String field, int value) implements FilterExpr {
    public boolean evaluate(Map<String, Object> row) {
        Object cell = row.get(field);
        return cell instanceof Number n && n.intValue() > value;
    }
}

public record AndF(FilterExpr l, FilterExpr r) implements FilterExpr {
    public boolean evaluate(Map<String, Object> row) { return l.evaluate(row) && r.evaluate(row); }
}

public record OrF(FilterExpr l, FilterExpr r) implements FilterExpr {
    public boolean evaluate(Map<String, Object> row) { return l.evaluate(row) || r.evaluate(row); }
}

// ---------- Parser (string → AST) ----------
public final class FilterParser {
    private final List<String> toks;
    private int p = 0;

    public FilterParser(String src) {
        this.toks = tokenize(src);
    }

    private static List<String> tokenize(String s) {
        List<String> out = new ArrayList<>();
        int i = 0;
        while (i < s.length()) {
            char c = s.charAt(i);
            if (Character.isWhitespace(c)) { i++; continue; }
            if (c == '(' || c == ')') { out.add(String.valueOf(c)); i++; continue; }
            if (c == '"') {
                int j = s.indexOf('"', i + 1);
                out.add(s.substring(i, j + 1));
                i = j + 1;
                continue;
            }
            if (s.startsWith("==", i)) { out.add("=="); i += 2; continue; }
            if (s.startsWith("AND", i)) { out.add("AND"); i += 3; continue; }
            if (s.startsWith("OR", i))  { out.add("OR");  i += 2; continue; }
            if (c == '>')  { out.add(">"); i++; continue; }
            int j = i;
            while (j < s.length() && !Character.isWhitespace(s.charAt(j))
                    && "()=>".indexOf(s.charAt(j)) < 0) j++;
            out.add(s.substring(i, j));
            i = j;
        }
        return out;
    }

    public FilterExpr parse() { return orExpr(); }

    private FilterExpr orExpr() {
        FilterExpr l = andExpr();
        while (p < toks.size() && toks.get(p).equals("OR")) { p++; l = new OrF(l, andExpr()); }
        return l;
    }

    private FilterExpr andExpr() {
        FilterExpr l = atom();
        while (p < toks.size() && toks.get(p).equals("AND")) { p++; l = new AndF(l, atom()); }
        return l;
    }

    private FilterExpr atom() {
        if (toks.get(p).equals("(")) {
            p++;
            FilterExpr e = orExpr();
            if (!toks.get(p++).equals(")")) throw new IllegalStateException("expected )");
            return e;
        }
        String field = toks.get(p++);
        String op    = toks.get(p++);
        String val   = toks.get(p++);
        return switch (op) {
            case "=="  -> new Eq(field, parseValue(val));
            case ">"   -> new Gt(field, Integer.parseInt(val));
            default    -> throw new IllegalStateException("op: " + op);
        };
    }

    private static Object parseValue(String t) {
        if (t.startsWith("\"") && t.endsWith("\"")) return t.substring(1, t.length() - 1);
        try { return Integer.parseInt(t); } catch (NumberFormatException ignored) {}
        return t;
    }
}

// ---------- Usage ----------
class Demo {
    public static void main(String[] args) {
        FilterExpr ast = new FilterParser("age > 18 AND country == \"US\"").parse();
        List<Map<String, Object>> rows = List.of(
            Map.of("name", "Alice", "age", 25, "country", "US"),
            Map.of("name", "Bob",   "age", 17, "country", "US"),
            Map.of("name", "Carol", "age", 30, "country", "UK")
        );
        rows.stream().filter(ast::evaluate).forEach(r -> System.out.println(r.get("name")));
        // Alice
    }
}
```

What changed:
- **Parsing and evaluation are separate.** The original tangled them; a buggy split on `" AND "` could match inside a string literal.
- **Precedence is explicit** in the grammar (`or → and → atom`). The original had no precedence at all.
- **Adding an operator is local.** New comparison? Add a node + one parser case. No `if/else if` cliff.
- **Each node is testable in isolation.** `new Gt("age", 18).evaluate(row)` — no parser needed.

The if/elseif version felt simpler at five lines. By twenty lines it was a maintenance trap. Interpreter scales because the grammar lives in **classes**, not in **conditionals**.

---

## How to Practice

- **Implement before reading the solution.** Stop at the brief; struggle for ten minutes; then look. The struggle is where learning happens.
- **Try the same task in two languages.** Java records vs Python dataclasses vs TS discriminated unions — same shape, different feel. You'll internalize what's pattern and what's syntax.
- **After solving, add one new grammar rule.** This is the open/closed test. If adding `Xor` requires editing five files, your design has drifted.
- **Combine Tasks 1 + 7 + 8 + 9.** Boolean grammar → parser → interpreter → optimizer. End-to-end: string in, simplified value out. This is a tiny compiler.
- **Time yourself: 20 minutes for a from-scratch Boolean interpreter.** No copy-paste, no IDE autocomplete. If it takes 60, repeat tomorrow until it takes 20. The pattern should become muscle memory.
- **Read one real grammar.** ANTLR's calculator example, JSON spec, SQL WHERE clause grammar. See how the toy maps onto the production version.
- **Property-test the interpreter.** Generate random ASTs; check invariants like `eval(fold(ast), env) == eval(ast, env)` for any environment. Bugs hide in corner cases (empty Star, divide by zero, undefined var).
- **Pair with Visitor (Task 9 in Visitor's tasks).** Same problem, dual trade-off: Interpreter makes adding nodes easy, Visitor makes adding operations easy. Choose by axis of change.

[← Interview](interview.md) · [Find Bug →](find-bug.md)
