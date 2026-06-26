# Memory Pressure & OOM — Hands-On Tasks
> **Topic:** [Memory Pressure & OOM](README.md)

These tasks build intuition the only way it sticks: by deliberately driving systems into memory pressure and observing the cascade — overcommit, reclaim, swap, the OOM killer, cgroup limits, and runtime/GC interaction. Most require a Linux host or VM (a disposable cloud VM or local VM is ideal; do **not** run the OOM-triggering tasks on a machine you care about). Tasks are ordered Warm-Up → Core → Advanced → Capstone.

> ⚠️ Several tasks intentionally exhaust memory and may freeze or kill processes. Use a throwaway VM/container, keep a second terminal open, and know how to hard-reset the machine.

---

## Table of Contents
- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Read the real memory numbers
Run `free -m`, `cat /proc/meminfo`, and `ps aux --sort=-rss | head`. Identify how much memory is *free* vs *available*, and how much is page cache vs anonymous. Pick a process and find both its VSZ and RSS in `ps`.

**Self-check:**
- [ ] I can explain why `available` is much larger than `free`.
- [ ] I found the page-cache portion of RAM in `/proc/meminfo` (`Cached`/`Buffers`).
- [ ] I can state which of VSZ/RSS counts toward memory pressure and why.

<details><summary>Hint</summary>
`MemAvailable` already accounts for reclaimable cache. `free` only counts truly unused RAM. The two differ by roughly the reclaimable page cache.
</details>

### Task 2 — Prove that malloc lies
Write a tiny program (C, or any language) that `malloc`s a very large block (e.g. 10× your RAM) and checks the return value, then in a second version *touches* every page (`memset`). Observe that the allocation succeeds but the touch is where things go wrong.

**Self-check:**
- [ ] The allocation returned non-NULL even though it exceeds RAM.
- [ ] The program survived until it started *writing* to the memory.
- [ ] I can explain "you OOM on first touch, not on alloc."

<details><summary>Hint</summary>
On default `vm.overcommit_memory=0`, only obviously-absurd allocations fail. Lazy page mapping means physical memory is consumed in the page-fault handler when you write.
</details>

### Task 3 — Inspect the overcommit setting
Read `vm.overcommit_memory` and `vm.overcommit_ratio` via `sysctl`. Note the current mode (0/1/2). Read but do *not* permanently change them. Describe what would change about Task 2 under mode `2` (never overcommit).

**Self-check:**
- [ ] I know my host's current overcommit mode.
- [ ] I can explain how mode `2` would make the `malloc` in Task 2 actually fail.

---

## Core

### Task 4 — Trigger the OOM killer and read the autopsy
On a throwaway VM, run a program that allocates and *touches* memory in a loop until the OOM killer fires. Then run `dmesg -T | grep -i "out of memory"` and parse the kill line.

**Self-check:**
- [ ] I found the `Out of memory: Killed process …` line.
- [ ] I identified the victim PID, its `anon-rss`, and the triggering context.
- [ ] I can explain why the victim may differ from the process I expected.

<details><summary>Hint</summary>
A shell loop works too: `tail /dev/zero` will allocate until killed. Watch it from a second terminal with `dmesg -w`.
</details>

### Task 5 — Influence the victim with oom_score_adj
Start two memory-hungry processes. Before driving the system OOM, set `oom_score_adj` to `-1000` on one and `+1000` on the other (`echo N > /proc/PID/oom_score_adj`). Drive the system OOM and confirm which one the kernel kills.

**Self-check:**
- [ ] The process with `+1000` was killed first; the `-1000` one was spared.
- [ ] I can read a process's current `oom_score` from `/proc/PID/oom_score`.
- [ ] I can explain the cost of protecting a process (the kill moves elsewhere).

### Task 6 — Confine a process with a cgroup v2 memory limit
Create a cgroup v2 group, set `memory.max` to a small value (e.g. 100M), move a memory-hungry process into it, and watch it get **cgroup-OOM-killed** while the rest of the host stays healthy.

**Self-check:**
- [ ] The process was killed at the cgroup limit, not the host limit.
- [ ] `dmesg` / `memory.events` shows the kill attributed to my cgroup.
- [ ] The rest of the system was unaffected.

