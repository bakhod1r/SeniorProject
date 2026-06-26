# DSLs via Metaprogramming — Middle Level

> **Topic:** [DSLs via Metaprogramming](README.md)
> **Focus:** Operator overloading to build expression trees, and lambdas-with-receiver for nested, type-safe builders (`html { body { ... } }`). The middle band of techniques between fluent chaining and macros.

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
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction

> Focus: **How do you make `User.age > 21` build a query instead of return a boolean, and how do `html { body { ... } }` style nested builders actually work?**

In `junior.md` we built internal DSLs with two techniques: **method chaining** (return `self`) and **blocks** (hand the library a closure to run). Those get you fluent builders and `do ... end` configuration. But the most expressive DSLs you use — SQLAlchemy's `User.age > 21`, pandas' `df[df.price > 100]`, Kotlin's `html { body { ... } }`, Gradle's Kotlin DSL — rely on two more powerful techniques that this page is about:

- **Operator overloading.** You redefine what `+`, `>`, `[]`, or `==` *mean* for your types, so an expression like `User.age > 21` does not evaluate to `True`/`False` — it **builds a data structure** (an expression tree) describing the comparison. The DSL captures the *shape* of the expression rather than its result.
- **Lambdas with receiver** (Kotlin's "type-safe builders"). A block runs with a specific object as its implicit `this`, so inside `html { ... }` the calls `body { ... }` and `p("Hello")` resolve against an `Html` builder — nested, type-checked, with full IDE autocomplete. This is the modern, statically-typed evolution of Ruby's `instance_eval`.

The thread connecting both: a DSL is really a way to **capture intent as data** and interpret it later. Operator overloading captures expressions as trees you can compile to SQL or differentiate for gradients. Receiver-lambdas capture nested structure (HTML, UI, config) as a tree of builder calls. Once you see "the DSL is building a tree, and something walks that tree later," most production DSLs stop looking like magic.

> 🎓 **Why this matters at the middle level:** These are the techniques behind the ORMs, dataframes, and UI toolkits you build features on every day. Understanding *that* `User.age > 21` returns a query object — not a boolean — explains a whole class of "why doesn't `and`/`if` work here?" bugs, and lets you extend these libraries instead of fighting them.

This page covers: operator overloading to build expression trees (Python `__gt__`/`__and__`, the boolean-coercion trap), how query DSLs compile those trees to SQL, Kotlin's lambdas-with-receiver and `@DslMarker`, Groovy/Scala flavors in brief, and the design tension of "host syntax fighting the domain." `senior.md` then covers compile-time, macro-based DSLs (Rust `html!`, `sqlx::query!`) and DSL design as a discipline.

---

## Prerequisites

What you should know before reading this:

- **Required:** Everything in `junior.md`: internal vs external DSLs, method chaining/builders, blocks/closures.
- **Required:** Comfort with classes, methods, and operators in at least one language (Python and/or Kotlin used heavily here).
- **Required:** What an **expression tree / AST** is at a basic level — a tree where `a > b` is a node with children `a` and `b`. We re-explain it.
- **Helpful but not required:** Prior use of an ORM (SQLAlchemy, Django ORM, Exposed) or a dataframe library (pandas). You have seen these DSLs.
- **Helpful but not required:** Familiarity with Kotlin lambdas and extension functions. We explain receivers from scratch.

You do **not** need to know:

- Macros or compile-time code generation (that is `senior.md`).
- How a real SQL engine parses or optimizes (compilers territory).
- Type-system theory; we use types pragmatically.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Operator overloading** | Defining what built-in operators (`+`, `>`, `[]`, `==`) do for your own types. |
| **Expression tree** | A tree data structure representing an expression: `User.age > 21` becomes a `Gt(Column("age"), Literal(21))` node. |
| **Deferred / lazy evaluation** | The DSL builds a description now and runs it later, instead of computing a value immediately. |
| **Column object** | An object standing in for a database column (`User.age`) whose overloaded operators build query fragments. |
| **Boolean coercion** | The implicit conversion of an object to `True`/`False` (Python `__bool__`). A trap for expression-building DSLs. |
| **Lambda with receiver** | (Kotlin) a function type `T.() -> R` whose body runs with a `T` as its implicit `this`. The engine of type-safe builders. |
| **Receiver** | The object that is the implicit `this` inside a block; in `html { }`, the receiver is the `Html` builder. |
| **Extension function** | A function defined "on" a type from outside it: `fun StringBuilder.shout() = append("!")`. Underpins builder DSLs. |
| **`@DslMarker`** | A Kotlin annotation that stops inner blocks from accidentally calling outer-receiver methods, removing a class of nesting bugs. |
| **Builder type** | A throwaway object that collects nested structure (tags, columns, tasks) and renders or returns the result. |
| **Infix notation** | Calling a method *between* operands without dots/parens: Kotlin/Scala `a shouldBe b`. Makes DSLs read like operators. |
| **By-name parameter** | (Scala) an argument evaluated each time it is used, not once at the call — lets a DSL control *when* a block runs. |
| **Compile to SQL** | Walking the expression tree the DSL built and emitting a SQL string + bound parameters. |

---

## Core Concepts

### 1. Operator Overloading Captures Expressions as Data

In a normal program, `age > 21` computes a boolean *right now*. In a query DSL, `User.age > 21` must instead produce a **description** of the comparison — a small object — because you want to send `WHERE age > 21` to the database, not evaluate it in Python against nothing.

The trick is to make `User.age` an **object** (a `Column`) whose comparison operators are overloaded to **build nodes** instead of returning booleans:

```python
class Column:
    def __init__(self, name):
        self.name = name

    def __gt__(self, other):     # User.age > 21  ->  this runs
        return Gt(self, other)   # returns a NODE, not True/False

    def __eq__(self, other):
        return Eq(self, other)

    def __and__(self, other):    # cond1 & cond2
        return And(self, other)


class Gt:
    def __init__(self, left, right):
        self.left, self.right = left, right

class Eq:  # ...same shape
    def __init__(self, left, right): self.left, self.right = left, right

class And:
    def __init__(self, left, right): self.left, self.right = left, right
```

Now `User.age > 21` evaluates to `Gt(Column("age"), 21)` — an **expression tree node**. The DSL captured the *shape* of the comparison. Later, a separate function walks the tree and emits SQL. This is exactly how SQLAlchemy, Django's `Q` objects, and pandas masks work.

### 2. Walk the Tree to Compile It

Once the expression is a tree of objects, "running" the DSL means **traversing the tree** and producing output — SQL text, a NumPy mask, a gradient. Compiling our nodes to SQL:

```python
def to_sql(node):
    if isinstance(node, Column):
        return node.name, []
    if isinstance(node, (int, str)):
        return "?", [node]                 # parameterized -> no SQL injection
    if isinstance(node, Gt):
        l, lp = to_sql(node.left)
        r, rp = to_sql(node.right)
        return f"({l} > {r})", lp + rp
    if isinstance(node, And):
        l, lp = to_sql(node.left)
        r, rp = to_sql(node.right)
        return f"({l} AND {r})", lp + rp
    raise TypeError(node)

expr = (Column("age") > 21) & (Column("active") == True)
sql, params = to_sql(expr)
# ("((age > ?) AND (active = ?))", [21, True])
```

The DSL split cleanly into two halves: **build the tree** (operator overloading) and **interpret the tree** (a walker). Almost every expression DSL has this shape. Parameterizing literals as `?` is also where these DSLs *earn their keep* — they prevent SQL injection by construction.

### 3. The Boolean-Coercion Trap

Here is the trap that bites everyone the first time. Because `User.age > 21` returns an *object*, Python's `and`, `or`, and `if` do the wrong thing:

```python
# WRONG — Python's `and` calls __bool__ on the left operand and short-circuits:
(User.age > 21) and (User.active == True)   # returns just the RIGHT object!

# Python evaluates the left node's truthiness, finds it "truthy",
# and returns the right node — your AND is silently lost.
```

Python's keyword operators (`and`, `or`, `not`, `if`) are **not overloadable**; they coerce operands to bool. That is why these DSLs use the *bitwise* operators `&`, `|`, `~` (which *are* overloadable via `__and__`, `__or__`, `__invert__`) — and why you must wrap operands in parentheses, because `&` binds tighter than `>`:

```python
# RIGHT:
(User.age > 21) & (User.active == True)
```

SQLAlchemy, pandas, and Django all require `&`/`|` for exactly this reason. A subtler defense: override `__bool__` to raise, so `if User.age > 21:` fails loudly instead of silently lying.

### 4. Lambdas with Receiver: Type-Safe Nested Builders

Kotlin's headline DSL feature is the **lambda with receiver**, type `T.() -> Unit`. It is a block whose *implicit `this`* is a `T`. This is the statically-typed cousin of Ruby's `instance_eval` — but with full type checking and IDE autocomplete.

```kotlin
class Html {
    private val children = mutableListOf<String>()
    fun body(init: Body.() -> Unit) {       // takes a Body-receiver lambda
        val b = Body()
        b.init()                            // run block with `b` as `this`
        children += b.render()
    }
    fun render() = "<html>${children.joinToString("")}</html>"
}

class Body {
    private val children = mutableListOf<String>()
    fun p(text: String) { children += "<p>$text</p>" }
    fun render() = "<body>${children.joinToString("")}</body>"
}

fun html(init: Html.() -> Unit): Html {
    val h = Html()
    h.init()
    return h
}

val page = html {           // `this` is an Html here
    body {                  // `this` is a Body inside this block
        p("Hello")          // resolves to Body.p
        p("World")
    }
}
// <html><body><p>Hello</p><p>World</p></body></html>
```

Each `{ ... }` runs with a different receiver, so the call resolves to the right builder *and the compiler checks it*. This is how Kotlin HTML, Gradle's Kotlin DSL, Ktor routing, and (conceptually) Jetpack Compose let you write nested structure that reads like markup yet is fully typed.

### 5. `@DslMarker`: Stop Nesting Bugs

Receiver-lambda nesting has one nasty footgun: inside the inner `body { }`, the *outer* `Html` receiver is still in scope, so you could accidentally call `body { body { ... } }` (the inner `body` resolving to the outer `Html`). Kotlin fixes this with `@DslMarker`:

```kotlin
@DslMarker annotation class HtmlDsl

@HtmlDsl class Html { /* ... */ }
@HtmlDsl class Body { /* ... */ }
```

Now the compiler forbids calling an *outer* receiver's members from an inner scope of the same marker. The bug becomes a compile error. This is a small but important sign of DSL maturity: the language gives you tools to make the DSL safe, not just pretty.

### 6. Other Hosts, Same Ideas (Scala, Groovy)

- **Scala** leans on **implicits** (auto-supplied conversions/parameters), **infix** method calls (`a should be (b)`), and **by-name parameters** (`def whenReady(body: => T)`) so a block runs lazily and possibly multiple times. ScalaTest and Akka config DSLs combine these.
- **Groovy** builders use dynamic `methodMissing`/`propertyMissing` plus closures with a *delegate* (Groovy's receiver). The original Gradle build DSL is a Groovy builder; `MarkupBuilder` generates XML/HTML the same way.

Different syntax, identical mental model: **capture structure or expressions, interpret later.**

---

## Real-World Analogies

**A blueprint vs. the building.** `User.age > 21` is a blueprint of a comparison, not the comparison itself. Operator overloading hands you a blueprint (the tree); a separate builder (`to_sql`) constructs the real thing later. DSLs that defer evaluation are always blueprint-makers.

**A stencil set.** Lambdas-with-receiver are nested stencils: the outer stencil (`html`) frames the page, an inner stencil (`body`) frames a region, and inside each you can only draw shapes that stencil allows. `@DslMarker` is the rule that you cannot reach through the inner stencil to scribble on the outer one.

**Sign language vs. spoken words.** Operator overloading reuses familiar gestures (`>`, `&`) to mean something domain-specific. It is powerful precisely because readers already know the gestures — but dangerous when the gesture *almost* means the usual thing (the `and`-vs-`&` trap is exactly this near-miss).

---

## Mental Models

**Model 1: "Operators are constructors in disguise."** When you overload `>`, you are not comparing — you are *constructing a node*. Read `a > b` in a DSL as `Gt(a, b)`. Every overloaded operator is a hidden constructor.

**Model 2: "Build a tree now, walk it later."** Separate the two phases in your head: phase one assembles a tree (overloading, receiver-lambdas); phase two interprets it (compile to SQL, render HTML, compute gradients). Bugs usually live in exactly one phase — find which.

**Model 3: "The receiver is the room you are standing in."** Inside a receiver-lambda, unqualified calls resolve against the current receiver. `html { body { p(...) } }` is "stand in the html room, step into the body room, call `p` (which only the body room offers)." `@DslMarker` locks the door behind you.

**Model 4: "The host's grammar is a fixed budget."** You cannot invent syntax in an internal DSL — only repurpose what the host allows. Python gives you `&` but not custom keywords; Kotlin gives you trailing-lambda `{ }` but not arbitrary infix symbols. Good DSL design is spending that fixed budget where it buys the most readability.

---

## Code Examples

### Example 1: A pandas-style mask (operator overloading you already use)

```python
import numpy as np

class Series:
    def __init__(self, data): self.data = np.array(data)
    def __gt__(self, n):  return Series(self.data > n)   # elementwise -> mask
    def __and__(self, o): return Series(self.data & o.data)
    def __getitem__(self, mask): return self.data[mask.data]

price = Series([50, 150, 90, 200])
expensive = price[(price > 100)]      # array([150, 200])
```

This is precisely why pandas requires `df[(df.a > 1) & (df.b < 2)]` with parentheses and `&`: `df.a > 1` is a *mask object*, and Python's `and` would mis-handle it. Same trap, same fix as the query DSL.

### Example 2: A fluent + operator-tree query DSL combined

```python
class Table:
    def __init__(self, name): self.name = name
    def __getattr__(self, col): return Column(f"{self.name}.{col}")

class Query:
    def __init__(self, table): self.table, self._where = table, None
    def where(self, expr):
        self._where = expr
        return self
    def sql(self):
        base = f"SELECT * FROM {self.table.name}"
        if self._where is None: return base, []
        cond, params = to_sql(self._where)
        return f"{base} WHERE {cond}", params

User = Table("users")
q = Query(User).where((User.age > 21) & (User.active == True))
print(q.sql())
# ('SELECT * FROM users WHERE ((users.age > ?) AND (users.active = ?))', [21, True])
```

Two techniques cooperating: **chaining** for the query skeleton, **operator overloading** for the predicate. This division — fluent for structure, operators for expressions — is the SQLAlchemy/jOOQ blueprint.

### Example 3: Kotlin type-safe builder with marker (sketch)

```kotlin
@DslMarker annotation class FormDsl

@FormDsl class Form {
    val fields = mutableListOf<String>()
    fun text(name: String, init: Field.() -> Unit = {}) {
        val f = Field(name, "text"); f.init(); fields += f.render()
    }
    fun render() = "<form>${fields.joinToString("")}</form>"
}

@FormDsl class Field(val name: String, val type: String) {
    var required = false
    fun render() = "<input name='$name' type='$type'${if (required) " required" else ""}>"
}

fun form(init: Form.() -> Unit) = Form().apply(init).render()

val html = form {
    text("email") { required = true }
    text("nickname")
}
// <form><input name='email' type='text' required><input name='nickname' type='text'></form>
```

Note `Form().apply(init)`: `apply` is itself a standard-library function taking a receiver-lambda — the same mechanism, used to build the DSL entry point.

### Example 4: Scala-flavored infix matcher (sketch)

```scala
// `result shouldBe 42` reads like a sentence because `shouldBe` is an infix method.
implicit class ShouldOps[A](val actual: A) {
  def shouldBe(expected: A): Unit =
    if (actual != expected) throw new AssertionError(s"$actual != $expected")
}

42 shouldBe 42         // infix call, no dots/parens
```

The `implicit class` auto-wraps any value so `actual shouldBe expected` compiles. This is ScalaTest's readability engine in miniature: implicits + infix.

---

## Pros & Cons

**Pros**

- **Expression DSLs are extremely concise.** `df[(df.a > 1) & (df.b < 2)]` packs filter logic that would be a verbose loop into one readable line.
- **Deferred trees are portable.** Because the DSL builds *data*, you can compile the same expression to SQL, to an in-memory filter, or to an optimizer's plan.
- **Receiver-lambdas give nesting + type safety + autocomplete.** Kotlin builders read like markup yet the compiler checks every call and the IDE completes it.
- **Operators reuse knowledge.** Readers already understand `>`, `+`, `&`; a well-chosen overload needs no new vocabulary.

**Cons**

- **Near-miss operators mislead.** When `>` *almost* behaves normally, the `and`-vs-`&` and short-circuit traps produce silent wrong results, not errors.
- **Overloading can be abused.** Operators with surprising meanings (`<<` for "append to query"?) hurt readability more than they help.
- **Tree-building DSLs are harder to debug.** A wrong query is a wrong *tree*; you must inspect the structure, not a stack trace.
- **Receiver scoping is subtle.** Without `@DslMarker`, nested builders silently resolve to the wrong receiver. The fix exists but must be remembered.

---

## Use Cases

- **Querying:** SQLAlchemy, Django `Q`, jOOQ, LINQ, Exposed — operator-overloaded predicates + fluent chaining, compiled to SQL.
- **Dataframes / arrays:** pandas, Polars, NumPy masks — overloaded comparison/arithmetic build vectorized operations.
- **Autograd / math:** deep-learning frameworks overload `+`, `*`, `@` to build a computation graph they later differentiate. (The "build a tree, walk it later" model, applied to gradients.)
- **Markup / UI:** Kotlin HTML, Jetpack Compose, Ktor routing — receiver-lambdas nest structure with type safety.
- **Configuration:** Gradle Kotlin DSL, server/route config — receiver-lambdas, often the typed successor to a Groovy/Ruby block DSL.

---

## Coding Patterns

**Pattern: overloaded operator returns a node, never a value.** Comparison/arithmetic operators in an expression DSL construct tree nodes. Keep them pure and side-effect free.

**Pattern: two-phase split — build then interpret.** Phase one (overloading/receivers) builds a tree; phase two (a walker) interprets it. Keep them in separate functions/classes so each is testable alone.

**Pattern: parameterize literals on the interpret side.** When compiling to SQL, emit `?` placeholders and collect bound params — never string-interpolate user values. The DSL becomes an injection-prevention boundary.

**Pattern: guard boolean coercion.** Override `__bool__` to raise in Python expression DSLs so `if expr:` fails loudly. Require `&`/`|` and document it.

**Pattern: one builder type per nesting level (Kotlin).** `Html`, `Body`, `Field` — each level gets its own receiver type, marked with the same `@DslMarker`, so calls resolve correctly and the IDE guides users.

---

## Best Practices

- **Only overload operators whose domain meaning matches their usual meaning.** `>` for a comparison predicate: good. `+` for "merge two queries": questionable. Surprise is the enemy.
- **Force the safe operators and explain why.** Require `&`/`|` and parentheses; put the boolean-coercion trap in your README. Users *will* hit it otherwise.
- **Make trees inspectable.** Give nodes a readable `__repr__` so a developer can print an expression and see its structure when debugging.
- **Always `@DslMarker` your Kotlin builders.** It costs one annotation and prevents an entire class of silent nesting bugs.
- **Keep receiver builders cheap and throwaway.** They should accumulate and render, not hold long-lived state or perform I/O mid-build.
- **Decide where evaluation happens and make it obvious.** A clear terminal step (`.sql()`, `render()`, `build()`) signals "the tree is done; now we interpret it."

---

## Edge Cases & Pitfalls

- **`and`/`or`/`if` on expression objects (Python).** They coerce to bool and silently drop logic. Use `&`/`|`/`~`, parenthesize, and consider raising from `__bool__`.
- **Operator precedence surprises.** `&` binds tighter than `>`, so `a > 1 & b` parses as `a > (1 & b)`. Always parenthesize each predicate.
- **`__eq__` overload breaks hashing/sets.** If `Column.__eq__` returns a node (not a bool), the object is no longer usable as a dict key or in a set unless you also handle `__hash__`. Be deliberate.
- **NaN and three-valued logic leak in.** Dataframe/SQL comparisons with nulls/NaN do not behave like Python booleans; the DSL inherits the domain's logic, surprising users who expect Python semantics.
- **Receiver shadowing without `@DslMarker`.** Inner blocks can call outer-receiver methods, producing structurally wrong output with no error. Mark every builder.
- **Receiver-lambda capture leaks.** A `Html.() -> Unit` block can close over outer variables and mutate them; long-lived builders that retain such lambdas can leak memory or state.
- **Stringly-typed escape hatches.** When the operator DSL cannot express something (a weird SQL function), users drop to raw strings — reopening the injection hole the DSL was meant to close. Provide a safe, parameterized escape hatch.
- **Over-overloading.** A DSL that redefines ten operators with clever meanings becomes write-only. Restraint reads better than cleverness.

---

## Cheat Sheet

| Idea | One-liner |
|------|-----------|
| Operator overloading | Redefine `>`, `&`, `[]` to *build nodes*, not compute values. |
| Expression tree | `User.age > 21` → `Gt(Column("age"), 21)`. |
| Two-phase DSL | Build the tree, then walk it to emit SQL/HTML/gradients. |
| Boolean-coercion trap | `and`/`or`/`if` aren't overloadable → use `&`/`|`/`~` + parens. |
| `__bool__` raise | Makes `if expr:` fail loudly instead of lying. |
| Parameterize on interpret | Emit `?` + bound params → injection-safe by construction. |
| Lambda with receiver | `T.() -> Unit`: block's `this` is a `T`. Kotlin builder engine. |
| `@DslMarker` | Compiler bans calling outer receivers from inner scope. |
| Scala flavor | implicits + infix (`a shouldBe b`) + by-name params. |
| Pick safe overloads | Overload only where domain meaning ≈ usual meaning. |

---

## Summary

The middle band of internal-DSL techniques is **operator overloading** and **lambdas-with-receiver**. Operator overloading turns expressions like `User.age > 21` into **expression trees** — data you interpret later by walking the tree to emit SQL, render a mask, or build a gradient graph. The recurring shape is *build a tree now, interpret it later*, and the recurring trap is **boolean coercion**: Python's `and`/`or`/`if` are not overloadable, so expression DSLs use `&`/`|`/`~` with parentheses. The interpret phase is also where these DSLs earn their keep, by parameterizing literals and preventing injection.

**Lambdas with receiver** (Kotlin `T.() -> Unit`) are the statically-typed evolution of Ruby's `instance_eval`: a block runs with a chosen object as its implicit `this`, giving nested builders (`html { body { ... } }`) that are type-checked and autocompleted. `@DslMarker` closes the nesting footgun where inner blocks reach the wrong receiver. Scala (implicits, infix, by-name) and Groovy (delegate closures) reach the same destination by other roads. The next tier, `senior.md`, pushes into **macros**: DSLs validated at *compile time* (Rust's `html!`, `sqlx::query!`) and the broader discipline of DSL design.

---

## Further Reading

- SQLAlchemy Core "Expression Language" docs — the reference implementation of operator-overloaded query DSLs; read how `Column` builds clauses.
- Kotlin documentation, "Type-safe builders" — the canonical lambda-with-receiver walkthrough, including the HTML example.
- The pandas indexing/boolean-mask docs — see the `&`/`|`/parentheses rule explained from the user's side.
- Martin Fowler, *Domain-Specific Languages*, chapters on "Expression Builder" and "Closure" — the pattern names behind these techniques.
