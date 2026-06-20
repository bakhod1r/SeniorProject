# Coverage Tooling per Language — Senior Level

> **Roadmap:** [Code Coverage](../README.md) → Coverage Tooling per Language
> *The middle page taught you to run each tool and read its report. This page is about the machinery underneath: how instrumentation actually counts a line, why two tools disagree about the same code, what optimization does to your numbers, and how to collect and merge coverage across processes, machines, and languages without lying to yourself.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Two Instrumentation Families](#the-two-instrumentation-families)
4. [Source/AST Rewriting — Istanbul and coverage.py](#sourceast-rewriting--istanbul-and-coveragepy)
5. [Compiler & Runtime Counters — LLVM, gcov, JaCoCo, Go](#compiler--runtime-counters--llvm-gcov-jacoco-go)
6. [Why the Tools Disagree](#why-the-tools-disagree)
7. [Coverage of Optimized and Inlined Code](#coverage-of-optimized-and-inlined-code)
8. [Collecting Coverage from Integration, E2E, and Production](#collecting-coverage-from-integration-e2e-and-production)
9. [Merging Heterogeneous Coverage](#merging-heterogeneous-coverage)
10. [Flaky Coverage, Concurrency, and Atomic Counters](#flaky-coverage-concurrency-and-atomic-counters)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The instrumentation mechanisms behind coverage, their accuracy limits, and the hard problems of collecting and combining coverage across processes, machines, and languages.**

By the middle level you can run `go test -coverprofile`, `pytest --cov`, `jacoco`, and `llvm-cov`, and read the HTML drill-down each produces. That makes you productive. The senior jump is understanding *how the number is produced* — because the moment you trust a coverage number to gate a merge, ship a release, or prove a refactor is safe, you have to know what it can and cannot see.

Every coverage tool answers one question — "was this region executed?" — but they answer it with radically different mechanisms: rewriting your source before it compiles, asking the compiler to emit counters, patching bytecode as it loads, or reading hardware-adjacent profile data. Each mechanism has a different *unit* (statement, line, basic block, branch region), a different *accuracy* under optimization, a different *overhead*, and a different *file format*. This page is that layer: the instrumentation families, why they disagree, what `-O2` does to your line numbers, how to capture coverage from a long-running server or a browser E2E run, and how to merge a Go integration profile, a JaCoCo dump, and an Istanbul JSON into one honest report.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — running each language's coverage tool, reading lcov/cobertura output, and the line-vs-branch distinction from [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/senior.md).
- **Required:** You understand compilation basics — source → IR → machine code, and what "basic block" and "control-flow graph" mean.
- **Helpful:** You've debugged a "this line shows uncovered but I know it runs" mystery and want to know *why*.
- **Helpful:** A working memory of how a long-running server process starts, handles requests, and shuts down — because that's where production coverage lives or dies.

---

## The Two Instrumentation Families

Strip away the vendor names and every coverage tool belongs to one of two families, distinguished by *when* and *at what level* it inserts the counting.

**Family A — Source / AST rewriting.** The tool parses your source into an AST, injects counter-increment statements at the start of every statement/branch, and emits rewritten source (or rewritten bytecode at the source-language level). The program you run is *not* the program you wrote. Istanbul (`nyc`) for JavaScript and the line-tracing core of coverage.py for Python live here, as does JaCoCo in spirit (it rewrites bytecode, the JVM's "source-adjacent" form).

**Family B — Compiler / runtime counters.** The tool asks the *compiler* to emit counters into the generated object code, or a runtime to maintain them. The source is compiled normally (semantically); the compiler inserts counter increments tied to a *coverage mapping* that says which counter corresponds to which source region. LLVM source-based coverage (`-fprofile-instr-generate -fcoverage-mapping`), gcc's gcov (`.gcno`/`.gcda`), and Go's compiler-inserted counters live here.

The split matters because it determines *what the tool can possibly know*:

| | Family A — Source/AST rewrite | Family B — Compiler/runtime counters |
|---|---|---|
| Counting unit | statement / line / AST node | basic block / coverage-mapping region |
| Knows about optimization? | No — runs before/instead of the optimizer's view | Yes — counters survive into optimized codegen (LLVM) or are inserted pre-opt (gcov/Go) |
| Branch accuracy | derived from AST shape | derived from the CFG the compiler actually built |
| Overhead | high (extra statements, larger code) | lower (counter is often a single increment) |
| Build integration | a preprocessor / loader hook | a compiler flag |
| Canonical tools | Istanbul/nyc, coverage.py, JaCoCo | llvm-cov, gcov, Go `-cover` |

> **Key insight:** A coverage number is only as truthful as the *model of the program* its instrumentation holds. Source-rewriting tools count the program *as written*; compiler-counter tools count the program *as the compiler sees it*. When those two models diverge — inlining, macro expansion, optimization, dead-code elimination — the two families produce different numbers for the same code, and *neither is wrong*. They're answering subtly different questions.

---

## Source/AST Rewriting — Istanbul and coverage.py

**Istanbul (JavaScript/TypeScript).** Istanbul's instrumenter (`istanbul-lib-instrument`, driven by `nyc` or built into Jest/Vitest/Babel) parses each module with Babel, walks the AST, and inserts a per-module **coverage object** plus increment expressions. For a function `function f(x){ if (x) return 1; return 2; }` it rewrites roughly to:

```js
function f(x) {
  cov_abc().f[0]++;                 // function entered
  cov_abc().s[0]++;                 // statement 0
  if ((cov_abc().b[0][x ? 0 : 1]++, x)) {   // branch 0, arm 0 or 1
    cov_abc().s[1]++;
    return 1;
  }
  cov_abc().s[2]++;
  return 2;
}
```

The `cov_abc()` accessor returns a global object holding three maps — `s` (statements), `b` (branches, each an array of arm counters), `f` (functions) — keyed against a **statement map** that records the exact source range (`start`/`end` line+column) of each id. At the end of the run the global `__coverage__` object is serialized to JSON; `nyc report` turns that into lcov, HTML, or text. Because the column-precise statement map is built from the AST, Istanbul can report *partial-line* coverage (two statements on one line, one covered) — column precision that line-based tools cannot match.

The cost: the rewritten code is larger and slower (every statement is now two statements), and the rewrite happens against *source*, so it must run before bundling/minification — which is why coverage of transpiled TypeScript needs source-maps to map counters back to `.ts` lines, and why a misconfigured source-map silently misattributes coverage to the wrong file.

**coverage.py (Python).** Python's reference tool historically used a `sys.settrace` line tracer: the interpreter calls a Python (or C) trace function on *every line event*, and coverage.py records the `(filename, lineno)` pairs seen. This is a pure-runtime Family-A mechanism — no source rewriting, but the *unit is the line* as the interpreter reports it via the code object's line table. It is accurate for lines but expensive (a callback per line) and historically could not distinguish two branches on one line.

Two modern shifts matter:

1. **The C tracer and `sys.monitoring` (PEP 669, Python 3.12+).** coverage.py 7.x can use CPython's new low-overhead monitoring API instead of `settrace`, cutting tracing overhead dramatically (often from ~2–5x down to a small fraction) by letting the interpreter disable per-line events once a line is seen.
2. **Branch coverage** (`--branch`): coverage.py models branches as *arcs* between line numbers — pairs `(from_line, to_line)` taken in the control flow — and reports a branch as partial when some but not all outgoing arcs of a line were taken. This arc model is why coverage.py's branch report sometimes flags an "exit not taken" on the last line of a function: the arc to the implicit return was never exercised.

```bash
coverage run --branch -m pytest          # trace with branch arcs
coverage combine                         # merge parallel .coverage.* data files
coverage report -m                       # show missing lines + partial branches
coverage xml                             # cobertura XML for CI
coverage html                            # drill-down with per-arc annotation
```

> **Key insight:** Source/AST instrumentation gives you *column-precise, source-shaped* coverage — Istanbul can tell you which of two statements on a line ran — but it pays for it in overhead and in a hard dependency on source-maps when the code is transpiled or bundled. The instrumentation lives *above* the optimizer, so it never lies about optimization, but it can lie about *which file* a line belongs to if the map is wrong.

---

## Compiler & Runtime Counters — LLVM, gcov, JaCoCo, Go

This family pushes counting down into (or past) the compiler. Four concrete mechanisms, each with its own file formats.

### LLVM source-based coverage

The most precise of the compiler-counter approaches, used by C/C++ (Clang), Swift, and Rust (`grcov`, `cargo-llvm-cov`). You compile with two flags:

```bash
clang -fprofile-instr-generate -fcoverage-mapping -O0 prog.c -o prog
```

- `-fprofile-instr-generate` makes the compiler insert **counter increments** into the IR and link the profiling runtime (`compiler-rt`'s profile library).
- `-fcoverage-mapping` emits a **coverage mapping** — a table, stored in a `__llvm_covmap` section of the binary, that maps each counter to a set of **source regions** (file, start line:col, end line:col) and even *counter expressions* (region C's count = region A − region B), which is how LLVM derives the "else" branch count without a separate counter.

The data flow is three explicit formats:

```
run binary  →  *.profraw   (raw, per-process counter dump)
              ↓  llvm-profdata merge
              *.profdata   (indexed, merged, the queryable form)
              ↓  llvm-cov  (joins profdata + the binary's __llvm_covmap)
              report / lcov / HTML
```

```bash
LLVM_PROFILE_FILE="prog-%p.profraw" ./prog      # %p = pid → one file per process
llvm-profdata merge -sparse prog-*.profraw -o prog.profdata
llvm-cov report  ./prog -instr-profile=prog.profdata
llvm-cov show    ./prog -instr-profile=prog.profdata -format=html -o cov-html
llvm-cov export  ./prog -instr-profile=prog.profdata -format=lcov > prog.lcov
```

The crucial design point: **`llvm-cov` needs the binary**, because the coverage *mapping* lives in the binary, not in the profile. The `.profdata` only carries counter values; the binary carries the region table that gives those counters meaning. This is why a profile from one binary cannot be read against a different build — the counter indices won't line up. `LLVM_PROFILE_FILE` controls the output path, with `%p` (pid), `%m` (binary signature, for merge-on-the-fly), and `%c` (continuous mode) substitutions that are the key to multi-process collection (below).

### gcc gcov

The GNU equivalent, older and basic-block-graph based:

```bash
gcc --coverage -O0 prog.c -o prog    # = -fprofile-arcs -ftest-coverage
```

- At compile time, `-ftest-coverage` emits a **`.gcno`** file per object — the *notes* file: the basic-block graph and the line→block mapping, written once at build time.
- At run time, `-fprofile-arcs`-instrumented code writes a **`.gcda`** file per object on exit — the *data* file: the arc/edge execution counts. gcov instruments a spanning tree of CFG arcs and derives the rest by flow conservation (count in = count out), so it stores fewer counters than there are edges.

```bash
./prog                          # writes prog.gcda next to prog.gcno
gcov prog.c                     # produces prog.c.gcov (annotated source)
lcov --capture --directory . --output-file prog.info   # → lcov format
genhtml prog.info --output-directory cov-html
```

The `.gcno`/`.gcda` split is gcov's defining trait: structure is fixed at build time, counts accumulate at run time, and *both must come from the same build* or the block graph won't match the counts. `gcov` itself is also tied to the *compiler version* — a `.gcda` written by one gcc and read by a different gcov version can fail with a version-mismatch error.

### JaCoCo — on-the-fly ASM bytecode probes

JaCoCo (the JVM standard) is Family A in mechanism (it rewrites bytecode) but feels like Family B operationally (no separate compile step). A Java agent (`-javaagent:jacocoagent.jar`) hooks classloading and, using the **ASM** bytecode library, inserts boolean **probes** into each method's bytecode *as the class loads* — "on-the-fly instrumentation." A probe is set when control passes a point in the CFG. JaCoCo places probes at branch targets and method entries/exits and from them derives **instruction**, **branch**, **line**, **method**, and **complexity** (cyclomatic) coverage.

```bash
java -javaagent:jacocoagent.jar=destfile=jacoco.exec,append=true -jar app.jar
java -jar jacococli.jar report jacoco.exec \
     --classfiles target/classes --sourcefiles src/main/java \
     --html report --xml jacoco.xml
```

The runtime artifact is `jacoco.exec` — a compact binary file of probe bitmaps keyed by class id and a CRC of the class bytes. Critically, **the report step needs the original class files and sources**, just like `llvm-cov` needs the binary: `jacoco.exec` only says "probe N of class with CRC X was hit," and the report step re-instruments the same classes to map probes back to lines. A class-id/CRC mismatch (you reported against recompiled classes) silently drops that class from the report. JaCoCo can also instrument *offline*, but on-the-fly via the agent is the norm and is what makes dumping coverage from a *running* server possible.

### Go — compiler-inserted counters

Go builds coverage into the toolchain. With `go test -cover` (or, since Go 1.20, `go build -cover`), the compiler rewrites each function during compilation to increment a per-statement counter, governed by `-covermode`:

```bash
go test -covermode=atomic -coverprofile=cover.out ./...
go tool cover -func=cover.out          # per-function summary
go tool cover -html=cover.out          # browser drill-down
```

- `-covermode=set` — each counter is a boolean "was this block executed" (cheapest, default for `go test`).
- `-covermode=count` — each counter is an integer hit count (how many times).
- `-covermode=atomic` — counts using `sync/atomic`, **required** for correctness under concurrency (see the atomic-counters section). Mandatory whenever instrumented code runs across goroutines.

The legacy text `coverprofile` format is line-oriented and human-greppable:

```
mode: atomic
github.com/me/app/handler.go:12.34,15.2 3 1
#                          ↑start  ↑end ↑numStmts ↑count
```

Each line is `file:startLine.startCol,endLine.endCol numStatements executionCount`. Go 1.20 introduced a *new binary* coverage format (used by `-cover` builds emitting to `GOCOVERDIR`) precisely because the text format couldn't efficiently represent integration coverage from many processes — `go tool covdata` reads that directory form (below).

> **Key insight:** Every compiler-counter tool separates *structure* (the region/block map: LLVM's `__llvm_covmap`, gcov's `.gcno`, JaCoCo's class CRC + re-instrumentation, Go's profile ranges) from *counts* (LLVM `.profdata`, gcov `.gcda`, JaCoCo `.exec`, Go's counter file). Structure is bound to a specific build; counts are accumulated at run time. Mismatch the two — report against a different build than you ran — and the tool either errors or silently misattributes. This single fact explains most "coverage tooling is broken" tickets.

---

## Why the Tools Disagree

Hand the same 200-line file to Istanbul, coverage.py, gcov, and JaCoCo and you will get four different denominators and four different percentages. The disagreements are structural, not bugs:

1. **Different units.** Istanbul counts *statements* and AST *branches* with column precision; coverage.py counts *lines* (and arcs); gcov and LLVM count *basic blocks / regions*; JaCoCo counts *bytecode instructions* and branches and *derives* lines. A line with three statements is "one line" to coverage.py, "three statements" to Istanbul, and several instructions to JaCoCo. The denominators are literally different things.

2. **What counts as a "branch."** A `&&`/`||` short-circuit is one decision with two conditions. MC/DC-aware tools (some LLVM modes, JaCoCo's branch view) expand it into multiple branch arms; a line-based tool sees one line. The `01-line-branch-path-coverage` subsumption hierarchy is the theory; *this* is where it bites in tooling.

3. **Excluded regions.** Each tool excludes different code: generated files, vendored code, lines marked `// coverage:ignore` (Go via build tags / `//go:` directives), `# pragma: no cover` (coverage.py), `/* istanbul ignore next */`, JaCoCo's `@Generated` and lombok handling. Two tools with different exclude defaults disagree before counting a single line.

4. **Optimization and inlining.** Compiler-counter tools see the *optimized* CFG; source tools see the *source*. An inlined function's body may be counted at the call site, attributed to multiple callers, or attributed to the wrong line (next section).

5. **Implicit code.** Compiler tools count synthesized code — default constructors, destructors, `defer` machinery, generic instantiations, `switch` jump tables — that has no obvious source line. coverage.py's arc model invents an arc to the implicit function exit. These phantom regions move the denominator.

> **Key insight:** "Coverage" is not a single, tool-independent quantity. It is *defined by the instrumentation*. Comparing 81% from JaCoCo to 81% from Istanbul as if they measure the same thing is a category error. Within one tool, deltas are meaningful; across tools, only the *shape* (which code is untested) transfers, not the number. This is the deeper reason the `04-coverage-in-ci-and-diffs` ratchet must be computed by *one* tool per language, never compared cross-tool.

---

## Coverage of Optimized and Inlined Code

The single biggest source of "this is covered but reports uncovered" (and the reverse) is the gap between source and optimized machine code.

**The line-table problem.** Coverage from compiler counters is reported against *source lines* via the debug line table (DWARF line program, or the language's equivalent). Optimization rewrites that mapping: instructions are reordered, hoisted out of loops, merged across lines, or eliminated. The line table tries to track which source line each instruction "belongs to," but at `-O2` that attribution becomes lossy and ambiguous. Symptoms:

- **Misattributed counts.** A computation hoisted out of a loop is counted once at the line it was hoisted *to*, not the line it was written *on*. The original line can show as uncovered though it "ran."
- **Disappearing regions.** Dead-code elimination removes a branch the compiler proved unreachable; the region simply vanishes from the mapping (LLVM) or shows zero count forever (gcov), so a real source branch reads as "never taken."
- **Coalesced lines.** Multiple source lines folded into one machine instruction share a single counter; covering one "covers" the others.

**Inlining** is the sharpest case. When `add()` is inlined into both `f()` and `g()`, the body's instructions appear twice, once per caller. Different tools resolve this differently:

- **LLVM source-based coverage** handles inlining well because the coverage mapping is keyed to source regions and `llvm-cov` *merges* the counts from all inlined copies back onto the original source region. This is a major reason LLVM source-based coverage is considered the most accurate compiler-counter approach for optimized code — it was designed around inlining and region merging.
- **gcov** historically struggled: inlined bodies could be attributed to the inlining call site, inflating one caller and zeroing the inlinee's own lines. Newer gcc improves this but it remains a known sharp edge.
- **Sampling/PGO-style** approaches (not strict coverage) attribute by program counter and are even noisier.

**The standard senior tactic** is to **compile for coverage at `-O0` (or a coverage-friendly opt level)** so the line table is faithful, accepting that you are no longer measuring the *shipped* binary. The trade is explicit: `-O0` coverage tells the truth about *which source ran* but on a binary that behaves differently (no inlining, no DCE) than production; `-O2` coverage measures something closer to production but with lossy attribution. For correctness-style coverage you want `-O0`; for performance-path or production coverage you accept `-O2` noise and read regions, not lines.

> **Key insight:** Coverage is reported in *source* coordinates but produced from *machine-code* counters, and optimization is precisely the transformation that breaks the source↔machine-code correspondence. The region-merging design of LLVM source-based coverage exists to repair the inlining case; everywhere else, the rule is "measure coverage at low optimization, measure performance at high optimization, and never expect one binary to give you both honestly."

---

## Collecting Coverage from Integration, E2E, and Production

Unit-test coverage is the easy case: one process, starts, runs, exits, flushes its profile. The hard cases are *long-running* processes (servers) and *out-of-process* exercise (E2E, integration, production), where the code under test never reaches a clean exit at the moment you want the data.

### Go integration coverage with `GOCOVERDIR` (1.20+)

Before Go 1.20 you could only get coverage from `go test`. Since 1.20 you can **build any binary with coverage instrumentation** and have it emit profiles to a directory at exit:

```bash
go build -cover -covermode=atomic -o server-cov ./cmd/server   # instrumented server
mkdir cov-int
GOCOVERDIR=cov-int ./server-cov &                              # run it; it emits on exit
# ... drive it with your integration/E2E suite (curl, k6, real client) ...
kill -SIGTERM $!                                               # graceful exit → profiles flushed
go tool covdata percent -i=cov-int                            # summary across all runs
go tool covdata textfmt -i=cov-int -o=integration.out         # convert to legacy text profile
go tool cover -func=integration.out
```

`GOCOVERDIR` is the directory each instrumented run writes two files to: a *meta-data* file (the structure, written once per binary) and a *counter* file (per process). Multiple processes and multiple runs accumulate as multiple files in the same directory; `go tool covdata` merges them. The catch every team hits: **the process must exit cleanly** for counters to flush — a `kill -9` loses the data. Run servers so they handle `SIGTERM` and exit, or use `runtime/coverage.WriteCountersDir` to snapshot a still-running process. You then merge integration coverage with unit coverage by pointing `covdata merge` at both the `GOCOVERDIR` profiles and the `go test` profiles.

### JaCoCo dump from a running server

JaCoCo's agent can hold coverage *in memory* and expose it over a TCP port, so you dump from a live server without stopping it — the canonical way to measure coverage of a manual or automated test pass against a deployed app:

```bash
# start the server with the agent in tcpserver output mode
java -javaagent:jacocoagent.jar=output=tcpserver,address=*,port=6300 -jar app.jar
# ... run your E2E suite against the live server ...
# dump current coverage without stopping the JVM:
java -jar jacococli.jar dump --address localhost --port 6300 --destfile e2e.exec
java -jar jacococli.jar report e2e.exec --classfiles target/classes \
     --sourcefiles src/main/java --xml e2e.xml
```

`output=tcpserver` makes the agent listen; `dump` connects and pulls the current probe state (optionally `--reset` to zero it for the next scenario). This is how you attribute coverage to a specific manual test plan or a black-box E2E run that never touches the JVM's classpath directly. The same class-files/CRC requirement applies: report against the *exact* deployed classes.

### V8 / Istanbul for browser E2E

Browser end-to-end coverage (Cypress, Playwright, Puppeteer) has two routes:

1. **V8 built-in coverage** — Chromium's engine maintains coverage natively (precise, block-level), exposed via the DevTools Protocol (`Profiler.takePreciseCoverage`) and consumed by `c8`/`monocart-coverage-reports`. Playwright exposes `page.coverage.startJSCoverage()`. No source rewriting; you collect the V8 coverage JSON after the run and convert it to lcov/Istanbul format, using source-maps to map bundled/minified code back to source.
2. **Istanbul-instrumented bundles** — you ship a *coverage build* of the app (Babel/`vite-plugin-istanbul` injects the counters), the running app accumulates `window.__coverage__`, and the E2E harness reads that object after each test and writes it to disk for `nyc report`.

The instrumented-bundle route gives you Istanbul's column precision and unified reports with your unit coverage (same format); the V8 route is lower-overhead and requires no special build but needs robust source-map handling. Either way the defining challenge is the same as servers: the code runs in a *separate context* (the browser) from your test runner, so you must explicitly extract the coverage object/JSON across that boundary before the page is torn down.

> **Key insight:** Production and E2E coverage is fundamentally a *data-extraction* problem, not an instrumentation problem. The counters exist; the difficulty is getting them out of a process that doesn't exit when your suite ends — flush on `SIGTERM` (Go), dump over TCP (JaCoCo), or scrape the coverage object across the browser boundary (V8/Istanbul). Design the process for *graceful, dumpable shutdown* or you will silently collect nothing.

---

## Merging Heterogeneous Coverage

Real systems are tested in layers — unit (per package, per language), integration (a few services), E2E (the whole app through a browser) — and leaders want *one* coverage view. Two distinct merge problems sit underneath that wish.

**1. Homogeneous merge (same tool, many runs).** Every tool has a native merge because parallel/shard execution demands it:

```bash
llvm-profdata merge -sparse a.profraw b.profraw -o all.profdata   # LLVM
coverage combine                                                  # coverage.py (.coverage.*)
go tool covdata merge -i=unit,integration -o=merged               # Go
java -jar jacococli.jar merge a.exec b.exec --destfile all.exec   # JaCoCo
lcov -a a.info -a b.info -o all.info                              # lcov files
nyc merge .nyc_output merged-coverage.json                        # Istanbul JSON
```

These merges are *sound* because the runs share the same structure model — they just sum counters per region. This is the everyday case: combining the shards of a parallelized test matrix, or unit + integration coverage *within one language*.

**2. Heterogeneous merge (different tools/languages).** Combining a JaCoCo `jacoco.exec`, a Go `merged` profile, and an Istanbul JSON cannot be done at the counter level — the structure models are incompatible (probes vs blocks vs statements). The only correct merge point is a **common report format**, after each tool has produced its own per-region results. The lingua franca in CI is one of a few line-oriented formats:

- **lcov** (`.info`) — `SF:` source file, `DA:line,count` data, `BRDA:` branch data, `FN:`/`FNDA:` function data. The most widely produced/consumed.
- **Cobertura XML** — per-package/class/line/branch hit counts; the format SonarQube, Jenkins, and many CIs ingest.
- **Clover XML** — Atlassian's format, still emitted by some tools.

Every major tool can export to lcov or cobertura (`llvm-cov export -format=lcov`, `coverage xml`, JaCoCo's `--xml`, `go tool cover` via converters, `nyc`'s lcov reporter). You then *normalize and concatenate* at the file/line level: the report (or the upload service — Codecov, Coveralls, SonarCloud) treats each language's lcov as covering disjoint files and unions them into one project view. Within an overlapping file (rare across languages, common when two suites hit the same file in one language) the union takes the *max* hit state per line — a line covered by any suite is covered.

The unglamorous reality is the **path-normalization problem**: each tool emits paths in its own convention — absolute build paths, module-relative, repo-relative, with or without a `src/` prefix. If `handler.go` appears as `/build/app/handler.go` in one report and `app/handler.go` in another, the merge sees two files and double-counts. The bulk of real "merge heterogeneous coverage" work is rewriting `SF:`/filename paths to a single repo-relative convention before upload — exactly the normalization that Codecov/Coveralls path-fixing settings exist to handle.

> **Key insight:** You can sum counters only within one instrumentation model; across tools and languages you must merge *reports*, not counters, in a common line-oriented format (lcov/cobertura), and the hard part is **path normalization**, not the union itself. Cross-process and cross-package attribution within a language is a counter merge; cross-language is a report merge — conflating the two is why "one unified coverage number across the stack" so often double-counts or silently drops files.

---

## Flaky Coverage, Concurrency, and Atomic Counters

Coverage is supposed to be deterministic given the same tests, but two forces make it flaky, and both have concrete fixes.

**Concurrency and lost counts.** A coverage counter is `counter++` — a read-modify-write. When instrumented code runs across multiple threads/goroutines, two threads incrementing the same counter race: both read N, both write N+1, one increment is lost. For *boolean* "was it executed" modes this rarely changes the final answer (the line still reads as covered), but for *count* modes it corrupts hit counts, and in pathological cases of contended set-mode counters on some platforms a torn write can even *miss* a first execution. The fix is **atomic counters**:

- **Go:** `-covermode=atomic` switches counter increments to `sync/atomic` operations. This is *mandatory* for any test that spawns goroutines touching instrumented code, and for all integration/server coverage (servers are concurrent by nature). The cost is real (atomics are slower than a plain increment), which is why `set` is the default for single-threaded unit tests and `atomic` is opt-in.
- **LLVM:** has an atomic-counter mode (`-fprofile-update=atomic` / `-mllvm -runtime-counter-relocation`) to make `-fprofile-instr-generate` counters thread-safe; without it, multithreaded programs under count mode can lose updates.
- **gcov:** `-fprofile-update=atomic` likewise makes arc counters atomic for multithreaded code.
- **JaCoCo:** uses boolean probes, so it sidesteps the count-corruption problem — a probe is "set," and a racing set to `true` is idempotent. This is one reason JaCoCo avoids a whole class of concurrency flakiness, at the cost of not giving you true hit counts.

**Non-deterministic execution.** Even with atomic counters, coverage flakes when *which code runs* varies between runs: time-dependent branches (`if time.Now()...`), map/iteration order, randomized inputs, ret- ry/timeout paths, GC-triggered finalizers, and goroutine/thread scheduling that takes a different branch each run. This produces a coverage number that wobbles ±a few lines run-to-run, which then makes a *diff-coverage gate* (`04-coverage-in-ci-and-diffs`) flap red/green for an unchanged PR. The senior fixes mirror flaky-test discipline: seed randomness, freeze clocks behind an injectable interface, make concurrency deterministic in tests where possible, and — at the CI policy level — compute the gate over *merged* coverage from all shards (so a line covered in any shard counts) and tolerate a small epsilon rather than demanding bit-exact coverage.

> **Key insight:** Concurrency attacks coverage at two levels — *lost counter updates* (fixed mechanically with atomic counters: Go's `-covermode=atomic`, LLVM/gcov `-fprofile-update=atomic`, or JaCoCo's idempotent boolean probes) and *non-deterministic control flow* (fixed with the same determinism discipline as flaky tests). The first is a one-flag fix and is non-negotiable for any concurrent or server coverage; the second is why coverage gates must merge shards and allow an epsilon, never demand an exact line count.

---

## Mental Models

- **Two families, two models of the program.** Source/AST rewriting (Istanbul, coverage.py) counts the program *as written*; compiler/runtime counters (LLVM, gcov, JaCoCo, Go) count the program *as compiled*. Every disagreement traces back to which model the tool holds.

- **Structure is build-bound; counts are run-time.** Every compiler-counter tool splits a *structure* artifact fixed at build time (LLVM `__llvm_covmap`, gcov `.gcno`, JaCoCo class CRC, Go meta-data) from *counts* accumulated at run time (`.profdata`, `.gcda`, `.exec`, Go counter files). Report against a different build than you ran and the tool errors or misattributes — the root cause of most "tooling is broken" tickets.

- **Coverage is reported in source coordinates but produced from machine-code counters.** Optimization is the transformation that breaks that correspondence. LLVM's region merging repairs the inlining case; otherwise, measure coverage at `-O0` and performance at `-O2`.

- **Production/E2E coverage is a data-*extraction* problem.** The counters exist inside a process that won't exit when your suite ends. The whole skill is getting them out: flush on `SIGTERM` (Go `GOCOVERDIR`), dump over TCP (JaCoCo), or scrape the coverage object across the browser boundary (V8/Istanbul).

- **Sum counters within a model; merge reports across models.** Same-tool merges (`llvm-profdata merge`, `coverage combine`, `covdata merge`, `jacococli merge`) sum counters and are sound. Cross-language merges happen at the *report* layer (lcov/cobertura) and live or die on **path normalization**.

---

## Common Mistakes

1. **Comparing coverage percentages across tools/languages.** 80% from JaCoCo and 80% from Istanbul measure different units (instructions vs statements). Only intra-tool deltas and the *shape* of untested code transfer. Compute every ratchet with one tool per language.

2. **Reporting against a recompiled binary/classes.** `llvm-cov` needs the *same* binary that produced the `.profdata`; gcov needs the `.gcno` from the same build as the `.gcda`; JaCoCo needs class files with the matching CRC. A rebuild between run and report silently drops or misattributes coverage.

3. **Measuring coverage at `-O2` and trusting line numbers.** Optimization makes the line table lossy — hoisted, coalesced, and eliminated code misattributes counts. Use `-O0` for correctness coverage; reserve optimized coverage for region-level reading where the tool (LLVM) merges inlined regions.

4. **`kill -9` on an instrumented Go server (or any abrupt kill).** Counters flush on *clean* exit; `GOCOVERDIR` collects nothing from a hard kill. Send `SIGTERM` and exit gracefully, or snapshot with `runtime/coverage`.

5. **Forgetting `-covermode=atomic` for concurrent code.** Goroutines (or threads, with LLVM/gcov `-fprofile-update=atomic`) racing on a plain counter lose increments, corrupting hit counts and flaking the gate. Atomic mode is mandatory for any concurrent or server coverage.

6. **Merging heterogeneous reports without normalizing paths.** `/build/app/x.go` and `app/x.go` look like two files; the merge double-counts or drops one. Normalize all `SF:`/filenames to one repo-relative convention before uploading to Codecov/Coveralls/SonarCloud.

7. **Trusting transpiled/bundled coverage without source-maps.** Istanbul/V8 coverage of TypeScript or a minified bundle maps to the wrong lines (or wrong files) if the source-map is missing or stale. Verify the map before trusting per-line results.

8. **Treating a flaky coverage number as a tooling bug.** A coverage figure that wobbles ±a few lines is usually non-deterministic *control flow* (clocks, randomness, scheduling), not broken instrumentation. Fix it with the same determinism discipline as flaky tests, and gate over merged shards with an epsilon.

---

## Test Yourself

1. Name the two instrumentation families and give one canonical tool for each. What is the fundamental difference in *what they can know* about the program?
2. Walk the LLVM source-based coverage data flow from a running binary to an HTML report, naming each file format. Why does `llvm-cov` need the binary, not just the profile?
3. What do gcov's `.gcno` and `.gcda` files each contain, and at what phase is each written? What breaks if they come from different builds?
4. JaCoCo produces a `jacoco.exec`. Why can't you generate a report from it alone, and what else must you supply?
5. You need coverage from a long-running Go server exercised by an E2E suite. Which mechanism do you use, what environment variable drives it, and what is the one operational pitfall that silently loses all data?
6. Why does covering a function inlined into two callers report differently across gcov and LLVM source-based coverage? What design lets LLVM handle it?
7. You have a Go integration profile, a JaCoCo XML, and an Istanbul lcov, and you want one project report. At what layer do you merge them, and what is the dominant practical difficulty?
8. A test that spawns goroutines reports slightly different coverage each run. Give the mechanical fix for *lost counter updates* and the separate fix for *non-deterministic control flow*.

<details>
<summary>Answers</summary>

1. **Source/AST rewriting** (Istanbul/nyc, coverage.py) and **compiler/runtime counters** (LLVM, gcov, JaCoCo, Go). Source rewriting counts the program *as written* (above the optimizer, source-shaped, column-precise); compiler counters count the program *as the compiler built it* (the real CFG/regions, aware of optimization). They hold different models of the program, so they answer subtly different questions.
2. `./binary` (with `LLVM_PROFILE_FILE`) → **`.profraw`** (raw per-process counters) → `llvm-profdata merge` → **`.profdata`** (indexed/merged) → `llvm-cov show/export` joins `.profdata` with the binary's `__llvm_covmap` → HTML/lcov. `llvm-cov` needs the **binary** because the *coverage mapping* (counter→source-region table) lives in the binary's `__llvm_covmap` section, not in the profile; the profile is only counter values, meaningless without the mapping from the matching build.
3. **`.gcno`** = the *notes* file: basic-block graph and line→block mapping, written at **compile** time (`-ftest-coverage`). **`.gcda`** = the *data* file: arc execution counts, written at **run** time on exit (`-fprofile-arcs`). If they come from different builds, the block graph doesn't match the counts and gcov errors or produces garbage; gcov is also version-sensitive between compiler and gcov.
4. `jacoco.exec` only records "probe N of the class with CRC X was hit." Generating a report requires the **original class files and source files**, because the report step re-instruments those exact classes to map probes back to lines. A CRC mismatch (recompiled classes) silently drops the class.
5. Build the server with **`go build -cover`** and run it with **`GOCOVERDIR`** set to an output directory; drive it with the E2E suite; merge with `go tool covdata`. The pitfall: counters flush only on **clean exit** — a `kill -9` (or crash) loses everything. Use `SIGTERM`/graceful shutdown or `runtime/coverage` to snapshot a live process.
6. An inlined body's instructions appear once per caller. **gcov** historically attributes them to the inlining call site, inflating one caller and zeroing the inlinee's own lines. **LLVM source-based coverage** keys counters to *source regions* and **merges** counts from all inlined copies back onto the original source region, so the inlined function reads as covered once — it was designed around inlining and region merging.
7. At the **report layer**, in a common line-oriented format (export each to **lcov** or **cobertura**, then union by file — counter-level merge is impossible across incompatible structure models). The dominant difficulty is **path normalization**: each tool emits paths in a different convention, so without rewriting them to one repo-relative form the merge double-counts or drops files.
8. Lost counter updates: use **atomic counters** — Go `-covermode=atomic` (or LLVM/gcov `-fprofile-update=atomic`); JaCoCo's boolean probes are already idempotent. Non-deterministic control flow: apply **determinism discipline** — seed randomness, freeze clocks behind an interface, control scheduling — and at CI level gate over **merged shards** with a small epsilon rather than an exact line count.

</details>

---

## Cheat Sheet

```
INSTRUMENTATION FAMILIES
  A) Source/AST rewrite   Istanbul/nyc (JS), coverage.py (Py), JaCoCo (bytecode)
     → source-shaped, column-precise, higher overhead, source-map dependent
  B) Compiler/runtime     llvm-cov (C/C++/Swift/Rust), gcov (gcc), Go -cover
     → CFG/region-based, optimization-aware, lower overhead, build-bound structure

LLVM SOURCE-BASED COVERAGE
  clang -fprofile-instr-generate -fcoverage-mapping -O0 ...
  LLVM_PROFILE_FILE="p-%p.profraw" ./bin           %p=pid  %m=binary-id  %c=continuous
  llvm-profdata merge -sparse *.profraw -o app.profdata
  llvm-cov show/report/export -instr-profile=app.profdata ./bin   (needs the binary!)

GCC GCOV
  gcc --coverage ...           .gcno (build-time: block graph) + .gcda (run-time: counts)
  gcov src.c                   → src.c.gcov ;  lcov --capture → .info ;  genhtml

JACOCO (JVM, on-the-fly ASM probes)
  java -javaagent:jacocoagent.jar=destfile=jacoco.exec -jar app.jar
  running server: ...=output=tcpserver,port=6300  →  jacococli dump --port 6300
  jacococli report jacoco.exec --classfiles ... --sourcefiles ... --xml/--html

GO
  go test -covermode=atomic -coverprofile=cover.out ./...
  go build -cover -o srv ./cmd/srv ; GOCOVERDIR=dir ./srv   (flush on clean exit!)
  go tool covdata percent|textfmt|merge -i=dir
  set | count | atomic   (atomic = required under concurrency)

E2E / BROWSER
  V8: page.coverage.startJSCoverage() / Profiler.takePreciseCoverage → c8
  Istanbul bundle: window.__coverage__ scraped after each test → nyc

MERGE
  same tool:  llvm-profdata merge | coverage combine | covdata merge | jacococli merge | lcov -a
  cross-lang: export each to lcov/cobertura, UNION by file, NORMALIZE PATHS first
  formats: lcov(.info SF/DA/BRDA) · cobertura(xml) · clover(xml)
```

---

## Summary

- Every coverage tool is one of **two families**: source/AST rewriting (Istanbul, coverage.py, JaCoCo) that counts the program *as written*, or compiler/runtime counters (LLVM, gcov, Go) that count it *as compiled*. The family fixes the counting unit, the overhead, and what the tool can know about optimization.
- Compiler-counter tools split **build-bound structure** (LLVM `__llvm_covmap`, gcov `.gcno`, JaCoCo class CRC, Go meta-data) from **run-time counts** (`.profdata`, `.gcda`, `.exec`, Go counter files). `llvm-cov` needs the binary and JaCoCo needs the class files for exactly this reason; mismatching the two is the root of most tooling failures.
- Tools **disagree** because they count different units, define branches differently, exclude different code, and see optimization differently — so coverage is *defined by the instrumentation*, and cross-tool percentage comparison is a category error.
- **Optimization and inlining** break the source↔machine-code mapping; LLVM's region merging repairs inlining, and the general rule is to measure coverage at `-O0` and performance at `-O2`.
- **Integration/E2E/production coverage** is a data-*extraction* problem: flush on `SIGTERM` with Go's `GOCOVERDIR`, dump over TCP from a live JaCoCo agent, or scrape `__coverage__`/V8 JSON across the browser boundary.
- **Merging** sums counters only within one tool; across languages you merge *reports* (lcov/cobertura) by unioning files, where **path normalization** is the real work. Concurrency needs **atomic counters** (`-covermode=atomic`, `-fprofile-update=atomic`, or JaCoCo's idempotent probes), and flaky coverage beyond that is non-deterministic control flow, fixed like flaky tests.

You now reason about coverage as *produced data* with a known provenance and known failure modes — which is exactly what you need before you let a number gate a merge in [04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/senior.md).

---

## Further Reading

- [Clang: Source-Based Code Coverage](https://clang.llvm.org/docs/SourceBasedCodeCoverage.html) — the authoritative description of `-fprofile-instr-generate -fcoverage-mapping`, the profraw→profdata→llvm-cov flow, and coverage-mapping regions/expressions.
- [gcov / gcc instrumentation docs](https://gcc.gnu.org/onlinedocs/gcc/Gcov.html) — `.gcno`/`.gcda`, the basic-block graph, and `-fprofile-update=atomic`.
- [JaCoCo documentation — implementation design](https://www.jacoco.org/jacoco/trunk/doc/) — on-the-fly ASM probe instrumentation, the `.exec` format, and the agent's tcpserver/dump mode.
- [Go: Coverage for integration tests](https://go.dev/blog/integration-test-coverage) and the `cmd/covdata` docs — `go build -cover`, `GOCOVERDIR`, and merging unit + integration coverage.
- [Istanbul / istanbul-lib-instrument](https://github.com/istanbuljs/istanbuljs) and the `c8`/V8 coverage docs — AST instrumentation, the `__coverage__` object, and V8 precise coverage for browser E2E.
- The lcov and Cobertura format references — the line-oriented `SF:`/`DA:`/`BRDA:` and XML schemas every CI coverage service ingests.

---

## Related Topics

- [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/senior.md) — the metrics and subsumption hierarchy that the units in this page count.
- [04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/senior.md) — combining parallel shards, diff coverage, flaky-coverage gates, and the ratchet that consumes these reports.
- [junior.md](junior.md) · [middle.md](middle.md) · [professional.md](professional.md) — the rest of this topic's tier set: getting numbers out of each tool, reading the reports, and operating coverage tooling across an org.
- [Build Systems › Per-Language Tools](../../build-systems/04-per-language-tools/senior.md) — how each language's toolchain exposes the compiler flags that coverage instrumentation rides on.
