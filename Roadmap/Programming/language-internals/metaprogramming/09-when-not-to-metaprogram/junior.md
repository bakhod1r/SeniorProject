# When NOT to Metaprogram — Junior Level

> **Topic:** [When NOT to Metaprogram](README.md)
> **Focus:** You *can* write code that writes code. The first thing a senior teaches you is when **not** to.

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
13. [Summary](#summary)

---

## Introduction

> Focus: **What metaprogramming is, why it feels powerful, and why "I could write a macro for this" is usually the wrong instinct.**

**Metaprogramming** is code that operates on code: macros that expand into more code, reflection that inspects types at runtime, code generators that emit source files, decorators and annotations that change what a function does without you seeing it at the call site. It is genuinely powerful. The first time you write a macro that eliminates fifty lines of boilerplate, it feels like a superpower.

This page is about the other side of that superpower — the side nobody shows you in the tutorial. The tutorial shows the macro working. It does not show you, the new hire, six months later, staring at a stack trace that points into code *that does not exist in any file you can open*. It does not show you the afternoon you spent because the framework "knew" how to wire two things together and you didn't. It does not show the teammate who quietly stopped touching a module because the one person who understood its clever DSL had left the company.

In one sentence: **metaprogramming moves cost from the moment you write the code to every moment anyone reads, debugs, or changes it afterward — and there are usually a lot more of those moments.** The senior skill is not "can you write a macro." Most people can learn to. The skill is *deciding not to*, because the boring version is one that the whole team can read, the debugger can step through, and the IDE can autocomplete.

> 🎓 **Why this matters for a junior:** Early in your career you will be tempted to prove cleverness. Metaprogramming is the most tempting tool for that, and the most expensive way to do it. The engineers people actually want to work with write the *plainest code that solves the problem*. Learning to feel the pull toward magic — and to resist it — is one of the highest-leverage habits you can build.

This page covers: what counts as "magic," the four costs that magic adds (reading, debugging, tooling, onboarding), a simple decision ladder ("prefer the simplest tool that works"), and small before/after examples where the boring version wins.

---

## Prerequisites

What you should know before reading this:

- **Required:** You can read and write functions, loops, and `if`/`switch` statements in at least one language.
- **Required:** You have used a debugger or at least added print statements to find a bug.
- **Required:** You know what a *call site* is — the line where a function is called.
- **Helpful:** You have seen *one* piece of metaprogramming in the wild — a Python decorator, a Java annotation like `@Autowired`, a Go `//go:generate` line, a TypeScript decorator, or a C macro.
- **Helpful:** You have once been confused by code that "just worked" and you couldn't see why.

You do **not** need to know:

- How macros, reflection, or codegen are *implemented*. This page is about judgment, not mechanism.
- Any specific framework deeply. We use frameworks only as examples.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Metaprogramming** | Code that generates, inspects, or transforms other code. Macros, reflection, codegen, decorators, annotations all count. |
| **Magic** | Informal term for behavior that happens without being visible at the call site. "It works but I don't see why." |
| **Call site** | The exact line where a function or feature is invoked. The question "can I understand this by looking here?" is about the call site. |
| **Action at a distance** | When code in one place silently changes the behavior of code far away. The defining symptom of too much magic. |
| **Boilerplate** | Repetitive, mechanical code (getters, mappers, wiring). The thing metaprogramming is usually sold as eliminating. |
| **Reflection** | A program inspecting its own types/fields/methods at runtime, by name, instead of by direct reference. |
| **Codegen** | A tool that writes source files for you, which you then compile like normal code. |
| **Decorator / Annotation** | A marker (`@something`) attached to a function or class that changes its behavior, often invisibly. |
| **Stringly-typed** | Using strings (`"userName"`) where a real symbol/identifier would do. Defeats the compiler and the IDE. |
| **Go to definition** | The IDE feature that jumps to where something is defined. Magic often breaks it — it "lands nowhere." |
| **YAGNI** | "You Aren't Gonna Need It." Don't build flexibility you don't yet have a concrete need for. |
| **Rule of three** | Don't abstract until you have *three* real cases. Two might be a coincidence. |
| **Magic budget** | The informal idea that a codebase can only afford so much magic before it becomes unmaintainable. Spend it carefully. |

---

## Core Concepts

### 1. "Magic" = behavior you can't see at the call site

Read this code:

```python
@app.route("/users/<id>")
def get_user(id):
    return db.query(User).get(id)
```

Where does the URL `/users/123` *actually* get matched to this function? Not here. A decorator registered this function somewhere you can't see. Where does `id` come from — a string or an int? The framework decided. This isn't bad; web frameworks earn their magic. But notice the feeling: **the behavior is real, and it is not on the screen.** That feeling — "the framework knows but I don't" — is the cost of metaprogramming, paid in small installments every time you read the code.

The opposite is **explicit** code, where what happens is what you see:

```python
def get_user(id):
    return db.query(User).get(id)

router.add("GET", "/users/<id>", get_user)  # the wiring is right here
```

Same behavior. But now `router.add` is a line you can read, click into, and grep for.

### 2. The four costs magic adds

Every time you reach for metaprogramming, you are adding some amount of:

1. **Reading cost.** The next person (often future-you) has to hold the magic in their head to understand a plain-looking line.
2. **Debugging cost.** When it breaks, the stack trace runs through generated/reflected/proxied code. You **cannot set a breakpoint in code that doesn't textually exist.**
3. **Tooling cost.** Autocomplete goes blank. "Go to definition" lands nowhere. `grep` can't find a name that was built from string pieces at runtime. Refactoring tools can't follow it.
4. **Onboarding cost.** A new hire can read plain code on day one. Magic, they have to be *taught* — and if the teacher left, nobody can.

Plain code costs you a little more typing *now*. Magic costs everyone a little more *forever*. Multiply by team size and years and the math usually loses.

### 3. The decision ladder: prefer the simplest tool that works

When you feel the urge to metaprogram, walk *down* this ladder and stop at the first rung that solves your problem:

```text
plain code
  → a function
    → a generic / template
      → a tiny bit of reflection
        → code generation you can read
          → a macro
            → a metaclass / deep runtime magic
```

Each step down buys more power and pays more cost. Most problems are solved on the top three rungs. If you find yourself reaching for the bottom rungs, the honest question is: *am I solving a real, painful, repeated problem — or am I being clever?*

### 4. "Is the boilerplate actually painful — or just slightly repetitive?"

Repetition is not automatically bad. Three nearly-identical structs are easy to read, easy to change one at a time, and trivial to grep. A macro that generates them is harder to read, breaks `grep`, and means a change to one means understanding the macro. Ask: *would removing this repetition save real effort, or just make me feel tidier?* Slightly-repetitive-but-obvious usually beats clever-but-invisible.

### 5. Kernighan's warning

There is a famous line worth memorizing early:

> "Debugging is twice as hard as writing the code in the first place. Therefore, if you write the code as cleverly as possible, you are — by definition — not smart enough to debug it." — Brian Kernighan

Metaprogramming is the most concentrated form of "as cleverly as possible." Kernighan's point is not that you're dumb — it's that *everyone*, including future-you, is operating at reduced capacity when debugging at 3 a.m. Write the code so that the tired, confused version of you can still understand it.

---

## Real-World Analogies

- **The light switch with no visible wire.** A normal switch has a wire you can trace to the bulb. A "smart home" that turns on lights based on hidden rules is magic: convenient until a light won't turn off and you have no wire to follow. Explicit code is the visible wire.
- **IKEA vs. a one-off custom cabinet by a craftsman who moved away.** The IKEA cabinet has an instruction sheet anyone can follow to assemble or repair. The custom one is beautiful — until a hinge breaks and the only person who understood the joinery is gone. Plain code is the instruction sheet.
- **GPS that won't tell you the route.** "Just trust me, turn here." Great until it's wrong and you're lost with no map. When magic fails, you have no map of *why* it did what it did.
- **A magician's trick you have to perform on stage every night.** Watching it is delightful. Being the one who has to *reliably reproduce it* under pressure is a different job. You are not the audience of your codebase; you are the stagehand.

---

## Mental Models

- **The magic budget.** Imagine each codebase has a fixed amount of "magic" it can absorb before people stop being able to reason about it. A web framework's routing spends some. An ORM spends some. *Your* clever decorator spends some. Spend the budget on things that pay back many times (framework-level), not on saving three lines.
- **"Can I debug this at 3 a.m. in production?"** Picture yourself paged, tired, on a video call, with a customer waiting. Can you find the bug by reading and stepping? If the answer involves "well, the macro expands to..." you have your warning.
- **"Would a junior understand this in six months?"** Not today, with the author next to them — in six months, alone, with the author gone. If no, the code is borrowing against the future.
- **Push cost to write-time, not read-time.** Code is read far more than it is written. A choice that saves writing-time but adds reading-time is almost always a bad trade.

---

## Code Examples

### Example 1 — Reflection where a `switch` is clearer (Python)

**The magic version:**

```python
def handle(event):
    # call a method named handle_<type> by string lookup
    method = getattr(self, "handle_" + event.type, None)
    if method:
        method(event)
```

This is clever. It is also: not grep-able (search `handle_click` finds nothing — the name was built from a string), not autocomplete-able, and silently does nothing if `event.type` is misspelled. A typo becomes a runtime no-op, not a compile error.

**The boring version:**

```python
def handle(event):
    if event.type == "click":
        self.handle_click(event)
    elif event.type == "hover":
        self.handle_hover(event)
    else:
        raise ValueError(f"unknown event type: {event.type}")
```

More lines. But every method is grep-able, the IDE finds them, an unknown type *fails loudly*, and a junior reads it top to bottom. For a handful of cases, this wins.

### Example 2 — A macro to save three lines (don't)

```text
// "Clever" macro, used once:
DEFINE_GETTER(name)   // expands to a getter for `name`

class User {
    DEFINE_GETTER(name)
}
```

To save one line, you have introduced a macro that: doesn't show up in "go to definition," produces confusing compiler errors, and must be learned by everyone. Just write the getter. **Metaprogramming to save three lines is almost never worth it.**

### Example 3 — A config file beats a DSL (most of the time)

You want users to describe a pipeline. Tempting: invent a tiny language.

```text
pipeline { fetch -> transform |> validate >> save }   # a custom DSL
```

Cute. Now *you* maintain a parser, error messages, an editor mode, and documentation for a language only your team speaks. Compare:

```yaml
# plain config — every tool on earth already reads YAML
steps:
  - fetch
  - transform
  - validate
  - save
```

The config is boring, universally tooled, and obvious. Reach for a DSL only when a config genuinely can't express what you need — and rarely even then.

---

## Pros & Cons

**"Pros" of NOT metaprogramming (i.e., choosing plain code):**

- Anyone on the team can read it, including day-one hires.
- The debugger steps through it; breakpoints work.
- `grep`, autocomplete, and "go to definition" all work.
- Errors usually happen at compile time, in *your* terms, not deep in a framework at runtime.
- The person who wrote it leaving does not orphan the code.

**Cons of plain code (the honest trade-offs):**

- More typing; more lines on screen.
- Real, large, error-prone boilerplate stays repetitive and must be maintained by hand.
- Some genuinely cross-cutting concerns (logging on every method, serialization for every type) become tedious without *some* automation.

The point of this whole topic: those cons are real, but they are *smaller and rarer* than juniors assume, and the cons of magic are *bigger and more frequent* than juniors assume.

---

## Use Cases

**When plain code is clearly right (don't metaprogram):**

- A CRUD app with a handful of entities. Write the handlers.
- Saving a few lines of boilerplate. Just write the lines.
- A handful of cases that a `switch`/`if` or an interface handles.
- Anything only used in one place. Magic exists to be reused; one use is not reuse.
- Anything you'd struggle to debug or explain to a teammate.

**When metaprogramming starts to earn its keep (later levels go deep on this):**

- Genuine, repeated, painful, error-prone boilerplate across *many* types (e.g., serialization for hundreds of structs).
- Framework-level cross-cutting concerns, written once by a team that owns and tests them.
- Cases where the abstraction pays back its cost many times over and you can still debug it.

---

## Coding Patterns

- **The boring-first pattern.** Always write the plain version *first*. If it's genuinely too repetitive after the third copy, *then* consider abstracting. You almost never regret starting plain.
- **The "make the wiring visible" pattern.** Prefer `router.add("GET", path, handler)` over a `@route` decorator when the team is small and the magic isn't paying for itself. Explicit wiring is grep-able and steppable.
- **The "fail loud" pattern.** If you must do a string/reflective lookup, always handle the miss with a loud error, never a silent no-op. A silent miss turns a typo into a ghost bug.
- **The "readable codegen" pattern.** If you must generate code, generate *readable source files that get committed*, not invisible runtime magic. People can open, read, and breakpoint generated files.

---

## Best Practices

- **Prefer the simplest tool that works.** Walk down the ladder; stop early.
- **Apply the rule of three.** Don't abstract two cases. Wait for the third real one.
- **Ask "would a junior get this in six months?"** If no, reconsider.
- **Ask "can I debug this at 3 a.m.?"** If no, reconsider.
- **Keep errors at compile time** when the language lets you. A compile error is cheap; a midnight runtime error is not.
- **Don't monkeypatch third-party libraries.** Wrap them in your own boring function instead. Patching someone else's code is magic that breaks on their next release.
- **Avoid stringly-typed dispatch** when a real symbol works. Let the compiler and IDE help you.
- **When in doubt, write it boring.** You can always add magic later; removing it after the team depends on it is much harder.

---

## Edge Cases & Pitfalls

- **"It's just one decorator" creep.** Each one looks harmless. Twenty of them, interacting, and nobody can trace what a request actually does. Magic accumulates; budget it.
- **The typo that compiles.** Stringly-typed and reflective code turns spelling mistakes into silent runtime failures instead of red squiggles. This is the single most common junior trap.
- **Copy-pasting magic you don't understand.** You find a clever decorator on Stack Overflow, paste it, it works — until it doesn't, and now you're debugging code you never understood. If you can't explain it, don't ship it.
- **Confusing "clever" with "good."** Clever code impresses for a day. Boring code that the whole team can maintain impresses for years. Aim for boring.
- **Removing repetition that wasn't hurting.** Three obvious copies are fine. Don't introduce a macro to satisfy a tidiness urge; you may be trading readable repetition for invisible coupling.
- **Forgetting future-you is a junior.** At 3 a.m., on a system you haven't touched in a year, *you* are the confused new hire. Write for that person.

---

## Summary

Metaprogramming is a real superpower, and the senior skill is restraint. Magic moves cost from writing-time (once) to reading, debugging, tooling, and onboarding time (forever, times everyone). Prefer the simplest tool that works — plain code before a function before a generic before a sliver of reflection before readable codegen before a macro before deep runtime magic. Apply the rule of three. Ask whether a junior could understand it in six months and whether you could debug it at 3 a.m. Most boilerplate is not painful enough to justify magic; most "clever" wins are saving three lines at the cost of everyone's comprehension. Write it boring first — you can always add magic later, and you'll rarely want to.
