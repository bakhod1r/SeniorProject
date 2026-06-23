# Freshness & Rot Metrics — Junior Level

> **Roadmap:** [Documentation Quality](../README.md) → Freshness & Rot Metrics
> *A doc is written once and read a thousand times — but the code underneath it keeps changing. Sooner or later the words and the code disagree, and the doc quietly turns from a help into a trap.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What "Doc Rot" Actually Is](#core-concept-1--what-doc-rot-actually-is)
5. [Core Concept 2 — Why a Stale Doc Is Worse Than No Doc](#core-concept-2--why-a-stale-doc-is-worse-than-no-doc)
6. [Core Concept 3 — Freshness Signals Anyone Can Read](#core-concept-3--freshness-signals-anyone-can-read)
7. [Core Concept 4 — Rot a Machine Can Catch For You](#core-concept-4--rot-a-machine-can-catch-for-you)
8. [Core Concept 5 — The Habit That Prevents It: Update the Doc in the Same PR](#core-concept-5--the-habit-that-prevents-it-update-the-doc-in-the-same-pr)
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

> Focus: **Docs go stale, and you can measure how stale.**

Someone wrote a setup guide a year ago. It was perfect — every command worked, every step landed. Then the team renamed a script, switched databases, dropped a config flag, and redesigned the dashboard. Nobody touched the guide. Today a new hire opens it, runs the very first command, and gets an error. The guide didn't change. The world around it did. That slow drift between what a document *says* and what is *true* is the single most common way documentation fails — and the good news is that you can **see it coming** if you know what to look for.

This page is about **freshness**: how current a doc is, how you can tell at a glance, and the cheap signals that warn you a doc has started to rot. You don't need fancy tooling or a metrics dashboard. Most rot announces itself in plain sight — a "last updated" date from two years ago, a link that 404s, a code snippet that calls a function the codebase no longer has, a screenshot of a button that isn't there anymore. Once you learn to notice these, you stop trusting docs blindly and start *reading them critically*, which is exactly what a good engineer does.

> **The mindset shift:** stop thinking of a doc as a finished thing that sits on a shelf. A doc is a **claim about a system that keeps moving** — and an old claim about a moving system is, by default, *wrong*. A stale doc isn't a neutral leftover you can safely ignore. It is *actively lying to whoever reads it next*, and you are usually that reader.

---

## Prerequisites

- **Required:** You can read a doc — a README, a setup guide, an API reference — and follow its instructions.
- **Required:** You've used version control (Git) at least a little: you know a commit has a date and an author.
- **Helpful:** You've followed a tutorial where a step *didn't work* and you weren't sure if you'd made a mistake or the tutorial was wrong. (Often it was the tutorial.)
- **Helpful:** You've clicked a link in some docs and landed on a "404 Not Found" page.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Doc rot** | The slow process of a document drifting out of sync with reality as the thing it describes changes around it. Also called *documentation drift* or *bit rot of docs*. |
| **Staleness** | *How out of date* a doc is — usually measured as the time since it was last updated or reviewed. A high number is a warning, not a verdict. |
| **Freshness** | The opposite of staleness — how recently and reliably a doc has been kept in step with the system it describes. |
| **Review-by date** | A built-in expiry: a date by which a human promises to re-check the doc. Like the "best before" date on food. |
| **Broken link** | A link that no longer goes anywhere useful — it 404s, redirects to the wrong place, or points at a deleted page. A classic, easily detected rot signal. |
| **Drift / divergence** | The gap between what the doc says and what the code actually does. Doc rot *is* drift that nobody noticed yet. |

---

## Core Concept 1 — What "Doc Rot" Actually Is

Code rots in a specific, almost mechanical way. Picture a perfectly accurate doc the day it's written:

```
Day 0:   DOC says X   ✅   CODE does X      → doc is correct
Day 30:  DOC says X        CODE now does Y  → doc is WRONG (it rotted)
```

Nobody *broke* the doc on purpose. The doc sat perfectly still. The **code moved** — a feature changed, a function was renamed, a default flipped — and because the doc didn't move with it, the doc and the code now disagree. That disagreement is **doc rot**. The word "rot" is exact: like fruit left out, the doc looks fine on the surface for a while and is quietly going bad underneath.

The crucial thing to internalize: **rot is the default, not the exception.** A doc that is never updated *will* become wrong, because the systems we work on never stop changing. Keeping a doc correct is active work, like watering a plant. Walk away and it dies on its own.

Rot shows up in a few recognizable shapes:

- **A renamed thing.** The doc says "run `deploy.sh`." Someone renamed it to `release.sh`. Reader runs `deploy.sh` → "command not found."
- **A removed thing.** The doc shows a code example calling `getUserById()`. That function was deleted and replaced by `fetchUser()`. The example no longer even compiles.
- **A changed default.** The doc says "by default, retries are off." Six months ago retries were turned *on* by default. The doc now teaches the opposite of the truth.
- **A visual that aged.** The doc has a screenshot of a settings page with a big blue "Save" button in the corner. The UI was redesigned; that button is now a small icon at the top. The reader scans for the blue button, can't find it, and assumes *they* are doing something wrong.

> **Key insight:** Doc rot is not about *bad writing*. A beautifully written, crystal-clear doc rots exactly as fast as a sloppy one — because rot is caused by **change in the system**, not by flaws in the prose. This is why "we wrote great docs" never means "our docs are good *today*." Freshness is a separate property from quality of writing, and it decays on its own.

---

## Core Concept 2 — Why a Stale Doc Is Worse Than No Doc

This is the idea that surprises people, so sit with it: **a wrong doc is often worse than having no doc at all.** It feels backwards — surely *some* information beats none? But think about what each one does to the reader.

**No doc.** The reader knows they're on their own. They ask a teammate, read the source code, experiment carefully. It's slower, but they stay alert and they end up with the *truth*.

**A stale doc.** The reader *trusts it* — that's the whole point of a doc. They follow it confidently, step by step, straight into a wall. They run the wrong command, configure the wrong setting, build on the wrong assumption. Then they waste time debugging, because the last place they'll suspect is the *official documentation*. A stale doc doesn't just fail to help — it **points the reader in the wrong direction and tells them to walk fast.**

```
NO DOC:     reader is cautious  →  slow but correct
STALE DOC:  reader is confident →  fast and WRONG, then debugging the doc's lie
```

And there's a second, longer-lasting cost: **trust**. The first time a doc burns someone — they followed it exactly and it broke — they learn a quiet lesson: *the docs here can't be trusted.* After that, they stop reading docs and start pinging people on Slack instead. Now *every* doc you have, including the good ones, is worthless to that person, because they no longer believe any of them. One rotten doc poisons the whole library's credibility. Docs are a trust system, and trust is expensive to rebuild.

> **Key insight:** The value of a doc isn't just the information in it — it's whether the reader can *act on that information without verifying it*. A doc you have to double-check against the code provides almost nothing, because checking against the code is the work you were trying to avoid. A confidently-wrong doc is *negative* value: it costs the reader time *and* erodes their trust in every other doc. "Is this doc current?" is therefore not a nice-to-have — it's the question that decides whether the doc is an asset or a liability.

---

## Core Concept 3 — Freshness Signals Anyone Can Read

You don't need tools to start judging freshness. A handful of signals are visible to anyone, right on the page or one click away. Train yourself to glance at these *before* you trust a doc.

**1. The "last updated" date.** Most docs systems show when a page last changed. Git knows it for free — `git log -1 <file>` gives you the date and author of the most recent edit:

```bash
git log -1 --format="%ci  by %an" docs/setup.md
# 2024-02-11 09:30:00 +0000  by Priya
```

A page last touched two years ago, describing a system that ships every week, is a loud warning. Not proof it's wrong — but a strong reason to verify before you trust.

**2. The "last reviewed" date — different from "last updated."** "Updated" means *someone changed the text*. "Reviewed" means *a human read it and confirmed it's still correct*, even if nothing changed. These are not the same. A doc can be unchanged for a year and still be perfectly accurate — *if* someone keeps re-checking it. A "Last reviewed: 2023-01" stamp means nobody has *confirmed* this is true in a long time, which is its own kind of stale even if the words were never edited.

**3. Plain age.** How old is this page, period? A "Getting Started in Python 2" guide tells you its age in the title. Old framework versions, deprecated tool names, and references to systems your team retired are all age signals you can spot by reading.

**4. Internal contradictions.** Does the doc reference a teammate who left? A repo that was archived? A Slack channel that's gone? A "see the #deploy channel" line, when there is no #deploy channel anymore, is rot you can catch with zero tooling.

> **Key insight:** A date is a *signal*, not a *verdict*. "Updated yesterday" does **not** guarantee correct — someone could have fixed a typo while leaving a wrong command untouched. "Two years old" does **not** guarantee wrong — a doc about a stable thing (how to file an expense report) can be right for a decade. Use the date to decide *how hard to look*, not to decide the answer. Old → verify carefully. Recent → still skim, but lower your guard.

---

## Core Concept 4 — Rot a Machine Can Catch For You

Some rot is *mechanical*: it follows rules a computer can check automatically, on every change, without a human reading anything. These are the cheapest wins in all of documentation quality — set them up once and they catch rot forever. You don't have to build them yourself yet; you just need to know they exist and what each one catches.

**Broken links.** A link either resolves or it doesn't. A **link checker** crawls every link in your docs and reports the dead ones. This catches deleted pages, moved files, renamed sections, and dead external sites — a huge share of all rot:

```
$ link-checker docs/
docs/setup.md:42   →  ./old-config.md           ✗ 404 (file not found)
docs/api.md:113    →  https://example.com/v1     ✗ 404 (page gone)
docs/intro.md:8    →  ./architecture.md          ✓ ok
2 broken links found.
```

**Code snippets that no longer compile or run.** If a doc's example calls `getUserById()` and that function no longer exists, that's a *fact the computer can check* — by actually trying to compile or run the snippet. Docs whose examples are run automatically can't drift silently, because the build fails the moment the code and the doc disagree. (This is a whole topic of its own — see [02 — Testable & Executable Docs](../02-testable-and-executable-docs/junior.md) — but the core idea belongs here too: *the best way to detect a rotten snippet is to make the machine run it.*)

**References to symbols that don't exist.** Even without running a snippet, tools can scan a doc for names of functions, files, or commands and check whether those names still exist in the codebase. A doc that mentions `deploy.sh` when only `release.sh` exists can be flagged automatically.

**Stale screenshots — the hard one.** A screenshot is just a picture; a computer can't easily tell that the UI changed. This is the one kind of rot that *resists* automation, which is exactly why screenshots rot so badly — nothing warns you. Some teams auto-regenerate screenshots from the live UI in CI so they can never go stale; most just learn to distrust screenshots and prefer describing the UI in words, which age more slowly.

> **Key insight:** Split rot into two buckets — **machine-detectable** (broken links, snippets that won't compile, references to deleted symbols) and **human-only** (a screenshot of an old UI, a paragraph that's subtly wrong but still grammatical and "plausible"). Automate the first bucket ruthlessly: a link checker in CI costs an afternoon to set up and catches rot every single day forever. Reserve scarce human review for the second bucket, where judgment is actually required. Don't make a person do what a script can do on every commit.

---

## Core Concept 5 — The Habit That Prevents It: Update the Doc in the Same PR

Detecting rot is good. *Not creating it* is better. And there's one habit that prevents more doc rot than every tool combined: **when you change the code, change the doc that describes it — in the same pull request.**

Here's why this works and the alternative doesn't. Imagine you rename `deploy.sh` to `release.sh`. You have two options:

- **"I'll fix the docs later."** You won't. *Later* never comes — you'll move to the next task, forget which docs mentioned the old name, and the rot is born the instant your PR merges. "Later" is where doc rot is manufactured.
- **Same PR.** While the change is fresh in your head, you grep for `deploy.sh`, find the three docs that mention it, and update them in the same change. The reviewer sees code and docs move together. The docs are *never wrong*, not even for an hour.

```
SAME PR:        code change + doc change merge together  →  doc never goes stale
"DOCS LATER":   code merges now, doc "someday"           →  doc is wrong starting NOW
```

The same-PR habit has compounding benefits. The reviewer of your PR is also reviewing the doc change, so the doc gets a second pair of eyes for free. The doc update is small and easy because you're changing *exactly* what your code touched, not auditing the whole doc later. And there's a clean rule of thumb: **if your code change makes a doc wrong, fixing that doc is part of finishing the change — not a separate task.** A feature isn't "done" if it shipped with the docs lying about it.

To make this findable, the simplest tactic is `grep` (or your editor's project-wide search). Before you finish a change, search the docs for the names of anything you renamed, removed, or changed:

```bash
grep -rn "deploy.sh" docs/        # did I leave any doc pointing at the old name?
grep -rn "getUserById" docs/      # any examples calling the function I just deleted?
```

> **Key insight:** Doc rot is not really a *documentation* problem — it's a *workflow* problem. Rot is created at the exact moment code changes and the doc doesn't. So the cure lives at that same moment: bundle the doc fix into the code change, every time, by reflex. A team that does this religiously needs far fewer freshness *metrics*, because they're producing far less staleness to measure. Prevention at the source beats detection after the fact.

---

## Real-World Examples

**1. The setup guide that 404s on step one.** A new hire follows the onboarding doc: "clone the repo, then run `./scripts/bootstrap.sh`." The script was renamed to `setup.sh` four months ago — by someone who fixed the code but not the doc. The new hire gets "no such file," assumes they cloned wrong, re-clones, tries again, finally gives up and pings the team an hour later. The code change was fine; the *missing doc change in that same PR* cost a brand-new teammate an hour and a dent in their confidence on day one. A `grep -rn "bootstrap.sh" docs/` in the original PR would have caught it in seconds.

**2. The screenshot that lies.** A billing doc shows a screenshot: "click the blue **Cancel Subscription** button in the bottom-right." The UI was redesigned; cancellation now lives behind a small gear icon at the top. A customer scans the bottom-right corner exactly as instructed, can't find the button, concludes the company is *deliberately hiding* the cancel option, and writes an angry review. The text wasn't even wrong in spirit — but the *picture* rotted, and a screenshot is the one form of rot no link checker will ever catch. This is why many teams describe UI flows in words ("open Settings, then Subscription") instead of pinning a screenshot that's wrong the next time a designer moves a button.

**3. The doc with the giant red warning everyone trusts.** A README's first line reads, in bold: "⚠️ Do **not** run migrations directly against production — use the `safe-migrate` wrapper." Two years and a whole new deployment system later, `safe-migrate` no longer exists and direct migrations are now the normal, safe path. But the scary warning is still there, so engineers keep avoiding the modern tooling and reaching for a workaround that's slower and *less* safe. The doc is so confident and so prominent that nobody questions it. This is staleness at its most dangerous: a wrong doc that is *trusted precisely because it sounds authoritative*. A "Last reviewed" date would have screamed that nobody had checked this claim since the old system died.

---

## Mental Models

- **A doc is milk, not a brick.** A brick you lay once and forget. Milk has an expiry and goes bad on the shelf whether or not you touch it. Docs are milk: they spoil on their own as the world around them changes. A **review-by date** is the expiry stamp — read it before you "drink."

- **Staleness is a smoke alarm, not a fire.** An old "last updated" date is *smoke* — a signal to go look. It might be a real fire (the doc is wrong) or burnt toast (the doc is about something stable and is still fine). Either way, smoke means *investigate*, not *panic* and not *ignore*.

- **A stale doc is a confident liar.** No doc says "I might be out of date." Every doc speaks with the same authority whether it's right or two years wrong. The reader can't hear the difference — which is exactly why a wrong doc does so much damage: it lies with a straight face, and people believe it.

- **The same-PR habit is "clean as you cook."** A chef wipes the cutting board *while* cooking, not in one miserable session at the end. Fixing the doc *while* you change the code keeps the kitchen clean continuously. "I'll do the docs later" is the sink full of dishes that never gets washed.

- **Detection finds rot; the workflow prevents it.** Link checkers and review dates are the *smoke detectors* — essential, but they only tell you about a fire that already started. Updating docs in the same PR is *not leaving the stove on* in the first place. You want both, but prevention is cheaper than every cleanup.

---

## Common Mistakes

1. **Treating a stale doc as harmless.** "It's a bit out of date, but it's better than nothing." Usually it's *worse* than nothing, because the reader trusts it and gets sent the wrong way. A doc you can't trust without checking the code against it is providing close to zero value.

2. **Trusting a recent "last updated" date as proof of correctness.** Someone may have fixed a typo or reformatted a table yesterday while leaving a wrong command in place. "Updated" means *edited*, not *verified*. The date tells you how hard to look, not whether it's right.

3. **Confusing "last updated" with "last reviewed."** An untouched doc can still be correct if a human keeps re-checking it; an edited doc can still be wrong. *Updated* = the text changed. *Reviewed* = a human confirmed it's still true. You need to know which one a date refers to.

4. **Saying "I'll update the docs later."** Later is where rot is born. The moment your code PR merges without the matching doc change, the doc is already wrong. Fix it in the same PR while the change is fresh, or accept that it probably won't get fixed at all.

5. **Pinning screenshots for things that change often.** A screenshot of a UI rots silently — no tool flags it — and UIs get redesigned constantly. Prefer describing the flow in words ("Settings → Billing → Cancel"), which ages far more slowly, or auto-generate the screenshot so it can't drift.

6. **Doing by hand what a script can do every commit.** Manually clicking through links or eyeballing snippets for rot is slow and unreliable. A link checker and executable snippets in CI catch the mechanical rot automatically, forever — saving human attention for the subtle, plausible-but-wrong rot that actually needs judgment.

---

## Test Yourself

1. In one sentence, what is "doc rot," and whose fault is it when the doc itself never changed?
2. Why can a stale doc be *worse* than having no documentation at all? Give the two distinct costs.
3. What's the difference between a doc's "last updated" date and its "last reviewed" date? Why does the distinction matter?
4. A doc was last updated two years ago. Does that *prove* it's wrong? What should the date actually make you do?
5. Name two kinds of doc rot a computer can detect automatically, and one kind it basically can't.
6. You rename `deploy.sh` to `release.sh`. What single habit prevents this from creating doc rot, and what command helps you do it?

<details>
<summary>Answers</summary>

1. **Doc rot** is the slow drift between what a doc says and what is actually true, caused by the *system changing* while the doc stays still. It's no one's deliberate fault — it happens *by default* because the doc didn't move with the code; keeping it current is active work that someone has to do.
2. Two costs. **(a) Direct:** the reader *trusts* the stale doc, follows it confidently, and gets sent the wrong way — wasting time debugging a problem the doc created, because they won't suspect the "official" docs. **(b) Trust:** once a doc burns someone, they stop trusting *all* your docs and ping people instead, so even your good docs lose their value.
3. **Updated** = someone changed the *text*. **Reviewed** = a human *confirmed it's still correct*, even if nothing changed. It matters because a doc can be unchanged-but-correct (reviewed regularly) or recently-edited-but-still-wrong; the two dates answer different questions.
4. **No, it doesn't prove anything** — a doc about a stable thing can be right for years. The age should make you **verify more carefully before trusting it** (treat it as smoke, not fire). Old → look hard; recent → still skim, but lower your guard.
5. **Detectable:** broken links (a link checker), code snippets that no longer compile/run, and references to functions or files that no longer exist. **Not detectable:** a screenshot of an old UI (a picture; the machine can't tell the UI moved) — and more generally, prose that's subtly wrong but still grammatical and plausible.
6. **Update the doc in the same pull request as the code change** — while it's fresh in your head and the reviewer sees both together. Use `grep -rn "deploy.sh" docs/` to find every doc still pointing at the old name before you finish.

</details>

---

## Cheat Sheet

```
DOC ROT (in one line)
  doc stays still + system changes  →  doc is now WRONG  →  "rot"
  it's the DEFAULT, not the exception. staying correct = active work.

WHY STALE > MISSING
  no doc    → reader is cautious  → slow but CORRECT
  stale doc → reader is confident → fast and WRONG + burns trust in ALL docs

FRESHNESS SIGNALS YOU CAN READ
  last UPDATED date   = text was edited        (git log -1 <file>)
  last REVIEWED date  = human confirmed it true (different thing!)
  plain age           = "for Python 2" etc.
  internal contradictions = dead channel, departed teammate, archived repo
  ⚠ a date is a SIGNAL (how hard to look), not a VERDICT (right/wrong)

ROT: MACHINE-DETECTABLE vs HUMAN-ONLY
  machine ✅  broken links (link checker)
              snippet won't compile/run (executable docs)
              references a deleted function/file
  human   👁  screenshot of old UI
              prose that's plausible but subtly wrong
  → automate the first bucket; save humans for the second.

THE HABIT THAT PREVENTS IT
  change code  →  change the doc in the SAME PR
  "docs later" = where rot is born. later never comes.
  grep -rn "old_name" docs/   # before you finish, find stale references

RULE OF THUMB
  if your code change makes a doc wrong,
  fixing that doc is PART OF the change — not a separate task.
```

---

## Summary

- **Doc rot** is the slow drift between what a doc says and what's true. It happens because the *system changes while the doc stays still* — so rot is the **default**, and keeping a doc correct is ongoing work, like watering a plant.
- A **stale doc is often worse than no doc**: the reader *trusts* it and gets confidently sent the wrong way (wasting time debugging the doc's lie), and one burned reader stops trusting *all* your docs. A confidently-wrong doc is *negative* value.
- **Freshness signals you can read with no tools:** the *last updated* date (text was edited), the *last reviewed* date (a human confirmed it's still true — a different and often more useful thing), plain age, and internal contradictions. A date is a *signal* for how hard to look, never a *verdict*.
- Some rot is **machine-detectable** — broken links, snippets that won't compile, references to deleted symbols — and should be automated in CI forever. Some rot is **human-only** — a screenshot of an old UI, prose that's plausible but wrong — and needs judgment. Don't make a person do a script's job.
- The habit that prevents the most rot: **update the doc in the same pull request as the code change.** Rot is born the moment code merges without its matching doc fix. `grep` the docs for anything you renamed or removed before you call the change done.

Freshness is a *separate property* from how well a doc is written — a beautifully written doc rots just as fast. As you go deeper, you'll learn to turn these instincts into numbers (staleness age, broken-link counts, a doc's "half-life") and into automated gates that catch rot before a reader ever does.

---

## Further Reading

- [Code Craft → Documentation](../../../code-craft/documentation/) — the writing-craft sibling of this roadmap: *how* to write docs that resist rot in the first place, including a dedicated treatment of fighting doc rot.
- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — the chapter on maintaining docs covers reviewing, deprecating, and keeping content current in plain, practical terms.
- [Diátaxis](https://diataxis.fr/) (Daniele Procida) — different doc *types* rot at different rates (a tutorial rots faster than a reference); knowing the type tells you how much freshness pressure a doc is under.
- The [middle.md](middle.md) of this topic, which turns these instincts into actual *metrics* — staleness age, review-by automation, broken-link rates, and the idea of a documentation "half-life."

---

## Related Topics

- [02 — Testable & Executable Docs](../02-testable-and-executable-docs/junior.md) — the strongest cure for a whole class of rot: make the machine *run* your snippets so they can't drift silently.
- [01 — What Makes Docs Good](../01-what-makes-docs-good/junior.md) — currency/freshness is one of several quality attributes; this puts it next to accuracy, completeness, and clarity.
- [middle.md](middle.md) — measuring rot with real metrics: staleness distributions, review-by dates as policy, and link-rot rates.
- [senior.md](senior.md) — making freshness a system: automated gates, ownership, and deciding *which* docs are worth keeping fresh at all.
