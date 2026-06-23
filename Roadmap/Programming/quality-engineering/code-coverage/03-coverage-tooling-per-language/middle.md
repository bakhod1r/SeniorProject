# Coverage Tooling per Language — Middle Level

> **Roadmap:** [Code Coverage](../README.md) → Coverage Tooling per Language
> *The junior page told you each language has a coverage tool. This page opens the hood: how each tool actually records what ran, the one or two flags that change the number the most, and why four ecosystems converged on the same handful of report formats so a server in CI can read all of them.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Go — covermode, coverpkg, and the profile format](#go--covermode-coverpkg-and-the-profile-format)
4. [Python — coverage.py and the branch flag that's off by default](#python--coveragepy-and-the-branch-flag-thats-off-by-default)
5. [JavaScript — Istanbul/nyc vs c8 (instrumentation vs V8)](#javascript--istanbulnyc-vs-c8-instrumentation-vs-v8)
6. [Java — JaCoCo and why it needs a JVM agent](#java--jacoco-and-why-it-needs-a-jvm-agent)
7. [Report Formats — lcov, Cobertura, Clover, JaCoCo XML](#report-formats--lcov-cobertura-clover-jacoco-xml)
8. [Merging Coverage from Many Runs and Shards](#merging-coverage-from-many-runs-and-shards)
9. [Worked Example — Turning on Branch Coverage in Python](#worked-example--turning-on-branch-coverage-in-python)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does each coverage tool actually work, and which options change the number?**

At the junior level you ran `go test -cover`, `pytest --cov`, `nyc`, or a JaCoCo Maven goal and read a percentage off the end. That works until the percentage starts lying to you — until branch coverage is silently disabled, until integration tests show 0% for the package they exercise, until two test shards each report 60% and you have no idea what the combined number is, until your CI dashboard can't read the file your tool emitted.

Every one of those is a *tooling* problem, not a testing problem, and each has a precise cause. The number a coverage tool prints is the product of three decisions the junior page glossed over: **what it counts** (lines only, or branches too), **how it records execution** (source instrumentation, bytecode instrumentation, or the runtime's own counters), and **what it emits** (a tool-specific profile, or one of a few interchange formats CI servers understand). This page makes those decisions concrete in four ecosystems, then shows how the formats and the merge step let you assemble one honest number out of many runs.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can run the coverage tool for at least one language.
- **Required:** You know the difference between *line* and *branch* coverage ([01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/middle.md)).
- **Helpful:** You've configured a CI pipeline and seen a coverage upload step.
- **Helpful:** A rough idea of what "instrumentation" means — code added to record what ran.

---

## Go — covermode, coverpkg, and the profile format

Go's coverage is built into the toolchain, and its behaviour is governed almost entirely by two flags.

**`-covermode`** decides *what each counter records*:

| Mode | What it stores per block | Cost | Use when |
|---|---|---|---|
| `set` | did this block run? (boolean) | cheapest | default; "was it covered" is all you need |
| `count` | how many times it ran (int) | small | you want hit counts / hotness |
| `atomic` | hit count, with atomic increments | higher | tests run with `-race` or touch the same code from goroutines |

The trap is concurrency. The default `set`/`count` counters are plain reads/writes; under parallel goroutines those increments race, and `go test -race` will flag the *instrumentation itself*. The rule: **`-covermode=atomic` whenever you run with `-race` or measure concurrent code.** It's slower, but it's the only mode that's correct under parallelism.

```bash
go test -covermode=atomic -coverprofile=cover.out ./...
go tool cover -func=cover.out          # per-function % to stdout
go tool cover -html=cover.out          # annotated source in the browser
```

**`-coverpkg`** decides *which packages are instrumented*. By default Go measures coverage only for the package whose tests are running — so an integration test in `package api_test` that drives code in `package store` records **0%** for `store`, because `store` was never instrumented. `-coverpkg` fixes this by instrumenting a named set regardless of which test runs:

```bash
# Measure coverage of ALL packages, attributed across the whole test run —
# this is how you capture cross-package and integration coverage.
go test -covermode=atomic -coverpkg=./... -coverprofile=cover.out ./...
```

The output, `cover.out`, is a plain-text **profile** with a format worth recognizing:

```
mode: atomic
github.com/acme/app/store/store.go:14.30,17.2 2 1
github.com/acme/app/store/store.go:19.13,21.3 1 0
```

Line one is the mode. Every other line is one *basic block*: `file:startLine.startCol,endLine.endCol numStatements hitCount`. The last field is the only thing tests change — `1` means covered, `0` means not. Because the format is this simple and append-friendly, *merging Go coverage is mostly concatenation plus summing hit counts for identical blocks* — which is exactly what the merge tools do (see below).

> **Key insight:** Go's two coverage knobs map cleanly onto two real questions. `-covermode` answers "do I need correctness under `-race`?" (then `atomic`). `-coverpkg` answers "do I need coverage for code *other* than the package under test?" (then `./...`). Forgetting the second is the single most common reason a Go team thinks their integration tests "don't count."

---

## Python — coverage.py and the branch flag that's off by default

`coverage.py` (the engine behind `pytest-cov`) is a *tracing* tool: it installs a trace function that fires on the lines the interpreter executes and records which line numbers ran. That default gives you **line coverage only** — and this is the most consequential default in the Python tooling world.

**Branch coverage is OFF by default.** Until you turn it on, `if cond:` with a body that always runs counts as fully covered even though the `else`/fall-through path was never taken. You enable it in `.coveragerc` (or `pyproject.toml`):

```ini
# .coveragerc
[run]
branch = True
source = myapp                 # measure only this package, not site-packages
parallel = True               # tag each run's data file uniquely (for combine)

[report]
show_missing = True           # print the line/branch numbers that were missed
exclude_lines =
    pragma: no cover
    if __name__ == .__main__.:
    raise NotImplementedError
```

Three settings carry their weight:

- **`branch = True`** flips the engine from "which lines ran" to also tracking "which line-to-line transitions ran," i.e. both sides of every decision. Expect the percentage to *drop* when you turn it on — that's the tool finally counting the paths it was ignoring.
- **`source = myapp`** scopes measurement. Without it, coverage.py reports on whatever got imported, including dependencies, diluting the number and slowing the run.
- **`# pragma: no cover`** is an inline marker that excludes a line or block from measurement — for genuinely untestable code (a `if TYPE_CHECKING:` guard, a `raise` in an unreachable default). It is also the most-abused coverage feature in existence; treat each one as a small confession ([02 — Mutation Coverage](../02-mutation-coverage/middle.md) and [06 — Coverage as Signal](../06-coverage-as-signal-not-target/) explain why).

**Contexts** let one report record *who* covered each line — by test, by phase — so you can answer "which test exercised this branch?":

```bash
coverage run --context=unit -m pytest tests/unit
```

**Parallel + combine** is how coverage.py handles multiple processes (xdist workers, separate test invocations). With `parallel = True`, each run writes a uniquely-suffixed `.coverage.<host>.<pid>` file; `coverage combine` then folds them into one `.coverage`:

```bash
coverage combine        # merge all .coverage.* into one
coverage report         # text summary
coverage xml            # emit Cobertura XML for CI
```

> **Key insight:** `coverage.py` defaults to *line* coverage and *all imported code*. The two edits that make it honest are `branch = True` (count both sides of decisions) and `source =` (measure only your code). A team reporting "92%" without `branch = True` is reporting a number that structurally cannot drop when a branch goes untested.

---

## JavaScript — Istanbul/nyc vs c8 (instrumentation vs V8)

JavaScript has two coverage philosophies, and choosing between them is really a choice about *where the counting happens*.

**Istanbul (via the `nyc` CLI)** works by **source instrumentation**. Before your code runs, Istanbul rewrites it — wrapping every statement, branch, and function in counter increments — then runs the instrumented version:

```js
// your source
if (x) doThing();
// what Istanbul runs (conceptually)
cov_abc().s[0]++; if (x) { cov_abc().b[0][0]++; doThing(); } else { cov_abc().b[0][1]++; }
```

Because Istanbul controls the rewrite, it produces rich **branch-level** data and integrates with Babel, so it understands JSX/TS *as it was authored*. The cost: it must transform every file before execution (slower startup), and you must instrument the same code your tests import — easy to misconfigure so that the instrumented copy and the imported copy diverge.

**c8** takes the opposite route: it uses **V8's built-in coverage**. Node's engine already tracks which code ran (the same machinery that powers the Chrome DevTools coverage tab); c8 just asks V8 for that data via the Inspector protocol and converts it to a report. Nothing rewrites your source:

```bash
c8 --reporter=lcov --reporter=text node --test
```

| | Istanbul / nyc | c8 |
|---|---|---|
| Mechanism | rewrites source before run | reads V8's native counters |
| Speed | slower (transform step) | fast (no transform) |
| Branch data | precise, mature | improving; can be coarser |
| TS/JSX | via Babel, on the authored source | needs **source maps** to map V8's line numbers back to your `.ts` |
| Setup | more moving parts | run your program under it |

The decisive issue for TypeScript is **source maps**. V8 reports coverage against the *compiled* JavaScript it actually executed. To show you coverage on your `.ts` files, c8 must follow the source map back from `dist/foo.js` to `src/foo.ts`. If source maps are missing or wrong, c8's report points at the wrong lines (or transpiled output you never wrote). Istanbul sidesteps this by instrumenting before transpilation, at the cost of being in the transform pipeline.

> **Key insight:** Istanbul *adds* code to count; c8 *asks the engine* what it already counted. Istanbul gives richer branch data and authored-source accuracy at the price of a transform step; c8 is fast and zero-rewrite but lives or dies by your source maps. For plain modern Node, c8 is the path of least resistance; for deep branch analysis or a complex Babel/TS build, Istanbul still earns its keep.

---

## Java — JaCoCo and why it needs a JVM agent

JaCoCo measures coverage by **instrumenting bytecode**, not source — and it does so *on the fly* using a **Java agent**. The reason is structural: Java code runs as bytecode inside the JVM, and a class is only "real" once the classloader has loaded it. JaCoCo hooks the classloading process via the `-javaagent` mechanism so it can rewrite each class's bytecode — inserting probes that record which instructions executed — *at the moment it's loaded*, before any of it runs.

That is why **the agent must be on the JVM that runs the tests.** Coverage isn't computed by reading your `.class` files at rest; it's computed by watching them execute. No agent on the test JVM → no probes → no data. This is the single most common JaCoCo failure: tests pass, but the report is empty because the agent never attached (often because tests fork a new JVM that didn't inherit the agent's `-javaagent` argument).

There are two instrumentation timings:

- **On-the-fly (default):** the agent rewrites classes as they load. No build step changes; you just add the agent. This is what the Maven/Gradle plugins wire up for you.
- **Offline:** classes are instrumented ahead of time and the instrumented copies are run. Needed only when an agent can't be used (some app servers, certain frameworks that interfere with classloading).

The Maven plugin makes the agent and the report two goals:

```xml
<plugin>
  <groupId>org.jacoco</groupId>
  <artifactId>jacoco-maven-plugin</artifactId>
  <version>0.8.12</version>
  <executions>
    <execution>
      <id>prepare-agent</id>
      <goals><goal>prepare-agent</goal></goals>   <!-- sets -javaagent on the test JVM -->
    </execution>
    <execution>
      <id>report</id>
      <phase>verify</phase>
      <goals><goal>report</goal></goals>          <!-- reads jacoco.exec → HTML/XML -->
    </execution>
  </executions>
</plugin>
```

`prepare-agent` doesn't produce coverage; it *configures the JVM* so that when tests run they emit a binary **`.exec` file** (`target/jacoco.exec`) of probe hits. `report` then reads that `.exec` plus the compiled classes and source to render HTML and XML.

For **unit vs integration**, the clean pattern is *one `.exec` per test phase*, then merge. Run unit tests to `jacoco-unit.exec`, integration tests (often a separate JVM, via `prepare-agent-integration` / Failsafe) to `jacoco-it.exec`, then merge them so a line covered only by an integration test still counts:

```xml
<execution>
  <id>merge</id>
  <goals><goal>merge</goal></goals>
  <configuration>
    <fileSets><fileSet><directory>${project.build.directory}</directory>
      <includes><include>jacoco-*.exec</include></includes>
    </fileSet></fileSets>
    <destFile>${project.build.directory}/jacoco-merged.exec</destFile>
  </configuration>
</execution>
```

> **Key insight:** JaCoCo coverage is a *live* measurement — bytecode probes inserted by an agent as classes load and watched while they execute. The agent must ride along on the exact JVM that runs the tests; an empty report almost always means the agent didn't attach (commonly because tests forked an un-instrumented JVM). And because each test phase writes its own `.exec`, an honest total comes from *merging* unit and integration exec files, not from either alone.

---

## Report Formats — lcov, Cobertura, Clover, JaCoCo XML

Every tool above records coverage in its own native form — Go's `cover.out`, coverage.py's `.coverage`, V8's JSON, JaCoCo's `.exec`. None of those is what a CI server (Codecov, Coveralls, SonarQube) consumes. The ecosystem solved this with a few **interchange formats**: language-neutral files that say, in a common vocabulary, "in this file, these lines/branches were hit this many times." The tool emits the interchange; the CI service ingests it.

| Format | Shape | Origin / native to | Read by |
|---|---|---|---|
| **lcov** (`lcov.info`) | line-based text (`DA:`, `BRDA:`, `SF:`) | gcov/lcov; default for nyc, c8 | Codecov, Coveralls, most tools |
| **Cobertura XML** | XML, line + branch rates | Java Cobertura; coverage.py `xml` | Jenkins, GitLab, SonarQube |
| **Clover XML** | XML, statement/method/branch | Atlassian Clover | Jenkins, Bamboo |
| **JaCoCo XML** | XML, instruction/branch/line/method counters | JaCoCo native | SonarQube (preferred for Java), Codecov |

**lcov** is the closest thing to a universal currency. Its format is plain text, one section per source file, and worth being able to read by eye:

```
SF:src/store.js          # source file
FN:14,saveUser           # function on line 14 named saveUser
FNDA:3,saveUser          # saveUser was hit 3 times
DA:14,3                  # line 14 executed 3 times
DA:15,0                  # line 15 executed 0 times  ← a gap
BRDA:14,0,0,3            # branch: line 14, block 0, branch 0, taken 3 times
BRDA:14,0,1,0            # branch: line 14, block 0, branch 1, taken 0 times ← missed side
LF:2                     # lines found (instrumentable)
LH:1                     # lines hit
end_of_record
```

`DA:line,hits` is line coverage; a `0` is an untested line. `BRDA:line,block,branch,taken` is branch coverage; a `0` in the last field is an untested *side* of a decision — exactly the data that branch coverage adds and that line-only tools (and line-only formats) can't express.

> **Key insight:** The format matters because it's the contract between your test run and your dashboard. A CI tool can only display the granularity the format carries — feed it line-only data and it can never show branch gaps. Emit a format your service understands (lcov or Cobertura are the safest defaults; JaCoCo XML for Java in SonarQube), and prefer one that carries branch data if you've gone to the trouble of measuring branches.

---

## Merging Coverage from Many Runs and Shards

Modern suites rarely run in one process. You shard across CI machines for speed, split unit from integration, run the matrix across OS/versions. Each produces a *partial* coverage view — line 42 was hit by shard 3 but not shards 1, 2, 4. **Merging** combines these so a line counts as covered if *any* run hit it. Without it, every shard's number is artificially low and meaningless on its own.

The merge happens at one of two layers, and the layer matters:

1. **Native merge (before reporting), preferred.** Combine the tools' own data files, then generate one report. The counts are summed correctly because you're working in the tool's native vocabulary.
   - Python: `coverage combine` folds all `.coverage.*` into one.
   - Go: concatenate profiles and sum identical blocks (`go tool covdata merge` for the modern binary format, or `gocovmerge` for text profiles).
   - JaCoCo: the `merge` goal unions `.exec` files.

2. **Format-level merge (after reporting).** Upload each shard's lcov/Cobertura file separately and let the CI service (Codecov, Coveralls) merge them server-side. Simpler in distributed CI where shards never share a filesystem — each job just uploads its own report with a flag/label and the service unions them.

The rule of thumb: **merge in the tool's native format when you can** (most accurate, handles hit counts), and lean on **service-side merge** when shards are physically separate and shipping native data files around is impractical. Either way, the report you *judge* must be the merged one. Diff-coverage gates in particular break badly on un-merged shards — a line covered only by shard 2 looks uncovered to shard 1's report, and the gate fails a perfectly-tested PR ([04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/middle.md)).

> **Key insight:** Sharding splits coverage; merging reunites it. A per-shard percentage is structurally an *undercount* of the whole. Merge natively when the data files are reachable (sums hit counts correctly), or let the CI service union the per-shard reports when they aren't — but never gate on a single shard's view.

---

## Worked Example — Turning on Branch Coverage in Python

Watch a real number move when you flip one setting. The code under test has an unexercised branch:

```python
# discount.py
def price(amount, member):
    if member:
        return amount * 0.9
    return amount            # ← only this path is tested
```

```python
# test_discount.py
def test_member_price():
    assert price(100, True) == 90   # exercises the `if member` branch only
```

**Step 1 — line coverage only (the default).** No `branch = True`:

```bash
coverage run -m pytest && coverage report -m
# Name          Stmts   Miss  Cover   Missing
# discount.py       4      1    75%    4
```

The `return amount` on line 4 was never executed, so line coverage already catches *that*. But notice what it does **not** catch: nothing about the *false* side of `if member:` being untested as a decision — line coverage only knows lines, and every line except 4 ran.

**Step 2 — enable branch coverage.** Add to `.coveragerc`:

```ini
[run]
branch = True
source = .
```

```bash
coverage run -m pytest && coverage report -m
# Name          Stmts   Miss Branch BrPart  Cover   Missing
# discount.py       4      1      2      0    67%    4, 2->exit
```

The number **drops from 75% to 67%**, and a new column appears. `Branch = 2` (the `if` has two outgoing edges), and `Missing` now lists `2->exit` — the transition from line 2 *falling through to the function exit* was never taken. Branch coverage made the tool count both edges of the decision, and the untaken edge pulled the percentage down. That 8-point drop is not regression — it's the tool finally telling the truth about a path your test never ran.

**Step 3 — close the gap.** Add the missing case:

```python
def test_nonmember_price():
    assert price(100, False) == 100   # now the false branch runs
```

Re-run: `100%`, `2->exit` gone. The lesson generalizes to every ecosystem: **the first time you enable branch coverage, the number goes down — and that lower number is the honest one.**

---

## Mental Models

- **Three places to count, one number out.** Source instrumentation (Istanbul, JaCoCo offline) rewrites code before it runs; bytecode-agent instrumentation (JaCoCo on-the-fly) rewrites at load time; runtime counters (c8/V8, coverage.py's tracer) ask the engine what it already saw. Same percentage, very different machinery — and different failure modes (missing agent, missing source maps, wrong `source`).

- **The native file is the source of truth; the interchange format is a translation.** `.exec`, `cover.out`, `.coverage` hold the real hit counts. lcov/Cobertura/Clover/JaCoCo-XML are *exports* for tools that don't speak the native dialect. Merge in the native dialect when you can; the translation can lose granularity.

- **Defaults are opinions, and two of them lie low.** coverage.py defaults to *line-only*; Go defaults to *the package under test only*. Both make your number look better than it is until you set `branch = True` and `-coverpkg`. Know your tool's defaults or inherit its blind spots.

- **An empty JaCoCo report is an agent problem, not a test problem.** Coverage is measured *while bytecode executes*. If the report is blank, the probes never ran — the agent didn't attach to the JVM that ran the tests (usually a forked JVM). Look at the JVM args, not the tests.

- **A per-shard percentage is a fragment of the truth.** Sharding splits coverage across processes; only the *merged* view is meaningful. Judge and gate on the merge, never on one shard.

---

## Common Mistakes

1. **Reporting Python coverage without `branch = True`.** Line-only coverage cannot drop when a branch goes untested. A "90%" with branch coverage off is a structurally inflated number; turn it on and expect a drop.

2. **Forgetting `-coverpkg` for Go integration tests.** By default Go instruments only the package under test, so an integration test driving another package reports 0% for it. Use `-coverpkg=./...` to capture cross-package coverage.

3. **Running Go `-race` without `-covermode=atomic`.** Default counters race under goroutines; the race detector will flag the instrumentation itself. Use `atomic` whenever concurrency or `-race` is in play.

4. **Expecting JaCoCo coverage with no agent on the test JVM.** Tests fork a new JVM, the agent's `-javaagent` doesn't propagate, `.exec` is empty, report shows 0%. Verify `prepare-agent` ran and the forked JVM inherited the argument.

5. **Pointing c8 at TypeScript without source maps.** V8 measures the compiled JS it ran; without source maps c8 maps coverage to the wrong (or transpiled) lines. Ensure source maps are emitted and discoverable, or use Istanbul on the authored source.

6. **Gating on a single shard's report.** A line covered only by another shard looks uncovered, failing well-tested PRs. Merge natively (or via the CI service) before computing project or diff coverage.

7. **Emitting a format the CI tool can't read (or one too coarse).** A line-only format can never show branch gaps no matter how the tool measured. Emit lcov/Cobertura/JaCoCo-XML as your service expects, and prefer a format that carries branch data once you measure branches.

---

## Test Yourself

1. Why is `-covermode=atomic` required when you run Go tests with `-race`, and what does it cost?
2. A Go integration test in `package api_test` exercises `package store`, but `store` shows 0% coverage. What flag fixes it and why?
3. Your Python report says 90% but you suspect branches aren't counted. Which `.coveragerc` setting do you check, and what happens to the number when you enable it?
4. Explain the core mechanical difference between Istanbul/nyc and c8. Which one needs source maps for TypeScript, and why?
5. Why does JaCoCo need a Java agent on the JVM that runs the tests? What's the usual cause of an empty JaCoCo report?
6. You shard your test suite across 4 CI machines and each reports ~60% coverage. What must you do before judging the suite's coverage, and where can that step happen?

<details>
<summary>Answers</summary>

1. The default `set`/`count` counters use plain (non-atomic) increments; under parallel goroutines those increments race, and `-race` will flag the instrumentation code itself. `atomic` makes the increments atomic so they're correct under concurrency, at the cost of some runtime overhead.
2. `-coverpkg=./...` (or a specific package list). By default Go instruments only the package whose tests are running, so code in *other* packages is never instrumented and records 0% even when exercised. `-coverpkg` instruments the named set regardless of which test drives them.
3. `branch = True` under `[run]`. It's off by default, so the tool only counts lines. Turning it on makes it count both edges of every decision; the percentage typically *drops*, because previously-ignored untaken branches now count against you.
4. Istanbul **rewrites your source** to add counters before running it; c8 **reads V8's built-in coverage** (the engine's own counters) — no rewrite. c8 needs source maps for TS because V8 reports against the compiled JS it executed, so the coverage must be mapped back from `dist/*.js` to `src/*.ts`. Istanbul instruments the authored source pre-transpile, so it doesn't.
5. Java runs as bytecode in the JVM, and classes are only "real" once loaded; JaCoCo's on-the-fly agent rewrites each class's bytecode to insert probes *at load time*, then watches them execute. No agent on that JVM → no probes → no data. The usual empty-report cause is tests forking a new JVM that didn't inherit the `-javaagent` argument.
6. Merge the per-shard coverage first — a single shard's ~60% is an undercount because other shards covered different lines. The merge can happen natively before reporting (`coverage combine`, JaCoCo `merge`, `gocovmerge`/`go tool covdata merge`) or server-side in the CI service (Codecov/Coveralls union uploaded reports). Judge and gate only on the merged view.

</details>

---

## Cheat Sheet

```
GO
  go test -covermode=atomic -coverprofile=cover.out -coverpkg=./... ./...
    covermode set    boolean: was block hit          (default)
              count  hit count
              atomic hit count, atomic  ← REQUIRED with -race / concurrency
    coverpkg  ./...  instrument ALL pkgs → cross-package / integration coverage
  go tool cover -func=cover.out    per-function %
  go tool cover -html=cover.out    annotated source
  profile line: file:sL.sC,eL.eC numStmts hitCount   (0 = uncovered)

PYTHON (coverage.py / pytest-cov)
  .coveragerc [run]: branch = True   ← OFF by default; turn on for branch cov
                     source = myapp  ← measure only your code
                     parallel = True ← per-process data files for combine
  # pragma: no cover                 exclude a line/block (audit each one)
  coverage combine && coverage report && coverage xml   merge → text → Cobertura

JAVASCRIPT
  nyc / Istanbul   rewrites source, rich branch data, Babel/TS-aware (slower)
  c8               reads V8 native coverage, fast, needs SOURCE MAPS for TS
  c8 --reporter=lcov --reporter=text node --test

JAVA (JaCoCo)
  agent rewrites BYTECODE on-the-fly at classload → MUST be on the test JVM
  prepare-agent goal → sets -javaagent → tests emit target/jacoco.exec
  report goal        → .exec + classes + source → HTML/XML
  merge goal         → union jacoco-unit.exec + jacoco-it.exec
  empty report = agent didn't attach (forked JVM?)

REPORT FORMATS (the CI contract)
  lcov (lcov.info)  DA:line,hits  BRDA:line,blk,br,taken   universal default
  Cobertura XML     line + branch rates                    Jenkins/GitLab/Sonar
  Clover XML        stmt/method/branch                     Jenkins/Bamboo
  JaCoCo XML        instr/branch/line/method counters      Sonar (Java), Codecov
  → format must carry branch data to SHOW branch gaps

MERGING
  native (preferred): combine tools' own files, then report  (sums hits right)
  service-side:       upload per-shard reports, CI unions them (separate FS)
  always judge/gate on the MERGED view, never one shard
```

---

## Summary

- **Go** coverage is governed by two flags: `-covermode` (`set`/`count`/`atomic` — use `atomic` with `-race`) and `-coverpkg` (instrument other packages to capture cross-package/integration coverage). The `cover.out` profile is line-oriented text, which makes merging mostly concatenate-and-sum.
- **Python**'s `coverage.py` defaults to *line-only* and *all imported code*. `branch = True` and `source =` in `.coveragerc` are the edits that make the number honest; `combine` merges parallel runs; `# pragma: no cover` excludes (and is easily abused).
- **JavaScript** offers two mechanisms: Istanbul/nyc *rewrites source* (rich branch data, Babel/TS-aware, slower) vs c8 *reads V8's native counters* (fast, zero-rewrite, but needs **source maps** to map TS coverage back to authored files).
- **JaCoCo** instruments *bytecode on the fly* via a **Java agent** that must ride the JVM running the tests — an empty report nearly always means the agent didn't attach (often a forked JVM). Each test phase writes its own `.exec`; an honest total comes from *merging* unit and integration exec files.
- The native files differ, but CI servers read a few **interchange formats** — lcov, Cobertura XML, Clover XML, JaCoCo XML. The format is the contract: a tool can only display the granularity the format carries, so emit one your service reads and one that carries branch data once you measure branches.
- Sharded and multi-phase suites each produce *partial* coverage; **merge** (natively when files are reachable, server-side when they aren't) before you judge or gate. A per-shard percentage is structurally an undercount.

---

## Further Reading

- *coverage.py documentation* — Ned Batchelder. The branch-coverage, contexts, and `combine` chapters are the authoritative source for the Python tooling above.
- *JaCoCo documentation* — the "Implementation Design" and agent pages explain on-the-fly vs offline instrumentation and why the agent must be on the test JVM.
- *Go blog: "The cover story"* and `go help testflag` — the official treatment of `-cover`, `-covermode`, `-coverpkg`, and the profile format.
- *Istanbul* and *c8* READMEs — the canonical statements of source-instrumentation vs V8-native coverage, including source-map handling for TypeScript.
- *geninfo(1) / lcov(1)* man pages — the formal `lcov.info` format (`SF`, `DA`, `BRDA`, `FN`/`FNDA`) read by Codecov, Coveralls, and most CI tools.

---

## Related Topics

- [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/middle.md) — what the metrics these tools emit actually count, and why branch ≠ line.
- [02 — Mutation Coverage](../02-mutation-coverage/middle.md) — the honest test-quality signal once line/branch tooling stops telling you enough.
- [04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/middle.md) — uploading these report formats, diff coverage, and why un-merged shards break gates.
- [junior.md](junior.md) — the first run of each tool and reading the headline percentage.
- [senior.md](senior.md) — instrumentation overhead, source-based vs counter-based coverage at scale, and designing coverage for a polyglot monorepo.
