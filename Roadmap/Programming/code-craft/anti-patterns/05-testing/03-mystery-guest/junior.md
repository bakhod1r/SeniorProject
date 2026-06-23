# Mystery Guest — Junior Level

> **Category:** [Testing Anti-Patterns](../README.md) → **Mystery Guest** — *a test whose inputs or expected results come from outside the test, where the reader cannot see them.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [What a Mystery Guest Looks Like](#what-a-mystery-guest-looks-like)
4. [Why It's Bad](#why-its-bad)
5. [Where the Hidden Data Hides](#where-the-hidden-data-hides)
6. [The Fix: Make the Input Visible](#the-fix-make-the-input-visible)
7. [Name the Meaningful Values](#name-the-meaningful-values)
8. [Common Mistakes](#common-mistakes)
9. [Test Yourself](#test-yourself)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What does it look like?** and **Why is it bad?**

Here is a test. Read it and tell me whether it's correct:

```python
def test_order_total():
    total = compute_total(load_orders("testdata/orders.csv"))
    assert total == 42
```

You can't. Nobody can. To know whether `42` is right, you'd have to open `testdata/orders.csv`, add up the rows in your head, account for whatever `compute_total` does to them, and only then judge the assertion. The test *looks* like it's testing something, but the two things that matter — **what went in** and **why the answer is what it is** — are nowhere on screen.

That hidden data is the **Mystery Guest**: an input or an expected result that the test reads from somewhere the reader can't see. The name is Gerard Meszaros's, from *xUnit Test Patterns*. The "guest" is the off-screen file, database row, or shared fixture that the test depends on but never introduces.

At the junior level your goal is simple: **recognize when a test's data lives off-screen, and pull it back into the test.** A good test reads top-to-bottom like a little story — *given this input, when I run this, then I expect this* — and you should never have to leave the test body to follow the plot.

> **The mindset shift:** a test is documentation that happens to execute. If the reader can't tell *from the test itself* what it proves, the test has failed at half its job even when it's green.

---

## Prerequisites

- **Required:** You can write a basic unit test in at least one framework (Go's `testing`, JUnit 5, or pytest).
- **Required:** You understand the **Arrange–Act–Assert** shape of a test: set up inputs, run the thing, check the result.
- **Helpful:** You've been confused by someone else's test at least once — opened it to understand a feature and came away knowing less than when you started. That confusion is usually a Mystery Guest.

---

## What a Mystery Guest Looks Like

The tell is always the same: **a value appears in the test that the test didn't produce.** It came from outside.

```java
// Java (JUnit 5) — where does customer 4071 come from? what's in it?
@Test
void goldCustomerGetsDiscount() {
    Customer c = repo.findById(4071L);          // a row seeded "somewhere"
    BigDecimal price = pricer.quote(c, "SKU-9");
    assertEquals(new BigDecimal("89.10"), price);  // why 89.10? unknowable here
}
```

Three mysteries in four lines:

- **Who is customer `4071`?** Is she gold-tier? In what country? The test asserts a *gold discount* but never shows that `4071` is gold. The link is invisible.
- **What is `SKU-9`?** What's its list price? Without it, `89.10` is a magic number.
- **Why `89.10`?** Even if you trusted the inputs, you can't check the arithmetic — the base price isn't here either.

If a teammate broke the pricing rule and this test went red, the failure message would say `expected 89.10 but was 94.00` — and the next reader would have no idea whether the *test* is wrong or the *code* is wrong, because the whole derivation lives off-screen.

---

## Why It's Bad

A Mystery Guest fails at the three things a test is supposed to do:

- **It can't be read.** The reader has to hunt — open a CSV, query a database, find a `setUp` two files away — just to understand a four-line test. Tests are read far more often than they're written; this tax is paid every time.
- **It can't be trusted.** When it goes red you can't tell if the bug is in the code or in the hidden data. When it stays green you can't tell if it's actually exercising the case it claims to. A green you don't trust is worse than no test.
- **It breaks easily and mysteriously.** Because the data lives somewhere shared, *anyone* editing that file or that seed row can flip this test — and they won't know they did. That's how a Mystery Guest turns into a [Fragile Test](../01-fragile-tests/junior.md) and a [Flaky Test](../02-flaky-tests/junior.md): shared, invisible state is the root of both.

> The deepest problem: the test stops being **self-explanatory**. A self-explanatory test teaches you the behavior. A Mystery Guest sends you on a scavenger hunt and teaches you to distrust the suite.

---

## Where the Hidden Data Hides

You'll meet the same guest in a few disguises. Learn to spot all of them:

| Disguise | What it looks like | Why it's a Mystery Guest |
|---|---|---|
| **External file** | `load("testdata/orders.csv")`, `readFixture("user.json")` | The input is in a file the reader never opens. |
| **Seeded DB row** | `repo.findById(4071)`, `User.objects.get(pk=7)` | The "magic record" was inserted by a migration or a shared seed script. |
| **Far-away `setUp`** | a `@BeforeEach` / `setUp()` that builds objects the test silently relies on | The arrange step is in a different place from the test that needs it. |
| **Golden / snapshot file** | `assertEqual(output, read("expected.txt"))` | The *expected result* lives off-screen; you compare against a blob you can't see. |
| **Env var / config** | `os.environ["TEST_ACCOUNT_ID"]` | The input depends on the machine, not the test. |
| **Shared constant** | `TEST_USERS[0]` reused by 50 tests | One edit to the shared list silently changes 50 expected results. |

The common thread: **the test points at the data instead of showing it.** A pointer to off-screen data is a Mystery Guest; the data written into the test is not.

---

## The Fix: Make the Input Visible

The cure is almost always the same one sentence: **set up exactly what *this* test needs, right here in the test.** Don't read it from a file. Don't reuse a shared record. Build the specific, minimal input inline, so the reader sees the whole story.

Take the CSV example and pull the guest into the room:

```python
# Before — the input is in a file nobody opens
def test_order_total():
    total = compute_total(load_orders("testdata/orders.csv"))
    assert total == 42

# After — the input is right here; 42 is now derivable on sight
def test_order_total_sums_line_items():
    orders = [
        Order(qty=2, unit_price=10),   # 20
        Order(qty=1, unit_price=22),   # 22
    ]
    assert compute_total(orders) == 42   # 20 + 22 — you can check it yourself
```

Now the test reads top-to-bottom. The inputs are visible, the `42` is *derivable* from what's on screen, and nobody can break this test by editing a CSV in another directory. It's also faster — no file I/O — and isolated: it shares nothing with any other test.

The same move works for the database version: instead of reaching for the pre-seeded customer `4071`, **create the customer the test needs inside the test** (a gold-tier customer, explicitly), so the reader can see *why* a gold discount should apply.

> **Rule of thumb:** if reviewing a test requires opening a second file or querying a database, the data belongs *in the test*. The test body should contain everything needed to judge whether it's right.

---

## Name the Meaningful Values

Half of "make it visible" is making the *important* part obvious. A literal like `4071` or `"SKU-9"` hides which property actually matters. Name it.

```python
# The reader now sees WHAT makes this case interesting: the tier.
def test_gold_customer_gets_10_percent_off():
    customer = Customer(tier="gold")        # the property under test, named
    product  = Product(list_price=99.00)    # the base, visible
    price = quote(customer, product)
    assert price == 89.10                   # 99.00 - 10% — derivable
```

The `tier="gold"` is the whole point of the test, and now it's impossible to miss. The base price is on screen, so `89.10` checks out. Anything *not* relevant to this test (the customer's name, address, ID) you simply leave out or default — including irrelevant fields is its own small mystery ("does the address matter? why is it here?").

> A test should make the **one thing it's testing** the most visible thing in it. Everything else is noise — keep it out.

---

## Common Mistakes

1. **Thinking "the data's in a file, so it's documented."** A file the reader never opens documents nothing. Visibility means *in the test*, not *somewhere retrievable*.
2. **Reusing a shared test record because it's convenient.** `TEST_USER` saves you three lines today and costs every future reader a scavenger hunt — and couples your test to everyone else's. Build your own.
3. **Loading a 500-row fixture to test a 2-row case.** Test the *minimal* input that exercises the behavior. Big shared fixtures are the deluxe edition of the Mystery Guest.
4. **Leaving magic numbers as expected values.** `assert total == 42` with no derivation is a guess waiting to be wrong. Show where `42` comes from, or compute it from named inputs.
5. **Hiding the arrange step in `setUp`.** Setup that *every* test needs can live in `setUp`; setup that *this* test needs should be *in this test*, where its relationship to the assertion is visible.
6. **Asserting against a golden file you've never read.** Snapshot/golden tests aren't always wrong (see `professional.md`), but a green snapshot you can't explain is a Mystery Guest that passes — the worst kind.

---

## Test Yourself

1. Define "Mystery Guest" in one sentence.
2. Name three places the hidden data of a Mystery Guest commonly lives.
3. Why is a green Mystery Guest test arguably *worse* than a failing one?
4. This test passes. What's the smell, and what would you change?
   ```python
   def test_invoice():
       inv = build_invoice(get_account("ACME-PROD"))
       assert inv.total == 1340.50
   ```
5. A teammate says "the input's in `users.json`, so the test *is* documented — you can just open the file." Why is that not good enough?

<details>
<summary>Answers</summary>

1. A test whose inputs or expected results come from a source not visible in the test body (an external file, a seeded DB row, a far-away shared fixture, a golden file), so the reader can't understand or trust it without hunting elsewhere.
2. Any three of: an external file (`testdata/*.csv`, `*.json` fixtures), a seeded/"magic" database row reached by a hard-coded id, a far-away `setUp`/`@BeforeEach`, a golden/snapshot file holding the *expected* output, an env var, or a shared constant/fixture list reused across many tests.
3. A failing Mystery Guest at least tells you *something* is wrong. A **green** one gives false confidence: you can't tell whether it's actually exercising the case it claims to, because the inputs are off-screen — it may be passing for the wrong reason, or not testing anything at all.
4. The smell is a **Mystery Guest**: `"ACME-PROD"` is a hidden account (seeded where? with what fields?) and `1340.50` is a magic number you can't derive. Fix: build the specific account inline with the few fields that matter, and either show the line items that sum to the total or compute the expected value from named inputs.
5. Because the test should be readable *as a unit*. Sending the reader to another file on every read is a tax paid forever; the file can change without anyone noticing the test changed; and "open the file" doesn't tell you *which rows* this test depends on or *why* the expected value is what it is. Put the relevant data in the test.

</details>

---

## Cheat Sheet

| Signal | Diagnosis | Fix |
|---|---|---|
| `load("testdata/x.csv")` as the input | External-file Mystery Guest | Inline the few rows that matter into the test |
| `findById(4071)` / `objects.get(pk=7)` | Seeded "magic record" | Create the record the test needs, in the test |
| The arrange step is in `setUp`, far away | Far-away fixture | Move per-test setup into the test body |
| `assertEqual(out, read("expected.txt"))` | Golden-file Mystery Guest (expected is hidden) | Make it discoverable + explain how it's generated (`professional.md`) |
| Magic number as expected value | Unexplained expectation | Derive it from named, on-screen inputs |
| `TEST_USER` reused everywhere | Shared fixture / General Fixture | Build a local, minimal object per test |

> **One rule to remember:** *a test should read top-to-bottom and contain everything needed to judge whether it's right. If you have to leave the test to understand it, you've found a Mystery Guest.*

---

## Summary

- A **Mystery Guest** is a test that reads its inputs or expected results from somewhere off-screen — a file, a seeded row, a far-away `setUp`, a golden file — so the reader can't understand or trust it without hunting.
- It's bad because the test stops being **readable** (you must hunt), **trustworthy** (red or green, you can't tell why), and **stable** (anyone touching the shared data can break it — the seed of Fragile and Flaky tests).
- The hidden data hides in a few standard disguises: external files, magic DB rows, far-away setup, golden files, env vars, shared constants. The common thread is *pointing at* data instead of *showing* it.
- The fix is one habit: **set up exactly what this test needs, inline, and name the values that matter.** Keep the irrelevant fields out. Make the expected result derivable from what's on screen.
- Next: [`middle.md`](middle.md) — *where these guests come from in real projects (shared fixtures, golden files, seeded DBs) and the patterns — Test Data Builders, local explicit setup — that keep them out.*

---

## Further Reading

- **xUnit Test Patterns: Refactoring Test Code** — Gerard Meszaros (2007) — the source of the **Mystery Guest**, **Shared Fixture**, **General Fixture**, and **Obscure Test** smells. The canonical reference for this whole topic.
- **Clean Code** — Robert C. Martin (2008) — Chapter 9, "Unit Tests": the F.I.R.S.T. principles and the case for readable, self-contained tests.
- **Growing Object-Oriented Software, Guided by Tests** — Freeman & Pryce (2009) — Test Data Builders done well.

---

## Related Topics

- [Fragile Tests](../01-fragile-tests/junior.md) — what shared, invisible state breaks when it changes.
- [Flaky Tests](../02-flaky-tests/junior.md) — the run-to-run instability hidden fixtures cause.
- [Over-Mocking](../06-over-mocking/junior.md) — a different way tests stop testing real behavior.
- [Bad Structure → Development Anti-Patterns](../../01-development/01-bad-structure/junior.md) — the production-code cousin: code whose shape resists change.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the same diseases one level up, in system structure.
