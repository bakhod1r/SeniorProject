> Interview questions on epistemic humility — known/unknown framing, Dunning–Kruger read correctly, calibration, and the practical art of saying "I don't know." Answers are short and precise; each flags the trap interviewers are probing and a likely follow-up. This is as much a *behavioral* topic as a technical one — interviewers use it to test whether you'll bluff under pressure.

---

## Q1. Explain the known knowns / known unknowns / unknown unknowns framing and why it matters in engineering.

Three categories of knowledge: things you know you know; things you know you *don't* know; and things you don't know that you don't know. It matters because **unknown unknowns cause the worst outages and estimate misses** — you can't test, plan, or budget for a failure you haven't imagined. The framing (popularized by Rumsfeld, rooted in the Johari window) gives you a vocabulary to say "this risk class is invisible, so we need *processes* to surface it," not just better effort.

**Trap:** dismissing it as a political soundbite. Used seriously it's a sharp risk-classification tool.
**Follow-up:** "How do you convert an unknown unknown into a known one?" → exposure: pre-mortems, outsider review, reading one layer down, chaos testing, incident retros.

---

## Q2. How do you turn an unknown unknown into a known unknown?

You can't enumerate invisible gaps, so you run processes that *flush them out*: pre-mortems (imagine the failure, list causes), outsider design review (people outside your bubble don't share your blind spots), reading the layer below where you stopped, fault injection / game days, and blameless incident reviews asking "what did we not know we didn't know?" Each surprise these produce was an unknown unknown a moment earlier.

**Trap:** claiming you can just "think harder" and list them. By definition you can't see them from inside your own head.

---

## Q3. State the Dunning–Kruger effect correctly. What does the meme get wrong?

The meme says "dumb people think they're smart." Wrong. Kruger & Dunning (1999) found that **the skills required to perform a task well are often the same skills required to judge your performance** — so novices lack the meta-knowledge to see how much they're missing. It's *domain-specific* (you can be a novice in one area and expert in another, at once) and applies to *everyone*, including experts entering a new field.

**Trap:** the IQ interpretation. It's about *meta-cognition within a skill*, not general intelligence.
**Follow-up:** "What's the opposite error?" → see Q4.

---

## Q4. What's the expert's characteristic error?

Under-confidence / impostor-ish doubt: the more you genuinely learn, the more gaps become *visible*, so felt confidence can fall even as competence rises. Experts also assume "everyone knows this" and undervalue their own judgment. Both Dunning–Kruger over-confidence and expert under-confidence are **calibration failures** — the cure for both is matching stated confidence to your actual track record.

---

## Q5. Is it ever OK to say "I don't know" in an interview? How?

**Yes — and how you say it is part of the signal.** Don't bluff; interviewers can tell, and a confident wrong answer is worse than honest ignorance. The strong form is: *"I don't know that offhand, but here's how I'd find out / here's my mental model that's adjacent."* That shows honesty, calibration, and a path to the answer — exactly the senior behavior they're hiring for.

**Trap:** flat "I don't know" with no follow-through (looks passive), *or* bluffing (fatal). Pair the admission with a method.

---

## Q6. The "danger zone" — competence in area A leaking into area B. Give an example and the fix.

A strong backend engineer treats a Terraform/infra change as "just config," skips the careful reading they'd give their own domain, and accidentally recreates a database instead of updating it. Real competence in A produced *false* confidence in adjacent B. **Fix:** an explicit rule — competence does not transfer across domain boundaries; re-enter beginner mode (slow down, read, pair, pull in the real expert) when you cross one. At senior level, *say it out loud*: "I'm outside my domain here, let's get a reviewer."

---

## Q7. How does knowing what you don't know change how you estimate?

You replace a confident point estimate with a **range plus explicit assumptions**, and you widen the range in proportion to how much you suspect you *don't* know about the area. "3 days if the queue guarantees ordering — I don't know that yet; if not, 5. Let me spike it and narrow." The width *is* the uncertainty. A spike is paying a known cost to remove a known unknown.

