> Interview questions on spikes and prototypes. These probe whether you understand the *discipline* — one question, a time box, throwaway code, a recorded decision — and whether you can keep the spike / prototype / PoC / MVP distinctions straight. Strong answers are concrete and tie exploration to risk. Watch for the trap baked into several questions: the interviewer is checking that you'd never ship the spike.

---

## Q1. What is a spike?

A spike (from Extreme Programming) is a **small, time-boxed, throwaway piece of code written to answer one specific technical question** you can't answer by reading or reasoning. Its deliverable is a *decision plus a short writeup*, not a feature.

**Trap:** "It's a quick prototype." Too loose. The defining traits are *one* question, a *time box*, and that the code is *thrown away*. Miss those and it isn't a spike.

---

## Q2. Spike vs prototype vs PoC vs MVP — what's the difference?

| | Answers | Kept? | Real product? |
|---|---|---|---|
| **Spike** | One technical unknown | No | No |
| **Prototype** | What should it look/work like? | Usually no | No |
| **PoC** | Is this whole approach viable? | Sometimes | No |
| **MVP** | Will real users get value? | Yes | **Yes** |

The fault line: spike/prototype/PoC are **exploratory and disposable**; the **MVP is real, shippable production software**. Conflating them is how teams accidentally ship experiments.

**Follow-up — "Is an MVP a prototype?"** No. An MVP is the *smallest production product*; a prototype is *not production*. Different intent, different quality bar.

---

## Q3. What do you do with spike code when you're done?

**Delete it.** You keep the *knowledge* — the decision and the writeup — and throw away the code, then implement the real thing properly through normal review and testing.

**Trap:** "If it works, build on it." That's the **prototype-to-production trap**. Spike code is deliberately low quality — no tests, no error handling, hardcoded shortcuts — so every shortcut you took on purpose becomes permanent debt if you promote it.

---

## Q4. Why is the time box essential, not optional?

The time box is the mechanism that makes a spike *safe*. It encodes the judgment "this uncertainty is worth at most N hours to resolve." Without it, exploration expands to fill all available time and a 2-hour risk-reduction becomes a 2-week rabbit hole.

**Follow-up — "What if you hit the box without an answer?"** That *is* a result: the problem is harder than planned. You report that to planning — don't silently keep going.

---

## Q5. When should you NOT spike?

When the answer is **knowable without running code**: it's in the docs, a colleague already knows it, or a back-of-envelope calculation settles it. Also when it's a **design preference** (resolve by discussion) or a **reversible decision** (just pick one and move). Spike only when the answer is unknowable without code *and* the decision is expensive to reverse.

**Trap:** treating the spike as the default for any uncertainty. Over-spiking is procrastination dressed as diligence.

---

## Q6. What's the difference between throwaway and evolutionary prototyping?

**Throwaway** prototyping builds fast and ugly to learn, then discards the code (a spike is always this kind). **Evolutionary** prototyping builds to production quality from the start and *grows* the same code into the product (walking skeletons, tracer bullets).

The danger is **ambiguity** — code written "to explore" with a quiet hope it survives. Decide which kind you're doing up front; that decision sets the quality bar.

---

## Q7. What are tracer bullets, and how do they differ from a spike?

Tracer bullets (Hunt & Thomas, *The Pragmatic Programmer*) are a **thin, real, end-to-end slice** through every layer of the system that you build first to "see where your shots land," then thicken. Critically, Hunt & Thomas are explicit that tracer code is **kept** — unlike a prototype.

**So:** spike = throwaway code for *one question*; tracer bullet = kept code proving *the layers connect*. Confusing them means either over-engineering a spike or under-building a skeleton.

---

## Q8. What is a walking skeleton?

A walking skeleton (Alistair Cockburn) is a **tiny end-to-end implementation that exercises the whole architecture** — every major component wired together, deployed through the real pipeline, each doing almost nothing yet. It "walks" (runs end-to-end) but has no muscle. You build it to **de-risk integration** before filling in logic, and you **keep and grow** it — it's evolutionary, not a spike.

---

## Q9. Several unknowns in a project — which do you spike first?

The one with the highest **impact-if-wrong × uncertainty** — the assumption that, if false, kills or reshapes the whole plan. You test that *before* building anything around it, so that if it fails, the cost of failure is near zero.

**Trap:** doing the easy/comfortable unknowns first. If the scary unknown turns out impossible, everything built around it is wasted.

---

## Q10. How do you make sure a spike actually answers something?

Frame it as an **acceptance question** with a pass/fail threshold, and design it to **fail loudly**: use realistic (production-scale, adversarial) inputs, and pre-commit to the decision the result triggers. A spike rigged to succeed on the happy path is a demo, not an experiment — it teaches you nothing because it can't disconfirm your belief.

---

## Q11. How is a spike tracked differently from a feature on the board?

A spike is a **research task with a time box, not an estimate**. "Done" = *question answered + writeup/decision*, not *code shipped*. The card should read: "spend ≤ X to answer Q so we can decide D." If you can't fill in Q and D, it isn't ready to be a spike.

**Trap:** "How long will the spike take?" — you don't *estimate* uncertainty, you *cap* it.

---

## Q12. "Plan to throw one away" — is that still good advice?

It's from Fred Brooks's *The Mythical Man-Month*: "plan to throw one away; you will, anyhow." Brooks himself **later partially retracted it**, favoring incremental/iterative development over building a whole throwaway system.

The defensible modern reading is **staged throwaway**: discard *small, early, cheap* experiments (spikes, gate prototypes) — not an entire first product. Citing the retraction signals you understand the principle rather than parroting the slogan.

---

## Q13. A prototype impressed leadership and they want to ship it next week. What do you say?

The prototype proved **viability**, not **readiness**. It has no tests, no error handling, and shortcuts taken to move fast. Shipping it converts deliberate shortcuts into permanent production debt. The right path: treat the prototype as a successful experiment, then build the real thing as a properly-scoped, quality-gated effort informed by what the prototype taught us — never `git merge` the prototype into prod.

This is the **prototype-to-production trap** in its most dangerous form, because the pressure comes from above.

---

## Q14. What's the best possible outcome of a spike?

Often, that it **kills a direction cheaply** — returns "no, this won't work" after a day, saving weeks of doomed work. That's a *win*, not a failure. To capture it, **pre-commit the decision rule** before running ("if p95 > 200ms we drop the synchronous design") so the inconvenient result is acted on without a sunk-cost argument, and so nobody is tempted to rig the spike toward "success."

---

## Q15. How does a spike relate to the scientific method?

A spike *is* the scientific method applied to a build risk: a **hypothesis** ("library X can do Y at acceptable cost"), a **falsifiable experiment** (the smallest code exercising the risky part), an **observation**, and a **conclusion** (a recorded decision). It must be honestly falsifiable — if it can only succeed, it isn't an experiment, it's a demo. See [hypothesis & falsifiability](../01-hypothesis-and-falsifiability/) and [measure before optimize](../03-measure-before-optimize/) for the adjacent disciplines.
