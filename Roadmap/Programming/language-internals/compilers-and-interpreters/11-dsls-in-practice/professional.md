# DSLs in Practice — Professional Level

> **Topic:** [DSLs in Practice](README.md)
> **Focus:** The strategic and organisational side of external DSLs — build-vs-buy, total cost of ownership, governance of a language many teams depend on, ANTLR-vs-hand-written at production scale, and the long, unglamorous life of maintaining and eventually retiring a language your company runs on.

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

---

## Introduction

> Focus: **Should this organisation build a DSL at all — and if so, how does it own one for a decade without it becoming a tax?**

At the senior level the question was "how do I run this DSL safely and fast?" At the professional level it is "should this language exist, who owns it, and what does it cost the company over its whole life?" These are mostly *not* parsing questions. They are product, platform, and governance questions, and getting them wrong produces the worst kind of technical debt: a homegrown language that a critical workflow depends on, that one person understood, that has no tooling, no spec, and no exit.

The defining fact of a production DSL is its **total cost of ownership (TCO)**. The parser is the cheap part — often a week or two. The expensive parts are everything that follows: the language server, the formatter, the documentation, the playground, the migration tooling, the security review of every builtin, the on-call when a customer's formula hangs a worker, the onboarding of every new engineer who must learn a language that exists nowhere else, and the eventual, painful deprecation. A DSL is a *product with users*, and like any product it must be staffed, supported, versioned, and someday sunset.

This level covers:

- **Build-vs-buy-vs-config.** When a DSL is the right answer versus a library, a config schema, an existing language (embed Lua/Starlark/CEL), or an internal DSL. The default should be *not* to build a language.
- **ANTLR vs hand-written at scale.** The real organisational trade-off: a grammar as the single source of truth and broad tooling, versus maximal control over errors and zero build dependency. Both ship at large companies; the choice is about team, longevity, and error-quality requirements.
- **Governance.** Who owns the grammar? How are changes reviewed when many teams write the language? How do you keep a DSL from forking into dialects?
- **Lifecycle and exit.** Migration tooling, deprecation policy, and the question every DSL eventually faces: keep it, or migrate users off it?

