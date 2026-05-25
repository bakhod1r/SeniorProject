# The `plugin` Package — Professional

## 1. Who actually uses this in production

The honest answer is: a small list. The `plugin` package's constraints filter the candidates down to teams who can enforce lockstep builds and only deploy to Linux/macOS.

| Project | What it uses `plugin` for | Why they got away with it |
|---------|---------------------------|--------------------------|
| Caddy (early versions; modern Caddy uses static compilation) | Loadable middleware | Linux/macOS-only deployment, monorepo plugin builds |
| Some internal data pipelines (DataDog, internal Google tools, fintech ETL) | Loadable transforms | Single-team ownership, controlled build pipelines |
| Kubernetes CSI/CRI/CNI runtime plugins | A few exceptions for in-process drivers | Operator controls the platform image |
| Academic and prototype systems | Demonstrations of dynamic loading | Constraints don't matter at small scale |

The dominant pattern, even at the projects above, is "we used it, regretted the build complexity, and either stopped or built strict CI guardrails around it." Most teams considering plugins in 2024+ end up with `hashicorp/go-plugin` (RPC) or `wazero` (WASM) instead.

---

## 2. The Caddy story (and why modern Caddy moved on)

Caddy 1.x exposed an in-process plugin model based on the `plugin` package. Users would build a custom `caddy.so` ecosystem. The trade-offs they hit:

- **Build complexity.** Users had to compile their own Caddy with the right plugin set. The community had to host pre-built binaries for popular plugin combinations.
- **Version skew bugs.** Any mismatch between a plugin and the core caused crashes that looked like Caddy bugs to the user.
- **Platform exclusion.** Windows users couldn't load plugins.
- **No hot reload.** Reconfiguring a plugin required restarting Caddy.

Caddy 2.x replaced this entirely with **build-time module composition**: `xcaddy build` produces a single binary with the user's chosen modules statically linked. The `plugin` package was abandoned for the user-facing extension point.

The lesson: even for a project explicitly designed to be extensible, in-process Go plugins lost to static composition.

---

## 3. When teams successfully ship with `plugin`

The pattern that *does* work in production:

- **Single repository.** Host and plugins live in the same `go.mod`.
- **Single CI pipeline.** One build job produces the host and all `.so` files together. Artifacts are versioned as a unit.
- **Atomic deploys.** A "release" is `host + all-plugins-v1.2.3.tar.gz`. You never deploy a new plugin without also deploying the matching host.
- **Linux-only target.** No cross-platform expectation.
- **Internal use only.** The plugins are never authored or shipped by third parties.

If your situation matches all five bullets, `plugin` is viable. If any one is missing, look elsewhere.

---

## 4. CI requirements

Your CI must enforce:

```yaml
# .github/workflows/build.yml (sketch)
jobs:
  build:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version-file: 'go.mod'
          check-latest: false
      - name: Build host
        run: go build -trimpath -o bin/host ./cmd/host
      - name: Build plugins
        run: |
          for d in plugins/*/; do
            name=$(basename "$d")
            go build -trimpath -buildmode=plugin -o bin/plugins/"$name".so "./$d"
          done
      - name: Smoke test
        run: ./bin/host --plugins bin/plugins/ --selftest
```

Critical points:

- **`go-version-file: 'go.mod'`** pins toolchain to the module's declared version.
- **`-trimpath`** must be used identically on host and plugins (mismatch causes hash differences).
- **Smoke test loads every plugin at the end** to catch hash mismatches before deploy.
- **Don't cache `.so` artifacts across CI runs** unless the entire input tree is identical.

Anything less reliable is gambling with production load failures.

---

## 5. Deployment discipline

The deployment artifact must be the host + plugins together. A few rules learned in practice:

| Rule | Reason |
|------|--------|
| Bundle host and plugins in one tarball | Atomic upgrade; impossible to deploy a mismatched pair |
| Embed a build ID in both host and plugins | Verify at load time, refuse mismatched IDs |
| Don't allow operator-side plugin installation | Removes the path where an operator drops a stale `.so` |
| Treat `.so` files as binary, not config | They are not "configuration"; do not template them, do not edit them by hand |

A `manifest.json` next to the host listing the expected plugin filenames and their build IDs is cheap insurance.

---

## 6. The alternatives and when to migrate

| Mechanism | Pick when |
|-----------|-----------|
| **`plugin` (this chapter)** | Linux/macOS only, single team, in-process call latency required, no third-party plugins |
| **`hashicorp/go-plugin` (RPC)** | Cross-platform, untrusted plugins, hot reload, fault isolation; latency budget ≥ 100 µs per call is fine |
| **`wazero` (WASM)** | Cross-platform, untrusted plugins, multi-language, sandboxed; willing to pay 10–100× CPU cost |
| **`-buildmode=c-shared`** | A non-Go host language needs to call into Go; cross-platform (including Windows) |
| **`exec.Command` subprocess** | Simple extensions, language-agnostic, naturally sandboxed; per-call latency is irrelevant |
| **Build-time composition (xcaddy-style)** | The plugin set changes rarely and is known at build time; this is often the best answer |

