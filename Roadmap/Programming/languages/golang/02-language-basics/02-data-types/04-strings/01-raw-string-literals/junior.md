# Raw String Literals in Go — Junior Level

## 1. Introduction

A raw string literal in Go is a string written between backtick characters (`` ` ``). Unlike regular strings in double quotes, raw string literals show you exactly what you type — there are no escape sequences, and they can span multiple lines. What you see is what you get.

```go
raw := `Hello, World!`
regular := "Hello, World!"
// Both produce the same string
```

The word "raw" means the string is kept as-is, without any processing of special characters.

---

## 2. Prerequisites

- Know what a string is in Go
- Understand basic string operations
- Know what escape sequences are (like `\n` for newline)
- Be able to run simple Go programs

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| **Raw string literal** | A string between backtick characters; no escape processing |
| **Backtick** | The `` ` `` character (usually top-left on keyboard, same key as `~`) |
| **Escape sequence** | Characters like `\n`, `\t` that represent special characters |
| **Literal** | Taken at face value, without interpretation |
| **Multiline string** | A string that spans more than one line of code |
| **Verbatim** | Word-for-word, exactly as written |
| **Backlash** | The `\` character, used to start escape sequences |
| **Regex** | Regular expression — a pattern for matching text |

---

## 4. Core Concepts

### Syntax

```go
// A raw string literal is surrounded by backtick characters
greeting := `Hello, World!`
```

### No Escape Sequences

```go
// In a regular string, \n means newline
regular := "line1\nline2"
// Result: line1
//         line2

// In a raw string, \n means backslash followed by n
raw := `line1\nline2`
// Result: line1\nline2   (literally, on one line)
```

### Can Span Multiple Lines

```go
// A raw string can contain actual newlines
poem := `Roses are red,
Violets are blue,
Go is awesome,
And so are you!`
```

### Cannot Contain a Backtick

```go
// This does NOT work — you cannot put ` inside a raw string
// bad := `Hello `World``   ← compile error!

// Workaround: concatenate
tick := "`"
result := "Hello " + tick + "World" + tick
// Or: result := "Hello `World`"  (use regular string if it contains backtick)
```

---

## 5. Real-World Analogies

**Raw string = What you type in a chat message:**
- If you type `Hello\nWorld` in a chat, it shows `Hello\nWorld` — not two lines
- Regular strings are like a programming language that interprets `\n` as a newline
- Raw strings are like a chat app that shows exactly what you typed

**Raw string = A sticky note:**
- You write something on a sticky note, and it looks exactly the same when you read it later
- No "translation" happens — multiline stickies stay multiline

---

## 6. Mental Models

**Model: What You Type Is What You Get**

```
Regular string "Hello\nWorld":
  Input:  H e l l o \ n W o r l d
  Output: H e l l o
          W o r l d        ← \n became a real newline

Raw string `Hello\nWorld`:
  Input:  H e l l o \ n W o r l d
  Output: H e l l o \ n W o r l d  ← kept exactly as-is
```

**Model: Template Literal**

```
Think of raw strings as copy-paste:
  What appears between ` and `  is stored character-for-character.
  Newlines? Stored as newlines.
  Tabs?     Stored as tabs.
  \n?       Stored as two characters: \ and n.
```

---

## 7. Pros & Cons

### Pros of Raw String Literals

| Advantage | Example |
|-----------|---------|
| Cleaner with backslashes | `` `\d+\.\d+` `` vs `"\\d+\\.\\d+"` |
| Natural multiline text | No `\n` needed |
| Easier to read/write | Visual structure matches actual content |
| Copy-paste friendly | Paste code/text without escaping |
| Fewer typos | No accidental missing backslashes |

### Cons of Raw String Literals

| Disadvantage | Explanation |
|-------------|-------------|
| Cannot contain backtick | No way to escape `` ` `` inside raw string |
| Indentation is literal | Leading spaces on each line are part of the string |
| No special characters | Cannot use `\n`, `\t` directly (they're 2 chars each) |
| Carriage returns removed | `\r` in source is removed from the string |

---

## 8. Use Cases

1. **Regular expressions** — avoid double-escaping backslashes
2. **SQL queries** — multi-line SQL that looks clean
3. **JSON templates** — embed JSON without escaping quotes
4. **HTML/XML** — embed markup directly
5. **Windows file paths** — use backslashes without double-escaping
6. **Help text** — multi-line usage instructions
7. **Test fixtures** — expected output strings
8. **Configuration** — YAML/TOML embedded in code

---

## 9. Code Examples

### Example 1: Regex Pattern Comparison

```go
package main

import (
    "fmt"
    "regexp"
)

func main() {
    // Matching a phone number: 123-4567

    // Using interpreted string: need to escape backslashes
    pattern1 := "^\\d{3}-\\d{4}$"

    // Using raw string: much cleaner!
    pattern2 := `^\d{3}-\d{4}$`

    // Both compile to the same pattern
    re1 := regexp.MustCompile(pattern1)
    re2 := regexp.MustCompile(pattern2)

    fmt.Println(re1.MatchString("123-4567"))  // true
    fmt.Println(re2.MatchString("123-4567"))  // true
    fmt.Println(re2.MatchString("12-34567"))  // false
}
```

### Example 2: Multiline SQL Query

```go
package main

import "fmt"

func main() {
    // Hard to read with \n:
    sqlBad := "SELECT u.id, u.name, o.total\nFROM users u\nJOIN orders o ON u.id = o.user_id\nWHERE o.created_at > $1\nORDER BY o.total DESC"

    // Clean multiline with raw string:
    sqlGood := `
        SELECT u.id, u.name, o.total
        FROM users u
        JOIN orders o ON u.id = o.user_id
        WHERE o.created_at > $1
        ORDER BY o.total DESC
    `

    fmt.Println("Long form:")
    fmt.Println(sqlBad)
    fmt.Println("\nReadable form:")
    fmt.Println(sqlGood)
}
```

### Example 3: JSON Template

```go
package main

import "fmt"

func createUserJSON(name string, age int) string {
    // Raw string makes JSON easy to read
    template := `{
    "name": "%s",
    "age": %d,
    "active": true
}`
    return fmt.Sprintf(template, name, age)
}

func main() {
    json := createUserJSON("Alice", 30)
    fmt.Println(json)
}
```

### Example 4: Windows File Path

```go
package main

import "fmt"

func main() {
    // Interpreted: must escape each backslash
    path1 := "C:\\Users\\Alice\\Documents\\report.txt"

    // Raw: no escaping needed
    path2 := `C:\Users\Alice\Documents\report.txt`

    fmt.Println(path1 == path2) // true — same string!
    fmt.Println(path2)
}
```

---

## 10. Coding Patterns

### Pattern 1: Regex with Raw Strings

```go
import "regexp"

// Always use raw strings for regex patterns
var (
    emailRe   = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
    phoneRe   = regexp.MustCompile(`^\+?[1-9]\d{7,14}$`)
    zipCodeRe = regexp.MustCompile(`^\d{5}(-\d{4})?$`)
)
```

### Pattern 2: Multi-line Help Text

```go
const helpText = `
Usage: myapp [options] <command>

Commands:
  start   Start the server
  stop    Stop the server
  status  Show server status

Options:
  --port int    Port number (default 8080)
  --verbose     Enable verbose output
  --help        Show this help message
`
```

### Pattern 3: Embedded Configuration

```go
const defaultConfig = `
{
  "host": "localhost",
  "port": 8080,
  "debug": false,
  "timeout": 30
}
`
```

---

## 11. Clean Code

```go
// MESSY: escaped backslashes are hard to read
dateRegex := "^(\\d{4})-(\\d{2})-(\\d{2})$"

// CLEAN: raw string is self-documenting
dateRegex := `^(\d{4})-(\d{2})-(\d{2})$`

// MESSY: multi-line string with \n
errorMsg := "Error: connection failed\n  Host: " + host + "\n  Port: " + port

// CLEAN: raw string with proper formatting
errorMsg := fmt.Sprintf(`Error: connection failed
  Host: %s
  Port: %s`, host, port)
```

---

## 12. Product Use / Feature Examples

| Product | Raw String Usage |
|---------|----------------|
| **Web framework** | URL routing patterns: `` `/api/v\d+/users` `` |
| **ORM** | SQL query templates |
| **Config library** | Default configuration embedded in binary |
| **API documentation** | Swagger/OpenAPI templates |
| **Test suite** | Expected output fixtures |
| **CLI tool** | Help text and usage strings |
| **Log parser** | Pattern definitions for log formats |

---

## 13. Error Handling

Raw string literals cannot produce runtime errors — they are processed at compile time. However, patterns inside raw strings (like regex) can fail:

```go
import "regexp"

// This will PANIC if the pattern is invalid
re := regexp.MustCompile(`[unclosed`)
// Use during startup only (MustCompile panics on invalid pattern)

// For user-provided patterns, use Compile (returns error):
userPattern := getUserInput()
re, err := regexp.Compile(userPattern)
if err != nil {
    return fmt.Errorf("invalid pattern: %w", err)
}
```

---

## 14. Security Considerations

Raw strings don't introduce security issues by themselves, but be careful:

```go
// Raw strings in SQL templates — still vulnerable to SQL injection
// if you use fmt.Sprintf with user input!
query := fmt.Sprintf(`SELECT * FROM users WHERE name = '%s'`, userInput)
// STILL DANGEROUS — use parameterized queries instead

// Safe approach:
query := `SELECT * FROM users WHERE name = $1`
db.Query(query, userInput) // parameterized
```

---

## 15. Performance Tips

- Raw string literals and interpreted string literals have **identical performance at runtime**
- The "raw" vs "interpreted" distinction is compile-time only
- There is no overhead to using backtick strings
- Choose based on readability, not performance

---

## 16. Metrics & Analytics

```go
// Use raw strings for clearly readable monitoring queries
prometheusQuery := `
    rate(http_requests_total{status=~"5.."}[5m])
    /
    rate(http_requests_total[5m])
`
```

---

## 17. Best Practices

1. **Use raw strings for regex patterns** — avoid double-escaping backslashes
2. **Use raw strings for SQL** — improves readability of multi-line queries
3. **Use raw strings for multiline text** — JSON, HTML, YAML templates
4. **Use raw strings for Windows paths** — when path contains backslashes
5. **Don't force raw strings** — if a short string has no backslashes, double quotes are fine
6. **Be careful with leading whitespace** — indented raw strings include the indent spaces

---

## 18. Edge Cases & Pitfalls

```go
// Pitfall 1: Indentation is part of the string
query := `
    SELECT *
    FROM users
`
// The string starts with a newline, and each line has 4 leading spaces!

// Fix: use strings.TrimSpace or dedent
import "strings"
query = strings.TrimSpace(query)

// Pitfall 2: Cannot put backtick inside raw string
// backtick := `He said `hello``  ← COMPILE ERROR

// Fix 1: Use double quotes
backtick := "He said `hello`"

// Fix 2: Concatenate
backtick := `He said ` + "`" + `hello` + "`"

// Pitfall 3: Carriage returns are removed
// If your source file has Windows line endings (CRLF),
// the \r is automatically removed from raw string literals
```

---

## 19. Common Mistakes

```go
// Mistake 1: Trying to use \n in a raw string
msg := `Please press Enter\n to continue`
// This prints: Please press Enter\n to continue
// The \n is TWO characters, not a newline!

// Mistake 2: Forgetting leading whitespace
query := `
    SELECT id FROM users
`
// query starts with "\n    " — has leading newline and spaces
// Use strings.TrimSpace(query) to clean up

// Mistake 3: Trying to concatenate a raw string with a backtick
// name := `foo` + "`" + `bar`  ← correct way
```

---

## 20. Common Misconceptions

| Misconception | Reality |
|--------------|---------|
| Raw strings are faster | Performance is identical at runtime |
| `\n` in raw string is a newline | `\n` in raw string is two characters: `\` and `n` |
| Raw strings can't have newlines | Raw strings CAN have real newlines (just press Enter) |
| Raw strings can contain backticks | CANNOT — the backtick ends the string |
| Raw strings are only for multiline | They're useful for any string with backslashes |

---

## 21. Tricky Points

```go
// Tricky 1: Empty raw string
empty := ``
fmt.Println(len(empty)) // 0 — valid empty string

// Tricky 2: Raw string with only a newline
newline := `
`
fmt.Println(len(newline)) // 1 — just one newline character

// Tricky 3: Indentation in raw strings
func getTemplate() string {
    return `
    line 1
    line 2`
    // Returns: "\n    line 1\n    line 2"
    // The 4-space indent is part of the string!
}
```

---

## 22. Test

```go
package main

import (
    "regexp"
    "strings"
    "testing"
)

func TestRawStringNoEscapes(t *testing.T) {
    raw := `Hello\nWorld`
    if strings.Contains(raw, "\n") {
        t.Error("raw string should not contain actual newline")
    }
    if !strings.Contains(raw, `\n`) {
        t.Error("raw string should contain literal backslash-n")
    }
}

func TestRawStringMultiline(t *testing.T) {
    s := `line1
line2`
    lines := strings.Split(s, "\n")
    if len(lines) != 2 {
        t.Errorf("expected 2 lines, got %d", len(lines))
    }
    if lines[0] != "line1" || lines[1] != "line2" {
        t.Errorf("unexpected lines: %v", lines)
    }
}

func TestRegexWithRawString(t *testing.T) {
    re := regexp.MustCompile(`^\d{3}-\d{4}$`)
    if !re.MatchString("123-4567") {
        t.Error("should match phone number")
    }
    if re.MatchString("12-34567") {
        t.Error("should not match invalid phone number")
    }
}
```

---

## 23. Tricky Questions

**Q1: What is the length of the raw string `` `\n` ``?**
A: `2`. It contains two characters: a backslash and the letter `n`. No newline.

**Q2: Can a raw string be empty?**
A: Yes: `` `` `` is a valid empty raw string (zero length).

**Q3: What character terminates a raw string literal?**
A: A backtick (`` ` ``) terminates it. There is no way to escape a backtick inside a raw string.

**Q4: If source code has Windows-style `\r\n` line endings, what does a raw string literal contain?**
A: Only `\n`. The Go spec says carriage returns (`\r`, 0x0D) inside raw string literals are discarded.

**Q5: Can a raw string contain null bytes?**
A: Yes. Any byte except `\r` can appear in a raw string.

---

## 24. Cheat Sheet

```go
// Syntax
s := `anything here`
s := `multiline
string here`

// Vs interpreted string
raw  := `\n\t\\`    // 6 chars: \ n \ t \ \
interp := "\n\t\\"  // 3 chars: newline, tab, backslash

// When to use raw strings
// ✓ Regex:          `^\d+\.\d+$`
// ✓ SQL:            `SELECT * FROM users WHERE id = $1`
// ✓ JSON templates: `{"name": "%s"}`
// ✓ Windows paths:  `C:\Users\Name\file.txt`
// ✓ Multiline text: help text, HTML, YAML

// When NOT to use raw strings
// ✗ String contains backtick: use "He said `hi`"
// ✗ Need escape sequences like \n: use "line1\nline2"

// Backtick workaround
s := `before` + "`" + `after`
```

---

## 25. Self-Assessment Checklist

- [ ] I know the syntax for a raw string literal (backticks)
- [ ] I understand that raw strings don't process escape sequences
- [ ] I know raw strings can span multiple lines
- [ ] I know raw strings cannot contain backtick characters
- [ ] I can explain why raw strings are better for regex patterns
- [ ] I understand the indentation pitfall with multiline raw strings
- [ ] I know that `\n` in a raw string is two characters, not a newline
- [ ] I can write a multi-line SQL query using a raw string literal

---

## 26. Summary

Raw string literals are Go strings surrounded by backticks (`` ` ``). The key properties:
1. **No escape processing** — `\n` stays as `\n`, not a newline
2. **Can span multiple lines** — literal newlines are included
3. **Cannot contain backtick** — it ends the literal
4. **Identical at runtime** — same performance as interpreted strings
5. **Best for**: regex, SQL, JSON, HTML, Windows paths, multiline text

---

## 27. What You Can Build

Using raw string literals effectively, you can build:
- **Query builders** with readable multi-line SQL
- **Regex validators** for email, phone, URLs
- **Template systems** with embedded JSON/HTML
- **CLI tools** with formatted help text
- **Test harnesses** with expected-output fixtures
- **Config loaders** with default configuration embedded in code

---

## 28. Further Reading

- [Go Spec: String literals](https://go.dev/ref/spec#String_literals)
- [Go by Example: Strings](https://gobyexample.com/strings)
- [regexp package documentation](https://pkg.go.dev/regexp)
- [Go Playground: Try raw strings](https://go.dev/play/)

---

## 29. Related Topics

- **Interpreted string literals** — double-quoted strings with escape processing
- **Regular expressions** — `regexp` package, raw strings are essential here
- **text/template** — Go's template engine often uses raw strings for templates
- **strings package** — `strings.TrimSpace` helps clean up indented raw strings
- **fmt.Sprintf** — combine raw string templates with variable substitution
- **Runes and bytes** — raw strings are still byte sequences under the hood

---

## 30. Diagrams & Visual Aids

### Raw vs Interpreted: Character-by-Character

```
Source code:   `Hello\nWorld`

Character breakdown:
H  e  l  l  o  \  n  W  o  r  l  d
↓  ↓  ↓  ↓  ↓  ↓  ↓  ↓  ↓  ↓  ↓  ↓
H  e  l  l  o  \  n  W  o  r  l  d  ← stored as-is (12 chars)

Source code:   "Hello\nWorld"

Character breakdown:
H  e  l  l  o  \n  W  o  r  l  d
↓  ↓  ↓  ↓  ↓  ↓   ↓  ↓  ↓  ↓  ↓
H  e  l  l  o  LF  W  o  r  l  d   ← \n becomes linefeed (11 chars)
```

### When to Choose Which

```
Has backslashes?
├── Yes → Use raw string ` ` (simpler: `\d+` vs "\\d+")
└── No  → Either works

Needs to be multiline?
├── Yes → Use raw string ` ` (natural)
│         OR use interpreted with \n
└── No  → Either works

Contains backtick?
├── Yes → MUST use interpreted " "
└── No  → Either works

Needs special chars (\n, \t)?
├── Yes → MUST use interpreted " "
│         OR construct the chars separately
└── No  → Either works
```
