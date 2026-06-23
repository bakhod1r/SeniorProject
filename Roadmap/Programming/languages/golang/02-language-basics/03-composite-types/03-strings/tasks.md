# Strings in Go — Tasks

## Task 1: Count Bytes vs Characters

**Difficulty:** Easy

**Description:** Write a function `StringStats(s string)` that returns the byte count and rune count of a string as two separate values.

**Starter Code:**
```go
package main

import (
    "fmt"
    // import what you need
)

func StringStats(s string) (bytes int, runes int) {
    // TODO
}

func main() {
    b, r := StringStats("Hello, 世界")
    fmt.Printf("bytes=%d, runes=%d\n", b, r) // bytes=13, runes=9
}
```

**Expected Output:**
```
bytes=13, runes=9
```

**Evaluation Checklist:**
- [ ] Returns correct byte count using `len(s)`
- [ ] Returns correct rune count using `utf8.RuneCountInString` or range loop
- [ ] Handles empty string (both return 0)
- [ ] Handles ASCII-only strings (bytes == runes)

---

## Task 2: Reverse a String (Unicode-safe)

**Difficulty:** Easy-Medium

**Description:** Implement `ReverseString(s string) string` that reverses the string correctly, handling multi-byte Unicode characters.

**Starter Code:**
```go
package main

import "fmt"

func ReverseString(s string) string {
    // TODO: must work with "Hello, 世界"
    // Expected: "界世 ,olleH"
}

func main() {
    fmt.Println(ReverseString("Hello"))       // olleH
    fmt.Println(ReverseString("Hello, 世界")) // 界世 ,olleH
    fmt.Println(ReverseString(""))            // (empty)
}
```

**Expected Output:**
```
olleH
界世 ,olleH

```

**Evaluation Checklist:**
- [ ] Uses `[]rune` conversion, not `[]byte`
- [ ] Handles empty string without panic
- [ ] Handles pure ASCII strings
- [ ] Handles multi-byte Unicode characters correctly
- [ ] Returns a new string (does not modify input)

---

## Task 3: Word Frequency Counter

**Difficulty:** Medium

**Description:** Write `WordFrequency(text string) map[string]int` that returns a map of word -> count. Words are case-insensitive and separated by whitespace.

**Starter Code:**
```go
package main

import (
    "fmt"
    // import what you need
)

func WordFrequency(text string) map[string]int {
    // TODO
}

func main() {
    freq := WordFrequency("Go is great. Go is fast. go GO")
    for word, count := range freq {
        fmt.Printf("%s: %d\n", word, count)
    }
    // Expected: go:4, is:2, great.:1, fast.:1
}
```

**Expected Output:**
```
go: 4
is: 2
great.: 1
fast.: 1
```
(order may vary)

**Evaluation Checklist:**
- [ ] Splits on whitespace using `strings.Fields`
- [ ] Normalizes to lowercase with `strings.ToLower`
- [ ] Counts correctly for repeated words
- [ ] Handles empty input (returns empty map, not nil)
- [ ] Does not panic on single-word input

---

## Task 4: CSV Row Parser

**Difficulty:** Medium

**Description:** Write `ParseCSVRow(line string) []string` that splits a comma-separated line into fields and trims whitespace from each field.

**Starter Code:**
```go
package main

import (
    "fmt"
    // import what you need
)

func ParseCSVRow(line string) []string {
    // TODO: split by comma, trim each field
}

func main() {
    fmt.Println(ParseCSVRow("Alice, 30, New York"))
    // Expected: [Alice 30 New York]
    fmt.Println(ParseCSVRow("Bob,25,London"))
    // Expected: [Bob 25 London]
    fmt.Println(ParseCSVRow(""))
    // Expected: []
}
```

**Expected Output:**
```
[Alice 30 New York]
[Bob 25 London]
[]
```

**Evaluation Checklist:**
- [ ] Splits correctly on `,`
- [ ] Trims whitespace from each field
- [ ] Returns empty slice for empty input (not nil or panic)
- [ ] Handles fields with only whitespace
- [ ] Uses `strings.Split` and `strings.TrimSpace`

---

## Task 5: Build a Simple Template Engine

**Difficulty:** Medium

**Description:** Implement `FillTemplate(tmpl string, vars map[string]string) string` that replaces `{{key}}` placeholders with values from the map.

**Starter Code:**
```go
package main

import (
    "fmt"
    // import what you need
)

func FillTemplate(tmpl string, vars map[string]string) string {
    // TODO: replace {{key}} with vars[key]
    // If key not found, leave placeholder unchanged
}

func main() {
    tmpl := "Hello, {{name}}! You have {{count}} messages."
    result := FillTemplate(tmpl, map[string]string{
        "name":  "Alice",
        "count": "5",
    })
    fmt.Println(result)
    // Hello, Alice! You have 5 messages.
}
```

**Expected Output:**
```
Hello, Alice! You have 5 messages.
```

**Evaluation Checklist:**
- [ ] Correctly replaces all `{{key}}` patterns
- [ ] Leaves unknown keys unchanged
- [ ] Uses `strings.Builder` or `strings.NewReplacer` for efficiency
- [ ] Handles template with no placeholders
- [ ] Handles empty vars map

---

## Task 6: Validate Email Format

**Difficulty:** Medium

**Description:** Write `IsValidEmail(email string) bool` that performs basic email validation (contains exactly one `@`, non-empty local and domain parts).

**Starter Code:**
```go
package main

import (
    "fmt"
    // import what you need
)

func IsValidEmail(email string) bool {
    // TODO: use strings.Cut for @
    // local and domain must be non-empty
    // domain must contain at least one dot
}

func main() {
    fmt.Println(IsValidEmail("user@example.com"))   // true
    fmt.Println(IsValidEmail("invalid"))             // false
    fmt.Println(IsValidEmail("@example.com"))        // false
    fmt.Println(IsValidEmail("user@"))               // false
    fmt.Println(IsValidEmail("user@nodot"))          // false
}
```

