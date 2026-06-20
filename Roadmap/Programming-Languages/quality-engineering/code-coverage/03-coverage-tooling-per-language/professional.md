# Coverage Tooling per Language — Professional Level

> **Roadmap:** [Code Coverage](../README.md) → Coverage Tooling per Language
> *The senior page taught you to drive each language's coverage tool well. This page is about running fifteen of them across a hundred repos and forty teams — where the question stops being "how do I get a coverage report?" and becomes "why does Team A's 92% mean something completely different from Team B's 92%, and who do I trust?"*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Standardizing Coverage Across Many Languages and Teams](#standardizing-coverage-across-many-languages-and-teams)
4. [The Paved Path — Platform-Team Coverage Config](#the-paved-path--platform-team-coverage-config)
5. [The Build-Time and Flakiness Cost at Scale](#the-build-time-and-flakiness-cost-at-scale)
6. [Collecting Coverage That Reflects Reality](#collecting-coverage-that-reflects-reality)
7. [Language-Specific Gotchas That Bite at Scale](#language-specific-gotchas-that-bite-at-scale)
8. [Build vs Buy — The Aggregation Layer](#build-vs-buy--the-aggregation-layer)
9. [Maintaining Trust in the Number](#maintaining-trust-in-the-number)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Running coverage tooling across a large, polyglot organization, where the job is comparability and trust — not getting one report to render.**

The senior page assumed one codebase and one or two languages. At the professional level you own coverage as a *platform capability*: Go services, a JVM monolith, three Python data pipelines, a TypeScript frontend, a Rust sidecar, and some C++ nobody wants to touch — all feeding (or refusing to feed) one dashboard that an engineering director looks at every Monday.

The hard problems shift accordingly. Each language emits a different native format (`coverage.out`, `jacoco.xml`, `.coverage`, `lcov.info`, Cobertura XML). Each tool defaults differently — Coverage.py counts branches *only if you ask*, JaCoCo counts them by default, Go's `-covermode` changes whether the number is even race-safe. Instrumentation adds CPU and wall-clock to *every CI run*, multiplied by every repo and every push. And the deepest problem is semantic: when forty teams each wire up their own tooling, "coverage" fractures into forty subtly different measurements, and the org-wide number becomes a lie that everyone has stopped trusting but nobody has the leverage to fix.

This page is the pragmatic layer: how to standardize the format, pave the config, control the cost, collect numbers that reflect what's *actually* exercised, dodge the per-language traps, and pick the aggregation tooling — so that the coverage number survives contact with a real org.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — instrumentation mechanics, `-covermode`/`-coverpkg`, JaCoCo agents, Coverage.py branch mode, source-map-based JS coverage, merging profiles.
- **Required:** You've operated CI for more than one language and felt the difference in their coverage defaults.
- **Helpful:** You've owned a metrics dashboard that more than one team reads and acts on.
- **Helpful:** You've debugged a coverage number that was wrong — instrumentation missing, branches uncounted, or a report that silently dropped files.

---

## Standardizing Coverage Across Many Languages and Teams

The first thing that breaks in a polyglot org is *comparability*. A 90% from a Go service and a 90% from a Python pipeline are not the same measurement unless you've forced them to be, because the tools count different things by default and emit different formats.

**Pick one interchange format and convert everything into it.** The two that every aggregator understands are **lcov** (the de-facto line/branch tracing format from `gcov`) and **Cobertura XML** (the JVM-era format with per-class/per-line detail). The format itself matters less than the discipline: *one* format flowing into *one* dashboard. Every language's native output gets converted at the edge:

```
Language     Native output            → Convert to interchange
─────────────────────────────────────────────────────────────
Go           coverage.out             → gocover-cobertura  → cobertura.xml
Java/Kotlin  jacoco.exec / .xml       → jacoco's xml is read directly, or → cobertura
Python       .coverage (SQLite)       → coverage xml       → cobertura.xml  (or coverage lcov)
JS/TS        V8 / Istanbul json       → nyc/c8 report --reporter=lcov → lcov.info
Rust         profraw / profdata       → grcov --output-type lcov     → lcov.info
C/C++        .gcda/.gcno              → lcov / llvm-cov export        → lcov.info
```

But format conversion only makes the numbers *transmissible*, not *comparable*. Comparability requires also standardizing **what gets counted**:

- **Metric definition.** Are you reporting line coverage or branch coverage? If Team A reports line and Team B reports branch, their numbers are incomparable even in the same format. Pick one headline metric org-wide (branch coverage is the more honest default; see [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/professional.md)) and require it everywhere.
- **Exclusion policy.** Generated code, vendored dependencies, `*_test.go`, migrations, protobuf stubs — if each team excludes a different set, the denominators differ and the percentages are noise. Standardize the ignore globs.
- **Scope.** Go's `-coverpkg` decides whether you measure coverage of the package under test or of *all* packages exercised. Two Go repos with different `-coverpkg` settings produce numbers that don't mean the same thing.

> **The professional reality:** the org-wide coverage number is only meaningful if every repo computes it the same way — same metric, same exclusions, same scope, same format. Achieving that is not a tooling problem you solve once; it's a *paved path* the platform team owns and every repo inherits. Without it, the dashboard aggregates apples, oranges, and a few rocks, and the first time someone digs in, trust in the whole system collapses.

---

## The Paved Path — Platform-Team Coverage Config

"Every repo computes coverage the same way" does not happen by writing it in a wiki. It happens by *shipping it as config that repos inherit by default*. This is the platform-team job: make the comparable, correct setup the **path of least resistance**, so a team gets it right by doing nothing special.

Concretely, the paved path is a small set of shared, versioned artifacts:

- **A shared CI template / reusable workflow** per language that runs tests with the org-standard coverage flags already set. A team adopting it gets branch coverage, the standard exclusions, and the correct conversion-to-interchange step for free.
- **A pinned tool version** per language. Coverage numbers drift when JaCoCo, Coverage.py, or `nyc` change their counting between versions. Pin them in the template so an upgrade is a deliberate, org-wide event — not a silent per-repo skew.
- **A shared exclusion config** (e.g., a base `.coveragerc`, a JaCoCo exclusion list, a Go ignore convention) that repos extend rather than reinvent.
- **A standard upload step** to the aggregation layer with the right flags (correct format, correct commit SHA, correct flags for monorepo path mapping).

```yaml
# A reusable workflow the platform team owns; repos call it with one line.
# .github/workflows/coverage-python.yml  (org-shared)
on:
  workflow_call:
    inputs:
      package-path: { type: string, default: "." }
jobs:
  coverage:
    steps:
      - run: pip install "coverage==7.6.*"        # PINNED — no silent skew on upgrade
      - run: |
          coverage run --branch \                 # branch ON — the #1 polyglot pitfall (next section)
            --source="${{ inputs.package-path }}" \
            -m pytest
          coverage xml -o cobertura.xml           # convert to the org interchange format
      - uses: org/coverage-upload-action@v3        # standard upload, correct SHA + flags
```

The payoff is twofold. First, **consistency by default**: a new service is comparable on day one without the team becoming coverage experts. Second, **a single point of change**: when the org decides to switch interchange format, raise the branch-coverage requirement, or fix a counting bug, the platform team edits one template and every repo inherits it on next CI run — instead of forty teams making forty uncoordinated edits.

> **The principle:** paved-path coverage config is the only thing that makes org-wide comparability survive turnover and time. The alternative — documentation that teams are supposed to follow — decays the moment someone copies an old repo's setup or pins a different tool version. Encode the standard as inherited config, not as a norm people are asked to remember.

---

## The Build-Time and Flakiness Cost at Scale

Coverage instrumentation is not free, and "not free" multiplied by every repo, every branch, and every push becomes a real line item in your CI bill and your developers' wait time.

**The overhead varies wildly by mechanism:**

- **Compiler/source instrumentation** (Go `-cover`, LLVM source-based for Rust/C++, Istanbul for JS) — recompiles or rewrites code with counters. Build time goes up; runtime is usually a modest tax.
- **Bytecode agents** (JaCoCo) — instrument classes as they load; cheap to start, small steady-state cost, but the agent has to be attached on *every* run that you want measured.
- **Line-tracing via the interpreter** (Coverage.py without the C tracer, or older `sys.settrace`) — can slow a Python test suite **2–5×**. The C-accelerated tracer (`coverage`'s default `sysmon`/C tracer on modern versions) cuts this dramatically; running the slow tracer org-wide is a quiet, expensive mistake.
- **Branch/path modes cost more than line mode.** Branch coverage tracks more state. Go's `-covermode=atomic` (required for race-safe counts under `-race`) is measurably slower than `set` or `count` because every counter increment is atomic.

The professional move is to **not pay the full cost on every run.** Tier it:

- **Per-PR / per-push:** the *fast* coverage mode, scoped to what matters — line or branch coverage on the diff (see [04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/professional.md)). This is the number that gates merges, so it must be quick.
- **Nightly / scheduled:** the *heavy* modes — full-project coverage, atomic mode, mutation testing, the expensive integration/E2E coverage runs. Nobody is blocked waiting on these, so they can take an hour.
- **Cache aggressively.** Coverage runs still benefit from build caches and test caches; an instrumented build that reuses cached artifacts is far cheaper than a cold one. Be aware that some instrumentation **invalidates the cache** (Go's `-cover` changes the build, so cached non-cover artifacts don't apply) — budget for that.

```
                 fast (gate)              heavy (informational)
              ┌──────────────────┐     ┌──────────────────────────┐
  per-PR  →   │ diff coverage,    │     │                          │
              │ branch on diff,   │     │                          │
              │ line mode         │     │                          │
              └──────────────────┘     │                          │
  nightly →                            │ full-project coverage,    │
                                       │ -covermode=atomic,        │
                                       │ integration + E2E + prod, │
                                       │ mutation testing          │
                                       └──────────────────────────┘
```

> **The professional reality:** the instinct to "measure everything, everywhere, every time" is how coverage becomes the slowest, flakiest stage in CI — and a slow gate trains developers to resent and route around coverage entirely. Gate on the cheap, diff-scoped number; relegate the expensive, whole-system modes to nightly where their latency is invisible. The goal is a coverage signal developers don't notice the cost of.

---

## Collecting Coverage That Reflects Reality

The most dangerous coverage number in a large org is the one that's *technically correct but lies about what's actually exercised*. The classic failure: a service has 55% unit coverage, the dashboard flags it as under-tested, and someone pressures the team to write more unit tests — when in reality the service is exercised thoroughly by an integration suite and in production, and that 55% is fine. The inverse is worse: a service shows 90% unit coverage, everyone relaxes, and a whole class of behavior that only fires under real traffic is completely untested.

**Coverage that reflects reality means combining the sources that actually exercise the code:**

- **Unit coverage** — fast, deterministic, what most dashboards show. But for service-heavy or glue-heavy code, unit tests may exercise very little of what runs in production.
- **Integration coverage** — instrument the service while the integration suite drives it. This is where a lot of real-world code paths (serialization, DB access, middleware, error handling) actually get hit. For many services this is the *honest* coverage number, and judging them on unit coverage alone is judging the wrong thing.
- **E2E coverage** — instrument the deployed-in-test build while end-to-end / acceptance tests run against it, then collect the profile. Heavy and slower, but it catches wiring that no lower tier touches.
- **Production coverage** — instrument a build (or a canary) running real traffic and collect which code actually executes. This is the only way to find **truly dead code**: lines that *no test and no real user* ever reach. Go (`GOCOVERDIR` on a `-cover`-built binary), JaCoCo (a long-running agent dumping `.exec`), and LLVM source-based coverage all support collecting from a running process.

The mechanism that makes this work is **merging profiles across sources** — the same machinery the senior page covered for combining parallel shards, now applied across *test tiers*. You union the line/branch hits from unit + integration + E2E (+ prod) into one combined report, so a line counts as covered if *any* tier exercised it.

```bash
# Go: merge unit + integration + a production-traffic profile into one truth
go test ./... -cover -args -test.gocoverdir="$PWD/cov/unit"
# integration suite drives a -cover-built binary writing to cov/integ via GOCOVERDIR
# canary binary (also -cover-built) dumps to cov/prod via GOCOVERDIR
go tool covdata merge -i=cov/unit,cov/integ,cov/prod -o cov/merged
go tool covdata percent -i=cov/merged          # the number that reflects reality
go tool covdata textfmt -i=cov/merged -o merged.out   # → convert → dashboard
```

> **The hard-won lesson:** unit coverage alone systematically *under-counts* code that integration and E2E tests exercise, and systematically *misses* code that only production traffic reaches. Judging teams on unit coverage in isolation pushes them to write low-value unit tests for paths their integration suite already covers, while leaving the genuinely-untested-in-production paths invisible. The number that's worth trusting is the *merged* one — and production coverage is the only tool that reliably finds code that is truly dead.

---

## Language-Specific Gotchas That Bite at Scale

Each language's coverage tooling has a default or a failure mode that, replicated across many repos, silently corrupts the org-wide number. These are the ones that actually bite.

**Python — branch coverage is OFF by default.** Coverage.py measures *line* coverage unless you pass `--branch` (or set `branch = True` in `.coveragerc`). Every repo that wires up `pytest-cov` without it reports inflated, line-only numbers — and because line coverage is always ≥ branch coverage, the whole org *systematically over-reports*. A repo can show 95% line while its branch coverage is 78%, and nobody knows because the un-taken `else` branches were never counted. This is the single most common reason a polyglot org's Python numbers are quietly wrong.

```ini
# .coveragerc — MUST be in the paved-path template, or every repo under-counts
[run]
branch = True
source = src
```

**JavaScript/TypeScript — source-map drift hides real gaps.** Coverage is collected on the *compiled/bundled* JS, then mapped back to your TS source via source maps. If the source maps are stale, misconfigured, or the transpiler (`tsc`, `babel`, `esbuild`, `swc`) emits inaccurate mappings, coverage gets attributed to the wrong lines — or whole files appear fully covered because their generated output was trivially exercised while the real branches in the source were not. The symptom is coverage that looks suspiciously clean on heavily-transpiled or heavily-minified code. Mitigation: keep source maps accurate end-to-end, prefer instrumenting source where the toolchain supports it, and treat "100% on a complex transpiled module" as a smell to investigate.

**Java/Kotlin — the JaCoCo agent missing on a service.** JaCoCo measures nothing if the agent isn't attached to the JVM under test. In a large org this fails silently per-service: someone forgets the `-javaagent` / Gradle-Maven wiring on a new service, or an integration-test harness launches the JVM without it, and that service reports **0% or no data** — which a naive dashboard either shows as a scary zero or, worse, *omits*, quietly shrinking the denominator of the org-wide average. The fix is to make agent attachment part of the paved-path build template and to *alert on services reporting no coverage data at all*, not just on low coverage.

**Go — `-coverpkg` misconfiguration.** By default `go test -cover` measures coverage of the package being tested. To measure coverage of *all* packages exercised by a test (e.g., integration tests in one package that drive code across many), you need `-coverpkg=./...`. Get this wrong and you either under-count (integration tests appear to cover almost nothing because the measured package is just the test harness) or over-count (instrumenting packages that no test in scope touches, dragging the denominator). Two Go repos with different `-coverpkg` conventions are not comparable — which is exactly why scope must be in the paved-path template.

**Rust / C++ — profile data fragmentation.** LLVM source-based coverage emits per-process `.profraw` files that must be merged (`llvm-profdata merge`) before reporting. Tests that fork, run in parallel, or crash can drop or fragment profraw files; a missing merge step or a `LLVM_PROFILE_FILE` pattern that collides across processes produces partial coverage that looks like a real gap. `grcov`/`cargo-tarpaulin` wrap this, but the failure mode (lost profraw → phantom uncovered lines) recurs at scale.

> **The professional reality:** every one of these is invisible in a single repo and *systemic* across an org. Python's branch-off default inflates the whole company's Python numbers; one mis-wired JaCoCo agent silently distorts the average; inconsistent `-coverpkg` makes Go repos incomparable. The defense is the same in every case: **encode the correct setting in the paved-path template so no repo can get it wrong by accident, and alert on the *absence* of data, not just on low data.**

---

## Build vs Buy — The Aggregation Layer

You will not build the dashboard, the diff-coverage UI, the PR status checks, the trend graphs, and the multi-language report ingestion yourself — not well, and not for free in maintenance. The realistic decision is *which* aggregation layer, and how much of it.

| Option | What it gives you | The catch |
|---|---|---|
| **Codecov** | Multi-language report ingestion, diff/patch coverage, PR comments, flags for monorepos, trend graphs | SaaS (data leaves your perimeter unless self-hosted/enterprise); flaky upload behavior historically; cost scales with usage |
| **Coveralls** | Similar core: ingestion, per-PR coverage, trends | Lighter on monorepo/multi-language ergonomics than Codecov; SaaS |
| **SonarQube / SonarCloud** | Coverage *plus* static analysis, quality gates, code smells, security hotspots in one quality model | Coverage is one signal in a larger product; ingests reports (it doesn't instrument); the quality-gate model is opinionated and can become its own politics |
| **Self-hosted / DIY** | Full control, data stays in-house, custom rules | You now own report ingestion, format conversion, the UI, storage, and the on-call for it — rarely worth it unless compliance forbids SaaS |

The key architectural fact: **all of these are an aggregation layer, not an instrumentation layer.** They consume the lcov/Cobertura reports your CI already produces; they do not run your tests or instrument your code. That means the paved-path work (standard format, standard exclusions, correct upload) is a prerequisite *regardless of vendor* — the tool is only as good as the comparable reports you feed it.

**How to decide:**

- **Default to buy** for the aggregation layer. Diff coverage, PR status checks, trend storage, and multi-language ingestion are commodity capabilities that a vendor does better than you will, and your engineers' time is better spent on the paved path.
- **Choose Codecov/Coveralls** when coverage is the focus and you want best-in-class diff-coverage UX and PR integration.
- **Choose SonarQube** when leadership wants *one* quality gate spanning coverage + static analysis + security, and is willing to live inside Sonar's opinionated model. (Note Sonar can self-host, which sometimes resolves data-residency objections to the SaaS-only options.)
- **Build/self-host only** when a hard compliance or data-residency requirement forbids shipping coverage data (which can leak source structure) to a third party — and budget for the ongoing operational cost honestly.

> **The principle:** buy the aggregation layer; own the paved path. The differentiated, high-leverage work is making every repo emit comparable, correct reports — not reimplementing a coverage dashboard. The vendor turns comparable reports into a trustworthy dashboard; it cannot fix incomparable inputs.

---

## Maintaining Trust in the Number

A coverage dashboard is only useful if the people looking at it *believe* it. The fastest way to kill a coverage program is to let the number become something nobody trusts — at which point it's worse than nothing, because it generates arguments and gaming without informing decisions.

Trust erodes in predictable ways, and each has a defense:

- **Incomparable numbers across teams** → the standardization and paved-path work above. If Team A's number means line coverage with lax exclusions and Team B's means branch coverage with strict ones, every cross-team comparison is bogus and people learn to ignore the dashboard.
- **Silent data loss** → alert when a repo reports *no* coverage data or a sudden cliff (a JaCoCo agent dropped off, an upload failed). A missing service silently shrinks the org average and makes the number optimistic. Treat "no data" as a failure, not a zero.
- **The number reflecting the wrong tier** → surface *merged* (unit + integration + E2E) coverage where it exists, so a service isn't judged unfairly on unit coverage that doesn't reflect how it's actually exercised.
- **Gaming** → this is where trust meets [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/professional.md). The moment coverage becomes a hard KPI tied to performance, teams write assertion-free tests, slap `# pragma: no cover` on hard branches, and delete the gnarly code paths that drag the number. The number goes up; the signal dies. The defense is cultural as much as technical: use coverage as a *diagnostic* (find untested code, gate the diff) not a *target* (a global percentage everyone must hit).
- **Stale exclusions** → exclusion lists accumulate cruft; a team excludes a module "temporarily" and it's still excluded three years later, hiding real gaps. Review exclusions periodically; treat a growing exclusion list as a smell.

> **The professional reality:** the coverage number is a shared instrument, and a shared instrument that some teams have learned to distrust or game is a liability. Maintaining trust is mostly the unglamorous work of *comparability* (paved path), *honesty* (merged tiers, alert on missing data), and *restraint* (signal, not target). Get those right and the dashboard informs decisions; get them wrong and it becomes a quarterly argument.

---

## War Stories

**The polyglot org where every team's "coverage" meant something different.** A platform team built a unified dashboard pulling coverage from every repo. The org-wide average looked healthy — until someone tried to compare two teams and the numbers made no sense. Investigation found the Go teams were split between `-coverpkg=./...` and package-scoped defaults; the Python teams were a mix of branch-on and branch-off; the JVM teams had wildly different JaCoCo exclusion lists; and one frontend repo was reporting coverage of its *compiled* bundle with no source maps. Forty teams, forty definitions of "coverage." The dashboard was aggregating measurements that shared a unit (%) but not a meaning. The fix wasn't a better dashboard — it was a *paved-path* coverage template per language that pinned the tool version, forced branch coverage, standardized exclusions and `-coverpkg`, and converted everything to one interchange format. Only after every repo computed the number the same way did the dashboard mean anything.

**Python branch coverage off org-wide, inflating every number.** A company's Python services all reported 90%+ coverage and leadership was pleased. A new engineer noticed that a function with an untested `else` branch still showed as fully covered, dug in, and found that *not a single Python repo* had `branch = True` set — every one was reporting line-only coverage via a copy-pasted `pytest-cov` invocation. Re-running with branch coverage on dropped the org-wide Python number by double digits overnight, exposing thousands of untested branches that the line-only metric had hidden. The lesson: a wrong *default*, replicated by copy-paste across an org, becomes a systemic blind spot — and the only durable fix is putting the correct setting in shared, inherited config so no repo can omit it.

**Dead code found only by adding production coverage.** A team trying to shrink a sprawling service stared at 80%+ test coverage and couldn't tell which code was safe to delete — the tests covered it, so it *looked* alive. They built the binary with coverage instrumentation, ran it on a canary against real traffic for a week (`GOCOVERDIR`), and merged the production profile with the test profiles. The production data revealed entire modules — feature flags long since defaulted off, a legacy API path no client called anymore, an error handler for a condition that could no longer occur — that *tests exercised but real users never hit*. Those modules were covered but genuinely dead. The team deleted thousands of lines with confidence they could not have gotten from test coverage alone. The lesson: test coverage tells you what tests touch; only *production* coverage tells you what's actually used, and the gap between them is where dead code hides.

---

## Decision Frameworks

**Which interchange format? Ask:**
- Does my aggregation tool natively prefer one? → use it (Codecov/Coveralls handle both lcov and Cobertura; lean lcov for JS/Rust/C++-heavy stacks, Cobertura for JVM/Python-heavy).
- Do I have heterogeneous languages? → pick *one* and convert all native outputs to it at the CI edge. The format matters far less than the consistency.

**Gate on per-PR or nightly? Ask:**
- Is this the cheap, diff-scoped number developers wait on? → per-PR gate (line/branch on the diff).
- Is it full-project, atomic-mode, integration/E2E, or mutation coverage? → nightly, informational — never block a PR on a slow whole-system run.

**Unit coverage enough, or do I need integration/E2E/prod? Ask:**
- Is the code service/glue-heavy, where unit tests exercise little of what runs? → you *must* merge integration (and ideally E2E) coverage, or you're judging the wrong number.
- Do I need to find truly dead code to delete safely? → add *production* coverage; nothing else reveals code that tests touch but users never reach.

**Build or buy the aggregation layer? Default to buy:**
- Coverage-focused, want best diff-coverage UX → Codecov/Coveralls.
- Want one quality gate over coverage + static analysis + security → SonarQube/SonarCloud.
- Hard data-residency/compliance ban on SaaS → self-host Sonar, or DIY only if truly forced (and budget the operational cost).

**Is the number trustworthy? Check:**
- Same metric, exclusions, scope, format across repos? → if not, fix the paved path before anyone reads the dashboard.
- Alerting on *missing* data, not just low data? → a silently-absent service makes the average lie.
- Is coverage a diagnostic or a hard KPI? → if it's a target, expect gaming and discount the number accordingly.

---

## Mental Models

- **A coverage percentage is only comparable if everyone computed it identically.** Same metric, same exclusions, same scope, same format — otherwise the org-wide number aggregates measurements that share a unit but not a meaning. Comparability is a paved-path property, not a tooling default.

- **The paved path is the standard; documentation is decay.** Encode the correct coverage config as inherited CI templates and pinned tool versions. A norm people are asked to remember dies on the next copy-pasted repo; inherited config survives turnover.

- **Gate on the cheap number, learn from the expensive one.** Diff-scoped coverage gates PRs because it's fast; full-project, atomic, integration/E2E, and mutation coverage run nightly because their latency is invisible there. A slow gate trains developers to route around coverage.

- **Unit coverage is a partial truth; the merged number is the honest one.** For service-heavy code, integration and E2E tests do the real exercising, and production coverage is the only thing that finds truly dead code. Judge teams on the merged number, not on unit coverage in isolation.

- **Buy the aggregation layer; own the inputs.** The dashboard, diff UI, and PR checks are commodity — a vendor does them better. The differentiated work is making every repo emit comparable, correct reports. The tool is only as trustworthy as the inputs you feed it.

- **A number nobody trusts is worse than no number.** A gamed or incomparable coverage metric generates arguments and assertion-free tests without informing decisions. Trust is maintained by comparability, honesty about tiers and missing data, and treating coverage as signal, not target.

---

## Common Mistakes

1. **Aggregating per-language numbers without standardizing what they count.** A 90% from Go and a 90% from Python aren't comparable unless metric, exclusions, scope, and format match. Force one definition via the paved path before the dashboard means anything.

2. **Shipping coverage standards as documentation instead of inherited config.** A wiki page decays the moment someone copies an old repo. Encode the standard as shared CI templates and pinned tool versions so repos get it right by doing nothing.

3. **Running heavy coverage modes on every PR.** Full-project, atomic-mode, and integration/E2E coverage on every push makes coverage the slowest, flakiest CI stage. Gate on the cheap diff number; relegate the heavy modes to nightly.

4. **Judging service-heavy teams on unit coverage alone.** Their real exercising happens in integration/E2E tests; unit coverage under-counts it and pushes them to write low-value unit tests. Merge the tiers, and add production coverage to find dead code.

5. **Leaving Python branch coverage off.** Coverage.py defaults to line-only; without `branch = True` every repo over-reports, and replicated org-wide it's a systemic blind spot. Put it in the template.

6. **Trusting clean coverage on heavily-transpiled JS.** Stale or wrong source maps attribute coverage to the wrong lines and make complex modules look fully covered. Treat "100% on a complex transpiled module" as a smell; keep source maps accurate.

7. **Treating a missing JaCoCo agent (or any no-data repo) as a zero or omission.** A service reporting no coverage silently distorts the average. Alert on the *absence* of data, not just on low data.

8. **Building the aggregation dashboard yourself.** Diff coverage, PR checks, and trend storage are commodity. Buy them; spend your effort on the paved path that produces comparable reports — the input the vendor can't fix.

9. **Letting coverage become a hard KPI.** Tie it to performance and teams game it (assertion-free tests, `pragma: no cover`, deleting hard branches). The number rises, the signal dies. Use it as a diagnostic and gate the diff — see [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/professional.md).

---

## Test Yourself

1. Two teams both report "90% coverage" and you're asked to compare them on one dashboard. List the four things that must match for the numbers to be comparable, and explain why each one can silently make them incomparable.
2. Why is shipping a coverage *standard* as a shared CI template superior to documenting it in a wiki? Give the two concrete payoffs.
3. Coverage instrumentation is making CI slow and flaky across the org. Describe the tiering strategy that keeps the gate fast, and name two heavy modes you'd push to nightly.
4. A service-heavy team shows 55% unit coverage and is being pressured to write more unit tests. Explain why that number may be misleading and what you'd measure instead.
5. You need to find code that is *truly dead* — safe to delete. Why is test coverage insufficient, and what kind of coverage actually answers the question? Name the Go mechanism.
6. Your org's Python services all report 90%+ coverage. What single default would you check first, and why does getting it wrong inflate the number org-wide?
7. A new Java service shows up on the dashboard as 0% (or doesn't show up at all). What's the most likely cause, and what should the dashboard do about no-data repos rather than treating them as zeros?
8. You're choosing an aggregation layer. State the default decision, the one case for SonarQube, and the one case that justifies self-hosting/DIY.

<details>
<summary>Answers</summary>

1. **Metric** (line vs branch — branch is always ≤ line, so mixing them is apples-to-oranges), **exclusions** (different ignore globs change the denominator), **scope** (e.g., Go's `-coverpkg` decides whether you measure the package under test or everything exercised), and **format** (must convert all native outputs to one interchange like lcov/Cobertura so the aggregator reads them consistently). Each is a per-tool default that differs silently, so two repos can both honestly print "90%" while measuring different things.
2. A template is **inherited config**, not a norm people must remember: (1) **consistency by default** — a new repo is comparable on day one without the team becoming coverage experts; (2) **a single point of change** — the platform team edits one template (raise branch requirement, fix a counting bug, switch format) and every repo inherits it on next CI, instead of forty uncoordinated edits. Documentation decays on the first copy-pasted repo.
3. **Tier it:** per-PR runs the *fast*, diff-scoped number (line/branch on the diff) that gates merges; **nightly** runs the heavy modes — full-project coverage, `-covermode=atomic`, integration + E2E + production coverage, and mutation testing — where their latency blocks nobody. Cache builds/tests, noting some instrumentation invalidates the cache.
4. Unit coverage **under-counts** code exercised by integration/E2E tests, which for service/glue-heavy code do the real work (serialization, DB, middleware, error handling). The 55% may be fine. Measure the **merged** coverage across unit + integration (+ E2E), so a line counts if any tier hit it — judging on unit alone pushes the team to write low-value unit tests for paths already covered.
5. Test coverage only tells you what *tests* touch; covered code can still be unreachable by real users (e.g., a feature-flagged-off path tests still exercise). **Production coverage** — instrument a build/canary running real traffic and collect which lines execute — is the only thing that finds code tests touch but users never reach. In Go: build with `-cover` and collect via **`GOCOVERDIR`**, then merge with test profiles via `go tool covdata`.
6. **Branch coverage being off** (`branch = True` not set in `.coveragerc`/Coverage.py defaults to line-only). Line coverage is always ≥ branch coverage, so every repo over-reports; replicated by copy-paste org-wide it hides thousands of untaken branches. Fix by putting `branch = True` in the paved-path template.
7. The **JaCoCo agent isn't attached** to the JVM under test (forgotten `-javaagent`/build wiring, or an integration harness launching the JVM without it). The dashboard should **alert on no-data / sudden cliffs** and exclude such repos from the average rather than counting them as zero or silently omitting them — a missing service makes the org average optimistic.
8. **Default: buy** the aggregation layer (Codecov/Coveralls for best diff-coverage UX). **SonarQube** when leadership wants one quality gate spanning coverage + static analysis + security in an opinionated model. **Self-host/DIY** only when a hard data-residency/compliance rule forbids sending coverage data (which can leak source structure) to a SaaS — and only with the operational cost budgeted.

</details>

---

## Cheat Sheet

```
STANDARDIZE (or the org number is meaningless)
  one interchange format: lcov  OR  cobertura.xml  (convert all native output at CI edge)
  one headline metric:    branch coverage org-wide  (line ≥ branch → mixing lies)
  one exclusion policy + one scope (Go -coverpkg) in the paved-path template

NATIVE → INTERCHANGE
  Go      coverage.out  → gocover-cobertura / covdata textfmt
  Java    jacoco .xml   → read directly / → cobertura
  Python  .coverage     → coverage xml | coverage lcov   (NEED branch=True)
  JS/TS   v8/istanbul   → nyc/c8 report --reporter=lcov   (watch source-map drift)
  Rust    profraw       → grcov --output-type lcov        (merge profdata first)
  C/C++   .gcda/.gcno   → lcov / llvm-cov export

COST TIERING
  per-PR   → fast, diff-scoped (line/branch on diff) — gates merge
  nightly  → full-project, -covermode=atomic, integration+E2E+prod, mutation
  cache builds/tests; note -cover invalidates non-cover cache

REFLECT REALITY (merge tiers; a line is covered if ANY tier hit it)
  go tool covdata merge -i=cov/unit,cov/integ,cov/prod -o cov/merged
  production coverage (GOCOVERDIR / JaCoCo agent / llvm) = the only dead-code finder

LANGUAGE GOTCHAS AT SCALE
  Python  branch OFF by default        → branch=True in template, else org over-reports
  JS/TS   source-map drift             → "100% on transpiled module" = smell
  Java    JaCoCo agent missing         → 0%/no-data; ALERT on absence, not just low
  Go      -coverpkg misconfig          → under/over-count; pin scope in template

BUILD vs BUY (aggregation layer consumes reports; it does NOT instrument)
  default → buy: Codecov / Coveralls (diff coverage, PR checks, trends)
  one gate over coverage+SAST+security → SonarQube/SonarCloud (opinionated)
  hard data-residency ban → self-host Sonar / DIY (own the on-call)

TRUST
  comparable inputs + alert on missing data + merged tiers + signal-not-target
```

---

## Summary

- **Comparability is the whole game.** A coverage percentage is only meaningful across an org if every repo computes it identically — same **metric** (branch, org-wide), same **exclusions**, same **scope** (Go `-coverpkg`), and same **interchange format** (lcov or Cobertura) feeding one dashboard. Without that, the org-wide number aggregates measurements that share a unit but not a meaning.
- **Ship the standard as a paved path, not a wiki.** A platform-owned, per-language CI template with *pinned* tool versions, standard exclusions, and the correct conversion-and-upload step makes the comparable setup the path of least resistance — consistent by default, changeable from one place.
- **Control the cost by tiering.** Gate PRs on the fast, diff-scoped number; relegate full-project, atomic-mode, integration/E2E, and mutation coverage to nightly where their latency blocks nobody. A slow coverage gate trains developers to route around it.
- **Collect coverage that reflects reality.** Unit coverage under-counts service/glue code that integration and E2E tests actually exercise, and misses code only production traffic reaches. **Merge** the tiers, and use **production coverage** (Go `GOCOVERDIR`, JaCoCo agent, LLVM) — the only reliable way to find truly dead code.
- **Know the per-language traps that bite at scale.** Python branch coverage off by default inflates every repo; JS source-map drift hides real gaps; a missing JaCoCo agent silently distorts the average; Go `-coverpkg` misconfig makes repos incomparable. The defense is always the same — encode the right setting in the template and *alert on absent data, not just low data*.
- **Buy the aggregation layer; own the inputs.** Codecov/Coveralls for diff-coverage UX, SonarQube for a unified quality gate, self-host only when compliance forbids SaaS. The tool turns comparable reports into a trustworthy dashboard — it cannot fix incomparable inputs.
- **A number nobody trusts is worse than none.** Maintain trust through comparability, honesty about tiers and missing data, and restraint — coverage as a diagnostic, not a hard KPI that teams will game.

You can now run coverage tooling as a platform capability across a polyglot org, not just as a per-repo report. The next tier — [interview.md](interview.md) — distills the entire topic into the questions that reveal whether someone has actually operated this at scale.

---

## Further Reading

- [Codecov documentation](https://docs.codecov.com/) — multi-language report ingestion, flags for monorepos, and diff/patch coverage; the de-facto reference for the aggregation layer.
- [Coverage.py — branch coverage and configuration](https://coverage.readthedocs.io/en/latest/branch.html) — why branch is off by default and how to enable it org-wide.
- [Go coverage for whole programs (`covdata`, `GOCOVERDIR`)](https://go.dev/blog/integration-test-coverage) — collecting and merging coverage from integration tests and running binaries.
- [JaCoCo agent and offline instrumentation](https://www.jacoco.org/jacoco/trunk/doc/agent.html) — how attachment works and why a missing agent yields no data.
- [SonarQube quality gates](https://docs.sonarsource.com/) — the unified coverage-plus-static-analysis model and its opinionated gate.
- *Software Engineering at Google* (Winters, Manshreck, Wright), coverage chapter — why Google does not enforce a global coverage threshold, and coverage as diagnostic over KPI.

---

## Related Topics

- [04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/professional.md) — diff/patch coverage, the ratchet, gating, and combining parallel shards: the fast number this page tiers onto PRs.
- [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/professional.md) — Goodhart's law, gaming the number, and why the trust this page protects depends on coverage staying a diagnostic.
- [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/professional.md) — what each metric counts, and why standardizing on branch coverage matters for comparability.
- [junior.md](junior.md) · [senior.md](senior.md) · [interview.md](interview.md) — the rest of this topic's five-tier set.
- [Build Systems](../../build-systems/) — the build-time cost, caching, and toolchain-pinning machinery that coverage instrumentation rides on.