The internal/external choice is itself a TCO decision here. Embedding an existing safe language (Lua, **Starlark**, Google's **CEL**, WASM) is often the wise middle path: you get an external-style sandboxed expression surface *without* building and maintaining a parser, evaluator, and tooling from scratch. Building a fully bespoke external DSL is justified only when no existing language gives you the syntax, semantics, or guarantees the domain demands — and you can fund it forever.

> 🎓 **Why this matters at the professional level:** The most expensive DSL mistakes are organisational, not technical: building a language that should have been a config schema; letting an unowned grammar drift into dialects; or shipping a DSL with no migration path and discovering, years later, that you cannot change it because thousands of customer files would break. This page is about not making those mistakes.

---

## Prerequisites

- **Required:** The senior-level material — compiling vs interpreting, sandboxing untrusted input, grammar versioning, and the tooling burden.
- **Required:** Experience owning a long-lived component: deprecation, backward compatibility, on-call, and the reality of migrating real users.
- **Helpful:** Familiarity with at least one embeddable language (Lua, Starlark, CEL, WASM, Jsonnet) as an *alternative* to building your own.
- **Helpful:** Having participated in a build-vs-buy decision and seen its consequences play out over years.

This level is deliberately light on new code; the leverage is in judgment, not syntax.

---

## Glossary

| Term | Definition |
|------|-----------|
| **TCO (total cost of ownership)** | The full lifetime cost of a DSL: build, tooling, docs, support, security review, onboarding, migration, deprecation. Dominated by everything after the parser. |
| **Build-vs-buy** | The decision to create a bespoke DSL versus adopting an existing language/library/config format. |
| **Embeddable language** | An existing sandboxable language you host instead of writing your own: Lua, **Starlark** (Bazel's Python subset), **CEL** (Google's Common Expression Language), **WASM**, Jsonnet. |
| **Governance** | The process and ownership model for changing a shared language: who approves grammar changes, how dialects are prevented. |
| **Dialect drift** | When teams extend or fork the DSL locally, producing incompatible variants of "the same" language. |
| **Conformance suite** | The authoritative corpus of programs + expected results that defines what the language *is*, independent of any one implementation. |
| **Spec** | A written, versioned definition of the grammar and semantics — the source of truth a parser must match. |
| **Sunset / deprecation** | The managed removal of a DSL or a feature, with timelines, warnings, and migration tooling. |
| **Lock-in (good and bad)** | Users investing in DSL files. Good: adoption. Bad: it constrains your ability to change or retire the language. |
| **Bus factor** | How many people understand the DSL implementation. A bus factor of one is a top organisational risk for homegrown languages. |
| **ANTLR** | A parser generator: grammar `.g4` → generated lexer/parser/visitor in many languages. The common "buy" option for the front end. |

---

## Core Concepts

### 1. The default answer is *don't build a DSL*

Building a language is one of the highest-commitment decisions an engineering org can make, because it creates a permanent dependency that exists nowhere else in the world. Before building, exhaust the cheaper options in order:

1. **A library / API.** If the need is "let users compose operations," a well-designed library (or an internal DSL — method chains) often suffices, with zero parser, the host's tooling, and no new language to learn.
2. **A config schema.** If the need is structured data, use JSON/YAML/TOML with a schema (JSON Schema, protobuf). Declarative, validated, tooled, and not a programming language.
3. **An existing embeddable language.** If users need real expressions or logic over untrusted input, embed **CEL** (designed exactly for safe, total expression evaluation in config/policy), **Starlark** (deterministic, sandboxable, Python-like — used by Bazel), **Lua** (small, fast, embeddable), or run **WASM**. You inherit a spec, an implementation, sandboxing, and often tooling.
4. **A bespoke external DSL.** Only when the domain genuinely needs syntax or semantics none of the above provides, *and* you can fund the full TCO indefinitely.

Most "we need a DSL" requests are satisfied at step 2 or 3. Reaching step 4 should be a deliberate, well-justified decision with a named owner and a budget.

### 2. Total cost of ownership

Model the DSL as a product over ~5–10 years:

- **Build (small):** grammar, lexer, parser, evaluator/transpiler.
- **Tooling (large, ongoing):** LSP, formatter, highlighting, playground, debugger.
- **Docs & enablement (ongoing):** reference, tutorials, examples, the answer to "why isn't this Python."
- **Support & on-call (ongoing):** every hung formula, every confusing error, every "my file stopped working."
- **Security (ongoing):** review of each builtin/capability; response to each sandbox-escape report.
- **Evolution (ongoing):** versioning, migration tooling, conformance maintenance.
- **Onboarding (ongoing, hidden):** every engineer who joins must learn a language with no Stack Overflow, no books, no transferable skills.
- **Exit (eventual, large):** migrating users off, or maintaining it in perpetuity.

The parser is maybe 5% of this. Teams that budget only for the parser are the teams whose DSL becomes an unloved liability.

### 3. ANTLR vs hand-written at production scale

This is the most common concrete fork, and both choices ship in major systems:

**ANTLR (buy the front end).**
- *Wins:* the grammar `.g4` is the single source of truth and doubles as documentation; generation targets many languages (one grammar, parsers in Java/Go/Python/JS/C#); fast to evolve a large grammar; mature visitor/listener tooling.
- *Costs:* a build-step and runtime dependency; default error messages are generic (you invest in custom error strategies to make them good); less control over recovery; another tool the team must know.
- *Fits:* large, formal, relatively stable grammars; multi-language consumers of the same DSL; teams that value the grammar-as-spec property.

**Hand-written (recursive descent / Pratt).**
- *Wins:* best-in-class error messages and recovery (the reason Go, Clang, `rustc`, and TypeScript hand-write theirs); no build dependency; total control; easy incremental parsing for an LSP.
- *Costs:* more code to write and maintain; the grammar lives in your head and code, not a single artifact, unless you keep a spec; harder to retarget to other languages.
- *Fits:* user-facing languages where error quality is paramount; performance-critical front ends; teams with the expertise to maintain a parser.

A pragmatic pattern: prototype with ANTLR to validate the grammar quickly, and if error quality or LSP needs demand it, reimplement the front end by hand once the language stabilises.

### 4. Governance: keeping one language one language

A DSL used by many teams needs an ownership model, or it forks:

- **A single owning team / spec owner.** Grammar changes go through one review gate. Without it, teams add local keywords and you get dialects that can't share files or tooling.
- **A versioned spec and a conformance suite** as the source of truth — not "whatever the parser does." Multiple implementations (interpreter, transpiler, linter, LSP) must all pass the suite.
- **A change process** with backward-compatibility review, deprecation policy, and migration tooling required for breaking changes.
- **A deprecation budget.** Removing a feature costs warnings, migration tools, and customer communication; plan it like any product change.

### 5. Lifecycle and exit

Every DSL eventually faces one of three fates: it thrives (and the TCO is justified), it stagnates (becomes legacy nobody can change), or it is retired. Plan for exit from the start:

- **Migration tooling** (the AST-to-source printer again) turns "we must rewrite thousands of files" into "we ran a tool."
- **A deprecation policy** with timelines and warnings prevents indefinite limbo.
- **An honest periodic review:** is the language still worth its TCO, or should users migrate to an embeddable language or a library? Killing a DSL that has outlived its value is a senior-leadership win, not a failure.

---

## Real-World Analogies

**A DSL is a company pet that becomes a company dependency.** Adopting it is a few hours; feeding, vet bills, and finding a sitter for the next decade is the real commitment. Adopt only if you can care for it for its whole life.

**Build-vs-buy is renting power tools vs forging your own.** CEL/Starlark/Lua are the rental counter: standardised, maintained, good enough for almost everyone. Forging a bespoke language is justified only when no tool on Earth has the shape you need — and you accept becoming the blacksmith forever.

**Governance is keeping one shared language one language.** Without a spec owner, a company-wide DSL fragments into per-team dialects the way a shared codebase fragments into incompatible forks — each locally convenient, collectively unmaintainable.

**The conformance suite is the constitution.** The parser is one administration's interpretation; the suite is the law that every implementation and every version must obey. When they disagree, the suite wins.

**ANTLR vs hand-written is a prefab house vs an architect-built one.** Prefab (ANTLR) goes up fast from a standard plan and is easy to replicate; architect-built (hand-written) gives a perfect, bespoke result and flawless finish, at higher cost and craft.

---

## Mental Models

- **A DSL is a product, not a feature.** It needs an owner, a roadmap, support, docs, and an end-of-life plan. Treat it like one or it rots.
- **The parser is 5% of the cost.** Decisions that only weigh build effort are wrong by an order of magnitude. Weigh the lifetime.
- **Prefer to host an existing language over inventing one.** CEL/Starlark/Lua/WASM give external-DSL safety and power without owning a front end and tooling. Bespoke is the exception, not the default.
- **A spec + conformance suite, not an implementation, defines the language.** This is what lets you have multiple back ends, multiple versions, and a migration path without ambiguity.
- **Lock-in cuts both ways.** Every user file is adoption *and* a constraint on your freedom to change. Design migration tooling early so lock-in never becomes a trap.
- **Bus factor one is an incident waiting to happen.** A homegrown language understood by a single engineer is among the riskiest assets an org can hold.

---

## Code Examples

This level is judgment-heavy; the "code" is decision frameworks and a sketch of the one tool that pays for itself.

### A build-vs-buy decision checklist (as a rubric)

```text
Need: users must express <X> over <data>.

1. Is it structured data with no logic?
     → Config schema (JSON/YAML + JSON Schema / protobuf). STOP. Don't build a language.

2. Is it "compose operations" callable by programmers?
     → Library / internal DSL in the host language. STOP.

3. Does it need safe expressions/logic over UNTRUSTED input?
     → Embed CEL (policy/filters), Starlark (deterministic config), Lua/WASM (general).
       You get a spec, sandbox, and tooling for free. STRONGLY PREFER THIS.

4. Do you need bespoke SYNTAX or SEMANTICS none of the above can express,
   AND can you fund LSP + formatter + docs + security + migration for ~10 years?
     → Only now consider a bespoke external DSL. Name an owner. Budget the TCO.

If you reached step 4 without a hard "yes" on both clauses, go back to step 3.
```

The value of writing this down is that it forces the expensive option to *earn* its place rather than being the exciting default.

### A TCO worksheet (illustrative numbers)

```text
Component              First year     Per year after
--------------------   -----------    --------------
Grammar + parser       3 wk           0.5 wk  (bug fixes)
Evaluator/transpiler   3 wk           1 wk
Sandbox + sec review   2 wk           1 wk  (each new builtin)
LSP                    6 wk           3 wk
Formatter + highlight  2 wk           1 wk
Docs + playground      4 wk           2 wk
Support / on-call      —              0.5 FTE
Migration tooling      2 wk           1 wk  (per breaking change)
Onboarding tax         —              hidden, every new hire

Rule of thumb: the parser is ~5% of lifetime cost.
If you cannot staff the rest, you are not building a DSL — you are
building a liability that one person will resent maintaining.
```

### Migration tooling: the one tool that earns its keep

A version migrator built on the AST-to-source printer turns lock-in from a trap into a non-event. It is the same printer used by the formatter, applied after an AST transform.

```python
# v1 -> v2: rename keyword `eq` to `=` across every user file, mechanically
def migrate_v1_to_v2(node):
    if node[0] == "cmp" and node[1] == "eq":
        node = ("cmp", "=", node[2], node[3])
    # ...recurse into children, rewriting...
    return node

# pipeline:  parse_v1(text) -> migrate_v1_to_v2(ast) -> to_source_v2(ast)
# run over the whole corpus -> every file upgraded, no human edits.
```

Because you own the parser *and* the printer, "we changed the language" becomes a script, not a quarter of customer-coordinated rewrites. Organisations that skip this tooling discover their grammar is effectively frozen the day they get real users.

---

## Pros & Cons

**Building a bespoke external DSL** — *for:* perfect fit to the domain, full control of syntax/semantics/safety, a differentiator if the language *is* the product; *against:* enormous lifetime TCO, onboarding tax, bus-factor risk, and a permanent dependency that exists nowhere else.

**Embedding an existing language (CEL/Starlark/Lua/WASM)** — *for:* sandboxed external-style power with a fraction of the cost; inherited spec, implementation, and often tooling; transferable skills; *against:* you accept that language's syntax and limits; integration and version-tracking work; less perfect a fit.

**Config schema** — *for:* cheapest, declarative, fully tooled, safe; *against:* cannot express logic; tempts feature creep toward an accidental language.

**Library / internal DSL** — *for:* zero parser, host tooling, low cost; *against:* tied to host syntax and one language; no domain-specific errors; weaker untrusted-input story.

**ANTLR front end** — *for:* grammar-as-spec, multi-language generation, fast for big grammars; *against:* build dependency, generic errors by default, a tool to maintain.

**Hand-written front end** — *for:* superb errors, no deps, LSP-friendly; *against:* more code to own, no single grammar artifact unless you keep a spec.

---

## Use Cases

- **Policy/authorization expressions** → embed **CEL** rather than building one; it is purpose-built, total, and sandboxed.
- **Deterministic build/config logic** → **Starlark** (as Bazel does) rather than a homegrown config language with creeping features.
- **General embedded scripting** → **Lua** or **WASM** for plugins and user extensions, sandboxed by the host.
- **A bespoke DSL where the language is the product** → query languages, schema languages, or hardware-description languages where syntax/semantics are core differentiators and the org commits to full ownership (e.g. companies that maintain their own query or rules language as a flagship feature).
- **Large stable grammars consumed by many languages** → ANTLR-generated front ends (many real DSLs ship a `.g4` and generated visitors).
- **User-facing languages where errors are the experience** → hand-written front ends (the reason mainstream compilers hand-write theirs).

---

## Coding Patterns

### Pattern: decision rubric before any code

Run the build-vs-buy checklist and require a hard yes on "no existing language fits" *and* "we can fund the TCO" before writing a grammar.

### Pattern: spec + conformance suite as source of truth

Define the language by a versioned spec and a corpus of programs/expected results. Every implementation (interpreter, transpiler, LSP, linter) must pass it; the parser is not the definition.

### Pattern: single owning team and change gate

Route all grammar changes through one owner with backward-compatibility and deprecation review. Prevents dialect drift across teams.

### Pattern: migration tooling as a first-class deliverable

Ship the AST-to-source printer and a migrator alongside v1. Breaking changes become scripts, not customer-coordinated rewrites.

### Pattern: prefer hosting CEL/Starlark/Lua/WASM

When users need safe logic over untrusted input, host an existing sandboxable language before inventing one. Reserve bespoke DSLs for genuine gaps.

### Pattern: periodic TCO review

Schedule a recurring review: is the DSL still worth its cost, or should users migrate to an embeddable language? Retire deliberately.

---

## Best Practices

- **Make "don't build a language" the default.** Force the bespoke option to beat config, libraries, and embeddable languages on a written rubric.
- **Budget the whole life, not the parser.** Staff tooling, docs, support, security, and migration before committing, or don't commit.
- **Name an owner and kill bus-factor-one.** A company-critical language needs more than one person who understands it, and a written spec so it survives turnover.
- **Define the language by a spec + conformance suite.** Implementations conform to it; it does not conform to an implementation.
- **Prefer embedding (CEL/Starlark/Lua/WASM)** over inventing whenever the domain allows; you inherit safety, tooling, and transferable skills.
- **Ship migration tooling with v1.** Never let real-world adoption silently freeze your grammar.
- **Govern to prevent dialects.** One owning team, one change gate, one conformance suite.
- **Plan the exit.** A deprecation policy and an honest retirement option are signs of a mature DSL program, not a failing one.

---

## Edge Cases & Pitfalls

- **Building a language that should have been a schema.** The most common and most expensive error: a config need answered with a bespoke language, complete with parser, tooling debt, and onboarding tax.
- **Budgeting only the parser.** The language ships in two weeks and then consumes a fraction of an FTE forever in support, docs, and tooling nobody planned for.
- **Bus factor one.** The author leaves; the language becomes unchangeable folklore. A spec and a second maintainer are non-negotiable for anything load-bearing.
- **No migration path → frozen grammar.** Real users arrive, breaking changes become impossible, and the language calcifies. Migration tooling shipped late is shipped too late.
- **Dialect drift.** Without governance, teams fork the grammar locally; files and tooling stop being shareable, and "the DSL" becomes several incompatible languages.
- **Reinventing CEL/Starlark/Lua.** Building a sandboxed expression language from scratch when a maintained, spec'd, sandboxed one already exists — paying full TCO to reach a worse outcome.
- **Treating ANTLR's defaults as production-ready.** Generic generated error messages frustrate users; if errors matter, budget custom error strategies or hand-write the front end.
- **Lock-in mistaken for success.** Heavy adoption feels like a win until you must change the language and discover you cannot. Adoption is also a constraint; design for change from day one.
- **No exit plan.** Treating the DSL as eternal. Every language should be periodically re-justified against its TCO, with a real option to migrate users off it.

The professional view closes the loop: an external DSL is a long-lived product whose cost is dominated by everything after the parser, whose health depends on governance and a spec, and whose existence should be the exception that beat config, libraries, and embeddable languages on the merits. Build one only when the domain truly demands it and you can own it for its whole life — and when you do, ship the spec, the tooling, and the migration path alongside the grammar.
