---
layout: default
title: Benchmark Deep — Professional
parent: Benchmarking Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/17-benchmark-deep/professional/
---

# Benchmark Deep — Professional

[← Back](../)

This page is for staff and principal engineers who are responsible
for the performance discipline of an organisation. It is less about
how to make a single benchmark accurate and more about how to make
*every* benchmark in your repo trustworthy, sustained over years,
with rotating teams. Treat each section as a policy you can lift
wholesale.

The audience for this page is the engineer who will, in their next
performance review cycle, be asked: "what is the perf posture of
the team's services?" If the answer is "we run a benchmark
sometimes," the engineer has not done their job. If the answer is
"here are the SLO contracts, here is the trend dashboard, here is
the gate, here is the false-positive audit," they have.

## 1. Performance as a contract, not a goal

A team that writes "improve performance" tickets without an
acceptance criterion will never know when to stop. The professional
move is to attach a numerical contract to every performance-
relevant interface: "this handler MUST complete at p99 < 8ms on
95th-percentile production hardware under the documented load
profile."

The contract belongs in the package doc comment and is verified by
a tagged benchmark (`//go:build perf_contract`) that runs nightly
on a dedicated runner.

The contract has four parts:

1. The percentile.
2. The latency.
3. The hardware profile.
4. The load profile.

Drop any one and the contract is empty. "Faster than yesterday" is
not a contract. "P99 under 8ms" is half a contract — half because
the hardware is unspecified. "P99 under 8ms on c6i.2xlarge under
1000 QPS of mixed-read load" is a real contract.

Once you have contracts, you can talk about *contract violations*
instead of "the perf person complained again". A contract violation
is a bug, with the same triage process as a functional bug. This is
how perf work moves from a special interest of a few engineers to a
shared concern of the team.

## 2. The bench fixture document

Every performance result your team publishes — in a PR description,
a postmortem, a blog post — MUST include a bench fixture block.
This is the eight-invariant list from the specification page:

- Go version.
- Commit SHA.
- Build flags.
- Machine model.
- Frequency-lock state.
- SMT state.
- GOGC/GOMEMLIMIT.
- PGO profile presence.

Build a `go-bench-fixture` tool that prints this block to stdout so
it is one paste away from any report. Numbers without a fixture are
unverifiable folklore.

The fixture tool can be as simple as:

```go
package main

import (
    "fmt"
    "os"
    "os/exec"
    "runtime"
)

func main() {
    out, _ := exec.Command("git", "rev-parse", "HEAD").Output()
    fmt.Println("Bench Fixture")
    fmt.Println("-------------")
    fmt.Printf("go version: %s\n", runtime.Version())
    fmt.Printf("commit: %s", out)
    fmt.Printf("GOMAXPROCS: %d\n", runtime.GOMAXPROCS(0))
    fmt.Printf("GOGC: %s\n", os.Getenv("GOGC"))
    fmt.Printf("GOMEMLIMIT: %s\n", os.Getenv("GOMEMLIMIT"))
    fmt.Printf("os: %s/%s\n", runtime.GOOS, runtime.GOARCH)
    if data, err := os.ReadFile("/sys/devices/system/cpu/intel_pstate/no_turbo"); err == nil {
        fmt.Printf("turbo: %s", data)
    }
}
```

Bake the tool into your bench harness. Every bench run begins with
the fixture print. Twelve months later you can still match a saved
result to its conditions.

## 3. Tiered performance CI

A single performance gate is doomed. Build three:

**Smoke tier** (per PR, on shared runners). Runs the top-30 hottest
benchmarks for 5 seconds each, no `-count`. Reports raw deltas,
never blocks. Purpose: catch order-of-magnitude regressions. A 50%
slowdown in any of the top 30 is caught before merge; a 5%
slowdown is below the noise floor of this tier and goes through.

**Focused tier** (post-merge to main, on a pinned runner). Runs the
contract benchmarks with `-benchtime=5s -count=10` and gates on
benchstat `p < 0.05, threshold = 5%`. Blocks merge train if the
contract is broken. Sends a Slack alert with the offending PR.

**Trend tier** (nightly, on bare metal). Runs the entire suite
with `-count=20`. Stores results in a time-series DB. Alerts on
CUSUM-detected slope changes, not per-night deltas. This is what
catches the 0.5%/week creep that no per-PR diff would notice.

The reason for three tiers is that the false-positive cost is
different at each. A blocked PR is expensive (developer time); a
missed regression in main is even more expensive (rollback, blast
radius). Nightly trend detection is the safety net for slow drifts
that no per-PR gate would ever catch.

The triage workflow:

- Smoke alert on PR: comment posted, dev decides.
- Focused alert post-merge: ticket auto-filed, on-call investigates
  within 24 hours.
- Trend alert nightly: ticket auto-filed, owner investigates within
  one week.

Each tier has a different SLA and a different blast-radius. Mixing
them produces gate fatigue.

## 4. The pinned runner specification

A pinned runner is a dedicated server (bare metal, not VM, not
container with cpuset alone) configured for measurement, not
service. Spec:

- Single-socket modern x86 or ARM.
- BIOS: turbo off, SMT off, C-states off, frequency lock at base.
- OS: Linux, `cpupower frequency-set --governor performance`, no
  other user processes.
- IRQs banished from the bench cores (`irqbalance --banned-cpus`).
- Page allocator pre-warmed with `mlock`.
- Reserved benchmark cores not visible to general scheduler
  (`isolcpus=`).

Treat the pinned runner as production hardware: it is the source of
truth for *all* perf claims. Rotation is allowed only if the new
runner has been calibrated against the old (run the same fixture on
both for two weeks, confirm the delta is under your noise floor).

Cost: a dedicated bare-metal bench host runs $200-500/month on most
cloud providers (Hetzner, Equinix Metal, dedicated AWS instances).
This is cheaper than one engineer-day of debugging a flaky gate, so
it pays back the first time.

The runner has a calibration suite that runs nightly: a fixed
synthetic workload whose ns/op is known. If today's number diverges
from history by more than the noise floor, the runner has changed
state (BIOS reset, kernel upgrade, hardware drift). The calibration
suite catches this before it pollutes real benchmarks.

## 5. The benchstat dashboard

A spreadsheet of benchstat outputs is unreadable after two weeks.
Build a dashboard with three views:

**Per-benchmark history**: a sparkline of the median plus an IQR
band, one line per benchmark, hovering reveals the commit that
caused each step. Pick out which commit caused the jump in
August — without the dashboard, this question takes hours.

**Cross-version matrix**: rows are Go versions, columns are
benchmarks, cell colour is the delta vs the previous version. This
is how you spot a runtime regression in a `go1.X` release before
you upgrade prod. Run this on a fresh checkout the day a new Go
RC drops.

**Variance budget**: a tile per benchmark, colour-coded by current
noise floor. Anything above 5% IQR is yellow; above 10% is red. A
red tile means "this benchmark is no longer useful — fix the
measurement or delete it". The variance budget keeps your suite
honest. A drift toward more red tiles means your runner is
degrading.

The dashboard is what makes the discipline scale. Without it,
performance work concentrates in the heads of one or two seniors
and decays when they leave.

Tools: Grafana on top of a TSDB (InfluxDB, Prometheus, Timestream)
is the standard stack. Output benchmark results in JSON via
`benchstat -json` and ingest. The whole pipeline can be set up in
a few engineer-days; the maintenance cost is near zero once stable.

## 6. Profile-guided everything

PGO is no longer experimental (stable since Go 1.21). Bake it into
the build pipeline:

- Production canary collects a `cpu.pprof` every 10 minutes,
  aggregates to a weekly `default.pgo`.
- Main branch CI uses last week's `default.pgo` for all builds.
- Performance contract benchmarks run twice: once with PGO, once
  without. The delta is reported separately so you can see the PGO
  win and the static-build performance independently. If PGO is
  the only thing keeping you within contract, your code is fragile
  to profile drift.

A profile collection script:

```bash
#!/bin/bash
# Collected hourly by a canary host.
TS=$(date -u +%Y%m%dT%H%M%S)
curl -s "http://localhost:6060/debug/pprof/profile?seconds=120" \
    -o "/var/perf/profiles/${TS}.pprof"
```

A weekly aggregation:

```bash
#!/bin/bash
# Run weekly, produces a representative profile.
cd /var/perf/profiles
go tool pprof -proto $(ls *.pprof | tail -168) > /var/perf/default.pgo
```

The 168 profiles cover a week of hourly samples, which captures the
weekly-cyclical workload (weekday peaks, weekend troughs).

Citation: `pkg.go.dev/runtime#hdr-Profile-Guided_Optimization`.

## 7. Runtime metrics in production telemetry

`runtime/metrics` is not just for benchmarks. Pipe
`/sched/latencies:seconds`, `/gc/pauses:seconds`, and
`/sync/mutex/wait/total:seconds` into your production metric system
at 10s resolution.

Now your benchmarks predict prod and your prod data informs your
benchmark fixtures. A regression in `sched/latencies` p99 in prod is
your cue to add a benchmark that exercises that path.