<details><summary>Hint</summary>
On a cgroup v2 host: `mkdir /sys/fs/cgroup/test`, `echo 100M > /sys/fs/cgroup/test/memory.max`, `echo $$ > /sys/fs/cgroup/test/cgroup.procs`, then run the hog. Check `cat /sys/fs/cgroup/test/memory.events` for `oom_kill` counts.
</details>

<details><summary>Solution sketch</summary>

```bash
sudo mkdir /sys/fs/cgroup/demo
echo "100M" | sudo tee /sys/fs/cgroup/demo/memory.max
# move current shell in, then run a hog
echo $$ | sudo tee /sys/fs/cgroup/demo/cgroup.procs
python3 -c "x=bytearray(); 
[x.extend(b'\\0'*1024*1024) for _ in range(500)]"   # touches ~500MB
# -> Killed; verify:
cat /sys/fs/cgroup/demo/memory.events     # oom_kill 1
```
The process dies at ~100M because the cgroup hard limit enforces `memory.max`, independent of host free memory.
</details>

### Task 7 — Soft throttle vs hard kill (memory.high vs memory.max)
Repeat Task 6 but set a low `memory.high` (soft) with a higher `memory.max` (hard). Observe that the process is *throttled* (slows dramatically, reclaim spikes) rather than immediately killed, and watch `memory.high` events accumulate.

**Self-check:**
- [ ] The process slowed but kept running while above `memory.high`.
- [ ] It was only killed if/when it crossed `memory.max`.
- [ ] I can articulate why `memory.high` is the kernel basis for graceful degradation.

### Task 8 — Watch reclaim and PSI under pressure
While running a moderate memory hog, watch `vmstat 1` (look at `si`/`so`, `free`, `buff`/`cache`) and `cat /proc/pressure/memory` repeatedly. Correlate rising PSI with the moment the hog starts forcing reclaim.

**Self-check:**
- [ ] I saw `some`/`full` PSI climb above zero under load.
- [ ] I correlated PSI with reclaim activity in `vmstat`.
- [ ] I can explain the difference between `some` and `full` PSI.

---

## Advanced

### Task 9 — Induce a swap-thrash livelock (carefully)
On a VM **with swap enabled**, grow a process's working set slightly beyond RAM so it thrashes rather than gets killed. Observe huge `si`/`so` in `vmstat`, PSI `full` near 100%, pinned disk, and a frozen-but-alive system. Then repeat with swap **off** and observe a fast clean OOM-kill instead.

**Self-check:**
- [ ] With swap on, the system livelocked (slow, no kill) with high swap-in/out.
- [ ] With swap off, the same workload produced a fast OOM-kill.
- [ ] I can argue both sides of the "disable swap in production" trade-off.

<details><summary>Hint</summary>
The hard part is sizing the working set to *just* exceed RAM (thrash) rather than wildly exceed it (instant kill). Keep `swapoff -a`/`swapon -a` handy and a second terminal to kill the hog. Be ready to hard-reset if the livelock locks you out.
</details>

### Task 10 — Reproduce a GC death spiral
In Go or Java, write a service that keeps adding live entries to an unbounded map/cache while serving requests, running inside a tight cgroup/heap limit. Drive it until you observe back-to-back GC, collapsing throughput, and CPU pinned in GC. Capture GC logs showing reclaimed bytes shrinking toward zero.

**Self-check:**
- [ ] CPU went GC-bound while latency degraded sharply.
- [ ] GC logs show each collection freeing less and less (live set, not garbage).
- [ ] I confirmed that GC *tuning* didn't help — only bounding the cache did.

<details><summary>Hint</summary>
Java: run with a small `-Xmx`, enable `-Xlog:gc*`, watch for `GC overhead limit exceeded`. Go: set a tight `GOMEMLIMIT` and `GODEBUG=gctrace=1`, keep appending to a global slice/map.
</details>

### Task 11 — Off-heap blows the cgroup while the heap looks fine
Run a JVM in a container with a fixed `memory.max`. Allocate a large amount of **off-heap** memory (many direct `ByteBuffer`s or a native allocation) while keeping the managed heap small. Get `OOMKilled` while heap metrics stay low. Then compare JVM heap-used to container RSS to find the gap.

