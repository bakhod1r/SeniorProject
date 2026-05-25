# go tool — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is `go tool`?**
A launcher for the helper binaries shipped with the Go distribution. Run `go tool` with no arguments to list them; `go tool <name>` runs that helper.

**Q2. Where do these tools live?**
In `$GOROOT/pkg/tool/<GOOS_GOARCH>/`. The convenient variable is `go env GOTOOLDIR`. They are real executables on disk.

**Q3. Name three `go tool` commands you would use as a developer.**
`go tool pprof` (profile analysis), `go tool cover` (coverage report), `go tool trace` (execution trace viewer). Honourable mentions: `nm`, `objdump`, `addr2line`, `buildid`, `dist list`.

**Q4. How do you list the targets you can cross-compile to?**
`go tool dist list` (or `go tool dist list -json` for machine-readable output).

---

## Middle

**Q5. What does `go tool nm` show, and how do you use it to chase binary size?**
It prints the symbol table — every named function/variable in the binary. `go tool nm -size -sort=size app | head` ranks symbols by size; combined with prefix grouping, it points at the package that is bloating your binary.

**Q6. How are `go test -coverprofile` and `go tool cover` related?**
`go test -coverprofile=cover.out` produces the profile; `go tool cover` consumes it (`-func` for a summary, `-html` for the annotated report). `cover` does not collect data on its own.

**Q7. What does `go tool buildid` print, and what is it used for?**
A content-derived ID embedded in a Go object/binary. It identifies the inputs that produced it; identical inputs → identical IDs. Used to verify reproducibility and artifact identity.

**Q8. What does `go tool test2json` do?**
Converts the human-readable `go test -v` output into a stream of JSON events (one per line). `go test -json` uses it under the hood; CI dashboards consume that stream.

---

## Senior

**Q9. You see `inlining call to foo` in `-gcflags=-m` output but performance suggests it did not inline. How do you verify?**
Disassemble the caller with `go tool objdump -s '^pkg\.Caller$' app`. If you still see `CALL pkg.foo(SB)`, it did not inline despite the compiler's earlier intent (mid-stack inliner limits, complex control flow, build flags like `-N -l`).

**Q10. Why are `go tool compile`/`link`/`asm` considered "internal" even though they are runnable?**
Their command lines are an unstable contract between `cmd/go` and the toolchain. Each release can rearrange flags or required inputs (`-importcfg`, `-buildid`, search paths). For interception, use the supported `go build -toolexec=PROGRAM` instead.

**Q11. How do you map an address from a panic stack to source?**
`go tool addr2line <binary>` and feed PC values on stdin. It returns `file:line`. You need the exact binary that produced the address — a different build of the same commit has different PCs.

**Q12. How do you collect coverage from multi-binary integration tests?**
Build with `go build -cover`, run the binaries (setting `GOCOVERDIR=...` to a writable dir), then merge with `go tool covdata merge` and report with `go tool covdata textfmt` (or convert to a profile for `go tool cover -html`).

---

## Professional

**Q13. How would you make every `go build` in a monorepo go through your wrapper for caching/signing?**
`go build -toolexec=/path/to/wrapper ./...`. The driver invokes `wrapper compile ...`, `wrapper link ...`, etc., letting you intercept each tool call without owning the build graph. Pair with a pinned `GOTOOLCHAIN` for determinism.

**Q14. What guarantees and non-guarantees does `go tool buildid` give for artifact verification?**
Guarantee: equal IDs ⇒ equal inputs (source, flags, toolchain version, environment that affects builds). Non-guarantee: it does **not** authenticate; `go tool buildid -w` can rewrite it. For true provenance use code signing or a build attestation.

**Q15. A team-mate asks why their old script `go tool vet ./...` no longer works. What do you say?**
`vet` was promoted out of `go tool`; modern Go invokes it via `go vet` (and `go test` runs a vet subset automatically). The script must be updated; `go tool vet` no longer exists in current toolchains.

---

## Common traps

- Assuming `go tool` is a wrapper around `go` itself — it is a launcher for separate binaries in `$GOTOOLDIR`.
- Calling `compile`/`link`/`asm` directly and being surprised by `-importcfg` requirements — use `go build` (or `-toolexec` to intercept).
- Treating the build ID as authentication — it is content-addressed, not signed.
- Forgetting that `cover`/`covdata`/`pprof` output formats are toolchain-versioned: traces and profiles may not open in older `go tool trace`/`pprof`.
- Running `go tool addr2line` against a different build of the same commit and expecting matching PCs.
- Grepping `go test -v` output instead of using `go test -json` (or `go tool test2json`).
- Shipping `go tool pprof -http=:8080` bound to all interfaces in shared environments.
- Assuming every Go installation has the same tool catalog — newer versions add (`covdata`) and remove (`vet`, `yacc`) tools.