**Trap:** false precision ("exactly 3 days") to sound decisive. That hides the very unknown that will blow the estimate.

---

## Q8. What is calibrated confidence and how do you build it?

Calibration means your stated confidence matches your hit rate: your "80% sure"s come true ~80% of the time. You build it by **keeping a prediction log** — record judgments with a confidence number, then check outcomes. Most engineers learn they're over-confident in unfamiliar domains and under-confident in their core. Tetlock's *Superforecasting* showed calibration, not raw intelligence, separates the best forecasters.

---

## Q9. Why do unknown unknowns dominate the worst incidents?

Because known-hard problems get attention, redundancy, and tests — while the gaps nobody knew about get *none*. Pull any incident set and most root causes are "a thing we didn't know was true" (coupled retries that retried a side effect, a silent provider cap, a hidden second caller, failover looping back), not "we did the known-hard thing badly." That's the case for investing in exposure processes and blast-radius limits.

---

## Q10. What's a pre-mortem and why run one independently-first?

Before a launch, imagine it's months later and the project failed; everyone writes down *why*. The reasons are your hidden risks made visible. You collect them **silently and independently before discussing**, because open brainstorming anchors on the first loud voice and triggers groupthink — suppressing the person who actually spotted the real failure mode. Cluster the stories; the surprising ones were unknown unknowns; assign each an owner.

---

## Q11. How does the Johari window relate to this topic?

It's the older (Luft & Ingham, 1955) framing behind known/unknown. Its four quadrants map your self-knowledge against others' knowledge of you. The key engineering insight is the **"blind" quadrant — what others see that you can't** — which is precisely why code review, pairing, and *outsider* design review surface gaps you cannot find alone. Scaled to a team, it's "what another team sees that yours can't."

---

## Q12. As a senior, how do you make "I don't know" safe on your team?

You **model it**: the most senior person saying "I don't know — let's find out" and "I was wrong" sets the ceiling for everyone's honesty. You **reward the messenger** who flags a risk (even one that delays a launch), run **blameless retros** (blame turns unknown unknowns into secrets), and add a mandatory **"What we don't know / Risks"** section to design docs. The goal is to make calibration, not bravado, the prestige signal. (Edmondson's psychological safety research is the backing.)

---

## Q13. A teammate is loudly, confidently wrong in a design review, outside their expertise. How do you handle it?

Address the *claim*, not the person, and make verification the norm rather than a confrontation: "Interesting — I'm not sure that holds; what are we assuming about X? Can we check?" This reframes it as collective gap-finding (the danger-zone leak is common and not shameful) and keeps the room safe for *everyone* to admit uncertainty. Quietly pulling in the actual domain expert often resolves it without anyone losing face.

---

## Q14. Feynman said "the first principle is that you must not fool yourself." How does that apply here?

It's the whole topic in one line (from his 1974 Caltech address): the easiest person to fool is yourself, so the discipline is actively seeking *disconfirmation* — looking for evidence you're wrong, verifying instead of assuming, and treating early confidence as a flag rather than proof. Knowing what you don't know is institutionalized self-distrust, applied with rigor.

---

## Q15. How would you decide how much unknown-unknown hunting a decision deserves?

By **reversibility and blast radius.** Reversible (Type 2) decisions should be made fast and cheaply — you'll learn by doing, so over-investigating wastes time. Irreversible / high-blast-radius (Type 1) decisions deserve heavy hunting: pre-mortems, red teams, outsider review, before you commit. Misclassifying a cheap decision as expensive wastes effort; misclassifying an expensive one as cheap causes your worst, unrecoverable mistakes.

---

## See also

- [Knowing what you don't know — senior](./senior.md) · [professional](./professional.md)
- [Debugging your own reasoning](../02-debugging-your-own-reasoning/) · [Probabilistic thinking](../../06-probabilistic-thinking/)
- [Cognitive biases in code decisions](../../04-critical-thinking/03-cognitive-biases-in-code-decisions/)
- [Section root](../) · [Engineering Thinking](../../README.md)
