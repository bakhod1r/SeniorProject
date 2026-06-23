# Raw String Literals in Go — Middle Level

## 1. Introduction

At the middle level, raw string literals are understood not just as "backtick strings" but as a deliberate choice that affects code readability, maintainability, and correctness. This guide examines when raw strings are the right tool, the subtleties of their behavior, and how they interact with Go's broader ecosystem.

---

## 2. Prerequisites

- Solid understanding of Go string types and operations
- Experience with regular expressions in Go
- Understanding of Go's `text/template` and `html/template` packages
- Familiarity with SQL and JSON in Go programs
- Comfortable writing Go packages and tests

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| **Raw string literal** | A string delimited by backticks with no escape processing |
| **Interpreted string literal** | A string in double quotes where escape sequences are processed |
| **Carriage return stripping** | Raw strings remove `\r` (0x0D) bytes from their content per the Go spec |
| **Dedenting** | Removing common leading whitespace from a multiline string |
| **Heredoc** | A syntax in other languages for multiline strings (not in Go) |
| **CRLF** | Carriage Return + Line Feed (`\r\n`), Windows line endings |
| **Go spec** | The formal specification of the Go language |
| **Template literal** | JavaScript's backtick strings with interpolation — different from Go raw strings |

---

## 4. Core Concepts (Deep Dive)

### The Go Specification on Raw String Literals

From the Go spec:
> A raw string literal is a sequence of characters between back quotes, as in `` `foo` ``. Within the quotes, any character may appear except back quote. The value of a raw string literal is the string composed of the uninterpreted characters between the quotes; in particular, backslashes have no special meaning and the string may contain newlines. Carriage return characters ('\r') inside raw string literals are discarded from the raw string value.

The key points:
1. Any character except backtick is allowed
2. Backslashes are NOT special
3. Newlines are included literally
4. `\r` is discarded (platform-independence feature)

### Carriage Return Stripping in Detail

```go
// If you save source code with Windows line endings,
// raw string literals still produce LF-only content:
s := `line1
line2`
// Even if the source file has CRLF between "line1" and "line2",
// the Go compiler strips the \r, so s contains only \n (LF)

// This is intentional: makes code portable across Windows/Unix
// Verify:
for i, b := range []byte(s) {
    fmt.Printf("%d: %02x\n", i, b)
}
// You'll never see 0x0d (\r) in a raw string
```

---

## 5. Evolution

Raw string literals have been part of Go since the very beginning (pre-Go 1.0). Unlike Python's evolution from `str` to `bytes` or JavaScript's addition of template literals in ES6, Go's raw string design was stable from day one.

Go 1.0 (2012): Raw string literals exactly as they are today.

The carriage-return stripping rule was deliberate — it ensures that raw strings embedded in source code have consistent content regardless of whether the developer uses a Windows editor or a Unix editor.

There is ongoing discussion (but no implementation) about a `strings.Dedent` function in the standard library, which would help with the indentation pitfall in raw strings. As of Go 1.22, no such function exists in stdlib.

---

## 6. Why Raw Strings Work This Way

### No Escape Processing

The decision to have no escape processing makes raw strings predictable:
- What you see in the source is what you get at runtime
- No accidental double-escaping in regex: `"\\d+"` vs `` `\d+` ``
- No risk of `"C:\new folder"` being interpreted as `C:` + newline + `ew folder`

### The Backtick Limitation

Not supporting an escape for the backtick character was a conscious simplicity trade-off. The alternatives would be:
- `\`` — but then backslash IS special, breaking "no escape processing"
- Doubling: ` `` ` — but this is ambiguous (is it an empty raw string or an escaped backtick?)
- No solution without compromising simplicity

The Go team chose simplicity over completeness. Workaround: concatenate with a regular string.

---

## 7. Alternative Approaches

### When to Use Interpreted Instead of Raw

```go
// Use interpreted string when:

// 1. String contains a backtick
msg := "He said `hello`"  // must use double quotes

// 2. Need escape sequences for non-printable characters
separator := "\x00"  // null byte separator
header := "\x1b[1;31m" // ANSI red color escape

// 3. Short string without backslashes
name := "Alice"  // raw would work but double quotes is idiomatic

// 4. Unicode escape (compile-time encoding)
copyright := "\u00a9 2024"  // © 2024
```

### Mixing Raw and Interpreted

