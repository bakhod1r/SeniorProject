# Kata & Deliberate Practice — Interview Questions

> **Category:** [Craftsmanship Disciplines](../README.md) — practice programming on purpose, on safe throwaway problems, the way a musician practices scales.

Conceptual and discussion questions, graded junior → professional, plus scenario, trick, and behavioral questions. This is a discussion-oriented topic — answers favor reasoning over code.

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

### J1. What is a code kata?

**Answer:** A small, well-specified programming exercise you solve repeatedly to practice the *act of programming* — not to ship a product. The term comes from martial-arts practice forms and was introduced to programming by Dave Thomas. The point is the practitioner improving, not the artifact.

### J2. What is deliberate practice?

**Answer:** Anders Ericsson's term for practice that is focused on a specific skill, driven by immediate feedback, pushed just beyond your comfort zone, and repeated with variation — and accompanied by reflection. It's the kind of practice that actually builds expertise, as opposed to mindless repetition.

### J3. Why practice on throwaway problems instead of just at work?

**Answer:** Production work makes you reach for what you already know, punishes mistakes, gives slow feedback, and can't be repeated. A throwaway kata is small, fully specified, safe to fail at, gives instant feedback (tests), and can be repeated with variation — the ideal laboratory for *improving* rather than *producing*.

### J4. Name three famous katas.

**Answer:** FizzBuzz, String Calculator, Bowling Game, Roman Numerals, Gilded Rose, Mars Rover, Conway's Game of Life, Prime Factors, Tennis, Bank Account. (Any three.)

### J5. What's a coding dojo?

**Answer:** A recurring group meeting where people practice a kata together, usually with a projector and a shared keyboard. The two main formats are *prepared* (one person performs and narrates) and *randori* (the whole group solves one kata, rotating who types).

### J6. How does TDD relate to katas?

**Answer:** Most katas are designed to be done test-first, because the red/green signal provides the instant feedback deliberate practice requires. Practicing a kata is one of the best ways to internalize the red-green-refactor rhythm.

### J7. Why do people do the *same* kata many times?

**Answer:** Repetition lets the mechanical parts (the problem, the syntax) fade so attention is free for the skill being practiced; and varying the approach each time generalizes the skill instead of memorizing one answer.

### J8. After finishing a kata, what should you do?

**Answer:** Retrospect — note what went well and what to try differently next time — and usually throw the code away, since the value is the learning, not the artifact.

---

## Middle Questions

### M1. What's the difference between "playing" and "practicing" with katas?

**Answer:** Playing repeats what you can already do — comfortable, fun, no growth. Practicing deliberately targets a specific weakness just beyond your comfort zone, with feedback and reflection — uncomfortable, and it changes you. Re-solving a kata the way you already know is playing, not deliberate practice.

### M2. Why add artificial constraints to a kata?

**Answer:** A constraint removes your default solution and forces you down an unfamiliar path, recreating the just-past-comfort zone where learning happens. "No `if`" forces you to discover polymorphism; "no mouse" forces keyboard fluency. The same kata under a new constraint is effectively a new exercise for your brain.

### M3. Why only one constraint per session?

**Answer:** So the constraint clearly forces a new path and the feedback is attributable to it. Stacking many constraints causes paralysis and muddies which rule produced which learning.

### M4. Explain the Transformation Priority Premise.

**Answer:** An ordering of code transformations from simplest to most complex (e.g., nil→constant→variable→conditional→loop→recursion). When a test is red, you choose the *lowest-priority transformation* that makes it green. It keeps steps tiny and lets the algorithm emerge from the tests rather than being designed up front — Prime Factors is the classic demonstration.

### M5. Compare prepared kata and randori.

**Answer:** A *prepared kata* has one rehearsed person performing and narrating while others watch — great for teaching a clean technique. A *randori* has the whole group solving one shared kata, rotating the keyboard on a timer — great for spreading habits and surfacing different approaches.

### M6. What are the rotation and "talk on green" rules in a randori?

