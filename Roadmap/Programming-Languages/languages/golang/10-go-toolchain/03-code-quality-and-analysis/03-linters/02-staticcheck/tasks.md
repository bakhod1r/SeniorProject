# staticcheck — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+ and staticcheck 2024.x.

---

## Task 1: Install and first run

Install staticcheck and run it against a tiny module that contains an obvious bug.

```go
// main.go
package main

import "fmt"

func main() {
    name := "Ada"
    fmt.Printf("%d\n", name)
}
```

**Acceptance criteria**
- [ ] `go install honnef.co/go/tools/cmd/staticcheck@latest` succeeds.
- [ ] `staticcheck -version` prints a version starting with `2024.`.
- [ ] `staticcheck ./...` reports an `SA1006` finding on the `Printf` line.

---

## Task 2: Fix the SA1006 bug

Use the finding from Task 1 and fix it correctly so staticcheck is silent.

**Acceptance criteria**
- [ ] The program prints `Ada` (use `%s` or `%v`).
- [ ] `staticcheck ./...` exits 0 with no output.
- [ ] You can explain in one sentence why `%d` was wrong for a `string` argument.

---

## Task 3: Suppress a check inline

Add a deliberate use of a deprecated standard-library function (e.g., `ioutil.ReadFile`) and silence the `SA1019` finding with a `//lint:ignore` directive that includes a reason.

**Acceptance criteria**
- [ ] Without the directive, `staticcheck ./...` reports `SA1019`.
- [ ] With `//lint:ignore SA1019 migrating in a follow-up PR` on the line above, `staticcheck ./...` is silent.
- [ ] You can explain why bare `//lint:ignore SA1019` (without a reason) is a code smell.

---

## Task 4: Write a `staticcheck.conf` that enables only SA checks

Create `staticcheck.conf` at the module root.

```toml
checks = ["SA*"]
```

Add code that would trigger an `ST1005` finding (capitalized error string).

**Acceptance criteria**
- [ ] With the config, `staticcheck ./...` does **not** report `ST1005`.
- [ ] Removing the config makes the same `ST1005` appear.
- [ ] You can confirm via `staticcheck -checks=inherit ./...` that the config's `checks` is being applied.

---

## Task 5: Use `-explain` on a check ID

Look up the rationale for at least two checks without leaving the terminal.

**Acceptance criteria**
- [ ] `staticcheck -explain SA1029` prints a paragraph about `context.WithValue` key types.
- [ ] `staticcheck -explain SA4006` prints text about an ineffective assignment.
- [ ] You write a one-line note on what each check exists to prevent.

---

## Task 6: Pin and run in CI

Add staticcheck to a GitHub Actions workflow with a **pinned** version and `-set_exit_status` so findings fail the job.

```yaml
- name: Install staticcheck
  run: go install honnef.co/go/tools/cmd/staticcheck@v0.5.1
- name: Run staticcheck
  run: staticcheck -set_exit_status ./...
```

**Acceptance criteria**
- [ ] The workflow installs staticcheck at a specific pinned version (not `@latest`).
- [ ] A PR that introduces an `SA1006` bug makes the workflow fail.
- [ ] Removing the bug makes the workflow pass.
- [ ] You can explain why `@latest` would make CI non-reproducible.

---

## Task 7: Emit SARIF for GitHub code scanning

Produce a SARIF report and upload it so findings appear in the GitHub "Code scanning alerts" UI.

```yaml
- name: staticcheck (SARIF)
  run: staticcheck -f sarif ./... > staticcheck.sarif || true
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: staticcheck.sarif
```

**Acceptance criteria**
- [ ] `staticcheck -f sarif ./...` produces a valid SARIF JSON file (passes `jq . staticcheck.sarif`).
- [ ] Findings show up in the GitHub Security tab → Code scanning alerts.
- [ ] You understand why the workflow uses `|| true` (SARIF capture should not be blocked by `-set_exit_status` semantics; gate on the upload, not the exit code).

---

## Task 8: Use `-go` to match your module's Go version

Set the `-go` flag to your module's Go version so deprecation/version-sensitive checks behave consistently between local and CI.

**Acceptance criteria**
- [ ] `staticcheck -go 1.22 ./...` runs without error.
- [ ] You can show that running with `-go 1.18` against the same code produces a different finding set for at least one `SA1019` case (an API deprecated in a newer Go version).
- [ ] You add `-go $(go list -f '{{.Module.GoVersion}}' .)` to your Makefile target.

---

## Task 9: Adopt on a legacy package

Pick an existing package in any open-source Go repo. Run staticcheck with `-checks=SA*` only, count findings, then incrementally enable `U1000`, then `S*`. Track the count at each stage.

**Acceptance criteria**
- [ ] You record the finding counts for each stage in a short note (SA-only, +U1000, +S*, +ST*).
- [ ] You fix or `//lint:ignore` at least three findings with justifying reasons.
- [ ] You can articulate why rolling out by family is less disruptive than enabling everything at once.