```go
// Workaround for backtick in a "raw" context:
backtick := "`"
sqlWithBacktick := "SELECT `id`, `name` FROM `users`"
// Or for template:
tmpl := `SELECT ` + "`" + `id` + "`" + `, ` + "`" + `name` + "`" + ` FROM users`
// But at this point, just use the interpreted string directly!
```

### String Building with Raw String Template

```go
import (
    "strings"
    "text/template"
)

// Use Go's template engine with a raw string as the template
const emailTemplate = `
Dear {{.Name}},

Your account has been created. Here are your details:
  - Username: {{.Username}}
  - Email:    {{.Email}}

Best regards,
The Team
`

func renderEmail(data struct{ Name, Username, Email string }) string {
    tmpl := template.Must(template.New("email").Parse(emailTemplate))
    var b strings.Builder
    tmpl.Execute(&b, data)
    return b.String()
}
```

---

## 8. Anti-Patterns

```go
// Anti-pattern 1: Using raw strings for simple short strings with no backslashes
greeting := `hello`  // pointless — "hello" is cleaner

// Anti-pattern 2: Using raw string when you actually need \n
msg := `Hello\n`  // contains \ and n, not a newline — BUG if newline is needed

// Anti-pattern 3: Ignoring leading whitespace in indented raw strings
func createJSON() string {
    return `
        {
            "key": "value"
        }
    `
    // This has leading newline and 8-space indent on each line!
}

// Fix: use strings.TrimSpace and handle indent
func createJSONFixed() string {
    return strings.TrimSpace(`
        {
            "key": "value"
        }
    `)
    // But the inner lines still have 8 spaces of indent
}
```

---

## 9. Pros & Cons (Deeper Analysis)

### Why Regex Readability Matters

```go
// Consider a complex email regex
// Interpreted version:
emailRe := regexp.MustCompile("^[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}$")

// Raw version:
emailRe := regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

// The raw version:
// 1. Can be copy-pasted to/from regex testing tools without modification
// 2. Matches exactly what a regex reference document shows
// 3. Reduces bugs from forgotten double-escaping
```

### Indentation Trade-off

The main downside of multiline raw strings: indentation in code becomes part of the string content.

```go
// The visual alignment is nice, but the string contains 8 spaces of indent:
func getQuery() string {
    return `
        SELECT *
        FROM users
    `
}

// vs. putting the raw string at column 0 (ugly code, clean string):
func getQuery() string {
return `
SELECT *
FROM users
`
}

// vs. using a dedent helper:
func getQuery() string {
    return dedent(`
        SELECT *
        FROM users
    `)
}
```

---

## 10. Real-World Use Cases

### Use Case 1: Kubernetes YAML Manifests in Tests

```go
const podManifest = `
apiVersion: v1
kind: Pod
metadata:
  name: test-pod
  labels:
    app: test
spec:
  containers:
  - name: app
    image: myapp:latest
    ports:
    - containerPort: 8080
`

func TestPodCreation(t *testing.T) {
    pod, err := parsePodManifest(podManifest)
    if err != nil {
        t.Fatal(err)
    }
    // ... test assertions ...
    _ = pod
}
```

### Use Case 2: OpenAPI Spec Fixtures

```go
const openAPISpec = `
{
  "openapi": "3.0.0",
  "info": {
    "title": "My API",
    "version": "1.0.0"
  },
  "paths": {
    "/users": {
      "get": {
        "summary": "List users"
      }
    }
  }
}
`
```

### Use Case 3: Complex Regex Patterns

```go
var (
    // IPv4 address
    ipv4Re = regexp.MustCompile(`^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$`)

    // ISO 8601 date
    dateRe = regexp.MustCompile(`^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$`)

    // Semantic version
    semverRe = regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\w\-]+(?:\.[\w\-]+)*))?$`)
)
```

---

## 11. Code Examples

### Example 1: Dedent Helper Function

