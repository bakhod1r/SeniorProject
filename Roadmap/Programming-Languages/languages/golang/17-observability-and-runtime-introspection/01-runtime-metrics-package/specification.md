# `runtime/metrics` — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where `runtime/metrics` Is Specified](#where-runtimemetrics-is-specified)
3. [Package Synopsis](#package-synopsis)
4. [The Metric Name Format](#the-metric-name-format)
5. [The `Description` Type](#the-description-type)
6. [The `Sample` Type and `Read`](#the-sample-type-and-read)
7. [The `Value` Type and `ValueKind`](#the-value-type-and-valuekind)
8. [The `Float64Histogram` Type](#the-float64histogram-type)
9. [Read Semantics and Consistency](#read-semantics-and-consistency)
10. [The Stability Guarantee](#the-stability-guarantee)
11. [Differences Across Go Versions](#differences-across-go-versions)
12. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does not mention `runtime/metrics`. The package is part of the *standard library*, not the language. Its authoritative reference is the package documentation at `pkg.go.dev/runtime/metrics`, supplemented by the original design proposal and the runtime source.

Sources of truth, in decreasing formality:

1. **Package documentation** — `pkg.go.dev/runtime/metrics`, which lists every type, function, and (per version) every metric name, kind, and description.
2. **The supported-metrics list** — the documented table of metric names, embedded in the package docs and discoverable at runtime via `metrics.All()`.
3. **The design proposal** — `golang/proposal` design document 37112, for rationale.
4. **Runtime source** — `src/runtime/metrics.go` and the `src/runtime/metrics/` package, the de-facto specification where docs are terse.

This file separates "what the package documents" from convention and implementation detail.

---

## Where `runtime/metrics` Is Specified

`runtime/metrics` is documented officially in:

1. **The package overview** — describes the metric-name format, the `Read`/`All` model, and the stability policy.
2. **The per-symbol docs** — `All`, `Read`, `Description`, `Sample`, `Value`, `ValueKind`, `Float64Histogram`.
3. **The supported-metrics section** — the version-specific list of names, each with its kind and a one-line description.

A paraphrase of the package's own framing:

> `runtime/metrics` provides a stable interface to Go runtime metrics. Each metric is identified by a name and has a value of a specific kind. The set of metrics is discoverable at runtime; metrics may be added in new Go releases, and code should be written to tolerate metrics it does not recognise.

That framing is the substance; the package page expands each clause.

---

## Package Synopsis

```go
package metrics

func All() []Description
func Read(m []Sample)

type Description struct {
    Name        string
    Description string
    Kind        ValueKind
    Cumulative  bool
}

type Sample struct {
    Name  string
    Value Value
}

type Value struct{ /* opaque */ }

func (v Value) Kind() ValueKind
func (v Value) Uint64() uint64
func (v Value) Float64() float64
func (v Value) Float64Histogram() *Float64Histogram

type ValueKind int

const (
    KindBad ValueKind = iota
    KindUint64
    KindFloat64
    KindFloat64Histogram
)

type Float64Histogram struct {
    Counts  []uint64
    Buckets []float64
}
```

- `All` returns the metrics supported by *this* binary, sorted by name.
- `Read` fills the `Value` of each `Sample`, matching by `Name`; unknown names get `KindBad`.
- The accessor methods panic if `Kind()` does not match the accessor called.

---

## The Metric Name Format

Per the package docs, a metric name has the form:

```
name = path ":" unit
```

- **`path`** — a forward-slash-separated, hierarchical identifier beginning with `/`. Each segment is a lowercase identifier. Example: `/memory/classes/heap/objects`.
- **`unit`** — a string describing the value's unit, composed of identifiers joined by `*`, `/`, or `-`. Examples: `bytes`, `seconds`, `objects`, `goroutines`, `gc-cycles`, `cpu-seconds`, `percent`, `threads`.

The full name includes the colon and unit: `/memory/classes/heap/objects:bytes`. Two metrics that share a path but differ in unit are distinct. Names are unique within a binary.

The docs note that the name format is itself stable: tooling may parse names by splitting on the final `:` to separate path from unit.

---

## The `Description` Type

`Description` documents one metric:

| Field | Meaning |
|-------|---------|
| `Name` | The full metric name including unit suffix. |
| `Description` | Human-readable text describing what the metric measures. |
| `Kind` | The `ValueKind` a `Read` of this metric will produce (`KindUint64`, `KindFloat64`, or `KindFloat64Histogram`). Never `KindBad`. |
| `Cumulative` | `true` if the metric is monotonically non-decreasing (a counter); `false` if instantaneous (a gauge). |

`All()` returns a `[]Description` containing exactly the metrics this binary supports, sorted by `Name`. The slice is freshly computed per call but stable within a binary's lifetime — the supported set does not change while the process runs.

---

## The `Sample` Type and `Read`

```go
type Sample struct {
    Name  string // input: set by the caller
    Value Value  // output: filled by Read
}

func Read(m []Sample)
```

Contract:

- The caller sets each `Sample.Name`. `Read` fills each `Sample.Value`.
- `Read` matches by `Name`. A name not in the supported set yields `Value` with `Kind() == KindBad`.
- `Read` does not allocate, reorder, or deduplicate the slice. Duplicate names are each filled independently.
- `Read(nil)` and `Read` of an empty slice are no-ops.
- `Read` is safe to call concurrently from multiple goroutines, though each call must own its `[]Sample` (the slices in a `Value` may be reused by the *same* slice's next read).

The docs explicitly encourage allocating the `[]Sample` once and reusing it across reads.

---

## The `Value` Type and `ValueKind`

`Value` is opaque. The caller inspects `Kind()` and calls the matching accessor:

| `Kind()` | Accessor | Returns |
|----------|----------|---------|
| `KindUint64` | `Uint64()` | `uint64` |
| `KindFloat64` | `Float64()` | `float64` |
| `KindFloat64Histogram` | `Float64Histogram()` | `*Float64Histogram` |
| `KindBad` | (none) | metric unsupported in this binary |

Calling an accessor whose kind does not match the value's actual kind **panics**. There is no error return; the accessor is effectively a checked type assertion. `KindBad` has no accessor — it signals "this name is not supported here," the mechanism by which code written against a newer Go version degrades on an older binary.

---

## The `Float64Histogram` Type

```go
type Float64Histogram struct {
    Counts  []uint64
    Buckets []float64
}
```

Per the docs:

- `Counts[i]` is the number of observations in the bucket whose range is `[Buckets[i], Buckets[i+1])`.
- `len(Buckets) == len(Counts) + 1`. The buckets are sorted in increasing order.
- The first and last bucket boundaries may be `-Inf` and `+Inf` respectively, making the outer buckets open-ended.
- For a cumulative histogram metric, `Counts` are lifetime totals; a windowed distribution is obtained by element-wise subtraction of two snapshots with identical `Buckets`.

The docs caution that the *contents* of `Buckets` (the specific boundaries) are not guaranteed stable across Go versions, even though the `Counts`/`Buckets` relationship is. The pointer returned by `Float64Histogram()` may share storage that a subsequent `Read` into the same `[]Sample` overwrites; callers that retain a histogram must copy it.

---

## Read Semantics and Consistency

The package documents these behaviours:

- **Coherent batch read.** Metrics read in a single `Read` call are gathered from a consistent view of runtime state, so related metrics (e.g. allocations and frees) are mutually consistent.
- **No global stop-the-world for the common path.** Unlike `runtime.ReadMemStats`, `Read` is designed to avoid halting all goroutines. (The docs frame this as a primary motivation for the package.)
- **Storage reuse.** Histogram-kind values may reference storage that `Read` reuses on the next call into the same slice.
- **Zero is valid.** A counter that has not incremented, or a histogram with all-zero counts, reads as zero — not as an error or absence.

There is no `error` return anywhere in the package. All failure modes are expressed as `KindBad` or as a panic on accessor misuse (a programming error).

---

## The Stability Guarantee

The package documents a deliberate stability policy:

- **The API is stable** under the Go 1 compatibility promise: `All`, `Read`, the types, and the accessors will not break.
- **The metric set is versioned, not frozen.** New metrics may be added in any release. Existing *stable* metrics keep their name and meaning.
- **Some metrics are explicitly marked as subject to change** in their descriptions; consumers should treat those as best-effort.
- **Forward-compatibility is built in:** unrecognised names read as `KindBad`, so code referencing a metric absent on the running binary does not break.

This policy is the package's central design contrast with `MemStats`: the struct was frozen and could not grow; the metric table can grow indefinitely while preserving compatibility.

---

## Differences Across Go Versions

The package and its metric set have evolved:

- **Go 1.16** — `runtime/metrics` introduced. Initial metrics cover `/gc/*`, `/memory/classes/*`, `/sched/goroutines`, and a few others. `KindUint64`, `KindFloat64`, `KindFloat64Histogram`, `KindBad` defined.
- **Go 1.17** — additional metrics; `/sched/latencies:seconds` histogram added; `/gc/limiter/*` internal additions.
- **Go 1.18** — `/sync/mutex/wait/total:seconds` added (mutex contention time).
- **Go 1.19** — additional GC and scheduler metrics; the `GOMEMLIMIT`-related machinery lands in the runtime.
- **Go 1.20** — the `/cpu/classes/*` family added (GC / scavenge / user / idle / total CPU-seconds).
- **Go 1.21** — `/gc/gogc:percent`, `/gc/gomemlimit:bytes`, `/sched/gomaxprocs:threads`, and the `/godebug/*` non-default-usage counters added.
- **Go 1.22–1.23** — incremental additions and refinements; the API surface is unchanged.

The mechanical API — `All`, `Read`, `Sample`, `Value`, the four kinds — has been stable since Go 1.16. The metric *catalogue* is what grows, which is exactly the design intent.

---

## References

- [`runtime/metrics` package documentation](https://pkg.go.dev/runtime/metrics) — authoritative, lists every metric per version.
- [Metric name format](https://pkg.go.dev/runtime/metrics#hdr-Metric_key_format)
- [Supported metrics list](https://pkg.go.dev/runtime/metrics#hdr-Supported_metrics)
- [`runtime.ReadMemStats`](https://pkg.go.dev/runtime#ReadMemStats) — the superseded API.
- [Proposal 37112: runtime metrics](https://github.com/golang/proposal/blob/master/design/37112-go-metrics.md) — design rationale.
- [Source: `src/runtime/metrics.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/runtime/metrics.go)
- [Source: `src/runtime/metrics/`](https://cs.opensource.google/go/go/+/refs/tags/master:src/runtime/metrics/)
