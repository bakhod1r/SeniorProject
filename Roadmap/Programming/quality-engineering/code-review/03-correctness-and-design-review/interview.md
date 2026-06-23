# Correctness & Design Review — Interview Level

> **Roadmap:** [Code Review](../README.md) → Correctness & Design Review
> *A correctness-and-design interview rarely asks "what is a code review." It hands you a function and says "find the bug," then watches whether you check the error path and the empty case, not just the happy line. Then it asks "this PR works but the design is wrong — now what," and watches whether you reach for the diff or for the author. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Introduction](#introduction)
3. [Prerequisites](#prerequisites)
4. [Bug-Hunting](#bug-hunting)
5. [Concurrency](#concurrency)
6. [Design & Evolvability](#design--evolvability)
7. [Feedback Timing](#feedback-timing)
8. [Scale & Scenarios](#scale--scenarios)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *moves* they keep returning to:

- **read the error path, not just the happy path** (where most production bugs hide)
- **read what's *not* in the diff** (missing cases, unupdated callers, the test that wasn't added)
- **separate "wrong" from "I'd do it differently"** (block correctness; suggest taste)
- **push mechanical bugs to tooling, reserve human eyes for design and intent**

Nearly every question in this bank is one of those four moves wearing a costume. The candidates who do well are the ones who *name the move* — "let me check the failure path," "what calls this?" — before reading line by line.

---

## Introduction

Correctness-and-design review is the part of code review a linter cannot do for you. A type checker proves the code is *well-formed*; a test proves it works *for the inputs you thought of*; a sanitizer proves a *specific* class of memory or threading bug is absent on the paths you ran. None of them tell you the function returns the wrong answer for an empty list, swallows the database error, leaks a file handle on the early return, or models a state that should be impossible. None of them tell you the abstraction is wrong and will cost the next ten changes.

That residue — *is it correct, and is it the right shape?* — is what a human reviewer is for, and it is exactly what these interviews probe. The strongest signal is not whether you can spot a missing semicolon; it's whether your eyes go to the edges (empty, zero, max, concurrent, failure) and to the parts of the system the diff *doesn't* show. This page organizes the question bank by theme, junior to staff, and flags the distinction each question is testing so you can recognize it through the costume.

---

## Prerequisites

- **Reading code fluently in at least one language** — you should be able to trace control flow and spot an early return without running it.
- **The bug-pattern vocabulary** — off-by-one, nil/null dereference, swallowed errors, resource leaks, integer overflow, time/timezone, idempotency. If these aren't reflexes, start with [junior.md](junior.md).
- **Basic concurrency literacy** — what a data race is, why shared mutable state is dangerous. The concurrency section assumes you've at least *seen* a race.
- **What a code review is *for*** — finding defects and improving design before merge, not gatekeeping or style policing. See [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/interview.md).
- **Comfort with the idea that tooling catches the mechanical class** — types, linters, sanitizers, and tests are the first line; humans are the expensive second line reserved for what tools can't see.

---

## Bug-Hunting

### Q: "Review this function for correctness." Walk me through how you actually do it.

> **Testing:** Do you have a *method*, or do you read top-to-bottom and hope a bug jumps out?

**A.** I don't read line by line first — that's how you miss the bug that's in what's *absent*. I run a fixed pass:

1. **Read the signature and the contract.** What does it claim to return, what can it receive, what does it do on failure? Now I know what "correct" means.
2. **Walk the edge-case matrix** against the body: empty / zero / one / max / negative / duplicate / concurrent / failure. For each input class, does the code do the right thing?
3. **Read the error path specifically.** Every `if err != nil`, every `catch`, every early return — is the error handled, or swallowed? Are resources released on *that* path too?
4. **Read what's not in the diff.** Did this change a contract whose callers weren't updated? Is there a new branch with no test? A new error with no handling?

Only then do I read the happy path closely. Concrete: given a `func median(xs []int) int`, my first question isn't about the algorithm — it's "what does this return for `nil`/empty?" because that's the input the author almost certainly didn't test, and it's a divide-by-zero or an index-out-of-range waiting to happen.

### Q: Here's a function. Find the bug.

```go
func TransferFunds(from, to *Account, amount int) error {
    if from.Balance < amount {
        return errors.New("insufficient funds")
    }
    from.Balance -= amount
    to.Balance += amount
    log.Printf("transferred %d", amount)
    return nil
}
```

> **Testing:** Does your eye go to the edges and the inputs, not just "does the arithmetic add up?"

**A.** Several, and I'd rank them:

- **No `amount` validation.** A negative `amount` passes the balance check and *steals* from `to` into `from` — `from.Balance -= -50` increases `from`. Guard `amount <= 0` first. This is the real bug; it's an input-domain hole, not an arithmetic one.
- **Nil dereference.** `from`/`to` are pointers with no nil check; a nil account panics. At minimum the contract must say they're non-nil, ideally enforced.
- **Concurrency.** If two transfers touch the same account concurrently, `from.Balance -= amount` is a read-modify-write with no lock — lost updates and negative balances. The check-then-act (`if balance < amount` … then deduct) is *also* racy: balance can change between the check and the deduction.
- **Not atomic across the two accounts.** If anything could fail between the two lines (it can't here, but in real code with I/O it can), money vanishes. This needs a transaction boundary.

The interviewer is usually fishing for the negative-amount bug first — it's the one that's invisible if you only think about the happy path with a "normal" positive number.

### Q: What's your bug-pattern checklist — the classes you actively hunt for?

> **Testing:** Whether you carry a *reusable* checklist or rediscover bugs ad hoc each time.

**A.** I keep a short list of high-frequency, high-cost patterns and check the diff against each:

| Pattern | What I look for |
|---|---|
| **Off-by-one** | `<` vs `<=`, `len` vs `len-1`, loop bounds, slice `[i:j]` ranges |
| **Nil / null deref** | unchecked pointers, map misses, optional returns used directly |
| **Swallowed errors** | `catch {}`, `_ = err`, `except: pass`, errors logged but not returned |
| **Resource leaks** | files/conns/locks opened but not released on *every* path (esp. early return / exception) |
| **Concurrency hazards** | shared mutable state, check-then-act, read-modify-write without a lock |
| **Integer overflow** | `a + b`, `len * size`, `mid = (lo+hi)/2`, durations, counters near max |
| **Time / timezone** | naive local time, DST, `now()` in tests, comparing across zones, leap seconds/days |
| **Idempotency** | retried request double-charges; "create" that isn't safe to replay |

The point of a written list is that I don't rely on a bug *catching my eye* — I go looking for each class deliberately. The expensive ones in production are usually swallowed errors and concurrency, because they pass review by *looking* fine.

### Q: A reviewer says "the diff looks correct." Why is that not enough?

> **Testing:** The single most important habit in correctness review — reading what isn't there.

**A.** Because correctness is a property of the *whole program*, and the diff is a window onto a slice of it. The most dangerous defects live in what the diff *doesn't* show:

- **Unupdated callers.** The signature changed, but two of five call sites weren't touched — they still compile (or worse, silently coerce) and now pass the wrong thing.
- **Missing cases.** A new `enum` variant or error type was added, but the `switch`/handler that consumes it has no branch for it — falls through to a default that's wrong.
- **The test that wasn't added.** New branch, new behavior, no test exercising it. The diff is "correct" for the path the author ran.
- **Removed-but-still-referenced.** A field or method was deleted; something off-screen still reads it.

So "the diff looks correct" only certifies the lines present are internally consistent. My job is to ask "what *else* must be true for this to be correct, and is the diff complete with respect to that?" — which usually means opening files the PR didn't change.

### Q: How do you review the error path, and why does it deserve special attention?

> **Testing:** Whether you know error paths are the least-tested, least-read, most-broken part of most code.

**A.** I read every failure branch as if it were the happy path, because in production it *is* a happy path for someone. Specifically:

- **Is the error swallowed?** `_ = doThing()`, empty `catch`, or logging-without-returning means a failure becomes a silent wrong result downstream — the worst kind, because there's no signal.
- **Is partial state left behind?** An error halfway through a multi-step operation: are the earlier steps rolled back, or is the system now in a half-written state?
- **Are resources released on the error path?** The leak is almost never on the happy path; it's on the early `return err` that skips the `Close()`.
- **Is the error *actionable*?** Does it carry enough context (which key, which ID) to debug, or is it a bare `"failed"` that tells an on-call engineer nothing?

Error paths are under-tested because writing a test that *forces* the failure (a disk-full, a timeout) is harder than testing success, so authors skip them. That's exactly why a reviewer's attention there has outsized value.

### Q: What edge cases do you always check, regardless of the function?

> **Testing:** Whether "edge cases" is a vague gesture or a concrete, enumerable matrix.

**A.** I run a fixed matrix and ask "what does the code do here?" for each:

- **Empty** — empty list/string/map. Does it loop zero times correctly, or divide by length and crash?
- **Zero** — zero count, zero amount, zero duration. Off-by-one and divide-by-zero land here.
- **One** — single element. Boundary logic (first/last special-casing) often breaks at size 1.
- **Max** — `MaxInt`, max length, buffer-full. Overflow and capacity bugs.
- **Negative** — negative amount/index/offset where the author assumed non-negative.
- **Duplicate** — repeated keys/IDs. "Add to set" vs "insert into table with unique constraint."
- **Concurrent** — two callers at once. The hidden one; most code is written single-threaded in the author's head.
- **Failure** — the dependency returns an error or times out.

I don't ask "are there edge cases?"; I march the function through that list. It turns a vague worry into a checklist that reliably surfaces the holes.

---

## Concurrency

### Q: Distinguish a data race, a race condition, an atomicity violation, and a deadlock.

> **Testing:** Concurrency vocabulary precision — these get conflated constantly, and the conflation hides bugs.

**A.** They overlap but are *not* synonyms:

- **Data race** — two threads access the *same memory* concurrently, at least one is a write, with no synchronization. It's a precise, mechanical property (and undefined behavior in C/C++/Go). A sanitizer can detect it.
- **Race condition** — the *correctness* depends on timing/interleaving. Broader: you can have a race condition with no data race (e.g., two correctly-locked operations whose *order* matters and isn't guaranteed).
- **Atomicity violation** — a sequence that must be indivisible isn't. Check-then-act and read-modify-write are the classics: each individual access may be synchronized, but the *compound* operation isn't, so another thread sneaks in between.
- **Deadlock** — two+ threads each hold a lock the other needs, so all block forever. Often from inconsistent lock ordering.

The distinction matters in review because the *fix* differs: a data race wants synchronization on the shared access; an atomicity violation wants the *whole compound op* under one lock or made atomic; a deadlock wants a consistent lock-acquisition order. Calling them all "a race" leads to the wrong fix.

### Q: Why can't a reviewer reliably catch a data race by reading the code?

> **Testing:** Whether you know the limits of human review and reach for the right tool.

**A.** Because races are about *interleavings*, and the number of possible interleavings is combinatorial and invisible in the source text. The buggy interleaving might happen one time in a million, on a machine with a different number of cores, under load you don't have locally. Human eyes are good at "this shared field is written without a lock" — a *smell* — but terrible at proving the absence of a race across all schedules, and worse at the ones hidden behind layers of calls.

So in review I flag the *smells* (shared mutable state, a goroutine/thread closing over a loop variable, a check-then-act on shared data) and then I insist the real verification be **a race detector run in CI** — ThreadSanitizer (`-race` in Go, TSan in C/C++/Rust). Review *narrows the search*; the sanitizer *proves it*. A reviewer who claims "I read it carefully, there's no race" is overstating what reading can do — this is exactly the boundary where you push to [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/).

### Q: What specifically do you flag when reviewing concurrent code?

> **Testing:** Concrete, actionable concurrency review — not "be careful with threads."

**A.** A focused list of high-yield smells:

- **Shared mutable state without obvious ownership.** Who's allowed to write this? If the answer isn't immediate, that's the bug nursery.
- **Check-then-act / read-modify-write** on anything shared — `if !exists { create }`, `counter++`, `balance -= x`. These need to be atomic, not two synchronized halves.
- **Lock scope.** Is the lock held across the *whole* invariant, or released between the check and the mutation? Is it held across a blocking call (lock + I/O = contention and deadlock risk)?
- **Lock ordering.** Multiple locks acquired in different orders in different functions → deadlock. I look for a documented, consistent order.
- **Goroutines/threads capturing loop variables** or closing over mutating state.
- **Unbuffered assumptions** — channels, queues: does this block forever if the consumer is gone?
- **"It's probably fine because it's fast."** Speed doesn't make a read-modify-write atomic; that reasoning is itself a red flag.

And I pair every one of these with "is this on the `-race`/TSan path in CI?" — because flagging the smell without verification is half a review.

### Q: "How would you catch a data race in review?" Walk me through it end to end.

> **Testing:** The synthesis — combining human smell-detection with tooling, and knowing which does what.

**A.** Two layers, deliberately:

1. **In the review (narrow the search).** I scan for the smells above — shared state, check-then-act, lock held too narrowly. When I find one, I don't say "looks racy"; I write the concrete interleaving: "if thread A passes the `exists` check while thread B is mid-`create`, both create — here's the sequence." A specific interleaving is a real finding; a vague worry is noise the author will dismiss.
2. **In CI (prove it).** I require the concurrent code to run under a race detector — Go's `-race`, TSan for C/C++/Rust — against tests that actually exercise concurrency (parallel callers, not a single-threaded happy-path test). The detector catches the races my eyes can't enumerate, including ones in code I didn't think to suspect.

The key judgment: I treat review as *insufficient on its own* for races. If the team is shipping concurrent code without a sanitizer in CI, the highest-leverage thing I can do in review is push for that infrastructure — because no amount of careful reading scales to catching races reliably. That's pushing a whole bug *class* to tooling rather than to human vigilance.

---

## Design & Evolvability

### Q: A PR works — tests pass, logic is correct — but you think the design is wrong. What do you do?

> **Testing:** Possibly the most important judgment question in the bank. Can you separate "wrong" from "different," and do you escalate timing correctly?

**A.** First I separate two cases, because they're handled completely differently:

- **"I'd have done it differently" (taste).** If it works, it's maintainable, and my objection is stylistic, I either say nothing or leave it as an explicit *non-blocking* suggestion ("nit:" / "consider:"). Blocking a working PR over taste is how reviews become adversarial and slow.
- **"This is genuinely the wrong shape" (design defect).** The abstraction is wrong, the coupling will make the next changes painful, it duplicates a system we already have, or it bakes in an assumption that will break. This is worth raising as a real concern.

For the second case, *how* I raise it depends on cost and reversibility. If it's a big, hard-to-reverse design choice, I don't nitpick lines — I step back and say "before we go line-by-line, I think the approach has a problem: [concrete issue]. Here's an alternative: [concrete sketch]. Can we talk?" — and I move it to a synchronous conversation, because design disagreements die in comment threads. And I'm honest about timing: if this is the *first time* I'm seeing a large design and it's already fully built, that's partly a process failure — design feedback should have come at a doc or sketch, not at a finished PR. I'll say so and push for earlier review next time, but I won't pretend the sunk cost makes a wrong design right.

### Q: What do you mean by judging the "shape" of code? What are you actually looking at?

> **Testing:** Whether "design review" is a vague aesthetic or a set of concrete, nameable properties.

**A.** Shape is a handful of concrete properties I can point at:

- **Fit** — does this belong here? Is the logic in the right layer/module, or is business logic leaking into a handler, or a util doing domain work?
- **Abstraction quality** — does the abstraction *hide* the right complexity, or is it a shallow wrapper that adds a layer without removing any difficulty? (Ousterhout: deep modules, simple interface over substantial implementation.)
- **Coupling** — how many things must change together when this changes? Does this module reach into another's internals?
- **Over- vs under-engineering** — is there a framework for a problem we don't have (premature generality), or is something genuinely-shared copy-pasted three times?
- **DRY vs premature DRY** — is duplication being removed because the two uses are *truly the same concept*, or are two things that merely *look* alike being fused into a wrong abstraction that they'll fight against later?

I judge shape by asking "what will the *next* five changes to this area cost?" Good shape makes likely future changes cheap and local; bad shape makes them expensive and far-reaching. That future-cost framing is what turns "I don't like it" into a reviewable claim.

### Q: When is removing duplication the *wrong* call?

> **Testing:** Whether you understand DRY as being about knowledge, not about text — the "premature DRY" trap.

**A.** When the two pieces of code are *coincidentally* similar rather than *conceptually* the same. DRY is about a single source of truth for a piece of *knowledge*, not about deleting repeated characters. If I fuse two functions that happen to look alike today but represent different concepts — say, "tax calculation for orders" and "tax calculation for refunds" — the first time their rules diverge (and they will, because they're different concepts), the shared abstraction sprouts a boolean flag, then another, until it's a tangle that serves neither caller well.

So in review, before approving a "deduplication," I ask: *are these the same knowledge, or do they just rhyme?* The cost asymmetry guides it — "a little copying is far cheaper than the wrong abstraction" (Sandi Metz), because duplication is easy to fix later when the true shape is clear, whereas a wrong abstraction is sticky and gets *more* entangled over time. Premature DRY is one of the most common over-engineering failures, and it passes review precisely because "removing duplication" sounds virtuous.

### Q: "An API change looks safe — how do you check it won't break callers?"

> **Testing:** Backward-compatibility reasoning and whether you know "compiles" ≠ "compatible." Hyrum's law lurks here.

**A.** "Looks safe" usually means "the signature change is small," which is not the same as "compatible." I check several layers:

1. **Who calls this?** Find every caller — in this repo *and* across services if it's a published interface. A signature change that the compiler catches internally is the *easy* case; the dangerous case is an interface consumed by code you don't compile.
2. **Is it source- or binary-compatible?** Reordering parameters, narrowing a type, changing a return shape, adding a required field — these break callers even when the function "still exists."
3. **Hyrum's law — observable behavior is the real contract.** With enough consumers, *every* observable behavior of your API is depended on by *someone*, regardless of what you documented. So I look past the signature: did error message text change (someone parses it)? Did ordering of a previously-unordered result become relied upon? Did a timeout, a default, or a side effect change? Those break callers with zero signature change.
4. **Additive vs breaking.** Adding an optional field or a new method is usually safe; changing or removing is not. The safe path is expand-then-contract: add the new, migrate callers, remove the old — never change in place.

For a truly public API I don't trust reading alone: I want contract/consumer-driven tests so a break *fails a test* rather than a customer. "It compiled in our repo" only certifies the callers we build.

### Q: What does "make illegal states unrepresentable" mean, and how does it change a review?

> **Testing:** Whether you push correctness *into the types* rather than relying on runtime checks and reviewer vigilance.

**A.** It means designing the data model so that invalid combinations *cannot be constructed* — the type system rejects them at compile time, instead of the code checking for them at runtime (and the reviewer hoping every check is present). Classic example: a struct with `isLoggedIn bool` and `user *User` admits two illegal states — logged in with no user, logged out with a user. Replace it with a sum type / tagged union (`LoggedOut | LoggedIn{user}`) and those states literally can't exist; there's nothing to check and nothing to forget.

In review this changes what I look for. When I see a cluster of runtime validations — "if status is X, field Y must be set" — I ask whether the *type* could make that invariant structural instead. When I see optional fields that are "always set in practice," I ask whether they should be non-optional. Pushing correctness into the type means the compiler enforces it on every future change, forever, instead of every reviewer having to re-verify it. It's the highest-leverage design feedback because it removes a whole class of bugs from the review surface entirely.

### Q: How does reversibility change how hard you push on a design decision?

> **Testing:** Calibration — whether you spend your reviewing capital where it actually matters.

**A.** I push proportionally to how hard the decision is to undo. Bezos's framing — "one-way doors vs two-way doors" — is exactly the review heuristic:

- **Reversible (two-way door):** an internal function name, a private module's structure, a choice we can refactor next sprint with a local change. Here I keep feedback light; if it works, ship it and iterate. Blocking on an easily-reversible choice wastes everyone's time.
- **Irreversible or expensive-to-reverse (one-way door):** a public API contract, an on-disk data format, a database schema, a wire protocol, a dependency that'll metastasize. A mistake here is paid down for *years* and may require coordinated migrations across teams.

So I spend my reviewing capital on the one-way doors. For those I'll slow the PR down, ask for a design discussion, and not approve until I'm convinced — because the cost of being wrong is enormous and the cost of getting it right now is one conversation. For two-way doors I bias toward trust and speed. Treating every decision as equally weighty is a way to be simultaneously annoying and ineffective.

---

## Feedback Timing

### Q: Why must "this is the wrong approach" feedback come early, and what's the cost if it doesn't?

> **Testing:** Whether you understand the cost-of-change curve and that PR-time is *late* for design.

**A.** Because the cost of changing a decision rises steeply the later it's caught, and "wrong approach" is the most expensive kind of finding. At a design sketch it's a five-minute conversation. At a draft PR it's a re-architecture of work-in-progress. At a finished, tested, "ready to merge" PR it's throwing away days of someone's work — which is why it's so often *not* given: the reviewer sees the sunk cost, swallows the concern, and approves a design they know is wrong. That's the worst outcome, because the cost only compounds once it's merged and built upon.

The lesson is to move design feedback *upstream* of the PR: review the design doc, the RFC, the rough sketch, the first 50 lines — *before* the author has invested in building it out. A code review that's the *first* place a large design is examined is a process failure. So when I'm asked this, I make the point that the fix isn't "give harsh feedback at the PR"; it's "create earlier checkpoints so the expensive feedback lands when it's cheap to act on." And when I *do* find a wrong approach at PR time anyway, I name it immediately and clearly rather than letting sunk cost talk me out of it — late is still better than never.

### Q: How do you give design feedback so it's useful and not just demoralizing?

> **Testing:** Whether you turn criticism into something actionable — the concrete-alternative habit.

**A.** The rule I follow: **never reject without proposing a concrete alternative.** "I don't think this design is right" is an opinion that stalls the PR and frustrates the author. "This couples the parser to the network layer, which'll make it untestable — what if we passed the data in instead of having it fetch? Here's roughly how that'd look: [sketch]" is something the author can act on, agree with, or counter with information I don't have.

Three things make design feedback land:

- **State the problem in terms of consequences, not taste** — "this will make the next change touch five files" beats "this is ugly."
- **Offer a concrete alternative**, even a rough one, so the conversation is about two options rather than a veto.
- **Hold it loosely** — the author may know a constraint I don't. I'm raising a concern, not issuing a verdict; "help me understand why X" is often better than "do Y."

And for anything beyond a small point, I take it to a call or a doc comment thread with the author, because nuanced design disagreement compresses badly into inline PR comments and reads as colder than intended.

### Q: When do you *block* a PR versus leave a *suggestion*? Split it by correctness vs design.

> **Testing:** Whether you wield blocking power proportionally — the line between a gate and a nuisance.

**A.** The axis is "will this hurt if it merges, and how reversibly?"

- **Correctness defects → block.** A real bug, a swallowed error, a security hole, a data race, a broken contract — these are not negotiable and not "preferences." If it's wrong, it doesn't merge. This is the non-negotiable core of the reviewer's job.
- **Design on a one-way door → block (with a conversation).** A wrong public API or schema is expensive forever; I'll hold it and move to a design discussion, as above.
- **Design on a two-way door → suggest, don't block.** If it works and the design choice is reversible, I leave a clear suggestion and approve, trusting the author to weigh it. Iterating later is cheap.
- **Taste / style → non-blocking nit, or nothing.** Prefixed `nit:` so it's explicitly droppable. Most style is the linter's job anyway, not mine.

The discipline is to reserve *blocking* for "this is wrong" and "this is an expensive irreversible mistake," and to make everything else explicitly optional. A reviewer who blocks on preferences trains authors to dread and route around them; a reviewer who never blocks on real bugs isn't doing the job. Calibrated blocking is what makes you a trusted reviewer rather than a bottleneck.

---

## Scale & Scenarios

### Q: A class of bug keeps showing up in reviews. What's the senior move?

> **Testing:** Whether you scale yourself by tooling the bug class away instead of catching it manually forever.

**A.** Catching the same bug by hand in review every week doesn't scale and isn't reliable — eventually a tired reviewer misses one. The senior move is to **make the bug class impossible or automatically caught**, moving it from human vigilance to tooling:

- If it's a *mechanical* pattern (unchecked error, missing `defer Close`, a banned function), write a **lint rule** so it fails CI, not a reviewer's eyes.
- If it's a *type-shaped* invariant ("this ID must not be confused with that ID"), encode it in the **type system** so the compiler rejects it.
- If it's a *memory or threading* bug, get the relevant **sanitizer** (ASan/TSan/`-race`) into CI so it's caught on every run.
- If it's a *behavioral* regression, add a **test** that fails when the bug recurs.

The principle: **humans should review design and intent; machines should catch the mechanical classes.** Every recurring bug that a human keeps catching is a signal that a tool is missing. Pushing it to tooling is more reliable (machines don't get tired), faster (caught at commit, not at review), and frees reviewer attention for the judgment calls only humans can make. The recurring-bug-in-review pattern is itself the trigger to invest in tooling.

### Q: Where's the line between what a human reviewer should catch and what tooling should?

> **Testing:** Whether you understand the *division of labor* that makes review scale.

**A.** The line is roughly *mechanical and decidable* versus *contextual and judgment-laden*:

- **Tooling owns:** formatting, style, unused variables, type errors, known anti-patterns, unchecked errors, many memory/threading bugs (via sanitizers), test coverage gaps, dependency vulnerabilities. Anything a machine can decide deterministically should be a machine's job — it's faster, cheaper, never tired, and never political.
- **Humans own:** is this the *right design*? Does the code do what the author *intended* (and is the intent right)? Is the abstraction sound? Will this be maintainable? Is the edge-case reasoning correct for *this domain*? Does this API choice fit how the system will evolve? These require context, taste, and understanding of *why*, which tools don't have.

A review where a human is manually checking formatting is a misallocation — that human attention is the scarcest resource on the team and it's being spent on something a linter does for free. The well-run team pushes everything decidable to CI so that human review is *entirely* about design, correctness reasoning, and intent. When I review, finding myself making a mechanical comment is a prompt to ask "why isn't a tool doing this?"

### Q: "Review this for correctness" — they give you a function that *parses user input*. What's your angle?

> **Testing:** Whether your edge-case and failure-path instincts fire hardest exactly where input is untrusted.

**A.** Parsing untrusted input is where the edge-case matrix and the error path matter most, so I lean in hard:

- **Malformed input** — not just valid-but-edge values, but *garbage*: truncated, wrong type, extra fields, wrong encoding, gigantic input. Does it reject cleanly or panic / misbehave?
- **The error path is the main path here.** For a parser, "invalid input" isn't an edge case, it's a *primary* case. Is every parse failure returned as a clean error, or does a malformed field cause a nil deref / index-out-of-range / swallowed error that yields a wrong-but-accepted result?
- **Boundary values** — empty, zero-length, max-length, the off-by-one at the buffer edge (a classic overflow site).
- **Injection / trust** — is this input later used in a query, a path, a command, a template? Parsing correctly *and* safely overlaps with security review; I'd flag it toward [04 — Security & Performance Review](../04-security-and-performance-review/interview.md).
- **Idempotency / determinism** — same input, same output? Any hidden state?

For input-handling code I want the failure modes *tested*, not just reasoned about — fuzzing or property-based tests are the right tool, because I can't enumerate malicious inputs by reading. So my review comment is often "add a fuzz/property test for the parser" rather than only listing inputs I happened to think of.

### Q: A staff engineer says "the bug isn't in this diff, it's in the design that allowed it." Unpack that.

> **Testing:** Senior systems thinking — seeing the design defect behind the local bug.

**A.** It means the local bug is a *symptom*, and fixing only the symptom guarantees the next one. If a function had a nil-deref because an "always set" field was optional, I can add a nil check — or I can ask why the field is optional at all, and make it non-optional so *no* code can deref nil there. If a race slipped through because shared state had no clear owner, I can add a lock here — or I can redesign so the state has a single owner and the sharing that enabled the race doesn't exist.

The staff-level instinct is to look *up* from the bug to the design that made it possible, and to weigh fixing the class against fixing the instance. Sometimes the right call is the local fix (the design change is too big for this PR) — but then I file the design issue, because a design that *keeps producing* the same bug is the real defect. "Make illegal states unrepresentable," moving invariants into types, and giving shared state clear ownership are all expressions of this: don't just patch the leak, ask why the boat has a hole there. This is the difference between a reviewer who makes the code *less wrong* and one who makes the design *unable to be wrong* in that way again.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: Data race vs race condition?** A: Data race = unsynchronized concurrent access with a write (mechanical, sanitizer-detectable); race condition = correctness depends on timing (broader; can exist without a data race).
- **Q: First thing you check in a function for correctness?** A: What it returns for empty/nil — the input the author almost certainly didn't test.
- **Q: What's "what's not in the diff"?** A: Unupdated callers, missing cases for new variants, the test that wasn't added — defects in code the PR doesn't show.
- **Q: Block or suggest for a real bug?** A: Block. Correctness isn't a preference.
- **Q: Block or suggest for a reversible style choice?** A: Suggest (non-blocking nit); reserve blocking for bugs and irreversible mistakes.
- **Q: Why can't review reliably catch races?** A: The buggy interleaving is one-in-a-million and invisible in source; you need a race detector (TSan / `-race`).
- **Q: DRY in one line?** A: One source of truth for a piece of *knowledge* — not deleting text that merely looks alike.
- **Q: When is dedup wrong?** A: When the two pieces only coincidentally resemble each other; fusing different concepts yields a wrong abstraction.
- **Q: "Make illegal states unrepresentable"?** A: Model data so invalid combinations can't be constructed; the type enforces the invariant instead of runtime checks.
- **Q: One-way vs two-way door?** A: Irreversible (schema, public API, data format) vs reversible (internal naming, private structure); push hard only on one-way doors.
- **Q: Hyrum's law?** A: With enough users, every observable behavior of your API is depended on by someone — so "the signature didn't change" doesn't mean compatible.
- **Q: Recurring bug class — what do you do?** A: Tool it away — lint rule, type, sanitizer, or test — instead of catching it by hand forever.
- **Q: When does design feedback cost the least?** A: At the sketch/doc, before it's built; a PR is *late* for "wrong approach."
- **Q: Most under-reviewed part of a function?** A: The error path — least tested, least read, most broken.
- **Q: Check-then-act, why dangerous?** A: Another thread can change state between the check and the act; the compound op must be atomic.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Reviewing only the happy path — never mentioning the error path or what's *not* in the diff.
- Conflating data race / race condition / atomicity violation as "a race," or claiming you can prove a race absent by reading.
- Blocking working PRs over taste, or never blocking real bugs — uncalibrated use of blocking power.
- Treating every design decision as equally weighty (no reversibility/cost calibration).
- "Remove the duplication" as a reflex, with no test for whether it's the same *concept*.
- Giving design feedback as a veto with no concrete alternative.
- Proposing to catch a recurring bug class by "reviewing more carefully" instead of tooling it away.
- Thinking "it compiled / it linked" certifies an API change is backward-compatible.

**Green flags:**
- Running a *method* — signature/contract, edge-case matrix, error path, then "what's not in the diff" — before reading line by line.
- Going to empty/nil/zero/max/negative/concurrent/failure reflexively.
- Naming the *distinction* (data race vs atomicity violation) and matching the fix to it.
- Pairing concurrency smells in review with "is this on the `-race`/TSan path in CI?"
- Separating "wrong" (block) from "I'd do it differently" (suggest), and pushing design feedback *upstream* of the PR.
- Calibrating push to reversibility — hard on one-way doors, light on two-way.
- Pushing correctness into types ("make illegal states unrepresentable") and recurring bugs into tooling.
- Citing Hyrum's law unprompted when judging an API change.

---

## Cheat Sheet

| Situation | The move |
|---|---|
| "Review for correctness" | Signature/contract → edge-case matrix → error path → what's not in the diff |
| Bug-pattern hunt | off-by-one, nil deref, swallowed error, leak, concurrency, overflow, time, idempotency |
| Edge-case matrix | empty / zero / one / max / negative / duplicate / concurrent / failure |
| Concurrent code | flag shared state, check-then-act, lock scope/order — **then require `-race`/TSan in CI** |
| Race in review | write the specific interleaving (narrow) + insist on sanitizer (prove) |
| PR works, design wrong | separate taste from defect; if defect, propose a concrete alternative, go synchronous, push earlier next time |
| Judging "shape" | fit, abstraction depth, coupling, over/under-engineering, real-DRY vs premature-DRY |
| Dedup request | "same knowledge or just rhymes?" — coincidental similarity → don't fuse |
| API change "looks safe" | find all callers, additive-vs-breaking, Hyrum's law (behavior is the contract), contract tests |
| Invariant enforced at runtime | ask if the *type* can make illegal states unrepresentable |
| Decision is irreversible | one-way door → push hard, slow down; two-way → trust and iterate |
| Block vs suggest | correctness/irreversible → block; reversible design → suggest; taste → `nit:` or nothing |
| Recurring bug class | tool it away — lint / type / sanitizer / test — not "review harder" |
| Mechanical comment in review | prompt to ask "why isn't a tool doing this?" |

---

## Summary

- **Bug-hunting is a method, not a read-through.** Signature and contract first, then march the function through the edge-case matrix (empty/zero/one/max/negative/duplicate/concurrent/failure), then read the *error path* specifically, then read **what's not in the diff** (unupdated callers, missing cases, the absent test). The dangerous bugs hide in the absent and the failure path.
- **Concurrency is the differentiator, and review alone can't carry it.** Know the precise distinctions — data race vs race condition vs atomicity violation vs deadlock — and match the fix to each. Eyes catch *smells* (shared state, check-then-act, lock scope); a **race detector in CI** proves absence. Flag the smell *and* push for the sanitizer.
- **Design review judges shape and evolvability.** Fit, abstraction depth, coupling, over/under-engineering, and real-DRY vs premature-DRY — all framed as "what will the next five changes cost?" Push correctness into types ("make illegal states unrepresentable") and check API changes against Hyrum's law, not just the signature.
- **Timing and calibration are the senior skills.** "Wrong approach" feedback must land *upstream* of the PR where it's cheap; always pair a design objection with a concrete alternative; **block** correctness defects and irreversible (one-way-door) mistakes, **suggest** reversible design, and leave taste as a droppable nit. Push hard only where being wrong is expensive.
- **Scale yourself with tooling.** Mechanical, decidable bug classes belong to linters, types, sanitizers, and tests; reserve scarce human attention for design and intent. A recurring bug a human keeps catching is a missing tool — and the staff move is to fix the *design that allowed* the bug, not just the bug.

---

## Further Reading

- *Software Engineering at Google* — Chapter 9, "Code Review." The definitive treatment of review at scale, including what to block on and the human dynamics of design feedback.
- *A Philosophy of Software Design* (John Ousterhout) — deep modules, complexity as the enemy, and what "good design" concretely means; the backbone of the shape/abstraction answers.
- *Working Effectively with Legacy Code* (Michael Feathers) — for reviewing change in code without good tests, and seam-finding.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — junior grounds the bug-pattern vocabulary; senior goes deeper on design stewardship and scaling review across an org.
- "Hyrum's Law" (hyrumslaw.com) and Sandi Metz, "The Wrong Abstraction" — the two essays behind the API-compatibility and premature-DRY answers.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/interview.md) — the review priority order that puts correctness and design ahead of style.
- [04 — Security & Performance Review](../04-security-and-performance-review/interview.md) — the other two axes of substantive review; input-parsing and API changes spill into security.
- [Testing](../../testing/) — the tests that prove the correctness you reason about in review, and where to demand them.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — TSan/`-race`/ASan: the tooling that catches the concurrency and memory bugs review can't.
- [Code Quality Metrics](../../code-quality-metrics/) — coupling, complexity, and the signals that quantify the "shape" you judge by eye.