```go
package main

import (
    "fmt"
    "strings"
)

// Dedent removes common leading whitespace from a multiline raw string
func Dedent(s string) string {
    lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
    if len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
        lines = lines[1:]
    }
    if len(lines) == 0 {
        return ""
    }
    minIndent := -1
    for _, line := range lines {
        if strings.TrimSpace(line) == "" {
            continue
        }
        indent := len(line) - len(strings.TrimLeft(line, " \t"))
        if minIndent < 0 || indent < minIndent {
            minIndent = indent
        }
    }
    if minIndent <= 0 {
        return strings.Join(lines, "\n")
    }
    var result []string
    for _, line := range lines {
        if len(line) >= minIndent {
            result = append(result, line[minIndent:])
        } else {
            result = append(result, "")
        }
    }
    return strings.Join(result, "\n")
}

func main() {
    query := Dedent(`
        SELECT id, name
        FROM users
        WHERE active = true
        ORDER BY name
    `)
    fmt.Printf("%q\n", query)
    // "SELECT id, name\nFROM users\nWHERE active = true\nORDER BY name"
}
```

### Example 2: Template with Raw String

```go
package main

import (
    "fmt"
    "strings"
    "text/template"
)

type ServerConfig struct {
    Host    string
    Port    int
    Workers int
    Debug   bool
}

const nginxTemplate = `
server {
    listen {{.Port}};
    server_name {{.Host}};

    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
    }

    worker_processes {{.Workers}};
    {{if .Debug}}
    error_log /var/log/nginx/error.log debug;
    {{end}}
}
`

func generateNginxConfig(cfg ServerConfig) (string, error) {
    tmpl, err := template.New("nginx").Parse(nginxTemplate)
    if err != nil {
        return "", fmt.Errorf("parsing template: %w", err)
    }
    var b strings.Builder
    if err := tmpl.Execute(&b, cfg); err != nil {
        return "", fmt.Errorf("executing template: %w", err)
    }
    return b.String(), nil
}

func main() {
    cfg := ServerConfig{Host: "example.com", Port: 80, Workers: 4, Debug: false}
    out, _ := generateNginxConfig(cfg)
    fmt.Println(out)
}
```

### Example 3: Test Fixtures with Raw Strings

```go
package parser_test

import (
    "encoding/json"
    "testing"
)

func TestParseResponse(t *testing.T) {
    testCases := []struct {
        name    string
        input   string
        wantErr bool
    }{
        {
            name: "valid user",
            input: `{
                "id": 1,
                "name": "Alice",
                "email": "alice@example.com"
            }`,
            wantErr: false,
        },
        {
            name:    "invalid JSON",
            input:   `{invalid}`,
            wantErr: true,
        },
    }

    for _, tc := range testCases {
        t.Run(tc.name, func(t *testing.T) {
            var m map[string]interface{}
            err := json.Unmarshal([]byte(tc.input), &m)
            if (err != nil) != tc.wantErr {
                t.Errorf("unexpected error state: got %v", err)
            }
        })
    }
}
```

---

## 12. Coding Patterns

### Pattern: Constants File for SQL Queries

```go
// queries/user.go
package queries

const (
    GetUser = `
        SELECT id, name, email, created_at
        FROM users
        WHERE id = $1 AND deleted_at IS NULL
    `

    ListUsers = `
        SELECT id, name, email
        FROM users
        WHERE deleted_at IS NULL
        ORDER BY name ASC
        LIMIT $1 OFFSET $2
    `

    CreateUser = `
        INSERT INTO users (name, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, created_at
    `

    UpdateUser = `
        UPDATE users
        SET name = $2, email = $3, updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING updated_at
    `
)
```

---

## 13. Clean Code

```go
// Prefer raw strings for regex — they match what regex documentation shows
// CLEAN:
var validSlug = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// MESSY (with double-quoted string):
var validSlug2 = regexp.MustCompile("^[a-z0-9]+(?:-[a-z0-9]+)*$") // double-quote OK here

// For complex patterns, raw strings are essential:
// CLEAN:
var semver = regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`)
// MESSY (interpreted):
var semver2 = regexp.MustCompile("^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$")
```

---

## 14. Debugging Guide

### Problem: Raw String Contains Unexpected Whitespace

```go
query := `
    SELECT *
    FROM users
`
// Debug: print with %q to see all characters
fmt.Printf("%q\n", query)
// Output: "\n    SELECT *\n    FROM users\n"
//          ^leading newline, 4 spaces of indent on each line

// Fix:
query = strings.TrimSpace(query)
fmt.Printf("%q\n", query)
// Still has 4 spaces on second line — use Dedent for full cleanup
```

### Problem: Regex Not Matching as Expected

```go
// Test your regex pattern before using it
re := regexp.MustCompile(`\d+`)
fmt.Println(re.MatchString("123")) // true

