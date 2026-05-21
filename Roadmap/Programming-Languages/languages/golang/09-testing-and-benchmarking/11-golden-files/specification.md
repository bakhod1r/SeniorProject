---
layout: default
title: Golden Files — Specification
parent: Golden File Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/11-golden-files/specification/
---

# Golden Files — Specification

[← Back](../)

## Purpose

Define a deterministic contract for golden file testing in Go projects. A golden file test compares the byte output of a system under test (SUT) against a checked-in reference file stored under `testdata/`. The framework is intentionally minimal: a flag, a file, and `bytes.Equal`.

## Vocabulary

- **SUT** — system under test, the function that produces output.
- **Actual** — bytes produced by the SUT during a test run.
- **Golden** — bytes stored on disk in `testdata/*.golden`.
- **Update mode** — test execution with `-update` (or `-update-golden`) flag set; the test overwrites the golden file with the actual output instead of comparing.
- **Normalizer** — pre-comparison function that removes non-deterministic substrings (timestamps, UUIDs, version strings, paths) from the actual output.

## File layout

```
package/
  feature.go
  feature_test.go
  testdata/
    TestFeature_basic.golden
    TestFeature_empty.golden
    fixtures/
      input.json
```

Go's toolchain ignores any directory named `testdata` for build and `go vet`. Only test code may read from it. The convention is hardcoded into `cmd/go`.

## Flag contract

A single package-level boolean flag:

```go
var update = flag.Bool("update", false, "update .golden files")
```

Behavior:

1. When `*update == false` (default): read golden bytes, compare, fail on mismatch.
2. When `*update == true`: write actual bytes to golden path, do not assert equality, log the path that was rewritten.
3. The flag must be defined exactly once per package (use `package_test.go` for shared test helpers).

Invocation:

```
go test ./...                 # compare mode
go test ./pkg -run TestX -update  # regenerate one golden
```

## Naming

Each golden file maps to one subtest. Recommended name:

```
<TestName>[_<subtest>].golden
```

For table-driven tests use the case name with slashes converted to underscores. The helper:

```go
func goldenPath(t *testing.T) string {
    name := strings.ReplaceAll(t.Name(), "/", "_")
    return filepath.Join("testdata", name+".golden")
}
```

## Comparison algorithm

1. Run SUT, capture bytes.
2. Apply normalizer chain (optional).
3. If `*update`, call `os.WriteFile(path, normalized, 0o644)` and return.
4. Read golden via `os.ReadFile(path)`. Missing file is a test failure with explicit instruction to run with `-update`.
5. If `!bytes.Equal(got, want)` produce a diff (line-based) and call `t.Fatalf`.

## Normalization rules

A normalizer is a pure function `func([]byte) []byte`. Required properties:

- Idempotent: `n(n(x)) == n(x)`.
- Total: defined for all inputs.
- Stable: same input produces same output across runs and platforms.

Common normalizers, expressed as ordered regex substitutions:

| Source         | Pattern                                        | Replacement     |
|----------------|------------------------------------------------|-----------------|
| RFC3339 time   | `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z` | `<TIMESTAMP>`   |
| UUID v4        | `[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-...`     | `<UUID>`        |
| Build version  | `v\d+\.\d+\.\d+(-\w+)?`                        | `<VERSION>`     |
| Absolute path  | project root prefix                             | `<ROOT>`        |
| Line endings   | `\r\n`                                          | `\n`            |

Apply normalizers to actual bytes only. The golden file is the canonical, already-normalized form.

## Diff format

On failure print a unified-style diff. Minimal implementation uses `github.com/google/go-cmp/cmp` with line transformation:

```go
diff := cmp.Diff(string(want), string(got))
t.Fatalf("golden mismatch for %s (-want +got):\n%s", path, diff)
```

Output must include the golden path so reviewers can navigate the failure.

## Concurrency

Golden file tests may run in parallel only if each subtest reads (and optionally writes) a distinct path. Update mode under `t.Parallel()` is safe because each goroutine writes to its own file. Forbidden: two subtests sharing the same `.golden` path.

## Determinism requirements for the SUT

