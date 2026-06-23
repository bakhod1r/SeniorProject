# The Legacy Change Algorithm — Senior Level

## Table of Contents

- [The algorithm is a default, not a law](#the-algorithm-is-a-default-not-a-law)
- [Judgment under uncertainty: what you are actually optimizing](#judgment-under-uncertainty-what-you-are-actually-optimizing)
- [Reading the five steps as a risk-management protocol](#reading-the-five-steps-as-a-risk-management-protocol)
- [When to deviate from the strict order](#when-to-deviate-from-the-strict-order)
- [The interplay between steps: where the real work hides](#the-interplay-between-steps-where-the-real-work-hides)
- [Sprout and Wrap as risk-routing decisions, not fallbacks](#sprout-and-wrap-as-risk-routing-decisions-not-fallbacks)
- [Scaling to large, unfamiliar codebases](#scaling-to-large-unfamiliar-codebases)
- [The "no time for tests" argument, answered with numbers](#the-no-time-for-tests-argument-answered-with-numbers)
- [Heuristics a senior carries into every legacy change](#heuristics-a-senior-carries-into-every-legacy-change)
- [Related Topics](#related-topics)

---

## The algorithm is a default, not a law

By the middle level you can run all five steps mechanically on a tangled method: identify the change point, find a sensing point, break the dependencies that block separation, pin the current behavior, change it, refactor. That competence is the price of entry. What distinguishes senior work is knowing *which steps to compress, which to expand, which to skip, and which to reorder* — and being able to defend each of those decisions in terms of risk and cost, not habit.

Feathers' algorithm is the **safe default**: run it verbatim and you will almost never ship a regression you couldn't have caught. But "safe by default" is not the same as "optimal." A method that is already a pure function of its inputs needs no dependency-breaking. A change deep inside a system you've never seen may need *more* characterization than the algorithm's minimal prescription, because your model of "what the code does" is wrong and you don't yet know it. The senior skill is calibrating the safety net to the actual uncertainty, not applying a fixed amount of ceremony to every task.

> **Key idea:** The algorithm gives you a *floor* of safety. Senior judgment is about how far above that floor to build, and where — based on the consequences of being wrong, not on a ritual.

## Judgment under uncertainty: what you are actually optimizing

Every legacy change is a decision under uncertainty with three quantities in tension:

| Quantity | What raises it | What the algorithm does about it |
| --- | --- | --- |
| **Probability of regression** | Tangled code, no tests, your weak mental model | Steps 2–4 drive it down before step 5 |
| **Cost of a regression** | Money path, data corruption, silent failures, blast radius | Tells you how much net to build |
| **Cost of building the net** | Dependencies are brutal; the seam is expensive | Sprout/Wrap let you route around it |

The naive reading of the algorithm treats only the first quantity. The senior reading multiplies all three. You spend net-building effort in proportion to `P(regression) × cost(regression)`, capped by `cost(net)`. Concretely:

- A typo-fix in a logging string that already has no behavioral effect: `cost(regression)` is near zero. Running the full algorithm is waste. Make the change, eyeball it, ship.
- A one-line change to how interest is compounded in a financial ledger: `cost(regression)` is catastrophic and partly *silent* (wrong money for months before anyone notices). Here you build *more* net than the algorithm's minimum — you characterize neighbors, you add golden-master tests over historical inputs, you get a second reviewer who knows the domain.
- A change in a subsystem you've never touched: `P(regression)` is high *and unknown*, because your mental model is unverified. The correct first move is often to write characterization tests *as exploration* — not because the algorithm says step 4, but because pinning behavior is how you discover what the code actually does before you commit to a change point.

That last case inverts the usual order, and it's worth dwelling on. The junior file presents characterization tests as a safety net. At senior level they are also a **probe**. The fastest way to understand an opaque method is frequently to wrap it in a test harness and start poking it with inputs, reading the outputs the failing assertions print back. You learn the branches by characterizing them.

> **Key idea:** Characterization tests are dual-purpose: a safety net *and* a microscope. On unfamiliar code, lead with them to build the mental model the algorithm assumes you already have.

## Reading the five steps as a risk-management protocol

Strip the steps down to their risk function and the structure becomes clear:

```
Step 1 Identify  → bound the blast radius (commit to the smallest change surface)
Step 2 Find      → establish observability (can I detect failure at all?)
Step 3 Break     → establish reachability (can I exercise it in isolation?)
Step 4 Write     → freeze the baseline (what is true *now*?)
Step 5 Make      → change one thing, watching the instruments
```

Steps 2 and 3 are the two halves of testability: **sensing** (observe) and **separation** (reach). The middle file names them; the senior insight is that *these two are independent axes and a given piece of code can be easy on one and hard on the other.* A method that returns its result is trivially sensable but may be impossible to reach (its constructor opens a socket). A method buried behind a clean interface is trivially reachable but its only effect is a private mutation you can't sense. Diagnosing *which axis is blocking you* tells you which technique to reach for — and stops you from, say, extracting an interface (a separation fix) when your real problem is sensing.

```
                 SENSING (can I observe the effect?)
                   easy                       hard
              ┌────────────────────┬────────────────────┐
   SEPARATION │ ideal: just call & │ add a sensing       │
   easy       │ assert             │ method / subclass   │
   (reachable)├────────────────────┼────────────────────┤
   hard       │ break the ctor/    │ the genuine swamp:  │
   (blocked)  │ static dep, then   │ fix separation AND  │
              │ assert return      │ add sensing         │
              └────────────────────┴────────────────────┘
```

## When to deviate from the strict order

The algorithm's order is correct *as a default* because each step makes the next cheaper and safer. Deviations are legitimate, but each one trades away a specific protection, and you should know which.

**Reorder 1↔4 on unfamiliar code (characterize to explore).** As above. You pin behavior *before* you're confident where the change point is, using the tests to map the terrain. Cost: you may characterize code you end up not touching. That's usually a fine trade — the tests stay as permanent coverage.

**Collapse 2 and 3 when the seam is already there.** If the change point is a pure function, sensing and separation are both free; recognize it and move straight to step 4. The danger isn't doing this — it's doing it by *assumption*. Verify the purity (does it really touch no statics, no clock, no I/O?) before you skip.

**Skip 4 for genuinely trivial, observable changes.** Renaming a local variable, fixing a comment, reordering two independent statements — there is no behavior to characterize. Skipping is correct. The trap is *scope creep*: "while I'm here" turns a trivial change into a behavioral one, and now you skipped the net for the wrong category of change.

**Insert a step 0 — verify the requirement — on high-stakes changes.** The algorithm assumes you know what "the change" is. On a money or safety path, the most expensive bug is implementing the wrong behavior *correctly* and shipping it with green tests. A senior adds a confirmation loop with the requestor before step 1.

| Deviation | What you gain | What you give up | Safe when |
| --- | --- | --- | --- |
| Characterize before identifying | A real mental model | Some throwaway tests | Code is unfamiliar/opaque |
| Skip break (deps already cut) | Speed | A safety check | You *verified* purity |
| Skip characterize | Speed | Regression detection | Change is non-behavioral |
| Add requirement-verification | Catch wrong-spec bugs | A little latency | Stakes are high |

> **Key idea:** Every deviation removes a specific guarantee. Deviating is a senior move *only* when you can name the guarantee you're dropping and have decided its absence is acceptable here.

## The interplay between steps: where the real work hides

Juniors see five discrete steps. Seniors see a system with feedback loops, where a decision in one step silently sets the cost of another.

**Identify (1) sets the cost of Break (3).** Where you draw the change-point boundary determines which dependencies fall *inside* it and must be broken. Draw the boundary one method too wide and you've inherited a database call you now have to seam. The discipline of *minimal* change points (middle file) is really a discipline of *minimal dependency-breaking*. Before you finalize a change point, ask: what dependencies does this boundary force me to cut? Sometimes nudging the boundary by one method turns a brutal break into a free one.

**Find (2) and Break (3) negotiate.** The interception point you choose in step 2 changes what you must separate in step 3. Test far out at a pinch point and you avoid breaking inner dependencies — but you drag in *more* dependencies at the outer boundary. Test close to the change and the inner deps must be cut but the outer ones disappear. This is a genuine optimization, not a fixed recipe: pick the test point whose *total* dependency-breaking cost is lowest while still sensing what you need.

**Break (3) is itself an untested change.** Every dependency you cut is an edit to legacy code with no net under *it*. This is the recursion at the heart of legacy work, and the reason Feathers insists on mechanical, IDE-verified moves (*Extract Interface*, *Parameterize Constructor*) for this step specifically — they're provably behavior-preserving, so you don't need a net to make them safely. Hand-edited dependency breaks are where seniors get bitten. If your IDE can't do the move automatically (see [refactoring](../../refactoring/)), slow down and treat the break as its own risky change.

**Make (5) feeds back into Identify (1).** Halfway through the change you often discover a ripple point the initial identification missed — a caller that interprets the value you just changed. The loop reopens: that caller is now a change point, needs its own test point, possibly its own break. Seniors expect this and don't treat it as failure; the algorithm is iterative, and re-entering step 1 mid-change is normal.

```
   1 Identify ──▶ 2 Find ──▶ 3 Break ──▶ 4 Write ──▶ 5 Make
       ▲                        │                       │
       │   wider boundary →     │   more deps to break  │
       └────────────── ripple point discovered ─────────┘
```

## Sprout and Wrap as risk-routing decisions, not fallbacks

The middle file frames Sprout and Wrap as tactical retreats for when dependency-breaking is too expensive *right now*. At senior level they are better understood as **the default for additive change**, and full dependency-breaking as the thing you do when you must alter behavior *inside* the legacy code.

The decision pivots on one question: **does the new behavior need to live inside the old control flow, or can it sit beside it?**

- New behavior that is *additive* (an audit log, a discount applied to the final total, a feature flag check) can almost always be sprouted into a clean, test-first unit and called from one line. You add tested code and one untested call. This is often *safer* than breaking dependencies, because you've touched the legacy method exactly once and never altered its existing branches.
- New behavior that *modifies an existing computation* (the price formula itself must now branch on tier, a validation rule must change) cannot be sprouted cleanly — it lives inside the tangle. Here you pay for separation and sensing because there's no way around the old code.

```
Does the change ADD behavior beside the old, or ALTER behavior within it?

   ADD beside ──────────────▶ Sprout / Wrap (new tested unit, 1 call-site)
   ALTER within ────────────▶ full algorithm (break deps, characterize, change)
```

The senior anti-pattern here is breaking dependencies *unnecessarily* — taming a thousand-line method to inject a collaborator when the new behavior could have been sprouted in an afternoon. Dependency-breaking is high-value but high-cost; spend it where the change genuinely lives inside the legacy logic. Conversely, the *over*-use of Sprout is its own debt: a method with twenty sprouted call-outs is a method nobody dared to actually test. Sprout buys time; it does not retire the debt, and a senior tracks the running balance (see [07-the-economics-of-tidying](../07-the-economics-of-tidying/)).

> **Key idea:** Sprout/Wrap vs. full dependency-breaking is decided by *where the new behavior lives* — beside the old code or inside it — not by how rushed you feel.

## Scaling to large, unfamiliar codebases

The worked examples are single methods. Real senior legacy work is a 2-million-line system you joined last month, where the five steps run into problems the small examples never surface.

**Identification at scale is a search problem.** You can't read the system. You find change points by *triangulation*: grep for the domain term, trace one real request with a debugger or distributed trace, read the data flow, and confirm with whoever's left who knows the area. The "follow the data" tactic from the middle file becomes a literal tracing exercise across service or module boundaries. Budget real time for it — on a large unfamiliar system, *finding* the change point is often the largest part of the task.

**Sensing may cross process boundaries.** In a monolith, the test point is a return value. In a distributed legacy system the effect may be a message on a queue, a row in another service's database, a downstream call. Your interception point might have to be a *contract test* or a characterization test at an HTTP boundary rather than a unit test. The principle is unchanged — find the nearest place you can observe the effect — but "nearest" can be a network hop away.

**The dependency you must break may be architectural.** Cutting a `DriverManager.getConnection` is a code move. Cutting a dependency on a shared global config object that 400 classes read from statically is an *architectural* break that you cannot land in one PR. Seniors recognize when a dependency-break exceeds the change's budget and choose Sprout/Wrap to avoid it, deferring the architectural fix to a deliberate, separately-funded effort.

**Characterization becomes golden-mastering.** When you can't reason about a subsystem's output at all, you capture its behavior in bulk: feed it a large corpus of recorded real inputs, snapshot every output, and treat the snapshot as the baseline. Any change that perturbs an output you didn't intend to change shows up as a diff against the golden master. This scales the "let the failure print the truth" trick from one assertion to thousands. (Mechanics live in [04-characterization-tests](../04-characterization-tests/).)

| Small example | Large unfamiliar system |
| --- | --- |
| Read the method, see the change point | Trace a request; grep; ask; confirm |
| Assert on a return value | Intercept a queue message / DB row / HTTP response |
| Inject a fake repo | Maybe can't — Sprout to avoid an architectural break |
| Three characterization tests | Golden master over a recorded input corpus |
| Done in an hour | Identification alone may take a day |

## The "no time for tests" argument, answered with numbers

Someone — sometimes you, under deadline — will say: *"We don't have time to write tests. Just make the change."* This is the most important conversation in legacy work, and seniors answer it with economics rather than principle.

The argument assumes tests are a tax that slows down *this* change. The data Feathers and the broader testing literature point to says the opposite over any horizon longer than the current afternoon:

- **The cost of a defect rises by roughly an order of magnitude per phase it survives** — caught in your editor it's free; caught in code review it's minutes; caught in QA it's hours and a context-switch; caught in production it's an incident, a hotfix, a postmortem, and reputational cost. "No time for tests" optimizes the cheapest phase by inflating the most expensive one.
- **Untested legacy changes are slow precisely because there's no test.** The reason the method is scary and the change is taking all afternoon is the *absence* of the net. "No time for tests" is "no time to stop being slow."
- **The net is an asset, not a cost.** The test you write today catches the *next* person's regression too. Its cost is paid once; its value accrues every time anyone touches that code again.

The honest senior position is *not* "always write the tests." It's: **make the time/risk trade explicit and let the right person own it.** Phrase it as a decision, not a refusal:

> "I can ship this untested in 30 minutes, but it's on the payment path and I can't tell you it's safe — if it's wrong, it's wrong money and silent. Or I can get a characterization net in place in two hours and ship it knowing it's safe. Which risk do you want to own?"

That sentence does three things: it surfaces the real cost (silent wrong money), it quantifies both options, and it puts the risk acceptance where it belongs — with whoever has the authority to accept it. Nine times out of ten, naming the consequence converts "no time for tests" into "take the two hours." The tenth time, it's a genuine emergency (the site is down), the right call really is the fast path, and you've documented that it was a conscious, owned decision — with a follow-up ticket to add the net once the fire is out.

> **Key idea:** "No time for tests" is not a technical claim to argue with — it's a risk-acceptance decision to surface, quantify, and assign to its owner. Make the trade visible; don't win or lose it silently.

## Heuristics a senior carries into every legacy change

- **Size the net to `P(regression) × cost(regression)`, capped by `cost(net)`.** Not every change earns the full ceremony; some earn *more* than the minimum.
- **On unfamiliar code, characterize first to learn.** Tests are a microscope before they're a net.
- **Diagnose sensing vs. separation before choosing a technique.** They're independent; fixing the wrong one wastes effort.
- **Nudge the change-point boundary to minimize dependency-breaking.** Identification sets Break's cost.
- **Prefer Sprout/Wrap for additive change; pay for dependency-breaking only when behavior changes *inside* the legacy code.**
- **Treat each dependency-break as an untested change** — use mechanical, IDE-verified moves so it needs no net of its own.
- **Keep structural and behavioral changes in separate commits** ([06-tidy-first](../06-tidy-first-when-and-how/)) so failures attribute cleanly.
- **Convert "no time for tests" into an owned, quantified risk decision** — never let it pass as an unexamined default.
- **Track the debt you defer.** Sprout, Wrap, and skipped nets are loans; record the balance ([07-the-economics-of-tidying](../07-the-economics-of-tidying/)).

## Related Topics

- [01-what-is-legacy-code](../01-what-is-legacy-code/) — the definition (code without tests) that motivates the whole algorithm.
- [03-seams-and-enabling-points](../03-seams-and-enabling-points/) — the conceptual model behind step 3; where behavior can be altered without editing in place.
- [04-characterization-tests](../04-characterization-tests/) — the mechanics of step 4, including golden-master techniques for scale.
- [05-dependency-breaking-techniques](../05-dependency-breaking-techniques/) — the catalog of moves for step 3.
- [06-tidy-first-when-and-how](../06-tidy-first-when-and-how/) — separating structural from behavioral change in step 5.
- [07-the-economics-of-tidying](../07-the-economics-of-tidying/) — the cost/value framing behind net-sizing and deferred-debt tracking.
- [../../refactoring/](../../refactoring/) — the behavior-preserving moves that make dependency-breaking safe.
- [../../design-principles/](../../design-principles/) — why testable design (dependency inversion, small units) reduces the cost of every future legacy change.
