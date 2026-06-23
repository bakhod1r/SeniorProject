# Raw String Literals in Go — Find the Bug

## Bug 1: Expecting \n to Be a Newline

```go
package main

import (
    "fmt"
    "strings"
)

func countLines(text string) int {
    // Count lines in the text
    return len(strings.Split(text, "\n"))
}

func main() {
    message := `Hello\nWorld\nGoodbye`
    lines := countLines(message)
    fmt.Printf("Found %d lines\n", lines) // expects 3
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What does `\n` mean in a raw string literal (backtick string)? Is it a newline character or two separate characters?
</details>

<details>
<summary>Solution</summary>

**Bug**: `message` is a raw string literal, so `\n` is NOT a newline character — it's the two characters backslash and 'n'. The string `message` is a single line: `Hello\nWorld\nGoodbye` (20 characters). `strings.Split` on `"\n"` (real newline) finds no matches and returns a 1-element slice.

**Fix**: Either use an interpreted string if you want escape sequences:
```go
message := "Hello\nWorld\nGoodbye"  // 3 actual lines
```
Or use a raw string with actual newlines:
```go
message := `Hello
World
Goodbye`  // 3 actual lines
```
</details>

---

## Bug 2: SQL Query with Unexpected Leading Whitespace

```go
package main

import (
    "fmt"
    "strings"
)

func getQuery() string {
    return `
        SELECT id, name
        FROM users
        WHERE active = true
    `
}

