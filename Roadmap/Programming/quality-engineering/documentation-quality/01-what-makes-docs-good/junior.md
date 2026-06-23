# What Makes Docs Good — Junior Level

> **Roadmap:** [Documentation Quality](../README.md) → What Makes Docs Good
> *Every team has docs. Almost none of them know whether those docs are any good. This page teaches you to tell the difference — to look at a page and judge it, the same way you'd judge a piece of code.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Five Qualities of Good Docs](#core-concept-1--the-five-qualities-of-good-docs)
5. [Core Concept 2 — Reader-First: Docs Answer a Question, Not Show Off](#core-concept-2--reader-first-docs-answer-a-question-not-show-off)
6. [Core Concept 3 — "Good" Differs by Doc Type (Diátaxis)](#core-concept-3--good-differs-by-doc-type-diátaxis)
7. [Core Concept 4 — The Concrete Signs of Bad Docs](#core-concept-4--the-concrete-signs-of-bad-docs)
8. [Core Concept 5 — How You'd Even Tell](#core-concept-5--how-youd-even-tell)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What separates docs people actually use from docs people quietly route around?**

You have read good documentation and you have read bad documentation, and you knew the difference instantly — even if you couldn't say *why*. The good page answered your question in thirty seconds. The bad one made you read three paragraphs, copy a command that didn't work, and finally give up and ask a teammate. The information might have been *present* in both. Only one of them was *good*.

That gap — between "the docs exist" and "the docs work" — is the entire subject of this roadmap. Most teams never look at it. They write a README, check a box, and move on, never asking whether anyone can actually use what they wrote. Six months later the install command is wrong, the screenshots show an old UI, half the pages are written for the person who *already knows the answer*, and new hires learn to skip the docs entirely and DM someone instead. The docs didn't fail loudly. They rotted quietly, and nobody was watching.

This page gives you the vocabulary to watch. You'll learn the handful of attributes that make docs good — **accurate, complete enough, findable, clear, current** — the single idea underneath all of them (write for the *reader*, not for yourself), the realization that *different kinds of docs have different definitions of good*, and the concrete, spottable signs that a page has gone bad. By the end you won't just sense that a page is weak. You'll be able to point at exactly what's wrong with it.

> **The mindset shift:** "we have docs" is not "the docs are good." Existence is not quality. A 4,000-word wiki page that's out of date, unfindable, and written for the author is *worse* than no page at all — because it looks like help and then wastes the reader's trust. Start asking the only question that matters: *can the reader who needs this actually use it?*

---

## Prerequisites

- **Required:** You have read documentation to get something done — installed a library, called an API, followed a setup guide — and you remember the experience, good or bad.
- **Required:** You have written *some* docs yourself: a README, a code comment, a wiki page, a pull-request description.
- **Helpful:** You've been blocked by a doc that was wrong, missing, or impossible to find, and had to ask a human instead.
- **Helpful:** You've seen the same question asked in chat over and over, even though "it's in the docs."

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Documentation (docs)** | Any written material whose job is to help a reader understand or use something — READMEs, guides, references, comments, wikis. |
| **Reader / audience** | The specific person a doc is written *for*. Different docs have different readers (a beginner vs. an expert). |
| **Accurate** | The doc matches reality — the code, the API, the actual behavior. The command works; the screenshot is current. |
| **Findable** | The reader can *locate* the doc when they need it, without already knowing where it is. |
| **Doc rot / staleness** | A doc that was once correct but drifted out of sync with the thing it describes, because the thing changed and the doc didn't. |
| **Diátaxis** | A well-known framework that sorts docs into four kinds — tutorial, how-to, reference, explanation — each with its own purpose and its own definition of "good." |
| **Tutorial** | A *learning-oriented* doc that holds your hand through a first success, step by step. |
| **Reference** | An *information-oriented* doc: terse, exhaustive, accurate — a dictionary, not a story. |
| **Audience-fit** | Whether the doc is pitched at the right reader: not too basic, not assuming knowledge they don't have. |

---

## Core Concept 1 — The Five Qualities of Good Docs

When people say a doc is "good," they usually mean a vague feeling. We can do better than a feeling. Good docs share a small set of concrete attributes, and almost every doc problem you'll ever hit is one of these five breaking.

**Accurate** — the doc matches the thing it describes. The install command actually installs. The function signature in the reference matches the function in the code. The screenshot shows the UI as it is *today*. Accuracy is the floor: an inaccurate doc isn't a weak doc, it's an *actively harmful* one, because the reader trusts it and the trust is misplaced. A wrong doc is worse than a missing doc.

**Complete enough** — the doc covers what *this reader* needs to accomplish *this task*. Note the words "enough" and "this reader." Completeness is not "documents every parameter, every edge case, every internal detail." A getting-started guide that drowns a beginner in forty configuration options is *not* more complete — it's broken, because it buried the one thing the beginner needed. Completeness is measured against the reader's goal, not against the size of the codebase.

**Findable** — the reader can locate the doc at the moment of need. The most accurate, complete, beautiful page in the world is worthless if it lives on page 4 of an internal wiki nobody searches. "It's documented" is not the same as "the reader will find it." If the answer exists but the reader ends up asking in chat anyway, the doc *failed at findability* even though every word in it was correct.

**Clear** — the doc is written so a *specific* reader can understand it on the first read. Clarity isn't about big words or polish; it's about the reader's effort. Short sentences, concrete examples, one idea at a time, jargon defined or avoided. A clear doc respects the reader's time and attention.

**Current** — the doc keeps matching reality *over time*, not just on the day it was written. Code changes constantly; docs don't update themselves. A doc that was accurate at launch and is now six versions behind has *rotted*. Currency is accuracy with the clock running — and it's the attribute that fails the most often, because keeping docs in sync is ongoing work that's easy to skip.

> **Key insight:** These five are not independent boxes to tick — they trade against each other, and the trade-offs *depend on the doc*. Cramming in more detail can raise completeness while wrecking clarity. A doc can be 100% accurate and still useless because it's unfindable. Good docs aren't the ones that max every attribute; they're the ones that hit the *right balance for their reader and their purpose*. Holding all five in your head at once is the whole skill.

A tiny illustration. The same fact, written two ways:

**Bad** (inaccurate *and* unclear):

```
To configure the service, set the relevant environment variables
appropriately as documented and restart.
```

**Good** (accurate, clear, complete enough):

```
Set DATABASE_URL to your Postgres connection string, then restart:

    export DATABASE_URL="postgres://localhost:5432/myapp"
    ./myapp restart

If DATABASE_URL is missing, the service exits with: "FATAL: DATABASE_URL not set".
```

The second one tells the reader exactly what to type, what it does, and what failure looks like. The first one is a sentence shaped like help that contains no help at all.

---

## Core Concept 2 — Reader-First: Docs Answer a Question, Not Show Off

There is one idea underneath all five attributes, and once you see it you can't unsee it: **good docs exist to answer the reader's question — not to display the writer's knowledge.**

Most bad docs are bad for the same root reason: they were written from the *author's* head, not for the *reader's* need. The author already knows how the system works, so they write down what's interesting *to them* — the clever internal design, the history of why it's built this way, the exhaustive list of every option — and never ask the only question that matters: *what is the person reading this actually trying to do?*

This is why so much documentation reads like a brag or a brain-dump. It's accurate, it's even thorough, and it's useless, because it answers questions nobody asked while skipping the one question everybody has.

Watch the difference. A reader arrives at the docs for an authentication library. Their question is: *"How do I log a user in?"*

**Author-first** (technically correct, reader-hostile):

```
## Architecture

The AuthManager coordinates a TokenProvider and a SessionStore via the
Strategy pattern. Tokens are JWTs signed with RS256. The SessionStore is
pluggable; the default implementation uses an in-memory LRU cache with a
configurable eviction policy...
```

**Reader-first** (answers the question that was asked):

```
## Log a user in

    const session = await auth.login(email, password);
    // session.token is your JWT — send it as: Authorization: Bearer <token>

Want to know how sessions are stored, or how to swap the backend?
See [Session Storage](./sessions.md).
```

The reader-first version answers the question in two lines and *links* the deep architecture to the people who actually want it. The author-first version makes every reader wade through the internals to find a login call that might not even be there.

> **Key insight:** Before you judge — or write — a doc, name the reader and name their question. "A backend engineer who has never used this library and wants to log a user in." Then read the page and ask: *does it answer that, fast?* Almost every quality problem becomes obvious the moment you hold a real reader and a real question in your mind. Docs that forget the reader are the single most common kind of bad docs.

---

## Core Concept 3 — "Good" Differs by Doc Type (Diátaxis)

Here's the realization that separates people who *judge docs well* from people who just have opinions: **there is no single definition of good docs, because there is no single kind of doc.** A tutorial and a reference manual have *opposite* virtues. Judging them by the same standard is like grading a poem and a phone book on the same rubric.

A widely-used framework called **Diátaxis** (by Daniele Procida) names four fundamentally different kinds of documentation. You don't need the full framework yet — that lives in [Code Craft → Documentation](../../../code-craft/documentation/). What you need at this tier is the realization itself, and the four names:

| Kind | Serves a reader who is... | "Good" means... | Analogy |
|---|---|---|---|
| **Tutorial** | *learning* — a beginner, here for their first success | Holds your hand. Patient, linear, *guaranteed to work* if followed. | A cooking class |
| **How-to guide** | *working* — knows the basics, has a specific task | Goal-focused, terse, assumes competence. Gets you to the result. | A recipe |
| **Reference** | *looking something up* — needs a precise fact | Exhaustive, accurate, terse, *boring on purpose*. No story. | A dictionary |
| **Explanation** | *understanding* — wants the "why" behind it | Discursive, contextual. Discusses trade-offs and background. | A history lesson |

Now the punchline. The thing that makes a **tutorial** good — hand-holding, explaining every step, never assuming knowledge — is exactly what makes a **reference** *bad*. A reference that "holds your hand" is a reference that's too slow to look things up in. And a tutorial that's "terse and exhaustive" like a reference is a tutorial that loses the beginner on step two.

> **Key insight:** The most common documentation disaster isn't a *badly written* doc — it's a doc that mixes types and therefore serves no one. A README that tries to be a tutorial *and* a reference *and* an architecture explainer all at once is too long for the beginner, too chatty for the expert looking something up, and too shallow for the person who wants depth. When a doc feels "off" but you can't say why, check first whether it's trying to be two kinds of doc at the same time. That single test catches an enormous share of real-world doc problems.

So "is this doc good?" is the wrong question. The right question is: **"what kind of doc is this trying to be, and is it good *at that*?"** A terse reference page with no friendly intro isn't cold and unhelpful — it's a *correct reference*. Judge each doc against the standard for its kind.

---

## Core Concept 4 — The Concrete Signs of Bad Docs

You don't need to feel bad docs. You can *spot* them. Here are the recurring, concrete symptoms — the things you can literally point at on a page.

**Out of date.** The command errors out. The screenshot shows a UI that no longer exists. The doc references a function or a flag that was renamed or deleted. This is the most damaging symptom because it *destroys trust*: once a reader hits one wrong instruction, they stop believing the whole page.

```
# README says:
$ myapp init --config=config.yaml
# Reality:
Error: unknown flag --config (did you mean --config-file?)
```

**Wall of text.** A page that's one unbroken slab of prose — no headings, no code blocks, no lists, no place for the eye to land. Even if every word is correct, the reader can't *scan* it to find their answer, so they bounce. Structure is a quality attribute, not decoration.

**No examples.** Pure abstract description of how something works, with nothing the reader can copy and run. For developers especially, *one runnable example is worth ten paragraphs of explanation.* A doc that explains a function's behavior but never *shows it being called* forces the reader to mentally compile it themselves.

```
Bad:  "The retry function accepts a backoff strategy and a maximum
       attempt count, applying the strategy between attempts."

Good: retry(fetchData, { strategy: "exponential", maxAttempts: 3 })
      // waits 1s, 2s, 4s between tries, then gives up
```

**Written for the author, not the reader.** Undefined jargon, knowledge the reader can't be assumed to have, internal project history nobody outside the team cares about, or — the classic — instructions that quietly skip the step that's "obvious" to the author and impossible for the newcomer. (This is Core Concept 2 showing up as a visible symptom.)

**Unfindable.** You *know* the answer is documented somewhere, but you can't get to it: no search, no links, buried five clicks deep, named something only the author would guess. If the team's habit is to ask in chat instead of searching the docs, the docs have a findability problem — full stop.

**Answers a different question than the reader has.** The page about "deploying" actually documents the *internals* of the deploy system, not how to *do* a deploy. The title promises one thing; the content delivers another.

> **Key insight:** None of these require expertise to detect. You don't have to understand the system to notice that the command errored, the page has no examples, or you couldn't find it without help. *The reader's struggle is itself the signal.* If a competent reader bounces off a page, the page is bad — regardless of how correct or complete its author believes it to be. Trust the bounce.

---

## Core Concept 5 — How You'd Even Tell

So a doc *feels* bad, or *feels* fine. How do you move from a feeling to something you can act on? Here are the simple, do-it-today checks — no tooling required. (The automated, measurable versions of all of these are what the rest of this roadmap is about.)

**Run the steps yourself, as the reader.** The single most powerful test there is. Open the doc on a *clean* setup — a fresh checkout, a new machine, a teammate who's never seen it — and follow it *literally*, doing nothing the page doesn't say. Every place you get stuck, have to guess, or have to already-know something is a defect. Authors can't do this honestly on their own docs because they can't un-know what they know; that's why a fresh reader is gold.

**Name the reader and the question, then check the page answers it.** From Core Concept 2. "A new backend engineer who wants to call this API." Read the page as that person. Did it answer fast? Did it assume things they wouldn't know?

**Scan, don't read.** Good docs survive a *five-second scan* — headings, code blocks, and bold terms tell you what's there and let you jump to your part. If you have to read every word to find anything, the structure has failed. Squint at the page: does it have shape, or is it a slab?

**Check the freshness signals.** When was it last updated? Does it mention versions, flags, or screenshots — and do those still match reality? Try one command. One wrong command is enough to flag the page as suspect. (Measuring this systematically — staleness age, broken links, snippets that no longer compile — is its own topic: [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/junior.md).)

**Watch where the questions go.** The most honest quality signal in any team is *what people ask in chat.* If the same question gets asked repeatedly and the answer "is in the docs," then the docs failed at findability or clarity — the proof is that real readers, with real questions, couldn't use them. Repeated questions are a defect report the docs are writing about themselves.

> **Key insight:** You don't need a tool or a metric to start judging docs — you need a *reader's eye* and the honesty to follow the page literally instead of generously. The instinct to "fill in the obvious gap" while reading is exactly what hides doc defects. Read like the most literal, least knowledgeable reader who will ever hit this page, and the problems surface on their own. The metrics and automation come later, in this roadmap; the eye comes first.

---

## Real-World Examples

**1. The README that lies on line one.** A popular open-source library's README opens with `pip install coolib` and `import coolib`. But the package on PyPI is actually named `coolib-py`, and the import is `import cool`. A first-time user hits an error on the *very first command*, assumes the whole library is broken or abandoned, and leaves. The library is excellent; the docs killed adoption at the door. This is **accuracy** (and **currency** — the names changed and the README didn't) failing at the worst possible spot: the reader's first thirty seconds. The lesson: the earlier in the reader's journey a doc is wrong, the more damage it does.

**2. The internal wiki nobody can find.** A company has *thorough* runbooks for every service — genuinely complete, genuinely accurate. But they're scattered across an internal wiki with no consistent naming and weak search. During an incident at 2 a.m., the on-call engineer can't find the runbook for the failing service, so they improvise. The doc existed. It was good by every measure *except* **findability** — and findability was the only one that mattered at 2 a.m. "We documented it" was true and irrelevant. Findability isn't a nice-to-have; it's the attribute that decides whether all the others ever get a chance to help.

**3. The "tutorial" that's secretly a reference.** A framework's "Getting Started" page is 6,000 words. It introduces the project, lists every configuration option, explains the internal request lifecycle, and *somewhere in the middle* contains the five lines a beginner actually needs to see "Hello World" on screen. Beginners drown; experts looking up a config value have to wade through beginner prose. The page isn't badly *written* — it's badly *typed*. It tried to be a tutorial **and** a reference **and** an explanation at once (Core Concept 3), and so it's bad at all three. Split into a short tutorial, a reference, and an explainer, the exact same content would become good.

---

## Mental Models

- **Existence ≠ quality.** "We have docs" is a statement about *existence*. "Can the reader use them?" is a statement about *quality*. They are different questions, and only the second one matters. A confident, well-formatted, *wrong* doc is more dangerous than a blank page, because it spends trust it hasn't earned.

- **Docs are a product; the reader is the user.** You wouldn't ship a feature without asking "can a user actually use this?" Docs are the same. Every quality attribute — accurate, complete enough, findable, clear, current — is really one question wearing five hats: *does this work for the user it's for?*

- **A doc is a tool with one job; ask which job.** A tutorial, a how-to, a reference, and an explanation are *different tools*. Judging them by one standard is like complaining a screwdriver makes a bad hammer. First name the job (the doc type), *then* judge how well it does that job.

- **Trust is the real currency, and it's spent on the first wrong line.** A reader extends trust to a doc. One broken command, one stale screenshot, and that trust is gone for the *whole page* — they'll double-check everything or abandon it. This is why accuracy and currency punch above their weight: they protect the trust that makes every other quality attribute usable.

- **The reader's struggle is the metric you already have.** Before any tooling, the most reliable quality signal is a real reader getting stuck, guessing, or giving up and asking a human. You don't need to measure that to see it. Watch for it.

---

## Common Mistakes

1. **Treating "documented" as "good."** Docstring coverage at 90%, a wiki page for every service, a README in every repo — and readers still can't use them. Coverage measures *existence*, not *quality*. (Why "documented ≠ good" is a recurring trap is a whole topic of its own later in this roadmap.) Counting pages tells you nothing about whether anyone can use a single one of them.

2. **Judging every doc by one standard.** Calling a terse reference "unfriendly" or a hand-holding tutorial "bloated" — when terseness is *correct* for a reference and hand-holding is *correct* for a tutorial. Judge each doc against the standard for its *type*, not a one-size rubric.

3. **Writing (and judging) from the author's knowledge.** The deadliest habit: assuming the reader knows what you know. It produces docs that skip the "obvious" step, use undefined jargon, and answer the author's interesting questions instead of the reader's actual one. Always name the reader first.

4. **Optimizing completeness at the cost of clarity.** Believing that *more* — more options, more detail, more edge cases — is always *better*. For a beginner's tutorial, more is usually *worse*: it buries the one thing they needed. "Complete enough for this reader" beats "exhaustive."

5. **Ignoring findability entirely.** Pouring effort into writing the doc and zero effort into whether anyone can *locate* it. An unfindable doc has the real-world value of a doc that doesn't exist — with the added downside that someone spent time writing it.

6. **Trusting the doc you wrote without re-running it.** Docs rot silently because the author never repeats the steps after the code changes. "It was right when I wrote it" is not "it's right now." If you haven't run the steps recently on a clean setup, you don't actually know the doc still works.

---

## Test Yourself

1. Name the five core qualities of good documentation, and give a one-line example of each one *failing*.
2. A doc is 100% technically accurate and exhaustively complete, yet readers keep asking the question it answers in team chat. Which quality is broken, and why doesn't accuracy save it?
3. What is the single idea that sits underneath all five quality attributes? State it in one sentence.
4. Someone calls a reference page "cold and unhelpful because it just lists facts with no friendly explanation." Why might that criticism be *wrong*?
5. Name the four Diátaxis doc types and, in a few words each, what "good" means for them. Which two have nearly *opposite* virtues?
6. You have no tools and ten minutes. Describe the single most effective thing you can do to find out whether a setup guide is good.
7. Why is an out-of-date doc often considered *worse* than no doc at all?

<details>
<summary>Answers</summary>

1. **Accurate** (the install command errors out), **complete enough** (the guide never mentions the required `DATABASE_URL`, so it silently fails), **findable** (the answer exists but lives unsearchable on page 4 of the wiki), **clear** (one 200-word paragraph of jargon nobody can parse), **current** (the screenshot shows a UI from two versions ago).
2. **Findability** (and possibly **clarity**) is broken. Accuracy doesn't save it because a correct answer the reader *can't locate or can't parse* delivers zero value — the proof is that real readers, with the exact question, ended up in chat instead.
3. **Good docs answer the reader's question; they don't display the writer's knowledge.** (Reader-first.)
4. Because terseness and a no-story, fact-listing form are *correct* for a reference — that's what makes a reference good. The critic is judging it by *tutorial* standards. A reference that "warmly explains" is a slower, worse reference.
5. **Tutorial** (learning — holds your hand, guaranteed to work), **how-to guide** (working — terse, goal-focused, assumes competence), **reference** (looking up — exhaustive, accurate, terse, boring on purpose), **explanation** (understanding — discursive, gives the "why"). **Tutorial and reference** have nearly opposite virtues: hand-holding helps a tutorial and hurts a reference.
6. **Follow the guide literally on a clean setup** (fresh checkout / new machine / a teammate who's never seen it), doing *only* what the page says. Every place you get stuck or have to guess is a defect. Authors can't do this honestly on their own docs because they can't un-know what they know.
7. Because a reader *trusts* a doc and acts on it. A wrong instruction wastes their time, can break things, and — worst — once they hit one wrong line they stop trusting the *whole page*. A missing doc costs trust nothing; a wrong one spends it.

</details>

---

## Cheat Sheet

```
THE FIVE QUALITIES (all answer one question: "can THIS reader use it?")
  ACCURATE        matches reality — the command works, the screenshot is current
  COMPLETE ENOUGH covers what THIS reader needs (not everything that exists)
  FINDABLE        the reader can LOCATE it at the moment of need
  CLEAR           a SPECIFIC reader understands it on the first read
  CURRENT         it KEEPS matching reality over time (accuracy + the clock)

THE ONE IDEA UNDERNEATH
  Good docs answer the READER'S question — not show off the WRITER'S knowledge.
  Before judging: name the reader + name their question. Then check it's answered, fast.

GOOD DIFFERS BY TYPE (Diátaxis) — judge each doc by ITS type's standard
  TUTORIAL     learning   → holds your hand, guaranteed to work   (cooking class)
  HOW-TO       working    → terse, goal-focused, assumes basics   (recipe)
  REFERENCE    looking up → exhaustive, terse, boring on purpose  (dictionary)
  EXPLANATION  understand → discursive, the "why" + trade-offs    (history)
  Disaster sign: one doc trying to be two+ types at once → serves no one.

SIGNS OF BAD DOCS (you can point at these)
  out of date · wall of text · no examples · written for the author ·
  unfindable · answers a different question than the reader has

HOW YOU'D EVEN TELL (no tools needed)
  RUN the steps literally on a clean setup → every stuck point = a defect
  NAME reader + question → check the page answers it
  SCAN in 5 seconds → no shape = structure failed
  CHECK freshness → try one command; one wrong = suspect
  WATCH chat → repeated "it's in the docs" questions = findability/clarity defect

RULE OF THUMB
  "We have docs" ≠ "the docs are good." Existence is not quality.
```

---

## Summary

- "We have docs" is a claim about **existence**; "the docs are good" is a claim about **quality**. Only the second matters, and it's the one almost nobody checks.
- Good docs share five concrete qualities: **accurate** (matches reality), **complete enough** (covers what *this reader* needs), **findable** (the reader can locate it), **clear** (a specific reader gets it on the first read), and **current** (it keeps matching reality over time). They *trade against each other*; good docs hit the right balance, not the max of every one.
- Underneath all five is a single idea: **good docs answer the reader's question, not show off the writer's knowledge.** Name the reader and their question before you judge or write anything.
- There is **no single definition of good**, because there are different *kinds* of docs. The four Diátaxis types — **tutorial, how-to, reference, explanation** — have different, sometimes *opposite*, virtues. Judge each doc by its own type's standard; a doc that mixes types serves no one.
- Bad docs have **spottable symptoms** — out of date, wall of text, no examples, written for the author, unfindable, answering the wrong question — and you can detect them with a **reader's eye** and no tools: run the steps literally, scan for shape, try one command, watch where the questions go.

You now have the eye. The rest of this roadmap turns that eye into *measurement* — testing docs so they can't lie, scoring their freshness and readability, measuring coverage and gaps, and proving docs are worth their cost — the same way you'd measure and defend the quality of code.

---

## Further Reading

- [Diátaxis](https://diataxis.fr/) — Daniele Procida's framework for the four doc types. The clearest explanation of *why* "good" differs by kind. (How to *apply* it lives in [Code Craft → Documentation](../../../code-craft/documentation/).)
- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — a practical, reader-centered take on what makes developer docs work. Chapters on understanding your audience are exactly this page, expanded.
- [Google Developer Documentation Style Guide](https://developers.google.com/style) — concrete, opinionated rules for clear technical writing; a good benchmark for "clear."
- [Write the Docs](https://www.writethedocs.org/) — the community and its guides; a strong reality check on what real teams struggle with.
- The [middle.md](middle.md) of this topic, which turns these qualities into a usable per-type rubric and starts attaching real signals to each attribute.

---

## Related Topics

- [What Makes Docs Good — Middle](middle.md) — the qualities become a *rubric* you can apply to a real doc set, type by type.
- [What Makes Docs Good — Senior](senior.md) — defending doc quality as an engineering property: trade-offs, ownership, and what to measure.
- [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/junior.md) — measuring the **current** attribute: staleness, broken links, snippets that no longer compile.
- [05 — Readability & Information Architecture](../05-readability-and-information-architecture/junior.md) — measuring the **clear** and **findable** attributes: readability, navigation, structure.
- [Code Craft → Documentation](../../../code-craft/documentation/) — the sibling roadmap on *how to write* each doc type, including the full Diátaxis framework. This section judges; that one builds.
