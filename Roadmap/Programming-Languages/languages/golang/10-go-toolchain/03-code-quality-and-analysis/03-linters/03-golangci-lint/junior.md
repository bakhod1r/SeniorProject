# golangci-lint — Junior

## 1. What is golangci-lint?

`golangci-lint` is a **meta-linter**: a single binary that runs many Go linters in one pass, under one config file, with shared analysis and caching. Instead of installing and running `govet`, `staticcheck`, `errcheck`, and a dozen others separately, you run **one** command and they all check your code together.

```bash
golangci-lint run ./...
```

That command compiles your packages once, type-checks them once, and feeds the result to every enabled linter.

---

## 2. Why teams use it

| Without golangci-lint | With golangci-lint |
|-----------------------|--------------------|
| Install 10 lint tools, each with its own flags | One binary, one config |
| Each linter re-parses and re-type-checks your code | One shared pass, much faster |
| CI script grows a long pipe of commands | `golangci-lint run` |
| No unified exclude/severity story | `.golangci.yml` centralizes all of it |

In short: **one config, fast, parallel, consistent across machines**.

---

## 3. Installation — use the binary, not `go install`

The official guidance is to **download the released binary**, not `go install`. `go install` builds from source against your local Go toolchain and can produce a binary whose behavior drifts from official releases.

```bash
# macOS / Linux — pin a version
curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh \
  | sh -s -- -b $(go env GOPATH)/bin v1.59.1

# Or via Homebrew
brew install golangci-lint
```

Verify:

```bash
golangci-lint --version
```

You should see something like `golangci-lint has version 1.59.1 built with go1.22.x ...`.

---

## 4. Basic usage

```bash
# Lint the current module
golangci-lint run

# Lint everything recursively
golangci-lint run ./...

# Lint a specific package
golangci-lint run ./internal/api/...

# List all enabled linters
golangci-lint linters
```

If there are issues, they print one per line with file:line:col and a short message:

```
internal/api/handler.go:42:6: ineffectual assignment to err (ineffassign)
internal/api/handler.go:55:13: Error return value of `w.Write` is not checked (errcheck)
```

Exit code is `0` if no issues, non-zero if any linter reported a problem.

---

## 5. The default linter set

Out of the box (no config file), golangci-lint enables a small, conservative set:

| Linter | What it catches |
|--------|----------------|
| `govet` | Standard `go vet` checks — printf format, shadowed vars, lock copies |
| `staticcheck` | Hundreds of bug and style checks (replaces older `gosimple` codes) |
| `errcheck` | Function calls whose error return is ignored |
| `ineffassign` | Assignments to variables that are never read afterwards |
| `unused` | Dead code: unused funcs, types, fields, constants |
| `gosimple` | Code that could be written more simply (`a == true` → `a`) |

This default set is intentionally small and quiet: it should not produce false positives on idiomatic Go.

---

## 6. Output formats

```bash
# Default: colored line output (good for terminals)
golangci-lint run

# Plain text for logs
golangci-lint run --out-format=line-number

# JSON for tooling
golangci-lint run --out-format=json

# GitHub Actions annotations (inline review comments)
golangci-lint run --out-format=github-actions

# Checkstyle for Jenkins-style consumers
golangci-lint run --out-format=checkstyle
```

You can request multiple formats at once:

```bash
golangci-lint run --out-format=colored-line-number,json:report.json
```

That prints to the terminal and **also** writes JSON to `report.json`.

---

## 7. A first run on your project

```bash
$ cd ~/code/myapp
$ golangci-lint run ./...
internal/store/pg.go:18:6: error returned from `rows.Close` is not checked (errcheck)
cmd/server/main.go:33:2: assignment to err is never used (ineffassign)
```

Don't panic if you get many findings on day one. The next step is to either fix them, exclude a specific file, or adopt the **"only new issues"** workflow with `--new-from-rev` — covered in `middle.md`.

---

## 8. A common beginner mistake

Running `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest` and then being surprised that findings differ from CI. The project deliberately warns against this — the binary built that way is not the same artifact distributed via release. Use the install script or `brew` and **pin a version**.

---

## 9. Summary

`golangci-lint` is one binary that runs many Go linters in one parallel, cached pass driven by `.golangci.yml`. Install from the released binary (not `go install`), run `golangci-lint run ./...`, and start with the default set: `govet`, `staticcheck`, `errcheck`, `ineffassign`, `unused`, `gosimple`. Output formats range from human-readable to JSON and CI-native (GitHub Actions, checkstyle). The next file shows how to configure it.

---

## Further reading
- Project site: https://golangci-lint.run
- `golangci-lint --help`
- Install guide: https://golangci-lint.run/welcome/install/
- Why not `go install`: https://golangci-lint.run/welcome/install/#install-from-source