A reference scrape endpoint:

```go
import (
    "expvar"
    "runtime/metrics"
)

func init() {
    expvar.Publish("runtime_metrics", expvar.Func(func() any {
        names := []string{
            "/sched/latencies:seconds",
            "/gc/pauses:seconds",
            "/sync/mutex/wait/total:seconds",
            "/gc/cpu-time:seconds",
            "/gc/heap/allocs:bytes",
        }
        samples := make([]metrics.Sample, len(names))
        for i, n := range names {
            samples[i].Name = n
        }
        metrics.Read(samples)
        out := make(map[string]any, len(samples))
        for _, s := range samples {
            switch s.Value.Kind() {
            case metrics.KindUint64:
                out[s.Name] = s.Value.Uint64()
            case metrics.KindFloat64:
                out[s.Name] = s.Value.Float64()
            case metrics.KindFloat64Histogram:
                h := s.Value.Float64Histogram()
                out[s.Name] = map[string]any{
                    "counts":  h.Counts,
                    "buckets": h.Buckets,
                }
            }
        }
        return out
    }))
}
```

Scrape this from your monitoring agent (Prometheus, Datadog, etc).
Now the data feeds both the production dashboard and the post-
mortem analysis.

## 8. The death of `benchcmp`

If you see `benchcmp` in any internal doc, file an issue to delete
the reference. It does no statistical test, has been unmaintained
since 2018, and produces deltas that survive scrutiny only by
accident. The migration is a one-liner: `benchstat old.txt new.txt`.
Make the lint rule explicit so newcomers do not reintroduce it.

A grep for `benchcmp` in your repo today is a tax you pay for
having tolerated it in the past. Pay it once and move on.

## 9. The cost of false positives

A flaky perf gate is worse than no gate. After three false
positives a developer learns to merge-anyway, and the gate is dead.

Audit your gate's false-positive rate monthly: re-run baseline-vs-
baseline with the gate's actual config and count how often it
would have blocked. Acceptable rate is below 1%. Anything higher
means you need to reduce noise (better runner, longer benchtime,
higher threshold) or accept a lower power to detect small
regressions. Both are valid choices; pretending the gate is
reliable when it is not, is not.

The audit cost is small (one half-day of compute per month) and
the discipline payoff is enormous. A gate with a known, low FP
rate gets trusted by developers; a gate with unknown FP rate gets
ignored.

## 10. The perf person and the team

A common failure mode: one senior engineer owns "performance" and
no one else cares because perf "is hard." The senior leaves; perf
decays.

The professional move is to make perf a property of the team, not
of one person. Specific habits:

- Performance review checklist in PR template, including the bench
  fixture and the benchstat output.
- Rotation of "perf on-call" for a week at a time, including
  triaging the trend-tier alerts.
- A monthly "perf forum" where the team reviews the dashboard,
  picks one regression to investigate, and one improvement to
  celebrate.
- Onboarding doc that includes "how to write a benchmark for this
  codebase" with the team's house style and the location of the
  reusable fixture helpers.

If perf is owned by everyone, no single departure kills it. If perf
is owned by one person, the bus factor is one.

## 11. The contract benchmark template

Here is the template the team should use for every contract
benchmark:

```go
//go:build perf_contract

// Package myservice perf contract:
//
//   /api/v1/foo MUST complete at p99 < 8ms under the load profile
//   described in load_profile.go on hardware described in
//   bench_fixture.txt. This contract is verified nightly by
//   BenchmarkAPIFooContract.
package myservice_test

import (
    "testing"

    "example.com/myservice/internal/benchutil"
)

func BenchmarkAPIFooContract(b *testing.B) {
    f := benchutil.Begin(b)
    srv := newContractServer(b)
    load := loadContractProfile(b)

    for i := 0; i < b.N; i++ {
        t0 := time.Now()
        sink = serveOne(srv, load[i%len(load)])
        f.Record(time.Since(t0))
    }

    f.End(b)
    f.AssertP99(b, 8*time.Millisecond)
}
```

The `AssertP99` is a custom helper that calls `b.Fatal` if the p99
exceeds the contract. The bench fails the build if the contract
breaks.

The `//go:build perf_contract` tag ensures these benchmarks do not
run in regular CI (they need the dedicated runner). The trend tier
runs `-tags=perf_contract`.

## 12. The blame-free postmortem for regressions

When a regression slips through, hold a postmortem. The format:

- What was the regression (the benchstat output)?
- When did it merge (the PR)?
- Why did the gate not catch it (the audit)?
- What is the fix to the *gate*?