If your situation drifts — you suddenly need Windows support, you're onboarding third-party plugin authors, you need hot reload — that's the migration signal. Start with a thin adapter layer behind your `pluginapi` so a future swap doesn't ripple through the host.

---

## 7. The plugin contract as a hardened API

Treat your `pluginapi` package as a public API even though it's internal. That means:

- **Semantic versioning.** Bump the major version on any breaking change to an interface, struct field, or function signature.
- **No struct field additions in patch versions.** Even appending a field changes the type hash and breaks identity.
- **No interface method additions.** Adding a method to `pluginapi.Plugin` instantly breaks every old plugin. Use a sub-interface and runtime check (`if p, ok := pl.(BatchPlugin); ok { ... }`).
- **Deprecation policy.** When you must change something, ship both old and new for a release cycle.

The `pluginapi` package should be tiny. The smaller it is, the less surface area for accidental hash changes.

---

## 8. Build IDs and runtime verification

A pragmatic verification step that catches most mismatch bugs:

```go
// pluginapi/api.go
package pluginapi

// BuildID is set by the build pipeline via -ldflags
var BuildID = "dev"
```

```bash
go build -trimpath \
    -ldflags="-X myproject/pluginapi.BuildID=$BUILD_ID" \
    -buildmode=plugin -o plugins/filter.so ./plugins/filter
```

In each plugin:

```go
package main

import "myproject/pluginapi"

var BuildID = pluginapi.BuildID
```

In the host:

```go
sym, _ := p.Lookup("BuildID")
pluginID := *sym.(*string)
if pluginID != pluginapi.BuildID {
    return fmt.Errorf("plugin %s built with %s; host wants %s",
        path, pluginID, pluginapi.BuildID)
}
```

If the build pipeline is correct, every plugin and the host share the same `BuildID`. If somehow they don't, you fail fast with a clear message instead of a panic in the middle of a request.

---

## 9. Observability for plugin operations

Production hosts loading plugins need to expose:

- **`plugin_load_total{path, status}`** — counter of `Open` results.
- **`plugin_load_duration_seconds{path}`** — histogram, p50/p99 of `Open` time.
- **`plugin_lookup_total{path, symbol, status}`** — counter of `Lookup` results.
- **`plugin_call_total{plugin, method, status}`** — counter of dispatched calls.
- **`plugin_call_duration_seconds{plugin, method}`** — call latency.

Plus structured logs at `Open` time recording the plugin path, file size, build ID, and resolved symbols. When a load fails in production, you want to know everything possible about the input — you cannot reproduce a hash mismatch from a stack trace alone.

---

## 10. Operational hazards

A non-exhaustive list of things that have caused real outages:

| Hazard | Mitigation |
|--------|-----------|
| Operator copies an old plugin into the deploy dir | Verify build ID at load; refuse mismatches |
| Plugin panics in a request path | Recover at the call site; mark the plugin as failed; do not unload (you can't) |
| Plugin's `init` connects to a database that's not yet ready | Move I/O out of `init`; use explicit `Initialize` |
| Plugin leaks goroutines | Audit during CI; require plugins to expose a `Shutdown` (cooperative, not enforced) |
| Plugin memory footprint dwarfs the host's | Plan capacity assuming every plugin is loaded permanently |
| Two plugins both export `New` and the host loads both | Always namespace lookups by plugin path |
| Disk full during `Open` (large plugin, no space for memory-mapped pages) | Pre-flight disk space check; size-of-`.so` budget per host |
| `.so` file replaced under a running process | The kernel keeps the old inode mapped; new processes see new code; old process sees old. Don't replace, deploy fresh |

---

## 11. When the team should stop using the plugin package

Honest indicators:

- The build pipeline now has more lines about plugin orchestration than the host itself.
- Users (or other teams) request Windows support.
- The CI matrix has to test plugin permutations and is too slow.
- More than one team writes plugins and they can't agree on Go versions.
- You've debugged three or more "different version of package X" errors this quarter.

When two or more of those are true, migrate. The cost of moving to RPC or WASM is real, but every month spent fighting the plugin package's invariants compounds.

---

## 12. Summary

The `plugin` package is a legitimate tool for narrow conditions: single-team, Linux/macOS-only, lockstep builds, in-process latency required. Successful production deployments share monorepo discipline, atomic deploys, a tiny `pluginapi` package, and CI that enforces toolchain pinning and `-trimpath` consistency. Most teams who try it eventually migrate to RPC plugins, WASM, or build-time composition. Plan the migration path early so the day it's needed you're not blocked.

---

## Further reading
- `hashicorp/go-plugin`: https://github.com/hashicorp/go-plugin
- `wazero` WASM runtime: https://wazero.io
- `xcaddy` build-time composition: https://github.com/caddyserver/xcaddy
- Broader plugin survey: [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/)
