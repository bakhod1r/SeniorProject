# Semantic Analysis — Junior Level

> **Topic:** [Semantic Analysis](README.md)
> **Focus:** The parser proved your program is *spelled* right. Now something has to prove it *means* something. That something is semantic analysis — name resolution, symbol tables, and type checking.

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

> Focus: **What is "semantically valid" and why is a syntactically correct program not enough?**

A compiler runs in phases. The **lexer** turns characters into tokens. The **parser** turns tokens into a tree (the **AST**) and proves the program is grammatically well-formed. But "grammatically well-formed" is a very low bar. This sentence is grammatically well-formed:

```text
x = y + zog;
```

The parser is perfectly happy: it's `identifier = identifier + identifier`. But if `zog` was never declared, the program is *nonsense*. If `y` is a string and `zog` is a number, the `+` might be nonsense too. If `x` was declared as a constant, assigning to it is nonsense. None of these are spelling mistakes — they are **meaning** mistakes.

**Semantic analysis** is the compiler phase that runs *after* parsing and checks that the program *means* something valid. It is the bridge from "syntactically correct" to "semantically valid." It answers questions the grammar cannot:

- Does every name you *use* refer to something you *declared*? (**name resolution**)
- Are the types consistent — can you actually add this to that, call this function with those arguments, assign this value to that variable? (**type checking**)
- Are there rules of the language being violated — using a variable before it's set, code that can never run, a `break` outside any loop, an unhandled `match` case?

> 🎓 **Why this matters for a junior:** Almost every compile error you have *ever* seen is a semantic error, not a syntax error. "undefined variable `zog`," "cannot assign string to int," "x is not in scope" — these are all produced by semantic analysis. When you understand this phase, the compiler stops being a mysterious oracle and becomes a checklist you can predict.

In one sentence: **the parser builds the tree; semantic analysis walks the tree and decides whether the tree makes sense.** The two big jobs are *connecting names to their declarations* and *checking that the types fit*. This page introduces both, plus the data structure that makes name resolution possible — the **symbol table** — and the idea of **scope**.

This page covers what scope is, what a symbol table is, how name resolution walks a tree, and what a type error looks like. The next level (`middle.md`) builds a real scoped symbol table and a recursive type checker; `senior.md` covers attribute grammars, multiple passes, and serious error recovery; `professional.md` covers borrow checking, overload resolution, and decorating the AST for the next phase.

---

## Prerequisites

What you should know before reading this:

- **Required:** What an **AST** (abstract syntax tree) is — that a program like `x = y + 1` becomes a tree with an assignment node at the top.
- **Required:** Basic understanding that compilers/interpreters have *phases* (lex → parse → ... → run/codegen).
- **Required:** What a variable declaration and a variable *use* are, in any language.
- **Helpful but not required:** Recursion. Semantic analysis walks trees, and tree walks are recursive.
- **Helpful but not required:** What a hash map / dictionary is. The symbol table is usually built on one.

You do **not** need to know:

- How a parser is built (LL, LR, recursive descent) — that's the previous phase.
- Type inference algorithms like Hindley-Milner — that's an advanced topic touched on later.
- How IR or machine code is generated — that's the phase *after* semantic analysis.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Semantic analysis** | The compiler phase, after parsing, that checks the program *means* something valid (names resolve, types fit, language rules hold). |
| **AST (Abstract Syntax Tree)** | The tree the parser produces. Semantic analysis walks and annotates it. |
| **Identifier / name** | A symbol you wrote: a variable, function, type, or field name. |
| **Declaration** | The place a name is *introduced* (`let x = 5`, `func foo()`, `class Dog`). |
| **Use (reference)** | A place a name is *referred to* after declaration (`print(x)`, `foo()`). |
| **Name resolution / binding** | Connecting each *use* of a name to its *declaration*. |
| **Scope** | The region of the program where a particular declaration is visible. |
| **Lexical (static) scope** | Scope determined by where code is *written* in the source. The default in almost every modern language. |
| **Shadowing** | An inner declaration hiding an outer declaration of the same name. |
| **Symbol table** | The data structure mapping names → information (declaration, type, scope) about them. |
| **Symbol** | An entry in the symbol table: one name and everything known about it. |
| **Type checking** | Verifying that the types in the program obey the language's rules. |
| **Type error** | A semantic error where types don't fit (e.g., `int + string`). |
| **Undefined variable** | A semantic error where a name is used but never declared in any visible scope. |
| **In scope / out of scope** | Whether a declaration is currently visible at a given point in the program. |
| **Forward reference** | Using a name *before* its declaration appears in the source (e.g., calling a function defined later in the file). |
| **Pass** | One complete walk over the AST. Semantic analysis often needs more than one. |
| **Decorated / annotated AST** | The AST after semantic analysis has attached types and resolved bindings to its nodes. |

