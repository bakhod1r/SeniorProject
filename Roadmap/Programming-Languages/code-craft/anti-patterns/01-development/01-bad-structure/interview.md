# Bad Structure Anti-Patterns — Interview Q&A

> **Category:** [Development Anti-Patterns](../README.md) → **Bad Structure** — *code that has grown into a shape that resists change.*
> **Covers (collectively):** God Object · Spaghetti Code · Lava Flow · Boat Anchor · Arrow Anti-Pattern

A bank of 60+ interview questions and answers spanning recognition, refactoring, root-cause analysis, and runtime/toolchain implications. Each answer models the reasoning a strong candidate gives — including the trade-offs. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Refactoring at Scale & Root Causes](#senior--refactoring-at-scale--root-causes)
4. [Professional / Deep — Performance, GC, Toolchain](#professional--deep--performance-gc-toolchain)
5. [Code-Reading — Name the Anti-Pattern](#code-reading--name-the-anti-pattern)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [How to Talk About Anti-Patterns in Interviews](#how-to-talk-about-anti-patterns-in-interviews)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, recognition, and the "why is it bad" reasoning.

**Q1. Name the five bad-structure anti-patterns and give a one-line symptom for each.**

<details><summary>Answer</summary>

- **God Object** — one class knows and does everything; thousands of lines, dozens of responsibilities.
- **Spaghetti Code** — control flow with no recognizable structure; you can't follow what calls what.
- **Lava Flow** — fossilized dead code nobody dares delete because nobody understands it.
- **Boat Anchor** — code/library/subsystem kept "just in case" but never used.
- **Arrow Anti-Pattern** — deeply nested `if`/`else` forming a `→` shape; the real logic is the deepest line.

The common thread: each is a *shape* that makes the next change expensive. You spot them by structure, not by a single bad line.
</details>

**Q2. What's the difference between a code *smell* and an *anti-pattern*?**

<details><summary>Answer</summary>

A smell is a **local, syntactic observation** — "this method is 400 lines," "this class has 30 fields." An anti-pattern is the **recognized shape** the smells form, plus the **flawed reasoning** that produced it. "Large Class" is a smell; "God Object" is the anti-pattern — a class that became a catch-all because there was no clear home for new behavior. Smells point your nose; anti-patterns name the disease and imply the cure.
</details>

**Q3. Why is bad structure a problem if the code "works" and passes all tests?**

<details><summary>Answer</summary>

"Works + passes tests" measures *correctness today*. Bad structure is a tax on *change* — paid by the next person who modifies the code, including future-you. Code is read far more than written and changed far more than read once, so the cost that matters is the marginal cost of the next edit. Bad structure inflates that cost: changes ripple unpredictably, the blast radius is large, and fear of breaking something distant slows everyone down. The "ugh" reaction when a teammate has to touch a file is the human signal that structure is wrong even when behavior is right.
</details>

**Q4. What is a God Object, and why is it hard to test in isolation?**

<details><summary>Answer</summary>

A God Object is a single class that has accumulated many unrelated responsibilities — it validates, talks to the DB, sends email, formats output, and holds business rules. It's hard to test because those responsibilities are entangled: to test order creation you must wire up the email server, payment gateway, and database, because the logic can't run without them. There's no seam to substitute a fake. The fix is to extract each responsibility into a focused collaborator and inject it, so each piece can be tested alone and the coordinator can be tested against fakes.
</details>

**Q5. How do you recognize Spaghetti Code by reading it?**

<details><summary>Answer</summary>

The tell is **lost locality**: you can't understand one function without reading several others, because they communicate through hidden shared mutable state and an implicit call order. Functions only work if you call them in a precise sequence; moving a line breaks behavior in a distant place; flags set in one function silently steer branches in another. If "what does this function need?" can't be answered from its signature and body alone, the structure is spaghetti.
</details>

**Q6. What's the difference between Lava Flow and a Boat Anchor? They're both dead code.**

<details><summary>Answer</summary>

Both are dead code; the difference is *why it survives*. **Lava Flow** persists out of **fear born of ignorance** — nobody understands it, so nobody dares delete it ("don't remove, broke prod in 2019??"). **Boat Anchor** persists out of **intent born of speculation** — someone built it for a future use that never arrived ("we might need the XML exporter someday"). Lava Flow is "we don't know what this does"; Boat Anchor is "we know exactly what this does, but nothing uses it." Both cures end in deletion, but you reach Lava Flow's deletion by gathering evidence (coverage, blame), and Boat Anchor's by invoking YAGNI.
</details>

**Q7. Show the guard-clause fix for this Arrow code. Why is it better?**

```go
func process(u *User) error {
    if u != nil {
        if u.Active {
            if u.HasPermission("write") {
                return doWork(u)
            } else { return errors.New("no permission") }
        } else { return errors.New("inactive") }
    }
    return errors.New("nil user")
}
```

<details><summary>Answer</summary>

```go
func process(u *User) error {
    if u == nil                   { return errors.New("nil user") }
    if !u.Active                  { return errors.New("inactive") }
    if !u.HasPermission("write")  { return errors.New("no permission") }
    return doWork(u) // happy path, flat and last
}
```

Guard clauses handle each failure first and `return` early, so the happy path drops back to the left, flat and obvious. The reader no longer has to hold five open conditions in their head, the `else` branches that pair the error to the wrong condition disappear, and adding a sixth precondition is a one-line addition instead of another level of nesting.
</details>

**Q8. Why is "keep the dead code, it's safer" the wrong instinct?**

<details><summary>Answer</summary>

Because version control already *is* the safety net. Deleting code you have committed loses nothing — `git log`/`git revert` restores it the moment a real need appears, and by then you'd likely rebuild it better against the real requirement. Keeping it, by contrast, has ongoing costs: it misleads readers into reasoning about behavior that never runs, it slows every search and refactor, and it rots untested until it silently breaks. The safe move is *delete, backed by git*, not *hoard, backed by fear*.
</details>

**Q9. A class is named `OrderManager`. Why are names like `Manager`, `Helper`, `Util` warning signs?**

<details><summary>Answer</summary>

Vague names invite vague responsibilities. `Manager`/`Helper`/`Util`/`Engine` describe no specific job, so they become magnets: whenever a developer can't decide where new behavior belongs, "the manager" or "the utils" is the path of least resistance. The name itself fails to push back. A precise name (`InvoiceRenderer`, `PaymentGateway`) draws a boundary — code that doesn't fit the name obviously belongs elsewhere. So vague names are both a symptom of and an accelerant for God Objects.
</details>

**Q10. What is cyclomatic complexity and how does it relate to these anti-patterns?**

<details><summary>Answer</summary>

Cyclomatic complexity roughly counts the independent paths through a function — each `if`, `case`, `&&`, or loop adds one. High complexity means more branches to read, more states to reason about, and more test cases needed for coverage. It's a smoke detector for **Arrow** (deep nesting raises it) and **Spaghetti** (tangled branching raises it). It's a guide, not a verdict: a flat lookup table can have moderate complexity yet be perfectly clear, while a function gamed to satisfy the linter can be worse. Use it to *find* candidates, then judge with your eyes.
</details>

**Q11. What does "responsibility" mean, and why is it central to God Object?**

<details><summary>Answer</summary>

A responsibility is the single reason a unit of code should change — tied to one actor or one concern (pricing, persistence, notification). A God Object has many responsibilities, so it changes for many reasons and for many stakeholders at once, which is exactly the Single Responsibility Principle violation. The practical test: describe the class in one sentence; if you need "and" more than once ("it validates the order *and* charges the card *and* sends email"), each "and" is a responsibility that wants its own class.
</details>

**Q12. Is deeply nested code always bad?**

<details><summary>Answer</summary>

No. Depth from *unnecessary* gatekeeping — sequential validations that could be early returns — is the Arrow anti-pattern and should be flattened. But some nesting is inherent: a genuine 2D grid traversal nests two loops; parsing a recursive structure mirrors that structure. The question isn't the indent count alone, it's whether the nesting reflects *essential* structure of the problem or *accidental* failure to use guard clauses, polymorphism, or extracted helpers. Flatten the accidental; leave the essential.
</details>

---

## Intermediate / Middle

> When it creeps in, what to do instead, and the trade-offs.

**Q13. Nobody sets out to write a God Object — so how does one actually form?**

<details><summary>Answer</summary>

By accretion of locally-reasonable decisions. `OrderService` handles orders; "checkout also sends email, and email is about orders, so put it here"; "the invoice is part of the order, add `renderInvoice()`." Each step is sensible in isolation. The root cause is a **missing boundary** — there was no clear answer to "where does email logic belong?", so it defaulted to "wherever it was first needed." Twelve sprints later it's 2,000 lines. The middle skill is noticing the *third method that doesn't belong* and drawing the boundary before the slope steepens.
</details>

**Q14. How does cohesion help you detect a forming God Object?**

<details><summary>Answer</summary>

Cohesion measures whether a class's methods actually use its fields. In a healthy class, most methods touch most fields. When you see *clusters* of methods that touch *disjoint* sets of fields — one group uses `balance`/`transactions`, another uses `smtpHost`/`emailTemplate` — those clusters are two classes wearing one name. Low cohesion (the field-cluster smell) is the earliest measurable signal of a God Object, well before line count alarms anyone. Extract each cluster into its own class and inject it.
</details>

**Q15. Why are boolean flag parameters an early Spaghetti symptom, and what's the alternative?**

<details><summary>Answer</summary>

Each boolean flag doubles the paths through a function body: `process(o, isRefund, skipEmail, dryRun)` packs up to eight behaviors into one body, and callers can't tell which combinations are even valid (`isRefund=true, dryRun=true`?). The body becomes a maze of interacting `if`s — spaghetti. The alternative is to **split by behavior**: `processOrder`, `refundOrder`, `previewOrder`. If the behavior differs, the function should differ. When options genuinely co-vary, pass an explicit options object or enum so illegal combinations can't be expressed.
</details>

**Q16. You suspect a 200-line module is dead. List three independent ways to gather evidence before deleting it.**

<details><summary>Answer</summary>

1. **Coverage** — run the test suite (and, better, production traffic) with coverage instrumentation; code that never executes is a strong delete candidate.
2. **Telemetry** — add a temporary log line or counter at the suspicious entry point, ship it, and watch for a week of real traffic. If it never fires, it's dead.
3. **`git blame` + ticket archaeology** — find when and why it was added; the linked ticket is often long closed, so the reason to keep it no longer exists.

(Bonus: static dead-code analysis — `deadcode` in Go, `vulture` in Python, IDE inspections in Java.) Combine evidence, then delete in its own commit with the evidence in the message.
</details>

**Q17. When is an interface with exactly one implementation *justified* rather than a Boat Anchor?**

<details><summary>Answer</summary>

When it earns its keep *today*, not for a hypothetical future. Justified reasons: it's a **test seam** (you inject a fake/mock — e.g. a `Clock` interface so tests can fix time); it's a **published API contract / module boundary** that other teams or packages depend on; or there's a **confirmed near-term second implementation** with a ticket. It's a Boat Anchor when the only justification is "in case we swap it later" with no real consumer. The discriminating question is: *does this abstraction provide value with the single implementation it has now?*
</details>

**Q18. How do you decide between guard clauses and polymorphism when flattening nested code?**

<details><summary>Answer</summary>

Look at *what* the nesting dispatches on. Nesting from **validation / preconditions** (null checks, range checks, permission checks) → **guard clauses** with early returns. Nesting from **dispatching on a type or state value** (`if instanceof Circle ... else if Square`) → **polymorphism** (let each type render itself) or a **handler map** keyed by the value. If both are present, guard the validation first, then dispatch the remainder. The principle: guard clauses remove *gatekeeping* depth; polymorphism/maps remove *branching-by-kind* depth — different diseases, different cures.
</details>

**Q19. Why should a structural refactor and a behavioral fix never share a commit?**

<details><summary>Answer</summary>

Because a refactor is *defined* by preserving behavior, so if tests stay green you have proof you didn't break anything. The moment you mix in a behavioral change, a red test could mean either "the refactor broke something" or "the new behavior is wrong" — you've destroyed the signal. Separate commits also make review and `git bisect` precise, and let you revert the structural change without losing the fix (or vice versa). Discipline: green → extract one piece → green → commit; behavioral changes get their own commit.
</details>

**Q20. What's a characterization test and when do you write one?**

<details><summary>Answer</summary>

A characterization test pins down *what the code currently does*, not what it *should* do, before you refactor it. You write one when you need to refactor tangled or legacy code that lacks tests: you exercise the code, observe the actual outputs (even surprising ones), and assert them. This freezes existing behavior — including latent bugs — so any change during the refactor that alters behavior shows up as a failing test. It's the safety net that makes refactoring a God Object or Spaghetti code safe; fixing the bugs you discover is a separate, later step.
</details>

**Q21. What's the danger of "tidying up" Lava Flow by renaming and reorganizing it?**

<details><summary>Answer</summary>

It signals the code is *alive and cared for*, which makes it harder to delete later — the next person sees recently-touched, nicely-named code and assumes it matters. You also spend effort polishing something that should disappear, and you may introduce a behavioral change in code nobody understands. With Lava Flow there are really only two honest moves: **prove it's dead and delete it**, or **leave it untouched** until you can. Cosmetic grooming is the worst of both worlds.
</details>

**Q22. What review questions catch each anti-pattern while the change is still small?**

<details><summary>Answer</summary>

- **God Object:** "Does this new method use the class's existing fields, or new unrelated data?" New unrelated data → it belongs elsewhere.
- **Boat Anchor:** "How many call sites does this new abstraction have?" Zero → defer it; ask for the ticket that needs it.
- **Spaghetti:** "What happens if I call these functions in a different order?" "It breaks" → hidden ordering coupling.
- **Lava Flow:** "Why is this old branch still here?" "Not sure" → ask for evidence or deletion.
- **Arrow:** "What's the deepest indent?" 4+ → suggest guard clauses or dispatch.

Small, scoped PRs are the cheapest defense: a 40-line PR rarely hides a God Object; a 2,000-line one routinely does.
</details>

**Q23. Which metrics point toward bad structure, and what's the caveat?**

<details><summary>Answer</summary>

Lines-per-class and fan-in (a class everything imports) → God Object; methods-not-sharing-fields → low cohesion; cyclomatic complexity > ~10–15 and nesting depth > 3–4 → Arrow/Spaghetti; any dead-code-tool hit → Lava Flow/Boat Anchor candidate. The caveat: **metrics find candidates; they don't render verdicts.** A cohesive 600-line class can be fine; a tiny function with three boolean flags can be awful. Chasing a number can produce contorted code that satisfies the linter and confuses humans. Use numbers as smoke detectors, then judge with your eyes.
</details>

**Q24. Refactor this flag-driven Python function and explain the trade-off.**

```python
def export(data, as_pdf=False, as_csv=False, compress=False, dry_run=False):
    rows = serialize(data)
    if dry_run: return preview(rows)
    out = render_pdf(rows) if as_pdf else render_csv(rows) if as_csv else rows
    if compress: out = gzip(out)
    return write(out)
```

<details><summary>Answer</summary>

Split by behavior and make the format explicit:

```python
def export_pdf(data, compress=False):  return _emit(render_pdf(serialize(data)), compress)
def export_csv(data, compress=False):  return _emit(render_csv(serialize(data)), compress)
def preview(data):                      return _preview(serialize(data))

def _emit(out, compress):
    return write(gzip(out) if compress else out)
```

The flags `as_pdf`/`as_csv`/`dry_run` selected mutually-exclusive behaviors, so they belong in separate functions; illegal combos (`as_pdf=True, as_csv=True`) become unrepresentable. `compress` is a genuine modifier of one behavior, so it stays a parameter. **Trade-off:** more named entry points (slightly more surface area) in exchange for callers that read clearly and a body with no path explosion. If formats grow, a `format` enum + dispatch table scales better than more functions.
</details>

**Q25. Your `UserService` has 18 methods: 6 touch `passwordHash`/`salt`, 12 touch `profile`/`preferences`. What does this tell you and what's the refactor?**

<details><summary>Answer</summary>

Two field-clusters in one class = low cohesion, a God Object forming. The class has two reasons to change (credentials vs. profile) serving potentially two actors (security team vs. product team). Refactor: extract the credentials cluster into a `Credentials`/`PasswordService` and the profile cluster into `UserProfile`, then either make `UserService` a thin coordinator that delegates, or remove it entirely if callers can talk to the two focused classes directly. Do it incrementally with characterization tests, one extracted method at a time, structural commits separate from any fixes.
</details>

---

## Senior — Refactoring at Scale & Root Causes

> Large-system refactoring, organizational root causes, and when *not* to refactor.

**Q26. How do you refactor a 5,000-line God Object that's in active production use, without a big-bang rewrite?**

<details><summary>Answer</summary>

Use the **Strangler Fig** approach: grow the replacement around the old code and redirect call sites incrementally until the old object is dead, then delete it. Concretely: (1) pin current behavior with characterization tests; (2) identify a cohesive seam — one responsibility (say, invoicing) whose methods share fields; (3) extract it into a focused class behind the God Object, delegating from the old methods so callers are unaffected; (4) migrate callers to the new class directly, one at a time, each behind small green-to-green commits; (5) repeat per responsibility; (6) when the God Object is an empty shell, delete it. Each step is reversible and shippable, so you're never on a long-lived divergent branch.
</details>

**Q27. What is a "seam" and why does it matter when breaking up tangled code?**

<details><summary>Answer</summary>

A seam (Michael Feathers' term) is a place where you can alter behavior without editing the code in that place — typically by substituting a dependency. Seams matter because tangled code resists testing: you can't isolate the piece you want to change. Introducing a seam (extract an interface, inject a collaborator, parameterize a constructor) lets you get a characterization test around the behavior, which is the prerequisite for safe refactoring. The art is finding the *least invasive* seam — often "sprout" a new method/class and route through it — so you create test coverage before you start moving large pieces.
</details>

**Q28. What organizational or process forces breed these anti-patterns? It's not just bad developers.**

<details><summary>Answer</summary>

Several systemic forces: **deadline pressure** rewards the cheap local "add a flag" over the costlier "draw a boundary"; **no clear ownership/architecture** means new behavior has no obvious home, so it lands in a catch-all; **fear culture** (blame for breaking prod) keeps Lava Flow alive because deleting feels riskier than hoarding; **large, infrequent PRs** hide structural drift from review; **resume-driven or speculative design** produces Boat Anchors; and **high turnover** erases the context that would let someone delete dead code confidently. Conway's Law also bites — fuzzy team boundaries produce fuzzy module boundaries. Fixing structure durably means addressing these forces, not just the code.
</details>

**Q29. When should you *not* refactor bad structure?**

<details><summary>Answer</summary>

When the cost outweighs the benefit. Don't refactor code that is **stable and rarely touched** — an ugly module nobody edits has near-zero change-cost, so the refactor is a speculative investment with no payoff; spend the risk budget where churn is high. Don't refactor code **slated for deletion or replacement** soon. Don't refactor **without a safety net** if you can't first establish characterization tests on critical paths. Don't refactor under a hard deadline where the change isn't on the critical path of the feature. And don't "improve" Lava Flow you don't understand and can't prove dead. Refactor where change is frequent, the structure actively impedes upcoming work, and you can do it safely.
</details>

**Q30. You inherit a Spaghetti module driven by global mutable state. What's your sequence of moves?**

<details><summary>Answer</summary>

(1) **Characterize** — get tests around observable behavior, treating the global state as the system boundary. (2) **Make dependencies explicit** — convert the most-touched globals into parameters/return values, one at a time, so data flow becomes visible (input → output) rather than telepathic. (3) **Localize remaining state** — wrap stubbornly-shared state in a small object whose methods enforce valid transitions, so callers can't set fields in the wrong order; this often becomes a small state machine. (4) **Split order-dependent functions** into an explicit pipeline where each step's output feeds the next. (5) **Delete** any branches proven dead along the way. Each step green-to-green; never the whole thing at once.
</details>

**Q31. How do feature flags both cause and cure Lava Flow?**

<details><summary>Answer</summary>

**Cause:** a flag added "until we're sure the new path works" rarely gets removed. The flag goes `true` permanently, the old branch fossilizes behind `if (!flag)`, and over years the codebase accretes strata of dead branches guarded by flags nobody dares flip. **Cure:** flags are also the disciplined way to *retire* code — flip the new path on, monitor, and once telemetry confirms the old branch never executes, delete the branch *and the flag together* in one commit. The anti-pattern isn't the flag; it's the missing cleanup step. Mature teams track flag lifetimes and treat a stale flag as a bug.
</details>

**Q32. Can over-correcting a God Object create a different anti-pattern? Which one?**

<details><summary>Answer</summary>

Yes — **Lasagna Code** (excessive layering), the inverse of Spaghetti. If you flatten one 2,000-line God Object into 30 one-line pass-through classes, following a single call now means opening eight files, each "adding" almost nothing. You've traded "too much in one place" for "too little in too many places." The goal is **cohesion**, not maximal smallness: each extracted class should own a real responsibility and pull its weight. Extract by *reason to change*, and collapse layers that don't earn their existence. (See [Over-Engineering](../03-over-engineering/middle.md).)
</details>

**Q33. Splitting one 2,000-line God Object into two 1,000-line classes — good or bad?**

<details><summary>Answer</summary>

Bad if you split by *line count* — you've made two God Objects. Splitting must be by *responsibility / reason to change*, not by size. The right cut produces several **cohesive** units (a `PaymentGateway`, an `InvoiceRenderer`, an `EmailSender`) each with a single clear job, plus a thin coordinator — regardless of whether that yields two pieces or eight, and regardless of their individual sizes. Line count is a symptom that *prompts* the investigation, never the axis you cut along.
</details>

**Q34. How do you make "delete the dead code" safe enough that the team actually agrees to it?**

<details><summary>Answer</summary>

Replace fear with evidence and reversibility. Gather independent signals (zero coverage + no production telemetry over a defined window + closed originating ticket + static-analysis confirmation), write them into the commit message, and delete in an isolated, easily-reverted commit ("removed: 0 coverage + no prod hits in 30d, PROJ-123 closed"). Pair it with a fast rollback path and, for risky cases, a brief deprecation window where the code logs-on-use before removal. The combination of *proof it's dead* + *git keeps history* + *cheap revert* is what converts "don't touch it" into a routine, low-drama deletion.
</details>

**Q35. A teammate argues "deep nesting is fine, the compiler optimizes it." How do you respond?**

<details><summary>Answer</summary>

Agree on the narrow point and reframe the real one. Yes — nesting depth has essentially no runtime cost; the compiler flattens branches into the same machine code regardless of source indentation, so this is *not* a performance argument. But the cost of Arrow code was never CPU cycles — it's **human comprehension and change-cost**. Deep nesting forces a reader to hold many open conditions in working memory, hides the happy path, and makes adding a precondition a structural edit. Guard clauses cost nothing at runtime and pay off every time someone reads or modifies the function. We optimize this for the maintainer, not the CPU.
</details>

**Q36. How do you prioritize which bad-structure problems to fix when everything is messy?**

<details><summary>Answer</summary>

Prioritize by **change-frequency × pain**, not by ugliness. Pull commit history to find the files with the highest churn (and the highest bug density / revert rate) — those are where bad structure costs the most, because the tax is paid on every edit. A hideous-but-frozen module ranks low; a moderately messy file touched in every sprint ranks high. Within the hot spots, fix what *blocks the upcoming roadmap* first, refactor opportunistically alongside feature work (boy-scout rule) rather than as a separate "cleanup project," and keep each change small and shippable. Let the data, not the disgust, set the order.
</details>

**Q37. What's the relationship between coupling, cohesion, and these anti-patterns?**

<details><summary>Answer</summary>

They're the two axes that define structural health. **Cohesion** = how well a unit's parts belong together; **coupling** = how much units depend on each other. God Objects are **low-cohesion** (many unrelated jobs in one class) *and* create **high coupling** (everything imports them). Spaghetti is high coupling through shared state. Lasagna (the over-correction) is excessive coupling-by-indirection across layers. The durable target is **high cohesion, low coupling**: each unit does one thing well and depends on few others through narrow, explicit interfaces. Every cure in this topic moves the code along one or both axes.
</details>

---

## Professional / Deep — Performance, GC, Toolchain

> Runtime, memory, build, and tooling implications.

**Q38. Does a God Object have measurable *runtime* costs, or is it purely a maintainability concern?**

<details><summary>Answer</summary>

Mostly maintainability, but there are real runtime edges. A God Object with many fields makes for **fat instances** — larger heap footprint per object and worse cache locality, since unrelated data (payment state next to email templates) shares a cache line that's rarely accessed together. In GC'd runtimes, a long-lived God Object that holds references to many subsystems can keep otherwise-collectible objects alive (a retention/leak vector). In the JVM, a giant method can exceed the JIT's inlining threshold (the 8000-bytecode `HugeMethodLimit`) and never get compiled hot, staying interpreted. These are secondary to the change-cost, but a strong candidate names them rather than claiming "no runtime impact."
</details>

**Q39. How can Lava Flow / Boat Anchor code hurt you even though it never executes?**

<details><summary>Answer</summary>

It's "dead" at runtime but very much alive everywhere else. It **inflates the build**: more code to compile, larger binaries/bundles, slower CI. In shipped clients (mobile, web bundles), unused code that the bundler can't tree-shake is dead weight users download. It **enlarges the dependency graph**: a Boat Anchor library pulls transitive deps you must patch for CVEs and keep license-compliant — security and legal cost for zero benefit. It **slows tooling**: every grep, IDE index, static-analysis pass, and refactor scans it. And it **misleads humans**, which is its own tax. "Storage is cheap" misframes the cost — the cost is in attention, build time, attack surface, and comprehension, none of which are cheap.
</details>

**Q40. Why might dead code survive dead-code elimination, and what does that imply for relying on the compiler to "remove" it?**

<details><summary>Answer</summary>

Dead-code elimination and tree-shaking are conservative: they only remove what they can *prove* unreachable. Reflection, dynamic dispatch, dependency-injection containers, plugin registries, exported public symbols, and `init()`-style side effects all defeat the analysis — the tool must assume the code might be called. So a Boat Anchor exposed as a public API, registered in a DI container, or reachable via reflection will *not* be stripped and ships in the binary. The implication: you can't outsource the deletion decision to the optimizer. Human deletion (backed by git) is what actually removes the maintenance and comprehension cost; the compiler only sometimes saves the bytes.
</details>

**Q41. How does cyclomatic complexity interact with test coverage and CI cost?**

<details><summary>Answer</summary>

Cyclomatic complexity is a lower bound on the number of test cases needed for full **path/branch coverage** — N independent paths need at least N tests to exercise them all. A Spaghetti/Arrow function with complexity 30 demands a combinatorial pile of tests to cover honestly, so teams usually *don't*, leaving branches untested and bug-prone. High complexity also slows static analyzers and can blow up symbolic-execution / fuzzing tools that explore paths. Flattening (guard clauses, polymorphism, extracted methods) lowers per-unit complexity, which directly reduces the tests required and the CI time to run them. Complexity is thus both a readability and a *testability/throughput* metric.
</details>

**Q42. What tools would you reach for to *quantify* each anti-pattern in a real codebase?**

<details><summary>Answer</summary>

- **Dead code (Lava Flow / Boat Anchor):** `deadcode`/`staticcheck` (Go), `vulture` (Python), IDE inspections / `unused` warnings (Java/Kotlin), bundler analyzers (`source-map-explorer`, `webpack-bundle-analyzer`) for frontend.
- **Cyclomatic complexity / nesting (Arrow / Spaghetti):** `gocyclo` (Go), `radon cc` (Python), Checkstyle/PMD/SonarQube (Java).
- **God Object / cohesion / coupling:** `cloc` for size, dependency/fan-in tools, SonarQube class-level metrics, LCOM (Lack of Cohesion of Methods) where available.
- **Churn correlation:** `git log` heatmaps (e.g. `code-maxat`/`code-maat`, or scripted `git log --format` aggregation) to find high-churn hotspots worth fixing.

The principle stays: tools surface candidates; engineering judgment confirms.
</details>

**Q43. Can refactoring a God Object ever *regress* performance, and how do you guard against it?**

<details><summary>Answer</summary>

Yes. Splitting one class into many can introduce indirection that costs cycles: extra virtual/interface dispatch (harder to inline and devirtualize), more small objects (more allocations and GC pressure), and lost data locality if related fields end up scattered across objects. Over-layering (Lasagna) compounds this. Guard against it by treating performance as a behavior to preserve: benchmark hot paths *before* refactoring, keep the structural change separate from any perf tuning, re-benchmark after, and let the profiler — not intuition — flag regressions. In practice the dispatch overhead is negligible for the vast majority of code; you only sweat it on proven hot paths, where you might keep a flatter design deliberately.
</details>

**Q44. How does bad structure affect incremental compilation and build caching?**

<details><summary>Answer</summary>

A God Object is a **recompilation magnet**: because it's imported almost everywhere, touching it invalidates the build cache for most of the project, so trivial edits trigger near-full rebuilds and bust CI caches. High coupling generally widens the recompilation blast radius. Spaghetti's tangled cross-file dependencies do the same. Breaking the God Object into focused, narrowly-imported modules shrinks each change's dependency cone, so edits recompile less and incremental/cached builds stay fast. This is a concrete, measurable payoff of good structure that goes beyond developer comfort — it speeds the whole feedback loop.
</details>

---

## Code-Reading — Name the Anti-Pattern

> You're shown a snippet; identify the anti-pattern(s) and state the fix.

**Q45. Which anti-pattern, and what's the fix?**

```python
state = {}
def step1(d): state['parsed'] = parse(d); state['ready'] = True
def step2():  state['valid'] = check(state['parsed'])   # crashes if step1 didn't run
def step3():
    if state.get('ready') and state.get('valid'):
        do_it(state['parsed'])
```

<details><summary>Answer</summary>

**Spaghetti Code.** Functions communicate through a shared mutable `state` dict and only work in a precise, implicit order (`step1` → `step2` → `step3`); call them out of order and they crash or silently no-op. Fix: make data flow explicit — pass values in, return values out — so the ordering is encoded in the code, not in someone's head:

```python
def run(d):
    parsed = parse(d)
    if not check(parsed):
        return
    do_it(parsed)
```
</details>

**Q46. Which anti-pattern, and what's the fix?**

```go
// TODO: not sure why this is here. DO NOT REMOVE — broke prod in 2019??
func recalcLegacy(x int) int {
    tmp := x * 2
    _ = tmp
    return oldFormula(x)
}
```

<details><summary>Answer</summary>

**Lava Flow.** The hallmark is the nervous "don't remove, not sure why" comment guarding code nobody understands, plus an obviously dead local (`tmp` assigned then discarded). Fix: don't groom it — *prove it's dead*. Check coverage and production telemetry, run `git blame`/log to find the originating ticket, and if it's unreachable or unused, delete it in its own commit with the evidence recorded. Git keeps the history if 2019 ever returns.
</details>

**Q47. Which anti-pattern, and what's the fix?**

```java
public class AppManager {
    public void createUser(...) { /* validation + DB */ }
    public void chargeCard(...) { /* Stripe */ }
    public void sendEmail(...) { /* SMTP */ }
    public String renderPage(...) { /* HTML */ }
    public void exportCsv(...) { /* file I/O */ }
    // ...44 more methods, 22 fields...
}
```

<details><summary>Answer</summary>

**God Object** — the vague `Manager` name and the spread across user management, payments, email, rendering, and file I/O are five unrelated responsibilities in one class. Fix: extract by responsibility into focused collaborators (`UserService`, `PaymentGateway`, `EmailSender`, `PageRenderer`, `CsvExporter`), inject them, and replace `AppManager` with a thin coordinator or remove it. Do it incrementally behind characterization tests via a Strangler Fig migration.
</details>

**Q48. Which anti-pattern, and what's the fix?**

```go
func handle(r *Req) error {
    if r != nil {
        if r.Auth() {
            if r.Valid() {
                if r.Quota() > 0 {
                    return do(r)
                } else { return errQuota }
            } else { return errInvalid }
        } else { return errAuth }
    }
    return errNil
}
```

<details><summary>Answer</summary>

**Arrow Anti-Pattern** — sequential preconditions nested into a rightward pyramid, with the only meaningful line (`do(r)`) buried deepest. Since the nesting is all *validation*, the fix is guard clauses:

```go
func handle(r *Req) error {
    if r == nil       { return errNil }
    if !r.Auth()      { return errAuth }
    if !r.Valid()     { return errInvalid }
    if r.Quota() <= 0 { return errQuota }
    return do(r)
}
```
</details>

**Q49. Which anti-pattern, and what's the fix?**

```go
type ReportExporter interface {
    ExportPDF(r Report) error
    ExportXLSX(r Report) error
    ExportXML(r Report) error  // no caller has ever requested XML
}
// 300 lines implementing all three; the app only ever calls ExportPDF.
```

<details><summary>Answer</summary>

**Boat Anchor.** Two of the three formats (XLSX, XML) have zero call sites — built "in case we need it," never used. Unlike Lava Flow, the team *understands* this code; it's just unused speculation (a YAGNI violation). Fix: delete the unused methods and their implementations, narrowing the interface to what's actually called (`ExportPDF`). When a real XML requirement with a ticket appears, add it back — better-designed against the real need. Git preserves the old implementation.
</details>

**Q50. This snippet shows two anti-patterns at once — name both.**

```java
void run(Order o, boolean refund, boolean skipMail) {
    if (o != null) {
        if (refund) {
            if (o.paid) { /* ...30 lines... */ }
        } else {
            if (o.valid) {
                if (!skipMail) { /* ...40 lines... */ }
            }
        }
    }
}
```

<details><summary>Answer</summary>

**Arrow Anti-Pattern** (deep nesting via `if (o != null) { if (refund) { if (o.paid)...`) *and* **Spaghetti-by-flags** (the `refund`/`skipMail` booleans crammed mutually-exclusive behaviors into one body, multiplying paths). They reinforce each other: the flags create the branches that become the nesting. Fix both at once — split by behavior into `runOrder` / `refundOrder` (kills the flags), then apply guard clauses inside each (`if (o == null) return;` …), flattening the nesting. The two methods are now linear and independently testable.
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q51. Is a big file always a God Object?**

<details><summary>Answer</summary>

No. Size is a symptom that *prompts* investigation, not the definition. A 1,500-line file of cohesive, single-purpose functions — say, a parser with many small productions, or a generated file — is perfectly fine. The God Object problem is *many unrelated responsibilities*, i.e. low cohesion and many reasons to change, not line count alone. Conversely, a 200-line class can be a God Object if those lines span auth, billing, email, and reporting. Judge by responsibilities and cohesion; let line count send you to look, not conclude.
</details>

**Q52. "Why not just keep dead code? Storage is cheap."**

<details><summary>Answer</summary>

Because the cost was never storage. Dead code taxes the things that *are* expensive: **human attention** (every reader must determine whether it's live and reason about it), **build and CI time**, **bundle/binary size** users download, **attack surface and dependency maintenance** (a dead library still needs CVE patches and license compliance), and **tooling speed** (every grep, index, and refactor scans it). It also actively misleads — people reason about behavior that never runs and depend on Boat Anchors that ossify. Disk is cheap; comprehension, security, and feedback-loop latency are not. Git already stores the bytes for free, so deletion loses nothing and recovers all of that.
</details>

**Q53. When is deep nesting actually acceptable?**

<details><summary>Answer</summary>

When the nesting reflects *essential* structure of the problem rather than avoidable gatekeeping. Two nested loops over a genuine 2D grid, recursion that mirrors a recursive data structure (tree/JSON traversal), or a tight numeric kernel where extracting helpers would hurt clarity or performance — these are legitimately nested. The Arrow anti-pattern is specifically *accidental* depth: sequential validations that should be guard clauses, or type/state dispatch that should be polymorphism. Ask "is this depth inherent to the problem, or am I just failing to flatten it?" Inherent → leave it; avoidable → flatten it.
</details>

**Q54. When is an interface with one implementation NOT a Boat Anchor?**

<details><summary>Answer</summary>

When it earns value today rather than for a hypothetical future. Legitimate single-impl interfaces: a **test seam** (you inject a fake — e.g. `Clock`, `Mailer`, `Repository` — to test callers in isolation); a **published API / module boundary** other code or teams compile against; a **plugin/extension contract** even if only one plugin ships now; or a **confirmed near-term second implementation** with an actual ticket. It *is* a Boat Anchor only when the sole justification is "we might swap it later" with no current consumer. The discriminator is present-day value, not future possibility.
</details>

**Q55. A senior says "we don't have time to refactor." Is refactoring always the right call?**

<details><summary>Answer</summary>

No — "always refactor" is as wrong as "never refactor." Refactoring is an investment that pays off only where code changes often; on stable, rarely-touched code the return is near zero. The mature framing isn't "refactor vs. ship" but "where does cleaning up *reduce the cost of the work in front of us?*" If the messy code is on the critical path of the current feature and slowing it down, refactoring *is* the fastest way to ship — clean as you go. If it's unrelated and frozen, defer it. So the honest answer to the senior is: agree we won't run a separate cleanup project, but refactor opportunistically the parts we're already touching, because that's cheaper than working around them.
</details>

**Q56. Isn't naming a class `Util` or `Helper` just a harmless convention?**

<details><summary>Answer</summary>

It's not harmless — it's a structural trap. A name that describes no responsibility offers no resistance to *any* addition, so it becomes the default dumping ground whenever someone can't decide where code belongs. `StringUtils` is borderline-defensible for genuinely generic string operations, but `OrderHelper`, `AppUtil`, `Manager` reliably grow into God Objects precisely because nothing about the name says "that doesn't belong here." Precise names draw boundaries; vague names erase them. The convention isn't neutral; it actively shapes where future code lands.
</details>

**Q57. If the team can't agree whether something is dead code, what do you do?**

<details><summary>Answer</summary>

Resolve disagreement with *data*, not debate. Instrument it: add a log/counter on use and ship to production, or check coverage from real traffic over an agreed window (say 30–90 days, long enough to cover monthly/quarterly jobs). Combine with `git blame` to find the originating reason and whether it still holds. If after the window it never fired, you have an objective basis to delete. For extra safety, a "log-loudly-on-use then delete next release" deprecation step converts opinion into evidence. The goal is to make the decision falsifiable rather than a contest of confidence.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q58. One-line cure for each of the five?**

<details><summary>Answer</summary>

God Object → extract by responsibility, inject collaborators (SRP). Spaghetti → explicit data in/out, kill shared mutable state. Lava Flow → prove dead (coverage/telemetry/blame), then delete. Boat Anchor → YAGNI; delete, git keeps it. Arrow → guard clauses for validation, polymorphism/handler-map for dispatch.
</details>

**Q59. The catchphrase that signals a Boat Anchor?**

<details><summary>Answer</summary>

"We might need this someday." *Someday* is not a requirement — that's YAGNI.
</details>

**Q60. The comment that signals Lava Flow?**

<details><summary>Answer</summary>

"Don't remove this — not sure why it's here." Uncertainty is the disease; evidence-backed deletion is the cure.
</details>

**Q61. Fastest visual tell of Arrow code?**

<details><summary>Answer</summary>

The indentation marches steadily rightward and the deepest line is the one that matters.
</details>

**Q62. One sentence: why do these anti-patterns cluster?**

<details><summary>Answer</summary>

They share one root habit — *adding code is easier than shaping it* — so each makes the next one cheaper to commit (a God Object's tangle becomes Spaghetti, replaced paths become Lava Flow, and so on).
</details>

**Q63. Two golden rules for fixing them?**

<details><summary>Answer</summary>

Pay the small shaping cost now — it's cheaper than the global cost later. And never refactor structure without a test pinning behavior, nor mix structural and behavioral changes in one commit.
</details>

**Q64. SRP in one sentence, and which anti-pattern it most directly counters?**

<details><summary>Answer</summary>

A class should have one reason to change — directly the cure for the God Object.
</details>

**Q65. What's the relationship between Spaghetti and Lasagna?**

<details><summary>Answer</summary>

Opposite failures of structure: Spaghetti is too little layering (tangled flow, no boundaries); Lasagna is too much (so many thin layers that one call spans eight files). The target is between them — cohesive units, narrow interfaces.
</details>

---

## How to Talk About Anti-Patterns in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the *cost*, not the label.** Don't just say "that's a God Object." Say *why it hurts* — "it has many reasons to change, so every team's work collides in one file, and it can't be tested without standing up the whole system." Interviewers want the reasoning, not the vocabulary.
- **Always name the trade-off.** Senior signal is acknowledging the *other side*: refactoring has risk and cost; abstractions can become Boat Anchors; over-splitting yields Lasagna. "It depends, and here's on what" beats absolutism.
- **Show you'd refactor *safely*.** Mention characterization tests, small reversible steps, separating structural from behavioral commits, and Strangler Fig for big ones. This proves you've done it in production, not just read about it.
- **Distinguish "I'd fix this" from "I'd fix it now."** Knowing *when not to refactor* (stable, low-churn, soon-to-be-deleted code) is a stronger signal than reflexively cleaning everything. Prioritize by change-frequency × pain.
- **Tie it to runtime/toolchain when asked to go deep.** Recompilation blast radius, bundle size, JIT inlining limits, conservative dead-code elimination — these show depth beyond the maintainability story.
- **Avoid purism.** "Big file = bad," "every interface needs two impls," "always early-return" are juniorisms. Calibrate: size prompts investigation; cohesion decides; essential nesting is fine.
- **Use a concrete example from your experience.** "We had a 4k-line `BillingManager`; here's how we strangled it over a quarter" lands far harder than a definition.

---

## Summary

- The five bad-structure anti-patterns are recognizable **shapes** that inflate the cost of the *next* change: **God Object** (too many responsibilities), **Spaghetti** (no structure / hidden state), **Lava Flow** (unexplained dead code), **Boat Anchor** (unused speculative code), and **Arrow** (avoidable deep nesting).
- Recognition is the junior bar; the middle bar is knowing *when each creeps in* and the small countermove; the senior bar is *safe refactoring at scale*, *root-cause / organizational forces*, and *when not to refactor*; the professional bar is the *runtime, GC, build, and tooling* consequences.
- The strongest interview answers lead with **cost and reasoning**, name **trade-offs**, demonstrate **safe incremental refactoring** (characterization tests, separate commits, Strangler Fig), and **prioritize by change-frequency**, not disgust.
- Common curveballs hinge on the same insight: judge by **responsibilities, cohesion, and present-day value** — not by size, future possibility, or "storage is cheap."

---

## Related Topics

- [`junior.md`](junior.md) — recognize each shape and avoid creating it.
- [`middle.md`](middle.md) — when each creeps in and the everyday countermoves.
- [`senior.md`](senior.md) — refactoring at scale, root causes, and when not to refactor.
- [`professional.md`](professional.md) — performance, GC, build, and toolchain implications.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — practice the diagnosis and cleanup.
- [Clean Code → Classes](../../../clean-code/09-classes/README.md) — cohesion and SRP, the God Object cure.
- [Clean Code → Functions](../../../clean-code/02-functions/README.md) — small functions, guard clauses, flag arguments.
- [Refactoring → Code Smells](../../../refactoring/01-code-smells/README.md) — Large Class, Long Method, the smell-level view.
- [Refactoring → Refactoring Techniques](../../../refactoring/02-refactoring-techniques/README.md) — Extract Class/Method, Replace Conditional with Polymorphism, characterization tests.
- [Over-Engineering](../03-over-engineering/middle.md) — YAGNI, Boat Anchor's neighbor, and Lasagna (the over-correction).
- [Bad Shortcuts](../02-bad-shortcuts/middle.md) — the sibling category of convenience that compounds.