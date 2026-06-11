# Tidy First — When and How — Middle Level

> **Source:** Kent Beck, *Tidy First?* (O'Reilly, 2023). Companion to [`../../refactoring/`](../../refactoring/) and [`../05-dependency-breaking-techniques/`](../05-dependency-breaking-techniques/).

---

## Table of Contents

1. [Recap: the structure / behavior line](#recap-the-structure--behavior-line)
2. [The fuller catalog of tidyings](#the-fuller-catalog-of-tidyings)
   - [Normalize Symmetries](#normalize-symmetries)
   - [New Interface, Old Implementation](#new-interface-old-implementation)
   - [Reading Order](#reading-order)
   - [Cohesion Order](#cohesion-order)
   - [Explicit Parameters](#explicit-parameters)
   - [Extract Helper](#extract-helper)
   - [One Pile](#one-pile)
   - [Explaining Comments](#explaining-comments)
3. [Keeping tidyings small](#keeping-tidyings-small)
4. [Separating structure from behavior in practice](#separating-structure-from-behavior-in-practice)
5. [The discipline of separate commits and PRs](#the-discipline-of-separate-commits-and-prs)
6. [Worked example: tidy first, then change](#worked-example-tidy-first-then-change)
7. [Diagrams](#diagrams)
8. [Mini Glossary](#mini-glossary)
9. [Review questions](#review-questions)

---

## Recap: the structure / behavior line

A **tidying** changes the *structure* of code — how it reads — and never its *behavior* — what it computes or causes. The junior level covered the simplest seven (guard clauses, dead code, explaining variables, explaining constants, chunk statements, move declaration to initialization, delete redundant comments). This level adds the rest of Beck's catalog and, more importantly, the *discipline* that makes tidying a team-grade practice: keep each one small, and keep structure and behavior in separate commits.

> **Key idea:** The catalog is not the hard part — anyone can learn fifteen named cleanups. The hard part is the discipline: doing them one at a time, structure-only, in their own commit, so that every change in history is either "obviously safe" or "carefully reviewed," never a tangle of both.

---

## The fuller catalog of tidyings

Each tidying below comes with a tiny before → after. Every example is structure-only: run the tests before and after and they pass, unchanged.

### Normalize Symmetries

When the codebase does *the same thing two different ways*, the reader has to ask "is this difference meaningful?" every single time. **Normalize Symmetries** means: make the same thing look the same everywhere. Pick one form and apply it consistently.

```python
# BEFORE — three ways to express "missing"
def load(self):
    if self.cache == None:        # ==
        ...
    if self.data is None:         # is
        ...
    if not self.config:           # truthiness
        ...
```

```python
# AFTER — one way, everywhere
def load(self):
    if self.cache is None:
        ...
    if self.data is None:
        ...
    if self.config is None:
        ...
```

Now a *difference* in the code signals a difference in *meaning*. Symmetry turns visual scanning into a reliable tool.

### New Interface, Old Implementation

Sometimes the existing way to call something is awkward, but you don't want to rewrite the implementation yet. **New Interface, Old Implementation** adds a nicer entry point that simply delegates to the old code. You change *how it's called*, not *what it does*.

```typescript
// BEFORE — callers must pass a flag bag
function fetch(url: string, opts: { method: string; retry: boolean }) { /* ... */ }

// callers: fetch(u, { method: "GET", retry: true })
```

```typescript
// AFTER — a friendlier interface delegating to the old one
function fetch(url: string, opts: { method: string; retry: boolean }) { /* ... unchanged ... */ }

function get(url: string)  { return fetch(url, { method: "GET",  retry: true  }); }
function post(url: string) { return fetch(url, { method: "POST", retry: false }); }
```

The old `fetch` still exists and behaves identically. You've added a cleaner surface; later changes can migrate callers and eventually retire the old form. This is closely related to **interface seams** in [`../05-dependency-breaking-techniques/`](../05-dependency-breaking-techniques/) — a new interface is often the seam you need to break a dependency.

### Reading Order

Code is read top to bottom far more often than it's written. **Reading Order** reorders elements so the reader meets them in the order they'd want — usually high-level first, then the details, or in the order they execute.

```java
// BEFORE — helper appears before the method that explains why it exists
private double tax(double amount) { return amount * RATE; }
private double shipping(double amount) { return amount > 50 ? 0 : 5; }

public Receipt checkout(Cart cart) {
    double sub = cart.subtotal();
    return new Receipt(sub + tax(sub) + shipping(sub));
}
```

```java
// AFTER — the public story first, supporting details after
public Receipt checkout(Cart cart) {
    double sub = cart.subtotal();
    return new Receipt(sub + tax(sub) + shipping(sub));
}

private double tax(double amount)      { return amount * RATE; }
private double shipping(double amount) { return amount > 50 ? 0 : 5; }
```

A reader now sees the entry point first and drops into helpers only if they care. No code changed — only the order on the page.

### Cohesion Order

**Cohesion Order** moves *related* elements next to each other so that when you change one, the others you'll likely change with it are right there. Scattered-but-related code forces scrolling and invites missed edits.

```python
# BEFORE — user-related and order-related code interleaved
class Service:
    def create_user(self): ...
    def create_order(self): ...
    def delete_user(self): ...
    def cancel_order(self): ...
    def rename_user(self): ...
```

```python
# AFTER — cohesive groups sit together
class Service:
    # --- users ---
    def create_user(self): ...
    def rename_user(self): ...
    def delete_user(self): ...

    # --- orders ---
    def create_order(self): ...
    def cancel_order(self): ...
```

Cohesion Order is a small move that pays off the *next* time someone changes "everything about users" — it's all in one place.

### Explicit Parameters

A function that reaches out to a global, a field, or a hidden singleton has a **hidden input**: you can't tell what it depends on from its signature, and you can't test it in isolation. **Explicit Parameters** turns that hidden input into a visible one.

```python
# BEFORE — depends on a global; signature lies about its inputs
TAX_RATE = 0.2

def total(amount):
    return amount + amount * TAX_RATE   # where did TAX_RATE come from?
```

```python
# AFTER — the dependency is now visible and testable
def total(amount, tax_rate):
    return amount + amount * tax_rate
```

This is a structure change (the computation is identical when called with the same effective value) *and* an enabling step for testing — it makes a **seam**. Compare with the explicit techniques in [`../05-dependency-breaking-techniques/`](../05-dependency-breaking-techniques/).

### Extract Helper

When a chunk of a method does one nameable sub-task, **Extract Helper** pulls it into its own well-named function. The name documents the intent; the caller reads like a summary.

```java
// BEFORE
void publish(Article a) {
    String slug = a.title().toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
    a.setSlug(slug);
    store.save(a);
}
```

```java
// AFTER
void publish(Article a) {
    a.setSlug(slugify(a.title()));
    store.save(a);
}

private String slugify(String title) {
    return title.toLowerCase()
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-|-$", "");
}
```

Extract Helper is the most common tidying. Use the IDE's "Extract Method" so it's mechanical and behavior-preserving by construction.

### One Pile

Counterintuitively, sometimes the right first move is to *un*-split. When logic has been chopped into so many tiny pieces (over-abstracted helpers, premature indirection) that you can't follow it, **One Pile** inlines the scattered fragments back into one place so you can *see the whole thing*, understand it, and then re-split along better lines.

```python
# BEFORE — over-fragmented; you must jump between four one-line helpers
def price(o): return _base(o) + _adj(o)
def _base(o): return o.qty * o.unit
def _adj(o):  return -_disc(o)
def _disc(o): return _base(o) * 0.1 if o.qty > 10 else 0
```

```python
# AFTER (One Pile) — gathered so the logic is visible in one view
def price(o):
    base = o.qty * o.unit
    discount = base * 0.1 if o.qty > 10 else 0
    return base - discount
```

One Pile is a *temporary* tidying: gather, understand, then extract again with names that actually carry their weight. It treats fragmentation as a smell, not a virtue.

### Explaining Comments

The flip side of "delete redundant comments." Where the code can't easily say *why*, an **Explaining Comment** records the reason, the surprise, or the link to context.

```typescript
// BEFORE — a magic adjustment with no explanation
return raw * 1.0823;
```

```typescript
// AFTER — the comment explains *why*, which code can't
// 8.23% combined state+county sales tax for our only sales region (CA-37).
// See finance ticket FIN-4412 before changing.
return raw * 1.0823;
```

Add comments that explain intent and surprises; delete comments that restate the obvious. Both are tidyings.

---

## Keeping tidyings small

The defining property of a tidying is its *size*. A tidying that grows large stops being a tidying and becomes a risky refactoring. Keep them small on purpose:

- **One tidying per commit.** If you catch yourself doing two, split them.
- **Prefer IDE-automated moves** (Rename, Extract, Inline). They're mechanical and won't introduce typos.
- **If you can't do it in a couple of minutes, stop** and reconsider whether this is really a tidying or a bigger refactoring that needs planning.
- **Stay inside one logical area.** Renaming one variable across 40 files is not "small"; renaming it in the one method you're working on is.

> **Key idea:** Smallness is not a stylistic preference — it's the source of safety. A small change is one you can *see* is correct, *review* in seconds, and *revert* cleanly. The moment a tidying is too big to hold in your head, you've lost those guarantees.

---

## Separating structure from behavior in practice

In real work, structure and behavior changes show up *mixed* in your head — "I'll just flatten this and add the new case while I'm here." Resist. Untangle them into ordered steps:

```
Want to: add a new pricing tier to a tangled method.

Step 1 (STRUCTURE): guard clauses + extract helper      → commit "tidy: ..."
Step 2 (STRUCTURE): explaining variables for the tiers   → commit "tidy: ..."
Step 3 (BEHAVIOR):  add the new tier                     → commit "feat: ..."
```

Each structure step is verified by the *existing* tests passing unchanged. Only the final behavior step adds or changes a test. If you find yourself editing a test during a "structure" step, that's a red flag: you're probably changing behavior and have crossed the line.

A practical heuristic: **structure changes never need a test change; behavior changes always do** (a new test or an updated assertion). Use the test diff as a tripwire.

---

## The discipline of separate commits and PRs

The separation isn't just conceptual — it shows up in your version-control history and your pull requests:

| | Structure commit/PR | Behavior commit/PR |
|---|---|---|
| **Message prefix** | `tidy:` / `refactor:` | `feat:` / `fix:` |
| **Touches tests?** | No (they pass unchanged) | Yes |
| **Review speed** | Seconds — skim and approve | Careful — read every line |
| **Revertable in isolation?** | Yes | Yes |
| **Risk** | Near zero | Real |

Why bother committing separately when it's "more work"?

- **Bisecting.** When `git bisect` finds the commit that introduced a bug, you want it to land on a *behavior* commit, not a 600-line mixed blob where you still can't tell what broke.
- **Reverting.** You can pull out the bug fix and keep the cleanup, or vice versa.
- **Reviewing.** Reviewers can rubber-stamp the structure commit and spend their attention on the behavior commit — where it belongs.
- **History as a story.** Six months later, the log reads as a sequence of deliberate moves, not a pile of "wip" commits.

The PR equivalent: **prefer structure-only PRs.** A PR titled "tidy: flatten and rename in `PricingService`" with no test changes gets approved fast and merged, clearing the runway for the feature PR that follows. (This team-level workflow — sequencing, getting fast reviews, handling deadlines — is the subject of the professional level.)

---

## Worked example: tidy first, then change

You're asked to add **free shipping for orders over $200**. The current method:

```java
// BEFORE — tangled; adding a case here is risky
public double shipping(Order o) {
    if (o != null) {
        if (o.getCountry().equals("US")) {
            if (o.total() > 50) {
                return 0;
            } else {
                return 5;
            }
        } else {
            return 15;
        }
    }
    return 0;
}
```

**Step 1 — STRUCTURE (guard clauses).** Commit `tidy: guard clauses in shipping()`. Tests pass unchanged.

```java
public double shipping(Order o) {
    if (o == null)                    return 0;
    if (!o.getCountry().equals("US")) return 15;
    if (o.total() > 50)               return 0;
    return 5;
}
```

**Step 2 — STRUCTURE (explaining constant).** Commit `tidy: name the free-shipping threshold`. Tests pass unchanged.

```java
static final double DOMESTIC_FREE_THRESHOLD = 50;

public double shipping(Order o) {
    if (o == null)                    return 0;
    if (!o.getCountry().equals("US")) return 15;
    if (o.total() > DOMESTIC_FREE_THRESHOLD) return 0;
    return 5;
}
```

**Step 3 — BEHAVIOR (the actual feature).** Commit `feat: free shipping over $200`, *with a new test*.

```java
static final double DOMESTIC_FREE_THRESHOLD = 50;
static final double GLOBAL_FREE_THRESHOLD   = 200;

public double shipping(Order o) {
    if (o == null)                           return 0;
    if (o.total() > GLOBAL_FREE_THRESHOLD)   return 0;   // NEW behavior
    if (!o.getCountry().equals("US"))        return 15;
    if (o.total() > DOMESTIC_FREE_THRESHOLD) return 0;
    return 5;
}
```

Adding the new case to the *tidied* version was a one-line, obvious change — exactly because Steps 1 and 2 made room for it first. That's "Tidy First."

Notice what each commit bought you:

| Commit | Kind | What it changed | What verified it |
|---|---|---|---|
| `tidy: guard clauses` | Structure | Flattened nesting | Existing tests, unchanged, green |
| `tidy: name threshold` | Structure | Replaced magic `50` | Existing tests, unchanged, green |
| `feat: free shipping >$200` | Behavior | Added a new return path | A **new** test pinning the new behavior |

If a regression showed up two weeks later, `git bisect` would land on the third commit — the only one that changed behavior, and a one-line change at that. Compare that to bisecting a single commit that did all three things at once: you'd be staring at a tangled diff with no idea which line broke production. That's the practical payoff of separation, made concrete.

---

## Diagrams

The ordered-steps mental model:

```
  TANGLED CODE
       │
       ▼
  [structure]  tidy ──► tidy ──► tidy     (tests pass, unchanged, no test edits)
       │
       ▼
  [behavior]   change                     (new/updated test)
       │
       ▼
  CLEAN CODE + NEW FEATURE
```

The commit-history payoff:

```
  Mixed history:   ✗  abc123  "add tier + cleanup + rename (600 lines)"   ← bisect lands here, useless

  Tidy-first:      ✓  d1  tidy: guard clauses        (skim-approve)
                   ✓  d2  tidy: name threshold        (skim-approve)
                   ✓  d3  feat: free shipping >$200    (bisect lands here, 1 meaningful line)
```

---

## Mini Glossary

| Term | Meaning |
|---|---|
| **Normalize Symmetries** | Make the same thing look the same everywhere; one idiom for one idea. |
| **New Interface, Old Implementation** | Add a cleaner way to call code that delegates to the unchanged original. |
| **Reading Order** | Reorder elements so a reader meets them in the order they'd want. |
| **Cohesion Order** | Put related elements next to each other so they change together. |
| **Explicit Parameters** | Turn a hidden input (global, field, singleton) into a visible parameter. |
| **Extract Helper** | Pull a nameable sub-task into its own well-named function. |
| **One Pile** | Inline over-fragmented code to see it whole before re-splitting better. |
| **Explaining Comment** | A comment that records *why* (intent, surprise) where code can't say it. |
| **Hidden input** | A dependency not visible in a function's signature (global, field, clock). |
| **Structure-only PR** | A pull request that changes structure but no behavior; reviewed fast. |

---

## Review questions

1. Give the test-diff tripwire that tells you a "structure" change has secretly become a behavior change.
2. Show a before/after for **Normalize Symmetries**. Why does consistency make scanning reliable?
3. When would you reach for **One Pile** instead of Extract Helper? Aren't they opposites?
4. **Explicit Parameters** is both a tidying and an enabling step for something else. What, and which sibling topic covers it?
5. Why does separating structure from behavior make `git bisect` more useful?
6. A teammate's PR both renames a class across 30 files *and* fixes a null-pointer bug. What feedback do you give, concretely?
7. Reorder this for Reading Order and explain your choice:
   ```python
   def _helper(x): return x * 2
   def main(x): return _helper(x) + 1
   ```
8. What's the difference between deleting a redundant comment and adding an explaining comment? Give an example of each.
9. Why is "one tidying per commit" a safety rule, not just neatness?
10. Walk through the three commits you'd make to add a feature inside a deeply nested method.
