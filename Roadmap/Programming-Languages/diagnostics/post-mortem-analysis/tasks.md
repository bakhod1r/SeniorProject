# Post-Mortem Analysis — Hands-On Exercises

> **Topic:** [Post-Mortem Analysis Roadmap](README.md)
> **Focus:** Practical exercises that take you from "I can fill in a template" to "I can reconstruct a failure from logs, traces, and a core dump, and write the document that changes the org."

---

## Table of Contents

1. [Introduction](#introduction)
2. [Warm-Up](#warm-up)
3. [Core](#core)
4. [Advanced](#advanced)
5. [Capstone](#capstone)
6. [Sample Incident: The Phoenix Checkout Outage](#sample-incident-the-phoenix-checkout-outage)
7. [Related Topics](#related-topics)

---

## Introduction

Post-mortem analysis is two skills wearing one name. The first is **incident analysis**: reconstructing a wall-clock timeline from raw evidence, separating trigger from contributing factors, and writing a blameless document whose action items actually land. The second is **forensic reconstruction**: walking a frozen process — a core dump, a heap dump, a goroutine dump — frame by frame to recover what the program believed at the moment it died. A real production post-mortem fuses both: *the 14:11 cache clear (timeline) left 47k goroutines blocked on the pricing channel (dump), and together they explain the stampede.*

You cannot learn either by reading. You learn them by being handed messy logs and forcing a story out of them, by opening a `core` file that segfaulted and discovering the bug was born three frames below the crash, by writing a post-mortem and then having a teammate ask "but would removing *only* that have prevented it?" The exercises below are tiered. The **Warm-Up** band builds fluency with the artifacts and tools — `gdb`, `dlv core`, `jstack`, `py-spy`, log queries — so reaching for them is reflex. The **Core** band has you produce real documents and read real dumps end to end. The **Advanced** band drops you into multi-causal, multi-service investigations where there is no single right answer, only a defensible reconstruction. The **Capstone** band stops being about one incident and starts being about the *program*: how do you make dumps capturable, action items durable, and the whole learning loop actually work?

The single sample incident — the **Phoenix Checkout Outage** — appears at the bottom of this file with full raw evidence. Several tasks below post-mortem it. Read it once before you start, and return to it as the tasks reference it.

For background reading at each level: see [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md), [professional.md](professional.md), and [interview.md](interview.md).

---

## Warm-Up

These are 15-to-30-minute exercises. The goal is fluency with the artifacts and tools — not insight. If a Warm-Up task takes more than an hour, stop and re-read the corresponding section of `junior.md` or `middle.md`.

### Task 1: Fill in a blameless post-mortem skeleton

**Problem.** Take the middle-level template (Summary, Impact, Detection, Timeline, Trigger + contributing factors, 5 Whys, Resolution, Action items) and fill it in for a trivial incident you genuinely experienced: a deploy that broke prod for ten minutes, a disk that filled up, a cert that expired. Two pages maximum.

**Constraints.**
- Every section present, even if a line is "N/A — single-node dev service, no blast radius."
- Blameless tone: no person's name in the prose. "The pod was restarted at 14:18", not "Alex restarted the pod."
- Impact must be quantified, even roughly ("~40 requests failed over 8 minutes").

**Hints.**
- Copy the template verbatim from [`middle.md`](middle.md#writing-the-document) and overwrite the placeholders.
- If you can't quantify impact, that absence is itself a finding — note "no metrics existed to quantify impact" and make it an action item.

**Self-check.**
- [ ] All eight sections present.
- [ ] Zero personal names in the prose.
- [ ] Impact has a number and a duration.

### Task 2: Rewrite five blameful sentences as blameless

**Problem.** Convert each of these into blameless, system-focused phrasing.

```
1. Alex pushed the change without testing it.
2. Priya forgot to add the index, which is why it was slow.
3. The on-call engineer ignored the first page for 20 minutes.
4. QA missed this bug because they were rushing.
5. Someone deleted the production config by mistake.
```

**Constraints.**
- Describe the *system or process* that allowed the outcome, not the person.
- Each rewrite should imply a candidate action item.

**Hints.**
- "Alex pushed without testing" → "the change reached production without an automated test gate that would have caught the regression."
- Replace "forgot / ignored / missed / mistake" with the missing guardrail.

**Self-check.**
- [ ] No name, role-blame, or "should have" in any rewrite.
- [ ] Each rewrite points at a fixable system gap.

### Task 3: Order a shuffled timeline

**Problem.** The Phoenix incident's events (see the [Sample Incident](#sample-incident-the-phoenix-checkout-outage)) are listed below out of order and with their timestamps removed. Restore the correct causal order and re-attach the UTC times from the raw evidence.

```
- Rollback to v4.11 completes; error rate returns to baseline
- PR #2231 merged: connection-pool max lowered 50 → 5
- payments-api p99 latency crosses 8s
- Alert "checkout 5xx > 5% for 2m" fires
- checkout-service v4.12 deployed to all regions
- on-call acks the page
- payments-api connection pool reports "pool exhausted, waiters=312"
```

**Constraints.**
- Output a clean `HH:MM:SS — event (source)` timeline in ascending order.
- Mark which line is the **trigger** and which is the **first symptom alert**.

**Hints.**
- The deploy precedes the saturation; the saturation precedes the latency; the latency precedes the alert.
- Cross-reference each line against the raw log/deploy evidence in the sample.

**Self-check.**
- [ ] Times are monotonically increasing.
- [ ] Trigger and first-alert lines are labelled.

### Task 4: Open a core dump and read the crashing frame

**Problem.** Compile and crash this C program, then open the core in `gdb` and report the crashing function, file, line, and the value that caused the fault.

```c
// crash.c
#include <stdio.h>
#include <string.h>

typedef struct { char *name; int balance; } Account;

static Account *lookup(int id) {
    if (id == 42) { static Account a = {"vip", 100}; return &a; }
    return NULL;                      // not found
}

static int refund(Account *acct, int amount) {
    return acct->balance - amount;    // deref
}

int main(void) {
    Account *a = lookup(7);           // returns NULL
    printf("%d\n", refund(a, 30));
    return 0;
}
```

**Constraints.**
- `gcc -g -O0 crash.c -o crash` (keep symbols, no optimization).
- `ulimit -c unlimited` before running so a `core` is written.
- Use `bt` and `frame`/`print` — report the crash line and the null pointer.

**Hints.**
- If no `core` appears, check `cat /proc/sys/kernel/core_pattern`; it may pipe to `systemd-coredump` — then use `coredumpctl gdb crash`.
- `bt full` prints locals at every frame; `frame 0` selects the crash frame; `print acct` shows `0x0`.

**Self-check.**
- [ ] You quoted `refund` / `crash.c:12` (or your line) as the crash site.
- [ ] You showed `acct = 0x0` (NULL).
- [ ] You can name `lookup(7)` returning NULL as the *origin*, one frame down.

### Task 5: Read a JVM thread dump and spot the deadlock

**Problem.** Run a Java program that deadlocks two threads, capture a thread dump with `jstack`, and name the two threads and two locks in the cycle.

**Constraints.**
- Use `jstack -l <pid>` from the JDK (not VisualVM).
- The JVM prints the answer; you must locate and quote it.

**Hints.**
- `jps` lists JVM PIDs.
- `jstack -l <pid> | grep -A20 "Found one Java-level deadlock"` — the VM names both threads and both monitors (`0x...`).
- Sketch the cycle: thread A holds lock 1 waiting for lock 2; thread B holds 2 waiting for 1.

**Self-check.**
- [ ] You named both thread names and both lock identities.
- [ ] You drew the two-node waits-for cycle on paper.

### Task 6: Dump a hung Python process with py-spy

**Problem.** Start a Python process that hangs (e.g. a thread blocked on an unfilled `queue.Queue.get()`), then capture every thread's stack **without restarting it** using `py-spy dump`.

**Constraints.**
- Do not modify the running process; attach from outside.
- Report which thread is blocked and on what call.

**Hints.**
- `sudo py-spy dump --pid <pid>` prints each thread's current Python stack — the post-mortem snapshot of a stuck process.
- On macOS you may need to disable SIP-related protections or run as root; on Linux `CAP_SYS_PTRACE`.
- The blocked frame will sit in `queue.get` / `threading` / `_thread`.

**Self-check.**
- [ ] You captured stacks without killing the process.
- [ ] You named the blocked thread and its blocking call.

### Task 7: Query one request's log lines in order

**Problem.** Given a flat log file containing interleaved lines from many requests (the Phoenix `checkout.log` in the sample), extract every line for a single `request_id` in timestamp order and produce that request's mini-timeline.

**Constraints.**
- Filter by one `request_id` and sort ascending by timestamp.
- Output a 4-6 line per-request timeline ending at the error.

**Hints.**
- `grep 'request_id=9f2a1c' checkout.log | sort` (lines are timestamp-prefixed, so lexical sort = time sort).
- In Loki: `{service="checkout"} |= "request_id=9f2a1c" | json | line_format "{{.ts}} {{.level}} {{.msg}}"`.

**Self-check.**
- [ ] Output contains only that one request's lines.
- [ ] The last line is the error, and you can name the wait that preceded it.

---

## Core

These tasks are 1-to-3 hours each. They require you to combine evidence, read output critically, and produce a written artifact. If you can do all of them comfortably, you're at the middle level.

### Task 8: Write the full Phoenix post-mortem

**Problem.** Using the complete [Sample Incident](#sample-incident-the-phoenix-checkout-outage) evidence — deploy log, alert log, raw service logs, the trace summary, and the chat export — write the full middle-level post-mortem document.

**Constraints.**
- Use all eight headings: **Summary**, **Impact**, **Detection**, **Timeline (UTC)**, **Root cause & contributing factors**, **Causal analysis (5 Whys)**, **Resolution**, **Action items**.
- Blameless throughout — no names from the chat export in your prose.
- **At least four contributing factors** and **at least four action items**, each SMART (owner role, due date, status).
- Quantify impact from the actual numbers in the evidence.

**Hints.**
- The trigger is the pool-size change in PR #2231; do not stop there.
- Contributing factors hide in the evidence: no canary, no alert on pool saturation, retry client with no backoff, the change reviewed without load modeling.
- MTTD and MTTR are computable from the alert and rollback timestamps — include them.

**Self-check.**
- [ ] All eight headings present, impact quantified with real numbers.
- [ ] Four or more contributing factors, not a single root cause.
- [ ] Four or more action items, each owned, dated, and ticketed-style.
- [ ] No chat-export names in the prose.

### Task 9: Causal analysis without single-root-cause framing

**Problem.** For the Phoenix incident, apply the **"would removing only this have prevented it?"** test to each candidate cause, and produce the contributing-factors table (Factor | Type | Why it mattered) from `middle.md`.

**Constraints.**
- List at least five candidate factors and classify each as Trigger / Contributing-latent-bug / Contributing-process / Contributing-observability.
- For each, write one sentence answering the counterfactual test.
- Conclude explicitly: this incident had **no single root cause**; name the cheapest single fix that would have most reduced blast radius.

**Hints.**
- Lower pool to 5 (trigger). No backoff in the retry client (latent bug). No canary (process). No pool-saturation alert (observability). Change reviewed without modeling concurrency (process).
- "If only the pool hadn't been lowered" — true, no incident; but "if only a canary existed" — the blast radius collapses to one region. Both are real; that's the point.

**Self-check.**
- [ ] Five or more factors, each typed.
- [ ] Each has a counterfactual sentence.
- [ ] You named the highest-leverage single fix and justified it.

### Task 10: Build a timeline from raw, messy logs

**Problem.** You are handed three log files — `checkout.log`, `payments.log`, and `deploy.log` (all in the sample) — with **no pre-built timeline**. Merge them into one UTC-ordered incident timeline with a source tag per line.

**Constraints.**
- Merge across files, sort by timestamp, tag each line with its source service.
- Collapse repetitive noise (don't list 312 identical "pool exhausted" lines; aggregate them: "14:11:30–14:14:55 — 312 pool-exhausted events").
- Output 8-15 timeline lines, not a raw dump.

**Hints.**
- `sort -m` merges already-sorted files; or `cat *.log | sort` then read.
- Watch for **clock skew**: if `payments.log` claims an event before the `deploy.log` line that caused it, suspect NTP, not time travel.
- Aggregation is editorial judgement — the timeline is a *story*, not a transcript.

**Self-check.**
- [ ] One merged, ascending, source-tagged timeline.
- [ ] Repetitive events aggregated, not pasted 300 times.
- [ ] You flagged any sub-second cross-host ordering you don't fully trust.

### Task 11: Reconstruct a Go process's last state from a core dump

**Problem.** Build and crash a Go program that panics with a nil-map write inside a goroutine, capture the core, and use `dlv core` to reconstruct: the panic message, the panicking goroutine, and the line where the bad value was *born* (not where it crashed).

```go
// svc.go
package main

type Order struct{ items map[string]int }

func newOrder() *Order { return &Order{} }        // items left nil!

func addItem(o *Order, sku string) { o.items[sku] = 1 } // write to nil map → panic

func main() {
    o := newOrder()
    addItem(o, "sku-1")
}
```

**Constraints.**
- `go build -gcflags=all="-N -l" -o svc svc.go` (no optimize/inline → honest dump).
- `GOTRACEBACK=crash ulimit -c unlimited; ./svc` to write a core.
- Use `dlv core ./svc ./core`; report panic message, goroutine, and origin frame.

**Hints.**
- Inside dlv: `bt` (crashing stack), `goroutines`, `goroutine <id>`, `frame N`, `print o`, `locals`.
- The panic is `assignment to entry in nil map` at `addItem`; the *bug* is `newOrder` returning an `Order` with a nil `items` map.
- `print o.items` shows the nil map — frozen at death.

**Self-check.**
- [ ] You quoted the panic message verbatim.
- [ ] You named the panicking goroutine ID and function.
- [ ] You named `newOrder` as the origin, not `addItem` as the "cause."

### Task 12: Read a JVM heap dump and name the retainer

**Problem.** Trigger an `OutOfMemoryError` in a small Java program that accumulates entries in a `static HashMap` forever, capture the heap dump, open it in Eclipse MAT, and name the dominating retainer and its retained size.

**Constraints.**
- Run with `-Xmx64m -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp`.
- Open `/tmp/java_pid*.hprof` in Eclipse MAT; run **Leak Suspects**.
- Report: dominating object, the GC root holding it, retained size %.

**Hints.**
- `static Map<Long,byte[]> CACHE` with an unbounded `put` loop reliably OOMs under a small heap.
- MAT's Leak Suspects names the subgraph; "Dominator Tree" sorts by **retained** (not shallow) size — a tiny `HashMap` reference can retain the whole heap.
- The GC root will be a static field on your class.

**Self-check.**
- [ ] You named the dominating class and its retained-heap percentage.
- [ ] You named the GC root (the static field) holding it alive.
- [ ] You distinguished retained from shallow size in your writeup.

### Task 13: Capture and group a goroutine dump for a hang

**Problem.** Write a Go service that leaks goroutines (producers stop, consumers block forever on a channel), expose `net/http/pprof`, capture `/debug/pprof/goroutine?debug=2`, and group goroutines by signature to find the stuck set.

**Constraints.**
- Two captures 5 minutes apart; show the stuck count growing.
- Group by top frame; identify the blocking operation (channel receive, `WaitGroup.Wait`, mutex).

**Hints.**
- `curl 'http://localhost:6060/debug/pprof/goroutine?debug=2' > g1.txt`.
- Group: `grep -E '^goroutine [0-9]+ \[' g1.txt | sed 's/[0-9]\+/N/' | sort | uniq -c | sort -rn | head`.
- `9982 goroutine N [chan receive, 5 minutes]` means ~10k goroutines all stuck on the same receive — that's the leak.

**Self-check.**
- [ ] You named the leaking function and the blocking line.
- [ ] You explained what they're blocked on and why nobody unblocks them.
- [ ] The stuck count grew between the two captures.

### Task 14: Correlate a distributed trace with logs

**Problem.** Using the Phoenix sample's trace summary plus the service logs, reconstruct where a single slow checkout request spent its 8.3 seconds, and confirm from the logs that the trace's story matches.

**Constraints.**
- Identify the longest **non-overlapping** span (not the root, which always spans everything).
- Classify the dominant span as I/O wait, CPU, lock/pool contention, or downstream.
- Cross-check at least two timestamps between the trace and `payments.log`.

**Hints.**
- The trace shows `checkout.handle` (8.3s) → `payments.charge` (8.1s) → inside it `db.acquireConn` (8.0s) — the time is in **pool acquisition**, not the query.
- Pool-acquire-dominated latency points at connection exhaustion, which the `payments.log` "pool exhausted, waiters=312" lines confirm.

**Self-check.**
- [ ] You named the dominant span and its duration.
- [ ] You classified the bottleneck (pool contention) with evidence.
- [ ] Two trace timestamps line up with two log timestamps.

### Task 15: Rewrite five vague action items as SMART

**Problem.** Take these action items from a real-ish post-mortem and rewrite each to be Specific, Measurable, Achievable, Relevant, Time-bound, with an owner role and a due date.

```
1. Improve monitoring.
2. Be more careful with connection pool changes.
3. Add better alerting.
4. Make deploys safer.
5. Write a runbook.
```

**Constraints.**
- Each rewrite must name a metric/threshold or a concrete artifact, an owner role, and a date.
- Classify each as **Prevent**, **Detect**, or **Mitigate**; the final set must contain all three classes.

**Hints.**
- "Improve monitoring" → "Add alert on payments-api pool utilization > 80% for 5m (Detect); owner: SRE on-call; due 2026-06-25."
- "Make deploys safer" → "Add 10/50/100% canary stages to checkout deploys with auto-rollback on 5xx > 2% (Prevent); owner: platform; due 2026-07-10."

**Self-check.**
- [ ] Each item has a metric/artifact, owner role, and date.
- [ ] Prevent, Detect, and Mitigate are all represented.
- [ ] None reads as a sentiment ("be careful").

---

## Advanced

These tasks are 4-to-8 hours each. They reward methodical investigation, not raw speed. Several have no single right answer — they have defensible writeups.

### Task 16: Forensic reconstruction with NO dump — logs and traces only

**Problem.** A process died and was reaped by the orchestrator before anyone grabbed a dump. You have only logs and traces. Reconstruct the failure end to end: anchor on one correlation ID, build the per-request timeline, confirm it's the pattern with aggregate metrics, read the trace waterfall, and overlay "what changed."

**Constraints.**
- Use the four-step method from `middle.md`: anchor → aggregate → trace → what-changed.
- Produce: (1) one request's timeline, (2) an aggregate metric query proving it's systemic, (3) the dominant trace span, (4) the deploy/config line that correlates.
- Your conclusion must state the causal link with a timestamp gap ("the invalidate event at 14:11:08 preceded the miss spike by 50ms").

**Hints.**
- Start from a `request_id` on a user's error screen or an error span's `trace_id`.
- Aggregate: `sum(rate(http_requests_total{status="500"}[1m]))` and the saturation metric.
- The killer evidence is a *small time gap* between an independent change event and the symptom onset — that gap forces the story.

**Self-check.**
- [ ] All four steps produced a concrete artifact.
- [ ] You ruled out "it was always like this" with a before/after metric.
- [ ] Your causal claim names a specific time gap, not a vibe.

### Task 17: Walk a multithreaded C core dump to the bug's origin

**Problem.** Given a multithreaded C/C++ program that crashes intermittently (a worker dereferences a pointer freed by another thread — a use-after-free), capture the core and reconstruct: the crashing thread, what every other thread was doing, and the frame where the freed pointer was *handed* to the victim.

**Constraints.**
- `thread apply all bt` — examine *every* thread, not just the crasher.
- Identify the producer thread that freed the memory and the consumer that used it.
- Write a one-paragraph reconstruction of the race that led to the dump.

**Hints.**
- Build with `-g -O0 -fsanitize=address` for a clearer crash; or run under `valgrind` to confirm the use-after-free hypothesis the dump suggests.
- In `gdb`: `info threads`, `thread N`, `bt full`, `print ptr`. A dangling pointer often shows a recognizable freed pattern (`0x5555...` that no longer maps) or ASan poisoning.
- The crash thread is the *victim*; the bug is the missing synchronization between it and the freeing thread.

**Self-check.**
- [ ] You named the crashing thread and the freeing thread.
- [ ] You identified the unsynchronized handoff (the bug), not just the deref (the symptom).
- [ ] Your reconstruction explains why it's intermittent.

### Task 18: Diagnose an OOM that lives in native code

**Problem.** A JVM service is killed by the Linux OOM-killer, but the Java heap dump shows the heap is *small and healthy*. The memory is elsewhere — off-heap (direct `ByteBuffer`s, a native library, metaspace, or thread stacks). Reconstruct where the memory actually went.

**Constraints.**
- Confirm from `dmesg` / `journalctl -k` that the OOM-killer reaped the process and at what RSS.
- Rule out the Java heap with a heap dump (it's small).
- Use Native Memory Tracking (`-XX:NativeMemoryTracking=detail`, then `jcmd <pid> VM.native_memory summary`) to find the real consumer.

**Hints.**
- RSS far exceeding `-Xmx` means the leak is off-heap. Suspects: leaked `DirectByteBuffer`s, a JNI library, thousands of threads (each with a stack), or metaspace from classloader churn.
- `jcmd <pid> VM.native_memory summary` breaks RSS into Java heap / thread / code / GC / internal / other.
- A heap dump is the *wrong* dump here — that's the lesson. Match the dump to the symptom.

**Self-check.**
- [ ] You showed the OOM-killer line and the process RSS at death.
- [ ] You ruled out the Java heap with evidence.
- [ ] You named the actual off-heap consumer and proposed a fix.

### Task 19: Reconstruct a failure that spans three services from a core dump plus traces

**Problem.** Service A (Go) crashed with a panic. You have A's core dump, plus distributed traces and logs from services B and C that A was talking to. Fuse the **state reconstruction** (the dump: what A held at death) with the **wall-clock reconstruction** (the trace/logs: what the request flow looked like) into a single coherent story.

**Constraints.**
- From the dump: the panicking goroutine, the value it choked on, and where that value entered A.
- From the trace: which downstream call (B or C) supplied that value and when.
- Produce the fused two-reconstruction narrative from `middle.md`'s Model 1.

**Hints.**
- `dlv core`: find the bad field (`print resp.Body`, `locals`), then trace it back — which RPC populated it? A nil where a struct was expected often means B returned an error A didn't check.
- The trace's span for the B-call, timestamped just before A's panic, is the link between dump-state and wall-clock.
- The fused sentence has the shape: *"B returned X at 14:11:12 (trace); A's frozen state shows it stored X unchecked and panicked dereferencing it (dump)."*

**Self-check.**
- [ ] You named the bad value in the dump and its origin frame.
- [ ] You named the downstream call and timestamp that supplied it.
- [ ] Your narrative welds dump-state to wall-clock in one story.

### Task 20: Avoid the single-root-cause trap on a genuinely multi-causal incident

**Problem.** You are given an incident where a junior engineer has already written a post-mortem naming exactly one root cause ("the bad deploy"). Critique it: find the contributing factors they missed, prove with the counterfactual test that the deploy alone wasn't sufficient, and rewrite the "Root cause" section as a contributing-factors analysis.

**Constraints.**
- Apply the "would removing *only* the deploy have prevented it?" test and show the answer is more nuanced than yes/no.
- Identify at least three latent or systemic factors the original author ignored.
- Rewrite without making the document longer or blamier — tighter and more honest.

**Hints.**
- Single-cause post-mortems usually hide a detection gap and a process gap behind the trigger. Hunt those.
- The Swiss-cheese framing (`senior.md`): each hole alone is survivable; the incident needed all of them to line up.
- Resist replacing one wrong single cause ("the deploy") with another ("the engineer") — that's worse.

**Self-check.**
- [ ] You demonstrated the deploy was necessary but not sufficient.
- [ ] You surfaced three or more missed contributing factors.
- [ ] Your rewrite is blameless and not longer than the original.

### Task 21: Build a forensic timeline tool

**Problem.** Write a small CLI that takes a `request_id` (or `trace_id`) and a set of log files (or a Loki/ES/CloudWatch endpoint), and emits a merged, time-ordered, per-request timeline ready to paste into a post-mortem.

**Constraints.**
- Input: one ID + N log sources; output: a clean `HH:MM:SS.mmm <service> <level> <msg>` timeline.
- Handle clock skew: flag (don't silently reorder) any cross-service line that appears causally impossible.
- Aggregate runs of identical lines into a single "N× <msg> (first..last)" entry.

**Hints.**
- For files: parse, filter by ID, merge-sort by timestamp. For Loki: one LogQL query per service, merge results.
- Skew detection: if a child-span log predates its parent-span log on a different host by more than your NTP tolerance, annotate it `⚠ possible skew`.
- This is the "forensic timeline tool" from `middle.md`'s "What You Can Build" — keep it under ~200 lines.

**Self-check.**
- [ ] One ID produces one merged, ordered timeline across sources.
- [ ] Repetitive lines are aggregated.
- [ ] Impossible orderings are flagged, not silently fixed.

---

## Capstone

These are open-ended scenarios. The point is not to find one correct answer but to design and defend a complete approach. Treat each as if you are pitching it to a staff engineer at a design review.

### Task 22: Make every service capture-ready before the next incident

**Problem.** Your org has had three incidents where the orchestrator restarted the pod before anyone captured a dump, so the post-mortems were guesswork. Design and implement a "capture the corpse" standard that every service template adopts: core dumps on crash, heap dump on OOM, thread/goroutine dump on demand — all written to a persistent path a restart won't wipe.

**Constraints.**
- Cover at least Go, JVM, and Python.
- Dumps must survive pod restart (persistent volume) and be access-controlled (they contain customer data).
- A documented runbook: "before you restart, run these three commands."

**Hints.**
- Linux: `echo '/var/dumps/core.%e.%p.%t' > /proc/sys/kernel/core_pattern`; `ulimit -c unlimited`; mount `/var/dumps` as a persistent volume.
- JVM: `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/var/dumps`; Go: `SIGQUIT` for stacks, a `SIGUSR1` handler writing `pprof.WriteHeapProfile`; Python: `faulthandler.enable()` + `faulthandler.register(SIGUSR1)`.
- Dumps are as sensitive as a database export — encrypt the volume, restrict access, auto-delete after N days.

**What "done" looks like.** You have a service-template change (one PR) that wires crash/OOM/on-demand dumps to a persistent, encrypted, access-controlled path for all three runtimes. You have a one-page runbook ("capture before restart") with copy-pasteable commands. You demonstrate, on a deliberately crashed test service, that the dump survives a pod restart and is readable with symbols. You documented retention and access policy. You can present the whole thing in 10 minutes and an SRE understands exactly what to do at 3am.

### Task 23: Stand up a post-mortem program, not just a template

**Problem.** Your team writes post-mortems but their action items rot — six months of incidents, almost nothing landed. Design the *program* that makes the learning loop actually close: where docs live, how action items become real tickets, and how decay gets surfaced.

**Constraints.**
- Action items must live in the same tracker as normal sprint work, owned by a person/role with a real due date.
- A recurring two-week review surfaces open items and distinguishes conscious reprioritization from silent decay.
- Define the metric that tells you the program works (and be honest that "number of post-mortems written" is *not* it).

**Hints.**
- The only honest health metric is *completed action items from recent post-mortems*, not pages written.
- Classify items Prevent/Detect/Mitigate; an all-Prevent set usually has a detection gap nobody owns.
- The two-week review is short and ritual: walk open items, ask "landed, slipped, or quietly abandoned?"

**What "done" looks like.** You have a written program design: where docs live (searchable, permanent, tagged by cause class), how action items flow into the real tracker, who runs the two-week follow-up and what they ask, and the dashboard that ages open items and flags silent decay. You define the success metric (completed-action-item rate) and a target. You can show a worked example: an action item from a past post-mortem tracked from doc → ticket → done, and one you caught silently decaying. You can defend why "we write thorough post-mortems" is theater without this loop.

### Task 24: Build a core-dump / forensic lab as drill material

**Problem.** Your team has never opened a real dump under pressure — the first time is always during a SEV-1, which is the worst time to learn. Build a forensics lab: a set of programs that crash, OOM, and hang on demand, each across multiple runtimes, with a worked dump-reading transcript so engineers can practice before they need to.

**Constraints.**
- At least: a native segfault (C, `gdb`), a Go panic core (`dlv core`), a JVM OOM heap dump (MAT), and a hang (thread/goroutine dump).
- Each scenario ships with a transcript showing the exact commands and the reasoning ("walk down to where the value was born").
- Include at least one scenario where the obvious dump is the *wrong* dump (e.g. an off-heap OOM where the heap dump misleads).

**Hints.**
- Reuse Tasks 4, 11, 12, 13, 18 as lab scenarios; package them with a `make crash` / `make oom` / `make hang` runner.
- Each transcript should teach the *method* (match dump to symptom, walk down the stack, check symbols), not just the answer.
- The "wrong dump" scenario is the most valuable — it teaches judgement, not button-pushing.

**What "done" looks like.** You have a repo with runnable crash/OOM/hang scenarios across native, Go, and JVM (Python optional), each with a `make` target and a markdown transcript. A teammate who has never opened a dump can follow a transcript and reproduce the analysis. At least one scenario deliberately misleads (wrong dump for the symptom) and the transcript names the trap. You ran a 60-minute team drill with it and collected what confused people — that feedback is the real output.

### Task 25: Write the "first 30 minutes of a forensic investigation" runbook

**Problem.** Write a runbook titled "First 30 minutes: a service crashed/hung in prod and you must preserve and reconstruct it" for an on-call engineer who has never done forensics.

**Constraints.**
- Maximum two pages, time-boxed steps (5 minutes each).
- Step 1 is *always* "capture before you restart" — preserve the corpse first.
- Must include the decision tree: crash → core, OOM → heap, hang → thread/goroutine; and a 30-minute escalation gate.

**Hints.**
- Minute 0-5: capture (SIGQUIT for stacks, heap profile, core path) — *before* anyone restarts to "fix" it.
- Minute 5-10: classify the symptom (crash / OOM / hang-0%CPU / hang-100%CPU) → pick the right dump.
- Minute 10-20: open the dump with symbols; walk down the stack to the origin.
- Minute 20-30: form a hypothesis; decide mitigate-now vs investigate-more; if no progress, escalate to these roles.

**What "done" looks like.** Your runbook is readable in five minutes and actionable by someone who has never opened a dump. It leads with corpse-preservation (the irreversible step). It has the symptom→dump decision tree and copy-pasteable capture commands. It names the symbolication failure mode (`?? ()` = missing symbols, not a corrupt dump) so the engineer doesn't rathole. It has a hard 30-minute escalation gate naming roles. Your team can use it on a real incident and tell you whether it held up.

---

## If you can do all of these, you have the senior level

You can take a pile of raw logs, a trace, and a core dump and produce both reconstructions — wall-clock and program-state — and fuse them into one story. You reach for `gdb`, `dlv core`, `jstack`, `py-spy`, and a log query without thinking about which one. You write post-mortems that name contributing factors instead of a comforting single cause, with action items that are SMART, ticketed, and followed up. You've made your services capture-ready and your team drill-ready *before* the incident. The next step is not more post-mortem exercises — it's the `senior.md` critique of "root cause" itself (Swiss cheese, STAMP, systems thinking) and designing systems whose failures need less forensics to understand.

---

## Sample Incident: The Phoenix Checkout Outage

> Use this as the raw material for Tasks 3, 7, 8, 9, 10, and 14. It is deliberately messy — interleaved logs, a chat export with names, clock-skew-prone cross-host timestamps. Your job is to turn it into a clean, blameless post-mortem. All times are UTC unless a host clock disagrees.

**Background.** `checkout-service` (Go) calls `payments-api` (Go) synchronously to charge a card. `payments-api` holds a connection pool to its Postgres database. On 2026-06-18, a routine config change to `payments-api` interacted badly with normal traffic and took checkout down for several minutes.

### deploy.log

```
2026-06-18 13:55:02  PR #2231 merged by author: "payments-api: lower DB pool max 50→5 (cost cleanup)"
2026-06-18 14:09:40  payments-api v4.12 build complete
2026-06-18 14:10:05  payments-api v4.12 deploy START  (regions: us-east, us-west, eu-west — ALL AT ONCE)
2026-06-18 14:10:58  payments-api v4.12 deploy COMPLETE (no canary stage configured)
2026-06-18 14:16:20  payments-api v4.11 ROLLBACK START (initiated by on-call)
2026-06-18 14:17:11  payments-api v4.11 ROLLBACK COMPLETE
```

### alerts.log

```
2026-06-18 14:13:02  ALERT FIRING   "checkout 5xx rate > 5% for 2m"   severity=page
2026-06-18 14:13:05  PagerDuty: on-call paged
2026-06-18 14:13:41  on-call ACK
2026-06-18 14:17:55  ALERT RESOLVED "checkout 5xx rate > 5% for 2m"
```

### payments.log  (host clock runs ~0.4s fast vs NTP — note for skew)

```
2026-06-18 14:11:28.310  INFO  pool.config max=5 (was 50)
2026-06-18 14:11:30.882  WARN  pool.acquire slow waited=1204ms
2026-06-18 14:11:31.114  WARN  pool.acquire slow waited=1690ms
2026-06-18 14:11:33.540  ERROR pool exhausted, waiters=87
2026-06-18 14:12:10.901  ERROR pool exhausted, waiters=212
2026-06-18 14:13:02.455  ERROR pool exhausted, waiters=312
2026-06-18 14:13:50.118  ERROR pool exhausted, waiters=298
2026-06-18 14:16:40.700  INFO  pool.config max=50 (rollback)
2026-06-18 14:16:42.330  INFO  pool.acquire normal waited=3ms
```

### checkout.log  (interleaved requests — filter by request_id)

```
2026-06-18 14:11:31.002  INFO  request_id=9f2a1c  checkout.start  cart=44.10USD
2026-06-18 14:11:31.004  INFO  request_id=7bb0e2  checkout.start  cart=12.00USD
2026-06-18 14:11:31.180  INFO  request_id=9f2a1c  payments.charge.start
2026-06-18 14:11:31.220  INFO  request_id=7bb0e2  payments.charge.start
2026-06-18 14:11:34.560  WARN  request_id=7bb0e2  payments.charge.retry attempt=2 (no backoff)
2026-06-18 14:11:37.880  WARN  request_id=7bb0e2  payments.charge.retry attempt=3 (no backoff)
2026-06-18 14:11:39.300  ERROR request_id=9f2a1c  payments.charge.timeout after=8120ms
2026-06-18 14:11:39.301  ERROR request_id=9f2a1c  checkout.error reason="context deadline exceeded"  status=500
2026-06-18 14:11:41.205  ERROR request_id=7bb0e2  payments.charge.timeout after=9985ms
2026-06-18 14:11:41.206  ERROR request_id=7bb0e2  checkout.error reason="context deadline exceeded"  status=500
```

### Trace summary  (trace_id=tr-9f2a1c, the slow checkout request 9f2a1c)

```
checkout.handle                              8.31s   ████████████████████
  ├─ auth.validate                           0.02s   ▏
  ├─ cart.load                               0.05s   ▏
  └─ payments.charge                         8.12s   ███████████████████
        └─ payments-api: charge              8.10s   ███████████████████
              ├─ db.acquireConn              8.00s   ██████████████████   ← time is HERE
              └─ db.exec INSERT charges      0.09s   ▏
```

### Chat export  (#incident-checkout — names appear here; keep them OUT of your post-mortem)

```
14:13:44  alex:   acked. seeing checkout 5xx spike. dashboards show payments timeouts.
14:14:10  alex:   payments-api logs full of "pool exhausted". what changed?
14:14:55  priya:  there was a deploy ~14:10. PR #2231 lowered the pool max to 5 for cost.
14:15:20  alex:   5?? under this traffic we need way more than 5 conns. that's the trigger.
14:15:38  priya:  also the checkout client retries with no backoff — it's making the pile-up worse.
14:16:05  alex:   rolling back payments-api now.
14:17:15  alex:   rollback done. pool back to 50, acquire times normal. watching error rate.
14:18:00  alex:   error rate back to baseline. customers can checkout again.
```

### Known facts for your write-up

- Checkout 5xx peaked at ~14% of requests; the window of customer impact was ~14:11:30–14:17:30 (≈6 minutes).
- ~2,400 checkout attempts returned 500 during the window; affected users could retry successfully after rollback.
- No canary/staged rollout existed; the pool-size change went to all three regions at once.
- No alert existed on `payments-api` pool utilization or `waiters` count — the first signal was the downstream symptom (checkout 5xx), not the cause.
- The checkout→payments client retries on timeout with **no backoff and no jitter**, amplifying the pile-up.
- MTTD ≈ 1.5 min (impact onset ~14:11:30 → alert 14:13:02). MTTR ≈ 6 min (onset → rollback complete 14:17:11). No data loss; no double-charges (charges are idempotent by `request_id`).

---

## Related Topics

- [Post-Mortem Analysis — Junior](junior.md)
- [Post-Mortem Analysis — Middle](middle.md)
- [Post-Mortem Analysis — Senior](senior.md)
- [Post-Mortem Analysis — Professional](professional.md)
- [Post-Mortem Analysis — Interview](interview.md)
- Sibling diagnostic topics: [Debugging](../debugging/README.md), [Tracing](../tracing/README.md), [Logging](../logging/README.md), [Crash Reporting](../crash-reporting/README.md)
- The live-debugging counterpart of the dump labs: [Debugging — Middle](../debugging/middle.md)
