# Semantic Analysis — Middle Level

> **Topic:** [Semantic Analysis](README.md)
> **Focus:** Build a real scoped symbol table and a recursive, bottom-up type checker — and produce diagnostics a human can act on.

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
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **From "a stack of dictionaries" to a working analyzer — the data structures, the walk, and the diagnostics.**

At the junior level you learned the *what*: semantic analysis is the phase after parsing that proves a program *means* something. Name resolution connects each use to a declaration; type checking proves the types fit; the output is a decorated AST. You saw a scope stack sketched in pseudo-Python and the idea that two passes handle forward references.

The middle level is where you turn those sketches into something that would survive contact with a real grammar. The difference between the junior `ScopeStack` and a production symbol table is the difference between a toy and a tool — and almost all of that difference lives in the boring details: *what* you store per symbol (not just a type — a kind, a source location, a mutability flag, a "used yet?" bit), *how* you represent a scope (a stack while walking, but a persistent tree if you want IDE features), *when* you insert a name into the current scope (this single decision determines whether `let x = x` is legal), and *how* you keep walking after the first error instead of crashing.

This page builds three things properly. First, a real symbol table: scoped, with rich symbol records, and with an honest answer to "hash map vs. chained list of scopes." Second, a recursive type checker that walks the AST bottom-up, computes a type for every expression, and checks assignability, call arity, and condition types — emitting an `ErrorType` sentinel instead of throwing so one mistake doesn't cascade into ten. Third, the diagnostics machinery: every check produces a message with a source span, and the analyzer *recovers* and continues. Along the way you will meet the checks beyond names and types — definite assignment, reachability, `break`/`return` context — and you will see why most real compilers split semantic analysis into multiple passes even for a single file.

By the end you should be able to read a tree-walking analyzer for a small language and know exactly where each rule is enforced, why the order of operations matters, and how the typed AST it produces feeds the next phase.

---

## Prerequisites

Before reading this page you should be comfortable with:

- Everything in the junior page: declarations vs. uses, lexical scope, shadowing, the "stack of dictionaries" symbol table, bottom-up typing, the decorated AST, and why forward references need two passes.
- Recursion over a tree. The whole phase is one big recursive walk; if recursion is shaky, the code will be hard to follow.
- A hash map / dictionary and its `O(1)` average lookup, plus the idea of hashing strings.
- Reading code in at least two of: Python, Java, C, Go. Examples appear in pseudo-Python and a couple of real languages.
- The **visitor pattern** in concept — one handler per node kind. If you have never used it, the junior page's "Coding Patterns" section is enough.

You do **not** need:

