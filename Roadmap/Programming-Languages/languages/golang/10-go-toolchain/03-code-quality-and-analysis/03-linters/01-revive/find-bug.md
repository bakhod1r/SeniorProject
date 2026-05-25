# revive — Find the Bug

Each scenario shows code or config that looks fine but produces a misleading lint result, missed finding, or broken CI. Find the defect, explain it, and fix it.

---

## Bug 1 — Undocumented exported var

```go
package store

var Default = NewStore()
```

```
store.go:3:5: exported var Default should have comment or be unexported
```

**Bug:** the `exported` rule requires a doc comment that **starts with the identifier name** on every exported identifier; `Default` has none.
**Fix:** add a conforming doc comment:

```go
// Default is the package-level default store used when no explicit store is supplied.
var Default = NewStore()
```

(Or unexport it: `var defaultStore = NewStore()`.)

---

## Bug 2 — `if err != nil { return err }` flagged

```go
func load() (*Config, error) {
    cfg, err := readConfig()
    if err != nil {
        return nil, err
    }
    return cfg, nil
}

func loadName() (string, error) {
    name, err := readName()
    if err != nil {
        return name, err
    }
    return name, nil
}
```

The second function trips `if-return`:

```
loader.go:9:2: if block ends with a return statement, so drop this else and outdent its block
```

**Bug:** `loadName` writes the trivial pattern `if err != nil { return x, err }; return x, nil`, which collapses to `return name, err` after the call. `load` is fine because it returns *different* values on the two paths (`nil` vs `cfg`).
**Fix:**

```go
func loadName() (string, error) {
    name, err := readName()
    return name, err
}
```

---

## Bug 3 — Capitalized error message

```go
import "errors"

var ErrNotFound = errors.New("Not Found.")
```

```
errors.go:3:30: error strings should not be capitalized or end with punctuation
```

**Bug:** the `error-strings` rule enforces the Go convention that error strings are lowercase and unpunctuated, because they are often wrapped: `fmt.Errorf("load: %w", err)` produces `"load: Not Found."` — ugly.
**Fix:**

```go
var ErrNotFound = errors.New("not found")
```

---

## Bug 4 — Unused parameter

```go
func handle(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
}
```

```
handler.go:1:23: parameter 'r' seems to be unused, consider removing or renaming it as _
```

**Bug:** `unused-parameter` fires because `r` is never read. The signature is fixed (`http.HandlerFunc`), so deleting `r` is not an option.
**Fix:** rename to `_` to signal intent:

```go
func handle(w http.ResponseWriter, _ *http.Request) {
    w.WriteHeader(http.StatusOK)
}
```

Or, if the rule is wrong-for-context too often (callback signatures everywhere), disable it for that file and explain why.

---

## Bug 5 — `Id` vs `ID`

```go
type User struct {
    Id   int64
    Name string
}

func GetById(id int64) *User { ... }
```

```
user.go:2:2: struct field Id should be ID
user.go:5:6: func GetById should be GetByID
```

**Bug:** `var-naming` enforces Go's initialism convention: `ID`, `URL`, `HTTP`, `JSON`, etc. must be all-caps, not title-case.
**Fix:**

```go
type User struct {
    ID   int64
    Name string
}

func GetByID(id int64) *User { ... }
```

If this is on an existing public API, change carefully — the rename is a breaking change for callers.

---

## Bug 6 — Two packages without `// Package` comment

```
internal/
  store/
    store.go     // starts: `package store`
  cache/
    cache.go     // starts: `package cache`
```

```
internal/store/store.go:1:1: should have a package comment
internal/cache/cache.go:1:1: should have a package comment
```

**Bug:** `package-comments` requires every package to have a doc comment on the file containing the package clause (typically one file per package — the "doc" file).
**Fix:** add a comment immediately above one `package X` clause in each:

```go
// Package store persists user records to PostgreSQL.
package store
```

Convention: put the package comment on the file whose name matches the package, or in a `doc.go` file.

---

## Bug 7 — Ignored `os.Remove` error

```go
func cleanup(path string) {
    os.Remove(path)
}
```

```
cleanup.go:2:2: Unhandled error in call to function os.Remove
```

**Bug:** `unhandled-error` fires because `os.Remove` returns an `error` that is silently discarded — a real bug if the removal needed to succeed.
**Fix:** either handle it, or be explicit:

```go
if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
    log.Printf("cleanup: %v", err)
}
```

If you genuinely want to ignore certain calls (e.g., `fmt.Print*`), whitelist them in the config:

```toml
[rule.unhandled-error]
  arguments = ["fmt.Print*", "fmt.Fprint*"]
```

Do **not** silence by assigning to `_` everywhere — the rule still flags that on some setups, and even when it does not, it hides intent.

---

## Bug 8 — Defaults disable a helpful rule

```toml
# revive.toml — minimal team config
[rule.var-naming]
[rule.exported]
```

The team thought this was strict, but `error-return`, `package-comments`, `if-return`, etc. *no longer fire*.

**Bug:** the moment you provide *any* `[rule.X]` blocks, the built-in default rule set is **replaced**, not extended. Only the rules listed in the file are active.
**Fix:** list every rule you want, including those you assumed were "always on":

```toml
[rule.var-naming]
[rule.exported]
[rule.package-comments]
[rule.error-return]
[rule.error-strings]
[rule.if-return]
[rule.indent-error-flow]
[rule.receiver-naming]
[rule.context-as-argument]
[rule.context-keys-type]
```

---

## Bug 9 — CI script parses ndjson wrong

```bash
revive -formatter ndjson ./... > out.txt
ERRORS=$(grep '"Severity":"error"' out.txt | wc -l)
[ "$ERRORS" -gt 0 ] && exit 1
```

The job passes even when there are clear errors.

**Bug:** the script forgot `-set_exit_status` and assumed `ndjson` is just text — the field order or whitespace inside the JSON object can vary across `revive` versions, so substring matching is brittle. Also, `revive` exits 0 by default, so a downstream step might `&&` past this whole block.
**Fix:** use a real JSON parser and `-set_exit_status`:

```bash
revive -config revive.toml -formatter ndjson -set_exit_status ./... \
  | jq -e 'select(.Severity == "error")' && exit 1
exit 0
```

Or even simpler — let `-set_exit_status` plus the right `errorCode` do the work:

```bash
revive -config revive.toml -set_exit_status ./...
```

---

## Bug 10 — `revive` fires on `// Code generated` file

```go
// Code generated by mockgen. DO NOT EDIT.
package mock

type MockStore struct { ... }
```

```
mock_store.go:3:6: exported type MockStore should have comment or be unexported
```

**Bug:** by default `revive` should skip generated files, but the header line is wrong — `mockgen` (and some custom generators) put it in the wrong column or include extra leading text, so `revive`'s detection misses it.
**Fix:** make sure the very first non-build-tag line matches the canonical regex `// Code generated .* DO NOT EDIT\.` exactly. Either fix the generator template, or `-exclude` the path:

```bash
revive -exclude ./internal/mock/... ./...
```

Or use a file-level directive:

```go
//revive:disable
```

---

## How to approach these
1. Read the finding's rule name and look it up in the rule catalogue — most messages alone are not enough.
2. If the rule does not match your context, fix the config (exclude, arguments, severity) before reaching for inline disables.
3. When a config file is in play, remember it **replaces** the defaults — listing two rules turns off everything else.
4. For CI parsing, use `ndjson` + `jq` and `-set_exit_status`; never grep the human formatter.
5. For generated code, fix the generator's header first; excludes are second-best.
