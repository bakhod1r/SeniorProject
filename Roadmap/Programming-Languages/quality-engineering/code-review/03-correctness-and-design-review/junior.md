# Correctness & Design Review — Junior Level

> **Roadmap:** [Code Review](../README.md) → Correctness & Design Review
> *Anyone can confirm that code runs on the example the author tried. A reviewer's job starts where the author stopped looking: the empty list, the nil pointer, the file that never got closed, and the quiet suspicion that the whole thing was built the hard way.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Correctness Is Catching the Cases the Author Didn't Try](#core-concept-1--correctness-is-catching-the-cases-the-author-didnt-try)
5. [Core Concept 2 — The Bug-Hunt Checklist](#core-concept-2--the-bug-hunt-checklist)
6. [Core Concept 3 — The Edge-Case Habit](#core-concept-3--the-edge-case-habit)
7. [Core Concept 4 — Design Review: Is It Built Sensibly?](#core-concept-4--design-review-is-it-built-sensibly)
8. [Core Concept 5 — Block vs Suggest, and Say the Big Thing First](#core-concept-5--block-vs-suggest-and-say-the-big-thing-first)
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

> Focus: **How do I find the actual bugs in a change, and judge whether it's built well?**

You're reviewing a function that parses a list of orders and returns the total. The author tested it with three orders; it returned the right number; the PR description says "works." Your instinct is to agree — the code reads fine, the logic is sound, you can follow it top to bottom. So you approve.

The bug was never in the three orders the author tried. It was in the *zero* orders nobody tried — the empty list that makes the function divide by `len(orders)` and crash, or return a stray `0` that a downstream report treats as "this customer spent nothing." The author didn't see it because they were looking at the case they had in mind. **Your value as a reviewer is that you look at the cases they didn't.**

That is the whole game at this level, and it splits into two skills. The first is **correctness**: does the code do the right thing on *every* input, not just the happy one? There's a concrete, learnable checklist for this — a short list of bug shapes that recur in almost every codebase, each one a thing you can literally scan a diff for. The second is **design**: even if it works, *is it built in a sensible way?* Does it match how the rest of the codebase does things, or is it more complicated than the problem requires? You don't need taste or years of experience to start on either one — you need a method, and this page is the method.

> **Mindset shift:** Don't review the happy path — the author already did. Review the **edges** (empty, nil, zero, huge, halfway-failed) and the **approach** (is this even the right way to build it?). A reviewer who only confirms "the example works" adds almost nothing; the bugs and the bad designs live at the edges and in the shape of the solution, not in the case the author already checked.

---

## Prerequisites

- **Required:** You can read the language of the code well enough to follow its logic and trace a value through a function. (Examples here use **Go** and a little **Python**; the bug shapes are language-agnostic.)
- **Required:** You can read a diff (the red/green view of what changed) and find the function a change lives in.
- **Helpful:** You've read [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/junior.md). This topic is the deep dive on two of those steps — *does it work* and *is it built sensibly*.
- **Helpful:** You've written code that crashed on an input you didn't expect. That memory is exactly the instinct you're about to systematize.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Correctness** | The code produces the right result (or a safe failure) for *every* valid input — not just the one the author tried. |
| **Edge case** | An input at the boundary of what's normal: empty, zero, negative, one element, the maximum, a duplicate. Where bugs hide. |
| **Off-by-one** | A boundary mistake — looping one time too many or too few, or using `<=` where you meant `<` (or vice versa). |
| **Null / nil dereference** | Using a value (calling a method on it, reading a field) when it might be `null`/`nil`/`None` — which crashes. |
| **Swallowed error** | An error that happened but was ignored — an empty `catch {}`, or a returned error in Go that's never checked. The failure vanishes silently. |
| **Resource leak** | Something opened (a file, a connection, a lock) but never closed, so it accumulates until the program runs out. |
| **Invariant** | A rule that should *always* be true (e.g., "balance is never negative"). A bug is often an invariant quietly broken. |
| **Happy path** | The normal, expected flow where nothing goes wrong. What authors test; what you must look *past*. |
| **Design / approach** | *How* the change is built — its shape, structure, and fit with the codebase — as opposed to whether it merely works. |
| **Over-engineering** | Building something more general, abstract, or complicated than the actual problem requires. |
| **Blocking vs suggesting** | A *blocking* comment must be fixed before merge (a real bug). A *suggestion* is a nicer-way idea the author can take or leave. |

---

## Core Concept 1 — Correctness Is Catching the Cases the Author Didn't Try

Here's the mental model that makes everything else click. When someone writes a function, they have a picture in their head of what it's *for* — and they test against that picture. The picture is almost always the **happy path**: a normal, non-empty, well-formed input. The code works on it because that's the case the author was thinking about while writing.

Bugs live in the *gap* between the cases the author imagined and the cases that can actually occur. Your job is to stand in that gap.

Consider this Go function. Read it the way the author did — does it work?

```go
func averageAge(users []User) int {
    total := 0
    for _, u := range users {
        total += u.Age
    }
    return total / len(users)   // works great... for a non-empty list
}
```

For three users it returns the right average. For *zero* users — a perfectly possible input, maybe a filter returned nothing — `len(users)` is `0`, and Go panics: `integer divide by zero`. The program crashes. The author never saw it because they never passed an empty list. **You** pass it, in your head, and you find the bug.

This is why "the example works" is worthless as a review conclusion. The example is the one input *guaranteed* to work, because it's the one the code was written against. The whole point of a second pair of eyes is that those eyes look somewhere else.

> **Key insight:** Author bias is toward the happy path — they wrote and tested the case they had in mind. A reviewer's entire value is looking *where the author wasn't looking*: the empty, the nil, the failure, the boundary. If your review only re-checks the happy path, you've added a rubber stamp, not a review.

The good news: "looking where the author wasn't" is not a vague art. It's two concrete, learnable routines — a **bug-hunt checklist** (a fixed list of bug shapes to scan for) and an **edge-case habit** (a fixed set of inputs to mentally test). The next two sections are those routines.

---

## Core Concept 2 — The Bug-Hunt Checklist

A handful of bug *shapes* show up over and over, in every language, in every codebase. Once you know the shapes, you stop reading a diff line-by-line hoping to notice something and start *scanning for known patterns*. Here is the junior checklist — six shapes, each with what to look for and a before/after.

### 1. Off-by-one and boundary errors

A loop that runs one time too many or too few, or a comparison using `<=` where `<` was meant. Classic with array indices and slicing.

```diff
- for i := 0; i <= len(items); i++ {   // i reaches len(items) → index out of range
+ for i := 0; i < len(items); i++ {    // last valid index is len(items)-1
      process(items[i])
  }
```

**What to grep the diff for:** `<=` / `>=` near a length or index; `len(x)` used as an index; slice bounds like `s[1:]` (what if `s` is empty?); "the first/last element" logic.

### 2. Null / nil dereference

Using a value that might be absent. In Go, a `nil` map read is fine but a `nil` pointer field access panics; in Python, `None.foo` raises `AttributeError`.

```diff
  user := findUser(id)        // returns nil if not found
- return user.Name            // panics when user is nil
+ if user == nil {
+     return "", ErrNotFound
+ }
+ return user.Name, nil
```

**What to grep for:** any value that comes from a lookup, a parse, an external call, or a function that can return `nil`/`None` — and is then *used* (field access, method call) without a guard.

### 3. Swallowed errors

An error happened, but the code throws it away. The failure becomes invisible — the worst kind, because it surfaces later as wrong data with no stack trace pointing home.

```diff
  // Python — the empty except hides EVERY failure
- try:
-     balance = fetch_balance(account)
- except Exception:
-     pass                    # balance is now undefined / stale; nobody knows it failed
+ try:
+     balance = fetch_balance(account)
+ except BalanceUnavailable as e:
+     log.warning("balance fetch failed for %s: %s", account, e)
+     raise
```

```diff
  // Go — ignoring a returned error
- data, _ := os.ReadFile(path)   // the _ throws the error away; data may be empty
- parse(data)
+ data, err := os.ReadFile(path)
+ if err != nil {
+     return fmt.Errorf("reading %s: %w", path, err)
+ }
+ parse(data)
```

**What to grep for:** empty `catch {}` / `except: pass`; the blank identifier `_` swallowing an `err` in Go; a function that returns an error being called as if it returned nothing.

### 4. Resource leaks

Something is opened but never reliably closed. Each call leaks one more file handle, socket, or lock until the process hits a limit and falls over.

```diff
  // Go — missing defer means the file leaks on every early return
  f, err := os.Open(path)
  if err != nil {
      return err
  }
+ defer f.Close()             // guarantees close on EVERY exit path
  // ... read from f, possibly returning early ...
- f.Close()                   // only runs if we reach here — skipped on early return/panic
```

**What to grep for:** `Open`, `Dial`, `Lock`, `Begin` (a transaction), `acquire` — anything that opens a resource. Then check: is there a matching `defer`/`finally`/`with` that *guarantees* it closes on every path, including errors?

### 5. Edge cases (empty / zero / negative / huge / single element)

The author's logic assumes a "normal" input. Probe the boundaries. (This shape is so important it gets its own habit in the next section — here, just recognize it as a checklist item.)

```diff
  func firstAndLast(xs []int) (int, int) {
-     return xs[0], xs[len(xs)-1]   // panics on empty; on one element returns (x, x) — intended?
+     if len(xs) == 0 {
+         return 0, 0, errors.New("empty slice")
+     }
+     return xs[0], xs[len(xs)-1], nil
  }
```

**What to grep for:** indexing `[0]` or `[len-1]`; division (zero divisor?); subtraction that could go negative; anything that loads "all" of something (huge input → memory blowup).

### 6. "What if this fails halfway?"

The code does step A, then step B. If B fails *after* A succeeded, are you left in a broken half-done state?

```diff
  // Charge the card, THEN mark the order paid. If the second line fails, money taken, order not marked.
  chargeCard(order)
- markPaid(order)             // if this throws, the customer is charged but the order looks unpaid
+ if err := markPaid(order); err != nil {
+     refund(order)           // compensate, or use a transaction so both happen or neither
+     return err
+ }
```

**What to grep for:** two or more state-changing steps in sequence (write to DB, then call an API; charge, then record). Ask: if the second one fails, is the first one rolled back or compensated?

> **Key insight:** Stop reading diffs hoping to *notice* bugs. Scan for a fixed list of bug *shapes*. The shapes — off-by-one, nil deref, swallowed error, resource leak, boundary, partial failure — are finite and recur everywhere. A reviewer with a checklist beats a reviewer relying on intuition, every time, because intuition gets tired by line 200 and a checklist doesn't.

---

## Core Concept 3 — The Edge-Case Habit

The single highest-value reflex you can build is this: **for every new function, run its inputs through a fixed set of edge cases in your head.** Not all of them apply to every function — but asking is free, and the one that *does* apply is usually the bug.

The checklist of questions, for any input the function takes:

| Ask… | Because… |
|---|---|
| **Empty?** | Empty list/string/map. Does the loop run zero times correctly? Does `[0]` or `len-1` blow up? |
| **Null / nil?** | The value might be absent. Is it used without a guard? |
| **Zero?** | A zero divisor, a zero-length window, a zero timeout (which sometimes means "infinite"). |
| **Negative?** | A count, index, or size that goes below zero. Does the math still hold? |
| **One element?** | "First and last," "compare adjacent pairs," "the rest after the first" — single-element lists break these. |
| **Max / huge?** | An integer that overflows; a list so big it exhausts memory; a string longer than a buffer. |
| **Duplicate?** | Two items with the same key/ID. Does dedup logic, a map insert, or "find the one matching" handle it? |
| **Concurrent?** | Two callers at once. Is shared state read-and-written without protection? (Light at this level — flag the suspicion, link 04 goes deeper.) |
| **What if a call it depends on fails?** | The DB, the API, the file read returns an error. Is it checked, or does the function sail on with garbage? |

You don't recite all nine on every function. You glance at the function, see which questions *bite*, and check those. A function that takes a list? Empty and single-element, immediately. A function that divides? Zero, immediately. A function that calls an external API? "What if it fails?", immediately.

Here's the habit in action. The author writes a "find the median" helper:

```python
def median(nums):
    nums.sort()
    mid = len(nums) // 2
    return nums[mid]            # looks fine for [3, 1, 2] → sorts to [1,2,3] → returns 2
```

Run the edge cases:

- **Empty?** `[]` → `len` is 0, `mid` is 0, `nums[0]` → `IndexError`. **Bug.**
- **One element?** `[5]` → returns `5`. Fine.
- **Even length?** `[1, 2, 3, 4]` → `mid` is 2, returns `3`, but the median of an even list should be `(2+3)/2 = 2.5`. **Bug** — the author's mental model was odd-length lists only.
- **Mutation surprise:** `nums.sort()` sorts the *caller's* list in place. Did the caller expect their list reordered? Possible **design bug**.

One quick pass, three findings the author missed — none of which required cleverness, just the habit of asking the boundary questions.

> **Key insight:** The edge-case checklist turns "I have a bad feeling about this" into a repeatable procedure anyone can run on day one. You don't need experience to ask "what happens on an empty list?" — you need the *habit* of always asking. Experience just makes you faster at it; the questions are the same for a junior and a principal.

---

## Core Concept 4 — Design Review: Is It Built Sensibly?

Suppose the code is correct — it handles every edge case, leaks nothing, swallows no errors. You're not done. The second question is **design**: *is this built in a sensible way?* Code that works but is built badly is a slow tax — the next person to touch it pays interest.

You don't need a design-patterns degree to start. At the junior level, design review is four down-to-earth questions:

**1. Does it fit how the codebase already does things?** If every other handler in the project returns errors a certain way, uses a certain logger, or structures a certain layer — and this PR invents its own way for no reason — that's a design smell. Consistency is a feature; a codebase where each file has its own conventions is exhausting to work in.

```go
// Every other repository method in the project looks like this:
func (r *Repo) GetUser(ctx context.Context, id string) (*User, error)

// This PR adds one that breaks the pattern — no ctx, returns a bool instead of an error:
func (r *Repo) FetchAccount(id string) (*Account, bool)   // why different? flag it.
```

**2. Is it more complicated than it needs to be?** This is **over-engineering** — solving a grander problem than you actually have. A configurable, plugin-based, three-interface abstraction to do something one concrete function would handle. Ask: *does the change need all this, or is the author building for an imagined future?*

```python
# The task: send one welcome email.
# The PR: a NotificationStrategyFactory with an abstract base class,
#         a registry, and a plugin loader — to send ONE email.
class NotificationStrategyFactory: ...   # for the one place that sends one email?

# Simpler, and honest about the actual need:
def send_welcome_email(user): ...
```

The reviewer's line: *"This is the only notification we send. Could this just be a function until we have a second kind? The factory adds a lot to read for one email."*

**3. Are the names clear?** A function called `process` or `handleData`, a boolean `flag`, a variable `tmp2` — names that don't tell you what the thing *is* force every future reader to decode the body. You don't need to bikeshed every name, but a genuinely misleading or contentless name on a public function is worth a comment.

**4. Is there an obvious simpler approach?** Sometimes the code is fighting itself — re-implementing something the standard library does, looping three times where one pass works, or threading a flag through five functions when splitting into two functions would be clearer. If a simpler shape jumps out at you, name it (kindly, as a suggestion).

```diff
  // Reinventing a standard-library check
- found := false
- for _, x := range items {
-     if x == target { found = true; break }
- }
- if found { ... }
+ if slices.Contains(items, target) { ... }   // same thing, one line, obviously correct
```

> **Key insight:** "Does it work?" and "is it built well?" are different questions, and a clean diff can pass the first while failing the second. Working-but-overcomplicated code is a debt the *next* person pays. You don't need deep architecture knowledge to start — "does it match the codebase, is it simpler-than-this possible, are the names honest" catches most of it.

Keep this *light* on security and performance — those are real design concerns but they have their own topic. If you spot a likely injection or an obvious N² loop, flag it and point at [04 — Security & Performance Review](../04-security-and-performance-review/junior.md); don't try to do that whole job here.

---

## Core Concept 5 — Block vs Suggest, and Say the Big Thing First

Two pieces of review etiquette do most of the work at this level. Get them right and your reviews are both useful and welcome.

### Block vs suggest

Not every comment carries the same weight, and the author needs to know which is which. Sort every finding into one of two buckets:

| **Block** (must fix before merge) | **Suggest** (take it or leave it) |
|---|---|
| A real bug: crashes, wrong result, data corruption | A nicer name, a cleaner structure |
| A broken edge case (empty input panics) | A stylistic preference |
| A swallowed error that hides a failure | "You could use `slices.Contains` here" |
| A resource leak | A different-but-equivalent approach |
| A security hole (→ link 04) | A spelling fix in a comment |

Label them so the author isn't guessing. A simple convention: prefix suggestions with **`nit:`** (a nitpick — minor, optional) and state blockers plainly as problems.

```text
Blocking:  "This panics when `users` is empty — `len(users)` is 0 and we divide by it.
            Guard the empty case before the division."

nit:       "Could rename `tmp2` to `pendingCount` — took me a second to figure out what it holds."
```

The danger junior reviewers fall into is leaving twenty `nit:`-level comments with no signal about what actually matters, so the author can't tell the one real bug from the nineteen preferences. **A review with one clear blocker beats a review with twenty unranked nits.** If something isn't a real problem, either mark it `nit:` or let it go.

### Say the big thing first

Here is the most important social rule on this page, and the one juniors get wrong most often:

> **If you think the whole *approach* is wrong, say so EARLY — before you nitpick thirty lines of code that might get deleted.**

Picture it from the author's side. You leave forty inline comments fixing variable names, error wrapping, and spacing across a 300-line PR. The author spends an evening addressing all forty. *Then* you add: "Actually, I don't think we should build it this way at all — this whole module could be replaced by the existing `Cache` type." Now all forty fixes were wasted, the author redid work that's about to be deleted, and they're (rightly) frustrated.

The fix is ordering. **If you have a fundamental concern about the approach, raise it first, in one clear top-level comment, and hold the line-by-line nits until the approach is settled.** Phrase it as a question, not a verdict — you might be missing context:

```text
"Before I go line-by-line: could this reuse the existing `Cache` type instead of a new
 store? If there's a reason it can't, totally fine — I'll review as-is. Just want to check
 the overall approach before we both invest in the details."
```

That one comment, sent early and kindly, can save the author hours and saves you from reviewing code that's about to vanish. The deeper craft of *how* to phrase feedback so it lands well lives in [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/junior.md); the rule for *this* topic is just the ordering: **approach first, details second.**

> **Key insight:** Severity and order are part of the feedback, not separate from it. An unlabeled comment makes the author guess what's a must-fix; a thirty-nit review of an approach you'll later reject wastes everyone's evening. Sort into block-vs-suggest, and surface any "the whole approach is wrong" concern *first*, before the line-by-line.

---

## Real-World Examples

**1. The empty-list crash that shipped.** A reporting service computed `revenue / customerCount`. It passed code review — the logic was obviously correct, and it ran fine on every test account, all of which had customers. The first time a newly-created region had *zero* customers, the nightly report panicked with `divide by zero` and no report went out for a day. The reviewer had read the happy path and stopped. One edge-case question — "what if the count is zero?" — would have caught it in thirty seconds. This is the entire thesis of the topic in one incident.

**2. The swallowed error that corrupted data for weeks.** A sync job fetched records, transformed them, and wrote them back. The fetch was wrapped in `except Exception: pass` "to be safe." When the upstream API started intermittently failing, the fetch returned nothing, the transform ran on an empty set, and the job cheerfully wrote *empty* results over good data — silently, because the error was swallowed. By the time anyone noticed, weeks of data were gone. A reviewer scanning for swallowed errors would have flagged the bare `except` as a blocker on sight.

**3. The factory for one email.** A junior, eager to "do it properly," submitted a `NotificationStrategyFactory` with an abstract base class and a plugin registry — to send a single welcome email. The reviewer didn't reject it harshly; they asked early, in one top-level comment: *"This is the only notification we have — could it be one function until we add a second kind?"* The author agreed, deleted 120 lines, and the PR shipped as a 12-line function. Catching the over-engineering *before* the line-by-line review saved a round of pointless nits on code that got deleted.

**4. The leak that only showed up under load.** A handler opened a database transaction with `Begin()` and committed it at the end — but several early `return err` paths in the middle skipped the commit *and* the rollback, leaking a connection each time. It passed review and worked fine in testing (low traffic). Under production load, connections piled up until the pool was exhausted and the whole service stalled. A reviewer checking "every `Begin` has a guaranteed `defer rollback`" would have caught it in the diff.

---

## Mental Models

- **The author paints the happy path; you inspect the edges of the canvas.** Authors test the picture in their head — the normal input. Bugs live at the boundary: empty, nil, zero, max, halfway-failed. Your eyes go where theirs didn't.

- **A checklist beats intuition because intuition gets tired.** By line 200 of a big diff, your attention is gone and "I'll notice if something's wrong" fails. A fixed list of bug shapes and edge-case questions works the same on line 200 as on line 2.

- **Correctness and design are two separate passes.** First pass: does it produce the right answer on every input? Second pass: even so, is it built sensibly? A change can ace the first and flunk the second — and overcomplicated-but-correct code is a bill the next person pays.

- **Block vs suggest is a volume knob.** Blockers are loud — must fix, stated as problems. Suggestions are quiet — `nit:`, optional. A review where everything is the same volume is just noise; the author can't find the one real bug in the wall of preferences.

- **Approach-first is cheaper for everyone.** If the foundation is wrong, commenting on the paint is wasted effort. Raise the foundational concern first, as a question, before you both invest in details that might get torn down.

---

## Common Mistakes

1. **Reviewing only the happy path.** "The example works" is the one thing guaranteed to be true — the code was written against it. If your review doesn't probe empty/nil/zero/failure, you've rubber-stamped, not reviewed.

2. **Reading the diff hoping to *notice* bugs instead of scanning for shapes.** Hope doesn't scale past a few hundred lines. Run the fixed checklist — off-by-one, nil deref, swallowed error, leak, boundary, partial failure — every time.

3. **Treating a swallowed error as harmless.** An empty `catch`/`except: pass` or a `_`-discarded Go error is one of the highest-severity bugs you can find, *because* it's invisible — it surfaces later as wrong data with no trace. Flag it as a blocker.

4. **Forgetting that `defer`/`finally`/`with` is what makes cleanup safe.** A `Close()` on the last line runs only if you *reach* the last line — early returns and panics skip it. "Opened a resource" must pair with "guaranteed to close on every path."

5. **Confusing "I'd build it differently" with "this is wrong."** A different-but-equivalent approach is a `nit:`, not a blocker. Reserve blocking for real bugs and broken edge cases. Personal preference is a suggestion; treat it as one.

6. **Nitpicking thirty lines before mentioning the approach is wrong.** If you suspect the whole design is off, say so *first*, in one comment, before the author (and you) sink time into details that may be deleted.

7. **Doing the security/performance deep-dive here.** Spot it, flag it, point at [04](../04-security-and-performance-review/junior.md). Trying to do that whole job inside a correctness review dilutes both.

8. **Leaving twenty unlabeled comments.** With no `nit:` markers, the author can't tell the one must-fix from the nineteen take-or-leaves. Rank your findings; signal what matters.

---

## Test Yourself

1. A function returns `total / len(orders)`. Name the edge case that crashes it and the one extra check you'd ask the author to add.
2. You see `data, _ := os.ReadFile(path)` in a Go diff. What bug shape is this, and why is it dangerous?
3. A handler opens a DB transaction with `Begin()` and commits it on the last line. What's the one thing you check in the lines between, and what keyword makes it safe?
4. Walk the edge-case habit over `def first(xs): return xs[0]`. List two inputs that break or surprise, and what each does.
5. A PR adds a `NotificationStrategyFactory` with a plugin registry to send one email. Is your first comment a blocker or a question, and *when* in the review do you leave it — before or after the line-by-line nits? Why?
6. Classify each as **block** or **suggest**: (a) panics on empty input; (b) variable named `tmp2`; (c) an empty `except: pass` around a network call; (d) "you could use `slices.Contains` here."

<details>
<summary>Answers</summary>

1. **The empty list** — `len(orders)` is `0`, so it's a divide-by-zero (panic in Go, `ZeroDivisionError` in Python). Ask the author to **guard the empty case** before the division (return zero, or an error, as the domain requires).
2. A **swallowed error** — the `_` throws away the error from `ReadFile`. Dangerous because if the read fails, `data` may be empty and the code sails on with garbage, with *no* signal that anything went wrong; the failure resurfaces later as corrupt output with no trace back to the cause.
3. Check that **every early `return`/error path between `Begin` and the commit also rolls back** — otherwise the transaction (and its connection) leaks. The keyword that makes it safe is **`defer`** (e.g., `defer tx.Rollback()` right after `Begin`, which becomes a no-op once committed).
4. **Empty** `[]` → `xs[0]` raises `IndexError` (crash). **One element** `[5]` → returns `5` (probably fine, but confirm "first of one" is intended). (Also acceptable: `None` → `TypeError`; a generator → can't index at all.)
5. A **question**, not a blocker (it works; you're questioning the *approach*), and you leave it **before** the line-by-line nits. Why: if the author agrees and replaces the factory with a function, all the line-level nits on the factory code would be wasted effort — surfacing the approach concern first saves you both a pointless round.
6. (a) **block** — real crash bug. (b) **suggest** (`nit:`) — naming preference. (c) **block** — swallowed error hiding a real failure. (d) **suggest** — a nicer-but-equivalent approach.

</details>

---

## Cheat Sheet

```
THE TWO PASSES
  1. CORRECTNESS — right answer on EVERY input, not just the happy one?
  2. DESIGN      — even if it works, is it built sensibly?

BUG-HUNT CHECKLIST (scan the diff for these shapes)
  off-by-one      <= vs < ; len used as index ; s[1:] on maybe-empty
  nil deref       value from lookup/parse/call USED without a guard
  swallowed error empty catch{} ; except: pass ; Go `_` on an err
  resource leak   Open/Dial/Lock/Begin without a guaranteed defer/finally/with
  edge case       [0] or [len-1] ; divide ; subtract-below-zero ; load-all
  partial failure two state changes in a row — 2nd fails, is 1st rolled back?

EDGE-CASE HABIT (ask for every input)
  empty? null? zero? negative? one element? max/huge?
  duplicate? concurrent? what if a call it depends on FAILS?

DESIGN QUESTIONS (junior level)
  fits the codebase's conventions?
  simpler than this possible? (over-engineering = solving a bigger problem than you have)
  names honest? (process / tmp2 / flag → decode tax)
  obvious simpler approach? (reinventing the stdlib? looping 3× for 1 pass?)

BLOCK vs SUGGEST
  BLOCK   = real bug, broken edge case, swallowed error, leak, security hole
  SUGGEST = nicer name, cleaner shape, equivalent approach   → prefix `nit:`
  one clear blocker > twenty unranked nits

ORDER
  approach wrong? SAY IT FIRST (one question), before the line-by-line nits.
```

---

## Summary

- **Correctness is catching the cases the author didn't try.** Authors write and test the happy path; bugs live in the gap between what they imagined and what can actually occur. Your value is standing in that gap.
- **Run the bug-hunt checklist on every diff:** off-by-one/boundary, nil dereference, swallowed errors, resource leaks, edge cases, and "what if this fails halfway?" These are finite, recurring *shapes* — scan for them instead of hoping to notice them.
- **Build the edge-case habit:** for every new function, ask empty? null? zero? negative? one element? max? duplicate? concurrent? what if a dependency fails? The question that *bites* is usually the bug.
- **Design review asks "is it built sensibly?"** — does it fit the codebase, is it over-engineered, are the names honest, is there an obvious simpler approach? A clean diff can pass correctness and fail design, and overcomplicated code is a bill the next person pays.
- **Sort findings into block vs suggest** (`nit:` for the optional ones), and if you think the whole **approach** is wrong, **say it first** — before nitpicking lines that might get deleted. Keep security/performance light here; that's [04](../04-security-and-performance-review/junior.md)'s job.

You now have the core review method: hunt for known bug shapes, test the edges, judge the design, and rank what you find. Everything else — security, performance, the craft of phrasing feedback — builds on this foundation of *finding the real problem and naming its severity*.

---

## Further Reading

- Google's [**What to look for in a code review**](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — the canonical short checklist (design, functionality, complexity, tests, naming). Read it once a month until it's reflex.
- *Software Engineering at Google* — **Chapter 9, "Code Review."** Why review exists, what it's actually for, and how a healthy review culture catches bugs without grinding the team to a halt.
- *Working Effectively with Legacy Code* (Michael Feathers) — for spotting the resource-leak and partial-failure shapes in code that wasn't built with tests in mind.
- The [middle.md](middle.md) of this topic, which goes deeper on invariants, designing for failure, spotting subtle concurrency bugs, and reviewing the *architecture* of a change rather than just its lines.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/junior.md) — the overall triage sequence; this topic is the deep dive on *does it work* and *is it built sensibly*.
- [04 — Security & Performance Review](../04-security-and-performance-review/junior.md) — the security and performance bug shapes, kept light here on purpose.
- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/junior.md) — *how* to phrase blockers and suggestions so they land well, not just how to sort them.
- [Testing](../../testing/) — the edge cases you find in review are exactly the tests that should exist; writing them is the other side of this coin.
- [Code Quality Metrics](../../code-quality-metrics/) — complexity and coupling metrics that quantify the "is it built sensibly?" instinct you apply by eye here.
