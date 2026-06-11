# Why & What to Document — Junior Level

> **Category:** [Documentation](../README.md) — what an engineer documents, where it belongs, and how to keep it alive. This topic is the map: *why* documentation exists at all, and *what* the different kinds are.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Why Document At All](#why-document-at-all)
5. [What to Document: The Spectrum and Its Audiences](#what-to-document-the-spectrum-and-its-audiences)
6. [The Diátaxis Framework](#the-diataxis-framework)
7. [What *Not* to Over-Document](#what-not-to-over-document)
8. [Real-World Analogies](#real-world-analogies)
9. [Mental Models](#mental-models)
10. [A Worked Example: Documenting a Small Library](#a-worked-example-documenting-a-small-library)
11. [Examples](#examples)
12. [Best Practices](#best-practices)
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)
20. [Diagrams](#diagrams)

---

## Introduction

> Focus: **What is it?** and **How to use it?**

Code tells you *what* the program does and *how* it does it — that's literally what source code is. What code cannot tell you is **why it exists, how you're supposed to use it, what was decided and rejected along the way, and how to keep it running in production.** That second layer is **documentation**, and learning *what* belongs in it (and what doesn't) is a craft in its own right.

This first topic is deliberately not about *how to write well* or *which tool to use*. It's about two prior questions every engineer must answer before writing a single doc:

> 1. **Why** am I writing this down at all — what does the team lose if I don't?
> 2. **What** kind of document is this, and **who** is it for?

Get those two right and the rest of documentation is mostly execution. Get them wrong — write the wrong kind of doc for the wrong reader — and even beautifully written documentation fails, because a reference page can't teach a beginner and a tutorial can't answer an expert's lookup. The single most useful tool for answering question 2 is the **Diátaxis framework**, which is the spine of this topic.

### Why this matters

Documentation is the most consistently neglected engineering skill — not because engineers can't write, but because nobody taught them *what* to document. So they either write nothing (and the knowledge lives only in someone's head) or they write the wrong thing (a wall of prose that restates the code and rots in a month). Both failures are expensive, and both are avoidable once you can name the *types* of documentation and map each to its *audience*.

---

## Prerequisites

- **Required:** You can read and write code in at least one language, and you've used software that came with documentation (a README, an API reference, a tutorial) — so you know the reader's experience.
- **Helpful:** Exposure to the difference between [code comments](../02-code-comments-and-docstrings/junior.md) (which live *in* the code) and standalone documents — this topic is about the whole spectrum, comments included.
- **Helpful:** A feel for the distinction between *what code does* and *why it does it*, covered from the comment angle in [Clean Code → Comments](../../clean-code/03-comments/junior.md).
- **No tooling required.** This topic is about *deciding* what to document, not about doc generators or sites — that's [Docs as Code & Tooling](../10-docs-as-code-and-tooling/junior.md).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Documentation** | The recorded knowledge *around* code: why it exists, how to use it, what was decided, how to operate it. The layer source code can't express. |
| **Audience** | The specific reader a doc is written for — end user, API consumer, contributor, future maintainer, operator, decision-maker. |
| **Diátaxis** | A framework (Daniele Procida) that splits documentation into four modes — tutorials, how-to guides, reference, explanation — by what the reader needs. |
| **Tribal knowledge** | Knowledge that exists only in people's heads and gets passed verbally; lost when those people leave. The thing documentation converts into a durable asset. |
| **Bus factor** | The number of people who can leave (or "be hit by a bus") before a project stalls because only they understood it. Documentation raises it. |
| **Doc rot** | Documentation that has drifted out of sync with the code it describes, so it now actively misleads. |
| **Documentation debt** | The accumulated gap between what *should* be documented and what is — like technical debt, it compounds and is paid back painfully. |
| **Minimum viable documentation** | Google's framing: the smallest doc that genuinely helps the reader, kept close to the code, beats a comprehensive doc nobody maintains. |

---

## Why Document At All

The honest starting point: documentation is *work*, and work needs a justification. Here's the justification, concretely.

**Code captures the *what* and *how*. It cannot capture the *why*.** Read a function and you can see *that* it retries three times with exponential backoff. You cannot see *why three* — was it a vendor SLA, a guess, a hard-won lesson from an outage? That "why" is the knowledge that prevents the next engineer from "simplifying" it to one retry and re-triggering the outage. Code shows the decision; documentation preserves the *reasoning behind* the decision.

**The cost of *not* documenting is real and recurring:**

| Failure mode | What it costs |
|---|---|
| **Tribal knowledge** | The system only works while specific people are present; their vacation is a risk, their resignation is a crisis. |
| **Repeated questions** | The same "how do I set this up?" asked in chat ten times — each answer interrupts an expert and is never captured. |
| **Wrong assumptions** | A new engineer guesses *why* the code is shaped a certain way, guesses wrong, and "fixes" something that wasn't broken. |
| **Slow onboarding** | A new hire who could be productive in a week takes a month because the setup, the *why*, and the gotchas live only in conversations. |
| **Incidents** | The 3 a.m. page where the on-call engineer has no runbook and has to reverse-engineer a system under pressure. |

**Documentation is how a team scales beyond its original authors.** The first version of any system is understood perfectly by the two people who built it — and they need no docs. The problem arrives at person three, person ten, and at the original authors themselves eighteen months later when they've forgotten. Documentation **raises the bus factor**: it turns knowledge that lives in heads (fragile, un-shareable) into an asset the whole team owns.

> A blunt way to put it: *every question a teammate has to ask you is a doc you didn't write. Every wrong assumption someone makes is a "why" you didn't record.*

---

## What to Document: The Spectrum and Its Audiences

"Documentation" is not one thing. It's a **spectrum of document types**, and the key skill is matching each *type* to its *audience*. A doc written for the wrong reader fails no matter how good the writing is.

The six audiences an engineer's documentation serves:

| Audience | They are trying to… | The doc type they need |
|---|---|---|
| **End users** | Use the product to get a job done | Tutorials, how-to guides, user manuals |
| **API consumers** | Call your code/service correctly | API reference, integration guides, runnable examples |
| **Contributors** | Add to or change the codebase | README, `CONTRIBUTING`, architecture overviews, setup docs |
| **Future maintainers** | Understand *why* the code is the way it is | Code comments/docstrings, design docs, ADRs |
| **Operators / on-call** | Run, monitor, and recover the system | Runbooks, operational docs, incident playbooks |
| **Decision-makers** | Understand and agree on direction before building | Design docs, RFCs, ADRs |

The two failure patterns of beginners are both *audience* errors:

- **Writing for the wrong audience** — an API reference written as a beginner tutorial (slow, hand-holding, no exhaustive parameter list) frustrates the expert who just needs the signature.
- **Forgetting an audience entirely** — most teams document the *user* and forget the *operator* (no runbook) and the *future maintainer* (no record of *why*). Those gaps surface as 3 a.m. pages and "why on earth is this code like this?" months later.

> The discipline is: before writing, name the reader and what they're trying to do. The doc type follows from that.

---

## The Diátaxis Framework

The single most important model for *what to document* is **Diátaxis**, created by **Daniele Procida**. It observes that documentation serves **four distinct needs**, and that the classic failure of technical writing is *mixing them into one document.* Each need wants a different kind of writing.

The four modes:

> - **Tutorial** — *learning-oriented.* A lesson that takes a beginner by the hand through a sequence of steps to a successful outcome. Goal: the learner gains confidence and competence. ("Let's build your first chart together.")
> - **How-to Guide** — *task-oriented.* A recipe that gets a *competent* user through a specific real-world task. Goal: solve a problem. ("How to add authentication to an existing app.")
> - **Reference** — *information-oriented.* A dry, exhaustive, accurate description of the machinery: every function, flag, parameter, error code. Goal: look something up and trust it. ("`connect(host, port, timeout=30)` — raises `TimeoutError`…")
> - **Explanation** — *understanding-oriented.* Discussion that illuminates the *why* — background, design rationale, alternatives considered. Goal: deepen understanding. ("Why we chose optimistic locking.")

### The 2×2 that organizes them

Diátaxis arranges the four modes on two axes: whether the reader is **studying** (learning the skill) or **working** (applying it), and whether the content is **practical** (steps/actions) or **theoretical** (knowledge/concepts).

```
                    PRACTICAL                 THEORETICAL
                 (steps / action)          (knowledge / cognition)
              ┌───────────────────────┬───────────────────────────┐
   STUDYING   │   TUTORIALS           │   EXPLANATION             │
  (learning)  │   learning-oriented   │   understanding-oriented  │
              │   "take me by hand"   │   "help me understand why"│
              ├───────────────────────┼───────────────────────────┤
   WORKING    │   HOW-TO GUIDES       │   REFERENCE               │
  (applying)  │   task-oriented       │   information-oriented    │
              │   "help me do X"      │   "tell me the details"   │
              └───────────────────────┴───────────────────────────┘
```

A simple way to remember the split:

| | Serves *acquisition* of skill (study) | Serves *application* of skill (work) |
|---|---|---|
| **Action** (practical) | **Tutorial** | **How-to Guide** |
| **Cognition** (theory) | **Explanation** | **Reference** |

### The classic failure: mixing modes

The reason Diátaxis matters is that it names a mistake nearly everyone makes: **trying to do all four jobs in one document.** Symptoms:

- A **tutorial** that stops to explain design rationale → the beginner loses the thread (explanation belongs in its own place).
- A **how-to guide** that teaches concepts from scratch → the competent user, who just wants the steps, gets bored and frustrated.
- A **reference** page padded with tutorials → it becomes un-scannable; you can no longer just *look something up*.
- An **explanation** cluttered with copy-paste commands → the reader trying to understand *why* gets derailed into *how*.

> Diátaxis's prescription: **keep the four modes separate.** Link between them, but don't blend them. A reader is always in exactly one mode — learning, doing, looking up, or understanding — and a document that tries to serve all four serves none well.

This is why "what to document" is not one question but four. For any feature, ask: *Is there a tutorial path for a newcomer? A how-to for the common task? Complete reference for the API? An explanation of the key decisions?* The gaps tell you what to write.

---

## What *Not* to Over-Document

Documentation has a cost on *both* sides: too little leaves knowledge trapped in heads; too much creates a liability. More docs is not better docs.

**Don't write docs that:**

- **Restate the code.** A comment `i = i + 1  # increment i` or a doc that narrates line-by-line what the code already says adds nothing and must be maintained forever. (See [Clean Code → Comments](../../clean-code/03-comments/junior.md) for the comment-level version of this rule.)
- **Are guaranteed to rot.** Documenting exact values that change often (current version numbers, line numbers, a list that mirrors an enum) creates docs that are *wrong by tomorrow*. Generate those from the source instead, or don't write them.
- **Are ceremony nobody reads.** A mandated design doc for a one-line fix, a 40-page template filled in to satisfy a process — the writing cost is real and the reader count is zero.

**The liability of stale docs:** a wrong doc is *worse than no doc*, because no doc makes you go read the code, while a wrong doc makes you confidently do the wrong thing. This is **doc rot**, and it's why the volume you write should be the volume you can keep *true*. (The whole discipline of fighting it lives at [Keeping Docs Alive](../11-keeping-docs-alive-and-doc-rot/junior.md).)

> **Documentation debt** is the right framing: like technical debt, unmaintained docs accrue interest. The cheapest documentation to keep correct is the *least* documentation that still answers the reader's real questions — Google's **minimum viable documentation** idea.

---

## Real-World Analogies

| Concept | Analogy |
|---|---|
| **Code vs. docs (what/how vs. why)** | A recipe's ingredient list tells you *what's* in the dish; the headnote tells you *why* the chef adds the lemon last. The list is the code; the headnote is the doc. |
| **Diátaxis four modes** | A music school: a **lesson** with a teacher (tutorial), a **how-to** for tuning your guitar (how-to), the **chord dictionary** (reference), and an **essay on why jazz uses those chords** (explanation). Each is a different book; you'd never merge them. |
| **Tribal knowledge / bus factor** | A village where only the eldest knows where the well is. Fine until she's away — then everyone's thirsty. Writing down the well's location is documentation. |
| **Doc rot** | A map with a bridge that washed away years ago. Worse than no map — it sends you confidently to a river with no crossing. |
| **Over-documentation** | Labeling every single screw in a flat-pack box "screw." Effort spent telling people what they can already see. |
| **Minimum viable docs** | A trail marker every 100m — enough to keep you on the path, not a paragraph at every step. |

---

## Mental Models

**Model 1 — Documentation is the *why* layer.** Code is self-documenting about *what* and *how*; you almost never need a doc to explain mechanics that good names and structure already show. You need docs for everything code *can't* say: intent, usage, decisions, operations. When deciding whether to document something, ask: *Can the reader get this from the code itself?* If yes, don't write it. If no, that's exactly the gap docs fill.

**Model 2 — Name the reader first.** Every doc has exactly one primary audience and one job they're doing. Before writing, finish this sentence: *"This helps a **[audience]** who is trying to **[task]**."* If you can't, you don't yet know what you're writing.

**Model 3 — The four Diátaxis quadrants as a checklist.** For any non-trivial feature, the four modes are a coverage map:

```
   Newcomer? ........... Tutorial      (do they have a guided first success?)
   Doing a task? ....... How-to        (is the common job recipe-ized?)
   Looking up? ......... Reference     (is every API/flag/error listed?)
   Wants the why? ...... Explanation   (is the key decision recorded?)
```

The empty quadrants are your documentation backlog.

---

## A Worked Example: Documenting a Small Library

You've built `retry` — a tiny library that retries a function with exponential backoff. A junior often "documents" it by writing one long README that does everything badly. Let's instead apply *audience + Diátaxis*.

**Step 1 — Who are the audiences?** API consumers (call it correctly) and contributors (extend it). End users and operators don't apply to a library. So we need primarily **reference** and a little **how-to** and **explanation**.

**Step 2 — Reference (information-oriented).** Exhaustive, dry, accurate:

```markdown
## `retry(fn, *, attempts=3, backoff=0.5, exceptions=(Exception,))`

Calls `fn` and re-invokes it on failure with exponential backoff.

- `fn` — zero-arg callable to execute.
- `attempts` — total tries, including the first. Must be ≥ 1. Default `3`.
- `backoff` — base delay in seconds; delay before retry *n* is `backoff * 2**(n-1)`.
- `exceptions` — tuple of exception types that trigger a retry. Others propagate.

**Returns** the return value of `fn`.
**Raises** the last exception if all attempts fail.
```

**Step 3 — How-to (task-oriented).** A competent user with a real task:

```markdown
### How to retry only on network errors

retry(fetch, attempts=5, exceptions=(ConnectionError, TimeoutError))
```

**Step 4 — Explanation (understanding-oriented).** The *why* — the knowledge the code can't show:

```markdown
### Why exponential backoff (and not a fixed delay)

A fixed retry delay makes every client retry in lockstep, hammering a
recovering service in synchronized waves (the "thundering herd"). Doubling
the delay spreads retries out and gives the dependency room to recover.
We default to 3 attempts because our downstream SLA recovers within ~2s.
```

That last paragraph is the most valuable doc here: it stops a future maintainer from "simplifying" the backoff into a constant and re-causing the very problem it solves.

**Step 5 — Tutorial?** For a four-line library, a full guided lesson is over-documentation — a single runnable example in the README is enough. *We deliberately skip the tutorial mode* because the audience (already-competent API consumers) doesn't need hand-holding. Knowing *what not to write* is half the skill.

Notice what we did **not** document: we didn't narrate the implementation line-by-line (the code shows that), and we didn't write a config-options doc for options that don't exist. We documented the *interface*, the *common task*, and the *surprising decision* — and stopped.

---

## Examples

### A README front-matter that names its audiences (good)

```markdown
# Paywall Service

A service that gates premium content. **If you are…**
- **integrating with it** → see [API Reference](docs/api.md).
- **running it on-call** → see [Runbook](docs/runbook.md).
- **changing the code** → see [Contributing](CONTRIBUTING.md) and [Architecture](docs/architecture.md).
- **wondering why it exists** → see [ADR-0001: Why a separate service](docs/adr/0001.md).
```

This README does almost no explaining itself — it *routes each audience to the right doc*. That's the spectrum and audience-mapping made concrete.

### A docstring that documents the *why*, not the *what* (good)

```python
def normalize_phone(raw: str) -> str:
    # WHY: upstream CRM rejects numbers with spaces or '+', so we strip to
    # bare digits even though E.164 with '+' is technically more correct.
    # See ADR-0014; do not "fix" this to keep the '+' without updating CRM.
    return "".join(ch for ch in raw if ch.isdigit())
```

The code already shows *what* it does (strip non-digits). The comment records the *why* — the constraint and the decision — which is the only part worth writing.

### Doc that restates the code (bad — don't write this)

```python
def get_user(id):
    # This function gets a user by id. It takes an id and returns a user.
    return db.users.find(id)
```

The docstring adds zero information the signature doesn't already give. It's pure cost: another thing to keep in sync, that will rot the moment the behavior changes.

---

## Best Practices

1. **Name the reader and their task before writing a word.** "This helps a *[who]* who is trying to *[what]*." If you can't fill that in, stop.
2. **Pick one Diátaxis mode per document.** A doc is a tutorial *or* a how-to *or* reference *or* explanation — link between them, don't blend them.
3. **Document the *why*, the *interface*, and the *surprises*.** These are the three things code can't tell you and good engineers record by instinct.
4. **Prefer the minimum that helps.** The least documentation that answers the real question, kept next to the code, beats a comprehensive doc nobody maintains.
5. **Don't restate the code.** If a good name or the signature already says it, deleting the doc *improves* the codebase.
6. **Cover the forgotten audiences.** Most teams remember users and forget operators (no runbook) and maintainers (no recorded *why*). Check those quadrants.
7. **Write down decisions as you make them** — the rationale is freshest now and gone by next week. (Formalized as [ADRs](../05-architecture-decision-records-adrs/junior.md).)

---

## Common Mistakes

1. **One mega-doc that does everything.** A README that is simultaneously tutorial, how-to, reference, and explanation — the Diátaxis anti-pattern. It serves no reader well.
2. **Documenting the *what*, ignoring the *why*.** Narrating what the code does (which the code already shows) while never recording *why* it's shaped that way (which is the only thing at risk of being lost).
3. **Forgetting the operator and the maintainer.** Documenting how to *use* the system but not how to *run* it or *why* it's built that way — the gaps that cause incidents and bad "fixes."
4. **Over-documenting trivia.** Comments that restate code, lists that mirror an enum, exact values guaranteed to change — all pure liability.
5. **Treating "more docs" as "better docs."** Volume you can't keep true becomes doc rot, which is *worse* than no docs.
6. **Writing the doc for yourself.** Documenting at *your* level of knowledge, not the reader's — the curse of knowledge. The reader is not you-who-just-built-it.

---

## Tricky Points

- **A reference is not a tutorial, even though both "describe the thing."** Reference is for someone who *already knows* and needs a lookup; a tutorial is for someone who *doesn't yet*. Same subject, opposite reader — Diátaxis's whole point.
- **"Self-documenting code" is real but partial.** Good names eliminate the need to document *what/how* — but they can *never* document *why* (the decision, the constraint, the rejected alternative). Self-documenting code reduces documentation; it doesn't remove it. (More at [Middle](middle.md) and [Clean Code → Comments](../../clean-code/03-comments/middle.md).)
- **The "explanation" mode is the one most often skipped and most often missed later.** It feels optional while you're building (you *know* why). It's the first thing the next person needs and can't get anywhere else.
- **Too little and too much are both failures.** The instinct "I'll just document everything to be safe" produces rot. The instinct "the code is self-documenting, I'll write nothing" loses the *why*. The target is *minimum viable*, audience-matched.

---

## Test Yourself

1. What can documentation capture that source code, by its nature, cannot?
2. Name the four modes of the Diátaxis framework and the reader-need each serves.
3. What are the two axes of the Diátaxis 2×2?
4. Give three concrete audiences an engineer's documentation serves, and a doc type each needs.
5. Why is a *stale* doc often worse than *no* doc?
6. What three things do good engineers document "by instinct"?

<details><summary>Answers</summary>

1. The **why** — why the code exists, what was decided and rejected, how to use it, and how to operate it. Code shows *what* and *how*; the reasoning and usage knowledge live only in docs (or in someone's head).
2. **Tutorial** (learning-oriented — guided first success), **How-to guide** (task-oriented — solve a specific problem), **Reference** (information-oriented — exhaustive, accurate lookup), **Explanation** (understanding-oriented — the *why* and the alternatives).
3. **Study vs. work** (acquiring the skill vs. applying it) and **practical vs. theoretical** (action/steps vs. knowledge/cognition).
4. (Any three) End users → tutorials/how-tos; API consumers → reference + runnable examples; contributors → README/CONTRIBUTING; future maintainers → comments/ADRs/design docs; operators → runbooks; decision-makers → design docs/RFCs/ADRs.
5. No doc forces you to read the code (slow but correct); a stale doc makes you *confidently do the wrong thing*. Wrong information is more dangerous than missing information — this is doc rot.
6. The **why** (decisions/rationale), the **interface** (how to use it correctly), and the **surprises** (the non-obvious gotchas and constraints).

</details>

---

## Cheat Sheet

```text
WHY DOCUMENT
  code = WHAT + HOW   |   docs = WHY + USE + DECISIONS + OPERATE
  not documenting costs: tribal knowledge, repeated Qs, wrong
  assumptions, slow onboarding, 3 a.m. incidents. Docs raise the bus factor.

WHAT TO DOCUMENT — map TYPE → AUDIENCE
  end users ......... tutorials, how-tos        contributors .... README/CONTRIBUTING
  API consumers ..... reference + examples       maintainers ..... comments, ADRs, design docs
  operators ......... runbooks                   decision-makers . design docs, RFCs

DIÁTAXIS — four modes, never mix them
                 PRACTICAL          THEORETICAL
  STUDY    Tutorial            Explanation
  WORK     How-to guide        Reference
  (learn / do / look up / understand — pick ONE per doc)

WHAT NOT TO DO
  - restate the code          - document values that rot
  - ceremony nobody reads      - "more docs" ≠ "better docs"

THE INSTINCT: document the WHY, the INTERFACE, and the SURPRISES.
              minimum viable docs, kept next to the code.
```

---

## Summary

- **Why document:** code expresses *what* and *how*; documentation captures *why it exists, how to use it, what was decided and rejected, and how to operate it.* It's how a team scales past its original authors and raises the **bus factor**.
- **The cost of not documenting** is concrete: tribal knowledge, repeated questions, wrong assumptions, slow onboarding, and incidents.
- **What to document** is a *spectrum* mapped to *audiences*: users, API consumers, contributors, maintainers, operators, decision-makers — each needs a different doc type.
- **Diátaxis** is the spine: four modes — **tutorial, how-to, reference, explanation** — on a study/work × practical/theoretical 2×2. The classic failure is **mixing modes** in one document; keep them separate and link between them.
- **Don't over-document:** docs that restate code, docs guaranteed to rot, and ceremony nobody reads are pure liability. A stale doc is *worse* than no doc.
- **The instinct to build:** document the **why**, the **interface**, and the **surprises** — minimum viable, kept next to the code.

---

## Further Reading

- Daniele Procida, [Diátaxis](https://diataxis.fr/) — the canonical, free description of the four-mode framework.
- Google, [Documentation Best Practices](https://google.github.io/styleguide/docguide/best_practices.html) — origin of "minimum viable documentation."
- *Docs for Developers* (Bhatti, Corleissen, et al.) — practical guide to engineering documentation by audience.
- Write the Docs community, [Documentation Principles](https://www.writethedocs.org/guide/writing/docs-principles/).
- [Clean Code → Comments](../../clean-code/03-comments/junior.md) — the in-code, comment-level view of "document the why, not the what."

---

## Related Topics

- **Next:** [Why & What to Document — Middle](middle.md)
- **The comment-level view:** [Code Comments & Docstrings](../02-code-comments-and-docstrings/junior.md), [Clean Code → Comments](../../clean-code/03-comments/junior.md).
- **The audience-specific doc types:** [READMEs & Onboarding](../03-readmes-and-onboarding-docs/junior.md), [Architecture Decision Records](../05-architecture-decision-records-adrs/junior.md).
- **Keeping it true:** [Keeping Docs Alive & Doc Rot](../11-keeping-docs-alive-and-doc-rot/junior.md).
- **Not this roadmap:** the writing *career* → [Soft-Skills → Technical Writer](../../../../Soft-Skills/technical-writer/).

---

## Diagrams

### The Diátaxis 2×2

```mermaid
quadrantChart
    title Diátaxis — four documentation modes
    x-axis "Practical (action)" --> "Theoretical (cognition)"
    y-axis "Working (apply)" --> "Studying (learn)"
    quadrant-1 "Explanation (understand why)"
    quadrant-2 "Tutorial (guided learning)"
    quadrant-3 "How-to guide (do a task)"
    quadrant-4 "Reference (look it up)"
```

### Doc type → audience map

```mermaid
flowchart LR
    EU[End users] --> TUT[Tutorials / How-tos]
    API[API consumers] --> REF[Reference + examples]
    CON[Contributors] --> RM[README / CONTRIBUTING]
    MNT[Maintainers] --> WHY[Comments / ADRs / design docs]
    OPS[Operators / on-call] --> RB[Runbooks]
    DM[Decision-makers] --> DD[Design docs / RFCs]
```

### The documentation pyramid — volume vs. value

```
            ▲  fewer, highest-value
           ╱ ╲   WHY: decisions, ADRs, explanations  ← code can't say this
          ╱   ╲
         ╱─────╲  HOW TO USE: reference, how-to guides, tutorials
        ╱       ╲
       ╱─────────╲ HOW IT WORKS: comments only where the code can't speak
      ╱___________╲  ← most of "what/how" is the CODE itself, not a doc
        broader, lower marginal value to write
```

[Documentation](../README.md) · [Roadmap](../../README.md) · **Next:** [Middle](middle.md)
