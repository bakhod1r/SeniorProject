# What Metaprogramming Is — Junior Level

> **Topic:** [What Metaprogramming Is](README.md)
> **Focus:** Programs that read, write, or transform programs (sometimes themselves). What that actually means, and the one question that organizes the whole field: *when does the meta-code run?*

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
15. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What does it mean for a program to treat another program — or itself — as data?** And **why does almost everything you call a "framework" secretly do this?**

Most code you have written so far treats *data* as the thing it manipulates: numbers, strings, lists, rows from a database. **Metaprogramming** is what happens when the thing being manipulated *is code itself*. A metaprogram is a program whose input or output is another program (or a description of one), or that inspects and changes its own structure while running.

That sounds abstract until you notice you have already used it dozens of times without naming it:

- When you write `@app.route("/users")` above a Python function and a web request magically arrives at it, **a decorator read your function and wrapped it**.
- When Java's Spring sees `@Autowired` on a field and fills it in with the right object, **the framework used reflection to inspect your class at runtime and inject a value you never wrote code to assign**.
- When you run `protoc` or `go generate` and a `.go` file full of struct definitions appears, **a code generator wrote source for you**.
- When Rust's `#[derive(Debug)]` makes your struct printable without you writing a single line of the printing logic, **a macro generated that code at compile time**.

Every one of those is metaprogramming. The field is just the collection of techniques for *programs operating on programs*.

In one sentence: **metaprogramming is code about code.** The ordinary program is the "base level" — it does the actual work. The metaprogram is the "meta level" — it generates, inspects, or rewrites the base level.

> 🎓 **Why this matters for a junior:** You do not have to *build* a metaprogramming framework in your first year. But you will *use* them constantly — every annotation, every decorator, every generated stub, every ORM. The moment something "works by magic," that magic is almost always metaprogramming. Learning to see it turns mysterious behavior into something you can reason about, debug, and trust.

This page is the front door to the whole `metaprogramming` section. It gives you the vocabulary (reflection, macros, code generation, annotations, and friends) and the *single most important organizing idea*: **the meta level runs at some specific time — either while you build the program (compile-time) or while it runs (runtime) — and that timing decides almost everything about the trade-offs.** Later topics in this section go deep on each technique: reflection, annotations and decorators, build-time code generation, macros, metaclasses, dynamic proxies, and DSLs. Here, we just learn what they all have in common.

---

## Prerequisites

What you should know before reading this:

- **Required:** You can write and run a small program with functions in at least one language (Python, Java, Go, JavaScript, Rust, or C++).
- **Required:** You know what a function, a class/struct, and a variable are.
- **Required:** You have a rough idea of the difference between *compiling/building* a program and *running* it. (Even interpreted languages have a "load and parse" phase before "run.")
- **Helpful but not required:** You have seen an annotation (`@Override`, `@app.route`) or a decorator and wondered how it works.
- **Helpful but not required:** You know a program is stored as text (source code) before it becomes something the machine executes.

You do **not** need to know:

- How a compiler is built, or what an AST is in detail (later topics cover this).
- How reflection or macros are *implemented* — that comes in `reflection.md`, `macros.md`, and the rest of this section.
- Type theory, bytecode, or any specific framework's internals.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Base level** | The ordinary program that does the real work — your business logic. |
| **Meta level** | Code that operates on the base level: generating it, inspecting it, or rewriting it. |
| **Metaprogramming** | The practice of writing code that reads, generates, or transforms code (including itself). |
| **Reflection / Introspection** | A program *examining its own structure at runtime* — asking "what fields does this object have? what methods? what type is this?" |
| **Intercession** | A program *modifying* its own behavior or structure at runtime, not just observing it. (Reflection = look; intercession = change.) |
| **Code generation** | Producing source code (or lower-level code) as the *output* of a program, usually before compilation. |
| **Macro** | A construct the compiler expands into other code *before* the program is fully compiled. Code that writes code, at build time. |
| **Annotation / Attribute / Decorator** | A label attached to code (`@Override`, `@route`, `#[derive]`) that some tool reads and acts on. |
| **Metaclass** | In some languages (notably Python), the "class of a class" — code that controls how classes themselves are built. |
| **Dynamic proxy** | An object created at runtime that stands in for another and intercepts calls to it. |
| **`eval` / `exec`** | A function that takes a string of source code and runs it *as code* at runtime. The bluntest metaprogramming tool. |
| **Homoiconicity** | A property of some languages (Lisp) where *code is written in the same structure as data*, so manipulating code is as easy as manipulating a list. |
| **Compile-time / build-time** | The phase *before the program runs*, when source is turned into something executable. |
| **Runtime** | The phase *while the program runs*. |
| **Quoting** | Treating a piece of code as *data* (a value you can pass around) instead of running it. |
| **Generated code** | Source that a tool wrote, not a human. Usually marked "DO NOT EDIT." |

