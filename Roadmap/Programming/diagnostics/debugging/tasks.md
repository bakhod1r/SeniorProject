# Debugging — Hands-On Exercises

> **Topic:** [Debugging Roadmap](README.md)
> **Focus:** Practical exercises that take you from "I can read a stack trace" to "I can lead a Sev-1 investigation under pressure."

---

## Table of Contents

1. [Introduction](#introduction)
2. [Warm-Up](#warm-up)
3. [Core](#core)
4. [Advanced](#advanced)
5. [Capstone](#capstone)
6. [Related Topics](#related-topics)

---

## Introduction

Debugging is the one skill where reading does not teach you the thing. You learn it by hitting a wall, picking a tool, forming a hypothesis, and being wrong four times before being right. The exercises below are tiered. The **Warm-Up** band trains your reflexes with the tools — pdb, dlv, jstack, git bisect — so that reaching for them is muscle memory rather than a Stack Overflow search. The **Core** band introduces real diagnostics: profilers, race detectors, syscall tracers, heap dumps. The **Advanced** band drops you into the situations that separate junior from senior engineers — flaky tests, Heisenbugs, goroutine leaks, core dumps. The **Capstone** band stops being about tools and starts being about strategy: how do you investigate a recurring incident, design observability for a legacy service, or write the runbook a teammate needs at 3am?

Do not skip ahead. The Capstone tasks assume you can reach for `pprof` or `jstack` without thinking. If you are still googling "how to set a conditional breakpoint in pdb" mid-incident, you will never finish the investigation in time. Work each band end-to-end, and if a task takes more than four hours, write down what blocked you — that note is more valuable than the answer.

For background reading at each level: see [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md), [professional.md](professional.md), and [interview.md](interview.md).

---

## Warm-Up

These are 15-to-30-minute exercises. The goal is fluency with the basic tooling — not insight. If a Warm-Up task takes more than an hour, stop and re-read the corresponding section of `junior.md`.

### Task 1: Set a pdb breakpoint and inspect locals

**Problem.** You are given a Python script `compute_invoice.py` (~80 lines) that computes a tax-inclusive total. The expected result is `$123.45` but the script prints `$130.00`. Set a breakpoint at line 42 (the `apply_tax` call site) and inspect the values of `subtotal`, `rate`, and `discount` at that point.

**Constraints.**
- Use the standard library `pdb` — no IDE debuggers.
- Do not modify the script's logic; only insert the breakpoint.
- Report the values of all three locals before the line executes.

**Hints.**
- `breakpoint()` (Python 3.7+) is the modern entry point; `import pdb; pdb.set_trace()` works on older versions.
- Inside pdb, `p <expr>` prints, `pp` pretty-prints, `l` lists source.
- `args` shows function arguments; `locals()` returns the dict.

**Self-check.**
- [ ] You can name all three local values without re-running the script.
- [ ] You used `n` (next) and `s` (step) at least once each.
- [ ] You exited cleanly with `q`, not Ctrl-C.

### Task 2: Read a 30-line stack trace and find the real bug

**Problem.** Given the following Python stack trace, identify the line where the bug **actually originates** — not where the exception is raised.

```
Traceback (most recent call last):
  File "main.py", line 12, in <module>
    run()
  File "main.py", line 8, in run
    process(load_config())
  File "loader.py", line 24, in load_config
    return parse(read_file(CONFIG_PATH))
  File "loader.py", line 17, in read_file
    with open(path, "r") as f:
TypeError: expected str, bytes or os.PathLike object, not NoneType
```

**Constraints.**
- Explain in one sentence what is `None` and why.
- Identify which file/line you would patch to prevent the bug at its source.

**Hints.**
- Read the trace bottom-up; the deepest frame is the symptom.
- The **cause** is usually a frame or two up, where a value was constructed wrong.

**Self-check.**
- [ ] You named the variable that was `None`.
- [ ] You named the file/line that should produce a clearer error or a non-None default.

### Task 3: Convert print debugging to structured logging

**Problem.** You are handed a 60-line Python script peppered with `print(f"x = {x}")` statements left from a debugging session. Replace them with the `logging` module so log level can be controlled with an env var and timestamps appear automatically.

**Constraints.**
- Use `logging.getLogger(__name__)`, not the root logger.
- Default level is `INFO`; setting `LOG_LEVEL=DEBUG` in the env switches to debug.
- Output format: `<ISO-timestamp> <LEVEL> <logger-name> - <message>`.

**Hints.**
- `logging.basicConfig(level=..., format=...)` is the one-line bootstrap.
- `os.environ.get("LOG_LEVEL", "INFO")` → pass through `getattr(logging, ...)`.
- Use `%s` placeholders, not f-strings, so formatting is lazy.

**Self-check.**
- [ ] Running with no env var produces zero DEBUG lines.
- [ ] Running with `LOG_LEVEL=DEBUG` produces all of them.
- [ ] You did not leave a single `print` behind.

**Sample Solution.**

```python
import logging
import os

log = logging.getLogger(__name__)

def setup_logging() -> None:
    level_name = os.environ.get("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

def compute(x: int, y: int) -> int:
    log.debug("inputs: x=%s y=%s", x, y)
    result = x * y + 1
    log.info("computed result=%s", result)
    return result

if __name__ == "__main__":
    setup_logging()
    compute(3, 4)
```

### Task 4: Step into a Go function with dlv and inspect a slice

**Problem.** You have a Go program with a function `func dedupe(items []string) []string` that is returning fewer items than expected. Use `dlv debug` to step into `dedupe`, set a breakpoint inside the loop, and print the contents of the working `seen` map after the 3rd iteration.

**Constraints.**
- Use Delve (`dlv`) from the command line; no IDE.
- Demonstrate `b`, `c`, `n`, `s`, and `p` commands.

**Hints.**
- `dlv debug ./main.go -- arg1 arg2` to start.
- `b main.dedupe:5` to break inside the function at relative line 5.
- `p seen` prints the map; `p items[i]` prints the current item.
- `c` continues to the next breakpoint hit.

**Self-check.**
- [ ] You can show the contents of `seen` at any iteration.
- [ ] You stepped *into* a helper function, not just over it.
- [ ] You exited dlv cleanly.

### Task 5: Use git bisect across 20 commits

**Problem.** You have a repository where `pytest tests/test_billing.py::test_total` passes on commit `HEAD~20` and fails on `HEAD`. Find the exact commit that introduced the failure.

**Constraints.**
- Use `git bisect` — no manual binary search by checking out commits.
- Automate the test run with `git bisect run`.

**Hints.**
- `git bisect start` then `git bisect bad HEAD` then `git bisect good HEAD~20`.
- The run script should exit 0 if good, 1 if bad, 125 to skip.
- Don't forget `git bisect reset` at the end.

**Self-check.**
- [ ] You identified the offending commit hash.
- [ ] You used `git bisect run` rather than answering good/bad by hand.
- [ ] Your worktree is back on the original branch after `reset`.

### Task 6: Read a Java exception and trace the cause chain

**Problem.** Given a Java stack trace with `Caused by:` clauses three levels deep, name the **root cause** exception type, the file/line where it was thrown, and the file/line where it was wrapped into the top-level exception.

**Constraints.**
- Do not run any code; reading only.
- Write your answer as three lines: root type, root location, wrap location.

**Hints.**
- `Caused by:` chains go from outer to inner; the last `Caused by:` block is the root.
- Stack frames within each block are still bottom-up in terms of call order.

**Self-check.**
- [ ] You named a concrete exception class, not "some IOException".
- [ ] Your file:line references are specific.

### Task 7: Reproduce a flaky test deterministically once

**Problem.** You are told a test passes 9 times out of 10. Run it 100 times in a row and capture the output of all failures.

**Constraints.**
- Use `pytest --count=100` (with `pytest-repeat`) or a shell loop.
- Save the failure output to a file for later analysis.
- Do not fix the test — just reproduce.

**Hints.**
- `for i in $(seq 1 100); do pytest -x tests/test_thing.py || echo "FAIL $i"; done`
- `pytest -p no:randomly` if you have a randomizer plugin installed.

**Self-check.**
- [ ] You produced at least one failure.
- [ ] You have the stderr/stdout from a failing run saved to disk.

---

## Core

These tasks are 1-to-3 hours each. They require you to combine tools, read output critically, and produce a written explanation. If you can do all of them comfortably, you're at the middle level.

### Task 8: Conditional breakpoint in pdb

**Problem.** A function `process(items)` is called millions of times. The bug only manifests when `len(items) > 1000`. Set a conditional breakpoint that triggers only in that case, then capture and inspect the offending input.

**Constraints.**
- Use pdb's conditional breakpoints, not an `if x: breakpoint()` patch in the source.
- Once hit, save `items` to a pickle file for offline reproduction.

**Hints.**
- In pdb: `b process, len(items) > 1000` — the comma syntax sets a condition.
- Or attach the condition after the fact: `condition <bp-number> <expr>`.
- `import pickle; pickle.dump(items, open("/tmp/bad.pkl", "wb"))` from the pdb prompt.

**Self-check.**
- [ ] The breakpoint fires zero times on small inputs.
- [ ] You have `/tmp/bad.pkl` on disk after the run.
- [ ] You can re-load the pickle and call `process(items)` in a fresh REPL.

### Task 9: Capture and analyze a Go CPU profile via pprof

**Problem.** A Go web service uses 100% CPU under load. Enable `net/http/pprof`, hit `/debug/pprof/profile?seconds=30` while the load is running, and identify the top three functions by CPU time.

**Constraints.**
- Use the `go tool pprof` interactive prompt or the web UI.
- Report functions by their `flat` and `cum` percentages.
- The hot function should be something you can explain, not just a generic runtime call.

**Hints.**
- Import `_ "net/http/pprof"` and start an `http.ListenAndServe("localhost:6060", nil)` goroutine.
- `go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30`
- Inside pprof: `top10`, `list <funcname>`, `web` (opens SVG).

**Self-check.**
- [ ] You named three functions and their CPU shares.
- [ ] You can explain which lines inside the hottest function are doing the work.
- [ ] You ran `web` and saved the SVG to disk.

**Sample Solution.**

```go
package main

import (
    "log"
    "net/http"
    _ "net/http/pprof" // registers /debug/pprof/* on DefaultServeMux
)

func busyWork(w http.ResponseWriter, r *http.Request) {
    // intentionally CPU-bound for the exercise
    n := 0
    for i := 0; i < 5_000_000; i++ {
        n += i * i
    }
    w.Write([]byte("ok"))
}

func main() {
    // pprof endpoint on a separate port — keep it off the public mux
    go func() {
        log.Println(http.ListenAndServe("localhost:6060", nil))
    }()

    http.HandleFunc("/work", busyWork)
    log.Fatal(http.ListenAndServe(":8080", nil))
}

// Capture: go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
// Inside pprof:  (pprof) top10
//                (pprof) list busyWork
//                (pprof) web
```

### Task 10: Find the biggest allocators with tracemalloc

**Problem.** A long-running Python data pipeline grows from 200MB to 2GB over an hour. Use `tracemalloc` to find the top five lines of code by allocated memory and write a one-sentence hypothesis for each.

**Constraints.**
- Enable `tracemalloc` at startup with `frames=25` so you get usable tracebacks.
- Snapshot at 5 minutes and again at 30 minutes, then diff.
- Do not use a third-party profiler.

**Hints.**
- `tracemalloc.start(25)` early, then `snap = tracemalloc.take_snapshot()`.
- `snap2.compare_to(snap1, "lineno")[:5]` gives the top diffs.
- Look for places that build lists/dicts inside loops without bounded size.

**Self-check.**
- [ ] You have two snapshots saved (use `snap.dump(path)`).
- [ ] You named five `(file, lineno)` pairs.
- [ ] Each has a hypothesis no longer than one sentence.

### Task 11: Identify a JVM deadlock with jstack

**Problem.** You are given a Java program (provided) that deadlocks intermittently between two threads. Use `jstack` to dump thread state and identify the two locks involved in the cycle.

**Constraints.**
- Use `jstack <pid>` from the JDK — not VisualVM or a profiler.
- Report the two thread names, the lock identities (`0x...`), and the cycle.

**Hints.**
- `jps` lists JVMs; pick your PID.
- `jstack -l <pid>` gives long form, including ownable synchronizers.
- Search the dump for `Found one Java-level deadlock` — the JVM tells you straight up.

**Self-check.**
- [ ] You named both threads and both locks.
- [ ] You can draw the cycle on paper.
- [ ] You proposed a lock-ordering fix without running it yet.

### Task 12: Run a Go test with -race and interpret the report

**Problem.** A package has a test that passes normally but fails under `go test -race`. Run it, read the report, and write a paragraph explaining the data race in plain English.

**Constraints.**
- Use `go test -race ./...`.
- Your explanation must name (a) which variable is racing, (b) which two goroutines are involved, and (c) what the read/write ordering is.

**Hints.**
- The race detector prints `Read at 0x... by goroutine N` and `Previous write at 0x... by goroutine M` with full stacks.
- Match the line numbers in both halves to the same field/variable.

**Self-check.**
- [ ] Your explanation mentions a specific field or variable name.
- [ ] You can propose a fix (mutex, channel, or atomic).

### Task 13: strace to find a missing config file

**Problem.** A Go binary exits at startup with "config error" but the error wraps a `*PathError` whose path is hidden by sanitization. Use `strace` to find which file path it tried to open.

**Constraints.**
- Use `strace -f -e trace=openat <binary>` (or `-e trace=open` on older kernels).
- Identify the **last** failing `openat` before the process exits.

**Hints.**
- `-f` follows forks/threads — Go runtimes spawn many.
- `grep ENOENT` to filter for files that did not exist.
- Or `-y` to print resolved file descriptors.

**Self-check.**
- [ ] You named the exact path string.
- [ ] You can explain why that path was chosen (default? env var? CLI flag?).

### Task 14: Capture a JVM heap dump and find the top retained class

**Problem.** A Java service is at 90% old-gen full and not recovering. Capture a heap dump and identify the class with the largest retained size.

**Constraints.**
- Use `jmap -dump:format=b,file=/tmp/heap.hprof <pid>` (or `jcmd <pid> GC.heap_dump`).
- Open the dump in Eclipse MAT or VisualVM and report the top class by retained heap.

**Hints.**
- A dump on a 4GB heap will take 30s and produce a 4GB file — make sure you have disk.
- MAT's "Leak Suspects" report often points straight at the offender.
- Retained size > shallow size; look at retained.

**Self-check.**
- [ ] You named the class and its retained size.
- [ ] You named the GC roots that hold it alive.
- [ ] You proposed a likely cause (cache without eviction? static map? thread-local?).

### Task 15: Compare two Chrome DevTools heap snapshots

**Problem.** A Node.js application leaks memory across a particular API endpoint. Take a heap snapshot via Chrome DevTools (or `node --inspect`), hit the endpoint 100 times, take a second snapshot, and use the **Comparison** view to find what is retained between the two.

**Constraints.**
- Take both snapshots from the same process after forcing GC (the trash-can icon).
- Sort by "Delta" in the comparison view.
- Identify the top three constructors that grew.

**Hints.**
- Trigger GC before each snapshot to avoid noise from short-lived objects.
- Look at "Retainers" for each suspect object — follow the chain back to a global.
- A growing `Closure` or `(array)` often points to event listener accumulation.

**Self-check.**
- [ ] You have both snapshots saved as `.heapsnapshot` files.
- [ ] You named three constructors and their delta counts.
- [ ] You proposed a hypothesis (closure leak, listener leak, etc.).

### Task 16: Profile Python with cProfile and pyspy

**Problem.** A 30-second Python data import is too slow. Profile it with `cProfile` (deterministic) and with `py-spy` (sampling). Compare what each tells you and pick which one to trust for the optimization decision.

**Constraints.**
- `cProfile` output: top 20 by cumulative time.
- `py-spy record -o flame.svg -- python ...` for the flame graph.
- Write two paragraphs: what each tool says and why they disagree (if they do).

**Hints.**
- `cProfile` adds overhead; numbers may be skewed on hot paths.
- `py-spy` does not need code changes and works on running processes.
- For CPU-bound code, sampling profilers are usually truer to production behavior.

**Self-check.**
- [ ] You have `cProfile` output saved.
- [ ] You have a flame graph SVG saved.
- [ ] You picked one and justified it in one paragraph.

### Task 17: Find a goroutine leak with pprof

**Problem.** A Go service shows steadily increasing goroutine count over hours. Use `/debug/pprof/goroutine?debug=2` to dump all goroutines and identify which line of code is leaking them.

**Constraints.**
- Capture two dumps 10 minutes apart and diff them.
- Identify the source function and the blocking operation (channel send/receive, `sync.WaitGroup.Wait()`, etc.).

**Hints.**
- `curl http://localhost:6060/debug/pprof/goroutine?debug=2 > dump1.txt`
- Group goroutines by their top frame; the leak is usually 1000+ goroutines all blocked at the same line.
- Look for missing `context` cancellation or unbuffered channel sends with no receiver.

**Self-check.**
- [ ] You named the leaking function and line.
- [ ] You explained what they are blocked on.

---

## Advanced

These tasks are 4-to-8 hours each. They reward methodical investigation, not raw speed. Several have no single right answer — they have defensible writeups.

### Task 18: Diagnose and fix a flaky test

**Problem.** A test fails roughly 1 in 10 runs in CI but passes locally. Identify the source of non-determinism — time, randomness, ordering, network, filesystem, or concurrency — and ship a deterministic fix.

**Constraints.**
- Reproduce locally first (you may need to run it in a loop, throttle CPU, or add latency).
- Your fix must not be `@pytest.mark.flaky` or `retry: 3` in CI config — that's hiding it.
- Write a one-paragraph note explaining which class of flakiness it was.

**Hints.**
- Common culprits: `time.now()` in assertions, dict ordering in older Python, parallel test isolation, leftover state between tests, network calls without proper mocks.
- For race conditions: run with `pytest -n auto` (xdist) to amplify concurrency.
- For ordering issues: try `pytest --randomly-seed=12345` and see if a particular seed always fails.

**Self-check.**
- [ ] You can name the class of flakiness (time / order / concurrency / I/O / RNG).
- [ ] The test now passes 1000 consecutive runs.
- [ ] The fix is in the system under test or the test itself, not in CI retry config.

### Task 19: Write a postmortem from an incident timeline

**Problem.** You are given a Slack timeline of a 3-hour outage: alerts fired at 14:02, on-call paged at 14:05, mitigation at 16:30, full recovery at 17:00. Write the postmortem.

**Timeline.**
```
14:02  PagerDuty: p99 latency on /checkout > 5s
14:05  On-call Alex acks; checks dashboards
14:11  Alex: "DB CPU at 95%, checkouts queueing"
14:18  Alex restarts the checkout pod — no change
14:25  Bob joins; suspects a slow query from a deploy at 13:45
14:40  Bob runs `pg_stat_activity` — confirms one query at 90s avg
14:55  Bob identifies the new query: missing index on `orders.user_id`
15:10  Bob writes the index in staging — passes review at 15:35
15:40  Index DDL starts on prod (CREATE INDEX CONCURRENTLY)
16:30  Index finishes; latency drops to baseline
17:00  Customer-impacting errors fall to zero
```

**Constraints.**
- Use the headings: **Summary**, **Impact**, **Timeline**, **Root Cause**, **Contributing Factors**, **What Went Well**, **What Went Wrong**, **Action Items**.
- Blameless tone — describe systems, not people. Replace "Alex restarted the pod" with "the pod was restarted at 14:18".
- At least three concrete action items, each with an owner role and a date target.

**Hints.**
- Root cause is the missing index. **Contributing factors** include slow rollout review, lack of pre-deploy query plan checks, no alert on new long-running queries.
- Action items should be specific: "add a pre-merge check that EXPLAIN ANALYZE runs on schema-touching PRs" beats "improve our PR process".

**Self-check.**
- [ ] You used all eight headings.
- [ ] No engineer name appears in your prose.
- [ ] Action items have owners and dates, not just descriptions.

### Task 20: Walk a Go core dump with dlv

**Problem.** You have a core dump (`core.12345`) from a Go program that panicked. Use `dlv core <binary> <coredump>` to identify the panic message, the goroutine that panicked, and the line in your code that triggered it.

**Constraints.**
- Use only `dlv core`, no live process.
- Produce a one-paragraph writeup of the panic chain.

**Hints.**
- Ensure your binary is built with `-gcflags="all=-N -l"` for full debug info.
- On Linux, set `ulimit -c unlimited` and `GOTRACEBACK=crash` before running.
- Inside dlv: `grs` lists goroutines, `gr <id>` selects one, `bt` prints its stack.

**Self-check.**
- [ ] You quoted the panic message verbatim.
- [ ] You named the goroutine ID and its function.
- [ ] You named the file:line of the panic source (not where `runtime.gopanic` was called).

### Task 21: Count syscalls with bpftrace

**Problem.** Use `bpftrace` (or `bcc-tools/syscount`) to count system calls made by a target process over 30 seconds and identify the top three.

**Constraints.**
- Linux only; root or `CAP_BPF` required.
- Target a real workload — a `curl` loop, a database client, or your own service.
- Distinguish between counts and total time spent.

**Hints.**
- `bpftrace -e 'tracepoint:raw_syscalls:sys_enter /pid == $1/ { @[args->id] = count(); }' <pid>`
- `syscount -p <pid> 30` is the higher-level alternative.
- Lookup syscall IDs in `/usr/include/asm-generic/unistd.h` or use `ausyscall --dump`.

**Self-check.**
- [ ] You named three syscalls and their counts.
- [ ] You can explain why a busy process makes that many.

### Task 22: Generate a flame graph with perf

**Problem.** A C or Go CPU-bound program is too slow. Use Linux `perf` to record a profile, then convert it to a flame graph SVG using Brendan Gregg's `FlameGraph` toolkit.

**Constraints.**
- `perf record -F 99 -g -- <command>` for sampling at 99Hz with call graph.
- Produce an SVG using `stackcollapse-perf.pl | flamegraph.pl > out.svg`.
- Identify the widest stack frame and write a one-sentence interpretation.

**Hints.**
- For Go binaries, build with `-gcflags="all=-N -l"` or use `perf` with `--call-graph=dwarf` for proper symbols.
- Set `kernel.perf_event_paranoid = 1` in `/proc/sys` if access is denied.
- The widest frame is where most time is spent; the **tallest** stack is the deepest call chain, which is different.

**Self-check.**
- [ ] You produced an SVG flame graph.
- [ ] You named the widest frame.
- [ ] You can articulate the difference between width and depth in a flame graph.

**Sample Solution.**

```bash
# 1. Record with call graph (DWARF for accurate Go/C++ symbols)
perf record -F 99 -g --call-graph=dwarf -- ./my-cpu-program

# 2. Get the FlameGraph toolkit (one-time)
git clone https://github.com/brendangregg/FlameGraph /tmp/FlameGraph

# 3. Generate the SVG
perf script | /tmp/FlameGraph/stackcollapse-perf.pl > out.folded
/tmp/FlameGraph/flamegraph.pl out.folded > flame.svg

# 4. Open the SVG in a browser — it's interactive
xdg-open flame.svg

# Read it: width = time in that frame, height = call depth.
# A wide flat plateau at the top is your hotspot.
# A narrow deep tower is fine — that's just call depth, not slowness.
```

### Task 23: Reproduce a Heisenbug under load

**Problem.** A bug only appears under production load and disappears when you attach a debugger. Use `stress-ng` to simulate CPU and memory pressure, reproduce the bug locally, then write a deterministic test that catches it without `stress-ng`.

**Constraints.**
- `stress-ng --cpu 8 --io 4 --vm 2 --vm-bytes 1G --timeout 60s` while running your code.
- The deterministic test must run in under 10 seconds and pass/fail reliably.
- Document the underlying cause (race, GC pause, signal handling, etc.).

**Hints.**
- Heisenbugs under load are usually: races exposed by CPU contention, timeout-sensitive code, GC-induced latency, or signal-handling bugs.
- The deterministic version often uses `runtime.Gosched()`, explicit channel send order, or `sync.Mutex` instrumentation.
- For Go, `go test -race -count=100 -cpu=8` often catches what `stress-ng` would catch.

**Self-check.**
- [ ] You reproduced it under `stress-ng` at least once.
- [ ] Your deterministic test exists and passes/fails on demand.
- [ ] You can articulate why load was a necessary condition for the original repro.

### Task 24: Diagnose a memory leak that lives across two services

**Problem.** Service A calls service B via gRPC; A's memory grows steadily, but B's does not. Determine whether the leak is in A's gRPC client, A's caching layer, or B's response payload.

**Constraints.**
- Use `pprof` heap profiles on A.
- Capture two profiles 30 minutes apart and diff them.
- Your conclusion must rule out at least two of the three suspects with evidence.

**Hints.**
- `go tool pprof -base profile1 profile2 http://localhost:6060/debug/pprof/heap` shows growth between snapshots.
- Look at `inuse_space` for live allocations and `alloc_space` for total allocations.
- gRPC clients often leak when streams are not closed; check `metadata.MD` and `context` lifetimes.

**Self-check.**
- [ ] You ruled out two suspects with specific profile evidence.
- [ ] You named the leaking type and the call site that allocates it.
- [ ] You proposed a fix you can defend.

### Task 25: Trace a distributed request with OpenTelemetry

**Problem.** A user reports their checkout took 12 seconds. You have OTEL traces enabled across 5 services. Find the request, identify which span dominated, and produce a one-paragraph writeup of where the time went.

**Constraints.**
- Use Jaeger or Tempo UI (or `curl` against the trace API).
- Identify the longest **non-overlapping** span — not the longest total span, which would just be the root.
- Explain whether the dominant span was waiting on I/O, CPU, or a downstream service.

**Hints.**
- Find the trace by `trace_id` or by filtering on `user.id` if you tag spans with it.
- Look at the Gantt-style view; the longest bar that does not have a child longer than itself is your bottleneck.
- "Span events" annotate things like cache misses or retries; check them.

**Self-check.**
- [ ] You named the trace_id and the offending span.
- [ ] You classified the bottleneck as I/O, CPU, lock contention, or downstream.

---

## Capstone

These are open-ended scenarios. The point is not to find one correct answer but to design and defend a complete approach. Treat each as if you are pitching it to a staff engineer at a design review.

### Task 26: Investigate a recurring Monday 9am outage

**Problem.** You join a team where every Monday at 9am, a critical service crashes for 5 minutes and recovers on its own. The team has lived with it for three months. Design the investigation.

**Constraints.**
- You may not push code in the first week — investigation only.
- Your plan must enumerate hypotheses, the data needed to confirm or refute each, and the order in which you'd pursue them.
- Include a "what if it's something we have not thought of" branch.

**Hints.**
- Monday 9am hypotheses: cron jobs (weekly DB maintenance, backup completion), user behavior (Monday-morning login surge), TLS cert rotation, dependency restart, traffic shift from a CDN PoP.
- Data sources: dashboards (4 weeks history), incident logs, deploy history, infra change history, cron schedules.
- A good plan has a "kill switch" — at what point do you stop investigating and just add capacity?

**What "done" looks like.** You have a written plan with 5-7 hypotheses ranked by likelihood and ease of confirmation. Each hypothesis names the metric or log you'd look at, and the test result that would confirm or rule it out. The plan includes a check at 14 days — if you have not found the cause by then, you have a fallback that buys time (autoscale aggressively at 8:45am, page proactively, etc.). You can present this to your manager in 10 minutes and they understand the gates and decisions.

### Task 27: Design a debug mode for a production service

**Problem.** A production service has no debug logging because debug logs would flood the system. Design and implement a "debug mode" that can be turned on for a specific request (via header) or a specific user (via flag), without restarting the service or affecting other traffic.

**Constraints.**
- Header-triggered: `X-Debug: 1` enables debug logging for that request only.
- Flag-triggered: a feature flag for user IDs in a set enables debug for them.
- Logs must include `traceparent` from the incoming request so they correlate with traces.
- The mechanism must add zero overhead when not active (cheap branch only).

**Hints.**
- Per-request debug requires propagating a debug flag through `context.Context` (Go), `contextvars` (Python), or `MDC` (Java).
- Sample only requests where the header is set; do not sample randomly when debug is on.
- For trace propagation, follow the W3C `traceparent` header spec.

**What "done" looks like.** You have working code for at least one language (Go preferred). The middleware checks the header, sets a debug flag in context, and a logger helper checks the flag before emitting. You wrote a load test showing < 1% overhead when debug is off and < 5% overhead when on. The traceparent is preserved and you can show, end-to-end, a trace in Jaeger plus a correlated log line in your log backend. You wrote a one-page operator doc: "How to debug a specific request in prod."

**Sample Solution.**

```go
package main

import (
    "context"
    "log/slog"
    "net/http"
    "os"
)

type debugKey struct{}

// withDebug returns a context that carries the debug flag.
func withDebug(ctx context.Context, on bool) context.Context {
    return context.WithValue(ctx, debugKey{}, on)
}

// debugEnabled is the cheap branch used on every log call.
func debugEnabled(ctx context.Context) bool {
    v, _ := ctx.Value(debugKey{}).(bool)
    return v
}

// DebugMiddleware sets the flag when X-Debug: 1 is present.
// It also extracts traceparent so logs correlate with traces.
func DebugMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()
        if r.Header.Get("X-Debug") == "1" {
            ctx = withDebug(ctx, true)
        }
        if tp := r.Header.Get("traceparent"); tp != "" {
            ctx = context.WithValue(ctx, "traceparent", tp)
        }
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// dlog logs at debug level only when the context says so.
func dlog(ctx context.Context, msg string, args ...any) {
    if !debugEnabled(ctx) {
        return // zero-allocation early return
    }
    if tp, ok := ctx.Value("traceparent").(string); ok {
        args = append(args, "traceparent", tp)
    }
    slog.Default().Debug(msg, args...)
}

func handler(w http.ResponseWriter, r *http.Request) {
    dlog(r.Context(), "starting handler", "path", r.URL.Path)
    // ... real work ...
    dlog(r.Context(), "finished handler")
    w.Write([]byte("ok"))
}

func main() {
    slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
        Level: slog.LevelDebug,
    })))
    http.Handle("/", DebugMiddleware(http.HandlerFunc(handler)))
    http.ListenAndServe(":8080", nil)
}

// Test:
// curl -H "X-Debug: 1" -H "traceparent: 00-...-...-01" localhost:8080/
// → debug logs include traceparent; without the header → no debug noise.
```

### Task 28: Add minimum observability to a legacy service

**Problem.** You inherit an 80-endpoint legacy service with no metrics, no structured logs, and no traces. Stakeholders want to "be able to diagnose any reasonable production bug within 1 hour" — but you have a one-week budget. Decide the minimum observability you can add.

**Constraints.**
- You may not refactor business logic.
- The observability you add must work behind a single feature flag.
- Define what "any reasonable bug" means in scope — be honest about what is excluded.

**Hints.**
- The 80/20 of observability: per-endpoint p50/p95/p99 latency, error rate, request count; structured access log; a single distributed-trace span per request.
- Tagging by endpoint, status code, and a small handful of high-cardinality dimensions (user_id tier, not user_id itself) gives you 90% of debugging power.
- Be deliberate about what you do NOT add: per-function tracing, debug logs on every line, full-body request logging.

**What "done" looks like.** You have a written design that lists: (1) the three metrics you add and what dashboards they feed, (2) the log fields you standardize and the format, (3) the one trace span per request and how it propagates, (4) the feature flag and rollout plan, (5) the explicit list of bug classes this WON'T help diagnose. You produced a small PR (10-20 files) that adds it. You can demo: trigger an artificial error and find it through your dashboards and logs in under 60 seconds.

### Task 29: Write a first-30-minutes high-latency runbook

**Problem.** Write a runbook titled "First 30 minutes diagnosing high latency in a service you've never seen before" for an on-call engineer who has never seen the service.

**Constraints.**
- Maximum 2 pages, with clear time-boxed steps (5 minutes each).
- Tool-agnostic where possible; if you assume a tool, name it (Datadog, Grafana, Jaeger).
- Must include a decision point at 30 minutes: "If you have not made progress, page these people and escalate."

**Hints.**
- Minute 0-5: confirm the alert is real (check the dashboard, not just the page).
- Minute 5-10: scope the impact (which endpoints? which users? when did it start?).
- Minute 10-15: check recent deploys and infra changes.
- Minute 15-25: dig into the most-affected endpoint (logs, traces, downstream).
- Minute 25-30: form a hypothesis and decide — mitigate now or investigate more?

**What "done" looks like.** Your runbook is short enough to read in 5 minutes and detailed enough to act on. It does not assume the engineer knows the system. It has explicit copy-pasteable commands for the most common queries ("show me the slowest endpoint in the last hour"). It tells the engineer when to stop investigating and start mitigating (rollback, traffic shift, autoscale). Your team can use it on a real incident and report whether it helped.

---

## If you can do all of these, you have the senior level

You can pick up an unfamiliar codebase in any of Go, Python, Java, or Node, and within an hour have a working debugging setup. You can reach for pprof, jstack, strace, or DevTools without thinking about which one. You can lead an incident through investigation, mitigation, and postmortem. You can write the runbook and the debug-mode design that the next engineer relies on. The next step is not more debugging exercises — it is teaching this to the next engineer, and designing systems that need less debugging to begin with.

---

## Related Topics

- [Debugging — Junior](junior.md)
- [Debugging — Middle](middle.md)
- [Debugging — Senior](senior.md)
- [Debugging — Professional](professional.md)
- [Debugging — Interview](interview.md)
- Sibling diagnostic topics: [Error Handling](../error-handling/README.md), [Logging](../logging/README.md)
- Cousins: [Clean Code — Error Handling](../../code-craft/clean-code/06-error-handling/README.md)