**Self-check:**
- [ ] The container was OOMKilled (exit 137) with the heap well under `-Xmx`.
- [ ] The RSS-minus-heap gap pointed at native memory.
- [ ] Lowering `-Xmx` / `MaxRAMPercentage` (more native headroom) helped, not raising it.

<details><summary>Hint</summary>
Enable `-XX:NativeMemoryTracking=summary` and inspect with `jcmd <pid> VM.native_memory summary`. Compare against `cat /sys/fs/cgroup/.../memory.current` or `kubectl top pod`.
</details>

### Task 12 — Right-size a runtime to a container limit
Take the Go (or JVM) service from earlier and configure `GOMEMLIMIT` (or `MaxRAMPercentage`) to ~90%/75% of a chosen cgroup `memory.max`. Demonstrate that the GC now collects hard *before* the kernel kills — converting a previous OOM-kill into stable operation under the same load.

**Self-check:**
- [ ] Without the soft limit the service got OOMKilled; with it, it survived.
- [ ] I left explicit headroom for non-heap memory and can justify the percentage.
- [ ] I verified GC activity increased as the live heap approached the soft limit.

---

## Capstone

### Task 13 — Build a memory-pressure-aware service that degrades gracefully
Build a small HTTP service (any language) that holds a per-request working set in memory, and make it survive an overload that would otherwise OOM-kill it. Implement, in order:

1. **Bounded everything** — cap the request cache and any in-flight queue with explicit eviction/rejection policies.
2. **Admission control** — a concurrency semaphore sized from `(memory budget) / (peak per-request footprint)`.
3. **Pressure-driven load shedding** — read `/proc/pressure/memory` (or cgroup `memory.pressure`); when `some avg10` crosses a threshold, return `503 Retry-After` for new requests.
4. **Runtime soft limit** — `GOMEMLIMIT`/`MaxRAMPercentage` set below the cgroup `memory.max`.
5. **Observability** — export RSS, heap-used, PSI, and shed-count; alert on the *soft* threshold, not the kill.

Then run it inside a tight cgroup under a load test that exceeds capacity, and show that it sheds load and stays up instead of CrashLooping.

**Self-check:**
- [ ] Under overload the service returns `503`s and keeps serving the rest, rather than getting OOMKilled.
- [ ] Removing the admission-control semaphore reintroduces the OOM-kill (proving it's load-bearing).
- [ ] My alerts fire on soft-limit/PSI breach, before any kill would occur.
- [ ] I can point to the gap between heap-used and RSS in my metrics and explain it.
- [ ] I documented the trade-offs I chose (what I shed, why that threshold, why that concurrency cap).

<details><summary>Hint</summary>
Start by establishing the *peak per-request footprint* empirically (load one request, measure RSS delta). The concurrency cap falls out of that and your memory budget. For shedding, a background goroutine/thread polling PSI every ~200ms and flipping an `overloaded` flag is enough — the request handler checks the flag at admission.
</details>

---

## Self-Assessment

You've internalized this topic if you can, without notes:

- [ ] Explain why `malloc` rarely fails and where the failure actually lands (first touch, OOM killer).
- [ ] Distinguish VSZ from RSS and say which drives pressure.
- [ ] Trace the reclaim cascade (kswapd → direct reclaim) and explain direct-reclaim latency.
- [ ] Describe thrashing and argue both sides of disabling swap (and where zram/zswap fits).
- [ ] Read a `dmesg` OOM line and a `kubectl describe` exit-137 and extract the root cause.
- [ ] Tell apart the **three deaths**: managed-heap OOM, native/off-heap OOM, and cgroup OOM-kill — and the different fix each needs.
- [ ] Distinguish **OOMKilled** (container hit its limit) from **node-pressure eviction** (node ran low) and fix each at the right layer.
- [ ] Explain QoS classes, eviction order, and why `requests == limits` is the safe memory default.
- [ ] Recognize a GC death spiral on sight and know why GC tuning won't fix a live set.
- [ ] Design graceful degradation: bounded resources, backpressure, admission control, PSI-driven load shedding, runtime soft limits, spill-to-disk.
- [ ] Set `GOMEMLIMIT`/`MaxRAMPercentage` correctly relative to a cgroup limit with justified headroom.

If any box is unchecked, revisit the corresponding tier (middle for mechanisms, senior for design, professional for incidents) and redo the matching task.
