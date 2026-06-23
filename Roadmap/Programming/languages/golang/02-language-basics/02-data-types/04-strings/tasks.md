# Strings in Go — Tasks

## Task 1: Word Frequency Counter

Build a program that counts how many times each word appears in a given text string.

**Requirements:**
- Convert all words to lowercase before counting
- Ignore punctuation (commas, periods, exclamation marks)
- Print words sorted by frequency (highest first), then alphabetically for ties

**Starter Code:**
```go
package main

import (
    "fmt"
    "strings"
    // Add more imports as needed
)

func wordFrequency(text string) map[string]int {
    // TODO: implement
    // Hint: use strings.Fields to split, strings.Trim for punctuation
    return nil
}

func main() {
    text := "To be or not to be, that is the question. To be is to live."
    freq := wordFrequency(text)
    // TODO: print sorted by frequency
    fmt.Println(freq)
}
```

**Expected Output:**
```
to: 4
be: 3
is: 2
or: 1
...
```

---

## Task 2: String Palindrome Checker

Write a function that checks if a string is a palindrome, ignoring spaces and letter case.

**Requirements:**
- Ignore spaces, punctuation, and case
- Handle Unicode characters correctly
- Return true if the cleaned string reads the same forwards and backwards

**Starter Code:**
```go
package main

import (
    "fmt"
    "unicode"
)

func isPalindrome(s string) bool {
    // TODO: implement
    // Hint: convert to rune slice, filter non-letter/digit chars,
    // then compare from both ends
    return false
}

func main() {
    tests := []struct {
        input string
        want  bool
    }{
        {"A man a plan a canal Panama", true},
        {"race a car", false},
        {"Was it a car or a cat I saw?", true},
        {"hello", false},
        {"", true},
    }

    for _, tt := range tests {
        got := isPalindrome(tt.input)
        status := "PASS"
        if got != tt.want {
            status = "FAIL"
        }
        fmt.Printf("[%s] isPalindrome(%q) = %v\n", status, tt.input, got)
    }
}
```

---

## Task 3: CSV Row Parser

Implement a function that parses a single CSV row, handling quoted fields with embedded commas.

**Requirements:**
- Split by commas
- Handle quoted fields: `"field with, comma"` should be one field
- Handle escaped quotes inside quoted fields: `""` inside quotes = literal `"`
- Return a slice of strings

**Starter Code:**
```go
package main

import "fmt"

func parseCSVRow(row string) ([]string, error) {
    // TODO: implement CSV parsing
    // Consider: quoted fields, escaped quotes, unbalanced quotes
    var fields []string
    return fields, nil
}

func main() {
    tests := []string{
        `Alice,30,New York`,
        `"Smith, John",45,"Portland, OR"`,
        `Name,"He said ""hello""",email@example.com`,
        `simple,fields,only`,
    }

    for _, row := range tests {
        fields, err := parseCSVRow(row)
        if err != nil {
            fmt.Printf("Error: %v\n", err)
            continue
        }
        fmt.Printf("Input:  %s\n", row)
        fmt.Printf("Fields: %v\n\n", fields)
    }
}
```

---

## Task 4: String Template Engine

Build a simple template engine that replaces `{{variable}}` placeholders with values from a map.

**Requirements:**
- Replace all `{{key}}` occurrences with the corresponding value
- If a key is not found in the map, leave the placeholder unchanged
- Handle nested braces and malformed templates gracefully
- Use `strings.Builder` for efficiency