**Expected Output:**
```
true
false
false
false
false
```

**Evaluation Checklist:**
- [ ] Uses `strings.Cut(email, "@")`
- [ ] Checks both local and domain are non-empty
- [ ] Verifies domain contains a `.`
- [ ] Returns false for multiple `@` signs
- [ ] Does not use `regexp`

---

## Task 7: Efficient String Builder

**Difficulty:** Medium

**Description:** Implement `BuildTable(headers []string, rows [][]string) string` that renders a simple text table using `strings.Builder`.

**Starter Code:**
```go
package main

import (
    "fmt"
    "strings"
)

func BuildTable(headers []string, rows [][]string) string {
    var sb strings.Builder
    // TODO: write header row separated by " | "
    // then write a separator line of dashes
    // then write each data row
}

func main() {
    result := BuildTable(
        []string{"Name", "Age", "City"},
        [][]string{
            {"Alice", "30", "NYC"},
            {"Bob", "25", "LA"},
        },
    )
    fmt.Println(result)
}
```

**Expected Output:**
```
Name | Age | City
-----------------
Alice | 30 | NYC
Bob | 25 | LA
```

**Evaluation Checklist:**
- [ ] Uses `strings.Builder` throughout
- [ ] Uses `strings.Join` for column joining
- [ ] Separator line has appropriate length
- [ ] Handles empty rows
- [ ] No trailing newline issues

---

## Task 8: String Rotation Check

**Difficulty:** Medium

**Description:** Write `IsRotation(s, t string) bool` that returns true if `t` is a rotation of `s` (e.g., "abcd" and "cdab").

**Starter Code:**
```go
package main

import (
    "fmt"
    // import what you need
)

func IsRotation(s, t string) bool {
    // Hint: s+s contains all rotations of s
    // TODO
}

func main() {
    fmt.Println(IsRotation("abcde", "cdeab")) // true
    fmt.Println(IsRotation("abcde", "abced")) // false
    fmt.Println(IsRotation("", ""))           // true
    fmt.Println(IsRotation("a", "b"))         // false
}
```

**Expected Output:**
```
true
false
true
false
```

**Evaluation Checklist:**
- [ ] Checks that lengths are equal first
- [ ] Uses `strings.Contains(s+s, t)` efficiently
- [ ] Handles empty strings correctly
- [ ] Handles single-character strings
- [ ] Handles Unicode strings

---

## Task 9: Parse Key-Value Config

**Difficulty:** Medium-Hard

**Description:** Write `ParseConfig(data string) map[string]string` that parses a multi-line `key=value` config format, ignoring blank lines and lines starting with `#`.

**Starter Code:**
```go
package main

import (
    "fmt"
    // import what you need
)

func ParseConfig(data string) map[string]string {
    // TODO: split by newline
    // skip blank lines and # comments
    // split each line on first = only
    // trim key and value
}

func main() {
    config := `
# Database config
host = localhost
port = 5432
name = mydb

# App config
debug = true
`
    result := ParseConfig(config)
    fmt.Println(result["host"])  // localhost
    fmt.Println(result["port"])  // 5432
    fmt.Println(result["debug"]) // true
}
```

**Expected Output:**
```
localhost
5432
true
```

**Evaluation Checklist:**
- [ ] Uses `strings.Split` on `\n`
- [ ] Uses `strings.TrimSpace` on each line
- [ ] Skips empty lines and `#` comment lines
- [ ] Uses `strings.Cut` to split on first `=`
- [ ] Trims key and value
- [ ] Handles missing `=` gracefully

---

## Task 10: Longest Common Prefix

**Difficulty:** Hard

**Description:** Write `LongestCommonPrefix(strs []string) string` that finds the longest prefix shared by all strings.

**Starter Code:**
```go
package main

import "fmt"

func LongestCommonPrefix(strs []string) string {
    // TODO: efficient implementation using strings
}

func main() {
    fmt.Println(LongestCommonPrefix([]string{"flower", "flow", "flight"})) // fl
    fmt.Println(LongestCommonPrefix([]string{"dog", "racecar", "car"}))    // ""
    fmt.Println(LongestCommonPrefix([]string{"alone"}))                     // alone
    fmt.Println(LongestCommonPrefix(nil))                                   // ""
}
```

**Expected Output:**
```
fl

alone

```

**Evaluation Checklist:**
- [ ] Returns empty string for nil or empty slice
- [ ] Returns the full string for single-element slice
- [ ] Correctly finds common prefix byte-by-byte
- [ ] Does not panic on strings of different lengths
- [ ] Efficient — stops as soon as prefix is determined

---

## Task 11: HTML Tag Stripper

**Difficulty:** Hard

**Description:** Write `StripHTMLTags(html string) string` that removes all `<...>` tags and returns plain text.

**Starter Code:**
```go
package main

import (
    "fmt"
    "strings"
)

func StripHTMLTags(html string) string {
    var sb strings.Builder
    // TODO: iterate through the string
    // skip content between < and >
    // preserve all other content
}

func main() {
    fmt.Println(StripHTMLTags("<b>Hello</b>, <i>World</i>!"))
    // Hello, World!
    fmt.Println(StripHTMLTags("<p class=\"x\">Text</p>"))
    // Text
}
```

**Expected Output:**
```
Hello, World!
Text
```

**Evaluation Checklist:**
- [ ] Uses `strings.Builder` for output
- [ ] Correctly handles nested-like tags (`<p class="x">`)
- [ ] Preserves text between tags
- [ ] Handles unclosed tags gracefully
- [ ] Handles empty input