---

## Core Concepts

### 1. The Job: From "Spelled Right" to "Makes Sense"

After parsing, you have a tree that is *grammatically* valid. Semantic analysis asks a different question: is this tree *meaningful*? It does this by walking the tree and checking rules. The two biggest rule families:

1. **Name rules.** Every name used must be declared somewhere visible. This is **name resolution**.
2. **Type rules.** The types of operands and assignments must be compatible. This is **type checking**.

There are smaller rule families too — you can't `break` outside a loop, you can't `return` a value from a `void` function, you can't read a variable that was never given a value — but for a junior, name resolution and type checking are the heart of it.

### 2. Declarations vs. Uses

Every name in a program is either a **declaration** (introduces the name) or a **use** (refers to an existing name):

```text
let count = 0;     // declaration of `count`
count = count + 1; // two USES of `count` (read on right, write on left)
print(count);      // a USE of `count`, and a USE of `print`
```

Name resolution's job is to draw an arrow from every *use* back to its *declaration*. If you can't draw the arrow — there's no declaration in scope — that's the **"undefined variable"** error.

### 3. Scope: Where a Name Lives

A **scope** is the region of the program where a declaration is visible. The most familiar example is a function body or a `{ }` block:

```text
let x = 1;          // outer scope
{
    let y = 2;      // inner scope; y is visible only inside these braces
    print(x);       // OK — x is visible here (inner can see outer)
    print(y);       // OK — y is visible here
}
print(x);           // OK — x still visible
print(y);           // ERROR — y is out of scope here
```

The key rule of **lexical scope** (the default everywhere): an inner scope can see names from enclosing scopes, but an outer scope cannot see names declared inside a nested scope. Scopes nest like Russian dolls.

### 4. Shadowing

When an inner scope declares a name that already exists in an outer scope, the inner one **shadows** the outer one — within the inner scope, the name refers to the inner declaration:

```text
let x = 1;
{
    let x = 99;     // shadows the outer x
    print(x);       // prints 99
}
print(x);           // prints 1 — the outer x was never changed
```

Shadowing is legal in most languages (Rust even encourages it). Name resolution handles it naturally: it always picks the *nearest* enclosing declaration.

### 5. The Symbol Table

To resolve names, the compiler keeps a **symbol table**: a map from each name to information about it (where it was declared, its type, its scope). The simplest mental picture is a dictionary:

```text
{ "count" → (variable, type=int, declared at line 1) ,
  "print" → (function, takes any, declared in std) }
```

But one flat dictionary can't handle scopes — `x` might mean different things in different blocks. So real symbol tables are **scoped**: think of a *stack* of dictionaries, one per active scope. To **look up** a name, you search the top dictionary, then the one below, then below, until you find it or run out (which means "undefined"). You build the proper version in `middle.md`; for now, the mental model is "a stack of dictionaries."

### 6. Type Checking

Once names resolve, the compiler knows the *type* of every variable and expression. **Type checking** verifies the type rules. Walk the tree bottom-up: a literal `5` has type `int`, a literal `"hi"` has type `string`, and an expression like `a + b` has a type *derived from its parts*. If `a` is `int` and `b` is `int`, then `a + b` is `int` — fine. If `a` is `int` and `b` is `string`, the language may forbid it — that's a **type error**.

```text
let a: int = 5;
let b: string = "x";
let c = a + b;   // TYPE ERROR: cannot add int and string
```

