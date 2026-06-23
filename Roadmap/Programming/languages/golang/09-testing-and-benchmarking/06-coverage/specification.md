---
layout: default
title: Coverage — Specification
parent: Test Coverage
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/06-coverage/specification/
---

# Coverage — Specification

[← Back](../)

This page collects the normative material that defines how Go coverage works. It is intentionally short. The authoritative sources are `go help testflag`, `go tool cover -help`, the `cmd/cover` package documentation, the `golang.org/x/tools/cover` package, and the Go 1.20 release notes referencing proposal [#51430](https://github.com/golang/go/issues/51430) (integration test coverage). Everything else in this subsection is application or commentary on these primitives.

## 1. Relevant `go test` flags

Excerpt from `go help testflag` (Go 1.22):

```
-cover
    Enable coverage analysis.
    Note that because coverage works by annotating the source
    code before compilation, compilation and test failures with
    coverage enabled may report line numbers that do not
    correspond to the original sources.

-covermode set,count,atomic
    Set the mode for coverage analysis for the package[s]
    being tested. The default is "set" unless -race is enabled,
    in which case it is "atomic".
    The values:
        set: did each statement run?
        count: how many times did each statement run?
        atomic: like count, but counts precisely in parallel programs;
                significantly more expensive.
    Sets -cover.

-coverpkg pattern1,pattern2,pattern3
    Apply coverage analysis in each test to packages matching
    the patterns. The default is for each test to analyze only
    the package being tested. See 'go help packages' for a
    description of package patterns. Sets -cover.

-coverprofile cover.out
    Write a coverage profile to the file after all tests have
    passed. Sets -cover.
```

The key normative points:

1. `-cover` implies source rewriting (so reported error line numbers may shift).
2. Default mode is `set` unless `-race` is on, in which case `atomic` is forced.
3. `-coverpkg` controls *which* packages are instrumented; without it the default is "only the package under test".
4. `-coverprofile` only writes the profile when tests pass.

## 2. `go tool cover` subcommand

Excerpt from `go tool cover -help`:

```
Usage of 'go tool cover':
Given a coverage profile produced by 'go test':
    go test -coverprofile=c.out

Open a web browser displaying annotated source code:
    go tool cover -html=c.out

Write out an HTML file instead of launching a web browser:
    go tool cover -html=c.out -o coverage.html

Display coverage percentages to stdout for each function:
    go tool cover -func=c.out

Finally, to generate modified source code with coverage annotations
(what -cover does internally):
    go tool cover -mode=set -var=CoverageVariableName program.go

Flags:
    -h
        Print this help text and exit.
    -html=c.out
        Generate HTML representation of coverage profile.
    -func=c.out
        Output coverage profile information for each function.
    -mode=set,count,atomic
        Set the mode for coverage analysis.
    -o=file
        File for output; default is stdout.
    -var=varname
        Name of coverage variable to generate.
```

## 3. The coverage profile file format

The text format written by `-coverprofile` is documented informally by the `golang.org/x/tools/cover` package. A profile looks like this:

```
mode: set
example.com/pkg/foo.go:10.13,12.2 1 1
example.com/pkg/foo.go:14.13,16.2 1 0
example.com/pkg/bar.go:5.20,7.3 2 1
```

Grammar:

- First line: `mode: <set|count|atomic>`.
- Each subsequent line: `<file>:<startLine>.<startCol>,<endLine>.<endCol> <numStatements> <count>`.

Fields:

- `file`: import path plus relative file name.
- `startLine.startCol,endLine.endCol`: the boundaries of a *block*.
- `numStatements`: number of statements covered by this block (used to compute percentages).
- `count`: in `set` mode, 0 or 1; in `count`/`atomic`, the exact execution count.

The `cover` package exposes `ParseProfiles(filename string) ([]*Profile, error)` returning blocks parsed into Go structs.

## 4. The "block" concept

Go coverage is *statement-level*, not branch-level. A "block" is a maximal run of statements with a single entry and a single exit — a basic block in compiler terms. The compiler-driven rewrite increments a counter at the beginning of every block. There is no separate "this branch of an `if` was taken vs not" data — you only know whether the *body* of each branch executed. If you write `if a && b { ... }`, you cannot tell from coverage alone whether the short-circuit on `a==false` happened, only whether the body ran.

This is the single most important specification fact and the source of most coverage misconceptions.

## 5. Integration coverage (Go 1.20+)

Proposal #51430 introduced building any binary with `-cover`, not just test binaries:

```
go build -cover -o myapp ./cmd/myapp
mkdir cov
GOCOVERDIR=cov ./myapp run-some-integration-scenario
go tool covdata percent -i=cov
go tool covdata textfmt -i=cov -o=cover.out
```

The new `go tool covdata` subcommand operates on the binary format written into `GOCOVERDIR`. It can:

- `percent`: print percent covered.
- `func`: per-function breakdown.
- `pkglist`: list instrumented packages.
- `textfmt`: convert binary format to the legacy text profile, mergeable with `go test -coverprofile` output.
- `merge`: merge multiple `GOCOVERDIR` directories.
- `subtract` and `intersect`: set operations on coverage data.

The binary format is documented in `src/internal/coverage/`; consumers should use `go tool covdata textfmt` to convert before parsing.

## 6. Default behavior summary

| Flag combination | Mode | Packages instrumented |
|---|---|---|
| `go test` | none | n/a |
| `go test -cover` | `set` | package under test only |
| `go test -cover -race` | `atomic` | package under test only |
| `go test -cover -coverpkg=./...` | `set` | all matching packages |
| `go test -coverprofile=c.out` | `set` | package under test only |
| `go test -covermode=atomic -coverprofile=c.out` | `atomic` | package under test only |
| `go build -cover -o app ./...` | `set` (build-time default) | all matching packages |

## 7. The `golang.org/x/tools/cover` package

The official Go toolchain ships a small library at `golang.org/x/tools/cover` for parsing the text profile format. Its public API:

```go
package cover

// Profile represents the profile for a single file.
type Profile struct {
    FileName string
    Mode     string
    Blocks   []ProfileBlock
}

// ProfileBlock represents a single block of profile data.
type ProfileBlock struct {
    StartLine, StartCol int
    EndLine,   EndCol   int
    NumStmt, Count      int
}

// ParseProfiles parses profile data in the specified file.
// The returned Profiles are sorted by FileName.
func ParseProfiles(fileName string) ([]*Profile, error)

// ParseProfilesFromReader parses profile data from the given Reader.
func ParseProfilesFromReader(rd io.Reader) ([]*Profile, error)

// Boundary represents the position in a source file of the
// start or end of a block as marked by the line/col fields
// of a ProfileBlock.
type Boundary struct {
    Offset int     // Byte offset in the file
    Start  bool    // Is this the start of a block?
    Count  int     // Hit count, from ProfileBlock
    Norm   float64 // Count normalized to [0..1]
    Index  int     // Order in input file
}

// Boundaries returns a Profile as a set of Boundaries.
// The boundaries are sorted by Offset and then by Start = false before
// Start = true. The src parameter is the source code.
func (p *Profile) Boundaries(src []byte) (boundaries []Boundary)
```

`ParseProfiles` is the entry point most consumers need. The `Boundary` API is for tools producing source-annotated views (the implementation of `go tool cover -html`).

## 8. `go tool covdata` subcommands (Go 1.20+)

Reference for the `covdata` subcommand:

```
Usage of 'go tool covdata':

go tool covdata <command> [<options>]

Commands:
  percent      report % statement coverage
  func         output coverage profile information for each function
  pkglist      list instrumented packages
  textfmt      convert from binary to legacy text format
  merge        merge data files together
  subtract     compute the set difference of two data sets
  intersect    compute the set intersection of two data sets
  debugdump    dump out raw counts to stdout
```

Common options:

- `-i=DIR1[,DIR2,...]`: input directories.
- `-o=FILE` or `-o=DIR`: output file or directory.
- `-pkg=PATTERN`: restrict to matching packages.
- `-v=N`: verbosity.

## 9. The `GOCOVERDIR` environment variable

When a binary built with `go build -cover` is invoked with `$GOCOVERDIR` set to a directory path, the runtime writes coverage data to that directory at graceful exit. If `GOCOVERDIR` is unset, the binary runs normally but coverage data is discarded.

Files written:

- `covmeta.HASH`: package and block metadata. Hash is computed from instrumented packages' source. Written once per binary.
- `covcounters.HASH.PID.NANOSTIME`: counter values. Written each run.

If the binary cannot write to `$GOCOVERDIR` (permissions, disk full, missing directory), it logs an error to stderr and continues without coverage. This is documented in the Go 1.20 release notes.

## 10. Coverage Mode Conversion

The text profile format and the binary format both encode the mode. Conversion via `go tool covdata textfmt` preserves the mode.

When merging profiles, the modes must match. The standard tools enforce this and refuse to merge mixed modes. Custom merger code should do the same.

## 11. The `-coverpkg` pattern syntax

`-coverpkg` accepts a comma-separated list of patterns, each interpreted by the standard `go list` pattern syntax (`go help packages`). Common forms:

- `./...`: all packages in the current module.
- `./internal/...`: a subtree.
- `example.com/path/...`: a fully-qualified package tree.
- `./...,!./vendor/...`: include `./...` but exclude `./vendor/...` (the `!` negation).

The patterns are evaluated against the build's package list, which determines which packages get instrumented.

## 12. Statement count semantics

A "statement" in coverage terms is what the Go compiler counts as a statement in the AST. This includes:

- Assignment statements.
- Function calls used as statements.
- Control flow statements (`if`, `for`, `switch`, etc.) — but their bodies are counted separately.
- `return` statements.
- `defer` and `go` statements.

It does *not* include:

- Variable declarations (in some contexts).
- Type declarations.
- Constant declarations.
- Comments and blank lines.

The exact definition is encoded in the cover rewriter (`cmd/cover` or `cmd/compile`); for practical purposes, treat "statement" as roughly "one line of executable code".

## 13. Profile output format detail

A profile line in the text format:

```
<file>:<startLine>.<startCol>,<endLine>.<endCol> <numStatements> <count>
```

Fields:

- `<file>`: path, usually import path plus relative file name.
- `<startLine>`, `<startCol>`: source position of the block start. Lines are 1-indexed. Columns are 1-indexed.
- `<endLine>`, `<endCol>`: source position of the block end. The block extends from start (inclusive) to end (exclusive).
- `<numStatements>`: integer count of statements in the block.
- `<count>`: integer execution count. In `set` mode this is 0 or 1; in `count`/`atomic` it can be any non-negative integer.

Lines are sorted by file then by start position. Within a file, blocks do not overlap.

## 14. Error behavior

When tests fail:

- `-coverprofile` still writes the profile (modern Go versions).
- The process exits with status 1.
- The profile reflects coverage up to the point of failure.

When the test binary panics:

- The profile may or may not be written, depending on whether the runtime's deferred handlers ran.
- A `kill -9` does not allow the runtime to flush.

When tests pass:

- The profile is written cleanly.
- The process exits with status 0.

## 15. Reproducibility

Coverage profiles are deterministic for a given source and test input. Two runs of the same `go test -cover` invocation produce byte-identical profiles, provided:

- No tests use non-deterministic input (random, timestamps, network).
- No tests have flaky behavior.
- Parallel test scheduling does not affect which branches execute.

Deterministic profiles enable cache-based optimizations: the same source can reuse a cached profile.

## 16. Backwards compatibility

The text profile format has been stable since Go 1.2 (when `go test -cover` was introduced). Go 1.20 added the binary format for `GOCOVERDIR`; the binary format is internal and may change between releases, so consumers should always go through `go tool covdata textfmt` for stability.

Tools relying on the text format (Codecov, Coveralls, third-party parsers) continue to work unchanged across Go versions.

