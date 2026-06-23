# Bad Shortcuts Anti-Patterns — Interview Q&A

> **Category:** [Development Anti-Patterns](../README.md) → **Bad Shortcuts** — *convenience taken now, paid back many times later.*
> **Covers (collectively):** Copy-Paste Programming · Magic Numbers / Strings · Hard Coding · Cargo Cult Programming · Pokémon Exception Handling · Stringly-Typed Programming

A bank of 65+ interview questions and answers spanning recognition, the everyday countermove, the *trap each fix hides*, and the runtime/observability/config-strategy implications. Each answer models the reasoning a strong candidate gives — including the trade-offs. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Intermediate / Middle](#intermediate--middle)
3. [Senior — Codebase-Scale Strategy & Root Causes](#senior--codebase-scale-strategy--root-causes)
4. [Professional / Deep — Performance, Observability, Config & Secrets](#professional--deep--performance-observability-config--secrets)
5. [Code-Reading — Name the Anti-Pattern](#code-reading--name-the-anti-pattern)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [How to Talk About Anti-Patterns in Interviews](#how-to-talk-about-anti-patterns-in-interviews)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> Definitions, recognition, and the "why is it bad" reasoning.

**Q1. Name the six bad-shortcut anti-patterns and give a one-line cost for each.**

<details><summary>Answer</summary>

- **Copy-Paste Programming** — the same logic in N places; you fix the bug once and miss the other N−1.
- **Magic Numbers / Strings** — unexplained literals in logic; nobody knows what `86400` or `"3"` means.
- **Hard Coding** — URLs, paths, credentials baked into source; can't change environment without a redeploy, and secrets leak.
- **Cargo Cult Programming** — code copied without understanding why; it carries noise and bugs you can't justify.
- **Pokémon Exception Handling** — "gotta catch 'em all" → silence; failures vanish and debugging becomes guesswork.
- **Stringly-Typed Programming** — `String`/raw int for things with a fixed value set; typos become runtime bugs the compiler could have caught.

The common thread: each defers a small naming/extraction/understanding step now and charges interest on every future edit.
</details>

**Q2. What's the difference between a code *smell* and an *anti-pattern*, using one of these as an example?**

<details><summary>Answer</summary>

A smell is a **local, syntactic observation** — "there's a `0.08` literal here," "this `catch` block is empty." An anti-pattern is the **recognized habit** the smell represents plus the **flawed reasoning** behind it. "Duplicate Code" is a smell; **Copy-Paste Programming** is the anti-pattern — the practice of duplicating *knowledge* because copying felt faster than extracting. The smell points your nose; the anti-pattern names the disease and implies the cure.
</details>

**Q3. Why are bad shortcuts a problem if the code "works"?**

<details><summary>Answer</summary>

"Works" measures correctness *today*; a shortcut is a tax on *every future touch*. Copy-paste means a bug must be fixed N times. A magic number means the next reader has to reverse-engineer intent. A swallowed exception means the failure surfaces later, far from its cause, with no diagnostic trail. The shortcut saved a minute once and costs an hour each time the code is read, changed, or debugged — which, over a codebase's life, is constantly. "It works" is not the same as "it's done."
</details>

**Q4. What exactly is a "magic number," and what's the minimal fix?**

<details><summary>Answer</summary>

A magic number (or magic string) is a bare literal doing real work in logic whose *meaning* isn't carried by a name — `if (elapsed > 86400)`, `price * 1.08`, `status.equals("3")`. The minimal fix is to give the value a name that documents the *concept*, not the value: `SECONDS_PER_DAY = 86_400`, `SALES_TAX_RATE = 0.08`. The name becomes the documentation, kills the "what does this mean?" question, and gives the value one authoritative home so changing it is a one-line edit. (Truly self-evident values like `0`, `1`, or the `2` in `total / 2` don't need naming.)
</details>

**Q5. Why is hard-coding a credential into source worse than hard-coding a URL?**

<details><summary>Answer</summary>

Both can't move between environments without a code change, but a credential adds an **irreversible security failure**: once committed, it lives in git history forever and in every clone, fork, and CI cache. Removing it in a later commit does *not* undo the exposure. A hard-coded URL is a portability problem you can fix by editing code; a leaked secret is a breach you can only remediate by *rotating the credential*. That asymmetry is why secrets are the one shortcut whose cost is catastrophic and unrecoverable.
</details>

**Q6. Where does the name "Pokémon Exception Handling" come from, and what does the code look like?**

<details><summary>Answer</summary>

From the slogan "gotta catch 'em all." The code catches *everything* and does *nothing*:

```python
try:
    result = risky()
except:        # bare except catches everything — even KeyboardInterrupt
    pass
```

```java
try { chargeCard(order); saveOrder(order); }
catch (Exception e) { /* silence */ }
```

The error is swallowed and execution continues as if it succeeded — so a failed charge produces a "successful" order with no log, no trace, no signal. The fix: catch only what you can handle, do something meaningful, and let everything else propagate loudly.
</details>

**Q7. What does "stringly-typed" mean, and how is it different from a magic string?**

<details><summary>Answer</summary>

**Stringly-typed** (a pun on "strongly-typed") is the *design choice* of using `String` (or raw int) as the type for something with a fixed, meaningful value set — `void setRole(String role)`, `String status`. A **magic string** is *any* unexplained string literal in logic — `if (status.equals("3"))`. They overlap when a magic string is the value of a stringly-typed field. The cure for both is the same: an enum or a small domain type, so `setRole(Role.ADMN)` won't compile and the IDE lists the valid values.
</details>

**Q8. Why is `except: pass` worse than letting the program crash?**

<details><summary>Answer</summary>

A crash gives you a stack trace, a message, and an unambiguous failure signal at the point of failure — you can debug it in minutes. `except: pass` deletes all of that and lets the program keep running in a *corrupt* state, so the failure resurfaces later, somewhere distant, with none of the information that would explain it. A loud failure is cheap; a silent corruption is expensive. Worse, a bare `except` also swallows real bugs (a `NameError`, a `KeyError`) right alongside the network error you were worried about.
</details>

**Q9. Give the smell test for each of the six. One line each.**

<details><summary>Answer</summary>

- **Copy-Paste:** "Am I about to Ctrl-V *knowledge*?" → extract instead.
- **Magic Number:** "Does this literal need a comment to explain it?" → it needs a *name*.
- **Hard Coding:** "Would this differ in prod, or is it a secret?" → configuration.
- **Cargo Cult:** "Why is this line here?" → if the honest answer is "the example had it," delete or learn it.
- **Pokémon:** an empty `catch` / bare `except:` → handle it or let it propagate.
- **Stringly-Typed:** "Does this `String` param accept only a fixed handful of values?" → enum / domain type.
</details>

**Q10. What is cargo cult programming, and why is the name apt?**

<details><summary>Answer</summary>

Cargo cult programming is keeping code you copied — from a tutorial, Stack Overflow, another file — *without understanding why it's there*. The name comes from post-WWII Pacific islanders who built straw "runways" hoping to summon the cargo planes back: imitating the ritual without grasping the cause. In code it's `df = df.copy()` "because the example had it," a `time.sleep(0.1)` nobody can explain, a design pattern applied because it's "the standard way." It's apt because the defining feature is *imitation in place of understanding* — and like the islanders, you get the form without the result.
</details>

**Q11. A teammate says "we should never duplicate any code, ever — DRY!" Why is that too strong?**

<details><summary>Answer</summary>

Because DRY is about not duplicating *knowledge* — a single business rule, calculation, or decision — not about avoiding all textual similarity. Two functions can look identical today yet encode *independent* rules that will diverge (username length vs. password length). Merging those into one shared helper *re-couples* things that should change separately, and the day one rule changes you bolt on flags or split it back out. Over-DRYing coincidental duplication produces worse coupling than the duplication it removed. The right test is "if rule A changes, *must* rule B change too?"
</details>

**Q12. Is a `String` always the wrong type for a status field?**

<details><summary>Answer</summary>

No. A `String` is wrong when the value set is **fixed and known at compile time** (PENDING/ACTIVE/CLOSED) — that's what enums are for. It's *acceptable* when the set is **open or data-defined**: free-form user tags, arbitrary keys from an external system, values that arrive from a database or config the code doesn't enumerate. Forcing an open set into an enum means a redeploy every time someone adds a value. So the rule is: enums for fixed code-known sets, strings (or a validated value type) for genuinely open ones.
</details>

---

## Intermediate / Middle

> When it creeps in, what to do instead, and the trade-offs.

**Q13. Nobody *wants* duplicated code — so when does copy-paste actually creep in?**

<details><summary>Answer</summary>

Under deadline pressure when "similar code already exists." The honest economics are: copying is one keystroke and extracting is a few minutes of designing a shared abstraction, and the cost of the copy is *deferred and diffuse*, so the local incentive favors the copy. It also creeps in when the existing code lives somewhere awkward to import from, or when the author doesn't yet see the shared concept. The middle skill is making extraction *cheap* (good module boundaries, the Rule of Three as a trigger) so pressure doesn't tip toward the copy.
</details>

**Q14. What is the "Rule of Three" and why three?**

<details><summary>Answer</summary>

Write it the first time; tolerate the duplication the second time (wince but wait); extract on the third. Three matters because two occurrences may be **coincidental** — they look alike but might encode different rules — and you can't yet see the right abstraction from two data points. By the third you have evidence that the duplication is *knowledge* and enough examples to design the abstraction so it fits all uses rather than just the first. It's a guard against premature, wrong-shaped extraction as much as against duplication.
</details>

**Q15. Give a concrete example of coincidental duplication you should NOT DRY.**

<details><summary>Answer</summary>

```python
def validate_username(s):   # usernames: 3–20 chars
    return 3 <= len(s) <= 20

def validate_password(s):   # passwords: 3–20 chars today, will become 8–64 soon
    return 3 <= len(s) <= 20
```

They're textually identical but encode **independent** rules. Merge them into `validate_length(s, 3, 20)` and the day passwords require 8–64 you either add parameters (re-coupling) or split them back out. You know it's coincidental by asking *"if the username rule changes, must the password rule change?"* — no. Keep them separate; the duplication is honest.
</details>

**Q16. Where should a named constant live — and what's the trap?**

<details><summary>Answer</summary>

Close to the code that owns it, grouped by **domain**, not by "it's a constant." A billing threshold belongs in the billing module next to its use, not in a global `Constants` file. The trap is the **`Constants` God-file**: one module accreting hundreds of unrelated values with zero cohesion, imported everywhere, a recompilation magnet. Also watch for a "constant" that's really config in disguise — if `MAX_CONNECTIONS = 50` differs between dev and prod, it's not a constant, it's configuration wearing a constant's clothes.
</details>

**Q17. Walk through the configuration spectrum — what goes where?**

<details><summary>Answer</summary>

- **Compile-time constant** — truly fixed values (mathematical/physical constants, fixed product rules that change only via deliberate code edits).
- **Config file, checked in** — non-secret per-environment defaults and tuning; versioned and reviewable.
- **Environment variable** — per-deploy values that differ across dev/staging/prod (endpoints, modes); the 12-factor default.
- **Secrets manager / runtime-injected** — passwords, API keys, tokens; must *never* touch source control.

The skill is matching the value to the right tier. Hard-coding pushes everything to tier one; over-configuration pushes everything to tier three. Most bugs come from putting a value one tier too low (secret in code) or too high (constant made configurable for no reason).
</details>

**Q18. A credential was committed last month and removed in the next commit. Are we safe? What must you do?**

<details><summary>Answer</summary>

**No, you are not safe.** The secret is permanently in git history and in every clone, fork, and CI cache that ever pulled it; removing it in a later commit changes nothing about the exposure. You must **rotate the credential** — invalidate the leaked one and issue a new one — treating it as compromised from the moment it was pushed. Optionally purge history (BFG/`filter-repo`), but rotation is mandatory and history-rewriting is best-effort cleanup, not remediation. Then add a secret scanner to pre-commit so it can't happen again.
</details>

**Q19. How do you turn a Pokémon `catch` into a deliberate error strategy?**

<details><summary>Answer</summary>

Four moves. **(1) Classify** errors into *expected/recoverable* (timeout, validation, declined card) vs. *bugs* (null deref, index error) — handle the first, let the second crash loudly so it gets fixed. **(2) Catch narrowly**, the specific type, at the layer that can actually act (retry, fall back, translate to a user message). **(3) Preserve the cause** when wrapping (`raise ... from e`, `new Exception(msg, e)`) so the diagnostic trail survives. **(4) Choose fail-fast vs. fail-safe per context** — a payment fails fast; a 10k-record batch may log-and-skip one bad record. The default is *propagate to a boundary*, not *catch everywhere*.
</details>

**Q20. Is catching and rethrowing always fine?**

<details><summary>Answer</summary>

Only if you **preserve the cause** and add value. `catch (Exception e) { throw new RuntimeException("failed"); }` is a *subtler Pokémon* — you "handled" it but destroyed the original stack trace, so you've thrown away the one thing that would explain the failure. Correct rethrow chains the cause (`throw new PaymentError("upstream rejected", e)` / `raise PaymentError(...) from e`) and ideally translates the error into a more meaningful type for the caller. Rethrowing the *same* exception with no added context is also pointless noise. Rethrow to translate or enrich, never to launder.
</details>

**Q21. Beyond enums — what else does "make illegal states unrepresentable" cover?**

<details><summary>Answer</summary>

Three more tools. **Wrapper / value types** for distinct concepts that happen to share a representation, so they can't be swapped: `type UserID string; type Email string` makes `send(email, userID)` a compile error if the args are reversed. **Invariant-enforcing types** whose constructor rejects bad values, so an invalid instance can't exist (`Percentage` that throws outside 0–100). **Sum types / sealed classes** for "one of these shapes," so the compiler forces you to handle each case. The principle: push validation into the type system once, at the boundary, instead of re-checking strings everywhere.
</details>

**Q22. When is a magic number actually OK to leave as a literal?**

<details><summary>Answer</summary>

When the value is **self-evident from context and carries no hidden domain meaning**: the `0` and `1` in identity/initialization, the `2` in `(a + b) / 2` for a midpoint, `i + 1` in a loop. Naming these (`final int TWO = 2;`) adds noise without adding meaning — it names the *value*, not a *concept*. The test is whether a name would tell the reader something the literal doesn't. `86400` hides "seconds per day"; `2` in an average hides nothing. Name concepts, not digits.
</details>

**Q23. Why can over-configuration be as harmful as hard-coding?**

<details><summary>Answer</summary>

Because every knob you add is a knob someone can mis-set, a dimension you must test combinations across, and a default you've now obscured. Making *everything* configurable is **Soft Coding** — an over-engineering anti-pattern where configuration becomes a worse, untyped, untested programming language living in YAML. It lets operators configure the system into invalid states the compiler would have rejected, and it hides the real behavior behind indirection. Configure what *genuinely varies per environment*; hard-code what doesn't. The opposite extreme of hard-coding is its own failure mode.
</details>

**Q24. Which of these six are mechanically detectable, and with what tooling?**

<details><summary>Answer</summary>

Most of them:

- **Copy-Paste** → duplication detectors: `jscpd`, PMD CPD, SonarQube, IDE "duplicate code" inspections.
- **Magic Numbers** → linter rules: ESLint `no-magic-numbers`, Checkstyle `MagicNumber`, `pylint` R2004.
- **Hard-coded secrets** → `gitleaks`, `git-secrets`, `trufflehog` in pre-commit and CI.
- **Pokémon exceptions** → `errcheck`/`staticcheck` (Go), `pylint` W0702 bare-except, SonarQube empty-catch rules.
- **Cargo Cult** and **Stringly-Typed** are harder to lint — they're caught in review by asking "can you justify this line?" and "is this a fixed value set?"

Let tools carry the mechanical load so human review focuses on judgment calls. A secret scanner in pre-commit is non-negotiable: it's the one whose cost is irreversible.
</details>

**Q25. What review questions surface each shortcut while the change is still small?**

<details><summary>Answer</summary>

- **Copy-Paste:** "Did this PR copy a block? Should it be extracted — or is it coincidental?"
- **Magic Number:** "What does this literal mean, and should it be config?"
- **Hard Coding:** "Is any credential or environment value in this diff?"
- **Cargo Cult:** "Can you explain every line you added, including the borrowed ones?"
- **Pokémon:** "What exceptions can this `catch` swallow that we'd actually want to know about?"
- **Stringly-Typed:** "Does this `String` parameter have a fixed set of valid values?"

Small, scoped PRs are the cheapest defense — these shortcuts hide easily in a 2,000-line diff and stand out in a 40-line one.
</details>

---

## Senior — Codebase-Scale Strategy & Root Causes

> Eliminating these at scale, organizational forces, and when *not* to fix them.

**Q26. How do you decide between a shared library and accepting duplication across services?**

<details><summary>Answer</summary>

Weigh **coupling cost vs. duplication cost**. A shared library means every consumer is now coupled to its release cycle, its versioning, and its breaking changes — and across service boundaries that coupling can reintroduce the distributed monolith you split the services to avoid. So: share *stable, truly-common knowledge* (a domain model, a wire protocol, crypto) via a well-versioned library; tolerate duplication of *small, divergent, or fast-moving* logic where the coupling would hurt more than the copy. The DRY-vs-decoupling trade-off flips at the service boundary — what's clearly worth sharing inside one module is often worth duplicating across two services.
</details>

**Q27. Sandi Metz says "duplication is far cheaper than the wrong abstraction." Unpack that.**

<details><summary>Answer</summary>

The wrong abstraction is *stickier* than duplication. Once code is merged behind a shared function, callers depend on it; when a new case doesn't quite fit, the path of least resistance is to add a parameter or a flag, then another, until the abstraction is a conditional-riddled tangle serving several masters poorly. Unwinding it requires inlining it back into every caller first — expensive and scary — so teams rarely do, and the wrong abstraction ossifies. Duplication, by contrast, is *independent*: you can fix or change one copy freely. Metz's prescription: when an abstraction starts sprouting flags, *re-inline it* and re-duplicate, then look for the better abstraction. Premature DRY is the trap; honest duplication is recoverable.
</details>

**Q28. What organizational forces breed these shortcuts? It's not just careless developers.**

<details><summary>Answer</summary>

**Deadline pressure** rewards the cheap copy and the "I'll configure it later." **No clear ownership** means borrowed snippets and constants have no obvious home, so they land wherever. **Tutorial-driven onboarding** without mentorship produces cargo cult at scale. **A blame culture** pushes people to swallow exceptions so nothing visibly breaks on their watch — silence feels safer than a loud failure. **Missing tooling** (no secret scanner, no duplication detector, no lint gate) means the mechanical catches never fire. **High turnover** erases the context that would let someone justify or delete borrowed code. Durably fixing shortcuts means addressing these forces — cheap-to-do-right tooling, clear ownership, blameless postmortems — not just lecturing about DRY.
</details>

**Q29. Design an error-handling architecture for a service so Pokémon handling can't take root.**

<details><summary>Answer</summary>

Centralize the *response* and decentralize the *meaning*. (1) Define a small **error taxonomy** — domain errors (recoverable, mapped to user-facing responses), and unexpected errors (bugs, mapped to 500 + alert). (2) Let domain code **throw typed errors** and otherwise let exceptions propagate — no catching "just in case." (3) Put **one boundary handler** (middleware, framework error handler, top-level recover) that logs with full context and a trace ID, maps known types to responses, and turns unknowns into a generic 500 *plus* an alert. (4) Forbid empty catches via lint. The result: every error is logged exactly once at the boundary with its cause chain intact, recoverable cases are handled near where they occur, and bugs surface loudly to on-call instead of vanishing.
</details>

**Q30. You join a team where `status` is a string compared by literal in 200 places. How do you migrate to an enum safely?**

<details><summary>Answer</summary>

Incrementally, with a seam. (1) Introduce the enum *alongside* the strings, with explicit `fromString`/`toString` at the system's edges (DB, API), pinning the exact string mappings with tests. (2) Convert call sites in small, reviewable batches — innermost logic first, then outward to the boundaries — each batch green-to-green. (3) Use the compiler as your worklist: change one function's parameter to the enum and follow the compile errors. (4) Keep the string at the persistence/wire boundary if the storage format must stay stable; the enum lives in the domain. (5) When the last internal comparison is converted, delete the string constants. Never big-bang; never mix this structural change with behavioral fixes in one commit.
</details>

**Q31. When should you *not* fix a bad shortcut?**

<details><summary>Answer</summary>

When the fix costs more than the shortcut. Don't refactor duplication in **stable, rarely-touched** code — an ugly copy nobody edits has near-zero change-cost, so the refactor is a speculative investment. Don't enum-ify a set that's genuinely **open** — you'll be redeploying to add values. Don't extract until you have enough examples to design the right abstraction (Rule of Three) — premature extraction is the wrong-abstraction trap. The two exceptions where you fix *regardless* of churn: a **leaked secret** (rotate now, it's a live breach) and a **swallowed exception on a critical path** (it's hiding failures you can't see). Prioritize the rest by change-frequency × pain.
</details>

**Q32. Can over-correcting Stringly-Typed create a different anti-pattern?**

<details><summary>Answer</summary>

Yes — **over-typing / type ceremony**, a cousin of Speculative Generality. Wrapping every primitive in a bespoke value type, enum-ifying open sets, or building a five-class hierarchy for a value used once locally adds boilerplate, conversion friction, and indirection without catching any real bug. The goal of types is to make *real* illegal states unrepresentable and prevent *real* confusions (mixing a `UserID` with an `Email`, an out-of-range percentage) — not to maximize the number of types. Reach for a type when a value crosses a boundary, has invariants, or is easily confused with another; leave a one-off local string alone.
</details>

**Q33. How do you eliminate hard-coded config across a large codebase without a risky big-bang?**

<details><summary>Answer</summary>

Introduce a **config layer** and migrate to it incrementally. (1) Stand up a typed config object loaded once at startup from env/file/secrets-manager, with validation that fails fast on missing required values. (2) Replace hard-coded values one subsystem at a time, defaulting each to its current hard-coded value so behavior is unchanged until you deliberately override it per environment. (3) Move secrets to the secrets manager *first* and rotate any that were ever committed. (4) Add a secret scanner to CI to stop regressions. (5) Keep the config *surface* small — only what genuinely varies — to avoid sliding into Soft Coding. Each step ships independently and is reversible.
</details>

**Q34. How does cargo cult scale from pasted snippets to pasted *architecture*?**

<details><summary>Answer</summary>

At scale it stops being "I copied a Stack Overflow snippet" and becomes "we adopted microservices / a factory-for-everything / event sourcing because that's how serious teams do it." The mechanism is identical — imitation in place of understanding — but the blast radius is the whole system, and it feeds Speculative Generality and Accidental Complexity. The countermove also scales: for every layer, pattern, framework, or service boundary, be able to answer "what concretely breaks or costs more if we *remove* this *here*?" "It's the industry standard" is the ritual, not the justification. Senior judgment is matching the solution to *your* problem's actual shape, not the canonical example's.
</details>

**Q35. A teammate argues "duplicated code is fine, the compiler/CPU doesn't care." How do you respond?**

<details><summary>Answer</summary>

Concede the narrow point and reframe. Correct: duplication has essentially no *runtime* cost — duplicated logic compiles to the same instructions, and (see the perf section) inlining can even make duplicated code *faster* than an abstracted version. But the cost of copy-paste was never CPU cycles; it's **bug propagation and change-cost**. A bug fixed in one copy stays alive in the others, and you *will* miss one; a requirement change must be applied N times consistently. We de-duplicate *knowledge* to make change safe and cheap, for the maintainer — not for the CPU. (And in the *coincidental* case, he's right to keep them separate — for a different reason.)
</details>

**Q36. How do you prioritize which shortcuts to pay down when the codebase is full of them?**

<details><summary>Answer</summary>

By **irreversibility and change-frequency × pain**, in that order. First, the irreversible/critical: any **leaked secret** (rotate immediately) and any **swallowed exception masking failures on a live path** (you're flying blind). Then pull churn data — the duplication, magic values, and stringly-typed fields in high-churn, high-bug files cost the most because the tax is paid every edit; fix those, opportunistically, alongside the feature work that touches them. A magic number in a frozen module ranks near zero. Let the data and the blast radius set the order, not how much each one annoys you.
</details>

---

## Professional / Deep — Performance, Observability, Config & Secrets

> Runtime, memory, observability, and config/secrets strategy.

**Q37. Why might duplicated code actually run *faster* than the DRY version?**

<details><summary>Answer</summary>

Because extraction introduces an indirection the compiler may not erase. Pulling shared logic into a function call adds call overhead, and if the extraction goes through an *interface / virtual method*, the call site is **megamorphic** — the JIT can't devirtualize or inline it, so it stays a real dispatch with poor branch prediction and lost optimization across the boundary. Inlined (duplicated) code, by contrast, lets the compiler specialize each copy to its context — constant-fold, eliminate dead branches, keep values in registers, and vectorize. This is exactly why hot numeric kernels and stdlib code are sometimes *deliberately* duplicated/specialized (and why Go's generics-vs-copy debates exist). It's a real but *narrow* effect: it matters only on proven hot paths, and even there you measure rather than assume. Readability still wins everywhere else.
</details>

**Q38. Do magic numbers have any runtime cost, or is it purely readability?**

<details><summary>Answer</summary>

Purely readability/maintainability — with one subtle correctness edge. A named constant and an inline literal compile to identical code (the constant is folded in), so there's no performance difference. The *correctness* risk is the human one: the same magic value duplicated in several places can silently **drift** — someone updates `0.08` to `0.09` in four of five sites — producing inconsistency a single named constant would have prevented. And a typo'd literal (`8640` for `86400`) is invisible, whereas a misused named constant is at least greppable and reviewable. The cost is in human reliability, not cycles.
</details>

**Q39. How does Pokémon exception handling sabotage observability specifically?**

<details><summary>Answer</summary>

It destroys the three pillars at the source. **Logs:** the swallowed exception is never logged, so the failure is invisible in log search. **Metrics:** an error that's caught-and-ignored never increments an error counter, so your error-rate dashboards read healthy while the system silently fails — your SLOs lie. **Traces:** the span completes "successfully," so distributed traces show a green path through a broken operation. The result is a system that *looks* healthy on every dashboard while corrupting data or dropping work. Worse, when you finally notice (via customer complaints), there's no telemetry to localize the cause. Loud failure is what *feeds* observability; swallowing starves it.
</details>

**Q40. Design a secrets-management strategy for a service from scratch.**

<details><summary>Answer</summary>

Layered, with rotation built in. (1) **Never in source or committed config** — enforce with a pre-commit + CI secret scanner (`gitleaks`/`trufflehog`). (2) **Inject at runtime** from a secrets manager (Vault, AWS/GCP Secrets Manager, k8s Secrets sealed properly) or, minimally, environment variables populated by the platform — not baked into the image. (3) **Least privilege** — each service gets only the secrets it needs, scoped per environment. (4) **Rotation** — short-lived/auto-rotated credentials where possible (dynamic DB creds, IAM roles), and a documented rotation runbook for the rest; treat any committed secret as compromised and rotate immediately. (5) **Audit** — log secret access, alert on anomalies. (6) **No secrets in logs or error messages** — scrub them, or you've re-leaked via observability. The throughline: secrets enter the process at runtime, are scoped tightly, and can be rotated without a code change.
</details>

**Q41. What's the difference between configuration and feature flags, and when does each become an anti-pattern?**

<details><summary>Answer</summary>

**Configuration** holds values that vary by *environment* and rarely change at runtime (endpoints, pool sizes, secrets). **Feature flags** hold *runtime, often per-user* toggles for rollout, experiments, and kill switches. Config becomes an anti-pattern as **Soft Coding** — when you make everything configurable and the config file becomes an untyped program. Flags become an anti-pattern when they're **never retired** — a flag added "until we're sure" goes permanently `true`, fossilizing the old branch into Lava Flow. The shared discipline: keep both surfaces *small and owned*, with defaults that are safe, validation that fails fast, and a lifecycle that removes the knob (and its dead branch) once it's no longer needed.
</details>

**Q42. How can a stringly-typed design hurt performance, not just correctness?**

<details><summary>Answer</summary>

Several ways. **Comparisons:** `status.equals("ACTIVE")` is a string compare (hash + char scan on mismatch) in a hot loop, where an enum is a single integer/reference compare. **Allocation & GC:** passing strings around allocates and interns; enums are singletons with zero per-use allocation. **Parsing tax:** stringly-typed values are re-validated/re-parsed at every boundary because the type guarantees nothing, so you pay `parse`/`switch` repeatedly instead of once. **Cache & memory:** an `int`/enum field is far smaller and more cache-friendly than a `String` reference plus its backing array. On hot paths these add up; the correctness win (compiler-checked) usually matters more, but the performance win is real and worth naming.
</details>

**Q43. Copy-paste vs. a shared dependency: what are the *operational* trade-offs at deploy time?**

<details><summary>Answer</summary>

A shared library couples *release cadence and blast radius*. A bug fix in a shared lib means every consumer must upgrade and redeploy to get it — good for consistency, but a single bad version can break many services at once, and a CVE in the shared dep forces a coordinated rollout. Duplicated logic, by contrast, lets each service deploy independently and contains the blast radius, at the cost that the fix must be applied N times and may drift. Operationally: shared deps centralize both the *fix* and the *risk*; duplication decentralizes both. For org-wide invariants (security, protocol) you want centralized; for fast-moving service-local logic you often want the isolation of a copy.
</details>

**Q44. What does "fail fast vs. fail safe" mean as a deliberate design axis, with examples?**

<details><summary>Answer</summary>

It's choosing, per operation, whether an error should *stop everything* or *be contained and continue* — the opposite of Pokémon's reflexive "always continue." **Fail fast:** a payment, a financial transaction, a corrupt-config-at-startup — better to abort loudly than proceed in a wrong state; you crash, alert, and fix. **Fail safe:** a 10k-record batch job that log-and-skips one malformed record, a recommendation widget that renders empty rather than failing the whole page, a circuit breaker that serves stale cache when a dependency is down. The wrong default is what makes Pokémon handling: blanket fail-safe (`except: pass`) on operations that should fail fast. Each operation's choice is a design decision tied to the cost of proceeding-while-wrong vs. stopping.
</details>

**Q45. Why doesn't moving secrets to a checked-in config file fix the secrets problem?**

<details><summary>Answer</summary>

Because the leak vector is *source control*, not *source code* specifically. A `config.yaml` with a password committed to git is in history forever, in every clone, and in CI caches — exactly the same exposure as a hard-coded literal, just in a different file. "Configuration" only helps when the secret value comes from *outside* the repository at runtime (env var injected by the platform, a secrets manager). The fix isn't "move the secret to config," it's "move the secret *out of the repo* and inject it at deploy time" — and rotate anything ever committed. A committed config secret is the same breach wearing a config file's clothes.
</details>

---

## Code-Reading — Name the Anti-Pattern

> You're shown a snippet; identify the anti-pattern(s) and state the fix.

**Q46. Which anti-pattern, and what's the fix?**

```python
try:
    n = int(request.args["count"])
    items = fetch(n)
    render(items)
except:
    pass
```

<details><summary>Answer</summary>

**Pokémon Exception Handling** (a bare `except: pass`). It swallows everything — a missing `count` key, a non-numeric value, a `fetch` failure, *and* any real bug in `render` — leaving the user with a blank result and you with no log. Fix: catch the *specific, expected* failure, handle it meaningfully, and let the rest propagate:

```python
try:
    n = int(request.args["count"])
except (KeyError, ValueError):
    return bad_request("count must be an integer")
items = fetch(n)          # a fetch/render bug now propagates to the boundary handler, logged with a trace
render(items)
```
</details>

**Q47. Which anti-pattern(s), and what's the fix?**

```java
if (user.getStatus().equals("3") && user.getRole().equals("ADMIN")) {
    grantAccess(user, 86400);
}
```

<details><summary>Answer</summary>

Three at once: **Magic Strings** (`"3"`), **Stringly-Typed** (status and role are strings), and a **Magic Number** (`86400`). `"3"` is meaningless, `"ADMN"` would compile fine, and `86400` hides "one day in seconds." Fix with enums and named constants:

```java
enum Status { ACTIVE, PENDING, SUSPENDED }
enum Role   { ADMIN, EDITOR, VIEWER }
static final Duration ACCESS_TTL = Duration.ofDays(1);

if (user.getStatus() == Status.SUSPENDED && user.getRole() == Role.ADMIN) {
    grantAccess(user, ACCESS_TTL);
}
```
Now a typo'd status or role won't compile, and the TTL reads as intent.
</details>

**Q48. Which anti-pattern, and what's the fix?**

```go
func connect() *sql.DB {
    db, _ := sql.Open("postgres", "postgres://admin:S3cr3t@10.0.0.5:5432/prod")
    return db
}
```

<details><summary>Answer</summary>

**Hard Coding** — *and* a hard-coded **secret**, *and* (the `_`) a Pokémon-adjacent ignored error. The DSN bakes the host, database, and credentials into source: it only works against prod, breaks in any other environment, and leaks `S3cr3t` into git history forever. Fix: read the DSN from the environment, and handle the error:

```go
func connect() (*sql.DB, error) {
    dsn := os.Getenv("DATABASE_URL")   // injected per environment; secret never in source
    if dsn == "" {
        return nil, errors.New("DATABASE_URL not set")
    }
    return sql.Open("postgres", dsn)
}
```
And because `S3cr3t` was committed, **rotate it** — removing the line doesn't undo the leak.
</details>

**Q49. Which anti-pattern, and what's the fix?**

```python
def total_member(items):
    subtotal = sum(i.price for i in items)
    shipping = 0 if subtotal > 100 else 9.99
    return subtotal * 0.9 + shipping

def total_guest(items):
    subtotal = sum(i.price for i in items)
    shipping = 0 if subtotal > 100 else 9.99   # copied
    return subtotal + shipping
```

<details><summary>Answer</summary>

**Copy-Paste Programming** — the free-shipping rule (`> 100 ? 0 : 9.99`) is duplicated *knowledge*; change the threshold and you must fix both and will eventually miss one. This is genuine (not coincidental) duplication: both functions must use the *same* shipping rule. Extract it:

```python
FREE_SHIPPING_THRESHOLD = 100
STANDARD_SHIPPING = 9.99

def shipping_for(subtotal):
    return 0 if subtotal > FREE_SHIPPING_THRESHOLD else STANDARD_SHIPPING

def total(items, member):
    subtotal = sum(i.price for i in items)
    return subtotal * (0.9 if member else 1.0) + shipping_for(subtotal)
```
Note this also killed the magic numbers `100` and `9.99`.
</details>

**Q50. This Python was pasted from a blog. Which anti-pattern, and what's suspicious?**

```python
import pandas as pd
def load(path):
    df = pd.read_csv(path)
    df = df.copy()                       # ?
    df = df.reset_index().reset_index()  # ?
    return df
```

<details><summary>Answer</summary>

**Cargo Cult Programming.** The `df.copy()` right after `read_csv` is pointless — `read_csv` already returns a fresh frame — and the double `reset_index()` adds two spurious index columns; both were almost certainly copied from a context where they meant something. The fix isn't to "clean them up" cosmetically — it's to *justify or delete*: read the pandas docs, confirm each line's purpose, and remove what you can't justify. Here, both lines go:

```python
def load(path):
    return pd.read_csv(path)
```
If a later need for a copy or reset appears, add it deliberately with a reason.
</details>

**Q51. Which anti-pattern, and what's the fix?**

```go
func sendInvite(from string, to string) { /* ... */ }

sendInvite(userEmail, inviterID)   // oops — args swapped, compiles fine
```

<details><summary>Answer</summary>

**Stringly-Typed Programming.** Both an email and a user ID are `string`, so the compiler can't tell them apart and silently accepts the swapped arguments — a runtime bug. Fix with distinct value types:

```go
type Email  string
type UserID string

func sendInvite(from UserID, to Email) { /* ... */ }

sendInvite(userEmail, inviterID)  // now a COMPILE error: types don't match
```
The type system now rejects the confusion at compile time. (Add validating constructors if these have invariants, e.g. a well-formed email.)
</details>

**Q52. Which anti-pattern, and why is the "fix" in the comment wrong?**

```java
try {
    process(order);
} catch (Exception e) {
    throw new RuntimeException("processing failed");  // "we rethrow, so it's fine"
}
```

<details><summary>Answer</summary>

**Pokémon Exception Handling in disguise** — it catches broadly and rethrows *without the cause*, discarding the original exception's type and stack trace. The "we rethrow" defense is wrong because the diagnostic information (what *actually* failed inside `process`) is destroyed; you've laundered a specific failure into a generic one. Fix: chain the cause and, ideally, don't catch broadly at all:

```java
try {
    process(order);
} catch (PaymentDeclinedException e) {
    throw new OrderFailedException("payment declined for order " + order.id(), e); // cause preserved
}
// a bug (NPE) is NOT caught here — it propagates to the boundary handler loudly
```
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q53. "Is all duplication bad?"**

<details><summary>Answer</summary>

No. Only duplication of *knowledge* is bad. **Coincidental duplication** — code that looks identical today but encodes independent rules that will diverge — should be *kept* separate; merging it creates the wrong abstraction, which Sandi Metz argues is more expensive than the duplication. There's also **trivially-cheap duplication** (a two-line setup repeated in tests for clarity) where extraction would hurt readability more than it helps. The discriminator is always: *if one copy must change, must the others change too?* Yes → it's one piece of knowledge, DRY it. No → it's coincidental, leave it. "Never duplicate" is a juniorism.
</details>

**Q54. "A teammate committed a secret then removed it the next commit. Are we safe?"**

<details><summary>Answer</summary>

No. The secret is in git history permanently and in every clone, fork, and CI cache that pulled it; the removal commit does nothing for the exposure. You must **rotate the credential** — treat it as compromised from the instant it was pushed — and only then optionally rewrite history. Rotation is mandatory; history-scrubbing is best-effort cleanup. Then add a pre-commit secret scanner so it can't recur. Anyone who answers "yes, it's removed now" has missed that source control is durable and distributed.
</details>

**Q55. "When is a magic number OK?"**

<details><summary>Answer</summary>

When a name would add no meaning the literal doesn't already carry: `0`/`1` in initialization or identity, `2` in `(a+b)/2`, `i+1` to step a loop. Naming these (`TWO = 2`) names the *value*, not a *concept*, and adds noise. The line is whether the number hides domain knowledge: `86400` hides "seconds per day" and must be named; `2` in an average hides nothing. So "magic numbers are always bad" is too strong — *unexplained domain values* are bad; self-evident arithmetic constants are fine.
</details>

**Q56. "When is using `String` for a status field acceptable?"**

<details><summary>Answer</summary>

When the value set is genuinely **open** — not fixed and known to the code. Free-form user-defined tags, categories that come from a database table operators edit, keys forwarded from an external system, or any set that would otherwise require a redeploy to extend. Enums are for *closed, code-known* sets; forcing an open set into an enum couples the value list to your release cycle. (Even then, you often want a *validated* string value type rather than a raw `String`, so it's checked once at the boundary.) The trap is the reverse mistake too — enum-ifying an open set.
</details>

**Q57. "Is catching and rethrowing always fine?"**

<details><summary>Answer</summary>

Only when you **preserve the cause and add value**. Rethrowing while dropping the original exception (`throw new RuntimeException("failed")`) is a subtle Pokémon — you destroyed the stack trace, the one thing that explains the failure. Rethrowing the *same* exception unchanged is pointless noise. Good rethrow *translates* a low-level error into a meaningful domain type while chaining the cause (`... from e`, `new X(msg, e)`), so callers get a clean abstraction and you keep the trail. So: rethrow to translate or enrich, with the cause attached — never to launder or to add nothing.
</details>

**Q58. "Why might duplicated code be faster than DRY code?"**

<details><summary>Answer</summary>

Because extraction can introduce indirection the optimizer can't remove. A call through an interface/virtual method that becomes megamorphic blocks inlining and devirtualization, costing a real dispatch and lost cross-boundary optimization. Inlined (duplicated) code lets the compiler specialize each copy to its context — constant-fold, prune dead branches, vectorize. That's why hot kernels and some stdlib code are deliberately specialized rather than shared. But it's a *narrow* effect on proven hot paths, measured not assumed; everywhere else, the maintainability of DRY (de-duplicated *knowledge*) wins. The point of the question is to see if you separate runtime cost from change-cost.
</details>

**Q59. "We use a `Constants.java` file with all our constants in one place — isn't that good DRY?"**

<details><summary>Answer</summary>

No — it's a **God-file** wearing DRY's clothes. Grouping constants by "they're all constants" instead of by domain destroys cohesion: unrelated values pile up, the file is imported almost everywhere (a recompilation magnet), and nothing tells you which constant belongs to which concept. DRY is about one *authoritative home per piece of knowledge*, and a constant's home is *next to the code that owns it*, grouped by domain (`billing.FreeShippingThreshold`). Centralizing the *location* isn't the goal; centralizing each piece of *knowledge* in its rightful module is.
</details>

**Q60. "Our config makes everything tunable so we never have to redeploy — isn't maximum flexibility good?"**

<details><summary>Answer</summary>

No — that's **Soft Coding**, the over-engineered opposite of hard-coding. Every knob is something to mis-set, a combination to test, and a default you've obscured; taken far enough, the config file becomes an untyped, untested, undebuggable programming language living in YAML, and operators can configure the system into states the compiler would have rejected. Flexibility has a cost. Configure what *genuinely varies by environment*; hard-code what doesn't. "Never redeploy" is not a goal worth an unbounded configuration surface.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q61. One-line cure for each of the six?**

<details><summary>Answer</summary>

Copy-Paste → extract the shared *knowledge* (Rule of Three). Magic Numbers/Strings → name the concept. Hard Coding → push to config; secrets out of the repo. Cargo Cult → justify every line or delete it. Pokémon → catch narrow, chain the cause, propagate the rest. Stringly-Typed → enums / value types so illegal states won't compile.
</details>

**Q62. The phrase that signals coincidental duplication?**

<details><summary>Answer</summary>

"These happen to look the same *right now*." If they change for different reasons, keep them apart.
</details>

**Q63. The fastest tell of cargo cult code?**

<details><summary>Answer</summary>

A line whose only justification is "the example had it" or "just in case."
</details>

**Q64. One sentence: what do you do the instant you learn a secret was committed?**

<details><summary>Answer</summary>

Rotate it — assume it's compromised; removing the commit does nothing.
</details>

**Q65. Magic string vs. stringly-typed in one line?**

<details><summary>Answer</summary>

A magic string is an unexplained literal; stringly-typed is using `String` as the *type* for a fixed value set — the literal is the symptom, the type choice is the disease.
</details>

**Q66. The one rule that ties all six together?**

<details><summary>Answer</summary>

A shortcut that saves a minute now and costs an hour on every future touch was never a shortcut.
</details>

**Q67. Why do these anti-patterns cluster?**

<details><summary>Answer</summary>

They share one root habit — *skip the small naming/extraction/understanding step* — so taking one (cargo-culting a snippet) drags the others in (its copy-pasted `except: pass` and magic strings come along for the ride).
</details>

**Q68. Two golden rules for fixing them?**

<details><summary>Answer</summary>

Make the right move *cheap* (snippets, tooling, conventions) so deadline pressure doesn't pick the shortcut — and remember every fix has an over-applied trap (over-DRY, over-config, over-catch, over-type): judgment beats reflex.
</details>

---

## How to Talk About Anti-Patterns in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the *cost*, not the label.** Don't just say "that's a magic number." Say *why it hurts* — "nobody can tell what it means, and if it's duplicated it'll silently drift." Interviewers want the reasoning, not the vocabulary.
- **Always name the trap in the fix.** Senior signal is knowing the over-applied failure mode: over-DRYing coincidental duplication, Soft Coding from over-configuration, over-catching that re-creates Pokémon one call at a time, over-typing ceremony. "It depends, and here's on what" beats absolutism.
- **Treat secrets as a category apart.** Be unambiguous that a committed secret means *rotate now* and that source control is durable — this is the one shortcut whose cost is irreversible, and getting it wrong is an instant red flag.
- **Separate runtime cost from change-cost.** Most of these are maintainability problems, not performance ones — and being able to say "duplication can even be *faster*, but that's not why we DRY" shows depth.
- **Distinguish "I'd fix this" from "I'd fix it now."** Knowing *when not to* (open sets, stable low-churn code, before the Rule of Three) is a stronger signal than reflexively cleaning everything.
- **Tie it to observability/config when asked to go deep.** Swallowed exceptions break logs/metrics/traces; config strategy spans the constant→config→env→secrets-manager spectrum. These show you've operated systems, not just read books.
- **Use a concrete example.** "We had a stringly-typed `status` compared in 200 places; here's how we migrated it to an enum behind a boundary mapping" lands far harder than a definition.

---

## Summary

- The six bad-shortcut anti-patterns trade a small convenience now for a recurring cost later: **Copy-Paste** (duplicated bugs), **Magic Numbers/Strings** (unexplained literals), **Hard Coding** (unmovable code + leaked secrets), **Cargo Cult** (unjustifiable lines), **Pokémon Exceptions** (invisible failures), and **Stringly-Typed** (compiler-blind types).
- Recognition is the junior bar; the middle bar is knowing *when each creeps in*, the cheap countermove, and the *trap each fix hides* (over-DRY, over-config, over-catch, over-type); the senior bar is *codebase-scale strategy* (shared-lib vs. duplication, error architecture, config/enum migrations) and *organizational root causes*; the professional bar is the *performance, observability, and config/secrets* consequences.
- The strongest answers lead with **cost and reasoning**, name **trade-offs**, separate **runtime cost from change-cost**, and treat a **committed secret as an immediate rotation**, not a removed line.
- The recurring curveball insight: *all duplication isn't bad* (coincidental), *some magic numbers are fine* (self-evident), *some strings are right* (open sets), and *rethrowing must preserve the cause*. Judgment, not reflex.

---

## Related Topics

- [`junior.md`](junior.md) — what each shortcut looks like and why it's bad.
- [`middle.md`](middle.md) — when each creeps in, the countermove, and the trap in each fix.
- [`senior.md`](senior.md) — eliminating these at codebase scale: shared-library trade-offs, config strategy, error-handling architecture, type-driven design.
- [`professional.md`](professional.md) — performance, observability, and config/secrets implications.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — practice the diagnosis and cleanup.
- [Clean Code → Error Handling](../../../clean-code/06-error-handling/README.md) — the cure for Pokémon exception handling.
- [Clean Code → Meaningful Names](../../../clean-code/01-meaningful-names/README.md) — naming away magic values.
- [DRY Principle](../../../clean-code/README.md) — and Sandi Metz's "wrong abstraction" counterpoint.
- [Secrets Management](../../../../../Architecture/system-design/README.md) — handling credentials safely.
- [Over-Engineering](../03-over-engineering/middle.md) — Soft Coding and Speculative Generality, the over-applied versions of these fixes.
- [Bad Structure](../01-bad-structure/interview.md) — the sibling category; its `interview.md` shares this format.