---

## Core Concepts

### 1. Code Is Just Data (If You Look At It Right)

The deepest idea in metaprogramming is this: **a program is data.** Your source file is a text file — a string. After parsing, it becomes a tree of objects describing functions, calls, and expressions. At runtime, a class is itself an object with a list of methods and fields. Once you see code as data, you can do to it everything you do to data: read it, search it, copy it, transform it, and produce more of it.

Ordinary programming:

```text
data  ──►  [your program]  ──►  result
```

Metaprogramming:

```text
code  ──►  [meta-program]  ──►  more code   (or)   behavior
```

The "data" flowing through a metaprogram *is itself a program*.

### 2. The Central Question: WHEN Does the Meta Level Run?

This is the single most useful thing to learn on this page. Every metaprogramming technique runs the meta level at one of two times:

- **Compile-time / build-time** — the meta-code runs *before* your program runs, while it is being built. The output is baked into the final program. Examples: macros, C++ templates, annotation processors, code generators (`go generate`, `protoc`), Rust's `#[derive]`.
- **Runtime** — the meta-code runs *while* your program is running. Examples: reflection, Python decorators that inspect at import time, metaclasses, dynamic proxies, monkeypatching, `eval`/`exec`.

```text
            BUILD                          RUN
  ┌────────────────────────┐   ┌──────────────────────────┐
  │ macros                 │   │ reflection / introspection│
  │ C++ templates          │   │ metaclasses               │
  │ annotation processors  │   │ dynamic proxies           │
  │ code generators        │   │ monkeypatching            │
  │ Rust #[derive]         │   │ eval / exec               │
  └────────────────────────┘   └──────────────────────────┘
      "decided already"            "decided as it runs"
```

Why does the *when* matter so much? Because it decides:

- **Speed:** Compile-time meta-code has zero runtime cost — the work is already done. Runtime meta-code costs you something on every call.
- **Safety:** Compile-time tools can catch mistakes before you ship. Runtime tools fail when the user is watching.
- **Flexibility:** Runtime tools can react to information you only have *while running* (the actual data, config, plugins loaded). Compile-time tools only know what was true at build.

Keep this axis in your head for the entire section.

### 3. Introspection vs Intercession (Look vs Change)

Two flavors of reflective metaprogramming:

- **Introspection** = *observe* the program's structure. "What type is `x`? What methods does this class have? Does this field have an annotation?" Read-only.
- **Intercession** = *change* the program's structure or behavior while it runs. "Add a method to this class. Replace this function. Intercept every call to this object."

Introspection is common and relatively safe (serializers, debuggers, test frameworks lean on it). Intercession is powerful and dangerous (monkeypatching, dynamic proxies) — you are editing the program *as it runs*.

### 4. Generative vs Reflective Metaprogramming

Another way to slice the field:

- **Generative** = *produce new code.* Macros, code generators, templates, `#[derive]`. The meta-code's output is more code.
- **Reflective** = *inspect/alter existing code or objects.* Reflection, metaclasses, proxies. The meta-code works on code that already exists.

Many tools mix both (a runtime framework might inspect your class *and* generate a proxy), but the distinction helps you classify what you are looking at.

### 5. Homoiconicity: The Purest Form