The fix is to the gate, not to the developer. A perf regression
that slipped through a gate is a *gate bug*, not a *developer
mistake*. Fixing the developer with shame produces fear; fixing the
gate produces a better gate.

Common gate fixes after a regression:

- The benchmark did not cover the regressed path. Add it.
- The threshold was too high. Lower it.
- The sample count was too low. Raise it.
- The runner was noisy that night. Investigate, harden.

Each postmortem makes the gate stronger. Over a year of postmortems
the gate becomes industrial-grade.

## 13. Communicating perf numbers to non-engineers

Engineering management wants to know "are we faster than last
quarter?" The honest answer involves percentiles, samples, and
caveats. The diplomatic answer is a single number plus a footnote.

Pick *one* representative benchmark — the contract bench for your
top revenue-generating service — and track its p99 over time as
the team's headline perf number. Annotate the time series with the
major releases. Include a footnote: "measured on c6i.2xlarge, Go
1.23, GOGC=100, weekly mean of nightly runs."

Management gets a number; engineers retain the right to point at
the footnote when the number is questioned. Both are happy.

## 14. The cost of premature optimisation policy

Do not benchmark something that is not in the profile. The
discipline cuts both ways:

- A junior who wants to "make X faster" should be redirected: "is
  X in the profile? Show me."
- A senior who has a hunch should ground it: "I think this matters;
  here is the bench; here is the prod data."

Without this discipline a team will burn weeks on micro-
optimisations that move zero percent of prod. With it, every perf
PR has a paper trail of relevance.

## 15. The perf budget for the team

Allocate a fixed fraction of engineering time to perf work each
sprint. Common splits:

- 5% — minimum. Enough for triage and trend monitoring.
- 10% — healthy. Allows proactive optimisation as well as triage.
- 20% — high. Justified when the product is perf-sensitive (low-
  latency trading, real-time games, video encoding).

The budget covers:

- Maintaining the bench suite (delete stale, add new).
- Investigating trend-tier alerts.
- Reviewing perf-tagged PRs.
- Annual reviewer audits (re-run baseline-vs-baseline, refresh the
  noise-floor docs).
- One bigger optimisation project per quarter.

Without a budget, perf work is squeezed by features. With it, perf
debt is paid down before it becomes a crisis.

## 16. The art of the perf postmortem

When a perf incident reaches production (SLO breach, public-facing
slowdown), write a postmortem. Format:

1. **Summary**: one sentence — what regressed, by how much, for how
   long.
2. **Timeline**: when the regression merged, when it shipped, when
   it was detected, when it was rolled back.
3. **Root cause**: the specific code change, with a benchstat
   reproduction.
4. **Why the gate missed it**: noise floor, missing bench, threshold
   too high, runner unavailable.
5. **Action items**: gate improvements, new benches, runner
   investments.
6. **Lessons**: what we now know that we did not before.

Distribute internally. Keep an index of postmortems searchable so
the next perf incident's investigator can find precedent. A team
with five years of indexed postmortems has a powerful collective
memory.

## 17. The perf-tagged PR

Add a PR template field "Performance impact": Yes / No / Unknown.
If Yes, require benchstat output. If Unknown, require the PR author
to determine it by running the suite. If No, the reviewer may
challenge the assertion if the change touches a hot path.

This single template field cuts the rate of unmeasured perf changes
significantly. It does not prevent regressions but it raises the
visibility of all performance-relevant work.

## 18. Allocator and runtime tuning at scale

Some services need more than `GOGC` and `GOMEMLIMIT`. The Go
runtime exposes more knobs via `GODEBUG`:

- `madvdontneed=1` — return memory to OS more aggressively.
- `gctrace=1` — print a line per GC cycle to stderr.
- `schedtrace=1000` — print scheduler stats every 1000ms.
- `cgocheck=2` — costly checks for cgo memory safety, off in prod.
- `asyncpreemptoff=1` — disable async preemption, for diagnostics.

In production these are tuned per service after experimentation.
Bench fixtures should record which GODEBUG flags were set, because
they change runtime behaviour.

## 19. Building the perf graduation ladder

A team's perf maturity grows in stages:

- **Stage 0**: no benches. Performance is a folklore property.
- **Stage 1**: ad-hoc benches written when a manager asks. Numbers
  are anecdotal.
- **Stage 2**: bench file per package, baseline in git. PRs include
  benchstat output. Most regressions caught at review.
- **Stage 3**: tiered CI, dedicated runner, dashboard. Contracts
  on top services.
- **Stage 4**: PGO in build, runtime/metrics in prod, postmortem
  culture. Perf is a first-class engineering discipline.

