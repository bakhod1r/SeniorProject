# Pair & Mob Programming — Interview Questions

> **Category:** [Craftsmanship Disciplines](../README.md) — two or more people building one piece of software together, in real time, sharing one stream of work.

Conceptual, scenario, trick, and behavioral questions, graded junior → professional. This is a process/practice topic, so the questions are about *discussion and judgement*, not coding drills.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Scenario Questions](#scenario-questions)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What is pair programming?

**Answer:** Two engineers working on one task, at one screen, at the same time — one typing (the **driver**), one guiding (the **navigator**) — swapping roles regularly. The work is one continuous, conversational stream rather than two people coding alone and merging later.

### J2. What's the difference between the driver and the navigator?

**Answer:** The **driver** is at the keyboard handling tactics — syntax, the next few lines. The **navigator** isn't typing and handles strategy — direction, design, edge cases, "is this the right approach?" Both are doing real work; the navigator is not "just watching."

### J3. What is mob (ensemble) programming?

**Answer:** The whole team (3+) working on one task at one screen, with one driver at a time and everyone else navigating, and the keyboard rotating on a short timer. It's pairing scaled to the whole team.

### J4. What does "typing is the cheap part" mean?

**Answer:** The expensive parts of programming are thinking, designing, reviewing, and spreading knowledge — not keystrokes. So the navigator (who does those things) is doing as much real work as the driver. Pairing puts review and knowledge-sharing into the moment of writing instead of bolting them on later.

### J5. Name three benefits of pairing.

**Answer:** Fewer defects (continuous review catches bugs as they're written), automatic knowledge sharing (no single point of failure), and faster onboarding (new hires learn by doing with an expert). Also: better design and shared ownership.

### J6. Name two costs of pairing.

**Answer:** It's mentally tiring (sustained focus plus constant conversation), and it *feels* like "two people on one task" (lower per-person typing throughput).

### J7. Why should the driver and navigator talk constantly?

**Answer:** Pairing's value comes from the conversation — the navigator's strategic input and the driver's narration. A silent pair is just one person coding while another stares, which has none of the review or knowledge-sharing benefit.

### J8. What does "rotate roles" mean and why do it?

**Answer:** Swap who's driving regularly. If one person drives for an hour, the other disengages and the knowledge/skill stops spreading. Rotation keeps everyone active and ensures the benefits reach everyone.

### J9. What is the watch-the-master anti-pattern?

**Answer:** One expert drives the entire time while the other passively watches and learns little. Fix: rotate, and have the *less* experienced person drive *more*.

### J10. What is backseat driving?

**Answer:** When the navigator dictates literal keystrokes ("type a semicolon now") instead of intentions ("let's handle the empty case first"), reducing the driver to a passive typist. Speak at the level of intent.

---

## Middle Questions

### M1. Describe ping-pong pairing.

**Answer:** A TDD-based style: A writes a failing test, B makes it pass and writes the next failing test, A makes that pass, and so on, refactoring together on green. The red-green cycle becomes the rotation trigger, so swapping is automatic and participation stays balanced — each person both specifies and implements.

### M2. State the strong-style pairing rule and explain its purpose.

**Answer:** "For an idea to go from your head into the computer, it must go through someone else's hands." The navigator has the ideas; the driver has the keyboard. It maximizes knowledge transfer (the expert must verbalize their reasoning) and stops watch-the-master (the expert literally can't just take over). It's the engine behind mobbing.

### M3. Why are mob rotation timers so short (4–10 minutes)?

**Answer:** Short rotations keep everyone alert, stop any one person from "owning" a chunk of the work, and keep the context in shared team awareness rather than one head. New mobbers always think it's too short; the discomfort fades.

### M4. When would you choose solo over pairing?

**Answer:** Trivial/mechanical work (boilerplate, renames, config) with no design or knowledge value to share, and exploratory spikes where you're learning by trial and error — often faster alone, then share the findings.

### M5. When would you choose to mob rather than pair?

**Answer:** When the whole team needs to understand the work — architectural decisions, gnarly legacy nobody understands, a critical migration, or onboarding several people at once. Mobbing eliminates handoffs, merge conflicts, and knowledge silos for that work.

### M6. Why is a generic video-call screen share a bad remote-pairing tool?

**Answer:** It's too laggy (the navigator's view/input arrives too late) and usually single-control (one person types, others watch — watch-the-master). Purpose-built tools (Live Share, Code With Me, Tuple) give low latency and dual control.

### M7. Why rotate *partners*, not just roles?

**Answer:** Always pairing the same two people rebuilds a two-person knowledge silo. Rotating partners across the team spreads knowledge to everyone — which is the main payoff of pairing.

### M8. How do you keep a lopsided pair balanced?

**Answer:** Use ping-pong (forces both to specify and implement), deliberately ask the quieter person "what do you think?", and have the less experienced person drive more. A timer enforces role swaps if they forget.

### M9. What tooling supports remote mobbing specifically?

**Answer:** `mob.sh` or Mobster — they manage both the rotation timer and the git handoff (`mob start` / `mob next` / `mob done`), so the branch passes cleanly between machines like a physical keyboard.

### M10. How do pairing and TDD reinforce each other?

**Answer:** TDD gives pairing a structure and rotation trigger (ping-pong on the red-green cycle); pairing gives TDD a second mind at the hard moments (choosing the next test, deciding "simplest thing that passes"). Together the feedback loop shrinks to seconds — automated test feedback plus human review feedback.

---

## Senior Questions

### S1. What did the Williams & Kessler research find, and what are its limits?

**Answer:** The canonical finding is roughly **~15% more effort for ~15% fewer defects**, plus better designs and higher enjoyment. The big caveats: it was largely a *student* study, so generalization to seasoned professionals isn't proven; and later meta-analyses (Hannay et al., 2009) found the effect depends heavily on **task complexity** and **programmer expertise** — pairs achieve higher *quality* on complex tasks but mainly buy *speed at extra effort* on simple ones. Cite Williams for the origin, Hannay for the nuance.

### S2. Answer the "two people, one task = 2× cost" objection.

**Answer:** It's not 2× for 1×. A pair finishes in ~15% more *person-hours* but *less calendar time* (ships sooner), and catches defects in the editor (~1× cost) instead of production (~100×+ plus incident/rollback/trust). It also eliminates bus-factor risk and folds onboarding/knowledge-transfer costs into the work. Net win on complex/critical/siloed tasks; net loss on trivial ones — so match modality to task.

### S3. What is the bus factor, and how do pairing and mobbing affect it?

**Answer:** The bus factor is the number of people who'd have to disappear before the project is in serious trouble — i.e., how concentrated the irreplaceable knowledge is. A bus factor of 1 is a latent outage. Solo work pushes it toward 1; pairing (with partner rotation) raises it; mobbing drives it toward the whole team. This is often the *strongest* business case for pairing, because docs can't reliably capture tacit knowledge.

### S4. Does pairing destroy flow?

**Answer:** It changes the *kind* of flow. Solo flow is deep, private, and fragile (a Slack ping shatters it); pairing flow is conversational and *robust* (a pair is hard to interrupt; if one drifts, the other holds the thread). Pairing can genuinely disrupt deep *solitary* exploration for some people on some tasks — that's real, not a flaw. So: pair the collaborative work, leave deep solitary exploration solo.

### S5. Can introverts pair effectively?

**Answer:** Yes — the idea that pairing is "for extroverts" confuses social energy with pairing skill. Introverts often pair excellently given *structure* (strong-style, ping-pong, clear roles) and *recovery time*. The real constraint is fatigue, not personality; sustainable pairing is partial-day with solo recovery time around it.

### S6. What are the limits of scaling a mob?

**Answer:** Beyond ~5–6 people the marginal navigator adds little and the back row checks out — split into two mobs or drop to pairs. Mobbing's economic case is *specific* (hard/central problems, high cost of error, knowledge that must spread, establishing a shared standard), not general; on routine parallelizable work it's wasteful. It wins by eliminating coordination cost (no merges, PR latency, or blocking questions).

### S7. When does pairing genuinely fail (not just "done badly")?

**Answer:** Trivial/mechanical work (no value to share), solitary deep exploration, severe personality clash with no rotation escape, use as a surveillance tool (kills safety), and teams lacking the basic skills/conventions pairing amplifies. The unifying rule: pairing's costs are fixed but its benefits are conditional on design complexity, defect risk, or knowledge value — when none are present, solo wins.

### S8. Why is the wrong metric dangerous when evaluating pairing?

**Answer:** Individual-throughput metrics (lines of code, velocity per head, commits per author) structurally penalize one shared stream and make pairing "look bad" even as quality and risk improve. You must measure *outcomes* — escaped defects, onboarding time, bus factor, rework — and ignore per-person throughput proxies.

---

## Professional Questions

### P1. How would you roll pairing out to a resistant team?

**Answer:** Incrementally, not by mandate. Start with volunteers on high-value tasks (never boilerplate), explicitly teach the styles and etiquette (most bad pairing is *untaught*), set rotation/break norms from day one, tune via retros, and expand by demonstrated value — pull, not push. Avoid both extremes: mandating everything (burnout) and leaving it fully optional forever (defaults back to silos).

### P2. What would you measure to prove pairing is working?

**Answer:** Outcome metrics: defect escape rate, onboarding time to first meaningful contribution, bus factor / knowledge coverage, rework rate, and time spent in code review. Refuse vanity metrics (LoC, per-person velocity, commits/keystrokes per author). Pair quantitative signal with qualitative (retro sentiment), since much of the value is tacit knowledge.

### P3. Why is psychological safety the foundation of pairing?

**Answer:** Pairing converts private work into public work — every gap, wrong turn, and "I don't know" is now visible. That visibility *is* the benefit, but it collapses without safety: a developer who feels judged goes silent, and a silent pair loses the review and knowledge transfer that justify it. Build it by having seniors model fallibility, critiquing code not people, and *never* letting pairing data feed performance reviews.

### P4. How do you run a pairing interview?

**Answer:** Collaboratively, not as an exam. Pick a small, realistic problem in the candidate's language; actually pair (drive and navigate, offer hints, take their ideas); reduce stress (it's fine to look things up). Evaluate communication, giving/taking feedback, reasoning aloud, and handling being wrong — essentially "would I want to pair with this person daily?" It's a better signal than whiteboarding because it mirrors the real job.

### P5. A manager says pairing is "seniors babysitting juniors." Respond.

**Answer:** Strong-style pairing with a junior isn't babysitting — it's compressed mentorship that permanently raises the junior's *independent* output, and it transfers tacit knowledge no doc captures. The alternative is the junior learning slowly, shipping bugs, and getting reviewed late. It's a high-leverage investment, not a tax.

### P6. What conventions does remote-first pairing need that co-located pairing doesn't?

**Answer:** Low-latency *dual-control* tooling (not generic screen share), explicit location narration (no pointing), verbalizing state ("I'm lost"/"I'm following"), tool-based or verbal handoffs, *scheduled* breaks (remote pairs over-fatigue), cameras-on for social cues, and async handoffs with written context across time zones. Default to both people being able to drive every session.

### P7. How do you keep pairing sustainable over the long term?

**Answer:** Make it partial-day — a few focused hours with solo/async time around it for recovery and the trivial tasks that don't warrant a pair. Schedule breaks, rotate partners, respect personality and consent, and treat pairing like sprinting: valuable in bursts, destructive as a permanent all-day state.

### P8. How does pairing function as onboarding infrastructure?

**Answer:** Pair the new hire from day one, strong-style with *them* driving, rotating which expert they pair with. They learn the codebase by doing, with context and landmines narrated live; their "naive" questions surface stale docs and accidental complexity. It collapses the slow read-docs-get-blocked-ship-a-bug ramp into a guided, defect-resistant one — the fastest-to-show pairing ROI.

---

## Scenario Questions

### SC1. A billing system is understood by exactly one engineer, who just gave notice. What do you do?

**Answer:** Mob (or run rotating pairs) on the next billing changes with the departing expert *navigating* and others *driving*, so their tacit knowledge transfers into the team's hands as a side effect of real work — far more reliably than a doc dump. Within the notice period the bus factor goes from 1 toward the whole team. Frame it to management as urgent risk reduction.

### SC2. Your team mobs all day and people are visibly drained by 3pm. What's wrong and how do you fix it?

**Answer:** No (or too few) breaks, and possibly too-long sessions — mobbing is high-intensity and unsustainable without recovery. Add scheduled breaks, shorten rotations if they've drifted long, consider partial-day mobbing with solo time, and rotate the facilitator role. Fatigue, not the practice itself, is the failure.

### SC3. A senior dev refuses to pair, saying it kills their flow. How do you handle it?

**Answer:** Don't force all-day pairing — the objection is partly legitimate (deep solitary flow is real). Reserve their pairing for the hard, collaborative problems where two minds clearly help, and leave deep exploratory work solo. Protect their recovery time. Often they convert once pairing is targeted rather than blanket.

### SC4. During a mob, two people are dominating and two haven't spoken in twenty minutes. What do you do?

**Answer:** This is unequal participation. As facilitator, actively invite the quiet voices ("we haven't heard your read — what do you think?"), enforce the rotation so everyone drives, and make sure ideas flow through the *current* driver (strong-style) rather than the loudest person grabbing control. Check that psychological safety isn't the underlying issue.

### SC5. Management wants to use pairing-session recordings/data to evaluate individual performance. Your response?

**Answer:** Refuse firmly. The instant pairing is used for surveillance or individual evaluation, people stop asking questions and start performing competence — and every benefit (continuous review, knowledge transfer, safety) evaporates. Pairing data must be firewalled from performance reviews; this is non-negotiable for the practice to survive.

### SC6. A new hire is paired with a senior, but the senior drives the whole time and the new hire just watches. What's happening and what's the fix?

**Answer:** Classic watch-the-master — the new hire is learning far less than they could. Fix: switch to strong-style with the *new hire driving* and the senior navigating, so the senior's reasoning is verbalized and the new hire's hands and brain stay engaged. Enforce role rotation if needed.

---

## Trick Questions

### T1. "Pairing means you get half the output for the same cost." True?

**Mostly false.** It's ~15% more *person-hours*, not 2×, and finishes in *less* calendar time. More importantly, "output" measured as typing volume is the wrong measure — defects prevented (at ~1× instead of ~100×), rework avoided, and bus-factor risk eliminated are the real returns, and on complex/critical/siloed work they outweigh the extra effort.

### T2. Does mobbing waste most of the team's time, since N people work on one task?

**Not necessarily — it depends on the task.** On hard/central/high-stakes/knowledge-critical work, mobbing eliminates coordination cost (merges, PR latency, blocking questions, silos) and makes the decision once, correctly. On routine parallelizable work it *is* wasteful. The skill is using it for the former, not the latter.

### T3. Is pairing only for extroverts?

**No.** That confuses social energy with pairing skill. Introverts pair excellently given structure (strong-style, clear roles) and recovery time. The real constraint is *fatigue*, addressed by partial-day pairing — not personality.

### T4. "The research proves pairing produces better code." Accurate?

**Overstated.** The foundational study (Williams & Kessler) was largely with *students*; meta-analysis (Hannay 2009) shows the effect is real but *conditional* on task complexity and expertise — higher quality on complex tasks, mostly speed-for-effort on simple ones. Say "evidence-supported, especially for complex tasks and knowledge spread," not "proven universally better."

### T5. If we pair, do we still need code review?

**It changes, it doesn't vanish.** Paired code is *continuously* reviewed as written, so much of what async PR review catches is already handled — review round-trips drop. But you may still want a lightweight async check (a fresh outside perspective, compliance/security gates, or audit trail). Mobbed code is effectively whole-team-reviewed already.

### T6. Backseat driving and navigating are the same thing, right?

**No — opposite quality.** Navigating passes *intentions* ("let's validate the email first") and lets the driver choose the how. Backseat driving dictates *keystrokes* ("type i-f space"), reducing the driver to a typist who's stopped thinking. The skill is operating at the highest level of abstraction the driver can act on.

---

## Behavioral Questions

### B1. Tell me about a time pairing improved an outcome.

**Sample:** "We had a payment-flow bug that two previous solo attempts had reintroduced. We paired on it strong-style; the navigator spotted a race condition the driver was about to recreate, *as it was being typed*. We fixed it in one session, added a test, and it never came back. The bug had been escaping to production repeatedly because no one was reviewing the critical lines as they were written."

### B2. Describe a time pairing went badly. What did you learn?

**Sample:** "Early on, a senior and I paired and they drove the whole time while I watched — I learned almost nothing and felt useless. I learned that was *watch-the-master*, and now when I pair with someone junior I put *them* on the keyboard and navigate strong-style. The person who knows less should drive more."

### B3. How do you handle a teammate who insists pairing is a waste of time?

**Sample:** "I'd agree it *can* be — on trivial work it's pure cost. Then I'd reframe: pairing pays on complex, risky, or siloed work, where it catches defects early and spreads knowledge. I'd propose we pair *selectively* on exactly that kind of task and look at the outcomes — escaped defects, onboarding speed — rather than mandating it everywhere. I care about matching the tool to the task, not about pairing for its own sake."

### B4. How do you make someone new feel safe in a pairing or mob session?

**Sample:** "I model not-knowing out loud — 'I'm not sure how this API works, let's look it up' — so it's clearly safe for them to do the same. I critique the code, never the person, treat every question as legitimate, and in a mob I actively invite the quiet voices. Safety is the thing the whole practice rests on; if they're afraid to be wrong, they'll go silent and we lose everything pairing is for."

### B5. When did you decide *not* to pair on something?

**Sample:** "A teammate and I were about to pair on a batch of mechanical renames and config edits. I called it — there was no design decision and no knowledge to share, so pairing would just be two of us watching one person do find-and-replace. We split up, did it solo, and used the time we saved to pair on the actual hard part of the feature."

---

## Tips for Answering

1. **Always anchor on the premise:** typing is cheap; thinking, reviewing, designing, and spreading knowledge are expensive — pairing front-loads all of them.
2. **Name the roles precisely:** driver = tactics, navigator = strategy; intentions flow navigator→driver, not keystrokes.
3. **Know the evidence honestly:** "~15% more effort, ~15% fewer defects" *plus* the student-study and task-complexity caveats (Hannay 2009).
4. **Reframe the cost objection** with the defect-cost-escalation and bus-factor arguments, not faith.
5. **Match modality to task:** solo for trivial/exploratory, pair for complex/critical/siloed, mob for hard/team-wide.
6. **Lead culture answers with psychological safety** — and "pairing data never feeds reviews."
7. **Acknowledge the real costs** (fatigue, flow, personality) — a balanced answer signals seniority more than evangelism.

---

[← Professional](professional.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Kata & Deliberate Practice](../07-kata-and-deliberate-practice/junior.md)