**Starter Code:**
```go
package main

import (
    "fmt"
    "strings"
)

func renderTemplate(tmpl string, vars map[string]string) string {
    // TODO: implement template rendering
    // Hint: scan through the string looking for {{ and }}
    var b strings.Builder
    _ = b
    return tmpl
}

func main() {
    tmpl := "Hello, {{name}}! You have {{count}} new messages."
    vars := map[string]string{
        "name":  "Alice",
        "count": "5",
    }
    fmt.Println(renderTemplate(tmpl, vars))
    // Expected: Hello, Alice! You have 5 new messages.

    tmpl2 := "Dear {{title}} {{lastname}}, your order {{order_id}} is ready."
    vars2 := map[string]string{
        "title":    "Dr.",
        "lastname": "Smith",
        // order_id is missing — should stay as {{order_id}}
    }
    fmt.Println(renderTemplate(tmpl2, vars2))
}
```

---

## Task 5: Log Parser

Parse log lines in the format `[LEVEL] YYYY-MM-DD HH:MM:SS message` and extract structured data.

**Requirements:**
- Parse level (INFO, WARN, ERROR, DEBUG)
- Parse date and time
- Extract the message (may contain spaces and special characters)
- Return a struct with the parsed fields
- Return an error for invalid format

**Starter Code:**
```go
package main

import (
    "fmt"
    "strings"
    "time"
)

type LogEntry struct {
    Level   string
    Time    time.Time
    Message string
}

func parseLogLine(line string) (LogEntry, error) {
    // TODO: implement
    // Format: [LEVEL] YYYY-MM-DD HH:MM:SS message
    // Example: [ERROR] 2024-01-15 10:30:45 connection refused
    return LogEntry{}, nil
}

func main() {
    lines := []string{
        "[ERROR] 2024-01-15 10:30:45 connection refused",
        "[INFO] 2024-01-15 10:30:46 server started on :8080",
        "[WARN] 2024-01-15 10:31:00 high memory usage: 85%",
        "invalid line",
        "",
    }

    for _, line := range lines {
        entry, err := parseLogLine(line)
        if err != nil {
            fmt.Printf("Error parsing %q: %v\n", line, err)
            continue
        }
        fmt.Printf("Level=%s Time=%s Message=%s\n",
            entry.Level, entry.Time.Format("15:04:05"), entry.Message)
    }
}
```

---

## Task 6: URL Path Router

Implement a simple URL path router that supports static paths and `:param` style path parameters.

**Requirements:**
- Match static paths like `/users/list` exactly
- Match parameterized paths like `/users/:id/profile`
- Extract parameter values from the URL
- Return `nil` if no route matches

**Starter Code:**
```go
package main

import (
    "fmt"
    "strings"
)

type Route struct {
    pattern  string
    segments []string
}

type Router struct {
    routes []Route
}

func NewRouter() *Router {
    return &Router{}
}

func (r *Router) Add(pattern string) {
    // TODO: parse the pattern into segments
}

func (r *Router) Match(path string) map[string]string {
    // TODO: match path against routes, extract params
    // Return nil if no match
    return nil
}

func main() {
    router := NewRouter()
    router.Add("/users/list")
    router.Add("/users/:id")
    router.Add("/users/:id/profile")
    router.Add("/posts/:year/:month/:slug")

    tests := []string{
        "/users/list",
        "/users/42",
        "/users/42/profile",
        "/posts/2024/01/hello-world",
        "/unknown/path",
    }

    for _, path := range tests {
        params := router.Match(path)
        if params == nil {
            fmt.Printf("%-40s → no match\n", path)
        } else {
            fmt.Printf("%-40s → %v\n", path, params)
        }
    }
}
```

---

## Task 7: String Compression (Run-Length Encoding)

Implement run-length encoding (RLE) compression and decompression for strings.

**Requirements:**
- Encode: `"aaabbbcc"` → `"3a3b2c"`
- Decode: `"3a3b2c"` → `"aaabbbcc"`
- Handle single characters: `"abc"` → `"abc"` (not `"1a1b1c"`)
- Return an error if decoding fails (malformed input)

