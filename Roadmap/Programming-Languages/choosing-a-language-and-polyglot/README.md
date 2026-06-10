# Choosing a Language & Polyglot Architecture

> *"There are only two kinds of languages: the ones people complain about and the ones nobody uses."* — Bjarne Stroustrup

Most engineers inherit their languages. You join a team, the stack is already chosen, and the question "which language?" never reaches your desk. Then one day it does — a new service, a new team, a rewrite, a startup, a platform bet — and you discover that the decision is far harder than the language-war forums made it look. This roadmap is about **making that decision well, and living with it.**

Picking a language is not a taste contest. It is a multi-year commitment that shapes your hiring market, your failure modes, your performance ceiling, your operational cost, and the speed at which your team can ship. A great language chosen for the wrong problem is a liability; a "boring" language chosen for the right one is leverage. The skill is not knowing which language is *best* — no language is — but knowing how to **reason about fit** under real constraints: people, time, money, risk, and the code you already have.

> Looking for the *internals* of how a language executes (compilers, GC, runtimes)? See [Language Internals](../language-internals/).
>
> Looking for the *paradigms* a language expresses (OO, functional, procedural)? See [Programming Paradigms](../programming-paradigms/).
>
> Looking for how to *think* about engineering decisions in general? See [Engineering Thinking](../engineering-thinking/) — this roadmap applies that thinking to one specific, high-stakes class of decision.

---

## Why a Dedicated Roadmap

Language choice is the rare technical decision that is **simultaneously cheap to make and ruinously expensive to reverse.** Anyone can `npm init` or `cargo new` in thirty seconds. Undoing that choice five years and 400,000 lines later can consume an entire engineering org. The asymmetry is the whole reason this topic deserves rigor: the cost of the decision is not paid when you make it, but every day afterward.

And it is not one decision — it is a family of related ones:

- **Selection:** Given a problem, a team, and a deadline, what should we build this in?
- **Tradeoffs:** When raw performance and developer productivity pull in opposite directions, how do we choose, and how do we know we chose right?
- **Maturity:** How do we tell a thriving ecosystem from a fashionable but hollow one?
- **Composition:** When is it right to run *several* languages at once, and what does that cost?
- **Restraint:** When should we *resist* adding a new language, even a better one?
- **Migration:** When the choice was wrong — or simply outgrown — how do we move without a death-march rewrite?
- **Ownership:** Who will maintain this in five years, can we hire them, and what will they cost?
- **Longevity:** Are we betting on a language with a future, or building on something that will strand us?

These questions are **language-agnostic by design.** The frameworks here apply whether the contenders are Go vs Java, Rust vs C++, Python vs TypeScript, or a language that doesn't exist yet. The goal is judgment that outlives any specific language's moment in the sun.

| Roadmap | Question it answers |
|---|---|
| [Language Internals](../language-internals/) | *How* does a language run my code? |
| [Programming Paradigms](../programming-paradigms/) | *What styles* of thinking can a language express? |
| **Choosing a Language & Polyglot** (this) | *Which* language, *when*, and at *what cost* — across the whole lifecycle? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-language-selection-criteria/) | Language Selection Criteria | The decision framework — problem fit, performance, team, ecosystem, risk; weighted scoring vs gut feel |
| [02](02-performance-vs-productivity-tradeoffs/) | Performance vs Productivity Tradeoffs | "Fast enough," the cost of premature performance, the velocity/throughput spectrum, profiling before switching |
| [03](03-ecosystem-and-tooling-maturity/) | Ecosystem & Tooling Maturity | Libraries, package managers, build/debug/observability tooling, evaluating library health and bus factor |
| [04](04-interop-and-polyglot-architectures/) | Interop & Polyglot Architectures | FFI, service boundaries, shared schemas, the JVM/WASM polyglot, "right tool per job" and its hidden costs |
| [05](05-when-to-introduce-a-new-language/) | When to Introduce a New Language | Triggers, the N+1 language tax, the shiny-thing trap, governance, pilots, and exit criteria |
| [06](06-migrating-between-languages/) | Migrating Between Languages | Strangler fig, incremental vs big-bang, shadow/parallel runs, and the rewrite fallacy |
| [07](07-total-cost-of-ownership-and-team-skills/) | TCO & Team Skills | Hiring, onboarding, training, salaries, maintenance, Conway's law, "fun to write, expensive to own" |
| [08](08-language-longevity-and-lock-in-risk/) | Language Longevity & Lock-In Risk | Betting on a future, vendor/platform lock-in, community-health signals, deprecation, escape hatches |

---

## How to Read This Roadmap

Each topic ships five levels plus exercises, so you can enter at your depth and climb:

| File | Audience | What it gives you |
|---|---|---|
| `junior.md` | New to the decision | The core idea, plain examples, the traps everyone falls into first |
| `middle.md` | Has shipped, now choosing | Concrete frameworks and worked decisions you can apply this week |
| `senior.md` | Owns the choice | The hard tradeoffs, second-order effects, where the simple rules break |
| `professional.md` | Drives it org-wide | Governance, team dynamics, organizational and economic forces |
| `interview.md` | Preparing / hiring | The questions, the answers behind the answers, what a strong response signals |
| `tasks.md` | Wants to practice | Decision exercises, scoring rubrics, and scenarios to reason through |

---

## The One Idea Underneath All Eight

If you take a single principle from this roadmap, take this: **the language is rarely the bottleneck, and almost never the most expensive part of the system.** The expensive parts are people, time, and the code that already exists. Most language debates are loud precisely because they are arguing about the cheap variable — syntax and benchmarks — while the costly ones — hiring, maintenance, migration, lock-in — go undiscussed.

A senior engineer flips that. They spend their scrutiny where the money is: *Who maintains this? Can we hire them? What happens when we're wrong? How do we get out?* The syntax, they've learned, you get used to in a week.
