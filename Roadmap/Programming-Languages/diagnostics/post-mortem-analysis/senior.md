# Post-Mortem Analysis — Senior Level

> **Topic:** [Post-Mortem Analysis Roadmap](README.md)
> **Focus:** The "root cause" critique. Systems thinking — Swiss cheese, STAMP, the New View of human error. Action-item follow-through that survives a quarter. Measuring whether your post-mortems are any good. Building the organizational learning loop. Deep forensic methodology for incidents *and* core dumps that defeat the obvious read.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [The "Root Cause" Critique](#the-root-cause-critique)
8. [Systems Thinking: Swiss Cheese, STAMP, the New View](#systems-thinking-swiss-cheese-stamp-the-new-view)
9. [Counterfactual Reasoning and Hindsight Bias](#counterfactual-reasoning-and-hindsight-bias)
10. [The Investigation Beneath the Investigation](#the-investigation-beneath-the-investigation)
11. [Forensics That Defeat the Obvious Read](#forensics-that-defeat-the-obvious-read)
12. [Action-Item Follow-Through as a System](#action-item-follow-through-as-a-system)
13. [Measuring Post-Mortem Quality](#measuring-post-mortem-quality)
14. [Building the Organizational Learning Loop](#building-the-organizational-learning-loop)
15. [Facilitating the Hard Review](#facilitating-the-hard-review)
16. [Code & Command Examples](#code--command-examples)
17. [A Worked Senior Post-Mortem](#a-worked-senior-post-mortem)
18. [Public Incident Stories, Read Like a Senior](#public-incident-stories-read-like-a-senior)
19. [Pros & Cons](#pros--cons)
20. [Use Cases](#use-cases)
21. [Coding Patterns](#coding-patterns)
22. [Clean Code](#clean-code)
23. [Best Practices](#best-practices)
24. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
25. [Common Mistakes](#common-mistakes)
26. [Tricky Points](#tricky-points)
27. [Test Yourself](#test-yourself)
28. [Tricky Questions](#tricky-questions)
29. [Cheat Sheet](#cheat-sheet)
30. [Summary](#summary)
31. [What You Can Build](#what-you-can-build)
32. [Further Reading](#further-reading)
33. [Related Topics](#related-topics)
34. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **Stop hunting for *the* root cause. Start understanding why your system — technical and human — produced this outcome and would produce it again. Then prove the org actually learned.**

At middle level you learned to run a review, write the document, separate trigger from contributing factors, and walk a dump frame by frame. You can produce a post-mortem that names four contributing factors and four ticketed action items, and you can read a heap dump's dominator tree. That is the competent practitioner's floor.

The senior jump is uncomfortable, because it requires giving up two things that feel like rigor:

1. **The single root cause.** You will stop writing "the root cause was X." Not because you got soft, but because the concept is *epistemically broken* for socio-technical systems, and senior incident analysts in aviation, medicine, and SRE abandoned it decades ago. You will replace it with a model of *how the system normally works and why that same normal produced a bad outcome this time*.
2. **The investigation as the deliverable.** A junior thinks the post-mortem ends when the doc is final. A senior knows the doc is the cheap part. The expensive, valuable part is the **learning loop**: do the action items land, does the *class* of failure recur, does the org's mental model of itself actually update? You become responsible for that loop, and for *measuring* it.

On the forensic side, you move past "walk every frame" to the cases where the obvious read is a *trap*: corrupted stacks, optimized-away frames, dumps from the wrong build, a heap dump whose biggest object is a red herring, a goroutine dump where the stuck set is a *symptom* of a leak three layers up. Senior forensics is knowing when the dump is *lying to you* and how to cross-examine it.

> 🎓 **Why this matters for a senior:** Your title means the org trusts your judgment about *why things break and how to make them break less*. That judgment is worth nothing if it terminates in "human error" or "the root cause was a bad config." The senior's contribution to a post-mortem is rarely the timeline — junior on-call can build that. It's the *reframe*: turning "Priya pushed a bad config" into "our config-deploy path has no validation, no canary, and a 0→100% blast radius, and it would have failed for anyone." That reframe is what changes the system instead of the person.

---

## Prerequisites

What you must already own cold:

- **Required:** All of [`junior.md`](junior.md) and [`middle.md`](middle.md) — blameless culture, timelines, 5 Whys, contributing factors, SEV levels, forensic reconstruction from logs/traces, the full core/heap/thread-dump walkthrough.
- **Required:** Senior debugging — production observation without stopping the world, distributed tracing, heap/goroutine dumps at scale, the premise audit. See [`../debugging/senior.md`](../debugging/senior.md).
- **Required:** You have *facilitated* at least one real incident review, not just attended.
- **Required:** You can read a flame graph, a dominator tree, and a goroutine dump without a reference.
- **Helpful:** Exposure to safety-critical fields' literature — Sidney Dekker, Nancy Leveson, Richard Cook, the CAIB (Columbia) and other public investigations.
- **Helpful:** You've owned an SLO and watched an error budget get spent by incidents.
- **Helpful:** Some authority — you can actually change the review process, not just complain about it.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Root cause (RC)** | The supposed single deepest cause of a failure. Senior position: a useful triage word, a dangerous *conclusion*. |
| **RCA** | Root Cause Analysis — the family of single-cause methods (5 Whys, Ishikawa/fishbone, fault tree). Useful, limited; critiqued here. |
| **Contributing factor** | A condition that made the outcome more likely or worse. The honest unit of analysis. |
| **Swiss cheese model** | Reason's model: defenses are slices with holes; an accident occurs when holes line up. |
| **STAMP / CAST** | Leveson's Systems-Theoretic Accident Model and Processes; CAST is its accident-analysis method. Treats safety as a *control* problem, not a chain of failures. |
| **Old View / New View** | Old View: human error is a *cause* to be eliminated. New View (Dekker): human error is a *symptom* of trouble deeper in the system. |
| **Counterfactual** | A "should have / could have" statement about what someone might have done differently. Hindsight poison; flagged here. |
| **Hindsight bias** | The tendency, knowing the outcome, to see the path to it as obvious and the operators as negligent. |
| **Local rationality** | The principle that people's actions made sense *given what they knew at the time*. The analyst's job is to reconstruct that "made sense." |
| **Latent condition** | A dormant weakness (bad default, missing alert, fragile design) that sits harmlessly until a trigger activates it. |
| **Proximate vs distal cause** | Proximate: nearest in time to the outcome. Distal: further back (a design decision, an org incentive). |
| **Drift into failure** | Dekker: systems slowly, locally-rationally adapt toward the boundary of safety until they cross it. |
| **Near-miss** | An event that *could* have been an incident but wasn't, by luck or a defense that held. The cheapest learning. |
| **Action item (AI)** | A SMART, owned, dated, tracked change. The post-mortem's only durable output. |
| **COE / IC review** | Correction-of-Errors (Amazon) / incident-commander review — formal org rituals around post-mortems. |
| **Learning loop** | The end-to-end cycle: incident → analysis → action → verification that the *class* of failure is closed. |
| **Just Culture** | A culture that holds people accountable for *choices* (recklessness) but not for *system-induced error*. |
| **MTTR / MTTD / MTBF** | Mean time to recover / detect / between failures. Useful aggregates; gameable in isolation. |

---

## Core Concepts

### 1. "Root cause" is a stopping rule, not a discovery

The phrase "root cause" does not name a thing in the world. It names *the point at which you decided to stop asking why*. Two competent analysts will stop at different depths and call different things "the root cause" of the same outage. That should bother you. The senior treats RCA methods as *generative* (they surface candidate factors) but never *conclusive* (they don't license "and therefore X is THE cause"). The output is a *set of conditions and an understanding of the system*, not a single named villain.

### 2. The system produced the outcome — including the humans in it

In a socio-technical system, the operators, the on-call, the reviewer who approved the PR, are *part of the system under analysis*, not an external fault injected into it. "Human error" is never an explanation; it is the *thing to be explained*. Every time you write "engineer X did Y," the senior question is: **what about the system made Y the locally rational thing to do?** Bad tooling, missing guardrails, normalized deviance, a UI that invites the mistake — that is the actual finding.

### 3. Local rationality: nobody comes to work to cause an outage

Sidney Dekker's central move: when someone did something that, in hindsight, looks insane, your job is not to judge it but to **reconstruct the world as it looked to them at that moment** — their data, their pressures, their goals, their normal. From the inside, their action almost always made sense. If it didn't, you've found a training/tooling gap, which is *still* a system finding. The post-mortem that explains *why it made sense at the time* is the one that prevents recurrence.

### 4. Counterfactuals are hindsight in disguise

"The on-call *should have* checked the dashboard." "They *could have* rolled back sooner." These feel like analysis; they are *moral judgments smuggled in past tense*, and they explain nothing — they describe a world that didn't happen. The senior strikes every "should have / could have" from a draft and replaces it with "here is what they actually saw, and why the dashboard wasn't where they looked." (Section: [Counterfactual Reasoning](#counterfactual-reasoning-and-hindsight-bias).)

### 5. The artifact is judged by the loop, not the prose

A gorgeous, thorough, blameless post-mortem with zero landed action items and a recurrence three months later **taught the org nothing**. A scrappy two-paragraph write-up whose single action item permanently killed a class of bug **taught the org everything**. Senior responsibility shifts from "write the doc well" to "make the *loop* close" — and to *measure* whether it closes. (Sections: [Action-Item Follow-Through](#action-item-follow-through-as-a-system), [Measuring Post-Mortem Quality](#measuring-post-mortem-quality).)

### 6. A dump can lie; cross-examine it

At middle level a dump is a "frozen crime scene." At senior level you know crime scenes can be *staged*: a corrupted stack from a smashed frame pointer, a `<optimized out>` where the bad value lived, line numbers that lie under inlining, a heap dump whose dominator is correct but *not the leak*, a goroutine dump whose stuck set is downstream of the real culprit. The senior reads a dump *adversarially*, with a hypothesis, cross-checking against build IDs, the binary, the logs, and a second dump.

### 7. Near-misses are the cheapest tuition the org will ever get

Every system that has incidents has 10–100× as many near-misses — the deploy that *would* have stampeded but happened at 3 a.m. with no traffic, the bad config caught by one engineer's gut. These cost *nothing* (no customer impact) yet carry the same lessons. An org that only does post-mortems for customer-visible SEVs is throwing away its cheapest data. Senior practice: a lightweight near-miss review channel.

---

## Real-World Analogies

| Concept | Analogy |
|---|---|
| Root-cause critique | Asking "what's the *one* cause of a forest fire" — the spark, the drought, the fuel load, the wind, the absent firebreak all had to align. |
| Swiss cheese model | Stacked slices of cheese; light passes only when every hole lines up. Add a slice (a defense) and the beam is blocked. |
| STAMP / control view | A thermostat that failed isn't a "broken part" story — it's a *control loop* whose feedback, model, or actuator broke. |
| Local rationality | A driver who ran a red — until you learn the light was sun-blinded, the previous light trained "go," and the brakes had lag. |
| Counterfactual trap | A sports commentator after the loss: "he *should have* passed" — narrating a game that wasn't played. |
| Hindsight bias | Reading a thriller's ending, then insisting the clues were "obvious all along." |
| Drift into failure | A frog in slowly heating water — every step locally fine, the aggregate fatal. |
| Near-miss | A surgeon's "we nearly gave the wrong dose" — same lesson as the actual harm, none of the harm. |
| Learning loop | Physiotherapy after surgery — the operation is nothing if you don't do the rehab that makes the change stick. |
| A lying dump | A photo of a "clean" room where someone shoved the mess into a closet just out of frame. |

---

## Mental Models

### Model 1: The cause is a *cut* you choose, so choose it honestly

Picture the causal graph of an incident: hundreds of nodes (events, conditions, decisions) with edges of influence stretching back years. "Root cause" is a *cut* across this graph — a line where you declare "everything upstream of here we'll treat as fixed background." That cut is a *choice driven by what you can change and what's worth changing*. The senior makes the cut **explicitly and defends it**: "we're treating the upstream library's API as fixed and focusing on our missing validation, because that's the changeable, high-leverage layer." A single-root-cause write-up makes this cut *invisibly and badly*, then pretends it was discovered.

### Model 2: Defenses, not causes (Swiss cheese inverted)

Stop asking "what caused this?" and ask "**which defenses were supposed to stop this, and why did each fail to?**" Reframing from causes to *defenses-that-didn't-hold* mechanically generates action items, because every failed defense is a thing to add or strengthen. The TTL outage from middle level, re-read this way: the canary defense was *absent*, the coalescing defense was *absent*, the pool-saturation alert was *absent*, the circuit breaker was *absent*. Four missing slices — four action items. No "root cause" needed.

### Model 3: The two-loop system

Every incident feeds *two* loops. The **inner loop** is fast: detect → mitigate → recover (minutes to hours), measured by MTTR. The **outer loop** is slow: analyze → change the system → verify the class is closed (days to a quarter), measured by *recurrence* and *action-item completion*. Juniors live entirely in the inner loop ("we recovered!"). Seniors are accountable for the **outer loop**, which is where the org actually gets safer. Most teams' outer loop is broken and nobody is measuring it.

### Model 4: The dump has a thesis you must falsify

Don't open a dump and "look around." Open it with a **hypothesis** ("I think the leak is the request cache") and try to *falsify* it. The frozen state can confirm or kill the hypothesis fast — but only if you came with one. Aimless dump-reading on a multi-GB heap is how a senior burns three hours. Hypothesis-driven dump-reading is how they burn ten minutes.

---

## The "Root Cause" Critique

This is the conceptual spine of senior incident analysis. Internalize it and your post-mortems change permanently.

### Why "root cause" is broken for our systems

RCA was forged for *linear, mechanical* failures: a bearing wore out, a weld cracked, a valve stuck. For those, "the root cause was metal fatigue" is genuinely useful — there *is* a single broken component, replace it, done. Software incidents are almost never like that. They are **emergent properties of interactions** between components that each worked as designed. There is no broken bearing; there is a *combination* that nobody designed and nobody tested.

Three concrete failure modes of the single-root-cause habit:

| Failure mode | What it looks like | What it costs you |
|---|---|---|
| **Premature stop** | 5 Whys stops at "the config was wrong" because someone got tired. | You fix the one config, miss the missing validation/canary/alert; it recurs differently. |
| **Cause = blame** | "Root cause: engineer pushed bad config." | You "fixed" it by talking to a person; the system that let *anyone* do it is untouched. |
| **False singularity** | Picking one of four necessary factors and calling it "the" cause. | Three other latent conditions remain armed for the next trigger. |

### The 5 Whys, honestly assessed

5 Whys is a *fine brainstorming primer* and a *terrible terminating method*. Its flaws:

- **It's a chain, but reality is a graph.** "Why?" assumes one parent per node. Real incidents have many parents per node — multiple independent conditions converging.
- **The path depends on who's asking.** Ask five teams to 5-Whys the same outage and you get five different "roots," each ending conveniently outside the asker's own area.
- **It invites stopping at the human.** "Why did it break? Because Sam deployed it." The chain *terminates at a person*, which is exactly the Old View trap.

Senior fix: run 5 Whys *per branch* (a fishbone/Ishikawa is 5 Whys forked into categories), and **never let a branch terminate on a person — push through to the system condition that made the person's action rational.**

```text
   5 WHYS (chain — what juniors run)          ISHIKAWA / FISHBONE (graph — what seniors run)

   outage                                        People        Process       Tooling
     └ why? cache stampede                          \             |            /
         └ why? all entries expired at once          \           |           /
             └ why? long TTL + bulk invalidate        ───────► OUTAGE ◄───────
                 └ why? "the TTL change"  ← STOP      /           |           \
                   (one convenient root)            Design     Observability  Defaults
                                                   (no coalesce)(no pool alert)(0→100% rollout)
```

### What replaces "root cause"

Not nothing — something *more* rigorous:

1. **A set of contributing conditions**, each with a defense that could have caught it.
2. **A reconstruction of why the system normally works** and why this time the normal produced harm (drift).
3. **An explicit cut**: "we are treating these upstream things as fixed; here is the changeable layer we're acting on, and why."

The deliverable is *understanding of the system*, expressed as defenses to add — not a name to blame.

> **The test (sharpened from middle level):** Take your "root cause." Ask: *"If only this one thing had been different, and everything else identical, would there have been no incident?"* If the honest answer is "no, it also needed the missing canary / the absent alert / the no-coalescing design," then you do not have a root cause. You have **one of several necessary conditions**, and you must list them all.

---

## Systems Thinking: Swiss Cheese, STAMP, the New View

Three frameworks, increasing in power and cost. You don't need all three for every incident; you need to *know which to reach for*.

### Reason's Swiss Cheese Model — the everyday workhorse

James Reason's model: an org's defenses are a stack of slices (code review, tests, canary, alerts, runbooks, on-call). Each slice has holes — latent weaknesses. An accident happens only when **the holes momentarily line up** so a hazard passes through every slice. Two implications a senior leans on:

- **You rarely close the hole that was hit; you add a slice or shrink several holes.** Defense in depth means the next incident's holes are *unlikely* to line up.
- **Active failures (the trigger) vs latent conditions (the holes).** The trigger gets the attention; the latent conditions are where the durable fixes live. The TTL deploy was the active failure; the four missing defenses were latent conditions that had been there for months.

```text
   hazard ──►│ ● │   │   │ ● │   │   │   ← code review (hole: TTL interaction not modeled)
            │   │ ● │   │   │ ● │   │   ← automated tests (hole: no stampede test)
            │   │   │ ● │   │   │ ● │   ← canary (hole: DOESN'T EXIST → full-width hole)
            │ ● │   │   │ ● │   │   │   ← alerting (hole: no pool-saturation alert)
                          ▼
                  the holes lined up → OUTAGE
   Fix: don't just patch one hole — add the missing canary slice (closes a whole column).
```

### STAMP / CAST — when the chain model isn't enough

Nancy Leveson's **STAMP** (Systems-Theoretic Accident Model and Processes) rejects the chain-of-events idea entirely for complex systems. Its claim: **accidents are not failures, they are inadequate control.** Safety is a *control problem* — every part of the system is a controller with a *model* of what it's controlling, issuing *control actions*, receiving *feedback*. Accidents happen when a controller's model diverges from reality and it issues an unsafe control action.

Re-read an incident as control failures:

| Controller | Its (flawed) model of reality | Unsafe control action | Missing feedback |
|---|---|---|---|
| Deploy system | "TTL change is low-risk, like any config" | Rolled 0→100% with no gate | No canary signal fed back before full rollout |
| Retry client | "Pricing is up; just retry" | Retried with no jitter/breaker | No signal that retries were *causing* the saturation |
| On-call human | "It's a pricing slowdown" | Investigated pricing, not the deploy | Deploy timeline not surfaced on the alert |

STAMP is *more work* than Swiss cheese, and you reach for it on the gnarly ones — incidents that span teams, where "what caused it" has no satisfying answer because **no single thing failed**; the *interactions* and *control structure* were unsafe. Its analysis method is **CAST** (Causal Analysis based on System Theory): model the control structure, find each controller's flawed process model and missing feedback, and fix the *control loops*, not the components.

> **When to escalate from Swiss cheese to STAMP:** if your post-mortem keeps wanting to say "but nothing actually *broke* — every component did what it was built to do, and yet…" — that's the signal. Chain models can't explain emergent failure; control models can.

### Dekker's New View — human error is a symptom

Sidney Dekker's *Field Guide to Understanding 'Human Error'* reframes the whole human side:

| Old View | New View |
|---|---|
| Human error is a **cause** of trouble. | Human error is a **symptom** of trouble *deeper in the system*. |
| To improve, **remove** the unreliable humans (discipline, replace, retrain). | To improve, **understand why their actions made sense** and fix the system that shaped them. |
| Find *who* was responsible. | Find *what* was responsible — and how the system set people up. |
| Errors are random, individual. | Errors are systematic, connected to tools, tasks, and pressures. |

The senior consequence: **"human error" appearing in a post-mortem is a sign the analysis isn't finished.** It's the *question*, not the answer. Keep going until you've explained the system that produced that "error."

---

## Counterfactual Reasoning and Hindsight Bias

The single most common quality defect in mid-level post-mortems, and the one a senior reviewer ruthlessly removes.

### The mechanism

Once you know the outcome, your brain *cannot un-know it*. It reverse-engineers a clean path from action to disaster and concludes the operators were standing right next to the alarm bell ignoring it. This is **hindsight bias**, and it's automatic and invisible. It produces **counterfactuals**: statements about what someone *should have / could have / failed to* do — narrating a world that did not occur.

### Why counterfactuals are worthless as analysis

A counterfactual describes the *absence* of the accident, not its *presence*. "She should have rolled back at 14:14" tells you nothing about *why, at 14:14, rolling back was not the obvious move* — which is the only thing that can prevent recurrence. The counterfactual *feels* like a finding because it's emotionally satisfying (it locates fault), but it's analytically empty.

### The rewrite drill

Every "should have / could have / failed to / did not" gets rewritten into "here is what they *actually* perceived, knew, and were trying to do, and why that led here":

| Hindsight-poisoned (delete) | Local-rationality rewrite (keep) |
|---|---|
| "On-call *should have* noticed the deploy in the timeline." | "The alert linked to the latency dashboard, which has no deploy markers. The deploy log is a separate tool nobody had open. The on-call investigated where the alert pointed them." |
| "They *could have* rolled back sooner." | "Rollback wasn't considered until 14:15 because the symptom (pricing latency) pointed at pricing, not at the checkout deploy. The causal link wasn't visible until the trace was opened." |
| "The reviewer *failed to* catch the TTL interaction." | "The PR changed one constant. Nothing in review surfaces cross-service cache-invalidation interactions; no reviewer in the org would have caught this without a model we don't have." |

Notice each rewrite *converts a blame into an action item* (add deploy markers to the alert dashboard; surface deploys on the trace; build interaction-modeling into review). **Counterfactuals dead-end; local-rationality rewrites generate fixes.** That's the whole argument.

> **Senior reviewer move:** do a `Ctrl-F` for "should have", "could have", "failed to", "didn't bother", "neglected to" in any post-mortem draft. Every hit is a hindsight smell. Make the author rewrite it into "what they saw and why it made sense." This single edit pass is the highest-leverage thing a senior does to a draft.

---

## The Investigation Beneath the Investigation

A senior runs *two* investigations at once and never confuses them:

1. **The incident investigation** — what happened in the world (timeline, factors, dump).
2. **The meta-investigation** — *what does this incident reveal about our investigation and prevention capability itself?*

The second is the senior's unique contribution. Examples of meta-findings that matter more than the incident itself:

- **Detection gap.** "We recovered in 6 minutes" hides "a customer told us first; our own alerting was silent for 4 of those minutes." The detection capability is the finding, not the outage.
- **Evidence gap.** "We couldn't determine X because logs had rotated / the pod restarted before the dump / sampling dropped the trace." The *inability to investigate* is itself a high-priority action item — you were blind, and you'll be blind again.
- **Knowledge concentration.** "Only Priya knew the mitigation command." The hero is a *bus-factor finding*, not a happy ending. Runbook it; spread it.
- **Recurrence.** "This is the third stampede-class incident this year." The individual post-mortems are irrelevant; the *pattern* is the finding, and it points at a missing platform capability (a coalescing primitive everyone should get for free).

> The most valuable sentence in many senior post-mortems is not about the incident at all. It's: *"We could not answer question Q because we lacked instrument I — and that blindness is action item AI-N."* You are post-morteming your *ability to post-mortem*.

---

## Forensics That Defeat the Obvious Read

Middle level: walk every frame, match the dump to the symptom. Senior level: the cases where the obvious read is *wrong* and the dump itself is *adversarial*.

### Case 1: The corrupted stack (frame pointer smashed)

A buffer overflow can overwrite the saved frame pointer/return address, so `gdb`'s unwinder produces garbage: `#5  0x4141414141414141 in ?? ()` (that's `"AAAA..."` — a classic overflow signature). The naive read ("crash in `??`") is useless. The senior reads it as **a tell**:

```bash
$ gdb ./svc ./core
(gdb) bt
#0  0x00007f... in ?? ()
#1  0x4141414141414141 in ?? ()    ← 0x41 = 'A'; the stack was overwritten
(gdb) x/32gx $rsp                   # examine raw stack words
0x7ffd...: 0x4141414141414141 0x4141414141414141   ← smashed
(gdb) p $rip                        # instruction pointer — also clobbered?
# If RIP is a non-mapped address, control flow was hijacked / corrupted.
(gdb) info proc mappings            # is $rip even in an executable region?
```

The lesson: a `??`-filled backtrace with repeating byte patterns is **not "no information"** — it's strong evidence of a *memory-safety* bug (overflow, use-after-free, type confusion), which redirects the whole investigation toward ASan/Valgrind and away from logic bugs. See [`../debugging/senior.md`](../debugging/senior.md) for sanitizers.

### Case 2: `<optimized out>` ate the value you need

Release builds elide locals into registers that get reused; `gdb` prints `<optimized out>`. The bad value is *gone*. Senior tactics, in order of preference:

```bash
(gdb) info registers rax rbx rdi rsi    # the value may still be in a register
(gdb) frame 2
(gdb) info scope billing.c:118          # where the compiler said vars live
(gdb) p $rdi                            # arg often in rdi (System V x86-64 ABI)
# If truly gone: rebuild the SAME COMMIT with -O0 -g, reproduce, re-dump.
# Critical: verify build-id matches the binary that produced the core:
$ readelf -n ./svc | grep -i build-id   # NT_GNU_BUILD_ID
$ eu-unstrip -n --core=./core           # build-ids of every mapped object in the core
# If the core's build-id != your binary's, you are reading the WRONG SYMBOLS.
```

> **The most expensive senior forensics mistake:** symbolicating a core dump with a binary from a *different build*. The frames will *look* plausible and be *completely wrong* — line 118 in your local build is a different statement than line 118 in the deployed build. Always match `build-id` (ELF), the `dSYM` UUID (macOS: `dwarfdump --uuid`), or the JVM/`.hprof` provenance before trusting a single frame.

### Case 3: The heap dump's biggest object is a red herring

MAT's Leak Suspects points at a 700MB `byte[]`. Obvious read: "that array is the leak." Often wrong. The senior asks **retained vs shallow** *and* **who dominates whom**:

- A 700MB `byte[]` might be a *legitimately large, short-lived* buffer (an in-flight upload) that the dump caught mid-flight. Not a leak.
- The *real* leak is frequently **many small objects** — 12 million `CacheEntry` instances of 80 bytes each — whose *dominator* is a single innocent-looking `HashMap` field. Sort by **retained heap of the dominator tree**, not by the single biggest object.

```text
# Eclipse MAT, OQL — find the real retainer, not the biggest object:
SELECT x, x.@retainedHeapSize
FROM INSTANCEOF java.util.HashMap x
ORDER BY x.@retainedHeapSize DESC

# jmap histogram first — is it ONE big object or MANY small ones?
$ jmap -histo:live <pid> | head -20
#  num   #instances  #bytes  class name
#    1:   12,000,300  960M    com.svc.CacheEntry   ← 12M small objects = the leak
#    2:           1   700M    byte[]               ← one big buffer = red herring
```

### Case 4: The goroutine dump's stuck set is a *symptom*, not the cause

47,000 goroutines blocked on `chan receive` (from the middle-level example). The naive fix: "add a timeout to that channel." The senior asks **who was supposed to send, and why did they stop?** The stuck consumers are *downstream of the real failure* — a producer that crashed, a channel never closed, an upstream service that died. Fixing the symptom (timeout) is right *and insufficient*; the action item must reach the producer's death.

```bash
# Don't just count the stuck set — find the MISSING set (who should be sending).
$ curl -s 'localhost:6060/debug/pprof/goroutine?debug=2' > gs.txt
# The 47k stuck on 'chan receive' is obvious. Now look for what's ABSENT:
$ grep -c 'notify.(\*Consumer).run' gs.txt
0     # ← the consumer goroutine is GONE. THAT is the cause; the 47k are victims.
# Cross-check the consumer's death in logs:
#   {service="notify"} |= "panic" | json   → panic at 01:08, never restarted.
```

### Case 5: Python — the dump that shows a healthy stack but a sick process

`py-spy dump` shows every thread sitting in innocuous-looking code, yet the process is wedged. Senior reads: the GIL holder might be in *C extension code* `py-spy` can't see into, or the process is blocked on a syscall. Cross-examine at the OS layer:

```bash
$ sudo py-spy dump --pid 12345          # Python-level: looks fine
$ cat /proc/12345/stack                 # kernel stack of the thread (if accessible)
$ cat /proc/12345/wchan                 # what kernel function it's sleeping in
$ sudo strace -p 12345 -f -e trace=futex,read 2>&1 | head   # blocked on a futex/read?
# futex(...) = ... hanging → a lock held by a thread py-spy showed as "idle" in C code.
```

### The senior forensic posture, summarized

| The dump says | The naive read | The senior cross-examines with |
|---|---|---|
| `?? ()` with `0x4141…` | "no information" | "memory-safety bug" → ASan/Valgrind |
| `<optimized out>` | "value lost, give up" | registers, `info scope`, rebuild same commit at `-O0` |
| Big `byte[]` dominates | "that's the leak" | histogram: one big vs many small; retained-heap of dominator |
| 47k stuck goroutines | "add a timeout" | who *should* be sending — the absent producer |
| Healthy Python stacks | "no bug here" | `/proc/PID/wchan`, `strace`, C-extension / GIL / syscall block |
| Clean frames, wrong build-id | trusts the line numbers | `readelf -n` / `eu-unstrip` / `dwarfdump --uuid` first |

---

## Action-Item Follow-Through as a System

Middle level taught SMART + ticket + owner + two-week review. Senior level treats follow-through as a **system to be engineered and measured**, because the default state of action items is *decay*, and willpower doesn't fix systemic decay.

### Why action items rot (the real reasons)

| Decay mechanism | Why it happens | Systemic fix |
|---|---|---|
| **No tracker integration** | The AI lives only in the doc; sprint planning never sees it. | AI auto-creates a ticket in the *same* backlog as feature work, tagged `incident-followup`. |
| **No owning team's skin** | Owned by "SRE" generically; nobody's OKRs include it. | Owner is a *named person on a team whose roadmap absorbs it*; the team lead signs off. |
| **Prioritization invisibility** | Prevent-work always loses to feature-work, silently. | A *budget*: e.g. X% of each team's sprint reserved for incident follow-up, defended by leadership. |
| **No verification of closure** | Ticket marked "done" = code merged, not *class closed*. | Closure requires *proof the class can't recur* (a test, an alert, a guardrail), not just a diff. |
| **Conscious vs silent drop** | Some AIs *should* be dropped (cheaper to accept the risk). | Dropping is fine — *if explicit and recorded*. Silent decay is the enemy; conscious reprioritization is healthy. |

### Classify every action item (and check the balance)

A healthy post-mortem produces a *balanced portfolio*, not five "prevent" items:

| Class | Question it answers | Example | Failure mode if missing |
|---|---|---|---|
| **Prevent** | Stop the cause from happening. | Add request coalescing to pricing fetch. | You'll hit the same trigger. |
| **Detect** | Catch it faster next time. | Alert on pool saturation > 80% for 5m. | MTTD stays bad; a customer tells you first again. |
| **Mitigate** | Recover faster when it does happen. | Canary + one-click rollback. | MTTR stays bad even if detection improves. |
| **Repair the investigation** | Be *able* to analyze next time. | Persist dumps to a path the pod restart won't wipe. | You go blind in the next incident. |

> A set that's *all prevent* usually has a hidden detection or mitigation gap nobody's filling. A set with a **repair-the-investigation** item is the signature of a senior who noticed they were partly blind this time.

### The follow-through ritual that actually works

1. **Weekly or bi-weekly action-item review**, separate from the incident reviews, owned by a single accountable person (incident-program owner / SRE lead).
2. **A dashboard, not a memory.** Pull all open `incident-followup` tickets org-wide; age them; flag any open past its due date. (See [What You Can Build](#what-you-can-build).)
3. **Aging policy.** An AI open 2× past its due date gets *escalated to the owner's manager* — not as punishment, but to force the explicit decision: do it, re-scope it, or *consciously* drop it with a recorded reason.
4. **Recurrence as the real metric.** The only proof an AI worked is that the *class* of incident stopped recurring. Track incidents by *cause class*, and watch whether a class goes quiet after its AIs land.

---

## Measuring Post-Mortem Quality

You cannot improve what you don't measure, and "we write good post-mortems" is not measurable. The senior brings *metrics* to the post-mortem process itself — carefully, because every one of these is gameable.

### Process metrics (necessary, gameable, weak)

| Metric | What it tells you | How it's gamed / its blind spot |
|---|---|---|
| **% of SEV-1/2 with a completed post-mortem** | Is the ritual happening at all? | SEV deflation: downgrade to dodge the requirement. |
| **Time from incident to published post-mortem** | Is learning fresh or stale? | Rushed, shallow docs published fast to hit the SLA. |
| **Action-item completion rate** | Does the loop close? | Closing tickets without closing the *class*; trivial AIs to pad the rate. |
| **Action-item aging** (median days open) | Is follow-through real? | Bulk-closing stale items as "won't do" to clean the metric. |

### Outcome metrics (what actually matters)

| Metric | What it tells you | Why it's the real signal |
|---|---|---|
| **Recurrence rate per cause class** | Are we *learning* or *repeating*? | The point of post-mortems is to stop recurrence. This is the only metric that can't be faked by paperwork. |
| **MTTD trend** | Is detection improving? | Detection AIs should bend this down over quarters. |
| **MTTR trend** | Is recovery improving? | Mitigation AIs should bend this down. |
| **Near-miss reporting rate** | Is the culture safe enough to surface non-incidents? | A *rising* near-miss rate is usually *good* — it means people feel safe reporting (blameless culture working). |

> **The counterintuitive one:** a *rising* near-miss report count is a health signal, not a problem signal. It means the org is surfacing the cheap lessons before they become expensive ones. A *zero* near-miss rate means either a perfect system (no) or a culture where people don't report (yes).

### A rubric for grading a post-mortem document

When you review others' post-mortems (a senior duty), grade against this, not against prose quality:

```text
□ Impact quantified (users/requests/%/$/duration), not "some users"
□ Timeline built from EVIDENCE (links to logs/traces/deploys), not memory
□ Trigger separated from contributing factors; ≥1 latent condition named
□ ZERO counterfactuals ("should have"/"could have") — local rationality used instead
□ ZERO termination on a person; every human action traced to a system condition
□ Each failed defense → an action item (defenses-not-causes framing)
□ Action items: SMART, owned by a named person, dated, TICKETED, classified
□ Balance check: not all "prevent" — has detect AND mitigate items
□ A "repair the investigation" item if anything was un-investigable
□ Detection gap surfaced if a human/customer detected before alerting did
□ "Where we got lucky" filled in honestly
□ Funnel shape: wide evidence → few sharp committed changes
```

A post-mortem that passes this rubric and *fails* on prose is fine. One with beautiful prose that fails the rubric is theater.

---

## Building the Organizational Learning Loop

The senior's endgame: the team/org learns *as a system*, not as a collection of individuals who each happened to read a doc.

### From per-incident to cross-incident learning

One post-mortem teaches one lesson. The leverage is in the **aggregate**:

- **Tag every post-mortem by cause class** (cache-stampede, retry-storm, config-blast-radius, capacity, dependency-failure, deploy-coordination…). After 30 incidents, the *distribution* tells you where to invest a *platform* fix that prevents a whole class for everyone.
- **Quarterly incident retrospective**: not "what happened in incident X" but "what do our last 20 incidents have in common?" This is where you discover that *eight* outages share "no canary on config changes" — and you fund a config-canary platform, killing eight future incidents with one project. That insight is *invisible* at the per-incident level.

### The artifacts of a learning org

| Artifact | Purpose | Senior owns |
|---|---|---|
| **Searchable post-mortem archive** | A future engineer finds the prior incident before repeating it. | Indexing, tagging by cause class, making it grep-able. |
| **Cause-class taxonomy** | Aggregate analysis; spot patterns. | Defining and curating the taxonomy. |
| **Read-and-discuss ritual** | Spread lessons beyond the affected team (Google's "wheel of misfortune", incident-of-the-month). | Running it. |
| **Near-miss channel** | Capture the cheap lessons. | Lowering the friction to report. |
| **Runbook generation** | Every "Priya knew the command" → a runbook. | Enforcing the AI: hero moment ⇒ runbook. |

### Just Culture: the precondition for all of it

None of this works without psychological safety. If reporting an incident or near-miss can get you punished, **reporting stops**, and you go blind. Just Culture (Reason, Dekker, Marx) draws the line precisely:

- **System-induced error** (the tooling let you, the design invited it): *no individual accountability* — fix the system.
- **At-risk behavior** (a normalized shortcut everyone takes): *coach*, and fix the norm/incentive.
- **Reckless behavior** (conscious disregard of a known, unjustified risk): the *rare* case where individual accountability applies.

The senior's job is to keep the org on the left of that line for the vast majority of incidents, because that's where the truth is *and* where the learning is. "Blameless" doesn't mean "no accountability ever" — it means **accountability for the system, by default, because that's where the leverage is.**

---

## Facilitating the Hard Review

You'll facilitate the reviews that go sideways: a senior leader wants a name, two teams blame each other, the on-call is defensive. Senior facilitation moves:

- **Pre-commit the frame.** Open with: "We're here to understand how our *system* produced this, so it produces it *less*. We will not be assigning individual blame, because that's both unfair and useless — it wouldn't make us safer." Say it even (especially) when a VP is in the room.
- **Redirect blame to system, live.** "Why did *you* push it?" → "Let's ask why our deploy *path* allowed a 0→100% config change with no gate. Anyone in this room would have shipped it the same way." You're not protecting a person; you're getting a *useful* answer.
- **Surface the local rationality out loud.** Ask the operator: "Walk us through what you were seeing at 14:14. What did the dashboard show? What were you trying to do?" This both humanizes and *generates findings* (the dashboard didn't show the deploy).
- **Name the luck.** "We got lucky it was 2 p.m., not peak. At peak this cascades to inventory." Luck is a finding; it sizes the *unfixed* risk.
- **Convert every hindsight statement live.** When someone says "they should have caught it," gently: "Let's reframe — what would have *had* to be true for it to be catchable? That's our action item."
- **End with owned, dated, ticketed AIs on screen** — never adjourn on sentiment.

---

## Code & Command Examples

### Verify you're symbolicating the *right* build before trusting any frame

```bash
# ELF (Linux): does the core's build-id match the binary you're about to use?
readelf -n ./svc | grep -A1 'Build ID'
#   Build ID: 6b6c... 
eu-unstrip -n --core=./core | head    # build-ids of every module mapped in the core
#   0x400000+0x21000  6b6c...  ./svc   ← must match the binary's build-id

# macOS: match the dSYM UUID to the crashing binary
dwarfdump --uuid ./svc.dSYM           # UUID: 1A2B...  (must equal the binary's)
dwarfdump --uuid ./svc

# Go: the build-id is embedded; confirm before dlv core
go tool buildid ./svc
```

### Adversarial core read: a smashed stack

```bash
gdb ./svc ./core
(gdb) bt
#1  0x4141414141414141 in ?? ()        # 'AAAA...' → overflow
(gdb) x/16gx $rsp                      # confirm the overwrite pattern
(gdb) p/x $rip                         # is control flow hijacked?
(gdb) info proc mappings               # is $rip even executable?
# Conclusion: memory-safety bug. Switch tools:
#   recompile with -fsanitize=address, reproduce under ASan.
```

### Find the real heap retainer, not the biggest object (JVM)

```bash
# Step 1: one big object or many small? (cheap, no MAT)
jmap -histo:live <pid> | head -15

# Step 2: capture and analyze in MAT, sorting by RETAINED, not shallow
jcmd <pid> GC.heap_dump /var/dumps/heap.hprof
# In MAT: Dominator Tree view → sort by Retained Heap → the true root of the leak.
# Or OQL:
#   SELECT x, x.@retainedHeapSize FROM INSTANCEOF java.util.Map x
#   ORDER BY x.@retainedHeapSize DESC
```

### Find the *absent* goroutine (the cause), not the stuck ones (the symptom)

```bash
curl -s 'localhost:6060/debug/pprof/goroutine?debug=2' > gs.txt
# The 47k stuck on 'chan receive' are obvious. Find who SHOULD be sending:
grep -c 'notify.(\*Consumer).run' gs.txt   # 0 → the producer goroutine died
# Why did it die? Cross to logs:
#   {service="notify"} |= "panic" | json | line_format "{{.ts}} {{.msg}}"
```

### Python: cross-examine a wedged process below the Python layer

```bash
sudo py-spy dump --pid 12345        # Python view (may look healthy)
cat /proc/12345/wchan               # kernel: what's it sleeping in?
sudo strace -p 12345 -f -e trace=futex,read -c   # blocked on a futex? a held lock.
```

### Tag and aggregate post-mortems by cause class (the learning loop in code)

```python
# A tiny indexer: parse front-matter from every post-mortem and report cause-class trends.
import pathlib, collections, datetime, yaml

POSTMORTEMS = pathlib.Path("postmortems")  # each .md starts with YAML front-matter

def load(md: pathlib.Path) -> dict:
    text = md.read_text()
    if not text.startswith("---"):
        return {}
    _, fm, _ = text.split("---", 2)
    return yaml.safe_load(fm)  # expects: sev, date, cause_class, action_items_open

by_class = collections.Counter()
recent_recurrence = collections.defaultdict(list)
cutoff = datetime.date.today() - datetime.timedelta(days=90)

for md in POSTMORTEMS.glob("*.md"):
    meta = load(md)
    cls = meta.get("cause_class", "unclassified")
    by_class[cls] += 1
    d = meta.get("date")
    if isinstance(d, datetime.date) and d >= cutoff:
        recent_recurrence[cls].append(md.name)

print("Cause-class distribution (all time):")
for cls, n in by_class.most_common():
    print(f"  {n:3}  {cls}")

print("\nRecurring in last 90 days (platform-fix candidates):")
for cls, docs in recent_recurrence.items():
    if len(docs) >= 2:   # ≥2 of the same class in a quarter → invest in a class-wide fix
        print(f"  {cls}: {len(docs)}  {docs}")
```

The output of *that* — "config-blast-radius recurred 4 times this quarter" — is the senior insight that funds a platform project, not a per-incident patch.

---

## A Worked Senior Post-Mortem

The *same* checkout-stampede incident from middle level, re-analyzed at senior depth. Notice what changes: no single root cause, the human actions reframed via local rationality, Swiss-cheese defenses, a meta-finding, and a balanced, classified action-item set with a "repair the investigation" item.

```markdown
# Post-Mortem: Checkout cache stampede        SEV-2   2026-05-29
Status: Final   Author: checkout on-call   Reviewers: pricing, SRE, platform
Cause class: cache-stampede + config-blast-radius   (tagged for aggregate analysis)

## Summary
A cache-TTL config change interacted with the periodic catalog-invalidate path to
stampede pricing-service. ~12% of checkout requests failed for ~6 min (14:11–14:18 UTC).
No single component failed: every component did what it was designed to do. The outage
was an *emergent* interaction across four absent defenses. Resolved by rollback. No data loss.

## Impact
14:11–14:18 UTC (6m). 12% of POST /cart/checkout failed (context deadline exceeded).
~1,800 failed checkouts; users could retry successfully after 14:18.

## Detection
Alert "checkout error rate > 5% for 1m" fired at 14:12 (1 min after onset). Good —
*but* the alert pointed at the latency dashboard, which has no deploy markers (see meta-finding).

## Timeline (UTC) — every line backed by an artifact
- 13:58  PR #4412 merged: cache TTL 30s→300s. (GitHub)
- 14:02  checkout v2.317 deployed us-east-1, 0→100%, no canary. (deploy log)
- 14:11  pricing publishes catalog.invalidate; all checkout caches clear at once. (Kafka)
- 14:11:30  pricing p99 → 4.2s; DB pool saturates. (Tempo trace 9f2…)
- 14:12  ALERT fires; on-call acks, opens latency dashboard. (PagerDuty)
- 14:14  on-call investigating pricing (where the symptom pointed), not the deploy.
- 14:15  trace opened → causal link to the deploy visible; rollback decided.
- 14:18  rollback complete; error rate → baseline. (MTTR ≈ 6m, MTTD ≈ 1m)

## How the system produced this (defenses-not-causes)
This was not caused by "the TTL change." It required FOUR defenses to be absent at once
(Swiss cheese — remove any one and there is no incident, or a far smaller one):

| Defense that should have caught it | State | Why it was a full-width hole |
|---|---|---|
| Canary / staged rollout            | ABSENT | Config change went 0→100% with no early signal. |
| Request coalescing (singleflight)  | ABSENT | Simultaneous misses stampeded the origin instead of collapsing. |
| Circuit breaker + jitter on client | ABSENT | A slowdown became a retry storm. |
| Pool-saturation alert              | ABSENT | First signal was the symptom (checkout 500s), not the cause. |

## Human actions, in their own context (local rationality — no counterfactuals)
- The reviewer approved a one-constant change. Nothing in our review process surfaces
  cross-service cache-invalidation interactions; NO reviewer in the org would have caught
  this without a model we don't have. (→ AI-5)
- The on-call investigated pricing, not the deploy, for 3 minutes — because the alert
  linked to a latency dashboard with no deploy markers, and the symptom (pricing latency)
  pointed at pricing. The causal link wasn't visible until the trace was opened. (→ AI-6)
  (We deliberately do NOT say "should have checked the deploy" — there was no signal to.)

## Meta-findings (the investigation beneath the investigation)
- DETECTION-ADJACENT GAP: our fastest path to the cause was a manual trace lookup. The
  deploy timeline is not surfaced on the alert or the latency dashboard. (→ AI-6)
- RECURRENCE: this is the 3rd stampede-class incident in 12 months across teams. The
  per-incident fix (coalescing here) is right but local. The pattern argues for a shared
  coalescing primitive in the platform so no team has to remember it. (→ AI-7, platform)

## Action items (SMART · owned by a named person · dated · ticketed · classified)
| ID | Action | Class | Owner | Due | Ticket |
|----|--------|-------|-------|-----|--------|
| AI-1 | Add singleflight to pricing origin fetch | Prevent | A. Rao (pricing) | 06-12 | PRI-882 |
| AI-2 | Add jitter + circuit breaker to pricing client | Prevent | L. Chen (checkout) | 06-12 | CHK-413 |
| AI-3 | Canary 10/50/100% for checkout config+code deploys | Mitigate | M. Diaz (SRE) | 07-01 | SRE-220 |
| AI-4 | Alert on pricing DB pool > 80% for 5m | Detect | A. Rao (pricing) | 06-05 | PRI-883 |
| AI-5 | Add cache-invalidation interaction checklist to review template | Prevent | L. Chen | 06-20 | CHK-414 |
| AI-6 | Surface deploy markers on latency dashboards + link deploy log from alerts | Detect | M. Diaz | 06-25 | SRE-221 |
| AI-7 | Platform: shared request-coalescing primitive (kills the stampede CLASS) | Prevent | Platform team | 09-01 | PLAT-77 |

Balance check: 4 prevent · 2 detect · 1 mitigate · meta-finding drove AI-6 & AI-7. ✔

## What went well / poorly / lucky
- Well: alert fired in 1 min; mitigation decided <6 min once the trace was opened.
- Poorly: cause-finding relied on a manual trace lookup because the deploy wasn't surfaced.
- Lucky: mid-afternoon, not peak. At peak this likely cascades to inventory. (Sizes AI-3's urgency.)
```

Contrast with the middle-level version of the same incident: the senior write-up *refuses the single trigger as the cause*, **reframes the two human actions via local rationality instead of blame**, adds a **meta-finding about the org's investigation capability**, spots the **cross-incident pattern** that funds a platform fix, and produces a **balanced, classified** AI set. That is the senior delta.

---

## Public Incident Stories, Read Like a Senior

Reading published post-mortems is the cheapest senior training there is. Read them not for the gossip but for the *structure of the failure* and the *quality of the analysis*.

### Knight Capital, 2012 — $440M in 45 minutes (config-blast-radius, dead code)

A deploy left old "Power Peg" code on 1 of 8 servers, reactivated by a *reused feature flag*. Naive read: "a deploy bug." Senior read: **no defense in depth on deploys** (no verification that all 8 servers matched), a **reused flag** (a latent landmine), **no kill switch** sized to the blast radius, and **no automated anomaly halt** as orders ran away. Remove *any one* defense-hole and the loss is a fraction. The "root cause" was not the missed server — it was a deploy *control structure* (STAMP lens) with no feedback that all nodes were consistent and no actuator to stop runaway behavior. Knight didn't survive it.

### AWS S3 outage, 2017 — one command, no blast-radius guard (config-blast-radius)

An engineer ran a *correct* runbook command to remove a few servers; a *typo* removed far more, taking down a subsystem and cascading across us-east-1 (and much of the web that depended on it). Naive read: "human typo." Senior read (and AWS's own, admirably): the *tool* allowed a single command to remove capacity *below the minimum the system needed*, with **no guardrail** capping how much could be removed at once, and **no fast restart** path for a subsystem that hadn't been fully restarted in years. The fix wasn't "be more careful" (Old View) — it was **adding a guardrail that rejects removing too much capacity** (New View: fix the system that made the error possible). Local rationality: the command was *the right command*; the system didn't protect against the slip.

### Cloudflare, 2019 — a regex that ate the CPU (latent condition + missing defense)

A regular expression with catastrophic backtracking, deployed to the WAF, drove CPU to 100% globally. Naive read: "a bad regex." Senior read: a **latent condition** (no complexity limit on WAF regexes), a **deploy path** that pushed the rule globally with no staged rollout, and a **missing CPU-runaway guard**. Cloudflare's write-up is a model: it names the regex, *and* the absent defenses, *and* commits to guardrails (regex complexity limits, staged rollout, CPU protection) — defenses-not-causes, exactly.

### GitLab, 2017 — database deletion + the backups didn't work (the meta-finding made real)

A tired engineer, fighting a replication incident at night, deleted the *wrong* directory (production, not the replica). The horror: **five separate backup/restore mechanisms were all broken or untested**. Naive read: "human deleted prod." Senior read: **local rationality** (3 a.m., confusing replication state, an easy directory mix-up the *tooling invited*), and a devastating **meta-finding** — the org could not *recover* because every recovery path was un-exercised. GitLab's response (admirably public, live-streamed even) was New-View throughout: fix the tooling that invited the deletion, and — far more important — fix the *backups* (the repair-the-investigation/recovery class). The lesson seniors quote forever: **untested backups are not backups.**

### The pattern across all four

Every famous outage, read at senior level, is *not* a single root cause and *not* a careless human. It's:
- a **latent condition** sitting harmless for months,
- a **trigger** that was often a *normal, correct* action,
- **several absent defenses** that each, alone, would have contained it,
- and a **system that made the human's action locally rational**.

When you read the next public post-mortem, grade it against the [rubric](#measuring-post-mortem-quality). The good ones (Cloudflare, AWS, GitLab, Google) name defenses, not villains. The bad ones stop at "human error" — and you'll know exactly what they missed.

---

## Pros & Cons

| Practice / framework | Pros | Cons |
|---|---|---|
| Abandoning single root cause | Honest; generates multiple durable fixes; New-View aligned | Harder to write; leadership may want "the one cause"; needs cultural buy-in |
| Swiss cheese model | Intuitive; maps directly to "add a defense"; everyday-usable | Still implies linear-ish causation; can miss emergent/control failures |
| STAMP / CAST | Captures emergent failures no chain model can; control-loop fixes | Heavy; steep learning curve; overkill for simple incidents |
| New View / local rationality | Prevents blame; surfaces real system findings; keeps reporting alive | Feels "soft" to Old-View leaders; requires discipline to hold |
| Counterfactual elimination | Removes hindsight poison; each rewrite becomes an action item | Tedious; reviewers must catch every "should have" |
| Action-item-as-a-system | Loop actually closes; recurrence drops | Requires tracker integration, budget, and sustained leadership will |
| Measuring PM quality | Improves the process, not just individual docs | Every metric is gameable; misuse breeds SEV-deflation/metric-gaming |
| Cause-class aggregation | Funds platform fixes that kill whole classes | Needs disciplined tagging and a critical mass of incidents |
| Near-miss program | Cheapest possible learning | Needs deep psychological safety or nobody reports |

---

## Use Cases

- **Leadership demands "the root cause" in one line.** Reframe: deliver the changeable cut plus the contributing-factor set, and explain why a single line would be a lie that leaves the system unsafe.
- **The same class of incident keeps recurring across teams.** Aggregate by cause class; propose a *platform* fix that kills the class for everyone.
- **A post-mortem draft blames the on-call.** Reviewer pass: strike counterfactuals, rewrite via local rationality, surface the system conditions.
- **An incident you couldn't fully investigate** (logs rotated, dump lost). The investigation gap *is* the headline action item.
- **A core dump whose backtrace is `??` garbage.** Read it as a memory-safety tell; switch to sanitizers.
- **A heap dump whose biggest object is innocent.** Histogram + dominator-tree retained sort to find the real, small-object retainer.
- **Stand up an org learning loop.** Searchable archive, cause-class taxonomy, AI dashboard, near-miss channel, read-and-discuss ritual.
- **Grade other teams' post-mortems** against the rubric, as a calibrating senior service.

---

## Coding Patterns

### Pattern: front-matter every post-mortem for aggregate analysis

```yaml
---
sev: 2
date: 2026-05-29
cause_class: [cache-stampede, config-blast-radius]   # the unit of cross-incident learning
detection: alert            # alert | human | customer  (tracks detection-gap rate)
mttd_seconds: 60
mttr_seconds: 420
action_items_open: 7
action_items_done: 0
---
```

The front-matter is what turns a folder of prose into a *queryable dataset* — the precondition for measuring recurrence and funding class-wide fixes.

### Pattern: a CI lint that fails on counterfactuals in a post-mortem

```bash
# pre-merge check on postmortems/*.md — block the most common hindsight phrases.
if grep -rniE 'should have|could have|failed to|neglected to|should not have' postmortems/; then
  echo "Hindsight/counterfactual language found. Rewrite via local rationality."
  echo "(What did they actually see, and why did it make sense?)"
  exit 1
fi
```

Yes, this is bluntly mechanical — and it catches the exact phrases that smuggle blame into 80% of drafts.

### Pattern: action item that cannot close without proof of class-closure

```yaml
# An AI's "done" requires an artifact proving the class can't recur, not just a merged diff.
action_item:
  id: AI-1
  class: prevent
  closes_when:
    - test: "TestPricingCoalescing_collapses_simultaneous_misses"   # the regression test
    - alert: "pricing_pool_saturation"                              # the detection
  # "code merged" is NOT sufficient. The test + alert ARE the proof the class is closed.
```

### Pattern: capture-before-restart, persisted past the pod's death

```bash
# Senior addition to the middle-level runbook: write to a path the orchestrator WON'T wipe.
DUMP_DIR="/mnt/incident-evidence/$(hostname)-$(date -u +%Y%m%dT%H%M%SZ)"   # persistent volume
mkdir -p "$DUMP_DIR"
kill -SIGQUIT "$PID"                                              # goroutine/thread dump to logs
curl -s localhost:6060/debug/pprof/heap > "$DUMP_DIR/heap.pb.gz"
curl -s 'localhost:6060/debug/pprof/goroutine?debug=2' > "$DUMP_DIR/gs.txt"
readelf -n /proc/"$PID"/exe | grep 'Build ID' > "$DUMP_DIR/buildid.txt"   # so symbols match later
# THEN restart. If the pod restarts before this runs, the evidence gap is your top AI.
```

---

## Clean Code

- Post-mortems carry **machine-readable front-matter** (SEV, cause class, MTTD/MTTR, AI counts) — the archive is a dataset, not a drawer.
- **Cause-class taxonomy** is version-controlled and curated, not ad-hoc per author.
- Every action item is a **ticket in the real backlog**, tagged `incident-followup`, classified prevent/detect/mitigate/repair-investigation.
- An action item **closes on proof of class-closure** (a test + an alert), never on "merged."
- **Build IDs / symbols** for every release are retained, so a core dump months later symbolicates against the *right* build.
- **Counterfactual language is linted out** of drafts; local rationality is the house style.
- Dumps land on a **persistent, restricted, encrypted** path the orchestrator won't wipe, deleted after the investigation.
- The **AI dashboard and recurrence-by-class report** are generated, not remembered.

---

## Best Practices

1. **Refuse the single root cause.** Deliver contributing conditions + an explicit, defended cut. Apply the "if only this were different…" test ruthlessly.
2. **Reframe via defenses, not causes.** For each contributing condition, name the defense that should have caught it — that *is* the action item.
3. **Eliminate every counterfactual.** Strike "should have / could have / failed to"; rewrite via local rationality. Treat "human error" as the question, not the answer.
4. **Run the meta-investigation.** Surface detection gaps, evidence gaps, hero dependencies, and recurrence — they often matter more than the incident.
5. **Pick the right framework.** Swiss cheese for the everyday; STAMP/CAST when nothing actually "broke" yet the system failed.
6. **Engineer follow-through as a system.** Tracker integration, named owners, a budget, an aging policy, and closure-on-proof — not willpower.
7. **Balance and classify action items.** Not all prevent; ensure detect and mitigate; add a repair-the-investigation item when you were blind.
8. **Measure outcomes, not just process.** Recurrence-by-class is the only ungameable metric; watch near-miss reporting as a *health* signal.
9. **Aggregate across incidents** by cause class to fund platform fixes that kill whole classes.
10. **Verify the build before trusting a dump.** Match build-id / dSYM UUID; read `??` and `<optimized out>` adversarially.
11. **Protect Just Culture above all.** It's the precondition for every other practice; without safe reporting, you go blind.

---

## Edge Cases & Pitfalls

- **Leadership wants a name.** The pressure to produce a culprit is real and corrosive. Hold the line: a name is not a fix, and blaming the operator guarantees recurrence because the system is untouched.
- **STAMP overkill.** Don't model a control structure for a one-line null-pointer fix. Match the method's weight to the incident's complexity.
- **Metric gaming.** "% with post-mortem" drives SEV-deflation; "AI completion rate" drives trivial-AI padding and bulk "won't do" closes. Pair every process metric with the outcome metric (recurrence) it's supposed to serve.
- **Counterfactual relapse.** Hindsight bias is automatic; even seniors backslide. The CI lint and a reviewer pass are guardrails because *discipline alone fails*.
- **The dump from the wrong build.** Plausible-looking frames that are entirely wrong. Always verify build-id/UUID *first*.
- **`<optimized out>` panic.** Don't conclude "no information"; check registers and `info scope`, and rebuild the same commit at `-O0` only as a last resort (it may not reproduce).
- **Heap-dump red herring.** The biggest single object is often legitimate and short-lived; the leak is usually many small objects under one dominator.
- **Symptom-set fix.** Fixing the *stuck* goroutines (a timeout) without reaching the *dead producer* leaves the real bug armed.
- **Near-miss program with no safety.** Stand it up before Just Culture is real and you get zero reports plus a false sense of coverage.
- **Recurrence hidden by re-classification.** The same class re-labeled each time looks like distinct incidents. Curate the taxonomy or you'll never see the pattern.
- **Action item "done" = merged.** Without closure-on-proof, the class quietly stays open and recurs.

---

## Common Mistakes

1. **Writing "root cause: X"** and stopping — the single most common senior-level regression into junior habits.
2. **Terminating analysis on a human** ("the on-call didn't…") instead of the system that shaped them.
3. **Leaving counterfactuals in the doc** — hindsight masquerading as rigor.
4. **All-prevent action items**, with no detection or mitigation, so MTTD/MTTR never improve.
5. **No repair-the-investigation item** after an incident you couldn't fully analyze — guaranteeing the next blindness.
6. **Treating each incident in isolation**, missing the cross-incident pattern that would fund a platform fix.
7. **Trusting dump frames without verifying the build** — symbolicating against the wrong binary.
8. **Calling the biggest heap object "the leak"** without checking dominator/retained and one-big-vs-many-small.
9. **Fixing the symptom set** (stuck threads/goroutines) without reaching the absent producer.
10. **Measuring only process metrics** (completion %, time-to-publish) and gaming them, while recurrence quietly climbs.
11. **Standing up metrics or near-miss programs before Just Culture**, killing honest reporting.
12. **Closing action items on "merged"** instead of proof the class can't recur.

---

## Tricky Points

1. **"Root cause" is a *cut you choose*, not a *thing you find*.** Make the cut explicit and defend it; an invisible cut is a hidden assumption that someone else will pay for.
2. **Swiss cheese fixes by *adding a slice*, not patching the hole that was hit.** Defense in depth means the *next* set of holes is unlikely to align.
3. **STAMP's power is that nothing has to "break."** When every component did its job and the system still failed, only a control/interaction model explains it.
4. **Counterfactuals dead-end; local-rationality rewrites generate fixes.** That's not a style preference — it's the difference between an empty judgment and an action item.
5. **A `??`-filled, `0x4141…` backtrace is *strong* evidence**, not "no information" — it screams memory-safety bug and redirects the whole investigation.
6. **The biggest object in a heap dump is usually not the leak.** Sort by *dominator retained heap*; check one-big-vs-many-small with a histogram first.
7. **Stuck goroutines/threads are victims; the cause is who *stopped sending*.** Look for the *absent* goroutine, not the abundant ones.
8. **A *rising* near-miss rate is a *health* signal** — it means reporting feels safe. Don't "improve" it down.
9. **Recurrence-by-class is the only ungameable metric.** Process metrics tell you the ritual ran; recurrence tells you whether anyone *learned*.
10. **"Blameless" ≠ "no accountability."** It means accountability *for the system by default*, because that's where the leverage and the truth are; reckless behavior is the rare, real exception (Just Culture).

---

## Test Yourself

1. Take a post-mortem that names a single root cause. Rewrite its causal section as a Swiss-cheese set of contributing conditions, each mapped to the defense that should have caught it and the action item that adds/strengthens that defense.
2. Find three counterfactual statements ("should have / could have / failed to") in a real or sample post-mortem. Rewrite each via local rationality, and show how each rewrite *produces an action item*.
3. Pick a multi-team incident where "nothing actually broke." Sketch its STAMP control structure: list the controllers, each one's flawed process model, its unsafe control action, and the missing feedback.
4. Given a `gdb` backtrace full of `?? ()` with `0x4141414141414141` frames, state your hypothesis, the commands you'd run to confirm it, and how the diagnosis changes your tooling.
5. Given a JVM heap dump where the largest single object is a 700MB `byte[]`, describe the steps that determine whether it's the leak or a red herring, and how you'd find the real retainer.
6. A Go service has 47k goroutines stuck on `chan receive`. Write the exact commands to find the *cause* (the absent producer), not just the symptom, and to confirm its death in logs.
7. Design the action-item follow-through *system* for a 50-engineer org: tracker integration, ownership model, budget, aging policy, and the definition of "closed." Name the failure mode each element prevents.
8. Define five metrics for post-mortem quality, label each process vs outcome, and describe exactly how each can be gamed and which outcome metric guards it.
9. Take ten of your org's last incidents, assign each a cause class, and identify one class recurrent enough to justify a platform-level fix. Write the one-paragraph proposal.
10. Read one public post-mortem (Cloudflare/AWS/GitLab/Google). Grade it against the quality rubric and write the three sentences of analysis its authors *didn't* but should have.

---

## Tricky Questions

1. **Q: Your VP asks for "the one root cause" of a SEV-1 in a sentence. What do you do?**
   A: You don't give a false sentence. You say: "There isn't one — it took four absent defenses to align, and naming any single one would leave the other three armed for next time. Here's the changeable layer we're acting on and why." If forced to compress, give the *highest-leverage missing defense* ("we had no canary on config changes") explicitly labeled as *one of several necessary conditions*, never as "the cause." Giving a fake single cause is how the same class recurs and your credibility with it.

2. **Q: A post-mortem concludes "root cause: human error — the on-call deleted the wrong directory." Why is this not a finished analysis?**
   A: "Human error" is the *thing to be explained*, never the explanation (New View). The unfinished questions: what made deleting the wrong directory locally rational (confusing tool state, similar paths, 3 a.m., pressure)? Why did the *tooling* allow a destructive action with no confirmation/guardrail? And — the GitLab lesson — why couldn't we *recover* (were backups tested)? The fix is in the system that invited the error and failed to contain it, not in the person.

3. **Q: When do you reach for STAMP instead of Swiss cheese or 5 Whys?**
   A: When the incident *resists* the chain model — when you keep wanting to write "but every component worked as designed and it still failed." That's emergent failure from unsafe *interactions/control*, which chain models can't express. STAMP/CAST models the control structure and finds flawed process models and missing feedback. It's heavier, so reserve it for complex, multi-team, emergent incidents; don't STAMP a null-pointer fix.

4. **Q: A `gdb bt` shows `#1 0x4141414141414141 in ?? ()`. Junior says "no symbols, useless dump." What do you say?**
   A: The opposite — it's a loud signal. `0x41` is ASCII `'A'`; a stack full of a repeating byte pattern means the stack (saved frame pointer/return address) was *overwritten*, i.e. a buffer overflow or other memory-safety bug. That redirects the entire investigation: stop hunting logic bugs, rebuild under AddressSanitizer, and reproduce. The "useless" dump just told you the *bug class*.

5. **Q: MAT's Leak Suspects flags a 700MB `byte[]` as the dominator. Is that your leak?**
   A: Maybe not. A single huge `byte[]` is frequently a *legitimate, short-lived* buffer the dump caught mid-flight. Real leaks are usually *many small objects* (millions of `CacheEntry`) retained by one innocent-looking field. Run `jmap -histo:live` first: one big object vs many small ones is the discriminator. Then sort the dominator tree by *retained heap*, not by single-object size, to find the true root.

6. **Q: Your team fixes the 47k stuck goroutines by adding a channel timeout. Why might the next incident be worse?**
   A: Because the stuck goroutines were *victims*, not the cause — they were waiting on a producer that *died* (panicked, never restarted). A timeout stops the leak's *symptom* but the producer is still dying silently. Next time it dies under load and you've masked the signal. The action item must reach the *producer's death* (auto-restart, supervision, an alert on the consumer-absent condition), not just bound the consumers' wait.

7. **Q: Your post-mortem process metrics look great — 100% of SEV-1/2 have completed post-mortems, AI completion is 95%. Is the process working?**
   A: Unknown from those numbers — they're all gameable. 100% completion can come from SEV-deflation and rushed shallow docs; 95% AI completion can come from trivial AIs and bulk "won't do" closes. The only ungameable signal is *recurrence-by-cause-class*: is the same class going quiet after its AIs land? Pair every process metric with the outcome it's supposed to serve, and treat a *rising near-miss report rate* as health, not noise.

8. **Q: Three months after a clean, blameless, well-written post-mortem, the same class of incident recurs. What failed, and where do you look?**
   A: The *outer loop* failed — the doc was good, the *learning* wasn't real. Look at follow-through: did the action items land, or decay silently? Did "done" mean "merged" rather than "class closed by a test + alert"? Was the fix *local* when the pattern needed a *platform* fix (aggregate by cause class)? The post-mortem's quality was never the question; the loop's closure was, and it didn't close.

---

## Cheat Sheet

```text
┌──────────────────────── POST-MORTEM ANALYSIS — SENIOR CHEAT SHEET ──────────────────────────┐
│                                                                                             │
│  KILL "ROOT CAUSE"                                                                          │
│    It's a CUT YOU CHOOSE, not a thing you find. Make the cut explicit & defend it.           │
│    Test: "if ONLY this were different — no incident?" → if no, it's ONE of several.           │
│    5 Whys = brainstorm primer, NEVER a terminator. Never end a branch on a person.            │
│                                                                                             │
│  SYSTEMS THINKING                                                                          │
│    Swiss cheese: fix by ADDING a slice, not patching the hit hole. (everyday)                 │
│    STAMP/CAST: accidents = inadequate CONTROL, not failures. (when nothing "broke")           │
│    New View: human error is a SYMPTOM, the question — not the answer.                          │
│    Local rationality: reconstruct why it made sense AT THE TIME.                               │
│                                                                                             │
│  COUNTERFACTUALS = HINDSIGHT POISON                                                         │
│    grep -niE 'should have|could have|failed to' → rewrite each as "what they SAW & why".      │
│    Each rewrite BECOMES an action item. Dead-end → fix.                                        │
│                                                                                             │
│  META-INVESTIGATION (the senior delta)                                                     │
│    Detection gap? Evidence gap? Hero dependency? RECURRENCE? Often > the incident.             │
│                                                                                             │
│  FORENSICS THAT DEFEAT THE OBVIOUS READ                                                     │
│    Verify build FIRST: readelf -n / eu-unstrip / dwarfdump --uuid (wrong build = wrong line)  │
│    ?? + 0x4141… = OVERFLOW (memory-safety) → ASan, not "no info"                               │
│    <optimized out> → registers / info scope / rebuild same commit -O0                          │
│    heap: biggest object often a RED HERRING → histogram + dominator RETAINED                   │
│    stuck goroutines = VICTIMS → find the ABSENT producer                                       │
│                                                                                             │
│  ACTION ITEMS AS A SYSTEM                                                                   │
│    tracker-integrated · named owner · budgeted · aging policy · close on PROOF (test+alert)    │
│    Classify: PREVENT / DETECT / MITIGATE / REPAIR-INVESTIGATION — balance, not all-prevent.    │
│                                                                                             │
│  MEASURE                                                                                    │
│    Process metrics (gameable): %PM · time-to-publish · AI completion · AI aging                │
│    OUTCOME (real): RECURRENCE-BY-CLASS (ungameable) · MTTD/MTTR trend · near-miss↑ = HEALTH    │
│                                                                                             │
│  LEARNING LOOP                                                                             │
│    tag by cause class → aggregate → platform fix kills the CLASS → searchable archive          │
│    Just Culture is the PRECONDITION: blameless = accountable for the SYSTEM by default.        │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **"Root cause" is broken for socio-technical systems.** It's a *stopping rule* and a *cut you choose*, not a discovery. Replace it with a set of contributing conditions, an understanding of how the normal system produced harm, and an explicit, defended cut.
- **5 Whys is a brainstorming primer, never a terminator.** Reality is a graph, not a chain; never let a branch end on a person.
- **Use systems thinking.** Swiss cheese (add a slice, don't patch one hole) for the everyday; STAMP/CAST (accidents = inadequate control) when nothing actually "broke"; Dekker's New View — human error is a *symptom* to be explained, via local rationality.
- **Eliminate counterfactuals.** "Should have / could have" is hindsight poison; rewrite each as "what they saw and why it made sense," and watch each rewrite turn into an action item.
- **Run the meta-investigation.** Detection gaps, evidence gaps, hero dependencies, and recurrence often matter more than the incident itself.
- **Read dumps adversarially.** Verify the build first; `??`+`0x4141…` means a memory-safety bug; the biggest heap object is often a red herring; stuck goroutines are victims of an absent producer.
- **Engineer follow-through as a system** — tracker integration, named owners, a budget, an aging policy, and closure on *proof* (a test + an alert), classified and balanced across prevent/detect/mitigate/repair-investigation.
- **Measure outcomes, not just process.** Recurrence-by-cause-class is the only ungameable signal; a rising near-miss rate is *health*.
- **Build the learning loop**: tag by cause class, aggregate, fund platform fixes that kill whole classes — on a foundation of Just Culture, because safe reporting is the precondition for all of it.

---

## What You Can Build

- A **post-mortem dataset pipeline**: parse front-matter (SEV, cause class, MTTD/MTTR, AI counts) from every doc into a queryable store; emit recurrence-by-class, detection-gap rate, and MTTD/MTTR trends.
- A **counterfactual linter** for post-mortem drafts (CI check) that flags "should have / could have / failed to" and any termination on a named person, with a one-line "rewrite via local rationality" hint.
- An **action-item follow-through dashboard**: pulls all `incident-followup` tickets org-wide, ages them, escalates ones 2× past due, and refuses "closed" without a linked closure-proof artifact (test + alert).
- A **cause-class aggregator** that surfaces, each quarter, the classes recurrent enough to justify a platform fix — turning per-incident patches into class-killing investments.
- A **forensic verification tool** that, given a core/`.hprof`/`.dmp` and a binary, checks build-id / dSYM-UUID match *before* symbolication and warns loudly on mismatch.
- A **STAMP/CAST worksheet generator**: scaffolds the control structure (controllers, process models, control actions, feedback) for facilitators tackling an emergent, multi-team incident.
- A **near-miss intake bot**: a low-friction channel/form that captures near-misses with cause-class tagging, feeding the same dataset as full post-mortems.
- An **incident "wheel of misfortune" kit**: anonymized past incidents replayed as tabletop drills, so the org rehearses both the inner loop (mitigation) and the analysis.

---

## Further Reading

- Sidney Dekker, *The Field Guide to Understanding 'Human Error'* — the New View, local rationality, the definitive blame-vs-systems text.
- Nancy Leveson, *Engineering a Safer World* — STAMP and CAST, free PDF from MIT; the systems-control model of accidents.
- James Reason, *Human Error* and *Managing the Risks of Organizational Accidents* — the Swiss cheese model, latent vs active failures.
- Richard Cook, *How Complex Systems Fail* — eighteen short, devastating observations; required senior reading.
- John Allspaw, "Blameless PostMortems and a Just Culture" (Etsy Code as Craft) and the Adaptive Capacity Labs writing.
- *Site Reliability Engineering*, Ch. 15, and *The SRE Workbook*, "Postmortem Culture" — Google's templates, the wheel of misfortune.
- David Marx, *Whack-a-Mole* / Just Culture writing — the choices-vs-system accountability line.
- Public post-mortems to study against the rubric: Cloudflare incident reports; AWS post-event summaries (esp. S3 2017); GitLab 2017 database incident (and its live recovery); the Knight Capital SEC filing; the Columbia/CAIB report (non-software, but the gold standard of investigation).
- *Debugging with GDB* — the core-dump, `info scope`, and unwinding chapters; `eu-unstrip`/`readelf` man pages for build-id matching.

---

## Related Topics

- [`junior.md`](junior.md) — the two senses of post-mortem, blameless basics, timelines, 5 Whys, first core dump.
- [`middle.md`](middle.md) — running the review, the document, contributing factors, SEV levels, forensic reconstruction, the full dump walkthrough.
- [`professional.md`](professional.md) — org-wide learning programs, near-miss analysis at scale, large-scale forensic reconstruction.
- [`interview.md`](interview.md) — senior post-mortem and systems-thinking interview questions.
- [`tasks.md`](tasks.md) — labs: re-analyze an incident without a single root cause; an adversarial core-dump lab.
- [`../debugging/senior.md`](../debugging/senior.md) — production observation, sanitizers, heap/goroutine dumps at scale, the premise audit — the live-debugging counterpart.
- [`../crash-reporting/README.md`](../crash-reporting/README.md) — automated capture and symbolication of the crashes you analyze here (build-id matching lives here too).
- [`../tracing/README.md`](../tracing/README.md) — distributed traces, the X-ray that surfaces the causal link a single service can't show.
- [`../logging/README.md`](../logging/README.md) — structured logs and correlation IDs, the raw material of every reconstruction.

---

## Diagrams & Visual Aids

### The cause is a *cut* you choose

```text
   distal ◄─────────────────────── causal influence ──────────────────────► proximate
   (years ago)                                                              (seconds ago)

   org incentive ─► fragile default ─► latent bug ─► missing canary ─► TTL deploy ─► OUTAGE
        │                 │               │              │               │
        └─ "fixed         └─ changeable?  └─ changeable  └─ CHANGEABLE   └─ trigger
            background"      maybe          YES            HIGH-LEVERAGE    (not "the cause")
                              ╎                ╎               ╎
                              ╎   THE CUT you choose, explicitly, here ──► act on this layer
                              └────────────── and DEFEND why ─────────────┘
   Single-root-cause writers make this cut invisibly & badly, then call it "discovered."
```

### Swiss cheese: add a slice, don't patch the hole

```text
   hazard ─►│ ●  │   │   │ ●│   │   ← review     (hole: interaction unmodeled)
            │    │ ● │   │  │ ● │   ← tests       (hole: no stampede test)
            │ ●  │   │ ● │  │   │   ← ALERTING    (hole: no pool-sat alert)
            │    │   │   │ ●│   │   ║ ← CANARY ║  ← ADD THIS SLICE (was full-width hole)
                          ▼              ▲
                       OUTAGE      the new slice blocks the whole column → no incident
```

### Old View vs New View

```text
        OLD VIEW                                  NEW VIEW
   ─────────────────                         ─────────────────
   human error = CAUSE                       human error = SYMPTOM of deeper trouble
   "who did it?"                             "what about the system made it rational?"
   fix = remove/discipline/retrain  ──X──►   fix = change the tools/design/incentives
   stops AT the person                       pushes THROUGH the person to the system
        │                                            │
        ▼                                            ▼
   blame → silence → blindness               understanding → reporting → learning
```

### The two-loop system

```text
   INNER LOOP (minutes–hours, MTTR)          OUTER LOOP (days–quarter, RECURRENCE)
   ┌─────────────────────────────┐           ┌──────────────────────────────────────┐
   │ detect → mitigate → recover │  ──evidence──►  analyze → change system → VERIFY  │
   └─────────────────────────────┘           │            class is closed (test+alert)│
        juniors live here ("we recovered!")  └──────────────────────────────────────┘
                                                seniors are accountable HERE
                                                (most teams' outer loop is broken &
                                                 nobody is measuring it)
```

### The senior forensic decision: don't trust the obvious read

```text
   open dump ─► VERIFY BUILD-ID/UUID first ─► matches? ──no──► WRONG SYMBOLS, stop
                                                │ yes
                                                ▼
                 ┌─────────────────────────────────────────────────────────┐
                 │ ?? + 0x4141…   → memory-safety bug → ASan (not "no info") │
                 │ <optimized out>→ registers / info scope / rebuild -O0     │
                 │ big heap object→ histogram: 1-big vs many-small? dominator│
                 │ stuck goroutines→ find the ABSENT producer, not the victims│
                 │ healthy py stack→ /proc/PID/wchan, strace, C-ext/GIL block │
                 └─────────────────────────────────────────────────────────┘
                            come with a HYPOTHESIS; try to FALSIFY it.
```
