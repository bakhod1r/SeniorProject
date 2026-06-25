# Runtime ↔ GC Integration — Tasks & Exercises

> **Topic:** [Runtime ↔ GC Integration](README.md)
> **Focus:** Hands-on exercises that make the interface *visible*: find safepoint polls and write barriers in real disassembly, provoke and measure time-to-safepoint, observe the allocation fast path, and reason precisely about roots, moving GC, and barriers. These exercises observe and analyze the contract; they do not implement a collector.

---

## Table of Contents

1. [How To Use These Tasks](#how-to-use-these-tasks)
2. [Track A — Roots & Scanning](#track-a--roots--scanning)
3. [Track B — Safepoints & Time-To-Safepoint](#track-b--safepoints--time-to-safepoint)
4. [Track C — Write & Read Barriers](#track-c--write--read-barriers)
5. [Track D — Moving GC, Handles, Pinning](#track-d--moving-gc-handles-pinning)
6. [Track E — Allocation Fast Path](#track-e--allocation-fast-path)
7. [Track F — Engine-Specific Investigations](#track-f--engine-specific-investigations)
8. [Track G — Incident Simulations](#track-g--incident-simulations)
9. [Capstone Challenges](#capstone-challenges)
10. [Self-Assessment Checklist](#self-assessment-checklist)

---

## How To Use These Tasks

Each task has a **Goal**, **Steps**, a **Self-Check** (how to know you succeeded), a **Hint** (collapsed reasoning to try first), and, for harder tasks, a **Sparse Solution** (the key idea, not a full walk-through). Do the Self-Check *before* reading the Hint.

You will need at least one managed runtime with disassembly/diagnostics enabled:

- **JVM:** a JDK with `hsdis` for `-XX:+PrintAssembly` (or use `-Xlog:*` and JFR if you can't get disassembly). Useful flags: `-Xlog:gc*`, `-Xlog:safepoint`, `-Xlog:gc+tlab=trace`, `-XX:+PrintGCApplicationStoppedTime`, `-XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly`.
- **Go:** the toolchain; `go build -gcflags=-S`, `go tool objdump`, `GODEBUG=gctrace=1`, `go tool pprof`.
- **.NET (optional):** for the engine-specific track; `DOTNET_gcServer`, ETW/EventPipe GC events.

Do not worry if your exact assembly differs from the samples — versions and collectors change the output. The *skill* is recognizing the pattern (a poll, a barrier, a bump) regardless of the exact instructions.

---

## Track A — Roots & Scanning

### Task A1 — Enumerate the root sources

**Goal:** State precisely where roots live and why each is hard to scan from raw bits.

**Steps:** Write down the three primary root sources. For each, explain (a) why the collector can't tell pointers from non-pointers without help, and (b) what the runtime/compiler provides to make it precise.

**Self-Check:** Your answer names thread stacks, CPU registers, and globals/statics (plus runtime-internal handles), and ties precision to compiler-emitted stack maps keyed by PC.

<details><summary>Hint</summary>

A 64-bit word that lands in the heap's address range could be a pointer *or* an integer/hash/timestamp. Only the compiler's stack map for the current PC resolves the ambiguity.

</details>

### Task A2 — Precise vs conservative, on paper

**Goal:** Predict the behavior difference between the two scanning strategies.

**Steps:** Given a stack snapshot `[0x7f..1020, 0x000005, 0x7f..10a0, 0xCAFEBABE]` where the map says only slots 0 and 2 are pointers, list (a) what a conservative scanner keeps, (b) what a precise scanner keeps, and (c) which strategy can compact and why.

**Self-Check:** Conservative may keep slots 0, 2, and 3 (false positive on `0xCAFEBABE` if it lands in the heap); precise keeps only 0 and 2; only precise can compact (it knows exactly which slots to rewrite).

<details><summary>Hint</summary>

Compaction requires *overwriting* a slot with the relocated address. You dare not overwrite a value you're only *guessing* is a pointer.

</details>

### Task A3 — Why conservative collectors "leak"

**Goal:** Explain floating garbage from a false-positive root.

**Steps:** Construct a scenario (in prose or pseudocode) where an integer keeps a dead object alive under a conservative collector. Explain why this is not a code leak and not a GC bug.

**Self-Check:** Your scenario has a stack/register integer whose value equals an address inside a dead object; the conservative scanner conservatively retains it. You correctly call it floating garbage, expected behavior of conservative scanning.

---

## Track B — Safepoints & Time-To-Safepoint

### Task B1 — Find the safepoint poll in JVM disassembly

**Goal:** Locate a real safepoint poll in optimized code.

**Steps:**
```java
public class Poll {
    static long loop(long[] a) { long s=0; for (int i=0;i<a.length;i++) s+=a[i]; return s; }
    public static void main(String[] x){ long[] a=new long[1_000_000];
        for(int k=0;k<100000;k++) loop(a); }   // warm up to trigger JIT
}
```
Run with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly -XX:CompileCommand=print,Poll.loop`. Find the instruction near the loop back-edge annotated `{poll}` (a read of the polling page).

**Self-Check:** You can point to the `{poll}` instruction and explain that it lets the loop be stopped at a safepoint. With strip mining, the poll is on the outer strip loop, not every inner iteration.

<details><summary>Hint</summary>

Search the disassembly for the string `poll`. HotSpot annotates the polling-page read. If you can't get `hsdis`, use `-Xlog:safepoint` and reason about *where* polls must be instead.

</details>

### Task B2 — Provoke a long time-to-safepoint

**Goal:** Make TTSP, not collection, dominate a pause, and measure it.

**Steps:** Start two threads. Thread 1 runs a very long counted loop with no allocation and no method calls (e.g., `for (long i=0;i<5_000_000_000L;i++) acc^=i;`). Thread 2 allocates aggressively to trigger GCs. Run with `-Xlog:safepoint` and read the `Reaching safepoint` vs `At safepoint` numbers.

**Self-Check:** You observe `Reaching safepoint` (TTSP) far larger than `At safepoint` (collection) on at least one event, and you can explain it's because thread 1 wouldn't reach a poll.

<details><summary>Hint</summary>

Modern JVMs mitigate counted loops with strip mining (`-XX:+UseCountedLoopSafepoints`, on by default). To reproduce the classic problem, you may need to disable the mitigation or use a JNI call that holds a thread off any poll.

</details>

<details><summary>Sparse Solution</summary>

The key idea: collection can't start until *all* threads stop. A poll-free loop delays the stop, so the pause you measure is mostly the wait for that thread (TTSP), even though the GC itself finished in microseconds. The fix in real code is to ensure a poll lands (chunk the work behind method calls, rely on strip mining, or in Go on async preemption).

</details>

### Task B3 — Compare the two poll implementations

**Goal:** Articulate flag-based vs page-trap polling.

**Steps:** Write the (pseudo-)assembly for each. Explain how the runtime *triggers* a stop in each case (set a global byte vs `mprotect` the polling page unreadable), and which is cheaper in the common case.

**Self-Check:** Flag-based = load/test/branch (3 insns); page-trap = a single read that faults when the page is protected; page-trap is cheaper in the common case (one instruction, no branch).

### Task B4 — Strip mining math

**Goal:** Reason about the TTSP/throughput tradeoff of strip mining.

**Steps:** A loop runs 10^9 iterations; an unmitigated counted loop has no poll, so worst-case TTSP ≈ full loop runtime. With strip size S, a poll lands every S iterations. Estimate the per-iteration poll overhead relative to S, and the worst-case TTSP as a function of S.

**Self-Check:** Worst-case TTSP ≈ time(S iterations); poll overhead amortizes to ~1/S per iteration. Smaller S → shorter TTSP but more poll overhead; larger S → the opposite. You can state the tradeoff in one sentence.

---

## Track C — Write & Read Barriers

### Task C1 — Find a card-marking write barrier (JVM, ParallelGC)

**Goal:** See the generational write barrier in disassembly.

**Steps:**
```java
public class WB { static class Box{ Object r; } static void put(Box b, Object o){ b.r=o; } }
```
Warm up `put`, then dump it with `-XX:+UseParallelGC -XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly -XX:CompileCommand=print,WB.put`. Identify the shift-and-store-byte pair after the real store (`shr ...,9` then `mov byte ptr [card_table+idx], 0`).

**Self-Check:** You can point to the two-instruction barrier and explain it dirties the card containing `b` so young GC scans only dirty cards for old→young pointers.

<details><summary>Hint</summary>

`>>9` corresponds to 512-byte cards. The stored value `0` means "dirty" in HotSpot (it's a "0 = dirty" convention). A non-reference store (`b.n = 5`) has *no* such pair.

</details>

### Task C2 — Watch the barrier change with the collector

**Goal:** Demonstrate that the *collector* dictates the barrier shape.

**Steps:** Dump `WB.put` under `-XX:+UseParallelGC`, then under `-XX:+UseG1GC`, then (if available) `-XX:+UseZGC`. Compare.

**Self-Check:** ParallelGC shows a lean card-mark; G1 shows a SATB pre-write check plus post-write region logic; ZGC shows a *load* barrier on reference *reads* rather than a heavy store barrier. You can explain why each differs.

<details><summary>Sparse Solution</summary>

Same source line, three different emitted sequences. The compiler emits whatever the active collector's protocol requires. This is the central "the collector dictates, the compiler emits" point of the topic.

</details>

### Task C3 — Find the Go write barrier

**Goal:** Confirm the per-pointer-store cost in Go.

**Steps:**
```go
package main
type T struct{ p *T; n int }
//go:noinline
func setP(a,b *T){ a.p=b }
//go:noinline
func setN(a *T, v int){ a.n=v }
func main(){ a,b:=&T{},&T{}; setP(a,b); setN(a,7); _=a }
```
Run `go tool objdump -s 'main\.setP' <binary>` and `... main\.setN ...`. Look for a `runtime.gcWriteBarrier` call (or inlined buffered barrier) in `setP` and its absence in `setN`.

**Self-Check:** `setP` (pointer store) shows barrier code; `setN` (int store) does not. You can explain the barrier supports Go's concurrent hybrid-barrier marking.

### Task C4 — Reason about SATB vs incremental-update

**Goal:** Predict what each barrier records for a given mutation.

**Steps:** Before: `A.f -> X`. The mutator does `A.f = Y` while marking is active. State what a SATB barrier records and what an incremental-update barrier records, and which object each is protecting from being wrongly freed.

**Self-Check:** SATB records the *old* value `X` (protects `X`); incremental-update records the *new* value `Y` (protects `Y`, by rescanning `A`). Both prevent a reachable object from being missed.

### Task C5 — Defeat barrier elimination to measure cost

**Goal:** Show that a naive barrier micro-benchmark measures nothing.

**Steps:** Write a loop that stores a pointer into a freshly allocated, non-escaping object and never uses the result. Dump the assembly. Then change it so the object escapes (store into a static field / return it) and the result is consumed. Dump again.

**Self-Check:** The first version has no barrier (and maybe no allocation — scalar replacement); the second emits the barrier. You conclude barrier cost must be measured with escape forced and result consumed, verified in disassembly.

---

## Track D — Moving GC, Handles, Pinning

### Task D1 — Why a raw pointer dies across a move

**Goal:** Explain the moving-GC pointer hazard precisely.

**Steps:** In prose, trace what happens if native code stores a raw managed pointer, a compacting GC runs and relocates the object, and the native code later dereferences the stored pointer. Identify exactly where it goes wrong.

**Self-Check:** The GC updates references it *knows about* (via stack maps and handle tables) but not the raw pointer hidden in native memory; after relocation the raw pointer points at freed/moved memory; the dereference is corruption.

### Task D2 — Fix it with a handle (sketch)

**Goal:** Apply the handle pattern.

**Steps:** Rewrite the D1 scenario using a handle table: native code stores a *handle index*, the GC updates `handle_table[index]` on the move, and native code resolves the handle before use. Map this to a real API (`NewGlobalRef`/`GCHandle`/`Persistent`).

**Self-Check:** Your design never stores a raw address across a GC-possible point; it always resolves through the GC-updated indirection.

### Task D3 — Derived-pointer update arithmetic

**Goal:** Compute a relocated interior pointer.

**Steps:** A base object was at `0x1000` and a derived pointer `p` was `0x1018` (offset 24). The GC relocates the base to `0x8000`. Compute the new `p`. State what the stack map must have recorded for this to be possible.

**Self-Check:** `new_p = 0x8000 + (0x1018 - 0x1000) = 0x8018`. The map had to record that `p` is *derived* from the base, including which slot holds the base.

### Task D4 — Pinning cost reasoning

**Goal:** Explain when pinning hurts.

**Steps:** Describe two costs of pinning an object across a long operation under a compacting collector, and give the preferred alternative for bulk data (copy-out).

**Self-Check:** Costs: it can *block* the moving collector (or force it to work around the pinned object), and it *fragments* the heap. Alternative: copy the data out (e.g., `GetByteArrayRegion`) and release the pin immediately.

---

## Track E — Allocation Fast Path

### Task E1 — Observe TLAB behavior (JVM)

**Goal:** See the allocation fast path and its slow-path refills.

**Steps:** Run an allocation-heavy program with `-Xlog:gc+tlab=trace`. Identify lines reporting TLAB refills and waste. Then shrink the TLAB (`-XX:-ResizeTLAB -XX:TLABSize=16k`) and observe more frequent refills.

**Self-Check:** You can point to refill events, explain that a refill is the slow path (possibly contending on the shared heap), and show that a smaller TLAB means more refills.

<details><summary>Hint</summary>

The fast path is just a pointer bump inside the TLAB — it never appears as an event because it's nearly free. Only the *slow path* (refill) is logged.

</details>

### Task E2 — Allocation rate drives GC frequency (Go)

**Goal:** Connect allocation rate to pause frequency.

**Steps:** Run a Go program that allocates in a loop under `GODEBUG=gctrace=1`. Note the GC frequency. Then add `sync.Pool` reuse to cut allocations and rerun. Compare GC frequency.

**Self-Check:** Lower allocation rate → fewer GC cycles in the trace → fewer pauses *and* fewer write-barrier executions. You can state "allocation rate is the GC's throttle."

<details><summary>Sparse Solution</summary>

The cheapest GC tuning is often allocating less. Pooling/reuse, value semantics, and avoiding boxing reduce GC frequency, pause frequency, and barrier count simultaneously — one change, three wins.

</details>

### Task E3 — Bump-pointer allocation on paper

**Goal:** Write the allocation fast path.

**Steps:** Write the few-instruction fast path for bump allocation in a TLAB (`top`, `end`), including the branch to the slow path on overflow. Explain why a non-moving free-list allocator can't be this cheap.

**Self-Check:** `if (top+size<=end){p=top; top+=size; return p} else slow()`. A free-list must search/split/coalesce, which is more work per allocation; bump works only because the collector keeps a contiguous arena.

---

## Track F — Engine-Specific Investigations

### Task F1 — ZGC load barrier

**Goal:** Find a load barrier in ZGC disassembly.

**Steps:** With `-XX:+UseZGC`, dump a method that returns a field reference (`static Node follow(Node n){ return n.next; }`). Find the load followed by a test against a "bad mask" and a branch to a stub.

**Self-Check:** You can identify the colored-pointer test on the *load* and explain it enables concurrent relocation with self-healing. The same method under ParallelGC has no such test.

### Task F2 — Go async preemption

**Goal:** Demonstrate signal-based preemption bounding TTSP.

**Steps:** Run a Go program with a tight call-free loop plus background GC, once with default settings and once with `GODEBUG=asyncpreemptoff=1`. Observe/reason about how preemption (and thus TTSP for the loop) differs.

**Self-Check:** With async preemption on, the loop can be stopped via signal (bounded TTSP); off, the loop resists preemption longer. You can explain the signal handler uses precise per-PC stack maps to stop safely.

### Task F3 — .NET fully vs partially interruptible (research)

**Goal:** Explain the .NET GC-info granularity tradeoff.

**Steps:** From the .NET Book of the Runtime, summarize fully- vs partially-interruptible methods: what GC-safe points each has, the map-size effect, and the TTSP effect. Note how return-address hijacking covers call-free stretches.

**Self-Check:** Fully = safepoints almost everywhere (big maps, short TTSP); partially = safepoints at call sites (small maps, longer TTSP); hijacking traps a thread on method return to reach a safe point.

### Task F4 — Map four engines onto the contract

**Goal:** Build a comparison table from memory.

**Steps:** For HotSpot (G1/ZGC), Go, V8, and .NET, fill a table: root finding (precise/conservative/mixed), safepoint mechanism (poll/page-trap/signal/hijack), primary barrier (write/load/hybrid), moving (yes/no), handle mechanism.

**Self-Check:** Your table is internally consistent and matches the senior/interview material (e.g., Go = precise, signal preempt, hybrid write barrier, non-moving; ZGC = precise, handshakes, load barrier, moving).

---

## Track G — Incident Simulations

### Task G1 — "GC is slow" triage

**Goal:** Practice attributing a pause before tuning.

**Steps:** You're given a safepoint log line: `Reaching safepoint: 220 ms, At safepoint: 3 ms`. State the diagnosis and the *wrong* first action vs the *right* first action.

**Self-Check:** Diagnosis: TTSP-dominated; a thread wouldn't stop. Wrong first action: change heap size / switch collector. Right first action: find the straggler (poll-free loop / long native call) and fix preemption.

### Task G2 — Write-barrier storm

**Goal:** Diagnose a throughput (not pause) regression.

**Steps:** A graph-mutation service loses 15% throughput after switching to a concurrent collector. A flame graph shows significant CPU in barrier code. List three mitigations.

**Self-Check:** Mitigations include: reduce pointer stores (value/index representation, batch mutations), mitigate card-table false sharing (conditional card marking / padding), or choose a collector with a cheaper barrier for this workload. You distinguish this from a *pause* problem.

### Task G3 — Pacer cliff

**Goal:** Recognize a concurrent-collector STW fallback.

**Steps:** Latency is fine at steady state but spikes badly during traffic bursts. GC logs show occasional full STW collections during bursts. Explain the mechanism and two fixes.

**Self-Check:** Mechanism: allocation outran the pacer's prediction, so the concurrent collector fell back to STW (a cliff). Fixes: add heap headroom / tune `GOGC`/`GOMEMLIMIT` or heap-trigger, and alert on allocation-rate spikes.

### Task G4 — JNI critical blocking the collector

**Goal:** Distinguish pinning-blocks-move from loop-blocks-stop.

**Steps:** A thread holds `GetPrimitiveArrayCritical` across a long computation; a moving GC stalls. Explain why this differs from a poll-free loop, and give the fix.

**Self-Check:** The critical region *pins* and forbids relocation (blocks the *move*), distinct from a poll-free loop that delays *reaching* a safepoint (TTSP). Fix: copy out (`GetByteArrayRegion`) and release the pin fast.

---

## Capstone Challenges

### Capstone 1 — The Interface Field Guide

**Goal:** Produce a one-page reference you could hand a new teammate.

**Steps:** Write a single page that, for *your* primary runtime, documents: how to dump a safepoint poll and a barrier, how to split a pause into TTSP vs collection, how to observe allocation rate and TLAB behavior, and the three-step incident triage. Include the exact flags/commands.

**Self-Check:** Another engineer could follow it to diagnose a pause regression on your stack without further help.

### Capstone 2 — Barrier ABI Specification

**Goal:** Specify a write-barrier ABI as a codegen↔GC contract.

**Steps:** Write the contract: inputs, outputs, clobbers, fast-path prohibitions (no allocate/safepoint/block), out-of-line layout, and the exact elision rules. Then describe the stress/fuzz harness that would catch a dropped-barrier bug.

**Self-Check:** Your elision rules are stated identically as both a codegen permission and a GC expectation; your harness runs GC at every safepoint and forces every slow path. You can explain why the failure mode (freeing a live object) demands manufactured, not incidental, testing.

### Capstone 3 — Collector Selection Memo

**Goal:** Recommend a collector for a concrete workload using interface economics.

**Steps:** Given a workload profile (allocation rate, pointer-store rate, heap size, pause-time SLO, throughput sensitivity), write a memo recommending a collector and justifying it in *interface terms*: where you pay (load vs write barrier), TTSP risk, pacing/headroom, and metadata budget. Explicitly avoid arguing from the collection algorithm alone.

**Self-Check:** Your recommendation references per-load/per-store cost, TTSP straggler risk, and pacer behavior — not just "ZGC is newer." A reviewer can trace each claim to a measurable interface term.

---

## Self-Assessment Checklist

You understand Runtime ↔ GC Integration when you can:

- [ ] Name the three things the interface gives the GC (maps, safepoints, barriers) and what breaks without each.
- [ ] State where roots live and why raw bits don't reveal pointers.
- [ ] Explain precise vs conservative scanning and why only precise can compact.
- [ ] Define a safepoint, list where polls go, and explain why maps exist only at safepoints.
- [ ] Split a pause into time-to-safepoint vs collection from a log, and name TTSP causes (poll-free loops, native calls).
- [ ] Recognize a safepoint poll and a write barrier in disassembly, and explain a card-mark vs SATB vs incremental-update barrier.
- [ ] Explain a load/read barrier and why concurrent compaction needs one (ZGC colored pointers, Shenandoah forwarding).
- [ ] Explain why a raw pointer dies across a move and fix it with handles or pinning.
- [ ] Compute a relocated derived pointer and say what the map must record.
- [ ] Describe the TLAB bump-pointer fast path and why allocation rate is the GC's throttle.
- [ ] Map HotSpot, Go, V8, and .NET onto the contract (root finding, safepoint mechanism, barrier, moving, handles).
- [ ] Run an incident triage that attributes the symptom to a specific interface term before touching a tuning flag.
- [ ] Keep the distinction clear: this is the *interface*, not the GC *algorithm* (which lives in memory management).
