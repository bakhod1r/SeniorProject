# Raw String Literals in Go — Optimization Exercises

## Exercise 1: Compile Regex Once Instead of Per Call

**Slow Version:**
```go
package main

import (
    "fmt"
    "regexp"
)

func validateInput(inputs []string) []bool {
    results := make([]bool, len(inputs))
    for i, s := range inputs {
        // Compiled on EVERY iteration!
        re := regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
        results[i] = re.MatchString(s)
    }
    return results
}

func main() {
    emails := make([]string, 10000)
    for i := range emails {
        emails[i] = fmt.Sprintf("user%d@example.com", i)
    }
    fmt.Println(validateInput(emails)[0])
}
```

**Task**: Optimize so the regex is only compiled once.

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "regexp"
)

// Compiled once at package initialization — zero cost per call
var emailRe = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

func validateInput(inputs []string) []bool {
    results := make([]bool, len(inputs))
    for i, s := range inputs {
        results[i] = emailRe.MatchString(s) // just matching, no compilation
    }
    return results
}

func main() {
    emails := make([]string, 10000)
    for i := range emails {
        emails[i] = fmt.Sprintf("user%d@example.com", i)
    }
    fmt.Println(validateInput(emails)[0])
}

// Benchmark improvement:
// Before: ~10,000 * 10µs = 100ms (10,000 compilations)
// After:  ~10,000 * 200ns = 2ms (matching only)
// Speedup: ~50x
```
</details>

---

## Exercise 2: Pre-process Indented Raw String Constant

**Slow Version (inefficient per-call processing):**
```go
package main

import "strings"

const rawTemplate = `
    Dear {{name}},

    Your order {{order}} has shipped.

    Thanks,
    Support
`

func renderEmail(name, order string) string {
    // TrimSpace called on every render
    template := strings.TrimSpace(rawTemplate)
    // More processing...
    template = strings.ReplaceAll(template, "{{name}}", name)
    template = strings.ReplaceAll(template, "{{order}}", order)
    return template
}
```

**Task**: Optimize so the template is processed once, not on every call.

<details>
<summary>Solution</summary>

```go
package main

import "strings"

// Process the raw string once at package init
var emailTemplate = strings.TrimSpace(`
    Dear {{name}},

    Your order {{order}} has shipped.

    Thanks,
    Support
`)

// Pre-process a "dedented" version that's ready to use
func init() {
    // Could also apply Dedent here if needed
    _ = emailTemplate  // already processed above
}

func renderEmail(name, order string) string {
    // Template is already trimmed — no processing overhead per call
    result := strings.ReplaceAll(emailTemplate, "{{name}}", name)
    result = strings.ReplaceAll(result, "{{order}}", order)
    return result
}

// Even better: use text/template which pre-processes the template structure
import "text/template"

var emailTmpl = template.Must(template.New("email").Parse(strings.TrimSpace(`
    Dear {{.Name}},

    Your order {{.Order}} has shipped.

    Thanks,
    Support
`)))

func renderEmailFast(name, order string) string {
    var b strings.Builder
    emailTmpl.Execute(&b, struct{ Name, Order string }{name, order})
    return b.String()
}
```
</details>

---

## Exercise 3: Avoid Converting Interpreted to Raw at Runtime

**Slow/Wrong Version:**
```go
package main

import (
    "fmt"
    "strings"
)

func makeRaw(s string) string {
    // Developer tries to "make a raw string" by removing escape processing
    // This is fundamentally wrong but represents common confusion
    result := strings.ReplaceAll(s, "\n", `\n`)
    result = strings.ReplaceAll(result, "\t", `\t`)
    result = strings.ReplaceAll(result, "\\", `\\`)
    return result
}

func main() {
    s := "Hello\nWorld\t!"
    fmt.Println(makeRaw(s))  // "Hello\nWorld\t!"
    fmt.Println(len(makeRaw(s))) // 16, not 14
}
```

**Task**: Explain the fundamental mistake and show the correct approach.

<details>
<summary>Solution</summary>

```go
// The fundamental mistake: "raw string" is a SOURCE CODE concept, not a runtime concept.
// You cannot "convert" a runtime string to a raw string — they're identical at runtime.

// What makeRaw() actually does: escape the special characters so they're PRINTABLE
// This is called "quoting" or "escaping" — use fmt.Sprintf("%q", s) for this

package main

import (
    "fmt"
    "strconv"
)

