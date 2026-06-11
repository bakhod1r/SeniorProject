# Automated Safety Nets for Refactoring — Interview

> **Source:** Michael Feathers, *Working Effectively with Legacy Code*; Martin Fowler, *Refactoring* (2nd ed.)

Fourteen questions, from the core thesis to the sharp trade-offs. Model answers show the reasoning a senior is expected to give, not just a definition.

---

### Q1. Why can't you guarantee a refactoring preserved behavior just by reviewing the diff carefully?

**Model answer.** Because a non-trivial unit does far more than the two or three things you're holding in your head; the edit can change a path you didn't even know existed (a locale branch, an overflow case, an exception type). Refactoring's correctness condition — "observable behavior unchanged" — is a statement about *all* inputs, and human review samples a few. The only practical way to make a refactoring safe is an automated net that *detects* a behavior change and fails loudly. The discipline's confidence comes from the net, not from carefulness.

---

### Q2. State the relationship between the safety net and how bold a refactoring you can attempt.

**Model answer.** Directly proportional: the richer and more trustworthy the net, the bolder the refactoring. With no net you make tiny, timid changes and pray; with a strong net you can restructure aggressively and *know* within seconds if you broke something. The trapeze analogy is exact — the net is what lets the artist attempt the hard move. The corollary: a net you don't trust (flaky, or full of holes) is worse than none, because it invites the bold move and then fails to catch you.

---

### Q3. What is the difference between a unit test and a characterization test?

**Model answer.** A unit test asserts what the code *should* do — it encodes **intent**, written by someone who knows the requirement. A characterization test asserts what the code *currently does* — it pins **actual behavior, bugs included**, and is used when you *don't* know the intent (legacy code, no spec). The give-away: in a characterization test you often write a deliberately wrong expectation, run it, read the actual value from the failure, and paste it back in. You'd never do that for a unit test, where you assert the value you *want*. Unit tests verify correctness; characterization tests verify *unchangedness*.

---

### Q4. Why would you deliberately pin a *bug* in a characterization test? When do you fix it?

**Model answer.** Because refactoring means "change structure, not behavior," and the current behavior *includes* the bug. If my characterization test asserted the *correct* value instead of the actual one, it would fail before I changed anything, and I couldn't use it to verify my refactoring. So I pin reality, refactor under that net, and confirm I changed nothing. The bug fix is a *separate, deliberate* change afterward: I edit the production code *and* the assertion together, with a commit message that says "fix," so the behavior change is explicit and reviewed — not smuggled in under a refactor.

---

### Q5. What is the golden master technique, and when do you reach for it over plain `assertEquals`?

**Model answer.** Golden master is characterization at scale: instead of asserting individual values, you capture the code's entire output over a wide input sweep into an "approved" file, then diff future runs against it. You reach for it when the output is too large or numerous to hand-assert — a 2,000-line report, a rendered page, 36 input combinations of a calculator. One `Approvals.verify(...)` then pins the whole behavior. The trade-off is brittleness: it pins *everything*, including noise, so you must scrub non-determinism and read every diff before approving.

---

### Q6. Walk me through building a net for legacy code you must refactor but that has no tests.

**Model answer.** (1) Find a **seam** — a place to sense behavior without changing the code path (a return value, or an injectable dependency capturing the effect). (2) Write a characterization/golden-master test: drive the code over a wide input space, capture the actual output, approve it. Pin observable effects (rows written, response produced), never internal call order. (3) If the stakes are high, run **mutation testing on the new characterization suite** to confirm it has teeth — surviving mutants mean the net has holes; patch them. (4) Only now refactor, in small steps, green bar after each. (5) Fix any real bugs deliberately, afterward, updating assertions to the new intended behavior.

---

### Q7. What problem does mutation testing solve that coverage does not?

**Model answer.** Coverage measures which lines *ran*; it says nothing about whether a failure would be *caught*. You can have 100% line coverage with assertion-free tests that catch zero regressions. Mutation testing measures *catch*: it injects small bugs (mutants) and checks whether a test fails. A **surviving mutant** is a real behavior change your suite wouldn't notice — a concrete hole in the net. So mutation testing is "who tests the tests": it's the only automated measure of net *quality*, where coverage only measures net *reach*.

---

### Q8. Tools: name a mutation tester for the JVM and for JS, and one cost-control technique.

