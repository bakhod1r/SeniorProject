# Coverage Tooling per Language — Junior Level

> **Roadmap:** [Code Coverage](../README.md) → Coverage Tooling per Language
> *Every mainstream language ships a coverage tool or has one a single install away. The skill at this level is small and concrete: know the one or two commands that turn "I ran my tests" into "here is exactly which lines my tests never touched" — and know how to open the colored report that shows you.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Go: `go test -cover`](#core-concept-1--go-go-test--cover)
5. [Core Concept 2 — Python: `pytest --cov` / Coverage.py](#core-concept-2--python-pytest---cov--coveragepy)
6. [Core Concept 3 — JavaScript / TypeScript: `c8`, `nyc`, Jest](#core-concept-3--javascript--typescript-c8-nyc-jest)
7. [Core Concept 4 — Java (JaCoCo) and the Rest (C/C++/Rust)](#core-concept-4--java-jacoco-and-the-rest-ccrust)
8. [Core Concept 5 — Reading the Report: Green, Red, and the IDE Gutter](#core-concept-5--reading-the-report-green-red-and-the-ide-gutter)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I actually get a coverage report — and how do I read it?**

You've written some tests. They pass. Green checkmarks everywhere. But here is the uncomfortable question: *which lines of your code did those tests never run?* You can't answer that by reading the code — your eyes will skip the same untested branch your tests skipped. You need a tool that watches the code execute and records every line, then shows you the gaps.

That tool already exists for your language. Not as some heavyweight enterprise product you have to evaluate for a quarter — as a flag on the test command you already type, or one `pip install` / `npm install` away. Go has coverage built into `go test`. Python has Coverage.py, the engine behind `pytest --cov`. JavaScript has `c8` and `nyc`. Java has JaCoCo. Rust has tarpaulin and `llvm-cov`. C and C++ have `gcov` and `llvm-cov`. There is no language in common use where measuring coverage is hard.

This page is deliberately practical. For each major ecosystem you'll get the *one or two commands* that produce a report, *where the report file lands*, and *how to open the HTML version* — the clickable, color-coded view where green means "a test ran this line" and red means "nothing did." By the end you should be able to drop into a repo in any of these languages and produce a coverage report from a cold start.

> **The mindset shift:** stop treating coverage as something a CI server does for you behind the scenes. It's a flag you can run locally, right now, in under a minute. Every language has a built-in or one-install coverage tool — so there is no excuse not to *look* at which lines your tests miss before you push.

---

## Prerequisites

- **Required:** You can write a test and run the test command for at least one language (examples use **Go**, **Python**, **JavaScript/TypeScript**, and **Java**).
- **Required:** You're comfortable running a command in a terminal and opening a file in a browser.
- **Helpful:** You've seen the phrase "80% coverage" in a CI log or a README badge and wondered where the number comes from. (It comes from the tools on this page.)
- **Helpful:** You know what a "branch" is — an `if`/`else`, a `switch` case, a ternary. Line vs branch coverage is covered in [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/junior.md); here you just need to know the two are different.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Coverage** | The percentage of your code that was *executed* while the tests ran. |
| **Coverage profile / data file** | The raw recording the tool produces (`cover.out`, `.coverage`, `jacoco.exec`). Machine-readable, not for humans. |
| **Report format** | The *standard text format* a tool emits so other tools can read it — `lcov`, `cobertura`, `clover`. CI tools speak these. |
| **HTML report** | The human-friendly version: a clickable web page that shows your source with each line colored green (covered) or red (not). |
| **Instrumentation** | How the tool *records* coverage — it adds bookkeeping to your code (or watches the runtime) to note which lines ran. |
| **Line coverage** | Did this line execute at all? The default, easiest metric. |
| **Branch coverage** | Did *both* sides of each `if` execute — the `true` path *and* the `false` path? Stricter; often off by default. |
| **Gutter** | The thin margin in your editor next to the line numbers, where IDEs paint coverage colors. |

---

## Core Concept 1 — Go: `go test -cover`

Go has coverage built directly into its test command — nothing to install. The simplest form just prints a percentage:

```bash
go test -cover ./...
# ok   example.com/app   0.012s   coverage: 73.4% of statements
```

That one number is useful as a pulse check, but it doesn't tell you *which* lines are missing. For that, write the coverage data to a **profile file**, then render it as HTML:

```bash
go test -coverprofile=cover.out ./...      # 1. run tests, record coverage → cover.out
go tool cover -html=cover.out              # 2. open the HTML report in your browser
```

The second command opens a browser tab automatically: your source code, with covered lines in green and uncovered lines in red. You can also produce a per-function text summary without leaving the terminal:

```bash
go tool cover -func=cover.out
# example.com/app/math.go:12:   Add        100.0%
# example.com/app/math.go:18:   Divide      66.7%   ← a branch is untested
# total:                        (statements) 73.4%
```

By default Go measures **line/statement** coverage. To also distinguish the branch *counts* (how many times each block ran, which exposes untested branches), add a mode:

```bash
go test -covermode=count -coverprofile=cover.out ./...   # count = how many times, not just yes/no
```

The three modes are `set` (did it run — the default), `count` (how many times), and `atomic` (count, but safe for concurrent code — use this when your tests run goroutines).

> **Key insight:** in Go the gap between "I got a percentage" and "I can see which lines are red" is exactly one extra step — write a `-coverprofile`, then `go tool cover -html`. People stop at the percentage and never look at the actual red lines, which is where all the value is.

---

## Core Concept 2 — Python: `pytest --cov` / Coverage.py

Python's coverage engine is **Coverage.py**. You rarely call it directly — the friendly path is the `pytest-cov` plugin, which adds a `--cov` flag to the test runner you already use.

Install once, then run:

```bash
pip install pytest-cov
pytest --cov=myapp                 # measure coverage of the "myapp" package while running tests
```

You'll get a terminal table showing each file, the lines run, and the lines *missed* (by line number — extremely handy):

```
Name              Stmts   Miss  Cover   Missing
-------------------------------------------------
myapp/math.py        20      3    85%   18-20
myapp/cli.py         34      0   100%
-------------------------------------------------
TOTAL                54      3    94%
```

That `Missing` column — `18-20` — is telling you the exact line numbers no test executed. To get the clickable HTML version, add `--cov-report=html`, then open the generated folder:

```bash
pytest --cov=myapp --cov-report=html      # writes an htmlcov/ folder
open htmlcov/index.html                    # macOS;  Linux: xdg-open;  Windows: start
```

If you'd rather use the underlying tool directly (useful when you're *not* on pytest — e.g. a plain `unittest` suite or a script), Coverage.py works in two steps: **run**, then **report**:

```bash
coverage run -m pytest        # run your tests under coverage's watch (records to .coverage)
coverage report -m            # text summary with Missing line numbers
coverage html                 # build the htmlcov/ report
```

By default Python measures **line** coverage only. Branch coverage — checking both sides of every `if` — is a flag you must opt into:

```bash
pytest --cov=myapp --cov-branch          # or:  coverage run --branch -m pytest
```

> **Key insight:** Coverage.py's mental model is **run, then report**. The `run` step records a hidden `.coverage` data file; `report` / `html` *read* that file. `pytest --cov` just fuses both steps into one command. Knowing they're separate explains why you can run tests once and then generate several report formats from the same data.

---

## Core Concept 3 — JavaScript / TypeScript: `c8`, `nyc`, Jest

JavaScript has three common ways to get coverage, and which one you use depends on your test setup.

**If you use Jest or Vitest**, coverage is a built-in flag — no extra tool:

```bash
jest --coverage          # Jest
vitest run --coverage    # Vitest (may prompt to install its coverage provider once)
```

Both print a table and, by default, write an HTML report to a `coverage/` folder. Open it with:

```bash
open coverage/lcov-report/index.html      # Jest's HTML lands here
```

**If you run plain Node** (no test framework, or `node --test`), use **`c8`**. It's the modern choice because it taps Node's *built-in V8 engine* coverage — no code rewriting, fast, and it understands TypeScript source maps out of the box:

```bash
npm install --save-dev c8
npx c8 node --test                 # wrap ANY command; c8 records whatever it runs
npx c8 --reporter=html node --test # also emit an HTML report into coverage/
```

The pattern is `c8 <your normal command>` — `c8` doesn't care *how* you run your code; it just measures the V8 coverage of whatever process it launches.

**`nyc`** is the older tool (the command-line front end for **Istanbul**, the long-standing JS coverage library). You'll meet it in established codebases. It works the same way — wrap your test command:

```bash
npx nyc mocha            # measure coverage of a Mocha run
npx nyc report --reporter=html
```

A quick word on the names you'll see: **Istanbul** is the underlying coverage library; **`nyc`** is its CLI; **`c8`** is the newer V8-native alternative; **lcov** is the report *format* they all can emit (the same format that CI tools read). They're not competitors to understand deeply — just know `c8` and `nyc` are the two CLIs, and Jest/Vitest have it built in.

> **Key insight:** the unifying JS pattern is **wrap, don't replace**. `c8` and `nyc` don't run your tests for you — you put them *in front of* the command you already run (`c8 node --test`, `nyc mocha`). Jest and Vitest are the exception because they're test runners *and* coverage tools in one.

---

## Core Concept 4 — Java (JaCoCo) and the Rest (C/C++/Rust)

**Java** uses **JaCoCo** (Java Code Coverage), and you almost never invoke it by hand — you wire it into your build tool, and it runs as part of `mvn test` or `gradle test`.

With **Maven**, add the plugin to `pom.xml` so it instruments tests and writes a report:

```xml
<plugin>
  <groupId>org.jacoco</groupId>
  <artifactId>jacoco-maven-plugin</artifactId>
  <version>0.8.12</version>
  <executions>
    <execution><goals><goal>prepare-agent</goal></goals></execution>
    <execution><id>report</id><phase>test</phase><goals><goal>report</goal></goals></execution>
  </executions>
</plugin>
```

Then just run your tests — the report generates automatically:

```bash
mvn test
open target/site/jacoco/index.html        # ← the HTML report lands here
```

With **Gradle**, enable the plugin and run its report task:

```gradle
plugins { id 'jacoco' }
test { finalizedBy jacocoTestReport }      // build the report right after tests
```

```bash
gradle test jacocoTestReport
open build/reports/jacoco/test/html/index.html   # ← Gradle's report path
```

The two paths to memorize: Maven puts JaCoCo's HTML under **`target/site/jacoco/`**, Gradle under **`build/reports/jacoco/test/html/`**. Behind the scenes JaCoCo records a binary `jacoco.exec` data file during the test run, then turns it into the HTML — the same *run-then-report* split you saw in Python.

**The rest, in one breath** — you don't need these now, just know they exist so you're never stuck:

- **C / C++:** the classic toolchain is **`gcov`** (compile with `gcc --coverage`, then run `gcov`), often wrapped by **`lcov`** to produce HTML. The Clang/LLVM equivalent is **`llvm-cov`** (compile with `-fprofile-instr-generate -fcoverage-mapping`).
- **Rust:** **`cargo tarpaulin`** is the one-command option (`cargo tarpaulin --out Html`); the more precise, officially-blessed route is LLVM source-based coverage via **`grcov`** or `cargo llvm-cov`.

> **Key insight:** notice the recurring shape across *every* compiled-language tool — Go, Java, C, Rust. They all (1) instrument or watch the code, (2) write a raw data file during the test run, and (3) turn that data file into a report. The commands differ; the three-step pipeline is identical. Learn the shape once and every new tool is just new names for the same steps.

---

## Core Concept 5 — Reading the Report: Green, Red, and the IDE Gutter

A coverage number is a headline; the **HTML report** is the story. However you generated it, every tool's HTML report works the same way, and reading it is a five-second skill.

Open `index.html`. You'll see a **summary table** — every file, with a coverage percentage and usually a colored bar. Sort by lowest coverage, or just scan for the reddest bars: those are the files your tests neglect most. Click a file and you drop into the **source view**, your actual code annotated line by line:

- **Green line** = a test executed this line. Good.
- **Red line** = *nothing* ran this line. This is the gap — a code path no test touches.
- **Yellow / amber line** (when branch coverage is on) = the line ran, but only *one* side of its branch did. The `if` fired but the `else` never did, or vice versa. This is the sneaky one — line coverage calls it "covered," branch coverage exposes the half you missed.

That yellow case is exactly why branch coverage matters. A line like `return a if x > 0 else b` can be 100% line-covered while you've only ever tested `x > 0`. The report's branch annotation is what reveals the untested half.

**The IDE gutter** brings the same colors *into your editor*, so you see coverage while you write — no browser needed. After running coverage, your editor paints the margin (the "gutter") beside the line numbers:

- **VS Code:** install an extension like *Coverage Gutters*, point it at the `lcov.info` / `cover.out` your tool produced, and toggle the gutter — green/red stripes appear next to your code.
- **IntelliJ IDEA / GoLand / PyCharm:** built in. "Run with Coverage" runs your tests and immediately stripes the gutter and folds coverage into the file tree.

The gutter is the tightest possible feedback loop: write a test, run with coverage, watch a red line turn green. That loop — see red, write a test, see green — is the entire practical point of coverage at this level.

> **Key insight:** don't stare at the *percentage*. Open the HTML report (or the gutter) and **look at the red lines** — they are a literal to-do list of code your tests forgot. The number tells you *how much*; the colors tell you *exactly where*, and "where" is the only part you can act on.

---

## Real-World Examples

**1. The 90% number that hid a real bug.** A Go service reported 90% coverage and the team felt safe. Someone ran `go tool cover -html=cover.out` for the first time and found the entire error-handling branch of the payment path glowing red — 90% overall, but the *one path that mattered* was untested. The percentage was reassuring; the red lines were the truth. A two-line test on that branch caught a swallowed error the next week. The fix cost nothing; *looking at the report* was the whole win.

**2. "Why is my new file at 100% but the bug shipped?"** A Python developer saw `myapp/cli.py 100%` and was baffled a logic bug got through. The cause: coverage was line-only. The buggy line was a one-liner `result = a if cond else b`, fully line-covered because the line *ran* — but every test happened to hit the `cond is true` side. Re-running with `pytest --cov=myapp --cov-branch` turned that line yellow and exposed the never-tested `else`. Branch coverage, off by default, was the missing flag.

**3. The CI badge nobody could reproduce locally.** A team's README showed an 82% coverage badge from CI, but a new hire couldn't get a report at all — they were running `mvn test` and seeing nothing. The JaCoCo plugin *was* configured, so the report existed; they just didn't know it landed in `target/site/jacoco/index.html`. Once they opened that file, local and CI numbers matched. Knowing *where the report lands* per build tool is half the battle.

---

## Mental Models

- **Run, then report.** Almost every coverage tool splits into two acts: a test run that *records* a raw data file (`cover.out`, `.coverage`, `jacoco.exec`), and a report step that *reads* that file into something human (text or HTML). One-flag tools like `pytest --cov` just glue the two together. See the split and the commands stop being magic.

- **Wrap, don't replace (the JS rule).** Coverage tools like `c8` and `nyc` don't run your tests — you put them *in front of* the command you already use. `c8 node --test` is "run my normal command, but watch its coverage." The test command underneath is unchanged.

- **The report is a heat map of neglect.** Red isn't "broken code" — it's "code no test has ever visited." Treat the red lines as a prioritized to-do list, hottest (most important untested path) first, not as a score to inflate.

- **Green ≠ correct.** A green line means *a test ran it*, not that a test *checked it was right*. Coverage proves execution, never correctness. That crucial distinction is the whole point of [05 — What Coverage Does *Not* Tell You](../05-what-coverage-does-not-tell-you/junior.md); keep it in the back of your mind even at this level.

---

## Common Mistakes

1. **Stopping at the percentage.** Running `go test -cover` or `jest --coverage` and reading only the number, never opening the HTML report. The number can't tell you *which* lines to test; the red lines can. Always render and open the report at least once.

2. **Forgetting to enable branch coverage.** Most tools default to **line** coverage, which marks `if x: do_a() else: do_b()` as covered the moment *either* side runs. You think you're done; half the logic is untested. Turn it on: `--cov-branch` (Python), `-covermode=count` (Go), it's on by default in JaCoCo and Istanbul.

3. **Looking for the report in the wrong place.** Each tool writes to its own path — `htmlcov/` (Python), `coverage/` (Jest/`c8`), `target/site/jacoco/` (Maven), `build/reports/jacoco/test/html/` (Gradle). "It didn't generate a report" usually means "I looked in the wrong folder."

4. **Confusing the data file with the report.** `cover.out`, `.coverage`, and `jacoco.exec` are *raw machine data*, not something you open in a browser. You must run the *report* step (`go tool cover -html`, `coverage html`, the JaCoCo report goal) to turn them into HTML.

5. **Mixing up the tool names in JS.** Istanbul (the library), `nyc` (its CLI), `c8` (the V8-native CLI), and lcov (the *format*) get conflated. You don't need to master the differences — just know `c8` is the modern default and you wrap your command with it.

6. **Committing the coverage artifacts.** `cover.out`, `.coverage`, `htmlcov/`, `coverage/`, `target/` are generated files. Add them to `.gitignore`. Checking them in clutters diffs and means nothing — they're regenerated every run.

---

## Test Yourself

1. In Go, you ran `go test -cover` and got `coverage: 73%`. What are the exact two commands to see *which lines* are red in a browser?
2. A Python project uses plain `unittest`, not pytest. Give the two-or-three command sequence (Coverage.py directly) to produce an HTML report.
3. Your `jest --coverage` run says a file is 100% covered, but you suspect an untested `else`. Which kind of coverage are you missing, and how would you turn it on conceptually?
4. You run `mvn test` on a Java repo with JaCoCo configured. Where does the HTML report land? What about with Gradle?
5. What does a **yellow/amber** line in an HTML coverage report mean, and why is it more interesting than a plain green line?
6. Your colleague says "`c8` is a test runner, right?" Correct them in one sentence.

<details>
<summary>Answers</summary>

1. `go test -coverprofile=cover.out ./...` then `go tool cover -html=cover.out`. The first records the profile; the second opens the colored HTML.
2. `coverage run -m unittest` (or `coverage run -m pytest`), then `coverage html`, then open `htmlcov/index.html`. (`coverage report -m` is an optional text view in between.)
3. You're missing **branch coverage** — line coverage marks the line covered as soon as one side of the `if`/ternary runs. Turn it on with `--cov-branch` (Python) / `-covermode=count` (Go); in Jest/Istanbul branch coverage is already reported, so check the "Branch" column.
4. **Maven:** `target/site/jacoco/index.html`. **Gradle:** `build/reports/jacoco/test/html/index.html`.
5. The line **ran, but only one side of its branch executed** — e.g. the `if` was taken but the `else` never was. It's more interesting because plain line coverage hides it: the line counts as "covered" while half its logic is untested.
6. **No** — `c8` is a coverage tool you wrap *around* a command (`c8 node --test`); it measures the coverage of whatever you run, it doesn't run your tests itself.

</details>

---

## Cheat Sheet

```
GO  (built in — nothing to install)
  go test -cover ./...                          quick % to the terminal
  go test -coverprofile=cover.out ./...         record the profile
  go tool cover -html=cover.out                 open the colored HTML report
  go tool cover -func=cover.out                 per-function text summary
  -covermode=count        (or atomic for goroutine-heavy tests)

PYTHON  (pip install pytest-cov)
  pytest --cov=myapp                            % + Missing line numbers
  pytest --cov=myapp --cov-report=html          → htmlcov/index.html
  pytest --cov=myapp --cov-branch               turn ON branch coverage
  # without pytest:
  coverage run -m pytest   →  coverage html     run, then report

JAVASCRIPT / TYPESCRIPT
  jest --coverage                               → coverage/lcov-report/index.html
  vitest run --coverage                         built-in
  npx c8 node --test                            wrap ANY command (V8-native)
  npx c8 --reporter=html node --test            → coverage/
  npx nyc mocha                                 older Istanbul CLI

JAVA  (JaCoCo, wired into the build)
  mvn test         →  open target/site/jacoco/index.html
  gradle test jacocoTestReport
                   →  build/reports/jacoco/test/html/index.html

THE REST (just know they exist)
  C/C++:  gcc --coverage … ; gcov ; lcov  |  clang + llvm-cov
  Rust:   cargo tarpaulin --out Html      |  cargo llvm-cov / grcov

READING THE REPORT
  GREEN  = a test ran this line
  RED    = nothing ran this line   ← your to-do list
  YELLOW = ran, but only one branch side (turn on branch coverage to see)
  IDE gutter = same colors, in your editor (Coverage Gutters / "Run with Coverage")

THE UNIVERSAL SHAPE
  instrument/watch  →  raw data file  →  report (text + HTML)
  cover.out / .coverage / jacoco.exec  are DATA, not the report
```

---

## Summary

- **Every mainstream language has a coverage tool built in or one install away.** Go (`go test -cover`), Python (Coverage.py via `pytest --cov`), JavaScript (`c8` / `nyc` / Jest), Java (JaCoCo), plus gcov/llvm-cov for C/C++ and tarpaulin/`llvm-cov` for Rust. Measuring coverage is never the hard part.
- The recurring pipeline is **instrument → raw data file → report**. Go writes `cover.out`, Python `.coverage`, JaCoCo `jacoco.exec`; a second *report* step turns that raw data into the human-readable HTML. One-flag tools like `pytest --cov` simply fuse the two steps.
- The **HTML report** (and the **IDE gutter**) is where the value lives: **green** = a test ran the line, **red** = nothing did, **yellow** = only one branch side ran. The percentage is a headline; the red lines are an actionable to-do list.
- **Branch coverage is usually off by default** in Go and Python — turn it on (`--cov-branch`, `-covermode=count`) or you'll mistake "the line ran" for "both sides of the `if` were tested."
- Know **where each tool's report lands** (`htmlcov/`, `coverage/`, `target/site/jacoco/`, `build/reports/jacoco/test/html/`) and add the generated artifacts to `.gitignore`.

You can now walk into a repo in any of these languages and produce a coverage report from cold. The next questions — *what* line vs branch vs path coverage actually counts, and how to make a CI gate fail when coverage drops on a pull request — build directly on this foundation.

---

## Further Reading

- [Go blog — *The cover story*](https://go.dev/blog/cover) — the canonical walkthrough of `go test -cover` and `go tool cover`, from the people who built it.
- [Coverage.py documentation](https://coverage.readthedocs.io/) — the `run` / `report` / `html` model, branch coverage, and configuration.
- [`c8` README](https://github.com/bcoe/c8) and [Istanbul / `nyc` docs](https://istanbul.js.org/) — the two JS coverage CLIs and the report formats they emit.
- [JaCoCo documentation](https://www.jacoco.org/jacoco/trunk/doc/) — the Maven/Gradle plugins and where reports land.
- The [middle.md](middle.md) of this topic — coverage *modes* and *formats* (lcov, cobertura, clover), merging reports from parallel test shards, and excluding generated code.

---

## Related Topics

- [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/junior.md) — *what* the green/red/yellow you're now reading actually counts, and why 100% line ≠ 100% branch.
- [02 — Mutation Coverage](../02-mutation-coverage/junior.md) — the stronger signal of test *quality* once line/branch coverage stops telling you enough.
- [04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/junior.md) — taking these same reports and making CI block a pull request when coverage drops.
- [middle.md](middle.md) · [senior.md](senior.md) — coverage modes, report formats, merging, and the judgment calls beyond "get a report."