**Answer:** A driver (types) and navigator (guides) sit at the keyboard; on each timer tick everyone shifts — driver to audience, navigator to driver, an audience member to navigator. The audience stays quiet while the bar is red and discusses only once it's green, so the current step isn't derailed. Always rotate on a green bar.

### M7. How do you pick a kata for a specific skill gap?

**Answer:** Match gap to kata and constraint: TDD rhythm → FizzBuzz/String Calculator; safe refactoring → Gilded Rose with "no behavior change, micro-commits"; domain modeling → Mars Rover/Game of Life; expressing rules as data → Roman Numerals/Bowling. The skill determines both the kata and the constraint.

---

## Senior Questions

### S1. Settle the "10,000 hours" claim.

**Answer:** It's a popular misreading of Ericsson's research. The finding is about the *quality* of deliberate practice, not raw hours — ten thousand hours of mindless reps make a ten-thousand-hour amateur. There's no universal number (10,000 was a rough average for one violin study), and even among elites the *best* did more *and better* deliberate practice. The lever is quality, not quantity.

### S2. What is a "mental representation" and why does it matter for practice?

**Answer:** It's an expert's rich internal model that lets them perceive meaningful patterns where a novice sees raw detail — a chess master sees a few patterns, not 32 pieces; a senior sees "leaky abstraction," not 200 lines. Ericsson's core claim is that deliberate practice works by building and refining these representations. Practice that doesn't engage and stretch them accomplishes little.

### S3. Why is a kata whose answer you already know a *good* design-practice tool?

**Answer:** Once the algorithm is automatic, none of your attention is spent solving it, so all of it is free for the meta-skill — naming, removing conditionals, tiny refactoring steps, Simple Design judgment. The known answer is a feature, not a limitation: it frees the mind for what you're actually training.

### S4. What is a skill plateau and how do you break it?

**Answer:** A plateau is when more of the same practice yields nothing — caused by automating a skill to "good enough" so your brain stops investing effort. Comfort is the signal. Break it by re-introducing productive difficulty: a new constraint, a harder problem, a coach/pair who sees your blind spot, or deliberately slowing down to re-expose sloppiness.

### S5. What is "transfer" and how do you maximize it?

**Answer:** Transfer is whether a skill drilled in a kata actually shows up in production — and it isn't automatic. Maximize it by practicing a *generalizable skill* (not memorizing a problem), in *realistic conditions* (your real editor/language/tests), consciously bridging to work afterward, and spacing repetition. The most transferable practice is building the meta-skills (TDD rhythm, refactoring, naming) that are identical across codebases — and building them as *habits*, which survive deadline stress when conscious choices don't.

### S6. How would you design a personal practice regimen?

**Answer:** Diagnose real weaknesses from real signals (recurring review comments, slow/anxious work), map each weakness to a kata + constraint, cycle focuses across sessions to build breadth without burnout, keep a lightweight practice log, and vary the dimensions (language, constraint, clock, design approach) so the skill generalizes.

---

## Professional Questions

### P1. How do you build a practice culture on a team?

**Answer:** Remove the reasons people don't practice. The two decisive levers are **psychological safety** (so people practice rather than perform) and **protected time** (so practice isn't sacrificed to delivery). Then run it as an *owned, recurring ritual* (fixed slot, rotating facilitator) rather than a campaign, make it social and enjoyable, and defend the time visibly against deadline pressure.

### P2. How should you measure practice growth?

**Answer:** With leading, qualitative signals: the focus skill getting smoother over sessions, a class of review comments declining, engineers reaching for a technique unprompted in real work (true transfer), and self-sustaining dojo energy. Avoid making kata-count, hours, or speed-on-a-known-kata into targets — Goodhart's Law says they'll be gamed and reward the opposite of deliberate practice. The honest gauge is whether the *production* codebase is improving.

### P3. Whose time should practice be on — the employer's or the individual's?

**Answer:** Both. Insisting it's purely the employer's makes it fragile to deadlines; insisting it's purely the individual's (the strict *Clean Coder* line) lets the organization off the hook for capability investment. A healthy culture shares the cost — the team invests some protected time and individuals invest some of their own, like a professional staying current in their field.

