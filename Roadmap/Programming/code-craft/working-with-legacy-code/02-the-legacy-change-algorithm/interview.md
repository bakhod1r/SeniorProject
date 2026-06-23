# The Legacy Change Algorithm — Interview Questions

This is a Q&A bank for interviews that probe how you safely change untested code. Questions run junior → staff. Each has a model answer, and most have follow-ups an interviewer will push on. Use it to rehearse *reasoning aloud*, not to memorize lines — the follow-ups exist to catch recited answers.

## Table of Contents

- [Q1. What is the Legacy Change Algorithm?](#q1-what-is-the-legacy-change-algorithm)
- [Q2. Why must the tests come before the behavior change?](#q2-why-must-the-tests-come-before-the-behavior-change)
- [Q3. Change point vs. test point?](#q3-change-point-vs-test-point)
- [Q4. What is a characterization test, and why pin a bug?](#q4-what-is-a-characterization-test-and-why-pin-a-bug)
- [Q5. Explain sensing vs. separation.](#q5-explain-sensing-vs-separation)
- [Q6. What is a pinch point and when do you test at one?](#q6-what-is-a-pinch-point-and-when-do-you-test-at-one)
- [Q7. Walk me through changing a method that opens a DB connection in its body.](#q7-walk-me-through-changing-a-method-that-opens-a-db-connection-in-its-body)
- [Q8. Sprout vs. Wrap — when each, and what do they NOT do?](#q8-sprout-vs-wrap--when-each-and-what-do-they-not-do)
- [Q9. When would you deviate from the strict five-step order?](#q9-when-would-you-deviate-from-the-strict-five-step-order)
- [Q10. A teammate says "no time for tests." How do you respond?](#q10-a-teammate-says-no-time-for-tests-how-do-you-respond)
- [Q11. How does the change-point boundary affect dependency-breaking cost?](#q11-how-does-the-change-point-boundary-affect-dependency-breaking-cost)
- [Q12. How do you scale this to a huge unfamiliar codebase?](#q12-how-do-you-scale-this-to-a-huge-unfamiliar-codebase)
- [Q13. Isn't breaking dependencies itself a risky untested change?](#q13-isnt-breaking-dependencies-itself-a-risky-untested-change)
- [Q14. How would you slice a legacy change into PRs?](#q14-how-would-you-slice-a-legacy-change-into-prs)
- [Q15. How do you review a legacy-change PR?](#q15-how-do-you-review-a-legacy-change-pr)
- [Q16. Decide how much net to build — give me a framework.](#q16-decide-how-much-net-to-build--give-me-a-framework)
- [Q17. One engineer owns the scary subsystem. As lead, what do you do?](#q17-one-engineer-owns-the-scary-subsystem-as-lead-what-do-you-do)
- [Q18. The test you wrote is flaky. What now?](#q18-the-test-you-wrote-is-flaky-what-now)

---

## Q1. What is the Legacy Change Algorithm?

**Level:** Junior

**Model answer.** It's Michael Feathers' five-step procedure for changing code that has no tests, so you can do it without guessing whether you broke something. The steps, in order: (1) **Identify change points** — where must behavior differ; (2) **Find test points** — where can you observe the effect of that code; (3) **Break dependencies** — make those points reachable in a test without rewriting the risky logic; (4) **Write characterization tests** — pin what the code does *now*; (5) **Make the change and refactor** — with a safety net catching mistakes. The key structural insight is that the first four steps build a net and only the fifth changes behavior.

**Follow-up — "Why is it called an *algorithm* and not a guideline?"** Because it's concrete and ordered — a checklist you run the same way every time, not a vague principle. That repeatability is the point: under deadline pressure you always know your next move, so fear doesn't push you into "edit and pray."

## Q2. Why must the tests come before the behavior change?

**Level:** Junior

**Model answer.** The characterization test records the *before*. If you change behavior first and write tests after, the tests pass — but they pass on the new behavior, so they prove nothing about whether you preserved the old behavior. You've overwritten the baseline you needed to compare against. Tests-first means: green baseline → change code → a failure now *means you broke something*. Tests-after means: change → write tests → green, but green on what? You lost the reference.

**Follow-up — "What if the old behavior was a bug?"** You still pin it first. The characterization test records reality, bug included, so your *current* change doesn't accidentally alter the bug without you noticing. Fixing the bug is a separate, deliberate task with its own test.

## Q3. Change point vs. test point?

**Level:** Junior

**Model answer.** A **change point** is the specific location where behavior must change — the exact method or expression. A **test point** is where you can *observe* the effect of that code. Sometimes they're the same spot: a method that returns a value can be changed and asserted at the same place. Sometimes they differ: if the change point's only effect is writing a database row or sending an email, the test point is wherever you can sense that side effect — maybe a fake repository you inspect, maybe a layer further out.

**Follow-up — "Give me a case where they're far apart."** A change deep in a pricing helper whose result flows through three layers before becoming an HTTP response. The change point is the helper; the cheapest sensing point might be the response if the inner layers are too tangled to reach — though closer is better when you can get it.

## Q4. What is a characterization test, and why pin a bug?

**Level:** Junior → Middle

**Model answer.** A characterization test documents what the code *currently does*, as opposed to a normal test that asserts what code *should* do. The technique: write a test, assert a placeholder, run it, read the actual value from the failure message, lock that value in. You pin bugs because your task right now is the *change*, not fixing every old defect. Pinning the current behavior — quirks and all — means your change can't silently alter that behavior. The net guards everything you *didn't* mean to touch.

**Follow-up — "Doesn't that enshrine bad behavior forever?"** No — it makes the bad behavior *visible and tested*, which is the prerequisite for fixing it safely later. You can't safely fix what you can't detect. Pinning it is step one toward fixing it deliberately.

## Q5. Explain sensing vs. separation.

**Level:** Middle

**Model answer.** They're the two reasons to break a dependency. **Separation** is getting the code to *build and run* in a test harness at all — the real DB call must not execute. **Sensing** is getting to *observe* the outcome — you need to capture what was computed. They're independent: a method can be easy to sense but impossible to separate (it returns its result cleanly but its constructor opens a socket), or easy to separate but hard to sense (it's behind a clean interface but its only effect is a private field mutation). Diagnosing *which one* is blocking you tells you which technique to reach for — extracting an interface fixes separation, adding a sensing method fixes sensing.

**Follow-up — "How would you sense a private field?"** Options in rough order of preference: assert via observable behavior that depends on the field; add a sensing getter; subclass to expose it; as a last resort, reflection. Prefer the route that pins behavior through the public surface, because that's what real callers see.

## Q6. What is a pinch point and when do you test at one?

**Level:** Middle

**Model answer.** A pinch point is a narrow place in the call graph that many paths flow through — one entry that funnels a lot of behavior. A test at a pinch point exercises a large tangle through a single call, which is efficient for getting *initial* coverage over scary code you can't easily test piece by piece. The trade-off is that pinch-point tests are coarse: when they fail, they tell you something broke but not *where*. So you use them to throw a net over a region, then push tests inward — closer to specific change points — as you break dependencies.

**Follow-up — "Pinch point vs. interception point?"** An interception point is the place *nearest your change point* where you can sense its effect; you generally want to test close. A pinch point is about *coverage breadth* — one spot covering many paths. They can coincide, but the pinch point is chosen for reach over many behaviors, the interception point for proximity to one change.

## Q7. Walk me through changing a method that opens a DB connection in its body.

**Level:** Middle

**Model answer.** Here's the starting shape:

```java
public Invoice generate(long orderId) {
    Connection conn = DriverManager.getConnection(DB_URL);   // hard dependency
    Order order = new OrderDao(conn).load(orderId);
    Instant now = Instant.now();                             // clock dependency
    // ... pricing logic I actually want to change ...
}
```

Step 1, identify: the change point is the pricing logic. Step 2, find: `generate` returns an `Invoice`, so the return value is my sensing point. Step 3, break: the DB connection and the clock block separation. I introduce collaborators and inject them — a mechanical *Parameterize Constructor* / *Extract Interface*:

```java
public InvoiceService(OrderRepository orders, Clock clock) {
    this.orders = orders;
    this.clock = clock;
}
public Invoice generate(long orderId) {
    Order order = orders.load(orderId);
    Instant now = clock.instant();
    // ... same pricing logic, now reachable in a test ...
}
```

Step 4, characterize: pass a fake repo and a fixed clock, call `generate`, run, read the actual total off the failure, pin it. Step 5: change the pricing logic, keep old characterization tests green, add a test for the new behavior. I'd ship the injection as a separate refactor-only commit *before* the feature commit.

**Follow-up — "Why inject rather than mock `DriverManager` statically?"** Injection makes the dependency explicit and the technique mechanical and reviewable — the IDE can do the extract, so it's provably behavior-preserving. Mocking a static is heavier, often needs a special framework, and leaves the hard dependency in place; I'd only reach for it when I genuinely can't change the constructor.

## Q8. Sprout vs. Wrap — when each, and what do they NOT do?

**Level:** Middle → Senior

**Model answer.** Both let me add *new tested code beside* legacy code without first taming the whole method. **Sprout**: write the new logic as a fresh, fully-tested method or class, then call it from one line in the legacy method. Use it when the new behavior can live in its own unit:

```java
total -= new DiscountPolicy().discountFor(customer, subtotal); // sprouted, tested unit
```

**Wrap**: when new behavior must run *before or after* the existing behavior without altering it — rename the original, give the new code the old name, call through:

```java
public Receipt checkout(long id) {
    Receipt r = doCheckout(id);          // original, renamed, untouched
    auditLog.record(id, r.total());      // new behavior
    return r;
}
```

What *neither* does: make the legacy code itself tested. They add tested code *beside* it. The legacy method gains exactly one untested call (Sprout) or stays entirely untouched (Wrap). They're how you route around expensive dependency-breaking — but the debt remains and should be logged.

**Follow-up — "When would you NOT sprout and break dependencies instead?"** When the change is *inside* an existing computation — the price formula itself must branch on tier — there's no clean unit to sprout; the change lives in the tangle, so I pay for separation and sensing. Sprout/Wrap are for *additive* behavior beside the old code.

## Q9. When would you deviate from the strict five-step order?

**Level:** Senior

**Model answer.** The order is the safe default, and each deviation drops a specific guarantee, so I name the guarantee before deviating. Common deviations:

- **Characterize before identifying**, on unfamiliar code — I use characterization tests as a *microscope* to learn what the method does before I'm sure where the change point is. Cost: some throwaway tests, which usually stay as coverage anyway.
- **Skip the break step** when the change point is a pure function with no statics/clock/IO — but I *verify* the purity rather than assume it.
- **Skip characterization** for genuinely non-behavioral changes — renaming a local, fixing a comment. The trap is scope creep turning it behavioral.
- **Add a step 0, verify the requirement**, on high-stakes paths, because correctly implementing the wrong spec is the most expensive bug.

The meta-point: deviating is a senior move only when I can state which protection I'm giving up and have decided it's acceptable here.

**Follow-up — "You said characterization can come first. Doesn't that contradict 'tests before change'?"** No — it strengthens it. I'm pulling step 4 *earlier*, not later. Tests still precede the behavior change; I'm just using them to build my mental model before committing to the change point.

## Q10. A teammate says "no time for tests." How do you respond?

**Level:** Senior

**Model answer.** I don't argue it as a principle — I convert it into a quantified, owned risk decision. The argument assumes tests are a tax on *this* change, but a defect gets ~10× more expensive each phase it survives — free in the editor, an incident in production — and the change is slow *because* there's no net. So I phrase a choice: "I can ship untested in 30 minutes, but it's on the payment path and could be silently wrong money. Or two hours with a characterization net and I can tell you it's safe. Which risk do you want to own?" That surfaces the real consequence, quantifies both paths, and puts risk acceptance with whoever has authority to accept it. Usually naming the consequence flips it to "take the two hours." If it's a genuine emergency — site down — the fast path may be right, and I've made it a conscious, documented decision with a follow-up ticket.

**Follow-up — "What if your manager overrules you and says ship it?"** Then it ships, because the risk owner accepted it explicitly — that's their call to make. I document the decision and the deferred net as a ticket so it's visible, not silently lost. My job was to make the trade clear, not to win unilaterally.

## Q11. How does the change-point boundary affect dependency-breaking cost?

**Level:** Senior

**Model answer.** Where you draw the change point determines which dependencies fall *inside* it and must be broken to reach a test point. Draw the boundary one method too wide and you've inherited a DB call you now have to seam. So minimal change points aren't just tidiness — they're minimal *dependency-breaking*, which is the expensive step. Before finalizing a change point I ask: what deps does this boundary force me to cut? Sometimes nudging the boundary by one method turns a brutal break into a free one — e.g. moving the boundary to a pure inner helper instead of the I/O-laden outer method.

**Follow-up — "So smaller is always better?"** Not blindly — too *small* a boundary can split a coherent change across awkward seams, or miss a ripple point a caller needs. The goal is the boundary that minimizes total break cost *while* fully containing the behavioral delta and its ripples. It's an optimization, not "minimize at all costs."

## Q12. How do you scale this to a huge unfamiliar codebase?

**Level:** Senior → Staff

**Model answer.** The five steps hold, but each gets harder and changes shape:

- **Identify** becomes a *search* problem — grep the domain term, trace a real request with a debugger or distributed trace, follow the data, confirm with whoever knows the area. On a 2M-line system, *finding* the change point is often the biggest part of the task.
- **Find test points** may cross process boundaries — the effect is a queue message or a row in another service's DB, so the interception point is a contract test or an HTTP-boundary characterization test, not a unit test.
- **Break dependencies** may hit *architectural* deps — a global static config read by 400 classes can't be cut in one PR — so I Sprout/Wrap to avoid the break and defer the architectural fix to a funded effort.
- **Characterize** becomes *golden-mastering* — feed the subsystem a corpus of recorded real inputs, snapshot all outputs, and diff against that baseline.

**Follow-up — "What's the first thing you do on day one in such a system?"** Get *one* characterization test running end to end on the area I'll touch — even a coarse golden-master at a boundary. That single working harness proves I can build, run, and sense the system, and everything else builds on it.

## Q13. Isn't breaking dependencies itself a risky untested change?

**Level:** Senior → Staff

**Model answer.** Yes — that's the recursion at the heart of legacy work. Every dependency I cut is an edit to untested code with no net under *it*. That's exactly why Feathers insists the dependency-breaking moves be *mechanical and behavior-preserving* — Extract Interface, Parameterize Constructor, Subclass and Override — ideally done by the IDE's automated refactoring, which is provably safe. When the move is automated I don't need a net for it. The danger is *hand-edited* breaks, where I'm changing structure manually with no verification. There I slow down, make the smallest possible edit, and if the suite exists at all, lean on it.

**Follow-up — "What if the IDE can't do the move automatically?"** Then I treat the break as its own risky change: smallest mechanical step I can, possibly a temporary pin test at a coarse pinch point to cover the region while I cut, and a separate review focused solely on "did this preserve behavior?" I never bundle a hand-edited break with the feature.

## Q14. How would you slice a legacy change into PRs?

**Level:** Senior → Staff

**Model answer.** I default to a sequence, each PR with one job:

```
PR 1  Break dependencies        refactor-only   risk low   "prove nothing changed"
PR 2  Add characterization tests tests-only      risk none  "do these pin reality?"
PR 3  Make the behavior change   feature         risk med   "new behavior right + old green?"
PR 4  Tidy / refactor            refactor-only   risk low   "still green, clearer?"
```

This concentrates all behavioral risk into PR 3, which is small because the plumbing already landed. Review is fast because each PR asks one question. Rollback is surgical — revert PR 3 alone, keep the tests and seams, which are permanent gains. If the dependency-breaking PR is large, I slice *it* per collaborator, landing each behind existing behavior so nothing ships until the feature flips on.

**Follow-up — "Why not just do it all in one well-described PR?"** Because a mixed diff hides the risky line — the reviewer can't tell which change was *supposed* to alter behavior versus plumbing that should be inert. Separation lets the reviewer verify the refactor is inert by inspection and the feature by its tests. That's where regressions hide otherwise.

## Q15. How do you review a legacy-change PR?

**Level:** Staff

**Model answer.** I verify the *algorithm was followed*, not just that the code reads well. On a refactor-only PR: did any production behavior change (it must not), and were existing tests edited (a red flag — behavior-preserving moves shouldn't touch assertions). On a tests-only PR: do the assertions pin *actual* behavior or the author's *assumption*? A suspiciously round expected value usually means they wrote what they expected instead of running it — I ask "did the test print this, or did you guess?" On the feature PR: is the behavioral delta small and localized (if it's big, plumbing leaked in — split it), do old characterization tests still pass, is there a *new* test for the new branch, and was the requirement itself confirmed?

**Follow-up — "What's the single most common thing you push back on?"** The mixed PR — feature plus plumbing plus a "while I was here" cleanup in one diff. I ask for it split, because that one habit prevents the largest share of legacy regressions.

## Q16. Decide how much net to build — give me a framework.

**Level:** Staff

**Model answer.** I size the net to `P(regression) × cost(regression)`, capped by `cost(net)`. Concretely as a decision tree the team can share:

```
Is the change BEHAVIORAL?  No  → ship with review, no characterization.
                           Yes ↓
High-stakes path (money / data integrity / security / silent failure)?
   Yes → full algorithm + characterize neighbors + domain reviewer.
   No  ↓
Can the new behavior be SPROUTED beside the old code?
   Yes → sprout into a tested unit, one call-site.
   No  → break minimal deps, characterize touched branches, change.
```

The point is that not every change earns the full ceremony, and a few — silent money paths — earn *more* than the minimum. A shared framework keeps different engineers making consistent calls instead of each guessing.

**Follow-up — "What makes a path 'high-stakes' beyond money?"** Anything where a regression is *silent* or *irreversible*: data corruption that compounds before detection, a security check, anything writing to an external system you can't easily undo. Silence is the multiplier — a loud failure gets caught fast and cheap; a silent one accrues damage.

## Q17. One engineer owns the scary subsystem. As lead, what do you do?

**Level:** Staff

**Model answer.** The expert bottleneck is an organizational single-point-of-failure, and the algorithm exists to dissolve exactly the condition that creates it — the absence of a net. So I don't ask the expert to write docs; I have them *pair* the next two or three changes to that subsystem, committing the characterization net first. The knowledge they feel is irreplaceable is mostly "I know what this does because I've watched it" — which a golden-master harness captures and makes shareable. After a few paired changes the subsystem has tests and several engineers can touch it safely. I also bake net-building into the *estimate* for those tickets so we don't skip it under pressure.

**Follow-up — "The expert resists, says tests will slow them down."** I frame it as risk and bus-factor, not productivity: right now the team can't ship a billing change when they're on leave, and that's a business risk they don't want to own personally. The net is also *their* relief — it stops every billing ticket from routing to them forever.

## Q18. The test you wrote is flaky. What now?

**Level:** Middle → Senior

**Model answer.** Flakiness almost always means an uncontrolled nondeterministic source leaked into the test — the system clock, a random number, hash-map ordering, an external call, or test-order dependence. The fix is to *inject* the nondeterministic source so the test controls it: pass a fixed `Clock` instead of `Instant.now()`, a seeded RNG, an in-memory fake instead of the network. That's just dependency-breaking applied to determinism — same technique as separation, aimed at making the result repeatable. A flaky characterization test is worse than no test, because it trains the team to ignore red, so I fix or quarantine it immediately rather than rerun-until-green.

**Follow-up — "What if the flakiness is in the legacy code itself, not the test?"** Then I've discovered real nondeterministic behavior — that's a finding, not just a test problem. I pin the *deterministic* parts, inject the source so I can characterize behavior per-seed or per-clock value, and flag the nondeterminism as its own issue. The test made a hidden property visible, which is a win.

---

### How to use this bank

- **Junior/middle questions (Q1–Q8, Q18):** be crisp on the five steps, the tests-before-change rule, sensing vs. separation, and Sprout/Wrap. Interviewers want to see you *won't* edit-and-pray.
- **Senior questions (Q9–Q13):** show you treat the algorithm as a risk default you can deviate from deliberately, naming the guarantee you drop each time.
- **Staff questions (Q14–Q17):** show you make the *team* good at this — PR slicing, review rubric, shared frameworks, dissolving bottlenecks — not just yourself.
- Always reason aloud and invite the follow-up; reciting the five verbs without the *why* is exactly what these questions are built to expose.
