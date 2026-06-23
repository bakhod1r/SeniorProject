# The Mikado Method — Middle

> **Source:** Ola Ellnestam & Daniel Brolund, *The Mikado Method* (Manning, 2014)

You know the loop (junior.md). This file is about *running it well*: how to draw a graph that stays useful for days, how to choose which leaf to attack next, how to make reverting nearly free with version control, and the specific ways people get the method wrong even after they understand it.

---

## 1. Drawing and maintaining the graph

The graph is a working artifact, not documentation. It changes every few minutes. Keep it where you can edit it fast — a whiteboard, a `.txt` next to the code, a `MIKADO.md` you don't commit, or a graph tool (professional.md). The format matters less than the *discipline* of updating it the instant you learn something.

**A node is a claim that can be checked.** Write each prerequisite so that you can later look at the code and say yes/no:

```
BAD : "fix the config stuff in ShippingCalc"
GOOD: "ShippingCalc reads rate from an injected Config field, not Config.INSTANCE"
```

**Annotate state, not prose.** A node carries three things: a checkable statement, a state marker, and — optionally — a one-line note about *how* you'll do it once it's a leaf.

```
[ ] PricingRule reads taxRate from injected Config         (overload ctor, default to INSTANCE)
[~] OrderService takes Config via ctor                     (branch: 3 children below)
[x] ShippingCalc reads rate from injected Config           done, commit a1b2c3d
```

**Keep the goal pinned at the root.** When the graph gets wide, it's easy to forget what you're climbing toward and start "improving" things that aren't on any path to the goal. If a change you're tempted to make doesn't connect to the root, it doesn't belong in this graph — note it on a separate "later" list and move on. **Scope creep is the silent killer of large refactorings.**

**Prune as you go.** A done-and-committed leaf should be visually crossed off (`[x]`) so your eye lands only on actionable leaves. A graph cluttered with finished work hides the few nodes you can actually act on right now.

---

## 2. Leaf selection — which prerequisite next?

At any moment several leaves may be available. Order is mostly free — leaves are independent by definition — but some choices make the session smoother:

1. **Prefer leaves that unblock the most parents.** If one prerequisite appears under several goal-paths (a *shared* dependency), clearing it shrinks the graph fastest. Real graphs are often DAGs, not pure trees — the same node legitimately blocks two different parents.

2. **Prefer cheap, certain leaves early** to build momentum and commit history, but **don't avoid the scary leaf forever.** If one leaf is clearly the architectural crux (the global, the god class, the circular dependency), tackling it early tells you fast whether the whole goal is feasible. A graph that's 90% easy leaves and one impossible one is worth knowing about on day one, not day five.

3. **Avoid leaves whose attempt would be expensive to revert** when a cheaper, equally-informative leaf exists. You're partly choosing the order to minimize revert cost.

4. **If two leaves touch the same files, do them sequentially**, not interleaved — otherwise a revert of one throws away the other and you lose work. The clean baseline you revert to must be unambiguous.

> A leaf you *think* is non-breaking but haven't attempted is still `[ ]`, not a safe bet. The only way to know a leaf is non-breaking is to try it and watch the build. Never commit a node you haven't actually compiled and tested.

---

## 3. Revert discipline in practice

The method lives or dies on cheap, reliable reverts. Concretely:

**Commit the green baseline before every attempt.** Your working tree should be clean when you start a naive attempt, so that `git checkout .` (discard unstaged) or `git reset --hard HEAD` (discard everything since last commit) returns you to a *known-good* point with zero ambiguity. If you start an attempt with uncommitted junk already present, a revert will also nuke that junk — confusing and dangerous.

**Two flavors of revert:**

```
git checkout -- .          # throw away the failed naive attempt, keep committed work
git reset --hard HEAD      # same, plus any accidental staging
git stash                  # if you want to *peek* at the attempt later (rarely needed)
```

In practice `git checkout .` after a failed attempt is the workhorse. The attempt was only ever a probe.

**Commit each non-breaking leaf immediately, with a message that names the node:**

```
refactor(order): ShippingCalc accepts injected Config (mikado leaf A)
```

Small, frequent, green commits give you (a) a precise revert point for the *next* attempt and (b) a readable trail that doubles as progress reporting (professional.md). If your team squashes on merge, that's fine — the granular history pays off *during* the work.

**When the build is slow,** the revert/re-attempt cycle hurts. Mitigations: run only the affected test subset during attempts (the full suite at commit time), keep a warm incremental compile, or fall back to a learning spike (junior.md §9) on a throwaway branch to draw the graph, then execute against `main` cleanly.

