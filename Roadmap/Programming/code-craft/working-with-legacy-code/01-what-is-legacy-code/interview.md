# What Is Legacy Code — Interview Q&A Bank

## Table of Contents

- [How to use this bank](#how-to-use-this-bank)
- [Q1 — Define legacy code (junior)](#q1--define-legacy-code-junior)
- [Q2 — Can brand-new code be legacy? (junior)](#q2--can-brand-new-code-be-legacy-junior)
- [Q3 — Edit and pray vs. cover and modify (junior)](#q3--edit-and-pray-vs-cover-and-modify-junior)
- [Q4 — Why does legacy code cost so much? (junior/mid)](#q4--why-does-legacy-code-cost-so-much-juniormid)
- [Q5 — How do you recognize legacy code? (mid)](#q5--how-do-you-recognize-legacy-code-mid)
- [Q6 — Characterization vs. specification tests (mid)](#q6--characterization-vs-specification-tests-mid)
- [Q7 — The legacy dilemma (mid)](#q7--the-legacy-dilemma-mid)
- [Q8 — First test on untestable code (mid/senior)](#q8--first-test-on-untestable-code-midsenior)
- [Q9 — Legacy code vs. technical debt (mid/senior)](#q9--legacy-code-vs-technical-debt-midsenior)
- [Q10 — Which legacy code do you cover first? (senior)](#q10--which-legacy-code-do-you-cover-first-senior)
- [Q11 — Is legacy code a failure? (senior)](#q11--is-legacy-code-a-failure-senior)
- [Q12 — Behavior preservation and sequencing (senior)](#q12--behavior-preservation-and-sequencing-senior)
- [Q13 — When the tests themselves are the problem (senior)](#q13--when-the-tests-themselves-are-the-problem-senior)
- [Q14 — Rewrite vs. incremental (senior/staff)](#q14--rewrite-vs-incremental-seniorstaff)
- [Q15 — Selling legacy work to stakeholders (staff)](#q15--selling-legacy-work-to-stakeholders-staff)
- [Q16 — Key-person risk (staff)](#q16--key-person-risk-staff)
- [Q17 — Reducing legacy inflow (staff)](#q17--reducing-legacy-inflow-staff)
- [Q18 — Coverage metrics and gaming (staff)](#q18--coverage-metrics-and-gaming-staff)

---

## How to use this bank

Each entry gives the question, the level it targets, a strong model answer, what a weak answer looks like, and follow-ups an interviewer would push on. Read the model answers for *substance*, not memorization — interviewers probe, and a recited definition collapses under the first "why?". The questions progress from junior to staff.

---

## Q1 — Define legacy code (junior)

**Question.** What is legacy code?

**Model answer.** The most useful definition is Michael Feathers': *legacy code is code without tests.* The colloquial definition — "old code someone else wrote that nobody wants to touch" — feels right but isn't actionable; you can't make code younger or un-inherit it. Feathers' definition is actionable because it names the fixable problem: there's no automated, fast feedback telling you whether a change preserved behavior. The reason tests are the right axis is that they predict the *cost and risk of change* better than age, author, or even readability. Code with good tests can be changed safely no matter how ugly; code without them is "edit and pray" no matter how clean.

**Weak answer.** "Old code, usually badly written, that's hard to maintain." It's not wrong colloquially, but it gives the interviewer nothing to work with and suggests you haven't thought about *why* legacy code is painful or what to *do* about it.

**Follow-ups.** *Why is "no tests" better than "old"?* (actionability + predicts change cost). *So clean code can be legacy?* (yes, if untested). *What kind of tests count?* (fast, reliable, focused — feedback, not a coverage badge).

---

## Q2 — Can brand-new code be legacy? (junior)

**Question.** A teammate says, "I wrote this module this morning, so it can't be legacy." Are they right?

**Model answer.** No. Under Feathers' definition, *untested new code is born legacy.* The module is one day old, but if there are no tests, the next person who changes it — possibly the author next week — has no fast feedback about whether they broke it. It has the exact same disease as the twenty-year-old module: no safety net. This is the most important consequence of the definition, because it reframes legacy from a story about lazy predecessors into a neutral, present-tense engineering condition you can prevent. It's also why the highest-leverage way to fight legacy code is to stop minting it — ship new code with tests so it's never born legacy.

**Weak answer.** "Yeah, it's new so it's fine, legacy means old." This misses the entire actionable point of the definition.

**Follow-ups.** *How do you prevent code being born legacy?* (TDD, definition of done includes tests, CI). *Is that always worth it?* (mostly yes for code that will be changed; trivial throwaway scripts are an exception).

---

## Q3 — Edit and pray vs. cover and modify (junior)

**Question.** Explain "edit and pray" versus "cover and modify."

**Model answer.** *Edit and pray*: you read the code until you think you understand it, make your change, poke at the running app, and ship — *praying* there were no callers or edge cases you missed. It's the default whenever there's no safety net, and it pushes every mistake to the most expensive place to catch it: QA or production. *Cover and modify*: you first put tests *over* the area you're about to change — capturing how it behaves now — *then* modify, running the tests after each small step. A red test catches your mistake in seconds, while the change is fresh and easy to undo. Legacy code forces you into edit-and-pray; the entire discipline of working with legacy code is about earning the right to cover-and-modify.

**Weak answer.** Defining only "edit and pray" without the contrast, or describing testing generically without the *cover-first, then change, run after each step* sequence.

**Follow-ups.** *What if you can't cover it because it's untestable?* (the legacy dilemma — break dependencies first; see Q7). *How small should the steps be?* (small enough that a red test points right at what you just did).

---

## Q4 — Why does legacy code cost so much? (junior/mid)

**Question.** Why is legacy code expensive? Go beyond "it's hard to read."

**Model answer.** Three compounding costs. First, the **feedback gap**: with no tests, bugs are caught late — QA or production — where they cost roughly 20–100× a bug caught by a unit test, and they're tangled with other changes by the time you find them. Second, **fear**: untested code makes engineers avoid touching it and copy-paste around it rather than modify it, so cleanup doesn't happen and duplication accretes — fear literally makes good engineers leave the code worse. Third, **compounding**: the cost isn't linear. As the module grows, complexity rises (Lehman's law), original authors leave taking the undocumented spec with them, and each fearful clone multiplies future change cost. Because it compounds, "we'll add tests later" is usually a losing trade — later, the same code is bigger, more coupled, and less understood.

**Weak answer.** "It's messy and hard to understand." True but shallow; misses feedback, fear, and especially the *compounding* shape that drives strategy.

**Follow-ups.** *Why does compounding matter for strategy?* (cover code the next time you touch it — cheapest it'll ever be). *Quantify the feedback gap.* (unit test 1× → production ~100×).

---

## Q5 — How do you recognize legacy code? (mid)

**Question.** Beyond "check if there are tests," how do you spot legacy code and predict the work involved?

**Model answer.** The formal check is the absence of fast, reliable tests, but I also pattern-match on *tells* that predict untestability and pain: hard-wired dependencies (`new Database()`, `DateTime.now()`, singletons inside business logic), long methods doing many things, side-effect-only methods with no clear inputs/outputs, "DO NOT TOUCH" folklore, copy-paste clusters and commented-out code, and recurring bugs. Then I locate the code on an *untestability spectrum*: a pure function is testable right now; a function that takes its dependencies as arguments just needs a fake; a function that constructs dependencies internally needs a seam introduced first; and code driven entirely by global state needs dependency-breaking surgery before the first assertion. Where it sits on that spectrum is half the estimate for getting it under test.

**Weak answer.** Listing surface smells without connecting them to *testability* or to estimating the work.

**Follow-ups.** *What's the cheapest case and the most expensive?* (pure fn vs. global-state/side-effect-only). *What's a seam?* (a place to alter behavior without editing in line — covered in the seams topic).

---

## Q6 — Characterization vs. specification tests (mid)

**Question.** What's the difference between a characterization test and a specification test, and which dominates legacy work?

**Model answer.** A *specification test* asserts what the code *should* do, derived from requirements — you write it from the spec. A *characterization test* asserts what the code *currently does*, whatever that is, including quirks and possibly bugs — you write it by observing the running code and pinning its actual outputs. Legacy work leans heavily on characterization because when you inherit untested code, you usually *don't know what it's supposed to do* — the spec is lost and the original author is gone. The production behavior *is* the de facto specification; customers depend on it, quirks included. So you pin current behavior first to get a safety net, then change behavior *deliberately* — with a failing-then-passing test that proves the change was intended — rather than accidentally. Characterization tests are how you separate intended changes from accidental ones.

**Weak answer.** Reversing the two, or claiming you should only ever pin "correct" behavior. The point of characterization is that you pin *actual* behavior precisely because you don't yet know what's correct.

**Follow-ups.** *You pin a bug — now what?* (it's a correct transitional state; fix it later with a deliberate failing test; flag it so the pin doesn't ossify the bug). *How do you discover the current behavior if it's unclear?* (drive the code, observe outputs, even record production inputs/outputs).

---

## Q7 — The legacy dilemma (mid)

**Question.** Describe the central dilemma of working with legacy code. Why aren't you permanently stuck in it?

**Model answer.** To change code safely you want tests; but the code is often untestable *as written* — it reaches out to a database, a clock, or a network, hard-wired connections a test can't supply. To get it under test you must first *change* it to loosen those connections — and changing untested code is the very thing you were trying to make safe. So you need tests to change safely, but you need to change to add tests. You're not permanently stuck because there are *very small, mechanical, well-known changes* — introducing a seam, extracting a pure function, parameterizing a constructor — that are safe enough to do by hand or with automated IDE refactorings *without* tests yet, just enough to slip the first test into place. Once one test is in, you have a foothold and expand from there.

**Weak answer.** Stating the circularity but not resolving it, or claiming you simply "refactor first" without acknowledging that refactoring untested code is itself risky and must be done in minimal, safe steps.

**Follow-ups.** *What makes a change "safe enough" to do without tests?* (small, mechanical, ideally an automated IDE refactoring with known semantics). *Name one such enabling change.* (extract pure function, introduce parameter, subclass-and-override seam).

---

## Q8 — First test on untestable code (mid/senior)

**Question.** Here's a function. How do you get it under test?

```python
def notify_overdue_invoices():
    cur = connection.cursor()                      # module-global DB
    rows = cur.execute("SELECT ... WHERE paid=0").fetchall()
    for inv_id, email, due, amount in rows:
        if due < datetime.now():                   # real clock
            server = smtplib.SMTP("smtp.company.com")  # real network
            server.sendmail("billing@co", email, f"Invoice {inv_id} overdue")
            cur.execute("UPDATE ... SET reminded=1 WHERE id=?", (inv_id,))
    connection.commit()
```

**Model answer.** As written it's at the hard end of the spectrum: three hidden dependencies — a live database (module global), the real clock (`datetime.now()`), and a real SMTP server — so any test needs a DB, behaves differently by date, and sends real email. I don't try to test it whole. I *separate the decision from the side effects* and *pass dependencies in*. Extract the pure decision — "which invoices are overdue?" — into a function taking `(invoices, now)` and returning a list; that's instantly testable with a deterministic `now` and in-memory data, no DB, no network. The body becomes a thin shell `notify(repo, mailer, now)` that loops over the pure result and calls injected `repo`/`mailer` collaborators, which I can fake. The messy I/O still exists but is pushed to the edges, and the *logic* — the part that actually has bugs — is fast and pinned.

```python
def overdue_invoices(invoices, now):
    return [i for i in invoices if not i.paid and i.due_date < now]

def test_only_unpaid_past_due():
    now = datetime(2026, 6, 11)
    invs = [Invoice(1, paid=False, due_date=datetime(2026, 6, 1)),
            Invoice(2, paid=True,  due_date=datetime(2026, 6, 1)),
            Invoice(3, paid=False, due_date=datetime(2026, 7, 1))]
    assert [i.id for i in overdue_invoices(invs, now)] == [1]
```

**Weak answer.** "Mock the database and SMTP and call the whole function." Mocking everything in place is brittle, asserts little, and leaves the logic entangled with I/O. The better move is to *extract the decision* so the valuable logic is testable without mocks at all.

**Follow-ups.** *Why pass `now` instead of mocking the clock?* (determinism, simpler, no patching). *How do you test the I/O shell?* (fake repo/mailer collaborators; a couple of integration tests at the seam). *Did behavior change?* (no — pure extraction; that's the point).

---

## Q9 — Legacy code vs. technical debt (mid/senior)

**Question.** Are "legacy code" and "technical debt" the same thing?

**Model answer.** Related but distinct. *Technical debt* is the broad accumulated cost of past compromises — bad architecture, outdated dependencies, missing docs, *and* missing tests — and it can be taken on deliberately. *Legacy code* specifically means code without tests. The relationship: missing tests are one *form* of technical debt, and arguably the highest-interest form, because without tests you can't safely pay down *any other* debt. Want to fix the bad architecture? You need tests first to refactor safely. Want to upgrade the framework? You need tests to confirm nothing broke. That's why "get it under test" is so often the first move in any debt-reduction effort — it unlocks safely paying down everything else.

**Weak answer.** Treating them as synonyms, or failing to explain *why* the testing gap is special among debts.

**Follow-ups.** *If you had to pay down one debt first, which?* (tests, because they make the rest safe). *Is all legacy code bad debt?* (no — stable, low-risk untested code may be fine to leave; testing it is gold-plating).

---

## Q10 — Which legacy code do you cover first? (senior)

**Question.** You can't test the whole legacy system. How do you decide where to invest?

**Model answer.** Triage on two dimensions: **change frequency** (churn, from `git log`) and **risk** (blast radius plus incident history). The worst asset in the portfolio — and the first coverage dollar — is code that's both *frequently changed* and *frequently implicated in incidents*; tests there pay back almost immediately. High-churn/low-risk is an easy win. Low-churn/high-risk I cover *opportunistically*, right before the rare change. Low-churn/low-risk I deliberately leave alone — testing stable harmless code is gold-plating. The operational heuristic is to **let change requests pull tests into existence**: when a ticket forces me to touch a legacy area, that's the signal to cover *that slice* first, so I get tested code exactly where the system is proving it needs to change, and I ratchet coverage up on every visit.

**Weak answer.** "Aim for 80% coverage everywhere." Untargeted coverage goals produce assert-nothing tests on code that doesn't matter while the hard, scary code stays uncovered.

**Follow-ups.** *Where does the data come from?* (churn from git, risk from postmortems). *Defend leaving ugly code untested.* (if it's stable and never breaks, the ROI is near zero; spend effort on churn × risk).

---

## Q11 — Is legacy code a failure? (senior)

**Question.** Does the existence of legacy code mean a team did something wrong?

**Model answer.** Usually not — legacy code is the *normal, healthy condition of software that's actually used.* Lehman's laws capture why: software in real use *must* keep changing or it becomes less useful (continuing change), and as it changes its complexity *increases* unless you spend deliberate effort to reduce it (increasing complexity). Put together, all successful software trends toward legacy; only dead software stays clean and finished. So the goal is never "have no legacy code" — that's only achievable by being unused. The goal is to get good at *working with* it: bringing untested code under feedback as you touch it, and spending continuous counter-force (tests, refactoring, tidying) against the entropy Lehman guarantees. A team that ships only features and never that counter-force is *guaranteed* to build an ever-more-legacy system — that's the actual failure mode, not the existence of legacy code itself.

**Weak answer.** "Yes, good teams don't have legacy code." False and reveals inexperience — every long-lived successful system has legacy code.

**Follow-ups.** *State two of Lehman's laws.* (continuing change; increasing complexity). *What's the counter-force?* (deliberate, ongoing tests/refactoring/tidying).

---

## Q12 — Behavior preservation and sequencing (senior)

**Question.** Why is it a rule that you change *nothing* about behavior — bugs included — while making legacy code safe?

**Model answer.** Because legacy work mixes two activities that must not be confused: making the code *safe to change*, and *changing what it does*. If you conflate them — "I'll add a seam, extract a function, and fix this rounding bug in one commit" — and an incident follows, you can't tell which activity caused it; you've lost the ability to bisect intent. Worse, you changed behavior with no test proving the change was intended, which is edit-and-pray wearing a refactoring costume. The discipline is sequencing: commit A adds characterization tests (behavior unchanged); commit B extracts/refactors (tests still green, behavior unchanged); commit C adds a *failing* test for the corrected behavior, then makes it pass. Now any incident bisects to exactly one intentional change, and every behavioral change is backed by a test that proves intent.

**Weak answer.** "You should fix bugs while you're in there to save time." Tempting and wrong — it's exactly the conflation that makes legacy incidents un-diagnosable.

**Follow-ups.** *Isn't separate commits slower?* (marginally; it buys diagnosability and safety, which is cheaper than one un-bisectable outage). *What if the bug is urgent?* (still sequence — pin first, then the deliberate failing-test fix; the safety step is minutes).

---

## Q13 — When the tests themselves are the problem (senior)

**Question.** A module has a green coverage badge but engineers still fear changing it. How is that possible, and is it legacy?

**Model answer.** Coverage measures lines executed, not feedback delivered. Tests can be slow, flaky, or so coupled to implementation that they break on every refactor and assert little about behavior. Those tests are *red noise* — they don't tell you "green means safe," so they provide no real feedback, and the code is *effectively legacy* despite the badge. The definition's spirit is "fast, reliable feedback," not "a file named `*_test`." Sometimes you have to bring the *test suite itself* under control — make it fast and deterministic, decouple it from implementation details, delete tests that only assert internals — before the production code is genuinely safe to change. A high coverage number with high fear is a signal the tests are testing the wrong thing.

**Weak answer.** "If it has coverage it's not legacy." Naive — it equates a metric with the property it's a poor proxy for.

**Follow-ups.** *What makes a test give real feedback?* (fast, reliable, asserts behavior not implementation, fails near the cause). *How do you fix flaky tests?* (remove nondeterminism — clocks, ordering, shared state; covered in dependency-breaking).

---

## Q14 — Rewrite vs. incremental (senior/staff)

**Question.** An engineer proposes rewriting a working-but-untested legacy service from scratch. How do you respond?

**Model answer.** My first response is "show me the characterization tests for the current behavior." The legacy system encodes years of accumulated edge cases, bug fixes, and business rules that exist *nowhere but the running code* — that's *why* it's legacy, the spec is lost. A rewrite from a clean spec inevitably omits them, passes its shiny new tests, and then fails in production on the thousand undocumented cases the old system silently handled. Meanwhile delivery freezes for months and the team maintains two systems. The safe path is almost always incremental: characterize the old behavior (its outputs *are* the spec and double as the acceptance suite for any replacement), then strangle it — route one slice of traffic at a time to the new implementation, ideally parallel-running and diffing old-vs-new on real traffic before each cutover. Rewrite-from-scratch is genuinely correct only when the platform is truly dead, the behavior is genuinely obsolete, or the system is small — rarer than ambitious engineers want.

**Weak answer.** "Yeah, the old code is bad, let's rewrite it clean." This is the single most expensive endorsement a senior gives; it throws away the only durable record of real behavior before extracting it.

**Follow-ups.** *What's the strangler pattern?* (grow new around old, route incrementally, retire old paths). *How do you de-risk cutover?* (parallel-run and diff outputs on production traffic — a continuous characterization test).

---

## Q15 — Selling legacy work to stakeholders (staff)

**Question.** Product won't fund "paying down tech debt." How do you get legacy work resourced?

**Model answer.** You stop asking for debt paydown and start framing it as *enabling a business outcome they already want.* "We should refactor billing" loses; "we can't safely ship the new pricing tier until billing is changeable, and here's the smallest path" wins. I attach the coverage work as the *first step* of a funded feature rather than a standalone project, and I bring data: cycle time by module ("changes here take 4 days vs. 1 elsewhere — that premium times ~30 changes a quarter is ~90 engineer-days of pure interest") and incident history. Crucially, I'm honest about where edit-and-pray is actually the cheaper expected bet — for low-churn, low-risk changes it sometimes is. Spending that credibility selectively is what makes stakeholders trust me when I insist coverage is non-negotiable for the high-stakes change. And once one coverage investment delivers and the *second* change in that area gets dramatically cheaper, that demonstrated payback funds the next initiative.

**Weak answer.** "Explain that tests are good engineering practice." Stakeholders don't fund virtue; they fund outcomes and respond to the cost of *inaction* quantified.

**Follow-ups.** *What metrics convince a VP?* (cycle time and change-failure rate by module — not coverage %). *When do you concede edit-and-pray?* (low churn + low risk + no funded change pulling at it).

---

## Q16 — Key-person risk (staff)

**Question.** Only one engineer understands a revenue-critical, untested batch job. How do you treat this?

**Model answer.** As a live incident waiting for a trigger — resignation, illness, a vacation during an outage. Untested code stores its behavioral contract nowhere durable: in the author's memory, stale comments, and uncharacterized production behavior. So a single owner of untested critical code means the system has a load-bearing human and the spec lives in their head. The mitigation is to characterize the behavior into executable tests *while that person is still present to confirm the pinned outputs are correct* — their presence is what makes the pins trustworthy; the expert plus the code is the only complete copy of the spec. I maintain a risk register of modules that are "untested + single-owner + high-stakes" and spend characterization effort there proactively, not after the resignation letter lands. Done before the countdown, it's calm engineering; done during a four-week notice period, it's a stressful scramble that captures only part of the contract.

**Weak answer.** "Write documentation" or "have them do a knowledge-transfer session." Prose docs rot and KT talks evaporate; executable characterization tests are the durable form of the knowledge.

**Follow-ups.** *Why tests over docs?* (executable, don't rot, run in CI, double as a safety net). *What's the risk register entry?* (module, owner count, stakes, coverage state).

---

## Q17 — Reducing legacy inflow (staff)

**Question.** Your team covers old code but keeps creating new untested code. What's the leverage move?

**Model answer.** Treat it as a *flow* problem, not just a *stock* problem — no cleanup wins against a team that mints new legacy faster than it covers old. Since untested new code is *born legacy*, prevention is simply not shipping untested code: a definition of done that includes tests, TDD so code is born covered, CI running the suite on every push, and code review that treats "where are the tests?" as a normal, non-negotiable question. The staff job is to make these the *path of least resistance* rather than individual heroism — because if doing the right thing requires heroism, it won't survive deadline pressure and the inflow continues. I'd also fix the incentive layer: if the org rewards only shipping and punishes the breakage untested code makes inevitable, engineers will rationally keep cutting tests. Reward the safety that enables future shipping, and run blameless postmortems so people are brave enough to improve code rather than fearfully preserve it.

**Weak answer.** "Tell everyone to write more tests." A mandate without making testing frictionless and without fixing the incentives that reward skipping them changes nothing.

**Follow-ups.** *Stock vs. flow — why does flow dominate?* (compounding inflow outpaces linear cleanup). *One concrete inflow control?* (CI gate / definition of done / review norm).

---

## Q18 — Coverage metrics and gaming (staff)

**Question.** Leadership wants to mandate 80% test coverage. Good idea?

**Model answer.** Global coverage targets are the metric leaders reach for and the one that misleads most. They get gamed: engineers write tests that *execute* lines without *asserting* behavior to hit the number, on code that doesn't matter — while the hard, scary, high-stakes code stays uncovered precisely *because* it's hard. Coverage measures lines run, not feedback delivered. The better mandate is a *ratchet on changed code*: coverage on the lines a PR touches may not decrease. You don't demand 80% globally; you demand every change leaves its slice better tested than it found it. Because hot code is changed often, it converges to well-covered over time — and hot code is the only code that matters. I'd pair that with second-order signals leadership should actually watch: cycle time and change-failure rate *by module*, and a churn × complexity × low-coverage hotspot map, which point at the real legacy liabilities far better than a single global percentage.

**Weak answer.** "Yes, 80% is industry standard." Cargo-culting a number; ignores gaming, misallocation, and that coverage is a weak proxy for feedback.

**Follow-ups.** *What does the ratchet do over time?* (converges hot code to covered without gold-plating stable code). *What metrics beat coverage %?* (cycle time and change-failure rate by module; hotspot maps; bus factor on critical modules).
