# pprof Deep Dive — Getting the Most Signal

## 1. The goal of this file

A pprof profile contains far more signal than the default views show. The default `top` is fine; the default flame graph is fine; but the engineers who solve hard performance problems are the ones who know *which view to use for which question*, and how to coax pprof into showing it. The rest of this file is that craft.

---

## 2. Choose the right view for the question

| Question | Best view | Why |
|----------|-----------|-----|
| "Where is CPU going overall?" | Flame graph | Width = share; eyes parse it instantly |
| "What's the hottest leaf?" | `top` (flat sort) | Sorted by self time |
| "What does this subtree cost?" | `top -cum` | Sorted by cumulative |
| "Why does this function take so long?" | `peek <fn>` | Splits cost between callees |
| "Which line of this function is slow?" | `list <fn>` with `granularity=lines` | Per-line accounting |
| "What is the assembly doing?" | `disasm <fn>` or `weblist <fn>` | Instruction-level |
| "Which call paths exist?" | `traces` | Every sample's stack |
| "Show only my code" | `focus=mymodule` + `ignore=runtime\.` | Filter regex |
| "What changed?" | `-base` diff | Subtract baseline |

Most engineers know the first three. The next three answer the questions where the first three give up.

---

## 3. The flame graph, properly

A pprof flame graph (icicle, technically — root at top) has three properties:

1. **Width** = share of the selected sample type.
2. **Vertical order** = call depth (root → leaf, top → bottom).
3. **Horizontal order** is **not** time. Boxes are sorted alphabetically by function name within each parent.

People misread the third constantly. A wide left box is not "what ran first". It's "what was the most expensive child of its parent, alphabetically placed".

Useful interactions:

- **Click to zoom.** The clicked box becomes the new root, and its width becomes 100%. The breadcrumb at the top lets you climb out.
- **Search box.** Type a function name; matching boxes get a pink outline. Great for "where is `parseLine` in this huge graph?"
- **Reset.** The "Refine → Reset" or the breadcrumb root link.

When the flame graph is too noisy: use Refine → Hide to drop frame names you don't care about (`^runtime\.`, `^reflect\.`). When the flame graph is too sparse: switch sample types in the top-right menu — `alloc_objects` is a different shape than `inuse_space`.

---

## 4. `peek` is underrated

Most performance work flows like this: see a hot function → wonder if it's slow because of *what it calls* or *what it does* → don't know which. `peek` answers in one command.

```
(pprof) peek json.Unmarshal
----------------------------------------------------------+-------------
      flat  flat%   sum%        cum   cum%   calls calls% + context
----------------------------------------------------------+-------------
                                            2.50s 100% |   main.parseEvent
     200ms  3.84%  3.84%      2.50s 47.98%                | encoding/json.Unmarshal
                                            1.40s 56.00% |   encoding/json.(*decodeState).object
                                            0.60s 24.00% |   encoding/json.(*decodeState).array
                                            0.30s 12.00% |   encoding/json.(*decodeState).literal
```

Read it: `json.Unmarshal` has 200 ms flat and 2.5 s cum. The 2.3 s difference is split among callees. Most goes to `decodeState.object`. If you want to make this call faster, you're really making `decodeState.object` faster — which means avoiding object-shaped JSON if you can, or switching to a code-generated decoder.

Use `peek` whenever you want to ask "of this function's cost, where exactly does it go?".

---

## 5. Granularity tricks

```
(pprof) granularity=lines
(pprof) top 20
```

Now `top` is "the 20 most expensive *source lines*". This is the form in which most optimizations become obvious. A function might have one expensive expression and twelve cheap ones — `top` collapses that into one row, which can mislead. `granularity=lines` doesn't.

```
(pprof) granularity=files
(pprof) top
```

Useful when one package dominates and you want to know which *file* of it. Files often correspond to subsystems; this gives a fast structural view.

`granularity=addresses` is for assembly-level work. Pair it with `disasm`.

---

## 6. Custom views — slicing by label

If your service uses profile labels (and it should), every slice is one shell command:

```
(pprof) tagfocus=route=/api/v1/checkout
(pprof) top
```

Now the profile is *only* CPU samples from `/api/v1/checkout` handlers. Compare with another route:

```
(pprof) tagfocus=route=/api/v1/healthz
(pprof) top
```