**Model answer.** PIT (pitest) on the JVM, Stryker for JS/TS (Stryker.NET for .NET, mutmut for Python). The cost is `mutants × suite_runtime`, so the key control is **scoping**: run incrementally on the diff (`--since`, PIT `--withHistory`), or target the single module you're about to refactor, or schedule a nightly run on critical packages — never a full-repo mutation run on every commit. And don't chase 100% score; the last few percent are usually equivalent mutants that can't be killed.

---

### Q9. A team mandates "90% coverage to merge." What goes wrong?

**Model answer.** Goodhart's law: when the measure becomes the target it stops measuring the thing. The cheapest way to hit 90% is assertion-free tests that execute lines without checking anything — coverage rises, the net does not, and you've added maintenance burden with zero protection. A false net: green, high-coverage, catches nothing. Better: use coverage as a *signal* — flag drops and uncovered new code in review — and measure real net quality with mutation score on the modules that matter. And read tests in review, because no tool detects a weak assertion.

---

### Q10. When is a snapshot/approval test a liability rather than a net?

**Model answer.** Two cases. **Rubber-stamping:** the net's value is the human reading the diff before approving; under deadline people run `jest -u` blindly and the snapshot then pins whatever the code does — including the bug just introduced. The net silently records the regression as correct. **Brittle/oversized snapshots:** a snapshot of a whole page fails on any cosmetic change (a CSS rename, a timestamp), training the team to slam "approve" until a real change slips through. Fixes: snapshot the smallest meaningful unit, scrub non-determinism, and review `.approved` diffs like production code.

---

### Q11. What are property-based tests, and why are they especially good for refactoring?

**Model answer.** Instead of fixed example pairs, you assert an **invariant that must hold for all inputs** — "decode(encode(x)) == x", "cost is monotonic in weight", "result is always sorted" — and the framework generates thousands of inputs and shrinks any failure to a minimal counterexample. They're powerful for refactoring because an invariant is independent of implementation: you can rewrite the code completely and the property still holds or it doesn't, catching whole classes of regression no single example would. The model/oracle variant — "the new implementation always agrees with the old one" — is the strongest net for an algorithm rewrite.

---

### Q12. How does test flakiness damage a safety net specifically?

**Model answer.** A net's entire value is *trust*: red must mean "you broke behavior." A flaky test makes red sometimes mean "just noise," so engineers rationally re-run until green and stop reading failures — at which point a real regression looks like flakiness and sails through. Flakiness doesn't just weaken one test; it dissolves the authority of the whole gate. The discipline is zero tolerance in the gating suite: quarantine on sight, fix the determinism (inject a clock, kill shared state, poll instead of sleep), never leave it "for now."

---

### Q13. Describe the net's layers from cheapest to richest, and how you choose among them.

**Model answer.** Compiler/static types (free, instant, coarse) → fast unit tests (cheap, intent-based) → characterization/approval tests (medium, pin actual behavior) → contract tests (boundary net across services) → property-based tests (invariants over many inputs) → mutation testing (expensive, measures the net). You pick the **cheapest layer that catches the mistake you actually fear**: a typed rename needs only the compiler; a tested unit's existing unit tests suffice for an extract; untested legacy needs characterization first; two independently-deployed services need contract tests; an algorithm rewrite wants property/oracle tests. Richness should be proportional to the boldness and blast radius of the change.

---

### Q14. Give three examples of a net that *blocks* the refactoring it was meant to enable.

**Model answer.** (1) **Over-pinning** — characterization tests that assert private fields, exact log lines, or internal call order fail on a legitimate restructuring; the fix is to pin observable behavior only. (2) **Brittle snapshots locking in noise** — a snapshot including a timestamp/UUID fails every run for non-behavioral reasons, so people stop trusting it. (3) **Over-mocked tests** — a test that mocks the very collaborator you're refactoring asserts the *old* interaction shape and breaks when you change the design, even though behavior is identical. In all three, the net has inverted its purpose; the right response is to fix or delete it, because a net that prevents good refactoring has failed at its one job.

---

### Bonus: the one-liner they want

"Refactoring is only safe if a behavior change would be **detected automatically, quickly, and loudly** — and the richer that net, the bolder you can refactor. Everything else is choosing the cheapest layer that catches the mistake you fear, and measuring (with mutation testing) that the net actually has teeth."
