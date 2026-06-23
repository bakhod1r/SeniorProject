# Interpreter — Optimize

> **Source:** [refactoring.guru/design-patterns/interpreter](https://refactoring.guru/design-patterns/interpreter)

Each section presents an Interpreter that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Constant folding at AST construction time](#optimization-1-constant-folding-at-ast-construction-time)
2. [Optimization 2: Compile AST to bytecode](#optimization-2-compile-ast-to-bytecode)
3. [Optimization 3: Flat AST with indices instead of pointers](#optimization-3-flat-ast-with-indices-instead-of-pointers)
4. [Optimization 4: Memoize Variable lookups across one interpret() call](#optimization-4-memoize-variable-lookups-across-one-interpret-call)
5. [Optimization 5: Short-circuit Boolean evaluation](#optimization-5-short-circuit-boolean-evaluation)
6. [Optimization 6: Specialized terminals for hot variables](#optimization-6-specialized-terminals-for-hot-variables)
7. [Optimization 7: Iterative interpreter (trampoline) for deep ASTs](#optimization-7-iterative-interpreter-trampoline-for-deep-asts)
8. [Optimization 8: Cache pure subexpression results](#optimization-8-cache-pure-subexpression-results)
9. [Optimization 9: Skip dead branches](#optimization-9-skip-dead-branches)
10. [Optimization 10: Threaded code interpreter (advanced)](#optimization-10-threaded-code-interpreter-advanced)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Constant folding at AST construction time

### Before

```java
public sealed interface Expr permits Constant, Variable, And, Or, Not {}
public record Constant(boolean value) implements Expr {}
public record Variable(String name)   implements Expr {}
public record And(Expr l, Expr r)     implements Expr {}
public record Or(Expr l, Expr r)      implements Expr {}
public record Not(Expr e)             implements Expr {}

boolean interpret(Expr e, Context ctx) {
    return switch (e) {
        case Constant c  -> c.value();
        case Variable v  -> ctx.get(v.name());
        case And a       -> interpret(a.l(), ctx) && interpret(a.r(), ctx);
        case Or  o       -> interpret(o.l(), ctx) || interpret(o.r(), ctx);
        case Not n       -> !interpret(n.e(), ctx);
    };
}

// Source: "true AND x AND (false OR y)"
Expr ast = new And(
    new Constant(true),
    new And(new Variable("x"),
            new Or(new Constant(false), new Variable("y")))
);
```

Every interpretation re-evaluates `Constant(true) AND x` even though it always equals `x`. For 1M evaluations: 1M wasted boolean ANDs.

### After

```java
public final class ConstantFolder {
    public Expr fold(Expr e) {
        return switch (e) {
            case Constant c -> c;
            case Variable v -> v;
            case And a -> {
                Expr l = fold(a.l()), r = fold(a.r());
                if (l instanceof Constant lc) yield lc.value() ? r : new Constant(false);
                if (r instanceof Constant rc) yield rc.value() ? l : new Constant(false);
                yield new And(l, r);
            }
            case Or o -> {
                Expr l = fold(o.l()), r = fold(o.r());
                if (l instanceof Constant lc) yield lc.value() ? new Constant(true) : r;
                if (r instanceof Constant rc) yield rc.value() ? new Constant(true) : l;
                yield new Or(l, r);
            }
            case Not n -> {
                Expr inner = fold(n.e());
                if (inner instanceof Constant ic) yield new Constant(!ic.value());
                if (inner instanceof Not nn)      yield nn.e();   // !!x = x
                yield new Not(inner);
            }
        };
    }
}

Expr folded = new ConstantFolder().fold(ast);   // -> And(Variable("x"), Variable("y"))
```

**Measurement.** One-time pass cost amortized over millions of interpretations. Folded AST is smaller and dispatches fewer nodes. ~2× speedup on expressions with constant subtrees; AST shrinkage often 30-60% on real workloads.

**Lesson:** Constant folding is the single most cost-effective optimization for tree interpreters. Run it once at parse time; benefit forever.

---

## Optimization 2: Compile AST to bytecode

### Before

```java
boolean interpret(Expr e, Context ctx) {
    return switch (e) {
        case Constant c  -> c.value();
        case Variable v  -> ctx.get(v.name());
        case And a       -> interpret(a.l(), ctx) && interpret(a.r(), ctx);
        case Or  o       -> interpret(o.l(), ctx) || interpret(o.r(), ctx);
        case Not n       -> !interpret(n.e(), ctx);
    };
}
```

Every node visit is a virtual dispatch + recursive call + return. Heavy stack churn, poor branch prediction.

### After

```java
public final class Bytecode {
    public static final byte OP_CONST_T = 0;
    public static final byte OP_CONST_F = 1;
    public static final byte OP_LOAD    = 2;   // followed by 1-byte slot index
    public static final byte OP_AND     = 3;
    public static final byte OP_OR      = 4;
    public static final byte OP_NOT     = 5;
    public static final byte OP_RETURN  = 6;
}

public final class Compiler {
    private final ByteArrayOutputStream out = new ByteArrayOutputStream();
    private final Map<String, Integer> slots = new HashMap<>();

    public byte[] compile(Expr e) {
        emit(e);
        out.write(Bytecode.OP_RETURN);
        return out.toByteArray();
    }

    private void emit(Expr e) {
        switch (e) {
            case Constant c -> out.write(c.value() ? Bytecode.OP_CONST_T : Bytecode.OP_CONST_F);
            case Variable v -> {
                out.write(Bytecode.OP_LOAD);
                out.write(slots.computeIfAbsent(v.name(), k -> slots.size()));
            }
            case And a -> { emit(a.l()); emit(a.r()); out.write(Bytecode.OP_AND); }
            case Or  o -> { emit(o.l()); emit(o.r()); out.write(Bytecode.OP_OR);  }
            case Not n -> { emit(n.e());              out.write(Bytecode.OP_NOT); }
        }
    }
}

public final class VM {
    public boolean run(byte[] code, boolean[] env) {
        boolean[] stack = new boolean[64];
        int sp = 0;
        int pc = 0;
        while (true) {
            switch (code[pc++]) {
                case Bytecode.OP_CONST_T -> stack[sp++] = true;
                case Bytecode.OP_CONST_F -> stack[sp++] = false;
                case Bytecode.OP_LOAD    -> stack[sp++] = env[code[pc++]];
                case Bytecode.OP_AND     -> { boolean r = stack[--sp]; stack[sp - 1] &= r; }
                case Bytecode.OP_OR      -> { boolean r = stack[--sp]; stack[sp - 1] |= r; }
                case Bytecode.OP_NOT     -> stack[sp - 1] = !stack[sp - 1];
                case Bytecode.OP_RETURN  -> { return stack[sp - 1]; }
            }
        }
    }
}
```

**Measurement.** Linear array scan vs recursive tree walk: 5-20× speedup. Branch predictor latches onto opcode patterns; data is contiguous; no heap allocations during execution.

**Trade-off.** One-time compile step; need a stack discipline; debugging is harder (no AST → opcode mapping unless tracked).

**Lesson:** Tree-walking interpreters lose to bytecode VMs by an order of magnitude. CPython, Lua, V8 (warm-up), JVM all run bytecode for this reason.

---

## Optimization 3: Flat AST with indices instead of pointers

### Before

```java
// Pointer-rich AST: each node a separate heap object.
public record And(Expr l, Expr r) implements Expr {}
public record Or (Expr l, Expr r) implements Expr {}

Expr deep = ...;   // 10M nodes, scattered across the heap
```

Every node access likely a cache miss. Heap overhead per record (~16-32B header + fields).

### After

```java
public final class FlatAst {
    // tags[i]    : node kind  (0=CONST, 1=VAR, 2=AND, 3=OR, 4=NOT)
    // a[i], b[i] : payload — child index, value, slot
    public final byte[] tags;
    public final int[]  a;
    public final int[]  b;
    public final int    root;

    public FlatAst(byte[] tags, int[] a, int[] b, int root) {
        this.tags = tags; this.a = a; this.b = b; this.root = root;
    }
}

public final class FlatInterpreter {
    private final FlatAst t;
    private final boolean[] env;

    public FlatInterpreter(FlatAst t, boolean[] env) {
        this.t = t; this.env = env;
    }

    public boolean eval(int i) {
        return switch (t.tags[i]) {
            case 0  -> t.a[i] != 0;          // CONST
            case 1  -> env[t.a[i]];          // VAR  (a = slot)
            case 2  -> eval(t.a[i]) & eval(t.b[i]);   // AND
            case 3  -> eval(t.a[i]) | eval(t.b[i]);   // OR
            case 4  -> !eval(t.a[i]);                 // NOT
            default -> throw new IllegalStateException();
        };
    }
}
```

**Measurement.** On a 10M-node AST, flat representation gives ~3-4× speedup over pointer-chasing. Memory footprint shrinks ~50% (no object headers, packed primitives).

**Trade-off.** Loses Java's type safety; node access is array indexing; mutation requires array-grow logic.

**Lesson:** Cache-friendly data layouts beat clever algorithms on modern CPUs. Game engines, columnar databases (Arrow, DuckDB), and high-perf parsers all flatten.

---

## Optimization 4: Memoize Variable lookups across one interpret() call

### Before

```java
public final class Context {
    private final Map<String, Boolean> bindings;
    public boolean get(String name) { return bindings.get(name); }
}

boolean interpret(Expr e, Context ctx) {
    return switch (e) {
        case Variable v -> ctx.get(v.name());   // hash lookup every time
        // ...
    };
}

// Expression: "x AND (x OR y) AND (NOT x)"
// Variable "x" looked up 3 times — same value each time.
```

Hash lookup costs ~50-100ns; for ASTs that mention the same variable many times, this adds up.

### After

```java
public final class CachingContext {
    private final Map<String, Boolean> bindings;
    private final Map<String, Boolean> cache = new HashMap<>();

    public CachingContext(Map<String, Boolean> bindings) { this.bindings = bindings; }

    public boolean get(String name) {
        Boolean cached = cache.get(name);
        if (cached != null) return cached;
        boolean v = bindings.get(name);
        cache.put(name, v);
        return v;
    }

    public void resetCache() { cache.clear(); }
}

// Per interpret() call:
ctx.resetCache();
boolean result = interpret(ast, ctx);
```

**Measurement.** For ASTs with high variable reuse (typical of Boolean expressions, SQL WHERE clauses), 2-3× speedup. The cache is a tiny `HashMap`; first lookup pays cost, all repeats are O(1) on a smaller working set.

**Trade-off.** Only valid if `Context` is read-only during one `interpret()` call. If a sub-expression mutates the context, cache must be invalidated.

**Lesson:** Across one evaluation, treat the binding set as immutable. Caching lookups is essentially common-subexpression elimination at the variable level.

---

## Optimization 5: Short-circuit Boolean evaluation

### Before

```java
case And a -> interpret(a.l(), ctx) & interpret(a.r(), ctx);   // bitwise — no short-circuit
case Or  o -> interpret(o.l(), ctx) | interpret(o.r(), ctx);
```

The right child is *always* evaluated, even when the left already determines the result. If the right child is `expensiveTreeWalk()`, we pay for it every time.

### After

```java
boolean interpret(Expr e, Context ctx) {
    return switch (e) {
        case Constant c  -> c.value();
        case Variable v  -> ctx.get(v.name());
        case And a -> {
            if (!interpret(a.l(), ctx)) yield false;     // skip right child
            yield interpret(a.r(), ctx);
        }
        case Or o -> {
            if (interpret(o.l(), ctx))  yield true;      // skip right child
            yield interpret(o.r(), ctx);
        }
        case Not n -> !interpret(n.e(), ctx);
    };
}
```

**Measurement.** On expressions where the left child fails ~50% of the time and the right child is expensive: 2× speedup. For typical filter / guard expressions in SQL or rule engines, often more.

**Lesson:** Short-circuit evaluation is *required* by most languages' Boolean operators (Java's `&&`, `||`). When implementing your own DSL, do the same — it's cheaper *and* lets users write `x != null && x.foo()` safely.

---

## Optimization 6: Specialized terminals for hot variables

### Before

```java
public record Variable(String name) implements Expr {}

case Variable v -> ctx.get(v.name());   // string hash lookup per access
```

Each variable read does: hash the string, walk a hash bucket, compare strings. For ASTs that mention `x` 1000 times: 1000 string hashes.

### After (compilation pass that pre-resolves bindings)

```java
public sealed interface Expr permits Constant, Variable, BoundSlot, And, Or, Not {}
public record BoundSlot(int slot) implements Expr {}   // resolved binding

public final class Resolver {
    private final Map<String, Integer> slotByName = new HashMap<>();

    public Expr resolve(Expr e) {
        return switch (e) {
            case Constant c   -> c;
            case Variable v   -> new BoundSlot(slotByName.computeIfAbsent(v.name(), k -> slotByName.size()));
            case BoundSlot s  -> s;
            case And a        -> new And(resolve(a.l()), resolve(a.r()));
            case Or  o        -> new Or(resolve(o.l()),  resolve(o.r()));
            case Not n        -> new Not(resolve(n.e()));
        };
    }

    public int slotCount() { return slotByName.size(); }
}

public final class SlotInterpreter {
    public boolean eval(Expr e, boolean[] slots) {
        return switch (e) {
            case Constant c   -> c.value();
            case BoundSlot s  -> slots[s.slot()];          // single array load
            case Variable v   -> throw new IllegalStateException("unresolved");
            case And a        -> eval(a.l(), slots) && eval(a.r(), slots);
            case Or  o        -> eval(o.l(), slots) || eval(o.r(), slots);
            case Not n        -> !eval(n.e(), slots);
        };
    }
}
```

**Measurement.** Array access (~1 cycle) vs `HashMap.get` on a String (~50-100ns including hashing): 50-100× faster per variable read. End-to-end speedup on variable-heavy expressions: 5-10×.

**Lesson:** Names are for humans; runtime should see numbers. Every serious language implementation does this — Python's locals are a tuple indexed by slot; JVM bytecode uses `iload_0`, `iload_1`; Lua uses register slots.

---

## Optimization 7: Iterative interpreter (trampoline) for deep ASTs

### Before

```java
boolean interpret(Expr e, Context ctx) {
    return switch (e) {
        case And a -> interpret(a.l(), ctx) && interpret(a.r(), ctx);
        // recursion depth = AST depth
    };
}

// Right-recursive expression of depth 200K:
Expr deep = buildRightRecursive(200_000);
interpret(deep, ctx);   // StackOverflowError
```

Default JVM stack ~512KB; ~16-32K Java frames. User-supplied expressions can blow it.

### After (explicit-stack trampoline)

```java
public boolean interpret(Expr root, boolean[] slots) {
    Deque<Object> work   = new ArrayDeque<>();
    Deque<Boolean> values = new ArrayDeque<>();
    work.push(root);

    while (!work.isEmpty()) {
        Object cur = work.pop();
        if (cur instanceof Constant c) {
            values.push(c.value());
        } else if (cur instanceof BoundSlot s) {
            values.push(slots[s.slot()]);
        } else if (cur instanceof And a) {
            work.push(Op.AND);
            work.push(a.r());
            work.push(a.l());
        } else if (cur instanceof Or o) {
            work.push(Op.OR);
            work.push(o.r());
            work.push(o.l());
        } else if (cur instanceof Not n) {
            work.push(Op.NOT);
            work.push(n.e());
        } else if (cur instanceof Op op) {
            switch (op) {
                case AND -> { boolean r = values.pop(); boolean l = values.pop(); values.push(l && r); }
                case OR  -> { boolean r = values.pop(); boolean l = values.pop(); values.push(l || r); }
                case NOT -> values.push(!values.pop());
            }
        }
    }
    return values.pop();
}

enum Op { AND, OR, NOT }
```

**Measurement.** Stack now lives in heap; depth bounded by RAM (gigabytes). Bonus: contiguous deque storage gives better cache locality than scattered Java frames — modest speedup (10-30%) even on shallow ASTs.

**Trade-off.** More verbose; loses easy short-circuit (you must encode it via skipping pushes).

**Lesson:** Any interpreter accepting *user-supplied* programs must be iterative. JVM has no tail-call optimization; user input depth is unbounded.

---

## Optimization 8: Cache pure subexpression results

### Before

```java
// Expression: "(x AND y) OR (x AND y) OR (x AND y)"
// Same subtree evaluated 3 times per call.
boolean interpret(Expr e, boolean[] slots) {
    return switch (e) {
        case And a -> interpret(a.l(), slots) && interpret(a.r(), slots);
        case Or  o -> interpret(o.l(), slots) || interpret(o.r(), slots);
        // ...
    };
}
```

Common subexpressions waste work. Combined with hash-consing (each shared subtree is the same object), we can memoize by identity.

### After

```java
public final class MemoInterpreter {
    private final IdentityHashMap<Expr, Boolean> memo = new IdentityHashMap<>();
    private final boolean[] slots;

    public MemoInterpreter(boolean[] slots) { this.slots = slots; }

    public boolean eval(Expr e) {
        Boolean cached = memo.get(e);
        if (cached != null) return cached;
        boolean v = compute(e);
        memo.put(e, v);
        return v;
    }

    private boolean compute(Expr e) {
        return switch (e) {
            case Constant c   -> c.value();
            case BoundSlot s  -> slots[s.slot()];
            case And a        -> eval(a.l()) && eval(a.r());
            case Or  o        -> eval(o.l()) || eval(o.r());
            case Not n        -> !eval(n.e());
            default           -> throw new IllegalStateException();
        };
    }
}

// One memo per interpret() call (slots are constant within the call).
new MemoInterpreter(slots).eval(ast);
```

**Measurement.** For hash-consed ASTs with many shared subexpressions: 2-5× speedup. SMT-style workloads (Z3) benefit by orders of magnitude.

**Trade-off.** Memo overhead per node (~20-40ns map insert). Beneficial only when sharing is real. Combine with the hash-consing pass from the Visitor optimize file.

**Lesson:** Memoization + hash-consing turns evaluation cost from "AST size" into "unique subexpression count" — a huge win on regular workloads.

---

## Optimization 9: Skip dead branches

### Before

```java
public record If(Expr cond, Expr thenE, Expr elseE) implements Expr {}

boolean interpret(Expr e, boolean[] slots) {
    return switch (e) {
        case If i -> {
            boolean c = interpret(i.cond(), slots);
            boolean t = interpret(i.thenE(), slots);   // always evaluated
            boolean f = interpret(i.elseE(), slots);   // always evaluated
            yield c ? t : f;
        }
        // ...
    };
}
```

Both branches evaluated even though only one is selected. If branches are large or have side effects, this is wrong *and* slow.

### After

```java
boolean interpret(Expr e, boolean[] slots) {
    return switch (e) {
        case If i -> interpret(i.cond(), slots)
                       ? interpret(i.thenE(), slots)
                       : interpret(i.elseE(), slots);
        // ...
    };
}
```

Combined with constant folding from Optimization 1, dead branches can be *eliminated entirely* at compile time:

```java
public Expr fold(Expr e) {
    if (e instanceof If i) {
        Expr c = fold(i.cond());
        if (c instanceof Constant cc) return cc.value() ? fold(i.thenE()) : fold(i.elseE());
        return new If(c, fold(i.thenE()), fold(i.elseE()));
    }
    // ...
}
```

**Measurement.** For balanced if-trees: ~2× speedup (each path evaluates only half the work). For deeply nested conditionals (rule engines, decision trees), savings compound exponentially.

**Lesson:** Lazy evaluation of branches is the *correct* semantics for `if`; doing it both ways is both slow and bug-prone. Compile-time dead branch elimination is the cherry on top.

---

## Optimization 10: Threaded code interpreter (advanced)

### Before (switch-based bytecode dispatch)

```c
typedef enum { OP_CONST_T, OP_CONST_F, OP_LOAD, OP_AND, OP_OR, OP_NOT, OP_RETURN } Op;

bool run(uint8_t* code, bool* env) {
    bool stack[64]; int sp = 0; int pc = 0;
    for (;;) {
        switch (code[pc++]) {
            case OP_CONST_T: stack[sp++] = true;  break;
            case OP_CONST_F: stack[sp++] = false; break;
            case OP_LOAD:    stack[sp++] = env[code[pc++]]; break;
            case OP_AND:     { bool r = stack[--sp]; stack[sp-1] &= r; break; }
            case OP_OR:      { bool r = stack[--sp]; stack[sp-1] |= r; break; }
            case OP_NOT:     stack[sp-1] = !stack[sp-1]; break;
            case OP_RETURN:  return stack[sp-1];
        }
    }
}
```

Every iteration: load opcode, range-check, jump to switch dispatch table, jump to case. The CPU's branch predictor sees *one* indirect branch (the switch) and constantly mispredicts.

### After (direct-threaded code with computed goto)

```c
bool run(uint8_t* code, bool* env) {
    static void* labels[] = {
        &&L_CONST_T, &&L_CONST_F, &&L_LOAD,
        &&L_AND,     &&L_OR,      &&L_NOT, &&L_RETURN
    };
    bool stack[64]; int sp = 0; int pc = 0;

    #define DISPATCH() goto *labels[code[pc++]]

    DISPATCH();

L_CONST_T: stack[sp++] = true;  DISPATCH();
L_CONST_F: stack[sp++] = false; DISPATCH();
L_LOAD:    stack[sp++] = env[code[pc++]]; DISPATCH();
L_AND:     { bool r = stack[--sp]; stack[sp-1] &= r; } DISPATCH();
L_OR:      { bool r = stack[--sp]; stack[sp-1] |= r; } DISPATCH();
L_NOT:     stack[sp-1] = !stack[sp-1]; DISPATCH();
L_RETURN:  return stack[sp-1];
}
```

Each opcode handler ends with its *own* indirect jump, so the branch predictor sees N predictors instead of 1. Hit rate jumps; pipeline stays full.

**Measurement.** 1.5-3× speedup over switch-based dispatch on real workloads (CPython 3.11 adopted a similar technique). Best gains on tight loops where dispatch dominates.

**Trade-off.** Computed goto is a GCC/Clang extension (not portable to MSVC, not available in plain Java). In Java the closest equivalents are `MethodHandle`-based dispatch or `invokedynamic`. Code is harder to read and modify.

**Lesson:** Once you've reached bytecode, the next ceiling is dispatch overhead. Direct threading was the gold standard for two decades; today, JIT compilation (HotSpot, GraalVM Truffle) goes further by removing dispatch entirely.

---

## Optimization Tips

- **Measure before you optimize.** Use JMH for Java, `pyperf` or `timeit` for Python, `perf stat` on Linux. Don't trust intuition about interpreter hotspots.
- **Tree-walking < bytecode < JIT.** Know which level is enough for your workload. Most DSLs and rule engines do fine on bytecode; only PL implementations need JIT.
- **Constant folding is the highest-ROI optimization.** Run it once at parse time; users write expressions with constants everywhere (defaults, feature flags, dead branches).
- **Pre-resolve names to slot indices.** String hashing in the hot loop is the easiest perf bug to fix.
- **Don't sweat virtual call cost** until profiling proves it. Cache misses and allocations almost always dominate first.
- **Memoize and hash-cons** for SMT-style and rule-engine workloads where the same subexpression appears many times.
- **Iterative interpreters** are mandatory for user-supplied input. Stack overflow turns a slow interpreter into a crashing one.
- **Short-circuit the obvious** (`AND`, `OR`, `IF`). Skipping work always beats doing work faster.
- **Threaded code / computed goto** is a real but late-stage win; reach for it only after bytecode is in place and dispatch is the bottleneck.
- **For real performance, look at GraalVM Truffle** (partial-evaluation framework that turns AST interpreters into JIT-compiled native code) or a register-based bytecode VM (Lua 5, Dalvik, V8 Ignition).

[← Find Bug](find-bug.md) · [Behavioral patterns home](../README.md)
