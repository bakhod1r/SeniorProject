# Readability & Information Architecture — Junior Level

> **Roadmap:** [Documentation Quality](../README.md) → Readability & Information Architecture
> *People do not read documentation. They hunt through it — eyes darting for the one heading, the one code block, the one sentence that solves their problem right now. Good docs are built for that hunt, not for a calm cover-to-cover read that never happens.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Readability: Plain Words, Short Sentences, One Idea at a Time](#core-concept-1--readability-plain-words-short-sentences-one-idea-at-a-time)
5. [Core Concept 2 — Write for Scanning, Not Reading](#core-concept-2--write-for-scanning-not-reading)
6. [Core Concept 3 — Information Architecture: Can They Find It?](#core-concept-3--information-architecture-can-they-find-it)
7. [Core Concept 4 — Navigation & Links: Helping the Reader Move](#core-concept-4--navigation--links-helping-the-reader-move)
8. [Core Concept 5 — Readability Scores Are a Rough Guide, Not a Goal](#core-concept-5--readability-scores-are-a-rough-guide-not-a-goal)
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

> Focus: **Why is one doc effortless to use and another a wall you bounce off?**

You've felt both. One page answers your question in fifteen seconds — you skim, you find the heading, you copy the snippet, you're gone. Another page has all the same information, but you give up halfway down a grey block of text, convinced the answer isn't there. It usually *was* there. You just couldn't see it.

The difference is rarely the facts. It's two things working together. **Readability** is whether a sentence is easy to take in — plain words, short sentences, one idea per paragraph. **Information architecture** (IA) is whether the *whole document* is organized so a reader can find the part they need — clear titles, a logical order, a table of contents, links between related pages. Readability makes each sentence land. IA makes the right sentence findable in the first place.

This page is about both, at a beginner level, because they fail together and they're fixed together. A perfectly readable paragraph is useless if it's buried where nobody looks. A perfectly organized page is useless if every paragraph is a fog of jargon. You will learn the small, concrete moves — short sentences, descriptive headings, bold key terms, scannable chunks, a clear structure — that turn a wall of text into something a stressed reader can actually use.

> **The mindset shift:** stop writing for a reader who starts at the top and reads every word. That reader does not exist. Real readers **scan** — they skim headings, jump to code, bail the instant a paragraph looks dense. Write *for the skim*: make the structure so obvious that someone moving fast still lands on the right place.

---

## Prerequisites

- **Required:** You can write a few paragraphs of plain English and you've used Markdown headings, lists, and code blocks (or are willing to look them up — they take five minutes).
- **Required:** You have read documentation as a *user* and gotten frustrated. That frustration is the whole subject; you already have the instinct.
- **Helpful:** You've written at least one README, wiki page, or how-to that someone else had to read.
- **Helpful:** You've watched someone use docs you wrote (or wished you could). Seeing where a real reader gets stuck teaches this faster than any rule.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Readability** | How easy a piece of text is to *read and understand* — driven by word choice, sentence length, and one-idea-per-chunk writing. |
| **Information architecture (IA)** | How the *whole set of docs* is organized — titles, sections, order, and structure — so a reader can locate what they need. |
| **Findability** | How easily a reader can *locate* a specific piece of information (via the title, the headings, a table of contents, search, or links). |
| **Scannability** | How easily a reader can *skim* a page and pick out the relevant parts without reading every word — driven by headings, lists, bold terms, and short chunks. |
| **Plain language** | Writing using common words and direct sentences, with no needless jargon, so the widest audience understands on the first pass. |
| **Progressive disclosure** | Showing the essentials first and tucking the details deeper (later sections, expandable blocks, linked pages) so the page isn't overwhelming. |
| **Table of contents (TOC)** | A list of a page's sections, usually linked, that lets a reader jump straight to the part they want. |

---

## Core Concept 1 — Readability: Plain Words, Short Sentences, One Idea at a Time

Readability is not about dumbing down. It's about getting an idea from your head into a tired reader's head with the least friction. Three moves do most of the work.

**Short sentences.** A long sentence forces the reader to hold many things in mind at once. Break it. A good rule of thumb: if a sentence has two `and`s, a `which`, and a comma splice, it's probably two or three sentences pretending to be one.

```
BEFORE (one 41-word sentence):
The configuration file, which must be placed in the root directory and which
supports both YAML and JSON, is loaded at startup, and if it is missing the
application falls back to defaults, although this behavior can be disabled.

AFTER (four sentences):
Place the configuration file in the root directory. It supports YAML and JSON.
The app loads it at startup. If the file is missing, the app uses defaults —
unless you disable that fallback.
```

Same facts. The second version is four glances instead of one held breath.

**Plain words.** Prefer the common word over the impressive one. `use` over `utilize`. `before` over `prior to`. `because` over `due to the fact that`. `start` over `initialize` (unless `initialize` is the actual technical term). Jargon is fine when it's the *real name* of a thing your audience knows — but "leverage a robust, scalable solution" is not jargon, it's fog.

**Active voice.** Active voice names who does what: "**The build** uploads the artifact." Passive voice hides the actor: "The artifact is uploaded." Active is shorter and clearer, and it tells the reader *who is responsible* — which in technical docs is often the exact thing they need to know.

```
PASSIVE (who runs it?):  The migration is run after deploy.
ACTIVE (clear actor):    The deploy pipeline runs the migration.
```

**One idea per paragraph.** A paragraph should make a single point. When you start a new thought, start a new paragraph. A reader skimming the *first line* of each paragraph should get the gist of the page — which only works if each paragraph has one clear point to put in that first line.

> **Key insight:** readability is mostly *subtraction*. You rarely add clarity; you remove what was blocking it — the extra clause, the fancy word, the buried actor, the three ideas crammed into one paragraph. When a sentence feels off, your first instinct should be *cut*, not *add*.

---

## Core Concept 2 — Write for Scanning, Not Reading

Here is the uncomfortable truth that should change how you write: **readers don't read — they scan.** They arrive with a specific problem, their eyes sweep the page in an F-shaped or zig-zag pattern, and they're looking for the one spot that matches their problem. If they don't see it in a few seconds, they conclude it isn't there and leave — even when it is.

So your job isn't to produce prose worth reading start to finish. It's to make the *structure* so clear that a fast-moving eye lands in the right place. Concretely:

**Descriptive headings.** A heading is a signpost the scanner reads *instead of* the paragraph under it. "Configuration" is a weak signpost. "Set the database connection string" is a strong one — a scanner looking for exactly that will stop. Write headings as the answer or the task, not the topic.

**Short chunks.** Break content into small pieces with whitespace between them. A screen-tall paragraph reads as "nothing here, keep scrolling." Three short paragraphs with headings read as "three findable things."

**Lists for anything list-shaped.** Steps, options, requirements, trade-offs — if it's a set of items, make it a list. A scanner can count and jump within a list; they can't within a sentence that says "first you... and then... and also...".

**Bold the key terms.** Bolding the two or three words that *matter* in a paragraph gives the scanning eye an anchor. Don't bold whole sentences — that defeats it. Bold the term a reader is hunting for.

**Code blocks for code.** Code in a fenced block is instantly recognizable and copyable. Code mashed into a sentence is neither. A developer scanning for "the command to run" finds a code block in a heartbeat.

Now see it work. Here is a genuine wall of text — every fact a reader needs, arranged so they'll never find any of it:

```
BEFORE — wall of text

To deploy the service you will first need to make sure you have the CLI
installed which you can get from the internal package registry, and once
that is done you should authenticate using your team token which you can
generate from the settings page, and then you run the deploy command but
note that it requires the environment name as an argument and it will fail
if the environment does not already exist so you may need to create it first
using the create command, and finally after deploying you should verify the
health endpoint returns 200 and if it does not you should check the logs
which are available through the dashboard or the CLI logs command.
```

A reader in a hurry sees one grey blob and bounces. Now the *same information*, rebuilt for scanning:

```markdown
AFTER — scannable

## Deploy the service

**Prerequisites**

- Install the CLI from the internal package registry.
- Authenticate with your team token (generate one on the **Settings** page).
- Make sure the target environment exists. If not, create it:

  ```
  myctl env create <environment-name>
  ```

**Deploy**

```
myctl deploy <environment-name>
```

**Verify**

1. Check that the health endpoint returns `200`.
2. If it doesn't, view the logs:

   ```
   myctl logs <environment-name>
   ```
   (Logs are also on the **Dashboard**.)
```

Same words, roughly. But now a scanner finds the deploy command in one second, sees the prerequisites as a checklist, and knows exactly where to look when health fails. **Nothing was added except structure** — headings, lists, code blocks, bold anchors — and the page went from unusable to obvious.

> **Key insight:** scannability is a *visual* property, not a writing-quality property. The before and after above contain nearly the same sentences. What changed is what the eye sees in the first two seconds. You make docs usable not only by writing better sentences but by *shaping the page* so the right sentence is impossible to miss.

---

## Core Concept 3 — Information Architecture: Can They Find It?

Readability makes a page easy to read. **Information architecture** decides whether the reader ever reaches the right page — and the right *part* of it — at all. IA is the organization: the titles, the section order, the table of contents, the way pages relate. It's the difference between a library with a catalogue and a pile of books on the floor.

Findability rests on a few plain things:

**A clear, specific title.** The title is the single most important findability signal — it's what shows up in search results, browser tabs, and link previews. "Notes" tells a searcher nothing. "Deploying the Payments Service to Staging" tells them exactly whether this is their page. Title the page after the *task or question*, in the words the reader would use.

**A logical structure.** Sections should follow an order the reader expects: overview before details, prerequisites before steps, common case before edge cases. If someone can predict where a piece of information *should* be, they'll find it even without searching.

**A table of contents for any long page.** Once a page passes a screen or two, a TOC at the top lets readers jump straight to their section instead of scrolling and skimming. (Look at the top of *this* page — that's the TOC doing its job.)

**Search.** On a docs site, search is how many people start. You don't build search as a junior, but you *feed* it: clear titles and descriptive headings are exactly what search indexes and ranks. Good IA makes search work; vague titles make search useless no matter how good the engine is.

**Progressive disclosure.** Don't dump everything on one page. Put the essentials up front and push depth into later sections or linked pages. A reader who needs only the quick answer shouldn't have to wade through advanced configuration to find it — and a reader who needs the depth can follow a link to it.

A simple test of IA: hand your doc to someone and ask, *"Where would you look to find out how to X?"* If they hesitate, point to the wrong section, or say "I'd just Ctrl-F," your structure isn't carrying its weight. Good IA lets people *predict* where things live.

> **Key insight:** readability is about a sentence; information architecture is about the *map*. You can write flawless sentences and still ship unusable docs if the reader can't find the page — or can't find the right paragraph once they're on it. Always ask two questions: *Is this easy to read?* and *Is this easy to find?* They are different problems with different fixes.

---

## Core Concept 4 — Navigation & Links: Helping the Reader Move

A documentation page is rarely the whole journey. A reader lands somewhere, realizes they need a related concept, and has to *move*. Navigation and links are what let them move without getting lost or giving up.

**Links between related pages.** When you mention a concept covered elsewhere, link it. A reader hitting an unfamiliar term shouldn't have to abandon the page and start a fresh search — give them the door. This also keeps each page focused: instead of re-explaining authentication on every page, you explain it once and link to it.

**Descriptive link text.** The words you link matter. "Click [here](#)" tells a scanner nothing; the linked words should describe the destination, like "see the [authentication guide](#)." Scanners read link text as signposts, exactly like headings — make it say where it goes.

**Don't strand the reader.** Every page should answer "where am I, and where can I go next?" A breadcrumb at the top (like the `Documentation Quality → Readability & Information Architecture` line on this page) says where you are. A "Related Topics" or "Next steps" section at the bottom says where to go. A page with no way out is a dead end the reader leaves by hitting Back.

**In-page navigation.** Within a long page, the TOC plus anchored headings let readers jump around. This is navigation *inside* a document, and it's why descriptive headings pay off twice — once as scanning signposts, once as TOC entries.

The goal is a reader who never feels stuck. At every point they should be able to see where they are, find the part they need on the current page, and reach the next relevant page in one click. Disorientation — "I don't know where this is or how to get back" — is one of the fastest ways to lose a reader, and it's pure IA, nothing to do with how well any individual sentence is written.

---

## Core Concept 5 — Readability Scores Are a Rough Guide, Not a Goal

You'll eventually hear about **readability scores** — formulas that take text and spit out a number meant to estimate how hard it is to read. The most common is the **Flesch-Kincaid grade level**, which roughly maps text to a U.S. school grade: a score of 8 means "an average 8th-grader could read this." It's computed mechanically, from things like average sentence length and average syllables per word. Shorter sentences and shorter words push the grade down. (You'll also meet the Gunning fog index, which does something similar.)

These are genuinely useful as a *smoke alarm*. If you run your docs through a checker and a paragraph scores at "grade 19," that's a real signal: your sentences are probably too long or too dense, and it's worth a second look. Used that way — as a flag that says *"go reread this part"* — the number earns its keep.

But treat the score as a **goal** and it lies to you. The formulas only count sentence and word length; they understand *nothing* about meaning. You can game any of them, and you can fail them while writing perfectly:

- **You can hit a great score and still be unreadable.** Chop everything into five-word sentences and the grade plummets — but choppy, context-free fragments can be *harder* to follow, not easier. The formula can't tell.
- **You can score "badly" and be perfectly clear.** Necessary technical terms (`idempotent`, `Kubernetes`, `authentication`) are long words; correct, precise sentences sometimes need length. A good API reference will "fail" Flesch-Kincaid and still be exactly right for its audience.
- **The number ignores everything that actually matters here** — structure, headings, whether the reader can *find* anything. A flawless score on an unscannable wall of text is a flawless score on an unusable page.

> **Key insight:** readability scores measure *sentence and word length*, not *clarity* — and they know nothing about structure or findability, which are half of what makes docs usable. Use them as a rough alarm ("this section might be too dense — go look"), never as a target to optimize. The real test is not a number; it's whether a real reader, scanning fast, finds and understands what they came for. Optimize for *that*, and the score usually takes care of itself.

---

## Real-World Examples

**1. The README nobody could deploy from.** A team's setup guide was one long, dense "Getting Started" section — accurate, complete, and a wall of prose. New hires kept asking in chat how to run the project locally, even though the answer was on the page. The fix added zero new facts: split the wall into headed sections (**Prerequisites**, **Install**, **Run locally**, **Run the tests**), pulled every command into its own code block, and bolded the key tools. The "how do I run this?" questions stopped within a week. The information had always been there; it had never been *findable* at a scan.

**2. The doc with a perfect readability score and a furious reader.** A writer was told to get every page under "grade 9" Flesch-Kincaid. To hit it on a tricky concurrency page, they shredded explanations into tiny disconnected sentences and cut the connective words ("because," "however," "as a result") that long words inflate. The score went green; the page became *less* clear, because the reasoning that tied the steps together was gone. A reader complaint — "I can read every sentence but I have no idea what to actually do" — exposed the trap: the number went up while usability went down. They reverted, kept some sentences long where the logic needed it, and used the score only to flag genuinely bloated paragraphs.

**3. The wiki where everything was findable except the thing you needed.** A growing internal wiki had hundreds of accurate pages and decent prose, but titles like "Notes," "Misc," and "Stuff from the meeting." Search returned ten plausible hits for every query and no way to tell them apart, because the *titles* — the strongest findability signal and the thing search ranks on — carried no information. The content was fine; the IA was broken. Renaming pages to specific, task-shaped titles ("Rotating the Staging Database Password") did more for findability than any new content could have. The lesson: good writing inside a badly-titled, badly-organized space is invisible.

---

## Mental Models

- **Docs are a map, not a novel.** Nobody reads a map cover to cover. They glance at it to find one place. Headings are the labels, the TOC is the legend, links are the roads. Build a map a stressed traveler can use at a glance — not a story you hope they'll savor.

- **The two-second scan test.** Before you ship a page, look at it for two seconds — the way a real reader will — and ask: *can I tell what's here and where my answer is?* If two seconds of scanning lands you nowhere, no amount of well-written prose underneath will save it. Fix the structure first.

- **Readability is subtraction; IA is arrangement.** To make a sentence readable, you *remove* — the extra clause, the fancy word, the buried actor. To make a doc findable, you *arrange* — titles, order, sections, links. Two different verbs for two different problems.

- **Structure is free clarity.** The same sentences, given headings, lists, and code blocks, become dramatically more usable without a single word changing. Before you rewrite prose to fix a confusing page, try just *shaping* it — you're often one set of headings away from "usable."

- **Write for the reader who's leaving.** Assume your reader is one dense paragraph away from hitting Back and Googling instead. Every heading, every short chunk, every bolded term is a reason for them to stay one more second — long enough to find the answer.

---

## Common Mistakes

1. **Writing for the cover-to-cover reader who doesn't exist.** Long, flowing prose meant to be read in order. Real readers scan and bail. Write *for the skim*: descriptive headings, short chunks, bold anchors, lists.

2. **The wall of text.** Cramming everything into a few giant paragraphs with no headings, lists, or whitespace. Even correct, well-written content becomes unusable when there's no visual structure to scan. Break it up.

3. **Vague, topic-shaped titles and headings.** "Configuration," "Notes," "Overview." They're invisible to a scanner and to search. Title and head things after the *task or question* — "Set the connection string," not "Configuration."

4. **Confusing readable with findable.** Polishing sentences while ignoring whether anyone can locate the page or the right section. Both matter, and they have different fixes. Always ask both: *easy to read?* and *easy to find?*

5. **"Click here" links.** Link text that describes nothing. Scanners read link text as signposts — make the linked words name the destination ("the [auth guide](#)"), not "here."

6. **Chasing a readability score as a target.** Gaming Flesch-Kincaid into the green by shredding sentences, or panicking because a necessary technical term scored "too hard." The score is a smoke alarm, not a goal. Optimize for a real reader finding and understanding the answer.

7. **Bolding everything (or nothing).** Bold is an anchor for the scanning eye; it only works if it's rare. Bold the two or three words that matter. Bold a whole paragraph and you've bolded nothing.

8. **Dead-end pages.** No breadcrumb, no related links, no next step. A reader who finishes (or gets stuck) has nowhere to go but Back. Give every page a sense of place and a way out.

---

## Test Yourself

1. In one sentence each, what's the difference between **readability** and **information architecture**? Give one concrete fix for each.
2. "Readers don't read — they scan." Name four formatting moves that make a page work for a scanner.
3. You're handed a single, dense 200-word paragraph that contains correct setup instructions, and new hires can't follow it. You're told to add no new information. What do you do?
4. Why is a page's **title** such an important findability signal? What makes a good one?
5. A teammate says, "Our docs hit grade 8 on Flesch-Kincaid, so they're readable." What's wrong — or at least incomplete — about that claim?
6. Rewrite this for a scanner without changing the facts: *"Before running the import you must set the API key environment variable and you must also have network access to the staging host otherwise the import will hang, and after it completes you should check the row count matches."*

<details>
<summary>Answers</summary>

1. **Readability** is how easy a *sentence* is to read and understand (fix: shorten the sentence / cut a fancy word / use active voice). **Information architecture** is how the *whole doc set* is organized so a reader can *find* what they need (fix: give the page a clear, specific title / add a table of contents / put sections in a logical order). One is about the sentence; the other is about the map.
2. Any four of: **descriptive headings** (signposts the eye reads instead of the paragraph); **short chunks** with whitespace; **lists** for anything list-shaped; **bold** on the few key terms; **code blocks** for commands and code; a **table of contents** for jumping.
3. Don't rewrite the prose — **shape it**. Split the wall into headed sections (e.g. Prerequisites / Steps / Verify), turn the sequence into a numbered or bulleted list, pull every command into a code block, and bold the key terms. Same words, but now scannable and findable. Structure is free clarity.
4. The title is what appears in **search results, browser tabs, and link previews**, and it's a primary thing search ranks on — so it's often the *first and only* thing a reader sees when deciding whether this is their page. A good title is specific and task-shaped, in the reader's own words ("Deploying the Payments Service to Staging," not "Notes").
5. The score only measures **sentence and word length**, not actual clarity, and it knows **nothing about structure or findability** — which are half of what makes docs usable. A page can hit grade 8 and still be an unscannable wall of text with a useless title, or "fail" the score because it correctly uses necessary technical terms. The number is a rough alarm, not proof of quality.
6. For example:
   ```markdown
   ## Run the import

   **Before you start**

   - Set the `API_KEY` environment variable.
   - Make sure you have network access to the staging host (without it, the import hangs).

   **After it completes**

   - Check that the row count matches.
   ```
   (Any version with headings, a list, the env var in code formatting, and the same facts is correct.)

</details>

---

## Cheat Sheet

```
READABILITY (about the SENTENCE) — mostly subtraction
  short sentences      one breath, not three  → break on every extra "and"/"which"
  plain words          use > utilize, before > prior to, because > due to the fact that
  active voice         "The pipeline runs X" not "X is run"  → names the actor
  one idea / paragraph  new thought → new paragraph; first lines should give the gist

WRITE FOR SCANNING (readers skim, they don't read)
  descriptive headings  the task/answer, not the topic  ("Set the key", not "Config")
  short chunks          whitespace between; no screen-tall paragraphs
  lists                 anything list-shaped → bullets or numbers
  bold key terms        2-3 words, not whole sentences
  code blocks           commands/code in fences → findable + copyable

INFORMATION ARCHITECTURE (about the MAP) — arrangement
  clear specific title  the #1 findability + search signal
  logical structure     overview→detail, prereqs→steps, common→edge
  table of contents     any page longer than a screen or two
  search                you feed it with good titles + headings
  progressive disclosure essentials first, depth in later sections / linked pages

NAVIGATION
  link related pages    don't re-explain; link and move on
  descriptive link text "the auth guide", never "click here"
  breadcrumb + next     where am I / where do I go  → no dead ends

READABILITY SCORES (Flesch-Kincaid grade, Gunning fog)
  what they measure     sentence length + word length  → that's ALL
  good use              smoke alarm: "grade 19? go reread this part"
  bad use               a TARGET to optimize → you'll game it or fail wrongly
  the real test         can a fast-scanning reader FIND and UNDERSTAND the answer?

THE TWO QUESTIONS, ALWAYS
  Is it easy to READ?   (readability)
  Is it easy to FIND?   (information architecture)
```

---

## Summary

- **Readability** and **information architecture** are different problems that fail and get fixed together. Readability is whether a *sentence* is easy to take in; IA is whether the reader can *find* the right page and the right part of it. Always ask both.
- **Readability is mostly subtraction:** short sentences, plain words, active voice, one idea per paragraph. When a sentence feels wrong, cut before you add.
- **Readers scan; they don't read.** Write for the skim with descriptive headings, short chunks, lists, bold key terms, and code blocks. Scannability is a *visual* property — the same sentences become usable just by shaping the page.
- **Information architecture is the map:** a clear specific title (the strongest findability and search signal), a logical structure, a table of contents on long pages, and progressive disclosure so the page isn't overwhelming. Good IA lets readers *predict* where things live.
- **Navigation keeps the reader moving:** link related pages, use descriptive link text, and give every page a breadcrumb and a next step so nobody hits a dead end.
- **Readability scores** (Flesch-Kincaid, Gunning fog) measure only sentence and word length — not clarity, structure, or findability. Use them as a rough alarm, never as a goal. The real test is a real reader, scanning fast, finding and understanding what they came for.

Get this right and your docs stop being a wall people bounce off and start being a map people use. The next levels — [middle.md](middle.md) and [senior.md](senior.md) — turn these instincts into systems: style guides, prose linters, measurable navigation, and IA you can defend at scale.

---

## Further Reading

- *Letting Go of the Words* (Ginny Redish) — the definitive book on writing web content for people who scan, not read. Start here.
- *Don't Make Me Think* (Steve Krug) — about web usability, but every lesson on scanning and "obvious is better than clever" applies directly to docs.
- [Google Developer Documentation Style Guide](https://developers.google.com/style) — concrete, scannable rules for plain language, headings, lists, and link text. A working reference, not a book.
- [Diátaxis](https://diataxis.fr/) — how the *type* of doc (tutorial, how-to, reference, explanation) shapes its structure; the foundation for the IA ideas you'll meet next.
- The [middle.md](middle.md) of this topic, which formalizes readability into style guides and prose linters and treats IA as something you can measure.

---

## Related Topics

- [01 — What Makes Docs Good](../01-what-makes-docs-good/junior.md) — readability and findability are two of the core quality attributes covered there.
- [06 — Measuring Docs ROI](../06-measuring-docs-roi/junior.md) — how findability and clarity show up in real signals like search success and time-to-first-success.
- [middle.md](middle.md) — style guides, prose linting (Vale), and treating navigation and IA as measurable.
- [Code Craft → Documentation](../../../code-craft/documentation/) — the writing-craft side: *how* to actually write each genre of doc whose readability and structure this section measures.