func main() {
    s := "Hello\nWorld\t!"

    // If you want to DISPLAY the string showing escape sequences:
    fmt.Printf("%q\n", s)           // "Hello\nWorld\t!" — shows as quoted literal
    fmt.Println(strconv.Quote(s))   // "Hello\nWorld\t!" — same

    // If you want to STORE it in a way that preserves the escape sequence text:
    // (e.g., to write it to a file as source code)
    quoted := strconv.Quote(s)
    fmt.Println(quoted) // "Hello\nWorld\t!" with real quotes

    // The CORRECT understanding:
    // Raw string ` ` is a compile-time notation
    // At runtime, all strings are just byte slices
    // There's no difference between a "raw" and "interpreted" string at runtime

    rawInSource := `Hello\nWorld` // compile-time raw string
    interpInSource := "Hello\\nWorld" // compile-time interpreted string
    fmt.Println(rawInSource == interpInSource) // true — same runtime value
}
```
</details>

---

## Exercise 4: Replace String Builder with Template for Multi-Variable Raw Template

**Slow Version:**
```go
package main

import (
    "fmt"
    "strings"
)

func generateReport(title, author string, count int, items []string) string {
    // Manual string building — error-prone and slow
    result := "# " + title + "\n"
    result += "Author: " + author + "\n"
    result += fmt.Sprintf("Total: %d items\n\n", count)
    result += "## Items\n"
    for i, item := range items {
        result += fmt.Sprintf("%d. %s\n", i+1, item)
    }
    return result
}
```

**Task**: Use a raw string template with `text/template` for a cleaner and more maintainable solution.

<details>
<summary>Solution</summary>

```go
package main

import (
    "strings"
    "text/template"
)

// Raw string template — readable, version-controllable, separable
const reportTemplate = `# {{.Title}}
Author: {{.Author}}
Total: {{.Count}} items

## Items
{{range $i, $item := .Items}}{{add $i 1}}. {{$item}}
{{end}}`

var reportTmpl = template.Must(
    template.New("report").
        Funcs(template.FuncMap{
            "add": func(a, b int) int { return a + b },
        }).
        Parse(reportTemplate),
)

type ReportData struct {
    Title  string
    Author string
    Count  int
    Items  []string
}

func generateReport(title, author string, items []string) string {
    var b strings.Builder
    b.Grow(256) // pre-allocate approximate size
    reportTmpl.Execute(&b, ReportData{
        Title:  title,
        Author: author,
        Count:  len(items),
        Items:  items,
    })
    return b.String()
}

// Benefits over string concatenation:
// 1. Template structure is visible and readable
// 2. One compilation of the template (not per call)
// 3. Easier to modify the format
// 4. Can be moved to a file with go:embed
```
</details>

---

## Exercise 5: Use regexp.FindAllStringSubmatch Instead of Multiple Matches

**Slow Version:**
```go
package main

import (
    "fmt"
    "regexp"
)

func extractFields(text string) (date, time, level, msg string) {
    dateRe := regexp.MustCompile(`\d{4}-\d{2}-\d{2}`)
    timeRe := regexp.MustCompile(`\d{2}:\d{2}:\d{2}`)
    levelRe := regexp.MustCompile(`(INFO|WARN|ERROR|DEBUG)`)
    msgRe := regexp.MustCompile(`:\s+(.+)$`)

    if m := dateRe.FindString(text); m != "" {
        date = m
    }
    if m := timeRe.FindString(text); m != "" {
        time = m
    }
    if m := levelRe.FindStringSubmatch(text); m != nil {
        level = m[1]
    }
    if m := msgRe.FindStringSubmatch(text); m != nil {
        msg = m[1]
    }
    return
}
```

**Task**: Combine into a single regex with named capture groups for efficiency and clarity.

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "regexp"
)

// Single pass through the string with named capture groups
// Raw string makes the complex pattern readable
var logRe = regexp.MustCompile(
    `(?P<date>\d{4}-\d{2}-\d{2})\s+` +
    `(?P<time>\d{2}:\d{2}:\d{2})\s+` +
    `(?P<level>INFO|WARN|ERROR|DEBUG):\s+` +
    `(?P<msg>.+)$`,
)

// Or as a single raw string (harder to read but single line):
var logReSingle = regexp.MustCompile(
    `(?P<date>\d{4}-\d{2}-\d{2})\s+(?P<time>\d{2}:\d{2}:\d{2})\s+(?P<level>INFO|WARN|ERROR|DEBUG):\s+(?P<msg>.+)$`,
)

func extractFields(text string) (date, time, level, msg string) {
    m := logRe.FindStringSubmatch(text)
    if m == nil {
        return
    }
    // Use named group indices for clean access
    names := logRe.SubexpNames()
    for i, name := range names {
        switch name {
        case "date":  date = m[i]
        case "time":  time = m[i]
        case "level": level = m[i]
        case "msg":   msg = m[i]
        }
    }
    return
}

func main() {
    date, time, level, msg := extractFields("2024-01-15 10:30:45 ERROR: connection refused")
    fmt.Printf("date=%s time=%s level=%s msg=%s\n", date, time, level, msg)
}

// Benefits:
// 1. Single regex pass (4x fewer passes through the string)
// 2. Named groups make code self-documenting
// 3. One compilation (package-level)
```
</details>

