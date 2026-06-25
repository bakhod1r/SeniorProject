# Rebuilding Solutions from Scratch — Interview Q&A

> A focused question set on re-deriving solutions from first principles and the rewrite-vs-refactor decision. Interviewers use this topic to find out whether you can resist the seductive "let's rewrite it" instinct, reason quantitatively about complexity, and lead a migration without betting the company. The answers below are deliberately short and defensible, with the traps and follow-ups an experienced interviewer will press on.

---

## Section A — Concepts (Q1–Q5)

**Q1. What does "rebuilding a solution from scratch" mean as a first-principles technique, and how is it different from rewriting?**

A: It means re-deriving a solution from the problem's fundamentals — its essential inputs, outputs, and invariants — instead of inheriting the existing design. Crucially, you usually do this *on paper, as a thought experiment*: the sketch reveals how far the real code has drifted from a clean derivation. That's **rebuild-as-analysis**, and it's cheap. *Rewriting* is **rebuild-as-delivery** — actually replacing the working system — and it's expensive and usually wrong. The whole skill is harvesting the analysis while resisting the delivery.

> Trap: candidates who treat "rebuild from scratch" as a synonym for "rewrite." The entire value is that you can get the insight without the rewrite.

---

**Q2. Explain essential vs. accidental complexity. Who coined the terms?**

A: Fred Brooks, in **"No Silver Bullet" (1986)**. *Essential* complexity is inherent to the problem — tax law is hard, so a tax engine is hard, and no tool removes that. *Accidental* complexity comes from how we built it: boilerplate, dead workarounds, needless indirection. A from-scratch re-derivation is a way to *measure* the accidental portion — it's whatever the clean version removes. Brooks's deeper point: essential complexity dominates, so tools and rewrites that only attack accidental complexity yield far less than people hope.

> Follow-up: "If most complexity is essential, what does that imply about rewrites?" → A rewrite re-pays the cost of all the essential complexity (and re-introduces its bugs) to delete the accidental minority. The arithmetic usually favors refactoring.

---

**Q3. What is Chesterton's Fence and how does it apply here?**

A: Chesterton's parable: don't remove a fence until you understand why it was put there. In code, the "fence" is the line, column, or component your clean design omits but that exists for a non-obvious reason — a fix for a specific customer, a regulatory edge case, a race condition. The re-derivation tells you what *could* go; Chesterton's Fence forbids removing it until you've found out why it's actually there. The dangerous fences are the ones with no remaining institutional memory.

> Trap: "if no one knows why it's there, it's safe to delete." Exactly backwards — absence of a known reason is absence of evidence, not evidence the fence is useless.

---

**Q4. Walk through the "if we built this today" test on a real example.**

