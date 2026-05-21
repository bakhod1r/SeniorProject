---
layout: default
title: Table-Driven Tests — Professional
parent: Table-Driven Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/02-table-driven-tests/professional/
---

# Table-Driven Tests — Professional

[← Back](../)

This level is about running table-driven tests **at scale** in real production codebases: hundreds of rows per table, tables across dozens of packages, tables loaded from data files, tables shared between unit and integration suites, tables that have to survive five years of contributor churn. The mechanics from the junior, middle, and senior files still apply — the new concerns are governance, data formats, infrastructure, and discoverability.

---

## Table of contents

1. [Scaling tables past 200 rows](#scaling-tables-past-200-rows)
2. [External data formats — CSV, YAML, JSON, JSONL](#external-data-formats--csv-yaml-json-jsonl)
3. [Schema validation for data-driven tables](#schema-validation-for-data-driven-tables)
4. [Test discovery and runners in CI](#test-discovery-and-runners-in-ci)
5. [Test-data review process](#test-data-review-process)
6. [Cross-package shared tables](#cross-package-shared-tables)
7. [Tables in microservice contract testing](#tables-in-microservice-contract-testing)
8. [Tracing and metrics for slow tests](#tracing-and-metrics-for-slow-tests)
9. [Conventions for very large repos](#conventions-for-very-large-repos)
10. [Migration playbook — from xN copy-pasted tests to one table](#migration-playbook)
11. [War stories](#war-stories)

---

## Scaling tables past 200 rows

At ~50 rows, a table-driven test is still scannable on one screen. At 200, it's a separate file. At 500+, you have a sub-project. Three rules that stop the pain:

1. **Group by behavior, not by input shape.** If your `TestValidate` has 500 rows, ask: are these 500 truly independent edge cases of the same behavior, or are 200 of them really `TestValidateEmail`, 200 are `TestValidatePhone`, and 100 are `TestValidatePostalCode`? Split the function.

2. **Keep names sortable.** Subtests printed by `go test -v` come out in declaration order. If you prefix names with categories (`email/valid_simple`, `email/valid_with_plus`, `phone/valid_us`, `phone/invalid_short`), `go test -v 2>&1 | grep -E '^=== RUN'` becomes navigable.

3. **Move data out of code when the count exceeds the number of times you read the file.** A 500-row literal slice in Go source is hostile to diffs and reviews. Move it to JSON/YAML/CSV.

---

## External data formats — CSV, YAML, JSON, JSONL

### When each format fits

| Format | Good for | Bad for |
|---|---|---|
| **CSV** | Numeric tables, fixed columns, easy to bulk-edit in spreadsheets. | Strings with commas, nested structures, multi-line values. |
| **JSON** | Structured rows, type-safe via `json.Unmarshal`. | Verbose; trailing commas not allowed; comments not allowed. |
| **JSONL (one row per line)** | Streaming, easy to grep, easy to append. | Same caveats as JSON per row. |
| **YAML** | Human-edited tables with comments and multi-line strings. | Whitespace sensitive; type ambiguity (`yes`, `on` → bool). |
| **TOML** | Config-shaped data with nested tables. | Less common in Go; fewer maintainers. |

### Pattern: JSON-backed table

```go
package validation_test

import (
    _ "embed"
    "encoding/json"
    "testing"
)

//go:embed testdata/email_cases.json
var emailCasesJSON []byte

type emailCase struct {
    Name    string `json:"name"`
    Input   string `json:"input"`
    Valid   bool   `json:"valid"`
    Reason  string `json:"reason,omitempty"`
}

func loadEmailCases(t *testing.T) []emailCase {
    t.Helper()
    var c []emailCase
    if err := json.Unmarshal(emailCasesJSON, &c); err != nil {
        t.Fatalf("decode email_cases.json: %v", err)
    }
    return c
}

func TestValidateEmail(t *testing.T) {
    for _, tc := range loadEmailCases(t) {
        t.Run(tc.Name, func(t *testing.T) {
            got, err := ValidateEmail(tc.Input)
            if got != tc.Valid {
                t.Errorf("Valid = %v, want %v (reason: %s, err: %v)", got, tc.Valid, tc.Reason, err)
            }
        })
    }
}
```

This is the most common pattern in big Go codebases. `embed` (Go 1.16+) keeps the JSON inside the binary so tests still run when invoked from any directory.

### Pattern: CSV-backed table

For numeric or short-string tables, CSV beats JSON for editing:

```go
//go:embed testdata/arithmetic.csv
var arithCSV []byte

func TestArithmetic(t *testing.T) {
    r := csv.NewReader(bytes.NewReader(arithCSV))
    rows, err := r.ReadAll()
    if err != nil { t.Fatalf("csv parse: %v", err) }

    // header row: name,a,b,want
    if len(rows) == 0 || rows[0][0] != "name" {
        t.Fatal("missing header")
    }
    for _, row := range rows[1:] {
        name, aS, bS, wantS := row[0], row[1], row[2], row[3]
        a, _ := strconv.Atoi(aS)
        b, _ := strconv.Atoi(bS)
        want, _ := strconv.Atoi(wantS)
        t.Run(name, func(t *testing.T) {
            if got := Add(a, b); got != want {
                t.Errorf("Add(%d,%d) = %d, want %d", a, b, got, want)
            }
        })
    }
}
```

### Pattern: YAML for human-curated cases

YAML is forgiving for comments, multi-line strings, and human edits. Pay the dependency cost (`gopkg.in/yaml.v3`).

```yaml
# testdata/parser_cases.yaml
- name: empty input
  input: ""
  want_err: true
  reason: parser requires at least one token

- name: comment only
  input: "# just a comment"
  want_err: false
  want_ast:
    kind: Empty
```

---

## Schema validation for data-driven tables

When tests are driven by external files, the files become a contract. New contributors break that contract: misnamed fields, missing rows, bad types. Protect with:

1. **Strict unmarshal**: `json.Decoder.DisallowUnknownFields()` — fail when the JSON has a field your struct doesn't.
2. **A separate "validation" test** that runs first and asserts schema integrity. If the schema fails, all driven tests will be useless anyway.
3. **A linter** (custom or `jsonschema`-based) that runs in CI.

```go
func TestValidateTestData(t *testing.T) {
    dec := json.NewDecoder(bytes.NewReader(emailCasesJSON))
    dec.DisallowUnknownFields()
    var c []emailCase
    if err := dec.Decode(&c); err != nil {
        t.Fatalf("test data schema violation: %v", err)
    }
    if len(c) < 10 {
        t.Fatalf("expected at least 10 cases, got %d", len(c))
    }
    seen := map[string]bool{}
    for _, row := range c {
        if seen[row.Name] {
            t.Errorf("duplicate case name: %q", row.Name)
        }
        seen[row.Name] = true
    }
}
```

---

## Test discovery and runners in CI

`go test ./...` discovers all packages; subtests under a package run automatically. For specific selection in CI:

```
go test -run '^TestValidateEmail$/^valid_' ./pkg/validation/...
```

For sharding across CI workers:

```
# worker 0
go test -run 'TestX/(case01|case02|...)' ./...
# worker 1
go test -run 'TestX/(case03|case04|...)' ./...
```

Tools like `gotestsum` produce JUnit XML for CI dashboards. Run with:

```
gotestsum --format testname --junitfile report.xml -- -count=1 ./...
```

Subtest names map cleanly to JUnit `<testcase>` elements, which makes "flaky test detection" tooling work without modification.

---

## Test-data review process

A 200-row JSON file is, effectively, a small database. Treat it like one:

1. **Owners** — every test-data file has a CODEOWNERS entry. A change touching it requires a domain expert's review.
2. **Lineage comments** — for cases with non-obvious origins (e.g., a real production input that triggered a bug), include the bug ID or PR link in a comment or `notes` field.
3. **No silent deletions** — removing rows in a refactor requires a justification. Renames are OK; deletions delete coverage.
4. **Diff-friendly format** — keep one row per line where possible. CSV and JSONL win here; pretty-printed JSON arrays also work if each object is on its own line.

---

## Cross-package shared tables

Sometimes two packages should be tested against the same cases — e.g., a `parser` package and a `formatter` package should roundtrip identical canonical inputs.

```
internal/
  testcases/
    canonical.go         // exposes []Canonical
    canonical_test.go    // sanity-checks the table itself
  parser/
    parser_test.go       // imports canonical
  formatter/
    formatter_test.go    // imports canonical
```

`internal/testcases` exposes:

```go
package testcases

type Canonical struct {
    Name     string
    Pretty   string
    Compact  string
    AST      any
}

func Cases() []Canonical { return cases }
```

Both `parser_test.go` and `formatter_test.go` consume `testcases.Cases()` so they cannot drift out of sync.

---

## Tables in microservice contract testing

Consumer-driven contract tests (Pact-style, but in plain Go) often use tables of `(request, expected response)`. The table becomes the contract. Two patterns:

1. **In-process contract**: the consumer's test starts an in-process mock of the producer and replays the table.
2. **Cross-language contract**: the table is stored as JSON or HTTP-Cassette files (`go-vcr`). Both consumer and producer use the same recorded interactions.

```go
type contractCase struct {
    Name     string         `json:"name"`
    Request  HTTPRequest    `json:"request"`
    Response HTTPResponse   `json:"response"`
}

//go:embed testdata/contracts/orders_v1.json
var ordersContract []byte

func TestOrdersConsumer(t *testing.T) {
    var cases []contractCase
    if err := json.Unmarshal(ordersContract, &cases); err != nil { t.Fatal(err) }

    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // match the incoming request against a row, return its response
    }))
    defer srv.Close()

    for _, tc := range cases {
        t.Run(tc.Name, func(t *testing.T) {
            // run consumer code against srv.URL
        })
    }
}
```

---

## Tracing and metrics for slow tests

In CI, you want to know which subtests are dragging the suite. Three tools:

- **`go test -json`** emits a JSON event stream that includes timing per subtest. Pipe through `jq` to find rows taking >1s.
- **`gotestsum --debug --hide-summary none`** prints a per-test wall-time summary at the end.
- **Custom**: install a `TestMain` that wraps `m.Run()`, capturing per-subtest timing via a custom `T` wrapper. Most teams don't go this far — the first two are enough.

```bash
go test -json ./... | jq -r 'select(.Action == "pass" or .Action == "fail") | "\(.Elapsed)\t\(.Test)"' | sort -n | tail -20
```

The top 20 lines are your slowest subtests.

---

## Conventions for very large repos

In a million-line Go monorepo, table-driven tests have to follow conventions or the codebase becomes a desert of inconsistent styles. Patterns we've seen work:

1. **One table per `Test...` function.** No two tables in the same function. If a function has multiple concerns, split it.
2. **Test data under `testdata/` only.** Never embed huge JSON literals in `.go` files.
3. **Generated tables go in `*_generated_test.go`** with a `//go:generate` directive. Reviewers know not to hand-edit.
4. **No package-level state mutated by subtests.** Each subtest is self-contained.
5. **Public assertion helpers in `internal/testutil`.** No re-rolling `assertEqual` in every package.

---

## Migration playbook

You inherit a package with 30 copy-pasted test functions. How do you migrate to one table?

1. **Run `go test ./pkg -v`** and capture the current pass/fail set as a baseline.
2. **Identify a uniform shape.** Look at the inputs and assertions of each test. If 25 of 30 share a shape, those are candidates.
3. **Create a table with 25 rows**, one per migrated test. Keep names matching the original `Test*` function names so `git log -S <name>` still finds them.
4. **Comment out the original 25 functions** (don't delete yet).
5. **Run again.** Compare to the baseline. Identical pass/fail set? Good.
6. **Delete the originals.** Commit the rename and the deletion in one commit so blame is clean.
7. **Handle the leftover 5** — those are the "doesn't fit the table" cases. Leave them as separate functions or refactor them differently.

---

## War stories

### Story 1 — The 4,000-row table that ran in 6 hours

A FinTech team had a tax-calculation table-driven test with 4,000 rows generated from regulatory filings. Each row took ~5 seconds because it spun up an in-memory tax engine for every row. With `-parallel 1` (forced because of a global lock in the engine), the suite took six hours.

**Fix**: refactor the engine to remove the global lock, then `-parallel 64`. Total time: 8 minutes. The lock was a 2017 quick fix that nobody had revisited.

Moral: per-row setup cost compounds at scale. Profile before paying for more CI minutes.

### Story 2 — The flaky-row mystery

A team had one row in a 300-row table that failed 1 in 50 runs. Hunt took two weeks.

Root cause: the row referenced an HTTP date string. The test stored `2026-05-20T00:00:00Z`. When the test ran on a machine in `Australia/Sydney` near midnight Sydney time, the date parsed correctly. When it ran in `America/Los_Angeles` near midnight LA, the assertion's date subtraction wrapped. The row's `want` value was wrong, but only visible across timezones.

**Fix**: pin `time.Now` via a test clock, and run CI in UTC.

Moral: table rows that contain dates, env-dependent data, or floating point are time bombs. Snapshot deterministically.

### Story 3 — The case-name collision

A 250-row table had two rows with `tc.name == "empty"`. Go silently suffixed the second one with `#01`. A six-month bug came from a regression in the "second empty" row — the failure report said `TestX/empty#01` and nobody knew what that meant.

**Fix**: a unit test on the test data: assert all names are unique. Add it once, sleep better forever.

Moral: enforce uniqueness with code, not with vigilance.

### Story 4 — The `embed` that broke `go vet`

A team had test data in `testdata/` loaded via `os.ReadFile` at test time. CI worked. When they refactored to `//go:embed`, suddenly `go vet ./...` started failing on the test files because `vet` runs in build mode that doesn't include `_test.go` files but **does** check the package for unused imports.

The fix: embed lives in a `_test.go` file with `//go:embed`. The build tag is implicit (`_test.go` is test-only).

Moral: small build-system details matter at scale. `embed` is great until it surprises you.

### Story 5 — The 200-row YAML that diverged from code

A validation team kept their cases in `testdata/validation.yaml`. Over two years, they added a `severity` field to the YAML for "informational" cases but never added it to the Go struct. The unmarshal silently ignored unknown fields. For six months, all `severity: warn` rows were treated as errors.

The fix: turn on `DisallowUnknownFields`. Pin schema drift at the unmarshal layer.

```go
dec := json.NewDecoder(bytes.NewReader(raw))
dec.DisallowUnknownFields()
```

For YAML, use `yaml.UnmarshalStrict` (`gopkg.in/yaml.v3` provides strict mode).

Moral: external-data tables drift from code. Enforce schema agreement at decode time.

---

## Patterns we don't recommend

- **Single global table shared across all tests in a package.** Looks DRY, but every test ends up with rows it doesn't care about. Per-test tables are clearer.
- **Tables imported from third-party packages.** Brittle: external rename or removal breaks your tests. Vendor or copy.
- **Tables generated by AI tools without review.** Looks like coverage but often misses adversarial cases and includes off-by-one mistakes that look plausible. Always review row-by-row.
- **Tables of tables.** A row whose `subCases` field is itself a slice of rows. Refactor: hoist into nested `t.Run` calls and a flat structure.

---

## A checklist for landing a 200-row table in production

Before merging a PR that adds a 200-row table:

1. [ ] Each row has a unique, descriptive name.
2. [ ] A separate test asserts name uniqueness.
3. [ ] Cases are grouped logically (validation, parsing, etc.).
4. [ ] If data-file-backed: schema is validated on decode with `DisallowUnknownFields`.
5. [ ] If parallel: rows do not mutate shared state.
6. [ ] If using `time.Now`: a fake clock is injected.
7. [ ] If using random data: a fixed seed is set.
8. [ ] CI time impact is measured: `time go test -count=1 ./pkg/...` before and after.
9. [ ] Owners (CODEOWNERS) are set on data files.
10. [ ] At least one "negative" row (wantErr) for every behavior under test.

This list is the cheapest insurance against the war stories above.

---

## CI Configurations We've Seen Work

Three concrete CI setups for table-driven Go tests at scale:

### Configuration A — Small team, single repo

```yaml
# .github/workflows/test.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
      - run: go test -race -count=1 ./...
```

Simple. Fast enough for ~30K lines of Go. Race detector on every run catches concurrency regressions.

### Configuration B — Medium team, sharded suite

```yaml
jobs:
  test:
    strategy:
      matrix:
        shard: [0, 1, 2, 3]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
      - run: |
          packages=$(go list ./... | awk "NR % 4 == ${{ matrix.shard }}")
          go test -race -count=1 $packages
```

Four parallel workers, each running a quarter of packages. Wall time roughly 1/4. Good for ~200K lines.

### Configuration C — Large team, tiered execution

```yaml
jobs:
  fast:
    # runs on every push, ~3 minutes
    runs-on: ubuntu-latest
    steps:
      - run: go test -short -count=1 ./...

  full:
    # runs on PR + nightly, ~30 minutes
    needs: fast
    runs-on: ubuntu-latest-large
    strategy:
      matrix:
        shard: [0, 1, 2, 3, 4, 5, 6, 7]
    steps:
      - run: |
          packages=$(go list ./... | awk "NR % 8 == ${{ matrix.shard }}")
          go test -race -count=1 -timeout=15m $packages

  integration:
    # runs nightly + on manual trigger
    needs: full
    runs-on: ubuntu-latest-large
    steps:
      - run: go test -tags=integration -count=1 -timeout=1h ./...
```

Three tiers. Each commit gets fast feedback. PRs get the full suite. Nightly runs include integration.

---

## Tooling We Recommend

- **`gotestsum`** — wraps `go test`, produces clean output and JUnit XML for CI integration. https://github.com/gotestyourself/gotestsum
- **`go-cmp`** — Google's comparison library, far superior to `reflect.DeepEqual` for failure output. https://github.com/google/go-cmp
- **`testify`** — popular assertion library. Useful but adds a dependency; many teams prefer to stay close to stdlib.
- **`golangci-lint`** — runs many linters including `paralleltest`, `tparallel`, `copyloopvar`, all relevant to table-driven tests. https://golangci-lint.run
- **`go-mutesting`** — mutation testing tool that surfaces gaps in your table coverage.

Pick `gotestsum` + `go-cmp` + `golangci-lint` as a baseline. Add others when you have a specific need.

---

## Closing Thought

Table-driven tests are the most important pattern in Go testing because they make the cost of adding a case nearly zero. That low cost is what enables genuine coverage — not the percentage on a coverage report, but the actual set of behaviors you've thought to check.

The professional discipline is to treat each row as a contract: a documented expectation about what your code does. Adding a row is signing the contract. Removing a row, in a refactor or otherwise, is breaching it.

Build this discipline into your team, and your tests will become your code's most accurate documentation.

---

[← Back](../)