In most languages, code and data look different — code is special syntax, data is values. In the **Lisp** family, code is *written as lists*, the same structure used for data. A function call `(+ 1 2)` is literally a list of three things: the symbol `+`, the number `1`, the number `2`. Because code *is* a list, a Lisp program can build, take apart, and rewrite code using the exact same operations it uses on any list. This property is called **homoiconicity** ("same representation"), and it is why Lisp macros are considered the gold standard of metaprogramming — there is no gap between "code" and "data you can manipulate."

Most languages bolt metaprogramming on with special machinery (reflection APIs, macro syntax). Lisp gets it for free because of how the language is shaped.

### 6. The Frameworks You Already Use Are Built On This

You will rarely write a metaprogramming framework. You will *constantly use one*. A short, honest list of famous tools and the technique underneath them:

- **Spring / Hibernate (Java)** — reflection + annotations + dynamic proxies.
- **Django / Rails (Python / Ruby)** — metaclasses, dynamic method generation, decorators.
- **serde (Rust)** — `#[derive]` macros that generate serialization code at compile time.
- **gRPC / Protocol Buffers** — code generators that produce client/server stubs from a schema.
- **Mocking libraries (Mockito, unittest.mock)** — dynamic proxies and runtime class manipulation.

When you understand *what* metaprogramming is, these stop being magic and become "oh, it's reading my annotations and generating a proxy."

### 7. The Fundamental Trade

Metaprogramming buys you **power and DRY-ness**: write a rule once, apply it everywhere; eliminate boilerplate; let the machine generate what would be tedious or error-prone by hand. The price is **comprehensibility, debuggability, and tooling**: code that is generated or rewritten is harder to read, harder to step through in a debugger, and harder for your IDE to autocomplete or jump to. The whole rest of this section, ultimately, is about spending that power wisely.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Base level vs meta level** | A recipe (base) vs. a cookbook editor who writes and standardizes recipes (meta). |
| **Code generation** | A form-letter mail merge: one template + a list of names produces hundreds of personalized letters. |
| **Reflection / introspection** | Reading the label on a jar to find out what's inside, instead of being told in advance. |
| **Intercession** | Editing the jar's label *and* swapping its contents while it sits on the shelf. |
| **Macro (compile-time)** | A find-and-replace shortcut a typesetter applies *before* the book is printed — readers never see the shorthand. |
| **`eval` (runtime)** | Handing someone a note that says "do whatever this slip of paper tells you," then writing the slip on the spot. |
| **Annotations / decorators** | Sticky notes on a document ("translate this," "review this") that an assistant later acts on. |
| **Homoiconicity (Lisp)** | A language where the *blueprints* and the *building blocks* are made of the same Lego bricks, so you reshape plans the same way you stack pieces. |
| **Dynamic proxy** | A receptionist who stands in for an executive, takes every call, and decides what to forward, log, or handle. |
| **Compile-time vs runtime** | Pre-printing a wedding invitation (compile-time: fixed forever) vs. an usher improvising seating as guests arrive (runtime: adapts to who shows up). |

---

## Mental Models

### The "Two Levels" Model

Picture two layers stacked. The **bottom layer** is your ordinary program — the loop that processes orders, the function that adds two numbers. The **top layer** is code that looks *down* at the bottom layer and does something with it: generates more of it, inspects it, or rewrites it. Whenever you are confused about a piece of "magic" code, ask: *Which layer is this? Is it doing work, or is it doing work on the code that does work?* The framework annotation is top layer; the function it decorates is bottom layer.

### The "When Does It Run?" Model

Before you reason about any metaprogramming feature, locate it on the timeline:

```text
   write code ──► BUILD ──► ship ──► RUN ──► done
                    ▲                  ▲
                    │                  │
            compile-time meta     runtime meta
            (macros, codegen)    (reflection, eval)
```

A macro and a reflection call may *look* similar in source, but one finished its job before you shipped and the other is happening live in front of your user. That single fact predicts the performance, the failure mode, and the debuggability. Always place the feature on this line first.

### The "Code Is a Tree" Model