**Starter Code:**
```go
package main

import (
    "fmt"
    "strings"
    "strconv"
    "unicode"
)

func rleEncode(s string) string {
    // TODO: implement run-length encoding
    var b strings.Builder
    _ = b
    return s
}

func rleDecode(s string) (string, error) {
    // TODO: implement run-length decoding
    // Parse sequences like "3a", "2b", "c" (single char = count of 1)
    var b strings.Builder
    _ = b
    return s, nil
}

func main() {
    tests := []string{"aaabbbcc", "aabcdd", "abc", "aaaaaaaaaa", ""}
    for _, s := range tests {
        encoded := rleEncode(s)
        decoded, err := rleDecode(encoded)
        fmt.Printf("%-20s → encoded: %-20s → decoded: %s (ok=%v)\n",
            s, encoded, decoded, err == nil && decoded == s)
    }

    // Test invalid input
    _, err := rleDecode("3a2")
    fmt.Printf("Invalid input error: %v\n", err)

    _ = unicode.IsDigit // hint
    _ = strconv.Atoi    // hint
}
```

---

## Task 8: String Diff

Implement a function that shows the difference between two strings line by line (like a simple `diff`).

**Requirements:**
- Compare two multi-line strings line by line
- Output lines present in the second but not first with a `+` prefix
- Output lines present in the first but not second with a `-` prefix
- Output unchanged lines with a space prefix
- Handle different line counts

**Starter Code:**
```go
package main

import (
    "fmt"
    "strings"
)

type DiffLine struct {
    Type rune // '+', '-', or ' '
    Text string
}

func diff(a, b string) []DiffLine {
    // TODO: implement line-by-line diff
    // Simplified: just compare line by line (not LCS-based)
    linesA := strings.Split(a, "\n")
    linesB := strings.Split(b, "\n")
    _ = linesA
    _ = linesB
    return nil
}

func main() {
    a := "line 1\nline 2\nline 3\nline 4"
    b := "line 1\nline 2 modified\nline 3\nline 5\nline 6"

    result := diff(a, b)
    for _, dl := range result {
        fmt.Printf("%c %s\n", dl.Type, dl.Text)
    }
}
```

---

## Task 9: Email Validator

Implement an email address validator without using regular expressions.

**Requirements:**
- Must contain exactly one `@` character
- Local part (before `@`) must be non-empty and contain only valid characters
- Domain part (after `@`) must contain at least one `.` and have non-empty parts
- No leading/trailing spaces
- Return a descriptive error message for each failure type

**Starter Code:**
```go
package main

import (
    "errors"
    "fmt"
    "strings"
    "unicode"
)

func validateEmail(email string) error {
    // TODO: implement without regex
    // Hints:
    // - strings.Count(email, "@") for exactly one @
    // - strings.SplitN(email, "@", 2) to split local/domain
    // - strings.Split(domain, ".") for domain parts
    // - unicode.IsLetter, unicode.IsDigit for character validation
    _ = unicode.IsLetter // suppress "unused" error
    return errors.New("not implemented")
}

func main() {
    emails := []string{
        "user@example.com",
        "user.name+tag@example.co.uk",
        "invalid@",
        "@domain.com",
        "no-at-sign",
        "user@.com",
        "user@domain.",
        "user name@domain.com",
        "user@@domain.com",
    }

    for _, email := range emails {
        err := validateEmail(email)
        if err != nil {
            fmt.Printf("INVALID: %-35s (%v)\n", email, err)
        } else {
            fmt.Printf("VALID:   %s\n", email)
        }
    }

    _ = strings.Count // hint
}
```

---

## Task 10: Levenshtein Distance

Calculate the edit distance between two strings (number of single-character insertions, deletions, or substitutions to transform one string into another).

**Requirements:**
- Return the minimum number of edits
- Handle empty strings (distance to "" is `len(other)`)
- Use dynamic programming for efficiency
- Also return the list of operations (insert/delete/replace)