These two `top` outputs side-by-side tell you whether checkout is structurally more expensive than healthz, or whether something specific to that route is misbehaving.

`tagfocus` supports multiple labels, comma-separated keys, regex values:

```
tagfocus=tenant=^acme.*,route=/api/v1/.*
tagignore=priority=low
```

---

## 7. Diff views — subtraction is the most powerful command

When optimizing, the question is never "is the new version fast?". It's "is the new version faster than the old version, by how much, in which functions?". Answer with `-base`:

```
go tool pprof -http=: -base=before.pb.gz after.pb.gz
```

The web UI shows only the *delta*. The flame graph is now "added cost"; functions that got faster are absent. If the top is dominated by your changes, you regressed there. If the top is empty (no functions over 0.5% added), the change is net-neutral or positive.

`-diff_base` is the signed view: both red (added cost) and green (saved cost). Use it when you want a fuller picture.

A subtle point: `-base` is **value subtraction**, not stack-set subtraction. A stack present in both profiles with values (10s, 12s) becomes (2s) in the `-base` view. A stack present only in `after` keeps its full value. A stack present only in `before` is shown as negative (in `-diff_base`) or omitted (in `-base`).

---

## 8. Finding "small but everywhere" costs

The classic trap: your code has no obvious hotspot. The flame graph is flat — no box is wider than 5%. That's often a sign of "many small repeated costs" distributed across the call graph.

Tactic: collapse the call graph and look at leaves.

```
(pprof) hide=^main\.   # hide your wrappers
(pprof) top 30
```

If the top is dominated by `runtime.mallocgc`, `runtime.memmove`, `runtime.growslice`, `runtime.convT64`, `runtime.gcWriteBarrier` — you have an allocation/copy problem, not a CPU problem. Switch to the heap profile.

If the top is `runtime.gopark`, `runtime.selectgo`, `runtime.chanrecv` — you have synchronization overhead. Block / mutex profile.

If the top is `syscall.Syscall`, `runtime.netpollWait` — you're I/O bound, and pprof can't help much. Move to `trace`.

---

## 9. Heap profile: alloc rate vs. retained memory

Heap profile carries four columns. Beginners often look at one column without realizing they're answering the wrong question.

| Symptom | Column to read |
|---------|----------------|
| RSS too high, climbing | `inuse_space` |
| Lots of small objects | `inuse_objects` |
| GC burning CPU | `alloc_space` and `alloc_objects` |
| Latency spikes during GC | `alloc_objects` |

The transformations:

```
(pprof) sample_index=inuse_space   # current bytes
(pprof) sample_index=inuse_objects # current count
(pprof) sample_index=alloc_space   # total bytes ever allocated
(pprof) sample_index=alloc_objects # total objects ever allocated
```

If `inuse_space` is dominated by one function but `alloc_space` is dominated by another, the first owns long-lived memory and the second produces churn. The optimizations are different: pool the second, redesign the first.

---

## 10. Block and mutex: what they actually show

Block profile = "where did goroutines spend wall-clock time blocked on **anything** (channels, select, sync.WaitGroup, network I/O)". Mutex profile = "where did goroutines wait specifically on **mutex contention**".

A common pattern: block profile is dominated by `runtime.gopark` from channel receive. That's *normal* — a worker pool sitting waiting for work is in `gopark`. It's not a bug. Filter:

```
(pprof) ignore=runtime\.gopark
(pprof) top
```

Or focus only on your blocking code:

```
(pprof) focus=mymodule
```

The mutex profile is more direct: every sample is contention you could remove with a different design (sharding, atomic, RWMutex, lockless). When the mutex profile is dominated by one mutex, that's your first target.

---

## 11. `traces` for attribution

When the call graph collapses paths you care about, `traces` is the escape hatch.

```
(pprof) traces | grep -A 10 parseHeader
```

Now you see every CPU sample that touched `parseHeader`, with its full stack and value. Useful when:

- One function appears in many call paths and you want to see which path is hot.
- You suspect a specific call chain but pprof's graph merges it with others.
- You're scripting analysis (`traces` output is greppable).

`traces` output can be huge for big profiles; pipe through `less`, `grep`, or `head`.

---

## 12. Limiting noise — nodefraction and edgefraction

The default graph hides nodes below 0.5% and edges below 0.1%. For a profile where the top is wide and the tail is narrow, that's right. For a profile where everything is small, raise them:

```
(pprof) nodefraction=0.02
(pprof) edgefraction=0.01
(pprof) web
```

For a profile where you suspect something below 0.5%, lower them:

```
(pprof) nodefraction=0.0001
(pprof) edgefraction=0.0001
(pprof) web
```

`nodecount=N` is a hard cap on graph nodes (useful when the SVG is too big to load).

---

## 13. Source view tricks

The web UI's Source view annotates lines with the cost charged to each. Three reading rules:

1. **Look for one outlier line.** A function with mostly cold lines and one hot one is the easiest possible optimization target.
2. **Sum the cold lines.** If 40% of the function's cost is spread across 30 lines of "boring" code (assignments, returns), you can't speed those up. Look elsewhere.
3. **Watch for inlining.** A hot line that contains a function call shows the *callee's* cost. To see whether the cost is the call site itself or the function it calls, click into the callee.

`weblist <regex>` in the shell renders source + assembly together; useful when you're debating whether a Go statement compiles to one instruction or twenty.

---

## 14. Disassembly when source isn't enough

```
(pprof) disasm parseLine
```

You'll see Go assembly with per-instruction time. Things to look for:

- **`MOVQ` heavy:** lots of moves, probably struct copies or large value passing.
- **`CALL runtime.mallocgc`:** an allocation that's hot.
- **Loops:** identify the loop body by following backward jumps. Make sure you understand whether the hot work is inside or outside the loop.
- **Function prologue:** the first few instructions (stack frame allocation). If they dominate, the function is being called *very* often relative to its work.

You'll rarely need this. But for inner-loop optimization, source-level lying (inlined helpers, compiler reordering) is real and `disasm` is the only ground truth.

---

## 15. Saving custom views

The shell remembers your filters between commands. To capture a view as a script:

```
go tool pprof -focus=parseLine -ignore=runtime\. -sample_index=alloc_objects \
  -text -lines heap.pb.gz > parseLine_allocs.txt
```

`-text` skips the shell; `-lines` is the granularity flag. Pipe to a file, commit to a debugging ticket. The next reader gets your exact view without learning your filter sequence.

For the web UI, the current URL encodes the filters. Bookmark or paste it into the ticket.

---

## 16. The "is this real?" sanity loop

Profiles lie occasionally. Sanity checks before you spend a day optimizing:

1. **Is the workload representative?** A profile of an idle service shows runtime overhead by default. Make sure traffic was flowing.
2. **Was the profile long enough?** For a 100 Hz sampler, 30 s gives ~3000 samples per CPU. If your hot function appears in 5 samples, that's noise.
3. **Did you switch `sample_index` correctly?** A heap profile defaulting to `inuse_space` looks empty when the real story is in `alloc_objects`.
4. **Cross-check with metrics.** If pprof says GC is 30% of CPU and `runtime/metrics` says 5%, one of you is wrong.
5. **Diff against a known-good baseline.** A profile in isolation is just data. A diff is information.

If two of these are off, your interpretation will be off.

---

## 17. Building intuition

The fastest way to build flame-graph intuition is to read other people's. Pyroscope's playground, the Go runtime source tests, and demo profiles from talks (e.g., Felix Geisendörfer's posts) are all good. Pattern-match enough flame graphs and you start to *see* whether a service is allocation-heavy, lock-heavy, or syscall-heavy from a glance.

Pair this with a habit of profiling boring code occasionally — your own personal projects, an open-source service, a benchmark — even when nothing's broken. The skill compounds.

---

## 18. Summary

Getting signal out of pprof is mostly about choosing the right view. Flame graphs for shape, `top` and `peek` for cost attribution, `list` and `disasm` for line- and instruction-level work, `traces` for path attribution, labels for slicing, diffs for measuring change. Switch `sample_index` whenever you switch questions; tune `nodefraction` when the graph is unreadable; cross-check with `runtime/metrics` when numbers feel off. Most of what beginners experience as "the profile didn't tell me much" is one of these adjustments away.

---

## Further reading
- "Flame Graphs" by Brendan Gregg: https://www.brendangregg.com/flamegraphs.html
- "Profiling Go programs with sample labels": https://rakyll.org/profiler-labels/
- "How to read a flame graph (Polar Signals)": https://www.polarsignals.com/blog
- `pprof` interactive help: type `help` inside the shell