### P4. How are katas used for mentoring?

**Answer:** Pairing on a trivial, shared kata makes the invisible parts of craft visible — step size, naming, when to refactor, how to recover from a dead end — which transmit only by observation and narration, not documentation. Let the mentee drive on a *known* problem so their attention is free for the discipline being coached, and have the mentor narrate the *why*.

### P5. What is a coderetreat and the Global Day of Coderetreat?

**Answer:** A coderetreat (Corey Haines et al.) is a full day dedicated to practice: the same kata — almost always Conway's Game of Life — done in ~45-minute sessions, deleting your code and switching pairs after each, adding a new constraint each round. The Global Day of Coderetreat is an annual event (typically November) when these run simultaneously worldwide. Both inject energy, spread the format, and connect teams to the wider community.

### P6. Why does the coderetreat delete the code each round?

**Answer:** To enforce that the value is the *learning*, not the artifact; to remove sunk-cost attachment that would otherwise block experimentation; and to keep every round a fresh deliberate-practice attempt under a new constraint. It's the discipline of "throw the code away" made structural.

---

## Scenario Questions

### SC1. Your team agrees katas are a good idea, but the weekly dojo dies after three sessions. What happened, and what do you do?

**Answer:** Almost always one of: (a) the time wasn't really protected and got eaten by a deadline; (b) nobody owned it, so it depended on one person's enthusiasm; or (c) it felt like graded homework, not a safe space. Fixes: get leadership to make the slot as real as a standing meeting and defend it once, visibly; rotate a named facilitator; lower activation energy (room/kata/repo pre-set); and re-establish psychological safety by modeling being slow and wrong. Make it short, frequent, social, and *recurring* rather than an ambitious occasional event.

### SC2. A junior says, "I write code all day — why would I do toy problems?" How do you respond?

**Answer:** Production isn't practice: at work you reach for what you already know, mistakes are costly, feedback is slow, and you can't repeat anything. That makes work great for *producing* and poor for *improving*. A kata is a safe lab to deliberately try the technique you *don't* have yet, fail cheaply, get instant feedback, and repeat with variation — which is exactly what builds skill. The toy problem is just the dumbbell; the skill (small steps, clean tests, fearless refactoring) is what you're lifting, and it shows up in the real work.

### SC3. You're running a randori and one senior keeps grabbing the keyboard and rewriting everyone's code. What do you do?

**Answer:** Enforce the format: strict timer-based rotation (no extra turns), "navigator states intent, not keystrokes," and "respect the group's current design — disagreements go to the retro, not the keyboard." Privately, frame it as their job in a dojo being to *elevate others' learning*, not to produce the best code. If the design genuinely needs to change, that's a navigator suggestion or a retro topic, not a takeover.

### SC4. Management thinks the dojo is "engineers playing games on company time." How do you justify it?

**Answer:** Frame it as a capability investment with concrete payoffs: faster, safer refactoring; better test design; shared conventions that reduce review churn; faster onboarding (juniors absorb the team's style live); and risk reduction (people practice scary techniques where it's safe, not in production). Tie it to weaknesses you've observed in the production codebase, and point to the qualitative signals of improvement. Acknowledge the cost honestly and keep it modest and recurring so the ROI is visible and the time commitment small.

### SC5. You want to practice refactoring legacy code safely. Design the session.

**Answer:** Use the **Gilded Rose** kata. Constraint: "no behavior change; characterization tests first; commit on every green; never break the build." Steps: read the gnarly code, pin its current behavior with characterization tests (golden master), then refactor in tiny safe steps under green, *then* implement the new requirement the kata adds. The point is practicing the legacy workflow — pin behavior, then change structure — not greenfield design. Re-do it later with "extract until each method does one thing" as the focus.

---

## Trick Questions

### T1. "Practice 10,000 hours and you'll master programming." True?