**Starter Code:**
```go
package main

import "fmt"

type EditOp struct {
    Type string // "insert", "delete", "replace", "match"
    From rune
    To   rune
}

func levenshtein(a, b string) (int, []EditOp) {
    // TODO: implement Levenshtein distance with operation tracking
    // Hint: build a 2D DP matrix, then backtrack to find operations
    // Convert to []rune first to handle Unicode correctly
    ra := []rune(a)
    rb := []rune(b)

    m := len(ra)
    n := len(rb)

    // dp[i][j] = edit distance between ra[:i] and rb[:j]
    dp := make([][]int, m+1)
    for i := range dp {
        dp[i] = make([]int, n+1)
    }

    // TODO: fill dp matrix and backtrack
    _ = m
    _ = n

    return 0, nil
}

func main() {
    pairs := [][2]string{
        {"kitten", "sitting"},
        {"saturday", "sunday"},
        {"", "hello"},
        {"hello", ""},
        {"hello", "hello"},
        {"café", "coffee"},
    }

    for _, pair := range pairs {
        dist, ops := levenshtein(pair[0], pair[1])
        fmt.Printf("%q → %q: distance=%d ops=%v\n",
            pair[0], pair[1], dist, ops)
    }
}
```

---

## Task 11: String Tokenizer

Build a tokenizer that splits a string into tokens, respecting quoted strings and escape characters.

**Requirements:**
- Split on whitespace by default
- Treat content in double quotes as a single token (preserving spaces)
- Handle `\"` inside quoted strings as a literal quote
- Handle `\\` as a literal backslash
- Return an error for unclosed quotes

**Starter Code:**
```go
package main

import "fmt"

type TokenType int

const (
    TokenWord TokenType = iota
    TokenQuoted
)

type Token struct {
    Type  TokenType
    Value string
}

func tokenize(input string) ([]Token, error) {
    // TODO: implement tokenizer
    // States: normal (scanning words), quoted (inside "..."), escape (after \)
    var tokens []Token
    return tokens, nil
}

func main() {
    inputs := []string{
        `hello world foo`,
        `say "hello world" now`,
        `path "C:\\Users\\Alice" end`,
        `say "he said \"hi\"" ok`,
        `unclosed "quote`,
    }

    for _, input := range inputs {
        tokens, err := tokenize(input)
        if err != nil {
            fmt.Printf("Error tokenizing %q: %v\n", input, err)
            continue
        }
        fmt.Printf("Input: %q\n", input)
        for _, t := range tokens {
            kind := "word"
            if t.Type == TokenQuoted {
                kind = "quoted"
            }
            fmt.Printf("  [%s] %q\n", kind, t.Value)
        }
        fmt.Println()
    }
}
```

---

## Task 12: Autocomplete with Trie

Implement a Trie data structure for prefix-based string autocomplete.

**Requirements:**
- Insert words into the trie
- Search for words with a given prefix
- Return up to `n` completions sorted alphabetically
- Handle Unicode strings correctly

**Starter Code:**
```go
package main

import "fmt"

type TrieNode struct {
    children map[rune]*TrieNode
    isEnd    bool
    word     string
}

type Trie struct {
    root *TrieNode
}

func NewTrie() *Trie {
    return &Trie{root: &TrieNode{children: make(map[rune]*TrieNode)}}
}

func (t *Trie) Insert(word string) {
    // TODO: insert word into trie
}

func (t *Trie) Complete(prefix string, maxResults int) []string {
    // TODO: find all words with given prefix, return up to maxResults
    return nil
}

func main() {
    trie := NewTrie()
    words := []string{
        "go", "golang", "google", "gopher",
        "good", "goodbye", "goal", "goat",
        "gorilla", "gorgeous",
    }
    for _, w := range words {
        trie.Insert(w)
    }

    prefixes := []string{"go", "goo", "gor", "xyz"}
    for _, p := range prefixes {
        results := trie.Complete(p, 5)
        fmt.Printf("Complete(%q): %v\n", p, results)
    }
}
```