After the parser reads your source text, your program is a **tree**: a function contains statements, a statement contains an expression, an expression contains operators and operands. Metaprogramming tools that "manipulate code" are usually walking and rewriting this tree (the AST — abstract syntax tree). You don't need to build one yet; just hold the picture that "rewriting code" means "rewriting a tree," not "editing a string of text" (though `eval` really does take a string).

### The "Magic Has a Mechanism" Model

The most useful junior habit: when something works by magic, refuse to accept "magic." Replace it with the question *"what read my code, and when?"* The answer is always one of a small handful of mechanisms — an annotation processor at build time, reflection at startup, a decorator at import, a generated file on disk. Naming the mechanism turns fear into understanding.

---

## Code Examples

These are deliberately tiny. Each shows *one* technique and labels *when it runs*. Run them and watch what happens.

### Python — Reflection / Introspection (runtime)

```python
class User:
    def __init__(self, name, age):
        self.name = name
        self.age = age

    def greet(self):
        return f"hi, I'm {self.name}"

u = User("Ada", 36)

# The program inspects ITSELF at runtime:
print(type(u).__name__)        # 'User'        -- what class is this?
print(vars(u))                 # {'name': 'Ada', 'age': 36}  -- its fields
print([m for m in dir(u) if not m.startswith("_")])  # ['age', 'greet', 'name']

# It can even decide what to call by a string computed at runtime:
method_name = "greet"
print(getattr(u, method_name)())   # 'hi, I'm Ada'
```

Nothing here was known when you wrote it — `method_name` could have come from a config file. This is **introspection** at **runtime**. A serializer turning any object into JSON works exactly this way.

### Python — Decorator (runtime, at import)

```python
def log_calls(func):
    def wrapper(*args, **kwargs):
        print(f"calling {func.__name__}")
        return func(*args, **kwargs)
    return wrapper

@log_calls            # this RUNS when the module is imported
def add(a, b):
    return a + b

print(add(2, 3))
# calling add
# 5
```

`@log_calls` is metaprogramming: it takes a function *as data*, wraps it, and replaces it. The decorator runs **once at import** (runtime), producing a new function. This is the same shape as `@app.route` in a web framework.

### Python — `exec` (runtime, the bluntest tool)

```python
source = "def square(x): return x * x"
exec(source)           # turns a STRING into a real function, right now
print(square(5))       # 25
```

`exec` takes source code *as a string* and runs it as code. Powerful, and almost always the wrong choice (slow, unsafe, invisible to tooling) — but it shows the idea in its rawest form: **a program writing and running a program at runtime.**

### Rust — Derive Macro (compile-time)

```rust
#[derive(Debug, Clone)]   // a MACRO runs at COMPILE time
struct Point {
    x: i32,
    y: i32,
}

fn main() {
    let p = Point { x: 1, y: 2 };
    let q = p.clone();              // Clone code was GENERATED for us
    println!("{:?}", q);            // Debug code was GENERATED: Point { x: 1, y: 2 }
}
```

You wrote zero lines of printing or cloning logic. The `#[derive(...)]` macro **generated** that code *before* the program was compiled. By the time the program runs, there is no "magic" left — just ordinary compiled functions. This is **generative**, **compile-time** metaprogramming.

### Go — `go generate` (build-time code generation)

```go
//go:generate stringer -type=Color
type Color int

const (
    Red Color = iota
    Green
    Blue
)
```

Running `go generate ./...` invokes the `stringer` tool, which **writes a new `.go` file** giving each `Color` a `String()` method (`Red.String() == "Red"`). Go deliberately has *no* macros; instead it leans on this explicit "generate a file you can read and check in" approach plus the `reflect` package at runtime. The generated file is real source you can open and step through.

### Java — Reflection + Annotation (runtime)

```java
import java.lang.annotation.*;
import java.lang.reflect.*;

@Retention(RetentionPolicy.RUNTIME)
@interface Test {}

class Suite {
    @Test public void checkA() { System.out.println("A ran"); }
    public void helper()       { System.out.println("not a test"); }
}

public class Runner {
    public static void main(String[] args) throws Exception {
        Suite s = new Suite();
        for (Method m : Suite.class.getDeclaredMethods()) {
            if (m.isAnnotationPresent(Test.class)) {   // INSPECT at runtime
                m.invoke(s);                           // CALL by reflection
            }
        }
    }
}
// prints: A ran
```

