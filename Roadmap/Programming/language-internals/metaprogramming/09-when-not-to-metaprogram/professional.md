# When NOT to Metaprogram — Professional Level

> **Topic:** [When NOT to Metaprogram](README.md)
> **Focus:** The economics of the "magic budget" — how senior engineers and teams decide that boring code wins.

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Magic Budget](#the-magic-budget)
3. [The Real Costs, Priced Out](#the-real-costs-priced-out)
4. [The Decision Framework](#the-decision-framework)
5. [Anti-Patterns Seen in Production](#anti-patterns-seen-in-production)
6. [When Metaprogramming IS Justified](#when-metaprogramming-is-justified)
7. [Best Practices](#best-practices)
8. [War Stories](#war-stories)
9. [Summary](#summary)

---

## Introduction

Every metaprogramming technique in this section is a power tool, and the professional
skill is mostly knowing when to leave it in the box. The temptation is constant:
reflection to save a switch statement, a metaclass to enforce a convention, a DSL to
make config "nicer," a clever macro to delete some boilerplate. Each looks like a win
in isolation. The cost shows up later and elsewhere — in the debugging session that
can't set a breakpoint, the new hire who can't read the code, the refactor that the IDE
can't follow, the production failure that surfaces as "method not found" instead of a
compile error. This tier is about pricing those costs honestly and defaulting to boring.

Kernighan's law is the north star: *"Debugging is twice as hard as writing the code in
the first place. Therefore, if you write the code as cleverly as possible, you are, by
definition, not smart enough to debug it."*

---

## The Magic Budget

Treat a codebase as having a finite **magic budget** — a tolerance for indirection that
isn't visible at the call site. Every reflection call, annotation, proxy, metaclass, and
macro spends some of it. Frameworks already spend a large chunk (Spring, ORMs, DI). When
the budget is overdrawn, the symptoms are predictable: people stop trusting the code,
debugging slows, onboarding takes months, and "I don't know how this works, but don't
touch it" becomes the team's relationship to its own system.

The budget framing reframes the decision from "can I metaprogram this?" (almost always
yes) to "is this worth the magic it spends, given how much is already spent?" — a much
better question.

---

## The Real Costs, Priced Out

- **Comprehensibility.** Behavior moves away from the call site (action-at-a-distance).
  A reader sees `save(user)` and cannot tell that an annotation three layers up opens a
  transaction, validates fields, and fires events. The code no longer tells you what it
  does.
- **Debuggability.** You can't breakpoint code that doesn't textually exist (generated,
  reflected, proxied). Stack traces fill with `$$Proxy`, `invoke0`, macro-expansion
  frames. Failures move from compile time to runtime — discovered in production, not CI.
- **Tooling.** Autocomplete, "go to definition," "find usages," and automated refactors
  all rely on static structure. Reflective/stringly-typed/dynamic code is invisible to
  them; `grep` can't find a method name that's assembled at runtime.
- **Error messages.** Macro and template errors are notoriously in implementation terms;
  reflective failures say "NoSuchMethod" with no hint where the contract broke.
- **Performance & startup.** Reflection/proxy overhead per call; annotation scanning and
  metaclass execution inflate startup — a direct hit in serverless/CLI contexts.
- **Maintenance & staffing.** The clever construct is fragile across library upgrades and
  unmaintainable once its author leaves. It raises the experience bar to touch the code.

These are not hypotheticals; they are the standard failure modes that make "we rewrote
the magic as plain code and everyone was happier" a recurring industry story.

---

## The Decision Framework

Prefer the simplest tool that works, escalating only when the previous rung genuinely
fails:

**plain code → a function → a generic/parameterized type → a tiny bit of reflection →
code generation (readable output) → a macro → a metaclass/heavy runtime magic.**

Ask, in order:

1. **Is the boilerplate actually painful, or just slightly repetitive?** The rule of three
   — don't abstract until you've seen it three times. Mild repetition is cheaper than the
   wrong abstraction.
2. **Would a junior understand it in six months?** If not, the magic had better be
   framework-level and well-documented.
3. **Can you debug it at 3am in production?** If the failure mode is opaque, that's a veto.
4. **Does it fail at compile time or runtime?** Prefer techniques that fail fast.
5. **Is there a non-magic alternative** (explicit code, readable codegen, hand-wired DI)
   that's only slightly more verbose? Usually verbosity is the cheaper cost.
6. **Is it app-level or framework-level?** Framework-level magic that serves thousands of
   usages can justify costs that app-level magic cannot.

---

## Anti-Patterns Seen in Production

- **Metaprogramming to save three lines.** A macro/metaclass/reflection trick that
  replaces a small, clear, repetitive block — net negative.
- **Reflection where polymorphism works.** A reflective dispatch table where an interface
  + a `switch`/map would be statically checked and faster.
- **A DSL where a config file or plain API would do.** Bespoke second language for static
  data.
- **Magic frameworks for a CRUD app.** Heavyweight reflective/DI machinery where explicit
  wiring would be shorter and clearer.
- **Monkeypatching third-party libraries.** Fragile across upgrades, invisible to readers,
  a maintenance time bomb.
- **Stringly-typed dynamic dispatch.** Building method/field names from strings, defeating
  every tool and turning typos into runtime errors.

---

## When Metaprogramming IS Justified

The mirror image keeps this honest. Reach for it when:

- The concern is genuinely **cross-cutting** (transactions, logging, serialization) and
  the alternative is the same boilerplate in hundreds of places.
- It's **framework-level**, owned, documented, and serves many usages — not a one-off in
  app code.
- The boilerplate it eliminates is **large, painful, and error-prone** (hand-writing
  serialization for 200 types, wiring a big DI graph by hand).
- The abstraction **pays for itself many times over** and you can still debug it.
- You're using a **compile-time** technique (derive macro, codegen, annotation processor)
  whose output is readable and whose errors are caught at build time.

---

## Best Practices

- **Default to boring.** Make the team prove a metaprogramming technique is worth its
  magic, not the reverse.
- **Push magic down into framework/library layers** that are owned and documented; keep
  application code explicit.
- **Prefer compile-time, readable-output techniques** over runtime, opaque ones.
- **Budget the magic** — be aware how much indirection the codebase already carries.
- **Write the boring version first**; reach for magic only when the boring version is
  demonstrably worse at scale.

---

## War Stories

- **The DSL trap.** A team's elegant in-house DSL became the thing no new hire could
  extend; the maintainers became a bottleneck, and the system was eventually rewritten as
  a plain typed API — slower to read, faster to change, and finally owned by everyone.
- **The reflection-heavy system that wouldn't AOT.** A service built on runtime reflection
  couldn't be compiled to a GraalVM native image (closed-world) without enormous
  configuration; the fix was migrating reflection to code generation — exactly the modern
  pressure pushing teams off runtime magic.
- **Spring annotation archaeology.** Debugging "why did this method run twice / not at
  all" through layers of `@Transactional`/`@Async`/`@EventListener` proxies cost days; the
  resolution was making the cross-cutting behavior explicit at the boundaries.

---

## Summary

The professional discipline of metaprogramming is mostly restraint. Treat indirection as a
**magic budget** the codebase can overdraw; price the real costs (comprehension,
debugging, tooling, error quality, startup, staffing); and default to the simplest tool —
escalating up the ladder only when the previous rung demonstrably fails. Metaprogramming
earns its place at the framework level for genuine cross-cutting concerns and large,
painful boilerplate, ideally via compile-time techniques with readable output. For almost
everything else, boring code — explicit, greppable, debuggable, and understandable by a
junior in six months — is the senior choice.
