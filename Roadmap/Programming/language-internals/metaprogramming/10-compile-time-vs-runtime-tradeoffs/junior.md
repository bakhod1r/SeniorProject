# Compile-Time vs Runtime Trade-offs — Junior Level

> **Topic:** [Compile-Time vs Runtime Trade-offs](README.md)
> **Focus:** The single most important question in metaprogramming — *when does the "extra" work happen, while you build the program or while it runs?* And why that one choice ripples through speed, startup, safety, and flexibility.

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

---

## Introduction

> Focus: **There are two moments when a program can do work — when you compile it and when you run it. Metaprogramming lets you choose which one.**

Most code you write does one obvious job: it runs and computes a result. But some code's job is to *produce or shape other code, or to inspect and adapt the program itself.* That is **metaprogramming** — code about code. The question that organizes this entire section is deceptively simple:

> **When does the meta-level run — at build time or at run time?**

This is called the **compile-time vs runtime** trade-off, and it is *the* axis everything else in this section hangs off. The same goal — say, "convert this object to JSON" — can be solved two completely different ways:

- **At compile time:** a tool reads your data type while you build, and *generates* a tailor-made JSON function. By the time the program runs, that function is plain, ordinary code. (Examples: macros, code generators, annotation processors, C++ templates, Rust's `#[derive(Serialize)]`.)
- **At run time:** the program ships *without* a custom function. When it actually needs to serialize, it **inspects the object live** — "what fields does this thing have?" — and works it out on the spot. (Examples: reflection, dynamic proxies, `eval`, metaclasses.)

Both produce the same JSON. But they make wildly different promises about speed, startup time, binary size, when errors show up, and how flexible the program is. A senior engineer doesn't memorize a "right answer" — they learn the *trade-offs* and pick the side that fits the job.

> 🎓 **Why this matters for a junior:** You will constantly meet two libraries that do "the same thing," and you'll wonder why one is described as "fast" or "native-image-friendly" and the other as "flexible" or "dynamic." The difference is almost always *where the meta-level runs*. Understanding this one axis turns a confusing zoo of frameworks (Spring vs Quarkus, Jackson vs serde, Guice vs Dagger) into a single clear question.

In one sentence: **compile-time metaprogramming does the clever work once, while you build, so the running program is plain and fast; runtime metaprogramming carries the cleverness with it and pays for it every time it runs, in exchange for being able to adapt to things it couldn't have known at build time.**

This page covers what "compile time" and "run time" actually mean, the core trade-off dimensions in plain language, and the same "serialize an object" example done both ways. The next level (`middle.md`) compares the dimensions head-to-head with measurements; `senior.md` covers the modern industry shift toward compile-time; `professional.md` covers multi-stage programming and real migration stories.

---

## Prerequisites

What you should know before reading this:

- **Required:** The difference between *compiling* a program and *running* it. (You write code → a compiler/build step turns it into something runnable → you run it.)
- **Required:** What a function is, and the idea that one function can produce or call another.
- **Required:** Basic familiarity with at least one language that has a build step (Java, Go, Rust, C++) or one dynamic language (Python, JavaScript).
- **Helpful but not required:** Having used a library that "magically" turns an object into JSON or maps a database row to a struct.
- **Helpful but not required:** Having heard the words "reflection," "macro," or "code generation."

You do **not** need to know:

- How a compiler is built (parsing, type-checking, codegen — that's the compilers topic).
- The internals of reflection or the JIT (that's `senior.md` and `professional.md`).
- Anything about GraalVM native-image or AOT compilation yet — we introduce it gently here.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Compile time** | The moment your source code is being turned into a runnable artifact (a binary, a `.jar`, bytecode). Work done here happens **once, on the developer's/CI's machine**, before any user runs the program. |
| **Run time** | The moment the finished program is actually executing on a real machine, doing its job for users. |
| **Build time** | Often used interchangeably with compile time; technically the whole build pipeline (compile + code generation + packaging). |
| **Metaprogramming** | Code whose job is to generate, inspect, or transform other code or program structure — "code about code." |
| **The meta-level** | The "extra" layer of work that isn't the program's direct business logic — e.g. figuring out how to serialize, wire dependencies, or build a proxy. |
| **Compile-time metaprogramming** | Doing the meta-level work during the build: macros, code generation, annotation processors, templates, `derive`. Output is ordinary code. |
| **Runtime metaprogramming** | Doing the meta-level work while the program runs: reflection, dynamic proxies, `eval`, monkeypatching, metaclasses. |
| **Reflection** | A program inspecting *itself* at run time — listing a class's fields/methods, reading annotations, calling methods by name. The classic runtime technique. |
| **Code generation (codegen)** | A build step that *writes source code* (or bytecode) for you, which then compiles normally. |
| **Macro** | Code that runs at compile time and expands into other code (Rust macros, Lisp macros, C++ templates are macro-like). |
| **Closed-world** | The program "knows everything" at build time — all types, all plugins are fixed. Enables aggressive compile-time work and AOT. |
| **Open-world** | New types/code can appear at run time (plugins, dynamic loading). Needs runtime techniques. |
| **AOT (Ahead-Of-Time) compilation** | Compiling all the way to a native binary *before* shipping, with no runtime compiler. Friendly to compile-time approaches, hostile to heavy reflection. |
| **Native image** | A self-contained native binary (e.g. GraalVM) produced by AOT. Famous for fast startup but strict about runtime reflection. |
| **Cold start** | The first-time startup delay of a program (especially serverless), before it can serve a request. Heavily affected by how much meta-work happens at boot. |
| **Startup tax** | The time a program spends at boot doing meta-level work (e.g. scanning classes via reflection) before it's ready. |

---

## Core Concepts

### 1. Two Moments to Do Work

Every program has (at least) two distinct moments:

```text
   YOU / CI MACHINE                          USER'S MACHINE / SERVER
   ┌──────────────────┐                      ┌──────────────────────┐
   │   COMPILE TIME   │   ── ship artifact ─►│      RUN TIME        │
   │  build the app   │                      │   execute the app    │
   └──────────────────┘                      └──────────────────────┘
   happens once,                              happens every time,
   before anyone runs it                      for every user
```

The central insight: **work done at compile time is paid for *once*; work done at run time is paid for *every single time the program runs* (and sometimes every single operation).** That asymmetry drives almost everything.

### 2. The Same Goal, Two Places to Solve It

Take a concrete goal: *turn a `User` object into JSON.* Two strategies:

**Compile-time strategy:** A build tool reads the `User` type and *writes a function* like:
```text
func userToJSON(u User) string {
    return "{\"name\":\"" + u.Name + "\",\"age\":" + str(u.Age) + "}"
}
```
This function is generated during the build. At run time it's just a normal, fast function — no surprises, no inspection.

**Runtime strategy:** Nothing is generated. At run time the serializer does:
```text
for each field in reflect(u):       // inspect the object live
    read field name
    read field value
    append to JSON string
```
Every call re-discovers the structure of `User` by inspecting it.

Same JSON out. Completely different *when* and *how* the cleverness happens.

### 3. The Core Trade-Off in One Picture

| You care most about... | Lean toward... |
|------------------------|----------------|
| Raw speed, especially in a hot loop | **Compile-time** (the work is pre-baked, no per-call inspection) |
| Fast startup / serverless cold start | **Compile-time** (nothing to scan at boot) |
| Catching mistakes *before* shipping | **Compile-time** (errors are build errors) |
| Adapting to things unknown until run time | **Run time** (plugins, dynamic data, hot reload) |
| Tiny, simple build with no code generators | **Run time** (build stays simple) |
| Shipping a native binary / AOT / native-image | **Compile-time** (reflection breaks or needs config) |

Keep this table in your head. Most of `middle.md` is just expanding each row with detail and numbers.

### 4. Why Compile-Time Is Fast

When the work is done at compile time, the running program has plain code. The CPU and any optimizer can **inline** it, optimize it, and run it with zero "figuring out." There's no inspecting the object, no looking up a field by name, no dictionary of methods — it's as if a human wrote the specialized function by hand. **Zero runtime cost for the meta-level.**

### 5. Why Runtime Is Flexible

When the work is done at run time, the program can handle things it *could not have known at build time*:

- A **plugin** loaded from a folder you didn't compile against.
- A **dynamic schema** — JSON whose shape comes from a config file or a database, decided long after the build.
- **Hot reload** — swapping behavior while the program keeps running.
- A **REPL** — typing new code into a live program.

Compile-time approaches can't do these, because the build already happened and is frozen. Runtime approaches shine exactly where the variation is genuinely *late*.

### 6. Why Compile-Time Catches Errors Early

If a generator or macro produces broken code, or a type doesn't fit, you find out **at build time** — the build fails, red on your screen, before any user is affected. With runtime reflection, a typo like calling a method `"getNmae"` (misspelled) compiles fine and only explodes **in production**, at 3 a.m., as a `MethodNotFound` error. Compile-time = **fail fast**; runtime = **fail late, possibly on a customer**.

### 7. The Modern Twist: Startup and Native Images

Two modern forces have pushed the industry *toward* compile-time:

- **Serverless cold start.** A function that boots in 30ms beats one that boots in 3 seconds, because users wait during the boot. Reflective frameworks scan thousands of classes at startup — slow. Compile-time frameworks wired everything during the build — fast boot.
- **Native images / AOT.** To make a self-contained native binary that starts instantly, the toolchain wants a **closed world** — everything known at build time. Heavy runtime reflection fights this; it needs special configuration or simply breaks. So teams shift the meta-work to compile time.

This is why you'll hear that newer frameworks (Quarkus, Micronaut, Dagger) "moved things to compile time" while older ones (Spring, Guice) "do it at run time."

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Compile-time metaprogramming** | A tailor measures you once and sews a custom suit. Wearing it later is effortless — it just fits. |
| **Runtime metaprogramming** | A "one size fits all" garment with adjustable straps that figures out your size *each time you put it on*. Flexible, but fussy every wear. |
| **Reflection** | Opening a box and looking inside to discover what's there, *right now*, instead of reading a label printed in advance. |
| **Code generation** | A factory that, given a blueprint, stamps out a finished part. The part is ordinary once made. |
| **Startup tax / cold start** | A restaurant that re-reads the entire recipe book every morning before it can take the first order. |
| **Compile-time = fail fast** | A spell-checker that underlines your typo as you write, not after you've mailed the letter. |
| **Runtime = fail late** | Finding the typo only when the recipient calls to complain. |
| **Closed-world (AOT)** | A sealed ship-in-a-bottle: beautiful and complete, but you can't add new pieces after it's sealed. |
| **Open-world (runtime)** | A LEGO set you can keep adding bricks to while it's already built. |
| **Multi-stage (having it both ways)** | A coffee machine you *program* once (compile-time choice of recipe) that then runs that recipe instantly every morning. |

---

## Mental Models

### The "Pay Once vs Pay Every Time" Model

The cleanest way to remember the whole topic. Ask: *does this meta-work get paid for once (at build) or every time (at run)?*

- A code generator: **pay once.** The cost lives in your CI build. Users never feel it.
- A reflective serializer: **pay every call.** Each request re-inspects the object. Multiply by a million requests.

Most performance arguments in this topic reduce to "compile-time pays once; runtime pays per-operation."

### The "When Do You Know?" Model

For any decision the program needs to make, ask: *when do I actually know the answer?*

- If you know it **at build time** (the type is fixed, the plugins are fixed) → push the meta-work to compile time. Why defer work you could've done already?
- If you only know it **at run time** (the schema comes from a config file, a plugin appears later) → you *have* to do it at run time. Compile-time literally cannot help.

This single question — *"is the variation known at build time or only at runtime?"* — is the heart of the decision framework you'll formalize in later levels.

### The "Frozen vs Live" Model

A compiled artifact is **frozen** — it can't change after the build. That's why it's fast and safe, and also why it can't adapt. A reflective/dynamic program stays **live** — it can inspect and change itself while running. That's why it's flexible, and also why it's slower and harder to verify ahead of time. Speed/safety and flexibility sit on opposite ends of "frozen vs live," and you choose where to sit.

---

## Code Examples

We'll solve the same problem — **serialize a simple object to a string** — both ways, in approachable form. Don't worry about perfect syntax; focus on *where the work happens*.

### Runtime approach (Python reflection)

```python
def to_dict(obj):
    # At RUN TIME, inspect the object's attributes live.
    result = {}
    for field_name in vars(obj):          # reflection: "what fields exist?"
        result[field_name] = getattr(obj, field_name)
    return result

class User:
    def __init__(self, name, age):
        self.name = name
        self.age = age

print(to_dict(User("Ada", 36)))   # {'name': 'Ada', 'age': 36}
```

`to_dict` works for *any* object — `User`, `Product`, anything you invent later. That's the flexibility win. But every call pays for the live inspection (`vars`, `getattr`), and a typo in a field name only fails when that code path runs.

### Runtime approach (Java reflection, sketch)

```java
String toJson(Object obj) throws Exception {
    StringBuilder sb = new StringBuilder("{");
    // RUN TIME: ask the object's class what fields it has.
    for (Field f : obj.getClass().getDeclaredFields()) {
        f.setAccessible(true);
        sb.append('"').append(f.getName()).append("\":")
          .append(f.get(obj)).append(',');
    }
    return sb.append('}').toString();
}
```

Flexible (works on any class), but `getDeclaredFields()` and `f.get(obj)` run on *every* call, and this is the kind of code that GraalVM native-image complains about because it can't see, at build time, which fields will be reflected on.

### Compile-time approach (Rust derive)

```rust
use serde::Serialize;          // serde generates the code at COMPILE TIME

#[derive(Serialize)]           // <- this macro writes a custom serializer
struct User {
    name: String,
    age: u32,
}

fn main() {
    let u = User { name: "Ada".into(), age: 36 };
    // No reflection at run time. The serializer for User was generated
    // during the build and is plain, inlinable code.
    println!("{}", serde_json::to_string(&u).unwrap());  // {"name":"Ada","age":36}
}
```

`#[derive(Serialize)]` runs a macro **at compile time** that writes a `User`-specific serializer. At run time there's no inspection — just straight-line code. Fast, AOT-friendly, and if `User` had an unserializable field you'd hear about it *at build time*.

### Compile-time approach (Go code generation, sketch)

```go
//go:generate gen-serializers ./...

// A build step reads this struct and GENERATES a file user_json.go
// containing a hand-written-quality function:
//
//   func (u User) MarshalJSON() ([]byte, error) {
//       return []byte(`{"name":"` + u.Name + `","age":` + strconv.Itoa(u.Age) + `}`), nil
//   }
//
// At run time, MarshalJSON is just normal, fast code — no reflection.

type User struct {
    Name string
    Age  int
}
```

The generator runs during the build (`go generate`). The shipped binary contains plain code. Contrast with Go's standard `encoding/json`, which uses reflection at run time — simpler to use, but slower and reflection-based.

### Seeing the trade-off side by side

```text
SERIALIZE A USER

 Runtime (reflection)            Compile-time (derive / codegen)
 ─────────────────────           ───────────────────────────────
 + Works on any type,            + Zero per-call overhead
   even ones added later         + Errors caught at build
 + No build step / codegen       + Native-image friendly
 - Per-call inspection cost      - Needs a macro/generator
 - Typos fail in production      - Frozen: only the types you
 - Native-image needs config       built for are supported
```

---

## Pros & Cons

| Dimension | Compile-time approach | Runtime approach |
|-----------|----------------------|------------------|
| **Performance** | Pre-baked, inlinable, **zero meta-cost at run time**. | Per-operation inspection cost; can defeat optimizer inlining. |
| **Startup time** | Fast — nothing to scan at boot. | Slower — may scan/wire on startup (the cold-start tax). |
| **Error timing** | Errors caught **at build** (fail fast). | Errors surface **in production** (method not found at 3 a.m.). |
| **Flexibility** | Frozen at build; closed-world. | Adapts to data/plugins unknown until run time. |
| **Binary size** | Can bloat (generated code, monomorphization). | Reflection metadata also has size, but often less generated code. |
| **Tooling / IDE** | Generated code is real — autocomplete, step-through. | Magic is opaque to static analysis and refactoring tools. |
| **Build simplicity** | More complex builds (generators to maintain, slower builds). | Simple builds; the cost ships with the program. |
| **AOT / native-image** | Friendly — closed-world fits AOT. | Hostile — reflection needs config or breaks under trimming. |
| **Learning curve** | Need to understand the generator/macro system. | "Just use reflection" is initially simpler to write. |

---

## Use Cases

**Lean compile-time when:**

- The variation is **known at build time** (you know your types, your routes, your plugins).
- **Startup speed matters** — serverless functions, CLIs, short-lived jobs.
- You ship an **AOT / native-image** binary, or your bundler **tree-shakes** (web).
- The code is in a **hot path** where per-call overhead would hurt.
- You want **build-time guarantees** that wiring/serialization is correct.

**Lean runtime when:**

- The variation is **only known at run time** — plugin systems, dynamic schemas, user-supplied scripts.
- You need **hot reload, a REPL, or live introspection**.
- The build must stay **dead simple** and the per-call cost is negligible (cold paths, low volume).
- You're prototyping and flexibility beats peak performance.
- The set of types/behaviors is **open** and grows after deployment.

---

## Coding Patterns

### Pattern 1: Prefer compile-time when the answer is known at build time

If you can answer a question during the build, do it then. Don't reflect at run time to discover a field set you already knew when you wrote the type.

### Pattern 2: Reach for runtime only at the genuine "late" boundary

Use reflection/dynamic dispatch exactly where new information arrives late — at the plugin boundary, the config-driven boundary, the user-script boundary — and keep everything inside that boundary compile-time and fast.

### Pattern 3: Generate, then ship plain code

The codegen pattern: a build step writes ordinary source, which compiles normally. You get build-time work and runtime simplicity. The generated file is real code you can read.

### Pattern 4: Cache the result of reflection

If you must use reflection, do the expensive inspection **once** (e.g. at startup) and cache a fast plan, instead of re-inspecting on every operation. This is "runtime, but pay-once-ish" — a common middle ground.

### Pattern 5: Check what your deploy target requires

Before choosing, ask: *are we deploying to native-image / a trimmed bundle / a serverless cold-start-sensitive environment?* If yes, that pressure pushes you toward compile-time before any other consideration.

---

## Best Practices

- **Default to compile-time for fixed, known structure.** It's faster, safer, and AOT-friendly. Use runtime where you actually need late flexibility.
- **Put runtime dynamism behind a clear boundary.** Don't sprinkle reflection everywhere; confine it to the plugin/config edge.
- **Don't reflect on every call.** If you use reflection, build a plan once and reuse it.
- **Let the deploy target drive the choice.** Native-image or serverless cold-start concerns can override "it was easier to use reflection."
- **Read the generated code.** A big advantage of compile-time is that the output is real — open it, step through it, understand it.
- **Pick libraries by *where their meta-level runs*, not by name.** "Fast" and "native-friendly" almost always means compile-time; "flexible" and "dynamic" almost always means runtime.
- **Measure before assuming.** For a cold, low-volume path, runtime reflection's overhead may be irrelevant — don't over-engineer codegen for something called twice a day.

---

## Edge Cases & Pitfalls

- **"It works on my JVM" but breaks in native-image.** Reflection-based code compiles and runs fine in normal mode, then fails after a native-image build because the toolchain didn't know which classes you'd reflect on. A classic surprise.
- **The typo that compiles.** `getMethod("getNmae")` (misspelled) compiles fine and throws only when that line runs — possibly months later, in production.
- **Slow cold starts you didn't expect.** A small reflective framework can add seconds to boot by scanning classes — invisible on a long-running server, painful on serverless.
- **Generated-code bloat.** Codegen and template instantiation can multiply binary size (a serializer per type, a template per type combination). Compile-time isn't "free"; it spends *build time* and *binary size*.
- **Frozen-at-build means no plugins.** A compile-time-only design literally cannot accept a plugin discovered at run time. If your requirement is "load behavior we didn't compile against," compile-time is the wrong tool.
- **Treating the GIL/JIT/optimizer as magic.** Beginners assume "the runtime will optimize my reflection away." It usually can't — reflective calls are opaque to the optimizer.
- **Forgetting builds get slower.** Heavy compile-time metaprogramming (big macros, lots of codegen) can make builds painfully slow. You moved the cost, you didn't delete it.

---

## Test Yourself

1. In your own words: what's the difference between work done at *compile time* and work done at *run time*, and why does the distinction matter for performance?
2. You have a `Product` type whose fields are fixed and known. You need fast JSON serialization in a hot loop. Compile-time or runtime? Why?
3. You're writing a plugin host that loads `.so`/`.dll` plugins from a folder *the user chooses at startup*. Compile-time or runtime for dispatching to them? Why?
4. A reflective serializer "works fine" in tests but fails after the team switches to GraalVM native-image. Explain what changed and why.
5. Name one cost of compile-time metaprogramming that runtime approaches avoid.
6. Name one capability of runtime metaprogramming that compile-time approaches simply cannot provide.
7. Why is "fast cold start" so often a reason teams move meta-work from run time to compile time?
8. A typo'd method name fails "at 3 a.m. in production" with one approach and "on your screen during the build" with the other. Which is which, and why?

---

## Cheat Sheet

```text
┌────────────────────────────────────────────────────────────────────┐
│            COMPILE-TIME vs RUNTIME METAPROGRAMMING                 │
├────────────────────────────────────────────────────────────────────┤
│ THE ONE QUESTION:                                                 │
│   When is the variation known?                                    │
│     known at build time   → COMPILE-TIME                          │
│     only known at run time → RUNTIME                              │
├────────────────────────────────────────────────────────────────────┤
│ COMPILE-TIME (macros, codegen, derive, templates, processors)     │
│   + zero runtime meta-cost, inlinable, fast                       │
│   + fast startup / great cold start                               │
│   + errors caught at BUILD (fail fast)                            │
│   + AOT / native-image friendly                                   │
│   - slower builds, generator maintenance                          │
│   - frozen (closed-world): no late plugins                        │
│   - can bloat the binary                                          │
├────────────────────────────────────────────────────────────────────┤
│ RUNTIME (reflection, proxies, eval, metaclasses, monkeypatch)     │
│   + adapts to data/plugins unknown until run time                 │
│   + simple build, ship-and-go                                     │
│   + can inspect live program state                                │
│   - per-operation overhead, defeats inlining                      │
│   - startup tax (scanning at boot → slow cold start)              │
│   - errors surface in PRODUCTION (fail late)                      │
│   - breaks/needs config under native-image & tree-shaking         │
├────────────────────────────────────────────────────────────────────┤
│ MODERN SHIFT (why compile-time is winning many fights):           │
│   serverless cold-start + native-image + observability            │
│   Spring→Quarkus, Guice→Dagger, Jackson→serde                     │
│ BUT runtime still wins where genuine late dynamism is required.    │
└────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Metaprogramming** is code about code, and its single most important question is **when the meta-level runs: compile time or run time.**
- **Compile-time** (macros, code generation, annotation processors, templates, `derive`) does the clever work **once, during the build**, leaving plain, fast, optimizable code for run time.
- **Runtime** (reflection, dynamic proxies, `eval`, metaclasses, monkeypatching) does the clever work **while the program runs**, paying per-operation but gaining the ability to adapt to things unknown until run time.
- The trade-off touches **performance, startup time, error timing, flexibility, binary size, tooling, build complexity, and AOT compatibility** — all flowing from "pay once vs pay every time" and "frozen vs live."
- **Compile-time** wins on speed, fast startup/cold-start, fail-fast errors, and native-image compatibility. **Runtime** wins on flexibility: plugins, dynamic schemas, hot reload, REPLs.
- The **decision framework** is one question: *is the variation known at build time (→ compile-time) or only at run time (→ runtime)?* — plus how much you care about startup, AOT, and dynamism.
- The **modern industry shift is toward compile-time** (Quarkus/Micronaut vs Spring, Dagger vs Guice, serde vs Jackson), driven by serverless cold-start, native-image, and observability — **but runtime still wins** where real, late dynamism is required.
- Junior habit: when you see two libraries that "do the same thing" but one is "fast/native-friendly" and the other "flexible/dynamic," ask **where their meta-level runs.** That single question explains the difference.

---

*Continue to `middle.md` for a dimension-by-dimension head-to-head with real measurements and named frameworks, or revisit the other metaprogramming topics in this section to see each technique as a point on this compile-time/runtime axis.*
