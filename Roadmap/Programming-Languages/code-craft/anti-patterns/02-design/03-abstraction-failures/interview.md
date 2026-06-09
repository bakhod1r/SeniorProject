# Abstraction Failures Anti-Patterns — Interview Q&A

> **Category:** [Design Anti-Patterns](../README.md) → **Abstraction Failures** — *the chosen abstraction fights the problem instead of fitting it.*
> **Covers (collectively):** Golden Hammer · Inner-Platform Effect · Interface Bloat · Premature Abstraction

A bank of 60+ interview questions and answers spanning recognition, design judgment, root-cause analysis, and runtime/toolchain implications. Each answer models the reasoning a strong candidate gives — including the trade-offs. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Design Judgment & Migration at Scale](#senior--design-judgment--migration-at-scale)
4. [Professional / Deep — DSL Cost, Dispatch, Wrong-Tool Performance](#professional--deep--dsl-cost-dispatch-wrong-tool-performance)
5. [Code-Reading — Name the Anti-Pattern](#code-reading--name-the-anti-pattern)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [How to Talk About Anti-Patterns in Interviews](#how-to-talk-about-anti-patterns-in-interviews)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, recognition, and the "why is it bad" reasoning.

**Q1. Name the four abstraction-failure anti-patterns and give a one-line symptom for each.**

<details><summary>Answer</summary>

- **Golden Hammer** — every problem solved with the same tool/pattern/data structure because the author knows it well ("when all you have is a hammer, everything looks like a nail").
- **Inner-Platform Effect** — a configurable system grows until it's a worse, slower re-implementation of the platform it runs on (a homemade rule engine, an in-database scripting language).
- **Interface Bloat** — an interface has so many methods no realistic implementer supports them all, so "implementations" throw `UnsupportedOperationException`.
- **Premature Abstraction** — an abstract base / strategy / factory introduced before the second concrete case exists; the shape is guessed and almost always wrong.

The common thread: the abstraction *level* or *shape* is wrong for the problem — too generic, too early, too broad, or simply the wrong tool re-applied out of habit.
</details>

**Q2. What does "abstraction" actually mean, and what makes one *good*?**

<details><summary>Answer</summary>

An abstraction is a boundary that lets you use something through a simplified contract while hiding its details — a `Reader` interface hides whether bytes come from a file, socket, or memory. A *good* abstraction is one where the contract is genuinely simpler than the implementations behind it **and** the implementations vary in ways the contract captures cleanly. It earns its keep by letting callers ignore differences that don't matter to them. A *failed* abstraction either hides nothing real (Premature Abstraction with one implementation), forces every implementer to support things they can't (Interface Bloat), or reinvents capabilities the platform already provides (Inner-Platform Effect).
</details>

**Q3. Why is the Golden Hammer a problem if the tool "works"?**

<details><summary>Answer</summary>

"Works" measures whether output is correct, not whether the solution fits. The Golden Hammer reaches a working answer by *forcing* a familiar tool onto a poorly-matched problem — storing relational data in Redis because the author loves Redis, modeling a simple config as a full plugin framework because they always reach for plugins. The cost shows up later: awkward data access, performance cliffs, accidental complexity, and a solution future readers must decode against the grain of the problem. The tool isn't wrong in general; it's wrong *here*, and the reason it was chosen was familiarity, not fit.
</details>

**Q4. What is the Inner-Platform Effect? Give a concrete example.**

<details><summary>Answer</summary>

It's when a system meant to be *configurable* grows so much configurability that it becomes a general-purpose programming platform — a worse, slower one than the language or runtime it's already built on. Classic example: a "rules engine" that starts as a few `if` conditions in a config table, then grows operators, then variables, then loops, then a custom expression syntax — until you've built a buggy interpreter for a language nobody documented. Another: storing application logic as rows in a database with a `next_step_id` column, reinventing control flow. The tell is that you're re-implementing variables, branching, or dispatch that the host language already has.
</details>

**Q5. What is Interface Bloat and how do you recognize it in code?**

<details><summary>Answer</summary>

An interface is bloated when it declares more responsibilities than any single implementer naturally has, so implementers are forced to stub methods they can't meaningfully support. The clearest tell is methods that throw `UnsupportedOperationException` / `NotImplementedError` / return `nil, ErrNotSupported`, or are left as empty no-ops. Java's `java.util.List` is the textbook case: an immutable list must still "implement" `add()` and `remove()`, so it throws at runtime. The interface promised more than its contract can honestly deliver across implementations — it violates the Interface Segregation Principle.
</details>

**Q6. What is Premature Abstraction, and why is it on this list of *failures*?**

<details><summary>Answer</summary>

Premature Abstraction is introducing a generalization — an abstract base class, a strategy interface, a factory, a generic `<T>` — before you have enough concrete cases to know what should actually vary. With a single implementation you're *guessing* the axis of variation, and that guess is almost always wrong because real requirements differ from imagined ones. It's a failure because the wrong abstraction is worse than no abstraction: it adds indirection now and, when the real second case arrives, it doesn't fit, so you must either contort the new case to match the bad shape or unwind the abstraction entirely.
</details>

**Q7. What is the "Rule of Three" and why three specifically?**

<details><summary>Answer</summary>

The Rule of Three (Don Roberts, popularized by Fowler) says: write it the first time, duplicate it the second time and tolerate the duplication, and only on the **third** occurrence extract the abstraction. Three matters because two points define infinitely many lines — with only two examples you can't tell which differences are essential (the real axis of variation) and which are coincidental. The third instance triangulates the shape: it reveals what genuinely varies across cases versus what merely looked similar. Abstracting at two is guessing; abstracting at three is observing.
</details>

**Q8. Why is "duplication is bad, so I'll abstract immediately" a junior mistake?**

<details><summary>Answer</summary>

Because it treats *all* duplication as equally bad and abstraction as free, when neither is true. Duplication is cheap to fix once you understand the real pattern, and it's *honest* — two similar blocks that drift apart simply get edited independently. A premature abstraction couples those blocks under a guessed contract; when they need to diverge, you bolt on flags and special cases until the abstraction is more complex than the duplication ever was. The mature reading is: tolerate duplication until the third instance shows you the true shape, then extract. "DRY" is about knowledge, not about textual similarity. See [DRY Principle](../../../clean-code/02-functions/README.md) for the knowledge-vs-text distinction.
</details>

**Q9. What's the difference between Golden Hammer and Inner-Platform Effect? They both sound like "wrong tool."**

<details><summary>Answer</summary>

Golden Hammer is **applying a known tool where it doesn't fit** — the tool exists, it's just mismatched (using a graph database for tabular data). Inner-Platform Effect is **building a new, worse tool** that duplicates a capability the platform already gives you for free (writing your own expression interpreter inside config). One is misuse of an existing thing; the other is needless re-creation of an existing thing. They can co-occur: a team whose Golden Hammer is "everything is configurable" tends to drift into building an Inner Platform.
</details>

**Q10. Give an everyday Golden Hammer that isn't about exotic databases.**

<details><summary>Answer</summary>

Reaching for a design pattern reflexively: wrapping every object creation in a Factory, putting a Strategy interface behind a single `if`, or modeling a three-state value as a full State pattern with classes. Or the data-structure version: using a `HashMap<String, Object>` for everything because maps are flexible, when a struct with named fields would be clearer and type-checked. Or the framework version: spinning up Kafka for a job that a database table and a cron would handle. The pattern is always "I know X well, so this is an X problem" rather than "what does this problem actually need?"
</details>

**Q11. Why is a wrong abstraction often described as more expensive than duplication?**

<details><summary>Answer</summary>

Because duplication's cost is *local and linear* — n copies, each editable independently — while a wrong abstraction's cost is *global and compounding*. Every caller now depends on the abstraction's contract, so fixing the shape means touching all of them. Worse, the usual reaction to a misfitting abstraction isn't to remove it but to *parameterize* it — add a boolean, a config flag, an optional hook — so it bends to the new case. Each patch makes the abstraction harder to understand and even harder to unwind, a ratchet that tightens over time. Sandi Metz's line captures it: "duplication is far cheaper than the wrong abstraction."
</details>

**Q12. What principle does Interface Bloat violate, and what's the cure in one sentence?**

<details><summary>Answer</summary>

It violates the **Interface Segregation Principle** — "no client should be forced to depend on methods it does not use." The cure is to split the fat interface into small **role interfaces**, each capturing one cohesive capability (`Reader`, `Writer`, `Closer` instead of one `Stream` that demands all three), so each implementer supports exactly what it can. See [SOLID / Classes](../../../clean-code/09-classes/README.md).
</details>

---

## Intermediate / Middle

> When it creeps in, what to do instead, and the trade-offs.

**Q13. Nobody sets out to build an Inner Platform — how does one actually grow?**

<details><summary>Answer</summary>

By a sequence of locally-reasonable "just one more knob" decisions. It starts as a legitimate small config — a threshold in a table. A stakeholder asks "can it depend on the region too?" → add a condition column. "Can conditions combine?" → add AND/OR. "Can it compute a value, not just match?" → add an expression field. Each step is a small, justified feature; none is the moment you decided to build a programming language. Twelve sprints later there's a `WHEN ... THEN ...` mini-syntax parsed by hand-rolled string splitting, with no debugger, no type checks, and no tests. The middle skill is noticing the third "can it also..." and asking whether you're now building an interpreter — and if so, exposing real code (a plugin, a callback) instead.
</details>

**Q14. You see a strategy interface with exactly one implementation. Is it always Premature Abstraction?**

<details><summary>Answer</summary>

No — context decides. It *is* premature if the only justification is "we might need other strategies later" with no concrete second case. It's *justified* if the single implementation buys value today: a **test seam** (you inject a fake to test callers in isolation), a **published boundary** other modules compile against, a **plugin contract** where third parties supply the other implementations, or a **confirmed near-term second case with a ticket**. The discriminating question is the same as for a Boat Anchor: *does this abstraction provide value with the one implementation it has now?* If yes, keep it; if the only value is hypothetical, defer it.
</details>

**Q15. How do you tell a *good* configurable system from an Inner Platform?**

<details><summary>Answer</summary>

Look at what's being configured. A good configurable system exposes **data and choices** — timeouts, feature flags, a list of enabled providers, a set of allowed values. An Inner Platform exposes **control flow and computation** — branching, loops, variables, expressions — which means users are now *programming* in your half-built language. The line is roughly: if a non-programmer could fill it in and the worst they can do is pick a wrong value, it's configuration; if expressing the config correctly requires understanding evaluation order, scope, or operator precedence, you've built a programming language and should expose real code instead.
</details>

**Q16. What's the cure for Interface Bloat, and what's the trade-off of applying it?**

<details><summary>Answer</summary>

Split the fat interface into small **role interfaces** along the lines of how clients actually use it, then have classes implement the subset they support and have callers depend only on the role they need (`func save(w Writer)` not `func save(s FullStream)`). The trade-off: you get more named types and the implementer must declare several interfaces, which is a little more ceremony. But callers become honest about their real dependencies, fakes become trivial (mock a two-method `Reader`, not a 20-method `Stream`), and you can no longer be forced to stub methods you can't support. In Go this is nearly free because interfaces are satisfied structurally; in Java/C# it costs a few `implements` clauses.
</details>

**Q17. Can you over-apply Interface Segregation? What does over-splitting look like?**

<details><summary>Answer</summary>

Yes. Taken to an extreme, every method becomes its own single-method interface, and a class that genuinely does three related things must declare and wire three interfaces that always travel together. Now callers that need the cohesive trio must accept three parameters, fakes must implement three types, and the conceptual unit is scattered. That's the mirror failure — fragmentation instead of bloat. The target is **cohesion**: group methods that real clients use *together* into one role, and split only where clients genuinely use *disjoint* subsets. ISP says "don't force unused dependencies," not "one method per interface."
</details>

**Q18. A teammate wants to extract a base class from two similar classes. What questions do you ask?**

<details><summary>Answer</summary>

1. *Are these two genuinely the same concept, or just textually similar right now?* Coincidental similarity drifts apart later.
2. *What exactly varies between them, and is that the axis you'd abstract on?* With only two cases the axis is a guess.
3. *Could composition work instead of inheritance?* A shared helper or injected collaborator avoids the rigid is-a contract and the [Fragile Base Class](../../../clean-code/09-classes/README.md) trap.
4. *What happens when the third case arrives — does the shape still hold?* If you can't answer, that's the signal to wait.

If the honest answer is "we have two and we're guessing," tolerate the duplication and revisit at three.
</details>

**Q19. How does the Golden Hammer relate to a team's hiring and tooling history?**

<details><summary>Answer</summary>

Tooling choices ossify around what the team already knows. A shop that grew up on MongoDB will model the next relational problem in MongoDB; a team of React experts will reach for a SPA even for a content site that wants server-rendered HTML. This is partly rational — operational familiarity and existing infrastructure have real value — and partly a trap, because "we know it" silently substitutes for "it fits." The middle-level move is to separate the two explicitly: name the actual requirements (access patterns, consistency, scale, latency), evaluate the familiar tool against them honestly, and only then decide whether familiarity outweighs fit. Sometimes it does; the failure is never asking.
</details>

**Q20. Two functions share five lines. When should you extract and when should you leave them?**

<details><summary>Answer</summary>

Ask whether those five lines represent **one piece of knowledge** or merely **similar text**. If they encode the same rule — and would always need to change together when that rule changes — extract; the duplication is a real DRY violation. If they look alike today but belong to different concepts that happen to coincide (two validation blocks that will diverge as their domains evolve), leave them; coupling them under one function means future divergence requires adding flags. The Rule of Three is the practical heuristic: at two occurrences you usually can't yet tell knowledge from coincidence, so wait for the third.
</details>

**Q21. What's the relationship between Flag Arguments and Interface Bloat / Premature Abstraction?**

<details><summary>Answer</summary>

Flag arguments are frequently the *symptom of a misfitting abstraction being stretched*. When one abstraction is forced to cover two behaviors it shouldn't, the usual patch is a boolean — `render(doc, asPdf=true)`, `process(req, legacy=false)`. That boolean is the abstraction admitting it should have been two things. The same dynamic bloats interfaces: rather than two role interfaces, you get one interface with a method whose behavior forks on a flag. The cure rhymes across all three — split by behavior. See [Flag Arguments](../01-oo-misuse/middle.md).
</details>

**Q22. What review questions catch each of these while the change is still small?**

<details><summary>Answer</summary>

- **Golden Hammer:** "What does this problem actually require, and did we evaluate alternatives, or is this our default tool?"
- **Inner-Platform Effect:** "Are we configuring data, or are we adding branching/loops/expressions? Could a plugin or callback do this instead?"
- **Interface Bloat:** "Will every implementer support every method, or will some throw `UnsupportedOperation`?"
- **Premature Abstraction:** "How many concrete cases exist today? If one, what value does the abstraction give *now*?"

A small PR rarely hides a wrong abstraction; a 1,500-line "extensible framework" PR for a one-off feature routinely does.
</details>

**Q23. Diagnose this Python and say what you'd do instead.**

```python
RULES = [
    {"if": "amount", "op": ">", "val": 100, "then_field": "discount", "then_val": 0.1},
    {"if": "region", "op": "==", "val": "EU", "then_field": "vat", "then_val": 0.2},
]

def apply_rules(order, rules):
    for r in rules:
        actual = getattr(order, r["if"])
        if eval_op(r["op"], actual, r["val"]):      # custom operator dispatch
            setattr(order, r["then_field"], r["then_val"])
```

<details><summary>Answer</summary>

**Inner-Platform Effect.** This is a hand-rolled rule interpreter: `op` strings dispatched through `eval_op`, fields addressed by string name via `getattr`/`setattr`, conditions and actions encoded as data. The next requests ("combine two conditions", "compute `then_val` from another field") push it toward variables and expressions — a buggy DSL with no type checking, no debugger, and stringly-typed field access that fails at runtime. Unless these rules are genuinely edited by non-engineers at runtime (a real requirement that justifies the cost), express them as **plain functions**:

```python
def discount_rule(order):
    if order.amount > 100:
        order.discount = 0.1

def eu_vat_rule(order):
    if order.region == "EU":
        order.vat = 0.2

RULES = [discount_rule, eu_vat_rule]
for rule in RULES:
    rule(order)
```

Now it's real code: type-checked, debuggable, testable, and using the language's own control flow instead of reinventing it. If business users truly need to author rules live, *that* is when a constrained DSL or rules engine earns its cost — a deliberate decision, not an accident.
</details>

**Q24. You have a `PaymentProvider` interface with one implementation, `StripeProvider`. Keep it or inline it?**

<details><summary>Answer</summary>

It depends on the value *today*. Payment is an area where a test seam is genuinely valuable — you almost certainly want to test order flows without hitting Stripe, so an interface you can fake earns its keep immediately, even with one real implementation. There's also a credible near-term second case (a second processor, or a sandbox vs. live provider). So here I'd keep it. Contrast with a `ReportFormatter` interface that has one `PdfFormatter` and no plausible second format and no testing benefit (you can test the formatter directly) — that one I'd inline until a real second format appears. Same shape, different verdict, because the discriminator is present-day value, not the count of implementations alone.
</details>

**Q25. How do you back out of a Premature Abstraction once you realize it's wrong?**

<details><summary>Answer</summary>

Inline it back toward duplication, then re-abstract from the real cases. Concretely: (1) pin behavior with characterization tests; (2) push the abstract logic back down into each concrete implementation, accepting temporary duplication — this is the *un-DRY* step that frees the cases to differ; (3) now that the cases are independent, observe how they actually vary across the (now ≥3) real instances; (4) extract the correct abstraction along the axis the real cases reveal, or decide the duplication is fine. The counter-intuitive part is step 2: you deliberately re-introduce duplication, because honest duplication is a better starting point for a correct abstraction than a wrong abstraction is.
</details>

---

## Senior — Design Judgment & Migration at Scale

> Designing the right abstraction level, organizational root causes, and migrating away from wrong ones.

**Q26. How do you migrate a large codebase off an Inner-Platform "rules engine" that's now load-bearing?**

<details><summary>Answer</summary>

Strangle it. (1) Characterize: capture the current behavior of the engine on real rule sets as golden tests, including the weird edge cases of its hand-rolled evaluator. (2) Pick the most painful rule category and re-express those rules as real code (functions/strategies) behind the same entry point, routing that category to the new path while everything else still flows through the engine. (3) Migrate categories one at a time, each green-to-green and shippable, comparing old-vs-new output in production (shadow mode) before cutting over. (4) When the last category is migrated, delete the interpreter and the rule storage. The key is never doing a big-bang rewrite of an interpreter whose exact semantics nobody fully documented — you discover those semantics by diffing against it under real traffic.
</details>

**Q27. What organizational forces breed Golden Hammer and Inner-Platform Effect?**

<details><summary>Answer</summary>

Several. **Skill concentration / hiring monoculture** — a team that only knows one stack applies it everywhere. **Resume-driven and curiosity-driven development** — engineers reach for the exciting tool, not the fitting one. **Misframed "flexibility" requirements** — a vague mandate to "make it configurable" with no bound invites an Inner Platform; nobody pushed back to ask *which* parts must vary. **Distance from operations** — teams that don't run what they build don't feel the cost of the exotic tool. **Reward for cleverness over fit** — a culture that praises sophisticated abstractions produces speculative ones. Fixing these durably means valuing *fit and simplicity* in design review and promotion, not just shipping.
</details>

**Q28. How do you choose the right abstraction *level* when you genuinely have variation to model?**

<details><summary>Answer</summary>

Anchor on the concrete cases, not on imagined ones. Enumerate the *real* instances you have today, list what actually differs among them, and let the **commonality across them define the contract** while the **differences define the methods that vary**. Resist contract members that only one case needs (that's bloat forming) and contract members no current case needs (that's premature generality). Prefer the smallest abstraction that covers today's cases plus changes you have concrete evidence are coming. If you must guess, guess *narrow* — it's cheaper to widen a too-tight abstraction later than to unwind a too-broad one. And prefer composition over inheritance so the shape stays cheap to change.
</details>

**Q29. When is building a DSL or rule engine the *right* call rather than an Inner-Platform Effect?**

<details><summary>Answer</summary>

When the audience and the volume justify the cost. Build a DSL/rule engine when: (1) **non-engineers must author and change logic at runtime** without a deploy (pricing analysts editing fraud rules, ops staff tuning alert thresholds) — a real, recurring need, not a hypothetical; (2) the **domain is stable and well-understood** enough to design a constrained language with clear semantics; (3) the **volume of rules** is large enough that code wouldn't scale operationally; and (4) you can afford to give it real engineering — a defined grammar, validation, testing, versioning, and tooling. The failure is sliding into a DSL *by accident*, one config knob at a time, with none of that rigor. A deliberate, well-tooled DSL is a legitimate design; an emergent, undocumented one is the anti-pattern.
</details>

**Q30. Why is "the wrong abstraction is worse than duplication" especially dangerous in shared library code?**

<details><summary>Answer</summary>

Because the blast radius scales with the number of consumers, and in a shared library that can be every team in the company. A wrong abstraction with three internal callers is annoying; the same one exported as a public API has dozens of dependents, a deprecation policy, and a SemVer contract — so unwinding it is a multi-quarter migration, not an afternoon. The pressure to *patch rather than fix* (add an optional parameter, an overload, a config flag) is therefore enormous, and each patch is itself a permanent part of the public contract. The lesson: be most conservative about abstracting at module boundaries. Inside a package you can refactor freely; across a published API, prefer a little duplication or a narrow concrete API until the right shape is proven.
</details>

**Q31. How do you detect a forming Interface Bloat problem in review before it ships?**

<details><summary>Answer</summary>

Watch for three signals. First, **methods added to an interface that the PR's own new implementation can't support** — the giveaway is a fresh `UnsupportedOperationException` or a no-op body. Second, **implementers that ignore large fractions of the interface** — if half the methods are stubs, the interface is modeling more than one role. Third, **callers that accept the fat interface but use one method** — they're over-depending. The countermove is to ask "which clients use which methods?", group methods by client usage, and propose role interfaces along those groupings. Catching it at one new throwing-stub is far cheaper than after ten implementers have each stubbed differently.
</details>

**Q32. Can fixing one of these anti-patterns create another? Give an example.**

<details><summary>Answer</summary>

Yes, abstraction failures trade off against each other. Over-correcting Interface Bloat by splitting every method into its own interface produces **fragmentation** — the mirror problem, where cohesive operations are scattered across single-method interfaces. Over-correcting a Golden Hammer ("we always use Postgres") by adopting a different specialized store for every workload produces **polyglot sprawl** — operational complexity, more failure modes, more on-call surface. And aggressively removing a Premature Abstraction can swing into rigid duplication that *should* have been unified once the third case arrived. The senior skill is recognizing that each cure has an opposite failure, and aiming for the cohesive middle rather than the opposite extreme.
</details>

**Q33. When should you deliberately accept a Golden Hammer?**

<details><summary>Answer</summary>

When the value of **consistency and operational familiarity** outweighs the marginal fit of a specialized tool. Real engineering runs on a team's ability to operate, debug, and reason about its stack at 3 a.m. Introducing the "perfect" tool for one workload adds a new thing to deploy, monitor, back up, secure, patch, and train people on — costs the better-fitting tool must overcome. So choosing the familiar, slightly-imperfect tool everywhere is often *correct*: one database the team knows deeply usually beats five specialized stores each used once. The discipline is to make it a *conscious* trade ("Postgres isn't ideal for this graph query, but the operational simplicity is worth it") rather than an unexamined reflex — and to revisit it when the misfit starts costing more than the consistency saves.
</details>

**Q34. How do you prioritize which abstraction problems to fix when several exist?**

<details><summary>Answer</summary>

By **change-frequency × pain**, same as any structural debt. A wrong abstraction in a module nobody touches costs little; the same one on a hot path that every feature crosses taxes every change. Pull churn data, find where abstraction failures sit in high-traffic code, and start there. Within that, prioritize the ones *blocking the upcoming roadmap* — if the next quarter's work keeps fighting a premature abstraction, fixing it is on the critical path. Bloated interfaces with many stubbing implementers also rank high because they generate recurring confusion and runtime failures. Cosmetic mismatches in stable code rank low. Let the data, not aesthetic discomfort, order the work.
</details>

**Q35. A teammate says "we should make this generic now so we don't have to refactor later." How do you respond?**

<details><summary>Answer</summary>

Agree with the goal (avoid future churn) and challenge the method. Premature generalization doesn't *avoid* refactoring — it usually *adds* a refactor, because the guessed abstraction won't fit the real second case, so you'll refactor the abstraction *and* the new code to match. Concrete, duplicated code is cheaper to change because each copy is independent; you refactor it once, at the third case, when you actually know the shape. The honest framing: "We avoid the most refactoring by writing the simplest thing that solves today's case, tolerating duplication, and extracting only when the real variation appears." Generality you can prove you'll need (a ticket, a committed requirement) is fine; generality 'just in case' is the costly path, not the safe one.
</details>

**Q36. How do you make the case to *delete* a Premature Abstraction the original author is attached to?**

<details><summary>Answer</summary>

Lead with evidence and cost, not taste. Show that the abstraction has one implementation and no concrete second case (no ticket, no roadmap item), so it's currently pure indirection — readers pay the cost of an extra hop with no payoff. Quantify it: count the files a reader must open to follow one call, the stubs or `default` methods nobody uses, the flags added to make it bend. Then offer reversibility: inlining it loses nothing because git keeps the history and the abstraction can be re-extracted *better* from the real cases when they arrive. Framing it as "we'll build the right abstraction later, from evidence" usually lands better than "this was a mistake."
</details>

---

## Professional / Deep — DSL Cost, Dispatch, Wrong-Tool Performance

> Runtime, interpretation, dispatch, and toolchain implications.

**Q37. What is the runtime cost of an Inner-Platform DSL versus the equivalent native code?**

<details><summary>Answer</summary>

A hand-rolled interpreter pays an **interpretation tax** native code avoids. Each rule evaluation walks a data structure (a list of condition dicts, an AST, rows in a table), dispatches on string opcodes, and looks up fields dynamically by name — all of which the host language would have compiled to direct field access and branches. So you get: pointer-chasing and cache misses walking the rule structure, repeated string comparison / map lookups for operator and field dispatch, boxing of values into a generic `Object`/`interface{}`/`Any` representation, and zero benefit from the JIT or compiler optimizing the actual logic (it optimizes your *interpreter loop*, not the rules). For a few rules this is invisible; for a hot path evaluating thousands of rules per request, the homemade interpreter can be one or two orders of magnitude slower than the native equivalent, and you can't profile *into* it the way you can profile real code.
</details>

**Q38. How does a Golden Hammer data-structure choice manifest as a performance problem?**

<details><summary>Answer</summary>

The mismatch surfaces as wrong asymptotics or wrong access patterns. Using a `HashMap<String, Object>` as a universal record means every field access is a hash + lookup + cast instead of a compiled offset load, and the data is scattered across the heap with poor locality versus a packed struct. Using a linked list where you need random access turns O(1) indexing into O(n) traversal. Storing relational, join-heavy data in a key-value store forces application-side joins — N round trips where one indexed SQL query would do. Modeling a queue as a database table with `SELECT ... FOR UPDATE` polling reinvents a message broker badly, with lock contention and polling latency. In each case the tool *runs*, but its performance profile fights the workload because it was chosen for familiarity, not for the access pattern.
</details>

**Q39. Does Interface Bloat have a runtime cost, or is it purely a design smell?**

<details><summary>Answer</summary>

Mostly design, but there are real edges. A fat interface means **larger vtables / method tables** and, in some runtimes, more indirection per call. More relevantly, broad interfaces tend to be invoked through **megamorphic call sites** — a call site that sees many different implementing types defeats the JIT's inline-cache optimization (which is fast for monomorphic/bimorphic sites) and falls back to a slower lookup, blocking inlining and the optimizations inlining unlocks. Narrow role interfaces, by contrast, tend to have fewer implementers per call site, staying monomorphic and inlinable. There's also the obvious failure mode: stubbed methods that throw at runtime turn a design defect into a production crash. So "purely a smell" understates it.
</details>

**Q40. How does dynamic dispatch through an abstraction interact with inlining, and when does it matter?**

<details><summary>Answer</summary>

A direct (statically-resolved) call can be inlined, after which the optimizer sees through it and can constant-fold, eliminate dead branches, and keep values in registers. A virtual/interface call forces the runtime to resolve the target first. Modern JITs mitigate this with **inline caches** and **devirtualization**: a monomorphic site (one observed type) gets inlined speculatively with a guard; a bimorphic site can still do well; a **megamorphic** site (many types) falls back to a vtable lookup and is *not* inlined, so the optimizer can't see past it. This matters only on genuinely hot paths — for the vast majority of code the dispatch cost is noise. The professional point: a Premature Abstraction or Interface Bloat that introduces extra dispatch layers on a hot loop can measurably hurt by *blocking inlining*, not by the dispatch cost itself — but you confirm that with a profiler, never by intuition.
</details>

**Q41. How does a Premature Abstraction affect the compiler's ability to optimize?**

<details><summary>Answer</summary>

A single-implementation interface that the compiler/JIT can *prove* has one implementation is often devirtualized and inlined away — cost recovered. But the moment the abstraction is reachable via reflection, a DI container, a plugin registry, or is exported across a module boundary, the optimizer must assume any implementation could appear, so it keeps the indirection and can't inline through it. Generics/templates cut both ways: monomorphized generics (Rust, C++ templates, Go generics in some cases) specialize per type and stay fast; type-erased generics (Java) box and dispatch. So a premature generic abstraction can quietly force boxing and lose the specialization the concrete code would have had. The takeaway: the cost of an unnecessary abstraction is sometimes paid by the optimizer being unable to remove it, not just by readers.
</details>

**Q42. What tools or techniques would you use to *confirm* a wrong-tool performance problem rather than guess?**

<details><summary>Answer</summary>

Measure before claiming. Use a **CPU profiler / flame graph** to see whether time is spent in your interpreter loop, in hash lookups, in dispatch, or in actual work — an Inner Platform shows up as a fat self-time band in the eval/dispatch functions. Use **allocation profiling** to catch the boxing an over-generic or `Map<String,Object>` design forces. For dispatch questions, inspect JIT logs (`-XX:+PrintInlining` / `-XX:+PrintCompilation` on the JVM, `perf` + the compiler's inlining diagnostics elsewhere) to see whether hot call sites are inlined or going megamorphic. Benchmark the native-code equivalent of a representative rule set to quantify the interpretation tax. The principle mirrors all performance work: the profiler finds the bottleneck; intuition about "this abstraction must be slow" is frequently wrong about *where* the cost actually is. See [Profiling Techniques](../../../../../Architecture/ddd/README.md) only conceptually — verify locally.
</details>

**Q43. How do these anti-patterns affect build time, binary size, and dependency surface?**

<details><summary>Answer</summary>

A Golden Hammer that pulls in a heavyweight framework for a small need drags its **transitive dependency tree** into your build — more to compile, larger artifacts, more CVEs to patch, more license obligations, all for one feature. An Inner-Platform DSL adds a parser/evaluator and often a grammar/codegen step that **slows the build** and ships dead-weight evaluation code users download (in frontend/mobile bundles). Premature abstractions and bloated interfaces add types and indirection that **inflate the symbol table and IDE index**, slowing autocomplete, find-references, and incremental compilation. None of this is the headline cost — the headline cost is comprehension — but a strong candidate names the build/security/bundle taxes too, because "the abstraction never runs" doesn't mean it's free.
</details>

**Q44. Compare maintaining your own rule-DSL versus embedding an existing scripting engine. When is each right?**

<details><summary>Answer</summary>

Embedding a vetted, sandboxed scripting engine (Lua, a constrained JavaScript/Starlark interpreter, an expression library like CEL) gives you a *real* language — documented semantics, a parser, error messages, tooling, and a security model — for the cost of a dependency and a sandbox you must lock down (resource limits, no I/O, timeouts). That's usually far better than a homemade DSL, which is the Inner-Platform trap: you reinvent parsing, evaluation, and tooling badly. So if you genuinely need runtime-authored logic, **embed an existing engine** rather than grow your own. Build your own *only* when the required language is so narrow and domain-specific that a constrained, well-tested mini-grammar is genuinely simpler and safer than embedding a general one — a deliberate, resourced decision. And before either, ask whether plain plugin code (compiled callbacks) would meet the need without any interpreter at all.
</details>

---

## Code-Reading — Name the Anti-Pattern

> You're shown a snippet; identify the anti-pattern(s) and state the fix.

**Q45. Which anti-pattern, and what's the fix?**

```java
public interface Animal {
    void walk();
    void swim();
    void fly();
}

public class Dog implements Animal {
    public void walk() { /* ... */ }
    public void swim() { /* ... */ }
    public void fly()  { throw new UnsupportedOperationException("dogs can't fly"); }
}
```

<details><summary>Answer</summary>

**Interface Bloat** (Interface Segregation violation). One interface bundles three capabilities no single animal has, so `Dog` is forced to stub `fly()` and throw at runtime — a design defect that becomes a crash. Fix: split into **role interfaces** and have each type implement only what it supports.

```java
interface Walker { void walk(); }
interface Swimmer { void swim(); }
interface Flyer  { void fly(); }

class Dog implements Walker, Swimmer { /* no fly() to stub */ }
class Duck implements Walker, Swimmer, Flyer { /* ... */ }
```

Callers depend on the narrow role they need (`void race(Walker w)`), and no one is forced to support a method they can't.
</details>

**Q46. Which anti-pattern, and what's the fix?**

```go
// Only one formatter exists; no second is planned.
type Formatter interface {
    Format(r Report) ([]byte, error)
}

type JSONFormatter struct{}
func (JSONFormatter) Format(r Report) ([]byte, error) { return json.Marshal(r) }

func Export(r Report, f Formatter) error { /* ... */ }
```

<details><summary>Answer</summary>

Likely **Premature Abstraction** — a `Formatter` interface with a single implementation and no concrete second format. The interface adds indirection that buys nothing today. *But pause:* in Go, satisfying interfaces is free and structural, and an interface here is a cheap test seam. So the verdict hinges on value-now: if `Export` is tested against a fake formatter, or a second format is genuinely coming, keep it. If neither holds, simplify to the concrete type until a real second format appears:

```go
func Export(r Report) error {
    data, err := json.Marshal(r)
    // ...
}
```

The point isn't "interfaces with one impl are always wrong" — it's that this one must justify itself by present-day value, not by a hypothetical future format.
</details>

**Q47. Which anti-pattern, and what's the fix?**

```python
# config.yaml drives this:
#   - when: "user.age > 18 and user.country in ['US','CA']"
#     then: "user.tier = 'adult'; log('upgraded')"
def run_config_rules(user, rules):
    for rule in rules:
        if eval(rule["when"], {"user": user}):     # eval() on config strings
            exec(rule["then"], {"user": user, "log": log})
```

<details><summary>Answer</summary>

**Inner-Platform Effect**, and a dangerous one — they've used `eval`/`exec` to turn config strings into a programming language, complete with expressions, statement sequences, and function calls. It's a worse Python: no static checks, no tooling, opaque errors, and a remote-code-execution hole if any rule text is attacker-influenced. Fix: these are just *programs*, so write them as code — plain functions registered in a list — using Python's real control flow, types, tests, and debugger:

```python
def adult_tier_rule(user):
    if user.age > 18 and user.country in ("US", "CA"):
        user.tier = "adult"
        log("upgraded")

RULES = [adult_tier_rule]
for rule in RULES:
    rule(user)
```

If non-engineers must author rules at runtime, embed a *sandboxed* engine with no `exec` — never raw `eval`/`exec` on config.
</details>

**Q48. Which anti-pattern, and what's the fix?**

```python
# Every persistence problem in this codebase is solved with Redis.
def save_order(order):
    r.hset(f"order:{order.id}", mapping=order.fields())
def orders_in_range(start, end):          # needs a range query + joins
    ids = r.keys("order:*")               # O(N) scan of the whole keyspace
    return [o for o in (load(i) for i in ids)
            if start <= load(i)["date"] <= end]
```

<details><summary>Answer</summary>

**Golden Hammer.** Redis is the team's default, so a workload that needs range queries and relational access (orders by date range, joins) is forced into a key-value store — producing a full `KEYS *` keyspace scan (O(N), and a known production hazard) plus application-side filtering, where an indexed relational query would be O(log N + k). The fix isn't "never use Redis" — it's to match the tool to the access pattern: store orders in a relational/queryable store with an index on `date`, and keep Redis for what it's great at (caching, ephemeral counters, rate limits). The diagnostic question the author skipped: *what does this query pattern actually need?*
</details>

**Q49. Which anti-pattern, and what's the fix?**

```java
// Two payment types existed for one week; an abstract base was extracted on day 1.
abstract class AbstractPaymentProcessor<T extends PaymentContext> {
    protected abstract T buildContext(Request r);
    protected abstract void preValidate(T ctx);
    protected abstract Result doProcess(T ctx);
    protected abstract void postHook(T ctx, Result res);
    public final Result process(Request r) { /* template method, 60 lines */ }
}
class CardProcessor extends AbstractPaymentProcessor<CardContext> { /* only impl */ }
```

<details><summary>Answer</summary>

**Premature Abstraction.** A generic, four-hook template-method base with a type parameter was extracted with **one** concrete subclass — the variation axis (the four hooks, the `<T>` shape) is entirely guessed. When a real second processor arrives it almost certainly won't split along these exact four hooks, forcing either contortion or rework. Fix: inline `CardProcessor` back to a single concrete class, tolerate that there's "only one" for now, and re-extract a base *only when the second processor reveals what genuinely varies* (Rule of Three). The correct shape is discovered from real cases, not designed against imagined ones.
</details>

**Q50. This snippet shows two anti-patterns at once — name both.**

```go
// A "workflow engine" stored in the DB; also the team's answer to everything.
type Step struct {
    ID       int
    OpCode   string            // "http_call", "if", "loop", "set_var"
    Args     map[string]any    // stringly-typed everything
    NextID   int               // manual control flow via row pointers
}
func RunWorkflow(steps map[int]Step, start int) {
    for id := start; id != 0; {
        s := steps[id]
        id = dispatch(s.OpCode, s.Args)   // returns the next step id
    }
}
```

<details><summary>Answer</summary>

**Inner-Platform Effect** *and* **Golden Hammer**. It's an Inner Platform because control flow (`if`, `loop`, `set_var`, `NextID` jumps) and computation are encoded as database rows — a hand-built interpreter for a language with no types, no debugger, and `map[string]any` everywhere. It's a Golden Hammer because "model it as a configurable workflow engine" has become the team's reflexive answer to problems that are just *code*. Fix both: express workflows as real Go functions composed normally (the language already has `if`, loops, and variables); reserve a genuine, sandboxed workflow/orchestration engine only for the case where non-engineers must author long-running, durable, runtime-edited workflows — a deliberate decision, not the default.
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q51. When is choosing one familiar tool everywhere actually *good* rather than a Golden Hammer?**

<details><summary>Answer</summary>

When **consistency and operability beat marginal fit** — which is often. Every additional technology is a permanent operational tax: another thing to deploy, monitor, secure, back up, patch, and staff on-call for. A team that runs one database it knows cold will usually ship and operate more reliably than one juggling five specialized stores each used once. So "Postgres for almost everything," "one language for services," "the same job framework everywhere" can be excellent engineering. The line between this and the Golden Hammer is **conscious trade-off versus unexamined reflex**: it's good when you've acknowledged the misfit and judged consistency worth more here; it's the anti-pattern when you never asked what the problem needed and the misfit is starting to cost more than the consistency saves.
</details>

**Q52. When *should* you build a DSL or rule engine instead of just using the platform?**

<details><summary>Answer</summary>

When **non-engineers must change behavior at runtime without a deploy**, the need is recurring and high-volume, and the domain is stable enough to design clear semantics — and you're willing to fund it like real software (grammar, validation, tests, versioning, sandboxing, tooling). Pricing rules edited by analysts, fraud thresholds tuned by risk teams, alerting expressions owned by SREs: these can justify a constrained DSL or a rules engine. Even then, prefer to **embed an existing sandboxed engine** (CEL, Starlark, Lua) over hand-rolling one. The anti-pattern is sliding into a DSL *by accident*, one config knob at a time, with none of that rigor — and the prior question is always "would plain plugin code / callbacks meet this without an interpreter?"
</details>

**Q53. Interface Segregation says split fat interfaces — can you over-split? What's the failure?**

<details><summary>Answer</summary>

Yes. Push ISP to the extreme and every method becomes its own single-method interface, so a class doing three cohesive things must declare three interfaces that always travel together, callers needing the trio take three parameters, and fakes implement three types. That's **fragmentation** — the mirror of bloat, scattering one concept across many tiny pieces. ISP says "don't force a client to depend on methods it doesn't use," not "one method per interface." The right grain is *how clients actually group usage*: split where different clients use **disjoint** subsets; keep together what clients use **as a unit**. Cohesion, not maximal smallness, is the target.
</details>

**Q54. Why is a premature abstraction often described as *worse* than the duplication it was meant to remove?**

<details><summary>Answer</summary>

Because of the *wrong-abstraction ratchet*. Duplication is local and honest: n independent copies you can edit separately, and the fix (extract) is cheap once you understand the pattern. A wrong abstraction couples all its callers under a guessed contract, and when reality diverges from the guess, the natural response isn't to remove the abstraction (expensive, scary) but to **parameterize** it — a boolean here, an optional hook there, a special-case branch. Each patch makes it more complex and more entangled, so it gets *harder* to unwind over time, not easier. You end up maintaining an abstraction more complicated than the duplication ever was, plus every caller depends on it. Sandi Metz: "prefer duplication over the wrong abstraction" — because un-abstracting is far costlier than un-duplicating.
</details>

**Q55. Rule of Three — why three? Why not two, or four?**

<details><summary>Answer</summary>

Two points can't distinguish the *essential* axis of variation from *coincidental* similarity — any two examples can be connected by infinitely many "patterns," so abstracting at two is guessing which one is real. The third instance **triangulates**: it reveals what actually stays constant across cases (the true contract) versus what merely looked shared in the first two. Three is the smallest number that gives evidence rather than a guess. It's not a hard law — sometimes two cases plus a *certain* committed third (a ticketed requirement) is enough, and sometimes even three coincidental cases shouldn't be merged — but "wait for three" is the heuristic that reliably stops you abstracting on a guess while not tolerating duplication indefinitely.
</details>

**Q56. "Premature abstraction and premature optimization are both 'premature' — same root cause?"**

<details><summary>Answer</summary>

Same root cause, different surface. Both come from **acting on a guess about the future instead of evidence about the present** — optimizing a path you haven't measured, abstracting a variation you haven't seen. Both trade real present cost (complexity, indirection, lost clarity) for a speculative future benefit that frequently never materializes or materializes in a different shape than guessed. And both have the same cure: *wait for evidence* — profile before you optimize, reach the third case before you abstract — and keep the design simple and changeable until that evidence arrives. Recognizing the shared root ("don't pay now for a guessed future") is a strong senior signal.
</details>

**Q57. Isn't avoiding all abstraction just an excuse for copy-paste? Where's the line?**

<details><summary>Answer</summary>

No — the line is **evidence of the real pattern**, not a blanket rule in either direction. "Never abstract" produces unmaintainable copy-paste where one knowledge change must be made in twenty places; "always abstract" produces the wrong-abstraction ratchet. The line: abstract when you have *enough concrete cases to know what genuinely varies* (typically three) **and** the cases represent the *same knowledge* (so they'll always change together), not just similar-looking text. Until then, tolerate duplication as a deliberate, temporary state that keeps the cases free to diverge and reveal their true shape. The skill isn't choosing a side; it's reading which situation you're in.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q58. One-line cure for each of the four?**

<details><summary>Answer</summary>

Golden Hammer → let the problem pick the tool; widen the toolkit. Inner-Platform Effect → use the host platform / plugins; don't reinvent control flow. Interface Bloat → split into role interfaces (ISP). Premature Abstraction → wait for the Rule of Three; prefer duplication over a guessed shape.
</details>

**Q59. The catchphrase that signals a Golden Hammer?**

<details><summary>Answer</summary>

"We already use X for everything, so let's use X here too" — familiarity standing in for fit.
</details>

**Q60. The tell of an Inner-Platform Effect?**

<details><summary>Answer</summary>

Your "config" has grown variables, branching, or expressions — you're now programming in a language you accidentally invented.
</details>

**Q61. The runtime tell of Interface Bloat?**

<details><summary>Answer</summary>

Methods that throw `UnsupportedOperationException` / `NotImplementedError`, or are stubbed as empty no-ops.
</details>

**Q62. Premature Abstraction in one sentence?**

<details><summary>Answer</summary>

An abstraction extracted from one case — its shape is a guess, and the wrong abstraction costs more than the duplication it replaced.
</details>

**Q63. Sandi Metz's rule on duplication vs. abstraction?**

<details><summary>Answer</summary>

"Prefer duplication over the wrong abstraction" — duplication is cheap to fix; the wrong abstraction is a ratchet that only tightens.
</details>

**Q64. ISP in one sentence, and which anti-pattern it most directly counters?**

<details><summary>Answer</summary>

No client should depend on methods it doesn't use — directly the cure for Interface Bloat.
</details>

**Q65. Why do these four cluster together?**

<details><summary>Answer</summary>

They share one root: the abstraction is mis-leveled for the problem — wrong tool (Golden Hammer), reinvented platform (Inner-Platform), too broad (Interface Bloat), or too early (Premature) — all are "the shape doesn't fit."
</details>

**Q66. Best one-question filter before extracting an abstraction?**

<details><summary>Answer</summary>

"What value does this abstraction give with the cases I have *today*?" If the only answer is "future flexibility," defer it.
</details>

---

## How to Talk About Anti-Patterns in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the *cost*, not the label.** Don't just say "that's an Inner Platform." Say *why it hurts* — "we're re-implementing control flow the language already has, with no types, no debugger, and a one-or-two-order-of-magnitude interpretation tax on a hot path." Reasoning beats vocabulary.
- **Refuse the absolutes.** "Interfaces with one implementation are always wrong," "never duplicate code," "always use the specialized tool" are juniorisms. Calibrate: single-impl interfaces can be valid test seams; duplication is sometimes better than the wrong abstraction; one familiar tool everywhere is often the right operational call.
- **Name the trade-off every time.** Senior signal is acknowledging the other side — ISP can over-split into fragmentation; removing a Golden Hammer can cause polyglot sprawl; a deliberate DSL is sometimes correct. "It depends, and here's on what" beats dogma.
- **Tie premature abstraction to the Rule of Three and the wrong-abstraction ratchet.** Showing you'd *wait for evidence* and *prefer duplication over a guess* signals real design maturity.
- **Show you'd migrate *safely*.** Characterization tests, shadow-comparing a new path against an old interpreter, strangling a rules engine category-by-category — this proves production experience, not just reading.
- **Go deep when invited.** Interpretation tax, megamorphic call sites blocking inlining, boxing from over-generic abstractions, build/CVE surface of a Golden-Hammer dependency — these show depth beyond the maintainability story, and always pair them with "I'd confirm with a profiler."
- **Use a concrete example from your experience.** "Our config grew into a DSL; here's how we migrated rules back to code over a quarter" lands far harder than a definition.

---

## Summary

- The four abstraction-failure anti-patterns are all cases of the abstraction being **mis-leveled for the problem**: **Golden Hammer** (familiar tool forced where it doesn't fit), **Inner-Platform Effect** (a worse re-implementation of the host platform), **Interface Bloat** (a contract broader than any implementer can honestly support), and **Premature Abstraction** (a generalization extracted before the real variation is known).
- Recognition is the junior bar; the middle bar is knowing *when each creeps in* and the small countermove (Rule of Three, role interfaces, configure-data-not-control-flow, evaluate-tool-against-requirements); the senior bar is *design judgment, organizational root causes, and safe migration*; the professional bar is the *interpretation tax, dispatch/inlining, wrong-tool performance, and toolchain* consequences.
- The defining insight is **the wrong abstraction is worse than duplication** — premature, broad, or mismatched abstractions ratchet tighter as they're patched, so favor evidence over guessing: wait for the third case, let the problem pick the tool, and prefer the host platform over a reinvented one.
- Common curveballs hinge on rejecting absolutes: one familiar tool everywhere can be *good* (consistency), a DSL is *sometimes* right (runtime-authored logic by non-engineers), ISP can be *over*-applied (fragmentation), and three is the Rule-of-Three number because two examples can't distinguish essential from coincidental variation.

---

## Related Topics

- [`junior.md`](junior.md) — recognize each abstraction failure and avoid creating it.
- [`middle.md`](middle.md) — when each creeps in and the everyday countermoves.
- [`senior.md`](senior.md) — design judgment, root causes, and migrating off wrong abstractions.
- [`professional.md`](professional.md) — DSL/interpretation cost, dispatch and inlining, wrong-tool performance.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — practice the diagnosis and redesign.
- [OO Misuse](../01-oo-misuse/middle.md) — Flag Arguments and Magic Container, neighboring symptoms of misfit abstractions.
- [Coupling & State](../02-coupling-and-state/middle.md) — the sibling category where modules know or share too much.
- [Clean Code → Classes (SOLID / ISP)](../../../clean-code/09-classes/README.md) — Interface Segregation, the Interface Bloat cure.
- [Clean Code → Functions (DRY)](../../../clean-code/02-functions/README.md) — knowledge-vs-text duplication, the Premature Abstraction backdrop.
- [Refactoring → Code Smells](../../../refactoring/01-code-smells/README.md) — Speculative Generality and Refused Bequest, the smell-level view.
- [Refactoring → Refactoring Techniques](../../../refactoring/02-refactoring-techniques/README.md) — Inline Class, Extract Interface, and Collapse Hierarchy for unwinding bad abstractions.
- [Design Patterns → Behavioral (Strategy / Template Method)](../../../design-patterns/03-behavioral/README.md) — the positive counterparts these anti-patterns invert.
- [Architecture → Domain-Driven Design](../../../../../Architecture/ddd/README.md) — modeling variation around real domain concepts rather than guessed shapes.
