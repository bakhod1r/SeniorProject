# Interpreter — Interview Prep

> **Source:** [refactoring.guru/design-patterns/interpreter](https://refactoring.guru/design-patterns/interpreter)

A practice bank for Interpreter pattern interviews — concise answers, code, and trade-offs.

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

### Q1: What is the Interpreter pattern?

**A.** A behavioral design pattern that defines a representation for a grammar of a simple language, plus an interpreter that uses the representation to interpret sentences. Each grammar rule becomes a class; sentences become trees of class instances. Each node has an `interpret(context)` method that knows how to evaluate itself.

### Q2: What roles does the Interpreter pattern define?

**A.** Four:
- **AbstractExpression** — declares `interpret(context)`.
- **TerminalExpression** — leaves of the AST: literals, variables. Implements `interpret` directly.
- **NonterminalExpression** — composites holding child expressions: `And`, `Or`, `Not`. Recurses into children.
- **Context** — global information passed during interpretation: variable bindings, IO, settings.

Plus the **Client** that builds the AST (often via a separate parser) and triggers `interpret(context)`.

### Q3: Show a minimal Interpreter example.

**A.** Boolean expression interpreter:

```java
interface BoolExpression {
    boolean interpret(Map<String, Boolean> context);
}

class Constant implements BoolExpression {
    private final boolean value;
    public Constant(boolean value) { this.value = value; }
    public boolean interpret(Map<String, Boolean> ctx) { return value; }
}

class Variable implements BoolExpression {
    private final String name;
    public Variable(String name) { this.name = name; }
    public boolean interpret(Map<String, Boolean> ctx) {
        return ctx.getOrDefault(name, false);
    }
}

class And implements BoolExpression {
    private final BoolExpression left, right;
    public And(BoolExpression l, BoolExpression r) { left = l; right = r; }
    public boolean interpret(Map<String, Boolean> ctx) {
        return left.interpret(ctx) && right.interpret(ctx);
    }
}
```

Usage: `new And(new Variable("x"), new Constant(true)).interpret(Map.of("x", true))`.

### Q4: When should you use Interpreter?

**A.** When:
- The grammar is **small and stable** — a few rules, rarely changes.
- You want to **embed a tiny DSL** in your application — filters, formulas, rules.
- Adding new grammar rules (new node types) is more common than adding new operations.
- Performance is not critical — interpretation is naturally slow.

### Q5: When should you NOT use Interpreter?

**A.** When:
- The grammar is **complex** (full programming language) — use a parser generator + bytecode VM.
- The grammar **changes often along the operation axis** (need many ops over the AST) — Visitor is a better fit.
- Performance matters — tree-walking is 10–100× slower than compiled or JIT code.
- Adding nodes causes **class explosion** — dozens of small classes hurt readability.

### Q6: Where is Interpreter used in the wild?

**A.**
- Regex engines (each regex node = a tiny interpreter).
- SQL `WHERE` evaluators in embedded DBs (SQLite uses bytecode VM, but smaller engines tree-walk).
- log4j / logback pattern formatters (`%d{HH:mm:ss} %-5level %msg`).
- jq filters.
- GitHub / Gmail search syntax (`is:open author:me`).
- Spreadsheet formulas in tiny libs.
- Rule engines (Drools-light, Easy Rules).

### Q7: How does the Client build the AST?

**A.** Two ways:
1. **Manually** — code constructs the tree directly: `new And(new Variable("a"), new Or(...))`. Fine for tests and small embedded rules.
2. **Via a parser** — a recursive descent or generated parser turns a source string into the AST. The parser is *separate* from the Interpreter; Interpreter only handles evaluation.

The pattern itself says nothing about parsing.

### Q8: What is the Context for?

**A.** Anything the AST needs that is **not part of the tree itself**:
- Variable bindings (`Map<String, ?>`).
- Output streams, loggers.
- Memoization caches.
- Limits (max recursion depth, timeout).
- Random seeds, locale, time provider.

Passed top-down through `interpret(context)`. Keeps nodes pure data; makes the interpreter testable.

### Q9: Why does each grammar rule become its own class?

**A.** That's the central trick: **OOP polymorphism replaces the giant `switch (node.type)`**. Each class knows its own rule. Adding a new rule = add a new class; no central switch to edit. The cost is class explosion: a 30-rule grammar = 30 classes.

### Q10: What's the simplest "interpret a sentence" example you can give?

**A.** Roman numerals via Interpreter:

```java
interface Roman { int interpret(StringBuilder ctx); }

class Thousand implements Roman {
    public int interpret(StringBuilder ctx) {
        int n = 0;
        while (ctx.length() > 0 && ctx.charAt(0) == 'M') { n += 1000; ctx.deleteCharAt(0); }
        return n;
    }
}
// Hundreds, Tens, Units classes follow the same pattern.
```

Each class interprets its own range; the Context is the remaining input.

---

## Middle Questions

### Q11: How is Interpreter related to Composite?

**A.** Interpreter **is** Composite. The AST is a Composite tree: TerminalExpression = Leaf, NonterminalExpression = Composite. The added piece is the uniform `interpret(context)` method that gives every node a *behavior*, not just structure. So: Composite = "tree of objects"; Interpreter = "tree of objects that evaluates itself".

### Q12: Distinguish parsing from evaluation.

**A.**
- **Parsing**: text → AST. Lexer tokenizes; parser builds the tree. Output is data.
- **Evaluation**: AST → result. Interpreter walks the tree calling `interpret`. Output is a value (or side effect).

The Interpreter pattern *only* covers step 2. You can hand-build the AST and skip parsing entirely. Conflating the two is a common mistake — keep them in separate modules.

### Q13: How do you build the Context properly?

**A.** Pass it **as a parameter**, not as a field. Three reasons:
1. Same AST can be evaluated against multiple contexts (test, prod, what-if).
2. Thread-safe — no shared mutable state on nodes.
3. Recursive calls naturally propagate context (with overrides for `let` bindings).

```java
interface Expression {
    Object interpret(Context ctx);
}

class Let implements Expression {
    String name; Expression value, body;
    public Object interpret(Context ctx) {
        Context child = ctx.extend(name, value.interpret(ctx));
        return body.interpret(child);
    }
}
```

`Context.extend` returns a new Context; outer scope unchanged.

### Q14: What recursion patterns appear in Interpreter?

**A.** Three common shapes:
1. **Recurse-then-combine** (most common): `left.interpret(ctx) op right.interpret(ctx)`. Used for arithmetic, boolean ops.
2. **Short-circuit**: `if (cond.interpret(ctx)) return then.interpret(ctx); else return else_.interpret(ctx);`. Avoids evaluating dead branches.
3. **Iterate over children**: `for (Expression e : children) e.interpret(ctx);`. Used for sequences, blocks.

Recursion depth equals AST depth; deeply nested expressions can overflow the JVM stack at ~5–10K levels.

### Q15: What's a side-effecting interpreter?

**A.** One whose `interpret` does more than return a value — also writes to output, mutates context, or performs IO:

```java
class Print implements Expression {
    Expression arg;
    public Object interpret(Context ctx) {
        Object v = arg.interpret(ctx);
        ctx.out().println(v);
        return null;
    }
}
```

Pros: lets DSL drive real behavior. Cons: harder to test, harder to optimize, bound to the runtime.

### Q16: What is multi-pass interpretation?

**A.** Run several walks over the AST before/instead of evaluation:
1. **Resolve** — bind variable references to declarations.
2. **Type-check** — annotate nodes with types; fail fast.
3. **Optimize** — constant fold, dead-code-eliminate.
4. **Evaluate** — finally interpret.

Each pass is a tree walk; some libraries use Visitor for passes 1–3 and Interpreter for pass 4. Pure Interpreter pattern can do passes too if every node implements `analyze(ctx)` etc., but at that point Visitor is cleaner.

### Q17: How would you refactor a giant `eval(node)` switch into Interpreter?

**A.** Steps:
1. Define `Expression` interface with `interpret(ctx)`.
2. For each `case` in the switch, create a class implementing `interpret`.
3. Replace `new Node(NodeType.AND, l, r)` with `new And(l, r)`.
4. Delete the switch and the `NodeType` enum.

The switch's branches become class bodies; the switch itself becomes virtual dispatch.

### Q18: How do you handle errors during interpretation?

**A.** Throw a checked or unchecked **InterpretException** carrying:
- The offending node.
- The context snapshot.
- A user-readable message ("undefined variable: x").

```java
class Variable implements Expression {
    public Object interpret(Context ctx) {
        if (!ctx.has(name)) throw new InterpretException(this, ctx, "undefined: " + name);
        return ctx.get(name);
    }
}
```

For DSLs exposed to users, attach source location to nodes during parsing so errors can point at the original text.

### Q19: How do you test an Interpreter?

**A.**
1. **Unit tests per node** — build a tiny tree, call `interpret`, assert.
2. **Round-trip tests** — parse → interpret → check value (covers parser too).
3. **Property tests** — for arithmetic interpreters, generate random expressions; compare to a reference (Java's own evaluator).
4. **Snapshot tests** — for complex outputs (formatted strings).
5. **Differential** — run two interpreter implementations on the same AST; outputs must match.

### Q20: What's the difference between Interpreter and a finite state machine evaluator?

**A.** Interpreter walks a **tree**; FSM walks a **graph of states with transitions**. Interpreter is for grammars (nested structure); FSM is for protocols (sequential states). They overlap when interpreting regex: tree of operators (Interpreter) compiled to NFA (FSM) for execution.

---

## Senior Questions

### Q21: Compare Interpreter and Visitor — when to use which?

**A.**
- **Interpreter**: logic lives **inside** the AST nodes. Each node knows how to interpret itself. Easy to add new node types; hard to add new operations (must edit every class).
- **Visitor**: logic lives **outside**, in visitor classes. Each visitor handles all node types. Easy to add new operations; hard to add new node types (must update every visitor).

Rule of thumb: if you have **one operation** (eval) and a **growing grammar**, use Interpreter. If you have **many operations** (eval, type-check, format, optimize) and a **stable grammar**, use Visitor.

### Q22: Explain the Expression Problem.

**A.** A two-axis extension challenge:
- Axis 1: add new **types** (AST node kinds).
- Axis 2: add new **operations** over them.

In a single-dispatch OOP language:
- Methods-on-classes (Interpreter) → adding types is easy (new class), adding operations is hard (edit every class).
- Visitor → adding operations is easy (new visitor), adding types is hard (edit every visitor).

Multimethods (Clojure, CLOS, Julia), type classes (Haskell), and traits (Rust) close the gap. For small DSLs, Interpreter is fine because the grammar is fixed.

### Q23: Why is class explosion the cost of Interpreter?

**A.** Each grammar rule = a class. A real expression grammar has 30–80 rules: literals, identifiers, `+`, `-`, `*`, `/`, `%`, `==`, `!=`, `<`, `>`, `&&`, `||`, `!`, `[]`, `.`, function call, lambda, if, let, while, for, return, etc. That's 30–80 small classes — readable individually, overwhelming in aggregate. Modern code uses sealed types + switch to compress this:

```java
sealed interface Expr permits Num, Var, Bin, Unary, Call, If, Let {}
record Bin(Expr l, Op op, Expr r) implements Expr {}
```

Then evaluation lives in one place — but you've abandoned the Interpreter pattern for tagged unions.

### Q24: How does a regex engine relate to Interpreter?

**A.** A simple backtracking regex engine **is** Interpreter:

```java
interface RE { Match match(String s, int i); }

class Lit implements RE {
    char c;
    public Match match(String s, int i) {
        return i < s.length() && s.charAt(i) == c ? Match.at(i + 1) : Match.fail();
    }
}

class Seq implements RE { /* match a then b */ }
class Alt implements RE { /* match a or b */ }
class Star implements RE { /* match a* greedily */ }
```

Production engines (PCRE, RE2) compile regex to NFA/DFA bytecode for speed — that's the bytecode-VM tier above Interpreter.

### Q25: What's a bytecode interpreter?

**A.** Instead of walking an AST, compile it once to a **flat array of opcodes** (bytecode), then run a tight `for` loop dispatching on opcode:

```java
while (pc < code.length) {
    switch (code[pc]) {
        case OP_PUSH: stack.push(constants[code[++pc]]); break;
        case OP_ADD:  stack.push(stack.pop() + stack.pop()); break;
        // ...
    }
    pc++;
}
```

Pros: cache-friendly, no tree pointer-chasing, dispatch is one switch (table-jump on warm JIT). 5–20× faster than tree-walking. Used by JVM, CPython, Lua, V8 baseline, Ruby YARV.

### Q26: What is Truffle?

**A.** Oracle's framework for building **self-optimizing AST interpreters**. You write a tree-walking Interpreter; Truffle's partial evaluator (Graal) **specializes** it at runtime — collapsing virtual calls into direct calls, inlining nodes, and ultimately producing JIT-compiled machine code from the AST. Used for Graal-Python, TruffleRuby, FastR, GraalJS. Gives you a near-JIT-quality interpreter from an Interpreter-pattern codebase.

### Q27: What AST optimizations apply before interpretation?

**A.**
1. **Constant folding**: `2 + 3` → `5` at parse time.
2. **Algebraic identities**: `x * 1` → `x`, `x + 0` → `x`.
3. **Common subexpression elimination**: hoist repeated subtrees.
4. **Dead-code elimination**: drop branches of `if (false) ...`.
5. **Inlining**: replace function-call nodes with the body.
6. **Specialization**: rewrite `Variable("PI")` → `Constant(3.14)` if known.
7. **Hash-consing**: dedupe structurally equal subtrees (memory).

Each is a separate pass over the AST.

### Q28: How do you support recursion / function calls in an Interpreter?

**A.** Two pieces:
1. **Function definition node** captures parameter names + body + lexical context (a closure):
   ```java
   class Lambda implements Expression {
       List<String> params; Expression body;
       public Object interpret(Context ctx) {
           return new Closure(params, body, ctx);
       }
   }
   ```
2. **Function call node** evaluates the callee, evaluates args, extends the closure's context with bindings, interprets the body:
   ```java
   class Call implements Expression {
       public Object interpret(Context ctx) {
           Closure fn = (Closure) callee.interpret(ctx);
           Context child = fn.env;
           for (int i = 0; i < params.size(); i++)
               child = child.extend(fn.params.get(i), args.get(i).interpret(ctx));
           return fn.body.interpret(child);
       }
   }
   ```

Recursion is automatic — call a closure that references itself.

### Q29: How do you handle scoping (lexical vs dynamic)?

**A.**
- **Lexical**: Closure captures the context **at definition time**. Calls extend that captured context. Standard in Java, JS, Python, Scheme.
- **Dynamic**: Function looks up free variables in the **caller's** context. Used in old Lisp, Bash, Perl.

In a tree-walker, lexical = `Closure(env=ctx)` saved on definition; dynamic = look up in the live call-time context. Most DSLs want lexical scope.

### Q30: How do tail calls fit in?

**A.** A tail call is `return f(x);` — the last thing the function does. In a naive Interpreter, each call grows the JVM stack. **Tail-call optimization** rewrites it: instead of recursing, loop:

```java
while (expr instanceof Call c) {
    Closure fn = c.callee.interpret(ctx);
    ctx = fn.env.extendAll(c.args, ctx);
    expr = fn.body;
}
return expr.interpret(ctx);
```

Schemes and Clojure (`recur`) do this. Tree-walkers in Java can't always TCO across virtual calls without explicit trampolining.

---

## Professional Questions

### Q31: What does the JIT do with `interpret(ctx)` calls?

**A.** Each `interpret` is a virtual call. JIT inline cache states:
- **Monomorphic (1 type at site)**: inline directly, near-zero cost.
- **Bimorphic (2 types)**: 2-way `instanceof` test then inline, ~1ns extra.
- **Polymorphic (3–7 types)**: small inline cache (PIC), few-way test.
- **Megamorphic (8+ types)**: vtable lookup, ~3–5ns per call.

Real ASTs have ~10–30 node types → most `interpret` call sites are megamorphic → JIT gives up inlining. This is the main reason tree-walkers are slow.

### Q32: What are the performance pitfalls of tree-walking interpreters?

**A.**
1. **Megamorphic dispatch** — see Q31.
2. **Pointer-chasing** — AST nodes scattered across heap; no spatial locality; cache misses dominate.
3. **Boxing** — generic `Object interpret(ctx)` boxes every int and double; allocator pressure + GC.
4. **Stack depth** — deep ASTs can blow the JVM stack (~5–10K Java frames).
5. **Repeated context lookups** — `ctx.get("x")` is a hash map probe per use.
6. **No constant folding at runtime** — recomputes `2+3` every interpretation.

Bytecode VMs and Truffle solve most of these.

### Q33: Compare tree-walker vs bytecode VM.

**A.**

| Dimension       | Tree-walker (Interpreter pattern) | Bytecode VM             |
|-----------------|-----------------------------------|-------------------------|
| Build cost      | Low (just AST)                    | Higher (compile pass)   |
| Run cost        | Slow (megamorphic + cache misses) | Fast (table-switch)     |
| Memory layout   | Scattered nodes                   | Contiguous opcode array |
| Debuggability   | Easy (AST is the source)          | Harder (PC, stack)      |
| Suits           | Small DSLs, prototypes            | Real languages, Lua/Lisp/CPython |

Most production runtimes start as tree-walkers and migrate to bytecode once usage grows.

### Q34: What is partial evaluation (Truffle / Futamura)?

**A.** Given an interpreter `interp(prog, input)` and a fixed `prog`, partial evaluation produces a specialized function `interp_prog(input)` — effectively a compiler for free. Truffle uses Graal as a partial evaluator: feed it an AST + an Interpreter; out comes JIT-compiled native code that runs the program at near-static-compiler speed. The First Futamura Projection.

### Q35: What is threaded code?

**A.** A bytecode dispatch trick: each opcode handler ends with the dispatch to the next opcode (rather than returning to a central loop):

```c
op_add: ... ; goto *handlers[*pc++];
op_mul: ... ; goto *handlers[*pc++];
```

Eliminates one indirect branch per instruction. Used in Forth, GCC computed-goto interpreters, CPython 3.11+ (PEP 659 specialized). 10–20% faster than switch-based dispatch.

### Q36: How does AST memory layout affect performance?

**A.** Two extremes:
- **Pointer-heavy** (typical Java Interpreter): each node is a heap object with field pointers to children. Cache-unfriendly.
- **Flat array of records** (struct-of-arrays or arena): all nodes in one contiguous buffer; children referenced by index. Walks hit prefetched lines. Used by V8's Ignition, Roslyn's Green Tree, ANTLR's parse trees.

For 1M-node trees, layout difference can be 5–10× in walking speed.

### Q37: How would you sandbox an untrusted DSL interpreter?

**A.**
1. **Limit grammar** — no IO, no FFI, no `eval`.
2. **Limit resources** — max recursion depth, max iterations, max memory (e.g., bounded context size).
3. **Timeout** — wall-clock or instruction count; abort if exceeded.
4. **Run in restricted thread** — no class loading, no reflection, security manager (legacy) or external isolation.
5. **Validate before eval** — type-check, reject suspicious patterns.
6. **Process isolation** — for hostile input (user-uploaded rules), run in a separate OS process with seccomp / Wasm / firecracker.

Tree-walkers are easier to sandbox than bytecode VMs because every step is a method call you control.

### Q38: How does V8's interpreter relate to Interpreter pattern?

**A.** V8's **Ignition** is a *bytecode* interpreter (not Interpreter pattern). It compiles JS source to bytecode, then dispatches in a tight loop. Above Ignition: TurboFan (optimizing JIT) and Maglev/Sparkplug (mid-tier). Pure Interpreter pattern would be too slow for browser JS — V8 abandoned it in 2016.

### Q39: What is an "evaluator stack" and when do you need it?

**A.** Many bytecode interpreters keep an explicit operand stack: `OP_PUSH 5`, `OP_PUSH 3`, `OP_ADD` pops two and pushes 8. Tree-walking Interpreters don't need it — recursion uses the JVM stack instead. The trade-off: bytecode is dense and easy to dispatch; tree is structured but pays per-node dispatch cost.

### Q40: How would you profile a tree-walking interpreter?

**A.**
1. **Async-profiler / JFR** — sampled CPU; expect `interpret` and `Map.get` to dominate.
2. **Per-node-type timing** — wrap visit in `System.nanoTime()`; aggregate by class.
3. **Allocation profiling** — boxing of primitives is the usual culprit.
4. **JIT decompile** — `-XX:+PrintCompilation`, `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` to see what got inlined.
5. **Micro-benchmark** with JMH on representative ASTs.

The fix is rarely "optimize a node" — it's "rewrite as bytecode" or "specialize hot nodes".

---

## Coding Tasks

### Task 1: Implement a Boolean expression interpreter.

```java
import java.util.Map;

interface BoolExpr {
    boolean interpret(Map<String, Boolean> ctx);
}

class Const implements BoolExpr {
    private final boolean v;
    public Const(boolean v) { this.v = v; }
    public boolean interpret(Map<String, Boolean> ctx) { return v; }
}

class Var implements BoolExpr {
    private final String name;
    public Var(String name) { this.name = name; }
    public boolean interpret(Map<String, Boolean> ctx) {
        Boolean b = ctx.get(name);
        if (b == null) throw new IllegalStateException("undefined: " + name);
        return b;
    }
}

class Not implements BoolExpr {
    private final BoolExpr e;
    public Not(BoolExpr e) { this.e = e; }
    public boolean interpret(Map<String, Boolean> ctx) { return !e.interpret(ctx); }
}

class And implements BoolExpr {
    private final BoolExpr l, r;
    public And(BoolExpr l, BoolExpr r) { this.l = l; this.r = r; }
    public boolean interpret(Map<String, Boolean> ctx) {
        return l.interpret(ctx) && r.interpret(ctx);
    }
}

class Or implements BoolExpr {
    private final BoolExpr l, r;
    public Or(BoolExpr l, BoolExpr r) { this.l = l; this.r = r; }
    public boolean interpret(Map<String, Boolean> ctx) {
        return l.interpret(ctx) || r.interpret(ctx);
    }
}

// Usage
BoolExpr e = new And(new Var("a"), new Or(new Var("b"), new Not(new Var("c"))));
boolean r = e.interpret(Map.of("a", true, "b", false, "c", false));  // true
```

### Task 2: Add `Xor` without modifying any existing class.

**Solution.** That's the strength of Interpreter: just add a new class.

```java
class Xor implements BoolExpr {
    private final BoolExpr l, r;
    public Xor(BoolExpr l, BoolExpr r) { this.l = l; this.r = r; }
    public boolean interpret(Map<String, Boolean> ctx) {
        return l.interpret(ctx) ^ r.interpret(ctx);
    }
}
```

`Const`, `Var`, `Not`, `And`, `Or` untouched. **This is the open/closed principle in action.**

### Task 3: Implement a recursive-descent parser that produces the Boolean AST.

```java
class Parser {
    private final String s;
    private int i = 0;
    public Parser(String s) { this.s = s; }

    public BoolExpr parse() { BoolExpr e = orExpr(); skip(); if (i < s.length()) throw new RuntimeException("trailing input"); return e; }

    private BoolExpr orExpr() {
        BoolExpr left = andExpr();
        while (match("||")) left = new Or(left, andExpr());
        return left;
    }

    private BoolExpr andExpr() {
        BoolExpr left = notExpr();
        while (match("&&")) left = new And(left, notExpr());
        return left;
    }

    private BoolExpr notExpr() {
        if (match("!")) return new Not(notExpr());
        return atom();
    }

    private BoolExpr atom() {
        skip();
        if (match("(")) { BoolExpr e = orExpr(); expect(")"); return e; }
        if (match("true"))  return new Const(true);
        if (match("false")) return new Const(false);
        StringBuilder sb = new StringBuilder();
        while (i < s.length() && Character.isLetterOrDigit(s.charAt(i))) sb.append(s.charAt(i++));
        if (sb.length() == 0) throw new RuntimeException("expected atom at " + i);
        return new Var(sb.toString());
    }

    private boolean match(String t) { skip(); if (s.startsWith(t, i)) { i += t.length(); return true; } return false; }
    private void expect(String t)   { if (!match(t)) throw new RuntimeException("expected " + t); }
    private void skip()             { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
}

// Usage
BoolExpr ast = new Parser("a && (b || !c)").parse();
ast.interpret(Map.of("a", true, "b", false, "c", false)); // true
```

Parser is **separate** from Interpreter — that's by design.

### Task 4: Add memoization to the interpreter.

**Solution.** Wrap `interpret` with a cache keyed by `(node, frozen-context)`:

```java
class Memo {
    private final Map<Key, Boolean> cache = new HashMap<>();
    record Key(BoolExpr node, Map<String, Boolean> ctx) {}

    public boolean eval(BoolExpr e, Map<String, Boolean> ctx) {
        Key k = new Key(e, Map.copyOf(ctx));
        Boolean cached = cache.get(k);
        if (cached != null) return cached;
        boolean r = e.interpret(ctx);
        cache.put(k, r);
        return r;
    }
}
```

Useful only if the same subtree is evaluated many times with the same context (e.g., shared `Variable("expensive")` nodes after CSE).

### Task 5: Convert this big switch into Interpreter.

```java
double eval(Node n, Map<String, Double> ctx) {
    switch (n.type) {
        case NUM: return n.num;
        case VAR: return ctx.get(n.name);
        case ADD: return eval(n.left, ctx) + eval(n.right, ctx);
        case MUL: return eval(n.left, ctx) * eval(n.right, ctx);
        default:  throw new IllegalStateException();
    }
}
```

**Solution.**

```java
interface Expr { double interpret(Map<String, Double> ctx); }

class Num implements Expr {
    double v;
    public Num(double v) { this.v = v; }
    public double interpret(Map<String, Double> ctx) { return v; }
}

class Var implements Expr {
    String name;
    public Var(String name) { this.name = name; }
    public double interpret(Map<String, Double> ctx) { return ctx.get(name); }
}

class Add implements Expr {
    Expr l, r;
    public Add(Expr l, Expr r) { this.l = l; this.r = r; }
    public double interpret(Map<String, Double> ctx) { return l.interpret(ctx) + r.interpret(ctx); }
}

class Mul implements Expr {
    Expr l, r;
    public Mul(Expr l, Expr r) { this.l = l; this.r = r; }
    public double interpret(Map<String, Double> ctx) { return l.interpret(ctx) * r.interpret(ctx); }
}
```

Each `case` became a class. The `eval` switch disappears — replaced by virtual dispatch on `interpret`.

### Task 6: Same Boolean interpreter in Python.

```python
from dataclasses import dataclass
from typing import Protocol

class BoolExpr(Protocol):
    def interpret(self, ctx: dict[str, bool]) -> bool: ...

@dataclass
class Const:
    v: bool
    def interpret(self, ctx): return self.v

@dataclass
class Var:
    name: str
    def interpret(self, ctx): return ctx[self.name]

@dataclass
class And:
    l: BoolExpr; r: BoolExpr
    def interpret(self, ctx): return self.l.interpret(ctx) and self.r.interpret(ctx)

@dataclass
class Or:
    l: BoolExpr; r: BoolExpr
    def interpret(self, ctx): return self.l.interpret(ctx) or self.r.interpret(ctx)

@dataclass
class Not:
    e: BoolExpr
    def interpret(self, ctx): return not self.e.interpret(ctx)

# Usage
expr = And(Var("a"), Or(Var("b"), Not(Var("c"))))
print(expr.interpret({"a": True, "b": False, "c": False}))  # True
```

### Task 7: Same Boolean interpreter in TypeScript.

```typescript
type Ctx = Record<string, boolean>;

interface BoolExpr { interpret(ctx: Ctx): boolean; }

class Const implements BoolExpr {
    constructor(private v: boolean) {}
    interpret(_: Ctx) { return this.v; }
}

class Var implements BoolExpr {
    constructor(private name: string) {}
    interpret(ctx: Ctx) {
        if (!(this.name in ctx)) throw new Error(`undefined: ${this.name}`);
        return ctx[this.name];
    }
}

class And implements BoolExpr {
    constructor(private l: BoolExpr, private r: BoolExpr) {}
    interpret(ctx: Ctx) { return this.l.interpret(ctx) && this.r.interpret(ctx); }
}

class Or implements BoolExpr {
    constructor(private l: BoolExpr, private r: BoolExpr) {}
    interpret(ctx: Ctx) { return this.l.interpret(ctx) || this.r.interpret(ctx); }
}

class Not implements BoolExpr {
    constructor(private e: BoolExpr) {}
    interpret(ctx: Ctx) { return !this.e.interpret(ctx); }
}

const e = new And(new Var("a"), new Or(new Var("b"), new Not(new Var("c"))));
console.log(e.interpret({ a: true, b: false, c: false })); // true
```

### Task 8: Add a `Variables` helper that lists all variables used in an expression.

**Solution.** Walk the AST; for that you can either add a method to every class (Interpreter style — propagates the cost) or use a separate Visitor. Quick Interpreter-style:

```java
interface BoolExpr {
    boolean interpret(Map<String, Boolean> ctx);
    default Set<String> vars() { return Set.of(); }
}

class Var implements BoolExpr {
    String name;
    public boolean interpret(Map<String, Boolean> ctx) { return ctx.get(name); }
    public Set<String> vars() { return Set.of(name); }
}

class And implements BoolExpr {
    BoolExpr l, r;
    public boolean interpret(Map<String, Boolean> ctx) { return l.interpret(ctx) && r.interpret(ctx); }
    public Set<String> vars() { Set<String> s = new HashSet<>(l.vars()); s.addAll(r.vars()); return s; }
}
// ... Or, Not, Const similarly
```

Adding the second operation `vars()` already touched every class — **proof of the operation-axis cost.** A Visitor would have stayed external.

---

## System Design Questions

### Q41: Design a rule engine for filtering events.

**A.** Goal: let users define rules like `severity == "high" && tags contains "prod"`; engine matches incoming events.

Architecture:
1. **Grammar**: `rule := expr ; expr := comparison ((AND|OR) comparison)* ; comparison := field op value`.
2. **Parser** (recursive descent or ANTLR) → AST of `Rule` nodes (`And`, `Or`, `Eq`, `Contains`, `FieldRef`, `Literal`).
3. **Interpreter**: each node implements `boolean matches(Event e)`.
4. **Optimization**: parse once; cache the AST; index rules by required fields for fast filtering of irrelevant ones.
5. **Hot path**: `for (Rule r : compiledRules) if (r.matches(event)) emit(r, event);`.

Switch from Interpreter → bytecode when QPS exceeds ~10K rules/event/sec.

### Q42: Design a search query language for an internal tool.

**A.** Goal: GitHub-style search — `is:open author:me label:bug created:>2024-01-01`.

Components:
1. **Lexer** — split into tokens: identifiers, operators, quoted strings.
2. **Parser** — produce AST: `Query`, `Term(field, op, value)`, `And`, `Or`, `Not`.
3. **Interpreter** — over an `Index` context; each `Term` queries the index; `And`/`Or` combine result sets.
4. **Translator** (alternative) — instead of interpreting, translate AST to backend query (SQL, Elasticsearch DSL). The Interpreter still validates and routes.

For small in-memory data: pure Interpreter. For large indexed data: translate to backend-native query.

### Q43: Design a spreadsheet formula engine.

**A.** Goal: support `=A1 + SUM(B1:B10) * 2`.

Components:
1. **Parser** → AST with `CellRef`, `Range`, `BinaryOp`, `FunctionCall`, `Literal`.
2. **Interpreter** — each node has `interpret(SheetContext ctx)`. `CellRef.interpret` looks up the value (recursing into other formulas). `FunctionCall.interpret` evaluates args and dispatches to `Functions.get(name)`.
3. **Dependency tracking** — each formula records which cells it reads; on cell change, re-interpret only dependents.
4. **Cycle detection** — the context tracks the evaluation stack; raises `#CIRC!` if a cell appears twice.
5. **Memoization** — cache per-cell results until the sheet mutates.

Excel migrated parts of this to a JIT (calc engine) for speed; Google Sheets stays interpreter-based.

### Q44: When do you switch from Interpreter to a real parser+VM?

**A.** Signals:
- **Grammar grew past ~30 rules** → class explosion is unmanageable; reach for a parser generator (ANTLR, lark) and tagged unions.
- **Performance is bottleneck** → tree-walker is 10–100× too slow → compile to bytecode.
- **Need debugging tools** → users want stack traces, breakpoints → a VM with explicit PC and frames is much easier.
- **Sandboxing requirements** → instruction counting and quotas are easier on a VM than tree-walker.
- **Multiple frontends** → if you also need to compile or transpile, an IR is essential; the IR replaces the AST as the canonical form.

Order: Interpreter → (still slow) → Bytecode VM → (still slow) → JIT → (still slow) → AOT compiler.

### Q45: Design a config DSL for an infrastructure tool.

**A.** Goal: users write `instances = max(2, min(20, load / 50))`; engine evaluates per minute.

Components:
1. **AST**: `Number`, `Variable`, `BinaryOp`, `FunctionCall`. ~10 node types.
2. **Interpreter pattern** is a perfect fit — small grammar, single operation (eval), grammar is stable.
3. **Context**: provides built-in functions (`max`, `min`, `avg`) and live metric values (`load`, `cpu`).
4. **Safety**: timeout, max recursion depth, no IO operators in grammar.
5. **Hot reload**: re-parse on file change; swap AST atomically.

Don't reach for a bytecode VM — eval runs once a minute, not in a tight loop. Interpreter wins.

---

## Anti-pattern / "What's wrong" Questions

### Q46: What's wrong with this Context?

```java
class And implements BoolExpr {
    static Map<String, Boolean> CONTEXT = new HashMap<>();
    public boolean interpret() { return l.interpret() && r.interpret(); }
}
```

**A.** Context is a **static field** — shared across threads, shared across evaluations. Race conditions, leaking state between requests, no isolation. **Pass Context as a parameter** to `interpret(ctx)`. Only then can the same AST be evaluated against different contexts safely and concurrently.

### Q47: What's wrong here?

```java
class Or implements BoolExpr {
    BoolExpr l, r;
    public boolean interpret(Map<String, Boolean> ctx) {
        // "Eager evaluation for symmetry"
        boolean a = l.interpret(ctx);
        boolean b = r.interpret(ctx);
        return a || b;
    }
}
```

**A.** Eagerly evaluates the right side even when the left is `true`. For pure boolean ops it's only slow; for **side-effecting** subexpressions or expensive computations, it's a correctness/perf bug. Use `return l.interpret(ctx) || r.interpret(ctx);` to short-circuit. Same for `And`.

### Q48: What's wrong with this parser-in-interpreter?

```java
class Add implements Expr {
    String text;
    public double interpret(Map<String, Double> ctx) {
        String[] parts = text.split("\\+");                  // re-parse every call
        return Double.parseDouble(parts[0]) + Double.parseDouble(parts[1]);
    }
}
```

**A.** Two violations:
1. **Mixes parsing with evaluation.** The Interpreter pattern is for evaluation. Parsing belongs in a separate parser pass that produces structured nodes. Re-parsing every call is the worst of both worlds.
2. **Loses precision and structure.** Can't handle nesting, variables, operator precedence — it's a string hack.

Fix: parse once; build proper AST nodes (`Add(l, r)` where `l` and `r` are themselves expressions); interpret pure structure.

### Q49: Why is this a bad use of Interpreter?

```java
// "Implementing SQL with the Interpreter pattern"
class Select implements Statement { ... }
class Join   implements Statement { ... }
class Where  implements Statement { ... }
class GroupBy ... 
class Having ...
class Subquery ...
// 80 more classes
```

**A.** SQL's grammar is huge; using one class per rule yields **hundreds of small classes**. You also need many operations: parse, optimize, plan, explain, execute — Visitor (or sealed unions) handles those better. Real DBs use a **logical plan IR** (algebra of operators) + **physical plan** + **bytecode VM** (SQLite VDBE) or **vectorized executor** (DuckDB). Interpreter pattern simply doesn't scale to a real query language.

### Q50: What's the issue?

```java
class Variable implements BoolExpr {
    String name;
    boolean cached;            // remembered across calls
    boolean hasCache;
    public boolean interpret(Map<String, Boolean> ctx) {
        if (hasCache) return cached;
        cached = ctx.get(name);
        hasCache = true;
        return cached;
    }
}
```

**A.** Caches the value **on the node itself**. The same AST evaluated against a *different* context returns the stale cached value. AST nodes should be **immutable, context-free data**. Memoization, if needed, must live in the Context (per-evaluation) — never on the node.

---

## Cross-pattern Questions

### Q51: Interpreter vs Visitor — pick one.

**A.** Interpreter puts logic **inside** nodes (each node knows how to evaluate itself); Visitor puts it **outside** (each visitor knows how to handle every node). Use Interpreter when you have **few operations** (typically just `interpret`) and want to add new node types easily. Use Visitor when you have **many operations** over a stable hierarchy. Many codebases start with Interpreter and add Visitor when a second operation appears.

### Q52: Interpreter vs Strategy?

**A.** Strategy swaps **one** algorithm at runtime (`SortStrategy`, `PaymentStrategy`). Interpreter evaluates a **structured expression tree**. Rule engines often look like Strategy at the API level (`rule.matches(event)`) but are Interpreter inside (the rule is an AST). Strategy = one decision; Interpreter = a small program.

### Q53: Interpreter vs Command?

**A.** Command encapsulates **a single operation** (with optional undo). A queue of Commands is a flat sequence: `cmds.forEach(Command::execute)`. Interpreter encapsulates **a whole tiny language** with composition: `if`, `and`, `or`, function calls. Stretching: Command can be seen as a degenerate Interpreter with one node type and no composition.

### Q54: Interpreter vs Composite?

**A.** Composite is the **structural** part — a tree of objects, leaves and composites, with a uniform interface. Interpreter **is Composite** plus a `interpret(context)` method that gives the tree behavior. So: Composite handles the shape; Interpreter handles the meaning.

### Q55: Interpreter vs Builder?

**A.** Builder constructs a complex object step by step. A **parser** is a kind of Builder for ASTs — it builds the tree the Interpreter will walk. They sit at adjacent stages: Builder/parser → AST → Interpreter. Builder is about **construction**; Interpreter is about **evaluation**.

### Q56: Can Interpreter and Iterator combine?

**A.** Yes. A node's `interpret` can return a *lazy* sequence (Java `Stream`, Python generator) — the consumer iterates. Useful for `Generator` nodes in DSLs that emit a stream of values. The Iterator pattern handles the consumption shape; Interpreter the production logic.

### Q57: Interpreter + Memento?

**A.** A side-effecting Interpreter can capture a Memento before each mutation step → undo support. The Memento snapshots Context state; Interpreter executes; rollback restores. Pattern combo for mini-VM debuggers.

### Q58: Interpreter vs Pattern matching?

**A.** Pattern matching (Rust `match`, Scala `match`, Kotlin `when`, Java 21 sealed + switch) gives you the same dispatch as Interpreter without the class explosion. Each grammar rule becomes a sealed-type variant; the eval switch handles all cases in one place. **For modern languages, pattern matching is the preferred encoding** — you only need full Interpreter classes when you want third parties to add rules without recompiling.

---

## Quick Drills (1-line answers)

- **What's a TerminalExpression?** A leaf in the AST: literal, variable, constant — `interpret` returns a value with no recursion.
- **What's a NonterminalExpression?** A composite node holding child expressions; `interpret` recurses into children and combines results.
- **What goes in Context?** Variable bindings, IO handles, limits, caches — anything global to the evaluation but not part of the tree.
- **How do you add a new rule without breaking existing?** Add a new class implementing the `Expression` interface — no existing code changes.
- **Why is Interpreter slow?** Megamorphic virtual dispatch + pointer-chasing AST + boxing of primitives + repeated context lookups.
- **Interpreter pattern's core trick?** Replace `switch (nodeType)` with polymorphic `interpret` — one class per rule.
- **Why call it Interpreter?** Because each instance of the AST classes interprets its own grammar rule against the Context.
- **Real-world example?** Regex engines, log4j formatters, jq, GitHub search syntax, mini DSLs, formula engines, rule engines.
- **What's a Context?** A parameter object passed top-down through `interpret(ctx)`, holding bindings and shared resources.
- **One-line cost?** Class explosion: 30 grammar rules → 30 classes.
- **One-line strength?** Open/closed for grammar: new rules need no edits to existing rules.
- **Modern alternative?** Sealed types + pattern-matching switch in one `eval(node, ctx)` function.
- **Composite relation?** Interpreter is Composite plus the `interpret(ctx)` method.
- **Visitor relation?** Visitor moves logic out; Interpreter keeps it in. Opposite trade-offs.
- **Why separate parser?** So the same AST can be evaluated against different contexts and the same grammar rules can come from different sources (text, GUI builder).
- **Bytecode VM upgrade?** Compile AST to opcodes; dispatch in a tight loop; 5–20× faster than tree-walking.
- **Truffle?** Self-optimizing AST interpreter framework; partial-evaluates the Interpreter into JIT code via Graal.
- **Tree-walker vs bytecode VM?** Tree-walker is simpler but 10–100× slower; VM is harder to build but production-grade.
- **Best fit grammar size?** ≤30 rules and stable. Beyond that, switch to a real parser + IR.
- **Threaded code?** Interpreter dispatch trick: each handler ends with goto-next-handler; avoids central loop branch.
- **Sandboxing?** Limit grammar (no IO/eval), enforce step/time/memory caps, isolate at process level for hostile input.
- **Why not interpret SQL with this pattern?** Grammar is too big and needs many passes (parse, plan, optimize, execute).

---

## Tips for Interviews

1. **Lead with the *why*.** "Interpreter encodes a small grammar as a class hierarchy where each node knows how to evaluate itself" — concept first, mechanism second.
2. **Always mention the Context.** Many candidates forget it. The Context is what makes the AST reusable — pass it as a parameter, not a field.
3. **Mention the trade-off.** Easy to add grammar rules (new class), hard to add new operations across all rules (touches every class). Interviewers want to see you grasp this.
4. **Distinguish parsing from evaluation.** Conflating them is a red flag. Say: "Parsing is a separate concern; the Interpreter pattern only covers evaluation."
5. **Compare with Visitor.** Be ready to articulate "logic inside vs outside the nodes" and the operation-axis cost. Bonus: cite the Expression Problem.
6. **Show real-world.** Regex engines, log4j formatters, jq, GitHub search, formula engines, rule engines — anchors the pattern in concrete tools.
7. **Mention the modern alternative.** Sealed types + pattern matching is now the idiomatic encoding in Java 21+, Kotlin, Scala, Rust. Knowing both shows breadth.
8. **Talk performance.** "Tree-walkers are 10–100× slower than bytecode VMs because of megamorphic dispatch and cache misses." Mention Truffle / partial evaluation for senior signal.
9. **Explain when *not* to use it.** Big grammars, perf-critical paths, many operations — Interpreter is the wrong tool. A good engineer knows the limits.
10. **Show small code.** A 20-line Boolean interpreter (`Const`, `Var`, `And`, `Or`, `Not`) plus a one-line "add `Xor`" demonstrates the open/closed virtue better than any abstract description.

---

[← Professional](professional.md) · [Tasks →](tasks.md)
