# The Legacy Change Algorithm — Junior Level

## Table of Contents

- [Why you need an algorithm at all](#why-you-need-an-algorithm-at-all)
- [The five steps, memorized](#the-five-steps-memorized)
- [An analogy: operating with a heart monitor on](#an-analogy-operating-with-a-heart-monitor-on)
- [What each step actually means](#what-each-step-actually-means)
- [A tiny worked example, end to end](#a-tiny-worked-example-end-to-end)
- [The order matters, and here is why](#the-order-matters-and-here-is-why)
- [What "characterization" means](#what-characterization-means)
- [The two questions that drive every step](#the-two-questions-that-drive-every-step)
- [Common beginner mistakes](#common-beginner-mistakes)
- [Mini Glossary](#mini-glossary)
- [Review questions](#review-questions)

---

## Why you need an algorithm at all

You have been handed a task: *"Add a 10% discount for premium customers in the checkout code."* You open `OrderProcessor.java`, find a 400-line method, and freeze. Where do you even put the change? If you edit the wrong line, will anything tell you? You have no tests, the method talks to a database and a payment gateway, and the person who wrote it left two years ago.

This is the everyday reality of working with [legacy code](../01-what-is-legacy-code/) — code without tests. Fear makes you do one of two bad things: either you make the smallest, ugliest change you can (an `if` bolted on at the top) so you touch as little as possible, or you spend a week "cleaning up" and accidentally break three other features. Both come from the same root: **you have no fast way to know whether a change is safe.**

Michael Feathers, in *Working Effectively with Legacy Code*, gives you a repeatable procedure for exactly this situation. It is not a vague principle like "write good code." It is a concrete, ordered algorithm — a checklist you can run every single time you must change scary, untested code. Once you internalize it, the panic goes away, because you always know what your *next* move is.

> **Key idea:** The Legacy Change Algorithm replaces "edit and pray" with a five-step procedure that gets a safety net in place *before* you change behavior.

## The five steps, memorized

Here is the whole algorithm. Memorize the five verbs first; the details come later.

1. **Identify** change points — *where* must the behavior change?
2. **Find** test points — *where* can you observe the effects of that code?
3. **Break** dependencies — make those points reachable from a test without rewriting risky logic.
4. **Write** tests — pin down what the code does *right now* (characterization tests).
5. **Make** the change and refactor — now with a safety net catching mistakes.

A way to remember the order: **I**dentify, **F**ind, **B**reak, **W**rite, **M**ake. Some people use the mnemonic *"I Find Bugs With Mocks,"* but the cleaner memory aid is the shape of the work:

```
  WHERE to change ──▶ WHERE to sense ──▶ MAKE it sensable ──▶ PIN it ──▶ CHANGE it
   (1 Identify)        (2 Find)          (3 Break deps)      (4 Write)  (5 Make)
   └──────────── get a safety net in place ────────────┘   └─ do the work ─┘
```

Notice the split. The first four steps build a *safety net*. Only the fifth step touches behavior. Beginners want to jump straight to step 5 because that is "the actual task." The algorithm's whole point is to make you earn the right to do step 5.

## An analogy: operating with a heart monitor on

Think of a surgeon. Before the first incision, the patient is connected to a heart monitor — a beeping machine showing pulse, blood pressure, oxygen. The surgeon does not place the monitor because it helps the surgery directly. They place it because the moment something goes wrong, the monitor *screams immediately*, while there is still time to react.

Legacy code without tests is surgery with **no monitor**. You cut, you stitch, you finish, and you find out three days later in production that the patient's blood pressure crashed during the operation. By then it is an outage, not a beep.

The Legacy Change Algorithm is the discipline of **attaching the monitor first.**

| Surgery | Legacy code |
| --- | --- |
| Decide where to operate | Identify change points |
| Where can we read vital signs? | Find test points |
| Attach the monitor leads | Break dependencies so tests can run |
| Confirm a stable baseline reading | Write characterization tests |
| Perform the operation, watching the monitor | Make the change with tests running |

> **Key idea:** You do not break dependencies and write tests *because they are part of the change.* You do them so the system *tells you instantly* when the change goes wrong.

## What each step actually means

Let's expand each verb so it is concrete.

**1. Identify change points.** Find the exact place(s) where behavior must differ. Not "somewhere in checkout" — the specific method, the specific lines. For our task it is wherever the final price is computed. You are answering: *what code's behavior is changing?*

**2. Find test points.** A test point is a place where you can *observe* the effect of the code under change. Sometimes it is the return value of the method you are editing. Sometimes the effect is buried — the method writes to a database or sends an email — and the nearest observable point is higher up or further out. You are answering: *if I change this, where can I see the difference?*

**3. Break dependencies.** This is usually why legacy code feels untestable. The method you want to test creates a database connection, calls a payment gateway, reads the system clock, or news up a heavy object in its constructor. To run it in a test you must *cut* those dependencies — replace the real database with a fake, pass the clock in as a parameter, and so on. The places where you can make this substitution are called **seams** (covered in depth in [03-seams-and-enabling-points](../03-seams-and-enabling-points/), and the techniques for cutting in [05-dependency-breaking-techniques](../05-dependency-breaking-techniques/)).

**4. Write characterization tests.** Write tests that capture what the code does *today*, including any bugs. You are not asserting what it *should* do — you are recording what it *does* so that any unintended change shows up as a failed test. The mechanics live in [04-characterization-tests](../04-characterization-tests/).

**5. Make the change and refactor.** Now, with green tests, you implement the discount, run the suite after every small edit, and clean up the code knowing the monitor is watching.

## A tiny worked example, end to end

The task: a small method computes a shipping fee. We need to add **free shipping for orders over $100**. There are no tests.

Here is the starting code:

```java
public class ShippingCalculator {

    public double feeFor(Order order) {
        double weight = order.totalWeightKg();
        double base = 5.00;
        double perKg = 1.50;
        return base + (weight * perKg);
    }
}
```

**Step 1 — Identify change points.** The behavior changes inside `feeFor`: the returned value must become `0` when `order.total()` exceeds 100. One method, one place. Done.

**Step 2 — Find test points.** Lucky us: `feeFor` *returns* its result. The return value is the observable effect — a perfect test point. We can call the method and assert on what comes back.

**Step 3 — Break dependencies.** Does `feeFor` touch a database, a clock, a network? No. It only reads from the `Order` we pass in. There is nothing to break; the seam is already there (we control the input). This step is sometimes free — recognize it and move on.

**Step 4 — Write characterization tests.** Before changing anything, we pin the *current* behavior. We don't yet know offhand what a 4 kg order costs, so we run a test and let it tell us:

```java
@Test
void characterize_currentFee() {
    Order order = new Order(/* weight */ 4.0, /* total */ 50.0);
    double fee = new ShippingCalculator().feeFor(order);
    assertEquals(11.00, fee, 0.001); // 5.00 + 4 * 1.50 = 11.00
}
```

The first time you might write `assertEquals(0.0, fee)`, watch it fail, read the actual value (`11.00`) from the failure message, and paste it in. That is the characterization trick: **let the failing test reveal the truth, then lock it in.** Now we have a green baseline.

**Step 5 — Make the change and refactor.** With the net in place, implement the feature and add a test for the new behavior:

```java
public double feeFor(Order order) {
    if (order.total() > 100.0) {
        return 0.0;               // new behavior: free shipping over $100
    }
    double base = 5.00;
    double perKg = 1.50;
    return base + (order.totalWeightKg() * perKg);
}
```

```java
@Test
void freeShipping_whenOverHundred() {
    Order order = new Order(4.0, 120.0);
    assertEquals(0.0, new ShippingCalculator().feeFor(order), 0.001);
}
```

Run both tests. The old one (`50.0` order → `11.00`) still passes, proving we did not break existing behavior. The new one passes, proving the feature works. You changed legacy code and *know* it is safe. That is the whole game.

## The order matters, and here is why

Beginners often reorder the steps — they make the change first and then "add some tests after." That is backwards, and it costs you. If you write tests *after* changing behavior, you can no longer tell whether the old behavior was correct, because you have already overwritten it. The characterization test must capture the **before** so it can detect a *broken* after.

```
RIGHT:  baseline test (green) ──▶ change code ──▶ run tests ──▶ failure means YOU broke it
WRONG:  change code ──▶ write tests ──▶ tests pass ──▶ but pass on WHAT? You lost the baseline.
```

> **Key idea:** Tests come *before* the behavior change. They record the past so the present can be judged against it.

## What "characterization" means

A normal test you write for new code says *"this is what the code should do."* A **characterization test** says *"this is what the code already does — whatever that is."* The distinction is everything when working with legacy code.

Why pin behavior you might think is wrong? Because your *current* task is the discount, not fixing every old bug. If the shipping method has a rounding quirk, the characterization test captures the quirk. That is fine — it means your discount change won't *accidentally* fix or worsen the quirk without you noticing. You change one thing on purpose, and the net guards everything else. Fix the quirk later, as its own deliberate task with its own test.

## The two questions that drive every step

If you forget the five verbs under pressure, fall back to two questions. They generate the whole algorithm:

1. **"Where does behavior change?"** → finds your change points.
2. **"How will I know if I broke something?"** → forces test points, dependency breaking, and tests.

Almost every step of the algorithm is just an answer to question 2. Dependency breaking exists so you *can* sense outcomes. Tests exist so the sensing is automatic and repeatable. Keep asking "how will I know?" and the algorithm reassembles itself.

## Common beginner mistakes

| Mistake | What goes wrong | The fix |
| --- | --- | --- |
| Skipping straight to step 5 | You change behavior blind; bugs surface in production | Earn step 5 by doing 1–4 first |
| Writing tests *after* the change | No baseline; tests pass but prove nothing | Pin the "before" first |
| "Improving" the code while adding the feature | Mixing refactor + behavior change hides which one broke things | Separate the change from the cleanup ([06-tidy-first](../06-tidy-first-when-and-how/)) |
| Trying to test the whole 400-line method at once | Too many dependencies; you give up | Find the *nearest* test point; break one dependency at a time |
| Asserting "correct" values in characterization tests | You assert your assumption, not reality | Assert what the code *actually* returns |

When you genuinely cannot get tests in cheaply, there are two escape hatches — **Sprout** (add new code in a fresh, tested unit and call it from the legacy method) and **Wrap** (wrap the old method to add behavior around it). The middle-level file covers these. For now, learn the five steps until you can recite them without looking.

## Mini Glossary

- **Legacy Change Algorithm** — Feathers' five-step procedure for safely changing untested code: Identify change points, Find test points, Break dependencies, Write tests, Make the change.
- **Change point** — the specific location in code where behavior must be modified to satisfy the task.
- **Test point** — a place where you can *observe* the effect of the code under change (e.g., a return value, an output object).
- **Seam** — a place where you can alter behavior without editing the code in that place, typically to substitute a dependency for testing. See [03](../03-seams-and-enabling-points/).
- **Dependency breaking** — replacing a hard-to-test collaborator (database, clock, network) with something controllable so the code can run in a test harness. See [05](../05-dependency-breaking-techniques/).
- **Characterization test** — a test that records the code's *current* behavior (bugs included) so unintended changes are detected. See [04](../04-characterization-tests/).
- **Safety net** — the collection of tests that scream the moment a change breaks existing behavior.
- **Sensing** — observing what the code does (vs. *separation*, getting it to run in a harness at all).

## Review questions

1. List the five steps of the Legacy Change Algorithm in order, using the verb for each.
2. Why must steps 1–4 come *before* step 5? What goes wrong if you change behavior first?
3. In your own words, what is the difference between a *change point* and a *test point*? Give an example where they are the same location and one where they differ.
4. What is a characterization test, and why would you ever pin behavior you suspect is a bug?
5. In the shipping example, step 3 (break dependencies) was effectively free. Why? What would have made it *not* free?
6. Reduce the whole algorithm to two questions. What are they, and which steps does each question generate?
7. A teammate says, "I'll just add the discount and write a quick test afterward." What is the risk, and how would you respond?