A golden test makes sense only when the SUT is deterministic given fixed inputs. The SUT must:

- Use injected `time.Time` (no `time.Now`).
- Use injected random source (no global `rand`).
- Iterate maps in sorted key order when serializing.
- Avoid map-based JSON encoding without sorting (encoding/json sorts top-level map keys but not arbitrary user-controlled iteration).

If the SUT cannot meet these constraints, place the burden on normalizers — but understand that masking non-determinism is strictly weaker than eliminating it.

## CI behavior

CI must run without `-update`. A diff in any golden file fails the build. The repository's `Makefile` typically exposes:

```
make test          # go test ./...
make update-golden # go test ./... -update
```

Reviewers MUST inspect every changed `.golden` file in a PR diff. A merged update with no human review defeats the purpose of the test.

## Error messages

When a golden file is missing:

```
golden file testdata/TestX.golden does not exist; run: go test ./pkg -run TestX -update
```

When a golden file is empty and actual is non-empty: treat as mismatch, not as missing.

## Binary vs text

Golden files default to UTF-8 text. Binary payloads (PNG, protobuf wire format) are permitted but must:

- Use a non-`.golden` suffix (`.png`, `.pb.bin`) for editor support.
- Avoid line-based diff; use `hex.Dump` for failure messages.

## Versioned goldens

For backward-compat snapshots store goldens under `testdata/v<N>/`:

```
testdata/v1/TestRenderConfig.golden
testdata/v2/TestRenderConfig.golden
```

The test iterates versions and asserts the SUT can read each one. This is structurally identical to single-version golden testing but produces a regression corpus across releases.

## Anti-requirements

The framework explicitly does NOT provide:

- Automatic semantic diffing (JSON-aware, HTML-aware) — out of scope; use a normalizer or a structural assertion instead.
- Implicit creation on first run without `-update` — this would let bugs become baselines silently.
- Cross-package shared golden files — each package owns its `testdata/`.

## Conformance checklist

A package conforms to this specification when:

- [ ] A single `update` flag is declared at package scope.
- [ ] Every golden test calls the same comparison helper.
- [ ] `testdata/` contains only `.golden` files and named fixtures.
- [ ] No test invokes `time.Now`, `os.Getenv` for non-deterministic inputs without normalization.
- [ ] CI fails on any unreviewed `.golden` diff.
- [ ] The README documents the update workflow.

## Reference helper signatures

A conforming helper has the following signatures:

```go
// Compare or update a single golden against bytes.
func assertGolden(t *testing.T, got []byte)

// As above but writes to a path with an explicit suffix.
func assertGoldenAt(t *testing.T, suffix string, got []byte)

// Marshals value to indented JSON, then delegates.
func assertGoldenJSON(t *testing.T, v any)
```

Implementations MAY add helpers for specific encodings (XML, YAML, hexdump), provided they delegate to `assertGoldenAt` or equivalent.

## Reference flag declaration

```go
package mypackage

import "flag"

var update = flag.Bool("update", false, "rewrite testdata/*.golden")
```

The flag MUST:

- Have default value `false`.
- Be declared at package scope, not inside a function.
- Be named `update` (or with a documented alternative).
- Have a description string starting with "rewrite" or "update".

## Reference comparison flow

Pseudocode:

```
function assert(name, got):
    path := join("testdata", name + ".golden")
    got := normalize(got)
    if update_flag:
        ensure_dir(dir(path))
        write_file(path, got, 0o644)
        return
    want := read_file(path)
    if want is error:
        fail("missing golden; run -update")
    if got != want:
        fail("mismatch", diff(want, got))
```

A conforming implementation produces equivalent behavior.

## Out-of-scope clarifications

The following are explicitly out of scope:

- **Test runners.** This spec assumes the standard `go test` toolchain.
- **Coverage integration.** Goldens contribute to coverage like any other test.
- **Parallel test execution.** Permitted; the spec is parallel-safe by design when paths are unique.
- **Cross-package coordination.** Each package owns its own goldens.

## Versioning of this specification

This is version 1. Changes to required behavior will bump the major version. Changes to recommended (non-required) behavior will bump the minor version.

[← Back](../)