This is, in miniature, *how JUnit works*: it uses **reflection** at **runtime** to find every method tagged `@Test` and call it. The `@Test` annotation is data attached to your code; the framework reads that data and acts on it.

### Lisp — Homoiconic Macro (compile-time, code as data)

```lisp
;; `unless` does not exist as a built-in here; we WRITE it as a macro.
;; The macro receives code AS A LIST and returns new code.
(defmacro my-unless (condition body)
  (list 'if condition nil body))

(my-unless nil (print "this prints, because condition is nil"))
;; expands, before running, into:  (if nil nil (print "..."))
```

The macro `my-unless` receives its arguments *as lists of code* and builds new code with `list`. Because Lisp code *is* a list, "writing code that writes code" is just "writing a function that builds a list." This is **homoiconicity** — the purest metaprogramming there is.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Boilerplate** | Eliminates repetitive code — write the rule once, generate the rest. Huge DRY win. | The generated/expanded code is real code you still ship, debug, and maintain — just invisibly. |
| **Expressiveness** | Lets you build DSLs and concise APIs that read like the problem domain. | Readers must learn *your* mini-language on top of the host language. |
| **Performance (compile-time meta)** | Zero runtime cost — work is done before shipping. | Slower builds; harder to debug the build step. |
| **Performance (runtime meta)** | Adapts to data known only at runtime (plugins, config). | Reflection and `eval` are slow; runs on every call. |
| **Safety (compile-time)** | Errors caught before you ship. | Cryptic compiler errors pointing at generated code. |
| **Safety (runtime)** | Flexible. | Failures happen in production, in front of users. |
| **Tooling** | Frameworks built on it are wildly productive (Spring, Django, serde). | Your IDE, debugger, and "go to definition" often can't see through the magic. |
| **Comprehensibility** | One concept ("just add `@route`") instead of pages of wiring. | "Where does this behavior come from?" can be genuinely hard to answer. |

---

## Use Cases

Metaprogramming is the right tool when:

- **You're eliminating mechanical boilerplate.** Serialization (`#[derive(Serialize)]`), `equals`/`hashCode`, getters/setters, builder patterns. Code no human should write by hand.
- **You're generating glue from a schema.** gRPC stubs, ORM models from a database, API clients from an OpenAPI spec.
- **You're building a framework or library used by many people.** The framework absorbs the metaprogramming so its users don't have to (they just add an annotation).
- **You're wiring cross-cutting concerns.** Logging, transactions, authentication applied uniformly via decorators/proxies/annotations.
- **You're building a small domain language.** A test matcher, a query builder, a configuration syntax.

It is the **wrong** tool when:

