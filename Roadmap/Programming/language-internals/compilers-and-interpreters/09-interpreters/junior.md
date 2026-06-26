# Interpreters — Junior Level

> **Topic:** [Interpreters](README.md)
> **Focus:** What it means to *run* a language by walking its tree instead of compiling it — and how to write the smallest interpreter that actually works.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [What You Can Build](#what-you-can-build)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What is an interpreter, and how do you write one that takes source code and produces an answer — without ever generating machine code?**

A **compiler** translates your program into another language (usually machine code) ahead of time; you run that output later. An **interpreter** does something more direct: it reads your program and *carries out what it says*, right now. There is no separate "executable" produced — the interpreter *is* the executable, and your program is just its input data.

The simplest kind of interpreter is a **tree-walking interpreter**. After you parse source text into an **abstract syntax tree** (AST) — a tree of nodes like "addition," "variable lookup," "if statement" — you write a function, traditionally called `eval`, that takes a node and *returns its value* by recursively evaluating its children. To evaluate `2 + 3 * 4`, you evaluate the `+` node, which evaluates its left child (`2`) and its right child (the `*` node), which evaluates *its* children (`3` and `4`), multiplies them, and so on back up the tree. The whole interpreter is a recursive walk over the tree.

This is the approach taught in the well-loved book *Crafting Interpreters* (its language is called Lox), and it is exactly how many real config languages, template engines, and embedded scripting languages work. It is the **fastest interpreter to build** and the **slowest to run** — and for a huge number of jobs, that trade is perfect.

> 🎓 **Why this matters for a junior:** Writing a tiny interpreter is the single best way to understand how *every* language works — variables, scope, function calls, recursion, errors. Once you have written `eval`, you will never again be confused about what `x = x + 1` "really does," because you will have implemented it. This is foundational knowledge that pays off in debugging, in reading other people's code, and in any future systems work.

This page covers: what an interpreter is and how it differs from a compiler, the parse → tree → `eval` pipeline, how variables are stored in an **environment**, how `if`/`while`/functions are evaluated, and a complete, runnable tiny interpreter. The next level (`middle.md`) introduces **bytecode** — compiling the tree to a flat list of instructions and running a loop over them, which is how production languages like Python, Ruby, and Lua actually work.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write functions and use recursion in at least one language (Python, JavaScript, Go, Java, or C).
- **Required:** What a tree data structure is — nodes with children — and how to walk one recursively.
- **Required:** Basic understanding of a hash map / dictionary (we use one to store variables).
- **Helpful but not required:** Having seen a parser or the words "tokenizer"/"lexer"/"AST" before. We will recap, but we will not teach parsing in depth here.
- **Helpful but not required:** A vague sense that programs are "compiled" or "run" — we will sharpen that fuzzy idea.

You do **not** need to know:

- How to write a parser from scratch (we assume you can get an AST; the focus is evaluating it).
- Anything about bytecode, virtual machines, or dispatch (that is `middle.md` onward).
- Compiler theory, type systems, or garbage collection internals.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Interpreter** | A program that executes another program directly, by reading and acting on it, rather than translating it to machine code first. |
| **Compiler** | A program that translates source code into another form (often machine code) to be run later. |
| **Source code** | The text you write — the program, as characters. |
| **Token** | The smallest meaningful piece of source: a number, a name, a `+`, a `(`. Produced by the lexer. |
| **Lexer / Tokenizer / Scanner** | The stage that turns characters into a stream of tokens. |
| **Parser** | The stage that turns tokens into a tree (the AST) reflecting the grammar. |
| **AST (Abstract Syntax Tree)** | A tree of nodes representing the structure of the program: expressions, statements, declarations. |
| **Node** | One element of the AST — e.g. a `BinaryOp` node, a `Number` node, an `If` node. |
| **`eval` / evaluate** | The function that takes an AST node and computes its value (or runs its effect). |
| **Tree-walking interpreter** | An interpreter that executes a program by recursively evaluating its AST nodes. |
| **Environment** | The store that maps variable names to their current values; sometimes called a *scope* or *frame*. |
| **Scope** | The region of a program where a name is valid; environments implement scopes. |
| **Expression** | A piece of code that produces a value: `2 + 3`, `x`, `f(10)`. |
| **Statement** | A piece of code that performs an action: `x = 5`, `if ... { ... }`, `print(x)`. |
| **REPL** | Read–Eval–Print Loop: an interactive prompt that reads one expression, evaluates it, prints the result, and repeats. |
| **Literal** | A value written directly in the source, like `42`, `"hello"`, `true`. |

---

## Core Concepts

### 1. Compile vs. Interpret — the one-sentence difference

A **compiler** is a translator: source goes in, a different program (usually machine code) comes out, and you run *that* later. An **interpreter** is a performer: source goes in, and the *result of running it* comes out immediately. The compiler does its work once, ahead of time; the interpreter does its work every time the program runs.

You can feel the difference: `gcc hello.c` produces a file you run separately. `python hello.py` reads the file and *does what it says* on the spot. (Python actually compiles to bytecode first, then interprets that — more on this in `middle.md` — but from your seat, it just "runs" the file.)

### 2. The pipeline: text → tokens → tree → evaluation

Every interpreter, no matter how simple, has roughly these stages:

```text
  source text          tokens               AST                  result
  "2 + 3 * 4"   ──►   [2] [+] [3]    ──►    (+ 2 (* 3 4))   ──►    14
                      [*] [4]
   (lexer)            (parser)              (eval / tree-walk)
```

This page assumes the lexer and parser already exist (or that you write them quickly) and focuses on the **last arrow**: turning the tree into a result. That last arrow is the interpreter proper.

### 3. The AST is a tree of "what to do"

An AST node is just a small object/struct that says *what kind* of thing it is and holds its children. For arithmetic you might have:

```text
Number(value)                  e.g. Number(3)
BinaryOp(op, left, right)      e.g. BinaryOp("+", Number(2), BinaryOp("*", Number(3), Number(4)))
```

The expression `2 + 3 * 4` becomes a tree where `+` is the root, its left child is `2`, and its right child is the `*` subtree. Precedence (`*` binds tighter than `+`) is already baked into the *shape* of the tree by the parser — the interpreter does not re-think precedence; it just walks what it is given.

### 4. `eval(node)` — the heart of everything

The interpreter is one recursive function. It looks at the node's type and decides what to do:

```text
eval(node):
    if node is a Number:      return node.value
    if node is a BinaryOp:    left  = eval(node.left)
                              right = eval(node.right)
                              return apply(node.op, left, right)
```

That recursion is the entire idea. To evaluate any node, you **first evaluate its children, then combine them**. This pattern — recurse into children, then act — is called a *post-order traversal*, and it is how arithmetic, function calls, and almost everything else gets evaluated.

### 5. Variables live in an Environment

Programs have variables, so the interpreter needs somewhere to store them. That store is the **environment**: usually just a hash map from name to value.

```text
env = { "x": 10, "y": 25 }

eval(Variable("x"), env)  ->  look up "x" in env  ->  10
eval(Assign("x", expr), env)  ->  env["x"] = eval(expr, env)
```

The environment gets passed *into* `eval` so that every node can read and write variables. When you call a function or enter a block, you often create a *new* environment that can also see the outer one — that is how **scope** works, and we go deeper on it in `middle.md` and `senior.md`.

### 6. Statements vs. expressions

- An **expression** produces a value: `2 + 2` evaluates to `4`.
- A **statement** performs an action and usually produces no useful value: `print(x)`, `x = 5`, `if (c) { ... }`.

Your interpreter typically has `eval` for expressions (returns a value) and `exec` (or the same `eval`) for statements (performs effects). Control flow — `if`, `while` — lives on the statement side: you evaluate the condition expression, then *choose which branch to execute*.

### 7. Control flow is just conditional recursion

Here is the beautiful part: you do not need any special machinery for `if` and `while`. They fall out of ordinary host-language control flow inside `eval`:

```text
eval(If(cond, then_branch, else_branch), env):
    if truthy(eval(cond, env)):
        exec(then_branch, env)
    else:
        exec(else_branch, env)

eval(While(cond, body), env):
    while truthy(eval(cond, env)):
        exec(body, env)
```

The interpreter's `while` loop *implements* the interpreted language's `while` loop. The recursion and looping of the language you write the interpreter *in* (the **host language**) provide the recursion and looping of the language you are interpreting (the **guest language**).

### 8. Why tree-walking is slow (and why you should not care yet)

Each time you evaluate `x`, you walk to a `Variable` node, check its type, do a hash-map lookup by string name, and return. Each `+` re-dispatches on node type and chases pointers to its children, which may be scattered all over memory. For a tight loop running millions of times, all this pointer-chasing and per-node type-checking is *slow* — often 10–100× slower than a bytecode interpreter, and far slower than compiled code.

But for a config file, a template, a query, a build script, or a teaching language, "slow" is still microseconds, and *nobody cares*. Build the tree-walker first. Optimize only when a profiler tells you to. The bytecode approach in `middle.md` is the next step when speed actually matters.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Compiler** | A translator who converts a whole book into another language and hands you the printed translation; you read it later, on your own. |
| **Interpreter (the program)** | A live human interpreter at a conference who listens to each sentence and speaks the meaning *immediately*. No printed copy exists. |
| **Tree-walking** | Reading a recipe and *doing* each step in order, descending into sub-steps ("make the sauce" → "chop onion," "heat oil") before continuing. |
| **AST** | An outline of a document, with headings and sub-bullets nested inside — the structure, not the prose. |
| **`eval` recursion** | Calculating a nested math expression on paper: you solve the innermost parentheses first, then work outward. |
| **Environment** | A whiteboard listing each variable's current value; you erase and rewrite as the program assigns. |
| **Scope** | A meeting room: names defined inside are visible inside; the hallway (outer scope) cannot see them, but they can see the hallway. |
| **REPL** | A conversation: you say one thing, it answers, you say the next, building on what came before. |
| **Literal** | A fact stated outright ("the number 42") rather than computed. |

---

## Mental Models

### The "Do What It Says" Model

A compiler *writes down instructions for later*. An interpreter *follows the instructions now*. When you read `print(2 + 2)`, the interpreter does not produce a file that, when run, prints 4 — it *prints 4*. Hold this distinction: the interpreter's job is action, not translation. Everything else is detail about how it organizes that action.

### The "Recursive Calculator" Model

Picture `eval` as a calculator that, given any expression node, returns its number. For a leaf (a literal), it returns the number directly. For an operator, it first *calls itself* on each operand to get those numbers, then combines them. The whole interpreter is this calculator generalized from arithmetic to variables, branches, and calls. If you can evaluate `(2 + (3 * 4))` on paper inside-out, you already understand the core algorithm.

### The "Host Lends Its Powers" Model

You are writing the guest language *in* a host language. Whatever the host can do, you can borrow. The host's recursion gives the guest recursion. The host's `while` gives the guest `while`. The host's exceptions can give the guest exceptions. The host's hash map gives the guest variables. An interpreter is, in large part, a *thin layer of glue* mapping guest constructs onto host capabilities. This is why a basic interpreter is so small.

---

## Code Examples

We will build a tiny but real tree-walking interpreter for a calculator-with-variables language. To keep the focus on **evaluation**, we hand-build the AST instead of parsing text. (Adding a parser is a great exercise — see `tasks.md`.)

The guest language supports: number literals, `+ - * /`, variables, assignment, and printing.

### Python — a complete tree-walking interpreter

```python
# --- AST node types (normally produced by a parser) ---
class Num:    # literal number
    def __init__(self, value): self.value = value

class Var:    # variable reference, e.g. x
    def __init__(self, name): self.name = name

class BinOp:  # e.g. left + right
    def __init__(self, op, left, right):
        self.op, self.left, self.right = op, left, right

class Assign: # x = expr
    def __init__(self, name, expr):
        self.name, self.expr = name, expr

class Print:  # print(expr)
    def __init__(self, expr): self.expr = expr


# --- The interpreter: one recursive eval over the tree ---
def eval_node(node, env):
    if isinstance(node, Num):
        return node.value
    if isinstance(node, Var):
        if node.name not in env:
            raise NameError(f"undefined variable '{node.name}'")
        return env[node.name]
    if isinstance(node, BinOp):
        left  = eval_node(node.left, env)   # recurse into children first
        right = eval_node(node.right, env)
        if node.op == '+': return left + right
        if node.op == '-': return left - right
        if node.op == '*': return left * right
        if node.op == '/':
            if right == 0:
                raise ZeroDivisionError("division by zero")
            return left / right
        raise ValueError(f"unknown operator '{node.op}'")
    if isinstance(node, Assign):
        value = eval_node(node.expr, env)
        env[node.name] = value          # store into the environment
        return value
    if isinstance(node, Print):
        value = eval_node(node.expr, env)
        print(value)
        return value
    raise TypeError(f"cannot evaluate node: {node}")


# --- Run a small program: x = 2 + 3 * 4; print(x) ---
program = [
    Assign("x", BinOp('+', Num(2), BinOp('*', Num(3), Num(4)))),
    Print(Var("x")),
]

env = {}
for statement in program:
    eval_node(statement, env)
# prints: 14
```

That is a real interpreter. Note: `2 + 3 * 4` produced `14`, not `20`, because the *parser* would build the `*` deeper in the tree — the evaluator just respects the shape it is given.

### JavaScript — the same idea

```javascript
function evalNode(node, env) {
  switch (node.type) {
    case "Num":
      return node.value;
    case "Var":
      if (!(node.name in env)) throw new Error(`undefined variable '${node.name}'`);
      return env[node.name];
    case "BinOp": {
      const l = evalNode(node.left, env);
      const r = evalNode(node.right, env);
      switch (node.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/":
          if (r === 0) throw new Error("division by zero");
          return l / r;
      }
      throw new Error(`unknown operator '${node.op}'`);
    }
    case "Assign": {
      const v = evalNode(node.expr, env);
      env[node.name] = v;
      return v;
    }
    case "Print": {
      const v = evalNode(node.expr, env);
      console.log(v);
      return v;
    }
  }
  throw new Error(`cannot evaluate node of type ${node.type}`);
}

// x = 2 + 3 * 4; print(x)
const program = [
  { type: "Assign", name: "x",
    expr: { type: "BinOp", op: "+",
            left: { type: "Num", value: 2 },
            right: { type: "BinOp", op: "*",
                     left: { type: "Num", value: 3 },
                     right: { type: "Num", value: 4 } } } },
  { type: "Print", expr: { type: "Var", name: "x" } },
];

const env = {};
for (const stmt of program) evalNode(stmt, env);
// logs: 14
```

### Adding control flow — `if` and `while`

Once the structure is in place, control flow is tiny. Here is the extra Python you would add:

```python
class If:
    def __init__(self, cond, then_branch, else_branch=None):
        self.cond, self.then_branch, self.else_branch = cond, then_branch, else_branch

class While:
    def __init__(self, cond, body):
        self.cond, self.body = cond, body

def truthy(v):
    return v != 0 and v is not None and v is not False

# inside eval_node, add:
#   if isinstance(node, If):
#       if truthy(eval_node(node.cond, env)):
#           for s in node.then_branch: eval_node(s, env)
#       elif node.else_branch:
#           for s in node.else_branch: eval_node(s, env)
#       return None
#   if isinstance(node, While):
#       while truthy(eval_node(node.cond, env)):
#           for s in node.body: eval_node(s, env)
#       return None
```

The guest's `while` is literally the host's `while`. That is the "host lends its powers" model in action.

### A two-line REPL

A Read-Eval-Print Loop is just `eval` in a loop, keeping the environment alive between lines:

```python
def repl():
    env = {}
    while True:
        line = input(">>> ")
        if line.strip() in ("exit", "quit"):
            break
        ast = parse(line)        # assume a parser exists
        result = eval_node(ast, env)
        if result is not None:
            print(result)
```

Because `env` persists across iterations, `x = 5` on one line is visible to `print(x)` on the next. That persistence *is* what makes a REPL feel like a session rather than a series of unrelated runs.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Build speed** | Fastest interpreter to write. A working tree-walker fits in a few hundred lines. | Slowest *runtime* of all execution strategies. |
| **Simplicity** | Maps directly to the AST; easy to read, debug, and extend node by node. | Per-node type dispatch and pointer-chasing make it cache-unfriendly. |
| **Flexibility** | Trivial to add new node types, new operators, new built-ins. Great for evolving languages. | Hard to optimize *as a tree-walker*; real speedups require switching to bytecode. |
| **Error reporting** | You hold the whole tree, with source positions, so you can give rich error messages. | If you forget to thread source positions through, errors become vague. |
| **Tooling/REPL** | Naturally supports a REPL and interactive use — just keep the environment alive. | State across REPL lines can hide bugs that a fresh run would not. |
| **Portability** | Runs anywhere the host language runs; no code generation, no target architecture. | No native-code speed; CPU-bound workloads suffer. |
| **Startup** | No compile-and-link step; runs instantly. | Re-does the walk on every execution; no caching of work across runs. |

---

## Use Cases

A tree-walking interpreter is the right tool when:

- **You are learning or teaching how languages work.** It is the clearest possible model.
- **You are prototyping a new language.** Get semantics right first; optimize later.
- **You are building a small embedded/scripting language** for config, rules, templates, or queries, where simplicity matters more than raw speed.
- **The workload is I/O-bound or runs briefly.** If your "program" runs for milliseconds, interpreter overhead is invisible.
- **You need rich, position-aware error messages** and the simplicity of having the whole AST on hand.

It is the **wrong** tool when:

- You have hot loops running millions of iterations where speed dominates — move to a bytecode interpreter (`middle.md`).
- You need near-native performance — that calls for bytecode plus a JIT, or ahead-of-time compilation.
- The language must run in tightly memory- or latency-constrained environments where pointer-chasing AST nodes are too costly.

---

## Coding Patterns

### Pattern 1: One `eval` function, dispatch on node type

The backbone is a single function that switches on the node's kind. Keep each case small and obvious. This is the Visitor pattern's simplest form.

```python
def eval_node(node, env):
    if isinstance(node, Num):   return node.value
    if isinstance(node, BinOp): return eval_binop(node, env)
    if isinstance(node, Var):   return env_lookup(env, node.name)
    # ...one branch per node type...
```

### Pattern 2: Evaluate children first, then combine

For any non-leaf node, recurse into the operands *before* doing the operation. This post-order discipline is correct for arithmetic, comparisons, and function arguments.

```python
left  = eval_node(node.left, env)
right = eval_node(node.right, env)
return combine(node.op, left, right)
```

### Pattern 3: Thread the environment through every call

`env` is a parameter to `eval`, not a global. Passing it explicitly makes scope and function calls (which create new environments) clean to implement later.

### Pattern 4: Separate "evaluate value" from "execute effect"

Use `eval` for expressions (returns a value) and a parallel notion for statements (performs an action). Even if they share one function, keep the mental distinction — it prevents confusion when a statement accidentally needs to return something.

### Pattern 5: Keep node definitions dumb, logic in the interpreter

AST nodes should be plain data (fields only). Put all behavior in `eval`. This keeps the tree serializable, testable, and easy to print — and means there is *one place* to look for "what does this construct do."

---

## Best Practices

- **Write the tree-walker first, always.** Even if you know you will need bytecode later, the tree-walker is your reference implementation and your test oracle.
- **Carry source positions on every node.** Line and column on each node turn "error" into "error at line 7, column 3." Do this from day one; retrofitting is painful.
- **Make `eval` total over node types.** Have an explicit final `else` that raises "unhandled node type" — so a forgotten case fails loudly instead of returning `None` silently.
- **Test each node type in isolation.** A small unit test per construct (`2+2`, variable lookup, `if`, `while`) localizes bugs instantly.
- **Keep the environment explicit.** Pass it in; do not reach for a global. Globals make nested scopes and function calls a nightmare.
- **Define truthiness once.** Decide what counts as true/false in your guest language and put it in a single `truthy()` helper used everywhere.
- **Print your AST.** A `repr`/`toString` that shows the tree is the cheapest, most valuable debugging tool you can write.

---

## Edge Cases & Pitfalls

- **Operator precedence is the parser's job, not the evaluator's.** If `2 + 3 * 4` gives `20`, your *parser* built the wrong tree; the evaluator is faithfully walking it. Do not "fix" precedence in `eval`.
- **Undefined variable lookups.** Reading a name that was never assigned must raise a clear error, not return `None`/`undefined` and silently corrupt later math.
- **Division by zero and type errors.** Decide what your language does (error? infinity? `null`?) and handle it explicitly, with a good message.
- **Forgetting to return a value.** In some host languages, a missing `return` in an `eval` branch silently yields `None`/`undefined`, producing baffling downstream bugs. Make every branch return.
- **Mutating the wrong environment.** When you add functions and blocks, assigning to a variable should hit the right scope. Getting this wrong gives "my variable changed unexpectedly" bugs (covered in `middle.md`).
- **Deep recursion blows the host stack.** A tree-walker recurses as deep as the program nests; deeply nested expressions or deep guest recursion can overflow the *host's* call stack. Real interpreters manage their own stack to avoid this (see `senior.md`).
- **Evaluating both branches of an `if`.** Only execute the taken branch. Accidentally evaluating both (e.g. computing both then choosing) breaks side effects and short-circuiting.
- **Re-evaluating a subexpression by mistake.** If you call `eval(node.left)` twice, side effects (like assignments or prints) happen twice. Evaluate each child exactly once and store the result.

---

## Test Yourself

1. In your own words, what is the difference between compiling a program and interpreting it? Give one real tool for each.
2. Draw the AST for `1 + 2 * 3 - 4`. Then trace `eval` over it, writing down the value returned at each node. What is the final result, and why is it not `(1+2)*(3-4)`?
3. The interpreter raises a `NameError` for `Var("y")` when `y` was never assigned. Where in the code does that check live, and why is returning `None` instead a bad idea?
4. Add a unary minus node (`Neg(expr)`) to the Python interpreter so that `-(3 + 4)` evaluates to `-7`. Which one function do you change?
5. Trace what happens in the REPL when you type `x = 10` then on the next line `x = x + 5`. Why does the second line see the value from the first?
6. The `While` evaluator uses the host language's `while`. Rewrite the guest `while` so it counts down from 3 to 0 (as an AST), and trace how many times the body runs.
7. Why is a tree-walking interpreter slow for a million-iteration loop? Name two concrete sources of overhead per node.
8. If `2 + 3 * 4` ever evaluated to `20`, which stage of the pipeline has the bug — lexer, parser, or evaluator? Explain.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                    TREE-WALKING INTERPRETER                       │
├──────────────────────────────────────────────────────────────────┤
│ COMPILER   : source -> machine code (run later)                   │
│ INTERPRETER: source -> the result (run now)                       │
├──────────────────────────────────────────────────────────────────┤
│ Pipeline:   text -> [lexer] -> tokens -> [parser] -> AST          │
│                  -> [eval]  -> result                             │
├──────────────────────────────────────────────────────────────────┤
│ The whole interpreter = one recursive function:                   │
│                                                                   │
│   eval(node, env):                                                │
│     literal   -> return its value                                 │
│     variable  -> look it up in env                                │
│     binop     -> eval(left); eval(right); combine                 │
│     assign    -> env[name] = eval(expr)                           │
│     if        -> eval cond; run the chosen branch                 │
│     while     -> host while loop around eval(body)                │
├──────────────────────────────────────────────────────────────────┤
│ Environment = hash map { name -> value }, passed into eval        │
│ Precedence  = decided by the PARSER (tree shape), not eval        │
│ Control flow= the HOST language's if/while/recursion              │
├──────────────────────────────────────────────────────────────────┤
│ Trade-off: fastest to BUILD, slowest to RUN.                      │
│ Next step for speed: compile AST -> bytecode (see middle.md)      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- An **interpreter** runs a program directly by reading and acting on it, instead of translating it to machine code to run later like a **compiler** does.
- The simplest interpreter is a **tree-walking interpreter**: parse source into an **AST**, then write a recursive `eval(node, env)` that computes each node's value by first evaluating its children.
- **Variables** live in an **environment** — a hash map from name to value — that is passed into `eval` so every node can read and write it.
- **Control flow** (`if`, `while`) and **recursion** need no special machinery: they are implemented using the *host language's* own control flow. The host lends its powers to the guest.
- **Operator precedence** is decided by the parser's tree shape, not by the evaluator — a common source of confusion.
- A **REPL** is just `eval` in a loop with the environment kept alive between lines.
- Tree-walking is the **fastest to build and slowest to run** — perfect for prototypes, config/scripting languages, teaching, and I/O-bound work. It is too slow for hot numeric loops.
- When speed matters, the next step is a **bytecode interpreter** (`middle.md`): compile the AST to a flat instruction list and run a fast fetch-decode-execute loop. That is how Python, Ruby, and Lua really work.
- A junior's #1 takeaway: writing your own `eval` demystifies *every* language feature, because you will have implemented it yourself.

---

## What You Can Build

- **A four-function calculator with variables.** Parse and evaluate `+ - * /`, parentheses, and `x = ...` assignments. Add a REPL.
- **A tiny scripting language.** Numbers, strings, booleans, `if`, `while`, `print`, and comparison operators — enough to write FizzBuzz in *your* language.
- **A spreadsheet-cell evaluator.** Cells contain expressions referencing other cells (`A1 = B1 + C1`); evaluate the dependency tree.
- **A config/expression mini-language.** Let users write `timeout = base * 2 + jitter` in a config file and evaluate it with their variables in the environment.
- **A "math homework checker."** Parse arithmetic expressions and evaluate them to verify a student's answer, with friendly error messages on invalid input.
- **A guest-language FizzBuzz.** Implement enough of a language (loops, `if`, modulo, print) to run FizzBuzz *through your interpreter* — a satisfying milestone.

---

## Further Reading

- *Crafting Interpreters* — Robert Nystrom. The definitive, friendly book; Part II builds exactly the tree-walker described here (the Lox language). Free online at https://craftinginterpreters.com/
- *Writing An Interpreter In Go* — Thorsten Ball. A hands-on, test-driven tree-walking interpreter for the Monkey language.
- *Structure and Interpretation of Computer Programs (SICP)* — Abelson & Sussman. Chapter 4 builds a metacircular evaluator — the classic `eval`/`apply`.
- *Programming Languages: Application and Interpretation (PLAI)* — Shriram Krishnamurthi. Free; builds interpreters incrementally.
- *Essentials of Programming Languages* — Friedman & Wand. Rigorous treatment of interpreters and environments.
- *Build Your Own Lisp* — Daniel Holden. Free online; a complete interpreter in C, lexer through eval.