- Type inference algorithms (Hindley–Milner, constraint solving). That is the type-systems material and the senior/professional pages here. This page does *checking*, where types are mostly written down.
- Borrow checking, overload resolution, or attribute grammars — those are senior/professional topics.
- Any IR or code generation knowledge. We only produce the decorated AST that codegen will later consume.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Symbol** | One entry in the symbol table: a name plus everything known about it (kind, type, declaration site, flags). |
| **Symbol kind** | What the name *is*: variable, parameter, function, type, field, constant, module. Drives which rules apply. |
| **Scope** | A region of visibility. While walking, scopes form a stack; conceptually they form a tree. |
| **Scope tree** | The nesting of scopes as a tree (global → function → block → block). Persistent symbol tables keep the whole tree. |
| **Enter / exit scope** | Pushing a fresh scope on the way into a block; popping it on the way out. |
| **Insert / lookup** | Adding a symbol to the current scope; searching innermost-to-outermost for a name. |
| **Binding** | The link from a use to the symbol it resolves to. Stored on the AST node by name resolution. |
| **Bottom-up typing** | Computing a node's type from its children's types; the spine of a type checker. |
| **Assignability / subtyping** | Whether a value of type `A` may flow into a slot of type `B` (`A <: B`). Directional, not symmetric. |
| **Arity** | The number of arguments a function/operator takes. "Call arity check" = right number of args. |
| **Definite assignment** | A rule that a local must be provably assigned before it is read (Java, C#). |
| **Reachability** | Whether control flow can actually reach a statement; unreachable code may be an error or warning. |
| **ErrorType** | A sentinel type assigned to an expression that already failed, so it doesn't trigger more errors. |
| **Diagnostic** | A structured error/warning: severity, message, and a source span (file, line, column range). |
| **Span** | The source range a diagnostic or node covers, used to draw the caret under the offending code. |
| **Error recovery** | Continuing analysis after an error to report as many real problems as possible in one run. |
| **Pass** | One complete walk over the AST. Declaration collection and body checking are typically separate passes. |
| **Typed AST / decorated AST** | The AST after analysis, annotated with resolved bindings and computed types. |

---

## Core Concepts

### 1. The symbol record: store more than a type

The junior symbol table mapped `name → type`. That is not enough. To produce good diagnostics and feed later phases, each symbol needs a record:

```text
Symbol {
    name:        "count"
    kind:        Variable | Parameter | Function | Type | Const | Field | Module
    type:        the resolved type (or Unresolved until inferred)
    decl_span:   where it was declared (file, line, col) — for "declared here" notes
    mutable:     can it be reassigned? (let vs const, val vs var)
    used:        has any use referenced it? (for "unused variable" warnings)
    scope_depth: how deep its scope is (debugging, shadow warnings)
}
```

The `kind` matters because rules are keyed on it: you can call a `Function` but not a `Variable`; you can assign to a `mutable` variable but not a `Const`; you can use a `Type` in a type annotation but not in arithmetic. A flat `name → type` map cannot express any of that.

### 2. Scope as a stack while walking, a tree if you keep it

While the analyzer walks the AST top-to-bottom, the active scopes form a **stack**: `enter_scope` pushes, `exit_scope` pops, declarations go into the top, lookups search top-to-bottom. This is exactly the junior model and it is correct for a single-pass batch compiler.

But a stack is *destructive* — once you pop a scope, it's gone. IDEs and multi-pass compilers want to revisit scopes later ("what's in scope at line 40?"), so they build a **scope tree** instead: every scope keeps a pointer to its parent, and nothing is discarded. The walk still feels like a stack (you track a `current` pointer), but `exit_scope` just moves `current` back to the parent rather than deleting anything.

```text
Stack view (during walk)         Tree view (kept around)
                                  global
  [ global ]                        └── foo()  (function scope)
  [ global, foo ]                        ├── block A
  [ global, foo, block A ]               └── block B
  ... pop block A ...
  [ global, foo ]
```

Rule of thumb: a one-shot compiler can use a stack; anything that needs to answer questions *after* the walk (tooling, multi-pass) uses a parent-linked tree.

### 3. Hash-per-scope vs. one chained table

Two classic representations:

- **Hash-per-scope (a stack/tree of hash maps).** Each scope owns its own hash map. `lookup` walks parent links, doing one hash probe per level until it finds the name or runs out. Simple, the dominant choice today. Cost of a lookup is `O(depth)` hash probes; depth is usually small (single digits).
- **One chained hash table (the "imperative symbol table").** A single global hash map keyed by name; each entry is a *stack* of declarations (most recent on top). Entering a scope records a marker; exiting pops every declaration made since the marker. Lookup is a single `O(1)` probe — you read the top of the name's stack. This is the classic Dragon-Book design and it is faster for deep nesting, at the cost of trickier scope-exit bookkeeping.

```text
Hash-per-scope                Chained (one table, per-name stacks)
                              "x" -> [ block-x, fn-x, global-x ]   (top = innermost)
{global x,print}              "print" -> [ global-print ]
   {fn  y}                    exit block: pop everything pushed since marker
      {blk x}                 lookup("x") = top of "x"'s stack = O(1)
```

For a learning compiler, hash-per-scope with parent links is the right default: it's the easiest to get correct, and depth is rarely large enough for the lookup cost to matter.

### 4. The walk: declare-at-the-right-point

Name resolution is a recursive walk with one subtle rule: *insert a name into the current scope at the exact program point it becomes visible*, not for the whole block at once. This decides the meaning of self-reference:

```text
let x = 1;
{
    let x = x + 1;   // which x is on the right?
}
```

If you check the initializer (`x + 1`) *before* inserting the new `x`, the right-hand `x` resolves to the outer `x` (so the inner becomes `2`). This is the rule in Rust, Java, C, Go for locals: the new binding is not in scope inside its own initializer. If you insert *first*, the right `x` would refer to the not-yet-initialized inner `x` — usually an error ("used before initialized") or, in some languages, intentional (recursive `let`). Most imperative languages take the first option, so the order in your walker is: **resolve the initializer, then declare the name.**

Functions are the deliberate exception: declare the function's name *before* checking its body, so recursion (`f` calling `f`) resolves.

### 5. Multi-pass for forward references

Inside a block, top-to-bottom declaration order is usually mandatory. But at *file* or *class* scope, you can use a function or type defined later. The standard fix is two passes over each scope that allows forward references:

```text
Pass 1 — collect:  walk the top level, insert every function/type/global
                   name (with its signature) WITHOUT checking bodies.
Pass 2 — check:    walk again; now every top-level name is already in the
                   table, so calls and type references resolve regardless
                   of textual order.
```

This is why `tsc`, `javac`, and the Go compiler let you call a function defined 200 lines later but still complain if you read a *local* before its `let`. Same language, two rules — because top-level names are collected first.

### 6. Bottom-up type checking with an ErrorType sentinel

The type checker walks each expression and returns a type. Leaves return their type directly; internal nodes derive theirs:

```text
type_of(IntLiteral)     = Int
type_of(StringLiteral)  = String
type_of(Name n)         = the symbol's type (from name resolution)
type_of(Add l, r):
    lt, rt = type_of(l), type_of(r)
    if lt is ErrorType or rt is ErrorType: return ErrorType   # don't re-report
    if lt == Int and rt == Int:    return Int
    if lt == String and rt == String: return String
    diagnostic("cannot add {lt} and {rt}", node.span); return ErrorType
```

The **ErrorType sentinel** is the single most important error-recovery trick in a checker. When a subexpression has already produced a diagnostic, give it type `ErrorType`. Every rule treats `ErrorType` as "already broken — propagate quietly, emit nothing." Without it, one undefined variable in a deeply nested expression produces a cascade of secondary "type mismatch" errors that bury the real one.

### 7. Assignability is directional

`a = b` is legal when the type of `b` is *assignable to* the type of `a` — not when they're merely equal. Assignability includes widening and subtyping:

```text
let f: float = 3;        // OK: Int is assignable to Float (widening)
let i: int   = 3.5;      // ERROR: Float is NOT assignable to Int (narrowing)
let a: Animal = dog;     // OK if Dog <: Animal (subtyping)
let d: Dog    = animal;  // ERROR: Animal is not a Dog
```

So `assignable(from, to)` is a *directional* predicate, distinct from `equal(a, b)`. Mixing them up is a classic bug: using `==` for assignment checks rejects every legal widening and subtype.

### 8. Checks beyond names and types

A real analyzer enforces a family of smaller rules, each a small extra walk or a flag on the symbol record:

- **Call arity & argument types.** `f(1, 2)` against `func f(a: int)` → "expected 1 argument, got 2"; then check each argument is assignable to its parameter.
- **`break` / `continue` / `return` context.** A `break` outside any loop is an error; a `return value` inside a `void` function is an error. Track a small context stack (in-loop? function return type?) as you walk.
- **Definite assignment.** A local that may be read before it's assigned is an error in Java/C#. Requires a tiny control-flow analysis (see senior level).
- **Reachability / dead code.** Statements after an unconditional `return`/`break` can't run. Warn or error.
- **`const`-correctness / mutability.** Assigning to a `const`/`val` is an error; the `mutable` flag on the symbol record answers this in one check.

### 9. Diagnostics and recovery

The *output a human sees* is the diagnostics. Make them structured from the start:

```text
Diagnostic {
    severity: Error | Warning | Note
    message:  "cannot add `int` and `string`"
    span:     demo.lang:3:9..3:14
    notes:    [ "`a` declared here", span2 ]
}
```

The analyzer **collects** diagnostics into a list and **keeps walking**. It does not throw on the first error. Recovery rules: assign `ErrorType` to broken expressions; treat an undefined name as a fresh symbol of `ErrorType` so later uses don't re-error; skip a malformed statement and continue with the next. The goal: one compile run surfaces *all* the user's real mistakes, not just the first.

---

## Real-World Analogies

| Analogy | Maps to |
|---|---|
| A building directory updated as you walk floor to floor | The scope stack: each floor adds its own tenant list |
| A receptionist who checks the current floor's list, then the lobby's | `lookup` searching innermost scope then outward |
| A library card catalog where one card holds title, author, shelf, and "checked out?" | The rich symbol record, not just a type |
| A customs form: each box must match the declared category | Assignability — the value must fit the slot's type |
| A spell-checker that flags every misspelling, not just the first | Error recovery: collect all diagnostics, don't stop at one |
| A "you are here" map kept after you leave a room | The persistent scope tree vs. the destructive stack |
| Filling in a tax form bottom-up, totals derived from line items | Bottom-up typing: parents computed from children |

---

## Mental Models

**Model 1 — "The walk carries state."** A semantic analyzer is a recursive tree walk that carries mutable state: the current scope, the current function's return type, whether you're inside a loop, the diagnostics list. Every node handler reads and updates this state. Get the *order* of reads/writes right (resolve initializer before declaring; enter scope before walking children) and most bugs vanish.

**Model 2 — "Two questions, two artifacts."** Name resolution answers "what does this refer to?" and writes a *binding* onto each name node. Type checking answers "what type is this?" and writes a *type* onto each expression node. The decorated AST is just the original tree plus these two annotations everywhere.

**Model 3 — "ErrorType is a quarantine."** Once an expression is sick, mark it `ErrorType` and let it move through the rest of the checker without infecting the diagnostics. The first real error gets reported; everything downstream stays silent. This single sentinel is what makes a checker pleasant rather than infuriating.

**Model 4 — "Collect, then check."** For any scope that allows forward references, split the work: pass one inserts names, pass two checks bodies. Mentally tag each scope as "ordered" (locals: declare-before-use) or "unordered" (file/class top level: collect first).

---

## Code Examples

The examples build one small analyzer in pseudo-Python, then show the same ideas in Java and Go where the language adds something specific.

### Example 1: A real scoped symbol table (hash-per-scope, parent-linked)

```python
from dataclasses import dataclass, field

@dataclass
class Symbol:
    name: str
    kind: str          # "var" | "func" | "param" | "type" | "const"
    type: object       # resolved type, or None until known
    decl_span: tuple   # (line, col)
    mutable: bool = True
    used: bool = False

class Scope:
    def __init__(self, parent=None):
        self.parent = parent
        self.symbols: dict[str, Symbol] = {}

    def insert(self, sym: Symbol):
        # Conflict check is CURRENT scope only — nested shadowing is fine.
        if sym.name in self.symbols:
            raise Redeclared(sym.name, self.symbols[sym.name].decl_span)
        self.symbols[sym.name] = sym

    def lookup(self, name: str) -> Symbol | None:
        scope = self
        while scope is not None:          # innermost -> outermost
            if name in scope.symbols:
                hit = scope.symbols[name]
                hit.used = True
                return hit
            scope = scope.parent
        return None                        # caller turns None into a diagnostic
```

`lookup` returns `None` rather than throwing — the caller decides whether that's an "undefined variable" error (and can recover). Marking `used = True` on a hit gives you "unused variable" warnings for free at scope exit.

### Example 2: Name resolution as a recursive walk

```python
class Resolver:
    def __init__(self):
        self.current = Scope()        # global scope
        self.diagnostics = []

    def enter(self):
        self.current = Scope(parent=self.current)

    def exit(self):
        self.warn_unused(self.current)
        self.current = self.current.parent

    def warn_unused(self, scope):
        for sym in scope.symbols.values():
            if sym.kind == "var" and not sym.used:
                self.diagnostics.append(
                    Diag("warning", f"unused variable '{sym.name}'", sym.decl_span))

    def resolve(self, node):
        kind = node.kind
        if kind == "Block":
            self.enter()
            for s in node.body:
                self.resolve(s)
            self.exit()                    # symbols + unused-warnings handled here

        elif kind == "Let":
            self.resolve(node.value)       # RESOLVE INITIALIZER FIRST
            sym = Symbol(node.name, "var", None, node.span, mutable=not node.is_const)
            try:
                self.current.insert(sym)   # THEN declare
            except Redeclared as e:
                self.diagnostics.append(
                    Diag("error", f"'{node.name}' already declared", node.span,
                         notes=[("first declared here", e.first_span)]))

        elif kind == "Name":
            sym = self.current.lookup(node.name)
            if sym is None:
                self.diagnostics.append(
                    Diag("error", f"undefined variable '{node.name}'", node.span))
                # RECOVERY: bind to a synthetic error symbol so later uses are quiet
                node.binding = ERROR_SYMBOL
            else:
                node.binding = sym         # decorate the node

        elif kind == "Assign":
            self.resolve(node.target)
            self.resolve(node.value)
            if node.target.binding and not node.target.binding.mutable:
                self.diagnostics.append(
                    Diag("error", f"cannot assign to const '{node.target.name}'",
                         node.span))
```

Notice the four recovery moves: `Let` reports a redeclaration but still continues; `Name` binds to `ERROR_SYMBOL` on failure so the same typo doesn't re-error at every use; `Assign` checks mutability via the symbol record; and the whole walk appends to `diagnostics` instead of raising.

### Example 3: Bottom-up type checking with ErrorType

```python
INT, STRING, BOOL, ERROR = "int", "string", "bool", "<error>"

class Checker:
    def __init__(self, diagnostics):
        self.diagnostics = diagnostics
        self.current_return = None      # set when entering a function

    def check(self, node) -> str:
        k = node.kind
        if k == "IntLit":    node.type = INT;    return INT
        if k == "StrLit":    node.type = STRING; return STRING
        if k == "BoolLit":   node.type = BOOL;   return BOOL

        if k == "Name":
            node.type = node.binding.type or ERROR
            return node.type

        if k == "Add":
            lt = self.check(node.left)
            rt = self.check(node.right)
            if ERROR in (lt, rt):
                node.type = ERROR; return ERROR      # quarantine: emit nothing
            if lt == rt == INT:    node.type = INT;    return INT
            if lt == rt == STRING: node.type = STRING; return STRING
            self.error(f"cannot add `{lt}` and `{rt}`", node.span)
            node.type = ERROR; return ERROR

        if k == "Call":
            fn = node.callee.binding
            if fn is None or fn.kind != "func":
                self.error("not a function", node.span)
                node.type = ERROR; return ERROR
            if len(node.args) != len(fn.type.params):
                self.error(f"expected {len(fn.type.params)} args, "
                           f"got {len(node.args)}", node.span)
            for arg, param_ty in zip(node.args, fn.type.params):
                at = self.check(arg)
                if at != ERROR and not assignable(at, param_ty):
                    self.error(f"argument has type `{at}`, "
                               f"expected `{param_ty}`", arg.span)
            node.type = fn.type.ret
            return node.type

        if k == "If":
            ct = self.check(node.cond)
            if ct != ERROR and ct != BOOL:
                self.error(f"condition must be `bool`, got `{ct}`", node.cond.span)
            self.check(node.then)
            if node.els: self.check(node.els)
            node.type = None  # statements have no value type here
            return None

        if k == "Return":
            vt = self.check(node.value) if node.value else None
            if not assignable(vt or "void", self.current_return):
                self.error(f"returning `{vt}` from function returning "
                           f"`{self.current_return}`", node.span)
            return None

    def error(self, msg, span):
        self.diagnostics.append(Diag("error", msg, span))
```

Two things to notice. First, every internal node checks for `ERROR` in its children *before* applying its own rule, and emits nothing if found — that's the quarantine. Second, the checker decorates each node with `node.type`; that annotation is the typed AST the next phase consumes.

### Example 4: Assignability vs. equality

```python
SUBTYPES = {("int", "float"): True}    # widening: int <: float

def assignable(frm: str, to: str) -> bool:
    if frm == ERROR or to == ERROR:
        return True                     # never re-report through an error
    if frm == to:
        return True                     # exact match
    if SUBTYPES.get((frm, to)):
        return True                     # widening / subtype
    return False
```

`assignable("int", "float")` is `True` (widening) but `assignable("float", "int")` is `False` (narrowing). Equality alone would reject `let f: float = 3`. This directionality is the whole reason assignability is a separate predicate.

### Example 5: Two passes for forward references

```python
def analyze_program(program):
    diags = []
    resolver = Resolver(); resolver.diagnostics = diags

    # PASS 1 — collect every top-level function signature.
    for item in program.items:
        if item.kind == "Func":
            sig = FuncType([p.type for p in item.params], item.ret_type)
            resolver.current.insert(
                Symbol(item.name, "func", sig, item.span, mutable=False))

    # PASS 2 — now check bodies; calls to later functions already resolve.
    checker = Checker(diags)
    for item in program.items:
        if item.kind == "Func":
            resolver.enter()                         # parameter scope
            for p in item.params:
                resolver.current.insert(
                    Symbol(p.name, "param", p.type, p.span))
            checker.current_return = item.ret_type
            resolver.resolve(item.body)
            checker.check(item.body)
            resolver.exit()
    return diags
```

Because pass 1 inserts `helper` before pass 2 ever checks `main`'s body, `main` can call `helper` even if `helper` is written below it. A single combined pass would report `helper` as undefined.

### Example 6: Java definite assignment, in miniature

Java forbids reading a local that the compiler cannot prove is assigned. The check is a small flow analysis over the statements:

```python
def definite_assignment(block):
    assigned = set()                 # locals known to be set on every path here
    for stmt in block.body:
        if stmt.kind == "Decl":
            if stmt.init is not None:
                check_uses(stmt.init, assigned)
                assigned.add(stmt.name)        # initialized -> assigned
            # else: declared but not yet assigned
        elif stmt.kind == "Assign":
            check_uses(stmt.value, assigned)
            assigned.add(stmt.target)
        elif stmt.kind == "Use":
            check_uses(stmt, assigned)
        elif stmt.kind == "If":
            check_uses(stmt.cond, assigned)
            then_set = run_branch(stmt.then, assigned.copy())
            else_set = run_branch(stmt.els,  assigned.copy()) if stmt.els else assigned
            assigned = assigned | (then_set & else_set)   # set on BOTH paths
```

```java
int x;
if (cond) { x = 1; }
System.out.println(x);   // ERROR: x might not be assigned (only set in `then`)
```

The intersection `then_set & else_set` is the crux: a variable counts as assigned after an `if` only if *every* branch assigns it. This is the simplest real instance of control-flow-aware semantic analysis, and it's why Java rejects the snippet above but accepts it once you add an `else { x = 2; }`.

### Example 7: A diagnostic that points at the code (Go-style)

```go
type Diagnostic struct {
    Severity string // "error" | "warning"
    Message  string
    File     string
    Line     int
    ColStart int
    ColEnd   int
    Notes    []Note
}

func (d Diagnostic) Render(srcLine string) string {
    caret := strings.Repeat(" ", d.ColStart-1) +
        strings.Repeat("^", max(1, d.ColEnd-d.ColStart))
    return fmt.Sprintf("%s:%d:%d: %s: %s\n    %s\n    %s",
        d.File, d.Line, d.ColStart, d.Severity, d.Message, srcLine, caret)
}
```

```text
demo.lang:3:9: error: cannot add `int` and `string`
    let c = a + b;
            ^^^^^
```

The span (`ColStart..ColEnd`) is what lets you draw the caret. Every AST node must carry its span from the parser, or your best diagnostics degrade to "type error somewhere."

---

## Pros & Cons

| Aspect | Pros | Cons |
|---|---|---|
| Hash-per-scope symbol table | Easy to get correct; natural tree; trivial shadowing | Lookup is `O(depth)` probes; rebuilt per compile |
| Chained single table | `O(1)` lookup; classic, fast for deep nesting | Scope-exit bookkeeping (markers) is error-prone |
| Multi-pass analysis | Handles forward refs and mutual recursion cleanly | More walks; must keep partial state consistent between passes |
| ErrorType sentinel | Stops cascading errors; one walk reports everything | Must remember to short-circuit in *every* rule |
| Rich symbol records | Powers mutability, unused, "declared here" notes | More memory per symbol; more to keep in sync |
| Decorate-don't-rebuild AST | Cheap; original shape preserved for messages | Mutable AST nodes; ordering of annotations matters |

---

## Use Cases

- **A tree-walking interpreter's front end.** Resolve names and check types before evaluation so runtime never hits "undefined variable."
- **A transpiler** (e.g., a small language → JavaScript). The decorated AST tells the emitter the type of every expression.
- **A linter** for an existing language: the same symbol table powers "unused variable," "shadowed name," "assigned but never read."
- **An IDE language service.** Persistent scope tree + bindings drive go-to-definition, find-references, and rename.
- **A configuration / DSL validator.** Even a non-Turing-complete DSL benefits from name resolution and type checking before it's used.

---

## Coding Patterns

- **Visitor with carried context.** One handler per node kind; thread the current scope, return type, and loop-depth through the walk (as fields or an explicit context object).
- **Enter/exit in `try`/`finally`.** Pair `enter_scope` and `exit_scope` so an early return or exception cannot leak a scope. A leaked scope silently poisons every later lookup.
- **Resolve-then-declare.** For locals, walk the initializer before inserting the name. For functions, insert the name before walking the body.
- **Collect-then-check.** For file/class scope: pass one inserts signatures, pass two checks bodies.
- **Return-type-on-the-node.** Type checking returns a type *and* stamps it on the node. The return drives the parent's rule; the stamp builds the typed AST.
- **Sentinel short-circuit.** Every rule's first line: if any operand is `ErrorType`, return `ErrorType` and emit nothing.
- **Diagnostics list, not exceptions.** Append to a list; never throw to abort the whole analysis on one error.

---

## Clean Code

- **Make `Scope` and `Symbol` real types,** not raw dicts threaded through the walker. The scope logic lives in `insert`/`lookup`/`enter`/`exit` and nowhere else.
- **One pass, one responsibility.** Keep "resolve names" and "check types" as separate walks (or at least separate methods), even if they run back-to-back. Tangling them makes both harder to debug.
- **Spans everywhere, from the parser down.** Every node carries `(line, col_start, col_end)`. A diagnostic without a span is nearly useless.
- **Name diagnostics by the rule they enforce.** `undefined_variable`, `type_mismatch`, `arity_mismatch`, `const_assignment` — not a generic `semantic_error`.
- **Decorate, don't mutate destructively.** Add `node.binding` and `node.type` fields; never replace nodes during analysis. Later phases and messages may need the original shape.
- **Centralize assignability.** One `assignable(from, to)` function. Every "does this fit?" check calls it. Duplicating the subtyping rules guarantees they'll drift.

---

## Best Practices

| Practice | Why |
|---|---|
| Resolve right-hand sides before declaring the left-hand name | Decides the meaning of `let x = x`; matches mainstream languages |
| Declare functions before checking their bodies | Makes recursion and forward references resolve |
| Check only the current scope for redeclaration conflicts | Nested shadowing must stay legal |
| Use one `ErrorType` and short-circuit on it in every rule | Prevents one mistake from spawning a cascade |
| Treat an undefined name as an `ErrorType` symbol, then continue | Same typo at ten use-sites yields one error, not ten |
| Carry source spans on every node and diagnostic | Enables carets and "declared here" notes |
| Keep `assignable` directional and centralized | Equality alone rejects legal widening/subtyping |
| Track loop-depth and current-return-type as walk context | `break`-outside-loop and bad-`return` checks become trivial |
| Collect diagnostics; never throw on the first error | One run surfaces all the user's real mistakes |
| Warn on unused/shadowed names at scope exit | Cheap, high-value diagnostics from data you already have |

---

## Edge Cases & Pitfalls

- **Self-referential initializer.** `let x = x;` — if you insert before resolving the initializer, the right `x` wrongly binds to the new, uninitialized `x`. Resolve first.
- **Leaked scope on an early exit.** If a handler `return`s after `enter_scope` but before `exit_scope`, every later lookup is polluted. Use `try`/`finally`.
- **Redeclaration vs. shadowing.** `let x; let x;` in the *same* block is an error; `let x` inside a nested block shadowing an outer `x` is fine. Conflict checks must look only at the current scope.
- **Equality where assignability is meant.** Using `==` to validate `let f: float = 3` rejects the legal widening. Use directional `assignable`.
- **Forgetting the ErrorType short-circuit in one rule.** That one rule re-reports through already-broken subtrees and the cascade returns. The discipline must be uniform.
- **Function parameter scope.** Parameters live in a scope *outside* the body block but *inside* the function — so a body local can shadow a parameter, but two parameters with the same name conflict. Model it as its own scope.
- **`return` with/without a value.** `return;` in a value-returning function and `return v;` in a `void` function are both errors. Track the current return type.
- **Mutually recursive types.** `struct A { b: B }` and `struct B { a: A }` need both names in the table before either body is checked — another forward-reference case, handled by collecting type names in pass one.

---

## Common Mistakes

1. Inserting the new name *before* resolving its initializer, breaking `let x = x`.
2. Using one flat symbol table and discovering it can't tell an inner `x` from an outer one.
3. Searching scopes outermost-first, which breaks shadowing (you'd find the wrong `x`).
4. Throwing on the first error instead of recovering, so users see one error at a time.
5. Forgetting the `ErrorType` short-circuit, producing a cascade of secondary errors.
6. Comparing types with `==` where assignability (widening/subtyping) is required.
7. Storing only a type per symbol, then being unable to check mutability or call-ability.
8. Pairing `enter_scope`/`exit_scope` loosely, leaking a scope on an early return.
9. Treating a single combined pass as enough, then failing on any forward reference.
10. Reading a `Name` node's type off the use site instead of from its resolved symbol.
11. Dropping source spans, so diagnostics can't point at the offending code.
12. Checking redeclaration against the whole scope stack, wrongly rejecting legal shadowing.

---

## Tricky Points

- **"Lookup direction" and "shadowing" are the same rule.** Searching innermost-first *is* what makes the nearest declaration win. They're not two features; they're one.
- **`used` is set on lookup, but unused warnings fire at scope exit.** You only know a variable was never used once its scope closes. Time the warning to `exit_scope`.
- **The parameter scope is real and separate.** It sits between the enclosing scope and the body block. Getting this wrong makes parameter shadowing rules subtly off.
- **An undefined name should still get a (synthetic) type.** Bind it to `ErrorType`. Otherwise the type checker dereferences a null binding and crashes — turning a user error into a compiler crash.
- **Definite assignment needs control flow, not just scoping.** It's the first check where "in scope" isn't enough; you must reason about which paths assign the variable. That's the seam into the senior-level CFG material.
- **Top-level order-independence is a *choice* implemented by two passes,** not a property of the language's grammar. The parser is order-blind; the analyzer creates the illusion of order-independence by collecting first.

---

## Test Yourself

1. Why must you resolve a `let`'s initializer *before* inserting its name, but insert a function's name *before* checking its body?
2. Give the symbol record fields you'd need to (a) reject assignment to a constant and (b) emit "unused variable." Which field is set where?
3. Contrast hash-per-scope and the chained single-table symbol table on lookup cost and scope-exit cost.
4. What is the `ErrorType` sentinel for, and what breaks if one type rule forgets to short-circuit on it?
5. Why is `assignable(from, to)` directional? Give a pair that is legal one way and illegal the other.
6. Explain, with a 4-line program, why forward references at file scope require two passes.
7. In Java's definite-assignment check, why does a variable assigned only in an `if` (no `else`) count as *not* assigned afterward?

<details>
<summary>Answers</summary>

1. So the right-hand `x` in `let x = x` binds to the *outer* `x` (the new binding isn't in scope inside its own initializer). Functions are the exception so that recursion and self-reference inside the body resolve.
2. Need `mutable` (to reject const assignment) and `used` (for the warning). `mutable` is set at declaration from `let` vs `const`; `used` is set to `True` inside `lookup`, and the warning fires at `exit_scope` for symbols still `used == False`.
3. Hash-per-scope: lookup is `O(depth)` probes, scope exit is `O(1)` (drop the map). Chained: lookup is `O(1)` (top of the name's stack), scope exit is `O(decls in scope)` (pop everything since the marker).
4. It quarantines an already-failed expression so later rules emit no secondary errors. If one rule forgets to short-circuit, it applies its normal check to an `ErrorType` operand and re-reports — the cascade of bogus errors returns.
5. Because flow has a direction: a value of `from` must fit a slot of `to`. `assignable("int","float")` is true (widening) but `assignable("float","int")` is false (narrowing).
6. `main()` calling `helper()` where `helper` is defined below `main`: a single top-to-bottom pass sees `helper` undefined at `main`'s call. Pass one collects `helper`'s signature first; pass two then resolves the call.
7. Definite assignment requires the variable be set on *every* path to the read. The `else`-less `if` leaves a path (condition false) where it's never assigned, so the intersection of branch-assigned sets excludes it.

</details>

---

## Tricky Questions

**Q1.** Your checker reports five "type mismatch" errors for a program with a single undefined variable. What's the design flaw and the fix?
**A.** No `ErrorType` quarantine. The undefined name produced a null/unknown type that propagated into every enclosing expression, each of which re-reported. Bind the undefined name to an `ErrorType` symbol and short-circuit every type rule when an operand is `ErrorType`.

**Q2.** A user writes `const PI = 3.14; PI = 3.15;` and your analyzer accepts it. Where is the bug?
**A.** Either the symbol record didn't store `mutable`, or the `Assign` handler didn't consult it. The fix is to set `mutable = False` for `const` declarations and reject assignment when `target.binding.mutable` is false.

**Q3.** Why can you put `let x = 1` then `let x = 2` in two *nested* blocks but not in one block?
**A.** Shadowing in a nested block creates a new symbol in a new scope; the redeclaration check looks only at the *current* scope, finds no conflict, and the inner `x` simply hides the outer one. In a single block both go in the same scope's map, where the second insert collides.

**Q4.** You move type checking before name resolution to "save a pass." What goes wrong?
**A.** A `Name` node's type comes from its resolved symbol. Without resolution first, the checker has no binding to read a type from. Resolution must run first (or the two must be interleaved so each name is resolved before it's typed).

**Q5.** The analyzer crashes (not "reports an error") on `print(zog)` where `zog` is undefined. What happened and how do you make it merely an error?
**A.** The `Name` handler returned `None` for the binding, and the type checker dereferenced it. Recovery: bind undefined names to a synthetic `ErrorType` symbol so the checker always has *something* to read, turning a crash into a clean diagnostic.

**Q6.** Java accepts `int x; if (c) x = 1; else x = 2; use(x);` but rejects the same code without the `else`. Both are well-scoped. Why the difference?
**A.** Definite assignment is a control-flow property, not a scoping one. With both branches assigning `x`, every path to the use sets it (intersection includes `x`). Drop the `else` and there's a path where `x` is unset, so the use is rejected.

---

## Cheat Sheet

```text
SEMANTIC ANALYSIS — MIDDLE

SYMBOL RECORD (store more than a type)
  name | kind(var/func/param/type/const) | type | decl_span | mutable | used

SCOPE
  while walking: a STACK  (enter=push, exit=pop)
  if you keep it: a TREE   (parent links; exit moves `current` up)
  lookup: innermost -> outermost (this IS shadowing)
  redeclaration check: CURRENT scope only

TABLE REPRESENTATION
  hash-per-scope : lookup O(depth), exit O(1)      <- default
  chained 1-table: lookup O(1),     exit O(decls)

THE WALK (order matters)
  Let:   resolve initializer  THEN  insert name
  Func:  insert name          THEN  check body   (recursion)
  Block: enter -> children -> exit (try/finally)

MULTI-PASS (forward refs at file/class scope)
  pass1 collect signatures  ->  pass2 check bodies

TYPE CHECK (bottom-up)
  leaves know their type; parents derive from children
  FIRST LINE of every rule: if operand is ErrorType -> return ErrorType
  assignable(from,to): DIRECTIONAL (int<:float ok; float->int no)
  decorate: node.type = ... ; node.binding = ...

OTHER CHECKS
  break/continue: track loop-depth
  return value:   track current return type
  const assign:   symbol.mutable
  definite assign: needs control flow (intersect over branches)
  unused/shadow:  warn at exit_scope

DIAGNOSTICS
  {severity, message, span, notes[]}; collect in a list; DON'T throw
  recover: ErrorType, synthetic symbols, skip-and-continue
```

---

## Summary

- A production symbol table stores a **rich symbol record** per name (kind, type, declaration span, mutability, used-flag), not just a type — because the language's rules are keyed on those fields.
- While walking, scopes are a **stack**; if you need them afterward (tooling, multi-pass), keep a parent-linked **scope tree**. Lookup searches innermost-to-outermost, which *is* shadowing.
- **Hash-per-scope** is the easy, correct default (lookup `O(depth)`, exit `O(1)`); the **chained single table** trades trickier scope-exit bookkeeping for `O(1)` lookup.
- The walk's **order of operations** encodes language rules: resolve a `let`'s initializer before declaring its name; declare a function before checking its body.
- **Forward references** at file/class scope require two passes: collect signatures, then check bodies.
- Type checking is **bottom-up**, decorating each expression node with its type. The **`ErrorType` sentinel**, short-circuited in every rule, is what stops one mistake from cascading.
- **Assignability is directional** (widening/subtyping), distinct from equality, and centralized in one function.
- Beyond names and types, the analyzer checks **`break`/`return` context, const-correctness, reachability, and definite assignment** — the last needing real control-flow reasoning.
- **Diagnostics are structured** (severity, message, span, notes), collected rather than thrown, with **recovery** so one run reports all the user's real errors. The result is the **typed AST** the next phase consumes.

---

## What You Can Build

- **A scoped name resolver** with a parent-linked scope tree that reports undefined variables, redeclarations, illegal shadowing, and unused/used warnings.
- **A bottom-up type checker** for `int`/`string`/`bool`/functions that checks arithmetic, conditions, call arity, argument types, assignability, and const assignment — using an `ErrorType` sentinel for clean recovery.
- **A two-pass front end** that collects top-level function and type signatures first, so calls to later-defined functions and mutually recursive types resolve.
- **A diagnostics engine** that renders `file:line:col` with a caret span and "declared here" notes, collecting all errors in one run.
- **A definite-assignment checker** that intersects branch-assigned variable sets across `if`/`else` to flag possibly-unassigned reads.
- **A small linter** reusing the symbol table to flag unused and shadowed names in an existing toy language.

---

## Further Reading

- *Crafting Interpreters* — Robert Nystrom. "Resolving and Binding" builds exactly this resolver; the type-related chapters extend it. https://craftinginterpreters.com/
- *Compilers: Principles, Techniques, and Tools* (the Dragon Book) — Aho, Lam, Sethi, Ullman. The symbol-table chapter covers the chained single-table design in detail.
- *Engineering a Compiler* — Cooper & Torczon. Strong, implementation-focused treatment of scopes and symbol tables.
- *Modern Compiler Implementation in Java/ML/C* — Andrew Appel. The semantic-analysis and symbol-table chapters.
- *The Java Language Specification*, the "Definite Assignment" chapter — the canonical, surprisingly precise definition of that one check.
- Your favorite compiler's diagnostics: read them as a specification of the semantic rules and try to predict their triggers.

---

## Related Topics

- The previous phase, **parsing**, produces the AST (with spans) that this analyzer walks and decorates.
- The deeper theory behind type *checking* — inference, subtyping, soundness — lives in the **type-systems** material; this page is its practical front line.
- The next phase, **intermediate-representation generation**, consumes the typed/decorated AST produced here.
- **Control-flow analysis** underlies definite assignment and reachability and is developed further at the senior level.
- **Linters and static analyzers** are essentially this symbol-table-plus-rules machinery without code generation.

---

## Diagrams & Visual Aids

### The resolve-then-declare ordering

```text
   Let  x  =  x + 1
        │      │
        │      └─ (1) RESOLVE initializer first
        │          the `x` here looks up the OUTER x
        │
        └─ (2) THEN insert the new `x` into current scope

   Functions invert this:
   Func f { ... f() ... }
        │             │
        └ (1) insert f └ (2) check body (f() now resolves -> recursion)
```

### Scope stack vs. scope tree

```text
WHILE WALKING (stack)            KEPT AROUND (tree, parent links)
  current ─► [ block B ]            global
            [ foo      ]              └─ foo ──┬─ block A   (popped, but kept)
            [ global   ]                       └─ block B   (current)
  exit B: current = B.parent
```

### Bottom-up typing with ErrorType quarantine

```text
            (Add)  cannot add int and string  -> ErrorType   [REPORTED ONCE]
           /     \
     (Name a)   (Name zog)  <- undefined -> ErrorType         [reported earlier]
     type=int   type=<error>

   parent sees an ErrorType operand -> returns ErrorType, EMITS NOTHING
   so the program's single real error is the undefined `zog`, not a cascade
```

### Definite assignment over branches

```text
   int x;                       assigned = {}
   if (c) { x = 1; }            then-branch assigns: {x}
   else   { x = 2; }            else-branch assigns: {x}
   use(x);                      after = then ∩ else = {x}  -> OK

   Drop the else:
   if (c) { x = 1; }            then: {x} ; implicit-else: {}
   use(x);                      after = {x} ∩ {} = {}      -> ERROR
```

### Diagnostic anatomy

```text
demo.lang : 3 : 9   error   cannot add `int` and `string`
   │        │   │     │        │
   file     │   col   severity message
            line                            note: `a` declared at demo.lang:1
                                            note: `b` declared at demo.lang:2
    let c = a + b;
            ^^^^^      <- caret spans ColStart..ColEnd
```
