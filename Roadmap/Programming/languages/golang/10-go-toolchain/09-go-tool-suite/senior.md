# go tool — Senior

## 1. Architectural role of the suite

`go tool` exists because the Go distribution is a **set of cooperating programs**, not a monolith. The driver (`cmd/go`) plans builds; the toolchain binaries (`compile`, `asm`, `link`, `cgo`, `pack`) execute the plan; observability binaries (`pprof`, `trace`, `cover`, `nm`, `objdump`, `addr2line`, `test2json`) let humans and pipelines look inside the result. Knowing this split lets you bypass the driver when you need to (e.g., calling `link` with a custom `-importcfg` in a research script) and know which tool to reach for in each phase of a system's life cycle.

---

## 2. Inlining inspection: from compiler hints to actual code

A characteristic senior workflow is to verify that a perf-critical function is in fact inlined:

```bash
go build -gcflags='-m=2' ./... 2>&1 | grep 'can inline\|inlining call to'
```

That tells you what the compiler **decided**. To confirm in the **emitted binary**, disassemble the caller and look for the call sequence:

```bash
go build -o app ./cmd/server
go tool objdump -s '^pkg\.Caller$' app | less
```

If the inlinee body appears inline (no `CALL pkg.Inlinee(SB)`), the decision was honored. This cross-check matters because `-m` reports compile-time intent; later passes (mid-stack inliner limits, escape analysis side-effects) can still produce a call.

---

## 3. Build-id verification in a release pipeline

Reproducibility is verifiable, not aspirational. A common senior pattern:

```bash
# build twice, in clean environments, with -trimpath for path-independence
go build -trimpath -buildvcs=false -o out1/app ./cmd/app
go build -trimpath -buildvcs=false -o out2/app ./cmd/app

ID1=$(go tool buildid out1/app)
ID2=$(go tool buildid out2/app)
test "$ID1" = "$ID2" || { echo "non-reproducible"; exit 1; }
```

Use it as a gate before signing a release artifact. If IDs differ across "identical" builds, something is leaking into inputs: a timestamp, a path, an env var (`GOFLAGS`), a toolchain difference, or a non-determinism in code generation.

---

## 4. Chasing binary bloat with `nm`

When a binary suddenly grows by 30 MB after a dependency bump, sort `nm -size` to find out which packages got fat:

```bash
go build -o app ./cmd/app
go tool nm -size -sort=size app | head -40
# 0000000001234000 0001234567 T github.com/some/dep.bigGeneratedThing
# ...
```

For *aggregate* per-package totals, group symbol prefixes:

```bash
go tool nm -size app \
  | awk '$3 ~ /^[A-Z]$/ { split($4,a,"."); print a[1] " " $2 }' \
  | sort | awk '{s[$1]+=$2} END {for (k in s) print s[k], k}' \
  | sort -nr | head
```

That gives you a quick "which package is eating the binary?" — useful before deciding whether to lazy-load, replace, or fork the dependency. Combine with `goweight` or `go-binsize-viz` for prettier views; under the hood they all parse `nm` output.

---

## 5. Feeding CI dashboards with `test2json`

`go test -json` (which is `test2json` under the hood) is the right format to bridge tests and dashboards:

```bash
go test -json ./... | tee results.jsonl
cat results.jsonl | go-junit-report -parser gojson > junit.xml
```

A senior point: `-json` plus a converter (junit, gotestsum, custom collector) is strictly better than parsing `go test -v` output, which is human-formatted and changes between releases. Pipelines that grep test output should be migrated to `-json`.

---

## 6. `cover -html` in code review

In review, "you added 200 lines of logic" is hard to assess; "you added 200 lines with 10% coverage" is actionable. Wire `go tool cover -html` into the review workflow:

```bash
go test -coverprofile=cover.out ./...
go tool cover -html=cover.out -o coverage.html
# upload coverage.html as a PR artifact
```

For multi-binary integration tests (e.g., end-to-end suites that exec built binaries), `go build -cover` plus `go tool covdata merge` aggregates profiles across processes — a frequent surprise to people who only knew unit-test coverage.

---

## 7. `addr2line` for crash reports

Production panics print PCs that you can resolve back to `file:line` with the original binary:

```bash
# panic stack mentions  pc=0x10a1234  in app
go tool addr2line app <<<'0x10a1234'
# /home/build/svc/internal/foo/bar.go
# 142
```

This is the same idea as `dlv core` but stripped to one tool — useful when all you have is a panic dump from a customer.

Important: it only works with the **exact** binary that produced the address. A different build, even of the same commit, has different PCs.

---

## 8. When to bypass `go build` and call `compile`/`link` directly

Almost never in product code. Reasons a senior might:

- Researching compiler/linker behavior (custom `-gcflags`, custom `-ldflags`, experimenting with `-buildmode`).
- Implementing alternative build systems (Bazel rules, distributed builders) that produce their own action graph and feed each tool an `-importcfg` directly.
- Reproducing a bug minimally for a `cmd/compile` issue.

The cost is high: you must construct `-importcfg` files yourself, mind the `pack` layout for archives, and stay in step with toolchain changes. For everything else, `go build -toolexec=...` is the supported escape hatch (it lets you intercept tool invocations without owning the whole pipeline).

---

## 9. Operational discipline

A few habits to make these tools dependable:

- Pin a **single toolchain version** in CI (`go env GOTOOLCHAIN`, `toolchain` directive in `go.mod`). The output of `nm`, `objdump`, `cover`, `pprof` shifts subtly across versions.
- Always include `-trimpath` when shipping or comparing binaries; otherwise local paths leak into symbol names and break reproducibility plus privacy.
- Keep the original (unstripped) binary alongside each release, so `addr2line` and `objdump` can resolve future panic reports.
- Use `-json` (and `test2json`) for any tool whose output you parse; never grep human strings.

---

## 10. Summary

At a senior level the `go tool` suite is your introspection layer: `objdump`/`nm`/`addr2line` for binary archaeology, `buildid` for reproducibility gates, `cover`/`covdata` for coverage including multi-process, `test2json` for CI integration, and `pprof`/`trace` for performance. Pair compiler hints (`-gcflags=-m`) with disassembly to verify decisions, keep unstripped binaries for crash forensics, and reserve direct `compile`/`link` use for tooling-builders and bug repros.

---

## Further reading
- Compiler flags: https://pkg.go.dev/cmd/compile
- Linker flags: https://pkg.go.dev/cmd/link
- Test coverage for the executable: https://go.dev/blog/integration-test-coverage
- Reproducible builds: https://go.dev/blog/rebuild