---

## Exercise 6: Pre-build Complex SQL with Query Constants

**Slow Version:**
```go
package main

import "fmt"

func buildUserQuery(withEmail, withOrders bool, limit int) string {
    query := "SELECT u.id, u.name"
    if withEmail {
        query += ", u.email"
    }
    if withOrders {
        query += ", COUNT(o.id) as order_count"
    }
    query += " FROM users u"
    if withOrders {
        query += " LEFT JOIN orders o ON u.id = o.user_id"
    }
    query += fmt.Sprintf(" WHERE u.deleted_at IS NULL GROUP BY u.id LIMIT %d", limit)
    return query
}
```

**Task**: Optimize by defining the query variants as raw string constants.

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

// Pre-defined query variants as raw string constants
// Avoids runtime string building for known combinations
const (
    queryBasic = `
        SELECT u.id, u.name
        FROM users u
        WHERE u.deleted_at IS NULL
        GROUP BY u.id
        LIMIT $1
    `

    queryWithEmail = `
        SELECT u.id, u.name, u.email
        FROM users u
        WHERE u.deleted_at IS NULL
        GROUP BY u.id
        LIMIT $1
    `

    queryWithOrders = `
        SELECT u.id, u.name, COUNT(o.id) as order_count
        FROM users u
        LEFT JOIN orders o ON u.id = o.user_id
        WHERE u.deleted_at IS NULL
        GROUP BY u.id
        LIMIT $1
    `

    queryWithEmailAndOrders = `
        SELECT u.id, u.name, u.email, COUNT(o.id) as order_count
        FROM users u
        LEFT JOIN orders o ON u.id = o.user_id
        WHERE u.deleted_at IS NULL
        GROUP BY u.id
        LIMIT $1
    `
)

func getUserQuery(withEmail, withOrders bool) string {
    switch {
    case withEmail && withOrders:
        return queryWithEmailAndOrders
    case withEmail:
        return queryWithEmail
    case withOrders:
        return queryWithOrders
    default:
        return queryBasic
    }
}

// Benefits:
// 1. No runtime string building (queries are .rodata constants)
// 2. Queries are readable in their final form
// 3. Easy to review and optimize each query independently
// 4. No fmt.Sprintf with limit (use parameterized $1 instead)
_ = fmt.Sprintf // hint for original
```
</details>

---

## Exercise 7: Avoid String Escaping by Using Raw String for JSON

**Slow Version:**
```go
package main

import "fmt"

func buildJSONBody(name, email string, age int) string {
    // Interpreted string: must escape quotes
    return fmt.Sprintf("{\"name\": \"%s\", \"email\": \"%s\", \"age\": %d}",
        name, email, age)
}

func main() {
    body := buildJSONBody("Alice", "alice@example.com", 30)
    fmt.Println(body)
}
```

**Task**: Use a raw string template for the JSON structure.

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

// Raw string template — much more readable
const userJSONTemplate = `{"name": "%s", "email": "%s", "age": %d}`

func buildJSONBody(name, email string, age int) string {
    return fmt.Sprintf(userJSONTemplate, name, email, age)
}

// Even better: use encoding/json for proper escaping
import "encoding/json"

type User struct {
    Name  string `json:"name"`
    Email string `json:"email"`
    Age   int    `json:"age"`
}

func buildJSONBodySafe(name, email string, age int) (string, error) {
    u := User{Name: name, Email: email, Age: age}
    data, err := json.Marshal(u)
    if err != nil {
        return "", err
    }
    return string(data), nil
}

// Note: the fmt.Sprintf version is NOT safe if name/email contain quotes!
// "Alice \"the hacker\"" would produce invalid JSON.
// encoding/json handles escaping correctly.
```
</details>

---

## Exercise 8: Lazy vs Eager Template Parsing

**Slow Version:**
```go
package main

import (
    "strings"
    "text/template"
)

// Template is parsed on every call to SendEmail
func SendEmail(to, name string) error {
    tmpl := template.Must(template.New("email").Parse(`
Dear {{.Name}},

Thank you for registering!

Best,
The Team
`))
    var b strings.Builder
    return tmpl.Execute(&b, struct{ Name string }{name})
}
```

**Task**: Parse the template once at initialization.

<details>
<summary>Solution</summary>

