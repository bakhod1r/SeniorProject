# Iterating Strings — Tasks

## Task 1: Count Runes (Easy)

Count the number of Unicode characters (not bytes) in a string.

```go
package main

import "fmt"

// TODO: implement CountRunes
// Do NOT use len([]rune(s)) — use for range instead
func CountRunes(s string) int {
    // Use for range over the string
    // Count each iteration (each rune)
}

func main() {
    fmt.Println(CountRunes("Hello"))       // 5
    fmt.Println(CountRunes("Hello, 世界")) // 9
    fmt.Println(CountRunes("😀😁😂"))    // 3
    fmt.Println(CountRunes(""))            // 0
}
```

---

## Task 2: Is Palindrome (Easy)

Check if a string is a palindrome (reads the same forwards and backwards), Unicode-safe.

```go
package main

import "fmt"

// TODO: implement IsPalindrome
func IsPalindrome(s string) bool {
    // Convert to []rune for character access
    // Compare first and last, second and second-to-last, etc.
}

func main() {
    fmt.Println(IsPalindrome("racecar"))    // true
    fmt.Println(IsPalindrome("hello"))      // false
    fmt.Println(IsPalindrome(""))           // true
    fmt.Println(IsPalindrome("A"))          // true
    fmt.Println(IsPalindrome("上海自来水来自海上")) // true
}
```

---

## Task 3: Count Vowels and Consonants (Easy)

Count vowels (a, e, i, o, u) and consonants (other letters) in a string.

```go
package main

import (
    "fmt"
    "strings"
    "unicode"
)

// TODO: implement CharTypes
func CharTypes(s string) (vowels, consonants int) {
    // Use for range to iterate runes
    // A vowel is a letter that is in "aeiouAEIOU"
    // A consonant is any other letter
}

func main() {
    v, c := CharTypes("Hello World")
    fmt.Println("Vowels:", v)     // 3
    fmt.Println("Consonants:", c) // 7

    v, c = CharTypes("AEIOU")
    fmt.Println("Vowels:", v)     // 5
    fmt.Println("Consonants:", c) // 0
}

// Hint: strings.ContainsRune("aeiouAEIOU", r) && unicode.IsLetter(r)
```

---

## Task 4: Title Case Conversion (Medium)

Convert a string to title case (first letter of each word capitalized, rest lowercase).

```go
package main

import (
    "fmt"
    "strings"
    "unicode"
)

// TODO: implement TitleCase
func TitleCase(s string) string {
    // Use for range to iterate runes
    // Use strings.Builder to build result
    // First letter after space should be upper, rest lower
    var sb strings.Builder
    // your code here
    _ = sb
    return ""
}

func main() {
    fmt.Println(TitleCase("hello world"))         // Hello World
    fmt.Println(TitleCase("the QUICK brown FOX")) // The Quick Brown Fox
    fmt.Println(TitleCase("go programming"))      // Go Programming
}
```

---

## Task 5: Extract Numbers from String (Medium)

Extract all integer numbers found in a string.

```go
package main

import (
    "fmt"
    "unicode"
)

// TODO: implement ExtractNumbers
func ExtractNumbers(s string) []int {
    // Use for range to iterate runes
    // When you see a digit, accumulate it into a number
    // When a non-digit is seen and you were accumulating, save the number
    // Return all found numbers
}

func main() {
    fmt.Println(ExtractNumbers("abc 123 def 456 ghi"))  // [123 456]
    fmt.Println(ExtractNumbers("order #1234 for $99"))  // [1234 99]
    fmt.Println(ExtractNumbers("no numbers here"))       // []
    fmt.Println(ExtractNumbers("12 and 34"))            // [12 34]
}
```

---

## Task 6: Run-Length Encoding (Medium)

Compress a string using run-length encoding: consecutive identical characters are replaced by the character and its count.

```go
package main

import (
    "fmt"
    "strings"
)

// TODO: implement RLE
func RLE(s string) string {
    // "aaabbbcc" -> "a3b3c2"
    // "abcd" -> "a1b1c1d1" (or "abcd" if single char)
    // Use for range to iterate runes
    // Use strings.Builder for output
}

func main() {
    fmt.Println(RLE("aaabbbcc"))     // a3b3c2
    fmt.Println(RLE("aabbccdd"))     // a2b2c2d2
    fmt.Println(RLE("abcd"))         // a1b1c1d1
    fmt.Println(RLE(""))             // ""
    fmt.Println(RLE("世世界界界")) // 世2界3
}
```

---

## Task 7: Caesar Cipher (Medium)

Implement Caesar cipher (shift letters by N positions, wrap around).

```go
package main

import "fmt"

// TODO: implement Caesar
func Caesar(s string, shift int) string {
    // Shift each letter by 'shift' positions
    // 'z' + 1 wraps to 'a', 'Z' + 1 wraps to 'A'
    // Non-letters remain unchanged
    // Hint: use modular arithmetic with (r - 'a' + shift) % 26 + 'a'
}

func main() {
    fmt.Println(Caesar("Hello, World!", 3))  // Khoor, Zruog!
    fmt.Println(Caesar("Khoor, Zruog!", -3)) // Hello, World!
    fmt.Println(Caesar("xyz", 3))            // abc
    fmt.Println(Caesar("Hello 世界", 1))     // Ifmmp 世界
}
```

---

## Task 8: Find All Positions of a Rune (Hard)

Find all character positions (rune indices, not byte indices) of a given rune in a string.