// Use regexp.QuoteMeta to see what characters are special
fmt.Println(regexp.QuoteMeta(`\d+`)) // \\d\+
// This shows: \d+ raw string has literal backslash — which IS what regex wants
```

### Problem: Unexpected Line Endings

```go
s := `line1
line2`
// Verify no \r present:
for i, b := range []byte(s) {
    fmt.Printf("byte[%d] = %02x\n", i, b)
}
// Will never show 0x0d — Go strips it
```

---

## 15. Comparison with Other Languages

| Language | Multiline String Syntax | Notes |
|----------|------------------------|-------|
| **Go** | `` `...` `` | No escapes, no backtick inside, \r stripped |
| **Python** | `"""..."""` or `r"..."` | `r"..."` is raw (no escapes), `"""..."""` still processes escapes |
| **JavaScript** | `` `...` `` | Template literals: has `${expr}` interpolation |
| **Java** | `"""..."""` (Java 15+) | Text blocks: auto-strips common indent |
| **Rust** | `r"..."` or `r#"..."#` | Can use `r#...#` for strings with quotes |
| **C#** | `@"..."` | Verbatim string: `""` inside = literal quote |
| **Ruby** | `%q{...}` or heredoc | Multiple options |
| **Kotlin** | `"""..."""` | Triple-quoted, supports `$var` interpolation |

**Go vs Python**: Python's `r"..."` is raw (no escape processing), but `"""..."""` still processes escapes. Go's `` `...` `` is always raw.

**Go vs JavaScript**: JavaScript template literals support `${expression}` interpolation. Go raw strings don't — you need `fmt.Sprintf` or `text/template`.

**Go vs Java**: Java 15+ text blocks auto-dedent (remove common leading whitespace). Go doesn't — you need a helper function.

**Go vs Rust**: Rust's `r#"..."#` syntax allows arbitrary nesting by increasing the number of `#` chars. More flexible but more complex.

---

## 16. Error Handling

```go
// Raw string literals themselves can't cause errors — compile-time only
// But patterns in raw strings can:

// Safe: compile-time constant regex
var re = regexp.MustCompile(`^\d{3}-\d{4}$`)

// Risky: user-provided pattern combined with raw string template
func buildDynamicRegex(userField string) (*regexp.Regexp, error) {
    // Even though the template is a raw string, userField may have issues
    pattern := `^` + userField + `$`
    re, err := regexp.Compile(pattern)
    if err != nil {
        return nil, fmt.Errorf("invalid regex field %q: %w", userField, err)
    }
    return re, nil
}
```

---

## 17. Security Considerations

```go
// Raw strings in SQL templates: still need parameterization
// The raw string just makes the template readable — not safe by itself

// STILL UNSAFE (SQL injection possible):
query := fmt.Sprintf(`SELECT * FROM users WHERE name = '%s'`, userInput)

// SAFE: use raw string for template structure, placeholders for values
const userQuery = `
    SELECT id, name, email
    FROM users
    WHERE name = $1
      AND active = true
`
rows, err := db.Query(userQuery, userInput) // safe!
_ = rows
_ = err

// Raw strings in HTML templates: html/template auto-escapes,
// but text/template does NOT
// Use html/template for user-facing HTML content
```

---

## 18. Performance Tips

```go
// Raw string literals have ZERO runtime overhead compared to interpreted strings
// The choice is purely a compile-time/developer decision

// Compile-time constant raw strings go to .rodata — no heap allocation
const sqlQuery = `SELECT * FROM users`

// Dynamic raw string concatenation still allocates at runtime
func buildQuery(table string) string {
    return `SELECT * FROM ` + table  // allocates (runtime concatenation)
}
```

---

## 19. Metrics & Analytics

```go
// Raw strings for embedding PromQL/SQL queries for monitoring
const errorRateQuery = `
    sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
    /
    sum(rate(http_requests_total[5m])) by (service)
`

const slowQueriesSQL = `
    SELECT
        query_text,
        calls,
        mean_exec_time,
        total_exec_time
    FROM pg_stat_statements
    WHERE mean_exec_time > $1
    ORDER BY mean_exec_time DESC
    LIMIT 20
`
```

---

## 20. Best Practices

