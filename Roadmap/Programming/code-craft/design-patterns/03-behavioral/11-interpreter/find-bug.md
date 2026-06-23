# Interpreter — Find the Bug

> **Source:** [refactoring.guru/design-patterns/interpreter](https://refactoring.guru/design-patterns/interpreter)

Each snippet has a bug. Read carefully, identify, fix.

---

## Table of Contents

1. [Bug 1: Shared mutable Context across recursive calls](#bug-1-shared-mutable-context-across-recursive-calls)
2. [Bug 2: Variable lookup returns wrong default](#bug-2-variable-lookup-returns-wrong-default)
3. [Bug 3: Wrong evaluation order in non-commutative op](#bug-3-wrong-evaluation-order-in-non-commutative-op)
4. [Bug 4: Stack overflow on deep AST](#bug-4-stack-overflow-on-deep-ast)
5. [Bug 5: Caching results in mutable terminal](#bug-5-caching-results-in-mutable-terminal)
6. [Bug 6: Context shared across threads](#bug-6-context-shared-across-threads)
7. [Bug 7: Mixing parser and interpreter in one method](#bug-7-mixing-parser-and-interpreter-in-one-method)
8. [Bug 8: Forgotten recursion in nonterminal](#bug-8-forgotten-recursion-in-nonterminal)
9. [Bug 9: Short-circuit evaluation broken](#bug-9-short-circuit-evaluation-broken)
10. [Bug 10: Wrong type assumption in Context](#bug-10-wrong-type-assumption-in-context)
11. [Bug 11: Memoization keyed only by node](#bug-11-memoization-keyed-only-by-node)
12. [Bug 12: Optimizer mutates AST in place](#bug-12-optimizer-mutates-ast-in-place)

---

## Bug 1: Shared mutable Context across recursive calls

```java
public final class Assign implements Expression {
    private final String name;
    private final Expression value;

    public Assign(String name, Expression value) {
        this.name = name;
        this.value = value;
    }

    public int interpret(Context ctx) {
        int v = value.interpret(ctx);
        ctx.set(name, v);
        return v;
    }
}

public final class Sequence implements Expression {
    private final Expression left, right;
    public Sequence(Expression l, Expression r) { left = l; right = r; }

    public int interpret(Context ctx) {
        Context snapshot = ctx;          // BUG: shallow copy, points to same map
        left.interpret(snapshot);
        return right.interpret(ctx);     // sees stale state? actually sees mutated state
    }
}

// Setup:
//   x = 1; (x + 1)
Expression program = new Sequence(
    new Assign("x", new Const(1)),
    new BinOp(new Var("x"), "+", new Const(1))
);
program.interpret(new Context());        // returns 2 — works by accident
```

**Bug.** `snapshot = ctx` doesn't snapshot — it aliases. The intent (isolate `left`'s mutations from `right`) fails silently. When the author later writes a `Try` or `Branch` node that *should* roll back on failure, mutations leak between branches.

**Fix.** Either commit to mutable shared Context (and document it) or take a real snapshot at branch points:

```java
public int interpret(Context ctx) {
    left.interpret(ctx);                 // shared state by design
    return right.interpret(ctx);
}
```

Or, for true isolation:

```java
public int interpret(Context ctx) {
    Context snapshot = ctx.copy();       // deep copy of bindings
    left.interpret(snapshot);
    return right.interpret(ctx);         // unaffected by left's mutations
}
```

Pick one model and stick to it. The bug is having neither — the code reads as if it isolates, but it doesn't.

---

## Bug 2: Variable lookup returns wrong default

```java
public final class Variable implements Expression {
    private final String name;
    public Variable(String name) { this.name = name; }

    public int interpret(Context ctx) {
        Integer v = ctx.get(name);       // returns null for unset variable
        return v;                        // BUG: NPE on autounbox
    }
}

// Or equally bad:
public int interpret(Context ctx) {
    Integer v = ctx.get(name);
    return v == null ? 0 : v;            // BUG: silent default of 0
}
```

**Bug.** Two failure modes:
1. Direct unbox of `null` → `NullPointerException` with no useful message ("Cannot invoke `Integer.intValue()` because `v` is null").
2. Defaulting to `0` hides the real problem: the user wrote `y + 1` but never set `y`. The expression returns `1` instead of erroring.

Both are silent bugs. The first crashes at the wrong place; the second produces wrong answers.

**Fix.** Make undefined variables a first-class error:

```java
public int interpret(Context ctx) {
    if (!ctx.has(name)) {
        throw new UndefinedVariableException(name);
    }
    return ctx.get(name);
}
```

Or use `Optional`:

```java
public int interpret(Context ctx) {
    return ctx.lookup(name)
        .orElseThrow(() -> new UndefinedVariableException(name));
}
```

A custom exception with the variable name beats a stack trace pointing inside `Integer.intValue`. The user wants to know *which* variable is undefined.

---

## Bug 3: Wrong evaluation order in non-commutative op

```java
public final class Subtract implements Expression {
    private final Expression left, right;
    public Subtract(Expression l, Expression r) { left = l; right = r; }

    public int interpret(Context ctx) {
        int r = right.interpret(ctx);
        int l = left.interpret(ctx);
        return r - l;                    // BUG: backwards
    }
}

// 10 - 3 → returns -7 instead of 7
new Subtract(new Const(10), new Const(3)).interpret(new Context());
```

**Bug.** `right - left` instead of `left - right`. Easy to miss because addition tests pass. Subtraction (and division, and modulo) are non-commutative — order matters.

**Fix.**

```java
public int interpret(Context ctx) {
    int l = left.interpret(ctx);
    int r = right.interpret(ctx);
    return l - r;
}
```

The same bug appears in `Divide`:

```java
public int interpret(Context ctx) {
    int l = left.interpret(ctx);
    int r = right.interpret(ctx);
    if (r == 0) throw new ArithmeticException("division by zero");
    return l / r;                        // not r / l
}
```

**Test discipline:** for every binary op, write a test where left and right are *different* values. `1 + 1 = 2` won't catch a swapped subtract.

---

## Bug 4: Stack overflow on deep AST

```java
public final class Add implements Expression {
    private final Expression left, right;
    public Add(Expression l, Expression r) { left = l; right = r; }

    public int interpret(Context ctx) {
        return left.interpret(ctx) + right.interpret(ctx);
    }
}

// User submits: ((((...((1 + 1) + 1) + 1)...) + 1)
// 100 000 nested adds — produced by a code generator.
Expression deeplyNested = buildLeftLeaningChain(100_000);
deeplyNested.interpret(new Context());   // StackOverflowError
```

**Bug.** Recursion depth equals AST depth. For adversarial or generated input (left-leaning chains of 10k+ nodes), the JVM stack blows.

This is exploitable: a public rule engine that accepts user-submitted expressions can be DoS'd with a deep nested expression.

**Fix.** Either guard depth at parse time, or convert to an iterative trampoline.

**Depth guard (cheap):**

```java
public final class Parser {
    private static final int MAX_DEPTH = 1024;

    public Expression parse(String src) {
        Expression expr = doParse(src);
        if (depth(expr) > MAX_DEPTH) {
            throw new ExpressionTooDeepException();
        }
        return expr;
    }
}
```

**Iterative evaluator (proper):**

```java
public int interpret(Context ctx) {
    Deque<Frame> stack = new ArrayDeque<>();
    stack.push(new Frame(this));
    int result = 0;
    while (!stack.isEmpty()) {
        Frame f = stack.peek();
        // ... post-order walk over heap-allocated frames
    }
    return result;
}
```

For Interpreter specifically, a depth guard usually suffices — most real ASTs are shallow. But document the limit, and make sure user-facing parsers reject inputs that would exceed it.

---

## Bug 5: Caching results in mutable terminal

```java
public final class Variable implements Expression {
    private final String name;
    private Integer cached;              // BUG: caches first lookup

    public Variable(String name) { this.name = name; }

    public int interpret(Context ctx) {
        if (cached == null) {
            cached = ctx.get(name);
        }
        return cached;
    }
}

// Setup:
Context ctx = new Context();
ctx.set("x", 1);
Variable x = new Variable("x");
System.out.println(x.interpret(ctx));    // 1
ctx.set("x", 99);
System.out.println(x.interpret(ctx));    // 1 — wrong, should be 99
```

**Bug.** `cached` is field-level state on a *terminal node*. The terminal is supposed to be a pure lookup — read fresh from Context every time. Caching it inside the node ties the node to the first Context it ever saw.

The same `Variable("x")` instance might appear in multiple subtrees, evaluated against different Contexts. Caching breaks all of those.

**Fix.** Don't cache at the node level. Read Context every time:

```java
public int interpret(Context ctx) {
    return ctx.get(name);
}
```

If you want caching for performance, cache at the *evaluation* level (memoize per `(node, ctx)` pair), not on the node itself. See Bug 11 for the wrong way to do that.

The general rule: **AST nodes should be immutable and side-effect-free.** State belongs in Context.

---

## Bug 6: Context shared across threads

```java
public class Context {
    private final Map<String, Integer> bindings = new HashMap<>();

    public int get(String name) { return bindings.get(name); }
    public void set(String name, int v) { bindings.put(name, v); }
}

// Server evaluates many expressions concurrently against shared Context:
Context ctx = new Context();
ctx.set("requestId", 0);

ExecutorService pool = Executors.newFixedThreadPool(8);
for (Request r : requests) {
    pool.submit(() -> {
        ctx.set("requestId", r.id);
        Expression e = compile(r.rule);
        return e.interpret(ctx);         // BUG: ctx mutated by other threads
    });
}
```

**Bug.** Two issues:

1. `HashMap` is not thread-safe. Concurrent `put` can corrupt the internal table (in Java 7, infinite loops; in Java 8+, lost updates and stale reads).
2. Even with `ConcurrentHashMap`, the *logical* race remains: thread A sets `requestId=42`, thread B overwrites with `99`, thread A then evaluates and sees B's value.

**Fix.** Per-thread Context, or immutable Context:

```java
// Per-request Context (preferred):
pool.submit(() -> {
    Context local = new Context();
    local.set("requestId", r.id);
    return compile(r.rule).interpret(local);
});
```

Or, make Context immutable and pass updated copies down:

```java
public final class Context {
    private final Map<String, Integer> bindings;

    public Context() { this.bindings = Map.of(); }
    private Context(Map<String, Integer> b) { this.bindings = b; }

    public Context with(String name, int v) {
        Map<String, Integer> next = new HashMap<>(bindings);
        next.put(name, v);
        return new Context(Map.copyOf(next));
    }

    public int get(String name) { return bindings.get(name); }
}
```

Immutable Contexts compose naturally and are trivially thread-safe. The cost is allocation per binding — usually fine for small expressions.

---

## Bug 7: Mixing parser and interpreter in one method

```java
public final class Expression {
    private final String src;
    public Expression(String src) { this.src = src; }

    public int interpret(Context ctx) {
        // Parse src into tokens, build a tiny AST, evaluate.
        List<Token> tokens = tokenize(src);
        Node ast = parse(tokens);
        return eval(ast, ctx);           // BUG: re-parses every call
    }
}

// Hot path:
Expression rule = new Expression("x + y * 2");
for (int i = 0; i < 1_000_000; i++) {
    rule.interpret(ctx);                 // tokenize + parse + eval, every iteration
}
```

**Bug.** Parsing happens on every `interpret` call. For a rule used a million times in a loop, you tokenize and parse it a million times. The actual evaluation is microseconds; the parsing dominates.

This also conflates two responsibilities (parsing vs. evaluating) into one method, making it hard to test parsing separately or to swap the parser.

**Fix.** Separate parse from interpret. Parse once, evaluate many:

```java
public final class Expression {
    private final Node ast;              // parsed eagerly

    public Expression(String src) {
        this.ast = parse(tokenize(src));
    }

    public int interpret(Context ctx) {
        return eval(ast, ctx);
    }
}

// Caller:
Expression rule = new Expression("x + y * 2");   // parsed once
for (int i = 0; i < 1_000_000; i++) {
    rule.interpret(ctx);                          // just eval
}
```

In Interpreter, **the AST is the compiled form**. Building it is the parse step; walking it is the interpret step. Don't merge them.

---

## Bug 8: Forgotten recursion in nonterminal

```java
public final class Or implements BoolExpression {
    private final BoolExpression left, right;
    public Or(BoolExpression l, BoolExpression r) { left = l; right = r; }

    public boolean interpret(Context ctx) {
        return left.interpret(ctx);      // BUG: ignores right
    }
}

// Setup:
BoolExpression e = new Or(new Constant(false), new Constant(true));
System.out.println(e.interpret(new Context()));   // false — wrong
```

**Bug.** `Or.interpret` evaluates only `left`. Right is dropped. Looks like a copy-paste-from-Constant mistake — author started writing the simple case and forgot to combine.

A unit test with `Or(false, true) → true` catches it instantly. The bug survives because tests only used `Or(true, x)` (which happens to return true correctly by accident).

**Fix.**

```java
public boolean interpret(Context ctx) {
    return left.interpret(ctx) || right.interpret(ctx);
}
```

**Test discipline for nonterminals:** every binary operator needs all four truth-table corners. For `Or`: `(F,F)→F`, `(F,T)→T`, `(T,F)→T`, `(T,T)→T`. Skipping `(F,T)` is what hid this bug.

---

## Bug 9: Short-circuit evaluation broken

```java
public final class And implements BoolExpression {
    private final BoolExpression left, right;
    public And(BoolExpression l, BoolExpression r) { left = l; right = r; }

    public boolean interpret(Context ctx) {
        boolean l = left.interpret(ctx);
        boolean r = right.interpret(ctx);   // BUG: always evaluated
        return l && r;
    }
}

// Setup with a side-effecting / failing right side:
BoolExpression safe = new And(
    new IsNotNull("user"),
    new HasRole("user", "admin")             // throws if user is null
);
safe.interpret(ctxWithoutUser);              // NullPointerException — wrong
```

**Bug.** Evaluating both sides eagerly is fine for *pure* expressions but breaks when the right side has side effects, throws on bad input, or is expensive. The whole point of `&&` in Java is short-circuit: if left is false, right is never touched.

The user wrote `IsNotNull("user") AND HasRole(...)` precisely to guard against the null case. The interpreter eagerly evaluates the right side anyway, defeating the guard.

**Fix.** Short-circuit:

```java
public boolean interpret(Context ctx) {
    if (!left.interpret(ctx)) return false;   // short-circuit
    return right.interpret(ctx);
}
```

And for `Or`:

```java
public boolean interpret(Context ctx) {
    if (left.interpret(ctx)) return true;
    return right.interpret(ctx);
}
```

**Document the semantics.** If your DSL is meant to mirror SQL (which is *not* short-circuit and may evaluate either side first), say so. If it mirrors C-family `&&`/`||`, short-circuit is required. Users will write code assuming one or the other.

---

## Bug 10: Wrong type assumption in Context

```java
public class Context {
    private final Map<String, Object> bindings = new HashMap<>();

    public void set(String name, Object v) { bindings.put(name, v); }
    public Object get(String name) { return bindings.get(name); }
}

public final class Variable implements Expression {
    private final String name;
    public Variable(String name) { this.name = name; }

    public int interpret(Context ctx) {
        return (Integer) ctx.get(name);  // BUG: blind cast
    }
}

// Setup:
Context ctx = new Context();
ctx.set("age", "42");                    // accidentally a String (e.g. from JSON)
new Variable("age").interpret(ctx);      // ClassCastException
```

**Bug.** `Variable.interpret` casts to `Integer`, but Context is `Map<String, Object>`. If anything ever puts a non-Integer in (a String from JSON, a Long from a database, a Double from a CSV), the cast explodes at evaluation time with a useless message ("class String cannot be cast to class Integer").

The error blames the cast site, not the *real* mistake (the bad input). And it surfaces only when this specific variable is evaluated — possibly months after the bad data was written.

**Fix.** Type-check at the boundary, with a clear message:

```java
public int interpret(Context ctx) {
    Object v = ctx.get(name);
    if (v == null) {
        throw new UndefinedVariableException(name);
    }
    if (!(v instanceof Integer i)) {
        throw new TypeError(
            "Variable '" + name + "' expected Integer but got "
            + v.getClass().getSimpleName() + ": " + v);
    }
    return i;
}
```

Better still: make Context typed at the source. Use `Map<String, Integer>` for an integer DSL, or a tagged union (`Value = IntValue | StringValue | BoolValue`) for a multi-type one. Push the type check to where the value enters the system, not where it's read.

---

## Bug 11: Memoization keyed only by node

```java
public final class Variable implements Expression {
    private final String name;
    private static final Map<Variable, Integer> cache = new HashMap<>();

    public Variable(String name) { this.name = name; }

    public int interpret(Context ctx) {
        return cache.computeIfAbsent(this, k -> ctx.get(name));   // BUG
    }

    @Override public boolean equals(Object o) {
        return o instanceof Variable v && v.name.equals(name);
    }
    @Override public int hashCode() { return name.hashCode(); }
}

// Setup:
Variable x = new Variable("x");
Context a = new Context(); a.set("x", 1);
Context b = new Context(); b.set("x", 99);
x.interpret(a);                          // 1, cached
x.interpret(b);                          // 1 — wrong, should be 99
```

**Bug.** The cache key is the node. But the result depends on the *Context*, which isn't part of the key. Same node + different Context = different result, but the cache returns the first one forever.

Worse, the cache is `static` — so the bug persists across requests, across threads, across the whole JVM lifetime.

**Fix.** Either don't memoize variable lookups (they're already O(1)) or key by `(node, contextIdentity)`:

```java
public int interpret(Context ctx) {
    return ctx.get(name);                // no caching needed
}
```

If you genuinely have an expensive sub-expression worth memoizing (a regex compile, an HTTP call, a heavy computation that's deterministic in `ctx`), memoize at the *Context* level, not the node level:

```java
public int interpret(Context ctx) {
    return ctx.memoize(this, () -> doExpensiveWork(ctx));
}
```

Now the cache lives with the Context. Different Contexts get different caches; cache lifetime equals Context lifetime. No cross-request leaks, no static state.

**Lesson:** memoization keys must include *every input* that affects the output. For Interpreter, that's `(node, context)` — never just `node`.

---

## Bug 12: Optimizer mutates AST in place

```java
public final class Add implements Expression {
    public Expression left, right;       // BUG: public mutable
    public Add(Expression l, Expression r) { left = l; right = r; }

    public int interpret(Context ctx) {
        return left.interpret(ctx) + right.interpret(ctx);
    }
}

public final class ConstFolder {
    public void optimize(Add node) {
        if (node.left instanceof Const cl && node.right instanceof Const cr) {
            node.left = new Const(cl.value() + cr.value());
            node.right = new Const(0);   // BUG: mutates while interpreter may be reading
        }
    }
}

// Server uses one shared, parsed AST across requests:
Expression rule = parse("x + (1 + 2)");
ExecutorService pool = Executors.newFixedThreadPool(8);

pool.submit(() -> rule.interpret(ctxA));
pool.submit(() -> optimizer.optimize((Add) rule));   // race
pool.submit(() -> rule.interpret(ctxB));             // sees half-rewritten tree
```

**Bug.** Two failure modes:

1. **Concurrent mutation.** The optimizer rewrites `node.left` while another thread is reading it. Reader sees a torn state — sometimes the old `Add(1, 2)`, sometimes the new `Const(3)`, sometimes (with non-volatile fields) something undefined.
2. **Semantic drift.** Even single-threaded: `node.right = new Const(0)` is wrong. The folded value should replace the *whole* `Add`, not just patch its children. The result is `(3 + 0) = 3` by luck — but for `Multiply`, this becomes `3 * 0 = 0`. Catastrophic.

**Fix.** Make AST nodes immutable. Optimization returns a *new* tree:

```java
public final class Add implements Expression {
    private final Expression left, right;
    public Add(Expression l, Expression r) { left = l; right = r; }
    public Expression left()  { return left; }
    public Expression right() { return right; }

    public int interpret(Context ctx) {
        return left.interpret(ctx) + right.interpret(ctx);
    }
}

public final class ConstFolder {
    public Expression optimize(Expression e) {
        if (e instanceof Add a) {
            Expression l = optimize(a.left());
            Expression r = optimize(a.right());
            if (l instanceof Const cl && r instanceof Const cr) {
                return new Const(cl.value() + cr.value());   // replace whole node
            }
            return new Add(l, r);
        }
        return e;
    }
}

// Caller swaps the reference atomically:
Expression optimized = optimizer.optimize(rule);
sharedRule.set(optimized);                   // AtomicReference
```

Immutable AST + functional optimizer = safe to share, safe to optimize concurrently, no race conditions. The old AST keeps working for in-flight evaluations; new evaluations pick up the optimized one.

**Rule:** if your AST is shared (across threads, across requests, across optimization passes), it must be immutable. Mutation belongs in the *Context*, never in the tree.

---

[← Tasks](tasks.md) · [Optimize →](optimize.md)