```go
package main

import "fmt"

// TODO: implement FindAllPositions
// Returns rune (character) indices, not byte indices
func FindAllPositions(s string, target rune) []int {
    // Use for range — i is byte index, count separately for rune index
    // Track rune count separately from byte index
}

func main() {
    positions := FindAllPositions("Hello, World!", 'l')
    fmt.Println(positions) // [2 3 10] (rune/char indices)

    positions = FindAllPositions("Hello, 世界 Hello", 'e')
    fmt.Println(positions) // [1 13] (rune indices)

    positions = FindAllPositions("aaa", 'b')
    fmt.Println(positions) // []
}
```

---

## Task 9: Word Wrap (Hard)

Wrap text at a maximum character width, breaking only at spaces.

```go
package main

import (
    "fmt"
    "strings"
)

// TODO: implement WordWrap
// Break the text into lines of at most maxWidth characters
// Break only at spaces (do not break words)
func WordWrap(text string, maxWidth int) string {
    // Split into words
    // Group words into lines without exceeding maxWidth
    // Join lines with "\n"
    _ = strings.Builder{}
    return ""
}

func main() {
    text := "The quick brown fox jumps over the lazy dog"
    fmt.Println(WordWrap(text, 15))
    // The quick brown
    // fox jumps over
    // the lazy dog

    fmt.Println(WordWrap("Hello", 10))
    // Hello
}
```

---

## Task 10: Anagram Check (Hard)

Check if two strings are anagrams of each other (same characters, different order).

```go
package main

import "fmt"

// TODO: implement IsAnagram
// Unicode-safe: work with runes, not bytes
// Ignore spaces and case
func IsAnagram(a, b string) bool {
    // Build character frequency map for a
    // Subtract for characters in b
    // Check if all counts are zero
}

func main() {
    fmt.Println(IsAnagram("listen", "silent"))          // true
    fmt.Println(IsAnagram("hello", "world"))            // false
    fmt.Println(IsAnagram("Astronomer", "Moon starer")) // true (ignoring spaces/case)
    fmt.Println(IsAnagram("rat", "car"))                // false
}
```

---

## Task 11: String Compression (Expert)

Implement basic string compression: remove consecutive duplicate characters, keeping track of their count. Return the compressed string only if it's shorter.

```go
package main

import (
    "fmt"
    "strings"
)

// TODO: implement Compress
// "aabcccccaaa" -> "a2b1c5a3"
// Return original if compressed version is not shorter
func Compress(s string) string {
    // Use for range to iterate runes
    // Track current rune and count
    // Use strings.Builder for output
    // Compare lengths and return shorter
}

func main() {
    fmt.Println(Compress("aabcccccaaa"))  // a2b1c5a3
    fmt.Println(Compress("abcdef"))       // abcdef (not shorter)
    fmt.Println(Compress("aaaa"))         // a4
    fmt.Println(Compress(""))             // ""
}
```

---

## Task 12: Unicode Category Counter (Expert)

Count characters in each Unicode category (letters, digits, punctuation, etc.).

```go
package main

import (
    "fmt"
    "unicode"
)

type Stats struct {
    Letters     int
    Digits      int
    Spaces      int
    Punctuation int
    Symbols     int
    Other       int
}

// TODO: implement Analyze
func Analyze(s string) Stats {
    // Use for range to iterate runes
    // Use unicode package to categorize each rune
    // unicode.IsLetter, IsDigit, IsSpace, IsPunct, IsSymbol
}

func main() {
    st := Analyze("Hello, World! 42 + π ≈ 3.14")
    fmt.Printf("Letters: %d\n", st.Letters)     // 10
    fmt.Printf("Digits: %d\n", st.Digits)       // 4 (42, 3, 1, 4)
    fmt.Printf("Spaces: %d\n", st.Spaces)       // 6
    fmt.Printf("Punctuation: %d\n", st.Punctuation) // 2 (comma, exclamation, period)
    fmt.Printf("Symbols: %d\n", st.Symbols)     // includes +, ≈
    fmt.Printf("Other: %d\n", st.Other)         // includes π
}
```

---

## Bonus Task 13: Longest Common Substring (Expert)

Find the longest common substring of two Unicode strings.

```go
package main

import "fmt"

// TODO: implement LongestCommonSubstring
// Returns the longest string that appears in both a and b
// Unicode-safe (work with runes)
func LongestCommonSubstring(a, b string) string {
    // Convert both to []rune
    // Use dynamic programming
    // Track longest match
}

func main() {
    fmt.Println(LongestCommonSubstring("abcde", "bcdef"))  // "bcde"
    fmt.Println(LongestCommonSubstring("Hello World", "lo W")) // "lo W"
    fmt.Println(LongestCommonSubstring("世界你好", "你好世界")) // "你好" or "世界" (2 chars)
}
```

---

## Solutions Reference

| Task | Key Techniques |
|---|---|
| 1 | `for range` count (no `[]rune`) |
| 2 | `[]rune` + two-pointer compare |
| 3 | `for range` + `unicode.IsLetter` + vowel check |
| 4 | `for range` + track word boundary + `strings.Builder` |
| 5 | `for range` + accumulate digit runes → int |
| 6 | `for range` + count consecutive runes |
| 7 | `for range` + modular arithmetic for shift |
| 8 | `for range` + separate rune counter |
| 9 | Word splitting + greedy line filling |
| 10 | Frequency map + subtract |
| 11 | Run-length encode + length compare |
| 12 | `for range` + `unicode` package categorization |
| 13 | `[]rune` + DP table |
