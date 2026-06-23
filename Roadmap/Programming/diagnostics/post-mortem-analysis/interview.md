# Post-Mortem Analysis — Interview Questions

> **Topic:** [Post-Mortem Analysis Roadmap](README.md)
> **Focus:** Questions an interviewer can actually ask about running a blameless incident review, building a timeline, critiquing "root cause," writing action items that land, and reconstructing a failure from logs, traces, and dumps.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Conceptual / Foundational](#conceptual--foundational)
3. [Frameworks & Methods](#frameworks--methods)
4. [Forensic / Core-Dump](#forensic--core-dump)
5. [Tricky / Trap Questions](#tricky--trap-questions)
6. [System / Process Design Scenarios](#system--process-design-scenarios)
7. [Scenario / Walk-Me-Through](#scenario--walk-me-through)
8. [Behavioral / Experience](#behavioral--experience)
9. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
10. [Cheat Sheet](#cheat-sheet)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

Post-mortem interviews split into two flavours. The first is "do you know the craft" — can you run a blameless review, build an evidence-based timeline, assign a SEV, write a SMART action item, open a core dump and walk down the stack. The second is "do you think like an investigator and a systems person" — given a messy multi-causal failure, can you resist the single-root-cause story, separate trigger from contributing factors, and turn the analysis into change that actually lands. Senior and staff interviews lean almost entirely on the second.

This file is the question bank. Trap questions also explain *why* the obvious instinct is wrong, because in real incident work the wrong instinct — blaming the deployer, naming one root cause, restarting before grabbing the dump — is the expensive part. The behavioural and scenario sections are for senior and staff roles where the interviewer wants stories and judgement with shape: evidence, surprise, a systems insight, a change that held — not a recital of the SRE book's table of contents.

A note on names: "post-mortem," "incident review," "retrospective," and "learning review" are used roughly interchangeably across orgs. Some teams (Google, increasingly) prefer "postmortem" without the hyphen and stress the *blameless* qualifier; others say "incident retro." Use whatever the interviewer uses; don't correct their vocabulary.

---

## Conceptual / Foundational

### Q: What is a post-mortem, and what is it *for*?

A post-mortem is the structured artifact and process by which a team reconstructs an incident, understands why it happened, and commits to changes that prevent recurrence. The word carries two senses worth distinguishing: the **incident post-mortem** (an outage review) and the **program post-mortem** (forensic analysis of a crashed process from its core/heap dump). They share a mindset — reconstruct the failure precisely from preserved evidence — and a good answer mentions both.

What it's *for*: the document is a message to a future engineer, possibly on another team, who is about to make the same mistake. It is judged by the change it produces, not its thoroughness about the past. A beautiful write-up with zero completed action items has taught the org nothing.

What it is *not*: a confession, a record-for-its-own-sake, a performance review, or a place to assign blame.

### Q: What does "blameless" actually mean? Doesn't someone have to be accountable?

Blameless means the review assumes everyone acted reasonably given the information, tools, incentives, and time pressure they had. You ask "why did the *system* allow this?" instead of "why did *you* do this?" The deployer who pushed the bad config is treated as a sensor that revealed a gap, not a culprit.

Accountability and blame are different things. Blamelessness is about *cause analysis*; you still have accountability for *fixing the system*. The engineer who ran the bad command is often the best-placed person to own the action item that makes that command safe. The distinction is John Allspaw's: a *just culture* holds the system accountable, not the individual, because punishing people just teaches them to hide information — and the next investigation starves.

The pragmatic argument clinches it: in a blameful culture, people stop volunteering "actually, I'm the one who ran it." You lose the single most valuable witness, and your reconstructions get worse. Blameless isn't soft; it's how you get accurate data.

### Q: Trigger vs root cause vs contributing factor — define each.

- **Trigger** (proximate cause): the specific event that flipped the system into the failing regime — the 14:02 deploy, the broker reboot, the leap second. It's the top of the causal chain and usually the easiest part to name.
- **Root cause**: the deepest *changeable* condition behind the failure. A useful fiction — singular, satisfying, and usually wrong, because real outages are multi-causal.
- **Contributing factor**: a condition that made the failure more likely or more severe without solely causing it — a latent bug (no request coalescing), a process gap (no canary), an observability gap (no alert on the real cause).

The honest model lists a *set* of contributing factors that had to line up, with the trigger as just one of them. The test: "if *only* that one thing had been different, would there still have been no incident?" If the answer is "no, *also* the canary / the coalescing / the alert had to be missing," you have contributing factors, not a root cause.

### Q: What goes in a post-mortem document, and in what order?

A solid, fixed shape:

1. **Summary** — one paragraph: what broke, for how long, blast radius, resolution.
2. **Impact** — quantified: % of users/requests, duration, dollars, data integrity.
3. **Detection** — how we found out (alert / human / customer) and time-to-detect.
4. **Timeline** (UTC) — events with sources.
5. **Root cause & contributing factors** — trigger separated from the contributing list.
6. **Causal analysis** — 5 Whys or a fuller method.
7. **Resolution & recovery** — mitigation (stopped the bleeding) vs fix (restored normal).
8. **Action items** — a table: ID, action, owner, due, status.
9. **What went well / poorly / where we got lucky.**
10. **Appendix** — links to dashboards, traces, the dump, the deploy diff.

The discipline that matters: quantify impact, list causes as plural, link rather than paste, keep it two-to-four pages, stay blameless in every sentence. The shape is a *funnel* — wide evidence at the top narrowing to a few sharp, owned, dated action items.

### Q: What's the difference between MTTD and MTTR, and why track them per SEV?

- **MTTD** (Mean Time To Detect): from incident onset to someone/something noticing. A high MTTD is an *observability* finding — "a customer told us first" is a detection action item hiding inside a good recovery story.
- **MTTR** (Mean Time To Recover/Restore): from detection (or onset, define it and be consistent) to service restored. The headline recovery metric.

Track them per SEV because aggregating across severities is meaningless — a 6-minute SEV-2 recovery and a 6-hour SEV-1 recovery don't belong in the same average. Per-SEV tracking lets you set and measure recovery SLOs and tells you whether your investments (better alerts, runbooks, faster rollback) are paying off. Beware over-optimizing MTTR alone: a team that recovers fast but never fixes root causes is mistaking fire-fighting for fire-prevention.

### Q: What are SEV levels and what do they drive?

A severity classification — commonly SEV-1 (critical: major outage, data loss, security breach) down to SEV-3/SEV-4 (minor/cosmetic) — that is a *response trigger*, not a punishment scale. The SEV drives: who gets paged and how fast, whether an Incident Commander is appointed, whether execs and customers are notified, and — critically for this topic — whether a written post-mortem is *mandatory* (usually for SEV-1/2).

The two failure modes: **SEV inflation** (everything becomes a SEV-1, so SEV-1 stops meaning anything and on-call burns out) and **SEV deflation** (downgrading to dodge the mandatory post-mortem paperwork — a culture smell that should itself be a finding).

### Q: What's the difference between mitigation and a fix?

**Mitigation** stops the bleeding — rollback, failover, feature-flag off, traffic shed, scale up. It restores service without necessarily understanding or removing the cause. **Fix** removes the underlying defect so it can't recur.

The order in an incident is always mitigate first, diagnose second — don't debug live revenue when a rollback is safe. But a post-mortem whose "resolution" is only the mitigation ("we rolled back") and lists no fix has stopped at the symptom. The action items are where the fixes live. A classic trap: the rollback masks the latent bug, the next deploy re-triggers it, and you're back. The post-mortem must name the fix even when the mitigation already worked.

### Q: What makes an action item good?

SMART, every time: Specific, Measurable, Achievable, Relevant, Time-bound. "Improve monitoring" is none of those. "Add an alert on pricing DB pool utilization > 80% for 5m; owner: SRE on-call; due 2026-06-18" is all of them.

Plus four things the acronym misses:
- A **ticket in the same tracker** as normal work — if it only lives in the doc, it's invisible to sprint planning and dies.
- An owner who is a **person or role, not "the team"** — "the team" owns nothing.
- A **real due date** and a follow-up to check it.
- A **classification**: prevent (stop the cause) / detect (catch it sooner) / mitigate (recover faster). A healthy set has all three; an all-"prevent" set usually hides a detection gap nobody's filling.

The blunt heuristic: count the *completed* action items from your last ten post-mortems. Near zero means your process is theater, no matter how good the writing is.

### Q: Why is "human error" a bad root cause?

Because it's where the investigation *stops* instead of where it should *start*. "The engineer ran the wrong command" is a description of the trigger, not an explanation. Every "human error" is really a question: why was the dangerous command available without a guardrail? Why did the UI make the wrong option easy? Why was a tired on-call doing a risky operation alone at 3am with no second pair of eyes?

This is Sidney Dekker's point in *The Field Guide to Understanding 'Human Error'*: human error is a symptom of trouble deeper in the system, never the conclusion. The Swiss-cheese model says the operator is the last slice — if your fix is "be more careful," you've patched the one slice that's guaranteed to fail again and ignored the four upstream holes you could actually close.

### Q: What's the difference between a post-mortem and a retrospective?

Mostly vocabulary, with a real connotation difference. A **retrospective** (agile) is a recurring team-cadence reflection on *process* — what went well/poorly in the sprint — and is usually low-stakes and routine. A **post-mortem** is triggered by a specific *incident* and is about reconstructing a failure precisely and preventing recurrence. Post-mortems demand evidence (timelines, traces, dumps) that a sprint retro doesn't. Some orgs use "incident retrospective" for the post-mortem to soften the morbid metaphor. Know the audience's word.

---

## Frameworks & Methods

### Q: Walk me through the 5 Whys. What are its limitations?

You start at the user-visible symptom and ask "why?" repeatedly, each answer becoming the next question, until you reach a changeable condition (conventionally ~five iterations, but the number isn't sacred):

```
1. Why did checkout fail?      → Couldn't reach pricing (timeouts).
2. Why?                        → Pricing pool exhausted by a surge of fetches.
3. Why a surge?                → Every checkout cache entry expired simultaneously.
4. Why simultaneously?         → Long TTL meant the periodic invalidate cleared a full cache.
5. Why did a full clear hurt?  → No request coalescing to collapse simultaneous misses.
```

Limitations, and this is the part interviewers want:
- **It encourages a single linear chain** when reality is a branching web of contributing factors. The honest fix: run multiple "why" branches, not one.
- **It stops at a convenient root** — the answer depends entirely on who's asking and where they decide to stop.
- **It's prone to hindsight bias** — knowing the outcome, each "why" feels obvious, and you miss the factors that were invisible at the time.
- **It blames easily** — undisciplined 5 Whys slides into "why did the engineer..." in two steps.

Senior answer: 5 Whys is a fine *starting* tool for small incidents. For complex/SEV-1 work, reach for a method that embraces multiple causes (Swiss cheese, fault tree, or STAMP/CAST).

### Q: Explain the Swiss-cheese model.

James Reason's model: defenses against failure are layers of cheese, each with holes (latent weaknesses). On any given day the holes are in different places; an incident happens only when holes in *every* layer line up so a trajectory passes through all of them. A latent bug *and* a missing canary *and* a missing alert *and* a tired operator — remove any one slice (or shift any one hole) and the trajectory is blocked.

Why it matters for post-mortems: it reframes "what was the cause?" into "which defensive layers had holes, and which can we make smaller?" It directly justifies the contributing-factors model — you fix several layers cheaply rather than hunting one mythical root. It also distinguishes **active failures** (the operator's slip, the trigger) from **latent conditions** (the holes that sat there for months), and steers you toward the latent ones, which are the ones worth fixing.

### Q: What is STAMP/CAST and when would you use it over 5 Whys?

**STAMP** (Systems-Theoretic Accident Model and Processes), and its accident-analysis method **CAST** (Causal Analysis based on System Theory), from Nancy Leveson at MIT. The core idea: accidents aren't chains of failed components; they're the result of **inadequate control** — the system's safety constraints weren't enforced. You model the system as a control structure (controllers, the processes they control, the feedback they rely on) and ask where the control was inadequate: missing feedback, a wrong mental/process model, a constraint that was never specified.

Use it over 5 Whys when:
- The incident is **complex and socio-technical** — humans, automation, org structure, and process all interacting (think a deploy pipeline + on-call + a vendor + a policy).
- **No component "failed"** — every part worked as designed and the *interaction* was unsafe (the classic "no single thing was broken" outage).
- You want to find **systemic** fixes (close a control gap that prevents a whole *class* of incident), not point patches.

The trade-off: STAMP/CAST is heavier and needs training; it's overkill for a SEV-3 slow endpoint. Reach for it on the incident that scared everyone and "had no root cause."

### Q: Difference between a fault tree and the 5 Whys?

**Fault Tree Analysis (FTA)** is top-down and *deductive*: start with the undesired top event ("checkout unavailable") and decompose it through AND/OR gates into the combinations of lower events that could produce it. It's a *tree* (really a graph) that captures multiple causes and their logical relationships — an AND gate means both conditions were necessary, an OR gate means either sufficed.

The 5 Whys produces a single *chain*; a fault tree produces a *structure*. FTA is far better at expressing "the outage needed the TTL change AND the missing coalescing" (an AND gate) versus "either a deploy bug OR a config drift could have triggered it" (an OR gate). FTA originated in aerospace/nuclear reliability and shines when you need to be rigorous about combinations and even attach probabilities. It's heavier than 5 Whys; use it when the causal structure genuinely branches.

### Q: What's a near-miss, and why analyze incidents that didn't cause impact?

A **near-miss** (or "near-hit") is an event that *could* have caused a serious incident but didn't — because a defense held, or because you got lucky. Example: a bad config reached production but a canary caught it before full rollout; or an OOM killed a pod but the replica absorbed the traffic.

Analyze them because they're free lessons: you get the diagnostic value of an incident without the customer impact. High-reliability organizations (aviation, nuclear, medicine) treat near-misses as their richest data source precisely because they're more frequent than actual accidents and reveal the same latent holes before they line up. In the Swiss-cheese frame, a near-miss is a trajectory that passed through *all but one* layer — a loud warning that those layers have holes. The cultural challenge is getting people to *report* near-misses at all, which again requires blamelessness. "Where did we get lucky?" in every post-mortem is the near-miss harvest.

### Q: How do you measure whether your post-mortem *process* is any good?

Not by the quality of the prose. Real signals:
- **Action item completion rate** — what fraction of items from the last N post-mortems actually landed, on or near their due date. Near zero = theater.
- **Recurrence rate** — how often the *same class* of incident comes back. The cleanest verdict: did the process change the future?
- **Time-to-publish** — a post-mortem published two months late has lost its audience and its accuracy (memory decayed).
- **Reach/readership** — are post-mortems read outside the owning team? Cross-team learning is the whole point.
- **Leading vs lagging mix** — are action items shifting toward prevention/detection (leading) or stuck in mitigation (lagging)?
- **Blameless health** — do people volunteer "I ran it"? Are near-misses reported? If reporting dries up, the culture broke.

Staff-level: you also watch for *systemic* patterns across many post-mortems — the same contributing factor (no canary, no coalescing, missing alert) recurring across unrelated incidents is an org-level finding worth a program, not another point fix.

---

## Forensic / Core-Dump

### Q: What's a core dump and how do you read one in a post-mortem?

A core dump is a snapshot of a process's full memory at the moment it crashed (or was sent SIGQUIT/SIGABRT): stack, heap, registers, loaded-library addresses — everything a debugger needs to reconstruct the moment of death. Unlike a live process it doesn't change while you study it, so it's a *frozen crime scene you can re-walk* — re-open it, hand it to a colleague, compare two dumps.

```bash
ulimit -c unlimited                  # enable cores
gdb ./billing ./core
(gdb) bt full                        # full backtrace WITH locals at each frame
(gdb) frame 1                        # walk DOWN to the caller
(gdb) print acct                     # inspect a frozen value
(gdb) thread apply all bt            # every thread (multithreaded crash)
(gdb) info registers
```

The forensic discipline: **walk every frame**. The crash site (frame 0) is usually the *victim* — where a bad value was *used*. The bug is where that value was *born*, several frames down. A power move is re-running a pure function inside `gdb` against the frozen state (`print lookup_account(99812)`) to find the origin.

### Q: A process crashed, OOM'd, and a third one hangs. Which dump for each?

Match the dump to the symptom — getting this wrong wastes the whole investigation:

| Symptom | Dump | Tools | What you look for |
|---|---|---|---|
| Native crash | **Core dump** | `gdb`, `dlv core` | Crashing frame, the bad value's origin |
| OOM / heap creeps up | **Heap dump** | `jmap`+MAT; Go `pprof/heap`; `tracemalloc` | The dominating retainer subgraph |
| Hang, 0% CPU | **Thread/goroutine dump** | `jstack`; `SIGQUIT`; `py-spy dump`; `pprof/goroutine` | Who's blocked waiting on whom; deadlock cycle |
| Hang, 100% CPU | **CPU profile** | `pprof`, `perf`, `py-spy top` | The hot loop |

A core dump *would* work for a hang, but a thread dump is faster and you don't have to kill the process to get it. Using a core dump for an OOM is the classic mismatch — the heap retainers are what you need, not registers.

### Q: The JVM wrote `hs_err_pid12345.log` instead of a Java stack trace. What does that tell you?

The *VM itself* crashed — almost always in native code (a JNI call, a native library like `libjpeg`, or a JVM/JIT bug), not your Java throwing an exception. A Java exception produces a stack trace through your `catch` blocks; `hs_err_pid` is the JVM's fatal-error log, written when the process receives a fatal signal (SIGSEGV) at the native level.

Read the **"Problematic frame"** line first — it usually names a `.so` and the native/JNI method. Then the current thread, the Java frames at the boundary, and the VM/GC state lower down. The fix lives in native-land (a bad JNI binding, a library version, off-heap memory) — not in your application's exception handling. Treat it as a C-style crash that happens to have a JVM attached.

### Q: What does "symbols" mean and why does a post-mortem stall without them?

A dump stores *addresses*. Symbols are the mapping from address → function name → source line. Without them, `bt` shows `?? ()` and the dump is nearly useless — you know it died but not where. This is the single most common reason a forensic post-mortem stalls.

The rule: keep the **unstripped binary** (or separate `.debug` file), the **`.hprof` class mapping**, the **`dSYM`** (macOS), the **`.pdb`** (Windows) — from *every* release build, archived and matched to the deployed version. Symbolication needs the *exact* build; a binary from a later commit has shifted addresses and lies. For optimized builds, inlining makes line numbers approximate — confirm critical findings against a debug build, accepting it may not reproduce.

### Q: How do you read a goroutine dump (or thread dump) to find a hang?

Grab it without restarting: `curl 'localhost:6060/debug/pprof/goroutine?debug=2'`, or `SIGQUIT` the Go process, or `jstack <pid>` / `py-spy dump --pid` for JVM/Python.

The key move is **group by signature**. A hang usually means thousands of goroutines share *one* stuck stack:

```bash
grep -E '^goroutine [0-9]+ \[' gs.txt | sed 's/[0-9]\+/N/' | sort | uniq -c | sort -rn | head
#  9982 goroutine N [chan receive, 47 minutes]:   ← producer died; consumers stuck
```

Read the **state** (`chan receive`, `semacquire` = blocked on a mutex, `select`, `IO wait`) and the **how-long-stuck** duration. Patterns: everyone in `semacquire` on the same lock = contention or deadlock; 10k in `chan send` to one channel = drained/closed consumer. For JVM deadlocks, `jstack` does the work for you — it prints "Found one Java-level deadlock:" with the two threads and the two locks in the cycle.

### Q: How do you find a memory leak from a heap dump in a post-mortem?

Capture it: Java `-XX:+HeapDumpOnOutOfMemoryError` (set on every prod JVM) or `jcmd <pid> GC.heap_dump`; Go `pprof.WriteHeapProfile`; Python `tracemalloc` snapshots.

Then analyze by **retained size, not shallow size** — a small object can retain gigabytes if it's the root of a big subgraph. In Eclipse MAT:
1. **Leak Suspects Report** — heuristics often nail it: "a `HashMap` retained by `CacheService.instance` holds 89% of the heap."
2. **Dominator tree** — sort by retained size; the top entry is what's keeping memory alive.
3. **Path to GC Roots** (excluding weak/soft) — tells you *who* holds the suspect alive so you know what to fix.

For a leak (vs a single OOM spike), the strongest evidence is *two* snapshots over time and a diff (`go tool pprof -base t1 t2`, MAT compare) — that points at the *growing* retainer, not just the biggest one. Classic findings: an unbounded cache, a `ThreadLocal` holding a request in a pooled thread, listeners never unregistered.

### Q: You have no dump — only logs and traces. How do you reconstruct the failure?

This is the bread-and-butter of incident post-mortems. Four steps:

1. **Anchor on a correlation ID.** Get one concrete failing request — a `request_id` from a user's error screen or a trace ID from an error span. Query all its log lines in time order (`{service="checkout"} |= "request_id=7af3c2" | json` in Loki). The single-request timeline often already tells the story: cache miss → 4s wait on pricing → deadline exceeded.
2. **Zoom out to the aggregate.** One request is an anecdote. Confirm the pattern: error rate over the window, cache-miss ratio spiking to 100%.
3. **Read the distributed trace.** The waterfall shows *where the time went* — a 4.1s span in `pricing.fetchCatalog`, and inside it 4s in `db.acquire()` = pool exhaustion, not a slow query.
4. **Cross-reference "what changed."** Overlay the deploy/config timeline; the 50ms gap between a `catalog.invalidate` event and the miss spike is the causal link.

Forensic reconstruction is **correlating independent time series until the story is forced**. The prerequisite is propagated correlation IDs and retained logs — without them it's grep-and-pray.

### Q: A multi-service timeline shows service B logging an event *before* service A sent it. That's impossible — what's wrong?

Clock skew. The two hosts' clocks disagree; you can't trust sub-second wall-clock ordering across machines. Check NTP/chrony sync. For correct cross-service ordering, anchor on **causal links** — trace parent/child relationships, propagated IDs, vector-clock-style sequence numbers — not raw timestamps. This is a frequent, embarrassing source of nonsense timelines, and a good answer names it instantly rather than chasing a "time travel" bug.

---

## Tricky / Trap Questions

### Q: Your post-mortem names exactly one clean root cause. Why is that a yellow flag?

Wrong instinct: "clean and single = good analysis." Usually it means you stopped early.

Real outages are almost always multi-causal: a latent bug + a trigger + a process gap + an observability gap, all lined up (Swiss cheese). A single named cause usually means the investigation halted at the first satisfying answer. Apply the test: "if *only* that one thing had been different, would there have been no incident?" If the honest answer is "no — we *also* needed the canary, the coalescing, and the alert to be missing," you have contributing factors masquerading as a root cause. The fix is to keep asking what *else* had to be true.

### Q: The core dump shows your code crashed dereferencing a null at line 118. Is the bug at line 118?

Wrong instinct: "the crash line is the bug, fix the null check there." Probably not.

Line 118 is where a bad value was *used* — the victim. Walk *down* the stack: where was the null *produced*? Usually a lookup several frames up returned null and nobody checked. *That* is the origin. Adding a null check at 118 papers over the symptom and silences a corruption that's still wrong upstream. The real fix is at the birthplace — make the lookup not return null, or handle the empty case where it happens. The power move: in `gdb`, re-run the pure lookup against the frozen state to confirm it returns null *in this exact context*.

### Q: A process is hung at 0% CPU. Do you take a core dump?

Wrong instinct: "it's broken, dump core, debug in gdb." You'd be killing the process to get a worse artifact.

A hang is about *who is blocked waiting for whom* — which a thread/goroutine dump shows directly (`jstack`, `SIGQUIT`, `py-spy dump`, `pprof/goroutine`) *without* killing the process. A core dump would technically contain the blocked stacks too, but you'd have to abort the process to get it, lose the chance to take a second dump and compare, and then dig the thread states out of raw memory instead of reading them off a formatted dump. Right tool: thread dump first; take two a few seconds apart to see whether anything is moving.

### Q: The incident is resolved — the on-call rolled back and service recovered. Do you still need a post-mortem?

Wrong instinct: "it's fixed, move on." The rollback is a *mitigation*, not a *fix*.

The latent bug that the deploy triggered is still there; the next deploy may re-trigger it. The post-mortem exists precisely to turn "we stopped the bleeding" into "this class of incident can't recur." Whether one is *mandatory* depends on the SEV (most orgs require it for SEV-1/2), but skipping it for a real outage because the symptom is gone is how the same incident comes back next month. The resolution section should explicitly separate the mitigation that ran from the fix the action items will deliver.

### Q: An engineer ran a destructive command and took down prod. Isn't the root cause obvious?

Wrong instinct: "human error — coach them and close it." That's where you *stop* instead of where you *start*.

"The engineer ran the wrong command" is the trigger, not the explanation. The real questions: why was a destructive command available with no confirmation, no dry-run, no guardrail? Why could one person run it alone, unreviewed, at 3am? Why did the tooling make the dangerous option easy and the safe option hard? Why was there no blast-radius limit? Each is a system fix that prevents the *next* tired engineer from the same slip. "Be more careful" patches the one slice of cheese guaranteed to fail again. The good answer reframes every "human error" into a missing guardrail.

### Q: Your last six post-mortems have excellent writing and all action items still "open." Is the process working?

Wrong instinct: "the docs are thorough, so yes." No.

The document's *only* purpose is to produce change. Beautiful analysis with zero landed action items is theater. This is a *process* failure, not a writing one: the items aren't tickets in the real tracker, no person owns them, and there's no follow-up loop surfacing silent decay. Fixes: ticket every item in the same tracker as sprint work, assign a person (never "the team"), set real due dates, and run a recurring two-week review that walks open items and forces a *conscious* reprioritize-or-do decision. Measure the process by completion and recurrence rates, not page count.

### Q: A SEV-2 keeps getting downgraded to SEV-3 at triage. What might be happening, and why care?

Wrong instinct: "triage knows best, trust the label." Possibly — but watch for **SEV deflation**.

If SEV-3 skips the mandatory post-mortem, there's an incentive to downgrade to dodge the paperwork. That's a culture smell: the org is optimizing to avoid learning. The result is recurring incidents nobody analyzed and a corrupted MTTR/severity dataset. Conversely, **SEV inflation** (everything is a SEV-1) burns out on-call and makes SEV-1 meaningless. Either drift should itself be a finding. The fix is a clear, example-backed severity rubric and decoupling "do we learn from this?" from the SEV when needed (some orgs require a lightweight review for *any* customer-impacting event regardless of SEV).

### Q: The post-mortem timeline was reconstructed from everyone's memory of the incident. What's the risk?

Wrong instinct: "the people who were there know what happened." Memory is a liar under stress.

The timeline people remember and the timeline the logs show diverge constantly — order gets scrambled, durations compress or stretch, and hindsight bias rewrites "we didn't know" into "it was obvious." Build the timeline from *artifacts*: log queries, trace waterfalls, deploy records, the chat export (with timestamps), the dump. Use the meeting to *reconcile* memory against evidence, not to *source* the facts. Any claim not backed by an artifact should be flagged as a guess. And anchor cross-service ordering on causal links, not wall-clock, because of clock skew.

### Q: The optimized core dump's line numbers point at a line that can't be the bug. Why, and what do you do?

Wrong instinct: "the dump is corrupt, throw it away." It's probably *inlining*.

With optimization (`-O2`, JIT, Go inlining), the compiler merges functions and reorders code, so the address → line mapping becomes approximate; `bt` can attribute a frame to a plausible-but-wrong line. Don't discard the dump — it's still valid for *structure* (which functions, which values). To pin the exact line: rebuild with optimizations/inlining off (`-O0`, Go `-gcflags=all="-N -l"`) and reproduce, accepting that a debug build may not reproduce a timing/optimizer-dependent bug. Cross-check the suspect line against the *values* you can read in the dump rather than trusting the line number alone.

### Q: The trace you most want — the slowest, failing request — isn't in your tracing backend. Why?

Wrong instinct: "tracing is broken." More likely **sampling** dropped it.

Most systems head-sample (decide at the start of the request whether to keep the trace) at some low rate to control cost. The pathological request is often *not* the one that got sampled, precisely because it's rare. The fixes are configuration, not debugging: sample errors and high-latency requests at 100% (tail-based sampling makes the keep/drop decision *after* seeing the outcome), and always sample by a force-trace header for known-bad cases. As a forensic finding, "we didn't capture the trace we needed" is itself an action item: change sampling so next time you do.

### Q: After the post-mortem and its fixes shipped, the same incident recurred. What failed in your process?

Wrong instinct: "the engineers didn't follow the fix." Look at the *process*, not the people.

Several possibilities, each a different process gap:
- **The fix addressed a symptom, not a contributing factor** — you mitigated, declared victory, and the latent hole remained (the single-root-cause trap).
- **An action item was written but never landed** — open in the doc, invisible to sprint planning; the two-week follow-up didn't exist or didn't bite.
- **The fix was point, not systemic** — you patched this service but the same class of bug lives in five others (a staff-level "this is a program, not a ticket" miss).
- **No regression test / detection** — nothing proves the fix holds or catches a relapse early.
- **The contributing-factor analysis was wrong** — you fixed something that wasn't actually necessary to the failure.

A recurrence is the cleanest possible verdict that the post-mortem didn't change the future. The meta-action-item: a post-mortem *of the post-mortem* — why did our process let this recur?

---

## System / Process Design Scenarios

### Q: Design the incident-review process for a 200-engineer org from scratch.

Goals: every serious incident produces learning that lands and spreads, without crushing the org in paperwork.

- **Severity rubric.** A clear, example-backed SEV-1..4 scale that triggers paging, IC assignment, comms, and *whether a post-mortem is mandatory* (SEV-1/2). Decouple "do we learn from this?" from punishment.
- **Roles in the incident itself.** Incident Commander (coordinates, owns the decision to mitigate), Comms lead, Scribe (timestamps everything live — your timeline's raw material). Defined before the incident, in a runbook.
- **Capture-by-default tooling.** Cores/heap-on-OOM configured on every service template; correlation IDs propagated everywhere; deploy/config changes recorded on a queryable timeline; the incident chat auto-exported.
- **A single template** and a permanent, searchable home for docs (tagged by cause class), not someone's drive.
- **The review.** Single author drafts the timeline from evidence *before* the meeting; blameless ground rule stated aloud; funnel to SMART, ticketed, owned, dated action items; async-first (48h comment window) for distributed teams.
- **The follow-up loop.** A recurring review of open action items; metrics on completion rate, recurrence rate, time-to-publish; an org-level scan for *recurring contributing factors* that deserve a program, not another ticket.
- **Culture.** Blameless stated and modeled by leadership; near-misses ("where did we get lucky") harvested every time; post-mortems read across teams.

Key principle: the process is judged by **change produced**, so the follow-up loop and metrics are not optional add-ons — they're the point.

### Q: Design the forensic-capture stack so that any production crash/OOM/hang is analyzable after the fact.

Constraint: the corpse must survive a pod restart and be analyzable with the *exact* build's symbols.

- **Crashes → cores.** `ulimit -c unlimited` (systemd `LimitCORE=infinity`); `core_pattern` writing to a *persistent* path the orchestrator won't wipe (e.g. a mounted volume), named by exe+pid+time. Go: `GOTRACEBACK=crash`.
- **OOM → heap dumps.** JVM `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/var/dumps` plus `-XX:+ExitOnOutOfMemoryError`. Go/Node/Python: a signal handler that writes a heap profile on demand.
- **Hangs → on-signal thread dumps.** Wire `SIGQUIT`/`SIGUSR1` to dump all goroutine/thread stacks; expose `pprof` behind localhost/admin auth.
- **Symbols as build artifacts.** Archive the unstripped binary / `dSYM` / `.hprof` mapping / `.pdb` for *every* release, keyed to the deployed version. This is the #1 reason post-mortems stall.
- **Runbook step 1: capture before restart.** `SIGQUIT`, snapshot heap + goroutines, copy the core — *then* restart. Bake this into the on-call runbook so it's muscle memory, not a 3am decision.
- **Treat dumps as sensitive data.** They contain live customer PII — restricted, encrypted location; deleted after the investigation; same handling as a database backup.

Principle: you can't capture the corpse *after* the orchestrator reaps it. The capture has to be configured before the incident, defaulting on.

### Q: A team writes thorough post-mortems but nothing ever changes. Diagnose and fix the system.

This is a process pathology, not a writing one. Diagnose by measuring:

1. **Action item completion rate** across the last N post-mortems. Near zero confirms theater.
2. **Where items live.** If they're bullet points in the doc, not tickets in the sprint tracker, they're invisible to planning and die by default.
3. **Ownership.** "The team" owns nothing; look for per-person/role owners and real due dates.
4. **Follow-up loop.** Is there a recurring meeting that walks open items and forces a conscious reprioritize-or-do? Without it, silent decay wins.
5. **Prevent/detect/mitigate mix.** All-"prevent" usually hides an unfilled detection gap; all-"mitigate" means you keep fighting the same fire.

Fixes: ticket every item in the *real* tracker; assign a person; set and enforce due dates; run a two-week follow-up that surfaces decay; report completion and recurrence rates to the same leaders who read the post-mortems; and escalate recurring contributing factors to programs. The cultural fix is making "did the action items land?" the headline metric, not "was the doc thorough?"

### Q: How would you build an org-wide learning program from individual post-mortems?

Individual post-mortems prevent *that* incident's recurrence; a program finds *classes* of incident across many.

- **A central, tagged corpus.** Every post-mortem in one searchable place, tagged by cause class (cache stampede, missing canary, retry storm, deploy gap, observability gap).
- **Periodic meta-analysis.** Quarterly, scan for the *same contributing factor* recurring across unrelated incidents. "No request coalescing" or "no canary" showing up in six post-mortems is an org-level finding worth a platform investment, not a seventh point fix.
- **Near-miss harvesting.** Treat "where we got lucky" as first-class data; the latent holes show up in near-misses before they line up into an outage.
- **Cross-team distribution.** A digest, a brown-bag, a "post-mortem of the month" — the value is engineers on team C learning from team A's incident before they repeat it.
- **Leading indicators.** Track whether incidents are shifting from novel causes to recurrences (bad — process isn't learning) and whether time-to-detect is improving (good — observability investments paying off).

This is the senior/staff frame: stop treating incidents as independent events and start treating the corpus as a dataset about systemic weaknesses.

---

## Scenario / Walk-Me-Through

### Q: Walk me through running a post-mortem for this outage: "checkout was down for 6 minutes after a deploy; rolled back."

I'll structure it as prep → review → write-up → follow-up.

**Before the meeting.** Assign a single author. Preserve evidence *now* (dashboards age out): export the incident chat with timestamps, screenshot/permalink the dashboards with a frozen time range, save the relevant trace, pull the deploy/config record. The author drafts a timeline *from those artifacts*, not from memory, before anyone walks in.

**During the review.** State "blameless" out loud. Walk the timeline together so the people who were there reconcile and enrich it against the logs. Then separate the **trigger** (the deploy) from **contributing factors** — and resist the room naming "the" cause. Run a 5 Whys on the *system*: deploy → cache regime change → simultaneous expiry → stampede → no coalescing. Capture "what went well" (alert fired in 1 min) and "where we got lucky" (mid-afternoon, not peak — at peak this cascades). Draft action items live, each with a candidate owner and rough date.

**Write-up.** Fill the template: quantified impact (12% of checkout, 6 min, ~1,800 failed), detection (alert at +1 min), timeline, trigger + four contributing factors (no coalescing, no jitter/circuit breaker, no canary, no pool alert), 5 Whys, resolution (mitigation = rollback; fix = the action items), action-item table, and the went-well/poorly/lucky section. Two to four pages, links not pastes.

**Follow-up.** Ticket every action item in the real tracker with a person and date; bring them to the two-week review; verify the fixes land before considering the incident truly closed.

The shape I'm aiming for: wide evidence funneling to four sharp, owned, dated changes.

### Q: Walk me through diagnosing this from a core dump: a billing service segfaults intermittently in production.

1. **Get a real dump with symbols.** Confirm cores are enabled and writing to a persistent path; confirm I have the *exact* build's unstripped binary. No symbols → fix that first or the dump is `?? ()`.
2. **`bt full`.** Read the backtrace with locals. Say it shows `apply_refund(acct=0x0, amount=4500)` at frame 0 — a null deref.
3. **Walk down, don't stop at frame 0.** Frame 0 is the victim. `frame 1`: `process_event` passed the null. Why? `print e->account_id` → 99812.
4. **Reproduce the origin in the frozen state.** `print lookup_account(99812)` → returns NULL. *That's* the birthplace: the lookup returned null and nobody checked before passing it down.
5. **Check it's the same across occurrences.** `thread apply all bt` for multithreaded interactions; compare against a second dump from another crash to confirm the same signature (intermittent often = a data-dependent path, e.g. specific account states).
6. **Fix at the origin.** Handle the empty lookup where it happens (or make the lookup not return null for valid IDs), not a defensive null-check at the crash line that hides the upstream wrongness.
7. **Post-mortem it.** Contributing factors likely include: lookup can return null for in-flight accounts (latent bug), no contract/assert at the boundary, no alert on the segfault rate. Action items per factor.

The headline: the crash site told me where it *died*; walking down told me where the bug was *born*.

### Q: Walk me through reconstructing an incident when all you have is logs and traces — no dump.

1. **Find one anchor.** A `request_id` from a user's error screen or a trace ID from an error span. Query all of that request's log lines in time order. The single-request timeline often already tells the story.
2. **Confirm it's the pattern.** Aggregate metrics over the incident window — error rate, the cache-miss ratio, pool utilization — to prove the one request wasn't a fluke.
3. **Read the trace waterfall.** See *where the time went* — which span widened, and inside it, whether it's a slow query or pool acquisition or a downstream call.
4. **Overlay "what changed."** Pull the deploy/config timeline; find the causal link (the invalidate event 50ms before the miss spike; the deploy 9 minutes before onset).
5. **Build the fused timeline.** Merge the wall-clock events with the per-request state into one ordered narrative, anchoring cross-service order on trace parent/child (not raw timestamps — clock skew).
6. **Write it up with the gaps named.** Where I'm inferring rather than observing, flag it as a guess and add an action item to capture that evidence next time (e.g. force-sample errors so the trace exists).

It's correlating independent time series until the story is forced — and the prerequisite is propagated correlation IDs.

### Q: A SEV-1 just resolved. You're the Incident Commander. What are your first three post-mortem actions, in order?

1. **Preserve evidence before anything decays or restarts.** Snapshot dashboards with frozen time ranges, export the incident chat, capture any dumps (`SIGQUIT`/heap/core) *before* pods are recycled, record the deploy/config timeline. This is the most time-sensitive step — dashboards and logs age out within hours to days.
2. **Assign a single author and schedule the review** while memory is fresh (within a couple of days), with the explicit instruction to draft the timeline from artifacts first.
3. **Set the blameless frame immediately** — in the channel, in the calendar invite, at the top of the meeting. For a SEV-1 that touched customers, also confirm comms/legal/security obligations are handled in parallel (a security-relevant SEV-1 has evidence-preservation duties that go beyond a normal post-mortem).

Everything else — the analysis, the action items, the follow-up — depends on getting the evidence and the frame right in the first hours.

### Q: The same incident recurred two months after you "fixed" it. Walk me through what you'd do.

1. **Treat it as a new incident first** — mitigate, stabilize. Then investigate the *recurrence* specifically.
2. **Pull the original post-mortem.** Did it name the real contributing factors, or stop at a single root cause / symptom?
3. **Audit the action items.** Were they ticketed, owned, dated? Did they *land*? "Open" items are the most common answer — the analysis was right, the fix never shipped.
4. **If they landed, test whether they were the right fix.** Maybe we fixed a symptom; maybe the contributing-factor analysis missed a necessary condition. Re-run the analysis with the recurrence as new evidence.
5. **Check for point-vs-systemic.** Did we fix *this* service but leave the same class of bug in others? A recurrence in a *sibling* system is a staff-level "this needed a program, not a ticket."
6. **Add detection.** Whatever else, there should now be an alert and a regression test that catches a third occurrence early.
7. **Write a post-mortem of the post-mortem.** The headline finding is a *process* failure: our review didn't change the future. The fix is usually the follow-up loop (two-week review, completion metrics), not more analysis.

A recurrence is the cleanest verdict that the first post-mortem was theater or incomplete — so I'd be honest about which, in the doc.

---

## Behavioral / Experience

### Q: Tell me about an incident you led the post-mortem for.

The interviewer wants arc, evidence, a systems insight, and a change that held — not "I write great post-mortems."

Skeleton:
- **Incident.** Checkout failed for ~12% of EU users for 6 minutes after a deploy.
- **Trigger vs factors.** The trigger was a TTL change, but I pushed the room past it: no request coalescing (latent), no jitter/circuit breaker (latent), no canary (process), no pool alert (observability). Removing any one would've prevented or shrunk it.
- **Evidence.** Built the timeline from the deploy record, a Tempo trace showing 4s in `db.acquire()`, and the cache-miss ratio spiking to 100% — not from memory.
- **Output.** Four SMART, owned, dated action items. The coalescing one was the highest-leverage and I made sure it was ticketed in the sprint, not the doc.
- **Result.** No recurrence; the canary later caught two *other* bad deploys. The systems insight — "we kept treating cache stampedes as one-offs" — turned into a platform-level singleflight default.

Tell *one* incident, with concrete numbers, and end on the change that held.

### Q: Describe a time you ran a blameless review that was at risk of becoming a blame session.

Pick a specific moment where you redirected. Example: "A senior engineer started with 'why did *you* push that without testing?' I stopped it on the spot — restated the blameless ground rule, and reframed the question to 'why did our pipeline let an untested change reach prod?' That surfaced the real finding: there was no staging gate for that service. The engineer who'd been on the spot then *volunteered* two more details he'd have hidden if he'd felt accused. Lesson: blamelessness isn't politeness, it's how you keep your best witness talking."

### Q: Walk me through a post-mortem where the first 'root cause' was wrong.

"DB CPU pinned at 100% after a release. First root cause: the new query from that release. We even rolled it back — CPU stayed at 100%. So the deploy was a coincidence, not the cause. `pg_stat_activity` showed 500 idle-in-transaction connections from a *different* service whose error path returned without releasing the connection — a latent bug that a traffic shift that morning had finally exposed. The real story was multi-causal: latent connection leak + a traffic increase + no alert on idle-in-tx count. Lesson: I'd anchored on 'we deployed something,' which is the most seductive wrong root cause. Now my checklist runs top queries, idle-in-tx, connection count, and replication lag *before* blaming the deploy."

### Q: Tell me about an action item you fought to get prioritized.

Show that you understand the doc is worthless without landed changes. "A post-mortem identified that we had no canary for a high-traffic service — the change had gone 0→100% in one push. The action item kept slipping because canary infra was 'a quarter of work.' I reframed it: pulled the last four post-mortems and showed three of them had 'no staged rollout' as a contributing factor. That turned one ticket into an org-level case, and it got staffed. Lesson: a recurring contributing factor across post-mortems is a far stronger argument than one incident — aggregate the evidence."

### Q: Describe an incident you reconstructed almost entirely from a dump.

"A Go service was OOM-killed every few days, no pattern. No useful logs near the kill. I configured a heap profile capture on `SIGUSR1` and grabbed two snapshots a day apart. The diff (`pprof -base`) pointed at a single map in a metrics aggregator that keyed by full request URL — unbounded cardinality, so it grew forever. The dominator showed it retained 80% of the heap. Fix was bounding the key space. Lesson: a single dump shows the biggest retainer; *two* dumps and a diff show the *growing* one, which is what a leak actually is."

### Q: Tell me about a near-miss you turned into a real improvement.

"A bad config reached production but our canary caught it at 5% and auto-rolled-back before customers noticed. Most people called it a win and moved on. I wrote it up as a near-miss: the canary saved us, but *why did the bad config pass review and reach prod at all*? The Swiss-cheese view: only one slice held. We added a config-schema validation gate in CI — closing an upstream hole. Lesson: a near-miss is an outage minus luck. Treating it as a free lesson is one of the highest-leverage things a team can do."

### Q: When did a post-mortem teach you something about a system you thought you understood?

"I thought I understood our retry behavior. A downstream slowdown turned into a full outage, and the post-mortem revealed our 'retry on failure' had no jitter and no circuit breaker — so a 200ms downstream blip became a synchronized retry storm that took the downstream fully down (a self-inflicted thundering herd). The trace made it undeniable: retries spiking in lockstep. Lesson: 'we have retries' felt like resilience but was actually an amplifier. Now I treat every retry path as needing jitter + a breaker, and I review them proactively, not after they bite."

### Q: Tell me about a time you had to publish a post-mortem with an uncomfortable finding.

"The honest finding was 'where we got lucky': the incident hit at 2pm, and at peak traffic it would have cascaded from checkout into inventory and likely been a multi-hour SEV-1 instead of a 6-minute SEV-2. It was tempting to soft-pedal that. I put it front and center in the 'where we got lucky' section, because the luck was the scariest part — we were one timing accident from a far worse outcome, and the action items needed that urgency. Lesson: the luck you got is a finding, not a happy ending. Naming it honestly is what gets the prevention work funded."

---

## What I'd Ask a Candidate Now

Questions that separate "knows the SRE book" from "has actually led learning from failure."

### Q: How do you decide when an incident needs a full post-mortem versus a lightweight note?

Listening for a concrete policy, not "it depends." Good: "SEV-1/2 always get a full one; SEV-3 gets a lightweight note unless it's a *recurrence* or a *near-miss* of something worse — those get the full treatment regardless of impact, because the learning value isn't proportional to the customer impact." Bonus: decoupling "did it hurt customers?" from "is there something to learn?"

### Q: A post-mortem framework you've used that most people haven't heard of?

Reveals depth beyond 5 Whys. Satisfying answers: STAMP/CAST, fault tree analysis, FRAM (Functional Resonance Analysis), Dekker's "new view" of human error, the "how-complex-systems-fail" lens (Cook). Bad sign: "we always just do 5 Whys" with no awareness of its limits.

### Q: A senior engineer keeps saying "the root cause was that Bob deployed the bad config." How do you coach them?

Listening for: respect plus redirection. Not "stop blaming people, it's against policy." Good: "I'd agree the deploy was the *trigger*, then ask 'what would have to be true for Bob's deploy to be *safe*?' — no confirmation, no canary, no validation. That makes the systemic gaps visible without lecturing, and turns Bob from a culprit into the person best placed to own the guardrail."

### Q: What's your unit of 'evidence' in a post-mortem?

Strong answer: "An artifact, not a recollection — a timestamped log line, a trace waterfall, a deploy record, a dump. If a claim in the timeline isn't backed by one, I flag it as a guess." Candidates who treat "I think it happened around then" as fact produce timelines that lie.

### Q: How do you know your post-mortem actually changed anything?

Listening for *outcome* metrics, not output. Good: "Action item completion rate, and — the real one — recurrence rate of that incident class. If the same thing comes back, the post-mortem failed regardless of how it read." Weak: "we wrote a thorough doc and everyone read it."

### Q: When would you NOT do a 5 Whys?

Reveals whether they know the tool's edges. Good: "When no single component failed and the incident is an *interaction* — every part worked as designed and the emergent behavior was unsafe. 5 Whys forces a linear chain onto a branching problem and tends to stop at a convenient, often person-shaped, answer. For those I reach for Swiss cheese or STAMP." Weak: "5 Whys always works."

### Q: What's the worst post-mortem habit you've broken?

A self-aware candidate has one: "forcing a single root cause," "building the timeline from memory," "calling the rollback the fix," "letting action items live in the doc instead of the tracker," "treating near-misses as wins." The story of breaking it is more telling than the habit.

---

## Cheat Sheet

Top-10 must-know questions for any post-mortem interview:

```
┌──────────────────────────────────────────────────────────────────────┐
│ MUST-KNOW POST-MORTEM QUESTIONS                                      │
├──────────────────────────────────────────────────────────────────────┤
│  1. What is a post-mortem for?                                       │
│       → A message to a future engineer. Judged by change produced.  │
│                                                                      │
│  2. What does blameless mean?                                       │
│       → Blame the system, not the person. It's how you keep your    │
│         best witness talking — accuracy, not softness.              │
│                                                                      │
│  3. Trigger vs root cause vs contributing factor?                   │
│       → Trigger = proximate event. Root cause = useful fiction.     │
│       → Honest model = a SET of contributing factors lined up.      │
│                                                                      │
│  4. The single-root-cause test?                                     │
│       → "If ONLY this were different, no incident?" If no →          │
│         it's a contributing factor, not the root.                   │
│                                                                      │
│  5. What drives a SEV level?                                        │
│       → Response trigger: paging, IC, comms, mandatory post-mortem. │
│       → Watch for inflation and deflation.                          │
│                                                                      │
│  6. 5 Whys limitations? When use STAMP/Swiss cheese instead?        │
│       → 5 Whys = linear, stops early, blames easily.                │
│       → Multi-causal / interaction failures → Swiss cheese, STAMP.  │
│                                                                      │
│  7. What makes an action item land?                                 │
│       → SMART, ticketed in the REAL tracker, owned by a person,     │
│         dated, with a two-week follow-up. Else: theater.            │
│                                                                      │
│  8. Match the dump to the symptom?                                  │
│       → crash→core, OOM→heap, hang(0% CPU)→thread/goroutine,        │
│         hang(100%)→CPU profile. Walk DOWN: crash site = victim.     │
│                                                                      │
│  9. Reconstruct with no dump?                                       │
│       → 1 correlation ID → log timeline → aggregate → trace →       │
│         "what changed." Anchor on causal links, not wall-clock.     │
│                                                                      │
│ 10. How do you know the process worked?                             │
│       → Action-item completion + recurrence rate, not page count.   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Further Reading

- **"Site Reliability Engineering," Ch. 15 — "Postmortem Culture: Learning from Failure"** — Google. The canonical reference for blameless post-mortems. <https://sre.google/sre-book/postmortem-culture/>
- **"The Site Reliability Workbook," Postmortem chapter** — templates and worked examples to complement the SRE book.
- **John Allspaw, "Blameless PostMortems and a Just Culture"** — Etsy Code as Craft. The essay that mainstreamed blameless in tech.
- **Sidney Dekker, "The Field Guide to Understanding 'Human Error'"** — why "human error" is a symptom, not a cause; the "new view."
- **Nancy Leveson, "Engineering a Safer World"** — STAMP/CAST, systems-theoretic accident analysis. Heavy but foundational.
- **Richard Cook, "How Complex Systems Fail"** — a 4-page classic; required reading on why single causes are illusory.
- **James Reason, "Human Error"** — the Swiss-cheese model and latent vs active failures.
- **Public post-mortems to study for structure** — GitLab's 2017 database incident write-up; Cloudflare's incident reports; AWS post-event summaries; the [danluu/post-mortems](https://github.com/danluu/post-mortems) collection.
- **"Debugging with GDB"** — the core-dump and `bt full` chapters, for the forensic side.
- **Eclipse MAT documentation** — heap-dump analysis, dominator trees, Leak Suspects.

---

## Related Topics

- [Post-Mortem Analysis — Junior](junior.md)
- [Post-Mortem Analysis — Middle](middle.md)
- [Post-Mortem Analysis — Senior](senior.md)
- [Post-Mortem Analysis — Professional](professional.md)
- [Post-Mortem Analysis — Tasks](tasks.md)
- [Debugging — Interview](../debugging/interview.md)
- [Logging — Interview](../logging/interview.md)
- [Tracing — README](../tracing/README.md)
- [Crash Reporting — README](../crash-reporting/README.md)
