# The Three Laws of TDD — Interview Questions

> **Category:** [Craftsmanship Disciplines](../README.md) — write production code only to make a failing test pass, in the tightest possible loop.

Conceptual and coding questions, graded junior → professional, plus trick and behavioral questions.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. State the three laws of TDD.

**Answer:** (1) You may not write production code unless it's to make a failing unit test pass. (2) You may not write more of a test than is sufficient to fail — and a compilation failure counts as a failure. (3) You may not write more production code than is sufficient to pass the current failing test.

### J2. What is the red-green-refactor cycle?

**Answer:** **Red** — write a small failing test and watch it fail. **Green** — write the minimum code to make it pass. **Refactor** — clean up the code while all tests stay green. Then repeat.

### J3. Why must you see the test fail before writing the code?

**Answer:** A test you've never seen fail might be asserting nothing real or testing the wrong thing. Watching red turn green proves the test actually exercises the new behavior. A test-first that passes on the very first run is suspicious.

### J4. What's the minimum code to pass `assert add(2, 3) == 5`?

**Answer:** `return 5`. By Law 3 it's the literal minimum for the *current* test. You generalize to `a + b` only when a second test forces it ("fake it till you make it").

### J5. In which phase may you improve code structure?

**Answer:** Only in **refactor**, and only while all tests are **green**. Never restructure on red.

### J6. Why does "compilation failure counts as failure" matter?

**Answer:** In compiled languages, a test referencing a not-yet-written function won't compile — and that compile error is a valid red. So you can reach red, and must stop writing test, before even finishing a full assertion.

### J7. What is "fake it till you make it"?

**Answer:** Returning a hard-coded value to pass the first test, then generalizing only when a second test forces you. It proves your tests are strong enough to demand the real implementation.

### J8. How many failing tests should you have at once?

**Answer:** Exactly one. Law 2 lets you write only enough test to fail; a batch of failing tests means you've over-written the test step.

### J9. What's a good unit test name?

**Answer:** One that describes the behavior, e.g. `test_withdraw_rejects_overdraft`, not `test_withdraw_2`. A failing test name should read like a one-line bug report.

### J10. How do you use TDD to fix a bug?

**Answer:** Write a failing test that reproduces the bug first, then make the minimum change to pass it, then refactor. The failing test proves the fix works and becomes a permanent regression guard.

---

## Middle Questions

### M1. Distinguish the nano-cycle, micro-cycle, and macro-cycle.

**Answer:** Nano = one red→green flip (seconds), governed by the three laws. Micro = a full red→green→refactor (minutes). Macro = a whole feature (hours), usually opened by a failing acceptance test. The laws live in the nano-cycle.

### M2. Name the three strategies for getting to green.

**Answer:** **Fake it** (hard-code the answer when unsure), **obvious implementation** (write it directly when confident and trivial), **triangulation** (add examples to force the generalization). Confidence picks which.

### M3. Why does the speed requirement of the loop lead to mocking?

**Answer:** The nano-cycle must run in seconds. Real DB/network/filesystem calls are too slow, so you substitute fast doubles at the boundary to keep the loop fast.

### M4. What should you *not* mock?

**Answer:** Value objects and simple, fast, deterministic logic — use the real thing. Mock only slow/external/non-deterministic boundaries or cases where the *interaction* is the behavior. Over-mocking yields tests that pass while the system is broken.

### M5. You wrote a test and it passed on the first run. What do you do?

**Answer:** Distrust it. Temporarily break the production code to confirm the test goes red, then restore. If it stays green when the code is broken, the test asserts nothing.

### M6. Why is writing ten parametrized cases at once a Law-2 violation?

**Answer:** Law 2 permits only enough test to fail — one failing test at a time. Ten cases is ten failing tests. Keep a test list and write them in one at a time, collapsing to a parametrized table during refactor.

### M7. What does "refactor on green" protect you from?

**Answer:** If you refactor on red, a failure could mean either "my refactor broke it" or "the feature isn't done yet" — you can't tell which. Green means any new failure is unambiguously caused by the refactor.

### M8. How do you choose which test to write next?

**Answer:** Degenerate case first (empty/zero/null), then simplest non-trivial, ordered so each step is the smallest possible code jump. Save the general/hard case for last, after triangulation has built most of the implementation.

### M9. Is mocking part of the three laws?

