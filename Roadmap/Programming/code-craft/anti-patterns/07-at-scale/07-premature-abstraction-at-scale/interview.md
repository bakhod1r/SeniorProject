# Premature Abstraction at Scale — Interview Questions

> **Category:** [Anti-Patterns at Scale](../README.md) → **Premature Abstraction at Scale**
> **Covers (collectively):** Speculative Generality · Wrapper-itis & needless indirection · Premature decoupling & one-implementation interfaces · The Wrong Abstraction · AHA / Rule of Three / YAGNI as the cure

A bank of 35+ questions and answers on the over-correction that the rest of this chapter guards against: the "clean" abstraction that costs more than the duplication it removed. The angle is **staff-level** — not "is this interface ugly" but "this wrong abstraction is wired through 80 files, what does it cost us per change, and how do I unwind it without a flag day." Each answer models the reasoning a strong candidate gives, including the counter-argument. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals](#fundamentals)
2. [The Wrong Abstraction](#the-wrong-abstraction)
3. [The Cures — Rule of Three, AHA, YAGNI, DRY-vs-DAMP](#the-cures--rule-of-three-aha-yagni-dry-vs-damp)
4. [At Scale — Cost & Unwinding](#at-scale--cost--unwinding)
5. [Code-Reading — Diagnose the Snippet](#code-reading--diagnose-the-snippet)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [Summary](#summary)
9. [Related Topics](#related-topics)

---

## Fundamentals

> Definitions and the line between duplication and the wrong abstraction.

**Q1. Define "premature abstraction" and name the four shapes it takes.**

<details><summary>Answer</summary>

**Premature abstraction** is extracting a shared form before you have enough real instances to know what the form should be. You abstract on a guess, and the guess is usually wrong because you've seen only one or two cases.

The four shapes covered here:

- **Speculative Generality** — interfaces, type parameters, hooks, and config knobs built for an imagined future with one real caller. (Fowler's smell.)
- **Wrapper-itis & needless indirection** — a chain of pass-through wrappers/adapters/facades that each forward the call and add no behavior, so reading the code is a tour through layers that do nothing.
- **Premature decoupling / one-implementation interfaces** — splitting a concrete class behind an interface (and DI wiring) when exactly one implementation exists and no second is on the roadmap.
- **The Wrong Abstraction** — Sandi Metz's term: two things that *looked* the same got merged, and now they diverge, so the shared code grows boolean parameters to fork behavior back apart.

The common thread: each pays a *certain, immediate* cost (indirection, coupling, lost locality) for a *hypothetical* benefit that usually never arrives.
</details>

**Q2. Isn't avoiding abstraction just an excuse to copy-paste? How do you square this with DRY?**

<details><summary>Answer</summary>

DRY is real and good — but DRY is about **knowledge**, not **text**. The original "Don't Repeat Yourself" (Hunt & Thomas) says *every piece of knowledge must have a single authoritative representation*. It does **not** say "two lines that look alike must be merged." Premature abstraction is what happens when you apply DRY to *textual* similarity instead of *conceptual* identity.

Two snippets can be byte-for-byte identical today and represent two unrelated decisions that will diverge tomorrow (coincidental duplication). Merging them couples two things that have no business changing together. So the honest answer is: DRY when the duplication is the *same knowledge*; tolerate duplication when it's *coincidental*. The skill is telling them apart — which the Rule of Three operationalizes.
</details>

**Q3. What is "needless indirection" and why is a thin wrapper not free?**

<details><summary>Answer</summary>

Indirection is needless when a layer exists only to forward a call without transforming arguments, enforcing an invariant, adapting an interface, or adding a seam you actually use. A `UserServiceImpl` whose every method is `return repo.method(args)` is a wrapper that does nothing.

It isn't free because:

- **Comprehension cost.** Every "go to definition" lands on a forwarder; you traverse N files to find the one line that matters. Locality is destroyed.
- **Change amplification.** Adding a parameter means editing the interface, the impl, the wrapper, the mock, and the wiring — five edits for one behavior change.
- **False signal.** A reader assumes an interface implies multiple implementations or a real boundary, and reasons about polymorphism that doesn't exist.
- **Runtime cost** (sometimes) — virtual dispatch, extra allocations, lost inlining in hot paths.

The wrapper's *defenders* say "it gives us a seam for testing/mocking." Sometimes true — but a seam you never use is a Boat Anchor with a job title.
</details>

**Q4. What is "speculative generality" and how is it different from the wrong abstraction?**

<details><summary>Answer</summary>

**Speculative generality** is generality built *ahead* of need — a plugin system with one plugin, an interface with one implementor, a `process(Map<String,Object> opts)` signature "so we can add options later." It's a bet on a future that hasn't arrived. The hallmark is **zero real second cases**: the flexibility has never been exercised.

**The wrong abstraction** is generality built *after* a need, but the wrong one. Two real cases existed, you merged them, and the merge was incorrect because the cases were only superficially alike. The hallmark is **divergence pressure**: the shared code is sprouting `if`/flag parameters as the cases pull apart.

Different root cause, same fix family: don't abstract until the shape is clear (speculative), and be willing to *re-duplicate* when a merge proves wrong (wrong abstraction). Speculative generality is a YAGNI failure; the wrong abstraction is a DRY-applied-too-eagerly failure.
</details>

**Q5. Why is over-abstraction especially dangerous "at scale" versus in a single file?**

<details><summary>Answer</summary>

In one file, a bad abstraction is a local annoyance you delete in five minutes. At scale, the abstraction has **call sites** — dozens or hundreds — and each one took a dependency on the wrong shape. The cost compounds three ways:

1. **Spread.** Every caller imported the interface, mocked it in tests, and shaped its own code around the abstraction's vocabulary. Unwinding means touching all of them.
2. **Lock-in by gravity.** Once an abstraction is "the way we do X," new code copies it, so the wrong shape *reproduces*. It's no longer one mistake; it's a pattern the codebase enforces on itself.
3. **Sunk-cost defense.** "We can't remove `AbstractFooProvider`, half the system depends on it" — the very spread that makes it expensive also makes people protect it. The bigger it is, the harder it is to kill, regardless of whether it earns its keep.

This is why the staff-level question isn't "is this abstraction good" but "what is its blast radius, and what's the cheapest path to the right shape from here."
</details>

**Q6. A one-implementation interface — what's the actual harm? It compiles, it's tidy.**

<details><summary>Answer</summary>

The harm isn't aesthetic; it's that you pay for polymorphism you don't use:

- **Diluted navigation.** Jump-to-definition on `repo.findUser()` lands on the interface, not the code. To read behavior you take a second hop. Multiply by every interface and the codebase becomes a maze of declarations pointing at single implementations.
- **Two-edit changes.** Every signature change is duplicated across interface and impl.
- **Mock-driven tests that test nothing.** Teams mock the one interface and assert that the (mocked-away) collaborator was called — coupling tests to call structure instead of behavior.
- **The promise of substitutability that's a lie.** The interface implies "swappable," but there's nothing to swap. Newcomers waste time looking for the other implementations.

The legitimate cases — a real second implementation, a published API contract, a genuine test seam at an I/O boundary (DB, clock, network) — *earn* the interface. A pure in-memory domain service with one impl does not. Modern languages and DI containers can mock concrete classes; "I need an interface to test" is usually false.
</details>

---

## The Wrong Abstraction

> Sandi Metz's argument, and why duplication is sometimes the cheaper bet.

**Q7. Explain Sandi Metz's "the wrong abstraction." What is her central claim?**

<details><summary>Answer</summary>

Metz's claim, from her 2016 essay, is summarized as **"duplication is far cheaper than the wrong abstraction"** and **"prefer duplication over the wrong abstraction."**

The mechanism she describes: a programmer sees duplication, extracts a shared abstraction, and it's fine — for one or two callers. Then a new requirement *almost* fits but not quite, so instead of un-abstracting, the next programmer adds a parameter and a conditional to the shared code to handle the special case. Repeat. The abstraction accretes flags until it's a tangle of `if`s that no single caller fully uses, and every caller is afraid to touch it because it's shared by all of them.

Her key insight is about **incentives**: the cost of the wrong abstraction is paid *gradually*, by whoever touches it next, while the original extraction looked clean. Each individual flag-add is locally rational ("just one more boolean"), so nobody is ever motivated to pay the one-time cost of inlining it back. The abstraction rots in place precisely because un-rotting it is one person's expensive job and rotting it further is everyone's cheap option.
</details>

**Q8. Metz says to *re-introduce duplication* to fix a wrong abstraction. Walk through the steps.**

<details><summary>Answer</summary>

Her prescribed sequence — counterintuitive but mechanical:

1. **Inline the abstraction back into each caller.** Copy the shared method's body into every call site, then specialize each copy to exactly what that caller passes. The flag parameters collapse: a caller that always passed `mode=A` keeps only the `A` branch.
2. **Delete the dead branches** in each now-inlined copy. The `if mode == B` code vanishes from the caller that only ever used `A`.
3. **You now have honest duplication** — several concrete, readable methods, each doing one thing. The "DRY" tangle is gone.
4. **Re-observe.** With the real, specialized cases sitting side by side, the *correct* abstraction (if any) is now visible — or it's clear there isn't one and the duplication should stay.

The move trades a false unity for honest divergence. You're not abandoning abstraction forever; you're resetting to concrete so the right abstraction can emerge from evidence instead of guesswork.
</details>

**Q9. How do you *recognize* a wrong abstraction in a large codebase before it's obvious?**

<details><summary>Answer</summary>

Signals, roughly in order of how damning they are:

- **Boolean/enum parameters that select behavior** — `render(x, isAdmin, isExport, legacyMode)`. Each flag is a fork the abstraction wasn't built for. Flags that are *only ever* passed as constants at call sites are the smoking gun.
- **Callers that pass `null`/default for half the parameters** — they don't use most of the abstraction; they're paying for a generality they don't need.
- **Conditionals keyed on the *caller's identity or type*** inside the shared code — `if (caller == "billing")`. The abstraction knows about its callers, which is backwards.
- **Change coupling in git history** — the shared module changes every time *either* unrelated feature changes (mine this with [hotspot analysis](../03-hotspot-analysis/junior.md): high churn + many distinct authors editing for unrelated reasons).
- **Comments apologizing** — `// special case for the import path, do not remove`.

The quantitative tell at scale: a single function whose cyclomatic complexity grows monotonically while no single caller exercises more than a fraction of its branches.
</details>

**Q10. "Prefer duplication over the wrong abstraction" — when is this advice wrong?**

<details><summary>Answer</summary>

It's a heuristic, not a law, and it's wrong when the duplication represents **genuinely shared knowledge that must stay consistent**. If three places compute sales tax and the rate changes by law, duplicated tax logic is a *correctness bug waiting to happen* — you'll fix two of three and ship the wrong number. There, DRY wins decisively; the cost of divergence is incorrect behavior, not just maintenance.

The principle applies to **coincidental** duplication — code that looks alike today but encodes independent decisions. It does *not* license copy-pasting a business rule, a wire-format, a validation that must match the server, or anything where two copies silently drifting is a defect. The discriminator is the same as always: *is this the same knowledge, or just the same letters?* Metz's advice is a thumb on the scale against premature merging, not a blanket endorsement of duplication.
</details>

---

## The Cures — Rule of Three, AHA, YAGNI, DRY-vs-DAMP

**Q11. State the Rule of Three and the reasoning behind the specific number three.**

<details><summary>Answer</summary>

**Rule of Three** (Fowler, *Refactoring*): the first time you write something, just write it. The second time you need something similar, you may wince but you duplicate. The **third** time, you refactor to remove the duplication.

Why three and not two? Because **two points define infinitely many curves.** With two instances you can't tell what's essential to the abstraction and what's incidental to those two cases — any shared form you extract is a guess that fits both points but may be wrong everywhere else. The third instance is the first real *evidence* of the pattern's shape: it tells you which parts genuinely repeat and which were coincidental. Abstracting at two is abstracting on a hunch; abstracting at three is abstracting on data. The rule deliberately tolerates short-lived duplication to buy the information that prevents the wrong abstraction.
</details>

**Q12. What does AHA stand for and how is it different from DRY and the Rule of Three?**

<details><summary>Answer</summary>

**AHA** — "Avoid Hasty Abstractions" (Kent C. Dodds, crediting Sandi Metz's "prefer duplication over the wrong abstraction"). The fuller phrasing: *"prefer duplication over the wrong abstraction, and optimize for change first."*

How it differs:

- **DRY** says *remove* duplication — it's a push toward abstraction.
- **Rule of Three** is a *trigger* — a count that tells you *when* it's safe to abstract.
- **AHA** is a *disposition* — it reframes the goal from "no duplication" to "easy to change," and explicitly warns that abstracting too early is as harmful as abstracting too late.

AHA's contribution is dropping the dogma in both directions: don't abstract on the first hunch (anti-DRY-zealotry), but also don't religiously wait if the abstraction is obvious and stable. Optimize for the next change, and let that judgment — not a rule — decide.
</details>

**Q13. How does YAGNI specifically attack speculative generality and one-impl interfaces?**

<details><summary>Answer</summary>

**YAGNI** — "You Aren't Gonna Need It" — targets the *justification* for premature abstraction, which is almost always "we might need it later." YAGNI's answer: build for the requirement in front of you; the future requirement, when it arrives, will rarely match your guess, and you'll have paid carrying cost the whole time for the wrong thing.

Applied:

- *"Make it an interface so we can swap implementations later."* → YAGNI. One impl, no second on the roadmap, make it a concrete class; promote to an interface the day the second implementation is real.
- *"Add a plugin system so others can extend it."* → YAGNI. No second plugin exists; ship the one behavior and extract the extension point when a real second case forces it.
- *"Pass options as a map so we can add knobs."* → YAGNI. Add explicit parameters when a real knob is needed.

YAGNI doesn't forbid abstraction; it forbids abstraction *justified only by an imagined future*. Present, real generality is fine.
</details>

**Q14. Explain DRY vs DAMP. When do you deliberately choose DAMP?**

<details><summary>Answer</summary>

**DAMP** — "Descriptive And Meaningful Phrases" — favors readability and explicitness over deduplication. It's the deliberate counterweight to DRY, applied most famously to **tests**.

In tests, DRY is often the wrong call: a heavily factored test with shared setup helpers, parameterized fixtures, and base classes saves keystrokes but makes any single failing test impossible to read in isolation — you reconstruct the scenario by tracing through helpers. A DAMP test repeats its setup inline so the whole story (given/when/then) is visible in one place. When a test fails at 3 a.m., DAMP wins: you read one method and know exactly what broke.

You choose DAMP when **clarity of the individual case matters more than eliminating repetition**: tests, examples/documentation, and configuration where each entry should be self-explanatory. You choose DRY for **production logic where consistency is correctness**. The two aren't enemies — DRY governs behavior, DAMP governs the *description* of behavior.
</details>

**Q15. "When does an abstraction earn its keep?" — give a concrete checklist.**

<details><summary>Answer</summary>

An abstraction earns its keep when it pays for the indirection it imposes. Checklist:

- **Three or more real call sites** exercise it (Rule of Three), not one plus two imagined.
- **The duplication it removes is the same knowledge** — a change to the concept *should* propagate to all callers. If a change should hit only one caller, they weren't the same thing.
- **Callers use most of it.** No caller passes `null`/default for half the parameters; no caller threads a flag just to opt out of behavior meant for someone else.
- **It hides something worth hiding** — a real I/O boundary, a genuinely hard algorithm, an invariant, a published contract — not just "a method call."
- **It reduces total cognitive load.** Reading caller + abstraction is *less* work than reading the inlined version, not more.
- **It's stable.** The concept underneath isn't actively diverging (no growing flag count).

If it fails several of these, it's premature or wrong. The single best one-question test: *"if I inlined this everywhere, would the code get clearer or muddier?"* If clearer, the abstraction is dead weight.
</details>

---

## At Scale — Cost & Unwinding

> The staff-level core: a wrong abstraction already spread across the codebase.

**Q16. Quantify the cost of a wrong abstraction across 100 call sites. How do you make the case to leadership?**

<details><summary>Answer</summary>

Translate it into the language of throughput and risk, not aesthetics:

- **Change-amplification factor.** Pick three recent features that touched the abstraction. Show that each required editing the shared module *plus* re-verifying the N callers it fans out to, because the shared code couldn't be changed for one caller without risking the others. "Feature X took 4 days; 2.5 of them were spent proving we didn't break the other 11 callers of `OrderProcessor.process`."
- **Defect locality.** Mine incidents: how many bugs originated in the shared module and affected callers that had nothing to do with the change? A wrong abstraction turns local bugs into broad ones.
- **Churn × complexity.** From [hotspot analysis](../03-hotspot-analysis/junior.md): the module is high-churn *and* high-complexity *and* edited by many teams for unrelated reasons — the empirical signature of a coupling problem worth money.
- **Onboarding tax.** Time-to-first-PR is dominated by understanding the central abstraction everyone routes through.

The pitch: "This one module forces every change through a chokepoint and turns small changes into wide-blast-radius ones. Here's the measured tax; here's the bounded cost to unwind it."
</details>

**Q17. Lay out a safe, incremental plan to unwind a wrong abstraction wired through dozens of files.**

<details><summary>Answer</summary>

Don't big-bang it. Treat it as a refactor under traffic:

1. **Pin behavior first.** Wrap the abstraction and its callers in [characterization tests](../05-strangler-fig-and-seams/junior.md) so any behavior change is caught. You can't safely unwind what you can't observe.
2. **Inline at the leaves, not the trunk.** Start with the callers that use the *thinnest* slice of the abstraction. For each, copy the shared body in, specialize to that caller's constant flags, delete dead branches. One caller per PR, behavior-preserving, reviewable.
3. **Watch the flags collapse.** As callers peel off, parameters that were "always A for everyone left" become removable. Delete them via [automated refactoring](../04-automated-large-scale-refactoring/junior.md) (Comby/OpenRewrite/Semgrep) once a parameter is constant at all remaining sites.
4. **Let the right abstraction re-emerge — or don't.** With callers concrete and side by side, extract the *real* shared concept if one is now visible; otherwise stop and keep the honest duplication.
5. **Ratchet.** Add a [fitness function / budget](../02-anti-pattern-budgets-and-ratcheting/junior.md) so the dead abstraction's name can't be re-imported and the flag count can't grow.

Each step is independently shippable and reversible — the strangler-fig discipline applied to an abstraction instead of a service.
</details>

**Q18. Why is "we'll just delete the interface" usually not a single PR at scale?**

<details><summary>Answer</summary>

Because the interface is a *published shape* inside your codebase: callers depend on its method signatures, tests depend on mocks of it, DI wiring binds it, and sometimes serialization or reflection keys off its type. Deleting it atomically means changing all of that in one commit — a flag-day change that's huge to review, conflicts with everything in flight, and is hard to roll back if one caller behaves subtly differently.

The scalable approach is **expand-contract / parallel change** (see [Expand-Contract Refactors](../06-expand-contract-refactors/junior.md)): introduce the concrete target, migrate callers to it one at a time behind the existing names, then contract by removing the now-unused interface once nothing references it. The collapse is the *last* step, mechanical and safe, after the dependencies are already gone. The mistake is trying to make the collapse the *first* step.
</details>

**Q19. A junior wants to add an interface "to make the new service testable." How do you coach them?**

<details><summary>Answer</summary>

I'd separate the real goal (testability) from the assumed mechanism (an interface). Questions I'd ask:

- *"What are you actually trying to substitute in tests?"* If it's a real I/O boundary — DB, HTTP client, clock, queue — yes, a seam there is justified; that's a genuine second "implementation" (the fake). If it's pure domain logic with no I/O, there's nothing to substitute; test it directly with real inputs and outputs.
- *"Does your language let you fake the concrete class?"* In most (Mockito on concrete classes, Go's implicit interfaces extracted *at the consumer*, Python's duck typing) you don't need a hand-written interface to test.
- *"Is there a second implementation, now or genuinely scheduled?"* If no, a one-impl interface is speculative generality; promote to an interface the day the second case is real — it's a cheap refactor then.

The coaching frame: interfaces are for *boundaries and real polymorphism*, not a reflex you apply to every class. "Testable" is the goal; an interface is one tool, often not the needed one.
</details>

**Q20. How do you prevent the *next* premature abstraction once you've cleaned one up?**

<details><summary>Answer</summary>

Cleaning up is wasted if the codebase's gravity recreates the shape. Defenses, weakest to strongest:

- **Convention + review.** A documented "Rule of Three / AHA" norm and reviewers who ask "do we have three real cases?" Helps, but relies on vigilance.
- **Make the concrete path the easy path.** If the codebase has a clear, ergonomic way to write a plain concrete service, people copy *that* instead of the abstract scaffold. Templates and examples matter — people pattern-match on existing code.
- **Fitness functions** (see [01](../01-architecture-fitness-functions/junior.md)): a CI check that fails the build on, e.g., interfaces with exactly one implementor in the domain package, or functions whose boolean-parameter count exceeds a threshold. Mechanical and unmissable.
- **Budgets / ratcheting** ([02](../02-anti-pattern-budgets-and-ratcheting/junior.md)): freeze the current count of one-impl interfaces and require it to only go down.

The strongest move is removing the *justification*: when the team genuinely internalizes "optimize for change, not for imagined futures," the abstractions stop being written in the first place.
</details>

---

## Code-Reading — Diagnose the Snippet

**Q21. Diagnose this Go code.**

```go
type Stringifier interface {
    Stringify(v any) string
}

type DefaultStringifier struct{}

func (DefaultStringifier) Stringify(v any) string {
    return fmt.Sprintf("%v", v)
}

func Render(s Stringifier, v any) string {
    return s.Stringify(v)
}
```

<details><summary>Answer</summary>

**One-implementation interface + needless indirection.** `Stringifier` has exactly one implementor, `DefaultStringifier`, whose body is a one-liner over `fmt.Sprintf`. `Render` adds a layer that just calls through. Three constructs (interface, struct, wrapper function) exist to express `fmt.Sprintf("%v", v)`.

In Go specifically this is worse than idiomatic — Go interfaces are meant to be defined *at the consumer* when a real abstraction is needed, not exported speculatively next to their sole implementation. There's no second stringifier, no I/O boundary, nothing to mock.

**Simpler form:** delete all three. Call `fmt.Sprintf("%v", v)` where you need it. If a real second formatting strategy ever appears, introduce the interface *then*, defined where it's consumed.
</details>

**Q22. Diagnose this Java code.**

```java
public String label(Item item, boolean isExport, boolean isAdmin, boolean legacy) {
    StringBuilder sb = new StringBuilder(item.getName());
    if (isAdmin) sb.append(" [").append(item.getId()).append("]");
    if (isExport) sb.append(",").append(item.getSku());
    else sb.append(" - ").append(item.getPrice());
    if (legacy) return sb.toString().toUpperCase();
    return sb.toString();
}
```

<details><summary>Answer</summary>

**The wrong abstraction, mid-rot.** Four boolean flags fork behavior four ways; this single method is the merged form of what were probably three or four genuinely different label formats (UI label, admin label, CSV export row, legacy export). Tells: the `isExport` branch produces a comma-joined SKU (a CSV concern), while the non-export branch produces a human " - price" (a UI concern). Those are *different knowledge* glued together. Every caller passes constants (`label(i, true, false, false)`), so no caller uses the generality — they're just selecting their one path through a tangle.

**Simpler form:** inline back into honest, concrete methods — `uiLabel(item)`, `adminLabel(item)`, `exportRow(item)`, `legacyExportRow(item)` — each with only its own logic, no flags. The duplicated `item.getName()` prefix is coincidental and fine to repeat; if a real shared concept survives (it likely doesn't), extract *that*.
</details>

**Q23. Diagnose this Python code.**

```python
class AbstractHandlerFactoryProvider:
    def get_factory(self, kind):
        return {"json": JsonHandlerFactory}[kind]()

class JsonHandlerFactory:
    def create(self):
        return JsonHandler()

class JsonHandler:
    def handle(self, payload):
        return json.loads(payload)
```

<details><summary>Answer</summary>

**Speculative generality, three layers deep, for one concrete behavior.** A *provider* that returns a *factory* that creates a *handler* that calls `json.loads`. The dict has one key. There is one factory, one handler, one kind. This is the "GoF pattern names applied without GoF problems" failure — the names (`Provider`, `Factory`, `Handler`) promise extensibility that doesn't exist and adds three indirections to reach `json.loads(payload)`.

**Simpler form:**

```python
def parse_json(payload):
    return json.loads(payload)
```

If a second `kind` ever materializes, a plain dict dispatch (`{"json": parse_json, "xml": parse_xml}[kind]`) covers it — still no factories-of-providers. Abstraction should arrive with the second real case, not three layers ahead of it.
</details>

**Q24. Is *this* abstraction premature? (The trap.)**

```go
// PaymentGateway is implemented by StripeGateway (prod) and FakeGateway (tests).
// A second processor (Adyen) is on next quarter's roadmap.
type PaymentGateway interface {
    Charge(ctx context.Context, amountCents int64, token string) (ChargeID, error)
    Refund(ctx context.Context, id ChargeID) error
}
```

<details><summary>Answer</summary>

**No — this one earns its keep; deleting it would be the anti-pattern.** Reflexive "kill the interface" is itself a failure mode. The checklist passes:

- It sits at a **real I/O boundary** (an external payment network) — exactly where seams belong.
- It has a **genuine second implementation today**: the fake used in tests is a real, exercised second case, not a hypothetical.
- A **real third case is concretely scheduled** (Adyen), not vaguely imagined.
- Callers use the **whole interface**; there are no opt-out flags.

This is the difference between speculative generality and a justified seam: justified abstractions wrap I/O boundaries, have multiple *real* implementations (the fake counts), and don't grow flags. The skill being tested is judgment — recognizing when *not* to delete.
</details>

**Q25. Diagnose this config-driven snippet.**

```python
RULES = [
    {"if_field": "age", "op": "<", "value": 18, "then": "reject"},
    {"if_field": "country", "op": "==", "value": "XX", "then": "reject"},
]

def evaluate(record, rules):
    for r in rules:
        left = record[r["if_field"]]
        if OPS[r["op"]](left, r["value"]):
            return r["then"]
    return "accept"
```

<details><summary>Answer</summary>

**Soft coding / a mini-framework that reimplements `if`.** The team has built a tiny interpreter — fields, operators, actions, an evaluation loop — to express what is plainly two `if` statements. It looks "configurable," but the config is edited by the same engineers, in the same repo, with the same deploy, as code would be — so it buys no real flexibility, only a layer of indirection plus a homegrown DSL with no types, no IDE support, and no tests around the operator table.

**Simpler form:**

```python
def evaluate(record):
    if record["age"] < 18: return "reject"
    if record["country"] == "XX": return "reject"
    return "accept"
```

Soft coding earns its keep only when non-engineers change the rules at runtime *without a deploy* (true rules engines, feature flags). Absent that, plain code is shorter, type-checked, debuggable, and readable.
</details>

---

## Curveballs

**Q26. "If duplication is fine, where does it end? Won't the codebase fill with copies?"**

<details><summary>Answer</summary>

No, because the advice is bounded by the Rule of Three and by the same-knowledge test, not "duplicate forever." The discipline is: tolerate duplication *until you have three real instances and the shared concept is clear*, then abstract. That's a transient state, not a destination. In practice most coincidental duplication never reaches three cases and correctly stays duplicated; the cases that do reach three get a *correct* abstraction because you waited for evidence.

The fear "the codebase will fill with copies" assumes duplication is the failure mode teams actually suffer. Empirically, mature codebases far more often drown in *premature* abstraction — layers, one-impl interfaces, flag-laden shared methods — than in honest duplication. The advice corrects the more common, more expensive error.
</details>

**Q27. Your tech lead says "all our services must implement a common interface for consistency." Push back or comply?**

<details><summary>Answer</summary>

I'd probe the goal behind "consistency" before complying or refusing. If the interface captures a *real* shared contract that callers genuinely use polymorphically — e.g., every service is invoked by a common dispatcher that needs a uniform `handle(Request)` — then it earns its keep and I'd support it. If "consistency" means "every service should *look* alike" with no caller ever treating them polymorphically, it's speculative generality dressed as a standard: each service implements an interface nobody dispatches over, paying indirection for symmetry's sake.

Concretely I'd ask: *"who calls these services through the interface rather than by their concrete type?"* If the answer is "nobody, it's for tidiness," I'd propose dropping it. Imposed uniformity that no caller exploits is cost without benefit — and at scale it's *enforced* cost, because now every new service must conform to a shape it doesn't need.
</details>

**Q28. When is it correct to abstract at *two* instances, violating the Rule of Three?**

<details><summary>Answer</summary>

The Rule of Three is a heuristic about *uncertainty*, so override it when uncertainty is low. Abstract at two when:

- **The concept is well-understood and stable** — e.g., a logging call, a money type, a retry-with-backoff. You're not guessing at the shape; the domain already defines it.
- **The two instances are the *same knowledge* and divergence would be a bug** — two places parsing the same wire format must stay in lockstep; waiting for a third copy invites drift.
- **The cost of the wrong guess is low and reversible** — a small pure function is trivial to inline back if the third case doesn't fit.

The rule protects you from abstracting on a *hunch about an unclear shape*. When the shape is already clear from domain knowledge, the third instance teaches you nothing and waiting just risks inconsistency. Judgment over ritual — that's the AHA framing.
</details>

**Q29. A wrong abstraction is load-bearing and risky to touch, but only mildly painful. Do you unwind it?**

<details><summary>Answer</summary>

Probably not *now* — and saying so is the senior answer. Unwinding has real cost and risk; you spend it only where the pain justifies it. The decision is a portfolio call, informed by [hotspot analysis](../03-hotspot-analysis/junior.md): a wrong abstraction in a **cold, rarely-touched** module is cheap to leave alone — its badness is theoretical because nobody pays it. The same shape in a **hot, high-churn** module taxes every sprint and is worth unwinding.

So my answer: measure the change-frequency and the per-change tax. If it's mild and the module is stable, document it (so the next person doesn't extend it), add a budget so it doesn't *grow*, and spend the refactoring budget on a hotter problem. "Wrong" doesn't automatically mean "fix today" — it means "don't make it worse, and fix it when it's in your way." Reserve unwinding effort for abstractions whose blast radius and churn make them expensive.
</details>

**Q30. How do you tell coincidental duplication from real shared knowledge in a code review, fast?**

<details><summary>Answer</summary>

Ask one question of the two duplicated pieces: **"If the requirement behind one changed, would the other *have* to change too?"**

- **Yes, always, or it's a bug** → same knowledge → DRY it. (Two tax calculations; two copies of a wire format; two validations that must match the server.)
- **No / not necessarily / only by coincidence** → coincidental → leave it duplicated. (Two functions that happen to both loop-and-sum; two DTOs that currently have the same fields but model different domain concepts.)

The trap reviewers fall into is matching on *syntax* ("these ten lines are identical, extract them"). The discriminator is *causality of change*, not textual similarity. If you can construct a realistic future where one changes and the other shouldn't, they were never the same thing, and merging them is the wrong abstraction in the making.
</details>

---

## Rapid-Fire / One-Liners

<details><summary>Q31. DRY is about repetition of ______, not ______.</summary>

**Knowledge**, not **text** (or characters).
</details>

<details><summary>Q32. One sentence: the Rule of Three.</summary>

Duplicate once without guilt; on the *third* occurrence, refactor to a shared abstraction — because three instances give you evidence of the real shape that two cannot.
</details>

<details><summary>Q33. AHA expands to?</summary>

Avoid Hasty Abstractions — prefer duplication over the wrong abstraction, and optimize for change.
</details>

<details><summary>Q34. The cure for a wrong abstraction, in three words.</summary>

Inline it back (re-introduce duplication, then re-observe).
</details>

<details><summary>Q35. Most reliable smell of a wrong abstraction?</summary>

Boolean/enum flag parameters that select behavior, passed as constants at every call site.
</details>

<details><summary>Q36. When does a one-implementation interface earn its keep?</summary>

When it sits at a real I/O boundary with a genuine fake in tests, or a second implementation is concretely (not vaguely) coming.
</details>

<details><summary>Q37. DAMP is preferred over DRY most often in ______.</summary>

Tests (and other places where per-case readability beats deduplication).
</details>

<details><summary>Q38. Why is a wrong abstraction worse at scale than in one file?</summary>

It has many call sites that depend on its shape, it reproduces itself as "the way we do X," and its spread becomes the sunk-cost argument against removing it.
</details>

---

## Summary

- **Premature abstraction** trades a certain, immediate cost (indirection, coupling, lost locality) for a hypothetical benefit. Its four shapes: speculative generality, wrapper-itis, one-impl interfaces, and the wrong abstraction.
- **DRY is about knowledge, not text.** Coincidental duplication merged into a shared form is **the wrong abstraction** (Metz): it accretes flags as the merged cases diverge, and nobody is incentivized to pay the one-time cost of inlining it back.
- **The cures:** **Rule of Three** (wait for evidence), **AHA** (optimize for change, avoid hasty abstractions), **YAGNI** (kill "we might need it later"), and **DRY-vs-DAMP** (deduplicate behavior, but keep *descriptions* — especially tests — readable).
- **An abstraction earns its keep** when three real callers use most of it, it hides something worth hiding, and inlining it would make the code *muddier*, not clearer.
- **At scale**, the staff move is to *measure* the wrong abstraction's tax (change-amplification, defect locality, churn × complexity), then *unwind it incrementally* — characterize, inline at the leaves, collapse flags via automated refactoring, let the right shape re-emerge — and **ratchet** so it can't come back.

---

## Related Topics

- [Over-Engineering → Find the Bug](../../01-development/03-over-engineering/find-bug.md) — the in-the-file view of speculative generality and soft coding.
- [Hotspot Analysis](../03-hotspot-analysis/junior.md) — find *which* wrong abstraction actually costs money before you unwind it.
- [Automated Large-Scale Refactoring](../04-automated-large-scale-refactoring/junior.md) — collapse flag parameters and rename across call sites mechanically.
- [Strangler Fig & Seams](../05-strangler-fig-and-seams/junior.md) — characterization tests and seams for safe unwinding.
- [Expand-Contract Refactors](../06-expand-contract-refactors/junior.md) — how to remove an interface across many callers without a flag day.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the system-level siblings of over-abstraction.
- Level files: [`senior.md`](senior.md) — the full at-scale treatment this Q&A reviews.
