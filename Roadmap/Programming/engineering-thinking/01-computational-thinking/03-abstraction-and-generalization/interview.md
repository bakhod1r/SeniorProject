> Interview questions on abstraction and generalization — the third pillar of computational thinking. Answers are short and precise; each flags the trap interviewers probe and the natural follow-up. The single highest-signal theme is the *over-abstraction failure mode*: knowing when **not** to abstract separates senior from mid.

---

## Q1. Define abstraction in one sentence.

Abstraction is deciding what to *ignore* — removing the detail irrelevant to the problem so that what's *left* is the essence, expressed at a new, precise semantic level.

**Trap:** "abstraction = adding layers / making it generic." It's the opposite — it's *subtraction*. **Follow-up:** Dijkstra's line — abstraction exists "not to be vague but to create a new semantic level in which one can be absolutely precise."

## Q2. What's the difference between abstraction and generalization?

Abstraction hides *detail* behind a boundary (you stop caring *how*). Generalization widens *scope* — taking a solution for one case and parameterizing the variation so it covers N cases. You can abstract without generalizing (a one-off helper with a good name) and generalize without cleanly abstracting (a flag-ridden mega-function).

**Follow-up:** Which is riskier? Generalization — because premature generalization produces the wrong abstraction.

## Q3. What is a leaky abstraction? Give a real example.

Joel Spolsky's Law: *all non-trivial abstractions are leaky to some degree.* The hidden complexity surfaces and forces you to understand the layer you were trying to ignore. Examples: an ORM hides SQL until an N+1 query forces you to read the generated SQL; TCP hides the unreliable network until packet loss spikes latency; `0.1 + 0.2 != 0.3` leaks floating-point representation.

**Trap:** claiming you can build a non-leaky abstraction. You can't; you can only choose *good* leaks — rare, predictable, with an escape hatch.

## Q4. When is duplication better than abstraction?

When the code only *looks* alike but doesn't share a *reason to change*; when you've seen it fewer than three times; and whenever the alternative is a "wrong" shared abstraction. Sandi Metz: **"duplication is far cheaper than the wrong abstraction."** Duplication's cost is local and linear; a wrong abstraction couples every caller and its cost is global and super-linear.

**Follow-up:** Why is the wrong abstraction so expensive to remove? Because callers have grown to depend on its flags; the honest fix is to *re-inline* it back into each caller, then re-extract the real shared thing.

## Q5. What is the rule of three?

Don't extract an abstraction until you've seen the third occurrence (Fowler, *Refactoring*). Two occurrences don't yet reveal the true shape of the variation; the third does. Abstracting on the first or second is guessing.

**Trap:** treating it as a hard law. It's a heuristic — three *real* occurrences that share a reason to change, not three look-alikes.

## Q6. How does this relate to DRY? Isn't DRY "never duplicate"?

DRY (Hunt & Thomas) is about not duplicating *knowledge / a decision* — "every piece of knowledge must have a single, authoritative representation." It is *not* "delete code that looks similar." Two functions that coincidentally share a shape encode *different* knowledge; merging them violates the *spirit* of DRY. The corrective slogan is **AHA** — "Avoid Hasty Abstractions" (Kent C. Dodds).

## Q7. What does "don't mix levels of abstraction" mean?

A unit of code should operate at one altitude. A function that does high-level orchestration (business rules) *and* low-level byte/encoding work in the same body forces the reader to keep changing mental gears and hides the story. Split each level into its own named helper so the top reads as: select → format → store.

**Follow-up:** Name the principle — Single Level of Abstraction Principle (popularized in *Clean Code*).

## Q8. What is information hiding and who's associated with it?

David Parnas (1972): a module should hide the **design decisions most likely to change** behind a stable interface, so a change is contained to one module instead of rippling across the system. The test: *can you rewrite the implementation without any caller noticing?* If not, the abstraction leaked the thing it was supposed to hide.

## Q9. "Every problem can be solved by another layer of indirection" — what's the catch?

The full quote (Lampson, crediting Wheeler): *"…except for the problem of too many layers of indirection."* Each layer taxes you — cognitive cost (chasing a bug through five files), performance cost (allocations/virtual calls per boundary), and change amplification (one concept edited in five places). A layer earns its tax only if it hides a real decision someone needs hidden.

**Trap:** the pass-through `ServiceImpl` behind a one-implementation interface — pure tax, hides nothing.

## Q10. How do you choose the right level of abstraction for an API?

Match the abstraction's vocabulary to the *consumer's* mental model, not the implementer's. App developers want `payments.charge(order)`; library authors want `gateway.authorize(token, cents, currency)`. Forcing app developers to assemble idempotency keys and currency minor-units is leaking implementer concerns upward — a defect even if the code is correct.

## Q11. How is a good name an abstraction?

A name is the compressed contract of the thing. `getUser()` promises a cheap accessor; if it actually does a network call that can fail, the name leaks a lie. Good names encode *what* and the *cost/failure surface*: `cache.get_user` (cheap, may miss) vs `api.fetch_user` (remote, async, can fail). A vague name (`process`, `handle`, `data2`) signals you never decided what the thing is.

## Q12. What is speculative generality / over-engineering, and how do you spot it?

Building flexibility for requirements that don't exist — abstract base classes with one subclass, config for things that never vary, plugin systems with one plugin, a boolean flag added so two cases can "share" code. Smell test: are you adding a parameter to satisfy a *hypothetical* future, or a *real, present* second case? YAGNI — only the second justifies the abstraction.

**Follow-up:** the flag smell — adding a boolean to share code usually means you have *two* functions, not one.

## Q13. Walk me through unwinding a wrong abstraction you've inherited.

(1) Stop adding flags. (2) **Inline** the shared abstraction back into each caller, restoring the duplication — this makes each call site's *true* behavior visible. (3) Now that the real cases are visible, identify the smaller thing they *actually* share. (4) Re-extract that. Inlining first is what makes the correct abstraction discoverable; trying to "fix" the tangle in place just adds more conditionals.

## Q14. When does concrete beat abstract?

One genuine caller with no foreseeable second (YAGNI); a hot path where indirection/allocation costs dominate; throwaway/spike code with no maintenance lifetime to amortize the investment; and when the axis of variation isn't stable yet — if you can't name what varies, you can't draw the boundary, so stay concrete and let the requirements teach you the shape.

## Q15. At platform scale, why is the bar for committing an abstraction higher?

Because adoption freezes it. A concept used by one team is cheap to get wrong; a concept 40 teams import can't be changed without an N-team migration, and Hyrum's Law means consumers depend on behaviors you never promised. So platforms ship abstractions *late*, behind versioning, preferring thin honest primitives over thick clever-but-wrong unifications — and they run deprecations as programs (quantify → bridge → make-it-the-easy-path → stage → fund-or-freeze the tail).

## Q16. How does abstraction relate to the other pillars of computational thinking?

Decomposition splits a problem into parts; abstraction decides what each part hides and exposes — they're partners. Pattern recognition finds the recurring shape that *justifies* an abstraction. Algorithmic thinking turns the abstraction's contract into concrete steps. Abstraction is the linchpin: get the boundaries wrong and decomposition and algorithm design inherit the mistake.