**Mostly false.** It's a distortion of Ericsson's research. Quality of *deliberate* practice (focused, feedback-rich, stretching) is the finding, not a magic number. Mindless hours plateau quickly; there's no universal hour count.

### T2. Is doing a kata once enough to learn the technique?

**No.** One rep of a new technique is a sighting, not a skill. Fluency requires repetition with variation — the whole point of doing the *same* kata many times, differently.

### T3. Should you always finish the kata?

**No.** A session is measured by whether the *focus skill got smoother*, not by completion. An unfinished session in which you nailed tiny steps beats a finished one done on autopilot. (And in a coderetreat you delete it unfinished by design.)

### T4. Is a randori the same as mob programming?

**Not quite.** They share mechanics (group, shared keyboard, rotation), but a randori rotates strictly on a timer to spread participation in a *learning* setting and uses throwaway katas; mobbing optimizes for *delivering real production work* together. Cousins, not twins.

### T5. Are LeetCode grinding and katas the same thing?

**No.** LeetCode optimizes for *producing a correct/optimal answer once* (interview prep). A kata optimizes for *how you arrive at the solution* and is meant to be repeated with variation to build craft (TDD rhythm, design, refactoring). Different goals, different practice.

### T6. "What gets measured gets managed" — so measure katas-per-week, right?

**No.** That's exactly the Goodhart trap: the moment kata-count is a target it's gamed and rewards activity over learning. Measure practice with qualitative leading signals and watch the *production* codebase, never a practice-side counter.

---

## Behavioral Questions

### B1. Tell me about a deliberate-practice habit that improved your work.

**Sample:** "I kept getting review comments that my commits were too big to review. I started a weekly 25-minute kata — String Calculator, then Gilded Rose — with the single focus 'commit on every green bar.' For a few sessions it felt painfully slow. Within a month, smaller commits had become my default at work, the review comments stopped, and reviews on my PRs got noticeably faster. The kata problem was irrelevant; the habit transferred."

### B2. Describe a time you started a practice ritual on a team.

**Sample:** "I set up a biweekly 90-minute randori dojo, fixed slot, rotating facilitator. The key move wasn't the kata — it was getting our lead to publicly defend the slot the first time a deadline tried to eat it, and making it socially fun rather than homework. The retros surfaced that we all named tests differently, so we picked a convention that flowed straight into the production codebase. Onboarding got faster too, because new hires absorbed our style live in the dojo."

### B3. Tell me about a plateau and how you broke it.

**Sample:** "My TDD had gone stale — I 'knew' it but my steps had crept large again. The plateau signal was that practice felt easy. I broke it by re-doing Prime Factors under the Transformation Priority Premise, forcing the lowest-priority transformation at every red bar, and pairing with someone stricter than me. It re-exposed how often I was leaping ahead. After a few sessions my step size at work shrank again."

### B4. When did you decide *not* to keep practicing something?

**Sample:** "I'd been grinding algorithm katas for months but my actual weakness was design judgment — I over-engineered. Algorithm katas weren't touching that. I switched to design katas (Mars Rover, Bank Account) under a strict Simple Design constraint — 'no abstraction until the third duplication.' That was the practice that actually moved my real weakness. The lesson: diagnose the gap honestly and let it choose the practice, don't just do the katas you enjoy."

---

## Tips for Answering

1. **Lead with the purpose:** practice is about *you* improving, not the artifact — the code is disposable.
2. **Define deliberate practice precisely:** focused, feedback-driven, just past comfort, repeated with variation, reflected on.
3. **Nail the "10,000 hours" correction** — it's quality of deliberate practice, not a magic number. This is the senior signal.
4. **Distinguish practice from production** and from LeetCode-style answer-hunting.
5. **Know the famous katas and what each trains** (Gilded Rose → refactoring, Prime Factors → emergence, Game of Life → coderetreat).
6. **For culture questions, name safety + protected time** and the Goodhart trap on metrics.
7. **Mention transfer** — drilling a skill doesn't automatically move it into production; that's the real goal.

---

[← Professional](professional.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Practice Tasks](tasks.md)
