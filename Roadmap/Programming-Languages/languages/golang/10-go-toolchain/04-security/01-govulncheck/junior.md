# govulncheck — Junior

## 1. What is govulncheck?

`govulncheck` is **Go's official vulnerability scanner**, built and maintained by the Go team. It reads your code (or a compiled binary) and reports only the vulnerabilities that your program **actually reaches** — not every CVE that happens to mention a package you import.

That last part is the headline. Most "SCA" (Software Composition Analysis) tools match dependency names and versions against a CVE database and flag anything that looks suspicious. `govulncheck` goes further: it builds a **call graph** from your program and asks "does any execution path of my code actually call the vulnerable function?" If the answer is no, it stays quiet.

The result: fewer false alarms, more actionable findings.

---

## 2. Install

You install `govulncheck` like any other Go command-line tool:

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
```

This places the `govulncheck` binary in `$(go env GOBIN)` (or `$(go env GOPATH)/bin`). Make sure that directory is on your `PATH`:

```bash
export PATH="$PATH:$(go env GOPATH)/bin"
govulncheck -version
```

Requirements:
- Go 1.18 or newer (Go 1.21+ recommended).
- Network access on first run, to download the Go vulnerability database from `vuln.go.dev`.

---

## 3. Basic usage

From the root of a Go module:

```bash
govulncheck ./...
```

That tells govulncheck to scan every package in your module. It will:
1. Compile/analyze your packages.
2. Build a call graph.
3. Fetch the latest entries from the Go vuln DB.
4. Report only the vulnerabilities your code can actually reach.

Typical clean output:

```
Scanning your code and 124 packages across 17 dependent modules for known vulnerabilities...

No vulnerabilities found.
```

Typical finding:

```
Vulnerability #1: GO-2024-2598
    HTTP request smuggling via malformed Transfer-Encoding header.
  More info: https://pkg.go.dev/vuln/GO-2024-2598
  Module: net/http
    Found in: net/http@go1.21.0
    Fixed in: net/http@go1.21.8
    Example traces found:
      #1: main.go:42:18: main.handle calls http.Server.Serve
```

The "trace" line is the key: it shows the actual line in your code that leads to the vulnerable function.

---

## 4. How is this different from generic SCA?

| Tool style | What it does | Typical noise |
|------------|--------------|---------------|
| Generic SCA (`grep` over `go.sum`) | Flags every CVE in any imported module | High — most CVEs are unreachable |
| `govulncheck` (call-graph aware) | Flags only vulns your code actually calls | Low — actionable findings |

A library you depend on may contain a vulnerable function in some file you never import. Generic scanners shout. `govulncheck` checks whether your call graph reaches that function and stays quiet if it doesn't.

This makes `govulncheck` findings worth **acting on**.

---

## 5. A simple worked example

Suppose your code uses an older `net/http` API with a known vulnerability. Create `main.go`:

```go
package main

import (
    "log"
    "net/http"
)

func main() {
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

If you build this with an older Go toolchain that has a known vulnerable `net/http`:

```bash
govulncheck ./...
```

You will see something like:

```
Vulnerability #1: GO-2024-XXXX
  Module: stdlib
    Found in: net/http@go1.20.0
    Fixed in: net/http@go1.20.6
    Example traces found:
      #1: main.go:9:14: main.main calls http.ListenAndServe
```

The fix is upgrading your Go toolchain. Re-run after upgrading:

```bash
go version          # confirm new toolchain
govulncheck ./...   # should now report no vulnerabilities
```

---

## 6. What gets scanned

By default `govulncheck` scans:
- Your module's Go source code.
- All transitive Go dependencies in `go.sum`.
- The Go **standard library** for your toolchain version.

It does **not** scan:
- Non-Go dependencies (C libraries, OS packages).
- Vulnerabilities that aren't in the Go vuln DB at `vuln.go.dev`.
- Vulnerabilities that exist in code your program can never reach.

---

## 7. Common first commands

```bash
govulncheck ./...                  # scan the whole current module
govulncheck ./cmd/...              # scan a subtree
govulncheck -version               # print govulncheck version
govulncheck -h                     # full help
```

---

## 8. A common beginner mistake

Running `govulncheck` outside a Go module:

```bash
$ cd /tmp && govulncheck ./...
no Go module found in current directory or any parent directory
```

`govulncheck` is module-aware. You need to be inside a directory that contains a `go.mod` (or pass a package path that resolves to one).

Another classic: assuming "No vulnerabilities found" means your code is safe. It means **none in the Go vuln DB** are reachable from your code. A vulnerability that hasn't been reported yet, or one in a non-Go dependency, will still be invisible. `govulncheck` raises your floor — it does not certify a ceiling.

---

## 9. Summary

`govulncheck` is Go's official, call-graph-aware vulnerability scanner. Install it with `go install golang.org/x/vuln/cmd/govulncheck@latest` and run `govulncheck ./...` from your module root. Unlike generic SCA tools, it only reports vulnerabilities your code actually reaches, which makes its findings worth fixing. "No vulnerabilities found" means none are reachable in the current Go vuln DB — keep scanning regularly, because the database grows over time.

---

## Further reading
- Official docs: https://go.dev/security/vuln/
- Tool source: https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck
- Go vulnerability database: https://vuln.go.dev/