1. **Always use raw strings for regex** — much easier to read and compare with documentation
2. **Use raw strings for SQL** — queries are cleaner and can be copy-pasted to database tools
3. **Use `strings.TrimSpace`** on raw strings that start with an indented newline
4. **Don't mix raw and interpreted** for the same logical content
5. **Put SQL constants in a separate file** to keep business logic clean
6. **Use raw strings in test fixtures** to embed expected JSON/YAML/HTML
7. **Document the encoding** if a raw string has platform-specific content

---

## 21. Edge Cases & Pitfalls

```go
// Pitfall 1: Trailing whitespace in raw strings
query := `SELECT * FROM users   `
//                              ^^^ 3 trailing spaces — are they intentional?

// Pitfall 2: Windows source with CRLF — carriage returns are stripped
// Good for portability, but may surprise if you're debugging line endings

// Pitfall 3: Raw string as map key — fine, but rare and confusing
m := map[string]int{
    `key\n`: 1,  // key is literally "key\n" (5 chars), not "key" + newline
}
fmt.Println(m[`key\n`])  // 1 ✓
fmt.Println(m["key\n"])  // 0 — different key (4 chars with real newline)

// Pitfall 4: Raw string in struct tag — does NOT work!
// Struct tags in Go use the backtick syntax themselves,
// so you CANNOT use a raw string for a struct tag value
// (the backtick starts the TAG, not a raw string literal in that context)
type User struct {
    Name string `json:"name"` // backticks here delimit the struct tag
}
```

---

## 22. Common Mistakes

```go
// Mistake 1: Expecting \n to be a newline in raw string
msg := `Hello\nWorld`
lines := strings.Split(msg, "\n")
fmt.Println(len(lines)) // 1, not 2!
// \n in raw string = two characters, not newline

// Mistake 2: Not accounting for leading newline in raw strings
template := `
{{.Name}} has logged in.`
// template starts with a newline! Trim it:
template = strings.TrimLeft(template, "\n")

// Mistake 3: Trying to concatenate raw strings thinking it removes the backtick issue
// code := `He used ` "`" ` backtick`  // syntax error
// Correct: code := `He used ` + "`" + ` backtick`
```

---

## 23. Common Misconceptions

| Misconception | Reality |
|--------------|---------|
| Raw strings are slower | Identical runtime performance |
| `\n` in raw string acts as newline | It's two characters: `\` and `n` |
| You can use raw strings for struct tags | No — backtick is the struct tag delimiter |
| Raw strings handle Unicode escapes | No — all escapes are ignored |
| Go raw strings are like JavaScript template literals | No interpolation in Go raw strings |

---

## 24. Tricky Points

```go
// Tricky 1: Raw string in const is still a raw string
const pattern = `\d+`  // const — raw string value, not special

// Tricky 2: len() of a raw string with embedded newlines
s := `a
b`
fmt.Println(len(s)) // 3: 'a', '\n', 'b'

// Tricky 3: Empty raw string
s := ``  // valid empty string
fmt.Println(s == "") // true

// Tricky 4: Raw string with only whitespace
s2 := `   `  // 3 spaces — not empty!
fmt.Println(len(s2)) // 3
```

---

## 25. Test

```go
package rawstring_test

import (
    "regexp"
    "strings"
    "testing"
)

func TestRawStringContent(t *testing.T) {
    s := `Hello\nWorld`
    if strings.Count(s, "\n") != 0 {
        t.Error("raw string should not contain newlines from \\n")
    }
    if len(s) != 12 {
        t.Errorf("expected length 12, got %d", len(s))
    }
}

func TestRawStringMultiline(t *testing.T) {
    s := `line1
line2
line3`
    lines := strings.Split(s, "\n")
    if len(lines) != 3 {
        t.Errorf("expected 3 lines, got %d", len(lines))
    }
}