func main() {
    query := getQuery()
    // Check if query starts with SELECT
    if strings.HasPrefix(query, "SELECT") {
        fmt.Println("Valid query")
    } else {
        fmt.Println("Query format check failed") // This runs!
    }
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
The raw string starts immediately after the opening backtick. What is the first character in this raw string?
</details>

<details>
<summary>Solution</summary>

**Bug**: The raw string starts with a newline followed by 8 spaces before "SELECT". `strings.HasPrefix(query, "SELECT")` is false because the string begins with `\n        ` (newline + 8 spaces).

**Fix**: Use `strings.TrimSpace` before checking, or restructure the raw string:
```go
func getQuery() string {
    return strings.TrimSpace(`
        SELECT id, name
        FROM users
        WHERE active = true
    `)
}
// Now the string starts with "SELECT"
```

Or for a clean string at all levels:
```go
func getQuery() string {
    return `SELECT id, name
FROM users
WHERE active = true`
}
```
</details>

---

## Bug 3: Regex Escaped Wrong

```go
package main

import (
    "fmt"
    "regexp"
)

// Match strings like "v1.2.3" (semantic version simplified)
func isVersion(s string) bool {
    re := regexp.MustCompile(`^v\d+\\.\d+\\.\d+$`)
    return re.MatchString(s)
}

func main() {
    fmt.Println(isVersion("v1.2.3"))   // should be true
    fmt.Println(isVersion("v10.20.30")) // should be true
    fmt.Println(isVersion("v1x2x3"))   // should be false
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
In a raw string, `\\` is two characters: two backslashes. What does `\\.` mean to the regex engine?
</details>

<details>
<summary>Solution</summary>

**Bug**: In the raw string `` `^v\d+\\.\d+\\.\d+$` ``, the `\\.` passes two characters to the regex: `\\` (literal backslash in regex) and `.` (any character). The pattern requires a literal backslash before the dot, so `v1.2.3` won't match (no backslash), but `v1\.2\.3` would match!

In raw strings, `\.` is already the correct regex for "literal dot" — one backslash, one dot, passed as-is to the regex engine.

**Fix**:
```go
re := regexp.MustCompile(`^v\d+\.\d+\.\d+$`)
// Now \. correctly means "literal dot" in the regex
```

Comparison:
- Raw `` `\.` `` → passes `\.` to regex → matches literal dot ✓
- Raw `` `\\.` `` → passes `\\.` to regex → matches backslash then any char ✗
- Interpreted `"\\."` → passes `\.` to regex → matches literal dot ✓
</details>

---

## Bug 4: Struct Tag Syntax Error

```go
package main

import (
    "encoding/json"
    "fmt"
)

type User struct {
    ID    int    `json:"id"`
    Name  string // TODO: add json tag using raw string
}

func addTag() {
    // Trying to print what the tag should look like
    tag := `json:"name"`
    fmt.Println("The tag should be:", tag)

    // Now trying to use raw string as struct tag value — but this won't compile:
    // type Broken struct {
    //     Name string `json:"name"`  // This is fine (backticks delimit the tag)
    //     // Name string `+`json:"name"`+` // This doesn't work
    // }
}

func main() {
    u := User{ID: 1, Name: "Alice"}
    data, _ := json.Marshal(u)
    fmt.Println(string(data)) // {"id":1,"Name":"Alice"} — Name not lowercased!
    addTag()
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Look at the JSON output. Why is `"Name"` capitalized in the JSON output even though the intent was `"name"`? What's missing from the struct definition?
</details>

<details>
<summary>Solution</summary>

**Bug**: The `Name` field in the `User` struct has no `json` tag, so it uses the default marshaling behavior, which preserves the Go field name (capitalized `"Name"`).

The comment in the code shows confusion about raw strings and struct tags. Struct tags CANNOT be written using raw string syntax at the point of use — they're part of the struct field syntax and are always delimited by backticks in Go struct definitions.

**Fix**: Add the json struct tag to the Name field:
```go
type User struct {
    ID    int    `json:"id"`
    Name  string `json:"name"`  // backticks here are struct tag delimiters, not raw strings
}
```

Now `json.Marshal` produces `{"id":1,"name":"Alice"}`.
</details>

---

## Bug 5: Using \t Expecting a Tab

```go
package main

import "fmt"

func formatTable(rows [][]string) string {
    result := ""
    for _, row := range rows {
        for i, cell := range row {
            if i > 0 {
                result += `\t`  // expects tab separator
            }
            result += cell
        }
        result += `\n`  // expects newline
    }
    return result
}

func main() {
    rows := [][]string{
        {"Name", "Age", "City"},
        {"Alice", "30", "NYC"},
        {"Bob", "25", "LA"},
    }
    fmt.Println(formatTable(rows))
    // Expected: tab-separated columns with newlines between rows
    // Got: \t and \n as literal characters!
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What is `` `\t` `` in Go? Is it a tab character or something else?
</details>

<details>
<summary>Solution</summary>

**Bug**: `` `\t` `` and `` `\n` `` are raw string literals containing literal backslash-t and backslash-n (2 characters each), NOT tab and newline characters. So the "separator" is literally `\t` text and lines aren't separated by real newlines.

**Fix**: Use interpreted string literals for escape sequences:
```go
func formatTable(rows [][]string) string {
    result := ""
    for _, row := range rows {
        for i, cell := range row {
            if i > 0 {
                result += "\t"  // actual tab character
            }
            result += cell
        }
        result += "\n"  // actual newline
    }
    return result
}
```
</details>

---

## Bug 6: Concatenating Backtick Into Raw String

```go
package main

import "fmt"

func formatCode(code string) string {
    // Wants to produce: `code here`
    return `\`` + code + `\``  // trying to escape backtick
}

func main() {
    result := formatCode("x := 42")
    fmt.Println(result)
    // Expected: `x := 42`
    // Got: \`x := 42\` (literal backslash-backtick!)
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
In a raw string, what does `\`` mean? Remember: in raw strings, backslash has no special meaning.
</details>

<details>
<summary>Solution</summary>

**Bug**: In raw string literals, backslash has no special meaning. So `` `\`` `` is a raw string containing two characters: backslash and backtick. This is also INVALID — the backtick would end the raw string! This actually causes a compile error (` + `` + ` would be parsed as an empty raw string followed by syntax).

Actually the correct analysis: `` `\`` `` is a raw string `` ` `` containing one character `\`, followed by the closing backtick. Then the rest of the expression `` + code + `` `` tries to start another raw string. This creates a syntax mess.

**Fix**: Use regular string concatenation with a simple string containing the backtick:
```go
func formatCode(code string) string {
    backtick := "`"
    return backtick + code + backtick
    // Or: return "`" + code + "`"
}
```
</details>

---

## Bug 7: Regex Pattern Not Compiled at Package Level

```go
package main

import (
    "fmt"
    "regexp"
)

func isValidEmail(email string) bool {
    // Compiles the regex on EVERY call!
    re := regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
    return re.MatchString(email)
}

func main() {
    emails := []string{
        "user@example.com",
        "invalid-email",
        "another@test.org",
    }
    for _, e := range emails {
        fmt.Printf("%s: %v\n", e, isValidEmail(e))
    }
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
`regexp.MustCompile` is not free — it parses and compiles the pattern into a DFA. What happens when you call `isValidEmail` 100,000 times?
</details>

<details>
<summary>Solution</summary>

**Bug**: `regexp.MustCompile` is called on every invocation of `isValidEmail`. Each call takes ~10 microseconds and allocates memory. For 100,000 calls, this is 1 second of wasted CPU and significant GC pressure.

**Fix**: Compile once at package initialization time:
```go
// Package-level variable — compiled once when package is loaded
var emailRe = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

func isValidEmail(email string) bool {
    return emailRe.MatchString(email)
}
```

The raw string itself has no performance cost — only `regexp.MustCompile` is expensive.
</details>

---

## Bug 8: Testing Raw vs Interpreted Equality

```go
package main

import "fmt"

func main() {
    raw := `Hello\nWorld`
    interpreted := "Hello\nWorld"

    fmt.Println(raw == interpreted)      // false — but why?
    fmt.Println(len(raw))                // 12
    fmt.Println(len(interpreted))        // 11

    // BUG: developer assumes these are the same and writes:
    if raw == interpreted {
        fmt.Println("strings are equal")
    } else {
        fmt.Println("strings are different") // this runs
    }
    // Test then fails because the strings are not equal
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Print both strings with `%q` to see their exact contents. Are `\n` and newline the same character?
</details>

<details>
<summary>Solution</summary>

**Bug**: The developer assumed `` `Hello\nWorld` `` and `"Hello\nWorld"` are the same string. They're not:
- `` `Hello\nWorld` `` = 12 bytes: H e l l o \ n W o r l d (backslash + n)
- `"Hello\nWorld"` = 11 bytes: H e l l o LF W o r l d (actual newline)

Diagnose with `%q`:
```go
fmt.Printf("%q\n", raw)         // "Hello\\nWorld"
fmt.Printf("%q\n", interpreted) // "Hello\nWorld"
```

**Fix**: If you want a newline in a raw string, press Enter:
```go
raw := `Hello
World`
```
Or use an interpreted string with `\n`:
```go
interpreted := "Hello\nWorld"
```
</details>

---

## Bug 9: Raw String with Invisible Whitespace

```go
package main

import (
    "fmt"
    "strings"
)

const configTemplate = `
database:
  host: {{.Host}}
  port: {{.Port}}
  name: {{.Name}}
`
// Note: there is a tab character at the end of the "port" line above

func validateYAML(s string) bool {
    lines := strings.Split(strings.TrimSpace(s), "\n")
    for _, line := range lines {
        // Check for trailing whitespace (YAML linters flag this)
        if line != strings.TrimRight(line, " \t") {
            return false
        }
    }
    return true
}

func main() {
    fmt.Println(validateYAML(configTemplate)) // false — but why?
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Look very carefully at the end of the `port` line in the raw string. What might be hiding there that's not visible?
</details>

<details>
<summary>Solution</summary>

**Bug**: The `port` line in the raw string has a trailing tab character (`\t`) that's invisible in most editors. Raw strings preserve ALL characters, including invisible ones like trailing tabs and spaces. The YAML validator detects this and returns false.

This is one of the most insidious raw string bugs — invisible characters are preserved exactly.

**Diagnose**:
```go
for i, line := range strings.Split(configTemplate, "\n") {
    fmt.Printf("line %d: %q\n", i, line)
}
// Will show: "  port: {{.Port}}\t"
```

**Fix**: Remove the invisible trailing whitespace in the raw string. Most editors can show/remove trailing whitespace. Use `strings.TrimRight(line, " \t")` as a post-processing step if this is a recurring issue.
</details>

---

## Bug 10: Confusing Raw String with os.Args

```go
package main

import (
    "fmt"
    "os"
    "regexp"
)

func main() {
    if len(os.Args) < 2 {
        fmt.Println("Usage: prog <pattern>")
        return
    }

    // User provides pattern from command line
    userPattern := os.Args[1]

    // Bug: wrapping user input in raw string delimiters
    // This is NOT how raw strings work — you can't "make" a raw string at runtime
    pattern := fmt.Sprintf("`%s`", userPattern)
    fmt.Printf("Pattern string: %s\n", pattern)

    // This tries to use the pattern WITH the backtick characters!
    re, err := regexp.Compile(pattern)
    if err != nil {
        fmt.Printf("Error: %v\n", err) // error: invalid character at start
        return
    }
    fmt.Println(re.MatchString("test"))
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Raw strings are a compile-time concept. Can you create a "raw string" by wrapping a value in backtick characters at runtime?
</details>

<details>
<summary>Solution</summary>

**Bug**: The developer thinks wrapping a string in backticks at runtime creates a "raw string." This is wrong — raw string literal is a **compile-time** concept only. At runtime, a string is just bytes. Adding backtick characters to the string with `fmt.Sprintf("`%s`", userPattern)` creates a string that literally starts and ends with backtick characters, which is NOT a valid regex (the backtick is an invalid regex token at the start of a pattern).

**Fix**: Just use the user's pattern directly — it's already a string:
```go
func main() {
    if len(os.Args) < 2 {
        fmt.Println("Usage: prog <pattern>")
        return
    }
    pattern := os.Args[1]  // already a string — no wrapping needed
    re, err := regexp.Compile(pattern)
    if err != nil {
        fmt.Printf("Invalid regex pattern: %v\n", err)
        return
    }
    fmt.Println(re.MatchString("test"))
}
```
</details>

---

## Bug 11: Raw String Used for Windows Path in File Operations

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    // Developer uses raw string for Windows path to avoid double-escaping
    path := `C:\Users\Alice\newfile.txt`
    //                      ^^^^ "newfile" — but wait...

    // Try to create the directory structure
    dir := `C:\Users\Alice\new`
    err := os.MkdirAll(dir, 0755)
    if err != nil {
        fmt.Printf("Error creating dir: %v\n", err)
        return
    }

    // Now read the file
    data, err := os.ReadFile(path)
    if err != nil {
        fmt.Printf("Error: %v\n", err)
    }
    _ = data
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
On a Unix system, what does `\n` mean in a Windows path like `C:\Users\Alice\newfile.txt`? Does the raw string protect against this?
</details>

<details>
<summary>Solution</summary>

**Bug (subtle)**: This code is correct on Windows — raw strings are actually the right tool for Windows paths because `\n`, `\t`, etc. in paths are literal characters. However, this code has a **portability bug**: on Unix/Linux/macOS, `C:\Users\Alice\newfile.txt` is a valid filename (with literal backslashes), but it's not a Windows path. The code only works on Windows.

A deeper bug: if this were an INTERPRETED string `"C:\Users\Alice\newfile.txt"`, the `\n` would become a newline, creating `"C:\Users\Alice"` + newline + `"ewfile.txt"`, which is wrong. The raw string IS correct here for Windows.

**The actual fix** for cross-platform code: use `filepath.Join`:
```go
import "path/filepath"
path := filepath.Join("C:", "Users", "Alice", "newfile.txt")
// On Windows: C:\Users\Alice\newfile.txt
// On Unix: C:/Users/Alice/newfile.txt (or similar)
```

The raw string approach works correctly on Windows but the code should use `filepath` for portability.
</details>

---

## Bug 12: Map Key with Raw vs Interpreted String

```go
package main

import "fmt"

func main() {
    cache := map[string]string{
        `user\nname`: "Alice",
        "status":     "active",
    }

    // Trying to retrieve by interpreted key
    key1 := "user\nname"  // this has a real newline
    key2 := `user\nname`  // this has backslash-n

    val1 := cache[key1]
    val2 := cache[key2]

    fmt.Printf("key1 (%q): %q\n", key1, val1)  // expects "Alice"
    fmt.Printf("key2 (%q): %q\n", key2, val2)  // expects "Alice"
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Is `"user\nname"` the same string as `` `user\nname` ``? How does this affect the map lookup?
</details>

<details>
<summary>Solution</summary>

**Bug**: The map key `` `user\nname` `` contains backslash + n (2 chars, NOT a newline). The lookup with `"user\nname"` (which contains a real newline) finds nothing, while the lookup with `` `user\nname` `` finds "Alice".

```go
fmt.Printf("key1 (%q): %q\n", key1, val1)  // key1 ("\user\nname"): "" — NOT found
fmt.Printf("key2 (%q): %q\n", key2, val2)  // key2 ("user\\nname"): "Alice" — found
```

**Fix**: Be consistent — use either raw or interpreted strings for the key, but not a mix:
```go
// All raw strings — consistent
cache := map[string]string{
    `user\nname`: "Alice",
}
val := cache[`user\nname`]  // found: "Alice"

// All interpreted strings — consistent
cache2 := map[string]string{
    "user\nname": "Alice",  // key has real newline
}
val2 := cache2["user\nname"]  // found: "Alice"
```
</details>
