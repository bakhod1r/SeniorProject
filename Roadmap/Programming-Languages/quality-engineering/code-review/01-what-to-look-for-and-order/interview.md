# What to Look For & In What Order — Interview Level

> **Roadmap:** [Code Review](../README.md) → What to Look For & In What Order
> *A code-review interview rarely asks "do you review code." It hands you a 300-line PR and watches the order you read it in — whether you chase a misnamed variable for ten minutes before noticing the change solves the wrong problem, and whether you know that defect detection collapses past a few hundred lines whatever your discipline. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [The Data](#the-data)
6. [Judgement & Scale](#judgement--scale)
7. [Scenarios](#scenarios)
8. [Rapid-Fire](#rapid-fire)
9. [Red Flags / Green Flags](#red-flags--green-flags)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

The skill this topic interviews for is *triage*, not *thoroughness*. Anyone can list things to check in a PR — correctness, design, tests, naming, style. The signal is whether you check them in an order that spends your scarce, decaying attention on the findings that matter, and whether you stop the review when the data says you've stopped finding things.

Each question below carries three parts: **Q** (the prompt), a short note on **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). The thread running through all of them is one ordering and the reason for it:

> **goal → correctness → design → tests → readability → style**

Read top to bottom, the order spends effort where a defect is most expensive to discover late: a wrong *goal* invalidates everything below it, so it's first; *style* is mechanical and a linter does it, so it's last and you should never type it by hand. Candidates who do well *name the order and justify it from cost*, then apply it to whatever PR you hand them. Candidates who do poorly start at the first red squiggle and review top-of-file downward.

---

## Prerequisites

You should be fluent in the language of the PR under review and comfortable with:

- **Reading a diff** — hunks, context lines, and the limits of the unified-diff view (renames, moved code, behavioral change with no diff).
- **The local VCS workflow** — fetching and checking out a branch, reading commit-by-commit history, the difference between a squashed and an unsquashed PR.
- **Tests as a first-class artifact** — being able to read a test and infer the contract it pins, not just whether it's green.
- The earlier code-review framing: review is a *collaboration to improve the change and share context*, not a gate or a style tribunal. The order below only makes sense if you accept that framing.

If "I'd read the whole diff top to bottom and comment on anything that looks off" is your honest default, that's the habit these questions are designed to break.

---

## Fundamentals

### Q: What is code review *for* — and, just as important, what is it *not* for?

> **Testing:** Whether you have a purpose model, or treat review as a generic "check the code" ritual.

**A.** Code review exists for four things, roughly in priority order:

1. **Correctness & design** — catch defects and bad approaches *before* they ship and before they're expensive to unwind.
2. **Maintainability** — make sure the next person (often the author in six months) can read and change this code.
3. **Knowledge sharing** — spread context about the system so it's not siloed in one head; reviewing is how the team stays collectively fluent.
4. **Shared ownership** — once I approve, it's *our* code, not *your* code; review is the moment the team takes joint responsibility.

What it is *not* for: **style policing** (a formatter and a linter do that deterministically, with no ego and no latency), **gatekeeping or status display** (review is not where I prove I'm smarter than the author), and **redesigning the change to how I'd have written it** (taste is not a defect). The fastest way to spot a broken review culture is a PR with twelve comments, eleven about whitespace and naming and one — buried — about a real race condition. The order of operations exists precisely to stop that inversion.

### Q: Give me your order of operations for reviewing a PR, and justify *why* that order.

> **Testing:** The core of the whole topic. Can you both state the order and derive it from first principles?

**A.** My order is **goal → correctness → design → tests → readability → style**, and the justification is *cost of discovering the problem late*:

- **Goal first.** What problem is this solving, and is this the right problem? I read the PR description and linked issue before a line of code. If the change solves the wrong problem or the approach is fundamentally off, *every other comment I'd make is wasted* — there's no point polishing the naming in a function that shouldn't exist. This is the highest-leverage check and the cheapest to do.
- **Correctness next.** Does it do what it claims, including edge cases, error paths, and concurrency? A correctness bug that ships is the most expensive class of defect to find later — in production, with a customer attached.
- **Design third.** Does it fit the existing architecture, draw boundaries in sensible places, avoid coupling that will hurt later? Design problems are cheap to fix in review (move a function, change an interface) and brutal to fix after the code has callers.
- **Tests fourth.** Do the tests actually pin the behavior, including the edge cases I worried about in step two? Are they testing behavior or implementation?
- **Readability fifth.** Names, structure, comments-where-needed. Real, but a human judgement call and lower-stakes than the above.
- **Style last, and automated.** Formatting, import order, brace placement. A machine should have decided this before I ever opened the PR; if I'm typing a style comment, the team's tooling has failed.

The principle in one line: **review in descending order of how expensive the problem is to discover after merge.** Goal-wrongness is catastrophic-and-cheap-to-catch-now; style is trivial-and-already-automated. The order falls out of that.

### Q: Why is style explicitly *last*, and ideally not done by a human at all?

> **Testing:** Whether you understand that human attention is the scarce resource and machines don't have ego.

**A.** Three reasons, compounding. First, **style is deterministic** — "two spaces or four," "imports sorted how" — so it's exactly the kind of judgement a formatter (`gofmt`, `prettier`, `black`) and a linter make perfectly and instantly. Spending a human on it is spending your most expensive, most limited resource (focused attention) on your cheapest problem. Second, **style comments crowd out substance** — a reviewer who's burned attention on whitespace has less left for the race condition, and an author drowning in nits often *stops reading* before the one comment that mattered. Third, and most underrated, **style debates have no ground truth, so they generate friction without producing quality** — a bot enforcing a style guide is impersonal and unarguable; a human doing it reads as nitpicking and damages the relationship that makes the *important* feedback land. So: configure the formatter and linter, run them in CI as a merge gate, and let the human start where the machine can't go.

### Q: A teammate says "review is the quality gate — nothing ships unless it's perfect." What's wrong with that framing?

> **Testing:** Whether you understand review's role and limits, including throughput and the perfect-is-the-enemy distinction.

**A.** Two things. First, **review is one quality layer, not the only one** — types, tests, CI, linters, and staged rollouts all catch defects, often more reliably than a human skim. Treating review as *the* gate overloads it and breeds false confidence ("it was reviewed" ≠ "it's correct"). Second, **"perfect" is the wrong bar — the bar is "improves the codebase health and is correct."** Google's guidance is explicit here: a reviewer should approve once the change *definitely improves* the codebase, even if it isn't perfect, rather than holding it hostage to the reviewer's ideal version. Holding for perfection has a real cost: slower throughput, larger PRs (because authors batch to avoid the gauntlet), and resentment. The discipline is to separate **blocking** ("this is wrong / unsafe / will rot the design") from **non-blocking** ("here's a nicer way, take it or leave it"), and to let the non-blocking stuff not block.

---

## Technique

### Q: You say "read the tests first." Why, and what do you learn that the implementation doesn't tell you?

> **Testing:** A senior habit — using tests as the executable spec.

**A.** I read the tests first because they're the **executable specification of intent**: they tell me what the author *believes* the code should do, in concrete input/output terms, before I'm anchored by how they did it. Reading implementation-first, I tend to absorb the author's mental model and miss the gaps; reading tests-first, I form my *own* model of the contract and can then check the implementation against it. Specifically the tests tell me: the **happy path** the author cares about, the **edge cases they thought of** (and, by absence, the ones they *didn't* — null, empty, boundary, concurrent), and the **shape of the contract** (what's an input, what's an output, what's a side effect). Then I review the implementation asking "does this satisfy the contract the tests describe, and what does it do on the inputs the tests *forgot*?" The empty-list case with no test is the single most reliable place to find a bug, and tests-first is how you spot the absence.

### Q: When is the diff *not enough*, and what do you do instead?

> **Testing:** Whether you know the unified diff has blind spots and when to leave it.

**A.** The diff is a fine default but it's a *local, additive* view, and it lies or hides in several cases:

- **Behavioral change with no diff.** Someone bumps a dependency version, changes a config default, or edits a file that *generates* code — the line diff is tiny or empty but the behavior moves. The diff can't show you this; you have to know the change's *blast radius*, not just its lines.
- **Action-at-a-distance.** The diff adds a caller but the bug is in the callee three files away that the diff doesn't touch — you can't see the precondition it violates without the surrounding code.
- **Large moves / renames.** A function moved across files shows as a giant red block and a giant green block; the diff tool may not pair them, so you can't see *what actually changed inside* without `--color-moved` or pulling the branch.
- **"It builds" isn't visible.** The diff doesn't tell you it compiles, that the tests pass, or how it behaves at runtime.

When the diff isn't enough, I **pull the branch and read it in context in my editor** (jump to definitions, see the whole function, not the hunk), **run it / run the tests** for anything I can't reason about statically, and use `git log -p`, `git blame`, and "open the file at this revision" to see what the diff omits. The rule: *the diff shows what lines changed; my job is to understand what behavior changed*, and those aren't the same thing.

### Q: Walk me through detecting a behavioral change when the diff looks completely innocent.

> **Testing:** The concrete skill behind "the diff isn't the change" — a common staff-level scenario.

**A.** First I ask *why I'm suspicious*, because that points at where to look. Common innocent-diff-but-behavior-moved cases and how I check each:

1. **Dependency / version bump.** A one-line change to a lockfile or `go.mod`. I check the dependency's changelog between versions, and I look for transitive behavior changes (a default that flipped, a bug that was "relied upon"). If it's load-bearing, I pull the branch and run the affected tests.
2. **Config or default change.** `timeout: 30` → `timeout: 60`, or a feature flag default. The diff is trivial; the runtime behavior isn't. I trace where the value is *read*, not just where it's set.
3. **Generated code / codegen input.** The diff edits a `.proto` or a template; the real change is in generated output not in the PR. I regenerate locally and diff the *output*.
4. **Removed/relaxed validation or a changed condition.** `>=` became `>`, or an early-return was deleted. These are *tiny* diffs with large semantic reach. I read the surrounding logic in context, not the hunk.

The decisive move when static reasoning runs out: **check out the branch and exercise it** — run the existing tests, write a quick scratch test for the case I'm worried about, or run the binary against the boundary input. If behavior changed and there's no test capturing it, that absence *is* my review comment: "this changes behavior X; please add a test that pins it so we don't regress." The discipline is to never let "the diff looked fine" be the end of the investigation when I have reason to suspect movement.

### Q: Do you review commit-by-commit or squashed-as-one? When does each help?

> **Testing:** Whether you use commit structure as a reviewing tool, not just a merge artifact.

**A.** It depends on whether the *history was curated for the reviewer*. If the author structured the branch as a sequence of coherent, atomic commits ("extract helper," then "use helper in caller," then "add the new behavior"), I review **commit-by-commit** — each commit is a small, reviewable story, and the refactor-then-change split lets me verify the refactor is behavior-preserving *separately* from the new logic. That's far easier than reviewing a single squashed diff where a pure rename and a real behavior change are tangled in the same hunk. If the history is messy ("wip," "fix," "fix again," "address comments"), commit-by-commit is noise and I review the **squashed** end-state. A practical ask in review is "can you split the mechanical refactor into its own commit/PR?" — separating behavior-preserving moves from behavior-changing ones is one of the highest-leverage things an author can do for a reviewer. So: commit-by-commit when commits were authored *for* the reader; squashed when they're just a save-history.

### Q: How do you label severity on comments, and why does that matter?

> **Testing:** Whether you make blocking-ness explicit — a top differentiator for review *throughput* and tone.

**A.** I prefix comments with their **severity and bindingness** so the author never has to guess what blocks merge:

- **`blocking:`** — must change before I approve (a bug, a security hole, a design decision that will rot). Rare and specific.
- **`suggestion:`** — I think this is better; your call, won't block.
- **`nit:`** — trivial, take it or leave it (and ideally automated away so I'm not typing it at all).
- **`question:`** — I don't understand this yet; explain and I may have no objection.
- **`praise:`** — genuinely good, worth calling out (cheap, and it balances the relationship).

This matters for two reasons. First, **clarity of intent**: an unlabeled comment reads as implicitly blocking, so a reviewer who scatters ten stylistic musings has accidentally blocked a PR over taste. Explicit labels let "here's a thought" *not* hold up a correct change. Second, **tone and trust**: marking nits as nits, and adding the occasional `praise:`, signals that I'm collaborating, not gatekeeping — which makes the `blocking:` comment, when it comes, land as the serious thing it is instead of more noise. Some teams formalize this (Conventional Comments); the format matters less than that *bindingness is never ambiguous*.

---

## The Data

### Q: Is there actual evidence behind "keep PRs small" and a particular review order, or is it folklore?

> **Testing:** The differentiator question. Can you ground the practice in inspection-rate research, not vibes?

**A.** It's evidence, and it's old and consistent. The foundational work is the **SmartBear / Cisco study** (Jason Cohen, *Best Kept Secrets of Peer Code Review*), a large observational study of real reviews, which found two numbers that should drive how you review:

- **Defect detection collapses past ~400 lines of code in a single review.** Below that, reviewers find a healthy share of the defects; above it, the find-rate per line falls off a cliff — not because the code is better, but because the reviewer's attention is saturated and they start skimming.
- **It collapses past ~60 minutes of sustained reviewing.** Effectiveness drops sharply after about an hour; performance degrades much like any other attention-intensive task.

There's a related finding on **inspection rate**: reviewers who go *faster* than roughly 300–500 LOC/hour find dramatically more defects than those racing through thousands of lines per hour — slowing down within a small change pays off; speeding through a large one doesn't. The classic inspection literature (Fagan inspections, the 1970s–80s data) reaches compatible conclusions about review pacing.

So the practice isn't folklore: **human defect-detection has a hard ceiling in both size and time**, and the implications are direct.

### Q: Given that data, what does it actually imply for how I size PRs and order my review?

> **Testing:** Whether you can turn the numbers into operational rules — the point of knowing them.

**A.** Four concrete implications:

1. **Keep PRs under the ceiling.** Aim well below 400 LOC of *meaningful* change (generated code and lockfiles don't count); ~200 is a sweet spot many teams target. A small PR isn't a courtesy — it's the only size at which review *works*. A huge PR doesn't get more scrutiny; it gets a rubber stamp, because the reviewer hit saturation on page two.
2. **Spend the first, sharpest attention on the highest-cost checks.** The 60-minute curve means your attention is a *depleting budget*: front-load goal and correctness while you're fresh, because that's where the expensive defects hide. Don't burn the first ten alert minutes aligning import order.
3. **Time-box and split the review.** If a review will exceed ~60 minutes, do it in *separate sessions* rather than one marathon — or push back and ask the author to split the PR. One long sitting past the hour is mostly theater.
4. **Automate everything below the attention waterline.** Since attention is the bottleneck, every defect a machine can catch (style, lint, simple bugs, format) *must* be caught by a machine, so the human budget is spent only on what needs judgement.

The unifying idea: **the order of operations is a strategy for spending a budget that's small and decays** — front-load the costly-to-find defects, automate the cheap ones out of the human path, and keep the change small enough that the budget covers it.

### Q: Why does this data make "style last" not just a preference but close to mandatory?

> **Testing:** Connecting the attention-budget evidence back to the ordering.

**A.** Because the data says attention is *finite and decaying*, every minute spent on style is a minute *not* spent on correctness while you're still sharp — and style is the one category a machine catches perfectly. So given a depleting budget, the rational allocation is: machine handles everything deterministic (style, format, lint) *before* the human opens the PR; the human spends their scarce, front-loaded attention on goal and correctness, where there's no automated substitute. Putting style first wouldn't just be aesthetically backwards — it would *measurably* lower defect detection by burning the high-value early minutes on the lowest-value, already-automatable category. The evidence turns "style last" from etiquette into resource management.

---

## Judgement & Scale

### Q: A PR is well-written, well-tested, and clean — but it solves the problem the *wrong way*. What do you do, and when should that have been caught?

> **Testing:** The marquee scenario. Goal-first thinking, and moving design review upstream.

**A.** Two separate questions: what I do now, and what should have happened earlier.

**What I do now:** I do *not* approve, and I do *not* nitpick the (fine) implementation — polishing code that shouldn't exist is wasted effort for both of us. I write one clear, high-level comment that (a) names the problem with the *approach*, (b) explains the cost of the wrong approach concretely (it'll couple X to Y, it won't scale to case Z, it duplicates the thing in module W), and (c) — crucially — I take it **out of the PR thread**. A fundamental-approach disagreement is not a line comment; it's a synchronous conversation (a call, a whiteboard, a design doc). Re-litigating architecture in PR comments is slow, low-bandwidth, and tense. I'd say: "The code itself is clean, but I think the approach has a problem — can we talk for 15 minutes before you invest more?"

**When it should have been caught:** *Before the code was written.* This is the "wrong approach caught too late" failure, and it's a process smell, not an author failure. A reviewer discovering a fundamental design problem at PR time means **design review happened too far downstream** — the author has already spent days building the wrong thing, and now sunk cost makes the conversation harder. The fix is to **move design review upstream**: a short design doc, an RFC, or even a five-minute "here's how I'm going to approach this" Slack message *before* implementation, for any non-trivial change. The PR is the *worst* place to discover you're building the wrong thing — it's the last gate, with the most code already written and the most ego attached. The lesson I'd draw and act on: the bigger or more novel the change, the earlier the design conversation has to happen.

### Q: You have 15 minutes for a PR and can't do a full review. What do you look at?

> **Testing:** Triage under a hard time box — proving the order is a *priority* order, not a checklist.

**A.** The 15-minute review is exactly why the order is *ordered* — I do the same sequence, just stop when time's up, so I spend the box on the highest-value checks:

1. **Goal (2 min).** Read the description and the linked issue. Is this solving the right problem? If the approach is wrong, that's the whole review — I stop and raise it; nothing below matters.
2. **Tests (3 min).** Read the tests to learn the intended contract and spot missing edge cases. Fast way to understand the change *and* judge it.
3. **Correctness on the risky parts (7 min).** I don't read every line — I go straight to the **highest-risk surface**: the concurrency, the error handling, the boundary conditions, the security-sensitive bits (auth, input handling, SQL). The diff's *dangerous* parts, not its *biggest* parts.
4. **A scan for obvious design smells (2 min).** Anything that'll be expensive later — a leaked abstraction, a new dependency in the wrong direction.

What I explicitly **skip** under the box: naming nitpicks, style (the linter has it), and exhaustively reading low-risk plumbing. And I'm **honest in the review**: "I time-boxed this and focused on correctness and the concurrency path; I didn't deep-read the test fixtures." A partial review labeled as partial is useful; a partial review pretending to be complete is dangerous, because it carries an approval the depth doesn't justify. If the PR is too big to triage meaningfully even at the risky-parts level, the right move is to say so and ask for a split, not to fake-approve.

### Q: How do you keep your review *order* (and depth) from collapsing when you're under load — twenty PRs in the queue?

> **Testing:** Whether you can protect a good process from the pressure that destroys it.

**A.** Under load, the failure mode is predictable: the order collapses to "skim the diff, LGTM," and the queue gets rubber-stamped — which is worse than a slow queue, because it ships defects *with* a false signal of having been reviewed. I protect against it a few ways:

- **Defend PR size at the source.** The single biggest lever is upstream: small PRs keep each review inside the attention budget, so the queue is many *fast* reviews instead of a few impossible ones. I push hard on authors to split, because a 1,000-line PR under load *guarantees* a rubber stamp.
- **Triage the queue, don't drain it FIFO.** Not every PR needs the same depth — a config tweak or a docs fix gets a light pass; the auth-path change gets the full sequence. Match depth to risk instead of giving everything the same degraded skim.
- **Time-box and be explicit about partial reviews** (as above) rather than silently doing shallow full-reviews.
- **Make automation carry more.** The more the linter, type-checker, and CI catch, the less the human queue has to, so investing in tooling *is* queue management.
- **Say no / hand off.** If the queue genuinely can't be reviewed well, the honest move is to flag it ("I can't give this the review it needs today") and redistribute, not to pretend. A rubber-stamped approval is a lie about quality, and it's how review culture rots.

The meta-point: a good order is only valuable if it survives a bad day, and the way it survives is *small PRs + risk-based triage + automation*, not heroics.

### Q: How do you calibrate reviewers so two people don't review the same PR to wildly different bars?

> **Testing:** Staff-level — review as a *team consistency* problem, not an individual skill.

**A.** Inconsistent bars are corrosive: authors learn to wait for the lenient reviewer, the strict reviewer becomes a bottleneck and a villain, and "approved" stops meaning anything. I calibrate a few ways. **Write the bar down** — a short review guide stating what's blocking (correctness, security, design rot) versus advisory (style, taste), so "approve when it definitely improves the codebase, not when it's perfect" is a shared rule, not a personal mood. **Use severity labels** (`blocking`/`nit`) so even differing reviewers agree on *bindingness* even when taste differs. **Move style and format fully into tooling**, which removes the single biggest source of reviewer-to-reviewer variance — you can't disagree about whitespace if a formatter owns it. **Review the reviews occasionally** — in a retro or a pairing session, look at a few PRs together and discuss "would you have blocked this?" to surface where bars diverge. And **mentor explicitly** — pair a newer reviewer with an experienced one for a while so the bar transfers by apprenticeship, not osmosis. The goal is that "this passed review" carries the *same* meaning regardless of who held the pen.

### Q: You've called review a mentoring tool. Concretely, how does the *order* of review serve mentoring?

> **Testing:** Whether you see review as developing people, with attention on the author — not just filtering code.

**A.** Review is one of the highest-bandwidth mentoring channels a team has, because it's feedback on *real work the person cares about*, in context — and the order serves that directly. Leading with **goal and design** (not style) teaches the author the *expensive* lessons — how to think about approach, boundaries, and correctness — rather than training them to obsess over brace placement. Putting **style last and automated** signals what actually matters: I'm not going to make you better by correcting your commas. The mentoring stance also changes *how* I phrase the order's findings: I ask **questions** ("what happens here if the list is empty?") instead of issuing fixes, so the author reaches the answer and *learns the pattern*, rather than just patching the one line. And the attention is on the **author, not just the artifact** — a comment that explains *why* (with a link, a principle, a "here's the failure mode this prevents") develops the person; a comment that just says "wrong, do X" fixes the code and teaches nothing. The senior tell is calibrating the *teaching* to the author: a junior's PR gets the *why* spelled out and the nits suppressed; a staff peer's PR is a terse, high-trust exchange. Same order, different pedagogy.

---

## Scenarios

### Q: Walk me through, start to finish, how you review a 300-line PR.

> **Testing:** Whether the abstract order survives contact with a concrete, realistic change.

**A.** 300 lines is right at the workable ceiling, so I budget ~45 minutes and go in order:

1. **Goal (≈5 min).** Read the PR description and linked ticket *before* the code. What problem, why now, what approach? If there's no description, that's my first comment — I can't review intent I can't see. I form an expectation of *roughly* what the diff should contain.
2. **Orient on the change shape (≈3 min).** Skim the file list and the diff stat. Which files, how concentrated, does the shape match the stated goal? A "fix typo" PR touching fifteen files is a flag. I decide here whether the diff is enough or whether I need to pull the branch.
3. **Read the tests (≈7 min).** What contract do they assert? What edge cases are covered — and which obvious ones (empty, null, boundary, error, concurrent) are *missing*? I now have my own model of intended behavior and a list of cases to check the code against.
4. **Correctness (≈15 min).** Now the implementation, checked against the contract from the tests, with focus on the **risky surface first**: error paths, concurrency, boundaries, anything security-sensitive. I read functions *whole* (jumping to definitions in my editor if the diff hunk is too narrow), not just the changed lines.
5. **Design (≈8 min).** Does it fit the architecture? Right boundaries, right direction of dependency, no abstraction leak, no duplication of something that exists? Is this a place the codebase will be sorry about in a year?
6. **Readability (≈5 min).** Names that reveal intent, structure that's followable, comments only where the *why* is non-obvious.
7. **Style (≈0 min, human).** Already handled by the linter in CI; if I'm tempted to comment on format, I instead check why the linter didn't.

Then I **write up**, labeling severity (`blocking`/`suggestion`/`nit`/`question`), leading with anything blocking, including at least one genuine `praise:` if it's warranted, and being explicit if I time-boxed any section. I approve if it *definitely improves the codebase* and any blocking issues are resolved — not if it's perfect.

### Q: The diff "looks fine" but you have a hunch the behavior changed. Concretely, how do you check?

> **Testing:** Re-asking the behavioral-change skill as a hands-on procedure — do you actually leave the diff?

**A.** I treat the hunch as a hypothesis and go get ground truth instead of staring harder at the diff:

1. **Locate the suspected mover.** Is it a version bump, a config/default change, a changed condition (`>=`→`>`, a deleted early return), or a codegen input? Each has a known way to hide behavior behind a small diff.
2. **Read in context, not in the hunk.** Pull the branch and open the changed function whole in my editor — the diff's narrow window often hides the precondition or the surrounding branch that makes the small change significant.
3. **Trace the value/effect, not the line.** For a changed default or config, I find every place it's *read*; for a relaxed validation, I find what now gets through that didn't.
4. **Exercise it.** This is the decisive step — I **run the existing tests on the branch**, and if they don't cover my worry, I **write a quick scratch test for the exact boundary input** or run the binary against it. Static reasoning has limits; running it doesn't.
5. **Turn the gap into a comment.** If behavior did change and nothing pins it, that absence *is* the finding: "this changes behavior X (here's the case); please add a test so we don't silently regress." If it *didn't* change, I note what I checked so the next reviewer doesn't re-tread it.

The throughline: *the diff shows changed lines; I'm responsible for changed behavior*, and when those diverge, I leave the diff and either read in context or run the code. "The diff looked fine" is never where the investigation ends once I have a reason to suspect movement.

### Q: An author pushes back: "This is a nit, why is it blocking my PR?" How do you handle it?

> **Testing:** Whether your severity discipline holds under disagreement — and whether you'll concede.

**A.** First I check whether *they're right*, because often they are. If I labeled something `blocking` that's actually taste, the honest move is to **concede and downgrade it** — "fair, that's a suggestion, not a blocker; merging's fine." Holding a correct change hostage to my preference is exactly the perfectionism the bar warns against. If it *is* genuinely blocking and I mislabeled or under-explained it, I fix that: "sorry, that was unclear — this isn't style, it's a correctness issue: on an empty input this path NPEs, here's the case." The disagreement usually means *bindingness was ambiguous*, which is my failure to label and explain, not the author being difficult. And if we still disagree on something genuinely in the gray zone, I don't dig in over taste — I either defer to the author (their code, their call, within the bar) or, if it's a real design concern, take it off the thread into a conversation. The principle: **be firm on correctness, flexible on taste, and never let an unlabeled preference masquerade as a blocker.**

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: The one-line order of operations?** A: goal → correctness → design → tests → readability → style.
- **Q: Why goal first?** A: If the change solves the wrong problem, every other comment is wasted effort.
- **Q: Why style last?** A: It's deterministic, a machine does it perfectly, and human attention is too scarce to spend on it.
- **Q: At what size does defect detection collapse?** A: Past ~400 LOC in one review (SmartBear/Cisco data).
- **Q: At what time does it collapse?** A: Past ~60 minutes of sustained reviewing.
- **Q: Ideal PR size to aim for?** A: Well under 400 LOC of meaningful change; ~200 is a common target.
- **Q: Why read the tests first?** A: They're the executable spec of intent — and the missing test reveals the unhandled case.
- **Q: When isn't the diff enough?** A: Version bumps, config/default changes, codegen, and big moves — behavior changes with little or no line diff.
- **Q: First move when the diff isn't enough?** A: Pull the branch, read it in context, and run it / the tests.
- **Q: Commit-by-commit or squashed?** A: Commit-by-commit if the history was curated for the reader; squashed if it's just save-history.
- **Q: What are severity labels for?** A: To make bindingness unambiguous so non-blocking comments don't block.
- **Q: `blocking` vs `nit`?** A: Must-change-before-approve vs trivial-take-it-or-leave-it (ideally automated away).
- **Q: Approve at "perfect" or at what bar?** A: When it *definitely improves* the codebase and blocking issues are resolved — not perfect.
- **Q: Where should a "wrong approach" be caught?** A: Before code is written — in a design doc/RFC, not at PR time.
- **Q: 15-minute review — what gets cut?** A: Style, naming nits, and low-risk plumbing; goal + tests + risky-correctness stay.
- **Q: What does a rubber-stamp approval cost?** A: It ships defects *with* a false signal of having been reviewed — worse than a slow queue.
- **Q: Is review a quality *gate*?** A: One layer among types/tests/CI — not the only one, and not a place to chase perfection.
- **Q: Review as mentoring — the key move?** A: Ask questions and explain the *why*; attention on the author, not just the artifact.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**

- Starting the review at the first red squiggle / top of file, with no goal-first step.
- Leading with style and naming; treating whitespace and the race condition as equal-weight comments.
- Never having heard of the ~400-LOC / ~60-min defect-detection ceiling, or dismissing PR-size limits as "process bureaucracy."
- "It builds and the diff looks fine, LGTM" — believing the diff *is* the change.
- Treating review as a gate to perfection, or as a place to prove seniority.
- Approving large PRs at full depth with a straight face (it's a rubber stamp and they don't know it).
- Discovering "wrong approach" at PR time with no notion that design review should be upstream.
- Unlabeled comments — no concept of blocking vs non-blocking — and refusing to concede taste.

**Green flags:**

- Naming the order (goal → correctness → design → tests → readability → style) *and* deriving it from cost-to-find-late.
- Citing the inspection-rate data (SmartBear, ~400 LOC / ~60 min) unprompted to justify small PRs and front-loaded attention.
- Reading tests first and treating the *missing* test as a finding.
- Leaving the diff — pulling and running the branch — the moment static reasoning runs out.
- Taking fundamental-approach disagreements *off* the PR thread into a conversation, and saying it should've been caught upstream.
- Using severity labels, and conceding taste (`nit`→non-blocking) while staying firm on correctness.
- Framing review as mentoring with attention on the author, and calibrating depth to the change's risk and the author's level.
- Being explicit about a time-boxed/partial review instead of letting an approval over-claim its depth.

---

## Cheat Sheet

| Phase | What you're checking | Why this slot | If skipping for time |
| --- | --- | --- | --- |
| **Goal** | Right problem? Right approach? | Wrong goal voids everything below — cheapest to catch, costliest to miss | Never skip |
| **Correctness** | Edge cases, errors, concurrency, security | Most expensive defect class to find post-merge | Keep; focus on risky surface |
| **Design** | Fit, boundaries, coupling, duplication | Cheap to fix now, brutal once it has callers | Quick smell-scan only |
| **Tests** | Do they pin behavior? What's *missing*? | The executable spec; missing test = likely bug | Skim for the contract |
| **Readability** | Intent-revealing names, structure | Real but lower-stakes, human judgement | First to trim |
| **Style** | Format, imports, braces | Deterministic — a machine's job | Always skip (linter owns it) |

| The numbers (SmartBear/Cisco) | Value | Implication |
| --- | --- | --- |
| Defect-detection size ceiling | ~400 LOC / review | Keep PRs well under it; aim ~200 |
| Sustained-attention ceiling | ~60 min | Time-box; split long reviews into sessions |
| Effective inspection rate | ~300–500 LOC/hr | Slower-on-small beats faster-on-huge |

**Severity labels:** `blocking:` (must change) · `suggestion:` (better, your call) · `nit:` (trivial, automate it) · `question:` (clarify) · `praise:` (call out the good).

**When the diff isn't enough:** version bump · config/default change · codegen input · large move/rename · relaxed condition → **pull the branch, read in context, run the tests.**

---

## Summary

- **Code review is for** defects, design, maintainability, knowledge-sharing, and shared ownership — and **not for** style policing, gatekeeping, or rewriting the change to your taste. The order of operations exists to keep that priority straight.
- **The order is goal → correctness → design → tests → readability → style**, derived from a single principle: **review in descending order of how expensive each problem is to discover after merge.** Goal-wrongness is catastrophic-and-cheap-to-catch-now; style is trivial-and-already-automatable.
- **Technique:** read the *tests first* (executable spec; the missing test is a finding); know that *the diff isn't the change* (version bumps, configs, codegen, moves change behavior with little diff) and leave the diff to read-in-context and *run the branch*; review commit-by-commit when history was curated for you; label severity so bindingness is never ambiguous.
- **The data (the differentiator):** defect detection collapses past **~400 LOC** and **~60 minutes** (SmartBear/Cisco). That turns "small PRs," "front-load correctness," and "style last and automated" from etiquette into *resource management of a small, decaying attention budget*.
- **Judgement & scale:** a well-written PR that solves the *wrong problem* should be stopped now and caught *upstream* next time (design review at PR time is too late); protect the order under load with small PRs + risk-based triage + automation, not heroics; calibrate reviewers so "approved" means the same thing; and use review's order as a *mentoring* channel with attention on the author.
- **Approve when the change *definitely improves* the codebase and blocking issues are resolved — not when it's perfect.**

---

## Further Reading

- **Google's "Code Review Developer Guide"** (the `eng-practices` site) — the canonical modern treatment of what to look for, the "approve when it improves the codebase, not when it's perfect" standard, and how to write review comments.
- ***Software Engineering at Google*, Chapter 9, "Code Review"** — the rationale behind small CLs, review latency, and review as a knowledge-sharing and consistency mechanism at scale.
- **Jason Cohen, *Best Kept Secrets of Peer Code Review* (SmartBear/Cisco study)** — the source of the ~400-LOC and ~60-minute defect-detection findings the data section rests on.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — the same order, taught from the ground up and then at scale; every answer here is grounded in those.

---

## Related Topics

- [02 — PR Scope & Size](../02-pr-scope-and-size/interview.md) — the inspection-rate data's direct consequence: how small a change has to be for review to work.
- [03 — Correctness & Design Review](../03-correctness-and-design-review/interview.md) — going deep on the two highest-cost phases of the order.
- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/interview.md) — severity labels, tone, and the mentoring stance, in depth.
- [Static Analysis & Linting](../../static-analysis/) — the tooling that owns "style last" so the human never types a format comment.
- [Testing](../../testing/) — what "read the tests first" assumes the tests are worth: pinning behavior, not implementation.
