# The Mikado Method — Professional

> **Source:** Ola Ellnestam & Daniel Brolund, *The Mikado Method* (Manning, 2014)

This file is about the parts of large refactoring that aren't code: the **economics and risk**, **estimating from a graph you haven't finished drawing**, **reporting progress to people who don't read code**, the **tooling**, and the **psychological discipline** that makes revert actually happen under deadline pressure.

---

## 1. Economics and risk

The business case for Mikado over "just push through" is a risk argument, and you should be able to make it in money terms.

**The swamp is an option you can't price.** A fix-as-you-go refactoring on a big change has an unknown, fat-tailed completion time and a real probability of *never* completing cleanly — the work gets abandoned half-broken, or merged with latent breakage. From a portfolio view it's an uncapped liability: you cannot tell finance when it ends or what it costs.

**Mikado converts that liability into a stream of small, independently valuable, low-variance increments.** Each leaf is a few hours, ships green, and is independently reversible. The expected total cost may even be *higher* than an idealized swamp run (revert overhead isn't free) — but the **variance collapses**, and variance is what kills schedules and budgets. You're buying predictability and the right to stop, not raw speed.

**Concretely, the risk reductions are:**

- **Always-shippable** — a reprioritization, incident, or layoff mid-refactor strands *zero* broken code. Compare a swamp branch: weeks of work, unmergeable, written off.
- **Bisectable, revertible history** — if a behavioral regression slips through, you binary-search clean green commits instead of forensically dissecting one giant diff.
- **Bounded blast radius** — at most one small experiment is "in flight" and broken at any instant.
- **Optionality** — the right to stop after any leaf and bank value is itself worth money; it lets you spend exactly as much budget as the refactor proves to be worth.

**When the economics flip (when NOT to):** when builds/fixtures are so expensive that revert overhead dominates (spike instead), when the change is small and known (just do it), or when the graph reveals a structural blocker that makes leaf-first hopeless and a Strangler is cheaper. Don't sell Mikado as universally optimal — sell it as the right tool for *deep, unknown-dependency* changes.

---

## 2. Estimating from a partial graph

The honest answer to "how long will this take?" during a Mikado refactor is *"I'll know more after the next attempt"* — but you can do far better than a shrug.

**The partial graph is a real estimate, with error bars.** After the first few attempts you have N discovered leaves at a known average cost-per-leaf, plus a *growth rate* (how many new prerequisites each attempt is still revealing). Combine them:

- **Lower bound:** known remaining leaves × average leaf cost.
- **Trend:** if each attempt is still spawning >1 new prerequisite on average, the graph is *expanding* — your estimate is unstable and you should say so plainly. If new prerequisites per attempt is dropping toward zero, the graph is *converging* and your estimate is tightening.
- **Report a range and the trend, not a point.** "We've cleared 12 of an estimated 18–25 leaves; discovery rate is falling, so I expect it to land within the week" is an honest, decision-useful estimate. A single fake number is not.

**Re-estimate every day from the graph, not from optimism.** The graph gives you a *measured* burn-down (leaves committed) and a *measured* discovery rate (leaves added). That's a far better forecasting signal than gut feel, and it updates automatically as you work.

**The spike-to-estimate move:** when stakeholders need a number *before* committing budget, run a time-boxed learning spike (a throwaway branch, junior.md §9) purely to draw the graph. You emerge with a real dependency map and a defensible range, having spent a fixed, small amount. This is often the highest-leverage hour in the whole effort.

---

## 3. Communicating progress to stakeholders

Refactoring is notoriously hard to report on because "the software does exactly what it did yesterday" is the *goal*. Mikado fixes this by giving you a tangible burn-down.

- **The graph is the status report.** A photo of the shrinking graph, or `git log --oneline` of green leaf-commits, is concrete, honest progress — "8 of ~20 prerequisites cleared, all shipped to trunk." Non-technical stakeholders understand a checklist getting shorter.
- **Lead with shippability.** "Every change so far is in production-ready trunk; we can pause at any point with zero broken work" is the single most reassuring thing you can tell a nervous product owner about a refactor.
- **Surface discovered architecture as findings, not delays.** When the graph reveals that `Config.INSTANCE` is referenced from 47 sites across 9 modules (senior.md §3), that's not "the refactor is bigger than we thought" — it's "we've *measured* a major coupling risk that was always there and is now quantified." Reframe discovery as value delivered.
- **Never report a swamp as "almost done."** The method makes this lie impossible to tell yourself: a leaf is committed-and-green or it isn't done. Carry that honesty into your reporting. "90% done" claims on refactors are usually swamp-talk.

---

## 4. Tooling

You can run Mikado with a whiteboard and `git`, and many experts do. But tooling helps at scale:

- **Graph tools.** The authors built and recommend lightweight tools for capturing the graph as you go; in practice teams use Graphviz/DOT, Mermaid, draw.io, Miro/FigJam, or a plain `MIKADO.md` checklist. The non-negotiable property is **fast to edit mid-attempt** — if updating the graph is slower than the code change, you'll stop doing it and lose the method.
- **Version control is the core tool.** A clean baseline (`git reset --hard HEAD`), one-leaf-per-commit, and green-bisectable history are not optional niceties — they're what makes revert cheap and progress legible. Branch per goal; integrate continuously.
- **Fast feedback is tooling too.** The revert/re-attempt loop is only cheap if compile + relevant-tests is fast. Invest in incremental compilation, a quick test subset for attempts, and a one-key "is it green?" check. The faster red/green is, the more naive attempts you can afford, the more accurate your graph.
- **IDE refactorings execute the leaves.** Inside each node, lean on automated rename/extract/inline/change-signature — they keep the per-leaf edit safe and fast. The IDE does the *step*; Mikado decides the *order*.

**When NOT to tool up:** a one-afternoon graph on a whiteboard needs no software. Reserve heavyweight graph tooling for multi-day, multi-person efforts where the graph must be shared and persisted.

---

## 5. The psychological discipline of revert

The single hardest thing about the method is not technical — it's *deleting code that almost works*, repeatedly, under deadline pressure. Engineers are wired to treat working-ish code as progress and reverting as loss. Naming this explicitly is half the battle.

- **Reframe what "progress" is.** The asset you produce is not the code in a failed attempt — it's the **knowledge of what depends on what**, captured in the graph. Code is cheap to re-type; the dependency map is the expensive, durable thing. You never throw away the valuable part.
- **The sunk-cost reflex is the enemy.** "I'm so close, I'll just push through this one break" is precisely the thought that builds the swamp. Treat a red build on a naive attempt as a *hard stop*: legal moves are "draw the prerequisite" and "revert." Make it a rule, not a judgment call, so it survives pressure.
- **Under deadline, the discipline matters *more*, not less.** Deadlines are exactly when people skip the revert "just this once" — and exactly when a stranded swamp is most catastrophic. The always-shippable property is your insurance policy precisely for the crunch.
- **Make revert frictionless so willpower isn't required.** Clean baseline + fast `git checkout .` means reverting is one keystroke, not a decision. Lower the cost of the right action and you won't have to rely on discipline.
- **Team-normalize it.** When reverting is visibly the *expected* professional move (and the commit stream proves it works), it stops feeling like failure. Celebrate cleared leaves, not heroic all-nighters in the swamp.

> Mikado is, at bottom, a method for *not lying to yourself about progress*. The revert discipline is what enforces that honesty. Everything else — shippability, parallelism, estimability — follows from it.

---

## 6. Next

- **interview.md** — consolidate with model Q&A.
- **tasks.md** — build graphs for real tangles.
- The sibling *Keeping the System Shippable* and *Strangler at Code Level* topics for the always-shippable and strategic-pivot context this file references.
