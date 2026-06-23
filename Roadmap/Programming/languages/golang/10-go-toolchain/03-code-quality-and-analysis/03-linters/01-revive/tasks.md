# revive — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+ and a pinned `revive` (e.g., `@v1.5.1`) so results stay reproducible.

---

## Task 1: Install and run with defaults

Install `revive` and lint a small module.

**Acceptance criteria**
- [ ] `go install github.com/mgechev/revive@v1.5.1` succeeds and `revive -version` prints `1.5.1`.
- [ ] In a new module with one undocumented exported type, `revive ./...` prints at least one finding mentioning that type and the rule `exported`.
- [ ] You can name three rules from the default set and what each catches.

---

## Task 2: Write a `revive.toml` with 5 rules

Author a config that enables exactly five rules: `var-naming`, `exported`, `error-strings`, `if-return`, `unused-parameter`.

**Acceptance criteria**
- [ ] `revive -config revive.toml ./...` runs without an "unknown rule" error.
- [ ] Introducing a variable named `userId` triggers `var-naming`.
- [ ] An error message `errors.New("Bad input.")` triggers `error-strings`.
- [ ] A rule **not** in your config (e.g., `package-comments`) does **not** fire even though it is in the defaults.

---

## Task 3: Disable a rule per line

Take a function that legitimately has an unused parameter (e.g., an HTTP handler signature) and silence `unused-parameter` only for that line.

**Acceptance criteria**
- [ ] Without the directive, `revive` reports the unused parameter.
- [ ] After adding `//revive:disable-next-line:unused-parameter` directly above the function, the finding disappears.
- [ ] Other `unused-parameter` findings in the same file are still reported.

---

## Task 4: Switch to the `friendly` formatter

Compare `default` and `friendly` formatters.

**Acceptance criteria**
- [ ] `revive -config revive.toml -formatter default ./...` prints one finding per line as `file:line:col: message`.
- [ ] `revive -config revive.toml -formatter friendly ./...` prints a grouped, colored summary.
- [ ] You can articulate which formatter you would use for terminal use vs. CI logs.

---

## Task 5: CI: fail on errors only

Configure two severities and wire `revive` into a CI script that fails only on `error` findings.

**Acceptance criteria**
- [ ] Your `revive.toml` marks `error-return` as `severity = "error"` and `exported` as `severity = "warning"`.
- [ ] In CI, `revive -config revive.toml -set_exit_status ./...` exits 0 when only `exported` findings exist.
- [ ] When you introduce a function with an `error` return in the wrong position, the script exits non-zero.

---

## Task 6: Custom rule that flags TODO comments

Write a Go program that imports `github.com/mgechev/revive` as a library, registers a custom rule that flags `// TODO` comments, and runs the linter from a small CLI.

**Acceptance criteria**
- [ ] Your CLI builds as `team-lint` and runs `team-lint -config revive.toml ./...`.
- [ ] Your custom rule's `Name()` returns a unique, prefixed name (e.g., `team-todo-comment`).
- [ ] Linting a file with a `// TODO: refactor` line produces a finding with category `comments`.
- [ ] You can enable/disable the rule via a `[rule.team-todo-comment]` block in the TOML.

---

## Task 7: Run revive only on changed packages

Write a shell snippet that runs `revive` on the packages touched by the current branch (relative to `origin/main`) instead of the whole tree.

**Acceptance criteria**
- [ ] `git diff --name-only origin/main...HEAD | grep '\.go$' | xargs -n1 dirname | sort -u` lists the affected directories.
- [ ] Your script converts that to `./pkg/...` form and invokes `revive -config revive.toml` on it.
- [ ] When no Go files changed, the script exits 0 without running `revive` on `./...`.
- [ ] Wall time on a non-trivial repo is noticeably less than `revive ./...`.

---

## Task 8: Machine-readable output for CI

Replace a CI grep over the default text format with `ndjson`-based parsing.

**Acceptance criteria**
- [ ] `revive -config revive.toml -formatter ndjson ./...` produces one JSON object per line.
- [ ] `jq -r 'select(.Severity == "error") | .Failure'` extracts only error-level messages.
- [ ] Your CI counts errors with `... | wc -l` instead of `grep error | wc -l`.
- [ ] You note in writing why parsing the default formatter would break across `revive` versions.

---

## Task 9: Pair with `staticcheck` (reflection)

Run both `revive` and `staticcheck` on the same module and compare their findings.

**Acceptance criteria**
- [ ] You can produce one finding that only `revive` flags (e.g., a missing doc comment on an exported type).
- [ ] You can produce one finding that only `staticcheck` flags (e.g., `bytes.Equal(a, []byte("x"))` style or dead code).
- [ ] You write 2–3 sentences explaining why the two tools are complementary and which you would block CI on.
