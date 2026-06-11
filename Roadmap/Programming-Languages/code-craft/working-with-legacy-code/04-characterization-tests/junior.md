# Characterization Tests — Junior Level

## Table of Contents

- [The problem characterization tests solve](#the-problem-characterization-tests-solve)
- [A photograph of current behavior](#a-photograph-of-current-behavior)
- [How this differs from a normal unit test](#how-this-differs-from-a-normal-unit-test)
- [The basic recipe](#the-basic-recipe)
- [A worked example](#a-worked-example)
- [Why you assert something you know is wrong](#why-you-assert-something-you-know-is-wrong)
- [Pinning behavior you suspect is a bug](#pinning-behavior-you-suspect-is-a-bug)
- [Common beginner mistakes](#common-beginner-mistakes)
- [Mini Glossary](#mini-glossary)
- [Review questions](#review-questions)

---

## The problem characterization tests solve

You have been asked to change a function. It is forty lines long, it has no tests, and you did not write it. You read it three times and you still are not sure what it does in every case. If you change it and something breaks, you will not know — there is nothing watching the behavior.

This is the everyday reality of [legacy code](../01-what-is-legacy-code/): code without tests around it. The [legacy change algorithm](../02-the-legacy-change-algorithm/) tells you that before you change such code, you should get it under test. But here is the catch that trips up every beginner:

> **Key idea:** You cannot write a normal "this is what the code *should* do" test, because you do not yet know what the code *should* do — and even if you did, the existing code might not do it. You first need to find out what it *actually does today*.

A **characterization test** is the tool for that. It is a test whose only job is to **capture and lock down the behavior the code has right now**, correct or not, so that you have a safety net before you start changing things.

The name comes from Michael Feathers' book *Working Effectively with Legacy Code*. To "characterize" something is to describe its character — to write down what it is actually like. That is exactly what these tests do.

---

## A photograph of current behavior

The single best mental model for a characterization test is a **photograph**.

Imagine you are about to renovate a room. Before you knock down a wall, you take photos of the room exactly as it is. You are not photographing the room you *wish* you had. You are not photographing the room as it *should* be according to the blueprint. You photograph the room **as it is right now** — the crooked shelf, the water stain, the lamp that does not work. All of it.

Why? So that if the renovation goes wrong, you can compare the new state against the photo and see precisely what changed.

```
        BEFORE you change the code
        ┌───────────────────────────┐
        │   Take a photograph 📸     │
        │   (characterization test)  │
        │                            │
        │   Capture EXACTLY what     │
        │   the code does today      │
        └───────────────────────────┘
                     │
                     ▼
        ┌───────────────────────────┐
        │   Now change the code      │
        │   safely. The photo tells  │
        │   you if behavior moved.   │
        └───────────────────────────┘
```

A characterization test is a photograph of behavior. It says: "On *this* input, the code returns *that* output. Whatever happens, do not let that change by accident."

Notice what the photo does *not* claim. It does not claim the room is nice. It does not claim the behavior is correct. It only claims: *this is how things are.* That humility is the whole point.

---

## How this differs from a normal unit test

Most testing you have learned so far is about **correctness**. You know what the answer should be, and you assert it:

```python
def test_add():
    assert add(2, 3) == 5   # I KNOW the answer should be 5
```

You wrote `add`, or you have a specification, so `5` is the *truth* and the test guards it. If `add(2, 3)` ever returns `6`, the test is right and the code is wrong.

A characterization test inverts the relationship between test and truth.

| Aspect | Normal unit test | Characterization test |
|---|---|---|
| Where the expected value comes from | A specification / what you *know* is correct | Whatever the code *actually produces* |
| What it asserts | The code does the **right** thing | The code does the **same** thing as before |
| If test and code disagree | The **code** is probably wrong | The **test** is wrong — it learned the value incorrectly |
| Purpose | Specify correct behavior | Freeze current behavior as a safety net |
| When you write it | Before or alongside the code (e.g. [TDD](../../craftsmanship-disciplines/)) | After the fact, around code that already exists |
| Reaction to a bug | Catches the bug | May *pin* the bug in place on purpose |

> **Key idea:** In a normal test, the assertion is the *truth* and the code must obey it. In a characterization test, the code is the *truth* and the assertion must learn from it.

That inversion feels strange at first. It is the source of nearly every misunderstanding beginners have, so reread the table until it clicks.

---

## The basic recipe

Feathers gives a deliberately mechanical four-step recipe. You do **not** read the code and try to predict the answer in your head. You let the test machinery tell you the answer. Here it is:

1. **Write a test you expect to fail.** Call the function and assert something you are confident is *wrong* — often a placeholder like `assertEquals("CHANGE_ME", result)`.
2. **Run it and read the failure message.** The failure says: *expected "CHANGE\_ME" but was "12.5"*. That `"12.5"` is the gift — it is the real current behavior, handed to you by the test runner.
3. **Change the assertion to the actual value.** Replace `"CHANGE_ME"` with `"12.5"`. Run again. Green.
4. **Repeat** for more inputs, especially inputs that exercise the lines you are about to change.

```
   ┌──────────────────────────────────────────┐
   │ 1. assert a value you KNOW is wrong       │
   └───────────────────┬──────────────────────┘
                       ▼
   ┌──────────────────────────────────────────┐
   │ 2. run → failure message reveals the      │
   │    REAL value the code produces           │
   └───────────────────┬──────────────────────┘
                       ▼
   ┌──────────────────────────────────────────┐
   │ 3. paste the real value into the assert   │
   │    → test goes green                      │
   └───────────────────┬──────────────────────┘
                       ▼
   ┌──────────────────────────────────────────┐
   │ 4. repeat for more inputs / code paths    │
   └──────────────────────────────────────────┘
```

This is what people mean by **"let the test tell you the answer."** You are using the test runner as an instrument to *measure* the code's behavior, the way you would use a thermometer to measure temperature. You do not guess the temperature; you read it off the dial.

---

## A worked example

Here is a small function with no tests. It computes a shipping fee. We did not write it and we do not fully trust it, but we have been asked to add a new rule to it next week. First, we characterize.

```python
# shipping.py  — legacy code, no tests
def shipping_fee(weight_kg, country):
    base = 5.0
    if country == "US":
        rate = 1.5
    elif country == "CA":
        rate = 2.0
    else:
        rate = 3.5
    fee = base + weight_kg * rate
    if weight_kg > 10:
        fee = fee * 0.9   # bulk discount
    return fee
```

**Step 1 — assert something obviously wrong.** We have no idea what `shipping_fee(2, "US")` returns, so we assert a sentinel:

```python
# test_shipping.py
from shipping import shipping_fee

def test_characterize_us_light():
    assert shipping_fee(2, "US") == -1   # deliberately wrong
```

**Step 2 — run it and read the failure.**

```
>       assert shipping_fee(2, "US") == -1
E       assert 8.0 == -1
```

The runner just told us the truth: `shipping_fee(2, "US")` is `8.0`. We did not compute that ourselves; the code did.

**Step 3 — paste the real value.**

```python
def test_characterize_us_light():
    assert shipping_fee(2, "US") == 8.0   # learned from the runner
```

Green. We have one photograph.

**Step 4 — repeat for more code paths.** Look at the function: there are branches for `US`, `CA`, `else`, and a discount when `weight > 10`. We want one photo per path. We assert wrong each time, run, and paste:

```python
def test_characterize_us_light():
    assert shipping_fee(2, "US") == 8.0

def test_characterize_ca():
    assert shipping_fee(2, "CA") == 9.0

def test_characterize_other_country():
    assert shipping_fee(2, "FR") == 12.0

def test_characterize_bulk_discount():
    # weight 20 > 10 triggers the * 0.9 branch
    assert shipping_fee(20, "US") == 31.5
```

Each of those numbers started life as a deliberately wrong guess, ran, failed, and revealed its true value. Now we have four photographs covering all four branches. **Now**, and only now, are we safe to add next week's new rule — if our change accidentally moves any of these numbers, a test goes red and tells us.

Notice how little we needed to *understand* to do this. We never reasoned about whether `8.0` is the "right" fee for a 2 kg US parcel — maybe it is, maybe it is not. We only recorded that it is what the function does today. That detachment is liberating: you can build a safety net around code whose correctness you have no opinion about, and no way to verify. The net does not certify the code; it certifies that *you have not changed it*. For someone about to modify forty lines they do not fully grasp, that is exactly the guarantee worth having.

One more habit worth forming early: name the tests for the *situation* they capture, not vaguely. `test_characterize_bulk_discount` tells the next reader precisely which behavior is pinned and why the input `(20, "US")` was chosen. A test named `test_shipping_2` tells them nothing, and six months from now "nothing" is what they will have to work with when a test goes red and they must decide whether the change was intended.

---

## Why you assert something you know is wrong

Beginners always ask: *why not just read the code and write the right number directly?* Three reasons.

1. **You will guess wrong.** That `shipping_fee(20, "US") == 31.5` involves a base, a per-kg rate, and a 10% discount. Doing that arithmetic in your head is exactly the kind of small mistake that produces a test that is itself buggy. Letting the runner compute it removes human error.
2. **It is faster.** Typing `-1` and reading the failure takes seconds. Tracing the logic by hand takes minutes and is error-prone.
3. **It works even when you do not understand the code.** Some legacy functions are genuinely incomprehensible. The beauty of the recipe is that you never need to understand *why* the output is `31.5`. You only need to record *that* it is `31.5`.

> **Key idea:** The deliberately-wrong assertion is not a trick — it is a measurement technique. You are turning the test runner into a tool that reads the code's behavior off for you.

There is one more benefit that is easy to miss. Because step 1 *always fails*, you get a free check that the test is actually wired up and running. If you typed `-1` and the test went *green* on the first run, something is wrong — maybe the test is not being discovered, maybe the function returns `-1` for that input (worth knowing!), or maybe you are asserting on the wrong thing. A test that refuses to fail when you expect it to is a test you cannot trust. The deliberately-wrong first run is, in effect, a tiny sanity check on your own test harness before you commit to a value.

Compare the two mental motions side by side:

```
   READING-THE-CODE approach            LET-THE-TEST-TELL-YOU approach
   ─────────────────────────            ──────────────────────────────
   1. Trace 40 lines in your head       1. assert a sentinel value
   2. Do the arithmetic by hand         2. run, read the real value
   3. Hope you didn't slip              3. paste it in
   4. Write the expected value          4. done — guaranteed accurate
       ↳ error-prone, slow                  ↳ accurate, fast, no
         needs full understanding             understanding required
```

The second column wins on every axis that matters when you are surrounded by code you did not write.

---

## Pinning behavior you suspect is a bug

Here is the part that feels morally uncomfortable. Look again at the `else` branch returning `rate = 3.5` for France. Suppose you happen to know the business *intended* France to be `2.5`, not `3.5`. The current code is, by that standard, **wrong**.

What do you do in the characterization test?

You **still record `12.0`** (the buggy value), and you add a comment saying so:

```python
def test_characterize_other_country():
    # NOTE: business says non-US/CA should be rate 2.5, which would give 10.0.
    # Current code uses 3.5 -> 12.0. This test PINS the existing (buggy)
    # behavior on purpose so refactoring does not change it silently.
    # Fixing the rate is a SEPARATE, intentional change with its own commit.
    assert shipping_fee(2, "FR") == 12.0
```

Why pin a bug? Because the job *right now* is to make the code safe to change, not to fix it. If you "correct" the value inside your characterization test, your test no longer matches the code, it fails, and you have mixed two different activities together: refactoring (which must not change behavior) and bug-fixing (which deliberately changes behavior). Keep them separate.

> **Key idea:** A characterization test records what the code *does*, even when that is wrong. Fixing the bug is a later, separate, deliberate step — done in the open, with its own test that flips the value intentionally.

When you do later fix the bug, you will *change this test on purpose* from `12.0` to `10.0`. The red-to-green transition is now a visible, reviewed decision in your commit history, not an accident.

Think of it as a two-phase plan that you keep strictly separate:

```
   PHASE 1 — make it safe (no behavior change)
   ┌────────────────────────────────────────────┐
   │ pin EVERYTHING the code does, bugs included │
   │ refactor freely; tests stay green           │
   └────────────────────────────────────────────┘
                        │
                        ▼
   PHASE 2 — fix the bug (deliberate behavior change)
   ┌────────────────────────────────────────────┐
   │ change ONE test from 12.0 → 10.0 on purpose │
   │ change the code so the test goes green       │
   │ commit it on its own, clearly labeled        │
   └────────────────────────────────────────────┘
```

Mixing these two phases is the single most common way beginners create chaos: they "tidy up" a function and quietly correct a value at the same time, and now nobody — including them — can tell whether the value moved because of an intended fix or an accidental break. Keeping the phases apart keeps every behavior change honest and traceable.

---

## Common beginner mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Computing the expected value by hand | Introduces arithmetic bugs into the test itself | Assert wrong, let the runner reveal the value |
| "Fixing" the value in the test because it looks wrong | Mixes refactoring and bug-fixing; the test stops matching reality | Pin the actual value, leave a comment, fix later separately |
| Writing only one test | Leaves most code paths unphotographed and unprotected | One photo per branch / interesting path |
| Naming tests `test_works` | Hides intent; nobody knows what is pinned | Name them `test_characterize_<situation>` |
| Treating green as "the code is correct" | A green characterization test only means "behavior unchanged" | Remember: it proves *sameness*, never *correctness* |

---

## Mini Glossary

- **Characterization test** — A test that records the *actual current behavior* of existing code so you can detect accidental changes. Also called a *pin-down test*.
- **Legacy code** — In Feathers' sense, code without tests around it. See [01-what-is-legacy-code](../01-what-is-legacy-code/).
- **Pinning** — Locking a specific behavior in place with a test, even (sometimes) a known-buggy behavior, so it cannot change silently.
- **Safety net** — Any set of tests that catch unintended behavior changes while you refactor.
- **Sentinel value** — A deliberately-wrong placeholder (like `-1` or `"CHANGE_ME"`) used in step 1 of the recipe to trigger a revealing failure.
- **Specification test** — A normal test that asserts what the code *should* do, derived from a spec. Contrast with characterization.
- **Refactoring** — Changing the structure of code without changing its behavior. Characterization tests make this safe. See [../../refactoring/](../../refactoring/).

---

## Review questions

1. In one sentence, what does a characterization test capture, and how is that different from what a normal unit test captures?
2. Why does the recipe tell you to *assert a value you know is wrong* in step 1, instead of writing the correct value directly?
3. You characterize a function and discover it returns `12.0` for France, but you happen to know the business wanted `10.0`. What value do you put in the test, and why?
4. Explain the "photograph" analogy. What does the photo claim about the room, and what does it *not* claim?
5. A teammate says, "All these tests pass, so the legacy module is correct." What is wrong with that statement?
6. Given the `shipping_fee` function above, list the distinct code paths you would want a separate characterization test for, and why one test is not enough.
