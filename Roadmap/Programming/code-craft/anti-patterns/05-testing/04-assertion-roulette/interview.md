# Assertion Roulette — Interview Q&A

> **Category:** [Testing Anti-Patterns](../README.md) → **Assertion Roulette** — *a test with many unlabelled assertions, so when one fails you cannot tell which — or why.*

A bank of 35+ interview questions and answers spanning definitions, the Eager Test relationship, the "one assert per test" myth, soft assertions, message discipline, and the trade-offs. Each answer models the reasoning a strong candidate gives. Use the `<details>` toggles to self-quiz: read the question, answer aloud, then expand.

---

## Table of Contents

1. [Fundamentals](#fundamentals)
2. [Eager Test & Root Causes](#eager-test--root-causes)
3. [The "One Assert per Test" Debate](#the-one-assert-per-test-debate)
4. [Cures & Mechanics](#cures--mechanics)
5. [Soft Assertions & Fail-Fast](#soft-assertions--fail-fast)
6. [Trade-Offs & Judgement](#trade-offs--judgement)
7. [Code-Reading](#code-reading)
8. [Rapid-Fire](#rapid-fire)
9. [Related Topics](#related-topics)

---

## Fundamentals

**Q1. Define Assertion Roulette.**

<details><summary>Answer</summary>

A test with many unlabelled assertions such that, when one fails, you can't tell *which* assertion failed or *why*. The failure report names a line or just says "assertion failed," so you "gamble" on which check blew up. Named by Gerard Meszaros in *xUnit Test Patterns*.
</details>

**Q2. Why is it called "roulette"?**

<details><summary>Answer</summary>

Because diagnosing the failure is a gamble: the test fired a barrage of assertions, the report tells you only that *one* of them failed (often just by line number), and you have to bet on which condition it was and why — re-reading the test body to reconstruct what should have been true.
</details>

**Q3. Isn't a test that catches the bug good enough? Why does it matter that it can't tell you which assertion failed?**

<details><summary>Answer</summary>

A test has two jobs: **detect** a regression and **localize** it. Roulette does the first and fails the second. Localization is where engineering time actually goes — an undiagnosable failure costs a context-switch into the test, a re-read of every assert, a hypothesis, and often a re-run with added logging. The value of a test is realized at failure time and is bounded by how fast it points to the cause.
</details>

**Q4. What's the cheapest fix for a roulette failure?**

<details><summary>Answer</summary>

Add a **descriptive message** to each assertion, or use an assertion library/matcher that prints actual-vs-expected automatically. This turns "assertion failed at line 48" into "trial days ==> expected: <14> but was: <30>" without restructuring anything.
</details>

**Q5. Why is `assertTrue(x)` worse than `assertEquals(expected, actual)`?**

<details><summary>Answer</summary>

`assertTrue(x)` only knows `x` was false — it has no values to show, so it prints "expected true, got false," which names nothing. `assertEquals` knows both values and prints `expected: <14> but was: <30>`, naming the discrepancy. Bare booleans discard the most useful diagnostic information.
</details>

**Q6. Is Assertion Roulette about having "too many assertions"?**

<details><summary>Answer</summary>

No. It's about **unlabelled assertions across multiple behaviors** producing an undiagnosable failure. Several *labelled* assertions about *one* outcome (e.g. the fields of one created object) are perfectly fine. The smell is the undiagnosable failure, not the plural assertion.
</details>

---

## Eager Test & Root Causes

**Q7. What is the Eager Test smell, and how does it relate to Assertion Roulette?**

<details><summary>Answer</summary>

An **Eager Test** is a single test method that verifies *many behaviors* at once (register, then login, then update profile). It's the **cause**; Assertion Roulette is the **symptom**. Cramming many behaviors into one method is precisely what produces a pile of unlabelled assertions under one test name. Fix the Eager Test (split by behavior) and the roulette usually disappears.
</details>

**Q8. Why do engineers write Eager Tests?**

<details><summary>Answer</summary>

It feels efficient — "while I've got this object built, let me check everything about it." Building fixtures is work, so reusing one fixture for many checks looks economical. It isn't: the apparent setup saving is dwarfed by the debugging cost when the bundled test fails undiagnosably, plus fail-fast masking of later behaviors.
</details>

**Q9. Besides obscuring which assert failed, what second problem does a long assert chain cause?**

<details><summary>Answer</summary>

**Fail-fast masking.** Most frameworks stop at the first failed assertion, so if assertions #2 and #5 are both broken, you only see #2. You fix it, re-run, then discover #5 — two round-trips for two bugs that were both visible from the start. The chain doesn't just obscure *which* failed, it *hides later failures entirely*.
</details>

**Q10. How do you spot an Eager Test in review quickly?**

<details><summary>Answer</summary>

Count the **Acts**. A test with more than one distinct operation (call `register`, then call `login`) almost always has more than one reason to fail. A single Act per test is the cleanest structural guard. Also: an "and" in the test name (`test_register_and_login`) is two tests wearing one name.
</details>

---

## The "One Assert per Test" Debate

**Q11. Is "one assertion per test" a good rule?**

<details><summary>Answer</summary>

It's a crude proxy that misleads as often as it helps. It over-splits cohesive multi-facet checks (tripling Arrange cost for no diagnostic gain) and says nothing about an Eager Test that has one assert per behavior across six behaviors. The better rule is **one *reason to fail* per test** — i.e., one behavior, which may legitimately need several assertions.
</details>

**Q12. State the principle that replaces it and why it's better.**

<details><summary>Answer</summary>

**One reason to fail per test** — the SRP of testing. It targets *behaviors*, not a surface count: it keeps cohesive facet-checks together (the invoice's subtotal/tax/total are one calculation) while correctly flagging Eager Tests. The test is a theorem with one conclusion; its name states the conclusion and its assertions verify it.
</details>

**Q13. Give an example where multiple assertions in one test is the *correct* design.**

<details><summary>Answer</summary>

After `transfer(a, b, 100)`: assert `a` decreased by 100, `b` increased by 100, and a ledger entry exists. That's *one* behavior (a valid transfer) with three coupled post-conditions. Splitting forces three identical Arrange blocks and loses the diagnostic value of seeing all three numbers together when the math is wrong. The test: could it fail for two *unrelated* reasons? No — so keep it.
</details>

**Q14. So when *should* you split?**

<details><summary>Answer</summary>

When the test could fail for two **unrelated** reasons — i.e., it verifies multiple behaviors (an Eager Test). Registration and login are different behaviors; split them so each fails independently and its name is the diagnosis. Don't split facets of a single outcome.
</details>

---

## Cures & Mechanics

**Q15. List the main cures for Assertion Roulette.**

<details><summary>Answer</summary>

1. **Split by behavior** (fix the Eager Test) — the failing test's name becomes the diagnosis.
2. **Descriptive assertion messages** — label each remaining assert.
3. **Rich matcher libraries** (AssertJ, testify, pytest rewrite) — print actual-vs-expected automatically.
4. **Soft assertions** — evaluate and report every assertion in one run.
5. **Parameterized tests** — isolate and name many cases.
6. **Custom domain assertions** — DRY a recurring multi-facet check behind a named call.
</details>

**Q16. Which cure gives the biggest win per hour on a legacy suite, and why?**

<details><summary>Answer</summary>

**Adopting a rich matcher library** (swap bare `assertTrue`/`if got != want` for AssertJ/testify/pytest-rewrite). It mechanically turns most "expected true, got false" failures across the entire suite into self-describing ones with no per-test thought — the highest-leverage single change.
</details>

**Q17. How do parameterized tests reduce roulette?**

<details><summary>Answer</summary>

They replace a mega-test that checks many input/output pairs in one body with one logic body and a table of named cases. Each case runs independently (no fail-fast masking) and a failure reports the exact case (`test_discount[silver-100]`) instead of forcing you to map a line to a case. Crucially, you must **name the cases** (`ids=`, `@CsvSource` name template, Go subtest names) or you reintroduce roulette across anonymous indices.
</details>

**Q18. What is a custom domain assertion and when do you use it?**

<details><summary>Answer</summary>

A named helper (e.g. AssertJ's `OrderAssert.assertThat(o).isConfirmed().hasTotal(1800)`, or a Python `assert_valid_invoice(...)`) that collapses a recurring multi-facet check into one call whose *name* describes the invariant and whose internals carry per-facet messages. Use it when splitting would duplicate Arrange across many tests but a raw stack of asserts would be roulette. Bonus: the message lives in one place and can't drift per call site.
</details>

**Q19. A teammate adds a hand-written message `"status should be confirmed"`. What's the risk?**

<details><summary>Answer</summary>

It can **drift**: someone changes the assertion to check `SHIPPED` and forgets the message, which now lies and misdirects the debugger. A wrong message is worse than none. Prefer library-generated messages (derived from the actual code, drift-proof); reserve hand-written prose for the *why* (the business rule), not restating the value.
</details>

**Q20. What makes a *good* assertion message?**

<details><summary>Answer</summary>

It adds what the values can't: the **identity** and the **why**. The matcher already prints `expected 100, got 95`; the message should say `"tax = 10% of subtotal (1000)"` — naming the thing and the rule — not `"expected 100"` (redundant) or `"tax"` (thin). Encode the business rule the reader needs to debug.
</details>

---

## Soft Assertions & Fail-Fast

**Q21. What is a soft assertion?**

<details><summary>Answer</summary>

An assertion whose failure is *collected* rather than immediately thrown, so the test continues evaluating subsequent assertions and reports **all** failures at the end. Mechanisms: JUnit 5 `assertAll`, AssertJ `SoftAssertions`, `pytest-check`, and Go's testify `assert.*` (vs `require.*`). It defeats fail-fast masking.
</details>

**Q22. Do soft assertions replace splitting?**

<details><summary>Answer</summary>

No. Soft-asserting an Eager Test still bundles many behaviors under one badly-named test — you just now see all twelve fail at once under one name. Soft assertions are for *one behavior with several facets you want fully reported*. Split behaviors first; soften within a behavior.
</details>

**Q23. When is fail-fast (a hard assertion) the *right* choice over soft?**

<details><summary>Answer</summary>

When later assertions are **meaningless or dangerous** after an earlier one fails — a causal chain or a precondition. If you soft-assert `response != null` and it's null, continuing to assert `response.body == ...` throws an NPE whose stack trace buries the real failure (the null). Hard-assert the preconditions (no error, non-null, right type) so the genuine cause surfaces cleanly.
</details>

**Q24. State the hybrid rule and the asymmetry behind it.**

<details><summary>Answer</summary>

**Hybrid rule:** hard-assert (`require`) the *preconditions* of further assertion, then soft-assert the *independent facets*. **Asymmetry:** fail-fast risks *hiding sibling failures*; soft-assert risks *drowning the root cause in derived/cascade failures* (and crashing on nulls you should've stopped on). Match the mode to whether the assertions are independent (soft) or dependent (fail-fast).
</details>

**Q25. In Go testify, what's the difference between `assert` and `require`?**

<details><summary>Answer</summary>

`require.*` is fail-fast — it stops the test on failure (use for preconditions like `require.NoError`, `require.NotNil` before a dereference). `assert.*` is soft — it records the failure and continues, so independent facts all get evaluated. Idiomatic pattern: `require` the preconditions, then `assert` the independent facets.
</details>

---

## Trade-Offs & Judgement

**Q26. What's the cost of over-splitting a suite into one-assert tests?**

<details><summary>Answer</summary>

Duplicated **Arrange** (each micro-test rebuilds the fixture — the dominant source of test-code bloat), increased **runtime** (more setup/teardown cycles, slower suite → gets skipped), **noisy failure reports** (N related failures look like N problems), and higher **maintenance churn** per behavior change. Over-splitting is its own anti-pattern; the cost curve is U-shaped with "one reason to fail" at the bottom.
</details>

**Q27. How do you decide split vs keep when a test has several assertions?**

<details><summary>Answer</summary>

Ask: **could it fail for two *unrelated* reasons (multiple behaviors)?** If yes → split. If they're facets of one outcome → keep, then make them legible (messages/matchers; soft-assert independent facets, hard-assert preconditions). If the multi-facet check recurs → custom assertion. If it's many *cases* not behaviors → parameterized test with named cases.
</details>

**Q28. Why might "improve failure output" beat "add more tests" as an investment for a mature suite?**

<details><summary>Answer</summary>

Adding tests increases *detection* but not *localization*; a suite of roulette wheels gets distrusted, skipped, then deleted regardless of coverage. Improving failure output (matchers, messages, one-reason-to-fail) recovers minutes-to-tens-of-minutes of debugging *per failure over the suite's life* and keeps the suite trusted and run — which is what makes it a safety net at all.
</details>

**Q29. Does pytest's assertion rewriting make this anti-pattern a non-issue in Python?**

<details><summary>Answer</summary>

No. pytest rewrites `assert a == b` to show values, which helps for comparisons — but `assert x` on a plain boolean still prints nothing useful, and a 12-assert Eager Test under one name still masks later failures (fail-fast) and still names a line, not a behavior. The smell is language-independent; rich introspection is one cure among several.
</details>

**Q30. Your CI shows a parameterized test failing as `test_rate[3]`. What's wrong and how do you fix it?**

<details><summary>Answer</summary>

The cases are **anonymous** (`[3]` is an index), so you've reintroduced roulette across cases — you must map index 3 back to its inputs by hand. Fix: add readable case ids (`ids=[...]` in pytest, a `name` template in JUnit, descriptive subtest names in Go) so the failure reads `test_rate[overdraft-negative]`.
</details>

---

## Code-Reading

**Q31. Name the smell and the fix:**
```python
def test_user():
    u = make_user("a@b.com")
    assert u.email == "a@b.com"
    assert u.active
    s = login(u)
    assert s.valid
    update_name(u, "Ada")
    assert reload(u).name == "Ada"
```

<details><summary>Answer</summary>

**Eager Test → Assertion Roulette.** Three behaviors (creation, login, name update) and three Acts in one method. A red `test_user` could be any of them, and fail-fast hides later behaviors. **Fix:** split into `test_make_user_sets_email_and_active`, `test_login_returns_valid_session`, `test_update_name_changes_name` — each one behavior, named for it, failing independently.
</details>

**Q32. Is this roulette?**
```java
@Test void newUser() {
    User u = register("a@b.com");
    assertThat(u.getEmail()).isEqualTo("a@b.com");
    assertThat(u.isActive()).isTrue();
    assertThat(u.getRole()).isEqualTo(MEMBER);
}
```

<details><summary>Answer</summary>

**No.** One behavior — "registration produces a correct user" — with three labelled facets and a single Act. AssertJ prints values on failure, and the test name identifies the behavior. This is the *correct* multi-assert case; splitting it would just triple the Arrange. (You could soft-assert the three facets if you wanted all reported at once.)
</details>

**Q33. What's the diagnostic problem here, even though there are messages?**
```go
require.Equal(t, "ada", u.Name, "name")
require.Equal(t, "pro", u.Plan, "plan")
require.Equal(t, 14, u.TrialDays, "trial")
```

<details><summary>Answer</summary>

These use `require` (fail-fast), so if `name` and `trial` are both wrong you only ever see `name` — fail-fast masking. Since these are **independent facets** of one user, prefer `assert.*` (soft) so all three are reported in one run: `assert.Equal(...)` ×3. Reserve `require` for preconditions (e.g. `require.NotNil(t, u)` first).
</details>

---

## Rapid-Fire

**Q34. One-liners — answer fast.**

<details><summary>Answers</summary>

- *Assertion Roulette in one phrase?* Many unlabelled asserts → undiagnosable failure.
- *Cause?* The Eager Test (many behaviors per test).
- *Cheapest cure?* Descriptive messages / rich matchers.
- *Best rule?* One reason to fail per test (not one assert).
- *Plural asserts always bad?* No — facets of one outcome are fine.
- *Soft assertion?* Collect all failures, report together.
- *Go soft vs hard?* `assert.*` soft, `require.*` fail-fast.
- *Many cases?* Parameterized test, **named** cases.
- *Recurring facet-check?* Custom domain assertion.
- *Two Acts in a test?* Split it.
- *Hand-written message risk?* Drift → it lies.
- *Worst bare assert?* `assertTrue(x)` — no values shown.
- *Over-splitting cost?* Duplicated Arrange, slow suite, noisy failures.

</details>

**Q35. How would you explain Assertion Roulette to a junior in 30 seconds?**

<details><summary>Answer</summary>

"When a test has a dozen plain assertions and CI says 'assertion failed at line 48,' you can't tell which check broke or why — you have to re-read the whole test and guess. That's Assertion Roulette. Fix it two ways: give each assertion a message so the failure names itself, and don't cram unrelated behaviors into one test — split them so the failing test's *name* tells you what broke."
</details>

---

## Related Topics

- [`junior.md`](junior.md) — what it looks like and why it's bad.
- [`middle.md`](middle.md) — the Eager Test cause and the four cures.
- [`senior.md`](senior.md) — one-reason-to-fail, AAA, parameterized tests, custom assertions.
- [`professional.md`](professional.md) — the trade-offs: legitimate multi-assert, soft vs fail-fast, message discipline.
- [`tasks.md`](tasks.md) and [`find-bug.md`](find-bug.md) — exercises and spot-the-smell.
- [Fragile Tests](../01-fragile-tests/interview.md) · [Slow Tests](../05-slow-tests/interview.md) — sibling test smells.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) · [Bad Structure](../../01-development/01-bad-structure/senior.md).
