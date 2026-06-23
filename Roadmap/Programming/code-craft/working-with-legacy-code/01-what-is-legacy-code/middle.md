# What Is Legacy Code — Middle Level

## Table of Contents

- [From definition to mechanics](#from-definition-to-mechanics)
- [Why "no tests" is the right axis](#why-no-tests-is-the-right-axis)
- [The feedback gap, quantified](#the-feedback-gap-quantified)
- [Recognizing legacy code: signals and tells](#recognizing-legacy-code-signals-and-tells)
- [The untestability spectrum](#the-untestability-spectrum)
- [Worked example: code that fights back](#worked-example-code-that-fights-back)
- [Characterization vs. specification tests](#characterization-vs-specification-tests)
- [Triaging legacy code: where to spend effort](#triaging-legacy-code-where-to-spend-effort)
- [Legacy code vs. technical debt](#legacy-code-vs-technical-debt)
- [Trade-offs you will actually face](#trade-offs-you-will-actually-face)
- [The day-to-day reality](#the-day-to-day-reality)
- [Mini Glossary](#mini-glossary)
- [Review questions](#review-questions)

---

## From definition to mechanics

At the junior level we settled the definition: **legacy code is code without tests**, because tests are what give you fast feedback about whether a change preserved behavior. That definition is the foundation. At this level we need the mechanics: *why* the absence of tests is so corrosive, *how* to recognize legacy code in the wild beyond the simple "are there tests" check, how to decide *which* legacy code to invest in, and how to keep "legacy" cleanly separated from the related-but-different idea of "technical debt."

The mental shift to make here is from a binary label to a *gradient*. In practice, code is rarely fully tested or fully untested. It sits on a spectrum of *testability* and *coverage*, and your real job is to read where a piece of code sits on that spectrum and act accordingly.

## Why "no tests" is the right axis

You could imagine measuring "legacy-ness" along many axes: age, readability, language, complexity, author. Feathers chose tests, and the choice is not arbitrary — it is the axis that **predicts the cost of change** better than any other.

Consider two modules:

- **Module X** is gnarly: a 600-line class, terrible names, deep nesting. But it has a thorough test suite that runs in two seconds and pins every important behavior.
- **Module Y** is pretty: small functions, clean names, tasteful structure. But it has zero tests, and it talks directly to three external systems.

Which one can you safely change tomorrow morning? **Module X.** You can refactor its horrible internals freely, because the tests will catch you the instant you alter behavior. Module Y, despite being prettier, is the dangerous one: any change is "edit and pray," and you won't know you broke a downstream integration until production tells you.

> **Key idea:** Readability tells you how *pleasant* code is to change. Tests tell you how *safely* you can change it. Legacy work is about safety first, because an unsafe change to clean code still causes an outage.

This is why "no tests" beats every other axis: it is the closest proxy for *the risk you take on when you touch the code.*

## The feedback gap, quantified

The deep cost of legacy code is the **length of the feedback loop** — the time between making a mistake and finding out. Shorten it and bugs are cheap; lengthen it and they are catastrophic.

| Where the bug is caught | Feedback delay | Relative cost to fix | Who is affected |
| --- | --- | --- | --- |
| Unit test on save | ~1 second | 1× | You, alone |
| CI on push | ~10 minutes | ~5× | You + reviewer |
| QA / staging | hours–days | ~20× | Team + testers |
| Production incident | days–weeks | ~100× | Customers + on-call |

Legacy code, by definition, has no entries in the top rows. Its first feedback opportunity is QA or production. Every mistake you make is caught late, when it is expensive, embarrassing, and entangled with other changes. That is the *quantified* meaning of "no feedback": you are not missing a nice-to-have; you are pushing every defect to the most expensive possible place to catch it.

```
Tested code:    mistake --[1s]--> caught --> undo, no harm
Legacy code:    mistake --------------------------[weeks]--> caught in prod
```

## Recognizing legacy code: signals and tells

"Does it have tests?" is the formal answer, but experienced engineers also pattern-match on *tells* — properties that predict the code will be painful and probably untestable. These don't redefine legacy code; they help you spot it fast and predict the work involved.

- **Hard-wired dependencies.** The code calls `new Database()`, `DateTime.now()`, or a global singleton directly inside business logic. You can't substitute a fake, so you can't test in isolation.
- **Long methods doing many things.** A 200-line method mixes parsing, business rules, and persistence. There's no small unit to test.
- **No clear inputs and outputs.** The method takes nothing and returns nothing (`void`), communicating only through side effects on global or instance state. Tests need observable outputs.
- **"Don't touch this" folklore.** Comments like `// DO NOT CHANGE`, or a teammate warning you off, are social signatures of untested, fear-inducing code.
- **Commented-out code and copy-paste clusters.** Often the residue of the fear loop: people duplicated rather than risk changing the original.
- **Bugs that recur.** The same defect keeps coming back in slightly different forms — a sign there's no test locking the fix in place.

> **Key idea:** Tests are the *definition*; hard-wired dependencies, long methods, and "don't touch this" folklore are the *symptoms* that the definition is met and that the work to fix it will be real.

## The untestability spectrum

Not all untested code is equally hard to bring under test. Reading where code sits on this spectrum tells you how much effort the first test will cost.

```
EASY ──────────────────────────────────────────────► HARD
pure function   |  takes deps   |  hidden deps   |  global state +
no side effects |  as arguments |  (new inside)  |  side-effect-only
                |               |                |
test it now     |  pass a fake  |  break a       |  major surgery
                |               |  dependency    |  before any test
                |               |  first         |
```

- **Pure functions** (same input, same output, no side effects) are trivial to test even with zero existing tests — write the test, done.
- **Functions that receive their dependencies as arguments** are easy — pass a fake or stub.
- **Functions that construct dependencies internally** (`new EmailSender()` mid-method) need a *seam* introduced first — see [`03-seams-and-enabling-points`](../03-seams-and-enabling-points/).
- **Code driven entirely by global state and side effects** is the hard end — it usually needs [dependency-breaking techniques](../05-dependency-breaking-techniques/) before the first assertion can be written.

When you triage a piece of legacy code, locating it on this spectrum is half the estimate.

## Worked example: code that fights back

Here is realistic legacy code — the kind you meet, not a toy. It is short, but every line resists testing.

```python
# notifier.py  — LEGACY: clean-looking, deeply untestable
import smtplib
from datetime import datetime
from db import connection   # module-level global connection

def notify_overdue_invoices():
    cur = connection.cursor()
    cur.execute("SELECT id, email, due_date, amount FROM invoices WHERE paid = 0")
    for invoice_id, email, due_date, amount in cur.fetchall():
        if due_date < datetime.now():                      # hidden clock dependency
            body = f"Invoice {invoice_id} for ${amount} is overdue."
            server = smtplib.SMTP("smtp.company.com")       # hidden network dependency
            server.sendmail("billing@company.com", email, body)
            server.quit()
            cur.execute("UPDATE invoices SET reminded = 1 WHERE id = %s", (invoice_id,))
    connection.commit()
```

Why is this legacy, and why is it *hard* legacy? Three hidden dependencies are baked in:

1. **A live database** (`connection`, a module global).
2. **The real clock** (`datetime.now()`), so the "overdue" branch depends on wall-clock time.
3. **A real SMTP server** (`smtplib.SMTP(...)`), so running the function sends real email.

You cannot write a fast, reliable test for this as written. Any test would need a database, would behave differently depending on today's date, and would send actual emails. This is the dependency end of the untestability spectrum.

The fix — covered properly in [`05-dependency-breaking-techniques`](../05-dependency-breaking-techniques/) — is to *separate the decision from the side effects* and *pass the dependencies in* rather than reaching for globals:

```python
# notifier.py  — after: a pure decision, testable in isolation
def overdue_invoices(invoices, now):
    """Pure function: which invoices are overdue and need reminders?"""
    return [inv for inv in invoices if not inv.paid and inv.due_date < now]

def reminder_body(invoice):
    return f"Invoice {invoice.id} for ${invoice.amount} is overdue."

# The messy I/O still exists, but it's now a thin shell around tested logic:
def notify_overdue_invoices(repo, mailer, now):
    for inv in overdue_invoices(repo.unpaid_invoices(), now):
        mailer.send("billing@company.com", inv.email, reminder_body(inv))
        repo.mark_reminded(inv.id)
```

```python
# test_notifier.py — fast, deterministic, no DB, no network, no real clock
from datetime import datetime

def test_only_unpaid_past_due_are_overdue():
    now = datetime(2026, 6, 11)
    invoices = [
        Invoice(id=1, paid=False, due_date=datetime(2026, 6, 1), amount=50),  # overdue
        Invoice(id=2, paid=True,  due_date=datetime(2026, 6, 1), amount=50),  # paid
        Invoice(id=3, paid=False, due_date=datetime(2026, 7, 1), amount=50),  # future
    ]
    result = overdue_invoices(invoices, now)
    assert [inv.id for inv in result] == [1]
```

The core decision — *which invoices count as overdue* — is now a pure function with a sub-millisecond test. The database, the clock, and SMTP have been pushed to the edges where they belong. We didn't make the code prettier for its own sake; we made it *testable*, and testability is what removes it from the legacy category.

## Characterization vs. specification tests

This distinction matters more in legacy work than almost anywhere else, and middle engineers must get it right.

A **specification test** asserts what the code *should* do, derived from requirements: "a member ordering over \$100 must get both discounts." You write it from the spec, *before or independent of* the implementation.

A **characterization test** asserts what the code *currently does*, whatever that is — even if it's weird, even if it might be a bug. You write it *from the running code*, by observing actual outputs and pinning them down.

```python
# CHARACTERIZATION: we don't know if this is "right" — we lock in TODAY's behavior
def test_legacy_rounding_behavior():
    # We ran the function and observed it returns 103.4999...; we pin exactly that.
    assert round(legacy_total(cart, member=True), 4) == 103.4999

# SPECIFICATION: we assert what the rule SAYS should happen
def test_member_over_100_gets_both_discounts():
    assert spec_total(cart, member=True) == 103.0
```

Why does legacy work lean so heavily on *characterization*? Because when you inherit untested code, **you usually don't know what it's supposed to do.** The spec is lost, the original author is gone, and the behavior in production *is* the de facto specification — customers depend on it, including its quirks. So you pin the current behavior *first*, giving yourself a safety net, and *only then* decide which behaviors are correct and which are bugs to fix deliberately (with a failing-then-passing test to prove the change).

> **Key idea:** In legacy code, the running system is the source of truth. Characterization tests capture that truth so you can change the code without *accidentally* changing behavior — separating intended changes from accidental ones.

[`04-characterization-tests`](../04-characterization-tests/) develops this fully, including how to discover the current behavior when even *that* is unclear.

## Triaging legacy code: where to spend effort

You will never have time to bring an entire legacy system under test, and trying is a mistake. The skill is **triage** — spending your limited testing effort where it returns the most safety. Two dimensions drive the decision:

```
                 HIGH change frequency
                          │
   Test it now,    ┌──────┼──────┐   TOP PRIORITY:
   it's cheap      │  A   │  B   │   churns AND risky.
   insurance       │      │      │   Cover before you
                   ├──────┼──────┤   touch it again.
   LOW risk  ──────┤  C   │  D   ├────── HIGH risk
                   │      │      │
   Leave it.       │ skip │ cover│   Cover opportunistically,
   Don't gold-     │      │ when  │   especially before changes.
   plate.          └──────┼──────┘
                          │
                  LOW change frequency
```

- **Quadrant B (high churn, high risk):** the hot, dangerous code you keep editing. Invest here first; the tests pay back almost immediately.
- **Quadrant A (high churn, low risk):** easy wins — cheap to test and you touch it often, so just do it.
- **Quadrant D (low churn, high risk):** cover *opportunistically*, right before the rare change, using the legacy change algorithm.
- **Quadrant C (low churn, low risk):** leave it alone. Testing stable, harmless code is gold-plating — effort better spent elsewhere.

A practical heuristic: **let change requests pull tests into existence.** When a ticket forces you to touch a legacy area, that's your signal to cover *that area* first. You get tested code exactly where the system is proving it needs to change.

## Legacy code vs. technical debt

These terms get used interchangeably, but a middle engineer should keep them distinct because they suggest different fixes.

| | **Technical debt** | **Legacy code** |
| --- | --- | --- |
| What it is | The accumulated *cost* of past shortcuts/compromises | Specifically, code *without tests* |
| Metaphor | Borrowed time you pay back with interest | Code you can't change with feedback |
| Can it be deliberate? | Yes — you can take on debt knowingly | Usually not deliberate; it's a state |
| Includes... | Bad architecture, outdated deps, missing docs, *and* missing tests | One specific thing: the missing safety net |
| Primary fix | Pay it down (refactor, upgrade, document) | Get it under test, then it's safe to improve |

The relationship: **missing tests are one important *form* of technical debt** — arguably the highest-interest form, because without tests you can't safely pay down *any other* debt. You want to refactor the bad architecture? You need tests first. You want to upgrade the framework? You need tests to confirm nothing broke. This is why "get it under test" is so often the *first* move in any debt-reduction effort: it unlocks safely paying down everything else.

> **Key idea:** Technical debt is the broad category of accumulated compromise. Legacy code is the specific, highest-leverage instance: no tests. Fixing it first makes fixing the rest safe.

## Trade-offs you will actually face

Working with legacy code is a series of judgment calls, not a checklist you execute blindly. The real trade-offs:

- **Cover everything vs. cover the change point.** You can't test the whole module before a small fix. Cover the *narrow slice* you're about to change. Comprehensive coverage is a goal you approach over many visits, not one heroic sprint.
- **Pin exact behavior vs. pin intended behavior.** Characterization pins exact current behavior, *including bugs*. That's correct for safety — but flag the suspicious pins so you (or a follow-up ticket) can revisit whether they're bugs.
- **Refactor for testability vs. minimize change.** Making code testable means changing it — the legacy dilemma. The safer the refactoring (use automated IDE refactorings and tiny mechanical steps), the more you can do before the first test exists.
- **Speed of tests vs. fidelity.** A test using the real database has high fidelity but is slow and flaky. A fast unit test on extracted pure logic has lower fidelity but tighter feedback. Prefer fast for the inner loop; keep a few slow integration tests for confidence at the seams.

## The day-to-day reality

What does this look like on an ordinary Tuesday? You pick up a ticket: "Members aren't getting the over-\$100 discount." You open the code and find the untested `total(...)` method. Instead of immediately editing it (edit and pray), you:

1. Write a quick characterization test that pins what `total` does *right now* for a member over \$100 — and you watch it pass, confirming you've captured current behavior.
2. Notice the bug: the discount conditions are in the wrong order, or a `>` should be `>=`. You write a *failing* test for the correct behavior.
3. Make the smallest change that turns the failing test green, while the characterization tests confirm you didn't break anything else.
4. Leave the area slightly better than you found it — but not heroically (that's [tidy-first](../06-tidy-first-when-and-how/) and its [economics](../07-the-economics-of-tidying/) territory).

This loop — *cover the change point, pin current behavior, change deliberately with a failing test, keep the rest green* — is the legacy change algorithm in miniature, developed fully in [`02-the-legacy-change-algorithm`](../02-the-legacy-change-algorithm/). Internalizing it is what separates someone who *fears* legacy code from someone who works *effectively* with it.

## Mini Glossary

| Term | Meaning |
| --- | --- |
| **Feedback loop** | The time between making a mistake and finding out. Legacy code makes it dangerously long. |
| **Testability** | How easily code can be placed under fast, reliable tests — a spectrum, not a yes/no. |
| **Hard-wired dependency** | A direct call to a DB, clock, network, or singleton inside logic, blocking isolated testing. |
| **Seam** | A place to alter behavior without editing in line, used to insert a fake and make code testable. |
| **Characterization test** | A test that pins the code's *current* behavior, including quirks, as a safety net. |
| **Specification test** | A test asserting what the code *should* do, derived from requirements. |
| **Triage** | Deciding which legacy code to bring under test first, by change frequency × risk. |
| **Technical debt** | The accumulated cost of past compromises; missing tests are one high-interest form. |
| **Gold-plating** | Over-investing effort (e.g. testing stable harmless code) beyond what pays off. |
| **Pure function** | Same input → same output, no side effects; trivially testable. |

## Review questions

1. Module X is ugly but well-tested; Module Y is clean but untested and talks to three systems. Which is safer to change tomorrow, and why does "no tests" predict cost better than "ugly"?
2. Fill in the feedback-cost table: roughly how much more expensive is a bug caught in production versus in a unit test, and *why* does legacy code force bugs toward the expensive end?
3. List four *tells* that suggest code is untested and painful, and explain why each is a symptom rather than the definition.
4. Place these on the untestability spectrum and justify: (a) a pure `parsePrice(string)`, (b) a method that does `new EmailSender()` inside it, (c) a `void` method that only mutates global state.
5. In the `notify_overdue_invoices` example, name the three hidden dependencies and explain what each one does to test speed and reliability.
6. Define characterization vs. specification tests. Why does legacy work rely so heavily on characterization?
7. You inherit untested code whose current behavior looks like a bug. What do you do *first*, and why pin the buggy behavior at all?
8. Walk through the change-frequency × risk triage grid. Which quadrant gets your first testing investment, and which should you deliberately leave alone?
9. Distinguish "legacy code" from "technical debt." Why is getting code under test usually the *first* step in paying down other debt?
10. Describe the four-step day-to-day loop for fixing a bug in untested code. How does it differ from "edit and pray"?