Type checking also covers function calls (right number of arguments? right types?), assignments (is the value's type assignable to the variable?), and more. The output is an AST where every expression node knows its type — sometimes called the **typed AST** or **decorated AST**.

### 7. The Output: A Decorated AST

Semantic analysis doesn't usually *transform* the tree into something new; it **decorates** it. Each name-use node gets a pointer to its declaration; each expression node gets its computed type. The next phase (IR generation / code generation) consumes this decorated tree — it relies on semantic analysis having already proven everything is valid, so it can generate code without worrying about errors.

---

## Real-World Analogies

- **Proofreading vs. fact-checking.** The parser is a proofreader: it checks grammar and punctuation. Semantic analysis is a fact-checker: the sentence "The Eiffel Tower is in Berlin" is grammatically perfect but *factually wrong*. Type errors and undefined-variable errors are the compiler's fact-check failures.

- **A guest list at a party (name resolution).** Every name a guest mentions ("I'm here to see Sara") must match someone actually invited (declared). If "Sara" isn't on any list — the main list or any side-room list — the bouncer (compiler) turns the request away: *undefined name*.

- **Nested rooms (scope).** A house has a living room, and inside it a closet. From the closet you can see things in the living room (outer scope visible from inner). From the living room you cannot see what's inside a closed closet (inner scope hidden from outer).

- **A dictionary you can stack (symbol table).** Imagine a stack of transparent sheets, each with name→meaning entries. When you enter a room you add a sheet on top; when you leave you remove it. To find a meaning you look down through the stack until you hit the first sheet that has the word.

- **Lego instructions check (type checking).** The instructions say "attach the 2x4 brick to the 2x4 plate." Type checking is the step where you confirm the piece in your hand is actually a 2x4 brick and not a wheel. Wrong piece = type error.

---

## Mental Models

**Model 1 — "Two questions per name."** For every name in the program, semantic analysis asks: (1) *What does this refer to?* (name resolution) and (2) *What type is it?* (type checking). Almost everything a junior needs to understand about this phase reduces to these two questions.

**Model 2 — "A stack of dictionaries."** Scope is a stack. Entering a block pushes a fresh dictionary; leaving pops it. Declaring a name inserts into the top dictionary. Using a name searches top-to-bottom. This one picture explains scope, shadowing, and "out of scope" errors all at once.

**Model 3 — "Decorate, don't rebuild."** Semantic analysis doesn't make a new tree. It hangs labels on the existing AST — a type on every expression, a binding on every name. By the end, the tree is *richer*, not different.

**Model 4 — "Most compile errors live here."** When you mentally categorize a compile error, ask: is it about *how it's spelled* (syntax) or *what it means* (semantics)? Undefined names, type mismatches, scope errors, calling a function with the wrong arguments — all semantic. This single reframe demystifies the compiler.

---

## Code Examples

These examples are written in pseudo-Python so you can see the *logic* of semantic analysis without language ceremony. They are deliberately tiny.

### Example 1: A flat symbol table (no scopes yet)

```python
# The simplest possible symbol table: one global dictionary.
symbols = {}

def declare(name, type_):
    if name in symbols:
        raise SemanticError(f"'{name}' already declared")
    symbols[name] = type_

def lookup(name):
    if name not in symbols:
        raise SemanticError(f"undefined variable '{name}'")
    return symbols[name]

# Walking these statements:
#   let x: int = 5
#   print(x)
#   print(y)        <-- y was never declared
declare("x", "int")     # symbols = { x: int }
lookup("x")             # OK, returns "int"
lookup("y")             # raises: undefined variable 'y'
```

This works for a program with no blocks. The moment you add `{ }` scopes, a flat dictionary breaks — because `x` inside a block can be a different `x`. That's why we need a *scoped* table.

### Example 2: A scoped symbol table (a stack of dictionaries)

```python
class ScopeStack:
    def __init__(self):
        self.scopes = [{}]          # start with one global scope

    def enter_scope(self):
        self.scopes.append({})      # push a fresh dictionary

    def exit_scope(self):
        self.scopes.pop()           # discard the innermost scope

    def declare(self, name, type_):
        top = self.scopes[-1]
        if name in top:             # redeclaration in the SAME scope is usually an error
            raise SemanticError(f"'{name}' already declared in this scope")
        top[name] = type_

    def lookup(self, name):
        # Search from innermost to outermost — this gives us shadowing for free.
        for scope in reversed(self.scopes):
            if name in scope:
                return scope[name]
        raise SemanticError(f"undefined variable '{name}'")
```

Notice that `lookup` searches **innermost first**. That single line is what makes *shadowing* work: the nearest declaration always wins.

### Example 3: Resolving names while walking the tree

```python
# Pretend the parser gave us this tree for:
#   let x = 1
#   { let y = 2; use(x); use(y) }
#   use(y)         <-- ERROR
#
# Each node is a dict with a "kind".

def analyze(node, scopes):
    kind = node["kind"]

    if kind == "Block":
        scopes.enter_scope()
        for stmt in node["body"]:
            analyze(stmt, scopes)
        scopes.exit_scope()         # y disappears here

    elif kind == "Let":
        analyze(node["value"], scopes)          # check the right-hand side first
        scopes.declare(node["name"], "int")     # then declare the name

    elif kind == "Use":
        scopes.lookup(node["name"])             # raises if undefined
```

Walk through it: `let x` declares `x` in the global scope. The `Block` pushes a new scope; `let y` declares `y` there; `use(x)` finds `x` two scopes down (fine); `use(y)` finds `y` in the top scope (fine). Then the block exits and pops the scope — `y` is gone. The final `use(y)` searches and finds nothing → **"undefined variable 'y'"**. The scope mechanics produce exactly the error a real compiler gives.

### Example 4: A tiny type checker

```python
def type_of(node, scopes):
    kind = node["kind"]

    if kind == "IntLiteral":
        return "int"
    if kind == "StringLiteral":
        return "string"

    if kind == "Name":
        return scopes.lookup(node["name"])     # type comes from the symbol table

    if kind == "Add":
        left  = type_of(node["left"], scopes)
        right = type_of(node["right"], scopes)
        if left == "int" and right == "int":
            return "int"
        if left == "string" and right == "string":
            return "string"                    # allow string concatenation
        raise SemanticError(
            f"cannot add {left} and {right}")  # the classic type error
```

This is type checking in miniature: compute the type of each subexpression *bottom-up*, then apply the rule for the operator. `5 + 3` → both `int` → `int`. `5 + "x"` → `int` and `string` → **type error**. The leaves know their types directly; everything above derives its type from its children.

### Example 5: What a real type error looks like

```text
$ compile demo.lang

demo.lang:3:9: error: cannot add `int` and `string`
    let c = a + b;
            ^ ~~~
note: `a` has type `int`   (declared at demo.lang:1)
note: `b` has type `string` (declared at demo.lang:2)
```

That diagnostic — the line, the caret pointing at the offending expression, the explanation of each operand's type — is the *output* of semantic analysis. The whole point of the phase is to produce messages like this so the programmer can fix the meaning, not just the spelling.

### Example 6: Forward references need two passes

```python
# Consider:
#   foo()                 <-- used here, BEFORE it's declared
#   func foo() { ... }    <-- declared here

# A SINGLE top-to-bottom pass would fail: at foo()'s use, foo isn't in
# the table yet. The fix is TWO passes:

def pass1_collect(program, scopes):
    # First, declare all top-level functions, ignoring their bodies.
    for item in program:
        if item["kind"] == "Func":
            scopes.declare(item["name"], "function")

def pass2_check(program, scopes):
    # Now every function name is already known, so calls resolve
    # regardless of order.
    for item in program:
        analyze(item, scopes)

# This is why you can call a function defined later in the file in
# Go, Java, C# and many others: the compiler collects declarations
# first, then checks bodies.
```

This is a junior's first taste of why semantic analysis needs **multiple passes**: forward references are impossible to resolve in one downward pass.

---

## Pros & Cons

**Pros of having a dedicated semantic-analysis phase:**

- **Catches meaning bugs early** — at compile time, before the program ever runs. Undefined names and type mismatches never reach a user.
- **Produces excellent diagnostics** — because it understands names and types, it can say *exactly* what's wrong and where.
- **Decouples concerns** — the parser only worries about grammar; later phases (codegen) trust that everything is valid. Each phase is simpler.
- **Powers tooling** — the same symbol table and type info drive autocomplete, "go to definition," and refactoring in your editor.

**Cons / costs:**

- **It's where the hard rules live**, so it's the most complex part of many compilers — scopes, types, special cases.
- **Multiple passes** can be needed (forward references, mutual recursion), which complicates the design.
- **Error recovery is genuinely hard** — after one error, the compiler must keep going to find more, without drowning you in cascading nonsense.
- **Type rules can be subtle** — subtyping, generics, and inference push this phase into deep theory (covered in later levels and the type-systems material).

---

## Use Cases

- **Every compiler and interpreter** runs semantic analysis (or a subset). Even a tiny interpreter for a calculator language resolves variable names against an environment — that's name resolution.
- **Linters and static analyzers** are essentially semantic analysis without code generation: they build symbol tables and check rules (unused variable, shadowed name, possible null).
- **IDE features** — "undefined symbol" squiggles, autocomplete, rename refactoring, "find all references" — are all driven by the symbol table and binding information.
- **Type checkers as standalone tools** — TypeScript's `tsc`, Python's `mypy`, Ruby's Sorbet — are semantic analysis bolted onto a dynamically typed language.

---

## Coding Patterns

- **The visitor pattern.** Semantic analysis walks the AST. The cleanest way to do that is a *visitor* — one method per node kind (`visit_Let`, `visit_Add`, `visit_Name`). Each method does its check and recurses into children.

- **Enter/exit scope around blocks.** Whenever you walk into a construct that introduces a scope (block, function body, loop), `enter_scope()` on the way in and `exit_scope()` on the way out. Pair them religiously — a missing `exit_scope` corrupts every lookup after it.

- **Declare-then-check the body.** For functions, *declare the name first* (so recursion and forward references work), then walk the body. Doing it in the wrong order breaks recursive functions.

- **Bottom-up typing.** Compute a node's type from its children's types. Leaves (literals, names) return their type directly; internal nodes combine them. This recursion is the spine of every type checker.

- **Collect-then-resolve for the top level.** Two passes: pass one declares all top-level names; pass two checks bodies. This is the standard fix for forward references at file scope.

---

## Clean Code

- **One responsibility per pass.** Don't try to resolve names, check types, and emit warnings all in one tangled walk. Even a junior project benefits from separating "build symbol table" from "check types."

- **Make the symbol table a real object.** Don't sprinkle raw dictionaries through your walker. A `ScopeStack` with `declare`/`lookup`/`enter`/`exit` methods keeps the scope logic in one place.

- **Always carry source locations.** Every AST node should know its line and column. Without it, your errors say "type error" with no location — useless. With it, you can point a caret at the exact spot.

- **Name your errors precisely.** "undefined variable 'foo'" is helpful; "semantic error" is not. The clarity of your diagnostics *is* the quality of your compiler from a user's perspective.

- **Don't mutate the tree destructively.** Decorate it — add a `.resolved_type` or `.binding` field — rather than replacing nodes. Later phases and error messages may still need the original shape.

---

## Best Practices

- **Resolve right-hand sides before declaring the left-hand side.** In `let x = x + 1`, the `x` on the right should refer to the *outer* `x` (or be an error), and only *after* checking the value do you declare the new `x`. Order matters.

- **Report multiple errors, not just the first.** Don't stop at the first undefined variable. Recover and keep walking so the programmer sees all their errors in one compile.

- **Use a sentinel "error type."** When an expression has a type error, give it a special `ErrorType` instead of crashing. Then `ErrorType + anything = ErrorType` with *no new error* — this stops one mistake from producing ten cascading messages.

- **Keep scopes lexical.** Match the language's `{ }` (or indentation) structure exactly. Enter a scope where the source enters one; exit where it exits.

- **Separate "declared here" from "used here" in messages.** The best diagnostics show both the use that failed *and* where the conflicting declaration lives. Carry that information in your symbol table.

---

## Edge Cases & Pitfalls

- **Use-before-declaration in the same scope.** `print(x); let x = 1;` — should this resolve `x`? In most languages, no (the variable isn't in scope yet on that line). Your walker must declare names at the right *point*, not for the whole block at once. (Note: function declarations at file scope are the exception — see two-pass.)

- **Forgetting to pop a scope.** If you `enter_scope()` but a code path skips `exit_scope()` (e.g., an early `return` in your walker), every subsequent lookup is polluted with stale names. Use try/finally or a context manager.

- **Redeclaration in the same scope.** `let x = 1; let x = 2;` in the same block is an error in many languages. But the *same name in a nested block* is legal shadowing. Your `declare` must check only the *current* (top) scope for conflicts, not the whole stack.

- **The right type but wrong direction.** Assigning `int` to a `float` variable is usually fine (widening); assigning `float` to `int` is often an error (narrowing). Type checking is not symmetric — "assignable to" has a direction.

- **Self-referential declarations.** `let x = x;` where the right `x` doesn't exist yet is an error; but `func f() { f(); }` (recursion) must work. The difference is *when* the name becomes visible — and it's why functions are declared before their bodies are checked.

---

## Common Mistakes

- **Treating syntax and semantics as the same phase.** They're separate. The parser does *not* know what `x` means; it only knows it's an identifier. Don't put type checks in the parser.

- **Using one flat symbol table for the whole program.** It works for a calculator and breaks the instant you have blocks or functions. Use a scoped table from the start.

- **Looking up names in the wrong direction.** If you search outermost-to-innermost, shadowing breaks (you'd find the outer `x` instead of the inner one). Always search innermost-first.

- **Crashing on the first error.** A compiler that dies on the first undefined variable is infuriating to use. Recover and continue.

- **Forgetting that types come from the symbol table.** A `Name` node's type isn't stored on the node — it's looked up from where the name was declared. Beginners often try to read it off the use site.

---

## Tricky Points

- **"Lexical" means "where it's written," not "when it runs."** Static/lexical scope is decided by the source layout, fully at compile time. (A few old languages used *dynamic* scope — meaning depended on the call stack at runtime — but that's rare and confusing, which is why lexical scope won.)

- **Declaration order inside a block matters; at file scope it often doesn't.** Inside a function, you usually must declare before use. At the top level of a file, the compiler collects declarations first, so you can call a function defined later. Same language, two different rules — because of two-pass analysis.

- **A type error doesn't mean the program is "wrong" in every language.** A dynamically typed language (Python, JavaScript) does *no* static type checking — `5 + "x"` is found only at runtime. Static type checking is a *choice* a language makes.

- **Shadowing is not reassignment.** `let x = 99` inside a block creates a *new* variable that hides the old one. The outer `x` is untouched. Beginners often think shadowing changes the original.

---

## Test Yourself

1. What does semantic analysis check that parsing does not?
2. What is the difference between a *declaration* and a *use* of a name?
3. Why does a symbol table need to be *scoped* instead of one flat dictionary?
4. In `let x = 1; { let x = 2; print(x); } print(x);`, what two values are printed and why?
5. Why does name lookup search innermost scope first?
6. Why does a compiler sometimes need *more than one pass* over the AST?
7. What does it mean to say the output of semantic analysis is a "decorated AST"?

<details>
<summary>Answers</summary>

1. That the program *means* something valid — names resolve to declarations, types are compatible, and language rules (scope, definite assignment, etc.) hold. Parsing only checks grammar.
2. A *declaration* introduces a name (`let x = 5`); a *use* refers to an existing name (`print(x)`). Name resolution connects uses to declarations.
3. Because the same name can refer to different things in different scopes. A flat dictionary can't distinguish an inner `x` from an outer `x`.
4. `2` then `1`. The inner `x` shadows the outer one inside the block; outside the block the outer `x` (still `1`) is visible.
5. So that shadowing works: the *nearest* enclosing declaration should win.
6. For forward references — using a name before its declaration appears (e.g., calling a function defined later). Pass one collects declarations; pass two checks bodies.
7. The AST after semantic analysis, with types attached to expression nodes and bindings attached to name uses. The next phase consumes this enriched tree.

</details>

---

## Tricky Questions

1. **In `let x = x + 1;`, what does the right-hand `x` refer to?** In most languages, the *outer* `x` (or it's an error if none exists), because the new `x` isn't in scope until after its initializer is checked. The right-hand side is resolved *before* the left-hand name is declared.

2. **Can two variables in the same program have the same name?** Yes — in different scopes. `count` in one function and `count` in another are completely separate symbols. Scope is what keeps them apart.

3. **Why can you call a function before it's defined in Java but not always reference a local variable before it's declared?** Because the compiler does a *separate pass* to collect all method/field declarations at class scope before checking bodies, but local variables inside a method follow strict top-to-bottom declaration order.

4. **Is "undefined variable" a syntax error or a semantic error?** Semantic. The grammar is fine — `print(zog)` parses perfectly. It's only when name resolution fails to find `zog` that the error appears.

5. **If a language has no static types, does it still do semantic analysis?** Yes — it still resolves names and checks rules like "break outside a loop." It just defers *type* checking to runtime.

---

## Cheat Sheet

```text
SEMANTIC ANALYSIS — the phase AFTER parsing

  Goal:  syntactically correct  →  semantically VALID
         (the parser's tree)        (a tree that MEANS something)

  TWO BIG JOBS
  ┌──────────────────────────┬──────────────────────────────┐
  │ Name resolution          │ Type checking                │
  │ "what does this refer to?"│ "do the types fit?"          │
  │ uses → declarations       │ int+int=int, int+string=ERR  │
  │ needs a SYMBOL TABLE      │ walk tree BOTTOM-UP           │
  └──────────────────────────┴──────────────────────────────┘

  SCOPE = where a declaration is visible
    lexical/static: decided by where code is WRITTEN
    inner can see outer; outer cannot see inner
    shadowing: nearest declaration wins

  SYMBOL TABLE = stack of dictionaries
    enter_scope() push   |  declare() insert into top
    exit_scope()  pop     |  lookup()  search top → bottom

  MULTIPLE PASSES when needed (forward references):
    pass 1: collect declarations
    pass 2: check bodies

  OUTPUT: a DECORATED / TYPED AST
    every name-use → binding;  every expression → type

  MOST COMPILE ERRORS LIVE HERE:
    "undefined variable"  |  "type mismatch"  |  "not in scope"
    "wrong number of arguments"  |  "x is not initialized"
```

---

## Summary

- **Semantic analysis** is the compiler phase after parsing. It checks that a syntactically correct program is also **semantically valid** — that it *means* something.
- The two central jobs are **name resolution** (connecting each *use* of a name to its *declaration*) and **type checking** (verifying types fit).
- **Scope** is the region where a declaration is visible. Lexical (static) scope — the default — is decided by where code is written. Inner scopes see outer ones; not vice versa. The nearest declaration wins, giving us **shadowing**.
- The **symbol table** makes name resolution possible. Mentally it's a **stack of dictionaries**: push on entering a scope, pop on leaving, declare into the top, look up from top to bottom.
- **Type checking** walks the tree **bottom-up**: literals know their type, and each operator derives its result type from its operands. Incompatible types produce a **type error**.
- Semantic analysis sometimes needs **multiple passes** — most commonly to handle **forward references** (using a name before its declaration appears).
- The output is a **decorated AST** — the same tree, now annotated with types and resolved bindings — which the next phase (IR/code generation) consumes.
- **Most compile errors you've ever seen are semantic errors**, not syntax errors: undefined variable, type mismatch, out of scope, wrong arguments. This phase is where they come from.

---

## What You Can Build

- **A name resolver for a tiny language.** Given an AST with `let`, blocks, and uses, walk it with a scope stack and report every undefined variable. Test it on programs with nested blocks and shadowing.
- **A calculator with variables.** Support `let x = ...` and expressions. Resolve names against a symbol table; report "undefined variable" for typos. This is name resolution in its smallest honest form.
- **A type checker for arithmetic + strings.** Add types (`int`, `string`, `bool`) and reject `int + string`, `if` with a non-bool condition, etc. Produce a clear error with a line number.
- **A "scope visualizer."** Walk a program and print the scope tree — which names are declared in which scope, and which uses resolve to which declarations. Great for *seeing* shadowing.
- **A redeclaration checker.** Flag `let x; let x;` in the same scope as an error, but allow shadowing in a nested block. Getting this exactly right teaches you "current scope vs. enclosing scope."

---

## Further Reading

- *Crafting Interpreters* — Robert Nystrom. The chapters "Resolving and Binding" and "Types" are the clearest junior-level treatment of name resolution and a tree-walking checker anywhere. https://craftinginterpreters.com/
- *Compilers: Principles, Techniques, and Tools* ("The Dragon Book") — Aho, Lam, Sethi, Ullman. Chapter 2 (a simple syntax-directed translator) and the semantic-analysis chapter.
- *Engineering a Compiler* — Cooper & Torczon. Strong, practical chapters on scopes and symbol tables.
- *Writing An Interpreter In Go* — Thorsten Ball. Builds an evaluator with an environment (runtime name resolution) you can read in an afternoon.
- *Modern Compiler Implementation in ML/Java/C* — Andrew Appel. The "Semantic Analysis" chapter and its symbol-table treatment.
- Your favorite compiler's error messages — read them as *documentation of semantic rules*. Try to predict what triggers each one.

---

## Related Topics

- The previous phase is **parsing**, which produces the AST that semantic analysis walks. Without a tree, there is nothing to analyze.
- The deeper theory of types — type inference, subtyping, generics, soundness — lives in the **type-systems** material; type *checking* here is its practical front line.
- The next phase is **intermediate-representation (IR) generation**, which consumes the decorated AST that semantic analysis produces.
- **Runtime systems** handle the runtime side of names (environments, dynamic scope, late binding) — the dynamic cousin of the static name resolution done here.
- Tooling such as **linters and static analyzers** are essentially semantic analysis without code generation.

---

## Diagrams & Visual Aids

### The Place of Semantic Analysis in the Pipeline

```text
  source text
      │
      ▼
   ┌───────┐   characters → tokens
   │ Lexer │
   └───────┘
      │
      ▼
   ┌────────┐  tokens → AST  (proves: SYNTAX ok)
   │ Parser │
   └────────┘
      │
      ▼
   ┌────────────────────┐  AST → DECORATED AST
   │ Semantic Analysis  │  (proves: MEANING ok)
   │  • name resolution │
   │  • type checking   │
   │  • other rules     │
   └────────────────────┘
      │
      ▼
   ┌──────────┐  decorated AST → IR → machine code
   │ Codegen  │
   └──────────┘
```

### A Scope Stack While Walking a Program

```text
Program:
  let a = 1
  {                       <- enter scope
    let b = 2
    use(a)   ── resolves ──┐
    use(b)   ── resolves ──┤
  }                       <- exit scope (b gone)
  use(b)   <- ERROR: undefined

Symbol-table state:

  before block:   [ {a:int} ]
  inside block:   [ {a:int}, {b:int} ]      <- two dictionaries
  lookup(a) ──────────────┘     ▲
  lookup(b) ────────────────────┘ found in top
  after block:    [ {a:int} ]               <- popped; b is gone
  lookup(b) → searches all → not found → ERROR
```

### Bottom-Up Type Checking of `a + b`

```text
                (Add)  → type = int        rule: int + int = int
               /     \
          (Name a)   (Name b)
          type=int   type=int              looked up from symbol table

If b were a string:

                (Add)  → TYPE ERROR: cannot add int and string
               /     \
          (Name a)   (Name b)
          type=int   type=string
```

### Use → Declaration Arrows (Name Resolution)

```text
  let count = 0;          ●  declaration
       ▲   ▲
       │   │
  count = count + 1;      uses, each resolved back to the declaration
   │
   └─ print(count);       another use → same declaration
```
