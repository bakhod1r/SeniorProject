# Coverage as Signal, Not Target — Interview Questions

> **Roadmap:** [Code Coverage](../README.md) → Coverage as Signal, Not Target
> *This interview rarely opens with "what is code coverage." It opens with "an exec wants 90% across the org — what do you tell them?" and then watches whether you can name Goodhart's law, predict exactly how the number gets gamed, and propose something that actually moves quality. The whole topic is one idea wearing seven costumes: a coverage **number is a diagnostic, and the moment you make it a target you destroy the diagnostic.** This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Goodhart's Law Applied](#theme-1--goodharts-law-applied)
3. [Theme 2 — How Coverage Targets Get Gamed](#theme-2--how-coverage-targets-get-gamed)
4. [Theme 3 — Signal vs Target, Diagnostic vs Control](#theme-3--signal-vs-target-diagnostic-vs-control)
5. [Theme 4 — Policy Design](#theme-4--policy-design)
6. [Theme 5 — The Research and the Authority](#theme-5--the-research-and-the-authority)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — When a Number IS Appropriate](#theme-7--when-a-number-is-appropriate)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **measure vs target** (a number you read vs a number you reward)
- **diagnostic vs control** (using the number to *find* gaps vs using it to *drive* behavior)
- **executed vs verified** (a line ran vs an assertion checked its result)
- **floor on new code vs target on all code** (patch coverage vs a global percentage)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who can say *out loud* why the same number is healthy as a diagnostic and toxic as a target — and who reach for **mutation testing and patch-coverage gates** instead of a global percentage when asked "so what do we do instead?"

A note on tone: this is a topic where strong opinions are correct, but dogma is a red flag. The best answer to almost every question here ends with a caveat — *"…except in a regulated context, where the number genuinely is part of the contract."* Hold the line on "no global target," and know exactly where the line bends.

---

## Theme 1 — Goodhart's Law Applied

### Q1.1 — State Goodhart's law and apply it to code coverage in one breath.

> **Testing:** Do you actually know the principle, or just the slogan?

**A.** Goodhart's law: *"When a measure becomes a target, it ceases to be a good measure."* Applied to coverage: coverage percentage is a useful *measure* of how much of your code your tests execute — it correlates, loosely, with testedness. The instant you make "hit 90%" a target people are rewarded or punished against, engineers optimize the *number*, not the *testedness it was standing in for*. They write tests that execute lines without asserting anything, exclude hard files with pragmas, and pad with trivial tests. Coverage goes up; the thing it was measuring — confidence that defects are caught — does not. The measure is destroyed precisely by the act of targeting it.

### Q1.2 — What is *surrogation*, and why is it the deeper failure here?

> **Testing:** Whether you know the cognitive mechanism, not just the economic one.

**A.** Surrogation is the cognitive trap where people **mentally replace the goal with its metric** — they stop caring about the real objective and start caring about the proxy *as if it were the objective*. Goodhart describes what happens to the metric under pressure; surrogation describes what happens to people's *minds*. With coverage, the real goal is "tests that catch defects." The metric is "% of lines executed." Under surrogation, the team forgets the goal entirely and a green 95% *becomes* the definition of "well-tested" in everyone's head. That's worse than gaming, because gaming is at least conscious — surrogation is the whole org sincerely believing it's safe because the dashboard is green. The defense is to keep the *goal* visible and the metric explicitly subordinate: "coverage is one signal toward catching defects," never "our quality bar is 90%."

### Q1.3 — "But correlation exists — higher-coverage code does have fewer escaped defects in some studies. Doesn't that justify a target?"

> **Testing:** The single most common rationalization, and whether you can separate correlation from causal leverage.

**A.** Correlation in the *observational* direction doesn't survive being turned into a *control* lever. Two reasons. First, the correlation is confounded: teams that happen to test thoroughly also tend to review carefully, design for testability, and own their code — coverage is a *symptom* of a healthy culture, not its cause, so mandating the symptom doesn't import the cause. Second, and decisively, the correlation is measured in a world where nobody was *gaming the metric*. The moment you make it a target you change the data-generating process — you create the incentive to inflate coverage without testedness, which is exactly the regime where the correlation breaks. So "X correlates with Y" is true and "therefore mandate X" is a non sequitur: you'd be mandating the part (lines executed) that's cheapest to fake and weakest in the causal chain.

### Q1.4 — Give the cleanest one-sentence version of why a coverage *target* specifically corrupts.

> **Testing:** Can you compress it without losing the mechanism?

**A.** A coverage target rewards *executing* code, but quality comes from *verifying* code — so the cheapest way to hit the target (run lines without asserting on them) moves the number in the exact opposite direction from the goal, and you've paid people to make the codebase look safer while making it no safer.

---

## Theme 2 — How Coverage Targets Get Gamed

### Q2.1 — A team's coverage jumped from 70% to 92% in a sprint. Name the four ways they probably did it, and how you'd detect each.

> **Testing:** Whether you've actually seen gamed coverage, and whether you can *catch* it, not just deplore it.

**A.** Four classic moves:

1. **Assertion-free tests** — call the code, assert nothing (or only that it didn't throw). Coverage counts the lines as executed; no behavior is checked. *Detect:* run the test suite against **mutants** (mutation testing) — assertion-free tests kill ~0% of mutants, so high coverage with a low mutation score is the fingerprint. Cruder heuristic: grep for test bodies with zero assertion calls, or count assertions-per-test and flag the long tail of zeros.
2. **Pragma / annotation exclusions** — wrap hard code in `# pragma: no cover`, `/* istanbul ignore next */`, `//go:` exclusions, or `.coveragerc` omit globs, so it leaves the denominator. *Detect:* diff the exclusion list over time — a spike in `no cover` comments or a growing `omit` block in the same PR the number jumped is the tell. Make exclusions require justification in review.
3. **Padding with trivial tests** — tests for getters, generated code, `toString`, config structs — code with no logic to get wrong. Coverage rises; nothing meaningful is tested. *Detect:* mutation score again (trivial code produces few mutants), plus a look at *where* the new tests landed — all in `models/` and `dto/`, none near the branches that actually changed.
4. **Deleting the hard-to-cover code** — the darkest one: an error-handling branch or a defensive path is *removed* because it's the thing dragging the percentage down. *Detect:* this is invisible to coverage by construction; you catch it in **code review** and by watching for defensive/error paths disappearing in the same change-set that lifted coverage. It's the strongest argument that coverage must never be the *only* gate.

The meta-point: every one of these *raises coverage while lowering or not changing real testedness*. That's not a coincidence — it's Goodhart operating mechanically.

### Q2.2 — Why is the assertion-free test the canonical example of gamed coverage?

> **Testing:** The executed-vs-verified distinction, which is the heart of the topic.

**A.** Because it cleanly separates the two things coverage conflates. Coverage measures **execution** — did this line run? Quality requires **verification** — when this line ran, did we check it did the right thing? An assertion-free test maximizes the first and contributes zero to the second:

```python
def test_calculate_tax():
    calculate_tax(income=50000, region="CA")   # runs every line; asserts nothing
```

This is "100% covered" and catches *no bug whatsoever* — `calculate_tax` could return `None`, the wrong number, or set the building on fire, and the test passes. It's the existence proof that "coverage ≠ quality": coverage saw the lines run and reported success, blind to the fact that nothing was checked. Mutation testing closes the gap precisely because it asks the question coverage can't: *if I break this line, does a test notice?*

### Q2.3 — Engineers say "we exclude the generated gRPC stubs and the `main()` bootstrap — that's legitimate, not gaming." Are they right? How do you keep legitimate exclusions from becoming a loophole?

> **Testing:** Whether you can hold a nuanced line instead of treating all exclusions as cheating.

**A.** They're often right — excluding genuinely untestable or zero-logic code (generated stubs, `main` wiring, vendored code, pure DTOs) makes the *remaining* number more honest, because it stops diluting the metric with code that has nothing to verify. The problem isn't exclusions; it's *unaccountable* exclusions. So I keep three rules: (1) exclusions are **reviewed like code** — a `no cover` needs a reason in the diff, not a silent drop; (2) the exclusion list is **diffable and trended**, so a sudden growth shows up; and (3) exclusions never touch **branches with logic** — error handling, edge cases, anything that can be wrong is in scope by definition. The litmus test: *"if this code were broken, could a user notice?"* If yes, it can't be excluded. Generated stubs fail that test (their correctness is the generator's job); your error path passes it.

### Q2.4 — How does mutation testing specifically defeat coverage gaming, in mechanism terms?

> **Testing:** Connecting the anti-gaming tool to *why* it works.

**A.** Mutation testing changes what's being rewarded from *execution* to *fault detection*. It introduces small faults — flip `>` to `>=`, replace a return with a constant, negate a condition — and reruns the suite; a mutant that survives is a fault your tests *executed past without noticing*. Crucially, **every gaming technique that fools coverage produces a low mutation score**: assertion-free tests kill nothing (they execute the mutant but assert nothing), trivial-code padding produces few mutants to begin with, and excluded code isn't credited. So mutation score is the metric that's *aligned with the goal* coverage was a proxy for. The trade-off — and why it's a complement, not a replacement — is cost: mutation testing reruns the suite once per mutant, so it's run on changed code in CI or nightly, not on every line every commit. Coverage tells you cheaply *what to look at*; mutation testing tells you expensively *whether what you looked at is real*. (See [02 — Mutation Coverage](../02-mutation-coverage/interview.md).)

---

## Theme 3 — Signal vs Target, Diagnostic vs Control

### Q3.1 — Same 78% coverage number. Describe the *healthy* use and the *unhealthy* use.

> **Testing:** The diagnostic-vs-control distinction, made concrete.

**A.** **Healthy (diagnostic):** I open the coverage report and *read the red*. The number 78% is uninteresting; the *shape* of the uncovered 22% is everything. I find the payment-retry branch is uncovered, the auth-failure path is uncovered, and a date-parsing edge is uncovered — those are risks, so I write tests for them. I also notice the uncovered code is mostly a deprecated module nobody calls, which is *fine*. I used coverage to **hunt gaps and prioritize risk**. The number went up as a side effect of fixing real holes; I never looked at it as a goal.

**Unhealthy (control):** Someone says "we're at 78%, the target is 80%, find 2% somewhere by Friday." Now the *gap to the number* drives behavior, so engineers add the *cheapest* covering tests — getters, the deprecated module, whatever's easy — to close 2%, ignoring the payment path because it's hard to test. Coverage hits 80%; the payment retry is still untested. Same number, opposite outcome, because one use treats coverage as a **map to read** and the other as a **score to chase**.

### Q3.2 — What does "read the red, don't chase the green" mean in practice?

> **Testing:** Whether the slogan corresponds to a real workflow.

**A.** It means the *uncovered* lines are the product of a coverage run, not the percentage. The workflow: after a change, look at *what's newly uncovered in the diff* and ask "is this a risk I'm comfortable shipping untested?" — for each red line, a judgment call, not a quota. Most red is informative: an untested error branch is a real gap; an untested log line is noise. "Chasing the green" inverts this — you stop reasoning about individual gaps and just push the aggregate number toward a threshold, which mechanically directs effort at the *easiest* uncovered code rather than the *riskiest*. The aggregate percentage is the *least* actionable number in the report; the per-line redness is the most. (This is the operational heart of [05 — What Coverage Does Not Tell You](../05-what-coverage-does-not-tell-you/interview.md).)

### Q3.3 — Is there *any* legitimate use for the aggregate percentage, then?

> **Testing:** Whether you over-rotate into "the number is useless" — which is also wrong.

**A.** Yes, two legitimate uses, both *diagnostic*. First, as a **trend on a single codebase**: a coverage line that's been sliding down for six months tells me testing discipline is eroding *here* — the direction is the signal, not the absolute value. Second, as a **trigger for a conversation**, never a verdict: "this critical service is at 30%, let's understand why" is a fine use; "30% fails the gate, blocked" is not. What the aggregate is *bad* for is comparison across teams (different code, different risk, trivially gamed) and as a pass/fail bar. So I don't say "the number is useless" — I say "the number is a thermometer, useful for noticing a fever, useless as the thing you optimize."

### Q3.4 — A manager asks for a single org-wide coverage number on a dashboard to track quality. What's wrong with that, framed as diagnostic vs control?

> **Testing:** Recognizing that *putting a number on a dashboard is itself an act of targeting*.

**A.** The act of surfacing it as *the quality KPI* converts it from diagnostic to control whether or not anyone says "target." People manage to what's on the dashboard — a number that's *watched by leadership* is a number that gets optimized, and a single org-wide figure has no risk context (a 60% utility library and a 60% payments service are wildly different) and is the easiest possible thing to game. So it'll trend up and to the right, leadership will feel safer, and the relationship to actual escaped defects will quietly approach zero (Goodhart). The constructive counter: dashboard the things that *are* outcomes — escaped-defect rate, change-failure rate, MTTR — and keep coverage as a *local diagnostic* the teams read, not a *global control* leadership rewards.

---

## Theme 4 — Policy Design

### Q4.1 — Design a coverage policy you'd actually defend. What's in it and what's deliberately not?

> **Testing:** Whether you can turn the philosophy into a concrete, shippable policy — the senior payoff question.

**A.** The policy in four parts:

1. **A patch-coverage floor on *new* code, not a global target.** New and changed lines in a PR should be reasonably covered — say a floor in the 70–80% range on the *diff*. This is the Google stance: you can't economically retrofit a legacy codebase to a number, but you *can* insist new code arrives tested, so coverage ratchets up organically where it matters without a demoralizing, gameable global mandate.
2. **No global percentage target.** Explicitly. No "the org is at 80%." Legacy stays where it is; we don't pay people to backfill trivial tests on code nobody's touching.
3. **Pair coverage with mutation testing on changed code.** Patch coverage proves the new lines *ran* under test; mutation score on the diff proves the tests would *catch a fault*. Together they close the executed-vs-verified gap that patch coverage alone leaves open.
4. **Never on performance reviews.** Coverage is a team's tool for finding gaps; the moment it's an individual's promo metric, every gaming technique in Theme 2 becomes a rational career move. Quality shows up in *outcomes* (escaped defects, incident rate), and even those are team-level, not individual.

What's deliberately *out*: a magic number for the whole repo, cross-team coverage leaderboards, and any gate that blocks on the *aggregate* rather than the *diff*.

### Q4.2 — Why patch coverage (coverage on the diff) rather than a project-wide gate? Make the mechanism explicit.

> **Testing:** Whether you understand *why* the diff is the right unit.

**A.** Three reasons, all mechanical. **It's enforceable without a death march:** a project gate at 80% on a codebase sitting at 55% means thousands of lines of legacy backfill before anyone can merge anything — so teams either revolt or carpet-bomb trivial tests to clear it. A diff gate only asks about the lines in *front* of you, which is achievable per PR. **It targets the right code:** the code most likely to contain a fresh bug is the code you just wrote, so requiring *that* to be tested has the highest defect-catching ROI per unit of effort. **It ratchets monotonically:** every PR adds tested code, so overall coverage drifts upward *as a byproduct of normal work*, concentrated in actively-developed areas — exactly where it's valuable — without anyone optimizing the aggregate. The diff is the unit where "tested" is both cheap to enforce and causally connected to defects. (See [04 — Coverage in CI and Diffs](../04-coverage-in-ci-and-diffs/interview.md).)

### Q4.3 — Even a patch-coverage floor is a number people can hit with assertion-free tests. So haven't you just reintroduced Goodhart at smaller scale?

> **Testing:** Intellectual honesty — the sharp follow-up that catches people who think patch coverage is a silver bullet.

**A.** Yes, in principle — a diff floor is still a target, so it's still gameable by the same techniques, just over fewer lines. I don't pretend otherwise; I manage it three ways. First, the floor is **deliberately moderate** (70–80%, not 100%), so the marginal pressure to game the *last* few percent — where gaming is worst — never builds up. Second, it's **paired with mutation testing on the diff**, which is the part that's actually aligned with the goal; the coverage floor screens out the obviously-untested, and mutation score catches the assertion-free fakery the floor can't see. Third, and most important, it's **backed by code review** — a human reading the PR sees an assertion-free test or a freshly-added `no cover` and pushes back, which no metric can do. So the honest framing is: patch coverage is a *cheap first filter*, not a guarantee, and it only works as one layer of a stack whose top layer is human judgment. Any policy that claims a single number makes gaming impossible is selling something.

### Q4.4 — Why is "never tie coverage to performance reviews" non-negotiable, specifically?

> **Testing:** Whether you see the incentive mechanics, not just "it feels wrong."

**A.** Because performance review is the strongest incentive in the building, and Goodhart's force scales with incentive strength. As a team's shared diagnostic, coverage is gamed only mildly — there's little personal upside. Make it an *individual* promo input and you've maximized the reward for inflating it, so every technique in Theme 2 becomes the *rational* play: an engineer who writes one honest, hard test for the payment path raises coverage less than one who writes thirty assertion-free getter tests, and now the honest engineer is *penalized* for doing the right thing. You've inverted the incentive — rewarding the gaming and punishing the substance — and simultaneously destroyed coverage's usefulness as a diagnostic, because nobody will surface a low-coverage risk if low coverage hurts their rating. The metric is most useful exactly when it's *safe to be honest about*, and review attaches the one consequence that makes honesty expensive.

### Q4.5 — Should the patch-coverage floor ever be 100% on new code? Why or why not?

> **Testing:** Whether you know that even on the *diff*, 100% is the wrong target.

**A.** No — even on new code, a 100% floor recreates the pathology in miniature. The last stretch from ~85% to 100% is dominated by the code that's *hardest and least valuable* to test — defensive branches that "can't happen," exhaustive error arms, logging — so a 100% diff gate spends disproportionate effort, and invites pragma-exclusions and assertion-free tests, on exactly the lines with the worst testing ROI. A moderate floor (70–80% on the diff) captures the high-value coverage and stops *before* the gaming pressure spikes. If a *specific* new module is safety-critical, raise the bar there deliberately and pair it with mutation testing — but as a blanket policy, 100% on the diff is the same smell as 100% on the repo, just smaller.

---

## Theme 5 — The Research and the Authority

### Q5.1 — What did Inozemtseva and Holmes find, and why does it matter for this whole debate?

> **Testing:** Whether you can cite the load-bearing empirical result, not just vibes.

**A.** Inozemtseva and Holmes, *"Coverage Is Not Strongly Correlated with Test Suite Effectiveness"* (ICSE 2014), is the study people reach for. They generated large numbers of test suites of varying size and coverage for real Java programs and measured each suite's *effectiveness* via its ability to detect faults (mutants). The headline: once you **control for suite size**, the correlation between coverage and fault-detection effectiveness is *low to moderate* — much of the apparent "high coverage catches more bugs" effect is really just "bigger suites catch more bugs," and bigger suites happen to cover more. In other words, coverage is a weak independent predictor of whether your tests actually find defects. That's the empirical floor under the whole "signal, not target" position: it's not just a philosophical preference, there's measured evidence that the number you'd be targeting is only loosely tied to the outcome you care about.

### Q5.2 — How do you wield that study honestly without overclaiming it?

> **Testing:** Whether you cite research like an engineer or like a debater.

**A.** I state what it *does* say and refuse the overstatement. It says coverage is a *weak* predictor of effectiveness once size is controlled — so it undercuts using coverage as a *target* and as a *cross-suite quality score*. It does **not** say "coverage is worthless" or "don't measure it": uncovered code is still definitionally untested, so coverage retains its value as a *diagnostic* for finding gaps. The dishonest move is "a study proved coverage doesn't matter, so we shouldn't measure it" — that's not the finding and it's wrong, because the floor (you can't catch a bug in a line no test executes) still holds. The honest claim is narrow and exactly enough: *the evidence says coverage is a poor thing to optimize, which is precisely why we use it to read gaps rather than to set targets.*

### Q5.3 — What's the *Software Engineering at Google* position on coverage targets, and what's the reasoning behind it?

> **Testing:** Knowing the most-cited industrial authority and *why* it lands where it does.

**A.** *Software Engineering at Google* (the "SWE Book," Winters/Manshreck/Wright) is openly skeptical of coverage *targets*. The position: Google measures coverage and finds it useful as a *signal*, but resists hard organization-wide coverage *numbers*, because a mandated percentage drives the dysfunctional behaviors — engineers writing tests to satisfy the metric rather than to verify behavior, and the number becoming a goal divorced from quality. Their reasoning is straight Goodhart plus scale: across a giant heterogeneous monorepo, no single number is meaningful (a 60% gate is absurd for one service and trivial for another), and any number leadership watches gets optimized. What they lean on instead is *changed-code* coverage and engineering judgment in review — the patch-coverage philosophy — so testing discipline applies where new risk is introduced, without a global target to game. The citation matters in an interview because it shows the "no global target" stance isn't a hot take; it's how one of the largest engineering orgs on earth actually operates.

### Q5.4 — "We should aim for 100% coverage." Respond as a senior engineer.

> **Testing:** The "100% is a smell" instinct, with reasoning.

**A.** I'd push back: 100% is a *smell*, not a goal. Three reasons. First, **diminishing-to-negative returns**: the last 10–15% is the hardest, least valuable code to cover — unreachable defensive branches, error arms that "can't happen," generated code — so you spend the most effort on the lines with the least defect risk. Second, **it forces gaming**: chasing the final percent is what produces assertion-free tests, pragma exclusions, and deleted hard code, so a 100% mandate actively *lowers* real testedness near the top. Third, **100% executed still isn't 100% verified** — you can have every line covered and a mutation score of 40%, so the number gives false confidence about a property it never measured. When I see a project *requiring* 100%, my prior is that it's either trivially gamed or it has a culture that confuses the metric for the goal. The healthy version: aim for *meaningfully tested critical paths*, let coverage land wherever honest testing puts it, and use mutation testing where you need real assurance. The exception — and it's a real one — is small, safety-critical modules under a standard that *mandates* 100%, which is Theme 7.

### Q5.5 — Beyond those two, what other evidence or authority would you cite, and how do you avoid argument-from-authority?

> **Testing:** Breadth, plus epistemic hygiene.

**A.** I'd add Martin Fowler's *"TestCoverage"* (he argues coverage is useful for finding *untested* code but a terrible target, and that a team obsessing over a number is a warning sign), and Brian Marick's older "How to Misuse Code Coverage," which catalogs the gaming behaviors decades before they were fashionable to complain about. I'd also point to the broad mutation-testing literature for the constructive alternative. But I hold all of it loosely: authorities establish that this is a *well-understood, mainstream* position rather than a personal preference — they're useful against "you're just being contrarian." They don't *prove* the right policy for *my* codebase; that's an empirical question about my code, my risk, and my team. So I cite to show the position is grounded, then argue from the mechanism (Goodhart, executed-vs-verified) and my own context — not "Google says so, therefore."

---

## Theme 6 — Scenario and Judgment

### Q6.1 — An exec mandates 90% coverage org-wide by end of quarter. What do you say, and what do you propose instead?

> **Testing:** The flagship scenario — can you disagree with leadership constructively and land a better plan?

**A.** I don't open with "no." I open with the exec's *actual* goal, which is almost never "90%" — it's "I'm worried we're shipping bugs / I want confidence in quality." I'd say: *"I'm fully behind raising our quality bar. I want to flag that a 90% org-wide mandate will reliably backfire, and propose something that hits your real goal harder."* Then the mechanism, briefly: a hard number gets gamed — teams will write assertion-free tests, exclude hard code, and pad with trivial tests, so coverage hits 90% while escaped defects don't move; we'd spend a quarter making the dashboard green and quality flat (Goodhart, and there's published evidence the correlation is weak). Then the alternative, concretely:

- A **patch-coverage floor on new code** (~75% on the diff) — so coverage ratchets up where new risk is introduced, the Google approach, without a backfill death march on legacy.
- **Mutation testing on changed code** for the services that matter most — so we measure whether tests actually *catch* faults, not just execute lines.
- **Track outcomes on the dashboard, not coverage** — escaped-defect rate, change-failure rate, MTTR — the things you actually care about.
- A **focused effort on the genuinely under-tested critical paths** (payments, auth), found by *reading* coverage, not chasing the aggregate.

The framing that usually lands: *"You'll get more real quality from 75% on new code plus mutation testing than from 90% everywhere — and the 90% version risks giving us false confidence right before an incident."* I'm giving leadership a *better* path to *their* goal, not refusing the goal.

### Q6.2 — Coverage went from 70% to 95% over two quarters, but the escaped-bug rate didn't drop at all. What happened?

> **Testing:** Diagnosing Goodhart in the wild from the symptom.

**A.** The textbook fingerprint of *coverage was targeted and got gamed* — the number rose, the testedness didn't, so defects are unchanged. I'd confirm by looking for the four signatures: (1) **mutation score flat or low** despite high coverage — the decisive tell that the new tests execute but don't verify; (2) a **spike in assertion-free or near-trivial tests** — check assertions-per-test and where new tests landed (all in DTOs/getters?); (3) **growth in exclusions** — more `no cover` pragmas / `omit` entries appearing alongside the climb; (4) **hard paths still red** — the error/retry/edge branches that actually fail in prod are likely *still* uncovered because they were the expensive ones the team routed around. The diagnosis is that effort went into *the number* rather than *the risk*. The fix isn't "push coverage higher" — it's redirect: drop the coverage target, add mutation testing on changed code, and point testing effort at the specific critical paths via reading the report. If I had to bet, the 25 points are concentrated in low-logic code and assertion-light tests, and the dangerous code is right where it was.

### Q6.3 — You've inherited a repo with a 100% coverage gate that's been in place for years. You want to walk it back to a sane policy. How do you do it without triggering a "they're lowering quality standards!" panic?

> **Testing:** Change management around a beloved-but-broken metric — pure senior judgment.

**A.** The risk is political, not technical: people read "100% → 75% diff" as *lowering the bar*, so I lead with *evidence that the bar is currently fake*, not with the philosophy. The sequence:

1. **Expose the gaming first.** Run mutation testing on the supposedly-100% codebase and show the mutation score — if it's, say, 50%, that's the whole argument in one number: *"we're 100% covered and half our faults survive; the gate measures execution, not quality."* Surface the assertion-free tests and the exclusion list. Now "100%" is visibly not the quality guarantee everyone assumed.
2. **Reframe the change as *raising* the real bar.** I'm not lowering standards; I'm *replacing a gameable proxy with a stronger one* — patch coverage *plus mutation testing*, which actually checks fault-detection. The headline is "we're adding a quality gate that's harder to fake," not "we're dropping coverage."
3. **Roll it gradually and keep visibility.** Keep reporting coverage (don't *hide* the number — that reads as a cover-up); just remove it as a *blocking gate* and introduce the diff floor + mutation gate. Trend escaped defects across the transition so I can show quality held or improved.
4. **Get the change socialized, not decreed.** Bring senior engineers and the quality-minded skeptics in early; let *them* see the 50% mutation score. A policy people helped build doesn't trigger the panic a top-down "we're relaxing coverage" memo would.

The throughline: never frame it as *less testing*. Frame it as *the old gate was theater, here's a gate that isn't* — backed by the mutation number that makes the theater undeniable.

### Q6.4 — A team proudly reports 100% coverage on a new service. Are you reassured? What do you ask next?

> **Testing:** Whether "100%" triggers curiosity rather than comfort.

**A.** Not reassured — *curious*, and slightly suspicious, because 100% is more often a sign of a target than of unusual diligence. I'd ask, in order: *"What's the mutation score?"* (the real question — 100% coverage with a low mutation score means lots of execution, little verification); *"How much is excluded, and why?"* (100% of what denominator?); *"Show me the tests for the error-handling and edge paths"* (if those are thin or assertion-free, the 100% is padding from the easy code); and *"Was 100% a goal or an outcome?"* (if it was mandated, I expect gaming; if it fell out of genuinely testing a small, clean service, that's plausible and fine). The point isn't to assume bad faith — a small, well-designed service genuinely *can* be 100% honestly — it's that the number alone tells me nothing, and the follow-ups tell me everything. A team that answers "mutation score's 90%, here are the edge-case tests, and 100% just happened" has earned the reassurance; a team that answers "it was the Q3 OKR" has told me what the number is worth.

### Q6.5 — Two services: payments at 60% coverage, an internal admin tool at 95%. Where do you focus, and what does this reveal about coverage as a target?

> **Testing:** Risk-weighting over uniform numbers — the anti-global-target argument made tangible.

**A.** I focus on **payments**, despite — actually *because of* — the lower number. Coverage is meaningful only weighted by *risk and blast radius*: a gap in payments can lose money and trust; a gap in an internal admin tool inconveniences a few employees. A uniform target would tell me to leave payments alone (it's "passing" relative to nothing or relative to admin) and maybe pad the admin tool higher — exactly backwards. So I'd dig into *which* 40% of payments is uncovered (if it's the retry/refund/idempotency paths, that's an emergency; if it's logging, less so) and probably accept the admin tool's 95% as fine or even over-invested. What it reveals: a single org-wide number is *risk-blind* by construction — it can't distinguish the service where 60% is a crisis from the one where 95% is overkill, which is the core reason "no global target" beats "everyone hit X." The right unit of attention is *risk-weighted gaps*, and only a human reading the reports per-service can apply that weighting.

---

## Theme 7 — When a Number IS Appropriate

### Q7.1 — You've argued hard against coverage targets. When is a hard coverage number actually the right call?

> **Testing:** Whether your position is principled or just reflexively anti-metric.

**A.** When the number is **part of an external contract or a regulatory standard**, not a proxy you invented. In safety-critical and regulated domains, a coverage figure is *mandated by a standard* and is an auditable deliverable, not a self-imposed quality KPI:

- **DO-178C** (airborne software) requires, at the highest assurance level (Level A), **MC/DC** — Modified Condition/Decision Coverage, a far stricter structural criterion than line or branch — as a certification objective.
- **ISO 26262** (automotive functional safety) and **IEC 62304** (medical device software) similarly call for specified structural coverage (statement/branch/MC/DC depending on integrity level).

In these contexts the number isn't a surrogate for "testedness we hope correlates with quality" — it's a *defined exit criterion an auditor checks*, often legally required to ship. Goodhart still applies (people can technically still write weak tests to a coverage criterion), which is why these standards pair coverage with **requirements-based testing and independent review** — the coverage criterion is necessary, not sufficient, even there. So my position isn't "numbers are always bad"; it's "numbers as *self-imposed proxies* are bad, numbers as *mandated external criteria* are a different thing with different rules."

### Q7.2 — Why does the same number that's toxic in a web app become legitimate under DO-178C? What's structurally different?

> **Testing:** Whether you understand *why* the regulated case escapes Goodhart's worst effects.

**A.** Three structural differences. First, **the number isn't a proxy** — in a web app, "80%" stands in for the thing we actually want (defect-free behavior) and gets surrogated for it; under DO-178C, MC/DC coverage *is itself* a defined certification objective, so there's no proxy to corrupt — hitting it is literally part of the deliverable. Second, **it doesn't stand alone** — the standards mandate requirements-based testing *and* independent verification *and* structural coverage together, so you can't satisfy the regime by gaming coverage; the coverage is a cross-check that your requirements-based tests exercised the structure, and an *independent* party reviews it. Third, **the cost-benefit is inverted** — in a web app the marginal cost of the last 10% exceeds its value, so chasing it is waste; in avionics the cost of an escaped defect is catastrophic, so exhaustively covering even "can't happen" branches is *rational*. So it's legitimate there not because the metric is magic, but because it's a non-proxy criterion, embedded in a multi-part regime with independent review, in a domain where the exhaustiveness actually pays.

### Q7.3 — Where's the line? How do you decide whether a given module deserves a hard coverage criterion or the no-target diagnostic approach?

> **Testing:** Practical judgment about applying the right regime to the right code.

**A.** I draw the line on **consequence-of-failure and external mandate**. Two questions: *Is there a standard or contract that requires a coverage criterion?* — if yes (regulated safety, certain government/defense contracts), it's not my call; the number is an exit criterion and I treat it as such, paired with requirements-based testing. *If not, what's the blast radius of an undetected defect?* — for genuinely safety- or money-critical code (a flight-control loop, a payments ledger, a crypto primitive) I'll *voluntarily* hold a high bar and back it with mutation testing, because the exhaustiveness pays even without a regulator. For everything else — the vast majority of general application code — it's the no-global-target, read-the-red, patch-coverage-plus-mutation approach. The mistake in *both* directions: applying DO-178C rigor to a CRUD admin panel (waste and gaming), or applying "coverage is just a signal, relax" to flight software (negligence). Match the regime to the consequences.

### Q7.4 — Even in regulated contexts, what's the failure mode of treating the mandated coverage number as sufficient?

> **Testing:** That you don't flip to "regulated = the number guarantees safety."

**A.** Treating the criterion as *sufficient* rather than *necessary* — "we hit MC/DC, therefore the software is safe" — which is Goodhart sneaking back in even where the number is legitimate. Coverage, however strict, still only measures that *structure was exercised*; it can't tell you the *requirements were right*, that the tests *asserted correct behavior*, or that the *spec captured reality*. You can achieve MC/DC with tests that exercise every condition combination yet assert the wrong expected outputs, or perfectly cover code that correctly implements a *wrong* requirement. That's exactly why the standards never rely on coverage alone — they wrap it in requirements-based testing, independent review, and traceability from requirement to test. So the senior caveat holds even here: the number is a *floor and a cross-check*, never a *proof*. The day a team says "we're certified to MC/DC, so we're done thinking about whether the tests are meaningful" is the day the coverage criterion has been surrogated for safety — the same disease as the web team's 90%, just wearing a flight suit.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: State Goodhart's law.** A: When a measure becomes a target, it ceases to be a good measure.
- **Q: What's surrogation?** A: Mentally replacing the real goal with its metric — caring about the proxy as if it *were* the objective.
- **Q: Coverage measures ___, quality requires ___.** A: Execution (a line ran); verification (an assertion checked the result).
- **Q: Fastest way to game coverage?** A: Assertion-free tests — call the code, assert nothing; lines count as covered, no bug is caught.
- **Q: One tool that detects assertion-free tests?** A: Mutation testing — they kill ~0% of mutants, so high coverage + low mutation score is the tell.
- **Q: Patch coverage vs global target — which, and why?** A: Patch coverage; it ratchets new code up without a gameable, demoralizing global mandate (the Google stance).
- **Q: Should coverage be on performance reviews?** A: Never — it maximizes the incentive to game it and punishes engineers who write hard, honest tests.
- **Q: Is 100% coverage a good goal?** A: No, it's a smell — the last percent is the lowest-value, most-gamed code; 100% executed still isn't 100% verified.
- **Q: Inozemtseva & Holmes one-liner?** A: Once you control for suite size, coverage is only weakly correlated with fault-detection effectiveness.
- **Q: "Read the red, don't chase the green" means?** A: Use the *uncovered* lines to hunt risks; don't optimize the aggregate percentage.
- **Q: Is the aggregate coverage % ever useful?** A: As a *trend* on one codebase and a conversation-starter — never as a cross-team comparison or a pass/fail gate.
- **Q: When is a hard coverage number legitimate?** A: When it's a mandated external criterion (DO-178C MC/DC, ISO 26262, IEC 62304), not a self-imposed proxy.
- **Q: What's MC/DC?** A: Modified Condition/Decision Coverage — a strict structural criterion required for high-assurance safety software.
- **Q: Coverage rose to 95% but bugs didn't drop — diagnosis?** A: The number got targeted and gamed; testedness didn't move (check mutation score and the exclusion list).
- **Q: Why pair coverage with mutation testing?** A: Coverage proves lines *ran*; mutation proves tests would *catch a fault* — together they close the executed-vs-verified gap.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Treating a coverage percentage as a quality *score* — "we're at 85%, so we're well-tested."
- Advocating a single org-wide target, or worse, putting coverage on performance reviews.
- Defending 100% coverage as a goal, with no mention of diminishing returns or gaming.
- Conflating *executed* with *verified* — not knowing an assertion-free test is "covered."
- Reflexive anti-metric dogma: "coverage is useless, don't measure it" (ignores that uncovered = untested, and the regulated exception).
- Citing a study as proof ("research says coverage doesn't matter") without stating what it actually found.
- Proposing to fix flat bug rates by pushing coverage *higher*.

**Green flags:**
- Naming Goodhart's law *and* surrogation, and applying them to the executed-vs-verified gap.
- Reaching for **patch coverage + mutation testing** as the constructive alternative, unprompted.
- Distinguishing *diagnostic* use (read the red, hunt gaps) from *control* use (chase the number).
- Citing Inozemtseva & Holmes and SWE-at-Google *accurately and with limits*.
- Disagreeing with an exec's mandate by reframing toward their *real* goal, not refusing it.
- Treating "100%" as a prompt for follow-up questions (mutation score? exclusions? mandate or outcome?), not as reassurance.
- Knowing exactly where the line bends — regulated/safety contexts where a number is a legitimate, audited criterion — and *still* caveating that it's necessary, not sufficient.

---

## Summary

- The whole topic is one distinction in seven costumes: a coverage **number is a diagnostic; the moment you make it a target you destroy the diagnostic** (Goodhart's law), and the deeper trap is **surrogation** — the org sincerely mistaking the green dashboard for actual quality.
- **Gaming is mechanical, not malicious:** assertion-free tests, pragma exclusions, trivial-test padding, and deleting hard code all *raise coverage while lowering or not changing testedness* — because coverage rewards **execution** but quality needs **verification**. Each is detectable, mostly via **mutation testing** and code review.
- **Healthy use = diagnostic/control:** read the red to *hunt risk-weighted gaps*; the aggregate percentage is the least actionable number in the report and toxic the instant it's chased or dashboards as the KPI.
- **Policy that survives contact:** a **patch-coverage floor on new code** (the Google stance), **no global target**, **paired with mutation testing**, and **never on performance reviews** — and not even 100% on the diff, because that re-creates the pathology in miniature.
- **The research backs it:** Inozemtseva & Holmes (coverage weakly predicts effectiveness once size is controlled) and *SWE at Google* (skeptical of org-wide targets); 100% is a *smell*, not a goal.
- **The number IS appropriate** when it's a *mandated external criterion* (DO-178C MC/DC, ISO 26262, IEC 62304) rather than a self-invented proxy — and even there it's *necessary, not sufficient*, always paired with requirements-based testing and independent review.

---

## Further Reading

- Inozemtseva & Holmes, *"Coverage Is Not Strongly Correlated with Test Suite Effectiveness"* (ICSE 2014) — the empirical floor under "signal, not target."
- *Software Engineering at Google* (Winters, Manshreck, Wright) — the testing chapters on coverage as signal and the case against org-wide targets.
- Martin Fowler, *"TestCoverage"* (martinfowler.com) — the canonical short argument for coverage as a gap-finder, not a target.
- Brian Marick, *"How to Misuse Code Coverage"* — the original catalog of the gaming behaviors.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [05 — What Coverage Does Not Tell You](../05-what-coverage-does-not-tell-you/interview.md) — the executed-vs-verified gap and the limits this page builds its policy on.
- [02 — Mutation Coverage](../02-mutation-coverage/interview.md) — the metric that is *aligned* with the goal and the primary defense against gaming.
- [04 — Coverage in CI and Diffs](../04-coverage-in-ci-and-diffs/interview.md) — where the patch-coverage floor is actually enforced.
- [Code Coverage README](../README.md) — where "coverage as signal" sits in the broader coverage landscape.
- [Quality Engineering README](../../README.md) — coverage's place among the wider quality signals.