A: Take a hand-rolled `key=value` config parser. The fundamental need is "text file → typed map," which is a solved problem (e.g., `tomllib` in Python's stdlib). The clean version is three lines. The parser is 14. The 11-line gap is accidental complexity — a fossil of when the team had no built-in format. But before swapping it: check for fences (a BOM-stripping line, the legacy file format hundreds of files still use). The test revealed the accidental complexity; it didn't grant permission to delete.

> Follow-up: "So do you replace it?" → Maybe not — if 400 production files use the old format, the legacy parser is now load-bearing. The right move is often: keep it, add tests, and support the new format going forward.

---

**Q5. What is the Second-System Effect and why is it relevant to rebuilding?**

A: Also Brooks (*The Mythical Man-Month*, 1975): the second system a designer builds is the most dangerous because they finally indulge every feature they had to omit from the first, producing bloat. A from-scratch rebuild *is* a second system — it tends to sprout plugin systems, rule engines, and "while we're at it" features no current requirement needs. The corrective is to constrain the rebuild to *exactly the current essentials*. The bloat is just new accidental complexity born in the rebuild.

---

## Section B — The rewrite-vs-refactor decision (Q6–Q10)

**Q6. A teammate says "this module is a mess, we should rewrite it from scratch." How do you respond?**

A: First, agree to re-derive it from scratch — *as analysis*. That captures the clarity they want for the cost of a few days. Then measure: what fraction is accidental complexity the clean design removes, vs. essential complexity it reproduces? If the essential model is sound and the cruft is removable incrementally, refactor in place (strangler-fig). If the *model itself* is wrong or a hard new requirement is architecturally impossible, replacement may be justified — still incrementally. "It's a mess" is a feeling; the measured split is a decision.

> Trap: agreeing to the rewrite to keep the peace. The cost asymmetry (days vs. quarters) makes that irresponsible without analysis.

---

**Q7. Summarize Joel Spolsky's "Things You Should Never Do" and say whether you agree.**

A: Spolsky (2000) argued rewriting from scratch is "the single worst strategic mistake," using Netscape, which rewrote their browser for v6 and shipped nothing for ~3 years while IE took the market. His key insight: old code is *ugly but tested* — it contains years of bug fixes, each of which took weeks to find, and a rewrite throws all that knowledge away and re-derives it (re-introducing the bugs). I largely agree *for delivery*. But the essay is sometimes over-read as "never re-think the design." The right reading: re-derive freely as analysis, almost never rewrite as delivery — and when you must replace, do it incrementally, not big-bang.

> Follow-up: "When is Spolsky wrong?" → When the essential model is genuinely wrong (built single-tenant, business is now multi-tenant), or the platform is dead with no incremental path. Even then the answer is strangler-fig, not big-bang.

---

**Q8. Give a concrete rubric: refactor in place vs. replace.**

A:
- **Refactor** when the essential model is correct, the system still meets core requirements, the cruft is removable, and you have tests/observability to change safely.
- **Replace** when the *essential model* is wrong, a hard new requirement is architecturally impossible, or the platform is dead/unowned/untestable with no incremental path.
- Even in the replace column, prefer **strangler-fig** over big-bang. Big-bang is justified only for a small, fully-understood, frozen system with comprehensive tests — a rare cell.

> Trap: forgetting that "unmaintainable, no tests, no one understands it" is often an *ownership* problem. Invest in characterization tests and ownership first; the rewrite case frequently collapses into a refactor case.

---

**Q9. What is the strangler-fig pattern and why is it the default for replacement?**

A: Named by Martin Fowler after the vine that grows around a tree and gradually replaces it. You put a facade in front of the old system, then migrate one slice at a time behind it — often running old and new in parallel (shadow traffic) and comparing outputs — until the old system is dead code. It's the default because at every step the blast radius is one slice and every step is reversible. Big-bang has the opposite properties: blast radius is everything, reversibility is none, and (per Spolsky) value lands only at the very end.

> Follow-up: "What do output divergences during shadow comparison tell you?" → Each divergence is either a bug in the new code or an undocumented Chesterton's Fence in the old — both are exactly what you want to find before cutover.

---

**Q10. If you re-derive a system and decide *not* to rewrite it, was the exercise wasted?**

A: No — that's the most common and most valuable outcome. The re-derivation produces a *classified diff*: which complexity is essential (now confirmed and worth isolating), which is accidental (a ranked refactor backlog), and which lines are load-bearing fences (now documented). You ship a handful of high-leverage targeted fixes and you understand the system. The clean rewrite was never the point; the understanding was.

---

## Section C — Scenarios & scale (Q11–Q13)

**Q11. You're staff/principal. A team proposes a two-year rewrite of a core billing system. What do you ask for?**

A: A written from-scratch derivation with a *measured* essential/accidental split, and the migration's slices. If the essential complexity dominates (it usually does for billing — tax, dunning, regulation), a rewrite re-builds and re-debugs all of it to remove a minority of cruft that a strangler-fig removes incrementally. I'd also require kill-criteria up front (when do we stop?), risk-first slice sequencing (hardest/most-uncertain slice early), and a parity-first gate to block Second-System scope creep. If they can't produce slices, they have a hope, not a plan.

---

**Q12. How do you sequence slices in a strangler-fig migration, and why not easiest-first?**

A: Sequence to *retire risk and prove uncertainty early* — usually the hardest or most-doubtful slice first. Easiest-first shows fake progress but defers the moment of truth; if the new model is wrong you want to learn that in month two, not month twenty. Netscape's failure was partly that value landed only at the very end. Easy slices are fine as warm-up to build the facade and the shadow-compare harness, but the schedule should be driven by risk reduction.

---

**Q13. How do you tell genuine "essential model is wrong" from "we just don't like the code"?**

A: Test it against a concrete requirement the current model *cannot* satisfy without violating an invariant or rebuilding the data model — e.g., the schema is single-tenant and the business now needs hard multi-tenant isolation. If the new requirement merely needs cleanup and the data model still holds, it's "we don't like the code" → refactor. If satisfying it requires a different core model, it's "the model is wrong" → consider replacement (still incrementally). Disliking the code is a refactor signal; an architecturally impossible requirement is a replacement signal.

> Trap: dressing up aesthetic distaste as an architectural impossibility. Make them name the specific requirement the current model can't meet.

---

### Related
- Build the judgment — [Senior](./senior.md) · [Professional](./professional.md)
- Practice it — [Tasks](./tasks.md)
- Upstream — [Reasoning from fundamentals](../01-reasoning-from-fundamentals/) · [Questioning assumptions](../02-questioning-assumptions/)
- Where it lands — [Refactoring](../../../code-craft/refactoring/)
