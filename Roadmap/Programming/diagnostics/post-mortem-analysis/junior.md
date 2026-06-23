# Post-Mortem Analysis — Junior Level

> **Topic:** [Post-Mortem Analysis Roadmap](README.md)
> **Focus:** What a post-mortem is — both senses. Why blameless. The basic incident timeline. The 5 Whys. Reading a crash dump after the fact.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [The Two Senses of "Post-Mortem"](#the-two-senses-of-post-mortem)
8. [Why Blameless](#why-blameless)
9. [Building a Timeline](#building-a-timeline)
10. [The 5 Whys — First Contact](#the-5-whys--first-contact)
11. [Reading a Crash Dump After the Fact](#reading-a-crash-dump-after-the-fact)
12. [Code Examples](#code-examples)
13. [A Minimal Post-Mortem Template](#a-minimal-post-mortem-template)
14. [Pros & Cons](#pros--cons)
15. [Use Cases](#use-cases)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Tricky Points](#tricky-points)
20. [Test Yourself](#test-yourself)
21. [Tricky Questions](#tricky-questions)
22. [Cheat Sheet](#cheat-sheet)
23. [Summary](#summary)
24. [What You Can Build](#what-you-can-build)
25. [Further Reading](#further-reading)
26. [Related Topics](#related-topics)
27. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What is a post-mortem, and what do you do the morning after something broke?**

A *post-mortem* is what you do after the patient is dead. The word is borrowed from medicine — a pathologist opens the body to learn what killed it, not to scold the corpse. In software the word carries **two** meanings, and a junior engineer needs both:

1. **The incident post-mortem** — a written analysis of an outage or failure. *"The payment service was down for 47 minutes; here's what happened, why, and what we'll change so it doesn't happen again."* This is a human and organizational document.
2. **The program post-mortem** — reading the frozen remains of a dead process: a **core dump**, a **crash log**, a **heap dump**. The process is gone, but it left a corpse on disk, and you can examine it. This is a technical activity, the direct sibling of [debugging](../debugging/README.md).

They share a name for a good reason: **both are about learning from a failure that already happened, after it can no longer be observed live.** You can't ask the dead process to run the failing line again. You can't replay the outage. All you have is the evidence it left behind — a stack trace, a timeline of log lines, a memory snapshot, the recollections of the people who were there. The skill is reconstructing the story of death from the remains.

This page teaches the basics of both: what goes in an incident write-up, why it must be *blameless*, how to lay out a timeline, the first root-cause technique (the **5 Whys**), and how to open a core dump in `gdb`/`dlv` and read the line where the program died. The next level (`middle.md`) covers running a useful incident review and forensic log reconstruction. `senior.md` critiques the very idea of a single "root cause."

> 🎓 **Why this matters for a junior:** The failure already cost the company something — downtime, a corrupted record, an angry customer. That cost is *sunk*. The only way to get value back is to **learn** from it. An incident with no post-mortem is a tuition payment with no lesson attended. Your job as a junior is first to read post-mortems well, then to write small ones honestly.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to read a stack trace and reason about an error. See [`../debugging/junior.md`](../debugging/junior.md). If you can't read the corpse's last words, you can't do a post-mortem on it.
- **Required:** Basic command-line comfort — running a binary, reading a file, `grep`.
- **Helpful:** What a *process*, a *crash*, and a *signal* (like `SIGSEGV`) are.
- **Helpful:** Exposure to logging. See [`../logging/junior.md`](../logging/junior.md). Logs are the raw material of a timeline.
- **Helpful:** You've witnessed (or caused) at least one production incident. If not, you will.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Post-mortem (incident)** | A written analysis after an incident: what happened, the impact, the causes, and what to change. |
| **Post-mortem (program)** | Examining a dead process's saved state (core dump, crash log, heap dump) after it has exited. |
| **Incident** | An unplanned event that degrades or breaks a service — an outage, data loss, a security breach. |
| **Outage** | A period when a service is unavailable or seriously degraded. |
| **Core dump / crash dump** | A file containing a process's memory and CPU registers at the moment it crashed. |
| **Stack trace** | The chain of function calls that were active when the program failed. |
| **Timeline** | A time-ordered list of the events of an incident, in UTC. |
| **Root cause** | The underlying condition whose removal would prevent the failure (a contested idea — see `senior.md`). |
| **Trigger** | The proximate event that flipped the system from "fine" to "broken" (e.g. a deploy at 14:02). |
| **Contributing factor** | A condition that made the failure more likely or worse, without being "the" cause. |
| **5 Whys** | Asking "why?" repeatedly to move from a symptom toward a deeper cause. |
| **Blameless** | A post-mortem culture rule: analyze the *system*, never accuse the *person*. |
| **Action item** | A concrete, owned, dated task that comes out of a post-mortem to prevent recurrence. |
| **SEV (severity)** | A label for how bad an incident is — SEV-1 (worst) to SEV-3/4 (minor). |
| **MTTR** | Mean Time To Recovery — how long, on average, from breakage to back-to-normal. |
| **Symbol file** | A file mapping machine addresses back to function names and line numbers, needed to read a dump. |
| **Mitigation** | An action that stops the bleeding (rollback, restart) without necessarily fixing the cause. |

---

## Core Concepts

### 1. A Post-Mortem Is About Learning, Not Punishing

The single most important idea. The purpose is to extract a *lesson the system can keep*, so the next person doesn't fall into the same hole. If the post-mortem turns into "whose fault was it," people stop reporting incidents honestly, and the organization goes blind. **The output of a post-mortem is a changed system, not a named culprit.**

### 2. The Evidence Is Frozen — Collect It Before It Melts

The dead process's state, the logs from the incident window, the dashboard graphs — these are **perishable**. Logs rotate. Metrics age out of the dashboard. A restarted process overwrites its core file. The first reflex when something breaks badly is: *grab the evidence before it's gone.* Take the core dump, screenshot the graph, export the chat. You analyze later; you collect now.

### 3. Symptom Is Not Cause

"The site returned 500 errors" is a symptom. "We ran out of database connections because a code path leaked them" is closer to a cause. A post-mortem that stops at the symptom ("we restarted it and it went away") has not done its job — the cause is still in the system, waiting.

### 4. A Timeline Turns Chaos Into a Story

During an incident, everything is noise: pages firing, people typing in Slack, dashboards flickering. Afterward, you impose order by building a **timeline** — a simple time-sorted list of "at 14:02 X happened, at 14:05 Y happened." The timeline is the backbone of every incident post-mortem. Most of the analysis falls out of getting the timeline right.

### 5. The Dead Process Still Has a Last Known State

When a program crashes, it doesn't vanish — if you've enabled core dumps, the OS writes its memory to disk. That file is a **frozen snapshot** of the exact moment of death: which line, which variables, which thread. Reading it is "program post-mortem debugging." You're not running the program; you're examining its corpse in a debugger.

---

## Real-World Analogies

| Concept | Real-World Analogy |
|---|---|
| **Incident post-mortem** | An aviation accident investigation (NTSB) — reconstruct what happened to prevent the next crash, not to blame the pilot. |
| **Program post-mortem (core dump)** | A coroner's autopsy — open the body, find the fatal wound, read what the tissues say. |
| **Timeline** | A black-box flight recorder transcript, replayed event by event. |
| **5 Whys** | A toddler who keeps asking "but why?" until you hit bedrock. |
| **Blameless culture** | A "no-fault" reporting system in hospitals — nurses report near-misses because they won't be punished, so the hospital learns. |
| **Trigger vs root cause** | The match (trigger) vs the dry, un-cleared brush (root cause) — the match didn't burn the forest; the fuel did. |
| **Contributing factor** | The wet road *and* the bald tires *and* the speeding — no single one caused the crash; together they did. |
| **Symbol file** | The decoder ring for a coded message — without it the dump is gibberish addresses. |
| **Collecting evidence first** | A crime-scene photographer shoots before anyone moves the furniture. |

---

## Mental Models

### 1. The Corpse Tells the Story

Whether the "corpse" is a crashed process or a dead service, the discipline is the same: you cannot interrogate it live, so you read what it left behind. A pathologist reads tissue; you read a stack trace, a timeline, a memory snapshot. **The post-mortem mindset is reconstruction from static evidence**, in contrast to live debugging, where you can poke the running system.

### 2. Two Clocks, One Goal

The incident post-mortem runs on the **wall clock** — events at 14:02, 14:05, 14:30. The program post-mortem runs on the **program counter** — line 88, frame 3, the third iteration. Different clocks, same goal: *find the first place where reality diverged from what should have happened, and work out why.*

### 3. The Failure Already Happened — Now Buy the Lesson

Reframe the cost. The outage is paid for. The crash already happened. The post-mortem is your one chance to convert that sunk cost into a permanent improvement. A junior who internalizes this stops seeing post-mortems as paperwork and starts seeing them as the cheapest insurance the team will ever buy.

---

## The Two Senses of "Post-Mortem"

Because this topic lives in *diagnostics*, you must hold both meanings at once. Here's how they line up.

| Dimension | Incident Post-Mortem | Program Post-Mortem |
|---|---|---|
| **What died** | A service / a feature / a business process | A single process |
| **The corpse** | The incident's logs, metrics, chat, deploys | A core dump / crash log / heap dump |
| **Main artifact** | A written document | A debugger session over a dump file |
| **Main question** | "Why did the system fail, and how do we prevent it?" | "Why did this process crash, and on which line?" |
| **Main technique** | Timeline + 5 Whys + action items | `gdb`/`dlv` over the dump, read the stack |
| **Output** | Action items the org acts on | A bug fix + (often) a regression test |
| **Audience** | The whole org, future engineers | You and the code's maintainers |

They meet constantly. A core dump is often *the key piece of evidence* in an incident post-mortem: *"the process crashed; here's the dump; the stack shows a nil-pointer dereference in the refund path."* Live debugging is covered in [`../debugging/`](../debugging/README.md); automated capture of crashes (the thing that *produces* the dump) is [crash-reporting](../crash-reporting/README.md); the request-flow forensics side is [tracing](../tracing/README.md).

---

## Why Blameless

This deserves its own section because it is the load-bearing idea of incident post-mortems, and the one juniors most often misunderstand.

**The cardinal rule:** *Given what they knew at the time, the people involved acted reasonably.* If that turns out not to be true, the question is not "why were they careless?" but "why did the system let a reasonable person make that mistake?" — which is a system problem (bad docs, no guardrails, a confusing UI), not a character flaw.

Why this is not just being nice:

- **Honesty depends on safety.** The moment one engineer is named-and-shamed in a post-mortem, *everyone* learns the lesson "hide your mistakes." The next incident gets quietly swept under the rug, and the organization loses the data it needs to improve. Blameless is not a feel-good policy; it is a *survival strategy for the learning loop*.
- **People are rarely the cause.** Humans make mistakes constantly. A system that goes down because one human made one ordinary mistake is a *fragile system*. The interesting question is always "why was a single human error enough to cause an outage?"
- **It changes what you fix.** Blame leads to "be more careful" (which fixes nothing). Blamelessness leads to "add a confirmation step / a canary / a lint rule / better docs" (which fixes the class of problem).

How a sentence drifts from blameless to blameful:

| Phrasing | Verdict |
|---|---|
| "The deploy at 14:02 introduced the change." | ✅ Blameless — describes the event. |
| "Alice deployed the change at 14:02." | ⚠️ Drifting — names a person unnecessarily. |
| "Alice deployed it without running the canary." | ⚠️ Leaning toward blame. |
| "Alice should have known the canary was required." | ❌ Blameful — accuses. |
| "The deploy pipeline did not enforce a canary step; this was not visible to the deploying engineer." | ✅ Blameless — fixes the system. |

> **Junior takeaway:** When you write a post-mortem, do a find-and-replace in your head: every time you've written a person's name as the *cause* of something, rewrite the sentence to describe the *system* that allowed it.

---

## Building a Timeline

The timeline is the skeleton of an incident post-mortem. Get it right and the analysis writes itself.

Rules a junior should follow:

1. **Use UTC.** Always. Time zones in a timeline cause hours of confusion when people are in different regions. Write `14:02 UTC`.
2. **One line per event.** "14:02 — deploy of checkout v2.317 completed." Terse, factual.
3. **Include both the failures and the responses.** When the alert fired, when a human ack'd, when the rollback started, when recovery completed.
4. **Source every entry.** Where did "14:02" come from — the deploy bot, a log line, the chat? A timeline built from memory is a fiction.
5. **Mark detection and recovery clearly.** Two numbers fall out: *time to detect* (incident start → someone noticed) and *time to recover* (start → back to normal, your MTTR for this one).

A worked micro-timeline:

```text
13:58 UTC  Cache TTL config change merged (PR #4412).
14:02 UTC  Deploy of checkout-service v2.317 completes in us-east-1.
14:11 UTC  Background catalog refresh fires; all caches invalidated at once.
14:12 UTC  ALERT: checkout error rate > 5% for 1 min. Page sent to on-call.
14:13 UTC  On-call acknowledges; opens incident channel.        ← detected (~1 min)
14:14 UTC  Hypothesis: the 14:02 deploy is the trigger.
14:15 UTC  Rollback to v2.316 started.
14:18 UTC  Rollback complete; error rate drops to baseline.      ← recovered (MTTR ~6 min)
14:20 UTC  Incident downgraded; diagnosis continues.
```

From this skeleton, the impact line ("checkout errors elevated 14:11–14:18, ~6 minutes"), the trigger, and the first hypothesis are all obvious. **The timeline did most of the work.**

---

## The 5 Whys — First Contact

The 5 Whys is the entry-level root-cause technique. You ask "why did that happen?" of each answer, peeling layers until you reach something you can actually change.

> **Worked example.**
>
> 1. **Why did checkout error out?** Because it couldn't reach the pricing service.
> 2. **Why couldn't it reach pricing?** Because pricing's connection pool was exhausted.
> 3. **Why was the pool exhausted?** Because 1,200 requests hit it simultaneously when every cache entry expired at once.
> 4. **Why did every entry expire at once?** Because the new 300s TTL meant the periodic invalidate cleared a full cache instead of a sparse one.
> 5. **Why did a full-cache clear cause a stampede?** Because the cache has no request coalescing (no "singleflight") to collapse simultaneous misses.
>
> **The change you can make:** add request coalescing to the cache, and/or jitter the TTLs. *That* is a fix. "We'll be more careful with TTLs" is not.

Two cautions even at junior level (developed fully in `senior.md`):

- **"Five" is not magic.** Stop at the deepest cause you have the *agency to change*. Sometimes that's why #3; sometimes it's why #7. Going further lands you in philosophy ("why did we build a monolith?").
- **It can become a witch hunt.** Ask "why" of the *system*, never the *person*. "Why did the author not use the shared helper?" → "Because the helper is undocumented and the linter doesn't flag the raw call" — a system answer. Not "because the author was sloppy."

---

## Reading a Crash Dump After the Fact

Now the program-post-mortem side. When a native program crashes, the OS can write a **core dump** — a file containing its memory and registers at the moment of death. You open it in a debugger and read the crime scene.

### Step 0 — Make sure dumps are even enabled

By default many systems suppress core dumps. Turn them on in your shell:

```bash
ulimit -c unlimited      # allow unlimited-size core files in this shell
# Where does the kernel write them? Look here:
cat /proc/sys/kernel/core_pattern
```

If the pattern points at `systemd-coredump` (common on modern Linux), dumps go into the journal:

```bash
coredumpctl list                 # recent crashes the system captured
coredumpctl info  <pid|exe>      # metadata: signal, command line, timestamp
coredumpctl gdb   <pid|exe>      # open the latest matching dump in gdb directly
```

### Step 1 — Open the dump and read the stack

For a C/C++ program:

```bash
gdb ./myprog ./core            # binary + core file
(gdb) bt                       # backtrace: the stack at the crash point
(gdb) frame 2                  # move to frame 2
(gdb) print myStruct           # inspect a variable's frozen value
(gdb) info registers           # CPU registers at death
```

For a Go program (build with debug info, set `GOTRACEBACK=crash` so it dumps on panic):

```bash
dlv core ./myprog ./core
(dlv) bt                       # stack of the crashing goroutine
(dlv) goroutines               # all goroutines (huge in concurrent code)
(dlv) print myVar
```

The top of the stack is where the program died. Read **down** the stack (older frames) to see who called this and with what arguments. Just like a live stack trace — except the program will never run again, so this snapshot is all you get. **Collect it carefully; you can't take another.**

### Step 2 — A dump without symbols is half-useless

If the backtrace looks like this, you're missing **symbol files**:

```text
#0  0x0000000000401a3f in ?? ()
#1  0x0000000000402b81 in ?? ()
```

Those `?? ()` are functions whose names were *stripped* from the production binary. To read the dump you need the **unstripped binary** (or its separate debug-symbol file) from the *same build*. Keep it. A stripped binary plus a core dump is fingerprinting a ghost. (More in `middle.md` and `senior.md`; the dedicated topic is [symbolication](../debugging/middle.md).)

---

## Code Examples

### Make a program crash and read its corpse (C)

```c
// crash.c — dereference a null pointer on purpose
#include <stdio.h>

int deref(int *p) {
    return *p;            // SIGSEGV when p == NULL
}

int main(void) {
    int *p = NULL;
    printf("about to crash\n");
    return deref(p);      // crash here
}
```

```bash
$ gcc -g -O0 crash.c -o crash      # -g keeps symbols, -O0 keeps lines honest
$ ulimit -c unlimited
$ ./crash
about to crash
Segmentation fault (core dumped)

$ gdb ./crash ./core
(gdb) bt
#0  deref (p=0x0) at crash.c:5
#1  main ()       at crash.c:11
#  ^ p was NULL at line 5. The bug is one frame up at line 11, where p = NULL.
```

The dump told us *exactly* where and *why*: `p=0x0` at `crash.c:5`. The cause is in `main` at line 11. That is a complete program post-mortem.

### Trigger a crash dump on a Go panic

```go
// crash.go — index out of range, with crash-style traceback
package main

func boom(s []int) int { return s[5] } // panic: index out of range

func main() {
    boom([]int{1, 2, 3})
}
```

```bash
$ GOTRACEBACK=crash go run crash.go
panic: runtime error: index out of range [5] with length 3

goroutine 1 [running]:
main.boom(...)
	/app/crash.go:3            ← where it died
main.main()
	/app/crash.go:6 +0x18      ← who called it
exit status 2
```

Even without opening a core file, the *crash log* is itself a post-mortem artifact: it preserves the exact stack at the moment of death. Read it top-down (Go style): the panic, then the innermost frame, then the caller.

### Python — `faulthandler` dumps the stack on a fatal crash

```python
import faulthandler
faulthandler.enable()    # on segfault / fatal signal, print all thread stacks
# ... your program ...
```

When a Python process dies from a C-level fault, `faulthandler` writes every thread's Python stack to stderr — the post-mortem record for a crash that would otherwise leave no traceback.

---

## A Minimal Post-Mortem Template

You don't need the full Google SRE template yet (that's in `professional.md`). For your first incident write-ups, fill in this:

```markdown
# Post-Mortem: <short title>            (date, in UTC)

## Summary
One paragraph: what broke, for how long, who was affected.

## Impact
Quantified. "X% of users could not check out for 6 minutes."

## Timeline (UTC)
- 14:02 — ...
- 14:12 — ALERT ...
- 14:18 — recovered

## What happened (the causes)
Plain-English story of the failure. Trigger + contributing factors.

## 5 Whys
1. Why ...? Because ...
   ... down to a cause we can change.

## Action items
- [ ] <concrete, owned, dated task>   (owner: role, due: date)

## What went well / what we got lucky on
Honest notes for next time.
```

Keep it short. A post-mortem nobody reads is wasted work. One to two pages at this level is plenty.

---

## Pros & Cons

| Practice | Pros | Cons |
|---|---|---|
| **Writing an incident post-mortem** | Converts a costly failure into a durable lesson; spreads knowledge | Takes engineer-hours; worthless if action items aren't done |
| **Blameless framing** | Keeps reporting honest; fixes systems not people | Requires real cultural buy-in or it's theater |
| **Building a timeline** | Turns chaos into a clear story; surfaces detection/recovery gaps | Tedious; needs good logs and preserved chat |
| **5 Whys** | Cheap, fast, moves past the symptom | Easy to over-philosophize or weaponize into blame |
| **Reading a core dump** | Exact frozen state at death; works when you can't reproduce | Needs symbols; dumps are large; can contain secrets |
| **Crash logs (Go panic, Java hs_err)** | Free, automatic, no extra tooling | Less detail than a full core dump |

---

## Use Cases

| Situation | What you reach for |
|---|---|
| A service was down and is now back; the team wants to learn. | Incident post-mortem: timeline + 5 Whys + action items. |
| A native binary crashed in prod and you have a core file. | `gdb ./bin ./core` → `bt`. |
| A Go service panicked. | Read the crash log; or `dlv core` if a dump was written. |
| A Python process died from a C-extension segfault. | `faulthandler` stack, or the core dump. |
| You can't reproduce the crash locally but you have the dump. | Program post-mortem — the dump *is* the repro. |
| Same outage keeps recurring. | A post-mortem whose action items actually get done. |

---

## Best Practices

1. **Collect evidence before you clean up.** Take the core dump, screenshot the graph, export the chat — *then* restart and recover.
2. **Write the timeline in UTC, sourced from logs, not memory.**
3. **Keep it blameless.** Describe the system, never accuse the person.
4. **Stop the 5 Whys at the deepest cause you can change** — not at the symptom, not in philosophy.
5. **Every post-mortem ends with action items** that are concrete, owned, and dated. No action items = no learning.
6. **Keep your binaries and symbol files** from every release, so a future core dump is readable.
7. **Enable core dumps** (`ulimit -c unlimited` / systemd `LimitCORE`) on services where post-mortem matters.
8. **Read other people's post-mortems.** It's the cheapest way to learn the shapes of failure.

---

## Edge Cases & Pitfalls

- **A restarted process overwrites or loses its core file.** Capture the dump *before* the orchestrator restarts the pod.
- **Stripped production binaries** make a dump unreadable. Keep the unstripped build artifact.
- **Core dumps contain memory** — passwords, tokens, customer data. Treat them as sensitive: store encrypted, delete after use.
- **Optimized builds (`-O2`)** inline functions and reorder code, so the dump's line numbers can mislead. A debug build (`-O0 -g`) is honest but may not reproduce the bug.
- **Time-zone soup in the timeline.** Mixing local times across regions produces "impossible" orderings. UTC only.
- **A post-mortem written from memory** invents a timeline that never happened. Source every line.
- **`coredumpctl` only has what `systemd-coredump` captured** — and the kernel may have truncated huge dumps.

---

## Common Mistakes

1. **Stopping at the symptom.** "We restarted it and it's fine" is not a post-mortem; the cause is still in the system.
2. **Naming a person as the cause.** The fastest way to make your team hide future incidents.
3. **No action items**, or action items so vague ("improve monitoring") that nobody can do them.
4. **Action items written but never tracked**, so they silently rot and the incident recurs.
5. **Throwing away the core dump** before anyone has read it.
6. **Trying to read a stripped binary's dump** and concluding "the dump is useless" — it's the *symbols* that are missing, not the dump.
7. **Treating the trigger as the root cause.** "We deployed at lunchtime" — banning lunchtime deploys fixes nothing.
8. **Writing a 12-page post-mortem nobody reads.** Length is not depth.
9. **Forgetting UTC** in the timeline.
10. **Doing the post-mortem only for huge outages.** Small incidents and near-misses teach cheaply too.

---

## Tricky Points

1. **The two senses share a name but not a method.** Incident post-mortems are mostly *human and written*; program post-mortems are mostly *technical and tooled*. Don't let a reviewer who wanted one hand you the other.
2. **The core dump shows where it *died*, not always where the *bug* is.** The crash site is often a victim; the bug is a few frames up where bad data was created.
3. **A crash log and a core dump are different.** A crash log (Go panic text, Java `hs_err_pid.log`) is a human-readable summary; a core dump is the full binary memory image. The dump has more, but needs more to read.
4. **"Blameless" does not mean "no accountability."** The team still owns fixing the system; it means we don't punish individuals for honest mistakes.
5. **The first "why" answer feels like the cause but rarely is.** "It ran out of connections" feels complete. Keep going.
6. **Detection time matters as much as recovery time.** An incident the team didn't notice until a customer reported it has a *detection* problem worth its own action item.

---

## Test Yourself

1. Explain, in two sentences each, the *incident* sense and the *program* sense of "post-mortem." What do they share?
2. Take a one-paragraph incident description and write a UTC timeline with at least five entries, marking detection and recovery.
3. Rewrite this blameful sentence to be blameless: *"Sam pushed the bad migration that took down the database."*
4. Write a 5 Whys chain for a bug you actually fixed recently. Did you stop at a cause you could change?
5. Cause a native program to segfault on purpose, enable core dumps, and open the core in `gdb`. Report the crashing line and the variable that was bad.
6. Build a Go program that panics with `GOTRACEBACK=crash`. Read its crash log and identify the innermost frame vs the caller.
7. Take a post-mortem you can find online (many are public — Cloudflare, GitLab, AWS). Identify its timeline, its trigger, its root cause(s), and its action items.

---

## Tricky Questions

**Q1: Why is a post-mortem called "blameless" if a person really did make the mistake?**

Because the *goal* is a system that doesn't break when a person makes an ordinary mistake. People will always make mistakes; that's a constant. The interesting, fixable variable is "why was one human error enough to cause an outage?" Blaming the person fixes nothing and teaches everyone to hide errors; fixing the system prevents the whole class.

**Q2: The process crashed and you have the core dump, but `bt` shows `?? ()` for every frame. Is the dump corrupt?**

Almost certainly not. The frames are unreadable because the production binary was *stripped* of symbols. Get the matching unstripped binary (or separate debug-symbol file) from the same build, point the debugger at it, and the names appear.

**Q3: What's the difference between the trigger and the root cause?**

The trigger is the proximate event that flipped the system to broken (a deploy, a traffic spike). The root cause is the latent condition that made that trigger *catastrophic* instead of harmless (no canary, a missing index, no backpressure). Fixing only the trigger ("we won't deploy at lunch") leaves the hole open for the next trigger.

**Q4: You stopped the 5 Whys at "the engineer didn't know the helper existed." Is that the root cause?**

Not quite — that's still a person-shaped answer. One more why: *why didn't they know?* "Because the helper is undocumented and the linter doesn't flag the raw alternative." Now you have a system fix (docs + lint rule). Stop when the cause is systemic *and* changeable.

**Q5: Should you write a post-mortem for an incident that lasted 90 seconds and nobody noticed?**

Often yes — a *near-miss* is a free lesson. The fact that it self-recovered or went unnoticed may itself be the most interesting finding (why didn't we detect it?). Cheap incidents teach cheaply; spend a paragraph, not a day.

**Q6: A core dump might contain a customer's password in memory. Can you just attach it to the ticket?**

No. Dumps are raw memory and routinely contain secrets and PII. Store them in a restricted, encrypted location, share access narrowly, and delete them after the investigation. Treat a core dump like a copy of the production database.

---

## Cheat Sheet

```text
┌──────────────────────── POST-MORTEM ANALYSIS — JUNIOR CHEAT SHEET ───────────────────────┐
│                                                                                          │
│  TWO SENSES                                                                              │
│    Incident post-mortem → written analysis of an outage (human/org)                      │
│    Program post-mortem  → reading a core dump / crash log (technical)                     │
│    Shared: learn from a failure AFTER it can no longer be observed live.                  │
│                                                                                          │
│  BLAMELESS RULE                                                                          │
│    "Given what they knew, they acted reasonably."                                         │
│    Describe the SYSTEM, never accuse the PERSON.                                          │
│                                                                                          │
│  INCIDENT WRITE-UP SKELETON                                                              │
│    Summary · Impact · Timeline(UTC) · Causes · 5 Whys · Action items                      │
│                                                                                          │
│  TIMELINE RULES                                                                          │
│    UTC · one line per event · source every entry · mark DETECT + RECOVER                  │
│                                                                                          │
│  5 WHYS                                                                                  │
│    Ask "why?" of each answer. Stop at a cause you can CHANGE.                             │
│    Ask why of the SYSTEM, not the PERSON.                                                 │
│                                                                                          │
│  READ A CORE DUMP                                                                        │
│    enable:  ulimit -c unlimited   (or systemd-coredump → coredumpctl)                     │
│    C/C++:   gdb ./bin ./core   →  bt   frame N   print x                                  │
│    Go:      GOTRACEBACK=crash  →  dlv core ./bin ./core  →  bt goroutines                 │
│    Python:  faulthandler.enable()                                                        │
│    ?? () in backtrace  →  missing SYMBOL FILE, not a corrupt dump                         │
│                                                                                          │
│  GOLDEN RULES                                                                            │
│    • Collect evidence BEFORE you restart.                                                 │
│    • Symptom ≠ cause.   Trigger ≠ root cause.                                             │
│    • No action items = no learning.                                                       │
│    • Dumps contain secrets — handle like prod data.                                       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **post-mortem** has two senses, both about learning from a failure that already happened: the **incident** write-up (human/org) and the **program** dump (technical). They share a name because both reconstruct death from frozen evidence.
- **Blameless is the load-bearing rule** of incident post-mortems: describe the system, never accuse the person — because honesty depends on safety, and people are rarely the real cause.
- The **timeline** (UTC, one line per event, sourced) is the skeleton of an incident post-mortem; detection time and recovery time fall out of it.
- The **5 Whys** moves you from symptom toward a cause you can change — but "five" is not magic, and you ask *why of the system*, never the person.
- **Symptom ≠ cause; trigger ≠ root cause.** Stopping at the symptom leaves the bug in place.
- Reading a **core dump** (`gdb ./bin ./core` → `bt`, or `dlv core`, or Python `faulthandler`) shows the exact frozen state at death — but only if you have **symbol files**.
- **Collect evidence before you restart.** Dumps and logs are perishable.
- **Dumps contain secrets** — handle them like a copy of production data.
- Every post-mortem ends with **concrete, owned, dated action items**, or it was wasted work.

---

## What You Can Build

- A **post-mortem template** repo (Markdown) your team can copy per incident, pre-filled with the skeleton above.
- A **deliberately-crashing toy program** in C, Go, and Python that segfaults/panics on demand, plus a short guide to reading each one's dump — a personal core-dump practice lab.
- A **timeline builder** script: feed it log lines with timestamps, get back a sorted UTC timeline ready to paste into a post-mortem.
- A **"blameless rewriter" checklist**: a short list of phrasings to find-and-replace (names → systems) before publishing a post-mortem.
- A **core-dump enablement runbook** for your service: the exact `ulimit` / `core_pattern` / `coredumpctl` steps so dumps are ready before you need them.

---

## Further Reading

- **Books**
  - *Site Reliability Engineering* (the "Google SRE book"), Ch. 15 "Postmortem Culture" — the canonical reference. <https://sre.google/sre-book/postmortem-culture/>
  - *The Linux Programming Interface* — Michael Kerrisk, on signals and core dumps.
  - *Debugging with GDB* — the official manual (the core-dump chapters).
- **Articles**
  - John Allspaw, "Blameless PostMortems and a Just Culture" (Etsy Code as Craft). The origin of blameless culture in software.
  - Google SRE Workbook, "Postmortem Culture: Learning from Failure."
  - Public post-mortems to study: the GitLab 2017 database-deletion post-mortem; Cloudflare and AWS public incident reports.
- **Tool docs**
  - `coredumpctl` — `man coredumpctl`.
  - Go `runtime` / `GOTRACEBACK` — <https://pkg.go.dev/runtime>.
  - Python `faulthandler` — <https://docs.python.org/3/library/faulthandler.html>.

---

## Related Topics

- **Next level up:** [middle.md](middle.md) — running a useful incident review, writing the document, forensic log/trace reconstruction, a full core-dump walkthrough.
- **Senior level:** [senior.md](senior.md) — the "root cause" critique, systems thinking (Swiss cheese, STAMP), action-item follow-through.
- **Professional level:** [professional.md](professional.md) — org-wide learning-from-incidents, near-miss analysis, large-scale forensic reconstruction.
- **Interview prep:** [interview.md](interview.md) — post-mortem questions you'll be asked.
- **Practice:** [tasks.md](tasks.md) — hands-on labs, including a sample incident and a core-dump forensic lab.

**Sibling diagnostic topics:**

- [Debugging — Junior](../debugging/junior.md) — reading stack traces; the live counterpart to program post-mortems.
- [Crash Reporting](../crash-reporting/README.md) — automated capture of the crashes you later analyze.
- [Tracing](../tracing/README.md) — request-flow forensics that feed incident timelines.
- [Logging — Junior](../logging/junior.md) — logs are the raw material of a timeline.