Most teams stall at Stage 2 because Stage 3 requires infra
investment. The professional move is to advocate for the
infrastructure with concrete numbers: "we missed 3 regressions last
quarter that a dedicated runner would have caught; the runner costs
$300/month vs an estimated $20,000 of remediation time saved."

## 20. The relationship between perf and reliability

Perf regressions tend to cascade into reliability incidents. A
service that slows by 10% may push its dependency over a timeout;
the dependency retries; the retries amplify load; a thundering
herd takes down the cluster.

This means a perf gate is partially a reliability gate. Treat the
two disciplines as connected:

- The same postmortem template for both kinds of incident.
- The same on-call rotation handles both.
- The dashboard shows latency and error rate side-by-side.
- The same SLO doc lists both perf and reliability targets.

Teams that separate perf and reliability into different sub-teams
often miss the connections; teams that integrate them catch more
issues.

## 21. Open-source contributions and the perf upstream

For Go-using teams, the runtime and standard library are upstream
dependencies. A perf regression in Go itself eventually shows up in
your bench suite (via the cross-version comparison from section 11
of the senior page). When it does, the right move is to file an
issue at github.com/golang/go with:

- The benchstat output across versions.
- The bench source code.
- The bench fixture.

The Go team is responsive to well-documented perf regressions. Many
of the optimisations in recent Go versions came from end-user
reports of "this slowed down in 1.X". Be that end-user.

Conversely, contributions of bench-driven optimisations to upstream
Go are valued. If you discovered a stdlib hot path that allocates
unnecessarily, file a CL. The patch goes through code review with
benchstat numbers attached; the discipline you have built in your
own team translates directly.

## 22. The perf "office hours" practice

Schedule a weekly hour where any engineer can bring a perf question:
"why is my code slow?", "is this microbench right?", "what does this
profile mean?" The senior perf engineer (you) holds office hours.

Over a year, this practice:

- Spreads perf knowledge across the team.
- Catches misconceptions before they ship.
- Builds the trust required for the dashboards and gates to be
  taken seriously.

The time cost is low (one hour per week). The cultural impact is
high. Perf becomes a thing the team talks about, not a thing one
person worries about.

## 23. The PR perf section enforcement

In addition to the template field, add a CI check that fails the
PR if the description does not contain a "Performance" section.
This is annoying for trivial PRs (typo fixes, doc edits) so allow
a `[perf-skip]` tag in the title for those.

The discipline ensures that no perf-relevant change ships without
some thought given to its performance impact. The friction is
minor; the catch rate is high.

## 24. Cross-team perf collaboration

Performance regressions sometimes cross team boundaries. Team A's
change in a shared library slows team B's service. The discipline
that catches this:

- Shared libraries have their own bench suite, run by their owning
  team, but the *output* is visible to consumers.
- Consumer teams subscribe to alerts on the shared library's
  contract benchmarks.
- The release process for the shared library includes a "perf
  impact" section in the release notes.

Without this, perf regressions reach prod via "transitive
dependency upgrade" and surprise everyone. With it, the consumer
team can pin to the previous version while the producer team
debugs.

## 25. The yearly perf review

Once a year, hold a perf review across all critical services:

- Are the contracts still aligned with business goals (SLO)?
- Are the gates catching what they should?
- Are the runners still calibrated?
- Are there new tools to adopt (Go releases, new tracing tools)?
- Are there obsolete tools to retire?

The output is a list of perf-engineering work for the next year.
This is how the discipline stays current; without an annual review
it ossifies and slowly stops fitting the team's reality.

## 26. The cost of *not* doing perf work

Sometimes the cost of perf neglect is visible: a customer complains,
SLO breaches, page out. Sometimes it is invisible: cloud bills grow
silently because the service has been running 30% slower than
necessary for a year, requiring more instances to handle the same
load.

A perf-aware team should periodically audit the *cost* dimension of
performance, not just the latency dimension. A 30% perf improvement
on a $200k/month cloud bill saves $60k/month. That pays for the
perf engineer.

## 27. Closing on the professional

Performance discipline scales with the size of the team. The tools
that suffice for one engineer (a baseline.txt in git) become
inadequate for ten (need a dashboard) and inadequate again for a
hundred (need contracts and tiered gates). Each step costs more in
infrastructure and process but pays for itself in avoided
regressions.

The skills on this page are not technical so much as organisational.
A staff engineer who reads this and shrugs has misjudged the
audience: the technical layer is owned by the senior engineers; the
job above is to make sure their work survives, scales, and is
visible. That is what distinguishes a perf-aware team from a
perf-aware individual.

[← Back](../)
