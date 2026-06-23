# govulncheck — Professional

## 1. Architecture: how it actually works

`govulncheck` is a thin orchestration layer over three building blocks:

1. **Vulnerability database client** — fetches OSV-format records from `vuln.go.dev` (or `$GOVULNDB`), keyed by module path; records include affected versions and the exact **symbols** introduced/fixed.
2. **Program analyzer** — depending on mode:
   - **Source mode** uses `golang.org/x/tools/go/packages` to load the module, then `golang.org/x/tools/go/ssa` to build a single-static-assignment representation, then a call graph (VTA or RTA, depending on version).
   - **Binary mode** reads the binary's build info (`runtime/debug.BuildInfo`) and symbol table to recover the function-presence set.
3. **Matcher** — intersects the set of symbols reached/present with the set of symbols listed in OSV records for the modules in the build list. Each non-empty intersection becomes a finding.

The key insight is that the OSV records for the Go DB carry **per-symbol** affected ranges (`ecosystem_specific.imports[].symbols`), not just module-level "<= v1.2.3 is bad." Without that, reachability would be impossible at function granularity.

Source tree to read:
- `golang.org/x/vuln/cmd/govulncheck` — CLI entry point.
- `golang.org/x/vuln/internal/vulncheck` — the matching engine.
- `golang.org/x/vuln/internal/client` — DB fetching and caching.

---

## 2. Source mode in detail

Source mode roughly:

```text
go/packages.Load(./...)
  → *packages.Package graph
ssa.NewProgram + ssa.Package.Build
  → SSA functions for every package in scope
callgraph.VTA (variable type analysis)
  → call graph: caller → callee edges
intersect callee set with OSV symbol set
  → findings (with traces from main → vulnerable symbol)
```

A few important consequences:

- **Build tags and `_test.go`** affect what packages load. `-tags` and `-test` change the call graph and therefore the findings.
- **Reflection and interfaces** are over-approximated by VTA — if your code calls a function through an interface, VTA assumes it might dispatch to any implementing method. That can produce findings the runtime would never hit; treat them as reachable until proven otherwise.
- **`unsafe` and `cgo`** are opaque to the analyzer. Vulnerabilities behind unsafe/cgo boundaries may be invisible.
- **Generics** are handled at instantiation time; type parameters are resolved per call site.

---

## 3. Binary mode in detail

Binary mode reconstructs what it can from the artifact:

```text
debug.ReadBuildInfo(binary)
  → Go toolchain version, main module, dependency list (with versions, hashes)
read .gosymtab / .gopclntab (when present)
  → set of function symbols present in the binary
intersect symbol set with OSV symbol set
  → findings
```

Caveats:
- **Symbol stripping** (`-ldflags="-s -w"`) removes the symbol table; precision drops to module-level (was the module included? then any vuln in that module is reported).
- **Dead-code elimination** by the linker actually helps precision: if the linker removed an unused function, it's not in the symbol table, so it won't match.
- **Go ≥1.18** introduced the embedded build info that binary mode depends on. Older binaries cannot be scanned meaningfully.
- **`-trimpath`** does not remove build info; it only rewrites source paths. Binary scanning still works.
- **cgo binaries** carry only the Go symbol table; native sections aren't matched (and aren't in the Go DB anyway).

The practical recipe for scannable artifacts:

```bash
go build -trimpath -o ./dist/server ./cmd/server
# Do NOT use -ldflags="-s -w" unless you accept module-only precision.
govulncheck -mode=binary ./dist/server
```

---

## 4. The vuln DB format

A Go-DB OSV record (abbreviated) looks like:

```json
{
  "schema_version": "1.3.1",
  "id": "GO-2024-2598",
  "modified": "2024-03-15T00:00:00Z",
  "affected": [
    {
      "package": {"ecosystem": "Go", "name": "stdlib"},
      "ranges": [{"type": "SEMVER", "events": [{"introduced": "0"}, {"fixed": "1.21.8"}]}],
      "ecosystem_specific": {
        "imports": [
          {"path": "net/http", "symbols": ["Server.Serve", "serverHandler.ServeHTTP"]}
        ]
      }
    }
  ],
  "database_specific": {"url": "https://pkg.go.dev/vuln/GO-2024-2598"}
}
```

The `ecosystem_specific.imports[].symbols` array is what powers function-level reachability. When you write tooling on top of `govulncheck` JSON, this is the field you correlate against.

---

## 5. Performance on monorepos

Source-mode call-graph construction is the dominant cost on large repos. Rough scaling on a 2024-vintage workstation:

| Module size | Packages loaded | Time (source mode) |
|-------------|-----------------|--------------------|
| ~50 pkgs | 50 | 5–15s |
| ~500 pkgs | 500 | 30–90s |
| ~5000 pkgs | 5000 | 5–15 min |

Levers to reduce wall time:
- Scan **per-binary entry point** (`./cmd/server/...`) rather than `./...` if you have many binaries — most code is shared but each binary's reachable set is smaller.
- Use **binary mode** in CI hot paths; reserve source mode for the per-PR change set and a nightly full source scan.
- Cache `GOMODCACHE` and `GOCACHE` between CI runs — `go/packages` reuses them.
- The vuln DB itself is fetched on each run; pre-cache a snapshot file via `GOVULNDB` to skip the network on every invocation in CI farms.

Memory: VTA call-graph construction allocates aggressively. Budget 1–4 GB for medium repos and verify in your CI runner sizing.

---

## 6. Embedding govulncheck programmatically

For platform teams building custom workflows, the matcher is importable:

```go
import (
    "golang.org/x/vuln/scan"
)

func main() {
    cmd := scan.Command(ctx, "-format=json", "./...")
    cmd.Stdout = os.Stdout
    if err := cmd.Start(); err != nil { /* ... */ }
    _ = cmd.Wait()
}
```

For deeper integration (custom matchers, alternative analysis), the `internal/vulncheck` API is not stable — wrap the CLI via `scan.Command` and parse JSON. This is the boundary the Go team supports.

---

## 7. Operating the vuln DB

If you run `vuln.go.dev` for an enterprise (mirror or fork):
- The DB is a Git repository of JSON OSV files, served via a static HTTP layout (an `index.json` per module plus per-ID files).
- Public source: https://github.com/golang/vulndb.
- Refresh cadence is hourly upstream. Mirror with `git pull` + a static file server; clients (govulncheck) cache responses locally.
- Adding internal advisories means appending OSV files in the same layout under a separate module namespace (e.g., `internal.example.com/...`) and pointing `GOVULNDB` at the combined view.

---

## 8. Summary

`govulncheck` is `golang.org/x/tools/go/ssa` + a VTA call graph + an OSV matcher against `vuln.go.dev`. Source mode is precise but expensive; binary mode is cheap but depends on embedded build info from Go ≥1.18 and degrades with symbol stripping. For monorepos, scope scans per binary entry point, cache the module/build/vuln data, and reserve full-tree source scans for nightly runs. For platform integration, use `golang.org/x/vuln/scan` and parse JSON — `internal/` is not a stable API.

---

## Further reading
- Tool source: https://github.com/golang/vuln
- Public Go vuln DB repo: https://github.com/golang/vulndb
- `go/ssa` package: https://pkg.go.dev/golang.org/x/tools/go/ssa
- `runtime/debug.ReadBuildInfo`: https://pkg.go.dev/runtime/debug#ReadBuildInfo
- OSV schema: https://ossf.github.io/osv-schema/
