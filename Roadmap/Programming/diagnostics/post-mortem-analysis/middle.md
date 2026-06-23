# Post-Mortem Analysis — Middle Level

> **Topic:** [Post-Mortem Analysis Roadmap](README.md)
> **Focus:** Running a useful incident review. Writing the document that changes the org. Contributing factors vs root cause. Forensic log/trace reconstruction. A full core-dump walkthrough across C, Go, Java, and Python.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Running a Useful Incident Review](#running-a-useful-incident-review)
8. [Writing the Document](#writing-the-document)
9. [Contributing Factors vs Root Cause](#contributing-factors-vs-root-cause)
10. [SEV Levels and Why They Matter](#sev-levels-and-why-they-matter)
11. [Forensic Reconstruction From Logs and Traces](#forensic-reconstruction-from-logs-and-traces)
12. [A Full Core-Dump Walkthrough](#a-full-core-dump-walkthrough)
13. [Heap, Thread, and Goroutine Dumps](#heap-thread-and-goroutine-dumps)
14. [Action Items That Actually Get Done](#action-items-that-actually-get-done)
15. [Code Examples](#code-examples)
16. [A Worked Incident Post-Mortem](#a-worked-incident-post-mortem)
17. [Pros & Cons](#pros--cons)
18. [Use Cases](#use-cases)
19. [Coding Patterns](#coding-patterns)
20. [Clean Code](#clean-code)
21. [Best Practices](#best-practices)
22. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
23. [Common Mistakes](#common-mistakes)
24. [Tricky Points](#tricky-points)
25. [Test Yourself](#test-yourself)
26. [Tricky Questions](#tricky-questions)
27. [Cheat Sheet](#cheat-sheet)
28. [Summary](#summary)
29. [What You Can Build](#what-you-can-build)
30. [Further Reading](#further-reading)
31. [Related Topics](#related-topics)
32. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **Stop writing post-mortems that nobody reads and nobody acts on. Reconstruct the failure precisely, from real evidence.**

At junior level you learned what a post-mortem is in both senses, why blameless matters, how to lay out a timeline, the 5 Whys, and how to open a core dump and read the crashing line. That's enough to fill in a template after a small incident, or to find which line a toy program died on.

The middle-level jump is two-fold. On the **incident** side, you stop treating the post-mortem as a form to fill in and start treating it as an *investigation that must converge on evidence and produce change*. You learn to run the review meeting without it turning into blame or rambling, to write contributing factors instead of pretending there's a single root cause, to assign SEV levels that drive the right response, and — the part teams most often get wrong — to write action items that *actually get done* rather than rot in a doc.

On the **program** side, you go from "read the top of the stack" to **forensic reconstruction**: walking every frame of a core dump, inspecting structures, reading a *heap* dump to explain an OOM, a *thread/goroutine* dump to explain a hang. And critically, you learn to fuse the two — to reconstruct an incident's last-known state from logs + traces + a dump together, because that's what a real production post-mortem looks like.

> 🎓 **Why this matters at middle level:** The senior engineers on your team are not the ones who write the longest post-mortems. They're the ones whose post-mortems *change something* — an action item that lands, a class of bug that never recurs. The artifact is judged by its effect on the future, not its thoroughness about the past.

---

## Prerequisites

What you should already have:

- **Required:** All of [`junior.md`](junior.md) — the two senses, blameless, timelines, 5 Whys, opening a core dump.
- **Required:** Middle-level debugging: reading core dumps, thread/goroutine dumps, conditional breakpoints. See [`../debugging/middle.md`](../debugging/middle.md).
- **Required:** You can write and query structured logs with correlation IDs. See [`../logging/middle.md`](../logging/middle.md).
- **Helpful:** Exposure to distributed tracing (spans, trace IDs). See [`../tracing/README.md`](../tracing/README.md).
- **Helpful:** You've been on-call, or shadowed someone who was.
- **Helpful:** Familiarity with one observability stack (Grafana/Loki/Tempo, Datadog, Honeycomb).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Incident review** | The meeting (or async equivalent) where a team reconstructs and learns from an incident. |
| **Contributing factor** | A condition that made the failure more likely or more severe, without solely "causing" it. |
| **Root cause** | The deepest changeable condition behind a failure (a useful fiction; critiqued in `senior.md`). |
| **Causal chain** | The ordered sequence of events/conditions from latent bug to user-visible impact. |
| **SEV level** | Severity classification (SEV-1 worst → SEV-3/4 minor) that drives response and escalation. |
| **MTTD / MTTR** | Mean Time To Detect / Recover — the two headline incident-duration metrics. |
| **Forensic reconstruction** | Rebuilding what happened from preserved evidence (logs, traces, dumps) after the fact. |
| **Correlation / trace ID** | A unique ID propagated through a request, letting you stitch its log lines and spans together. |
| **Core dump** | Full process memory + registers at crash time. |
| **Heap dump** | A snapshot of the objects on the heap (Java `.hprof`, Go `WriteHeapDump`, .NET `.dmp`). |
| **Thread / goroutine dump** | A snapshot of every thread's / goroutine's stack at a moment (for hangs and deadlocks). |
| **`hs_err_pid.log`** | The JVM's fatal-error log written when the VM itself crashes. |
| **Dominator tree** | A heap-analysis structure showing which object subgraph retains the most memory. |
| **Action item** | A SMART, owned, dated task in the team's tracker that prevents recurrence. |
| **Blast radius** | The scope of who/what an incident affected. |
| **Toil** | Repetitive manual operational work; a recurring post-mortem theme. |

---

## Core Concepts

### 1. The Document Is for the Future, Not the Past

A post-mortem is not a confession or a record-for-its-own-sake. It is a message to a future engineer — possibly on another team, possibly years later — who is about to make the same mistake. Write so *that* person, with no context, learns what they need in two pages.

### 2. Evidence Beats Recollection

Memory is a liar under stress. The timeline you remember and the timeline the logs show diverge constantly. Build the post-mortem from artifacts: log queries, trace waterfalls, deploy records, the chat export, the dump. When a claim in the doc isn't backed by an artifact, flag it as a guess.

### 3. There Is Rarely One Cause

A single-root-cause outage is the exception. The norm: a latent bug from six months ago, a config change last week, a traffic pattern that arrived today, and a missing alert that should have caught it sooner. The honest write-up lists **contributing factors**, not "the" cause. (Senior level pushes this further into systems thinking.)

### 4. A Dump Is a Frozen Crime Scene You Can Re-Walk

Unlike a live process, a core/heap/thread dump doesn't change while you study it. That's a gift: you can take your time, re-open it, hand it to a colleague, compare two dumps. Forensic patience is the middle-level skill — walk *every* frame, read *every* relevant structure, don't stop at the top of the stack.

### 5. Action Items Are the Only Output That Matters

Everything else in the post-mortem — timeline, causes, lessons — exists to justify the action items. An incident with a beautiful write-up and zero completed action items has taught the org nothing. The review's real product is a short list of changes that *land*.

---

## Real-World Analogies

| Concept | Analogy |
|---|---|
| Incident review meeting | A flight-crew debrief after a near-miss — structured, blameless, focused on procedures. |
| Contributing factors | The Swiss-cheese slices that lined up — wet road *and* bald tires *and* fatigue. |
| Forensic log reconstruction | A detective reassembling a night from CCTV timestamps, receipts, and phone records. |
| Trace ID correlation | A case number written on every document in a file, so they can be pulled together. |
| Core-dump walkthrough | A coroner working *down* through layers of tissue, not stopping at the skin wound. |
| Heap dump + dominator tree | An accountant finding which one account holds 89% of the missing money. |
| Thread/goroutine dump | A traffic-jam aerial photo — see who's blocked waiting for whom. |
| SEV levels | Hospital triage tags — red/yellow/green decide who gets the team first. |
| Action item rot | New Year's resolutions written and never tracked. |

---

## Mental Models

### Model 1: Two Reconstructions, One Investigation

Every serious incident post-mortem is really *two* reconstructions running in parallel: the **wall-clock reconstruction** (the timeline of human + system events) and the **state reconstruction** (what the failing process believed and held at the moment of death, from its dump/logs). The best post-mortems weld them: *"at 14:11 the cache cleared (timeline); the goroutine dump taken at 14:14 shows 47k goroutines blocked on the pricing channel (state); together they explain the stampede."*

### Model 2: Walk Down, Not Just Look At

A junior reads the *top* of a stack. A middle engineer walks *down* it, frame by frame, asking at each one: *what did this function believe its inputs were, and where did that belief come from?* The crash site is usually a victim. The bug is where a wrong value was *born*, several frames earlier. The same applies to causes: the trigger is the top of the chain; walk down to the conditions that made it lethal.

### Model 3: The Post-Mortem Is a Funnel

It starts wide — *everything that happened* — and must narrow to a few sharp action items. If your post-mortem ends as wide as it started ("lots of things went wrong, we should all be more careful"), it failed. The funnel shape — broad evidence at the top, narrow committed changes at the bottom — is the quality signal.

---

## Running a Useful Incident Review

The review is the meeting (or structured async doc) where the team reconstructs the incident together. Done well, it's the highest-leverage hour after an outage. Done badly, it's a blame session people dread.

### Before the meeting

- **Assign a single author** to draft the timeline and the first causal story *before* the meeting. Walking in cold produces chaos.
- **Preserve evidence.** Export the incident chat, save the dashboards (screenshot or permalink with a frozen time range), grab the dumps. Dashboards age out; do this within hours.
- **Set the ground rule out loud:** blameless. Say it at the top, every time, until it's culture.

### During the meeting

1. **Walk the timeline together.** People who were there correct and enrich it. This is where memory and logs reconcile.
2. **Separate trigger from contributing factors.** Resist the room's urge to name "the" cause.
3. **Run the causal analysis** (5 Whys, or a fuller method from `senior.md`) on the *system*, never the person.
4. **Capture "what went well" and "where we got lucky"** — honestly. The luck is often the scariest finding.
5. **Draft action items live**, each with a candidate owner and a rough date. Refine after, but don't leave the room with a vague "we should improve monitoring."

### Anti-patterns to kill on sight

- **The interrogation.** "Why did *you* do X?" — redirect to "why did the system allow X?"
- **The ramble.** No timeline prepared, so the hour evaporates re-litigating who said what in Slack.
- **The hero narrative.** "Luckily Priya knew the magic command." That's a *finding* (the system needed a hero), not a happy ending — turn it into an action item (runbook it).
- **The vague-resolution close.** Ending with sentiments instead of tickets.

### Async-first reviews

For distributed teams, the review is often a shared doc: the author drafts, everyone comments for 48 hours, then a short call resolves disagreements. Same rules — blameless, evidence-backed, action-item-producing.

---

## Writing the Document

The write-up is what survives the meeting. Structure beats prose. A solid middle-level template:

```markdown
# Post-Mortem: <title>            SEV-<n>   <date, UTC>
Status: Draft | In Review | Final
Author: <role>    Reviewers: <roles>

## Summary
One paragraph. What broke, for how long, blast radius, resolution.

## Impact
Quantified: % of users / requests, duration, $ if known, data integrity.

## Detection
How did we find out — alert / human / customer? Time to detect.

## Timeline (UTC)
- HH:MM — event (source)
- ...

## Root cause & contributing factors
- Trigger: ...
- Contributing factors:
  1. ...
  2. ...

## Causal analysis (5 Whys or equivalent)
1. Why ...? Because ...
...

## Resolution & recovery
What stopped the bleeding (mitigation) and what restored normal (fix).

## Action items
| ID | Action | Owner | Due | Status |
|----|--------|-------|-----|--------|
| AI-1 | ... | role | date | open |

## What went well / what went poorly / where we got lucky

## Appendix
Links: dashboards, traces, the dump, the deploy diff.
```

Writing discipline:

- **Quantify the impact.** "Some users were affected" is useless. "12% of EU checkout requests failed for 6 minutes" is actionable.
- **Causes are plural.** Use the contributing-factors list; don't force a single root cause.
- **Link, don't paste.** Reference the trace, the dashboard time-range, the dump location.
- **Two to four pages.** Longer means unread; shorter means under-investigated.
- **Keep it blameless** in every sentence (junior-level rule, still load-bearing).

---

## Contributing Factors vs Root Cause

This is the conceptual heart of middle-level incident analysis.

The **trigger** is the proximate event: the deploy at 14:02, the broker reboot, the leap second. The **root cause** — *if* you insist on one — is the deepest changeable condition. But the honest model is a *set of contributing factors* that had to line up.

A worked decomposition of one outage:

| Factor | Type | Why it mattered |
|---|---|---|
| Deploy raised cache TTL 30s → 300s | **Trigger** | Flipped the system into the failing regime. |
| Cache has no request coalescing (singleflight) | **Contributing** (latent bug) | Made simultaneous misses stampede the origin. |
| Retry client has no jitter / circuit breaker | **Contributing** (latent bug) | Turned a downstream slowdown into a retry storm. |
| No canary / staged rollout | **Contributing** (process) | The change went 0% → 100% with no early signal. |
| No alert on pricing pool saturation | **Contributing** (observability) | First signal was the symptom, not the cause. |

Notice: **remove *any one* of those and the outage likely doesn't happen, or is far smaller.** That's the Swiss-cheese insight (formalized in `senior.md`). The right output is not "the cause was the TTL change" — it's *all five*, each generating its own action item.

> **The test:** if your post-mortem names exactly one root cause, ask "if only that one thing had been different, would there still have been no incident?" Usually the answer is "yes, *if also* the canary existed / the coalescing existed / the alert existed." That means you have contributing factors, not a single root cause.

---

## SEV Levels and Why They Matter

A severity level is a shared shorthand that drives *response*: who gets paged, how fast, whether execs and customers are notified, whether a post-mortem is mandatory. The exact scale is org-specific; a common shape:

| SEV | Meaning | Example | Response |
|---|---|---|---|
| **SEV-1** | Critical: major outage, data loss, security breach | Checkout down globally; customer data exposed | All-hands, IC, exec notify, customer comms, post-mortem mandatory |
| **SEV-2** | Major: significant degradation, one region/feature down | EU checkout failing; p99 10× | On-call + secondary, IC, post-mortem mandatory |
| **SEV-3** | Minor: limited impact, workaround exists | One non-critical endpoint slow | On-call handles, post-mortem optional |
| **SEV-4** | Negligible: cosmetic / internal only | Dashboard label wrong | Backlog ticket |

Why a middle engineer must care:

- **It sets the post-mortem bar.** Most orgs *require* a written post-mortem for SEV-1/2. The SEV is the trigger for the whole learning process.
- **It sizes the response correctly.** Over-paging on a SEV-3 burns out the team; under-classifying a SEV-1 means the right people show up too late.
- **It standardizes "how bad."** "It's pretty bad" means nothing across teams. "SEV-2" means a specific, agreed level of bad.
- **MTTR is tracked per SEV.** You can't improve recovery time if every incident is "some severity."

Be wary of **SEV inflation** (everything becomes a SEV-1, so SEV-1 stops meaning anything) and **SEV deflation** (downgrading to avoid the post-mortem paperwork — a culture smell).

---

## Forensic Reconstruction From Logs and Traces

When the process is gone and you have no dump — only logs and traces — you reconstruct the failure from those. This is the bread-and-butter of incident post-mortems.

### Step 1 — Anchor on a correlation ID

Get *one* concrete failing request: a `request_id` from a user's error screen, or a trace ID from an error span. Everything reconstructs from that anchor.

```bash
# Loki (LogQL): all log lines for one request, in time order
{service="checkout"} |= "request_id=7af3c2" | json | line_format "{{.ts}} {{.level}} {{.msg}}"

# Elasticsearch (KQL)
service:checkout AND request_id:"7af3c2"

# Datadog
service:checkout @request_id:7af3c2
```

```text
14:11:08.114 INFO  request.start endpoint=/cart/checkout
14:11:08.119 INFO  cache.miss key=catalog:v98
14:11:08.121 INFO  pricing.fetch.start
14:11:12.140 ERROR pricing.fetch.timeout after=4019ms   ← the 4s wait
14:11:12.141 ERROR request.error reason="context deadline exceeded"
```

The reconstructed timeline of *one* request already tells the story: a cache miss, a 4-second wait on pricing, a deadline exceeded.

### Step 2 — Zoom out to the aggregate

One request is an anecdote. Confirm it's the pattern:

```bash
# Rate of the same error across the incident window
sum(rate(http_requests_total{service="checkout",status="500"}[1m]))

# Cache miss rate over the window — did it spike to 100%?
rate(cache_misses_total[1m]) / rate(cache_lookups_total[1m])
```

### Step 3 — Read the distributed trace

Open the trace for that ID in Jaeger/Tempo/Datadog. The waterfall shows *where the time went*: a 4.1s span in `pricing.fetchCatalog`, and inside it, 4s in `db.acquire()` — pool exhaustion, not a slow query. Tracing is the X-ray of the request path; see [`../tracing/README.md`](../tracing/README.md).

### Step 4 — Cross-reference with "what changed"

Almost every incident correlates with a change. Pull the deploy/config timeline and overlay it:

```text
13:58  PR #4412 merged (cache TTL 30s→300s)
14:02  checkout v2.317 deployed
14:11  catalog.invalidate Kafka event published   ← 50ms before the miss spike
```

The 50ms gap between the invalidate event and the miss spike is your causal link. **Forensic reconstruction is correlating independent time series until the story is forced.**

---

## A Full Core-Dump Walkthrough

Now the program-post-mortem side, deeper than junior level. We walk a real dump across languages.

### C / C++ with `gdb`

```bash
$ ulimit -c unlimited
$ ./billing               # crashes with SIGSEGV, writes ./core
$ gdb ./billing ./core
(gdb) bt full             # full backtrace WITH local variables at each frame
#0  apply_refund (acct=0x0, amount=4500) at billing.c:118
#1  process_event (e=0x5555...) at billing.c:74
#2  main () at billing.c:201
(gdb) frame 0
(gdb) print acct          # $1 = (Account *) 0x0    ← null
(gdb) up                  # walk DOWN the chain (to caller)
(gdb) print e->account_id # $2 = 99812
(gdb) print lookup_account(99812)   # re-run a pure function in the dump's context
$3 = (Account *) 0x0      # lookup returned NULL — THAT is the bug's origin
(gdb) info registers
(gdb) thread apply all bt # every thread's stack (for multithreaded crashes)
```

The crash was at frame 0 (`acct` was null). But the *bug* is in frame 1: `process_event` passed a null account because `lookup_account(99812)` returned null and nobody checked. **Walking down the stack found the origin; stopping at frame 0 would have blamed the victim.**

### Go with `dlv core`

Build keeping debug info; set `GOTRACEBACK=crash` so a panic writes a core:

```bash
$ go build -gcflags=all="-N -l" -o svc .   # -N -l: no optimize/inline → honest dump
$ GOTRACEBACK=crash ulimit -c unlimited; ./svc   # panics → core
$ dlv core ./svc ./core
(dlv) bt                       # crashing goroutine's stack
(dlv) goroutines               # ALL goroutines — vital for concurrent crashes
(dlv) goroutine 1              # switch to a specific goroutine
(dlv) frame 2                  # move down its stack
(dlv) print handler.cache      # inspect a frozen field
(dlv) locals                   # all locals in this frame
(dlv) print someSlice          # len/cap and contents, frozen at death
```

### Java — the `hs_err_pid.log` and heap dumps

When the JVM *itself* crashes (native fault, not a Java exception), it writes a fatal-error log:

```text
# hs_err_pid12345.log
# A fatal error has been detected by the Java Runtime Environment:
#  SIGSEGV (0xb) at pc=0x00007f... 
# Problematic frame:
# C  [libjpeg.so+0x1a2f]   Java_...decode    ← crash in native (JNI) code
...
Current thread (0x...):  JavaThread "http-nio-8080-exec-3"
Stack: [0x...], sp=0x...
Java frames:
  com.svc.ImageController.thumbnail(ImageController.java:88)
```

For an OutOfMemoryError, take/analyze a **heap dump** instead of a core dump:

```bash
# Auto-capture on OOM (set this on every prod JVM):
java -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/var/dumps -jar app.jar
# Or on demand:
jcmd <pid> GC.heap_dump /tmp/heap.hprof
jmap -dump:live,format=b,file=/tmp/heap.hprof <pid>
```

Open `/tmp/heap.hprof` in **Eclipse MAT**, run **Leak Suspects** → it reports the dominating object subgraph (e.g. "a `HashMap` retained by `CacheService.instance` holds 89% of the heap").

### Python — `faulthandler` and `py-spy dump`

```python
import faulthandler
faulthandler.enable()             # fatal signal → all-thread Python stacks to stderr
# Dump on a timer too, to catch hangs:
faulthandler.dump_traceback_later(60, repeat=True)
```

For a hung (not crashed) Python process, attach without restarting:

```bash
sudo py-spy dump --pid 12345      # every thread's current Python stack, no code change
```

`py-spy dump` is the Python analogue of a thread dump — the post-mortem snapshot of a stuck process.

### The universal rule: symbols

Across all of these, a dump is only readable with **symbols** that map addresses → names → lines. Strip them and you get `?? ()`. Keep the unstripped binary / `.hprof` mapping / `dSYM` from every build. This is [symbolication](../debugging/middle.md), and it's the single most common reason a post-mortem stalls.

---

## Heap, Thread, and Goroutine Dumps

Not every post-mortem is a *crash*. Two huge classes — memory exhaustion and hangs — need different dumps.

| Symptom | Right dump | Tool | What you look for |
|---|---|---|---|
| OOM / heap creeps up | **Heap dump** | Java `jmap`/MAT; Go `/debug/pprof/heap`; Python `tracemalloc` | Which object subgraph retains the most memory (dominator tree) |
| Process hung, no CPU | **Thread/goroutine dump** | `jstack`; `SIGQUIT`; `py-spy dump`; `/debug/pprof/goroutine?debug=2` | Threads blocked on a lock / channel; a deadlock cycle |
| Process hung, 100% CPU | **CPU profile** | `pprof`, `perf`, `py-spy top` | The hot loop |
| Native crash | **Core dump** | `gdb`, `dlv core` | The crashing frame and the bad value |

Reading a goroutine dump for a hang:

```bash
curl 'http://localhost:6060/debug/pprof/goroutine?debug=2' > goroutines.txt
# Group by signature: if 10,000 goroutines share one stack, that's the leak/deadlock.
grep -E '^goroutine [0-9]+ \[' goroutines.txt | sed 's/[0-9]\+/N/' | sort | uniq -c | sort -rn | head
#  9982 goroutine N [chan receive, 47 minutes]:   ← producer died; consumers stuck
```

For Java deadlocks, `jstack` literally tells you:

```bash
jstack <pid> | grep -A2 "Found one Java-level deadlock"
# "Found one Java-level deadlock:" then the two threads and the two locks in the cycle.
```

---

## Action Items That Actually Get Done

The most common failure of middle-level post-mortems: the analysis is good and the action items evaporate. Defenses:

1. **SMART, every time.** Specific, Measurable, Achievable, Relevant, Time-bound. "Improve monitoring" → "Add an alert on pricing DB pool utilization > 80% for 5m; owner: SRE on-call; due 2026-06-18."
2. **A ticket in the *same* tracker as normal work.** If it only lives in the post-mortem doc, it's invisible to sprint planning and dies.
3. **An owner who is a *person/role*, not "the team."** "The team" owns nothing.
4. **A due date that's real**, and a follow-up to check it.
5. **The two-week review.** A short recurring meeting: walk the open action items from recent post-mortems. How many landed? Which slipped, and was that a *conscious* reprioritization or silent decay? Silent decay is the enemy.
6. **Classify the item.** Prevent (stop the cause), detect (catch it sooner), mitigate (recover faster). A healthy set has all three; a set that's all "prevent" usually has a detection gap nobody's filling.

> A blunt heuristic: count the *completed* action items from your last ten post-mortems. If it's near zero, your post-mortem process is theater, no matter how good the writing is.

---

## Code Examples

### Auto-capture the corpse: configure dumps on every service

```bash
# Linux core dumps → a known directory, named by exe+pid+time
echo '/var/dumps/core.%e.%p.%t' | sudo tee /proc/sys/kernel/core_pattern
ulimit -c unlimited
```

```go
// Go: write goroutine stacks on SIGQUIT (default) AND a heap profile on a signal
import (
    "os"
    "os/signal"
    "runtime/pprof"
    "syscall"
)

func installDumpHandler() {
    c := make(chan os.Signal, 1)
    signal.Notify(c, syscall.SIGUSR1)
    go func() {
        for range c {
            f, _ := os.Create("/var/dumps/heap.pprof")
            pprof.WriteHeapProfile(f) // post-mortem heap snapshot on demand
            f.Close()
        }
    }()
}
```

```python
# Python: always-on faulthandler + on-OOM-ish hang dump
import faulthandler, signal
faulthandler.enable()                       # fatal signals → stack dump
faulthandler.register(signal.SIGUSR1)       # kill -USR1 <pid> → dump all stacks now
```

```bash
# JVM: capture the corpse automatically on OOM (do this everywhere)
java -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/var/dumps \
     -XX:+ExitOnOutOfMemoryError \
     -jar app.jar
```

### A log query that reconstructs a request's last known state

```sql
-- Reconstruct everything that happened to one request, across services, in order.
-- (CloudWatch Logs Insights flavour)
fields @timestamp, service, level, msg, error
| filter request_id = "7af3c2"
| sort @timestamp asc
```

---

## A Worked Incident Post-Mortem

A compact but complete SEV-2, showing the middle-level artifact end to end. (Times UTC.)

```markdown
# Post-Mortem: Checkout cache stampede        SEV-2   2026-05-29
Status: Final    Author: checkout on-call    Reviewers: pricing, SRE

## Summary
A cache-TTL change deployed to checkout-service interacted with the periodic
catalog-invalidate path to cause a cache stampede on pricing-service. ~12% of
checkout requests failed for ~6 minutes (14:11–14:18 UTC). Resolved by rollback.
No data loss.

## Impact
- 14:11–14:18 UTC (6m). 12% of POST /cart/checkout failed (`context deadline exceeded`).
- ~1,800 failed checkouts; users could retry successfully after 14:18.

## Detection
Alert "checkout error rate > 5% for 1m" fired at 14:12 (1 min after onset). Good.

## Timeline (UTC)
- 13:58  PR #4412 merged: cache TTL 30s → 300s.
- 14:02  checkout-service v2.317 deployed to us-east-1 (deploy bot).
- 14:11  pricing publishes catalog.invalidate; all checkout caches clear at once.
- 14:11:30  pricing p99 → 4.2s; DB connection pool saturates (Tempo trace 9f2…).
- 14:12  ALERT fires; on-call paged + acks.
- 14:15  Rollback to v2.316 initiated.
- 14:18  Rollback complete; error rate → baseline. (MTTR ≈ 6m, MTTD ≈ 1m)

## Root cause & contributing factors
- Trigger: TTL 30s→300s deploy.
- Contributing factors:
  1. Pricing cache origin fetch has no request coalescing (singleflight).
  2. checkout→pricing client has no jitter and no circuit breaker (retry storm).
  3. No canary/staged rollout — change went 0%→100% in one push.
  4. No alert on pricing DB pool saturation — first signal was the symptom.

## Causal analysis (5 Whys)
1. Why did checkout fail? Couldn't reach pricing (timeouts).
2. Why? Pricing pool exhausted by a surge of fetches.
3. Why a surge? Every checkout cache entry expired simultaneously.
4. Why simultaneously? Long TTL meant the periodic invalidate cleared a *full* cache.
5. Why did a full clear stampede? No coalescing to collapse simultaneous misses.

## Resolution
Mitigation: rollback to v2.316 (bleeding stopped at 14:18).
Fix: see action items — the latent stampede risk predates this deploy.

## Action items
| ID | Action | Owner | Due | Status |
|----|--------|-------|-----|--------|
| AI-1 | Add singleflight to pricing origin fetch | pricing | 2026-06-12 | open |
| AI-2 | Add jitter + circuit breaker to pricing client | checkout | 2026-06-12 | open |
| AI-3 | Canary 10/50/100% for checkout deploys | SRE | 2026-07-01 | open |
| AI-4 | Alert on pricing DB pool > 80% for 5m | pricing | 2026-06-05 | open |

## What went well / poorly / lucky
- Well: alert fired in 1 min; mitigation decided in <6 min.
- Poorly: TTL change reviewed without modeling the invalidate interaction.
- Lucky: hit mid-afternoon, not peak. At peak this likely cascades to inventory.
```

Notice the shape: wide evidence (timeline, trace links) funneling to four sharp, owned, dated action items. *That* is a middle-level post-mortem.

---

## Pros & Cons

| Practice | Pros | Cons |
|---|---|---|
| Structured incident review | Reconciles memory with evidence; spreads learning | Costs an hour of several engineers; needs prep |
| Contributing-factors model | Honest; generates multiple fixes | Harder to write than "the cause was X" |
| SEV levels | Right-sizes response; triggers the post-mortem | Inflation/deflation distort the signal |
| Log/trace forensic reconstruction | Works with no dump; shows cross-service flow | Needs correlation IDs and retained logs |
| Core dump walkthrough | Exact frozen state; re-walkable | Needs symbols; large; sensitive |
| Heap dump | Pinpoints memory retainers | Big; analysis tooling has a learning curve |
| Thread/goroutine dump | Solves hangs/deadlocks fast | Useless for "wrong result" bugs |
| SMART action items + follow-up | Actually changes the system | Requires tracking discipline most teams lack |

---

## Use Cases

- **SEV-2 outage, now recovered.** Run a review, write the doc, ship four action items.
- **OOM kill every few days.** Capture a heap dump on OOM, find the retainer in MAT/pprof.
- **Service hangs, doesn't crash.** Thread/goroutine dump → find the deadlock or stuck channel.
- **Native crash, can't reproduce locally.** The core dump *is* the repro; `gdb`/`dlv core`.
- **One customer's request failed mysteriously.** Reconstruct from its `request_id` across logs + trace.
- **Recurring incident.** A post-mortem whose action items actually land breaks the cycle.

---

## Coding Patterns

### Pattern: every request carries a correlation ID

```go
id := r.Header.Get("X-Request-ID")
if id == "" { id = uuid.NewString() }
ctx := context.WithValue(r.Context(), ctxKeyReqID{}, id)
w.Header().Set("X-Request-ID", id) // echo so users can quote it in reports
```

Without this, forensic reconstruction is grep-and-pray. With it, one ID pulls the whole story.

### Pattern: capture before restart (incident runbook step 1)

```bash
mkdir -p /var/dumps/inc-$(date -u +%Y%m%dT%H%M%SZ)
kill -SIGQUIT "$PID"                                            # goroutine/thread dump to logs
curl -s localhost:6060/debug/pprof/heap > heap.pprof           # heap snapshot
curl -s 'localhost:6060/debug/pprof/goroutine?debug=2' > gs.txt
# ...NOW you may restart. The corpse is preserved.
```

### Pattern: structured incident-context logging

```python
log = logging.getLogger(__name__)
log = logging.LoggerAdapter(log, {"incident_id": "INC-2026-05-29-001"})
log.info("rollback.start", extra={"from": "v2.317", "to": "v2.316"})
```

---

## Clean Code

- Configure **core dumps + heap-dump-on-OOM** on every service template, from day one.
- Keep **symbol files / unstripped binaries** as build artifacts for every release.
- Every request gets a **correlation ID**; every log line includes it.
- Post-mortem docs live in a **searchable, permanent** place, tagged by cause class — not in someone's drive.
- Action items are **tickets in the real tracker**, not bullet points in a doc.
- Dumps go to a **restricted, encrypted** location and are deleted after the investigation.

---

## Best Practices

1. **Draft the timeline before the review meeting**, from evidence, so the hour is spent reconciling and analyzing, not assembling.
2. **List contributing factors, not a single root cause.** Apply the "would removing only this have prevented it?" test.
3. **Assign a SEV** and let it drive the response and the post-mortem requirement.
4. **Reconstruct from a correlation ID** outward: one request → aggregate → trace → "what changed."
5. **Walk every frame** of a dump; the crash site is usually the victim, not the bug.
6. **Match the dump to the symptom**: crash→core, OOM→heap, hang→thread/goroutine.
7. **Make action items SMART, owned, dated, ticketed** — and run a two-week follow-up.
8. **Practice opening dumps in a drill**, not for the first time during a SEV-1.

---

## Edge Cases & Pitfalls

- **The orchestrator restarted the pod before you grabbed the dump.** Configure dumps to a *persistent* path the restart won't wipe.
- **Heap dump on a multi-GB JVM** can take 30s+ and produce a multi-GB file — and pauses the app. Plan disk and downtime.
- **`jstack` on a deadlocked JVM may be the *only* tool that works** — heap dump and CPU profile can hang.
- **Logs rotated out** before you queried them. Extend retention for incident-prone services, or snapshot during the incident.
- **Trace sampling dropped the request you want.** The slow request is often the one *not* sampled; sample errors at 100%.
- **Optimized core dump line numbers lie** (inlining). Use a debug build to confirm, accepting it may not reproduce.
- **Clock skew between hosts** corrupts a multi-service timeline. Check NTP before trusting sub-second ordering across machines.
- **A heap dump contains live customer data** — same sensitivity as a core dump.

---

## Common Mistakes

1. **Walking into the review with no prepared timeline**, then burning the hour assembling it.
2. **Forcing a single root cause** when the honest answer is four contributing factors.
3. **Action items that aren't ticketed** — they vanish.
4. **No two-week follow-up**, so action items silently decay and the incident recurs.
5. **Reading only the top frame of a dump** and blaming the crash site instead of the bug's origin.
6. **Using a core dump when the problem is OOM or a hang** (wrong dump for the symptom).
7. **Reconstructing a timeline from memory** instead of logs.
8. **No correlation IDs**, making forensic reconstruction a manual grep nightmare.
9. **Deflating the SEV** to dodge the mandatory post-mortem.
10. **Letting the review become an interrogation** of the person who deployed.

---

## Tricky Points

1. **The same incident needs *both* reconstructions.** Wall-clock (timeline) and program-state (dump). Fusing them is what separates a real post-mortem from a form.
2. **A crash dump shows where it *died*; walk down to where the bug was *born*.** Re-running a pure function inside `gdb` against the frozen state is a power move.
3. **`hs_err_pid.log` ≠ a Java exception.** It's written when the *VM* crashes (usually native/JNI), not when your code throws. Different beast, different fix.
4. **Heap "retained" ≠ "shallow" size.** A small object can retain gigabytes if it's the root of a big subgraph. Sort by *retained*.
5. **Contributing factors multiply, they don't add.** Each one removed often prevents the incident entirely — that's why you fix several, cheaply.
6. **A SEV is a response trigger, not a punishment scale.** It says "this is how fast and wide we respond," nothing about whose fault it is.
7. **Detection time is its own finding.** "We recovered in 6 minutes" hides "but a customer told us first" — that's a detection action item.

---

## Test Yourself

1. Given a one-paragraph incident, draft the full middle-level post-mortem document (all sections) with at least four contributing factors and four ticketed action items.
2. Take an outage you've seen and list its trigger separately from at least three contributing factors. Apply the "would removing only this have prevented it?" test to each.
3. Reconstruct a single request from a `request_id` using a log query in a stack you use (Loki/ES/Datadog/CloudWatch). Produce its per-request timeline.
4. Cause a native crash, capture the core, and walk *every* frame in `gdb` with `bt full`. Identify the frame where the bad value was *born*, not where it crashed.
5. Trigger an OOM in a JVM with `-XX:+HeapDumpOnOutOfMemoryError`, open the `.hprof` in MAT, and name the dominating retainer.
6. Make a Go service deadlock or leak goroutines; capture `/debug/pprof/goroutine?debug=2` and group by signature to find the stuck set.
7. Assign SEV levels to five incidents of varying impact and justify each in one sentence.
8. Take five vague action items ("improve monitoring") and rewrite each to be SMART, owned, and dated.

---

## Tricky Questions

1. **Q: Your post-mortem names one clean root cause. Why is that a yellow flag?**
   A: Real outages are almost always multi-causal — a latent bug + a trigger + a process gap + an observability gap. A single named cause usually means you stopped early. Apply the test: "if *only* that had been different, would there have been no incident?" Usually the answer reveals other necessary factors.

2. **Q: The core dump's `bt` shows your code crashed dereferencing a null. Is the bug at the crash line?**
   A: Probably not. The crash line is where a bad value was *used*. Walk down the stack to find where the null was *produced* (often a lookup that returned null and wasn't checked). That's the origin; the crash site is the victim.

3. **Q: A process is hung at 0% CPU. Core dump or thread dump?**
   A: Thread/goroutine dump (`jstack`, `SIGQUIT`, `py-spy dump`, `/debug/pprof/goroutine`). A hang is about *who is blocked waiting for whom*, which a thread dump shows directly. A core dump would work but a thread dump is faster and you don't have to crash it.

4. **Q: You have great logs but can't reconstruct a request's path because lines from different services are interleaved randomly. What's missing?**
   A: A propagated correlation/trace ID. Without it you can't stitch one request's lines together across services. Add `X-Request-ID` / W3C `traceparent` propagation; it's the cheapest, highest-leverage forensic investment.

5. **Q: The JVM wrote `hs_err_pid12345.log`, not a Java stack trace. What does that tell you?**
   A: The *VM itself* crashed — almost always in native code (JNI, a native library, or a JVM bug), not in your Java throwing an exception. Read the "Problematic frame" line; it usually points at a `.so`. The fix lives in native-land, not your `catch` blocks.

6. **Q: Your action items from the last six post-mortems are all "open." The writing is excellent. Is the process working?**
   A: No. The document's only purpose is to produce change. Beautiful analysis with zero landed action items is theater. The fix is process: ticket the items in the real tracker, assign people, and run a two-week follow-up that surfaces silent decay.

7. **Q: A multi-service timeline shows service B logging an event *before* service A sent it. Impossible — so what's wrong?**
   A: Clock skew. The two hosts' clocks disagree. Check NTP sync; don't trust sub-second ordering across machines. Anchor cross-service ordering on causal links (trace parent/child) rather than raw wall-clock when skew is possible.

---

## Cheat Sheet

```text
┌──────────────────────── POST-MORTEM ANALYSIS — MIDDLE CHEAT SHEET ───────────────────────┐
│                                                                                          │
│  RUN THE REVIEW                                                                          │
│    Prep timeline from EVIDENCE · say "blameless" out loud · funnel to action items        │
│    Kill: interrogation · ramble · hero-narrative · vague close                            │
│                                                                                          │
│  DOC STRUCTURE                                                                           │
│    Summary · Impact(quantified) · Detection · Timeline(UTC) ·                             │
│    Trigger+contributing factors · 5 Whys · Resolution · Action items(SMART)               │
│                                                                                          │
│  TRIGGER vs CONTRIBUTING FACTORS                                                         │
│    Test: "if ONLY this were different, no incident?" → if no, it's contributing, not root │
│                                                                                          │
│  SEV                                                                                     │
│    SEV-1 critical · SEV-2 major · SEV-3 minor · SEV-4 cosmetic                            │
│    Drives: paging · escalation · whether a post-mortem is mandatory                        │
│                                                                                          │
│  FORENSIC RECONSTRUCTION (no dump)                                                       │
│    1 request_id → log timeline → aggregate metrics → trace waterfall → "what changed"      │
│                                                                                          │
│  MATCH DUMP TO SYMPTOM                                                                   │
│    crash → core (gdb / dlv core)      OOM → heap (jmap+MAT / pprof/heap)                   │
│    hang  → thread/goroutine (jstack / SIGQUIT / py-spy dump / pprof/goroutine)             │
│    Walk DOWN the stack: crash site = victim, bug = born earlier.                          │
│    ?? () frames → missing SYMBOLS, not corrupt dump.                                       │
│                                                                                          │
│  CAPTURE THE CORPSE FIRST                                                                │
│    ulimit -c unlimited · -XX:+HeapDumpOnOutOfMemoryError · SIGQUIT before restart          │
│                                                                                          │
│  ACTION ITEMS                                                                            │
│    SMART · ticketed in real tracker · owned by a person · dated · 2-week follow-up         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A post-mortem is **a message to a future engineer**; judge it by the change it produces, not its thoroughness about the past.
- **Run the review from a prepared, evidence-based timeline**, blameless, funneling to action items — not as an interrogation or a ramble.
- The doc has a fixed shape: **Summary · Impact · Detection · Timeline · Trigger + contributing factors · 5 Whys · Resolution · Action items.**
- **List contributing factors, not a single root cause.** The honest test: "would removing *only* this have prevented it?"
- **SEV levels** right-size the response and trigger the post-mortem; watch for inflation and deflation.
- **Forensic reconstruction** rebuilds a failure from evidence: one correlation ID → log timeline → aggregate → trace → "what changed."
- **Match the dump to the symptom**: crash→core, OOM→heap, hang→thread/goroutine; and **walk down every frame** because the crash site is the victim.
- **Capture the corpse before restarting**, keep symbols, treat dumps as sensitive data.
- **Action items must be SMART, ticketed, owned, dated**, with a two-week follow-up — or the whole exercise is theater.

---

## What You Can Build

- A **post-mortem doc generator**: a CLI that scaffolds the full middle-level template pre-filled with a SEV, UTC clock, and an action-item table wired to your issue tracker's API.
- A **forensic timeline tool**: feed it a `request_id`, it queries your log + trace backends and emits a merged, time-ordered, per-request timeline ready to paste.
- A **dump-capture runbook + handler library** for Go/Java/Python that wires `SIGQUIT`/`SIGUSR1`/OOM to write the right dump to a persistent path.
- An **action-item tracker dashboard**: pulls open post-mortem action items across the org, ages them, and flags silent decay for the two-week review.
- A **core-dump lab**: native, Go, and JVM programs that crash/OOM/hang on demand, each with a worked dump-reading transcript — your team's drill material.

---

## Further Reading

- *Site Reliability Engineering*, Ch. 15 — "Postmortem Culture: Learning from Failure." <https://sre.google/sre-book/postmortem-culture/>
- *The SRE Workbook*, "Postmortem Culture" — templates and worked examples.
- John Allspaw, "Blameless PostMortems and a Just Culture" — Etsy Code as Craft.
- Eclipse MAT documentation — heap-dump analysis, dominator trees, Leak Suspects.
- *Debugging with GDB* — official manual, the core-dump and `bt full` chapters.
- Brendan Gregg, *Systems Performance* — thread states, off-CPU analysis.
- Go `runtime/pprof` and `net/http/pprof` docs — goroutine/heap dumps.
- Public post-mortems: GitLab 2017 db incident; Cloudflare incident reports; AWS post-event summaries — study their structure.

---

## Related Topics

- [`junior.md`](junior.md) — the two senses, blameless, timelines, 5 Whys, first core dump.
- [`senior.md`](senior.md) — the "root cause" critique, Swiss cheese, STAMP, measuring post-mortem quality.
- [`professional.md`](professional.md) — org-wide learning programs, near-miss analysis, large-scale forensic reconstruction.
- [`interview.md`](interview.md) — post-mortem interview questions.
- [`tasks.md`](tasks.md) — hands-on labs including a sample incident and a core-dump forensic lab.
- [`../debugging/middle.md`](../debugging/middle.md) — core dumps, thread/goroutine dumps, symbols (the live-debugging counterpart).
- [`../crash-reporting/README.md`](../crash-reporting/README.md) — automated capture of the crashes you analyze here.
- [`../tracing/README.md`](../tracing/README.md) — distributed traces, the X-ray of the request path.
- [`../logging/middle.md`](../logging/middle.md) — structured logs and correlation IDs, the raw material of reconstruction.

---

## Diagrams & Visual Aids

### The two reconstructions, fused

```text
   WALL-CLOCK (incident)                 PROGRAM-STATE (dump)
   ─────────────────────                 ─────────────────────
   14:02 deploy                          goroutine 78231 [chan receive, 124m]
   14:11 cache cleared        ╔════►      notify.(*Notifier).Wait
   14:12 ALERT                ║           orders.onOrderCreated:213
   14:14 dump taken ──────────╝           created by orders.Create:201
   14:18 recovered
        │                                         │
        └──────────────► FUSED POST-MORTEM ◄──────┘
        "the 14:11 clear (timeline) left 47k goroutines stuck on the
         pricing channel (dump) → stampede → timeouts → user impact"
```

### Match the dump to the symptom

```text
            ┌──────────────────────────────────────────────┐
   symptom  │  crash    OOM/grow    hang(0% CPU)   hang(100%)│
            ├──────────────────────────────────────────────┤
   dump     │  CORE      HEAP        THREAD/GORO     CPU PROF │
   tool     │  gdb       jmap+MAT    jstack          pprof    │
            │  dlv core  pprof/heap  py-spy dump     perf     │
            └──────────────────────────────────────────────┘
```

### The post-mortem funnel

```text
   ┌───────────────────────────────────────────┐  WIDE: all evidence
   │ logs · traces · metrics · dumps · chat     │
   └───────────────────┬───────────────────────┘
                       ▼
            ┌──────────────────────┐
            │ timeline + causes    │
            └──────────┬───────────┘
                       ▼
                ┌─────────────┐  NARROW: a few landed changes
                │ action items│
                └─────────────┘
```
