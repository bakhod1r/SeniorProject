# Tidy First — When and How — Junior Level

> **Source:** Kent Beck, *Tidy First? — A Personal Exercise in Empirical Software Design* (O'Reilly, 2023)

---

## Table of Contents

1. [What is a "tidying"?](#what-is-a-tidying)
2. [Tidying vs. big refactoring](#tidying-vs-big-refactoring)
3. [The one rule that makes tidying safe](#the-one-rule-that-makes-tidying-safe)
4. [The simplest tidyings, with before → after](#the-simplest-tidyings-with-before--after)
   - [Guard Clauses](#guard-clauses)
   - [Dead Code](#dead-code)
   - [Explaining Variables](#explaining-variables)
   - [Explaining Constants](#explaining-constants)
   - [Chunk Statements](#chunk-statements)
   - [Move Declaration and Initialization Together](#move-declaration-and-initialization-together)
   - [Delete Redundant Comments](#delete-redundant-comments)
5. [When do I tidy?](#when-do-i-tidy)
6. [How to keep a tidying safe](#how-to-keep-a-tidying-safe)
7. [Diagrams](#diagrams)
8. [Mini Glossary](#mini-glossary)
9. [Review questions](#review-questions)

---

## What is a "tidying"?

A **tidying** is a small, safe change to the *structure* of code that makes the next change easier — without changing what the code *does*.

Think of cleaning a kitchen counter before you cook. You don't change the recipe. You just move the knife where your hand expects it, wipe the surface, and put the bowl within reach. The meal is the same; the work becomes easier. A tidying is that, for code.

The term comes from Kent Beck. He noticed that most everyday cleanup is not the big, scary "refactoring" you set aside a whole sprint for. It's tiny: rename one variable, add a blank line, delete three lines nobody reads. Each one is so small you can do it in under a minute and be confident you didn't break anything.

> **Key idea:** A tidying changes how code *reads*, never what it *does*. If you run the tests before and after, they pass both times — and you never had to touch a single test.

Two words capture the whole topic, and you should burn them into memory:

- **Structure** — how the code is arranged: names, order, spacing, the shape of `if` statements. Changing structure does not change behavior.
- **Behavior** — what the code actually computes or causes: outputs, side effects, what the user sees. Changing behavior is a feature or a bug fix.

A tidying touches **structure only**.

---

## Tidying vs. big refactoring

People use "refactoring" for everything from renaming a variable to rebuilding an entire module over two weeks. That's confusing. Beck's word **tidying** picks out the *small end* of that range — the cleanups so cheap you can do them constantly, almost without thinking.

| | Tidying | Big refactoring |
|---|---|---|
| **Size** | A few lines, one spot | Many files, whole modules |
| **Time** | Seconds to a few minutes | Hours to days |
| **Risk** | Almost none | Real — needs care and tests |
| **Decision** | Just do it when it helps | Plan it, get buy-in |
| **Example** | Add a guard clause; rename `x` to `total` | Replace inheritance with composition across 12 classes |

Both are "changes to structure, not behavior." The difference is *scale and ceremony*. A tidying is refactoring shrunk down so small that the planning cost disappears. That smallness is the whole point: small changes are easy to review, easy to undo, and almost impossible to get wrong.

Why does the *size* matter so much? Three reasons that you'll feel immediately once you start:

- **You can see it's correct.** A two-line change is small enough to hold in your head and verify by eye. A 200-line change isn't — you have to *trust* it, and trust is where bugs hide.
- **You can undo it cheaply.** If a tidying turns out wrong, reverting a tiny commit costs nothing. Reverting a huge one might drag other work down with it.
- **You'll actually do it.** A cleanup that takes thirty seconds happens dozens of times a day. A cleanup that needs a meeting and a sprint slot happens approximately never. Tidying is designed to be small *so that it fits into normal work* rather than waiting for a "cleanup week" that never comes.

> **Key idea:** A tidying is "refactoring in the small" — named so you'll actually do it, every day, as part of normal work. For the full catalog of named refactorings and the mechanics behind them, see [`../../refactoring/`](../../refactoring/).

---

## The one rule that makes tidying safe

Here is the single most important rule in this entire topic, and it is simple:

> **Never mix a structure change and a behavior change in the same commit.**

Why does this matter so much? Imagine a commit that *both* renames ten variables *and* fixes a bug. A reviewer staring at 200 changed lines cannot tell which line is the bug fix. If something breaks in production next week, you can't safely revert — reverting the bug fix also reverts the cleanup, and vice versa. The two changes are tangled.

Now imagine two separate commits:

1. **Commit A (structure):** rename the ten variables. Tests still pass. No behavior changed.
2. **Commit B (behavior):** the one-line bug fix.

The reviewer skims Commit A in ten seconds ("just renames — looks fine") and reads Commit B carefully ("ah, *that's* the fix"). If production breaks, you revert exactly the commit at fault. Each change is small, isolated, and reversible.

This separation is the discipline behind the whole "Tidy First?" idea. You'll see it deepened at the middle and senior levels, but learn it now: **structure and behavior go in different commits.**

---

## The simplest tidyings, with before → after

Below are the easiest tidyings to start with. Each one is structure-only: behavior is unchanged. All examples are in Java but the ideas are language-agnostic.

### Guard Clauses

Deeply nested `if` statements are hard to read because you have to hold every condition in your head at once. A **guard clause** handles the exceptional case early and returns, so the main path stays flat.

```java
// BEFORE — the real work is buried three levels deep
String describe(User user) {
    if (user != null) {
        if (user.isActive()) {
            if (user.hasEmail()) {
                return user.getEmail();
            }
        }
    }
    return "unknown";
}
```

```java
// AFTER — exceptional cases handled up front, main path is flat
String describe(User user) {
    if (user == null)        return "unknown";
    if (!user.isActive())    return "unknown";
    if (!user.hasEmail())    return "unknown";
    return user.getEmail();
}
```

Same inputs, same outputs — only the shape changed. Notice you can read the "after" top to bottom without holding nested conditions in your head.

### Dead Code

**Dead code** is code that can never run, or that nothing uses. The bravest and simplest tidying is to *delete it*. Don't comment it out — delete it. Version control remembers it for you.

```java
// BEFORE
int discount(int price) {
    int oldDiscount = price / 20;   // never used
    // int legacy = price * 2;      // commented out years ago
    return price / 10;
}
```

```java
// AFTER
int discount(int price) {
    return price / 10;
}
```

If you're nervous, search the codebase for the symbol first to confirm nothing calls it. Then delete with confidence.

### Explaining Variables

A complicated expression is easier to read when you give its parts names. Introduce a variable whose *name explains what the value means*.

```java
// BEFORE — what do these numbers mean?
if (order.total() > 100 && customer.yearsActive() > 2) {
    applyReward();
}
```

```java
// AFTER — the names carry the meaning
boolean isLargeOrder      = order.total() > 100;
boolean isLoyalCustomer   = customer.yearsActive() > 2;
if (isLargeOrder && isLoyalCustomer) {
    applyReward();
}
```

### Explaining Constants

A bare number or string sitting in the code is a **magic value** — nobody knows where it came from. Replace it with a named constant.

```java
// BEFORE
if (passwordAttempts >= 3) {
    lockAccount();
}
```

```java
// AFTER
static final int MAX_PASSWORD_ATTEMPTS = 3;

if (passwordAttempts >= MAX_PASSWORD_ATTEMPTS) {
    lockAccount();
}
```

Now the meaning lives in one place, and the next person who needs to change the limit knows exactly where to look.

### Chunk Statements

A wall of code with no breaks is exhausting. **Chunking** means adding blank lines to group related statements, the way paragraphs group sentences. You add *nothing* and remove *nothing* — you only insert blank lines.

```java
// BEFORE
void checkout(Cart cart) {
    var items = cart.items();
    var subtotal = sum(items);
    var tax = subtotal * TAX_RATE;
    var total = subtotal + tax;
    var receipt = new Receipt(total);
    emailService.send(receipt);
    log.info("checkout complete");
}
```

```java
// AFTER
void checkout(Cart cart) {
    var items = cart.items();
    var subtotal = sum(items);

    var tax = subtotal * TAX_RATE;
    var total = subtotal + tax;

    var receipt = new Receipt(total);
    emailService.send(receipt);
    log.info("checkout complete");
}
```

Three visual groups now: gather, compute, finish. Behavior is byte-for-byte identical.

### Move Declaration and Initialization Together

When a variable is declared at the top of a method but only given a value far below, the reader has to scroll back and forth. Move the declaration down to where it's first used and set its value right there.

```java
// BEFORE
void process(List<Item> items) {
    double total;                  // declared early, unused for now
    validate(items);
    log.info("validated");
    total = computeTotal(items);   // initialized much later
    save(total);
}
```

```java
// AFTER
void process(List<Item> items) {
    validate(items);
    log.info("validated");

    double total = computeTotal(items);   // declared where it's used
    save(total);
}
```

### Delete Redundant Comments

A comment that just repeats the code adds noise and can rot (the code changes, the comment doesn't, and now it lies). Delete comments that say nothing the code doesn't already say.

```java
// BEFORE
// increment the counter by one
counter = counter + 1;
```

```java
// AFTER
counter = counter + 1;
```

Keep comments that explain *why* something non-obvious is done. Delete comments that explain *what* an obvious line does. A good test: read the comment, then read the code. If the comment told you nothing the code didn't already say, it's redundant — delete it. If it told you *why* (a business rule, a workaround, a link to a ticket), keep it.

> **Key idea:** A redundant comment is worse than no comment, because it can drift out of sync with the code and start lying. The code is the source of truth; comments should add the context the code can't carry.

A quick way to internalize the seven tidyings above — notice they fall into three families:

| Family | Tidyings | What they fix |
|---|---|---|
| **Shape** | Guard Clauses, Chunk Statements | The visual layout of the code on the page |
| **Names** | Explaining Variables, Explaining Constants | Meaning that was hidden inside expressions or literals |
| **Removal** | Dead Code, Delete Redundant Comments, Move Declaration to Initialization | Noise: things that shouldn't be there, or shouldn't be where they are |

You don't need to memorize the families — they just show that every tidying is doing one of three jobs: improving *shape*, surfacing *names*, or removing *noise*. None of them changes behavior.

---

## When do I tidy?

You will not tidy the whole codebase — that's a waste. The basic rule for a junior is:

> **Tidy the code you're about to change, when tidying makes that change easier.**

Suppose you're asked to add a new condition inside a method that's currently a nest of `if` statements. Adding the condition to the nest is painful and risky. So **first** you apply Guard Clauses to flatten it (a structure-only commit), and **then** you add the new condition (a behavior commit). The tidying paid for itself immediately — that's the sweet spot.

If you stumble on messy code you *aren't* going to touch, usually **leave it alone** for now. Tidying code you won't return to is effort spent with no payoff. (The full set of choices — Tidy First, Tidy After, Tidy Later, Never — is covered at the middle and senior levels, and the cost/benefit reasoning lives in [`../07-the-economics-of-tidying/`](../07-the-economics-of-tidying/).)

Two more rules of thumb that keep beginners out of trouble:

- **Tidy what you read, not what you imagine.** If you had to *struggle* to understand a method in order to do your work, that struggle is a signal the code needs tidying — and you now understand it well enough to tidy it safely. That's the ideal moment.
- **Don't tidy code you don't understand yet.** If you can't say with confidence what the code does, you can't be sure your "structure-only" change kept it the same. Understand first, tidy second. (When the code is too tangled to understand safely, the sibling topic [`../04-characterization-tests/`](../04-characterization-tests/) shows how to pin down its behavior first.)

---

## How to keep a tidying safe

A safe tidying follows a tiny loop:

1. **Make sure tests pass** (or the code at least compiles and runs).
2. **Apply one** tidying — just one.
3. **Run the tests again.** They should *still* pass, unchanged.
4. **Commit** with a message that says it's structure-only, e.g. `tidy: extract explaining variables in discount()`.

If your IDE offers the change as an automated refactoring (Rename, Extract Variable, Extract Method), prefer the IDE button — it's mechanical and won't typo. This connects directly to [`../../refactoring/`](../../refactoring/), where IDE-assisted refactorings are covered in depth.

> **Key idea:** Small + tested + committed-on-its-own = safe. The smaller the tidying, the easier it is to see it's correct and the easier it is to undo if you change your mind.

---

## Diagrams

The split that organizes everything:

```
                 A CHANGE
                    |
        +-----------+-----------+
        |                       |
   STRUCTURE                BEHAVIOR
   (tidying)               (feature / fix)
        |                       |
  how code reads          what code does
  - guard clauses         - new condition
  - rename                - bug fix
  - blank lines           - new output
        |                       |
        +----- NEVER in the ----+
               same commit
```

The safe tidying loop:

```
  tests pass  ──►  apply ONE tidying  ──►  tests pass?
       ▲                                        |
       |                                  yes → commit
       └──────────  no → undo  ◄───────────────┘
```

---

## Mini Glossary

| Term | Meaning |
|---|---|
| **Tidying** | A small, safe, structure-only change that makes future changes easier. |
| **Structure** | How code is arranged (names, order, spacing, shape). Changing it doesn't change behavior. |
| **Behavior** | What the code computes or causes (outputs, side effects). Features and bug fixes change behavior. |
| **Guard Clause** | An early `return` that handles an exceptional case up front, flattening nested `if`s. |
| **Dead Code** | Code that can never run or that nothing uses; safe to delete. |
| **Explaining Variable** | A named variable introduced to give a piece of an expression a clear meaning. |
| **Explaining Constant** | A named constant replacing a magic number or string. |
| **Magic Value** | A literal number/string with no name, whose meaning isn't obvious. |
| **Chunking** | Adding blank lines to group related statements, like paragraphs. |
| **Reversible** | Easy to undo — a property small changes have and large ones lose. |

---

## Review questions

1. In one sentence, what is a tidying, and how does it differ from a feature?
2. What are the two words (structure / behavior) and which one does a tidying touch?
3. Why must you never put a rename and a bug fix in the same commit? Give the concrete consequence.
4. Rewrite this with guard clauses:
   ```java
   String label(Account a) {
       if (a != null) {
           if (a.isOpen()) {
               return a.name();
           }
       }
       return "closed";
   }
   ```
5. You find dead code. Why delete it instead of commenting it out?
6. Turn `if (retries > 5)` into something using an Explaining Constant. Why is that better?
7. You're about to add a new branch to a deeply nested method. Do you tidy first or add the branch first? In what order, and why?
8. You find ugly code in a file you will never touch again. Should you tidy it? Why or why not?
9. Describe the four-step safe tidying loop.
10. Where would you look for the *full* catalog of named refactorings beyond these small tidyings? (Hint: a sibling section.)