**Answer:** No. The laws never mention mocking. The *speed* requirement of the nano-cycle creates the pressure to isolate slow boundaries — mocking is downstream of the laws, not part of them.

### M10. What does the refactor step include besides production code?

**Answer:** The tests themselves — deduplicate and clean the test code on green, including removing duplicated knowledge between the test and the code.

---

## Senior Questions

### S1. What actually differs between TDD and test-after, given both can hit high coverage?

**Answer:** Three things test-after can't match: (1) every test has been seen to fail, so it's trustworthy; (2) the design is shaped by the test (the test is the first client), biasing toward decoupling; (3) you write only code the tests demand, guarding against speculative over-engineering. Coverage is achievable either way — the edge is trust and design.

### S2. Explain "design pressure" and "tests as the first client."

**Answer:** To write a test first you must decide the name, return type, and dependencies before any code exists. Code that's hard to test-first is usually hard to use — hidden dependencies, too many responsibilities. The test surfaces those problems early and pushes toward injectable, decoupled designs. TDD doesn't just verify design — it generates it.

### S3. What is double-loop (outside-in) TDD?

**Answer:** An outer loop driven by a failing acceptance test describing user-visible behavior, and an inner loop of unit-test red-green-refactor (the three laws) that drives implementation until the acceptance test passes. Outside-in discovers collaborators as mocks; inside-out (classicist) builds the domain first with state-based tests.

### S4. Contrast classicist and mockist TDD.

**Answer:** Classicist (Detroit) tests verify **state** (call it, assert the result) using real collaborators where possible. Mockist (London) tests verify **interactions** by mocking nearly every collaborator. Mockist localizes failures precisely but couples tests to implementation structure, making them brittle under refactoring. Default classicist; mock only true boundaries.

### S5. Summarize the "Is TDD Dead?" debate and where it landed.

**Answer:** DHH argued against test-first *dogma* and the mockist style, claiming it causes test-induced design damage; he favored fast tests against the real DB. Beck said TDD is contextual (great for algorithms, weak for UI) and that he's a classicist, not a universal mocker. Fowler reframed it as a debate about mock overuse, not test-first. Synthesis: self-testing code is required; test-first is a strong default not a religion; most "TDD damage" is actually mock damage; integration tests have a real, large role.

### S6. What is test-induced design damage, and how do you avoid it?

**Answer:** Structural complexity added to production code purely for testability — single-implementation interfaces, services extracted only to isolate units, DI threaded where nothing else needs it, logic pushed to awkward seams. Avoid it with classicist testing of sociable units; mock only genuine boundaries. The distortion comes from mockist isolation, not from test-first itself.

### S7. When do the three laws hurt?

**Answer:** Exploratory spikes (you don't know the design — spike, learn, delete, then TDD), UI/pixel work (behavior isn't cheaply assertable), throwaway prototypes, highly concurrent timing code (use race tools), settled designs (the design-discovery benefit is spent), and pure glue with no logic.

### S8. Distinguish "the three laws" from "TDD as a discipline."

**Answer:** The laws are the *mechanics* — when you may write test vs. code, keep the loop tight, refactor on green. The discipline is the *judgement* — what to test (behavior not implementation), how to design tests, whether/how much to mock, when to relax. You can obey all three laws and still write a terrible suite. The laws are the metronome; the discipline is the music.

---

## Professional Questions

### P1. Where do the three laws sit in CI/CD and the test pyramid?

**Answer:** At the base — fast, isolated unit tests, run in seconds on the dev machine and gating every merge in CI. Integration and acceptance tiers sit above. The laws are only sustainable on a healthy pyramid with a fat, fast unit base; an inverted "ice cream cone" makes the nano-cycle impossible.

### P2. Why is a coverage *target* harmful, and what do you measure instead?

**Answer:** Goodhart's Law — mandating a coverage number produces assertion-free tests that hit the number and verify nothing. TDD makes coverage high as a *side effect*; targeting it directly inverts the value. Measure suite quality with **mutation testing**, watch unit-suite wall-clock time, escaped-defect rate, and flaky-test rate. Use coverage only as a floor and drop-detector.

### P3. What is mutation testing and why does it matter here?

**Answer:** A tool makes tiny changes to production code (flip `<` to `<=`, remove `+`) and runs the tests; surviving mutants reveal behaviors the suite doesn't actually verify. Unlike coverage (which measures whether code *ran*), mutation score measures whether tests *catch bugs* — the true audit of whether a TDD'd suite has teeth.