```go
package main

import (
    "strings"
    "text/template"
)

// Parse once at package initialization
var welcomeEmailTmpl = template.Must(template.New("email").Parse(`Dear {{.Name}},

Thank you for registering!

Best,
The Team
`))

func SendEmail(to, name string) error {
    var b strings.Builder
    if err := welcomeEmailTmpl.Execute(&b, struct{ Name string }{name}); err != nil {
        return err
    }
    body := b.String()
    _ = body
    // send body to 'to' address
    return nil
}

// Benchmark improvement:
// Before: template.Parse on every SendEmail call (~5µs each)
// After: 0 parse cost per call, only template.Execute (~500ns)
// For 10,000 emails: 50ms → 5ms (10x faster)
```
</details>

---

## Exercise 9: Reduce String Copies When Testing with Raw String Fixtures

**Slow Version:**
```go
package main

import (
    "encoding/json"
    "testing"
)

func TestProcessJSON(t *testing.T) {
    // This allocates a []byte copy for each test case
    inputs := []string{
        "{\"name\": \"Alice\", \"age\": 30}",
        "{\"name\": \"Bob\", \"age\": 25}",
        "{\"name\": \"Charlie\", \"age\": 35}",
    }
    for _, input := range inputs {
        var m map[string]interface{}
        if err := json.Unmarshal([]byte(input), &m); err != nil {
            t.Errorf("failed to parse %q: %v", input, err)
        }
    }
}
```

**Task**: Use raw strings for better readability and reduce conversion overhead.

<details>
<summary>Solution</summary>

```go
package main

import (
    "encoding/json"
    "testing"
)

// Raw strings are more readable for JSON test fixtures
// and avoid the need for escaped quotes
func TestProcessJSON(t *testing.T) {
    inputs := []string{
        `{"name": "Alice", "age": 30}`,   // raw string: no escaping needed
        `{"name": "Bob", "age": 25}`,
        `{"name": "Charlie", "age": 35}`,
    }

    for _, input := range inputs {
        var m map[string]interface{}
        if err := json.Unmarshal([]byte(input), &m); err != nil {
            t.Errorf("failed to parse %q: %v", input, err)
        }
    }
}

// For large fixtures, use package-level constants to share the data
const largeJSONFixture = `{
    "users": [
        {"id": 1, "name": "Alice"},
        {"id": 2, "name": "Bob"}
    ],
    "total": 2
}`

// Reuse across test functions without re-allocating
func TestLargeFixture(t *testing.T) {
    var result struct {
        Users []struct {
            ID   int    `json:"id"`
            Name string `json:"name"`
        } `json:"users"`
        Total int `json:"total"`
    }
    if err := json.Unmarshal([]byte(largeJSONFixture), &result); err != nil {
        t.Fatal(err)
    }
    if result.Total != 2 {
        t.Errorf("expected total=2, got %d", result.Total)
    }
}
```
</details>

---

## Exercise 10: Compile-Time Pattern Validation

**Current Version (runtime failure):**
```go
package main

import (
    "fmt"
    "regexp"
)

// These patterns are only validated at runtime when MustCompile runs
var patterns = []string{
    `^\d{3}-\d{4}$`,
    `^[a-z]+$`,
    `^(\d{1,3}\.){3}\d{1,3}$`,
}

func compilePatterns() []*regexp.Regexp {
    result := make([]*regexp.Regexp, len(patterns))
    for i, p := range patterns {
        result[i] = regexp.MustCompile(p) // PANICS if any pattern is invalid!
    }
    return result
}
```

**Task**: Restructure to use package-level variables so patterns are validated at startup, and failures are immediately visible.

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "regexp"
)

// Define each pattern as a named package-level variable
// This validates them at program startup, not lazily
// If any pattern is invalid, the program panics immediately on startup
// (not buried in a call to compilePatterns())
var (
    // Phone number: 123-4567
    phoneRe = regexp.MustCompile(`^\d{3}-\d{4}$`)

    // Lowercase word
    lowerWordRe = regexp.MustCompile(`^[a-z]+$`)

    // IPv4 address
    ipv4Re = regexp.MustCompile(`^(\d{1,3}\.){3}\d{1,3}$`)
)

// Each pattern is now:
// 1. Named (self-documenting)
// 2. Compiled once at startup
// 3. Immediately accessible without function calls
// 4. Validated at program start (not lazily)

func main() {
    fmt.Println(phoneRe.MatchString("555-1234"))      // true
    fmt.Println(lowerWordRe.MatchString("hello"))     // true
    fmt.Println(ipv4Re.MatchString("192.168.1.1"))    // true
}

// For test packages: use TestMain to ensure patterns are valid before any test runs
// The panic from MustCompile will fail the test with a clear error
```
</details>