**When NOT to revert:** the one case is the non-breaking leaf — that's the work you *keep*. Reverting a green leaf out of reflex is a real beginner mistake; the rule is "revert on **red**," not "revert always."

---

## 4. Combining with version control

A clean VC workflow turns the method from theory into muscle memory.

- **Work on a branch**, not directly on `main`, so the granular commit stream is yours to reshape. The whole point is that the branch is *shippable at every commit*, so it can be merged or PR'd at any natural stopping point — you're not blocked waiting for the entire refactoring to finish.
- **Each commit = one cleared leaf.** This is the single most useful convention. Your `git log --oneline` becomes a live readout of the graph collapsing.
- **Tag or note the commit hash on the node** (`done, commit a1b2c3d`) so the graph and history stay cross-referenced. If you later need to understand *why* a change was made, the node statement is your commit message's intent.
- **Because every commit is green, `git bisect` works** if a later behavioral bug appears — you can binary-search the refactoring commits cleanly. A swamp branch (one giant broken commit) gives you none of this.

This is the same property the sibling *Keeping the System Shippable* topic insists on: trunk stays releasable. Mikado is one concrete way to honor that during a deep refactor.

---

## 5. Pitfalls

**Pitfall 1 — Not reverting ("I'll just fix this one too").** The most common failure. You attempt the goal, three things break, and instead of recording-and-reverting you start fixing. The fixes break more. Within an hour you're in the swamp with no clean baseline. *Fix:* hard rule — the instant the build is red on a naive attempt, your only legal moves are "write down the prerequisite" and "revert." No exceptions.

**Pitfall 2 — Goal too big.** "Migrate the whole billing module to the new architecture" produces a graph that grows for two days and never starts shrinking, because everything depends on everything. *Fix:* slice the goal into independently-shippable goals ("`InvoiceGenerator` no longer depends on `LegacyTax`"). A good Mikado goal usually clears in hours-to-days, not weeks. If after the first round of attempts the graph has dozens of nodes and no clear leaves, stop and re-scope.

**Pitfall 3 — Working root-first / depth-confusion.** Trying to *complete* the goal before its prerequisites are done — i.e., fixing things in the order errors appear rather than bottom-up. *Fix:* enforce "only attempt a leaf." If a node has any `[ ]` or `[~]` child, it is forbidden as a target until those clear.

**Pitfall 4 — Fuzzy nodes.** "Clean up `ShippingCalc`" — you can't tell when it's done, so you can't commit it, so it festers. *Fix:* every node is a checkable statement (§1).

**Pitfall 5 — Committing an unverified leaf.** You "know" a leaf is safe and commit without running tests. It wasn't safe; now your baseline is red and the next revert returns you to broken code. *Fix:* compile **and** run the relevant tests before every leaf commit. Green-or-it-didn't-happen.

**Pitfall 6 — Letting the graph and code diverge.** You make a change but forget to update the node, or you discover a dependency and don't draw it. The graph stops reflecting reality and you lose trust in it. *Fix:* update the graph in the same beat as the action — attempt, observe, *draw*, revert.

**When NOT to (for the whole method):** see junior.md §9 — small known refactors, no test net, behavior changes, or revert-too-expensive situations.

---

## 6. Worked snippet: a node that turns out to be a branch

You attempt leaf **B** — "`PricingRule` reads taxRate from injected `Config`" — expecting it to be a clean leaf:

```java
public class PricingRule {
    private final Config config;
    public PricingRule(Config config) { this.config = config; }
    public Money price(Cart cart) {
        return cart.subtotal().times(1 + config.getTaxRate());
    }
}
```

But the build reveals that `PricingRule` is *also* `new`'d inside `PromoEngine`, *and* `Config.getTaxRate()` doesn't exist yet (it's `Config.getVat()` plus a region lookup). So B was never a leaf — it's a branch:

```
[~] B: PricingRule reads taxRate from injected Config
   ├── [ ] B1: PromoEngine passes a Config into PricingRule
   └── [ ] B2: Config exposes getTaxRate(region) wrapping getVat()+lookup
```

You **revert** B, draw B1 and B2, and recurse into them first. This is the method protecting you: had you pushed through, you'd have entangled the tax-rate redesign with the injection change and the `PromoEngine` edit in one unreviewable mess.

---

## 7. Next

- **senior.md** — very large refactorings, parallelizing graph branches across a team, and reading the graph as an architecture diagnostic.
- **[Simplifying Method Calls](../../02-refactoring-techniques/05-simplifying-method-calls/junior.md)** for the constructor/parameter mechanics most nodes use.
- The sibling *Branch by Abstraction* and *Keeping the System Shippable* topics, which pair naturally with the revert-on-red discipline.