### P4. How do you apply TDD to legacy code with no seams?

**Answer:** You can't start with the laws. First write **characterization tests** (test-after) to pin current behavior; then introduce a **seam** (extract method, inject a parameter, wrap a static call) to get the unit under test; *then* the three laws apply for the new behavior. Trying to "just TDD" untestable legacy is how teams wrongly conclude TDD doesn't work.

### P5. What do you check in code review to keep TDD honest?

**Answer:** Tests assert behavior (no assertion-free coverage theater); tests check behavior not implementation/call sequences; new production logic has a corresponding new/changed test; tests are fast and isolated (DB tests are integration-tier); mocking limited to boundaries; behavioral test names; every bug fix has a failing-first regression test.

### P6. How would you roll out TDD to a skeptical team?

**Answer:** Fix the loop first (make the unit suite fast and non-flaky), start with "reproduce every bug as a failing test," teach the rhythm via katas and pairing/mobbing, gate new code while grandfathering legacy, and *avoid a coverage mandate*. A top-down "90% coverage Monday" decree breeds coverage theater and gets the tooling disabled.

### P7. Your "unit" suite takes 9 minutes. What's happening and why does it matter?

**Answer:** "Unit" tests have acquired DB/network dependencies. It matters because the nano-cycle requires seconds — at 9 minutes developers stop running tests locally and TDD dies. Fix: re-tier the slow tests into an integration suite, mock repositories in true unit tests, restore a sub-30-second unit run.

### P8. A module has 92% coverage but shipped a boundary bug. Explain.

**Answer:** Coverage measures execution, not verification — the "covering" tests ran the code but asserted little (a common test-after / coverage-mandate outcome). A mutation-testing run would expose the gap (low mutation score). The fix is behavior-asserting tests, not more coverage.

---

## Coding Tasks

### C1. TDD `factorial` from zero — show the first three steps (Python).

```python
# RED 1
def test_zero(): assert factorial(0) == 1
# GREEN 1 (fake it)
def factorial(n): return 1

# RED 2 — force generality
def test_one(): assert factorial(1) == 1     # still passes with return 1...
def test_three(): assert factorial(3) == 6   # this forces the real impl

# GREEN 2
def factorial(n):
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result
```

### C2. Spot why this test is worthless and fix it (Python).

**Before:**

```python
def test_process():
    process(order)        # no assertion — passes even if process is broken
```

**After:**

```python
def test_process_marks_order_complete():
    order = Order(status="pending")
    process(order)
    assert order.status == "complete"   # asserts the actual behavior
```

### C3. Fix a bug test-first (Go).

```go
// Bug: Discount can return a negative price for >100% discount.
// LAW 1+2: reproduce as a failing test first.
func TestPriceNeverNegative(t *testing.T) {
    if got := Discount(100, 200); got < 0 {
        t.Errorf("negative price: %v", got)
    }
}

// LAW 3: minimum fix.
func Discount(price, pct float64) float64 {
    d := price * pct / 100
    if d > price {
        d = price          // clamp
    }
    return price - d
}
```

### C4. Rewrite a mockist test as classicist (Java).

**Before (mockist — couples to call sequence):**

```java
@Test void chargesGateway() {
    var gw = mock(Gateway.class);
    new Checkout(gw).pay(order);
    verify(gw).charge(order.card(), order.total());  // asserts interaction
}
```

**After (classicist — asserts outcome via a fake):**

```java
@Test void successfulPaymentRecordsReceipt() {
    var gw = new FakeGateway(/* always succeeds */);
    Receipt r = new Checkout(gw).pay(order);
    assertThat(r.status()).isEqualTo(PAID);   // asserts behavior, survives refactor
}
```

### C5. Turn this hard-to-test code into test-first-friendly code (Python).

**Before — constructs its own dependency, untestable in ms:**

```python
class Report:
    def run(self):
        rows = PostgresConnection(os.environ["DB"]).query("...")
        return format(rows)
```

**After — inject the dependency; now a fast unit test exists:**

```python
class Report:
    def __init__(self, repo):
        self.repo = repo
    def run(self):
        return format(self.repo.recent_rows())

def test_report_formats_rows():
    report = Report(repo=FakeRepo(rows=[Row(1), Row(2)]))
    assert report.run() == "..."
```