func TestRegexFromRawString(t *testing.T) {
    re := regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
    valid := []string{"2024-01-15", "1999-12-31"}
    invalid := []string{"24-1-15", "2024/01/15"}

    for _, s := range valid {
        if !re.MatchString(s) {
            t.Errorf("expected %q to match date pattern", s)
        }
    }
    for _, s := range invalid {
        if re.MatchString(s) {
            t.Errorf("expected %q to not match date pattern", s)
        }
    }
}
```

---

## 26. Tricky Questions

**Q: What is the difference between `"\n"` and `` `\n` `` in Go?**
A: `"\n"` is a single newline character (byte 0x0A, length 1). `` `\n` `` is a two-character string: backslash followed by 'n' (bytes 0x5C 0x6E, length 2).

**Q: If a Go source file uses Windows line endings (CRLF), what does a raw string literal's newline contain?**
A: Only LF (`\n`, 0x0A). The Go compiler strips `\r` from raw string literals, making them portable across platforms.

**Q: Can you use raw string literals as struct tag values?**
A: No. Struct tags are delimited by backticks in Go syntax — the backtick already has meaning in that context. Struct tag values are always interpreted as regular strings.

**Q: Is `` regexp.MustCompile(`\d+`) `` equivalent to `regexp.MustCompile("\\d+")`?**
A: Yes. Both create a regexp matching one or more digits. The raw string `` `\d+` `` passes the two characters `\` and `d` to the regex engine, which interprets `\d` as "any digit". The interpreted string `"\\d+"` also passes `\` and `d` (the `\\` escape becomes a single backslash).

---

## 27. Cheat Sheet

```go
// Syntax
s := `any content here`

// Key properties
// ✓ No escape processing
// ✓ Can span multiple lines (literal newlines included)
// ✗ Cannot contain backtick character
// ✗ Carriage returns (\r) are removed by Go compiler

// Backtick workaround
s := `before` + "`" + `after`

// Common uses
regex := `^\d{4}-\d{2}-\d{2}$`

query := `
    SELECT *
    FROM users
    WHERE id = $1
`

json := `{"key": "value"}`
path := `C:\Users\Alice\Documents`
helpText := `
Usage: program [options]
  -v  verbose output
  -h  show help
`

// Clean up indentation
clean := strings.TrimSpace(indentedRaw)
```

---

## 28. Self-Assessment Checklist

- [ ] I know when raw strings are preferable over interpreted strings
- [ ] I understand the carriage-return stripping behavior
- [ ] I can implement a Dedent helper for indented raw strings
- [ ] I understand why struct tags can't use raw string values
- [ ] I know how to include a backtick in a "raw-like" string
- [ ] I use raw strings for all non-trivial regex patterns
- [ ] I understand that Go raw strings lack interpolation (unlike JS template literals)
- [ ] I can compare Go raw strings with equivalent features in other languages

---

## 29. Summary

Raw string literals are Go's tool for writing strings that should be taken literally. The key insights at the middle level:
- Use them whenever backslashes appear (regex, Windows paths)
- Use them for any multiline text (SQL, JSON, HTML, config)
- Remember that indentation becomes part of the string — use `strings.TrimSpace` or `Dedent`
- They're not "raw" in the sense of being different at runtime — only in terms of source code representation

---

## 30. Further Reading

- [Go Spec: String literals](https://go.dev/ref/spec#String_literals)
- [regexp.MustCompile documentation](https://pkg.go.dev/regexp#MustCompile)
- [RE2 syntax reference](https://github.com/google/re2/wiki/Syntax)
- [text/template](https://pkg.go.dev/text/template)
- [Python raw strings for comparison](https://docs.python.org/3/reference/lexical_analysis.html#string-and-bytes-literals)

---

## 31. Related Topics

- Interpreted string literals — the double-quote alternative
- `regexp` package — where raw strings are most critical
- `text/template` and `html/template` — use raw strings for templates
- `strings.TrimSpace` — cleaning up indented raw strings
- SQL query builders — raw strings make SQL readable

---

## 32. Diagrams & Visual Aids

### Source Code vs Runtime Content

```
Source file content            Runtime string value
──────────────────             ────────────────────

`\d+`                    →     \d+   (2 chars: backslash, d)

`line1\nline2`           →     line1\nline2  (12 chars, NO newline)

`line1                   →     line1
line2`                         line2  (11 chars, real newline preserved)

`C:\Users\Name`          →     C:\Users\Name  (14 chars, real backslashes)
```

### When to Choose Which

```
Does the string contain backslashes?
├── Yes → Use raw string ` ` (simpler: `\d+` vs "\\d+")
└── No  → Either works

Does it need to span multiple lines?
├── Yes → Use raw string ` ` (natural)
│         OR use interpreted with \n
└── No  → Either works

Does it contain a backtick?
├── Yes → MUST use interpreted " "
└── No  → Either works

Does it need escape sequences (\n, \t, \x)?
├── Yes → MUST use interpreted " " for those chars
└── No  → Either works
```