- A plain function, a loop, or a bit of copy-paste would be clearer and is read more often than it is written.
- The team can't maintain it — metaprogramming concentrates cleverness, and clever code outlives the clever person.
- You reach for `eval`/`exec` on untrusted input (that's a security hole, not a technique).
- The "savings" is three lines of boilerplate but the cost is a debugging mystery.

---

## Coding Patterns

### Pattern 1: Classify before you touch — *which technique, run when?*

When you meet unfamiliar "magic," answer two questions before anything else:

```text
1. Generative or reflective?  (does it make code, or inspect/alter existing code?)
2. Compile-time or runtime?   (did it finish at build, or is it live now?)
```

Those two answers locate any feature on the map and tell you how to debug it.

### Pattern 2: Prefer the earliest stage that works

If a job can be done at **build time** (codegen, macro) instead of **runtime** (reflection, `eval`), prefer build time: it's faster and safer. Only move to runtime when you genuinely need information that doesn't exist until the program runs.

### Pattern 3: Read the generated output

For any code generator (`go generate`, `protoc`, macro expansion via `cargo expand`), *open the generated file or the expansion.* The single best way to demystify metaprogramming is to see the boring, ordinary code it produced.

### Pattern 4: Treat annotations as data, not behavior

An annotation/decorator/attribute is just a *label*. By itself it does nothing — some tool must read it. When you see `@Foo`, ask "who reads `@Foo`, and when?" The label and the reader are two separate things.

### Pattern 5: Start without metaprogramming

Write the boring version first (one explicit function, one explicit registration). Introduce metaprogramming only when the boilerplate genuinely repeats and hurts. Cleverness is a tool of last resort, not first.

---

## Best Practices

- **Default to ordinary code.** Reach for metaprogramming only when the repetition is real and the payoff clearly beats the loss of clarity.
- **Know *when* your meta-code runs.** Build-time and runtime have completely different costs and failure modes. Never confuse the two.
- **Make generated code visible.** Check generated files into the repo (or make them trivially regenerable) and mark them "DO NOT EDIT." Hidden code is the enemy of debuggability.
- **Never `eval`/`exec` untrusted input.** That is arbitrary code execution. If you think you need it, you almost certainly don't.
- **Prefer the language's blessed mechanism.** Use the standard reflection API, the standard macro system, the standard codegen tool — not a clever hack.
- **Document the magic.** If a class behaves differently because of a decorator, metaclass, or annotation, say so in a comment. The next reader cannot see the mechanism.
- **Keep base level and meta level separate.** Don't tangle "the code that does work" with "the code that generates code." Reviewers should be able to read each alone.

---

## Edge Cases & Pitfalls

- **"It works by magic" is a smell, not a feature.** If you can't explain *what read your code and when*, you don't understand it yet — and you can't debug it under pressure.
- **Debuggers struggle with generated/rewritten code.** A stack trace may point at code you never wrote, or at a generated file with no helpful names. Know how to view expansions (`cargo expand`, generated `.go`/`.java` files).
- **Runtime reflection is slow.** A reflective call can be orders of magnitude slower than a direct one. Fine in startup/config; bad in a hot loop.
- **`eval`/`exec` are security holes by default.** Running a string as code means whoever controls the string controls your program.
- **Compile-time errors point at the wrong place.** A macro or template that generates broken code produces an error in the *generated* code, far from your `#[derive(...)]` line. The mapping back is the hard part.
- **Annotations do nothing on their own.** Adding `@Cacheable` without the framework that reads it is a no-op. Many "why isn't my annotation working?" bugs are "nothing is reading it."
- **Metaprogramming concentrates knowledge.** A clever metaprogram replaces a whole team's worth of boilerplate — and becomes a single point of "only one person understands this." That's an organizational risk, not just a technical one.
- **Self-modifying code is (almost) never what you want today.** Historically, programs literally rewrote their own machine instructions to save memory. On modern CPUs this fights caches and security defenses and is essentially banned outside niche JITs. When people say "self-modifying" now, they almost always mean ordinary runtime metaprogramming, not literal instruction rewriting.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                   WHAT METAPROGRAMMING IS                         │
├──────────────────────────────────────────────────────────────────┤
│ Metaprogramming = code that reads / generates / transforms code   │
│ Base level   = the program that does the work                     │
│ Meta level   = code that operates ON the base level               │
├──────────────────────────────────────────────────────────────────┤
│ THE ONE AXIS:  WHEN does the meta level run?                      │
│   BUILD-TIME : macros, C++ templates, annotation processors,      │
│                code generators, Rust #[derive]                    │
│   RUNTIME    : reflection, metaclasses, dynamic proxies,          │
│                monkeypatching, eval/exec                          │
├──────────────────────────────────────────────────────────────────┤
│ Two more slices:                                                  │
│   Introspection  = observe (look)                                 │
│   Intercession   = modify (change)                                │
│   Generative     = produce new code                               │
│   Reflective     = inspect/alter existing code                    │
├──────────────────────────────────────────────────────────────────┤
│ Purest form: HOMOICONICITY (Lisp) — code IS data (a list)         │
├──────────────────────────────────────────────────────────────────┤
│ Frameworks built on it: Spring, Hibernate, Django, Rails,         │
│                         serde, gRPC stubs, mocking libs           │
├──────────────────────────────────────────────────────────────────┤
│ The trade: power + DRY   vs   comprehensibility + debuggability   │
├──────────────────────────────────────────────────────────────────┤
│ Junior habit: "magic" → ask "WHAT read my code, and WHEN?"        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Metaprogramming is code about code:** programs that read, generate, or transform programs — sometimes themselves.
- The ordinary program is the **base level**; code that operates on it is the **meta level**. Learn to see which layer you're looking at.
- The single most important organizing idea is **when the meta level runs**: **compile-time/build-time** (macros, templates, annotation processors, code generators, `#[derive]`) vs **runtime** (reflection, metaclasses, proxies, monkeypatching, `eval`/`exec`). The *when* predicts speed, safety, and debuggability.
- Two more useful distinctions: **introspection** (observe) vs **intercession** (modify), and **generative** (make code) vs **reflective** (inspect existing code).
- **Homoiconicity** (Lisp — code is written as data) is the purest form of the idea; most other languages bolt metaprogramming on with special machinery.
- You already use it everywhere: **Spring, Hibernate, Django, Rails, serde, gRPC, mocking libraries** are all metaprogramming under the hood.
- The fundamental trade is **power and DRY-ness vs comprehensibility, debuggability, and tooling.** Spend the power deliberately.
- The rest of this section drills into each technique — reflection, annotations and decorators, build-time code generation, macros, metaclasses, dynamic proxies, and DSLs — and into *when not to metaprogram*. This page is the map; those are the territory.
- A junior's #1 habit: when code "works by magic," refuse the word "magic" and ask **"what read my code, and when?"**

---

## Diagrams & Visual Aids

### The Two Levels

```text
        ┌─────────────────────────────────────────┐
        │            META LEVEL                    │
        │  (reads / generates / rewrites the code  │
        │   below — macros, reflection, codegen)   │
        └───────────────────┬─────────────────────┘
                            │ operates on
                            ▼
        ┌─────────────────────────────────────────┐
        │            BASE LEVEL                    │
        │   (your ordinary program: the loop, the  │
        │    function, the business logic)         │
        └─────────────────────────────────────────┘
```

### The Timeline (Where Each Technique Lives)

```text
  YOU WRITE        BUILD / COMPILE              SHIP        RUN
  ──────────────────────────────────────────────────────────────►
                  │                                        │
                  │  macros                                │  reflection
                  │  C++ templates / constexpr             │  metaclasses
                  │  annotation processors                 │  dynamic proxies
                  │  code generators (protoc, go generate) │  monkeypatching
                  │  Rust #[derive]                        │  eval / exec
                  ▼                                        ▼
            "already decided,                       "deciding live,
             baked into binary"                      in front of users"
```

### Generative vs Reflective

```text
   GENERATIVE                          REFLECTIVE
   ──────────                          ──────────
   schema / annotation                 existing object / class
        │                                    │
        ▼                                    ▼
   [ meta-code ]                        [ meta-code ]
        │                                    │
        ▼                                    ▼
   NEW CODE produced               structure observed (introspection)
   (stubs, derive, codegen)        or altered (intercession)
```

### Homoiconicity in One Picture

```text
  Most languages:        code  ≠  data       (must use a reflection API
                         (special syntax)     or macro machinery to bridge)

  Lisp:                  code  =  data        ( (+ 1 2)  is just a list )
                         (both are lists)      → manipulate code with list ops
```

### The "Magic Has a Mechanism" Decision Flow

```text
        "this works by magic"
                │
                ▼
     ┌─────────────────────────┐
     │ WHAT read my code?       │ ── annotation? decorator? reflection?
     │                          │    codegen file? macro?
     └────────────┬────────────┘
                  ▼
     ┌─────────────────────────┐
     │ WHEN did it run?         │ ── build-time → look at generated output
     │                          │    runtime    → look at startup / each call
     └────────────┬────────────┘
                  ▼
            no more magic — just a mechanism you can debug
```