---

## Trick Questions

### T1. "Do the three laws say to write all your tests first?"

**No.** The opposite. Law 2 forbids writing more test than enough to fail — one failing test at a time, interleaved with code. "Write all tests first" is a misconception; that's not TDD, it's just test-after with extra steps.

### T2. "Does following the three laws guarantee a good test suite?"

**No.** The laws are mechanics; they guarantee the loop, not the quality. You can obey all three and still write implementation-coupled, over-mocked, assertion-light tests. Good suites also need good test design and refactoring judgement.

### T3. "Is `return 5` to pass `add(2,3)==5` a cheat?"

**No — it's the technique.** "Fake it" is a deliberate first step (Law 3 minimum). It forces a second test to drive out the real implementation, proving your tests are strong. Jumping straight to `a + b` is fine *only* if you're confident (obvious implementation).

### T4. "Does TDD mean 100% coverage?"

**Roughly, as a side effect — but that's not the point.** TDD produces high coverage because every line was written to pass a test. Targeting coverage directly is harmful (Goodhart) and produces assertion-free tests. The value is trust and design, not the number.

### T5. "Did DHH prove TDD is dead?"

**No.** He argued against test-first *dogma* and the *mockist* style, not against testing. The debate with Beck and Fowler concluded that self-testing code is essential, test-first is a strong default, and most "TDD damage" is actually over-mocking damage. TDD is alive; the religion isn't.

### T6. "Can you TDD legacy code directly?"

**No.** Legacy code usually has no seams, so you can't write a unit test for it yet. You characterize current behavior (test-after), introduce a seam, get it under test, *then* TDD the change. The laws come last, not first.

---

## Behavioral Questions

### B1. Tell me about a time TDD improved a design.

**Sample:** "A report job constructed its own database connection and emailer, so it couldn't be unit-tested without real infrastructure. Writing the test first forced me to inject those dependencies. The test became a millisecond unit test — and as a bonus the class was now decoupled and reusable. That's when 'tests as the first client' clicked for me: the hard-to-test design was also a hard-to-use one."

### B2. Describe a time you decided *not* to TDD.

**Sample:** "I had to integrate a third-party SDK whose behavior I didn't understand. Writing tests first would have tested my guesses. I spiked it — wrote throwaway code to learn the API — then deleted the spike and TDD'd the real adapter against a fake of the now-understood interface. TDD's value is design discovery and trust; a spike had neither yet."

### B3. How would you handle a manager who mandates 90% coverage?

**Sample:** "I'd agree we want trustworthy tests and explain that a coverage *target* backfires — people hit the number with assertion-free tests, so the dashboard looks great while bugs ship. I'd propose we measure what we actually care about: mutation score on critical modules, escaped-defect rate, and fast feedback. Coverage stays as a floor and a drop-detector, not a target."

### B4. A teammate writes tests after the code and they all pass first try. Concern?

**Sample:** "My concern is that tests never seen failing might assert the wrong thing or nothing — a test-after suite accumulates tests that can't fail. I'd suggest a quick sabotage check: break the production code and confirm the test goes red. If it stays green, the test is worthless. Longer term, writing the failing test first removes the whole class of problem."

### B5. Tell me about a slow test suite you fixed.

**Sample:** "Our 'unit' suite had crept to 9 minutes because tests had quietly acquired DB dependencies, and the team had stopped running tests locally — TDD was effectively dead. I re-tiered the DB tests into an integration suite, introduced repository fakes for true unit tests, and got the unit run back under 30 seconds. The nano-cycle became possible again and local test-running resumed."

---

## Tips for Answering

1. **Recite the three laws cleanly** — interviewers test whether you know the exact wording, including "compilation failures count."
2. **Separate the laws (mechanics) from the discipline (judgement)** — it's the senior signal.
3. **Nail "see it fail first"** and *why* (a test never seen red is untrustworthy).
4. **Know the strategies:** fake it, obvious implementation, triangulation.
5. **Be balanced on the critiques** — name test-induced design damage and the "Is TDD Dead?" synthesis; don't evangelize blindly.
6. **On metrics, attack coverage-as-a-target** and offer mutation testing instead.
7. **On legacy, lead with characterization tests** — the laws come last.

---

[← Professional](professional.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Tasks](tasks.md)
